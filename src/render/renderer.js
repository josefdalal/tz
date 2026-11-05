import * as THREE from 'three';
import { buildPaletteLUT } from './palette.js';

const LUT_SIZE = 256;

// כל עיגול נושא שני צבעים: A (פלטה A וצבע תמונה) ו B (פלטה B וצבע תמונה), ו colorU
// שמערבב ביניהם ב OKLCH. בסצנה רגילה colorU = 0 וצד B לא בשימוש.
const vertexShader = /* glsl */ `
  attribute float aX;
  attribute float aY;
  attribute float aR;
  attribute float aColorT;
  attribute vec3 aImgColor;
  attribute float aImgMix;
  attribute float aColorT2;
  attribute vec3 aImgColor2;
  attribute float aImgMix2;
  attribute float aColorU;

  varying vec2 vPx;      // היסט מהמרכז בפיקסלי CSS
  varying float vR;
  varying vec4 vA;       // xyz: צבע תמונה A, w: ערבוב A
  varying vec4 vB;       // xyz: צבע תמונה B, w: ערבוב B
  varying vec3 vT;       // x: colorT A, y: colorT B, z: colorU

  void main() {
    if (aR < 0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // מחוץ למסך, לא מצויר
      return;
    }
    vR = aR;
    vA = vec4(aImgColor, aImgMix);
    vB = vec4(aImgColor2, aImgMix2);
    vT = vec3(aColorT, aColorT2, aColorU);
    vPx = position.xy * (aR + 1.0); // פיקסל רזרבה לצורך החלקת שוליים
    vec2 p = vec2(aX, aY) + vPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uPalette;
  uniform sampler2D uPalette2;
  uniform float uPixelRatio;

  varying vec2 vPx;
  varying float vR;
  varying vec4 vA;
  varying vec4 vB;
  varying vec3 vT;

  // sRGB <-> OKLab (Björn Ottosson). זהה ל src/render/oklab.js
  vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  vec3 toOklab(vec3 srgb) {
    vec3 c = toLinear(srgb);
    vec3 lms = vec3(
      0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
      0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
      0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
    lms = pow(max(lms, 0.0), vec3(1.0 / 3.0));
    return vec3(
      0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
      1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
      0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
  }
  vec3 fromOklab(vec3 lab) {
    vec3 lms = vec3(
      lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
      lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
      lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z);
    lms = lms * lms * lms;
    vec3 c = vec3(
      4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
      -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
      -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
    return clamp(toSrgb(clamp(c, 0.0, 1.0)), 0.0, 1.0);
  }
  // אינטרפולציה ב OKLCH, גוון בדרך הקצרה. לצבע כמעט אפור אין גוון: לוקחים את של השני.
  vec3 mixOklch(vec3 a, vec3 b, float u) {
    vec3 la = toOklab(a);
    vec3 lb = toOklab(b);
    float ca = length(la.yz);
    float cb = length(lb.yz);
    float ha = atan(la.z, la.y);
    float hb = atan(lb.z, lb.y);
    if (ca < 0.002) ha = hb;
    if (cb < 0.002) hb = ha;
    float dh = mod(hb - ha + 3.14159265, 6.28318531) - 3.14159265;
    float h = ha + dh * u;
    float c = mix(ca, cb, u);
    return fromOklab(vec3(mix(la.x, lb.x, u), c * cos(h), c * sin(h)));
  }

  void main() {
    float d = length(vPx);
    float alpha = clamp((vR - d) * uPixelRatio + 0.5, 0.0, 1.0);
    if (alpha <= 0.0) discard;
    vec3 colA = mix(texture2D(uPalette, vec2(vT.x, 0.5)).rgb, vA.xyz, vA.w);
    vec3 col = colA;
    if (vT.z > 0.0) {
      vec3 colB = mix(texture2D(uPalette2, vec2(vT.y, 0.5)).rgb, vB.xyz, vB.w);
      col = vT.z >= 1.0 ? colB : mixOklch(colA, colB, vT.z);
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createRenderer(canvas, particles) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);

  // מצלמה אורתוגרפית בפיקסלי CSS, ראשית בפינה השמאלית העליונה, y כלפי מטה
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
  const scene = new THREE.Scene();

  const quad = new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3);
  const index = [0, 1, 2, 0, 2, 3];

  const makeLut = () => {
    const data = new Uint8Array(LUT_SIZE * 4);
    const tex = new THREE.DataTexture(data, LUT_SIZE, 1, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    return { data, tex };
  };
  const pal1 = makeLut(); // פלטה A (או הפלטה היחידה בסצנה רגילה)
  const pal2 = makeLut(); // פלטה B, רק במעבר
  const lut = pal1.data;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uPalette: { value: pal1.tex },
      uPalette2: { value: pal2.tex },
      uPixelRatio: { value: pixelRatio },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide, // ציר y הפוך במצלמה הופך את כיוון המשולשים
  });

  const mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // מערכי הסימולציה עצמם משמשים כ buffers, בלי העתקה.
  // דינמיים: מתעדכנים בכל פריים. צבע: רק אחרי invalidateColors.
  let dynamicAttrs = [];
  let colorAttrs = [];
  let colorsDirty = true;

  /** בונה geometry חדשה מעל המערכים הנוכחיים. נקרא בהתחלה ואחרי גדילת המאגר. */
  function bind() {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', quad);
    geometry.setIndex(index);
    const attr = (arr, size) => new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage);
    const a = {
      aX: attr(particles.x, 1),
      aY: attr(particles.y, 1),
      aR: attr(particles.drawR, 1),
      aColorT: attr(particles.colorT, 1),
      aImgColor: attr(particles.imgColor, 3),
      aImgMix: attr(particles.imgMix, 1),
      aColorT2: attr(particles.colorT2, 1),
      aImgColor2: attr(particles.imgColor2, 3),
      aImgMix2: attr(particles.imgMix2, 1),
      aColorU: attr(particles.colorU, 1),
    };
    for (const [name, at] of Object.entries(a)) geometry.setAttribute(name, at);
    dynamicAttrs = [a.aX, a.aY, a.aR, a.aColorU];
    colorAttrs = [a.aColorT, a.aImgColor, a.aImgMix, a.aColorT2, a.aImgColor2, a.aImgMix2];
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    colorsDirty = true;
  }
  bind();

  function upload(attrs, n) {
    for (const at of attrs) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = true;
    }
  }

  function resize(width, height) {
    renderer.setSize(width, height);
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
  }

  function setPalette(stops, space = 'oklch') {
    buildPaletteLUT(stops, pal1.data, LUT_SIZE, space);
    pal1.tex.needsUpdate = true;
  }

  function setPalette2(stops, space = 'oklch') {
    buildPaletteLUT(stops, pal2.data, LUT_SIZE, space);
    pal2.tex.needsUpdate = true;
  }

  function setBackground(color) {
    renderer.setClearColor(color, 1);
    document.body.style.background = color;
  }

  function render() {
    const n = particles.active;
    mesh.geometry.instanceCount = n;
    if (n > 0) {
      upload(dynamicAttrs, n);
      if (colorsDirty) {
        upload(colorAttrs, n);
        colorsDirty = false;
      }
    }
    renderer.render(scene, camera);
  }

  /**
   * רינדור של המסגרת view לתוך render target בכפולת רזולוציה m, וקריאת הפיקסלים.
   * מחזיר RGBA לא מוכפל באלפא, בשורות מלמעלה למטה (מוכן ל ImageData).
   */
  function capture(view, m, transparent, background) {
    const w = Math.round(view.w * m);
    const h = Math.round(view.h * m);
    const max = renderer.capabilities.maxTextureSize;
    if (w > max || h > max) throw new Error(`${w}x${h} גדול מהמקסימום של כרטיס המסך (${max})`);
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    const cam = new THREE.OrthographicCamera(view.x0, view.x0 + view.w, view.y0, view.y0 + view.h, -1, 1);
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    try {
      const n = particles.active;
      mesh.geometry.instanceCount = n;
      upload(dynamicAttrs, n);
      upload(colorAttrs, n);
      material.uniforms.uPixelRatio.value = m;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(background, transparent ? 0 : 1);
      renderer.clear();
      renderer.render(scene, cam);
      const gl = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, gl);
      // היפוך שורות (GL מלמטה למעלה), וביטול ההכפלה באלפא שהמיזוג יצר מעל רקע שקוף
      const out = new Uint8ClampedArray(w * h * 4);
      for (let yy = 0; yy < h; yy++) {
        const src = (h - 1 - yy) * w * 4;
        const dst = yy * w * 4;
        for (let xx = 0; xx < w * 4; xx += 4) {
          const a = gl[src + xx + 3];
          const k = transparent && a > 0 ? 255 / a : 1;
          out[dst + xx] = gl[src + xx] * k;
          out[dst + xx + 1] = gl[src + xx + 1] * k;
          out[dst + xx + 2] = gl[src + xx + 2] * k;
          out[dst + xx + 3] = a;
        }
      }
      return { w, h, pixels: out };
    } finally {
      renderer.setRenderTarget(null);
      renderer.setClearColor(prevColor, prevAlpha);
      material.uniforms.uPixelRatio.value = pixelRatio;
      rt.dispose();
    }
  }

  return {
    resize,
    setPalette,
    setPalette2,
    setBackground,
    render,
    capture,
    lut, // טבלת הצבעים הנוכחית (RGBA, 256 ערכים), לייצוא SVG
    lut2: pal2.data, // פלטה B במעבר
    rebind: bind,
    invalidateColors: () => { colorsDirty = true; },
    three: renderer,
  };
}
