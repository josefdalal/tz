// תצוגת טקסט זמנית: הטקסט של הצעד הפעיל, בלי עיצוב, במיקום של הצעד (text.x, text.y),
// עם fade במעבר. משותפת לעורך (תצוגה מקדימה, עם גרירה) ולנגן.
// בשלב 6 תוחלף בשכבת הטקסט (docs/text-layer.md).
//
// מיקום: x ו y הם מרכז התיבה, 0 עד 1 על פני האזור הבטוח בייחוס 16:9 (כמו מיקום של צורה),
// כך שהטקסט נשאר באותו מקום יחסי בכל גודל מסך. ערכים מחוץ לטווח מגיעים לשאר ה viewport.

import { safeRect, orientationOf } from '../scenes/frame.js';

const TEXT_FRAME = { reference: '16:9' };

const CSS = `
.tz-text {
  position: fixed; left: 0; top: 0; z-index: 2; box-sizing: border-box; direction: rtl;
  width: max-content; max-width: min(36em, calc(100vw - 32px)); padding: 10px 14px;
  font: 15px/1.5 system-ui, sans-serif; color: #111; background: rgba(255, 255, 255, 0.85);
  will-change: transform, opacity;
}
.tz-text[hidden] { display: none; }
.tz-text.tz-draggable { cursor: move; user-select: none; }
.tz-text.tz-draggable:hover { outline: 1px dashed rgba(0, 0, 0, 0.5); }
.tz-text h2 { margin: 0; font-size: 1.25em; line-height: 1.3; }
.tz-text p { margin: 0.3em 0 0; white-space: pre-line; }
.tz-text a { display: inline-block; margin-top: 0.4em; color: inherit; }
`;

const isEmpty = (t) => !t || (!t.title && !t.body && !t.link?.text && !t.link?.href);

/**
 * @param opts { onDrag?: (x, y) => void }  עם onDrag התיבה נגררת (בעורך), ו x ו y החדשים נשלחים אליו
 */
export function createTextDisplay(opts = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'tz-text';
  root.hidden = true;
  const h = document.createElement('h2');
  const p = document.createElement('p');
  const a = document.createElement('a');
  a.target = '_blank';
  a.rel = 'noopener';
  root.append(h, p, a);
  document.body.appendChild(root);

  let text = null;
  let contentKey = '';
  let view = { x0: 0, y0: 0, w: window.innerWidth, h: window.innerHeight };
  let safe = safeRect(TEXT_FRAME, orientationOf(view), view);
  let lastTransform = '';
  let lastOpacity = '';

  function position() {
    if (!text) return;
    const tf = `translate(${safe.x0 + text.x * safe.w}px, ${safe.y0 + text.y * safe.h}px) translate(-50%, -50%)`;
    if (tf !== lastTransform) {
      lastTransform = tf;
      root.style.transform = tf;
    }
  }

  // גרירה: מתחילה רק אחרי תזוזה של כמה פיקסלים, כדי שלחיצה על הקישור תעבוד
  if (opts.onDrag) {
    root.classList.add('tz-draggable');
    let drag = null;
    let dragged = false;
    root.addEventListener('pointerdown', (e) => {
      if (!text || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, tx: text.x, ty: text.y, id: e.pointerId };
      dragged = false;
    });
    root.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      if (!dragged) root.setPointerCapture(drag.id);
      dragged = true;
      const x = Math.round((drag.tx + dx / safe.w) * 1000) / 1000;
      const y = Math.round((drag.ty + dy / safe.h) * 1000) / 1000;
      opts.onDrag(x, y);
    });
    const end = () => { drag = null; };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    // קליק שסיים גרירה לא פותח את הקישור
    root.addEventListener('click', (e) => {
      if (dragged) {
        e.preventDefault();
        dragged = false;
      }
    }, true);
  }

  return {
    /**
     * הטקסט של צעד ({ title, body, link, x, y }) או null, ושקיפות בין 0 ל 1.
     * נקרא בכל פריים; כותב ל DOM רק כשמשהו השתנה.
     */
    show(t, opacity = 1) {
      text = isEmpty(t) ? null : t;
      const key = text ? JSON.stringify([text.title, text.body, text.link]) : '';
      if (key !== contentKey) {
        contentKey = key;
        root.hidden = !text;
        if (text) {
          h.textContent = text.title;
          h.hidden = !text.title;
          p.textContent = text.body;
          p.hidden = !text.body;
          const href = text.link?.href ?? '';
          a.textContent = text.link?.text || href;
          a.href = href || '#';
          a.hidden = !a.textContent;
        }
      }
      const op = opacity >= 1 ? '' : opacity.toFixed(3);
      if (op !== lastOpacity) {
        lastOpacity = op;
        root.style.opacity = op;
        root.style.visibility = opacity <= 0 ? 'hidden' : '';
      }
      position();
    },
    /** המסגרת השתנתה (חלון, תצוגה מקדימה). view בפיקסלי מסך. */
    place(v) {
      view = v;
      safe = safeRect(TEXT_FRAME, orientationOf(view), view);
      position();
    },
  };
}
