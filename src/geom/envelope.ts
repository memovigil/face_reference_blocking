// Paso A · Envolvente con rectas: polígono de 7–9 lados que circunscribe la
// cabeza con cabello, ángulo de cada lado contra la plomada y espacios negativos.

import { SEG, type Segmentation } from '../detect/segment';
import { v2, type Vec2 } from './vec';

export interface EnvelopeEdge {
  a: Vec2;
  b: Vec2;
  /** Ángulo agudo contra la vertical (plomada), en grados: 0 = vertical, 90 = horizontal. */
  fromVertical: number;
}

export interface Envelope {
  polygon: Vec2[];
  edges: EnvelopeEdge[];
  /** Plomada por la cima, de arriba abajo del polígono. */
  plumb: { top: Vec2; bottom: Vec2 };
  /** Espacios negativos: fondo dentro de la envolvente (contornos simplificados). */
  negative: Vec2[][];
  source: 'silhouette' | 'points';
}

const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const sub = (a: Vec2, b: Vec2) => v2(a.x - b.x, a.y - b.y);

/** Área con signo (positiva = antihoraria en coordenadas con y hacia arriba). */
export function polygonArea(p: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += cross(p[i], p[(i + 1) % p.length]);
  return s / 2;
}

/** Intersección de las rectas (p1 + t·d1) y (p2 + u·d2); devuelve t, u. */
function intersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): { t: number; u: number } | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return null;
  const w = sub(p2, p1);
  return { t: cross(w, d2) / den, u: cross(w, d1) / den };
}

/**
 * Polígono circunscrito de `k` lados a partir de un polígono convexo: se quita
 * una y otra vez la arista cuya eliminación (extendiendo sus dos vecinas hasta
 * que se corten) agrega menos área. Cada lado del resultado es tangente a la
 * silueta, como las rectas de un encaje.
 */
export function circumscribe(hull: readonly Vec2[], k: number): Vec2[] {
  let v = [...hull];
  if (polygonArea(v) < 0) v.reverse();
  // Quita vértices casi colineales para acelerar.
  v = v.filter((p, i) => {
    const a = v[(i - 1 + v.length) % v.length];
    const b = v[(i + 1) % v.length];
    return Math.abs(cross(sub(p, a), sub(b, p))) > 1e-6;
  });
  while (v.length > k) {
    const n = v.length;
    let best = -1;
    let bestArea = Infinity;
    let bestX: Vec2 | null = null;
    for (let i = 0; i < n; i++) {
      // Arista i: v[i] → v[i+1]. Vecinas: v[i-1] → v[i] y v[i+1] → v[i+2].
      const pPrev = v[(i - 1 + n) % n];
      const a = v[i];
      const b = v[(i + 1) % n];
      const bNext = v[(i + 2) % n];
      const d1 = sub(a, pPrev);
      const d2 = sub(bNext, b);
      const hit = intersect(a, d1, b, d2);
      if (!hit || hit.t <= 0 || hit.u >= 0) continue; // las vecinas no convergen hacia afuera
      const x = v2(a.x + d1.x * hit.t, a.y + d1.y * hit.t);
      const area = Math.abs(cross(sub(x, a), sub(b, a))) / 2;
      if (area < bestArea) {
        bestArea = area;
        best = i;
        bestX = x;
      }
    }
    if (best < 0 || !bestX) break;
    const i2 = (best + 1) % n;
    if (i2 === 0) {
      v.splice(best, 1, bestX);
      v.shift();
    } else {
      v.splice(best, 2, bestX);
    }
  }
  return v;
}

export function edgeAngles(poly: readonly Vec2[]): EnvelopeEdge[] {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const ang = (Math.atan2(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 180) / Math.PI;
    return { a, b, fromVertical: ang };
  });
}

