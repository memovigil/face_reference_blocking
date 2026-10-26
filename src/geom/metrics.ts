// Diagnóstico de proporciones (§9), medido en el marco de frente.
// Unidad: distancia entre los centros de los ojos (ver frontal.ts).
//
// DE DÓNDE SALE CADA CANON
// El canon es un PROMEDIO, no un ideal; solo sirve para comparar.
//  · Métricas de la malla (ojos, nariz, boca, mandíbula, tercio medio/inferior,
//    profundidad): mediana medida POR ESTE MISMO DETECTOR en fotos reales de
//    ROSTROS FEMENINOS (esta versión se centra en ellos): las referencias del
//    usuario sin las de hombres (fase 3: 136 fotos, 92 mujeres; cada persona
//    cuenta una vez; mayoría jóvenes, incluye dibujos realistas).
//    Script: `ALL=1 node tests/visual/invariance.mjs` (la lista de exclusión
//    vive en tests/fixtures/user/excluir-canon.json, no versionada).
//    Por qué no la antropometría directa ni el modelo canónico: los landmarks no
//    son los puntos antropométricos, y el modelo canónico de MediaPipe es una
//    plantilla geométrica que no coincide con lo que mide el detector en caras
//    reales. Valores del canónico (mediana de fotos entre corchetes):
//    nariz/unidad 0.567 [0.647], separación de ojos 1.43 [1.21], inclinación
//    de los ojos 1.7° [5.0°], boca entre nariz y mentón 0.298 [0.348], tercio
//    medio/inferior 0.94 [1.09]. Donde la antropometría es comparable, la
//    mediana de fotos coincide con ella: la boca cae a ~1/3 entre la base de la
//    nariz y el mentón (Farkas, «Anthropometry of the Head and Face», 1994) y
//    la inclinación cantal promedio es positiva, de unos 4–5° (literatura de
//    cirugía oculoplástica).
//    En caras masculinas el canon no aplica: la nariz y la mandíbula tienden a
//    salir más anchas y la inclinación de los ojos más baja.
//  · Cabello y cráneo (silueta por segmentación): también la mediana medida en
//    las fotos, con la misma lectura de la silueta. Con cabello, los ojos quedan
//    en 0.46 del alto total (el 0.5 de Loomis es sin cabello), y los tercios
//    medidos con el nacimiento del cabello son 0.29 / 0.37 / 0.34, no iguales.
//    El canon neoclásico de tercios iguales (Farkas et al., 1985, lo encontraron
//    solo como tendencia, con variaciones de ±10 % frecuentes) se dibuja en el
//    paso B como convención de dibujo, pero no se usa para el diagnóstico.
//  · Orejas: canon de Loomis («Drawing the Head and Hands», 1956): punta a la
//    altura de la ceja y lóbulo a la de la base de la nariz. Solo cuenta si el
//    usuario confirma los puntos.
//  · Desviación típica (sd): ordena qué tan distintivo es cada rasgo. Es la
//    dispersión robusta (1.48·MAD) entre personas en las fotos (92 para la
//    malla; 74 para cabello y cráneo, donde la silueta se pudo leer; 45 para el
//    ancho de la cabeza, que solo se mide casi de frente). Orejas: aproximada.
//
// RUIDO DE MEDICIÓN (prueba de invariancia, misma persona en distintos ángulos):
// desviación media respecto de la mediana de su grupo ≈ 2.4–3.8 % (≈1° en la
// inclinación de los ojos). Por eso una diferencia de menos de ~1 sd no se
// presenta como rasgo distintivo.

import { LM, NOSE_ALA_CANDIDATES } from '../detect/landmarkMap';
import { centerOfEye, type FrontalFace } from './frontal';
import { deg, mid3, type Vec3 } from './vec';

export type MetricGroup = 'thirds' | 'heights' | 'widths' | 'angles';
export type MetricId =
  | 'thirdUpper'
  | 'thirdMiddle'
  | 'thirdLower'
  | 'middleOverLower'
  | 'eyesInHeight'
  | 'mouthNoseChin'
  | 'earTop'
  | 'earLobe'
  | 'headWidthHeight'
  | 'eyeSpacing'
  | 'noseWidth'
  | 'mouthWidth'
  | 'jawCheek'
  | 'canthalTilt'
  | 'mouthCorners'
  | 'noseProjection'
  | 'chinProjection';

export interface MetricDef {
  id: MetricId;
  group: MetricGroup;
  unit: 'ratio' | 'unit' | 'deg';
  canon: number;
  sd: number;
  /** Fuente del canon, para la interfaz. */
  source: 'fotos' | 'loomis' | 'neoclasico';
}

