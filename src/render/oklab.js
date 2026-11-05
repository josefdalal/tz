// sRGB <-> OKLab ואינטרפולציה ב OKLCH. זהה לפונקציות בשיידר (renderer.js),
// כדי שייצוא SVG וצבעים שמחושבים ב CPU ייראו כמו הרינדור.
// צבעים כמערכים [r, g, b] בין 0 ל 1.

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function toOklab([r, g, b]) {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const l = Math.cbrt(Math.max(0, 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B));
  const m = Math.cbrt(Math.max(0, 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B));
  const s = Math.cbrt(Math.max(0, 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B));
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp01(toSrgb(clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))),
    clamp01(toSrgb(clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))),
    clamp01(toSrgb(clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))),
  ];
}

export function mixOklch(a, b, u) {
  if (u <= 0) return a;
  if (u >= 1) return b;
  const la = toOklab(a);
  const lb = toOklab(b);
  const ca = Math.hypot(la[1], la[2]);
  const cb = Math.hypot(lb[1], lb[2]);
  let ha = Math.atan2(la[2], la[1]);
  let hb = Math.atan2(lb[2], lb[1]);
  if (ca < 0.002) ha = hb;
  if (cb < 0.002) hb = ha;
  let dh = hb - ha;
  dh = ((((dh + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const h = ha + dh * u;
  const c = ca + (cb - ca) * u;
  return fromOklab([la[0] + (lb[0] - la[0]) * u, c * Math.cos(h), c * Math.sin(h)]);
}

/** צבע מטבלת פלטה (Uint8 RGBA) לפי t, בדגימה לינארית כמו LinearFilter. */
export function sampleLut(lut, t) {
  const n = lut.length / 4;
  const x = clamp01(t) * (n - 1);
  const i0 = Math.floor(x);
  const i1 = Math.min(n - 1, i0 + 1);
  const f = x - i0;
  return [0, 1, 2].map((k) => (lut[i0 * 4 + k] * (1 - f) + lut[i1 * 4 + k] * f) / 255);
}
