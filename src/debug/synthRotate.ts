// Pruebas con verdad conocida: toma la malla 3D detectada en una foto frontal,
// la texturiza con la propia foto y la renderiza girada un ángulo exacto. Al
// volver a detectar, el giro medido debe coincidir con el aplicado. Solo lo
// usan las pruebas (window.__encaje.synthRotate); no forma parte de la interfaz.

import { CANONICAL_TRIANGLES } from '../data/canonicalFace';
import { centroid3, rad, v3, type Vec3 } from '../geom/vec';

export function renderRotatedFace(
  src: HTMLCanvasElement,
  lm: readonly Vec3[],
  yawDeg: number,
  pitchDeg = 0,
  background = '#d9d6d0',
): { canvas: HTMLCanvasElement; rotated: Vec3[] } {
  const pts = lm.slice(0, 468);
  const c = centroid3(pts);
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  // Centro de giro: detrás de la cara, cerca del centro de la cabeza.
  const pivot = v3(c.x, c.y, c.z + (maxX - minX) * 0.55);
  const cy = Math.cos(rad(yawDeg));
  const sy = Math.sin(rad(yawDeg));
  const cp = Math.cos(rad(pitchDeg));
  const sp = Math.sin(rad(pitchDeg));
  // Marco de imagen (y abajo, z lejos). +giro: la nariz (z < 0) va a +x.
  // +cabeceo: la nariz va hacia abajo (+y).
  const rot = pts.map((p) => {
    const x = p.x - pivot.x;
    const y = p.y - pivot.y;
    const z = p.z - pivot.z;
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    return v3(x1 + pivot.x, y2 + pivot.y, z2 + pivot.z);
  });

  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, out.width, out.height);

  const area = (a: Vec3, b: Vec3, d: Vec3) => (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  // Orientación de los triángulos que miran a la cámara en la foto original.
  let front = 0;
  for (let t = 0; t < CANONICAL_TRIANGLES.length; t += 3) {
    front += Math.sign(area(pts[CANONICAL_TRIANGLES[t]], pts[CANONICAL_TRIANGLES[t + 1]], pts[CANONICAL_TRIANGLES[t + 2]]));
  }
  const frontSign = Math.sign(front) || 1;

  const tris: { i: [number, number, number]; z: number }[] = [];
  for (let t = 0; t < CANONICAL_TRIANGLES.length; t += 3) {
    const i: [number, number, number] = [CANONICAL_TRIANGLES[t], CANONICAL_TRIANGLES[t + 1], CANONICAL_TRIANGLES[t + 2]];
    if (Math.sign(area(rot[i[0]], rot[i[1]], rot[i[2]])) !== frontSign) continue;
    tris.push({ i, z: (rot[i[0]].z + rot[i[1]].z + rot[i[2]].z) / 3 });
  }
  tris.sort((a, b) => b.z - a.z); // del más lejano al más cercano

  for (const { i } of tris) {
    const [s0, s1, s2] = i.map((k) => pts[k]);
    const [d0, d1, d2] = i.map((k) => rot[k]);
    // Afín que lleva el triángulo de la foto al triángulo girado.
    const den = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
    if (Math.abs(den) < 1e-6) continue;
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / den;
    const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / den;
    const cc = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / den;
    const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / den;
    const e = d0.x - a * s0.x - cc * s0.y;
    const f = d0.y - b * s0.x - d * s0.y;
    // Recorte un poco inflado para no dejar costuras entre triángulos.
    const mx = (d0.x + d1.x + d2.x) / 3;
    const my = (d0.y + d1.y + d2.y) / 3;
    const grow = (p: Vec3) => {
      const dx = p.x - mx;
      const dy = p.y - my;
      const l = Math.hypot(dx, dy) || 1;
      return [p.x + (dx / l) * 0.7, p.y + (dy / l) * 0.7];
    };
    ctx.save();
    ctx.beginPath();
    const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
    ctx.moveTo(g0[0], g0[1]);
    ctx.lineTo(g1[0], g1[1]);
    ctx.lineTo(g2[0], g2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, b, cc, d, e, f);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }
  return { canvas: out, rotated: rot };
}
