// קריאה של הפורמט הישן של אפייה (JSON בתוך הסצנה), כדי שסצנות שנאפו לפני הפורמט הבינארי
// (bakedFormat.js) ימשיכו להיטען. tools/convert-baked.mjs ממיר אותן. אפייה חדשה נכתבת
// תמיד ל baked/*.tzb.
//
// הפורמט הישן:
// scene.baked = {
//   meta:   { bw, bh, s0, rMin, rMax, isImage },
//   fields: ["x", "y", "r", "edge", "rand", "rgb"],
//   circles: [[x, y, r, edge, rand, "#rrggbb" | null], ...]
// }

export const BAKED_FIELDS = ['x', 'y', 'r', 'edge', 'rand', 'rgb'];

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
