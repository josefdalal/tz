// מאגר עיגולים קבוע לכל האתר. כל המצב במערכי Float32Array, בלי אובייקטים לכל עיגול.

export const POOL_SIZE = 6000;

export function createParticles(capacity = POOL_SIZE) {
  const f = () => new Float32Array(capacity);
  return {
    capacity,
    x: f(),
    y: f(),
    vx: f(),
    vy: f(),
    homeX: f(),
    homeY: f(),
    r: f(),
    targetR: f(),
    colorT: f(),
    phase: f(),
  };
}

// מצב התחלתי: פיזור אקראי על המסך, רדיוס אפס, פאזה אישית
export function scatter(p, rng, width, height) {
  for (let i = 0; i < p.capacity; i++) {
    p.x[i] = p.homeX[i] = rng() * width;
    p.y[i] = p.homeY[i] = rng() * height;
    p.vx[i] = p.vy[i] = 0;
    p.r[i] = p.targetR[i] = 0;
    p.phase[i] = rng() * Math.PI * 2;
  }
}

// מקצה נקודות בית מתוצאת הדגימה. עיגולים עודפים מקבלים רדיוס יעד אפס ונעלמים במקום.
export function assignHomes(p, samples) {
  const n = Math.min(samples.count, p.capacity);
  for (let i = 0; i < n; i++) {
    p.homeX[i] = samples.x[i];
    p.homeY[i] = samples.y[i];
    p.targetR[i] = samples.r[i];
    p.colorT[i] = samples.colorT[i];
  }
  for (let i = n; i < p.capacity; i++) p.targetR[i] = 0;
  return n;
}
