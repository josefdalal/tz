// קבצי אפייה (baked/*.tzb): מאגר, טעינה ושמירה. כמו shapes/files.js: import.meta.glob עם ?url,
// כך שהקבצים נכנסים לבנייה, ו HMR שמעדכן את אותו מאגר כשקובץ נשמר.

import { encodeBaked, decodeBaked, isGzip } from './bakedFormat.js';
import { unbakeGeometry } from './bake.js';

const urls = import.meta.glob('/baked/*.tzb', { eager: true, query: '?url', import: 'default' });

/** @type {Record<string, string>} שם קובץ אל כתובת */
export const bakedFiles = import.meta.hot?.data.bakedFiles ?? {};
const cache = import.meta.hot?.data.cache ?? new Map(); // כתובת אל Promise<geom>
if (import.meta.hot) {
  import.meta.hot.data.bakedFiles = bakedFiles;
  import.meta.hot.data.cache = cache;
  // חייב להיכתב מילולית כך: Vite מזהה מודול שמקבל את עצמו לפי הטקסט הזה
  import.meta.hot.accept();
}
// בזמן פיתוח הכתובת לא משתנה כשקובץ נדרס: t חדש בכל הרצה שובר את המטמון (לא ל data:)
const bust = import.meta.env.DEV ? `t=${Date.now()}` : '';
for (const name of Object.keys(bakedFiles)) if (!bakedFiles[name].startsWith('blob:')) delete bakedFiles[name];
for (const [path, url] of Object.entries(urls)) {
  bakedFiles[path.split('/').pop()] = bust && !url.startsWith('data:') ? `${url}${url.includes('?') ? '&' : '?'}${bust}` : url;
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'));

/** גיאומטריה אל קובץ דחוס (gzip של TZB1). */
export async function bakeToBytes(geom) {
  return gzip(encodeBaked(geom));
}

export async function bytesToGeometry(bytes) {
  return decodeBaked(isGzip(bytes) ? await gunzip(bytes) : bytes);
}

/**
 * גיאומטריה של סצנה אפויה. תומך גם באפייה הישנה, שבה העיגולים בתוך ה JSON (baked.circles).
 * @param baked scene.baked: { file, count } או { meta, fields, circles }
 */
export async function loadBakedGeometry(baked) {
  if (baked.circles) return unbakeGeometry(baked);
  const url = bakedFiles[baked.file];
  if (!url) throw new Error(`קובץ אפייה לא נמצא: baked/${baked.file}`);
  if (!cache.has(url)) {
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => bytesToGeometry(new Uint8Array(buf)))
      .catch((e) => {
        cache.delete(url);
        throw e;
      });
    cache.set(url, p);
  }
  return cache.get(url);
}

/** אחרי אפייה: הגיאומטריה שפוענחה מהקובץ נכנסת למטמון, כדי לא לטעון אותו שוב. */
export function primeBaked(file, geom) {
  const url = bakedFiles[file];
  if (url) cache.set(url, Promise.resolve(geom));
}

/**
 * שמירת קובץ אפייה. בזמן פיתוח: POST ל plugin, שכותב ל baked/. בבנייה: הורדה, וכתובת blob לסשן.
 * @returns {Promise<{file: string, persisted: boolean}>}
 */
export async function saveBakedFile(name, bytes) {
  const file = `${name}.tzb`;
  if (!import.meta.env.DEV) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    bakedFiles[file] = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = bakedFiles[file];
    a.download = file;
    a.click();
    return { file, persisted: false };
  }
  const res = await fetch('/__baked', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Tz-Save': '1', 'X-Tz-Name': encodeURIComponent(file) },
    body: bytes,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  bakedFiles[file] = `/baked/${encodeURIComponent(file)}?t=${Date.now()}`;
  return { file, persisted: true };
}
