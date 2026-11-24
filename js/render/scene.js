/* ============================================================
   scene.js — Canvas 绘制（平面俯视）
   ------------------------------------------------------------
   只负责「把 state 画出来」，不做任何游戏判断。

   坐标：逻辑层全是正交格子（col/row），这一层通过 HJ.View 换成像素。
   所有像素换算只发生在 view.js 和这里。

   视觉规则（来自美术风格提案，不要随手改）：
     1. 双层结构 —— 物质层有投影和噪点，标注层纯色无投影
     2. 阵营靠形状 —— 玩家圆底座区域、敌方六边形，去色也分得出
     3. 实体与地面明度差 ≥ 30

   静态地形预渲染在离屏 canvas 上，每帧贴图，省性能。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Scene = {
  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');
    /* 背景不在这里画：地图是数据，要等 state.map 才知道尺寸和内容。
       draw() 里发现地图换了就重烘焙一次。 */
    this.bgMap = null;

    /* 精灵图集一次烘完，整局复用。放在相机之前，第一帧就有东西可贴 */
    HJ.Pixel.bake();
    HJ.Pixel.bakeTerrain();

    /* 相机住在 view.js，它自己管画布分辨率和窗口变化 */
    HJ.View.attach(canvas);
  },

  /* 老名字，留给 main 和调试用 */
  fitCanvas() {
    HJ.View.resize();
  },

  /* ---------------- 静态地形 ---------------- */

  /**
   * 整张静态地形烘焙到离屏画布，**按美术像素**画（一格 = View.ART 像素）。
   * 每帧只 blit 看得见的那块，放大交给最近邻，所以地图可以远大于屏幕。
   */
  buildBackground(map) {
    const c = this.bg.getContext('2d');
    const A = HJ.View.ART;
    const W = map.cols * A;
    const H = map.rows * A;
    this.bg.width = W;
    this.bg.height = H;
    this.bgMap = map;
    HJ.View.map = map;

    c.fillStyle = '#10140E';
    c.fillRect(0, 0, W, H);

    /* 地形：直接贴 pixel.js 烘好的 tile（每种地形 4 个变体，按坐标哈希挑）。
       背景画布本身就是美术像素空间，所以 scale = 1，一格 = ART 像素 */
    for (let r = 0; r < map.rows; r++) {
      for (let col = 0; col < map.cols; col++) {
        HJ.Pixel.blitTile(c, HJ.Map.terrainAt(map, col, r), col, r, col * A, r * A, 1);
      }
    }

    /* 淡网格：一格一条 1 美术像素的线，比地形亮一档就够，不能抢实体 */
    c.fillStyle = 'rgba(232, 228, 216, 0.07)';
    for (let col = 0; col <= map.cols; col++) c.fillRect(col * A, 0, 1, H);
    for (let r = 0; r <= map.rows; r++) c.fillRect(0, r * A, W, 1);

    /* 地图边界 */
    c.fillStyle = 'rgba(232, 228, 216, 0.16)';
    c.fillRect(0, 0, W, 1);
    c.fillRect(0, H - 1, W, 1);
    c.fillRect(0, 0, 1, H);
    c.fillRect(W - 1, 0, 1, H);

    /* 入口：朝基地方向画进攻箭头。这些尺寸也是美术像素，跟着 tile 一起缩放 */
    const bc = HJ.Map.baseCenter(map, 'player');
    for (const e of map.entrances) {
      const px = (e.col + 0.5) * A;
      const py = (e.row + 0.5) * A;
      c.save();
      c.translate(px, py);
      c.rotate(Math.atan2(bc.y - e.row - 0.5, bc.x - e.col - 0.5));

      const L = A * 1.9;
      const w = A * 0.54;

      c.beginPath();
      c.moveTo(4, -w * 0.42);
      c.lineTo(L - 14, -w * 0.42);
      c.lineTo(L - 14, -w);
      c.lineTo(L, 0);
      c.lineTo(L - 14, w);
      c.lineTo(L - 14, w * 0.42);
      c.lineTo(4, w * 0.42);
      c.closePath();

      c.fillStyle = 'rgba(166, 59, 50, 0.16)';
      c.fill();
      c.strokeStyle = 'rgba(166, 59, 50, 0.6)';
      c.lineWidth = 1.2;
      c.stroke();
      c.restore();
    }
  },

  /* ---------------- 每帧绘制 ---------------- */

  draw(state) {
    const ctx = this.ctx;

    /* 换图（或第一次画）时重烘焙静态地形并把相机摆回本方基地 */
    if (this.bgMap !== state.map) {
      this.buildBackground(state.map);
      HJ.View.setMap(state.map, 'player');
    }

    const V = HJ.View;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;   // 像素风的命根子：放大必须最近邻

    /* 地图比屏幕小的时候，圈外是空的 —— 填成夜色，别露出画布底 */
    ctx.fillStyle = '#0A0C08';
    ctx.fillRect(0, 0, V.vw, V.vh);

    /* 只贴看得见的那块背景 */
    const b = V.bgBlit();
    if (b.sw > 0 && b.sh > 0) {
      ctx.drawImage(this.bg, b.sx, b.sy, b.sw, b.sh, b.dx, b.dy, b.dw, b.dh);
    }

    this.drawFlow(ctx);
    this.drawRoutePreview(ctx, state);
    this.drawQueue(ctx, state);
    this.drawTracks(ctx, state);
    this.drawEntities(ctx, state);
    this.drawDust(ctx, state);
    this.drawEffects(ctx, state);
    this.drawFloats(ctx, state);
    this.drawPreview(ctx, state);
    this.drawCommand(ctx, state);
    this.drawCommandTarget(ctx, state);
  },

  /* ---------------- 实体排序 ---------------- */
  /* 平面俯视下遮挡关系弱，只按行排一次，保证靠下的建筑不会盖住靠上的单位 */

  drawEntities(ctx, state) {
    /* 地图比屏幕大了，屏幕外的直接不画 */
    const vis = HJ.View.visibleCells();
    const onScreen = (c, r) => c >= vis.c0 && c <= vis.c1 && r >= vis.r0 && r <= vis.r1;

    const list = [];
    for (const sideId in state.map.bases) {
      const base = state.map.bases[sideId];
      if (base && base.alive && onScreen(base.col, base.row)) {
        list.push({ base, depth: base.row + base.h });
      }
    }

    for (const u of state.defenders) {
      if (!u.alive || !onScreen(u.col, u.row)) continue;
      list.push({
        u,
        depth: u.isBuilding ? u.row + (u.size || 1) : u.y,
      });
    }
    for (const e of state.enemies) {
      if (!e.alive || !onScreen(Math.floor(e.x), Math.floor(e.y))) continue;
      list.push({ u: e, depth: e.y });
    }

    list.sort((a, b) => a.depth - b.depth);

    for (const it of list) {
      if (it.base) this.drawBase(ctx, it.base);
      else if (it.u.isBuilding) this.drawBuilding(ctx, it.u);
      else this.drawMobile(ctx, it.u, state);
    }
  },

  /* 一个美术像素等于几个设备像素。一定是整数，否则像素就废了 */
  U() {
    return HJ.View.cell() / HJ.View.ART;
  },

  /* ---------------- 基地 ---------------- */

  drawBase(ctx, b) {
    const box = HJ.View.box(b.col, b.row, b.w);
    const U = this.U();

    HJ.Pixel.stampCentered(ctx, 'bld:base', box.cx, box.cy, U, b.alive ? 1 : 0.55);

    /* 掉血了才画血条，满血时屏幕上少一个噪声 */
    if (b.hp < b.maxHp) {
      this.hpBar(ctx, box.cx - 17 * U, box.y - 3 * U, 34 * U, 2 * U, b.hp / b.maxHp, '#7FBF6A');
    }
  },

  /* ---------------- 建筑 ---------------- */

  drawBuilding(ctx, u) {
    const s = u.size || 1;
    const box = HJ.View.box(u.col, u.row, s);
    const U = this.U();

    const key = HJ.Pixel.buildingKey(u.defId);
    HJ.Pixel.stampCentered(ctx, HJ.Pixel.has(key) ? key : 'bld:pillbox', box.cx, box.cy, U);

    /* 老兵晋升：占地外圈描一层等级色（2 美术像素厚，跟着缩放走） */
    if (u.level > 0) {
      this.pixelFrame(ctx, box.x, box.y, box.w, box.h, U, this.levelColor(u.level));
    }

    if (u.hp < u.maxHp) {
      this.hpBar(ctx, box.cx - 10 * U, box.y - 3 * U, 20 * U, 2 * U, u.hp / u.maxHp, '#7FBF6A');
    }
  },

  /** 一圈整数像素的描边，用来代替 strokeRect（描边会落在半像素上） */
  pixelFrame(ctx, x, y, w, h, U, color, inset) {
    const t = U;                       // 线宽 = 1 美术像素
    const ix = (inset || 0) * U;
    const x0 = Math.round(x - ix), y0 = Math.round(y - ix);
    const x1 = Math.round(x + w + ix), y1 = Math.round(y + h + ix);
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, x1 - x0, t);
    ctx.fillRect(x0, y1 - t, x1 - x0, t);
    ctx.fillRect(x0, y0, t, y1 - y0);
    ctx.fillRect(x1 - t, y0, t, y1 - y0);
  },

  /* ---------------- 移动单位 ---------------- */

  drawMobile(ctx, u, state) {
    const U = this.U();
    const p = HJ.View.toScreen(u.x, u.y);
    const isEnemy = u.side === 'enemy';
    const isVehicle = u.kind === 'vehicle';

    /* 落地影：像素画不用软阴影，脚底一块深色椭圆就够 */
    this.pixelOval(ctx, p.x, p.y + (isVehicle ? 7 : 6) * U,
      isVehicle ? 9 : 5, isVehicle ? 4 : 3, U, 'rgba(11, 13, 10, 0.34)');

    /* 出阵单位在驻扎点留一个小圈，一眼看出它离开了站位 */
    if (!isEnemy && u.canMove && HJ.Utils.dist(u.x, u.y, u.homeX, u.homeY) > 0.2) {
      const hp = HJ.View.toScreen(u.homeX, u.homeY);
      this.pixelRing(ctx, hp.x, hp.y, 4, U, 'rgba(143, 184, 214, 0.45)');
    }

    const dir = HJ.Pixel.moveDir(u);
    HJ.Pixel.stampCentered(ctx, HJ.Pixel.bodyKey(u, dir), p.x, p.y, U);

    /* 炮塔单独一层，所以能「车往一边走、炮往一边瞄」 */
    const tk = HJ.Pixel.turretKey(u, HJ.Pixel.aimDir(u));
    if (tk) HJ.Pixel.stampCentered(ctx, tk, p.x, p.y, U);

    if (u.hp < u.maxHp) {
      const w = (isVehicle ? 10 : 7) * U;
      this.hpBar(ctx, p.x - w / 2, p.y - (isVehicle ? 12 : 10) * U, w, 2 * U,
        u.hp / u.maxHp, isEnemy ? '#E0705A' : '#7FBF6A');
    }
  },

  /* ---------------- 像素几何 ---------------- */
  /* 这一组代替 ctx.arc / ellipse / stroke：所有落点都在整数美术像素上，
     放大倍数是整数（U = zoom × dpr），所以最近邻放大后依然是一颗一颗的方块。
     约定：圆心和线段端点收设备像素（因为来自世界坐标），
     半径、边长这类「多大」的参数一律收美术像素。 */

  /** 块状椭圆：逐行算弦宽，弦宽取整到美术像素 */
  pixelOval(ctx, cx, cy, arw, arh, U, color) {
    ctx.fillStyle = color;
    const x0 = Math.round(cx / U) * U, y0 = Math.round(cy / U) * U;
    const RW = Math.max(1, arw), RH = Math.max(1, arh);
    for (let j = -RH; j < RH; j++) {
      const hw = Math.floor(RW * Math.sqrt(Math.max(0, 1 - (j * j) / (RH * RH))));
      ctx.fillRect(x0 - hw * U, y0 + j * U, hw * 2 * U, U);
    }
  },

  /** 块状空心圈：每 8 度一颗，正好铺成一圈方块 */
  pixelRing(ctx, cx, cy, ar, U, color) {
    ctx.fillStyle = color;
    const x0 = Math.round(cx / U) * U, y0 = Math.round(cy / U) * U;
    const R = Math.max(1, ar);
    for (let a = 0; a < 360; a += 8) {
      const rad = a * Math.PI / 180;
      ctx.fillRect(x0 + Math.round(Math.cos(rad) * R) * U,
                   y0 + Math.round(Math.sin(rad) * R) * U, U, U);
    }
  },

  /** 一段线：Bresenham 铺方块，端点吸到美术像素网格 */
  pixelLine(ctx, x1, y1, x2, y2, U, color) {
    ctx.fillStyle = color;
    let ax = Math.round(x1 / U), ay = Math.round(y1 / U);
    const bx = Math.round(x2 / U), by = Math.round(y2 / U);
    let dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx - dy;
    for (var guard = 0; guard < 6000; guard++) {
      ctx.fillRect(ax * U, ay * U, U, U);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; ax += sx; }
      if (e2 < dx) { err += dx; ay += sy; }
    }
  },

  /** 方括号选框：四角各一个 L，代替圆形选择环 —— 硬规则第四条，标注层不用曲线 */
  brackets(ctx, cx, cy, aw, ah, U, color, arm) {
    const x = Math.round((cx - aw * U / 2) / U) * U;
    const y = Math.round((cy - ah * U / 2) / U) * U;
    const w = aw * U, h = ah * U;
    const len = Math.max(U, arm * U), t = U;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, len, t); ctx.fillRect(x, y, t, len);
    ctx.fillRect(x + w - len, y, len, t); ctx.fillRect(x + w - t, y, t, len);
    ctx.fillRect(x, y + h - t, len, t); ctx.fillRect(x, y + h - len, t, len);
    ctx.fillRect(x + w - len, y + h - t, len, t); ctx.fillRect(x + w - t, y + h - len, t, len);
  },

  /* ---------------- 履带印 ---------------- */

  drawTracks(ctx, state) {
    if (!state.tracks || !state.tracks.length) return;
    const U = this.U();

    /* 履带印是长期保留的地面痕迹，逻辑层只给 {x, y, ang}，
       画成两块压在两侧履带下的接地印，不做衰减 */
    ctx.fillStyle = 'rgba(11, 13, 10, 0.24)';
    for (const t of state.tracks) {
      const p = HJ.View.toScreen(t.x, t.y);
      const ox = -Math.sin(t.ang) * 3 * U, oy = Math.cos(t.ang) * 3 * U;
      ctx.fillRect(Math.round(p.x + ox) - U, Math.round(p.y + oy) - U, 2 * U, 2 * U);
      ctx.fillRect(Math.round(p.x - ox) - U, Math.round(p.y - oy) - U, 2 * U, 2 * U);
    }
  },

  /* ---------------- 扬尘 ---------------- */

  drawDust(ctx, state) {
    if (!state.dust || !state.dust.length) return;
    const U = this.U();

    /* d.r 是美术像素。方块就够了 —— 像素画的烟本来就是一团一团的格子 */
    for (const d of state.dust) {
      const p = HJ.View.toScreen(d.x, d.y);
      const prog = HJ.Utils.clamp(d.t / d.max, 0, 1);
      const r = Math.max(1, Math.round(d.r * (0.6 + prog * 0.9)));
      ctx.globalAlpha = (1 - prog) * 0.4;
      ctx.fillStyle = '#8A8468';
      ctx.fillRect(Math.round(p.x) - r * U, Math.round(p.y) - r * U, r * 2 * U, r * 2 * U);
    }
    ctx.globalAlpha = 1;
  },

  /* ---------------- 流场调试 ---------------- */

  drawFlow(ctx) {
    /* 按 F 打开。画的是最近建立的那个场 —— 也就是敌人实际在走的那个 */
    const f = HJ.Field.debug;
    if (!HJ.Config.GRID_DEBUG || !f) return;

    const G = HJ.View.cell();
    const span = 32;
    const vis = HJ.View.visibleCells();

    for (let r = Math.max(0, vis.r0); r <= Math.min(f.rows - 1, vis.r1); r++) {
      for (let col = Math.max(0, vis.c0); col <= Math.min(f.cols - 1, vis.c1); col++) {
        const d = f.dist[r * f.cols + col];
        if (!isFinite(d)) continue;
        const a = HJ.Utils.clamp(1 - d / span, 0, 1);
        const p = HJ.View.toScreen(col, r);
        ctx.fillStyle = 'rgba(80, 200, 140, ' + (a * 0.24).toFixed(3) + ')';
        ctx.fillRect(p.x, p.y, G, G);
      }
    }
  },

  drawQueue(ctx, state) {
    const U = this.U();
    for (const item of state.sides.player.queue) {
      const d = HJ.Units[item.defId];
      if (!d || d.kind !== 'building' || item.col === undefined) continue;
      const box = HJ.View.box(item.col, item.row, d.size);
      const progress = 1 - Math.max(0, item.remaining) / item.total;
      this.brackets(ctx, box.cx, box.cy, d.size * HJ.View.ART - 2, d.size * HJ.View.ART - 2,
        U, item.remaining > 0 ? '#C9A227' : '#E8A33D', 4);
      this.hpBar(ctx, box.x + 2 * U, box.y + box.h - 4 * U, box.w - 4 * U, 2 * U, progress, '#C9A227');
    }
  },

  /* ---------------- 攻击特效 ---------------- */
  /* 按武器分五种手感：步枪曳光弹、坦克炮口闪光+炮弹+爆炸、
     光棱光束、磁暴电弧、谭雅斩击。
     全部走 snap / pixelLine / pixDot，落点都在美术像素网格上。 */

  /** 特效起点：从炮管口而不是发射体中心出发，否则子弹像从车肚子里长出来的 */
  fxStart(f) {
    const A = HJ.View.ART;
    const dx = f.x2 - f.x1, dy = f.y2 - f.y1;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const padArt = Math.min(f.big ? 10 : 6, (d * A) / 2);
    return HJ.View.toScreen(f.x1 + ux * padArt / A, f.y1 + uy * padArt / A);
  },

  /** 把设备像素吸到美术像素网格上 */
  snap(v, U) {
    return Math.round(v / U) * U;
  },

  /** 一颗方块：r 是美术像素半径 */
  pixDot(ctx, x, y, r, U, color) {
    ctx.fillStyle = color;
    const cx = this.snap(x, U), cy = this.snap(y, U);
    const rr = Math.max(1, r);
    ctx.fillRect(cx - rr * U, cy - rr * U, rr * 2 * U, rr * 2 * U);
  },

  drawEffects(ctx, state) {
    const U = this.U();
    for (const f of state.effects) {
      const prog = HJ.Utils.clamp(f.t / f.max, 0, 1);
      const a0 = this.fxStart(f);
      const a1 = HJ.View.toScreen(f.x2, f.y2);
      const ang = Math.atan2(a1.y - a0.y, a1.x - a0.x);

      switch (f.warhead) {
        case 'AP':
        case 'HE':
          this.fxCannon(ctx, a0.x, a0.y, a1.x, a1.y, ang, prog, f, U);
          break;
        case 'PRISM':
          this.fxBeam(ctx, a0.x, a0.y, a1.x, a1.y, prog, U);
          break;
        case 'TESLA':
          this.fxArc(ctx, a0.x, a0.y, a1.x, a1.y, prog, U);
          break;
        case 'HERO':
          this.fxSlash(ctx, a1.x, a1.y, prog, U);
          break;
        default:
          this.fxRifle(ctx, a0.x, a0.y, a1.x, a1.y, ang, prog, f, U);
      }
    }
  },

  /* 步枪/机枪：一小截曳光弹飞过去，落地是四散的一粒火星 */
  fxRifle(ctx, x1, y1, x2, y2, ang, p, f, U) {
    const color = f.side === 'enemy' ? '#E0705A' : '#F3D98A';

    if (p < 0.55) {
      const k = p / 0.55;
      const px = x1 + (x2 - x1) * k;
      const py = y1 + (y2 - y1) * k;
      this.pixelLine(ctx, px - Math.cos(ang) * 3 * U, py - Math.sin(ang) * 3 * U, px, py, U, color);
      this.pixDot(ctx, px, py, 1, U, '#FFF6D0');
      return;
    }

    const k = (p - 0.55) / 0.45;
    ctx.globalAlpha = 1 - k;
    const reach = (2 + k * 4) * U;
    for (let i = 0; i < 4; i++) {
      const a = ang + (i - 1.5) * 0.55;
      this.pixelLine(ctx, x2, y2, x2 + Math.cos(a) * reach, y2 + Math.sin(a) * reach, U, color);
    }
    ctx.globalAlpha = 1;
  },

  /* 坦克炮：炮口一团方块闪光 → 炮弹飞过去 → 落点炸开一个块圈再收一团火 */
  fxCannon(ctx, x1, y1, x2, y2, ang, p, f, U) {
    if (p < 0.16) {
      const k = 1 - p / 0.16;
      this.pixDot(ctx, x1, y1, 2 + Math.round(3 * k), U,
        'rgba(255, 222, 150, ' + (0.85 * k).toFixed(3) + ')');
      this.pixelLine(ctx, x1, y1,
        x1 + Math.cos(ang) * (5 + 7 * k) * U, y1 + Math.sin(ang) * (5 + 7 * k) * U, U,
        'rgba(255, 236, 180, ' + (0.7 * k).toFixed(3) + ')');
    }

    if (p < 0.62) {
      const k = p / 0.62;
      this.pixDot(ctx, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, f.big ? 2 : 1, U, '#FFE79B');
    }

    if (p > 0.56) {
      const k = (p - 0.56) / 0.44;
      const r = 3 + Math.round(k * (f.big ? 15 : 9));

      ctx.globalAlpha = (1 - k) * 0.9;
      this.pixelRing(ctx, x2, y2, r, U, '#FFB45A');

      ctx.globalAlpha = (1 - k) * 0.55;
      this.pixDot(ctx, x2, y2, Math.max(1, Math.round(r * 0.5)), U, '#FF9B3D');

      ctx.globalAlpha = 1;
    }
  },

  /* 光棱：一道会变色的实心光束，两头各顶一颗亮点 */
  fxBeam(ctx, x1, y1, x2, y2, p, U) {
    const a = 1 - p;
    const phase = Math.floor(p * 11);
    const beamColor = ['#FFFFFF', '#D0ECFF', '#8FC9F0', '#5E96D8', '#E6B0FF'][phase % 5];
    const coreColor = ['#FFFFFF', '#C1ECFF', '#8FC9F0', '#7A5FE0', '#FFB0E6'][phase % 5];

    ctx.globalAlpha = a;
    this.pixelLine(ctx, x1, y1, x2, y2, U, beamColor);
    if (p < 0.5) this.pixelLine(ctx, x1, y1, x2, y2, U, coreColor);

    this.pixDot(ctx, x1, y1, 2, U, '#FFFFFF');
    this.pixDot(ctx, x2, y2, p < 0.4 ? 3 : 1, U, 'rgba(190, 228, 255, ' + (a * 0.6).toFixed(3) + ')');
    ctx.globalAlpha = 1;
  },

  /* 磁暴：折线电弧，逐段抖动，颜色在青白紫之间跳 */
  fxArc(ctx, x1, y1, x2, y2, p, U) {
    const a = 1 - p;
    const seg = 5;
    const nx = -(y2 - y1);
    const ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1;
    const colors = ['#FFFFFF', '#A8DCFF', '#D8B4FF'];
    const col = colors[Math.floor(p * 13) % 3];

    ctx.globalAlpha = a;
    let lx = x1, ly = y1;
    for (let i = 1; i <= seg; i++) {
      const k = i / seg;
      const bx = x1 + (x2 - x1) * k;
      const by = y1 + (y2 - y1) * k;
      const off = i === seg ? 0 : (i % 2 === 0 ? 1 : -1) * (2 + Math.random() * 3) * U;
      const tx = bx + (nx / len) * off, ty = by + (ny / len) * off;
      this.pixelLine(ctx, lx, ly, tx, ty, U, col);
      this.pixDot(ctx, tx, ty, 1, U, col);
      lx = tx; ly = ty;
    }
    ctx.globalAlpha = 1;
  },

  /* 谭雅斩击：两道交叉的短白痕 + 一圈火星 */
  fxSlash(ctx, x2, y2, p, U) {
    const a = 1 - p;
    const r = 4 + p * 4;

    ctx.globalAlpha = a;
    for (const off of [-0.75, 0.75]) {
      this.pixelLine(ctx, x2 - Math.cos(off) * r * U, y2 - Math.sin(off) * r * U,
        x2 + Math.cos(off) * r * U, y2 + Math.sin(off) * r * U, U, '#FFFFFF');
    }
    this.pixelRing(ctx, x2, y2, Math.max(1, Math.round(r * 0.7)), U, '#FFD9F0');
    ctx.globalAlpha = 1;
  },

  /* ---------------- 飘字 ---------------- */

  drawFloats(ctx, state) {
    const dpr = HJ.View.dpr;
    for (const f of state.floats) {
      const p = HJ.View.toScreen(f.x, f.y);
      const prog = HJ.Utils.clamp(f.t / f.max, 0, 1);
      const size = Math.max(8, Math.round((f.size || 9) * dpr));
      const x = Math.round(p.x), y = Math.round(p.y - prog * 9 * dpr);

      ctx.globalAlpha = 1 - prog;
      ctx.font = '700 ' + size + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      /* 字描一圈墨边，否则飘在浅色地形上就看不见了 */
      ctx.lineWidth = Math.max(2, dpr * 2);
      ctx.strokeStyle = 'rgba(11, 13, 10, 0.85)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
      ctx.globalAlpha = 1;
    }
  },

  drawRoutePreview(ctx, state) {
    const h = state.hover;
    if (!state.selected || h.col < 0 || !h.valid || HJ.Units[state.selected].kind !== 'building') return;
    const preview = HJ.Field.preview(state, h.col, h.row, HJ.Units[state.selected].size || 1);
    if (!preview.changed) return;

    const U = this.U();
    const color = preview.reachable ? '#E8C65A' : '#E0705A';
    ctx.globalAlpha = 0.72;
    for (const route of preview.routes) {
      if (!route.changed) continue;
      for (let i = 1; i < route.cells.length; i++) {
        const a = HJ.View.toScreen(route.cells[i - 1].col + 0.5, route.cells[i - 1].row + 0.5);
        const b = HJ.View.toScreen(route.cells[i].col + 0.5, route.cells[i].row + 0.5);
        this.pixelLine(ctx, a.x, a.y, b.x, b.y, U, color);
      }
    }
    ctx.globalAlpha = 1;

    for (const p of preview.changedCells) {
      const box = HJ.View.box(p.col, p.row, 1);
      this.pixelFrame(ctx, Math.round(box.x + U), Math.round(box.y + U),
        Math.max(U, Math.round(box.w - U * 2)), Math.max(U, Math.round(box.h - U * 2)), U,
        'rgba(232, 198, 90, 0.55)');
    }
  },

  /* ---------------- 建造预览 ---------------- */

  drawPreview(ctx, state) {
    const h = state.hover;
    if (h.col < 0) return;

    if (state.sellMode) {
      const target = HJ.Map.occupant(state, h.col, h.row);
      const n = target ? (target.size || 1) : 1;
      const box = HJ.View.box(h.col, h.row, n);
      const U = this.U();
      const ok = !!(target && target.side === 'player');
      ctx.fillStyle = ok ? 'rgba(224, 82, 74, 0.22)' : 'rgba(138, 140, 126, 0.16)';
      ctx.fillRect(Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h));
      this.pixelFrame(ctx, Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h), U,
        ok ? '#E0705A' : '#8A8C7E');
      return;
    }

    if (state.selected === null) return;

    const d = HJ.Units[state.selected];
    if (!d) return;

    const U = this.U();
    const G = HJ.View.cell();
    const n = d.size || 1;
    const box = HJ.View.box(h.col, h.row, n);
    const bx = Math.round(box.x), by = Math.round(box.y);
    const bw = Math.round(box.w), bh = Math.round(box.h);

    ctx.fillStyle = h.valid ? 'rgba(95, 191, 127, 0.24)' : 'rgba(224, 82, 74, 0.24)';
    ctx.fillRect(bx, by, bw, bh);

    /* 内部格线：1 美术像素粗，一格一条，让多格占地数得清 */
    ctx.fillStyle = h.valid ? 'rgba(127, 191, 106, 0.45)' : 'rgba(224, 112, 90, 0.45)';
    for (let i = 1; i < n; i++) {
      ctx.fillRect(Math.round(box.x + i * G), by, U, bh);
      ctx.fillRect(bx, Math.round(box.y + i * G), bw, U);
    }
    this.pixelFrame(ctx, bx, by, bw, bh, U, h.valid ? '#7FBF6A' : '#E0705A');

    /* 射程是切比雪夫距离（方格上「几格以内」），所以画方框，不假装是圆 */
    if (d.range) {
      const rr = Math.round(d.range * G);
      this.pixelFrame(ctx, Math.round(box.cx) - rr, Math.round(box.cy) - rr, rr * 2, rr * 2, U,
        'rgba(201, 162, 39, 0.5)');
    }
  },

  /* ---------------- 指挥 ---------------- */

  drawCommand(ctx, state) {
    const U = this.U();
    const inspected = state.inspected;
    if (inspected && inspected.alive) {
      const p = HJ.View.toScreen(inspected.x, inspected.y);
      const side = (inspected.size || 1) * HJ.View.ART + 4;
      this.brackets(ctx, p.x, p.y, side, side, U, '#9FD7FF', 4);
    }

    const u = state.selectedUnit;
    if (!u || !u.alive) return;

    /* 选框比精灵大一圈，别压着轮廓 —— 轮廓就是单位的身份。
       全选同类时每个都要框出来，否则玩家不知道到底选上了谁。 */
    const squad = (state.squad || []).filter(m => m.alive);
    if (!squad.length) squad.push(u);
    for (const m of squad) {
      const p = HJ.View.toScreen(m.x, m.y);
      const side = m.defId === 'mcv' ? 27 : m.kind === 'vehicle' ? 19 : 15;
      this.brackets(ctx, p.x, p.y, side, side, U, '#D9A441', 4);
    }

    if (state.deployMode) return;
    const p = HJ.View.toScreen(u.x, u.y);
    const hp = HJ.View.toScreen(u.homeX, u.homeY);
    const col = 'rgba(217, 164, 65, 0.85)';

    if (HJ.Utils.dist(u.x, u.y, u.homeX, u.homeY) > 0.4) {
      /* 回位虚线：三格一步一颗点，比 setLineDash 干净，也不会落在半像素上 */
      const dx = hp.x - p.x, dy = hp.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const stepPx = 4 * U;
      ctx.fillStyle = 'rgba(217, 164, 65, 0.5)';
      for (let t = stepPx; t < d; t += stepPx * 2) {
        ctx.fillRect(Math.round(p.x + dx * t / d - U / 2), Math.round(p.y + dy * t / d - U / 2), U, U);
      }
    }

    /* 驻扎点：一小圈 + 上下左右四根短刺，远看像个准星 */
    this.pixelRing(ctx, hp.x, hp.y, 4, U, col);
    this.pixelLine(ctx, hp.x - 7 * U, hp.y, hp.x - 5 * U, hp.y, U, col);
    this.pixelLine(ctx, hp.x + 5 * U, hp.y, hp.x + 7 * U, hp.y, U, col);
    this.pixelLine(ctx, hp.x, hp.y - 7 * U, hp.x, hp.y - 5 * U, U, col);
    this.pixelLine(ctx, hp.x, hp.y + 5 * U, hp.x, hp.y + 7 * U, U, col);
  },

  drawCommandTarget(ctx, state) {
    const u = state.selectedUnit;
    const h = state.hover;
    if (!u || h.col < 0) return;

    const n = state.deployMode ? 4 : 1;
    const box = HJ.View.box(h.col, h.row, n);
    const U = this.U();

    ctx.fillStyle = h.valid ? 'rgba(217, 164, 65, 0.18)' : 'rgba(166, 59, 50, 0.2)';
    ctx.fillRect(Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h));
    this.brackets(ctx, box.cx, box.cy, n * HJ.View.ART - 2, n * HJ.View.ART - 2,
      U, h.valid ? '#D9A441' : '#A63B32', 4);
  },

  /* ---------------- 小工具 ---------------- */

  levelColor(level) {
    if (level >= 2) return '#ffd86a';
    if (level === 1) return '#9fd7ff';
    return '#0b0e0c';
  },

  /* 血条：端点和填充量都吸到美术像素，进度条才不会一格宽一格窄 */
  hpBar(ctx, x, y, w, h, ratio, color) {
    const U = this.U();
    ratio = HJ.Utils.clamp(ratio, 0, 1);
    const bx = Math.round(x / U) * U, by = Math.round(y / U) * U;
    const bw = Math.max(U, Math.round(w / U) * U), bh = Math.max(U, Math.round(h / U) * U);
    ctx.fillStyle = 'rgba(11, 13, 10, 0.7)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ratio > 0.5 ? color : ratio > 0.25 ? '#e8a33d' : '#e0524a';
    ctx.fillRect(bx, by, Math.round(bw * ratio / U) * U, bh);
  },
};
