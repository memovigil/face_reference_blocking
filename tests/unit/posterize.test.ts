import { describe, expect, it } from 'vitest';
import { boxBlur, multiOtsu, OUTSIDE_MASK, posterize, traceLoops, valueShapes } from '../../src/values/posterize';

const gaussHist = (centers: number[], sd = 6) => {
  const h = new Float64Array(256);
  for (const c of centers) for (let i = 0; i < 256; i++) h[i] += 1000 * Math.exp(-((i - c) ** 2) / (2 * sd * sd));
  return h;
};

describe('Otsu', () => {
  it('dos clases: el umbral cae entre los dos picos', () => {
    const [t] = multiOtsu(gaussHist([60, 190]), 2);
    expect(t).toBeGreaterThan(100);
    expect(t).toBeLessThan(150);
  });

  it('tres y cinco clases: umbrales ordenados entre picos', () => {
    const t3 = multiOtsu(gaussHist([40, 128, 215]), 3);
    expect(t3).toHaveLength(2);
    expect(t3[0]).toBeGreaterThan(55);
    expect(t3[0]).toBeLessThan(110);
    expect(t3[1]).toBeGreaterThan(145);
    expect(t3[1]).toBeLessThan(200);
    const t5 = multiOtsu(gaussHist([20, 70, 128, 180, 235]), 5);
    expect(t5).toHaveLength(4);
    for (let i = 1; i < 4; i++) expect(t5[i]).toBeGreaterThan(t5[i - 1]);
    const peaks = [20, 70, 128, 180, 235];
    t5.forEach((t, i) => {
      expect(t).toBeGreaterThan(peaks[i]);
      expect(t).toBeLessThan(peaks[i + 1]);
    });
  });

  it('coincide con la búsqueda exhaustiva en dos clases', () => {
    const h = gaussHist([80, 120, 200], 15);
    const [t] = multiOtsu(h, 2);
    let best = -1;
    let bt = 0;
    for (let c = 1; c < 256; c++) {
      let w0 = 0, s0 = 0, w1 = 0, s1 = 0;
      for (let i = 0; i < c; i++) (w0 += h[i]), (s0 += i * h[i]);
      for (let i = c; i < 256; i++) (w1 += h[i]), (s1 += i * h[i]);
      const v = (s0 * s0) / w0 + (s1 * s1) / w1;
      if (v > best) (best = v), (bt = c);
    }
    expect(t).toBe(bt);
  });
});

describe('desenfoque de caja', () => {
  it('una imagen constante no cambia', () => {
    const src = new Float32Array(30 * 20).fill(0.4);
    const out = boxBlur(src, 30, 20, 3);
    for (const v of out) expect(v).toBeCloseTo(0.4, 5);
  });

  it('con máscara, el fondo claro no se mete en la cabeza oscura', () => {
    const w = 40, h = 10;
    const src = new Float32Array(w * h);
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inHead = x < 20;
      mask[y * w + x] = inHead ? 1 : 0;
      src[y * w + x] = inHead ? 0.2 : 1;
    }
    const out = boxBlur(src, w, h, 4, mask);
    for (let y = 0; y < h; y++) expect(out[y * w + 19]).toBeCloseTo(0.2, 5);
    // Sin máscara, el borde sí se aclara.
    expect(boxBlur(src, w, h, 4)[5 * w + 19]).toBeGreaterThan(0.3);
  });
});

describe('masas', () => {
  it('posteriza en 3 valores dentro de la máscara y mueve el terminador', () => {
    const w = 60, h = 20;
    const data = new Float32Array(w * h).map((_, i) => [0.15, 0.5, 0.85][Math.floor((i % w) / 20)]);
    const mask = new Uint8Array(w * h).fill(1);
    mask[0] = 0;
    const luma = { w, h, data, scale: 1 };
    const m = posterize(luma, mask, { levels: 3, blur: 0, terminator: 0 }, 10);
    expect(m.labels[0]).toBe(OUTSIDE_MASK);
    expect(m.labels[5 * w + 10]).toBe(0);
    expect(m.labels[5 * w + 30]).toBe(1);
    expect(m.labels[5 * w + 50]).toBe(2);
    // Más sombra: el umbral del terminador sube hacia el siguiente.
    const more = posterize(luma, mask, { levels: 3, blur: 0, terminator: 1 }, 10);
    const gap = m.thresholds[1] - m.thresholds[0];
    expect(more.thresholds[0] - m.thresholds[0]).toBeCloseTo(0.9 * gap, 6);
    const less = posterize(luma, mask, { levels: 3, blur: 0, terminator: -1 }, 10);
    expect(less.thresholds[0]).toBeLessThan(m.thresholds[0]);
    expect(less.thresholds[0]).toBeGreaterThanOrEqual(0);
  });

  it('contornos: un cuadrado con hueco da dos lazos', () => {
    const inside = (x: number, y: number) => x >= 2 && x < 12 && y >= 2 && y < 12 && !(x >= 5 && x < 9 && y >= 5 && y < 9);
    const loops = traceLoops(inside, 14, 14);
    expect(loops).toHaveLength(2);
    const sizes = loops.map((l) => l.length).sort((a, b) => a - b);
    expect(sizes).toEqual([16, 40]);
  });

  it('bordes rectos: una masa rectangular queda en 4 vértices', () => {
    const w = 50, h = 40;
    const labels = new Uint8Array(w * h).map((_, i) => ((i % w) >= 10 && (i % w) < 30 && Math.floor(i / w) >= 8 && Math.floor(i / w) < 30 ? 0 : 1));
    const shapes = valueShapes({ w, h, scale: 0.5, levels: 2, labels, thresholds: [0.5] }, 1, 4);
    const dark = shapes.find((s) => s.level === 0)!;
    expect(dark.loops).toHaveLength(1);
    expect(dark.loops[0]).toHaveLength(4);
    // En px de la foto (escala 0.5): 20 × 22 de trabajo → 40 × 44.
    const xs = dark.loops[0].map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40, 6);
  });
});
