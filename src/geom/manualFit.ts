// Modo manual (§5.5): para perfil puro, dibujos y caras que el detector no
// encuentra, el usuario marca unos cuantos puntos y la malla canónica de
// MediaPipe se deforma para pasar por ellos. Con eso el resto de la app (pose,
// Loomis, blocking, luz, valores) trabaja igual que con la detección.
//
// 1) Semejanza ortográfica con escala por eje del modelo:
//      p = s · R · diag(kx, ky, kz) · c + t
//    La rotación sale de la misma iteración que la pose (se completa la z con
//    el modelo y se resuelve Horn), desde varios arranques de giro según la
//    vista elegida; se queda el de menor error. Las escalas por eje se ajustan
//    por mínimos cuadrados con un ancla en 1: en perfil el ancho no se ve y se
//    queda en el del modelo.
// 2) Deformación suave: el residuo de cada punto marcado se reparte a la malla
//    con funciones de base radial gaussianas en el marco canónico (σ = 2 cm).
//    La malla pasa por los puntos sin pliegues y, lejos de ellos, queda rígida.
//    Los puntos fuera de la malla (orejas, trago y ángulo de la mandíbula de
//    perfil) no la deforman: su posición canónica es una estimación, así que
//    solo anclan el ajuste rígido, con medio peso.
//
// De perfil, el «ángulo de la mandíbula» y el «pómulo junto a la oreja» de la
// malla no sirven: el óvalo de MediaPipe pasa unos 2 cm por delante del trago y
// del ángulo real, y quien marca a ojo hace clic en los reales (en una foto de
// perfil el residuo llegó a 100 px). Ahí se marcan el trago y el ángulo de la
// mandíbula anatómicos: anclan el ajuste rígido con su posición estimada y,
// además, el vértice del óvalo correspondiente (454/234 y 397/172) se lleva
// hasta ellos al deformar, así la malla llega al contorno real de la mandíbula
// y a la oreja.
//
// La cara puede mirar a cualquier lado: en ¾ y perfil los puntos se nombran
// «del lado cercano» o «del lado lejano» y el lado del sujeto sale del ajuste
// (se prueban los dos y gana el que alinea mejor con el giro correcto).

import { EAR_LOBE, EAR_TOP, KEY_BY_ID, type ExtraId } from '../detect/keypoints';
import { LEFT_EYE_CONTOUR, LM, RIGHT_EYE_CONTOUR, SUBJECT_LEFT, SUBJECT_RIGHT } from '../detect/landmarkMap';
import { CANONICAL_COUNT, canonicalPoint } from './canonical';
import { anglesFromRotation, kabsch, projectCanonical, rotationDistance, rotationFromAngles, type SimilarityFit } from './pose';
import { add3, apply3, centroid3, v2, v3, type Mat3, type Vec2, type Vec3 } from './vec';

export type ManualView = 'front' | 'threeQuarter' | 'profile';
/** Hacia qué lado de la foto mira la cara. */
export type Facing = 'left' | 'right';

/**
 * Listas de puntos por vista. En frente los lados son del sujeto (R aparece a la
 * izquierda de la foto); en ¾ y perfil, N = lado cercano y F = lado lejano.
 * `chin` es el frente del mentón (solo se ve bien de perfil).
 */
export const MANUAL_POINTS: Record<ManualView, readonly string[]> = {
  front: [
    'pupilR', 'pupilL', 'eyeOuterR', 'eyeInnerR', 'eyeInnerL', 'eyeOuterL', 'browPeakR', 'browPeakL',
    'nasion', 'noseTip', 'alaR', 'alaL', 'subnasale', 'mouthR', 'mouthL', 'upperLip', 'lowerLip',
    'menton', 'jawR', 'jawL', 'cheekR', 'cheekL',
  ],
  threeQuarter: [
    'pupilN', 'pupilF', 'eyeOuterN', 'eyeInnerN', 'eyeInnerF', 'eyeOuterF', 'browPeakN', 'browPeakF',
    'nasion', 'noseTip', 'alaN', 'subnasale', 'mouthN', 'mouthF', 'upperLip', 'lowerLip', 'menton',
    'jawN', 'cheekN', 'earTopN', 'earLobeN',
  ],
  profile: [
    'nasion', 'browPeakN', 'eyeOuterN', 'pupilN', 'noseTip', 'alaN', 'subnasale', 'upperLip', 'mouthN',
    'lowerLip', 'chin', 'menton', 'gonionN', 'tragusN', 'earTopN', 'earLobeN',
  ],
};

