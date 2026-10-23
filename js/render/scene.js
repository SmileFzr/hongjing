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
    this.bg.width = HJ.Config.W;
    this.bg.height = HJ.Config.H;
    this.buildBackground();

    this.fitCanvas();
    window.addEventListener('resize', () => this.fitCanvas());
  },

  fitCanvas() {
    const stage = document.getElementById('stage');
    if (!stage) return;
    const availW = stage.clientWidth - 28;
    const availH = stage.clientHeight - 28;
    const scale = Math.min(availW / HJ.Config.W, availH / HJ.Config.H);
    this.canvas.style.width = Math.floor(HJ.Config.W * scale) + 'px';
    this.canvas.style.height = Math.floor(HJ.Config.H * scale) + 'px';
  },

  /* ---------------- 静态地形 ---------------- */

  buildBackground() {
    const c = this.bg.getContext('2d');
    const C = HJ.Config;
    const G = C.GRID;
    const W = C.W;
    const H = C.H;

    let seed = 20261023;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    c.fillStyle = '#10140E';
    c.fillRect(0, 0, W, H);

    /* 地形：若干高斯中心影响每格明度，自然形成沙丘带 */
    const blobs = [];
    for (let i = 0; i < 14; i++) {
      blobs.push({
        x: rnd() * C.COLS,
        y: rnd() * C.ROWS,
        r: 2.5 + rnd() * 4.5,
        w: 0.5 + rnd() * 0.8,
      });
    }

    for (let r = 0; r < C.ROWS; r++) {
      for (let col = 0; col < C.COLS; col++) {
        let v = 0;
        for (const b of blobs) {
          const d = Math.hypot(col + 0.5 - b.x, r + 0.5 - b.y);
          v += Math.exp(-(d * d) / (2 * b.r * b.r)) * b.w;
        }
        v = Math.min(1, v);

        const base = 35 + v * 30;
        c.fillStyle = 'rgb(' +
          Math.round(base * 1.0) + ',' +
          Math.round(base * 1.04) + ',' +
          Math.round(base * 0.8) + ')';
        c.fillRect(col * G, r * G, G, G);

        if ((col + r) % 2 === 0) {
          c.fillStyle = 'rgba(255, 255, 255, 0.045)';
          c.fillRect(col * G, r * G, G, G);
        }
      }
    }

    /* 网格线 */
    c.strokeStyle = 'rgba(232, 228, 216, 0.085)';
    c.lineWidth = 1;
    for (let col = 0; col <= C.COLS; col++) {
      c.beginPath();
      c.moveTo(col * G + 0.5, 0);
      c.lineTo(col * G + 0.5, H);
      c.stroke();
    }
    for (let r = 0; r <= C.ROWS; r++) {
      c.beginPath();
      c.moveTo(0, r * G + 0.5);
      c.lineTo(W, r * G + 0.5);
      c.stroke();
    }

    /* 砂砾噪点 */
    for (let i = 0; i < 900; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      c.fillStyle = 'rgba(140, 132, 100, ' + (0.05 + rnd() * 0.07).toFixed(3) + ')';
      c.beginPath();
      c.arc(x, y, 0.7 + rnd() * 1.3, 0, Math.PI * 2);
      c.fill();
    }

    /* 地图边界 */
    c.strokeStyle = 'rgba(232, 228, 216, 0.14)';
    c.lineWidth = 1.5;
    c.strokeRect(0.5, 0.5, W - 1, H - 1);

    /* 入口：朝基地方向画进攻箭头 */
    const bc = HJ.Map.baseCenter();
    for (const e of HJ.Map.entrances) {
      const p = HJ.View.cellCenter(e.col, e.row);
      const ang = HJ.View.angle(bc.x - e.col - 0.5, bc.y - e.row - 0.5);

      c.save();
      c.translate(p.x, p.y);
      c.rotate(ang);

      const L = 46;
      const w = 13;

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

    ctx.clearRect(0, 0, HJ.Config.W, HJ.Config.H);
    ctx.drawImage(this.bg, 0, 0);

    this.drawFlow(ctx);
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
    const list = [];
    list.push({ base: true, depth: state.base.row + state.base.h });

    for (const u of state.defenders) {
      if (!u.alive) continue;
      list.push({
        u,
        depth: u.isBuilding ? u.row + (u.size || 1) : u.y,
      });
    }
    for (const e of state.enemies) {
      if (!e.alive) continue;
      list.push({ u: e, depth: e.y });
    }

    list.sort((a, b) => a.depth - b.depth);

    for (const it of list) {
      if (it.base) this.drawBase(ctx, state);
      else if (it.u.isBuilding) this.drawBuilding(ctx, it.u);
      else this.drawMobile(ctx, it.u);
    }
  },

  /* ---------------- 基地 ---------------- */

  drawBase(ctx, state) {
    const b = state.base;
    const G = HJ.Config.GRID;
    const box = HJ.View.box(b.col, b.row, b.w);

    /* 投影 */
    ctx.fillStyle = 'rgba(11, 13, 10, 0.34)';
    this.roundRect(ctx, box.x + 5, box.y + 5, box.w - 4, box.h - 4, 6);
    ctx.fill();

    /* 底板 */
    ctx.fillStyle = '#6A7166';
    this.roundRect(ctx, box.x + 2, box.y + 2, box.w - 4, box.h - 4, 5);
    ctx.fill();

    ctx.fillStyle = 'rgba(138, 146, 130, 0.5)';
    this.roundRect(ctx, box.x + 2, box.y + 2, box.w - 4, box.h - 4, 5);
    ctx.fill();

    /* 受光边：上、左各一条，给底板一点厚度 */
    ctx.strokeStyle = 'rgba(178, 188, 168, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x + 6, box.y + 2.5);
    ctx.lineTo(box.x + box.w - 6, box.y + 2.5);
    ctx.moveTo(box.x + 2.5, box.y + 6);
    ctx.lineTo(box.x + 2.5, box.y + box.h - 6);
    ctx.stroke();

    /* 指挥塔环 + 四角停机坪标记 */
    const cx = box.cx;
    const cy = box.cy;

    ctx.strokeStyle = 'rgba(11, 13, 10, 0.26)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, G * 1.6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(11, 13, 10, 0.24)';
    for (const dc of [-1, 1]) {
      for (const dr of [-1, 1]) {
        ctx.fillRect(cx + dc * G * 1.6 - 5, cy + dr * G * 1.6 - 5, 10, 10);
      }
    }

    ctx.save();
    ctx.translate(cx, cy);
    HJ.Art.base(ctx, G * 1.1);
    ctx.restore();

    /* 描边 */
    ctx.strokeStyle = 'rgba(11, 13, 10, 0.8)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, box.x + 2, box.y + 2, box.w - 4, box.h - 4, 5);
    ctx.stroke();

    this.hpBar(ctx, cx - 34, box.y - 9, 68, 5, b.hp / b.maxHp, '#7FBF6A');
  },

  /* ---------------- 建筑 ---------------- */

  drawBuilding(ctx, u) {
    const G = HJ.Config.GRID;
    const s = u.size || 1;
    const isDefense = u.range > 0;
    const box = HJ.View.box(u.col, u.row, s);

    const inset = s === 1 ? 2 : 3;
    const top = isDefense ? '#6B7A82' : '#6E7570';

    /* 投影：右下偏移一块暗色，实体才"站"在地上 */
    ctx.fillStyle = 'rgba(11, 13, 10, 0.32)';
    this.roundRect(ctx, box.x + inset + 3, box.y + inset + 3, box.w - inset * 2, box.h - inset * 2, 3);
    ctx.fill();

    /* 顶面 */
    ctx.fillStyle = top;
    this.roundRect(ctx, box.x + inset, box.y + inset, box.w - inset * 2, box.h - inset * 2, 3);
    ctx.fill();

    /* 顶面染一层功能色。没有这层，八栋楼远看都是灰块 */
    const tint = HJ.Art.TINT[u.defId];
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fill();
    }

    /* 受光边：上、左各一条亮线，右侧和下方压暗，构成两段明度 */
    ctx.strokeStyle = isDefense ? 'rgba(160, 178, 188, 0.4)' : 'rgba(160, 170, 158, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x + inset + 2, box.y + inset + 0.5);
    ctx.lineTo(box.x + box.w - inset - 2, box.y + inset + 0.5);
    ctx.moveTo(box.x + inset + 0.5, box.y + inset + 2);
    ctx.lineTo(box.x + inset + 0.5, box.y + box.h - inset - 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(11, 13, 10, 0.32)';
    ctx.beginPath();
    ctx.moveTo(box.x + box.w - inset - 0.5, box.y + inset + 2);
    ctx.lineTo(box.x + box.w - inset - 0.5, box.y + box.h - inset - 2);
    ctx.moveTo(box.x + inset + 2, box.y + box.h - inset - 0.5);
    ctx.lineTo(box.x + box.w - inset - 2, box.y + box.h - inset - 0.5);
    ctx.stroke();

    /* 功能结构 */
    ctx.save();
    ctx.translate(box.cx, box.cy);
    HJ.Art.building(ctx, u.defId, Math.min(box.w * (s === 1 ? 0.37 : 0.26), G * 0.9));
    ctx.restore();

    /* 占地格线：让"这块地占了几格"可见 */
    if (s > 1) {
      ctx.strokeStyle = 'rgba(11, 13, 10, 0.16)';
      ctx.lineWidth = 1;
      for (let i = 1; i < s; i++) {
        ctx.beginPath();
        ctx.moveTo(box.x + i * G + 0.5, box.y + inset);
        ctx.lineTo(box.x + i * G + 0.5, box.y + box.h - inset);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(box.x + inset, box.y + i * G + 0.5);
        ctx.lineTo(box.x + box.w - inset, box.y + i * G + 0.5);
        ctx.stroke();
      }
    }

    /* 描边 */
    ctx.strokeStyle = 'rgba(11, 13, 10, 0.82)';
    ctx.lineWidth = 1.3;
    this.roundRect(ctx, box.x + inset, box.y + inset, box.w - inset * 2, box.h - inset * 2, 3);
    ctx.stroke();

    /* 老兵晋升：等级色描边 */
    if (u.level > 0) {
      ctx.strokeStyle = this.levelColor(u.level);
      ctx.lineWidth = 2;
      this.roundRect(ctx, box.x + inset - 1, box.y + inset - 1, box.w - inset * 2 + 2, box.h - inset * 2 + 2, 3);
      ctx.stroke();
    }

    if (u.hp < u.maxHp) {
      this.hpBar(ctx, box.cx - 20, box.y - 7, 40, 3, u.hp / u.maxHp, '#7FBF6A');
    }
  },

  /* ---------------- 移动单位 ---------------- */

  drawMobile(ctx, u) {
    const isEnemy = u.side === 'enemy';
    const pal = isEnemy ? HJ.Art.PAL.enemy : HJ.Art.PAL.player;
    const isVehicle = u.kind === 'vehicle';

    const p = HJ.View.toScreen(u.x, u.y);
    const scale = (isEnemy ? Math.min(1.3, (u.radius || 8) / 8) : 1) * 1.62;

    /* 影子 */
    ctx.fillStyle = 'rgba(11, 13, 10, 0.3)';
    ctx.beginPath();
    ctx.ellipse(
      p.x + 1.6, p.y + 2,
      (isVehicle ? 9 : 5.2) * scale,
      (isVehicle ? 7 : 4.2) * scale,
      0, 0, Math.PI * 2
    );
    ctx.fill();

    /* 出阵单位在驻扎点留一个小圈，一眼看出它离开了站位 */
    if (!isEnemy && u.canMove && HJ.Utils.dist(u.x, u.y, u.homeX, u.homeY) > 0.2) {
      const hp = HJ.View.toScreen(u.homeX, u.homeY);
      ctx.strokeStyle = 'rgba(143, 184, 214, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* 造型默认朝北，所以要补 90 度 */
    let ang = -Math.PI / 2;
    if (u.target) {
      ang = HJ.View.angle(u.target.x - u.x, u.target.y - u.y);
    } else if (isEnemy) {
      const bc = HJ.Map.baseCenter();
      ang = HJ.View.angle(bc.x - u.x, bc.y - u.y);
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang + Math.PI / 2);
    ctx.scale(scale, scale);
    HJ.Art.unit(ctx, isEnemy ? u.enId : u.defId, pal);
    ctx.restore();

    if (u.hp < u.maxHp) {
      const barW = (isVehicle ? 20 : 15) * scale;
      this.hpBar(
        ctx, p.x - barW / 2, p.y - 13 * scale, barW, 2.5,
        u.hp / u.maxHp, isEnemy ? '#E0705A' : '#7FBF6A'
      );
    }
  },

  /* ---------------- 履带印 ---------------- */

  drawTracks(ctx, state) {
    if (!state.tracks || !state.tracks.length) return;

    for (const t of state.tracks) {
      const p = HJ.View.toScreen(t.x, t.y);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(t.ang);
      ctx.fillStyle = 'rgba(11, 13, 10, 0.24)';
      ctx.fillRect(-3.5, -5.5, 3, 4);
      ctx.fillRect(0.5, -5.5, 3, 4);
      ctx.restore();
    }
  },

  /* ---------------- 扬尘 ---------------- */

  drawDust(ctx, state) {
    if (!state.dust || !state.dust.length) return;

    for (const d of state.dust) {
      const p = HJ.View.toScreen(d.x, d.y);
      const prog = d.t / d.max;
      ctx.globalAlpha = (1 - prog) * 0.4;
      ctx.fillStyle = '#8A8468';
      ctx.beginPath();
      ctx.arc(p.x, p.y, d.r * (0.6 + prog * 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  /* ---------------- 流场调试 ---------------- */

  drawFlow(ctx) {
    if (!HJ.Config.GRID_DEBUG || !HJ.Field.dist) return;

    const C = HJ.Config;
    const G = C.GRID;
    const span = 32;

    for (let r = 0; r < C.ROWS; r++) {
      for (let col = 0; col < C.COLS; col++) {
        const d = HJ.Field.dist[r * C.COLS + col];
        if (!isFinite(d)) continue;
        const a = HJ.Utils.clamp(1 - d / span, 0, 1);
        ctx.fillStyle = 'rgba(80, 200, 140, ' + (a * 0.24).toFixed(3) + ')';
        ctx.fillRect(col * G, r * G, G, G);
      }
    }
  },

  /* ---------------- 攻击特效 ---------------- */
  /* 按武器分五种手感：步枪曳光弹、坦克炮口闪光+炮弹+爆炸、
     光棱光束、磁暴电弧、谭雅斩击 */

  drawEffects(ctx, state) {
    for (const f of state.effects) {
      const prog = HJ.Utils.clamp(f.t / f.max, 0, 1);
      const a0 = HJ.View.toScreen(f.x1, f.y1);
      const a1 = HJ.View.toScreen(f.x2, f.y2);
      const ang = Math.atan2(a1.y - a0.y, a1.x - a0.x);

      ctx.save();
      switch (f.warhead) {
        case 'AP':
        case 'HE':
          this.fxCannon(ctx, a0.x, a0.y, a1.x, a1.y, ang, prog, f);
          break;
        case 'PRISM':
          this.fxBeam(ctx, a0.x, a0.y, a1.x, a1.y, prog);
          break;
        case 'TESLA':
          this.fxArc(ctx, a0.x, a0.y, a1.x, a1.y, prog);
          break;
        case 'HERO':
          this.fxSlash(ctx, a0.x, a0.y, a1.x, a1.y, prog);
          break;
        default:
          this.fxRifle(ctx, a0.x, a0.y, a1.x, a1.y, ang, prog, f);
      }
      ctx.restore();
    }
  },

  fxRifle(ctx, x1, y1, x2, y2, ang, p, f) {
    const color = f.side === 'enemy' ? '#E0705A' : '#F3D98A';

    if (p < 0.55) {
      const k = p / 0.55;
      const px = x1 + (x2 - x1) * k;
      const py = y1 + (y2 - y1) * k;

      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(ang) * 9, py - Math.sin(ang) * 9);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const k = (p - 0.55) / 0.45;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#FFF2CC';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const a = ang + (i - 1.5) * 0.55;
      const len = 2 + k * 5;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 + Math.cos(a) * len, y2 + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  fxCannon(ctx, x1, y1, x2, y2, ang, p, f) {
    if (p < 0.16) {
      const k = 1 - p / 0.16;
      ctx.fillStyle = 'rgba(255, 222, 150, ' + (0.85 * k).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x1 + Math.cos(ang) * 10, y1 + Math.sin(ang) * 10, 3 + 4 * k, 0, Math.PI * 2);
      ctx.fill();
    }

    if (p < 0.62) {
      const k = p / 0.62;
      const px = x1 + (x2 - x1) * k;
      const py = y1 + (y2 - y1) * k;
      ctx.fillStyle = '#FFE79B';
      ctx.beginPath();
      ctx.arc(px, py, f.big ? 2.8 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (p > 0.56) {
      const k = (p - 0.56) / 0.44;
      const r = 4 + k * (f.big ? 20 : 13);

      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = '#FFB45A';
      ctx.lineWidth = 2.4 * (1 - k) + 0.4;
      ctx.beginPath();
      ctx.arc(x2, y2, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.fillStyle = '#FF9B3D';
      ctx.beginPath();
      ctx.arc(x2, y2, r * 0.52, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
    }
  },

  fxBeam(ctx, x1, y1, x2, y2, p) {
    const a = 1 - p;

    ctx.globalAlpha = a;
    ctx.strokeStyle = '#8FC9F0';
    ctx.lineWidth = 5 * a + 0.8;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.4 * a + 0.3;
    ctx.stroke();

    ctx.fillStyle = 'rgba(190, 228, 255, ' + (a * 0.6).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(x2, y2, 2 + (1 - a) * 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
  },

  fxArc(ctx, x1, y1, x2, y2, p) {
    const a = 1 - p;
    const seg = 5;
    const nx = -(y2 - y1);
    const ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1;

    ctx.globalAlpha = a;
    ctx.strokeStyle = '#A8DCFF';
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    for (let i = 1; i < seg; i++) {
      const k = i / seg;
      const bx = x1 + (x2 - x1) * k;
      const by = y1 + (y2 - y1) * k;
      const off = (i % 2 === 0 ? 1 : -1) * (2.5 + Math.random() * 4);
      ctx.lineTo(bx + (nx / len) * off, by + (ny / len) * off);
    }
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.globalAlpha = a * 0.6;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.globalAlpha = 1;
  },

  fxSlash(ctx, x1, y1, x2, y2, p) {
    const a = 1 - p;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const ang = Math.atan2(y2 - y1, x2 - x1);

    ctx.globalAlpha = a;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2 * a + 0.4;
    ctx.beginPath();
    ctx.moveTo(mx - Math.cos(ang + 1.1) * 13, my - Math.sin(ang + 1.1) * 13);
    ctx.lineTo(mx + Math.cos(ang - 1.1) * 13, my + Math.sin(ang - 1.1) * 13);
    ctx.stroke();

    ctx.globalAlpha = a * 0.45;
    ctx.strokeStyle = '#FFD9F0';
    ctx.lineWidth = 3.5 * a;
    ctx.stroke();

    ctx.globalAlpha = 1;
  },

  /* ---------------- 飘字 ---------------- */

  drawFloats(ctx, state) {
    for (const f of state.floats) {
      const p = HJ.View.toScreen(f.x, f.y);
      const a = HJ.Utils.clamp(f.t / f.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.font = '600 ' + (f.size || 11) + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
  },

  /* ---------------- 建造预览 ---------------- */

  drawPreview(ctx, state) {
    const h = state.hover;
    if (state.selected === null || h.col < 0) return;

    const d = HJ.Units[state.selected];
    if (!d) return;

    const G = HJ.Config.GRID;
    const n = d.size || 1;
    const box = HJ.View.box(h.col, h.row, n);

    ctx.fillStyle = h.valid ? 'rgba(95, 191, 127, 0.24)' : 'rgba(224, 82, 74, 0.24)';
    ctx.strokeStyle = h.valid ? '#7FBF6A' : '#E0705A';
    ctx.lineWidth = 1.6;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);

    if (n > 1) {
      ctx.strokeStyle = h.valid ? 'rgba(127, 191, 106, 0.45)' : 'rgba(224, 112, 90, 0.45)';
      ctx.lineWidth = 1;
      for (let i = 1; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(box.x + i * G + 0.5, box.y);
        ctx.lineTo(box.x + i * G + 0.5, box.y + box.h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(box.x, box.y + i * G + 0.5);
        ctx.lineTo(box.x + box.w, box.y + i * G + 0.5);
        ctx.stroke();
      }
    }

    if (d.range) {
      ctx.beginPath();
      ctx.arc(box.cx, box.cy, d.range * G, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(201, 162, 39, 0.05)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  },

  /* ---------------- 指挥 ---------------- */

  drawCommand(ctx, state) {
    const u = state.selectedUnit;
    if (!u || !u.alive) return;

    const p = HJ.View.toScreen(u.x, u.y);

    const r = 15;
    const len = 5;
    ctx.strokeStyle = '#D9A441';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y - r + len);
    ctx.lineTo(p.x - r, p.y - r);
    ctx.lineTo(p.x - r + len, p.y - r);
    ctx.moveTo(p.x + r - len, p.y - r);
    ctx.lineTo(p.x + r, p.y - r);
    ctx.lineTo(p.x + r, p.y - r + len);
    ctx.moveTo(p.x + r, p.y + r - len);
    ctx.lineTo(p.x + r, p.y + r);
    ctx.lineTo(p.x + r - len, p.y + r);
    ctx.moveTo(p.x - r + len, p.y + r);
    ctx.lineTo(p.x - r, p.y + r);
    ctx.lineTo(p.x - r, p.y + r - len);
    ctx.stroke();

    const hp = HJ.View.toScreen(u.homeX, u.homeY);

    if (HJ.Utils.dist(u.x, u.y, u.homeX, u.homeY) > 0.4) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(217, 164, 65, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(hp.x, hp.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = 'rgba(217, 164, 65, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hp.x - 11, hp.y);
    ctx.lineTo(hp.x - 3, hp.y);
    ctx.moveTo(hp.x + 3, hp.y);
    ctx.lineTo(hp.x + 11, hp.y);
    ctx.stroke();
  },

  drawCommandTarget(ctx, state) {
    const u = state.selectedUnit;
    const h = state.hover;
    if (!u || h.col < 0) return;

    const box = HJ.View.box(h.col, h.row, 1);

    ctx.fillStyle = h.valid ? 'rgba(217, 164, 65, 0.18)' : 'rgba(166, 59, 50, 0.2)';
    ctx.strokeStyle = h.valid ? '#D9A441' : '#A63B32';
    ctx.lineWidth = 1.5;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  },

  /* ---------------- 小工具 ---------------- */

  levelColor(level) {
    if (level >= 2) return '#ffd86a';
    if (level === 1) return '#9fd7ff';
    return '#0b0e0c';
  },

  hpBar(ctx, x, y, w, h, ratio, color) {
    ratio = HJ.Utils.clamp(ratio, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = ratio > 0.5 ? color : ratio > 0.25 ? '#e8a33d' : '#e0524a';
    ctx.fillRect(x, y, w * ratio, h);
  },

  roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  },
};
