// מצב המעבר כפונקציה טהורה של t.
//
// resolveEndpoints: נקודות התחלה וסיום על המסך לכל slot, לפי הטרנספורמציות של A ו B
//   במסגרת הנוכחית ולפי מצבי העודפים והחוסרים. מחושב מחדש רק כשהמסגרת משתנה.
// evaluateAt(t): לכל slot, התקדמות מקומית u = ease((t - delay) / (1 - stagger)),
//   ומשם מיקום (לפי המסלול), רדיוס, התקדמות צבע ומשקל שכבת העל. אין שום מצב פנימי:
//   אותו t, אותם פרמטרים ואותה מסגרת נותנים תמיד אותה תוצאה.

import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../util/rng.js';

const MARGIN = 24; // כמה מחוץ למסגרת מתחילים או מסיימים עיגולים שנכנסים או יוצאים

/** מרחק מנקודה בתוך המסגרת עד שהיא יוצאת ממנה בכיוון (dx, dy) מנורמל. */
function exitDistance(x, y, dx, dy, view) {
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (view.x0 + view.w - x) / dx);
  if (dx < -1e-6) t = Math.min(t, (view.x0 - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (view.y0 + view.h - y) / dy);
  if (dy < -1e-6) t = Math.min(t, (view.y0 - y) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

export function createEnds(K) {
  const f = () => new Float32Array(K);
  return { x0: f(), y0: f(), r0: f(), x1: f(), y1: f(), r1: f() };
}

/**
 * @param A, B   sideData (prepare.js) במסגרת הנוכחית
 */
export function resolveEndpoints(prep, A, B, style, view, ends) {
  const { K, src, dst, near } = prep;
  const ang = (style.leftovers.angle * Math.PI) / 180;
  const ex = Math.cos(ang);
  const ey = Math.sin(ang);
  const cx = view.x0 + view.w / 2;
  const cy = view.y0 + view.h / 2;
  for (let s = 0; s < K; s++) {
    const a = src[s];
    const b = dst[s];
    if (a >= 0 && b >= 0) {
      ends.x0[s] = A.x[a]; ends.y0[s] = A.y[a]; ends.r0[s] = A.r[a];
      ends.x1[s] = B.x[b]; ends.y1[s] = B.y[b]; ends.r1[s] = B.r[b];
    } else if (a >= 0) {
      // עודף ב A
      ends.x0[s] = A.x[a]; ends.y0[s] = A.y[a]; ends.r0[s] = A.r[a];
      const mode = style.leftovers.mode;
      if (mode === 'exit') {
        const d = exitDistance(A.x[a], A.y[a], ex, ey, view) + A.r[a] + MARGIN;
        ends.x1[s] = A.x[a] + ex * d; ends.y1[s] = A.y[a] + ey * d; ends.r1[s] = A.r[a];
      } else if (mode === 'merge' && near[s] >= 0) {
        ends.x1[s] = B.x[near[s]]; ends.y1[s] = B.y[near[s]]; ends.r1[s] = 0;
      } else {
        ends.x1[s] = A.x[a]; ends.y1[s] = A.y[a]; ends.r1[s] = 0;
      }
    } else {
      // חוסר ב B
      ends.x1[s] = B.x[b]; ends.y1[s] = B.y[b]; ends.r1[s] = B.r[b];
      const mode = style.spawns.mode;
      if (mode === 'edges') {
        let dx = B.x[b] - cx;
        let dy = B.y[b] - cy;
        const len = Math.hypot(dx, dy);
        if (len < 1e-3) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
        const d = exitDistance(B.x[b], B.y[b], dx, dy, view) + B.r[b] + MARGIN;
        ends.x0[s] = B.x[b] + dx * d; ends.y0[s] = B.y[b] + dy * d; ends.r0[s] = B.r[b];
      } else if (mode === 'direction') {
        // נכנסים בכיוון angle: מתחילים מחוץ למסגרת, מהצד שממנו הכיוון מגיע
        const sa = (style.spawns.angle * Math.PI) / 180;
        const dx = -Math.cos(sa);
        const dy = -Math.sin(sa);
        const d = exitDistance(B.x[b], B.y[b], dx, dy, view) + B.r[b] + MARGIN;
        ends.x0[s] = B.x[b] + dx * d; ends.y0[s] = B.y[b] + dy * d; ends.r0[s] = B.r[b];
      } else if (mode === 'split' && near[s] >= 0) {
        ends.x0[s] = A.x[near[s]]; ends.y0[s] = A.y[near[s]]; ends.r0[s] = 0;
      } else {
        ends.x0[s] = B.x[b]; ends.y0[s] = B.y[b]; ends.r0[s] = 0;
      }
    }
  }
}

/** פונקציות שתלויות רק בסגנון: easing ושדה ה noise. */
export function makeEvaluator(style, parseEase) {
  return {
    ease: parseEase(style.ease) ?? ((u) => u),
    noise: createNoise2D(mulberry32(style.matching.seed * 31 + 5)),
  };
}

/**
 * כותב את המצב הטהור ב t לתוך p: homeX, homeY, targetR, colorU, overlayW.
 * @param focus נקודה על המסך [x, y], ל path=gather
 * @param unit  פיקסלי מסך לפיקסל ייחוס, לעוצמות שמוגדרות בייחוס
 */
export function evaluateAt(t, prep, ends, style, ev, focus, unit, p) {
  const { K, key, rnd } = prep;
  const stagger = Math.min(0.95, Math.max(0, style.order.stagger));
  const span = 1 - stagger;
  const path = style.path;
  const mode = path.mode;
  const curv = path.curvature;
  const dirMode = path.direction;
  const nAmp = path.noiseAmount * unit;
  const nScale = path.noiseScale / (unit || 1);
  const spread = path.spread * unit;
  const shrink = path.gatherShrink;
  const hold = Math.min(0.9, Math.max(0, path.scatterHold ?? 0));
  const half = (1 - hold) / 2;
  const dip = style.overlay.dip;
  const sharp = Math.max(0.05, style.overlay.sharpness);
  const { ease, noise } = ev;
  const [fx, fy] = focus;
  const { homeX, homeY, targetR, colorU, overlayW } = p;
  const { x0, y0, r0, x1, y1, r1 } = ends;

  for (let s = 0; s < K; s++) {
    let raw = (t - stagger * key[s]) / span;
    raw = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const u = ease(raw); // יכול לחרוג מ 0 עד 1 (back, elastic): מותר למיקום
    const bump = Math.sin(Math.PI * raw); // 0 בקצוות, 1 באמצע התעופה
    const ax = x0[s], ay = y0[s], bx = x1[s], by = y1[s];
    let x;
    let y;
    let rScale = 1;
    if (mode === 'scatter' && hold > 0) {
      // התפזרות עם החזקה: יציאה לנקודת הפיזור, ריחוף לאורך hold מהתעופה, וכניסה ליעד.
      // בזמן ההחזקה העיגול ממשיך להתרחק לאט (מ HOLD_IN עד הרדיוס המלא), כדי שאין פריים בלי תנועה.
      const a = rnd[s * 2] * Math.PI * 2;
      const d = spread * Math.sqrt(rnd[s * 2 + 1]);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const s1x = mx + ca * d * HOLD_IN, s1y = my + sa * d * HOLD_IN;
      const s2x = mx + ca * d, s2y = my + sa * d;
      if (u < half) {
        const q = smooth(u / half);
        x = ax + (s1x - ax) * q;
        y = ay + (s1y - ay) * q;
      } else if (u > 1 - half) {
        const q = smooth((u - (1 - half)) / half);
        x = s2x + (bx - s2x) * q;
        y = s2y + (by - s2y) * q;
      } else {
        const q = (u - half) / hold;
        x = s1x + (s2x - s1x) * q;
        y = s1y + (s2y - s1y) * q;
      }
    } else if (mode === 'arc' || mode === 'scatter') {
      let cx;
      let cy;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      if (mode === 'arc') {
        const dx = bx - ax;
        const dy = by - ay;
        let sign = 1;
        if (dirMode === 'ccw') sign = -1;
        else if (dirMode === 'alternate') sign = s % 2 ? -1 : 1;
        else if (dirMode === 'random') sign = rnd[s * 2] < 0.5 ? -1 : 1;
        cx = mx - dy * curv * sign;
        cy = my + dx * curv * sign;
      } else {
        // נקודת ההתפזרות מושגת באמצע הדרך: נקודת הביקורת היא 2S - אמצע
        const a = rnd[s * 2] * Math.PI * 2;
        const d = spread * Math.sqrt(rnd[s * 2 + 1]);
        cx = mx + 2 * Math.cos(a) * d;
        cy = my + 2 * Math.sin(a) * d;
      }
      const v = 1 - u;
      x = v * v * ax + 2 * u * v * cx + u * u * bx;
      y = v * v * ay + 2 * u * v * cy + u * u * by;
    } else if (mode === 'gather') {
      // איסוף לנקודה ופיזור ממנה: שני חצאים, כל אחד עם smoothstep
      if (u < 0.5) {
        let q = u * 2;
        q = q * q * (3 - 2 * q);
        x = ax + (fx - ax) * q;
        y = ay + (fy - ay) * q;
      } else {
        let q = (u - 0.5) * 2;
        q = q * q * (3 - 2 * q);
        x = fx + (bx - fx) * q;
        y = fy + (by - fy) * q;
      }
      rScale = 1 - (1 - shrink) * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
    } else {
      x = ax + (bx - ax) * u;
      y = ay + (by - ay) * u;
      if (mode === 'noise') {
        const amp = nAmp * bump;
        x += noise(x * nScale, y * nScale) * amp;
        y += noise(x * nScale + 31.7, y * nScale - 17.3) * amp;
      }
    }
    const uc = u < 0 ? 0 : u > 1 ? 1 : u;
    const r = (r0[s] + (r1[s] - r0[s]) * uc) * rScale;
    homeX[s] = x;
    homeY[s] = y;
    targetR[s] = r > 0 ? r : 0;
    colorU[s] = uc;
    overlayW[s] = 1 - dip * Math.pow(bump, sharp);
  }
}

// scatter עם החזקה: ההחזקה מתחילה בחלק הזה מרדיוס הפיזור ומסתיימת ברדיוס המלא
const HOLD_IN = 0.75;

/** smoothstep בתוך 0 עד 1; מחוץ לטווח (easing שחורג, כמו back) לינארי. */
function smooth(q) {
  return q <= 0 || q >= 1 ? q : q * q * (3 - 2 * q);
}

/** checksum של המצב הטהור (לבדיקת הפיכות): FNV על הביטים של המערכים. */
export function stateChecksum(p, K) {
  const views = [p.homeX, p.homeY, p.targetR, p.colorU];
  let h = 0x811c9dc5;
  for (const arr of views) {
    const u32 = new Uint32Array(arr.buffer, arr.byteOffset, K);
    for (let i = 0; i < K; i++) {
      h ^= u32[i];
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/**
 * אינטרפולציה של אובייקט פרמטרים (תנועה, פיזיקה) מ a ל b, לתוך out שמוקצה פעם אחת.
 * מספרים לינאריים; בוליאנים ומחרוזות מתחלפים באמצע.
 */
export function lerpInto(out, a, b, t) {
  for (const k of Object.keys(a)) {
    const va = a[k];
    const vb = b?.[k] ?? va;
    if (typeof va === 'number' && typeof vb === 'number') out[k] = va + (vb - va) * t;
    else if (va && typeof va === 'object' && !Array.isArray(va)) out[k] = lerpInto(out[k] ?? {}, va, vb, t);
    else out[k] = t < 0.5 ? va : vb;
  }
  return out;
}
