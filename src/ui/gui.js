import GUI from 'lil-gui';
import { shapes } from '../shapes/library.js';
import { sizeModes, mapByModes, KINDS } from '../scenes/schema.js';
import { POOL_SIZE } from '../sim/particles.js';

export const guiEnabled = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');

const MAX_STOPS = 6;
const shapeNameOf = (d) => Object.keys(shapes).find((k) => shapes[k] === d) ?? '';

/**
 * פאנל שליטה. מופיע רק במצב פיתוח או עם ?debug.
 * hooks.onResample: שינוי שמחייב דגימה מחדש. hooks.onPalette: צבעים בלבד.
 * hooks.presets: save(kind, name), load(kind, name), names(kind), onChange(fn),
 *                exportJSON(), importJSON(), reset()
 * מחזיר { refresh, status } או null כשהפאנל כבוי.
 */
export function createGui(scene, stats, hooks) {
  if (!guiEnabled) return null;
  const { onResample, onPalette, onBackground, presets } = hooks;

  const gui = new GUI({ title: 'tz' });
  gui.domElement.setAttribute('dir', 'ltr'); // ה CSS של lil-gui מניח LTR; הדף עצמו RTL
  const ui = { shape: shapeNameOf(scene.shape.d), name: scene.id ?? '', status: '' };

  const info = gui.addFolder('מידע');
  info.add(stats, 'count').name('עיגולים').listen().disable();
  info.add(stats, 'sampleMs').name('דגימה ms').listen().disable();
  info.add(stats, 'fps').name('fps').listen().disable();

  // פריסטים
  const fPresets = gui.addFolder('פריסטים');
  fPresets.add(ui, 'status').name('מצב').listen().disable();
  const nameCtrl = fPresets.add(ui, 'name').name('שם');
  const run = async (fn) => {
    try {
      ui.status = (await fn()) ?? '';
    } catch (e) {
      ui.status = `שגיאה: ${e.message}`;
      console.error(e);
    }
  };
  for (const kind of Object.keys(KINDS)) {
    fPresets.add({ go: () => run(() => presets.save(kind, ui.name)) }, 'go').name(`שמור ${KINDS[kind].label}`);
  }
  const loadUi = { scene: '', palette: '', motion: '' };
  const loadCtrls = {};
  const optionsFor = (kind) => ({ '': '', ...Object.fromEntries(presets.names(kind).map((n) => [n, n])) });
  for (const kind of Object.keys(KINDS)) {
    loadCtrls[kind] = fPresets
      .add(loadUi, kind, optionsFor(kind))
      .name(`טען ${KINDS[kind].label}`)
      .onChange((name) => {
        if (!name) return;
        run(() => presets.load(kind, name));
        ui.name = name;
        nameCtrl.updateDisplay();
        // חוזרים לריק כדי שאפשר יהיה לטעון שוב את אותו פריסט אחרי שינויים
        loadUi[kind] = '';
        loadCtrls[kind].updateDisplay();
      });
  }
  presets.onChange(() => {
    for (const kind of Object.keys(KINDS)) loadCtrls[kind].options(optionsFor(kind));
  });
  fPresets.add({ go: () => run(presets.exportJSON) }, 'go').name('ייצוא JSON');
  fPresets.add({ go: () => run(presets.importJSON) }, 'go').name('ייבוא JSON');
  fPresets.add({ go: () => run(presets.reset) }, 'go').name('איפוס לברירת מחדל');

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
  fPalette.addColor(scene.palette, 'background').name('רקע').onChange(onBackground);
  const fStops = fPalette.addFolder('עצירות');
  const stopActions = {
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
  function buildStops() {
    for (const c of [...fStops.controllers]) c.destroy();
    scene.palette.stops.forEach((_, i) => {
      fStops.addColor(scene.palette.stops, i).name(`${i + 1}`).onChange(onPalette);
    });
    fStops.add(stopActions, 'add').name('הוסף עצירה');
    fStops.add(stopActions, 'remove').name('הסר עצירה');
  }
  buildStops();

  /** אחרי טעינה: מסנכרן את הפאנל עם הערכים החדשים באובייקט scene. */
  function refresh() {
    ui.shape = shapeNameOf(scene.shape.d);
    buildStops();
    for (const c of gui.controllersRecursive()) c.updateDisplay();
  }

  return {
    refresh,
    status: (s) => { ui.status = s; },
  };
}
