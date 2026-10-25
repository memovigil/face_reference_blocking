// Paso B · Esfera de Loomis en 3D, construida sobre la geometría real.
// Todo vive en el marco canónico (cm, y arriba, z hacia la cámara) y se
// proyecta con la misma pose que el resto de la app.

import { CANONICAL_TRIANGLES } from '../data/canonicalFace';
import { EAR_LOBE, EAR_TOP, HAIRLINE_DEPTH } from '../detect/keypoints';
import { LM, MIDLINE } from '../detect/landmarkMap';
import { rayToFrontal, type FrontalFace } from './frontal';
import { projectCanonical, type SimilarityFit } from './pose';
import { apply3, v2, v3, type Vec2, type Vec3 } from './vec';

export type StrokeStyle = 'solid' | 'hidden' | 'canon' | 'open';

export interface Stroke {
  pts: Vec2[];
  style: StrokeStyle;
  /** Qué representa (para la leyenda y las pruebas). */
  kind: 'sphere' | 'side' | 'ring' | 'center' | 'canon' | 'jaw' | 'jawOpen' | 'ear' | 'facing';
  label?: string;
}

export interface LoomisInputs {
  frame: SimilarityFit;
  /** Landmarks en px (la malla visible). */
  landmarks: readonly Vec3[];
  /** Marco de frente (con la mandíbula cerrada si la boca está abierta). */
  face: FrontalFace;
  /** Marco de frente tal como se ve (boca abierta incluida), para las isolíneas. */
  faceAsSeen: FrontalFace;
  /** Puntos de silueta del cráneo (px): cima, ancho y nuca, si están visibles. `weight` < 1 para la nuca. */
  silhouette: { p: Vec2; weight: number }[];
  hairline: Vec2 | null;
  ears: { side: 'R' | 'L'; top: Vec2; lobe: Vec2 }[];
  /** Mandíbula cerrada en px (si la boca está abierta). */
  closedLandmarks?: readonly Vec3[];
  yaw: number;
}

export interface LoomisSphere {
  center: Vec3;
  radius: number;
  /** Error RMS del ajuste en cm. */
  rms: number;
}

export interface LoomisLevels {
  hairline: number;
  brow: number;
  nose: number;
  mouth: number;
  chin: number;
}

export interface Loomis {
  sphere: LoomisSphere;
  levels: LoomisLevels;
  /** Niveles del canon: tercios iguales entre nacimiento del cabello y mentón. */
  canonLevels: { brow: number; nose: number };
  strokes: Stroke[];
  /** Centro y radio de la esfera en la imagen. */
  center2D: Vec2;
  radius2D: number;
  /** Ancho y cima de la cabeza en el marco de frente (para las métricas). */
  headTop: number;
  headWidth: number;
}

/** Umbral (cm) de la pérdida robusta en el ajuste de la esfera. */
const HUBER = 0.8;

/** Corte del plano lateral de Loomis, como fracción del radio. */
export const SIDE_CUT = 0.7;

const sphereVisible = (frame: SimilarityFit, n: Vec3) => apply3(frame.rotation, n).z > 0;

/**
 * Ajusta la esfera del cráneo (§6 B): centro en la línea media (x = 0) y radio
 * tales que (a) el contorno proyectado (círculo de radio s·r) pase por la cima
 * con cabello, y (b) la superficie pase por la frente alta y las sienes (la
 * distancia sien‑sien fija el radio). Un término débil la acerca a la esfera de
 * Loomis (centro a la altura de la ceja, radio ≈ 1.4 tercios) para que no se
 * dispare con pocos puntos.
 */
