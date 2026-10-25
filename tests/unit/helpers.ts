// Ayudantes compartidos por las pruebas unitarias.
import { canonicalPoint } from '../../src/geom/canonical';
import { rotationFromAngles, type PoseAngles } from '../../src/geom/pose';
import { apply3, v3, type Mat3, type Vec3 } from '../../src/geom/vec';

/** Landmarks sintéticos: el canónico girado y proyectado (ortográfica) a px. */
export function syntheticLandmarks(angles: PoseAngles, scale = 20, cx = 400, cy = 500, shape?: (i: number, p: Vec3) => Vec3): Vec3[] {
  const r = rotationFromAngles(angles);
  const at = (p: Vec3) => {
    const k = apply3(r, p);
    return v3(cx + k.x * scale, cy - k.y * scale, -k.z * scale);
  };
  const base = (i: number) => (shape ? shape(i, canonicalPoint(i)) : canonicalPoint(i));
  const out: Vec3[] = [];
  for (let i = 0; i < 468; i++) out.push(at(base(i)));
  const pupil = (a: number, b: number, u: number, l: number) => {
    const pa = base(a);
    const pb = base(b);
    return at(v3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (base(u).z + base(l).z) / 2));
  };
  const pr = pupil(33, 133, 159, 145);
  const pl = pupil(263, 362, 386, 374);
  for (let i = 0; i < 5; i++) out.push(pr);
  for (let i = 0; i < 5; i++) out.push(pl);
  return out;
}

/** Matriz 4×4 column-major como la entrega MediaPipe. */
export function mediapipeMatrix(r: Mat3, t: Vec3, scale = 1): number[] {
  const m = new Array(16).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[j * 4 + i] = r[i * 3 + j] * scale;
  m[12] = t.x;
  m[13] = t.y;
  m[14] = t.z;
  m[15] = 1;
  return m;
}
