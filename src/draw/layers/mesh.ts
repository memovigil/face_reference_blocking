// Malla detectada (capa «Estructura» en el paso de revisión): teselado tenue y
// óvalo de la cara, para ver de un vistazo si la detección siguió a la cara.

import { CANONICAL_TRIANGLES } from '../../data/canonicalFace';
import { FACE_OVAL } from '../../detect/landmarkMap';
import type { Vec2 } from '../../geom/vec';
import { polyline, s, segments } from '../svg';
import type { LayerDef } from './types';

const EDGES: [number, number][] = (() => {
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (let t = 0; t < CANONICAL_TRIANGLES.length; t += 3) {
    for (const [a, b] of [
      [CANONICAL_TRIANGLES[t], CANONICAL_TRIANGLES[t + 1]],
      [CANONICAL_TRIANGLES[t + 1], CANONICAL_TRIANGLES[t + 2]],
      [CANONICAL_TRIANGLES[t + 2], CANONICAL_TRIANGLES[t]],
    ]) {
      const key = a < b ? a * 1000 + b : b * 1000 + a;
      if (!seen.has(key)) {
        seen.add(key);
        out.push([a, b]);
      }
    }
  }
  return out;
})();

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
    const pairs = EDGES.map(([a, b]) => [lm[a], lm[b]] as [Vec2, Vec2]);
    s('path', { class: 'mesh-tess', d: segments(pairs) }, g);
    s('path', { class: 'mesh-oval', d: polyline(FACE_OVAL.map((i) => lm[i]), true) }, g);
    for (const ring of Object.values(ORDERED)) {
      s('path', { class: 'mesh-feature', d: polyline(ring.map((i) => lm[i]), true) }, g);
    }
  },
};
