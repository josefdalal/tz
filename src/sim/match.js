// התאמה מרחבית בין העיגולים הנראים עכשיו לבין נקודות הבית של גיאומטריה חדשה.
//
// שני הקבוצות ממוינות לאורך עקומת הילברט, והזיווג הוא לפי דירוג יחסי. כך כל עיגול
// עובר לנקודה קרובה, בעלות O(n log n). המצב של העיגול (מיקום, מהירות, פאזה, היסט תנועה)
// עובר איתו ל slot החדש, ולכן אין קפיצה ואין איפוס.
//   N <= M: נבחרים N עיגולים בפיזור שווה לאורך העקומה; השאר מתכווצים במקום.
//   N > M:  כל עיגול קיים מקבל בית; הבתים הנותרים נולדים ברדיוס אפס במיקום
//           של השכן הקרוב לאורך העקומה, וגדלים משם.

import { STATE_FIELDS, growParticles } from './particles.js';

const ORDER = 10; // רשת 1024x1024

function hilbert(x, y) {
  let d = 0;
  for (let s = 1 << (ORDER - 1); s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
}

/** אינדקסים 0..n-1 ממוינים לאורך עקומת הילברט בתוך box. משמש גם את עורך המעברים. */
export function sortByCurve(xs, ys, n, box) {
  const N = (1 << ORDER) - 1;
  const sx = N / (box.x1 - box.x0 || 1);
  const sy = N / (box.y1 - box.y0 || 1);
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    keys[i] = hilbert(((xs(i) - box.x0) * sx) | 0, ((ys(i) - box.y0) * sy) | 0);
  }
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => keys[a] - keys[b]);
  return idx;
}

/**
 * מחליף את הגיאומטריה של העיגולים ב geom, עם התאמה מרחבית.
 * @param T טרנספורמציה נוכחית (layout.js), כדי לדעת היכן הבתים החדשים על המסך
 * @returns {boolean} true אם המאגר גדל (הרינדור צריך rebind)
 */
export function retarget(p, geom, T, rng, width, height) {
  const N = geom.count;

  // עיגולים נראים עכשיו
  const old = [];
  for (let i = 0; i < p.active; i++) if (p.r[i] > 0.01) old.push(i);
  const M = old.length;

  // בתים חדשים במרחב המסך
  const hx = new Float32Array(N);
  const hy = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    hx[j] = T.a * geom.lx[j] + T.c * geom.ly[j] + T.e;
    hy[j] = T.b * geom.lx[j] + T.d * geom.ly[j] + T.f;
  }

  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const extend = (x, y) => {
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
  };
  for (const i of old) extend(p.x[i], p.y[i]);
  for (let j = 0; j < N; j++) extend(hx[j], hy[j]);

  const newOrder = sortByCurve((j) => hx[j], (j) => hy[j], N, box);
  const oldOrder = sortByCurve((k) => p.x[old[k]], (k) => p.y[old[k]], M, box).map((k) => old[k]);

  // src[s]: ה slot הישן שהמצב שלו עובר ל slot s. spawn[s]: נולד מאפס (המיקום מ src).
  const src = new Int32Array(N);
  const spawn = new Uint8Array(N);
  const used = new Uint8Array(p.capacity);
  if (M === 0) {
    src.fill(-1);
  } else if (N <= M) {
    for (let s = 0; s < N; s++) {
      const o = oldOrder[Math.min(M - 1, Math.floor(((s + 0.5) * M) / N))];
      src[s] = o;
      used[o] = 1;
    }
  } else {
    src.fill(-1);
    for (let k = 0; k < M; k++) {
      const s = Math.min(N - 1, Math.floor(((k + 0.5) * N) / M));
      src[s] = oldOrder[k];
      used[oldOrder[k]] = 1;
    }
    // בתים בלי עיגול: נולדים מהשכן הקודם (או הבא) לאורך העקומה
    let last = -1;
    for (let s = 0; s < N; s++) {
      if (src[s] >= 0 && !spawn[s]) last = src[s];
      else if (last >= 0) { src[s] = last; spawn[s] = 1; }
    }
    let nextSrc = -1;
    for (let s = N - 1; s >= 0; s--) {
      if (src[s] >= 0 && !spawn[s]) nextSrc = src[s];
      else if (src[s] < 0) { src[s] = nextSrc; spawn[s] = 1; }
    }
  }
  const leftovers = old.filter((o) => !used[o]);
  const U = leftovers.length;

  const grown = growParticles(p, N + U, rng, width, height);

  // העתקת מצב דרך עותק זמני (הקצאה רק כאן, לא בלולאת הפריים)
  const prevActive = p.active;
  const tmp = {};
  for (const k of STATE_FIELDS) tmp[k] = p[k].slice(0, Math.max(prevActive, 1));
  const phases = new Float32Array(N);
  for (let s = 0; s < N; s++) phases[s] = rng() * Math.PI * 2;

  for (let s = 0; s < N; s++) {
    const o = src[s];
    if (o >= 0) {
      for (const k of STATE_FIELDS) p[k][s] = tmp[k][o];
      if (spawn[s]) {
        p.r[s] = 0;
        p.drawR[s] = 0;
        p.vx[s] = p.vy[s] = 0;
        p.phase[s] = phases[s];
      }
    } else {
      // אין עיגולים בכלל (טעינה ראשונה): נולד במקום הבית
      p.x[s] = hx[newOrder[s]];
      p.y[s] = hy[newOrder[s]];
      p.r[s] = p.drawR[s] = p.vx[s] = p.vy[s] = p.offX[s] = p.offY[s] = 0;
      p.pulse[s] = 1;
      p.phase[s] = phases[s];
    }
    const g = newOrder[s];
    p.localX[s] = geom.lx[g];
    p.localY[s] = geom.ly[g];
    p.localR[s] = geom.lr[g];
    p.edge[s] = geom.edge[g];
    p.rand[s] = geom.rand[g];
    if (geom.rgb) {
      p.imgColor[s * 3] = geom.rgb[g * 3];
      p.imgColor[s * 3 + 1] = geom.rgb[g * 3 + 1];
      p.imgColor[s * 3 + 2] = geom.rgb[g * 3 + 2];
    }
  }
  // עודפים: מתכווצים במקומם הנוכחי
  for (let u = 0; u < U; u++) {
    const s = N + u;
    const o = leftovers[u];
    for (const k of STATE_FIELDS) p[k][s] = tmp[k][o];
    p.homeX[s] = tmp.x[o] - tmp.offX[o];
    p.homeY[s] = tmp.y[o] - tmp.offY[o];
    p.targetR[s] = 0;
  }
  for (let s = N + U; s < prevActive; s++) {
    p.r[s] = p.drawR[s] = p.targetR[s] = 0;
  }
  p.count = N;
  p.active = N + U;
  return grown;
}
