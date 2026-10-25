// Paso B · Esfera de Loomis: esfera, planos laterales, anillos, línea central,
// mandíbula, orejas y «mira hacia». Los tercios del canon van en su propia capa
// (Medidas), en rojo punteado.

import type { Stroke } from '../../geom/loomis';
import { es } from '../../i18n/es';
import { polyline, s, screenGroup } from '../svg';
import type { LayerDef } from './types';

function drawStroke(g: SVGGElement, st: Stroke) {
  s('path', { class: `lm lm-${st.kind} lm-${st.style}`, d: polyline(st.pts) }, g);
}

export const loomisLayer: LayerDef = {
  id: 'loomis',
  layer: 'structure',
  steps: ['B', 'C', 'I'],
  render(g, { d }) {
    for (const st of d.loomis.strokes) {
      if (st.kind === 'canon') continue;
      drawStroke(g, st);
    }
    const facing = d.loomis.strokes.find((x) => x.kind === 'facing');
    // De frente la flecha casi no tiene largo: sin etiqueta.
    const len = facing ? Math.hypot(facing.pts[1].x - facing.pts[0].x, facing.pts[1].y - facing.pts[0].y) : 0;
    if (facing && len > d.loomis.radius2D * 0.35) {
      const tip = facing.pts[facing.pts.length - 1];
      const sg = screenGroup(tip, g, { class: 'lm-facing-label' });
      s('path', { class: 'lm-arrow', d: 'M0 0 L-9 -4 L-9 4 Z', transform: `rotate(${(Math.atan2(tip.y - facing.pts[0].y, tip.x - facing.pts[0].x) * 180) / Math.PI})` }, sg);
      const t = s('text', { x: 10, y: -8 }, sg);
      t.textContent = es.loomis.facing;
    }
  },
};

export const canonLayer: LayerDef = {
  id: 'canon',
  layer: 'measures',
  steps: ['B', 'I'],
  render(g, { d }) {
    for (const st of d.loomis.strokes) {
      if (st.kind !== 'canon') continue;
      drawStroke(g, st);
      const end = st.pts[st.pts.length - 1];
      const sg = screenGroup(end, g, { class: 'lm-canon-label' });
      const t = s('text', { x: 6, y: 4 }, sg);
      t.textContent = es.loomis.canon;
    }
  },
};