/**
 * Puntos anatómicos fuera de la malla (cm, marco canónico, lado izquierdo del
 * sujeto; el derecho se refleja en x). Estimaciones con proporciones de adulto:
 * el trago, sobre el plano de Fráncfort (a la altura del borde bajo de la
 * órbita) y al frente de la oreja; el ángulo de la mandíbula, bajo el lóbulo,
 * a la altura de la boca y con el ancho bigonial medio (≈ 9.6 cm).
 */
const TRAGUS = v3(6.9, 1.5, -4.1);
const GONION = v3(4.8, -5.8, -3.0);

/** Puntos marcados mínimos para construir la malla (sin contar orejas), con al menos dos fuera de la línea media. */
export const MANUAL_MIN_POINTS = 5;

/** Puntos que solo anclan el ajuste rígido (fuera de la malla). */
export function manualAnchor(id: string): boolean {
  return /^(earTop|earLobe|tragus|gonion)/.test(id);
}

/** Lado de un id: R/L (sujeto), N/F (cercano/lejano) o ninguno (línea media). */
export function manualSide(id: string): 'R' | 'L' | 'N' | 'F' | null {
  if (id === 'chin') return null;
  const last = id.slice(-1);
  return last === 'R' || last === 'L' || last === 'N' || last === 'F' ? (last as 'R' | 'L' | 'N' | 'F') : null;
}

/** Nombre del rasgo sin el lado: «pupilN» → «pupil». */
export function manualBase(id: string): string {
  return manualSide(id) ? id.slice(0, -1) : id;
}

/** Lado del sujeto que corresponde a un id, según hacia dónde mira la cara. */
function subjectSide(id: string, facing: Facing): 'R' | 'L' | null {
  const s = manualSide(id);
  if (s === 'R' || s === 'L') return s;
  if (!s) return null;
  // + giro (mira a la derecha de la foto) deja al frente el lado derecho del sujeto.
  const near: 'R' | 'L' = facing === 'right' ? 'R' : 'L';
  return s === 'N' ? near : near === 'R' ? 'L' : 'R';
}

/** Id del punto clave de la app (y su landmark o punto extra) para un id de la lista. */
export function manualKey(id: string, facing: Facing): { key: string; landmark?: number; extra?: ExtraId } {
  if (id === 'chin') return { key: 'chin', landmark: LM.chinFront };
  const side = subjectSide(id, facing);
  const base = manualBase(id);
  if (base === 'tragus' || base === 'gonion') return { key: base + side };
  const key = side ? manualBase(id) + side : id;
  const def = KEY_BY_ID.get(key);
  if (!def) throw new Error(`punto manual desconocido: ${id}`);
  return { key, landmark: def.landmark, extra: def.extra };
}

// ---------------------------------------------------------------------------
// Puntos canónicos.

/** Centro de la pupila en el canónico (el modelo no trae iris): centro del contorno del ojo, un poco al frente (córnea). */
const PUPIL_FORWARD = 0.3;
/** Radio del iris (cm): diámetro medio ≈ 11.7 mm. */
const IRIS_RADIUS = 0.58;

function pupilCanonical(side: 'R' | 'L'): Vec3 {
  const c = centroid3((side === 'R' ? RIGHT_EYE_CONTOUR : LEFT_EYE_CONTOUR).map(canonicalPoint));
  return v3(c.x, c.y, c.z + PUPIL_FORWARD);
}

/** 478 puntos canónicos: la malla y los dos iris (centro + 4 en cruz). */
const CANONICAL_478: readonly Vec3[] = (() => {
  const out: Vec3[] = [];
  for (let i = 0; i < CANONICAL_COUNT; i++) out.push(canonicalPoint(i));
  for (const side of ['R', 'L'] as const) {
    const c = pupilCanonical(side);
    out.push(c, v3(c.x + IRIS_RADIUS, c.y, c.z), v3(c.x, c.y + IRIS_RADIUS, c.z), v3(c.x - IRIS_RADIUS, c.y, c.z), v3(c.x, c.y - IRIS_RADIUS, c.z));
  }
  return out;
})();

/** Vértice del óvalo que el trago y el ángulo de la mandíbula llevan consigo al deformar. */
function ovalTarget(id: string, facing: Facing): number | undefined {
  const base = manualBase(id);
  const side = subjectSide(id, facing) === 'R' ? SUBJECT_RIGHT : SUBJECT_LEFT;
  return base === 'tragus' ? side.cheekTragus : base === 'gonion' ? side.jawAngle : undefined;
}

