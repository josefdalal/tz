// הכנת מעבר בין שתי סצנות: התאמה, עודפים וחוסרים, צבעים לשני הצדדים, וסדר (stagger).
// רץ פעם אחת בכניסה למצב מעבר ובכל שינוי סגנון; לא בכל פריים.
//
// התוצאה (prep) היא טופולוגיה: לכל slot יש מקור ב A (או -1) ויעד ב B (או -1), ואינדקס
// השכן הקרוב לעודפים ולחוסרים. המיקומים על המסך נגזרים ממנה ב resolveEndpoints
// (evaluate.js), כך ששינוי גודל החלון לא מחייב הכנה מחדש.

import { mulberry32 } from '../util/rng.js';
import { sortByCurve } from '../sim/match.js';
import { colorTFor } from '../scenes/layout.js';
import { sampleLut } from '../render/oklab.js';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * צד אחד של המעבר: מיקומים על המסך (בכניסה), רדיוסים, ונתוני צבע.
 * @param side { scene, geom, T } T טרנספורמציה למסך (layout.js)
 */
export function sideData(side, lut) {
  const { scene, geom, T } = side;
  const n = geom.count;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const r = new Float32Array(n);
  const colorT = new Float32Array(n);
  const img = new Float32Array(n * 3);
  const mix = new Float32Array(n);
  const rgb = new Float32Array(n * 3); // הצבע בפועל (לבהירות ולצבע מושאל)
  const imgMix = geom.rgb ? scene.shape.image.colorMix : 0;
  for (let i = 0; i < n; i++) {
    const lx = geom.lx[i];
    const ly = geom.ly[i];
    x[i] = T.a * lx + T.c * ly + T.e;
    y[i] = T.b * lx + T.d * ly + T.f;
    r[i] = geom.lr[i] * T.scale;
    const t = colorTFor(geom.meta, scene.palette.mapBy, lx, ly, geom.lr[i], geom.edge[i], geom.rand[i]);
    colorT[i] = t;
    mix[i] = imgMix;
    const pal = sampleLut(lut, t);
    for (let k = 0; k < 3; k++) {
      img[i * 3 + k] = geom.rgb ? geom.rgb[i * 3 + k] : 0;
      rgb[i * 3 + k] = pal[k] + (img[i * 3 + k] - pal[k]) * imgMix;
    }
  }
  return { n, x, y, r, colorT, img, mix, rgb };
}

/** רשת לחיפוש שכן קרוב. remove() מוציא נקודה (לזיווג חמדני בלי חזרות). */
function makeNearest(xs, ys, n) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]);
    y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]);
  }
  const cell = Math.max(1, Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / Math.max(1, n)) * 1.5);
  const cols = Math.max(1, Math.ceil((x1 - x0 + 1) / cell));
  const rows = Math.max(1, Math.ceil((y1 - y0 + 1) / cell));
  const cells = Array.from({ length: cols * rows }, () => []);
  const cellOf = new Int32Array(n);
  const cx = (x) => Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / cell)));
  const cy = (y) => Math.min(rows - 1, Math.max(0, Math.floor((y - y0) / cell)));
  for (let i = 0; i < n; i++) {
    const c = cy(ys[i]) * cols + cx(xs[i]);
    cellOf[i] = c;
    cells[c].push(i);
  }
  let alive = n;
  return {
    nearest(x, y) {
      if (alive === 0) return -1;
      const gx = cx(x);
      const gy = cy(y);
      let best = -1;
      let bestD = Infinity;
      for (let ring = 0; ring < Math.max(cols, rows); ring++) {
        // אחרי שנמצא מועמד, טבעת נוספת אחת מספיקה כדי לוודא שאין קרוב יותר
        if (best >= 0 && (ring - 1) * cell > Math.sqrt(bestD)) break;
        for (let yy = gy - ring; yy <= gy + ring; yy++) {
          if (yy < 0 || yy >= rows) continue;
          for (let xx = gx - ring; xx <= gx + ring; xx++) {
            if (xx < 0 || xx >= cols) continue;
            if (Math.max(Math.abs(xx - gx), Math.abs(yy - gy)) !== ring) continue;
            for (const j of cells[yy * cols + xx]) {
              const d = (xs[j] - x) ** 2 + (ys[j] - y) ** 2;
              if (d < bestD) { bestD = d; best = j; }
            }
          }
        }
      }
      return best;
    },
    remove(i) {
      const list = cells[cellOf[i]];
      const k = list.indexOf(i);
      if (k >= 0) { list[k] = list[list.length - 1]; list.pop(); alive--; }
    },
  };
}

