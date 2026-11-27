import { IDENTITY, distance, lerp, multiply, translation } from './geometry.js';
import { mixHex } from './color.js';
import {
  cloneSubpaths,
  closeSubpath,
  fitCurve,
  flatten,
  joinSubpaths,
  makeNode,
  polylineToSubpath,
  resample,
  simplifySubpaths,
  splitSegment,
  transformSubpaths,
} from './path.js';
import { bufferPolyline, difference, geomToSubpaths, offsetGeom, pathfinder, strokeGeom, subpathsToGeom, union } from './boolean.js';
import {
  cloneItem,
  cloneStyle,
  createGroup,
  createInstance,
  createPath,
  defaultStyle,
  findItem,
  insertItem,
  itemBounds,
  orderIds,
  removeItem,
  solid,
  transformItem,
  uid,
  walk,
} from './document.js';
import { appearanceSubpaths } from './svg.js';

function flattenToPaths(item, matrix = IDENTITY, doc = null) {
  if (item.type === 'path') return [{ subpaths: matrix === IDENTITY ? item.subpaths : transformSubpaths(item.subpaths, matrix), fillRule: item.fillRule, style: item.style, source: item }];
  if (item.type === 'group') return item.children.flatMap((c) => flattenToPaths(c, matrix, doc));
  if (item.type === 'instance' && doc) {
    const symbol = doc.symbols.find((s) => s.id === item.symbol);
    const m = multiply(matrix, item.matrix);
    return symbol ? symbol.children.flatMap((c) => flattenToPaths(c, m, doc)) : [];
  }
  return [];
}

function styleKey(style) {
  return JSON.stringify(style?.fill || null);
}

function placeResults(doc, ids, results) {
  const ordered = orderIds(doc, ids);
  const anchor = findItem(doc, ordered[ordered.length - 1]);
  const container = anchor.parent;
  const before = ordered.filter((id) => {
    const e = findItem(doc, id);
    return e.parent === container && e.index < anchor.index;
  }).length;
  for (const id of ordered) removeItem(doc, id);
  const index = anchor.index - before;
  if (!results.length) return [];
  const node = results.length === 1 ? results[0] : createGroup(results);
  insertItem(container, node, index);
  return [node.id];
}

export function applyPathfinder(doc, ids, op) {
  const ordered = orderIds(doc, ids);
  const sources = ordered.map((id) => findItem(doc, id).item);
  const entries = sources.flatMap((item) => flattenToPaths(item, IDENTITY, doc)).filter((e) => e.subpaths.length);
  if (!entries.length) return [];
  for (const entry of entries) entry.key = styleKey(entry.style);
  const pieces = pathfinder(op, entries);
  const results = [];
  for (const piece of pieces) {
    const subs = geomToSubpaths(piece.geom);
    if (!subs.length) continue;
    const sourceStyle = cloneStyle(entries[piece.source]?.style || defaultStyle());
    if (piece.outline) {
      sourceStyle.stroke = sourceStyle.fill || solid('#000000');
      sourceStyle.fill = null;
      sourceStyle.strokeWidth = 1;
    }
    if (['trim', 'merge', 'divide'].includes(op) && !piece.outline) {
      sourceStyle.stroke = null;
      sourceStyle.strokeWidth = 0;
    }
    results.push(createPath(subs, sourceStyle, { fillRule: 'evenodd' }));
  }
  return placeResults(doc, ids, results);
}

export function makeCompound(doc, ids) {
  const ordered = orderIds(doc, ids);
  const items = ordered.map((id) => findItem(doc, id).item).filter((i) => i.type === 'path');
  if (items.length < 1) return [];
  const subpaths = items.flatMap((i) => cloneSubpaths(i.subpaths));
  const style = cloneStyle(items[0].style);
  const compound = createPath(subpaths, style, { fillRule: 'evenodd' });
  return placeResults(
    doc,
    items.map((i) => i.id),
    [compound],
  );
}

export function releaseCompound(doc, id) {
  const entry = findItem(doc, id);
  if (!entry || entry.item.type !== 'path' || entry.item.subpaths.length < 2) return [];
  const parts = entry.item.subpaths.map((s) => createPath([s], cloneStyle(entry.item.style)));
  entry.siblings.splice(entry.index, 1, ...parts);
  return parts.map((p) => p.id);
}

export function makeClip(doc, ids) {
  const ordered = orderIds(doc, ids);
  if (ordered.length < 2) return [];
  const items = ordered.map((id) => cloneItem(findItem(doc, id).item, true));
  const mask = items[items.length - 1];
  if (mask.type !== 'path') return [];
  mask.style = defaultStyle({ fill: null, stroke: null, strokeWidth: 0 });
  const group = createGroup(items, { clip: true });
  return placeResults(doc, ordered, [group]);
}

