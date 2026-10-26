// Detección con MediaPipe Face Landmarker, 100 % local: el modelo y el WASM se
// sirven desde /public (ver scripts/fetch-assets.mjs). Nada sale a internet.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { v3, type Vec3 } from '../geom/vec';

export interface Detection {
  /** 478 landmarks en px de la imagen de trabajo; z en px (z normalizada × ancho). */
  landmarks: Vec3[];
  /** 52 blendshapes, por nombre (0–1). */
  blendshapes: Record<string, number>;
  /** Matriz 4×4 canónico → cámara, tal como la entrega MediaPipe. */
  matrix: number[] | null;
  /** Milisegundos que tardó la detección (sin contar la carga del modelo). */
  ms: number;
  delegate: 'GPU' | 'CPU';
  /** Solo en modo manual: la malla salió de los puntos marcados (error del ajuste rígido en px y hacia dónde mira la cara). */
  manual?: { rms: number; facing: 'left' | 'right' };
}

const BASE = import.meta.env.BASE_URL;
let landmarkerPromise: Promise<{ lm: FaceLandmarker; delegate: 'GPU' | 'CPU' }> | null = null;

async function create(delegate: 'GPU' | 'CPU') {
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
  const lm = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${BASE}models/face_landmarker.task`, delegate },
    runningMode: 'IMAGE',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  return { lm, delegate };
}

/** Carga (una sola vez) el modelo. Intenta GPU y cae a CPU si no hay WebGL. */
export function getLandmarker(): Promise<{ lm: FaceLandmarker; delegate: 'GPU' | 'CPU' }> {
  if (!landmarkerPromise) {
    const prefer = new URLSearchParams(location.search).get('delegate') === 'gpu' ? 'GPU' : 'CPU';
    landmarkerPromise = create(prefer).catch((err) => {
      if (prefer === 'CPU') throw err;
      console.warn('GPU no disponible, se usa CPU', err);
      return create('CPU');
    });
    landmarkerPromise.catch(() => {
      landmarkerPromise = null;
    });
  }
  return landmarkerPromise;
}

/** Detecta una cara. Devuelve null si no hay. */
export async function detectFace(source: HTMLCanvasElement): Promise<Detection | null> {
  const { lm, delegate } = await getLandmarker();
  const t0 = performance.now();
  const res = lm.detect(source);
  const ms = performance.now() - t0;
  const face = res.faceLandmarks[0];
  if (!face || face.length < 478) return null;
  const w = source.width;
  const h = source.height;
  const landmarks = face.map((p) => v3(p.x * w, p.y * h, p.z * w));
  const blendshapes: Record<string, number> = {};
  for (const c of res.faceBlendshapes[0]?.categories ?? []) blendshapes[c.categoryName] = c.score;
  const m = res.facialTransformationMatrixes[0];
  return { landmarks, blendshapes, matrix: m ? Array.from(m.data) : null, ms, delegate };
}