/** Plomada vertical por `top`, entre el punto más alto y el más bajo del polígono. */
export function plumbLine(poly: readonly Vec2[], top: Vec2): { top: Vec2; bottom: Vec2 } {
  const ys = poly.map((p) => p.y);
  return { top: v2(top.x, Math.min(...ys)), bottom: v2(top.x, Math.max(...ys)) };
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Espacios negativos: fondo dentro de la envolvente, agrupado en manchas
 * conexas. Se devuelven las `max` más grandes que superen `minFrac` del área
 * del polígono, como contornos simplificados.
 */
export function negativeSpaces(seg: Segmentation, poly: readonly Vec2[], max = 3, minFrac = 0.01): Vec2[][] {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(seg.width - 1, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(seg.height - 1, Math.ceil(Math.max(...ys)));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 2 || h < 2) return [];
  // Paso de muestreo para no recorrer millones de píxeles en imágenes grandes.
  const step = Math.max(1, Math.round(Math.max(w, h) / 400));
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const grid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = x0 + gx * step + step / 2;
      const y = y0 + gy * step + step / 2;
      if (x > x1 || y > y1) continue;
      if (seg.mask[Math.floor(y) * seg.width + Math.floor(x)] === SEG.background && pointInPolygon(v2(x, y), poly)) grid[gy * gw + gx] = 1;
    }
  }
  const total = Math.abs(polygonArea(poly)) / (step * step);
  const label = new Int32Array(gw * gh);
  const comps: { id: number; size: number }[] = [];
  let next = 1;
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || label[i]) continue;
    const id = next++;
    let size = 0;
    const stack = [i];
    label[i] = id;
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % gw;
      for (const k of [j - 1, j + 1, j - gw, j + gw]) {
        if (k < 0 || k >= grid.length) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === gw - 1)) continue;
        if (grid[k] && !label[k]) {
          label[k] = id;
          stack.push(k);
        }
      }
    }
    comps.push({ id, size });
  }
  return comps
    .filter((c) => c.size >= minFrac * total)
    .sort((a, b) => b.size - a.size)
    .slice(0, max)
    .map((c) => simplify(traceOutline(label, gw, gh, c.id), 1.2).map((p) => v2(x0 + p.x * step, y0 + p.y * step)));
}

/** Contorno exterior de una mancha (aristas de píxel encadenadas). */
function traceOutline(label: Int32Array, w: number, h: number, id: number): Vec2[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === id;
  const next = new Map<string, string>();
  const key = (x: number, y: number) => `${x},${y}`;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      // Aristas orientadas con la mancha a la izquierda.
      if (!at(x, y - 1)) next.set(key(x + 1, y), key(x, y));
      if (!at(x + 1, y)) next.set(key(x + 1, y + 1), key(x + 1, y));
      if (!at(x, y + 1)) next.set(key(x, y + 1), key(x + 1, y + 1));
      if (!at(x - 1, y)) next.set(key(x, y), key(x, y + 1));
    }
  }
  // Se recorre el lazo más largo (el contorno exterior).
  let best: Vec2[] = [];
  const seen = new Set<string>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: Vec2[] = [];
    let k: string | undefined = start;
    while (k && !seen.has(k)) {
      seen.add(k);
      const [x, y] = k.split(',').map(Number);
      loop.push(v2(x, y));
      k = next.get(k);
    }
    if (loop.length > best.length) best = loop;
  }
  return best;
}

/** Douglas–Peucker sobre una polilínea abierta (conserva los extremos). */
export function simplifyOpen(pts: readonly Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return [...pts];
  const keep = pts.map((_, i) => i === 0 || i === pts.length - 1);
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = pts[a];
    const pb = pts[b];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    let idx = -1;
    let dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].x - pa.x) * dy - (pts[i].y - pa.y) * dx) / len;
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas–Peucker sobre un contorno cerrado: se parte en el punto más lejano al primero. */
export function simplify(pts: readonly Vec2[], tol: number): Vec2[] {
  if (pts.length < 4) return [...pts];
  let far = 0;
  let fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const first = simplifyOpen(pts.slice(0, far + 1), tol);
  const second = simplifyOpen([...pts.slice(far), pts[0]], tol);
  return [...first, ...second.slice(1, -1)];
}
