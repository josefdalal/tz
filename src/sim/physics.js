// פיזיקה: קפיץ עם שיכוך אל המטרה (בית ועוד היסט התנועה הפנימית), התנגשויות ועכבר.
//
// אינטגרציה: Euler חצי מובלע ב substeps. a = ω²(target - x) - 2ζω v
//   ω = 2π * spring.frequency, ζ = spring.damping (1 קריטי, בלי overshoot; מתחת ל 1 קפיצי).
//
// התנגשויות ועכבר הם אילוצי מיקום: מפרידים עיגולים חופפים, ואחר כך מבטלים את רכיב
// המהירות שנכנס לתוך המכשול (מגע לא אלסטי). כך אין אנרגיה שנוספת מהתנגשויות, ועיגול
// שמוחזק לא צובר מהירות נסתרת שתזרוק אותו מעבר לבית כשמשחררים.
//
// לחץ וחזרה הביתה: הבתים צפופים (כמעט נוגעים), ולכן עיגול שנדחף אל מחוץ לאריזה לא יכול
// לעבור בין השכנים בחזרה, ונתקע. לכן לכל עיגול יש "לחץ": 1 כשהעכבר נוגע בו, עובר הלאה
// דרך התנגשויות (קצת פוחת בכל מעבר), ודועך תוך כשליש שנייה. עיגול בלחץ מוצק, כך
// שהדחיפה מתפשטת. עיגול בלי לחץ שרחוק מהבית הופך בהדרגה ל"רוח" (משקל התנגשות 1 עד חצי
// רדיוס מהבית, 0 מרדיוס וחצי), חולף דרך השכנים, ונעשה מוצק שוב כשהוא מתקרב.
//
// כשההתנגשויות כבויות: אין רשת ואין לולאת זוגות. כשאין מצביע: אין לולאת עכבר.
// הקצאות זיכרון רק כשהמאגר או הרשת גדלים, לא בכל פריים.

const RADIUS_RATE = 6; // התקרבות הרדיוס ליעד (גדילה והתכווצות), אקספוננציאלית
const PRESS_DECAY = 8; // דעיכת לחץ לשנייה (כשליש שנייה עד שהוא כמעט נעלם)
const PRESS_PASS = 0.95; // כמה לחץ עובר לשכן בהתנגשות
const PRESS_SOLID = 0.1; // מעל זה העיגול מוצק תמיד
// אזור המעבר לרוח, ברדיוסים מהבית: מוצק עד GHOST_START, רוח מלאה מ GHOST_END.
// אזור רחב מדי משאיר עיגולים חצי מוצקים שנתקעים בין שכנים.
const GHOST_START = 0.5;
const GHOST_END = 1.5;

export function createPhysics() {
  return {
    pointer: { active: false, x: 0, y: 0 },
    cellStart: new Int32Array(1),
    cellCursor: new Int32Array(1),
    cellItems: new Int32Array(0),
    cellOf: new Int32Array(0),
    solid: new Float32Array(0), // משקל התנגשות לכל עיגול, 0 עד 1
    press: new Float32Array(0), // לחץ מהעכבר, 0 עד 1
    preX: new Float32Array(0),
    preY: new Float32Array(0),
    ms: 0,
  };
}

function ensureItems(ph, cap) {
  if (ph.cellItems.length >= cap) return;
  const press = new Float32Array(cap);
  press.set(ph.press);
  ph.press = press;
  ph.cellItems = new Int32Array(cap);
  ph.cellOf = new Int32Array(cap);
  ph.solid = new Float32Array(cap);
  ph.preX = new Float32Array(cap);
  ph.preY = new Float32Array(cap);
}

function ensureCells(ph, n) {
  if (ph.cellStart.length >= n + 1) return;
  const size = Math.ceil((n + 1) * 1.5);
  ph.cellStart = new Int32Array(size);
  ph.cellCursor = new Int32Array(size);
}

/**
 * צעד פריים אחד.
 * @param cfg  scene.physics
 * @param unit פיקסלי מסך לפיקסל ייחוס (frame.js), לרדיוס העכבר
 * @param view המסגרת {x0, y0, w, h}, לגבולות הרשת
 */
