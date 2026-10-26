// Paso E · planos de luz: cada plano visible del poliedro relleno con luz,
// medio tono o sombra, con las sombras proyectadas recortadas a su plano, y el
// contorno del blocking encima.

import { v2 } from '../../geom/vec';
import { VALUE_PALETTE } from '../../values/posterize';
import { polyline, s, segments } from '../svg';
import type { LayerDef } from './types';

const FILL = VALUE_PALETTE[3];

export const lightPlanesLayer: LayerDef = {
  id: 'lightPlanes',
  layer: 'structure',
  steps: ['E'],
  render(g, { d }) {
    const sh = d.shaded;
    const b = d.blocking;
    if (!sh || !b) return;
    const defs = s('defs', {}, g);
    sh.faces.forEach((f, i) => {
      s('path', { 'class': 'lp-face', 'd': polyline(f.poly, true), 'fill': FILL[f.value] }, g);
      if (f.cast.length) {
        const id = `lp-clip-${i}`;
        const cp = s('clipPath', { id }, defs);
        s('path', { d: polyline(f.poly, true) }, cp);
        const path = f.cast.map((c) => polyline(c, true)).join('');
        s('path', { 'class': 'lp-cast', 'd': path, 'fill': FILL[0], 'clip-path': `url(#${id})` }, g);
      }
    });
    // Aristas finas entre planos y contorno exterior.
    const seg = (kinds: string[]) =>
      segments(
        b.edges
          .filter((e) => kinds.includes(e.kind))
          .flatMap((e) => {
            const a = b.vertices[e.a].p;
            const c = b.vertices[e.b].p;
            return e.visible.map(([t0, t1]) => [v2(a.x + (c.x - a.x) * t0, a.y + (c.y - a.y) * t0), v2(a.x + (c.x - a.x) * t1, a.y + (c.y - a.y) * t1)] as [ReturnType<typeof v2>, ReturnType<typeof v2>]);
          }),
      );
    s('path', { class: 'lp-edge', d: seg(['hard']) }, g);
    s('path', { class: 'bk bk-contour', d: seg(['contour']) }, g);
  },
};
