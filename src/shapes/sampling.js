// לקוח ה worker בצד ה thread הראשי.
//
// request() עם debounce: בזמן גרירה של מחוון גיאומטריה נשלחת דגימה רק כשהגרירה נעצרת לרגע.
// לכל היותר בקשה אחת בדרך; בקשה שמגיעה בזמן עבודה מסומנת pending ונשלחת כשהקודמת חוזרת,
// עם המצב העדכני באותו רגע. תוצאה ישנה מתוצאה שכבר הוחלה נזרקת.

import { makeSource, rasterize } from './raster.js';
import { loadShapeImage } from './images.js';
import { shapeFiles, isSvgName } from './files.js';

export const DEBOUNCE_MS = 120;

/**
 * @param {() => {scene: object, width: number, height: number}} getState
 * @param {(geom: object) => void} onResult
 * @param {(state: string) => void} onStatus 'idle' | 'busy' | 'שגיאה: ...'
 */
export function createSampler(getState, onResult, onStatus) {
  const worker = new Worker(new URL('./sampler.worker.js', import.meta.url), { type: 'module' });
  let timer = 0;
  let busy = false;
  let pending = false;
  let seq = 0;
  let lastApplied = 0;
  let workerKey = null; // מפתח ה raster שנמצא במטמון של ה worker
  let lastJob = null; // לשליחה חוזרת אם ה worker איבד את ה raster

  function request(delay = DEBOUNCE_MS) {
    clearTimeout(timer);
    onStatus('busy');
    timer = setTimeout(() => {
      timer = 0;
      pending = true;
      pump();
    }, delay);
  }

  async function loadImage(shape) {
    if (shape.type !== 'image') return null;
    const url = shapeFiles[shape.src];
    if (!url) throw new Error(`קובץ צורה לא נמצא: ${shape.src}`);
    const im = await loadShapeImage(url, isSvgName(shape.src));
    return { ...im, url };
  }

  async function pump() {
    if (busy || !pending) return;
    pending = false;
    busy = true;
    const id = ++seq;
    try {
      const { scene, width, height } = getState();
      const shape = scene.shape;
      const image = await loadImage(shape);
      const source = makeSource(shape, image);
      if (!source) throw new Error('אין מקור צורה תקין');

      // קנה המידה של הדגימה: הקנה הנוכחי. אחר כך הוא משתנה חי בלי דגימה.
      const s0 = shape.scale * Math.min(width / source.bb.w, height / source.bb.h);
      const key = `${source.key}|${s0.toFixed(5)}`;
      const params = {
        isImage: source.isImage,
        seed: scene.seed,
        maxCount: scene.maxCount,
        radius: { ...scene.radius },
        image: { ...shape.image },
      };
      const meta = { bw: source.bb.w, bh: source.bb.h, s0, isImage: source.isImage };
      let raster = null;
      const transfer = [];
      if (key !== workerKey) {
        raster = rasterize(source, s0);
        transfer.push(raster.pixels.buffer);
        workerKey = key;
      }
      lastJob = { source, s0, key, params, meta };
      worker.postMessage({ id, key, raster, params, meta }, transfer);
    } catch (e) {
      busy = false;
      onStatus(`שגיאה: ${e.message}`);
      pump();
    }
  }

  worker.onmessage = (e) => {
    const { id, geom, error, needRaster } = e.data;
    busy = false;
    if (needRaster && lastJob) {
      // ה worker לא מחזיק את ה raster (למשל אחרי שגיאה): שולחים שוב עם פיקסלים
      const { source, s0, key, params, meta } = lastJob;
      const raster = rasterize(source, s0);
      workerKey = key;
      busy = true;
      worker.postMessage({ id, key, raster, params, meta }, [raster.pixels.buffer]);
      return;
    }
    if (error) {
      workerKey = null;
      onStatus(`שגיאה: ${error}`);
    } else if (id > lastApplied) {
      lastApplied = id;
      onResult(geom);
      if (!pending && !timer) onStatus('idle');
    }
    pump();
  };
  worker.onerror = (e) => {
    busy = false;
    workerKey = null;
    onStatus(`שגיאה ב worker: ${e.message}`);
  };

  return { request, isBusy: () => busy || pending || !!timer };
}
