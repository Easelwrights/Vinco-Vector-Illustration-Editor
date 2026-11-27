import {
  angleBetween,
  boundsContains,
  boundsIntersect,
  constrainAngle,
  distance,
  isEmptyBounds,
  multiply,
  pointInRings,
  reflection,
  rotation,
  scaling,
  shearing,
  translation,
  unionBounds,
} from '../core/geometry.js';
import {
  arc,
  convertNode,
  ellipse,
  hasIn,
  hasOut,
  line,
  makeNode,
  moveHandle,
  nearestSegment,
  rectangle,
  rectangularGrid,
  regularPolygon,
  removeNode,
  segmentCount,
  spiral,
  splitSegment,
  star,
  toPathData,
  translateNode,
  fitCurve,
  closeSubpath,
  reverseSubpath,
  pathLength,
} from '../core/path.js';
import {
  createArtboard,
  createPath,
  createText,
  defaultStyle,
  findItem,
  hitTest,
  insertItem,
  itemBounds,
  itemsInRect,
  selectionBounds,
  solid,
  topLevelOf,
  transformItem,
  walk,
  cloneItem,
  cloneStyle,
  layoutText,
  createInstance,
} from '../core/document.js';
import { defaultGradient, hexToRgb, paintColor } from '../core/color.js';
import { blobBrush, eraseWithStroke, makeBlend, splitPath, duplicateInPlace } from '../core/ops.js';
import { geomToSubpaths, planarPartition, union } from '../core/boolean.js';
import { collectTargets, snapBounds, snapPoint, toUnit } from '../core/snap.js';
import { icon } from './icons.js';

export const TOOLS = [
  { id: 'selection', label: 'Seleção', key: 'V', icon: 'selection' },
  { id: 'direct', label: 'Seleção direta', key: 'A', icon: 'direct' },
  { id: 'wand', label: 'Varinha mágica', key: 'Y', icon: 'wand' },
  { id: 'lasso', label: 'Laço', key: 'Q', icon: 'lasso' },
  { sep: true },
  { id: 'pen', label: 'Caneta', key: 'P', icon: 'pen' },
  { id: 'anchor', label: 'Ponto de ancoragem', key: 'Shift+C', icon: 'anchor' },
  { id: 'penAdd', label: 'Adicionar ponto de ancoragem', key: '+', icon: 'penAdd' },
  { id: 'penDelete', label: 'Excluir ponto de ancoragem', key: '-', icon: 'penDelete' },
  { id: 'type', label: 'Texto', key: 'T', icon: 'type' },
  { id: 'typePath', label: 'Texto no caminho', key: '', icon: 'typePath' },
  { sep: true },
  { id: 'line', label: 'Segmento de linha', key: '\\', icon: 'line' },
  { id: 'arc', label: 'Arco', key: '', icon: 'arc' },
  { id: 'spiral', label: 'Espiral', key: '', icon: 'spiral' },
  { id: 'grid', label: 'Grade retangular', key: '', icon: 'grid' },
  { id: 'rect', label: 'Retângulo', key: 'M', icon: 'rect' },
  { id: 'roundRect', label: 'Retângulo arredondado', key: '', icon: 'roundRect' },
  { id: 'ellipse', label: 'Elipse', key: 'L', icon: 'ellipse' },
  { id: 'polygon', label: 'Polígono', key: '', icon: 'polygon' },
  { id: 'star', label: 'Estrela', key: '', icon: 'star' },
  { sep: true },
  { id: 'brush', label: 'Pincel', key: 'B', icon: 'brush' },
  { id: 'blob', label: 'Pincel de bolhas', key: 'Shift+B', icon: 'blob' },
  { id: 'pencil', label: 'Lápis', key: 'N', icon: 'pencil' },
  { id: 'eraser', label: 'Borracha', key: 'Shift+E', icon: 'eraser' },
  { id: 'scissors', label: 'Tesoura', key: 'C', icon: 'scissors' },
  { sep: true },
  { id: 'rotate', label: 'Girar', key: 'R', icon: 'rotate' },
  { id: 'reflect', label: 'Refletir', key: 'O', icon: 'reflect' },
  { id: 'scale', label: 'Escala', key: 'S', icon: 'scale' },
  { id: 'shear', label: 'Distorcer', key: '', icon: 'shear' },
  { id: 'shapeBuilder', label: 'Construtor de formas', key: 'Shift+M', icon: 'shapeBuilder' },
  { id: 'gradient', label: 'Degradê', key: 'G', icon: 'gradient' },
  { id: 'eyedropper', label: 'Conta-gotas', key: 'I', icon: 'eyedropper' },
  { id: 'measure', label: 'Medida', key: '', icon: 'measure' },
  { id: 'blend', label: 'Mesclagem', key: 'W', icon: 'blend' },
  { id: 'artboard', label: 'Prancheta', key: 'Shift+O', icon: 'artboard' },
  { id: 'hand', label: 'Mão', key: 'H', icon: 'hand' },
  { id: 'zoom', label: 'Zoom', key: 'Z', icon: 'zoom' },
];

const SHAPE_TOOLS = ['rect', 'roundRect', 'ellipse', 'polygon', 'star', 'line', 'arc', 'spiral', 'grid'];
const FREEHAND = ['brush', 'blob', 'pencil', 'eraser'];
const HANDLE_SIZE = 7;
const r1 = (v) => Math.round(v * 100) / 100;

function restoreInto(item, json) {
  const data = JSON.parse(json);
  for (const key of Object.keys(item)) delete item[key];
  Object.assign(item, data);
}

function nodeKey(s, n) {
  return `${s}:${n}`;
}

export class ToolManager {
  constructor(app, viewport, ui) {
    this.app = app;
    this.vp = viewport;
    this.ui = ui;
    this.drag = null;
    this.pen = null;
    this.textEditor = null;
    this.origin = null;
    this.builder = null;
    this.blendFirst = null;
    this.measure = null;
    viewport.tools = this;
    app.on('tool', () => this.onToolChange());
    app.on('tool-leave', (tool) => this.onToolLeave(tool));
    app.on('selection', () => {
      this.builder = null;
    });
  }

  get doc() {
    return this.app.doc;
  }

  get tol() {
    return 4 / this.vp.view.zoom;
  }

  onToolLeave(tool) {
    if (tool === 'pen') this.finishPen();
    if (this.textEditor) this.closeTextEditor(true);
    this.builder = null;
    this.blendFirst = null;
    this.measure = null;
    this.origin = null;
    this.app.smartGuides = [];
  }

  onToolChange() {
    this.updateCursor();
    this.ui.renderOptions?.();
  }

  updateCursor() {
    const cursors = {
      selection: 'default', direct: 'default', hand: 'grab', zoom: 'zoom-in', type: 'text', typePath: 'text', eyedropper: 'copy',
      wand: 'pointer', scissors: 'crosshair', gradient: 'crosshair', measure: 'crosshair', blend: 'crosshair', artboard: 'default',
    };
    this.vp.host.style.cursor = cursors[this.app.tool] || 'crosshair';
  }

  snapTargets(excludeIds = new Set()) {
    const doc = this.doc;
    const list = [];
    const points = [];
    for (const layer of doc.layers) {
      if (!layer.visible) continue;
      for (const item of layer.children) {
        if (excludeIds.has(item.id) || item.visible === false) continue;
        const b = itemBounds(item, doc);
        if (!isEmptyBounds(b)) list.push(b);
        if (item.type === 'path' && item.subpaths.length < 20) for (const s of item.subpaths) for (const n of s.nodes.slice(0, 200)) points.push({ x: n.x, y: n.y });
      }
    }
    for (const a of doc.artboards) list.push({ minX: a.x, minY: a.y, maxX: a.x + a.width, maxY: a.y + a.height });
    return collectTargets(list, { xs: doc.guides.vertical, ys: doc.guides.horizontal, points });
  }

  snap(p, exclude) {
    const prefs = this.app.prefs;
    if (!prefs.smartGuides && !prefs.snapGrid) {
      this.app.smartGuides = [];
      return p;
    }
    const targets = prefs.smartGuides ? this.snapTargets(exclude) : { xs: [], ys: [], points: [] };
    const result = snapPoint(p, targets, 5 / this.vp.view.zoom, prefs.snapGrid ? prefs.gridSize : null);
    this.app.smartGuides = prefs.smartGuides ? result.guides : [];
    return { x: result.x, y: result.y };
  }

  label(p, text) {
    if (!this.app.prefs.smartGuides) return;
    this.app.smartGuides = [...(this.app.smartGuides || []), { type: 'label', x: p.x, y: p.y, text }];
  }

  fmt(v) {
    return `${toUnit(v, this.doc.units)}`;
  }

  editableHit(p, deep = false) {
    const tab = this.app.active;
    if (tab.isolation) {
      const group = findItem(this.doc, tab.isolation)?.item;
      if (group) {
        for (let i = group.children.length - 1; i >= 0; i -= 1) {
          const child = group.children[i];
          if (!child.locked && child.visible !== false && hitTestItem(this.doc, child, p, this.tol)) return child;
        }
        return null;
      }
    }
    return hitTest(this.doc, p, this.tol, { deep });
  }

  down(info) {
    const tool = this.app.tool;
    if (this.textEditor && tool !== 'type' && tool !== 'typePath') this.closeTextEditor(true);
    const handler = this[`${tool}Down`] || (SHAPE_TOOLS.includes(tool) ? this.shapeDown : FREEHAND.includes(tool) ? this.freehandDown : null);
    if (handler) handler.call(this, info);
  }

  move(info) {
    const tool = this.app.tool;
    const handler = this[`${tool}Move`] || (SHAPE_TOOLS.includes(tool) ? this.shapeMove : FREEHAND.includes(tool) ? this.freehandMove : null);
    if (handler) handler.call(this, info);
    this.app.invalidate('overlay');
  }

  up(info, cancelled) {
    const tool = this.app.tool;
    const handler = this[`${tool}Up`] || (SHAPE_TOOLS.includes(tool) ? this.shapeUp : FREEHAND.includes(tool) ? this.freehandUp : null);
    if (handler) handler.call(this, info, cancelled);
    this.app.smartGuides = [];
    this.app.invalidate('overlay');
  }

