// מסגרת, יחס ייחוס ופריסות.
//
// המסגרת היא תמיד כל ה viewport. scene.frame.reference הוא היחס שבו מעצבים (למשל "16:9").
// לייחוס יש גודל קבוע: REF_LONG פיקסלי ייחוס בצלע הארוכה (1920x1080 ב 16:9).
// האזור הבטוח הוא המלבן הגדול ביותר ביחס הייחוס שנכנס ב viewport, ממורכז.
//   unit = רוחב האזור הבטוח / רוחב הייחוס. רדיוסים וטווחי תנועה מוגדרים בפיקסלי ייחוס
//   ומוכפלים ב unit, כך שהם מתכווננים לגודל המסך.
//   x, y של פריסה: 0 עד 1 על פני האזור הבטוח. ערכים מחוץ לטווח מגיעים לשאר ה viewport.
//
// פריסות: scene.layouts.landscape (חובה) ו scene.layouts.portrait (אופציונלי, null = נגזר
// מ landscape). פריסה היא רק טרנספורמציה; הגיאומטריה משותפת. נבחרת לפי יחס המסך.
// ב portrait הייחוס מסובב (1080x1920 ב 16:9).

export const REF_LONG = 1920;
export const LAYOUT_KEYS = ['x', 'y', 'rotation', 'scale', 'flipX', 'flipY'];
export const referenceOptions = ['16:9', '16:10', '21:9', '4:3', '3:2', '1:1'];

/** "16:9" אל יחס (רוחב/גובה), תמיד 1 ומעלה. */
export function parseAspect(s) {
  const m = String(s).match(/^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/);
  const a = m ? parseFloat(m[1]) / parseFloat(m[2]) : NaN;
  if (!(a > 0)) return 16 / 9;
  return a >= 1 ? a : 1 / a;
}

export const orientationOf = (view) => (view.w >= view.h ? 'landscape' : 'portrait');

/** גודל הייחוס בפיקסלי ייחוס, לפי הכיוון. */
export function referenceSize(frame, orientation) {
  const a = parseAspect(frame.reference);
  return orientation === 'portrait' ? { w: REF_LONG / a, h: REF_LONG } : { w: REF_LONG, h: REF_LONG / a };
}

/** האזור הבטוח בתוך view = {x0, y0, w, h}, ו unit (פיקסלי מסך לפיקסל ייחוס). */
export function safeRect(frame, orientation, view) {
  const ref = referenceSize(frame, orientation);
  const r = ref.w / ref.h;
  let w;
  let h;
  if (view.w / view.h > r) {
    h = view.h;
    w = h * r;
  } else {
    w = view.w;
    h = w / r;
  }
  return { x0: view.x0 + (view.w - w) / 2, y0: view.y0 + (view.h - h) / 2, w, h, unit: w / ref.w, ref };
}

/** הפריסה בפועל לכיוון: portrait חסר נגזר מ landscape; portrait חלקי מושלם ממנו. */
export function resolveLayout(scene, orientation) {
  const L = scene.layouts.landscape;
  if (orientation !== 'portrait' || !scene.layouts.portrait) return L;
  return { ...L, ...scene.layouts.portrait };
}

/** קנה המידה (פיקסלי ייחוס ליחידת מקור) שבו הגיאומטריה נדגמת: תמיד לפי landscape. */
export function samplingScale(scene, bb) {
  const ref = referenceSize(scene.frame, 'landscape');
  return scene.layouts.landscape.scale * Math.min(ref.w / bb.w, ref.h / bb.h);
}

/** מלבן מדומה ביחס נתון, ממורכז בתוך החלון (לתצוגה מקדימה בעורך). */
export function containRect(aspect, width, height) {
  let w = width;
  let h = w / aspect;
  if (h > height) {
    h = height;
    w = h * aspect;
  }
  return { x0: (width - w) / 2, y0: (height - h) / 2, w, h };
}

// יחסי תצוגה מקדימה בעורך. "חלון" = ה viewport האמיתי.
export const previewOptions = {
  'חלון': null,
  '16:9': 16 / 9,
  '16:10': 16 / 10,
  '21:9': 21 / 9,
  '4:3': 4 / 3,
  'טלפון 9:19.5': 9 / 19.5,
};
