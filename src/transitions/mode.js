// מצב "מעבר" בעורך: שתי סצנות, סרגל t, ניגון, ובדיקת הפיכות.
//
// המצב הטהור (evaluate.js) נכתב ל homeX, homeY, targetR, colorU, overlayW. הפיזיקה רצה
// במרחב יחסי: בכל פריים העיגול זז בדיוק כמו המטרה שלו (x += Δhome), והקפיץ, ההתנגשויות
// והעכבר פועלים רק על הסטייה ממנה. התנועה הפנימית ושכבת ההתנגשויות מוכפלות ב overlayW,
// שדועך בזמן התעופה וחוזר בנחיתה.

import { gsap } from 'gsap';
import { interpolate, formatHex } from 'culori';
import { fromFile, defaultTransitionStyle, defaultScroll } from '../scenes/schema.js';
import { registry, savePreset, normalizeName } from '../scenes/presets.js';
import { unbakeGeometry } from '../scenes/bake.js';
import { computeTransform } from '../scenes/layout.js';
import { safeRect, resolveLayout } from '../scenes/frame.js';
import { sampleOnce } from '../shapes/sampling.js';
import { buildPaletteLUT } from '../render/palette.js';
import { growParticles } from '../sim/particles.js';
import { assignInPlace, clone } from '../util/merge.js';
import { sideData, prepareTransition, computeOrder } from './prepare.js';
import { createEnds, resolveEndpoints, makeEvaluator, evaluateAt, stateChecksum, lerpInto } from './evaluate.js';

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

