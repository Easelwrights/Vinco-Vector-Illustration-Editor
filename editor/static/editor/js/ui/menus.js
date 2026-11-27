import {
  arrange,
  cloneItem,
  createArtboard,
  findItem,
  groupItems,
  insertItem,
  itemBounds,
  orderIds,
  topLevelOf,
  transformItem,
  ungroupItem,
  walk,
  walkDocument,
  documentBounds,
  selectionBounds,
} from '../core/document.js';
import { averageNodes, reverseSubpath } from '../core/path.js';
import { grayscaleHex, invertHex, mapPaint, mixHex, paintColor } from '../core/color.js';
import { isEmptyBounds, translation } from '../core/geometry.js';
import {
  expandAppearance,
  joinPaths,
  makeBlend,
  makeClip,
  makeCompound,
  offsetPath,
  outlineStroke,
  releaseBlend,
  releaseClip,
  releaseCompound,
  selectSimilar,
  simplifyPaths,
  defineSymbol,
  expandInstance,
} from '../core/ops.js';
import { exportSVG, importSVG } from '../core/svg.js';
import { TOOLS } from './tools.js';
import { PANEL_LIST, EFFECT_LABELS } from './panels.js';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

const CODE_KEYS = {
  BracketLeft: '[', BracketRight: ']', Quote: "'", Semicolon: ';', Comma: ',', Period: '.', Minus: '-', Equal: '=', Backslash: '\\', Slash: '/', Backquote: '`',
  NumpadAdd: '+', NumpadSubtract: '-', IntlBackslash: '\\',
};

