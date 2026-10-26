// Modo manual (§5.5) con la muestra 3D girada: verdad conocida. Los puntos se
// colocan con clics reales en el lienzo, en su posición verdadera más un error
// de marcado a ojo (1 % del alto de la cabeza), y se compara la pose y la malla
// que resultan con las de la muestra. También prueba saltar, deshacer, arrastrar
// y volver a la detección, y captura cada paso con la malla manual.
// Uso: node tests/visual/manual.mjs [carpeta-salida]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'tests/screenshots/latest/manual';
mkdirSync(out, { recursive: true });
const CASES = [
  { name: 'perfil-derecha', pose: { yaw: 85, pitch: 4, roll: 0 }, view: 'profile' },
  { name: 'perfil-izquierda', pose: { yaw: -82, pitch: -6, roll: 4 }, view: 'profile' },
  { name: 'tres-cuartos', pose: { yaw: 45, pitch: 5, roll: -3 }, view: 'threeQuarter' },
  { name: 'frente', pose: { yaw: 6, pitch: -4, roll: 5 }, view: 'front' },
];
const POSE_TOL = 10;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
await page.evaluate(async () => {
  window.__mf = await import('/src/geom/manualFit.ts');
  window.__kp = await import('/src/detect/keypoints.ts');
  window.__lmap = await import('/src/detect/landmarkMap.ts');
  window.__pose = await import('/src/geom/pose.ts');
});
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`);
  if (!ok) fails++;
};
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const summary = [];

for (const c of CASES) {
  console.log(`\n== ${c.name} (giro ${c.pose.yaw}°)`);
  await page.evaluate((pose) => window.__encaje.openSample({ pose }), c.pose);
  await page.waitForFunction(
    () => {
      const s = window.__encaje.store.get();
      return ['no-face', 'error'].includes(s.status) || (s.status === 'ready' && ['done', 'unavailable'].includes(s.segStatus));
    },
    null,
    { timeout: 90000 },
  );
  const detected = await page.evaluate(() => window.__encaje.store.get().status === 'ready');
  console.log(`   el detector ${detected ? 'sí' : 'no'} encuentra la cara`);
  if (!detected) await page.screenshot({ path: join(out, `${c.name}-sin-cara.jpg`), quality: 82 });
  // Entrada al modo manual: desde el aviso sin cara o desde «Revisar puntos».
  await page.click(detected ? '[data-fid="manual-start-r"]' : '[data-fid="manual-start"]');
  await page.click(`[data-fid="mview-${c.view}"]`);
  await settle();

  // Verdad conocida de cada punto de la lista.
  const plan = await page.evaluate(({ view, yaw }) => {
    const { MANUAL_POINTS, manualKey } = window.__mf;
    const truth = window.__encaje.sampleTruth();
    const facing = yaw > 0 ? 'right' : 'left';
    const { RIGHT_EYE_CONTOUR, LEFT_EYE_CONTOUR } = window.__lmap;
    const avg = (ids) => ids.reduce((a, i) => ({ x: a.x + truth.points[i].x / ids.length, y: a.y + truth.points[i].y / ids.length }), { x: 0, y: 0 });
    return MANUAL_POINTS[view].map((id) => {
      const k = manualKey(id, facing);
      let p;
      if (k.landmark === 468) p = avg(RIGHT_EYE_CONTOUR);
      else if (k.landmark === 473) p = avg(LEFT_EYE_CONTOUR);
      else if (k.landmark !== undefined) p = truth.points[k.landmark];
      else {
        // Anclas fuera de la malla (orejas, trago, ángulo de la mandíbula): su estimación canónica.
        const q = window.__pose.projectCanonical(truth.frame, window.__mf.manualCanonical(id, facing).canon);
        p = { x: q.x, y: q.y };
      }
      return { id, x: p.x, y: p.y };
    });
  }, { view: c.view, yaw: c.pose.yaw });
  const headPx = await page.evaluate(() => window.__encaje.sampleTruth().frame.scale * 23);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const sigma = 0.01 * headPx;

  let order = 0;
  const intended = {};
  for (const p of plan) {
    const next = await page.evaluate(() => window.__encaje.store.get().manual.next);
    if (next !== p.id) {
      check(false, `el siguiente punto es ${p.id} (es ${next})`);
      break;
    }
    if (p.id === 'earLobeN') {
      await page.click('[data-fid="manual-skip"]');
      await settle();
      continue;
    }
    const target = { x: p.x + rnd() * sigma, y: p.y + rnd() * sigma };
    intended[p.id] = target;
    // Como pide la tarjeta: acercarse con el zoom para colocar con precisión.
    await page.evaluate((t) => window.__encaje.viewer.focus(t, 2.5), target);
    await settle();
    const client = await page.evaluate((t) => window.__encaje.viewer.imageToClient(t), target);
    // Captura a mitad de camino: el punto pendiente en la tarjeta y la lupa sobre el siguiente.
    if (order === 6 && c === CASES[0]) {
      await page.mouse.move(client.x, client.y, { steps: 3 });
      await settle();
      await page.screenshot({ path: join(out, `${c.name}-colocando.jpg`), quality: 82 });
    }
    await page.mouse.click(client.x, client.y);
    await settle();
    order++;
    // Deshacer una vez a mitad de camino y volver a colocar.
    if (order === 4) {
      await page.click('[data-fid="manual-undo"]');
      await settle();
      const back = await page.evaluate(() => window.__encaje.store.get().manual.next);
      check(back === p.id, `«Deshacer» deja pendiente el último punto (${back})`);
      await page.mouse.click(client.x, client.y);
      await settle();
    }
  }
  await settle();
  const placedAt = await page.evaluate(() => window.__encaje.store.get().manual.points);
  const dev = Math.max(...Object.entries(intended).map(([id, t]) => (placedAt[id] ? Math.hypot(placedAt[id].x - t.x, placedAt[id].y - t.y) : Infinity)));
  check(dev < 1.5, `cada punto queda donde se hizo clic (desvío máx. ${dev.toFixed(2)} px)`);
  const res = await page.evaluate(({ view }) => {
    const s = window.__encaje.store.get();
    const d = window.__encaje.derive(s);
    const truth = window.__encaje.sampleTruth();
    if (!d) return { status: s.status };
    return {
      status: s.status,
      skipped: Object.keys(s.manual.skipped),
      placed: Object.keys(s.manual.points).length,
      total: window.__mf.MANUAL_POINTS[view].length,
      angles: d.pose.angles,
      facing: s.detection.manual.facing,
      rms: s.detection.manual.rms,
      lm: s.landmarks.slice(0, 468).map((p) => [p.x, p.y]),
      truth: truth.points.map((p) => [p.x, p.y]),
      scale: truth.frame.scale,
    };
  }, c);
  check(res.status === 'ready', `con los puntos marcados se construye la malla (${res.placed} de ${res.total}, saltados: ${res.skipped?.join(', ') || 'ninguno'})`);
  if (res.status !== 'ready') continue;
  const err = Object.fromEntries(Object.entries(c.pose).map(([k, v]) => [k, Math.round((res.angles[k] - v) * 10) / 10]));
  check(Math.abs(err.yaw) <= POSE_TOL && Math.abs(err.pitch) <= POSE_TOL && Math.abs(err.roll) <= POSE_TOL, `pose de la malla manual contra la renderizada (error ${JSON.stringify(err)})`);
  check(res.facing === (c.pose.yaw > 0 ? 'right' : 'left'), `detecta hacia dónde mira la cara (${res.facing})`);
  // Error de la malla en el lado visible (cercano + línea media), en % del alto de la cabeza.
  const canonX = await page.evaluate(async () => {
    const m = await import('/src/geom/canonical.ts');
    return Array.from({ length: 468 }, (_, i) => m.canonicalPoint(i).x);
  });
  const nearSign = c.view === 'profile' ? (c.pose.yaw > 0 ? -1 : 1) : 0;
  let sum = 0;
  let n = 0;
  let max = 0;
  for (let i = 0; i < 468; i++) {
    if (nearSign && canonX[i] * nearSign < -0.5) continue;
    const e = Math.hypot(res.lm[i][0] - res.truth[i][0], res.lm[i][1] - res.truth[i][1]);
    sum += e;
    n++;
    max = Math.max(max, e);
  }
  const head = res.scale * 23;
  const meanPct = (100 * sum) / n / head;
  check(meanPct < 3, `malla contra la muestra: error medio ${meanPct.toFixed(2)} % del alto de la cabeza (máx. ${((100 * max) / head).toFixed(1)} %, ${n} vértices visibles)`);

  await page.evaluate(() => window.__encaje.viewer.fit());
  await settle();
  await page.screenshot({ path: join(out, `${c.name}-R.jpg`), quality: 82 });

  // Arrastre (con zoom): la punta de la nariz se mueve y la malla la sigue.
  const tip = await page.evaluate(() => window.__encaje.store.get().manual.points.noseTip);
  await page.evaluate((t) => window.__encaje.viewer.focus(t, 3), tip);
  await settle();
  const from = await page.evaluate((t) => window.__encaje.viewer.imageToClient(t), tip);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 4 });
  await page.mouse.up();
  const moved = await page.evaluate((t) => {
    const s = window.__encaje.store.get();
    const p = s.manual.points.noseTip;
    const l = s.landmarks[4];
    return { dp: Math.hypot(p.x - t.x, p.y - t.y), follow: Math.hypot(l.x - p.x, l.y - p.y) };
  }, tip);
  check(moved.dp > 5 && moved.follow < 2, `al arrastrar un punto la malla lo sigue (movido ${moved.dp.toFixed(1)} px, malla a ${moved.follow.toFixed(1)} px)`);

  await page.evaluate(() => window.__encaje.viewer.fit());
  const steps = { blocking: 0, light: false, values: false };
  for (const st of ['A', 'B', 'C', 'D', 'E', 'F', 'H']) {
    await page.evaluate((st) => window.__encaje.store.set({ step: st }), st);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(out, `${c.name}-${st}.jpg`), quality: 82 });
    const d = await page.evaluate(() => {
      const d = window.__encaje.derive(window.__encaje.store.get());
      return { blocking: d.blocking ? d.blocking.faces.filter((f) => f.front).length : 0, light: !!d.lightDir, values: !!d.values };
    });
    if (st === 'D') steps.blocking = d.blocking;
    if (st === 'E') steps.light = d.light;
    if (st === 'F') steps.values = d.values;
  }
  check(steps.blocking > 5 && steps.light && steps.values, `los pasos D–H trabajan con la malla manual (${steps.blocking} planos visibles)`);

  if (detected) {
    await page.evaluate(() => window.__encaje.store.set({ step: 'R' }));
    await settle();
    await page.click('[data-fid="manual-back"]');
    const back = await page.evaluate(() => {
      const s = window.__encaje.store.get();
      return { manual: s.manual, auto: s.landmarks === s.autoDetection?.landmarks };
    });
    check(!back.manual && back.auto, '«Volver a la detección» restaura la malla del detector');
  }
  summary.push({ caso: c.name, pose: c.pose, detectada: detected, errorPose: err, lado: res.facing, errorMallaPct: Math.round(meanPct * 100) / 100, rmsPx: Math.round(res.rms * 10) / 10, puntos: res.placed });
}

check(errors.length === 0, `sin errores en la página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
writeFileSync(join(out, 'manual.json'), JSON.stringify({ fecha: new Date().toISOString(), casos: summary }, null, 1));
await browser.close();
console.log(fails ? `\n${fails} fallas` : '\nTodo OK');
process.exit(fails ? 1 : 0);
