import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../editor/static/editor/js/core/document.js';
import * as P from '../../editor/static/editor/js/core/path.js';
import * as O from '../../editor/static/editor/js/core/ops.js';
import { History } from '../../editor/static/editor/js/core/history.js';
import { restoreSnapshot, snapshotOf } from '../../editor/static/editor/js/core/format.js';
import { rotation, scaling } from '../../editor/static/editor/js/core/geometry.js';

function setup() {
  const doc = D.createDocument({ name: 'T', width: 400, height: 300 });
  const layer = doc.layers[0];
  const a = D.createPath(P.rectangle(0, 0, 50, 50));
  const b = D.createPath(P.ellipse(100, 100, 25, 25));
  const c = D.createPath(P.rectangle(200, 0, 50, 80));
  layer.children.push(a, b, c);
  return { doc, layer, a, b, c };
}

test('identificadores são únicos', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => D.uid('p')));
  assert.equal(ids.size, 2000);
});

test('agrupar e desagrupar mantém a ordem', () => {
  const { doc, layer, a, b, c } = setup();
  const g = D.groupItems(doc, [a.id, c.id]);
  assert.deepEqual(layer.children.map((i) => i.id), [b.id, g.id]);
  assert.deepEqual(g.children.map((i) => i.id), [a.id, c.id]);
  D.ungroupItem(doc, g.id);
  assert.deepEqual(layer.children.map((i) => i.id), [b.id, a.id, c.id]);
});

test('organizar: frente, trás, avançar e recuar', () => {
  const { doc, layer, a, b, c } = setup();
  D.arrange(doc, [a.id], 'front');
  assert.deepEqual(layer.children.map((i) => i.id), [b.id, c.id, a.id]);
  D.arrange(doc, [a.id], 'backward');
  assert.deepEqual(layer.children.map((i) => i.id), [b.id, a.id, c.id]);
  D.arrange(doc, [c.id], 'back');
  assert.deepEqual(layer.children.map((i) => i.id), [c.id, b.id, a.id]);
  D.arrange(doc, [c.id], 'forward');
  assert.deepEqual(layer.children.map((i) => i.id), [b.id, c.id, a.id]);
});

test('transformar escala o traçado quando pedido', () => {
  const { a } = setup();
  a.style.strokeWidth = 2;
  D.transformItem(a, scaling(2, 2), { scaleStrokes: true });
  assert.equal(a.style.strokeWidth, 4);
  const b = D.itemBounds(a);
  assert.deepEqual([b.maxX, b.maxY], [100, 100]);
});

test('alinhar e distribuir', () => {
  const rects = [
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    { minX: 50, minY: 20, maxX: 70, maxY: 30 },
    { minX: 200, minY: 5, maxX: 210, maxY: 15 },
  ];
  const left = D.alignOffsets(rects, 'left', { minX: 0, minY: 0, maxX: 210, maxY: 30 });
  assert.deepEqual(left.map((o) => o.dx), [0, -50, -200]);
  const spaced = D.distributeOffsets(rects, 'hspace');
  const moved = rects.map((r, i) => ({ minX: r.minX + spaced[i].dx, maxX: r.maxX + spaced[i].dx }));
  assert.ok(Math.abs(moved[1].minX - moved[0].maxX - (moved[2].minX - moved[1].maxX)) < 1e-9);
});

test('teste de clique encontra o objeto de cima', () => {
  const { doc, layer, b } = setup();
  const top = D.createPath(P.ellipse(110, 100, 10, 10));
  layer.children.push(top);
  assert.equal(D.hitTest(doc, { x: 110, y: 100 }).id, top.id);
  assert.equal(D.hitTest(doc, { x: 85, y: 100 }).id, b.id);
  assert.equal(D.hitTest(doc, { x: 390, y: 290 }), null);
});

test('objetos travados ou ocultos não são selecionáveis', () => {
  const { doc, a } = setup();
  a.locked = true;
  assert.equal(D.hitTest(doc, { x: 10, y: 10 }), null);
  assert.equal(D.isEditable(doc, a.id), false);
});

