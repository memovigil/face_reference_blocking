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
import { segmentImage } from './detect/segment';
import { dragLandmarks, KEY_BY_ID, type ExtraId } from './detect/keypoints';
import { fitManual, MANUAL_POINTS, manualKey, type ManualView } from './geom/manualFit';
import { LayerRenderer, STEP_LAYERS } from './draw/layers';
import { ZERO_POSE } from './geom/pose';
import { v2, type Mat3, type Vec2, type Vec3 } from './geom/vec';
import { es } from './i18n/es';
import { loadImageFile, loadImageUrl, workImageFromCanvas, type WorkImage } from './image/load';
import { renderSample, sampleFacePoints, type SampleOptions, type SampleRender } from './sample/render';
import { valueCanvas, type ValueMap } from './values/posterize';
import { derive } from './state/derived';
import { chooseManual, moveManual, placeManual, startManual } from './state/manual';
import { clearProject, loadProject, projectChanged, saveProject } from './state/persist';
import { createStore, initialState, loadPrefs, savePrefs, type AppState, type LayerId } from './state/store';
import { h } from './ui/dom';
import { buildPanel, STEP_ORDER } from './ui/panel';
import { buildExportDialog } from './ui/exportDialog';
import { buildShortcutsDialog } from './ui/shortcuts';
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

const exporter = buildExportDialog(store);
const shortcuts = buildShortcutsDialog();
const header = h(
  'header',
  { class: 'app-header' },
  h('div', { class: 'brand' }, h('h1', {}, es.appTitle), h('span', { class: 'subtitle' }, es.appSubtitle)),
  h('div', { class: 'header-actions' }, themeSelect, shortcuts.button, exporter.button, uploadBtn, fileInput),
);
/** Aviso para lectores de pantalla al cambiar de paso. */
const stepAnnounce = h('div', { 'class': 'sr-only', 'aria-live': 'polite' });

const toolbarHost = h('div', { 'class': 'toolbar', 'role': 'toolbar', 'aria-label': 'Lienzo' });
const stageHost = h('div', { class: 'stage-host' });
const emptyUpload = h('button', { type: 'button', class: 'btn primary' }, es.upload);
emptyUpload.addEventListener('click', () => fileInput.click());
const sampleBtn = h('button', { type: 'button', class: 'btn' }, es.sample);
sampleBtn.addEventListener('click', () => void openSample());
const emptyState = h(
  'div',
  { class: 'empty-state' },
  h('h2', {}, es.emptyTitle),
  h('p', {}, es.emptyBody),
  h('div', { class: 'empty-actions' }, emptyUpload, sampleBtn),
  h('p', { class: 'hint' }, es.uploadHint),
  h('p', { class: 'hint' }, es.sampleHint),
);
const busy = h('div', { 'class': 'busy', 'hidden': true, 'role': 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { class: 'busy-text' }));
const dropHint = h('div', { class: 'drop-hint', hidden: true }, es.dropHere);
stageHost.append(emptyState, busy, dropHint);

const canvasCol = h('section', { 'class': 'canvas-col', 'aria-label': es.a11y.canvas }, toolbarHost, stageHost);
const panelHost = h('aside', { class: 'panel' });
const workspace = h('main', { class: 'workspace' }, canvasCol, panelHost);
document.querySelector('#app')!.append(header, workspace, stepAnnounce);

