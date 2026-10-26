// Registro de capas y render en el <svg> del visor.

import type { Derived } from '../../state/derived';
import type { AppState, LayerId } from '../../state/store';
import { blockingLayer } from './blocking';
import { lightPlanesLayer } from './lightPlanes';
import { valuesLayer } from './values';
import { envelopeLayer } from './envelope';
import { indicesLayer } from './indices';
import { keypointsLayer } from './keypoints';
import { canonLayer, loomisLayer } from './loomis';
import { measuresLayer } from './measures';
import { meshLayer } from './mesh';
import type { LayerDef } from './types';

const LAYERS: readonly LayerDef[] = [valuesLayer, meshLayer, envelopeLayer, loomisLayer, canonLayer, blockingLayer, lightPlanesLayer, measuresLayer, indicesLayer, keypointsLayer];

/** Capas que enciende cada paso al entrar (el usuario puede cambiarlas después). */
export const STEP_LAYERS: Partial<Record<AppState['step'], Partial<Record<LayerId, boolean>>>> = {
  R: { structure: true, points: true, envelope: false, measures: false },
  A: { envelope: true, points: true, structure: false, measures: false },
  B: { structure: true, measures: true, points: true, envelope: false },
  C: { measures: true, structure: true, points: false, envelope: false },
  D: { structure: true, points: false, envelope: false, measures: false },
  E: { structure: true, points: false, envelope: false, measures: false },
  F: { values: true, structure: false, points: false, envelope: false, measures: false },
  G: { values: true, structure: false, points: false, envelope: false, measures: false },
  H: { values: true, structure: false, points: false, envelope: false, measures: false },
  I: { envelope: true, structure: true, measures: true, points: false },
};
const ORDER: readonly LayerId[] = ['values', 'envelope', 'structure', 'measures', 'indices', 'points'];

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
    this.root.dataset.step = state.step;
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
