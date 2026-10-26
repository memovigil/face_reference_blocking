// Pasos F, G y H · valores por umbral (como en el prototipo, §2.4): luminancia,
// desenfoque de caja dentro de la máscara de la cabeza con cabello, umbrales de
// Otsu (2, 3 o 5 valores planos) y un control del terminador. Opción de bordes
// rectos: el contorno de cada masa se simplifica con Douglas‑Peucker para que
// parezca un block‑in.
//
// Todo se calcula en una copia reducida de la foto (lado mayor ≤ 640 px): el
// desenfoque borra el detalle fino de todos modos y así un cambio de control
// tarda pocos milisegundos.

import { simplify } from '../geom/envelope';
import { v2, type Vec2 } from '../geom/vec';

export const VALUE_WORK_SIDE = 640;

export interface LumaImage {
  w: number;
  h: number;
  /** Luma (0–1, con la curva de la foto, como se percibe). */
  data: Float32Array;
  /** px de trabajo por px de la foto. */
  scale: number;
}

/** Luma Rec. 709 de un lienzo, en una copia reducida. */
export function lumaFromCanvas(src: HTMLCanvasElement, maxSide = VALUE_WORK_SIDE): LumaImage {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  return { w, h, data, scale };
}

/**
 * Desenfoque de caja separable, normalizado por la máscara: lo que está fuera
 * de la cabeza (el fondo) no se mezcla con el borde. `passes` cajas seguidas se
 * acercan a un desenfoque gaussiano.
 */
export function boxBlur(src: Float32Array, w: number, h: number, r: number, mask?: Uint8Array, passes = 2): Float32Array {
  const R = Math.max(0, Math.round(r));
  let val = Float32Array.from(src, (v, i) => (mask && !mask[i] ? 0 : v));
  let wt = new Float32Array(w * h).map((_, i) => (mask && !mask[i] ? 0 : 1));
  if (R === 0) return Float32Array.from(src);
  const pass = (a: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h);
    const n = horizontal ? w : h;
    const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      const idx = (k: number) => (horizontal ? l * w + k : k * w + l);
      let acc = 0;
      for (let k = -R; k <= R; k++) acc += a[idx(Math.min(n - 1, Math.max(0, k)))];
      for (let k = 0; k < n; k++) {
        out[idx(k)] = acc;
        acc += a[idx(Math.min(n - 1, k + R + 1))] - a[idx(Math.max(0, k - R))];
      }
    }
    return out;
  };
  for (let p = 0; p < passes; p++) {
    val = pass(pass(val, true), false);
    wt = pass(pass(wt, true), false);
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = wt[i] > 1e-6 ? val[i] / wt[i] : src[i];
  return out;
}

/**
 * Otsu multinivel: los `classes − 1` umbrales (índices de 0 a 255) que maximizan
 * la varianza entre clases del histograma. Programación dinámica sobre los
 * cortes, exacta para cualquier número de clases.
 */
export function multiOtsu(hist: ArrayLike<number>, classes: number): number[] {
  const L = hist.length;
  const P = new Float64Array(L + 1);
  const S = new Float64Array(L + 1);
  for (let i = 0; i < L; i++) {
    P[i + 1] = P[i] + hist[i];
    S[i + 1] = S[i] + i * hist[i];
  }
  // Aporte de la clase [a, b): w·μ² = S²/P.
  const cost = (a: number, b: number) => {
    const p = P[b] - P[a];
    if (p <= 0) return 0;
    const s = S[b] - S[a];
    return (s * s) / p;
  };
  const K = Math.max(1, Math.min(classes, L));
  const best: Float64Array[] = Array.from({ length: K + 1 }, () => new Float64Array(L + 1).fill(-Infinity));
  const arg: Int32Array[] = Array.from({ length: K + 1 }, () => new Int32Array(L + 1));
  for (let b = 1; b <= L; b++) best[1][b] = cost(0, b);
  for (let k = 2; k <= K; k++) {
    for (let b = k; b <= L; b++) {
      for (let a = k - 1; a < b; a++) {
        const v = best[k - 1][a] + cost(a, b);
        if (v > best[k][b]) {
          best[k][b] = v;
          arg[k][b] = a;
        }
      }
    }
  }
  const cuts: number[] = [];
  let b = L;
  for (let k = K; k >= 2; k--) {
    const a = arg[k][b];
    cuts.unshift(a);
    b = a;
  }
  return cuts;
}

export type ValueLevels = 2 | 3 | 5;

/** Colores de cada valor, del más oscuro al más claro (grafito → papel). */
export const VALUE_PALETTE: Record<ValueLevels, string[]> = {
  2: ['#454a4e', '#e3e5e1'],
  3: ['#3d4246', '#8f9497', '#e3e5e1'],
  5: ['#1f2225', '#4b5054', '#8f9497', '#c9ccc8', '#f6f7f4'],
};

/** Qué umbral separa la familia de la sombra de la de la luz (el terminador). */
export const TERMINATOR_INDEX: Record<ValueLevels, number> = { 2: 0, 3: 0, 5: 1 };

