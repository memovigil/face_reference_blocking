// Puntos clave arrastrables del paso «Revisar puntos».

import type { KeyPoint } from '../../detect/keypoints';
import { keyLabel } from '../../ui/labels';
import { screenGroup, s } from '../svg';
import type { LayerDef } from './types';

export const keypointsLayer: LayerDef = {
  id: 'keypoints',
  layer: 'points',
  render(g, { state, d }) {
    // El seleccionado se dibuja al final para que quede encima.
    const order = [...d.keypoints].sort((a, b) => Number(a.def.id === state.selectedKey) - Number(b.def.id === state.selectedKey));
    for (const kp of order) {
      if (!kp.visible) continue;
      drawKey(g, kp, kp.def.id === state.selectedKey, keyLabel(kp, d.keypoints));
    }
  },
};

function drawKey(g: SVGGElement, kp: KeyPoint, selected: boolean, label: string) {
  const cls = ['kp', kp.estimated ? 'kp-est' : '', selected ? 'kp-sel' : ''].filter(Boolean).join(' ');
  const sg = screenGroup(kp.p, g, { 'class': cls, 'data-handle': kp.def.id });
  s('circle', { class: 'kp-hit', r: 13 }, sg);
  s('circle', { class: 'kp-ring', r: 6.5 }, sg);
  s('circle', { class: 'kp-dot', r: 2 }, sg);
  const t = s('text', { 'class': 'kp-label', 'x': 10, 'y': -9 }, sg);
  t.textContent = kp.estimated ? `${label} · estimado` : label;
}
