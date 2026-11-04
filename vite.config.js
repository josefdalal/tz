import { defineConfig } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PRESET_FOLDERS = ['scenes', 'palettes', 'motions'];
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;
const MAX_BODY = 1024 * 1024;

// בזמן פיתוח בלבד: מקבל POST ל /__presets ושומר JSON ישירות לתיקיית הפריסטים בריפו.
// הכתיבה מוגבלת לשלוש התיקיות ולשמות קבצים פשוטים. הכותרת X-Tz-Save מחייבת preflight,
// כך שאתר אחר בדפדפן לא יכול לשלוח בקשה כזו לשרת המקומי.
function presetsPlugin() {
  return {
    name: 'tz-presets',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use('/__presets', (req, res, next) => {
        if (req.method !== 'POST') return next();
        const reply = (status, body) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.headers['x-tz-save'] !== '1') return reply(403, { error: 'missing header' });

        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
          size += c.length;
          if (size > MAX_BODY) req.destroy();
          else chunks.push(c);
        });
        req.on('end', async () => {
          try {
            const { folder, name, data } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!PRESET_FOLDERS.includes(folder)) return reply(400, { error: `תיקייה לא מוכרת: ${folder}` });
            if (typeof name !== 'string' || !NAME_RE.test(name)) return reply(400, { error: `שם לא תקין: ${name}` });
            if (data === null || typeof data !== 'object') return reply(400, { error: 'חסר data' });
            const dir = path.resolve(root, folder);
            const file = path.resolve(dir, `${name}.json`);
            if (path.dirname(file) !== dir) return reply(400, { error: 'נתיב לא תקין' });
            await mkdir(dir, { recursive: true });
            await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
            reply(200, { ok: true, path: `${folder}/${name}.json` });
          } catch (e) {
            reply(500, { error: e.message });
          }
        });
      });
    },
  };
}

// base יחסי כדי שהבנייה תעבוד גם תחת נתיב המשנה של GitHub Pages
export default defineConfig({
  base: './',
  plugins: [presetsPlugin()],
});
