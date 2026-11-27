import { createDocument, findItem, isEditable, itemBounds, selectionBounds, solid, topLevelOf, walkDocument, defaultStyle, cloneStyle, setTextMeasurer } from '../core/document.js';
import { History } from '../core/history.js';
import { restoreSnapshot, snapshotOf } from '../core/format.js';
import { isEmptyBounds } from '../core/geometry.js';

const PREFS_KEY = 'vinco.prefs.v1';

export const DEFAULT_PREFS = {
  theme: 'light',
  palette: '1',
  rulers: true,
  grid: false,
  gridSize: 20,
  snapGrid: false,
  smartGuides: true,
  outline: false,
  showBounds: true,
  nudge: 1,
  units: 'px',
  scaleStrokes: true,
  panels: {},
  tutorialDone: false,
  lastEffect: null,
};

function loadPrefs() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(PREFS_KEY) || '{}');
    const prefs = { ...DEFAULT_PREFS };
    for (const key of Object.keys(DEFAULT_PREFS)) if (raw[key] !== undefined && typeof raw[key] === typeof DEFAULT_PREFS[key]) prefs[key] = raw[key];
    if (!['light', 'dark'].includes(prefs.theme)) prefs.theme = 'light';
    if (!['1', '2', '3', '4'].includes(prefs.palette)) prefs.palette = '1';
    prefs.gridSize = Math.max(2, Math.min(500, Number(prefs.gridSize) || 20));
    prefs.nudge = Math.max(0.01, Math.min(500, Number(prefs.nudge) || 1));
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

let measureCanvas = null;

function installTextMeasurer() {
  if (typeof document === 'undefined') return;
  measureCanvas = document.createElement('canvas').getContext('2d');
  setTextMeasurer((text, font) => {
    measureCanvas.font = `${font.style === 'italic' ? 'italic ' : ''}${font.weight || 400} ${font.size}px ${font.family}`;
    return measureCanvas.measureText(text).width;
  });
}

