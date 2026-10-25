// Registro de capas y render en el <svg> del visor.

import type { Derived } from '../../state/derived';
import type { AppState, LayerId } from '../../state/store';
import { indicesLayer } from './indices';
import { keypointsLayer } from './keypoints';
import { meshLayer } from './mesh';
import type { LayerDef } from './types';

const LAYERS: readonly LayerDef[] = [meshLayer, indicesLayer, keypointsLayer];
const ORDER: readonly LayerId[] = ['envelope', 'structure', 'measures', 'indices', 'points'];

export class LayerRenderer {
  private groups = new Map<LayerId, SVGGElement>();

  constructor(private root: SVGGElement) {
    for (const id of ORDER) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `layer layer-${id}`);
      g.dataset.layer = id;
      root.append(g);
      this.groups.set(id, g);
    }
  }

  render(state: AppState, d: Derived | null): void {
    this.root.style.setProperty('--line-opacity', String(state.lineOpacity));
    for (const g of this.groups.values()) g.replaceChildren();
    if (!d || !state.landmarks) return;
    for (const layer of LAYERS) {
      if (!state.layers[layer.layer]) continue;
      if (layer.steps && !layer.steps.includes(state.step)) continue;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `l-${layer.id}`);
      this.groups.get(layer.layer)!.append(g);
      layer.render(g, { state, d });
    }
  }
}
