// Luz con verdad conocida: la muestra 3D se renderiza con la luz clave en
// varias direcciones y se compara con la luz estimada (§8). Criterio: el lado
// iluminado coincide siempre y el error angular es moderado.
// Uso: node tests/visual/light-synth.mjs [carpeta-salida]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'tests/screenshots/latest/luz-sintetica';
mkdirSync(out, { recursive: true });
// θ: de dónde viene la luz (horario desde arriba); φ: ángulo con la cámara.
const CASES = [
  { theta: 45, phi: 55 },
  { theta: 315, phi: 55 },
  { theta: 90, phi: 70 },
  { theta: 270, phi: 70 },
  { theta: 0, phi: 45 },
  { theta: 135, phi: 50 },
  { theta: 225, phi: 60 },
  { theta: 60, phi: 25 },
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
const rows = [];
let fails = 0;
for (const c of CASES) {
  const r = await page.evaluate(async ({ theta, phi }) => {
    const { lightFromAngles } = await import('/src/geom/light.ts');
    const { SAMPLE_POSE } = await import('/src/sample/render.ts');
    await window.__encaje.openSample({ light: lightFromAngles(theta, phi), pose: SAMPLE_POSE });
    const { store, derive } = window.__encaje;
    for (let i = 0; i < 200 && !['done', 'unavailable'].includes(store.get().segStatus); i++) await new Promise((r) => setTimeout(r, 100));
    store.set({ step: 'E' });
    const d = derive(store.get());
    const L = lightFromAngles(theta, phi);
    const e = d.light;
    if (!e) return { theta, phi, est: null };
    const err = (Math.acos(Math.max(-1, Math.min(1, L.x * e.dir.x + L.y * e.dir.y + L.z * e.dir.z))) * 180) / Math.PI;
    // Lado iluminado: signo de la componente horizontal (si la luz no es casi frontal o vertical).
    const sideOk = Math.abs(L.x) < 0.2 || Math.sign(L.x) === Math.sign(e.dir.x);
    const vertOk = Math.abs(L.y) < 0.2 || Math.sign(L.y) === Math.sign(e.dir.y);
    return { theta, phi, est: { theta: +e.theta.toFixed(0), phi: +e.phi.toFixed(0), r2: +e.r2.toFixed(2), confident: e.confident }, err: +err.toFixed(1), sideOk, vertOk };
  }, c);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `luz-${c.theta}-${c.phi}.jpg`), quality: 80 });
  const ok = r.est && r.sideOk && r.vertOk && r.err <= 30;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FALLA'} luz θ=${c.theta}° φ=${c.phi}° → ${r.est ? `θ=${r.est.theta}° φ=${r.est.phi}° (error ${r.err}°, R² ${r.est.r2})` : 'sin estimación'}`);
  rows.push(r);
}
writeFileSync(join(out, 'luz-sintetica.json'), JSON.stringify({ fecha: new Date().toISOString(), casos: rows }, null, 1));
await browser.close();
console.log(fails ? `\n${fails} FALLAS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
