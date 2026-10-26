// Paso D · Blocking de planos (§7.2): un poliedro con aristas compartidas,
// simplificación de la superficie real de ESTA cara.
//
// 1. Cada región (planes.ts) se ajusta a un plano por PCA con los puntos
//    detectados de esa cara (en px; la z de MediaPipe está en la escala de x).
// 2. Los vértices del poliedro son los puntos de la malla donde se tocan 3 o
//    más regiones (o 2 regiones y el borde de la malla). Se colocan sobre los
//    planos que se tocan: intersección de los planos cuando está bien
//    condicionada, y si no, el punto más cercano a la malla (closestToPlanes).
// 3. Entre dos vértices, la frontera de dos regiones es una cadena de puntos de
//    la malla; se simplifica con Douglas‑Peucker en 3D UNA vez y la usan las dos
//    regiones, así comparten aristas exactamente.
// 4. Visibilidad: un plano se ve si su normal mira a la cámara; las aristas se
//    recortan donde otro plano visible queda delante (nariz sobre la mejilla).
// 5. Aristas: contorno (un lado visible y el otro no, o el borde de la malla),
//    cambio de plano (> 20° entre normales) o suaves (no se dibujan, salvo
//    tenues en el nivel fino). Órbita y base de la nariz se acentúan.
//
// La topología (regiones, esquinas, cadenas) depende solo del nivel: se
// calcula una vez. Por cara solo se ajustan planos y se colocan vértices.

import type { Vec3 } from './vec';
import { v2, v3, type Vec2 } from './vec';
import { FACE_OVAL } from '../detect/landmarkMap';
import { canonicalPoint } from './canonical';
import { projectCanonical, type SimilarityFit } from './pose';
import { closestToPlanes, fitPlane, levelPartition, meshTopology, MOUTH_HOLE, triangleNormal, type BlockLevel, type LevelRegion, type Plane } from './planes';

/** Del otro lado de una arista: el borde de la malla o la abertura de la boca. */
const OUTSIDE = -1;
const MOUTH = MOUTH_HOLE;

/** Ángulo entre normales (°) a partir del cual una arista es un cambio de plano. */
export const HARD_EDGE_DEG = 20;
/** Tolerancia de Douglas‑Peucker, en distancias entre pupilas, por nivel. */
const DP_TOL: Record<BlockLevel, number> = { grande: 0.16, medio: 0.1, fino: 0.07 };
/** Regularización hacia la malla al colocar vértices, y desplazamiento máximo (en DP). */
const LAMBDA = 0.15;
const MAX_SHIFT = 0.12;
/** Desvío (en DP) a partir del cual una frontera entre dos planos se parte en dos tramos. */
const CURVED = 0.22;
/** Esquinas unidas por una frontera más corta que esto (cm, modelo canónico) se funden en un vértice. */
const MERGE_CM = 0.55;

interface Chain {
  /** Vértices de la malla, de una esquina a otra (incluidas). */
  verts: number[];
  /** Regiones a cada lado (OUTSIDE = borde de la malla). */
  left: number;
  right: number;
}

interface Topology {
  regions: LevelRegion[];
  /** Por región: cadenas de su contorno, en orden, con el sentido de recorrido. */
  loops: { chain: number; forward: boolean }[][];
  chains: Chain[];
  /** Regiones que toca cada vértice de la malla (con OUTSIDE si está en el borde). */
  labels: number[][];
  /** Vértices de cada región (únicos). */
  regionVerts: number[][];
  /** Esquina representante de cada punto de la malla (esquinas fundidas). */
  cluster: number[];
  /** Puntos de la malla de cada grupo de esquinas fundidas. */
  members: Map<number, number[]>;
}

const topoCache = new Map<BlockLevel, Topology>();

