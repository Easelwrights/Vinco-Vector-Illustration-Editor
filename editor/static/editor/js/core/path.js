import {
  EPSILON,
  add,
  applyMatrix,
  clamp,
  cubicBounds,
  cubicDerivative,
  cubicLength,
  cubicPoint,
  distance,
  distanceToSegment,
  emptyBounds,
  flattenCubic,
  isEmptyBounds,
  lerp,
  nearestOnCubic,
  normalize,
  pointInRings,
  polygonArea,
  round,
  scale,
  seededRandom,
  splitCubic,
  sub,
  unionBounds,
} from './geometry.js';

export const KAPPA = 0.5522847498307936;

export function makeNode(x, y, ix = x, iy = y, ox = x, oy = y, smooth = false) {
  return { x, y, ix, iy, ox, oy, smooth };
}

export const hasIn = (n) => Math.abs(n.ix - n.x) > EPSILON || Math.abs(n.iy - n.y) > EPSILON;
export const hasOut = (n) => Math.abs(n.ox - n.x) > EPSILON || Math.abs(n.oy - n.y) > EPSILON;

export function cloneSubpaths(subpaths) {
  return subpaths.map((s) => ({ closed: s.closed, nodes: s.nodes.map((n) => ({ ...n })) }));
}

export function segmentCount(sub) {
  if (sub.nodes.length < 2) return 0;
  return sub.closed ? sub.nodes.length : sub.nodes.length - 1;
}

export function segmentAt(sub, index) {
  const a = sub.nodes[index];
  const b = sub.nodes[(index + 1) % sub.nodes.length];
  return [
    { x: a.x, y: a.y },
    { x: a.ox, y: a.oy },
    { x: b.ix, y: b.iy },
    { x: b.x, y: b.y },
  ];
}

export function* segments(sub) {
  for (let i = 0; i < segmentCount(sub); i += 1) yield [segmentAt(sub, i), i];
}

export const isStraight = (seg) =>
  Math.abs(seg[0].x - seg[1].x) < EPSILON && Math.abs(seg[0].y - seg[1].y) < EPSILON && Math.abs(seg[2].x - seg[3].x) < EPSILON && Math.abs(seg[2].y - seg[3].y) < EPSILON;

const fmt = (v, digits) => String(round(v, digits));

export function toPathData(subpaths, digits = 3) {
  const parts = [];
  for (const sub of subpaths) {
    if (!sub.nodes.length) continue;
    const first = sub.nodes[0];
    parts.push(`M${fmt(first.x, digits)} ${fmt(first.y, digits)}`);
    for (const [seg] of segments(sub)) {
      if (isStraight(seg)) parts.push(`L${fmt(seg[3].x, digits)} ${fmt(seg[3].y, digits)}`);
      else parts.push(`C${seg.slice(1).map((p) => `${fmt(p.x, digits)} ${fmt(p.y, digits)}`).join(' ')}`);
    }
    if (sub.closed) parts.push('Z');
  }
  return parts.join('');
}

function arcToCubics(x1, y1, rx, ry, angle, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const vectorAngle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const step = delta / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const result = [];
  let t = theta1;
  const map = (px, py) => [cos * rx * px - sin * ry * py + cx, sin * rx * px + cos * ry * py + cy];
  for (let i = 0; i < count; i += 1) {
    const c1 = Math.cos(t);
    const s1 = Math.sin(t);
    const c2 = Math.cos(t + step);
    const s2 = Math.sin(t + step);
    const [ax, ay] = map(c1 - k * s1, s1 + k * c1);
    const [bx, by] = map(c2 + k * s2, s2 - k * c2);
    const [ex, ey] = map(c2, s2);
    result.push([ax, ay, bx, by, ex, ey]);
    t += step;
  }
  const last = result[result.length - 1];
  last[4] = x2;
  last[5] = y2;
  return result;
}

