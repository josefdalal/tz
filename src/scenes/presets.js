// מאגר הפריסטים מהתיקיות scenes, palettes, motions בשורש הריפו.
//
// הקבצים נטענים דרך import.meta.glob, כך שהם נכנסים גם לבנייה של GitHub Pages.
// בזמן פיתוח, קובץ חדש שנשמר לתיקייה גורם ל Vite להריץ מחדש את המודול הזה (HMR).
// המאגר והמאזינים נשמרים ב import.meta.hot.data, כך שהמופע החדש מעדכן את אותו אובייקט
// שהפאנל כבר מחזיק, בלי רענון של הדף.

import { KINDS, toFile } from './schema.js';
import { downloadJSON } from './persist.js';

const files = {
  scene: import.meta.glob('/scenes/*.json', { eager: true, import: 'default' }),
  palette: import.meta.glob('/palettes/*.json', { eager: true, import: 'default' }),
  motion: import.meta.glob('/motions/*.json', { eager: true, import: 'default' }),
  transition: import.meta.glob('/transitions/*.json', { eager: true, import: 'default' }),
  transitionStyle: import.meta.glob('/transition-styles/*.json', { eager: true, import: 'default' }),
};

/** @type {Record<string, Record<string, object>>} סוג אל (שם אל קובץ) */
export const registry = import.meta.hot?.data.registry ?? {};
const listeners = import.meta.hot?.data.listeners ?? new Set();
if (import.meta.hot) {
  import.meta.hot.data.registry = registry;
  import.meta.hot.data.listeners = listeners;
  // חייב להיכתב מילולית כך: Vite מזהה מודול שמקבל את עצמו לפי הטקסט הזה
  import.meta.hot.accept();
}

for (const kind of Object.keys(KINDS)) {
  const byName = {};
  for (const [path, data] of Object.entries(files[kind])) {
    byName[path.split('/').pop().replace(/\.json$/, '')] = data;
  }
  registry[kind] = byName;
}
listeners.forEach((fn) => fn());

export function presetNames(kind) {
  return Object.keys(registry[kind]).sort((a, b) => a.localeCompare(b));
}

export function onPresetsChange(fn) {
  listeners.add(fn);
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

export function normalizeName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, '-');
  return NAME_RE.test(n) ? n : null;
}

/**
 * שמירת פריסט. בזמן פיתוח: POST ל plugin ב vite.config.js, שכותב לתיקייה בריפו.
 * בבנייה (למשל עם ?debug באתר): הורדה של הקובץ, כי אין לאן לכתוב.
 * @returns {Promise<string>} תיאור קצר של מה שקרה
 */
export async function savePreset(kind, name, data) {
  const file = toFile(kind, data);
  const { folder } = KINDS[kind];
  if (!import.meta.env.DEV) {
    downloadJSON(file, `${name}.json`);
    return `הורד ${name}.json`;
  }
  const res = await fetch('/__presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tz-Save': '1' },
    body: JSON.stringify({ folder, name, data: file }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  // עדכון מיידי; ה HMR יגיע אחר כך עם אותו תוכן
  registry[kind][name] = file;
  listeners.forEach((fn) => fn());
  return `נשמר ${body.path}`;
}
