// Carga de la foto: se reduce a ~1,600 px en el lado mayor para trabajar y se
// conserva el archivo original para exportar.

export const WORK_MAX_SIDE = 1600;

export interface WorkImage {
  /** Imagen de trabajo (lado mayor ≤ 1,600 px). */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  /** Escala de trabajo / original. */
  scale: number;
  name: string;
  original: Blob;
  /** Identificador único de esta carga (para cachés derivados). */
  id: string;
}

export async function loadImageFile(file: Blob, name = 'foto'): Promise<WorkImage> {
  // createImageBitmap respeta la orientación EXIF por omisión.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const ow = bitmap.width;
  const oh = bitmap.height;
  const scale = Math.min(1, WORK_MAX_SIDE / Math.max(ow, oh));
  const width = Math.round(ow * scale);
  const height = Math.round(oh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas-2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return {
    canvas,
    width,
    height,
    originalWidth: ow,
    originalHeight: oh,
    scale,
    name,
    original: file,
    id: `${name}-${ow}x${oh}-${Date.now()}`,
  };
}

export async function loadImageUrl(url: string, name?: string): Promise<WorkImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return loadImageFile(await res.blob(), name ?? url.split('/').pop() ?? 'foto');
}

/** Imagen de trabajo a partir de un lienzo ya dibujado (la muestra de ejemplo). */
export async function workImageFromCanvas(src: HTMLCanvasElement, name: string): Promise<WorkImage> {
  const blob = await new Promise<Blob>((resolve, reject) => src.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
  return loadImageFile(blob, name);
}
