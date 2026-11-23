/* ============================================================
   input.js — 指针交互（鼠标 + 触屏同一套）
   ------------------------------------------------------------
   鼠标：悬停出预览，左键放置/选中，右键取消或拆除，键盘平移缩放。
   触屏：单指拖 = 平移，单指轻点 = 鼠标左键，双指捏合 = 整数倍缩放。

   ★ 点还是拖，只看位移阈值：手指按下必然先动一点点，
     用「抬起时累计位移是否超过阈值」区分，而不是猜用户想干什么。
   ★ 一旦第二根手指落下，这一轮所有手指都不要再产生点击，
     否则捏合收尾时会在地图上盖一个建筑。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Input = {
  state: null,
  canvas: null,
  bound: false,

  /* 判定「拖」的位移阈值（CSS 像素，够大到不会误判，够小到不影响轻点） */
  TAP_SLOP: 9,

  pointers: null,   // pointerId -> { x, y, ox, oy, moved }，坐标是画布内部设备像素
  pinch: null,
  multiTouch: false,

  /**
   * 事件只在第一次绑一次。重开游戏时只换 state，不重复绑定，
   * 否则一次点击会被触发好几次。
   */
  attach(state) {
    this.state = state;
    if (this.bound) return;
    this.bound = true;
    this.pointers = new Map();

    const canvas = document.getElementById('game');
    this.canvas = canvas;

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onRightClick(e);
    });

    document.addEventListener('keydown', (e) => this.onKey(e));

    this.bindPointer(canvas);
    this.bindButtons();
  },

  bindButtons() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('btn-mute', () => this.toggleMute());
    on('btn-pause', () => this.togglePause());
    on('btn-speed', () => this.toggleSpeed());
    on('btn-restart', () => HJ.Game.restart());
    on('btn-again', () => HJ.Game.restart());

    /* 手机上的指挥按钮：没有右键和 Esc，得给个能按的地方 */
    on('cmd-cancel', () => {
      this.clearCommand();
      HJ.HUD.update(true);
    });
    on('cmd-same', () => this.selectSameType());
    on('cmd-home', () => this.focusBase());
  },

  /* ---------------- 指针 ---------------- */

  /** 客户端坐标 → 画布内部设备像素（画布被 CSS 缩放过，不能直接用） */
  local(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return HJ.View.fromCss(clientX - rect.left, clientY - rect.top);
  },

  bindPointer(canvas) {
    const P = this.pointers;

    canvas.addEventListener('pointerdown', (e) => {
      /* 右键交给 contextmenu，中键不管 */
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      /* contextmenu 事件里没有 pointerType，只能记住最后一次是用什么碰的画布 */
      this.lastPointer = e.pointerType;
      const p = this.local(e.clientX, e.clientY);
      P.set(e.pointerId, { x: p.x, y: p.y, ox: p.x, oy: p.y, moved: false });

      if (P.size === 2) this.beginPinch();
      if (P.size > 1) this.multiTouch = true;

      /* 抓住指针：手指滑出画布也要继续算这一笔，不然松手时收不到事件 */
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
      if (e.pointerType !== 'mouse') e.preventDefault();
    });

    canvas.addEventListener('pointermove', (e) => {
      const rec = P.get(e.pointerId);
      const p = this.local(e.clientX, e.clientY);

      /* 只有鼠标有"悬停"这个状态，手指不在地图上留预览 */
      if (e.pointerType === 'mouse' && P.size === 0) this.hoverAt(p);
      if (!rec) return;

      const dx = p.x - rec.x, dy = p.y - rec.y;
      rec.x = p.x;
      rec.y = p.y;
      const slop = this.TAP_SLOP * HJ.View.dpr;
      if (!rec.moved && Math.hypot(p.x - rec.ox, p.y - rec.oy) > slop) rec.moved = true;

      if (P.size >= 2) { this.updatePinch(); return; }
      if (rec.moved) HJ.View.panBy(dx, dy);
    });

    const release = (e) => {
      const rec = P.get(e.pointerId);
      if (!rec) return;
      P.delete(e.pointerId);
      if (P.size < 2) this.pinch = null;
      if (P.size === 0) {
        /* 第二根手指一旦出现过，这一轮的所有抬手都不算点击 */
        if (!rec.moved && !this.multiTouch) this.tapAt({ x: rec.x, y: rec.y });
        this.multiTouch = false;
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('mouseleave', () => {
      if (!this.state) return;
      this.state.hover.col = -1;
      this.state.hover.row = -1;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.local(e.clientX, e.clientY);
      HJ.View.zoomStep(e.deltaY < 0 ? 1 : -1, p.x, p.y);
    }, { passive: false });
  },

  /* ---------------- 相机手势 ---------------- */

  beginPinch() {
    const it = Array.from(this.pointers.values());
    const a = it[0], b = it[1];
    this.pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: HJ.View.zoom,
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
  },

  /**
   * 双指：中点移动 = 平移，指间距变化 = 缩放。
   * zoom 只允许整数，所以捏合是"到档位才跳一格"，不会半糊不糊。
   * 缩放以中点为锚，按住的地方不会漂走。
   */
  updatePinch() {
    if (!this.pinch) this.beginPinch();
    const it = Array.from(this.pointers.values());
    if (it.length < 2) return;
    const a = it[0], b = it[1];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;

    HJ.View.panBy(mx - this.pinch.mx, my - this.pinch.my);
    HJ.View.setZoom(this.pinch.zoom * dist / this.pinch.dist, mx, my);

    this.pinch.mx = mx;
    this.pinch.my = my;
  },

  focusBase() {
    const s = this.state;
    HJ.View.setMap(s.map, 'player');
    HJ.HUD.toast('回到基地');
  },

  /* ---------------- 坐标与选中 ---------------- */

  /** 画布内像素 → 格子坐标 */
  cellAt(p) {
    const w = HJ.View.toWorld(p.x, p.y);
    return { col: Math.floor(w.x), row: Math.floor(w.y) };
  },

  hoverAt(p) {
    const { col, row } = this.cellAt(p);
    this.setHover(col, row);
  },

  setHover(col, row) {
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
      /* 指挥移动：目标格不能被建筑或任何一侧的基地占着 */
      s.hover.valid = !HJ.Map.occupant(s, col, row) && !HJ.Map.overlapsAnyBase(s.map, col, row, 1);
    } else {
      s.hover.valid = false;
    }
  },

  /* ---------------- 轻点 / 左键 ---------------- */

  tapAt(p) {
    const s = this.state;
    if (s.over) return;

    const { col, row } = this.cellAt(p);
    if (col < 0 || row < 0 || col >= s.map.cols || row >= s.map.rows) return;

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

    /* ---- 优先级 2：已经选中单位，这一下是指定新阵地 ---- */
    if (s.selectedUnit) {
      const squad = this.squad();
      if (!squad.length) {
        this.clearCommand();
        return;
      }
      if (HJ.Map.occupant(s, col, row) || HJ.Map.overlapsAnyBase(s.map, col, row, 1)) {
        HJ.HUD.toast('那里放不下', true);
        return;
      }

      const leader = s.selectedUnit;
      /* 全队开往同一点，靠行走时的分离力散开；领队负责取消选择 */
      for (const m of squad) {
        m.homeX = col + 0.5;
        m.homeY = row + 0.5;
      }
      const msg = squad.length > 1 ? squad.length + ' 个单位换防' : (leader.name || '单位') + ' 换防';
      this.clearCommand();
      HJ.HUD.toast(msg);
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
      this.selectUnit(hit[0], null);
      HJ.HUD.toast(hit[0].name + '：点地图指定新阵地');
    } else {
      this.clearCommand();
    }
    HJ.HUD.update(true);
  },

  /* ---------------- 指挥小队 ---------------- */

  /** 当前被指挥的单位：领队 + 「全选同类」进来的同伴 */
  squad() {
    const s = this.state;
    if (!s.selectedUnit || !s.selectedUnit.alive) return [];
    const list = (s.squad || []).filter(u => u.alive && u.canMove);
    return list.length ? list : [s.selectedUnit];
  },

  selectUnit(u, companions) {
    const s = this.state;
    s.selectedUnit = u;
    s.selected = null;
    s.squad = companions || [u];
  },

  clearCommand() {
    const s = this.state;
    s.selected = null;
    s.selectedUnit = null;
    s.squad = [];
  },

  /**
   * 全选同类：手机上没有拖框多选，用「选一个 → 按同类」把同型号全收进指挥。
   * 没选中单位时相当于「全选所有能动的」，方便一键把防线整体后撤。
   */
  selectSameType() {
    const s = this.state;
    const pool = s.defenders.filter(u => u.alive && u.canMove);
    if (!pool.length) {
      HJ.HUD.toast('场上没有可指挥的单位', true);
      return;
    }
    const leader = (s.selectedUnit && s.selectedUnit.alive) ? s.selectedUnit : null;
    const squad = leader ? pool.filter(u => u.defId === leader.defId) : pool;
    this.selectUnit(leader || squad[0], squad);
    HJ.HUD.toast('已选 ' + squad.length + ' 个' + (leader ? leader.name : '单位') + '：点地图指定新阵地');
    HJ.HUD.update(true);
  },

  onRightClick(e) {
    const s = this.state;

    /* 触屏长按也会派生 contextmenu，那是"我想看看这是什么"，
       不是"帮我把这座建筑拆了" */
    if (this.lastPointer && this.lastPointer !== 'mouse') return;

    if (s.selected) {
      s.selected = null;
      HJ.HUD.update(true);
      return;
    }

    /* 选中单位时，右键是"取消"，不是"拆掉它" —— 这个必须分清，
       否则玩家想取消选择却把自己人拆了 */
    if (s.selectedUnit) {
      this.clearCommand();
      HJ.HUD.update(true);
      return;
    }

    const { col, row } = this.cellAt(this.local(e.clientX, e.clientY));

    /* 建筑可能占好几格，点哪一格都要能拆到它 */
    let target = HJ.Map.occupant(s, col, row);
    if (!target) {
      target = s.defenders.find(u => u.alive && !u.isBuilding && u.col === col && u.row === row);
    }

    if (target) {
      /* occupied 表里两侧的建筑都有，右键只能拆自己的 */
      if (target.side !== 'player') {
        HJ.HUD.toast('那是对方的建筑', true);
        return;
      }
      const back = Math.floor(target.cost * HJ.Config.SELL_RATE);
      HJ.Economy.demolish(s, target);
      HJ.HUD.toast('已拆除 ' + target.name + '（返还 ' + back + '）');
      HJ.HUD.update(true);
    }
  },

  onKey(e) {
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePause();
      return;
    }
    if (e.code === 'Escape') {
      this.clearCommand();
      HJ.HUD.update(true);
      return;
    }
    if (e.code === 'KeyF') {
      HJ.Config.GRID_DEBUG = !HJ.Config.GRID_DEBUG;
      HJ.HUD.toast(HJ.Config.GRID_DEBUG ? '流场显示：开' : '流场显示：关');
      return;
    }
    /* 地图比屏幕大，键盘也能推着看 */
    const PAN = 96 * HJ.View.dpr;
    if (e.code === 'ArrowLeft') { HJ.View.panBy(PAN, 0); return; }
    if (e.code === 'ArrowRight') { HJ.View.panBy(-PAN, 0); return; }
    if (e.code === 'ArrowUp') { HJ.View.panBy(0, PAN); return; }
    if (e.code === 'ArrowDown') { HJ.View.panBy(0, -PAN); return; }
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { HJ.View.zoomStep(1, HJ.View.vw / 2, HJ.View.vh / 2); return; }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') { HJ.View.zoomStep(-1, HJ.View.vw / 2, HJ.View.vh / 2); return; }
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
