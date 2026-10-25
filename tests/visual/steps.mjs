// Captura cada paso habilitado (R, A, B, C, I…) para una o varias fotos.
// Uso: node tests/visual/steps.mjs <carpeta-salida> <foto> [<foto>…] [--steps=R,A,B,C,I] [--zoom=1]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const args = process.argv.slice(2);
const out = args.shift();
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')));
const photos = args.filter((a) => !a.startsWith('--'));
const steps = (flags.steps ?? 'R,A,B,C,I').split(',');
mkdirSync(out, { recursive: true });
const url = process.env.APP_URL ?? 'http://localhost:5173/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
for (const f of photos) {
  const prev = await page.evaluate(() => window.__encaje.store.get().image?.id ?? null);
  await page.setInputFiles('input[type=file]', f);
  await page.waitForFunction(
    (prev) => {
      const s = window.__encaje.store.get();
      return s.image && s.image.id !== prev && (s.status === 'no-face' || (s.status === 'ready' && ['done', 'unavailable'].includes(s.segStatus)));
    },
    prev,
    { timeout: 60000 },
  );
  const name = basename(f, extname(f)).slice(0, 12);
  for (const st of steps) {
    await page.evaluate((st) => window.__encaje.store.set({ step: st }), st);
    if (flags.zoom) await page.evaluate((z) => window.__encaje.viewer.setZoom(Number(z)), flags.zoom);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(out, `${name}-${st}.jpg`), quality: 82 });
  }
  console.log(`${name}: ${steps.length} pasos`);
}
await browser.close();
if (errors.length) {
  console.log('ERRORES DE PÁGINA:', errors.slice(0, 5));
  process.exit(1);
}
