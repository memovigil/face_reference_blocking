// Paso D · Regiones anatómicas del blocking (§7.1).
//
// Cada región se define por SEMILLAS: landmarks verificados en el centro del
// plano (lado derecho del sujeto; el izquierdo se refleja). La partición de la
// malla canónica se calcula creciendo las regiones desde sus semillas sobre los
// triángulos, con un costo que combina la diferencia de normal con la normal
// media de la región (estilo «Variational Shape Approximation», Cohen‑Steiner
// et al., 2004) y la distancia a su centro. Así las fronteras caen donde la
// superficie cambia de dirección y cada región conserva su identidad
// anatómica. La partición depende solo de la topología y del modelo canónico:
// se calcula una vez y se usa para cualquier cara (los planos sí se ajustan a
// los puntos de esa cara, en blocking.ts).
//
// Niveles: «fino» es la partición base (~50 polígonos); «medio» y «grande»
// fusionan regiones (~30 tipos y ~12 planos, contando una vez los pares
// izquierdo/derecho en el medio, como en la lista mínima de §7.1). En el
// grande se agrupan regiones cuyas normales se parecen (sien con pómulo; bajo
// el pómulo con la mandíbula), para que cada plano grande sea casi plano, y la
// nariz queda en cuña: frente, base y dos lados.
//
// Verificación visual: `node tests/visual/regions.mjs` pinta la malla por región.

import { CANONICAL_TRIANGLES, CANONICAL_VERTICES } from '../data/canonicalFace';
import { LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR } from '../detect/landmarkMap';
import { symmetricEigen, v3, type Vec3 } from './vec';

export type BlockLevel = 'grande' | 'medio' | 'fino';
export const BLOCK_LEVELS: readonly BlockLevel[] = ['grande', 'medio', 'fino'];

type SideKind = 'C' | 'RL';

interface FineDef {
  base: string;
  kind: SideKind;
  /** Semillas: lado derecho del sujeto (x < 0) y línea media. */
  seeds: number[];
  medio: string;
  grande: string;
}

// Grupos de los niveles medio y grande: centrales (una región) o pares.
const GROUP_KIND: Record<string, SideKind> = {
  // medio
  foreheadC: 'C', glabella: 'C', noseRoot: 'C', noseBridge: 'C', noseTip: 'C', noseTipBottom: 'C', noseBase: 'C',
  upperLipC: 'C', lowerLipC: 'C', chinFront: 'C', chinBottom: 'C',
  foreheadL: 'RL', temple: 'RL', brow: 'RL', orbitRoof: 'RL', upperLid: 'RL', lowerLid: 'RL', orbitInner: 'RL',
  noseSide: 'RL', noseAla: 'RL', cheekFront: 'RL', cheekbone: 'RL', underCheek: 'RL', nasolabial: 'RL',
  upperLipL: 'RL', lowerLipL: 'RL', chinL: 'RL', jaw: 'RL',
  // grande
  forehead: 'C', orbit: 'RL', noseFront: 'C', noseBottom: 'C', noseSides: 'RL', cheek: 'RL', mouth: 'C', chin: 'C', templeCheek: 'RL',
};

