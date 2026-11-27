import {
  IDENTITY,
  applyMatrix,
  boundsIntersect,
  determinant,
  emptyBounds,
  extendBounds,
  invert,
  isEmptyBounds,
  multiply,
  transformBounds,
  translation,
  unionBounds,
} from './geometry.js';
import { cloneSubpaths, hitPath, subpathsBounds, transformSubpaths } from './path.js';

export const FORMAT = 'vinco';
export const FORMAT_VERSION = 1;

export const LAYER_COLORS = ['#4f7cff', '#e0473c', '#3aa655', '#a24fd6', '#e8902c', '#2ba6b8', '#d6489a', '#8a8a8a'];

export const DEFAULT_SWATCHES = [
  '#000000', '#ffffff', '#5d1c16', '#a3b4be', '#5c4034', '#e6ddce', '#7a6e46', '#d6bdb8', '#f6e4a6',
  '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00897b', '#1e88e5', '#3949ab', '#8e24aa', '#d81b60',
  '#757575', '#bdbdbd', '#eeeeee', '#263238', '#795548', '#ff7043',
];

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

export const FONT_FAMILIES = [
  'Inter, system-ui, sans-serif', 'Arial, Helvetica, sans-serif', 'Georgia, serif', "'Times New Roman', Times, serif",
  "'Courier New', Courier, monospace", 'Verdana, sans-serif', "'Trebuchet MS', sans-serif", 'Impact, sans-serif',
];

let sequence = 0;

export function uid(prefix = 'i') {
  sequence = (sequence + 1) % 1679616;
  let random = '';
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(6));
    random = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 9);
  } else {
    random = Math.random().toString(36).slice(2, 11);
  }
  return `${prefix}${sequence.toString(36)}${random}`;
}

export const solid = (color) => ({ type: 'color', color });

export function defaultStyle(overrides = {}) {
  return {
    fill: solid('#ffffff'),
    stroke: solid('#000000'),
    strokeWidth: 1,
    cap: 'butt',
    join: 'miter',
    miterLimit: 10,
    dash: [],
    arrowStart: 'none',
    arrowEnd: 'none',
    ...overrides,
  };
}

export function cloneStyle(style) {
  return JSON.parse(JSON.stringify(style || defaultStyle()));
}

export function createLayer(name = 'Camada 1', index = 0) {
  return { id: uid('l'), type: 'layer', name, visible: true, locked: false, color: LAYER_COLORS[index % LAYER_COLORS.length], children: [] };
}

export function createArtboard(name, x, y, width, height) {
  return { id: uid('a'), name, x, y, width, height };
}

export function createDocument({ name = 'Sem título', width = 800, height = 600, units = 'px', artboards = 1, background = '#ffffff' } = {}) {
  const boards = [];
  for (let i = 0; i < Math.max(1, artboards); i += 1) boards.push(createArtboard(`Prancheta ${i + 1}`, i * (width + 40), 0, width, height));
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    name,
    units,
    background,
    artboards: boards,
    layers: [createLayer('Camada 1', 0)],
    swatches: [...DEFAULT_SWATCHES],
    symbols: [],
    assets: {},
    guides: { horizontal: [], vertical: [] },
  };
}

export function createPath(subpaths, style = defaultStyle(), extra = {}) {
  return { id: uid('p'), type: 'path', name: '', visible: true, locked: false, opacity: 1, blend: 'normal', effects: [], fillRule: 'nonzero', subpaths, style, ...extra };
}

export function createText(content, x, y, options = {}) {
  return {
    id: uid('t'),
    type: 'text',
    name: '',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    effects: [],
    content,
    matrix: [1, 0, 0, 1, x, y],
    font: { family: FONT_FAMILIES[0], size: 24, weight: 400, style: 'normal', leading: 1.2, tracking: 0, ...(options.font || {}) },
    align: options.align || 'left',
    area: options.area || null,
    onPath: options.onPath || null,
    pathOffset: options.pathOffset || 0,
    style: options.style || defaultStyle({ fill: solid('#000000'), stroke: null, strokeWidth: 0 }),
  };
}

