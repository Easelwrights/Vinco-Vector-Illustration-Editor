import { IDENTITY, isIdentity, multiply, round } from './geometry.js';
import { HEX, parseColor } from './color.js';
import { puckerBloat, roughen, roundCorners, toPathData, transformSubpaths, zigZag, parsePathData, rectangle, ellipse, line, makeNode } from './path.js';
import { BLEND_MODES, createGroup, createImage, createPath, createText, defaultStyle, layoutText, solid, uid } from './document.js';

export const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}

const num = (v) => String(round(Number(v) || 0, 3));
const safeColor = (c) => (HEX.test(c) ? c : '#000000');
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');
const matrixAttr = (m) => (!m || isIdentity(m) ? '' : ` transform="matrix(${m.map(num).join(' ')})"`);

export function appearanceSubpaths(item) {
  let subpaths = item.subpaths;
  for (const effect of item.effects || []) {
    if (effect.enabled === false) continue;
    if (effect.type === 'roundCorners') subpaths = roundCorners(subpaths, effect.radius || 0);
    else if (effect.type === 'zigZag') subpaths = zigZag(subpaths, effect.size || 0, effect.ridges || 4, !!effect.smooth);
    else if (effect.type === 'roughen') subpaths = roughen(subpaths, effect.size || 0, effect.detail || 10, effect.seed || 1);
    else if (effect.type === 'puckerBloat') subpaths = puckerBloat(subpaths, effect.amount || 0);
  }
  return subpaths;
}

function gradientDef(paint, id) {
  const stops = [...paint.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `<stop offset="${num(Math.max(0, Math.min(1, s.offset)))}" stop-color="${safeColor(s.color)}"${(s.opacity ?? 1) !== 1 ? ` stop-opacity="${num(s.opacity)}"` : ''}/>`)
    .join('');
  if (paint.kind === 'radial') {
    return `<radialGradient id="${id}" cx="${num(paint.cx ?? 0.5)}" cy="${num(paint.cy ?? 0.5)}" r="${num(paint.r ?? 0.5)}"${paint.fx !== undefined ? ` fx="${num(paint.fx)}" fy="${num(paint.fy)}"` : ''}>${stops}</radialGradient>`;
  }
  return `<linearGradient id="${id}" x1="${num(paint.x1 ?? 0)}" y1="${num(paint.y1 ?? 0.5)}" x2="${num(paint.x2 ?? 1)}" y2="${num(paint.y2 ?? 0.5)}">${stops}</linearGradient>`;
}

function paintAttr(paint, id, defs) {
  if (!paint) return 'none';
  if (paint.type === 'gradient' && Array.isArray(paint.stops) && paint.stops.length) {
    defs.push(gradientDef(paint, id));
    return `url(#${id})`;
  }
  return safeColor(paint.color);
}

const ARROWS = {
  arrow: '<path d="M0 0L10 5L0 10Z" fill="context-stroke"/>',
  triangle: '<path d="M0 0L10 5L0 10Z" fill="context-stroke"/>',
  circle: '<circle cx="5" cy="5" r="4" fill="context-stroke"/>',
  square: '<rect x="1" y="1" width="8" height="8" fill="context-stroke"/>',
  bar: '<rect x="4" y="0" width="2" height="10" fill="context-stroke"/>',
};

function markerDef(kind, id, color) {
  const shape = (ARROWS[kind] || ARROWS.arrow).replace(/context-stroke/g, color);
  return `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" markerUnits="strokeWidth">${shape}</marker>`;
}

