import { createParticles, scatter, assignHomes, POOL_SIZE } from './sim/particles.js';
import { relax } from './sim/physics.js';
import { sampleScene } from './shapes/sampler.js';
import { defaultScene } from './scenes/schema.js';
import { createRenderer } from './render/renderer.js';
import { createGui } from './ui/gui.js';
import { mulberry32 } from './util/rng.js';

const canvas = document.getElementById('stage');
const scene = structuredClone(defaultScene);
const particles = createParticles(POOL_SIZE);
const renderer = createRenderer(canvas, particles);
const stats = { count: 0, sampleMs: 0, fps: 0 };

let width = window.innerWidth;
let height = window.innerHeight;
renderer.resize(width, height);
scatter(particles, mulberry32(scene.seed + 1), width, height);

let needsResample = true;
const requestResample = () => { needsResample = true; };

function resample() {
  const samples = sampleScene(scene, width, height);
  stats.count = assignHomes(particles, samples);
  stats.sampleMs = Math.round(samples.ms);
}

renderer.setPalette(scene.palette.stops, scene.palette.space);
renderer.setBackground(scene.render.background);

createGui(scene, stats, {
  onResample: requestResample,
  onPalette: () => renderer.setPalette(scene.palette.stops, scene.palette.space),
  onBackground: () => renderer.setBackground(scene.render.background),
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.resize(width, height);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(requestResample, 150);
});

let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (needsResample) {
    needsResample = false;
    resample();
  }

  relax(particles, dt);
  renderer.render();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    stats.fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