export function createImage(asset, width, height, x = 0, y = 0) {
  return { id: uid('m'), type: 'image', name: '', visible: true, locked: false, opacity: 1, blend: 'normal', effects: [], asset, width, height, matrix: [1, 0, 0, 1, x, y] };
}

export function createGroup(children, extra = {}) {
  return { id: uid('g'), type: 'group', name: '', visible: true, locked: false, opacity: 1, blend: 'normal', effects: [], clip: false, children, ...extra };
}

export function createInstance(symbolId, matrix = [...IDENTITY]) {
  return { id: uid('s'), type: 'instance', name: '', visible: true, locked: false, opacity: 1, blend: 'normal', effects: [], symbol: symbolId, matrix };
}

export function* walk(items, depth = 0, parent = null) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    yield { item, parent, index, depth };
    if (item.children) yield* walk(item.children, depth + 1, item);
  }
}

export function* walkDocument(doc) {
  for (const layer of doc.layers) {
    yield { item: layer, parent: null, index: doc.layers.indexOf(layer), depth: 0, layer };
    for (const entry of walk(layer.children, 1, layer)) yield { ...entry, layer };
  }
}

export function findItem(doc, id) {
  for (const entry of walkDocument(doc)) if (entry.item.id === id) return { ...entry, siblings: entry.parent ? entry.parent.children : doc.layers };
  return null;
}

export function ancestors(doc, id) {
  const path = [];
  const visit = (items, trail) => {
    for (const item of items) {
      if (item.id === id) {
        path.push(...trail);
        return true;
      }
      if (item.children && visit(item.children, [...trail, item])) return true;
    }
    return false;
  };
  visit(doc.layers, []);
  return path;
}

export function topLevelOf(doc, id) {
  const chain = ancestors(doc, id);
  return chain.length >= 2 ? chain[1] : findItem(doc, id)?.item || null;
}

export function isEditable(doc, id) {
  const entry = findItem(doc, id);
  if (!entry) return false;
  const chain = [...ancestors(doc, id), entry.item];
  return chain.every((item) => item.visible !== false && !item.locked);
}

let measureText = (text, font) => text.length * font.size * 0.56;

export function setTextMeasurer(fn) {
  measureText = fn;
}

export function layoutText(item) {
  const font = item.font;
  const lineHeight = font.size * (font.leading || 1.2);
  const tracking = ((font.tracking || 0) / 1000) * font.size;
  const width = (text) => measureText(text, font) + Math.max(0, text.length - 1) * tracking;
  const paragraphs = String(item.content).split('\n');
  const lines = [];
  if (item.area) {
    for (const paragraph of paragraphs) {
      const words = paragraph.split(/(\s+)/);
      let current = '';
      for (const word of words) {
        const attempt = current + word;
        if (current && width(attempt.trimEnd()) > item.area.width) {
          lines.push({ text: current.trimEnd(), last: false });
          current = word.trimStart();
        } else {
          current = attempt;
        }
      }
      lines.push({ text: current.trimEnd(), last: true });
    }
  } else {
    lines.push(...paragraphs.map((text) => ({ text, last: true })));
  }
  const boxWidth = item.area ? item.area.width : Math.max(0, ...lines.map((l) => width(l.text)));
  return lines.map(({ text, last }, i) => {
    const w = width(text);
    let x = 0;
    if (item.align === 'center') x = item.area ? (boxWidth - w) / 2 : -w / 2;
    if (item.align === 'right') x = item.area ? boxWidth - w : -w;
    const y = item.area ? font.size + i * lineHeight : i * lineHeight;
    return { text, x, y, width: w, last };
  });
}

export function textLocalBounds(item) {
  const lines = layoutText(item);
  const font = item.font;
  if (item.area) return { minX: 0, minY: 0, maxX: item.area.width, maxY: item.area.height };
  const bounds = emptyBounds();
  for (const l of lines) {
    extendBounds(bounds, { x: l.x, y: l.y - font.size * 0.8 });
    extendBounds(bounds, { x: l.x + Math.max(l.width, 1), y: l.y + font.size * 0.25 });
  }
  return bounds;
}

