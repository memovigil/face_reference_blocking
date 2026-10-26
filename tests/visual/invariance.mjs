// Prueba de invariancia (§5.4): las métricas de la misma persona en ángulos
// distintos deben coincidir dentro de ±5 %. Usa tests/fixtures/user/grupos.json
// (fotos del usuario, no versionadas). Con ALL=1 calcula la mediana y la
// dispersión de cada métrica en la población, para calibrar el canon: una sola
// entrada por persona (los grupos se reducen a su mediana). En los dos modos
// entran solo las fotos de mujeres (ver solo-mujeres.mjs).
// Uso: node tests/visual/invariance.mjs [salida.json]
import { chromium } from 'playwright';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isExcluded } from './solo-mujeres.mjs';

const out = process.argv[2];
const base = 'tests/fixtures/user';
const groups = JSON.parse(readFileSync(join(base, 'grupos.json'), 'utf8')).grupos;
const url = process.env.APP_URL ?? 'http://localhost:5173/';
const METHODS = (process.env.METHODS ?? 'rayPlane,detector3d').split(',');

const resolve = (item) => {
  const [dir, pre] = item.split('/');
  const f = readdirSync(join(base, dir)).find((x) => x.startsWith(pre));
  return join(base, dir, f);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(url);
await page.evaluate(async () => {
  window.__fr = await import('/src/geom/frontal.ts');
  window.__mt = await import('/src/geom/metrics.ts');
});

async function measure(file) {
  const prev = await page.evaluate(() => window.__encaje.store.get().image?.id ?? null);
  await page.setInputFiles('input[type=file]', file);
  // Espera también la segmentación: las métricas de cabello y cráneo dependen de ella.
  await page.waitForFunction(
    (prev) => {
      const s = window.__encaje.store.get();
      return s.image && s.image.id !== prev && (['no-face', 'error'].includes(s.status) || (s.status === 'ready' && ['done', 'unavailable'].includes(s.segStatus)));
    },
    prev,
    { timeout: 60000 },
  );
  return page.evaluate((METHODS) => {
    const { store, derive } = window.__encaje;
    const s = store.get();
    if (s.status !== 'ready') return null;
    const d = derive(s);
    const b = s.detection.blendshapes;
    const expr = {
      smile: ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2 > 0.4,
      jawOpen: (b.jawOpen ?? 0) > 0.3,
      eyesClosed: (b.eyeBlinkLeft ?? 0) > 0.5 && (b.eyeBlinkRight ?? 0) > 0.5,
      pucker: (b.mouthPucker ?? 0) > 0.7,
      lipsO: (b.jawOpen ?? 0) > 0.3 && (b.mouthFunnel ?? 0) + (b.mouthPucker ?? 0) > 0.6,
    };
    const res = {
      yaw: d.pose.angles.yaw,
      pitch: d.pose.angles.pitch,
      expr,
      methods: {},
      // Métricas del pipeline completo (silueta, Loomis, mentón cerrado…).
      pipeline: Object.fromEntries(d.metrics.map((v) => [v.def.id, { value: v.value, reliable: v.reliable, note: v.note ?? null }])),
    };
    for (const m of METHODS) {
      const face = window.__fr.toFrontal(s.landmarks, d.pose.frame, m);
      const depthFace = window.__fr.toFrontal(s.landmarks, d.pose.frame, 'detector3d');
      const vals = window.__mt.computeMetrics({ face, depthFace, yaw: d.pose.angles.yaw, expression: expr });
      res.methods[m] = Object.fromEntries(vals.map((v) => [v.def.id, { value: v.value, reliable: v.reliable }]));
    }
    return res;
  }, METHODS);
}

const KEYS = ['middleOverLower', 'mouthNoseChin', 'eyeSpacing', 'noseWidth', 'mouthWidth', 'jawCheek', 'canthalTilt', 'mouthCorners', 'noseProjection', 'chinProjection'];
// En grados o en fracción de la unidad (valores cerca de 0): desviación absoluta.
const ABS = { canthalTilt: 1, mouthCorners: 100, chinProjection: 100 };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

// Modo población: todas las fotos de tests/fixtures/user/*, para calibrar el canon.
if (process.env.ALL) {
  const all = [];
  for (const dir of readdirSync(base).filter((d) => !d.includes('.'))) {
    for (const f of readdirSync(join(base, dir)).filter((x) => /\.(jpe?g|png)$/i.test(x))) {
      if (isExcluded(`${dir}/${f}`)) continue;
      const r = await measure(join(base, dir, f));
      if (r) all.push({ file: `${dir}/${f}`, ...r });
      process.stdout.write('.');
    }
  }
  console.log();
  // Una entrada por persona: las fotos de un mismo grupo se reducen a la mediana de cada métrica.
  const groupOf = (file) => Object.entries(groups).find(([, items]) => items.some((it) => file.startsWith(it)))?.[0];
  const people = new Map();
  for (const r of all) {
    const key = groupOf(r.file) ?? r.file;
    people.set(key, [...(people.get(key) ?? []), r]);
  }
  const personValue = (rows, k) => {
    const vals = rows.map((r) => r.pipeline[k]).filter((v) => v && v.reliable).map((v) => v.value);
    return vals.length ? median(vals) : null;
  };
  const canon = await page.evaluate(() => Object.fromEntries(Object.entries(window.__mt.METRICS).map(([k, v]) => [k, v.canon])));
  console.log(`${all.length} fotos, ${people.size} personas, ${excluded.length} excluidas`);
  console.log(`métrica           canon actual  mediana   sd robusta  n (personas con valor confiable)`);
  const stats = {};
  for (const k of Object.keys(canon)) {
    const vals = [...people.values()].map((rows) => personValue(rows, k)).filter((v) => v !== null);
    if (!vals.length) continue;
    const med = median(vals);
    const mad = median(vals.map((v) => Math.abs(v - med)));
    stats[k] = { canon: canon[k], median: med, sd: 1.4826 * mad, n: vals.length };
    console.log(`  ${k.padEnd(16)} ${canon[k].toFixed(3).padStart(8)}  ${med.toFixed(3).padStart(8)}  ${(1.4826 * mad).toFixed(3).padStart(8)}  ${vals.length}`);
  }
  if (out) writeFileSync(out, JSON.stringify({ fecha: new Date().toISOString(), fotos: all.length, personas: people.size, excluidas: excluded.length, stats, all }, null, 1));
  await browser.close();
  process.exit(0);
}

const data = {};
for (const [g, items] of Object.entries(groups)) {
  data[g] = [];
  for (const it of items.filter((x) => !isExcluded(x))) {
    const r = await measure(resolve(it));
    if (r) data[g].push({ file: it, ...r });
    process.stdout.write('.');
  }
}
console.log();

// Desviación de cada foto respecto de la mediana de su grupo.
const summary = {};
for (const m of METHODS) {
  summary[m] = {};
  for (const k of KEYS) {
    const devs = [];
    for (const rows of Object.values(data)) {
      const vals = rows.map((r) => r.methods[m][k]).filter((v) => v && v.reliable).map((v) => v.value);
      if (vals.length < 2) continue;
      const med = median(vals);
      for (const v of vals) devs.push(k in ABS ? Math.abs(v - med) * ABS[k] : Math.abs(v - med) / Math.abs(med) * 100);
    }
    if (!devs.length) continue;
    summary[m][k] = {
      n: devs.length,
      mediaDesv: +(devs.reduce((a, b) => a + b, 0) / devs.length).toFixed(2),
      p90: +[...devs].sort((a, b) => a - b)[Math.floor(devs.length * 0.9)].toFixed(2),
      dentro5: +(devs.filter((d) => d <= 5).length / devs.length * 100).toFixed(0),
      unidad: k === 'canthalTilt' ? '°' : k in ABS ? '% de la unidad' : '%',
    };
  }
}
for (const m of METHODS) {
  console.log(`\n== ${m}: desviación respecto de la mediana del grupo`);
  for (const [k, v] of Object.entries(summary[m])) console.log(`  ${k.padEnd(16)} media ${String(v.mediaDesv).padStart(5)}${v.unidad}  p90 ${String(v.p90).padStart(5)}${v.unidad}  ≤5: ${v.dentro5}%  (n=${v.n})`);
}
if (out) writeFileSync(out, JSON.stringify({ fecha: new Date().toISOString(), summary, data }, null, 1));
await browser.close();
