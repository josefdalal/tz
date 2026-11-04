// זמני: התקרבות אקספוננציאלית למטרה, בלי התנגשויות.
// המטרה היא נקודת הבית ועוד היסט התנועה הפנימית. בהמשך שלב 2 יוחלף בקפיץ,
// שיכוך, רשת מרחבית להתנגשויות ו substeps, עם אותה מטרה.

export function relax(p, dt, rate = 6) {
  const k = 1 - Math.exp(-dt * rate);
  const { x, y, homeX, homeY, offX, offY, r, targetR, pulse, drawR } = p;
  for (let i = 0; i < p.capacity; i++) {
    x[i] += (homeX[i] + offX[i] - x[i]) * k;
    y[i] += (homeY[i] + offY[i] - y[i]) * k;
    r[i] += (targetR[i] - r[i]) * k;
    drawR[i] = r[i] * pulse[i];
  }
}
