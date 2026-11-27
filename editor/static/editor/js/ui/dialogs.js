import { ellipse, line, rectangle, regularPolygon, star, spiral, arc, rectangularGrid } from '../core/path.js';
import { reflection, rotation, scaling, shearing, translation } from '../core/geometry.js';
import { findItem } from '../core/document.js';
import { fromUnit, toUnit, UNITS } from '../core/snap.js';
import { EFFECT_LABELS } from './panels.js';

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const PRESETS = [
  { name: 'Carta', w: 612, h: 792, units: 'pt' },
  { name: 'A4', w: 595.28, h: 841.89, units: 'mm' },
  { name: 'A3', w: 841.89, h: 1190.55, units: 'mm' },
  { name: 'Ofício', w: 612, h: 1008, units: 'pt' },
  { name: 'Web 1920 × 1080', w: 1920, h: 1080, units: 'px' },
  { name: 'Web 1366 × 768', w: 1366, h: 768, units: 'px' },
  { name: 'Post quadrado', w: 1080, h: 1080, units: 'px' },
  { name: 'Story 1080 × 1920', w: 1080, h: 1920, units: 'px' },
  { name: 'Ícone 512', w: 512, h: 512, units: 'px' },
  { name: 'Celular 390 × 844', w: 390, h: 844, units: 'px' },
  { name: 'Cartão de visita', w: 255.12, h: 141.73, units: 'mm' },
  { name: 'Personalizado', w: 800, h: 600, units: 'px' },
];

