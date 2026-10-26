// Pulido (fase 7): teléfono sin scroll horizontal, todo con teclado (atajos,
// mover puntos con flechas, colocar en el centro de la vista en modo manual) y
// contraste AA del texto visible en los temas claro y oscuro.
// Uso: node tests/visual/polish.mjs [carpeta-salida]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'tests/screenshots/latest/pulido';
mkdirSync(out, { recursive: true });
const url = process.env.APP_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch();
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FALLA'} ${msg}`);
  if (!ok) fails++;
};
const errors = [];
const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__encaje.store.get();
    return ['ready', 'no-face', 'manual'].includes(s.status) && ['done', 'unavailable'].includes(s.segStatus);
  }, null, { timeout: 90000 });
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// ---------------------------------------------------------------- teléfono
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  const overflow = () =>
    page.evaluate(() => {
      const wide = [...document.querySelectorAll('body *')].filter((el) => {
        if (el.closest('dialog:not([open])')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > innerWidth + 1;
      });
      return { page: document.documentElement.scrollWidth - innerWidth, wide: wide.slice(0, 5).map((el) => `${el.tagName}.${el.className}`) };
    });
  let o = await overflow();
  check(o.page <= 0 && !o.wide.length, `teléfono, sin foto: sin scroll horizontal${o.wide.length ? ` (${o.wide.join(', ')})` : ''}`);
  await page.screenshot({ path: join(out, 'movil-vacio.png') });
  await page.evaluate(() => window.__encaje.openSample());
  await ready(page);
  for (const st of ['R', 'C', 'D', 'E', 'H']) {
    await page.evaluate((st) => window.__encaje.store.set({ step: st }), st);
    await settle(page);
    o = await overflow();
    check(o.page <= 0 && !o.wide.length, `teléfono, paso ${st}: sin scroll horizontal${o.wide.length ? ` (${o.wide.join(', ')})` : ''}`);
  }
  const layout = await page.evaluate(() => {
    const c = document.querySelector('.canvas-col').getBoundingClientRect();
    const p = document.querySelector('.panel').getBoundingClientRect();
    return { canvasTop: c.top, panelTop: p.top, canvasBottom: c.bottom };
  });
  check(layout.panelTop >= layout.canvasBottom - 1, 'teléfono: el lienzo arriba y el panel debajo');
  await page.evaluate(() => window.__encaje.store.set({ step: 'E' }));
  await settle(page);
  await page.screenshot({ path: join(out, 'movil-E.png') });
  await page.evaluate(() => document.querySelector('.workspace').scrollTo(0, document.querySelector('.panel').offsetTop - 40));
  await settle(page);
  await page.screenshot({ path: join(out, 'movil-E-panel.png') });
  await page.close();
}