export class App {
  constructor() {
    this.tabs = [];
    this.active = null;
    this.listeners = new Map();
    this.prefs = loadPrefs();
    this.tool = 'selection';
    this.previousTool = null;
    this.paint = { fill: solid('#ffffff'), stroke: solid('#000000'), strokeWidth: 1, focus: 'fill' };
    this.textDefaults = { family: 'Arial, Helvetica, sans-serif', size: 24, weight: 400, style: 'normal', leading: 1.2, tracking: 0, align: 'left' };
    this.toolOptions = { cornerRadius: 12, sides: 6, points: 5, innerRatio: 0.5, spiralDecay: 0.8, spiralTurns: 10, gridColumns: 5, gridRows: 5, brushSize: 3, blobSize: 16, eraserSize: 20, pencilFidelity: 2, blendSteps: 5, wandTolerance: 32, symbol: null, pencilClose: true };
    this.clipboard = null;
    this.lastTransform = null;
    this.interaction = null;
    this.frame = 0;
    this.dirtyFlags = new Set();
    installTextMeasurer();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) || []) {
      try {
        fn(payload);
      } catch (error) {
        console.error(error);
      }
    }
  }

  savePrefs() {
    try {
      globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      return;
    }
  }

  setPref(key, value) {
    this.prefs[key] = value;
    this.savePrefs();
    this.emit('prefs', key);
    this.invalidate('all');
  }

  get doc() {
    return this.active?.doc || null;
  }

  openDocument(doc, meta = {}) {
    const tab = {
      id: `tab${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      doc,
      history: new History(),
      snapshot: snapshotOf(doc),
      selection: [],
      nodes: new Map(),
      view: { zoom: 1, x: 0, y: 0, fitted: false },
      dirty: !!meta.dirty,
      fileHandle: meta.fileHandle || null,
      fileName: meta.fileName || null,
      serverId: meta.serverId || null,
      revision: meta.revision || 0,
      activeArtboard: 0,
      activeLayer: doc.layers[doc.layers.length - 1].id,
      savedSnapshot: meta.dirty ? null : snapshotOf(doc),
      isolation: null,
    };
    this.tabs.push(tab);
    this.activate(tab.id);
    return tab;
  }

  newDocument(options = {}) {
    return this.openDocument(createDocument(options), { dirty: false });
  }

  activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.active = tab;
    this.emit('tabs');
    this.emit('selection');
    this.invalidate('all');
  }

  closeTab(id) {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.active?.id === id) this.active = this.tabs[Math.min(index, this.tabs.length - 1)] || null;
    if (!this.tabs.length) this.newDocument();
    else {
      this.emit('tabs');
      this.emit('selection');
      this.invalidate('all');
    }
  }

  invalidate(what = 'all') {
    this.dirtyFlags.add(what);
    if (this.frame) return;
    const raf = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    this.frame = raf(() => {
      this.frame = 0;
      const flags = new Set(this.dirtyFlags);
      this.dirtyFlags.clear();
      this.emit('render', flags);
    });
  }

  markChanged() {
    const tab = this.active;
    tab.dirty = tab.savedSnapshot !== tab.snapshot;
    this.emit('change');
    this.emit('tabs');
    this.invalidate('all');
  }

  commit(label, fn) {
    const tab = this.active;
    if (!tab) return undefined;
    const before = tab.snapshot;
    let result;
    try {
      result = fn(tab.doc);
    } catch (error) {
      tab.doc = restoreSnapshot(before, tab.doc.assets);
      this.toast(error.message || 'Não foi possível concluir a ação.', 'error');
      this.invalidate('all');
      return undefined;
    }
    const after = snapshotOf(tab.doc);
    if (after !== before) {
      tab.history.push(label, before, after);
      tab.snapshot = after;
      this.cleanSelection();
      this.markChanged();
    }
    return result;
  }

  beginInteraction() {
    if (!this.active) return;
    this.interaction = { before: this.active.snapshot };
  }

  updateInteraction() {
    this.invalidate('content');
  }

  endInteraction(label) {
    const tab = this.active;
    if (!tab || !this.interaction) return;
    const before = this.interaction.before;
    this.interaction = null;
    const after = snapshotOf(tab.doc);
    if (after !== before) {
      tab.history.push(label, before, after);
      tab.snapshot = after;
      this.markChanged();
    }
    this.invalidate('all');
  }

  cancelInteraction() {
    const tab = this.active;
    if (!tab || !this.interaction) return;
    tab.doc = restoreSnapshot(this.interaction.before, tab.doc.assets);
    this.interaction = null;
    this.cleanSelection();
    this.invalidate('all');
  }

  undo() {
    const tab = this.active;
    if (this.interaction) this.cancelInteraction();
    const step = tab?.history.undo();
    if (!step) return;
    tab.doc = restoreSnapshot(step.snapshot, tab.doc.assets);
    tab.snapshot = step.snapshot;
    this.cleanSelection();
    this.markChanged();
    this.status(`Desfeito: ${step.label}`);
  }

  redo() {
    const tab = this.active;
    const step = tab?.history.redo();
    if (!step) return;
    tab.doc = restoreSnapshot(step.snapshot, tab.doc.assets);
    tab.snapshot = step.snapshot;
    this.cleanSelection();
    this.markChanged();
    this.status(`Refeito: ${step.label}`);
  }

  get selection() {
    return this.active?.selection || [];
  }

  selectedItems() {
    const doc = this.doc;
    if (!doc) return [];
    return this.selection.map((id) => findItem(doc, id)?.item).filter(Boolean);
  }

  select(ids, { add = false, toggle = false } = {}) {
    const tab = this.active;
    if (!tab) return;
    const list = add || toggle ? [...tab.selection] : [];
    for (const id of ids) {
      const at = list.indexOf(id);
      if (toggle && at >= 0) list.splice(at, 1);
      else if (at < 0) list.push(id);
    }
    tab.selection = list.filter((id) => isEditable(tab.doc, id));
    if (!add && !toggle) tab.nodes = new Map();
    const last = tab.selection[tab.selection.length - 1];
    if (last) {
      const entry = findItem(tab.doc, last);
      if (entry?.layer) tab.activeLayer = entry.layer.id;
    }
    this.emit('selection');
    this.invalidate('overlay');
  }

  deselect() {
    this.select([]);
  }

  cleanSelection() {
    const tab = this.active;
    if (!tab) return;
    tab.selection = tab.selection.filter((id) => findItem(tab.doc, id));
    for (const id of [...tab.nodes.keys()]) if (!findItem(tab.doc, id)) tab.nodes.delete(id);
    if (!tab.doc.layers.some((l) => l.id === tab.activeLayer)) tab.activeLayer = tab.doc.layers[tab.doc.layers.length - 1].id;
    if (tab.activeArtboard >= tab.doc.artboards.length) tab.activeArtboard = 0;
    this.emit('selection');
  }

  selectionBounds() {
    const bounds = selectionBounds(this.doc, this.selectedItems());
    return isEmptyBounds(bounds) ? null : bounds;
  }

  activeLayer() {
    const doc = this.doc;
    const layer = doc.layers.find((l) => l.id === this.active.activeLayer) || doc.layers[doc.layers.length - 1];
    return layer;
  }

  targetContainer() {
    const layer = this.activeLayer();
    if (this.active.isolation) {
      const entry = findItem(this.doc, this.active.isolation);
      if (entry && entry.item.type === 'group') return entry.item;
    }
    if (layer.locked || !layer.visible) {
      const usable = [...this.doc.layers].reverse().find((l) => !l.locked && l.visible);
      if (usable) return usable;
      layer.locked = false;
      layer.visible = true;
    }
    return layer;
  }

  newObjectStyle() {
    const style = defaultStyle({ fill: this.paint.fill ? cloneStyle({ fill: this.paint.fill }).fill : null, stroke: this.paint.stroke ? cloneStyle({ stroke: this.paint.stroke }).stroke : null, strokeWidth: this.paint.stroke ? this.paint.strokeWidth : 0 });
    if (this.paint.cap) style.cap = this.paint.cap;
    if (this.paint.join) style.join = this.paint.join;
    if (this.paint.dash) style.dash = [...this.paint.dash];
    return style;
  }

  topLevelSelectionTarget(id) {
    return topLevelOf(this.doc, id);
  }

  boundsOf(item) {
    return itemBounds(item, this.doc);
  }

  allItems() {
    return [...walkDocument(this.doc)].map((e) => e.item).filter((i) => i.type !== 'layer');
  }

  setTool(name) {
    if (this.tool === name) return;
    this.emit('tool-leave', this.tool);
    this.tool = name;
    this.emit('tool', name);
    this.invalidate('overlay');
  }

  toast(message, kind = 'info') {
    this.emit('toast', { message, kind });
  }

  status(message) {
    this.emit('status', message);
  }
}
