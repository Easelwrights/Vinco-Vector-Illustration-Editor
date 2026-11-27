import { createDocument, createImage, insertItem, itemBounds, selectionBounds, uid, walkDocument } from '../core/document.js';
import { parseDocument, serializeDocument } from '../core/format.js';
import { exportSVG, importSVG, SAFE_IMAGE } from '../core/svg.js';
import { exportPDF } from '../core/pdf.js';
import { documentBounds } from '../core/document.js';
import { isEmptyBounds } from '../core/geometry.js';
import { traceBitmap, tracedItem } from '../core/ops.js';

const DB_NAME = 'vinco';
const STORE = 'drafts';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB indisponível'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbRun(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const request = fn(store);
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const safeName = (name) => (String(name || 'Sem título').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Sem título').slice(0, 100);

function readFile(file, as = 'text') {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (as === 'dataURL') reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
    img.src = src;
  });
}

function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export class IO {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.server = null;
    this.draftTimer = null;
    app.on('change', () => this.scheduleDraft());
  }

  async detectServer() {
    if (!/^https?:$/.test(location.protocol)) return false;
    try {
      const response = await fetch(`${location.origin}/api/v1/health`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) return false;
      const data = await response.json();
      if (data?.service !== 'vinco') return false;
      this.server = data;
      return true;
    } catch {
      return false;
    }
  }

  async api(path, { method = 'GET', body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRFToken'] = csrfToken();
    const response = await fetch(`${location.origin}/api/v1/${path}`, { method, headers, credentials: 'same-origin', body: body === null ? null : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Erro ${response.status} no servidor.`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  scheduleDraft() {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.saveDrafts().catch(() => undefined), 1500);
  }

  async saveDrafts() {
    const tabs = this.app.tabs.filter((t) => t.dirty);
    await dbRun('readwrite', (store) => {
      store.clear();
      for (const tab of tabs) store.put({ json: serializeDocument(tab.doc), savedAt: Date.now(), name: tab.doc.name, serverId: tab.serverId, revision: tab.revision }, tab.id);
      return null;
    });
    document.getElementById('status-storage').textContent = tabs.length ? `Rascunho salvo ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : this.storageLabel();
  }

  storageLabel() {
    return this.server ? 'Servidor (banco de dados)' : 'Modo local (navegador)';
  }

  async loadDrafts() {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async clearDrafts() {
    try {
      await dbRun('readwrite', (store) => store.clear());
    } catch {
      return;
    }
  }

  async save(saveAs = false) {
    const tab = this.app.active;
    if (this.server && tab.serverId && !saveAs) return this.saveToServer();
    const json = serializeDocument(tab.doc);
    const name = `${safeName(tab.doc.name)}.vinco`;
    if (globalThis.showSaveFilePicker && window.self === window.top) {
      try {
        let handle = saveAs ? null : tab.fileHandle;
        if (!handle) handle = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Documento do Vinco', accept: { 'application/json': ['.vinco'] } }] });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        tab.fileHandle = handle;
        tab.fileName = handle.name;
        this.markSaved(tab);
        this.app.toast(`Salvo em ${handle.name}.`);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
      }
    }
    download(new Blob([json], { type: 'application/json' }), name);
    this.markSaved(tab);
    this.app.toast(`${name} baixado.`);
    return true;
  }

  markSaved(tab) {
    tab.savedSnapshot = tab.snapshot;
    tab.dirty = false;
    this.app.emit('tabs');
    this.saveDrafts().catch(() => undefined);
  }

  async saveToServer() {
    const tab = this.app.active;
    try {
      const body = { document: tab.doc, revision: tab.revision };
      const data = tab.serverId ? await this.api(`documents/${tab.serverId}`, { method: 'PUT', body }) : await this.api('documents', { method: 'POST', body: { document: tab.doc } });
      tab.serverId = data.id;
      tab.revision = data.revision;
      this.markSaved(tab);
      this.app.toast(`Salvo no servidor (versão ${data.revision}).`);
      return true;
    } catch (error) {
      if (error.status === 409) this.app.toast('Este documento mudou no servidor. Abra a versão mais nova ou use Salvar como.', 'error');
      else this.app.toast(error.message, 'error');
      return false;
    }
  }

  async openFromServer() {
    try {
      const data = await this.api('documents');
      this.ui.dialogs.listDialog(
        'Abrir do servidor',
        data.documents.map((d) => ({ ...d, title: d.name, detail: `v${d.revision} · ${new Date(d.updated_at).toLocaleString('pt-BR')}` })),
        {
          empty: 'Nenhum documento salvo no servidor ainda.',
          onPick: (row) => this.loadFromServer(row.id),
          onDelete: (row) =>
            this.ui.dialogs.confirm('Excluir do servidor', `Excluir "${row.name}" e todas as versões? Isso não pode ser desfeito.`, async () => {
              await this.api(`documents/${row.id}`, { method: 'DELETE' }).catch((e) => this.app.toast(e.message, 'error'));
              this.app.toast('Documento excluído do servidor.');
            }, 'Excluir'),
        },
      );
    } catch (error) {
      this.app.toast(error.message, 'error');
    }
  }

  async loadFromServer(id) {
    try {
      const data = await this.api(`documents/${id}`);
      const doc = parseDocument(data.document);
      this.app.openDocument(doc, { serverId: data.id, revision: data.revision });
    } catch (error) {
      this.app.toast(error.message, 'error');
    }
  }

  async versions() {
    const tab = this.app.active;
    if (!tab.serverId) {
      this.app.toast('Salve o documento no servidor para ter histórico de versões.');
      return;
    }
    try {
      const data = await this.api(`documents/${tab.serverId}/versions`);
      this.ui.dialogs.listDialog(
        'Versões salvas',
        data.versions.map((v) => ({ ...v, title: `Versão ${v.revision}`, detail: `${new Date(v.created_at).toLocaleString('pt-BR')} · ${Math.round(v.size / 1024)} KB` })),
        {
          pickLabel: 'Restaurar',
          onPick: async (row) => {
            try {
              const restored = await this.api(`documents/${tab.serverId}/versions/${row.revision}/restore`, { method: 'POST', body: {} });
              this.app.tabs = this.app.tabs.filter((t) => t !== tab);
              this.app.openDocument(parseDocument(restored.document), { serverId: restored.id, revision: restored.revision });
              this.app.toast(`Versão ${row.revision} restaurada como versão ${restored.revision}.`);
            } catch (error) {
              this.app.toast(error.message, 'error');
            }
          },
        },
      );
    } catch (error) {
      this.app.toast(error.message, 'error');
    }
  }

  pickFiles(accept, multiple = false) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.addEventListener('change', () => resolve([...input.files]));
      input.click();
    });
  }

  async open() {
    const files = await this.pickFiles('.vinco,.json,.svg,image/png,image/jpeg,image/gif,image/webp', true);
    for (const file of files) await this.openFile(file);
  }

  async openFile(file, { place = false } = {}) {
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.vinco') || name.endsWith('.json')) {
        const doc = parseDocument(await readFile(file));
        this.app.openDocument(doc);
        return;
      }
      if (name.endsWith('.svg') || file.type === 'image/svg+xml') {
        const text = await readFile(file);
        if (text.length > 30 * 1024 * 1024) throw new Error('O SVG é grande demais.');
        const result = importSVG(text);
        if (place) {
          this.placeItems(result.items, result.assets, 'Inserir SVG');
        } else {
          const doc = createDocument({ name: file.name.replace(/\.svg$/i, ''), width: Math.max(1, result.width), height: Math.max(1, result.height) });
          Object.assign(doc.assets, result.assets);
          doc.layers[0].children.push(...result.items);
          this.app.openDocument(doc, { dirty: true });
        }
        if (result.skipped) this.app.toast(`${result.skipped} elemento(s) do SVG não puderam ser lidos.`);
        return;
      }
      if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
        await this.placeImageFile(file);
        return;
      }
      throw new Error(`Formato não suportado: ${file.name}`);
    } catch (error) {
      this.app.toast(error.message || 'Não foi possível abrir o arquivo.', 'error');
    }
  }

  placeItems(items, assets, label) {
    const ids = this.app.commit(label, (doc) => {
      Object.assign(doc.assets, assets);
      const container = this.app.targetContainer();
      for (const item of items) insertItem(container, item);
      return items.map((i) => i.id);
    });
    if (ids) this.app.select(ids);
  }

  async place() {
    const files = await this.pickFiles('image/png,image/jpeg,image/gif,image/webp,.svg', true);
    for (const file of files) {
      if (file.name.toLowerCase().endsWith('.svg')) await this.openFile(file, { place: true });
      else await this.placeImageFile(file);
    }
  }

  async placeImageFile(file) {
    if (file.size > MAX_IMAGE_BYTES) {
      this.app.toast('A imagem passa de 25 MB.', 'error');
      return;
    }
    const dataUrl = await readFile(file, 'dataURL');
    await this.placeDataUrl(dataUrl, file.name);
  }

  async placeDataUrl(dataUrl, name = 'Imagem') {
    if (!SAFE_IMAGE.test(dataUrl)) {
      this.app.toast('Formato de imagem não suportado (use PNG, JPEG, GIF ou WebP).', 'error');
      return;
    }
    const img = await loadImage(dataUrl);
    const board = this.app.doc.artboards[this.app.active.activeArtboard];
    const fit = Math.min(1, (board.width * 0.9) / img.naturalWidth, (board.height * 0.9) / img.naturalHeight);
    const w = img.naturalWidth * fit;
    const h = img.naturalHeight * fit;
    const assetId = uid('as');
    const ids = this.app.commit('Inserir imagem', (doc) => {
      doc.assets[assetId] = dataUrl;
      const image = createImage(assetId, w, h, board.x + (board.width - w) / 2, board.y + (board.height - h) / 2);
      image.name = String(name).slice(0, 80);
      insertItem(this.app.targetContainer(), image);
      return [image.id];
    });
    if (ids) this.app.select(ids);
  }

  exportBounds(scope) {
    const doc = this.app.doc;
    if (scope === 'all') return documentBounds(doc);
    if (scope === 'selection') {
      const b = selectionBounds(doc, this.app.selectedItems());
      return isEmptyBounds(b) ? null : b;
    }
    const a = doc.artboards[Number(scope)] || doc.artboards[0];
    return { minX: a.x, minY: a.y, maxX: a.x + a.width, maxY: a.y + a.height };
  }

  exportDocumentForScope(scope) {
    const doc = this.app.doc;
    if (scope !== 'selection') return doc;
    const ids = new Set(this.app.selection);
    const keep = (items) =>
      items
        .map((item) => (ids.has(item.id) ? item : item.children ? { ...item, children: keep(item.children) } : null))
        .filter((item) => item && (ids.has(item.id) || (item.children && item.children.length)));
    return { ...doc, layers: doc.layers.map((l) => ({ ...l, children: keep(l.children) })) };
  }

  async exportFile(kind, options) {
    const doc = this.app.doc;
    const base = safeName(doc.name);
    try {
      if (kind === 'svg') {
        const bounds = this.exportBounds(options.scope);
        if (!bounds) throw new Error('Nada selecionado para exportar.');
        const svg = exportSVG(this.exportDocumentForScope(options.scope), { bounds, background: options.background });
        download(new Blob([svg], { type: 'image/svg+xml' }), `${base}.svg`);
        return;
      }
      if (kind === 'pdf') {
        const artboards = options.scope === 'all' ? null : [Number(options.scope)];
        const images = await this.pdfImages();
        const bytes = exportPDF(doc, { artboards, images, title: doc.name });
        download(new Blob([bytes], { type: 'application/pdf' }), `${base}.pdf`);
        return;
      }
      const bounds = this.exportBounds(options.scope);
      if (!bounds) throw new Error('Nada selecionado para exportar.');
      const blob = await this.rasterize(this.exportDocumentForScope(options.scope), bounds, Number(options.scale) || 1, kind === 'jpeg' ? 'image/jpeg' : 'image/png', { transparent: kind === 'png' && options.transparent, quality: (options.quality || 90) / 100 });
      download(blob, `${base}.${kind === 'jpeg' ? 'jpg' : 'png'}`);
    } catch (error) {
      this.app.toast(error.message || 'Falha ao exportar.', 'error');
    }
  }

  async rasterize(doc, bounds, scale, type, { transparent = true, quality = 0.9 } = {}) {
    const width = Math.max(1, Math.round((bounds.maxX - bounds.minX) * scale));
    const height = Math.max(1, Math.round((bounds.maxY - bounds.minY) * scale));
    if (width * height > 16384 * 16384 || width > 16384 || height > 16384) throw new Error('A imagem ficaria grande demais. Diminua a resolução.');
    const svg = exportSVG(doc, { bounds, background: !transparent });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (type === 'image/jpeg') {
        ctx.fillStyle = doc.background || '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(img, 0, 0, width, height);
      return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar a imagem.'))), type, quality));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async compress(bytes) {
    if (!globalThis.CompressionStream) return { data: bytes, filter: null };
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    const data = new Uint8Array(await new Response(stream).arrayBuffer());
    return { data, filter: 'FlateDecode' };
  }

  async pdfImages() {
    const doc = this.app.doc;
    const used = new Set();
    for (const entry of walkDocument(doc)) if (entry.item.type === 'image') used.add(entry.item.asset);
    for (const s of doc.symbols) for (const c of s.children) if (c.type === 'image') used.add(c.asset);
    const images = new Map();
    for (const id of used) {
      const src = doc.assets[id];
      if (!src) continue;
      const img = await loadImage(src);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const rgb = new Uint8Array(canvas.width * canvas.height * 3);
      const alpha = new Uint8Array(canvas.width * canvas.height);
      let hasAlpha = false;
      for (let i = 0, j = 0, k = 0; i < pixels.length; i += 4, j += 3, k += 1) {
        rgb[j] = pixels[i];
        rgb[j + 1] = pixels[i + 1];
        rgb[j + 2] = pixels[i + 2];
        alpha[k] = pixels[i + 3];
        if (pixels[i + 3] !== 255) hasAlpha = true;
      }
      const color = await this.compress(rgb);
      const mask = hasAlpha ? await this.compress(alpha) : null;
      images.set(id, { width: canvas.width, height: canvas.height, rgb: color.data, filter: color.filter, alpha: mask?.data || null, alphaFilter: mask?.filter || null });
    }
    return images;
  }

  async traceSelectedImage(options) {
    const item = this.app.selectedItems().find((i) => i.type === 'image');
    if (!item) {
      this.app.toast('Selecione uma imagem inserida para traçar.');
      return;
    }
    const src = this.app.doc.assets[item.asset];
    const img = await loadImage(src);
    const limit = 1200;
    const k = Math.min(1, limit / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const subs = traceBitmap({ width: w, height: h, data: data.data }, { threshold: options.threshold, mode: options.mode, smooth: options.smooth, minArea: options.minArea });
    if (!subs.length) {
      this.app.toast('Nada encontrado com esse limiar.');
      return;
    }
    const m = item.matrix;
    const sx = item.width / w;
    const sy = item.height / h;
    const matrix = [m[0] * sx, m[1] * sx, m[2] * sy, m[3] * sy, m[4], m[5]];
    const color = /^#[0-9a-f]{6}$/i.test(options.color) ? options.color.toLowerCase() : '#000000';
    const ids = this.app.commit('Traçado de imagem', (doc) => {
      const traced = tracedItem(subs, matrix, color);
      const entry = [...walkDocument(doc)].find((e) => e.item.id === item.id);
      const siblings = entry.parent.children;
      siblings.splice(siblings.indexOf(entry.item) + 1, 0, traced);
      return [traced.id];
    });
    if (ids) this.app.select(ids);
  }

  boundsOfItem(item) {
    return itemBounds(item, this.app.doc);
  }
}