function topology(level: BlockLevel): Topology {
  const hit = topoCache.get(level);
  if (hit) return hit;
  const { tris } = meshTopology();
  const part = levelPartition(level);
  const R = part.regions.length;
  const labelsSet: Set<number>[] = Array.from({ length: 468 }, () => new Set<number>());
  const edgeCount = new Map<string, number>();
  const ekey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  tris.forEach((t, ti) => {
    for (const v of t) labelsSet[v].add(part.triRegion[ti]);
    for (const [a, b] of [
      [t[0], t[1]],
      [t[1], t[2]],
      [t[2], t[0]],
    ])
      edgeCount.set(ekey(a, b), (edgeCount.get(ekey(a, b)) ?? 0) + 1);
  });
  for (const [k, c] of edgeCount) {
    if (c !== 1) continue;
    const [a, b] = k.split('-').map(Number);
    labelsSet[a].add(OUTSIDE);
    labelsSet[b].add(OUTSIDE);
  }
  const labels = labelsSet.map((s) => [...s]);

  // Esquinas: 3 o más etiquetas (o 2 regiones y el borde).
  const isCorner = labels.map((l) => l.length >= 3);

  // Contorno de cada región: aristas dirigidas según el orden de la malla.
  const regionVerts: number[][] = [];
  const loopsVerts: number[][] = [];
  for (let r = 0; r < R; r++) {
    const own = new Set<string>();
    const vs = new Set<number>();
    for (const ti of part.regions[r].tris) {
      const t = tris[ti];
      for (const v of t) vs.add(v);
      own.add(`${t[0]}>${t[1]}`);
      own.add(`${t[1]}>${t[2]}`);
      own.add(`${t[2]}>${t[0]}`);
    }
    regionVerts.push([...vs]);
    const next = new Map<number, number[]>();
    for (const e of own) {
      const [a, b] = e.split('>').map(Number);
      if (own.has(`${b}>${a}`)) continue;
      next.set(a, [...(next.get(a) ?? []), b]);
    }
    // Encadena; con vértices no‑manifold toma la primera salida libre.
    const used = new Set<string>();
    let best: number[] = [];
    for (const [start, outs] of next) {
      for (const first of outs) {
        if (used.has(`${start}>${first}`)) continue;
        const loop = [start];
        let a = start;
        let b = first;
        while (!used.has(`${a}>${b}`)) {
          used.add(`${a}>${b}`);
          if (b === start) break;
          loop.push(b);
          const cand = (next.get(b) ?? []).filter((c) => !used.has(`${b}>${c}`));
          if (!cand.length) break;
          a = b;
          b = cand[0];
        }
        if (loop.length > best.length) best = loop;
      }
    }
    loopsVerts.push(best);
  }

  // Cadenas compartidas entre esquinas.
  const chains: Chain[] = [];
  const chainIndex = new Map<string, number>();
  const loops: Topology['loops'] = [];
  const mouthEdges = new Set<string>();
  tris.forEach((t, ti) => {
    if (part.triRegion[ti] !== MOUTH) return;
    for (const [a, b] of [
      [t[0], t[1]],
      [t[1], t[2]],
      [t[2], t[0]],
    ])
      mouthEdges.add(ekey(a, b));
  });
  const regionAcross = (r: number, a: number, b: number): number => {
    // La otra región de la arista a–b (o el borde, o la boca).
    const common = labels[a].filter((x) => x !== r && labels[b].includes(x));
    if (!common.length) return OUTSIDE;
    if (mouthEdges.has(ekey(a, b)) && !common.some((x) => x >= 0 && part.regions[x].tris.some((ti) => tris[ti].includes(a) && tris[ti].includes(b)))) return MOUTH;
    // Si hay varias, la que tiene un triángulo con esa arista.
    for (const x of common) {
      if (x < 0) continue;
      const has = part.regions[x].tris.some((ti) => {
        const t = tris[ti];
        return t.includes(a) && t.includes(b);
      });
      if (has) return x;
    }
    return OUTSIDE;
  };
  for (let r = 0; r < R; r++) {
    const loop = loopsVerts[r];
    const out: { chain: number; forward: boolean }[] = [];
    const n = loop.length;
    if (n < 3) {
      loops.push(out);
      continue;
    }
    // Región vecina de cada arista del lazo; se corta en las esquinas y donde
    // cambia la vecina.
    const across = loop.map((v, i) => regionAcross(r, v, loop[(i + 1) % n]));
    const isBreak = loop.map((v, i) => isCorner[v] || across[(i - 1 + n) % n] !== across[i]);
    let s0 = isBreak.indexOf(true);
    if (s0 < 0) s0 = 0;
    let cur: number[] = [loop[s0]];
    for (let k = 1; k <= n; k++) {
      const i = (s0 + k) % n;
      cur.push(loop[i]);
      if (!isBreak[i] && k < n) continue;
      const k1 = cur.join(',');
      const k2 = [...cur].reverse().join(',');
      let ci = chainIndex.get(k1);
      let forward = true;
      if (ci === undefined) {
        ci = chainIndex.get(k2);
        forward = false;
      }
      if (ci === undefined) {
        ci = chains.length;
        chains.push({ verts: [...cur], left: r, right: across[(i - 1 + n) % n] });
        chainIndex.set(k1, ci);
        forward = true;
      }
      out.push({ chain: ci, forward });
      cur = [loop[i]];
    }
    loops.push(out);
  }
  // Esquinas muy juntas (una unión de regiones repartida en una arista corta)
  // se funden, sin dejar ninguna región con menos de tres esquinas.
  const parent = labels.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = loops.map((loop) => loop.map(({ chain, forward }) => (forward ? chains[chain].verts[0] : chains[chain].verts[chains[chain].verts.length - 1])));
  const distinct = (vs: number[], map: (v: number) => number) => new Set(vs.map(map)).size;
  const lengthCm = (c: Chain) => {
    let L = 0;
    for (let i = 1; i < c.verts.length; i++) {
      const a = canonicalPoint(c.verts[i - 1]);
      const b = canonicalPoint(c.verts[i]);
      L += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }
    return L;
  };
  const short = chains.map((c, i) => ({ i, L: lengthCm(c) })).filter((x) => x.L < MERGE_CM).sort((a, b) => a.L - b.L);
  for (const { i } of short) {
    const c = chains[i];
    const a = find(c.verts[0]);
    const b = find(c.verts[c.verts.length - 1]);
    if (a === b) continue;
    const ok = ends.every((e) => {
      const before = distinct(e, find);
      if (!e.some((v) => find(v) === a) || !e.some((v) => find(v) === b)) return true;
      return before > 3 && distinct(e, (v) => (find(v) === b ? a : find(v))) >= 3;
    });
    if (ok) parent[b] = a;
  }
  const cluster = labels.map((_, i) => find(i));
  const members = new Map<number, number[]>();
  cluster.forEach((r, i) => {
    if (r !== i) members.set(r, [...(members.get(r) ?? [r]), i]);
  });
  const res = { regions: part.regions, loops, chains, labels, regionVerts, cluster, members };
  topoCache.set(level, res);
  return res;
}

