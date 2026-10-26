// Exportar: el paso actual como PNG (resolución original, con o sin foto y con
// cuadrícula opcional) y un PDF tamaño carta con la foto, la pose, el
// diagnóstico y una página por paso, de la A a la I.

import { STEP_LAYERS } from '../draw/layers';
import { buildMeasures } from '../geom/measures';
import { mostDistinctive, type MetricGroup } from '../geom/metrics';
import { degStr, es } from '../i18n/es';
import { derive, type Derived } from '../state/derived';
import type { AppState, StepId } from '../state/store';
import { describe, formatMetric, lightLine } from '../ui/panel';
import { drawGrid, exportSize, stepCanvas } from './overlay';
import { LETTER, PdfWriter, textWidth, type PdfPage } from './pdf';

export const PDF_STEPS: readonly StepId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
/** Diferencia mínima (desviaciones típicas) para presentar un rasgo como distintivo (igual que el panel). */
const DISTINCTIVE_Z = 1;

/** Estado limpio para exportar: sin selección ni punto pendiente. */
function clean(s: AppState): AppState {
  return { ...s, selectedKey: null, manual: s.manual ? { ...s.manual, next: null } : null };
}

/** El estado de un paso con sus capas de omisión (como al entrar al paso). */
export function stateForStep(s: AppState, step: StepId): AppState {
  return { ...clean(s), step, compareLight: false, layers: { ...s.layers, indices: false, ...STEP_LAYERS[step] } };
}

/** Nombre de archivo a partir del nombre de la foto. */
export function baseName(s: AppState): string {
  const n = (s.image?.name ?? 'retrato').replace(/\.[a-z0-9]+$/i, '');
  return n.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'retrato';
}

function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality));
}

export async function exportStepPng(s: AppState, opts: { photo: boolean; grid: number | null }): Promise<Blob> {
  const st = clean(s);
  const d = derive(st);
  if (!d || !st.image) throw new Error('sin cara');
  const { width, height } = exportSize(st.image);
  const c = await stepCanvas(st, d, { width, height, photo: opts.photo });
  if (opts.grid) drawGrid(c.getContext('2d')!, width, height, opts.grid);
  return toBlob(c, 'image/png');
}

// ---------------------------------------------------------------------------
// PDF

const M = 46;
const GREY: [number, number, number] = [0.33, 0.36, 0.38];
const RED: [number, number, number] = [0.72, 0.2, 0.15];
const RULE: [number, number, number] = [0.78, 0.8, 0.77];
/** Lado mayor (px) de las imágenes de las páginas. */
const PAGE_IMAGE_PX = 1500;
/** En la página la imagen mide unos 400 pt: líneas y etiquetas más gruesas para que se lean. */
const PDF_BOOST = 1.7;

async function jpeg(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.86)).arrayBuffer());
}

/** Imagen ajustada a una caja (puntos); devuelve la y debajo de la imagen. */
async function placeImage(p: PdfPage, c: HTMLCanvasElement, x: number, y: number, boxW: number, boxH: number): Promise<number> {
  const k = Math.min(boxW / c.width, boxH / c.height);
  const w = c.width * k;
  const h = c.height * k;
  p.image(await jpeg(c), c.width, c.height, x + (boxW - w) / 2, y, w, h);
  p.rect(x + (boxW - w) / 2, y, w, h, RULE, 0.5);
  return y + h;
}

function pageSize(s: AppState): { width: number; height: number } {
  const img = s.image!;
  const k = Math.min(1, PAGE_IMAGE_PX / Math.max(img.width, img.height));
  return { width: Math.round(img.width * k), height: Math.round(img.height * k) };
}

function heading(p: PdfPage, y: number, text: string): number {
  p.text(M, y + 13, text, 13, 'bold');
  return y + 20;
}

