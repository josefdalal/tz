// פורמט אפייה בינארי (TZB1). טהור, בלי DOM: משמש את הדפדפן ואת tools/convert-baked.mjs.
// המבנה המלא מתועד ב docs/storyboard.md (סעיף א).
//
//   'TZB1' | u16 version | u16 flags | u32 count | u32 headerLength | header JSON (מרופד ל 4)
//   ואחריו עמודה לכל שדה ב header.fields, כל אחת מרופדת ל 4.
// שדה: { name, type: 'u8' | 'u16', min, max, components? }. ערך = min + q * (max - min) / maxQ.
// gzip נעשה מחוץ לקובץ הזה (CompressionStream בדפדפן, zlib ב Node).

const MAGIC = [0x54, 0x5a, 0x42, 0x31]; // TZB1
const VERSION = 1;
const MAXQ = { u8: 255, u16: 65535 };
const BYTES = { u8: 1, u16: 2 };
const pad4 = (n) => (n + 3) & ~3;

function range(arr) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  return arr.length ? [min, max] : [0, 0];
}

/**
 * גיאומטריה (במרחב המקומי) אל בתים, לפני gzip.
 * @param geom { count, lx, ly, lr, edge, rand, rgb|null, meta }
 * @returns {Uint8Array}
 */
export function encodeBaked(geom) {
  const n = geom.count;
  const columns = [
    { name: 'x', type: 'u16', data: geom.lx },
    { name: 'y', type: 'u16', data: geom.ly },
    { name: 'r', type: 'u16', data: geom.lr },
    { name: 'edge', type: 'u8', data: geom.edge, fixed: [0, 1] },
    { name: 'rand', type: 'u16', data: geom.rand, fixed: [0, 1] },
  ];
  if (geom.rgb) columns.push({ name: 'rgb', type: 'u8', data: geom.rgb, fixed: [0, 1], components: 3 });

  const fields = columns.map((c) => {
    const [min, max] = c.fixed ?? range(c.data.subarray(0, n * (c.components ?? 1)));
    return { name: c.name, type: c.type, min, max, ...(c.components ? { components: c.components } : {}) };
  });
  const header = new TextEncoder().encode(JSON.stringify({ meta: geom.meta, fields }));
  const headerLen = pad4(header.length);
  let size = 16 + headerLen;
  for (const f of fields) size += pad4(n * (f.components ?? 1) * BYTES[f.type]);

  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint16(4, VERSION, true);
  dv.setUint16(6, geom.rgb ? 1 : 0, true);
  dv.setUint32(8, n, true);
  dv.setUint32(12, header.length, true);
  out.set(header, 16);

  let off = 16 + headerLen;
  columns.forEach((c, k) => {
    const f = fields[k];
    const len = n * (f.components ?? 1);
    const maxQ = MAXQ[f.type];
    const span = f.max - f.min;
    for (let i = 0; i < len; i++) {
      const q = span > 0 ? Math.round(((c.data[i] - f.min) / span) * maxQ) : 0;
      const v = q < 0 ? 0 : q > maxQ ? maxQ : q;
      if (f.type === 'u8') out[off + i] = v;
      else dv.setUint16(off + i * 2, v, true);
    }
    off += pad4(len * BYTES[f.type]);
  });
  return out;
}

/**
 * בתים (אחרי gunzip) אל גיאומטריה. שדות לא מוכרים נקראים ונשמרים ב extra, לא נזרקים.
 * @param {Uint8Array} bytes
 */
export function decodeBaked(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error('קובץ אפייה לא תקין (חסר TZB1)');
  const version = dv.getUint16(4, true);
  if (version > VERSION) throw new Error(`גרסת קובץ אפייה ${version} חדשה מהקוד`);
  const n = dv.getUint32(8, true);
  const headerLen = dv.getUint32(12, true);
  const { meta, fields } = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + headerLen)));

  const cols = {};
  let off = 16 + pad4(headerLen);
  for (const f of fields) {
    const len = n * (f.components ?? 1);
    const maxQ = MAXQ[f.type];
    const span = f.max - f.min;
    const arr = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const q = f.type === 'u8' ? bytes[off + i] : dv.getUint16(off + i * 2, true);
      arr[i] = f.min + (q / maxQ) * span;
    }
    cols[f.name] = arr;
    off += pad4(len * BYTES[f.type]);
  }
  const z = () => new Float32Array(n);
  const { x, y, r, edge, rand, rgb, ...extra } = cols;
  return {
    count: n,
    lx: x ?? z(),
    ly: y ?? z(),
    lr: r ?? z(),
    edge: edge ?? z(),
    rand: rand ?? z(),
    rgb: rgb ?? null,
    meta: { ...meta },
    extra,
  };
}

export const isGzip = (bytes) => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
