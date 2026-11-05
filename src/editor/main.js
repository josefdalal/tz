// העורך (editor.html). המנוע עצמו ב src/engine/stage.js, משותף עם הנגן.
// כאן כל מה ששייך לכלי: פאנל, worker לדגימה, פריסטים, אפייה, מצב מעבר, ייצוא, שמירה אוטומטית.
//
// שני מסלולים נפרדים:
//   גיאומטריה: פרמטר דגימה השתנה, נשלחת בקשה ל worker (debounce). התוצאה (במרחב המקומי)
//              מוחלפת עם התאמה מרחבית (match.js): העיגולים זורמים לבתים קרובים.
//   חי:        טרנספורמציה, צבע, תנועה, רקע. מחושבים מהגיאומטריה הקיימת, בלי דגימה.
// סצנה אפויה (scene.baked) משמשת כגיאומטריה במקום ה worker.

import { createStage } from '../engine/stage.js';
import { framePNG, frameSVG } from '../render/export.js';
import { createSampler } from '../shapes/sampling.js';
import { shapeFiles, shapeFileNames, onShapeFilesChange, uploadShapeFile, normalizeFileName } from '../shapes/files.js';
import { defaultScene, KINDS, PANEL_KINDS, toFile, fromFile, geometryKey } from '../scenes/schema.js';
import { previewOptions, LAYOUT_KEYS } from '../scenes/frame.js';
import { createFrameOverlay } from '../ui/frameOverlay.js';
import { createTransitionMode } from '../transitions/mode.js';
import { bakedFiles, bakeToBytes, bytesToGeometry, loadBakedGeometry, saveBakedFile, primeBaked } from '../scenes/bakedFiles.js';
import { registry, presetNames, onPresetsChange, savePreset, normalizeName } from '../scenes/presets.js';
import { loadLocal, saveLocal, clearLocal, downloadJSON, downloadBlob, pickJSONFile, pickFile } from '../scenes/persist.js';
import { createGui } from '../ui/gui.js';
import { assignInPlace, clone } from '../util/merge.js';

// מצב התחלתי: המצב האחרון מ localStorage, אחרת ברירת המחדל
function initialScene() {
  const saved = loadLocal();
  if (saved) {
    try {
      return fromFile(saved, 'scene').data;
    } catch (e) {
      console.warn('[tz] מצב שמור לא תקין, נטענת ברירת מחדל', e);
    }
  }
  return clone(defaultScene);
}

const canvas = document.getElementById('stage');
const scene = initialScene();
const editor = { preview: 'חלון', showSafe: true };
const overlay = createFrameOverlay();
let transition = null;

const stage = createStage({
  canvas,
  scene,
  previewAspect: () => previewOptions[editor.preview],
  onFrame: (s) => {
    overlay.update(s.view, s.safe, {
      width: s.width,
      height: s.height,
      showSafe: editor.showSafe,
      simulated: s.simulated,
      background: currentBackground(),
      text: `${s.orientation}${s.orientation === 'portrait' && !scene.layouts.portrait ? ' (נגזר)' : ''} · ייחוס ${scene.frame.reference}`,
    });
  },
});
const { particles, renderer, stats } = stage;

// ---------- גיאומטריה ----------

let lastGeomKey = null;

function applyGeometry(g) {
  if (transition?.active) {
    stage.geom = g; // במצב מעבר הגיאומטריה נשמרת, ותוחל ביציאה ממנו
    return;
  }
  stage.applyGeometry(g);
}

const sampler = createSampler(
  () => ({ scene }),
  (g) => {
    if (scene.baked) return; // נאפה בזמן שהדגימה רצה
    stats.sampleMs = Math.round(g.ms);
    applyGeometry(g);
  },
  (s) => {
    stats.sampling = s === 'busy' ? 'מחשב...' : s === 'idle' ? 'מוכן' : s;
    if (s.startsWith('שגיאה')) gui?.status(s);
  },
);

