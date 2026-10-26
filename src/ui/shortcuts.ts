// Diálogo con los atajos de teclado (botón «?» de la cabecera o tecla ?).

import { es } from '../i18n/es';
import { h } from './dom';

export function buildShortcutsDialog(): { button: HTMLButtonElement; open(): void } {
  const close = h('button', { 'type': 'button', 'class': 'btn', 'data-fid': 'shortcuts-close' }, es.shortcuts.close);
  const dialog = h(
    'dialog',
    { 'class': 'export-dialog shortcuts-dialog', 'aria-labelledby': 'shortcuts-title' },
    h('h2', { id: 'shortcuts-title' }, es.shortcuts.title),
    h('dl', { class: 'shortcut-list' }, ...es.shortcuts.list.flatMap(([k, what]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, what)])),
    h('div', { class: 'btn-row end' }, close),
  );
  document.body.append(dialog);
  close.addEventListener('click', () => dialog.close());
  const open = () => {
    if (!dialog.open) dialog.showModal();
  };
  const button = h('button', { 'type': 'button', 'class': 'btn icon-only', 'aria-label': es.shortcuts.button, 'title': es.shortcuts.button, 'data-fid': 'shortcuts-open' }, '?');
  button.addEventListener('click', open);
  return { button, open };
}
