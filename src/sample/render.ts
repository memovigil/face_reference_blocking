// Muestra de ejemplo (§11): una cabeza 3D generada aquí mismo, para probar la
// app sin subir nada y sin la foto de una persona real.
//
// · Cara: la malla canónica de MediaPipe (468 puntos), pintada con una textura
//   en coordenadas canónicas (x, y): piel, labios, ojos, cejas.
// · Cráneo: una superficie que nace en el contorno de la cara (los 36 puntos
//   del óvalo) y se curva hacia atrás hasta un elipsoide. Así no hay escalón
//   entre la cara y la cabeza, y las normales se promedian en la costura.
// · Orejas, cuello y hombros: elipsoides y un cilindro.
// · Luz: una clave con sombras proyectadas (mapa de sombras ortográfico), un
//   relleno débil y luz ambiente de cielo. Pose y luz conocidas: también sirve
//   de verdad para las pruebas (fase 4: estimar la luz).
//
// Todo se rasteriza en la CPU con un z-buffer, al doble de resolución, y se
// reduce al final para suavizar los bordes.

import { CANONICAL_TRIANGLES, CANONICAL_VERTICES } from '../data/canonicalFace';
import { FACE_OVAL, LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR } from '../detect/landmarkMap';
import { projectCanonical, rotationFromAngles, type PoseAngles, type SimilarityFit } from '../geom/pose';
import { apply3, cross3, dot3, len3, norm3, sub3, v3, type Mat3, type Vec3 } from '../geom/vec';

/** Pose de la muestra (una mujer de cabello largo): ¾ hacia la derecha de la foto, un poco hacia abajo. */
export const SAMPLE_POSE: PoseAngles = { yaw: 24, pitch: 6, roll: 3 };
/** Dirección hacia la luz clave en el marco de cámara (x derecha, y arriba, z hacia la cámara). */
export const SAMPLE_LIGHT: Vec3 = norm3(v3(0.55, 0.62, 0.56));

export interface SampleRender {
  canvas: HTMLCanvasElement;
  pose: PoseAngles;
  light: Vec3;
  /** Proyección usada (canónico → px de la imagen final). */
  frame: Pick<SimilarityFit, 'rotation' | 'scale' | 'translation'>;
}

type Part = 'face' | 'skull' | 'ear' | 'neck' | 'torso' | 'hairMass';
const PART_ID: Record<Part, number> = { face: 0, skull: 1, ear: 2, neck: 3, torso: 4, hairMass: 5 };
/** El cabello largo solo existe detrás de este plano (z canónica): no tapa la cara. */
const HAIR_FRONT_Z = -3.2;

interface Mesh {
  pos: Vec3[];
  nrm: Vec3[];
  tris: number[];
  part: Uint8Array; // por triángulo
  /** 0–1 por vértice: cuánto cabello hay (se interpola y se corta en 0.5). */
  hair?: Float32Array;
  /** Coordenadas de textura de la cara (canónico sin deformar). */
  uv?: Vec3[];
}

// ---------------------------------------------------------------------------
// Geometría.

// Cráneo casi esférico visto de frente (como la esfera de Loomis), centrado a
// la altura de las cejas.
const HEAD_CENTER = v3(0, 3.8, -4.4);
/** Semiejes del elipsoide del cráneo con cabello (cm). */
const SKULL = v3(8.1, 9.3, 10.1);

const canon = (i: number) => v3(CANONICAL_VERTICES[i * 3], CANONICAL_VERTICES[i * 3 + 1], CANONICAL_VERTICES[i * 3 + 2]);

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const d = Math.min(1, Math.max(-1, dot3(a, b)));
  const om = Math.acos(d);
  if (om < 1e-6) return a;
  const s = Math.sin(om);
  const ka = Math.sin((1 - t) * om) / s;
  const kb = Math.sin(t * om) / s;
  return v3(a.x * ka + b.x * kb, a.y * ka + b.y * kb, a.z * ka + b.z * kb);
}

