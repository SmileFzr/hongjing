/* ============================================================
   battle.js — 战斗内核
   ------------------------------------------------------------
   这一层完全不知道渲染的存在：只吃 dt、改数值、产出特效标记。
   塔防与遭遇战复用这一个文件。

   ★ 分侧重构（P1a）：原来 updateDefenders / updateEnemies 两套行为，
     本质是两种**姿态**，不是两个阵营：

       posture = 'hold'  守着打：记住驻扎点，敌人进射程就出击，
                         但不追出牵引圈，打完回位。（原 defenders）
       posture = 'push'  推着打：顺流场往对方基地走，路上有人就开火，
                         被建筑挡住就拆。（原 enemies）

     一个实体用哪套，由它所属侧的 posture 决定，建筑永远 'hold'。
     塔防 = enemy 侧 push + player 侧 hold，所以行为与重构前逐帧相同。

   其余规则没动：
     1. 只打「射程内最近的、并且打得动的」目标
     2. 打不动时飘「无效」
     3. 击杀累计：3 杀老兵(+50%)、8 杀精英(+100% 且自愈)
     4. 建筑不是墙，是「贵」—— 围死了就去拆最薄的那面
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Battle = {
  VET_KILLS: 3,
  ELITE_KILLS: 8,

  step(state, dt) {
    if (state.over) return;

    /* 地形变过就作废所有场，具体重建推迟到被问到 */
    HJ.Field.ensure();

    /* 断电惩罚按侧算：对方缺电不应该影响你的射速 */
    const mulOf = {};
    for (const sideId in state.sides) {
      mulOf[sideId] = state.sides[sideId].lowPower ? HJ.Config.LOW_POWER_FIRE_RATE : 1;
    }

    for (const sideId in state.sides) {
      const units = state.sides[sideId].units;
      const fireMul = mulOf[sideId];
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.alive) this.update(u, state, dt, fireMul);
      }
    }

    this.updateRegen(state, dt);
    this.checkEnd(state);
    this.cleanup(state);
  },

  /* ---------------- 单个实体 ---------------- */

  update(u, state, dt, fireMul) {
    /* 冷却一直在走，这样切目标不会重置计时 */
    u.cd -= dt;
    if (u.invalidCd > 0) u.invalidCd -= dt;

    if (u.posture === 'push') this.updatePush(u, state, dt, fireMul);
    else this.updateHold(u, state, dt, fireMul);
  },

  /**
   * 守着打。
   * ★ 搜索半径 = 射程 + 牵引半径，必须大于射程，否则单位永远发现不了
   *   射程外的敌人，追击逻辑也就永远不会被触发 —— 这是 v0.3「单位不动」的根因
   */
  updateHold(u, state, dt, fireMul) {
    u.retarget -= dt;
    if (u.retarget <= 0) {
      const foes = state.sides[HJ.State.foeSideId(u.side)].units;
      u.target = this.findTarget(u, foes, false, u.range + u.leash);
      u.retarget = 0.1 + Math.random() * 0.06;
    }

    const t = u.target;
    if (!t || !t.alive) {
      if (u.canMove) this.returnHome(u, dt, state);
      return;
    }

    if (HJ.Utils.dist2(u.x, u.y, t.x, t.y) <= u.range * u.range) {
      if (u.cd <= 0) {
        u.cd = 1 / (u.rof * fireMul);
        this.hit(u, t, state);
      }
      return;
    }

    /* 目标在射程外但还没跑出牵引圈 → 追过去 */
    if (u.canMove) this.chase(u, t, state, dt);
  },

  /**
   * 推着打。优先级和重构前一致：
   *   1. 射程内有对方单位 → 停下开火（建筑不算，挡路才拆，
   *      否则敌人会站在路边对着你的电厂啃四十秒）
   *   2. 前路被建筑堵住 → 拆它
   *   3. 摸到对方基地 → 啃基地
   *   4. 没人拦 → 顺流场继续走
   */
  updatePush(u, state, dt, fireMul) {
    const goalSide = HJ.State.foeSideId(u.side);
    const foes = state.sides[goalSide].units;

    u.retarget -= dt;
    if (u.retarget <= 0) {
      u.target = this.findTarget(u, foes, true);
      u.retarget = 0.1 + Math.random() * 0.06;
    }

    const t = u.target;
    if (t && t.alive) {
      if (u.cd <= 0) {
        u.cd = 1 / (u.rof * fireMul);
        this.hit(u, t, state);
      }
      return;
    }

    /* 正在拆的那栋 */
    if (u.breaching && u.breaching.alive) {
      const s = u.breaching.size || 1;
      const edge = HJ.Utils.distToRect(
        u.x, u.y,
        u.breaching.col, u.breaching.row,
        u.breaching.col + s, u.breaching.row + s
      );
      if (edge <= u.range) {
        u.target = u.breaching;
        if (u.cd <= 0) {
          u.cd = 1 / (u.rof * fireMul);
          this.hit(u, u.breaching, state);
        }
        return;
      }
    }

    const goalBase = state.map.bases[goalSide];
    if (goalBase && goalBase.alive && HJ.Map.inBase(state.map, goalSide, u.x, u.y, 0.25)) {
      u.breaching = null;
      if (u.cd <= 0) {
        u.cd = 1 / (u.rof * fireMul);
        this.damageBase(u, goalBase, state);
      }
      return;
    }

    if (!u.canMove) return;
    this.moveTowardGoal(u, state, dt, goalSide, goalBase);
  },

  /**
   * 沿距离场的负梯度走一步。
   * 正前方是建筑时不再绕：站住，把障碍记到 breaching 上，
   * 下一帧就转成「拆它」。这就是「被墙挡住 → 拆墙」的全部实现。
   */
  moveTowardGoal(u, state, dt, goalSide, goalBase) {
    const f = HJ.Field.forUnit(state, u);
    const dir = f ? HJ.Field.dirTo(f, u.x, u.y) : null;

    /* 对方没有基地就没有「要推到哪」的场，站着等目标出现即可
       （塔防反过来的情形，两种模式都不会走到这里） */
    if (!dir) return;

    const sp = u.speed * dt;
    let nx = u.x + dir.x * sp;
    let ny = u.y + dir.y * sp;
    const terrainStep = (x, y) => {
      const col = Math.floor(x), row = Math.floor(y);
      if (!isFinite(HJ.Map.moveCost(state.map, u.moveClass, col, row))) return false;
      if (col !== Math.floor(u.x) && row !== Math.floor(u.y)) {
        if (!isFinite(HJ.Map.moveCost(state.map, u.moveClass, col, Math.floor(u.y)))) return false;
        if (!isFinite(HJ.Map.moveCost(state.map, u.moveClass, Math.floor(u.x), row))) return false;
      }
      return true;
    };

    /* 岸边的双线性梯度可能指向水格；改走相邻格里的最低代价，避免在河沿原地卡住。 */
    if (!HJ.Map.inBase(state.map, goalSide, nx, ny, 0) && !terrainStep(nx, ny)) {
      const col = Math.floor(u.x), row = Math.floor(u.y);
      let best = null, bestD = HJ.Field.at(f, col, row);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = col + dc, nr = row + dr;
          if (!HJ.Map.inBounds(state.map, nc, nr)) continue;
          if (!isFinite(HJ.Map.moveCost(state.map, u.moveClass, nc, nr))) continue;
          if (dr && dc && (!isFinite(HJ.Map.moveCost(state.map, u.moveClass, nc, row))
                        || !isFinite(HJ.Map.moveCost(state.map, u.moveClass, col, nr)))) continue;
          const d = HJ.Field.at(f, nc, nr);
          if (d < bestD) { bestD = d; best = { col: nc, row: nr }; }
        }
      }
      if (best) {
        const dx = best.col + 0.5 - u.x, dy = best.row + 0.5 - u.y;
        const len = Math.hypot(dx, dy) || 1;
        dir.x = dx / len; dir.y = dy / len;
        nx = u.x + dir.x * sp; ny = u.y + dir.y * sp;
      }
    }

    /* 目标基地范围内不再做碰撞检测（单位就是要走进去打它） */
    if (goalBase && HJ.Map.inBase(state.map, goalSide, nx, ny, 0)) {
      u.x = nx; u.y = ny;
      u.col = Math.floor(nx); u.row = Math.floor(ny);
      u.breaching = null;
      return;
    }

    /* 不可通行的地形不走。P1a 全平地，这条永远不触发，
       P2 接地形之后它才是「河把地图切成两块」的实现处 */
    if (!isFinite(HJ.Map.moveCost(state.map, u.moveClass, Math.floor(nx), Math.floor(ny)))) return;

    const blocker = HJ.Map.occupantAt(state, nx, ny);
    if (blocker) {
      u.breaching = blocker;
      return;
    }

    u.breaching = null;
    u.x = nx; u.y = ny;
    u.col = Math.floor(nx); u.row = Math.floor(ny);
    this.emitMoveFx(state, u, dir.x, dir.y, sp);
  },

  /* ---------------- 移动（hold 专用）--------------- */

  /** 友军能否站在某个连续坐标上。建筑和基地都是硬障碍，不会像敌人那样拆墙。 */
  canWalkAt(state, u, x, y) {
    const col = Math.floor(x);
    const row = Math.floor(y);
    if (!HJ.Map.inBounds(state.map, col, row)) return false;
    if (!isFinite(HJ.Map.moveCost(state.map, u.moveClass, col, row))) return false;
    if (HJ.Map.occupantAt(state, x, y)) return false;
    if (HJ.Economy.reservedAt(state, col, row)) return false;
    return !HJ.Map.overlapsAnyBase(state.map, col, row, 1);
  },

  /** 斜向移动不能从两个障碍物的夹角穿过去。 */
  canWalkStep(state, u, nx, ny) {
    if (!this.canWalkAt(state, u, nx, ny)) return false;
    if (Math.floor(nx) !== Math.floor(u.x) && Math.floor(ny) !== Math.floor(u.y)) {
      if (!this.canWalkAt(state, u, nx, u.y)) return false;
      if (!this.canWalkAt(state, u, u.x, ny)) return false;
    }
    return true;
  },

  /**
   * 友军局部绕障：先直走，被建筑挡住就沿墙侧向走。
   * 这不是完整 A*，但足够处理单栋建筑和墙体转角；连续两次卡住会换边，
   * 避免在凹角永远左右抽搐。P2 的多入口地形再在此基础上接正式导航。
   */
  walkFriendly(u, tx, ty, step, state, limit) {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) return false;

    const move = Math.min(step, d);
    const ux = dx / d, uy = dy / d;
    const within = (x, y) => !limit || HJ.Utils.dist(x, y, u.homeX, u.homeY) <= limit + 1e-6;
    const accept = (x, y) => within(x, y) && this.canWalkStep(state, u, x, y);

    let nx = u.x + ux * move;
    let ny = u.y + uy * move;
    if (accept(nx, ny)) {
      u.avoidSide = 0;
      u.stuck = 0;
      this.applyFriendlyStep(u, nx, ny, ux, uy, state);
      return true;
    }

    if (!u.avoidSide) u.avoidSide = u.uid % 2 ? 1 : -1;
    const base = Math.atan2(dy, dx);
    const side = u.avoidSide;
    const angles = [
      base + side * Math.PI / 2,
      base + side * Math.PI / 4,
      base + side * Math.PI * 3 / 4,
      base - side * Math.PI / 2,
      base - side * Math.PI / 4,
      base - side * Math.PI * 3 / 4,
    ];
    for (const a of angles) {
      nx = u.x + Math.cos(a) * move;
      ny = u.y + Math.sin(a) * move;
      if (!accept(nx, ny)) continue;
      u.stuck = 0;
      this.applyFriendlyStep(u, nx, ny, Math.cos(a), Math.sin(a), state);
      return true;
    }

    u.stuck = (u.stuck || 0) + step;
    if (u.stuck > 0.35) {
      u.avoidSide = -side;
      u.stuck = 0;
    }
    return false;
  },

  applyFriendlyStep(u, nx, ny, dirX, dirY, state) {
    const step = Math.hypot(nx - u.x, ny - u.y);
    u.x = nx;
    u.y = ny;
    u.col = Math.floor(nx);
    u.row = Math.floor(ny);
    this.emitMoveFx(state, u, dirX, dirY, step);
  },

  /** 驻扎点被后放的建筑压住时，给单位找一个附近空格，避免永远绕着一块不可达目标转。 */
  relocateHome(state, u) {
    if (this.canWalkAt(state, u, u.homeX, u.homeY)) return;
    const map = state.map;
    const c0 = Math.floor(u.homeX), r0 = Math.floor(u.homeY);
    let best = null, bestD = Infinity;
    for (let r = Math.max(0, r0 - 4); r <= Math.min(map.rows - 1, r0 + 4); r++) {
      for (let c = Math.max(0, c0 - 4); c <= Math.min(map.cols - 1, c0 + 4); c++) {
        const x = c + 0.5, y = r + 0.5;
        const d = HJ.Utils.dist2(x, y, u.homeX, u.homeY);
        if (d >= bestD || !this.canWalkAt(state, u, x, y)) continue;
        bestD = d;
        best = { x, y };
      }
    }
    if (best) {
      u.homeX = best.x;
      u.homeY = best.y;
    }
  },

  /**
   * 出击。关键在限制条件用的是「离驻扎点」的距离，不是「离当前位置」——
   * 否则圆心跟着自己走，等于无限追击，坦克会一路追到地图外面去。
   */
  chase(u, t, state, dt) {
    this.walkFriendly(u, t.x, t.y, u.speed * dt, state, u.leash);
  },

  /** 归位。归位途中不还击，这就是「追出去」要付的代价 */
  returnHome(u, dt, state) {
    this.relocateHome(state, u);
    const dx = u.homeX - u.x;
    const dy = u.homeY - u.y;
    const d = Math.hypot(dx, dy);

    if (d < 0.06 && this.canWalkAt(state, u, u.homeX, u.homeY)) {
      u.x = u.homeX;
      u.y = u.homeY;
      u.col = Math.floor(u.x);
      u.row = Math.floor(u.y);
      u.avoidSide = 0;
      u.stuck = 0;
      return;
    }

    this.walkFriendly(u, u.homeX, u.homeY, Math.min(u.speed * dt, d), state, 0);
  },

  /**
   * 移动留下的痕迹。逻辑层只负责「在哪留下了什么」，画成什么样交给渲染层。
   *   tracks  履带印，只有车辆留，长期保留
   *   dust    扬尘，所有移动单位都扬，几百毫秒就散
   */
  emitMoveFx(state, u, dirX, dirY, step) {
    /* 朝向记在单位身上，渲染层只读不猜。
       这里存的是原始向量，像素画自己在 4 个朝向里量化 —— 逻辑层不该知道「朝向」是个四向概念 */
    u.faceX = dirX;
    u.faceY = dirY;

    const isVehicle = u.kind === 'vehicle';

    if (isVehicle) {
      u.trackAcc = (u.trackAcc || 0) + step;
      if (u.trackAcc >= 0.45) {
        u.trackAcc = 0;
        state.tracks.push({ x: u.x, y: u.y, ang: Math.atan2(dirY, dirX) });
        if (state.tracks.length > 420) state.tracks.shift();
      }
    }

    /* 扬尘按走过的距离攒，不用计时器，跑得快就扬得密 */
    u.dustAcc = (u.dustAcc || 0) + step;
    if (u.dustAcc >= 0.55) {
      u.dustAcc = 0;
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

  /* ---------------- 目标选择 ---------------- */

  /**
   * 找「射程内最近、且打得动」的目标。
   * 打不动的直接跳过 —— 谭雅不会对着坦克浪费子弹。
   *
   * @param {boolean} ignoreBuildings push 姿态专用：建筑走「挡路才拆」的独立判定
   * @param {number} searchR 搜索半径。hold 传 range + leash，
   *                         让「发现敌人」的范围比「开火」大，才会主动出击
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
    /* 开火瞬间记住瞄的方向：车辆据此转炮塔，步兵据此转身。
       和 faceX/faceY 分开存，「车往一边走、炮往一边瞄」是 RTS 最基本的观感 */
    const adx = b.x - a.x, ady = b.y - a.y;
    const al = Math.hypot(adx, ady) || 1;
    a.aimX = adx / al;
    a.aimY = ady / al;

    const bonus = this.levelBonus(a.level);
    const res = HJ.Damage.calc(a.damage, a.warhead, b.armor, bonus);

    b.hp -= res.amount;

    /* 只产出「发生了什么」，不决定怎么画。warhead 传下去，渲染层挑画法 */
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

    /* 打不动的时候冒个提示，让克制关系被看见。
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

  /** 啃基地：伤害另有一档折扣，漏怪不至于瞬间崩 */
  damageBase(a, base, state) {
    const dmg = HJ.Damage.calc(a.damage, a.warhead, 'building', HJ.Config.BASE_DAMAGE_MUL);
    base.hp -= dmg.amount;

    state.effects.push({
      x1: a.x, y1: a.y,
      x2: base.x, y2: base.y,
      warhead: 'AP',
      side: a.side,
      big: true,
      t: 0,
      max: 0.34,
    });

    if (HJ.Sfx) HJ.Sfx.play('alarm');

    if (base.hp <= 0) {
      base.hp = 0;
      base.alive = false;
    }
  },

  onKill(killer, victim, state) {
    /* 赏金归杀掉对方的那一侧 */
    const rich = state.sides[victim.side === 'player' ? 'enemy' : 'player'];

    if (victim.isBase) return;

    if (victim.side === 'enemy') {
      if (HJ.Sfx) HJ.Sfx.play('explode');
      state.killCount++;
    }

    if (victim.bounty) rich.money += victim.bounty;

    /* 老兵晋升。P1a 先只给玩家侧，保持塔防难度与重构前可比；
       遭遇战做平衡时（P4）把 FOE_VETERANCY 打开，两侧对称 */
    const foeLevels = killer.side === 'enemy' && (HJ.Config.FOE_VETERANCY || state.mode === 'skirmish');
    if (killer.side === 'player' || foeLevels) {
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
    }

    if (victim.isBuilding && HJ.Economy) HJ.Economy.hostLost(state, victim);

    /* 建筑被打掉 → 立刻提示。兵营没了就造不出兵，
       这个反馈必须让玩家马上知道，否则他会以为是 bug */
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
    for (const sideId in state.sides) {
      for (const u of state.sides[sideId].units) {
        if (!u.alive || u.level < 2) continue;
        if (u.hp >= u.maxHp) continue;
        u.hp = Math.min(u.maxHp, u.hp + 2.5 * dt);
      }
    }
  },

  /* ---------------- 终局判定 ---------------- */

  /* 基地被推平就结束。
     塔防里 enemy 侧没有基地，所以只有玩家输得掉；
     遭遇战双方都有基地，任何一侧被推平都分出胜负。
     「建筑全被拆光也算输」这条留到 P3 和胜负条件一起设计，
     现在写只会是个没法验证的死条件（尸体立刻被 cleanup 掉）。 */
  checkEnd(state) {
    if (state.over) return;

    for (const sideId in state.sides) {
      const side = state.sides[sideId];
      const b = side.base;
      if (b && b.alive) continue;
      if (!b && (state.mode !== 'skirmish' || side.units.some(u => u.alive && u.deployable))) continue;

      state.over = true;
      state.winner = HJ.State.foeSideId(sideId);
      state.won = state.winner === 'player';
      if (HJ.HUD) {
        HJ.HUD.gameOver(state, state.waveIndex, state.winner === 'player');
      }
      return;
    }
  },

  /* ---------------- 清理 ---------------- */

  cleanup(state) {
    const T = HJ.Config.TICK;

    for (const sideId in state.sides) {
      const list = state.sides[sideId].units;
      for (let i = list.length - 1; i >= 0; i--) {
        const u = list[i];
        if (u.alive) continue;

        /* 建筑塌了要把占的格子还回去，并让流场重算，
           否则对方会一直绕着一堵不存在的墙走 */
        if (u.isBuilding) {
          const s = u.size || 1;
          for (let r = u.row; r < u.row + s; r++) {
            for (let c = u.col; c < u.col + s; c++) {
              state.occupied.delete(c + ',' + r);
            }
          }
          HJ.Field.dirty = true;
        }
        list.splice(i, 1);
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
  },
};
