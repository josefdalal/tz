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

/** פותח בחירת קובץ ומחזיר את ה JSON שבו, או null אם בוטל. */
export function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        resolve(JSON.parse(await f.text()));
      } catch (e) {
        reject(new Error(`JSON לא תקין: ${e.message}`));
      }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
