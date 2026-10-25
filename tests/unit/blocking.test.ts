import { describe, expect, it } from 'vitest';
import { blockingQuality, buildBlocking, douglasPeucker3 } from '../../src/geom/blocking';
import { BLOCK_LEVELS, closestToPlanes, fineTriangleRegions, FINE_REGIONS, fitPlane, levelPartition, meshTopology, MIRROR, MOUTH_HOLE } from '../../src/geom/planes';
import { v3, type Vec3 } from '../../src/geom/vec';
import { syntheticLandmarks } from './helpers';

describe('plano por PCA', () => {
  it('recupera un plano conocido con ruido pequeño', () => {
    const n = v3(1, 2, 2); // |n| = 3
    const pts: Vec3[] = [];
    for (let i = 0; i < 40; i++) {
      const u = (i % 8) - 4;
      const w = Math.floor(i / 8) - 2;
      // Dos direcciones dentro del plano n·x = 6.
      const base = v3(2 + u * 2, 0 + w, 2 - u - w);
      const noise = ((i * 37) % 7) / 700 - 0.004;
      pts.push(v3(base.x + (noise * n.x) / 3, base.y + (noise * n.y) / 3, base.z + (noise * n.z) / 3));
    }
    const p = fitPlane(pts, v3(1, 1, 1));
    expect(p.n.x).toBeCloseTo(1 / 3, 2);
    expect(p.n.y).toBeCloseTo(2 / 3, 2);
    expect(p.n.z).toBeCloseTo(2 / 3, 2);
    expect(p.d).toBeCloseTo(2, 1);
    expect(p.rms).toBeLessThan(0.01);
  });

  it('la normal apunta hacia afuera', () => {
    const pts = [v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0), v3(1, 1, 0)];
    expect(fitPlane(pts, v3(0, 0, -1)).n.z).toBeCloseTo(-1, 6);
    expect(fitPlane(pts, v3(0, 0, 1)).n.z).toBeCloseTo(1, 6);
  });
});

describe('intersección de planos', () => {
  const plane = (n: Vec3, d: number) => ({ n, d, centroid: v3(0, 0, 0), rms: 0 });
  it('tres planos bien condicionados: su intersección', () => {
    const p = closestToPlanes([plane(v3(1, 0, 0), 2), plane(v3(0, 1, 0), -1), plane(v3(0, 0, 1), 5)], v3(0, 0, 0), 1e-6);
    expect(p.x).toBeCloseTo(2, 4);
    expect(p.y).toBeCloseTo(-1, 4);
    expect(p.z).toBeCloseTo(5, 4);
  });
  it('dos planos: el punto de su recta más cercano', () => {
    const p = closestToPlanes([plane(v3(1, 0, 0), 2), plane(v3(0, 1, 0), 3)], v3(0, 0, 7), 1e-6);
    expect(p.x).toBeCloseTo(2, 4);
    expect(p.y).toBeCloseTo(3, 4);
    expect(p.z).toBeCloseTo(7, 4);
  });
  it('planos casi paralelos: no se dispara lejos del punto de partida', () => {
    const a = v3(0, 0, 1);
    const b = v3(Math.sin(0.001), 0, Math.cos(0.001));
    const p = closestToPlanes([plane(a, 0), plane(b, 0.01)], v3(0, 0, 0), 0.15);
    expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(1);
  });
});

describe('Douglas‑Peucker en 3D', () => {
  it('conserva extremos y esquinas, quita lo colineal', () => {
    const pts = [v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 0), v3(2, 1, 0), v3(2, 2, 1e-4), v3(2, 3, 0)];
    expect(douglasPeucker3(pts, 0.01)).toEqual([0, 2, 5]);
  });
  it('una línea recta queda en sus dos extremos', () => {
    const pts = Array.from({ length: 10 }, (_, i) => v3(i, 2 * i, -i));
    expect(douglasPeucker3(pts, 0.001)).toEqual([0, 9]);
  });
});