  hover(info) {
    const tool = this.app.tool;
    let hoverId = null;
    if (['selection', 'direct', 'wand', 'eyedropper', 'blend', 'scissors', 'penAdd', 'penDelete', 'anchor', 'typePath'].includes(tool)) {
      const hit = this.editableHit(info.p, tool !== 'selection');
      if (hit) hoverId = tool === 'selection' && !this.app.active.isolation ? topLevelOf(this.doc, hit.id)?.id || hit.id : hit.id;
    }
    if (tool === 'pen' || tool === 'shapeBuilder' || this[`${tool}Hover`]) this[`${tool}Hover`]?.(info);
    if (tool === 'selection') this.selectionCursor(info);
    if (this.vp.hover !== hoverId) {
      this.vp.hover = hoverId;
      this.app.invalidate('overlay');
    } else if (tool === 'pen' || tool === 'shapeBuilder') {
      this.app.invalidate('overlay');
    }
  }

  dblclick(e, p) {
    const tool = this.app.tool;
    if (tool === 'selection' || tool === 'direct') {
      const hit = hitTest(this.doc, p, this.tol, { deep: true });
      if (hit?.type === 'text') {
        this.app.setTool('type');
        this.openTextEditor(hit);
        return;
      }
      const top = hit ? topLevelOf(this.doc, hit.id) : null;
      if (top?.type === 'group' && this.app.active.isolation !== top.id) {
        this.app.active.isolation = top.id;
        this.app.select(hit.id === top.id ? [] : [findDirectChild(top, hit.id)?.id].filter(Boolean));
        this.app.status('Modo de isolamento: Esc para sair.');
        this.app.invalidate('all');
        return;
      }
      if (!hit && this.app.active.isolation) this.exitIsolation();
    }
    if (tool === 'hand') this.vp.fitArtboard();
    if (tool === 'zoom') this.vp.actualSize();
  }

  exitIsolation() {
    if (!this.app.active.isolation) return;
    const id = this.app.active.isolation;
    this.app.active.isolation = null;
    this.app.select([id].filter((x) => findItem(this.doc, x)));
    this.app.invalidate('all');
  }

  handlesFor(bounds) {
    const r = this.vp.screenBounds(bounds);
    const xs = [r.x, r.x + r.width / 2, r.x + r.width];
    const ys = [r.y, r.y + r.height / 2, r.y + r.height];
    const list = [];
    const names = [
      ['nw', 'n', 'ne'],
      ['w', null, 'e'],
      ['sw', 's', 'se'],
    ];
    for (let j = 0; j < 3; j += 1) for (let i = 0; i < 3; i += 1) if (names[j][i]) list.push({ name: names[j][i], x: xs[i], y: ys[j], i, j });
    return list;
  }

  handleAt(info) {
    if (!this.app.prefs.showBounds) return null;
    const bounds = this.app.selectionBounds();
    if (!bounds) return null;
    const screen = this.vp.toScreen(info.p);
    const handles = this.handlesFor(bounds);
    for (const h of handles) if (Math.abs(h.x - screen.x) <= HANDLE_SIZE && Math.abs(h.y - screen.y) <= HANDLE_SIZE) return { type: 'scale', handle: h, bounds };
    for (const h of handles) {
      if (!['nw', 'ne', 'sw', 'se'].includes(h.name)) continue;
      const d = Math.hypot(h.x - screen.x, h.y - screen.y);
      if (d > HANDLE_SIZE && d < 22) return { type: 'rotate', handle: h, bounds };
    }
    return null;
  }

