// תצוגת טקסט זמנית (docs/storyboard.md, סעיף ה): הטקסט של הצעד הפעיל בפינה קבועה של
// המסגרת, בלי עיצוב ובלי תנועה, רק כדי לראות את הרצף. משותפת לעורך (תצוגה מקדימה) ולנגן.
// בשלב 6 תוחלף בשכבת הטקסט (docs/text-layer.md).

const CSS = `
.tz-text {
  position: fixed; z-index: 2; box-sizing: border-box; direction: rtl;
  max-width: min(36em, calc(100% - 32px)); padding: 10px 14px;
  font: 15px/1.5 system-ui, sans-serif; color: #111; background: rgba(255, 255, 255, 0.85);
}
.tz-text[hidden] { display: none; }
.tz-text h2 { margin: 0; font-size: 1.25em; line-height: 1.3; }
.tz-text p { margin: 0.3em 0 0; white-space: pre-line; }
.tz-text a { display: inline-block; margin-top: 0.4em; color: inherit; }
`;

const MARGIN = 24;

export function createTextDisplay() {
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

  let lastKey = '';
  let lastPlace = '';

  return {
    /** הטקסט של צעד ({ title, body, link }), או null להסתרה. */
    show(text) {
      const key = text ? JSON.stringify(text) : '';
      if (key === lastKey) return;
      lastKey = key;
      const empty = !text || (!text.title && !text.body && !text.link?.text && !text.link?.href);
      root.hidden = empty;
      if (empty) return;
      h.textContent = text.title;
      h.hidden = !text.title;
      p.textContent = text.body;
      p.hidden = !text.body;
      const href = text.link?.href ?? '';
      a.textContent = text.link?.text || href;
      a.href = href || '#';
      a.hidden = !a.textContent;
    },
    /** פינה תחתונה ימנית של המסגרת (view בפיקסלי מסך), כך שהיא נשארת בתוך מסגרת מדומה. */
    place(view) {
      const right = window.innerWidth - (view.x0 + view.w) + MARGIN;
      const bottom = window.innerHeight - (view.y0 + view.h) + MARGIN;
      const key = `${right},${bottom}`;
      if (key === lastPlace) return;
      lastPlace = key;
      root.style.right = `${right}px`;
      root.style.bottom = `${bottom}px`;
    },
  };
}
