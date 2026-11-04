import { createParticles, growParticles, assignHomes, setImageMix, MAX_POOL } from './sim/particles.js';
import { relax } from './sim/physics.js';
import { createMotion, updateMotion } from './sim/motion.js';
import { sampleScene } from './shapes/sampler.js';
import { shapeFiles, shapeFileNames, onShapeFilesChange, uploadShapeFile, normalizeFileName, isSvgName } from './shapes/files.js';
import { loadShapeImage } from './shapes/images.js';
import { defaultScene, KINDS, toFile, fromFile } from './scenes/schema.js';
import { registry, presetNames, onPresetsChange, savePreset, normalizeName } from './scenes/presets.js';
import { loadLocal, saveLocal, clearLocal, downloadJSON, pickJSONFile, pickFile } from './scenes/persist.js';
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
const stats = { count: 0, pool: particles.capacity, sampleMs: 0, fps: 0 };
const motion = createMotion(scene.seed);
renderer.resize(width, height);

let needsResample = true;
const requestResample = () => { needsResample = true; };

// דגימה אסינכרונית: קובץ צורה נטען לפני הדגימה. רק הבקשה האחרונה מוחלת.
let resampleToken = 0;
async function resample() {
  const token = ++resampleToken;
  let image = null;
  const sh = scene.shape;
  if (sh.type === 'image') {
    const url = shapeFiles[sh.src];
    if (!url) {
      gui?.status(`קובץ צורה לא נמצא: ${sh.src}`);
    } else {
      try {
        image = await loadShapeImage(url, isSvgName(sh.src));
      } catch (e) {
        gui?.status(`שגיאה בטעינת ${sh.src}: ${e.message}`);
      }
    }
    if (token !== resampleToken) return;
  }
  const samples = sampleScene(scene, width, height, image);
  if (growParticles(particles, samples.count, poolRng, width, height)) renderer.rebind();
  stats.count = assignHomes(particles, samples, sh.image.colorMix);
  stats.pool = particles.capacity;
  stats.sampleMs = Math.round(samples.ms);
  renderer.invalidateColors();
}

const applyImageMix = () => {
  if (scene.shape.type !== 'image') return;
  setImageMix(particles, scene.shape.image.colorMix);
  renderer.invalidateColors();
};

const shapeFileHooks = {
  names: shapeFileNames,
  onChange: onShapeFilesChange,
  async upload() {
    const file = await pickFile('.svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp');
    if (!file) return '';
    const name = normalizeFileName(file.name);
    if (!name) throw new Error('שם קובץ לא תקין: אותיות, ספרות, _ ו - בלבד, עם סיומת svg, png, jpg או webp');
    if (shapeFiles[name] && !confirm(`הקובץ ${name} כבר קיים ב shapes. לדרוס?`)) return '';
    const { persisted } = await uploadShapeFile(file, name);
    scene.shape.type = 'image';
    scene.shape.src = name;
    // לקובץ בלי שקיפות, מסכה לפי בהירות היא ברירת המחדל הסבירה
    if (/\.jpe?g$/.test(name)) scene.shape.image.maskBy = 'luminance';
    requestResample();
    return persisted ? `נשמר shapes/${name}` : `${name} נטען לסשן בלבד (אין שרת פיתוח)`;
  },
};

const applyPalette = () => renderer.setPalette(scene.palette.stops, scene.palette.space);
const applyBackground = () => renderer.setBackground(scene.palette.background);
applyPalette();
applyBackground();

// החלת נתונים טעונים על הסצנה החיה, במקום, כדי שהפאנל ימשיך להצביע על אותם אובייקטים
function applyLoaded(kind, data) {
  if (kind === 'scene') assignInPlace(scene, data);
  else assignInPlace(scene[kind], data);
  if (kind !== 'motion') {
    applyPalette();
    applyBackground();
    requestResample();
  }
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

const gui = createGui(scene, stats, {
  onResample: requestResample,
  onPalette: applyPalette,
  onBackground: applyBackground,
  onImageMix: applyImageMix,
  presets,
  shapeFiles: shapeFileHooks,
});

// קובץ צורה שהשתנה בדיסק (HMR) צריך דגימה מחדש אם הוא הצורה הנוכחית
onShapeFilesChange(() => {
  if (scene.shape.type === 'image') requestResample();
});

// שמירה אוטומטית של המצב הנוכחי, רק כשהפאנל פעיל (גולשים רואים תמיד את הסצנה שנבנתה)
if (guiEnabled) {
  const autosave = () => saveLocal(toFile('scene', scene));
  setInterval(autosave, 1000);
  window.addEventListener('pagehide', autosave);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.resize(width, height);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(requestResample, 150);
});

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (needsResample) {
    needsResample = false;
    resample();
  }

  updateMotion(motion, particles, scene.motion, scene.seed, dt);
  relax(particles, dt);
  renderer.render();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    stats.fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
