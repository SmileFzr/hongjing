/* ============================================================
   pixel.js — 纯代码像素管线
   ------------------------------------------------------------
   这个文件是全部的「美术」。没有外部图片：
     色板 ramp → 字符网格精灵 → 运行时烘成一张图集 → 每帧整数倍最近邻贴

   为什么单位用字符网格、建筑用代码画：
     · 单位靠剪影认。16×16 的字符画可以直接肉眼比对参考图一格格堆，
       改哪一颗像素一目了然 —— 这是唯一能把手感磨出来的办法。
     · 建筑靠占地和地标认，尺寸从 1×1 到 4×4 差 16 倍，
       手画网格要为每个尺寸画一张；参数化画反而更整齐，
       屋顶/接缝/铆钉/警戒条纹这些通用件还能全部建筑共享。

   ★ 三条硬规矩
     1. 一切都在「美术像素」空间里算，放大只交给整数倍最近邻。
     2. 颜色只能从 LEGEND 取角色名，角色按阵营解析成 ramp —— 换阵营不重画。
     3. 单位烘 4 个朝向（S/E/N/W），车辆的车体和炮塔分开烘，
        所以能「车往一边走、炮往一边瞄」。

   ★ 参考：RA2 灰熊/天启设定图与实战截图（shots/ref/），
     抓的是识别特征而不是角度 —— 灰熊的后部储物篮、天启的四组履带和
     四角红盖箱体、犀牛的前装甲斜面 + 红星、恐怖机器人的六条腿。
   ============================================================ */

window.HJ = window.HJ || {};

/* ---------------- 色板：材质 ramp（d 暗 → h 高光） ---------------- */
const RAMPS = {
  ink:  ['#0A0B0C', '#15181B', '#23282D', '#3A424A'],
  sh:   ['#000000', '#000000', '#000000', '#000000'],

  /* 阵营金属（车体、炮塔、头盔漆面） */
  pmt:  ['#22405C', '#3A6489', '#6E9CBF', '#A9CDE4'],
  emt:  ['#4E2018', '#8A3A2C', '#C2624E', '#EAA189'],
  /* 阵营布料（军服）。敌军必须和肤色拉开：原来这条是棕色，
     和 skn 只差一点，敌步兵看着像没穿衣服的一坨肉。 */
  pcl:  ['#24361F', '#3C5735', '#5E7F52', '#8FAE7C'],
  ecl:  ['#2C1414', '#5A2626', '#8A3E3A', '#B86B64'],

  stl:  ['#2E3338', '#4A5259', '#767F88', '#AAB4BC'],   // 中性钢
  con:  ['#3A3E36', '#575D50', '#7C8375', '#A5AC9D'],   // 混凝土
  ruf:  ['#4A2A20', '#6E4030', '#96624A', '#C08C6C'],   // 屋顶
  wnd:  ['#1E2A33', '#33485A', '#5A7C96', '#8FB2CC'],   // 玻璃
  pwr:  ['#6A4A10', '#A87818', '#D9A441', '#F7DC8A'],   // 电/黄
  pri:  ['#2A5A7A', '#4A90C0', '#8FD8F0', '#E8FDFF'],   // 光棱
  tes:  ['#243A6A', '#3A6AB4', '#6AA8E8', '#CDEBFF'],   // 磁暴
  lab:  ['#43265E', '#6E4495', '#A179CE', '#D9C0F2'],   // 实验室
  fir:  ['#5E2410', '#A84E1A', '#E08236', '#FFD08A'],   // 火/红
  grs:  ['#26361C', '#3E5630', '#62804A', '#94B470'],   // 草
  dirt: ['#2E2519', '#463826', '#65533B', '#8C7758'],   // 土
  rock: ['#343638', '#4E5155', '#73777D', '#9DA2A9'],   // 岩
  wat:  ['#0E1B2E', '#1B3454', '#35648E', '#6E9CBC'],   // 水
  skn:  ['#6E4230', '#9A6046', '#C08C68', '#E2B896'],   // 皮肤
};

const PAL = [];
const PAL_INDEX = {};
const RAMP_OF = {};
(function buildPal() {
  for (const name in RAMPS) {
    ['d', 'm', 'l', 'h'].forEach((lv, i) => {
      PAL_INDEX[name + '.' + lv] = PAL.length;
      PAL.push(RAMPS[name][i]);
      RAMP_OF[PAL.length - 1] = { base: name, step: i };
    });
  }
})();

/* 半透明：落地影 */
const PAL_ALPHA = {};
PAL_ALPHA[PAL_INDEX['sh.m']] = 90;

/* ---------------- 角色 → 颜色 ---------------- */
/* 小写 = 暗档，首字母大写 = 亮档；a/A/S 与 m/M/H 是阵营色 */
const ROLE_FIXED = {
  x: 'sh.m',
  k: 'ink.d', K: 'ink.m', W: 'ink.h',
  t: 'stl.d', l: 'stl.m', L: 'stl.l',
  f: 'skn.m', F: 'skn.l',
  r: 'fir.m', R: 'fir.h',
  y: 'pwr.m', Y: 'pwr.h',
  c: 'pri.m', C: 'pri.h',
  g: 'wnd.m', G: 'wnd.l',
  n: 'con.m', N: 'con.l',
  u: 'ruf.m', U: 'ruf.l',
  o: 'lab.m', O: 'lab.l',
  j: 'tes.m', J: 'tes.h',
};

const FACTION = {
  player: { cloth: 'pcl', paint: 'pmt' },
  enemy: { cloth: 'ecl', paint: 'emt' },
};
/* 阵营角色：a/A/S 布料，m/M/H 漆面金属 */
const ROLE_FACTION = {
  a: ['cloth', 'd'], A: ['cloth', 'm'], S: ['cloth', 'l'],
  m: ['paint', 'd'], M: ['paint', 'm'], H: ['paint', 'l'],
};

function roleColor(ch, side) {
  if (ch === '.') return -1;
  const f = ROLE_FACTION[ch];
  if (f) {
    const ramp = (FACTION[side] || FACTION.player)[f[0]];
    return PAL_INDEX[ramp + '.' + f[1]];
  }
  const fixed = ROLE_FIXED[ch];
  return fixed === undefined ? PAL_INDEX['ink.m'] : PAL_INDEX[fixed];
}

/* ============================================================
   像素缓冲
   ============================================================ */

function B(w, h) {
  return { w: w, h: h, a: new Int16Array(w * h).fill(-1) };
}
function idx(b, x, y) { return (x < 0 || y < 0 || x >= b.w || y >= b.h) ? -1 : y * b.w + x; }
function at(b, x, y) { const i = idx(b, x, y); return i < 0 ? -1 : b.a[i]; }
function put(b, x, y, c) { const i = idx(b, x, y); if (i >= 0) b.a[i] = c; }
function rect(b, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(b, x + i, y + j, c); }

