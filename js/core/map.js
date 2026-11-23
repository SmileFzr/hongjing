/* ============================================================
   map.js — 地图运行时实例
   ------------------------------------------------------------
   重构前 HJ.Map 是**一个全局单例**：基地写死在 (16,19)，入口写死五个。
   那是「只有一方有基地、只有一张图」的硬假设，遭遇战要两侧基地 +
   可选地图，所以地图改成**实例**：

     HJ.Map.create(HJ.Maps.defense)  →  一个 map 对象，挂在 state.map 上

   本层只管边界、基地矩形、入口、地形查表。
   「往哪走」由 core/field.js 的距离场算，「能不能放」在 economy.js 判。

   ★ 地形代价走 HJ.Terrain，P1a 全平地 → 所有格子 cost 1，
     流场结果与重构前逐格一致，这是回归对照的依据。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Map = {
  /**
   * 把静态描述符实例化。
   * @param {object} desc HJ.Maps 里的一项
   */
  create(desc) {
    const cols = desc.cols;
    const rows = desc.rows;

    /* 字符网格 → Uint8Array 地形表。存下标不存字符，查代价时少一次哈希 */
    const terrain = new Uint8Array(cols * rows);
    const lines = desc.terrain || [];
    for (let r = 0; r < rows; r++) {
      const line = lines[r] || '';
      for (let c = 0; c < cols; c++) {
        terrain[r * cols + c] = HJ.Terrain.code(line[c] || '.');
      }
    }

    /* 基地矩形。size 缺省 4×4 */
    const bases = {};
    for (const side in desc.bases) {
      const b = desc.bases[side];
      const s = b.size || 4;
      bases[side] = {
        side: side,
        col: b.col,
        row: b.row,
        w: s,
        h: s,
        size: s,
        x: b.col + s / 2,
        y: b.row + s / 2,
        /* 推进方的啃血判定走 inBase，占地校验走 overlapsBase */
        hp: HJ.Config.BASE_HP,
        maxHp: HJ.Config.BASE_HP,
        armor: 'building',
        isBuilding: true,
        isBase: true,
        alive: true,
      };
    }

    return {
      id: desc.id,
      name: desc.name,
      desc: desc.desc,
      mode: desc.mode || 'skirmish',
      cols: cols,
      rows: rows,
      terrain: terrain,
      bases: bases,
      entrances: (desc.entrances || []).map(e => ({ ...e })),
      keepClear: desc.keepClear || 0,
    };
  },

  /* ---------------- 边界 ---------------- */

  inBounds(map, col, row) {
    return col >= 0 && row >= 0 && col < map.cols && row < map.rows;
  },

  idx(map, col, row) {
    return row * map.cols + col;
  },

  /** @returns {number} 地形下标，出界按平地 */
  terrainAt(map, col, row) {
    if (!this.inBounds(map, col, row)) return 0;
    return map.terrain[row * map.cols + col];
  },

  /**
   * 某一移动类别走某一格的代价倍数（不含建筑惩罚）。
   * 不可通行返回 Infinity，流场会直接把这一格排除掉。
   */
  moveCost(map, moveClass, col, row) {
    return HJ.Terrain.cost(this.terrainAt(map, col, row), moveClass);
  },

  /* ---------------- 基地 ---------------- */

  /** @returns {object|null} 该侧基地矩形，没有基地（如塔防的 enemy）返回 null */
  baseOf(map, side) {
    return map.bases[side] || null;
  },

  hasBase(map, side) {
    return !!map.bases[side];
  },

  /** 世界坐标是否落在该侧基地范围内（判定开始啃基地） */
  inBase(map, side, x, y, pad) {
    const b = map.bases[side];
    if (!b) return false;
    const p = pad || 0;
    return x >= b.col - p && x < b.col + b.w + p &&
           y >= b.row - p && y < b.row + b.h + p;
  },

  isBaseCell(map, side, col, row) {
    const b = map.bases[side];
    if (!b) return false;
    return col >= b.col && col < b.col + b.w && row >= b.row && row < b.row + b.h;
  },

  /** 这一块 size×size 是否压到任何一侧的基地 */
  overlapsAnyBase(map, col, row, size) {
    const n = size || 1;
    for (const side in map.bases) {
      const b = map.bases[side];
      if (col < b.col + b.w && col + n > b.col &&
          row < b.row + b.h && row + n > b.row) return true;
    }
    return false;
  },

  /** 基地中心的世界坐标（画进攻箭头、算距离用） */
  baseCenter(map, side) {
    const b = map.bases[side];
    if (!b) return null;
    return { x: b.col + b.w / 2, y: b.row + b.h / 2 };
  },

  /* ---------------- 占地查询 ---------------- */

  /** 这一格被哪栋建筑占着（基地不在 occupied 里，它是目标不是墙） */
  occupant(state, col, row) {
    if (!this.inBounds(state.map, col, row)) return null;
    return state.occupied.get(col + ',' + row) || null;
  },

  occupantAt(state, x, y) {
    return this.occupant(state, Math.floor(x), Math.floor(y));
  },

  /* ---------------- 入口（塔防用） ---------------- */

  /** 离入口太近不许建造，免得敌人一出生就埋在墙里 */
  nearEntrance(map, col, row, size) {
    if (!map.keepClear || !map.entrances.length) return false;
    const n = size || 1;
    for (const e of map.entrances) {
      const c0 = col, c1 = col + n - 1;
      const r0 = row, r1 = row + n - 1;
      const ec = Math.max(c0, Math.min(e.col, c1));
      const er = Math.max(r0, Math.min(e.row, r1));
      if (Math.hypot(ec - e.col, er - e.row) <= map.keepClear) return true;
    }
    return false;
  },

  entranceById(map, id) {
    for (const e of map.entrances) if (e.id === id) return e;
    return map.entrances[0] || null;
  },
};
