// Expresiones a partir de los blendshapes de MediaPipe (§5.6), y mentón cerrado
// cuando la boca está abierta.

import { CANONICAL_VERTICES } from '../data/canonicalFace';
import { LIPS, LM } from '../detect/landmarkMap';
import type { ExpressionFlags } from './metrics';
import { v3, type Vec3 } from './vec';

export type ExpressionId = 'jawOpen' | 'smile' | 'eyesClosed' | 'pucker';

/**
 * Boca en «O» (funnel + pucker de MediaPipe): los labios se separan sin que la
 * mandíbula baje. Verificado con dos fotos de la misma persona (09: boca
 * cerrada; d4e0de6c: «O», jawOpen 0.39, funnel 0.39, pucker 0.58): sin cerrar,
 * el tercio medio/inferior ya coincide (0.95 contra 0.97); cerrar hasta que se
 * toquen los labios lo llevaba a 1.14. En ese caso no se cierra.
 */
const LIPS_O = 0.6;

export interface ExpressionReading {
  /** Intensidad 0–1 de cada expresión según los blendshapes. */
  level: Record<ExpressionId, number>;
  /** Detectada (sobre el umbral). */
  detected: Record<ExpressionId, boolean>;
  /** Lo que se usa al medir: detectada y no ignorada por el usuario. */
  flags: ExpressionFlags;
}

/** Umbrales: por encima, la expresión cambia las medidas de forma visible. */
export const EXPRESSION_THRESHOLD: Record<ExpressionId, number> = {
  jawOpen: 0.3,
  smile: 0.4,
  eyesClosed: 0.5,
  pucker: 0.7,
};

export function readExpression(blend: Record<string, number>, ignore: Partial<Record<ExpressionId, boolean>>): ExpressionReading {
  const level: Record<ExpressionId, number> = {
    jawOpen: blend.jawOpen ?? 0,
    smile: ((blend.mouthSmileLeft ?? 0) + (blend.mouthSmileRight ?? 0)) / 2,
    // Ambos ojos: con uno solo cerrado, el otro sigue sirviendo para medir.
    eyesClosed: Math.min(blend.eyeBlinkLeft ?? 0, blend.eyeBlinkRight ?? 0),
    pucker: blend.mouthPucker ?? 0,
  };
  const lipsO = (blend.mouthFunnel ?? 0) + (blend.mouthPucker ?? 0) > LIPS_O;
  const detected = {} as Record<ExpressionId, boolean>;
  for (const k of Object.keys(level) as ExpressionId[]) detected[k] = level[k] > EXPRESSION_THRESHOLD[k];
  const on = (k: ExpressionId) => detected[k] && !ignore[k];
  return {
    level,
    detected,
    flags: { jawOpen: on('jawOpen'), smile: on('smile'), eyesClosed: on('eyesClosed'), pucker: on('pucker'), lipsO: on('jawOpen') && lipsO },
  };
}

// ---------------------------------------------------------------------------
// Mentón cerrado.

/**
 * Landmarks que se mueven con la mandíbula: labio inferior y todo lo que está
 * por debajo de las comisuras en el modelo canónico (mentón, contorno de la
 * mandíbula). Las comisuras y la rama de la mandíbula, cerca de la bisagra, no.
 */
export const MANDIBLE: readonly number[] = (() => {
  const lowerLip = new Set<number>([14, 87, 178, 88, 95, 317, 402, 318, 324, 17, 84, 181, 91, 146, 314, 405, 321, 375]);
  const corners = new Set<number>([61, 291, 78, 308]);
  const cornerY = CANONICAL_VERTICES[61 * 3 + 1];
  const out: number[] = [];
  for (let i = 0; i < 468; i++) {
    if (corners.has(i)) continue;
    const y = CANONICAL_VERTICES[i * 3 + 1];
    const isLip = (LIPS as readonly number[]).includes(i);
    if (lowerLip.has(i) || (!isLip && y < cornerY - 0.1)) out.push(i);
  }
  return out;
})();

export interface JawClosing {
  /** Ángulo de cierre en grados (rotación alrededor del eje de la bisagra). */
  angle: number;
  /** Puntos en el marco de frente con la mandíbula cerrada. */
  points: Vec3[];
}

/** Separación mínima entre labios interiores (en unidades) para considerar la boca abierta. */
const MIN_GAP = 0.04;
/** Giro mínimo (rad) para cerrar. */
const MIN_ANGLE = (1.5 * Math.PI) / 180;

/**
 * Cierra la mandíbula en el marco de frente: gira los puntos de la mandíbula
 * alrededor de un eje lateral (x) que pasa cerca de la articulación
 * temporomandibular, justo delante del trago, hasta que los labios interiores
 * 13 y 14 quedan alineados vistos desde la bisagra (el acercamiento máximo: el
 * labio inferior está algo más lejos de la bisagra que el superior). La bisagra se ubica con los puntos del contorno junto a la
 * oreja (234/454), medio centímetro abajo y atrás: la articulación queda
 * delante del conducto auditivo, a la altura del trago.
 */
export function closeJaw(points: readonly Vec3[], unit: number): JawClosing | null {
  const up = points[LM.upperLipInner];
  const lo = points[LM.lowerLipInner];
  if (Math.hypot(up.x - lo.x, up.y - lo.y, up.z - lo.z) < MIN_GAP * unit) return null;
  const tr = points[LM.subjectRight.cheekTragus];
  const tl = points[LM.subjectLeft.cheekTragus];
  const hy = (tr.y + tl.y) / 2 - 0.5;
  const hz = (tr.z + tl.z) / 2 - 0.5;
  const a14 = Math.atan2(lo.y - hy, lo.z - hz);
  const a13 = Math.atan2(up.y - hy, up.z - hz);
  const theta = a13 - a14;
  // Ya cerrada (o la abertura no es de la mandíbula): nada que girar.
  if (theta < MIN_ANGLE) return null;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const moved = new Set(MANDIBLE);
  const out = points.map((p, i) => {
    if (!moved.has(i)) return p;
    const dy = p.y - hy;
    const dz = p.z - hz;
    // Rotación en el plano y-z: ángulo medido desde +z hacia +y.
    return v3(p.x, hy + dz * s + dy * c, hz + dz * c - dy * s);
  });
  return { angle: (theta * 180) / Math.PI, points: out };
}