function disc(b, cx, cy, r, c) {
  for (let j = -r; j <= r; j++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - j * j)));
    for (let i = -w; i <= w; i++) put(b, cx + i, cy + j, c);
  }
}
function ring(b, cx, cy, r, c) {
  for (let a = 0; a < 360; a += 5) {
    put(b, Math.round(cx + Math.cos(a * Math.PI / 180) * r),
        Math.round(cy + Math.sin(a * Math.PI / 180) * r), c);
  }
}
function line(b, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    put(b, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

function flipX(s) {
  const b = B(s.w, s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) put(b, s.w - 1 - x, y, at(s, x, y));
  return b;
}
function rot90(s) {
  const b = B(s.h, s.w);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) put(b, s.h - 1 - y, x, at(s, x, y));
  return b;
}
function rot180(s) { return rot90(rot90(s)); }

function bump(c, dir) {
  const r = RAMP_OF[c];
  if (!r) return c;
  const s = Math.max(0, Math.min(3, r.step + dir));
  return PAL_INDEX[r.base + '.' + ['d', 'm', 'l', 'h'][s]];
}

/** 把某个 ramp 整体压暗一档（只用于炮塔，让它从车体里分出来） */
function shadeDown(b, base) {
  for (let i = 0; i < b.a.length; i++) {
    const r = RAMP_OF[b.a[i]];
    if (r && r.base === base && r.step > 0) b.a[i] = PAL_INDEX[base + '.' + ['d', 'm', 'l', 'h'][r.step - 1]];
  }
  return b;
}

/** 上/左边缘提亮、下/右边缘压暗：参数化的方块靠这一层才有体积 */
function bevel(b) {
  const src = Int16Array.from(b.a);
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const c = src[y * b.w + x];
      if (c < 0) continue;
      if (at(b, x, y - 1) < 0 || at(b, x - 1, y) < 0) put(b, x, y, bump(c, 1));
      else if (at(b, x, y + 1) < 0 || at(b, x + 1, y) < 0) put(b, x, y, bump(c, -1));
    }
  }
}

/** 外轮廓描边（透明像素贴着实色的涂 ink） */
function outline(b, c) {
  const src = Int16Array.from(b.a);
  const ink = c === undefined ? PAL_INDEX['ink.m'] : c;
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (src[y * b.w + x] >= 0) continue;
      if (at(b, x - 1, y) >= 0 || at(b, x + 1, y) >= 0 ||
          at(b, x, y - 1) >= 0 || at(b, x, y + 1) >= 0) put(b, x, y, ink);
    }
  }
}

/* ============================================================
   字符网格 → 缓冲
   ------------------------------------------------------------
   行长度不一致会在控制台直接报出来，不用等到画面上发现缺角。
   ============================================================ */

const GRID_ERRORS = [];

function grid(rows, side) {
  const h = rows.length;
  let w = 0;
  for (let i = 0; i < h; i++) w = Math.max(w, rows[i].length);
  const b = B(w, h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    if (row.length !== w) GRID_ERRORS.push('行 ' + y + ' 长 ' + row.length + '，应为 ' + w + '：' + row);
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ' ') continue;
      put(b, x, y, roleColor(ch, side));
    }
  }
  return b;
}

/* ============================================================
   步兵精灵（16×16，正面 / 侧面 / 背面各画一次，W 由 E 镜像）
   ------------------------------------------------------------
   角色：k K = 描边与枪身，W = 履带/高光金属，a A S = 军服，
        m M H = 漆面，f F = 皮肤，r R = 红色标识，y Y = 黄
   ============================================================ */

const INF = {};

/* --- 美国大兵：M1 钢盔 + 步枪，站姿 --- */
INF.gi = {
  size: 16,
  S: [
    '................',
    '....kkkkkk......',
    '...kAAAAAAk.....',
    '..kAAAAAAAAk....',
    '..kAAkkkkAAk....',
    '..kffffffffk....',
    '..kFkffFFkFfk...',
    '...kffffffk.....',
    '..kAAAAAAkk.....',
    '.kAAAAAAAAAk....',
    '.kAAAAAAAAAk....',
    '.kWkAAAAAAkWWk..',
    '..kWkAAAAkWWk...',
    '...kAAkkAAk.....',
    '...kAAk.kAAk....',
    '....kk...kk.....',
  ],
  N: [
    '................',
    '....kkkkkk......',
    '...kAAAAAAk.....',
    '..kAAAAAAAAk....',
    '..kAAAAAAAAk...W',
    '..kAASSSSAAk..L.',
    '..kAAAAAAAAk..l.',
    '...kAAAAAAk..l..',
    '..kAAAAAAkk..l..',
    '.kAAAAAAAAAkl...',
    '.kAAKKKKKKAlk...',
    '.kWkAKKKKAlKWk..',
    '..kWkAAAAtWWk...',
    '...kAAkktAk.....',
    '...kAAk.kAAk....',
    '....kk...kk.....',
  ],
  E: [
    '................',
    '.....kkkk.......',
    '....kAAAKk......',
    '...kAAAAAAk.....',
    '...kAkkkAAk.....',
    '...kAAAFFfk.....',
    '...kAAAAAAk.....',
    '....kAAAAk......',
    '...kAAAAAk......',
    '..kAAAAAAk......',
    '..kAAAAAAkWkkkkk',
    '..kAAAAAAkLWW...',
    '...kAAAAk.......',
    '...kAAkAAk......',
    '...kAk..kAk.....',
    '...kk....kk.....',
  ],
};

/* --- 动员兵：棉帽（带护耳）+ 弹鼓冲锋枪，体型更壮 --- */
INF.conscript = {
  size: 16,
  S: [
    '................',
    '....kkkkkk......',
    '...kmmmmmmk.....',
    '..kmmRRRRmmk....',
    '..kmmmmmmmmk....',
    '..kffffffffk....',
    '..kfKffffKfk....',
    '...kffffffk.....',
    '..kAAAAAAkk.....',
    '.kAAAAAAAAAk....',
    '.kAAaAAAAaAk....',
    '.kWkAAAAAAkWWk..',
    '..kWkAAAAkWWk...',
    '...kAAkkAAk.....',
    '...kAAk.kAAk....',
    '....kk...kk.....',
  ],
  N: [
    '................',
    '....kkkkkk......',
    '...kmmmmmmk.....',
    '..kmmmmmmmmk....',
    '..kmmmmmmmmk....',
    '..kmmmmmmmmk....',
    '..kAAAAAAAAk....',
    '...kAAAAAAk.....',
    '..kAAAAAAkk.....',
    '.kAAAAAAAAAk....',
    '.kAAKKKKKKAAk...',
    '.kWkAKKKKKAKWk..',
    '..kWkAAAAkWWk...',
    '...kAAkkAAk.....',
    '...kAAk.kAAk....',
    '....kk...kk.....',
  ],
  E: [
    '................',
    '.....kkkk.......',
    '....kmmmk.......',
    '...kmmmmmk......',
    '...kmmmmmkk.....',
    '...kAAAFFfk.....',
    '...kAAAAAAk.....',
    '....kAAAAk......',
    '...kAAAAAk......',
    '..kAAAAAAk......',
    '..kAAAAAAkWkk...',
    '..kAAAAAAkLWW...',
    '...kAAAAk.......',
    '...kAAkAAk......',
    '...kAk..kAk.....',
    '...kk....kk.....',
  ],
};

