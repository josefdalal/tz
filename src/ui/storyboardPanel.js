// תיקיית "סטוריבורד" בעורך (docs/storyboard.md, סעיף ד).
//
// עותק עבודה של storyboard/storyboard.json: רשימת צעדים, ולכל צעד סצנה, hold, מעבר לצעד
// הבא וטקסט פשוט. שום דבר לא נשמר עד "שמור סטוריבורד". אין טיוטה ב localStorage, כי
// המשתמש עובד משני מחשבים וטיוטה ישנה הייתה מסתירה קובץ שהגיע ב pull.
//
// תצוגה מקדימה: סרגל לאורך כל הסטוריבורד, דרך locate של הנגן. המצב מוצג במצב המעבר:
// במעבר, הזוג של המעבר ב t המקומי. בעצירה, המעבר היוצא ב t של 0 (או הנכנס ב 1 בצעד האחרון).
// הטקסט של הצעד הפעיל מוצג בתצוגה הזמנית (storyboard/textDisplay.js): fade out עד אמצע
// המעבר, החלפה, ו fade in. אפשר לגרור אותו על המסגרת, וזה משנה את text.x ו text.y של הצעד.

import { defaultStep, defaultStepText, defaultStoryboard, playbackModes } from '../scenes/schema.js';
import { registry, savePreset } from '../scenes/presets.js';
import { loadStoryboard, getTransition, timelineFor, STORYBOARD_NAME } from '../storyboard/storyboard.js';
import { locate, activeStep, stepPosition, viewAt, textOpacity } from '../storyboard/timeline.js';
import { clone, deepMerge } from '../util/merge.js';

const CSS = `
.lil-gui .tz-textarea {
  width: 100%; min-height: 4.8em; resize: vertical; box-sizing: border-box;
  font: inherit; color: var(--text-color); background: var(--widget-color);
  border: 0; border-radius: var(--widget-border-radius); padding: 4px var(--padding);
}
.lil-gui .tz-textarea:focus { outline: none; background: var(--focus-color); }
.lil-gui .lil-controller.tz-multiline { align-items: flex-start; height: auto; }
.lil-gui .lil-controller.tz-multiline .lil-widget { height: auto; }
.lil-gui .tz-warnings { padding: 4px var(--padding); font-size: 0.9em; line-height: 1.5; color: #f5a623; direction: rtl; }
.lil-gui .tz-warnings:empty { display: none; }
`;

/** מחליף את שדה הטקסט של controller מחרוזת בשדה רב שורות. */
function asTextarea(c) {
  const ta = document.createElement('textarea');
  ta.className = 'tz-textarea';
  ta.dir = 'auto';
  ta.spellcheck = false;
  ta.addEventListener('input', () => c.setValue(ta.value));
  ta.addEventListener('blur', () => c._callOnFinishChange());
  c.$input.replaceWith(ta);
  c.$input = ta;
  c.$disable = ta;
  c.domElement.classList.add('tz-multiline');
  c.updateDisplay();
  return c;
}

const textEmpty = (t) => !t || (!t.title && !t.body && !t.link.text && !t.link.href);

/** עותק עבודה: לכל צעד יש אובייקט text, כדי שהשדות בפאנל תמיד יצביעו על משהו. */
function toWorking(data) {
  const sb = clone(data ?? defaultStoryboard);
  for (const s of sb.steps) s.text = s.text ? deepMerge(defaultStepText, s.text) : clone(defaultStepText);
  return sb;
}

/** לשמירה: טקסט ריק נשמר כ null. */
function serialize(sb) {
  return {
    playback: sb.playback,
    style: sb.style,
    steps: sb.steps.map((s) => ({ ...clone(s), text: textEmpty(s.text) ? null : clone(s.text) })),
  };
}

/**
 * @param gui  שורש הפאנל (lil-gui)
 * @param hooks { transition, refreshTransition(), onPresetsChange(fn), text: createTextDisplay() }
 * @returns {{ dragText(x, y): void, onTransitionExit(): void }}
 */