/** פרמטר גיאומטריה השתנה. נעול כשהסצנה אפויה; לא שולח אם שום דבר גיאומטרי לא השתנה. */
function onGeometry({ force = false } = {}) {
  if (scene.baked) return;
  const key = geometryKey(scene);
  if (!force && key === lastGeomKey) return;
  lastGeomKey = key;
  sampler.request();
}

// טעינת סצנה אפויה היא אסינכרונית (קובץ baked/*.tzb). רק הבקשה האחרונה מוחלת.
let bakedToken = 0;
function loadGeometry() {
  if (scene.baked) {
    lastGeomKey = null;
    stats.sampling = 'טוען אפייה...';
    const token = ++bakedToken;
    const baked = scene.baked;
    loadBakedGeometry(baked)
      .then((g) => {
        if (token !== bakedToken || scene.baked !== baked) return;
        stats.sampling = 'אפוי';
        applyGeometry(g);
      })
      .catch((e) => {
        stats.sampling = 'שגיאה';
        gui?.status(`שגיאה בטעינת אפייה: ${e.message}`);
      });
  } else {
    bakedToken++;
    onGeometry({ force: true });
  }
}

// ---------- חי ----------

/** פריסה, יחס ייחוס, תצוגה מקדימה או גודל חלון השתנו: טרנספורמציה חיה בלבד. */
function onTransform() {
  const prevOrientation = stage.orientation;
  stage.updateFrame();
  if (stage.orientation !== prevOrientation) gui?.syncLayout();
  if (transition?.active) {
    transition.onFrame();
    return;
  }
  stage.applyTransform();
}
stage.onResize(onTransform);

// עריכה של הפריסה הפעילה. portrait נגזר הופך לפריסה עצמאית בעריכה הראשונה שלו.
const layoutHooks = {
  state: () => ({
    orientation: stage.orientation,
    derived: stage.orientation === 'portrait' && !scene.layouts.portrait,
    values: stage.activeLayout(),
  }),
  set(key, value) {
    const materialize = stage.orientation === 'portrait' && !scene.layouts.portrait;
    if (materialize) {
      scene.layouts.portrait = Object.fromEntries(LAYOUT_KEYS.map((k) => [k, scene.layouts.landscape[k]]));
    }
    scene.layouts[stage.orientation][key] = value;
    onTransform();
    if (materialize) gui?.syncLayout();
  },
  resetPortrait() {
    if (!scene.layouts.portrait) return 'portrait כבר נגזר מ landscape';
    scene.layouts.portrait = null;
    onTransform();
    gui?.syncLayout();
    return 'portrait חזר להיות נגזר';
  },
  editor,
  onEditor: () => onTransform(),
};

const applyColors = () => stage.applyColors();
const applyPalette = () => stage.applyPalette();
const applyBackground = () => {
  stage.applyBackground();
  stage.updateFrame(); // הכיסוי מחוץ למסגרת המדומה בצבע הרקע
};

// ---------- טעינה, פריסטים, אפייה ----------

// החלת נתונים טעונים על הסצנה החיה, במקום, כדי שהפאנל ימשיך להצביע על אותם אובייקטים
function applyLoaded(kind, data) {
  if (kind === 'scene') {
    assignInPlace(scene, data);
    scene.baked = data.baked ?? null; // assignInPlace לא מחליף אובייקט ב null
  } else {
    assignInPlace(scene[kind], data);
  }
  applyPalette();
  applyBackground();
  if (kind === 'scene') {
    onTransform();
    loadGeometry();
  }
  applyColors();
  gui?.refresh();
}

const sliceOf = (kind) => (kind === 'scene' ? scene : scene[kind]);