// ---------------------------------------------------------------------------
// Douglas‑Peucker en 3D sobre una cadena abierta (conserva los extremos).

export function douglasPeucker3(pts: readonly Vec3[], tol: number): number[] {
  const n = pts.length;
  if (n <= 2) return [...Array(n).keys()];
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = pts[a];
    const pb = pts[b];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dz = pb.z - pa.z;
    const L2 = dx * dx + dy * dy + dz * dz;
    let idx = -1;
    let dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const q = pts[i];
      let d: number;
      if (L2 < 1e-12) d = Math.hypot(q.x - pa.x, q.y - pa.y, q.z - pa.z);
      else {
        const t = ((q.x - pa.x) * dx + (q.y - pa.y) * dy + (q.z - pa.z) * dz) / L2;
        d = Math.hypot(q.x - pa.x - t * dx, q.y - pa.y - t * dy, q.z - pa.z - t * dz);
      }
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (idx >= 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return keep.flatMap((k, i) => (k ? [i] : []));
}

// ---------------------------------------------------------------------------
// Poliedro de una cara.

export interface BlockVertex {
  /** Posición en px (x, y de la foto; z de MediaPipe). */
  p: Vec3;
  /** Posición medida en la malla, antes de llevarla a los planos. */
  raw: Vec3;
  /** Punto de la malla del que sale. */
  mesh: number;
  regions: number[];
}

export interface BlockFace {
  index: number;
  id: string;
  name: string;
  side: 'C' | 'R' | 'L';
  plane: Plane;
  /** Vértices del polígono (índices en `vertices`), en orden. */
  verts: number[];
  /** El plano mira a la cámara. */
  front: boolean;
  /** Vecinos con los que comparte al menos una arista. */
  neighbors: number[];
  /** Plano apoyado sobre otro (la oreja sobre el lateral del cráneo). */
  inset?: boolean;
}

export type EdgeKind = 'contour' | 'hard' | 'soft' | 'hidden';

export interface BlockEdge {
  a: number;
  b: number;
  faces: [number, number];
  kind: EdgeKind;
  /** Ángulo entre las normales de los dos planos (°); 0 en el borde. */
  angle: number;
  /** Arista de la órbita o de la base de la nariz: se dibuja más gruesa. */
  accent: boolean;
  /** Tramos visibles, como fracciones [t0, t1] de la arista (oclusión). */
  visible: [number, number][];
  /** Tipo fijo cuando el plano se ve (la oreja: se dibuja aunque no haya ángulo). */
  fixedKind?: EdgeKind;
}

export interface Blocking {
  level: BlockLevel;
  vertices: BlockVertex[];
  faces: BlockFace[];
  edges: BlockEdge[];
  ms: number;
}

const ACCENT = /^(eye|upperLid|lowerLid|orbitRoof|orbit|noseBase|noseTipBottom|noseAla)/;

export function buildBlocking(landmarks: readonly Vec3[], level: BlockLevel, ipd: number, skull?: SkullInput): Blocking {
  const t0 = performance.now();
  const topo = topology(level);
  const { tris, windingSign } = meshTopology();
  const P = (i: number) => landmarks[i];

  // 1 · Planos.
  const part = levelPartition(level);
  const planes: Plane[] = topo.regions.map((_, r) => {
    let out = v3(0, 0, 0);
    for (const ti of part.regions[r].tris) {
      const { n, area } = triangleNormal(P, tris[ti], windingSign);
      out = v3(out.x + n.x * area, out.y + n.y * area, out.z + n.z * area);
    }
    return fitPlane(topo.regionVerts[r].map(P), out);
  });

  // 2 · Vértices: esquinas y puntos que conserva Douglas‑Peucker en cada cadena.
  const tol = DP_TOL[level] * ipd;
  const vertexOf = new Map<number, number>();
  const vertices: BlockVertex[] = [];
  const place = (p0: Vec3, regs: number[]) => {
    const pls = regs.filter((r) => r >= 0).map((r) => planes[r]);
    let p = closestToPlanes(pls, p0, LAMBDA);
    const d = Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z);
    const cap = MAX_SHIFT * ipd;
    if (d > cap) p = v3(p0.x + ((p.x - p0.x) * cap) / d, p0.y + ((p.y - p0.y) * cap) / d, p0.z + ((p.z - p0.z) * cap) / d);
    return p;
  };
  const vertexFor = (m0: number, regs0: number[]) => {
    const m = topo.cluster[m0];
    let id = vertexOf.get(m);
    if (id === undefined) {
      const group = topo.members.get(m);
      let regs = regs0;
      let p0 = P(m);
      if (group) {
        regs = [...new Set(group.flatMap((g) => topo.labels[g]))];
        p0 = rawOf(m);
      }
      id = vertices.length;
      vertices.push({ p: place(p0, regs), raw: p0, mesh: m, regions: regs.filter((r) => r >= 0) });
      vertexOf.set(m, id);
    }
    return id;
  };
  // Entre dos planos la arista es una recta: solo se conservan sus extremos
  // (salvo fronteras muy curvas). El borde de la malla (contorno) se simplifica
  // con Douglas‑Peucker.
  // Los puntos donde se cose el cráneo se conservan siempre.
  const anchors = new Set<number>(Object.values(SKULL_ANCHORS));
  const keptIdx: number[][] = topo.chains.map((c) => {
    // Una frontera interna muy curva (la línea de la boca) conserva su punto
    // más alejado: una sola recta cortaría el polígono.
    if (c.right >= 0) return douglasPeucker3(c.verts.map(P), CURVED * ipd);
    const kept = douglasPeucker3(c.verts.map(P), tol);
    c.verts.forEach((m, k) => {
      if (anchors.has(m) && !kept.includes(k)) kept.push(k);
    });
    return kept.sort((x, y) => x - y);
  });
  // Una región con menos de tres vértices recibe el punto más alejado de su
  // frontera más larga (compartido con la vecina).
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    topo.loops.forEach((loop) => {
      const ids = new Set<number>();
      for (const { chain } of loop) for (const k of keptIdx[chain]) ids.add(topo.cluster[topo.chains[chain].verts[k]]);
      if (ids.size >= 3 || !loop.length) return;
      const longest = loop.map(({ chain }) => chain).sort((x, y) => topo.chains[y].verts.length - topo.chains[x].verts.length)[0];
      const c = topo.chains[longest];
      if (c.verts.length < 3) return;
      const forced = douglasPeucker3(c.verts.map(P), 0);
      // El más alejado de la recta entre extremos.
      const a0 = P(c.verts[0]);
      const b0 = P(c.verts[c.verts.length - 1]);
      let best = -1;
      let bd = -1;
      for (const k of forced) {
        if (k === 0 || k === c.verts.length - 1) continue;
        const q = P(c.verts[k]);
        const d = Math.hypot(q.x - (a0.x + b0.x) / 2, q.y - (a0.y + b0.y) / 2, q.z - (a0.z + b0.z) / 2);
        if (d > bd) {
          bd = d;
          best = k;
        }
      }
      if (best > 0 && !keptIdx[longest].includes(best)) {
        keptIdx[longest] = [...keptIdx[longest], best].sort((x, y) => x - y);
        changed = true;
      }
    });
    if (!changed) break;
  }
  const rawOf = (m0: number) => {
    const group = topo.members.get(topo.cluster[m0]);
    if (!group) return P(m0);
    return v3(group.reduce((a, g) => a + P(g).x, 0) / group.length, group.reduce((a, g) => a + P(g).y, 0) / group.length, group.reduce((a, g) => a + P(g).z, 0) / group.length);
  };
  // Un polígono que se cruza a sí mismo (labios gruesos en una boca curva,
  // vista muy de lado) recibe más puntos en sus fronteras hasta quedar simple.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    topo.loops.forEach((loop, r) => {
      const pts: Vec3[] = [];
      for (const { chain, forward } of loop) {
        const c = topo.chains[chain];
        const ks = forward ? keptIdx[chain] : [...keptIdx[chain]].reverse();
        for (let i = 0; i < ks.length - 1; i++) pts.push(rawOf(c.verts[ks[i]]));
      }
      if (pts.length < 4 || !selfIntersects(projectToPlane(pts, planes[r].n))) return;
      const t = (CURVED * ipd) / 2 ** (pass + 1);
      for (const { chain } of loop) {
        const c = topo.chains[chain];
        const more = douglasPeucker3(c.verts.map(P), t);
        const merged = [...new Set([...keptIdx[chain], ...more])].sort((x, y) => x - y);
        if (merged.length !== keptIdx[chain].length) {
          keptIdx[chain] = merged;
          changed = true;
        }
      }
    });
    if (!changed) break;
  }
  const chainKept: number[][] = topo.chains.map((c, ci) => {
    const kept = keptIdx[ci];
    return kept.map((k, i) => {
      const m = c.verts[k];
      const isEnd = i === 0 || i === kept.length - 1;
      return vertexFor(m, isEnd ? topo.labels[m] : [c.left, c.right]);
    });
  });

  // 3 · Polígonos.
  const loopVerts = (r: number) => {
    const verts: number[] = [];
    for (const { chain, forward } of topo.loops[r]) {
      const ids = forward ? chainKept[chain] : [...chainKept[chain]].reverse();
      for (let i = 0; i < ids.length - 1; i++) if (verts[verts.length - 1] !== ids[i]) verts.push(ids[i]);
    }
    if (verts.length > 1 && verts[0] === verts[verts.length - 1]) verts.pop();
    return verts;
  };
  const faces: BlockFace[] = topo.regions.map((reg, r) => {
    // Visibilidad: z de la foto aumenta alejándose de la cámara.
    const front = planes[r].n.z < -0.02;
    const neighbors = [...new Set(topo.loops[r].map(({ chain }) => topo.chains[chain]).map((c) => (c.left === r ? c.right : c.left)).filter((x) => x >= 0))];
    return { index: r, id: reg.id, name: reg.name, side: reg.side, plane: planes[r], verts: loopVerts(r), front, neighbors };
  });

  // Si llevar las esquinas a los planos cruza un polígono (labios muy curvos,
  // vistas muy de lado), sus vértices vuelven a la posición medida; si aun así
  // se cruza, sus fronteras reciben más puntos (también medidos).
  const crossed = (f: BlockFace) => f.verts.length >= 4 && selfIntersects(projectToPlane(f.verts.map((v) => vertices[v].p), f.plane.n));
  for (let pass = 0; pass < 4; pass++) {
    const bad = faces.filter(crossed);
    if (!bad.length) break;
    for (const f of bad) {
      if (pass > 0) {
        const t = ([0.1, 0.05, 0.02][pass - 1] ?? 0.02) * ipd;
        for (const { chain } of topo.loops[f.index]) {
          const c = topo.chains[chain];
          const more = douglasPeucker3(c.verts.map(P), t);
          const merged = [...new Set([...keptIdx[chain], ...more])].sort((x, y) => x - y);
          if (merged.length === keptIdx[chain].length) continue;
          keptIdx[chain] = merged;
          chainKept[chain] = merged.map((k, i) => {
            const m = c.verts[k];
            const isEnd = i === 0 || i === merged.length - 1;
            return vertexFor(m, isEnd ? topo.labels[m] : [c.left, c.right]);
          });
        }
        // Las vecinas comparten esas cadenas: se rearman también.
        for (const g of [f.index, ...f.neighbors]) faces[g].verts = loopVerts(g);
      }
      for (const v of f.verts) vertices[v].p = vertices[v].raw;
    }
  }

  // 4 · Aristas.
  const edges: BlockEdge[] = [];
  topo.chains.forEach((c, ci) => {
    const ids = chainKept[ci];
    const accent = c.right === MOUTH || ACCENT.test(faces[c.left].id) || (c.right >= 0 && ACCENT.test(faces[c.right].id));
    for (let i = 0; i < ids.length - 1; i++) {
      if (ids[i] === ids[i + 1]) continue;
      edges.push({ a: ids[i], b: ids[i + 1], faces: [c.left, c.right], kind: 'hidden', angle: 0, accent, visible: [[0, 1]] });
    }
  });

  // 5 · Cráneo (fuera de la malla): tapa, laterales, nuca y orejas.
  if (skull) {
    const idOf = (m: number) => vertexOf.get(topo.cluster[m]);
    addSkull(skull, landmarks, vertices, faces, edges, idOf);
  }

  // 6 · Tipo de cada arista y limpieza. Un plano «de la orilla» toca el borde
  // de la malla o es del cráneo: solo ahí un cambio de visible a oculto es el
  // contorno exterior; dentro de la cara (el rojo del labio que mira hacia
  // abajo en una sonrisa) es un pliegue y se dibuja en grafito.
  const rim = new Set<number>();
  for (const e of edges) if (e.faces[1] === OUTSIDE) rim.add(e.faces[0]);
  faces.forEach((f) => /^(skull|ear)/.test(f.id) && rim.add(f.index));
  for (const e of edges) classify(e, faces, rim);
  cleanEdges(edges, vertices, ipd);

  // 7 · Oclusión: tramos de arista detrás de un plano visible.
  occlusion(edges, vertices, faces, ipd);

  return { level, vertices, faces, edges, ms: performance.now() - t0 };
}