export interface MetricValue {
  def: MetricDef;
  value: number;
  /** Desviación respecto del canon, en desviaciones típicas (con signo). */
  z: number;
  /** false si depende de algo estimado o poco confiable en esta foto. */
  reliable: boolean;
  /** Clave del motivo (i18n) cuando no es confiable o hay que leerlo con cuidado. */
  note?: 'estimated' | 'smile' | 'pucker' | 'mouthOpen' | 'turned' | 'depthFrontal' | 'jawClosed' | 'eyesClosed' | 'unmarked';
}

export interface ExpressionFlags {
  smile: boolean;
  jawOpen: boolean;
  eyesClosed: boolean;
  pucker: boolean;
  /** Boca abierta en «O»: la abertura es de labios, no de la mandíbula. */
  lipsO: boolean;
}

export interface MetricInputs {
  face: FrontalFace;
  /** Marco de frente con la z del detector (para las métricas de profundidad). */
  depthFace?: FrontalFace;
  /** Giro en grados (decide qué lado medir y qué tan confiable es la profundidad). */
  yaw: number;
  expression: ExpressionFlags;
  /** Si el mentón se cerró (boca abierta), el punto 152 ya viene corregido. */
  jawClosed?: boolean;
  /** Alturas en el marco de frente (cm, y hacia arriba). */
  hairline?: { y: number; confirmed: boolean };
  /** `widthConfirmed`: el ancho solo se mide bien con la cabeza casi de frente. */
  head?: { top: number; width: number; confirmed: boolean; widthConfirmed?: boolean };
  ears?: { top?: number; lobe?: number; confirmed: boolean };
  /**
   * Modo manual: landmarks que el usuario marcó. Lo que depende de puntos sin
   * marcar sale de la cabeza promedio, así que no se mide.
   */
  marked?: ReadonlySet<number>;
}

/** Desde este giro solo se ve un lado de la cara: los anchos no se miden. */
export const SIDEWAYS_YAW = 60;

// ---------------------------------------------------------------------------
// Medidas sobre la malla en el marco de frente.

const R = LM.subjectRight;
const L = LM.subjectLeft;

function browLevel(p: readonly Vec3[]): number {
  // Centro de cada ceja: promedio del contorno superior e inferior a media ceja.
  return (p[105].y + p[52].y + p[334].y + p[282].y) / 4;
}

function eyeLevel(p: readonly Vec3[]): number {
  return (centerOfEye(p, 'R').y + centerOfEye(p, 'L').y) / 2;
}

function midlineX(p: readonly Vec3[]): number {
  const idx = [168, 6, 197, 195, 5, 4];
  return idx.reduce((s, i) => s + p[i].x, 0) / idx.length;
}

function alarWidth(p: readonly Vec3[]): number {
  const right = Math.min(...NOSE_ALA_CANDIDATES.subjectRight.map((i) => p[i].x));
  const left = Math.max(...NOSE_ALA_CANDIDATES.subjectLeft.map((i) => p[i].x));
  return left - right;
}

const dist2D = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y);

export interface FaceMeasures {
  brow: number;
  eyes: number;
  subnasale: number;
  stomion: number;
  menton: number;
  eyeSpacing: number;
  noseWidth: number;
  mouthWidth: number;
  jawCheek: number;
  canthalTilt: number;
  mouthCorners: number;
}

/**
 * Medidas de la malla. `side` elige el lado cercano a la cámara: con la cabeza
 * girada, el ojo y el contorno lejanos quedan comprimidos (prueba de invariancia,
 * fase 2: la separación de ojos con ambos ojos se desviaba 9 % a más de 35° de giro).
 */
export function faceMeasures(p: readonly Vec3[], unit: number, side: 'R' | 'L' | 'both'): FaceMeasures {
  const eyeWR = dist2D(p[R.eyeOuter], p[R.eyeInner]);
  const eyeWL = dist2D(p[L.eyeOuter], p[L.eyeInner]);
  const eyeW = side === 'R' ? eyeWR : side === 'L' ? eyeWL : (eyeWR + eyeWL) / 2;
  const mx = midlineX(p);
  const half = (i: number) => Math.abs(p[i].x - mx);
  const jaw = side === 'R' ? half(R.jawAngle) : side === 'L' ? half(L.jawAngle) : (half(R.jawAngle) + half(L.jawAngle)) / 2;
  const cheek = side === 'R' ? half(R.cheekTragus) : side === 'L' ? half(L.cheekTragus) : (half(R.cheekTragus) + half(L.cheekTragus)) / 2;
  const tilt = (s: typeof R) => {
    const o = p[s.eyeOuter];
    const n = p[s.eyeInner];
    return deg(Math.atan2(o.y - n.y, Math.abs(o.x - n.x)));
  };
  const sto = mid3(p[LM.upperLipInner], p[LM.lowerLipInner]);
  return {
    brow: browLevel(p),
    eyes: eyeLevel(p),
    subnasale: p[LM.subnasale].y,
    stomion: sto.y,
    menton: p[LM.menton].y,
    eyeSpacing: dist2D(p[R.eyeInner], p[L.eyeInner]) / eyeW,
    noseWidth: alarWidth(p) / unit,
    mouthWidth: dist2D(p[R.mouthCorner], p[L.mouthCorner]) / unit,
    jawCheek: jaw / cheek,
    canthalTilt: side === 'R' ? tilt(R) : side === 'L' ? tilt(L) : (tilt(R) + tilt(L)) / 2,
    mouthCorners: ((p[R.mouthCorner].y + p[L.mouthCorner].y) / 2 - sto.y) / unit,
  };
}

