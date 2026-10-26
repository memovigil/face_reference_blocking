// Visor: uno o dos paneles (Superpuesta / Lado a lado) con la foto en <canvas>
// y la construcción en <svg>. La vista (zoom y centro) es compartida, así que en
// «Lado a lado» el desplazamiento y la cruz roja quedan sincronizados.
//
// El <svg> usa un viewBox en px de imagen; las líneas llevan
// `vector-effect: non-scaling-stroke` y los tamaños de texto y puntos se
// expresan con la variable CSS --s (px de pantalla por px de imagen). Así, al
// hacer zoom solo cambia el viewBox y una variable: no se redibujan las capas.

import { clamp, v2, type Vec2 } from '../geom/vec';
import { es } from '../i18n/es';

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ViewInfo {
  /** Zoom relativo a «Ajustar» (1 = 100 %). */
  zoom: number;
  /** px de pantalla por px de imagen. */
  scale: number;
}

export interface HandleEvents {
  down(id: string, p: Vec2, e: PointerEvent): void;
  move(id: string, p: Vec2, e: PointerEvent): void;
  up(id: string, p: Vec2, e: PointerEvent): void;
}

interface Pane {
  el: HTMLDivElement;
  photo: HTMLCanvasElement;
  svg: SVGSVGElement;
  cross: SVGGElement;
  w: number;
  h: number;
}

export class Viewer {
  readonly el: HTMLDivElement;
  /** Grupo raíz donde las capas dibujan (coordenadas = px de imagen). */
  readonly layers: SVGGElement;
  private ref: Pane;
  private main: Pane;
  private loupe: HTMLCanvasElement;
  private image: HTMLCanvasElement | null = null;
  /** Imagen alternativa del panel de referencia (la foto en valores, paso E). */
  private refImage: HTMLCanvasElement | null = null;
  private iw = 0;
  private ih = 0;
  private scale = 1;
  private fitScale = 1;
  private cx = 0;
  private cy = 0;
  private zoomRel = 1;
  private mode: 'overlay' | 'side' = 'overlay';
  private handTool = false;
  private spaceDown = false;
  private raf = 0;
  private pointers = new Map<number, Vec2>();
  private pan: { x: number; y: number; cx: number; cy: number } | null = null;
  private pinch: { d: number; zoom: number; mid: Vec2 } | null = null;
  private drag: { id: string; pointer: number } | null = null;
  private crossAt: Vec2 | null = null;
  /** Clic sin arrastre en el lienzo (para colocar un punto en modo manual). */
  private tap: { x: number; y: number; pointer: number } | null = null;
  private placing = false;

  onView: (v: ViewInfo) => void = () => {};
  handles: HandleEvents | null = null;
  /** Clic en el lienzo fuera de un punto, en px de la imagen. */
  onTap: ((p: Vec2) => void) | null = null;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'stage';
    this.el.dataset.mode = 'overlay';
    this.ref = this.makePane('pane-ref', es.toolbar.reference, es.a11y.reference);
    this.main = this.makePane('pane-main', es.toolbar.construction, es.a11y.canvas);
    this.layers = document.createElementNS(SVG_NS, 'g');
    this.layers.setAttribute('class', 'layers');
    this.main.svg.insertBefore(this.layers, this.main.cross);
    this.loupe = document.createElement('canvas');
    this.loupe.className = 'loupe';
    this.loupe.setAttribute('aria-label', es.a11y.loupe);
    this.loupe.hidden = true;
    this.el.append(this.ref.el, this.main.el, this.loupe);
    host.append(this.el);

