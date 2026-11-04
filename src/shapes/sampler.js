// צורה אל נקודות בית ברדיוס משתנה, בלי חפיפות.
//
// 1. המקור (SVG path כ Path2D, או קובץ SVG/ביטמפ כתמונה) מצויר למסכה דרך מטריצת טרנספורמציה
//    אחת: מיקום יחסי למסך, סיבוב, קנה מידה והיפוך.
// 2. לתמונה: המסכה נקבעת לפי סף על שקיפות או על כהות, עם היפוך אפשרי בתוך גבולות התמונה.
// 3. מהמסכה מחושבת מפת מרחק לשוליים (Euclidean distance transform). היא משמשת לבדיקת
//    "בפנים", ל sizeMode=edgeDistance, ומבטיחה שכל עיגול נשאר כולו בתוך הצורה.
// 4. Poisson disk ברדיוס משתנה: זריקת חצים עם רשת מרחבית, במעברים מהגדול לקטן.
//    כל מועמד מתכווץ עד שהוא נכנס בין שכניו; במעברים הראשונים מתקבלים רק עיגולים
//    שקרובים לגודל הרצוי, ובאחרונים גם קטנים שממלאים רווחים.
// 5. לתמונה: הבהירות יכולה לקבוע את הרדיוס (stippling), והצבע נדגם מהפיקסל.

import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../util/rng.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const INF = 1e20;
const MASK_MAX = 1200; // רזולוציית מסכה מרבית בצלע הארוכה
const PASSES = 6;
const PAD = 2;

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

const empty = (t0) => ({
  count: 0,
  x: new Float32Array(0),
  y: new Float32Array(0),
  r: new Float32Array(0),
  colorT: new Float32Array(0),
  rgb: null,
  ms: performance.now() - t0,
});

/**
 * @param {object} scene  סצנה לפי schema.js
 * @param {number} width  רוחב אזור התצוגה בפיקסלי CSS
 * @param {number} height גובה אזור התצוגה
 * @param {{img: CanvasImageSource, w: number, h: number}|null} image כש shape.type הוא image
 * @returns {{count:number, x:Float32Array, y:Float32Array, r:Float32Array, colorT:Float32Array,
 *            rgb:Float32Array|null, ms:number}}
 */
