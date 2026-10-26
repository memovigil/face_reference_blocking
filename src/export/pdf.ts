// PDF mínimo, sin dependencias: páginas con imágenes JPEG y texto en Helvetica
// (fuente estándar de PDF, sin incrustar) con codificación WinAnsi, que cubre
// el español (acentos, ñ, ¿¡, «», °). Lo demás se reemplaza por equivalentes.

/** Carta (8.5 × 11 in), el tamaño de hoja habitual en México. */
export const LETTER = { width: 612, height: 792 };

export type FontId = 'regular' | 'bold';

// Anchos de Helvetica y Helvetica-Bold (1/1000 em), caracteres 32–126 (AFM de Adobe).
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278,
  556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278,
  556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333,
  611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Unicode → byte WinAnsi (cp1252) para lo que no coincide con Latin-1. */
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
/** Caracteres sin lugar en WinAnsi. */
const REPLACE: Record<string, string> = { '→': '–', '−': '-', '‑': '-', '≈': '~', ' ': ' ', ' ': ' ', '≤': '<=', '≥': '>=' };

/** Bytes WinAnsi de un texto (para medir y para escribir). */
export function winAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch0 of text) {
    const ch = REPLACE[ch0] ?? ch0;
    for (const ch1 of ch) {
      const c = ch1.codePointAt(0)!;
      if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c);
      else out.push(CP1252[ch1] ?? 0x3f);
    }
  }
  return out;
}

/** Base sin acento de un byte Latin-1 (para tomar su ancho). */
const BASE: Record<number, string> = {};
for (const [chars, base] of [
  ['ÀÁÂÃÄÅ', 'A'], ['ÈÉÊË', 'E'], ['ÌÍÎÏ', 'I'], ['ÒÓÔÕÖ', 'O'], ['ÙÚÛÜ', 'U'], ['Ñ', 'N'], ['Ç', 'C'],
  ['àáâãäå', 'a'], ['èéêë', 'e'], ['ìíîï', 'i'], ['òóôõö', 'o'], ['ùúûü', 'u'], ['ñ', 'n'], ['ç', 'c'], ['ýÿ', 'y'],
] as const) {
  for (const ch of chars) BASE[ch.codePointAt(0)!] = base;
}
const EXTRA_WIDTH: Record<number, number> = { 0xb0: 400, 0xb7: 278, 0xab: 556, 0xbb: 556, 0xbf: 611, 0xa1: 333, 0x96: 556, 0x97: 1000, 0x85: 1000, 0x92: 222, 0x93: 333, 0x94: 333, 0xd7: 584, 0x95: 350 };

function charWidth(b: number, font: FontId): number {
  const table = font === 'bold' ? W_BOLD : W_REGULAR;
  if (b >= 32 && b <= 126) return table[b - 32];
  const base = BASE[b];
  if (base) return table[base.charCodeAt(0) - 32];
  return EXTRA_WIDTH[b] ?? 556;
}

/** Ancho del texto en puntos. */
export function textWidth(text: string, size: number, font: FontId = 'regular'): number {
  return (winAnsi(text).reduce((s, b) => s + charWidth(b, font), 0) * size) / 1000;
}

/** Corta el texto en renglones que caben en `width` puntos. */
export function wrap(text: string, width: number, size: number, font: FontId = 'regular'): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, font) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const pdfString = (text: string) =>
  `(${winAnsi(text)
    .map((b) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : String.fromCharCode(b)))
    .join('')})`;

const n2 = (x: number) => (Math.round(x * 100) / 100).toString();

interface PageImage {
  name: string;
  jpeg: Uint8Array;
  w: number;
  h: number;
}

/** Una página: operadores de dibujo en puntos, con origen arriba a la izquierda. */
export class PdfPage {
  ops: string[] = [];
  images: PageImage[] = [];
  constructor(readonly width: number, readonly height: number) {}

  text(x: number, y: number, text: string, size: number, font: FontId = 'regular', color: [number, number, number] = [0.08, 0.09, 0.1]): void {
    this.ops.push(`BT ${color.map(n2).join(' ')} rg /${font === 'bold' ? 'F2' : 'F1'} ${n2(size)} Tf ${n2(x)} ${n2(this.height - y)} Td ${pdfString(text)} Tj ET`);
  }

  /** Párrafo con corte de renglón; devuelve la y debajo del último renglón. */
  paragraph(x: number, y: number, width: number, text: string, size: number, font: FontId = 'regular', color?: [number, number, number], leading = 1.35): number {
    for (const line of wrap(text, width, size, font)) {
      y += size * leading;
      this.text(x, y - size * 0.3, line, size, font, color);
    }
    return y;
  }

  image(jpeg: Uint8Array, pxW: number, pxH: number, x: number, y: number, w: number, h: number): void {
    const name = `Im${this.images.length + 1}`;
    this.images.push({ name, jpeg, w: pxW, h: pxH });
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(this.height - y - h)} cm /${name} Do Q`);
  }

  rect(x: number, y: number, w: number, h: number, stroke: [number, number, number], lineWidth = 0.6): void {
    this.ops.push(`q ${stroke.map(n2).join(' ')} RG ${n2(lineWidth)} w ${n2(x)} ${n2(this.height - y - h)} ${n2(w)} ${n2(h)} re S Q`);
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: [number, number, number], lineWidth = 0.6): void {
    this.ops.push(`q ${stroke.map(n2).join(' ')} RG ${n2(lineWidth)} w ${n2(x1)} ${n2(this.height - y1)} m ${n2(x2)} ${n2(this.height - y2)} l S Q`);
  }
}

export class PdfWriter {
  pages: PdfPage[] = [];

  addPage(width = LETTER.width, height = LETTER.height): PdfPage {
    const p = new PdfPage(width, height);
    this.pages.push(p);
    return p;
  }

  build(info: { title: string }): Blob {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (c: Uint8Array | string) => {
      const b = typeof c === 'string' ? enc.encode(c) : c;
      chunks.push(b);
      length += b.length;
    };
    // Objetos: 1 catálogo, 2 páginas, 3–4 fuentes, 5 información; luego por página.
    let next = 6;
    const pageIds: number[] = [];
    const plan = this.pages.map((p) => {
      const images = p.images.map(() => next++);
      const content = next++;
      const page = next++;
      pageIds.push(page);
      return { p, images, content, page };
    });
    const obj = (id: number, body: () => void) => {
      offsets[id] = length;
      push(`${id} 0 obj\n`);
      body();
      push('\nendobj\n');
    };
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`));
    obj(3, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    obj(4, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
    obj(5, () => push(`<< /Title ${pdfString(info.title)} /Producer (Encaje de Retrato) >>`));
    for (const { p, images, content, page } of plan) {
      p.images.forEach((im, k) =>
        obj(images[k], () => {
          push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`);
          push(im.jpeg);
          push('\nendstream');
        }),
      );
      const stream = enc.encode(p.ops.join('\n'));
      obj(content, () => {
        push(`<< /Length ${stream.length} >>\nstream\n`);
        push(stream);
        push('\nendstream');
      });
      const xobj = p.images.map((im, k) => `/${im.name} ${images[k]} 0 R`).join(' ');
      obj(page, () =>
        push(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj ? ` /XObject << ${xobj} >>` : ''} >> /Contents ${content} 0 R >>`,
        ),
      );
    }
    const xref = length;
    push(`xref\n0 ${next}\n0000000000 65535 f \n`);
    for (let i = 1; i < next; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${next} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
  }
}