function styleAttrs(style, item, prefix, defs, { forText = false } = {}) {
  const s = style || defaultStyle();
  const attrs = [];
  attrs.push(`fill="${paintAttr(s.fill, `${prefix}-f`, defs)}"`);
  if (!forText && item.type === 'path' && item.fillRule === 'evenodd') attrs.push('fill-rule="evenodd"');
  if (s.stroke && s.strokeWidth > 0) {
    attrs.push(`stroke="${paintAttr(s.stroke, `${prefix}-s`, defs)}"`);
    attrs.push(`stroke-width="${num(s.strokeWidth)}"`);
    if (s.cap && s.cap !== 'butt') attrs.push(`stroke-linecap="${s.cap === 'projecting' ? 'square' : s.cap}"`);
    if (s.join && s.join !== 'miter') attrs.push(`stroke-linejoin="${s.join}"`);
    if (s.join === 'miter' && s.miterLimit && s.miterLimit !== 4) attrs.push(`stroke-miterlimit="${num(s.miterLimit)}"`);
    if (Array.isArray(s.dash) && s.dash.some((d) => d > 0)) attrs.push(`stroke-dasharray="${s.dash.map(num).join(' ')}"`);
    if (!forText && item.type === 'path') {
      const strokeColor = s.stroke.type === 'color' ? safeColor(s.stroke.color) : '#000000';
      if (s.arrowStart && s.arrowStart !== 'none') {
        defs.push(markerDef(s.arrowStart, `${prefix}-ma`, strokeColor));
        attrs.push(`marker-start="url(#${prefix}-ma)"`);
      }
      if (s.arrowEnd && s.arrowEnd !== 'none') {
        defs.push(markerDef(s.arrowEnd, `${prefix}-mb`, strokeColor));
        attrs.push(`marker-end="url(#${prefix}-mb)"`);
      }
    }
  } else {
    attrs.push('stroke="none"');
  }
  return attrs.join(' ');
}

