import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';

import { renderRotatedFace } from './debug/synthRotate';
import { detectFace, getLandmarker } from './detect/faceLandmarker';
import { dragLandmarks, KEY_BY_ID } from './detect/keypoints';
import { LayerRenderer } from './draw/layers';
import { ZERO_POSE } from './geom/pose';
import { v2, type Vec2, type Vec3 } from './geom/vec';
import { es } from './i18n/es';
import { loadImageFile, loadImageUrl, type WorkImage } from './image/load';
import { derive } from './state/derived';
import { createStore, initialState, loadPrefs, savePrefs, type AppState, type LayerId } from './state/store';
import { h } from './ui/dom';
import { buildPanel, STEP_ORDER, stepEnabled } from './ui/panel';
import { buildToolbar } from './ui/toolbar';
import { isControl, isTyping, Viewer } from './ui/viewer';

const store = createStore({ ...initialState, ...loadPrefs() });

// ------------------------------------------------------------------ layout
const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
const uploadBtn = h('button', { type: 'button', class: 'btn primary' }, es.upload);
uploadBtn.addEventListener('click', () => fileInput.click());

const themeSelect = h(
  'select',
  { 'aria-label': es.toolbar.theme, 'class': 'theme-select' },
  ...(['auto', 'light', 'dark'] as const).map((t) => h('option', { value: t }, es.toolbar.themes[t])),
);
themeSelect.addEventListener('change', () => store.set({ theme: themeSelect.value as AppState['theme'] }));

const header = h(
  'header',
  { class: 'app-header' },
  h('div', { class: 'brand' }, h('h1', {}, es.appTitle), h('span', { class: 'subtitle' }, es.appSubtitle)),
  h('div', { class: 'header-actions' }, themeSelect, uploadBtn, fileInput),
);

const toolbarHost = h('div', { 'class': 'toolbar', 'role': 'toolbar', 'aria-label': 'Lienzo' });
const stageHost = h('div', { class: 'stage-host' });
const emptyUpload = h('button', { type: 'button', class: 'btn primary' }, es.upload);
emptyUpload.addEventListener('click', () => fileInput.click());
const emptyState = h(
  'div',
  { class: 'empty-state' },
  h('h2', {}, es.emptyTitle),
  h('p', {}, es.emptyBody),
  emptyUpload,
  h('p', { class: 'hint' }, es.uploadHint),
);
const busy = h('div', { 'class': 'busy', 'hidden': true, 'role': 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { class: 'busy-text' }));
const dropHint = h('div', { class: 'drop-hint', hidden: true }, es.dropHere);
stageHost.append(emptyState, busy, dropHint);

const canvasCol = h('section', { 'class': 'canvas-col', 'aria-label': es.a11y.canvas }, toolbarHost, stageHost);
const panelHost = h('aside', { class: 'panel' });
const workspace = h('main', { class: 'workspace' }, canvasCol, panelHost);
document.querySelector('#app')!.append(header, workspace);

const viewer = new Viewer(stageHost);
const layers = new LayerRenderer(viewer.layers);
buildToolbar(toolbarHost, store, viewer);
buildPanel(panelHost, store, {
  resetDetection() {
    const s = store.get();
    if (!s.detection) return;
    store.set({ landmarks: s.detection.landmarks, extrasPlaced: {}, poseAdjust: ZERO_POSE, selectedKey: null });
  },
  focusKey(id) {
    const d = derive(store.get());
    const kp = d?.keypoints.find((k) => k.def.id === id);
    if (!kp) return;
    store.set({ selectedKey: id, layers: { ...store.get().layers, points: true } });
    viewer.focus(kp.p, 3);
  },
});

// ------------------------------------------------------------------ render
let layerRaf = 0;
function scheduleLayers() {
  if (layerRaf) return;
  layerRaf = requestAnimationFrame(() => {
    layerRaf = 0;
    const s = store.get();
    layers.render(s, derive(s));
  });
}

function applyTheme(t: AppState['theme']) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  themeSelect.value = t;
}

store.subscribe((s, prev) => {
  if (s.image !== prev.image) viewer.setImage(s.image?.canvas ?? null);
  if (s.viewMode !== prev.viewMode) viewer.setMode(s.viewMode);
  if (s.photoOpacity !== prev.photoOpacity) viewer.setPhotoOpacity(s.photoOpacity);
  if (s.tool !== prev.tool) viewer.setHandTool(s.tool === 'hand');
  if (s.theme !== prev.theme) applyTheme(s.theme);
  emptyState.hidden = !!s.image;
  const working = s.status === 'loading-model' || s.status === 'detecting';
  busy.hidden = !working;
  busy.querySelector('.busy-text')!.textContent = es.status[s.status];
  scheduleLayers();
  if (
    s.layers !== prev.layers ||
    s.lineOpacity !== prev.lineOpacity ||
    s.photoOpacity !== prev.photoOpacity ||
    s.viewMode !== prev.viewMode ||
    s.theme !== prev.theme
  ) {
    savePrefs(s);
  }
});

{
  const s = store.get();
  viewer.setMode(s.viewMode);
  viewer.setPhotoOpacity(s.photoOpacity);
  applyTheme(s.theme);
}

// ------------------------------------------------------------------ carga y detección
let loadSeq = 0;