const presets = {
  names: presetNames,
  onChange: onPresetsChange,
  async save(kind, rawName) {
    const name = normalizeName(rawName);
    if (!name) throw new Error('שם לא תקין: אותיות, ספרות, _ ו - בלבד');
    if (registry[kind][name] && !confirm(`${KINDS[kind].label} "${name}" כבר קיימת. לדרוס?`)) return 'בוטל';
    if (kind === 'scene') scene.id = name;
    return savePreset(kind, name, sliceOf(kind));
  },
  load(kind, name) {
    const file = registry[kind][name];
    if (!file) throw new Error(`לא נמצא: ${name}`);
    applyLoaded(kind, fromFile(file, kind).data);
    return `נטען ${KINDS[kind].folder}/${name}`;
  },
  exportJSON() {
    const name = normalizeName(scene.id) ?? 'scene';
    downloadJSON(toFile('scene', scene), `${name}.json`);
    return `יוצא ${name}.json`;
  },
  async importJSON() {
    const file = await pickJSONFile();
    if (!file) return '';
    const { kind, data } = fromFile(file, file.type ? undefined : 'scene');
    if (!PANEL_KINDS.includes(kind)) throw new Error(`קובץ ${KINDS[kind].label} נטען מהתיקייה שלו, לא כאן`);
    applyLoaded(kind, data);
    return `יובא קובץ ${KINDS[kind].label}`;
  },
  reset() {
    if (!confirm('לאפס את כל הערכים לברירת המחדל? המצב השמור בדפדפן יימחק.')) return 'בוטל';
    clearLocal();
    applyLoaded('scene', clone(defaultScene));
    return 'אופס לברירת מחדל';
  },
};

const sourceAvailable = () =>
  scene.shape.type === 'image' ? !!shapeFiles[scene.shape.src] : !!scene.shape.d;

const bake = {
  // האפייה נשמרת כקובץ בינארי ב baked/<שם הסצנה>.tzb, והסצנה מפנה אליו.
  // הגיאומטריה מוחלפת בזו שפוענחה מהקובץ, כך שמה שרואים בעורך זהה בדיוק למה שהנגן יטען.
  async bake() {
    if (scene.baked) return 'כבר אפוי';
    if (!stage.geom || sampler.isBusy()) throw new Error('הדגימה עדיין רצה, נסה שוב בעוד רגע');
    const name = normalizeName(scene.id) ?? 'scene';
    if (bakedFiles[`${name}.tzb`] && !confirm(`baked/${name}.tzb כבר קיים. לדרוס?`)) return 'בוטל';
    const bytes = await bakeToBytes(stage.geom);
    const decoded = await bytesToGeometry(bytes);
    const { file, persisted } = await saveBakedFile(name, bytes);
    primeBaked(file, decoded);
    scene.baked = { file, count: decoded.count };
    stats.sampling = 'אפוי';
    applyGeometry(decoded);
    const kb = (bytes.length / 1024).toFixed(1);
    return persisted
      ? `נאפו ${decoded.count} עיגולים אל baked/${file} (${kb}KB)`
      : `נאפו ${decoded.count} עיגולים; הקובץ ${file} ירד (אין שרת פיתוח), יש לשים אותו ב baked/`;
  },
  unbake() {
    if (!scene.baked) return 'לא אפוי';
    if (!sourceAvailable()) throw new Error(`המקור לא זמין (${scene.shape.src || 'path ריק'}), האפייה נשארת`);
    scene.baked = null;
    onGeometry({ force: true });
    return 'חוזר למקור';
  },
};

// ---------- מצב מעבר ----------

transition = createTransitionMode({
  particles,
  renderer,
  rng: stage.rng,
  getFrame: () => ({ view: stage.view, orientation: stage.orientation, width: stage.width, height: stage.height }),
  getCurrent: () => ({ scene, geom: stage.geom }),
  onRebind: () => renderer.rebind(),
  onEnter: () => {
    gui?.setTransitionMode(true);
    overlay.setMarker(transition.focusScreen);
  },
  onExit: () => {
    gui?.setTransitionMode(false);
    overlay.setMarker(null);
    applyPalette();
    applyBackground();
    // חזרה לסצנה הנערכת: התאמה מרחבית מהמצב הנוכחי, בלי קפיצה
    if (stage.geom) stage.applyGeometry(stage.geom);
  },
});

function currentBackground() {
  return transition?.active ? transition.background : scene.palette.background;
}

// תצוגת גלילה במצב מעבר: גלגלת ומשטח מגע מעל הקנבס מזיזים את t (מעל הפאנל הוא נגלל כרגיל)
window.addEventListener('wheel', (e) => {
  if (e.target === canvas && transition.onWheel(e)) e.preventDefault();
}, { passive: false });

