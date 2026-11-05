// הנגן (index.html). בלי פאנל, בלי worker ובלי דגימה: רק סצנות אפויות (baked/*.tzb).
//
// סעיף ב (פיצול לשני עמודים): נגן מינימלי שמציג סצנה אחת, כדי לוודא שהמנוע המשותף
// עובד לבד. בסעיף ה הוא יוחלף בנגן הסטוריבורד (storyboard.json, גלילה, מעברים).
//
// בחירת סצנה: ?scene=<שם>, אחרת הסצנה האפויה הראשונה לפי סדר האלפבית.

import { createStage } from '../engine/stage.js';
import { fromFile } from '../scenes/schema.js';
import { registry } from '../scenes/presets.js';
import { loadBakedGeometry } from '../scenes/bakedFiles.js';

const canvas = document.getElementById('stage');
const status = document.getElementById('status');
const say = (text) => {
  status.textContent = text;
  status.hidden = !text;
};

const scenes = registry.scene ?? {};
const wanted = new URLSearchParams(location.search).get('scene');
const bakedNames = Object.keys(scenes).filter((n) => scenes[n].baked).sort((a, b) => a.localeCompare(b));
const name = wanted ?? bakedNames[0];

if (!name || !scenes[name]) {
  say(wanted ? `סצנה לא נמצאה: ${wanted}` : 'אין סצנות אפויות. אפשר לאפות סצנה בעורך (editor.html).');
} else {
  const scene = fromFile(scenes[name], 'scene').data;
  if (!scene.baked) {
    say(`הסצנה ${name} לא אפויה. הנגן מציג רק סצנות אפויות; אפשר לאפות אותה בעורך.`);
  } else {
    const stage = createStage({ canvas, scene });
    stage.run();
    loadBakedGeometry(scene.baked)
      .then((g) => stage.applyGeometry(g))
      .catch((e) => say(`שגיאה בטעינת ${scene.baked.file ?? name}: ${e.message}`));
    if (import.meta.env.DEV) window.__tzPlayer = { stage, scene };
  }
}
