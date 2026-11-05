// ציור מקור הצורה לקנבס, בתוך ה thread הראשי (צריך DOM: SVG getBBox, Image).
// הפיקסלים נשלחים ל worker, שעושה את העבודה הכבדה (מסכה, EDT, Poisson).
//
// המרחב המקומי: תיבת המקור מוכפלת ב s0 (פיקסלים לכל יחידת מקור בזמן הדגימה),
// בלי סיבוב, היפוך או מיקום. אלה מוחלים חי ב layout.js.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const MASK_MAX = 1200; // רזולוציית מסכה מרבית בצלע הארוכה
export const PAD = 2;

let bboxSvg = null;
let bboxPath = null;

export function pathBBox(d) {
  if (!bboxSvg) {
    bboxSvg = document.createElementNS(SVG_NS, 'svg');
    bboxSvg.setAttribute('width', '0');
    bboxSvg.setAttribute('height', '0');
    bboxSvg.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    bboxPath = document.createElementNS(SVG_NS, 'path');
    bboxSvg.appendChild(bboxPath);
    document.body.appendChild(bboxSvg);
  }
  bboxPath.setAttribute('d', d);
  const b = bboxPath.getBBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

/**
 * מקור מוכן לציור: תיבה תוחמת, פונקציית ציור, ומפתח שמזהה אותו (למטמון ב worker).
 * @param {object} shape scene.shape
 * @param {{img: CanvasImageSource, w: number, h: number, url: string}|null} image
 */
export function makeSource(shape, image) {
  if (shape.type === 'image') {
    if (!image || !(image.w > 0 && image.h > 0)) return null;
    return {
      isImage: true,
      bb: { x: 0, y: 0, w: image.w, h: image.h },
      key: `img|${image.url}`,
      draw: (ctx) => ctx.drawImage(image.img, 0, 0, image.w, image.h),
    };
  }
  if (!shape.d) return null;
  const bb = pathBBox(shape.d);
  if (!(bb.w > 0 && bb.h > 0)) return null;
  const path = new Path2D(shape.d);
  return {
    isImage: false,
    bb,
    key: `path|${shape.fillRule}|${shape.d}`,
    draw: (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fill(path, shape.fillRule ?? 'nonzero');
    },
  };
}

/**
 * מצייר את המקור בקנה מידה s0 ומחזיר את הפיקסלים (RGBA).
 * k: פיקסלי מסכה לכל פיקסל מקומי (קטן מ 1 כשהצורה גדולה מ MASK_MAX).
 */
export function rasterize(source, s0) {
  const w0 = source.bb.w * s0;
  const h0 = source.bb.h * s0;
  const k = Math.min(1, MASK_MAX / Math.max(w0, h0));
  const mw = Math.ceil(w0 * k) + PAD * 2;
  const mh = Math.ceil(h0 * k) + PAD * 2;
  const canvas = document.createElement('canvas');
  canvas.width = mw;
  canvas.height = mh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(k * s0, 0, 0, k * s0, PAD - k * s0 * source.bb.x, PAD - k * s0 * source.bb.y);
  source.draw(ctx);
  const pixels = ctx.getImageData(0, 0, mw, mh).data;
  return { pixels, mw, mh, k, w0, h0 };
}
