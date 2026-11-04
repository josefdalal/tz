import { shapes } from '../shapes/library.js';

// ערכי ברירת מחדל של סצנה. בשלב 4 יתווספו שמירה וטעינה של JSON.
export const defaultScene = {
  id: 'intro',
  seed: 42,
  maxCount: 5000,
  shape: { type: 'svgPath', d: shapes.square, fit: 'center', scale: 0.6, fillRule: 'nonzero' },
  radius: { min: 2, max: 12, sizeMode: 'edgeDistance', gap: 0.5, noiseScale: 0.006 },
  palette: { space: 'oklch', stops: ['#0b1d51', '#3a6ea5', '#ff6b6b'], mapBy: 'y' },
  motion: {
    speed: 1, // מכפיל כללי לכל מהירויות התנועה
    pulse: { amount: 8, speed: 0.4 }, // amount באחוזים מהרדיוס, speed במחזורים לשנייה
    wander: { range: 3, speed: 0.25 }, // range בפיקסלים, speed ביחידות זמן של noise לשנייה
    coherence: 0, // 0 כל עיגול לפי הפאזה שלו, 1 שדה noise משותף לפי מיקום
    fieldScale: 0.004, // סקאלת השדה המשותף (קטן יותר: אזורים גדולים יותר שזזים יחד)
    colorShift: 0.1, // שלב 3
  },
  physics: { stiffness: 0.08, damping: 0.88, collision: 1.0, mouseRadius: 80 },
  enter: { mode: 'fromCenter' },
  exit: { mode: 'disperse', strength: 1.0 },
  render: { mode: 'flat', lightDir: [-0.4, -0.6, 0.7], background: '#f3efe6' },
};

export const sizeModes = ['random', 'edgeDistance', 'noise'];
export const mapByModes = ['y', 'x', 'radius', 'edge', 'radial', 'random'];
