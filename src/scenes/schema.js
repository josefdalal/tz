import { shapes } from '../shapes/library.js';
import { deepMerge, clone } from '../util/merge.js';

// גרסת מבנה הקבצים. כשמשנים מבנה באופן שמיזוג עם ברירות מחדל לא מספיק
// (שינוי שם או העברת שדה), מעלים את הגרסה ומוסיפים פונקציה ל migrations.
export const SCHEMA_VERSION = 3;

const LAYOUT_KEYS = ['x', 'y', 'rotation', 'scale', 'flipX', 'flipY'];

export const defaultScene = {
  id: 'intro',
  seed: 42,
  maxCount: 5000,
  // יחס הייחוס שבו מעצבים. המסגרת עצמה היא תמיד כל ה viewport (frame.js).
  frame: { reference: '16:9' },
  // פריסות: רק טרנספורמציה, הגיאומטריה משותפת. portrait null: נגזר מ landscape.
  // x, y: 0 עד 1 על פני האזור הבטוח. scale: יחסית להתאמה לצלע הקצרה של הייחוס.
  layouts: {
    landscape: { x: 0.5, y: 0.5, rotation: 0, scale: 0.6, flipX: false, flipY: false },
    portrait: null,
  },
  shape: {
    type: 'svgPath', // svgPath: צורה מ d. image: קובץ מהתיקייה shapes (SVG, PNG, JPG)
    d: shapes.square,
    fillRule: 'nonzero',
    src: '', // שם קובץ בתיקייה shapes, כש type הוא image
    image: {
      maskBy: 'alpha', // alpha או luminance (כהה בפנים)
      threshold: 0.5,
      invert: false, // היפוך המסכה, בתוך גבולות התמונה
      sizeAmount: 0, // 0 רדיוס לפי sizeMode, 1 רדיוס לפי בהירות התמונה (stippling)
      sizeInvert: false, // false: כהה גדול. true: בהיר גדול
      colorMix: 0, // 0 צבע מהספקטרום, 1 צבע מהתמונה
    },
  },
  // רדיוסים ומרווח בפיקסלי ייחוס (1920 בצלע הארוכה), מוכפלים ב unit לפי גודל המסך
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
    wander: { range: 3, speed: 0.25 }, // range בפיקסלי ייחוס, speed ביחידות זמן של noise לשנייה
    coherence: 0, // 0 כל עיגול לפי הפאזה שלו, 1 שדה noise משותף לפי מיקום
    fieldScale: 0.004, // סקאלת השדה המשותף (קטן יותר: אזורים גדולים יותר שזזים יחד)
    colorShift: 0.1, // שלב 3
  },
  // פיזיקה (חי). קפיץ: frequency בהרץ, damping יחס שיכוך (1 קריטי, בלי overshoot).
  // ברירת המחדל קרובה בזמן ההתקרבות ל relax הזמני הקודם.
  physics: {
    spring: { frequency: 2, damping: 1 },
    substeps: 2,
    collisions: {
      enabled: false, // כבוי: אפס עלות, בלי רשת
      strength: 1, // חלק מהחפיפה שמופרד בכל איטרציה
      iterations: 2,
      radius: 'base', // base: הרדיוס בלי פעימה. pulsed: הרדיוס המצויר, עם פעימה
    },
    mouse: { enabled: true, radius: 80, strength: 1 }, // radius בפיקסלי ייחוס
  },
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
export const collisionRadiusModes = ['base', 'pulsed'];

// סגנון מעבר בין שתי סצנות (src/transitions). הכול פרמטרים, בלי מיקומים.
export const defaultTransitionStyle = {
  matching: { mode: 'hilbert', seed: 1 }, // hilbert, nearest, brightness, size, random
  path: {
    mode: 'straight', // straight, arc, noise, scatter, gather
    curvature: 0.35, // arc: הסטת נקודת הביקורת, ביחס לאורך המסלול
    direction: 'cw', // arc: cw, ccw, alternate, random
    noiseAmount: 120, // noise: עוצמה בפיקסלי ייחוס
    noiseScale: 0.004, // noise: סקאלת השדה
    spread: 260, // scatter: רדיוס ההתפזרות בפיקסלי ייחוס
    gatherShrink: 0.4, // gather: קנה הרדיוס בנקודת האיסוף
  },
  order: { mode: 'none', stagger: 0.4, reverse: false, seed: 1 }, // none, x, y, distance, radius, color, random
  focus: [0.5, 0.5], // נקודה במסגרת (0 עד 1): ל order=distance ול path=gather
  leftovers: { mode: 'shrink', angle: -90 }, // עודפים ב A: shrink, exit (בכיוון angle), merge
  spawns: { mode: 'grow', angle: 90 }, // חוסרים ב B: grow, split, edges, direction (נכנסים בכיוון angle)
  ease: 'power2.inOut', // easing של GSAP, לכל עיגול
  overlay: { dip: 1, sharpness: 1 }, // שכבת העל (תנועה, התנגשויות) בזמן תעופה: 1 - dip * sin(πu)^sharpness
  duration: 2.5, // שניות, לניגון בעורך
};

