// Un paso como imagen: las mismas capas del visor en un SVG autónomo (estilos
// calculados en línea, fuentes incrustadas y siempre con los colores del tema
// claro), rasterizado sobre la foto original a la resolución que se pida.
//
// Las líneas del visor tienen grosor fijo en pantalla (non-scaling-stroke) y
// las etiquetas viven en grupos de tamaño de pantalla. Al exportar se fijan en
// px de la imagen, escalados como se ven con la foto a unos 900 px de alto.

import { LayerRenderer } from '../draw/layers';
import type { Derived } from '../state/derived';
import type { AppState } from '../state/store';
import type { WorkImage } from '../image/load';

const SVG_NS = 'http://www.w3.org/2000/svg';

const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'display',
  'paint-order',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'mix-blend-mode',
] as const;

/** Escala de líneas y etiquetas (px de imagen por px de pantalla con la foto a ~900 px). */
export function lineScale(w: number, h: number): number {
  return Math.max(0.8, Math.max(w, h) / 900);
}

/** SVG autónomo de las capas de `state.step`, en coordenadas de la imagen de trabajo. */
export async function overlaySvg(state: AppState, d: Derived, outW: number, outH: number, boost = 1): Promise<string> {
  const img = state.image!;
  const W = img.width;
  const H = img.height;
  const f = lineScale(W, H) * boost;
  const host = document.createElement('div');
  host.className = 'export-host export-light';
  host.style.cssText = `position:fixed;left:${-W - 200}px;top:0;width:${W}px;height:${H}px;opacity:0;pointer-events:none;`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'overlay');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.style.setProperty('--s', String(1 / f));
  const root = document.createElementNS(SVG_NS, 'g');
  root.setAttribute('class', 'layers');
  svg.append(root);
  host.append(svg);
  document.body.append(host);
  try {
    new LayerRenderer(root).render(state, d);
    const fonts = await fontFaces(svg);
    const clone = inlineStyles(svg, f);
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', String(outW));
    clone.setAttribute('height', String(outH));
    clone.removeAttribute('style');
    if (fonts) {
      const style = document.createElementNS(SVG_NS, 'style');
      style.textContent = fonts;
      clone.insertBefore(style, clone.firstChild);
    }
    return new XMLSerializer().serializeToString(clone);
  } finally {
    host.remove();
  }
}

