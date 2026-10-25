// Criterios numéricos del blocking (§12.2) sobre un lote de fotos: planos sin
// vecinos, polígonos con autointersección, polígonos cóncavos y tiempo de
// cálculo, por nivel. Uso: node tests/visual/blocking-quality.mjs <foto|carpeta>… [--out=resumen.json]
import { chromium } from 'playwright';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outFile = args.find((a) => a.startsWith('--out='))?.slice(6);
const files = args
  .filter((a) => !a.startsWith('--'))
  .flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => join(p, f)) : [p]));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
await page.evaluate(async () => {
  window.__bk = await import('/src/geom/blocking.ts');
});
const rows = [];
for (const f of files) {
  const prev = await page.evaluate(() => window.__encaje.store.get().image?.id ?? null);
  await page.setInputFiles('input[type=file]', f);
  await page.waitForFunction(
    (prev) => {
      const s = window.__encaje.store.get();
      return s.image && s.image.id !== prev && (['no-face', 'error'].includes(s.status) || (s.status === 'ready' && ['done', 'unavailable'].includes(s.segStatus)));
    },
    prev,
    { timeout: 60000 },
  );
  const r = await page.evaluate(() => {
    const { store, derive } = window.__encaje;
    const s0 = store.get();
    if (s0.status !== 'ready') return null;
    const out = { yaw: 0, levels: {} };
    for (const level of ['grande', 'medio', 'fino']) {
      store.set({ step: 'D', blockLevel: level });
      // Medición limpia del tiempo (sin la memoria de la etapa).
      const d = derive(store.get());
      const t0 = performance.now();
      const again = window.__bk.buildBlocking(store.get().landmarks, level, d.ipd, {
        frame: d.pose.frame,
        frontal: d.frontal.points,
        center: d.loomis.sphere.center,
        radius: d.loomis.sphere.radius,
        ears: [],
      });
      const ms = performance.now() - t0;
      const q = window.__bk.blockingQuality(d.blocking);
      out.yaw = d.pose.angles.yaw;
      out.levels[level] = { faces: q.faces, floating: q.floating, selfIntersecting: q.selfIntersecting, concave: q.concave.length, ms, visibles: d.blocking.faces.filter((x) => x.front).length, again: again.faces.length };
    }
    return out;
  });
  rows.push({ file: f.split('/').slice(-2).join('/'), ...r });
  process.stdout.write(r ? '.' : 'x');
}
console.log();
await browser.close();
const ok = rows.filter((r) => r.levels);
const summary = {};
for (const level of ['grande', 'medio', 'fino']) {
  const L = ok.map((r) => r.levels[level]);
  const ms = L.map((x) => x.ms).sort((a, b) => a - b);
  summary[level] = {
    fotos: L.length,
    planos: L[0]?.faces,
    conPlanosSueltos: L.filter((x) => x.floating.length).length,
    planosSueltos: [...new Set(L.flatMap((x) => x.floating))],
    conAutointerseccion: L.filter((x) => x.selfIntersecting.length).length,
    fotosConAutointerseccion: ok.filter((r) => r.levels[level].selfIntersecting.length).map((r) => r.file),
    autointersecciones: Object.entries(L.flatMap((x) => x.selfIntersecting).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 8),
    concavosPromedio: +(L.reduce((a, x) => a + x.concave, 0) / L.length).toFixed(1),
    msMediana: +ms[Math.floor(ms.length / 2)].toFixed(1),
    msP95: +ms[Math.floor(ms.length * 0.95)].toFixed(1),
    msMax: +ms[ms.length - 1].toFixed(1),
  };
}
console.log(JSON.stringify(summary, null, 1));
if (outFile) writeFileSync(outFile, JSON.stringify({ fecha: new Date().toISOString(), summary }, null, 1));
