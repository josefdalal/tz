// הליבה של מעבר בין שתי סצנות, משותפת לעורך (mode.js) ולנגן (player/main.js).
// בלי פאנל, בלי טעינה ובלי worker: מקבלת שני צדדים מוכנים ({ scene, geom }) וסגנון.
//
// המצב הטהור (evaluate.js) נכתב ל homeX, homeY, targetR, colorU, overlayW. הפיזיקה רצה
// במרחב יחסי: בכל פריים העיגול זז בדיוק כמו המטרה שלו (x += Δhome), והקפיץ, ההתנגשויות
// והעכבר פועלים רק על הסטייה ממנה. התנועה הפנימית ושכבת ההתנגשויות מוכפלות ב overlayW,
// שדועך בזמן התעופה וחוזר בנחיתה.

import { gsap } from 'gsap';
import { interpolate, formatHex } from 'culori';
import { computeTransform } from '../scenes/layout.js';
import { safeRect, resolveLayout } from '../scenes/frame.js';
import { buildPaletteLUT } from '../render/palette.js';
import { growParticles } from '../sim/particles.js';
import { sideData, prepareTransition, computeOrder } from './prepare.js';
import { createEnds, resolveEndpoints, makeEvaluator, evaluateAt, lerpInto } from './evaluate.js';

/**
 * @param deps {
 *   particles, renderer, rng,
 *   getFrame: () => ({ view, orientation, width, height }),
 *   onRebind(),              המאגר גדל
 *   onEvaluate?(t),          אחרי כל חישוב של המצב הטהור (בדיקת הפיכות בעורך)
 * }
 */
export function createTransitionRunner(deps) {
  const p = deps.particles;
  let sides = null; // { A, B }: { scene, geom, data, safe, T }
  let style = null;
  let prep = null;
  let ends = null;
  let ev = null;
  let focusScreen = [0, 0];
  let lastT = NaN;
  let dirty = true;
  let shiftNext = true; // false אחרי הכנה מחדש: העיגולים זורמים למקום החדש ולא קופצים
  let prevHomeX = new Float32Array(0);
  let prevHomeY = new Float32Array(0);
  let bgInterp = null;
  let background = '#000000';
  const motionOut = {};
  const physicsOut = {};
  const lutA = new Uint8Array(256 * 4);
  const lutB = new Uint8Array(256 * 4);

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
    dirty = true;
  }

  function evaluate(t) {
    const unit = lerp(sides.A.safe.unit, sides.B.safe.unit, t);
    evaluateAt(t, prep, ends, style, ev, focusScreen, unit, p);
    lastT = t;
    dirty = false;
    deps.onEvaluate?.(t);
  }

  /**
   * שני צדדים וסגנון. style מוחזק בהפניה (העורך משנה אותו במקום וקורא ל restyle).
   * העיגולים מוצבים במצב הטהור של t, בלי מהירות ובלי היסט תנועה.
   */
  function setSides(A, B, st, t) {
    sides = { A, B };
    style = st;
    buildPaletteLUT(A.scene.palette.stops, lutA, 256, A.scene.palette.space);
    buildPaletteLUT(B.scene.palette.stops, lutB, 256, B.scene.palette.space);
    deps.renderer.setPalette(A.scene.palette.stops, A.scene.palette.space);
    deps.renderer.setPalette2(B.scene.palette.stops, B.scene.palette.space);
    bgInterp = interpolate([A.scene.palette.background, B.scene.palette.background], 'oklch');
    layoutSides();
    install();
    evaluate(t);
    for (let s = 0; s < prep.K; s++) {
      p.x[s] = p.homeX[s];
      p.y[s] = p.homeY[s];
      p.vx[s] = p.vy[s] = p.offX[s] = p.offY[s] = 0;
      p.r[s] = p.drawR[s] = p.targetR[s];
    }
    shiftNext = true;
    background = formatHex(bgInterp(t));
  }

  /** לפני התנועה הפנימית: מצב טהור, הזזה יחסית, ופרמטרים מעורבבים. */
  function frame(t) {
    const K = prep.K;
    if (dirty || t !== lastT) {
      prevHomeX.set(p.homeX.subarray(0, K));
      prevHomeY.set(p.homeY.subarray(0, K));
      evaluate(t);
      if (shiftNext) {
        for (let s = 0; s < K; s++) {
          p.x[s] += p.homeX[s] - prevHomeX[s];
          p.y[s] += p.homeY[s] - prevHomeY[s];
        }
      }
      shiftNext = true;
    }
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
      afterMotion,
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

  /** הסגנון השתנה: הכנה מחדש. העיגולים לא קופצים, הם זורמים למצב החדש. */
  function restyle() {
    layoutSides();
    install();
    shiftNext = false;
  }

  /** המסגרת השתנתה (חלון, תצוגה מקדימה): נקודות הקצה מחושבות מחדש. */
  function onFrame() {
    layoutSides();
    const { view } = deps.getFrame();
    resolveEndpoints(prep, sides.A.data, sides.B.data, style, view, ends);
    dirty = true;
  }

  /** יציאה ממצב מעבר: ערוצי הצבע של B מתאפסים, כדי שהסצנה הרגילה תצויר בצבע A בלבד. */
  function release() {
    for (let s = 0; s < p.capacity; s++) {
      p.colorU[s] = 0;
      p.overlayW[s] = 1;
      p.imgMix2[s] = 0;
    }
    deps.renderer.invalidateColors();
  }

  return {
    setSides,
    frame,
    afterMotion,
    restyle,
    onFrame,
    release,
    get ready() { return !!prep; },
    get K() { return prep ? prep.K : 0; },
    get prep() { return prep; },
    get background() { return background; },
    get focusScreen() { return focusScreen; },
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

const parseEase = (name) => {
  try {
    return gsap.parseEase(name);
  } catch {
    return null;
  }
};