export function releaseClip(doc, id) {
  const entry = findItem(doc, id);
  if (!entry || entry.item.type !== 'group' || !entry.item.clip) return [];
  entry.item.clip = false;
  const children = entry.item.children;
  entry.siblings.splice(entry.index, 1, ...children);
  return children.map((c) => c.id);
}

export function outlineStroke(doc, ids) {
  const created = [];
  for (const id of orderIds(doc, ids)) {
    const entry = findItem(doc, id);
    const item = entry?.item;
    if (!item || item.type !== 'path' || !item.style.stroke || !(item.style.strokeWidth > 0)) continue;
    const geom = strokeGeom(appearanceSubpaths(item), item.style.strokeWidth, { cap: item.style.cap === 'projecting' ? 'square' : item.style.cap, join: item.style.join, miterLimit: item.style.miterLimit });
    const strokePath = createPath(geomToSubpaths(geom), defaultStyle({ fill: item.style.stroke, stroke: null, strokeWidth: 0 }), { fillRule: 'evenodd' });
    const replacement = [];
    if (item.style.fill) {
      const fillPath = cloneItem(item);
      fillPath.style.stroke = null;
      fillPath.style.strokeWidth = 0;
      replacement.push(fillPath);
    }
    replacement.push(strokePath);
    const node = replacement.length > 1 ? createGroup(replacement) : strokePath;
    entry.siblings.splice(entry.index, 1, node);
    created.push(node.id);
  }
  return created;
}

export function offsetPath(doc, ids, delta, join = 'miter', miterLimit = 4) {
  const created = [];
  for (const id of orderIds(doc, ids)) {
    const entry = findItem(doc, id);
    const item = entry?.item;
    if (!item || item.type !== 'path') continue;
    const subs = geomToSubpaths(offsetGeom(item.subpaths, delta, { join, miterLimit, fillRule: item.fillRule }));
    if (!subs.length) continue;
    const copy = createPath(subs, cloneStyle(item.style), { fillRule: 'evenodd' });
    entry.siblings.splice(delta > 0 ? entry.index : entry.index + 1, 0, copy);
    created.push(copy.id);
  }
  return created;
}

export function expandAppearance(doc, ids) {
  for (const id of ids) {
    const item = findItem(doc, id)?.item;
    if (!item || item.type !== 'path') continue;
    item.subpaths = appearanceSubpaths(item);
    item.effects = item.effects.filter((e) => !['roundCorners', 'zigZag', 'roughen', 'puckerBloat'].includes(e.type));
  }
  return ids;
}

export function expandInstance(doc, id) {
  const entry = findItem(doc, id);
  if (!entry || entry.item.type !== 'instance') return null;
  const symbol = doc.symbols.find((s) => s.id === entry.item.symbol);
  if (!symbol) return null;
  const children = symbol.children.map((c) => transformItem(cloneItem(c), entry.item.matrix));
  const group = createGroup(children);
  entry.siblings.splice(entry.index, 1, group);
  return group.id;
}

export function defineSymbol(doc, ids, name = 'Símbolo') {
  const ordered = orderIds(doc, ids);
  if (!ordered.length) return null;
  const items = ordered.map((id) => cloneItem(findItem(doc, id).item));
  const symbol = { id: uid('y'), name, children: items };
  doc.symbols.push(symbol);
  const instance = createInstance(symbol.id);
  placeResults(doc, ordered, [instance]);
  return { symbol, instance };
}

