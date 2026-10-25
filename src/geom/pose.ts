// Pose de la cabeza: giro (yaw), cabeceo (pitch) e inclinación (roll).
//
// MARCOS DE COORDENADAS
//   Canónico (C): el del modelo canónico de MediaPipe, en cm. +x = izquierda
//     del sujeto (derecha de quien mira), +y = arriba, +z = hacia la cámara.
//   Cámara (K):  el de la matriz de MediaPipe (convención OpenGL). +x =
//     derecha de la foto, +y = arriba, +z = hacia quien mira; la cámara ve
//     hacia −z. La matriz lleva C → K: p_K = R·p_C + t.
//   Imagen (I):  píxeles de la imagen de trabajo. +x = derecha, +y = abajo,
//     +z = alejándose de la cámara (igual que la z de los landmarks).
//     I = F·K con F = diag(1, −1, −1).
//
// CONVENCIÓN DE ÁNGULOS (grados), R = Ry(giro) · Rx(cabeceo) · Rz(−inclinación)
//   + giro        = la cara mira hacia la DERECHA de la foto.
//   + cabeceo     = la cara mira hacia ABAJO.
//   + inclinación = la cima de la cabeza se va hacia la DERECHA de la foto
//                   (giro en sentido horario dentro de la imagen).
// Verificación: tests/unit/pose.test.ts (matrices sintéticas) y la
// comprobación geométrica `checkPoseSign` (punta de la nariz contra el
// centro de los ojos), que se corre con cada foto.
//
// DECISIÓN: DE DÓNDE SALE LA POSE (fase 1, verificado con fotos y renders)
// Fuente principal: ajuste ortográfico del modelo canónico a las posiciones
// x, y de los landmarks rígidos (`fitSimilarity2D`, PnP de perspectiva débil).
// Diagnóstico: ajuste 3D con la z del detector (`fitSimilarity`) y la matriz
// de MediaPipe; el panel muestra la diferencia con la matriz.
//
// 1) La matriz se sesga cuando la cara no está centrada: MediaPipe la
//    reconstruye con una cámara de 63° de campo y el lente real es otro.
//    foto                 traslación (cm)   matriz     malla 3D   nariz
//    raw (centrada)       (−0.2, −1.7)      cab 7.4    cab 8.5    —
//    portrait (arriba)    (−0.4, 22.5)      cab 3.9    cab −2.7   —
//    man‑woman (izq.)     (−25, 8.7)        giro +2.7  giro −2.4  giro −6.5
//    portrait girada 90°  ( 23, 0.4)        giro −9.4  giro 3.9   —
//    En man‑woman la matriz da el giro con el signo al revés. Corregirla por la
//    línea de visión con los 63° supuestos lo empeora (cab −15 en portrait).
// 2) La z del detector se aplana en caras giradas. Prueba con verdad conocida
//    (tests/visual/pose-synth.mjs: la cara frontal detectada se renderiza
//    girada un ángulo exacto y se vuelve a detectar). Giro/cabeceo medidos:
//    aplicado   3D con z     ortográfico   pendiente z detectada / real
//    ±15/0      ±11/−1       ±13.8/−1.5    0.95
//    ±30/0      ±21/1        ±26.2/−1.6    0.84
//    ±45/0      ±32/2        ±39.0/−0.5    0.72
//    0/±20      0/±17        0/−18, +16.6  1.0
//    −30/15     −24/13       −28/8.6       0.93
//    El 3D falla el criterio de ±10° a 45°; el ortográfico lo cumple en todos
//    los casos (máx. 6.6° en giro, 6.4° en cabeceo) y, por definición, es el
//    que mejor alinea el modelo con lo que se ve en la foto. Reescalar la z del
//    detector con un factor libre converge al resultado 3D, y mezclarla con
//    peso fijo solo interpola: se descartaron.
// 3) Fotos reales del usuario (68 de 69 detectadas): el signo del giro coincide
//    con la nariz en todas. En ¾ fuertes (04, 08, 862dc303: giro 52–56°) se
//    marcó la oreja a mano y se agregó al ajuste: el giro cambia menos de 1.5°,
//    o sea que la oreja es coherente con la pose de la malla. Con el canónico,
//    a 55° la esquina externa del ojo lejano asoma por detrás del puente de la
//    nariz y a 70° quedaría oculta; en esas fotos asoma, así que el giro real
//    está por debajo de ~65°: dentro de ±10° de lo medido.
//    Pesar los puntos por visibilidad (normal canónica) achica el giro: se
//    descartó. Sin el contorno de la cara (POSE_LANDMARKS) mejora un poco.
// Las orejas que el usuario confirma entran al ajuste como anclas (`Anchor`):
// dan brazo de palanca cerca del perfil, donde la malla es menos confiable.

