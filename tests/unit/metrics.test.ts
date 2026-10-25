import { describe, expect, it } from 'vitest';
import { canonicalPoint } from '../../src/geom/canonical';
import { centerOfEye, toFrontal } from '../../src/geom/frontal';
import { computeMetrics, mostDistinctive, nearSide, type ExpressionFlags } from '../../src/geom/metrics';
import { fitSimilarity2D } from '../../src/geom/pose';
import { v3 } from '../../src/geom/vec';
import { syntheticLandmarks } from './helpers';

const NEUTRAL: ExpressionFlags = { smile: false, jawOpen: false, eyesClosed: false, pucker: false, lipsO: false };

describe('marco de frente', () => {
  for (const method of ['detector3d', 'rayPlane'] as const) {
    it(`${method}: recupera el canónico con cualquier pose`, () => {
      for (const a of [
        { yaw: 0, pitch: 0, roll: 0 },
        { yaw: -40, pitch: 10, roll: 5 },
        { yaw: 55, pitch: -15, roll: -10 },
      ]) {
        const lm = syntheticLandmarks(a, 17, 300, 420);
        const face = toFrontal(lm, fitSimilarity2D(lm), method);
        for (const i of [1, 33, 133, 152, 234, 291]) {
          const c = canonicalPoint(i);
          expect(face.points[i].x).toBeCloseTo(c.x, 2);
          expect(face.points[i].y).toBeCloseTo(c.y, 2);
        }
        const r = centerOfEye(face.points, 'R');
        const l = centerOfEye(face.points, 'L');
        expect(face.unit).toBeCloseTo(Math.hypot(l.x - r.x, l.y - r.y), 6);
      }
    });
  }
});

describe('métricas', () => {
  it('no cambian con el giro (invariancia exacta con landmarks sintéticos)', () => {
    // Una cara "distinta": nariz 15 % más ancha y boca más baja.
    const shape = (i: number, p: ReturnType<typeof canonicalPoint>) => {
      const nose = [129, 102, 64, 48, 49, 98, 219, 358, 331, 294, 278, 279, 327, 439];
      if (nose.includes(i)) return v3(p.x * 1.15, p.y, p.z);
      if (p.y < -3 && p.y > -6 && Math.abs(p.x) < 3.5) return v3(p.x, p.y - 0.3, p.z);
      return p;
    };
    const ref = computeMetrics({ face: toFrontal(syntheticLandmarks({ yaw: 0, pitch: 0, roll: 0 }, 20, 400, 500, shape), fitSimilarity2D(syntheticLandmarks({ yaw: 0, pitch: 0, roll: 0 }, 20, 400, 500, shape))), yaw: 0, expression: NEUTRAL });
    for (const a of [{ yaw: -35, pitch: 8, roll: 3 }, { yaw: 28, pitch: -12, roll: -6 }]) {
      const lm = syntheticLandmarks(a, 15, 350, 450, shape);
      const fit = fitSimilarity2D(lm);
      const vals = computeMetrics({ face: toFrontal(lm, fit), yaw: a.yaw, expression: NEUTRAL });
      for (const id of ['noseWidth', 'mouthWidth', 'mouthNoseChin', 'middleOverLower']) {
        const v = vals.find((x) => x.def.id === id)!.value;
        const r = ref.find((x) => x.def.id === id)!.value;
        expect(Math.abs(v - r) / r, id).toBeLessThan(0.01);
      }
    }
  });

  it('la sonrisa invalida el ancho de boca y la cara distinta sale entre las distintivas', () => {
    const shape = (i: number, p: ReturnType<typeof canonicalPoint>) =>
      [129, 102, 64, 48, 49, 98, 219, 358, 331, 294, 278, 279, 327, 439].includes(i) ? v3(p.x * 1.3, p.y, p.z) : p;
    const lm = syntheticLandmarks({ yaw: 0, pitch: 0, roll: 0 }, 20, 400, 500, shape);
    const vals = computeMetrics({ face: toFrontal(lm, fitSimilarity2D(lm)), yaw: 0, expression: { ...NEUTRAL, smile: true } });
    expect(vals.find((v) => v.def.id === 'mouthWidth')!.reliable).toBe(false);
    expect(mostDistinctive(vals).map((v) => v.def.id)).toContain('noseWidth');
    expect(mostDistinctive(vals).every((v) => v.reliable)).toBe(true);
  });

  it('lado cercano: con giro negativo se ve la mejilla izquierda del sujeto', () => {
    expect(nearSide(-30)).toBe('L');
    expect(nearSide(30)).toBe('R');
    expect(nearSide(5)).toBe('both');
  });
});
