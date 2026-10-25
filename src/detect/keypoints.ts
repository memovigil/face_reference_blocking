// Puntos clave para el paso «Revisar puntos»: ~25 puntos nombrados en lugar de
// los 478 de la malla. Unos salen de la malla (índice de landmark) y otros no
// existen en ella (cabello, cráneo, orejas): esos se estiman y se marcan como
// «estimado» hasta que el usuario los coloca.

import { canonicalPoint } from '../geom/canonical';
import { projectCanonical, type Anchor, type SimilarityFit } from '../geom/pose';
import { headAxis, type HeadSilhouette } from '../geom/silhouette';
import { apply3, col3, dist2, v2, v3, type Vec2, type Vec3 } from '../geom/vec';
import { LM, SUBJECT_LEFT as L, SUBJECT_RIGHT as R } from './landmarkMap';

export type KeyGroup = 'midline' | 'eyes' | 'brows' | 'nose' | 'mouth' | 'contour' | 'skull';

export type ExtraId = 'crown' | 'hairline' | 'skullR' | 'skullL' | 'skullBack' | 'earTopR' | 'earTopL' | 'earLobeR' | 'earLobeL';

export interface KeyDef {
  id: string;
  group: KeyGroup;
  /** Índice de landmark, si el punto está en la malla. */
  landmark?: number;
  /** Id del punto estimado, si no está en la malla. */
  extra?: ExtraId;
  /** Lado del sujeto (para el texto «izq./der. de la foto»). */
  side?: 'R' | 'L';
}

export const KEY_DEFS: readonly KeyDef[] = [
  { id: 'crown', group: 'skull', extra: 'crown' },
  { id: 'hairline', group: 'midline', extra: 'hairline' },
  { id: 'foreheadTop', group: 'midline', landmark: LM.foreheadTop },
  { id: 'nasion', group: 'midline', landmark: LM.nasion },
  { id: 'noseTip', group: 'midline', landmark: LM.noseTip },
  { id: 'subnasale', group: 'midline', landmark: LM.subnasale },
  { id: 'upperLip', group: 'midline', landmark: LM.upperLipTop },
  { id: 'lowerLip', group: 'midline', landmark: LM.lowerLipBottom },
  { id: 'menton', group: 'midline', landmark: LM.menton },
  { id: 'pupilR', group: 'eyes', landmark: R.pupil, side: 'R' },
  { id: 'pupilL', group: 'eyes', landmark: L.pupil, side: 'L' },
  { id: 'eyeOuterR', group: 'eyes', landmark: R.eyeOuter, side: 'R' },
  { id: 'eyeOuterL', group: 'eyes', landmark: L.eyeOuter, side: 'L' },
  { id: 'eyeInnerR', group: 'eyes', landmark: R.eyeInner, side: 'R' },
  { id: 'eyeInnerL', group: 'eyes', landmark: L.eyeInner, side: 'L' },
  { id: 'browPeakR', group: 'brows', landmark: R.browPeak, side: 'R' },
  { id: 'browPeakL', group: 'brows', landmark: L.browPeak, side: 'L' },
  { id: 'alaR', group: 'nose', landmark: R.noseAla, side: 'R' },
  { id: 'alaL', group: 'nose', landmark: L.noseAla, side: 'L' },
  { id: 'mouthR', group: 'mouth', landmark: R.mouthCorner, side: 'R' },
  { id: 'mouthL', group: 'mouth', landmark: L.mouthCorner, side: 'L' },
  { id: 'cheekR', group: 'contour', landmark: R.cheekTragus, side: 'R' },
  { id: 'cheekL', group: 'contour', landmark: L.cheekTragus, side: 'L' },
  { id: 'jawR', group: 'contour', landmark: R.jawAngle, side: 'R' },
  { id: 'jawL', group: 'contour', landmark: L.jawAngle, side: 'L' },
  { id: 'skullR', group: 'skull', extra: 'skullR', side: 'R' },
  { id: 'skullL', group: 'skull', extra: 'skullL', side: 'L' },
  { id: 'skullBack', group: 'skull', extra: 'skullBack' },
  { id: 'earTopR', group: 'skull', extra: 'earTopR', side: 'R' },
  { id: 'earLobeR', group: 'skull', extra: 'earLobeR', side: 'R' },
  { id: 'earTopL', group: 'skull', extra: 'earTopL', side: 'L' },
  { id: 'earLobeL', group: 'skull', extra: 'earLobeL', side: 'L' },
];

export const KEY_BY_ID: ReadonlyMap<string, KeyDef> = new Map(KEY_DEFS.map((k) => [k.id, k]));

export interface KeyPoint {
  def: KeyDef;
  p: Vec2;
  estimated: boolean;
  visible: boolean;
  /** De dónde sale un punto estimado: silueta (segmentación) o proporciones promedio. */
  source?: EstimateSource;
  /** Aviso sobre un punto estimado: la cabeza sale del cuadro o el cabello lo cubre. */
  caveat?: EstimateCaveat;
}

