import { HEX } from './color.js';
import { BLEND_MODES, FORMAT, FORMAT_VERSION, createDocument } from './document.js';
import { SAFE_IMAGE } from './svg.js';

export const LIMITS = Object.freeze({
  items: 100000,
  nodes: 2000000,
  depth: 64,
  artboards: 100,
  layers: 500,
  text: 20000,
  name: 120,
  assetBytes: 25 * 1024 * 1024,
  coordinate: 1e7,
  swatches: 1000,
  symbols: 1000,
});

export const ITEM_TYPES = ['path', 'text', 'image', 'group', 'instance'];
const EFFECT_TYPES = ['dropShadow', 'blur', 'outerGlow', 'innerGlow', 'roundCorners', 'zigZag', 'roughen', 'puckerBloat'];
const ARROWS = ['none', 'arrow', 'triangle', 'circle', 'square', 'bar'];

export class FormatError extends Error {}

function fail(message) {
  throw new FormatError(message);
}

const finite = (v, label) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LIMITS.coordinate) fail(`${label}: número inválido.`);
  return v;
};
const text = (v, label, max = LIMITS.name) => {
  if (typeof v !== 'string') fail(`${label}: texto esperado.`);
  if (v.length > max) fail(`${label}: texto longo demais.`);
  return v;
};
const id = (v, label) => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) fail(`${label}: identificador inválido.`);
  return v;
};
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const color = (v, label) => {
  if (typeof v !== 'string' || !HEX.test(v)) fail(`${label}: cor inválida.`);
  return v.toLowerCase();
};
const matrix = (v, label) => {
  if (!Array.isArray(v) || v.length !== 6) fail(`${label}: matriz inválida.`);
  return v.map((x) => finite(x, label));
};
const unit = (v, label, fallback) => (v === undefined ? fallback : finite(v, label));

function paint(v, label) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') fail(`${label}: pintura inválida.`);
  if (v.type === 'color') return { type: 'color', color: color(v.color, label) };
  if (v.type === 'gradient') {
    if (!['linear', 'radial'].includes(v.kind)) fail(`${label}: tipo de degradê inválido.`);
    if (!Array.isArray(v.stops) || v.stops.length < 1 || v.stops.length > 64) fail(`${label}: paradas do degradê inválidas.`);
    const stops = v.stops.map((s) => ({ offset: Math.max(0, Math.min(1, finite(s.offset, label))), color: color(s.color, label), opacity: Math.max(0, Math.min(1, unit(s.opacity, label, 1))) }));
    const result = { type: 'gradient', kind: v.kind, stops };
    if (v.kind === 'linear') Object.assign(result, { x1: unit(v.x1, label, 0), y1: unit(v.y1, label, 0.5), x2: unit(v.x2, label, 1), y2: unit(v.y2, label, 0.5) });
    else Object.assign(result, { cx: unit(v.cx, label, 0.5), cy: unit(v.cy, label, 0.5), r: Math.max(0, unit(v.r, label, 0.5)) });
    return result;
  }
  return fail(`${label}: pintura inválida.`);
}

function style(v, label) {
  const s = v && typeof v === 'object' ? v : {};
  const dash = Array.isArray(s.dash) ? s.dash.slice(0, 6).map((d) => Math.max(0, finite(d, label))) : [];
  return {
    fill: paint(s.fill, `${label}.fill`),
    stroke: paint(s.stroke, `${label}.stroke`),
    strokeWidth: Math.max(0, Math.min(10000, unit(s.strokeWidth, label, 1))),
    cap: ['butt', 'round', 'projecting'].includes(s.cap) ? s.cap : 'butt',
    join: ['miter', 'round', 'bevel'].includes(s.join) ? s.join : 'miter',
    miterLimit: Math.max(1, Math.min(500, unit(s.miterLimit, label, 10))),
    dash,
    arrowStart: ARROWS.includes(s.arrowStart) ? s.arrowStart : 'none',
    arrowEnd: ARROWS.includes(s.arrowEnd) ? s.arrowEnd : 'none',
  };
}

function effects(list, label) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 32) fail(`${label}: efeitos inválidos.`);
  return list.map((e) => {
    if (!e || !EFFECT_TYPES.includes(e.type)) fail(`${label}: efeito desconhecido.`);
    const out = { type: e.type, enabled: bool(e.enabled, true) };
    for (const key of ['dx', 'dy', 'blur', 'opacity', 'radius', 'size', 'ridges', 'detail', 'seed', 'amount']) if (e[key] !== undefined) out[key] = finite(e[key], label);
    if (e.color !== undefined) out.color = color(e.color, label);
    if (e.smooth !== undefined) out.smooth = !!e.smooth;
    return out;
  });
}