import { LM } from '../detect/landmarkMap';
import { canonicalPoint, POSE_LANDMARKS } from './canonical';
import {
  add3,
  apply3,
  centroid3,
  col3,
  deg,
  dot3,
  len3,
  mul3,
  orthonormalize3,
  quatToMat3,
  rad,
  rotX,
  rotY,
  rotZ,
  scale3,
  sub3,
  symmetricEigen,
  transpose3,
  v3,
  type Mat3,
  type Vec3,
} from './vec';

export interface PoseAngles {
  yaw: number;
  pitch: number;
  roll: number;
}

export const ZERO_POSE: PoseAngles = { yaw: 0, pitch: 0, roll: 0 };

/** Ángulos (grados, convención de la app) a partir de una rotación C → K. */
export function anglesFromRotation(r: Mat3): PoseAngles {
  const f = col3(r, 2); // hacia dónde mira la cara
  const yaw = Math.atan2(f.x, f.z);
  const pitch = Math.atan2(-f.y, Math.hypot(f.x, f.z));
  const m = mul3(transpose3(mul3(rotY(yaw), rotX(pitch))), r); // = Rz(φ)
  const phi = Math.atan2(m[3], m[0]);
  return { yaw: deg(yaw), pitch: deg(pitch), roll: -deg(phi) };
}

/** Rotación C → K a partir de ángulos en grados (convención de la app). */
export function rotationFromAngles(a: PoseAngles): Mat3 {
  return mul3(mul3(rotY(rad(a.yaw)), rotX(rad(a.pitch))), rotZ(-rad(a.roll)));
}

/** Ángulo (grados) entre dos rotaciones. */
export function rotationDistance(a: Mat3, b: Mat3): number {
  const m = mul3(transpose3(a), b);
  const c = (m[0] + m[4] + m[8] - 1) / 2;
  return deg(Math.acos(Math.max(-1, Math.min(1, c))));
}

export interface ParsedMatrix {
  rotation: Mat3;
  translation: Vec3;
  scale: number;
  layout: 'column-major' | 'row-major';
}

/**
 * Lee la matriz 4×4 de MediaPipe. Detecta el orden de almacenamiento por la
 * posición de la traslación: la cara está frente a la cámara, así que la
 * componente z de la traslación es grande y negativa. Verificado con fotos
 * reales: MediaPipe entrega column-major (traslación en data[12..14]).
 */
export function parseTransformMatrix(data: ArrayLike<number>): ParsedMatrix {
  const colMajor =
    Math.abs(data[12]) + Math.abs(data[13]) + Math.abs(data[14]) >=
    Math.abs(data[3]) + Math.abs(data[7]) + Math.abs(data[11]);
  const at = (i: number, j: number) => (colMajor ? data[j * 4 + i] : data[i * 4 + j]);
  const m: Mat3 = [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)];
  const scale = (len3(col3(m, 0)) + len3(col3(m, 1)) + len3(col3(m, 2))) / 3;
  return {
    rotation: orthonormalize3(m),
    translation: v3(at(0, 3), at(1, 3), at(2, 3)),
    scale,
    layout: colMajor ? 'column-major' : 'row-major',
  };
}

// ---------------------------------------------------------------------------
// Ajuste de semejanza (Horn, cuaterniones) entre el modelo canónico y los
// landmarks detectados. Da la pose tal como se ve en la foto.

const imageToCamera = (p: Vec3): Vec3 => v3(p.x, -p.y, -p.z);

export interface SimilarityFit {
  /** Rotación C → K (orientación de cámara). */
  rotation: Mat3;
  /** px por cm. */
  scale: number;
  /** Traslación en marco K (px), de modo que p_K = s·R·p_C + t. */
  translation: Vec3;
  /** Error RMS en px. */
  rms: number;
}