/* --- 火箭兵：单膝跪，发射筒扛在右肩上，弹头红 --- */
INF.rocket = {
  size: 16,
  S: [
    '................',
    '................',
    '....kkkkkk......',
    '...kAAAAAAk.....',
    '..kAAkkkkAAk....',
    '..kffffffffk....',
    '..kfKffFFkFfk...',
    '...kffffffk.....',
    '..kAAAAAAAk.....',
    '.kAAAAAAAAAk....',
    '.kAAaaaaAAAk....',
    '.kAAAAAAAAAk....',
    '..kAAaaaaAAkkkkk',
    '..kAAk....kArRk.',
    '..kAAk.....kkk..',
    '...kk...........',
  ],
  N: [
    '................',
    '................',
    '....kkkkkk......',
    '...kAAAAAAk.....',
    '..kAAAAAAAAk....',
    '..kAASSSSAAk....',
    '..kAAAAAAAAk....',
    '...kAAAAAAk.....',
    '..kAAAAAAAk.....',
    '.kAAAAAAAAAk....',
    '.kAAKKKKKKAAk...',
    '.kAAAAAAAAAk....',
    '..kAAaaaaAAkkkkk',
    '..kAAk....kArRk.',
    '..kAAk.....kkk..',
    '...kk...........',
  ],
  E: [
    '................',
    '................',
    '.....kkkk.......',
    '....kAAAKk......',
    '...kAAAAAAk.....',
    '...kAAkkAAk.....',
    '...kAAAAFFk.....',
    '....kAAAAk......',
    '...kAAAAAk......',
    '..kAAAAAAk......',
    '..kAAAAAAk......',
    '..kAAAAAAkk.....',
    '..kAAAAAAkLkkkkk',
    '..kAAk....kkrRk.',
    '..kAAk.....kkk..',
    '...kk...........',
  ],
};

/* --- 谭雅：贝雷帽 + 双枪，露腰，只朝前时看得出脸 --- */
INF.tanya = {
  size: 16,
  S: [
    '................',
    '....kkkkkk......',
    '...kooOOook.....',
    '..kooooooooo....',
    '..kFFFFFFFFk....',
    '..kFkkFFkkFk....',
    '...kFFFFFFk.....',
    '...kKKKKKKk.....',
    '..kKKKKKKKKk....',
    '..kFkKKKKkFk....',
    '..kFkKKKKkFk....',
    '..kAAAAAAAAk....',
    '.kWkAAAAAAkWk...',
    '.kWkAAAAAAkWk...',
    '..kAAk..kAAk....',
    '...kk....kk.....',
  ],
  N: [
    '................',
    '....kkkkkk......',
    '...kooOOook.....',
    '..kooooooooo....',
    '..kFFFFFFFFk....',
    '..kFFFFFFFFk....',
    '...kFFFFFFk.....',
    '...kKKKKKKk.....',
    '..kKKKKKKKKk....',
    '..kFkKKKKkFk....',
    '..kFkKKKKkFk....',
    '..kAAAAAAAAk....',
    '.kWkAAAAAAkWk...',
    '.kWkAAAAAAkWk...',
    '..kAAk..kAAk....',
    '...kk....kk.....',
  ],
  E: [
    '................',
    '.....kkkk.......',
    '....kooook......',
    '...kooooook.....',
    '...koooooakk....',
    '...kFFFFFfk.....',
    '...kFFFFFFk.....',
    '....kKKKKk......',
    '...kKKKKKk......',
    '..kKKKKKKk......',
    '..kKKKKKKk......',
    '..kAAAAAAk......',
    '..kAAAAAAkWkkkkk',
    '..kAAk....kLWW..',
    '..kAAk....k.....',
    '...kk...........',
  ],
};

/* ============================================================
   车辆精灵（20×20；车体朝 S 画一次，其余朝向旋转得到；
   炮塔单独一张，炮管朝 S）
   ------------------------------------------------------------
   车体用代码拼，炮塔手画。分工的理由很实在：
     · 顶视图里坦克之所以画成箱子，是因为「前后同宽 + 甲板同色」。
       修好这两件事的活（梯状履带、尾部发动机格栅、首部斜甲板、车灯）
       全是重复劳动，交给代码既不会写错行长，也保证几种车型共用骨架。
     · 炮塔才是识别特征 —— 单管 / 双管 / 晶体 / 舱盖，一像素一像素画。
   ============================================================ */

const VEH = {};

/**
 * 车体骨架（朝 S：炮管那头是「前」，在画面下方）。
 * 漆面走三档：m = 裙板阴影，M = 甲板，H = 首部受光。
 * @param o {trackW 单侧履带宽度, bogies 四组路轮, grill 格栅结束行,
 *           glacis 首部斜甲板起始行, lamps 车灯, star 甲板红星, boxes 红盖箱体,
 *           inset 整台车往内收几格（轻型车窄、重型车占满 20 格）}
 */
function hullOf(o) {
  o = o || {};
  const N = 20;
  const ins = o.inset || 0;
  const W = N - ins * 2;
  const tw = o.trackW || 4;
  const hl = W - tw;
  const grill = o.grill === undefined ? 3 : o.grill;
  const glacis = o.glacis === undefined ? 14 : o.glacis;
  const pad = '....................'.slice(0, ins);
  const rows = [];

  for (let y = 0; y < N; y++) {
    let s = '';
    for (let x = 0; x < W; x++) {
      const onTrack = x < tw || x >= hl;
      const rail = x === 0 || x === tw - 1 || x === hl || x === W - 1;
      let c;
      if (onTrack) {
        /* 链节按行交替，整条履带才有「滚」的感觉；四组路轮的车型每隔四行加一颗亮节 */
        c = rail ? 'k' : ((y & 3) === 0 && o.bogies ? 'L' : (y & 1) ? 't' : 'l');
      } else if (y === 0 || y === N - 1) c = 'k';
      else if (y <= grill) c = (x & 1) ? 'm' : 'k';
      else if (y >= glacis) c = 'H';
      else c = (x === tw || x === hl - 1) ? 'm' : 'M';

      if (c === 'k') { s += c; continue; }
      if (o.lamps !== false && y === N - 3 && (x === tw + 1 || x === hl - 2)) c = 'y';
      if (o.star && y >= glacis + 1 && y <= glacis + 3) {
        const dy = y - (glacis + 1), dx = x - (W / 2 - 2);
        c = (dy === 1 && dx >= 0 && dx <= 3) || (dy !== 1 && (dx === 1 || dx === 2)) ? 'R' : 'H';
      }
      if (o.boxes && (y === glacis || y === N - 2) && (x === tw + 1 || x === hl - 2)) c = 'R';
      s += c;
    }
    rows.push(pad + s + pad);
  }
  return rows;
}