// prettier-ignore
const FINE: FineDef[] = [
  // Frente y cejas
  { base: 'foreheadC', kind: 'C', seeds: [151, 108, 10, 109], medio: 'foreheadC', grande: 'forehead' },
  { base: 'foreheadL', kind: 'RL', seeds: [69, 67, 104], medio: 'foreheadL', grande: 'forehead' },
  { base: 'temple', kind: 'RL', seeds: [21, 71, 162, 139], medio: 'temple', grande: 'templeCheek' },
  { base: 'glabella', kind: 'C', seeds: [9, 8], medio: 'glabella', grande: 'forehead' },
  { base: 'brow', kind: 'RL', seeds: [53, 52, 65, 46], medio: 'brow', grande: 'forehead' },
  // Órbita
  { base: 'orbitRoof', kind: 'RL', seeds: [223, 224, 222, 225], medio: 'orbitRoof', grande: 'orbit' },
  { base: 'upperLid', kind: 'RL', seeds: [27, 28, 29], medio: 'upperLid', grande: 'orbit' },
  { base: 'eye', kind: 'RL', seeds: [], medio: 'upperLid', grande: 'orbit' },
  { base: 'lowerLid', kind: 'RL', seeds: [23, 24, 22], medio: 'lowerLid', grande: 'orbit' },
  { base: 'orbitInner', kind: 'RL', seeds: [243, 244, 189], medio: 'orbitInner', grande: 'orbit' },
  // Nariz
  { base: 'noseRoot', kind: 'C', seeds: [168], medio: 'noseRoot', grande: 'noseFront' },
  { base: 'noseBridge', kind: 'C', seeds: [197, 195], medio: 'noseBridge', grande: 'noseFront' },
  { base: 'noseSide', kind: 'RL', seeds: [174, 236, 198, 134], medio: 'noseSide', grande: 'noseSides' },
  { base: 'noseTip', kind: 'C', seeds: [4, 45], medio: 'noseTip', grande: 'noseFront' },
  { base: 'noseTipBottom', kind: 'C', seeds: [19, 1], medio: 'noseTipBottom', grande: 'noseBottom' },
  { base: 'noseBase', kind: 'C', seeds: [94, 2], medio: 'noseBase', grande: 'noseBottom' },
  { base: 'noseAla', kind: 'RL', seeds: [48, 102, 64], medio: 'noseAla', grande: 'noseSides' },
  // Mejilla
  { base: 'cheekFront', kind: 'RL', seeds: [119, 101, 118], medio: 'cheekFront', grande: 'cheek' },
  { base: 'cheekbone', kind: 'RL', seeds: [116, 123, 143, 35], medio: 'cheekbone', grande: 'templeCheek' },
  { base: 'underCheek', kind: 'RL', seeds: [207, 187, 214], medio: 'underCheek', grande: 'jaw' },
  { base: 'nasolabial', kind: 'RL', seeds: [203, 206, 216], medio: 'nasolabial', grande: 'cheek' },
  // Boca
  { base: 'philtrum', kind: 'C', seeds: [164], medio: 'upperLipC', grande: 'mouth' },
  { base: 'upperLipL', kind: 'RL', seeds: [165, 92], medio: 'upperLipL', grande: 'mouth' },
  { base: 'upperRedC', kind: 'C', seeds: [11, 12], medio: 'upperLipC', grande: 'mouth' },
  { base: 'upperRedL', kind: 'RL', seeds: [73, 74], medio: 'upperLipL', grande: 'mouth' },
  { base: 'lowerRedC', kind: 'C', seeds: [15, 16], medio: 'lowerLipC', grande: 'mouth' },
  { base: 'lowerLipL', kind: 'RL', seeds: [179, 89, 180], medio: 'lowerLipL', grande: 'mouth' },
  { base: 'sulcus', kind: 'C', seeds: [18], medio: 'lowerLipC', grande: 'mouth' },
  // Mentón y mandíbula
  { base: 'chinFront', kind: 'C', seeds: [200, 199], medio: 'chinFront', grande: 'chin' },
  { base: 'chinL', kind: 'RL', seeds: [32, 211, 202], medio: 'chinL', grande: 'chin' },
  { base: 'chinBottom', kind: 'C', seeds: [152, 175], medio: 'chinBottom', grande: 'chin' },
  { base: 'jaw', kind: 'RL', seeds: [135, 138, 169], medio: 'jaw', grande: 'jaw' },
  { base: 'ramus', kind: 'RL', seeds: [177, 215], medio: 'jaw', grande: 'jaw' },
];

/** Nombre de cada región o grupo (para la leyenda y la prueba de humo). */
export const REGION_NAMES: Record<string, string> = {
  foreheadC: 'frente central', foreheadL: 'frente lateral', temple: 'sien', glabella: 'entrecejo', brow: 'arco superciliar',
  orbitRoof: 'techo de la órbita', upperLid: 'párpado superior', eye: 'ojo', lowerLid: 'párpado inferior', orbitInner: 'pared interna de la órbita',
  noseRoot: 'raíz de la nariz', noseBridge: 'dorso de la nariz', noseSide: 'lado de la nariz', noseTip: 'punta de la nariz',
  noseTipBottom: 'plano inferior de la punta', noseBase: 'base de la nariz', noseAla: 'ala de la nariz',
  cheekFront: 'mejilla', cheekbone: 'pómulo', underCheek: 'bajo el pómulo', nasolabial: 'surco nasolabial',
  philtrum: 'filtrum', upperLipL: 'labio superior lateral', upperRedC: 'labio superior', upperRedL: 'labio superior lateral (rojo)',
  upperLipC: 'labio superior central', lowerRedC: 'labio inferior', lowerLipL: 'labio inferior lateral', sulcus: 'bajo el labio inferior',
  lowerLipC: 'labio inferior central', chinFront: 'mentón', chinL: 'mentón lateral', chinBottom: 'plano inferior del mentón',
  jaw: 'mandíbula', ramus: 'rama de la mandíbula',
  forehead: 'frente', orbit: 'órbita', noseFront: 'nariz', noseBottom: 'base de la nariz', noseSides: 'lado de la nariz', cheek: 'mejilla', mouth: 'boca', chin: 'mentón',
  templeCheek: 'sien y pómulo',
};

