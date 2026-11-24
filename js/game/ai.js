window.HJ = window.HJ || {};

HJ.AI = {
  createBrain() {
    return { clock: 0, deployClock: 2, attackClock: 0, attacking: false, spots: null };
  },

  update(state, dt) {
    if (state.over || state.mode !== 'skirmish') return;
    const side = state.sides.enemy;
    const ai = side.ai;

    if (!side.base) {
      const mcv = side.units.find(u => u.alive && u.defId === 'mcv');
      ai.deployClock -= dt;
      if (mcv && ai.deployClock <= 0) {
        const start = state.map.starts.enemy;
        HJ.Economy.deployMCV(state, mcv, start.col, start.row);
      }
      return;
    }

    ai.clock -= dt;
    ai.attackClock += dt;
    if (ai.clock > 0) return;
    ai.clock = 0.8;
    this.ensureSpots(state);
    this.act(state);
  },

  ensureSpots(state) {
    const ai = state.sides.enemy.ai;
    if (ai.spots) return;
    const base = state.sides.enemy.base;
    const foe = state.sides.player.base;
    const target = foe || state.map.starts.player;
    const spots = [];
    for (let r = 1; r < state.map.rows - 3; r++) {
      for (let c = 1; c < state.map.cols - 3; c++) {
        const d = Math.hypot(c + 2 - base.col - 2, r + 2 - base.row - 2);
        if (d < 4 || d > 11) continue;
        const towardFoe = Math.hypot(c - target.col, r - target.row);
        spots.push({ col: c, row: r, d, towardFoe });
      }
    }
    ai.spots = spots;
  },

  count(state, id) {
    return state.enemies.filter(u => u.alive && (!id || u.defId === id)).length;
  },

  build(state, id, tower) {
    const side = state.sides.enemy;
    if (!HJ.Economy.isUnlocked(state, id, 'enemy') || !HJ.Economy.canAfford(state, id, 'enemy')) return false;
    const spots = side.ai.spots.slice().sort((a, b) => tower
      ? a.towardFoe - b.towardFoe || a.d - b.d
      : b.towardFoe - a.towardFoe || b.d - a.d);
    const d = HJ.Units[id];
    if (d.kind !== 'building') {
      const host = HJ.Economy.producer(state, id, 'enemy');
      const pos = HJ.Economy.rallyPoint(state, d, host);
      return !!pos && HJ.Economy.build(state, id, pos.col, pos.row, 'enemy').ok;
    }
    for (const p of spots) {
      if (HJ.Economy.isCellFree(state, p.col, p.row, d.size || 1, 'enemy')) {
        return HJ.Economy.build(state, id, p.col, p.row, 'enemy').ok;
      }
    }
    return false;
  },

  act(state) {
    const side = state.sides.enemy;
    const army = side.units.filter(u => u.alive && u.canMove && u.defId !== 'mcv');
    const mobile = army.length;
    const pushing = army.filter(u => u.posture === 'push');
    if (!side.ai.attacking && ((army.length >= 7 && side.ai.attackClock >= 45)
        || (army.length >= 4 && side.ai.attackClock >= 120))) {
      side.ai.attacking = true;
      side.ai.attackClock = 0;
      for (const u of army.slice(0, 8)) u.posture = 'push';
      if (HJ.HUD) HJ.HUD.toast('敌军正在进攻', true);
    } else if (side.ai.attacking && pushing.length < 2) {
      side.ai.attacking = false;
      side.ai.attackClock = 0;
      for (const u of pushing) u.posture = 'hold';
    }

    if (mobile >= 36) return;
    if (!HJ.State.hasBuilding(state, 'powerplant', 'enemy')) { this.build(state, 'powerplant'); return; }
    if (!HJ.State.hasBuilding(state, 'barracks', 'enemy')) { this.build(state, 'barracks'); return; }
    if (!HJ.State.hasBuilding(state, 'warfactory', 'enemy')) { this.build(state, 'warfactory'); return; }
    if (side.usedPower > side.totalPower - 35) { this.build(state, 'powerplant'); return; }
    if (!HJ.State.hasBuilding(state, 'lab', 'enemy') && (mobile >= 8 || state.time > 150)) {
      if (this.build(state, 'lab')) return;
    }

    const towers = this.count(state, 'prismtower');
    if (mobile >= 8 && towers < Math.min(6, Math.floor(mobile / 7)) && side.money >= 1700) {
      if (this.build(state, 'prismtower', true)) return;
    }
    if (HJ.State.hasBuilding(state, 'lab') && side.money >= HJ.Units.apocalypse.cost + 500) {
      if (this.build(state, 'apocalypse')) return;
    }
    if (side.money >= HJ.Units.rhino.cost + 250) {
      if (this.build(state, 'rhino')) return;
    }
    if (mobile < 5 || side.money >= 800) {
      if (this.build(state, 'rocket')) return;
      if (this.build(state, 'conscript')) return;
    }
  },
};
