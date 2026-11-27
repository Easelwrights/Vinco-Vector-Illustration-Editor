import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../editor/static/editor/js/core/path.js';
import { distanceToSegment } from '../../editor/static/editor/js/core/geometry.js';

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('retângulo com cantos arredondados tem 8 pontos', () => {
  const [sub] = P.rectangle(0, 0, 100, 50, 10);
  assert.equal(sub.nodes.length, 8);
  const b = P.subpathsBounds([sub]);
  assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY], [0, 0, 100, 50]);
});

test('elipse usa a constante kappa e tem limites corretos', () => {
  const b = P.subpathsBounds(P.ellipse(50, 50, 40, 20));
  close(b.minX, 10);
  close(b.maxY, 70);
});

test('estrela e polígono têm o número certo de pontos', () => {
  assert.equal(P.star(0, 0, 50, 20, 5)[0].nodes.length, 10);
  assert.equal(P.regularPolygon(0, 0, 50, 7)[0].nodes.length, 7);
});

test('lê todos os comandos de caminho SVG', () => {
  const subs = P.parsePathData('M10 10h20v10H10zm5 5l5 5c1 1 2 2 3 3s4 4 5 5q2 0 3 3t3 3a5 5 0 0 1 10 0');
  assert.equal(subs.length, 2);
  assert.equal(subs[0].closed, true);
  assert.ok(subs[1].nodes.length >= 6);
});

test('ida e volta de dados de caminho', () => {
  const d = P.toPathData(P.ellipse(0, 0, 10, 10));
  const again = P.toPathData(P.parsePathData(d));
  assert.equal(again, d);
});

test('arcos com bandeiras grudadas', () => {
  const subs = P.parsePathData('M0 0a10 10 0 1010 10');
  const b = P.subpathsBounds(subs);
  assert.ok(b.maxX > 9);
});

test('rejeita dados de caminho inválidos', () => {
  assert.throws(() => P.parsePathData('M0 0 L'));
  assert.throws(() => P.parsePathData('10 10'));
});

test('dividir segmento preserva a forma', () => {
  const [sub] = P.ellipse(0, 0, 50, 50);
  const split = P.splitSegment(sub, 0, 0.5);
  assert.equal(split.nodes.length, 5);
  const a = P.subpathsBounds([sub]);
  const b = P.subpathsBounds([split]);
  close(a.maxX, b.maxX);
  close(a.minY, b.minY);
});

test('unir dois caminhos abertos pelas pontas mais próximas', () => {
  const a = P.line(0, 0, 10, 0)[0];
  const b = P.line(30, 0, 10.2, 0)[0];
  const joined = P.joinSubpaths(a, b);
  assert.equal(joined.nodes.length, 3);
  assert.equal(joined.nodes[2].x, 30);
});

test('inverter direção mantém o primeiro ponto em caminhos fechados', () => {
  const [sub] = P.rectangle(0, 0, 10, 10);
  const rev = P.reverseSubpath(sub);
  assert.deepEqual([rev.nodes[0].x, rev.nodes[0].y], [0, 0]);
  assert.deepEqual([rev.nodes[1].x, rev.nodes[1].y], [0, 10]);
});

test('ajuste de curva (Schneider) segue os pontos', () => {
  const pts = Array.from({ length: 60 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 6) * 30 }));
  const sub = P.fitCurve(pts, 0.5);
  assert.ok(sub.nodes.length < 20);
  const flat = P.flatten([sub], 0.1)[0].points;
  for (const p of pts) {
    const d = Math.min(...flat.slice(1).map((q, i) => distanceToSegment(p, flat[i], q)));
    assert.ok(d < 0.75, `desvio ${d}`);
  }
});

test('teste de clique em contorno e preenchimento', () => {
  const subs = P.rectangle(0, 0, 100, 100);
  assert.equal(P.hitPath(subs, { x: 50, y: 50 }, { filled: true }), true);
  assert.equal(P.hitPath(subs, { x: 50, y: 50 }, { filled: false }), false);
  assert.equal(P.hitPath(subs, { x: 101, y: 50 }, { filled: false, tolerance: 2 }), true);
});

test('efeitos de cantos arredondados e zigue-zague', () => {
  const rounded = P.roundCorners(P.rectangle(0, 0, 100, 100), 10);
  assert.equal(rounded[0].nodes.length, 8);
  const zz = P.zigZag(P.line(0, 0, 100, 0), 5, 4);
  assert.ok(zz[0].nodes.length > 4);
  assert.ok(Math.max(...zz[0].nodes.map((n) => Math.abs(n.y))) > 4);
});

test('áspero é determinístico pela semente', () => {
  const a = P.toPathData(P.roughen(P.ellipse(0, 0, 50, 50), 4, 10, 7));
  const b = P.toPathData(P.roughen(P.ellipse(0, 0, 50, 50), 4, 10, 7));
  assert.equal(a, b);
});
