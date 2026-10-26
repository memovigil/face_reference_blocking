// Pasos F–H · valores planos de la foto dentro de la cabeza con cabello: como
// imagen (masas suaves) o como polígonos de bordes rectos (block‑in).

import { valueCanvas, type ValueMap } from '../../values/posterize';
import { s } from '../svg';
import type { LayerDef } from './types';

const urls = new WeakMap<ValueMap, string>();

function dataUrl(map: ValueMap): string {
  let u = urls.get(map);
  if (!u) {
    u = valueCanvas(map).toDataURL('image/png');
    urls.set(map, u);
  }
  return u;
}

export const valuesLayer: LayerDef = {
  id: 'values',
  layer: 'values',
  steps: ['F', 'G', 'H'],
  render(g, { state, d }) {
    const v = d.values;
    if (!v || !state.image) return;
    if (v.shapes) {
      for (const sh of v.shapes) {
        let path = '';
        for (const loop of sh.loops) path += `M${loop.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}Z`;
        s('path', { 'class': 'val-shape', 'd': path, 'fill': sh.color, 'fill-rule': 'evenodd' }, g);
      }
    } else {
      s('image', { 'class': 'val-raster', 'href': dataUrl(v.map), 'x': 0, 'y': 0, 'width': state.image.width, 'height': state.image.height, 'preserveAspectRatio': 'none' }, g);
    }
  },
};