export class Dialogs {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.toasts = document.getElementById('toasts');
    app.on('toast', ({ message, kind }) => this.toast(message, kind));
  }

  toast(message, kind = 'info') {
    const node = document.createElement('div');
    node.className = `toast${kind === 'error' ? ' error' : ''}`;
    node.textContent = message;
    this.toasts.append(node);
    setTimeout(() => node.remove(), kind === 'error' ? 6000 : 3200);
  }

  open(title, html, { wide = false, actions = [], onOpen = null } = {}) {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.innerHTML = `<div class="dialog${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div class="dialog-content">${html}</div><div class="dialog-actions"></div></div>`;
    const dialog = backdrop.querySelector('.dialog');
    const bar = backdrop.querySelector('.dialog-actions');
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      this.active = null;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        e.stopPropagation();
        const primary = actions.find((a) => a.primary);
        if (primary && primary.run(dialog) !== false) close();
      } else {
        e.stopPropagation();
      }
    };
    for (const action of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `button${action.primary ? ' primary' : ''}`;
      b.textContent = action.label;
      b.addEventListener('click', () => {
        if (!action.run || action.run(dialog) !== false) close();
      });
      bar.append(b);
    }
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    this.active = close;
    onOpen?.(dialog, close);
    setTimeout(() => dialog.querySelector('input:not([type="checkbox"]):not([type="radio"]), select, button')?.focus(), 0);
    return { dialog, close };
  }

  values(dialog) {
    const result = {};
    dialog.querySelectorAll('[name]').forEach((input) => {
      if (input.type === 'checkbox') result[input.name] = input.checked;
      else if (input.type === 'radio') {
        if (input.checked) result[input.name] = input.value;
      } else if (input.type === 'number') result[input.name] = Number(input.value);
      else result[input.name] = input.value;
    });
    return result;
  }

  prompt(title, label, value, callback) {
    this.open(title, `<div class="form"><label>${esc(label)}</label><input type="text" name="value" maxlength="120" value="${esc(value)}"></div>`, {
      actions: [
        { label: 'Cancelar' },
        {
          label: 'OK',
          primary: true,
          run: (d) => callback(this.values(d).value.trim()),
        },
      ],
    });
  }

  confirm(title, message, callback, okLabel = 'OK') {
    this.open(title, `<p>${esc(message)}</p>`, { actions: [{ label: 'Cancelar' }, { label: okLabel, primary: true, run: () => callback() }] });
  }

  newDocumentDialog(callback) {
    let current = PRESETS[0];
    const unitOptions = Object.keys(UNITS).map((u) => `<option value="${u}">${UNITS[u].label}</option>`).join('');
    const { dialog } = this.open(
      'Novo documento',
      `<div class="presets">${PRESETS.map((p, i) => `<button type="button" data-preset="${i}" class="${i === 0 ? 'on' : ''}">${esc(p.name)}<small>${toUnit(p.w, p.units)} × ${toUnit(p.h, p.units)} ${p.units}</small></button>`).join('')}</div>
      <div class="form">
        <label>Nome</label><input type="text" name="name" maxlength="120" value="Sem título">
        <label>Unidade</label><select name="units">${unitOptions}</select>
        <label>Largura</label><input type="number" name="width" min="1" step="any">
        <label>Altura</label><input type="number" name="height" min="1" step="any">
        <label>Pranchetas</label><input type="number" name="artboards" min="1" max="100" value="1">
        <label>Orientação</label><div class="seg"><button type="button" data-orient="portrait">Retrato</button><button type="button" data-orient="landscape">Paisagem</button></div>
      </div>`,
      {
        actions: [
          { label: 'Cancelar' },
          {
            label: 'Criar',
            primary: true,
            run: (d) => {
              const v = this.values(d);
              const width = fromUnit(Math.max(0.01, v.width), v.units);
              const height = fromUnit(Math.max(0.01, v.height), v.units);
              callback({ name: v.name || 'Sem título', width: Math.min(100000, width), height: Math.min(100000, height), units: v.units, artboards: Math.max(1, Math.min(100, Math.round(v.artboards) || 1)) });
            },
          },
        ],
      },
    );
    const fill = () => {
      dialog.querySelector('[name="units"]').value = current.units;
      dialog.querySelector('[name="width"]').value = toUnit(current.w, current.units);
      dialog.querySelector('[name="height"]').value = toUnit(current.h, current.units);
    };
    fill();
    dialog.querySelectorAll('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        dialog.querySelectorAll('[data-preset]').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        current = PRESETS[Number(b.dataset.preset)];
        fill();
      }),
    );
    dialog.querySelector('[name="units"]').addEventListener('change', (e) => {
      const w = fromUnit(Number(dialog.querySelector('[name="width"]').value), current.units);
      const h = fromUnit(Number(dialog.querySelector('[name="height"]').value), current.units);
      current = { ...current, w, h, units: e.target.value };
      fill();
    });
    dialog.querySelectorAll('[data-orient]').forEach((b) =>
      b.addEventListener('click', () => {
        const wi = dialog.querySelector('[name="width"]');
        const he = dialog.querySelector('[name="height"]');
        const a = Number(wi.value);
        const c = Number(he.value);
        const landscape = b.dataset.orient === 'landscape';
        if ((landscape && a < c) || (!landscape && a > c)) {
          wi.value = c;
          he.value = a;
        }
      }),
    );
  }

  documentSetupDialog() {
    const doc = this.app.doc;
    const unitOptions = Object.keys(UNITS).map((u) => `<option value="${u}" ${doc.units === u ? 'selected' : ''}>${UNITS[u].label}</option>`).join('');
    this.open(
      'Configurar documento',
      `<div class="form"><label>Unidade</label><select name="units">${unitOptions}</select>
       <label>Cor da prancheta</label><input type="text" name="background" value="${esc(doc.background)}" maxlength="7">
       <label>Tamanho da grade</label><input type="number" name="grid" min="2" max="500" value="${this.app.prefs.gridSize}"></div>`,
      {
        actions: [
          { label: 'Cancelar' },
          {
            label: 'OK',
            primary: true,
            run: (d) => {
              const v = this.values(d);
              const bg = /^#[0-9a-f]{6}$/i.test(v.background) ? v.background.toLowerCase() : doc.background;
              this.app.commit('Configurar documento', (dd) => {
                dd.units = v.units;
                dd.background = bg;
              });
              this.app.setPref('gridSize', Math.max(2, Math.min(500, v.grid || 20)));
            },
          },
        ],
      },
    );
  }

  shapeDialog(tool, p, callback) {
    const u = this.app.doc.units;
    const o = this.app.toolOptions;
    const fields = {
      rect: [['width', 'Largura', 100], ['height', 'Altura', 100]],
      roundRect: [['width', 'Largura', 100], ['height', 'Altura', 100], ['radius', 'Raio do canto', o.cornerRadius]],
      ellipse: [['width', 'Largura', 100], ['height', 'Altura', 100]],
      polygon: [['radius', 'Raio', 50], ['sides', 'Lados', o.sides, true]],
      star: [['radius1', 'Raio 1', 50], ['radius2', 'Raio 2', 25], ['points', 'Pontas', o.points, true]],
      line: [['length', 'Comprimento', 100], ['angle', 'Ângulo', 0, true]],
      arc: [['width', 'Eixo X', 100], ['height', 'Eixo Y', 100]],
      spiral: [['radius', 'Raio', 50], ['decay', 'Decaimento %', o.spiralDecay * 100, true], ['turns', 'Segmentos', o.spiralTurns, true]],
      grid: [['width', 'Largura', 100], ['height', 'Altura', 100], ['cols', 'Colunas', o.gridColumns, true], ['rows', 'Linhas', o.gridRows, true]],
    }[tool];
    if (!fields) return;
    this.open(
      'Criar forma',
      `<div class="form">${fields.map(([name, label, value, raw]) => `<label>${label}</label><input type="number" name="${name}" step="any" value="${raw ? value : toUnit(value, u)}">`).join('')}</div>`,
      {
        actions: [
          { label: 'Cancelar' },
          {
            label: 'OK',
            primary: true,
            run: (d) => {
              const v = this.values(d);
              const len = (k) => fromUnit(Math.max(0, v[k] || 0), u);
              let subs;
              if (tool === 'rect') subs = rectangle(p.x, p.y, len('width'), len('height'));
              if (tool === 'roundRect') subs = rectangle(p.x, p.y, len('width'), len('height'), len('radius'));
              if (tool === 'ellipse') subs = ellipse(p.x + len('width') / 2, p.y + len('height') / 2, len('width') / 2, len('height') / 2);
              if (tool === 'polygon') subs = regularPolygon(p.x, p.y, len('radius'), Math.max(3, v.sides));
              if (tool === 'star') subs = star(p.x, p.y, len('radius1'), len('radius2'), Math.max(3, v.points));
              if (tool === 'line') {
                const a = (-(v.angle || 0) * Math.PI) / 180;
                subs = line(p.x, p.y, p.x + Math.cos(a) * len('length'), p.y + Math.sin(a) * len('length'));
              }
              if (tool === 'arc') subs = arc(p.x, p.y, p.x + len('width'), p.y + len('height'));
              if (tool === 'spiral') subs = spiral(p.x, p.y, len('radius'), Math.max(5, Math.min(99, v.decay)) / 100, Math.max(2, v.turns));
              if (tool === 'grid') subs = rectangularGrid(p.x, p.y, len('width'), len('height'), Math.max(1, v.cols), Math.max(1, v.rows));
              if (subs) callback(subs);
            },
          },
        ],
      },
    );
  }

  transformDialog(kind, origin = null) {
    const b = this.app.selectionBounds();
    if (!b) {
      this.toast('Selecione um objeto primeiro.');
      return;
    }
    const center = origin || { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const u = this.app.doc.units;
    const forms = {
      move: { title: 'Mover', html: `<label>Horizontal</label><input type="number" name="dx" step="any" value="0"><label>Vertical</label><input type="number" name="dy" step="any" value="0">` },
      rotate: { title: 'Girar', html: `<label>Ângulo</label><input type="number" name="angle" step="any" value="45">` },
      reflect: { title: 'Refletir', html: `<label>Eixo</label><select name="axis"><option value="horizontal">Horizontal</option><option value="vertical" selected>Vertical</option><option value="angle">Ângulo</option></select><label>Ângulo</label><input type="number" name="angle" step="any" value="90">` },
      scale: { title: 'Escala', html: `<label>Uniforme %</label><input type="number" name="uniform" step="any" value="100"><label>Horizontal %</label><input type="number" name="sx" step="any" value=""><label>Vertical %</label><input type="number" name="sy" step="any" value=""><label>Escalar traçados</label><input type="checkbox" name="strokes" ${this.app.prefs.scaleStrokes ? 'checked' : ''}>` },
      shear: { title: 'Distorcer', html: `<label>Ângulo</label><input type="number" name="angle" step="any" value="15"><label>Eixo</label><select name="axis"><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select>` },
    }[kind];
    const build = (v) => {
      if (kind === 'move') return translation(fromUnit(v.dx || 0, u), fromUnit(v.dy || 0, u));
      if (kind === 'rotate') return rotation((-(v.angle || 0) * Math.PI) / 180, center.x, center.y);
      if (kind === 'reflect') {
        const angle = v.axis === 'horizontal' ? 0 : v.axis === 'vertical' ? 90 : v.angle || 0;
        return reflection((-angle * Math.PI) / 180, center.x, center.y);
      }
      if (kind === 'scale') {
        const sx = Number.isFinite(v.sx) && v.sx ? v.sx : v.uniform;
        const sy = Number.isFinite(v.sy) && v.sy ? v.sy : v.uniform;
        return scaling((sx || 100) / 100, (sy || 100) / 100, center.x, center.y);
      }
      const t = Math.tan(((v.angle || 0) * Math.PI) / 180);
      return v.axis === 'vertical' ? shearing(0, t, center.x, center.y) : shearing(t, 0, center.x, center.y);
    };
    const run = (copy) => (d) => {
      const v = this.values(d);
      const m = build(v);
      this.ui.transformSelection(m, forms.title, { copy, scaleStrokes: kind === 'scale' ? v.strokes : undefined });
    };
    this.open(forms.title, `<div class="form">${forms.html}</div>`, { actions: [{ label: 'Cancelar' }, { label: 'Copiar', run: run(true) }, { label: 'OK', primary: true, run: run(false) }] });
  }

  offsetPathDialog() {
    const u = this.app.doc.units;
    this.open(
      'Deslocar caminho',
      `<div class="form"><label>Deslocamento</label><input type="number" name="offset" step="any" value="${toUnit(10, u)}"><label>Cantos</label><select name="join"><option value="miter">Pontudo</option><option value="round">Arredondado</option><option value="bevel">Chanfrado</option></select><label>Limite do canto</label><input type="number" name="miter" min="1" value="4"></div>`,
      { actions: [{ label: 'Cancelar' }, { label: 'OK', primary: true, run: (d) => this.ui.menus.offsetPath(this.values(d)) }] },
    );
  }

  simplifyDialog() {
    this.open('Simplificar', `<div class="form"><label>Precisão (tolerância)</label><input type="number" name="error" min="0.05" step="0.05" value="1"></div><p>Valores maiores tiram mais pontos de ancoragem.</p>`, {
      actions: [{ label: 'Cancelar' }, { label: 'OK', primary: true, run: (d) => this.ui.menus.simplify(this.values(d).error) }],
    });
  }

  blendOptionsDialog() {
    this.open('Opções de mesclagem', `<div class="form"><label>Etapas especificadas</label><input type="number" name="steps" min="1" max="200" value="${this.app.toolOptions.blendSteps}"></div>`, {
      actions: [
        { label: 'Cancelar' },
        {
          label: 'OK',
          primary: true,
          run: (d) => {
            this.app.toolOptions.blendSteps = Math.max(1, Math.min(200, Math.round(this.values(d).steps) || 5));
          },
        },
      ],
    });
  }

  effectDialog(type, existing = null, index = null) {
    const e = existing || {};
    const forms = {
      dropShadow: `<label>Deslocamento X</label><input type="number" name="dx" step="any" value="${e.dx ?? 7}"><label>Deslocamento Y</label><input type="number" name="dy" step="any" value="${e.dy ?? 7}"><label>Desfoque</label><input type="number" name="blur" min="0" step="any" value="${e.blur ?? 5}"><label>Opacidade %</label><input type="number" name="opacity" min="0" max="100" value="${Math.round((e.opacity ?? 0.75) * 100)}"><label>Cor</label><input type="text" name="color" value="${e.color ?? '#000000'}" maxlength="7">`,
      blur: `<label>Raio</label><input type="number" name="radius" min="0" step="any" value="${e.radius ?? 5}">`,
      outerGlow: `<label>Desfoque</label><input type="number" name="blur" min="0" step="any" value="${e.blur ?? 8}"><label>Opacidade %</label><input type="number" name="opacity" min="0" max="100" value="${Math.round((e.opacity ?? 0.75) * 100)}"><label>Cor</label><input type="text" name="color" value="${e.color ?? '#f6e4a6'}" maxlength="7">`,
      innerGlow: `<label>Desfoque</label><input type="number" name="blur" min="0" step="any" value="${e.blur ?? 8}"><label>Opacidade %</label><input type="number" name="opacity" min="0" max="100" value="${Math.round((e.opacity ?? 0.75) * 100)}"><label>Cor</label><input type="text" name="color" value="${e.color ?? '#ffffff'}" maxlength="7">`,
      roundCorners: `<label>Raio</label><input type="number" name="radius" min="0" step="any" value="${e.radius ?? 10}">`,
      zigZag: `<label>Tamanho</label><input type="number" name="size" min="0" step="any" value="${e.size ?? 5}"><label>Cristas por segmento</label><input type="number" name="ridges" min="1" max="100" value="${e.ridges ?? 4}"><label>Suave</label><input type="checkbox" name="smooth" ${e.smooth ? 'checked' : ''}>`,
      roughen: `<label>Tamanho</label><input type="number" name="size" min="0" step="any" value="${e.size ?? 4}"><label>Detalhe por 100 px</label><input type="number" name="detail" min="1" max="100" value="${e.detail ?? 10}"><label>Semente</label><input type="number" name="seed" min="1" value="${e.seed ?? Math.ceil(Math.random() * 9999)}">`,
      puckerBloat: `<label>Valor % (−200 a 200)</label><input type="number" name="amount" min="-200" max="200" value="${e.amount ?? 40}">`,
    };
    if (!forms[type]) return;
    if (!this.app.selection.length) {
      this.toast('Selecione um objeto para aplicar o efeito.');
      return;
    }
    this.open(EFFECT_LABELS[type], `<div class="form">${forms[type]}</div>`, {
      actions: [
        { label: 'Cancelar' },
        {
          label: 'OK',
          primary: true,
          run: (d) => {
            const v = this.values(d);
            const effect = { type, enabled: true };
            for (const [k, value] of Object.entries(v)) {
              if (k === 'opacity') effect.opacity = Math.max(0, Math.min(100, value)) / 100;
              else if (k === 'color') effect.color = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#000000';
              else effect[k] = value;
            }
            this.app.prefs.lastEffect = effect;
            this.app.savePrefs();
            this.ui.applyEffect(effect, index);
          },
        },
      ],
    });
  }

  artboardDialog(index) {
    const a = this.app.doc.artboards[index];
    if (!a) return;
    const u = this.app.doc.units;
    this.open(
      'Opções de prancheta',
      `<div class="form"><label>Nome</label><input type="text" name="name" maxlength="120" value="${esc(a.name)}">
      <label>X</label><input type="number" step="any" name="x" value="${toUnit(a.x, u)}"><label>Y</label><input type="number" step="any" name="y" value="${toUnit(a.y, u)}">
      <label>Largura</label><input type="number" min="1" step="any" name="width" value="${toUnit(a.width, u)}"><label>Altura</label><input type="number" min="1" step="any" name="height" value="${toUnit(a.height, u)}"></div>`,
      {
        actions: [
          { label: 'Cancelar' },
          {
            label: 'OK',
            primary: true,
            run: (d) => {
              const v = this.values(d);
              this.app.commit('Opções de prancheta', (doc) => {
                const board = doc.artboards[index];
                board.name = (v.name || board.name).slice(0, 120);
                board.x = fromUnit(v.x, u);
                board.y = fromUnit(v.y, u);
                board.width = Math.max(1, fromUnit(v.width, u));
                board.height = Math.max(1, fromUnit(v.height, u));
              });
            },
          },
        ],
      },
    );
  }

  exportDialog(kind, callback) {
    const doc = this.app.doc;
    const boards = doc.artboards.map((a, i) => `<option value="${i}" ${i === this.app.active.activeArtboard ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
    const raster = kind === 'png' || kind === 'jpeg';
    const scope = kind === 'pdf' ? `<option value="all">Todas as pranchetas</option>${boards}` : `${boards}<option value="all">Toda a arte</option>${kind === 'png' || kind === 'svg' ? '<option value="selection">Seleção</option>' : ''}`;
    this.open(
      `Exportar ${kind.toUpperCase()}`,
      `<div class="form"><label>O que exportar</label><select name="scope">${scope}</select>
      ${raster ? `<label>Resolução</label><select name="scale"><option value="1">1× (72 ppi)</option><option value="2" selected>2× (144 ppi)</option><option value="3">3×</option><option value="4">4× (288 ppi)</option><option value="4.1667">300 ppi</option></select>` : ''}
      ${kind === 'png' ? '<label>Fundo transparente</label><input type="checkbox" name="transparent" checked>' : ''}
      ${kind === 'jpeg' ? '<label>Qualidade %</label><input type="number" name="quality" min="10" max="100" value="90">' : ''}
      ${kind === 'svg' ? '<label>Incluir fundo da prancheta</label><input type="checkbox" name="background">' : ''}</div>`,
      { actions: [{ label: 'Cancelar' }, { label: 'Exportar', primary: true, run: (d) => callback(this.values(d)) }] },
    );
  }

  traceDialog(callback) {
    this.open('Traçado de imagem', `<div class="form"><label>Limiar (0–255)</label><input type="number" name="threshold" min="1" max="254" value="128"><label>Traçar</label><select name="mode"><option value="dark">Áreas escuras</option><option value="light">Áreas claras</option></select><label>Suavidade</label><input type="number" name="smooth" min="0" max="10" step="0.25" value="1"><label>Ignorar manchas menores que (px²)</label><input type="number" name="minArea" min="0" value="8"><label>Cor</label><input type="text" name="color" value="#000000" maxlength="7"></div>`, {
      actions: [{ label: 'Cancelar' }, { label: 'Traçar', primary: true, run: (d) => callback(this.values(d)) }],
    });
  }

  preferencesDialog() {
    const p = this.app.prefs;
    this.open(
      'Preferências',
      `<div class="form">
      <label>Deslocamento do teclado</label><input type="number" name="nudge" min="0.01" step="any" value="${p.nudge}">
      <label>Tamanho da grade</label><input type="number" name="gridSize" min="2" max="500" value="${p.gridSize}">
      <label>Escalar traçados e efeitos</label><input type="checkbox" name="scaleStrokes" ${p.scaleStrokes ? 'checked' : ''}>
      <label>Guias inteligentes</label><input type="checkbox" name="smartGuides" ${p.smartGuides ? 'checked' : ''}>
      <label>Mostrar caixa delimitadora</label><input type="checkbox" name="showBounds" ${p.showBounds ? 'checked' : ''}>
      <label>Tolerância da varinha mágica</label><input type="number" name="wand" min="0" max="255" value="${this.app.toolOptions.wandTolerance}"></div>`,
      {
        actions: [
          { label: 'Cancelar' },
          {
            label: 'OK',
            primary: true,
            run: (d) => {
              const v = this.values(d);
              this.app.prefs.nudge = Math.max(0.01, v.nudge || 1);
              this.app.prefs.gridSize = Math.max(2, Math.min(500, v.gridSize || 20));
              this.app.prefs.scaleStrokes = v.scaleStrokes;
              this.app.prefs.smartGuides = v.smartGuides;
              this.app.prefs.showBounds = v.showBounds;
              this.app.toolOptions.wandTolerance = Math.max(0, Math.min(255, v.wand || 0));
              this.app.savePrefs();
              this.app.emit('prefs');
              this.app.invalidate('all');
            },
          },
        ],
      },
    );
  }

  toolOptionsDialog(tool) {
    const o = this.app.toolOptions;
    const forms = {
      roundRect: [['cornerRadius', 'Raio do canto', o.cornerRadius]],
      polygon: [['sides', 'Lados', o.sides]],
      star: [['points', 'Pontas', o.points], ['innerRatio', 'Raio interno (0–1)', o.innerRatio]],
      spiral: [['spiralDecay', 'Decaimento (0–1)', o.spiralDecay], ['spiralTurns', 'Segmentos', o.spiralTurns]],
      grid: [['gridColumns', 'Colunas', o.gridColumns], ['gridRows', 'Linhas', o.gridRows]],
      brush: [['brushSize', 'Espessura do pincel', o.brushSize]],
      blob: [['blobSize', 'Tamanho (px na tela)', o.blobSize]],
      eraser: [['eraserSize', 'Tamanho (px na tela)', o.eraserSize]],
      pencil: [['pencilFidelity', 'Fidelidade (px)', o.pencilFidelity]],
      wand: [['wandTolerance', 'Tolerância', o.wandTolerance]],
      blend: [['blendSteps', 'Etapas', o.blendSteps]],
    }[tool];
    if (tool === 'rotate' || tool === 'reflect' || tool === 'scale' || tool === 'shear') {
      this.transformDialog(tool);
      return;
    }
    if (!forms) return;
    this.open(
      'Opções da ferramenta',
      `<div class="form">${forms.map(([k, l, v]) => `<label>${l}</label><input type="number" step="any" name="${k}" value="${v}">`).join('')}</div>`,
      {
        actions: [
          { label: 'Cancelar' },
          {
            label: 'OK',
            primary: true,
            run: (d) => {
              const v = this.values(d);
              for (const [k, value] of Object.entries(v)) if (Number.isFinite(value)) o[k] = Math.max(k === 'innerRatio' || k === 'spiralDecay' ? 0.05 : 0, value);
              o.sides = Math.max(3, Math.round(o.sides));
              o.points = Math.max(3, Math.round(o.points));
              o.innerRatio = Math.min(0.99, o.innerRatio);
              o.spiralDecay = Math.min(0.99, o.spiralDecay);
              this.ui.renderOptions();
            },
          },
        ],
      },
    );
  }

  listDialog(title, rows, { empty = 'Nada por aqui.', onPick, onDelete = null, pickLabel = 'Abrir' } = {}) {
    const html = rows.length
      ? `<div class="list" style="max-height:340px">${rows.map((r, i) => `<div class="list-row" data-row="${i}"><span class="grow">${esc(r.title)}</span><span class="muted">${esc(r.detail || '')}</span>${onDelete ? `<button type="button" class="button" data-delete="${i}">Excluir</button>` : ''}<button type="button" class="button primary" data-pick="${i}">${esc(pickLabel)}</button></div>`).join('')}</div>`
      : `<p>${esc(empty)}</p>`;
    this.open(title, html, {
      wide: true,
      actions: [{ label: 'Fechar' }],
      onOpen: (dialog, close) => {
        dialog.querySelectorAll('[data-pick]').forEach((b) =>
          b.addEventListener('click', () => {
            close();
            onPick(rows[Number(b.dataset.pick)]);
          }),
        );
        dialog.querySelectorAll('[data-delete]').forEach((b) =>
          b.addEventListener('click', () => {
            close();
            onDelete(rows[Number(b.dataset.delete)]);
          }),
        );
      },
    });
  }

  shortcutsDialog(groups) {
    const html = groups
      .map(([title, list]) => `<h4 style="margin:12px 0 4px">${esc(title)}</h4><table>${list.map(([label, key]) => `<tr><td>${esc(label)}</td><td style="text-align:right"><kbd>${esc(key)}</kbd></td></tr>`).join('')}</table>`)
      .join('');
    this.open('Atalhos do teclado', html, { wide: true, actions: [{ label: 'Fechar', primary: true }] });
  }

  aboutDialog(version) {
    this.open(
      'Sobre o Vinco',
      `<p><strong>Vinco ${esc(version)}</strong> — editor de ilustração vetorial que roda no navegador.</p><p>Caminhos Bézier, formas, texto, pathfinder, degradês, efeitos, símbolos, camadas e pranchetas, com exportação em SVG, PDF, PNG e JPEG.</p><p>Os arquivos <code>.vinco</code> guardam o documento inteiro, inclusive as imagens incorporadas.</p>`,
      { actions: [{ label: 'Fechar', primary: true }] },
    );
  }

  itemName(id) {
    return findItem(this.app.doc, id)?.item?.name || '';
  }
}
