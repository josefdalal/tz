// SVG path אל נקודות בית ברדיוס משתנה, בלי חפיפות.
//
// 1. ה path מצויר כ Path2D למסכה (קנבס דו ממדי מחוץ למסך).
// 2. מהמסכה מחושבת מפת מרחק לשוליים (Euclidean distance transform).
//    מפת המרחק משמשת גם לבדיקת "בפנים" וגם ל sizeMode=edgeDistance,
//    וגם מבטיחה שכל עיגול נשאר כולו בתוך הצורה.
// 3. Poisson disk ברדיוס משתנה: זריקת חצים עם רשת מרחבית, במעברים מהגדול לקטן.
//    כל מועמד מתכווץ עד שהוא נכנס בין שכניו; במעברים הראשונים מתקבלים רק עיגולים
//    שקרובים לגודל הרצוי, ובאחרונים גם קטנים שממלאים רווחים.

import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../util/rng.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const INF = 1e20;
const MASK_MAX = 1024; // רזולוציית מסכה מרבית בצלע הארוכה
const PASSES = 6;

let bboxSvg = null;
let bboxPath = null;

function pathBBox(d) {
  if (!bboxSvg) {
    bboxSvg = document.createElementNS(SVG_NS, 'svg');
    bboxSvg.setAttribute('width', '0');
    bboxSvg.setAttribute('height', '0');
    bboxSvg.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    bboxPath = document.createElementNS(SVG_NS, 'path');
    bboxSvg.appendChild(bboxPath);
    document.body.appendChild(bboxSvg);
  }
  bboxPath.setAttribute('d', d);
  const b = bboxPath.getBBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

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

// מחזיר מרחק בריבוע (בפיקסלי מסכה) מכל פיקסל פנימי לפיקסל החיצוני הקרוב
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

/**
 * @param {object} scene  סצנה לפי schema.js (shape, radius, palette, seed, maxCount)
 * @param {number} width  רוחב אזור התצוגה בפיקסלי CSS
 * @param {number} height גובה אזור התצוגה
 * @returns {{count:number, x:Float32Array, y:Float32Array, r:Float32Array, colorT:Float32Array, ms:number}}
 */
export function sampleScene(scene, width, height) {
  const t0 = performance.now();
  const { shape, radius, palette } = scene;
  const maxCount = scene.maxCount;
  const rng = mulberry32(scene.seed);
  const noise2D = createNoise2D(mulberry32(scene.seed ^ 0x9e3779b9));

  const rMin = Math.max(0.25, Math.min(radius.min, radius.max));
  const rMax = Math.max(rMin, radius.max);
  const gap = radius.gap ?? 0;

  // התאמה למסך: path במרכז, scale יחסית לצלע הקצרה של המסך
  const bb = pathBBox(shape.d);
  const s = (shape.scale ?? 1) * Math.min(width / bb.w, height / bb.h);
  const ww = bb.w * s;
  const wh = bb.h * s;
  const wx0 = (width - ww) / 2;
  const wy0 = (height - wh) / 2;

  // מסכה
  const k = Math.min(1, MASK_MAX / Math.max(ww, wh));
  const pad = 2;
  const mw = Math.ceil(ww * k) + pad * 2;
  const mh = Math.ceil(wh * k) + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = mw;
  canvas.height = mh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(k * s, 0, 0, k * s, pad - k * s * bb.x, pad - k * s * bb.y);
  ctx.fill(new Path2D(shape.d), shape.fillRule ?? 'nonzero');
  const img = ctx.getImageData(0, 0, mw, mh).data;
  const inside = new Uint8Array(mw * mh);
  let insideCount = 0;
  for (let i = 0; i < mw * mh; i++) {
    if (img[i * 4 + 3] > 127) {
      inside[i] = 1;
      insideCount++;
    }
  }
  const dist2 = distanceTransform(inside, mw, mh);
  let maxEdge = 0;
  for (let i = 0; i < dist2.length; i++) if (dist2[i] > maxEdge) maxEdge = dist2[i];
  maxEdge = Math.sqrt(maxEdge) / k || 1;

  // רשת מרחבית: תא בגודל 2*rMax+gap, כך ששכנים רלוונטיים נמצאים ב 3x3 תאים
  const cell = 2 * rMax + gap;
  const gw = Math.ceil(ww / cell) + 1;
  const gh = Math.ceil(wh / cell) + 1;
  const head = new Int32Array(gw * gh).fill(-1);
  const next = new Int32Array(maxCount);

  const ox = new Float32Array(maxCount);
  const oy = new Float32Array(maxCount);
  const or = new Float32Array(maxCount);
  const oe = new Float32Array(maxCount);
  let count = 0;

  const sizeMode = radius.sizeMode;
  const noiseScale = radius.noiseScale ?? 0.006;
  const span = rMax - rMin;
  const desired = (wx, wy, e) => {
    if (sizeMode === 'edgeDistance') {
      const t = Math.min(1, e / (maxEdge * 0.6));
      return rMin + span * Math.pow(t, 0.8);
    }
    if (sizeMode === 'noise') {
      const n = noise2D(wx * noiseScale, wy * noiseScale) * 0.5 + 0.5;
      return rMin + span * n;
    }
    return rMin + span * rng();
  };

  const area = insideCount / (k * k);
  const attemptsPerPass = Math.max(2000, Math.min(80000, Math.round((area / (Math.PI * rMin * rMin)) * 1.5)));

  outer: for (let pass = 0; pass < PASSES; pass++) {
    const q = 1 - pass / (PASSES - 1);
    for (let a = 0; a < attemptsPerPass; a++) {
      if (count >= maxCount) break outer;
      const wx = wx0 + rng() * ww;
      const wy = wy0 + rng() * wh;
      const mx = ((wx - wx0) * k + pad) | 0;
      const my = ((wy - wy0) * k + pad) | 0;
      const mi = my * mw + mx;
      if (!inside[mi]) continue;
      const e = Math.sqrt(dist2[mi]) / k;
      const r0 = desired(wx, wy, e);
      let allowed = e - 0.5;
      if (allowed < rMin) continue;

      const gx = Math.floor((wx - wx0) / cell);
      const gy = Math.floor((wy - wy0) / cell);
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
      const c = gy * gw + gx;
      next[count] = head[c];
      head[c] = count;
      count++;
    }
  }

  // מיפוי צבע: colorT בין 0 ל 1 לאורך הספקטרום
  const colorT = new Float32Array(count);
  const cx = wx0 + ww / 2;
  const cy = wy0 + wh / 2;
  const maxRad = Math.hypot(ww, wh) / 2 || 1;
  for (let i = 0; i < count; i++) {
    let t;
    switch (palette.mapBy) {
      case 'x': t = (ox[i] - wx0) / ww; break;
      case 'radius': t = span > 0 ? (or[i] - rMin) / span : 0.5; break;
      case 'edge': t = oe[i] / maxEdge; break;
      case 'radial': t = Math.hypot(ox[i] - cx, oy[i] - cy) / maxRad; break;
      case 'random': t = rng(); break;
      default: t = (oy[i] - wy0) / wh;
    }
    colorT[i] = Math.min(1, Math.max(0, t));
  }

  return {
    count,
    x: ox.subarray(0, count),
    y: oy.subarray(0, count),
    r: or.subarray(0, count),
    colorT,
    ms: performance.now() - t0,
  };
}