/** Punto canónico de un id de la lista (y si es un ancla fuera de la malla). */
export function manualCanonical(id: string, facing: Facing): { canon: Vec3; anchor: boolean } {
  const k = manualKey(id, facing);
  if (k.landmark !== undefined) return { canon: CANONICAL_478[k.landmark], anchor: false };
  const side = subjectSide(id, facing)!;
  const base = manualBase(id);
  const e = base === 'earTop' ? EAR_TOP : base === 'earLobe' ? EAR_LOBE : base === 'tragus' ? TRAGUS : GONION;
  return { canon: v3(side === 'R' ? -e.x : e.x, e.y, e.z), anchor: true };
}

// ---------------------------------------------------------------------------
// Ajuste.

export interface ManualFit {
  /** Semejanza canónico (escalado por eje) → imagen, como la de la pose. */
  frame: SimilarityFit;
  /** Escala relativa del modelo por eje canónico. */
  axes: Vec3;
  facing: Facing;
  /** Error RMS del ajuste rígido en los puntos marcados (px), antes de la deformación. */
  rms: number;
  /** 478 landmarks (px de la imagen; z en la misma escala), como los del detector. */
  landmarks: Vec3[];
}

interface Corr {
  canon: Vec3;
  image: Vec2;
  w: number;
  anchor: boolean;
  /** Vértice de la malla que se lleva hasta este punto al deformar (anclas del óvalo). */
  mesh?: number;
}

/** Peso de un ancla (oreja, trago, ángulo de la mandíbula) relativo a un punto de la malla. */
const ANCHOR_WEIGHT = 0.5;
/** Ancho de la deformación (cm, marco canónico). */
const RBF_SIGMA = 2;
const RBF_RIDGE = 0.02;
/** Límites de la escala por eje. */
const AXIS_MIN = 0.8;
const AXIS_MAX = 1.25;

const START_YAWS: Record<ManualView, readonly number[]> = {
  front: [-15, 0, 15],
  threeQuarter: [25, 40, 55],
  profile: [65, 80, 95],
};
const START_PITCHES = [-15, 0, 15];
/**
 * Giro esperado por vista (valor absoluto). Fuera de este rango la solución se
 * penaliza (la vista elegida puede no ser exacta) y más allá de los límites
 * duros se descarta: con los rasgos marcados a la vista, la cara no puede estar
 * de espaldas. En ¾ y perfil, además, el giro va hacia el lado que mira la cara.
 */
const YAW_RANGE: Record<ManualView, [number, number]> = { front: [0, 35], threeQuarter: [10, 75], profile: [50, 115] };
const MAX_YAW = 120;
const MAX_PITCH = 60;
const MIN_SIDE_YAW = 5;
const OUT_OF_RANGE = 1.5;

/** ¿Hay suficientes puntos para construir la malla? */
export function manualReady(placed: Readonly<Record<string, Vec2 | undefined>>, view: ManualView): boolean {
  const ids = MANUAL_POINTS[view].filter((id) => placed[id] && !manualAnchor(id));
  return ids.length >= MANUAL_MIN_POINTS && ids.filter((id) => manualSide(id)).length >= 2;
}

/**
 * Ajusta la malla a los puntos marcados. `prev` (la rotación anterior) entra
 * como un arranque más, para que la malla no salte mientras se arrastra.
 */