function filterDef(effects, id) {
  const active = (effects || []).filter((e) => e.enabled !== false && ['dropShadow', 'blur', 'outerGlow', 'innerGlow'].includes(e.type));
  if (!active.length) return '';
  const parts = [];
  const merges = [];
  let source = 'SourceGraphic';
  active.forEach((e, i) => {
    if (e.type === 'blur') {
      parts.push(`<feGaussianBlur in="${source}" stdDeviation="${num(Math.max(0, e.radius || 0) / 2)}" result="b${i}"/>`);
      source = `b${i}`;
    }
  });
  active.forEach((e, i) => {
    const color = safeColor(e.color || '#000000');
    const opacity = num(e.opacity ?? 0.75);
    if (e.type === 'dropShadow') {
      parts.push(`<feGaussianBlur in="SourceAlpha" stdDeviation="${num(Math.max(0, e.blur ?? 4) / 2)}" result="sb${i}"/>`);
      parts.push(`<feOffset in="sb${i}" dx="${num(e.dx ?? 4)}" dy="${num(e.dy ?? 4)}" result="so${i}"/>`);
      parts.push(`<feFlood flood-color="${color}" flood-opacity="${opacity}" result="sf${i}"/>`);
      parts.push(`<feComposite in="sf${i}" in2="so${i}" operator="in" result="s${i}"/>`);
      merges.push(`s${i}`);
    } else if (e.type === 'outerGlow') {
      parts.push(`<feMorphology in="SourceAlpha" operator="dilate" radius="${num((e.blur ?? 6) / 4)}" result="gm${i}"/>`);
      parts.push(`<feGaussianBlur in="gm${i}" stdDeviation="${num((e.blur ?? 6) / 2)}" result="gb${i}"/>`);
      parts.push(`<feFlood flood-color="${color}" flood-opacity="${opacity}" result="gf${i}"/>`);
      parts.push(`<feComposite in="gf${i}" in2="gb${i}" operator="in" result="g${i}"/>`);
      merges.push(`g${i}`);
    }
  });
  merges.push(source);
  const inner = active.filter((e) => e.type === 'innerGlow');
  inner.forEach((e, k) => {
    const color = safeColor(e.color || '#ffffff');
    parts.push(`<feGaussianBlur in="SourceAlpha" stdDeviation="${num((e.blur ?? 6) / 2)}" result="ib${k}"/>`);
    parts.push(`<feComposite in="SourceAlpha" in2="ib${k}" operator="out" result="io${k}"/>`);
    parts.push(`<feFlood flood-color="${color}" flood-opacity="${num(e.opacity ?? 0.75)}" result="if${k}"/>`);
    parts.push(`<feComposite in="if${k}" in2="io${k}" operator="in" result="ii${k}"/>`);
    merges.push(`ii${k}`);
  });
  const merge = `<feMerge>${merges.map((m) => `<feMergeNode in="${m}"/>`).join('')}</feMerge>`;
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}${merge}</filter>`;
}

function wrapperAttrs(item, prefix, defs, extra = '') {
  const attrs = [];
  if ((item.opacity ?? 1) !== 1) attrs.push(`opacity="${num(item.opacity)}"`);
  if (item.blend && item.blend !== 'normal' && BLEND_MODES.includes(item.blend)) attrs.push(`style="mix-blend-mode:${item.blend}"`);
  const filter = filterDef(item.effects, `${prefix}-x`);
  if (filter) {
    defs.push(filter);
    attrs.push(`filter="url(#${prefix}-x)"`);
  }
  return attrs.length || extra ? ` ${[...attrs, extra].filter(Boolean).join(' ')}` : '';
}

function textMarkup(item, prefix, defs, ctx) {
  const font = item.font;
  const family = escapeXml(font.family);
  const fontAttrs = `font-family="${family}" font-size="${num(font.size)}"${font.weight !== 400 ? ` font-weight="${num(font.weight)}"` : ''}${font.style === 'italic' ? ' font-style="italic"' : ''}${font.tracking ? ` letter-spacing="${num((font.tracking / 1000) * font.size)}"` : ''}`;
  const paint = styleAttrs(item.style, item, prefix, defs, { forText: true });
  if (item.onPath) {
    defs.push(`<path id="${prefix}-tp" d="${toPathData(item.onPath)}"/>`);
    return `<text ${fontAttrs} ${paint}><textPath href="#${prefix}-tp" startOffset="${num(item.pathOffset || 0)}">${escapeXml(item.content)}</textPath></text>`;
  }
  const anchor = item.align === 'center' ? 'middle' : item.align === 'right' ? 'end' : 'start';
  const lines = layoutText(item);
  const baseX = item.area ? (item.align === 'center' ? item.area.width / 2 : item.align === 'right' ? item.area.width : 0) : 0;
  const justify = item.align === 'justify' && item.area;
  const spans = lines.map((l) => `<tspan x="${num(baseX)}" y="${num(l.y)}"${justify && !l.last && l.text.includes(' ') ? ` textLength="${num(item.area.width)}" lengthAdjust="spacing"` : ''}>${escapeXml(l.text) || ' '}</tspan>`).join('');
  const space = ctx.preserveSpace ? ' xml:space="preserve"' : '';
  return `<text${matrixAttr(item.matrix)} ${fontAttrs}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} ${paint}${space}>${spans}</text>`;
}

function contentMarkup(item, doc, ctx) {
  const prefix = `${ctx.prefix}${safeId(item.id)}`;
  const defs = [];
  let body = '';
  switch (item.type) {
    case 'path': {
      const subs = appearanceSubpaths(item);
      body = `<path d="${toPathData(subs)}" ${styleAttrs(item.style, item, prefix, defs)}/>`;
      break;
    }
    case 'text':
      body = textMarkup(item, prefix, defs, ctx);
      break;
    case 'image': {
      const href = doc.assets?.[item.asset];
      if (typeof href === 'string' && SAFE_IMAGE.test(href)) {
        body = `<image href="${href}" width="${num(item.width)}" height="${num(item.height)}" preserveAspectRatio="none"${matrixAttr(item.matrix)}/>`;
      }
      break;
    }
    case 'instance':
      if (doc.symbols?.some((s) => s.id === item.symbol)) body = `<use href="#${ctx.prefix}sym-${safeId(item.symbol)}"${matrixAttr(item.matrix)}/>`;
      break;
    case 'group': {
      const visible = item.children.filter((c) => ctx.includeHidden || c.visible !== false);
      if (item.clip && visible.length > 1) {
        const mask = visible[visible.length - 1];
        const maskSubs = mask.type === 'path' ? mask.subpaths : [];
        defs.push(`<clipPath id="${prefix}-c"><path d="${toPathData(maskSubs)}"${mask.fillRule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
        body = `<g clip-path="url(#${prefix}-c)">${visible.slice(0, -1).map((c) => itemMarkup(c, doc, ctx)).join('')}</g>`;
      } else {
        body = visible.map((c) => itemMarkup(c, doc, ctx)).join('');
      }
      break;
    }
    default:
      break;
  }
  return { defs, body, prefix };
}

