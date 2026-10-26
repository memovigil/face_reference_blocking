// Estimación de la luz desde la foto (§8). Con las normales de los planos del
// blocking y la luminancia de la foto en el centro de cada plano se ajusta un
// modelo lambertiano simple:
//
//   I = albedo · max(0, n · L) + ambiente
//
// La dirección L se busca en una rejilla de direcciones (y luego se afina); para
// cada una, albedo y ambiente salen por mínimos cuadrados. Se excluyen ojos,
// boca, cejas, fosas nasales, cabello y orejas (otro albedo), y los píxeles que
// la segmentación no marca como piel. Tras un primer ajuste se descartan los
// planos con residuo grande: suelen ser sombras proyectadas (la de la nariz
// sobre la mejilla) o brillos, que el modelo local no explica.
//
// Marco de cámara: x a la derecha de la foto, y hacia arriba, z hacia la cámara.
// θ: de dónde viene la luz, en grados en sentido horario desde arriba de la
// foto (90° = desde la derecha). φ: ángulo con la dirección de la cámara
// (0° = luz frontal, 90° = de lado, rasante; > 90° = contraluz).

import { SEG, type Segmentation } from '../detect/segment';
import type { LumaImage } from '../values/posterize';
import type { Blocking } from './blocking';
import { v2, v3, type Vec2, type Vec3 } from './vec';

export interface LightSample {
  /** Normal del plano en el marco de cámara (unitaria). */
  n: Vec3;
  /** Intensidad lineal (0–1). */
  I: number;
  w: number;
  id: string;
}

export interface LightEstimate {
  /** Dirección hacia la luz, marco de cámara, unitaria. */
  dir: Vec3;
  theta: number;
  phi: number;
  albedo: number;
  ambient: number;
  /** Fracción de la variación de luminancia que explica el modelo. */
  r2: number;
  /** albedo / (albedo + ambiente): qué tan marcada es la luz. */
  contrast: number;
  /** La luz es lo bastante clara para fiarse de la dirección. */
  confident: boolean;
  /** Planos usados en el ajuste final (y descartados por residuo). */
  used: string[];
  rejected: string[];
}

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

export function lightFromAngles(theta: number, phi: number): Vec3 {
  const t = rad(theta);
  const p = rad(phi);
  return v3(Math.sin(p) * Math.sin(t), Math.sin(p) * Math.cos(t), Math.cos(p));
}

export function anglesFromLight(L: Vec3): { theta: number; phi: number } {
  const theta = (deg(Math.atan2(L.x, L.y)) + 360) % 360;
  const phi = deg(Math.acos(Math.max(-1, Math.min(1, L.z))));
  return { theta, phi };
}

/** Regiones del blocking que no entran al ajuste (albedo distinto o poco fiable). */
const EXCLUDED = /^(eye|upperLid|brow|upperLip|lowerLip|upperRed|lowerRed|philtrum|sulcus|noseBase|noseTipBottom|noseAla|skull|ear|mouth)/;

/**
 * Luminancia lineal mediana en el centro de un polígono (en px de la foto): se
 * achica hacia su centroide para no tocar los bordes. Con segmentación, solo
 * cuentan los píxeles de piel de la cara.
 */
export function sampleFace(luma: LumaImage, poly: readonly Vec2[], seg: Segmentation | null, shrink = 0.6): { I: number; n: number; skin: number } | null {
  if (poly.length < 3) return null;
  const s = luma.scale;
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= poly.length;
  cy /= poly.length;
  const P = poly.map((p) => v2((cx + (p.x - cx) * shrink) * s, (cy + (p.y - cy) * shrink) * s));
  const xs = P.map((p) => p.x);
  const ys = P.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(luma.w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(luma.h - 1, Math.ceil(Math.max(...ys)));
  const vals: number[] = [];
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inPoly(x + 0.5, y + 0.5, P)) continue;
      total++;
      if (seg) {
        const sx = Math.min(seg.width - 1, Math.floor((x + 0.5) / s));
        const sy = Math.min(seg.height - 1, Math.floor((y + 0.5) / s));
        if (seg.mask[sy * seg.width + sx] !== SEG.faceSkin) continue;
      }
      vals.push(luma.data[y * luma.w + x]);
    }
  }
  if (vals.length < 4) return null;
  vals.sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  return { I: med ** 2.2, n: vals.length, skin: total ? vals.length / total : 0 };
}

/** Muestras de luz de los planos visibles del blocking. */
export function lightSamples(b: Blocking, luma: LumaImage, seg: Segmentation | null): LightSample[] {
  const out: LightSample[] = [];
  for (const f of b.faces) {
    if (!f.front || f.inset || EXCLUDED.test(f.id) || f.verts.length < 3) continue;
    const poly = f.verts.map((v) => v2(b.vertices[v].p.x, b.vertices[v].p.y));
    const smp = sampleFace(luma, poly, seg);
    if (!smp || (seg && smp.skin < 0.3)) continue;
    // Normal de la foto (y abajo, z lejos) → cámara (y arriba, z hacia la cámara).
    const n = v3(f.plane.n.x, -f.plane.n.y, -f.plane.n.z);
    out.push({ n, I: smp.I, w: Math.sqrt(smp.n), id: f.id });
  }
  return out;
}

