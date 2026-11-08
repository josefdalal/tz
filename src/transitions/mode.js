// מצב "מעבר" בעורך: שתי סצנות, סרגל t, ניגון, גלילה, ובדיקת הפיכות.
// הליבה (מצב טהור, הזזה יחסית, שכבת על) ב runner.js, משותפת עם הנגן.

import { fromFile, defaultTransitionStyle, defaultScroll } from '../scenes/schema.js';
import { registry, savePreset, normalizeName } from '../scenes/presets.js';
import { loadBakedGeometry } from '../scenes/bakedFiles.js';
import { sampleOnce } from '../shapes/sampling.js';
import { assignInPlace, clone } from '../util/merge.js';
import { stateChecksum } from './evaluate.js';
import { createTransitionRunner } from './runner.js';

export const CURRENT = '(נוכחית)';
export const easeOptions = [
  'none', 'power1.in', 'power1.out', 'power1.inOut', 'power2.in', 'power2.out', 'power2.inOut',
  'power3.inOut', 'power4.inOut', 'sine.inOut', 'expo.inOut', 'circ.inOut',
  'back.in', 'back.out', 'back.inOut', 'elastic.out', 'bounce.out', 'steps(8)',
];
export const matchingModes = ['hilbert', 'nearest', 'brightness', 'size', 'random'];
export const pathModes = ['straight', 'arc', 'noise', 'scatter', 'gather'];
export const arcDirections = ['cw', 'ccw', 'alternate', 'random'];
export const orderModes = ['none', 'x', 'y', 'distance', 'radius', 'color', 'random'];
export const leftoverModes = ['shrink', 'exit', 'merge'];
export const spawnModes = ['grow', 'split', 'edges', 'direction'];
export const loopModes = ['none', 'loop', 'pingpong'];

/**
 * @param deps {
 *   particles, renderer, rng,
 *   getFrame: () => ({ view, orientation, width, height }),
 *   getCurrent: () => ({ scene, geom }),   הסצנה הנערכת, לבחירה "(נוכחית)"
 *   onEnter(), onExit(),                    החלפת הפאנל והחזרת הסצנה
 *   onRebind(),                             המאגר גדל
 * }
 */
