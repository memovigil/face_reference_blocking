// Paso C · Medidas y triangulación: triángulo pupilas–boca, plomadas, niveles,
// anchos de nariz y boca, y ángulos clave, todo en el plano de la foto.

import { buildMeasures } from '../../geom/measures';
import { polyline, s, screenGroup } from '../svg';
import type { LayerDef } from './types';

export const measuresLayer: LayerDef = {
  id: 'measures',
  layer: 'measures',
  steps: ['C', 'I'],
  render(g, { state, d }) {
    const m = buildMeasures(state.landmarks!, d);
    for (const p of m.plumbs) s('path', { class: 'ms-plumb', d: polyline([p.top, p.bottom]) }, g);
    for (const l of m.levels) {
      s('path', { class: 'ms-level', d: polyline([l.left, l.right]) }, g);
      // Etiqueta a la izquierda: a la derecha suelen caer la mandíbula y sus ángulos.
      const sg = screenGroup(l.left, g, { class: 'ms-label ms-level-label' });
      const t = s('text', { 'x': -6, 'y': 4, 'text-anchor': 'end' }, sg);
      t.textContent = l.label;
    }
    s('path', { class: 'ms-triangle', d: polyline(m.triangle, true) }, g);
    for (const w of m.widths) {
      s('path', { class: 'ms-width', d: polyline([w.a, w.b]) }, g);
      for (const end of [w.a, w.b]) {
        const sg = screenGroup(end, g);
        s('path', { class: 'ms-tick', d: 'M0 -5V5' }, sg);
      }
      const sg = screenGroup({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, g, { class: 'ms-label' });
      const t = s('text', { 'x': 0, 'y': 16, 'text-anchor': 'middle' }, sg);
      t.textContent = w.label;
    }
    for (const a of m.angles) {
      s('path', { class: 'ms-angle-line', d: polyline([a.a, a.b]) }, g);
      const sg = screenGroup(a.labelAt, g, { class: 'ms-label ms-angle' });
      const at = { right: { 'x': 8, 'y': -6 }, left: { 'x': -8, 'y': 4, 'text-anchor': 'end' }, below: { 'x': 0, 'y': 18, 'text-anchor': 'middle' } }[a.place];
      const t = s('text', at, sg);
      t.textContent = a.label;
    }
  },
};
