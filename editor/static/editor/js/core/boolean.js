import { polygonClipping } from '../vendor/polygon-clipping.js';
import { add, distance, normalize, pointInRings, polygonArea, scale, sub } from './geometry.js';
import { flatten, polylineToSubpath } from './path.js';

const FLATTEN_TOLERANCE = 0.12;
const CIRCLE_STEPS = 24;

const toRing = (points) => {
  const ring = points.map((p) => [p.x, p.y]);
  if (ring.length) ring.push([...ring[0]]);
  return ring;
};

const fromRing = (ring) => {
  const points = ring.map(([x, y]) => ({ x, y }));
  if (points.length > 1 && distance(points[0], points[points.length - 1]) < 1e-9) points.pop();
  return points;
};

const EMPTY = [];

function safe(op, ...geoms) {
  const usable = geoms.filter((g) => Array.isArray(g) && g.length);
  if (!usable.length) return EMPTY;
  if (usable.length === 1 && op !== 'difference') return op === 'intersection' ? usable[0] : polygonClipping.union(usable[0]);
  try {
    return polygonClipping[op](...usable);
  } catch {
    return polygonClipping[op](...usable.map((g) => roundGeom(g)));
  }
}

function roundGeom(geom) {
  return geom.map((poly) => poly.map((ring) => ring.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])));
}

export const union = (...geoms) => safe('union', ...geoms);
export const intersection = (...geoms) => safe('intersection', ...geoms);
export const xor = (...geoms) => safe('xor', ...geoms);

export function difference(subject, ...clips) {
  if (!subject.length) return EMPTY;
  const usable = clips.filter((g) => g.length);
  if (!usable.length) return subject;
  try {
    return polygonClipping.difference(subject, ...usable);
  } catch {
    return polygonClipping.difference(roundGeom(subject), ...usable.map(roundGeom));
  }
}

export function subpathsToGeom(subpaths, fillRule = 'nonzero') {
  const rings = flatten(subpaths, FLATTEN_TOLERANCE)
    .map((f) => f.points)
    .filter((points) => points.length > 2 && Math.abs(polygonArea(points)) > 1e-6);
  if (!rings.length) return EMPTY;
  if (fillRule === 'evenodd') return xor(...rings.map((r) => [[toRing(r)]]));
  const solids = [];
  const holes = [];
  rings.forEach((ring, index) => {
    const sign = Math.sign(polygonArea(ring));
    const probe = ring[0];
    const container = rings.find((other, j) => j !== index && Math.abs(polygonArea(other)) > Math.abs(polygonArea(ring)) && pointInRings(probe, [other], 'evenodd'));
    if (container && Math.sign(polygonArea(container)) !== sign) holes.push([[toRing(ring)]]);
    else solids.push([[toRing(ring)]]);
  });
  const filled = union(...solids);
  return holes.length ? difference(filled, union(...holes)) : filled;
}

export function geomToSubpaths(geom, { smooth = true, error = 0.3 } = {}) {
  const subpaths = [];
  for (const polygon of geom) {
    polygon.forEach((ring, index) => {
      let points = fromRing(ring);
      if (points.length < 3) return;
      const area = polygonArea(points);
      if ((index === 0 && area < 0) || (index > 0 && area > 0)) points = points.reverse();
      subpaths.push(polylineToSubpath(points, true, { smooth, error }));
    });
  }
  return subpaths;
}

export const geomArea = (geom) => geom.reduce((total, poly) => total + poly.reduce((s, ring, i) => s + (i === 0 ? 1 : -1) * Math.abs(polygonArea(fromRing(ring))), 0), 0);

export function circlePolygon(center, radius, steps = CIRCLE_STEPS) {
  const ring = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius]);
  }
  ring.push([...ring[0]]);
  return [[ring]];
}

function quad(a, b, r) {
  const d = normalize(sub(b, a));
  if (!d.x && !d.y) return null;
  const n = { x: -d.y * r, y: d.x * r };
  return [
    [
      [
        [a.x + n.x, a.y + n.y],
        [b.x + n.x, b.y + n.y],
        [b.x - n.x, b.y - n.y],
        [a.x - n.x, a.y - n.y],
        [a.x + n.x, a.y + n.y],
      ],
    ],
  ];
}

function joinPiece(prev, p, next, r, join, miterLimit) {
  if (join === 'round') return circlePolygon(p, r, 16);
  const d1 = normalize(sub(p, prev));
  const d2 = normalize(sub(next, p));
  const turn = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(turn) < 1e-9) return null;
  const side = turn > 0 ? -1 : 1;
  const n1 = { x: -d1.y * r * side, y: d1.x * r * side };
  const n2 = { x: -d2.y * r * side, y: d2.x * r * side };
  const a = add(p, n1);
  const b = add(p, n2);
  const pieces = [
    [p.x, p.y],
    [a.x, a.y],
  ];
  if (join === 'miter') {
    const bisector = normalize(add(n1, n2));
    const cosHalf = (n1.x * bisector.x + n1.y * bisector.y) / r;
    const miterLength = cosHalf > 1e-6 ? r / cosHalf : Infinity;
    if (miterLength / r <= miterLimit) {
      const m = add(p, scale(bisector, miterLength));
      pieces.push([m.x, m.y]);
    }
  }
  pieces.push([b.x, b.y], [p.x, p.y]);
  return [[pieces]];
}

