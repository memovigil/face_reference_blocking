// Paso E · Planos de luz: el mismo poliedro del blocking (cara y cráneo), cada
// plano en luz, medio tono o sombra según n · L, más sombras proyectadas simples
// (nariz sobre la mejilla, ceja sobre la órbita).
//
// Sombras proyectadas por plano: para cada plano iluminado (receptor), cada
// otro plano que queda del lado de la luz se proyecta sobre él a lo largo de L;
// lo que cae dentro del receptor está en sombra (el dibujo recorta con el
// polígono del receptor).

import type { Blocking } from './blocking';
import { v2, v3, type Vec2, type Vec3 } from './vec';

export type ShadeValue = 0 | 1 | 2;

export interface ShadedFace {
  id: string;
  name: string;
  /** Polígono en px de la foto. */
  poly: Vec2[];
  value: ShadeValue;
  /** n · L (marco de cámara). */
  ndl: number;
  /** Profundidad media (px, más grande = más lejos): se dibuja de atrás hacia adelante. */
  depth: number;
  /** Sombras proyectadas sobre este plano (px de la foto; se recortan con `poly`). */
  cast: Vec2[][];
  /** Fracción del plano en sombra proyectada (0–1). */
  castFraction: number;
}

export interface ShadedPlanes {
  faces: ShadedFace[];
  /** Umbrales de n · L: sombra ≤ t0 < medio tono ≤ t1 < luz. */
  t0: number;
  t1: number;
}

interface Poly3 {
  id: string;
  name: string;
  pts: Vec3[];
  n: Vec3;
  d: number;
  front: boolean;
  /** Puede recibir y proyectar sombra. */
  shadows: boolean;
}

/** Ancho de la banda de medio tono, en n · L. */
const HALF_BAND = 0.38;

/** `ipd`: distancia entre pupilas en px de la foto (escala de las tolerancias). */
export function shadePlanes(b: Blocking, Lcam: Vec3, terminator: number, ipd: number): ShadedPlanes {
  const t0 = Math.max(-0.6, Math.min(0.6, terminator * 0.5));
  const t1 = t0 + HALF_BAND;
  // Luz en el marco de la foto (y abajo, z lejos).
  const L = v3(Lcam.x, -Lcam.y, -Lcam.z);
  const polys: Poly3[] = b.faces
    .filter((f) => f.verts.length >= 3)
    .map((f) => ({
      id: f.id,
      name: f.name,
      pts: f.verts.map((v) => b.vertices[v].p),
      n: f.plane.n,
      d: f.plane.d,
      front: f.front,
      shadows: !f.inset,
    }));

  const faces: ShadedFace[] = [];
  for (const R of polys) {
    if (!R.front || !R.shadows) continue;
    const ndl = R.n.x * L.x + R.n.y * L.y + R.n.z * L.z;
    const value: ShadeValue = ndl <= t0 ? 0 : ndl <= t1 ? 1 : 2;
    const cast: Vec2[][] = [];
    if (value > 0 && ndl > 1e-3) {
      for (const O of polys) {
        if (O === R || !O.shadows) continue;
        const shadow = projectOnto(O.pts, R, L, ndl, 0.004 * ipd);
        if (shadow && Math.abs(area2(shadow)) > (0.02 * ipd) ** 2 && overlaps(shadow, R.pts)) cast.push(shadow);
      }
    }
    const poly = R.pts.map((p) => v2(p.x, p.y));
    const depth = R.pts.reduce((s, p) => s + p.z, 0) / R.pts.length;
    faces.push({ id: R.id, name: R.name, poly, value, ndl, depth, cast, castFraction: cast.length ? coverage(poly, cast) : 0 });
  }
  faces.sort((a, c) => c.depth - a.depth);
  return { faces, t0, t1 };
}

/**
 * Sombra del polígono `pts` sobre el plano de R a lo largo de la luz: se recorta
 * la parte que queda del lado de la luz (n·p − d > eps) y se proyecta.
 */
function projectOnto(pts: readonly Vec3[], R: Poly3, L: Vec3, ndl: number, eps: number): Vec2[] | null {
  const f = (p: Vec3) => R.n.x * p.x + R.n.y * p.y + R.n.z * p.z - R.d;
  const clipped: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    const fa = f(a) - eps;
    const fc = f(c) - eps;
    if (fa > 0) clipped.push(a);
    if (fa > 0 !== fc > 0) {
      const t = fa / (fa - fc);
      clipped.push(v3(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t));
    }
  }
  if (clipped.length < 3) return null;
  return clipped.map((p) => {
    const s = f(p) / ndl;
    return v2(p.x - s * L.x, p.y - s * L.y);
  });
}

/** ¿Se tocan dos polígonos en la foto? (cajas, vértices dentro o aristas que se cruzan). */
function overlaps(a: readonly Vec2[], b3: readonly Vec3[]): boolean {
  const b = b3.map((p) => v2(p.x, p.y));
  const box = (p: readonly Vec2[]) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))];
  const [ax0, ay0, ax1, ay1] = box(a);
  const [bx0, by0, bx1, by1] = box(b);
  if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return false;
  if (a.some((p) => inPoly(p, b)) || b.some((p) => inPoly(p, a))) return true;
  const cr = (o: Vec2, p: Vec2, q: Vec2) => Math.sign((p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x));
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const p2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const q1 = b[j];
      const q2 = b[(j + 1) % b.length];
      if (cr(p1, p2, q1) * cr(p1, p2, q2) < 0 && cr(q1, q2, p1) * cr(q1, q2, p2) < 0) return true;
    }
  }
  return false;
}

/** Fracción del polígono cubierta por las sombras (muestreo en rejilla). */
function coverage(poly: readonly Vec2[], shadows: readonly Vec2[][]): number {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const N = 12;
  const dx = (Math.max(...xs) - x0) / N;
  const dy = (Math.max(...ys) - y0) / N;
  let inside = 0;
  let shaded = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const q = v2(x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy);
      if (!inPoly(q, poly)) continue;
      inside++;
      if (shadows.some((sh) => inPoly(q, sh))) shaded++;
    }
  }
  return inside ? shaded / inside : 0;
}

function inPoly(q: Vec2, poly: readonly Vec2[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const c = poly[j];
    if (a.y > q.y !== c.y > q.y && q.x < ((c.x - a.x) * (q.y - a.y)) / (c.y - a.y) + a.x) r = !r;
  }
  return r;
}

function area2(p: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y;
  return s / 2;
}
