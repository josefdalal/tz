// חיבור המערכות. שני מסלולים נפרדים:
//   גיאומטריה: פרמטר דגימה השתנה, נשלחת בקשה ל worker (debounce). התוצאה (במרחב המקומי)
//              מוחלפת עם התאמה מרחבית (match.js): העיגולים זורמים לבתים קרובים.
//   חי:        טרנספורמציה, צבע, תנועה, רקע. מחושבים מהגיאומטריה הקיימת, בלי דגימה.
// סצנה אפויה (scene.baked) משמשת כגיאומטריה במקום ה worker.

import { createParticles, growParticles, setImageMix, MAX_POOL } from './sim/particles.js';
import { createPhysics, stepPhysics } from './sim/physics.js';
import { framePNG, frameSVG } from './render/export.js';
import { createMotion, updateMotion } from './sim/motion.js';
import { retarget } from './sim/match.js';
import { createSampler } from './shapes/sampling.js';
import { shapeFiles, shapeFileNames, onShapeFilesChange, uploadShapeFile, normalizeFileName } from './shapes/files.js';
import { defaultScene, KINDS, toFile, fromFile, geometryKey } from './scenes/schema.js';
import { computeTransform, layoutHomes, applyTransformDelta, layoutColors } from './scenes/layout.js';
import { orientationOf, safeRect, resolveLayout, containRect, previewOptions, LAYOUT_KEYS } from './scenes/frame.js';
import { createFrameOverlay } from './ui/frameOverlay.js';
import { createTransitionMode } from './transitions/mode.js';
import { bakeGeometry, unbakeGeometry } from './scenes/bake.js';
import { registry, presetNames, onPresetsChange, savePreset, normalizeName } from './scenes/presets.js';
import { loadLocal, saveLocal, clearLocal, downloadJSON, downloadBlob, pickJSONFile, pickFile } from './scenes/persist.js';
import { createRenderer } from './render/renderer.js';
import { createGui, guiEnabled } from './ui/gui.js';
import { assignInPlace, clone } from './util/merge.js';
import { mulberry32 } from './util/rng.js';

// מצב התחלתי: בפאנל, המצב האחרון מ localStorage; אחרת ברירת המחדל
function initialScene() {
  if (guiEnabled) {
    const saved = loadLocal();
    if (saved) {
      try {
        return fromFile(saved, 'scene').data;
      } catch (e) {
        console.warn('[tz] מצב שמור לא תקין, נטענת ברירת מחדל', e);
      }
    }
  }
  return clone(defaultScene);
}

const canvas = document.getElementById('stage');
const scene = initialScene();
let width = window.innerWidth;
let height = window.innerHeight;
const poolRng = mulberry32(scene.seed + 1);
const particles = createParticles();
growParticles(particles, Math.min(MAX_POOL, scene.maxCount), poolRng, width, height);
const renderer = createRenderer(canvas, particles);
const stats = { count: 0, pool: particles.capacity, sampling: '', sampleMs: 0, physicsMs: 0, fps: 0 };
const motion = createMotion(scene.seed);
const physics = createPhysics();
renderer.resize(width, height);

// מצביע (עכבר או מגע) כגוף פיזי. רק מעל הקנבס: מעל הפאנל הוא לא דוחף.
// עכבר: פעיל בזמן ריחוף. מגע: פעיל רק בזמן לחיצה. touch-action none כדי שהגרירה לא תגלול;
// בשלב הסטוריבורד (גלילה) זה ייבחן מחדש.
canvas.style.touchAction = 'none';
const pointer = physics.pointer;
const onPointer = (e) => {
  const overCanvas = e.target === canvas;
  if (e.pointerType === 'touch') {
    pointer.active = overCanvas && e.type !== 'pointerup' && (e.type === 'pointerdown' || pointer.active);
  } else {
    pointer.active = overCanvas;
  }
  pointer.x = e.clientX;
  pointer.y = e.clientY;
};
for (const type of ['pointermove', 'pointerdown', 'pointerup']) window.addEventListener(type, onPointer, { passive: true });
for (const type of ['pointercancel', 'pointerleave', 'blur']) {
  window.addEventListener(type, () => { pointer.active = false; }, { passive: true });
}
document.documentElement.addEventListener('pointerleave', () => { pointer.active = false; });

