// Barra del lienzo: zoom, Ajustar, Mano, Superpuesta / Lado a lado, opacidad
// de líneas y de la foto, y capas.

import { es } from '../i18n/es';
import type { LayerId, Store } from '../state/store';
import { h } from './dom';
import { ZOOM_MAX, ZOOM_MIN, type Viewer } from './viewer';

const LAYER_IDS: readonly LayerId[] = ['envelope', 'structure', 'measures', 'points', 'indices'];

export function buildToolbar(host: HTMLElement, store: Store, viewer: Viewer): void {
  const zoomRange = h('input', {
    'type': 'range',
    'min': ZOOM_MIN * 100,
    'max': ZOOM_MAX * 100,
    'step': 10,
    'value': 100,
    'aria-label': es.toolbar.zoom,
    'class': 'zoom-range',
  });
  const zoomOut = h('button', { 'class': 'icon-btn', 'type': 'button', 'aria-label': es.toolbar.zoomOut, 'title': es.toolbar.zoomOut }, '−');
  const zoomIn = h('button', { 'class': 'icon-btn', 'type': 'button', 'aria-label': es.toolbar.zoomIn, 'title': es.toolbar.zoomIn }, '+');
  const zoomLabel = h('output', { class: 'zoom-label mono' }, '100 %');
  const fit = h('button', { type: 'button', class: 'btn', title: `${es.toolbar.fit} (F)` }, es.toolbar.fit);
  const hand = h('button', { 'type': 'button', 'class': 'btn toggle', 'aria-pressed': 'false', 'title': `${es.toolbar.hand} (H, o espacio + arrastrar)` }, es.toolbar.hand);

  const modeOverlay = h('button', { 'type': 'button', 'class': 'seg', 'aria-pressed': 'true' }, es.toolbar.overlay);
  const modeSide = h('button', { 'type': 'button', 'class': 'seg', 'aria-pressed': 'false' }, es.toolbar.side);

  const lineRange = h('input', { 'type': 'range', 'min': 0, 'max': 100, 'step': 5, 'aria-label': es.toolbar.lineOpacity });
  const photoRange = h('input', { 'type': 'range', 'min': 0, 'max': 100, 'step': 5, 'aria-label': es.toolbar.photoOpacity });

  const layerBtns = new Map<LayerId, HTMLButtonElement>();
  const layerGroup = h('div', { 'class': 'chips', 'role': 'group', 'aria-label': es.toolbar.layers });
  for (const id of LAYER_IDS) {
    const b = h(
      'button',
      { 'type': 'button', 'class': 'chip toggle', 'aria-pressed': 'false', 'title': `${es.layers[id]} (${es.layerKeys[id]})` },
      es.layers[id],
    );
    b.addEventListener('click', () => store.set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })));
    layerBtns.set(id, b);
    layerGroup.append(b);
  }

  host.append(
    h('div', { class: 'tb-group' }, zoomOut, zoomRange, zoomIn, zoomLabel, fit, hand),
    h('div', { 'class': 'tb-group seg-group', 'role': 'group' }, modeOverlay, modeSide),
    h(
      'div',
      { class: 'tb-group' },
      h('label', { class: 'mini-range' }, h('span', {}, es.toolbar.lineOpacity), lineRange),
      h('label', { class: 'mini-range' }, h('span', {}, es.toolbar.photoOpacity), photoRange),
    ),
    h('div', { class: 'tb-group' }, h('span', { class: 'tb-label' }, es.toolbar.layers), layerGroup),
  );

  zoomRange.addEventListener('input', () => viewer.setZoom(Number(zoomRange.value) / 100));
  zoomOut.addEventListener('click', () => viewer.setZoom(viewer.view.zoom / 1.25));
  zoomIn.addEventListener('click', () => viewer.setZoom(viewer.view.zoom * 1.25));
  fit.addEventListener('click', () => viewer.fit());
  hand.addEventListener('click', () => store.set((s) => ({ tool: s.tool === 'hand' ? 'select' : 'hand' })));
  modeOverlay.addEventListener('click', () => store.set({ viewMode: 'overlay' }));
  modeSide.addEventListener('click', () => store.set({ viewMode: 'side' }));
  lineRange.addEventListener('input', () => store.set({ lineOpacity: Number(lineRange.value) / 100 }));
  photoRange.addEventListener('input', () => store.set({ photoOpacity: Number(photoRange.value) / 100 }));

  viewer.onView = (v) => {
    const pctZoom = Math.round(v.zoom * 100);
    zoomLabel.textContent = `${pctZoom} %`;
    if (document.activeElement !== zoomRange) zoomRange.value = String(pctZoom);
  };

  const sync = () => {
    const s = store.get();
    hand.setAttribute('aria-pressed', String(s.tool === 'hand'));
    modeOverlay.setAttribute('aria-pressed', String(s.viewMode === 'overlay'));
    modeSide.setAttribute('aria-pressed', String(s.viewMode === 'side'));
    lineRange.value = String(Math.round(s.lineOpacity * 100));
    photoRange.value = String(Math.round(s.photoOpacity * 100));
    for (const [id, b] of layerBtns) b.setAttribute('aria-pressed', String(s.layers[id]));
  };
  store.subscribe(sync);
  sync();
}