VEH.mcv = {
  hull: hullOf({ trackW: 2, grill: 2, glacis: 15 }).map((line, y) => {
    const cells = line.split('');
    if (y >= 4 && y <= 13) {
      for (let x = 3; x <= 16; x++) cells[x] = 'M';
      for (let x = 4; x <= 15; x++) {
        cells[x] = y === 4 || y === 13 ? 'k' : 'H';
      }
      cells[3] = cells[16] = 'M';
    }
    if (y >= 7 && y <= 10) {
      for (let x = 6; x <= 13; x++) cells[x] = y >= 8 && y <= 9 && x >= 8 && x <= 11 ? 'y' : 'W';
    }
    if (y === 11) {
      for (let x = 6; x <= 13; x++) cells[x] = 'l';
    }
    return cells.join('');
  }),
  turret: null,
};

/* --- 灰熊（盟军）：五对轮、炮塔偏前、尾部储物篮 --- */
VEH.grizzly = {
  hull: hullOf({ inset: 2, trackW: 3 }),
  turret: [
    '....................',
    '....................',
    '....................',
    '....................',
    '.....kkkkkkkkkk.....',
    '....kHHHHHHHHHHk....',
    '....kHMMMMMMMMHk....',
    '....kMMkkkkkkMMk....',
    '....kMMkWWWWkMMk....',
    '....kMMkkkkkkMMk....',
    '....kMMMMMMMMMMk....',
    '....kHHMMMMMMHHk....',
    '.....kkkkkkkkkk.....',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '.......KklLkK.......',
    '........klLk........',
    '........klLk........',
    '........kkkk........',
  ],
};

/* --- 犀牛（苏军）：车体更宽、首甲更早受光、甲板红星、圆炮塔长炮管 --- */
VEH.rhino = {
  hull: hullOf({ star: true, glacis: 13, inset: 1 }),
  turret: [
    '....................',
    '....................',
    '....................',
    '.....kkkkkkkkkk.....',
    '...kkHHHHHHHHHHkk...',
    '..kHHMMMMMMMMMMHHk..',
    '..kHMMkkkkkkkkMMHk..',
    '..kHMMkWWWWWWkMMHk..',
    '..kHMMkkkkkkkkMMHk..',
    '..kHMMMMMMMMMMMMHk..',
    '..kHHMMMMMMMMMMHHk..',
    '...kkHHHHHHHHHHkk...',
    '.....kkkkkkkkkk.....',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........kkkk........',
  ],
};

/* --- 天启（苏军重型）：四组路轮、双管、前部红盖箱体，全场最大 --- */
VEH.apocalypse = {
  hull: hullOf({ trackW: 5, bogies: true, boxes: true, grill: 2, glacis: 14 }),
  turret: [
    '....................',
    '....................',
    '.....kkkkkkkkkk.....',
    '...kkHHHHHHHHHHkk...',
    '..kHHMMMMMMMMMMHHk..',
    '..kHMMkkkkkkkkMMHk..',
    '..kHMMkWWWWWWkMMHk..',
    '..kHMrRkkkkkkRrMHk..',
    '..kHMMkkkkkkkkMMHk..',
    '..kHMMMMMMMMMMMMHk..',
    '..kHHMMMMMMMMMMHHk..',
    '...kkHHHHHHHHHHkk...',
    '....kkkkkkkkkkkk....',
    '.....klLk..klLk.....',
    '.....klLk..klLk.....',
    '.....klLk..klLk.....',
    '.....klLk..klLk.....',
    '.....klLk..klLk.....',
    '.....kkkk..kkkk.....',
    '....................',
  ],
};

/* --- 多功能步兵车：四轮、车头在下、大挡风玻璃、顶置机枪 --- */
VEH.ifv = {
  hull: [
    '....kkkkkkkkkkkk....',
    '...kMMMMMMMMMMk.....',
    '..kkMMMMMMMMMMkk....',
    '..klMMMMMMMMMMLk....',
    '..kkMMMMMMMMMMkk....',
    '...kMMMMMMMMMMk.....',
    '...kMMMMMMMMMMk.....',
    '...kMMMMMMMMMMk.....',
    '...kMMMMMMMMMMk.....',
    '...kMMMMMMMMMMk.....',
    '...kMMMMMMMMMMk.....',
    '...kMMMMMMMMMMk.....',
    '..kkMMMMMMMMMMkk....',
    '..klMMMMMMMMMMLk....',
    '..kkMMMMMMMMMMkk....',
    '...kMMMMMMMMMMk.....',
    '...kggggggggggk.....',
    '...kGGGGGGGGGGk.....',
    '...kMMMMMMMMMMk.....',
    '....kkkkkkkkkkkk....',
  ],
  turret: [
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '......kkkkkkkk......',
    '......kMMMMMMk......',
    '......kMllllMk......',
    '......kMMMMMMk......',
    '......kMMMMMMk......',
    '......kkkkkkkk......',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........klLk........',
    '........kkkk........',
  ],
};

/* --- 光棱坦克：轻底盘 + 顶上一块发光晶体（晶体就是它的全部识别特征） --- */
VEH.prism = {
  hull: hullOf({ grill: 2, glacis: 15, inset: 3, trackW: 3 }),
  turret: [
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '........KKKK........',
    '......KKccccKK......',
    '.....KccCCCCccK.....',
    '.....KcCCCCCCcK.....',
    '.....KcCCwwCCcK.....',
    '.....KccCCCCccK.....',
    '......KKccccKK......',
    '........KKKK........',
    '.......KLLLLK.......',
    '.......KLLLLK.......',
    '......KLLLLLLK......',
    '......KLLLLLLK......',
    '.......KKKKKK.......',
    '....................',
    '....................',
  ],
};

/* --- 恐怖机器人：六条腿 + 小红眼，没有炮塔 --- */
VEH.terror = {
  size: 20,
  hull: [
    '....................',
    '..k..............k..',
    '...k....kkkk....k...',
    '....k..KMMMMK..k....',
    '.....kKMMMMMMKk.....',
    '......KMrRrMK.......',
    '.....KMMMMMMMMK.....',
    '....KMMMMkkMMMMK....',
    '...KMMMkKKKKkMMMK...',
    '..kMMMKKKKKKKKMMMK..',
    '..KMMMMMMMMMMMMMMK..',
    '..kMMMKKKKKKKKMMMK..',
    '...KMMMkKKKKkMMMK...',
    '....KMMMMkkMMMMK....',
    '.....KMMMMMMMMK.....',
    '......KMkrrkMK......',
    '.....kKMMMMMMKk.....',
    '....k..KMMMMK..k....',
    '...k....kkkk....k...',
    '..k..............k..',
  ],
  turret: null,
};

