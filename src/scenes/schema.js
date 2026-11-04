import { shapes } from '../shapes/library.js';

// ערכי ברירת מחדל של סצנה. בשלב 4 יתווספו שמירה וטעינה של JSON.
export const defaultScene = {
  id: 'intro',
  seed: 42,
  maxCount: 5000,
  shape: { type: 'svgPath', d: shapes.square, fit: 'center', scale: 0.6, fillRule: 'nonzero' },
  radius: { min: 2, max: 12, sizeMode: 'edgeDistance', gap: 0.5, noiseScale: 0.006 },
  palette: { space: 'oklch', stops: ['#0b1d51', '#3a6ea5', '#ff6b6b'], mapBy: 'y' },
  motion: { wander: 1.5, speed: 0.3, colorShift: 0.1 },
  physics: { stiffness: 0.08, damping: 0.88, collision: 1.0, mouseRadius: 80 },
  enter: { mode: 'fromCenter' },
  exit: { mode: 'disperse', strength: 1.0 },
  render: { mode: 'flat', lightDir: [-0.4, -0.6, 0.7], background: '#f3efe6' },
};

export const sizeModes = ['random', 'edgeDistance', 'noise'];
export const mapByModes = ['y', 'x', 'radius', 'edge', 'radial', 'random'];
