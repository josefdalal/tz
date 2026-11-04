import * as THREE from 'three';
import { buildPaletteLUT } from './palette.js';

const LUT_SIZE = 256;

const vertexShader = /* glsl */ `
  attribute float aX;
  attribute float aY;
  attribute float aR;
  attribute float aColorT;

  varying vec2 vPx;      // היסט מהמרכז בפיקסלי CSS
  varying float vR;
  varying float vColorT;

  void main() {
    if (aR < 0.01) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // מחוץ למסך, לא מצויר
      return;
    }
    vR = aR;
    vColorT = aColorT;
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

  void main() {
    float d = length(vPx);
    float alpha = clamp((vR - d) * uPixelRatio + 0.5, 0.0, 1.0);
    if (alpha <= 0.0) discard;
    vec3 col = texture2D(uPalette, vec2(vColorT, 0.5)).rgb;
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

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  // מערכי הסימולציה עצמם משמשים כ buffers, בלי העתקה
  const dyn = (arr) => new THREE.InstancedBufferAttribute(arr, 1).setUsage(THREE.DynamicDrawUsage);
  const attrs = {
    aX: dyn(particles.x),
    aY: dyn(particles.y),
    aR: dyn(particles.r),
    aColorT: dyn(particles.colorT),
  };
  for (const [name, a] of Object.entries(attrs)) geometry.setAttribute(name, a);
  geometry.instanceCount = particles.capacity;

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

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

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
    attrs.aX.needsUpdate = true;
    attrs.aY.needsUpdate = true;
    attrs.aR.needsUpdate = true;
    attrs.aColorT.needsUpdate = true;
    renderer.render(scene, camera);
  }

  return { resize, setPalette, setBackground, render, three: renderer };
}
