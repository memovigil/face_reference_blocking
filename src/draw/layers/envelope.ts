// Paso A · Envolvente con rectas, plomada por la cima y espacios negativos.

import { es } from '../../i18n/es';
import type { Vec2 } from '../../geom/vec';
import { polyline, s, screenGroup } from '../svg';
import type { LayerDef } from './types';

export const envelopeLayer: LayerDef = {
  id: 'envelope',
  layer: 'envelope',
  steps: ['A', 'B', 'C', 'I'],
  render(g, { d }) {
    const env = d.envelope;
    for (const neg of env.negative) s('path', { class: 'env-negative', d: polyline(neg, true) }, g);
    s('path', { class: 'env-plumb', d: polyline([env.plumb.top, env.plumb.bottom]) }, g);
    s('path', { class: 'env-poly', d: polyline(env.polygon, true) }, g);
    // Centro del polígono, para sacar las etiquetas hacia afuera.
    const cx = env.polygon.reduce((a, p) => a + p.x, 0) / env.polygon.length;
    const cy = env.polygon.reduce((a, p) => a + p.y, 0) / env.polygon.length;
    for (const e of env.edges) {
      const m: Vec2 = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      const dx = m.x - cx;
      const dy = m.y - cy;
      const l = Math.hypot(dx, dy) || 1;
      const sg = screenGroup(m, g, { class: 'env-label' });
      const t = s('text', { 'x': (dx / l) * 16, 'y': (dy / l) * 16 + 4, 'text-anchor': 'middle' }, sg);
      t.textContent = es.envelope.angle(e.fromVertical);
    }
  },
};