function classify(e: BlockEdge, faces: readonly BlockFace[], rim: ReadonlySet<number>) {
  if (e.fixedKind) {
    const f = faces[e.faces[0]];
    e.kind = f.front ? e.fixedKind : 'hidden';
    return;
  }
  const fl = faces[e.faces[0]];
  if (e.faces[1] === MOUTH) {
    // La línea de la boca: siempre un acento si el labio se ve.
    e.angle = 90;
    e.kind = fl.front ? 'hard' : 'hidden';
    return;
  }
  const fr = e.faces[1] === OUTSIDE ? null : faces[e.faces[1]];
  if (!fr) {
    e.angle = 0;
    e.kind = fl.front ? 'contour' : 'hidden';
    return;
  }
  const nl = fl.plane.n;
  const nr = fr.plane.n;
  e.angle = (Math.acos(Math.max(-1, Math.min(1, nl.x * nr.x + nl.y * nr.y + nl.z * nr.z))) * 180) / Math.PI;
  if (fl.front && fr.front) e.kind = e.angle > HARD_EDGE_DEG ? 'hard' : 'soft';
  else if (fl.front || fr.front) e.kind = rim.has(fl.front ? fr.index : fl.index) ? 'contour' : 'hard';
  else e.kind = 'hidden';
}

