// Carga una foto en la app, espera la detección y saca captura + datos.
// Uso: node tests/visual/probe.mjs <foto> <salida-sin-ext> [--indices] [--focus=x,y,zoom] [--side] [--width=1400]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const [, , photo, out, ...flags] = process.argv;
const opt = Object.fromEntries(flags.map((f) => { const [k, v] = f.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const url = process.env.APP_URL ?? 'http://localhost:5173/';
const width = Number(opt.width ?? 1400);
const height = Number(opt.height ?? 900);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
const t0 = Date.now();
await page.setInputFiles('input[type=file]', photo);
await page.waitForFunction(() => ['ready', 'no-face', 'error'].includes(window.__encaje.store.get().status), null, { timeout: 60000 });
const total = Date.now() - t0;
const info = await page.evaluate((o) => {
  const { store, derive, viewer } = window.__encaje;
  const s = store.get();
  if (o.indices) store.set({ layers: { ...s.layers, indices: true } });
  if (o.side) store.set({ viewMode: 'side' });
  const d = derive(store.get());
  return {
    status: s.status,
    image: s.image && { w: s.image.width, h: s.image.height, ow: s.image.originalWidth },
    ms: s.detection?.ms,
    delegate: s.detection?.delegate,
    angles: d?.pose.angles,
    matrixAngles: d?.pose.matrixAngles,
    fitAngles: d?.pose.fitAngles,
    mesh3DAngles: d?.pose.mesh3DAngles,
    agreement: d?.pose.agreement,
    sign: d?.pose.sign,
    ipd: d?.ipd,
    frameScale: d?.pose.frame.scale,
    rms: d?.pose.frame.rms,
    matrix: s.detection?.matrix,
    blend: s.detection && Object.fromEntries(Object.entries(s.detection.blendshapes).filter(([, v]) => v > 0.25).map(([k, v]) => [k, +v.toFixed(2)])),
    keypoints: d?.keypoints.map((k) => ({ id: k.def.id, x: +k.p.x.toFixed(1), y: +k.p.y.toFixed(1), est: k.estimated, vis: k.visible })),
  };
}, opt);
if (opt.focus) {
  const [x, y, z] = String(opt.focus).split(',').map(Number);
  await page.evaluate(([x, y, z]) => window.__encaje.viewer.focus({ x, y }, z), [x, y, z]);
}
if (opt.focuskey) {
  await page.evaluate(([id, z]) => {
    const { store, derive, viewer } = window.__encaje;
    const kp = derive(store.get()).keypoints.find((k) => k.def.id === id);
    viewer.focus(kp.p, Number(z));
  }, String(opt.focuskey).split(','));
}
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}.png` });
writeFileSync(`${out}.json`, JSON.stringify({ total, ...info, logs }, null, 1));
console.log(JSON.stringify({ total, status: info.status, ms: info.ms && Math.round(info.ms), delegate: info.delegate, angles: info.angles, matrixAngles: info.matrixAngles, mesh3DAngles: info.mesh3DAngles, agreement: info.agreement, sign: info.sign, logs: logs.slice(0, 8) }, null, 0));
await browser.close();
