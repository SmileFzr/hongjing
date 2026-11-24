/* ============================================================
   terrain.js — 地形表
   ------------------------------------------------------------
   地形是**数据**，不是代码：字符 → 名称 → 每种移动类别的代价倍数。
   寻路只问两个问题：这一格走多少倍代价（cost）、能不能走（passable）。

   原 defense 图只有平地，代价恒 1，作为回归基准。
   其他地图使用 road / sand / forest / rock / water / bridge。

   移动类别（moveClass）：
     foot    步兵，能爬山能过河？（按表定）
     track   履带车辆，怕水怕山
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Terrain = {
  /* 顺序就是地形 id（存进 Uint8Array 的数字），改顺序会作废已存的地图数据 */
  list: [
    { ch: '.', id: 'plain', name: '平地', cost: { foot: 1, track: 1 } },
    { ch: 'g', id: 'grass', name: '草地', cost: { foot: 1, track: 1 } },
    { ch: 's', id: 'sand', name: '沙地', cost: { foot: 1.25, track: 1.55 } },
    { ch: 'r', id: 'road', name: '公路', cost: { foot: 0.78, track: 0.72 } },
    { ch: 'f', id: 'forest', name: '森林', cost: { foot: 1.55, track: 2.1 } },
    { ch: 'o', id: 'rock', name: '岩地', cost: { foot: Infinity, track: Infinity } },
    { ch: '~', id: 'water', name: '河流', cost: { foot: Infinity, track: Infinity } },
    { ch: '=', id: 'bridge', name: '桥梁', cost: { foot: 0.85, track: 0.8 } },
  ],

  byCh: {},
  byId: {},

  /* 字符 → 下标。认不出来的字符按平地算，不给崩掉的机会 */
  code(ch) {
    const i = this.byCh[ch];
    return i === undefined ? 0 : i;
  },

  /** @param {number} cell 地形下标 @param {string} moveClass @returns {number} */
  cost(cell, moveClass) {
    const t = this.list[cell] || this.list[0];
    const c = t.cost[moveClass];
    return c === undefined ? 1 : c;
  },

  /** 这一格对该移动类别能不能走。Infinity 代价 = 不能走 */
  passable(cell, moveClass) {
    return this.cost(cell, moveClass) < 1e9;
  },

  name(cell) {
    return (this.list[cell] || this.list[0]).name;
  },
};

for (let i = 0; i < HJ.Terrain.list.length; i++) {
  const t = HJ.Terrain.list[i];
  HJ.Terrain.byCh[t.ch] = i;
  HJ.Terrain.byId[t.id] = i;
}
