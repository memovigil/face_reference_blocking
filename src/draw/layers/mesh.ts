// Malla detectada (capa «Estructura» en el paso de revisión): teselado tenue y
// óvalo de la cara, para ver de un vistazo si la detección siguió a la cara.
// Solo se dibuja lo que mira a la cámara: de perfil (modo manual) el lado
// lejano quedaría cruzando la cara.

import { CANONICAL_TRIANGLES } from '../../data/canonicalFace';
import { FACE_OVAL } from '../../detect/landmarkMap';
import { meshTopology } from '../../geom/planes';
import type { Vec2, Vec3 } from '../../geom/vec';
import { s, segments } from '../svg';
import type { LayerDef } from './types';

const edgeKey = (a: number, b: number) => (a < b ? a * 1000 + b : b * 1000 + a);

/** Aristas de la malla y los triángulos que las comparten. */
const EDGES: Map<number, { a: number; b: number; tris: number[] }> = (() => {
  const out = new Map<number, { a: number; b: number; tris: number[] }>();
  for (let t = 0; t < CANONICAL_TRIANGLES.length; t += 3) {
    for (const [a, b] of [
      [CANONICAL_TRIANGLES[t], CANONICAL_TRIANGLES[t + 1]],
      [CANONICAL_TRIANGLES[t + 1], CANONICAL_TRIANGLES[t + 2]],
      [CANONICAL_TRIANGLES[t + 2], CANONICAL_TRIANGLES[t]],
    ]) {
      const k = edgeKey(a, b);
      const e = out.get(k) ?? { a, b, tris: [] };
      e.tris.push(t / 3);
      out.set(k, e);
    }
  }
  return out;
})();

/** Triángulos que miran a la cámara (en la imagen: y abajo, z lejos). */
function frontFacing(lm: readonly Vec3[]): boolean[] {
  const { tris, windingSign } = meshTopology();
  return tris.map(([a, b, c]) => windingSign * ((lm[b].x - lm[a].x) * (lm[c].y - lm[a].y) - (lm[b].y - lm[a].y) * (lm[c].x - lm[a].x)) < 0);
}

// Contornos de ojos y labios en orden (para dibujarlos como curvas cerradas).
const ORDERED = {
  rightEye: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  leftEye: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
  lipsOuter: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
  lipsInner: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
};

export const meshLayer: LayerDef = {
  id: 'mesh',
  layer: 'structure',
  steps: ['R'],
  render(g, { state }) {
    const lm = state.landmarks!;
    const front = frontFacing(lm);
    const seen = (a: number, b: number) => {
      const e = EDGES.get(edgeKey(a, b));
      return !e || e.tris.some((t) => front[t]);
    };
    const pairs = [...EDGES.values()].filter((e) => e.tris.some((t) => front[t])).map((e) => [lm[e.a], lm[e.b]] as [Vec2, Vec2]);
    s('path', { class: 'mesh-tess', d: segments(pairs) }, g);
    const ring = (ids: readonly number[]) => ids.map((a, i) => [a, ids[(i + 1) % ids.length]] as const).filter(([a, b]) => seen(a, b)).map(([a, b]) => [lm[a], lm[b]] as [Vec2, Vec2]);
    s('path', { class: 'mesh-oval', d: segments(ring(FACE_OVAL)) }, g);
    for (const r of Object.values(ORDERED)) s('path', { class: 'mesh-feature', d: segments(ring(r)) }, g);
  },
};
