// Álgebra mínima para la app: vectores 2D/3D y matrices 3×3 en orden de filas.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Matriz 3×3 en orden de filas: [m00, m01, m02, m10, ..., m22]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add3 = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub3 = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale3 = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const norm3 = (a: Vec3): Vec3 => {
  const l = len3(a) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const mid3 = (a: Vec3, b: Vec3): Vec3 => lerp3(a, b, 0.5);

export const sub2 = (a: Vec2, b: Vec2): Vec2 => v2(a.x - b.x, a.y - b.y);
export const add2 = (a: Vec2, b: Vec2): Vec2 => v2(a.x + b.x, a.y + b.y);
export const len2 = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid2 = (a: Vec2, b: Vec2): Vec2 => v2((a.x + b.x) / 2, (a.y + b.y) / 2);

export const centroid3 = (pts: readonly Vec3[]): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = pts.length || 1;
  return v3(x / n, y / n, z / n);
};

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function apply3(m: Mat3, p: Vec3): Vec3 {
  return v3(
    m[0] * p.x + m[1] * p.y + m[2] * p.z,
    m[3] * p.x + m[4] * p.y + m[5] * p.z,
    m[6] * p.x + m[7] * p.y + m[8] * p.z,
  );
}

export function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Columna j como vector. */
export const col3 = (m: Mat3, j: number): Vec3 => v3(m[j], m[3 + j], m[6 + j]);

/** Matriz a partir de tres columnas. */
export const fromCols3 = (a: Vec3, b: Vec3, c: Vec3): Mat3 => [a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z];

/** Rotación de ángulo `a` (rad) alrededor de x, regla de la mano derecha. */
export const rotX = (a: number): Mat3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const rotY = (a: number): Mat3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rotZ = (a: number): Mat3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/**
 * Rotación propia más cercana (descomposición polar por iteración de Newton).
 * Quita escala y cizalla de una matriz casi ortogonal.
 */
export function orthonormalize3(m: Mat3): Mat3 {
  let r = m.slice() as Mat3;
  for (let k = 0; k < 30; k++) {
    const inv = invert3(r);
    if (!inv) break;
    const invT = transpose3(inv);
    const next = r.map((v, i) => 0.5 * (v + invT[i])) as Mat3;
    const diff = next.reduce((s, v, i) => s + Math.abs(v - r[i]), 0);
    r = next;
    if (diff < 1e-12) break;
  }
  return r;
}

export function invert3(m: Mat3): Mat3 | null {
  const d = det3(m);
  if (Math.abs(d) < 1e-15) return null;
  const [a, b, c, e, f, g, h, i, j] = m;
  return [
    (f * j - g * i) / d,
    (c * i - b * j) / d,
    (b * g - c * f) / d,
    (g * h - e * j) / d,
    (a * j - c * h) / d,
    (c * e - a * g) / d,
    (e * i - f * h) / d,
    (b * h - a * i) / d,
    (a * f - b * e) / d,
  ];
}

/** Rotación desde un cuaternión unitario (w, x, y, z). */
export function quatToMat3(w: number, x: number, y: number, z: number): Mat3 {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/**
 * Valores y vectores propios de una matriz simétrica n×n (método de Jacobi).
 * Devuelve los vectores como columnas de `vectors` (orden de filas, n×n),
 * ordenados de mayor a menor valor propio.
 */
export function symmetricEigen(a: number[], n: number): { values: number[]; vectors: number[] } {
  const m = a.slice();
  const v = new Array(n * n).fill(0);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p * n + q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = m[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (m[q * n + q] - m[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k * n + p];
          const mkq = m[k * n + q];
          m[k * n + p] = c * mkp - s * mkq;
          m[k * n + q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p * n + k];
          const mqk = m[q * n + k];
          m[p * n + k] = c * mpk - s * mqk;
          m[q * n + k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p];
          const vkq = v[k * n + q];
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [...Array(n).keys()].sort((i, j) => m[j * n + j] - m[i * n + i]);
  const values = order.map((i) => m[i * n + i]);
  const vectors = new Array(n * n).fill(0);
  order.forEach((src, dst) => {
    for (let k = 0; k < n; k++) vectors[k * n + dst] = v[k * n + src];
  });
  return { values, vectors };
}

export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
