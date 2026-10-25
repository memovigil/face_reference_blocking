// Modelo canónico de MediaPipe y marco "cara de frente".
// Las métricas del diagnóstico se calculan aquí: se deshace la pose y la foto de
// ¾ queda medida como si fuera frontal (ver §5.4 del documento de diseño).

import { CANONICAL_VERTICES } from '../data/canonicalFace';
import { EXPRESSION_MOBILE } from '../detect/landmarkMap';
import { v3, type Vec3 } from './vec';

export const CANONICAL_COUNT = 468;

export function canonicalPoint(i: number): Vec3 {
  return v3(CANONICAL_VERTICES[i * 3], CANONICAL_VERTICES[i * 3 + 1], CANONICAL_VERTICES[i * 3 + 2]);
}

/**
 * Landmarks "rígidos" para estimar la pose: de la base de la nariz hacia arriba
 * (y canónica > −2.6 cm, deja fuera boca y mandíbula), sin párpados ni cejas.
 */
export const RIGID_LANDMARKS: readonly number[] = (() => {
  const out: number[] = [];
  for (let i = 0; i < CANONICAL_COUNT; i++) {
    if (CANONICAL_VERTICES[i * 3 + 1] > -2.6 && !EXPRESSION_MOBILE.has(i)) out.push(i);
  }
  return out;
})();
