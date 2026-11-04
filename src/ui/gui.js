import GUI from 'lil-gui';
import { shapes } from '../shapes/library.js';
import { sizeModes, mapByModes } from '../scenes/schema.js';
import { POOL_SIZE } from '../sim/particles.js';

export const guiEnabled = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');

const MAX_STOPS = 6;

/**
 * פאנל שליטה. מופיע רק במצב פיתוח או עם ?debug.
 * onResample: שינוי שמחייב דגימה מחדש. onPalette: שינוי צבעים בלבד.
 */
export function createGui(scene, stats, { onResample, onPalette, onBackground }) {
  if (!guiEnabled) return null;

  const gui = new GUI({ title: 'tz' });
  gui.domElement.setAttribute('dir', 'ltr'); // ה CSS של lil-gui מניח LTR; הדף עצמו RTL
  const ui = { shape: Object.keys(shapes).find((k) => shapes[k] === scene.shape.d) ?? 'square' };

  const info = gui.addFolder('מידע');
  info.add(stats, 'count').name('עיגולים').listen().disable();
  info.add(stats, 'sampleMs').name('דגימה ms').listen().disable();
  info.add(stats, 'fps').name('fps').listen().disable();

  const fShape = gui.addFolder('צורה');
  fShape.add(ui, 'shape', Object.keys(shapes)).name('צורה').onChange((name) => {
    scene.shape.d = shapes[name];
    onResample();
  });
  fShape.add(scene.shape, 'scale', 0.1, 1, 0.01).name('קנה מידה').onChange(onResample);
  fShape.add(scene, 'seed', 0, 9999, 1).name('seed').listen().onChange(onResample);
  fShape.add({ reseed: () => { scene.seed = Math.floor(Math.random() * 10000); onResample(); } }, 'reseed').name('seed חדש');
  fShape.add(scene, 'maxCount', 100, POOL_SIZE, 100).name('מקסימום עיגולים').onChange(onResample);

  const fRadius = gui.addFolder('רדיוס');
  const cMin = fRadius.add(scene.radius, 'min', 0.5, 30, 0.1).name('מינימום');
  const cMax = fRadius.add(scene.radius, 'max', 0.5, 60, 0.1).name('מקסימום');
  cMin.onChange((v) => { if (v > scene.radius.max) { scene.radius.max = v; cMax.updateDisplay(); } onResample(); });
  cMax.onChange((v) => { if (v < scene.radius.min) { scene.radius.min = v; cMin.updateDisplay(); } onResample(); });
  fRadius.add(scene.radius, 'sizeMode', sizeModes).name('מצב גודל').onChange(onResample);
  fRadius.add(scene.radius, 'gap', 0, 6, 0.1).name('מרווח').onChange(onResample);
  fRadius.add(scene.radius, 'noiseScale', 0.001, 0.03, 0.0005).name('סקאלת noise').onChange(onResample);

  const m = scene.motion;
  const fMotion = gui.addFolder('תנועה');
  fMotion.add(m, 'speed', 0, 4, 0.01).name('מהירות כללית');
  const fPulse = fMotion.addFolder('פעימה');
  fPulse.add(m.pulse, 'amount', 0, 50, 0.5).name('עוצמה %');
  fPulse.add(m.pulse, 'speed', 0, 4, 0.01).name('מהירות');
  const fWander = fMotion.addFolder('נדידה');
  fWander.add(m.wander, 'range', 0, 40, 0.1).name('טווח px');
  fWander.add(m.wander, 'speed', 0, 3, 0.01).name('מהירות');
  const fCoh = fMotion.addFolder('קוהרנטיות');
  fCoh.add(m, 'coherence', 0, 1, 0.01).name('קוהרנטיות');
  fCoh.add(m, 'fieldScale', 0.0005, 0.03, 0.0005).name('סקאלת שדה');

  const fPalette = gui.addFolder('ספקטרום');
  fPalette.add(scene.palette, 'mapBy', mapByModes).name('מיפוי לפי').onChange(onResample);
  fPalette.addColor(scene.render, 'background').name('רקע').onChange(onBackground);
  const fStops = fPalette.addFolder('עצירות');
  const buildStops = () => {
    for (const c of [...fStops.controllers]) c.destroy();
    scene.palette.stops.forEach((_, i) => {
      fStops.addColor(scene.palette.stops, i).name(`${i + 1}`).onChange(onPalette);
    });
    fStops.add(actions, 'add').name('הוסף עצירה');
    fStops.add(actions, 'remove').name('הסר עצירה');
  };
  const actions = {
    add: () => {
      const s = scene.palette.stops;
      if (s.length >= MAX_STOPS) return;
      s.push(s[s.length - 1]);
      buildStops();
      onPalette();
    },
    remove: () => {
      const s = scene.palette.stops;
      if (s.length <= 2) return;
      s.pop();
      buildStops();
      onPalette();
    },
  };
  buildStops();

  return gui;
}
