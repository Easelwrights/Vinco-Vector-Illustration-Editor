import { IDENTITY, multiply } from './geometry.js';
import { hexToRgb } from './color.js';
import { segments, isStraight } from './path.js';
import { itemBounds, layoutText } from './document.js';
import { appearanceSubpaths } from './svg.js';

const n = (v) => {
  const r = Math.round((Number(v) || 0) * 1000) / 1000;
  return String(Object.is(r, -0) ? 0 : r);
};

const BLEND_PDF = {
  multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference', exclusion: 'Exclusion',
  hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
};

const FONTS = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
};

function fontFor(font) {
  const family = String(font.family).toLowerCase();
  const group = /courier|mono/.test(family) ? 'mono' : /times|georgia|serif/.test(family) && !/sans-serif/.test(family) ? 'serif' : 'sans';
  const bold = (font.weight || 400) >= 600 ? 1 : 0;
  const italic = font.style === 'italic' ? 2 : 0;
  return FONTS[group][bold + italic];
}

function pdfString(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const c = code >= 32 && code <= 126 ? ch : code >= 160 && code <= 255 ? String.fromCharCode(code) : '?';
    out += c === '\\' || c === '(' || c === ')' ? `\\${c}` : c;
  }
  return `(${out})`;
}

const rgb = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return `${n(r / 255)} ${n(g / 255)} ${n(b / 255)}`;
};

function pathOps(subpaths) {
  const ops = [];
  for (const sub of subpaths) {
    if (!sub.nodes.length) continue;
    ops.push(`${n(sub.nodes[0].x)} ${n(sub.nodes[0].y)} m`);
    for (const [seg] of segments(sub)) {
      if (isStraight(seg)) ops.push(`${n(seg[3].x)} ${n(seg[3].y)} l`);
      else ops.push(`${n(seg[1].x)} ${n(seg[1].y)} ${n(seg[2].x)} ${n(seg[2].y)} ${n(seg[3].x)} ${n(seg[3].y)} c`);
    }
    if (sub.closed) ops.push('h');
  }
  return ops.join('\n');
}

class Writer {
  constructor() {
    this.objects = [];
  }

  reserve() {
    this.objects.push(null);
    return this.objects.length;
  }

  set(id, content) {
    this.objects[id - 1] = content;
  }

  add(content) {
    const id = this.reserve();
    this.set(id, content);
    return id;
  }

  stream(dict, data) {
    const bytes = typeof data === 'string' ? latin1(data) : data;
    return this.add({ dict: `${dict.replace(/>>$/, '')} /Length ${bytes.length} >>`, bytes });
  }

  build(rootId) {
    const chunks = [];
    let offset = 0;
    const push = (part) => {
      const bytes = typeof part === 'string' ? latin1(part) : part;
      chunks.push(bytes);
      offset += bytes.length;
    };
    push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
    const offsets = [];
    this.objects.forEach((obj, index) => {
      offsets.push(offset);
      push(`${index + 1} 0 obj\n`);
      if (obj && typeof obj === 'object' && obj.bytes) {
        push(`${obj.dict}\nstream\n`);
        push(obj.bytes);
        push('\nendstream\nendobj\n');
      } else {
        push(`${obj ?? 'null'}\nendobj\n`);
      }
    });
    const xref = offset;
    push(`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`);
    for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R /Info ${this.info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
}

function latin1(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function gradientFunction(paint) {
  const stops = [...paint.stops].sort((a, b) => a.offset - b.offset);
  if (stops.length === 1) stops.push({ ...stops[0], offset: 1 });
  const pieces = [];
  for (let i = 1; i < stops.length; i += 1) pieces.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(stops[i - 1].color)}] /C1 [${rgb(stops[i].color)}] /N 1 >>`);
  const first = stops[0].offset;
  const last = stops[stops.length - 1].offset;
  if (pieces.length === 1 && first <= 0 && last >= 1) return pieces[0];
  const bounds = stops.slice(1, -1).map((s) => n(Math.max(0, Math.min(1, s.offset))));
  const allPieces = [...pieces];
  const allBounds = [...bounds];
  const encode = pieces.map(() => '0 1');
  if (first > 0) {
    allPieces.unshift(`<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(stops[0].color)}] /C1 [${rgb(stops[0].color)}] /N 1 >>`);
    allBounds.unshift(n(first));
    encode.unshift('0 1');
  }
  if (last < 1) {
    allPieces.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(stops[stops.length - 1].color)}] /C1 [${rgb(stops[stops.length - 1].color)}] /N 1 >>`);
    allBounds.push(n(last));
    encode.push('0 1');
  }
  return `<< /FunctionType 3 /Domain [0 1] /Functions [${allPieces.join(' ')}] /Bounds [${allBounds.join(' ')}] /Encode [${encode.join(' ')}] >>`;
}

