import { itemMarkup, symbolDefs, appearanceSubpaths } from '../core/svg.js';
import { findItem, itemBounds, documentBounds } from '../core/document.js';
import { toPathData, transformSubpaths } from '../core/path.js';
import { clamp, isEmptyBounds } from '../core/geometry.js';
import { rulerStep, toUnit } from '../core/snap.js';
import { icon } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 64;

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const r1 = (v) => Math.round(v * 100) / 100;

export class Viewport {
  constructor(app) {
    this.app = app;
    this.host = document.getElementById('canvas-host');
    this.svg = document.getElementById('viewport');
    this.stage = document.getElementById('stage');
    this.rulerTop = document.getElementById('ruler-top');
    this.rulerLeft = document.getElementById('ruler-left');
    this.viewBar = document.getElementById('view');
    this.cache = new Map();
    this.layerEls = new Map();
    this.symbolMarkup = '';
    this.pointer = null;
    this.hover = null;
    this.spaceDown = false;
    this.tools = null;
    this.build();
    this.bind();
    app.on('render', (flags) => this.render(flags));
    new ResizeObserver(() => this.app.invalidate('view')).observe(this.host);
  }

  get view() {
    return this.app.active.view;
  }

  build() {
    this.svg.innerHTML = '';
    this.world = el('g', { class: 'world' });
    this.backGroup = el('g');
    this.gridPath = el('path', { fill: 'none', stroke: 'var(--grid)' });
    this.content = el('g', { class: 'content' });
    this.symbolsEl = el('defs');
    this.content.append(this.symbolsEl);
    this.frontGroup = el('g');
    this.world.append(this.backGroup, this.content, this.gridPath, this.frontGroup);
    this.overlay = el('g', { class: 'overlay' });
    this.svg.append(this.world, this.overlay);
    this.viewBar.innerHTML = `
      <button type="button" class="icon-button small" data-zoom="out" title="Diminuir zoom (Ctrl+-)" aria-label="Diminuir zoom">${icon('minus', 16)}</button>
      <span class="zoom-value mono" id="zoom-value">100%</span>
      <button type="button" class="icon-button small" data-zoom="in" title="Aumentar zoom (Ctrl++)" aria-label="Aumentar zoom">${icon('plus', 16)}</button>
      <button type="button" class="icon-button small" data-zoom="fit" title="Encaixar prancheta na janela (Ctrl+0)" aria-label="Encaixar prancheta">${icon('fit', 16)}</button>`;
    this.viewBar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-zoom]');
      if (!b) return;
      if (b.dataset.zoom === 'in') this.zoomBy(1.25);
      if (b.dataset.zoom === 'out') this.zoomBy(0.8);
      if (b.dataset.zoom === 'fit') this.fitArtboard();
    });
  }

  size() {
    const r = this.host.getBoundingClientRect();
    return { width: r.width, height: r.height, left: r.left, top: r.top };
  }

  toScreen(p) {
    const v = this.view;
    return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
  }

  toWorld(clientX, clientY) {
    const s = this.size();
    const v = this.view;
    return { x: (clientX - s.left - v.x) / v.zoom, y: (clientY - s.top - v.y) / v.zoom };
  }

  zoomTo(zoom, anchor = null) {
    const v = this.view;
    const s = this.size();
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const a = anchor || { x: s.width / 2, y: s.height / 2 };
    const wx = (a.x - v.x) / v.zoom;
    const wy = (a.y - v.y) / v.zoom;
    v.zoom = z;
    v.x = a.x - wx * z;
    v.y = a.y - wy * z;
    this.app.invalidate('view');
  }

  zoomBy(factor, anchor) {
    this.zoomTo(this.view.zoom * factor, anchor);
  }

  fitBounds(b, padding = 40) {
    const s = this.size();
    if (!s.width || !s.height || isEmptyBounds(b)) return;
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxY - b.minY);
    const z = clamp(Math.min((s.width - padding * 2) / w, (s.height - padding * 2) / h), MIN_ZOOM, MAX_ZOOM);
    const v = this.view;
    v.zoom = z;
    v.x = (s.width - w * z) / 2 - b.minX * z;
    v.y = (s.height - h * z) / 2 - b.minY * z;
    v.fitted = true;
    this.app.invalidate('view');
  }

  fitArtboard(index = this.app.active.activeArtboard) {
    const a = this.app.doc.artboards[index] || this.app.doc.artboards[0];
    this.fitBounds({ minX: a.x, minY: a.y, maxX: a.x + a.width, maxY: a.y + a.height });
  }

  fitAll() {
    this.fitBounds(documentBounds(this.app.doc));
  }

  actualSize() {
    const a = this.app.doc.artboards[this.app.active.activeArtboard] || this.app.doc.artboards[0];
    const s = this.size();
    const v = this.view;
    v.zoom = 1;
    v.x = (s.width - a.width) / 2 - a.x;
    v.y = (s.height - a.height) / 2 - a.y;
    this.app.invalidate('view');
  }

  bind() {
    const host = this.host;
    host.addEventListener('pointerdown', (e) => this.onDown(e));
    host.addEventListener('pointermove', (e) => this.onMove(e));
    host.addEventListener('pointerup', (e) => this.onUp(e));
    host.addEventListener('pointercancel', (e) => this.onUp(e, true));
    host.addEventListener('dblclick', (e) => this.tools?.dblclick(e, this.toWorld(e.clientX, e.clientY)));
    host.addEventListener('contextmenu', (e) => e.preventDefault());
    host.addEventListener('pointerleave', () => {
      document.getElementById('status-position').textContent = '–';
    });
    host.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const s = this.size();
        if (e.ctrlKey || e.metaKey || e.altKey) {
          this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), { x: e.clientX - s.left, y: e.clientY - s.top });
        } else {
          const v = this.view;
          const dx = e.shiftKey ? e.deltaY : e.deltaX;
          const dy = e.shiftKey ? 0 : e.deltaY;
          const k = e.deltaMode === 1 ? 16 : 1;
          v.x -= dx * k;
          v.y -= dy * k;
          this.app.invalidate('view');
        }
      },
      { passive: false },
    );
    const guideDrag = (axis) => (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const move = (ev) => {
        this.pendingGuide = { axis, value: axis === 'h' ? this.toWorld(ev.clientX, ev.clientY).y : this.toWorld(ev.clientX, ev.clientY).x };
        this.app.invalidate('overlay');
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const s = this.size();
        const inside = ev.clientX >= s.left && ev.clientY >= s.top && ev.clientX <= s.left + s.width && ev.clientY <= s.top + s.height;
        const guide = this.pendingGuide;
        this.pendingGuide = null;
        if (guide && inside) {
          this.app.commit('Criar guia', (doc) => {
            (guide.axis === 'h' ? doc.guides.horizontal : doc.guides.vertical).push(Math.round(guide.value * 100) / 100);
          });
        }
        this.app.invalidate('overlay');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    this.rulerTop.parentElement.addEventListener('pointerdown', guideDrag('h'));
    this.rulerLeft.parentElement.addEventListener('pointerdown', guideDrag('v'));
  }

  eventInfo(e) {
    return {
      p: this.toWorld(e.clientX, e.clientY),
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      button: e.button,
      buttons: e.buttons,
      clientX: e.clientX,
      clientY: e.clientY,
      event: e,
    };
  }

  onDown(e) {
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.activeElement.classList.contains('text-editor')) document.activeElement.blur();
    const pan = e.button === 1 || this.spaceDown || (this.app.tool === 'hand' && e.button === 0);
    this.host.setPointerCapture(e.pointerId);
    if (pan) {
      const v = this.view;
      this.pointer = { mode: 'pan', startX: e.clientX, startY: e.clientY, vx: v.x, vy: v.y };
      this.host.style.cursor = 'grabbing';
      return;
    }
    if (e.button === 2) return;
    this.pointer = { mode: 'tool' };
    this.tools?.down(this.eventInfo(e));
  }

  onMove(e) {
    const info = this.eventInfo(e);
    const unit = this.app.doc.units;
    document.getElementById('status-position').textContent = `X ${toUnit(info.p.x, unit)}  Y ${toUnit(info.p.y, unit)} ${unit}`;
    if (this.pointer?.mode === 'pan') {
      const v = this.view;
      v.x = this.pointer.vx + (e.clientX - this.pointer.startX);
      v.y = this.pointer.vy + (e.clientY - this.pointer.startY);
      this.app.invalidate('view');
      return;
    }
    if (this.pointer?.mode === 'tool') this.tools?.move(info);
    else this.tools?.hover(info);
    this.lastPointer = info;
  }

  onUp(e, cancelled = false) {
    if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId);
    const mode = this.pointer?.mode;
    this.pointer = null;
    if (mode === 'pan') {
      this.host.style.cursor = '';
      this.tools?.updateCursor();
      return;
    }
    if (mode === 'tool') this.tools?.up(this.eventInfo(e), cancelled);
  }

  render(flags) {
    if (!this.app.active) return;
    const all = flags.has('all');
    if (all || flags.has('content') || flags.has('view')) this.renderWorld(all || flags.has('content'));
    this.renderOverlay();
    if (all || flags.has('view')) this.renderRulers();
    const zoomValue = document.getElementById('zoom-value');
    if (zoomValue) zoomValue.textContent = `${Math.round(this.view.zoom * 100)}%`;
    document.getElementById('status-zoom').textContent = `${Math.round(this.view.zoom * 100)}%`;
  }

  renderWorld(contentChanged) {
    const app = this.app;
    const doc = app.doc;
    const v = this.view;
    if (!v.fitted) {
      const s = this.size();
      if (s.width > 0) this.fitArtboard();
    }
    this.world.setAttribute('transform', `matrix(${v.zoom} 0 0 ${v.zoom} ${r1(v.x)} ${r1(v.y)})`);
    this.svg.classList.toggle('outline-mode', app.prefs.outline);
    this.stage.classList.toggle('rulers', app.prefs.rulers);
    const back = [];
    const front = [];
    doc.artboards.forEach((a, i) => {
      const shadow = 4 / v.zoom;
      back.push(`<rect class="artboard-shadow" x="${a.x + shadow}" y="${a.y + shadow}" width="${a.width}" height="${a.height}"/>`);
      back.push(`<rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" fill="${doc.background || '#ffffff'}"/>`);
      front.push(`<rect class="artboard-frame${i === app.active.activeArtboard ? ' active' : ''}" x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}"/>`);
    });
    this.backGroup.innerHTML = back.join('');
    this.frontGroup.innerHTML = front.join('');
    if (app.prefs.grid) {
      const s = this.size();
      const g = app.prefs.gridSize;
      if (g * v.zoom >= 5) {
        const x0 = Math.floor(-v.x / v.zoom / g) * g;
        const y0 = Math.floor(-v.y / v.zoom / g) * g;
        const x1 = (s.width - v.x) / v.zoom;
        const y1 = (s.height - v.y) / v.zoom;
        const parts = [];
        for (let x = x0; x <= x1; x += g) parts.push(`M${x} ${y0}V${y1}`);
        for (let y = y0; y <= y1; y += g) parts.push(`M${x0} ${y}H${x1}`);
        this.gridPath.setAttribute('d', parts.join(''));
        this.gridPath.setAttribute('stroke-width', String(1 / v.zoom));
      } else {
        this.gridPath.setAttribute('d', '');
      }
    } else {
      this.gridPath.setAttribute('d', '');
    }
    if (contentChanged) this.syncContent();
  }

  syncContent() {
    const doc = this.app.doc;
    const ctx = { prefix: `${this.app.active.id}-` };
    const symbols = symbolDefs(doc, ctx);
    if (symbols !== this.symbolMarkup) {
      this.symbolsEl.innerHTML = symbols;
      this.symbolMarkup = symbols;
    }
    const seenLayers = new Set();
    doc.layers.forEach((layer, index) => {
      seenLayers.add(layer.id);
      let group = this.layerEls.get(layer.id);
      if (!group) {
        group = el('g', { 'data-layer': layer.id });
        this.layerEls.set(layer.id, group);
      }
      if (this.content.childNodes[index + 1] !== group) this.content.insertBefore(group, this.content.childNodes[index + 1] || null);
      group.style.display = layer.visible ? '' : 'none';
      layer.children.forEach((item, i) => {
        let node = this.cache.get(item.id);
        if (!node) {
          node = el('g');
          node.dataset.item = item.id;
          this.cache.set(item.id, node);
        }
        const markup = itemMarkup(item, doc, ctx);
        if (node.vincoMarkup !== markup) {
          node.innerHTML = markup;
          node.vincoMarkup = markup;
        }
        if (group.childNodes[i] !== node) group.insertBefore(node, group.childNodes[i] || null);
      });
      while (group.childNodes.length > layer.children.length) {
        const last = group.lastChild;
        if (last.dataset?.item && !findItem(doc, last.dataset.item)) this.cache.delete(last.dataset.item);
        last.remove();
      }
    });
    for (const [id, group] of this.layerEls) {
      if (!seenLayers.has(id)) {
        group.remove();
        this.layerEls.delete(id);
      }
    }
  }

  resetCache() {
    this.cache.clear();
    this.layerEls.clear();
    this.symbolMarkup = '';
    this.build();
    this.app.invalidate('all');
  }

  screenPath(subpaths) {
    const v = this.view;
    return toPathData(transformSubpaths(subpaths, [v.zoom, 0, 0, v.zoom, v.x, v.y]), 1);
  }

  screenBounds(b) {
    const a = this.toScreen({ x: b.minX, y: b.minY });
    const c = this.toScreen({ x: b.maxX, y: b.maxY });
    return { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y };
  }

  outlineOf(item, color) {
    const doc = this.app.doc;
    if (item.type === 'path') return `<path class="ov-path" style="--sel:${color}" d="${this.screenPath(appearanceSubpaths(item))}"/>`;
    if (item.type === 'group') return item.children.map((c) => this.outlineOf(c, color)).join('');
    if (item.type === 'text' && item.onPath) return `<path class="ov-path" style="--sel:${color}" d="${this.screenPath(item.onPath)}"/>`;
    const b = itemBounds(item, doc);
    if (isEmptyBounds(b)) return '';
    const r = this.screenBounds(b);
    return `<rect class="ov-path" style="--sel:${color}" x="${r1(r.x)}" y="${r1(r.y)}" width="${r1(r.width)}" height="${r1(r.height)}"/>`;
  }

  layerColor(id) {
    const entry = findItem(this.app.doc, id);
    return entry?.layer?.color || '#4f7cff';
  }

  renderOverlay() {
    const app = this.app;
    const doc = app.doc;
    const parts = [];
    const s = this.size();
    doc.artboards.forEach((a) => {
      const p = this.toScreen({ x: a.x, y: a.y });
      parts.push(`<text class="artboard-label" x="${r1(p.x)}" y="${r1(p.y - 6)}">${escapeText(a.name)}</text>`);
    });
    if (!app.prefs.guidesHidden) {
      for (const y of doc.guides.horizontal) {
        const p = this.toScreen({ x: 0, y });
        parts.push(`<line class="ov-guide" x1="0" x2="${s.width}" y1="${r1(p.y)}" y2="${r1(p.y)}"/>`);
      }
      for (const x of doc.guides.vertical) {
        const p = this.toScreen({ x, y: 0 });
        parts.push(`<line class="ov-guide" y1="0" y2="${s.height}" x1="${r1(p.x)}" x2="${r1(p.x)}"/>`);
      }
    }
    if (this.pendingGuide) {
      const g = this.pendingGuide;
      if (g.axis === 'h') {
        const p = this.toScreen({ x: 0, y: g.value });
        parts.push(`<line class="ov-guide" x1="0" x2="${s.width}" y1="${r1(p.y)}" y2="${r1(p.y)}"/>`);
      } else {
        const p = this.toScreen({ x: g.value, y: 0 });
        parts.push(`<line class="ov-guide" y1="0" y2="${s.height}" x1="${r1(p.x)}" x2="${r1(p.x)}"/>`);
      }
    }
    if (this.hover && !app.selection.includes(this.hover)) {
      const entry = findItem(doc, this.hover);
      if (entry) parts.push(this.outlineOf(entry.item, this.layerColor(this.hover)));
    }
    if (this.tools) parts.push(this.tools.overlay());
    for (const guide of app.smartGuides || []) {
      if (guide.type === 'v') {
        const p = this.toScreen({ x: guide.x, y: 0 });
        parts.push(`<line class="ov-smart" x1="${r1(p.x)}" x2="${r1(p.x)}" y1="0" y2="${s.height}"/>`);
      } else if (guide.type === 'h') {
        const p = this.toScreen({ x: 0, y: guide.y });
        parts.push(`<line class="ov-smart" y1="${r1(p.y)}" y2="${r1(p.y)}" x1="0" x2="${s.width}"/>`);
      } else if (guide.type === 'point') {
        const p = this.toScreen(guide);
        parts.push(`<circle class="ov-smart" fill="none" cx="${r1(p.x)}" cy="${r1(p.y)}" r="5"/>`);
      } else if (guide.type === 'label') {
        const p = this.toScreen(guide);
        const width = guide.text.length * 6 + 10;
        parts.push(`<rect class="ov-smart-tag" x="${r1(p.x + 12)}" y="${r1(p.y + 12)}" width="${width}" height="16" rx="3"/><text class="ov-smart-label" x="${r1(p.x + 17)}" y="${r1(p.y + 24)}">${escapeText(guide.text)}</text>`);
      }
    }
    this.overlay.innerHTML = parts.join('');
  }

  renderRulers() {
    if (!this.app.prefs.rulers) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const s = this.size();
    const v = this.view;
    const unit = this.app.doc.units;
    const style = getComputedStyle(document.documentElement);
    const color = style.getPropertyValue('--text-faint').trim() || '#777';
    const draw = (canvas, length, horizontal) => {
      const thickness = 20;
      canvas.width = Math.max(1, Math.round(length * dpr));
      canvas.height = Math.round(thickness * dpr);
      canvas.style.width = `${length}px`;
      canvas.style.height = `${thickness}px`;
      if (!horizontal) {
        canvas.width = Math.round(thickness * dpr);
        canvas.height = Math.max(1, Math.round(length * dpr));
        canvas.style.width = `${thickness}px`;
        canvas.style.height = `${length}px`;
      }
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, length, length);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.font = '9px system-ui, sans-serif';
      ctx.lineWidth = 1;
      const factor = toUnit(1, unit) || 1;
      const stepUnits = rulerStep(v.zoom / factor);
      const step = stepUnits / factor;
      const offset = horizontal ? v.x : v.y;
      const start = Math.floor(-offset / v.zoom / step) * step;
      const end = (length - offset) / v.zoom;
      ctx.beginPath();
      for (let world = start; world <= end; world += step / 5) {
        const screen = world * v.zoom + offset;
        const major = Math.abs(Math.round(world / step) * step - world) < step / 50;
        const tick = major ? 20 : 5;
        if (horizontal) {
          ctx.moveTo(Math.round(screen) + 0.5, thickness);
          ctx.lineTo(Math.round(screen) + 0.5, thickness - tick);
        } else {
          ctx.moveTo(thickness, Math.round(screen) + 0.5);
          ctx.lineTo(thickness - tick, Math.round(screen) + 0.5);
        }
        if (major) {
          const label = String(Math.round(world * factor * 100) / 100);
          if (horizontal) ctx.fillText(label, screen + 3, 9);
          else {
            ctx.save();
            ctx.translate(9, screen + 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }
      ctx.stroke();
    };
    draw(this.rulerTop, s.width, true);
    draw(this.rulerLeft, s.height, false);
  }
}

function escapeText(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
