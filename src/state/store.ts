// Estado único de la app y suscripciones. Todo cambio pasa por `set`.
// La vista (zoom y desplazamiento) vive en el visor, no aquí: cambia a cada
// cuadro y no debe redibujar las capas.

import type { Detection } from '../detect/faceLandmarker';
import type { ExtraId } from '../detect/keypoints';
import type { Segmentation } from '../detect/segment';
import type { ExpressionId } from '../geom/expression';
import { ZERO_POSE, type PoseAngles } from '../geom/pose';
import type { Vec2, Vec3 } from '../geom/vec';
import type { WorkImage } from '../image/load';

export type StepId = 'R' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';
export type LayerId = 'envelope' | 'structure' | 'measures' | 'points' | 'indices';
export type Status = 'empty' | 'rendering-sample' | 'loading-model' | 'detecting' | 'ready' | 'no-face' | 'error';
export type ViewMode = 'overlay' | 'side';
export type Tool = 'select' | 'hand';
export type Theme = 'auto' | 'light' | 'dark';
export type SegStatus = 'idle' | 'running' | 'done' | 'unavailable';

export interface AppState {
  status: Status;
  error: string | null;
  image: WorkImage | null;
  detection: Detection | null;
  /** Landmarks en uso (px de la imagen de trabajo), con las correcciones. */
  landmarks: Vec3[] | null;
  /** Puntos fuera de la malla que el usuario ya colocó (los demás se estiman). */
  extrasPlaced: Partial<Record<ExtraId, Vec2>>;
  poseAdjust: PoseAngles;
  /** Segmentación de cabello/cara (para silueta, envolvente y espacios negativos). */
  segmentation: Segmentation | null;
  segStatus: SegStatus;
  /** Expresiones detectadas que el usuario decidió ignorar al medir. */
  ignoreExpressions: Partial<Record<ExpressionId, boolean>>;
  /** Lados de la envolvente (7–9). */
  envelopeSides: number;
  /** Medidas del paso C marcadas como «ya lo revisé». */
  checkedMeasures: Record<string, boolean>;
  step: StepId;
  layers: Record<LayerId, boolean>;
  lineOpacity: number;
  photoOpacity: number;
  viewMode: ViewMode;
  tool: Tool;
  selectedKey: string | null;
  theme: Theme;
}

export const initialState: AppState = {
  status: 'empty',
  error: null,
  image: null,
  detection: null,
  landmarks: null,
  extrasPlaced: {},
  poseAdjust: ZERO_POSE,
  segmentation: null,
  segStatus: 'idle',
  ignoreExpressions: {},
  envelopeSides: 8,
  checkedMeasures: {},
  step: 'R',
  layers: { envelope: true, structure: true, measures: true, points: true, indices: false },
  lineOpacity: 0.9,
  photoOpacity: 1,
  viewMode: 'overlay',
  tool: 'select',
  selectedKey: null,
  theme: 'auto',
};

export type Listener = (state: AppState, prev: AppState) => void;

export interface Store {
  get(): AppState;
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void;
  subscribe(listener: Listener): () => void;
}

export function createStore(initial: AppState): Store {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      const delta = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...delta };
      for (const l of listeners) l(state, prev);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Preferencias que sobreviven a la recarga (localStorage, con try/catch).
const PREFS_KEY = 'encaje-retrato:prefs:v2';
type Prefs = Pick<AppState, 'layers' | 'lineOpacity' | 'photoOpacity' | 'viewMode' | 'theme'>;

export function loadPrefs(): Partial<Prefs> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

export function savePrefs(s: AppState): void {
  try {
    const p: Prefs = {
      layers: s.layers,
      lineOpacity: s.lineOpacity,
      photoOpacity: s.photoOpacity,
      viewMode: s.viewMode,
      theme: s.theme,
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // sin almacenamiento: las preferencias duran solo esta sesión
  }
}
