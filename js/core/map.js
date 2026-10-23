/* ============================================================
   map.js — 地图定义
   ------------------------------------------------------------
   这一版没有固定道路。
   敌人从地图边缘的几个入口进来，自己找路走向基地；
   玩家用建筑画防线，建筑会改变敌人的路线。

   这里只管三件事：基地在哪、入口在哪、某格被谁占着。
   具体"往哪走"由 core/field.js 的距离场算出来。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Map = {
  /* 基地：4×4 格，贴底部中央。敌人从北、西、东三面压上来 */
  base: { col: 16, row: 19, w: 4, h: 4 },

  /* 敌人入口。id 供波次编排指定"这一波从哪边来" */
  entrances: [
    { id: 'nw', name: '西北', col: 2,  row: 1 },
    { id: 'n',  name: '正北', col: 17, row: 1 },
    { id: 'ne', name: '东北', col: 33, row: 1 },
    { id: 'w',  name: '正西', col: 1,  row: 11 },
    { id: 'e',  name: '正东', col: 34, row: 11 },
  ],

  /* 入口周围这个半径内禁止建造，免得敌人一出生就卡在墙里 */
  ENTRANCE_CLEAR: 2,

  baseCenter() {
    const b = this.base;
    return { x: b.col + b.w / 2, y: b.row + b.h / 2 };
  },

  inBounds(col, row) {
    return col >= 0 && row >= 0 && col < HJ.Config.COLS && row < HJ.Config.ROWS;
  },

  isBaseCell(col, row) {
    const b = this.base;
    return col >= b.col && col < b.col + b.w && row >= b.row && row < b.row + b.h;
  },

  /** 世界坐标是否落在基地范围内（判定敌人开始啃基地） */
  inBase(x, y, pad) {
    const b = this.base;
    const p = pad || 0;
    return x >= b.col - p && x < b.col + b.w + p &&
           y >= b.row - p && y < b.row + b.h + p;
  },

  /** 这一格被哪栋建筑占着（基地不算，基地是敌人要进去的目标） */
  occupant(state, col, row) {
    if (!this.inBounds(col, row)) return null;
    return state.occupied.get(col + ',' + row) || null;
  },

  /** 世界坐标落在哪栋建筑里 */
  occupantAt(state, x, y) {
    return this.occupant(state, Math.floor(x), Math.floor(y));
  },

  /** 离入口太近，不许建造 */
  nearEntrance(col, row, size) {
    const n = size || 1;
    for (const e of this.entrances) {
      const c0 = col, c1 = col + n - 1;
      const r0 = row, r1 = row + n - 1;
      const ec = Math.max(c0, Math.min(e.col, c1));
      const er = Math.max(r0, Math.min(e.row, r1));
      if (Math.hypot(ec - e.col, er - e.row) <= this.ENTRANCE_CLEAR) return true;
    }
    return false;
  },

  entranceById(id) {
    for (const e of this.entrances) if (e.id === id) return e;
    return this.entrances[0];
  },
};
