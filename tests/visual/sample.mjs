// Muestra de ejemplo: se genera en la app, se detecta y se recorre cada paso.
// Pose conocida (SAMPLE_POSE en src/sample/render.ts): la detectada debe
// coincidir a ±5°. Guarda la imagen y una captura por paso.
// Uso: node tests/visual/sample.mjs <carpeta-salida>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'tests/screenshots/latest/muestra';
mkdirSync(out, { recursive: true });
const POSE = { yaw: 24, pitch: 6, roll: 3 };
const TOL = 5;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`);
  if (!ok) fails++;
};

const t0 = Date.now();
await page.getByRole('button', { name: 'Probar con la muestra' }).click();
await page.waitForFunction(
  () => {
    const s = window.__encaje.store.get();
    return s.status === 'no-face' || s.status === 'error' || (s.status === 'ready' && ['done', 'unavailable'].includes(s.segStatus));
  },
  null,
  { timeout: 90000 },
);
const info = await page.evaluate(() => {
  const s = window.__encaje.store.get();
  const d = s.detection ? window.__encaje.derive(s) : null;
  return { status: s.status, seg: s.segStatus, pose: d?.pose.angles, hasSil: !!d?.silhouette, envelope: d?.envelope?.source };
});
check(info.status === 'ready', `se detecta la cara de la muestra (${Date.now() - t0} ms)`);
if (info.pose) {
  const err = Object.fromEntries(Object.entries(POSE).map(([k, v]) => [k, Math.round((info.pose[k] - v) * 10) / 10]));
  check(Object.values(err).every((e) => Math.abs(e) <= TOL), `pose detectada contra la renderizada (error ${JSON.stringify(err)})`);
}
check(info.seg === 'done' && info.hasSil, 'la segmentación encuentra la silueta con cabello');
check(info.envelope === 'silhouette', 'la envolvente sale de la silueta');

const jpg = await page.evaluate(() => window.__encaje.store.get().image.canvas.toDataURL('image/jpeg', 0.9));
writeFileSync(join(out, 'muestra.jpg'), Buffer.from(jpg.split(',')[1], 'base64'));
for (const st of ['R', 'A', 'B', 'C', 'D', 'I']) {
  await page.evaluate((st) => window.__encaje.store.set({ step: st }), st);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `muestra-${st}.jpg`), quality: 82 });
}

// Paso D: los tres niveles, y el medio sin foto y con nombres (prueba de humo).
const bq = [];
for (const lv of ['grande', 'medio', 'fino']) {
  await page.evaluate((lv) => window.__encaje.store.set({ step: 'D', blockLevel: lv }), lv);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `muestra-D-${lv}.jpg`), quality: 82 });
  bq.push(
    await page.evaluate(async (lv) => {
      const { blockingQuality } = await import('/src/geom/blocking.ts');
      const b = window.__encaje.derive(window.__encaje.store.get()).blocking;
      const q = blockingQuality(b);
      return { lv, faces: q.faces, floating: q.floating.length, crossed: q.selfIntersecting.length, ms: b.ms };
    }, lv),
  );
}
for (const q of bq) check(q.floating === 0 && q.crossed === 0 && q.ms < 50, `blocking ${q.lv}: ${q.faces} planos, sin sueltos ni cruzados, ${q.ms.toFixed(1)} ms`);
await page.evaluate(() => window.__encaje.store.set({ blockLevel: 'medio', blockNames: true, photoOpacity: 0 }));
await page.waitForTimeout(250);
await page.screenshot({ path: join(out, 'muestra-D-medio-nombres.jpg'), quality: 82 });
await page.evaluate(() => window.__encaje.store.set({ blockNames: false, photoOpacity: 1 }));
check(errors.length === 0, `sin errores de página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(fails ? `\n${fails} FALLAS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
