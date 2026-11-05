// ייצוא המסגרת: PNG בכפולת רזולוציה (רקע שקוף אופציונלי), ו SVG של העיגולים.
// שניהם מצלמים את המצב הנוכחי, כולל פעימה ותנועה, של המסגרת שבתצוגה (view).

import { sampleLut, mixOklch } from './oklab.js';

const hex2 = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
const r2 = (v) => Math.round(v * 100) / 100;

/** @returns {Promise<Blob>} */
export function framePNG(renderer, view, multiplier, transparent, background) {
  const { w, h, pixels } = renderer.capture(view, multiplier, transparent, background);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('יצירת PNG נכשלה'))), 'image/png'),
  );
}

/**
 * SVG: כל עיגול נראה שנוגע במסגרת הוא circle עם fill. הצבע מחושב כמו בשיידר:
 * צבע הספקטרום לפי colorT, מעורבב עם צבע התמונה לפי imgMix; במעבר, צבע A וצבע B
 * מעורבבים ב OKLCH לפי colorU.
 * @returns {{svg: string, count: number}}
 */
export function frameSVG(p, lut, lut2, view, transparent, background) {
  const parts = [];
  let count = 0;
  const side = (table, tt, img, mix, i) => {
    const pal = sampleLut(table, tt);
    return [0, 1, 2].map((k) => pal[k] + (img[i * 3 + k] - pal[k]) * mix);
  };
  for (let i = 0; i < p.active; i++) {
    const r = p.drawR[i];
    if (r < 0.01) continue;
    const cx = p.x[i] - view.x0;
    const cy = p.y[i] - view.y0;
    if (cx + r < 0 || cy + r < 0 || cx - r > view.w || cy - r > view.h) continue;
    let col = side(lut, p.colorT[i], p.imgColor, p.imgMix[i], i);
    const u = p.colorU[i];
    if (u > 0) col = mixOklch(col, side(lut2, p.colorT2[i], p.imgColor2, p.imgMix2[i], i), u);
    parts.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" fill="#${hex2(col[0] * 255)}${hex2(col[1] * 255)}${hex2(col[2] * 255)}"/>`);
    count++;
  }
  const w = r2(view.w);
  const h = r2(view.h);
  const bg = transparent ? '' : `<rect width="100%" height="100%" fill="${background}"/>\n`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    bg +
    parts.join('\n') +
    '\n</svg>\n';
  return { svg, count };
}
