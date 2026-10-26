// Nombres de los puntos clave con «izq./der. de la foto». El lado se decide por
// la posición real en la foto (no por el lado del sujeto), comparando con la
// raíz de la nariz.

import type { KeyPoint } from '../detect/keypoints';
import { manualBase, manualSide } from '../geom/manualFit';
import { es } from '../i18n/es';

export function keyBaseName(id: string, hasSide: boolean): string {
  const base = hasSide ? id.slice(0, -1) : id;
  return es.keys[base] ?? id;
}

export function photoSide(kp: KeyPoint, all: readonly KeyPoint[]): 'left' | 'right' | null {
  if (!kp.def.side) return null;
  const nasion = all.find((k) => k.def.id === 'nasion');
  // Pares del mismo rasgo: el que esté más a la izquierda es «izq.».
  const pairId = kp.def.id.slice(0, -1) + (kp.def.side === 'R' ? 'L' : 'R');
  const pair = all.find((k) => k.def.id === pairId);
  if (pair && pair.visible && Math.abs(pair.p.x - kp.p.x) > 1) return kp.p.x < pair.p.x ? 'left' : 'right';
  if (nasion) return kp.p.x < nasion.p.x ? 'left' : 'right';
  return kp.def.side === 'R' ? 'left' : 'right';
}

export function keyLabel(kp: KeyPoint, all: readonly KeyPoint[]): string {
  const name = keyBaseName(kp.def.id, !!kp.def.side);
  const side = photoSide(kp, all);
  return side ? `${name} (${es.sidePhoto[side]})` : name;
}

/** Etiqueta corta de un punto estimado: de dónde sale y si tiene algún aviso. */
export function estimateTag(kp: KeyPoint): string {
  if (kp.caveat === 'cropped') return `${es.review.estimated} · ${es.review.cropped}`;
  if (kp.caveat === 'covered') return `${es.review.estimated} · ${es.review.covered}`;
  if (kp.source === 'silhouette') return `${es.review.estimated} · ${es.review.fromSilhouette}`;
  return es.review.estimated;
}

/** Nombre de un punto del modo manual: de frente con el lado de la foto; en ¾ y perfil, cercano o lejano. */
export function manualLabel(id: string): string {
  const name = es.keys[manualBase(id)] ?? id;
  const side = manualSide(id);
  if (!side) return name;
  const text = side === 'R' ? es.sidePhoto.left : side === 'L' ? es.sidePhoto.right : side === 'N' ? es.manual.near : es.manual.far;
  return `${name} (${text})`;
}