export type EstimateSource = 'silhouette' | 'canon';
export type EstimateCaveat = 'cropped' | 'covered';

// ---------------------------------------------------------------------------
// Estimación de puntos fuera de la malla.
//
// Con segmentación, cima, ancho del cráneo, nuca y nacimiento del cabello salen
// de la silueta real (geom/silhouette.ts). Sin ella, el cráneo se aproxima con un elipsoide en el marco canónico (cm), con
// medidas antropométricas promedio de adulto: ancho de cabeza (eurion‑eurion)
// ≈ 15.5 cm, largo (glabela‑opistocráneo) ≈ 19.5 cm y alto mentón‑vértex
// ≈ 22.5 cm (Farkas, «Anthropometry of the Head and Face», 1994). Solo da la
// POSICIÓN INICIAL de los puntos marcados como «estimado»; la construcción usa
// lo que el usuario confirme. El cabello se aproxima con +6 % de volumen.

const SKULL_CENTER = v3(0, 3.6, -4.2);
const SKULL_AXES = v3(7.8, 9.6, 9.8);
const HAIR = 1.06;

/**
 * Nacimiento del cabello sin segmentación: un tercio (ceja → base de la nariz)
 * por encima de la ceja, como en el canon de tercios iguales. La frente se
 * inclina hacia atrás: profundidad canónica ≈ 3.3 cm (la frente alta, 10, está
 * a 4.5 cm y baja ~0.3 cm por cada cm que sube).
 */
export const HAIRLINE_DEPTH = 3.3;
const HAIRLINE_CANON = v3(0, 2 * canonicalPoint(LM.glabella).y - canonicalPoint(LM.subnasale).y, HAIRLINE_DEPTH);

/** Oreja: punta a la altura de la ceja, lóbulo a la altura de la base de la nariz (Loomis). */
export const EAR_TOP = v3(7.4, canonicalPoint(R.browPeak).y - 0.4, -5.4);
export const EAR_LOBE = v3(7.2, canonicalPoint(LM.subnasale).y, -3.6);

let skullSamples: Vec3[] | null = null;
function skullSurface(): Vec3[] {
  if (skullSamples) return skullSamples;
  const pts: Vec3[] = [];
  const n = 36;
  for (let i = 1; i < n; i++) {
    const th = (Math.PI * i) / n;
    for (let j = 0; j < 2 * n; j++) {
      const ph = (Math.PI * j) / n;
      pts.push(
        v3(
          SKULL_CENTER.x + SKULL_AXES.x * HAIR * Math.sin(th) * Math.cos(ph),
          SKULL_CENTER.y + SKULL_AXES.y * HAIR * Math.cos(th),
          SKULL_CENTER.z + SKULL_AXES.z * HAIR * Math.sin(th) * Math.sin(ph),
        ),
      );
    }
  }
  skullSamples = pts;
  return pts;
}

/** Peso de cada punto de oreja confirmado, relativo a un landmark de la malla. */
const EAR_ANCHOR_WEIGHT = 10;

/** Orejas que el usuario ya colocó, como anclas para el ajuste de la pose. */
export function earAnchors(placed: Partial<Record<ExtraId, Vec2>>): Anchor[] {
  const out: Anchor[] = [];
  const add = (id: ExtraId, p: Vec3, side: 'R' | 'L') => {
    const image = placed[id];
    if (image) out.push({ canonical: v3(side === 'R' ? -p.x : p.x, p.y, p.z), image, weight: EAR_ANCHOR_WEIGHT });
  };
  add('earTopR', EAR_TOP, 'R');
  add('earLobeR', EAR_LOBE, 'R');
  add('earTopL', EAR_TOP, 'L');
  add('earLobeL', EAR_LOBE, 'L');
  return out;
}

export interface ExtraEstimate {
  p: Vec2;
  visible: boolean;
  source: EstimateSource;
  caveat?: EstimateCaveat;
}

