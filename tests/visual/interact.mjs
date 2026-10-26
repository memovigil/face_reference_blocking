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

  // --- Fase 2 -------------------------------------------------------------
  await page.evaluate(() => window.__encaje.store.set({ poseAdjust: { yaw: 0, pitch: 0, roll: 0 } }));
  await page.waitForFunction(() => ['done', 'unavailable'].includes(window.__encaje.store.get().segStatus), null, { timeout: 30000 });

  // Expresión detectada (sonrisa) con «Ignorar»: el ancho de boca vuelve a contar.
  const mouthReliable = () => page.evaluate(() => window.__encaje.derive(window.__encaje.store.get()).metrics.find((m) => m.def.id === 'mouthWidth').reliable);
  check((await mouthReliable()) === false, 'con sonrisa, el ancho de boca no cuenta');
  await page.locator('.tag.expr', { hasText: 'Sonrisa' }).getByRole('button', { name: 'Ignorar' }).click();
  check((await mouthReliable()) === true, '«Ignorar» la sonrisa vuelve a contar el ancho de boca');

  // Pasos: cada uno enciende sus capas.
  await page.getByRole('button', { name: /Envolvente con rectas/ }).click();
  let ly = await page.evaluate(() => window.__encaje.store.get().layers);
  check(ly.envelope && !ly.structure, 'paso A enciende «Envolvente»');
  await page.getByRole('button', { name: '9', exact: true }).click();
  const sides = await page.evaluate(() => window.__encaje.derive(window.__encaje.store.get()).envelope.polygon.length);
  check(sides === 9, `envolvente con 9 rectas (${sides})`);
  const paths = await page.evaluate(() => document.querySelectorAll('.layer-envelope .env-poly').length);
  check(paths === 1, 'la envolvente se dibuja');
  await page.screenshot({ path: `${out}/paso-A.png` });

  await page.getByRole('button', { name: /Esfera de Loomis/ }).click();
  ly = await page.evaluate(() => window.__encaje.store.get().layers);
  check(ly.structure && ly.measures && !ly.envelope, 'paso B enciende Estructura y Medidas');
  await page.waitForFunction(() => document.querySelectorAll('.lm-sphere').length > 0, null, { timeout: 5000 }).catch(() => {});
  const lm = await page.evaluate(() => ({ sphere: document.querySelectorAll('.lm-sphere').length, rings: document.querySelectorAll('.lm-ring').length, canon: document.querySelectorAll('.lm-canon').length }));
  check(lm.sphere === 1 && lm.rings >= 3 && lm.canon >= 1, `Loomis: esfera, anillos y canon (${JSON.stringify(lm)})`);
  await page.screenshot({ path: `${out}/paso-B.png` });

  await page.getByRole('button', { name: /Medidas y triangulación/ }).click();
  const box = page.locator('.measure-list input[type=checkbox]').first();
  await box.check();
  const checked = await page.evaluate(() => Object.values(window.__encaje.store.get().checkedMeasures).filter(Boolean).length);
  check(checked === 1 && (await page.locator('.measure-list input[type=checkbox]').first().isChecked()), '«ya lo revisé» queda marcado tras redibujar');
  const ms = await page.evaluate(() => ({ tri: document.querySelectorAll('.ms-triangle').length, plumb: document.querySelectorAll('.ms-plumb').length }));
  check(ms.tri === 1 && ms.plumb >= 4, `paso C: triángulo y plomadas (${JSON.stringify(ms)})`);
  await page.screenshot({ path: `${out}/paso-C.png` });

  // --- Fase 3: paso D ---------------------------------------------------------
  await page.getByRole('button', { name: /Blocking de planos/ }).click();
  ly = await page.evaluate(() => window.__encaje.store.get().layers);
  check(ly.structure && !ly.points && !ly.envelope, 'paso D enciende Estructura y apaga Puntos');
  const countFaces = () => page.evaluate(() => window.__encaje.derive(window.__encaje.store.get()).blocking.faces.length);
  const counts = {};
  for (const [lv, label] of [['grande', 'Grande'], ['medio', 'Medio'], ['fino', 'Fino']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    counts[lv] = await countFaces();
  }
  check(counts.grande < counts.medio && counts.medio < counts.fino, `niveles: más planos de Grande a Fino (${JSON.stringify(counts)})`);
  await page.waitForFunction(() => document.querySelectorAll('.l-blocking .bk-hard').length > 0, null, { timeout: 5000 }).catch(() => {});
  const lines = await page.evaluate(() => ({ contour: document.querySelector('.l-blocking .bk-contour')?.getAttribute('d')?.length ?? 0, hard: document.querySelector('.l-blocking .bk-hard')?.getAttribute('d')?.length ?? 0 }));
  check(lines.contour > 0 && lines.hard > 0, 'el blocking dibuja contorno y cambios de plano');
  await page.getByLabel('Nombres de los planos').check();
  const names = await page.evaluate(() => document.querySelectorAll('.bk-name').length);
  check(names > 10, `nombres de los planos (${names})`);
  await page.getByRole('button', { name: 'Ocultar foto' }).click();
  check((await page.evaluate(() => window.__encaje.store.get().photoOpacity)) === 0, '«Ocultar foto» deja solo el blocking');
  await page.getByRole('button', { name: 'Ver foto' }).click();
  await page.locator('[data-fid=bk-width]').fill('2');
  check((await page.evaluate(() => window.__encaje.store.get().blockLineWidth)) === 2, 'grosor de línea');
  await page.screenshot({ path: `${out}/paso-D.png` });
  const quality = await page.evaluate(async () => {
    const { blockingQuality } = await import('/src/geom/blocking.ts');
    const q = blockingQuality(window.__encaje.derive(window.__encaje.store.get()).blocking);
    return { floating: q.floating.length, crossed: q.selfIntersecting.length };
  });
  check(quality.floating === 0 && quality.crossed === 0, `sin planos sueltos ni polígonos cruzados (${JSON.stringify(quality)})`);
  await page.evaluate(() => window.__encaje.store.set({ blockNames: false, blockLineWidth: 1, blockLevel: 'grande' }));

  // --- Fase 4: pasos E–H -------------------------------------------------------
  await page.getByRole('button', { name: /Planos de luz/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.l-lightPlanes .lp-face').length > 0, null, { timeout: 10000 }).catch(() => {});
  const lp = await page.evaluate(() => {
    const d = window.__encaje.derive(window.__encaje.store.get());
    return { faces: document.querySelectorAll('.l-lightPlanes .lp-face').length, light: !!d.light, gizmo: !!document.querySelector('.light-gizmo') };
  });
  check(lp.faces > 5 && lp.light && lp.gizmo, `paso E: planos sombreados, luz estimada y gizmo (${JSON.stringify(lp)})`);
  await page.locator('[data-fid=light-theta]').fill('270');
  const manual = await page.evaluate(() => window.__encaje.store.get().lightOverride);
  check(manual && manual.theta === 270, 'el deslizador de dirección elige la luz a mano');
  check(await page.getByRole('button', { name: 'Usar la luz de la foto' }).isVisible(), 'aparece «Usar la luz de la foto»');
  await page.getByRole('button', { name: 'Usar la luz de la foto' }).click();
  check((await page.evaluate(() => window.__encaje.store.get().lightOverride)) === null, '«Usar la luz de la foto» vuelve a la estimada');
  await page.getByLabel('Comparar con la foto').check();
  const cmp = await page.evaluate(() => ({ mode: window.__encaje.store.get().viewMode, label: document.querySelector('.pane-ref .pane-label')?.textContent }));
  check(cmp.mode === 'side' && cmp.label === 'Foto en 3 valores', `comparar: lado a lado con la foto en 3 valores (${JSON.stringify(cmp)})`);
  await page.screenshot({ path: `${out}/paso-E-comparar.png` });
  await page.getByLabel('Comparar con la foto').uncheck();
  for (const [btn, levels] of [[/Sombra en 2 valores/, 2], [/Medios tonos/, 3], [/Acentos y brillos/, 5]]) {
    await page.getByRole('button', { name: btn }).click();
    await page.waitForFunction(() => !!document.querySelector('.l-values .val-raster'), null, { timeout: 10000 }).catch(() => {});
    const v = await page.evaluate(() => ({ raster: !!document.querySelector('.l-values .val-raster'), map: window.__encaje.derive(window.__encaje.store.get()).values?.map }));
    check(v.raster && v.map?.levels === levels && v.map.thresholds.length === levels - 1, `${levels} valores con ${levels - 1} ${levels === 2 ? "umbral" : "umbrales"} de Otsu`);
  }
  const t0 = await page.evaluate(() => window.__encaje.derive(window.__encaje.store.get()).values.map.thresholds[1]);
  await page.locator('[data-fid=terminator]').fill('0.8');
  const t1 = await page.evaluate(() => window.__encaje.derive(window.__encaje.store.get()).values.map.thresholds[1]);
  check(t1 > t0, `el terminador mueve el umbral de la sombra (${t0.toFixed(2)} → ${t1.toFixed(2)})`);
  await page.getByLabel('Bordes rectos (block‑in)').check();
  await page.waitForFunction(() => document.querySelectorAll('.l-values .val-shape').length > 0, null, { timeout: 10000 }).catch(() => {});
  check((await page.evaluate(() => document.querySelectorAll('.l-values .val-shape').length)) >= 3, 'bordes rectos: masas como polígonos');
  await page.screenshot({ path: `${out}/paso-H-rectas.png` });
  await page.evaluate(() => window.__encaje.store.set({ terminator: 0, valueStraight: false }));

  // Diagnóstico visible.
  check(await page.locator('.diag-card h2').isVisible(), 'el diagnóstico está en el panel');

  // Cargar otra foto: el lienzo debe mostrar la nueva imagen (error encontrado en la fase 2).
  const firstId = await page.evaluate(() => window.__encaje.store.get().image.id);
  await page.setInputFiles('input[type=file]', process.env.SECOND_PHOTO ?? 'tests/fixtures/mediapipe/portrait.jpg');
  await page.waitForFunction((b) => { const s = window.__encaje.store.get(); return s.image.id !== b && s.status === 'ready'; }, firstId, { timeout: 60000 });
  const same = await page.evaluate(() => window.__encaje.viewer.imageSource === window.__encaje.store.get().image.canvas);
  check(same, 'al cargar otra foto, el lienzo muestra la nueva imagen');

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