export function itemBounds(item, doc, matrix = IDENTITY) {
  if (!item || item.visible === false) return emptyBounds();
  switch (item.type) {
    case 'path':
      return isIdentityMatrix(matrix) ? subpathsBounds(item.subpaths) : subpathsBounds(transformSubpaths(item.subpaths, matrix));
    case 'text':
      if (item.onPath) return subpathsBounds(transformSubpaths(item.onPath, matrix));
      return transformBounds(textLocalBounds(item), multiply(matrix, item.matrix));
    case 'image':
      return transformBounds({ minX: 0, minY: 0, maxX: item.width, maxY: item.height }, multiply(matrix, item.matrix));
    case 'instance': {
      const symbol = doc?.symbols?.find((s) => s.id === item.symbol);
      if (!symbol) return emptyBounds();
      const m = multiply(matrix, item.matrix);
      return symbol.children.reduce((acc, child) => unionBounds(acc, itemBounds(child, doc, m)), emptyBounds());
    }
    case 'group':
    case 'layer': {
      if (item.clip && item.children.length) return itemBounds(item.children[item.children.length - 1], doc, matrix);
      return item.children.reduce((acc, child) => unionBounds(acc, itemBounds(child, doc, matrix)), emptyBounds());
    }
    default:
      return emptyBounds();
  }
}

function isIdentityMatrix(m) {
  return m === IDENTITY || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);
}

export function selectionBounds(doc, items) {
  return items.reduce((acc, item) => unionBounds(acc, itemBounds(item, doc)), emptyBounds());
}

export function transformItem(item, m, { scaleStrokes = true } = {}) {
  const factor = Math.sqrt(Math.abs(determinant(m)));
  const scaleStroke = (style) => {
    if (scaleStrokes && style && Number.isFinite(style.strokeWidth)) style.strokeWidth = Math.max(0, style.strokeWidth * factor);
  };
  switch (item.type) {
    case 'path':
      item.subpaths = transformSubpaths(item.subpaths, m);
      scaleStroke(item.style);
      break;
    case 'text':
      if (item.onPath) item.onPath = transformSubpaths(item.onPath, m);
      else item.matrix = multiply(m, item.matrix);
      break;
    case 'image':
    case 'instance':
      item.matrix = multiply(m, item.matrix);
      break;
    case 'group':
    case 'layer':
      for (const child of item.children) transformItem(child, m, { scaleStrokes });
      break;
    default:
      break;
  }
  for (const effect of item.effects || []) {
    if (effect.type === 'dropShadow') {
      const v = applyMatrix([m[0], m[1], m[2], m[3], 0, 0], { x: effect.dx, y: effect.dy });
      effect.dx = v.x;
      effect.dy = v.y;
    }
  }
  return item;
}

export function cloneItem(item, keepIds = false) {
  const copy = JSON.parse(JSON.stringify(item));
  if (!keepIds) {
    for (const entry of walk([copy])) entry.item.id = uid(entry.item.id[0] || 'i');
  }
  return copy;
}

export function removeItem(doc, id) {
  const entry = findItem(doc, id);
  if (!entry || entry.item.type === 'layer') return null;
  entry.siblings.splice(entry.index, 1);
  return entry.item;
}

export function insertItem(container, item, index = container.children.length) {
  container.children.splice(Math.max(0, Math.min(index, container.children.length)), 0, item);
  return item;
}

export function containerFor(doc, id) {
  const entry = findItem(doc, id);
  if (!entry) return null;
  return entry.parent || null;
}

export function orderIds(doc, ids) {
  const set = new Set(ids);
  const ordered = [];
  for (const entry of walkDocument(doc)) if (set.has(entry.item.id)) ordered.push(entry.item.id);
  return ordered;
}

export function groupItems(doc, ids) {
  const ordered = orderIds(doc, ids).filter((id) => findItem(doc, id)?.item.type !== 'layer');
  if (!ordered.length) return null;
  const topId = ordered[ordered.length - 1];
  const topEntry = findItem(doc, topId);
  const container = topEntry.parent;
  const before = ordered.filter((id) => {
    const e = findItem(doc, id);
    return e.parent === container && e.index < topEntry.index;
  }).length;
  const items = ordered.map((id) => removeItem(doc, id));
  const group = createGroup(items);
  insertItem(container, group, topEntry.index - before);
  return group;
}

