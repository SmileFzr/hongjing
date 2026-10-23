/* ============================================================
   battle.js — 战斗内核
   ------------------------------------------------------------
   这一层完全不知道渲染的存在：只吃 dt、改数值、产出特效标记。
   塔防模式和自走棋模式将来都复用这一个文件。

   核心规则：
     1. 所有单位只打「射程内最近的、并且打得动的」目标
     2. 敌人不走固定路线：每一步都问流场「往哪边走代价最小」
     3. 建筑挡路时，敌人会停下来砸。砸穿之后流场重算，路线自动改
     4. 移动单位有牵引半径：敌人进射程就出击，但不会追出自己的圈
     5. 击杀累计：3 杀升老兵(+50%)，8 杀升精英(+100% 且自愈)
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Battle = {
  VET_KILLS: 3,
  ELITE_KILLS: 8,

  step(state, dt) {
    if (state.over) return;

    /* 地形变过就重算一次距离场（放/拆建筑时打了脏标记） */
    HJ.Field.ensure(state);

    const fireMul = state.lowPower ? HJ.Config.LOW_POWER_FIRE_RATE : 1;

    this.updateDefenders(state, dt, fireMul);
    this.updateEnemies(state, dt, fireMul);
    this.updateRegen(state, dt);
    this.cleanup(state);
  },

  /* ---------------- 防御方（玩家） ---------------- */

  updateDefenders(state, dt, fireMul) {
    for (const u of state.defenders) {
      if (!u.alive) continue;

      /* 冷却一直在走，这样切目标不会重置计时 */
      u.cd -= dt;
      if (u.invalidCd > 0) u.invalidCd -= dt;

      /* 目标不是每帧重算：0.1 秒一次，否则上百单位时开销吃不消 */
      u.retarget -= dt;
      if (u.retarget <= 0) {
        /* 搜索半径 = 射程 + 牵引半径，也就是"它能追到多远"。
           必须大于射程，否则单位永远发现不了射程外的敌人，
           追击逻辑也就永远不会被触发 —— 这是 v0.3 那个"单位不动"的根因 */
        u.target = this.findTarget(u, state.enemies, false, u.range + u.leash);
        u.retarget = 0.1 + Math.random() * 0.06;
      }

      const t = u.target;

      if (t && t.alive) {
        if (HJ.Utils.dist2(u.x, u.y, t.x, t.y) <= u.range * u.range) {
          /* 在射程内 → 停下开火 */
          if (u.cd <= 0) {
            u.cd = 1 / (u.rof * fireMul);
            this.hit(u, t, state);
          }
        } else if (u.canMove) {
          /* 目标在射程外但还没跑出牵引圈 → 追过去 */
          this.chase(u, t, state, dt);
        }
        continue;
      }

      /* 场上没目标了 → 回驻扎点站好，等下一波 */
      if (u.canMove) this.returnHome(u, dt, state);
    }
  },

  /**
   * 出击。关键在限制条件用的是「离驻扎点」的距离，不是「离当前位置」——
   * 否则圆心跟着自己走，等于无限追击，坦克会一路追到地图外面去。
   */
  chase(u, t, state, dt) {
    const dx = t.x - u.x;
    const dy = t.y - u.y;
    const L = Math.hypot(dx, dy) || 1;
    const step = u.speed * dt;

    const nx = u.x + (dx / L) * step;
    const ny = u.y + (dy / L) * step;

    if (HJ.Utils.dist(nx, ny, u.homeX, u.homeY) > u.leash) return;
    if (HJ.Map.occupantAt(state, nx, ny)) return;

    u.x = nx;
    u.y = ny;
    u.col = Math.floor(nx);
    u.row = Math.floor(ny);
    this.emitMoveFx(state, u, dx / L, dy / L, step);
  },

  /** 归位。归位途中不还击，这就是"追出去"要付的代价 */
  returnHome(u, dt, state) {
    const dx = u.homeX - u.x;
    const dy = u.homeY - u.y;
    const d = Math.hypot(dx, dy);

    if (d < 0.06) {
      u.x = u.homeX;
      u.y = u.homeY;
      u.col = Math.floor(u.x);
      u.row = Math.floor(u.y);
      return;
    }

    const step = Math.min(u.speed * dt, d);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
    u.col = Math.floor(u.x);
    u.row = Math.floor(u.y);
    this.emitMoveFx(state, u, dx / d, dy / d, step);
  },

  /**
   * 移动留下的痕迹。逻辑层只负责"在哪留下了什么"，
   * 画成什么样交给渲染层。
   *   tracks  履带印，只有车辆留，长期保留
   *   dust    扬尘，所有移动单位都扬，几百毫秒就散
   */
  emitMoveFx(state, u, dirX, dirY, step) {
    const isVehicle = u.kind === 'vehicle';

    /* 履带印：每走半格压一道 */
    if (isVehicle) {
      u.trackAcc = (u.trackAcc || 0) + step;
      if (u.trackAcc >= 0.45) {
        u.trackAcc = 0;
        if (!state.tracks) state.tracks = [];
        state.tracks.push({
          x: u.x,
          y: u.y,
          ang: Math.atan2(dirY, dirX),
        });
        if (state.tracks.length > 420) state.tracks.shift();
      }
    }

    /* 扬尘：按走过的距离攒，不用计时器，速度快就扬得多 */
    u.dustAcc = (u.dustAcc || 0) + step;
    if (u.dustAcc >= 0.55) {
      u.dustAcc = 0;
      if (!state.dust) state.dust = [];
      state.dust.push({
        x: u.x + HJ.Utils.rand(-0.16, 0.16),
        y: u.y + 0.22,
        vx: HJ.Utils.rand(-0.18, 0.18),
        vy: -0.32 - Math.random() * 0.3,
        r: isVehicle ? HJ.Utils.rand(2.2, 3.6) : HJ.Utils.rand(1.3, 2.1),
        t: 0,
        max: 0.85,
      });
      if (state.dust.length > 220) state.dust.shift();
    }
  },

  /* ---------------- 进攻方（敌人） ---------------- */

  updateEnemies(state, dt, fireMul) {
    for (const e of state.enemies) {
      if (!e.alive) continue;

      e.cd -= dt;
      if (e.invalidCd > 0) e.invalidCd -= dt;

      /* 1. 射程内有玩家单位 → 停下开火。
         建筑不算在内：建筑只有在真的挡住去路时才值得拆，
         否则敌人会站在路边对着你的电厂啃四十秒，整波卡死在那儿 */
      e.retarget -= dt;
      if (e.retarget <= 0) {
        e.target = this.findTarget(e, state.defenders, true);
        e.retarget = 0.1 + Math.random() * 0.06;
      }

      const t = e.target;
      if (t && t.alive) {
        if (e.cd <= 0) {
          e.cd = 1 / (e.rof * fireMul);
          this.hit(e, t, state);
        }
        continue;
      }

      /* 2. 前路被建筑堵住 → 就地拆它 */
      if (e.breaching && e.breaching.alive) {
        const s = e.breaching.size || 1;
        const edge = HJ.Utils.distToRect(
          e.x, e.y,
          e.breaching.col, e.breaching.row,
          e.breaching.col + s, e.breaching.row + s
        );
        if (edge <= e.range) {
          e.target = e.breaching;
          if (e.cd <= 0) {
            e.cd = 1 / (e.rof * fireMul);
            this.hit(e, e.breaching, state);
          }
          continue;
        }
      }

      /* 3. 已经摸到基地 → 啃基地 */
      if (HJ.Map.inBase(e.x, e.y, 0.25)) {
        e.breaching = null;
        if (e.cd <= 0) {
          e.cd = 1 / (e.rof * fireMul);
          this.damageBase(e, state);
        }
        continue;
      }

      /* 4. 没人拦，顺着流场继续往里走 */
      this.moveEnemy(e, state, dt);
    }
  },

  /**
   * 沿距离场的负梯度走一步。
   * 正前方是建筑时不再绕：站住，把障碍记到 breaching 上，
   * 下一帧就转成"拆它"。这就是"敌人被墙挡住 → 拆墙"的全部实现。
   */
  moveEnemy(e, state, dt) {
    const dir = HJ.Field.dirTo(e.x, e.y);
    if (!dir) return;

    const sp = e.speed * dt;
    const nx = e.x + dir.x * sp;
    const ny = e.y + dir.y * sp;

    /* 基地范围内不再做碰撞检测（敌人就是要走进去打它） */
    if (HJ.Map.inBase(nx, ny, 0)) {
      e.x = nx;
      e.y = ny;
      e.col = Math.floor(nx);
      e.row = Math.floor(ny);
      e.breaching = null;
      return;
    }

    const blocker = HJ.Map.occupantAt(state, nx, ny);
    if (blocker) {
      e.breaching = blocker;
      return;
    }

    e.breaching = null;
    e.x = nx;
    e.y = ny;
    e.col = Math.floor(nx);
    e.row = Math.floor(ny);
  },

  damageBase(e, state) {
    const dmg = HJ.Damage.calc(e.damage, e.warhead, 'building', HJ.Config.BASE_DAMAGE_MUL);
    state.base.hp -= dmg.amount;

    state.effects.push({
      x1: e.x, y1: e.y,
      x2: state.base.x, y2: state.base.y,
      warhead: 'AP',
      side: 'enemy',
      big: true,
      t: 0,
      max: 0.34,
    });

    if (HJ.Sfx) HJ.Sfx.play('alarm');

    if (state.base.hp <= 0) {
      state.base.hp = 0;
      state.over = true;
      if (HJ.HUD) HJ.HUD.gameOver(state, state.waveIndex);
    }
  },

  /* ---------------- 目标选择 ---------------- */

  /**
   * 找「射程内最近、且打得动」的目标。
   * 打不动的直接跳过 —— 谭雅不会对着坦克浪费子弹，敌人也不会拿步枪啃天启。
   *
   * @param {boolean} ignoreBuildings 敌人专用：建筑走"挡路才拆"的独立判定
   * @param {number} searchR 搜索半径。默认等于射程，玩家单位传 range + leash，
   *                         这样"发现敌人"的范围比"开火"的范围大，才会主动出击
   */
  findTarget(from, list, ignoreBuildings, searchR) {
    let best = null;
    let bestD = Infinity;
    const R = searchR || from.range;
    const r2 = R * R;

    for (const t of list) {
      if (!t.alive) continue;
      if (ignoreBuildings && t.isBuilding) continue;

      const d2 = HJ.Utils.dist2(from.x, from.y, t.x, t.y);
      if (d2 > r2) continue;
      if (d2 >= bestD) continue;
      if (HJ.Damage.resolve(from.warhead, t.armor) <= 0) continue;

      bestD = d2;
      best = t;
    }
    return best;
  },

  /* ---------------- 伤害结算 ---------------- */

  hit(a, b, state) {
    const bonus = this.levelBonus(a.level);
    const res = HJ.Damage.calc(a.damage, a.warhead, b.armor, bonus);

    b.hp -= res.amount;

    /* 只产出"发生了什么"，不决定怎么画。
       warhead 传下去，渲染层自己挑对应的特效 */
    state.effects.push({
      x1: a.x, y1: a.y,
      x2: b.x, y2: b.y,
      warhead: a.warhead || 'SA',
      side: a.side,
      big: !!a.isBuilding || (a.size || 1) > 1,
      t: 0,
      max: 0.34,
    });

    if (HJ.Sfx) HJ.Sfx.fire(a.warhead);

    /* 打不动的时候冒个"无效"提示，让克制关系被看见。
       每个目标 1.5 秒最多提示一次，否则满屏都是这两个字 */
    if (res.mult <= 0.1) {
      if ((b.invalidCd || 0) <= 0) {
        b.invalidCd = 1.5;
        state.floats.push({
          x: b.x, y: b.y - (b.isBuilding ? (b.size || 1) * 0.5 : 0),
          text: '无效', t: 0.7, max: 0.7, color: '#8a8c7e', size: 10,
        });
      }
    }

    if (b.hp <= 0) {
      b.hp = 0;
      b.alive = false;
      this.onKill(a, b, state);
    }
  },

  onKill(killer, victim, state) {
    if (victim.side === 'enemy') {
      if (HJ.Sfx) HJ.Sfx.play('explode');
      state.money += victim.bounty || 0;
      state.killCount++;

      killer.kills = (killer.kills || 0) + 1;
      const lv = killer.kills >= this.ELITE_KILLS ? 2
               : killer.kills >= this.VET_KILLS ? 1 : 0;
      if (lv > (killer.level || 0)) {
        killer.level = lv;
        state.floats.push({
          x: killer.x, y: killer.y - 0.6,
          text: lv === 2 ? '精英' : '老兵',
          t: 1.2, max: 1.2,
          color: lv === 2 ? '#ffd86a' : '#9fd7ff',
          size: 11,
        });
      }
      return;
    }

    /* 玩家的建筑被打掉 → 提示一下。兵营没了就造不出兵，
       这个反馈必须让玩家立刻知道，否则他会以为是 bug */
    if (victim.isBuilding && HJ.HUD && HJ.HUD.toast) {
      HJ.HUD.toast(victim.name + ' 被摧毁', true);
    }
  },

  levelBonus(level) {
    if (level === 1) return 1.5;
    if (level === 2) return 2.0;
    return 1;
  },

  /* 精英单位缓慢自愈 */
  updateRegen(state, dt) {
    for (const u of state.defenders) {
      if (!u.alive || u.level < 2) continue;
      if (u.hp >= u.maxHp) continue;
      u.hp = Math.min(u.maxHp, u.hp + 2.5 * dt);
    }
  },

  /* ---------------- 清理 ---------------- */

  cleanup(state) {
    const T = HJ.Config.TICK;

    for (let i = state.enemies.length - 1; i >= 0; i--) {
      if (!state.enemies[i].alive) state.enemies.splice(i, 1);
    }

    for (let i = state.defenders.length - 1; i >= 0; i--) {
      const u = state.defenders[i];
      if (!u.alive) {
        /* 建筑塌了要把占的格子还回去，并让流场重算，
           否则敌人会一直绕着一堵不存在的墙走 */
        if (u.isBuilding) {
          const s = u.size || 1;
          for (let r = u.row; r < u.row + s; r++) {
            for (let c = u.col; c < u.col + s; c++) {
              state.occupied.delete(c + ',' + r);
            }
          }
          HJ.Field.dirty = true;
        }
        state.defenders.splice(i, 1);
      }
    }

    for (let i = state.effects.length - 1; i >= 0; i--) {
      const f = state.effects[i];
      f.t += T;
      if (f.t >= f.max) state.effects.splice(i, 1);
    }
    for (let i = state.floats.length - 1; i >= 0; i--) {
      state.floats[i].t -= T;
      state.floats[i].y -= 0.5 * T;
      if (state.floats[i].t <= 0) state.floats.splice(i, 1);
    }

    /* 扬尘：向上飘、横向扩散、慢慢淡掉 */
    if (state.dust) {
      for (let i = state.dust.length - 1; i >= 0; i--) {
        const d = state.dust[i];
        d.t += T;
        if (d.t >= d.max) {
          state.dust.splice(i, 1);
          continue;
        }
        d.x += d.vx * T;
        d.y += d.vy * T;
        d.vy *= 0.97;
        d.r += 2.2 * T;
      }
    }
  },
};
