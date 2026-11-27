export const HEX = /^#[0-9a-f]{6}$/i;

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
  magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
  lime: '#00ff00', teal: '#008080', navy: '#000080', purple: '#800080', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a',
  gold: '#ffd700', indigo: '#4b0082', violet: '#ee82ee', crimson: '#dc143c', coral: '#ff7f50', salmon: '#fa8072', khaki: '#f0e68c',
  beige: '#f5f5dc', ivory: '#fffff0', lavender: '#e6e6fa', tan: '#d2b48c', chocolate: '#d2691e', tomato: '#ff6347', turquoise: '#40e0d0',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', darkblue: '#00008b', darkred: '#8b0000', darkgreen: '#006400',
};

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));
const hex2 = (v) => clampByte(v).toString(16).padStart(2, '0');

export function rgbToHex(r, g, b) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function hexToRgb(hex) {
  const value = normalizeHex(hex) || '#000000';
  return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) };
}

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim().toLowerCase();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (/^#[0-9a-f]{4}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (/^#[0-9a-f]{8}$/.test(v)) v = v.slice(0, 7);
  return HEX.test(v) ? v : null;
}

export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value || value === 'none' || value === 'transparent') return { color: null, alpha: 0 };
  if (NAMED[value]) return { color: NAMED[value], alpha: 1 };
  if (value.startsWith('#')) {
    const color = normalizeHex(value);
    if (!color) return null;
    const alpha = value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : value.length === 5 ? parseInt(value[4] + value[4], 16) / 255 : 1;
    return { color, alpha };
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean);
    const channel = (p) => (p.endsWith('%') ? (parseFloat(p) * 255) / 100 : parseFloat(p));
    if (parts.length < 3 || parts.slice(0, 3).some((p) => !Number.isFinite(channel(p)))) return null;
    const alpha = parts[3] !== undefined ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    return { color: rgbToHex(channel(parts[0]), channel(parts[1]), channel(parts[2])), alpha: Number.isFinite(alpha) ? alpha : 1 };
  }
  return null;
}

export function rgbToHsb(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? (d / max) * 100 : 0, b: max * 100 };
}

export function hsbToRgb(h, s, v) {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: clampByte((rgb[0] + m) * 255), g: clampByte((rgb[1] + m) * 255), b: clampByte((rgb[2] + m) * 255) };
}

export function rgbToCmyk(r, g, b) {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return { c: ((1 - r / 255 - k) / (1 - k)) * 100, m: ((1 - g / 255 - k) / (1 - k)) * 100, y: ((1 - b / 255 - k) / (1 - k)) * 100, k: k * 100 };
}

export function cmykToRgb(c, m, y, k) {
  return { r: clampByte(255 * (1 - c / 100) * (1 - k / 100)), g: clampByte(255 * (1 - m / 100) * (1 - k / 100)), b: clampByte(255 * (1 - y / 100) * (1 - k / 100)) };
}

export function mixHex(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t);
}

export function invertHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(255 - r, 255 - g, 255 - b);
}

export function grayscaleHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return rgbToHex(y, y, y);
}

export function paintColor(paint) {
  if (!paint) return null;
  if (paint.type === 'color') return paint.color;
  if (paint.type === 'gradient') return paint.stops?.[0]?.color || '#000000';
  return null;
}

export function mapPaint(paint, fn) {
  if (!paint) return paint;
  if (paint.type === 'color') return { ...paint, color: fn(paint.color) };
  if (paint.type === 'gradient') return { ...paint, stops: paint.stops.map((s) => ({ ...s, color: fn(s.color) })) };
  return paint;
}

export function defaultGradient(kind = 'linear', from = '#ffffff', to = '#000000') {
  return kind === 'radial'
    ? { type: 'gradient', kind, cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: from, opacity: 1 }, { offset: 1, color: to, opacity: 1 }] }
    : { type: 'gradient', kind, x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [{ offset: 0, color: from, opacity: 1 }, { offset: 1, color: to, opacity: 1 }] };
}

export function interpolateStops(stops, t) {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  if (t <= sorted[0].offset) return sorted[0].color;
  for (let i = 1; i < sorted.length; i += 1) {
    if (t <= sorted[i].offset) {
      const a = sorted[i - 1];
      const b = sorted[i];
      return mixHex(a.color, b.color, (t - a.offset) / (b.offset - a.offset || 1));
    }
  }
  return sorted[sorted.length - 1].color;
}
