// שכבת עורך מעל הקנבס: מסגרת התצוגה המדומה והאזור הבטוח. רק כשהפאנל פעיל.
// לא תופסת אירועי עכבר. מחוץ למסגרת המדומה, כיסוי בצבע הרקע שמסתיר את מה שלא ייראה.

export function createFrameOverlay() {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1';
  const dims = [0, 1, 2, 3].map(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;';
    root.appendChild(d);
    return d;
  });
  const frame = document.createElement('div');
  frame.style.cssText = 'position:absolute;box-sizing:border-box;border:1px solid rgba(128,128,128,0.6)';
  const safe = document.createElement('div');
  safe.style.cssText = 'position:absolute;box-sizing:border-box;border:1px dashed rgba(255,80,80,0.8)';
  const label = document.createElement('div');
  label.style.cssText =
    'position:absolute;font:11px system-ui,sans-serif;color:rgba(255,80,80,0.95);padding:2px 4px;direction:ltr;white-space:nowrap';
  root.append(frame, safe, label);
  document.body.appendChild(root);

  const place = (el, x, y, w, h) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${Math.max(0, w)}px`;
    el.style.height = `${Math.max(0, h)}px`;
  };

  /**
   * @param view  המסגרת המדומה {x0, y0, w, h}
   * @param rect  האזור הבטוח {x0, y0, w, h}
   * @param opts  { width, height, showSafe, simulated, background, text }
   */
  function update(view, rect, opts) {
    const { width, height } = opts;
    const bg = opts.background;
    // ארבעה פסים מחוץ למסגרת המדומה
    place(dims[0], 0, 0, width, view.y0);
    place(dims[1], 0, view.y0 + view.h, width, height - view.y0 - view.h);
    place(dims[2], 0, view.y0, view.x0, view.h);
    place(dims[3], view.x0 + view.w, view.y0, width - view.x0 - view.w, view.h);
    for (const d of dims) {
      // צבע הרקע מסתיר את מה שלא ייראה; ההכהיה הקלה מסמנת שזה מחוץ למסגרת
      d.style.background = `linear-gradient(rgba(0,0,0,0.1), rgba(0,0,0,0.1)), ${bg}`;
      d.style.opacity = '0.95';
      d.style.display = opts.simulated ? 'block' : 'none';
    }
    frame.style.display = opts.simulated ? 'block' : 'none';
    place(frame, view.x0, view.y0, view.w, view.h);
    safe.style.display = opts.showSafe ? 'block' : 'none';
    label.style.display = opts.showSafe ? 'block' : 'none';
    place(safe, rect.x0, rect.y0, rect.w, rect.h);
    label.style.left = `${rect.x0}px`;
    label.style.top = `${rect.y0}px`;
    label.textContent = opts.text;
  }

  return { update };
}
