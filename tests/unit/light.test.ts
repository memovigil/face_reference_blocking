import { describe, expect, it } from 'vitest';
import { buildBlocking } from '../../src/geom/blocking';
import { anglesFromLight, estimateLight, lightFrom, lightFromAngles, lightSpread, type LightSample } from '../../src/geom/light';
import { shadePlanes } from '../../src/geom/lightPlanes';
import { v3, type Vec3 } from '../../src/geom/vec';
import { syntheticLandmarks } from './helpers';

const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 180) / Math.PI;

/** Normales de una semiesfera que mira a la cámara (como los planos de una cara). */
function hemisphere(): Vec3[] {
  const out: Vec3[] = [];
  for (let t = 0; t < 360; t += 30) for (const p of [15, 35, 55, 75]) out.push(lightFromAngles(t, p));
  out.push(v3(0, 0, 1));
  return out;
}

describe('dirección de la luz', () => {
  it('θ y φ ida y vuelta', () => {
    for (const [t, p] of [
      [45, 55],
      [270, 80],
      [180, 30],
      [10, 110],
    ]) {
      const a = anglesFromLight(lightFromAngles(t, p));
      expect(a.theta).toBeCloseTo(t, 6);
      expect(a.phi).toBeCloseTo(p, 6);
    }
    // θ = 90°: desde la derecha de la foto (x > 0).
    expect(lightFromAngles(90, 60).x).toBeGreaterThan(0.8);
    expect(lightFrom(300)).toBe('desde arriba a la izquierda');
    expect(lightSpread(80)).toBe('lateral');
  });

  it('recupera la luz de un modelo lambertiano con ruido y una sombra proyectada', () => {
    for (const [t, p] of [
      [60, 50],
      [290, 70],
      [0, 35],
      [200, 60],
    ]) {
      const L = lightFromAngles(t, p);
      const samples: LightSample[] = hemisphere().map((n, i) => {
        const noise = (((i * 7919) % 13) / 13 - 0.5) * 0.02;
        return { n, I: 0.55 * Math.max(0, n.x * L.x + n.y * L.y + n.z * L.z) + 0.08 + noise, w: 1, id: `p${i}` };
      });
      // Un plano iluminado pero en sombra proyectada: el ajuste lo descarta.
      const lit = samples.findIndex((s) => s.n.x * L.x + s.n.y * L.y + s.n.z * L.z > 0.7);
      samples[lit] = { ...samples[lit], I: 0.09 };
      const e = estimateLight(samples)!;
      expect(angle(e.dir, L)).toBeLessThan(5);
      expect(e.confident).toBe(true);
      expect(e.rejected).toContain(samples[lit].id);
    }
  });

  it('luz plana: no hay dirección confiable', () => {
    const samples: LightSample[] = hemisphere().map((n, i) => ({ n, I: 0.5 + (((i * 31) % 7) / 7 - 0.5) * 0.02, w: 1, id: `p${i}` }));
    const e = estimateLight(samples);
    expect(e === null || !e.confident).toBe(true);
  });
});

describe('planos de luz', () => {
  const lm = syntheticLandmarks({ yaw: 0, pitch: 0, roll: 0 }, 18, 400, 500);
  const ipd = Math.hypot(lm[473].x - lm[468].x, lm[473].y - lm[468].y);
  const b = buildBlocking(lm, 'medio', ipd);

  it('con luz desde la derecha de la foto, la mejilla izquierda de la foto queda en sombra', () => {
    const sh = shadePlanes(b, lightFromAngles(90, 75), 0, ipd);
    const val = (id: string) => sh.faces.find((f) => f.id === id)!.value;
    // Derecha de la foto = lado izquierdo del sujeto (L).
    expect(val('cheekboneL')).toBe(2);
    expect(val('cheekboneR')).toBe(0);
  });

  it('sombras proyectadas: nariz sobre la mejilla, ceja sobre la órbita', () => {
    const frac = (L: Vec3, id: string) => shadePlanes(b, L, 0, ipd).faces.find((f) => f.id === id)!.castFraction;
    // Luz desde la derecha de la foto: la nariz ensombrece la mejilla del otro lado (R del sujeto).
    expect(frac(lightFromAngles(90, 55), 'cheekFrontR')).toBeGreaterThan(0.3);
    expect(frac(lightFromAngles(90, 55), 'cheekFrontL')).toBeLessThan(0.05);
    // Luz desde arriba: la ceja sobre el techo de la órbita.
    expect(frac(lightFromAngles(0, 45), 'orbitRoofR')).toBeGreaterThan(0.15);
    // Luz frontal: casi sin sombras proyectadas en las mejillas.
    expect(frac(lightFromAngles(0, 5), 'cheekFrontR')).toBeLessThan(0.05);
    expect(frac(lightFromAngles(0, 5), 'cheekFrontL')).toBeLessThan(0.05);
  });

  it('el terminador mueve la frontera entre luz y sombra', () => {
    const L = lightFromAngles(90, 60);
    const dark = (t: number) => shadePlanes(b, L, t, ipd).faces.filter((f) => f.value === 0).length;
    expect(dark(1)).toBeGreaterThan(dark(0));
    expect(dark(-1)).toBeLessThan(dark(0));
  });
});
