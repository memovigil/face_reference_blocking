// Modo manual: operaciones sobre la lista de puntos (colocar, mover, saltar,
// deshacer, cambiar de vista). Funciones puras: devuelven un estado nuevo.

import { MANUAL_POINTS, type ManualView } from '../geom/manualFit';
import type { Vec2 } from '../geom/vec';

export interface ManualState {
  view: ManualView;
  points: Readonly<Record<string, Vec2>>;
  /** Puntos que no se ven en la foto (el usuario los saltó). */
  skipped: Readonly<Record<string, boolean>>;
  /** Orden en que se colocaron, para deshacer. */
  order: readonly string[];
  /** Punto que se coloca con el siguiente clic (null = ninguno pendiente). */
  next: string | null;
}

export function startManual(view: ManualView): ManualState {
  return { view, points: {}, skipped: {}, order: [], next: MANUAL_POINTS[view][0] };
}

/** Siguiente punto sin colocar ni saltar, en el orden de la lista y a partir de `after`. */
export function nextPending(view: ManualView, points: ManualState['points'], skipped: ManualState['skipped'], after: string | null = null): string | null {
  const list = MANUAL_POINTS[view];
  const start = after ? list.indexOf(after) + 1 : 0;
  for (let k = 0; k < list.length; k++) {
    const id = list[(start + k) % list.length];
    if (!points[id] && !skipped[id]) return id;
  }
  return null;
}

/** Coloca el punto pendiente en `p` y pasa al siguiente. */
export function placeManual(m: ManualState, p: Vec2): ManualState {
  const id = m.next;
  if (!id) return m;
  const points = { ...m.points, [id]: p };
  const skipped = { ...m.skipped };
  delete skipped[id];
  return { ...m, points, skipped, order: [...m.order.filter((x) => x !== id), id], next: nextPending(m.view, points, skipped, id) };
}

export function moveManual(m: ManualState, id: string, p: Vec2): ManualState {
  return { ...m, points: { ...m.points, [id]: p } };
}

export function skipManual(m: ManualState): ManualState {
  if (!m.next) return m;
  const skipped = { ...m.skipped, [m.next]: true };
  const points = { ...m.points };
  delete points[m.next];
  return { ...m, points, skipped, order: m.order.filter((x) => x !== m.next), next: nextPending(m.view, points, skipped, m.next) };
}

/** Quita el último punto colocado y lo deja pendiente. */
export function undoManual(m: ManualState): ManualState {
  const last = m.order[m.order.length - 1];
  if (!last) return m;
  const points = { ...m.points };
  delete points[last];
  return { ...m, points, order: m.order.slice(0, -1), next: last };
}

/** El siguiente clic coloca (o vuelve a colocar) este punto; null deja de colocar. */
export function chooseManual(m: ManualState, id: string | null): ManualState {
  return { ...m, next: id };
}

/** Cambia de vista: los puntos que comparten las dos listas se conservan. */
export function setManualView(m: ManualState, view: ManualView): ManualState {
  if (view === m.view) return m;
  const keep = new Set(MANUAL_POINTS[view]);
  const points = Object.fromEntries(Object.entries(m.points).filter(([id]) => keep.has(id)));
  const skipped = Object.fromEntries(Object.entries(m.skipped).filter(([id]) => keep.has(id)));
  return { view, points, skipped, order: m.order.filter((id) => keep.has(id)), next: nextPending(view, points, skipped) };
}

export function placedCount(m: ManualState): number {
  return MANUAL_POINTS[m.view].filter((id) => m.points[id]).length;
}