/** Ángulo mínimo para completar una línea entre dos aristas dibujadas. */
const BRIDGE_DEG = 12;
/** Largo máximo (en DP) de una arista suelta que se descarta. */
const STUB = 0.2;

/**
 * Las líneas sueltas se leen como errores: una arista suave de más de 12° que
 * une dos líneas dibujadas se dibuja, y un tramo corto que termina en el aire
 * se quita.
 */
function cleanEdges(edges: BlockEdge[], vertices: readonly BlockVertex[], ipd: number) {
  const drawn = (e: BlockEdge) => e.kind === 'hard' || e.kind === 'contour';
  const degree = () => {
    const d = new Map<number, number>();
    for (const e of edges) if (drawn(e)) for (const v of [e.a, e.b]) d.set(v, (d.get(v) ?? 0) + 1);
    return d;
  };
  let deg = degree();
  for (const e of edges) {
    if (e.kind === 'soft' && e.angle >= BRIDGE_DEG && (deg.get(e.a) ?? 0) > 0 && (deg.get(e.b) ?? 0) > 0) e.kind = 'hard';
  }
  for (let pass = 0; pass < 2; pass++) {
    deg = degree();
    for (const e of edges) {
      if (e.kind !== 'hard' || e.fixedKind) continue;
      const a = vertices[e.a].p;
      const b = vertices[e.b].p;
      const L = Math.hypot(a.x - b.x, a.y - b.y);
      if (L < STUB * ipd && ((deg.get(e.a) ?? 0) === 1 || (deg.get(e.b) ?? 0) === 1)) e.kind = 'soft';
    }
  }
}

