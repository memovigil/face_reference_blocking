// Modelo canónico de MediaPipe y marco "cara de frente".
// Las métricas del diagnóstico se calculan aquí: se deshace la pose y la foto de
// ¾ queda medida como si fuera frontal (ver §5.4 del documento de diseño).

import { CANONICAL_TRIANGLES, CANONICAL_VERTICES } from '../data/canonicalFace';
import { EXPRESSION_MOBILE, FACE_OVAL } from '../detect/landmarkMap';
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

/**
 * Landmarks para la pose: los rígidos menos el óvalo de la cara y su anillo
 * vecino. En una cara girada, el detector pone el contorno lejano sobre la
 * silueta visible y no donde el modelo 3D lo supone; quitarlo mejora giro y
 * cabeceo (prueba con verdad conocida, fase 1: cabeceo −20° medido −18.0° en
 * lugar de −15.6°; giro 45° medido 38.4° en lugar de 37.2°).
 */
export const POSE_LANDMARKS: readonly number[] = (() => {
  const oval = new Set<number>(FACE_OVAL);
  const ring = new Set<number>();
  for (let t = 0; t < CANONICAL_TRIANGLES.length; t += 3) {
    const tri = [CANONICAL_TRIANGLES[t], CANONICAL_TRIANGLES[t + 1], CANONICAL_TRIANGLES[t + 2]];
    if (tri.some((i) => oval.has(i))) for (const i of tri) if (!oval.has(i)) ring.add(i);
  }
  return RIGID_LANDMARKS.filter((i) => !oval.has(i) && !ring.has(i));
})();
