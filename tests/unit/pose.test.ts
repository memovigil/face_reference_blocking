import { describe, expect, it } from 'vitest';
import { canonicalPoint } from '../../src/geom/canonical';
import {
  anglesFromRotation,
  checkPoseSign,
  estimatePose,
  fitScaleTranslation,
  fitSimilarity,
  fitSimilarity2D,
  parseTransformMatrix,
  projectCanonical,
  rotationDistance,
  rotationFromAngles,
  unprojectToCanonical,
  type PoseAngles,
} from '../../src/geom/pose';
import { apply3, col3, v3, type Mat3, type Vec3 } from '../../src/geom/vec';

const close = (a: PoseAngles, b: PoseAngles, tol = 1e-6) => {
  expect(a.yaw).toBeCloseTo(b.yaw, -Math.log10(tol));
  expect(a.pitch).toBeCloseTo(b.pitch, -Math.log10(tol));
  expect(a.roll).toBeCloseTo(b.roll, -Math.log10(tol));
};

/** Matriz 4×4 column-major como la entrega MediaPipe. */
function mediapipeMatrix(r: Mat3, t: Vec3, scale = 1): number[] {
  const m = new Array(16).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[j * 4 + i] = r[i * 3 + j] * scale;
  m[12] = t.x;
  m[13] = t.y;
  m[14] = t.z;
  m[15] = 1;
  return m;
}

/** Landmarks sintéticos: el canónico girado y proyectado (ortográfica) a px. */
function syntheticLandmarks(angles: PoseAngles, scale = 20, cx = 400, cy = 500): Vec3[] {
  const r = rotationFromAngles(angles);
  const out: Vec3[] = [];
  for (let i = 0; i < 478; i++) {
    const p = canonicalPoint(Math.min(i, 467));
    const k = apply3(r, p);
    out.push(v3(cx + k.x * scale, cy - k.y * scale, -k.z * scale));
  }
  // Pupilas: entre las esquinas de cada ojo.
  const pupil = (a: number, b: number) => {
    const pa = canonicalPoint(a);
    const pb = canonicalPoint(b);
    const k = apply3(r, v3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2 + 0.3));
    return v3(cx + k.x * scale, cy - k.y * scale, -k.z * scale);
  };
  out[468] = pupil(33, 133);
  out[473] = pupil(263, 362);
  return out;
}

describe('convención de ángulos', () => {
  it('ida y vuelta ángulos → rotación → ángulos', () => {
    for (const a of [
      { yaw: 0, pitch: 0, roll: 0 },
      { yaw: 35, pitch: 0, roll: 0 },
      { yaw: -40, pitch: 12, roll: -8 },
      { yaw: 60, pitch: -20, roll: 15 },
      { yaw: -75, pitch: 30, roll: 5 },
    ]) {
      close(anglesFromRotation(rotationFromAngles(a)), a);
    }
  });

  it('+giro = la cara mira hacia la derecha de la foto', () => {
    const f = col3(rotationFromAngles({ yaw: 30, pitch: 0, roll: 0 }), 2);
    expect(f.x).toBeGreaterThan(0); // +x de cámara = derecha de la foto
  });

  it('+cabeceo = la cara mira hacia abajo', () => {
    const f = col3(rotationFromAngles({ yaw: 0, pitch: 20, roll: 0 }), 2);
    expect(f.y).toBeLessThan(0); // +y de cámara = arriba
  });

  it('+inclinación = la cima se va a la derecha de la foto', () => {
    const up = col3(rotationFromAngles({ yaw: 0, pitch: 0, roll: 15 }), 1);
    expect(up.x).toBeGreaterThan(0);
  });
});

describe('parseTransformMatrix', () => {
  it('lee column-major con escala y recupera la rotación', () => {
    const a = { yaw: -32, pitch: 8, roll: 4 };
    const r = rotationFromAngles(a);
    const p = parseTransformMatrix(mediapipeMatrix(r, v3(1, -2, -45), 1.07));
    expect(p.layout).toBe('column-major');
    expect(p.scale).toBeCloseTo(1.07, 5);
    expect(rotationDistance(p.rotation, r)).toBeLessThan(1e-6);
    close(anglesFromRotation(p.rotation), a, 1e-4);
  });

  it('lee row-major si la traslación está en la última columna', () => {
    const r = rotationFromAngles({ yaw: 20, pitch: 0, roll: 0 });
    const m = new Array(16).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 4 + j] = r[i * 3 + j];
    m[3] = 0.5;
    m[7] = 1;
    m[11] = -50;
    m[15] = 1;
    const p = parseTransformMatrix(m);
    expect(p.layout).toBe('row-major');
    expect(p.translation.z).toBe(-50);
    expect(rotationDistance(p.rotation, r)).toBeLessThan(1e-6);
  });
});