export function estimateExtras(frame: SimilarityFit, sil: HeadSilhouette | null = null): Record<ExtraId, ExtraEstimate> {
  const proj = skullSurface().map((p) => projectCanonical(frame, p));
  const extreme = (dir: Vec2): Vec2 => {
    let best = proj[0];
    let bestD = -Infinity;
    for (const q of proj) {
      const d = q.x * dir.x + q.y * dir.y;
      if (d > bestD) {
        bestD = d;
        best = q;
      }
    }
    return v2(best.x, best.y);
  };
  const up = headAxis(frame.rotation, v3(0, 1, 0));
  // Perpendicular a "arriba" en la imagen, hacia el lado derecho del sujeto.
  let side = v2(-up.y, up.x);
  const rightAxis = headAxis(frame.rotation, v3(-1, 0, 0));
  if (side.x * rightAxis.x + side.y * rightAxis.y < 0) side = v2(-side.x, -side.y);

  const facing = col3(frame.rotation, 2); // hacia dónde mira la cara (marco K)
  const turned = Math.abs(Math.atan2(facing.x, facing.z)) > (20 * Math.PI) / 180;
  // Con la cabeza girada, el ancho del cráneo del lado de atrás es el contorno
  // trasero: se muestra ese punto en lugar del ancho de ese lado.
  const backDir = headAxis(frame.rotation, v3(0, 0, -1));
  const backSide: 'R' | 'L' = side.x * backDir.x + side.y * backDir.y > 0 ? 'R' : 'L';

  const earVisible = (s: 'R' | 'L') => {
    const n = apply3(frame.rotation, v3(s === 'R' ? -1 : 1, 0, 0));
    return n.z > -0.25;
  };
  const ear = (p: Vec3, s: 'R' | 'L') => {
    const q = projectCanonical(frame, v3(s === 'R' ? -p.x : p.x, p.y, p.z));
    return v2(q.x, q.y);
  };

  const hairCanon = projectCanonical(frame, HAIRLINE_CANON);
  const canon: EstimateSource = 'canon';
  const fromSil: EstimateSource = sil ? 'silhouette' : 'canon';
  const cut = (c: boolean | undefined): EstimateCaveat | undefined => (c ? 'cropped' : undefined);
  return {
    crown: { p: sil ? sil.crown : extreme(up), visible: true, source: fromSil, caveat: cut(sil?.cropped.crown) },
    hairline: sil?.hairline
      ? { p: sil.hairline, visible: true, source: 'silhouette' }
      : { p: v2(hairCanon.x, hairCanon.y), visible: true, source: canon, caveat: sil?.hairlineCovered ? 'covered' : undefined },
    skullR: { p: sil ? sil.skullR : extreme(side), visible: !(turned && backSide === 'R'), source: fromSil, caveat: cut(sil?.cropped.skullR) },
    skullL: { p: sil ? sil.skullL : extreme(v2(-side.x, -side.y)), visible: !(turned && backSide === 'L'), source: fromSil, caveat: cut(sil?.cropped.skullL) },
    skullBack: { p: sil ? sil.back : extreme(backDir), visible: turned, source: fromSil, caveat: cut(sil?.cropped.back) },
    earTopR: { p: ear(EAR_TOP, 'R'), visible: earVisible('R'), source: canon },
    earLobeR: { p: ear(EAR_LOBE, 'R'), visible: earVisible('R'), source: canon },
    earTopL: { p: ear(EAR_TOP, 'L'), visible: earVisible('L'), source: canon },
    earLobeL: { p: ear(EAR_LOBE, 'L'), visible: earVisible('L'), source: canon },
  };
}

export function buildKeyPoints(
  landmarks: readonly Vec3[],
  extras: Record<ExtraId, ExtraEstimate>,
  placed: Partial<Record<ExtraId, Vec2>>,
): KeyPoint[] {
  return KEY_DEFS.map((def) => {
    if (def.landmark !== undefined) {
      const q = landmarks[def.landmark];
      return { def, p: v2(q.x, q.y), estimated: false, visible: true };
    }
    const id = def.extra!;
    const user = placed[id];
    const e = extras[id];
    return { def, p: user ?? e.p, estimated: !user, visible: e.visible || !!user, source: user ? undefined : e.source, caveat: user ? undefined : e.caveat };
  });
}

// ---------------------------------------------------------------------------
// Corrección de la malla al arrastrar un punto.

/**
 * Mueve el landmark `index` a `target` y arrastra a sus vecinos con un peso que
 * cae con la distancia (gaussiana de radio `sigma` px), para que la malla siga
 * coherente. Se parte siempre de `base` (los landmarks al empezar el arrastre),
 * así que no se acumula error. Si es el centro de un iris, el anillo se mueve
 * completo.
 */
export function dragLandmarks(base: readonly Vec3[], index: number, target: Vec2, sigma: number): Vec3[] {
  const o = base[index];
  const dx = target.x - o.x;
  const dy = target.y - o.y;
  const ring = new Set<number>(index === R.pupil ? R.irisRing : index === L.pupil ? L.irisRing : []);
  const s2 = sigma * sigma;
  return base.map((p, i) => {
    let w: number;
    if (i === index || ring.has(i)) w = 1;
    else if (i >= 468) w = 0; // los iris solo se mueven con su centro
    else w = Math.exp(-((p.x - o.x) ** 2 + (p.y - o.y) ** 2) / s2);
    return w < 1e-3 ? p : v3(p.x + dx * w, p.y + dy * w, p.z);
  });
}

/** Distancia entre pupilas en px (unidad de medida de la app). */
export function interpupillaryPx(landmarks: readonly Vec3[]): number {
  return dist2(landmarks[R.pupil], landmarks[L.pupil]);
}