// ---------- מסגרת ופריסה ----------
// view: המסגרת שבה הסצנה מוצגת. בדרך כלל כל החלון; בעורך אפשר לדמות יחס אחר.
// הכיוון (landscape או portrait) נקבע לפי היחס של view, ולפיו נבחרת הפריסה.

const editor = { preview: 'חלון', showSafe: true };
let view = { x0: 0, y0: 0, w: width, h: height };
let orientation = 'landscape';
let safe = null;

function updateFrame() {
  const aspect = previewOptions[editor.preview];
  view = aspect ? containRect(aspect, width, height) : { x0: 0, y0: 0, w: width, h: height };
  orientation = orientationOf(view);
  safe = safeRect(scene.frame, orientation, view);
  overlay?.update(view, safe, {
    width,
    height,
    showSafe: editor.showSafe,
    simulated: !!aspect,
    background: scene.palette.background,
    text: `${orientation}${orientation === 'portrait' && !scene.layouts.portrait ? ' (נגזר)' : ''} · ייחוס ${scene.frame.reference}`,
  });
}

const activeLayout = () => resolveLayout(scene, orientation);
const overlay = guiEnabled ? createFrameOverlay() : null;
updateFrame();

// ---------- גיאומטריה ----------

let geom = null; // הגיאומטריה הנוכחית במרחב המקומי
let T = null; // הטרנספורמציה הנוכחית אל המסך
let lastGeomKey = null;
let geomVersion = 0;