/** Semejanza que lleva puntos canónicos (cm) a landmarks en px (marco I), usando la z del detector. */
export function fitSimilarity(landmarksPx: readonly Vec3[], indices: readonly number[] = POSE_LANDMARKS): SimilarityFit {
  return kabsch(indices.map(canonicalPoint), indices.map((i) => imageToCamera(landmarksPx[i])));
}

/** Correspondencia extra para el ajuste: un punto canónico (cm) y dónde está en la foto (px). */
export interface Anchor {
  canonical: Vec3;
  image: { x: number; y: number };
  /** Peso relativo a un landmark de la malla. */
  weight: number;
}

/**
 * Semejanza con proyección ortográfica: usa solo x, y de los landmarks y la
 * profundidad del modelo canónico (PnP de perspectiva débil). Iteración: se
 * completa la z de cada landmark con la del modelo ajustado y se vuelve a
 * resolver Kabsch. Arranca del ajuste 3D, que ya está cerca.
 * `anchors` agrega puntos fuera de la malla que el usuario confirmó (orejas).
 */
export function fitSimilarity2D(
  landmarksPx: readonly Vec3[],
  indices: readonly number[] = POSE_LANDMARKS,
  anchors: readonly Anchor[] = [],
  iterations = 80,
): SimilarityFit {
  const a = [...indices.map(canonicalPoint), ...anchors.map((x) => x.canonical)];
  const b = indices.map((i) => imageToCamera(landmarksPx[i]));
  const w = anchors.length ? [...indices.map(() => 1), ...anchors.map((x) => x.weight)] : undefined;
  let fit = kabsch(a.slice(0, b.length), b);
  // La z de las anclas arranca en la del modelo ya ajustado.
  for (const x of anchors) {
    const m = add3(scale3(apply3(fit.rotation, x.canonical), fit.scale), fit.translation);
    b.push(v3(x.image.x, -x.image.y, m.z));
  }
  for (let it = 0; it < iterations; it++) {
    const filled = b.map((q, i) => v3(q.x, q.y, add3(scale3(apply3(fit.rotation, a[i]), fit.scale), fit.translation).z));
    const next = kabsch(a, filled, w);
    const change = rotationDistance(next.rotation, fit.rotation);
    fit = next;
    if (change < 1e-4 && it > 3) break;
  }
  let err = 0;
  for (let i = 0; i < indices.length; i++) {
    const m = add3(scale3(apply3(fit.rotation, a[i]), fit.scale), fit.translation);
    err += (m.x - b[i].x) ** 2 + (m.y - b[i].y) ** 2;
  }
  return { ...fit, rms: Math.sqrt(err / indices.length) };
}

/** Horn (cuaterniones): semejanza que lleva a → b (ambos en marco K), con pesos opcionales. */
function kabsch(a: Vec3[], b: Vec3[], w?: readonly number[]): SimilarityFit {
  const ca = weightedCentroid(a, w);
  const cb = weightedCentroid(b, w);
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < a.length; k++) {
    const wk = w ? w[k] : 1;
    if (wk === 0) continue;
    const p = sub3(a[k], ca);
    const q = sub3(b[k], cb);
    const pa = [p.x, p.y, p.z];
    const qb = [q.x, q.y, q.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i * 3 + j] += wk * pa[i] * qb[j];
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = S;
  const N = [
    xx + yy + zz, yz - zy, zx - xz, xy - yx,
    yz - zy, xx - yy - zz, xy + yx, zx + xz,
    zx - xz, xy + yx, -xx + yy - zz, yz + zy,
    xy - yx, zx + xz, yz + zy, -xx - yy + zz,
  ];
  const { vectors } = symmetricEigen(N, 4);
  const rotation = quatToMat3(vectors[0], vectors[4], vectors[8], vectors[12]);
  return completeFit(a, b, rotation, w);
}

function weightedCentroid(p: readonly Vec3[], w?: readonly number[]): Vec3 {
  if (!w) return centroid3(p);
  let x = 0;
  let y = 0;
  let z = 0;
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    x += w[i] * p[i].x;
    y += w[i] * p[i].y;
    z += w[i] * p[i].z;
    s += w[i];
  }
  return s > 0 ? v3(x / s, y / s, z / s) : centroid3(p);
}