const viewer = new Viewer(stageHost);
const layers = new LayerRenderer(viewer.layers);
buildToolbar(toolbarHost, store, viewer);
buildPanel(panelHost, store, {
  enterManual,
  exitManual,
  closePhoto,
  placeAtCenter() {
    const s = store.get();
    const id = s.manual?.next;
    if (!s.manual || !id) return;
    store.set({ manual: placeManual(s.manual, viewer.center()), selectedKey: `m:${id}` });
  },
  selectKey(id) {
    store.set({ selectedKey: id });
  },
  focusPoint(p) {
    viewer.focus(p, 3);
  },
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
    const d = derive(s);
    layers.render(s, d);
    // Paso E, «Comparar con la foto»: el panel de referencia muestra la foto en 3 valores.
    const compare = s.step === 'E' && s.compareLight && d?.values ? d.values.map : null;
    if (compare !== refMap) {
      refMap = compare;
      viewer.setRefImage(compare ? valueCanvas(compare) : null, es.light.compareLabel);
    }
  });
}
let refMap: ValueMap | null = null;

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
  viewer.setPlacing(!!s.manual?.next && s.tool === 'select');
  if (s.manual !== prev.manual && s.manual) applyManual(s);
  if (projectChanged(s, prev)) scheduleSave();
  if (s.step !== prev.step || s.image !== prev.image) {
    const def = es.stepDefs[s.step];
    viewer.describe(s.image ? es.a11y.stepCanvas(s.step === 'R' ? 'R' : s.step, def.title) : es.a11y.canvas);
    if (s.step !== prev.step) stepAnnounce.textContent = es.a11y.stepNow(s.step, def.title);
  }
  if (s.theme !== prev.theme) applyTheme(s.theme);
  emptyState.hidden = !!s.image;
  const working = s.status === 'rendering-sample' || s.status === 'loading-model' || s.status === 'detecting';
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
  // Cada paso enciende sus capas al entrar; el usuario puede cambiarlas después.
  // Va al final: no debe impedir el resto de las actualizaciones de este cambio.
  if (s.step !== prev.step && STEP_LAYERS[s.step]) store.set({ layers: { ...s.layers, ...STEP_LAYERS[s.step] } });
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
    autoDetection: null,
    manual: null,
    restored: false,
    landmarks: null,
    extrasPlaced: {},
    poseAdjust: ZERO_POSE,
    segmentation: null,
    segStatus: 'idle',
    ignoreExpressions: {},
    checkedMeasures: {},
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
    // La segmentación sirve igual en modo manual (silueta con cabello).
    store.set({ status: 'no-face', segStatus: 'running' });
    await runSegmentation(img, seq);
    return;
  }
  store.set({ status: 'ready', detection: det, autoDetection: det, landmarks: det.landmarks, segStatus: 'running' });
  frameHead();
  // La segmentación (silueta con cabello) llega después, sin bloquear la revisión.
  await runSegmentation(img, seq);
}

async function runSegmentation(img: WorkImage, seq: number): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  const seg = await segmentImage(img.canvas);
  if (seq !== loadSeq) return;
  store.set({ segmentation: seg, segStatus: seg ? 'done' : 'unavailable' });
}

// ------------------------------------------------------------------ proyecto guardado (IndexedDB)
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveProject(store.get()), 700);
}

/** Al abrir: la última foto con su detección, sus puntos y los ajustes de cada paso. */
async function restoreProject(): Promise<void> {
  const saved = await loadProject();
  if (!saved || store.get().image) return;
  const seq = ++loadSeq;
  let img: WorkImage;
  try {
    img = { ...(await loadImageFile(saved.photo.blob, saved.photo.name)), id: saved.photo.id };
  } catch {
    return;
  }
  if (seq !== loadSeq) return;
  const { project: p } = saved;
  const det = p.detection;
  store.set({
    image: img,
    detection: det,
    autoDetection: p.autoDetection,
    landmarks: p.landmarks ?? det?.landmarks ?? null,
    extrasPlaced: p.extrasPlaced,
    poseAdjust: p.poseAdjust,
    ignoreExpressions: p.ignoreExpressions,
    envelopeSides: p.envelopeSides,
    checkedMeasures: p.checkedMeasures,
    blockLevel: p.blockLevel,
    blockLineWidth: p.blockLineWidth,
    blockNames: p.blockNames,
    valueBlur: p.valueBlur,
    terminator: p.terminator,
    valueStraight: p.valueStraight,
    lightOverride: p.lightOverride,
    compareLight: p.compareLight,
    step: p.step,
    manual: null,
    segmentation: null,
    segStatus: 'running',
    selectedKey: null,
    error: null,
    status: det ? 'ready' : 'no-face',
    restored: true,
  });
  // El modo manual reconstruye la malla con sus puntos (applyManual).
  if (p.manual) store.set({ manual: p.manual });
  frameHead();
  await runSegmentation(img, seq);
}

