/* ============================================================
   main.js — 入口与主循环
   ------------------------------------------------------------
   采用「固定步长 + 渲染解耦」：
     逻辑永远以 1/60 秒为单位推进，跟显示器刷新率无关。
     这样 2 倍速只是多算几步，不会改变战斗结果，
     将来做自走棋的确定性回放也靠这个。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Game = {
  state: null,
  acc: 0,
  last: 0,
  running: false,
  mode: HJ.Config.DEFAULT_MODE,
  mapId: HJ.Config.DEFAULT_MAP,

  boot() {
    const canvas = document.getElementById('game');
    HJ.Scene.init(canvas);
    const params = new URLSearchParams(location.search);
    if (params.has('demo')) {
      this.mode = HJ.Config.MODES[params.get('mode')] ? params.get('mode') : HJ.Config.DEFAULT_MODE;
      this.mapId = params.get('map') || (this.mode === 'skirmish' ? 'steelCrossing' : HJ.Config.DEFAULT_MAP);
      this.start(this.mode, this.mapId);
    } else {
      this.showTitle();
    }
    this.last = performance.now();
    this.running = true;
    requestAnimationFrame((t) => this.frame(t));

    /* 浏览器不允许无交互自动播放：等玩家第一次点一下或按个键再把音频打开 */
    const unlock = () => {
      if (HJ.Sfx) HJ.Sfx.init();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  },

  start(mode, mapId) {
    this.mode = mode;
    const map = HJ.Maps[mapId] || this.firstMap(mode);
    document.getElementById('app').classList.remove('title-open');
    document.getElementById('title-screen').classList.add('hidden');
    this.newGame(map.id);
  },

  firstMap(mode) {
    for (const id in HJ.Maps) {
      const map = HJ.Maps[id];
      if (mode === 'skirmish' ? map.mode === 'skirmish' : map.mode === 'defense') return map;
    }
    return HJ.Maps[HJ.Config.DEFAULT_MAP];
  },

  showTitle() {
    if (this.state && HJ.Input.state) HJ.Input.clearCommand();
    this.state = null;
    HJ.HUD.state = null;
    if (HJ.Sfx) {
      HJ.Sfx.clearDelayed();
      HJ.Sfx.stopBGM();
    }
    document.getElementById('gameover').classList.add('hidden');
    document.getElementById('app').classList.add('title-open');
    document.getElementById('title-screen').classList.remove('hidden');
    HJ.HUD.buildTitle();
  },

  newGame(mapId) {
    const id = mapId || this.mapId || HJ.Config.DEFAULT_MAP;
    const map = HJ.Maps[id];
    this.mapId = id;
    if ((this.mode === 'skirmish') !== (map.mode === 'skirmish')) {
      this.mode = map.mode === 'skirmish' ? 'skirmish' : HJ.Config.DEFAULT_MODE;
    }
    if (HJ.Sfx) HJ.Sfx.clearDelayed();
    const state = HJ.State.create({ map, mode: this.mode });
    this.state = state;
    this.acc = 0;
    if (HJ.Input.state) HJ.Input.clearCommand();

    /* 开局送一座电厂，让玩家第一步就能造兵营。
       放在基地正上方 —— 现在敌人从三面来，玩家第一件要想的事就是"电厂放哪" */
    if (state.map.mode === 'defense') {
      const start = state.map.start || { powerplant: { col: 17, row: 15 } };
      HJ.State.spawnDefender(state, 'powerplant', start.powerplant.col, start.powerplant.row);
      HJ.Economy.updatePower(state);
    }

    HJ.HUD.init(state);
    HJ.Input.attach(state);

    /* 结算时 BGM 被停掉了，重开要接上。
       还没交互过的时候 Sfx 没 ready，startBGM 自己会跳过 */
    if (HJ.Sfx) HJ.Sfx.startBGM();

    /* 重置顶栏按钮状态 */
    document.getElementById('btn-pause').textContent = '暂停';
    document.getElementById('btn-pause').classList.remove('active');
    document.getElementById('btn-speed').textContent = '1×';
    document.getElementById('btn-speed').classList.remove('active');
    HJ.Scene.draw(state);
    if (mapId) HJ.HUD.toast('已切换至「' + state.map.name + '」');

    /* 开发用：地址栏加 ?demo 会直接摆一排兵并立刻开波，
       用来快速检查渲染效果，不影响正常游玩 */
    if (location.search.indexOf('demo') >= 0) this.demo(state);
  },

  demo(state) {
    if (state.mode === 'skirmish') {
      for (const sideId in state.sides) {
        const mcv = state.sides[sideId].units.find(u => u.defId === 'mcv');
        const start = state.map.starts[sideId];
        HJ.Economy.deployMCV(state, mcv, start.col, start.row);
        HJ.State.spawn(state, sideId, 'rhino', start.col + 5, start.row + 1);
        HJ.State.spawn(state, sideId, 'gi', start.col + 5, start.row + 3);
      }
      HJ.Economy.updatePower(state);
      HJ.Scene.draw(state);
      return;
    }
    const layout = state.map.demo || [
      ['rhino', 10, 8], ['rhino', 13, 8], ['rhino', 22, 8], ['rhino', 25, 8],
      ['gi', 15, 12], ['gi', 18, 12], ['gi', 21, 12],
      ['prismtower', 14, 15], ['pillbox', 21, 15],
      ['tanya', 17, 13], ['apocalypse', 19, 14],
    ];
    for (const [id, col, row] of layout) {
      if (HJ.Economy.isCellFree(state, col, row, HJ.Units[id].size || 1)) {
        HJ.State.spawnDefender(state, id, col, row);
      }
    }
    HJ.Economy.updatePower(state);
    state.prepTimer = 0.5;

    /* 无头截图时 rAF 不会推进，这里手动快进 14 秒，
       让画面停在敌人走进阵地、双方交火的那一刻 */
    const T = HJ.Config.TICK;
    for (let i = 0; i < 60 * 26; i++) {
      HJ.Wave.update(state, T);
      HJ.Economy.update(state, T);
      HJ.Economy.updatePower(state);
      HJ.Battle.step(state, T);
    }
    HJ.Scene.draw(state);

    /* 开发用：?build 展示 3×3 建筑的占格预览，?flow 打开流场热力图 */
    if (location.search.indexOf('build') >= 0) {
      state.selected = 'warfactory';
      state.hover.col = 21;
      state.hover.row = 9;
      state.hover.valid = HJ.Economy.isCellFree(state, 21, 9, 3);
      HJ.Scene.draw(state);
    }
    if (location.search.indexOf('flow') >= 0) {
      HJ.Config.GRID_DEBUG = true;
      HJ.Scene.draw(state);
    }
    /* ?cmd 演示"选中单位 + 指定新阵地"的界面 */
    if (location.search.indexOf('cmd') >= 0) {
      const u = state.defenders.find(x => x.alive && x.canMove);
      if (u) {
        state.selectedUnit = u;
        u.homeX = 24.5;
        u.homeY = 17.5;
        state.hover.col = 22;
        state.hover.row = 15;
        state.hover.valid = true;
        HJ.Scene.draw(state);
      }
    }
    /* ?fx 把五种武器特效并排画一遍，用来检查手感（开发用） */
    if (location.search.indexOf('fx') >= 0) {
      const mk = (y, warhead, big, prog) => ({
        x1: 5, y1: y, x2: 11, y2: y,
        warhead, side: 'player', big: !!big,
        t: prog * 0.34, max: 0.34,
      });
      state.effects = [
        mk(3, 'SA', false, 0.3),
        mk(6, 'AP', true, 0.2),
        mk(9, 'PRISM', false, 0.25),
        mk(12, 'TESLA', false, 0.25),
        mk(15, 'HERO', false, 0.3),
      ];
      HJ.Scene.draw(state);
    }
  },

  restart() {
    this.newGame();
    HJ.HUD.toast(this.mode === 'skirmish' ? '展开 MCV，摧毁敌方基地'
      : this.mode === 'endless' ? '无尽防守，坚持到最后一刻' : '第 ' + HJ.Waves.length + ' 波，守住基地');
  },

  /* ---------------- 主循环 ---------------- */

  frame(now) {
    if (!this.running) return;

    const state = this.state;
    let raw = (now - this.last) / 1000;
    this.last = now;

    /* 切后台回来时 raw 会很大，钳一下避免一次性补算太多 */
    raw = Math.min(raw, 0.25);

    if (state && !state.paused && !state.over) {
      this.acc += raw * state.speed;

      let steps = 0;
      while (this.acc >= HJ.Config.TICK && steps < HJ.Config.MAX_STEPS * 2) {
        this.step(HJ.Config.TICK);
        this.acc -= HJ.Config.TICK;
        steps++;
      }
    }

    if (state) {
      HJ.Scene.draw(state);
      HJ.HUD.update();
    }

    requestAnimationFrame((t) => this.frame(t));
  },

  step(dt) {
    const state = this.state;
    state.time += dt;

    HJ.Wave.update(state, dt);
    HJ.Economy.update(state, dt);
    HJ.Economy.updatePower(state);
    HJ.AI.update(state, dt);
    HJ.Battle.step(state, dt);
  },
};

window.addEventListener('DOMContentLoaded', () => HJ.Game.boot());