export function parsePathData(d) {
  const tokens = String(d).match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const subpaths = [];
  let index = 0;
  let command = '';
  let current = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastControl = null;
  let lastQuad = null;
  const isCommand = (token) => /^[a-zA-Z]$/.test(token);
  const number = () => {
    const token = tokens[index];
    if (token === undefined || isCommand(token)) throw new Error('Dados de caminho inválidos.');
    index += 1;
    return Number(token);
  };
  const flag = () => {
    const token = tokens[index];
    if (token === undefined) throw new Error('Dados de caminho inválidos.');
    if (/^[01]{2,}/.test(token)) {
      tokens.splice(index, 1, token[0], token.slice(1));
    }
    return number() !== 0;
  };
  const ensure = () => {
    if (!current) {
      current = { closed: false, nodes: [makeNode(x, y)] };
      subpaths.push(current);
    }
  };
  const curveTo = (x1, y1, x2, y2, ex, ey) => {
    ensure();
    const last = current.nodes[current.nodes.length - 1];
    last.ox = x1;
    last.oy = y1;
    current.nodes.push(makeNode(ex, ey, x2, y2, ex, ey));
    x = ex;
    y = ey;
  };
  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index];
      index += 1;
    } else if (!command) {
      throw new Error('Dados de caminho inválidos.');
    }
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M': {
        x = ox + number();
        y = oy + number();
        startX = x;
        startY = y;
        current = { closed: false, nodes: [makeNode(x, y)] };
        subpaths.push(current);
        command = relative ? 'l' : 'L';
        lastControl = null;
        lastQuad = null;
        continue;
      }
      case 'L':
        ensure();
        x = ox + number();
        y = oy + number();
        current.nodes.push(makeNode(x, y));
        lastControl = null;
        lastQuad = null;
        break;
      case 'H':
        ensure();
        x = ox + number();
        current.nodes.push(makeNode(x, y));
        lastControl = null;
        lastQuad = null;
        break;
      case 'V':
        ensure();
        y = oy + number();
        current.nodes.push(makeNode(x, y));
        lastControl = null;
        lastQuad = null;
        break;
      case 'C': {
        const x1 = ox + number();
        const y1 = oy + number();
        const x2 = ox + number();
        const y2 = oy + number();
        const ex = ox + number();
        const ey = oy + number();
        curveTo(x1, y1, x2, y2, ex, ey);
        lastControl = { x: x2, y: y2 };
        lastQuad = null;
        break;
      }
      case 'S': {
        const x1 = lastControl ? 2 * x - lastControl.x : x;
        const y1 = lastControl ? 2 * y - lastControl.y : y;
        const x2 = ox + number();
        const y2 = oy + number();
        const ex = ox + number();
        const ey = oy + number();
        curveTo(x1, y1, x2, y2, ex, ey);
        lastControl = { x: x2, y: y2 };
        lastQuad = null;
        break;
      }
      case 'Q':
      case 'T': {
        let qx;
        let qy;
        if (command.toUpperCase() === 'Q') {
          qx = ox + number();
          qy = oy + number();
        } else {
          qx = lastQuad ? 2 * x - lastQuad.x : x;
          qy = lastQuad ? 2 * y - lastQuad.y : y;
        }
        const ex = ox + number();
        const ey = oy + number();
        curveTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey);
        lastQuad = { x: qx, y: qy };
        lastControl = null;
        break;
      }
      case 'A': {
        const rx = number();
        const ry = number();
        const angle = number();
        const large = flag();
        const sweep = flag();
        const ex = ox + number();
        const ey = oy + number();
        for (const c of arcToCubics(x, y, rx, ry, angle, large, sweep, ex, ey)) curveTo(...c);
        lastControl = null;
        lastQuad = null;
        break;
      }
      case 'Z':
        if (current) {
          current.closed = true;
          const first = current.nodes[0];
          const last = current.nodes[current.nodes.length - 1];
          if (current.nodes.length > 1 && distance(first, last) < 1e-6) {
            first.ix = last.ix;
            first.iy = last.iy;
            current.nodes.pop();
          }
        }
        x = startX;
        y = startY;
        current = null;
        lastControl = null;
        lastQuad = null;
        break;
      default:
        throw new Error(`Comando de caminho não suportado: ${command}`);
    }
  }
  return subpaths.filter((s) => s.nodes.length > 0);
}

