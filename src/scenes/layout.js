// שכבת הפרמטרים החיים: טרנספורמציה של הגיאומטריה המקומית אל המסך, וצבע.
// שום דבר כאן לא מפעיל דגימה.
//
// גיאומטריה (geom): { count, lx, ly, lr, edge, rand, rgb|null,
//                     meta: { bw, bh, s0, rMin, rMax, isImage } }
//   lx, ly, lr במרחב המקומי, ממורכז, בקנה המידה של הדגימה (s0 פיקסלים ליחידת מקור).
//
// טרנספורמציה (frame.js מגדיר את האזור הבטוח ואת unit):
//   world = T(safe.x0 + x*safe.w, safe.y0 + y*safe.h) · R(rotation) · S(f*flipX, f*flipY) · local
//   f = (scale * min(ref.w/bw, ref.h/bh)) / s0 * unit
// local בפיקסלי ייחוס בקנה המידה של הדגימה. שינוי גודל החלון, יחס הייחוס או הפריסה: הכול חי.

const DEG = Math.PI / 180;

/**
 * @param meta   geom.meta (bw, bh, s0)
 * @param layout פריסה פעילה (x, y, rotation, scale, flipX, flipY)
 * @param safe   safeRect מ frame.js (x0, y0, w, h, unit, ref)
 */
export function computeTransform(meta, layout, safe) {
  const S = layout.scale * Math.min(safe.ref.w / meta.bw, safe.ref.h / meta.bh);
  const f = (S / meta.s0) * safe.unit;
  const cos = Math.cos(layout.rotation * DEG);
  const sin = Math.sin(layout.rotation * DEG);
  const sx = f * (layout.flipX ? -1 : 1);
  const sy = f * (layout.flipY ? -1 : 1);
  return {
    a: cos * sx,
    b: sin * sx,
    c: -sin * sy,
    d: cos * sy,
    e: safe.x0 + layout.x * safe.w,
    f: safe.y0 + layout.y * safe.h,
    scale: f,
  };
}

/** בתים ורדיוסי יעד מהמרחב המקומי, לעיגולים שיש להם בית (i < count). */
export function layoutHomes(p, T) {
  const { localX, localY, localR, homeX, homeY, targetR } = p;
  for (let i = 0; i < p.count; i++) {
    const lx = localX[i];
    const ly = localY[i];
    homeX[i] = T.a * lx + T.c * ly + T.e;
    homeY[i] = T.b * lx + T.d * ly + T.f;
    targetR[i] = localR[i] * T.scale;
  }
}

/**
 * מעבר חי בין טרנספורמציות: מזיז את העיגולים עצמם באותה טרנספורמציה יחסית,
 * כך שהצורה זזה כגוף אחד ומיד, והתנועה הפנימית ממשיכה בלי הפרעה.
 */
export function applyTransformDelta(p, from, to) {
  const det = from.a * from.d - from.b * from.c;
  if (!det) return;
  // M = to · from⁻¹
  const ia = from.d / det;
  const ib = -from.b / det;
  const ic = -from.c / det;
  const id = from.a / det;
  const ie = -(ia * from.e + ic * from.f);
  const iff = -(ib * from.e + id * from.f);
  const a = to.a * ia + to.c * ib;
  const b = to.b * ia + to.d * ib;
  const c = to.a * ic + to.c * id;
  const d = to.b * ic + to.d * id;
  const e = to.a * ie + to.c * iff + to.e;
  const f = to.b * ie + to.d * iff + to.f;
  const rs = from.scale ? to.scale / from.scale : 1;
  const { x, y, vx, vy, homeX, homeY, r, targetR } = p;
  for (let i = 0; i < p.active; i++) {
    const px = x[i];
    const py = y[i];
    x[i] = a * px + c * py + e;
    y[i] = b * px + d * py + f;
    // המהירות עוברת רק את החלק הלינארי (סיבוב, קנה מידה, היפוך)
    const ux = vx[i];
    const uy = vy[i];
    vx[i] = a * ux + c * uy;
    vy[i] = b * ux + d * uy;
    const hx = homeX[i];
    const hy = homeY[i];
    homeX[i] = a * hx + c * hy + e;
    homeY[i] = b * hx + d * hy + f;
    r[i] *= rs;
    targetR[i] *= rs;
  }
  layoutHomes(p, to); // בלי הצטברות שגיאות לעיגולים שיש להם בית
}

/** colorT לפי mapBy, במרחב המקומי (הגרדיאנט מסתובב עם הצורה). */
export function layoutColors(p, meta, mapBy) {
  const hw = (meta.bw * meta.s0) / 2 || 1;
  const hh = (meta.bh * meta.s0) / 2 || 1;
  const maxRad = Math.hypot(hw, hh);
  const span = meta.rMax - meta.rMin;
  const { localX, localY, localR, edge, rand, colorT } = p;
  for (let i = 0; i < p.count; i++) {
    let t;
    switch (mapBy) {
      case 'x': t = (localX[i] + hw) / (2 * hw); break;
      case 'radius': t = span > 0 ? (localR[i] - meta.rMin) / span : 0.5; break;
      case 'edge': t = edge[i]; break;
      case 'radial': t = Math.hypot(localX[i], localY[i]) / maxRad; break;
      case 'random': t = rand[i]; break;
      default: t = (localY[i] + hh) / (2 * hh);
    }
    colorT[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
}