function shuffled(n, rng) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** התאמה: מחזיר זוגות [a, b], ואת מי שנשאר בלי זוג בכל צד. */
function match(A, B, mode, seed) {
  const rng = mulberry32(seed);
  const pairs = [];
  if (mode === 'nearest') {
    // חמדני: הקבוצה הקטנה, בסדר אקראי קבוע, בוחרת את השכן הפנוי הקרוב בקבוצה הגדולה
    const swap = A.n > B.n;
    const S = swap ? B : A;
    const L = swap ? A : B;
    const grid = makeNearest(L.x, L.y, L.n);
    for (const i of shuffled(S.n, rng)) {
      const j = grid.nearest(S.x[i], S.y[i]);
      grid.remove(j);
      pairs.push(swap ? [j, i] : [i, j]);
    }
  } else {
    // לפי דירוג: שני הצדדים ממוינים, והקבוצה הגדולה נדגמת בפיזור שווה לאורך הדירוג
    let orderA;
    let orderB;
    if (mode === 'hilbert') {
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const S of [A, B]) {
        for (let i = 0; i < S.n; i++) {
          box.x0 = Math.min(box.x0, S.x[i]); box.x1 = Math.max(box.x1, S.x[i]);
          box.y0 = Math.min(box.y0, S.y[i]); box.y1 = Math.max(box.y1, S.y[i]);
        }
      }
      orderA = sortByCurve((i) => A.x[i], (i) => A.y[i], A.n, box);
      orderB = sortByCurve((i) => B.x[i], (i) => B.y[i], B.n, box);
    } else if (mode === 'random') {
      orderA = shuffled(A.n, rng);
      orderB = shuffled(B.n, rng);
    } else {
      const key = mode === 'size'
        ? (S, i) => S.r[i]
        : (S, i) => lum(S.rgb[i * 3], S.rgb[i * 3 + 1], S.rgb[i * 3 + 2]);
      const sortBy = (S) => Array.from({ length: S.n }, (_, i) => i).sort((p, q) => key(S, p) - key(S, q));
      orderA = sortBy(A);
      orderB = sortBy(B);
    }
    if (A.n >= B.n) {
      for (let s = 0; s < B.n; s++) pairs.push([orderA[Math.min(A.n - 1, Math.floor(((s + 0.5) * A.n) / B.n))], orderB[s]]);
    } else {
      for (let s = 0; s < A.n; s++) pairs.push([orderA[s], orderB[Math.min(B.n - 1, Math.floor(((s + 0.5) * B.n) / A.n))]]);
    }
  }
  const usedA = new Uint8Array(A.n);
  const usedB = new Uint8Array(B.n);
  for (const [a, b] of pairs) { usedA[a] = 1; usedB[b] = 1; }
  const leftA = [];
  const leftB = [];
  for (let i = 0; i < A.n; i++) if (!usedA[i]) leftA.push(i);
  for (let j = 0; j < B.n; j++) if (!usedB[j]) leftB.push(j);
  return { pairs, leftA, leftB };
}

/**
 * @param A, B   sideData של שני הצדדים
 * @param style  סגנון מעבר (schema.js)
 * @returns prep: K slots, עם src (A או -1), dst (B או -1), near (שכן קרוב לעודף או לחוסר),
 *          ונתוני צבע לשני הצדדים לכל slot.
 */
