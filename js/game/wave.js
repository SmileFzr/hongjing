/* ============================================================
   wave.js — 波次调度
   ------------------------------------------------------------
   两个阶段来回切：
     prep    倒计时，给玩家布置和造兵的时间
     active  按 spawn 队列放怪，直到这一波全清完
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Wave = {
  update(state, dt) {
    if (state.over) return;

    /* ---- 准备阶段 ---- */
    if (!state.waveActive) {
      state.prepTimer -= dt;
      if (state.prepTimer <= 0) this.start(state);
      return;
    }

    /* ---- 战斗阶段：按时间轴放怪 ---- */
    state.waveClock += dt;
    while (state.spawnQueue.length && state.spawnQueue[0].at <= state.waveClock) {
      const s = state.spawnQueue.shift();
      HJ.State.spawnEnemy(state, s.id, s.from);
    }

    /* ---- 清空判定 ---- */
    if (state.spawnQueue.length === 0 && state.enemies.length === 0) {
      this.finish(state);
    }
  },

  start(state) {
    const w = HJ.Waves[state.waveIndex];
    if (!w) return;

    state.waveActive = true;
    state.waveClock = 0;
    if (HJ.Sfx) HJ.Sfx.play('wave');
    state.spawnQueue = this.buildQueue(w);

    if (HJ.HUD) {
      HJ.HUD.toast('第 ' + (state.waveIndex + 1) + ' 波 · ' + w.name);
    }
  },

  finish(state) {
    state.waveActive = false;
    state.waveIndex++;

    const bonus = HJ.Economy.waveBonus(state);
    state.prepTimer = HJ.WAVE_PREP_TIME;

    if (state.waveIndex >= HJ.Waves.length) {
      state.won = true;
      state.over = true;
      if (HJ.HUD) HJ.HUD.gameOver(state, state.waveIndex, true);
      return;
    }

    if (HJ.HUD) {
      HJ.HUD.toast('波次清空  +' + bonus + ' 资金');
    }
  },

  /**
   * 把 spawns 展开成按时间排序的具体生成点。
   * 每个个体单独分配入口 —— 同一波里的敌人可能从三个方向同时压上来。
   */
  buildQueue(wave) {
    const q = [];
    const entries = (wave.entries && wave.entries.length)
      ? wave.entries
      : HJ.Map.entrances.map(e => e.id);

    for (const s of wave.spawns) {
      const start = s.delay || 0;
      const gap = s.gap === undefined ? 0.5 : s.gap;
      for (let i = 0; i < s.n; i++) {
        q.push({
          id: s.id,
          at: start + i * gap,
          from: HJ.Utils.pick(entries),
        });
      }
    }
    q.sort((a, b) => a.at - b.at);
    return q;
  },
};
