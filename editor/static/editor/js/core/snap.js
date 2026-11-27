export function boundsTargets(bounds) {
  return {
    xs: [bounds.minX, (bounds.minX + bounds.maxX) / 2, bounds.maxX],
    ys: [bounds.minY, (bounds.minY + bounds.maxY) / 2, bounds.maxY],
  };
}

export function collectTargets(boundsList, extra = {}) {
  const xs = [...(extra.xs || [])];
  const ys = [...(extra.ys || [])];
  for (const b of boundsList) {
    const t = boundsTargets(b);
    xs.push(...t.xs);
    ys.push(...t.ys);
  }
  return { xs, ys, points: extra.points || [] };
}

function nearest(value, list, threshold) {
  let best = null;
  for (const candidate of list) {
    const d = Math.abs(candidate - value);
    if (d <= threshold && (!best || d < best.distance)) best = { value: candidate, distance: d };
  }
  return best;
}

export function snapPoint(p, targets, threshold, grid = null) {
  let x = p.x;
  let y = p.y;
  const guides = [];
  for (const pt of targets.points || []) {
    if (Math.hypot(pt.x - p.x, pt.y - p.y) <= threshold) return { x: pt.x, y: pt.y, guides: [{ type: 'point', x: pt.x, y: pt.y }] };
  }
  const sx = nearest(p.x, targets.xs, threshold);
  const sy = nearest(p.y, targets.ys, threshold);
  if (sx) {
    x = sx.value;
    guides.push({ type: 'v', x });
  } else if (grid) {
    x = Math.round(p.x / grid) * grid;
  }
  if (sy) {
    y = sy.value;
    guides.push({ type: 'h', y });
  } else if (grid) {
    y = Math.round(p.y / grid) * grid;
  }
  return { x, y, guides };
}

export function snapBounds(bounds, dx, dy, targets, threshold, grid = null) {
  const moved = { minX: bounds.minX + dx, maxX: bounds.maxX + dx, minY: bounds.minY + dy, maxY: bounds.maxY + dy };
  const own = boundsTargets(moved);
  let bestX = null;
  let bestY = null;
  for (const value of own.xs) {
    const hit = nearest(value, targets.xs, threshold);
    if (hit && (!bestX || hit.distance < bestX.distance)) bestX = { delta: hit.value - value, distance: hit.distance, at: hit.value };
  }
  for (const value of own.ys) {
    const hit = nearest(value, targets.ys, threshold);
    if (hit && (!bestY || hit.distance < bestY.distance)) bestY = { delta: hit.value - value, distance: hit.distance, at: hit.value };
  }
  const guides = [];
  let ndx = dx;
  let ndy = dy;
  if (bestX) {
    ndx += bestX.delta;
    guides.push({ type: 'v', x: bestX.at });
  } else if (grid) {
    ndx = Math.round((bounds.minX + dx) / grid) * grid - bounds.minX;
  }
  if (bestY) {
    ndy += bestY.delta;
    guides.push({ type: 'h', y: bestY.at });
  } else if (grid) {
    ndy = Math.round((bounds.minY + dy) / grid) * grid - bounds.minY;
  }
  return { dx: ndx, dy: ndy, guides };
}

export const UNITS = {
  px: { label: 'px', factor: 1, digits: 2 },
  pt: { label: 'pt', factor: 1, digits: 2 },
  mm: { label: 'mm', factor: 25.4 / 72, digits: 2 },
  cm: { label: 'cm', factor: 2.54 / 72, digits: 3 },
  in: { label: 'in', factor: 1 / 72, digits: 3 },
};

export function toUnit(value, unit) {
  const u = UNITS[unit] || UNITS.px;
  return Math.round(value * u.factor * 10 ** u.digits) / 10 ** u.digits;
}

export function fromUnit(value, unit) {
  const u = UNITS[unit] || UNITS.px;
  return value / u.factor;
}

export function rulerStep(zoom) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (const s of steps) if (s * zoom >= 60) return s;
  return 10000;
}