    new ResizeObserver(() => this.resize()).observe(this.el);
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    this.el.addEventListener('pointermove', (e) => this.onMove(e));
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('pointercancel', (e) => this.onUp(e));
    this.el.addEventListener('pointerleave', () => {
      this.setCross(null);
      if (this.placing && !this.drag) this.hideLoupe();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isControl(e)) {
        if (!this.spaceDown) {
          this.spaceDown = true;
          this.updateCursor();
        }
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = false;
        this.updateCursor();
      }
    });
  }

  private makePane(cls: string, label: string, aria: string): Pane {
    const el = document.createElement('div');
    el.className = `pane ${cls}`;
    const photo = document.createElement('canvas');
    photo.className = 'photo';
    photo.setAttribute('role', 'img');
    photo.setAttribute('aria-label', aria);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'overlay');
    svg.setAttribute('aria-hidden', 'true');
    const cross = document.createElementNS(SVG_NS, 'g');
    cross.setAttribute('class', 'crosshair');
    svg.append(cross);
    const tag = document.createElement('span');
    tag.className = 'pane-label';
    tag.textContent = label;
    el.append(photo, svg, tag);
    return { el, photo, svg, cross, w: 0, h: 0 };
  }

  // ---------------------------------------------------------------- API

  setImage(img: HTMLCanvasElement | null): void {
    this.image = img;
    this.iw = img?.width ?? 0;
    this.ih = img?.height ?? 0;
    this.el.classList.toggle('has-image', !!img);
    this.fit();
  }

  /** En «Lado a lado», el panel de referencia muestra esta imagen en lugar de la foto. */
  setRefImage(img: HTMLCanvasElement | null, label?: string): void {
    this.refImage = img;
    this.ref.el.querySelector('.pane-label')!.textContent = img && label ? label : es.toolbar.reference;
    this.schedule();
  }

  setMode(mode: 'overlay' | 'side'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.el.dataset.mode = mode;
    this.resize();
    this.setCross(null);
  }

  setPhotoOpacity(o: number): void {
    this.main.photo.style.opacity = String(o);
  }

  setHandTool(on: boolean): void {
    this.handTool = on;
    this.updateCursor();
  }

  /** Imagen que muestra el visor (para las pruebas). */
  get imageSource(): HTMLCanvasElement | null {
    return this.image;
  }

  get view(): ViewInfo {
    return { zoom: this.zoomRel, scale: this.scale };
  }

  fit(): void {
    this.computeFit();
    this.zoomRel = 1;
    this.scale = this.fitScale;
    this.cx = this.iw / 2;
    this.cy = this.ih / 2;
    this.schedule();
  }

  /** Zoom relativo a «Ajustar», anclado en un punto de pantalla del panel principal. */
  setZoom(zoom: number, anchor?: Vec2): void {
    const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    const pane = this.main;
    const a = anchor ?? v2(pane.w / 2, pane.h / 2);
    const before = this.screenToImage(pane, a);
    this.zoomRel = z;
    this.scale = this.fitScale * z;
    // Mantener el punto bajo el ancla.
    this.cx = before.x - (a.x - pane.w / 2) / this.scale;
    this.cy = before.y - (a.y - pane.h / 2) / this.scale;
    this.clampCenter();
    this.schedule();
  }

  /** Encuadra un rectángulo de imagen (con margen), dentro de 100–600 %. */
  frame(r: { x: number; y: number; w: number; h: number }, margin = 0.12): void {
    this.computeFit();
    const pane = this.main;
    const k = Math.min(pane.w / (r.w * (1 + 2 * margin)), pane.h / (r.h * (1 + 2 * margin)));
    this.zoomRel = clamp(k / this.fitScale, ZOOM_MIN, ZOOM_MAX);
    this.scale = this.fitScale * this.zoomRel;
    this.cx = r.x + r.w / 2;
    this.cy = r.y + r.h / 2;
    this.clampCenter();
    this.schedule();
  }

  /** Centra la vista en un punto de imagen con un zoom mínimo. */
  focus(p: Vec2, minZoom = 3): void {
    this.zoomRel = Math.max(this.zoomRel, Math.min(minZoom, ZOOM_MAX));
    this.scale = this.fitScale * this.zoomRel;
    this.cx = p.x;
    this.cy = p.y;
    this.clampCenter();
    this.schedule();
  }

  /** Muestra la lupa sobre un punto de imagen, cerca del puntero. */
  showLoupe(p: Vec2, client: Vec2): void {
    if (!this.image) return;
    const size = 168;
    const dpr = window.devicePixelRatio || 1;
    const lp = this.loupe;
    if (lp.width !== size * dpr) {
      lp.width = size * dpr;
      lp.height = size * dpr;
    }
    const mag = Math.max(this.scale * 3, 4);
    const ctx = lp.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = mag < 6;
    ctx.setTransform(mag * dpr, 0, 0, mag * dpr, (size / 2 - p.x * mag) * dpr, (size / 2 - p.y * mag) * dpr);
    ctx.drawImage(this.image, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#d2372c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2, 8);
    ctx.lineTo(size / 2, size / 2 - 6);
    ctx.moveTo(size / 2, size / 2 + 6);
    ctx.lineTo(size / 2, size - 8);
    ctx.moveTo(8, size / 2);
    ctx.lineTo(size / 2 - 6, size / 2);
    ctx.moveTo(size / 2 + 6, size / 2);
    ctx.lineTo(size - 8, size / 2);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(21,24,26,.85)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    // Arriba a la izquierda del puntero; si no cabe, abajo a la derecha.
    const r = this.el.getBoundingClientRect();
    let x = client.x - r.left - size - 24;
    let y = client.y - r.top - size - 24;
    if (x < 4) x = client.x - r.left + 24;
    if (y < 4) y = client.y - r.top + 24;
    lp.style.transform = `translate(${x}px, ${y}px)`;
    lp.style.width = `${size}px`;
    lp.style.height = `${size}px`;
    lp.hidden = false;
  }

  hideLoupe(): void {
    this.loupe.hidden = true;
  }

  /** Convierte coordenadas de cliente a px de imagen (según el panel bajo el puntero). */
  clientToImage(clientX: number, clientY: number): Vec2 {
    const pane = this.paneAt(clientX, clientY) ?? this.main;
    const r = pane.el.getBoundingClientRect();
    return this.screenToImage(pane, v2(clientX - r.left, clientY - r.top));
  }

  /** Centro de la vista, en px de la imagen. */
  center(): Vec2 {
    return v2(this.cx, this.cy);
  }

  /** Desplaza la vista (fracción del panel; con el teclado). */
  panBy(fx: number, fy: number): void {
    this.cx += (fx * this.main.w) / this.scale;
    this.cy += (fy * this.main.h) / this.scale;
    this.clampCenter();
    this.schedule();
  }

  /** Texto alternativo del lienzo principal (cambia con el paso). */
  describe(text: string): void {
    this.main.photo.setAttribute('aria-label', text);
  }

  /** Inversa de `clientToImage` en el panel principal (para las pruebas). */
  imageToClient(p: Vec2): Vec2 {
    const r = this.main.el.getBoundingClientRect();
    return v2(r.left + this.main.w / 2 + (p.x - this.cx) * this.scale, r.top + this.main.h / 2 + (p.y - this.cy) * this.scale);
  }

  // ---------------------------------------------------------------- internos

  private screenToImage(pane: Pane, s: Vec2): Vec2 {
    return v2(this.cx + (s.x - pane.w / 2) / this.scale, this.cy + (s.y - pane.h / 2) / this.scale);
  }

  private paneAt(x: number, y: number): Pane | null {
    for (const p of [this.main, this.ref]) {
      if (p === this.ref && this.mode !== 'side') continue;
      const r = p.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return p;
    }
    return null;
  }

  private computeFit(): void {
    const w = this.main.w || 1;
    const h = this.main.h || 1;
    this.fitScale = this.iw && this.ih ? Math.min(w / this.iw, h / this.ih) * 0.94 : 1;
  }

  private resize(): void {
    for (const p of [this.ref, this.main]) {
      const r = p.el.getBoundingClientRect();
      p.w = r.width;
      p.h = r.height;
    }
    const prevFit = this.fitScale;
    this.computeFit();
    if (prevFit > 0) this.scale = this.fitScale * this.zoomRel;
    this.clampCenter();
    this.schedule();
  }

  private clampCenter(): void {
    this.cx = clamp(this.cx, 0, this.iw);
    this.cy = clamp(this.cy, 0, this.ih);
    if (this.zoomRel <= 1.0001) {
      this.cx = this.iw / 2;
      this.cy = this.ih / 2;
    }
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const dpr = window.devicePixelRatio || 1;
    const panes = this.mode === 'side' ? [this.ref, this.main] : [this.main];
    for (const p of panes) {
      const cw = Math.max(1, Math.round(p.w * dpr));
      const ch = Math.max(1, Math.round(p.h * dpr));
      if (p.photo.width !== cw || p.photo.height !== ch) {
        p.photo.width = cw;
        p.photo.height = ch;
      }
      const ctx = p.photo.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      if (this.image) {
        const s = this.scale * dpr;
        ctx.imageSmoothingEnabled = this.scale < 3;
        ctx.imageSmoothingQuality = 'high';
        ctx.setTransform(s, 0, 0, s, (p.w / 2 - this.cx * this.scale) * dpr, (p.h / 2 - this.cy * this.scale) * dpr);
        if (p === this.ref && this.refImage) {
          // La foto atenuada debajo y los valores encima, en px de la foto.
          ctx.globalAlpha = 0.35;
          ctx.drawImage(this.image, 0, 0);
          ctx.globalAlpha = 1;
          ctx.drawImage(this.refImage, 0, 0, this.iw, this.ih);
        } else ctx.drawImage(this.image, 0, 0);
      }
      const vw = p.w / this.scale;
      const vh = p.h / this.scale;
      p.svg.setAttribute('viewBox', `${this.cx - vw / 2} ${this.cy - vh / 2} ${vw} ${vh}`);
      p.svg.style.setProperty('--s', String(this.scale));
    }
    this.renderCross();
    this.onView(this.view);
  }

  private setCross(p: Vec2 | null): void {
    this.crossAt = p;
    this.renderCross();
  }

  private renderCross(): void {
    const show = this.mode === 'side' && this.crossAt && this.image;
    for (const pane of [this.ref, this.main]) {
      pane.cross.replaceChildren();
      if (!show) continue;
      const p = this.crossAt!;
      const len = 14 / this.scale;
      const gap = 3 / this.scale;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        `M${p.x - len} ${p.y}H${p.x - gap}M${p.x + gap} ${p.y}H${p.x + len}M${p.x} ${p.y - len}V${p.y - gap}M${p.x} ${p.y + gap}V${p.y + len}`,
      );
      pane.cross.append(path);
    }
  }

  private updateCursor(): void {
    const panning = !!this.pan;
    this.el.dataset.cursor = panning ? 'grabbing' : this.handTool || this.spaceDown ? 'grab' : this.placing ? 'crosshair' : 'default';
  }

  /** Hay un punto por colocar: cursor de cruz y lupa al pasar el puntero. */
  setPlacing(on: boolean): void {
    if (on === this.placing) return;
    this.placing = on;
    if (!on) this.hideLoupe();
    this.updateCursor();
  }

  private onWheel(e: WheelEvent): void {
    if (!this.image) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      const pane = this.paneAt(e.clientX, e.clientY) ?? this.main;
      const pr = pane.el.getBoundingClientRect();
      // Los dos paneles tienen la misma geometría: el ancla vale para ambos.
      this.setZoom(this.zoomRel * factor, v2(e.clientX - pr.left, e.clientY - pr.top));
    } else if (this.zoomRel > 1.0001) {
      const k = e.deltaMode === 1 ? 16 : 1;
      this.cx += (e.deltaX * k) / this.scale;
      this.cy += (e.deltaY * k) / this.scale;
      this.clampCenter();
      this.schedule();
    }
  }

  private onDown(e: PointerEvent): void {
    if (!this.image) return;
    this.pointers.set(e.pointerId, v2(e.clientX, e.clientY));
    if (this.pointers.size === 2) {
      // Pellizco: cancela arrastres y hace zoom.
      this.drag = null;
      this.pan = null;
      this.tap = null;
      this.hideLoupe();
      const [a, b] = [...this.pointers.values()];
      const r = this.main.el.getBoundingClientRect();
      this.pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: this.zoomRel,
        mid: v2((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top),
      };
      return;
    }
    const target = e.target as Element;
    const handle = target.closest<SVGElement>('[data-handle]');
    const wantsPan = this.handTool || this.spaceDown || e.button === 1;
    if (handle && !wantsPan && this.handles && e.button === 0) {
      const id = handle.dataset.handle!;
      this.drag = { id, pointer: e.pointerId };
      this.el.setPointerCapture(e.pointerId);
      const p = this.clientToImage(e.clientX, e.clientY);
      this.handles.down(id, p, e);
      e.preventDefault();
      return;
    }
    if (!wantsPan && e.button === 0) this.tap = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
    if (wantsPan || this.zoomRel > 1.0001) {
      this.pan = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy };
      this.el.setPointerCapture(e.pointerId);
      this.updateCursor();
      e.preventDefault();
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, v2(e.clientX, e.clientY));
    if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 5) this.tap = null;
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.setZoom((this.pinch.zoom * d) / this.pinch.d, this.pinch.mid);
      return;
    }
    if (this.drag && this.drag.pointer === e.pointerId && this.handles) {
      this.handles.move(this.drag.id, this.clientToImage(e.clientX, e.clientY), e);
      return;
    }
    if (this.pan) {
      this.cx = this.pan.cx - (e.clientX - this.pan.x) / this.scale;
      this.cy = this.pan.cy - (e.clientY - this.pan.y) / this.scale;
      this.clampCenter();
      this.schedule();
      return;
    }
    if (this.mode === 'side' && this.image && e.pointerType !== 'touch') {
      this.setCross(this.clientToImage(e.clientX, e.clientY));
    }
    if (this.placing && this.image && e.pointerType === 'mouse') this.showLoupe(this.clientToImage(e.clientX, e.clientY), v2(e.clientX, e.clientY));
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag && this.drag.pointer === e.pointerId) {
      this.handles?.up(this.drag.id, this.clientToImage(e.clientX, e.clientY), e);
      this.drag = null;
    }
    if (this.pan) {
      this.pan = null;
      this.updateCursor();
    }
    if (this.tap && this.tap.pointer === e.pointerId) {
      this.tap = null;
      this.onTap?.(this.clientToImage(e.clientX, e.clientY));
    }
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
  }
}

/** El foco está en un control que usa el teclado (botón, deslizador, campo…). */
export function isControl(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || t === document.body) return false;
  return t.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(t.tagName);
}

/** El foco está en un campo de texto (ahí ni las letras son atajos). */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
  if (t.tagName !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return type === 'text' || type === 'number' || type === 'search';
}
