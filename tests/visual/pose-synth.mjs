// Verdad conocida para la pose: gira en 3D la cara frontal detectada (texturizada
// con la foto) ángulos exactos y vuelve a detectar. Imprime giro aplicado vs medido.
// Uso: node tests/visual/pose-synth.mjs <foto-frontal> [carpeta-capturas]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [, , photo, shots] = process.argv;
const url = process.env.APP_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);
// Espera a que cambie la imagen y termine la detección.
async function load(trigger) {
  const prev = await page.evaluate(() => window.__encaje.store.get().image?.id ?? null);
  await trigger();
  await page.waitForFunction(
    (prev) => {
      const s = window.__encaje.store.get();
      return s.image && s.image.id !== prev && ['ready', 'no-face', 'error'].includes(s.status);
    },
    prev,
    { timeout: 60000 },
  );
}
const loadPhoto = () => load(() => page.setInputFiles('input[type=file]', photo));
await loadPhoto();
const angles = () => page.evaluate(() => {
  const { store, derive } = window.__encaje;
  const s = store.get();
  const d = derive(s);
  if (s.status !== 'ready') return { status: s.status };
  // Comparación con la geometría exacta del render (si es sintético).
  const truth = window.__lastSynth && !/\.(png|jpe?g|webp)$/i.test(s.image.name) ? window.__lastSynth.rotated : null;
  let err2d = null, zSlope = null;
  if (truth) {
    const lm = s.landmarks;
    const ipd = d.ipd;
    let e = 0, n = 0, szz = 0, sz2 = 0, mzT = 0, mzD = 0;
    for (let i = 0; i < 468; i++) { mzT += truth[i].z; mzD += lm[i].z; }
    mzT /= 468; mzD /= 468;
    for (let i = 0; i < 468; i++) {
      e += Math.hypot(lm[i].x - truth[i].x, lm[i].y - truth[i].y); n++;
      szz += (lm[i].z - mzD) * (truth[i].z - mzT); sz2 += (truth[i].z - mzT) ** 2;
    }
    err2d = e / n / ipd; zSlope = szz / sz2;
  }
  return { ...d.pose.fitAngles, m: d.pose.matrixAngles, m3: d.pose.mesh3DAngles, sign: d.pose.sign, err2d, zSlope };
});
const base = await angles();
const rows = [];
if (shots) mkdirSync(shots, { recursive: true });
for (const [yaw, pitch] of [[-45, 0], [-30, 0], [-15, 0], [15, 0], [30, 0], [45, 0], [0, -20], [0, 20], [-30, 15]]) {
  // Volver a la foto original para tener la malla frontal.
  await loadPhoto();
  const u = await page.evaluate(([y, p]) => window.__encaje.synthRotate(y, p), [yaw, pitch]);
  // la imagen sintética no tiene extensión en el nombre (blob)
  await load(() => page.evaluate((u) => window.__encaje.openUrl(u), u));
  const a = await angles();
  if (shots) await page.screenshot({ path: `${shots}/synth_${yaw}_${pitch}.png` });
  const row = a.status
    ? { yaw, pitch, status: a.status }
    : {
        yaw, pitch,
        dYaw: +(a.yaw - base.yaw).toFixed(1),
        dPitch: +(a.pitch - base.pitch).toFixed(1),
        errYaw: +((a.yaw - base.yaw) - yaw).toFixed(1),
        errPitch: +((a.pitch - base.pitch) - pitch).toFixed(1),
        matrixDYaw: +(a.m.yaw - base.m.yaw).toFixed(1),
        mesh3D: [+(a.m3.yaw - base.m3.yaw).toFixed(1), +(a.m3.pitch - base.m3.pitch).toFixed(1)],
        err2dIPD: a.err2d && +a.err2d.toFixed(3),
        zSlope: a.zSlope && +a.zSlope.toFixed(2),
        noseYaw: +a.sign.predictedYaw.toFixed(1),
        signOk: a.sign.consistent,
      };
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (shots) writeFileSync(`${shots}/pose-synth.json`, JSON.stringify({ photo, base, rows }, null, 1));
await browser.close();
// Criterio (§12.2): signo correcto y error ≤ 10° respecto del ángulo aplicado.
const bad = rows.filter((r) => r.status || !r.signOk || Math.abs(r.errYaw) > 10 || Math.abs(r.errPitch) > 10);
console.log(bad.length ? `FALLA: ${bad.length} casos fuera de ±10°` : `OK: ${rows.length} casos dentro de ±10° y con signo correcto`);
process.exit(bad.length ? 1 : 0);