// ---------------------------------------------------------------- teclado
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => window.__encaje.openSample());
  await ready(page);
  // Atajos con «?».
  await page.keyboard.press('?');
  check(await page.evaluate(() => document.querySelector('.shortcuts-dialog').open), '«?» abre los atajos de teclado');
  await page.screenshot({ path: join(out, 'atajos.png') });
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => !document.querySelector('.shortcuts-dialog').open), 'Esc cierra el diálogo');
  // Tab llega a los controles principales.
  const reached = new Set();
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    reached.add(await page.evaluate(() => document.activeElement?.dataset.fid ?? document.activeElement?.className ?? ''));
  }
  const tabbed = [...reached].join(' ');
  check(/export-open/.test(tabbed) && /shortcuts-open/.test(tabbed) && /step-btn/.test(tabbed) && /chip/.test(tabbed), 'Tab recorre cabecera, barra de capas y pasos');
  // Elegir un punto en la lista y moverlo con las flechas.
  await page.evaluate(() => window.__encaje.store.set({ step: 'R' }));
  await settle(page);
  const chip = page.locator('.key-chip', { hasText: 'Punta de la nariz' });
  await chip.focus();
  await page.keyboard.press('Enter');
  const before = await page.evaluate(() => window.__encaje.store.get().landmarks[4]);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const after = await page.evaluate(() => window.__encaje.store.get().landmarks[4]);
  check(Math.abs(after.x - before.x - 1) < 1e-6 && Math.abs(after.y - before.y - 10) < 1e-6, `con un punto elegido, las flechas lo mueven (Δ ${(after.x - before.x).toFixed(1)}, ${(after.y - before.y).toFixed(1)} px)`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  check(await page.evaluate(() => window.__encaje.store.get().step) === 'A', 'después de Esc, → pasa al paso siguiente');
  const label = await page.evaluate(() => document.querySelector('.pane-main canvas.photo').getAttribute('aria-label'));
  check(/paso A/.test(label), `el lienzo describe el paso (${label})`);
  // Modo manual con teclado: colocar en el centro de la vista y ajustar.
  await page.evaluate(() => window.__encaje.store.set({ step: 'R' }));
  await page.click('[data-fid="manual-start-r"]');
  await page.click('[data-fid="mview-profile"]');
  await page.evaluate(() => window.__encaje.viewer.focus({ x: 500, y: 500 }, 2));
  await settle(page);
  await page.click('[data-fid="manual-center"]');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowLeft');
  const m = await page.evaluate(() => {
    const s = window.__encaje.store.get();
    return { p: s.manual.points.nasion, c: window.__encaje.viewer.center(), next: s.manual.next };
  });
  check(m.p && Math.abs(m.p.x - (m.c.x - 1)) < 1e-6 && Math.abs(m.p.y - m.c.y) < 1e-6 && m.next === 'browPeakN', 'modo manual: «Colocar en el centro de la vista» y las flechas ajustan el punto');
  await page.close();
}

// ---------------------------------------------------------------- contraste AA
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => window.__encaje.openSample());
  await ready(page);
  const bad = new Map();
  let measured = 0;
  let minRatio = Infinity;
  for (const st of ['R', 'C', 'D', 'E', 'F']) {
    await page.evaluate((st) => window.__encaje.store.set({ step: st }), st);
    await settle(page);
    const found = await page.evaluate(() => {
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return { r, g, b, a };
      };
      const lum = ({ r, g, b }) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
      const bgOf = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c && c.a > 0) {
            layers.push(c);
            if (c.a >= 1) break;
          }
        }
        let bg = { r: 255, g: 255, b: 255, a: 1 };
        for (const c of layers.reverse()) bg = blend(c, bg);
        return bg;
      };
      const out = [];
      let count = 0;
      let min = Infinity;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        if (!el || el.closest('svg, dialog:not([open]), [hidden], .sr-only')) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (el.closest('button:disabled, input:disabled, select:disabled')) continue;
        let fg = parse(cs.color);
        let op = 1;
        for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
        const bg = bgOf(el);
        fg = blend({ ...fg, a: fg.a * op }, bg);
        const L1 = lum(fg);
        const L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        count++;
        min = Math.min(min, ratio);
        if (ratio < (large ? 3 : 4.5)) out.push({ text: n.textContent.trim().slice(0, 40), cls: `${el.tagName}.${el.className}`, ratio: Math.round(ratio * 100) / 100 });
      }
      return { out, count, min };
    });
    measured += found.count;
    minRatio = Math.min(minRatio, found.min);
    for (const f of found.out) bad.set(`${f.cls}|${f.ratio}`, f);
  }
  const list = [...bad.values()];
  check(!list.length && measured > 100, `contraste AA en tema ${theme === 'light' ? 'claro' : 'oscuro'} (${measured} textos, razón mínima ${minRatio.toFixed(2)})${list.length ? `: ${list.slice(0, 8).map((f) => `«${f.text}» ${f.cls} ${f.ratio}`).join(' | ')}` : ''}`);
  await page.evaluate(() => window.__encaje.store.set({ step: 'D' }));
  await settle(page);
  await page.screenshot({ path: join(out, `tema-${theme === 'light' ? 'claro' : 'oscuro'}-D.png`) });
  await page.close();
}

check(errors.length === 0, `sin errores en la página${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
console.log(fails ? `\n${fails} fallas` : '\nTodo OK');
process.exit(fails ? 1 : 0);
