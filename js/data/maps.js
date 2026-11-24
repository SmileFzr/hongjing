/* ============================================================
   maps.js — 地图数据
   ------------------------------------------------------------
   ★ 一张地图 = 地形字符网格 + 各方基地位 + 进攻入口。
     改地图只改这个文件，不用碰任何逻辑代码。

   terrain  字符网格，一行一个字符串，每个字符是一种地形。
            字符含义见 core/terrain.js；原 defense 图保留全平地作回归基准。
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

/* 双桥地图：先画地面，再刻河流，最后补道路与障碍，避免手写 42 行易错字符。 */
function twinBridges() {
  const cols = 42, rows = 28;
  const g = plain(cols, rows).map(line => line.split(''));
  const put = (ch, col, row, w = 1, h = 1) => {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if (r >= 0 && r < rows && c >= 0 && c < cols) g[r][c] = ch;
      }
    }
  };
  const grass = (col, row, w, h) => put('g', col, row, w, h);
  const road = (col, row, w, h) => put('r', col, row, w, h);
  const rock = (col, row, w, h) => put('o', col, row, w, h);

  grass(0, 3, 17, 8);
  grass(24, 3, 18, 8);
  grass(1, 17, 12, 6);
  grass(29, 17, 12, 6);

  put('s', 0, 13, cols, 1);
  put('~', 0, 14, cols, 1);
  put('s', 0, 15, cols, 1);
  for (const c of [11, 26]) put('=', c, 14, 4, 1);

  road(2, 0, 2, 14);
  road(19, 0, 2, 14);
  road(38, 0, 2, 14);
  road(11, 13, 4, 1);
  road(26, 13, 4, 1);
  road(12, 14, 2, 14);
  road(27, 14, 2, 14);
  road(11, 15, 4, 1);
  road(26, 15, 4, 1);
  road(12, 17, 17, 2);
  road(12, 23, 2, 5);
  road(27, 23, 2, 5);

  /* 岩地切断部分近路，但五个入口与两座桥周围保持完整通路。 */
  rock(5, 5, 3, 3);
  rock(32, 5, 4, 3);
  rock(4, 18, 3, 3);
  rock(34, 18, 3, 3);

  const forest = (col, row, w, h) => {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if ((c * 7 + r * 11) % 5 !== 0) g[r][c] = 'f';
      }
    }
  };
  forest(16, 5, 7, 5);
  forest(0, 19, 8, 4);
  forest(33, 19, 8, 4);

  put('s', 14, 20, 14, 6);
  return g.map(line => line.join(''));
}

function steelCrossing() {
  const g = plain(40, 24).map(line => line.split(''));
  const put = (ch, col, row, w, h) => {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) g[r][c] = ch;
    }
  };
  put('g', 0, 0, 40, 8);
  put('s', 0, 18, 40, 6);
  put('r', 0, 10, 40, 4);
  put('~', 0, 8, 40, 2);
  put('=', 8, 8, 4, 2);
  put('=', 28, 8, 4, 2);
  put('r', 9, 6, 2, 4);
  put('r', 29, 6, 2, 4);
  put('r', 9, 8, 2, 6);
  put('r', 29, 8, 2, 6);
  put('o', 3, 10, 3, 3);
  put('o', 34, 10, 3, 3);
  put('o', 16, 3, 8, 3);
  put('o', 16, 18, 8, 3);
  put('f', 14, 6, 3, 3);
  put('f', 23, 15, 3, 3);
  return g.map(line => line.join(''));
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

  twinBridges: {
    id: 'twinBridges',
    name: '双桥要塞',
    desc: '南北向河流横贯战场，两座桥是装甲部队的必经之路',
    mode: 'defense',
    cols: 42,
    rows: 28,
    terrain: twinBridges(),
    start: { powerplant: { col: 19, row: 19 } },
    demo: [
      ['rhino', 13, 18], ['rhino', 16, 18], ['rhino', 24, 18], ['rhino', 27, 18],
      ['gi', 15, 20], ['gi', 18, 20], ['gi', 21, 20],
      ['prismtower', 12, 16], ['pillbox', 28, 16],
      ['tanya', 19, 19], ['apocalypse', 21, 18],
    ],
    bases: {
      player: { col: 18, row: 22, size: 4 },
    },
    entrances: [
      { id: 'nw', name: '西北', col: 2, row: 1 },
      { id: 'n', name: '正北', col: 19, row: 1 },
      { id: 'ne', name: '东北', col: 38, row: 1 },
      { id: 'w', name: '正西', col: 1, row: 7 },
      { id: 'e', name: '正东', col: 40, row: 7 },
    ],
    keepClear: 2,
  },

  steelCrossing: {
    id: 'steelCrossing',
    name: '钢铁交锋',
    desc: '对称战场，双方从 MCV 开始建设；中央桥梁与岩地形成两条进攻走廊',
    mode: 'skirmish',
    cols: 40,
    rows: 24,
    terrain: steelCrossing(),
    bases: {},
    starts: {
      player: { col: 3, row: 3 },
      enemy: { col: 35, row: 19 },
    },
    keepClear: 1,
    entrances: [],
  },
};
