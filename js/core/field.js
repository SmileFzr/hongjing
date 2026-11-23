/* ============================================================
   field.js — 距离场（流场）
   ------------------------------------------------------------
   推进方不走固定路线，而是「顺着距离场往低处流」。

   做法：以目标基地为源点 Dijkstra 向外扩散，每格一个「走到目标要
   多少代价」。单位每帧只问「旁边哪边数字小」，所以永远不会卡住。

   ★ 关键设计一：建筑不是硬阻挡，而是「贵」（BREACH_COST）。
     空地 1、穿建筑 16 → 没围死自动绕开；完全围死就去拆最薄的墙。
     一个场同时解决绕路和砸哪面墙，不用两套逻辑。

   ★ 关键设计二（分侧重构加的）：场按 (目标侧, 移动类别) 缓存。
     遭遇战两侧都要推，各自的目标是对方基地；
     地形接入后步兵和车辆的可行走区域也不同。
     所以最多 4 个场：player/track、player/foot、enemy/track、enemy/foot。
     建一次 2816 格几毫秒，只在放/拆建筑或换图时重算。

   P1a 全平地，两个移动类别的场数值相同，行为与重构前一致。
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Field = {
  /* 穿过一格建筑要付的代价，单位是「格」。
     调高 = 更愿意绕远路，调低 = 更爱拆墙 */
  BREACH_COST: 16,

  /* 不可达格在插值时用这个大数顶上，避免 Infinity 传染 */
  BIG: 9999,

  /* key = goalSide + ':' + moveClass */
  cache: new Map(),

  /* 地形脏标记。放/拆建筑时置 true，主循环里统一重算一次，
     这样玩家连点十下也只算一次 */
  dirty: true,

  /* 调试用：scene 画流场热力图时取这个 */
  debug: null,

  key(goalSide, moveClass) {
    return goalSide + ':' + moveClass;
  },

  markDirty() {
    this.dirty = true;
  },

  /** 主循环每步调一次：脏了就作废所有缓存，具体重建推迟到真正被问到时 */
  ensure() {
    if (!this.dirty) return;
    this.cache.clear();
    this.dirty = false;
  },

  /**
   * 取某一「目标侧 + 移动类别」的场，没有就现算。
   * @param {object} state
   * @param {string} goalSide 走向哪一侧的基地
   * @param {string} moveClass 'foot' | 'track'
   * @returns {object|null} 该侧没有基地时返回 null（塔防的 enemy 就是这样）
   */
  get(state, goalSide, moveClass) {
    const k = this.key(goalSide, moveClass);
    let f = this.cache.get(k);
    if (f) return f;

    f = this.build(state, goalSide, moveClass);
    this.cache.set(k, f);
    if (!this.debug) this.debug = f;
    return f;
  },

  /** 推进单位要走的场：目标是「对方」的基地 */
  forUnit(state, u) {
    const goal = HJ.State.foeSideId(u.side);
    if (!HJ.Map.hasBase(state.map, goal)) return null;
    return this.get(state, goal, u.moveClass || 'foot');
  },

  /* ---------------- 重建 ---------------- */

  build(state, goalSide, moveClass) {
    const map = state.map;
    const C = map.cols;
    const R = map.rows;
    const N = C * R;

    const dist = new Float32Array(N);
    dist.fill(Infinity);

    const goal = HJ.Map.baseOf(map, goalSide);

    /* 代价表：地形倍数 × (建筑则取 max(BREACH_COST, 地形))，不可通行 = Infinity */
    const cost = new Float32Array(N);
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const tc = HJ.Map.moveCost(map, moveClass, c, r);
        cost[r * C + c] = tc;
      }
    }
    for (const side in state.sides) {
      for (const u of state.sides[side].units) {
        if (!u.alive || !u.isBuilding || u.isBase) continue;
        const s = u.size || 1;
        for (let r = u.row; r < u.row + s; r++) {
          for (let c = u.col; c < u.col + s; c++) {
            if (c < 0 || r < 0 || c >= C || r >= R) continue;
            const i = r * C + c;
            if (!isFinite(cost[i])) continue;
            cost[i] = Math.max(cost[i], this.BREACH_COST);
          }
        }
      }
    }

    const f = {
      goalSide: goalSide,
      moveClass: moveClass,
      cols: C,
      rows: R,
      dist: dist,
      goal: goal ? { x: goal.col + goal.w / 2, y: goal.row + goal.h / 2 } : null,
    };

    if (!goal) return f;

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

    /* --- 源点：目标基地所有格子，距离 0 --- */
    for (let r = goal.row; r < goal.row + goal.h; r++) {
      for (let c = goal.col; c < goal.col + goal.w; c++) {
        if (c < 0 || r < 0 || c >= C || r >= R) continue;
        const i = r * C + c;
        dist[i] = 0;
        push(0, i);
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

          /* 斜着穿两堵墙的夹角不允许，否则单位会从墙缝里漏过去 */
          if (dr && dc && cost[r * C + nc] >= this.BREACH_COST
                           && cost[nr * C + c] >= this.BREACH_COST) continue;

          const ni = nr * C + nc;
          if (!isFinite(cost[ni])) continue;
          const step = (dr && dc) ? 1.41421356 : 1;
          const nd = d + step * cost[ni];
          if (nd < dist[ni]) {
            dist[ni] = nd;
            push(nd, ni);
          }
        }
      }
    }

    return f;
  },

  /* ---------------- 采样 ---------------- */

  /**
   * 双线性插值取距离场的值。
   * 格子 (c,r) 的中心是 (c+0.5, r+0.5)，所以采样前先平移半格。
   */
  sample(f, x, y) {
    const dist = f.dist;
    const C = f.cols;
    const R = f.rows;

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
    const b = get(c0 + 1, r0);
    const c = get(c0, r0 + 1);
    const d = get(c0 + 1, r0 + 1);

    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty)
         + c * (1 - tx) * ty + d * tx * ty;
  },

  /** 负梯度方向 = 距离场下降最快的方向。基地内部返回 null */
  dirAt(f, x, y) {
    const e = 0.4;
    const gx = this.sample(f, x + e, y) - this.sample(f, x - e, y);
    const gy = this.sample(f, x, y + e) - this.sample(f, x, y - e);
    const L = Math.hypot(gx, gy);
    if (L < 1e-4) return null;
    return { x: -gx / L, y: -gy / L };
  },

  /**
   * 带兜底的方向：梯度平掉的时候直接朝目标直线走。
   * 没有这一层，单位偶尔会在两块等距的空地上原地抽搐。
   */
  dirTo(f, x, y) {
    const d = this.dirAt(f, x, y);
    if (d) return d;

    if (!f.goal) return null;
    const dx = f.goal.x - x;
    const dy = f.goal.y - y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-4) return null;
    return { x: dx / L, y: dy / L };
  },

  /** 某格到目标的代价，AI 布防和调试用 */
  at(f, col, row) {
    if (!f || !f.dist) return Infinity;
    if (col < 0 || row < 0 || col >= f.cols || row >= f.rows) return Infinity;
    return f.dist[row * f.cols + col];
  },
};