describe('ajuste de semejanza a la malla', () => {
  it('recupera giro, escala y traslación de landmarks sintéticos', () => {
    for (const a of [
      { yaw: 0, pitch: 0, roll: 0 },
      { yaw: -35, pitch: 5, roll: 3 },
      { yaw: 50, pitch: -10, roll: -12 },
    ]) {
      const lm = syntheticLandmarks(a, 18);
      for (const fit of [fitSimilarity(lm), fitSimilarity2D(lm)]) {
        close(anglesFromRotation(fit.rotation), a, 1e-3);
        expect(fit.scale).toBeCloseTo(18, 3);
        expect(fit.rms).toBeLessThan(1e-3);
      }
      const fit = fitSimilarity2D(lm);
      // proyectar y desproyectar es la identidad
      const p = canonicalPoint(4);
      const q = unprojectToCanonical(fit, projectCanonical(fit, p));
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
      expect(q.z).toBeCloseTo(p.z, 6);
    }
  });
});

describe('ajuste ortográfico', () => {
  it('no depende de la z del detector (z aplanada al 70 %)', () => {
    const a = { yaw: 40, pitch: -8, roll: 4 };
    const lm = syntheticLandmarks(a, 15).map((p) => v3(p.x, p.y, p.z * 0.7));
    close(anglesFromRotation(fitSimilarity2D(lm).rotation), a, 1e-2);
    // El 3D sí se sesga hacia ángulos chicos.
    expect(Math.abs(anglesFromRotation(fitSimilarity(lm).rotation).yaw)).toBeLessThan(38);
  });

  it('con la rotación fija recupera escala y traslación', () => {
    const a = { yaw: -20, pitch: 5, roll: 0 };
    const lm = syntheticLandmarks(a, 12, 300, 200);
    const fit = fitScaleTranslation(lm, rotationFromAngles(a));
    expect(fit.scale).toBeCloseTo(12, 4);
    const p = projectCanonical(fit, canonicalPoint(4));
    expect(p.x).toBeCloseTo(lm[4].x, 3);
    expect(p.y).toBeCloseTo(lm[4].y, 3);
  });
});

describe('comprobación geométrica del signo', () => {
  it('¾ hacia la izquierda de la foto: giro negativo y nariz a la izquierda', () => {
    const lm = syntheticLandmarks({ yaw: -35, pitch: 0, roll: 0 });
    const s = checkPoseSign(lm, -35);
    expect(s.noseOffset).toBeLessThan(0);
    expect(s.consistent).toBe(true);
    expect(s.predictedYaw).toBeLessThan(-25);
    expect(s.predictedYaw).toBeGreaterThan(-45);
  });

  it('detecta un signo contradictorio', () => {
    const lm = syntheticLandmarks({ yaw: 30, pitch: 0, roll: 0 });
    expect(checkPoseSign(lm, 30).consistent).toBe(true);
    expect(checkPoseSign(lm, -30).consistent).toBe(false);
  });

  it('estimatePose: pose de la malla, matriz como verificación, ajuste fino', () => {
    const a = { yaw: -28, pitch: 6, roll: 2 };
    const lm = syntheticLandmarks(a);
    // Matriz sesgada 8° en giro (como con una cara fuera del centro).
    const matrix = mediapipeMatrix(rotationFromAngles({ ...a, yaw: a.yaw + 8 }), v3(20, 0, -50));
    const est = estimatePose({ landmarks: lm, detectedLandmarks: lm, matrix, adjust: { yaw: 0, pitch: 0, roll: 0 } });
    close(est.angles, a, 1e-3);
    expect(est.agreement!).toBeCloseTo(8, 1);
    expect(est.matrixAngles!.yaw).toBeCloseTo(-20, 3);
    const adj = estimatePose({ landmarks: lm, detectedLandmarks: lm, matrix, adjust: { yaw: 5, pitch: -2, roll: 1 } });
    expect(adj.angles.yaw).toBeCloseTo(-23, 3);
    expect(adj.angles.pitch).toBeCloseTo(4, 3);
  });
});
