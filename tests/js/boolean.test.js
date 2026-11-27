import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../../editor/static/editor/js/core/boolean.js';
import * as P from '../../editor/static/editor/js/core/path.js';

const area = (subpaths, rule = 'evenodd') => B.geomArea(B.subpathsToGeom(subpaths, rule));
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const square = (x, y, s) => ({ subpaths: P.rectangle(x, y, s, s) });

test('unir dois quadrados sobrepostos', () => {
  const [r] = B.pathfinder('unite', [square(0, 0, 10), square(5, 5, 10)]);
  near(B.geomArea(r.geom), 175, 0.01);
});

test('menos frente, interseção e excluir sobreposição', () => {
  const entries = [square(0, 0, 10), square(5, 5, 10)];
  near(B.geomArea(B.pathfinder('minusFront', entries)[0].geom), 75, 0.01);
  near(B.geomArea(B.pathfinder('intersect', entries)[0].geom), 25, 0.01);
  near(B.geomArea(B.pathfinder('exclude', entries)[0].geom), 150, 0.01);
  near(B.geomArea(B.pathfinder('minusBack', entries)[0].geom), 75, 0.01);
});

test('dividir cria a partição planar', () => {
  const pieces = B.pathfinder('divide', [square(0, 0, 10), square(5, 5, 10)]);
  assert.equal(pieces.length, 3);
  near(pieces.reduce((s, p) => s + B.geomArea(p.geom), 0), 175, 0.01);
});

test('aparar e cortar demarcação', () => {
  const trimmed = B.pathfinder('trim', [square(0, 0, 10), square(5, 5, 10)]);
  near(trimmed.reduce((s, p) => s + B.geomArea(p.geom), 0), 175, 0.01);
  const cropped = B.pathfinder('crop', [square(0, 0, 10), square(5, 5, 10)]);
  near(B.geomArea(cropped[0].geom), 25, 0.01);
});

test('mesclar junta pedaços de mesma cor', () => {
  const entries = [square(0, 0, 10), square(5, 5, 10), square(20, 0, 5)];
  entries.forEach((e) => (e.key = 'a'));
  const merged = B.pathfinder('merge', entries);
  assert.equal(merged.length, 1);
});

test('caminho composto com furo (evenodd e nonzero)', () => {
  const outer = P.rectangle(0, 0, 10, 10)[0];
  const inner = P.reverseSubpath(P.rectangle(3, 3, 4, 4)[0]);
  near(area([outer, inner], 'evenodd'), 84, 0.01);
  near(area([outer, inner], 'nonzero'), 84, 0.01);
});

test('deslocar caminho para fora e para dentro', () => {
  const subs = P.rectangle(0, 0, 100, 100);
  near(B.geomArea(B.offsetGeom(subs, 10, { join: 'miter' })), 120 * 120, 30);
  near(B.geomArea(B.offsetGeom(subs, -10, { join: 'miter' })), 80 * 80, 30);
});

test('contornar traçado de uma linha com pontas retas', () => {
  near(B.geomArea(B.strokeGeom(P.line(0, 0, 100, 0), 10, { cap: 'butt' })), 1000, 0.5);
  near(B.geomArea(B.strokeGeom(P.line(0, 0, 100, 0), 10, { cap: 'square' })), 1100, 0.5);
});

test('converte geometria de volta em caminhos com curvas', () => {
  const geom = B.subpathsToGeom(P.ellipse(0, 0, 50, 50));
  const subs = B.geomToSubpaths(geom);
  assert.equal(subs.length, 1);
  assert.ok(subs[0].nodes.length < 40);
  const b = P.subpathsBounds(subs);
  near(b.maxX, 50, 0.5);
});