export function prepareTransition(A, B, style) {
  const { pairs, leftA, leftB } = match(A, B, style.matching.mode, style.matching.seed);
  const K = pairs.length + leftA.length + leftB.length;
  const src = new Int32Array(K).fill(-1);
  const dst = new Int32Array(K).fill(-1);
  const near = new Int32Array(K).fill(-1);
  let k = 0;
  for (const [a, b] of pairs) { src[k] = a; dst[k] = b; k++; }
  const nearB = leftA.length ? makeNearest(B.x, B.y, B.n) : null;
  for (const a of leftA) { src[k] = a; near[k] = B.n ? nearB.nearest(A.x[a], A.y[a]) : -1; k++; }
  const nearA = leftB.length ? makeNearest(A.x, A.y, A.n) : null;
  for (const b of leftB) { dst[k] = b; near[k] = A.n ? nearA.nearest(B.x[b], B.y[b]) : -1; k++; }

  // צבע לכל slot. צד שאין לו סצנה "שואל" צבע: מהעיגול עצמו (בצבע בפועל, דרך ערוץ התמונה
  // עם ערבוב 1), או מהשכן הקרוב (בנתונים המלאים שלו), לפי מצב העודפים והחוסרים.
  const cT = new Float32Array(K), cImg = new Float32Array(K * 3), cMix = new Float32Array(K);
  const cT2 = new Float32Array(K), cImg2 = new Float32Array(K * 3), cMix2 = new Float32Array(K);
  const setSide = (T, Img, Mix, s, S, i) => {
    T[s] = S.colorT[i];
    Mix[s] = S.mix[i];
    for (let c = 0; c < 3; c++) Img[s * 3 + c] = S.img[i * 3 + c];
  };
  const borrow = (T, Img, Mix, s, S, i) => {
    T[s] = 0;
    Mix[s] = 1;
    for (let c = 0; c < 3; c++) Img[s * 3 + c] = S.rgb[i * 3 + c];
  };
  for (let s = 0; s < K; s++) {
    const a = src[s];
    const b = dst[s];
    if (a >= 0) setSide(cT, cImg, cMix, s, A, a);
    if (b >= 0) setSide(cT2, cImg2, cMix2, s, B, b);
    if (b < 0) {
      // עודף: ממזג לשכן ב B מקבל את הצבע שלו; אחרת נשאר בצבע שלו
      if (style.leftovers.mode === 'merge' && near[s] >= 0) setSide(cT2, cImg2, cMix2, s, B, near[s]);
      else borrow(cT2, cImg2, cMix2, s, A, a);
    }
    if (a < 0) {
      // חוסר: מתפצל מהשכן ב A מתחיל בצבע שלו; אחרת מתחיל בצבע היעד
      if (style.spawns.mode === 'split' && near[s] >= 0) setSide(cT, cImg, cMix, s, A, near[s]);
      else borrow(cT, cImg, cMix, s, B, b);
    }
  }

  // מספרים אקראיים קבועים לכל slot (כיוון קשת אקראי, נקודת התפזרות)
  const rng = mulberry32(style.order.seed * 7919 + 17);
  const rnd = new Float32Array(K * 2);
  for (let i = 0; i < K * 2; i++) rnd[i] = rng();

  return {
    K,
    pairsCount: pairs.length,
    leftovers: leftA.length,
    spawns: leftB.length,
    src, dst, near,
    color: { cT, cImg, cMix, cT2, cImg2, cMix2 },
    rnd,
    key: new Float32Array(K), // סדר: נקבע ב computeOrder, אחרי שיש מיקומים
  };
}

/**
 * סדר: מפתח לכל slot בין 0 ל 1, לפי דירוג (כך שה stagger מתפזר באחידות).
 * @param ends נקודות הקצה על המסך (evaluate.js)
 * @param focus נקודה על המסך [x, y]
 */
export function computeOrder(prep, ends, style, focus, A) {
  const { K, key, src } = prep;
  const mode = style.order.mode;
  if (mode === 'none' || K < 2) {
    key.fill(0);
    return;
  }
  const raw = new Float64Array(K);
  const rng = mulberry32(style.order.seed);
  for (let s = 0; s < K; s++) {
    const x = ends.x0[s];
    const y = ends.y0[s];
    switch (mode) {
      case 'x': raw[s] = x; break;
      case 'y': raw[s] = y; break;
      case 'distance': raw[s] = Math.hypot(x - focus[0], y - focus[1]); break;
      case 'radius': raw[s] = Math.max(ends.r0[s], ends.r1[s]); break;
      case 'color': {
        const a = src[s];
        const c = prep.color;
        raw[s] = a >= 0 ? lum(A.rgb[a * 3], A.rgb[a * 3 + 1], A.rgb[a * 3 + 2]) : lum(c.cImg[s * 3], c.cImg[s * 3 + 1], c.cImg[s * 3 + 2]);
        break;
      }
      default: raw[s] = rng();
    }
  }
  const idx = Array.from({ length: K }, (_, i) => i).sort((p, q) => raw[p] - raw[q]);
  for (let rank = 0; rank < K; rank++) {
    const v = rank / (K - 1);
    key[idx[rank]] = style.order.reverse ? 1 - v : v;
  }
}