// ---------------------------------------------------------------------------
// Malla canónica: triángulos, normales, adyacencia y reflejo.

const NV = 468;
const NT = CANONICAL_TRIANGLES.length / 3;
const cp = (i: number): Vec3 => v3(CANONICAL_VERTICES[i * 3], CANONICAL_VERTICES[i * 3 + 1], CANONICAL_VERTICES[i * 3 + 2]);
const tri = (t: number): [number, number, number] => [CANONICAL_TRIANGLES[t * 3], CANONICAL_TRIANGLES[t * 3 + 1], CANONICAL_TRIANGLES[t * 3 + 2]];

export interface MeshTopology {
  tris: [number, number, number][];
  /** Triángulos vecinos por arista. */
  adj: number[][];
  /** Signo que orienta las normales hacia afuera con el orden de vértices de la malla. */
  windingSign: 1 | -1;
}

let topo: MeshTopology | null = null;

export function meshTopology(): MeshTopology {
  if (topo) return topo;
  const tris = Array.from({ length: NT }, (_, t) => tri(t));
  const edgeTris = new Map<string, number[]>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  tris.forEach(([a, b, c], t) => {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = key(p, q);
      edgeTris.set(k, [...(edgeTris.get(k) ?? []), t]);
    }
  });
  const adj: number[][] = tris.map(() => []);
  for (const ts of edgeTris.values()) {
    if (ts.length === 2) {
      adj[ts[0]].push(ts[1]);
      adj[ts[1]].push(ts[0]);
    }
  }
  // La punta de la nariz mira a +z: con eso se fija la orientación del orden de vértices.
  let s = 0;
  tris.forEach(([a, b, c]) => {
    if (a !== 4 && b !== 4 && c !== 4) return;
    s += rawNormal(cp(a), cp(b), cp(c)).z;
  });
  topo = { tris, adj, windingSign: s >= 0 ? 1 : -1 };
  return topo;
}

function rawNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const wx = c.x - a.x;
  const wy = c.y - a.y;
  const wz = c.z - a.z;
  return v3(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
}

/** Normal de un triángulo (orientada hacia afuera) y su área, con posiciones dadas. */
export function triangleNormal(pos: (i: number) => Vec3, t: [number, number, number], sign: number): { n: Vec3; area: number } {
  const r = rawNormal(pos(t[0]), pos(t[1]), pos(t[2]));
  const l = Math.hypot(r.x, r.y, r.z) || 1;
  return { n: v3((r.x / l) * sign, (r.y / l) * sign, (r.z / l) * sign), area: l / 2 };
}

