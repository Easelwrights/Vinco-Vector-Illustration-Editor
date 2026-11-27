import { BLEND_MODES, FONT_FAMILIES, findItem, itemLabel, createLayer, walk, cloneStyle, LAYER_COLORS } from '../core/document.js';
import { cmykToRgb, defaultGradient, hexToRgb, hsbToRgb, normalizeHex, paintColor, rgbToCmyk, rgbToHex, rgbToHsb } from '../core/color.js';
import { applyPathfinder, defineSymbol, expandInstance } from '../core/ops.js';
import { scaling, translation, rotation, shearing } from '../core/geometry.js';
import { fromUnit, toUnit } from '../core/snap.js';
import { icon } from './icons.js';

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

const PANELS = [
  ['transform', 'Transformar', true],
  ['appearance', 'Aparência', true],
  ['color', 'Cor', true],
  ['swatches', 'Amostras', false],
  ['gradient', 'Degradê', false],
  ['stroke', 'Traçado', false],
  ['transparency', 'Transparência', false],
  ['align', 'Alinhar', false],
  ['pathfinder', 'Pathfinder', false],
  ['character', 'Caractere e parágrafo', false],
  ['symbols', 'Símbolos', false],
  ['artboards', 'Pranchetas', false],
  ['layers', 'Camadas', true],
];

export const PANEL_LIST = PANELS.map(([id, title]) => ({ id, title }));

export const EFFECT_LABELS = {
  dropShadow: 'Sombra projetada',
  blur: 'Desfoque gaussiano',
  outerGlow: 'Brilho externo',
  innerGlow: 'Brilho interno',
  roundCorners: 'Cantos arredondados',
  zigZag: 'Zigue-zague',
  roughen: 'Áspero',
  puckerBloat: 'Franzir e inchar',
};

