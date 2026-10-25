// Capa de depuración: número de cada uno de los 478 landmarks. Sirve para
// verificar landmarkMap.ts sobre fotos reales (ver el comentario de ese archivo).

import { screenGroup, s } from '../svg';
import type { LayerDef } from './types';

export const indicesLayer: LayerDef = {
  id: 'indices',
  layer: 'indices',
  render(g, { state }) {
    const lm = state.landmarks!;
    lm.forEach((p, i) => {
      const sg = screenGroup(p, g, { class: i >= 468 ? 'idx idx-iris' : 'idx' });
      s('circle', { r: 1.6 }, sg);
      const t = s('text', { x: 2.5, y: -2 }, sg);
      t.textContent = String(i);
    });
  },
};
