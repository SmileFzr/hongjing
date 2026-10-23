/* ============================================================
   view.js — 坐标投影层（平面正交俯视）
   ------------------------------------------------------------
   逻辑层全是正交格子（col/row），只有这一层知道它们怎么变成像素。
   这一版用最直接的平面映射：一格 = GRID 像素的正方形。

   之所以单独留一层，是为了让 scene / input 里不出现"乘 GRID"这种
   散落的换算。要换视角（比如以后想试等距），只改这个文件。

        toScreen(wx, wy) = (wx * GRID, wy * GRID)
   ============================================================ */

window.HJ = window.HJ || {};

HJ.View = {
  /* 世界坐标（格，可带小数）→ 屏幕像素 */
  toScreen(wx, wy) {
    const G = HJ.Config.GRID;
    return { x: wx * G, y: wy * G };
  },

  /* 屏幕像素 → 世界坐标（拾取用） */
  toWorld(sx, sy) {
    const G = HJ.Config.GRID;
    return { x: sx / G, y: sy / G };
  },

  /* 一格的四个角：左上 → 右上 → 右下 → 左下 */
  corners(col, row, size) {
    const G = HJ.Config.GRID;
    const s = size || 1;
    return [
      { x: col * G, y: row * G },
      { x: (col + s) * G, y: row * G },
      { x: (col + s) * G, y: (row + s) * G },
      { x: col * G, y: (row + s) * G },
    ];
  },

  /* 一笔描出多边形（不自动 fill/stroke，调用方决定） */
  poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  },

  /* 世界方向 → 屏幕角度。平面映射下就是 atan2 本身 */
  angle(dx, dy) {
    return Math.atan2(dy, dx);
  },

  /* 格子中心的屏幕坐标 */
  cellCenter(col, row) {
    return this.toScreen(col + 0.5, row + 0.5);
  },

  /* 一堆格子的整体矩形范围（建造预览、建筑占地用） */
  box(col, row, size) {
    const G = HJ.Config.GRID;
    const s = size || 1;
    return {
      x: col * G,
      y: row * G,
      w: s * G,
      h: s * G,
      cx: (col + s / 2) * G,
      cy: (row + s / 2) * G,
    };
  },
};
