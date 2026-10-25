// Prueba las interacciones del visor y del paso «Revisar puntos» con eventos
// reales de ratón y teclado, y saca capturas. Falla si algo no responde.
// Uso: node tests/visual/interact.mjs <foto> <carpeta-salida>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [, , photo, out] = process.argv;
mkdirSync(out, { recursive: true });
const url = process.env.APP_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FALLA'} ${msg}`);
  if (!cond) failures.push(msg);
};

async function open(page) {
  await page.goto(url);
  await page.setInputFiles('input[type=file]', photo);
  await page.waitForFunction(() => window.__encaje.store.get().status === 'ready', null, { timeout: 60000 });
  await page.waitForTimeout(200);
}

const state = (page) => page.evaluate(() => {
  const { store, viewer, derive } = window.__encaje;
  const s = store.get();
  const d = derive(s);
  return {
    zoom: viewer.view.zoom,
    mode: s.viewMode,
    tool: s.tool,
    selected: s.selectedKey,
    edited: s.landmarks !== s.detection?.landmarks,
    yaw: d?.pose.angles.yaw,
    kp: Object.fromEntries((d?.keypoints ?? []).map((k) => [k.def.id, { x: k.p.x, y: k.p.y, est: k.estimated, vis: k.visible }])),
    layers: s.layers,
    opacity: s.lineOpacity,
  };
});

/** Posición en pantalla (cliente) de un punto de imagen, en el panel principal. */
const toClient = (page, p) => page.evaluate((p) => {
  const pane = document.querySelector('.pane-main');
  const svg = pane.querySelector('svg.overlay');
  const m = svg.getScreenCTM();
  const pt = svg.createSVGPoint();
  pt.x = p.x;
  pt.y = p.y;
  const r = pt.matrixTransform(m);
  return { x: r.x, y: r.y };
}, p);

