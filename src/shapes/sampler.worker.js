// Web Worker לדגימה. מקבל פיקסלים של המקור (רק כשהם משתנים) ופרמטרי גיאומטריה,
// ומחזיר מערכים מקומיים כ transferable.
//
// הודעה נכנסת: { id, key, raster | null, params, meta }
//   raster נשלח רק כשהמפתח השתנה; אחרת משתמשים בזה שבמטמון.
// הודעה יוצאת: { id, geom } או { id, error, needRaster? }

import { sampleRaster } from './sampler.js';

let cached = { key: null, raster: null };

self.onmessage = (e) => {
  const { id, key, raster, params, meta } = e.data;
  try {
    if (raster) cached = { key, raster };
    if (cached.key !== key) {
      self.postMessage({ id, error: 'raster missing', needRaster: true });
      return;
    }
    const t0 = performance.now();
    const g = sampleRaster(cached.raster, params);
    const geom = { ...g, meta: { ...meta, rMin: params.radius.min, rMax: params.radius.max }, ms: performance.now() - t0 };
    const transfer = [g.lx.buffer, g.ly.buffer, g.lr.buffer, g.edge.buffer, g.rand.buffer];
    if (g.rgb) transfer.push(g.rgb.buffer);
    self.postMessage({ id, geom }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
