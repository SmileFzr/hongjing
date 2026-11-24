/* ============================================================
   units.js — 玩家可建造的单位与建筑
   ------------------------------------------------------------
   ★ 想加兵种 / 改数值 / 调价格，只需要改这个文件。
     界面上的建造清单是根据这里的数据自动生成的。

   数值来源：红警 2 原版（1 格 = 1 格，射程单位就是格）。
   字段说明：
     kind      building（建筑）| infantry（步兵）| vehicle（车辆）
     cost      造价
     hp        生命值
     armor     护甲类型，见 damage.js
     power     正数=发电，负数=耗电（相当于人口占用）
     range     射程，单位是格
     damage    单发基础伤害
     rof       每秒攻击次数
     warhead   弹头类型，见 damage.js
     unlock    造出什么之后才能造它（值为建筑 id）
     size      占地边长（格）。建筑用，1/2/3；士兵和坦克都是 1
     leash     牵引半径。敌人进射程就冲出去，但不会追出这个圈
     speed     移动速度（格/秒）。0 表示不会动
     tags      定位标签，只影响界面显示
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Units = {

  /* ==================== 建筑 ==================== */
  /* 尺寸是有战术含义的：
       1×1 灵活，能塞墙角补漏，用来微调敌人路线
       2×2 防线的砖块，性价比最高
       3×3 放下去整片地形就变了，逼你提前规划
       4×4 基地，敌人唯一的目标（不可建造，见 map.js） */

  powerplant: {
    id: 'powerplant', name: '电厂', kind: 'building', size: 2,
    cost: 800, hp: 750, armor: 'building', power: +200,
    color: '#c9a227', icon: '电',
    desc: '提供 200 电力。占地 2×2，是兵营和车辆的前提',
    unlock: null, buildTime: 8,
  },

  barracks: {
    id: 'barracks', name: '兵营', kind: 'building', size: 2,
    cost: 500, hp: 500, armor: 'building', power: -20,
    color: '#8a8c7e', icon: '营',
    desc: '解锁步兵。被拆掉就立刻造不出步兵，藏到防线后面',
    unlock: 'powerplant', buildTime: 6,
  },

  warfactory: {
    id: 'warfactory', name: '战车工厂', kind: 'building', size: 3,
    cost: 1200, hp: 1200, armor: 'building', power: -50,
    color: '#8a8c7e', icon: '工',
    desc: '解锁车辆。占地 3×3，一放下去整片地形都变了',
    unlock: 'barracks', buildTime: 12,
  },

  lab: {
    id: 'lab', name: '作战实验室', kind: 'building', size: 3,
    cost: 2000, hp: 600, armor: 'building', power: -120,
    color: '#9b7fc4', icon: '研',
    desc: '解锁谭雅与天启坦克。占地 3×3，很脆，务必放到最里面',
    unlock: 'warfactory', buildTime: 16,
  },

  /* --- 防御建筑：占 1×1，能灵活调整敌人路线 --- */

  pillbox: {
    id: 'pillbox', name: '机枪碉堡', kind: 'building', size: 1,
    cost: 500, hp: 400, armor: 'building', power: -20,
    range: 6, damage: 25, rof: 2.0, warhead: 'SA',
    color: '#c9a227', icon: '碉',
    desc: '1×1 廉价火力点，对坦克几乎无效。可以拿来微调路线',
    tags: ['anti-inf'], buildTime: 5,
    unlock: 'barracks',
  },

  prismtower: {
    id: 'prismtower', name: '光棱塔', kind: 'building', size: 1,
    cost: 1500, hp: 600, armor: 'building', power: -60,
    range: 7, damage: 120, rof: 0.8, warhead: 'PRISM',
    color: '#5b9bd5', icon: '棱',
    desc: '1×1 高伤单体，反装甲与拆建筑都能打',
    tags: ['anti-bld'], buildTime: 8,
    unlock: 'warfactory',
  },

  teslacoil: {
    id: 'teslacoil', name: '磁暴线圈', kind: 'building', size: 1,
    cost: 1500, hp: 600, armor: 'building', power: -75,
    range: 6.5, damage: 150, rof: 0.7, warhead: 'TESLA',
    color: '#4a8fc4', icon: '磁',
    desc: '1×1 苏军重火力，什么都能打，没有短板',
    tags: ['anti-arm'], buildTime: 8,
    unlock: 'warfactory',
  },

  /* ==================== 步兵 ==================== */
  /* 牵引半径决定"敢不敢追"：
       谭雅怕坦克 → 短；灰熊跑得快 → 长；光棱怕贴脸 → 几乎不挪窝 */

  gi: {
    id: 'gi', name: '美国大兵', kind: 'infantry', size: 1,
    cost: 200, hp: 125, armor: 'none', power: -1,
    range: 5, damage: 20, rof: 1.2, warhead: 'SA',
    leash: 4, speed: 1.4, buildTime: 4,
    color: '#5b9bd5', icon: '兵',
    desc: '廉价反步兵，打装甲几乎打不动',
    tags: ['anti-inf'],
    unlock: 'barracks',
  },

  conscript: {
    id: 'conscript', name: '动员兵', kind: 'infantry', size: 1,
    cost: 100, hp: 125, armor: 'none', power: -1,
    range: 4.5, damage: 15, rof: 1.5, warhead: 'SA',
    leash: 4, speed: 1.5, buildTime: 3,
    color: '#8a6a5a', icon: '勇',
    desc: '最便宜的填线兵，靠数量堆火力',
    tags: ['anti-inf'],
    unlock: 'barracks',
  },

  tanya: {
    id: 'tanya', name: '谭雅', kind: 'infantry', size: 1,
    cost: 1000, hp: 125, armor: 'none', power: -2,
    range: 2.5, damage: 400, rof: 1.5, warhead: 'HERO',
    leash: 3, speed: 1.9, buildTime: 12,
    color: '#c9a0e0', icon: '谭',
    desc: '秒步兵、秒建筑，对坦克伤害为 0。牵引半径只有 3 格',
    tags: ['hero'],
    unlock: 'lab',
  },

  rocket: {
    id: 'rocket', name: '火箭兵', kind: 'infantry', size: 1,
    cost: 250, hp: 110, armor: 'none', power: -1,
    range: 6, damage: 55, rof: 0.8, warhead: 'HE',
    leash: 3, speed: 1.25, buildTime: 5,
    color: '#c9a227', icon: '箭',
    desc: '火箭筒擅长拆建筑和清理步兵，装甲目标前需要坦克掩护',
    tags: ['anti-bld'], unlock: 'barracks',
  },

  mcv: {
    id: 'mcv', name: 'MCV 基地车', kind: 'vehicle', size: 2,
    cost: 0, hp: 1200, armor: 'heavy', power: 0,
    speed: 0.85, buildTime: 0, color: '#c9a227', icon: 'MCV',
    desc: '选中后轻点空地，展开为 4×4 基地', deployable: true,
  },

  /* ==================== 车辆 ==================== */

  grizzly: {
    id: 'grizzly', name: '灰熊坦克', kind: 'vehicle', size: 1,
    cost: 700, hp: 300, armor: 'heavy', power: -3,
    range: 5, damage: 65, rof: 1.5, warhead: 'AP',
    leash: 8, speed: 1.7, buildTime: 7,
    color: '#5b9bd5', icon: '灰',
    desc: '盟军主力，射速快血量薄。全场跑得最快，敢追 8 格',
    tags: ['anti-arm'],
    unlock: 'warfactory',
  },

  rhino: {
    id: 'rhino', name: '犀牛坦克', kind: 'vehicle', size: 1,
    cost: 900, hp: 400, armor: 'heavy', power: -3,
    range: 5.75, damage: 90, rof: 1.2, warhead: 'AP',
    leash: 5, speed: 1.3, buildTime: 9,
    color: '#3d7fb5', icon: '犀',
    desc: '苏军主力，单发伤害最高、血量最厚。牵引 5 格，稳',
    tags: ['anti-arm'],
    unlock: 'warfactory',
  },

  ifv: {
    id: 'ifv', name: '多功能步兵车', kind: 'vehicle', size: 1,
    cost: 600, hp: 200, armor: 'light', power: -3,
    range: 8, damage: 40, rof: 2.0, warhead: 'SA',
    leash: 6, speed: 1.9, buildTime: 6,
    color: '#5fbf7f', icon: '车',
    desc: '射程最远的便宜火力，专清步兵海',
    tags: ['anti-inf'],
    unlock: 'warfactory',
  },

  prism: {
    id: 'prism', name: '光棱坦克', kind: 'vehicle', size: 1,
    cost: 1200, hp: 150, armor: 'light', power: -3,
    range: 10, damage: 65, rof: 0.8, warhead: 'PRISM',
    leash: 2, speed: 1.2, buildTime: 11,
    color: '#5b9bd5', icon: '棱',
    desc: '射程 10 格，隔着半张地图点名。怕贴脸，牵引只有 2 格',
    tags: ['anti-bld'],
    unlock: 'warfactory',
  },

  apocalypse: {
    id: 'apocalypse', name: '天启坦克', kind: 'vehicle', size: 1,
    cost: 1750, hp: 800, armor: 'heavy', power: -6,
    range: 5.75, damage: 100, rof: 0.9, warhead: 'AP',
    leash: 0, speed: 0.9, buildTime: 16,
    color: '#2f6fa8', icon: '启',
    desc: '800 血重炮，扛线核心。牵引 0：不主动追，但可以手动调位',
    tags: ['anti-arm'],
    unlock: 'lab',
  },
};

/* 建造清单的显示顺序与分组 */
HJ.BuildOrder = {
  '建筑': ['powerplant', 'barracks', 'warfactory', 'lab'],
  '防御': ['pillbox', 'prismtower', 'teslacoil'],
  '步兵': ['conscript', 'gi', 'rocket', 'tanya'],
  '车辆': ['grizzly', 'rhino', 'ifv', 'prism', 'apocalypse'],
};