export function createStoryboardPanel(gui, hooks) {
  const tr = hooks.transition;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let sb = toWorking(loadStoryboard());
  let savedJSON = JSON.stringify(serialize(sb));
  let tl = timelineFor(sb);

  const ui = { status: '', state: '' };
  const pv = { on: false, y: 0, info: '' };
  let shownStep = -1; // הצעד הפעיל בתצוגה המקדימה, לטקסט
  let shownOpacity = 1; // fade במעבר, כמו בנגן

  /** הטקסט של הצעד הפעיל, רק כשהתצוגה המקדימה דלוקה. נקרא גם אחרי כל הקלדה וגרירה. */
  function showText() {
    hooks.text.show(pv.on && shownStep >= 0 ? sb.steps[shownStep]?.text ?? null : null, shownOpacity);
  }
  const posCtrls = new Map(); // id של צעד אל המחוונים של x ו y, לעדכון בזמן גרירה

  const run = async (fn) => {
    try {
      ui.status = (await fn()) ?? '';
    } catch (e) {
      ui.status = `שגיאה: ${e.message}`;
      console.error(e);
    }
  };

  const fSb = gui.addFolder('סטוריבורד');
  fSb.domElement.classList.add('tz-live');
  const rtl = (c) => { c.$input.dir = 'rtl'; return c; };
  rtl(fSb.add(ui, 'status').name('מצב').listen().disable());
  rtl(fSb.add(ui, 'state').name('קובץ').listen().disable());
  const playbackCtrl = fSb.add(sb, 'playback', playbackModes).name('ניגון בנגן').onChange(() => changed(false));
  // סגנון מעבר אחד לכל המעברים, חוץ מצעד שבחרו לו קובץ מעבר משלו
  const styleOptions = () => ({ '(ברירת מחדל)': '', ...Object.fromEntries(styleNames().map((n) => [n, n])) });
  const styleCtrl = fSb.add(sb, 'style', styleOptions()).name('סגנון מעבר לכל הסצנות').onChange(() => { changed(true); buildSteps(); });
  const warnings = document.createElement('div');
  warnings.className = 'tz-warnings';
  fSb.$children.appendChild(warnings);

  // ---------- צעדים ----------

  const fSteps = fSb.addFolder('צעדים');
  fSteps.add({ go: () => addStep() }, 'go').name('הוסף צעד');

  const sceneNames = () => Object.keys(registry.scene ?? {}).sort((a, b) => a.localeCompare(b));
  const transitionNames = () => Object.keys(registry.transition ?? {}).sort((a, b) => a.localeCompare(b));
  function styleNames() {
    return Object.keys(registry.transitionStyle ?? {}).sort((a, b) => a.localeCompare(b));
  }

  /** מעברים שמתאימים לצעד i (from הסצנה שלו, to של הבא), ו"ללא". מעבר שנבחר ולא מתאים נשאר, עם סימון. */
  function transitionOptions(i) {
    const step = sb.steps[i];
    const next = sb.steps[i + 1];
    if (!next) return { 'ללא (צעד אחרון)': '' };
    const opts = { [sb.style ? `ללא (סגנון ${sb.style})` : 'ללא (ברירת מחדל)']: '' };
    for (const n of transitionNames()) {
      const d = getTransition(n);
      if (d && d.from === step.scene && d.to === next.scene) opts[n] = n;
    }
    if (step.transition && !Object.values(opts).includes(step.transition)) opts[`⚠ ${step.transition}`] = step.transition;
    return opts;
  }

  const stepTitle = (s, i) => `${i + 1} · ${s.scene || '(בלי סצנה)'}${s.text.title ? ` · ${s.text.title}` : ''}`;

  function buildSteps() {
    const open = new Set(fSteps.folders.filter((f) => !f._closed).map((f) => f._tzId));
    for (const f of [...fSteps.folders]) f.destroy();
    posCtrls.clear();
    sb.steps.forEach((step, i) => {
      const f = fSteps.addFolder(stepTitle(step, i));
      f._tzId = step.id;
      const retitle = () => f.title(stepTitle(step, i));

      const scenes = sceneNames();
      if (step.scene && !scenes.includes(step.scene)) scenes.unshift(step.scene);
      f.add(step, 'scene', scenes).name('סצנה').onChange(() => {
        changed(true);
        buildSteps(); // רשימות המעברים של הצעד הזה ושל הקודם תלויות בסצנה
      });
      f.add(step, 'hold', 0, 6000, 10).name('עצירה px').onChange(() => changed(true));
      const trUi = { v: step.transition ?? '' };
      f.add(trUi, 'v', transitionOptions(i)).name('מעבר לצעד הבא').onChange((v) => {
        step.transition = v || null;
        changed(true);
      }).enable(i < sb.steps.length - 1);

      const t = step.text;
      const title = f.add(t, 'title').name('כותרת').onChange(() => { retitle(); changed(false); });
      title.$input.dir = 'auto';
      asTextarea(f.add(t, 'body').name('גוף')).onChange(() => changed(false));
      const linkText = f.add(t.link, 'text').name('טקסט הקישור').onChange(() => changed(false));
      linkText.$input.dir = 'auto';
      f.add(t.link, 'href').name('כתובת הקישור').onChange(() => changed(false));
      // מיקום התיבה: מרכז, על פני האזור הבטוח. גם בגרירה על המסגרת בתצוגה המקדימה.
      posCtrls.set(step.id, [
        f.add(t, 'x', -0.2, 1.2, 0.001).name('מיקום טקסט x').onChange(() => changed(false)),
        f.add(t, 'y', -0.2, 1.2, 0.001).name('מיקום טקסט y').onChange(() => changed(false)),
      ]);

      f.add({ go: () => moveStep(i, -1) }, 'go').name('הזזה למעלה').enable(i > 0);
      f.add({ go: () => moveStep(i, 1) }, 'go').name('הזזה למטה').enable(i < sb.steps.length - 1);
      f.add({ go: () => removeStep(i) }, 'go').name('מחיקת צעד');
      if (!open.has(step.id)) f.close();
    });
  }

  function uniqueId() {
    const used = new Set(sb.steps.map((s) => s.id));
    let n = sb.steps.length + 1;
    while (used.has(`s${n}`)) n++;
    return `s${n}`;
  }

  function addStep() {
    const last = sb.steps[sb.steps.length - 1];
    const step = { id: uniqueId(), scene: last?.scene ?? sceneNames()[0] ?? '', hold: defaultStep.hold, transition: null, text: clone(defaultStepText) };
    sb.steps.push(step);
    changed(true);
    buildSteps();
    fSteps.folders[fSteps.folders.length - 1]?.open();
    ui.status = `נוסף צעד ${step.id}`;
  }

  function moveStep(i, d) {
    const j = i + d;
    if (j < 0 || j >= sb.steps.length) return;
    [sb.steps[i], sb.steps[j]] = [sb.steps[j], sb.steps[i]];
    changed(true);
    buildSteps();
  }

  function removeStep(i) {
    const s = sb.steps[i];
    if (!textEmpty(s.text) && !confirm(`למחוק את הצעד ${i + 1} (${s.scene}) עם הטקסט שלו?`)) return;
    sb.steps.splice(i, 1);
    changed(true);
    buildSteps();
    ui.status = `נמחק צעד ${s.id}`;
  }

  // ---------- תצוגה מקדימה ----------

  const fPreview = fSb.addFolder('תצוגה מקדימה');
  fPreview.add(pv, 'on').name('תצוגה מקדימה').onChange((on) => {
    if (on) updatePreview();
    else {
      showText();
      if (tr.active) tr.exit();
    }
  });
  const yCtrl = fPreview.add(pv, 'y', 0, Math.max(1, tl.total), 1).name('מיקום px').onChange(() => updatePreview());
  rtl(fPreview.add(pv, 'info').name('צעד').listen().disable());
  const jump = (d) => {
    const loc = locate(tl, pv.y);
    const cur = activeStep(loc);
    pv.y = stepPosition(tl, cur + d);
    yCtrl.updateDisplay();
    updatePreview();
  };
  fPreview.add({ go: () => jump(-1) }, 'go').name('צעד קודם');
  fPreview.add({ go: () => jump(1) }, 'go').name('צעד הבא');

  // הסרגל זז מהר יותר ממה שסצנה נטענת: בקשה אחת בדרך, והבאה עם המיקום העדכני
  let busy = false;
  let pending = false;
  async function updatePreview() {
    if (!pv.on) return;
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      do {
        pending = false;
        await showAt(pv.y);
      } while (pending && pv.on);
    } catch (e) {
      ui.status = `שגיאה: ${e.message}`;
      console.error(e);
    } finally {
      busy = false;
    }
  }

  async function showAt(y) {
    const loc = locate(tl, y);
    const v = viewAt(tl, loc);
    if (!v) throw new Error('אין צעדים');
    if (!v.a || !v.b) throw new Error(`לצעד ${loc.step + 1} אין סצנה`);
    const act = activeStep(loc);
    const s = sb.steps[act];
    shownStep = act;
    shownOpacity = textOpacity(loc);
    showText();
    pv.info = `${act + 1} (${s.id}) · ${loc.phase === 'hold' ? 'עצירה' : 'מעבר'} ${loc.local.toFixed(2)}${s.text.title ? ` · ${s.text.title}` : ''}`;
    await tr.show(v.a, v.b, v.data, v.t);
    if (!pv.on) {
      tr.exit(); // כובה בזמן הטעינה
      return;
    }
    hooks.refreshTransition();
  }

  // ---------- עמוד ראשי ----------

  // הנגן קורא את storyboard.json השמור ואת הסצנות האפויות, לא את עותק העבודה
  fSb.add({ go: () => {
    if (dirty()) ui.status = 'שים לב: יש שינויים שלא נשמרו, והעמוד הראשי מציג את הקובץ השמור';
    window.open(new URL('index.html', location.href), 'tz-player');
  } }, 'go').name('פתיחה בעמוד הראשי');

  // ---------- שמירה ----------

  fSb.add({ go: () => run(save) }, 'go').name('שמור סטוריבורד');
  fSb.add({ go: () => run(revert) }, 'go').name('טען מהקובץ (ביטול שינויים)');

  async function save() {
    const data = serialize(sb);
    const msg = await savePreset('storyboard', STORYBOARD_NAME, data);
    savedJSON = JSON.stringify(data);
    changed(false);
    return msg;
  }

  function revert() {
    if (dirty() && !confirm('לבטל את השינויים שלא נשמרו ולטעון את storyboard.json?')) return 'בוטל';
    reload();
    return 'נטען storyboard/storyboard.json';
  }

  function reload() {
    const data = loadStoryboard();
    sb = toWorking(data);
    savedJSON = JSON.stringify(serialize(sb));
    playbackCtrl.object = sb;
    playbackCtrl.updateDisplay();
    styleCtrl.object = sb;
    styleCtrl.updateDisplay();
    changed(true);
    buildSteps();
  }

  const dirty = () => JSON.stringify(serialize(sb)) !== savedJSON;

  /** אחרי כל שינוי. timeline: השינוי משפיע על הציר (סצנה, hold, מעבר, סדר). */
  function changed(timeline) {
    ui.state = `${sb.steps.length} צעדים · ${dirty() ? 'יש שינויים שלא נשמרו' : 'שמור'}`;
    showText();
    if (!timeline) return;
    tl = timelineFor(sb);
    warnings.textContent = tl.warnings.join('\n');
    warnings.style.whiteSpace = 'pre-line';
    yCtrl.max(Math.max(1, tl.total));
    if (pv.y > tl.total) pv.y = tl.total;
    yCtrl.updateDisplay();
    updatePreview();
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty()) e.preventDefault();
  });

  // קובץ שהשתנה בדיסק (שמירה, pull) או סצנה ומעבר חדשים. בלי שינויים מקומיים, נטען מהקובץ.
  // הצעדים נבנים מחדש רק כשמשהו השתנה, כדי לא לקטוע הקלדה.
  let lastSig = '';
  const signature = () => JSON.stringify([sceneNames(), transitionNames(), styleNames(), registry.storyboard?.[STORYBOARD_NAME] ?? null]);
  hooks.onPresetsChange(() => {
    const sig = signature();
    if (sig === lastSig) return;
    lastSig = sig;
    styleCtrl.options(styleOptions());
    if (!dirty() && JSON.stringify(serialize(toWorking(loadStoryboard()))) !== savedJSON) {
      reload();
      return;
    }
    changed(true);
    buildSteps();
  });

  lastSig = signature();
  changed(true);
  buildSteps();
  for (const f of fSb.foldersRecursive()) f.close();
  fSb.close();

  return {
    /** מצב המעבר נסגר (כפתור היציאה או כיבוי התצוגה המקדימה) */
    /** גרירה של תיבת הטקסט על המסגרת: מעדכנת את הצעד המוצג */
    dragText(x, y) {
      const s = sb.steps[shownStep];
      if (!pv.on || !s) return;
      s.text.x = x;
      s.text.y = y;
      for (const c of posCtrls.get(s.id) ?? []) c.updateDisplay();
      changed(false);
    },
    onTransitionExit() {
      pv.on = false;
      showText();
      fPreview.controllers[0].updateDisplay();
    },
  };
}
