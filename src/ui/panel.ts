// Panel derecho: estado de la detección, pasos, tarjeta del paso y controles.

import type { KeyGroup } from '../detect/keypoints';
import { ZERO_POSE } from '../geom/pose';
import { degStr, es, pct } from '../i18n/es';
import { derive, type Derived } from '../state/derived';
import type { AppState, StepId, Store } from '../state/store';
import { h } from './dom';
import { keyLabel } from './labels';

export const STEP_ORDER: readonly StepId[] = ['R', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
/** Fase en la que se construyó la app actual (los pasos de fases futuras se ven desactivados). */
export const CURRENT_PHASE = 1;

export function stepEnabled(id: StepId): boolean {
  return es.stepDefs[id].phase <= CURRENT_PHASE;
}

export interface PanelActions {
  resetDetection(): void;
  focusKey(id: string): void;
}

export function buildPanel(host: HTMLElement, store: Store, actions: PanelActions): void {
  const statusEl = h('section', { 'class': 'card status-card', 'aria-live': 'polite' });
  const stepsEl = h('nav', { 'class': 'steps', 'aria-label': 'Pasos' });
  const stepCard = h('section', { class: 'card step-card' });
  host.append(statusEl, stepsEl, stepCard);

  // --- Pasos (botones persistentes)
  const stepBtns = new Map<StepId, HTMLButtonElement>();
  for (const id of STEP_ORDER) {
    const def = es.stepDefs[id];
    const enabled = stepEnabled(id);
    const b = h(
      'button',
      {
        'type': 'button',
        'class': 'step-btn',
        'disabled': !enabled,
        'title': enabled ? def.title : `${def.title} · ${es.steps.comingIn(def.phase)}`,
      },
      h('span', { class: 'step-letter' }, id === 'R' ? '✓' : id),
      h('span', { class: 'step-name' }, def.title),
      !enabled ? h('span', { class: 'step-phase' }, `F${def.phase}`) : null,
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

  let lastStep: StepId | null = null;
  let chipSig = '';
  const chipsHost = h('div', { class: 'key-groups' });

  const render = (s: AppState, prev?: AppState) => {
    const d = derive(s);
    renderStatus(statusEl, s, d);
    for (const [id, b] of stepBtns) {
      if (id === s.step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    }
    if (s.step !== lastStep || s.status !== prev?.status) {
      lastStep = s.step;
      chipSig = '';
      renderStepCard(stepCard, s, d, chipsHost, poseFine, actions);
    }
    if (s.step === 'R' && d) {
      const sig = d.keypoints.map((k) => `${k.def.id}:${k.visible ? 1 : 0}${k.estimated ? 1 : 0}`).join(',') + `|${s.selectedKey}`;
      if (sig !== chipSig) {
        chipSig = sig;
        renderChips(chipsHost, s, d, actions);
      }
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

function renderStatus(el: HTMLElement, s: AppState, d: Derived | null) {
  const rows: (HTMLElement | null)[] = [];
  const statusText = es.status[s.status];
  rows.push(
    h(
      'div',
      { class: `status-line status-${s.status}` },
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
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
    rows.push(h('div', { class: 'status-row' }, h('span', { class: 'label' }, es.detection.expression), expressionChips(s.detection.blendshapes)));
    rows.push(h('div', { class: 'status-row' }, h('span', { class: 'label' }, es.detection.light), h('span', { class: 'muted' }, es.detection.lightPending)));
  }
  el.replaceChildren(...rows.filter((r): r is HTMLElement => !!r));
}

function expressionChips(b: Record<string, number>): HTMLElement {
  const items: string[] = [];
  const jaw = b.jawOpen ?? 0;
  const smile = ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2;
  const bl = b.eyeBlinkLeft ?? 0; // ojo izquierdo del sujeto = derecha de la foto
  const br = b.eyeBlinkRight ?? 0;
  if (jaw > 0.3) items.push(`${es.expressions.jawOpen} · ${pct(jaw)}`);
  if (smile > 0.4) items.push(`${es.expressions.smile} · ${pct(smile)}`);
  if (bl > 0.5 && br > 0.5) items.push(`${es.expressions.blinkBoth} · ${pct((bl + br) / 2)}`);
  else if (bl > 0.5) items.push(`${es.expressions.blinkRight} · ${pct(bl)}`);
  else if (br > 0.5) items.push(`${es.expressions.blinkLeft} · ${pct(br)}`);
  if (!items.length) return h('span', { class: 'muted' }, es.detection.neutral);
  return h('span', { class: 'tags' }, ...items.map((t) => h('span', { class: 'tag' }, t)));
}

function renderStepCard(
  el: HTMLElement,
  s: AppState,
  d: Derived | null,
  chipsHost: HTMLElement,
  poseFine: HTMLElement,
  actions: PanelActions,
) {
  const def = es.stepDefs[s.step];
  const children: (HTMLElement | null)[] = [
    h('header', { class: 'step-head' }, h('span', { class: 'step-letter big' }, s.step === 'R' ? '✓' : s.step), h('h2', {}, def.title)),
    h('h3', {}, es.steps.whatToDo),
    h('p', {}, def.what),
    h('h3', {}, es.steps.commonError),
    h('p', { class: 'common-error' }, def.error),
  ];
  if (s.step === 'R') {
    children.push(
      h('h3', {}, es.steps.legend),
      legend(),
      h('p', { class: 'hint' }, es.review.dragHint),
      d ? chipsHost : null,
      d ? h('p', { class: 'hint' }, es.review.estimatedHelp) : null,
      d ? poseFine : null,
      d ? h('button', { type: 'button', class: 'btn', onclick: () => actions.resetDetection() }, es.review.resetDetection) : null,
    );
  } else if (!stepEnabled(s.step)) {
    children.push(h('p', { class: 'hint' }, es.steps.comingIn(def.phase)));
  }
  el.replaceChildren(...children.filter((c): c is HTMLElement => !!c));
}

function legend(): HTMLElement {
  const item = (cls: string, text: string) => h('li', {}, h('span', { 'class': `swatch ${cls}`, 'aria-hidden': 'true' }), text);
  return h(
    'ul',
    { class: 'legend' },
    item('sw-point', es.legend.point),
    item('sw-est', es.legend.estimated),
    item('sw-sel', es.legend.selected),
    item('sw-mesh', es.legend.mesh),
  );
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
      kp.estimated ? h('span', { class: 'chip-tag' }, es.review.estimated) : null,
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
