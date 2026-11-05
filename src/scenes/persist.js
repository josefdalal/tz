// שמירה מקומית: localStorage למצב הנוכחי, וייצוא/ייבוא של JSON כקובץ.
// כל גישה ל localStorage עטופה: בחלון פרטי או עם אחסון חסום היא יכולה לזרוק.
//
// הגיאומטריה האפויה (עד 30000 עיגולים) נשמרת במפתח נפרד, ורק כשהיא מתחלפת,
// כדי שהשמירה האוטומטית כל שנייה לא תסדר אותה מחדש בכל פעם.

const STORAGE_KEY = 'tz.current';
const BAKED_KEY = 'tz.current.baked';

export function loadLocal() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return null;
    const file = JSON.parse(s);
    if (file.baked === true) {
      const b = localStorage.getItem(BAKED_KEY);
      file.baked = b ? JSON.parse(b) : null;
    }
    return file;
  } catch {
    return null;
  }
}

let lastSaved = '';
let lastBaked;

/**
 * שומר רק אם משהו השתנה מאז השמירה הקודמת.
 * @param file הסצנה בלי baked (כדי לא לשכפל אלפי עיגולים בכל שנייה)
 * @param baked האובייקט האפוי עצמו; נשמר רק כשההפניה מתחלפת
 */
export function saveLocal(file, baked) {
  try {
    if (baked !== lastBaked) {
      if (baked) localStorage.setItem(BAKED_KEY, JSON.stringify(baked));
      else localStorage.removeItem(BAKED_KEY);
      lastBaked = baked;
    }
    const s = JSON.stringify({ ...file, baked: baked ? true : null });
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
    localStorage.removeItem(BAKED_KEY);
  } catch {
    // ראה למעלה
  }
  lastSaved = '';
  lastBaked = undefined;
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