export function stepPhysics(ph, p, cfg, dt, unit, view) {
  const t0 = performance.now();
  const n = p.active;
  const { x, y, vx, vy, homeX, homeY, offX, offY, r, targetR, pulse, drawR } = p;

  // רדיוס: התקרבות ליעד, ורדיוס מצויר עם פעימה. במעבר הרדיוס טהור (cfg.pureRadius): r = targetR.
  const kr = cfg.pureRadius ? 1 : 1 - Math.exp(-dt * RADIUS_RATE);
  let lastVisible = -1;
  for (let i = 0; i < n; i++) {
    r[i] += (targetR[i] - r[i]) * kr;
    if (i >= p.count && r[i] < 0.01) r[i] = 0;
    else lastVisible = i;
    drawR[i] = r[i] * pulse[i];
  }

  const sub = Math.max(1, cfg.substeps | 0);
  const h = dt / sub;
  const w = 2 * Math.PI * cfg.spring.frequency;
  const k2 = w * w;
  const c = 2 * cfg.spring.damping * w;

  const col = cfg.collisions.enabled;
  const pointer = ph.pointer;
  const mouse = cfg.mouse.enabled && pointer.active;
  const constrained = col || mouse;
  const rad = cfg.collisions.radius === 'pulsed' ? drawR : r;
  if (constrained) {
    ensureItems(ph, p.capacity);
    const decay = Math.exp(-dt * PRESS_DECAY);
    const press = ph.press;
    for (let i = 0; i < n; i++) press[i] *= decay;
  }
  const { preX, preY } = ph;

  for (let s = 0; s < sub; s++) {
    // קפיץ ושיכוך אל המטרה
    for (let i = 0; i < n; i++) {
      const ax = k2 * (homeX[i] + offX[i] - x[i]) - c * vx[i];
      const ay = k2 * (homeY[i] + offY[i] - y[i]) - c * vy[i];
      vx[i] += ax * h;
      vy[i] += ay * h;
      x[i] += vx[i] * h;
      y[i] += vy[i] * h;
    }
    if (!constrained) continue;

    for (let i = 0; i < n; i++) {
      preX[i] = x[i];
      preY[i] = y[i];
    }
    if (mouse) pushFromPointer(ph, p, n, pointer, cfg.mouse.radius * unit, cfg.mouse.strength, rad);
    if (col) {
      buildGrid(ph, p, n, rad, view);
      const iters = Math.max(1, cfg.collisions.iterations | 0);
      for (let it = 0; it < iters; it++) solveCollisions(ph, p, rad, cfg.collisions.strength);
    }
    // מגע לא אלסטי: מבטלים את רכיב המהירות שנכנס לכיוון ההפוך לתיקון
    for (let i = 0; i < n; i++) {
      const dx = x[i] - preX[i];
      const dy = y[i] - preY[i];
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-12) continue;
      const vn = (vx[i] * dx + vy[i] * dy) / d2;
      if (vn < 0) {
        vx[i] -= vn * dx;
        vy[i] -= vn * dy;
      }
    }
  }

  p.active = Math.max(p.count, lastVisible + 1);
  ph.ms = ph.ms * 0.9 + (performance.now() - t0) * 0.1;
}

function pushFromPointer(ph, p, n, pointer, mr, strength, rad) {
  const { x, y, overlayW } = p;
  const press = ph.press;
  const px = pointer.x;
  const py = pointer.y;
  for (let i = 0; i < n; i++) {
    const ri = rad[i];
    if (ri < 0.01) continue;
    const dx = x[i] - px;
    const dy = y[i] - py;
    const R = mr + ri;
    const d2 = dx * dx + dy * dy;
    if (d2 >= R * R) continue;
    const d = Math.sqrt(d2) || 1e-3;
    const push = ((R - d) * strength * overlayW[i]) / d;
    x[i] += dx * push;
    y[i] += dy * push;
    press[i] = 1;
  }
}

// רשת: תא בגודל קוטר מרבי, מעל המסגרת עם שוליים. עיגולים מחוץ לגבולות נצמדים לתאי הקצה.
let gridCols = 0;
let gridRows = 0;

