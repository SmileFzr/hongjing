/* ============================================================
   utils.js — 通用小工具
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Utils = {
  clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  },

  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /* 距离平方，用于比较大小，省一次开方 */
  dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  },

  rand(a, b) {
    return a + Math.random() * (b - a);
  },

  randInt(a, b) {
    return Math.floor(a + Math.random() * (b - a + 1));
  },

  /* 从数组里随机取一个 */
  pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  },

  /* 点到矩形的距离。建筑占多格，用中心点算距离会误判"贴脸" */
  distToRect(px, py, x0, y0, x1, y1) {
    const dx = Math.max(x0 - px, 0, px - x1);
    const dy = Math.max(y0 - py, 0, py - y1);
    return Math.sqrt(dx * dx + dy * dy);
  },

  /* 数字千分位，用于界面显示 */
  fmt(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },
};
