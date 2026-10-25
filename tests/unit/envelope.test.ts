import { describe, expect, it } from 'vitest';
import { SEG, type Segmentation } from '../../src/detect/segment';
import { circumscribe, edgeAngles, negativeSpaces, plumbLine, pointInPolygon, polygonArea, simplify } from '../../src/geom/envelope';
import { convexHull } from '../../src/geom/silhouette';
import { v2, type Vec2 } from '../../src/geom/vec';

const circle = (n: number, r = 100, cx = 200, cy = 200): Vec2[] =>
  Array.from({ length: n }, (_, i) => v2(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)));

/** Distancia con signo de p a la recta a→b (positiva a la izquierda). */
const side = (a: Vec2, b: Vec2, p: Vec2) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);

describe('envolvente con rectas', () => {
  for (const k of [7, 8, 9]) {
    it(`${k} lados que encierran la silueta y son tangentes a ella`, () => {
      const hull = circle(90);
      const poly = circumscribe(hull, k);
      expect(poly).toHaveLength(k);
      const area = polygonArea(poly);
      expect(area).toBeGreaterThan(0);
      for (let i = 0; i < k; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % k];
        // Toda la silueta queda del lado de adentro…
        for (const p of hull) expect(side(a, b, p)).toBeGreaterThan(-1e-6);
        // …y cada recta toca la silueta (es la prolongación de una de sus aristas).
        expect(Math.min(...hull.map((p) => Math.abs(side(a, b, p))))).toBeLessThan(1e-6);
      }
      // Poco más grande que el círculo (octágono regular circunscrito: 5.5 %).
      expect(area / (Math.PI * 100 * 100)).toBeLessThan(1.1);
    });
  }

  it('respeta la forma: un óvalo alto da un polígono alto', () => {
    const oval = circle(80).map((p) => v2(p.x, 200 + (p.y - 200) * 1.5));
    const poly = circumscribe(oval, 8);
    const w = Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x));
    const h = Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y));
    expect(h / w).toBeGreaterThan(1.35);
  });

  it('ángulos contra la plomada y plomada por la cima', () => {
    const sq = [v2(0, 0), v2(10, 0), v2(10, 20), v2(0, 20)];
    const e = edgeAngles(sq).map((x) => Math.round(x.fromVertical));
    expect(e).toEqual([90, 0, 90, 0]);
    const diag = edgeAngles([v2(0, 0), v2(10, 10), v2(0, 10)]);
    expect(diag[0].fromVertical).toBeCloseTo(45, 6);
    const pl = plumbLine(sq, v2(4, 0));
    expect(pl).toEqual({ top: v2(4, 0), bottom: v2(4, 20) });
  });

  it('punto en polígono', () => {
    const sq = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10)];
    expect(pointInPolygon(v2(5, 5), sq)).toBe(true);
    expect(pointInPolygon(v2(15, 5), sq)).toBe(false);
  });

  it('espacios negativos: el fondo dentro de la envolvente', () => {
    const W = 200;
    const mask = new Uint8Array(W * W).fill(SEG.hair);
    // Hueco de fondo de 40 × 30 px entre el cuello y el cabello.
    for (let y = 120; y < 150; y++) for (let x = 60; x < 100; x++) mask[y * W + x] = SEG.background;
    // Fondo fuera del polígono: no cuenta.
    for (let y = 0; y < 10; y++) for (let x = 0; x < W; x++) mask[y * W + x] = SEG.background;
    const seg: Segmentation = { width: W, height: W, mask, ms: 0 };
    const poly = [v2(20, 20), v2(180, 20), v2(180, 180), v2(20, 180)];
    const neg = negativeSpaces(seg, poly);
    expect(neg).toHaveLength(1);
    const xs = neg[0].map((p) => p.x);
    const ys = neg[0].map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(60, -0.5);
    expect(Math.max(...xs)).toBeCloseTo(100, -0.5);
    expect(Math.min(...ys)).toBeCloseTo(120, -0.5);
    expect(Math.max(...ys)).toBeCloseTo(150, -0.5);
    expect(neg[0].length).toBeLessThanOrEqual(8);
  });

  it('simplificar un contorno denso deja sus esquinas', () => {
    const pts: Vec2[] = [];
    for (let x = 0; x < 50; x++) pts.push(v2(x, 0));
    for (let y = 0; y < 30; y++) pts.push(v2(50, y));
    for (let x = 50; x > 0; x--) pts.push(v2(x, 30));
    for (let y = 30; y > 0; y--) pts.push(v2(0, y));
    const s = simplify(pts, 1);
    expect(s).toHaveLength(4);
    expect(Math.abs(polygonArea(s))).toBeCloseTo(1500, 6);
  });

  it('envolvente convexa', () => {
    const pts = [v2(0, 0), v2(10, 0), v2(10, 10), v2(0, 10), v2(5, 5), v2(2, 7), v2(5, 0)];
    const h = convexHull(pts);
    expect(h).toHaveLength(4);
    expect(Math.abs(polygonArea(h))).toBeCloseTo(100, 6);
  });
});