export function exportPDF(doc, { artboards = null, images = new Map(), title = '' } = {}) {
  const w = new Writer();
  const catalog = w.reserve();
  const pages = w.reserve();
  w.info = w.add(`<< /Title ${pdfString(title || doc.name || 'Vinco')} /Producer (Vinco) /Creator (Vinco) >>`);
  const fontIds = new Map();
  const imageIds = new Map();
  const pageIds = [];
  const indices = artboards ?? doc.artboards.map((_, i) => i);
  for (const index of indices) {
    const board = doc.artboards[index];
    if (!board) continue;
    const resources = { fonts: new Map(), states: new Map(), shadings: new Map(), xobjects: new Map() };
    const ops = [`1 0 0 -1 ${n(-board.x)} ${n(board.height + board.y)} cm`];
    const stateName = (fill, stroke, blend) => {
      const key = `${n(fill)}|${n(stroke)}|${blend}`;
      if (!resources.states.has(key)) {
        const id = w.add(`<< /Type /ExtGState /ca ${n(fill)} /CA ${n(stroke)}${BLEND_PDF[blend] ? ` /BM /${BLEND_PDF[blend]}` : ''} >>`);
        resources.states.set(key, { name: `GS${resources.states.size + 1}`, id });
      }
      return resources.states.get(key).name;
    };
    const fontName = (font) => {
      const base = fontFor(font);
      if (!fontIds.has(base)) fontIds.set(base, w.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`));
      if (!resources.fonts.has(base)) resources.fonts.set(base, { name: `F${resources.fonts.size + 1}`, id: fontIds.get(base) });
      return resources.fonts.get(base).name;
    };
    const shadingName = (paint, bounds) => {
      const fn = gradientFunction(paint);
      const coords = paint.kind === 'radial' ? `${n(paint.cx ?? 0.5)} ${n(paint.cy ?? 0.5)} 0 ${n(paint.cx ?? 0.5)} ${n(paint.cy ?? 0.5)} ${n(paint.r ?? 0.5)}` : `${n(paint.x1 ?? 0)} ${n(paint.y1 ?? 0.5)} ${n(paint.x2 ?? 1)} ${n(paint.y2 ?? 0.5)}`;
      const id = w.add(`<< /ShadingType ${paint.kind === 'radial' ? 3 : 2} /ColorSpace /DeviceRGB /Coords [${coords}] /Function ${fn} /Extend [true true] >>`);
      const name = `Sh${resources.shadings.size + 1}`;
      resources.shadings.set(name, id);
      return { name, bounds };
    };
    const emitPaintedPath = (subpaths, style, fillRule, opacity, blend) => {
      if (!subpaths.length) return;
      const data = pathOps(subpaths);
      const evenodd = fillRule === 'evenodd';
      const fill = style?.fill;
      const stroke = style?.stroke && style.strokeWidth > 0 ? style.stroke : null;
      ops.push('q');
      ops.push(`/${stateName(opacity, opacity, blend)} gs`);
      if (fill?.type === 'gradient') {
        const b = itemBounds({ type: 'path', subpaths, visible: true }, doc);
        const sh = shadingName(fill, b);
        ops.push('q', data, evenodd ? 'W* n' : 'W n', `${n(b.maxX - b.minX || 1)} 0 0 ${n(b.maxY - b.minY || 1)} ${n(b.minX)} ${n(b.minY)} cm`, `/${sh.name} sh`, 'Q');
      }
      if (stroke) {
        ops.push(`${n(style.strokeWidth)} w`, `${style.cap === 'round' ? 1 : style.cap === 'projecting' ? 2 : 0} J`, `${style.join === 'round' ? 1 : style.join === 'bevel' ? 2 : 0} j`, `${n(style.miterLimit || 10)} M`);
        if (Array.isArray(style.dash) && style.dash.some((d) => d > 0)) ops.push(`[${style.dash.map(n).join(' ')}] 0 d`);
        const color = stroke.type === 'gradient' ? stroke.stops[0].color : stroke.color;
        ops.push(`${rgb(color)} RG`);
      }
      if (fill?.type === 'color') ops.push(`${rgb(fill.color)} rg`);
      const solidFill = fill?.type === 'color';
      ops.push(data);
      if (solidFill && stroke) ops.push(evenodd ? 'B*' : 'B');
      else if (solidFill) ops.push(evenodd ? 'f*' : 'f');
      else if (stroke) ops.push('S');
      else ops.push('n');
      ops.push('Q');
    };
    const emit = (item, matrix, inherited) => {
      if (item.visible === false) return;
      const opacity = inherited * (item.opacity ?? 1);
      const blend = item.blend || 'normal';
      switch (item.type) {
        case 'path': {
          const subs = appearanceSubpaths(item);
          const transformed = matrix === IDENTITY ? subs : subs.map((s) => s);
          if (matrix !== IDENTITY) {
            ops.push('q', `${matrix.map(n).join(' ')} cm`);
            emitPaintedPath(transformed, item.style, item.fillRule, opacity, blend);
            ops.push('Q');
          } else {
            emitPaintedPath(transformed, item.style, item.fillRule, opacity, blend);
          }
          break;
        }
        case 'text': {
          if (item.onPath) break;
          const m = multiply(matrix, item.matrix);
          const font = item.font;
          const fill = item.style?.fill;
          const color = fill ? (fill.type === 'gradient' ? fill.stops[0].color : fill.color) : null;
          if (!color) break;
          ops.push('q', `${m.map(n).join(' ')} cm`, `/${stateName(opacity, opacity, blend)} gs`, `${rgb(color)} rg`, 'BT', `/${fontName(font)} ${n(font.size)} Tf`);
          if (font.tracking) ops.push(`${n((font.tracking / 1000) * font.size)} Tc`);
          for (const l of layoutText(item)) {
            const x = item.area ? l.x : l.x;
            ops.push(`1 0 0 -1 ${n(x)} ${n(l.y)} Tm`, `${pdfString(l.text)} Tj`);
          }
          ops.push('ET', 'Q');
          break;
        }
        case 'image': {
          const data = images.get(item.asset);
          if (!data) break;
          if (!imageIds.has(item.asset)) {
            let smask = '';
            if (data.alpha) {
              const maskId = w.stream(`<< /Type /XObject /Subtype /Image /Width ${data.width} /Height ${data.height} /ColorSpace /DeviceGray /BitsPerComponent 8${data.alphaFilter ? ` /Filter /${data.alphaFilter}` : ''} >>`, data.alpha);
              smask = ` /SMask ${maskId} 0 R`;
            }
            imageIds.set(item.asset, w.stream(`<< /Type /XObject /Subtype /Image /Width ${data.width} /Height ${data.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${data.filter ? ` /Filter /${data.filter}` : ''}${smask} >>`, data.rgb));
          }
          const name = `Im${resources.xobjects.size + 1}`;
          resources.xobjects.set(name, imageIds.get(item.asset));
          const m = multiply(matrix, item.matrix);
          ops.push('q', `${m.map(n).join(' ')} cm`, `/${stateName(opacity, opacity, blend)} gs`, `${n(item.width)} 0 0 ${n(-item.height)} 0 ${n(item.height)} cm`, `/${name} Do`, 'Q');
          break;
        }
        case 'instance': {
          const symbol = doc.symbols.find((s) => s.id === item.symbol);
          if (!symbol) break;
          const m = multiply(matrix, item.matrix);
          for (const child of symbol.children) emit(child, m, opacity);
          break;
        }
        case 'group': {
          const visible = item.children.filter((c) => c.visible !== false);
          if (item.clip && visible.length > 1) {
            const mask = visible[visible.length - 1];
            ops.push('q');
            if (matrix !== IDENTITY) ops.push(`${matrix.map(n).join(' ')} cm`);
            ops.push(pathOps(mask.subpaths || []), mask.fillRule === 'evenodd' ? 'W* n' : 'W n');
            if (matrix !== IDENTITY) ops.push(`${multiply([1, 0, 0, 1, 0, 0], invertSafe(matrix)).map(n).join(' ')} cm`);
            for (const child of visible.slice(0, -1)) emit(child, matrix, opacity);
            ops.push('Q');
          } else {
            for (const child of visible) emit(child, matrix, opacity);
          }
          break;
        }
        default:
          break;
      }
    };
    for (const layer of doc.layers) if (layer.visible) for (const child of layer.children) emit(child, IDENTITY, 1);
    const content = w.stream('<< >>', ops.join('\n'));
    const dict = (map, key) => (map.size ? ` /${key} << ${[...map.entries()].map(([k, v]) => (typeof v === 'object' ? `/${v.name} ${v.id} 0 R` : `/${k} ${v} 0 R`)).join(' ')} >>` : '');
    const res = `<<${dict(resources.fonts, 'Font')}${dict(resources.states, 'ExtGState')}${dict(resources.shadings, 'Shading')}${dict(resources.xobjects, 'XObject')} /ProcSet [/PDF /Text /ImageC] >>`;
    const page = w.add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${n(board.width)} ${n(board.height)}] /Resources ${res} /Contents ${content} 0 R >>`);
    pageIds.push(page);
  }
  w.set(pages, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  w.set(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`);
  return w.build(catalog);
}

function invertSafe(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [1, 0, 0, 1, 0, 0];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
