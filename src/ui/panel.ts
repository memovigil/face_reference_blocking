// Panel derecho: estado de la detección, pasos, tarjeta del paso y diagnóstico.

import { lightFrom, lightSpread, anglesFromLight } from '../geom/light';
import { BLOCK_LEVELS } from '../geom/planes';
import { VALUE_PALETTE } from '../values/posterize';
import type { KeyGroup } from '../detect/keypoints';
import type { ExpressionId } from '../geom/expression';
import { buildMeasures } from '../geom/measures';
import { METRICS, mostDistinctive, type MetricGroup, type MetricValue } from '../geom/metrics';
import { ZERO_POSE } from '../geom/pose';
import { degStr, es, pct } from '../i18n/es';
import { derive, type Derived } from '../state/derived';
import type { AppState, StepId, Store } from '../state/store';
import { h } from './dom';
import { estimateTag, keyLabel } from './labels';

export const STEP_ORDER: readonly StepId[] = ['R', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

/** Diferencia mínima (en desviaciones típicas) para presentar un rasgo como distintivo. */
const DISTINCTIVE_Z = 1;

export interface PanelActions {
  resetDetection(): void;
  focusKey(id: string): void;
}

/** Reemplaza el contenido conservando el foco del teclado (por data-fid). */
function replaceKeepingFocus(el: HTMLElement, children: (HTMLElement | null)[]) {
  const active = document.activeElement as HTMLElement | null;
  const fid = active && el.contains(active) ? active.dataset.fid : undefined;
  el.replaceChildren(...children.filter((c): c is HTMLElement => !!c));
  if (fid) el.querySelector<HTMLElement>(`[data-fid="${fid}"]`)?.focus();
}

export function buildPanel(host: HTMLElement, store: Store, actions: PanelActions): void {
  const statusEl = h('section', { 'class': 'card status-card', 'aria-live': 'polite' });
  const stepsEl = h('nav', { 'class': 'steps', 'aria-label': 'Pasos' });
  const stepCard = h('section', { class: 'card step-card' });
  const diagCard = h('section', { 'class': 'card diag-card', 'aria-label': es.diagnosis.title });
  host.append(statusEl, stepsEl, stepCard, diagCard);

  // --- Pasos (botones persistentes)
  const stepBtns = new Map<StepId, HTMLButtonElement>();
  for (const id of STEP_ORDER) {
    const def = es.stepDefs[id];
    const b = h(
      'button',
      { type: 'button', class: 'step-btn', title: def.title },
      h('span', { class: 'step-letter' }, id === 'R' ? '✓' : id),
      h('span', { class: 'step-name' }, def.title),
    );
    b.addEventListener('click', () => store.set({ step: id }));
    stepBtns.set(id, b);
    stepsEl.append(b);
  }

  // --- Ajuste fino de pose (controles persistentes)
  const poseSliders = (['yaw', 'pitch', 'roll'] as const).map((k) => {
    const input = h('input', { 'type': 'range', 'min': -10, 'max': 10, 'step': 0.5, 'value': 0, 'aria-label': `${es.pose.fine}: ${es.pose[k]}` });
    const out = h('output', { class: 'mono' }, '0°');
    input.addEventListener('input', () => {
      store.set((s) => ({ poseAdjust: { ...s.poseAdjust, [k]: Number(input.value) } }));
    });
    return { k, input, out, row: h('label', { class: 'slider-row' }, h('span', {}, es.pose[k]), input, out) };
  });
  const poseReset = h('button', { type: 'button', class: 'btn small' }, es.pose.reset);
  poseReset.addEventListener('click', () => store.set({ poseAdjust: ZERO_POSE }));
  const poseFine = h(
    'details',
    { class: 'pose-fine' },
    h('summary', {}, es.pose.fine),
    h('p', { class: 'hint' }, es.pose.fineHelp),
    ...poseSliders.map((p) => p.row),
    poseReset,
  );

  let cardSig = '';
  let diagSig = '';
  let chipSig = '';
  const chipsHost = h('div', { class: 'key-groups' });

  const render = (s: AppState) => {
    const d = derive(s);
    renderStatus(statusEl, s, d, store);
    for (const [id, b] of stepBtns) {
      if (id === s.step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    }
    const sig = `${s.step}|${s.status}|${stepSignature(s, d)}`;
    if (sig !== cardSig) {
      cardSig = sig;
      chipSig = '';
      renderStepCard(stepCard, s, d, chipsHost, poseFine, actions, store);
    }
    if (d) liveUpdate(stepCard, s, d);
    if (s.step === 'R' && d) {
      const csig = d.keypoints.map((k) => `${k.def.id}:${k.visible ? 1 : 0}${k.estimated ? 1 : 0}${k.caveat ?? ''}`).join(',') + `|${s.selectedKey}`;
      if (csig !== chipSig) {
        chipSig = csig;
        renderChips(chipsHost, s, d, actions);
      }
    }
    const dsig = d ? d.metrics.map((m) => `${m.def.id}${m.value.toFixed(3)}${m.reliable ? 1 : 0}${m.note ?? ''}`).join('|') : '';
    if (dsig !== diagSig) {
      diagSig = dsig;
      renderDiagnosis(diagCard, d);
    }
    for (const p of poseSliders) {
      if (document.activeElement !== p.input) p.input.value = String(s.poseAdjust[p.k]);
      const v = s.poseAdjust[p.k];
      p.out.textContent = `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`;
    }
  };
  store.subscribe(render);
  render(store.get());
}

/** Lo que cambia el contenido de la tarjeta del paso (para no redibujar de más). */
function stepSignature(s: AppState, d: Derived | null): string {
  if (!d) return 'none';
  switch (s.step) {
    case 'A':
      return `${s.envelopeSides}|${d.envelope.source}|${d.envelope.negative.length}`;
    case 'B':
      return `${d.loomis.sphere.radius.toFixed(1)}|${d.loomis.sphere.rms.toFixed(1)}|${d.jaw?.angle.toFixed(0) ?? ''}|${d.expression.flags.lipsO}`;
    case 'C':
      return buildMeasures(s.landmarks!, d).items.map((i) => i.text).join('|') + JSON.stringify(s.checkedMeasures);
    case 'D':
      // Sin el grosor de línea: redibujar la tarjeta cortaría el arrastre del deslizador.
      return `${s.blockLevel}|${s.blockNames}|${s.photoOpacity > 0}|${d.blocking?.faces.length ?? 0}|${d.blocking?.faces.filter((f) => f.front).length ?? 0}`;
    case 'E':
      // Los deslizadores (luz, terminador) no redibujan la tarjeta: sus textos se
      // actualizan en su lugar (liveUpdate).
      return `${s.blockLevel}|${s.compareLight}|${!!d.lightDir}|${d.light?.confident}`;
    case 'F':
    case 'G':
    case 'H':
      return `${s.valueStraight}|${!!d.lightDir}`;
    case 'I':
      return mostDistinctive(d.metrics).map((m) => m.def.id).join(',');
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Estado

function renderStatus(el: HTMLElement, s: AppState, d: Derived | null, store: Store) {
  const rows: (HTMLElement | null)[] = [];
  const statusText = es.status[s.status];
  rows.push(
    h(
      'div',
      { class: `status-line status-${s.status}` },
      h('span', { 'class': 'dot', 'aria-hidden': 'true' }),
      h('strong', {}, statusText),
      s.detection ? h('span', { class: 'muted mono' }, ` · ${es.detection.points(s.detection.landmarks.length)} · ${es.detection.time(s.detection.ms)}`) : null,
    ),
  );
  if (s.status === 'no-face') rows.push(h('p', { class: 'hint' }, es.noFaceBody));
  if (s.status === 'error' && s.error) rows.push(h('p', { class: 'hint error' }, s.error));
  if (d && s.detection) {
    const a = d.pose.angles;
    const edited = s.landmarks !== s.detection.landmarks;
    rows.push(
      h(
        'dl',
        { class: 'pose-grid' },
        ...(['yaw', 'pitch', 'roll'] as const).flatMap((k) => [
          h('dt', {}, es.pose[k]),
          h('dd', {}, h('span', { class: 'mono big' }, degStr(a[k])), h('span', { class: 'muted' }, ` ${es.pose[`${k}Hint`](a[k])}`)),
        ]),
      ),
    );
    const signOk = d.pose.sign.consistent;
    rows.push(
      h(
        'p',
        { class: `check ${signOk ? 'ok' : 'warn'}` },
        h('span', { 'aria-hidden': 'true' }, signOk ? '✓ ' : '⚠ '),
        signOk ? es.pose.signOk : es.pose.signBad,
        edited ? h('span', { class: 'muted' }, ` · ${es.detection.edited}`) : null,
      ),
    );
    const angleText = (x: { yaw: number; pitch: number; roll: number }) =>
      `${es.pose.yaw} ${degStr(x.yaw)} · ${es.pose.pitch} ${degStr(x.pitch)} · ${es.pose.roll} ${degStr(x.roll)}`;
    rows.push(
      h(
        'details',
        { class: 'tech-details' },
        h('summary', {}, es.pose.details),
        h('p', { class: 'hint' }, es.pose.source),
        h('p', { class: 'hint' }, `${es.pose.mesh3D}: ${angleText(d.pose.mesh3DAngles)}`),
        d.pose.matrixAngles ? h('p', { class: 'hint' }, `${es.pose.matrix}: ${angleText(d.pose.matrixAngles)}`) : null,
        d.pose.agreement !== null ? h('p', { class: 'hint' }, es.pose.agreement(d.pose.agreement)) : null,
        h('p', { class: 'hint' }, es.pose.fitError(d.pose.frame.rms)),
        h('p', { class: 'hint mono' }, es.pose.engine(s.detection.delegate, s.detection.ms)),
      ),
    );
    rows.push(h('div', { class: 'status-row' }, h('span', { class: 'label' }, es.detection.expression), expressionChips(s, d, store)));
    const segText = s.segStatus === 'running' ? es.seg.running : s.segStatus === 'done' ? es.seg.done : s.segStatus === 'unavailable' ? es.seg.unavailable : '';
    if (segText) rows.push(h('div', { class: 'status-row' }, h('span', { class: 'label' }, es.seg.label), h('span', { class: 'muted' }, segText)));
    rows.push(h('div', { class: 'status-row' }, h('span', { class: 'label' }, es.detection.light), h('span', { class: 'muted' }, lightLine(s, d))));
  }
  replaceKeepingFocus(el, rows);
}

function expressionChips(s: AppState, d: Derived, store: Store): HTMLElement {
  const ids: ExpressionId[] = ['jawOpen', 'smile', 'eyesClosed', 'pucker'];
  const shown = ids.filter((k) => d.expression.detected[k]);
  if (!shown.length) return h('span', { class: 'muted' }, es.detection.neutral);
  return h(
    'span',
    { class: 'expr-list' },
    ...shown.map((k) => {
      const ignored = !!s.ignoreExpressions[k];
      const btn = h('button', { 'type': 'button', 'class': 'btn small', 'data-fid': `expr-${k}`, 'aria-pressed': String(ignored) }, ignored ? es.expressions.use : es.expressions.ignore);
      btn.addEventListener('click', () => store.set((st) => ({ ignoreExpressions: { ...st.ignoreExpressions, [k]: !st.ignoreExpressions[k] } })));
      const extra = k === 'jawOpen' && !ignored ? (d.jaw ? es.expressions.jawClosed(d.jaw.angle) : d.expression.flags.lipsO ? es.expressions.lipsO : '') : '';
      return h(
        'span',
        { class: `tag expr${ignored ? ' ignored' : ''}` },
        `${es.expressions[k]} · ${pct(d.expression.level[k])}`,
        ignored ? h('span', { class: 'muted' }, ` (${es.expressions.ignored})`) : null,
        extra ? h('span', { class: 'muted' }, ` · ${extra}`) : null,
        ' ',
        btn,
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Tarjeta del paso

function renderStepCard(
  el: HTMLElement,
  s: AppState,
  d: Derived | null,
  chipsHost: HTMLElement,
  poseFine: HTMLElement,
  actions: PanelActions,
  store: Store,
) {
  const def = es.stepDefs[s.step];
  const children: (HTMLElement | null)[] = [
    h('header', { class: 'step-head' }, h('span', { class: 'step-letter big' }, s.step === 'R' ? '✓' : s.step), h('h2', {}, def.title)),
    h('h3', {}, es.steps.whatToDo),
    h('p', {}, def.what),
    h('h3', {}, es.steps.commonError),
    h('p', { class: 'common-error' }, def.error),
  ];
  if (!d && s.step !== 'R') {
    children.push(h('p', { class: 'hint' }, es.steps.needsFace));
  } else if (s.step === 'R') {
    children.push(
      h('h3', {}, es.steps.legend),
      legend([['sw-point', es.legend.point], ['sw-est', es.legend.estimated], ['sw-sel', es.legend.selected], ['sw-mesh', es.legend.mesh]]),
      h('p', { class: 'hint' }, es.review.dragHint),
      d ? chipsHost : null,
      d ? h('p', { class: 'hint' }, es.review.estimatedHelp) : null,
      d ? poseFine : null,
      d ? h('button', { type: 'button', class: 'btn', onclick: () => actions.resetDetection() }, es.review.resetDetection) : null,
    );
  } else if (d && s.step === 'A') {
    const seg = h('div', { 'class': 'seg-group', 'role': 'group', 'aria-label': es.envelope.sides });
    for (const n of [7, 8, 9]) {
      const b = h('button', { 'type': 'button', 'class': 'seg', 'data-fid': `sides-${n}`, 'aria-pressed': String(s.envelopeSides === n) }, String(n));
      b.addEventListener('click', () => store.set({ envelopeSides: n }));
      seg.append(b);
    }
    children.push(
      h('h3', {}, es.steps.legend),
      legend([['sw-env', es.legend.envelope], ['sw-plumb', es.legend.plumb], ['sw-neg', es.legend.negative]]),
      h('div', { class: 'control-row' }, h('span', {}, es.envelope.sides), seg),
      h('p', { class: 'hint' }, d.envelope.source === 'silhouette' ? es.envelope.fromSilhouette : es.envelope.fromPoints),
      h('p', { class: 'hint' }, es.envelope.negative(d.envelope.negative.length)),
    );
  } else if (d && s.step === 'B') {
    const third = d.loomis.levels.brow - d.loomis.levels.nose;
    children.push(
      h('h3', {}, es.steps.legend),
      legend([
        ['sw-struct', es.legend.structure],
        ['sw-hidden', es.legend.hidden],
        ['sw-canon', es.legend.canon],
        ...(d.jaw ? ([['sw-open', es.legend.jawOpen]] as [string, string][]) : []),
      ]),
      h('p', { class: 'hint' }, es.loomis.sphere(d.loomis.sphere.radius / third, d.loomis.sphere.rms)),
      h('p', { class: 'hint' }, es.loomis.rings),
      h('p', { class: 'hint' }, es.loomis.canonNote),
    );
  } else if (d && s.step === 'C') {
    const m = buildMeasures(s.landmarks!, d);
    const list = h('ul', { class: 'measure-list' });
    for (const it of m.items) {
      const checked = !!s.checkedMeasures[it.id];
      const box = h('input', { 'type': 'checkbox', 'data-fid': `ms-${it.id}`, 'checked': checked, 'aria-label': es.measures.checked });
      box.addEventListener('change', () => store.set((st) => ({ checkedMeasures: { ...st.checkedMeasures, [it.id]: box.checked } })));
      list.append(h('li', { class: checked ? 'done' : '' }, h('label', {}, box, h('span', {}, it.text))));
    }
    children.push(
      h('h3', {}, es.steps.legend),
      legend([['sw-measure', es.legend.measures], ['sw-level', es.legend.levels]]),
      h('h3', {}, es.measures.title),
      h('p', { class: 'hint' }, es.measures.help),
      list,
    );
  } else if (d && s.step === 'D') {
    const b = d.blocking;
    const seg = h('div', { 'class': 'seg-group', 'role': 'group', 'aria-label': es.blocking.level });
    for (const lv of BLOCK_LEVELS) {
      const btn = h('button', { 'type': 'button', 'class': 'seg', 'data-fid': `level-${lv}`, 'aria-pressed': String(s.blockLevel === lv) }, es.blocking.levels[lv]);
      btn.addEventListener('click', () => store.set({ blockLevel: lv }));
      seg.append(btn);
    }
    const photoBtn = h('button', { 'type': 'button', 'class': 'btn', 'data-fid': 'bk-photo', 'aria-pressed': String(s.photoOpacity > 0) }, s.photoOpacity > 0 ? es.blocking.hidePhoto : es.blocking.showPhoto);
    photoBtn.addEventListener('click', () => store.set((st) => ({ photoOpacity: st.photoOpacity > 0 ? 0 : 1 })));
    const width = h('input', { 'type': 'range', 'min': 0.5, 'max': 2.5, 'step': 0.25, 'value': s.blockLineWidth, 'data-fid': 'bk-width', 'aria-label': es.blocking.lineWidth });
    width.addEventListener('input', () => store.set({ blockLineWidth: Number(width.value) }));
    const names = h('input', { 'type': 'checkbox', 'data-fid': 'bk-names', 'checked': s.blockNames });
    names.addEventListener('change', () => store.set({ blockNames: names.checked }));
    children.push(
      h('h3', {}, es.steps.legend),
      legend([['sw-bk-contour', es.legend.blockContour], ['sw-bk-hard', es.legend.blockHard], ['sw-bk-accent', es.legend.blockAccent]]),
      h('div', { class: 'control-row' }, h('span', {}, es.blocking.level), seg),
      h('p', { class: 'hint' }, es.blocking.levelHelp[s.blockLevel]),
      h('div', { class: 'control-row' }, h('span', {}, es.blocking.lineWidth), width),
      h('div', { class: 'control-row' }, h('span', {}, es.blocking.photo), photoBtn),
      h('label', { class: 'control-row' }, names, h('span', {}, es.blocking.names)),
      h('p', { class: 'hint' }, es.blocking.how),
      b ? h('p', { class: 'hint' }, es.blocking.stats(b.faces.length, b.faces.filter((f) => f.front).length, b.ms)) : null,
    );
  } else if (d && s.step === 'E') {
    const seg = h('div', { 'class': 'seg-group', 'role': 'group', 'aria-label': es.blocking.level });
    for (const lv of BLOCK_LEVELS) {
      const btn = h('button', { 'type': 'button', 'class': 'seg', 'data-fid': `level-${lv}`, 'aria-pressed': String(s.blockLevel === lv) }, es.blocking.levels[lv]);
      btn.addEventListener('click', () => store.set({ blockLevel: lv }));
      seg.append(btn);
    }
    const compare = h('input', { 'type': 'checkbox', 'data-fid': 'lp-compare', 'checked': s.compareLight });
    compare.addEventListener('change', () => store.set({ compareLight: compare.checked, viewMode: compare.checked ? 'side' : 'overlay' }));
    children.push(
      h('h3', {}, es.steps.legend),
      legend([
        ['sw-lp-light', es.light.legend.light],
        ['sw-lp-half', es.light.legend.half],
        ['sw-lp-shadow', es.light.legend.shadow],
      ]),
      h('p', { class: 'hint' }, es.light.planesHint),
      lightControls(s, d, store),
      terminatorRow(s, store),
      h('div', { class: 'control-row' }, h('span', {}, es.blocking.level), seg),
      h('label', { class: 'control-row' }, compare, h('span', {}, es.light.compare)),
      s.compareLight ? h('p', { class: 'hint' }, es.light.compareHint) : null,
    );
  } else if (d && (s.step === 'F' || s.step === 'G' || s.step === 'H')) {
    const levels = ({ F: 2, G: 3, H: 5 } as const)[s.step];
    const blur = h('input', { 'type': 'range', 'min': 0, 'max': 0.2, 'step': 0.01, 'value': s.valueBlur, 'data-fid': 'val-blur', 'aria-label': es.light.blur });
    blur.addEventListener('input', () => store.set({ valueBlur: Number(blur.value) }));
    const straight = h('input', { 'type': 'checkbox', 'data-fid': 'val-straight', 'checked': s.valueStraight });
    straight.addEventListener('change', () => store.set({ valueStraight: straight.checked }));
    children.push(
      h('h3', {}, es.steps.legend),
      h('ul', { class: 'legend' }, ...VALUE_PALETTE[levels].map((c, i) => h('li', {}, h('span', { 'class': 'swatch sw-value', 'style': `background:${c}`, 'aria-hidden': 'true' }), es.light.values[levels][i]))),
      h('p', { class: 'hint' }, es.light.valuesHint),
      terminatorRow(s, store),
      h('div', { class: 'control-row' }, h('span', {}, es.light.blur), blur),
      h('label', { class: 'control-row' }, straight, h('span', {}, es.light.straight)),
      d.lightDir ? h('p', { 'class': 'hint', 'data-live': 'light-hint' }, '') : null,
    );
  } else if (d && s.step === 'I') {
    const top = mostDistinctive(d.metrics).filter((v) => Math.abs(v.z) >= DISTINCTIVE_Z);
    const side = h('button', { 'type': 'button', 'class': 'btn', 'data-fid': 'side' }, es.compare.sideBySide);
    side.addEventListener('click', () => store.set({ viewMode: 'side' }));
    children.push(
      h('h3', {}, es.compare.title),
      h('ol', { class: 'compare-list' }, ...es.compare.order.map((t) => h('li', {}, t))),
      top.length ? h('p', {}, es.compare.distinctive) : null,
      top.length ? h('ul', { class: 'compare-list' }, ...top.map((v) => h('li', {}, describe(v)))) : null,
      side,
    );
  }
  replaceKeepingFocus(el, children);
}

/** Texto de la luz para la tarjeta de estado y los pasos de valores. */
function lightLine(s: AppState, d: Derived): string {
  if (s.lightOverride) return `${es.light.summary(lightFrom(s.lightOverride.theta), lightSpread(s.lightOverride.phi))} (${es.light.manual})`;
  if (!d.light) return d.lightDir === null && ['E', 'F', 'G', 'H', 'I'].includes(s.step) ? es.light.none : es.detection.lightPending;
  const t = es.light.summary(lightFrom(d.light.theta), lightSpread(d.light.phi));
  return d.light.confident ? t : `${t} · ${es.light.diffuse}`;
}

function terminatorRow(s: AppState, store: Store): HTMLElement {
  const input = h('input', { 'type': 'range', 'min': -1, 'max': 1, 'step': 0.05, 'value': s.terminator, 'data-fid': 'terminator', 'aria-label': es.light.terminator });
  input.addEventListener('input', () => store.set({ terminator: Number(input.value) }));
  return h(
    'div',
    { class: 'control-row terminator-row' },
    h('span', {}, es.light.terminator),
    h('div', { class: 'range-ends' }, input, h('span', { class: 'muted small' }, es.light.lessShadow), h('span', { class: 'muted small end' }, es.light.moreShadow)),
  );
}

/** Gizmo de la luz (esfera iluminada con flecha) y deslizadores para elegirla a mano. */
function lightControls(s: AppState, d: Derived, store: Store): HTMLElement {
  const L = d.lightDir;
  const ang = s.lightOverride ?? (L ? anglesFromLight(L) : { theta: 45, phi: 45 });
  const wrap = h('div', { class: 'light-ctl' });
  wrap.append(lightGizmo(L, ang));
  const info = h('div', { class: 'light-info' });
  info.append(h('p', {}, h('strong', {}, es.light.title), ' ', h('span', { 'data-live': 'light-summary' }, '')));
  info.append(h('p', { 'class': 'muted small', 'data-live': 'light-source' }, ''));
  if (d.light && !d.light.confident) info.append(h('p', { 'class': 'hint warn', 'data-live': 'light-diffuse' }, es.light.diffuse));
  const theta = h('input', { 'type': 'range', 'min': 0, 'max': 355, 'step': 5, 'value': Math.round(ang.theta / 5) * 5, 'data-fid': 'light-theta', 'aria-label': es.light.theta });
  const phi = h('input', { 'type': 'range', 'min': 0, 'max': 120, 'step': 5, 'value': Math.round(ang.phi / 5) * 5, 'data-fid': 'light-phi', 'aria-label': es.light.phi });
  const set = () => store.set({ lightOverride: { theta: Number(theta.value), phi: Number(phi.value) } });
  theta.addEventListener('input', set);
  phi.addEventListener('input', set);
  info.append(h('div', { class: 'control-row' }, h('span', {}, es.light.theta), theta), h('div', { class: 'control-row' }, h('span', {}, es.light.phi), phi));
  const reset = h('button', { 'type': 'button', 'class': 'btn', 'data-fid': 'light-reset', 'data-live': 'light-reset' }, es.light.usePhoto);
  reset.addEventListener('click', () => store.set({ lightOverride: null }));
  info.append(reset);
  wrap.append(info);
  return wrap;
}

/**
 * Lo que cambia con los deslizadores, sin redibujar la tarjeta: texto de la
 * luz, gizmo, botón «Usar la luz de la foto» y valores de los deslizadores si
 * la luz cambió por otro lado.
 */
function liveUpdate(card: HTMLElement, s: AppState, d: Derived) {
  const L = d.lightDir;
  const ang = s.lightOverride ?? (L ? anglesFromLight(L) : null);
  const text = (sel: string, t: string) => {
    const el = card.querySelector<HTMLElement>(`[data-live="${sel}"]`);
    if (el && el.textContent !== t) el.textContent = t;
  };
  text('light-summary', ang && L ? es.light.summary(lightFrom(ang.theta), lightSpread(ang.phi)) : es.light.none);
  text('light-source', s.lightOverride ? es.light.manual : d.light ? `${es.light.fromPhoto}. ${es.light.fit(d.light.r2, d.light.used.length)}` : '');
  text('light-hint', `${es.light.title}: ${lightLine(s, d)}.`);
  const diffuse = card.querySelector<HTMLElement>('[data-live="light-diffuse"]');
  if (diffuse) diffuse.hidden = !!s.lightOverride;
  const reset = card.querySelector<HTMLButtonElement>('[data-live="light-reset"]');
  if (reset) reset.hidden = !s.lightOverride;
  const giz = card.querySelector('.light-gizmo');
  const key = `${ang?.theta.toFixed(0)}|${ang?.phi.toFixed(0)}|${!!L}`;
  if (giz && giz.getAttribute('data-key') !== key && ang) {
    const next = lightGizmo(L, ang);
    next.setAttribute('data-key', key);
    giz.replaceWith(next);
  }
  // Si la luz vuelve a la de la foto, los deslizadores la siguen (sin tocar el que se arrastra).
  if (ang) {
    for (const [fid, v] of [['light-theta', ang.theta], ['light-phi', ang.phi]] as const) {
      const input = card.querySelector<HTMLInputElement>(`[data-fid="${fid}"]`);
      if (input && document.activeElement !== input) input.value = String(Math.round(v / 5) * 5);
    }
  }
}

function lightGizmo(L: Derived['lightDir'], ang: { theta: number; phi: number }): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent.append(e);
    return e;
  };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('class', 'light-gizmo');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', es.light.gizmo(lightFrom(ang.theta), lightSpread(ang.phi)));
  const defs = el('defs', {}, svg);
  const lx = L ? L.x : 0;
  const ly = L ? L.y : 0;
  const grad = el('radialGradient', { id: 'lg-sphere', cx: 0.5 + lx * 0.32, cy: 0.5 - ly * 0.32, r: 0.75 }, defs);
  el('stop', { 'offset': 0, 'stop-color': '#f6f7f4' }, grad);
  el('stop', { 'offset': 0.55, 'stop-color': '#8f9497' }, grad);
  el('stop', { 'offset': 1, 'stop-color': '#2b2f32' }, grad);
  el('circle', { cx: 40, cy: 40, r: 21, fill: 'url(#lg-sphere)', stroke: 'currentColor', 'stroke-width': 1 }, svg);
  if (L) {
    const l = Math.hypot(lx, ly);
    if (l > 0.08) {
      const ux = lx / l;
      const uy = -ly / l;
      // Flecha desde la luz hacia la esfera.
      el('line', { 'x1': 40 + ux * 34, 'y1': 40 + uy * 34, 'x2': 40 + ux * 25, 'y2': 40 + uy * 25, 'stroke': 'var(--measure)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }, svg);
      el('circle', { cx: 40 + ux * 34, cy: 40 + uy * 34, r: 3, fill: 'var(--measure)' }, svg);
      const px = -uy;
      const py = ux;
      const tip = { x: 40 + ux * 22, y: 40 + uy * 22 };
      el('path', { d: `M${tip.x} ${tip.y}L${tip.x + ux * 6 + px * 4} ${tip.y + uy * 6 + py * 4}L${tip.x + ux * 6 - px * 4} ${tip.y + uy * 6 - py * 4}Z`, fill: 'var(--measure)' }, svg);
    } else el('circle', { cx: 40, cy: 40, r: 3, fill: 'var(--measure)' }, svg);
  }
  return svg;
}

function legend(items: [string, string][]): HTMLElement {
  return h('ul', { class: 'legend' }, ...items.map(([cls, text]) => h('li', {}, h('span', { 'class': `swatch ${cls}`, 'aria-hidden': 'true' }), text)));
}

function renderChips(host: HTMLElement, s: AppState, d: Derived, actions: PanelActions) {
  const groups = new Map<KeyGroup, HTMLElement[]>();
  for (const kp of d.keypoints) {
    const label = keyLabel(kp, d.keypoints);
    const b = h(
      'button',
      {
        'type': 'button',
        'class': `chip key-chip${kp.estimated ? ' est' : ''}${kp.visible ? '' : ' hidden-pose'}`,
        'aria-pressed': String(s.selectedKey === kp.def.id),
        'title': kp.visible ? label : `${label} · ${es.review.hidden}`,
      },
      label,
      kp.estimated ? h('span', { class: 'chip-tag' }, estimateTag(kp)) : null,
    );
    b.addEventListener('click', () => actions.focusKey(kp.def.id));
    if (!kp.visible) b.disabled = true;
    const g = groups.get(kp.def.group) ?? [];
    g.push(b);
    groups.set(kp.def.group, g);
  }
  const order: KeyGroup[] = ['midline', 'eyes', 'brows', 'nose', 'mouth', 'contour', 'skull'];
  host.replaceChildren(
    ...order
      .filter((g) => groups.has(g))
      .map((g) => h('div', { class: 'key-group' }, h('h4', {}, es.review.groups[g]), h('div', { class: 'chips' }, ...groups.get(g)!))),
  );
}

// ---------------------------------------------------------------------------
// Diagnóstico

/** Valor formateado y diferencia contra el canon. */
export function formatMetric(v: MetricValue): { value: string; diff: string } {
  const { def } = v;
  if (def.unit === 'deg') {
    const dd = v.value - def.canon;
    return { value: `${v.value.toFixed(1)}°`, diff: `${dd >= 0 ? '+' : '−'}${Math.abs(dd).toFixed(1)}°` };
  }
  const value = v.value.toFixed(2);
  // Con canon cerca de 0, la diferencia va en distancias entre pupilas.
  if (Math.abs(def.canon) < 0.1) {
    const dd = v.value - def.canon;
    return { value, diff: `${dd >= 0 ? '+' : '−'}${Math.abs(dd).toFixed(2)} ${es.measures.unitShort}` };
  }
  const rel = (v.value - def.canon) / Math.abs(def.canon);
  return { value, diff: `${rel >= 0 ? '+' : '−'}${Math.abs(Math.round(rel * 100))} %` };
}

export function describe(v: MetricValue): string {
  const t = es.metrics[v.def.id];
  return `${v.z >= 0 ? t.more : t.less} (${formatMetric(v).diff})`;
}

function bar(v: MetricValue): HTMLElement {
  const z = Math.max(-3, Math.min(3, v.z));
  const pos = 50 + (z / 3) * 50;
  return h(
    'span',
    { 'class': `zbar${v.reliable ? '' : ' unreliable'}`, 'role': 'img', 'aria-label': `${es.metrics[v.def.id].label}: ${formatMetric(v).diff}` },
    h('span', { class: 'zbar-canon' }),
    h('span', { class: 'zbar-mark', style: `left:${pos}%` }),
  );
}

function renderDiagnosis(el: HTMLElement, d: Derived | null) {
  if (!d) {
    el.replaceChildren();
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const top = mostDistinctive(d.metrics).filter((v) => Math.abs(v.z) >= DISTINCTIVE_Z);
  const children: (HTMLElement | null)[] = [h('h2', {}, es.diagnosis.title)];
  if (top.length) {
    children.push(
      h(
        'ol',
        { class: 'distinctive' },
        ...top.map((v) => h('li', {}, h('strong', {}, es.metrics[v.def.id].label), h('span', {}, ` — ${describe(v)}`), bar(v))),
      ),
      h('p', { class: 'respect' }, es.diagnosis.respect),
    );
  } else {
    children.push(h('p', {}, es.diagnosis.nothing));
  }
  const groups: MetricGroup[] = ['thirds', 'heights', 'widths', 'angles'];
  const all = h('details', { class: 'all-metrics' }, h('summary', {}, es.diagnosis.all));
  for (const g of groups) {
    const items = d.metrics.filter((m) => m.def.group === g);
    if (!items.length) continue;
    all.append(
      h('h4', {}, es.diagnosis.groups[g]),
      h(
        'ul',
        { class: 'metric-list' },
        ...items.map((v) => {
          const f = formatMetric(v);
          return h(
            'li',
            { class: v.reliable ? '' : 'unreliable' },
            h('span', { class: 'm-label' }, es.metrics[v.def.id].label),
            h('span', { class: 'm-value mono' }, `${f.value} (${f.diff})`),
            bar(v),
            !v.reliable || v.note ? h('span', { class: 'm-note' }, v.note ? es.diagnosis.notes[v.note] : '') : null,
            h('span', { class: 'm-source' }, `${es.diagnosis.canonLabel}: ${METRICS[v.def.id].unit === 'deg' ? `${v.def.canon.toFixed(1)}°` : v.def.canon.toFixed(2)} · ${es.diagnosis.sources[v.def.source]}`),
          );
        }),
      ),
    );
  }
  all.append(h('p', { class: 'hint' }, es.diagnosis.canonNote));
  children.push(all);
  el.replaceChildren(...children.filter((c): c is HTMLElement => !!c));
}