const paintBackground = (paint) => {
  if (!paint) return '';
  if (paint.type === 'color') return `background:${paint.color}`;
  const stops = [...paint.stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${round(s.offset * 100)}%`).join(',');
  return `background:${paint.kind === 'radial' ? `radial-gradient(${stops})` : `linear-gradient(90deg,${stops})`}`;
};

export class Panels {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.root = document.getElementById('sidebar');
    this.sections = new Map();
    this.hsb = { h: 0, s: 0, b: 0 };
    this.colorMode = 'rgb';
    this.gradientStop = 0;
    this.layerOpen = new Set();
    this.dragRow = null;
    this.alignTo = 'selection';
    this.refPoint = [1, 1];
    this.build();
    app.on('selection', () => this.refresh());
    app.on('change', () => this.refresh());
    app.on('paint', () => this.refresh());
    app.on('tabs', () => this.refresh());
    app.on('prefs', () => this.refresh());
  }

  build() {
    this.root.innerHTML = '';
    for (const [id, title, open] of PANELS) {
      const section = document.createElement('section');
      section.className = 'panel';
      section.dataset.panel = id;
      const state = this.app.prefs.panels[id];
      const isOpen = state === undefined ? open : state;
      if (!isOpen) section.classList.add('collapsed');
      if (this.app.prefs.panels[`${id}:hidden`]) section.hidden = true;
      section.innerHTML = `<button type="button" class="panel-head" aria-expanded="${isOpen}"><h2>${title}</h2><span class="chevron">${icon('chevron', 14)}</span></button><div class="panel-body"></div>`;
      section.querySelector('.panel-head').addEventListener('click', () => {
        const collapsed = section.classList.toggle('collapsed');
        section.querySelector('.panel-head').setAttribute('aria-expanded', String(!collapsed));
        this.app.prefs.panels[id] = !collapsed;
        this.app.savePrefs();
        this.renderPanel(id);
      });
      this.root.append(section);
      this.sections.set(id, section.querySelector('.panel-body'));
    }
  }

  showPanel(id) {
    const body = this.sections.get(id);
    if (!body) return;
    const section = body.parentElement;
    section.hidden = false;
    section.classList.remove('collapsed');
    this.app.prefs.panels[id] = true;
    delete this.app.prefs.panels[`${id}:hidden`];
    this.app.savePrefs();
    this.renderPanel(id);
    section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  togglePanel(id) {
    const section = this.sections.get(id)?.parentElement;
    if (!section) return;
    if (section.hidden || section.classList.contains('collapsed')) this.showPanel(id);
    else {
      section.hidden = true;
      this.app.prefs.panels[`${id}:hidden`] = true;
      this.app.savePrefs();
    }
  }

  isVisible(id) {
    const section = this.sections.get(id)?.parentElement;
    return section && !section.hidden && !section.classList.contains('collapsed');
  }

  refresh() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (!this.app.active) return;
      for (const [id] of PANELS) this.renderPanel(id);
      this.ui.renderOptions?.();
      this.ui.renderPaintWidget?.();
      this.updateStatus();
    });
  }

  updateStatus() {
    const b = this.app.selectionBounds();
    const unit = this.app.doc.units;
    document.getElementById('status-selection').textContent = b ? `${this.app.selection.length} sel. · L ${toUnit(b.maxX - b.minX, unit)} × A ${toUnit(b.maxY - b.minY, unit)}` : '';
    const h = this.app.active.history;
    document.getElementById('status-history').textContent = `Histórico: ${h.past.length} · ${Math.round(h.bytes / 1024)} KB`;
  }

  renderPanel(id) {
    const body = this.sections.get(id);
    if (!body || !this.isVisible(id)) return;
    if (body.contains(document.activeElement) && document.activeElement.matches('input[type="number"], input[type="text"], textarea')) return;
    const fn = this[`render_${id}`];
    if (fn) fn.call(this, body);
  }

  styleTargets() {
    const result = [];
    for (const item of this.app.selectedItems()) {
      for (const entry of walk([item])) {
        if (entry.item.style) result.push(entry.item);
      }
    }
    return result;
  }

  primaryStyleItem() {
    return this.styleTargets()[0] || null;
  }

  currentPaint(which) {
    const item = this.primaryStyleItem();
    if (item) return item.style[which] ?? null;
    return this.app.paint[which] ?? null;
  }

  updateStyles(label, fn) {
    const targets = this.styleTargets().map((t) => t.id);
    if (!targets.length) {
      const pseudo = { style: { fill: this.app.paint.fill, stroke: this.app.paint.stroke, strokeWidth: this.app.paint.strokeWidth, cap: this.app.paint.cap || 'butt', join: this.app.paint.join || 'miter', dash: this.app.paint.dash || [] } };
      fn(pseudo.style, pseudo);
      Object.assign(this.app.paint, { fill: pseudo.style.fill, stroke: pseudo.style.stroke, strokeWidth: pseudo.style.strokeWidth, cap: pseudo.style.cap, join: pseudo.style.join, dash: pseudo.style.dash });
      this.app.emit('paint');
      return;
    }
    this.app.commit(label, (doc) => {
      for (const id of targets) {
        const item = findItem(doc, id)?.item;
        if (item?.style) fn(item.style, item);
      }
    });
    const first = findItem(this.app.doc, targets[0])?.item;
    if (first?.style) {
      this.app.paint.fill = first.style.fill;
      this.app.paint.stroke = first.style.stroke;
      if (first.style.strokeWidth) this.app.paint.strokeWidth = first.style.strokeWidth;
    }
  }

  updateItems(label, fn) {
    const ids = this.app.selection;
    if (!ids.length) return;
    this.app.commit(label, (doc) => {
      for (const id of ids) {
        const item = findItem(doc, id)?.item;
        if (item) fn(item, doc);
      }
    });
  }

  render_transform(body) {
    const b = this.app.selectionBounds();
    const unit = this.app.doc.units;
    const [ri, rj] = this.refPoint;
    if (!b) {
      body.innerHTML = '<p class="muted">Selecione um objeto para ver a posição e o tamanho.</p>';
      return;
    }
    const rx = b.minX + ((b.maxX - b.minX) * ri) / 2;
    const ry = b.minY + ((b.maxY - b.minY) * rj) / 2;
    const ref = [];
    for (let j = 0; j < 3; j += 1) for (let i = 0; i < 3; i += 1) ref.push(`<button type="button" data-ref="${i},${j}" class="${i === ri && j === rj ? 'on' : ''}" aria-label="Ponto de referência"></button>`);
    body.innerHTML = `
      <div class="row" style="align-items:flex-start;gap:12px">
        <div class="ref-point">${ref.join('')}</div>
        <div class="grid2" style="flex:1">
          <label class="field"><span>X</span><input type="number" step="any" data-t="x" value="${toUnit(rx, unit)}"></label>
          <label class="field"><span>L</span><input type="number" step="any" min="0" data-t="w" value="${toUnit(b.maxX - b.minX, unit)}"></label>
          <label class="field"><span>Y</span><input type="number" step="any" data-t="y" value="${toUnit(ry, unit)}"></label>
          <label class="field"><span>A</span><input type="number" step="any" min="0" data-t="h" value="${toUnit(b.maxY - b.minY, unit)}"></label>
          <label class="field"><span>∠</span><input type="number" step="any" data-t="r" value="0" title="Girar (graus)"></label>
          <label class="field"><span>⫽</span><input type="number" step="any" data-t="s" value="0" title="Distorcer (graus)"></label>
        </div>
      </div>
      <div class="row">
        <label class="option"><input type="checkbox" data-t="lock" ${this.lockRatio ? 'checked' : ''}> Manter proporções</label>
        <label class="option"><input type="checkbox" data-t="strokes" ${this.app.prefs.scaleStrokes ? 'checked' : ''}> Escalar traçados</label>
      </div>
      <div class="row tight">
        <button type="button" class="icon-button small" data-flip="h" title="Refletir na horizontal">${icon('flipH', 16)}</button>
        <button type="button" class="icon-button small" data-flip="v" title="Refletir na vertical">${icon('flipV', 16)}</button>
        <button type="button" class="icon-button small" data-rot="90" title="Girar 90°">${icon('rotate', 16)}</button>
      </div>`;
    body.querySelectorAll('[data-ref]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.refPoint = btn.dataset.ref.split(',').map(Number);
        this.render_transform(body);
      }),
    );
    body.querySelector('[data-t="lock"]').addEventListener('change', (e) => {
      this.lockRatio = e.target.checked;
    });
    body.querySelector('[data-t="strokes"]').addEventListener('change', (e) => this.app.setPref('scaleStrokes', e.target.checked));
    const apply = (key, raw) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      const bounds = this.app.selectionBounds();
      if (!bounds) return;
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      const ox = bounds.minX + (w * this.refPoint[0]) / 2;
      const oy = bounds.minY + (h * this.refPoint[1]) / 2;
      let m = null;
      if (key === 'x') m = translation(fromUnit(value, unit) - ox, 0);
      if (key === 'y') m = translation(0, fromUnit(value, unit) - oy);
      if (key === 'w' && w > 0) {
        const k = fromUnit(Math.max(0.01, value), unit) / w;
        m = scaling(k, this.lockRatio ? k : 1, ox, oy);
      }
      if (key === 'h' && h > 0) {
        const k = fromUnit(Math.max(0.01, value), unit) / h;
        m = scaling(this.lockRatio ? k : 1, k, ox, oy);
      }
      if (key === 'r') m = rotation((-value * Math.PI) / 180, ox, oy);
      if (key === 's') m = shearing(Math.tan((value * Math.PI) / 180), 0, ox, oy);
      if (!m) return;
      this.ui.transformSelection(m, 'Transformar');
    };
    body.querySelectorAll('input[type="number"]').forEach((input) => input.addEventListener('change', () => apply(input.dataset.t, input.value)));
    body.querySelectorAll('[data-flip]').forEach((btn) => btn.addEventListener('click', () => this.ui.flip(btn.dataset.flip)));
    body.querySelector('[data-rot]').addEventListener('click', () => this.ui.rotateBy(-90));
  }

  render_appearance(body) {
    const item = this.app.selectedItems()[0];
    const fill = this.currentPaint('fill');
    const stroke = this.currentPaint('stroke');
    const strokeWidth = item?.style?.strokeWidth ?? this.app.paint.strokeWidth;
    const opacity = item ? item.opacity ?? 1 : 1;
    const effects = item?.effects || [];
    body.innerHTML = `
      <div class="row"><span class="muted" style="min-width:74px">${item ? esc(itemLabel(item)) : 'Novos objetos'}</span></div>
      <div class="row"><span style="min-width:74px">Preenchimento</span><button type="button" class="swatch${fill ? '' : ' none'}" data-focus="fill" style="width:22px;${paintBackground(fill)}" aria-label="Preenchimento"></button></div>
      <div class="row"><span style="min-width:74px">Traçado</span><button type="button" class="swatch${stroke ? '' : ' none'}" data-focus="stroke" style="width:22px;${paintBackground(stroke)}" aria-label="Traçado"></button>
        <input type="number" min="0" step="0.25" data-a="sw" value="${round(stroke ? strokeWidth : 0)}" style="width:56px" aria-label="Espessura do traçado"> <span class="muted">${this.app.doc.units}</span></div>
      <div class="row"><span style="min-width:74px">Opacidade</span><input type="range" min="0" max="100" data-a="op" value="${Math.round(opacity * 100)}" ${item ? '' : 'disabled'}><span class="mono">${Math.round(opacity * 100)}%</span></div>
      <div>${effects
        .map(
          (e, i) => `<div class="effect-row"><input type="checkbox" data-e-toggle="${i}" ${e.enabled !== false ? 'checked' : ''} aria-label="Ativar efeito"><span class="grow">${EFFECT_LABELS[e.type] || e.type}</span>
        <button type="button" class="icon-button small" data-e-edit="${i}" title="Editar">${icon('fx', 14)}</button>
        <button type="button" class="icon-button small" data-e-remove="${i}" title="Remover">${icon('trash', 14)}</button></div>`,
        )
        .join('')}</div>
      <div class="row"><button type="button" class="button" data-a="fx" ${item ? '' : 'disabled'}>${icon('fx', 14)} Adicionar efeito</button><button type="button" class="button" data-a="clear" ${item ? '' : 'disabled'}>Limpar aparência</button></div>`;
    body.querySelectorAll('[data-focus]').forEach((b) =>
      b.addEventListener('click', () => {
        this.app.paint.focus = b.dataset.focus;
        this.app.emit('paint');
        this.showPanel('color');
      }),
    );
    body.querySelector('[data-a="sw"]').addEventListener('change', (e) => {
      const v = Math.max(0, Number(e.target.value) || 0);
      this.updateStyles('Espessura do traçado', (style) => {
        style.strokeWidth = v;
        if (v > 0 && !style.stroke) style.stroke = { type: 'color', color: '#000000' };
      });
    });
    const op = body.querySelector('[data-a="op"]');
    op.addEventListener('input', () => {
      op.nextElementSibling.textContent = `${op.value}%`;
    });
    op.addEventListener('change', () => this.updateItems('Opacidade', (it) => (it.opacity = Number(op.value) / 100)));
    body.querySelector('[data-a="fx"]').addEventListener('click', (e) => this.ui.menus.openEffectMenu(e.currentTarget));
    body.querySelector('[data-a="clear"]').addEventListener('click', () =>
      this.updateItems('Limpar aparência', (it) => {
        it.effects = [];
        it.opacity = 1;
        it.blend = 'normal';
        if (it.style && it.type === 'path') it.style = cloneStyle({ ...it.style, fill: null, stroke: { type: 'color', color: '#000000' }, strokeWidth: 1, dash: [] });
      }),
    );
    body.querySelectorAll('[data-e-toggle]').forEach((c) =>
      c.addEventListener('change', () =>
        this.updateItems('Efeito', (it) => {
          const e = it.effects[Number(c.dataset.eToggle)];
          if (e) e.enabled = c.checked;
        }),
      ),
    );
    body.querySelectorAll('[data-e-remove]').forEach((b) => b.addEventListener('click', () => this.updateItems('Remover efeito', (it) => it.effects.splice(Number(b.dataset.eRemove), 1))));
    body.querySelectorAll('[data-e-edit]').forEach((b) =>
      b.addEventListener('click', () => {
        const effect = item.effects[Number(b.dataset.eEdit)];
        if (effect) this.ui.dialogs.effectDialog(effect.type, effect, Number(b.dataset.eEdit));
      }),
    );
  }

  setFocusPaint(paint, label = 'Cor') {
    const which = this.app.paint.focus;
    this.updateStyles(label, (style, item) => {
      style[which] = paint ? JSON.parse(JSON.stringify(paint)) : null;
      if (which === 'stroke' && paint && !(style.strokeWidth > 0)) style.strokeWidth = item?.type === 'text' ? 0.5 : this.app.paint.strokeWidth || 1;
    });
  }

  render_color(body) {
    const which = this.app.paint.focus;
    const paint = this.currentPaint(which);
    const hex = paintColor(paint) || '#ffffff';
    const { r, g, b } = hexToRgb(hex);
    if (!this.colorDragging) {
      const hsb = rgbToHsb(r, g, b);
      if (hsb.s > 0 && hsb.b > 0) this.hsb = hsb;
      else this.hsb = { h: this.hsb.h, s: hsb.s, b: hsb.b };
    }
    const hue = rgbToHex(...Object.values(hsbToRgb(this.hsb.h, 100, 100)));
    const cmyk = rgbToCmyk(r, g, b);
    const fields =
      this.colorMode === 'rgb'
        ? ['R', 'G', 'B'].map((k, i) => `<label class="field"><span>${k}</span><input type="number" min="0" max="255" data-c="${k}" value="${[r, g, b][i]}"></label>`).join('')
        : this.colorMode === 'hsb'
          ? ['H', 'S', 'B'].map((k, i) => `<label class="field"><span>${k}</span><input type="number" min="0" max="${i ? 100 : 360}" data-c="${k}" value="${Math.round([this.hsb.h, this.hsb.s, this.hsb.b][i])}"></label>`).join('')
          : ['C', 'M', 'Y', 'K'].map((k) => `<label class="field"><span>${k}</span><input type="number" min="0" max="100" data-c="${k}" value="${Math.round(cmyk[k.toLowerCase()])}"></label>`).join('');
    body.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div class="seg"><button type="button" data-w="fill" class="${which === 'fill' ? 'on' : ''}">Preenchimento</button><button type="button" data-w="stroke" class="${which === 'stroke' ? 'on' : ''}">Traçado</button></div>
        <select data-mode aria-label="Modo de cor"><option value="rgb">RGB</option><option value="hsb">HSB</option><option value="cmyk">CMYK</option></select>
      </div>
      <div class="color-area" style="background-color:${hue}"><span class="thumb" style="left:${this.hsb.s}%;top:${100 - this.hsb.b}%"></span></div>
      <div class="hue-bar"><span class="thumb" style="left:${(this.hsb.h / 360) * 100}%"></span></div>
      <div class="row"><label class="field"><span>#</span><input type="text" data-hex value="${hex.slice(1)}" maxlength="7" style="width:76px;font-family:var(--mono)"></label>
        <button type="button" class="swatch none" data-none style="width:22px" title="Nenhum" aria-label="Nenhum"></button>
        <button type="button" class="swatch" data-white style="width:22px;background:#fff" aria-label="Branco"></button>
        <button type="button" class="swatch" data-black style="width:22px;background:#000" aria-label="Preto"></button>
        <button type="button" class="button" data-add-swatch>+ Amostra</button>
      </div>
      <div class="grid2">${fields}</div>`;
    body.querySelector('[data-mode]').value = this.colorMode;
    body.querySelector('[data-mode]').addEventListener('change', (e) => {
      this.colorMode = e.target.value;
      this.render_color(body);
    });
    body.querySelectorAll('[data-w]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.app.paint.focus = btn.dataset.w;
        this.app.emit('paint');
      }),
    );
    const live = (newHex, final) => {
      const current = this.currentPaint(which);
      let paintValue;
      if (current?.type === 'gradient') {
        paintValue = JSON.parse(JSON.stringify(current));
        const stop = paintValue.stops[Math.min(this.gradientStop, paintValue.stops.length - 1)];
        stop.color = newHex;
      } else paintValue = { type: 'color', color: newHex };
      if (!final) {
        for (const item of this.styleTargets()) item.style[which] = JSON.parse(JSON.stringify(paintValue));
        if (!this.styleTargets().length) this.app.paint[which] = paintValue;
        this.app.updateInteraction();
        const area = body.querySelector('.color-area');
        area.style.backgroundColor = rgbToHex(...Object.values(hsbToRgb(this.hsb.h, 100, 100)));
        area.querySelector('.thumb').style.left = `${this.hsb.s}%`;
        area.querySelector('.thumb').style.top = `${100 - this.hsb.b}%`;
        body.querySelector('.hue-bar .thumb').style.left = `${(this.hsb.h / 360) * 100}%`;
        body.querySelector('[data-hex]').value = newHex.slice(1);
        this.ui.renderPaintWidget?.();
      }
      return paintValue;
    };
    const dragArea = (el, update) => {
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        this.colorDragging = true;
        if (this.styleTargets().length) this.app.beginInteraction();
        const move = (ev) => {
          const rect = el.getBoundingClientRect();
          update(Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height)));
          const rgb = hsbToRgb(this.hsb.h, this.hsb.s, this.hsb.b);
          live(rgbToHex(rgb.r, rgb.g, rgb.b), false);
        };
        move(e);
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          this.colorDragging = false;
          if (this.app.interaction) this.app.endInteraction('Cor');
          else this.app.emit('paint');
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });
    };
    dragArea(body.querySelector('.color-area'), (x, y) => {
      this.hsb.s = x * 100;
      this.hsb.b = (1 - y) * 100;
    });
    dragArea(body.querySelector('.hue-bar'), (x) => {
      this.hsb.h = Math.min(359.9, x * 360);
    });
    const commitHex = (newHex) => {
      const value = live(newHex, true);
      this.setFocusPaint(value);
    };
    body.querySelector('[data-hex]').addEventListener('change', (e) => {
      const value = normalizeHex(e.target.value);
      if (value) commitHex(value);
    });
    body.querySelector('[data-none]').addEventListener('click', () => this.setFocusPaint(null, 'Nenhum'));
    body.querySelector('[data-white]').addEventListener('click', () => commitHex('#ffffff'));
    body.querySelector('[data-black]').addEventListener('click', () => commitHex('#000000'));
    body.querySelector('[data-add-swatch]').addEventListener('click', () =>
      this.app.commit('Nova amostra', (doc) => {
        if (!doc.swatches.includes(hex)) doc.swatches.push(hex);
      }),
    );
    body.querySelectorAll('[data-c]').forEach((input) =>
      input.addEventListener('change', () => {
        const vals = {};
        body.querySelectorAll('[data-c]').forEach((i) => (vals[i.dataset.c] = Number(i.value) || 0));
        let rgb;
        if (this.colorMode === 'rgb') rgb = { r: vals.R, g: vals.G, b: vals.B };
        else if (this.colorMode === 'hsb') rgb = hsbToRgb(Math.max(0, Math.min(359.9, vals.H)), Math.max(0, Math.min(100, vals.S)), Math.max(0, Math.min(100, vals.B)));
        else rgb = cmykToRgb(vals.C, vals.M, vals.Y, vals.K);
        commitHex(rgbToHex(rgb.r, rgb.g, rgb.b));
      }),
    );
  }

  render_swatches(body) {
    const doc = this.app.doc;
    body.innerHTML = `<div class="swatch-grid"><button type="button" class="swatch none" data-sw="none" title="Nenhum" aria-label="Nenhum"></button>${doc.swatches
      .map((c, i) => `<button type="button" class="swatch" data-sw="${i}" style="background:${c}" title="${c}" aria-label="Amostra ${c}"></button>`)
      .join('')}</div>
      <div class="row"><button type="button" class="button" data-a="add">Nova amostra</button><button type="button" class="button" data-a="sel">Do desenho</button><span class="muted">Alt+clique exclui</span></div>`;
    body.querySelectorAll('[data-sw]').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        if (btn.dataset.sw === 'none') {
          this.setFocusPaint(null, 'Nenhum');
          return;
        }
        const index = Number(btn.dataset.sw);
        if (e.altKey) {
          this.app.commit('Excluir amostra', (d) => d.swatches.splice(index, 1));
          return;
        }
        this.setFocusPaint({ type: 'color', color: doc.swatches[index] }, 'Amostra');
      }),
    );
    body.querySelector('[data-a="add"]').addEventListener('click', () => {
      const color = paintColor(this.currentPaint(this.app.paint.focus)) || '#000000';
      this.app.commit('Nova amostra', (d) => {
        if (!d.swatches.includes(color)) d.swatches.push(color);
      });
    });
    body.querySelector('[data-a="sel"]').addEventListener('click', () => {
      const colors = new Set();
      for (const item of this.app.allItems()) {
        for (const p of [item.style?.fill, item.style?.stroke]) {
          if (p?.type === 'color') colors.add(p.color);
          if (p?.type === 'gradient') p.stops.forEach((s) => colors.add(s.color));
        }
      }
      this.app.commit('Amostras do desenho', (d) => {
        for (const c of colors) if (!d.swatches.includes(c)) d.swatches.push(c);
      });
    });
  }

  render_gradient(body) {
    const which = this.app.paint.focus;
    const paint = this.currentPaint(which);
    const g = paint?.type === 'gradient' ? paint : null;
    if (!g) {
      body.innerHTML = `<p class="muted">O ${which === 'fill' ? 'preenchimento' : 'traçado'} atual é ${paint ? 'uma cor sólida' : 'nenhum'}.</p><div class="row"><button type="button" class="button" data-make="linear">Degradê linear</button><button type="button" class="button" data-make="radial">Degradê radial</button></div>`;
      body.querySelectorAll('[data-make]').forEach((b) => b.addEventListener('click', () => this.setFocusPaint(defaultGradient(b.dataset.make, paintColor(paint) || '#ffffff', '#000000'), 'Degradê')));
      return;
    }
    const stops = g.stops;
    this.gradientStop = Math.min(this.gradientStop, stops.length - 1);
    const sel = stops[this.gradientStop];
    const angle = g.kind === 'linear' ? Math.round((Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * -180) / Math.PI) : 0;
    body.innerHTML = `
      <div class="row"><div class="seg"><button type="button" data-k="linear" class="${g.kind === 'linear' ? 'on' : ''}">Linear</button><button type="button" data-k="radial" class="${g.kind === 'radial' ? 'on' : ''}">Radial</button></div>
        ${g.kind === 'linear' ? `<label class="field"><span>∠</span><input type="number" data-angle value="${angle}" style="width:56px"></label>` : ''}
        <button type="button" class="icon-button small" data-reverse title="Inverter degradê">${icon('swap', 14)}</button></div>
      <div class="gradient-bar" style="${paintBackground({ ...g, kind: 'linear' })}">${stops.map((s, i) => `<button type="button" class="gradient-stop${i === this.gradientStop ? ' on' : ''}" data-stop="${i}" style="left:${s.offset * 100}%;background:${s.color}" aria-label="Parada ${i + 1}"></button>`).join('')}</div>
      <div class="row"><label class="field"><span>Cor</span><input type="text" data-stop-color value="${sel.color.slice(1)}" maxlength="7" style="width:70px;font-family:var(--mono)"></label>
        <label class="field"><span>Local</span><input type="number" min="0" max="100" data-stop-offset value="${Math.round(sel.offset * 100)}" style="width:52px"></label>
        <label class="field"><span>Opac.</span><input type="number" min="0" max="100" data-stop-opacity value="${Math.round((sel.opacity ?? 1) * 100)}" style="width:52px"></label></div>
      <div class="row"><button type="button" class="button" data-del ${stops.length <= 2 ? 'disabled' : ''}>Excluir parada</button><span class="muted">Clique na barra para somar paradas</span></div>`;
    const set = (label, mutate) => {
      const copy = JSON.parse(JSON.stringify(g));
      mutate(copy);
      this.setFocusPaint(copy, label);
    };
    body.querySelectorAll('[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.k === g.kind) return;
        const next = defaultGradient(b.dataset.k);
        next.stops = JSON.parse(JSON.stringify(g.stops));
        this.setFocusPaint(next, 'Tipo de degradê');
      }),
    );
    body.querySelector('[data-angle]')?.addEventListener('change', (e) => {
      const a = (-(Number(e.target.value) || 0) * Math.PI) / 180;
      set('Ângulo do degradê', (c) => Object.assign(c, { x1: 0.5 - Math.cos(a) / 2, y1: 0.5 - Math.sin(a) / 2, x2: 0.5 + Math.cos(a) / 2, y2: 0.5 + Math.sin(a) / 2 }));
    });
    body.querySelector('[data-reverse]').addEventListener('click', () => set('Inverter degradê', (c) => c.stops.forEach((s) => (s.offset = 1 - s.offset))));
    const bar = body.querySelector('.gradient-bar');
    bar.addEventListener('click', (e) => {
      if (e.target !== bar) return;
      const rect = bar.getBoundingClientRect();
      const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      set('Nova parada', (c) => {
        c.stops.push({ offset, color: sel.color, opacity: 1 });
        this.gradientStop = c.stops.length - 1;
      });
    });
    body.querySelectorAll('[data-stop]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const index = Number(btn.dataset.stop);
        this.gradientStop = index;
        btn.setPointerCapture(e.pointerId);
        let moved = false;
        const targets = this.styleTargets();
        if (targets.length) this.app.beginInteraction();
        const move = (ev) => {
          moved = true;
          const rect = bar.getBoundingClientRect();
          const offset = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          btn.style.left = `${offset * 100}%`;
          for (const t of targets) if (t.style[which]?.type === 'gradient' && t.style[which].stops[index]) t.style[which].stops[index].offset = offset;
          if (!targets.length && this.app.paint[which]?.type === 'gradient') this.app.paint[which].stops[index].offset = offset;
          this.app.updateInteraction();
        };
        const up = () => {
          btn.removeEventListener('pointermove', move);
          btn.removeEventListener('pointerup', up);
          if (this.app.interaction) {
            if (moved) this.app.endInteraction('Mover parada');
            else this.app.cancelInteraction();
          }
          this.render_gradient(body);
        };
        btn.addEventListener('pointermove', move);
        btn.addEventListener('pointerup', up);
      });
    });
    body.querySelector('[data-stop-color]').addEventListener('change', (e) => {
      const hex = normalizeHex(e.target.value);
      if (hex) set('Cor da parada', (c) => (c.stops[this.gradientStop].color = hex));
    });
    body.querySelector('[data-stop-offset]').addEventListener('change', (e) => set('Local da parada', (c) => (c.stops[this.gradientStop].offset = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)));
    body.querySelector('[data-stop-opacity]').addEventListener('change', (e) => set('Opacidade da parada', (c) => (c.stops[this.gradientStop].opacity = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)));
    body.querySelector('[data-del]').addEventListener('click', () =>
      set('Excluir parada', (c) => {
        c.stops.splice(this.gradientStop, 1);
        this.gradientStop = 0;
      }),
    );
  }

  render_stroke(body) {
    const item = this.primaryStyleItem();
    const s = item?.style || { strokeWidth: this.app.paint.strokeWidth, cap: this.app.paint.cap || 'butt', join: this.app.paint.join || 'miter', miterLimit: 10, dash: this.app.paint.dash || [], arrowStart: 'none', arrowEnd: 'none' };
    const dash = [...(s.dash || []), 0, 0, 0, 0, 0, 0].slice(0, 6);
    const arrows = [
      ['none', 'Nenhuma'],
      ['arrow', 'Seta'],
      ['circle', 'Círculo'],
      ['square', 'Quadrado'],
      ['bar', 'Barra'],
    ];
    body.innerHTML = `
      <div class="row"><label class="field"><span>Espessura</span><input type="number" min="0" step="0.25" data-s="width" value="${round(s.strokeWidth || 0)}" style="width:64px"></label></div>
      <div class="row"><span class="muted" style="min-width:64px">Ponta</span><div class="seg">${['butt', 'round', 'projecting'].map((c, i) => `<button type="button" data-cap="${c}" class="${s.cap === c ? 'on' : ''}" title="${['Reta', 'Arredondada', 'Projetada'][i]}">${icon(['capButt', 'capRound', 'capSquare'][i], 16)}</button>`).join('')}</div></div>
      <div class="row"><span class="muted" style="min-width:64px">Canto</span><div class="seg">${['miter', 'round', 'bevel'].map((c, i) => `<button type="button" data-join="${c}" class="${s.join === c ? 'on' : ''}" title="${['Pontudo', 'Arredondado', 'Chanfrado'][i]}">${icon(['joinMiter', 'joinRound', 'joinBevel'][i], 16)}</button>`).join('')}</div>
        <label class="field"><span>Limite</span><input type="number" min="1" max="500" data-s="miter" value="${round(s.miterLimit || 10)}" style="width:48px"></label></div>
      <div class="row"><label class="option"><input type="checkbox" data-s="dashed" ${s.dash?.some((d) => d > 0) ? 'checked' : ''}> Linha tracejada</label></div>
      <div class="grid2" style="grid-template-columns:repeat(6,1fr);gap:4px">${dash.map((d, i) => `<input type="number" min="0" step="0.5" data-dash="${i}" value="${d || ''}" placeholder="${i % 2 ? 'esp.' : 'traço'}" style="width:100%;box-sizing:border-box" aria-label="${i % 2 ? 'Espaço' : 'Traço'}">`).join('')}</div>
      <div class="row"><label class="field"><span>Início</span><select data-s="arrowStart">${arrows.map(([v, l]) => `<option value="${v}" ${s.arrowStart === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Fim</span><select data-s="arrowEnd">${arrows.map(([v, l]) => `<option value="${v}" ${s.arrowEnd === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`;
    body.querySelector('[data-s="width"]').addEventListener('change', (e) =>
      this.updateStyles('Espessura do traçado', (st) => {
        st.strokeWidth = Math.max(0, Number(e.target.value) || 0);
        if (st.strokeWidth > 0 && !st.stroke) st.stroke = { type: 'color', color: '#000000' };
      }),
    );
    body.querySelectorAll('[data-cap]').forEach((b) => b.addEventListener('click', () => this.updateStyles('Ponta do traçado', (st) => (st.cap = b.dataset.cap))));
    body.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => this.updateStyles('Canto do traçado', (st) => (st.join = b.dataset.join))));
    body.querySelector('[data-s="miter"]').addEventListener('change', (e) => this.updateStyles('Limite do canto', (st) => (st.miterLimit = Math.max(1, Number(e.target.value) || 10))));
    const readDash = () => [...body.querySelectorAll('[data-dash]')].map((i) => Math.max(0, Number(i.value) || 0));
    body.querySelector('[data-s="dashed"]').addEventListener('change', (e) =>
      this.updateStyles('Linha tracejada', (st) => {
        const values = readDash();
        st.dash = e.target.checked ? (values.some((v) => v > 0) ? trimDash(values) : [12, 6]) : [];
      }),
    );
    body.querySelectorAll('[data-dash]').forEach((i) => i.addEventListener('change', () => this.updateStyles('Tracejado', (st) => (st.dash = trimDash(readDash())))));
    for (const key of ['arrowStart', 'arrowEnd']) body.querySelector(`[data-s="${key}"]`).addEventListener('change', (e) => this.updateStyles('Pontas de seta', (st) => (st[key] = e.target.value)));
  }

  render_transparency(body) {
    const item = this.app.selectedItems()[0];
    const blend = item?.blend || 'normal';
    const names = {
      normal: 'Normal', multiply: 'Multiplicação', screen: 'Divisão', overlay: 'Sobrepor', darken: 'Escurecer', lighten: 'Clarear', 'color-dodge': 'Subexposição de cores', 'color-burn': 'Superexposição de cores',
      'hard-light': 'Luz direta', 'soft-light': 'Luz indireta', difference: 'Diferença', exclusion: 'Exclusão', hue: 'Matiz', saturation: 'Saturação', color: 'Cor', luminosity: 'Luminosidade',
    };
    body.innerHTML = `
      <div class="row"><select data-blend ${item ? '' : 'disabled'} aria-label="Modo de mesclagem" style="flex:1">${BLEND_MODES.map((m) => `<option value="${m}" ${m === blend ? 'selected' : ''}>${names[m]}</option>`).join('')}</select></div>
      <div class="row"><span class="muted" style="min-width:64px">Opacidade</span><input type="number" min="0" max="100" data-op value="${Math.round((item?.opacity ?? 1) * 100)}" ${item ? '' : 'disabled'} style="width:60px"> %</div>`;
    body.querySelector('[data-blend]').addEventListener('change', (e) => this.updateItems('Modo de mesclagem', (it) => (it.blend = e.target.value)));
    body.querySelector('[data-op]').addEventListener('change', (e) => this.updateItems('Opacidade', (it) => (it.opacity = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)));
  }

  render_align(body) {
    const count = this.app.selection.length;
    const buttons = (list) => list.map(([mode, ic, title]) => `<button type="button" class="icon-button small" data-mode="${mode}" title="${title}" aria-label="${title}">${icon(ic, 18)}</button>`).join('');
    body.innerHTML = `
      <div class="row"><span class="muted">Alinhar a</span><select data-to><option value="selection">Seleção</option><option value="key">Objeto-chave (último)</option><option value="artboard">Prancheta</option></select></div>
      <div class="row tight" data-group="align">${buttons([
        ['left', 'alignLeft', 'Alinhar à esquerda'], ['hcenter', 'alignHCenter', 'Centralizar na horizontal'], ['right', 'alignRight', 'Alinhar à direita'],
        ['top', 'alignTop', 'Alinhar acima'], ['vcenter', 'alignVCenter', 'Centralizar na vertical'], ['bottom', 'alignBottom', 'Alinhar abaixo'],
      ])}</div>
      <div class="row tight" data-group="distribute">${buttons([
        ['top', 'distTop', 'Distribuir pela borda de cima'], ['vcenter', 'distVCenter', 'Distribuir pelo centro vertical'], ['bottom', 'distBottom', 'Distribuir pela borda de baixo'],
        ['left', 'distLeft', 'Distribuir pela borda esquerda'], ['hcenter', 'distHCenter', 'Distribuir pelo centro horizontal'], ['right', 'distRight', 'Distribuir pela borda direita'],
      ])}</div>
      <div class="row tight" data-group="space">${buttons([
        ['vspace', 'spaceV', 'Distribuir espaçamento vertical'], ['hspace', 'spaceH', 'Distribuir espaçamento horizontal'],
      ])}<label class="field"><span>Espaço</span><input type="number" data-gap placeholder="auto" style="width:56px"></label></div>
      <p class="muted">${count ? `${count} objeto(s) selecionado(s).` : 'Selecione objetos para alinhar.'}</p>`;
    body.querySelector('[data-to]').value = this.alignTo;
    body.querySelector('[data-to]').addEventListener('change', (e) => (this.alignTo = e.target.value));
    body.querySelectorAll('[data-group] [data-mode]').forEach((b) => {
      const group = b.closest('[data-group]').dataset.group;
      b.addEventListener('click', () => {
        const gapRaw = body.querySelector('[data-gap]').value;
        this.ui.align(group, b.dataset.mode, this.alignTo, gapRaw === '' ? null : fromUnit(Number(gapRaw), this.app.doc.units));
      });
    });
  }

  render_pathfinder(body) {
    const btn = (op, ic, title) => `<button type="button" class="icon-button" data-op="${op}" title="${title}" aria-label="${title}">${icon(ic, 20)}</button>`;
    body.innerHTML = `
      <div class="muted">Modos de forma</div>
      <div class="row tight">${btn('unite', 'unite', 'Unir')}${btn('minusFront', 'minusFront', 'Menos frente')}${btn('intersect', 'intersect', 'Interseção')}${btn('exclude', 'exclude', 'Excluir sobreposição')}</div>
      <div class="muted">Pathfinders</div>
      <div class="row tight">${btn('divide', 'divide', 'Dividir')}${btn('trim', 'trim', 'Aparar')}${btn('merge', 'merge', 'Mesclar')}${btn('crop', 'crop', 'Cortar demarcação')}${btn('outline', 'outline', 'Contorno')}${btn('minusBack', 'minusBack', 'Menos fundo')}</div>`;
    body.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => this.pathfinder(b.dataset.op)));
  }

  pathfinder(op) {
    const ids = this.app.selection;
    if (ids.length < (op === 'unite' ? 1 : 2) && !['divide', 'outline', 'unite'].includes(op)) {
      this.app.toast('Selecione pelo menos dois objetos.');
      return;
    }
    if (!ids.length) return;
    const labels = { unite: 'Unir', minusFront: 'Menos frente', intersect: 'Interseção', exclude: 'Excluir sobreposição', divide: 'Dividir', trim: 'Aparar', merge: 'Mesclar', crop: 'Cortar demarcação', outline: 'Contorno', minusBack: 'Menos fundo' };
    const created = this.app.commit(labels[op], (doc) => applyPathfinder(doc, ids, op));
    if (created) this.app.select(created);
  }

  render_character(body) {
    const item = this.app.selectedItems().find((i) => i.type === 'text');
    const f = item ? { ...item.font, align: item.align } : this.app.textDefaults;
    const families = FONT_FAMILIES.includes(f.family) ? FONT_FAMILIES : [f.family, ...FONT_FAMILIES];
    const labelOf = (fam) => fam.split(',')[0].replace(/['"]/g, '');
    body.innerHTML = `
      <div class="row"><select data-f="family" style="flex:1" aria-label="Fonte">${families.map((fam) => `<option value="${esc(fam)}" ${fam === f.family ? 'selected' : ''}>${esc(labelOf(fam))}</option>`).join('')}</select></div>
      <div class="grid2">
        <label class="field"><span>Tam.</span><input type="number" min="1" step="0.5" data-f="size" value="${round(f.size)}"></label>
        <label class="field"><span>Peso</span><select data-f="weight">${[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => `<option value="${w}" ${w === f.weight ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        <label class="field"><span>Entrel.</span><input type="number" min="0.1" step="0.05" data-f="leading" value="${round(f.leading)}"></label>
        <label class="field"><span>Espac.</span><input type="number" step="10" data-f="tracking" value="${round(f.tracking)}"></label>
      </div>
      <div class="row"><label class="option"><input type="checkbox" data-f="italic" ${f.style === 'italic' ? 'checked' : ''}> Itálico</label></div>
      <div class="row"><div class="seg">${['left', 'center', 'right', 'justify'].map((a, i) => `<button type="button" data-align="${a}" class="${f.align === a ? 'on' : ''}" title="${['Esquerda', 'Centro', 'Direita', 'Justificar'][i]}">${icon(['textLeft', 'textCenter', 'textRight', 'textJustify'][i], 16)}</button>`).join('')}</div></div>`;
    const set = (label, fn) => {
      const texts = this.app.selectedItems().flatMap((i) => [...walk([i])].map((e) => e.item)).filter((i) => i.type === 'text');
      if (!texts.length) {
        const proxy = { font: this.app.textDefaults, align: this.app.textDefaults.align };
        fn(proxy);
        this.app.textDefaults.align = proxy.align;
        this.render_character(body);
        return;
      }
      this.app.commit(label, (doc) => {
        for (const t of texts) fn(findItem(doc, t.id).item);
      });
    };
    body.querySelector('[data-f="family"]').addEventListener('change', (e) => set('Fonte', (t) => (t.font.family = e.target.value)));
    body.querySelector('[data-f="size"]').addEventListener('change', (e) => set('Tamanho da fonte', (t) => (t.font.size = Math.max(1, Number(e.target.value) || 12))));
    body.querySelector('[data-f="weight"]').addEventListener('change', (e) => set('Peso da fonte', (t) => (t.font.weight = Number(e.target.value))));
    body.querySelector('[data-f="leading"]').addEventListener('change', (e) => set('Entrelinha', (t) => (t.font.leading = Math.max(0.1, Number(e.target.value) || 1.2))));
    body.querySelector('[data-f="tracking"]').addEventListener('change', (e) => set('Espaçamento', (t) => (t.font.tracking = Number(e.target.value) || 0)));
    body.querySelector('[data-f="italic"]').addEventListener('change', (e) => set('Itálico', (t) => (t.font.style = e.target.checked ? 'italic' : 'normal')));
    body.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => set('Alinhamento do texto', (t) => (t.align = b.dataset.align))));
  }

  render_symbols(body) {
    const doc = this.app.doc;
    const selectedInstance = this.app.selectedItems().find((i) => i.type === 'instance');
    body.innerHTML = `
      <div class="list">${doc.symbols.length ? doc.symbols.map((s) => `<div class="list-row${this.app.toolOptions.symbol === s.id ? ' on' : ''}" data-sym="${s.id}"><span class="grow">${esc(s.name)}</span><button type="button" class="icon-button small" data-place="${s.id}" title="Inserir na prancheta">${icon('plus', 14)}</button><button type="button" class="icon-button small" data-del="${s.id}" title="Excluir símbolo">${icon('trash', 14)}</button></div>`).join('') : '<div class="list-row muted">Nenhum símbolo ainda.</div>'}</div>
      <div class="row"><button type="button" class="button" data-new ${this.app.selection.length ? '' : 'disabled'}>Novo símbolo</button><button type="button" class="button" data-break ${selectedInstance ? '' : 'disabled'}>Quebrar vínculo</button></div>`;
    body.querySelector('[data-new]').addEventListener('click', () =>
      this.ui.dialogs.prompt('Novo símbolo', 'Nome', `Símbolo ${doc.symbols.length + 1}`, (name) => {
        const result = this.app.commit('Novo símbolo', (d) => defineSymbol(d, this.app.selection, name || 'Símbolo'));
        if (result) this.app.select([result.instance.id]);
      }),
    );
    body.querySelector('[data-break]').addEventListener('click', () => {
      const id = this.app.commit('Quebrar vínculo com símbolo', (d) => expandInstance(d, selectedInstance.id));
      if (id) this.app.select([id]);
    });
    body.querySelectorAll('[data-place]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = doc.artboards[this.app.active.activeArtboard];
        this.ui.tools.placeSymbol(b.dataset.place, { x: a.x + a.width / 2, y: a.y + a.height / 2 });
      }),
    );
    body.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.commit('Excluir símbolo', (d) => {
          for (const inst of [...this.app.allItems()].filter((i) => i.type === 'instance' && i.symbol === b.dataset.del)) expandInstance(d, inst.id);
          d.symbols = d.symbols.filter((s) => s.id !== b.dataset.del);
        });
      }),
    );
  }

  render_artboards(body) {
    const doc = this.app.doc;
    const unit = doc.units;
    body.innerHTML = `<div class="list">${doc.artboards
      .map((a, i) => `<div class="list-row${i === this.app.active.activeArtboard ? ' on' : ''}" data-ab="${i}"><span class="mono">${i + 1}</span><span class="grow" data-rename="${i}">${esc(a.name)}</span><span class="muted">${toUnit(a.width, unit)}×${toUnit(a.height, unit)}</span></div>`)
      .join('')}</div>
      <div class="row"><button type="button" class="icon-button small" data-a="add" title="Nova prancheta">${icon('plus', 16)}</button>
      <button type="button" class="icon-button small" data-a="up" title="Mover para cima">${icon('chevron', 16)}</button>
      <button type="button" class="icon-button small" data-a="del" title="Excluir prancheta" ${doc.artboards.length < 2 ? 'disabled' : ''}>${icon('trash', 16)}</button>
      <button type="button" class="button" data-a="fit">Ajustar à arte</button><button type="button" class="button" data-a="setup">Opções…</button></div>`;
    body.querySelectorAll('[data-ab]').forEach((row) => {
      row.addEventListener('click', () => {
        this.app.active.activeArtboard = Number(row.dataset.ab);
        this.ui.viewport.fitArtboard();
        this.app.emit('selection');
        this.app.invalidate('all');
      });
      row.addEventListener('dblclick', () => this.ui.dialogs.artboardDialog(Number(row.dataset.ab)));
    });
    body.querySelector('[data-a="add"]').addEventListener('click', () => this.ui.menus.run('artboard.new'));
    body.querySelector('[data-a="del"]').addEventListener('click', () => this.ui.menus.run('artboard.delete'));
    body.querySelector('[data-a="fit"]').addEventListener('click', () => this.ui.menus.run('artboard.fit'));
    body.querySelector('[data-a="setup"]').addEventListener('click', () => this.ui.dialogs.artboardDialog(this.app.active.activeArtboard));
    body.querySelector('[data-a="up"]').addEventListener('click', () => {
      const i = this.app.active.activeArtboard;
      if (i < 1) return;
      this.app.commit('Reordenar pranchetas', (d) => {
        [d.artboards[i - 1], d.artboards[i]] = [d.artboards[i], d.artboards[i - 1]];
      });
      this.app.active.activeArtboard = i - 1;
    });
  }

  render_layers(body) {
    const doc = this.app.doc;
    const selected = new Set(this.app.selection);
    const rows = [];
    const visit = (items, depth, parentLocked) => {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        const isLayer = item.type === 'layer';
        const container = item.children && (isLayer || item.type === 'group');
        const open = this.layerOpen.has(item.id) || (isLayer && !this.layerOpen.has(`${item.id}:closed`) && !this.layerOpen.has(item.id) && depth === 0 && false);
        const expanded = isLayer ? !this.layerOpen.has(`${item.id}:closed`) : open;
        const color = isLayer ? item.color : findItem(doc, item.id)?.layer?.color || '#4f7cff';
        rows.push(`<div class="layer-row${isLayer ? ' layer' : ''}${selected.has(item.id) ? ' selected' : ''}${isLayer && item.id === this.app.active.activeLayer ? ' current' : ''}" data-id="${item.id}" draggable="true" style="padding-left:${depth * 12}px">
          <button type="button" data-vis class="${item.visible === false ? 'off' : ''}" title="Mostrar/ocultar">${icon(item.visible === false ? 'eyeOff' : 'eye', 14)}</button>
          <button type="button" data-lock class="${item.locked ? '' : 'off'}" title="Travar/destravar">${icon(item.locked ? 'lock' : 'unlock', 14)}</button>
          ${container ? `<button type="button" data-open title="Expandir">${icon(expanded ? 'chevron' : 'chevronRight', 12)}</button>` : '<span></span>'}
          <span class="name" data-name>${isLayer ? '' : `<i class="dot" style="display:inline-block;margin-right:6px;background:${color}"></i>`}${esc(itemLabel(item))}</span>
          <span class="target" data-target title="Selecionar"></span></div>`);
        if (container && expanded) visit(item.children, depth + 1, parentLocked || item.locked);
      }
    };
    visit(doc.layers, 0, false);
    body.innerHTML = `<div class="layers">${rows.join('')}</div>
      <div class="row"><span class="muted grow">${doc.layers.length} camada(s)</span>
        <button type="button" class="icon-button small" data-a="new" title="Nova camada">${icon('layerAdd', 16)}</button>
        <button type="button" class="icon-button small" data-a="group" title="Agrupar seleção">${icon('folder', 16)}</button>
        <button type="button" class="icon-button small" data-a="dup" title="Duplicar">${icon('symbol', 16)}</button>
        <button type="button" class="icon-button small" data-a="color" title="Cor da camada">${icon('palette', 16)}</button>
        <button type="button" class="icon-button small" data-a="del" title="Excluir">${icon('trash', 16)}</button></div>`;
    const list = body.querySelector('.layers');
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.layer-row');
      if (!row) return;
      const id = row.dataset.id;
      const entry = findItem(this.app.doc, id);
      if (!entry) return;
      if (e.target.closest('[data-vis]')) {
        this.app.commit(entry.item.visible === false ? 'Mostrar' : 'Ocultar', (d) => {
          const it = findItem(d, id).item;
          it.visible = it.visible === false;
        });
        return;
      }
      if (e.target.closest('[data-lock]')) {
        this.app.commit(entry.item.locked ? 'Destravar' : 'Travar', (d) => {
          const it = findItem(d, id).item;
          it.locked = !it.locked;
        });
        return;
      }
      if (e.target.closest('[data-open]')) {
        if (entry.item.type === 'layer') {
          const key = `${id}:closed`;
          if (this.layerOpen.has(key)) this.layerOpen.delete(key);
          else this.layerOpen.add(key);
        } else if (this.layerOpen.has(id)) this.layerOpen.delete(id);
        else this.layerOpen.add(id);
        this.render_layers(body);
        return;
      }
      if (entry.item.type === 'layer') {
        this.app.active.activeLayer = id;
        if (e.target.closest('[data-target]')) this.app.select(entry.item.children.map((c) => c.id));
        else this.render_layers(body);
        return;
      }
      this.app.select([id], { toggle: e.shiftKey || e.ctrlKey || e.metaKey });
    });
    list.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.layer-row');
      if (!row || !e.target.closest('[data-name]')) return;
      const entry = findItem(this.app.doc, row.dataset.id);
      if (!entry) return;
      this.ui.dialogs.prompt(entry.item.type === 'layer' ? 'Opções de camada' : 'Renomear', 'Nome', entry.item.name || itemLabel(entry.item), (name) =>
        this.app.commit('Renomear', (d) => {
          findItem(d, row.dataset.id).item.name = String(name).slice(0, 120);
        }),
      );
    });
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.layer-row');
      if (!row) return;
      this.dragRow = row.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.id);
    });
    list.addEventListener('dragover', (e) => {
      const row = e.target.closest('.layer-row');
      if (!row || !this.dragRow) return;
      e.preventDefault();
      list.querySelectorAll('.drop-before,.drop-into').forEach((r) => r.classList.remove('drop-before', 'drop-into'));
      const rect = row.getBoundingClientRect();
      const target = findItem(this.app.doc, row.dataset.id)?.item;
      const into = target && (target.type === 'layer' || target.type === 'group') && e.clientY > rect.top + rect.height * 0.3 && e.clientY < rect.top + rect.height * 0.7;
      row.classList.add(into ? 'drop-into' : 'drop-before');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const row = e.target.closest('.layer-row');
      const source = this.dragRow;
      this.dragRow = null;
      if (!row || !source || row.dataset.id === source) return;
      const into = row.classList.contains('drop-into');
      this.moveInLayers(source, row.dataset.id, into);
    });
    list.addEventListener('dragend', () => {
      this.dragRow = null;
      list.querySelectorAll('.drop-before,.drop-into').forEach((r) => r.classList.remove('drop-before', 'drop-into'));
    });
    body.querySelector('[data-a="new"]').addEventListener('click', () =>
      this.app.commit('Nova camada', (d) => {
        const layer = createLayer(`Camada ${d.layers.length + 1}`, d.layers.length);
        const index = d.layers.findIndex((l) => l.id === this.app.active.activeLayer);
        d.layers.splice(index + 1, 0, layer);
        this.app.active.activeLayer = layer.id;
      }),
    );
    body.querySelector('[data-a="group"]').addEventListener('click', () => this.ui.menus.run('object.group'));
    body.querySelector('[data-a="dup"]').addEventListener('click', () => this.ui.menus.run('edit.duplicate'));
    body.querySelector('[data-a="color"]').addEventListener('click', () =>
      this.app.commit('Cor da camada', (d) => {
        const layer = d.layers.find((l) => l.id === this.app.active.activeLayer);
        if (layer) layer.color = LAYER_COLORS[(LAYER_COLORS.indexOf(layer.color) + 1) % LAYER_COLORS.length];
      }),
    );
    body.querySelector('[data-a="del"]').addEventListener('click', () => {
      if (this.app.selection.length) {
        this.ui.menus.run('edit.clear');
        return;
      }
      if (this.app.doc.layers.length < 2) {
        this.app.toast('O documento precisa de pelo menos uma camada.');
        return;
      }
      this.app.commit('Excluir camada', (d) => {
        d.layers = d.layers.filter((l) => l.id !== this.app.active.activeLayer);
      });
    });
  }

  moveInLayers(sourceId, targetId, into) {
    this.app.commit('Reorganizar camadas', (doc) => {
      const source = findItem(doc, sourceId);
      const target = findItem(doc, targetId);
      if (!source || !target) return;
      if (source.item.type === 'layer') {
        if (target.item.type !== 'layer') return;
        const from = doc.layers.indexOf(source.item);
        doc.layers.splice(from, 1);
        const to = doc.layers.indexOf(target.item);
        doc.layers.splice(to + 1, 0, source.item);
        return;
      }
      if (target.item.id === source.item.id || [...walk(source.item.children || [])].some((e) => e.item.id === targetId)) return;
      source.siblings.splice(source.index, 1);
      if (into) {
        target.item.children.push(source.item);
        return;
      }
      const fresh = findItem(doc, targetId);
      if (fresh.item.type === 'layer') {
        fresh.item.children.push(source.item);
        return;
      }
      fresh.siblings.splice(fresh.index + 1, 0, source.item);
    });
  }
}

function trimDash(values) {
  const list = [...values];
  while (list.length && !list[list.length - 1]) list.pop();
  if (list.length % 2) list.push(list[list.length - 1]);
  return list.filter((v, i) => i < 6);
}