// גלילה: איך גלגלת ומשטח מגע מזיזים את t. שייך למעבר (לא לסגנון), כי זה עניין של
// הסטוריבורד; הנגן ישתמש באותם ערכים.
export const defaultScroll = {
  distance: 1200, // כמה פיקסלי גלילה שווים מעבר שלם (0 עד 1)
  smoothing: 0.12, // חלק מהמרחק ליעד שנסגר בכל פריים של 60Hz, כמו lerp של Lenis. קטן = חלק יותר
  snapDelay: 350, // מילישניות בלי גלילה עד הנצמדות ל 0 או ל 1
};

// מעבר שמור: זוג סצנות, סגנון וגלילה. נשמר כ transitions/<from>__<to>.json
export const defaultTransition = { from: '', to: '', scroll: defaultScroll, ...defaultTransitionStyle };

// סטוריבורד (docs/storyboard.md, סעיף ג): רשימת צעדים. נשמר כ storyboard/storyboard.json.
// בלוק הטקסט של צעד, במבנה הסופי של docs/text-layer.md. כל שדה אופציונלי.
// בשלב 6 יתווספו לאותו אובייקט שדות מיקום ונקודות כניסה ויציאה.
export const defaultStepText = { title: '', body: '', link: { text: '', href: '' } };

export const defaultStep = {
  id: '', // מזהה יציב לצעד, לא תלוי במיקום ברשימה
  scene: '', // שם סצנה ב scenes/
  hold: 800, // אורך אזור העצירה, בפיקסלי גלילה
  transition: null, // שם קובץ ב transitions/ למעבר לצעד הבא, או null (סגנון וגלילה ברירת מחדל)
  text: null, // defaultStepText או null
};

export const playbackModes = ['scrub', 'step'];
export const defaultStoryboard = { playback: 'scrub', steps: [] };

/** השלמת כל צעד מול ברירות המחדל. deepMerge מחליף מערכים בשלמותם, ולכן הצעדים מושלמים כאן. */
function normalizeStoryboard(data) {
  if (!playbackModes.includes(data.playback)) data.playback = defaultStoryboard.playback;
  const used = new Set();
  data.steps = data.steps
    .filter((s) => s !== null && typeof s === 'object' && !Array.isArray(s))
    .map((raw, i) => {
      const step = deepMerge(defaultStep, raw);
      if (!Number.isFinite(step.hold) || step.hold < 0) step.hold = defaultStep.hold;
      if (typeof step.transition !== 'string' || step.transition === '') step.transition = null;
      step.text = step.text !== null && typeof step.text === 'object' ? deepMerge(defaultStepText, step.text) : null;
      let id = typeof step.id === 'string' && step.id ? step.id : `s${i + 1}`;
      while (used.has(id)) id = `${id}_`;
      used.add(id);
      step.id = id;
      return step;
    });
  return data;
}

// סוגי פריסטים. scene מכיל גם palette ו motion. panel: false = לא בתיקיית "פריסטים" אלא
// בתיקיית "מעבר" או "סטוריבורד" של העורך. normalize רץ אחרי המיזוג.
export const KINDS = {
  scene: { folder: 'scenes', label: 'סצנה', defaults: () => defaultScene },
  palette: { folder: 'palettes', label: 'פלטה', defaults: () => defaultScene.palette },
  motion: { folder: 'motions', label: 'תנועה', defaults: () => defaultScene.motion },
  transition: { folder: 'transitions', label: 'מעבר', defaults: () => defaultTransition, panel: false },
  transitionStyle: { folder: 'transition-styles', label: 'סגנון מעבר', defaults: () => defaultTransitionStyle, panel: false },
  storyboard: { folder: 'storyboard', label: 'סטוריבורד', defaults: () => defaultStoryboard, panel: false, normalize: normalizeStoryboard },
};
export const PANEL_KINDS = Object.keys(KINDS).filter((k) => KINDS[k].panel !== false);

// migrations[kind][v] ממיר נתונים מגרסה v לגרסה v+1.
const migrations = {
  transition: {},
  transitionStyle: {},
  storyboard: {},
  scene: {
    // 1 אל 2: הטרנספורמציה עברה מ shape אל layouts.landscape. אפייה ישנה נשמרת כמו שהיא
    // (s0 שלה היה בפיקסלי מסך, ולכן הגודל שלה עשוי לזוז מעט).
    1: (data) => {
      const shape = data.shape ?? {};
      const landscape = {};
      for (const k of LAYOUT_KEYS) {
        if (k in shape) landscape[k] = shape[k];
        delete shape[k];
      }
      delete shape.fit;
      return { ...data, shape, layouts: { landscape, portrait: null } };
    },
    // 2 אל 3: שדות הפיזיקה הישנים (מקדמים לפריים, שלא היו בשימוש) הוחלפו במבנה חדש.
    // רק mouseRadius עובר; השאר מקבלים ברירת מחדל.
    2: (data) => {
      const old = data.physics ?? {};
      const physics = {};
      if (typeof old.mouseRadius === 'number') physics.mouse = { radius: old.mouseRadius };
      for (const k of ['spring', 'substeps', 'collisions', 'mouse']) if (k in old) physics[k] = old[k];
      return { ...data, physics };
    },
  },
  palette: {},
  motion: {},
};

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
  const merged = deepMerge(KINDS[kind].defaults(), data);
  return { kind, data: KINDS[kind].normalize ? KINDS[kind].normalize(merged) : merged };
}
