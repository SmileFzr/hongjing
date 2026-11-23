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
   * 检查五件事：出界、压任何一侧基地、离入口太近、跟已有实体重叠。
   * P2 接地形后还要加一条：不可通行的地形（水/岩）不给放。
   */
  isCellFree(state, col, row, size, side) {
    const map = state.map;
    const n = size || 1;

    if (col < 0 || row < 0) return false;
    if (col + n > map.cols || row + n > map.rows) return false;

    /* 基地 */
    if (HJ.Map.overlapsAnyBase(map, col, row, n)) return false;

    /* 入口旁边不放，免得敌人一出生就埋在墙里 */
    if (HJ.Map.nearEntrance(map, col, row, n)) return false;

    /* 跟任何一侧的任何已有实体重叠都不行（建筑之间、建筑压士兵都算） */
    for (const sideId in state.sides) {
      for (const u of state.sides[sideId].units) {
        if (!u.alive) continue;
        const us = u.isBuilding ? (u.size || 1) : 1;
        if (col < u.col + us && col + n > u.col &&
            row < u.row + us && row + n > u.row) return false;
      }
    }

    return true;
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

  /** 拆除自己放下的东西，返还一半 */
  demolish(state, unit) {
    if (!unit || !unit.alive) return;
    unit.alive = false;
    if (HJ.Sfx) HJ.Sfx.play('sell');
    const s = state.sides[unit.side];
    s.money += Math.floor(unit.cost * HJ.Config.SELL_RATE);
    this.updatePower(state);
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