const parseEase = (name) => {
  try {
    return gsap.parseEase(name);
  } catch {
    return null;
  }
};

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
  const p = deps.particles;
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
  let sides = null; // { A, B }: { scene, geom, data, safe }
  let prep = null;
  let ends = null;
  let ev = null;
  let focusScreen = [0, 0];
  let lastT = NaN;
  let dirty = true;
  let shiftNext = true; // false אחרי הכנה מחדש: העיגולים זורמים למקום החדש ולא קופצים
  let prevHomeX = new Float32Array(0);
  let prevHomeY = new Float32Array(0);
  let dir = 1;
  let bgInterp = null;
  let background = '#000000';
  const motionOut = {};
  const physicsOut = {};
  const lutA = new Uint8Array(256 * 4);
  const lutB = new Uint8Array(256 * 4);
  let seen = new Map(); // t (מעוגל) אל checksum
  let revisits = 0;
  let mismatches = 0;

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
    const geom = scene.baked ? unbakeGeometry(scene.baked) : await sampleOnce(scene);
    return { scene, geom };
  }

  /** טרנספורמציות ונתוני צד במסגרת הנוכחית (כל שינוי מסגרת מחשב אותם מחדש). */
  function layoutSides() {
    const { view, orientation } = deps.getFrame();
    for (const [side, lut] of [[sides.A, lutA], [sides.B, lutB]]) {
      side.safe = safeRect(side.scene.frame, orientation, view);
      side.T = computeTransform(side.geom.meta, resolveLayout(side.scene, orientation), side.safe);
      side.data = sideData(side, lut);
    }
    focusScreen = [view.x0 + style.focus[0] * view.w, view.y0 + style.focus[1] * view.h];
  }

  function install() {
    const { view, width, height } = deps.getFrame();
    prep = prepareTransition(sides.A.data, sides.B.data, style);
    const K = prep.K;
    ends = createEnds(K);
    resolveEndpoints(prep, sides.A.data, sides.B.data, style, view, ends);
    computeOrder(prep, ends, style, focusScreen, sides.A.data);
    ev = makeEvaluator(style, parseEase);
    if (growParticles(p, K, deps.rng, width, height)) deps.onRebind();
    prevHomeX = new Float32Array(K);
    prevHomeY = new Float32Array(K);
    const c = prep.color;
    for (let s = 0; s < K; s++) {
      p.colorT[s] = c.cT[s];
      p.imgMix[s] = c.cMix[s];
      p.colorT2[s] = c.cT2[s];
      p.imgMix2[s] = c.cMix2[s];
      for (let k = 0; k < 3; k++) {
        p.imgColor[s * 3 + k] = c.cImg[s * 3 + k];
        p.imgColor2[s * 3 + k] = c.cImg2[s * 3 + k];
      }
    }
    for (let s = K; s < p.active; s++) p.r[s] = p.targetR[s] = p.drawR[s] = 0;
    p.count = K;
    p.active = K;
    deps.renderer.invalidateColors();
    resetReversibility();
    ui.counts = `${prep.pairsCount} זוגות, ${prep.leftovers} עודפים, ${prep.spawns} חוסרים`;
    dirty = true;
  }

  function resetReversibility() {
    seen = new Map();
    revisits = 0;
    mismatches = 0;
    ui.reversible = '';
  }

  async function enter() {
    ui.status = 'טוען ודוגם...';
    const [A, B] = await Promise.all([loadSide(ui.a), loadSide(ui.b)]);
    sides = { A, B };
    buildPaletteLUT(A.scene.palette.stops, lutA, 256, A.scene.palette.space);
    buildPaletteLUT(B.scene.palette.stops, lutB, 256, B.scene.palette.space);
    deps.renderer.setPalette(A.scene.palette.stops, A.scene.palette.space);
    deps.renderer.setPalette2(B.scene.palette.stops, B.scene.palette.space);
    bgInterp = interpolate([A.scene.palette.background, B.scene.palette.background], 'oklch');
    layoutSides();
    active = true;
    install();
    // כניסה: העיגולים מוצבים במצב הטהור של t הנוכחי
    evaluate();
    for (let s = 0; s < prep.K; s++) {
      p.x[s] = p.homeX[s];
      p.y[s] = p.homeY[s];
      p.vx[s] = p.vy[s] = p.offX[s] = p.offY[s] = 0;
      p.r[s] = p.drawR[s] = p.targetR[s];
    }
    shiftNext = true;
    deps.onEnter();
    ui.status = `מעבר: ${ui.a} אל ${ui.b}`;
    return ui.status;
  }

  function exit() {
    if (!active) return '';
    active = false;
    ui.playing = false;
    for (let s = 0; s < p.capacity; s++) {
      p.colorU[s] = 0;
      p.overlayW[s] = 1;
      p.imgMix2[s] = 0;
    }
    deps.renderer.invalidateColors();
    deps.onExit();
    ui.status = '';
    return 'חזרה לעריכת סצנה';
  }

  function evaluate() {
    const unit = lerp(sides.A.safe.unit, sides.B.safe.unit, ui.t);
    evaluateAt(ui.t, prep, ends, style, ev, focusScreen, unit, p);
    // הפיכות: אותו t חייב לתת בדיוק אותו מצב טהור
    const key = Math.round(ui.t * 10000);
    const sum = stateChecksum(p, prep.K);
    if (seen.has(key)) {
      revisits++;
      if (seen.get(key) !== sum) mismatches++;
      ui.reversible = mismatches
        ? `⚠ ${mismatches} מתוך ${revisits} חזרות לאותו t נתנו מצב שונה`
        : `✓ ${revisits} חזרות לאותו t, כולן זהות`;
    } else {
      seen.set(key, sum);
    }
    lastT = ui.t;
    dirty = false;
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

  /** לפני התנועה הפנימית: ניגון, מצב טהור, הזזה יחסית, ופרמטרים מעורבבים. */
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
    const K = prep.K;
    if (dirty || ui.t !== lastT) {
      prevHomeX.set(p.homeX.subarray(0, K));
      prevHomeY.set(p.homeY.subarray(0, K));
      evaluate();
      if (shiftNext) {
        for (let s = 0; s < K; s++) {
          p.x[s] += p.homeX[s] - prevHomeX[s];
          p.y[s] += p.homeY[s] - prevHomeY[s];
        }
      }
      shiftNext = true;
    }
    const t = ui.t;
    lerpInto(motionOut, sides.A.scene.motion, sides.B.scene.motion, t);
    lerpInto(physicsOut, sides.A.scene.physics, sides.B.scene.physics, t);
    physicsOut.pureRadius = true;
    background = formatHex(bgInterp(t));
    return {
      motion: motionOut,
      physics: physicsOut,
      unit: lerp(sides.A.safe.unit, sides.B.safe.unit, t),
      seed: sides.A.scene.seed,
      background,
    };
  }

  /** אחרי התנועה הפנימית: שכבת העל מוכפלת במשקל, שדועך בזמן תעופה. */
  function afterMotion() {
    const { offX, offY, pulse, overlayW } = p;
    for (let s = 0; s < prep.K; s++) {
      const w = overlayW[s];
      offX[s] *= w;
      offY[s] *= w;
      pulse[s] = 1 + (pulse[s] - 1) * w;
    }
  }

  /** שינוי סגנון: הכנה מחדש. העיגולים לא קופצים, הם זורמים למצב החדש. */
  function onStyle() {
    if (!active) return;
    layoutSides();
    install();
    shiftNext = false;
  }

  /** המסגרת השתנתה (חלון, תצוגה מקדימה): נקודות הקצה מחושבות מחדש. */
  function onFrame() {
    if (!active) return;
    layoutSides();
    const { view } = deps.getFrame();
    resolveEndpoints(prep, sides.A.data, sides.B.data, style, view, ends);
    resetReversibility();
    dirty = true;
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
    get background() { return background; },
    get focusScreen() { return focusScreen; },
    ui,
    style,
    scroll,
    onWheel,
    sceneNames,
    enter,
    exit,
    frame,
    afterMotion,
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

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
