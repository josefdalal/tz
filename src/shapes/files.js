// קבצי צורה מהתיקייה shapes בשורש הריפו (SVG, PNG, JPG, WEBP).
//
// כמו presets.js: import.meta.glob עם ?url, כך שהקבצים נכנסים לבנייה, ו HMR שמעדכן את
// אותו מאגר כשקובץ חדש נשמר. בבנייה אין לאן לשמור, ולכן העלאה יוצרת כתובת blob לסשן בלבד.

// shapes/local: תמונות ניסיון, ב .gitignore. השם שלהן ברשימה מתחיל ב local/
const urls = {
  ...import.meta.glob('/shapes/*.{svg,png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('/shapes/local/*.{svg,png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }),
};
const nameOf = (path) => path.replace(/^\/shapes\//, '');

/** @type {Record<string, string>} שם קובץ אל כתובת */
export const shapeFiles = import.meta.hot?.data.shapeFiles ?? {};
const listeners = import.meta.hot?.data.listeners ?? new Set();
if (import.meta.hot) {
  import.meta.hot.data.shapeFiles = shapeFiles;
  import.meta.hot.data.listeners = listeners;
  // חייב להיכתב מילולית כך: Vite מזהה מודול שמקבל את עצמו לפי הטקסט הזה
  import.meta.hot.accept();
}
// בנייה מחדש מהתיקייה: קובץ שנמחק יוצא מהרשימה. כתובות blob (העלאה בלי שרת) נשארות.
for (const name of Object.keys(shapeFiles)) if (!shapeFiles[name].startsWith('blob:')) delete shapeFiles[name];
// בזמן פיתוח הכתובת לא משתנה כשקובץ נדרס, ולכן t חדש בכל הרצה של המודול שובר את מטמון התמונות.
// קבצים קטנים מגיעים מ Vite כ data: URL, שהתוכן שלו כבר משתנה עם הקובץ; לא נוגעים בהם.
const bust = import.meta.env.DEV ? `t=${Date.now()}` : '';
for (const [path, url] of Object.entries(urls)) {
  const busted = bust && !url.startsWith('data:') ? `${url}${url.includes('?') ? '&' : '?'}${bust}` : url;
  shapeFiles[nameOf(path)] = busted;
}
listeners.forEach((fn) => fn());

export const shapeFileNames = () => Object.keys(shapeFiles).sort((a, b) => a.localeCompare(b));
export const onShapeFilesChange = (fn) => listeners.add(fn);

const FILE_RE = /^([\p{L}\p{N}][\p{L}\p{N}_-]{0,63})\.(svg|png|jpg|jpeg|webp)$/u;

/** שם קובץ בטוח מתוך שם הקובץ המקורי, או null. */
export function normalizeFileName(original) {
  const m = String(original).trim().match(/^(.*)\.([^.]+)$/);
  if (!m) return null;
  const name = `${m[1].trim().replace(/[\s.]+/g, '-')}.${m[2].toLowerCase()}`;
  return FILE_RE.test(name) ? name : null;
}

export const isSvgName = (name) => /\.svg$/i.test(name);

/**
 * שמירת קובץ צורה. בזמן פיתוח: POST ל plugin, שכותב ל shapes/. בבנייה: כתובת blob לסשן.
 * @returns {Promise<{name: string, persisted: boolean}>}
 */
export async function uploadShapeFile(file, name) {
  if (!import.meta.env.DEV) {
    shapeFiles[name] = URL.createObjectURL(file);
    listeners.forEach((fn) => fn());
    return { name, persisted: false };
  }
  const res = await fetch('/__shapes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Tz-Save': '1', 'X-Tz-Name': encodeURIComponent(name) },
    body: file,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  // הכתובת בזמן פיתוח ידועה מראש. t מבטיח שקובץ שנדרס לא יילקח ממטמון התמונות.
  shapeFiles[name] = `/shapes/${name.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`;
  listeners.forEach((fn) => fn());
  return { name, persisted: true };
}