/** Copia del SVG con los estilos calculados en línea y sin clases. */
function inlineStyles(src: SVGSVGElement, f: number): SVGSVGElement {
  const clone = src.cloneNode(true) as SVGSVGElement;
  const from = [src, ...src.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  from.forEach((el, i) => {
    const out = to[i];
    const cs = getComputedStyle(el);
    // Dentro de un grupo de pantalla el grosor ya escala con el grupo.
    const screen = !!el.closest('.ss');
    const parts: string[] = [];
    for (const p of STYLE_PROPS) {
      let v = cs.getPropertyValue(p);
      if (!v) continue;
      if (!screen && (p === 'stroke-width' || p === 'stroke-dasharray') && v !== 'none') v = scaleLengths(v, f);
      parts.push(`${p}:${v}`);
    }
    parts.push('vector-effect:none');
    if (el.tagName === 'circle') {
      const r = parseFloat(cs.getPropertyValue('r'));
      if (Number.isFinite(r)) out.setAttribute('r', String(r));
    }
    if (el.classList.contains('ss') && cs.transform && cs.transform !== 'none') out.setAttribute('transform', cs.transform);
    out.setAttribute('style', parts.join(';'));
    out.removeAttribute('class');
  });
  return clone;
}

function scaleLengths(v: string, f: number): string {
  return v
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((x) => `${(parseFloat(x) * f).toFixed(2)}px`)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Fuentes: las del texto del SVG, incrustadas (un SVG como imagen no carga
// archivos externos). Solo el subconjunto latino, que cubre el español.

const fontCache = new Map<string, string>();

async function fontFaces(svg: SVGSVGElement): Promise<string> {
  const wanted = new Map<string, { family: string; weight: string }>();
  for (const t of svg.querySelectorAll('text')) {
    const cs = getComputedStyle(t);
    if (cs.display === 'none') continue;
    const family = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    const weight = cs.fontWeight;
    wanted.set(`${family}|${weight}`, { family, weight });
  }
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of document.styleSheets) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of list) if (r instanceof CSSFontFaceRule) rules.push(r);
  }
  let css = '';
  for (const { family, weight } of wanted.values()) {
    const rule = rules.find((r) => {
      const fam = r.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '');
      const range = r.style.getPropertyValue('unicode-range');
      return fam === family && r.style.getPropertyValue('font-weight').trim() === weight && (!range || /U\+0+-0*FF\b/i.test(range));
    });
    if (!rule) continue;
    const m = /url\(["']?([^"')]+\.woff2)["']?\)/.exec(rule.style.getPropertyValue('src'));
    if (!m) continue;
    const url = new URL(m[1], rule.parentStyleSheet?.href ?? location.href).href;
    let data = fontCache.get(url);
    if (!data) {
      try {
        data = toBase64(await (await fetch(url)).arrayBuffer());
        fontCache.set(url, data);
      } catch {
        continue;
      }
    }
    css += `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  }
  return css;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------------------
// Rasterizado.

const originals = new WeakMap<WorkImage, Promise<ImageBitmap>>();

/** La foto original (con su orientación), una vez por imagen. */
export function originalBitmap(img: WorkImage): Promise<ImageBitmap> {
  let p = originals.get(img);
  if (!p) {
    p = createImageBitmap(img.original, { imageOrientation: 'from-image' });
    originals.set(img, p);
  }
  return p;
}

function loadSvg(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const im = new Image();
  return new Promise((resolve, reject) => {
    im.onload = () => {
      URL.revokeObjectURL(url);
      resolve(im);
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('svg'));
    };
    im.src = url;
  });
}

export interface StepImageOptions {
  width: number;
  height: number;
  /** Con la foto debajo (si no, papel blanco). */
  photo: boolean;
  /** Líneas y etiquetas más gruesas (para imágenes chicas, como las del PDF). */
  boost?: number;
}

/** El paso de `state.step` como lienzo: foto (opcional) y construcción encima. */
export async function stepCanvas(state: AppState, d: Derived, opts: StepImageOptions): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = opts.width;
  c.height = opts.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  if (opts.photo) {
    const big = c.width > state.image!.width * 1.01;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(big ? await originalBitmap(state.image!) : state.image!.canvas, 0, 0, c.width, c.height);
  }
  ctx.drawImage(await loadSvg(await overlaySvg(state, d, c.width, c.height, opts.boost)), 0, 0, c.width, c.height);
  return c;
}

/**
 * Cuadrícula de N × N para pasar el dibujo a la hoja: columnas con letras y
 * filas con números, en grafito con halo claro.
 */
export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, n: number): void {
  const k = Math.max(1, Math.max(w, h) / 1000);
  const lines = new Path2D();
  for (let i = 1; i < n; i++) {
    lines.moveTo((w * i) / n, 0);
    lines.lineTo((w * i) / n, h);
    lines.moveTo(0, (h * i) / n);
    lines.lineTo(w, (h * i) / n);
  }
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 3.2 * k;
  ctx.stroke(lines);
  ctx.strokeStyle = 'rgba(21,24,26,0.85)';
  ctx.lineWidth = 1.3 * k;
  ctx.stroke(lines);
  ctx.font = `600 ${Math.round(15 * k)}px 'IBM Plex Sans', system-ui, sans-serif`;
  ctx.lineJoin = 'round';
  const label = (t: string, x: number, y: number) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4 * k;
    ctx.strokeText(t, x, y);
    ctx.fillStyle = '#15181a';
    ctx.fillText(t, x, y);
  };
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) label(String.fromCharCode(65 + i), (w * (i + 0.5)) / n, 6 * k);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let j = 0; j < n; j++) label(String(j + 1), 6 * k, (h * (j + 0.5)) / n);
  ctx.restore();
}

/** Tamaño de exportación: la resolución original, sin pasar de `max` px en el lado mayor. */
export function exportSize(img: WorkImage, max = 4096): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(img.originalWidth, img.originalHeight));
  return { width: Math.round(img.originalWidth * k), height: Math.round(img.originalHeight * k) };
}