export function fitSphere(inp: LoomisInputs, levels: LoomisLevels): LoomisSphere {
  const { frame, face } = inp;
  const p = face.points;
  const third = levels.brow - levels.nose;
  const near = Math.abs(inp.yaw) < 15 ? ['R', 'L'] : inp.yaw < 0 ? ['L'] : ['R'];
  const surface: Vec3[] = [p[LM.foreheadTop]];
  if (near.includes('R')) surface.push(p[54], p[103]);
  if (near.includes('L')) surface.push(p[284], p[332]);
  const cost = (cy: number, cz: number, r: number) => {
    const c = v3(0, cy, cz);
    const c2 = projectCanonical(frame, c);
    let e = 0;
    for (const { p: q, weight } of inp.silhouette) {
      const d = Math.abs(Math.hypot(q.x - c2.x, q.y - c2.y) / frame.scale - r);
      // Huber: un chongo o una coleta no deben arrastrar la esfera.
      e += 2 * weight * (d < HUBER ? d * d : 2 * HUBER * d - HUBER * HUBER);
    }
    for (const s of surface) {
      const d = Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) - r;
      e += d * d;
    }
    e += 0.05 * ((cy - levels.brow) ** 2 + (r - 1.4 * third) ** 2);
    return e;
  };
  let best = { cy: levels.brow, cz: -3, r: 1.4 * third, e: Infinity };
  // Búsqueda gruesa y luego fina.
  for (const [step, span] of [[0.5, 6], [0.1, 0.6], [0.02, 0.12]] as const) {
    const c0 = { ...best };
    for (let cy = c0.cy - span; cy <= c0.cy + span; cy += step) {
      for (let cz = c0.cz - span; cz <= c0.cz + span; cz += step) {
        for (let r = Math.max(4, c0.r - span); r <= c0.r + span; r += step) {
          const e = cost(cy, cz, r);
          if (e < best.e) best = { cy, cz, r, e };
        }
      }
    }
  }
  const n = inp.silhouette.reduce((a, s) => a + 2 * s.weight, 0) + surface.length;
  return { center: v3(0, best.cy, best.cz), radius: best.r, rms: Math.sqrt(best.e / Math.max(1, n)) };
}

/** Niveles reales en el marco de frente. */
export function measureLevels(face: FrontalFace, hairlineY: number): LoomisLevels {
  const p = face.points;
  return {
    hairline: hairlineY,
    brow: (p[105].y + p[52].y + p[334].y + p[282].y) / 4,
    nose: p[LM.subnasale].y,
    mouth: (p[LM.upperLipInner].y + p[LM.lowerLipInner].y) / 2,
    chin: p[LM.menton].y,
  };
}

// ---------------------------------------------------------------------------
// Isolíneas: dónde la superficie real cruza una altura dada del marco de frente.

/**
 * Curva de nivel y = level sobre la malla: por cada triángulo que cruza el
 * nivel, el segmento entre los dos cruces (interpolando posiciones de la foto).
 * Devuelve polilíneas encadenadas.
 */
export function isoLine(landmarks: readonly Vec3[], frontalY: (i: number) => number, level: number): Vec2[][] {
  const segs: [string, string, Vec2, Vec2][] = [];
  const cut = (a: number, b: number): [string, Vec2] | null => {
    const ya = frontalY(a) - level;
    const yb = frontalY(b) - level;
    if ((ya > 0) === (yb > 0)) return null;
    const t = ya / (ya - yb);
    const pa = landmarks[a];
    const pb = landmarks[b];
    return [a < b ? `${a}-${b}` : `${b}-${a}`, v2(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t)];
  };
  for (let t = 0; t < CANONICAL_TRIANGLES.length; t += 3) {
    const [i, j, k] = [CANONICAL_TRIANGLES[t], CANONICAL_TRIANGLES[t + 1], CANONICAL_TRIANGLES[t + 2]];
    const hits = [cut(i, j), cut(j, k), cut(k, i)].filter((h): h is [string, Vec2] => !!h);
    if (hits.length === 2) segs.push([hits[0][0], hits[1][0], hits[0][1], hits[1][1]]);
  }
  // Encadenar por las aristas compartidas.
  const byKey = new Map<string, number[]>();
  segs.forEach((s, idx) => {
    for (const k of [s[0], s[1]]) byKey.set(k, [...(byKey.get(k) ?? []), idx]);
  });
  const used = new Set<number>();
  const lines: Vec2[][] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used.has(s0)) continue;
    used.add(s0);
    const line: Vec2[] = [segs[s0][2], segs[s0][3]];
    const grow = (key: string, atEnd: boolean) => {
      let k = key;
      for (;;) {
        const nextIdx = (byKey.get(k) ?? []).find((x) => !used.has(x));
        if (nextIdx === undefined) break;
        used.add(nextIdx);
        const s = segs[nextIdx];
        const [nk, np] = s[0] === k ? [s[1], s[3]] : [s[0], s[2]];
        if (atEnd) line.push(np);
        else line.unshift(np);
        k = nk;
      }
    };
    grow(segs[s0][1], true);
    grow(segs[s0][0], false);
    lines.push(line);
  }
  return lines.filter((l) => l.length >= 3);
}

// ---------------------------------------------------------------------------
// Construcción completa.