function occlusion(edges: BlockEdge[], vertices: readonly BlockVertex[], faces: readonly BlockFace[], ipd: number) {
  const frontFaces = faces.filter((f) => f.front && f.verts.length >= 3);
  const poly2 = new Map(frontFaces.map((f) => [f.index, f.verts.map((v) => v2(vertices[v].p.x, vertices[v].p.y))]));
  const eps = 0.03 * ipd;
  const occluded = (q: Vec3, own: readonly number[]) => {
    for (const f of frontFaces) {
      if (own.includes(f.index)) continue;
      const poly = poly2.get(f.index)!;
      if (!inPoly(q.x, q.y, poly)) continue;
      const { n, d } = f.plane;
      if (Math.abs(n.z) < 1e-6) continue;
      const z = (d - n.x * q.x - n.y * q.y) / n.z;
      if (z < q.z - eps) return true;
    }
    return false;
  };
  const SAMPLES = 9;
  for (const e of edges) {
    if (e.kind === 'hidden' || e.kind === 'soft') continue;
    const a = vertices[e.a].p;
    const b = vertices[e.b].p;
    const vis: boolean[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i + 0.5) / (SAMPLES + 1);
      vis.push(!occluded(v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t), e.faces));
    }
    const runs: [number, number][] = [];
    let start = -1;
    vis.forEach((v, i) => {
      if (v && start < 0) start = i;
      if ((!v || i === vis.length - 1) && start >= 0) {
        const end = v ? i + 1 : i;
        runs.push([start / vis.length, end / vis.length]);
        start = -1;
      }
    });
    e.visible = runs;
  }
}

// ---------------------------------------------------------------------------
// Cráneo: una caja con biseles alrededor de la esfera de Loomis, cosida al
// borde de la cara. Frente alta (del borde de la frente a la tapa), tapa,
// laterales (de la sien a la nuca, pasando por la oreja), nuca y la oreja como
// un plano en «C» sobre el lateral.

export interface SkullInput {
  frame: Pick<SimilarityFit, 'rotation' | 'scale' | 'translation'>;
  /** Puntos de la cara en el marco de frente (cm), como los usa Loomis. */
  frontal: readonly Vec3[];
  /** Esfera de Loomis (marco de frente, cm). */
  center: Vec3;
  radius: number;
  ears: { side: 'R' | 'L'; top: Vec2; lobe: Vec2 }[];
}

/**
 * Distancia (en radios) de las esquinas de la tapa al centro de la esfera. Por
 * fuera de la esfera: así la tapa llega casi a la cima (0.9 r) en lugar de
 * quedar inscrita y cortar el cabello.
 */
const TOP_K = 1.22;
/** Profundidad máxima (cm, marco de frente) del centro del cráneo para la caja. */
const MAX_CENTER_Z = -3.2;

/** Puntos del borde de la cara donde se cose el cráneo: sien alta y altura de la oreja. */
export const SKULL_ANCHORS = { templeR: 54, templeL: 284, earR: 234, earL: 454 } as const;

/**
 * Del marco de frente (cm) a px de la foto, con la z en la misma escala y
 * origen que los landmarks (la z de MediaPipe tiene otro origen que la
 * proyección del modelo).
 */
export function pxProjector(frame: SkullInput['frame'], frontal: readonly Vec3[], landmarks: readonly Vec3[]): (c: Vec3) => Vec3 {
  const zs = [10, 54, 284, 234, 454, 152, 4, 33, 263].map((i) => landmarks[i].z - projectCanonical(frame, frontal[i]).z).sort((a, b) => a - b);
  const dz = zs[Math.floor(zs.length / 2)];
  return (c: Vec3) => {
    const q = projectCanonical(frame, c);
    return v3(q.x, q.y, q.z + dz);
  };
}

