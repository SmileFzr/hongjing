/* ============================================================
   economy.js — 资金 / 电力 / 建造校验
   ------------------------------------------------------------
   这一版把「人口上限」和「电力」合并成一个系统：
     电厂 +200 电，每个单位按体量耗电（步兵 1、坦克 3、天启 6）。
     电力不足不是禁止建造，而是全场射速掉到 70% —— 红警原版的断电手感。

   ★ 分侧重构（P1a）：账本按侧算。
     塔防只算 player 侧（enemy 侧没有经济），遭遇战两侧都要算，
     所以 enemy AI 造东西走的是同一个 build()，只传不同的 side。
     side 参数一律放最后、默认 'player'，读起来就跟原来一样。

   建造校验的核心是 isCellFree：建筑占 size×size，
   任何一格被**任何一方**占着都不给放。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Economy = {
  /* 每帧刷新每一侧的电力账本 */
  updatePower(state) {
    for (const sideId in state.sides) {
      const s = state.sides[sideId];
      let total = 0;
      let used = 0;

      for (const u of s.units) {
        if (!u.alive) continue;
        if (u.power > 0) total += u.power;
        else used += -u.power;
      }

      /* 基地本身也耗电（红警里建造场不耗电，塔防的基地算 0） */
      s.totalPower = total;
      s.usedPower = used;
      s.lowPower = used > total;
    }
  },

  canAfford(state, defId, side) {
    const d = HJ.Units[defId];
    if (!d) return false;
    return state.sides[side || 'player'].money >= d.cost;
  },

  /* 前置建筑有没有。兵营被敌人拆掉 → 这里立刻返回 false → 造不出步兵 */
  isUnlocked(state, defId, side) {
    const d = HJ.Units[defId];
    if (!d) return false;
    if (!d.unlock) return true;
    return HJ.State.hasBuilding(state, d.unlock, side || 'player');
  },

  /**
   * 这块地方能不能放下 size×size 的东西。
   * 检查出界、基地、入口净空、实体重叠，以及占地内是否有不可通行地形。
   */
  isCellFree(state, col, row, size, side, ignoreUnit) {
    const map = state.map;
    const n = size || 1;

    if (col < 0 || row < 0) return false;
    if (col + n > map.cols || row + n > map.rows) return false;

    /* 基地 */
    if (HJ.Map.overlapsAnyBase(map, col, row, n)) return false;

    /* 入口旁边不放，免得敌人一出生就埋在墙里 */
    if (HJ.Map.nearEntrance(map, col, row, n)) return false;

    for (let r = row; r < row + n; r++) {
      for (let c = col; c < col + n; c++) {
        if (!HJ.Terrain.passable(HJ.Map.terrainAt(map, c, r), 'track')) return false;
      }
    }

    /* 跟任何一侧的任何已有实体重叠都不行（建筑之间、建筑压士兵都算） */
    for (const sideId in state.sides) {
      for (const u of state.sides[sideId].units) {
        if (!u.alive || u === ignoreUnit) continue;
        const us = u.isBuilding ? (u.size || 1) : 1;
        if (col < u.col + us && col + n > u.col &&
            row < u.row + us && row + n > u.row) return false;
      }
    }

    for (const sideId in state.sides) {
      for (const item of state.sides[sideId].queue) {
        const d = HJ.Units[item.defId];
        if (!d || d.kind !== 'building' || item.col === undefined) continue;
        const n = d.size || 1;
        if (col < item.col + n && col + n > item.col &&
            row < item.row + n && row + n > item.row) return false;
      }
    }

    return true;
  },

  reservedAt(state, col, row) {
    for (const sideId in state.sides) {
      for (const item of state.sides[sideId].queue) {
        const d = HJ.Units[item.defId];
        if (!d || d.kind !== 'building' || item.col === undefined) continue;
        if (col >= item.col && col < item.col + d.size && row >= item.row && row < item.row + d.size) return item;
      }
    }
    return null;
  },

  producer(state, defId, side) {
    const d = HJ.Units[defId];
    if (!d || d.kind === 'building') return null;
    const hostId = d.kind === 'infantry' ? 'barracks' : 'warfactory';
    return state.sides[side].units.find(u => u.alive && u.defId === hostId) || null;
  },

  enqueue(state, defId, side) {
    return this.enqueueAt(state, defId, null, null, side);
  },

  queueBuilding(state, defId, col, row, side) {
    return this.enqueueAt(state, defId, col, row, side);
  },

  enqueueAt(state, defId, col, row, side) {
    const who = side || 'player';
    const s = state.sides[who];
    const d = HJ.Units[defId];
    if (!d || d.id === 'mcv') return { ok: false, reason: '这个单位不能生产' };
    if (!this.isUnlocked(state, defId, who)) return { ok: false, reason: '需要先造' + HJ.Units[d.unlock].name };
    if (s.money < d.cost) return { ok: false, reason: '资金不足' };
    if (s.queue.length >= HJ.Config.MAX_QUEUE) return { ok: false, reason: '生产队列已满' };

    const host = this.producer(state, defId, who);
    if (d.kind !== 'building' && !host) return { ok: false, reason: '生产建筑已被摧毁' };
    const n = d.size || 1;
    if (d.kind === 'building' && !this.isCellFree(state, col, row, n, who)) {
      return { ok: false, reason: '这里放不下' };
    }

    const total = d.buildTime || 4;
    s.money -= d.cost;
    s.queue.push({
      defId, col, row, hostId: host ? host.uid : 0,
      remaining: total, total,
    });
    this.updatePower(state);
    return { ok: true };
  },

  cancelQueue(state, index, side) {
    const s = state.sides[side || 'player'];
    const item = s.queue[index];
    if (!item) return 0;
    const d = HJ.Units[item.defId];
    const refund = Math.floor(d.cost * HJ.Config.QUEUE_REFUND);
    s.money += refund;
    s.queue.splice(index, 1);
    return refund;
  },

  rallyPoint(state, def, host) {
    if (!host) return null;
    const cells = [];
    for (let r = 0; r < state.map.rows; r++) {
      for (let c = 0; c < state.map.cols; c++) {
        const d = HJ.Utils.dist2(c + 0.5, r + 0.5, host.col + host.size / 2, host.row + host.size / 2);
        if (d <= 36) cells.push({ c, r, d });
      }
    }
    cells.sort((a, b) => a.d - b.d || a.r - b.r || a.c - b.c);
    for (const p of cells) {
      if (!isFinite(HJ.Map.moveCost(state.map, def.kind === 'infantry' ? 'foot' : 'track', p.c, p.r))) continue;
      if (!this.isCellFree(state, p.c, p.r, 1, host.side)) continue;
      return { col: p.c, row: p.r };
    }
    return null;
  },

  completeItem(state, side, item) {
    const s = state.sides[side];
    const d = HJ.Units[item.defId];
    if (d.kind !== 'building') {
      const host = s.units.find(u => u.uid === item.hostId && u.alive);
      if (!host) return false;
      const pos = this.rallyPoint(state, d, host);
      if (!pos) return false;
      HJ.State.spawn(state, side, item.defId, pos.col, pos.row);
      return true;
    }
    for (const sideId in state.sides) {
      for (const u of state.sides[sideId].units) {
        if (!u.alive) continue;
        const n = u.isBuilding ? u.size : 1;
        if (item.col < u.col + n && item.col + d.size > u.col &&
            item.row < u.row + n && item.row + d.size > u.row) return false;
      }
    }
    HJ.State.spawn(state, side, item.defId, item.col, item.row);
    return true;
  },

  update(state, dt) {
    if (state.over) return;
    if (state.mode === 'skirmish') {
      state.sides.player.money += HJ.Config.SKIRMISH_INCOME * dt;
      state.sides.enemy.money += HJ.Config.SKIRMISH_INCOME * dt;
    }
    for (const sideId in state.sides) {
      const s = state.sides[sideId];
      for (let i = s.queue.length - 1; i >= 0; i--) {
        const item = s.queue[i];
        if (item.hostId && !s.units.some(u => u.uid === item.hostId && u.alive)) {
          this.cancelQueue(state, i, sideId);
        }
      }
      const item = s.queue[0];
      if (!item) continue;
      item.remaining -= dt;
      if (item.remaining > 0) continue;
      if (this.completeItem(state, sideId, item)) {
        s.queue.shift();
        this.updatePower(state);
        if (HJ.Sfx) HJ.Sfx.play('build');
        if (sideId === 'player' && HJ.HUD) HJ.HUD.toast(HJ.Units[item.defId].name + ' 生产完成');
      }
    }
  },

  canDeployMCV(state, mcv, col, row) {
    return state.mode === 'skirmish' && mcv && mcv.alive && mcv.defId === 'mcv'
      && !state.sides[mcv.side].base
      && this.isCellFree(state, col, row, 4, mcv.side, mcv);
  },

  deployMCV(state, mcv, col, row) {
    if (!this.canDeployMCV(state, mcv, col, row)) return { ok: false, reason: '这里无法展开基地' };
    const side = state.sides[mcv.side];
    side.base = HJ.Map.addBase(state.map, mcv.side, col, row, 4);
    mcv.alive = false;
    HJ.Field.markDirty();
    this.updatePower(state);
    if (HJ.Sfx) HJ.Sfx.play('build');
    return { ok: true };
  },

  /**
   * 尝试建造。返回 { ok:boolean, reason?:string }
   */
  build(state, defId, col, row, side) {
    const s = state.sides[side || 'player'];
    const d = HJ.Units[defId];
    if (!d) return { ok: false, reason: '未知单位' };

    const who = side || 'player';

    if (!this.isUnlocked(state, defId, who)) {
      const need = HJ.Units[d.unlock];
      return { ok: false, reason: '需要先造' + (need ? need.name : '前置建筑') };
    }
    if (s.money < d.cost) {
      return { ok: false, reason: '资金不足' };
    }
    if (!this.isCellFree(state, col, row, d.size || 1, who)) {
      return { ok: false, reason: '这里放不下' };
    }

    s.money -= d.cost;
    HJ.State.spawn(state, who, defId, col, row);
    this.updatePower(state);
    if (HJ.Sfx) HJ.Sfx.play('build');

    return { ok: true };
  },

  hostLost(state, unit) {
    const s = state.sides[unit.side];
    for (let i = s.queue.length - 1; i >= 0; i--) {
      if (s.queue[i].hostId === unit.uid) this.cancelQueue(state, i, unit.side);
    }
  },

  /** 拆除自己放下的东西，返还一半 */
  demolish(state, unit) {
    if (!unit || !unit.alive) return;
    unit.alive = false;
    if (HJ.Sfx) HJ.Sfx.play('sell');
    const s = state.sides[unit.side];
    s.money += Math.floor(unit.cost * HJ.Config.SELL_RATE);
    this.hostLost(state, unit);
    this.updatePower(state);
    HJ.Field.markDirty();
  },

  /** 击杀赏金已由 Battle 直接加到对应侧，这里只做波次结算奖励 */
  waveBonus(state, side) {
    const s = state.sides[side || 'player'];
    const base = HJ.Config.WAVE_CLEAR_BONUS;
    const grow = HJ.Config.WAVE_BONUS_GROWTH;
    const bonus = base + grow * Math.floor(state.waveIndex * 0.7);
    s.money += bonus;
    return bonus;
  },
};
