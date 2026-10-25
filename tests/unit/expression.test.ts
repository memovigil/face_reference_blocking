import { describe, expect, it } from 'vitest';
import { canonicalPoint } from '../../src/geom/canonical';
import { closeJaw, MANDIBLE, readExpression } from '../../src/geom/expression';
import { v3, type Vec3 } from '../../src/geom/vec';

const base: Vec3[] = Array.from({ length: 478 }, (_, i) => canonicalPoint(Math.min(i, 467)));

function openJaw(points: Vec3[], deg: number): Vec3[] {
  const tr = points[234];
  const tl = points[454];
  const hy = (tr.y + tl.y) / 2 - 0.5;
  const hz = (tr.z + tl.z) / 2 - 0.5;
  const t = (-deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const set = new Set(MANDIBLE);
  return points.map((p, i) => (set.has(i) ? v3(p.x, hy + (p.z - hz) * s + (p.y - hy) * c, hz + (p.z - hz) * c - (p.y - hy) * s) : p));
}

describe('mentón cerrado', () => {
  it('cerrar después de abrir lleva al mismo punto (acercamiento máximo de los labios)', () => {
    const closed = closeJaw(base, 6.3)!;
    expect(closed).not.toBeNull();
    const a = closed.points;
    // Queda solo la diferencia de distancia a la bisagra (≈0.42 cm en el canónico).
    const hy = (base[234].y + base[454].y) / 2 - 0.5;
    const hz = (base[234].z + base[454].z) / 2 - 0.5;
    const radial = Math.abs(Math.hypot(base[14].y - hy, base[14].z - hz) - Math.hypot(base[13].y - hy, base[13].z - hz));
    expect(Math.hypot(a[13].y - a[14].y, a[13].z - a[14].z)).toBeCloseTo(radial, 3);
    const reopened = openJaw(a, 15);
    const again = closeJaw(reopened, 6.3)!;
    expect(again.angle).toBeCloseTo(15, 0);
    expect(again.points[152].y).toBeCloseTo(a[152].y, 1);
  });

  it('con los labios juntos no hace nada', () => {
    const closed = closeJaw(base, 6.3)!.points;
    expect(closeJaw(closed, 6.3)).toBeNull();
  });

  it('la mandíbula incluye mentón y labio inferior, no el labio superior ni la nariz', () => {
    for (const i of [152, 17, 14, 172, 397]) expect(MANDIBLE).toContain(i);
    for (const i of [13, 0, 1, 2, 61, 291]) expect(MANDIBLE).not.toContain(i);
  });
});

describe('expresiones', () => {
  it('umbrales e ignorar', () => {
    const r = readExpression({ jawOpen: 0.6, mouthSmileLeft: 0.7, mouthSmileRight: 0.5, eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 }, { smile: true });
    expect(r.detected).toMatchObject({ jawOpen: true, smile: true, eyesClosed: false });
    expect(r.flags.smile).toBe(false);
    expect(r.flags.jawOpen).toBe(true);
  });

  it('boca en «O»: abertura de labios', () => {
    expect(readExpression({ jawOpen: 0.4, mouthFunnel: 0.4, mouthPucker: 0.5 }, {}).flags.lipsO).toBe(true);
    expect(readExpression({ jawOpen: 0.4, mouthFunnel: 0.05, mouthPucker: 0.1 }, {}).flags.lipsO).toBe(false);
  });
});