/** Quita la foto y borra lo guardado en este navegador. */
function closePhoto() {
  ++loadSeq;
  clearTimeout(saveTimer);
  store.set({
    image: null,
    detection: null,
    autoDetection: null,
    manual: null,
    landmarks: null,
    extrasPlaced: {},
    poseAdjust: ZERO_POSE,
    segmentation: null,
    segStatus: 'idle',
    ignoreExpressions: {},
    checkedMeasures: {},
    selectedKey: null,
    step: 'R',
    status: 'empty',
    error: null,
    restored: false,
  });
  void clearProject();
}

// ------------------------------------------------------------------ modo manual (§5.5)
const EAR_EXTRAS: readonly ExtraId[] = ['earTopR', 'earLobeR', 'earTopL', 'earLobeL'];
/** Rotación del último ajuste: arranque extra para que la malla no salte al arrastrar. */
let manualRotation: Mat3 | undefined;

/** Vista inicial: de la pose detectada si la hay; si no, perfil (lo que el detector suele no encontrar). */
function guessView(s: AppState): ManualView {
  const d = s.detection ? derive(s) : null;
  if (!d) return 'profile';
  const yaw = Math.abs(d.pose.angles.yaw);
  return yaw < 18 ? 'front' : yaw < 55 ? 'threeQuarter' : 'profile';
}

function enterManual() {
  const s = store.get();
  if (!s.image) return;
  manualRotation = undefined;
  store.set({ manual: startManual(guessView(s)), step: 'R', selectedKey: null, poseAdjust: ZERO_POSE });
}

function exitManual() {
  const s = store.get();
  const det = s.autoDetection;
  store.set({ manual: null, detection: det, landmarks: det?.landmarks ?? null, status: det ? 'ready' : 'no-face', poseAdjust: ZERO_POSE, selectedKey: null });
}

/** La malla canónica deformada por los puntos marcados hace de detección. */
function applyManual(s: AppState) {
  const m = s.manual!;
  const f = fitManual(m.view, m.points, manualRotation);
  manualRotation = f?.frame.rotation;
  // Las orejas cercanas de la lista (¾ y perfil) son los puntos de oreja confirmados.
  const extrasPlaced = { ...s.extrasPlaced };
  if (m.view !== 'front') for (const id of EAR_EXTRAS) delete extrasPlaced[id];
  if (f) {
    for (const id of MANUAL_POINTS[m.view]) {
      const p = m.points[id];
      const extra = manualKey(id, f.facing).extra;
      if (p && extra) extrasPlaced[extra] = p;
    }
  }
  store.set({
    landmarks: f?.landmarks ?? null,
    detection: f ? { landmarks: f.landmarks, blendshapes: {}, matrix: null, ms: 0, delegate: s.autoDetection?.delegate ?? 'CPU', manual: { rms: f.rms, facing: f.facing } } : null,
    status: f ? 'ready' : 'manual',
    extrasPlaced,
  });
}

viewer.onTap = (p) => {
  const s = store.get();
  if (!s.manual?.next || s.tool !== 'select' || !s.image) return;
  if (p.x < 0 || p.y < 0 || p.x > s.image.width || p.y > s.image.height) return;
  store.set({ manual: placeManual(s.manual, p) });
};

