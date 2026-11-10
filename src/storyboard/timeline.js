// ציר הגלילה של הסטוריבורד (docs/storyboard.md, סעיף ג). טהור: בלי DOM ובלי מאגר הפריסטים,
// כך שהנגן, העורך ו Node משתמשים באותו קוד.
//
// לכל צעד יש אזור עצירה באורך hold. אחריו, אם יש צעד הבא, אזור מעבר באורך scroll.distance
// של המעבר. אותה גלילה נותנת תמיד אותו מצב.
//
//   [hold 0][transition 0→1][hold 1][transition 1→2][hold 2]
//
// גבולות: נקודת הקצה בין עצירה למעבר שייכת לעצירה, כך שהגלילה נחה תמיד על צעד שלם.

import { defaultTransition } from '../scenes/schema.js';
import { deepMerge } from '../util/merge.js';

/**
 * @param {{steps: object[]}} storyboard אחרי fromFile (צעדים מושלמים)
 * @param {(name: string) => object|null} getTransition נתוני מעבר מלאים לפי שם (אחרי fromFile), או null
 * @param {(name: string) => object|null} [getStyle] סגנון מעבר לפי שם (transition-styles), או null
 * @returns {{ total: number, steps: object[], warnings: string[] }}
 */
export function buildTimeline(storyboard, getTransition, getStyle = () => null) {
  const warnings = [];
  // סגנון הסטוריבורד: לכל מעבר שאין לו קובץ משלו
  let style = null;
  if (storyboard.style) {
    style = getStyle(storyboard.style);
    if (!style) warnings.push(`סגנון המעבר ${storyboard.style} לא נמצא, ברירת מחדל`);
  }
  const steps = [];
  const list = storyboard.steps;
  let pos = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const next = list[i + 1];
    const entry = {
      index: i,
      id: s.id,
      scene: s.scene,
      text: s.text,
      hold: s.hold,
      holdStart: pos,
      holdEnd: pos + s.hold,
      transition: null,
    };
    pos = entry.holdEnd;

    if (!next) {
      if (s.transition) warnings.push(`${s.id}: הצעד האחרון, המעבר ${s.transition} לא בשימוש`);
    } else {
      let data = null;
      let name = null;
      if (s.transition) {
        data = getTransition(s.transition);
        if (!data) warnings.push(`${s.id}: המעבר ${s.transition} לא נמצא, ברירת מחדל`);
        else if (data.from !== s.scene || data.to !== next.scene)
          warnings.push(`${s.id}: המעבר ${s.transition} הוא ${data.from} אל ${data.to}, הצעדים הם ${s.scene} אל ${next.scene}`);
        if (data) name = s.transition;
      }
      // בלי קובץ: סגנון הסטוריבורד (או ברירת המחדל) וגלילה ברירת מחדל, עם הסצנות של הצעדים
      if (!data) data = deepMerge(defaultTransition, { ...(style ?? {}), from: s.scene, to: next.scene });
      const distance = Math.max(1, data.scroll.distance);
      entry.transition = {
        name, // null כשאין קובץ (ברירת מחדל)
        data,
        scroll: data.scroll,
        start: pos,
        end: pos + distance,
      };
      pos += distance;
    }
    steps.push(entry);
  }
  return { total: pos, steps, warnings };
}

/**
 * מיקום בגלילה אל מצב. כותב לתוך out, בלי הקצאה, כדי שאפשר לקרוא לה בכל פריים.
 * @param {ReturnType<typeof buildTimeline>} tl
 * @param {number} y פיקסלי גלילה מתחילת הסטוריבורד
 * @param {object} [out]
 * @returns {{ step: number, phase: 'hold'|'transition', local: number }}
 *   hold: local מ 0 עד 1 לאורך העצירה (ה t המקומי של שכבת הטקסט).
 *   transition: local הוא ה t של evaluateAt, בין הצעד step לצעד step + 1.
 *   בלי צעדים: step הוא -1.
 */
export function locate(tl, y, out = {}) {
  const steps = tl.steps;
  if (steps.length === 0) {
    out.step = -1;
    out.phase = 'hold';
    out.local = 0;
    return out;
  }
  const p = Math.min(Math.max(y, 0), tl.total);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const tr = s.transition;
    if (p <= s.holdEnd || !tr) {
      out.step = i;
      out.phase = 'hold';
      out.local = s.hold > 0 ? Math.min(Math.max((p - s.holdStart) / s.hold, 0), 1) : 0;
      return out;
    }
    if (p < tr.end) {
      out.step = i;
      out.phase = 'transition';
      out.local = (p - tr.start) / (tr.end - tr.start);
      return out;
    }
  }
  // לא אמור לקרות: p חתוך ל total, והצעד האחרון בלי מעבר
  out.step = steps.length - 1;
  out.phase = 'hold';
  out.local = 1;
  return out;
}