test('caminho composto, máscara de recorte e liberar', () => {
  const { doc, layer, a, b } = setup();
  const [compound] = O.makeCompound(doc, [a.id, b.id]);
  assert.equal(D.findItem(doc, compound).item.subpaths.length, 2);
  const parts = O.releaseCompound(doc, compound);
  assert.equal(parts.length, 2);
  const [clip] = O.makeClip(doc, layer.children.map((i) => i.id));
  const group = D.findItem(doc, clip).item;
  assert.equal(group.clip, true);
  assert.equal(group.children[group.children.length - 1].style.fill, null);
  O.releaseClip(doc, clip);
  assert.ok(layer.children.length >= 3);
});

test('mesclagem cria as etapas intermediárias e pode ser liberada', () => {
  const { doc, layer, a, c } = setup();
  a.style.fill = D.solid('#000000');
  c.style.fill = D.solid('#ffffff');
  const [id] = O.makeBlend(doc, [a.id, c.id], 4);
  const group = D.findItem(doc, id).item;
  assert.equal(group.children.length, 6);
  assert.equal(group.children[3].style.fill.color.length, 7);
  O.releaseBlend(doc, id);
  assert.equal(layer.children.filter((i) => i.type === 'path').length, 3);
});

test('símbolos: definir, instância e quebrar vínculo', () => {
  const { doc, a } = setup();
  const { symbol, instance } = O.defineSymbol(doc, [a.id], 'Quadro');
  assert.equal(doc.symbols[0].id, symbol.id);
  const b = D.itemBounds(D.findItem(doc, instance.id).item, doc);
  assert.equal(b.maxX, 50);
  const groupId = O.expandInstance(doc, instance.id);
  assert.equal(D.findItem(doc, groupId).item.type, 'group');
});

test('tesoura divide um caminho fechado em aberto', () => {
  const { doc, a } = setup();
  const ids = O.splitPath(doc, a.id, 0, 1, 0.5);
  const item = D.findItem(doc, ids[0]).item;
  assert.equal(item.subpaths[0].closed, false);
  assert.equal(item.subpaths[0].nodes.length, 6);
});

test('borracha corta formas preenchidas', () => {
  const { doc, a } = setup();
  const before = D.itemBounds(a);
  O.eraseWithStroke(doc, [a.id], [{ x: 25, y: -10 }, { x: 25, y: 60 }], 5);
  const item = D.findItem(doc, a.id).item;
  assert.ok(item.subpaths.length >= 2);
  assert.deepEqual(D.itemBounds(item).maxX.toFixed(1), before.maxX.toFixed(1));
});

test('traçado de imagem acha contornos', () => {
  const width = 20;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) data.set([0, 0, 0, 255], (y * width + x) * 4);
  const subs = O.traceBitmap({ width, height, data }, { smooth: 0 });
  assert.equal(subs.length, 1);
  const b = P.subpathsBounds(subs);
  assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY], [5, 5, 15, 15]);
});

test('histórico desfaz e refaz com limite de memória', () => {
  const { doc } = setup();
  const h = new History({ limit: 3 });
  let snap = snapshotOf(doc);
  for (let i = 0; i < 5; i += 1) {
    const before = snap;
    doc.name = `v${i}`;
    snap = snapshotOf(doc);
    h.push(`passo ${i}`, before, snap);
  }
  assert.equal(h.past.length, 3);
  const undo = h.undo();
  assert.equal(restoreSnapshot(undo.snapshot, {}).name, 'v3');
  assert.equal(h.canRedo, true);
  h.redo();
  assert.equal(h.canRedo, false);
});

test('girar mantém o tamanho do retângulo', () => {
  const { a } = setup();
  D.transformItem(a, rotation(Math.PI / 2, 25, 25));
  const b = D.itemBounds(a);
  assert.ok(Math.abs(b.maxX - b.minX - 50) < 1e-6);
});

test('layout de texto em área quebra linhas', () => {
  const t = D.createText('um dois tres quatro cinco seis', 0, 0, { area: { width: 60, height: 100 } });
  t.font.size = 10;
  const lines = D.layoutText(t);
  assert.ok(lines.length > 2);
});