export interface ValueParams {
  levels: ValueLevels;
  /** Radio del desenfoque, en distancias entre pupilas. */
  blur: number;
  /** −1 … 1: mueve el terminador hacia menos (−) o más (+) sombra. */
  terminator: number;
}

export interface ValueMap {
  w: number;
  h: number;
  scale: number;
  levels: ValueLevels;
  /** Valor de cada píxel (0 = el más oscuro); 255 fuera de la máscara. */
  labels: Uint8Array;
  /** Umbrales en luma (0–1), de menor a mayor, ya con el terminador aplicado. */
  thresholds: number[];
}

export const OUTSIDE_MASK = 255;

export function posterize(luma: LumaImage, mask: Uint8Array, params: ValueParams, ipdWork: number): ValueMap {
  const { w, h } = luma;
  const blurred = boxBlur(luma.data, w, h, params.blur * ipdWork, mask);
  const hist = new Float64Array(256);
  for (let i = 0; i < w * h; i++) if (mask[i]) hist[Math.min(255, Math.max(0, Math.round(blurred[i] * 255)))]++;
  const cuts = multiOtsu(hist, params.levels).map((c) => c / 255);
  // Terminador: el umbral se mueve hacia su vecino (o hacia el extremo).
  const ti = TERMINATOR_INDEX[params.levels];
  if (cuts.length > ti) {
    const lo = ti > 0 ? cuts[ti - 1] : 0;
    const hi = ti < cuts.length - 1 ? cuts[ti + 1] : 1;
    const t = Math.max(-1, Math.min(1, params.terminator));
    cuts[ti] = t >= 0 ? cuts[ti] + (hi - cuts[ti]) * t * 0.9 : cuts[ti] + (cuts[ti] - lo) * t * 0.9;
  }
  const labels = new Uint8Array(w * h).fill(OUTSIDE_MASK);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    let k = 0;
    while (k < cuts.length && blurred[i] > cuts[k]) k++;
    labels[i] = k;
  }
  return { w, h, scale: luma.scale, levels: params.levels, labels, thresholds: cuts };
}

/** Lienzo con los valores planos (transparente fuera de la máscara). */
export function valueCanvas(map: ValueMap): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = map.w;
  cv.height = map.h;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(map.w, map.h);
  const rgb = VALUE_PALETTE[map.levels].map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
  for (let i = 0; i < map.labels.length; i++) {
    const k = map.labels[i];
    if (k === OUTSIDE_MASK) continue;
    img.data.set([...rgb[k], 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/**
 * Contornos de una máscara binaria (todos los lazos: exteriores y huecos), como
 * aristas de píxel encadenadas con la región a la izquierda.
 */
export function traceLoops(inside: (x: number, y: number) => boolean, w: number, h: number): Vec2[][] {
  const W1 = w + 1;
  const next = new Int32Array(W1 * (h + 1)).fill(-1);
  const key = (x: number, y: number) => y * W1 + x;
  const starts: number[] = [];
  const link = (a: number, b: number) => {
    next[a] = b;
    starts.push(a);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (y === 0 || !inside(x, y - 1)) link(key(x + 1, y), key(x, y));
      if (x === w - 1 || !inside(x + 1, y)) link(key(x + 1, y + 1), key(x + 1, y));
      if (y === h - 1 || !inside(x, y + 1)) link(key(x, y + 1), key(x + 1, y + 1));
      if (x === 0 || !inside(x - 1, y)) link(key(x, y), key(x, y + 1));
    }
  }
  const seen = new Uint8Array(W1 * (h + 1));
  const loops: Vec2[][] = [];
  for (const s of starts) {
    if (seen[s]) continue;
    const loop: Vec2[] = [];
    let k = s;
    while (k >= 0 && !seen[k]) {
      seen[k] = 1;
      loop.push(v2(k % W1, Math.floor(k / W1)));
      k = next[k];
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

export interface ValueShape {
  level: number;
  color: string;
  /** Lazos en px de la foto (exteriores y huecos; se rellenan con evenodd). */
  loops: Vec2[][];
}

/**
 * Masas con bordes rectos: para cada valor, la región «igual o más oscura» se
 * traza y se simplifica. Se dibujan de la más clara a la más oscura, una sobre
 * otra.
 */
export function valueShapes(map: ValueMap, tolWork: number, minAreaWork: number): ValueShape[] {
  const palette = VALUE_PALETTE[map.levels];
  const out: ValueShape[] = [];
  for (let k = map.levels - 1; k >= 0; k--) {
    const inside = (x: number, y: number) => {
      const l = map.labels[y * map.w + x];
      return l !== OUTSIDE_MASK && l <= k;
    };
    const loops = traceLoops(inside, map.w, map.h)
      .map((l) => simplify(l, tolWork))
      .filter((l) => l.length >= 3 && Math.abs(area(l)) >= minAreaWork)
      .map((l) => l.map((p) => v2(p.x / map.scale, p.y / map.scale)));
    if (loops.length) out.push({ level: k, color: palette[k], loops });
  }
  return out;
}

function area(p: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y;
  return s / 2;
}