/* ============================================================
   建筑：参数化，沿用单文件版验证过的设计语言
   ------------------------------------------------------------
   底座混凝土 → 屋顶瓦 → 接缝 → 四角铆钉 → 阵营描边 → 地标件
   ============================================================ */

function building(o) {
  const s = o.size * 24;
  const b = B(s, s);

  /* 外圈：描边 + 阵营色包边，远看先看到占地形状 */
  rect(b, 0, 0, s, s, PAL_INDEX['ink.m']);
  rect(b, 1, 1, s - 2, s - 2, PAL_INDEX['stl.d']);
  rect(b, 2, 2, s - 4, s - 4, PAL_INDEX['con.m']);

  /* 屋顶 + 接缝 */
  rect(b, 3, 3, s - 6, s - 6, PAL_INDEX[o.roof || 'con.l']);
  for (let x = 8; x < s - 5; x += 9) rect(b, x, 5, 1, s - 10, PAL_INDEX['con.d']);
  for (let y = 10; y < s - 6; y += 8) rect(b, 5, y, s - 10, 1, PAL_INDEX['con.d']);

  /* 四角铆钉 */
  const riv = PAL_INDEX['stl.d'];
  rect(b, 4, 4, 2, 2, riv); rect(b, s - 6, 4, 2, 2, riv);
  rect(b, 4, s - 6, 2, 2, riv); rect(b, s - 6, s - 6, 2, 2, riv);

  /* 受光/背光：上边亮、下边暗 */
  rect(b, 3, 3, s - 6, 2, PAL_INDEX['con.l']);
  rect(b, 3, s - 5, s - 6, 2, PAL_INDEX['con.d']);

  const cx = s / 2;
  const kind = o.kind;

  if (kind === 'powerplant') {
    /* 电厂：中央变压器 + 黄色电缆 + 两侧散热管 */
    rect(b, cx - 9, 8, 18, 14, PAL_INDEX['stl.m']);
    rect(b, cx - 9, 8, 18, 2, PAL_INDEX['stl.l']);
    rect(b, cx - 7, 10, 14, 10, PAL_INDEX['ink.m']);
    for (let i = 0; i < 3; i++) {
      disc(b, cx - 4 + i * 4, 15, 2, PAL_INDEX['pwr.m']);
      put(b, cx - 4 + i * 4, 15, PAL_INDEX['pwr.h']);
    }
    rect(b, 4, s - 12, s - 8, 5, PAL_INDEX['stl.d']);
    for (let x = 5; x < s - 5; x += 3) rect(b, x, s - 11, 1, 3, PAL_INDEX['pwr.m']);
    rect(b, 5, 5, 3, 6, PAL_INDEX['stl.l']);
    rect(b, s - 8, 5, 3, 6, PAL_INDEX['stl.l']);
  } else if (kind === 'barracks') {
    /* 兵营：三个亮窗 + 沙袋门洞 */
    rect(b, 6, 7, s - 12, 8, PAL_INDEX['stl.m']);
    for (let i = 0; i < 3; i++) {
      rect(b, 8 + i * ((s - 20) / 3 | 0), 9, 4, 4, PAL_INDEX['wnd.l']);
      rect(b, 8 + i * ((s - 20) / 3 | 0), 9, 4, 1, PAL_INDEX['wnd.m']);
    }
    rect(b, cx - 4, s - 9, 8, 6, PAL_INDEX['ink.m']);
    rect(b, cx - 4, s - 9, 8, 1, PAL_INDEX['stl.l']);
    for (let i = 0; i < 4; i++) rect(b, 4 + i * 4, s - 5, 4, 3, PAL_INDEX['dirt.m']);
  } else if (kind === 'warfactory') {
    /* 战车工厂：上部检修房 + 下部大卷帘门（门缝别太密，缩到一格里会糊） */
    rect(b, 6, 6, s - 12, 14, PAL_INDEX['con.m']);
    for (let x = 9; x < s - 10; x += 8) rect(b, x, 10, 4, 5, PAL_INDEX['wnd.m']);
    for (let x = 9; x < s - 10; x += 8) rect(b, x, 10, 4, 2, PAL_INDEX['wnd.l']);
    rect(b, 6, 6, s - 12, 2, PAL_INDEX['con.l']);
    rect(b, 8, 22, s - 16, s - 34, PAL_INDEX['stl.d']);
    for (let y = 24; y < s - 13; y += 4) rect(b, 9, y, s - 18, 2, PAL_INDEX['stl.m']);
    rect(b, 9, 23, s - 18, 1, PAL_INDEX['stl.l']);
    rect(b, cx - 8, s - 9, 16, 4, PAL_INDEX['pwr.m']);
    for (let x = cx - 8; x < cx + 8; x += 4) rect(b, x, s - 8, 2, 2, PAL_INDEX['ink.m']);
  } else if (kind === 'lab') {
    /* 实验室：下部厂房 + 上部紫圆顶。紫是识别色，但铺满整格就成了色块 */
    rect(b, 7, 36, s - 14, s - 44, PAL_INDEX['con.m']);
    for (let x = 10; x < s - 11; x += 7) rect(b, x, 42, 4, 6, PAL_INDEX['wnd.m']);
    for (let x = 10; x < s - 11; x += 7) rect(b, x, 42, 4, 2, PAL_INDEX['wnd.l']);
    rect(b, 7, 36, s - 14, 2, PAL_INDEX['con.l']);
    rect(b, cx - 5, s - 11, 10, 5, PAL_INDEX['ink.m']);
    disc(b, cx, 26, 16, PAL_INDEX['lab.d']);
    disc(b, cx, 25, 14, PAL_INDEX['lab.m']);
    disc(b, cx, 23, 10, PAL_INDEX['lab.l']);
    disc(b, cx - 4, 19, 3, PAL_INDEX['lab.h']);
    ring(b, cx, 26, 18, PAL_INDEX['stl.l']);
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4;
      rect(b, Math.round(cx + Math.cos(ang) * 18) - 1,
              Math.round(26 + Math.sin(ang) * 18) - 1, 2, 2, PAL_INDEX['pwr.m']);
    }
  } else if (kind === 'pillbox') {
    /* 碉堡：厚混凝土 + 射击孔 + 前出沙袋 */
    rect(b, 4, 4, 16, 16, PAL_INDEX['con.d']);
    rect(b, 5, 5, 14, 14, PAL_INDEX['con.l']);
    rect(b, 7, 10, 10, 4, PAL_INDEX['ink.m']);
    rect(b, 9, 11, 6, 1, PAL_INDEX['ink.h']);
    for (let i = 0; i < 3; i++) rect(b, 4 + i * 6, 2, 5, 2, PAL_INDEX['dirt.m']);
  } else if (kind === 'prismtower') {
    /* 光棱塔：钢基 + 悬浮菱形晶体（菱形 = 和磁暴的圆球一眼分开） */
    rect(b, 6, 17, 12, 5, PAL_INDEX['stl.d']);
    rect(b, 6, 17, 12, 1, PAL_INDEX['stl.l']);
    const HW = [1, 2, 3, 4, 3, 2, 1];
    for (let i = 0; i < 7; i++) {
      rect(b, 12 - HW[i], 5 + i, HW[i] * 2, 1, i <= 2 ? PAL_INDEX['pri.l'] : PAL_INDEX['pri.m']);
    }
    rect(b, 11, 7, 2, 2, PAL_INDEX['pri.h']);
    line(b, 12, 12, 12, 17, PAL_INDEX['pri.d']);
  } else if (kind === 'teslacoil') {
    /* 磁暴线圈：三层宽绝缘盘 + 顶端电极 + 两侧放电叉 */
    rect(b, 8, 15, 8, 7, PAL_INDEX['stl.d']);
    for (let i = 0; i < 3; i++) rect(b, 6, 16 + i * 2, 12, 1, PAL_INDEX['stl.m']);
    rect(b, 11, 6, 2, 9, PAL_INDEX['stl.l']);
    disc(b, 12, 5, 3, PAL_INDEX['tes.m']);
    put(b, 12, 4, PAL_INDEX['tes.h']);
    rect(b, 7, 2, 2, 3, PAL_INDEX['tes.l']);
    rect(b, 15, 2, 2, 3, PAL_INDEX['tes.l']);
  }

  bevel(b);
  outline(b, PAL_INDEX['ink.d']);
  return b;
}

