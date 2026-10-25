// Marco "cara de frente": se deshace la pose y los landmarks quedan en el marco
// canónico (cm), como si la foto fuera frontal. Las métricas del diagnóstico se
// miden aquí, así que una foto de ¾ da las mismas proporciones que una frontal
// de la misma persona (§5.4).
//
// DOS MÉTODOS. Se eligió 'detector3d' con la prueba de invariancia
// (tests/visual/invariance.mjs, 14 grupos de la misma persona, 61 fotos):
// desviación media respecto de la mediana del grupo, detector3d / rayPlane:
//   ancho de nariz 2.4 / 3.0 %, tercio medio/inferior 3.0 / 3.5 %,
//   boca entre nariz y mentón 3.2 / 3.6 %, ancho de boca 3.1 / 3.5 %.
//   Con giro > 35°: nariz 2.9 / 5.4 %, boca 4.1 / 7.2 %.
// Promediar ambos no mejora al 3D. El rayo-plano queda para puntos fuera de la
// malla (cabello, orejas), que no tienen z del detector.
//   'detector3d': gira hacia atrás los landmarks 3D del detector (x, y, z).
//   'rayPlane':   usa solo x, y de la foto. Cada punto se lleva por su línea de
//                 visión hasta la profundidad que ese landmark tiene en el modelo
//                 canónico. Supone que lo propio de cada cara está en el plano
//                 frontal (anchos, alturas) y no en la profundidad.

import { LM } from '../detect/landmarkMap';
import { canonicalPoint } from './canonical';
import { unprojectToCanonical, type SimilarityFit } from './pose';
import { apply3, mid3, transpose3, v3, type Vec2, type Vec3 } from './vec';

export type FrontalMethod = 'detector3d' | 'rayPlane';

export interface FrontalFace {
  /** 478 puntos en marco canónico (cm), sin pose. */
  points: Vec3[];
  method: FrontalMethod;
  /** Unidad de medida: distancia entre los centros de los ojos (punto medio
   * entre lagrimal y esquina externa), en cm de este marco. Equivale a la
   * distancia entre pupilas mirando al frente, pero no cambia con la mirada,
   * los lentes ni los ojos cerrados. */
  unit: number;
}

/** Profundidad canónica (cm) de cada landmark; los iris toman la del ojo. */
const BASE_DEPTH: readonly number[] = (() => {
  const out: number[] = [];
  for (let i = 0; i < 468; i++) out.push(canonicalPoint(i).z);
  const eyeZ = (s: typeof LM.subjectRight) => (canonicalPoint(s.eyeUpperLid).z + canonicalPoint(s.eyeLowerLid).z) / 2;
  for (let i = 468; i < 473; i++) out.push(eyeZ(LM.subjectRight));
  for (let i = 473; i < 478; i++) out.push(eyeZ(LM.subjectLeft));
  return out;
})();

/** Por debajo de este coseno (cara casi de perfil) el rayo-plano es inestable. */
const MIN_FACING = 0.2;

/** Lleva un punto de la foto (px) al marco canónico, a la profundidad `depthCm`. */
export function rayToFrontal(frame: Pick<SimilarityFit, 'rotation' | 'scale' | 'translation'>, p: Vec2, depthCm: number): Vec3 | null {
  const R = frame.rotation;
  const s = frame.scale;
  const t = frame.translation;
  // Marco de cámara: (x, −y, zK). p_C = Rᵀ (v − t) / s. Se despeja zK para que p_C.z = depth.
  const r22 = R[8];
  if (Math.abs(r22) < MIN_FACING) return null;
  const ax = p.x - t.x;
  const ay = -p.y - t.y;
  const zK = t.z + (s * depthCm - R[2] * ax - R[5] * ay) / r22;
  return apply3(transpose3(R), v3(ax / s, ay / s, (zK - t.z) / s));
}

export function centerOfEye(points: readonly Vec3[], side: 'R' | 'L'): Vec3 {
  const m = side === 'R' ? LM.subjectRight : LM.subjectLeft;
  return mid3(points[m.eyeOuter], points[m.eyeInner]);
}

export function toFrontal(landmarks: readonly Vec3[], frame: SimilarityFit, method: FrontalMethod = 'detector3d'): FrontalFace {
  let points: Vec3[];
  let used = method;
  if (method === 'rayPlane' && Math.abs(frame.rotation[8]) >= MIN_FACING) {
    points = landmarks.map((p, i) => rayToFrontal(frame, p, BASE_DEPTH[i])!);
  } else {
    used = 'detector3d';
    points = landmarks.map((p) => unprojectToCanonical(frame, p));
  }
  const r = centerOfEye(points, 'R');
  const l = centerOfEye(points, 'L');
  return { points, method: used, unit: Math.hypot(l.x - r.x, l.y - r.y) };
}
