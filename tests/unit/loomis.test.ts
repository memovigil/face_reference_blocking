import { describe, expect, it } from 'vitest';
import { canonicalPoint } from '../../src/geom/canonical';
import { toFrontal } from '../../src/geom/frontal';
import { fitSphere, isoLine, measureLevels, type LoomisInputs } from '../../src/geom/loomis';
import { fitSimilarity2D, projectCanonical, type PoseAngles } from '../../src/geom/pose';
import { v2, v3 } from '../../src/geom/vec';
import { syntheticLandmarks } from './helpers';

describe('anillos de Loomis (isolíneas sobre la malla)', () => {
  it('de frente, el anillo de la nariz es horizontal y cruza la cara', () => {
    const scale = 20;
    const cy = 500;
    const lm = syntheticLandmarks({ yaw: 0, pitch: 0, roll: 0 }, scale, 400, cy);
    const level = canonicalPoint(2).y;
    const lines = isoLine(lm, (i) => canonicalPoint(i).y, level);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) for (const p of l) expect(p.y).toBeCloseTo(cy - level * scale, 6);
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
    const span = Math.max(...longest.map((p) => p.x)) - Math.min(...longest.map((p) => p.x));
    const faceW = lm[454].x - lm[234].x;
    expect(span / faceW).toBeGreaterThan(0.7);
  });

  it('con la cabeza inclinada, el anillo se inclina con ella', () => {
    const lm = syntheticLandmarks({ yaw: 0, pitch: 0, roll: 12 }, 20, 400, 500);
    const lines = isoLine(lm, (i) => canonicalPoint(i).y, canonicalPoint(2).y);
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
    const a = longest[0];
    const b = longest[longest.length - 1];
    const [l, r] = a.x < b.x ? [a, b] : [b, a];
    // +roll: la parte de arriba de la cabeza va hacia la derecha de la foto,
    // así que la línea baja hacia la izquierda.
    const ang = (Math.atan2(l.y - r.y, r.x - l.x) * 180) / Math.PI;
    expect(ang).toBeCloseTo(-12, 0);
  });
});

describe('esfera del cráneo', () => {
  // Una esfera "verdadera" en el marco canónico; su contorno en la foto es un
  // círculo de radio s·r alrededor de la proyección del centro.
  const C = v3(0, 2.6, -3.4);
  const R = 8.2;
  const fit = (angles: PoseAngles) => {
    const lm = syntheticLandmarks(angles, 18, 420, 520);
    const frame = fitSimilarity2D(lm);
    const face = toFrontal(lm, frame);
    const c2 = projectCanonical(frame, C);
    const silhouette = [];
    // Arco de la cima: de 25° a 155° (y hacia arriba en la foto).
    for (let a = 25; a <= 155; a += 10) {
      const t = (a * Math.PI) / 180;
      silhouette.push({ p: v2(c2.x + frame.scale * R * Math.cos(t), c2.y - frame.scale * R * Math.sin(t)), weight: 1 });
    }
    const inp = { frame, landmarks: lm, face, faceAsSeen: face, silhouette, hairline: null, ears: [], yaw: angles.yaw } as LoomisInputs;
    const hairY = face.points[10].y + 1.5;
    return fitSphere(inp, measureLevels(face, hairY));
  };

  it('el centro queda en la línea media y el contorno pasa por la silueta', () => {
    const s = fit({ yaw: 0, pitch: 0, roll: 0 });
    expect(s.center.x).toBe(0);
    // El radio lo fija sobre todo la silueta de la cima.
    expect(Math.abs(s.radius - R)).toBeLessThan(0.6);
    expect(s.rms).toBeLessThan(1);
  });

  it('con la cabeza girada, la silueta también fija la profundidad del centro', () => {
    // De frente, el contorno no dice nada de z (lo fijan la frente y las
    // sienes); girada, sí: el ajuste se acerca a la esfera verdadera.
    for (const a of [
      { yaw: 35, pitch: 0, roll: 0 },
      { yaw: -30, pitch: 10, roll: 6 },
      { yaw: 25, pitch: -12, roll: -8 },
    ]) {
      const s = fit(a);
      expect(Math.abs(s.radius - R)).toBeLessThan(0.6);
      expect(Math.abs(s.center.y - C.y)).toBeLessThan(0.6);
      expect(Math.abs(s.center.z - C.z)).toBeLessThan(0.8);
    }
  });
});