/**
 * Con la rotación fija (p. ej. con ajuste fino), ajusta escala y traslación por
 * mínimos cuadrados en x, y. La z de la traslación se toma del modelo.
 */
export function fitScaleTranslation(
  landmarksPx: readonly Vec3[],
  rotation: Mat3,
  indices: readonly number[] = POSE_LANDMARKS,
): SimilarityFit {
  const a = indices.map(canonicalPoint);
  const b = indices.map((i) => imageToCamera(landmarksPx[i]));
  const ra = a.map((p) => apply3(rotation, p));
  const ca = centroid3(ra);
  const cb = centroid3(b);
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.length; i++) {
    num += (b[i].x - cb.x) * (ra[i].x - ca.x) + (b[i].y - cb.y) * (ra[i].y - ca.y);
    den += (ra[i].x - ca.x) ** 2 + (ra[i].y - ca.y) ** 2;
  }
  const scale = num / den;
  const translation = v3(cb.x - scale * ca.x, cb.y - scale * ca.y, cb.z - scale * ca.z);
  let err = 0;
  for (let i = 0; i < a.length; i++) {
    err += (ra[i].x * scale + translation.x - b[i].x) ** 2 + (ra[i].y * scale + translation.y - b[i].y) ** 2;
  }
  return { rotation, scale, translation, rms: Math.sqrt(err / a.length) };
}

function completeFit(a: Vec3[], b: Vec3[], rotation: Mat3, w?: readonly number[]): SimilarityFit {
  const ca = weightedCentroid(a, w);
  const cb = weightedCentroid(b, w);
  let num = 0;
  let den = 0;
  for (let k = 0; k < a.length; k++) {
    const wk = w ? w[k] : 1;
    const ra = apply3(rotation, sub3(a[k], ca));
    num += wk * dot3(sub3(b[k], cb), ra);
    den += wk * dot3(ra, ra);
  }
  const scale = num / den;
  const translation = sub3(cb, scale3(apply3(rotation, ca), scale));
  let err = 0;
  let ws = 0;
  for (let k = 0; k < a.length; k++) {
    const wk = w ? w[k] : 1;
    const r = sub3(b[k], add3(scale3(apply3(rotation, a[k]), scale), translation));
    err += wk * dot3(r, r);
    ws += wk;
  }
  return { rotation, scale, translation, rms: Math.sqrt(err / (ws || 1)) };
}

/** Proyecta un punto canónico (cm) a la imagen (px) con un ajuste dado. */
export function projectCanonical(fit: Pick<SimilarityFit, 'rotation' | 'scale' | 'translation'>, p: Vec3): Vec3 {
  const k = apply3(fit.rotation, p);
  return v3(
    k.x * fit.scale + fit.translation.x,
    -(k.y * fit.scale + fit.translation.y),
    -(k.z * fit.scale + fit.translation.z),
  );
}

/** Lleva un punto de la imagen (px) al marco canónico (cm), deshaciendo la pose. */
export function unprojectToCanonical(fit: Pick<SimilarityFit, 'rotation' | 'scale' | 'translation'>, p: Vec3): Vec3 {
  const k = scale3(sub3(imageToCamera(p), fit.translation), 1 / fit.scale);
  return apply3(transpose3(fit.rotation), k);
}

// ---------------------------------------------------------------------------
// Comprobación geométrica del signo del giro.

export interface SignCheck {
  /** Desplazamiento horizontal de la punta de la nariz respecto del centro
   * de los ojos, a lo largo de la línea de los ojos, en unidades de distancia
   * entre pupilas. Positivo = hacia la derecha de la foto. */
  noseOffset: number;
  /** Giro que predice ese desplazamiento con la profundidad canónica. */
  predictedYaw: number;
  consistent: boolean;
}

/** Profundidad canónica de la punta de la nariz delante de los ojos, en cm (el
 * párpado superior hace de pupila: el modelo canónico no trae iris). */
