import GUI from 'lil-gui';
import { shapes } from '../shapes/library.js';
import { sizeModes, mapByModes, maskByModes, KINDS, PANEL_KINDS } from '../scenes/schema.js';
import { MAX_POOL } from '../sim/particles.js';
import { referenceOptions, previewOptions } from '../scenes/frame.js';
import {
  easeOptions, matchingModes, pathModes, arcDirections, orderModes,
} from '../transitions/mode.js';

const MAX_STOPS = 6;

// סימון קבוצות: ירוק חי (בלי חישוב), כתום דגימה (מחשב ב worker), אפור נעול (אפוי)
// lil-gui מזריק את ה CSS שלו אחרי שלנו, ולכן הסלקטורים כאן ספציפיים יותר
const CSS = `
.lil-gui.lil-root .lil-gui.tz-live > .lil-title { box-shadow: inset 4px 0 0 #3ecf8e; }
.lil-gui.lil-root .lil-gui.tz-geo > .lil-title { box-shadow: inset 4px 0 0 #f5a623; }
.lil-gui.lil-root .lil-gui.tz-geo.tz-locked > .lil-title { box-shadow: inset 4px 0 0 #666; opacity: 0.7; }
.lil-gui .tz-tag { font-size: 0.85em; opacity: 0.8; padding-left: 0.5em; }
.lil-gui .tz-live .tz-tag { color: #3ecf8e; }
.lil-gui .tz-geo .tz-tag { color: #f5a623; }
.lil-gui .tz-geo.tz-locked .tz-tag { color: #999; }
.lil-gui .tz-legend { padding: 4px var(--padding); font-size: 0.9em; line-height: 1.6; color: var(--text-color); }
.lil-gui .tz-legend i { display: inline-block; width: 10px; height: 10px; margin-inline-end: 4px; vertical-align: -1px; }
`;

function tagFolder(folder, kind) {
  folder.domElement.classList.add(kind === 'live' ? 'tz-live' : 'tz-geo');
  const tag = document.createElement('span');
  tag.className = 'tz-tag';
  tag.textContent = kind === 'live' ? '· חי' : '· דגימה';
  folder.$title.appendChild(tag);
  return folder;
}

/**
 * פאנל השליטה של העורך (editor.html). הנגן (index.html) לא טוען אותו.
 * hooks.onGeometry:  פרמטר גיאומטריה השתנה (דגימה ב worker, עם debounce)
 * hooks.onTransform: יחס ייחוס השתנה (חי)
 * hooks.layout: state(), set(key, value), resetPortrait(), editor, onEditor (חי)
 * hooks.onColors:    mapBy, צבע מהתמונה (חי)
 * hooks.onPalette, hooks.onBackground (חי)
 * hooks.presets, hooks.shapeFiles { names, onChange, upload(local) }, hooks.bake { bake, unbake }
 * מחזיר { refresh, status } או null כשהפאנל כבוי.
 */