export function fitManual(view: ManualView, placed: Readonly<Record<string, Vec2 | undefined>>, prev?: Mat3): ManualFit | null {
  if (!manualReady(placed, view)) return null;
  const facings: Facing[] = view === 'front' ? ['right'] : ['left', 'right'];
  let best: (Omit<ManualFit, 'landmarks'> & { corr: Corr[]; score: number }) | null = null;
  const [lo, hi] = YAW_RANGE[view];
  for (const facing of facings) {
    const corr: Corr[] = [];
    for (const id of MANUAL_POINTS[view]) {
      const p = placed[id];
      if (!p) continue;
      const { canon, anchor } = manualCanonical(id, facing);
      corr.push({ canon, image: p, w: anchor ? ANCHOR_WEIGHT : 1, anchor, mesh: ovalTarget(id, facing) });
    }
    const sign = facing === 'right' ? 1 : -1;
    const starts: Mat3[] = [];
    for (const yaw of START_YAWS[view]) for (const pitch of START_PITCHES) starts.push(rotationFromAngles({ yaw: view === 'front' ? yaw : sign * yaw, pitch, roll: 0 }));
    if (prev) starts.push(prev);
    for (const start of starts) {
      const r = solve(corr, start);
      if (!r) continue;
      const a = anglesFromRotation(r.frame.rotation);
      if (Math.abs(a.yaw) > MAX_YAW || Math.abs(a.pitch) > MAX_PITCH) continue;
      if (view !== 'front' && sign * a.yaw < MIN_SIDE_YAW) continue;
      const score = r.rms * (Math.abs(a.yaw) >= lo && Math.abs(a.yaw) <= hi ? 1 : OUT_OF_RANGE);
      if (!best || score < best.score - 1e-6) best = { ...r, facing, corr, score };
    }
  }
  if (!best) return null;
  return { frame: best.frame, axes: best.axes, facing: best.facing, rms: best.rms, landmarks: deform(best.frame, best.axes, best.corr) };
}

const scaleAxes = (c: Vec3, k: Vec3) => v3(c.x * k.x, c.y * k.y, c.z * k.z);
/** Imagen (y abajo) → marco K (y arriba). */
const toK = (p: Vec2) => v3(p.x, -p.y, 0);

function solve(corr: readonly Corr[], start: Mat3): { frame: SimilarityFit; axes: Vec3; rms: number } | null {
  const w = corr.map((c) => c.w);
  const bK = corr.map((c) => toK(c.image));
  let axes = v3(1, 1, 1);
  let frame = scaleTranslation(corr.map((c) => c.canon), bK, w, start);
  if (!frame) return null;
  for (let outer = 0; outer < 10; outer++) {
    const m = corr.map((c) => scaleAxes(c.canon, axes));
    frame = refine(m, bK, w, frame);
    axes = solveAxes(corr, frame, axes);
  }
  const m = corr.map((c) => scaleAxes(c.canon, axes));
  frame = refine(m, bK, w, frame);
  let err = 0;
  let ws = 0;
  corr.forEach((c, i) => {
    const q = projectCanonical(frame, m[i]);
    err += w[i] * ((q.x - c.image.x) ** 2 + (q.y - c.image.y) ** 2);
    ws += w[i];
  });
  const rms = Math.sqrt(err / ws);
  return Number.isFinite(rms) ? { frame: { ...frame, rms }, axes, rms } : null;
}

/** Escala y traslación (en x, y) con la rotación fija. */
function scaleTranslation(a: readonly Vec3[], bK: readonly Vec3[], w: readonly number[], rotation: Mat3): SimilarityFit | null {
  const ra = a.map((p) => apply3(rotation, p));
  let W = 0;
  let cax = 0;
  let cay = 0;
  let cbx = 0;
  let cby = 0;
  ra.forEach((p, i) => {
    W += w[i];
    cax += w[i] * p.x;
    cay += w[i] * p.y;
    cbx += w[i] * bK[i].x;
    cby += w[i] * bK[i].y;
  });
  cax /= W;
  cay /= W;
  cbx /= W;
  cby /= W;
  let num = 0;
  let den = 0;
  ra.forEach((p, i) => {
    num += w[i] * ((bK[i].x - cbx) * (p.x - cax) + (bK[i].y - cby) * (p.y - cay));
    den += w[i] * ((p.x - cax) ** 2 + (p.y - cay) ** 2);
  });
  if (den < 1e-9 || num <= 0) return null;
  const scale = num / den;
  return { rotation, scale, translation: v3(cbx - scale * cax, cby - scale * cay, 0), rms: 0 };
}

/** Iteración ortográfica: se completa la z de cada punto con la del modelo y se resuelve Horn. */
function refine(m: readonly Vec3[], bK: readonly Vec3[], w: readonly number[], start: SimilarityFit): SimilarityFit {
  let fit = start;
  for (let it = 0; it < 60; it++) {
    const filled = bK.map((q, i) => v3(q.x, q.y, add3(scaleK(apply3(fit.rotation, m[i]), fit.scale), fit.translation).z));
    const next = kabsch([...m], filled, w);
    const change = rotationDistance(next.rotation, fit.rotation);
    fit = next;
    if (change < 1e-4 && it > 2) break;
  }
  return fit;
}