const ellRadius = (d: Vec3, e: Vec3) => 1 / Math.sqrt((d.x / e.x) ** 2 + (d.y / e.y) ** 2 + (d.z / e.z) ** 2);
const smooth = (a: number, b: number, t: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

/**
 * Dónde empieza el cabello a lo largo del recorrido hacia la nuca (0 = borde de
 * la cara), según la altura del punto del borde: justo arriba de la frente, un
 * poco más atrás en las sienes y detrás de la oreja a los lados.
 */
function hairStart(y: number): number {
  const table: [number, number][] = [
    [-3.5, 0.78],
    [-2, 0.46],
    [2, 0.4],
    [5, 0.2],
    [7.5, 0.08],
  ];
  if (y <= table[0][0]) return 2; // mentón y mandíbula: sin cabello
  for (let i = 1; i < table.length; i++) {
    const [y1, t1] = table[i];
    const [y0, t0] = table[i - 1];
    if (y <= y1) return t0 + ((t1 - t0) * (y - y0)) / (y1 - y0);
  }
  return table[table.length - 1][1];
}

/**
 * Rasgos de la muestra: la malla canónica con mandíbula y nariz algo más
 * angostas y labios más llenos (esta versión se centra en rostros femeninos).
 */
function feminize(p: Vec3): Vec3 {
  let { x, y, z } = p;
  // Tercio inferior más angosto hacia el mentón.
  x *= 1 - 0.07 * smooth(2, 8, -y);
  // Nariz más angosta.
  const nose = (1 - smooth(1.2, 2.6, Math.abs(x))) * (1 - smooth(2.6, 3.8, Math.abs(y - 0.5)));
  x *= 1 - 0.1 * nose;
  // Labios más llenos: se abren en vertical alrededor de la línea de la boca.
  const yc = -3.75;
  const lips = (1 - smooth(2.2, 3.0, Math.abs(x))) * (1 - smooth(0.9, 1.5, Math.abs(y - yc)));
  y = yc + (y - yc) * (1 + 0.12 * lips);
  z += 0.15 * lips;
  return v3(x, y, z);
}

/** Cara + cráneo en una sola malla (comparten los puntos del óvalo). */
function headMesh(): Mesh {
  const pos: Vec3[] = [];
  for (let i = 0; i < 468; i++) pos.push(feminize(canon(i)));
  const uv: Vec3[] = [];
  for (let i = 0; i < 468; i++) uv.push(canon(i));
  const tris = Array.from(CANONICAL_TRIANGLES);
  const part: number[] = new Array(tris.length / 3).fill(PART_ID.face);
  // Hacia atrás desde el borde de la cara hasta el polo de la nuca. Cada tramo
  // del óvalo se subdivide: arriba, recorridos vecinos en la frente se abren
  // mucho sobre la coronilla y, sin subdividir, la cabeza queda en punta.
  const STEPS = 28;
  const SUB = 6;
  const back = norm3(v3(0, -0.2, -1));
  const ring = FACE_OVAL as readonly number[];
  const hair: number[] = new Array(468).fill(0);
  const idx: number[][] = [];
  const between: { i: number; a: number; b: number; f: number }[] = [];
  for (let k = 0; k < ring.length; k++) {
    const o = ring[k];
    const next = ring[(k + 1) % ring.length];
    for (let sub = 0; sub < SUB; sub++) {
      const f = sub / SUB;
      let start = o;
      if (sub > 0) {
        start = pos.length;
        pos.push(v3(pos[o].x + (pos[next].x - pos[o].x) * f, pos[o].y + (pos[next].y - pos[o].y) * f, pos[o].z + (pos[next].z - pos[o].z) * f));
        hair.push(0);
        between.push({ i: start, a: o, b: next, f });
      }
      const d0 = sub3(pos[start], HEAD_CENTER);
      const r0 = len3(d0);
      const u0 = norm3(d0);
      const t0 = hairStart(pos[start].y);
      const col = [start];
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const u = norm3(slerp(u0, back, t));
        const r = r0 + (ellRadius(u, SKULL) - r0) * smooth(0, 0.4, t);
        const p = v3(HEAD_CENTER.x + u.x * r, HEAD_CENTER.y + u.y * r, HEAD_CENTER.z + u.z * r);
        col.push(pos.length);
        pos.push(p);
        // Valor continuo: el corte en 0.5 queda suave entre vértices.
        hair.push(smooth(t0 - 0.05, t0 + 0.05, t) * smooth(-4.8, -3.6, p.y));
      }
      idx.push(col);
    }
  }
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k];
    const b = idx[(k + 1) % idx.length];
    for (let s = 0; s < STEPS; s++) {
      tris.push(a[s], b[s], b[s + 1], a[s], b[s + 1], a[s + 1]);
      part.push(PART_ID.skull, PART_ID.skull);
    }
  }
  const mesh = finish(pos, tris, Uint8Array.from(part), HEAD_CENTER);
  // Los puntos agregados sobre el borde no tocan triángulos de la cara: su
  // normal se interpola entre las de los extremos del tramo, o el sombreado
  // de la costura sale en zigzag.
  for (const { i, a, b, f } of between) {
    const na = mesh.nrm[a];
    const nb = mesh.nrm[b];
    mesh.nrm[i] = norm3(v3(na.x + (nb.x - na.x) * f, na.y + (nb.y - na.y) * f, na.z + (nb.z - na.z) * f));
  }
  return { ...mesh, hair: Float32Array.from(hair), uv };
}