function subpaths(list, label, counter) {
  if (!Array.isArray(list) || list.length > 100000) fail(`${label}: subcaminhos inválidos.`);
  return list.map((s) => {
    if (!s || !Array.isArray(s.nodes)) fail(`${label}: subcaminho inválido.`);
    counter.nodes += s.nodes.length;
    if (counter.nodes > LIMITS.nodes) fail('O documento tem pontos de ancoragem demais.');
    return {
      closed: !!s.closed,
      nodes: s.nodes.map((nd) => {
        const x = finite(nd.x, label);
        const y = finite(nd.y, label);
        return { x, y, ix: unit(nd.ix, label, x), iy: unit(nd.iy, label, y), ox: unit(nd.ox, label, x), oy: unit(nd.oy, label, y), smooth: !!nd.smooth };
      }),
    };
  });
}

function item(v, label, counter, depth, assets, symbolIds) {
  if (!v || typeof v !== 'object' || !ITEM_TYPES.includes(v.type)) fail(`${label}: objeto inválido.`);
  counter.items += 1;
  if (counter.items > LIMITS.items) fail('O documento tem objetos demais.');
  if (depth > LIMITS.depth) fail('Grupos aninhados demais.');
  const base = {
    id: id(v.id, label),
    type: v.type,
    name: v.name === undefined ? '' : text(v.name, label),
    visible: bool(v.visible, true),
    locked: bool(v.locked, false),
    opacity: Math.max(0, Math.min(1, unit(v.opacity, label, 1))),
    blend: BLEND_MODES.includes(v.blend) ? v.blend : 'normal',
    effects: effects(v.effects, label),
  };
  switch (v.type) {
    case 'path':
      return { ...base, fillRule: v.fillRule === 'evenodd' ? 'evenodd' : 'nonzero', subpaths: subpaths(v.subpaths, label, counter), style: style(v.style, label), ...(v.blendStep === true ? { blendStep: true } : {}) };
    case 'text': {
      const font = v.font && typeof v.font === 'object' ? v.font : {};
      return {
        ...base,
        content: text(v.content ?? '', label, LIMITS.text),
        matrix: matrix(v.matrix ?? [1, 0, 0, 1, 0, 0], label),
        font: {
          family: text(font.family ?? 'Arial, sans-serif', label).replace(/[<>"\\;{}]/g, ''),
          size: Math.max(0.5, Math.min(5000, unit(font.size, label, 24))),
          weight: Math.max(100, Math.min(900, Math.round(unit(font.weight, label, 400) / 100) * 100)),
          style: font.style === 'italic' ? 'italic' : 'normal',
          leading: Math.max(0.1, Math.min(20, unit(font.leading, label, 1.2))),
          tracking: Math.max(-1000, Math.min(10000, unit(font.tracking, label, 0))),
        },
        align: ['left', 'center', 'right', 'justify'].includes(v.align) ? v.align : 'left',
        area: v.area ? { width: Math.max(1, finite(v.area.width, label)), height: Math.max(1, finite(v.area.height, label)) } : null,
        onPath: v.onPath ? subpaths(v.onPath, label, counter) : null,
        pathOffset: unit(v.pathOffset, label, 0),
        style: style(v.style, label),
      };
    }
    case 'image':
      if (typeof v.asset !== 'string' || !(v.asset in assets)) fail(`${label}: imagem sem arquivo.`);
      return { ...base, asset: id(v.asset, label), width: Math.max(0, finite(v.width, label)), height: Math.max(0, finite(v.height, label)), matrix: matrix(v.matrix, label) };
    case 'instance':
      if (!symbolIds.has(v.symbol)) fail(`${label}: símbolo inexistente.`);
      return { ...base, symbol: v.symbol, matrix: matrix(v.matrix, label) };
    case 'group':
      if (!Array.isArray(v.children)) fail(`${label}: grupo inválido.`);
      return { ...base, clip: !!v.clip, children: v.children.map((c, i) => item(c, `${label}.${i}`, counter, depth + 1, assets, symbolIds)) };
    default:
      return fail(`${label}: objeto inválido.`);
  }
}

export function validateDocument(raw) {
  if (!raw || typeof raw !== 'object') fail('Arquivo vazio ou corrompido.');
  if (raw.format !== FORMAT) fail('Este arquivo não é um documento do Vinco.');
  if (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > FORMAT_VERSION) fail(`Versão de arquivo não suportada: ${raw.version}.`);
  const counter = { items: 0, nodes: 0 };
  const assets = {};
  if (raw.assets && typeof raw.assets === 'object') {
    for (const [key, value] of Object.entries(raw.assets)) {
      id(key, 'assets');
      if (typeof value !== 'string' || value.length > LIMITS.assetBytes * 1.4 || !SAFE_IMAGE.test(value)) fail('Imagem incorporada inválida (aceita PNG, JPEG, GIF e WebP).');
      assets[key] = value;
    }
  }
  if (!Array.isArray(raw.artboards) || !raw.artboards.length || raw.artboards.length > LIMITS.artboards) fail('Pranchetas inválidas.');
  if (!Array.isArray(raw.layers) || !raw.layers.length || raw.layers.length > LIMITS.layers) fail('Camadas inválidas.');
  const symbolsRaw = Array.isArray(raw.symbols) ? raw.symbols.slice(0, LIMITS.symbols) : [];
  const symbolIds = new Set(symbolsRaw.map((s) => s?.id));
  const symbols = symbolsRaw.map((s, i) => {
    if (!Array.isArray(s?.children)) fail('Símbolo inválido.');
    return { id: id(s.id, `symbols.${i}`), name: text(s.name ?? 'Símbolo', 'symbols'), children: s.children.map((c, k) => item(c, `symbols.${i}.${k}`, counter, 1, assets, new Set())) };
  });
  const doc = {
    format: FORMAT,
    version: FORMAT_VERSION,
    name: text(raw.name ?? 'Sem título', 'name'),
    units: ['px', 'pt', 'mm', 'cm', 'in'].includes(raw.units) ? raw.units : 'px',
    background: raw.background && HEX.test(raw.background) ? raw.background.toLowerCase() : '#ffffff',
    artboards: raw.artboards.map((a, i) => ({
      id: id(a.id, `artboards.${i}`),
      name: text(a.name ?? `Prancheta ${i + 1}`, 'artboards'),
      x: finite(a.x, 'artboards'),
      y: finite(a.y, 'artboards'),
      width: Math.max(1, finite(a.width, 'artboards')),
      height: Math.max(1, finite(a.height, 'artboards')),
    })),
    layers: raw.layers.map((l, i) => {
      if (!l || !Array.isArray(l.children)) fail('Camada inválida.');
      return {
        id: id(l.id, `layers.${i}`),
        type: 'layer',
        name: text(l.name ?? `Camada ${i + 1}`, 'layers'),
        visible: bool(l.visible, true),
        locked: bool(l.locked, false),
        color: l.color && HEX.test(l.color) ? l.color.toLowerCase() : '#4f7cff',
        children: l.children.map((c, k) => item(c, `layers.${i}.${k}`, counter, 1, assets, symbolIds)),
      };
    }),
    swatches: Array.isArray(raw.swatches) ? raw.swatches.filter((s) => typeof s === 'string' && HEX.test(s)).slice(0, LIMITS.swatches).map((s) => s.toLowerCase()) : [],
    symbols,
    assets,
    guides: {
      horizontal: Array.isArray(raw.guides?.horizontal) ? raw.guides.horizontal.slice(0, 500).map((g) => finite(g, 'guides')) : [],
      vertical: Array.isArray(raw.guides?.vertical) ? raw.guides.vertical.slice(0, 500).map((g) => finite(g, 'guides')) : [],
    },
  };
  const seen = new Set();
  const check = (list) => {
    for (const it of list) {
      if (seen.has(it.id)) fail('Identificadores repetidos no documento.');
      seen.add(it.id);
      if (it.children) check(it.children);
    }
  };
  check(doc.layers);
  return doc;
}

export function serializeDocument(doc, { pretty = false } = {}) {
  return JSON.stringify(doc, null, pretty ? 1 : 0);
}

export function parseDocument(source) {
  let raw;
  try {
    raw = typeof source === 'string' ? JSON.parse(source) : source;
  } catch {
    fail('O arquivo não é um JSON válido.');
  }
  return validateDocument(raw);
}

export function snapshotOf(doc) {
  const { assets, ...rest } = doc;
  return JSON.stringify(rest);
}

export function restoreSnapshot(snapshot, assets) {
  return { ...JSON.parse(snapshot), assets };
}

export function blankDocument(options) {
  return createDocument(options);
}

