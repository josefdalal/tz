// מאגר עיגולים לכל האתר. כל המצב במערכי Float32Array, בלי אובייקטים לכל עיגול.
//
// המאגר גדל לפי הצורך (growParticles) עד MAX_POOL, ולא קטן. הגדילה קורית רק בדגימה מחדש,
// לא בתוך לולאת הפריים.
// count:  מספר העיגולים שקיבלו נקודת בית בסצנה הנוכחית.
// active: גבול הלולאות. גדול מ count כל עוד עיגולים עודפים עדיין מתכווצים לאפס.

export const MAX_POOL = 30000;
const GROW_STEP = 1000;

// שדות סקלריים
const SCALAR_FIELDS = [
  'x', 'y', 'vx', 'vy', 'homeX', 'homeY', 'r', 'targetR', 'colorT', 'phase',
  'offX', 'offY', // תנועה פנימית: היסט מנקודת הבית
  'pulse', // מכפיל פעימה של הרדיוס
  'drawR', // הרדיוס שמצויר בפועל: r * pulse
  'imgMix', // 0 צבע מהספקטרום, 1 צבע מהתמונה
  // יעד הגיאומטריה במרחב המקומי של הצורה (layout.js הופך אותם ל homeX, homeY, targetR)
  'localX', 'localY', 'localR',
  'edge', // מרחק לשוליים, מנורמל 0 עד 1 (ל mapBy=edge)
  'rand', // מספר אקראי קבוע לעיגול (ל mapBy=random)
];
const VEC3_FIELDS = ['imgColor']; // צבע מהתמונה, RGB בין 0 ל 1

export function createParticles(capacity) {
  const p = { capacity: 0, count: 0, active: 0 };
  for (const k of SCALAR_FIELDS) p[k] = new Float32Array(0);
  for (const k of VEC3_FIELDS) p[k] = new Float32Array(0);
  return p;
}

/**
 * מגדיל את המאגר כך שיכיל לפחות needed עיגולים. העיגולים החדשים מפוזרים אקראית על המסך,
 * ברדיוס אפס. מחזיר true אם המערכים הוחלפו (והרינדור צריך לבנות buffers מחדש).
 */
export function growParticles(p, needed, rng, width, height) {
  if (needed <= p.capacity) return false;
  const cap = Math.min(MAX_POOL, Math.ceil(needed / GROW_STEP) * GROW_STEP);
  const old = p.capacity;
  for (const k of SCALAR_FIELDS) {
    const a = new Float32Array(cap);
    a.set(p[k]);
    p[k] = a;
  }
  for (const k of VEC3_FIELDS) {
    const a = new Float32Array(cap * 3);
    a.set(p[k]);
    p[k] = a;
  }
  for (let i = old; i < cap; i++) {
    p.x[i] = p.homeX[i] = rng() * width;
    p.y[i] = p.homeY[i] = rng() * height;
    p.phase[i] = rng() * Math.PI * 2;
    p.pulse[i] = 1;
  }
  p.capacity = cap;
  return true;
}

// שדות "מצב" של עיגול: עוברים איתו כשהוא משנה slot בהתאמה מרחבית (match.js)
export const STATE_FIELDS = ['x', 'y', 'vx', 'vy', 'r', 'phase', 'offX', 'offY', 'pulse', 'drawR'];

/** עדכון חי של מחוון הערבוב, בלי דגימה מחדש. */
export function setImageMix(p, mix) {
  for (let i = 0; i < p.count; i++) p.imgMix[i] = mix;
}