function buildGrid(ph, p, n, rad, view) {
  let maxR = 0;
  for (let i = 0; i < n; i++) if (rad[i] > maxR) maxR = rad[i];
  const cell = Math.max(2, maxR * 2);
  const margin = cell * 2;
  const gx0 = view.x0 - margin;
  const gy0 = view.y0 - margin;
  gridCols = Math.max(1, Math.ceil((view.w + margin * 2) / cell));
  gridRows = Math.max(1, Math.ceil((view.h + margin * 2) / cell));
  const nCells = gridCols * gridRows;
  ensureCells(ph, nCells);
  const { cellStart, cellCursor, cellItems, cellOf, solid, press } = ph;
  const { x, y, homeX, homeY, offX, offY } = p;
  cellStart.fill(0, 0, nCells + 1);
  for (let i = 0; i < n; i++) {
    const ri = rad[i];
    if (ri < 0.01) {
      cellOf[i] = -1;
      continue;
    }
    // משקל התנגשות: מוצק בלחץ; בלי לחץ, רוח לפי המרחק מהבית (ראה בראש הקובץ)
    let s = 1;
    if (press[i] < PRESS_SOLID) {
      const tx = homeX[i] + offX[i] - x[i];
      const ty = homeY[i] + offY[i] - y[i];
      const dist = Math.sqrt(tx * tx + ty * ty);
      if (dist > GHOST_START * ri) {
        const t = Math.min(1, (dist - GHOST_START * ri) / ((GHOST_END - GHOST_START) * ri));
        s = 1 - t * t * (3 - 2 * t);
      }
    }
    // במעבר: שכבת העל דועכת בזמן תעופה (overlayW = 1 בסצנה רגילה)
    s *= p.overlayW[i];
    solid[i] = s;
    if (s === 0) {
      cellOf[i] = -1; // רוח מלאה: לא נכנס לרשת בכלל
      continue;
    }
    let cx = ((x[i] - gx0) / cell) | 0;
    let cy = ((y[i] - gy0) / cell) | 0;
    cx = cx < 0 ? 0 : cx >= gridCols ? gridCols - 1 : cx;
    cy = cy < 0 ? 0 : cy >= gridRows ? gridRows - 1 : cy;
    const ci = cy * gridCols + cx;
    cellOf[i] = ci;
    cellStart[ci + 1]++;
  }
  for (let ci = 0; ci < nCells; ci++) cellStart[ci + 1] += cellStart[ci];
  cellCursor.set(cellStart.subarray(0, nCells));
  for (let i = 0; i < n; i++) {
    const ci = cellOf[i];
    if (ci >= 0) cellItems[cellCursor[ci]++] = i;
  }
}

// פונקציה ברמת המודול ולא closure, כדי לא להקצות בכל פריים
function resolve(x, y, rad, solid, press, half, i, j) {
  const dx = x[j] - x[i];
  const dy = y[j] - y[i];
  const R = rad[i] + rad[j];
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return;
  const wgt = solid[i] < solid[j] ? solid[i] : solid[j];
  if (wgt === 0) return;
  // הלחץ עובר מהעיגול הלחוץ יותר לשכן שלו
  const pi = press[i];
  const pj = press[j];
  if (pi > pj) press[j] = pi * PRESS_PASS;
  else if (pj > pi) press[i] = pj * PRESS_PASS;
  if (d2 < 1e-8) {
    // חפיפה מלאה: הפרדה בכיוון קבוע לפי אינדקס, כדי שהתוצאה תהיה דטרמיניסטית
    const a = (i * 2.399963) % (Math.PI * 2);
    x[j] += Math.cos(a) * R * half * wgt;
    y[j] += Math.sin(a) * R * half * wgt;
    return;
  }
  const d = Math.sqrt(d2);
  const push = ((R - d) * half * wgt) / d;
  x[i] -= dx * push;
  y[i] -= dy * push;
  x[j] += dx * push;
  y[j] += dy * push;
}

function solveCollisions(ph, p, rad, strength) {
  const { cellStart, cellItems, solid, press } = ph;
  const { x, y } = p;
  const half = 0.5 * strength;

  for (let cy = 0; cy < gridRows; cy++) {
    for (let cx = 0; cx < gridCols; cx++) {
      const ci = cy * gridCols + cx;
      const s0 = cellStart[ci];
      const e0 = cellStart[ci + 1];
      if (s0 === e0) continue;
      // זוגות בתוך התא
      for (let a = s0; a < e0; a++) {
        for (let b = a + 1; b < e0; b++) resolve(x, y, rad, solid, press, half, cellItems[a], cellItems[b]);
      }
      // חצי שכונה, כדי שכל זוג ייבדק פעם אחת: ימינה, ושלושה תאים בשורה הבאה
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k - 2);
        const ny = cy + (k === 0 ? 0 : 1);
        if (nx < 0 || nx >= gridCols || ny >= gridRows) continue;
        const cj = ny * gridCols + nx;
        const s1 = cellStart[cj];
        const e1 = cellStart[cj + 1];
        for (let a = s0; a < e0; a++) {
          const i = cellItems[a];
          for (let b = s1; b < e1; b++) resolve(x, y, rad, solid, press, half, i, cellItems[b]);
        }
      }
    }
  }
}
