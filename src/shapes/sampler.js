// פיקסלי מקור אל נקודות בית ברדיוס משתנה, בלי חפיפות. רץ בתוך ה worker, בלי DOM.
//
// 1. מסכה: path לפי alpha. תמונה לפי סף על שקיפות או על כהות, עם היפוך בתוך גבולות התמונה.
// 2. מפת מרחק לשוליים (Euclidean distance transform): בדיקת "בפנים", sizeMode=edgeDistance,
//    ושמירה שכל עיגול נשאר כולו בתוך הצורה.
// 3. Poisson disk ברדיוס משתנה: זריקת חצים עם רשת מרחבית, במעברים מהגדול לקטן.
//    כל מועמד מתכווץ עד שהוא נכנס בין שכניו; במעברים הראשונים מתקבלים רק עיגולים
//    שקרובים לגודל הרצוי, ובאחרונים גם קטנים שממלאים רווחים.
// 4. לתמונה: הבהירות יכולה לקבוע את הרדיוס (stippling), והצבע נדגם מהפיקסל.
//
// הפלט במרחב המקומי של הצורה, ממורכז בראשית: lx, ly, lr בפיקסלים בקנה המידה של הדגימה.

import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../util/rng.js';

const INF = 1e20;
const PASSES = 6;
const PAD = 2; // חייב להתאים ל raster.js

// Felzenszwalb & Huttenlocher, מרחק אוקלידי בריבוע, מעבר חד ממדי
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

