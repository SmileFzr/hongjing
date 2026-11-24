/* ============================================================
   state.js — 游戏状态与实体工厂
   ------------------------------------------------------------
   整个游戏只有这一个 state 对象，所有系统都读它、改它。

   ★ 分侧重构（P1a）：原来只有 defenders / enemies 两个数组，
     那是「一方守、一方冲」的硬假设。现在统一成：

       state.sides = { player: Side, enemy: Side }
       Side = { id, units: [], money, power..., posture, ai }

     每个实体带 side，战斗内核按 side 找对手，按 posture 决定
     是「守着打」（牵引 + 归位）还是「推着打」（流场 + 破墙）。
     塔防就是「enemy 侧没有经济、没有基地、按波次生成、posture=push」
     的特例；遭遇战两侧都有基地。逻辑层只有一套。

   基地实体存在 state.map.bases[side] 里（由 HJ.Map.create 造出来，
   带 hp），它不在 side.units 里 —— 它是目标，不是墙，
   推进方只有在**走进基地范围**才开始拆，不会隔着半张图啃。

   坐标约定：
     建筑用格坐标（col/row 是左上角，size 是边长）
     移动单位用连续坐标（x/y 是格为单位的浮点数），否则走起来一顿一顿
   ============================================================ */

window.HJ = window.HJ || {};

