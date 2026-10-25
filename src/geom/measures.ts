// Paso C · Medidas y triangulación, en el plano de la foto (lo que se mide con
// el lápiz a la distancia de la vista): plomadas verticales, niveles
// horizontales, triángulo pupilas–boca, anchos y ángulos. La unidad es la
// distancia entre pupilas en la foto (DP).

import { LM } from '../detect/landmarkMap';
import { es } from '../i18n/es';
import type { Derived } from '../state/derived';
import { nearSide } from './metrics';
import { mid2, v2, type Vec2, type Vec3 } from './vec';

export interface Measures {
  triangle: Vec2[];
  plumbs: { top: Vec2; bottom: Vec2 }[];
  levels: { left: Vec2; right: Vec2; label: string }[];
  widths: { a: Vec2; b: Vec2; label: string }[];
  /** `place`: de qué lado del punto va la etiqueta (evita que se encimen en ¾). */
  angles: { a: Vec2; b: Vec2; labelAt: Vec2; place: 'right' | 'left' | 'below'; label: string }[];
  /** Tabla «medidas para tu hoja». */
  items: { id: string; text: string }[];
}

const deg = (r: number) => (r * 180) / Math.PI;

/** Ángulo agudo (°) de un segmento contra la horizontal de la foto. */
function fromHorizontal(a: Vec2, b: Vec2): number {
  return deg(Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)));
}

/** Texto de hacia dónde baja una línea casi horizontal. */
function tiltSide(a: Vec2, b: Vec2): string {
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  if (fromHorizontal(l, r) < 1) return es.measures.tilt.flat;
  return r.y > l.y ? es.measures.tilt.downRight : es.measures.tilt.downLeft;
}

