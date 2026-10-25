import type { Derived } from '../../state/derived';
import type { AppState, LayerId } from '../../state/store';

export interface LayerContext {
  state: AppState;
  d: Derived;
}

export interface LayerDef {
  id: string;
  layer: LayerId;
  /** Pasos donde se dibuja; vacío = todos. */
  steps?: readonly string[];
  render(g: SVGGElement, ctx: LayerContext): void;
}
