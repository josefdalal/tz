import { shapes } from '../shapes/library.js';
import { deepMerge, clone } from '../util/merge.js';

// גרסת מבנה הקבצים. כשמשנים מבנה באופן שמיזוג עם ברירות מחדל לא מספיק
// (שינוי שם או העברת שדה), מעלים את הגרסה ומוסיפים פונקציה ל migrations.
export const SCHEMA_VERSION = 1;

export const defaultScene = {
  id: 'intro',
  seed: 42,
  maxCount: 5000,
  shape: {
    type: 'svgPath', // svgPath: צורה מ d. image: קובץ מהתיקייה shapes (SVG, PNG, JPG)
    d: shapes.square,
    fillRule: 'nonzero',
    src: '', // שם קובץ בתיקייה shapes, כש type הוא image
    // טרנספורמציה: מרכז הצורה יחסית למסך, סיבוב במעלות, קנה מידה יחסית לצלע הקצרה
    x: 0.5,
    y: 0.5,
    rotation: 0,
    scale: 0.6,
    flipX: false,
    flipY: false,
    image: {
      maskBy: 'alpha', // alpha או luminance (כהה בפנים)
      threshold: 0.5,
      invert: false, // היפוך המסכה, בתוך גבולות התמונה
      sizeAmount: 0, // 0 רדיוס לפי sizeMode, 1 רדיוס לפי בהירות התמונה (stippling)
      sizeInvert: false, // false: כהה גדול. true: בהיר גדול
      colorMix: 0, // 0 צבע מהספקטרום, 1 צבע מהתמונה
    },
  },
  radius: { min: 2, max: 12, sizeMode: 'edgeDistance', gap: 0.5, noiseScale: 0.006 },
  palette: {
    space: 'oklch',
    stops: ['#0b1d51', '#3a6ea5', '#ff6b6b'],
    mapBy: 'y',
    background: '#f3efe6',
  },
  motion: {
    speed: 1, // מכפיל כללי לכל מהירויות התנועה
    pulse: { amount: 8, speed: 0.4 }, // amount באחוזים מהרדיוס, speed במחזורים לשנייה
    wander: { range: 3, speed: 0.25 }, // range בפיקסלים, speed ביחידות זמן של noise לשנייה
    coherence: 0, // 0 כל עיגול לפי הפאזה שלו, 1 שדה noise משותף לפי מיקום
    fieldScale: 0.004, // סקאלת השדה המשותף (קטן יותר: אזורים גדולים יותר שזזים יחד)
    colorShift: 0.1, // שלב 3
  },
  physics: { stiffness: 0.08, damping: 0.88, collision: 1.0, mouseRadius: 80 },
  enter: { mode: 'fromCenter' },
  exit: { mode: 'disperse', strength: 1.0 },
  render: { mode: 'flat', lightDir: [-0.4, -0.6, 0.7] },
  // גיאומטריה אפויה (bake.js), או null. כשקיימת, פרמטרי הגיאומטריה נעולים.
  baked: null,
};

// הפרדה בין פרמטרי גיאומטריה (שינוי מחייב דגימה ב worker) לפרמטרים חיים (כל השאר:
// טרנספורמציה, צבע, תנועה, פיזיקה, רקע). פרמטר חי אף פעם לא מפעיל דגימה.
// shape.image.colorMix חי, למרות שהוא יושב תחת shape.image.
const GEOMETRY_PATHS = [
  'seed',
  'maxCount',
  'shape.type',
  'shape.d',
  'shape.fillRule',
  'shape.src',
  'shape.image.maskBy',
  'shape.image.threshold',
  'shape.image.invert',
  'shape.image.sizeAmount',
  'shape.image.sizeInvert',
  'radius',
];

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

/** מחרוזת שמשתנה אם ורק אם פרמטר גיאומטריה השתנה. */
export function geometryKey(scene) {
  return JSON.stringify(GEOMETRY_PATHS.map((p) => get(scene, p)));
}

export const sizeModes = ['random', 'edgeDistance', 'noise'];
export const mapByModes = ['y', 'x', 'radius', 'edge', 'radial', 'random'];
export const maskByModes = ['alpha', 'luminance'];

// שלושה סוגי פריסטים. scene מכיל גם palette ו motion; השניים האחרים הם חלקים ממנו.
export const KINDS = {
  scene: { folder: 'scenes', label: 'סצנה', defaults: () => defaultScene },
  palette: { folder: 'palettes', label: 'פלטה', defaults: () => defaultScene.palette },
  motion: { folder: 'motions', label: 'תנועה', defaults: () => defaultScene.motion },
};

// migrations[kind][v] ממיר נתונים מגרסה v לגרסה v+1. כרגע אין.
const migrations = { scene: {}, palette: {}, motion: {} };

/** נתונים חיים אל מבנה קובץ: version ו type בראש, ואחריהם השדות. */
export function toFile(kind, data) {
  return { version: SCHEMA_VERSION, type: kind, ...clone(data) };
}

/**
 * מבנה קובץ אל נתונים חיים: זיהוי סוג, הרצת migrations ומיזוג עמוק עם ברירות המחדל.
 * @param {object} file
 * @param {string} [expectedKind] אם ניתן, קובץ מסוג אחר נדחה. קובץ בלי type מקבל אותו.
 */
export function fromFile(file, expectedKind) {
  if (file === null || typeof file !== 'object' || Array.isArray(file)) throw new Error('קובץ JSON לא תקין');
  const kind = file.type ?? expectedKind;
  if (!KINDS[kind]) throw new Error(`סוג קובץ לא מוכר: ${kind}`);
  if (expectedKind && kind !== expectedKind) throw new Error(`צפוי ${expectedKind}, התקבל ${kind}`);

  let version = Number.isFinite(file.version) ? file.version : 1;
  if (version > SCHEMA_VERSION) console.warn(`[tz] הקובץ מגרסה ${version}, הקוד מכיר עד ${SCHEMA_VERSION}`);

  let data = clone(file);
  delete data.version;
  delete data.type;
  for (; version < SCHEMA_VERSION; version++) {
    const step = migrations[kind][version];
    if (step) data = step(data);
  }
  return { kind, data: deepMerge(KINDS[kind].defaults(), data) };
}