export function rectangle(x, y, width, height, radius = 0) {
  const r = clamp(radius, 0, Math.min(Math.abs(width), Math.abs(height)) / 2);
  const x2 = x + width;
  const y2 = y + height;
  if (r <= EPSILON) {
    return [{ closed: true, nodes: [makeNode(x, y), makeNode(x2, y), makeNode(x2, y2), makeNode(x, y2)] }];
  }
  const k = r * (1 - KAPPA);
  const sx = Math.sign(width) || 1;
  const sy = Math.sign(height) || 1;
  const rx = r * sx;
  const ry = r * sy;
  const kx = k * sx;
  const ky = k * sy;
  return [
    {
      closed: true,
      nodes: [
        makeNode(x + rx, y, x + kx, y, x + rx, y),
        makeNode(x2 - rx, y, x2 - rx, y, x2 - kx, y),
        makeNode(x2, y + ry, x2, y + ky, x2, y + ry),
        makeNode(x2, y2 - ry, x2, y2 - ry, x2, y2 - ky),
        makeNode(x2 - rx, y2, x2 - kx, y2, x2 - rx, y2),
        makeNode(x + rx, y2, x + rx, y2, x + kx, y2),
        makeNode(x, y2 - ry, x, y2 - ky, x, y2 - ry),
        makeNode(x, y + ry, x, y + ry, x, y + ky),
      ],
    },
  ];
}

export function ellipse(cx, cy, rx, ry) {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    {
      closed: true,
      nodes: [
        makeNode(cx, cy - ry, cx - kx, cy - ry, cx + kx, cy - ry, true),
        makeNode(cx + rx, cy, cx + rx, cy - ky, cx + rx, cy + ky, true),
        makeNode(cx, cy + ry, cx + kx, cy + ry, cx - kx, cy + ry, true),
        makeNode(cx - rx, cy, cx - rx, cy + ky, cx - rx, cy - ky, true),
      ],
    },
  ];
}

