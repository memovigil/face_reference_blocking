// Corre las pruebas visuales de la fase actual y guarda capturas en
// tests/screenshots/latest/ (ignorada por git) para revisarlas a mano.
//   1. Cada foto de tests/fixtures/** → captura del paso «Revisar puntos» + datos.
//   2. Pose con verdad conocida (pose-synth.mjs) sobre la foto frontal.
//   3. Interacciones del visor (interact.mjs).
// Levanta el servidor de Vite si no está corriendo.
// Uso: npm run test:visual
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'tests/screenshots/latest');
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });

async function up() {
  try {
    return (await fetch(APP_URL)).ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await up())) {
  server = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
}

function run(script, args) {
  return new Promise((resolve) => {
    const p = spawn('node', [join(root, 'tests/visual', script), ...args], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, APP_URL } });
    let text = '';
    p.stdout.on('data', (d) => {
      text += d;
      process.stdout.write(d);
    });
    p.on('close', (code) => resolve({ code, text }));
  });
}

function fixtures(dir) {
  const res = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) res.push(...fixtures(p));
    else if (/\.(jpe?g|png|webp)$/i.test(name)) res.push(p);
  }
  return res.sort();
}

const summary = [];
for (const f of fixtures(join(root, 'tests/fixtures'))) {
  const name = basename(f, extname(f));
  console.log(`\n== ${name}`);
  const r = await run('probe.mjs', [f, join(out, `revisar-${name}`)]);
  summary.push({ fixture: f.replace(root + '/', ''), code: r.code, result: r.text.trim().split('\n').pop() });
}

console.log('\n== pose con verdad conocida');
const synth = await run('pose-synth.mjs', [join(root, 'tests/fixtures/mediapipe/face_stylizer_raw_face_demo.png'), join(out, 'synth')]);
console.log('\n== interacciones');
const inter = await run('interact.mjs', [join(root, 'tests/fixtures/mediapipe/face_stylizer_raw_face_demo.png'), join(out, 'interaccion')]);

writeFileSync(join(out, 'resumen.json'), JSON.stringify({ fecha: new Date().toISOString(), summary, synth: synth.code, interact: inter.code }, null, 1));
server?.kill();
const failed = summary.some((s) => s.code) || synth.code || inter.code;
console.log(failed ? '\nHAY FALLAS — revisa la salida' : `\nListo. Capturas en ${out.replace(root + '/', '')}`);
process.exit(failed ? 1 : 0);
