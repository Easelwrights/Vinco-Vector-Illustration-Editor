import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatrix, cubicBounds, decompose, flattenCubic, invert, multiply, nearestOnCubic, pointInRings, reflection, rotation, scaling, splitCubic, translation } from '../../editor/static/editor/js/core/geometry.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('multiplica e inverte matrizes afins', () => {
  const m = multiply(translation(10, 5), multiply(rotation(Math.PI / 3), scaling(2, 3)));
  const p = applyMatrix(m, { x: 7, y: -4 });
  const back = applyMatrix(invert(m), p);
  close(back.x, 7);
  close(back.y, -4);
});

test('reflexão vertical espelha em torno do centro', () => {
  const m = reflection(Math.PI / 2, 50, 0);
  const p = applyMatrix(m, { x: 10, y: 3 });
  close(p.x, 90);
  close(p.y, 3);
});

test('decompõe rotação e escala', () => {
  const d = decompose(multiply(rotation(0.5), scaling(2, 2)));
  close(d.rotation, 0.5);
  close(d.scaleX, 2);
  close(d.scaleY, 2);
});

test('limites exatos de uma curva cúbica', () => {
  const b = cubicBounds({ x: 0, y: 0 }, { x: 0, y: -50 }, { x: 100, y: -50 }, { x: 100, y: 0 });
  close(b.minY, -37.5);
  close(b.maxX, 100);
});

test('divide uma curva no meio mantendo as pontas', () => {
  const [l, r] = splitCubic({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }, 0.5);
  assert.deepEqual(l[0], { x: 0, y: 0 });
  assert.deepEqual(r[3], { x: 10, y: 0 });
  close(l[3].x, 5);
  close(l[3].y, 7.5);
});

test('achata curva dentro da tolerância', () => {
  const pts = flattenCubic({ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }, 0.1);
  assert.ok(pts.length > 8);
  assert.deepEqual(pts[pts.length - 1], { x: 100, y: 0 });
});

test('ponto mais próximo da curva', () => {
  const hit = nearestOnCubic({ x: 0, y: 0 }, { x: 33, y: 0 }, { x: 66, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 10 });
  close(hit.point.x, 40, 0.01);
  close(hit.distance, 10, 0.01);
});

test('regras de preenchimento nonzero e evenodd', () => {
  const outer = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const inner = [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }];
  assert.equal(pointInRings({ x: 5, y: 5 }, [outer, inner], 'evenodd'), false);
  assert.equal(pointInRings({ x: 5, y: 5 }, [outer, inner], 'nonzero'), true);
  assert.equal(pointInRings({ x: 1, y: 1 }, [outer, inner], 'evenodd'), true);
});
