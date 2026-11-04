// שמירה מקומית: localStorage למצב הנוכחי, וייצוא/ייבוא של JSON כקובץ.
// כל גישה ל localStorage עטופה: בחלון פרטי או עם אחסון חסום היא יכולה לזרוק.

const STORAGE_KEY = 'tz.current';

export function loadLocal() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

let lastSaved = '';

/** שומר רק אם משהו השתנה מאז השמירה הקודמת. */
export function saveLocal(file) {
  try {
    const s = JSON.stringify(file);
    if (s === lastSaved) return;
    localStorage.setItem(STORAGE_KEY, s);
    lastSaved = s;
  } catch {
    // אחסון מלא או חסום: ממשיכים בלי שמירה
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ראה למעלה
  }
  lastSaved = '';
}

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** פותח בחירת קובץ ומחזיר File, או null אם בוטל. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** פותח בחירת קובץ ומחזיר את ה JSON שבו, או null אם בוטל. */
export async function pickJSONFile() {
  const f = await pickFile('.json,application/json');
  if (!f) return null;
  try {
    return JSON.parse(await f.text());
  } catch (e) {
    throw new Error(`JSON לא תקין: ${e.message}`);
  }
}
