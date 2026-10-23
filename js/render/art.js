/* ============================================================
   art.js — 单位与建筑的造型
   ------------------------------------------------------------
   scene.js 决定"画在哪、画多大"，这个文件决定"长什么样"。

   单位的画法（三色体积）：
     底面   阵营暗色，负责剪影轮廓
     主体   阵营中间色，车体/身体
     高光   阵营亮色，炮塔顶面/头盔
     轮廓   统一深色描边，1px 上下
   这样在 19px 里也能看出"这是坦克、上面有炮塔、炮管朝前"，
   而不是一块纯黑剪影。

   建筑的画法（顶视结构）：
     不画"符号"，画"结构" —— 冷却塔就是两个圆，卷帘门就是横纹矩形。
     结构本身就说明了这栋楼是干什么的，比在方块中间写个字可靠。

   全部纯路径绘制，不加载任何图片，任意缩放无损。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Art = {

  /* 阵营调色板。dark 画底座，mid 画主体，light 画受光面 */
  PAL: {
    player: { dark: '#27506B', mid: '#5588AC', light: '#9CC4DF', ink: '#0B0D0A' },
    enemy:  { dark: '#6B2721', mid: '#B04038', light: '#E88268', ink: '#0B0D0A' },
  },

  /* 建筑顶面的功能染色。
     结构能说明"这是干什么的"，但远看都是灰块；这一层 12~18% 的染色
     让人在地图缩小、单位密集时也能扫到"电厂在哪" */
  TINT: {
    powerplant: 'rgba(217, 164, 65, 0.17)',
    barracks: 'rgba(143, 184, 214, 0.13)',
    warfactory: 'rgba(120, 132, 120, 0.06)',
    lab: 'rgba(200, 160, 224, 0.15)',
    pillbox: 'rgba(217, 164, 65, 0.10)',
    prismtower: 'rgba(143, 184, 214, 0.15)',
    teslacoil: 'rgba(143, 184, 214, 0.18)',
  },

  rr(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  },

  /* ---------------- 单位 ---------------- */
  /* 坐标系：原点在底座中心，朝北（-Y）为前方，可用范围约 ±8px */

  unit(ctx, type, pal) {
    const { mid, light, ink } = pal;

    switch (type) {

      /* ---- 步兵：身体椭圆 + 头部圆 + 枪 ---- */
      case 'conscript': {
        ctx.fillStyle = mid;
        ctx.beginPath();
        ctx.ellipse(0, 1.4, 3.2, 3.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.7;
        ctx.stroke();

        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(0, -1.7, 2.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.6;
        ctx.stroke();

        ctx.fillStyle = ink;
        ctx.fillRect(-0.45, -6.6, 0.9, 4.4);
        break;
      }

      case 'gi': {
        /* 肩宽是它和动员兵唯一的区别，所以肩部一定要画出来 */
        ctx.fillStyle = mid;
        ctx.beginPath();
        ctx.ellipse(0, 1.4, 3.2, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-4.7, 0.1, 1.9, 2.3);
        ctx.fillRect(2.8, 0.1, 1.9, 2.3);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.7;
        ctx.stroke();

        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(0, -1.9, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.6;
        ctx.stroke();

        ctx.fillStyle = ink;
        ctx.fillRect(-0.7, -7.1, 1.4, 4.8);
        break;
      }

      case 'tanya': {
        ctx.fillStyle = mid;
        ctx.beginPath();
        ctx.ellipse(0, 1.2, 2.9, 3.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.7;
        ctx.stroke();

        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(0, -1.5, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.6;
        ctx.stroke();

        /* 双枪张开，全图只有她是这个姿势 */
        ctx.fillStyle = ink;
        ctx.save();
        ctx.translate(-3.6, -3.2);
        ctx.rotate(-0.4);
        ctx.fillRect(-0.5, -2.6, 1, 5);
        ctx.restore();
        ctx.save();
        ctx.translate(3.6, -3.2);
        ctx.rotate(0.4);
        ctx.fillRect(-0.5, -2.6, 1, 5);
        ctx.restore();
        break;
      }

      /* ---- 车辆：履带 + 车体 + 炮塔 + 炮管 ---- */
      case 'grizzly': {
        this.tracks(ctx, 4.2, 3.4, 7.0);

        ctx.fillStyle = mid;
        this.rr(ctx, -4.2, -3.4, 8.4, 6.8, 1);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.fillStyle = light;
        ctx.globalAlpha = 0.22;
        this.rr(ctx, -3.8, -3.0, 7.6, 2.8, 1);
        ctx.fill();
        ctx.globalAlpha = 1;

        this.turret(ctx, pal, 2.5);
        ctx.fillStyle = ink;
        ctx.fillRect(-0.8, -7.3, 1.6, 5.4);
        ctx.fillStyle = light;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(-0.35, -7.3, 0.7, 5.4);
        ctx.globalAlpha = 1;
        break;
      }

      case 'rhino': {
        this.tracks(ctx, 4.3, 4.4, 8.8);

        ctx.fillStyle = mid;
        this.rr(ctx, -4.2, -4.4, 8.4, 8.8, 1);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.fillStyle = light;
        ctx.globalAlpha = 0.22;
        this.rr(ctx, -3.8, -4.0, 7.6, 3.4, 1);
        ctx.fill();
        ctx.globalAlpha = 1;

        this.turret(ctx, pal, 2.8);
        ctx.fillStyle = ink;
        ctx.fillRect(-0.9, -8.3, 1.8, 6.4);
        ctx.fillStyle = light;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(-0.4, -8.3, 0.8, 6.4);
        ctx.globalAlpha = 1;
        break;
      }

      case 'apocalypse': {
        this.tracks(ctx, 5.4, 3.9, 7.8);

        ctx.fillStyle = mid;
        this.rr(ctx, -5.4, -3.9, 10.8, 7.8, 1);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.9;
        ctx.stroke();

        ctx.fillStyle = light;
        ctx.globalAlpha = 0.22;
        this.rr(ctx, -5.0, -3.5, 10.0, 3.0, 1);
        ctx.fill();
        ctx.globalAlpha = 1;

        this.turret(ctx, pal, 2.9);

        /* 双炮管：全场唯一，远看也认得出 */
        ctx.fillStyle = ink;
        ctx.fillRect(-3.0, -8.2, 1.9, 6.2);
        ctx.fillRect(1.1, -8.2, 1.9, 6.2);
        ctx.fillStyle = light;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(-2.6, -8.2, 0.8, 6.2);
        ctx.fillRect(1.5, -8.2, 0.8, 6.2);
        ctx.globalAlpha = 1;
        break;
      }

      case 'prism': {
        /* 菱形车体，中心是棱镜 —— 形状本身就是识别点 */
        ctx.fillStyle = mid;
        ctx.beginPath();
        ctx.moveTo(0, -5.6);
        ctx.lineTo(4.9, 0);
        ctx.lineTo(0, 5.6);
        ctx.lineTo(-4.9, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.9;
        ctx.stroke();

        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.moveTo(0, -2.8);
        ctx.lineTo(2.3, 0.3);
        ctx.lineTo(0, 3.4);
        ctx.lineTo(-2.3, 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 0.7;
        ctx.stroke();

        /* 后部散热片 */
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(-1.6, 4.2, 3.2, 0.7);
        ctx.globalAlpha = 1;
        break;
      }

      case 'ifv': {
        ctx.fillStyle = mid;
        this.rr(ctx, -4.0, -2.6, 8.0, 7.6, 1.4);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.fillStyle = light;
        ctx.globalAlpha = 0.22;
        this.rr(ctx, -3.6, -2.2, 7.2, 2.8, 1.2);
        ctx.fill();
        ctx.globalAlpha = 1;

        /* 顶部双联发射器，像戴了顶帽子 */
        ctx.fillStyle = light;
        ctx.fillRect(-2.6, -6.3, 2.0, 2.5);
        ctx.fillRect(0.6, -6.3, 2.0, 2.5);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.6;
        ctx.strokeRect(-2.6, -6.3, 2.0, 2.5);
        ctx.strokeRect(0.6, -6.3, 2.0, 2.5);
        break;
      }

      /* ---- 恐怖机器人：六足放射，全场独一份 ---- */
      case 'terror': {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 3;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 1.6, Math.sin(a) * 1.6);
          ctx.lineTo(Math.cos(a) * 6.4, Math.sin(a) * 6.4);
          ctx.stroke();
        }
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        break;
      }

      default: {
        ctx.fillStyle = mid;
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  /* 履带：两条深色带 + 横向刻线，这是"这是台车"的最强信号 */
  tracks(ctx, halfW, halfL, len) {
    const w = 1.5;
    ctx.fillStyle = '#1A1A16';
    ctx.fillRect(-halfW, -halfL, w, halfL * 2);
    ctx.fillRect(halfW - w, -halfL, w, halfL * 2);

    ctx.strokeStyle = 'rgba(150, 150, 138, 0.32)';
    ctx.lineWidth = 0.6;
    for (let i = -halfL + 1.2; i < halfL; i += 2.1) {
      ctx.beginPath();
      ctx.moveTo(-halfW, i);
      ctx.lineTo(-halfW + w, i);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(halfW - w, i);
      ctx.lineTo(halfW, i);
      ctx.stroke();
    }
  },

  /* 炮塔：一个亮色圆 + 深色描边，是车体上最亮的点 */
  turret(ctx, pal, r) {
    ctx.fillStyle = pal.light;
    ctx.beginPath();
    ctx.arc(0, 0.3, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = 'rgba(11, 13, 10, 0.25)';
    ctx.beginPath();
    ctx.arc(0, 0.3, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  },

  /* ---------------- 建筑 ---------------- */
  /* 坐标系：原点在建筑顶面中心，size 是结构外接半径 */

  building(ctx, type, s) {
    switch (type) {

      /* 电厂：厂房主体 + 内部设备线 + 黄色闪电。
         试过画两座冷却塔，在 50px 的方块里读起来像一张脸，放弃 */
      case 'powerplant': {
        ctx.fillStyle = '#7A8274';
        this.rr(ctx, -s * 0.88, -s * 0.6, s * 1.76, s * 1.2, 2);
        ctx.fill();
        ctx.strokeStyle = '#0B0D0A';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(56, 66, 54, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-s * 0.72, -s * 0.36);
        ctx.lineTo(s * 0.72, -s * 0.36);
        ctx.moveTo(-s * 0.72, s * 0.36);
        ctx.lineTo(s * 0.72, s * 0.36);
        ctx.stroke();

        ctx.strokeStyle = '#E8B04A';
        ctx.lineWidth = Math.max(1.3, s * 0.15);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(s * 0.14, -s * 0.5);
        ctx.lineTo(-s * 0.18, -s * 0.03);
        ctx.lineTo(s * 0.07, -s * 0.03);
        ctx.lineTo(-s * 0.12, s * 0.5);
        ctx.stroke();
        break;
      }

      /* 兵营：屋顶 + 屋脊 + 天窗 + 旗杆 */
      case 'barracks': {
        ctx.fillStyle = '#5F6A5E';
        this.rr(ctx, -s * 0.92, -s * 0.7, s * 1.84, s * 1.4, 2);
        ctx.fill();
        ctx.strokeStyle = '#0B0D0A';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.strokeStyle = '#7C877A';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-s * 0.92, 0);
        ctx.lineTo(s * 0.92, 0);
        ctx.stroke();

        ctx.fillStyle = 'rgba(143, 184, 214, 0.45)';
        for (const dx of [-0.55, 0, 0.55]) {
          ctx.fillRect(dx * s - s * 0.13, -s * 0.55, s * 0.26, s * 0.32);
        }

        ctx.strokeStyle = '#0B0D0A';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-s * 0.72, -s * 0.7);
        ctx.lineTo(-s * 0.72, -s * 1.25);
        ctx.stroke();
        ctx.fillStyle = '#8FB8D6';
        ctx.beginPath();
        ctx.moveTo(-s * 0.72, -s * 1.25);
        ctx.lineTo(-s * 0.18, -s * 1.08);
        ctx.lineTo(-s * 0.72, -s * 0.9);
        ctx.closePath();
        ctx.fill();
        break;
      }

      /* 战车工厂：大屋顶 + 卷帘门横纹 + 起重机轨道 */
      case 'warfactory': {
        ctx.fillStyle = '#5F6A5E';
        this.rr(ctx, -s, -s * 0.82, s * 2, s * 1.64, 2);
        ctx.fill();
        ctx.strokeStyle = '#0B0D0A';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.fillStyle = '#3C443B';
        ctx.fillRect(-s * 0.76, -s * 0.08, s * 1.52, s * 0.82);

        ctx.strokeStyle = 'rgba(185, 196, 178, 0.35)';
        ctx.lineWidth = 0.8;
        for (let i = 1; i <= 4; i++) {
          const y = -s * 0.08 + (s * 0.82 * i) / 5;
          ctx.beginPath();
          ctx.moveTo(-s * 0.76, y);
          ctx.lineTo(s * 0.76, y);
          ctx.stroke();
        }

        ctx.strokeStyle = '#7C877A';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(-s * 0.96, -s * 0.62);
        ctx.lineTo(s * 0.96, -s * 0.62);
        ctx.stroke();

        ctx.fillStyle = '#8A9282';
        ctx.fillRect(-s * 0.18, -s * 0.72, s * 0.36, s * 0.2);
        break;
      }

      /* 作战实验室：穹顶 + 同心环 + 十字天线 */
      case 'lab': {
        ctx.fillStyle = '#6E7A6C';
        ctx.beginPath();
        ctx.arc(0, s * 0.12, s * 0.74, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0B0D0A';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(196, 206, 188, 0.4)';
        ctx.lineWidth = 0.9;
        for (const rr of [0.48, 0.24]) {
          ctx.beginPath();
          ctx.arc(0, s * 0.12, s * rr, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.strokeStyle = '#A8B2A2';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-s * 0.92, s * 0.12);
        ctx.lineTo(s * 0.92, s * 0.12);
        ctx.moveTo(0, -s * 0.86);
        ctx.lineTo(0, s * 0.92);
        ctx.stroke();

        ctx.fillStyle = '#C9A0E0';
        ctx.beginPath();
        ctx.arc(0, s * 0.12, s * 0.13, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      /* 机枪碉堡：八袋沙包围一圈 + 中心枪眼 */
      case 'pillbox': {
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          const bx = Math.cos(a) * s * 0.62;
          const by = Math.sin(a) * s * 0.62;
          ctx.fillStyle = i % 2 === 0 ? '#5F5947' : '#544F3F';
          ctx.beginPath();
          ctx.arc(bx, by, s * 0.29, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(11, 13, 10, 0.55)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }

        ctx.fillStyle = '#20241C';
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.36, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0B0D0A';
        ctx.fillRect(-s * 0.13, -s * 0.62, s * 0.26, s * 0.44);
        break;
      }

      /* 光棱塔：八边形塔身 + 中心棱镜 */
      case 'prismtower': {
        ctx.fillStyle = '#46515B';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 4;
          const px = Math.cos(a) * s * 0.86;
          const py = Math.sin(a) * s * 0.86;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#0B0D0A';
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.fillStyle = '#8FB8D6';
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.52);
        ctx.lineTo(s * 0.3, 0);
        ctx.lineTo(0, s * 0.52);
        ctx.lineTo(-s * 0.3, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        break;
      }

      /* 磁暴线圈：三圈同心弧 + 中心球 */
      case 'teslacoil': {
        ctx.strokeStyle = '#8FB8D6';
        ctx.lineWidth = Math.max(1.2, s * 0.15);
        for (const rr of [0.32, 0.58, 0.84]) {
          ctx.beginPath();
          ctx.arc(0, 0, s * rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#D8E8F5';
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0B0D0A';
        ctx.lineWidth = 0.7;
        ctx.stroke();
        break;
      }

      default: {
        ctx.fillStyle = '#5F6A5E';
        this.rr(ctx, -s * 0.6, -s * 0.6, s * 1.2, s * 1.2, 2);
        ctx.fill();
      }
    }
  },

  /* 基地徽记：四角星 */
  base(ctx, s) {
    ctx.fillStyle = '#E8E4D8';
    ctx.strokeStyle = 'rgba(11, 13, 10, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      const rr = i % 2 === 0 ? s : s * 0.36;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  },
};
