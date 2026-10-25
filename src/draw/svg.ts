// Ayudantes para dibujar en el <svg> del visor (coordenadas = px de imagen).
// Lo que deba tener tamaño fijo en pantalla (puntos, etiquetas) va dentro de
// `screenGroup`, que compensa el zoom con la variable CSS --s.

import type { Vec2 } from '../geom/vec';

export const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | undefined | null>;

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  parent?.append(el);
  return el;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

export function polyline(pts: readonly Vec2[], closed = false): string {
  if (!pts.length) return '';
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += `L${f(pts[i].x)} ${f(pts[i].y)}`;
  return closed ? `${d}Z` : d;
}

export function segments(pairs: readonly [Vec2, Vec2][]): string {
  let d = '';
  for (const [a, b] of pairs) d += `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`;
  return d;
}

/** Grupo anclado en `p` cuyo contenido se dibuja en px de pantalla. */
export function screenGroup(p: Vec2, parent: Element, attrs: Attrs = {}): SVGGElement {
  const anchor = s('g', { transform: `translate(${f(p.x)} ${f(p.y)})`, ...attrs }, parent);
  return s('g', { class: 'ss' }, anchor);
}