export function buildMeasures(lm: readonly Vec3[], d: Derived): Measures {
  const P = (i: number) => v2(lm[i].x, lm[i].y);
  const pr = P(LM.subjectRight.pupil);
  const pl = P(LM.subjectLeft.pupil);
  const ipd = Math.hypot(pl.x - pr.x, pl.y - pr.y) || 1;
  const sto = mid2(P(LM.upperLipInner), P(LM.lowerLipInner));
  const browY = (lm[105].y + lm[52].y + lm[334].y + lm[282].y) / 4;
  const xs = [234, 454, 127, 356, 172, 397].map((i) => lm[i].x);
  const left = Math.min(...xs) - 0.25 * ipd;
  const right = Math.max(...xs) + 0.25 * ipd;
  const top = Math.min(lm[105].y, lm[334].y) - 0.15 * ipd;
  const bottom = lm[LM.menton].y + 0.1 * ipd;
  const alaR = P(LM.subjectRight.noseAla);
  const alaL = P(LM.subjectLeft.noseAla);
  const cR = P(LM.subjectRight.mouthCorner);
  const cL = P(LM.subjectLeft.mouthCorner);

  const plumbs = [pr, pl, P(LM.subjectRight.eyeInner), P(LM.subjectLeft.eyeInner), alaR, alaL].map((p) => ({ top: v2(p.x, top), bottom: v2(p.x, bottom) }));

  const levels: Measures['levels'] = [
    { y: browY, label: es.measures.brow },
    { y: lm[LM.subnasale].y, label: es.measures.nose },
    { y: sto.y, label: es.measures.mouth },
  ].map((l) => ({ left: v2(left, l.y), right: v2(right, l.y), label: l.label }));
  const side = nearSide(d.pose.angles.yaw);
  const lobe = d.keypoints.find((k) => k.def.id === `earLobe${side === 'both' ? 'L' : side}`);
  // El lóbulo solo cuenta si el usuario lo confirmó: estimado no es una medida.
  const lobeOk = !!lobe?.visible && !lobe.estimated;
  if (lobeOk) levels.push({ left: v2(left, lobe!.p.y), right: v2(right, lobe!.p.y), label: es.measures.lobe });

  const noseImg = Math.hypot(alaL.x - alaR.x, alaL.y - alaR.y) / ipd;
  const mouthImg = Math.hypot(cL.x - cR.x, cL.y - cR.y) / ipd;
  const off = 0.1 * ipd;
  const widths = [
    { a: v2(alaR.x, alaR.y + off), b: v2(alaL.x, alaL.y + off), label: `${es.measures.nose} ${noseImg.toFixed(2)}` },
    { a: v2(cR.x, cR.y + off * 1.6), b: v2(cL.x, cL.y + off * 1.6), label: `${es.measures.mouth} ${mouthImg.toFixed(2)}` },
  ];

  const nasion = P(LM.nasion);
  const sn = P(LM.subnasale);
  const jawI = side === 'R' ? LM.subjectRight.jawAngle : LM.subjectLeft.jawAngle;
  const jawA = P(jawI);
  const me = P(LM.menton);
  const eyeAngle = fromHorizontal(pr, pl);
  const noseAngle = 90 - fromHorizontal(nasion, sn);
  const mouthAngle = fromHorizontal(cR, cL);
  const jawAngle = fromHorizontal(jawA, me);
  const rightmost = (a: Vec2, b: Vec2) => (a.x > b.x ? a : b);
  // En ¾ el ojo lejano queda junto al nasion: la etiqueta de la nariz va a la
  // izquierda, a media nariz, y la de la mandíbula debajo de su línea.
  const angles: Measures['angles'] = [
    { a: pr, b: pl, labelAt: rightmost(pr, pl), place: 'right', label: `${es.measures.eyes} ${Math.round(eyeAngle)}°` },
    { a: nasion, b: sn, labelAt: mid2(nasion, sn), place: 'left', label: `${es.measures.nose} ${Math.round(noseAngle)}°` },
    { a: cR, b: cL, labelAt: rightmost(cR, cL), place: 'right', label: `${es.measures.mouth} ${Math.round(mouthAngle)}°` },
    { a: jawA, b: me, labelAt: mid2(jawA, me), place: 'below', label: `${es.measures.jaw} ${Math.round(jawAngle)}°` },
  ];

  // Tabla.
  const ux = (pl.x - pr.x) / ipd;
  const uy = (pl.y - pr.y) / ipd;
  const drop = Math.abs((sto.x - pr.x) * -uy + (sto.y - pr.y) * ux) / ipd;
  const midX = nasion.x;
  const relation = (inner: Vec2, outer: Vec2) => {
    const dd = (Math.abs(outer.x - midX) - Math.abs(inner.x - midX)) / ipd;
    return Math.abs(dd) < 0.04 ? es.measures.where.on : dd > 0 ? es.measures.where.inside : es.measures.where.outside;
  };
  const nearR = side !== 'L';
  const canthus = nearR ? P(LM.subjectRight.eyeInner) : P(LM.subjectLeft.eyeInner);
  const ala = nearR ? alaR : alaL;
  const pupil = nearR ? pr : pl;
  const corner = nearR ? cR : cL;
  const frontNose = d.metrics.find((m) => m.def.id === 'noseWidth')?.value ?? 0;
  const frontMouth = d.metrics.find((m) => m.def.id === 'mouthWidth')?.value ?? 0;
  const t = es.measures.items;
  const items: Measures['items'] = [
    { id: 'triangle', text: t.triangle(drop) },
    { id: 'noseWidth', text: t.noseWidth(noseImg, frontNose) },
    { id: 'mouthWidth', text: t.mouthWidth(mouthImg, frontMouth) },
    { id: 'plumbCanthus', text: t.plumbCanthus(relation(canthus, ala)) },
    { id: 'plumbPupil', text: t.plumbPupil(relation(pupil, corner)) },
    { id: 'eyeLine', text: t.eyeLine(eyeAngle, tiltSide(pr, pl)) },
    { id: 'noseAxis', text: t.noseAxis(noseAngle, '') },
    { id: 'mouthLine', text: t.mouthLine(mouthAngle, tiltSide(cR, cL)) },
    { id: 'jawLine', text: t.jawLine(jawAngle) },
  ];
  if (lobeOk) {
    const dl = (lobe!.p.y - sn.y) / ipd;
    items.push({ id: 'lobe', text: t.lobe(Math.abs(dl) < 0.08 ? es.measures.where.level : dl < 0 ? es.measures.where.above : es.measures.where.below) });
  }
  return { triangle: [pr, pl, sto], plumbs, levels, widths, angles, items };
}
