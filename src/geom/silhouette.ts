// Silueta de la cabeza con cabello a partir de la segmentación: puntos
// extremos (cima, ancho del cráneo, nuca), nacimiento del cabello y casco
// convexo para la envolvente.

import { LM } from '../detect/landmarkMap';
import { headClassTest, SEG, type Segmentation } from '../detect/segment';
import type { SimilarityFit } from './pose';
import { apply3, v2, v3, type Vec2, type Vec3 } from './vec';

export interface HeadSilhouette {
  /** Casco convexo (px) de la cabeza con cabello, cortada bajo el mentón. */
  hull: Vec2[];
  crown: Vec2;
  /** Ancho del cráneo con cabello, por encima de la ceja (lado derecho / izquierdo del sujeto). */
  skullR: Vec2;
  skullL: Vec2;
  /** Contorno trasero (solo tiene sentido con la cabeza girada). */
  back: Vec2;
  /** Nacimiento del cabello en la línea media; null si no se ve. */
  hairline: Vec2 | null;
  /** El cabello cubre la frente (fleco, mechón): el nacimiento real no se ve. */
  hairlineCovered: boolean;
  /** Puntos que tocan el borde de la foto: la cabeza sigue fuera del cuadro. */
  cropped: { crown: boolean; skullR: boolean; skullL: boolean; back: boolean };
  /** Máscara de la cabeza (1 = cabeza) en la caja `box`. */
  head: Uint8Array;
  box: { x: number; y: number; w: number; h: number };
}

/** Dirección (2D, unitaria) en la imagen de un eje del marco de la cabeza. */
export function headAxis(rotation: SimilarityFit['rotation'], axis: Vec3): Vec2 {
  const k = apply3(rotation, axis);
  const l = Math.hypot(k.x, k.y) || 1;
  return v2(k.x / l, -k.y / l);
}

