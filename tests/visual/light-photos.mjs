// Luz estimada en un lote de fotos: guarda la cara recortada con una flecha que
// apunta desde la luz (para revisar a ojo) y, si hay etiquetas en
// tests/fixtures/user/luz.json ({"archivo": "izquierda" | "derecha"}), mide si
// el lado iluminado coincide (§8, §12.2). Solo fotos de mujeres (ver solo-mujeres.mjs).
// Uso: node tests/visual/light-photos.mjs <salida> <foto|carpeta>…  (NOARROW=1: recortes sin flecha, para etiquetar)
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { soloMujeres } from './solo-mujeres.mjs';

const [out, ...inputs] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const files = soloMujeres(inputs.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort().map((f) => join(p, f)) : [p])));
const labelsFile = 'tests/fixtures/user/luz.json';
const labels = existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, 'utf8')).lados : {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
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
  const r = await page.evaluate((noArrow) => {
    const { store, derive } = window.__encaje;
    if (store.get().status !== 'ready') return null;
    store.set({ step: 'E' });
    const s = store.get();
    const d = derive(s);
    const e = d.light;
    // Recorte de la cara con la flecha de la luz.
    const lm = s.landmarks;
    const xs = lm.map((p) => p.x);
    const ys = lm.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.75;
    const cv = document.createElement('canvas');
    cv.width = 300;
    cv.height = 300;
    const g = cv.getContext('2d');
    g.fillStyle = '#888';
    g.fillRect(0, 0, 300, 300);
    g.drawImage(s.image.canvas, cx - half, cy - half, 2 * half, 2 * half, 0, 0, 300, 300);
    if (e && !noArrow) {
      const l = Math.hypot(e.dir.x, e.dir.y);
      const ux = l > 0.05 ? e.dir.x / l : 0;
      const uy = l > 0.05 ? -e.dir.y / l : 0;
      g.strokeStyle = e.confident ? '#e33' : '#e9a23b';
      g.fillStyle = g.strokeStyle;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(150 + ux * 140, 150 + uy * 140);
      g.lineTo(150 + ux * 60, 150 + uy * 60);
      g.stroke();
      g.beginPath();
      g.arc(150 + ux * 140, 150 + uy * 140, 9, 0, Math.PI * 2);
      g.fill();
      g.font = 'bold 16px sans-serif';
      g.fillStyle = '#fff';
      g.strokeStyle = '#000';
      g.lineWidth = 3;
      const t = `θ${e.theta.toFixed(0)} φ${e.phi.toFixed(0)} R²${e.r2.toFixed(2)}`;
      g.strokeText(t, 8, 292);
      g.fillText(t, 8, 292);
    }
    return { img: cv.toDataURL('image/jpeg', 0.85), est: e ? { theta: e.theta, phi: e.phi, r2: e.r2, contrast: e.contrast, confident: e.confident, x: e.dir.x } : null };
  }, !!process.env.NOARROW);
  const name = basename(f);
  if (r) writeFileSync(join(out, `${name.slice(0, 12)}.jpg`), Buffer.from(r.img.split(',')[1], 'base64'));
  const key = Object.keys(labels).find((k) => name.startsWith(k));
  const label = key ? labels[key] : null;
  const side = r?.est ? (r.est.x > 0.15 ? 'derecha' : r.est.x < -0.15 ? 'izquierda' : 'frente') : null;
  rows.push({ file: name.slice(0, 12), est: r?.est ?? null, label, side, ok: label ? label === side : null });
  process.stdout.write(label ? (label === side ? 'o' : 'X') : '.');
}
console.log();
await browser.close();
const labeled = rows.filter((r) => r.label);
const ok = labeled.filter((r) => r.ok).length;
console.log(`etiquetadas: ${labeled.length}, lado correcto: ${ok}`);
for (const r of labeled.filter((r) => !r.ok)) console.log(`  FALLA ${r.file}: etiqueta ${r.label}, estimado ${r.side} (θ ${r.est?.theta.toFixed(0)}, φ ${r.est?.phi.toFixed(0)}, R² ${r.est?.r2.toFixed(2)})`);
writeFileSync(join(out, 'luz-fotos.json'), JSON.stringify({ fecha: new Date().toISOString(), etiquetadas: labeled.length, ladoCorrecto: ok, filas: rows }, null, 1));
process.exit(labeled.length && ok < labeled.length ? 1 : 0);
