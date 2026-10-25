// Malla canónica con los índices de cada vértice, de frente y de perfil, para
// elegir y verificar los puntos que definen las regiones del blocking.
// Uso: node tests/visual/mesh-labels.mjs <carpeta-salida> [escala=110]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const S = Number(process.argv[3] ?? 110);
mkdirSync(out, { recursive: true });
const src = readFileSync('src/data/canonicalFace.ts', 'utf8');
const V = JSON.parse(src.match(/CANONICAL_VERTICES = new Float32Array\((\[[^\]]+\])\)/)[1]);
const T = JSON.parse(src.match(/CANONICAL_TRIANGLES = new Uint16Array\((\[[^\]]+\])\)/)[1]);
const P = (i) => ({ x: V[i * 3], y: V[i * 3 + 1], z: V[i * 3 + 2] });

function svg(view) {
  // view: 'front' (x, y) o 'side' (−z, y): perfil derecho del sujeto.
  const proj = (p) => (view === 'front' ? [p.x, p.y] : [-p.z, p.y]);
  const pts = Array.from({ length: 468 }, (_, i) => proj(P(i)));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - 0.5, x1 = Math.max(...xs) + 0.5, y0 = Math.min(...ys) - 0.5, y1 = Math.max(...ys) + 0.5;
  const W = (x1 - x0) * S, H = (y1 - y0) * S;
  const X = (p) => ((p[0] - x0) * S).toFixed(1);
  const Y = (p) => ((y1 - p[1]) * S).toFixed(1);
  let body = '';
  for (let t = 0; t < T.length; t += 3) {
    const [a, b, c] = [T[t], T[t + 1], T[t + 2]];
    // De perfil solo los triángulos del lado derecho del sujeto (x ≤ 0.2).
    if (view === 'side' && (P(a).x > 0.2 || P(b).x > 0.2 || P(c).x > 0.2)) continue;
    body += `<path d="M${X(pts[a])} ${Y(pts[a])}L${X(pts[b])} ${Y(pts[b])}L${X(pts[c])} ${Y(pts[c])}Z" fill="none" stroke="#9ab" stroke-width="0.6"/>`;
  }
  for (let i = 0; i < 468; i++) {
    if (view === 'side' && P(i).x > 0.2) continue;
    body += `<circle cx="${X(pts[i])}" cy="${Y(pts[i])}" r="1.6" fill="#d22"/><text x="${(+X(pts[i]) + 2).toFixed(1)}" y="${(+Y(pts[i]) - 2).toFixed(1)}" font-size="${(S / 14).toFixed(1)}" font-family="monospace" fill="#111">${i}</text>`;
  }
  return { W: Math.ceil(W), H: Math.ceil(H), doc: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>` };
}

const browser = await chromium.launch();
for (const view of ['front', 'side']) {
  const { W, H, doc } = svg(view);
  writeFileSync(join(out, `malla-${view}.svg`), doc);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(doc);
  await page.screenshot({ path: join(out, `malla-${view}.png`) });
  await page.close();
  console.log(view, W, H);
}
await browser.close();
