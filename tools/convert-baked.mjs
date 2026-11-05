// ממיר סצנות עם אפייה בפורמט הישן (העיגולים בתוך ה JSON) לפורמט הבינארי:
// כותב baked/<id>.tzb ומחליף את scene.baked בהפניה { file, count }.
// הסצנה נכתבת מחדש דרך fromFile ו toFile, כלומר מעודכנת לגרסת הסכמה הנוכחית.
//
// שימוש: node tools/convert-baked.mjs            (כל scenes/*.json)
//        node tools/convert-baked.mjs S_002       (סצנה אחת)

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { fromFile, toFile } = await imp('src/scenes/schema.js');
const { unbakeGeometry } = await imp('src/scenes/bake.js');
const { encodeBaked, decodeBaked } = await imp('src/scenes/bakedFormat.js');

const only = process.argv[2];
const files = readdirSync(path.join(root, 'scenes')).filter((f) => f.endsWith('.json') && (!only || f === `${only}.json`));
mkdirSync(path.join(root, 'baked'), { recursive: true });

let converted = 0;
for (const f of files) {
  const file = path.join(root, 'scenes', f);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!raw.baked?.circles) continue;
  const name = f.replace(/\.json$/, '');
  const geom = unbakeGeometry(raw.baked);
  const bytes = encodeBaked(geom);
  const gz = gzipSync(bytes, { level: 9 });
  writeFileSync(path.join(root, 'baked', `${name}.tzb`), gz);

  // בדיקה: פענוח חוזר ושגיאת הכימות המרבית
  const back = decodeBaked(bytes);
  let maxErr = 0;
  for (const k of ['lx', 'ly', 'lr']) for (let i = 0; i < geom.count; i++) maxErr = Math.max(maxErr, Math.abs(back[k][i] - geom[k][i]));

  const { data } = fromFile(raw, 'scene');
  data.baked = { file: `${name}.tzb`, count: geom.count };
  writeFileSync(file, JSON.stringify(toFile('scene', data), null, 2) + '\n');
  const before = readFileSync(file).length;
  console.log(
    `${f}: ${geom.count} עיגולים, JSON ישן ${JSON.stringify(raw.baked).length.toLocaleString()} בתים ` +
      `-> baked/${name}.tzb ${gz.length.toLocaleString()} בתים (לא דחוס ${bytes.length.toLocaleString()}), ` +
      `סצנה עכשיו ${before.toLocaleString()} בתים, שגיאת כימות מרבית ${maxErr.toFixed(4)}px`,
  );
  converted++;
}
console.log(converted ? `הומרו ${converted} סצנות` : 'אין סצנות בפורמט הישן');