/**
 * הצעד ה"פעיל" (למחוון ההתקדמות ולטקסט הזמני): בעצירה הצעד עצמו, ובמעבר מתחלף באמצע.
 */
export function activeStep(loc) {
  return loc.phase === 'transition' && loc.local >= 0.5 ? loc.step + 1 : loc.step;
}

/**
 * נקודת snap: בעצירה המיקום עצמו (אין מה להצמיד), ובמעבר הקצה הקרוב.
 * direction אופציונלי (1 קדימה, -1 אחורה) בוחר קצה לפי כיוון הגלילה האחרון.
 */
export function snapTarget(tl, y, direction = 0) {
  const loc = locate(tl, y);
  if (loc.phase === 'hold') return Math.min(Math.max(y, 0), tl.total);
  const tr = tl.steps[loc.step].transition;
  const forward = direction > 0 || (direction === 0 && loc.local >= 0.5);
  return forward ? tr.end : tr.start;
}

/**
 * המיקום בגלילה של צעד, לניווט (נקודות המחוון, מצב step).
 * @param {number} where 0 תחילת העצירה, 1 סופה
 */
export function stepPosition(tl, index, where = 0) {
  const s = tl.steps[Math.min(Math.max(index, 0), tl.steps.length - 1)];
  return s ? s.holdStart + where * s.hold : 0;
}

/**
 * מה מוצג במיקום: זוג סצנות, נתוני מעבר ו t. במעבר, הזוג שלו ב t המקומי. בעצירה,
 * המעבר היוצא ב t של 0, ובצעד האחרון המעבר הנכנס ב 1. צעד יחיד: אותה סצנה בשני הצדדים.
 * @returns {{ a: string, b: string, data: object, t: number }|null} null בלי צעדים
 */
export function viewAt(tl, loc) {
  const steps = tl.steps;
  if (loc.step < 0) return null;
  const i = loc.step;
  if (loc.phase === 'transition' || steps[i].transition) {
    return { a: steps[i].scene, b: steps[i + 1].scene, data: steps[i].transition.data, t: loc.phase === 'transition' ? loc.local : 0 };
  }
  if (i > 0) return { a: steps[i - 1].scene, b: steps[i].scene, data: steps[i - 1].transition.data, t: 1 };
  // נשמר על הציר, כדי שהנתונים יהיו אותו אובייקט בכל פריים (הנגן משווה לפי הפניה)
  const a = steps[i].scene;
  tl.solo ??= deepMerge(defaultTransition, { from: a, to: a });
  return { a, b: a, data: tl.solo, t: 0 };
}

/** שקיפות הכניסה של טקסט הצעד, px פיקסלים מתחילת העצירה שלו: 0 לאורך text.delay, ואז עולה לאורך text.fade. */
function entryOpacity(step, px) {
  const t = step?.text;
  const delay = t?.delay ?? 0;
  if (!(delay > 0)) return 1;
  const fade = t.fade ?? 0;
  if (!(fade > 0)) return px >= delay ? 1 : 0;
  return Math.min(Math.max((px - delay) / fade, 0), 1);
}

/**
 * שקיפות הטקסט. בעצירה: מלא, או אחרי השהיה ו fade in כשלצעד יש text.delay.
 * במעבר: fade out עד האמצע, שם הטקסט מתחלף (activeStep), ו fade in של הטקסט הבא עד הסוף.
 * לצעד הבא עם השהיה אין fade in במעבר: הטקסט שלו נכנס רק בעצירה. פונקציה של המיקום בלבד, ולכן הפיכה.
 */
export function textOpacity(tl, loc) {
  const s = tl.steps[loc.step];
  if (!s) return 1;
  if (loc.phase === 'hold') return entryOpacity(s, loc.local * s.hold);
  if (loc.local < 0.5) return (1 - 2 * loc.local) * entryOpacity(s, s.hold);
  return (2 * loc.local - 1) * entryOpacity(tl.steps[loc.step + 1], 0);
}
