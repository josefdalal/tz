// הנגן (index.html): הסטוריבורד בגלילה. בלי פאנל, בלי worker ובלי דגימה: רק סצנות אפויות.
// גרסה בסיסית של docs/storyboard.md סעיף ה: גלילה רכה (Lenis), מעברים לפי הגלילה,
// snap לקצה המעבר, וטקסט זמני עם fade. עדיין בלי מחוון התקדמות ובלי מצב step.
//
// הדף עצמו נגלל (אלמנט #scroll בגובה הציר), והקנבס קבוע. מיקום הגלילה עובר דרך locate
// ו viewAt, אותן פונקציות של התצוגה המקדימה בעורך, אל הליבה של המעברים (runner.js).

import Lenis from 'lenis';
import { createStage } from '../engine/stage.js';
import { fromFile, defaultScroll } from '../scenes/schema.js';
import { registry, onPresetsChange } from '../scenes/presets.js';
import { loadBakedGeometry, bakedFiles } from '../scenes/bakedFiles.js';
import { loadStoryboard, timelineFor } from '../storyboard/storyboard.js';
import { locate, activeStep, viewAt, textOpacity, snapTarget } from '../storyboard/timeline.js';
import { createTransitionRunner } from '../transitions/runner.js';
import { createTextDisplay } from '../storyboard/textDisplay.js';

const canvas = document.getElementById('stage');
const status = document.getElementById('status');
const spacer = document.getElementById('scroll');
const say = (text) => {
  status.textContent = text;
  status.hidden = !text;
};

// בזמן פיתוח: storyboard.json, סצנה או מעבר שנשמרו בעורך נטענים מחדש
if (import.meta.hot) onPresetsChange(() => location.reload());

async function main() {
  const sb = loadStoryboard();
  if (!sb || sb.steps.length === 0) return say('אין סטוריבורד. אפשר ליצור אותו בעורך (editor.html), בתיקייה "סטוריבורד".');
  const tl = timelineFor(sb);
  for (const w of tl.warnings) console.warn('[tz]', w);

  const names = [...new Set(sb.steps.map((s) => s.scene))];
  const missing = names.filter((n) => !registry.scene?.[n]);
  if (missing.length) return say(`סצנות שלא נמצאו: ${missing.join(', ')}`);
  const scenes = Object.fromEntries(names.map((n) => [n, fromFile(registry.scene[n], 'scene').data]));
  const unbaked = names.filter((n) => !scenes[n].baked);
  if (unbaked.length) {
    // קובץ אפייה בשם הסצנה בלי הפניה מהסצנה: אפו אותה ולא שמרו את הסצנה אחרי זה
    const unsaved = unbaked.filter((n) => bakedFiles[`${n}.tzb`]);
    const never = unbaked.filter((n) => !bakedFiles[`${n}.tzb`]);
    const parts = ['העמוד הראשי מציג רק סצנות אפויות.'];
    if (never.length) parts.push(`לא אפויות: ${never.join(', ')}. אפשר לאפות אותן בעורך, בתיקייה "אפייה", ואז לשמור סצנה.`);
    if (unsaved.length) parts.push(`נאפו אבל הסצנה לא נשמרה אחרי האפייה: ${unsaved.join(', ')}. בעורך: לטעון, לאפות שוב ולשמור סצנה באותו שם.`);
    return say(parts.join(' '));
  }

  say('טוען...');
  const geoms = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadBakedGeometry(scenes[n].baked)])));
  say('');

  const text = createTextDisplay();
  const stage = createStage({
    canvas,
    scene: scenes[names[0]],
    touchAction: 'pan-y', // הדף נגלל במגע; דחיפת עיגולים במגע עדיין לא מוגדרת (סעיף ה)
    onFrame: (s) => text.place(s.view),
  });
  const runner = createTransitionRunner({
    particles: stage.particles,
    renderer: stage.renderer,
    rng: stage.rng,
    getFrame: () => ({ view: stage.view, orientation: stage.orientation, width: stage.width, height: stage.height }),
    onRebind: () => stage.renderer.rebind(),
  });

  const setHeight = () => { spacer.style.height = `${Math.ceil(tl.total + window.innerHeight)}px`; };
  setHeight();
  stage.onResize(() => {
    stage.updateFrame();
    setHeight();
    if (runner.ready) runner.onFrame();
  });

  const lenis = new Lenis({ autoRaf: false, lerp: defaultScroll.smoothing });

  // snap: כשהגלילה נעצרת באמצע מעבר ל snapDelay, היא ממשיכה לקצה בכיוון האחרון
  let lastInput = performance.now();
  for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown']) {
    window.addEventListener(type, () => { lastInput = performance.now(); }, { passive: true });
  }
  let snapTo = null;

  const loc = {};
  let cur = { a: null, b: null, data: null };

  stage.run(() => {
    lenis.raf(performance.now());
    const y = lenis.scroll;
    locate(tl, y, loc);

    // ההחלקה והשהיית ה snap מגיעות מקובץ המעבר הקרוב (היוצא, או הנכנס בצעד האחרון)
    const step = tl.steps[loc.step];
    const sc = (step.transition ?? tl.steps[loc.step - 1]?.transition)?.scroll ?? defaultScroll;
    lenis.options.lerp = Math.min(1, Math.max(0.01, sc.smoothing));
    if (loc.phase === 'transition') {
      if (snapTo === null && !lenis.isScrolling && performance.now() - lastInput > sc.snapDelay) {
        snapTo = snapTarget(tl, y, lenis.direction || 0);
        lenis.scrollTo(snapTo);
      }
    } else {
      snapTo = null;
    }
    if (snapTo !== null && performance.now() - lastInput < 50) snapTo = null; // קלט חדש מבטל את ה snap

    const v = viewAt(tl, loc);
    if (v.a !== cur.a || v.b !== cur.b || v.data !== cur.data) {
      cur = { a: v.a, b: v.b, data: v.data };
      runner.setSides({ scene: scenes[v.a], geom: geoms[v.a] }, { scene: scenes[v.b], geom: geoms[v.b] }, v.data, v.t);
    }

    text.show(sb.steps[activeStep(loc)].text, textOpacity(tl, loc));
    return runner.frame(v.t);
  });

  if (import.meta.env.DEV) window.__tzPlayer = { stage, runner, lenis, tl, sb };
}

main().catch((e) => {
  say(`שגיאה: ${e.message}`);
  console.error(e);
});