/* 基地（4×4）：指挥中心 —— 中央塔 + 四角灯 + 两侧厂房 */
function baseSprite() {
  const s = 96;
  const b = B(s, s);

  rect(b, 0, 0, s, s, PAL_INDEX['ink.m']);
  rect(b, 2, 2, s - 4, s - 4, PAL_INDEX['con.m']);
  rect(b, 4, 4, s - 8, s - 8, PAL_INDEX['con.l']);
  rect(b, 4, 4, s - 8, 3, PAL_INDEX['con.h']);
  rect(b, 4, s - 7, s - 8, 3, PAL_INDEX['con.d']);

  /* 屋顶接缝 */
  for (let x = 10; x < s - 8; x += 10) rect(b, x, 8, 1, s - 16, PAL_INDEX['con.d']);
  for (let y = 14; y < s - 10; y += 10) rect(b, 8, y, s - 16, 1, PAL_INDEX['con.d']);

  /* 中央指挥塔 */
  rect(b, s / 2 - 16, s / 2 - 16, 32, 32, PAL_INDEX['stl.d']);
  rect(b, s / 2 - 14, s / 2 - 14, 28, 28, PAL_INDEX['stl.m']);
  rect(b, s / 2 - 14, s / 2 - 14, 28, 2, PAL_INDEX['stl.l']);
  disc(b, s / 2, s / 2, 9, PAL_INDEX['pmt.m']);
  disc(b, s / 2, s / 2, 5, PAL_INDEX['pwr.m']);
  disc(b, s / 2, s / 2, 2, PAL_INDEX['pwr.h']);
  ring(b, s / 2, s / 2, 12, PAL_INDEX['stl.h']);

  /* 四角：探照灯柱 */
  for (const c of [[12, 12], [s - 12, 12], [12, s - 12], [s - 12, s - 12]]) {
    rect(b, c[0] - 4, c[1] - 4, 8, 8, PAL_INDEX['stl.d']);
    rect(b, c[0] - 3, c[1] - 3, 6, 6, PAL_INDEX['pwr.m']);
    put(b, c[0], c[1], PAL_INDEX['pwr.h']);
  }

  /* 两侧厂房 + 卷帘门 */
  rect(b, 6, s / 2 - 10, 12, 20, PAL_INDEX['ruf.m']);
  rect(b, s - 18, s / 2 - 10, 12, 20, PAL_INDEX['ruf.m']);
  rect(b, 8, s / 2 + 4, 8, 6, PAL_INDEX['ink.m']);
  rect(b, s - 16, s / 2 + 4, 8, 6, PAL_INDEX['ink.m']);

  /* 门口黄黑警戒条 */
  for (let x = s / 2 - 14; x < s / 2 + 14; x += 6) {
    rect(b, x, s - 12, 3, 3, PAL_INDEX['pwr.m']);
    rect(b, x + 3, s - 12, 3, 3, PAL_INDEX['ink.d']);
  }

  bevel(b);
  outline(b, PAL_INDEX['ink.d']);
  return b;
}

/* ============================================================
   图集
   ============================================================ */

