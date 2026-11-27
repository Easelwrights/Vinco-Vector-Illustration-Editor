export const EPSILON = 1e-9;
export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export const point = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const length = (a) => Math.hypot(a.x, a.y);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
};

export function normalize(a) {
  const size = length(a);
  return size < EPSILON ? { x: 0, y: 0 } : { x: a.x / size, y: a.y / size };
}

export function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function applyMatrix(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < EPSILON) return [...IDENTITY];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export const determinant = (m) => m[0] * m[3] - m[1] * m[2];
export const translation = (tx, ty) => [1, 0, 0, 1, tx, ty];

function around(m, cx = 0, cy = 0) {
  return multiply(translation(cx, cy), multiply(m, translation(-cx, -cy)));
}

export const scaling = (sx, sy, cx, cy) => around([sx, 0, 0, sy, 0, 0], cx, cy);
export const rotation = (radians, cx, cy) => around([Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0], cx, cy);
export const shearing = (shx, shy, cx, cy) => around([1, shy, shx, 1, 0, 0], cx, cy);

export function reflection(axisRadians, cx, cy) {
  const c = Math.cos(2 * axisRadians);
  const s = Math.sin(2 * axisRadians);
  return around([c, s, s, -c, 0, 0], cx, cy);
}

export function decompose(m) {
  const scaleX = Math.hypot(m[0], m[1]);
  const det = determinant(m);
  const scaleY = scaleX < EPSILON ? 0 : det / scaleX;
  const rotationAngle = Math.atan2(m[1], m[0]);
  const shear = scaleX < EPSILON ? 0 : (m[0] * m[2] + m[1] * m[3]) / (scaleX * scaleX);
  return { scaleX, scaleY, rotation: rotationAngle, shear, translateX: m[4], translateY: m[5] };
}

export const isIdentity = (m) => m.every((value, index) => Math.abs(value - IDENTITY[index]) < EPSILON);

export function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export function cubicDerivative(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

export function splitCubic(p0, p1, p2, p3, t) {
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ];
}

function quadraticRoots(a, b, c) {
  if (Math.abs(a) < EPSILON) return Math.abs(b) < EPSILON ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
}

export function emptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export const isEmptyBounds = (b) => !b || !Number.isFinite(b.minX) || b.minX > b.maxX;

export function extendBounds(bounds, p) {
  if (p.x < bounds.minX) bounds.minX = p.x;
  if (p.y < bounds.minY) bounds.minY = p.y;
  if (p.x > bounds.maxX) bounds.maxX = p.x;
  if (p.y > bounds.maxY) bounds.maxY = p.y;
  return bounds;
}

export function unionBounds(a, b) {
  if (isEmptyBounds(a)) return isEmptyBounds(b) ? emptyBounds() : { ...b };
  if (isEmptyBounds(b)) return { ...a };
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export function boundsToRect(b) {
  if (isEmptyBounds(b)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
}

export function rectToBounds(r) {
  return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
}

export function transformBounds(b, m) {
  const result = emptyBounds();
  for (const p of [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ]) {
    extendBounds(result, applyMatrix(m, p));
  }
  return result;
}

export function boundsIntersect(a, b) {
  return !(isEmptyBounds(a) || isEmptyBounds(b) || a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

export function boundsContains(outer, inner) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function cubicBounds(p0, p1, p2, p3) {
  const bounds = emptyBounds();
  extendBounds(bounds, p0);
  extendBounds(bounds, p3);
  for (const axis of ['x', 'y']) {
    const a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis];
    const b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]);
    const c = p1[axis] - p0[axis];
    for (const t of quadraticRoots(a, b, c)) {
      if (t > 0 && t < 1) extendBounds(bounds, cubicPoint(p0, p1, p2, p3, t));
    }
  }
  return bounds;
}

export function isFlat(p0, p1, p2, p3, tolerance) {
  const ux = 3 * p1.x - 2 * p0.x - p3.x;
  const uy = 3 * p1.y - 2 * p0.y - p3.y;
  const vx = 3 * p2.x - p0.x - 2 * p3.x;
  const vy = 3 * p2.y - p0.y - 2 * p3.y;
  return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy) <= 16 * tolerance * tolerance;
}

export function flattenCubic(p0, p1, p2, p3, tolerance = 0.25, out = [], depth = 0) {
  if (depth > 16 || isFlat(p0, p1, p2, p3, tolerance)) {
    out.push({ x: p3.x, y: p3.y });
    return out;
  }
  const [left, right] = splitCubic(p0, p1, p2, p3, 0.5);
  flattenCubic(...left, tolerance, out, depth + 1);
  flattenCubic(...right, tolerance, out, depth + 1);
  return out;
}

export function cubicLength(p0, p1, p2, p3, tolerance = 0.1) {
  let total = 0;
  let previous = p0;
  for (const p of flattenCubic(p0, p1, p2, p3, tolerance)) {
    total += distance(previous, p);
    previous = p;
  }
  return total;
}

export function nearestOnCubic(p0, p1, p2, p3, target, samples = 24) {
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const d = distance(cubicPoint(p0, p1, p2, p3, t), target);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  let step = 1 / samples;
  while (step > 1e-5) {
    step /= 2;
    for (const t of [bestT - step, bestT + step]) {
      if (t < 0 || t > 1) continue;
      const d = distance(cubicPoint(p0, p1, p2, p3, t), target);
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
  }
  return { t: bestT, point: cubicPoint(p0, p1, p2, p3, bestT), distance: bestD };
}

export function distanceToSegment(p, a, b) {
  const ab = sub(b, a);
  const size = dot(ab, ab);
  const t = size < EPSILON ? 0 : clamp(dot(sub(p, a), ab) / size, 0, 1);
  return distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

export function polygonArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return area / 2;
}

export function windingNumber(p, points) {
  let winding = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[j];
    const b = points[i];
    if (a.y <= p.y) {
      if (b.y > p.y && cross(sub(b, a), sub(p, a)) > 0) winding += 1;
    } else if (b.y <= p.y && cross(sub(b, a), sub(p, a)) < 0) {
      winding -= 1;
    }
  }
  return winding;
}

export function pointInRings(p, rings, fillRule = 'nonzero') {
  let winding = 0;
  let crossings = 0;
  for (const ring of rings) {
    const w = windingNumber(p, ring);
    winding += w;
    crossings += Math.abs(w) % 2;
  }
  return fillRule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}

export function segmentsIntersect(a, b, c, d) {
  const d1 = cross(sub(d, c), sub(a, c));
  const d2 = cross(sub(d, c), sub(b, c));
  const d3 = cross(sub(b, a), sub(c, a));
  const d4 = cross(sub(b, a), sub(d, a));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function constrainAngle(origin, target, stepRadians = Math.PI / 4) {
  const angle = Math.round(angleBetween(origin, target) / stepRadians) * stepRadians;
  const size = distance(origin, target);
  return { x: origin.x + Math.cos(angle) * size, y: origin.y + Math.sin(angle) * size };
}

export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000000) / 1000000;
  };
}
