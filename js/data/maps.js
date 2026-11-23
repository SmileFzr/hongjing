/* ============================================================
   maps.js — 地图数据
   ------------------------------------------------------------
   ★ 一张地图 = 地形字符网格 + 各方基地位 + 进攻入口。
     改地图只改这个文件，不用碰任何逻辑代码。

   terrain  字符网格，一行一个字符串，每个字符是一种地形。
            字符含义见 core/terrain.js。P1a 阶段全是 `.`（平地），
            所以流场代价与重构前完全一致；P2 填进真实地形。
   bases    每一侧建造场的左上角格。遭遇战两侧都有，塔防只有 player。
            没有基地的一侧，对方的推进就没有目标（塔防的 enemy 就这样）。
   entrances 进攻方出生入口，塔防用；遭遇战留空数组。
   keepClear 入口周围禁止建造的半径，免得敌人一出生就埋在墙里。
   ============================================================ */

window.HJ = window.HJ || {};

/* 造一片全平地的字符网格，给还没填地形的地图用 */
function plain(cols, rows) {
  const g = [];
  const line = new Array(cols + 1).join('.');
  for (let r = 0; r < rows; r++) g.push(line);
  return g;
}

HJ.Maps = {

  /* ---------------- 塔防：重构前那张 36×24 ---------------- */
  defense: {
    id: 'defense',
    name: '防线',
    desc: '基地在南，敌人从北、西、东三面压上来',
    mode: 'defense',
    cols: 36,
    rows: 24,
    terrain: plain(36, 24),

    bases: {
      player: { col: 16, row: 19, size: 4 },
    },

    entrances: [
      { id: 'nw', name: '西北', col: 2, row: 1 },
      { id: 'n', name: '正北', col: 17, row: 1 },
      { id: 'ne', name: '东北', col: 33, row: 1 },
      { id: 'w', name: '正西', col: 1, row: 11 },
      { id: 'e', name: '正东', col: 34, row: 11 },
    ],
    keepClear: 2,
  },
};
