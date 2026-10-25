// Prepara los archivos que la app necesita para funcionar sin conexión.
//   - WASM de @mediapipe/tasks-vision  -> public/wasm/   (se copia de node_modules)
//   - Modelo face_landmarker.task      -> public/models/ (versionado en git; se baja si falta)
// Con --fixtures también baja las referencias oficiales de la malla y las imágenes
// de prueba de MediaPipe (Apache 2.0), que ya están versionadas.
// Corre solo en `npm install` (postinstall). Si un archivo ya existe, no se vuelve a bajar.
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MP_ASSETS = 'https://storage.googleapis.com/mediapipe-assets';
const MP_RAW = 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master';

const runtime = [
  {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    to: 'public/models/face_landmarker.task',
  },
];

const fixtures = [
  { url: `${MP_RAW}/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png`, to: 'reference/canonical_face_model_uv_visualization.png' },
  { url: `${MP_RAW}/mediapipe/modules/face_geometry/data/canonical_face_model.obj`, to: 'reference/canonical_face_model.obj' },
  { url: `${MP_ASSETS}/portrait.jpg`, to: 'tests/fixtures/mediapipe/portrait.jpg' },
  { url: `${MP_ASSETS}/portrait_rotated.jpg`, to: 'tests/fixtures/mediapipe/portrait_rotated.jpg' },
  { url: `${MP_ASSETS}/portrait_small.jpg`, to: 'tests/fixtures/mediapipe/portrait_small.jpg' },
  { url: `${MP_ASSETS}/business-person.png`, to: 'tests/fixtures/mediapipe/business-person.png' },
  { url: `${MP_ASSETS}/face_stylizer_raw_face_demo.png`, to: 'tests/fixtures/mediapipe/face_stylizer_raw_face_demo.png' },
  { url: `${MP_ASSETS}/face_stylizer_style_color_sketch.jpg`, to: 'tests/fixtures/mediapipe/face_stylizer_style_color_sketch.jpg' },
  { url: `${MP_ASSETS}/man-woman-okay.jpg`, to: 'tests/fixtures/mediapipe/man-woman-okay.jpg' },
];

const wasmFiles = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

for (const f of wasmFiles) {
  const to = join(root, 'public/wasm', f);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(join(root, 'node_modules/@mediapipe/tasks-vision/wasm', f), to);
}
console.log(`wasm: ${wasmFiles.length} archivos copiados`);

const downloads = process.argv.includes('--fixtures') ? [...runtime, ...fixtures] : runtime;
for (const { url, to } of downloads) {
  const dest = join(root, to);
  if (await exists(dest)) {
    console.log(`ya existe: ${to}`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`falló (${res.status}): ${url}`);
    continue;
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`descargado: ${to}`);
}
