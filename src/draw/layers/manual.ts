// Puntos del modo manual: los que el usuario ya colocó, arrastrables. Se
// dibujan aunque todavía no haya malla (faltan puntos).

import { MANUAL_POINTS } from '../../geom/manualFit';
import type { AppState } from '../../state/store';
import { manualLabel } from '../../ui/labels';
import { screenGroup, s } from '../svg';

export function drawManualPoints(parent: SVGGElement, state: AppState): void {
  const m = state.manual;
  if (!m) return;
  const g = s('g', { class: `l-manual${state.step === 'R' ? '' : ' kp-mini'}` }, parent);
  for (const id of MANUAL_POINTS[m.view]) {
    const p = m.points[id];
    if (!p) continue;
    const sg = screenGroup(p, g, { 'class': `kp kp-manual${id === m.next ? ' kp-sel' : ''}`, 'data-handle': `m:${id}` });
    s('circle', { class: 'kp-hit', r: 13 }, sg);
    s('circle', { class: 'kp-ring', r: 6.5 }, sg);
    s('circle', { class: 'kp-dot', r: 2 }, sg);
    const t = s('text', { 'class': 'kp-label', 'x': 10, 'y': -9 }, sg);
    t.textContent = manualLabel(id);
  }
}
