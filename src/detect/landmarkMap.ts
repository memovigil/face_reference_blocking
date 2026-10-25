// Índices nombrados de la malla de MediaPipe Face Landmarker (478 puntos).
//
// CÓMO SE VERIFICÓ (fase 1, 2026‑10‑25)
// 1. Simetría y línea media, con el modelo canónico oficial
//    (reference/canonical_face_model.obj; script: tests/unit/landmarkMap.test.ts):
//    - Todos los índices de `MIDLINE` tienen x = 0 y van de arriba a abajo
//      (y decreciente): 10 → 151 → 9 → 8 → 168 → 6 → 197 → 195 → 5 → 4 → 1 →
//      19 → 94 → 2 → 164 → 0 → 13 → 14 → 17 → 18 → 200 → 199 → 175 → 152.
//    - Cada par subjectRight/subjectLeft es el espejo exacto (x → −x) del otro.
//    - Los índices subjectRight tienen x < 0 en el canónico. Como +x canónico es
//      la izquierda del sujeto, x < 0 es su DERECHA, que en una foto sin espejo
//      aparece a la IZQUIERDA. Coincide con FACE_LANDMARKS_RIGHT_EYE (33, 133…)
//      y FACE_LANDMARKS_RIGHT_IRIS (469–472, centro 468) de tasks-vision.
// 2. Posición semántica, contra la textura oficial
//    canonical_face_model_uv_visualization.png (números impresos): se marcó cada
//    índice en su coordenada UV y se comparó con el número impreso. Coinciden
//    ojos, cejas, nariz y boca.
// 3. Sobre fotos reales con la capa «Índices» (tests/screenshots/fase1/indices-*):
//    se revisó a zoom alto que cada punto caiga en el rasgo nombrado.
//
// CORRECCIONES respecto a la tabla de candidatos del documento de diseño:
//  - Punta de nariz: el más saliente del canónico es 4 (z = 7.59), no 1
//    (z = 7.48, ligeramente abajo, hacia la columela). Se usa 4 como pronasal.
//  - Ala de la nariz: 129/358 es el punto más lateral del ala en el canónico
//    (|x| = 1.79 contra 1.59–1.73 de 64, 48, 102). Como cada nariz es distinta,
//    el ancho se mide con el máximo de `NOSE_ALA_CANDIDATES` en marco canónico.
//  - 127/356 y 234/454 están en el borde del óvalo junto a la oreja (z ≈ −2),
//    no en la sien frontal. Se nombran «borde lateral alto» y «pómulo/trago».
//  - Ángulo de mandíbula: 172/397 está más abajo y adelante (y = −6.2) que
//    58/288 (y = −4.8). En fotos reales 172/397 cae más cerca del gonion.
//
// Convención: subjectLeft/subjectRight = lado del SUJETO. Los textos de la
// interfaz dicen «izquierda/derecha de la foto» y se calculan con la posición.

export interface SideMap {
  eyeOuter: number;
  eyeInner: number;
  eyeUpperLid: number;
  eyeLowerLid: number;
  pupil: number;
  irisRing: readonly number[];
  browOuter: number;
  browPeak: number;
  browInner: number;
  noseAla: number;
  noseAlaLow: number;
  noseBridge: number;
  mouthCorner: number;
  mouthInnerCorner: number;
  cupidPeak: number;
  lowerLip: number;
  ovalUpper: number;
  cheekTragus: number;
  jawAngle: number;
  jawUpper: number;
  chinSide: number;
  cheekbone: number;
}

export const SUBJECT_RIGHT: SideMap = {
  eyeOuter: 33,
  eyeInner: 133,
  eyeUpperLid: 159,
  eyeLowerLid: 145,
  pupil: 468,
  irisRing: [469, 470, 471, 472],
  browOuter: 70,
  browPeak: 105,
  browInner: 107,
  noseAla: 129,
  noseAlaLow: 64,
  noseBridge: 193,
  mouthCorner: 61,
  mouthInnerCorner: 78,
  cupidPeak: 37,
  lowerLip: 84,
  ovalUpper: 127,
  cheekTragus: 234,
  jawAngle: 172,
  jawUpper: 58,
  chinSide: 148,
  cheekbone: 116,
};

export const SUBJECT_LEFT: SideMap = {
  eyeOuter: 263,
  eyeInner: 362,
  eyeUpperLid: 386,
  eyeLowerLid: 374,
  pupil: 473,
  irisRing: [474, 475, 476, 477],
  browOuter: 300,
  browPeak: 334,
  browInner: 336,
  noseAla: 358,
  noseAlaLow: 294,
  noseBridge: 417,
  mouthCorner: 291,
  mouthInnerCorner: 308,
  cupidPeak: 267,
  lowerLip: 314,
  ovalUpper: 356,
  cheekTragus: 454,
  jawAngle: 397,
  jawUpper: 288,
  chinSide: 377,
  cheekbone: 345,
};

export const LM = {
  foreheadTop: 10,
  glabella: 9,
  nasion: 168,
  noseTip: 4,
  noseTipLower: 1,
  columella: 94,
  subnasale: 2,
  upperLipTop: 0,
  upperLipInner: 13,
  lowerLipInner: 14,
  lowerLipBottom: 17,
  labiomental: 18,
  chinFront: 199,
  menton: 152,
  subjectRight: SUBJECT_RIGHT,
  subjectLeft: SUBJECT_LEFT,
} as const;

/** Línea media de arriba abajo (verificada: x = 0 en el canónico). */
export const MIDLINE = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 0, 13, 14, 17, 18, 200, 199, 175, 152] as const;

/** Candidatos al punto más ancho del ala nasal, por lado. */
export const NOSE_ALA_CANDIDATES = {
  subjectRight: [129, 102, 64, 48, 49, 98, 219],
  subjectLeft: [358, 331, 294, 278, 279, 327, 439],
} as const;

/** Óvalo de la cara en orden (FACE_LANDMARKS_FACE_OVAL de tasks-vision). */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;

export const RIGHT_EYE_CONTOUR = [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173] as const;
export const LEFT_EYE_CONTOUR = [263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398] as const;
export const LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409, 78, 95, 88, 178, 87, 14, 317,
  402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415,
] as const;

/** Cejas, ambos lados (se mueven con la expresión). */
export const BROWS = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107, 276, 283, 282, 295, 285, 300, 293, 334, 296, 336] as const;

/**
 * Landmarks que se mueven con la expresión (párpados y cejas). Se excluyen al
 * estimar la pose; las esquinas de los ojos sí se usan porque casi no se mueven.
 */
export const EXPRESSION_MOBILE: ReadonlySet<number> = new Set<number>([
  ...RIGHT_EYE_CONTOUR.filter((i) => i !== 33 && i !== 133),
  ...LEFT_EYE_CONTOUR.filter((i) => i !== 263 && i !== 362),
  ...BROWS,
]);
