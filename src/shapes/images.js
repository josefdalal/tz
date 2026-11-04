// טעינת קובץ צורה לתמונה שאפשר לצייר לתוך המסכה.
//
// SVG נטען כתמונה כמו שהוא, בלי פענוח paths. רק תכונות השורש נקראות, כדי לתת לו
// width ו height מפורשים (בלעדיהם הדפדפן מנחש 300 על 150 או אפס).

const cache = new Map();

/** @returns {Promise<{img: HTMLImageElement, w: number, h: number}>} */
export function loadShapeImage(url, isSvg) {
  const key = `${isSvg ? 'svg' : 'img'}:${url}`;
  if (!cache.has(key)) {
    const p = (isSvg ? loadSvg(url) : loadBitmap(url)).catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, p);
  }
  return cache.get(key);
}

function decode(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('לא ניתן לטעון את התמונה'));
    img.src = src;
  });
}

async function loadBitmap(url) {
  const img = await decode(url);
  return { img, w: img.naturalWidth, h: img.naturalHeight };
}

const absLength = (v) => (v && !/%$/.test(v.trim()) ? parseFloat(v) : NaN);

async function loadSvg(url) {
  const text = await (await fetch(url)).text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg') throw new Error('קובץ SVG לא תקין');

  const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  let w = absLength(svg.getAttribute('width'));
  let h = absLength(svg.getAttribute('height'));
  if (!(w > 0) && !(h > 0)) {
    w = hasVb ? vb[2] : 300;
    h = hasVb ? vb[3] : 150;
  } else if (!(w > 0)) {
    w = hasVb ? (h * vb[2]) / vb[3] : h;
  } else if (!(h > 0)) {
    h = hasVb ? (w * vb[3]) / vb[2] : w;
  }
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  // הכתובת לא משוחררת: יש דפדפנים שמפענחים SVG מחדש בכל ציור. נשמרת פעם אחת לכל קובץ במטמון.
  const img = await decode(URL.createObjectURL(blob));
  return { img, w, h };
}
