import { describe, expect, it } from 'vitest';
import { EAR_LOBE, EAR_TOP } from '../../src/detect/keypoints';
import { fitManual, MANUAL_POINTS, manualPointsFrom, manualReady, type Facing, type ManualView } from '../../src/geom/manualFit';
import { anglesFromRotation, rotationFromAngles, type PoseAngles } from '../../src/geom/pose';
import { apply3, v2, v3, type Vec2, type Vec3 } from '../../src/geom/vec';
import { syntheticLandmarks } from './helpers';

const SCALE = 20;
const CX = 400;
const CY = 500;

/** Puntos de una vista tomados de una cara sintética, más las orejas del lado cercano. */
function marks(angles: PoseAngles, view: ManualView, facing: Facing, shape?: (i: number, p: Vec3) => Vec3) {
  const lm = syntheticLandmarks(angles, SCALE, CX, CY, shape);
  const pts: Record<string, Vec2> = manualPointsFrom(lm, view, facing);
  if (view !== 'front') {
    const r = rotationFromAngles(angles);
    const near = facing === 'right' ? -1 : 1; // + giro deja al frente el lado derecho del sujeto (x < 0)
    const at = (p: Vec3) => {
      const k = apply3(r, v3(near * p.x, p.y, p.z));
      return v2(CX + k.x * SCALE, CY - k.y * SCALE);
    };
    pts.earTopN = at(EAR_TOP);
    pts.earLobeN = at(EAR_LOBE);
  }
  return { lm, pts };
}

/** Error medio de la malla (sin iris) en distancias entre pupilas (6.3 cm; de perfil la proyectada casi desaparece). */
function meshError(a: readonly Vec3[], b: readonly Vec3[]): number {
  const ipd = SCALE * 6.3;
  let s = 0;
  for (let i = 0; i < 468; i++) s += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return s / 468 / ipd;
}

describe('modo manual: ajuste de la malla canónica', () => {
  it('de frente recupera la pose y la malla', () => {
    const pose = { yaw: 6, pitch: -5, roll: 7 };
    const { lm, pts } = marks(pose, 'front', 'right');
    const f = fitManual('front', pts)!;
    const a = anglesFromRotation(f.frame.rotation);
    expect(Math.abs(a.yaw - pose.yaw)).toBeLessThan(2);
    expect(Math.abs(a.pitch - pose.pitch)).toBeLessThan(2);
    expect(Math.abs(a.roll - pose.roll)).toBeLessThan(2);
    expect(meshError(f.landmarks, lm)).toBeLessThan(0.02);
  });

  it('en ¾ detecta hacia dónde mira la cara', () => {
    for (const yaw of [40, -40]) {
      const facing: Facing = yaw > 0 ? 'right' : 'left';
      const { pts } = marks({ yaw, pitch: 4, roll: 0 }, 'threeQuarter', facing);
      const f = fitManual('threeQuarter', pts)!;
      expect(f.facing).toBe(facing);
      expect(Math.abs(anglesFromRotation(f.frame.rotation).yaw - yaw)).toBeLessThan(3);
    }
  });

  it('de perfil (giro 85°) recupera el giro y el lado', () => {
    for (const yaw of [85, -85]) {
      const facing: Facing = yaw > 0 ? 'right' : 'left';
      const pose = { yaw, pitch: 6, roll: -4 };
      const { lm, pts } = marks(pose, 'profile', facing);
      const f = fitManual('profile', pts)!;
      const a = anglesFromRotation(f.frame.rotation);
      expect(f.facing).toBe(facing);
      expect(Math.abs(a.yaw - yaw)).toBeLessThan(3);
      expect(Math.abs(a.pitch - pose.pitch)).toBeLessThan(3);
      expect(meshError(f.landmarks, lm)).toBeLessThan(0.03);
    }
  });

  it('una cara más larga que el canónico se ajusta con la escala vertical', () => {
    const longer = (_: number, p: Vec3) => v3(p.x, p.y * 1.1, p.z);
    const { lm, pts } = marks({ yaw: 80, pitch: 0, roll: 0 }, 'profile', 'right', longer);
    const f = fitManual('profile', pts)!;
    expect(f.axes.y / f.axes.z).toBeGreaterThan(1.05);
    expect(meshError(f.landmarks, lm)).toBeLessThan(0.04);
  });

  it('con puntos marcados a ojo (ruido), el giro de perfil queda dentro de ±10°', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const { pts } = marks({ yaw: -80, pitch: -8, roll: 3 }, 'profile', 'left');
    const sigma = 0.015 * 23 * SCALE; // 1.5 % del alto de la cabeza
    for (const k of Object.keys(pts)) pts[k] = v2(pts[k].x + rnd() * sigma, pts[k].y + rnd() * sigma);
    const f = fitManual('profile', pts)!;
    const a = anglesFromRotation(f.frame.rotation);
    expect(f.facing).toBe('left');
    expect(Math.abs(a.yaw + 80)).toBeLessThan(10);
    expect(Math.abs(a.pitch + 8)).toBeLessThan(10);
  });

  it('la malla pasa por los puntos marcados', () => {
    const { pts } = marks({ yaw: 30, pitch: 0, roll: 0 }, 'threeQuarter', 'right');
    pts.noseTip = v2(pts.noseTip.x + 6, pts.noseTip.y - 4);
    const f = fitManual('threeQuarter', pts)!;
    const tip = f.landmarks[4];
    expect(Math.hypot(tip.x - pts.noseTip.x, tip.y - pts.noseTip.y)).toBeLessThan(1);
  });

  it('de perfil, el trago y el ángulo de la mandíbula llevan el óvalo de la malla hasta ellos', () => {
    const { pts } = marks({ yaw: -85, pitch: 5, roll: 0 }, 'profile', 'left');
    // Ángulo de la mandíbula real, por detrás del óvalo de la malla (como en una foto).
    const ref = fitManual('profile', pts)!;
    const jaw = ref.landmarks[397];
    pts.gonionN = v2(jaw.x + 30, jaw.y + 10);
    const f = fitManual('profile', pts)!;
    expect(Math.hypot(f.landmarks[397].x - pts.gonionN.x, f.landmarks[397].y - pts.gonionN.y)).toBeLessThan(2);
    // Solo ancla el ajuste rígido con medio peso: el giro casi no cambia.
    expect(Math.abs(anglesFromRotation(f.frame.rotation).yaw - anglesFromRotation(ref.frame.rotation).yaw)).toBeLessThan(6);
  });

  it('pide puntos suficientes y fuera de la línea media', () => {
    const { pts } = marks({ yaw: 80, pitch: 0, roll: 0 }, 'profile', 'right');
    const midline = Object.fromEntries(['nasion', 'noseTip', 'subnasale', 'upperLip', 'lowerLip', 'menton'].map((k) => [k, pts[k]]));
    expect(manualReady(midline, 'profile')).toBe(false);
    expect(fitManual('profile', midline)).toBeNull();
    expect(manualReady({ ...midline, eyeOuterN: pts.eyeOuterN, mouthN: pts.mouthN }, 'profile')).toBe(true);
    expect(MANUAL_POINTS.profile.length).toBeGreaterThan(12);
  });
});