export function interpolateItems(a, b, t) {
  const subA = a.subpaths[0];
  const subB = b.subpaths[0];
  const count = Math.max(subA.nodes.length, subB.nodes.length, 32) * 2;
  const pa = resample(subA, count);
  const pb = resample(subB, count);
  const pts = pa.map((p, i) => lerp(p, pb[i], t));
  const closed = subA.closed && subB.closed;
  const style = cloneStyle(a.style);
  if (a.style.fill?.type === 'color' && b.style.fill?.type === 'color') style.fill = solid(mixHex(a.style.fill.color, b.style.fill.color, t));
  if (a.style.stroke?.type === 'color' && b.style.stroke?.type === 'color') style.stroke = solid(mixHex(a.style.stroke.color, b.style.stroke.color, t));
  style.strokeWidth = a.style.strokeWidth + (b.style.strokeWidth - a.style.strokeWidth) * t;
  return createPath([fitCurve(pts, 0.4, closed)], style, { opacity: (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t });
}

export function makeBlend(doc, ids, steps = 5) {
  const ordered = orderIds(doc, ids);
  const items = ordered.map((id) => findItem(doc, id).item).filter((i) => i.type === 'path' && i.subpaths.length);
  if (items.length < 2) return [];
  const children = [];
  for (let k = 0; k < items.length - 1; k += 1) {
    const a = items[k];
    const b = items[k + 1];
    if (k === 0) children.push(cloneItem(a, true));
    for (let s = 1; s <= steps; s += 1) {
      const step = interpolateItems(a, b, s / (steps + 1));
      step.name = 'Etapa da mesclagem';
      step.blendStep = true;
      children.push(step);
    }
    children.push(cloneItem(b, true));
  }
  const group = createGroup(children, { name: 'Mesclagem' });
  return placeResults(doc, ordered, [group]);
}

export function releaseBlend(doc, id) {
  const entry = findItem(doc, id);
  if (!entry || entry.item.type !== 'group') return [];
  const keep = entry.item.children.filter((c) => !c.blendStep);
  entry.siblings.splice(entry.index, 1, ...keep);
  return keep.map((c) => c.id);
}

export function joinPaths(doc, ids) {
  const items = orderIds(doc, ids)
    .map((id) => findItem(doc, id).item)
    .filter((i) => i.type === 'path');
  if (items.length === 1) {
    const item = items[0];
    item.subpaths = item.subpaths.map((s) => (s.closed ? s : closeSubpath(s, Infinity)));
    return [item.id];
  }
  if (items.length < 2) return [];
  const open = items.filter((i) => i.subpaths.length === 1 && !i.subpaths[0].closed);
  if (open.length < 2) return [];
  let joined = open[0].subpaths[0];
  for (const next of open.slice(1)) joined = joinSubpaths(joined, next.subpaths[0], 0.5) || joined;
  const result = createPath([joined], cloneStyle(open[open.length - 1].style));
  return placeResults(
    doc,
    open.map((i) => i.id),
    [result],
  );
}

export function simplifyPaths(doc, ids, error = 1) {
  for (const id of ids) {
    const item = findItem(doc, id)?.item;
    if (item?.type === 'path') item.subpaths = simplifySubpaths(item.subpaths, error);
  }
  return ids;
}

export function splitPath(doc, id, subIndex, segIndex, t) {
  const entry = findItem(doc, id);
  if (!entry || entry.item.type !== 'path') return [];
  const item = entry.item;
  const sub = splitSegment(item.subpaths[subIndex], segIndex, t);
  const cut = segIndex + 1;
  const rest = item.subpaths.filter((_, i) => i !== subIndex);
  let pieces;
  if (sub.closed) {
    const nodes = [...sub.nodes.slice(cut), ...sub.nodes.slice(0, cut + 1)].map((nd) => ({ ...nd }));
    pieces = [{ closed: false, nodes }];
  } else {
    pieces = [
      { closed: false, nodes: sub.nodes.slice(0, cut + 1).map((nd) => ({ ...nd })) },
      { closed: false, nodes: sub.nodes.slice(cut).map((nd) => ({ ...nd })) },
    ];
  }
  const results = pieces.filter((p) => p.nodes.length > 1).map((p) => createPath([p, ...(rest.length && p === pieces[0] ? rest : [])], cloneStyle(item.style)));
  entry.siblings.splice(entry.index, 1, ...results);
  return results.map((r) => r.id);
}

export function eraseWithStroke(doc, ids, points, radius) {
  const eraser = bufferPolyline(points, false, radius, { cap: 'round', join: 'round' });
  if (!eraser.length) return [];
  const changed = [];
  for (const id of ids) {
    const entry = findItem(doc, id);
    const item = entry?.item;
    if (!item || item.type !== 'path' || item.locked) continue;
    if (!item.style.fill) continue;
    const geom = subpathsToGeom(item.subpaths, item.fillRule);
    const rest = difference(geom, eraser);
    const subs = geomToSubpaths(rest);
    if (!subs.length) {
      entry.siblings.splice(entry.index, 1);
      continue;
    }
    item.subpaths = subs;
    item.fillRule = 'evenodd';
    changed.push(id);
  }
  return changed;
}

export function blobBrush(doc, container, points, radius, color, mergeIds = []) {
  let geom = bufferPolyline(points, false, radius, { cap: 'round', join: 'round' });
  if (!geom.length) return null;
  const merged = [];
  for (const id of mergeIds) {
    const entry = findItem(doc, id);
    const item = entry?.item;
    if (!item || item.type !== 'path' || item.style.fill?.type !== 'color' || item.style.fill.color !== color || item.style.stroke) continue;
    const other = subpathsToGeom(item.subpaths, item.fillRule);
    const together = union(geom, other);
    if (together.length <= other.length + geom.length - 1 || together.length === 1) {
      geom = together;
      merged.push(id);
    }
  }
  for (const id of merged) removeItem(doc, id);
  const path = createPath(geomToSubpaths(geom, { error: 0.6 }), defaultStyle({ fill: solid(color), stroke: null, strokeWidth: 0 }), { fillRule: 'evenodd' });
  insertItem(container, path);
  return path;
}

export function strokeFromPoints(points, { smooth = 2, closed = false } = {}) {
  if (points.length < 2) return null;
  const sub = fitCurve(points, Math.max(0.5, smooth), false);
  if (closed && distance(points[0], points[points.length - 1]) < 12) return closeSubpath(sub, Infinity);
  return sub;
}

export function traceBitmap({ width, height, data }, { threshold = 128, mode = 'dark', smooth = 1, minArea = 4 } = {}) {
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const i = (y * width + x) * 4;
    if (data[i + 3] < 32) return false;
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return mode === 'dark' ? lum < threshold : lum >= threshold;
  };
  const edges = new Map();
  const key = (x, y) => y * (width + 1) + x;
  const addEdge = (x1, y1, x2, y2) => {
    const k = key(x1, y1);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([x2, y2]);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!inside(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }
  const rings = [];
  while (edges.size) {
    const [startKey, list] = edges.entries().next().value;
    let [nx, ny] = list.pop();
    if (!list.length) edges.delete(startKey);
    const sx = startKey % (width + 1);
    const sy = Math.floor(startKey / (width + 1));
    const ring = [{ x: sx, y: sy }];
    let guard = 0;
    while ((nx !== sx || ny !== sy) && guard < 4 * width * height + 8) {
      ring.push({ x: nx, y: ny });
      const k = key(nx, ny);
      const next = edges.get(k);
      if (!next) break;
      [nx, ny] = next.pop();
      if (!next.length) edges.delete(k);
      guard += 1;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  const subpaths = [];
  for (const ring of rings) {
    const area = Math.abs(ring.reduce((s, p, i) => s + (ring[(i + 1) % ring.length].x - p.x) * (ring[(i + 1) % ring.length].y + p.y), 0) / 2);
    if (area < minArea) continue;
    const reduced = ring.filter((p, i) => {
      const prev = ring[(i - 1 + ring.length) % ring.length];
      const next = ring[(i + 1) % ring.length];
      return (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x) !== 0;
    });
    const midpoints = reduced.map((p, i) => lerp(p, reduced[(i + 1) % reduced.length], 0.5));
    subpaths.push(smooth > 0 ? polylineToSubpath(midpoints, true, { smooth: true, error: smooth, angle: 60 }) : { closed: true, nodes: reduced.map((p) => makeNode(p.x, p.y)) });
  }
  return subpaths;
}

export function tracedItem(subpaths, matrix, color = '#000000') {
  const item = createPath(transformSubpaths(subpaths, matrix), defaultStyle({ fill: solid(color), stroke: null, strokeWidth: 0 }), { fillRule: 'evenodd', name: 'Traçado de imagem' });
  return item;
}

export function duplicateInPlace(doc, ids, dx = 0, dy = 0) {
  const created = [];
  for (const id of orderIds(doc, ids)) {
    const entry = findItem(doc, id);
    if (!entry || entry.item.type === 'layer') continue;
    const copy = cloneItem(entry.item);
    if (dx || dy) transformItem(copy, translation(dx, dy), { scaleStrokes: false });
    entry.siblings.splice(entry.index + 1 + created.filter((c) => c.parent === entry.parent).length, 0, copy);
    created.push({ id: copy.id, parent: entry.parent });
  }
  return created.map((c) => c.id);
}

export function selectSimilar(doc, reference, key) {
  const result = [];
  const value = (item) => {
    if (key === 'fill') return JSON.stringify(item.style?.fill ?? null);
    if (key === 'stroke') return JSON.stringify(item.style?.stroke ?? null);
    if (key === 'strokeWidth') return item.style?.strokeWidth;
    if (key === 'opacity') return item.opacity;
    if (key === 'blend') return item.blend;
    if (key === 'type') return item.type;
    return null;
  };
  const target = value(reference);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.locked) continue;
    for (const entry of walk(layer.children)) {
      const item = entry.item;
      if (item.type === 'group' || item.locked || item.visible === false) continue;
      if (value(item) === target) result.push(item.id);
    }
  }
  return result;
}

export function bounds(doc, ids) {
  return ids.map((id) => itemBounds(findItem(doc, id)?.item, doc));
}

export function flattenForExport(subpaths) {
  return flatten(subpaths, 0.25);
}
