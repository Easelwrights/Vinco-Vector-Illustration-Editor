import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../editor/static/editor/js/core/document.js';
import * as P from '../../editor/static/editor/js/core/path.js';
import * as S from '../../editor/static/editor/js/core/svg.js';
import * as F from '../../editor/static/editor/js/core/format.js';
import { exportPDF } from '../../editor/static/editor/js/core/pdf.js';
import { defaultGradient, hexToRgb, hsbToRgb, normalizeHex, parseColor, rgbToHsb, rgbToCmyk, cmykToRgb } from '../../editor/static/editor/js/core/color.js';

function sample() {
  const doc = D.createDocument({ name: 'Formatos', width: 300, height: 200 });
  const rect = D.createPath(P.rectangle(10, 10, 100, 50, 8), D.defaultStyle({ fill: defaultGradient('linear', '#ff0000', '#0000ff') }));
  rect.effects.push({ type: 'dropShadow', dx: 3, dy: 3, blur: 4, opacity: 0.5, color: '#000000', enabled: true });
  const text = D.createText('Olá <mundo> & "aspas"', 20, 150);
  const group = D.createGroup([D.createPath(P.ellipse(200, 100, 30, 30)), D.createPath(P.rectangle(180, 80, 30, 30))], { clip: true });
  doc.layers[0].children.push(rect, text, group);
  return doc;
}

test('SVG exportado escapa texto e reabre', () => {
  const doc = sample();
  const svg = S.exportSVG(doc);
  assert.ok(svg.includes('&lt;mundo&gt; &amp; &quot;aspas&quot;'));
  assert.ok(svg.includes('<linearGradient'));
  assert.ok(svg.includes('<clipPath'));
  assert.ok(svg.includes('<filter'));
  const back = S.importSVG(svg);
  assert.ok(back.items.length >= 1);
  assert.equal(back.width, 300);
});

test('importa formas básicas, transformações e degradês', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 50 50">
    <defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="100%" style="stop-color:#00f"/></linearGradient></defs>
    <rect x="5" y="5" width="10" height="10" fill="url(#g)" transform="translate(5 5)"/>
    <circle cx="25" cy="25" r="5" style="fill:#00ff00;stroke:black;stroke-width:2"/>
    <polygon points="0,0 10,0 5,8"/><line x1="0" y1="0" x2="10" y2="10" stroke="#123456"/>
    <text x="1" y="40" font-size="8">Oi<tspan dy="1em">linha</tspan></text>
    <script>alert(1)</script><image href="javascript:alert(1)" width="5" height="5"/>
  </svg>`;
  const { items } = S.importSVG(svg);
  assert.equal(items.length, 5);
  const rect = items[0];
  assert.equal(rect.style.fill.type, 'gradient');
  const b = P.subpathsBounds(rect.subpaths);
  assert.deepEqual([b.minX, b.minY], [20, 20]);
  assert.equal(items[1].style.stroke.color, '#000000');
  assert.equal(items[4].type, 'text');
  assert.ok(items[4].content.includes('\n'));
});

test('analisador XML lida com entidades, comentários e CDATA', () => {
  const root = S.parseXml('<?xml version="1.0"?><!-- x --><a b="1 &amp; 2"><![CDATA[<raw>]]>&#65;&#x42;</a>');
  const a = root.children.find((c) => c.name === 'a');
  assert.equal(a.attrs.b, '1 & 2');
  assert.equal(a.text, '<raw>AB');
});

test('formato .vinco ida e volta', () => {
  const doc = sample();
  const parsed = F.parseDocument(F.serializeDocument(doc));
  assert.equal(parsed.layers[0].children.length, 3);
  assert.equal(parsed.layers[0].children[0].effects[0].type, 'dropShadow');
});

test('validação recusa conteúdo perigoso ou inválido', () => {
  const base = JSON.parse(F.serializeDocument(sample()));
  const cases = [
    { ...base, format: 'x' },
    { ...base, version: 99 },
    { ...base, assets: { a1: 'data:image/svg+xml;base64,PHN2Zz4=' } },
    { ...base, artboards: [] },
  ];
  const badColor = JSON.parse(JSON.stringify(base));
  badColor.layers[0].children[0].style.stroke.color = 'url(javascript:1)';
  cases.push(badColor);
  const dup = JSON.parse(JSON.stringify(base));
  dup.layers[0].children[1].id = dup.layers[0].children[0].id;
  cases.push(dup);
  for (const c of cases) assert.throws(() => F.parseDocument(c), F.FormatError);
  const font = JSON.parse(JSON.stringify(base));
  font.layers[0].children[1].font.family = 'Arial"/><script>';
  assert.ok(!F.parseDocument(font).layers[0].children[1].font.family.includes('<'));
});

test('PDF tem estrutura válida e uma página por prancheta', () => {
  const doc = sample();
  doc.artboards.push(D.createArtboard('Segunda', 400, 0, 200, 200));
  const bytes = exportPDF(doc);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.startsWith('%PDF-1.7'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.equal((text.match(/\/Type \/Page /g) || []).length, 2);
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const offsets = [...text.matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`)));
  assert.ok(text.includes('/ShadingType 2'));
});

test('cores: hex, rgb, hsb e cmyk', () => {
  assert.equal(normalizeHex('ABC'), '#aabbcc');
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), { color: '#ff0000', alpha: 1 });
  assert.equal(parseColor('none').color, null);
  const hsb = rgbToHsb(255, 128, 0);
  const rgb = hsbToRgb(hsb.h, hsb.s, hsb.b);
  assert.deepEqual([rgb.r, rgb.g, rgb.b], [255, 128, 0]);
  const cmyk = rgbToCmyk(10, 200, 30);
  const back = cmykToRgb(cmyk.c, cmyk.m, cmyk.y, cmyk.k);
  assert.deepEqual([back.r, back.g, back.b], [10, 200, 30]);
  assert.deepEqual(hexToRgb('#102030'), { r: 16, g: 32, b: 48 });
});

test('imagens só aceitam data URLs de bitmap', () => {
  assert.ok(S.SAFE_IMAGE.test('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(!S.SAFE_IMAGE.test('data:image/svg+xml;base64,PHN2Zz4='));
  assert.ok(!S.SAFE_IMAGE.test('javascript:alert(1)'));
});
