/* ============================================================
   input.js — 鼠标与键盘交互
   ------------------------------------------------------------
   左键：放置选中的建筑 / 单位
   右键：取消选择；若没选中，则拆除鼠标指的己方单位
   空格：暂停    Esc：取消选择
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Input = {
  state: null,
  bound: false,

  /**
   * 事件只在第一次绑一次。重开游戏时只换 state，不重复绑定，
   * 否则一次点击会被触发好几次。
   */
  attach(state) {
    this.state = state;
    if (this.bound) return;
    this.bound = true;

    const canvas = document.getElementById('game');

    canvas.addEventListener('mousemove', (e) => this.onMove(e, canvas));
    canvas.addEventListener('mouseleave', () => {
      if (!this.state) return;
      this.state.hover.col = -1;
      this.state.hover.row = -1;
    });
    canvas.addEventListener('click', (e) => this.onClick(e, canvas));
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onRightClick(e, canvas);
    });

    document.addEventListener('keydown', (e) => this.onKey(e));

    document.getElementById('btn-mute').addEventListener('click', () => this.toggleMute());
    document.getElementById('btn-pause').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-speed').addEventListener('click', () => this.toggleSpeed());
    document.getElementById('btn-restart').addEventListener('click', () => HJ.Game.restart());
    document.getElementById('btn-again').addEventListener('click', () => HJ.Game.restart());
  },

  /* 屏幕坐标 → 格子坐标。画布被 CSS 缩放过，先按比例还原到内部分辨率 */
  toCell(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * HJ.Config.W;
    const sy = (e.clientY - rect.top) / rect.height * HJ.Config.H;
    const w = HJ.View.toWorld(sx, sy);
    return { col: Math.floor(w.x), row: Math.floor(w.y) };
  },

  onMove(e, canvas) {
    const { col, row } = this.toCell(e, canvas);
    const s = this.state;

    s.hover.col = col;
    s.hover.row = row;

    if (s.selected) {
      const d = HJ.Units[s.selected];
      const n = d ? (d.size || 1) : 1;
      s.hover.valid = HJ.Economy.isCellFree(s, col, row, n)
        && HJ.Economy.isUnlocked(s, s.selected)
        && HJ.Economy.canAfford(s, s.selected);
    } else if (s.selectedUnit) {
      /* 指挥移动：目标格不能被建筑或基地占着 */
      s.hover.valid = !HJ.Map.occupant(s, col, row) && !HJ.Map.isBaseCell(col, row);
    } else {
      s.hover.valid = false;
    }
  },

  onClick(e, canvas) {
    const s = this.state;
    if (s.over) return;

    const { col, row } = this.toCell(e, canvas);
    if (col < 0 || row < 0 || col >= HJ.Config.COLS || row >= HJ.Config.ROWS) return;

    /* ---- 优先级 1：正在放置建筑 ---- */
    if (s.selected) {
      const res = HJ.Economy.build(s, s.selected, col, row);
      if (!res.ok) {
        HJ.HUD.toast(res.reason, true);
        return;
      }
      /* 钱不够了就自动取消选择，省得一直点 */
      if (!HJ.Economy.canAfford(s, s.selected)) {
        s.selected = null;
      }
      HJ.HUD.update(true);
      return;
    }

    /* ---- 优先级 2：已经选中了某个单位，这一下是在指定的新阵地 ---- */
    if (s.selectedUnit) {
      const u = s.selectedUnit;
      if (!u.alive) {
        s.selectedUnit = null;
        return;
      }
      if (HJ.Map.occupant(s, col, row) || HJ.Map.isBaseCell(col, row)) {
        HJ.HUD.toast('那里放不下', true);
        return;
      }

      u.homeX = col + 0.5;
      u.homeY = row + 0.5;
      s.selectedUnit = null;
      HJ.HUD.toast(u.name + ' 换防');
      HJ.HUD.update(true);
      return;
    }

    /* ---- 优先级 3：点到自己人 → 选中它 ---- */
    const px = col + 0.5;
    const py = row + 0.5;
    const hit = s.defenders.filter(u => u.alive && u.canMove && u.col === col && u.row === row);

    if (hit.length) {
      /* 一格里有好几个就选离点击点最近的那个 */
      hit.sort((a, b) => HJ.Utils.dist2(a.x, a.y, px, py) - HJ.Utils.dist2(b.x, b.y, px, py));
      s.selectedUnit = hit[0];
      HJ.HUD.toast(hit[0].name + '：点地图指定新阵地');
    } else {
      s.selectedUnit = null;
    }
    HJ.HUD.update(true);
  },

  onRightClick(e, canvas) {
    const s = this.state;

    if (s.selected) {
      s.selected = null;
      HJ.HUD.update(true);
      return;
    }

    /* 选中单位时，右键是"取消"，不是"拆掉它" —— 这个必须分清，
       否则玩家想取消选择却把自己人拆了 */
    if (s.selectedUnit) {
      s.selectedUnit = null;
      HJ.HUD.update(true);
      return;
    }

    const { col, row } = this.toCell(e, canvas);

    /* 建筑可能占好几格，点哪一格都要能拆到它 */
    let target = HJ.Map.occupant(s, col, row);
    if (!target) {
      target = s.defenders.find(u => u.alive && !u.isBuilding && u.col === col && u.row === row);
    }

    if (target) {
      const back = Math.floor(target.cost * HJ.Config.SELL_RATE);
      HJ.Economy.demolish(s, target);
      HJ.HUD.toast('已拆除 ' + target.name + '（返还 ' + back + '）');
      HJ.HUD.update(true);
    }
  },

  onKey(e) {
    const s = this.state;

    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePause();
      return;
    }
    if (e.code === 'Escape') {
      s.selected = null;
      s.selectedUnit = null;
      HJ.HUD.update(true);
      return;
    }
    if (e.code === 'KeyF') {
      HJ.Config.GRID_DEBUG = !HJ.Config.GRID_DEBUG;
      HJ.HUD.toast(HJ.Config.GRID_DEBUG ? '流场显示：开' : '流场显示：关');
      return;
    }
    if (e.code === 'KeyR' && e.shiftKey) {
      HJ.Game.restart();
    }
  },

  toggleMute() {
    if (!HJ.Sfx) return;

    /* 第一次点这个按钮时顺便把音频启动起来，
       免得玩家以为"点了没反应" */
    if (!HJ.Sfx.ready) {
      HJ.Sfx.init();
      HJ.HUD.toast('声音已开启');
      return;
    }

    const muted = HJ.Sfx.toggle();
    const btn = document.getElementById('btn-mute');
    btn.textContent = muted ? '静音' : '音效';
    btn.classList.toggle('active', muted);
  },

  togglePause() {
    const s = this.state;
    s.paused = !s.paused;
    document.getElementById('btn-pause').textContent = s.paused ? '继续' : '暂停';
    document.getElementById('btn-pause').classList.toggle('active', s.paused);
  },

  toggleSpeed() {
    const s = this.state;
    s.speed = s.speed === 1 ? 2 : 1;
    document.getElementById('btn-speed').textContent = s.speed + '×';
    document.getElementById('btn-speed').classList.toggle('active', s.speed === 2);
  },
};
