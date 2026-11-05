// אפייה: הגיאומטריה האחרונה נשמרת בתוך הסצנה כטבלת עיגולים במרחב המקומי.
//
// scene.baked = {
//   meta:   { bw, bh, s0, rMin, rMax, isImage },
//   fields: ["x", "y", "r", "edge", "rand", "rgb"],
//   circles: [[x, y, r, edge, rand, "#rrggbb" | null], ...]
// }
// הפורמט מתאר את עצמו (fields), כך שאפשר להוסיף שדות לכל עיגול בעתיד (למשל id, נעילה,
// צבע ידני) בלי לשבור קבצים קיימים, ולערוך עיגול בודד לפי האינדקס שלו.

export const BAKED_FIELDS = ['x', 'y', 'r', 'edge', 'rand', 'rgb'];

const round = (v, n) => Math.round(v * n) / n;
const hex2 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

export function bakeGeometry(geom) {
  const circles = new Array(geom.count);
  for (let i = 0; i < geom.count; i++) {
    const rgb = geom.rgb
      ? `#${hex2(geom.rgb[i * 3])}${hex2(geom.rgb[i * 3 + 1])}${hex2(geom.rgb[i * 3 + 2])}`
      : null;
    circles[i] = [
      round(geom.lx[i], 100),
      round(geom.ly[i], 100),
      round(geom.lr[i], 100),
      round(geom.edge[i], 1000),
      round(geom.rand[i], 1000),
      rgb,
    ];
  }
  return { meta: { ...geom.meta }, fields: [...BAKED_FIELDS], circles };
}

export function unbakeGeometry(baked) {
  const fields = baked.fields ?? BAKED_FIELDS;
  const col = (name) => fields.indexOf(name);
  const ix = col('x');
  const iy = col('y');
  const ir = col('r');
  const ie = col('edge');
  const ia = col('rand');
  const ic = col('rgb');
  const n = baked.circles.length;
  const lx = new Float32Array(n);
  const ly = new Float32Array(n);
  const lr = new Float32Array(n);
  const edge = new Float32Array(n);
  const rand = new Float32Array(n);
  const hasRgb = ic >= 0 && baked.circles.some((c) => typeof c[ic] === 'string');
  const rgb = hasRgb ? new Float32Array(n * 3) : null;
  for (let i = 0; i < n; i++) {
    const c = baked.circles[i];
    lx[i] = c[ix];
    ly[i] = c[iy];
    lr[i] = c[ir];
    edge[i] = ie >= 0 ? c[ie] : 0;
    rand[i] = ia >= 0 ? c[ia] : (i * 0.618034) % 1;
    if (rgb && typeof c[ic] === 'string') {
      const h = c[ic];
      rgb[i * 3] = parseInt(h.slice(1, 3), 16) / 255;
      rgb[i * 3 + 1] = parseInt(h.slice(3, 5), 16) / 255;
      rgb[i * 3 + 2] = parseInt(h.slice(5, 7), 16) / 255;
    }
  }
  return { count: n, lx, ly, lr, edge, rand, rgb, meta: { ...baked.meta } };
}
