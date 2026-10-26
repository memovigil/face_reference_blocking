// Persistencia (fase 7): el proyecto vuelve tal cual al recargar la página
// (foto, puntos corregidos, ajustes y paso), también en modo manual; «Cerrar
// foto» lo borra.
// Uso: node tests/visual/persist.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const url = process.env.APP_URL ?? 'http://localhost:5173/';
await page.goto(url);
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`);
  if (!ok) fails++;
};
const ready = () =>
  page.waitForFunction(() => {
    const s = window.__encaje.store.get();
    return ['ready', 'no-face', 'manual'].includes(s.status) && ['done', 'unavailable'].includes(s.segStatus);
  }, null, { timeout: 90000 });
const snapshot = () =>
  page.evaluate(() => {
    const s = window.__encaje.store.get();
    return {
      w: s.image?.width,
      h: s.image?.height,
      step: s.step,
      blockLevel: s.blockLevel,
      terminator: s.terminator,
      nose: s.landmarks ? [s.landmarks[4].x, s.landmarks[4].y] : null,
      edited: s.landmarks !== s.detection?.landmarks,
      crown: s.extrasPlaced.crown ?? null,
      manual: s.manual ? Object.keys(s.manual.points).length : 0,
      restored: s.restored,
      status: s.status,
    };
  });

// 1 · Detección con un punto corregido y ajustes de pasos.
await page.evaluate(() => window.__encaje.openSample());
await ready();
await page.evaluate(() => {
  const { store } = window.__encaje;
  const s = store.get();
  const lm = s.landmarks.map((p, i) => (i === 4 ? { ...p, x: p.x + 7, y: p.y - 3 } : p));
  store.set({ landmarks: lm, extrasPlaced: { crown: { x: 480, y: 160 } }, blockLevel: 'medio', terminator: 0.3, step: 'D' });
});
await page.waitForTimeout(1200);
const before = await snapshot();
await page.reload();
await ready();
await page.waitForTimeout(300);
const after = await snapshot();
check(after.restored && after.w === before.w && after.h === before.h, `al recargar vuelve la foto (${after.w} × ${after.h})`);
check(after.step === 'D' && after.blockLevel === 'medio' && after.terminator === 0.3, `vuelven el paso y los ajustes (paso ${after.step}, nivel ${after.blockLevel}, terminador ${after.terminator})`);
check(after.edited && after.nose[0] === before.nose[0] && after.nose[1] === before.nose[1], 'vuelve el punto corregido');
check(after.crown?.x === 480 && after.crown?.y === 160, 'vuelve el punto de la cima colocado a mano');
check(await page.locator('.status-card', { hasText: 'Se recuperó' }).count() === 1, 'el panel avisa que se recuperó la sesión');

// 2 · Modo manual.
await page.evaluate(() => window.__encaje.openSample({ pose: { yaw: 85, pitch: 4, roll: 0 } }));
await ready();
await page.evaluate(async () => {
  const mf = await import('/src/geom/manualFit.ts');
  const { store, sampleTruth } = window.__encaje;
  document.querySelector('[data-fid="manual-start"]').click();
  const pts = mf.manualPointsFrom(sampleTruth().points, 'profile', 'right');
  const m = store.get().manual;
  store.set({ manual: { ...m, view: 'profile', points: pts, next: null, order: Object.keys(pts) } });
});
await page.waitForTimeout(1200);
const m1 = await snapshot();
await page.reload();
await ready();
await page.waitForTimeout(300);
const m2 = await snapshot();
check(m2.manual === m1.manual && m2.status === 'ready' && m2.nose && Math.hypot(m2.nose[0] - m1.nose[0], m2.nose[1] - m1.nose[1]) < 0.01, `vuelve el modo manual con sus ${m2.manual} puntos y la misma malla`);

// 3 · Cerrar foto borra lo guardado.
await page.click('[data-fid="close-photo"]');
await page.waitForTimeout(400);
await page.reload();
await page.waitForTimeout(1500);
const empty = await page.evaluate(() => window.__encaje.store.get().status);
check(empty === 'empty', `«Cerrar foto» borra lo guardado (estado al recargar: ${empty})`);

check(errors.length === 0, `sin errores en la página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(fails ? `\n${fails} fallas` : '\nTodo OK');
process.exit(fails ? 1 : 0);
