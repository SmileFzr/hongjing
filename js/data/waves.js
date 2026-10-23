/* ============================================================
   waves.js — 敌人数据 + 波次编排
   ------------------------------------------------------------
   ★ 想改难度、加新敌人、改波次节奏，只改这个文件。

   设计思路：
     第 1-2 波单入口，教玩家"敌人是从外面走过来的"
     第 3 波起开第二个入口，逼玩家分兵
     第 6 波起三面开花，防线必须能自我循环
     第 10 波起全入口，这时候"关键建筑放哪"才开始要命

   entries 就是这一波允许的入口（见 core/map.js 的 entrances）。
   同一波里的敌人会随机分配，同一批坦克可能从三个方向同时压上来。
   ============================================================ */

window.HJ = window.HJ || {};

/* ---------------- 敌人单位 ---------------- */

HJ.Enemies = {
  conscript: {
    id: 'conscript', name: '动员兵',
    hp: 125, armor: 'none', speed: 1.6,
    range: 4.5, damage: 15, rof: 1.4, warhead: 'SA',
    bounty: 26, radius: 7, color: '#c05a4a', icon: '勇',
  },

  rhino: {
    id: 'rhino', name: '犀牛坦克',
    hp: 400, armor: 'heavy', speed: 1.25,
    range: 5.75, damage: 90, rof: 1.1, warhead: 'AP',
    bounty: 110, radius: 12, color: '#c05a4a', icon: '犀',
  },

  terror: {
    id: 'terror', name: '恐怖机器人',
    hp: 120, armor: 'light', speed: 2.6,
    range: 1.2, damage: 45, rof: 1.8, warhead: 'HE',
    bounty: 55, radius: 8, color: '#b06a2a', icon: '蜘',
  },

  apocalypse: {
    id: 'apocalypse', name: '天启坦克',
    hp: 800, armor: 'heavy', speed: 0.85,
    range: 5.75, damage: 100, rof: 0.85, warhead: 'AP',
    bounty: 280, radius: 16, color: '#8f2f28', icon: '启',
  },
};

/* ---------------- 波次表 ---------------- */
/* spawns 里每一段：id 敌人类型，n 数量，gap 个体间隔(秒)，delay 波内起始延迟 */

HJ.Waves = [
  {
    name: '步兵侦察',
    entries: ['nw'],
    spawns: [{ id: 'conscript', n: 6, gap: 0.7 }],
  },
  {
    name: '步兵推进',
    entries: ['nw', 'n'],
    spawns: [{ id: 'conscript', n: 10, gap: 0.55 }],
  },
  {
    name: '首次装甲',
    entries: ['nw', 'n'],
    spawns: [
      { id: 'conscript', n: 6, gap: 0.5 },
      { id: 'rhino', n: 1, gap: 1, delay: 3 },
    ],
  },
  {
    name: '装甲小队',
    entries: ['n', 'ne'],
    spawns: [{ id: 'rhino', n: 2, gap: 3 }],
  },
  {
    name: '步坦协同',
    entries: ['nw', 'n', 'ne'],
    spawns: [
      { id: 'conscript', n: 12, gap: 0.45 },
      { id: 'rhino', n: 2, gap: 2, delay: 2 },
    ],
  },
  {
    name: '机器人突袭',
    entries: ['w', 'e'],
    spawns: [
      { id: 'terror', n: 3, gap: 0.8 },
      { id: 'rhino', n: 3, gap: 2, delay: 4 },
    ],
  },
  {
    name: '天启登场',
    entries: ['n', 'w', 'e'],
    spawns: [
      { id: 'rhino', n: 4, gap: 1.8 },
      { id: 'apocalypse', n: 1, gap: 1, delay: 5 },
    ],
  },
  {
    name: '人海战术',
    entries: ['nw', 'n', 'ne'],
    spawns: [
      { id: 'conscript', n: 18, gap: 0.3 },
      { id: 'rhino', n: 4, gap: 1.6, delay: 3 },
    ],
  },
  {
    name: '双重天启',
    entries: ['n', 'w', 'e'],
    spawns: [
      { id: 'apocalypse', n: 2, gap: 3 },
      { id: 'rhino', n: 5, gap: 1.6, delay: 2 },
    ],
  },
  {
    name: '装甲洪流',
    entries: ['nw', 'n', 'ne', 'w'],
    spawns: [
      { id: 'rhino', n: 8, gap: 1.2 },
      { id: 'conscript', n: 16, gap: 0.35, delay: 2 },
    ],
  },
  {
    name: '钢铁压迫',
    entries: ['nw', 'n', 'ne', 'e'],
    spawns: [
      { id: 'apocalypse', n: 3, gap: 2.5 },
      { id: 'rhino', n: 7, gap: 1.4, delay: 3 },
    ],
  },
  {
    name: '最后防线',
    entries: ['nw', 'n', 'ne', 'w', 'e'],
    spawns: [
      { id: 'conscript', n: 10, gap: 0.4 },
      { id: 'rhino', n: 5, gap: 1.6, delay: 2 },
      { id: 'apocalypse', n: 3, gap: 3, delay: 8 },
    ],
  },
];

/* 波次之间留给玩家布置的秒数 */
HJ.WAVE_PREP_TIME = 20;