HJ.Pixel = {
  ART: 24,
  PAL: PAL,
  PAL_INDEX: PAL_INDEX,
  RAMPS: RAMPS,
  ROLE_FIXED: ROLE_FIXED,
  errors: GRID_ERRORS,

  atlas: null,
  frames: {},
  baked: false,

  /* 单位形状 id → 用哪套精灵；两侧共用 */
  SHAPES: {
    gi: 'gi', conscript: 'conscript', rocket: 'rocket', tanya: 'tanya',
    grizzly: 'grizzly', rhino: 'rhino', ifv: 'ifv', prism: 'prism',
    apocalypse: 'apocalypse', terror: 'terror', mcv: 'mcv',
  },

  shapeOf(defId) { return this.SHAPES[defId] || 'gi'; },

  /** 身体（步兵整套 / 车辆车体）的帧 key */
  bodyKey(u, dir) {
    const fam = u.kind === 'infantry' ? 'inf' : 'veh';
    return fam + ':' + u.side + ':' + this.shapeOf(u.defId) + ':' + dir;
  },
  /** 炮塔帧 key；没有炮塔的单位返回 null，调用方就不用贴第二层 */
  turretKey(u, dir) {
    if (u.kind !== 'vehicle') return null;
    const shape = this.SHAPES[u.defId];
    if (shape === 'terror' || shape === 'mcv') return null;
    return 'tur:' + u.side + ':' + (shape || 'grizzly') + ':' + dir;
  },
  buildingKey(defId) { return 'bld:' + defId; },

  has(key) { return !!this.frames[key]; },

  /** 方向向量 → 4 朝向。像素画只能这么粗 */
  facing(dx, dy) {
    if (!isFinite(dx) || !isFinite(dy)) return 'S';
    if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'S' : 'N';
    return dx >= 0 ? 'E' : 'W';
  },

  /** 车体/步兵的朝向：跟着走过的方向。没走过就维持上一次 */
  moveDir(u) {
    if (u.faceX || u.faceY) return this.facing(u.faceX, u.faceY);
    if (u.aimX || u.aimY) return this.facing(u.aimX, u.aimY);
    return 'S';
  },
  /** 炮塔朝向：最近一次开火瞄的方向 */
  aimDir(u) {
    if (u.aimX || u.aimY) return this.facing(u.aimX, u.aimY);
    return this.moveDir(u);
  },

  /**
   * 以「中心点」贴一个精灵。scale 必须是整数（美术像素 → 屏幕像素），
   * 位置取整，否则最近邻会糊成一片。
   */
  stampCentered(ctx, key, cx, cy, scale, alpha) {
    const f = this.frames[key];
    if (!f) return false;
    const w = f.w * scale, h = f.h * scale;
    if (alpha !== undefined && alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(this.atlas, f.x, f.y, f.w, f.h,
      Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
    if (alpha !== undefined && alpha < 1) ctx.globalAlpha = 1;
    return true;
  },

  /* ---------------- 烘焙 ---------------- */

  sprites() {
    const out = [];
    const add = (key, buf, ox, oy) => out.push({ key, buf, ox, oy });

    /* 步兵：一套网格，两侧各烘一次（布料/漆面换 ramp） */
    for (const side in FACTION) {
      for (const id in INF) {
        const def = INF[id];
        const S = grid(def.S, side);
        const N = grid(def.N, side);
        const E = grid(def.E, side);
        const W = flipX(E);
        add('inf:' + side + ':' + id + ':S', S);
        add('inf:' + side + ':' + id + ':N', N);
        add('inf:' + side + ':' + id + ':E', E);
        add('inf:' + side + ':' + id + ':W', W);
      }
    }

    /* 车辆：车体 4 朝向靠旋转，炮塔单独 4 朝向。
       手写的是 S（车头朝下），rot90 是顺时针 → 车头朝左 = W，
       所以 E 要反过来转 270°，别写反，否则车往右开、车头朝左。 */
    for (const side in FACTION) {
      for (const id in VEH) {
        const def = VEH[id];
        const hull = grid(def.hull, side);
        add('veh:' + side + ':' + id + ':S', hull);
        add('veh:' + side + ':' + id + ':W', rot90(hull));
        add('veh:' + side + ':' + id + ':N', rot180(hull));
        add('veh:' + side + ':' + id + ':E', rot90(rot180(hull)));
        if (def.turret) {
          /* 炮塔比车体暗一档：同一个阵营色，不然整车糊成一坨同色块 */
          const tur = shadeDown(grid(def.turret, side), FACTION[side].paint);
          add('tur:' + side + ':' + id + ':S', tur);
          add('tur:' + side + ':' + id + ':W', rot90(tur));
          add('tur:' + side + ':' + id + ':N', rot180(tur));
          add('tur:' + side + ':' + id + ':E', rot90(rot180(tur)));
        }
      }
    }

    /* 建筑 */
    const BLD = {
      powerplant: { size: 2, kind: 'powerplant', roof: 'con.l' },
      barracks: { size: 2, kind: 'barracks', roof: 'ruf.m' },
      warfactory: { size: 3, kind: 'warfactory', roof: 'con.l' },
      lab: { size: 3, kind: 'lab', roof: 'con.l' },
      pillbox: { size: 1, kind: 'pillbox' },
      prismtower: { size: 1, kind: 'prismtower' },
      teslacoil: { size: 1, kind: 'teslacoil' },
    };
    for (const id in BLD) add('bld:' + id, building(BLD[id]));
    add('bld:base', baseSprite());

    return out;
  },

  bake() {
    const list = this.sprites();
    const MAXW = 512;
    let x = 0, y = 0, rowH = 0;

    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');

    /* 先算位置，才能算画布高度 */
    const placed = [];
    for (const it of list) {
      if (x + it.buf.w + 2 > MAXW) { x = 0; y += rowH + 2; rowH = 0; }
      placed.push({ key: it.key, buf: it.buf, x: x, y: y });
      x += it.buf.w + 2;
      rowH = Math.max(rowH, it.buf.h);
    }
    cv.width = MAXW;
    cv.height = y + rowH + 2;

    const img = ctx.createImageData(cv.width, cv.height);
    const d = img.data;
    for (const p of placed) {
      const b = p.buf;
      for (let j = 0; j < b.h; j++) {
        for (let i = 0; i < b.w; i++) {
          const c = b.a[j * b.w + i];
          if (c < 0) continue;
          const hex = PAL[c];
          const o = ((p.y + j) * cv.width + (p.x + i)) * 4;
          d[o] = parseInt(hex.substr(1, 2), 16);
          d[o + 1] = parseInt(hex.substr(3, 2), 16);
          d[o + 2] = parseInt(hex.substr(5, 2), 16);
          d[o + 3] = PAL_ALPHA[c] === undefined ? 255 : PAL_ALPHA[c];
        }
      }
      this.frames[p.key] = { x: p.x, y: p.y, w: b.w, h: b.h };
    }
    ctx.putImageData(img, 0, 0);
    this.atlas = cv;
    this.baked = true;

    if (GRID_ERRORS.length) console.warn('[pixel] 字符网格行长不一致：\n  ' + GRID_ERRORS.join('\n  '));
    return cv;
  },

  /* ---------------- 地形 tile ---------------- */

  tileCanvas: null,

  bakeTerrain() {
    const A = this.ART;
    const list = HJ.Terrain.list;

    /* 每种地形一张「配方」。全部从 ramp 的四个档位取色：
       patch = 4×4 粗斑的候选色，grain = 细颗粒的暗/亮两档，decor = 点缀。
       地面靠「成片」而不是「逐像素随机」才像土地 —— 雪花噪点在手机上一糊就是脏。 */
    /* 每种地形的配方。
       base = 地面主色（占多数），alt = [偏亮一块, 偏暗一块]。
       一格 24 像素在手机上就是 1:1，主色必须稳，靠大块色差而不是碎点，
       否则整张地图变成一片脏噪声。 */
    const SCHEME = {
      plain: { base: 'dirt.m', alt: ['dirt.l', 'dirt.d'], decor: [['pebble', 1], ['tuft', 1]] },
      grass: { base: 'grs.m', alt: ['grs.l', 'grs.d'], decor: [['tuft', 3], ['pebble', 1]] },
      sand: { base: 'dirt.l', alt: ['dirt.h', 'dirt.m'], decor: [['ripple', 2]] },
      road: { base: 'rock.m', alt: ['rock.l', 'rock.d'], decor: [['crack', 1]], pave: true },
      forest: { base: 'grs.d', alt: ['grs.m', 'ink.d'], decor: [['tree', 2], ['tuft', 1]] },
      rock: { base: 'rock.d', alt: ['rock.m', 'ink.d'], decor: [['boulder', 1], ['crack', 1]] },
      water: { base: 'wat.m', alt: ['wat.l', 'wat.d'], decor: [['wave', 3]] },
      bridge: { base: 'rock.l', alt: ['rock.m', 'rock.d'], decor: [['crack', 1]], pave: true },
    };

    let seed = 20261123;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const P = (name) => PAL_INDEX[name];

    const DECOR = {
      /* 一颗小石子：相对局部色提亮/压暗，落在哪种地上都不会跳色 */
      pebble(b, x, y) {
        put(b, x, y, bump(at(b, x, y), 2));
        put(b, x + 1, y, bump(at(b, x + 1, y), 1));
        put(b, x, y + 1, bump(at(b, x, y + 1), -1));
        put(b, x + 1, y + 1, bump(at(b, x + 1, y + 1), -2));
      },
      /* 一撮草：三根叶尖 + 根部阴影 */
      tuft(b, x, y) {
        put(b, x - 1, y - 1, P('grs.m'));
        put(b, x - 1, y - 2, P('grs.l'));
        put(b, x, y - 2, P('grs.l'));
        put(b, x, y - 1, P('grs.l'));
        put(b, x + 1, y - 1, P('grs.m'));
        put(b, x, y, P('grs.d'));
        put(b, x + 1, y, P('grs.d'));
      },
      /* 沙纹 / 水波：一条两三段起伏的亮线，下面压一条暗线 */
      ripple(b, x, y, w, hi, lo) {
        for (let i = 0; i < w; i++) {
          const j = i % 4 < 2 ? 0 : 1;
          put(b, x + i, y - j, P(hi));
          put(b, x + i, y + 1 - j, P(lo));
        }
      },
      wave(b, x, y) { DECOR.ripple(b, x, y, 4 + Math.floor(rnd() * 5), 'wat.l', 'wat.d'); },
      sandRipple(b, x, y) { DECOR.ripple(b, x, y, 5 + Math.floor(rnd() * 4), 'dirt.h', 'dirt.m'); },
      /* 裂缝：两三个折点的小暗线 */
      crack(b, x, y) {
        let cx = x, cy = y;
        for (let i = 0; i < 5; i++) {
          put(b, cx, cy, P('ink.d'));
          cx += rnd() < 0.6 ? 1 : 0;
          cy += rnd() < 0.4 ? 1 : 0;
        }
      },
      /* 树冠：一团深绿，左上高光，右下投影。一格一棵，挤一点才像林子 */
      tree(b, x, y) {
        disc(b, x + 1, y + 1, 4, P('grs.d'));
        disc(b, x, y, 3, P('grs.m'));
        disc(b, x - 1, y - 1, 2, P('grs.l'));
        put(b, x - 2, y - 2, P('grs.h'));
        for (let i = -3; i <= 3; i++) put(b, x + 1 + i, y + 5, P('ink.d'));
      },
      /* 巨石：整体偏亮，顶边打光、底边压暗，中间一道裂纹 */
      boulder(b, x, y) {
        disc(b, x + 3, y + 3, 6, P('rock.m'));
        disc(b, x + 2, y + 1, 4, P('rock.l'));
        put(b, x + 1, y, P('rock.h'));
        put(b, x + 2, y, P('rock.h'));
        for (let i = -4; i <= 4; i++) put(b, x + 3 + i, y + 8, P('ink.d'));
        DECOR.crack(b, x + 2, y + 2);
      },
    };

    function build(sc) {
      const b = B(A, A);

      /* 1. 主色铺满，再撒几块 3~5 见方的色斑（±1 档）。
            大块的规则分格在 1:1 的手机上就是棋盘；色斑要小、要散。 */
      rect(b, 0, 0, A, A, P(sc.base));
      for (let k = 0; k < 5; k++) {
        const s = 3 + Math.floor(rnd() * 3);
        const x = Math.floor(rnd() * (A - s)), y = Math.floor(rnd() * (A - s));
        const c = P(rnd() < 0.5 ? sc.alt[0] : sc.alt[1]);
        for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) put(b, x + i, y + j, c);
      }

      /* 2. 细颗粒：只动 3% 的像素，而且只在局部色上下挪一档。
            绝对色（.d/.h）或高比例会把地面打成电视雪花。 */
      for (let j = 0; j < A; j++) {
        for (let i = 0; i < A; i++) {
          const r = rnd();
          if (r < 0.015) put(b, i, j, bump(at(b, i, j), -1));
          else if (r < 0.03) put(b, i, j, bump(at(b, i, j), 1));
        }
      }

      /* 3. 点缀 */
      for (const it of sc.decor) {
        const fn = it[0] === 'ripple' ? DECOR.sandRipple : DECOR[it[0]];
        for (let k = 0; k < it[1]; k++) {
          fn(b, 2 + Math.floor(rnd() * (A - 6)), 3 + Math.floor(rnd() * (A - 7)));
        }
      }

      /* 4. 路面石板：缝固定在 8 的倍数上，四边都能和邻格拼上 */
      if (sc.pave) {
        for (let i = 0; i < A; i++) { put(b, i, 7, P('rock.d')); put(b, i, 15, P('rock.d')); put(b, i, 23, P('rock.d')); }
        for (let j = 0; j < 7; j++) { put(b, 5, j, P('rock.d')); put(b, 17, j + 8, P('rock.d')); put(b, 11, j + 16, P('rock.d')); }
        for (let i = 0; i < 5; i++) { put(b, i, 0, P('rock.h')); put(b, 6 + i, 8, P('rock.h')); put(b, 12 + i, 16, P('rock.h')); }
      }

      /* 5. 淡网格：只压暗下边和右边，而且是 4 格断续的。
            整行提亮 + 整行压暗会拼出一条条横纹，看着像地板而不像地面。 */
      for (let i = 0; i < A; i++) {
        if ((i & 3) !== 2) put(b, i, A - 1, bump(at(b, i, A - 1), -1));
        if ((i & 3) !== 1) put(b, A - 1, i, bump(at(b, A - 1, i), -1));
      }
      return b;
    }

    const tcv = document.createElement('canvas');
    tcv.width = A * 4;
    tcv.height = A * list.length;
    const ctx = tcv.getContext('2d');
    const img = ctx.createImageData(tcv.width, tcv.height);
    const d = img.data;

    for (let ti = 0; ti < list.length; ti++) {
      const sc = SCHEME[list[ti].id] || SCHEME.plain;
      for (let v = 0; v < 4; v++) {
        const b = build(sc, v);
        for (let j = 0; j < A; j++) {
          for (let i = 0; i < A; i++) {
            const hex = PAL[b.a[j * A + i]];
            const o = ((ti * A + j) * tcv.width + (v * A + i)) * 4;
            d[o] = parseInt(hex.substr(1, 2), 16);
            d[o + 1] = parseInt(hex.substr(3, 2), 16);
            d[o + 2] = parseInt(hex.substr(5, 2), 16);
            d[o + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    this.tileCanvas = tcv;
  },

  /** 铺一格地形：变体由坐标哈希决定，同一张地图永远长一样 */
  blitTile(ctx, terrainIdx, col, row, dx, dy, scale) {
    const A = this.ART;
    const v = ((col * 7 + row * 13 + ((col * row) % 5)) & 3);
    ctx.drawImage(this.tileCanvas, v * A, terrainIdx * A, A, A,
      Math.round(dx), Math.round(dy), A * scale, A * scale);
  },
};
