// כלי מיזוג לאובייקטי JSON פשוטים (סצנות, פלטות, תנועות).

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const clone = (v) => structuredClone(v);

/**
 * מיזוג עמוק של קובץ טעון עם ברירות המחדל.
 * מפתחות שחסרים בקובץ מקבלים את ברירת המחדל, כך שקבצים ישנים ממשיכים לעבוד כשנוספים פרמטרים.
 * מערכים מוחלפים בשלמותם (למשל stops). ערך מסוג שונה מברירת המחדל נדחה.
 * מפתחות שלא קיימים בברירות המחדל נשמרים כמו שהם.
 */
export function deepMerge(defaults, source) {
  if (source === undefined) return clone(defaults);
  if (defaults === undefined) return clone(source);
  if (Array.isArray(defaults)) return Array.isArray(source) ? clone(source) : clone(defaults);
  if (isPlainObject(defaults)) {
    if (!isPlainObject(source)) return clone(defaults);
    const out = clone(defaults);
    for (const key of Object.keys(source)) out[key] = deepMerge(defaults[key], source[key]);
    return out;
  }
  if (defaults !== null && typeof source !== typeof defaults) return defaults;
  return source;
}

/**
 * כותב את source לתוך target במקום, בלי להחליף אובייקטים פנימיים.
 * כך controllers של הפאנל, שמחזיקים הפניה לאובייקטים, ממשיכים לעבוד אחרי טעינה.
 */
export function assignInPlace(target, source) {
  for (const key of Object.keys(source)) {
    const s = source[key];
    const t = target[key];
    if (isPlainObject(s) && isPlainObject(t)) assignInPlace(t, s);
    else if (Array.isArray(s) && Array.isArray(t)) t.splice(0, t.length, ...clone(s));
    else target[key] = clone(s);
  }
  return target;
}