function addSkull(
  sk: SkullInput,
  landmarks: readonly Vec3[],
  vertices: BlockVertex[],
  faces: BlockFace[],
  edges: BlockEdge[],
  idOf: (m: number) => number | undefined,
) {
  const ring = FACE_OVAL as readonly number[];
  const ringIds = (from: number, to: number) => {
    const out: number[] = [];
    let i = ring.indexOf(from);
    for (let k = 0; k <= ring.length; k++) {
      const id = idOf(ring[i]);
      if (id !== undefined && out[out.length - 1] !== id) out.push(id);
      if (ring[i] === to) break;
      i = (i + 1) % ring.length;
    }
    return out;
  };
  const A = SKULL_ANCHORS;
  if ([A.templeR, A.templeL, A.earR, A.earL].some((m) => idOf(m) === undefined)) return;
  const toPx = pxProjector(sk.frame, sk.frontal, landmarks);
  const C = sk.center;
  const r = sk.radius;
  const add = (c: Vec3) => {
    const q = toPx(c);
    vertices.push({ p: q, raw: q, mesh: -1, regions: [] });
    return vertices.length - 1;
  };
  // Esquinas sobre la esfera (un poco por fuera, para que los planos la
  // aproximen en lugar de quedar inscritos): arriba al frente, arriba atrás y
  // en la nuca detrás de la oreja.
  // Casi de frente, la silueta no fija la profundidad del centro (prueba de
  // Loomis con verdad conocida): el ajuste lo deja adelante y la nuca quedaría
  // delante de la oreja. Se limita al valor típico del modelo canónico.
  const cz = Math.min(C.z, MAX_CENTER_Z);
  const onSphere = (x: number, y: number, z: number, k: number) => {
    const l = Math.hypot(x, y, z);
    return v3(C.x + (x / l) * k * r, C.y + (y / l) * k * r, cz + (z / l) * k * r);
  };
  const FR = add(onSphere(-0.55, 0.72, 0.42, TOP_K));
  const FL = add(onSphere(0.55, 0.72, 0.42, TOP_K));
  const BR = add(onSphere(-0.55, 0.72, -0.42, TOP_K));
  const BL = add(onSphere(0.55, 0.72, -0.42, TOP_K));
  // Nuca detrás de la oreja: tan ancha como la cara a la altura del trago (el
  // cráneo es más largo que ancho; la esfera sola lo dejaría angosto).
  const NR = add(v3(-0.95 * Math.abs(sk.frontal[A.earR].x), C.y - 0.25 * r, cz - 0.95 * r));
  const NL = add(v3(0.95 * Math.abs(sk.frontal[A.earL].x), C.y - 0.25 * r, cz - 0.95 * r));
  const centerPx = toPx(C);

  const skullFaces: { id: string; name: string; side: 'C' | 'R' | 'L'; verts: number[] }[] = [
    { id: 'skullFront', name: 'frente alta', side: 'C', verts: [...ringIds(A.templeR, A.templeL), FL, FR] },
    { id: 'skullTop', name: 'tapa del cráneo', side: 'C', verts: [FR, FL, BL, BR] },
    { id: 'skullSideR', name: 'lateral del cráneo', side: 'R', verts: [...ringIds(A.earR, A.templeR), FR, BR, NR] },
    { id: 'skullSideL', name: 'lateral del cráneo', side: 'L', verts: [...ringIds(A.templeL, A.earL), NL, BL, FL] },
    { id: 'skullBack', name: 'nuca', side: 'C', verts: [BR, BL, NL, NR] },
  ];
  const first = faces.length;
  for (const sf of skullFaces) {
    const plane = polygonPlane(sf.verts.map((v) => vertices[v].p), centerPx);
    faces.push({ index: faces.length, id: sf.id, name: sf.name, side: sf.side, plane, verts: sf.verts, front: plane.n.z < -0.02, neighbors: [] });
  }

  // Aristas: las del borde de la cara pasan a tener el cráneo del otro lado.
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const existing = new Map(edges.map((e, i) => [key(e.a, e.b), i]));
  const fresh = new Map<string, BlockEdge>();
  for (let k = 0; k < skullFaces.length; k++) {
    const fi = first + k;
    const vs = skullFaces[k].verts;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const ek = key(a, b);
      const old = existing.get(ek);
      if (old !== undefined && edges[old].faces[1] === OUTSIDE) {
        edges[old].faces = [edges[old].faces[0], fi];
        continue;
      }
      const f = fresh.get(ek);
      if (f) f.faces = [f.faces[0], fi];
      else fresh.set(ek, { a, b, faces: [fi, OUTSIDE], kind: 'hidden', angle: 0, accent: false, visible: [[0, 1]] });
    }
  }
  edges.push(...fresh.values());

  // Orejas: un plano en «C» sobre el lateral, entre la punta y el lóbulo. La
  // dirección «hacia atrás» sale de la pose (de frente, la oreja se ve de canto).
  const o = projectCanonical(sk.frame, v3(0, 0, 0));
  const per = (x: number, y: number, z: number) => {
    const a = projectCanonical(sk.frame, v3(x, y, z));
    return v3(a.x - o.x, a.y - o.y, a.z - o.z);
  };
  const back = per(0, 0, -1);
  const up = per(0, 1, 0);
  for (const ear of sk.ears) {
    const sideIdx = first + (ear.side === 'R' ? 2 : 3);
    const side = faces[sideIdx];
    const mid = v2((ear.top.x + ear.lobe.x) / 2, (ear.top.y + ear.lobe.y) / 2);
    const L2 = Math.hypot(ear.top.x - ear.lobe.x, ear.top.y - ear.lobe.y);
    if (L2 < 1e-3) continue;
    const ux = (ear.top.x - mid.x) / (L2 / 2);
    const uy = (ear.top.y - mid.y) / (L2 / 2);
    // Largo de la oreja en cm (con el escorzo vertical) y ancho ≈ 0.55 del largo.
    const lengthCm = L2 / Math.max(0.3 * sk.frame.scale, Math.hypot(up.x, up.y));
    const W = 0.55 * lengthCm;
    const z0 = vertices[ear.side === 'R' ? NR : NL].p.z;
    const ids: number[] = [];
    // Hélice: media elipse detrás de la línea de inserción, de arriba abajo.
    for (let i = 0; i <= 6; i++) {
      const th = (Math.PI * i) / 6;
      const c = Math.cos(th);
      const sn = Math.sin(th) * (i <= 3 ? 1 : 0.85); // el lóbulo, algo más angosto
      const q = v3(mid.x + (ux * c * L2) / 2 + back.x * sn * W, mid.y + (uy * c * L2) / 2 + back.y * sn * W, z0 + back.z * sn * W);
      vertices.push({ p: q, raw: q, mesh: -1, regions: [] });
      ids.push(vertices.length - 1);
    }
    const fi = faces.length;
    faces.push({ index: fi, id: `ear${ear.side}`, name: 'oreja', side: ear.side, plane: side.plane, verts: ids, front: side.front, neighbors: [sideIdx], inset: true });
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i];
      const c = ids[(i + 1) % ids.length];
      // La línea de inserción (de vuelta al primer punto) la comparte con el lateral.
      const closing = i === ids.length - 1;
      edges.push({ a, b: c, faces: closing ? [fi, sideIdx] : [fi, OUTSIDE], kind: 'hidden', angle: 0, accent: false, visible: [[0, 1]], fixedKind: 'hard' });
    }
  }

  // Vecinos de los planos del cráneo y de la cara a la que se cosen.
  for (const e of edges) {
    const [l, rr] = e.faces;
    if (rr < 0) continue;
    if (!faces[l].neighbors.includes(rr)) faces[l].neighbors.push(rr);
    if (!faces[rr].neighbors.includes(l)) faces[rr].neighbors.push(l);
  }
}

