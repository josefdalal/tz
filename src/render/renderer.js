import * as THREE from 'three';
import { buildPaletteLUT } from './palette.js';

const LUT_SIZE = 256;

const vertexShader = /* glsl */ `
  attribute float aX;
  attribute float aY;
  attribute float aR;
  attribute float aColorT;
  attribute vec3 aImgColor;
  attribute float aImgMix;

  varying vec2 vPx;      // היסט מהמרכז בפיקסלי CSS
  varying float vR;
  varying float vColorT;
  varying vec3 vImgColor;
  varying float vImgMix;

  void main() {
    if (aR < 0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // מחוץ למסך, לא מצויר
      return;
    }
    vR = aR;
    vColorT = aColorT;
    vImgColor = aImgColor;
    vImgMix = aImgMix;
    vPx = position.xy * (aR + 1.0); // פיקסל רזרבה לצורך החלקת שוליים
    vec2 p = vec2(aX, aY) + vPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uPalette;
  uniform float uPixelRatio;

  varying vec2 vPx;
  varying float vR;
  varying float vColorT;
  varying vec3 vImgColor;
  varying float vImgMix;

  void main() {
    float d = length(vPx);
    float alpha = clamp((vR - d) * uPixelRatio + 0.5, 0.0, 1.0);
    if (alpha <= 0.0) discard;
    vec3 col = texture2D(uPalette, vec2(vColorT, 0.5)).rgb;
    col = mix(col, vImgColor, vImgMix);
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

  const lut = new Uint8Array(LUT_SIZE * 4);
  const paletteTex = new THREE.DataTexture(lut, LUT_SIZE, 1, THREE.RGBAFormat);
  paletteTex.magFilter = THREE.LinearFilter;
  paletteTex.minFilter = THREE.LinearFilter;
  paletteTex.wrapS = THREE.ClampToEdgeWrapping;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uPalette: { value: paletteTex },
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
    };
    for (const [name, at] of Object.entries(a)) geometry.setAttribute(name, at);
    dynamicAttrs = [a.aX, a.aY, a.aR];
    colorAttrs = [a.aColorT, a.aImgColor, a.aImgMix];
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
    buildPaletteLUT(stops, lut, LUT_SIZE, space);
    paletteTex.needsUpdate = true;
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
    setBackground,
    render,
    capture,
    lut, // טבלת הצבעים הנוכחית (RGBA, 256 ערכים), לייצוא SVG
    rebind: bind,
    invalidateColors: () => { colorsDirty = true; },
    three: renderer,
  };
}
