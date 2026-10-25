// Segmentación multiclase (MediaPipe selfie_multiclass_256x256), local.
// Clases: 0 fondo, 1 cabello, 2 piel del cuerpo, 3 piel de la cara, 4 ropa,
// 5 otros (accesorios: sombreros, lentes…). Sirve para la silueta de la cabeza
// con cabello: puntos estimados de cima, cráneo y nuca, nacimiento del cabello,
// envolvente (paso A) y espacios negativos.

import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

export const SEG = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, other: 5 } as const;

export interface Segmentation {
  width: number;
  height: number;
  /** Clase por píxel, en la resolución de la imagen de trabajo. */
  mask: Uint8Array;
  ms: number;
}

const BASE = import.meta.env.BASE_URL;
let segmenterPromise: Promise<ImageSegmenter> | null = null;

function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = FilesetResolver.forVisionTasks(`${BASE}wasm`).then((fileset) =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/selfie_multiclass_256x256.tflite`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      }),
    );
    segmenterPromise.catch(() => {
      segmenterPromise = null;
    });
  }
  return segmenterPromise;
}

/** Segmenta la imagen. Devuelve null si el modelo no está disponible. */
export async function segmentImage(source: HTMLCanvasElement): Promise<Segmentation | null> {
  let seg: ImageSegmenter;
  try {
    seg = await getSegmenter();
  } catch (err) {
    console.warn('Segmentación no disponible', err);
    return null;
  }
  const t0 = performance.now();
  let out: Segmentation | null = null;
  seg.segment(source, (res) => {
    const m = res.categoryMask;
    if (!m) return;
    // La máscara solo vive durante el callback: se copia.
    out = { width: m.width, height: m.height, mask: m.getAsUint8Array().slice(), ms: 0 };
  });
  if (!out) return null;
  const s: Segmentation = out;
  s.ms = performance.now() - t0;
  if (s.width !== source.width || s.height !== source.height) return resample(s, source.width, source.height);
  return s;
}

/** Vecino más cercano, por si la máscara no viene a la resolución de la imagen. */
function resample(s: Segmentation, w: number, h: number): Segmentation {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(s.height - 1, Math.floor((y * s.height) / h));
    for (let x = 0; x < w; x++) mask[y * w + x] = s.mask[sy * s.width + Math.min(s.width - 1, Math.floor((x * s.width) / w))];
  }
  return { width: w, height: h, mask, ms: s.ms };
}