/** Plano de un polígono (normal de Newell), orientado lejos de `inside`. */
function polygonPlane(pts: readonly Vec3[], inside: Vec3): Plane {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
    cx += a.x;
    cy += a.y;
    cz += a.z;
  }
  cx /= pts.length;
  cy /= pts.length;
  cz /= pts.length;
  const l = Math.hypot(nx, ny, nz) || 1;
  let n = v3(nx / l, ny / l, nz / l);
  if (n.x * (cx - inside.x) + n.y * (cy - inside.y) + n.z * (cz - inside.z) < 0) n = v3(-n.x, -n.y, -n.z);
  const centroid = v3(cx, cy, cz);
  let rms = 0;
  for (const p of pts) rms += (n.x * (p.x - cx) + n.y * (p.y - cy) + n.z * (p.z - cz)) ** 2;
  return { n, d: n.x * cx + n.y * cy + n.z * cz, centroid, rms: Math.sqrt(rms / pts.length) };
}

function inPoly(x: number, y: number, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Calidad (§12.2): planos sin vecinos y polígonos no convexos.

export interface BlockingQuality {
  faces: number;
  /** Planos con menos de dos aristas compartidas. */
  floating: string[];
  /** Polígonos con autointersección. */
  selfIntersecting: string[];
  /** Polígonos con algún ángulo cóncavo marcado (> 200°) en su plano. */
  concave: string[];
}

export function blockingQuality(b: Blocking): BlockingQuality {
  const floating: string[] = [];
  const selfIntersecting: string[] = [];
  const concave: string[] = [];
  const sharedEdges = new Map<number, number>();
  for (const e of b.edges) {
    if (e.faces[1] < 0) continue;
    for (const f of e.faces) sharedEdges.set(f, (sharedEdges.get(f) ?? 0) + 1);
  }
  for (const f of b.faces) {
    if (!f.inset && (sharedEdges.get(f.index) ?? 0) < 2) floating.push(f.id);
    const pts = projectToPlane(f.verts.map((v) => b.vertices[v].p), f.plane.n);
    if (selfIntersects(pts)) selfIntersecting.push(f.id);
    if (maxTurn(pts) > 200) concave.push(f.id);
  }
  return { faces: b.faces.length, floating, selfIntersecting, concave };
}

const cross = (a: Vec3, b: Vec3) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const norm = (a: Vec3) => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / l, a.y / l, a.z / l);
};

/** Coordenadas 2D de puntos sobre el plano de normal n. */
function projectToPlane(pts: readonly Vec3[], n: Vec3): Vec2[] {
  const u = Math.abs(n.x) < 0.9 ? norm(cross(n, v3(1, 0, 0))) : norm(cross(n, v3(0, 1, 0)));
  const w = cross(n, u);
  return pts.map((p) => v2(p.x * u.x + p.y * u.y + p.z * u.z, p.x * w.x + p.y * w.y + p.z * w.z));
}

function selfIntersects(p: readonly Vec2[]): boolean {
  const n = p.length;
  const seg = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
    const o = (p1: Vec2, p2: Vec2, p3: Vec2) => Math.sign((p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (seg(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Mayor ángulo interior (°) del polígono, con su orientación. */
function maxTurn(p: readonly Vec2[]): number {
  const n = p.length;
  if (n < 4) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) area += p[i].x * p[(i + 1) % n].y - p[(i + 1) % n].x * p[i].y;
  const s = Math.sign(area) || 1;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n];
    const b = p[i];
    const c = p[(i + 1) % n];
    const crossZ = ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) * s;
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    const turn = (Math.atan2(crossZ, dot) * 180) / Math.PI; // giro exterior con signo
    worst = Math.max(worst, 180 - turn);
  }
  return worst;
}