HJ.State = {
  uid: 0,

  /**
   * @param {object} opts { map: HJ.Maps 里的一项, mode?: defense|skirmish|endless }
   */
  create(opts) {
    const o = opts || {};
    const map = HJ.Map.create(o.map || HJ.Maps[HJ.Config.DEFAULT_MAP]);

    const state = {
      map: map,
      /* 战斗类型；endless 与 classic 共用塔防地图，但波次规则不同 */
      mode: o.mode || (map.mode === 'skirmish' ? 'skirmish' : 'defense'),

      /* 特效与痕迹是全场景共享的，不分侧 */
      effects: [],
      floats: [],
      tracks: [],
      dust: [],

      /* 建筑占格表："col,row" → 建筑对象。两侧共用，任何建筑都挡路 */
      occupied: new Map(),

      sides: {
        player: this.makeSide('player', map),
        enemy: this.makeSide('enemy', map),
      },

      /* 进程 */
      waveIndex: 0,
      waveActive: false,
      waveClock: 0,
      currentWave: null,
      spawnQueue: [],
      prepTimer: 20,
      over: false,
      won: false,
      winner: null,
      paused: false,
      speed: 1,
      time: 0,
      killCount: 0,
      leaked: 0,

      /* 交互 */
      selected: null,
      selectedUnit: null,
      /* 被指挥的一队：单选时就是它自己，「全选同类」时是一堆同型号 */
      squad: [],
      /* 手机拆除模式与建筑检查状态 */
      sellMode: false,
      deployMode: false,
      inspected: null,
      hover: { col: -1, row: -1, valid: false },

      /* ---------------------------------------------------------
         玩家侧的只读别名。界面层（hud / scene / input）和 dev 工具
         关心的是「玩家这一方」，写 state.money 比 state.sides.player.money
         好读得多。这里是 getter 直接返回那个活数组 / 活对象，
         不是拷贝，所以不存在「改了不同步」的坑。
         逻辑层（battle / field / economy）一律走 state.sides，不用别名。
         --------------------------------------------------------- */
      get money() { return this.sides.player.money; },
      set money(v) { this.sides.player.money = v; },
      get totalPower() { return this.sides.player.totalPower; },
      get usedPower() { return this.sides.player.usedPower; },
      get lowPower() { return this.sides.player.lowPower; },
      get base() { return this.sides.player.base; },
      get defenders() { return this.sides.player.units; },
      get enemies() { return this.sides.enemy.units; },
    };

    /* 玩家侧的资金与开局电力沿用旧字段名，界面和工具都读这里 */
    const p = state.sides.player;
    p.money = HJ.Config.START_MONEY;
    if (map.mode === 'defense') {
      p.posture = 'hold';
      state.sides.enemy.posture = 'push';
    } else {
      p.money = HJ.Config.SKIRMISH_MONEY;
      state.sides.enemy.money = HJ.Config.SKIRMISH_MONEY;
      state.sides.enemy.ai = HJ.AI ? HJ.AI.createBrain() : { clock: 0, deployClock: 2, attackClock: 0 };
      for (const sideId in state.sides) {
        const start = map.starts && map.starts[sideId];
        if (start) HJ.State.spawn(state, sideId, 'mcv', start.col, start.row);
      }
    }

    /* 画布尺寸、相机范围都由 view 层自己按 state.map 算，逻辑层不碰像素 */
    HJ.Field.dirty = true;
    return state;
  },

  makeSide(id, map) {
    return {
      id: id,
      units: [],
      queue: [],
      base: HJ.Map.baseOf(map, id),

      /* 经济。遭遇战两侧都用；塔防的 enemy 这份是摆设 */
      money: 0,
      totalPower: 0,
      usedPower: 0,
      lowPower: false,

      /* 'hold' 守着驻扎点打；'push' 顺流场往对方基地推 */
      posture: 'hold',
      ai: null,
    };
  },

  /* ---------------- 侧查询 ---------------- */

  side(state, id) {
    return state.sides[id];
  },

  foeSideId(side) {
    return side === 'player' ? 'enemy' : 'player';
  },

  /** 这一侧的所有存活实体（目标搜索用） */
  unitsOf(state, side) {
    return state.sides[side].units;
  },

  /* ---------------- 生成 ---------------- */

  /**
   * 按 HJ.Units 生成一个实体（建筑或兵种），放进指定侧。
   * col/row 是左上角格子，建筑占 size×size。
   */
  spawn(state, side, defId, col, row) {
    const d = HJ.Units[defId];
    if (!d) return null;
    return this.place(state, side, d, col, row);
  },

  /**
   * 按任意 spec 生成（波次敌人用 HJ.Enemies 的表，字段同构）。
   * @param {object} pos {x,y} 连续出生中心点，或 {col,row} 左上角格
   */
  spawnFrom(state, side, spec, pos) {
    if (pos && pos.x !== undefined) {
      /* 出生点加一点随机偏移，否则同批敌人会完全叠在一起 */
      return this.place(state, side, spec,
        pos.x - 0.5 + HJ.Utils.rand(-0.35, 0.35),
        pos.y - 0.5 + HJ.Utils.rand(-0.35, 0.35));
    }
    return this.place(state, side, spec, (pos && pos.col) || 0, (pos && pos.row) || 0);
  },

  /**
   * 真正的造实体。spec 可以是 HJ.Units 项、HJ.Enemies 项，或 MCV 之类的自定义数据。
   * col/row 允许带小数（波次出生点就是连续坐标），占地仍按取整后的格子算。
   */
  place(state, side, spec, col, row) {
    const size = spec.size || 1;
    const kind = spec.kind || (spec.armor === 'none' ? 'infantry' : 'vehicle');
    const isBuilding = kind === 'building';

    const u = {
      uid: ++this.uid,
      side: side,
      defId: spec.id,
      name: spec.name,
      kind: kind,
      isBuilding: isBuilding,
      size: size,

      /* 移动类别决定它走哪个流场：步兵能爬的地方车不行（P2 生效） */
      moveClass: kind === 'infantry' ? 'foot' : 'track',

      col: Math.floor(col),
      row: Math.floor(row),
      x: col + size / 2,
      y: row + size / 2,

      /* 驻扎点：出击之后靠它回家 */
      homeX: col + size / 2,
      homeY: row + size / 2,

      hp: spec.hp,
      maxHp: spec.hp,
      armor: spec.armor,
      power: spec.power || 0,
      cost: spec.cost || 0,
      bounty: spec.bounty || 0,

      range: spec.range || 0,
      damage: spec.damage || 0,
      rof: spec.rof || 0,
      warhead: spec.warhead || 'SA',
      canAttack: !!spec.damage,

      leash: spec.leash || 0,
      speed: spec.speed || 0,
      canMove: !isBuilding && (spec.speed || 0) > 0,

      /* 行为姿态：默认跟随所属侧，单兵命令可以覆盖 */
      posture: state.sides[side].posture,

      cd: HJ.Utils.rand(0, 0.4),
      retarget: 0,
      level: 0,
      kills: 0,
      alive: true,
      target: null,
      breaching: null,

      color: spec.color,
      icon: spec.icon,
      radius: spec.radius,
      tags: spec.tags,
      deployable: !!spec.deployable,
    };

    state.sides[side].units.push(u);

    if (u.isBuilding) {
      for (let r = Math.floor(row); r < Math.floor(row) + size; r++) {
        for (let c = Math.floor(col); c < Math.floor(col) + size; c++) {
          state.occupied.set(c + ',' + r, u);
        }
      }
      HJ.Field.markDirty();
    }

    return u;
  },

  /* ---------------- 语义化包装 ---------------- */

  /** 给玩家侧造一个东西（建筑或兵）。col/row 是左上角格 */
  spawnDefender(state, defId, col, row) {
    return this.spawn(state, 'player', defId, col, row);
  },

  /**
   * 塔防波次生成一个敌人。
   * @param {string|number|object} entrance 入口 id、下标，或直接给 {x,y} 出生点
   */
  spawnEnemy(state, enId, entrance, scale) {
    const base = HJ.Enemies[enId];
    if (!base) return null;
    const k = scale || 1;
    const spec = k === 1 ? base : {
      ...base,
      hp: Math.round(base.hp * k),
      damage: Math.round(base.damage * (1 + (k - 1) * 0.65)),
      bounty: Math.round(base.bounty * k),
    };

    let pos;
    if (entrance && typeof entrance === 'object' && entrance.x !== undefined) {
      pos = entrance;
    } else {
      const ent = typeof entrance === 'string'
        ? HJ.Map.entranceById(state.map, entrance)
        : state.map.entrances[entrance || 0];
      if (!ent) return null;
      pos = { x: ent.col + 0.5, y: ent.row + 0.5 };
    }

    return this.spawnFrom(state, 'enemy', spec, pos);
  },

  /* ---------------- 查询 ---------------- */

  /** 场上是否已有某种建筑（兵营被拆了这里立刻 false → 造不出兵） */
  hasBuilding(state, defId, side) {
    const s = side || 'player';
    for (const u of state.sides[s].units) {
      if (u.isBuilding && u.alive && u.defId === defId) return true;
    }
    return false;
  },

  /** 该侧基地是否已被摧毁 */
  baseAlive(state, side) {
    const b = state.sides[side].base;
    return !!b && b.alive;
  },
};