/** Divide una curva 3D en trazos visibles (sólidos) y ocultos (punteados). */
function strokesByVisibility(frame: SimilarityFit, pts3: Vec3[], normals: Vec3[], kind: Stroke['kind'], label?: string): Stroke[] {
  const out: Stroke[] = [];
  let cur: Vec2[] = [];
  let curVis: boolean | null = null;
  pts3.forEach((p, i) => {
    const vis = sphereVisible(frame, normals[i]);
    const q = projectCanonical(frame, p);
    const pt = v2(q.x, q.y);
    if (curVis === null || vis === curVis) cur.push(pt);
    else {
      cur.push(pt);
      out.push({ pts: cur, style: curVis ? 'solid' : 'hidden', kind, label });
      cur = [pt];
    }
    curVis = vis;
  });
  if (cur.length > 1 && curVis !== null) out.push({ pts: cur, style: curVis ? 'solid' : 'hidden', kind, label });
  return out;
}

export function buildLoomis(inp: LoomisInputs): Loomis {
  const { frame, face, landmarks } = inp;
  const p = face.points;
  // Nacimiento del cabello en el marco de frente (o el canon si no hay).
  const browY = (p[105].y + p[52].y + p[334].y + p[282].y) / 4;
  const noseY = p[LM.subnasale].y;
  let hairY = browY + (browY - noseY);
  if (inp.hairline) {
    const h = rayToFrontal(frame, inp.hairline, HAIRLINE_DEPTH);
    if (h) hairY = h.y;
  }
  const levels = measureLevels(face, hairY);
  const sphere = fitSphere(inp, levels);
  const { center: c, radius: r } = sphere;
  const strokes: Stroke[] = [];
  const c2 = projectCanonical(frame, c);
  const center2D = v2(c2.x, c2.y);
  const radius2D = r * frame.scale;

  // Contorno de la esfera: siempre visible.
  const circle: Vec2[] = [];
  for (let k = 0; k <= 96; k++) {
    const a = (k / 96) * Math.PI * 2;
    circle.push(v2(center2D.x + Math.cos(a) * radius2D, center2D.y + Math.sin(a) * radius2D));
  }
  strokes.push({ pts: circle, style: 'solid', kind: 'sphere' });

  // Planos laterales: círculos a ±0.7 r.
  const sideR = r * Math.sqrt(1 - SIDE_CUT * SIDE_CUT);
  for (const sx of [-1, 1]) {
    const pts3: Vec3[] = [];
    const nrm: Vec3[] = [];
    for (let k = 0; k <= 72; k++) {
      const a = (k / 72) * Math.PI * 2;
      const q = v3(c.x + sx * SIDE_CUT * r, c.y + Math.sin(a) * sideR, c.z + Math.cos(a) * sideR);
      pts3.push(q);
      // El borde del plano está sobre la esfera; se ve si la cara lateral mira a la cámara.
      nrm.push(v3(sx, 0, 0));
    }
    strokes.push(...strokesByVisibility(frame, pts3, nrm, 'side'));
  }

  // Anillos: frente sobre la malla real; detrás, sobre la esfera.
  const asSeen = inp.faceAsSeen.points;
  const fy = (i: number) => asSeen[i].y;
  const ringLevels: [keyof LoomisLevels, number][] = [
    ['hairline', levels.hairline],
    ['brow', levels.brow],
    ['nose', levels.nose],
    ['mouth', levels.mouth],
  ];
  for (const [name, level] of ringLevels) {
    for (const line of isoLine(landmarks, fy, level)) strokes.push({ pts: line, style: 'solid', kind: 'ring', label: name });
    const dy = level - c.y;
    if (Math.abs(dy) < r * 0.98) {
      const rr = Math.sqrt(r * r - dy * dy);
      const pts3: Vec3[] = [];
      const nrm: Vec3[] = [];
      // Solo la parte de atrás de la cara (z < z del plano lateral), alrededor del cráneo.
      for (let k = 0; k <= 72; k++) {
        const a = Math.PI * 0.62 + (k / 72) * Math.PI * 0.76;
        const q = v3(c.x + Math.sin(a) * rr, level, c.z + Math.cos(a) * rr);
        pts3.push(q);
        nrm.push(v3((q.x - c.x) / r, (q.y - c.y) / r, (q.z - c.z) / r));
      }
      strokes.push(...strokesByVisibility(frame, pts3, nrm, 'ring', name));
    }
  }

  // Tercios del canon (rojo punteado): tres partes iguales entre cabello y mentón.
  const third = (levels.hairline - levels.chin) / 3;
  const canonLevels = { brow: levels.hairline - third, nose: levels.hairline - 2 * third };
  for (const [name, level] of [['brow', canonLevels.brow], ['nose', canonLevels.nose]] as const) {
    for (const line of isoLine(landmarks, fy, level)) strokes.push({ pts: line, style: 'canon', kind: 'canon', label: name });
  }

  // Línea central: línea media de la malla y, sobre la cabeza, el círculo x = 0 de la esfera.
  strokes.push({ pts: MIDLINE.map((i) => v2(landmarks[i].x, landmarks[i].y)), style: 'solid', kind: 'center' });
  {
    const top = p[LM.foreheadTop];
    const a0 = Math.atan2(top.y - c.y, top.z - c.z); // ángulo desde +z hacia +y
    const pts3: Vec3[] = [];
    const nrm: Vec3[] = [];
    for (let k = 0; k <= 60; k++) {
      const a = a0 + (k / 60) * (Math.PI * 1.25 - a0 + Math.PI * 0.1);
      const q = v3(0, c.y + Math.sin(a) * r, c.z + Math.cos(a) * r);
      pts3.push(q);
      nrm.push(v3(0, Math.sin(a), Math.cos(a)));
    }
    strokes.push(...strokesByVisibility(frame, pts3, nrm, 'center'));
  }

  // Mandíbula: lóbulo → ángulo → mentón (cerrada si la boca está abierta).
  const lmJaw = inp.closedLandmarks ?? landmarks;
  const sides: ('R' | 'L')[] = Math.abs(inp.yaw) < 30 ? ['R', 'L'] : inp.yaw < 0 ? ['L'] : ['R'];
  for (const s of sides) {
    const ear = inp.ears.find((e) => e.side === s);
    const angle = s === 'R' ? LM.subjectRight.jawAngle : LM.subjectLeft.jawAngle;
    const pts = [ear ? ear.lobe : null, v2(lmJaw[angle].x, lmJaw[angle].y), v2(lmJaw[LM.menton].x, lmJaw[LM.menton].y)].filter((q): q is Vec2 => !!q);
    strokes.push({ pts, style: 'solid', kind: 'jaw' });
    if (inp.closedLandmarks) {
      strokes.push({ pts: [v2(landmarks[angle].x, landmarks[angle].y), v2(landmarks[LM.menton].x, landmarks[LM.menton].y)], style: 'open', kind: 'jawOpen' });
    }
  }

  // Orejas: «C» sobre el plano lateral, entre la punta y el lóbulo.
  for (const e of inp.ears) {
    const sx = e.side === 'R' ? -1 : 1;
    const top3 = rayToFrontal(frame, e.top, EAR_TOP.z) ?? v3(sx * EAR_TOP.x, EAR_TOP.y, EAR_TOP.z);
    const lobe3 = rayToFrontal(frame, e.lobe, EAR_LOBE.z) ?? v3(sx * EAR_LOBE.x, EAR_LOBE.y, EAR_LOBE.z);
    const x = (top3.x + lobe3.x) / 2;
    const t = v3(x, top3.y, top3.z);
    const l = v3(x, lobe3.y, lobe3.z);
    const len = Math.hypot(t.y - l.y, t.z - l.z);
    const ax = v3(0, (t.y - l.y) / len, (t.z - l.z) / len); // de lóbulo a punta
    const back = v3(0, ax.z, -ax.y); // perpendicular, hacia atrás (−z)
    const mid = v3(x, (t.y + l.y) / 2, (t.z + l.z) / 2);
    const pts3: Vec3[] = [];
    for (let k = 0; k <= 24; k++) {
      // Media elipse hacia atrás (hélice), del punto alto al lóbulo.
      const a = Math.PI / 2 - (k / 24) * Math.PI;
      const u = Math.sin(a) * len * 0.5;
      const w = Math.cos(a) * len * 0.32;
      pts3.push(v3(x, mid.y + ax.y * u + back.y * w, mid.z + ax.z * u + back.z * w));
    }
    pts3.push(t);
    strokes.push(...strokesByVisibility(frame, pts3, pts3.map(() => v3(sx, 0, 0)), 'ear'));
  }

  // «Mira hacia»: del centro de la esfera hacia adelante.
  {
    const tip = projectCanonical(frame, v3(c.x, c.y, c.z + r * 1.5));
    strokes.push({ pts: [center2D, v2(tip.x, tip.y)], style: 'solid', kind: 'facing' });
  }

  return {
    sphere,
    levels,
    canonLevels,
    strokes,
    center2D,
    radius2D,
    headTop: c.y + r,
    headWidth: 2 * r,
  };
}