export function headSilhouette(seg: Segmentation, landmarks: readonly Vec3[], frame: SimilarityFit): HeadSilhouette | null {
  const { width: W, height: H, mask } = seg;
  const isHead = headClassTest(seg);
  const up = headAxis(frame.rotation, v3(0, 1, 0));
  const down = v2(-up.x, -up.y);
  const ipd = Math.hypot(landmarks[LM.subjectLeft.pupil].x - landmarks[LM.subjectRight.pupil].x, landmarks[LM.subjectLeft.pupil].y - landmarks[LM.subjectRight.pupil].y);
  const chin = landmarks[LM.menton];
  const brow = landmarks[LM.glabella];
  const lobeLevel = landmarks[LM.subnasale];
  const faceH = Math.hypot(landmarks[LM.foreheadTop].x - chin.x, landmarks[LM.foreheadTop].y - chin.y);

  // Caja de búsqueda alrededor de la cara (la cabeza con cabello cabe holgada).
  const cx = landmarks[LM.noseTip].x;
  const cy = landmarks[LM.noseTip].y;
  const R = faceH * 1.25;
  const x0 = Math.max(0, Math.floor(cx - R));
  const y0 = Math.max(0, Math.floor(cy - R * 1.2));
  const x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y1 = Math.min(H - 1, Math.ceil(cy + R));
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (bw < 4 || bh < 4) return null;

  // Corte: un poco por debajo del mentón, perpendicular al eje de la cabeza.
  const cut = (chin.x - cx) * down.x + (chin.y - cy) * down.y + 0.12 * faceH;
  const head = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gx = x + x0;
      const gy = y + y0;
      if (!isHead(mask[gy * W + gx])) continue;
      if ((gx - cx) * down.x + (gy - cy) * down.y > cut) continue;
      head[y * bw + x] = 2; // candidato
    }
  }
  // Componente conexa que contiene la cara (semilla: punta de nariz o un vecino).
  const seedX = Math.round(cx) - x0;
  const seedY = Math.round(cy) - y0;
  let seed = -1;
  // De perfil la distancia entre pupilas casi desaparece: el radio de búsqueda va también con el alto de la cara.
  for (let r = 0; r < Math.max(ipd * 0.5, faceH * 0.08) && seed < 0; r++) {
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const x = seedX + dx;
      const y = seedY + dy;
      if (x >= 0 && y >= 0 && x < bw && y < bh && head[y * bw + x] === 2) {
        seed = y * bw + x;
        break;
      }
    }
  }
  if (seed < 0) return null;
  const stack = [seed];
  head[seed] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % bw;
    const y = (i - x) / bw;
    if (x > 0 && head[i - 1] === 2) { head[i - 1] = 1; stack.push(i - 1); }
    if (x < bw - 1 && head[i + 1] === 2) { head[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && head[i - bw] === 2) { head[i - bw] = 1; stack.push(i - bw); }
    if (y < bh - 1 && head[i + bw] === 2) { head[i + bw] = 1; stack.push(i + bw); }
  }
  for (let i = 0; i < head.length; i++) if (head[i] !== 1) head[i] = 0;

  // Píxeles de borde (para casco y extremos).
  const edge: Vec2[] = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (!head[i]) continue;
      if (x === 0 || y === 0 || x === bw - 1 || y === bh - 1 || !head[i - 1] || !head[i + 1] || !head[i - bw] || !head[i + bw]) {
        edge.push(v2(x + x0 + 0.5, y + y0 + 0.5));
      }
    }
  }
  if (edge.length < 8) return null;

  const along = (p: Vec2, d: Vec2) => p.x * d.x + p.y * d.y;
  const extreme = (d: Vec2, keep: (p: Vec2) => boolean = () => true): Vec2 => {
    let best = edge[0];
    let bv = -Infinity;
    for (const p of edge) {
      if (!keep(p)) continue;
      const v = along(p, d);
      if (v > bv) {
        bv = v;
        best = p;
      }
    }
    return best;
  };
  const aboveBrow = (p: Vec2) => along(p, up) > along(brow, up);
  const aboveLobe = (p: Vec2) => along(p, up) > along(lobeLevel, up);
  let side = v2(-up.y, up.x);
  const rightAxis = headAxis(frame.rotation, v3(-1, 0, 0));
  if (side.x * rightAxis.x + side.y * rightAxis.y < 0) side = v2(-side.x, -side.y);
  const back = headAxis(frame.rotation, v3(0, 0, -1));

  const crown = extreme(up);
  const skullR = extreme(side, aboveBrow);
  const skullL = extreme(v2(-side.x, -side.y), aboveBrow);
  const backPt = extreme(back, aboveLobe);
  const atBorder = (p: Vec2) => p.x < 2 || p.y < 2 || p.x > W - 2 || p.y > H - 2;
  const hair = findHairline(seg, landmarks, up, faceH);
  // Un nacimiento real queda al menos ~1.5 cm por encima de la frente alta (10):
  // en el canónico, 10 está 3.4 cm sobre la glabela y la frente mide 5–6.5 cm.
  // Más cerca que 1.2 cm es cabello cayendo sobre la frente.
  const top = landmarks[LM.foreheadTop];
  const covered = !!hair && ((hair.x - top.x) * up.x + (hair.y - top.y) * up.y) / frame.scale < 1.2;
  return {
    hull: convexHull(edge),
    crown,
    skullR,
    skullL,
    back: backPt,
    hairline: covered ? null : hair,
    hairlineCovered: covered,
    cropped: { crown: atBorder(crown), skullR: atBorder(skullR), skullL: atBorder(skullL), back: atBorder(backPt) },
    head,
    box: { x: x0, y: y0, w: bw, h: bh },
  };
}

/**
 * Nacimiento del cabello: desde la frente alta (10) se sube por el eje de la
 * cabeza hasta el primer píxel de cabello. Si no aparece en 0.45 alturas de
 * cara, no hay cabello sobre la frente (calvicie, frente despejada hacia atrás).
 */
function findHairline(seg: Segmentation, lm: readonly Vec3[], up: Vec2, faceH: number): Vec2 | null {
  const start = lm[LM.foreheadTop];
  const steps = Math.ceil(faceH * 0.45);
  let run = 0;
  for (let t = 0; t <= steps; t++) {
    const x = Math.round(start.x + up.x * t);
    const y = Math.round(start.y + up.y * t);
    if (x < 0 || y < 0 || x >= seg.width || y >= seg.height) return null;
    // Tres píxeles seguidos de cabello, para no tomar un mechón suelto.
    if (seg.mask[y * seg.width + x] === SEG.hair) {
      if (++run === 3) return v2(start.x + up.x * (t - 2), start.y + up.y * (t - 2));
    } else run = 0;
  }
  return null;
}

/** Casco convexo (cadena monótona de Andrew). */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
