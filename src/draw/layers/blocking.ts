// Paso D · Blocking de planos: solo las aristas donde cambia el plano, el
// contorno exterior y, en el nivel fino, las aristas suaves muy tenues. Las
// partes tapadas por otro plano (la mejilla lejana detrás de la nariz) no se
// dibujan.

import type { BlockEdge, Blocking } from '../../geom/blocking';
import { v2, type Vec2 } from '../../geom/vec';
import { s, screenGroup, segments } from '../svg';
import type { LayerDef } from './types';

function visibleSegments(b: Blocking, edges: readonly BlockEdge[]): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (const e of edges) {
    const a = b.vertices[e.a].p;
    const c = b.vertices[e.b].p;
    for (const [t0, t1] of e.visible) {
      out.push([v2(a.x + (c.x - a.x) * t0, a.y + (c.y - a.y) * t0), v2(a.x + (c.x - a.x) * t1, a.y + (c.y - a.y) * t1)]);
    }
  }
  return out;
}

export const blockingLayer: LayerDef = {
  id: 'blocking',
  layer: 'structure',
  steps: ['D'],
  render(g, { state, d }) {
    const b = d.blocking;
    if (!b) return;
    g.style.setProperty('--bk-w', String(state.blockLineWidth));
    const soft = b.edges.filter((e) => e.kind === 'soft');
    const hard = b.edges.filter((e) => e.kind === 'hard' && !e.accent);
    const accent = b.edges.filter((e) => e.kind === 'hard' && e.accent);
    const contour = b.edges.filter((e) => e.kind === 'contour');
    if (b.level === 'fino' && soft.length) {
      // Las suaves no tienen recorte por oclusión: solo las de planos visibles.
      s('path', { class: 'bk bk-soft', d: segments(soft.map((e) => [v2(b.vertices[e.a].p.x, b.vertices[e.a].p.y), v2(b.vertices[e.b].p.x, b.vertices[e.b].p.y)])) }, g);
    }
    const lines = [...visibleSegments(b, hard), ...visibleSegments(b, accent), ...visibleSegments(b, contour)];
    s('path', { class: 'bk bk-halo', d: segments(lines) }, g);
    s('path', { class: 'bk bk-hard', d: segments(visibleSegments(b, hard)) }, g);
    s('path', { class: 'bk bk-hard bk-accent', d: segments(visibleSegments(b, accent)) }, g);
    s('path', { class: 'bk bk-contour', d: segments(visibleSegments(b, contour)) }, g);
    if (state.blockNames) {
      for (const f of b.faces) {
        if (!f.front || f.verts.length < 3) continue;
        let x = 0;
        let y = 0;
        for (const v of f.verts) {
          x += b.vertices[v].p.x;
          y += b.vertices[v].p.y;
        }
        const sg = screenGroup(v2(x / f.verts.length, y / f.verts.length), g, { class: 'bk-name' });
        const t = s('text', { 'x': 0, 'y': 3, 'text-anchor': 'middle' }, sg);
        t.textContent = f.name;
      }
    }
  },
};
