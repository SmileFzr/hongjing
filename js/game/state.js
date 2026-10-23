/* ============================================================
   state.js — 游戏状态与实体工厂
   ------------------------------------------------------------
   整个游戏只有这一个 state 对象，所有系统都读它、改它。
   想存档？JSON.stringify 这个对象就行（以后再说）。

   坐标约定：
     建筑用格坐标（col/row 是左上角，size 是边长）——放置本来就对齐格子
     移动单位用连续坐标（x/y 是格为单位的浮点数）——否则走起来会一顿一顿
     两者都额外维护一个 col/row，方便查表和快速判断重叠
   ============================================================ */

window.HJ = window.HJ || {};

HJ.State = {
  uid: 0,

  create() {
    const cfg = HJ.Config;
    const mb = HJ.Map.base;

    const state = {
      /* 资源 */
      money: cfg.START_MONEY,
      totalPower: 0,
      usedPower: 0,
      lowPower: false,

      /* 实体 */
      defenders: [],
      enemies: [],
      effects: [],
      floats: [],

      /* 移动痕迹。tracks 是履带印（长期留在地上），dust 是扬尘（几百毫秒散掉） */
      tracks: [],
      dust: [],

      /* 建筑占格表："col,row" → 建筑对象。敌人移动时用它做 O(1) 碰撞查询 */
      occupied: new Map(),

      /* 基地（不可建造，但占 4×4 格，也是敌人唯一的目标） */
      base: {
        col: mb.col, row: mb.row, w: mb.w, h: mb.h,
        x: mb.col + mb.w / 2,
        y: mb.row + mb.h / 2,
        hp: cfg.BASE_HP,
        maxHp: cfg.BASE_HP,
        armor: 'building',
        isBuilding: true,
        alive: true,
      },

      /* 进程 */
      waveIndex: 0,
      waveActive: false,
      prepTimer: 20,
      over: false,
      paused: false,
      speed: 1,
      time: 0,
      killCount: 0,
      leaked: 0,

      /* 交互 */
      selected: null,
      selectedUnit: null,      // 被选中的己方移动单位，用于重新指定驻扎点
      hover: { col: -1, row: -1, valid: false },
    };

    HJ.Field.dirty = true;
    return state;
  },

  /**
   * 在地图上放一个单位或建筑。
   * col/row 是左上角格子，建筑会占 size×size。
   */
  spawnDefender(state, defId, col, row) {
    const d = HJ.Units[defId];
    if (!d) return null;

    const size = d.size || 1;
    const cx = col + size / 2;
    const cy = row + size / 2;

    const u = {
      uid: ++this.uid,
      side: 'player',
      defId: d.id,
      name: d.name,
      kind: d.kind,
      isBuilding: d.kind === 'building',
      size,

      col, row,
      x: cx,
      y: cy,

      /* 驻扎点：出击之后靠它回家 */
      homeX: cx,
      homeY: cy,

      hp: d.hp,
      maxHp: d.hp,
      armor: d.armor,
      power: d.power || 0,
      cost: d.cost,

      range: d.range || 0,
      damage: d.damage || 0,
      rof: d.rof || 0,
      warhead: d.warhead || 'SA',
      canAttack: !!d.damage,

      /* 牵引半径与移动速度。建筑没有，天启是 0（原地不动） */
      leash: d.leash || 0,
      speed: d.speed || 0,
      canMove: !d.kind.includes('building') && (d.speed || 0) > 0,

      cd: HJ.Utils.rand(0, 0.4),
      retarget: 0,
      level: 0,
      kills: 0,
      alive: true,
      target: null,

      color: d.color,
      icon: d.icon,
    };

    state.defenders.push(u);

    if (u.isBuilding) {
      for (let r = row; r < row + size; r++) {
        for (let c = col; c < col + size; c++) {
          state.occupied.set(c + ',' + r, u);
        }
      }
      HJ.Field.dirty = true;
    }

    return u;
  },

  /**
   * 生成一个敌人。
   * entrance 可以是入口 id（'nw'）、下标（0）或直接给个 {x,y} 出生点。
   */
  spawnEnemy(state, enId, entrance) {
    const e0 = HJ.Enemies[enId];
    if (!e0) return null;

    let px;
    let py;
    if (entrance && typeof entrance === 'object' && entrance.x !== undefined) {
      px = entrance.x;
      py = entrance.y;
    } else {
      const ent = typeof entrance === 'string'
        ? HJ.Map.entranceById(entrance)
        : HJ.Map.entrances[entrance || 0];
      /* 出生点加一点随机偏移，否则同批敌人会完全叠在一起 */
      px = ent.col + 0.5 + HJ.Utils.rand(-0.35, 0.35);
      py = ent.row + 0.5 + HJ.Utils.rand(-0.35, 0.35);
    }

    const e = {
      uid: ++this.uid,
      side: 'enemy',
      enId: e0.id,
      name: e0.name,

      x: px,
      y: py,
      col: Math.floor(px),
      row: Math.floor(py),

      hp: e0.hp,
      maxHp: e0.hp,
      armor: e0.armor,

      speed: e0.speed,
      range: e0.range,
      damage: e0.damage,
      rof: e0.rof,
      warhead: e0.warhead,
      bounty: e0.bounty,

      /* 正在砸的那栋建筑，只影响界面高亮 */
      breaching: null,

      cd: HJ.Utils.rand(0, 0.3),
      retarget: 0,
      alive: true,
      target: null,

      color: e0.color,
      icon: e0.icon,
      radius: e0.radius,
    };

    state.enemies.push(e);
    return e;
  },

  /** 场上是否已有某种建筑（兵营被拆了，这里立刻变 false，就造不出兵） */
  hasBuilding(state, defId) {
    for (const u of state.defenders) {
      if (u.isBuilding && u.alive && u.defId === defId) return true;
    }
    return false;
  },
};