function cover(pdf: PdfWriter, s: AppState, d: Derived, photo: HTMLCanvasElement): Promise<void> {
  const p = pdf.addPage();
  const W = LETTER.width - 2 * M;
  let y = M;
  p.text(M, y + 22, es.appTitle, 22, 'bold');
  y += 34;
  const date = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  p.text(M, y + 10, `${s.image!.name} · ${date}`, 10, 'regular', GREY);
  y += 24;
  return placeImage(p, photo, M, y, W * 0.46, 300).then((bottom) => {
    // Columna derecha: pose, luz, expresión.
    const x = M + W * 0.5;
    const cw = W * 0.5;
    let ry = y;
    p.text(x, ry + 12, es.export.pose, 12, 'bold');
    ry += 18;
    const a = d.pose.angles;
    for (const k of ['yaw', 'pitch', 'roll'] as const) {
      ry = p.paragraph(x, ry, cw, `${es.pose[k]}: ${degStr(a[k])} — ${es.pose[`${k}Hint`](a[k])}`, 10);
    }
    if (s.manual) ry = p.paragraph(x, ry + 2, cw, es.export.manual, 9.5, 'regular', GREY);
    ry += 10;
    p.text(x, ry + 12, es.export.light, 12, 'bold');
    ry += 16;
    ry = p.paragraph(x, ry, cw, lightLine({ ...s, step: 'E' }, derive({ ...s, step: 'E' }) ?? d), 10);
    ry += 10;
    p.text(x, ry + 12, es.export.expression, 12, 'bold');
    ry += 16;
    const shown = (['jawOpen', 'smile', 'eyesClosed', 'pucker'] as const).filter((k) => d.expression.detected[k] && !s.ignoreExpressions[k]);
    p.paragraph(x, ry, cw, shown.length ? shown.map((k) => es.expressions[k]).join(', ') : es.detection.neutral, 10);

    let yy = Math.max(bottom, ry) + 24;
    yy = heading(p, yy, es.diagnosis.title);
    const top = mostDistinctive(d.metrics).filter((v) => Math.abs(v.z) >= DISTINCTIVE_Z);
    if (top.length) {
      top.forEach((v, i) => {
        yy = p.paragraph(M, yy, W, `${i + 1}. ${es.metrics[v.def.id].label} — ${describe(v)}`, 10.5);
      });
      yy = p.paragraph(M, yy + 2, W, es.diagnosis.respect, 10, 'regular', RED);
    } else {
      yy = p.paragraph(M, yy, W, es.diagnosis.nothing, 10.5);
    }
    // La tabla completa va en la segunda página (y sigue en otra si no cabe).
    let page = pdf.addPage();
    yy = M;
    const room = (need: number) => {
      if (yy + need <= LETTER.height - M - 6) return;
      page = pdf.addPage();
      yy = M;
    };
    yy = heading(page, yy, es.diagnosis.all);
    const groups: MetricGroup[] = ['thirds', 'heights', 'widths', 'angles'];
    for (const g of groups) {
      const items = d.metrics.filter((m) => m.def.group === g);
      if (!items.length) continue;
      room(30);
      page.text(M, yy + 11, es.diagnosis.groups[g], 10, 'bold', GREY);
      yy += 15;
      for (const v of items) {
        room(13);
        const f = formatMetric(v);
        const color = v.reliable ? undefined : GREY;
        page.text(M + 8, yy + 9, es.metrics[v.def.id].label, 9, 'regular', color);
        page.text(M + 230, yy + 9, `${f.value} (${f.diff})`, 9, 'regular', color);
        if (v.note) page.text(M + 330, yy + 9, es.diagnosis.notes[v.note], 8, 'regular', GREY);
        yy += 12.5;
      }
      yy += 4;
    }
    room(30);
    page.paragraph(M, yy, W, es.diagnosis.canonNote, 8.5, 'regular', GREY);
  });
}

/** Texto propio de cada paso, debajo de la imagen. */
function stepExtras(step: StepId, st: AppState, d: Derived): { title?: string; lines: string[] } {
  if (step === 'C') return { title: es.export.measures, lines: buildMeasures(st.landmarks!, d).items.map((i) => `• ${i.text}`) };
  if (step === 'E') return { lines: [`${es.export.light}: ${lightLine(st, d)}`] };
  if (step === 'I') return { title: es.compare.title, lines: es.compare.order.map((t, i) => `${i + 1}. ${t}`) };
  return { lines: [] };
}

export async function exportPdf(s: AppState, onProgress?: (k: number, n: number) => void): Promise<Blob> {
  const base = clean(s);
  const d0 = derive(base);
  if (!d0 || !base.image) throw new Error('sin cara');
  const pdf = new PdfWriter();
  const size = pageSize(base);
  const total = PDF_STEPS.length + 1;
  onProgress?.(1, total);
  // Portada: la foto limpia.
  const photo = document.createElement('canvas');
  photo.width = size.width;
  photo.height = size.height;
  const pctx = photo.getContext('2d')!;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(base.image.canvas, 0, 0, size.width, size.height);
  await cover(pdf, base, d0, photo);
  const W = LETTER.width - 2 * M;
  for (const [i, step] of PDF_STEPS.entries()) {
    onProgress?.(i + 2, total);
    // Deja respirar a la interfaz entre página y página.
    await new Promise((r) => setTimeout(r, 0));
    const st = stateForStep(base, step);
    const d = derive(st);
    if (!d) continue;
    const def = es.stepDefs[step];
    const p = pdf.addPage();
    let y = M;
    p.text(M, y + 16, es.export.step(step, def.title), 16, 'bold');
    y += 28;
    const extras = stepExtras(step, st, d);
    const boxH = extras.lines.length > 2 ? 380 : 450;
    y = await placeImage(p, await stepCanvas(st, d, { ...size, photo: true, boost: PDF_BOOST }), M, y, W, boxH);
    y += 12;
    p.text(M, y + 10, es.steps.whatToDo, 10, 'bold', GREY);
    y = p.paragraph(M, y + 13, W, def.what, 10.5);
    y += 8;
    p.text(M, y + 10, es.steps.commonError, 10, 'bold', RED);
    y = p.paragraph(M, y + 13, W, def.error, 10.5);
    if (extras.lines.length) {
      y += 8;
      if (extras.title) {
        p.text(M, y + 10, extras.title, 10, 'bold', GREY);
        y += 13;
      }
      for (const line of extras.lines) {
        if (y > LETTER.height - M - 20) break;
        y = p.paragraph(M, y, W, line, 9.5);
      }
    }
  }
  // Pie: título y número de página.
  pdf.pages.forEach((p, i) => {
    p.line(M, LETTER.height - M + 10, LETTER.width - M, LETTER.height - M + 10, RULE, 0.5);
    p.text(M, LETTER.height - M + 24, es.appTitle, 8, 'regular', GREY);
    const t = es.export.page(i + 1, pdf.pages.length);
    p.text(LETTER.width - M - textWidth(t, 8), LETTER.height - M + 24, t, 8, 'regular', GREY);
  });
  return pdf.build({ title: `${es.appTitle} · ${base.image.name}` });
}