// ---------------------------------------------------------------- escritorio
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  let s = await state(page);
  check(s.zoom === 1, 'zoom inicial = 100 %');

  // Ctrl + rueda al cursor: el punto de imagen bajo el cursor no se mueve.
  const n0 = await toClient(page, s.kp.noseTip);
  const c0 = { x: Math.round(n0.x), y: Math.round(n0.y) };
  const nose = await page.evaluate((c) => window.__encaje.viewer.clientToImage(c.x, c.y), c0);
  await page.mouse.move(c0.x, c0.y);
  await page.keyboard.down('Control');
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page.waitForTimeout(120);
  s = await state(page);
  const c1 = await toClient(page, nose);
  check(s.zoom > 1.8, `ctrl + rueda acerca (zoom ${(s.zoom * 100).toFixed(0)} %)`);
  check(Math.hypot(c1.x - c0.x, c1.y - c0.y) < 1, `zoom anclado al cursor (desvío ${Math.hypot(c1.x - c0.x, c1.y - c0.y).toFixed(2)} px)`);

  // Arrastrar en vacío con zoom desplaza.
  const empty = { x: 200, y: 600 };
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 80, empty.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const c2 = await toClient(page, nose);
  check(Math.abs(c2.x - c1.x - 80) < 3 && Math.abs(c2.y - c1.y - 40) < 3, 'arrastrar con zoom desplaza la vista');

  // F = ajustar, H = mano.
  await page.keyboard.press('f');
  await page.waitForTimeout(80);
  s = await state(page);
  check(Math.abs(s.zoom - 1) < 1e-6, 'F vuelve a «Ajustar»');
  await page.keyboard.press('h');
  s = await state(page);
  check(s.tool === 'hand', 'H activa la mano');
  await page.keyboard.press('h');

  // Botones de zoom.
  await page.getByRole('button', { name: 'Acercar' }).click();
  await page.getByRole('button', { name: 'Acercar' }).click();
  s = await state(page);
  check(Math.abs(s.zoom - 1.5625) < 1e-3, 'botón + acerca 25 % por clic');
  await page.getByRole('button', { name: 'Ajustar' }).click();
  await page.waitForTimeout(80);

  // Arrastrar un punto clave: mueve el punto, sus vecinos y pinta la lupa.
  s = await state(page);
  const mouth = s.kp.mouthR;
  const before = s.kp;
  const m0 = await toClient(page, mouth);
  await page.mouse.move(m0.x, m0.y);
  await page.mouse.down();
  await page.mouse.move(m0.x + 12, m0.y + 6, { steps: 6 });
  const loupeVisible = await page.evaluate(() => !document.querySelector('.loupe').hidden);
  await page.screenshot({ path: `${out}/arrastre-lupa.png` });
  await page.mouse.up();
  s = await state(page);
  const moved = Math.hypot(s.kp.mouthR.x - mouth.x, s.kp.mouthR.y - mouth.y);
  const scale = await page.evaluate(() => window.__encaje.viewer.view.scale);
  check(loupeVisible, 'la lupa aparece al arrastrar');
  check(Math.abs(moved - Math.hypot(12, 6) / scale) < 0.6, `el punto sigue al ratón (${moved.toFixed(2)} px de imagen)`);
  check(s.edited && s.selected === 'mouthR', 'la malla queda corregida y el punto seleccionado');
  const farMoved = Math.hypot(s.kp.pupilL.x - before.pupilL.x, s.kp.pupilL.y - before.pupilL.y);
  check(farMoved < 0.05, 'los puntos lejanos no se mueven');
  check(await page.evaluate(() => document.querySelector('.loupe').hidden), 'la lupa se oculta al soltar');

  // Punto estimado: al arrastrarlo deja de ser «estimado».
  check(s.kp.crown.est, 'la cima empieza como estimada');
  const cr = await toClient(page, s.kp.crown);
  await page.mouse.move(cr.x, cr.y);
  await page.mouse.down();
  await page.mouse.move(cr.x, cr.y - 10, { steps: 3 });
  await page.mouse.up();
  s = await state(page);
  check(!s.kp.crown.est, 'la cima queda confirmada tras arrastrarla');
  await page.screenshot({ path: `${out}/revisar-corregido.png` });

  // Oreja confirmada: entra al ajuste de la pose.
  const earId = s.kp.earTopR.vis ? 'earTopR' : 'earTopL';
  const yawBefore = s.yaw;
  const ear = await toClient(page, s.kp[earId]);
  await page.mouse.move(ear.x, ear.y);
  await page.mouse.down();
  await page.mouse.move(ear.x + (s.kp[earId].x < s.kp.noseTip.x ? -25 : 25), ear.y, { steps: 4 });
  await page.mouse.up();
  s = await state(page);
  check(!s.kp[earId].est && Math.abs(s.yaw - yawBefore) > 0.2, `la oreja confirmada recalcula la pose (giro ${yawBefore.toFixed(1)}° → ${s.yaw.toFixed(1)}°)`);

  // Restablecer detección.
  await page.getByRole('button', { name: 'Restablecer detección' }).click();
  s = await state(page);
  check(!s.edited && s.kp.crown.est, '«Restablecer detección» devuelve todo a lo detectado');

  // Chip: enfoca el punto.
  await page.getByRole('button', { name: /^Punta de la nariz/ }).click();
  await page.waitForTimeout(100);
  s = await state(page);
  check(s.selected === 'noseTip' && s.zoom >= 3, 'el chip selecciona y acerca al punto');
  await page.screenshot({ path: `${out}/chip-enfoque.png` });

  // Lado a lado con cruz sincronizada.
  await page.getByRole('button', { name: 'Lado a lado' }).click();
  await page.waitForTimeout(200);
  const ref = await page.evaluate(() => document.querySelector('.pane-ref').getBoundingClientRect().toJSON());
  await page.mouse.move(ref.x + ref.width * 0.5, ref.y + ref.height * 0.45);
  await page.waitForTimeout(80);
  const crosses = await page.evaluate(() => [...document.querySelectorAll('.crosshair path')].length);
  check(crosses === 2, 'lado a lado: cruz roja en los dos paneles');
  await page.screenshot({ path: `${out}/lado-a-lado.png` });
  await page.getByRole('button', { name: 'Superpuesta' }).click();

  // Capas y opacidad con teclado.
  await page.keyboard.press('5');
  s = await state(page);
  check(s.layers.indices, 'tecla 5 muestra «Índices»');
  await page.keyboard.press('5');
  await page.keyboard.press('4');
  s = await state(page);
  check(!s.layers.points, 'tecla 4 oculta «Puntos»');
  await page.keyboard.press('4');

  // Ajuste fino de pose.
  const yaw0 = s.yaw;
  await page.locator('details.pose-fine summary').click();
  const slider = page.getByRole('slider', { name: 'Ajuste fino: Giro' });
  await slider.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  s = await state(page);
  check(Math.abs(s.yaw - yaw0 - 3) < 1e-6, `ajuste fino de giro +3° (${(s.yaw - yaw0).toFixed(2)}°)`);

  check(errors.length === 0, `sin errores de página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await page.close();
}

// ---------------------------------------------------------------- oscuro y móvil
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' });
  await open(page);
  await page.screenshot({ path: `${out}/oscuro.png` });
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `móvil sin scroll horizontal (sobra ${overflow} px)`);
  await page.screenshot({ path: `${out}/movil.png`, fullPage: false });
  await page.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FALLAS` : '\nTodo OK');
process.exit(failures.length ? 1 : 0);