function distanceTransform(inside, w, h) {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = inside[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  return grid;
}

function emptyResult() {
  const z = new Float32Array(0);
  return { count: 0, lx: z, ly: z, lr: z, edge: z, rand: z, rgb: null };
}

/**
 * @param {{pixels: Uint8ClampedArray, mw: number, mh: number, k: number, w0: number, h0: number}} raster
 * @param {object} p { isImage, seed, maxCount, radius, image }
 */
export function sampleRaster(raster, p) {
  const { pixels: px, mw, mh, k, w0, h0 } = raster;
  const { isImage, radius, maxCount } = p;
  const rng = mulberry32(p.seed);
  const noise2D = createNoise2D(mulberry32(p.seed ^ 0x9e3779b9));

  const rMin = Math.max(0.25, Math.min(radius.min, radius.max));
  const rMax = Math.max(rMin, radius.max);
  const gap = radius.gap ?? 0;

  // כהות של פיקסל, מורכב על לבן (שקוף נחשב בהיר)
  const darkness = (i) => {
    const a = px[i * 4 + 3] / 255;
    const lum = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    return (1 - lum) * a;
  };

  const inside = new Uint8Array(mw * mh);
  let insideCount = 0;
  if (isImage) {
    const opt = p.image;
    const byLum = opt.maskBy === 'luminance';
    const th = opt.threshold;
    const inv = opt.invert;
    // גבולות התמונה בפיקסלי מסכה (נדרש להיפוך, כדי שהשוליים הריקים לא יתמלאו)
    const rx1 = PAD + w0 * k;
    const ry1 = PAD + h0 * k;
    for (let y = 0, i = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++, i++) {
        let on = (byLum ? darkness(i) : px[i * 4 + 3] / 255) > th;
        if (inv) on = !on && x >= PAD && y >= PAD && x < rx1 && y < ry1;
        if (on) {
          inside[i] = 1;
          insideCount++;
        }
      }
    }
  } else {
    for (let i = 0; i < mw * mh; i++) {
      if (px[i * 4 + 3] > 127) {
        inside[i] = 1;
        insideCount++;
      }
    }
  }
  if (insideCount === 0) return emptyResult();

  const dist2 = distanceTransform(inside, mw, mh);
  let maxEdge = 0;
  for (let i = 0; i < dist2.length; i++) if (dist2[i] > maxEdge) maxEdge = dist2[i];
  maxEdge = Math.sqrt(maxEdge) / k || 1;

  // רשת מרחבית: תא בגודל 2*rMax+gap, כך ששכנים רלוונטיים נמצאים ב 3x3 תאים
  const cell = 2 * rMax + gap;
  const gw = Math.ceil(w0 / cell) + 1;
  const gh = Math.ceil(h0 / cell) + 1;
  const head = new Int32Array(gw * gh).fill(-1);
  const next = new Int32Array(maxCount);

  const ox = new Float32Array(maxCount);
  const oy = new Float32Array(maxCount);
  const or = new Float32Array(maxCount);
  const oe = new Float32Array(maxCount);
  const om = isImage ? new Int32Array(maxCount) : null;
  let count = 0;

  const sizeMode = radius.sizeMode;
  const noiseScale = radius.noiseScale ?? 0.006;
  const span = rMax - rMin;
  const sizeAmount = isImage ? Math.min(1, Math.max(0, p.image.sizeAmount)) : 0;
  const sizeInvert = isImage && p.image.sizeInvert;
  const desired = (wx, wy, e, mi) => {
    let r;
    if (sizeMode === 'edgeDistance') {
      const t = Math.min(1, e / (maxEdge * 0.6));
      r = rMin + span * Math.pow(t, 0.8);
    } else if (sizeMode === 'noise') {
      r = rMin + span * (noise2D(wx * noiseScale, wy * noiseScale) * 0.5 + 0.5);
    } else {
      r = rMin + span * rng();
    }
    if (sizeAmount > 0) {
      const dk = darkness(mi);
      const rImg = rMin + span * (sizeInvert ? 1 - dk : dk);
      r += (rImg - r) * sizeAmount;
    }
    return r;
  };

  const area = insideCount / (k * k);
  const attemptsPerPass = Math.max(
    2000,
    Math.min(Math.max(80000, maxCount * 6), Math.round((area / (Math.PI * rMin * rMin)) * 1.5)),
  );

  // דגימה בקואורדינטות 0..w0, 0..h0; ההזזה לראשית בסוף
  outer: for (let pass = 0; pass < PASSES; pass++) {
    const q = 1 - pass / (PASSES - 1);
    for (let a = 0; a < attemptsPerPass; a++) {
      if (count >= maxCount) break outer;
      const wx = rng() * w0;
      const wy = rng() * h0;
      const mi = ((wy * k + PAD) | 0) * mw + ((wx * k + PAD) | 0);
      if (!inside[mi]) continue;
      const e = Math.sqrt(dist2[mi]) / k;
      let allowed = e - 0.5;
      if (allowed < rMin) continue;
      const r0 = desired(wx, wy, e, mi);

      const gx = Math.floor(wx / cell);
      const gy = Math.floor(wy / cell);
      for (let cy = Math.max(0, gy - 1); cy <= Math.min(gh - 1, gy + 1) && allowed >= rMin; cy++) {
        for (let cx = Math.max(0, gx - 1); cx <= Math.min(gw - 1, gx + 1); cx++) {
          for (let j = head[cy * gw + cx]; j !== -1; j = next[j]) {
            const dx = ox[j] - wx;
            const dy = oy[j] - wy;
            const free = Math.sqrt(dx * dx + dy * dy) - or[j] - gap;
            if (free < allowed) allowed = free;
          }
        }
      }
      const r = Math.min(r0, allowed);
      if (r < rMin || r < r0 * q) continue;

      ox[count] = wx;
      oy[count] = wy;
      or[count] = r;
      oe[count] = e;
      if (om) om[count] = mi;
      const c = gy * gw + gx;
      next[count] = head[c];
      head[c] = count;
      count++;
    }
  }

  const lx = new Float32Array(count);
  const ly = new Float32Array(count);
  const edge = new Float32Array(count);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    lx[i] = ox[i] - w0 / 2;
    ly[i] = oy[i] - h0 / 2;
    edge[i] = Math.min(1, oe[i] / maxEdge);
    rand[i] = rng();
  }
  let rgb = null;
  if (om) {
    rgb = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const j = om[i] * 4;
      rgb[i * 3] = px[j] / 255;
      rgb[i * 3 + 1] = px[j + 1] / 255;
      rgb[i * 3 + 2] = px[j + 2] / 255;
    }
  }
  return { count, lx, ly, lr: or.slice(0, count), edge, rand, rgb };
}