export function itemMarkup(item, doc, ctx = {}) {
  const context = { prefix: 'v', includeHidden: false, ...ctx };
  if (!context.includeHidden && item.visible === false) return '';
  const { defs, body, prefix } = contentMarkup(item, doc, context);
  const attrs = wrapperAttrs(item, prefix, defs, context.dataIds ? `data-id="${safeId(item.id)}"` : '');
  const defsMarkup = defs.length ? `<defs>${defs.join('')}</defs>` : '';
  if (!attrs && !defsMarkup && !context.dataIds) return body;
  const idAttr = context.exportIds && item.name ? ` id="${escapeXml(item.name.replace(/\s+/g, '_'))}"` : '';
  return `<g${idAttr}${attrs}>${defsMarkup}${body}</g>`;
}

export function symbolDefs(doc, ctx = {}) {
  const context = { prefix: 'v', ...ctx, dataIds: false };
  return (doc.symbols || []).map((s) => `<g id="${context.prefix}sym-${safeId(s.id)}">${s.children.map((c) => itemMarkup(c, doc, context)).join('')}</g>`).join('');
}

export function exportSVG(doc, { artboard = 0, includeHidden = false, background = false, bounds = null } = {}) {
  const board = bounds ? { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY } : doc.artboards[artboard] || doc.artboards[0];
  const ctx = { prefix: 'v', includeHidden, exportIds: true, preserveSpace: true };
  const layers = doc.layers
    .filter((l) => includeHidden || l.visible)
    .map((l) => `<g id="${escapeXml(l.name.replace(/\s+/g, '_'))}">${l.children.map((c) => itemMarkup(c, doc, ctx)).join('')}</g>`)
    .join('');
  const symbols = symbolDefs(doc, ctx);
  const bg = background ? `<rect x="${num(board.x)}" y="${num(board.y)}" width="${num(board.width)}" height="${num(board.height)}" fill="${safeColor(doc.background || '#ffffff')}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${num(board.width)}" height="${num(board.height)}" viewBox="${num(board.x)} ${num(board.y)} ${num(board.width)} ${num(board.height)}">${symbols ? `<defs>${symbols}</defs>` : ''}${bg}${layers}</svg>\n`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function parseXml(source, { maxNodes = 200000 } = {}) {
  const text = String(source);
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  let count = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(text.slice(i));
      break;
    }
    if (lt > i) {
      const chunk = decodeEntities(text.slice(i, lt));
      const top = stack[stack.length - 1];
      top.text += chunk;
      top.children.push({ name: '#text', text: chunk });
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      const chunk = text.slice(lt + 9, end < 0 ? text.length : end);
      stack[stack.length - 1].text += chunk;
      stack[stack.length - 1].children.push({ name: '#text', text: chunk });
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt);
      const name = text.slice(lt + 2, end).trim();
      while (stack.length > 1) {
        const node = stack.pop();
        if (node.name === name) break;
      }
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    let j = lt + 1;
    let quote = null;
    while (j < text.length) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      j += 1;
    }
    const inner = text.slice(lt + 1, j);
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameMatch = body.match(/^\s*([^\s/>]+)/);
    if (!nameMatch) {
      i = j + 1;
      continue;
    }
    const node = { name: nameMatch[1], attrs: {}, children: [], text: '' };
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    const rest = body.slice(nameMatch[0].length);
    while ((m = attrRe.exec(rest))) node.attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    count += 1;
    if (count > maxNodes) throw new Error('O arquivo SVG tem elementos demais.');
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = j + 1;
  }
  return root;
}

