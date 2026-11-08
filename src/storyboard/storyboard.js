// הסטוריבורד מתוך מאגר הפריסטים: storyboard/storyboard.json והמעברים מ transitions/.
// הציר עצמו טהור, ב timeline.js.

import { fromFile } from '../scenes/schema.js';
import { registry } from '../scenes/presets.js';
import { buildTimeline } from './timeline.js';

export const STORYBOARD_NAME = 'storyboard';

/** הסטוריבורד השמור (אחרי migrations ומיזוג), או null כשאין קובץ. */
export function loadStoryboard() {
  const file = registry.storyboard[STORYBOARD_NAME];
  return file ? fromFile(file, 'storyboard').data : null;
}

/** נתוני מעבר מלאים לפי שם, או null. */
export function getTransition(name) {
  const file = registry.transition[name];
  if (!file) return null;
  try {
    return fromFile(file, 'transition').data;
  } catch {
    return null;
  }
}

/** סגנון מעבר (transition-styles/) לפי שם, או null. */
export function getStyle(name) {
  const file = registry.transitionStyle?.[name];
  if (!file) return null;
  try {
    return fromFile(file, 'transitionStyle').data;
  } catch {
    return null;
  }
}

/** הציר של סטוריבורד, עם המעברים והסגנונות מהמאגר. אזהרות נוספות על סצנות חסרות. */
export function timelineFor(storyboard) {
  const tl = buildTimeline(storyboard, getTransition, getStyle);
  for (const s of storyboard.steps) {
    if (!s.scene) tl.warnings.push(`${s.id}: אין סצנה`);
    else if (!registry.scene[s.scene]) tl.warnings.push(`${s.id}: הסצנה ${s.scene} לא נמצאה`);
  }
  return tl;
}