const NOSE_DEPTH_CM = canonicalPoint(LM.noseTip).z - (canonicalPoint(LM.subjectRight.eyeUpperLid).z + canonicalPoint(LM.subjectLeft.eyeUpperLid).z) / 2;
const IPD_CM = canonicalPoint(LM.subjectLeft.eyeUpperLid).x - canonicalPoint(LM.subjectRight.eyeUpperLid).x;

export function checkPoseSign(lm: readonly Vec3[], yawDeg: number): SignCheck {
  const pr = lm[LM.subjectRight.pupil];
  const pl = lm[LM.subjectLeft.pupil];
  // Eje de los ojos de izquierda a derecha de la foto.
  const left = pr.x <= pl.x ? pr : pl;
  const right = pr.x <= pl.x ? pl : pr;
  const ux = right.x - left.x;
  const uy = right.y - left.y;
  const ipd = Math.hypot(ux, uy) || 1;
  const mx = (left.x + right.x) / 2;
  const my = (left.y + right.y) / 2;
  const tip = lm[LM.noseTip];
  const noseOffset = ((tip.x - mx) * ux + (tip.y - my) * uy) / ipd / ipd;
  // Desplazamiento = profundidad·sen(giro); distancia entre pupilas
  // proyectada = IPD·cos(giro). El cociente da tan(giro).
  const predictedYaw = deg(Math.atan((noseOffset * IPD_CM) / NOSE_DEPTH_CM));
  const consistent = Math.abs(yawDeg) < 5 || Math.sign(noseOffset) === Math.sign(yawDeg);
  return { noseOffset, predictedYaw, consistent };
}

// ---------------------------------------------------------------------------
// Estimación completa.

export interface PoseEstimate {
  /** Rotación final C → K (con ajuste fino). */
  rotation: Mat3;
  /** Ángulos finales (detectados + ajuste fino). */
  angles: PoseAngles;
  /** Ángulos del ajuste ortográfico a la malla (fuente principal). */
  fitAngles: PoseAngles;
  /** Ángulos del ajuste 3D con la z del detector (diagnóstico). */
  mesh3DAngles: PoseAngles;
  /** Ángulos de la matriz de MediaPipe (verificación cruzada). */
  matrixAngles: PoseAngles | null;
  /** Diferencia (grados) entre la matriz y el ajuste a la malla detectada. */
  agreement: number | null;
  /** Ajuste de semejanza con la rotación final (marco de la cabeza). */
  frame: SimilarityFit;
  sign: SignCheck;
}

export interface PoseInputs {
  landmarks: readonly Vec3[];
  /** Landmarks tal como salieron del detector (antes de correcciones). */
  detectedLandmarks: readonly Vec3[];
  matrix: ArrayLike<number> | null;
  adjust: PoseAngles;
  /** Puntos fuera de la malla confirmados por el usuario (orejas). */
  anchors?: readonly Anchor[];
}

export function estimatePose({ landmarks, detectedLandmarks, matrix, adjust, anchors = [] }: PoseInputs): PoseEstimate {
  const fit = fitSimilarity2D(landmarks, POSE_LANDMARKS, anchors);
  const fitAngles = anglesFromRotation(fit.rotation);
  const mesh3DAngles = anglesFromRotation(fitSimilarity(landmarks).rotation);
  let matrixAngles: PoseAngles | null = null;
  let agreement: number | null = null;
  if (matrix) {
    const fromMatrix = parseTransformMatrix(matrix).rotation;
    matrixAngles = anglesFromRotation(fromMatrix);
    const detectedFit = landmarks === detectedLandmarks ? fit : fitSimilarity2D(detectedLandmarks);
    agreement = rotationDistance(fromMatrix, detectedFit.rotation);
  }
  const angles: PoseAngles = {
    yaw: fitAngles.yaw + adjust.yaw,
    pitch: fitAngles.pitch + adjust.pitch,
    roll: fitAngles.roll + adjust.roll,
  };
  const adjusted = adjust.yaw !== 0 || adjust.pitch !== 0 || adjust.roll !== 0;
  const rotation = adjusted ? rotationFromAngles(angles) : fit.rotation;
  const frame = adjusted ? fitScaleTranslation(landmarks, rotation) : fit;
  return { rotation, angles, fitAngles, mesh3DAngles, matrixAngles, agreement, frame, sign: checkPoseSign(landmarks, angles.yaw) };
}
