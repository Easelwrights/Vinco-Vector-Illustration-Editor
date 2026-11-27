import { App } from './ui/app.js';
import { Viewport } from './ui/viewport.js';
import { ToolManager, TOOLS } from './ui/tools.js';
import { Panels } from './ui/panels.js';
import { Dialogs } from './ui/dialogs.js';
import { Menus } from './ui/menus.js';
import { IO } from './ui/io.js';
import { Tutorial } from './ui/tutorial.js';
import { icon, logo } from './ui/icons.js';
import { alignOffsets, distributeOffsets, findItem, itemBounds, moveItems, orderIds, transformItem, walk, cloneItem, solid } from './core/document.js';
import { paintColor } from './core/color.js';
import { isEmptyBounds, reflection, rotation } from './core/geometry.js';
import { fromUnit, toUnit } from './core/snap.js';
import { parseDocument } from './core/format.js';

const VERSION = '1.0.0';

const PALETTES = [
  { id: '1', colors: ['#e6ddce', '#5d1c16', '#a3b4be', '#f6e4a6'] },
  { id: '2', colors: ['#f5f4f4', '#000000', '#3e6b2a', '#9b2f1e'] },
  { id: '3', colors: ['#f3f1ec', '#17212b', '#e3ecef', '#a8235a'] },
  { id: '4', colors: ['#e8e8e8', '#d9d1ce', '#ab9d9d', '#000000'] },
];

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paintCss = (p) => {
  if (!p) return '';
  if (p.type === 'color') return `background:${p.color}`;
  const stops = [...p.stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(',');
  return `background:${p.kind === 'radial' ? `radial-gradient(${stops})` : `linear-gradient(90deg,${stops})`}`;
};

class UI {
  constructor() {
    this.version = VERSION;
    this.app = new App();
    this.applyTheme();
    this.dialogs = new Dialogs(this.app, this);
    this.viewport = new Viewport(this.app);
    this.tools = new ToolManager(this.app, this.viewport, this);
    this.panels = new Panels(this.app, this);
    this.io = new IO(this.app, this);
    this.menus = new Menus(this);
    this.tutorial = new Tutorial(this.app);
    this.buildChrome();
    this.app.on('tabs', () => this.renderTabs());
    this.app.on('paint', () => this.renderPaintWidget());
    this.app.on('status', (message) => {
      document.getElementById('status-storage').textContent = message;
    });
    let lastTab = null;
    this.app.on('render', () => {
      if (this.app.active && lastTab !== this.app.active.id) {
        lastTab = this.app.active.id;
        this.viewport.resetCache();
      }
    });
    this.app.on('selection', () => {
      const t = this.app.selectedItems().find((i) => i.type === 'text');
      if (t) Object.assign(this.app.textDefaults, { ...t.font, align: t.align });
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.app.tabs.some((t) => t.dirty)) {
        this.io.saveDrafts().catch(() => undefined);
        e.preventDefault();
      }
    });
  }

  applyTheme() {
    document.documentElement.dataset.theme = this.app.prefs.theme;
    if (this.app.prefs.palette === '1') delete document.documentElement.dataset.palette;
    else document.documentElement.dataset.palette = this.app.prefs.palette;
  }

  setTheme(theme) {
    this.app.setPref('theme', theme);
    this.applyTheme();
    document.getElementById('theme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    this.viewport.renderRulers();
  }

  setPalette(id) {
    this.app.setPref('palette', id);
    this.applyTheme();
    this.viewport.renderRulers();
  }

  buildChrome() {
    document.getElementById('logo').innerHTML = logo();
    const set = (id, name, run) => {
      const b = document.getElementById(id);
      b.innerHTML = icon(name);
      b.addEventListener('click', run);
      return b;
    };
    set('undo', 'undo', () => this.menus.run('edit.undo'));
    set('redo', 'redo', () => this.menus.run('edit.redo'));
    set('save', 'save', () => this.menus.run('file.save'));
    set('theme', this.app.prefs.theme === 'dark' ? 'sun' : 'moon', () => this.setTheme(this.app.prefs.theme === 'dark' ? 'light' : 'dark'));
    const palette = set('palette', 'palette', () => {
      this.menus.openCustom(
        palette,
        PALETTES.map((p, i) => ({
          label: `<span class="palette-swatches" aria-label="Paleta ${i + 1}">${p.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`,
          html: `<span class="check">${this.app.prefs.palette === p.id ? '✓' : ''}</span>`,
          run: () => this.setPalette(p.id),
        })),
      );
      this.menus.openMenu.menu.style.left = `${Math.max(4, palette.getBoundingClientRect().right - 200)}px`;
      this.menus.openMenu.menu.style.minWidth = '200px';
    });
    const undo = document.getElementById('undo');
    const redo = document.getElementById('redo');
    const sync = () => {
      const h = this.app.active?.history;
      undo.disabled = !h?.canUndo;
      redo.disabled = !h?.canRedo;
      undo.title = h?.canUndo ? `Desfazer ${h.undoLabel} (Ctrl+Z)` : 'Desfazer (Ctrl+Z)';
      redo.title = h?.canRedo ? `Refazer ${h.redoLabel} (Ctrl+Shift+Z)` : 'Refazer (Ctrl+Shift+Z)';
    };
    this.app.on('change', sync);
    this.app.on('tabs', sync);
    const name = document.getElementById('doc-name');
    name.addEventListener('change', () => {
      const value = name.value.trim().slice(0, 120) || 'Sem título';
      this.app.commit('Renomear documento', (doc) => {
        doc.name = value;
      });
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });
    const toolsEl = document.getElementById('tools');
    this.tools.renderToolbar(toolsEl);
    this.paintWidget = document.createElement('div');
    this.paintWidget.className = 'paint-widget';
    toolsEl.append(this.paintWidget);
    this.renderPaintWidget();
    const host = this.viewport.host;
    host.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    });
    host.addEventListener('drop', async (e) => {
      e.preventDefault();
      for (const file of e.dataTransfer?.files || []) {
        const lower = file.name.toLowerCase();
        await this.io.openFile(file, { place: !(lower.endsWith('.vinco') || lower.endsWith('.json')) });
      }
    });
    this.app.on('tool', () => this.renderOptions());
  }

  renderPaintWidget() {
    const w = this.paintWidget;
    if (!w || !this.app.active) return;
    const item = this.panels.primaryStyleItem();
    const fill = item ? item.style.fill : this.app.paint.fill;
    const stroke = item ? item.style.stroke : this.app.paint.stroke;
    const focus = this.app.paint.focus;
    w.innerHTML = `
      <button type="button" class="paint-square fill${fill ? '' : ' none'}${focus === 'fill' ? ' front' : ''}" style="${paintCss(fill)}" title="Preenchimento (X)" aria-label="Preenchimento"></button>
      <button type="button" class="paint-square stroke${stroke ? '' : ' none'}${focus === 'stroke' ? ' front' : ''}" style="${paintCss(stroke)}" title="Traçado (X)" aria-label="Traçado"></button>
      <button type="button" class="paint-mini swap" title="Trocar preenchimento e traçado (Shift+X)" aria-label="Trocar">${icon('swap', 14)}</button>
      <button type="button" class="paint-mini reset" title="Preenchimento e traçado padrão (D)" aria-label="Padrão">${icon('reset', 12)}</button>
      <div class="paint-modes">
        <button type="button" data-mode="color" title="Cor (,)" style="background:${paintColor(focus === 'fill' ? fill : stroke) || '#000'}" aria-label="Cor"></button>
        <button type="button" data-mode="gradient" title="Degradê (.)" style="background:linear-gradient(90deg,#fff,#000)" aria-label="Degradê"></button>
        <button type="button" data-mode="none" class="swatch none" title="Nenhum (/)" aria-label="Nenhum"></button>
      </div>`;
    w.querySelector('.fill').addEventListener('click', () => {
      if (this.app.paint.focus === 'fill') this.panels.showPanel('color');
      this.app.paint.focus = 'fill';
      this.app.emit('paint');
    });
    w.querySelector('.stroke').addEventListener('click', () => {
      if (this.app.paint.focus === 'stroke') this.panels.showPanel('color');
      this.app.paint.focus = 'stroke';
      this.app.emit('paint');
    });
    w.querySelector('.swap').addEventListener('click', () => this.swapPaint());
    w.querySelector('.reset').addEventListener('click', () => this.defaultPaint());
    w.querySelector('[data-mode="color"]').addEventListener('click', () => this.applyPaint(focus, solid(paintColor(focus === 'fill' ? fill : stroke) || '#000000')));
    w.querySelector('[data-mode="gradient"]').addEventListener('click', () => this.panels.showPanel('gradient'));
    w.querySelector('[data-mode="none"]').addEventListener('click', () => this.applyPaint(focus, null));
  }

  applyPaint(which, paint) {
    this.app.paint.focus = which;
    this.panels.setFocusPaint(paint, paint ? 'Cor' : 'Nenhum');
  }

  defaultPaint() {
    this.panels.updateStyles('Cores padrão', (style) => {
      style.fill = solid('#ffffff');
      style.stroke = solid('#000000');
      if (!(style.strokeWidth > 0)) style.strokeWidth = 1;
    });
  }

  swapPaint() {
    this.panels.updateStyles('Trocar preenchimento e traçado', (style) => {
      const f = style.fill;
      style.fill = style.stroke;
      style.stroke = f;
      if (style.stroke && !(style.strokeWidth > 0)) style.strokeWidth = 1;
    });
  }

  toDocUnits(value) {
    return fromUnit(Number(value) || 0, this.app.doc.units);
  }

  renderOptions() {
    const bar = document.getElementById('options');
    if (!bar || !this.app.active) return;
    if (bar.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const app = this.app;
    const tool = TOOLS.find((t) => t.id === app.tool);
    const items = app.selectedItems();
    const item = this.panels.primaryStyleItem();
    const unit = app.doc.units;
    const parts = [`<span class="tool-name">${esc(tool?.label || '')}</span>`];
    const fill = item ? item.style.fill : app.paint.fill;
    const stroke = item ? item.style.stroke : app.paint.stroke;
    const sw = item ? item.style.strokeWidth : app.paint.strokeWidth;
    parts.push(`<span class="option">Preench. <button type="button" class="chip${fill ? '' : ' swatch none'}" data-o="fill" style="${paintCss(fill)}" aria-label="Preenchimento"></button></span>`);
    parts.push(`<span class="option">Traçado <button type="button" class="chip${stroke ? '' : ' swatch none'}" data-o="stroke" style="${paintCss(stroke)}" aria-label="Traçado"></button><input type="number" min="0" step="0.25" data-o="sw" value="${Math.round((stroke ? sw : 0) * 100) / 100}" style="width:56px" aria-label="Espessura"></span>`);
    if (items.length) {
      parts.push(`<span class="option">Opacidade <input type="number" min="0" max="100" data-o="op" value="${Math.round((items[0].opacity ?? 1) * 100)}" style="width:52px">%</span>`);
      const b = app.selectionBounds();
      if (b) {
        parts.push(`<span class="option">X <input type="number" step="any" data-o="x" value="${toUnit(b.minX, unit)}" style="width:70px"></span>`);
        parts.push(`<span class="option">Y <input type="number" step="any" data-o="y" value="${toUnit(b.minY, unit)}" style="width:70px"></span>`);
        parts.push(`<span class="option">L <input type="number" step="any" min="0" data-o="w" value="${toUnit(b.maxX - b.minX, unit)}" style="width:70px"></span>`);
        parts.push(`<span class="option">A <input type="number" step="any" min="0" data-o="h" value="${toUnit(b.maxY - b.minY, unit)}" style="width:70px"></span>`);
      }
      if (items.length > 1) parts.push(`<span class="option">${['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map((m, i) => `<button type="button" class="icon-button small" data-align="${m}" title="Alinhar">${icon(['alignLeft', 'alignHCenter', 'alignRight', 'alignTop', 'alignVCenter', 'alignBottom'][i], 16)}</button>`).join('')}</span>`);
    }
    const o = app.toolOptions;
    const num = (key, label, value, extra = '') => `<span class="option">${label} <input type="number" data-t="${key}" value="${value}" style="width:58px" ${extra}></span>`;
    const toolOptions = {
      roundRect: num('cornerRadius', 'Raio', o.cornerRadius, 'min="0"'),
      polygon: num('sides', 'Lados', o.sides, 'min="3" max="100"'),
      star: num('points', 'Pontas', o.points, 'min="3" max="100"') + num('innerRatio', 'Raio interno', o.innerRatio, 'min="0.05" max="0.99" step="0.05"'),
      spiral: num('spiralDecay', 'Decaimento', o.spiralDecay, 'min="0.05" max="0.99" step="0.05"') + num('spiralTurns', 'Segmentos', o.spiralTurns, 'min="2" max="200"'),
      grid: num('gridColumns', 'Colunas', o.gridColumns, 'min="1" max="100"') + num('gridRows', 'Linhas', o.gridRows, 'min="1" max="100"'),
      brush: num('brushSize', 'Espessura', o.brushSize, 'min="0.1" step="0.5"'),
      blob: num('blobSize', 'Tamanho', o.blobSize, 'min="1"'),
      eraser: num('eraserSize', 'Tamanho', o.eraserSize, 'min="1"'),
      pencil: num('pencilFidelity', 'Fidelidade', o.pencilFidelity, 'min="0.5" step="0.5"') + `<label class="option"><input type="checkbox" data-t="pencilClose" ${o.pencilClose ? 'checked' : ''}> Fechar caminhos</label>`,
      wand: num('wandTolerance', 'Tolerância', o.wandTolerance, 'min="0" max="255"'),
      blend: num('blendSteps', 'Etapas', o.blendSteps, 'min="1" max="200"'),
    };
    if (toolOptions[app.tool]) parts.push(toolOptions[app.tool]);
    if (app.active.isolation) parts.push('<button type="button" class="button" data-o="isolation">Sair do isolamento</button>');
    bar.innerHTML = parts.join('');
    bar.querySelectorAll('[data-o="fill"], [data-o="stroke"]').forEach((b) =>
      b.addEventListener('click', () => {
        app.paint.focus = b.dataset.o;
        app.emit('paint');
        this.panels.showPanel('color');
      }),
    );
    bar.querySelector('[data-o="sw"]')?.addEventListener('change', (e) =>
      this.panels.updateStyles('Espessura do traçado', (style) => {
        style.strokeWidth = Math.max(0, Number(e.target.value) || 0);
        if (style.strokeWidth > 0 && !style.stroke) style.stroke = solid('#000000');
      }),
    );
    bar.querySelector('[data-o="op"]')?.addEventListener('change', (e) => this.panels.updateItems('Opacidade', (it) => (it.opacity = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100)));
    for (const key of ['x', 'y', 'w', 'h']) {
      bar.querySelector(`[data-o="${key}"]`)?.addEventListener('change', (e) => {
        const b = app.selectionBounds();
        if (!b) return;
        const v = fromUnit(Number(e.target.value) || 0, unit);
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        let m;
        if (key === 'x') m = [1, 0, 0, 1, v - b.minX, 0];
        if (key === 'y') m = [1, 0, 0, 1, 0, v - b.minY];
        if (key === 'w' && w > 0) m = [Math.max(0.01, v) / w, 0, 0, 1, b.minX - (b.minX * Math.max(0.01, v)) / w, 0];
        if (key === 'h' && h > 0) m = [1, 0, 0, Math.max(0.01, v) / h, 0, b.minY - (b.minY * Math.max(0.01, v)) / h];
        if (m) this.transformSelection(m, 'Transformar');
      });
    }
    bar.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => this.align('align', b.dataset.align, 'selection')));
    bar.querySelectorAll('[data-t]').forEach((input) =>
      input.addEventListener('change', () => {
        o[input.dataset.t] = input.type === 'checkbox' ? input.checked : Math.max(0, Number(input.value) || 0);
        o.sides = Math.max(3, Math.round(o.sides));
        o.points = Math.max(3, Math.round(o.points));
        o.innerRatio = Math.min(0.99, Math.max(0.05, o.innerRatio));
        o.spiralDecay = Math.min(0.99, Math.max(0.05, o.spiralDecay));
      }),
    );
    bar.querySelector('[data-o="isolation"]')?.addEventListener('click', () => this.tools.exitIsolation());
  }

  renderTabs() {
    const bar = document.getElementById('doc-tabs');
    const app = this.app;
    bar.innerHTML = app.tabs.map((t) => `<div class="doc-tab${t === app.active ? ' active' : ''}" role="tab" aria-selected="${t === app.active}" data-tab="${t.id}"><span>${esc(t.doc.name)}${t.dirty ? ' •' : ''}</span><button type="button" data-close="${t.id}" aria-label="Fechar documento" title="Fechar">${icon('close', 12)}</button></div>`).join('');
    bar.querySelectorAll('[data-tab]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) return;
        app.activate(el.dataset.tab);
      }),
    );
    bar.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeTab(b.dataset.close)));
    const name = document.getElementById('doc-name');
    if (document.activeElement !== name && app.doc) name.value = app.doc.name;
    document.title = app.doc ? `${app.doc.name}${app.active.dirty ? ' •' : ''} — Vinco` : 'Vinco';
  }

  closeTab(id) {
    const tab = this.app.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      this.dialogs.open('Fechar documento', `<p>"${esc(tab.doc.name)}" tem alterações que não foram salvas.</p>`, {
        actions: [
          { label: 'Cancelar' },
          { label: 'Fechar sem salvar', run: () => this.app.closeTab(id) },
          {
            label: 'Salvar',
            primary: true,
            run: () => {
              this.app.activate(id);
              this.io.save(false).then((ok) => ok && this.app.closeTab(id));
            },
          },
        ],
      });
      return;
    }
    this.app.closeTab(id);
    this.io.saveDrafts().catch(() => undefined);
  }

  transformSelection(m, label, { copy = false, scaleStrokes } = {}) {
    const app = this.app;
    if (!app.selection.length) return;
    const strokes = scaleStrokes ?? app.prefs.scaleStrokes;
    const ids = app.commit(label, (doc) => {
      const result = [];
      for (const id of orderIds(doc, app.selection)) {
        const entry = findItem(doc, id);
        if (!entry) continue;
        let target = entry.item;
        if (copy) {
          target = cloneItem(entry.item);
          entry.siblings.splice(entry.siblings.indexOf(entry.item) + 1, 0, target);
        }
        transformItem(target, m, { scaleStrokes: strokes });
        result.push(target.id);
      }
      return result;
    });
    app.lastTransform = { matrix: m, copy };
    if (ids) app.select(ids);
  }

  flip(axis) {
    const b = this.app.selectionBounds();
    if (!b) return;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.transformSelection(axis === 'h' ? reflection(Math.PI / 2, cx, cy) : reflection(0, cx, cy), axis === 'h' ? 'Refletir na horizontal' : 'Refletir na vertical');
  }

  rotateBy(degrees) {
    const b = this.app.selectionBounds();
    if (!b) return;
    this.transformSelection(rotation((degrees * Math.PI) / 180, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2), 'Girar');
  }

  align(group, mode, to, gap = null) {
    const app = this.app;
    const items = app.selectedItems();
    if (!items.length) return;
    const doc = app.doc;
    const rects = items.map((i) => itemBounds(i, doc));
    if (rects.some(isEmptyBounds)) return;
    let offsets;
    if (group === 'align') {
      let reference;
      if (to === 'artboard' || items.length === 1) {
        const a = doc.artboards[app.active.activeArtboard];
        reference = { minX: a.x, minY: a.y, maxX: a.x + a.width, maxY: a.y + a.height };
      } else if (to === 'key') reference = rects[rects.length - 1];
      else reference = rects.reduce((acc, r) => ({ minX: Math.min(acc.minX, r.minX), minY: Math.min(acc.minY, r.minY), maxX: Math.max(acc.maxX, r.maxX), maxY: Math.max(acc.maxY, r.maxY) }));
      offsets = alignOffsets(rects, mode, reference);
    } else {
      if (items.length < 2) return;
      offsets = distributeOffsets(rects, mode, group === 'space' ? gap : null);
    }
    const ids = items.map((i) => i.id);
    app.commit(group === 'align' ? 'Alinhar' : 'Distribuir', (d) => {
      ids.forEach((id, k) => {
        const item = findItem(d, id)?.item;
        if (item && (offsets[k].dx || offsets[k].dy)) moveItems([item], offsets[k].dx, offsets[k].dy);
      });
    });
  }

  applyEffect(effect, index = null) {
    const app = this.app;
    const geometric = ['roundCorners', 'zigZag', 'roughen', 'puckerBloat'].includes(effect.type);
    app.commit(index === null ? 'Aplicar efeito' : 'Editar efeito', (doc) => {
      for (const id of app.selection) {
        const item = findItem(doc, id)?.item;
        if (!item) continue;
        const targets = geometric && item.type === 'group' ? [...walk(item.children)].map((e) => e.item).filter((i) => i.type === 'path') : [item];
        for (const t of targets) {
          t.effects = t.effects || [];
          if (index !== null && t === item) t.effects[index] = { ...effect };
          else t.effects.push({ ...effect });
        }
      }
    });
  }

  setTextAlign(align) {
    this.panels.showPanel('character');
    const texts = this.app.selectedItems().flatMap((i) => [...walk([i])].map((e) => e.item)).filter((i) => i.type === 'text');
    this.app.textDefaults.align = align;
    if (!texts.length) return;
    this.app.commit('Alinhamento do texto', (doc) => texts.forEach((t) => (findItem(doc, t.id).item.align = align)));
  }

  changeFontSize(delta) {
    const texts = this.app.selectedItems().flatMap((i) => [...walk([i])].map((e) => e.item)).filter((i) => i.type === 'text');
    if (!texts.length) return;
    this.app.commit('Tamanho da fonte', (doc) => texts.forEach((t) => {
      const it = findItem(doc, t.id).item;
      it.font.size = Math.max(1, it.font.size + delta);
    }));
  }

  toggleAreaText() {
    const text = this.app.selectedItems().find((i) => i.type === 'text');
    if (!text || text.onPath) return;
    this.app.commit('Converter texto', (doc) => {
      const it = findItem(doc, text.id).item;
      if (it.area) {
        it.matrix = [it.matrix[0], it.matrix[1], it.matrix[2], it.matrix[3], it.matrix[4], it.matrix[5] + it.font.size];
        it.area = null;
      } else {
        const b = itemBounds(it, doc);
        it.matrix = [1, 0, 0, 1, b.minX, b.minY];
        it.area = { width: Math.max(20, b.maxX - b.minX + 4), height: Math.max(it.font.size * 1.4, b.maxY - b.minY + 4) };
      }
    });
  }

  async start() {
    this.renderOptions();
    const serverPromise = this.io.detectServer();
    const drafts = await this.io.loadDrafts();
    const valid = [];
    for (const d of drafts) {
      try {
        valid.push({ doc: parseDocument(d.json), meta: d });
      } catch {
        continue;
      }
    }
    if (valid.length) {
      this.app.newDocument();
      this.dialogs.open('Recuperar trabalho', `<p>Há ${valid.length} documento(s) com alterações que não foram salvas da última vez:</p><ul>${valid.map((v) => `<li>${esc(v.doc.name)}</li>`).join('')}</ul>`, {
        actions: [
          { label: 'Descartar', run: () => this.io.clearDrafts() },
          {
            label: 'Recuperar',
            primary: true,
            run: () => {
              const blank = this.app.active;
              for (const v of valid) this.app.openDocument(v.doc, { dirty: true, serverId: v.meta.serverId || null, revision: v.meta.revision || 0 });
              if (!blank.dirty && blank.history.past.length === 0) this.app.closeTab(blank.id);
            },
          },
        ],
      });
    } else {
      this.app.newDocument();
    }
    const server = await serverPromise;
    document.getElementById('status-storage').textContent = server ? 'Servidor (banco de dados)' : 'Modo local (navegador)';
    if (!valid.length) setTimeout(() => this.tutorial.offer(), 400);
    window.vinco = this;
  }
}

const ui = new UI();
ui.start();
