// Genera src/data/canonicalFace.ts a partir de reference/canonical_face_model.obj
// (modelo canónico oficial de MediaPipe, 468 vértices en cm, y hacia arriba,
// z hacia la cámara). El orden de los vértices es el orden de los landmarks.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const obj = await readFile(join(root, 'reference/canonical_face_model.obj'), 'utf8');
const verts = [];
const tris = [];
for (const line of obj.split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'v') verts.push(p.slice(1, 4).map(Number));
  if (p[0] === 'f') tris.push(p.slice(1, 4).map((t) => Number(t.split('/')[0]) - 1));
}
if (verts.length !== 468) throw new Error(`se esperaban 468 vértices, hay ${verts.length}`);
const r = (n) => Math.round(n * 1e4) / 1e4;
const src = `// GENERADO por scripts/build-canonical.mjs — no editar a mano.
// Modelo canónico de MediaPipe (canonical_face_model.obj, Apache 2.0).
// Unidades: cm. Ejes: +x = izquierda del sujeto (derecha de quien mira),
// +y = arriba, +z = hacia la cámara. Índice = índice de landmark.

/** 468 vértices aplanados [x0, y0, z0, x1, ...]. */
export const CANONICAL_VERTICES = new Float32Array([${verts.flat().map(r).join(',')}]);

/** ${tris.length} triángulos aplanados [a0, b0, c0, a1, ...] (índices de landmark). */
export const CANONICAL_TRIANGLES = new Uint16Array([${tris.flat().join(',')}]);
`;
await writeFile(join(root, 'src/data/canonicalFace.ts'), src);
console.log(`canonicalFace.ts: ${verts.length} vértices, ${tris.length} triángulos`);