const localName = (name) => (name.includes(':') ? name.split(':').pop() : name);

export function parseTransform(value) {
  let m = [...IDENTITY];
  if (!value) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(value))) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t = [...IDENTITY];
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) t = args;
        break;
      case 'translate':
        t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
        break;
      case 'scale':
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((args[0] || 0) * Math.PI) / 180;
        const r = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        t = args.length >= 3 ? multiply(multiply([1, 0, 0, 1, args[1], args[2]], r), [1, 0, 0, 1, -args[1], -args[2]]) : r;
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        break;
    }
    if (t.some((v) => !Number.isFinite(v))) continue;
    m = multiply(m, t);
  }
  return m;
}

function parseStyleAttribute(value) {
  const result = {};
  for (const part of String(value || '').split(';')) {
    const index = part.indexOf(':');
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing'];

function resolveStyle(node, inherited) {
  const style = { ...inherited };
  for (const key of INHERITED) if (node.attrs[key] !== undefined) style[key] = node.attrs[key];
  const inline = parseStyleAttribute(node.attrs.style);
  for (const key of [...INHERITED, 'opacity', 'mix-blend-mode']) if (inline[key] !== undefined) style[key] = inline[key];
  return style;
}

function length(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function paintFrom(value, gradients) {
  if (value === undefined) return undefined;
  const v = String(value).trim();
  if (v === 'none' || v === 'transparent') return null;
  const ref = v.match(/^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/);
  if (ref) return gradients.get(ref[1]) ? JSON.parse(JSON.stringify(gradients.get(ref[1]))) : solid('#000000');
  if (v === 'currentColor') return solid('#000000');
  const parsed = parseColor(v);
  if (!parsed || !parsed.color) return parsed && parsed.alpha === 0 ? null : solid('#000000');
  return solid(parsed.color);
}

function collectGradients(root) {
  const raw = new Map();
  const visit = (node) => {
    const name = localName(node.name);
    if ((name === 'linearGradient' || name === 'radialGradient') && node.attrs.id) raw.set(node.attrs.id, { node, name });
    for (const child of node.children || []) if (child.name !== '#text') visit(child);
  };
  visit(root);
  const fraction = (value, fallback) => {
    if (value === undefined) return fallback;
    const v = String(value).trim();
    return v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
  };
  const stopsOf = (entry, depth = 0) => {
    const stops = (entry.node.children || [])
      .filter((c) => localName(c.name) === 'stop')
      .map((c) => {
        const inline = parseStyleAttribute(c.attrs.style);
        const parsed = parseColor(inline['stop-color'] || c.attrs['stop-color'] || '#000000') || { color: '#000000', alpha: 1 };
        return {
          offset: Math.max(0, Math.min(1, fraction(c.attrs.offset, 0) || 0)),
          color: parsed.color || '#000000',
          opacity: Math.max(0, Math.min(1, parseFloat(inline['stop-opacity'] ?? c.attrs['stop-opacity'] ?? '1') * (parsed.alpha ?? 1))),
        };
      });
    if (!stops.length && depth < 5) {
      const href = (entry.node.attrs.href || entry.node.attrs['xlink:href'] || '').replace(/^#/, '');
      if (raw.has(href)) return stopsOf(raw.get(href), depth + 1);
    }
    return stops;
  };
  const result = new Map();
  for (const [id, entry] of raw) {
    const stops = stopsOf(entry);
    if (!stops.length) continue;
    const userSpace = entry.node.attrs.gradientUnits === 'userSpaceOnUse';
    if (entry.name === 'radialGradient') {
      result.set(id, { type: 'gradient', kind: 'radial', cx: userSpace ? 0.5 : fraction(entry.node.attrs.cx, 0.5), cy: userSpace ? 0.5 : fraction(entry.node.attrs.cy, 0.5), r: userSpace ? 0.5 : fraction(entry.node.attrs.r, 0.5), stops });
    } else {
      result.set(id, {
        type: 'gradient',
        kind: 'linear',
        x1: userSpace ? 0 : fraction(entry.node.attrs.x1, 0),
        y1: userSpace ? 0.5 : fraction(entry.node.attrs.y1, 0),
        x2: userSpace ? 1 : fraction(entry.node.attrs.x2, 1),
        y2: userSpace ? 0.5 : fraction(entry.node.attrs.y2, 0),
        stops,
      });
    }
  }
  return result;
}

function styleFrom(css, gradients) {
  const fill = paintFrom(css.fill ?? '#000000', gradients);
  const stroke = paintFrom(css.stroke ?? 'none', gradients);
  const dash = css['stroke-dasharray'] && css['stroke-dasharray'] !== 'none' ? css['stroke-dasharray'].split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 6) : [];
  const cap = css['stroke-linecap'] === 'square' ? 'projecting' : ['round', 'butt'].includes(css['stroke-linecap']) ? css['stroke-linecap'] : 'butt';
  return defaultStyle({
    fill,
    stroke,
    strokeWidth: stroke ? length(css['stroke-width'], 1) : 0,
    cap,
    join: ['round', 'bevel', 'miter'].includes(css['stroke-linejoin']) ? css['stroke-linejoin'] : 'miter',
    miterLimit: length(css['stroke-miterlimit'], 4),
    dash,
  });
}

function common(item, node, css) {
  const opacity = parseFloat(node.attrs.opacity ?? parseStyleAttribute(node.attrs.style).opacity ?? '1');
  if (Number.isFinite(opacity)) item.opacity = Math.max(0, Math.min(1, opacity));
  const blend = css['mix-blend-mode'];
  if (blend && BLEND_MODES.includes(blend)) item.blend = blend;
  if (node.attrs.id) item.name = String(node.attrs.id).slice(0, 80);
  if (node.attrs.display === 'none' || node.attrs.visibility === 'hidden') item.visible = false;
  return item;
}

function importNode(node, ctx, matrix, inherited) {
  const name = localName(node.name);
  if (['defs', 'clipPath', 'mask', 'pattern', 'symbol', 'style', 'script', 'title', 'desc', 'metadata', 'linearGradient', 'radialGradient', 'filter', 'marker', 'foreignObject'].includes(name)) return null;
  const css = resolveStyle(node, inherited);
  const m = multiply(matrix, parseTransform(node.attrs.transform));
  const a = node.attrs;
  const pathItem = (subpaths) => common(createPath(transformSubpaths(subpaths, m), styleFrom(css, ctx.gradients), { fillRule: css['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero' }), node, css);
  try {
    switch (name) {
      case 'g':
      case 'svg':
      case 'a':
      case 'switch': {
        const children = node.children.filter((c) => c.name !== '#text').map((c) => importNode(c, ctx, name === 'svg' && node !== ctx.root ? multiply(m, [1, 0, 0, 1, length(a.x), length(a.y)]) : m, css)).filter(Boolean);
        if (!children.length) return null;
        return common(createGroup(children), node, css);
      }
      case 'path':
        return a.d ? pathItem(parsePathData(a.d)) : null;
      case 'rect': {
        const w = length(a.width);
        const h = length(a.height);
        if (w <= 0 || h <= 0) return null;
        return pathItem(rectangle(length(a.x), length(a.y), w, h, length(a.rx ?? a.ry, 0)));
      }
      case 'circle': {
        const r = length(a.r);
        return r > 0 ? pathItem(ellipse(length(a.cx), length(a.cy), r, r)) : null;
      }
      case 'ellipse': {
        const rx = length(a.rx);
        const ry = length(a.ry);
        return rx > 0 && ry > 0 ? pathItem(ellipse(length(a.cx), length(a.cy), rx, ry)) : null;
      }
      case 'line':
        return pathItem(line(length(a.x1), length(a.y1), length(a.x2), length(a.y2)));
      case 'polyline':
      case 'polygon': {
        const values = String(a.points || '').split(/[\s,]+/).filter(Boolean).map(Number);
        const nodes = [];
        for (let k = 0; k + 1 < values.length; k += 2) nodes.push(makeNode(values[k], values[k + 1]));
        return nodes.length > 1 ? pathItem([{ closed: name === 'polygon', nodes }]) : null;
      }
      case 'text': {
        const content = collectText(node).trim();
        if (!content) return null;
        const size = length(css['font-size'], 16);
        const text = createText(content, 0, 0, {
          font: { family: (css['font-family'] || 'Arial, sans-serif').slice(0, 120), size, weight: parseInt(css['font-weight'], 10) || (css['font-weight'] === 'bold' ? 700 : 400), style: css['font-style'] === 'italic' ? 'italic' : 'normal' },
          align: css['text-anchor'] === 'middle' ? 'center' : css['text-anchor'] === 'end' ? 'right' : 'left',
        });
        const firstSpan = node.children.find((c) => localName(c.name || '') === 'tspan');
        const x = length(a.x ?? firstSpan?.attrs?.x);
        const y = length(a.y ?? firstSpan?.attrs?.y);
        text.matrix = multiply(m, [1, 0, 0, 1, x, y]);
        text.style = styleFrom({ ...css, stroke: css.stroke ?? 'none' }, ctx.gradients);
        return common(text, node, css);
      }
      case 'image': {
        const href = a.href || a['xlink:href'] || '';
        if (!SAFE_IMAGE.test(href)) return null;
        const id = uid('as');
        ctx.assets[id] = href.replace(/\s+/g, '');
        const img = createImage(id, length(a.width, 100), length(a.height, 100));
        img.matrix = multiply(m, [1, 0, 0, 1, length(a.x), length(a.y)]);
        return common(img, node, css);
      }
      default:
        return null;
    }
  } catch {
    ctx.skipped += 1;
    return null;
  }
}

function collectText(node) {
  const parts = [];
  for (const child of node.children || []) {
    if (child.name === '#text') parts.push(child.text);
    else if (localName(child.name) === 'tspan') {
      const value = collectText(child);
      if (child.attrs.dy || child.attrs.y) parts.push('\n');
      parts.push(value);
    }
  }
  return parts.join('').replace(/^\n/, '').replace(/[ \t]+/g, ' ');
}

export function importSVG(source) {
  const root = parseXml(source);
  const svg = (function find(node) {
    if (localName(node.name) === 'svg') return node;
    for (const child of node.children || []) {
      if (child.name === '#text') continue;
      const found = find(child);
      if (found) return found;
    }
    return null;
  })(root);
  if (!svg) throw new Error('O arquivo não é um SVG válido.');
  const viewBox = String(svg.attrs.viewBox || '').split(/[\s,]+/).map(Number);
  const width = length(svg.attrs.width, viewBox[2] || 800);
  const height = length(svg.attrs.height, viewBox[3] || 600);
  let matrix = [...IDENTITY];
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    matrix = [width / viewBox[2], 0, 0, height / viewBox[3], (-viewBox[0] * width) / viewBox[2], (-viewBox[1] * height) / viewBox[3]];
  }
  const ctx = { gradients: collectGradients(svg), assets: {}, skipped: 0, root: svg };
  const items = svg.children.filter((c) => c.name !== '#text').map((c) => importNode(c, ctx, matrix, {})).filter(Boolean);
  return { items, width, height, assets: ctx.assets, skipped: ctx.skipped };
}
