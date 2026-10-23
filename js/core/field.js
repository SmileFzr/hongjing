/* ============================================================
   field.js — 流场（Flow Field）
   ------------------------------------------------------------
   敌人不走固定路线，而是"顺着距离场往低处流"。

   做法：
     以基地为唯一源点，用 Dijkstra 向外扩散，
     给每个格子算一个「走到基地要花多少代价」的数字。
     敌人每帧只问一句「我旁边哪边数字最小」，就朝那边走。
     ——所以它永远不会卡住，也不需要写任何绕路逻辑。

   ★ 关键设计：建筑不是硬阻挡，而是「贵」。
     空地走一格 = 1，穿过一格建筑 = 16。
     于是：
       · 没围死的时候，绕两格（2）远比拆墙（16）便宜 → 敌人自动绕开
       · 完全围死的时候，唯一的出口就是最薄的那面墙 → 敌人自己走过去拆
     一个场同时解决「绕路」和「砸哪面墙」两个问题，不需要两套逻辑。

   建筑一放/一拆，重算一次。36×24 = 864 格，毫秒级。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Field = {
  /* 穿过一格建筑要付的代价，单位是"格"。
     调高 = 敌人更愿意绕远路，调低 = 敌人更爱拆墙 */
  BREACH_COST: 16,

  /* 不可达格在插值时用这个大数顶上，避免 Infinity 传染 */
  BIG: 9999,

  dist: null,

  /* 地形脏标记。放/拆建筑时置 true，主循环里统一重算一次，
     这样玩家连点十下也只算一次，不会卡 */
  dirty: true,

  ensure(state) {
    if (!this.dirty) return;
    this.rebuild(state);
    this.dirty = false;
  },

  /* ---------------- 重建 ---------------- */

  rebuild(state) {
    const C = HJ.Config.COLS;
    const R = HJ.Config.ROWS;
    const N = C * R;

    if (!this.dist || this.dist.length !== N) this.dist = new Float32Array(N);
    const dist = this.dist;
    dist.fill(Infinity);

    /* 代价表：空地 1，建筑 BREACH_COST */
    const cost = new Float32Array(N).fill(1);
    for (const u of state.defenders) {
      if (!u.alive || !u.isBuilding) continue;
      const s = u.size || 1;
      for (let r = u.row; r < u.row + s; r++) {
        for (let c = u.col; c < u.col + s; c++) {
          if (c < 0 || r < 0 || c >= C || r >= R) continue;
          cost[r * C + c] = this.BREACH_COST;
        }
      }
    }

    /* --- 二叉堆（两个平行数组，比对象数组省一半内存） --- */
    const hp = [];
    const hv = [];

    const push = (p, v) => {
      hp.push(p); hv.push(v);
      let i = hp.length - 1;
      while (i > 0) {
        const par = (i - 1) >> 1;
        if (hp[par] <= hp[i]) break;
        let t = hp[par]; hp[par] = hp[i]; hp[i] = t;
        t = hv[par]; hv[par] = hv[i]; hv[i] = t;
        i = par;
      }
    };

    const pop = () => {
      const topP = hp[0];
      const topV = hv[0];
      const lastP = hp.pop();
      const lastV = hv.pop();
      if (hp.length) {
        hp[0] = lastP; hv[0] = lastV;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < hp.length && hp[l] < hp[m]) m = l;
          if (r < hp.length && hp[r] < hp[m]) m = r;
          if (m === i) break;
          let t = hp[m]; hp[m] = hp[i]; hp[i] = t;
          t = hv[m]; hv[m] = hv[i]; hv[i] = t;
          i = m;
        }
      }
      return [topP, topV];
    };

    /* --- 源点：基地所有格子，距离 0 --- */
    const b = state.base;
    for (let r = b.row; r < b.row + b.h; r++) {
      for (let c = b.col; c < b.col + b.w; c++) {
        if (c < 0 || r < 0 || c >= C || r >= R) continue;
        const idx = r * C + c;
        dist[idx] = 0;
        push(0, idx);
      }
    }

    /* --- 八方向 Dijkstra --- */
    while (hp.length) {
      const [d, idx] = pop();
      if (d > dist[idx]) continue;

      const c = idx % C;
      const r = (idx - c) / C;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= C || nr >= R) continue;

          /* 斜着穿两堵墙的夹角不允许，否则敌人会从墙缝里漏过去 */
          if (dr && dc && cost[r * C + nc] > 1 && cost[nr * C + c] > 1) continue;

          const ni = nr * C + nc;
          const step = (dr && dc) ? 1.41421356 : 1;
          const nd = d + step * cost[ni];
          if (nd < dist[ni]) {
            dist[ni] = nd;
            push(nd, ni);
          }
        }
      }
    }
  },

  /* ---------------- 采样 ---------------- */

  /**
   * 双线性插值取距离场的值。
   * 格子 (c,r) 的中心是 (c+0.5, r+0.5)，所以采样前先平移半格。
   */
  sample(x, y) {
    const dist = this.dist;
    if (!dist) return this.BIG;

    const C = HJ.Config.COLS;
    const R = HJ.Config.ROWS;

    const fx = x - 0.5;
    const fy = y - 0.5;
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fy);
    const tx = fx - c0;
    const ty = fy - r0;

    const get = (c, r) => {
      if (c < 0 || r < 0 || c >= C || r >= R) return this.BIG;
      const v = dist[r * C + c];
      return v === Infinity ? this.BIG : v;
    };

    const a = get(c0, r0);
    const bb = get(c0 + 1, r0);
    const cc = get(c0, r0 + 1);
    const dd = get(c0 + 1, r0 + 1);

    return a * (1 - tx) * (1 - ty)
         + bb * tx * (1 - ty)
         + cc * (1 - tx) * ty
         + dd * tx * ty;
  },

  /**
   * 负梯度方向 = 距离场下降最快的方向 = 去基地该走的方向。
   * 返回归一化向量；在基地内部（四面都是 0）返回 null。
   */
  dirAt(x, y) {
    const e = 0.4;
    const gx = this.sample(x + e, y) - this.sample(x - e, y);
    const gy = this.sample(x, y + e) - this.sample(x, y - e);
    const L = Math.hypot(gx, gy);
    if (L < 1e-4) return null;
    return { x: -gx / L, y: -gy / L };
  },

  /**
   * 带兜底的方向：梯度平掉的时候直接朝基地直线走。
   * 没有这一层，敌人偶尔会在两块等距的空地上原地抽搐。
   */
  dirTo(x, y) {
    const d = this.dirAt(x, y);
    if (d) return d;

    const bc = HJ.Map.baseCenter();
    const dx = bc.x - x;
    const dy = bc.y - y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-4) return null;
    return { x: dx / L, y: dy / L };
  },

  /* 某格到基地的代价，调试和 AI 布防用 */
  at(col, row) {
    if (!this.dist) return Infinity;
    if (!HJ.Map.inBounds(col, row)) return Infinity;
    return this.dist[row * HJ.Config.COLS + col];
  },
};