function applyGeometry(g) {
  geom = g;
  geomVersion++;
  if (transition?.active) return; // במצב מעבר הגיאומטריה נשמרת, ותוחל ביציאה ממנו
  const nextT = computeTransform(g.meta, activeLayout(), safe);
  if (retarget(particles, g, nextT, poolRng, width, height)) renderer.rebind();
  T = nextT;
  layoutHomes(particles, T);
  applyColors();
  stats.count = particles.count;
  stats.pool = particles.capacity;
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

function loadGeometry() {
  if (scene.baked) {
    lastGeomKey = null;
    stats.sampling = 'אפוי';
    applyGeometry(unbakeGeometry(scene.baked));
  } else {
    onGeometry({ force: true });
  }
}

// ---------- חי ----------

/** פריסה, יחס ייחוס, תצוגה מקדימה או גודל חלון השתנו: טרנספורמציה חיה בלבד. */
function onTransform() {
  const prevOrientation = orientation;
  updateFrame();
  if (orientation !== prevOrientation) gui?.syncLayout();
  if (transition?.active) {
    transition.onFrame();
    return;
  }
  if (!geom) return;
  const nextT = computeTransform(geom.meta, activeLayout(), safe);
  applyTransformDelta(particles, T, nextT);
  T = nextT;
}

// עריכה של הפריסה הפעילה. portrait נגזר הופך לפריסה עצמאית בעריכה הראשונה שלו.
const layoutHooks = {
  state: () => ({ orientation, derived: orientation === 'portrait' && !scene.layouts.portrait, values: activeLayout() }),
  set(key, value) {
    const materialize = orientation === 'portrait' && !scene.layouts.portrait;
    if (materialize) {
      scene.layouts.portrait = Object.fromEntries(LAYOUT_KEYS.map((k) => [k, scene.layouts.landscape[k]]));
    }
    scene.layouts[orientation][key] = value;
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

function applyColors() {
  if (!geom) return;
  layoutColors(particles, geom.meta, scene.palette.mapBy);
  setImageMix(particles, geom.rgb ? scene.shape.image.colorMix : 0);
  renderer.invalidateColors();
}

const applyPalette = () => renderer.setPalette(scene.palette.stops, scene.palette.space);
const applyBackground = () => {
  renderer.setBackground(scene.palette.background);
  updateFrame(); // הכיסוי מחוץ למסגרת המדומה בצבע הרקע
};
applyPalette();
applyBackground();

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
  bake() {
    if (scene.baked) return 'כבר אפוי';
    if (!geom || sampler.isBusy()) throw new Error('הדגימה עדיין רצה, נסה שוב בעוד רגע');
    scene.baked = bakeGeometry(geom);
    stats.sampling = 'אפוי';
    return `נאפו ${geom.count} עיגולים`;
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

const transition = createTransitionMode({
  particles,
  renderer,
  rng: poolRng,
  getFrame: () => ({ view, orientation, width, height }),
  getCurrent: () => ({ scene, geom }),
  onRebind: () => renderer.rebind(),
  onEnter: () => {
    lastBackground = '';
    gui?.setTransitionMode(true);
    overlay?.setMarker(transition.focusScreen);
  },
  onExit: () => {
    gui?.setTransitionMode(false);
    overlay?.setMarker(null);
    applyPalette();
    applyBackground();
    // חזרה לסצנה הנערכת: התאמה מרחבית מהמצב הנוכחי, בלי קפיצה
    if (geom) applyGeometry(geom);
  },
});

const currentBackground = () => (transition.active ? transition.background : scene.palette.background);

// לחיצה קצרה על הקנבס במצב מעבר בוחרת את נקודת המוקד (סדר לפי מרחק, איסוף לנקודה)
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!transition.active || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  if (moved < 6 && performance.now() - downAt.t < 400) {
    transition.setFocus(e.clientX, e.clientY);
    overlay?.setMarker(transition.focusScreen);
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
    const blob = await framePNG(renderer, view, m, exportOpts.transparent, currentBackground());
    const name = `${normalizeName(scene.id) ?? 'frame'}-${Math.round(view.w * m)}x${Math.round(view.h * m)}.png`;
    downloadBlob(blob, name);
    return `יוצא ${name}`;
  },
  svg() {
    const { svg, count } = frameSVG(particles, renderer.lut, renderer.lut2, view, exportOpts.transparent, currentBackground());
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

// שמירה אוטומטית של המצב הנוכחי, רק כשהפאנל פעיל (גולשים רואים תמיד את הסצנה שנבנתה).
// האפייה נשמרת בנפרד ורק כשהיא מתחלפת.
if (guiEnabled) {
  const autosave = () => saveLocal(toFile('scene', { ...scene, baked: null }), scene.baked);
  setInterval(autosave, 1000);
  window.addEventListener('pagehide', autosave);
}

// שינוי גודל החלון הוא טרנספורמציה חיה, לא דגימה
window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.resize(width, height);
  onTransform();
});

loadGeometry();

// לבדיקות ולדיבאג מהקונסול, רק בזמן פיתוח
if (import.meta.env.DEV) {
  window.__tz = {
    scene, particles, stats, physics, transition,
    get geom() { return geom; },
    get geomVersion() { return geomVersion; },
    get view() { return view; },
  };
}

// ---------- לולאת פריים ----------

let last = performance.now();
let lastBackground = '';
let fpsFrames = 0;
let fpsTime = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (transition.active) {
    const f = transition.frame(dt);
    updateMotion(motion, particles, f.motion, f.seed, dt, f.unit);
    transition.afterMotion();
    stepPhysics(physics, particles, f.physics, dt, f.unit, view);
    if (f.background !== lastBackground) {
      lastBackground = f.background;
      renderer.setBackground(f.background);
    }
  } else {
    updateMotion(motion, particles, scene.motion, scene.seed, dt, safe.unit);
    stepPhysics(physics, particles, scene.physics, dt, safe.unit, view);
  }
  renderer.render();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    stats.fps = Math.round(fpsFrames / fpsTime);
    stats.physicsMs = Math.round(physics.ms * 100) / 100;
    fpsFrames = 0;
    fpsTime = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