export function eventKey(e) {
  let key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else key = e.key;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

function normalizeShortcut(s) {
  const parts = s.split('+').filter(Boolean);
  if (s.endsWith('++')) parts.push('+');
  const key = parts.pop();
  const mods = ['Ctrl', 'Alt', 'Shift'].filter((m) => parts.includes(m));
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
}

const display = (s) => (IS_MAC ? s.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧') : s);

export class Menus {
  constructor(ui) {
    this.ui = ui;
    this.app = ui.app;
    this.commands = new Map();
    this.shortcuts = new Map();
    this.openMenu = null;
    this.define();
    this.buildBar();
    this.bindKeys();
  }

  cmd(id, label, run, { key = null, enabled = null, checked = null, alt = null } = {}) {
    this.commands.set(id, { id, label, run, key, enabled, checked });
    if (key) this.shortcuts.set(normalizeShortcut(key), id);
    if (alt) for (const k of [].concat(alt)) this.shortcuts.set(normalizeShortcut(k), id);
  }

  run(id) {
    const c = this.commands.get(id);
    if (!c) return;
    if (c.enabled && !c.enabled()) return;
    try {
      const result = c.run();
      if (result instanceof Promise) result.catch((error) => this.app.toast(error.message, 'error'));
    } catch (error) {
      console.error(error);
      this.app.toast(error.message || 'Não foi possível concluir.', 'error');
    }
  }

  hasSel = () => this.app.selection.length > 0;
  hasMany = () => this.app.selection.length > 1;

  define() {
    const app = this.app;
    const ui = this.ui;
    const sel = this.hasSel;
    const many = this.hasMany;
    const commitSel = (label, fn) => {
      const ids = app.commit(label, (doc) => fn(doc, app.selection));
      if (Array.isArray(ids) && ids.length) app.select(ids);
    };
    const firstOf = (type) => app.selectedItems().find((i) => i.type === type || (type === 'clip' && i.type === 'group' && i.clip));

    this.cmd('file.new', 'Novo…', () => ui.dialogs.newDocumentDialog((o) => app.newDocument(o)), { key: 'Ctrl+N', alt: 'Ctrl+Alt+N' });
    this.cmd('file.open', 'Abrir…', () => ui.io.open(), { key: 'Ctrl+O' });
    this.cmd('file.openServer', 'Abrir do servidor…', () => ui.io.openFromServer(), { enabled: () => !!ui.io.server });
    this.cmd('file.save', 'Salvar', () => ui.io.save(false), { key: 'Ctrl+S' });
    this.cmd('file.saveAs', 'Salvar como…', () => ui.io.save(true), { key: 'Ctrl+Shift+S' });
    this.cmd('file.saveServer', 'Salvar no servidor', () => ui.io.saveToServer(), { enabled: () => !!ui.io.server, key: 'Ctrl+Alt+S' });
    this.cmd('file.versions', 'Versões salvas…', () => ui.io.versions(), { enabled: () => !!ui.io.server && !!app.active.serverId });
    this.cmd('file.place', 'Inserir imagem ou SVG…', () => ui.io.place(), { key: 'Ctrl+Shift+P' });
    this.cmd('file.exportSvg', 'Exportar SVG…', () => ui.dialogs.exportDialog('svg', (o) => ui.io.exportFile('svg', o)), { key: 'Ctrl+Alt+E' });
    this.cmd('file.exportPng', 'Exportar PNG…', () => ui.dialogs.exportDialog('png', (o) => ui.io.exportFile('png', o)), { key: 'Ctrl+Alt+Shift+W' });
    this.cmd('file.exportJpeg', 'Exportar JPEG…', () => ui.dialogs.exportDialog('jpeg', (o) => ui.io.exportFile('jpeg', o)));
    this.cmd('file.exportPdf', 'Exportar PDF…', () => ui.dialogs.exportDialog('pdf', (o) => ui.io.exportFile('pdf', o)), { key: 'Ctrl+Alt+Shift+P' });
    this.cmd('file.setup', 'Configurar documento…', () => ui.dialogs.documentSetupDialog(), { key: 'Ctrl+Alt+P' });
    this.cmd('file.close', 'Fechar documento', () => ui.closeTab(app.active.id), { key: 'Ctrl+Alt+W' });

    this.cmd('edit.undo', 'Desfazer', () => app.undo(), { key: 'Ctrl+Z', enabled: () => app.active.history.canUndo || !!app.interaction });
    this.cmd('edit.redo', 'Refazer', () => app.redo(), { key: 'Ctrl+Shift+Z', alt: 'Ctrl+Y', enabled: () => app.active.history.canRedo });
    this.cmd('edit.cut', 'Recortar', () => this.copy(true), { key: 'Ctrl+X', enabled: sel });
    this.cmd('edit.copy', 'Copiar', () => this.copy(false), { key: 'Ctrl+C', enabled: sel });
    this.cmd('edit.paste', 'Colar', () => this.paste('center'), { key: 'Ctrl+V' });
    this.cmd('edit.pasteFront', 'Colar na frente', () => this.paste('front'), { key: 'Ctrl+F' });
    this.cmd('edit.pasteBack', 'Colar atrás', () => this.paste('back'), { key: 'Ctrl+B' });
    this.cmd('edit.pasteInPlace', 'Colar no lugar', () => this.paste('place'), { key: 'Ctrl+Shift+V' });
    this.cmd('edit.clear', 'Limpar', () => this.clear(), { key: 'Delete', alt: 'Backspace', enabled: sel });
    this.cmd('edit.duplicate', 'Duplicar', () => this.duplicate(), { enabled: sel });
    this.cmd('edit.invertColors', 'Inverter cores', () => this.mapColors('Inverter cores', invertHex), { enabled: sel });
    this.cmd('edit.grayscale', 'Converter em tons de cinza', () => this.mapColors('Tons de cinza', grayscaleHex), { enabled: sel });
    this.cmd('edit.blendFrontBack', 'Mesclar de frente para trás', () => this.blendColors(), { enabled: () => app.selection.length > 2 });
    this.cmd('edit.preferences', 'Preferências…', () => ui.dialogs.preferencesDialog(), { key: 'Ctrl+K' });

    this.cmd('object.again', 'Transformar novamente', () => this.transformAgain(), { key: 'Ctrl+D', enabled: () => sel() && !!app.lastTransform });
    this.cmd('object.move', 'Mover…', () => ui.dialogs.transformDialog('move'), { key: 'Ctrl+Shift+M', enabled: sel });
    this.cmd('object.rotate', 'Girar…', () => ui.dialogs.transformDialog('rotate'), { enabled: sel });
    this.cmd('object.reflect', 'Refletir…', () => ui.dialogs.transformDialog('reflect'), { enabled: sel });
    this.cmd('object.scale', 'Escala…', () => ui.dialogs.transformDialog('scale'), { enabled: sel });
    this.cmd('object.shear', 'Distorcer…', () => ui.dialogs.transformDialog('shear'), { enabled: sel });
    this.cmd('object.flipH', 'Refletir na horizontal', () => ui.flip('h'), { enabled: sel });
    this.cmd('object.flipV', 'Refletir na vertical', () => ui.flip('v'), { enabled: sel });
    this.cmd('object.front', 'Trazer para frente', () => this.arrange('front'), { key: 'Ctrl+Shift+]', enabled: sel });
    this.cmd('object.forward', 'Avançar', () => this.arrange('forward'), { key: 'Ctrl+]', enabled: sel });
    this.cmd('object.backward', 'Recuar', () => this.arrange('backward'), { key: 'Ctrl+[', enabled: sel });
    this.cmd('object.back', 'Enviar para trás', () => this.arrange('back'), { key: 'Ctrl+Shift+[', enabled: sel });
    this.cmd('object.toLayer', 'Enviar para a camada atual', () => this.toCurrentLayer(), { enabled: sel });
    this.cmd('object.group', 'Agrupar', () => this.group(), { key: 'Ctrl+G', enabled: sel });
    this.cmd('object.ungroup', 'Desagrupar', () => this.ungroup(), { key: 'Ctrl+Shift+G', enabled: () => app.selectedItems().some((i) => i.type === 'group') });
    this.cmd('object.lock', 'Travar seleção', () => this.lockHide('locked'), { key: 'Ctrl+2', enabled: sel });
    this.cmd('object.unlockAll', 'Destravar tudo', () => this.unlockShowAll('locked'), { key: 'Ctrl+Alt+2' });
    this.cmd('object.hide', 'Ocultar seleção', () => this.lockHide('visible'), { key: 'Ctrl+3', enabled: sel });
    this.cmd('object.showAll', 'Mostrar tudo', () => this.unlockShowAll('visible'), { key: 'Ctrl+Alt+3' });
    this.cmd('object.expand', 'Expandir aparência', () => commitSel('Expandir aparência', (doc, ids) => expandAppearance(doc, ids)), { enabled: sel });
    this.cmd('object.join', 'Unir', () => commitSel('Unir', (doc, ids) => joinPaths(doc, ids)), { key: 'Ctrl+J', enabled: sel });
    this.cmd('object.average', 'Média…', () => this.average(), { key: 'Ctrl+Alt+J', enabled: () => app.active.nodes.size > 0 });
    this.cmd('object.outlineStroke', 'Contornar traçado', () => commitSel('Contornar traçado', (doc, ids) => outlineStroke(doc, ids)), { enabled: sel });
    this.cmd('object.offsetPath', 'Deslocar caminho…', () => ui.dialogs.offsetPathDialog(), { enabled: sel });
    this.cmd('object.simplify', 'Simplificar…', () => ui.dialogs.simplifyDialog(), { enabled: sel });
    this.cmd('object.reverse', 'Inverter direção do caminho', () => this.reversePaths(), { enabled: sel });
    this.cmd('object.blendMake', 'Criar mesclagem', () => commitSel('Criar mesclagem', (doc, ids) => makeBlend(doc, ids, app.toolOptions.blendSteps)), { key: 'Ctrl+Alt+B', enabled: many });
    this.cmd('object.blendRelease', 'Liberar mesclagem', () => this.releaseOf('Liberar mesclagem', (doc, id) => releaseBlend(doc, id), (i) => i.type === 'group' && i.children.some((c) => c.blendStep)), { key: 'Ctrl+Alt+Shift+B' });
    this.cmd('object.blendOptions', 'Opções de mesclagem…', () => ui.dialogs.blendOptionsDialog());
    this.cmd('object.clipMake', 'Criar máscara de recorte', () => commitSel('Máscara de recorte', (doc, ids) => makeClip(doc, ids)), { key: 'Ctrl+7', enabled: many });
    this.cmd('object.clipRelease', 'Liberar máscara de recorte', () => this.releaseOf('Liberar máscara de recorte', (doc, id) => releaseClip(doc, id), (i) => i.type === 'group' && i.clip), { key: 'Ctrl+Alt+7' });
    this.cmd('object.compoundMake', 'Criar caminho composto', () => commitSel('Caminho composto', (doc, ids) => makeCompound(doc, ids)), { key: 'Ctrl+8', enabled: sel });
    this.cmd('object.compoundRelease', 'Liberar caminho composto', () => this.releaseOf('Liberar caminho composto', (doc, id) => releaseCompound(doc, id), (i) => i.type === 'path' && i.subpaths.length > 1), { key: 'Ctrl+Alt+Shift+8' });
    this.cmd('object.trace', 'Traçado de imagem…', () => ui.dialogs.traceDialog((o) => ui.io.traceSelectedImage(o)), { enabled: () => !!firstOf('image') });
    this.cmd('object.symbolNew', 'Novo símbolo', () => {
      const result = app.commit('Novo símbolo', (doc) => defineSymbol(doc, app.selection, `Símbolo ${doc.symbols.length + 1}`));
      if (result) app.select([result.instance.id]);
    }, { key: 'F8', enabled: sel });
    this.cmd('object.symbolBreak', 'Quebrar vínculo com símbolo', () => this.releaseOf('Quebrar vínculo', (doc, id) => [expandInstance(doc, id)], (i) => i.type === 'instance'));
    this.cmd('object.isolate', 'Entrar no grupo (isolar)', () => {
      const group = app.selectedItems().find((i) => i.type === 'group');
      if (!group) return;
      app.active.isolation = group.id;
      app.select([]);
      app.invalidate('all');
    }, { enabled: () => app.selectedItems().some((i) => i.type === 'group') });

    this.cmd('artboard.new', 'Nova prancheta', () => this.newArtboard());
    this.cmd('artboard.delete', 'Excluir prancheta', () => this.deleteArtboard(), { enabled: () => app.doc.artboards.length > 1 });
    this.cmd('artboard.fit', 'Ajustar prancheta à arte', () => this.fitArtboard());
    this.cmd('artboard.fitSelection', 'Ajustar prancheta à seleção', () => this.fitArtboard(true), { enabled: sel });
    this.cmd('artboard.options', 'Opções de prancheta…', () => ui.dialogs.artboardDialog(app.active.activeArtboard));

    const textAlign = (align) => () => ui.setTextAlign(align);
    this.cmd('type.left', 'Alinhar à esquerda', textAlign('left'), { key: 'Ctrl+Shift+L' });
    this.cmd('type.center', 'Centralizar', textAlign('center'), { key: 'Ctrl+Shift+C' });
    this.cmd('type.right', 'Alinhar à direita', textAlign('right'), { key: 'Ctrl+Shift+R' });
    this.cmd('type.justify', 'Justificar', textAlign('justify'), { key: 'Ctrl+Shift+J' });
    this.cmd('type.bigger', 'Aumentar fonte', () => ui.changeFontSize(2), { key: 'Ctrl+Shift+.' });
    this.cmd('type.smaller', 'Diminuir fonte', () => ui.changeFontSize(-2), { key: 'Ctrl+Shift+,' });
    this.cmd('type.area', 'Converter em texto de área/ponto', () => ui.toggleAreaText(), { enabled: () => !!firstOf('text') });
    this.cmd('type.character', 'Caractere e parágrafo…', () => ui.panels.showPanel('character'), { key: 'Ctrl+T' });

    this.cmd('select.all', 'Tudo', () => this.selectAll(), { key: 'Ctrl+A' });
    this.cmd('select.allArtboard', 'Tudo na prancheta ativa', () => this.selectAll(true), { key: 'Ctrl+Alt+A' });
    this.cmd('select.none', 'Desmarcar', () => app.deselect(), { key: 'Ctrl+Shift+A' });
    this.cmd('select.reselect', 'Selecionar novamente', () => this.reselect(), { key: 'Ctrl+6' });
    this.cmd('select.inverse', 'Inverter seleção', () => this.inverse());
    this.cmd('select.above', 'Próximo objeto acima', () => this.stepSelection(1), { key: 'Ctrl+Alt+]' });
    this.cmd('select.below', 'Próximo objeto abaixo', () => this.stepSelection(-1), { key: 'Ctrl+Alt+[' });
    for (const [key, label] of [
      ['fill', 'Mesma cor de preenchimento'], ['stroke', 'Mesma cor de traçado'], ['strokeWidth', 'Mesma espessura de traçado'], ['opacity', 'Mesma opacidade'], ['blend', 'Mesmo modo de mesclagem'], ['type', 'Mesmo tipo de objeto'],
    ]) {
      this.cmd(`select.same.${key}`, label, () => {
        const ref = app.selectedItems()[0];
        if (ref) app.select(selectSimilar(app.doc, ref, key));
      }, { enabled: sel });
    }

    for (const type of Object.keys(EFFECT_LABELS)) this.cmd(`effect.${type}`, `${EFFECT_LABELS[type]}…`, () => ui.dialogs.effectDialog(type), { enabled: sel });
    this.cmd('effect.last', 'Aplicar último efeito', () => app.prefs.lastEffect && ui.applyEffect({ ...app.prefs.lastEffect }), { key: 'Ctrl+Shift+E', enabled: () => sel() && !!app.prefs.lastEffect });

    const toggle = (pref) => () => app.setPref(pref, !app.prefs[pref]);
    this.cmd('view.outline', 'Contorno', toggle('outline'), { key: 'Ctrl+Y', checked: () => app.prefs.outline });
    this.cmd('view.zoomIn', 'Aumentar zoom', () => ui.viewport.zoomBy(1.5), { key: 'Ctrl+=', alt: ['Ctrl++', 'Ctrl+Shift+='] });
    this.cmd('view.zoomOut', 'Diminuir zoom', () => ui.viewport.zoomBy(1 / 1.5), { key: 'Ctrl+-' });
    this.cmd('view.fit', 'Encaixar prancheta na janela', () => ui.viewport.fitArtboard(), { key: 'Ctrl+0' });
    this.cmd('view.fitAll', 'Encaixar tudo na janela', () => ui.viewport.fitAll(), { key: 'Ctrl+Alt+0' });
    this.cmd('view.actual', 'Tamanho real', () => ui.viewport.actualSize(), { key: 'Ctrl+1' });
    this.cmd('view.rulers', 'Réguas', toggle('rulers'), { key: 'Ctrl+R', checked: () => app.prefs.rulers });
    this.cmd('view.grid', 'Grade', toggle('grid'), { key: "Ctrl+'", checked: () => app.prefs.grid });
    this.cmd('view.snapGrid', 'Alinhar à grade', toggle('snapGrid'), { key: "Ctrl+Shift+'", checked: () => app.prefs.snapGrid });
    this.cmd('view.smart', 'Guias inteligentes', toggle('smartGuides'), { key: 'Ctrl+U', checked: () => app.prefs.smartGuides });
    this.cmd('view.bounds', 'Caixa delimitadora', toggle('showBounds'), { key: 'Ctrl+Shift+B', checked: () => app.prefs.showBounds });
    this.cmd('view.guidesHide', 'Ocultar guias', () => {
      app.prefs.guidesHidden = !app.prefs.guidesHidden;
      app.invalidate('overlay');
    }, { key: 'Ctrl+;', checked: () => !!app.prefs.guidesHidden });
    this.cmd('view.guidesClear', 'Limpar guias', () => app.commit('Limpar guias', (doc) => {
      doc.guides = { horizontal: [], vertical: [] };
    }));
    this.cmd('view.fullscreen', 'Modo de tela cheia', () => document.getElementById('app').classList.toggle('full-screen'), { key: 'F' });
    this.cmd('view.theme', 'Tema escuro', () => ui.setTheme(app.prefs.theme === 'dark' ? 'light' : 'dark'), { checked: () => app.prefs.theme === 'dark' });

    for (const p of PANEL_LIST) this.cmd(`window.${p.id}`, p.title, () => ui.panels.togglePanel(p.id), { checked: () => ui.panels.isVisible(p.id) });
    this.cmd('window.layers.key', 'Camadas', () => ui.panels.showPanel('layers'), { key: 'F7' });
    this.cmd('window.color.key', 'Cor', () => ui.panels.showPanel('color'), { key: 'F6' });

    this.cmd('help.tutorial', 'Tutorial rápido', () => ui.tutorial.start());
    this.cmd('help.shortcuts', 'Atalhos do teclado', () => this.showShortcuts(), { key: 'Ctrl+Alt+Shift+K' });
    this.cmd('help.about', 'Sobre o Vinco', () => ui.dialogs.aboutDialog(ui.version));
  }

  menuTree() {
    return [
      ['Arquivo', ['file.new', 'file.open', 'file.openServer', '-', 'file.save', 'file.saveAs', 'file.saveServer', 'file.versions', '-', 'file.place', ['Exportar', ['file.exportSvg', 'file.exportPdf', 'file.exportPng', 'file.exportJpeg']], '-', 'file.setup', 'file.close']],
      ['Editar', ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.pasteFront', 'edit.pasteBack', 'edit.pasteInPlace', 'edit.clear', 'edit.duplicate', '-', ['Editar cores', ['edit.invertColors', 'edit.grayscale', 'edit.blendFrontBack']], '-', 'edit.preferences']],
      [
        'Objeto',
        [
          ['Transformar', ['object.again', '-', 'object.move', 'object.rotate', 'object.reflect', 'object.scale', 'object.shear', '-', 'object.flipH', 'object.flipV']],
          ['Organizar', ['object.front', 'object.forward', 'object.backward', 'object.back', '-', 'object.toLayer']],
          '-', 'object.group', 'object.ungroup', 'object.isolate', 'object.lock', 'object.unlockAll', 'object.hide', 'object.showAll', '-', 'object.expand',
          ['Caminho', ['object.join', 'object.average', 'object.outlineStroke', 'object.offsetPath', 'object.simplify', 'object.reverse']],
          ['Mesclagem', ['object.blendMake', 'object.blendRelease', 'object.blendOptions']],
          ['Máscara de recorte', ['object.clipMake', 'object.clipRelease']],
          ['Caminho composto', ['object.compoundMake', 'object.compoundRelease']],
          ['Pranchetas', ['artboard.new', 'artboard.delete', 'artboard.fit', 'artboard.fitSelection', 'artboard.options']],
          ['Símbolo', ['object.symbolNew', 'object.symbolBreak']],
          'object.trace',
        ],
      ],
      ['Texto', ['type.character', 'type.area', '-', 'type.left', 'type.center', 'type.right', 'type.justify', '-', 'type.bigger', 'type.smaller']],
      ['Selecionar', ['select.all', 'select.allArtboard', 'select.none', 'select.reselect', 'select.inverse', '-', ['Mesmo', ['select.same.fill', 'select.same.stroke', 'select.same.strokeWidth', 'select.same.opacity', 'select.same.blend', 'select.same.type']], '-', 'select.above', 'select.below']],
      ['Efeito', ['effect.last', '-', ['Estilizar', ['effect.dropShadow', 'effect.outerGlow', 'effect.innerGlow', 'effect.roundCorners']], ['Desfoque', ['effect.blur']], ['Distorcer e transformar', ['effect.zigZag', 'effect.roughen', 'effect.puckerBloat']]]],
      ['Exibir', ['view.outline', '-', 'view.zoomIn', 'view.zoomOut', 'view.fit', 'view.fitAll', 'view.actual', '-', 'view.bounds', 'view.rulers', 'view.grid', 'view.snapGrid', 'view.smart', ['Guias', ['view.guidesHide', 'view.guidesClear']], '-', 'view.fullscreen', 'view.theme']],
      ['Janela', PANEL_LIST.map((p) => `window.${p.id}`)],
      ['Ajuda', ['help.tutorial', 'help.shortcuts', 'help.about']],
    ];
  }

  buildBar() {
    const bar = document.getElementById('menus');
    bar.innerHTML = '';
    for (const [title, items] of this.menuTree()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-button';
      b.textContent = title;
      b.setAttribute('aria-haspopup', 'true');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', () => {
        if (this.openMenu?.button === b) this.close();
        else this.openAt(b, items);
      });
      b.addEventListener('mouseenter', () => {
        if (this.openMenu && this.openMenu.button !== b) this.openAt(b, items);
      });
      bar.append(b);
    }
    document.addEventListener('pointerdown', (e) => {
      if (this.openMenu && !e.target.closest('.menu') && !e.target.closest('.menu-button') && !e.target.closest('#palette')) this.close();
    });
  }

  renderMenu(items) {
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    for (const entry of items) {
      if (entry === '-') {
        menu.append(document.createElement('hr'));
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitem');
      if (Array.isArray(entry)) {
        const [title, children] = entry;
        b.innerHTML = `<span></span><span>${title}</span><span>›</span>`;
        const openSub = () => {
          menu.querySelectorAll('.menu-item.open').forEach((x) => x.classList.remove('open'));
          menu.querySelectorAll(':scope > .submenu').forEach((x) => x.remove());
          b.classList.add('open');
          const sub = this.renderMenu(children);
          sub.classList.add('submenu');
          const r = b.getBoundingClientRect();
          sub.style.left = `${r.right + 2}px`;
          sub.style.top = `${r.top - 6}px`;
          menu.append(sub);
          requestAnimationFrame(() => {
            const sr = sub.getBoundingClientRect();
            if (sr.right > window.innerWidth) sub.style.left = `${r.left - sr.width - 2}px`;
            if (sr.bottom > window.innerHeight) sub.style.top = `${Math.max(4, window.innerHeight - sr.height - 4)}px`;
          });
        };
        b.addEventListener('mouseenter', openSub);
        b.addEventListener('click', openSub);
      } else {
        const c = this.commands.get(entry);
        if (!c) continue;
        const disabled = c.enabled && !c.enabled();
        b.disabled = !!disabled;
        const checked = c.checked ? (c.checked() ? '✓' : '') : '';
        b.innerHTML = `<span class="check">${checked}</span><span>${c.label}</span><kbd>${c.key ? display(c.key) : ''}</kbd>`;
        b.addEventListener('mouseenter', () => {
          menu.querySelectorAll('.menu-item.open').forEach((x) => x.classList.remove('open'));
          menu.querySelectorAll(':scope > .submenu').forEach((x) => x.remove());
        });
        b.addEventListener('click', () => {
          this.close();
          this.run(entry);
        });
      }
      menu.append(b);
    }
    return menu;
  }

  openAt(button, items) {
    this.close();
    const menu = this.renderMenu(items);
    const r = button.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 4}px`;
    document.body.append(menu);
    button.setAttribute('aria-expanded', 'true');
    this.openMenu = { button, menu };
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.right > window.innerWidth) menu.style.left = `${Math.max(4, window.innerWidth - mr.width - 4)}px`;
    });
  }

  openCustom(anchor, entries) {
    this.close();
    const menu = document.createElement('div');
    menu.className = 'menu';
    for (const { label, html = '', run } of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.innerHTML = `<span></span><span>${label}</span>${html}`;
      b.addEventListener('click', () => {
        this.close();
        run();
      });
      menu.append(b);
    }
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(4, Math.min(window.innerWidth - 270, r.left))}px`;
    document.body.append(menu);
    this.openMenu = { button: anchor, menu };
  }

  openEffectMenu(anchor) {
    this.openCustom(
      anchor,
      Object.keys(EFFECT_LABELS).map((type) => ({ label: EFFECT_LABELS[type], run: () => this.ui.dialogs.effectDialog(type) })),
    );
  }

  close() {
    if (!this.openMenu) return;
    this.openMenu.menu.remove();
    this.openMenu.button.setAttribute?.('aria-expanded', 'false');
    this.openMenu = null;
  }

  bindKeys() {
    const app = this.app;
    const toolKeys = new Map();
    for (const t of TOOLS) if (t.key) toolKeys.set(normalizeShortcut(t.key === '+' ? 'Shift+=' : t.key), t.id);
    toolKeys.set('=', 'penAdd');
    toolKeys.set('+', 'penAdd');
    toolKeys.set('-', 'penDelete');
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (typing) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === 'Escape' && this.openMenu) {
        this.close();
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        this.ui.viewport.spaceDown = true;
        this.ui.viewport.host.style.cursor = 'grab';
        e.preventDefault();
        return;
      }
      if (this.ui.tools.key(e)) {
        e.preventDefault();
        return;
      }
      const combo = eventKey(e);
      const id = this.shortcuts.get(combo);
      if (id) {
        e.preventDefault();
        if (id === 'edit.clear' && this.ui.tools.deleteSelectedNodes()) return;
        if (id === 'edit.clear' && app.tool === 'artboard') {
          this.run('artboard.delete');
          return;
        }
        this.run(id);
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * app.prefs.nudge;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (this.ui.tools.nudgeNodes(dx, dy)) return;
        if (app.selection.length) this.ui.transformSelection(translation(dx, dy), 'Deslocar', { copy: e.altKey });
        return;
      }
      if (e.key === 'Enter' && app.tool === 'selection' && app.selection.length) {
        e.preventDefault();
        this.ui.dialogs.transformDialog('move');
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        document.getElementById('app').classList.toggle('hide-panels');
        const hidden = document.getElementById('app').classList.contains('hide-panels');
        document.getElementById('sidebar').style.display = hidden ? 'none' : '';
        return;
      }
      if (!e.altKey) {
        const key = combo.replace(/^Shift\+(.)$/, 'Shift+$1');
        if (e.key === 'd' || e.key === 'D') {
          if (!e.shiftKey) {
            this.ui.defaultPaint();
            return;
          }
        }
        if ((e.key === 'x' || e.key === 'X') && !toolKeys.has(key)) {
          if (e.shiftKey) this.ui.swapPaint();
          else {
            app.paint.focus = app.paint.focus === 'fill' ? 'stroke' : 'fill';
            app.emit('paint');
          }
          return;
        }
        if (e.key === '/') {
          this.ui.applyPaint(app.paint.focus, null);
          return;
        }
        if (e.key === ',' && !e.shiftKey) {
          this.ui.applyPaint(app.paint.focus, { type: 'color', color: paintColor(app.paint[app.paint.focus]) || '#000000' });
          return;
        }
        if (e.key === '.' && !e.shiftKey) {
          this.ui.panels.showPanel('gradient');
          return;
        }
        const tool = toolKeys.get(key) || toolKeys.get(e.key);
        if (tool) {
          app.setTool(tool);
          e.preventDefault();
        }
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.ui.viewport.spaceDown = false;
        this.ui.tools.updateCursor();
      }
    });
    document.addEventListener('paste', (e) => this.onSystemPaste(e));
  }

  async onSystemPaste(e) {
    const target = e.target;
    if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      for (const f of files) await this.ui.io.openFile(f, { place: true });
      return;
    }
    const text = e.clipboardData?.getData('text/plain') || '';
    if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text) && (!this.app.clipboard || this.app.clipboard.svg !== text)) {
      e.preventDefault();
      try {
        const result = importSVG(text);
        this.ui.io.placeItems(result.items, result.assets, 'Colar SVG');
      } catch (error) {
        this.app.toast(error.message, 'error');
      }
    }
  }

  showShortcuts() {
    const groups = [];
    groups.push(['Ferramentas', TOOLS.filter((t) => !t.sep && t.key).map((t) => [t.label, t.key])]);
    const byMenu = this.menuTree();
    const flatten = (items) => items.flatMap((i) => (Array.isArray(i) ? flatten(i[1]) : i === '-' ? [] : [i]));
    for (const [title, items] of byMenu) {
      const list = flatten(items)
        .map((id) => this.commands.get(id))
        .filter((c) => c?.key)
        .map((c) => [c.label, display(c.key)]);
      if (list.length) groups.push([title, list]);
    }
    groups.push([
      'Outros',
      [
        ['Mão temporária', 'Espaço'], ['Deslocar seleção', 'Setas (Shift: ×10, Alt: copiar)'], ['Alternar preenchimento/traçado', 'X'], ['Trocar preenchimento e traçado', 'Shift+X'],
        ['Cores padrão', 'D'], ['Nenhum', '/'], ['Cor', ','], ['Degradê', '.'], ['Ocultar painéis', 'Tab'], ['Duplicar ao arrastar', 'Alt + arrastar'], ['Sair do isolamento', 'Esc'],
      ],
    ]);
    this.ui.dialogs.shortcutsDialog(groups);
  }

  copy(cut) {
    const app = this.app;
    const items = orderIds(app.doc, app.selection).map((id) => findItem(app.doc, id).item);
    if (!items.length) return;
    const assets = {};
    for (const item of items) for (const e of walk([item])) if (e.item.type === 'image') assets[e.item.asset] = app.doc.assets[e.item.asset];
    const symbols = app.doc.symbols.filter((s) => items.some((i) => [...walk([i])].some((e) => e.item.type === 'instance' && e.item.symbol === s.id)));
    const svg = exportSVG({ ...app.doc, layers: [{ ...app.doc.layers[0], visible: true, children: items }] }, { bounds: selectionBounds(app.doc, items) });
    app.clipboard = { items: JSON.stringify(items), assets, symbols: JSON.stringify(symbols), bounds: selectionBounds(app.doc, items), svg };
    navigator.clipboard?.writeText?.(svg).catch(() => undefined);
    if (cut) this.clear('Recortar');
  }

  paste(mode) {
    const app = this.app;
    const clip = app.clipboard;
    if (!clip) return;
    const ids = app.commit('Colar', (doc) => {
      Object.assign(doc.assets, clip.assets);
      for (const s of JSON.parse(clip.symbols)) if (!doc.symbols.some((x) => x.id === s.id)) doc.symbols.push(s);
      const items = JSON.parse(clip.items).map((i) => cloneItem(i));
      let dx = 0;
      let dy = 0;
      if (mode === 'center') {
        const s = this.ui.viewport.size();
        const center = this.ui.viewport.toWorld(s.left + s.width / 2, s.top + s.height / 2);
        dx = center.x - (clip.bounds.minX + clip.bounds.maxX) / 2;
        dy = center.y - (clip.bounds.minY + clip.bounds.maxY) / 2;
      }
      if (dx || dy) for (const item of items) transformItem(item, translation(dx, dy), { scaleStrokes: false });
      if ((mode === 'front' || mode === 'back') && app.selection.length) {
        const ref = findItem(doc, orderIds(doc, app.selection)[mode === 'front' ? app.selection.length - 1 : 0]);
        if (ref) {
          ref.siblings.splice(mode === 'front' ? ref.index + 1 : ref.index, 0, ...items);
          return items.map((i) => i.id);
        }
      }
      const container = app.targetContainer();
      if (mode === 'back') container.children.unshift(...items);
      else for (const item of items) insertItem(container, item);
      return items.map((i) => i.id);
    });
    if (ids) app.select(ids);
  }

  clear(label = 'Limpar') {
    const app = this.app;
    const ids = [...app.selection];
    app.commit(label, (doc) => {
      for (const id of ids) {
        const entry = findItem(doc, id);
        if (entry && entry.item.type !== 'layer') entry.siblings.splice(entry.siblings.indexOf(entry.item), 1);
      }
    });
    app.deselect();
  }

  duplicate() {
    const app = this.app;
    const ids = app.commit('Duplicar', (doc) => {
      const created = [];
      for (const id of orderIds(doc, app.selection)) {
        const entry = findItem(doc, id);
        const copy = cloneItem(entry.item);
        transformItem(copy, translation(10, 10), { scaleStrokes: false });
        entry.siblings.splice(entry.siblings.indexOf(entry.item) + 1, 0, copy);
        created.push(copy.id);
      }
      return created;
    });
    if (ids) app.select(ids);
  }

  mapColors(label, fn) {
    this.app.commit(label, (doc) => {
      for (const id of this.app.selection) {
        for (const e of walk([findItem(doc, id).item])) {
          const it = e.item;
          if (!it.style) continue;
          it.style.fill = mapPaint(it.style.fill, fn);
          it.style.stroke = mapPaint(it.style.stroke, fn);
        }
      }
    });
  }

  blendColors() {
    const app = this.app;
    const items = orderIds(app.doc, app.selection).map((id) => findItem(app.doc, id).item).filter((i) => i.style?.fill?.type === 'color');
    if (items.length < 3) return;
    const a = items[items.length - 1].style.fill.color;
    const b = items[0].style.fill.color;
    app.commit('Mesclar cores', (doc) => {
      items.forEach((item, i) => {
        findItem(doc, item.id).item.style.fill = { type: 'color', color: mixHex(b, a, i / (items.length - 1)) };
      });
    });
  }

  transformAgain() {
    const t = this.app.lastTransform;
    if (!t) return;
    this.ui.transformSelection(t.matrix, 'Transformar novamente', { copy: t.copy });
  }

  arrange(mode) {
    const labels = { front: 'Trazer para frente', forward: 'Avançar', backward: 'Recuar', back: 'Enviar para trás' };
    this.app.commit(labels[mode], (doc) => arrange(doc, this.app.selection, mode));
  }

  toCurrentLayer() {
    const app = this.app;
    const layerId = app.active.activeLayer;
    app.commit('Enviar para a camada', (doc) => {
      const layer = doc.layers.find((l) => l.id === layerId);
      for (const id of orderIds(doc, app.selection)) {
        const entry = findItem(doc, id);
        if (!entry || entry.parent === layer) continue;
        entry.siblings.splice(entry.siblings.indexOf(entry.item), 1);
        layer.children.push(entry.item);
      }
    });
  }

  group() {
    const app = this.app;
    const id = app.commit('Agrupar', (doc) => groupItems(doc, app.selection)?.id);
    if (id) app.select([id]);
  }

  ungroup() {
    const app = this.app;
    const ids = app.commit('Desagrupar', (doc) => {
      const result = [];
      for (const id of app.selection) {
        const entry = findItem(doc, id);
        if (entry?.item.type === 'group') result.push(...ungroupItem(doc, id).map((c) => c.id));
        else result.push(id);
      }
      return result;
    });
    if (ids) app.select(ids);
  }

  lockHide(prop) {
    const app = this.app;
    const ids = [...app.selection];
    app.commit(prop === 'locked' ? 'Travar' : 'Ocultar', (doc) => {
      for (const id of ids) {
        const item = findItem(doc, id)?.item;
        if (!item) continue;
        if (prop === 'locked') item.locked = true;
        else item.visible = false;
      }
    });
    app.deselect();
  }

  unlockShowAll(prop) {
    const app = this.app;
    const changed = [];
    app.commit(prop === 'locked' ? 'Destravar tudo' : 'Mostrar tudo', (doc) => {
      for (const entry of walkDocument(doc)) {
        if (entry.item.type === 'layer') continue;
        if (prop === 'locked' && entry.item.locked) {
          entry.item.locked = false;
          changed.push(entry.item.id);
        }
        if (prop === 'visible' && entry.item.visible === false) {
          entry.item.visible = true;
          changed.push(entry.item.id);
        }
      }
    });
    app.select(changed.filter((id) => topLevelOf(app.doc, id)?.id === id));
  }

  average() {
    const app = this.app;
    const tab = app.active;
    this.ui.dialogs.open('Média', '<div class="form"><label>Eixo</label><select name="axis"><option value="both">Ambos</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option></select></div>', {
      actions: [
        { label: 'Cancelar' },
        {
          label: 'OK',
          primary: true,
          run: (d) => {
            const axis = this.ui.dialogs.values(d).axis;
            const refs = [];
            for (const [id, set] of tab.nodes) {
              const item = findItem(app.doc, id)?.item;
              if (!item) continue;
              for (const key of set) {
                const [s, n] = key.split(':').map(Number);
                if (item.subpaths[s]?.nodes[n]) refs.push({ id, s, n, node: item.subpaths[s].nodes[n] });
              }
            }
            if (refs.length < 2) return;
            const moved = averageNodes(
              refs.map((r) => r.node),
              axis,
            );
            app.commit('Média', (doc) => {
              refs.forEach((r, i) => {
                findItem(doc, r.id).item.subpaths[r.s].nodes[r.n] = moved[i];
              });
            });
          },
        },
      ],
    });
  }

  offsetPath(values) {
    const delta = this.ui.toDocUnits(values.offset);
    const ids = this.app.commit('Deslocar caminho', (doc) => offsetPath(doc, this.app.selection.flatMap((id) => [...walk([findItem(doc, id).item])].filter((e) => e.item.type === 'path').map((e) => e.item.id)), delta, values.join, values.miter));
    if (ids?.length) this.app.select(ids);
  }

  simplify(error) {
    const app = this.app;
    const ids = app.selection.flatMap((id) => [...walk([findItem(app.doc, id).item])].filter((e) => e.item.type === 'path').map((e) => e.item.id));
    app.commit('Simplificar', (doc) => simplifyPaths(doc, ids, Math.max(0.05, error || 1)));
  }

  reversePaths() {
    const app = this.app;
    app.commit('Inverter direção', (doc) => {
      for (const id of app.selection) for (const e of walk([findItem(doc, id).item])) if (e.item.type === 'path') e.item.subpaths = e.item.subpaths.map(reverseSubpath);
    });
  }

  releaseOf(label, fn, test) {
    const app = this.app;
    const targets = app.selectedItems().filter(test);
    if (!targets.length) {
      app.toast('Nada na seleção para liberar.');
      return;
    }
    const ids = app.commit(label, (doc) => targets.flatMap((t) => fn(doc, t.id) || []));
    if (ids) app.select(ids.filter(Boolean));
  }

  newArtboard() {
    const app = this.app;
    app.commit('Nova prancheta', (doc) => {
      const last = doc.artboards[doc.artboards.length - 1];
      doc.artboards.push(createArtboard(`Prancheta ${doc.artboards.length + 1}`, last.x + last.width + 40, last.y, last.width, last.height));
      app.active.activeArtboard = doc.artboards.length - 1;
    });
    this.ui.viewport.fitAll();
  }

  deleteArtboard() {
    const app = this.app;
    if (app.doc.artboards.length < 2) return;
    const index = app.active.activeArtboard;
    app.commit('Excluir prancheta', (doc) => {
      doc.artboards.splice(index, 1);
    });
    app.active.activeArtboard = Math.max(0, index - 1);
  }

  fitArtboard(selection = false) {
    const app = this.app;
    const b = selection ? app.selectionBounds() : (() => {
      let bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const layer of app.doc.layers) {
        const lb = itemBounds(layer, app.doc);
        if (!isEmptyBounds(lb)) bounds = { minX: Math.min(bounds.minX, lb.minX), minY: Math.min(bounds.minY, lb.minY), maxX: Math.max(bounds.maxX, lb.maxX), maxY: Math.max(bounds.maxY, lb.maxY) };
      }
      return isEmptyBounds(bounds) ? null : bounds;
    })();
    if (!b) return;
    app.commit('Ajustar prancheta', (doc) => {
      const a = doc.artboards[app.active.activeArtboard];
      a.x = Math.floor(b.minX);
      a.y = Math.floor(b.minY);
      a.width = Math.max(1, Math.ceil(b.maxX) - a.x);
      a.height = Math.max(1, Math.ceil(b.maxY) - a.y);
    });
  }

  selectAll(boardOnly = false) {
    const app = this.app;
    const tab = app.active;
    let pool;
    if (tab.isolation) pool = findItem(app.doc, tab.isolation)?.item.children || [];
    else pool = app.doc.layers.filter((l) => l.visible && !l.locked).flatMap((l) => l.children);
    pool = pool.filter((i) => !i.locked && i.visible !== false);
    if (boardOnly) {
      const a = app.doc.artboards[tab.activeArtboard];
      pool = pool.filter((i) => {
        const b = itemBounds(i, app.doc);
        return !isEmptyBounds(b) && b.maxX >= a.x && b.minX <= a.x + a.width && b.maxY >= a.y && b.minY <= a.y + a.height;
      });
    }
    this.previous = [...app.selection];
    app.select(pool.map((i) => i.id));
  }

  reselect() {
    if (this.previous) this.app.select(this.previous.filter((id) => findItem(this.app.doc, id)));
  }

  inverse() {
    const app = this.app;
    const current = new Set(app.selection);
    const pool = app.doc.layers.filter((l) => l.visible && !l.locked).flatMap((l) => l.children).filter((i) => !i.locked && i.visible !== false && !current.has(i.id));
    app.select(pool.map((i) => i.id));
  }

  stepSelection(direction) {
    const app = this.app;
    const all = app.doc.layers.filter((l) => l.visible && !l.locked).flatMap((l) => l.children).filter((i) => !i.locked && i.visible !== false);
    if (!all.length) return;
    const current = app.selection.length ? all.findIndex((i) => i.id === app.selection[0]) : -1;
    const next = all[(current + direction + all.length) % all.length];
    if (next) app.select([next.id]);
  }

  docBounds() {
    return documentBounds(this.app.doc);
  }
}