export function ungroupItem(doc, id) {
  const entry = findItem(doc, id);
  if (!entry || entry.item.type !== 'group') return [];
  const group = entry.item;
  const children = group.children;
  if (group.clip) group.clip = false;
  for (const child of children) {
    if ((group.opacity ?? 1) !== 1) child.opacity = (child.opacity ?? 1) * group.opacity;
  }
  entry.siblings.splice(entry.index, 1, ...children);
  return children;
}

export function arrange(doc, ids, mode) {
  const byContainer = new Map();
  for (const id of ids) {
    const entry = findItem(doc, id);
    if (!entry || !entry.parent) continue;
    if (!byContainer.has(entry.parent)) byContainer.set(entry.parent, []);
    byContainer.get(entry.parent).push(entry.item);
  }
  for (const [container, items] of byContainer) {
    const list = container.children;
    const selected = new Set(items);
    if (mode === 'front' || mode === 'back') {
      const rest = list.filter((item) => !selected.has(item));
      const moving = list.filter((item) => selected.has(item));
      container.children = mode === 'front' ? [...rest, ...moving] : [...moving, ...rest];
    } else if (mode === 'forward') {
      for (let i = list.length - 2; i >= 0; i -= 1) {
        if (selected.has(list[i]) && !selected.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
      }
    } else if (mode === 'backward') {
      for (let i = 1; i < list.length; i += 1) {
        if (selected.has(list[i]) && !selected.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
      }
    }
  }
}

export function alignOffsets(rects, mode, reference) {
  return rects.map((r) => {
    switch (mode) {
      case 'left':
        return { dx: reference.minX - r.minX, dy: 0 };
      case 'hcenter':
        return { dx: (reference.minX + reference.maxX) / 2 - (r.minX + r.maxX) / 2, dy: 0 };
      case 'right':
        return { dx: reference.maxX - r.maxX, dy: 0 };
      case 'top':
        return { dx: 0, dy: reference.minY - r.minY };
      case 'vcenter':
        return { dx: 0, dy: (reference.minY + reference.maxY) / 2 - (r.minY + r.maxY) / 2 };
      case 'bottom':
        return { dx: 0, dy: reference.maxY - r.maxY };
      default:
        return { dx: 0, dy: 0 };
    }
  });
}

export function distributeOffsets(rects, mode, spacing = null) {
  const result = rects.map(() => ({ dx: 0, dy: 0 }));
  if (rects.length < 2) return result;
  const horizontal = ['left', 'hcenter', 'right', 'hspace'].includes(mode);
  const key = (r) => {
    if (mode === 'left') return r.minX;
    if (mode === 'right') return r.maxX;
    if (mode === 'hcenter' || mode === 'hspace') return (r.minX + r.maxX) / 2;
    if (mode === 'top') return r.minY;
    if (mode === 'bottom') return r.maxY;
    return (r.minY + r.maxY) / 2;
  };
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => key(a.r) - key(b.r));
  if (mode === 'hspace' || mode === 'vspace') {
    const size = (r) => (horizontal ? r.maxX - r.minX : r.maxY - r.minY);
    const start = horizontal ? order[0].r.minX : order[0].r.minY;
    const end = horizontal ? order[order.length - 1].r.maxX : order[order.length - 1].r.maxY;
    const total = order.reduce((s, o) => s + size(o.r), 0);
    const gap = spacing ?? (end - start - total) / (order.length - 1);
    let cursor = start;
    for (const o of order) {
      const current = horizontal ? o.r.minX : o.r.minY;
      if (horizontal) result[o.i].dx = cursor - current;
      else result[o.i].dy = cursor - current;
      cursor += size(o.r) + gap;
    }
    return result;
  }
  const first = key(order[0].r);
  const last = key(order[order.length - 1].r);
  const step = (last - first) / (order.length - 1);
  order.forEach((o, k) => {
    const delta = first + step * k - key(o.r);
    if (horizontal) result[o.i].dx = delta;
    else result[o.i].dy = delta;
  });
  return result;
}

export function hitItem(item, p, doc, tolerance, matrix = IDENTITY) {
  if (item.visible === false) return false;
  switch (item.type) {
    case 'path': {
      const subs = isIdentityMatrix(matrix) ? item.subpaths : transformSubpaths(item.subpaths, matrix);
      const filled = !!item.style?.fill;
      const strokeTolerance = tolerance + (item.style?.stroke ? (item.style.strokeWidth || 0) / 2 : 0);
      return hitPath(subs, p, { tolerance: strokeTolerance, filled, fillRule: item.fillRule });
    }
    case 'text':
    case 'image': {
      const b = itemBounds(item, doc, matrix);
      return p.x >= b.minX - tolerance && p.x <= b.maxX + tolerance && p.y >= b.minY - tolerance && p.y <= b.maxY + tolerance;
    }
    case 'instance': {
      const symbol = doc.symbols.find((s) => s.id === item.symbol);
      const m = multiply(matrix, item.matrix);
      return !!symbol && symbol.children.some((child) => hitItem(child, p, doc, tolerance, m));
    }
    case 'group':
      if (item.clip && item.children.length) return hitItem(item.children[item.children.length - 1], p, doc, tolerance, matrix) && item.children.slice(0, -1).some((c) => hitItem(c, p, doc, tolerance, matrix));
      return item.children.some((child) => hitItem(child, p, doc, tolerance, matrix));
    default:
      return false;
  }
}

export function hitTest(doc, p, tolerance = 3, { deep = false } = {}) {
  for (let l = doc.layers.length - 1; l >= 0; l -= 1) {
    const layer = doc.layers[l];
    if (!layer.visible || layer.locked) continue;
    for (let i = layer.children.length - 1; i >= 0; i -= 1) {
      const item = layer.children[i];
      if (item.locked || item.visible === false) continue;
      if (!hitItem(item, p, doc, tolerance)) continue;
      if (!deep || item.type !== 'group') return item;
      return deepHit(item, p, doc, tolerance) || item;
    }
  }
  return null;
}

function deepHit(group, p, doc, tolerance) {
  for (let i = group.children.length - 1; i >= 0; i -= 1) {
    const child = group.children[i];
    if (child.locked || child.visible === false) continue;
    if (hitItem(child, p, doc, tolerance)) return child.type === 'group' ? deepHit(child, p, doc, tolerance) || child : child;
  }
  return null;
}

export function itemsInRect(doc, rect, { deep = false } = {}) {
  const result = [];
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    const pool = deep ? [...walk(layer.children)].map((e) => e.item).filter((i) => i.type !== 'group') : layer.children;
    for (const item of pool) {
      if (item.locked || item.visible === false) continue;
      if (boundsIntersect(itemBounds(item, doc), rect)) result.push(item);
    }
  }
  return result;
}

