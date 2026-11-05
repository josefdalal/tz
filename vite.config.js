import { defineConfig, normalizePath } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PRESET_FOLDERS = ['scenes', 'palettes', 'motions'];
const PRESET_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;
// local/ אופציונלי: shapes/local לתמונות ניסיון, ב .gitignore
const SHAPE_NAME_RE = /^(local\/)?[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}\.(svg|png|jpg|jpeg|webp)$/u;
const MAX_JSON = 1024 * 1024;
const MAX_SHAPE = 20 * 1024 * 1024;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`הקובץ גדול מ ${Math.round(limit / 1024 / 1024)}MB`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** נתיב בטוח בתוך תיקייה בשורש הריפו, או null */
function safePath(root, folder, file) {
  const dir = path.resolve(root, folder);
  const full = path.resolve(dir, file);
  return path.dirname(full) === dir ? { dir, full } : null;
}

// בזמן פיתוח בלבד: שמירה ישירה לריפו מהפאנל.
//   POST /__presets  JSON {folder, name, data}  אל scenes/ palettes/ motions/
//   POST /__shapes   גוף בינארי, שם בכותרת X-Tz-Name  אל shapes/
// הכתיבה מוגבלת לתיקיות האלה ולשמות קבצים פשוטים. הכותרת X-Tz-Save מחייבת preflight,
// כך שאתר אחר בדפדפן לא יכול לשלוח בקשה כזו לשרת המקומי.
function savePlugin() {
  let shapesDir = '';
  let filesModuleId = '';
  return {
    name: 'tz-save',
    apply: 'serve',
    configResolved(config) {
      shapesDir = normalizePath(path.resolve(config.root, 'shapes')) + '/';
      filesModuleId = normalizePath(path.resolve(config.root, 'src/shapes/files.js'));
    },
    // קובץ תמונה שנדרס ב shapes/ גורם כברירת מחדל לרענון מלא (ל asset עם ?url אין גבול HMR).
    // מפנים את העדכון ל files.js, שמקבל את עצמו ומייצר כתובות חדשות.
    hotUpdate({ file }) {
      if (this.environment.name !== 'client' || !normalizePath(file).startsWith(shapesDir)) return;
      const mod = this.environment.moduleGraph.getModuleById(filesModuleId);
      return mod ? [mod] : [];
    },
    configureServer(server) {
      const root = server.config.root;

      server.middlewares.use('/__presets', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (req.headers['x-tz-save'] !== '1') return reply(res, 403, { error: 'missing header' });
        try {
          const { folder, name, data } = JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'));
          if (!PRESET_FOLDERS.includes(folder)) return reply(res, 400, { error: `תיקייה לא מוכרת: ${folder}` });
          if (typeof name !== 'string' || !PRESET_NAME_RE.test(name)) return reply(res, 400, { error: `שם לא תקין: ${name}` });
          if (data === null || typeof data !== 'object') return reply(res, 400, { error: 'חסר data' });
          const p = safePath(root, folder, `${name}.json`);
          if (!p) return reply(res, 400, { error: 'נתיב לא תקין' });
          await mkdir(p.dir, { recursive: true });
          await writeFile(p.full, JSON.stringify(data, null, 2) + '\n', 'utf8');
          reply(res, 200, { ok: true, path: `${folder}/${name}.json` });
        } catch (e) {
          reply(res, 500, { error: e.message });
        }
      });

      server.middlewares.use('/__shapes', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        if (req.headers['x-tz-save'] !== '1') return reply(res, 403, { error: 'missing header' });
        try {
          const name = decodeURIComponent(String(req.headers['x-tz-name'] ?? ''));
          if (!SHAPE_NAME_RE.test(name)) return reply(res, 400, { error: `שם קובץ לא תקין: ${name}` });
          const body = await readBody(req, MAX_SHAPE);
          if (body.length === 0) return reply(res, 400, { error: 'קובץ ריק' });
          const isLocal = name.startsWith('local/');
          const p = safePath(root, isLocal ? 'shapes/local' : 'shapes', isLocal ? name.slice(6) : name);
          if (!p) return reply(res, 400, { error: 'נתיב לא תקין' });
          await mkdir(p.dir, { recursive: true });
          await writeFile(p.full, body);
          reply(res, 200, { ok: true, path: `shapes/${name}` });
        } catch (e) {
          reply(res, 500, { error: e.message });
        }
      });
    },
  };
}

// base יחסי כדי שהבנייה תעבוד גם תחת נתיב המשנה של GitHub Pages
export default defineConfig({
  base: './',
  plugins: [savePlugin()],
  worker: { format: 'es' },
});