export const METRICS: Record<MetricId, MetricDef> = {
  thirdUpper: { id: 'thirdUpper', group: 'thirds', unit: 'ratio', canon: 0.292, sd: 0.022, source: 'fotos' },
  thirdMiddle: { id: 'thirdMiddle', group: 'thirds', unit: 'ratio', canon: 0.368, sd: 0.016, source: 'fotos' },
  thirdLower: { id: 'thirdLower', group: 'thirds', unit: 'ratio', canon: 0.338, sd: 0.023, source: 'fotos' },
  middleOverLower: { id: 'middleOverLower', group: 'thirds', unit: 'ratio', canon: 1.093, sd: 0.075, source: 'fotos' },
  eyesInHeight: { id: 'eyesInHeight', group: 'heights', unit: 'ratio', canon: 0.459, sd: 0.021, source: 'fotos' },
  mouthNoseChin: { id: 'mouthNoseChin', group: 'heights', unit: 'ratio', canon: 0.348, sd: 0.027, source: 'fotos' },
  earTop: { id: 'earTop', group: 'heights', unit: 'unit', canon: 0, sd: 0.12, source: 'loomis' },
  earLobe: { id: 'earLobe', group: 'heights', unit: 'unit', canon: 0, sd: 0.12, source: 'loomis' },
  headWidthHeight: { id: 'headWidthHeight', group: 'widths', unit: 'ratio', canon: 0.683, sd: 0.031, source: 'fotos' },
  eyeSpacing: { id: 'eyeSpacing', group: 'widths', unit: 'ratio', canon: 1.21, sd: 0.099, source: 'fotos' },
  noseWidth: { id: 'noseWidth', group: 'widths', unit: 'unit', canon: 0.64, sd: 0.026, source: 'fotos' },
  mouthWidth: { id: 'mouthWidth', group: 'widths', unit: 'unit', canon: 0.787, sd: 0.044, source: 'fotos' },
  jawCheek: { id: 'jawCheek', group: 'widths', unit: 'ratio', canon: 0.795, sd: 0.033, source: 'fotos' },
  canthalTilt: { id: 'canthalTilt', group: 'angles', unit: 'deg', canon: 5.0, sd: 2.0, source: 'fotos' },
  mouthCorners: { id: 'mouthCorners', group: 'angles', unit: 'unit', canon: -0.016, sd: 0.023, source: 'fotos' },
  noseProjection: { id: 'noseProjection', group: 'angles', unit: 'unit', canon: 0.263, sd: 0.015, source: 'fotos' },
  chinProjection: { id: 'chinProjection', group: 'angles', unit: 'unit', canon: -0.063, sd: 0.075, source: 'fotos' },
};

/** Lado cercano a la cámara (el que se ve completo) según el giro. */
export function nearSide(yaw: number): 'R' | 'L' | 'both' {
  if (Math.abs(yaw) < 15) return 'both';
  // Giro negativo = mira a la izquierda de la foto: se ve su mejilla izquierda.
  return yaw < 0 ? 'L' : 'R';
}

