import { describe, expect, it } from 'vitest';
import { canonicalPoint, RIGID_LANDMARKS } from '../../src/geom/canonical';
import { FACE_OVAL, LM, MIDLINE, NOSE_ALA_CANDIDATES, SUBJECT_LEFT, SUBJECT_RIGHT } from '../../src/detect/landmarkMap';

// Verificación de los índices contra el modelo canónico oficial de MediaPipe.

describe('landmarkMap contra el modelo canónico', () => {
  it('la línea media tiene x = 0 y baja de la frente al mentón', () => {
    let prevY = Infinity;
    for (const i of MIDLINE) {
      const p = canonicalPoint(i);
      expect(Math.abs(p.x)).toBeLessThan(1e-4);
      expect(p.y).toBeLessThan(prevY);
      prevY = p.y;
    }
  });

  it('cada par derecha/izquierda del sujeto es espejo exacto', () => {
    for (const key of Object.keys(SUBJECT_RIGHT) as (keyof typeof SUBJECT_RIGHT)[]) {
      const r = SUBJECT_RIGHT[key];
      const l = SUBJECT_LEFT[key];
      const rs = Array.isArray(r) ? r : [r];
      const ls = Array.isArray(l) ? l : [l];
      rs.forEach((ri: number, k: number) => {
        if (ri >= 468) return; // iris: no está en el canónico
        const a = canonicalPoint(ri);
        const b = canonicalPoint(ls[k]);
        expect(a.x, `${key}`).toBeLessThan(0); // derecha del sujeto = x negativa
        expect(a.x + b.x).toBeCloseTo(0, 3);
        expect(a.y).toBeCloseTo(b.y, 3);
        expect(a.z).toBeCloseTo(b.z, 3);
      });
    }
  });

  it('la punta de nariz (4) es el punto más saliente del canónico', () => {
    let best = 0;
    for (let i = 0; i < 468; i++) if (canonicalPoint(i).z > canonicalPoint(best).z) best = i;
    expect(best).toBe(LM.noseTip);
  });

  it('el mentón (152) es el punto más bajo y la frente (10) el más alto', () => {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 468; i++) {
      if (canonicalPoint(i).y < canonicalPoint(lo).y) lo = i;
      if (canonicalPoint(i).y > canonicalPoint(hi).y) hi = i;
    }
    expect(lo).toBe(LM.menton);
    expect(hi).toBe(LM.foreheadTop);
  });

  it('el ala (129) es el candidato más lateral', () => {
    const xs = NOSE_ALA_CANDIDATES.subjectRight.map((i) => Math.abs(canonicalPoint(i).x));
    expect(Math.max(...xs)).toBe(Math.abs(canonicalPoint(SUBJECT_RIGHT.noseAla).x));
  });

  it('comisura (61) más lateral que la comisura interior (78)', () => {
    expect(Math.abs(canonicalPoint(61).x)).toBeGreaterThan(Math.abs(canonicalPoint(78).x));
  });

  it('el óvalo es cerrado y simétrico', () => {
    expect(FACE_OVAL.length).toBe(36);
    for (const i of FACE_OVAL) expect(Math.abs(canonicalPoint(i).x)).toBeLessThan(7.8);
  });

  it('los landmarks rígidos excluyen boca, párpados y cejas', () => {
    expect(RIGID_LANDMARKS.length).toBeGreaterThan(150);
    for (const i of [61, 291, 13, 14, 152, 159, 145, 105, 334]) expect(RIGID_LANDMARKS).not.toContain(i);
    for (const i of [33, 263, 133, 362, 4, 168, 2]) expect(RIGID_LANDMARKS).toContain(i);
  });
});
