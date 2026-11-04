// שלב 1: התקרבות אקספוננציאלית פשוטה למטרות, רק כדי לראות את הצורה מתארגנת.
// בשלב 2 יוחלף בקפיץ, שיכוך, רשת מרחבית להתנגשויות ו substeps.

export function relax(p, dt, rate = 6) {
  const k = 1 - Math.exp(-dt * rate);
  const { x, y, homeX, homeY, r, targetR } = p;
  for (let i = 0; i < p.capacity; i++) {
    x[i] += (homeX[i] - x[i]) * k;
    y[i] += (homeY[i] - y[i]) * k;
    r[i] += (targetR[i] - r[i]) * k;
  }
}