export function regularPolygon(cx, cy, radius, sides, rotationRadians = 0) {
  const count = clamp(Math.round(sides), 3, 1000);
  const nodes = [];
  for (let i = 0; i < count; i += 1) {
    const a = rotationRadians - Math.PI / 2 + (i * 2 * Math.PI) / count;
    nodes.push(makeNode(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
  }
  return [{ closed: true, nodes }];
}

export function star(cx, cy, outer, inner, points, rotationRadians = 0) {
  const count = clamp(Math.round(points), 3, 1000);
  const nodes = [];
  for (let i = 0; i < count * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotationRadians - Math.PI / 2 + (i * Math.PI) / count;
    nodes.push(makeNode(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return [{ closed: true, nodes }];
}

export function line(x1, y1, x2, y2) {
  return [{ closed: false, nodes: [makeNode(x1, y1), makeNode(x2, y2)] }];
}

export function arc(x1, y1, x2, y2, concave = false) {
  const cx = concave ? x2 : x1;
  const cy = concave ? y1 : y2;
  const a = makeNode(x1, y1);
  const b = makeNode(x2, y2);
  a.ox = x1 + (cx - x1) * KAPPA;
  a.oy = y1 + (cy - y1) * KAPPA;
  b.ix = x2 + (cx - x2) * KAPPA;
  b.iy = y2 + (cy - y2) * KAPPA;
  return [{ closed: false, nodes: [a, b] }];
}

export function spiral(cx, cy, radius, decay = 0.8, turns = 10, startAngle = 0) {
  const count = clamp(Math.round(turns), 2, 200);
  const points = [];
  let r = radius;
  for (let i = 0; i <= count * 8; i += 1) {
    const a = startAngle + (i * Math.PI) / 4;
    points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    r *= decay ** (1 / 8);
  }
  return [fitCurve(points, 0.5, false)];
}

export function rectangularGrid(x, y, width, height, columns, rows) {
  const subs = [...rectangle(x, y, width, height)];
  for (let c = 1; c < columns; c += 1) subs.push(...line(x + (width * c) / columns, y, x + (width * c) / columns, y + height));
  for (let r = 1; r < rows; r += 1) subs.push(...line(x, y + (height * r) / rows, x + width, y + (height * r) / rows));
  return subs;
}

export function transformSubpaths(subpaths, m) {
  return subpaths.map((s) => ({
    closed: s.closed,
    nodes: s.nodes.map((n) => {
      const p = applyMatrix(m, n);
      const i = applyMatrix(m, { x: n.ix, y: n.iy });
      const o = applyMatrix(m, { x: n.ox, y: n.oy });
      return { x: p.x, y: p.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y, smooth: n.smooth };
    }),
  }));
}

export function subpathsBounds(subpaths) {
  let bounds = emptyBounds();
  for (const sub of subpaths) {
    if (sub.nodes.length === 1) {
      const n = sub.nodes[0];
      bounds = unionBounds(bounds, { minX: n.x, minY: n.y, maxX: n.x, maxY: n.y });
    }
    for (const [seg] of segments(sub)) bounds = unionBounds(bounds, cubicBounds(...seg));
  }
  return bounds;
}

export function flatten(subpaths, tolerance = 0.25) {
  return subpaths.map((sub) => {
    const points = sub.nodes.length ? [{ x: sub.nodes[0].x, y: sub.nodes[0].y }] : [];
    for (const [seg] of segments(sub)) {
      if (isStraight(seg)) points.push({ x: seg[3].x, y: seg[3].y });
      else flattenCubic(...seg, tolerance, points);
    }
    if (sub.closed && points.length > 1 && distance(points[0], points[points.length - 1]) < 1e-9) points.pop();
    return { closed: sub.closed, points };
  });
}

export function pathLength(subpaths) {
  let total = 0;
  for (const sub of subpaths) for (const [seg] of segments(sub)) total += cubicLength(...seg);
  return total;
}

export function hitPath(subpaths, p, { tolerance = 3, filled = true, fillRule = 'nonzero' } = {}) {
  const bounds = subpathsBounds(subpaths);
  if (isEmptyBounds(bounds)) return false;
  if (p.x < bounds.minX - tolerance || p.x > bounds.maxX + tolerance || p.y < bounds.minY - tolerance || p.y > bounds.maxY + tolerance) return false;
  const flat = flatten(subpaths, 0.5);
  for (const f of flat) {
    const count = f.closed ? f.points.length : f.points.length - 1;
    for (let i = 0; i < count; i += 1) {
      if (distanceToSegment(p, f.points[i], f.points[(i + 1) % f.points.length]) <= tolerance) return true;
    }
    if (f.points.length === 1 && distance(p, f.points[0]) <= tolerance) return true;
  }
  if (!filled) return false;
  return pointInRings(
    p,
    flat.filter((f) => f.points.length > 2).map((f) => f.points),
    fillRule,
  );
}

export function nearestSegment(subpaths, p) {
  let best = null;
  subpaths.forEach((sub, subIndex) => {
    for (const [seg, segIndex] of segments(sub)) {
      const hit = nearestOnCubic(...seg, p);
      if (!best || hit.distance < best.distance) best = { ...hit, subIndex, segIndex };
    }
  });
  return best;
}

export function splitSegment(sub, segIndex, t) {
  const seg = segmentAt(sub, segIndex);
  const nodes = sub.nodes.map((n) => ({ ...n }));
  const a = nodes[segIndex];
  const bIndex = (segIndex + 1) % nodes.length;
  const b = nodes[bIndex];
  if (isStraight(seg)) {
    const p = lerp(seg[0], seg[3], t);
    nodes.splice(segIndex + 1, 0, makeNode(p.x, p.y));
    return { closed: sub.closed, nodes };
  }
  const [left, right] = splitCubic(...seg, t);
  a.ox = left[1].x;
  a.oy = left[1].y;
  b.ix = right[2].x;
  b.iy = right[2].y;
  const mid = makeNode(left[3].x, left[3].y, left[2].x, left[2].y, right[1].x, right[1].y, true);
  nodes.splice(segIndex + 1, 0, mid);
  return { closed: sub.closed, nodes };
}

export function removeNode(sub, nodeIndex) {
  const nodes = sub.nodes.filter((_, i) => i !== nodeIndex);
  return { closed: sub.closed && nodes.length > 2, nodes };
}

export function convertNode(node, smooth, neighbours = {}) {
  const n = { ...node };
  if (!smooth) {
    n.ix = n.x;
    n.iy = n.y;
    n.ox = n.x;
    n.oy = n.y;
    n.smooth = false;
    return n;
  }
  const prev = neighbours.prev || { x: n.x - 10, y: n.y };
  const next = neighbours.next || { x: n.x + 10, y: n.y };
  const dir = normalize(sub(next, prev));
  const lenIn = distance(prev, n) / 3;
  const lenOut = distance(next, n) / 3;
  n.ix = n.x - dir.x * lenIn;
  n.iy = n.y - dir.y * lenIn;
  n.ox = n.x + dir.x * lenOut;
  n.oy = n.y + dir.y * lenOut;
  n.smooth = true;
  return n;
}

export function moveHandle(node, which, target, breakHandle = false) {
  const n = { ...node };
  if (which === 'in') {
    n.ix = target.x;
    n.iy = target.y;
  } else {
    n.ox = target.x;
    n.oy = target.y;
  }
  if (n.smooth && !breakHandle) {
    const moved = which === 'in' ? { x: n.ix, y: n.iy } : { x: n.ox, y: n.oy };
    const otherLen = which === 'in' ? Math.hypot(n.ox - n.x, n.oy - n.y) : Math.hypot(n.ix - n.x, n.iy - n.y);
    const dir = normalize(sub(n, moved));
    if (which === 'in') {
      n.ox = n.x + dir.x * otherLen;
      n.oy = n.y + dir.y * otherLen;
    } else {
      n.ix = n.x + dir.x * otherLen;
      n.iy = n.y + dir.y * otherLen;
    }
  } else if (breakHandle) {
    n.smooth = false;
  }
  return n;
}

export function translateNode(node, dx, dy) {
  return { ...node, x: node.x + dx, y: node.y + dy, ix: node.ix + dx, iy: node.iy + dy, ox: node.ox + dx, oy: node.oy + dy };
}

export function reverseSubpath(sub) {
  const nodes = sub.nodes.map((n) => ({ ...n, ix: n.ox, iy: n.oy, ox: n.ix, oy: n.iy })).reverse();
  if (sub.closed && nodes.length) nodes.unshift(nodes.pop());
  return { closed: sub.closed, nodes };
}

export function joinSubpaths(a, b, tolerance = 0.5) {
  if (a === b || a.closed || b.closed) return null;
  const ends = [
    [a, false, b, false],
    [a, false, b, true],
    [a, true, b, false],
    [a, true, b, true],
  ];
  let best = null;
  for (const [pa, reverseA, pb, reverseB] of ends) {
    const left = reverseA ? reverseSubpath(pa) : pa;
    const right = reverseB ? reverseSubpath(pb) : pb;
    const gap = distance(left.nodes[left.nodes.length - 1], right.nodes[0]);
    if (!best || gap < best.gap) best = { left, right, gap };
  }
  const nodes = best.left.nodes.map((n) => ({ ...n }));
  const rest = best.right.nodes.map((n) => ({ ...n }));
  if (best.gap <= tolerance) {
    const last = nodes[nodes.length - 1];
    last.ox = rest[0].ox;
    last.oy = rest[0].oy;
    rest.shift();
  }
  return { closed: false, nodes: nodes.concat(rest) };
}

export function closeSubpath(sub, tolerance = 0.5) {
  const nodes = sub.nodes.map((n) => ({ ...n }));
  if (nodes.length > 2 && distance(nodes[0], nodes[nodes.length - 1]) <= tolerance) {
    const last = nodes.pop();
    nodes[0].ix = last.ix;
    nodes[0].iy = last.iy;
  }
  return { closed: nodes.length > 1, nodes };
}

export function averageNodes(nodes, axis = 'both') {
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  return nodes.map((n) => translateNode(n, axis === 'vertical' ? 0 : cx - n.x, axis === 'horizontal' ? 0 : cy - n.y));
}

function chordLengths(points) {
  const u = [0];
  for (let i = 1; i < points.length; i += 1) u.push(u[i - 1] + distance(points[i], points[i - 1]));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function bezierAt(ctrl, t) {
  return cubicPoint(ctrl[0], ctrl[1], ctrl[2], ctrl[3], t);
}

function generateBezier(points, first, last, u, tan1, tan2) {
  const p0 = points[first];
  const p3 = points[last];
  const c = [
    [0, 0],
    [0, 0],
  ];
  const x = [0, 0];
  for (let i = 0; i <= last - first; i += 1) {
    const t = u[i];
    const mt = 1 - t;
    const b1 = 3 * mt * mt * t;
    const b2 = 3 * mt * t * t;
    const a1 = scale(tan1, b1);
    const a2 = scale(tan2, b2);
    c[0][0] += a1.x * a1.x + a1.y * a1.y;
    c[0][1] += a1.x * a2.x + a1.y * a2.y;
    c[1][0] = c[0][1];
    c[1][1] += a2.x * a2.x + a2.y * a2.y;
    const b0 = mt * mt * mt;
    const b3 = t * t * t;
    const tmp = sub(points[first + i], {
      x: p0.x * (b0 + b1) + p3.x * (b2 + b3),
      y: p0.y * (b0 + b1) + p3.y * (b2 + b3),
    });
    x[0] += a1.x * tmp.x + a1.y * tmp.y;
    x[1] += a2.x * tmp.x + a2.y * tmp.y;
  }
  const det = c[0][0] * c[1][1] - c[1][0] * c[0][1];
  let alpha1;
  let alpha2;
  if (Math.abs(det) > 1e-12) {
    alpha1 = (x[0] * c[1][1] - x[1] * c[0][1]) / det;
    alpha2 = (c[0][0] * x[1] - c[1][0] * x[0]) / det;
  } else {
    const c0 = c[0][0] + c[0][1];
    const c1 = c[1][0] + c[1][1];
    alpha1 = alpha2 = Math.abs(c0) > 1e-12 ? x[0] / c0 : Math.abs(c1) > 1e-12 ? x[1] / c1 : 0;
  }
  const segLength = distance(p3, p0);
  const eps = 1e-6 * segLength;
  if (alpha1 < eps || alpha2 < eps) {
    alpha1 = alpha2 = segLength / 3;
  }
  return [p0, add(p0, scale(tan1, alpha1)), add(p3, scale(tan2, alpha2)), p3];
}

function reparameterize(ctrl, points, first, last, u) {
  return u.map((t, i) => {
    const p = points[first + i];
    const q = bezierAt(ctrl, t);
    const d1 = cubicDerivative(ctrl[0], ctrl[1], ctrl[2], ctrl[3], t);
    const q2 = {
      x: 6 * (1 - t) * (ctrl[2].x - 2 * ctrl[1].x + ctrl[0].x) + 6 * t * (ctrl[3].x - 2 * ctrl[2].x + ctrl[1].x),
      y: 6 * (1 - t) * (ctrl[2].y - 2 * ctrl[1].y + ctrl[0].y) + 6 * t * (ctrl[3].y - 2 * ctrl[2].y + ctrl[1].y),
    };
    const diff = sub(q, p);
    const numerator = diff.x * d1.x + diff.y * d1.y;
    const denominator = d1.x * d1.x + d1.y * d1.y + diff.x * q2.x + diff.y * q2.y;
    if (Math.abs(denominator) < 1e-12) return t;
    return clamp(t - numerator / denominator, 0, 1);
  });
}

function maxError(ctrl, points, first, last, u) {
  let max = 0;
  let index = Math.floor((last - first + 1) / 2) + first;
  for (let i = first + 1; i < last; i += 1) {
    const d = distance(bezierAt(ctrl, u[i - first]), points[i]);
    if (d >= max) {
      max = d;
      index = i;
    }
  }
  return { max, index };
}

function fitCubic(points, first, last, tan1, tan2, error, out) {
  if (last - first === 1) {
    const dist = distance(points[first], points[last]) / 3;
    out.push([points[first], add(points[first], scale(tan1, dist)), add(points[last], scale(tan2, dist)), points[last]]);
    return;
  }
  let u = chordLengths(points.slice(first, last + 1));
  let ctrl = generateBezier(points, first, last, u, tan1, tan2);
  let { max, index } = maxError(ctrl, points, first, last, u);
  if (max < error) {
    out.push(ctrl);
    return;
  }
  if (max < error * 4) {
    for (let i = 0; i < 6; i += 1) {
      u = reparameterize(ctrl, points, first, last, u);
      ctrl = generateBezier(points, first, last, u, tan1, tan2);
      ({ max, index } = maxError(ctrl, points, first, last, u));
      if (max < error) {
        out.push(ctrl);
        return;
      }
    }
  }
  const center = normalize(sub(points[index - 1], points[index + 1]));
  fitCubic(points, first, index, tan1, center, error, out);
  fitCubic(points, index, last, scale(center, -1), tan2, error, out);
}

function dedupe(points) {
  const result = [];
  for (const p of points) {
    if (!result.length || distance(result[result.length - 1], p) > 1e-6) result.push({ x: p.x, y: p.y });
  }
  return result;
}

export function fitCurve(rawPoints, error = 1, closed = false) {
  const points = dedupe(rawPoints);
  if (closed && points.length > 2 && distance(points[0], points[points.length - 1]) < 1e-6) points.pop();
  if (points.length < 2) return { closed: false, nodes: points.map((p) => makeNode(p.x, p.y)) };
  const work = closed ? [...points, points[0]] : points;
  if (work.length === 2) return { closed, nodes: work.slice(0, closed ? 1 : 2).map((p) => makeNode(p.x, p.y)) };
  const tan1 = closed ? normalize(sub(work[1], work[work.length - 2])) : normalize(sub(work[1], work[0]));
  const tan2 = closed ? scale(tan1, -1) : normalize(sub(work[work.length - 2], work[work.length - 1]));
  const curves = [];
  fitCubic(work, 0, work.length - 1, tan1, tan2, error, curves);
  const nodes = [makeNode(curves[0][0].x, curves[0][0].y)];
  for (const c of curves) {
    const last = nodes[nodes.length - 1];
    last.ox = c[1].x;
    last.oy = c[1].y;
    nodes.push(makeNode(c[3].x, c[3].y, c[2].x, c[2].y, c[3].x, c[3].y));
  }
  if (closed) {
    const last = nodes.pop();
    nodes[0].ix = last.ix;
    nodes[0].iy = last.iy;
  }
  for (const n of nodes) {
    if (hasIn(n) && hasOut(n)) {
      const a = normalize({ x: n.x - n.ix, y: n.y - n.iy });
      const b = normalize({ x: n.ox - n.x, y: n.oy - n.y });
      n.smooth = a.x * b.x + a.y * b.y > 0.98;
    }
  }
  return { closed, nodes };
}

export function cornerIndices(points, closed, angleDegrees = 40) {
  const corners = new Set();
  const limit = Math.cos((angleDegrees * Math.PI) / 180);
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    if (!closed && (i === 0 || i === count - 1)) {
      corners.add(i);
      continue;
    }
    const prev = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const a = normalize(sub(points[i], prev));
    const b = normalize(sub(next, points[i]));
    if (a.x * b.x + a.y * b.y < limit) corners.add(i);
  }
  return [...corners].sort((x, y) => x - y);
}

export function polylineToSubpath(points, closed, { smooth = false, error = 0.35, angle = 40 } = {}) {
  const clean = dedupe(points);
  if (closed && clean.length > 2 && distance(clean[0], clean[clean.length - 1]) < 1e-6) clean.pop();
  if (!smooth || clean.length < 4) return { closed, nodes: clean.map((p) => makeNode(p.x, p.y)) };
  const corners = cornerIndices(clean, closed, angle);
  if (!corners.length) return fitCurve(clean, error, closed);
  const nodes = [];
  const runs = [];
  for (let k = 0; k < corners.length; k += 1) {
    const start = corners[k];
    const end = k + 1 < corners.length ? corners[k + 1] : closed ? corners[0] + clean.length : null;
    if (end === null) break;
    const run = [];
    for (let i = start; i <= end; i += 1) run.push(clean[i % clean.length]);
    runs.push(run);
  }
  for (const run of runs) {
    const piece = run.length <= 3 ? { nodes: run.map((p) => makeNode(p.x, p.y)) } : fitCurve(run, error, false);
    const pieceNodes = piece.nodes.map((n) => ({ ...n }));
    if (nodes.length) {
      const last = nodes[nodes.length - 1];
      last.ox = pieceNodes[0].ox;
      last.oy = pieceNodes[0].oy;
      last.smooth = false;
      pieceNodes.shift();
    }
    nodes.push(...pieceNodes);
  }
  if (closed && nodes.length > 1) {
    const last = nodes.pop();
    nodes[0].ix = last.ix;
    nodes[0].iy = last.iy;
    nodes[0].smooth = false;
  }
  return { closed, nodes };
}

export function simplifySubpaths(subpaths, error = 1) {
  return flatten(subpaths, 0.2).map((f) => polylineToSubpath(f.points, f.closed, { smooth: true, error }));
}

export function resample(sub, count) {
  const flat = flatten([sub], 0.2)[0];
  const pts = flat.closed ? [...flat.points, flat.points[0]] : flat.points;
  const lengths = [0];
  for (let i = 1; i < pts.length; i += 1) lengths.push(lengths[i - 1] + distance(pts[i], pts[i - 1]));
  const total = lengths[lengths.length - 1];
  const result = [];
  const n = Math.max(2, count);
  for (let k = 0; k < n; k += 1) {
    const target = (total * k) / (flat.closed ? n : n - 1);
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < target) i += 1;
    const span = lengths[i] - lengths[i - 1] || 1;
    result.push(lerp(pts[i - 1], pts[i], clamp((target - lengths[i - 1]) / span, 0, 1)));
  }
  return result;
}

export function ringOrientation(points) {
  return Math.sign(polygonArea(points));
}

export function roundCorners(subpaths, radius) {
  if (radius <= 0) return subpaths;
  return subpaths.map((s) => {
    const count = s.nodes.length;
    if (count < 2) return s;
    const nodes = [];
    s.nodes.forEach((n, i) => {
      const isEnd = !s.closed && (i === 0 || i === count - 1);
      if (isEnd || hasIn(n) || hasOut(n)) {
        nodes.push({ ...n });
        return;
      }
      const prev = s.nodes[(i - 1 + count) % count];
      const next = s.nodes[(i + 1) % count];
      const dIn = normalize(sub(prev, n));
      const dOut = normalize(sub(next, n));
      const r = Math.min(radius, distance(prev, n) / 2, distance(next, n) / 2);
      const a = add(n, scale(dIn, r));
      const b = add(n, scale(dOut, r));
      const k = r * KAPPA;
      nodes.push(makeNode(a.x, a.y, a.x, a.y, a.x - dIn.x * k, a.y - dIn.y * k));
      nodes.push(makeNode(b.x, b.y, b.x - dOut.x * k, b.y - dOut.y * k, b.x, b.y));
    });
    return { closed: s.closed, nodes };
  });
}

function perpendicular(points, i, closed) {
  const count = points.length;
  const prev = points[closed ? (i - 1 + count) % count : Math.max(0, i - 1)];
  const next = points[closed ? (i + 1) % count : Math.min(count - 1, i + 1)];
  const d = normalize(sub(next, prev));
  return { x: -d.y, y: d.x };
}

export function zigZag(subpaths, size, ridges = 4, smooth = false) {
  return subpaths.map((s) => {
    const total = Math.max(1, segmentCount(s)) * Math.max(1, Math.round(ridges)) * 2;
    const points = resample(s, total + (s.closed ? 0 : 1));
    const moved = points.map((p, i) => {
      const nrm = perpendicular(points, i, s.closed);
      const sign = i % 2 === 0 ? 1 : -1;
      return add(p, scale(nrm, size * sign));
    });
    return smooth ? fitCurve(moved, 0.5, s.closed) : { closed: s.closed, nodes: moved.map((p) => makeNode(p.x, p.y)) };
  });
}

export function roughen(subpaths, size, detail = 10, seed = 1) {
  const random = seededRandom(seed);
  return subpaths.map((s) => {
    const points = resample(s, Math.max(4, Math.round(pathLength([s]) / Math.max(1, 100 / detail))));
    const moved = points.map((p) => ({ x: p.x + (random() * 2 - 1) * size, y: p.y + (random() * 2 - 1) * size }));
    return { closed: s.closed, nodes: moved.map((p) => makeNode(p.x, p.y)) };
  });
}

export function puckerBloat(subpaths, amount) {
  const bounds = subpathsBounds(subpaths);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const k = amount / 100;
  return subpaths.map((s) => ({
    closed: s.closed,
    nodes: s.nodes.map((n, i, all) => {
      const prev = all[(i - 1 + all.length) % all.length];
      const next = all[(i + 1) % all.length];
      const p = { ...n };
      const pullIn = lerp(n, prev, 1 / 3);
      const pullOut = lerp(n, next, 1 / 3);
      const ci = lerp(pullIn, center, -k);
      const co = lerp(pullOut, center, -k);
      const anchor = lerp(n, center, k * 0.5);
      p.x = anchor.x;
      p.y = anchor.y;
      p.ix = ci.x;
      p.iy = ci.y;
      p.ox = co.x;
      p.oy = co.y;
      p.smooth = false;
      return p;
    }),
  }));
}

export function isClosedShape(subpaths) {
  return subpaths.some((s) => s.closed && s.nodes.length > 2);
}