export function computeMetrics(inp: MetricInputs): MetricValue[] {
  const { face, expression } = inp;
  const p = face.points;
  const u = face.unit;
  const m = faceMeasures(p, u, nearSide(inp.yaw));
  const out: MetricValue[] = [];
  const push = (id: MetricId, value: number, reliable = true, note?: MetricValue['note']) => {
    const def = METRICS[id];
    out.push({ def, value, z: (value - def.canon) / def.sd, reliable, note });
  };
  const jawNote = inp.jawClosed ? 'jawClosed' : undefined;
  const side = nearSide(inp.yaw);
  const nearIds = (f: (s: typeof R) => number) => (side === 'R' ? [f(R)] : side === 'L' ? [f(L)] : [f(R), f(L)]);
  /** ¿Se puede medir un ancho con estos landmarks? (cara de lado o puntos sin marcar en modo manual). */
  const widthCheck = (ids: readonly number[]): { ok: boolean; note?: MetricValue['note'] } => {
    if (Math.abs(inp.yaw) >= SIDEWAYS_YAW) return { ok: false, note: 'turned' };
    if (inp.marked && !ids.every((i) => inp.marked!.has(i))) return { ok: false, note: 'unmarked' };
    return { ok: true };
  };
  // Boca en «O»: el labio superior se estira y el mentón no se puede cerrar con
  // los labios; el tercio inferior no se mide.
  const lowerOk = !expression.lipsO;
  const lowerNote = lowerOk ? jawNote : 'mouthOpen';

  // Tercios
  if (inp.hairline) {
    const total = inp.hairline.y - m.menton;
    const ok = inp.hairline.confirmed;
    push('thirdUpper', (inp.hairline.y - m.brow) / total, ok, ok ? undefined : 'estimated');
    push('thirdMiddle', (m.brow - m.subnasale) / total, ok, ok ? undefined : 'estimated');
    push('thirdLower', (m.subnasale - m.menton) / total, ok && lowerOk, !ok ? 'estimated' : lowerNote);
  }
  push('middleOverLower', (m.brow - m.subnasale) / (m.subnasale - m.menton), lowerOk, lowerNote);

  // Alturas
  if (inp.head) {
    push('eyesInHeight', (m.eyes - m.menton) / (inp.head.top - m.menton), inp.head.confirmed, inp.head.confirmed ? jawNote : 'estimated');
  }
  push('mouthNoseChin', (m.subnasale - m.stomion) / (m.subnasale - m.menton), lowerOk, lowerNote);
  if (inp.ears?.top !== undefined) {
    push('earTop', (inp.ears.top - m.brow) / u, inp.ears.confirmed, inp.ears.confirmed ? undefined : 'estimated');
  }
  if (inp.ears?.lobe !== undefined) {
    push('earLobe', (inp.ears.lobe - m.subnasale) / u, inp.ears.confirmed, inp.ears.confirmed ? undefined : 'estimated');
  }

  // Anchos
  if (inp.head) {
    const ok = inp.head.widthConfirmed ?? inp.head.confirmed;
    push('headWidthHeight', inp.head.width / (inp.head.top - m.menton), ok, ok ? jawNote : inp.head.confirmed ? 'turned' : 'estimated');
  }
  const eyes = widthCheck([R.eyeInner, L.eyeInner, ...nearIds((s) => s.eyeOuter)]);
  push('eyeSpacing', m.eyeSpacing, !expression.eyesClosed && eyes.ok, expression.eyesClosed ? 'eyesClosed' : eyes.note);
  const nose = widthCheck([R.noseAla, L.noseAla]);
  push('noseWidth', m.noseWidth, nose.ok, nose.note);
  const mouthMoved = expression.smile || expression.pucker || expression.jawOpen;
  const mouthNote = expression.smile ? 'smile' : expression.pucker ? 'pucker' : expression.jawOpen ? 'mouthOpen' : undefined;
  const mouth = widthCheck([R.mouthCorner, L.mouthCorner]);
  push('mouthWidth', m.mouthWidth, !mouthMoved && mouth.ok, mouthNote ?? mouth.note);
  const jaw = widthCheck([...nearIds((s) => s.jawAngle), ...nearIds((s) => s.cheekTragus)]);
  push('jawCheek', m.jawCheek, jaw.ok, jaw.note);

  // Ángulos
  const tilt = widthCheck([...nearIds((s) => s.eyeOuter), ...nearIds((s) => s.eyeInner)]);
  push('canthalTilt', m.canthalTilt, !expression.eyesClosed && tilt.ok, expression.eyesClosed ? 'eyesClosed' : tilt.note);
  const corners = inp.marked && !(inp.marked.has(R.mouthCorner) && inp.marked.has(L.mouthCorner));
  push('mouthCorners', m.mouthCorners, !mouthMoved && !corners, mouthNote ?? (corners ? 'unmarked' : undefined));
  if (inp.depthFace) {
    const d = inp.depthFace.points;
    const du = inp.depthFace.unit;
    const turned = Math.abs(inp.yaw) >= 20;
    push('noseProjection', (d[LM.noseTip].z - d[LM.subnasale].z) / du, turned, turned ? undefined : 'depthFrontal');
    // Con la boca abierta, la profundidad del mentón es la de la mandíbula abierta.
    const chinOk = turned && !expression.jawOpen;
    push('chinProjection', (d[LM.chinFront].z - d[LM.glabella].z) / du, chinOk, chinOk ? undefined : expression.jawOpen ? 'mouthOpen' : 'depthFrontal');
  }
  return out;
}

/** Las más distintivas: confiables, ordenadas por |z|. */
export function mostDistinctive(values: readonly MetricValue[], n = 3): MetricValue[] {
  return values
    .filter((v) => v.reliable)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, n);
}

