// Pinta la malla canónica por región del blocking (niveles grande, medio y
// fino), de frente, en ¾ y de perfil, con el nombre de cada región en su
// centro. Sirve para verificar a ojo la partición de geom/planes.ts.
// Uso: node tests/visual/regions.mjs <carpeta-salida>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'tests/screenshots/latest/regiones';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.goto(process.env.APP_URL ?? 'http://localhost:5173/');
const res = await page.evaluate(async () => {
  const P = await import('/src/geom/planes.ts');
  const C = await import('/src/data/canonicalFace.ts');
  const t0 = performance.now();
  P.fineTriangleRegions();
  const ms = performance.now() - t0;
  const V = C.CANONICAL_VERTICES;
  const views = { frente: 0, tres_cuartos: 35, perfil: 80 };
  const images = {};
  const stats = {};
  for (const level of P.BLOCK_LEVELS) {
    const part = P.levelPartition(level);
    stats[level] = { regiones: part.regions.length, triangulos: part.regions.map((r) => `${r.id}:${r.tris.length}`) };
    const hue = (i) => (i * 137.508) % 360;
    for (const [vname, yaw] of Object.entries(views)) {
      const cv = document.createElement('canvas');
      cv.width = 900;
      cv.height = 1000;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 900, 1000);
      const a = (yaw * Math.PI) / 180;
      const S = 46;
      const pr = (i) => {
        const x = V[i * 3], y = V[i * 3 + 1], z = V[i * 3 + 2];
        // +yaw: la cara mira a la derecha de la imagen.
        const X = x * Math.cos(a) + z * Math.sin(a);
        const Z = -x * Math.sin(a) + z * Math.cos(a);
        return { x: 450 + X * S, y: 470 - y * S, z: Z };
      };
      const { tris } = P.meshTopology();
      const order = tris.map((t, i) => i).sort((i, j) => {
        const zi = tris[i].reduce((s, v) => s + pr(v).z, 0);
        const zj = tris[j].reduce((s, v) => s + pr(v).z, 0);
        return zi - zj;
      });
      for (const ti of order) {
        const t = tris[ti];
        const p = t.map(pr);
        const cross = (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x);
        const r = part.triRegion[ti];
        g.beginPath();
        g.moveTo(p[0].x, p[0].y);
        g.lineTo(p[1].x, p[1].y);
        g.lineTo(p[2].x, p[2].y);
        g.closePath();
        g.fillStyle = `hsl(${hue(r)} 55% ${68}%)`;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.12)';
        g.lineWidth = 0.5;
        g.stroke();
      }
      // Fronteras entre regiones.
      const edgeOwner = new Map();
      tris.forEach((t, ti) => {
        for (const [u, w] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
          const k = u < w ? `${u}-${w}` : `${w}-${u}`;
          edgeOwner.set(k, [...(edgeOwner.get(k) ?? []), part.triRegion[ti]]);
        }
      });
      g.strokeStyle = '#111';
      g.lineWidth = 1.6;
      for (const [k, rs] of edgeOwner) {
        if (rs.length === 2 && rs[0] === rs[1]) continue;
        const [u, w] = k.split('-').map(Number);
        const pu = pr(u), pw = pr(w);
        // Solo de la mitad visible.
        if (yaw > 50 && (V[u * 3] > 0.5 || V[w * 3] > 0.5)) continue;
        g.beginPath();
        g.moveTo(pu.x, pu.y);
        g.lineTo(pw.x, pw.y);
        g.stroke();
      }
      g.font = '11px sans-serif';
      g.textAlign = 'center';
      part.regions.forEach((reg, ri) => {
        let x = 0, y = 0, z = 0, n = 0;
        for (const ti of reg.tris) for (const v of tris[ti]) { const p = pr(v); x += p.x; y += p.y; z += V[v * 3]; n++; }
        if (yaw > 50 && z / n > 0.3) return;
        g.fillStyle = '#000';
        g.fillText(reg.id, x / n, y / n);
      });
      images[`${level}-${vname}`] = cv.toDataURL('image/png');
    }
  }
  return { images, stats, ms };
});
for (const [k, url] of Object.entries(res.images)) writeFileSync(join(out, `${k}.png`), Buffer.from(url.split(',')[1], 'base64'));
writeFileSync(join(out, 'regiones.json'), JSON.stringify({ msParticion: res.ms, ...res.stats }, null, 1));
console.log(`partición: ${res.ms.toFixed(1)} ms;`, Object.entries(res.stats).map(([k, v]) => `${k} ${v.regiones}`).join(', '));
await browser.close();