export function sampleScene(scene, width, height, image = null) {
  const t0 = performance.now();
  const { shape, radius, palette } = scene;
  const maxCount = scene.maxCount;
  const rng = mulberry32(scene.seed);
  const noise2D = createNoise2D(mulberry32(scene.seed ^ 0x9e3779b9));

  const rMin = Math.max(0.25, Math.min(radius.min, radius.max));
  const rMax = Math.max(rMin, radius.max);
  const gap = radius.gap ?? 0;

  // מקור: תיבה תוחמת במערכת הצירים שלו, ופונקציית ציור
  const isImage = shape.type === 'image';
  let bb;
  let draw;
  if (isImage) {
    if (!image || !(image.w > 0 && image.h > 0)) return empty(t0);
    bb = { x: 0, y: 0, w: image.w, h: image.h };
    draw = (ctx) => ctx.drawImage(image.img, 0, 0, image.w, image.h);
  } else {
    bb = pathBBox(shape.d);
    const path = new Path2D(shape.d);
    draw = (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fill(path, shape.fillRule ?? 'nonzero');
    };
  }
  if (!(bb.w > 0 && bb.h > 0)) return empty(t0);

  // טרנספורמציה מהמקור אל המסך. scale יחסית להתאמה לצלע הקצרה של המסך, לפני סיבוב.
  const s = (shape.scale ?? 1) * Math.min(width / bb.w, height / bb.h);
  const toWorld = new DOMMatrix()
    .translate((shape.x ?? 0.5) * width, (shape.y ?? 0.5) * height)
    .rotate(shape.rotation ?? 0)
    .scale(s * (shape.flipX ? -1 : 1), s * (shape.flipY ? -1 : 1))
    .translate(-(bb.x + bb.w / 2), -(bb.y + bb.h / 2));

  // תיבה תוחמת על המסך אחרי סיבוב, חתוכה למסך עם שוליים
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cy] of [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x, bb.y + bb.h], [bb.x + bb.w, bb.y + bb.h]]) {
    const p = toWorld.transformPoint({ x: cx, y: cy });
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const margin = rMax * 2;
  const wx0 = Math.max(minX, -margin);
  const wy0 = Math.max(minY, -margin);
  const ww = Math.min(maxX, width + margin) - wx0;
  const wh = Math.min(maxY, height + margin) - wy0;
  if (!(ww > 1 && wh > 1)) return empty(t0);

  // מסכה
  const k = Math.min(1, MASK_MAX / Math.max(ww, wh));
  const mw = Math.ceil(ww * k) + PAD * 2;
  const mh = Math.ceil(wh * k) + PAD * 2;
  const toMask = new DOMMatrix().translate(PAD, PAD).scale(k).translate(-wx0, -wy0).multiply(toWorld);
  const canvas = document.createElement('canvas');
  canvas.width = mw;
  canvas.height = mh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(toMask);
  draw(ctx);
  const px = ctx.getImageData(0, 0, mw, mh).data;

  // כהות של פיקסל, מורכב על לבן (שקוף נחשב בהיר)
  const darkness = (i) => {
    const a = px[i * 4 + 3] / 255;
    const lum = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    return (1 - lum) * a;
  };

  const inside = new Uint8Array(mw * mh);
  let insideCount = 0;
  if (isImage) {
    const opt = shape.image;
    const byLum = opt.maskBy === 'luminance';
    const th = opt.threshold;
    const inv = opt.invert;
    // לבדיקה אם פיקסל בתוך גבולות התמונה (נדרש להיפוך): מטריצה הפוכה למערכת התמונה
    const back = toMask.inverse();
    for (let y = 0, i = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++, i++) {
        let on = (byLum ? darkness(i) : px[i * 4 + 3] / 255) > th;
        if (inv) {
          const u = back.a * (x + 0.5) + back.c * (y + 0.5) + back.e;
          const v = back.b * (x + 0.5) + back.d * (y + 0.5) + back.f;
          on = !on && u >= 0 && v >= 0 && u < bb.w && v < bb.h;
        }
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
  if (insideCount === 0) return empty(t0);

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
  const om = isImage ? new Int32Array(maxCount) : null; // אינדקס פיקסל במסכה, לצבע
  let count = 0;

  const sizeMode = radius.sizeMode;
  const noiseScale = radius.noiseScale ?? 0.006;
  const span = rMax - rMin;
  const sizeAmount = isImage ? Math.min(1, Math.max(0, shape.image.sizeAmount)) : 0;
  const sizeInvert = isImage && shape.image.sizeInvert;
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

  outer: for (let pass = 0; pass < PASSES; pass++) {
    const q = 1 - pass / (PASSES - 1);
    for (let a = 0; a < attemptsPerPass; a++) {
      if (count >= maxCount) break outer;
      const wx = wx0 + rng() * ww;
      const wy = wy0 + rng() * wh;
      const mx = ((wx - wx0) * k + PAD) | 0;
      const my = ((wy - wy0) * k + PAD) | 0;
      const mi = my * mw + mx;
      if (!inside[mi]) continue;
      const e = Math.sqrt(dist2[mi]) / k;
      let allowed = e - 0.5;
      if (allowed < rMin) continue;
      const r0 = desired(wx, wy, e, mi);

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
      if (om) om[count] = mi;
      const c = gy * gw + gx;
      next[count] = head[c];
      head[c] = count;
      count++;
    }
  }

  // מיפוי צבע: colorT בין 0 ל 1 לאורך הספקטרום
  const colorT = new Float32Array(count);
  const ccx = wx0 + ww / 2;
  const ccy = wy0 + wh / 2;
  const maxRad = Math.hypot(ww, wh) / 2 || 1;
  for (let i = 0; i < count; i++) {
    let t;
    switch (palette.mapBy) {
      case 'x': t = (ox[i] - wx0) / ww; break;
      case 'radius': t = span > 0 ? (or[i] - rMin) / span : 0.5; break;
      case 'edge': t = oe[i] / maxEdge; break;
      case 'radial': t = Math.hypot(ox[i] - ccx, oy[i] - ccy) / maxRad; break;
      case 'random': t = rng(); break;
      default: t = (oy[i] - wy0) / wh;
    }
    colorT[i] = Math.min(1, Math.max(0, t));
  }

  // צבע מהתמונה בנקודת המרכז של כל עיגול
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

  return {
    count,
    x: ox.subarray(0, count),
    y: oy.subarray(0, count),
    r: or.subarray(0, count),
    colorT,
    rgb,
    ms: performance.now() - t0,
  };
}