const scaleK = (p: Vec3, k: number) => v3(p.x * k, p.y * k, p.z * k);

/**
 * Escala por eje con la rotación, escala y traslación fijas: mínimos cuadrados
 * en x, y con un ancla en 1 (lo que no se ve, como el ancho en perfil, no se mueve).
 */
function solveAxes(corr: readonly Corr[], frame: SimilarityFit, prev: Vec3): Vec3 {
  const R = frame.rotation;
  const s = frame.scale;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const rhs = [0, 0, 0];
  let W = 0;
  for (const c of corr) {
    if (c.anchor) continue;
    const q = toK(c.image);
    const cc = [c.canon.x, c.canon.y, c.canon.z];
    // Filas de la proyección: x y y del marco K.
    for (const [row, target] of [[0, q.x - frame.translation.x], [1, q.y - frame.translation.y]] as const) {
      const a = [s * R[row * 3] * cc[0], s * R[row * 3 + 1] * cc[1], s * R[row * 3 + 2] * cc[2]];
      for (let i = 0; i < 3; i++) {
        rhs[i] += c.w * a[i] * target;
        for (let j = 0; j < 3; j++) A[i * 3 + j] += c.w * a[i] * a[j];
      }
    }
    W += c.w;
  }
  const lambda = 0.5 * W * s * s;
  for (let i = 0; i < 3; i++) {
    A[i * 4] += lambda;
    rhs[i] += lambda;
  }
  const k = solveLinear(A, rhs, 3);
  if (!k) return prev;
  const clampK = (x: number) => Math.min(AXIS_MAX, Math.max(AXIS_MIN, x));
  return v3(clampK(k[0]), clampK(k[1]), clampK(k[2]));
}

/** Malla deformada: ajuste rígido más el residuo de cada punto repartido con gaussianas. */
function deform(frame: SimilarityFit, axes: Vec3, corr: readonly Corr[]): Vec3[] {
  // Puntos de la malla y anclas del óvalo (con su vértice); las orejas no deforman.
  const used = corr.filter((c) => !c.anchor || c.mesh !== undefined);
  const centers = used.map((c) => scaleAxes(c.mesh !== undefined ? CANONICAL_478[c.mesh] : c.canon, axes));
  const n = centers.length;
  const g = (a: Vec3, b: Vec3) => Math.exp(-((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) / (2 * RBF_SIGMA * RBF_SIGMA));
  const G: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) G.push(g(centers[i], centers[j]) + (i === j ? RBF_RIDGE : 0));
  const dx: number[] = [];
  const dy: number[] = [];
  used.forEach((c, i) => {
    const q = projectCanonical(frame, centers[i]);
    dx.push(c.image.x - q.x);
    dy.push(c.image.y - q.y);
  });
  const ax = solveLinear([...G], dx, n) ?? new Array<number>(n).fill(0);
  const ay = solveLinear([...G], dy, n) ?? new Array<number>(n).fill(0);
  return CANONICAL_478.map((c) => {
    const m = scaleAxes(c, axes);
    const q = projectCanonical(frame, m);
    let ox = 0;
    let oy = 0;
    for (let i = 0; i < n; i++) {
      const k = g(m, centers[i]);
      ox += ax[i] * k;
      oy += ay[i] * k;
    }
    return v3(q.x + ox, q.y + oy, q.z);
  });
}

/** Eliminación gaussiana con pivoteo parcial (A en orden de filas, n × n). */
function solveLinear(A: number[], b: number[], n: number): number[] | null {
  const M = A.slice();
  const x = b.slice();
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
    if (Math.abs(M[p * n + c]) < 1e-12) return null;
    if (p !== c) {
      for (let k = 0; k < n; k++) [M[c * n + k], M[p * n + k]] = [M[p * n + k], M[c * n + k]];
      [x[c], x[p]] = [x[p], x[c]];
    }
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c] / M[c * n + c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k];
      x[r] -= f * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
  }
  return x;
}

/** Posición de cada punto de la lista en una malla (para pruebas y para proponer posiciones). */
export function manualPointsFrom(landmarks: readonly Vec3[], view: ManualView, facing: Facing): Record<string, Vec2> {
  const out: Record<string, Vec2> = {};
  for (const id of MANUAL_POINTS[view]) {
    const k = manualKey(id, facing);
    const q = k.landmark !== undefined ? landmarks[k.landmark] : undefined;
    if (q) out[id] = v2(q.x, q.y);
  }
  return out;
}