export function bufferPolyline(points, closed, radius, { join = 'round', cap = 'round', miterLimit = 4 } = {}) {
  const pts = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 1e-9);
  if (!pts.length || radius <= 0) return EMPTY;
  if (pts.length === 1) return cap === 'butt' ? EMPTY : circlePolygon(pts[0], radius);
  const parts = [];
  const count = closed ? pts.length : pts.length - 1;
  const list = [...pts];
  if (!closed && cap === 'square') {
    const d0 = normalize(sub(list[0], list[1]));
    const d1 = normalize(sub(list[list.length - 1], list[list.length - 2]));
    list[0] = add(list[0], scale(d0, radius));
    list[list.length - 1] = add(list[list.length - 1], scale(d1, radius));
  }
  for (let i = 0; i < count; i += 1) {
    const piece = quad(list[i], list[(i + 1) % list.length], radius);
    if (piece) parts.push(piece);
  }
  const total = list.length;
  for (let i = 0; i < total; i += 1) {
    const isEnd = !closed && (i === 0 || i === total - 1);
    if (isEnd) {
      if (cap === 'round') parts.push(circlePolygon(list[i], radius));
      continue;
    }
    const piece = joinPiece(list[(i - 1 + total) % total], list[i], list[(i + 1) % total], radius, join, miterLimit);
    if (piece) parts.push(piece);
  }
  return union(...parts);
}

export function strokeGeom(subpaths, width, options = {}) {
  const parts = flatten(subpaths, FLATTEN_TOLERANCE).map((f) => bufferPolyline(f.points, f.closed, width / 2, options));
  return union(...parts);
}

export function offsetGeom(subpaths, delta, { join = 'miter', miterLimit = 4, fillRule = 'nonzero' } = {}) {
  const base = subpathsToGeom(
    subpaths.map((s) => ({ ...s, closed: true })),
    fillRule,
  );
  if (!delta) return base;
  const boundary = [];
  for (const poly of base) for (const ring of poly) boundary.push(bufferPolyline(fromRing(ring), true, Math.abs(delta), { join, miterLimit }));
  const band = union(...boundary);
  return delta > 0 ? union(base, band) : difference(base, band);
}

function itemGeom(entry) {
  return entry.geom || (entry.geom = subpathsToGeom(entry.subpaths, entry.fillRule));
}

export function planarPartition(entries) {
  let regions = [];
  entries.forEach((entry, index) => {
    const geom = itemGeom(entry);
    if (!geom.length) return;
    const next = [];
    for (const region of regions) {
      const inside = intersection(region.geom, geom);
      const outside = difference(region.geom, geom);
      if (inside.length && geomArea(inside) > 0.01) next.push({ geom: inside, owners: [...region.owners, index] });
      if (outside.length && geomArea(outside) > 0.01) next.push({ geom: outside, owners: region.owners });
    }
    const covered = regions.length ? union(...regions.map((r) => r.geom)) : EMPTY;
    const fresh = covered.length ? difference(geom, covered) : geom;
    if (fresh.length && geomArea(fresh) > 0.01) next.push({ geom: fresh, owners: [index] });
    regions = next;
  });
  const result = [];
  for (const region of regions) {
    for (const polygon of region.geom) result.push({ geom: [polygon], owners: region.owners, top: region.owners[region.owners.length - 1] });
  }
  return result;
}

export function pathfinder(op, entries) {
  if (entries.length < 1) return [];
  const geoms = entries.map(itemGeom);
  const top = entries.length - 1;
  switch (op) {
    case 'unite':
      return [{ geom: union(...geoms), source: top }];
    case 'minusFront':
      return [{ geom: difference(geoms[0], ...geoms.slice(1)), source: 0 }];
    case 'minusBack':
      return [{ geom: difference(geoms[top], ...geoms.slice(0, top)), source: top }];
    case 'intersect':
      return [{ geom: geoms.slice(1).reduce((acc, g) => intersection(acc, g), geoms[0]), source: top }];
    case 'exclude':
      return [{ geom: xor(...geoms), source: top }];
    case 'divide':
      return planarPartition(entries).map((r) => ({ geom: r.geom, source: r.top }));
    case 'trim': {
      const result = [];
      geoms.forEach((geom, index) => {
        const above = geoms.slice(index + 1);
        const visible = above.length ? difference(geom, union(...above)) : geom;
        for (const polygon of visible) result.push({ geom: [polygon], source: index });
      });
      return result;
    }
    case 'merge': {
      const trimmed = pathfinder('trim', entries);
      const groups = new Map();
      for (const piece of trimmed) {
        const key = entries[piece.source].key || String(piece.source);
        if (!groups.has(key)) groups.set(key, { geoms: [], source: piece.source });
        groups.get(key).geoms.push(piece.geom);
      }
      return [...groups.values()].map((g) => ({ geom: union(...g.geoms), source: g.source }));
    }
    case 'crop': {
      const cutter = geoms[top];
      const result = [];
      geoms.slice(0, top).forEach((geom, index) => {
        const inside = intersection(geom, cutter);
        if (inside.length) result.push({ geom: inside, source: index });
      });
      return result;
    }
    case 'outline':
      return planarPartition(entries).map((r) => ({ geom: r.geom, source: r.top, outline: true }));
    default:
      throw new Error(`Operação desconhecida: ${op}`);
  }
}
