// הבמה: המנוע המשותף לעורך (editor.html) ולנגן (index.html).
//
// מחזיקה את מאגר העיגולים, הרינדור, התנועה הפנימית, הפיזיקה, המצביע, המסגרת והפריסה,
// והחלה של גיאומטריה (התאמה מרחבית) ושל פרמטרים חיים. לא יודעת על פאנל, worker,
// פריסטים או שמירה; אלה בעורך.
//
// הסצנה הנוכחית היא stage.scene. העורך משנה אותה במקום; הנגן מחליף אותה ב setScene.

import { createParticles, growParticles, setImageMix, MAX_POOL } from '../sim/particles.js';
import { createPhysics, stepPhysics } from '../sim/physics.js';
import { createMotion, updateMotion } from '../sim/motion.js';
import { retarget } from '../sim/match.js';
import { computeTransform, layoutHomes, applyTransformDelta, layoutColors } from '../scenes/layout.js';
import { orientationOf, safeRect, resolveLayout, containRect } from '../scenes/frame.js';
import { createRenderer } from '../render/renderer.js';
import { mulberry32 } from '../util/rng.js';

/**
 * @param opts {
 *   canvas, scene,
 *   previewAspect?: () => number | null   יחס מדומה בעורך; null = כל החלון
 *   onFrame?: (stage) => void               המסגרת השתנתה (חלון, תצוגה מקדימה)
 *   touchAction?: string                     ברירת מחדל 'none' (המגע דוחף עיגולים)
 * }
 */
export function createStage(opts) {
  const { canvas } = opts;
  const stage = {
    scene: opts.scene,
    width: window.innerWidth,
    height: window.innerHeight,
    view: { x0: 0, y0: 0, w: window.innerWidth, h: window.innerHeight },
    orientation: 'landscape',
    safe: null,
    geom: null, // הגיאומטריה הנוכחית במרחב המקומי
    T: null, // הטרנספורמציה הנוכחית אל המסך
    geomVersion: 0,
    stats: { count: 0, pool: 0, sampling: '', sampleMs: 0, physicsMs: 0, fps: 0 },
  };

  const rng = mulberry32(stage.scene.seed + 1);
  const particles = createParticles();
  growParticles(particles, Math.min(MAX_POOL, stage.scene.maxCount), rng, stage.width, stage.height);
  const renderer = createRenderer(canvas, particles);
  const motion = createMotion(stage.scene.seed);
  const physics = createPhysics();
  renderer.resize(stage.width, stage.height);
  stage.stats.pool = particles.capacity;
  Object.assign(stage, { particles, renderer, motion, physics, rng });

  // ---------- מצביע ----------
  // עכבר או מגע כגוף פיזי, רק מעל הקנבס (מעל פאנל או טקסט הוא לא דוחף).
  // עכבר: פעיל בזמן ריחוף. מגע: פעיל רק בזמן לחיצה.
  canvas.style.touchAction = opts.touchAction ?? 'none';
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
  // הכיוון נקבע לפי היחס של view, ולפיו נבחרת הפריסה.

  stage.updateFrame = () => {
    const aspect = opts.previewAspect?.() ?? null;
    stage.view = aspect ? containRect(aspect, stage.width, stage.height) : { x0: 0, y0: 0, w: stage.width, h: stage.height };
    stage.orientation = orientationOf(stage.view);
    stage.safe = safeRect(stage.scene.frame, stage.orientation, stage.view);
    stage.simulated = !!aspect;
    opts.onFrame?.(stage);
  };
  stage.activeLayout = () => resolveLayout(stage.scene, stage.orientation);

  // ---------- גיאומטריה וחי ----------

  /** גיאומטריה חדשה: התאמה מרחבית מהמצב הנוכחי, בלי קפיצה. */
  stage.applyGeometry = (g) => {
    stage.geom = g;
    stage.geomVersion++;
    const nextT = computeTransform(g.meta, stage.activeLayout(), stage.safe);
    if (retarget(particles, g, nextT, rng, stage.width, stage.height)) renderer.rebind();
    stage.T = nextT;
    layoutHomes(particles, stage.T);
    stage.applyColors();
    stage.stats.count = particles.count;
    stage.stats.pool = particles.capacity;
  };

  /** מסגרת או פריסה השתנו: טרנספורמציה חיה בלבד. */
  stage.applyTransform = () => {
    if (!stage.geom) return;
    const nextT = computeTransform(stage.geom.meta, stage.activeLayout(), stage.safe);
    applyTransformDelta(particles, stage.T, nextT);
    stage.T = nextT;
  };

  stage.applyColors = () => {
    const g = stage.geom;
    if (!g) return;
    layoutColors(particles, g.meta, stage.scene.palette.mapBy);
    setImageMix(particles, g.rgb ? stage.scene.shape.image.colorMix : 0);
    renderer.invalidateColors();
  };

  stage.applyPalette = () => renderer.setPalette(stage.scene.palette.stops, stage.scene.palette.space);
  stage.applyBackground = (color = stage.scene.palette.background) => {
    renderer.setBackground(color);
  };

  /** סצנה אחרת (הנגן): פלטה, רקע ומסגרת שלה. הגיאומטריה מגיעה אחר כך ב applyGeometry. */
  stage.setScene = (scene) => {
    stage.scene = scene;
    stage.updateFrame();
    stage.applyPalette();
    stage.applyBackground();
  };

  // שינוי גודל החלון הוא טרנספורמציה חיה, לא דגימה
  const resizeHooks = [];
  stage.onResize = (fn) => resizeHooks.push(fn);
  window.addEventListener('resize', () => {
    stage.width = window.innerWidth;
    stage.height = window.innerHeight;
    renderer.resize(stage.width, stage.height);
    if (resizeHooks.length) resizeHooks.forEach((fn) => fn());
    else {
      stage.updateFrame();
      stage.applyTransform();
    }
  });

  // ---------- לולאת פריים ----------

  /**
   * מפעיל את הלולאה. override(dt), אם קיים ומחזיר אובייקט, מחליף את פרמטרי הפריים
   * (מעבר: { motion, physics, unit, seed, background, afterMotion }).
   */
  stage.run = (override) => {
    let last = performance.now();
    let lastBackground = '';
    let fpsFrames = 0;
    let fpsTime = 0;
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const f = override?.(dt);
      if (f) {
        updateMotion(motion, particles, f.motion, f.seed, dt, f.unit);
        f.afterMotion?.();
        stepPhysics(physics, particles, f.physics, dt, f.unit, stage.view);
        if (f.background && f.background !== lastBackground) {
          lastBackground = f.background;
          renderer.setBackground(f.background);
        }
      } else {
        lastBackground = '';
        const s = stage.scene;
        updateMotion(motion, particles, s.motion, s.seed, dt, stage.safe.unit);
        stepPhysics(physics, particles, s.physics, dt, stage.safe.unit, stage.view);
      }
      renderer.render();

      fpsFrames++;
      fpsTime += dt;
      if (fpsTime >= 0.5) {
        stage.stats.fps = Math.round(fpsFrames / fpsTime);
        stage.stats.physicsMs = Math.round(physics.ms * 100) / 100;
        fpsFrames = 0;
        fpsTime = 0;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  stage.updateFrame();
  stage.applyPalette();
  stage.applyBackground();
  return stage;
}
