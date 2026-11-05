// תנועה פנימית: נדידה סביב נקודת הבית ופעימה של הרדיוס.
//
// כל עיגול מקבל שני מקורות תנועה:
//   אישי:  noise בנקודה ייחודית לעיגול (נגזרת מהפאזה שלו), כך שאין קשר בין שכנים.
//   משותף: שדה noise לפי מיקום הבית, כך ששכנים זזים יחד.
// coherence מערבב ביניהם (0 אישי, 1 משותף), עם נרמול כדי שהעוצמה לא תצנח באמצע.
//
// השעונים נצברים (clock += dt * speed) ולא מחושבים כ t * speed,
// כך ששינוי מהירות בפאנל לא גורם לקפיצה.

import { createNoise2D, createNoise3D } from 'simplex-noise';
import { mulberry32 } from '../util/rng.js';

const TAU = Math.PI * 2;

export function createMotion(seed) {
  const m = { seed: -1, noise2D: null, noise3D: null, wanderClock: 0, pulseClock: 0 };
  reseedMotion(m, seed);
  return m;
}

function reseedMotion(m, seed) {
  m.seed = seed;
  m.noise3D = createNoise3D(mulberry32(seed ^ 0x51ed270b));
  m.noise2D = createNoise2D(mulberry32(seed ^ 0x2545f491));
}

/**
 * כותב לתוך p.offX, p.offY (היסט בפיקסלים מנקודת הבית) ו p.pulse (מכפיל רדיוס).
 * @param {object} cfg scene.motion
 * @param {number} unit פיקסלי מסך לפיקסל ייחוס (frame.js): טווח הנדידה והשדה המשותף
 *                      מוגדרים בפיקסלי ייחוס, כך שהתנועה נראית אותו דבר בכל גודל מסך
 */
export function updateMotion(m, p, cfg, seed, dt, unit = 1) {
  if (seed !== m.seed) reseedMotion(m, seed);

  const speed = cfg.speed;
  m.wanderClock += dt * speed * cfg.wander.speed;
  m.pulseClock += dt * speed * cfg.pulse.speed;

  const c = Math.min(1, Math.max(0, cfg.coherence));
  const wi = 1 - c;
  const norm = 1 / Math.sqrt(wi * wi + c * c); // שני noise בלתי תלויים: שומר על סטיית התקן
  const range = cfg.wander.range * unit;
  const amount = cfg.pulse.amount / 100;
  const s = cfg.fieldScale / (unit || 1);
  const tw = m.wanderClock;
  const tp = m.pulseClock * TAU;
  const n3 = m.noise3D;
  const n2 = m.noise2D;
  const useIndiv = c < 1;
  const useField = c > 0;

  const { homeX, homeY, phase, offX, offY, pulse } = p;
  for (let i = 0; i < p.active; i++) {
    const ph = phase[i];
    let wx = 0;
    let wy = 0;
    let pulsePhase = ph;

    if (useIndiv) {
      const ix = ph * 13.7;
      const iy = ph * 29.3;
      wx += wi * n3(ix, iy, tw);
      wy += wi * n3(ix + 71.3, iy - 47.9, tw);
    }
    if (useField) {
      const fx = homeX[i] * s;
      const fy = homeY[i] * s;
      wx += c * n3(fx, fy, tw);
      wy += c * n3(fx + 113.1, fy - 89.7, tw);
      // פאזת פעימה מהשדה: גלים שעוברים על פני הצורה
      const fieldPhase = n2(fx * 0.5, fy * 0.5) * TAU;
      pulsePhase = ph + (fieldPhase - ph) * c;
    }

    offX[i] = wx * norm * range;
    offY[i] = wy * norm * range;
    pulse[i] = 1 + amount * Math.sin(tp + pulsePhase);
  }
}
