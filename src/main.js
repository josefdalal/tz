import { createParticles, scatter, assignHomes, POOL_SIZE } from './sim/particles.js';
import { relax } from './sim/physics.js';
import { createMotion, updateMotion } from './sim/motion.js';
import { sampleScene } from './shapes/sampler.js';
import { defaultScene, KINDS, toFile, fromFile } from './scenes/schema.js';
import { registry, presetNames, onPresetsChange, savePreset, normalizeName } from './scenes/presets.js';
import { loadLocal, saveLocal, clearLocal, downloadJSON, pickJSONFile } from './scenes/persist.js';
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
const particles = createParticles(POOL_SIZE);
const renderer = createRenderer(canvas, particles);
const stats = { count: 0, sampleMs: 0, fps: 0 };
const motion = createMotion(scene.seed);

let width = window.innerWidth;
let height = window.innerHeight;
renderer.resize(width, height);
scatter(particles, mulberry32(scene.seed + 1), width, height);

let needsResample = true;
const requestResample = () => { needsResample = true; };

function resample() {
  const samples = sampleScene(scene, width, height);
  stats.count = assignHomes(particles, samples);
  stats.sampleMs = Math.round(samples.ms);
}

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
  presets,
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