/** Elipsoide (UV) con giro opcional. */
function ellipsoid(c: Vec3, e: Vec3, p: Part, rot?: Mat3, nu = 40, nv = 24): Mesh {
  const pos: Vec3[] = [];
  const nrm: Vec3[] = [];
  for (let j = 0; j <= nv; j++) {
    const th = (Math.PI * j) / nv;
    for (let i = 0; i <= nu; i++) {
      const ph = (2 * Math.PI * i) / nu;
      const u = v3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      let q = v3(u.x * e.x, u.y * e.y, u.z * e.z);
      let n = norm3(v3(u.x / e.x, u.y / e.y, u.z / e.z));
      if (rot) {
        q = apply3(rot, q);
        n = apply3(rot, n);
      }
      pos.push(v3(c.x + q.x, c.y + q.y, c.z + q.z));
      nrm.push(n);
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      tris.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { pos, nrm, tris, part: new Uint8Array(tris.length / 3).fill(PART_ID[p]) };
}

/** Cilindro elíptico abierto entre dos alturas (cuello). */
function neck(): Mesh {
  const pos: Vec3[] = [];
  const nrm: Vec3[] = [];
  const nu = 40;
  const rows: [number, number, number, number][] = [
    // y, z del eje, radio x, radio z
    [-2, -4.6, 4.5, 4.7],
    [-9, -5.0, 4.6, 4.9],
    [-14, -5.6, 5.0, 5.2],
    [-16.5, -6.0, 7.4, 6.0],
  ];
  for (const [y, zc, rx, rz] of rows) {
    for (let i = 0; i <= nu; i++) {
      const ph = (2 * Math.PI * i) / nu;
      pos.push(v3(rx * Math.cos(ph), y, zc + rz * Math.sin(ph)));
      nrm.push(norm3(v3(Math.cos(ph) / rx, 0, Math.sin(ph) / rz)));
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      tris.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { pos, nrm, tris, part: new Uint8Array(tris.length / 3).fill(PART_ID.neck) };
}

/** Normales por vértice (promedio por área) y triángulos orientados hacia afuera de `center`. */
function finish(pos: Vec3[], tris: number[], part: Uint8Array, center: Vec3): Mesh {
  const acc = pos.map(() => v3(0, 0, 0));
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [pos[tris[t]], pos[tris[t + 1]], pos[tris[t + 2]]];
    let n = cross3(sub3(b, a), sub3(c, a));
    const m = v3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
    if (dot3(n, sub3(m, center)) < 0) {
      n = v3(-n.x, -n.y, -n.z);
      [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
    }
    for (const k of [tris[t], tris[t + 1], tris[t + 2]]) acc[k] = v3(acc[k].x + n.x, acc[k].y + n.y, acc[k].z + n.z);
  }
  return { pos, nrm: acc.map((n) => (len3(n) > 0 ? norm3(n) : v3(0, 0, 1))), tris, part };
}

function rotX(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  return [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
}

function rotY(deg: number): Mat3 {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
}

function mulM(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

function sceneMeshes(): Mesh[] {
  const ears = ([1, -1] as const).map((sx) =>
    // Oreja: plana, algo inclinada hacia atrás y separada de la cabeza.
    ellipsoid(v3(sx * 7.9, 1.2, -4.5), v3(0.75, 3.1, 1.75), 'ear', mulM(rotY(sx * 18), rotX(-14)), 24, 16),
  );
  // Cabello largo: un volumen detrás de la cara que cae hasta los hombros.
  const hairMass = ellipsoid(v3(0, -3.2, -6.3), v3(8.9, 12.6, 7.9), 'hairMass', undefined, 56, 36);
  return [headMesh(), ...ears, hairMass, neck(), ellipsoid(v3(0, -23.2, -6.2), v3(19, 7.5, 10), 'torso')];
}

// ---------------------------------------------------------------------------
// Albedo.

type RGB = [number, number, number];
const SKIN: RGB = [0.86, 0.71, 0.6];
const HAIR: RGB = [0.2, 0.135, 0.095];
const CLOTH: RGB = [0.28, 0.4, 0.42];
const css = (c: RGB) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;

/** Textura de la cara en coordenadas canónicas (x, y). */
const TEX = { x0: -8.5, y0: -10.5, w: 17, h: 20, ppcm: 48 };

function faceTexture(): ImageData {
  const W = Math.round(TEX.w * TEX.ppcm);
  const H = Math.round(TEX.h * TEX.ppcm);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const at = (i: number): [number, number] => {
    const p = canon(i);
    return [(p.x - TEX.x0) * TEX.ppcm, (TEX.y0 + TEX.h - p.y) * TEX.ppcm];
  };
  const path = (ids: readonly number[]) => {
    g.beginPath();
    ids.forEach((i, k) => (k ? g.lineTo(...at(i)) : g.moveTo(...at(i))));
    g.closePath();
  };
  g.fillStyle = css(SKIN);
  g.fillRect(0, 0, W, H);
  // Mejillas y nariz un poco más rosadas.
  for (const i of [205, 425, 4]) {
    const [x, y] = at(i);
    const r = (i === 4 ? 1.4 : 2.4) * TEX.ppcm;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(205,110,100,0.22)');
    grd.addColorStop(1, 'rgba(205,110,100,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // Labios.
  path([61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]);
  g.fillStyle = 'rgb(186,96,102)';
  g.fill();
  g.beginPath();
  [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308].forEach((i, k) => (k ? g.lineTo(...at(i)) : g.moveTo(...at(i))));
  g.strokeStyle = 'rgb(92,46,44)';
  g.lineWidth = 0.09 * TEX.ppcm;
  g.stroke();
  // Cejas finas: el borde de arriba se acerca al de abajo.
  for (const [lower, upper] of [
    [
      [46, 53, 52, 65, 55],
      [70, 63, 105, 66, 107],
    ],
    [
      [276, 283, 282, 295, 285],
      [300, 293, 334, 296, 336],
    ],
  ]) {
    const lo = lower.map(at);
    const up = upper.map((i, k) => {
      const [ux, uy] = at(i);
      const [lx, ly] = lo[k];
      const f = k === 0 ? 0.35 : 0.6; // la cola, más delgada
      return [lx + (ux - lx) * f, ly + (uy - ly) * f] as [number, number];
    });
    g.beginPath();
    [...lo, ...up.reverse()].forEach((q, k) => (k ? g.lineTo(...q) : g.moveTo(...q)));
    g.closePath();
    g.fillStyle = 'rgba(70,48,34,0.85)';
    g.fill();
  }
  // Ojos: esclerótica, iris, pupila y línea de pestañas.
  for (const c of [RIGHT_EYE_CONTOUR, LEFT_EYE_CONTOUR]) {
    const lower = c.slice(0, 9);
    const upper = c.slice(9);
    const ids = [...lower, ...[...upper].reverse()];
    path(ids);
    g.fillStyle = 'rgb(232,226,218)';
    g.fill();
    g.save();
    path(ids);
    g.clip();
    const pts = ids.map((i) => canon(i));
    const cx = (pts[0].x + pts[8].x) / 2;
    const cy = (canon(c[4]).y + canon(c[12]).y) / 2 + 0.05;
    const [x, y] = [(cx - TEX.x0) * TEX.ppcm, (TEX.y0 + TEX.h - cy) * TEX.ppcm];
    g.beginPath();
    g.arc(x, y, 0.56 * TEX.ppcm, 0, Math.PI * 2);
    g.fillStyle = 'rgb(88,62,40)';
    g.fill();
    g.lineWidth = 0.07 * TEX.ppcm;
    g.strokeStyle = 'rgb(50,34,24)';
    g.stroke();
    g.beginPath();
    g.arc(x, y, 0.22 * TEX.ppcm, 0, Math.PI * 2);
    g.fillStyle = 'rgb(16,12,10)';
    g.fill();
    g.restore();
    g.beginPath();
    upper.forEach((i, k) => (k ? g.lineTo(...at(i)) : g.moveTo(...at(i))));
    g.lineTo(...at(c[8]));
    g.strokeStyle = 'rgb(34,24,20)';
    g.lineWidth = 0.17 * TEX.ppcm;
    g.stroke();
  }
  return g.getImageData(0, 0, W, H);
}


/**
 * Dónde cae en la imagen cada vértice de la cara de la muestra (verdad conocida
 * para probar el modo manual; los iris no son parte de la malla).
 */
export function sampleFacePoints(frame: SampleRender['frame']): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 468; i++) out.push(projectCanonical(frame, feminize(canon(i))));
  return out;
}

// ---------------------------------------------------------------------------
// Render.

export interface SampleOptions {
  pose?: PoseAngles;
  light?: Vec3;
  width?: number;
  height?: number;
}

export function renderSample(opts: SampleOptions = {}): SampleRender {
  const pose = opts.pose ?? SAMPLE_POSE;
  const light = norm3(opts.light ?? SAMPLE_LIGHT);
  const W = opts.width ?? 960;
  const H = opts.height ?? 1200;
  const SS = 2;
  const w = W * SS;
  const h = H * SS;
  const R = rotationFromAngles(pose);
  const scale = (H * 0.53) / 23; // cabeza (con cabello) ≈ 53 % del alto
  const frame = { rotation: R, scale, translation: v3(W * 0.5, -H * 0.43, 0) };
  const ssFrame = { rotation: R, scale: scale * SS, translation: v3(frame.translation.x * SS, frame.translation.y * SS, 0) };
  // Centra la cabeza en x: el centro de la esfera del cráneo va al centro.
  const hc = projectCanonical(ssFrame, HEAD_CENTER);
  ssFrame.translation = v3(ssFrame.translation.x + (w / 2 - hc.x), ssFrame.translation.y, 0);
  frame.translation = v3(ssFrame.translation.x / SS, ssFrame.translation.y / SS, 0);

  const meshes = sceneMeshes();
  const tex = faceTexture();
  const texW = tex.width;
  const texH = tex.height;

  // Marco de la luz (en el de cámara): u, v perpendiculares a la luz.
  const up = Math.abs(light.y) < 0.95 ? v3(0, 1, 0) : v3(1, 0, 0);
  const lu = norm3(cross3(up, light));
  const lv = cross3(light, lu);
  const SM = 2048;
  const SM_HALF = 24; // cm
  const smDepth = new Float32Array(SM * SM).fill(-Infinity);
  const toLight = (k: Vec3) => [((dot3(k, lu) + SM_HALF) / (2 * SM_HALF)) * SM, ((SM_HALF - dot3(k, lv)) / (2 * SM_HALF)) * SM, dot3(k, light)];

  // Vértices en cámara (cm), imagen (px) y luz.
  const prepared = meshes.map((m) => {
    const cam = m.pos.map((p) => apply3(R, p));
    const img = m.pos.map((p) => projectCanonical(ssFrame, p));
    const lit = cam.map(toLight);
    const nCam = m.nrm.map((n) => apply3(R, n));
    return { m, cam, img, lit, nCam };
  });

  // 1 · Mapa de sombras: profundidad hacia la luz (mayor = más cerca de la luz).
  for (const { m, lit } of prepared) {
    for (let t = 0; t < m.tris.length; t += 3) {
      if (m.part[t / 3] === PART_ID.hairMass && (m.pos[m.tris[t]].z + m.pos[m.tris[t + 1]].z + m.pos[m.tris[t + 2]].z) / 3 > HAIR_FRONT_Z) continue;
      const [a, b, c] = [lit[m.tris[t]], lit[m.tris[t + 1]], lit[m.tris[t + 2]]];
      raster(a[0], a[1], b[0], b[1], c[0], c[1], SM, SM, (x, y, wa, wb, wc) => {
        const d = wa * a[2] + wb * b[2] + wc * c[2];
        const k = y * SM + x;
        if (d > smDepth[k]) smDepth[k] = d;
      });
    }
  }
  // Sombra con desplazamiento a lo largo de la normal y sesgo según la
  // pendiente (evita el «acné» de rayas en las zonas rasantes) y filtro 4×4.
  const shadowAt = (k: Vec3, n: Vec3, ndl: number): number => {
    const off = 0.12 + 0.25 * (1 - ndl);
    const [sx, sy, d] = toLight(v3(k.x + n.x * off, k.y + n.y * off, k.z + n.z * off));
    const bias = 0.06 + 0.12 * Math.min(4, Math.sqrt(Math.max(0, 1 - ndl * ndl)) / Math.max(ndl, 0.05));
    let lit = 0;
    for (let oy = -1.5; oy <= 1.5; oy++) {
      for (let ox = -1.5; ox <= 1.5; ox++) {
        const x = Math.round(sx + ox * 1.2);
        const y = Math.round(sy + oy * 1.2);
        if (x < 0 || y < 0 || x >= SM || y >= SM || d >= smDepth[y * SM + x] - bias) lit++;
      }
    }
    return lit / 16;
  };

  // 2 · Fondo y z-buffer.
  const out = new ImageData(w, h);
  const px = out.data;
  for (let y = 0; y < h; y++) {
    const t = y / h;
    for (let x = 0; x < w; x++) {
      const dx = (x / w - 0.5) * 1.2;
      const vig = 1 - 0.12 * (dx * dx + (t - 0.45) ** 2);
      const k = (y * w + x) * 4;
      px[k] = (222 - 18 * t) * vig;
      px[k + 1] = (218 - 18 * t) * vig;
      px[k + 2] = (210 - 16 * t) * vig;
      px[k + 3] = 255;
    }
  }
  const zbuf = new Float32Array(w * h).fill(-Infinity);

  const toLin = (c: number) => c ** 2.2;
  const toSrgb = (c: number) => 255 * Math.min(1, Math.max(0, c)) ** (1 / 2.2);
  const fill = norm3(v3(-0.7, 0.1, 0.7));
  const half = norm3(v3(light.x, light.y, light.z + 1));

  for (const { m, cam, img, nCam } of prepared) {
    for (let t = 0; t < m.tris.length; t += 3) {
      const ia = m.tris[t];
      const ib = m.tris[t + 1];
      const ic = m.tris[t + 2];
      const [A, B, C] = [img[ia], img[ib], img[ic]];
      const part = m.part[t / 3];
      const hv = m.hair;
      raster(A.x, A.y, B.x, B.y, C.x, C.y, w, h, (x, y, wa, wb, wc) => {
        // Profundidad hacia la cámara (+z de cámara = más cerca).
        const z = wa * cam[ia].z + wb * cam[ib].z + wc * cam[ic].z;
        const k = y * w + x;
        if (z <= zbuf[k]) return;
        const P = m.pos;
        const cz = wa * P[ia].z + wb * P[ib].z + wc * P[ic].z;
        if (part === PART_ID.hairMass && cz > HAIR_FRONT_Z) return;
        zbuf[k] = z;
        const kc = v3(wa * cam[ia].x + wb * cam[ib].x + wc * cam[ic].x, wa * cam[ia].y + wb * cam[ib].y + wc * cam[ic].y, z);
        let n = v3(wa * nCam[ia].x + wb * nCam[ib].x + wc * nCam[ic].x, wa * nCam[ia].y + wb * nCam[ib].y + wc * nCam[ic].y, wa * nCam[ia].z + wb * nCam[ib].z + wc * nCam[ic].z);
        n = norm3(n);
        if (n.z < 0) n = v3(n.x, n.y, 0.02); // silueta: evita el negro puro en el borde
        const cx = wa * P[ia].x + wb * P[ib].x + wc * P[ic].x;
        const cy = wa * P[ia].y + wb * P[ib].y + wc * P[ic].y;
        let alb: RGB;
        let spec = 0.05;
        let shin = 28;
        if (part === PART_ID.face) {
          const U = m.uv ?? P;
          const ux = wa * U[ia].x + wb * U[ib].x + wc * U[ic].x;
          const uy = wa * U[ia].y + wb * U[ib].y + wc * U[ic].y;
          const tx = Math.min(texW - 1, Math.max(0, Math.round((ux - TEX.x0) * TEX.ppcm)));
          const ty = Math.min(texH - 1, Math.max(0, Math.round((TEX.y0 + TEX.h - uy) * TEX.ppcm)));
          const q = (ty * texW + tx) * 4;
          alb = [tex.data[q] / 255, tex.data[q + 1] / 255, tex.data[q + 2] / 255];
        } else if (part === PART_ID.skull) {
          if (hv && wa * hv[ia] + wb * hv[ib] + wc * hv[ic] > 0.5) {
            // Mechones: variación suave a lo largo del cabello.
            const s = 0.9 + 0.1 * Math.sin(cx * 3.1 + cz * 1.7) * Math.sin(cy * 2.3);
            alb = [HAIR[0] * s, HAIR[1] * s, HAIR[2] * s];
            spec = 0.09;
            shin = 14;
          } else alb = SKIN;
        } else if (part === PART_ID.hairMass) {
          // Mechones verticales.
          const s = 0.86 + 0.14 * Math.sin(Math.atan2(cx, cz + 6.3) * 36 + cy * 0.25);
          alb = [HAIR[0] * s, HAIR[1] * s, HAIR[2] * s];
          spec = 0.08;
          shin = 12;
        } else if (part === PART_ID.torso) {
          alb = CLOTH;
          spec = 0.01;
        } else if (part === PART_ID.neck) alb = [SKIN[0] * 0.97, SKIN[1] * 0.96, SKIN[2] * 0.96];
        else alb = SKIN;
        const ndl = dot3(n, light);
        const sh = ndl > 0 ? shadowAt(kc, n, ndl) : 0;
        const key = Math.max(0, (ndl + 0.08) / 1.08) * sh;
        const fil = 0.16 * Math.max(0, dot3(n, fill));
        const amb = 0.13 + 0.07 * n.y;
        const sp = sh * spec * Math.max(0, dot3(n, half)) ** shin;
        const q = k * 4;
        px[q] = toSrgb(toLin(alb[0]) * (key + fil + amb) + sp);
        px[q + 1] = toSrgb(toLin(alb[1]) * (key + fil + amb) + sp);
        px[q + 2] = toSrgb(toLin(alb[2]) * (key + fil + amb) + sp);
      });
    }
  }

  const big = document.createElement('canvas');
  big.width = w;
  big.height = h;
  big.getContext('2d')!.putImageData(out, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(big, 0, 0, W, H);
  return { canvas, pose, light, frame };
}

/** Rasteriza un triángulo; `plot` recibe el píxel y sus coordenadas baricéntricas. */
function raster(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  plot: (x: number, y: number, wa: number, wb: number, wc: number) => void,
): void {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
  const inv = 1 / area;
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const pxx = x + 0.5;
      const wa = ((bx - pxx) * (cy - py) - (by - py) * (cx - pxx)) * inv;
      const wb = ((cx - pxx) * (ay - py) - (cy - py) * (ax - pxx)) * inv;
      const wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      plot(x, y, wa, wb, wc);
    }
  }
}