export function moveItems(items, dx, dy) {
  const m = translation(dx, dy);
  for (const item of items) transformItem(item, m, { scaleStrokes: false });
}

export function itemLabel(item) {
  if (item.name) return item.name;
  const labels = { path: 'Caminho', text: 'Texto', image: 'Imagem', group: item?.clip ? 'Grupo de recorte' : 'Grupo', instance: 'Símbolo', layer: 'Camada' };
  if (item.type === 'path' && item.subpaths.length > 1) return 'Caminho composto';
  if (item.type === 'text') return String(item.content).slice(0, 24) || 'Texto';
  return labels[item.type] || item.type;
}

export function itemToLocal(item, p) {
  return applyMatrix(invert(item.matrix || IDENTITY), p);
}

export function collectPaths(items) {
  const result = [];
  for (const entry of walk(items)) if (entry.item.type === 'path') result.push(entry.item);
  return result;
}

export function subpathsOf(item) {
  return item.type === 'path' ? cloneSubpaths(item.subpaths) : [];
}

export function countItems(doc) {
  let count = 0;
  for (const entry of walkDocument(doc)) if (entry.item.type !== 'layer') count += 1;
  return count;
}

export function documentBounds(doc) {
  let bounds = emptyBounds();
  for (const a of doc.artboards) bounds = unionBounds(bounds, { minX: a.x, minY: a.y, maxX: a.x + a.width, maxY: a.y + a.height });
  for (const layer of doc.layers) bounds = unionBounds(bounds, itemBounds(layer, doc));
  return isEmptyBounds(bounds) ? { minX: 0, minY: 0, maxX: 100, maxY: 100 } : bounds;
}