/** Índice reflejado (x → −x) de cada vértice del modelo canónico. */
export const MIRROR: readonly number[] = (() => {
  const out: number[] = [];
  for (let i = 0; i < NV; i++) {
    const p = cp(i);
    let best = i;
    let bd = Infinity;
    for (let j = 0; j < NV; j++) {
      const q = cp(j);
      const d = (q.x + p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    out.push(best);
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Partición fina.

export interface FineRegion {
  /** Identificador con lado: `browR`, `browL`, `glabella`. */
  id: string;
  base: string;
  side: 'C' | 'R' | 'L';
  medio: string;
  grande: string;
  medioBase: string;
  grandeBase: string;
  seeds: number[];
}

const groupId = (group: string, side: 'C' | 'R' | 'L') => (GROUP_KIND[group] === 'RL' ? `${group}${side === 'C' ? '' : side}` : group);

export const FINE_REGIONS: readonly FineRegion[] = (() => {
  const out: FineRegion[] = [];
  for (const d of FINE) {
    if (d.kind === 'C') {
      const seeds = [...new Set([...d.seeds, ...d.seeds.map((i) => MIRROR[i])])];
      out.push({ id: d.base, base: d.base, side: 'C', medio: groupId(d.medio, 'C'), grande: groupId(d.grande, 'C'), medioBase: d.medio, grandeBase: d.grande, seeds });
    } else {
      for (const side of ['R', 'L'] as const) {
        const seeds = side === 'R' ? d.seeds : d.seeds.map((i) => MIRROR[i]);
        out.push({ id: `${d.base}${side}`, base: d.base, side, medio: groupId(d.medio, side), grande: groupId(d.grande, side), medioBase: d.medio, grandeBase: d.grande, seeds });
      }
    }
  }
  return out;
})();

/** Etiqueta de los triángulos de la abertura de la boca (no son de ninguna región). */
export const MOUTH_HOLE = -2;

/** Costo de la distancia al centro de la región (por cm²), frente a 1 − cos(Δnormal). */
const DIST_WEIGHT = 0.015;
const ITERATIONS = 6;

function pointInPoly2(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Triángulos dentro de un contorno cerrado (todos sus vértices en él y el centro dentro). */
function trianglesInside(contour: readonly number[]): number[] {
  const { tris } = meshTopology();
  const set = new Set(contour);
  const poly = contour.map((i) => cp(i));
  const out: number[] = [];
  tris.forEach(([a, b, c], t) => {
    if (!set.has(a) || !set.has(b) || !set.has(c)) return;
    const x = (cp(a).x + cp(b).x + cp(c).x) / 3;
    const y = (cp(a).y + cp(b).y + cp(c).y) / 3;
    if (pointInPoly2(x, y, poly)) out.push(t);
  });
  return out;
}

/** Contornos ordenados de ojo y boca (abiertos en la malla, cerrados aquí). */
const eyeLoop = (c: readonly number[]) => [...c.slice(0, 9), ...c.slice(9).reverse()];
const MOUTH_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];

let finePartition: Int16Array | null = null;

/** Región fina (índice en FINE_REGIONS) de cada triángulo de la malla. */
export function fineTriangleRegions(): Int16Array {
  if (finePartition) return finePartition;
  const { tris, adj, windingSign } = meshTopology();
  const R = FINE_REGIONS.length;
  const idx = new Map(FINE_REGIONS.map((r, i) => [r.id, i]));
  const geo = tris.map((t) => {
    const { n, area } = triangleNormal(cp, t, windingSign);
    const c = v3((cp(t[0]).x + cp(t[1]).x + cp(t[2]).x) / 3, (cp(t[0]).y + cp(t[1]).y + cp(t[2]).y) / 3, (cp(t[0]).z + cp(t[1]).z + cp(t[2]).z) / 3);
    return { n, area, c };
  });

  // Triángulos fijos: aberturas de ojos y boca.
  const pinned = new Int16Array(NT).fill(-1);
  for (const t of trianglesInside(eyeLoop(RIGHT_EYE_CONTOUR))) pinned[t] = idx.get('eyeR')!;
  for (const t of trianglesInside(eyeLoop(LEFT_EYE_CONTOUR))) pinned[t] = idx.get('eyeL')!;
  // La abertura de la boca es un hueco: con la boca abierta, un plano que la
  // cruzara uniría los dos labios. Su borde se dibuja como acento.
  for (const t of trianglesInside(MOUTH_INNER)) pinned[t] = MOUTH_HOLE;
  // Triángulos semilla: tocan semillas de una sola región.
  const seedOwner = new Map<number, number>();
  FINE_REGIONS.forEach((r, ri) => {
    for (const v of r.seeds) seedOwner.set(v, seedOwner.has(v) && seedOwner.get(v) !== ri ? -3 : ri);
  });
  tris.forEach((t, ti) => {
    if (pinned[ti] !== -1) return;
    const owners = new Set(t.map((v) => seedOwner.get(v)).filter((o): o is number => o !== undefined));
    if (owners.size === 1) {
      const o = [...owners][0];
      if (o >= 0) pinned[ti] = o;
    }
  });

  let label = new Int16Array(NT).fill(-1);
  const normals = new Array(R).fill(null).map(() => v3(0, 0, 1));
  const centers = new Array(R).fill(null).map(() => v3(0, 0, 0));
  const updateProxies = (lab: Int16Array) => {
    const acc = Array.from({ length: R }, () => ({ n: v3(0, 0, 0), c: v3(0, 0, 0), a: 0 }));
    lab.forEach((r, t) => {
      if (r < 0) return;
      const g = geo[t];
      const s = acc[r];
      s.n = v3(s.n.x + g.n.x * g.area, s.n.y + g.n.y * g.area, s.n.z + g.n.z * g.area);
      s.c = v3(s.c.x + g.c.x * g.area, s.c.y + g.c.y * g.area, s.c.z + g.c.z * g.area);
      s.a += g.area;
    });
    acc.forEach((s, r) => {
      if (s.a <= 0) return;
      const l = Math.hypot(s.n.x, s.n.y, s.n.z) || 1;
      normals[r] = v3(s.n.x / l, s.n.y / l, s.n.z / l);
      centers[r] = v3(s.c.x / s.a, s.c.y / s.a, s.c.z / s.a);
    });
  };
  updateProxies(pinned);

  for (let it = 0; it < ITERATIONS; it++) {
    label = pinned.slice();
    // Cola de prioridad simple (montículo binario).
    const heap: { cost: number; t: number; r: number }[] = [];
    const push = (e: { cost: number; t: number; r: number }) => {
      heap.push(e);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].cost <= heap[i].cost) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
          if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const cost = (t: number, r: number) => {
      const g = geo[t];
      const n = normals[r];
      const c = centers[r];
      const dn = 1 - (g.n.x * n.x + g.n.y * n.y + g.n.z * n.z);
      const dc = (g.c.x - c.x) ** 2 + (g.c.y - c.y) ** 2 + (g.c.z - c.z) ** 2;
      return dn + DIST_WEIGHT * dc;
    };
    label.forEach((r, t) => {
      if (r < 0) return;
      for (const u of adj[t]) if (label[u] === -1) push({ cost: cost(u, r), t: u, r });
    });
    while (heap.length) {
      const { t, r } = pop();
      if (label[t] !== -1) continue;
      label[t] = r;
      for (const u of adj[t]) if (label[u] === -1) push({ cost: cost(u, r), t: u, r });
    }
    updateProxies(label);
  }

  symmetrize(label);
  keepConnected(label, pinned);
  finePartition = label;
  return label;
}

/** Copia el lado derecho al izquierdo (la malla canónica es simétrica). */
function symmetrize(label: Int16Array) {
  const { tris } = meshTopology();
  const byKey = new Map<string, number>();
  const key = (t: number[]) => [...t].sort((a, b) => a - b).join(',');
  tris.forEach((t, i) => byKey.set(key(t), i));
  const idx = new Map(FINE_REGIONS.map((r, i) => [r.id, i]));
  const mirrorRegion = (r: number) => {
    const reg = FINE_REGIONS[r];
    if (reg.side === 'C') return r;
    return idx.get(`${reg.base}${reg.side === 'R' ? 'L' : 'R'}`)!;
  };
  const src = label.slice();
  tris.forEach((t, i) => {
    const cx = (cp(t[0]).x + cp(t[1]).x + cp(t[2]).x) / 3;
    if (cx <= 0.05) return;
    const m = byKey.get(key(t.map((v) => MIRROR[v])));
    if (m !== undefined && src[m] >= 0) label[i] = mirrorRegion(src[m]);
  });
}

/** Cada región queda en una sola pieza: las islas pasan a la región vecina más común. */
function keepConnected(label: Int16Array, pinned: Int16Array) {
  const { adj } = meshTopology();
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const comp = new Int32Array(NT).fill(-1);
    const comps: { r: number; tris: number[]; pinned: number }[] = [];
    for (let t = 0; t < NT; t++) {
      if (comp[t] >= 0) continue;
      const r = label[t];
      const c = comps.length;
      const list: number[] = [];
      let pins = 0;
      const stack = [t];
      comp[t] = c;
      while (stack.length) {
        const u = stack.pop()!;
        list.push(u);
        if (pinned[u] === r) pins++;
        for (const w of adj[u]) {
          if (comp[w] < 0 && label[w] === r) {
            comp[w] = c;
            stack.push(w);
          }
        }
      }
      comps.push({ r, tris: list, pinned: pins });
    }
    const best = new Map<number, number>();
    comps.forEach((c, i) => {
      const b = best.get(c.r);
      const score = c.pinned * 1000 + c.tris.length;
      if (b === undefined || score > comps[b].pinned * 1000 + comps[b].tris.length) best.set(c.r, i);
    });
    comps.forEach((c, i) => {
      if (c.r < 0 || best.get(c.r) === i) return;
      const votes = new Map<number, number>();
      for (const u of c.tris) for (const w of adj[u]) if (comp[w] !== i && label[w] >= 0) votes.set(label[w], (votes.get(label[w]) ?? 0) + 1);
      const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!winner) return;
      for (const u of c.tris) label[u] = winner[0];
      changed = true;
    });
    if (!changed) break;
  }
}

// ---------------------------------------------------------------------------
// Niveles.

export interface LevelRegion {
  id: string;
  name: string;
  side: 'C' | 'R' | 'L';
  tris: number[];
}

export interface LevelPartition {
  level: BlockLevel;
  regions: LevelRegion[];
  /** Región (índice en `regions`) de cada triángulo; MOUTH_HOLE en la abertura de la boca. */
  triRegion: Int16Array;
}

const levelCache = new Map<BlockLevel, LevelPartition>();

export function levelPartition(level: BlockLevel): LevelPartition {
  const hit = levelCache.get(level);
  if (hit) return hit;
  const fine = fineTriangleRegions();
  const groupBase = (r: FineRegion) => (level === 'fino' ? r.base : level === 'medio' ? r.medioBase : r.grandeBase);
  const groupOf = (r: FineRegion) => (level === 'fino' ? r.id : level === 'medio' ? r.medio : r.grande);
  const regions: LevelRegion[] = [];
  const index = new Map<string, number>();
  const fineToLevel = FINE_REGIONS.map((r) => {
    const id = groupOf(r);
    if (!index.has(id)) {
      const base = groupBase(r);
      const central = level === 'fino' ? r.side === 'C' : GROUP_KIND[base] === 'C';
      index.set(id, regions.length);
      regions.push({ id, name: REGION_NAMES[base] ?? base, side: central ? 'C' : r.side, tris: [] });
    }
    return index.get(id)!;
  });
  const triRegion = new Int16Array(NT);
  fine.forEach((r, t) => {
    if (r < 0) {
      triRegion[t] = r;
      return;
    }
    triRegion[t] = fineToLevel[r];
    regions[fineToLevel[r]].tris.push(t);
  });
  const res = { level, regions, triRegion };
  levelCache.set(level, res);
  return res;
}

// ---------------------------------------------------------------------------
// Plano por PCA.

export interface Plane {
  /** Normal unitaria (orientada hacia afuera de la cara). */
  n: Vec3;
  /** n · x = d para los puntos del plano. */
  d: number;
  centroid: Vec3;
  /** Error RMS de los puntos al plano. */
  rms: number;
}

/**
 * Plano de mínimos cuadrados por PCA: la normal es el vector propio de menor
 * valor de la covarianza de los puntos. `outward` fija el sentido de la normal.
 */
export function fitPlane(points: readonly Vec3[], outward?: Vec3, weights?: readonly number[]): Plane {
  let W = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  points.forEach((p, i) => {
    const w = weights ? weights[i] : 1;
    W += w;
    cx += p.x * w;
    cy += p.y * w;
    cz += p.z * w;
  });
  cx /= W || 1;
  cy /= W || 1;
  cz /= W || 1;
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  points.forEach((p, i) => {
    const w = weights ? weights[i] : 1;
    const d = [p.x - cx, p.y - cy, p.z - cz];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a * 3 + b] += w * d[a] * d[b];
  });
  const { values, vectors } = symmetricEigen(m, 3);
  let n = v3(vectors[2], vectors[5], vectors[8]);
  if (outward && n.x * outward.x + n.y * outward.y + n.z * outward.z < 0) n = v3(-n.x, -n.y, -n.z);
  const centroid = v3(cx, cy, cz);
  return { n, d: n.x * cx + n.y * cy + n.z * cz, centroid, rms: Math.sqrt(Math.max(0, values[2]) / (W || 1)) };
}

/**
 * Punto más cercano a varios planos a la vez, sin alejarse mucho de `p0`:
 * minimiza Σ (nᵢ·x − dᵢ)² + λ‖x − p0‖². Con tres planos bien condicionados es
 * su intersección; con dos, el punto de su recta más cercano a p0; con uno, la
 * proyección de p0.
 */
export function closestToPlanes(planes: readonly Plane[], p0: Vec3, lambda: number): Vec3 {
  const A = [lambda, 0, 0, 0, lambda, 0, 0, 0, lambda];
  const b = [lambda * p0.x, lambda * p0.y, lambda * p0.z];
  for (const { n, d } of planes) {
    const nn = [n.x, n.y, n.z];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i * 3 + j] += nn[i] * nn[j];
      b[i] += nn[i] * d;
    }
  }
  // Cramer.
  const det = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const D = det(A);
  if (Math.abs(D) < 1e-12) return p0;
  const col = (k: number) => A.map((v, i) => (i % 3 === k ? b[Math.floor(i / 3)] : v));
  return v3(det(col(0)) / D, det(col(1)) / D, det(col(2)) / D);
}
