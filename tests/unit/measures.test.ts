import { describe, expect, it } from 'vitest';
import { buildMeasures } from '../../src/geom/measures';
import type { Derived } from '../../src/state/derived';
import { syntheticLandmarks } from './helpers';

/** Lo mínimo de `Derived` que usan las medidas. */
const fakeDerived = (yaw: number, keypoints: unknown[] = []) => ({ pose: { angles: { yaw, pitch: 0, roll: 0 } }, keypoints, metrics: [] }) as unknown as Derived;

describe('paso C · medidas en el plano de la foto', () => {
  it('de frente: ojos y boca horizontales, triángulo pupilas–boca', () => {
    const lm = syntheticLandmarks({ yaw: 0, pitch: 0, roll: 0 });
    const m = buildMeasures(lm, fakeDerived(0));
    const angle = (id: string) => Number(m.angles.find((a) => a.label.startsWith(id))!.label.match(/(-?\d+)°/)![1]);
    expect(angle('ojos')).toBe(0);
    expect(angle('boca')).toBe(0);
    expect(angle('nariz')).toBe(0);
    expect(m.triangle).toHaveLength(3);
    // La boca queda centrada bajo las pupilas.
    const [pr, pl, mouth] = m.triangle;
    expect(mouth.x).toBeCloseTo((pr.x + pl.x) / 2, 0);
    expect(mouth.y).toBeGreaterThan(pr.y);
    expect(m.plumbs).toHaveLength(6);
    expect(m.levels.map((l) => l.label)).toEqual(['ceja', 'nariz', 'boca']);
    expect(m.items).toHaveLength(9);
  });

  it('con la cabeza inclinada, los ángulos siguen la inclinación', () => {
    const lm = syntheticLandmarks({ yaw: 0, pitch: 0, roll: 10 });
    const m = buildMeasures(lm, fakeDerived(0));
    const angle = (id: string) => Number(m.angles.find((a) => a.label.startsWith(id))!.label.match(/(-?\d+)°/)![1]);
    expect(angle('ojos')).toBe(10);
    expect(angle('boca')).toBe(10);
    expect(angle('nariz')).toBe(10);
  });

  it('el lóbulo solo se mide si el usuario lo confirmó', () => {
    const lm = syntheticLandmarks({ yaw: 0, pitch: 0, roll: 0 });
    const lobe = (estimated: boolean) => [{ def: { id: 'earLobeL' }, p: { x: lm[2].x + 200, y: lm[2].y + 3 }, estimated, visible: true }];
    expect(buildMeasures(lm, fakeDerived(0, lobe(true))).levels).toHaveLength(3);
    const ok = buildMeasures(lm, fakeDerived(0, lobe(false)));
    expect(ok.levels.map((l) => l.label)).toContain('lóbulo');
    expect(ok.items.find((i) => i.id === 'lobe')!.text).toMatch(/altura/);
  });
});