// לחיצה קצרה על הקנבס במצב מעבר בוחרת את נקודת המוקד (סדר לפי מרחק, איסוף לנקודה)
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!transition.active || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  if (moved < 6 && performance.now() - downAt.t < 400) {
    transition.setFocus(e.clientX, e.clientY);
    overlay.setMarker(transition.focusScreen);
    gui?.refreshTransition();
  }
  downAt = null;
});

// ייצוא המסגרת שבתצוגה. הגדרות הייצוא שייכות לעורך, לא לסצנה.
const exportOpts = { multiplier: 2, transparent: false };
const exportHooks = {
  opts: exportOpts,
  async png() {
    const m = Number(exportOpts.multiplier);
    const v = stage.view;
    const blob = await framePNG(renderer, v, m, exportOpts.transparent, currentBackground());
    const name = `${normalizeName(scene.id) ?? 'frame'}-${Math.round(v.w * m)}x${Math.round(v.h * m)}.png`;
    downloadBlob(blob, name);
    return `יוצא ${name}`;
  },
  svg() {
    const { svg, count } = frameSVG(particles, renderer.lut, renderer.lut2, stage.view, exportOpts.transparent, currentBackground());
    const name = `${normalizeName(scene.id) ?? 'frame'}.svg`;
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), name);
    return `יוצא ${name} (${count} עיגולים)`;
  },
};

const shapeFileHooks = {
  names: shapeFileNames,
  onChange: onShapeFilesChange,
  async upload(local) {
    const file = await pickFile('.svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp');
    if (!file) return '';
    const base = normalizeFileName(file.name);
    if (!base) throw new Error('שם קובץ לא תקין: אותיות, ספרות, _ ו - בלבד, עם סיומת svg, png, jpg או webp');
    const name = local ? `local/${base}` : base;
    if (shapeFiles[name] && !confirm(`הקובץ ${name} כבר קיים. לדרוס?`)) return '';
    const { persisted } = await uploadShapeFile(file, name);
    scene.shape.type = 'image';
    scene.shape.src = name;
    // לקובץ בלי שקיפות, מסכה לפי בהירות היא ברירת המחדל הסבירה
    if (/\.jpe?g$/.test(name)) scene.shape.image.maskBy = 'luminance';
    onGeometry({ force: true });
    if (!persisted) return `${name} נטען לסשן בלבד (אין שרת פיתוח)`;
    return local ? `נשמר shapes/${name} (לא נכנס לריפו)` : `נשמר shapes/${name}`;
  },
};

const gui = createGui(scene, stats, {
  onGeometry: () => onGeometry(),
  onTransform,
  layout: layoutHooks,
  onColors: applyColors,
  onPalette: applyPalette,
  onBackground: applyBackground,
  presets,
  shapeFiles: shapeFileHooks,
  bake,
  exporter: exportHooks,
  transition,
});

// קובץ צורה שהשתנה בדיסק (HMR) צריך דגימה מחדש אם הוא הצורה הנוכחית
onShapeFilesChange(() => {
  if (scene.shape.type === 'image') onGeometry({ force: true });
});

// שמירה אוטומטית של המצב הנוכחי. האפייה נשמרת כהפניה, בנפרד, ורק כשהיא מתחלפת.
const autosave = () => saveLocal(toFile('scene', { ...scene, baked: null }), scene.baked);
setInterval(autosave, 1000);
window.addEventListener('pagehide', autosave);

stage.updateFrame();
loadGeometry();

// לבדיקות ולדיבאג מהקונסול, רק בזמן פיתוח
if (import.meta.env.DEV) {
  window.__tz = {
    scene, particles, stats, transition, stage,
    physics: stage.physics,
    get geom() { return stage.geom; },
    get geomVersion() { return stage.geomVersion; },
    get view() { return stage.view; },
  };
}

// במצב מעבר, המעבר מספק את פרמטרי הפריים; אחרת הסצנה הנערכת
stage.run((dt) => {
  if (!transition.active) return null;
  const f = transition.frame(dt);
  f.afterMotion = transition.afterMotion;
  return f;
});
