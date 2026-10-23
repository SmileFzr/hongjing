/* ============================================================
   economy.js — 资金 / 电力 / 建造校验
   ------------------------------------------------------------
   这一版把「人口上限」和「电力」合并成一个系统：
     电厂 +200 电，每个单位按体量耗电（步兵 1、坦克 3、天启 6）。
     电力不足不是禁止建造，而是全场射速掉到 70% —— 这是红警原版的断电手感。

   建造校验的核心是 isCellFree：建筑占 size×size，任何一格被占都不给放。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Economy = {
  /* 每帧刷新电力账本 */
  updatePower(state) {
    let total = 0;
    let used = 0;

    for (const u of state.defenders) {
      if (!u.alive) continue;
      if (u.power > 0) total += u.power;
      else used += -u.power;
    }

    state.totalPower = total;
    state.usedPower = used;
    state.lowPower = used > total;
  },

  /* 钱够不够 */
  canAfford(state, defId) {
    const d = HJ.Units[defId];
    return !!d && state.money >= d.cost;
  },

  /* 前置建筑有没有。兵营被敌人拆掉 → 这里立刻返回 false → 造不出步兵 */
  isUnlocked(state, defId) {
    const d = HJ.Units[defId];
    if (!d) return false;
    if (!d.unlock) return true;
    return HJ.State.hasBuilding(state, d.unlock);
  },

  /**
   * 这块地方能不能放下 size×size 的东西。
   * 检查四件事：出界、压基地、离敌人入口太近、跟已有单位重叠。
   */
  isCellFree(state, col, row, size) {
    const n = size || 1;

    if (col < 0 || row < 0) return false;
    if (col + n > HJ.Config.COLS || row + n > HJ.Config.ROWS) return false;

    /* 基地 */
    const b = HJ.Map.base;
    if (col < b.col + b.w && col + n > b.col &&
        row < b.row + b.h && row + n > b.row) return false;

    /* 入口旁边不放，免得敌人一出生就埋在墙里 */
    if (HJ.Map.nearEntrance(col, row, n)) return false;

    /* 跟任何已有单位重叠都不行（建筑之间、建筑压士兵都算） */
    for (const u of state.defenders) {
      if (!u.alive) continue;
      const us = u.isBuilding ? (u.size || 1) : 1;
      if (col < u.col + us && col + n > u.col &&
          row < u.row + us && row + n > u.row) return false;
    }

    return true;
  },

  /**
   * 尝试建造。返回 { ok:boolean, reason?:string }
   */
  build(state, defId, col, row) {
    const d = HJ.Units[defId];
    if (!d) return { ok: false, reason: '未知单位' };

    if (!this.isUnlocked(state, defId)) {
      const need = HJ.Units[d.unlock];
      return { ok: false, reason: '需要先造' + (need ? need.name : '前置建筑') };
    }
    if (state.money < d.cost) {
      return { ok: false, reason: '资金不足' };
    }
    if (!this.isCellFree(state, col, row, d.size || 1)) {
      return { ok: false, reason: '这里放不下' };
    }

    state.money -= d.cost;
    HJ.State.spawnDefender(state, defId, col, row);
    this.updatePower(state);
    if (HJ.Sfx) HJ.Sfx.play('build');

    return { ok: true };
  },

  /** 拆除自己放下的东西，返还一半 */
  demolish(state, unit) {
    if (!unit || !unit.alive) return;
    unit.alive = false;
    if (HJ.Sfx) HJ.Sfx.play('sell');
    state.money += Math.floor(unit.cost * HJ.Config.SELL_RATE);
    this.updatePower(state);
  },

  /** 击杀赏金已经由 Battle 直接加到 state.money，这里只做波次结算奖励 */
  waveBonus(state) {
    const base = HJ.Config.WAVE_CLEAR_BONUS;
    const grow = HJ.Config.WAVE_BONUS_GROWTH;
    const bonus = base + grow * Math.floor(state.waveIndex * 0.7);
    state.money += bonus;
    return bonus;
  },
};
