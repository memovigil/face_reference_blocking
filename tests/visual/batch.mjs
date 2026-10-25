// Corre la detección sobre una carpeta de fotos (p. ej. las referencias del
// usuario, que no se versionan) y guarda por foto: pose, verificación del
// signo, expresiones, resolución y una captura del paso «Revisar puntos».
// También clasifica cada foto en los casos del plan de pruebas (§12.1).
// Uso: node tests/visual/batch.mjs <carpeta-fotos> <carpeta-salida> [--no-shots]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const [, , dir, out, ...flags] = process.argv;
const shots = !flags.includes('--no-shots');
mkdirSync(out, { recursive: true });
const url = process.env.APP_URL ?? 'http://localhost:5173/';
const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);

/** Casos del plan de pruebas a partir de la detección. */
function classify(r) {
  if (r.status !== 'ready') return ['sin-cara'];
  const c = [];
  const { yaw, pitch, roll } = r.angles;
  const ay = Math.abs(yaw);
  if (ay < 10) c.push('frontal');
  else if (ay < 45) c.push(yaw < 0 ? 'tres-cuartos-izq' : 'tres-cuartos-der');
  else c.push('tres-cuartos-fuerte');
  if (Math.abs(roll) >= 10) c.push('inclinada');
  if (pitch <= -12) c.push('mira-arriba');
  if (pitch >= 12) c.push('mira-abajo');
  const b = r.blend;
  if ((b.mouthSmileLeft + b.mouthSmileRight) / 2 > 0.5) c.push('sonrisa');
  if (b.jawOpen > 0.3) c.push('boca-abierta');
  if (b.eyeBlinkLeft > 0.5 && b.eyeBlinkRight > 0.5) c.push('ojos-cerrados');
  if (b.mouthPucker > 0.7) c.push('labios-fruncidos');
  if (r.ipd < 45 || Math.max(r.size.w, r.size.h) <= 600) c.push('baja-resolucion');
  return c;
}

const rows = [];
for (const f of files) {
  const prev = await page.evaluate(() => window.__encaje.store.get().image?.id ?? null);
  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', join(dir, f));
  await page.waitForFunction(
    (prev) => {
      const s = window.__encaje.store.get();
      return s.image && s.image.id !== prev && ['ready', 'no-face', 'error'].includes(s.status);
    },
    prev,
    { timeout: 60000 },
  );
  const r = await page.evaluate(() => {
    const { store, derive } = window.__encaje;
    const s = store.get();
    const d = derive(s);
    const round = (a) => a && Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    const b = s.detection?.blendshapes ?? {};
    const pick = ['jawOpen', 'mouthSmileLeft', 'mouthSmileRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'mouthPucker'];
    return {
      status: s.status,
      size: { w: s.image.originalWidth, h: s.image.originalHeight },
      ms: s.detection ? Math.round(s.detection.ms) : null,
      angles: round(d?.pose.angles),
      mesh3D: round(d?.pose.mesh3DAngles),
      matrix: round(d?.pose.matrixAngles),
      agreement: d ? Math.round(d.pose.agreement * 10) / 10 : null,
      noseYaw: d ? Math.round(d.pose.sign.predictedYaw * 10) / 10 : null,
      signOk: d?.pose.sign.consistent ?? null,
      ipd: d ? Math.round(d.ipd) : null,
      rms: d ? Math.round(d.pose.frame.rms * 10) / 10 : null,
      blend: Object.fromEntries(pick.map((k) => [k, Math.round((b[k] ?? 0) * 100) / 100])),
    };
  });
  r.file = f;
  r.totalMs = Date.now() - t0;
  r.cases = classify(r);
  rows.push(r);
  if (shots) {
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(out, `${basename(f, extname(f))}.jpg`), quality: 80, clip: { x: 0, y: 138, width: 1018, height: 762 } });
  }
  const a = r.angles;
  console.log(`${f.padEnd(40)} ${r.status.padEnd(8)} ${a ? `giro ${String(a.yaw).padStart(6)} cab ${String(a.pitch).padStart(6)} incl ${String(a.roll).padStart(6)} nariz ${String(r.noseYaw).padStart(6)} ${r.signOk ? 'ok' : 'SIGNO?'}` : ''} ${r.cases.join(',')}`);
}
await browser.close();

const byCase = {};
for (const r of rows) for (const c of r.cases) (byCase[c] ??= []).push(r.file);
writeFileSync(join(out, 'resumen.json'), JSON.stringify({ fecha: new Date().toISOString(), dir, rows, byCase }, null, 1));
console.log('\nCasos:');
for (const [c, fs] of Object.entries(byCase).sort()) console.log(`  ${c.padEnd(20)} ${fs.length}`);
const bad = rows.filter((r) => r.signOk === false);
console.log(`\nDetectadas: ${rows.filter((r) => r.status === 'ready').length}/${rows.length} · signo inconsistente: ${bad.length}`);
// Falla si algún giro contradice la posición de la nariz.
process.exit(bad.length ? 1 : 0);
