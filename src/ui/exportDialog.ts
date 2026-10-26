// Diálogo «Exportar»: el paso actual como PNG (con o sin foto, con cuadrícula
// para pasar el dibujo) y un PDF con todos los pasos y el diagnóstico.

import { exportSize } from '../export/overlay';
import { baseName, exportPdf, exportStepPng } from '../export/report';
import { es } from '../i18n/es';
import { derive } from '../state/derived';
import type { Store } from '../state/store';
import { h } from './dom';

const GRID_SIZES = [3, 4, 5, 6, 8];

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function buildExportDialog(store: Store): { button: HTMLButtonElement; open(): void } {
  const photo = h('input', { 'type': 'checkbox', 'checked': true, 'data-fid': 'exp-photo' });
  const grid = h('input', { 'type': 'checkbox', 'data-fid': 'exp-grid' });
  const gridN = h('select', { 'aria-label': es.export.gridSize, 'data-fid': 'exp-grid-n' }, ...GRID_SIZES.map((n) => h('option', { value: n, selected: n === 4 }, `${n} × ${n}`)));
  const size = h('p', { class: 'hint' });
  const status = h('p', { 'class': 'hint export-status', 'role': 'status', 'aria-live': 'polite' });
  const pngBtn = h('button', { 'type': 'button', 'class': 'btn primary', 'data-fid': 'exp-png' }, es.export.png);
  const pdfBtn = h('button', { 'type': 'button', 'class': 'btn primary', 'data-fid': 'exp-pdf' }, es.export.pdf);
  const close = h('button', { 'type': 'button', 'class': 'btn', 'data-fid': 'exp-close' }, es.export.close);
  const dialog = h(
    'dialog',
    { 'class': 'export-dialog', 'aria-labelledby': 'export-title' },
    h('h2', { id: 'export-title' }, es.export.title),
    h('section', {}, h('h3', {}, es.export.pngTitle), size, h('label', { class: 'check-row' }, photo, h('span', {}, es.export.withPhoto)), h('div', { class: 'check-row' }, h('label', { class: 'check-row' }, grid, h('span', {}, es.export.grid)), gridN), h('div', { class: 'btn-row' }, pngBtn)),
    h('section', {}, h('h3', {}, es.export.pdfTitle), h('p', { class: 'hint' }, es.export.pdfHelp), h('div', { class: 'btn-row' }, pdfBtn)),
    status,
    h('div', { class: 'btn-row end' }, close),
  );
  document.body.append(dialog);
  close.addEventListener('click', () => dialog.close());
  grid.addEventListener('change', () => (gridN.disabled = !grid.checked));
  gridN.disabled = true;

  let busy = false;
  const setBusy = (on: boolean) => {
    busy = on;
    pngBtn.disabled = on;
    pdfBtn.disabled = on;
  };
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      status.textContent = es.export.done;
    } catch (err) {
      console.error(err);
      status.textContent = es.export.failed;
    } finally {
      setBusy(false);
    }
  };
  pngBtn.addEventListener('click', () =>
    run(async () => {
      const s = store.get();
      status.textContent = es.export.working(1, 1);
      const blob = await exportStepPng(s, { photo: photo.checked, grid: grid.checked ? Number(gridN.value) : null });
      download(blob, `${baseName(s)}-paso-${s.step}.png`);
    }),
  );
  pdfBtn.addEventListener('click', () =>
    run(async () => {
      const s = store.get();
      const blob = await exportPdf(s, (k, n) => (status.textContent = es.export.working(k, n)));
      download(blob, `${baseName(s)}-encaje.pdf`);
    }),
  );

  const button = h('button', { 'type': 'button', 'class': 'btn', 'data-fid': 'export-open' }, es.export.button);
  const open = () => {
    const s = store.get();
    const ok = !!s.image && !!derive(s);
    pngBtn.disabled = !ok || busy;
    pdfBtn.disabled = !ok || busy;
    photo.checked = s.photoOpacity > 0;
    size.textContent = s.image ? es.export.pngHelp(exportSize(s.image).width, exportSize(s.image).height) : '';
    status.textContent = ok ? '' : es.export.needsFace;
    dialog.showModal();
  };
  button.addEventListener('click', open);
  return { button, open };
}