  selectionCursor(info) {
    const h = this.handleAt(info);
    if (!h) {
      this.vp.host.style.cursor = 'default';
      return;
    }
    if (h.type === 'rotate') this.vp.host.style.cursor = 'alias';
    else this.vp.host.style.cursor = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h.handle.name];
  }

  captureSelection() {
    const map = new Map();
    for (const item of this.app.selectedItems()) map.set(item.id, JSON.stringify(item));
    return map;
  }

  restoreSelection(map) {
    for (const [id, json] of map) {
      const item = findItem(this.doc, id)?.item;
      if (item) restoreInto(item, json);
    }
  }

  applyMatrixToSelection(m, originals) {
    this.restoreSelection(originals);
    for (const item of this.app.selectedItems()) transformItem(item, m, { scaleStrokes: this.app.prefs.scaleStrokes });
    this.app.updateInteraction();
  }

  selectionDown(info) {
    const handle = this.handleAt(info);
    if (handle) {
      this.app.beginInteraction();
      this.drag = { mode: handle.type, handle: handle.handle, bounds: handle.bounds, start: info.p, originals: this.captureSelection() };
      return;
    }
    const hit = this.editableHit(info.p);
    if (hit) {
      const target = this.app.active.isolation ? hit : topLevelOf(this.doc, hit.id) || hit;
      const selected = this.app.selection.includes(target.id);
      if (info.shift) this.app.select([target.id], { toggle: true });
      else if (!selected) this.app.select([target.id]);
      if (!this.app.selection.includes(target.id)) return;
      this.app.beginInteraction();
      this.drag = { mode: 'move', start: info.p, originals: this.captureSelection(), bounds: this.app.selectionBounds(), duplicated: false };
      return;
    }
    this.drag = { mode: 'marquee', start: info.p, current: info.p, add: info.shift };
  }

  selectionMove(info) {
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'marquee') {
      d.current = info.p;
      return;
    }
    if (d.mode === 'move') {
      let dx = info.p.x - d.start.x;
      let dy = info.p.y - d.start.y;
      if (info.shift) {
        const c = constrainAngle(d.start, info.p);
        dx = c.x - d.start.x;
        dy = c.y - d.start.y;
      }
      if (info.alt && !d.duplicated) {
        this.restoreSelection(d.originals);
        const ids = duplicateInPlace(this.doc, this.app.selection);
        this.app.active.selection = ids;
        d.originals = this.captureSelection();
        d.duplicated = true;
      }
      if (this.app.prefs.smartGuides || this.app.prefs.snapGrid) {
        const snapped = snapBounds(d.bounds, dx, dy, this.app.prefs.smartGuides ? this.snapTargets(new Set(this.app.selection)) : { xs: [], ys: [] }, 5 / this.vp.view.zoom, this.app.prefs.snapGrid ? this.app.prefs.gridSize : null);
        dx = snapped.dx;
        dy = snapped.dy;
        this.app.smartGuides = this.app.prefs.smartGuides ? snapped.guides : [];
      }
      this.label(info.p, `dX: ${this.fmt(dx)}  dY: ${this.fmt(dy)}`);
      this.applyMatrixToSelection(translation(dx, dy), d.originals);
      d.lastMatrix = translation(dx, dy);
      return;
    }
    if (d.mode === 'scale') {
      const b = d.bounds;
      const h = d.handle;
      const ax = info.alt ? (b.minX + b.maxX) / 2 : h.i === 0 ? b.maxX : h.i === 2 ? b.minX : (b.minX + b.maxX) / 2;
      const ay = info.alt ? (b.minY + b.maxY) / 2 : h.j === 0 ? b.maxY : h.j === 2 ? b.minY : (b.minY + b.maxY) / 2;
      const w = b.maxX - b.minX || 1;
      const hgt = b.maxY - b.minY || 1;
      const p = this.snap(info.p, new Set(this.app.selection));
      const ox = h.i === 0 ? b.minX : b.maxX;
      const oy = h.j === 0 ? b.minY : b.maxY;
      let sx = h.i === 1 ? 1 : (p.x - ax) / (ox - ax || 1);
      let sy = h.j === 1 ? 1 : (p.y - ay) / (oy - ay || 1);
      if (info.shift) {
        if (h.i === 1) sx = sy;
        else if (h.j === 1) sy = sx;
        else {
          const k = Math.max(Math.abs(sx), Math.abs(sy));
          sx = Math.sign(sx || 1) * k;
          sy = Math.sign(sy || 1) * k;
        }
      }
      if (!Number.isFinite(sx) || Math.abs(sx * w) < 0.01) sx = 0.01 / w;
      if (!Number.isFinite(sy) || Math.abs(sy * hgt) < 0.01) sy = 0.01 / hgt;
      const m = scaling(sx, sy, ax, ay);
      this.label(info.p, `L: ${this.fmt(Math.abs(w * sx))}  A: ${this.fmt(Math.abs(hgt * sy))}`);
      this.applyMatrixToSelection(m, d.originals);
      d.lastMatrix = m;
      return;
    }
    if (d.mode === 'rotate') {
      const b = d.bounds;
      const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      let angle = angleBetween(c, info.p) - angleBetween(c, d.start);
      if (info.shift) angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const m = rotation(angle, c.x, c.y);
      this.label(info.p, `${Math.round(((-angle * 180) / Math.PI) * 10) / 10}°`);
      this.applyMatrixToSelection(m, d.originals);
      d.lastMatrix = m;
    }
  }

  selectionUp(info, cancelled) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'marquee') {
      const rect = { minX: Math.min(d.start.x, d.current.x), minY: Math.min(d.start.y, d.current.y), maxX: Math.max(d.start.x, d.current.x), maxY: Math.max(d.start.y, d.current.y) };
      if (rect.maxX - rect.minX < 1 && rect.maxY - rect.minY < 1) {
        if (!d.add) {
          if (this.app.active.isolation) this.exitIsolation();
          else this.app.deselect();
        }
        return;
      }
      let items = itemsInRect(this.doc, rect);
      if (this.app.active.isolation) {
        const group = findItem(this.doc, this.app.active.isolation)?.item;
        items = group ? group.children.filter((c) => boundsIntersect(itemBounds(c, this.doc), rect)) : [];
      }
      this.app.select(
        items.map((i) => i.id),
        { add: d.add },
      );
      return;
    }
    if (cancelled) {
      this.app.cancelInteraction();
      return;
    }
    const labels = { move: d.duplicated ? 'Duplicar' : 'Mover', scale: 'Escala', rotate: 'Girar' };
    if (d.lastMatrix) this.app.lastTransform = { matrix: d.lastMatrix, copy: d.duplicated };
    this.app.endInteraction(labels[d.mode] || 'Transformar');
  }

  pathItems() {
    return this.app.selectedItems().flatMap((item) => (item.type === 'path' ? [item] : item.type === 'group' ? [...walk(item.children)].map((e) => e.item).filter((i) => i.type === 'path') : []));
  }

  anchorAt(info, items = this.pathItems()) {
    const screen = this.vp.toScreen(info.p);
    for (let k = items.length - 1; k >= 0; k -= 1) {
      const item = items[k];
      const selected = this.app.active.nodes.get(item.id) || new Set();
      for (let s = 0; s < item.subpaths.length; s += 1) {
        const nodes = item.subpaths[s].nodes;
        for (let n = 0; n < nodes.length; n += 1) {
          const node = nodes[n];
          const showHandles = selected.has(nodeKey(s, n)) || selected.has(nodeKey(s, (n + 1) % nodes.length)) || selected.has(nodeKey(s, (n - 1 + nodes.length) % nodes.length));
          if (showHandles) {
            for (const which of ['in', 'out']) {
              const hx = which === 'in' ? node.ix : node.ox;
              const hy = which === 'in' ? node.iy : node.oy;
              if ((which === 'in' ? hasIn(node) : hasOut(node)) && selected.has(nodeKey(s, n))) {
                const hp = this.vp.toScreen({ x: hx, y: hy });
                if (Math.hypot(hp.x - screen.x, hp.y - screen.y) <= HANDLE_SIZE) return { item, s, n, handle: which };
              }
            }
          }
        }
      }
      for (let s = 0; s < item.subpaths.length; s += 1) {
        const nodes = item.subpaths[s].nodes;
        for (let n = 0; n < nodes.length; n += 1) {
          const ap = this.vp.toScreen(nodes[n]);
          if (Math.hypot(ap.x - screen.x, ap.y - screen.y) <= HANDLE_SIZE) return { item, s, n, handle: null };
        }
      }
    }
    return null;
  }

  directDown(info) {
    const hitAnchor = this.anchorAt(info);
    const tab = this.app.active;
    if (hitAnchor) {
      const { item, s, n, handle } = hitAnchor;
      if (!this.app.selection.includes(item.id)) this.app.select([item.id], { add: info.shift });
      const set = tab.nodes.get(item.id) || new Set();
      const key = nodeKey(s, n);
      if (handle) {
        this.app.beginInteraction();
        this.drag = { mode: 'handle', id: item.id, s, n, handle };
        return;
      }
      if (info.shift) {
        if (set.has(key)) set.delete(key);
        else set.add(key);
      } else if (!set.has(key)) {
        for (const id of tab.nodes.keys()) tab.nodes.set(id, new Set());
        set.clear();
        set.add(key);
      }
      tab.nodes.set(item.id, set);
      this.app.beginInteraction();
      this.drag = { mode: 'nodes', start: info.p, originals: this.captureNodes() };
      this.app.invalidate('overlay');
      return;
    }
    const hit = this.editableHit(info.p, true);
    if (hit) {
      if (!this.app.selection.includes(hit.id)) this.app.select([hit.id], { add: info.shift });
      if (hit.type === 'path') {
        const seg = nearestSegment(hit.subpaths, info.p);
        const set = new Set();
        if (seg && seg.distance <= this.tol * 2 + (hit.style?.strokeWidth || 0) / 2) {
          const count = hit.subpaths[seg.subIndex].nodes.length;
          set.add(nodeKey(seg.subIndex, seg.segIndex));
          set.add(nodeKey(seg.subIndex, (seg.segIndex + 1) % count));
        } else {
          hit.subpaths.forEach((sp, si) => sp.nodes.forEach((_, ni) => set.add(nodeKey(si, ni))));
        }
        if (!info.shift) for (const id of tab.nodes.keys()) tab.nodes.set(id, new Set());
        tab.nodes.set(hit.id, set);
      }
      this.app.beginInteraction();
      this.drag = { mode: hit.type === 'path' ? 'nodes' : 'moveItem', start: info.p, originals: hit.type === 'path' ? this.captureNodes() : this.captureSelection() };
      this.app.invalidate('overlay');
      return;
    }
    this.drag = { mode: 'marquee', start: info.p, current: info.p, add: info.shift };
  }

  captureNodes() {
    const map = new Map();
    for (const [id] of this.app.active.nodes) {
      const item = findItem(this.doc, id)?.item;
      if (item?.type === 'path') map.set(id, JSON.stringify(item.subpaths));
    }
    return map;
  }

  directMove(info) {
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'marquee') {
      d.current = info.p;
      return;
    }
    if (d.mode === 'handle') {
      const item = findItem(this.doc, d.id)?.item;
      if (!item) return;
      const p = this.snap(info.p, new Set());
      const nodes = item.subpaths[d.s].nodes;
      nodes[d.n] = moveHandle(nodes[d.n], d.handle, p, info.alt);
      this.app.updateInteraction();
      return;
    }
    if (d.mode === 'moveItem') {
      let dx = info.p.x - d.start.x;
      let dy = info.p.y - d.start.y;
      if (info.shift) {
        const c = constrainAngle(d.start, info.p);
        dx = c.x - d.start.x;
        dy = c.y - d.start.y;
      }
      this.applyMatrixToSelection(translation(dx, dy), d.originals);
      return;
    }
    if (d.mode === 'nodes') {
      let target = info.p;
      if (info.shift) target = constrainAngle(d.start, info.p);
      target = this.snap(target, new Set());
      const dx = target.x - d.start.x;
      const dy = target.y - d.start.y;
      for (const [id, json] of d.originals) {
        const item = findItem(this.doc, id)?.item;
        if (!item) continue;
        item.subpaths = JSON.parse(json);
        const set = this.app.active.nodes.get(id) || new Set();
        item.subpaths.forEach((sp, si) => {
          sp.nodes = sp.nodes.map((node, ni) => (set.has(nodeKey(si, ni)) ? translateNode(node, dx, dy) : node));
        });
      }
      this.label(info.p, `dX: ${this.fmt(dx)}  dY: ${this.fmt(dy)}`);
      this.app.updateInteraction();
    }
  }

  directUp(info, cancelled) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'marquee') {
      const rect = { minX: Math.min(d.start.x, d.current.x), minY: Math.min(d.start.y, d.current.y), maxX: Math.max(d.start.x, d.current.x), maxY: Math.max(d.start.y, d.current.y) };
      if (rect.maxX - rect.minX < 1 && rect.maxY - rect.minY < 1) {
        if (!d.add) this.app.deselect();
        return;
      }
      this.selectNodesWhere((p) => p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY, rect, d.add);
      return;
    }
    if (cancelled) {
      this.app.cancelInteraction();
      return;
    }
    this.app.endInteraction(d.mode === 'handle' ? 'Mover alça' : 'Mover pontos');
  }

  selectNodesWhere(test, rect, add) {
    const tab = this.app.active;
    const ids = add ? [...tab.selection] : [];
    if (!add) tab.nodes = new Map();
    for (const layer of this.doc.layers) {
      if (!layer.visible || layer.locked) continue;
      for (const entry of walk(layer.children)) {
        const item = entry.item;
        if (item.type !== 'path' || item.locked || item.visible === false) continue;
        if (rect && !boundsIntersect(itemBounds(item, this.doc), rect)) continue;
        const set = tab.nodes.get(item.id) || new Set();
        item.subpaths.forEach((sp, si) =>
          sp.nodes.forEach((n, ni) => {
            if (test(n)) set.add(nodeKey(si, ni));
          }),
        );
        if (set.size) {
          tab.nodes.set(item.id, set);
          if (!ids.includes(item.id)) ids.push(item.id);
        }
      }
    }
    const nodes = tab.nodes;
    this.app.select(ids);
    tab.nodes = nodes;
    this.app.invalidate('overlay');
  }

  lassoDown(info) {
    this.drag = { mode: 'lasso', points: [info.p], add: info.shift };
  }

  lassoMove(info) {
    if (this.drag) this.drag.points.push(info.p);
  }

  lassoUp() {
    const d = this.drag;
    this.drag = null;
    if (!d || d.points.length < 3) {
      if (!d?.add) this.app.deselect();
      return;
    }
    const ring = d.points;
    this.selectNodesWhere((p) => pointInRings(p, [ring], 'evenodd'), null, d.add);
  }

  wandDown(info) {
    const hit = this.editableHit(info.p, true);
    if (!hit) {
      this.app.deselect();
      return;
    }
    const color = paintColor(hit.style?.fill);
    if (!color) {
      this.app.select([hit.id], { add: info.shift });
      return;
    }
    const base = hexToRgb(color);
    const tolerance = this.app.toolOptions.wandTolerance;
    const ids = [];
    for (const layer of this.doc.layers) {
      if (!layer.visible || layer.locked) continue;
      for (const entry of walk(layer.children)) {
        const item = entry.item;
        if (item.type === 'group' || item.locked || item.visible === false) continue;
        const c = paintColor(item.style?.fill);
        if (!c) continue;
        const rgb = hexToRgb(c);
        if (Math.abs(rgb.r - base.r) + Math.abs(rgb.g - base.g) + Math.abs(rgb.b - base.b) <= tolerance * 3) ids.push(item.id);
      }
    }
    this.app.select(ids, { add: info.shift });
  }

  activePenItem() {
    if (!this.pen) return null;
    return findItem(this.doc, this.pen.id)?.item || null;
  }

  penHover(info) {
    this.penCursor = info.p;
    if (!this.pen) {
      const anchor = this.anchorAt(info);
      const item = this.app.selectedItems().find((i) => i.type === 'path');
      this.penHint = null;
      if (anchor && !anchor.handle) {
        const sub = anchor.item.subpaths[anchor.s];
        const isEnd = !sub.closed && (anchor.n === 0 || anchor.n === sub.nodes.length - 1);
        this.penHint = isEnd ? 'continue' : 'delete';
      } else if (item) {
        const seg = nearestSegment(item.subpaths, info.p);
        if (seg && seg.distance <= this.tol) this.penHint = 'add';
      }
      this.vp.host.style.cursor = 'crosshair';
    }
  }

  penDown(info) {
    const doc = this.doc;
    if (info.ctrl && this.pen) {
      this.finishPen();
      return;
    }
    const current = this.activePenItem();
    if (!current) {
      this.pen = null;
      const anchor = this.anchorAt(info);
      if (anchor && !anchor.handle) {
        const sub = anchor.item.subpaths[anchor.s];
        const isEnd = !sub.closed && (anchor.n === 0 || anchor.n === sub.nodes.length - 1);
        this.app.beginInteraction();
        if (isEnd) {
          if (anchor.n === 0) anchor.item.subpaths[anchor.s] = reverseSubpath(sub);
          this.pen = { id: anchor.item.id, s: anchor.s, dragging: false };
          this.app.select([anchor.item.id]);
          this.app.active.nodes.set(anchor.item.id, new Set([nodeKey(anchor.s, anchor.item.subpaths[anchor.s].nodes.length - 1)]));
          this.app.updateInteraction();
          return;
        }
        anchor.item.subpaths[anchor.s] = removeNode(sub, anchor.n);
        if (!anchor.item.subpaths[anchor.s].nodes.length) anchor.item.subpaths.splice(anchor.s, 1);
        this.app.endInteraction('Excluir ponto de ancoragem');
        return;
      }
      const selectedPath = this.app.selectedItems().find((i) => i.type === 'path');
      if (selectedPath) {
        const seg = nearestSegment(selectedPath.subpaths, info.p);
        if (seg && seg.distance <= this.tol) {
          this.app.commit('Adicionar ponto de ancoragem', (d) => {
            const it = findItem(d, selectedPath.id).item;
            it.subpaths[seg.subIndex] = splitSegment(it.subpaths[seg.subIndex], seg.segIndex, seg.t);
          });
          return;
        }
      }
      const p = this.snap(info.p, new Set());
      this.app.beginInteraction();
      const style = this.app.newObjectStyle();
      const path = createPath([{ closed: false, nodes: [makeNode(p.x, p.y)] }], style);
      insertItem(this.app.targetContainer(), path);
      this.pen = { id: path.id, s: 0, dragging: true, anchor: p };
      this.app.active.selection = [path.id];
      this.app.active.nodes = new Map([[path.id, new Set([nodeKey(0, 0)])]]);
      this.app.emit('selection');
      this.app.updateInteraction();
      return;
    }
    const sub = current.subpaths[this.pen.s];
    const first = sub.nodes[0];
    const last = sub.nodes[sub.nodes.length - 1];
    let p = info.shift ? constrainAngle(last, info.p) : this.snap(info.p, new Set([current.id]));
    const fp = this.vp.toScreen(first);
    const sp = this.vp.toScreen(info.p);
    if (sub.nodes.length > 1 && Math.hypot(fp.x - sp.x, fp.y - sp.y) <= HANDLE_SIZE + 2) {
      sub.closed = true;
      this.pen.dragging = true;
      this.pen.closing = true;
      this.pen.anchor = { x: first.x, y: first.y };
      this.app.updateInteraction();
      return;
    }
    if (Math.hypot(this.vp.toScreen(last).x - sp.x, this.vp.toScreen(last).y - sp.y) <= HANDLE_SIZE && sub.nodes.length > 0) {
      last.ox = last.x;
      last.oy = last.y;
      last.smooth = false;
      this.app.updateInteraction();
      return;
    }
    sub.nodes.push(makeNode(p.x, p.y));
    this.app.active.nodes.set(current.id, new Set([nodeKey(this.pen.s, sub.nodes.length - 1)]));
    this.pen.dragging = true;
    this.pen.anchor = p;
    this.pen.closing = false;
    this.app.updateInteraction();
  }

  penMove(info) {
    this.penCursor = info.p;
    const current = this.activePenItem();
    if (!current || !this.pen?.dragging) return;
    const sub = current.subpaths[this.pen.s];
    const index = this.pen.closing ? 0 : sub.nodes.length - 1;
    const node = sub.nodes[index];
    const a = this.pen.anchor;
    let p = info.p;
    if (info.shift) p = constrainAngle(a, p);
    if (distance(a, p) < 1 / this.vp.view.zoom) return;
    if (this.pen.closing) {
      node.ix = 2 * a.x - p.x;
      node.iy = 2 * a.y - p.y;
      if (!info.alt) {
        node.ox = p.x;
        node.oy = p.y;
        node.smooth = true;
      }
    } else {
      node.ox = p.x;
      node.oy = p.y;
      if (!info.alt) {
        node.ix = 2 * a.x - p.x;
        node.iy = 2 * a.y - p.y;
        node.smooth = true;
      } else {
        node.smooth = false;
      }
    }
    this.label(info.p, `${this.fmt(distance(a, p))}`);
    this.app.updateInteraction();
  }

  penUp() {
    if (!this.pen) return;
    this.pen.dragging = false;
    if (this.pen.closing) this.finishPen();
  }

  finishPen() {
    if (!this.pen) return;
    const item = this.activePenItem();
    this.pen = null;
    if (item) {
      item.subpaths = item.subpaths.filter((s) => s.nodes.length > 1 || item.subpaths.length === 1);
      if (item.subpaths.length === 1 && item.subpaths[0].nodes.length < 2) {
        const entry = findItem(this.doc, item.id);
        entry?.siblings.splice(entry.index, 1);
      } else if (!item.subpaths[0]?.closed && item.style.fill && item.subpaths[0].nodes.length === 2 && !this.app.paint.fill) {
        item.style.fill = null;
      }
    }
    if (this.app.interaction) this.app.endInteraction('Caneta');
    this.app.invalidate('all');
  }

  penAddDown(info) {
    const hit = this.editableHit(info.p, true);
    if (!hit || hit.type !== 'path') return;
    const seg = nearestSegment(hit.subpaths, info.p);
    if (!seg || seg.distance > this.tol * 2) return;
    this.app.commit('Adicionar ponto de ancoragem', (d) => {
      const it = findItem(d, hit.id).item;
      it.subpaths[seg.subIndex] = splitSegment(it.subpaths[seg.subIndex], seg.segIndex, seg.t);
    });
    this.app.select([hit.id]);
  }

  penDeleteDown(info) {
    const hit = this.editableHit(info.p, true);
    const items = hit?.type === 'path' ? [hit] : this.pathItems();
    const anchor = this.anchorAt(info, items);
    if (!anchor || anchor.handle) return;
    this.app.commit('Excluir ponto de ancoragem', (d) => {
      const it = findItem(d, anchor.item.id).item;
      it.subpaths[anchor.s] = removeNode(it.subpaths[anchor.s], anchor.n);
      it.subpaths = it.subpaths.filter((s) => s.nodes.length > 0);
      if (!it.subpaths.length) {
        const e = findItem(d, it.id);
        e.siblings.splice(e.index, 1);
      }
    });
  }

  anchorDown(info) {
    const hit = this.editableHit(info.p, true);
    const items = [...this.pathItems(), ...(hit?.type === 'path' ? [hit] : [])];
    const anchor = this.anchorAt(info, items);
    if (!anchor) return;
    const item = anchor.item;
    if (!this.app.selection.includes(item.id)) this.app.select([item.id]);
    this.app.active.nodes.set(item.id, new Set([nodeKey(anchor.s, anchor.n)]));
    this.app.beginInteraction();
    this.drag = { mode: anchor.handle ? 'anchorHandle' : 'anchorPull', id: item.id, s: anchor.s, n: anchor.n, handle: anchor.handle, start: info.p, moved: false };
  }

  anchorMove(info) {
    const d = this.drag;
    if (!d) return;
    const item = findItem(this.doc, d.id)?.item;
    if (!item) return;
    const nodes = item.subpaths[d.s].nodes;
    const node = nodes[d.n];
    d.moved = d.moved || distance(d.start, info.p) * this.vp.view.zoom > 2;
    if (!d.moved) return;
    if (d.mode === 'anchorHandle') {
      nodes[d.n] = moveHandle(node, d.handle, info.p, true);
    } else {
      const p = info.p;
      nodes[d.n] = { ...node, ox: p.x, oy: p.y, ix: 2 * node.x - p.x, iy: 2 * node.y - p.y, smooth: true };
    }
    this.app.updateInteraction();
  }

  anchorUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (!d.moved && d.mode === 'anchorPull') {
      const item = findItem(this.doc, d.id)?.item;
      if (item) {
        const sub = item.subpaths[d.s];
        const node = sub.nodes[d.n];
        const count = sub.nodes.length;
        const prev = sub.closed || d.n > 0 ? sub.nodes[(d.n - 1 + count) % count] : null;
        const next = sub.closed || d.n < count - 1 ? sub.nodes[(d.n + 1) % count] : null;
        sub.nodes[d.n] = convertNode(node, !(hasIn(node) || hasOut(node)), { prev, next });
      }
    }
    this.app.endInteraction('Converter ponto de ancoragem');
  }

  scissorsDown(info) {
    const hit = this.editableHit(info.p, true);
    if (!hit || hit.type !== 'path') return;
    const seg = nearestSegment(hit.subpaths, info.p);
    if (!seg || seg.distance > this.tol * 2 + (hit.style.strokeWidth || 0) / 2) return;
    const ids = this.app.commit('Tesoura', (d) => splitPath(d, hit.id, seg.subIndex, seg.segIndex, seg.t));
    if (ids) this.app.select(ids);
  }

  shapeDown(info) {
    const p = this.snap(info.p, new Set());
    this.drag = { mode: 'shape', start: p, current: p, alt: info.alt, shift: info.shift, moved: false };
  }

  shapeMove(info) {
    const d = this.drag;
    if (!d) return;
    d.current = this.snap(info.p, new Set());
    d.alt = info.alt;
    d.shift = info.shift;
    d.moved = d.moved || distance(d.start, d.current) * this.vp.view.zoom > 3;
    const w = Math.abs(d.current.x - d.start.x) * (d.alt ? 2 : 1);
    const h = Math.abs(d.current.y - d.start.y) * (d.alt ? 2 : 1);
    this.label(info.p, ['line', 'arc'].includes(this.app.tool) ? `C: ${this.fmt(distance(d.start, d.current))}` : `L: ${this.fmt(w)}  A: ${this.fmt(h)}`);
  }

  shapeGeometry(tool, start, current, alt, shift) {
    const o = this.app.toolOptions;
    let x0 = start.x;
    let y0 = start.y;
    let dx = current.x - start.x;
    let dy = current.y - start.y;
    if (shift && !['line', 'arc'].includes(tool)) {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * s;
      dy = Math.sign(dy || 1) * s;
    }
    if (tool === 'line') {
      const end = shift ? constrainAngle(start, current) : current;
      if (alt) return line(2 * start.x - end.x, 2 * start.y - end.y, end.x, end.y);
      return line(start.x, start.y, end.x, end.y);
    }
    if (tool === 'arc') return arc(start.x, start.y, start.x + dx, start.y + dy, alt);
    if (['polygon', 'star', 'spiral'].includes(tool)) {
      const radius = Math.hypot(current.x - start.x, current.y - start.y);
      const angle = shift ? 0 : Math.atan2(current.y - start.y, current.x - start.x) + Math.PI / 2;
      if (tool === 'polygon') return regularPolygon(start.x, start.y, radius, o.sides, angle);
      if (tool === 'star') return star(start.x, start.y, radius, radius * o.innerRatio, o.points, angle);
      return spiral(start.x, start.y, radius, o.spiralDecay, o.spiralTurns, angle - Math.PI / 2);
    }
    if (alt) {
      x0 = start.x - dx;
      y0 = start.y - dy;
      dx *= 2;
      dy *= 2;
    }
    const x = Math.min(x0, x0 + dx);
    const y = Math.min(y0, y0 + dy);
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    if (tool === 'rect') return rectangle(x, y, w, h);
    if (tool === 'roundRect') return rectangle(x, y, w, h, o.cornerRadius);
    if (tool === 'ellipse') return ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
    if (tool === 'grid') return rectangularGrid(x, y, w, h, o.gridColumns, o.gridRows);
    return rectangle(x, y, w, h);
  }

  createShape(subpaths, label) {
    const tool = this.app.tool;
    const style = this.app.newObjectStyle();
    if (['line', 'arc', 'spiral'].includes(tool)) {
      style.fill = null;
      if (!style.stroke) {
        style.stroke = solid('#000000');
        style.strokeWidth = 1;
      }
    }
    if (tool === 'grid') style.fill = null;
    const id = this.app.commit(label, () => {
      const path = createPath(subpaths, style);
      insertItem(this.app.targetContainer(), path);
      return path.id;
    });
    if (id) this.app.select([id]);
  }

  shapeUp(info) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const tool = this.app.tool;
    const label = TOOLS.find((t) => t.id === tool)?.label || 'Forma';
    if (!d.moved) {
      this.ui.dialogs.shapeDialog(tool, d.start, (subpaths) => this.createShape(subpaths, label));
      return;
    }
    this.createShape(this.shapeGeometry(tool, d.start, d.current, d.alt, d.shift), label);
  }

  freehandDown(info) {
    this.drag = { mode: 'freehand', points: [info.p], alt: info.alt };
  }

  freehandMove(info) {
    const d = this.drag;
    if (!d) return;
    const last = d.points[d.points.length - 1];
    if (distance(last, info.p) * this.vp.view.zoom >= 1.5) d.points.push(info.p);
  }

  freehandUp() {
    const d = this.drag;
    this.drag = null;
    if (!d || d.points.length < 2) return;
    const tool = this.app.tool;
    const o = this.app.toolOptions;
    const zoom = this.vp.view.zoom;
    if (tool === 'eraser') {
      const radius = o.eraserSize / 2 / zoom;
      const xs = d.points.map((p) => p.x);
      const ys = d.points.map((p) => p.y);
      const rect = { minX: Math.min(...xs) - radius, minY: Math.min(...ys) - radius, maxX: Math.max(...xs) + radius, maxY: Math.max(...ys) + radius };
      const selected = this.app.selection;
      const targets = (selected.length ? this.app.selectedItems() : itemsInRect(this.doc, rect, { deep: true })).flatMap((i) => (i.type === 'group' ? [...walk(i.children)].map((e) => e.item) : [i])).filter((i) => i.type === 'path');
      this.app.commit('Borracha', (doc) =>
        eraseWithStroke(
          doc,
          targets.map((t) => t.id),
          d.points,
          radius,
        ),
      );
      return;
    }
    if (tool === 'blob') {
      const radius = o.blobSize / 2 / zoom;
      const color = paintColor(this.app.paint.fill) || paintColor(this.app.paint.stroke) || '#000000';
      const xs = d.points.map((p) => p.x);
      const ys = d.points.map((p) => p.y);
      const rect = { minX: Math.min(...xs) - radius, minY: Math.min(...ys) - radius, maxX: Math.max(...xs) + radius, maxY: Math.max(...ys) + radius };
      const container = this.app.targetContainer();
      const candidates = container.children.filter((c) => c.type === 'path' && boundsIntersect(itemBounds(c, this.doc), rect)).map((c) => c.id);
      const id = this.app.commit('Pincel de bolhas', (doc) => blobBrush(doc, container, d.points, radius, color, candidates)?.id);
      if (id) this.app.select([id]);
      return;
    }
    const fidelity = Math.max(0.5, o.pencilFidelity) / zoom;
    let sub = fitCurve(d.points, fidelity, false);
    const closeGap = distance(d.points[0], d.points[d.points.length - 1]) * zoom;
    if (tool === 'pencil' && o.pencilClose && closeGap < 10 && d.points.length > 8) sub = closeSubpath(sub, Infinity);
    const style = this.app.newObjectStyle();
    if (!sub.closed) style.fill = null;
    if (tool === 'brush') {
      style.fill = null;
      style.stroke = this.app.paint.stroke || this.app.paint.fill || solid('#000000');
      style.strokeWidth = o.brushSize;
      style.cap = 'round';
      style.join = 'round';
    } else if (!style.stroke) {
      style.stroke = solid('#000000');
      style.strokeWidth = 1;
    }
    const id = this.app.commit(tool === 'brush' ? 'Pincel' : 'Lápis', () => {
      const path = createPath([sub], style);
      insertItem(this.app.targetContainer(), path);
      return path.id;
    });
    if (id) this.app.select([id]);
  }

  transformOrigin() {
    if (this.origin) return this.origin;
    const b = this.app.selectionBounds();
    return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
  }

  transformToolDown(info, kind) {
    if (!this.app.selection.length) {
      const hit = this.editableHit(info.p);
      if (hit) this.app.select([topLevelOf(this.doc, hit.id)?.id || hit.id]);
      return;
    }
    if (info.alt) {
      this.origin = info.p;
      this.ui.dialogs.transformDialog(kind, this.origin);
      return;
    }
    const origin = this.transformOrigin();
    const screenOrigin = this.vp.toScreen(origin);
    const screen = this.vp.toScreen(info.p);
    if (!this.dragOriginLock && Math.hypot(screenOrigin.x - screen.x, screenOrigin.y - screen.y) < 8) {
      this.drag = { mode: 'origin' };
      return;
    }
    this.app.beginInteraction();
    this.drag = { mode: kind, start: info.p, origin, originals: this.captureSelection(), copy: false };
  }

  transformToolMove(info) {
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'origin') {
      this.origin = this.snap(info.p, new Set());
      return;
    }
    const o = d.origin;
    let m;
    if (d.mode === 'rotate') {
      let angle = angleBetween(o, info.p) - angleBetween(o, d.start);
      if (info.shift) angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      m = rotation(angle, o.x, o.y);
      this.label(info.p, `${Math.round(((-angle * 180) / Math.PI) * 10) / 10}°`);
    } else if (d.mode === 'reflect') {
      let angle = angleBetween(o, info.p);
      if (info.shift) angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      m = reflection(angle, o.x, o.y);
      this.label(info.p, `${Math.round(((-angle * 180) / Math.PI) * 10) / 10}°`);
    } else if (d.mode === 'scale') {
      const sx0 = d.start.x - o.x || 1;
      const sy0 = d.start.y - o.y || 1;
      let sx = (info.p.x - o.x) / sx0;
      let sy = (info.p.y - o.y) / sy0;
      if (info.shift) {
        const k = distance(o, info.p) / (distance(o, d.start) || 1);
        sx = k;
        sy = k;
      }
      m = scaling(sx, sy, o.x, o.y);
      this.label(info.p, `${Math.round(sx * 1000) / 10}%  ${Math.round(sy * 1000) / 10}%`);
    } else if (d.mode === 'shear') {
      const dx = info.p.x - d.start.x;
      const dy = info.p.y - d.start.y;
      const h = d.start.y - o.y || 1;
      const w = d.start.x - o.x || 1;
      m = Math.abs(dx) >= Math.abs(dy) || info.shift ? shearing(dx / h, 0, o.x, o.y) : shearing(0, dy / w, o.x, o.y);
    }
    if (info.alt && !d.copy) {
      this.restoreSelection(d.originals);
      const ids = duplicateInPlace(this.doc, this.app.selection);
      this.app.active.selection = ids;
      d.originals = this.captureSelection();
      d.copy = true;
    }
    d.matrix = m;
    this.applyMatrixToSelection(m, d.originals);
  }

  transformToolUp(info, cancelled) {
    const d = this.drag;
    this.drag = null;
    if (!d || d.mode === 'origin') return;
    if (cancelled) {
      this.app.cancelInteraction();
      return;
    }
    if (d.matrix) this.app.lastTransform = { matrix: d.matrix, copy: d.copy };
    this.app.endInteraction({ rotate: 'Girar', reflect: 'Refletir', scale: 'Escala', shear: 'Distorcer' }[d.mode]);
  }

  rotateDown(info) {
    this.transformToolDown(info, 'rotate');
  }

  rotateMove(info) {
    this.transformToolMove(info);
  }

  rotateUp(info, c) {
    this.transformToolUp(info, c);
  }

  reflectDown(info) {
    this.transformToolDown(info, 'reflect');
  }

  reflectMove(info) {
    this.transformToolMove(info);
  }

  reflectUp(info, c) {
    this.transformToolUp(info, c);
  }

  scaleDown(info) {
    this.transformToolDown(info, 'scale');
  }

  scaleMove(info) {
    this.transformToolMove(info);
  }

  scaleUp(info, c) {
    this.transformToolUp(info, c);
  }

  shearDown(info) {
    this.transformToolDown(info, 'shear');
  }

  shearMove(info) {
    this.transformToolMove(info);
  }

  shearUp(info, c) {
    this.transformToolUp(info, c);
  }

  ensureBuilder() {
    if (this.builder) return this.builder;
    const items = this.pathItems().filter((i) => i.style.fill || i.subpaths.some((s) => s.closed));
    if (items.length < 1) return null;
    const ordered = this.app.allItems().filter((i) => items.includes(i));
    const entries = ordered.map((i) => ({ subpaths: i.subpaths, fillRule: i.fillRule, style: i.style, id: i.id }));
    const regions = planarPartition(entries).map((r) => ({ ...r, subpaths: geomToSubpaths(r.geom, { smooth: true }) }));
    this.builder = { items: ordered, entries, regions, hover: null, picked: new Set() };
    return this.builder;
  }

  regionAt(p) {
    const b = this.ensureBuilder();
    if (!b) return null;
    for (let i = b.regions.length - 1; i >= 0; i -= 1) {
      const rings = b.regions[i].geom[0].map((ring) => ring.map(([x, y]) => ({ x, y })));
      if (pointInRings(p, rings, 'evenodd')) return i;
    }
    return null;
  }

  shapeBuilderHover(info) {
    const b = this.ensureBuilder();
    if (!b) return;
    b.hover = this.regionAt(info.p);
  }

  shapeBuilderDown(info) {
    const b = this.ensureBuilder();
    if (!b) {
      this.app.toast('Selecione duas ou mais formas para usar o Construtor de formas.');
      return;
    }
    const index = this.regionAt(info.p);
    if (index === null) return;
    this.drag = { mode: 'builder', remove: info.alt };
    b.picked = new Set([index]);
  }

  shapeBuilderMove(info) {
    const b = this.builder;
    if (!b) return;
    const index = this.regionAt(info.p);
    b.hover = index;
    if (this.drag && index !== null) b.picked.add(index);
  }

  shapeBuilderUp() {
    const b = this.builder;
    const d = this.drag;
    this.drag = null;
    if (!b || !d || !b.picked.size) return;
    const picked = [...b.picked];
    const ids = b.items.map((i) => i.id);
    const created = this.app.commit(d.remove ? 'Excluir região' : 'Mesclar regiões', (doc) => {
      const anchorEntry = findItem(doc, ids[ids.length - 1]);
      const container = anchorEntry.parent;
      let index = anchorEntry.index;
      for (const id of ids) {
        const e = findItem(doc, id);
        if (e.parent === container && e.index < anchorEntry.index) index -= 1;
        e.siblings.splice(e.index, 1);
      }
      const result = [];
      const rest = b.regions.filter((_, i) => !picked.includes(i));
      for (const region of rest) {
        const style = cloneStyle(b.entries[region.top].style);
        result.push(createPath(region.subpaths, style, { fillRule: 'evenodd' }));
      }
      if (!d.remove) {
        const geom = union(...picked.map((i) => b.regions[i].geom));
        const style = cloneStyle(b.entries[b.regions[picked[0]].top].style);
        result.push(createPath(geomToSubpaths(geom), style, { fillRule: 'evenodd' }));
      }
      container.children.splice(Math.max(0, index), 0, ...result);
      return result.map((r) => r.id);
    });
    this.builder = null;
    if (created) this.app.select(created);
  }

  gradientDown(info) {
    let items = this.app.selectedItems().filter((i) => i.type === 'path' || i.type === 'text');
    if (!items.length) {
      const hit = this.editableHit(info.p, true);
      if (!hit) return;
      this.app.select([hit.id]);
      items = [hit];
    }
    this.app.beginInteraction();
    for (const item of items) {
      if (item.style.fill?.type !== 'gradient') item.style.fill = defaultGradient('linear', paintColor(item.style.fill) || '#ffffff', '#000000');
    }
    this.drag = { mode: 'gradient', start: info.p, ids: items.map((i) => i.id) };
    this.app.updateInteraction();
  }

  gradientMove(info) {
    const d = this.drag;
    if (!d) return;
    let end = info.p;
    if (info.shift) end = constrainAngle(d.start, end);
    for (const id of d.ids) {
      const item = findItem(this.doc, id)?.item;
      if (!item) continue;
      const b = itemBounds(item, this.doc);
      const w = b.maxX - b.minX || 1;
      const h = b.maxY - b.minY || 1;
      const g = item.style.fill;
      const u = (p) => ({ x: (p.x - b.minX) / w, y: (p.y - b.minY) / h });
      if (g.kind === 'radial') {
        const c = u(d.start);
        g.cx = c.x;
        g.cy = c.y;
        g.r = Math.max(0.01, Math.hypot((end.x - d.start.x) / w, (end.y - d.start.y) / h));
      } else {
        const a = u(d.start);
        const e = u(end);
        Object.assign(g, { x1: a.x, y1: a.y, x2: e.x, y2: e.y });
      }
    }
    this.app.updateInteraction();
  }

  gradientUp() {
    if (!this.drag) return;
    this.drag = null;
    this.app.endInteraction('Degradê');
  }

  eyedropperDown(info) {
    const hit = this.editableHit(info.p, true);
    if (!hit) return;
    const source = hit.style ? cloneStyle(hit.style) : null;
    if (!source) return;
    if (info.shift) {
      const color = paintColor(source.fill) || paintColor(source.stroke);
      if (color) this.ui.applyPaint(this.app.paint.focus, solid(color));
      return;
    }
    const targets = this.app.selectedItems().filter((i) => i.id !== hit.id);
    if (targets.length) {
      this.app.commit('Conta-gotas', (doc) => {
        for (const t of targets) {
          for (const entry of walk([findItem(doc, t.id).item])) {
            const it = entry.item;
            if (it.style) {
              if (it.type === 'text') {
                it.style.fill = cloneStyle(source).fill;
                it.style.stroke = cloneStyle(source).stroke;
              } else it.style = cloneStyle(source);
              if (hit.type === 'text' && it.type === 'text') it.font = { ...hit.font };
            }
            if (it.type !== 'group') it.opacity = hit.opacity;
          }
        }
      });
    }
    this.app.paint.fill = source.fill;
    this.app.paint.stroke = source.stroke;
    this.app.paint.strokeWidth = source.strokeWidth || 1;
    this.app.emit('paint');
  }

  measureDown(info) {
    this.measure = { start: info.p, end: info.p };
    this.drag = { mode: 'measure' };
  }

  measureMove(info) {
    if (!this.measure || !this.drag) return;
    this.measure.end = info.shift ? constrainAngle(this.measure.start, info.p) : info.p;
    const m = this.measure;
    const dist = distance(m.start, m.end);
    const angle = (-angleBetween(m.start, m.end) * 180) / Math.PI;
    const text = `D: ${this.fmt(dist)}  ∠ ${Math.round(angle * 10) / 10}°  L: ${this.fmt(m.end.x - m.start.x)}  A: ${this.fmt(m.end.y - m.start.y)}`;
    this.app.smartGuides = [{ type: 'label', x: m.end.x, y: m.end.y, text }];
    this.app.status(text);
  }

  measureUp() {
    this.drag = null;
  }

  blendDown(info) {
    const hit = this.editableHit(info.p);
    if (!hit || hit.type !== 'path') return;
    if (!this.blendFirst || this.blendFirst === hit.id) {
      this.blendFirst = hit.id;
      this.app.select([hit.id]);
      this.app.status('Clique no segundo objeto para criar a mesclagem.');
      return;
    }
    const ids = this.app.commit('Criar mesclagem', (doc) => makeBlend(doc, [this.blendFirst, hit.id], this.app.toolOptions.blendSteps));
    this.blendFirst = null;
    if (ids) this.app.select(ids);
  }

  artboardAt(p) {
    const boards = this.doc.artboards;
    for (let i = boards.length - 1; i >= 0; i -= 1) {
      const a = boards[i];
      if (p.x >= a.x && p.x <= a.x + a.width && p.y >= a.y && p.y <= a.y + a.height) return i;
    }
    return -1;
  }

  artboardDown(info) {
    const tab = this.app.active;
    const active = this.doc.artboards[tab.activeArtboard];
    if (active) {
      const b = { minX: active.x, minY: active.y, maxX: active.x + active.width, maxY: active.y + active.height };
      const screen = this.vp.toScreen(info.p);
      for (const h of this.handlesFor(b)) {
        if (Math.abs(h.x - screen.x) <= HANDLE_SIZE && Math.abs(h.y - screen.y) <= HANDLE_SIZE) {
          this.app.beginInteraction();
          this.drag = { mode: 'boardResize', handle: h, original: { ...active } };
          return;
        }
      }
    }
    const index = this.artboardAt(info.p);
    if (index >= 0) {
      tab.activeArtboard = index;
      this.app.beginInteraction();
      const board = this.doc.artboards[index];
      const inside = info.alt ? [] : this.app.allItems().filter((i) => findItem(this.doc, i.id)?.parent?.type === 'layer' && boundsContains({ minX: board.x, minY: board.y, maxX: board.x + board.width, maxY: board.y + board.height }, itemBounds(i, this.doc)));
      this.drag = { mode: 'boardMove', start: info.p, original: { ...board }, items: inside.map((i) => [i.id, JSON.stringify(i)]) };
      this.app.emit('selection');
      this.app.invalidate('all');
      return;
    }
    this.drag = { mode: 'boardNew', start: info.p, current: info.p };
  }

  artboardMove(info) {
    const d = this.drag;
    if (!d) return;
    const tab = this.app.active;
    const board = this.doc.artboards[tab.activeArtboard];
    if (d.mode === 'boardNew') {
      d.current = this.snap(info.p, new Set());
      return;
    }
    if (d.mode === 'boardMove') {
      const p = this.snap(info.p, new Set());
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      board.x = d.original.x + dx;
      board.y = d.original.y + dy;
      for (const [id, json] of d.items) {
        const item = findItem(this.doc, id)?.item;
        if (!item) continue;
        restoreInto(item, json);
        transformItem(item, translation(dx, dy), { scaleStrokes: false });
      }
      this.app.invalidate('all');
      return;
    }
    if (d.mode === 'boardResize') {
      const o = d.original;
      const h = d.handle;
      const p = this.snap(info.p, new Set());
      let x0 = o.x;
      let y0 = o.y;
      let x1 = o.x + o.width;
      let y1 = o.y + o.height;
      if (h.i === 0) x0 = p.x;
      if (h.i === 2) x1 = p.x;
      if (h.j === 0) y0 = p.y;
      if (h.j === 2) y1 = p.y;
      board.x = Math.min(x0, x1);
      board.y = Math.min(y0, y1);
      board.width = Math.max(1, Math.abs(x1 - x0));
      board.height = Math.max(1, Math.abs(y1 - y0));
      this.label(info.p, `L: ${this.fmt(board.width)}  A: ${this.fmt(board.height)}`);
      this.app.invalidate('all');
    }
  }

  artboardUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'boardNew') {
      const x = Math.min(d.start.x, d.current.x);
      const y = Math.min(d.start.y, d.current.y);
      const w = Math.abs(d.current.x - d.start.x);
      const h = Math.abs(d.current.y - d.start.y);
      if (w < 4 || h < 4) return;
      this.app.commit('Nova prancheta', (doc) => {
        doc.artboards.push(createArtboard(`Prancheta ${doc.artboards.length + 1}`, Math.round(x), Math.round(y), Math.round(w), Math.round(h)));
        this.app.active.activeArtboard = doc.artboards.length - 1;
      });
      return;
    }
    this.app.endInteraction(d.mode === 'boardMove' ? 'Mover prancheta' : 'Redimensionar prancheta');
  }

  zoomDown(info) {
    this.drag = { mode: 'zoom', start: info.p, current: info.p, alt: info.alt };
  }

  zoomMove(info) {
    if (this.drag) this.drag.current = info.p;
  }

  zoomUp(info) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const s = this.vp.size();
    if (distance(d.start, d.current) * this.vp.view.zoom > 6 && !d.alt) {
      this.vp.fitBounds({ minX: Math.min(d.start.x, d.current.x), minY: Math.min(d.start.y, d.current.y), maxX: Math.max(d.start.x, d.current.x), maxY: Math.max(d.start.y, d.current.y) }, 10);
      return;
    }
    this.vp.zoomBy(d.alt || info.alt ? 0.5 : 2, { x: info.clientX - s.left, y: info.clientY - s.top });
  }

  typeDown(info) {
    if (this.textEditor) {
      this.closeTextEditor(true);
      return;
    }
    const hit = hitTest(this.doc, info.p, this.tol, { deep: true });
    if (hit?.type === 'text') {
      this.openTextEditor(hit);
      return;
    }
    this.drag = { mode: 'type', start: info.p, current: info.p };
  }

  typeMove(info) {
    if (this.drag) this.drag.current = info.p;
  }

  typeUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const w = Math.abs(d.current.x - d.start.x);
    const h = Math.abs(d.current.y - d.start.y);
    const t = this.app.textDefaults;
    const area = w * this.vp.view.zoom > 8 && h * this.vp.view.zoom > 8 ? { width: w, height: h } : null;
    const x = area ? Math.min(d.start.x, d.current.x) : d.start.x;
    const y = area ? Math.min(d.start.y, d.current.y) : d.start.y;
    this.app.beginInteraction();
    const text = createText('', x, y, { font: { family: t.family, size: t.size, weight: t.weight, style: t.style, leading: t.leading, tracking: t.tracking }, align: t.align, area });
    text.style.fill = this.app.paint.fill?.type === 'color' && this.app.paint.fill.color !== '#ffffff' ? { ...this.app.paint.fill } : solid('#000000');
    insertItem(this.app.targetContainer(), text);
    this.app.active.selection = [text.id];
    this.openTextEditor(text, true);
  }

  typePathDown(info) {
    const hit = this.editableHit(info.p, true);
    if (hit?.type === 'text') {
      this.openTextEditor(hit);
      return;
    }
    if (!hit || hit.type !== 'path') {
      this.app.toast('Clique em um caminho para escrever sobre ele.');
      return;
    }
    const t = this.app.textDefaults;
    const id = this.app.commit('Texto no caminho', (doc) => {
      const entry = findItem(doc, hit.id);
      const text = createText('Texto no caminho', 0, 0, { font: { family: t.family, size: t.size, weight: t.weight, style: t.style }, onPath: JSON.parse(JSON.stringify(entry.item.subpaths.slice(0, 1))) });
      text.style.fill = solid(paintColor(entry.item.style.stroke) || '#000000');
      entry.siblings.splice(entry.index, 1, text);
      return text.id;
    });
    if (id) {
      this.app.select([id]);
      this.openTextEditor(findItem(this.doc, id).item);
    }
  }

  openTextEditor(item, fresh = false) {
    if (this.textEditor) this.closeTextEditor(true);
    if (!fresh) this.app.beginInteraction();
    this.app.select([item.id]);
    const area = document.createElement('textarea');
    area.className = 'text-editor';
    area.value = item.content;
    area.spellcheck = false;
    area.setAttribute('aria-label', 'Editar texto');
    const place = () => {
      const current = findItem(this.doc, item.id)?.item;
      if (!current) return;
      const b = itemBounds(current, this.doc);
      const zoom = this.vp.view.zoom;
      const font = current.font;
      const r = isEmptyBounds(b) ? { x: this.vp.toScreen({ x: current.matrix[4], y: current.matrix[5] }).x, y: this.vp.toScreen({ x: current.matrix[4], y: current.matrix[5] }).y - font.size * zoom, width: 40, height: font.size * zoom * 1.3 } : this.vp.screenBounds(b);
      area.style.left = `${r.x - 2}px`;
      area.style.top = `${r.y - 2}px`;
      area.style.width = `${Math.max(60, r.width + 24)}px`;
      area.style.height = `${Math.max(font.size * zoom * 1.4, r.height + 8)}px`;
      area.style.font = `${font.style === 'italic' ? 'italic ' : ''}${font.weight} ${font.size * zoom}px ${font.family}`;
      area.style.lineHeight = String(font.leading);
      area.style.textAlign = current.align === 'justify' ? 'left' : current.align;
      area.style.whiteSpace = current.area ? 'pre-wrap' : 'pre';
    };
    area.addEventListener('input', () => {
      const current = findItem(this.doc, item.id)?.item;
      if (!current) return;
      current.content = area.value;
      this.app.updateInteraction();
      place();
    });
    area.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeTextEditor(true);
        this.app.setTool('selection');
      }
    });
    area.addEventListener('blur', () => setTimeout(() => this.textEditor === area && this.closeTextEditor(true), 0));
    this.vp.host.append(area);
    this.textEditor = area;
    this.textEditorId = item.id;
    place();
    area.focus();
    area.select();
  }

  closeTextEditor(commit) {
    const area = this.textEditor;
    if (!area) return;
    this.textEditor = null;
    const id = this.textEditorId;
    area.remove();
    const entry = findItem(this.doc, id);
    if (entry && !String(entry.item.content).trim()) entry.siblings.splice(entry.index, 1);
    if (commit) this.app.endInteraction('Texto');
    else this.app.cancelInteraction();
    this.app.invalidate('all');
  }

  overlay() {
    const app = this.app;
    const vp = this.vp;
    const parts = [];
    const tool = app.tool;
    const items = app.selectedItems();
    const directLike = ['direct', 'pen', 'anchor', 'penAdd', 'penDelete', 'lasso', 'scissors'].includes(tool);
    for (const item of items) parts.push(vp.outlineOf(item, vp.layerColor(item.id)));
    if (directLike) {
      for (const item of this.pathItems()) {
        const selected = app.active.nodes.get(item.id) || new Set();
        const color = vp.layerColor(item.id);
        item.subpaths.forEach((sp, s) => {
          const count = sp.nodes.length;
          sp.nodes.forEach((node, n) => {
            const key = nodeKey(s, n);
            const show = selected.has(key);
            if (show) {
              const a = vp.toScreen(node);
              for (const which of ['in', 'out']) {
                const has = which === 'in' ? hasIn(node) : hasOut(node);
                if (!has) continue;
                const hp = vp.toScreen(which === 'in' ? { x: node.ix, y: node.iy } : { x: node.ox, y: node.oy });
                parts.push(`<line class="ov-line" style="--sel:${color}" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(hp.x)}" y2="${r1(hp.y)}"/><circle class="ov-control" style="--sel:${color}" cx="${r1(hp.x)}" cy="${r1(hp.y)}" r="3"/>`);
              }
            }
            const a = vp.toScreen(node);
            const size = 5;
            parts.push(`<rect class="ov-anchor${show ? ' on' : ''}" style="--sel:${color}" x="${r1(a.x - size / 2)}" y="${r1(a.y - size / 2)}" width="${size}" height="${size}"/>`);
            void count;
          });
        });
      }
    } else if (app.prefs.showBounds && items.length && ['selection', 'rotate', 'reflect', 'scale', 'shear', 'gradient', 'eyedropper', 'shapeBuilder', 'blend', 'wand'].includes(tool)) {
      const b = app.selectionBounds();
      if (b) {
        const r = vp.screenBounds(b);
        const color = vp.layerColor(items[items.length - 1].id);
        parts.push(`<rect class="ov-box" style="--sel:${color}" x="${r1(r.x)}" y="${r1(r.y)}" width="${r1(r.width)}" height="${r1(r.height)}"/>`);
        if (tool === 'selection') for (const h of this.handlesFor(b)) parts.push(`<rect class="ov-handle" style="--sel:${color}" x="${r1(h.x - 3.5)}" y="${r1(h.y - 3.5)}" width="7" height="7"/>`);
      }
    }
    if (['rotate', 'reflect', 'scale', 'shear'].includes(tool) && items.length) {
      const o = this.transformOrigin();
      if (o) {
        const p = vp.toScreen(o);
        parts.push(`<circle class="ov-anchor" cx="${r1(p.x)}" cy="${r1(p.y)}" r="5"/><path class="ov-line" d="M${r1(p.x - 9)} ${r1(p.y)}h18M${r1(p.x)} ${r1(p.y - 9)}v18"/>`);
      }
    }
    const d = this.drag;
    if (d && ['marquee', 'zoom', 'type', 'boardNew'].includes(d.mode)) {
      const a = vp.toScreen(d.start);
      const c = vp.toScreen(d.current);
      parts.push(`<rect class="ov-marquee" x="${r1(Math.min(a.x, c.x))}" y="${r1(Math.min(a.y, c.y))}" width="${r1(Math.abs(c.x - a.x))}" height="${r1(Math.abs(c.y - a.y))}"/>`);
    }
    if (d?.mode === 'lasso' || d?.mode === 'freehand') {
      const pts = d.points.map((p) => vp.toScreen(p));
      const dPath = pts.map((p, i) => `${i ? 'L' : 'M'}${r1(p.x)} ${r1(p.y)}`).join('');
      const widthPx = tool === 'eraser' ? app.toolOptions.eraserSize : tool === 'blob' ? app.toolOptions.blobSize : tool === 'brush' ? app.toolOptions.brushSize * vp.view.zoom : 1;
      parts.push(`<path class="ov-preview" d="${dPath}${d.mode === 'lasso' ? 'Z' : ''}"${['eraser', 'blob', 'brush'].includes(tool) ? ` style="stroke-dasharray:none;stroke-opacity:.45;stroke-width:${widthPx}px;stroke-linecap:round;stroke-linejoin:round"` : ''}/>`);
    }
    if (d?.mode === 'shape' && d.moved) {
      parts.push(`<path class="ov-preview" d="${vp.screenPath(this.shapeGeometry(tool, d.start, d.current, d.alt, d.shift))}"/>`);
    }
    if (tool === 'pen') {
      const item = this.activePenItem();
      if (item && !this.pen.dragging && this.penCursor) {
        const sub = item.subpaths[this.pen.s];
        const last = sub.nodes[sub.nodes.length - 1];
        const preview = [{ closed: false, nodes: [{ ...last }, makeNode(this.penCursor.x, this.penCursor.y)] }];
        parts.push(`<path class="ov-preview" d="${vp.screenPath(preview)}"/>`);
      }
      if (!item && this.penHint && this.penCursor) {
        const p = vp.toScreen(this.penCursor);
        const sign = { add: '+', delete: '−', continue: '/' }[this.penHint];
        parts.push(`<text x="${r1(p.x + 10)}" y="${r1(p.y + 18)}" class="artboard-label" style="font-size:14px;fill:#4f7cff">${sign}</text>`);
      }
    }
    if (tool === 'shapeBuilder' && this.builder) {
      const b = this.builder;
      const show = new Set(b.picked);
      if (b.hover !== null) show.add(b.hover);
      for (const i of show) {
        const region = b.regions[i];
        if (region) parts.push(`<path class="ov-region${d?.remove ? ' remove' : ''}" fill-rule="evenodd" d="${vp.screenPath(region.subpaths)}"/>`);
      }
    }
    if (tool === 'gradient') {
      const item = items.find((i) => i.style?.fill?.type === 'gradient');
      if (item) {
        const b = itemBounds(item, this.doc);
        const g = item.style.fill;
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        const a = vp.toScreen(g.kind === 'radial' ? { x: b.minX + g.cx * w, y: b.minY + g.cy * h } : { x: b.minX + g.x1 * w, y: b.minY + g.y1 * h });
        const e = vp.toScreen(g.kind === 'radial' ? { x: b.minX + (g.cx + g.r) * w, y: b.minY + g.cy * h } : { x: b.minX + g.x2 * w, y: b.minY + g.y2 * h });
        parts.push(`<line class="ov-gradient" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(e.x)}" y2="${r1(e.y)}"/><line class="ov-gradient-inner" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(e.x)}" y2="${r1(e.y)}"/>`);
        for (const stop of g.stops) {
          const x = a.x + (e.x - a.x) * stop.offset;
          const y = a.y + (e.y - a.y) * stop.offset;
          parts.push(`<rect class="ov-stop" x="${r1(x - 5)}" y="${r1(y - 5)}" width="10" height="10" fill="${stop.color}"/>`);
        }
      }
    }
    if (tool === 'measure' && this.measure) {
      const a = vp.toScreen(this.measure.start);
      const e = vp.toScreen(this.measure.end);
      parts.push(`<line class="ov-smart" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(e.x)}" y2="${r1(e.y)}"/>`);
    }
    if (tool === 'artboard') {
      const board = this.doc.artboards[app.active.activeArtboard];
      if (board) {
        const b = { minX: board.x, minY: board.y, maxX: board.x + board.width, maxY: board.y + board.height };
        const r = vp.screenBounds(b);
        parts.push(`<rect class="ov-box" x="${r1(r.x)}" y="${r1(r.y)}" width="${r1(r.width)}" height="${r1(r.height)}" stroke-dasharray="5 3"/>`);
        for (const h of this.handlesFor(b)) parts.push(`<rect class="ov-handle" x="${r1(h.x - 4)}" y="${r1(h.y - 4)}" width="8" height="8"/>`);
      }
    }
    if (this.blendFirst && tool === 'blend') {
      const it = findItem(this.doc, this.blendFirst)?.item;
      if (it) parts.push(vp.outlineOf(it, '#ff3ea5'));
    }
    return parts.join('');
  }

  deleteSelectedNodes() {
    const tab = this.app.active;
    const targets = [...tab.nodes.entries()].filter(([, set]) => set.size);
    if (!targets.length) return false;
    this.app.commit('Excluir pontos de ancoragem', (doc) => {
      for (const [id, set] of targets) {
        const entry = findItem(doc, id);
        if (!entry || entry.item.type !== 'path') continue;
        const item = entry.item;
        const pieces = [];
        item.subpaths.forEach((sp, si) => {
          const keep = sp.nodes.map((_, ni) => !set.has(nodeKey(si, ni)));
          if (keep.every(Boolean)) {
            pieces.push(sp);
            return;
          }
          if (sp.closed) {
            const start = keep.indexOf(false);
            const rotated = [...sp.nodes.slice(start + 1), ...sp.nodes.slice(0, start + 1)];
            const flags = [...keep.slice(start + 1), ...keep.slice(0, start + 1)];
            let run = [];
            rotated.forEach((nd, k) => {
              if (flags[k]) run.push({ ...nd });
              else if (run.length) {
                pieces.push({ closed: false, nodes: run });
                run = [];
              }
            });
            if (run.length) pieces.push({ closed: false, nodes: run });
          } else {
            let run = [];
            sp.nodes.forEach((nd, k) => {
              if (keep[k]) run.push({ ...nd });
              else if (run.length) {
                pieces.push({ closed: false, nodes: run });
                run = [];
              }
            });
            if (run.length) pieces.push({ closed: false, nodes: run });
          }
        });
        const usable = pieces.filter((p) => p.nodes.length > 1);
        if (!usable.length) entry.siblings.splice(entry.index, 1);
        else item.subpaths = usable;
      }
    });
    tab.nodes = new Map();
    return true;
  }

  nudgeNodes(dx, dy) {
    const tab = this.app.active;
    const targets = [...tab.nodes.entries()].filter(([, set]) => set.size);
    if (!targets.length) return false;
    this.app.commit('Mover pontos', (doc) => {
      for (const [id, set] of targets) {
        const item = findItem(doc, id)?.item;
        if (!item || item.type !== 'path') continue;
        item.subpaths.forEach((sp, si) => {
          sp.nodes = sp.nodes.map((nd, ni) => (set.has(nodeKey(si, ni)) ? translateNode(nd, dx, dy) : nd));
        });
      }
    });
    return true;
  }

  key(e) {
    if (this.app.tool === 'pen' && this.pen && (e.key === 'Enter' || e.key === 'Escape')) {
      this.finishPen();
      return true;
    }
    if (e.key === 'Escape') {
      if (this.drag) {
        this.drag = null;
        this.app.cancelInteraction();
        return true;
      }
      if (this.app.active.isolation) {
        this.exitIsolation();
        return true;
      }
      if (this.builder) {
        this.builder = null;
        this.app.invalidate('overlay');
        return true;
      }
    }
    return false;
  }

  placeSymbol(symbolId, p) {
    const symbol = this.doc.symbols.find((s) => s.id === symbolId);
    if (!symbol) return;
    const b = symbol.children.reduce((acc, c) => unionBounds(acc, itemBounds(c, this.doc)), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const cx = isEmptyBounds(b) ? 0 : (b.minX + b.maxX) / 2;
    const cy = isEmptyBounds(b) ? 0 : (b.minY + b.maxY) / 2;
    const id = this.app.commit('Inserir símbolo', () => {
      const inst = createInstance(symbolId, [1, 0, 0, 1, p.x - cx, p.y - cy]);
      insertItem(this.app.targetContainer(), inst);
      return inst.id;
    });
    if (id) this.app.select([id]);
  }

  renderToolbar(container) {
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'tool-grid';
    for (const t of TOOLS) {
      if (t.sep) {
        grid.append(document.createElement('hr'));
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.dataset.tool = t.id;
      b.title = t.key ? `${t.label} (${t.key})` : t.label;
      b.setAttribute('aria-label', t.label);
      b.innerHTML = icon(t.icon, 18);
      b.addEventListener('click', () => this.app.setTool(t.id));
      b.addEventListener('dblclick', () => this.ui.dialogs.toolOptionsDialog(t.id));
      grid.append(b);
    }
    container.append(grid);
    const sync = () => {
      for (const b of grid.querySelectorAll('.tool')) b.classList.toggle('active', b.dataset.tool === this.app.tool);
      const t = TOOLS.find((x) => x.id === this.app.tool);
      document.getElementById('status-tool').textContent = t ? t.label : '';
    };
    this.app.on('tool', sync);
    sync();
  }
}

function hitTestItem(doc, item, p, tol) {
  return !!hitTest({ ...doc, layers: [{ ...doc.layers[0], visible: true, locked: false, children: [item] }] }, p, tol);
}

function findDirectChild(group, id) {
  for (const child of group.children) {
    if (child.id === id) return child;
    if (child.children && [...walk(child.children)].some((e) => e.item.id === id)) return child;
  }
  return null;
}

