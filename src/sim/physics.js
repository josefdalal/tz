// זמני: התקרבות אקספוננציאלית למטרה, בלי התנגשויות.
// המטרה היא נקודת הבית ועוד היסט התנועה הפנימית. בהמשך שלב 2 יוחלף בקפיץ,
// שיכוך, רשת מרחבית להתנגשויות ו substeps, עם אותה מטרה.

export function relax(p, dt, rate = 6) {
  const k = 1 - Math.exp(-dt * rate);
  const { x, y, homeX, homeY, offX, offY, r, targetR, pulse, drawR } = p;
  let lastVisible = -1;
  for (let i = 0; i < p.active; i++) {
    x[i] += (homeX[i] + offX[i] - x[i]) * k;
    y[i] += (homeY[i] + offY[i] - y[i]) * k;
    r[i] += (targetR[i] - r[i]) * k;
    if (i >= p.count && r[i] < 0.01) r[i] = 0;
    else lastVisible = i;
    drawR[i] = r[i] * pulse[i];
  }
  // כשכל העודפים התכווצו לאפס, הלולאות חוזרות לרוץ רק עד count
  p.active = Math.max(p.count, lastVisible + 1);
}