describe('regiones del blocking', () => {
  const fine = fineTriangleRegions();
  const { tris, adj } = meshTopology();

  it('cada triángulo tiene región (o es la abertura de la boca)', () => {
    expect([...fine].every((r) => r >= 0 || r === MOUTH_HOLE)).toBe(true);
    expect([...fine].filter((r) => r === MOUTH_HOLE).length).toBeGreaterThan(5);
  });

  it('cada región es una sola pieza y no está vacía', () => {
    FINE_REGIONS.forEach((_, r) => {
      const own = tris.map((_, t) => t).filter((t) => fine[t] === r);
      expect(own.length, FINE_REGIONS[r].id).toBeGreaterThan(0);
      const seen = new Set([own[0]]);
      const stack = [own[0]];
      while (stack.length) {
        const t = stack.pop()!;
        for (const u of adj[t]) if (fine[u] === r && !seen.has(u)) (seen.add(u), stack.push(u));
      }
      expect(seen.size, FINE_REGIONS[r].id).toBe(own.length);
    });
  });

  it('es simétrica: la región de un triángulo y la de su reflejo se corresponden', () => {
    const key = (t: readonly number[]) => [...t].sort((a, b) => a - b).join(',');
    const byKey = new Map(tris.map((t, i) => [key(t), i]));
    let checked = 0;
    tris.forEach((t, i) => {
      const m = byKey.get(key(t.map((v) => MIRROR[v])));
      if (m === undefined || fine[i] < 0) return;
      const a = FINE_REGIONS[fine[i]];
      const b = FINE_REGIONS[fine[m]];
      expect(a.base).toBe(b.base);
      checked++;
    });
    expect(checked).toBeGreaterThan(tris.length * 0.9);
  });

  it('tres niveles: ~12, ~30 tipos y ~50 polígonos', () => {
    const counts = Object.fromEntries(BLOCK_LEVELS.map((l) => [l, levelPartition(l).regions.length]));
    expect(counts.grande).toBeGreaterThanOrEqual(12);
    expect(counts.grande).toBeLessThanOrEqual(16);
    const medioTypes = new Set(levelPartition('medio').regions.map((r) => r.id.replace(/(R|L)$/, ''))).size;
    expect(medioTypes).toBeGreaterThanOrEqual(26);
    expect(medioTypes).toBeLessThanOrEqual(34);
    expect(counts.fino).toBeGreaterThanOrEqual(48);
  });
});

describe('poliedro', () => {
  for (const angles of [
    { yaw: 0, pitch: 0, roll: 0 },
    { yaw: 30, pitch: -10, roll: 5 },
    { yaw: -45, pitch: 8, roll: -6 },
  ]) {
    for (const level of BLOCK_LEVELS) {
      it(`${level}, pose ${JSON.stringify(angles)}: sin planos sueltos ni polígonos cruzados, en < 50 ms`, () => {
        const lm = syntheticLandmarks(angles, 18, 400, 500);
        const ipd = Math.hypot(lm[473].x - lm[468].x, lm[473].y - lm[468].y);
        buildBlocking(lm, level, ipd); // la primera vez arma la topología
        const b = buildBlocking(lm, level, ipd);
        const q = blockingQuality(b);
        expect(q.floating).toEqual([]);
        expect(q.selfIntersecting).toEqual([]);
        expect(b.ms).toBeLessThan(50);
        // Aristas compartidas: cada arista interna está en los polígonos de sus dos planos.
        const faceHas = (f: number, a: number, c: number) => {
          const vs = b.faces[f].verts;
          return vs.some((v, i) => (v === a && vs[(i + 1) % vs.length] === c) || (v === c && vs[(i + 1) % vs.length] === a));
        };
        for (const e of b.edges) {
          if (e.faces[1] < 0) continue;
          expect(faceHas(e.faces[0], e.a, e.b) && faceHas(e.faces[1], e.a, e.b)).toBe(true);
        }
      });
    }
  }

  it('de frente se ven los dos lados; girada, el lado lejano de la cara se esconde', () => {
    const front = buildBlocking(syntheticLandmarks({ yaw: 0, pitch: 0, roll: 0 }, 18, 400, 500), 'medio', 110);
    const turned = buildBlocking(syntheticLandmarks({ yaw: 60, pitch: 0, roll: 0 }, 18, 400, 500), 'medio', 110);
    const vis = (b: typeof front, id: string) => b.faces.find((f) => f.id === id)!.front;
    expect(vis(front, 'cheekboneR') && vis(front, 'cheekboneL')).toBe(true);
    // +giro: mira a la derecha de la foto; el lado izquierdo del sujeto queda lejos.
    expect(vis(turned, 'cheekboneR')).toBe(true);
    expect(vis(turned, 'cheekboneL')).toBe(false);
  });
});