/** Muestra de ejemplo: cabeza 3D generada en la app (sin foto de una persona real). */
let lastSample: SampleRender | null = null;
async function openSample(opts?: SampleOptions): Promise<void> {
  await openImage(async () => {
    store.set({ status: 'rendering-sample' });
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    lastSample = renderSample(opts);
    return workImageFromCanvas(lastSample.canvas, es.sampleName);
  });
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
/** Arrastre de un punto del modo manual (ids «m:…»). */
let manualDrag: { id: string; offset: Vec2 } | null = null;

viewer.handles = {
  down(id, p) {
    const s = store.get();
    if (id.startsWith('m:')) {
      const q = s.manual?.points[id.slice(2)];
      if (q) manualDrag = { id: id.slice(2), offset: v2(q.x - p.x, q.y - p.y) };
      return;
    }
    const d = derive(s);
    const kp = d?.keypoints.find((k) => k.def.id === id);
    if (!d || !kp || !s.landmarks) return;
    dragBase = { landmarks: s.landmarks, offset: v2(kp.p.x - p.x, kp.p.y - p.y), sigma: Math.max(4, d.ipd * 0.22) };
    store.set({ selectedKey: id });
  },
  move(id, p, e) {
    if (manualDrag) {
      const target = v2(p.x + manualDrag.offset.x, p.y + manualDrag.offset.y);
      const mid = manualDrag.id;
      store.set((s) => ({ manual: s.manual ? moveManual(s.manual, mid, target) : null }));
      viewer.showLoupe(target, v2(e.clientX, e.clientY));
      return;
    }
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
    manualDrag = null;
    viewer.hideLoupe();
  },
};

// ------------------------------------------------------------------ atajos
const LAYER_BY_KEY: Record<string, LayerId> = { '1': 'envelope', '2': 'structure', '3': 'measures', '4': 'points', '5': 'indices', '6': 'values' };

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Mueve con el teclado el punto elegido (clave o del modo manual), en px de la imagen. */
function nudge(id: string, dx: number, dy: number): boolean {
  const s = store.get();
  if (id.startsWith('m:')) {
    const mid = id.slice(2);
    const p = s.manual?.points[mid];
    if (!s.manual || !p) return false;
    store.set({ manual: moveManual(s.manual, mid, v2(p.x + dx, p.y + dy)) });
    return true;
  }
  const def = KEY_BY_ID.get(id);
  const d = derive(s);
  const kp = d?.keypoints.find((k) => k.def.id === id);
  if (!def || !d || !kp || !s.landmarks) return false;
  const target = v2(kp.p.x + dx, kp.p.y + dy);
  if (def.landmark !== undefined && !s.manual) store.set({ landmarks: dragLandmarks(s.landmarks, def.landmark, target, Math.max(4, d.ipd * 0.22)) });
  else if (def.extra) {
    const extra = def.extra;
    store.set((st) => ({ extrasPlaced: { ...st.extrasPlaced, [extra]: target } }));
  } else return false;
  return true;
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = store.get();
  if (ARROWS[e.key]) {
    // Las flechas son del control enfocado (deslizadores, selector…).
    if (isControl(e)) return;
    const [ax, ay] = ARROWS[e.key];
    // Con un punto elegido, las flechas lo mueven; con Mayús, de 10 en 10.
    if (s.selectedKey && nudge(s.selectedKey, ax * (e.shiftKey ? 10 : 1), ay * (e.shiftKey ? 10 : 1))) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey) {
      viewer.panBy(ax * 0.15, ay * 0.15);
      e.preventDefault();
      return;
    }
    if (!ax) return;
    const i = STEP_ORDER.indexOf(s.step);
    const next = STEP_ORDER[Math.max(0, Math.min(STEP_ORDER.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
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
    if (s.manual?.next) store.set({ manual: chooseManual(s.manual, null) });
    else store.set({ selectedKey: null });
  } else if (e.key === '?') {
    shortcuts.open();
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
      openSample(opts?: SampleOptions): Promise<void>;
      /** Verdad conocida de la última muestra: pose y vértices de la cara en px de la imagen de trabajo. */
      sampleTruth(): { pose: SampleRender['pose']; points: Vec3[]; frame: SampleRender['frame'] } | null;
      synthRotate(yaw: number, pitch?: number): Promise<string>;
    };
  }
}
window.__encaje = {
  store,
  viewer,
  derive,
  openUrl: (url) => openImage(() => loadImageUrl(url)),
  openSample,
  sampleTruth() {
    const s = store.get();
    if (!lastSample || !s.image) return null;
    // La imagen de trabajo puede estar reducida respecto del render.
    const k = s.image.width / lastSample.canvas.width;
    const f = lastSample.frame;
    const frame = { rotation: f.rotation, scale: f.scale * k, translation: { x: f.translation.x * k, y: f.translation.y * k, z: f.translation.z * k } };
    return { pose: lastSample.pose, points: sampleFacePoints(frame), frame };
  },
  async synthRotate(yaw, pitch = 0) {
    const s = store.get();
    if (!s.image || !s.detection) throw new Error('sin detección');
    const { canvas: c, rotated } = renderRotatedFace(s.image.canvas, s.detection.landmarks, yaw, pitch);
    (window as unknown as { __lastSynth: unknown }).__lastSynth = { yaw, pitch, rotated };
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    return URL.createObjectURL(blob);
  },
};

void restoreProject();
