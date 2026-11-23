/* ============================================================
   view.js — 相机 + 坐标投影（平面正交俯视）
   ------------------------------------------------------------
   逻辑层全是正交格子（col/row），只有这一层知道它们怎么变成像素。
   相机也住在这里：scene / input 一律问 View，自己不乘任何倍率。

   ★ 设备像素制
     画布内部分辨率 = CSS 尺寸 × 整数 dpr，所有绘制直接写在设备像素上，
     ctx 不做额外缩放。这样一次缩放满足两个要求：
       · 像素图放大倍数 = zoom × dpr，是整数 → 最近邻放大不会糊
       · 手机上不必再用 CSS 拉伸画布，边框/文字都按真实像素走
     dpr 取整（1/2/3），非整数 dpr（1.25 之类）会让像素宽窄不一，宁可舍一点清晰度。

   ★ 一格 = ART 个「美术像素」
     ART 是图集里每个精灵的边长，也是地形 tile 的边长。
     屏幕上一格占多少 = ART × zoom × dpr。
     zoom 只允许整数倍，保证像素对齐。

   还是那个硬规则：不做等距/2.5D。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.View = {
  /* 一格的美术像素数（图集单元 / 地形 tile 边长） */
  ART: 24,

  MIN_ZOOM: 1,
  MAX_ZOOM: 3,

  /* 相机状态：视口中心的世界坐标（格）+ 整数缩放 */
  x: 0,
  y: 0,
  zoom: 1,

  /* 画布内部分辨率（设备像素）与像素比 */
  vw: 0,
  vh: 0,
  dpr: 1,

  canvas: null,
  map: null,

  /* ---------------- 挂载与尺寸 ---------------- */

  attach(canvas) {
    this.canvas = canvas;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  /* 画布铺满它的容器，内部分辨率按整数 dpr 放大 */
  resize() {
    const cv = this.canvas;
    if (!cv) return;

    const parent = cv.parentElement;
    const cssW = Math.max(1, (parent ? parent.clientWidth : cv.clientWidth) || 640);
    const cssH = Math.max(1, (parent ? parent.clientHeight : cv.clientHeight) || 480);

    const raw = window.devicePixelRatio || 1;
    this.dpr = Math.min(3, Math.max(1, Math.round(raw)));

    this.vw = Math.floor(cssW * this.dpr);
    this.vh = Math.floor(cssH * this.dpr);
    cv.width = this.vw;
    cv.height = this.vh;
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';

    this.clamp();
  },

  /** 屏幕上一格占多少设备像素 */
  cell() {
    return this.ART * this.zoom * this.dpr;
  },

  /* ---------------- 相机 ---------------- */

  /** 换图：把视口摆到本方基地，缩放到能看清周围 */
  setMap(map, focusSide) {
    this.map = map;
    const b = (focusSide && map.bases[focusSide]) || map.bases.player || null;
    if (b) {
      this.x = b.col + b.w / 2;
      this.y = b.row + b.h / 2;
    } else {
      this.x = map.cols / 2;
      this.y = map.rows / 2;
    }
    this.clamp();
  },

  /* 允许把视口推到地图外一点，但不要把基地推出屏幕 */
  clamp() {
    const map = this.map;
    if (!map) return;
    const c = this.cell();
    const halfW = this.vw / 2 / c;
    const halfH = this.vh / 2 / c;

    if (map.cols <= halfW * 2) this.x = map.cols / 2;
    else this.x = HJ.Utils.clamp(this.x, halfW, map.cols - halfW);

    if (map.rows <= halfH * 2) this.y = map.rows / 2;
    else this.y = HJ.Utils.clamp(this.y, halfH, map.rows - halfH);
  },

  /** 平移：dx/dy 是设备像素，拖动地图用 */
  panBy(dx, dy) {
    const c = this.cell();
    this.x -= dx / c;
    this.y -= dy / c;
    this.clamp();
  },

  /**
   * 以屏幕上某点为锚缩放（捏合时用：手指按住的地方不许漂走）。
   * @param {number} nextZoom 目标 zoom，会被取整并夹在范围内
   */
  setZoom(nextZoom, sx, sy) {
    const z = HJ.Utils.clamp(Math.round(nextZoom), this.MIN_ZOOM, this.MAX_ZOOM);
    if (z === this.zoom) return;
    const before = this.toWorld(sx, sy);
    this.zoom = z;
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  },

  zoomStep(dir, sx, sy) {
    this.setZoom(this.zoom + dir, sx, sy);
  },

  /* ---------------- 投影 ---------------- */

  /** 世界坐标（格，可带小数）→ 画布内像素 */
  toScreen(wx, wy) {
    const c = this.cell();
    return { x: (wx - this.x) * c + this.vw / 2, y: (wy - this.y) * c + this.vh / 2 };
  },

  /** 画布内像素 → 世界坐标（拾取用）。入参要先换算成内部像素 */
  toWorld(sx, sy) {
    const c = this.cell();
    return { x: (sx - this.vw / 2) / c + this.x, y: (sy - this.vh / 2) / c + this.y };
  },

  /** CSS 像素（getBoundingClientRect 坐标系）→ 画布内像素 */
  fromCss(cssX, cssY) {
    const cv = this.canvas;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return { x: cssX * (cv.width / rect.width), y: cssY * (cv.height / rect.height) };
  },

  /* 一格的四个角：左上 → 右上 → 右下 → 左下 */
  corners(col, row, size) {
    const c = this.cell();
    const s = size || 1;
    const p = this.toScreen(col, row);
    return [
      { x: p.x, y: p.y },
      { x: p.x + s * c, y: p.y },
      { x: p.x + s * c, y: p.y + s * c },
      { x: p.x, y: p.y + s * c },
    ];
  },

  /* 一笔描出多边形（不自动 fill/stroke，调用方决定） */
  poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  },

  /* 世界方向 → 屏幕角度。平面正交下就是 atan2 本身，没有翻转 */
  angle(dx, dy) {
    return Math.atan2(dy, dx);
  },

  /* 格子中心的屏幕坐标 */
  cellCenter(col, row) {
    return this.toScreen(col + 0.5, row + 0.5);
  },

  /* 一堆格子的整体矩形（建造预览、建筑占地用） */
  box(col, row, size) {
    const c = this.cell();
    const s = size || 1;
    const p = this.toScreen(col, row);
    return { x: p.x, y: p.y, w: s * c, h: s * c, cx: p.x + s * c / 2, cy: p.y + s * c / 2 };
  },

  /* ---------------- 视口裁剪 ---------------- */

  /** 这一帧看得见的格子范围（画实体前先筛掉屏幕外的） */
  visibleCells() {
    const a = this.toWorld(0, 0);
    const b = this.toWorld(this.vw, this.vh);
    return {
      c0: Math.floor(a.x) - 1,
      r0: Math.floor(a.y) - 1,
      c1: Math.ceil(b.x) + 1,
      r1: Math.ceil(b.y) + 1,
    };
  },

  /** 静态背景的一次 blit 参数：源矩形取整到美术像素，目标才不会糊 */
  bgBlit() {
    const map = this.map;
    const A = this.ART;
    const c = this.cell();
    const halfW = this.vw / 2 / c;
    const halfH = this.vh / 2 / c;

    const wl = this.x - halfW, wt = this.y - halfH;
    const wr = this.x + halfW, wb = this.y + halfH;

    const sx = Math.max(0, Math.floor(wl * A));
    const sy = Math.max(0, Math.floor(wt * A));
    const ex = Math.min(map.cols * A, Math.ceil(wr * A));
    const ey = Math.min(map.rows * A, Math.ceil(wb * A));

    return {
      sx: sx, sy: sy, sw: Math.max(0, ex - sx), sh: Math.max(0, ey - sy),
      dx: Math.round((sx / A - wl) * c),
      dy: Math.round((sy / A - wt) * c),
      dw: Math.round((ex - sx) / A * c),
      dh: Math.round((ey - sy) / A * c),
      scale: c / A,
    };
  },
};