export function createGui(scene, stats, hooks) {
  const { onGeometry, onTransform, layout, onColors, onPalette, onBackground, presets, shapeFiles, bake, exporter } = hooks;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const shapeUiValue = () =>
    scene.shape.type === 'image'
      ? `file:${scene.shape.src}`
      : Object.keys(shapes).find((k) => shapes[k] === scene.shape.d) ?? '';

  const gui = new GUI({ title: 'tz' });
  gui.domElement.setAttribute('dir', 'ltr'); // ה CSS של lil-gui מניח LTR; הדף עצמו RTL
  const ui = { shape: shapeUiValue(), name: scene.id ?? '', status: '' };

  const legend = document.createElement('div');
  legend.className = 'tz-legend';
  legend.innerHTML =
    '<i style="background:#3ecf8e"></i>חי: מתעדכן מיד, בלי חישוב<br>' +
    '<i style="background:#f5a623"></i>דגימה: מחשב מחדש ברקע<br>' +
    '<i style="background:#666"></i>נעול: הגיאומטריה אפויה';
  gui.$children.prepend(legend);

  const info = gui.addFolder('מידע');
  info.add(stats, 'count').name('עיגולים').listen().disable();
  info.add(stats, 'pool').name('מאגר').listen().disable();
  info.add(stats, 'sampling').name('דגימה').listen().disable();
  info.add(stats, 'sampleMs').name('דגימה ms').listen().disable();
  info.add(stats, 'physicsMs').name('פיזיקה ms').listen().disable();
  info.add(stats, 'fps').name('fps').listen().disable();

  const run = async (fn) => {
    try {
      ui.status = (await fn()) ?? '';
    } catch (e) {
      ui.status = `שגיאה: ${e.message}`;
      console.error(e);
    }
  };

  // פריסטים
  const fPresets = gui.addFolder('פריסטים');
  fPresets.add(ui, 'status').name('מצב').listen().disable();
  const nameCtrl = fPresets.add(ui, 'name').name('שם');
  for (const kind of PANEL_KINDS) {
    fPresets.add({ go: () => run(() => presets.save(kind, ui.name)) }, 'go').name(`שמור ${KINDS[kind].label}`);
  }
  const loadUi = { scene: '', palette: '', motion: '' };
  const loadCtrls = {};
  const optionsFor = (kind) => ({ '': '', ...Object.fromEntries(presets.names(kind).map((n) => [n, n])) });
  for (const kind of PANEL_KINDS) {
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
    for (const kind of PANEL_KINDS) loadCtrls[kind].options(optionsFor(kind));
  });
  fPresets.add({ go: () => run(presets.exportJSON) }, 'go').name('ייצוא JSON');
  fPresets.add({ go: () => run(presets.importJSON) }, 'go').name('ייבוא JSON');
  fPresets.add({ go: () => run(presets.reset) }, 'go').name('איפוס לברירת מחדל');

  // אפייה
  const bakeUi = { state: '' };
  const fBake = gui.addFolder('אפייה');
  fBake.add(bakeUi, 'state').name('גיאומטריה').listen().disable();
  fBake.add(ui, 'status').name('מצב').listen().disable();
  const bakeBtn = fBake.add({ go: () => run(async () => { const m = await bake.bake(ui.name); syncLock(); return m; }) }, 'go').name('אפייה');
  const unbakeBtn = fBake.add({ go: () => run(async () => { const m = await bake.unbake(); syncLock(); return m; }) }, 'go').name('ביטול אפייה');

  // מקור (דגימה)
  const sh = scene.shape;
  const fSource = tagFolder(gui.addFolder('מקור'), 'geo');
  // ערכי הרשימה: שם צורה מהספרייה, או file:<שם קובץ> מהתיקייה shapes
  const shapeOptions = () => ({
    ...Object.fromEntries(Object.keys(shapes).map((k) => [k, k])),
    ...Object.fromEntries(shapeFiles.names().map((n) => [n, `file:${n}`])),
  });
  const shapeCtrl = fSource.add(ui, 'shape', shapeOptions()).name('צורה').onChange((v) => {
    if (!v) return;
    if (v.startsWith('file:')) {
      sh.type = 'image';
      sh.src = v.slice(5);
    } else {
      sh.type = 'svgPath';
      sh.d = shapes[v];
    }
    syncImageFolder();
    onGeometry();
  });
  shapeFiles.onChange(() => shapeCtrl.options(shapeOptions()));
  const upload = (local) => run(async () => {
    const msg = await shapeFiles.upload(local);
    if (msg) refresh();
    return msg;
  });
  fSource.add({ go: () => upload(false) }, 'go').name('העלאה ל shapes');
  fSource.add({ go: () => upload(true) }, 'go').name('העלאה ל shapes/local (ניסיון)');
  fSource.add(scene, 'seed', 0, 9999, 1).name('seed').onChange(onGeometry);
  fSource.add({ go: () => { scene.seed = Math.floor(Math.random() * 10000); refreshAll(); onGeometry(); } }, 'go').name('seed חדש');
  fSource.add(scene, 'maxCount', 100, MAX_POOL, 100).name('מקסימום עיגולים').onChange(onGeometry);

  const im = sh.image;
  const fImage = fSource.addFolder('תמונה');
  fImage.add(im, 'maskBy', maskByModes).name('מסכה לפי').onChange(onGeometry);
  fImage.add(im, 'threshold', 0, 1, 0.01).name('סף').onChange(onGeometry);
  fImage.add(im, 'invert').name('היפוך מסכה').onChange(onGeometry);
  fImage.add(im, 'sizeAmount', 0, 1, 0.01).name('בהירות קובעת רדיוס').onChange(onGeometry);
  fImage.add(im, 'sizeInvert').name('היפוך: בהיר גדול').onChange(onGeometry);

  // רדיוס (דגימה)
  const fRadius = tagFolder(gui.addFolder('רדיוס'), 'geo');
  const cMin = fRadius.add(scene.radius, 'min', 0.5, 30, 0.1).name('מינימום');
  const cMax = fRadius.add(scene.radius, 'max', 0.5, 60, 0.1).name('מקסימום');
  cMin.onChange((v) => { if (v > scene.radius.max) { scene.radius.max = v; cMax.updateDisplay(); } onGeometry(); });
  cMax.onChange((v) => { if (v < scene.radius.min) { scene.radius.min = v; cMin.updateDisplay(); } onGeometry(); });
  fRadius.add(scene.radius, 'sizeMode', sizeModes).name('מצב גודל').onChange(onGeometry);
  fRadius.add(scene.radius, 'gap', 0, 6, 0.1).name('מרווח').onChange(onGeometry);
  fRadius.add(scene.radius, 'noiseScale', 0.001, 0.03, 0.0005).name('סקאלת noise').onChange(onGeometry);

  // מסגרת (חי): יחס ייחוס, ותצוגה מקדימה של יחסי מסך (הגדרת עורך, לא חלק מהסצנה)
  const fFrame = tagFolder(gui.addFolder('מסגרת'), 'live');
  fFrame.add(scene.frame, 'reference', referenceOptions).name('יחס ייחוס').onChange(onTransform);
  fFrame.add(layout.editor, 'preview', Object.keys(previewOptions)).name('תצוגה מקדימה').onChange(layout.onEditor);
  fFrame.add(layout.editor, 'showSafe').name('אזור בטוח').onChange(layout.onEditor);

  // פריסה (חי): עורכים את הפריסה הפעילה, לפי הכיוון של התצוגה
  const fLayout = tagFolder(gui.addFolder('פריסה'), 'live');
  const layoutUi = { active: '', x: 0.5, y: 0.5, rotation: 0, scale: 0.6, flipX: false, flipY: false };
  fLayout.add(layoutUi, 'active').name('פריסה פעילה').disable();
  const setL = (k) => (v) => layout.set(k, v);
  fLayout.add(layoutUi, 'x', -0.5, 1.5, 0.001).name('מיקום x').onChange(setL('x'));
  fLayout.add(layoutUi, 'y', -0.5, 1.5, 0.001).name('מיקום y').onChange(setL('y'));
  fLayout.add(layoutUi, 'rotation', -180, 180, 0.5).name('סיבוב').onChange(setL('rotation'));
  fLayout.add(layoutUi, 'scale', 0.05, 2, 0.01).name('קנה מידה').onChange(setL('scale'));
  fLayout.add(layoutUi, 'flipX').name('היפוך אופקי').onChange(setL('flipX'));
  fLayout.add(layoutUi, 'flipY').name('היפוך אנכי').onChange(setL('flipY'));
  const resetPortraitBtn = fLayout
    .add({ go: () => run(async () => { const m = layout.resetPortrait(); syncLayout(); return m; }) }, 'go')
    .name('portrait: חזרה לנגזר');

  function syncLayout() {
    const s = layout.state();
    layoutUi.active = s.orientation === 'portrait' ? (s.derived ? 'portrait (נגזר מ landscape)' : 'portrait') : 'landscape';
    for (const k of Object.keys(s.values)) if (k in layoutUi) layoutUi[k] = s.values[k];
    resetPortraitBtn.enable(s.orientation === 'portrait' && !s.derived);
    for (const c of fLayout.controllers) c.updateDisplay();
  }
  syncLayout();

  // ספקטרום (חי)
  const fPalette = tagFolder(gui.addFolder('ספקטרום'), 'live');
  fPalette.add(scene.palette, 'mapBy', mapByModes).name('מיפוי לפי').onChange(onColors);
  fPalette.add(im, 'colorMix', 0, 1, 0.01).name('צבע מהתמונה').onChange(onColors);
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

  // תנועה (חי)
  const m = scene.motion;
  const fMotion = tagFolder(gui.addFolder('תנועה'), 'live');
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

  // פיזיקה (חי)
  const ph = scene.physics;
  const fPhysics = tagFolder(gui.addFolder('פיזיקה'), 'live');
  fPhysics.add(ph.spring, 'frequency', 0.2, 8, 0.05).name('קפיץ: תדר Hz');
  fPhysics.add(ph.spring, 'damping', 0.05, 2, 0.01).name('שיכוך (1 בלי קפיצה)');
  fPhysics.add(ph, 'substeps', 1, 8, 1).name('substeps');
  const fCol = fPhysics.addFolder('התנגשויות');
  fCol.add(ph.collisions, 'enabled').name('פעיל');
  fCol.add(ph.collisions, 'strength', 0, 1, 0.01).name('עוצמה');
  fCol.add(ph.collisions, 'iterations', 1, 8, 1).name('איטרציות');
  fCol.add(ph.collisions, 'radius', { 'רדיוס בסיס': 'base', 'רדיוס פועם': 'pulsed' }).name('לפי');
  const fMouse = fPhysics.addFolder('עכבר ומגע');
  fMouse.add(ph.mouse, 'enabled').name('פעיל');
  fMouse.add(ph.mouse, 'radius', 0, 400, 1).name('רדיוס (ייחוס)');
  fMouse.add(ph.mouse, 'strength', 0, 1, 0.01).name('עוצמה');

  // ייצוא של המסגרת שבתצוגה (הגדרות עורך, לא חלק מהסצנה)
  const fExport = gui.addFolder('ייצוא');
  fExport.add(exporter.opts, 'multiplier', { '1x': 1, '2x': 2, '3x': 3, '4x': 4 }).name('רזולוציה');
  fExport.add(exporter.opts, 'transparent').name('רקע שקוף');
  fExport.add({ go: () => run(exporter.png) }, 'go').name('ייצוא PNG');
  fExport.add({ go: () => run(exporter.svg) }, 'go').name('ייצוא SVG');

  // ---------- מעבר ----------
  const tr = hooks.transition;
  const ts = tr.style;
  const fTr = gui.addFolder('מעבר');
  fTr.domElement.classList.add('tz-live');
  const opts = (names) => Object.fromEntries(names.map((n) => [n, n]));
  const aCtrl = fTr.add(tr.ui, 'a', opts(tr.sceneNames())).name('סצנה A');
  const bCtrl = fTr.add(tr.ui, 'b', opts(tr.sceneNames())).name('סצנה B');
  const enterBtn = fTr.add({ go: () => run(() => (tr.active ? tr.exit() : tr.enter())) }, 'go').name('כניסה למצב מעבר');
  fTr.add(tr.ui, 'status').name('מצב').listen().disable();
  fTr.add(tr.ui, 'counts').name('זוגות ועודפים').listen().disable();
  fTr.add(tr.ui, 't', 0, 1, 0.001).name('t').listen();
  const playBtn = fTr.add({ go: () => {
    tr.ui.playing = !tr.ui.playing;
    if (tr.ui.playing) tr.ui.scrollOn = false; // ניגון וגלילה לא פועלים יחד
    playBtn.name(tr.ui.playing ? 'עצירה' : 'ניגון');
    refreshTransition();
  } }, 'go').name('ניגון');
  fTr.add(ts, 'duration', 0.2, 20, 0.1).name('משך s');
  fTr.add(tr.ui, 'loop', { 'בלי': 'none', 'לולאה': 'loop', 'הלוך וחזור': 'pingpong' }).name('לולאה');
  fTr.add(tr.ui, 'reversible').name('הפיכות').listen().disable();
  const restyle = () => tr.onStyle();

  // תצוגת גלילה: הגלגלת מעל הקנבס מזיזה את t. הפרמטרים נשמרים בקובץ המעבר (לנגן).
  const fScroll = fTr.addFolder('גלילה');
  fScroll.add(tr.ui, 'scrollOn').name('גלילה').onChange((on) => {
    if (on) {
      tr.ui.playing = false;
      playBtn.name('ניגון');
    }
  });
  fScroll.add(tr.scroll, 'distance', 100, 6000, 10).name('גלילה למעבר שלם px');
  fScroll.add(tr.scroll, 'smoothing', 0.01, 1, 0.01).name('החלקה (קטן = חלק)');
  fScroll.add(tr.scroll, 'snapDelay', 0, 2000, 10).name('השהיה לנצמדות ms');
  fScroll.add(tr.ui, 'scrollTarget').name('יעד').listen().disable();

  const fMatch = fTr.addFolder('התאמה');
  fMatch.add(ts.matching, 'mode', matchingModes).name('שיטה').onChange(restyle);
  fMatch.add(ts.matching, 'seed', 0, 9999, 1).name('seed').onChange(restyle);

  const fPath = fTr.addFolder('מסלול');
  fPath.add(ts.path, 'mode', pathModes).name('סוג').onChange(restyle);
  fPath.add(ts.path, 'curvature', -1.5, 1.5, 0.01).name('קשת: עקמומיות').onChange(restyle);
  fPath.add(ts.path, 'direction', arcDirections).name('קשת: כיוון').onChange(restyle);
  fPath.add(ts.path, 'noiseAmount', 0, 600, 1).name('noise: עוצמה').onChange(restyle);
  fPath.add(ts.path, 'noiseScale', 0.0005, 0.02, 0.0005).name('noise: סקאלה').onChange(restyle);
  fPath.add(ts.path, 'spread', 0, 1200, 1).name('התפזרות: רדיוס').onChange(restyle);
  fPath.add(ts.path, 'gatherShrink', 0, 1, 0.01).name('איסוף: קנה רדיוס').onChange(restyle);

  const fOrder = fTr.addFolder('סדר');
  fOrder.add(ts.order, 'mode', orderModes).name('סדר לפי').onChange(restyle);
  fOrder.add(ts.order, 'stagger', 0, 0.95, 0.01).name('stagger').onChange(restyle);
  fOrder.add(ts.order, 'reverse').name('היפוך כיוון').onChange(restyle);
  fOrder.add(ts.order, 'seed', 0, 9999, 1).name('seed').onChange(restyle);
  const focusUi = { text: '' };
  const focusCtrl = fOrder.add(focusUi, 'text').name('נקודה (לחיצה על המסך)').disable();

  const fEnds = fTr.addFolder('עודפים וחוסרים');
  fEnds.add(ts.leftovers, 'mode', { 'התכווצות במקום': 'shrink', 'יציאה מהמסך': 'exit', 'מיזוג לקרוב ב B': 'merge' }).name('עודפים ב A').onChange(restyle);
  fEnds.add(ts.leftovers, 'angle', -180, 180, 1).name('כיוון יציאה').onChange(restyle);
  fEnds.add(ts.spawns, 'mode', {
    'צמיחה במקום': 'grow', 'פיצול מהקרוב ב A': 'split', 'כניסה מהקצוות': 'edges', 'כניסה מכיוון': 'direction',
  }).name('חוסרים ב B').onChange(restyle);
  fEnds.add(ts.spawns, 'angle', -180, 180, 1).name('כיוון כניסה').onChange(restyle);

  const fEase = fTr.addFolder('easing ושכבת על');
  fEase.add(ts, 'ease', easeOptions).name('easing (GSAP)').onChange(restyle);
  fEase.add(ts.overlay, 'dip', 0, 1, 0.01).name('דעיכה בתעופה').onChange(restyle);
  fEase.add(ts.overlay, 'sharpness', 0.1, 6, 0.05).name('חדות הדעיכה').onChange(restyle);

  const fTrSave = fTr.addFolder('שמירה');
  const trUi = { styleName: '', load: '', loadStyle: '' };
  fTrSave.add({ go: () => run(tr.save) }, 'go').name('שמור מעבר (A__B)');
  fTrSave.add(trUi, 'styleName').name('שם סגנון');
  fTrSave.add({ go: () => run(() => tr.saveStyle(trUi.styleName)) }, 'go').name('שמור סגנון');
  const loadTrCtrl = fTrSave.add(trUi, 'load', { '': '', ...opts(tr.transitionNames()) }).name('טען מעבר').onChange((n) => {
    if (!n) return;
    run(async () => { const m = await tr.load(n); refreshTransition(); return m; });
    trUi.load = '';
  });
  const loadStyleCtrl = fTrSave.add(trUi, 'loadStyle', { '': '', ...opts(tr.styleNames()) }).name('טען סגנון').onChange((n) => {
    if (!n) return;
    run(() => { const m = tr.loadStyle(n); refreshTransition(); return m; });
    trUi.loadStyle = '';
  });
  presets.onChange(() => {
    aCtrl.options(opts(tr.sceneNames()));
    bCtrl.options(opts(tr.sceneNames()));
    loadTrCtrl.options({ '': '', ...opts(tr.transitionNames()) });
    loadStyleCtrl.options({ '': '', ...opts(tr.styleNames()) });
  });

  function refreshTransition() {
    focusUi.text = `${ts.focus[0].toFixed(2)}, ${ts.focus[1].toFixed(2)}`;
    for (const c of fTr.controllersRecursive()) c.updateDisplay();
  }
  refreshTransition();

  // במצב מעבר רק המעבר, המידע והייצוא פתוחים; עריכת הסצנה מוסתרת עד היציאה
  const sceneFolders = [];
  function setTransitionMode(on) {
    for (const f of sceneFolders) f.show(!on);
    enterBtn.name(on ? 'יציאה ממצב מעבר' : 'כניסה למצב מעבר');
    aCtrl.enable(!on);
    bCtrl.enable(!on);
    if (!on) {
      tr.ui.playing = false;
      playBtn.name('ניגון');
    }
    refreshTransition();
  }

  const geoFolders = [fSource, fRadius];

  function syncImageFolder() {
    fImage.show(sh.type === 'image');
  }

  /** אפייה נועלת את כל פרמטרי הגיאומטריה בפאנל */
  function syncLock() {
    const locked = !!scene.baked;
    for (const f of geoFolders) {
      f.domElement.classList.toggle('tz-locked', locked);
      for (const c of f.controllersRecursive()) c.enable(!locked);
    }
    const b = scene.baked;
    bakeUi.state = locked
      ? b.file
        ? `אפויה: baked/${b.file} (${b.count} עיגולים)`
        : `אפויה בפורמט הישן (${b.circles.length} עיגולים)`
      : 'חיה מהמקור';
    bakeBtn.enable(!locked);
    unbakeBtn.enable(locked);
  }

  function refreshAll() {
    for (const c of gui.controllersRecursive()) c.updateDisplay();
  }

  /** אחרי טעינה: מסנכרן את הפאנל עם הערכים החדשים באובייקט scene. */
  function refresh() {
    ui.shape = shapeUiValue();
    syncImageFolder();
    buildStops();
    syncLock();
    syncLayout();
    refreshAll();
  }
  syncImageFolder();
  syncLock();
  sceneFolders.push(fPresets, fBake, fSource, fRadius, fFrame, fLayout, fPalette, fMotion, fPhysics);

  // כל התיקיות מתחילות סגורות, כולל תתי תיקיות. הפאנל עצמו פתוח, כדי שהכותרות ייראו.
  for (const f of gui.foldersRecursive()) f.close();

  return {
    root: gui,
    refresh,
    syncLayout,
    setTransitionMode,
    refreshTransition,
    status: (s) => { ui.status = s; },
  };
}
