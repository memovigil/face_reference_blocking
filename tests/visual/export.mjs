// Exportar (fase 7): con la muestra 3D descarga el PNG del paso (con foto y
// cuadrícula, y sin foto) y el PDF con todos los pasos; revisa tamaños, que el
// PDF sea válido (pdfinfo) y lo convierte a imágenes para mirarlo (pdftoppm).
// Uso: node tests/visual/export.mjs [carpeta-salida]
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'tests/screenshots/latest/exportar';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`);
  if (!ok) fails++;
};
const pngSize = (file) => {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

await page.evaluate(() => window.__encaje.openSample());
await page.waitForFunction(() => {
  const s = window.__encaje.store.get();
  return s.status === 'ready' && ['done', 'unavailable'].includes(s.segStatus);
}, null, { timeout: 90000 });

// PNG del paso D con foto y cuadrícula de 4 × 4.
await page.evaluate(() => window.__encaje.store.set({ step: 'D' }));
await page.click('[data-fid="export-open"]');
await page.screenshot({ path: join(out, 'dialogo.png') });
await page.check('[data-fid="exp-grid"]');
await page.selectOption('[data-fid="exp-grid-n"]', '4');
let [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-fid="exp-png"]')]);
const png1 = join(out, dl.suggestedFilename());
await dl.saveAs(png1);
const s1 = pngSize(png1);
const orig = await page.evaluate(() => ({ w: window.__encaje.store.get().image.originalWidth, h: window.__encaje.store.get().image.originalHeight }));
check(s1.w === orig.w && s1.h === orig.h, `PNG a la resolución original (${s1.w} × ${s1.h}): ${dl.suggestedFilename()}`);

// PNG del paso F sin foto ni cuadrícula.
await page.click('[data-fid="exp-close"]');
await page.evaluate(() => window.__encaje.store.set({ step: 'F' }));
await page.click('[data-fid="export-open"]');
await page.uncheck('[data-fid="exp-photo"]');
await page.uncheck('[data-fid="exp-grid"]');
[dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-fid="exp-png"]')]);
const png2 = join(out, dl.suggestedFilename());
await dl.saveAs(png2);
check(pngSize(png2).w === orig.w, `PNG del paso F sin foto: ${dl.suggestedFilename()}`);

// PDF con todos los pasos.
const t0 = Date.now();
[dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('[data-fid="exp-pdf"]')]);
const pdf = join(out, dl.suggestedFilename());
await dl.saveAs(pdf);
const info = execFileSync('pdfinfo', [pdf]).toString();
const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
const size = /Page size:\s+([^\n]+)/.exec(info)?.[1] ?? '';
check(pages >= 10, `PDF válido con portada y 9 pasos (${pages} páginas, ${size.trim()}, ${Math.round(readFileSync(pdf).length / 1024)} KB, ${Date.now() - t0} ms)`);
check(/612 x 792/.test(size), 'tamaño carta');
execFileSync('pdftoppm', ['-r', '70', '-png', pdf, join(out, 'pagina')]);
const text = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
check(/Lo que hace única esta cara/.test(text) && /Paso E · Planos de luz/.test(text) && /Qué hacer/.test(text), 'el texto (con acentos) se extrae del PDF');

check(errors.length === 0, `sin errores en la página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(fails ? `\n${fails} fallas` : '\nTodo OK');
process.exit(fails ? 1 : 0);