export function createTransitionMode(deps) {
  const style = clone(defaultTransitionStyle);
  const scroll = clone(defaultScroll); // נשמר בקובץ המעבר, לא בסגנון
  const ui = {
    a: CURRENT, b: CURRENT, t: 0, playing: false, loop: 'pingpong', status: '', reversible: '', counts: '',
    scrollOn: false, // תצוגת גלילה: הגלגלת ומשטח המגע מזיזים את t
    scrollTarget: '',
  };
  let target = 0; // t שהגלילה מכוונת אליו; t עצמו מתקרב אליו בהחלקה
  let lastWheel = 0;
  let lastScrollT = 0; // ה t שהגלילה כתבה; שינוי אחר (גרירת הסרגל) מזיז גם את היעד

  let active = false;
  let dir = 1;
  let seen = new Map(); // t (מעוגל) אל checksum
  let revisits = 0;
  let mismatches = 0;

  const runner = createTransitionRunner({
    particles: deps.particles,
    renderer: deps.renderer,
    rng: deps.rng,
    getFrame: deps.getFrame,
    onRebind: deps.onRebind,
    onEvaluate: checkReversible,
  });

  // הפיכות: אותו t חייב לתת בדיוק אותו מצב טהור
  function checkReversible(t) {
    const key = Math.round(t * 10000);
    const sum = stateChecksum(deps.particles, runner.K);
    if (seen.has(key)) {
      revisits++;
      if (seen.get(key) !== sum) mismatches++;
      ui.reversible = mismatches
        ? `⚠ ${mismatches} מתוך ${revisits} חזרות לאותו t נתנו מצב שונה`
        : `✓ ${revisits} חזרות לאותו t, כולן זהות`;
    } else {
      seen.set(key, sum);
    }
  }

  const sceneNames = () => [CURRENT, ...Object.keys(registry.scene ?? {}).sort((x, y) => x.localeCompare(y))];

  async function loadSide(name) {
    if (name === CURRENT) {
      const { scene, geom } = deps.getCurrent();
      if (!geom) throw new Error('לסצנה הנוכחית עדיין אין גיאומטריה');
      return { scene: clone({ ...scene, baked: null }), geom };
    }
    const file = registry.scene?.[name];
    if (!file) throw new Error(`סצנה לא נמצאה: ${name}`);
    const scene = fromFile(file, 'scene').data;
    // סצנה לא אפויה נדגמת פעם אחת בכניסה למצב
    const geom = scene.baked ? await loadBakedGeometry(scene.baked) : await sampleOnce(scene);
    return { scene, geom };
  }

  function resetReversibility() {
    seen = new Map();
    revisits = 0;
    mismatches = 0;
    ui.reversible = '';
  }

  // מטמון לתצוגה המקדימה של הסטוריבורד: סצנה נטענת או נדגמת פעם אחת, כל עוד הקובץ לא השתנה
  const sideCache = new Map(); // שם אל { file, scene, geom }
  async function loadCached(name) {
    const file = registry.scene?.[name];
    const hit = sideCache.get(name);
    if (hit && hit.file === file) return { scene: hit.scene, geom: hit.geom };
    const side = await loadSide(name);
    sideCache.set(name, { file, ...side });
    return { scene: side.scene, geom: side.geom };
  }
  let shownKey = null; // הזוג והנתונים ש show() התקין, כדי לא להתקין שוב על כל תזוזה של הסרגל

  async function enter() {
    ui.status = 'טוען ודוגם...';
    shownKey = null;
    const [A, B] = await Promise.all([loadSide(ui.a), loadSide(ui.b)]);
    return enterSides(A, B);
  }

  /**
   * תצוגה של זוג סצנות עם נתוני מעבר מלאים (סגנון וגלילה), ב t נתון. משמש את התצוגה
   * המקדימה של הסטוריבורד. אותו זוג ואותם נתונים: רק t מתעדכן.
   */
  async function show(a, b, data, t) {
    ui.playing = false;
    ui.scrollOn = false;
    const key = JSON.stringify([a, b, data]);
    if (active && key === shownKey) {
      ui.t = t;
      return ui.status;
    }
    const { from, to, scroll: sc, ...rest } = data; // from ו to: הצעדים קובעים את הזוג
    assignInPlace(style, rest);
    assignInPlace(scroll, sc);
    ui.a = a;
    ui.b = b;
    ui.t = t;
    ui.status = 'טוען ודוגם...';
    const [A, B] = await Promise.all([loadCached(a), loadCached(b)]);
    const msg = await enterSides(A, B);
    shownKey = key;
    return msg;
  }

  async function enterSides(A, B) {
    resetReversibility();
    runner.setSides(A, B, style, ui.t);
    active = true;
    updateCounts();
    deps.onEnter();
    ui.status = `מעבר: ${ui.a} אל ${ui.b}`;
    return ui.status;
  }

  function updateCounts() {
    const prep = runner.prep;
    ui.counts = `${prep.pairsCount} זוגות, ${prep.leftovers} עודפים, ${prep.spawns} חוסרים`;
  }

  function exit() {
    if (!active) return '';
    active = false;
    shownKey = null;
    ui.playing = false;
    runner.release();
    deps.onExit();
    ui.status = '';
    return 'חזרה לעריכת סצנה';
  }

  /**
   * גלגלת או משטח מגע בתצוגת גלילה. deltaMode: פיקסלים, שורות או עמודים.
   * @returns {boolean} true אם האירוע נצרך (והדף לא צריך לגלול)
   */
  function onWheel(e) {
    if (!active || !ui.scrollOn) return false;
    const { height } = deps.getFrame();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    target = clamp01(target + (e.deltaY * unit) / Math.max(1, scroll.distance));
    lastWheel = performance.now();
    ui.playing = false;
    return true;
  }

  /**
   * החלקה כמו ב Lenis: t מתקרב ליעד בחלק קבוע מהמרחק בכל פריים (מתוקן לקצב הפריימים).
   * כשהגלילה נעצרת ל snapDelay, היעד נצמד ל 0 או ל 1, לפי הקרוב.
   */
  function scrollStep(dt) {
    if (ui.t !== lastScrollT) target = ui.t; // הסרגל נגרר ביד
    if (performance.now() - lastWheel > scroll.snapDelay && target > 0 && target < 1) {
      target = target >= 0.5 ? 1 : 0;
    }
    const s = Math.min(1, Math.max(0.001, scroll.smoothing));
    const k = 1 - Math.pow(1 - s, dt * 60);
    let t = ui.t + (target - ui.t) * k;
    if (Math.abs(target - t) < 1e-4) t = target;
    ui.t = t;
    lastScrollT = t;
    ui.scrollTarget = target === 0 || target === 1 ? `${target} (נצמד)` : target.toFixed(3);
  }

  /** לפני התנועה הפנימית: ניגון או גלילה, ואז הליבה. */
  function frame(dt) {
    if (ui.scrollOn) scrollStep(dt);
    else if (ui.playing) {
      let t = ui.t + (dt / Math.max(0.1, style.duration)) * dir;
      if (t > 1 || t < 0) {
        if (ui.loop === 'loop') t = t > 1 ? t - 1 : t + 1;
        else if (ui.loop === 'pingpong') { dir = -dir; t = t > 1 ? 2 - t : -t; }
        else { t = Math.min(1, Math.max(0, t)); ui.playing = false; }
      }
      ui.t = t;
    }
    return runner.frame(ui.t);
  }

  /** שינוי סגנון: הכנה מחדש. העיגולים לא קופצים, הם זורמים למצב החדש. */
  function onStyle() {
    if (!active) return;
    shownKey = null;
    resetReversibility();
    runner.restyle();
    updateCounts();
  }

  /** המסגרת השתנתה (חלון, תצוגה מקדימה): נקודות הקצה מחושבות מחדש. */
  function onFrame() {
    if (!active) return;
    resetReversibility();
    runner.onFrame();
  }

  function setFocus(x, y) {
    const { view } = deps.getFrame();
    style.focus[0] = Math.min(1, Math.max(0, (x - view.x0) / view.w));
    style.focus[1] = Math.min(1, Math.max(0, (y - view.y0) / view.h));
    onStyle();
  }

  // שמירה וטעינה. מעבר: transitions/<from>__<to>.json. סגנון: בלי from ו to.
  async function save() {
    if (ui.a === CURRENT || ui.b === CURRENT) throw new Error('כדי לשמור מעבר, שתי הסצנות צריכות להיות שמורות (לא "נוכחית")');
    const name = normalizeName(`${ui.a}__${ui.b}`);
    if (!name) throw new Error('שמות הסצנות לא מתאימים לשם קובץ');
    return savePreset('transition', name, { from: ui.a, to: ui.b, scroll: clone(scroll), ...clone(style) });
  }

  async function saveStyle(rawName) {
    const name = normalizeName(rawName);
    if (!name) throw new Error('שם סגנון לא תקין');
    return savePreset('transitionStyle', name, clone(style));
  }

  async function load(name) {
    const file = registry.transition?.[name];
    if (!file) throw new Error(`מעבר לא נמצא: ${name}`);
    const { from, to, scroll: sc, ...rest } = fromFile(file, 'transition').data;
    assignInPlace(style, rest);
    assignInPlace(scroll, sc);
    ui.a = from;
    ui.b = to;
    ui.t = 0;
    await enter();
    return `נטען transitions/${name}`;
  }

  function loadStyle(name) {
    const file = registry.transitionStyle?.[name];
    if (!file) throw new Error(`סגנון לא נמצא: ${name}`);
    assignInPlace(style, fromFile(file, 'transitionStyle').data);
    onStyle();
    return `נטען transition-styles/${name}`;
  }

  return {
    get active() { return active; },
    get background() { return runner.background; },
    get focusScreen() { return runner.focusScreen; },
    ui,
    style,
    scroll,
    onWheel,
    sceneNames,
    enter,
    show,
    exit,
    frame,
    onStyle,
    onFrame,
    setFocus,
    save,
    saveStyle,
    load,
    loadStyle,
    transitionNames: () => Object.keys(registry.transition ?? {}).sort(),
    styleNames: () => Object.keys(registry.transitionStyle ?? {}).sort(),
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
