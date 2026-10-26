// Estado único de la app y suscripciones. Todo cambio pasa por `set`.
// La vista (zoom y desplazamiento) vive en el visor, no aquí: cambia a cada
// cuadro y no debe redibujar las capas.

import type { BlockLevel } from '../geom/planes';
import type { Detection } from '../detect/faceLandmarker';
import type { ExtraId } from '../detect/keypoints';
import type { Segmentation } from '../detect/segment';
import type { ExpressionId } from '../geom/expression';
import { ZERO_POSE, type PoseAngles } from '../geom/pose';
import type { Vec2, Vec3 } from '../geom/vec';
import type { WorkImage } from '../image/load';
import type { ManualState } from './manual';

export type StepId = 'R' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';
export type LayerId = 'values' | 'envelope' | 'structure' | 'measures' | 'points' | 'indices';
/** 'manual': modo manual con menos puntos de los necesarios para la malla. */
export type Status = 'empty' | 'rendering-sample' | 'loading-model' | 'detecting' | 'ready' | 'no-face' | 'manual' | 'error';
export type ViewMode = 'overlay' | 'side';
export type Tool = 'select' | 'hand';
export type Theme = 'auto' | 'light' | 'dark';
export type SegStatus = 'idle' | 'running' | 'done' | 'unavailable';

export interface AppState {
  status: Status;
  error: string | null;
  image: WorkImage | null;
  /** Detección en uso: la del detector o, en modo manual, la malla ajustada a los puntos. */
  detection: Detection | null;
  /** Lo que dio el detector (se conserva al pasar al modo manual, para volver). */
  autoDetection: Detection | null;
  /** Modo manual (§5.5): puntos marcados a mano; null = detección automática. */
  manual: ManualState | null;
  /** El proyecto se recuperó de la sesión anterior (IndexedDB). */
  restored: boolean;
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
  /** Paso D: nivel de simplificación, grosor de línea y nombres de los planos. */
  blockLevel: BlockLevel;
  blockLineWidth: number;
  blockNames: boolean;
  /** Pasos F–H: radio del desenfoque (en distancias entre pupilas), terminador (−1…1) y bordes rectos. */
  valueBlur: number;
  terminator: number;
  valueStraight: boolean;
  /** Luz elegida a mano (null = la estimada de la foto). θ: de dónde viene, en sentido horario desde arriba; φ: ángulo desde el frente. */
  lightOverride: { theta: number; phi: number } | null;
  /** Paso E: comparar las masas del poliedro con las de la foto, lado a lado. */
  compareLight: boolean;
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
  autoDetection: null,
  manual: null,
  restored: false,
  landmarks: null,
  extrasPlaced: {},
  poseAdjust: ZERO_POSE,
  segmentation: null,
  segStatus: 'idle',
  ignoreExpressions: {},
  envelopeSides: 8,
  checkedMeasures: {},
  blockLevel: 'grande',
  blockLineWidth: 1,
  blockNames: false,
  valueBlur: 0.06,
  terminator: 0,
  valueStraight: false,
  lightOverride: null,
  compareLight: false,
  step: 'R',
  layers: { values: true, envelope: true, structure: true, measures: true, points: true, indices: false },
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
    const p = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    // Capas nuevas de versiones posteriores: se completan con las de omisión.
    if (p.layers) p.layers = { ...initialState.layers, ...p.layers };
    return p;
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
