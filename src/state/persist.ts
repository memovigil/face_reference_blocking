// Proyecto actual en IndexedDB (solo en este navegador): la foto original, la
// detección, los puntos corregidos, el modo manual y los ajustes de cada paso,
// para que no se pierdan al recargar. La segmentación se vuelve a calcular.
// Si IndexedDB no está disponible (ventana privada, permisos), no se guarda nada
// y la app sigue igual.

import type { Detection } from '../detect/faceLandmarker';
import type { AppState } from './store';

const DB = 'encaje-retrato';
const VERSION = 1;
const PHOTO = 'foto';
const PROJECT = 'proyecto';
const KEY = 'actual';

/** Campos del estado que forman el proyecto. */
const FIELDS = [
  'extrasPlaced',
  'poseAdjust',
  'ignoreExpressions',
  'envelopeSides',
  'checkedMeasures',
  'blockLevel',
  'blockLineWidth',
  'blockNames',
  'valueBlur',
  'terminator',
  'valueStraight',
  'lightOverride',
  'compareLight',
  'step',
  'manual',
] as const satisfies readonly (keyof AppState)[];

type ProjectFields = Pick<AppState, (typeof FIELDS)[number]>;

export interface SavedProject extends ProjectFields {
  version: 1;
  savedAt: number;
  photoId: string;
  name: string;
  detection: Detection | null;
  autoDetection: Detection | null;
  /** Landmarks corregidos (null = los de la detección, sin editar). */
  landmarks: AppState['landmarks'];
}

export interface SavedPhoto {
  id: string;
  name: string;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTO)) db.createObjectStore(PHOTO);
        if (!db.objectStoreNames.contains(PROJECT)) db.createObjectStore(PROJECT);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function request<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** ¿Cambió algo que forma parte del proyecto? */
export function projectChanged(s: AppState, prev: AppState): boolean {
  if (s.image !== prev.image || s.detection !== prev.detection || s.landmarks !== prev.landmarks || s.autoDetection !== prev.autoDetection) return true;
  return FIELDS.some((k) => s[k] !== prev[k]);
}

let savedPhotoId: string | null = null;

/** Guarda el proyecto (y la foto, solo si cambió). */
export async function saveProject(s: AppState): Promise<void> {
  if (!s.image || !['ready', 'no-face', 'manual'].includes(s.status)) return;
  try {
    if (savedPhotoId !== s.image.id) {
      const photo: SavedPhoto = { id: s.image.id, name: s.image.name, blob: s.image.original };
      await request(PHOTO, 'readwrite', (st) => st.put(photo, KEY));
      savedPhotoId = s.image.id;
    }
    const project: SavedProject = {
      version: 1,
      savedAt: Date.now(),
      photoId: s.image.id,
      name: s.image.name,
      detection: s.manual ? null : s.detection,
      autoDetection: s.autoDetection,
      landmarks: s.manual || s.landmarks === s.detection?.landmarks ? null : s.landmarks,
      ...(Object.fromEntries(FIELDS.map((k) => [k, s[k]])) as ProjectFields),
    };
    await request(PROJECT, 'readwrite', (st) => st.put(project, KEY));
  } catch (err) {
    console.warn('No se pudo guardar el proyecto', err);
  }
}

/** El último proyecto guardado (o null). */
export async function loadProject(): Promise<{ project: SavedProject; photo: SavedPhoto } | null> {
  try {
    const project = await request<SavedProject | undefined>(PROJECT, 'readonly', (st) => st.get(KEY));
    const photo = await request<SavedPhoto | undefined>(PHOTO, 'readonly', (st) => st.get(KEY));
    if (!project || !photo || project.version !== 1 || project.photoId !== photo.id) return null;
    savedPhotoId = photo.id;
    return { project, photo };
  } catch (err) {
    console.warn('No se pudo leer el proyecto guardado', err);
    return null;
  }
}

/** Borra el proyecto guardado. */
export async function clearProject(): Promise<void> {
  try {
    await request(PROJECT, 'readwrite', (st) => st.delete(KEY));
    await request(PHOTO, 'readwrite', (st) => st.delete(KEY));
    savedPhotoId = null;
  } catch {
    // Sin IndexedDB no hay nada que borrar.
  }
}