async function openImage(get: () => Promise<WorkImage>): Promise<void> {
  const seq = ++loadSeq;
  let img: WorkImage;
  try {
    img = await get();
  } catch (err) {
    console.error(err);
    store.set({ status: 'error', error: es.loadError });
    return;
  }
  if (seq !== loadSeq) return;
  store.set({
    image: img,
    detection: null,
    landmarks: null,
    extrasPlaced: {},
    poseAdjust: ZERO_POSE,
    selectedKey: null,
    step: 'R',
    status: 'loading-model',
    error: null,
  });
  try {
    await getLandmarker();
  } catch (err) {
    console.error(err);
    if (seq === loadSeq) store.set({ status: 'error', error: es.modelError });
    return;
  }
  if (seq !== loadSeq) return;
  store.set({ status: 'detecting' });
  // Deja pintar el estado antes de bloquear el hilo con la detección.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const det = await detectFace(img.canvas);
  if (seq !== loadSeq) return;
  if (!det) {
    store.set({ status: 'no-face' });
    return;
  }
  store.set({ status: 'ready', detection: det, landmarks: det.landmarks });
  frameHead();
}

/** Encuadra la cabeza (malla + puntos estimados) si ocupa poco de la foto. */
function frameHead() {
  const s = store.get();
  const d = derive(s);
  if (!d || !s.image) return;
  const pts = d.keypoints.filter((k) => k.visible).map((k) => k.p);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  if (r.w < s.image.width * 0.55 && r.h < s.image.height * 0.55) viewer.frame(r, 0.18);
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void openImage(() => loadImageFile(f, f.name));
  fileInput.value = '';
});

canvasCol.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  dropHint.hidden = false;
});
canvasCol.addEventListener('dragleave', (e) => {
  if (e.target === canvasCol || !canvasCol.contains(e.relatedTarget as Node)) dropHint.hidden = true;
});
canvasCol.addEventListener('drop', (e) => {
  e.preventDefault();
  dropHint.hidden = true;
  const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) void openImage(() => loadImageFile(f, f.name));
});

// ------------------------------------------------------------------ arrastre de puntos
let dragBase: { landmarks: Vec3[]; offset: Vec2; sigma: number } | null = null;

viewer.handles = {
  down(id, p) {
    const s = store.get();
    const d = derive(s);
    const kp = d?.keypoints.find((k) => k.def.id === id);
    if (!d || !kp || !s.landmarks) return;
    dragBase = { landmarks: s.landmarks, offset: v2(kp.p.x - p.x, kp.p.y - p.y), sigma: Math.max(4, d.ipd * 0.22) };
    store.set({ selectedKey: id });
  },
  move(id, p, e) {
    if (!dragBase) return;
    const def = KEY_BY_ID.get(id);
    if (!def) return;
    const target = v2(p.x + dragBase.offset.x, p.y + dragBase.offset.y);
    if (def.landmark !== undefined) {
      store.set({ landmarks: dragLandmarks(dragBase.landmarks, def.landmark, target, dragBase.sigma) });
    } else if (def.extra) {
      const extra = def.extra;
      store.set((s) => ({ extrasPlaced: { ...s.extrasPlaced, [extra]: target } }));
    }
    viewer.showLoupe(target, v2(e.clientX, e.clientY));
  },
  up() {
    dragBase = null;
    viewer.hideLoupe();
  },
};

// ------------------------------------------------------------------ atajos
const LAYER_BY_KEY: Record<string, LayerId> = { '1': 'envelope', '2': 'structure', '3': 'measures', '4': 'points', '5': 'indices' };

window.addEventListener('keydown', (e) => {
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = store.get();
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    // Las flechas son del control enfocado (deslizadores, selector…).
    if (isControl(e)) return;
    const enabled = STEP_ORDER.filter(stepEnabled);
    const i = enabled.indexOf(s.step);
    const next = enabled[Math.max(0, Math.min(enabled.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
    if (next && next !== s.step) store.set({ step: next });
    e.preventDefault();
  } else if (LAYER_BY_KEY[e.key]) {
    const id = LAYER_BY_KEY[e.key];
    store.set({ layers: { ...s.layers, [id]: !s.layers[id] } });
  } else if (e.key === 'h' || e.key === 'H') {
    store.set({ tool: s.tool === 'hand' ? 'select' : 'hand' });
  } else if (e.key === 'f' || e.key === 'F') {
    viewer.fit();
  } else if (e.key === '+' || e.key === '=') {
    viewer.setZoom(viewer.view.zoom * 1.25);
  } else if (e.key === '-') {
    viewer.setZoom(viewer.view.zoom / 1.25);
  } else if (e.key === 'Escape') {
    store.set({ selectedKey: null });
  }
});

// ------------------------------------------------------------------ ganchos para pruebas
declare global {
  interface Window {
    __encaje: {
      store: typeof store;
      viewer: Viewer;
      derive: typeof derive;
      openUrl(url: string): Promise<void>;
      synthRotate(yaw: number, pitch?: number): Promise<string>;
    };
  }
}
window.__encaje = {
  store,
  viewer,
  derive,
  openUrl: (url) => openImage(() => loadImageUrl(url)),
  async synthRotate(yaw, pitch = 0) {
    const s = store.get();
    if (!s.image || !s.detection) throw new Error('sin detección');
    const { canvas: c, rotated } = renderRotatedFace(s.image.canvas, s.detection.landmarks, yaw, pitch);
    (window as unknown as { __lastSynth: unknown }).__lastSynth = { yaw, pitch, rotated };
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    return URL.createObjectURL(blob);
  },
};