interface Fit {
  L: Vec3;
  a: number;
  b: number;
  sse: number;
}

function fitAt(samples: readonly LightSample[], L: Vec3): Fit | null {
  // Mínimos cuadrados ponderados de I = a·s + b.
  let W = 0;
  let Ss = 0;
  let Si = 0;
  let Sss = 0;
  let Ssi = 0;
  for (const p of samples) {
    const s = Math.max(0, p.n.x * L.x + p.n.y * L.y + p.n.z * L.z);
    W += p.w;
    Ss += p.w * s;
    Si += p.w * p.I;
    Sss += p.w * s * s;
    Ssi += p.w * s * p.I;
  }
  const den = W * Sss - Ss * Ss;
  if (Math.abs(den) < 1e-12) return null;
  const a = (W * Ssi - Ss * Si) / den;
  const b = (Si - a * Ss) / W;
  if (a <= 0) return null;
  let sse = 0;
  for (const p of samples) {
    const s = Math.max(0, p.n.x * L.x + p.n.y * L.y + p.n.z * L.z);
    sse += p.w * (a * s + b - p.I) ** 2;
  }
  return { L, a, b, sse };
}

function search(samples: readonly LightSample[]): Fit | null {
  let best: Fit | null = null;
  const tryAt = (theta: number, phi: number) => {
    const f = fitAt(samples, lightFromAngles(theta, phi));
    if (f && (!best || f.sse < best.sse)) best = f;
  };
  for (let phi = 0; phi <= 120; phi += 5) for (let theta = 0; theta < 360; theta += phi === 0 ? 360 : 5) tryAt(theta, phi);
  if (!best) return null;
  const { theta, phi } = anglesFromLight((best as Fit).L);
  for (let dp = -5; dp <= 5; dp += 1) for (let dt = -5; dt <= 5; dt += 1) tryAt(theta + dt, Math.max(0, phi + dp));
  return best;
}

export function estimateLight(samples: readonly LightSample[]): LightEstimate | null {
  if (samples.length < 5) return null;
  let fit = search(samples);
  if (!fit) return null;
  // Descarta lo que el modelo local no explica (sombras proyectadas, brillos).
  const resid = (f: Fit, p: LightSample) => f.a * Math.max(0, p.n.x * f.L.x + p.n.y * f.L.y + p.n.z * f.L.z) + f.b - p.I;
  const W = samples.reduce((s, p) => s + p.w, 0);
  const sigma = Math.sqrt(fit.sse / W);
  const kept = samples.filter((p) => Math.abs(resid(fit!, p)) <= 2.5 * sigma);
  const rejected = samples.filter((p) => !kept.includes(p)).map((p) => p.id);
  if (kept.length >= 5 && rejected.length) fit = search(kept) ?? fit;
  const used = kept.length >= 5 ? kept : samples;
  const Wu = used.reduce((s, p) => s + p.w, 0);
  const mean = used.reduce((s, p) => s + p.w * p.I, 0) / Wu;
  const sst = used.reduce((s, p) => s + p.w * (p.I - mean) ** 2, 0);
  const sse = used.reduce((s, p) => s + p.w * resid(fit!, p) ** 2, 0);
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const contrast = fit.a / (fit.a + Math.max(0, fit.b));
  const { theta, phi } = anglesFromLight(fit.L);
  return {
    dir: fit.L,
    theta,
    phi,
    albedo: fit.a,
    ambient: fit.b,
    r2,
    contrast,
    confident: r2 >= 0.4 && contrast >= 0.2 && used.length >= 8,
    used: used.map((p) => p.id),
    rejected: kept.length >= 5 ? rejected : [],
  };
}

function inPoly(x: number, y: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Texto: de dónde viene la luz.

const SECTORS = ['arriba', 'arriba a la derecha', 'la derecha', 'abajo a la derecha', 'abajo', 'abajo a la izquierda', 'la izquierda', 'arriba a la izquierda'];

/** «desde arriba a la izquierda» (de la foto). */
export function lightFrom(theta: number): string {
  return `desde ${SECTORS[Math.round((((theta % 360) + 360) % 360) / 45) % 8]}`;
}

/** Qué tan lateral es la luz. */
export function lightSpread(phi: number): string {
  if (phi < 25) return 'casi frontal';
  if (phi < 55) return 'de tres cuartos';
  if (phi < 85) return 'lateral';
  if (phi < 105) return 'rasante, de lado';
  return 'contraluz';
}
