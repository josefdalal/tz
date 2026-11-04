import { interpolate, converter } from 'culori';

const toRgb = converter('rgb');

// טבלת צבעים (LUT) מאינטרפולציה ב OKLCH. השיידר דוגם אותה לפי colorT.
export function buildPaletteLUT(stops, out, size = 256, space = 'oklch') {
  const f = interpolate(stops.length > 1 ? stops : [stops[0], stops[0]], space);
  for (let i = 0; i < size; i++) {
    const c = toRgb(f(i / (size - 1)));
    out[i * 4 + 0] = Math.round(Math.min(1, Math.max(0, c.r)) * 255);
    out[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, c.g)) * 255);
    out[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, c.b)) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}
