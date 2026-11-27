const STEPS = [
  { target: '#tools', title: 'Ferramentas', text: 'Seleção (V), Seleção direta (A), Caneta (P), formas, pincéis, borracha, transformação, Construtor de formas, degradê e mais. Clique duas vezes numa ferramenta para ver as opções dela.' },
  { target: '#options', title: 'Barra de controle', text: 'Mostra o preenchimento, o traçado, a opacidade, a posição e o tamanho do que está selecionado, além das opções da ferramenta ativa.' },
  { target: '#canvas-host', title: 'Prancheta', text: 'Arraste para desenhar. Role para mover a vista, Ctrl + rolagem (ou Alt) para dar zoom e segure Espaço para usar a mão. Arraste a partir das réguas para criar guias.' },
  { target: '.paint-widget', title: 'Preenchimento e traçado', text: 'O quadrado da frente recebe a cor. X alterna entre preenchimento e traçado, Shift+X troca os dois, D volta ao padrão e / tira a cor.' },
  { target: '#sidebar', title: 'Painéis', text: 'Transformar, Aparência, Cor, Amostras, Degradê, Traçado, Transparência, Alinhar, Pathfinder, Caractere, Símbolos, Pranchetas e Camadas. Clique no título para abrir ou fechar.' },
  { target: '#menus', title: 'Menus', text: 'Arquivo, Editar, Objeto, Texto, Selecionar, Efeito, Exibir, Janela e Ajuda, com os mesmos atalhos do teclado de sempre. Ajuda → Atalhos do teclado mostra a lista inteira.' },
  { target: '#save', title: 'Salvar e exportar', text: 'Ctrl+S salva o arquivo .vinco onde você escolher. Em Arquivo → Exportar saem SVG, PDF (todas as pranchetas), PNG e JPEG. Um rascunho fica guardado sozinho enquanto você trabalha.' },
];

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.index = 0;
    this.nodes = [];
  }

  offer() {
    if (this.app.prefs.tutorialDone) return;
    this.start();
  }

  start() {
    this.index = 0;
    this.show();
  }

  finish() {
    for (const n of this.nodes) n.remove();
    this.nodes = [];
    this.app.prefs.tutorialDone = true;
    this.app.savePrefs();
    document.removeEventListener('keydown', this.onKey, true);
  }

  onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.finish();
    }
  };

  show() {
    for (const n of this.nodes) n.remove();
    this.nodes = [];
    const step = STEPS[this.index];
    const target = document.querySelector(step.target);
    if (!target) {
      this.finish();
      return;
    }
    const r = target.getBoundingClientRect();
    const highlight = document.createElement('div');
    highlight.className = 'tour-highlight';
    Object.assign(highlight.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    const card = document.createElement('div');
    card.className = 'tour';
    card.setAttribute('role', 'dialog');
    card.innerHTML = `<h4>${this.index + 1}/${STEPS.length} · ${step.title}</h4><p>${step.text}</p><div class="dialog-actions" style="margin-top:0"><button type="button" class="button" data-skip>Pular</button>${this.index ? '<button type="button" class="button" data-back>Voltar</button>' : ''}<button type="button" class="button primary" data-next>${this.index === STEPS.length - 1 ? 'Concluir' : 'Próximo'}</button></div>`;
    document.body.append(highlight, card);
    const cw = 300;
    let left = r.right + 14;
    let top = r.top;
    if (left + cw > window.innerWidth) left = Math.max(10, r.left - cw - 14);
    if (left < 10 || r.width > window.innerWidth * 0.5) {
      left = Math.min(window.innerWidth - cw - 10, Math.max(10, r.left + r.width / 2 - cw / 2));
      top = r.bottom + 14;
    }
    const ch = card.getBoundingClientRect().height;
    if (top + ch > window.innerHeight - 10) top = Math.max(10, Math.min(r.top - ch - 14, window.innerHeight - ch - 10));
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    card.querySelector('[data-skip]').addEventListener('click', () => this.finish());
    card.querySelector('[data-back]')?.addEventListener('click', () => {
      this.index -= 1;
      this.show();
    });
    card.querySelector('[data-next]').addEventListener('click', () => {
      if (this.index === STEPS.length - 1) this.finish();
      else {
        this.index += 1;
        this.show();
      }
    });
    this.nodes = [highlight, card];
    document.removeEventListener('keydown', this.onKey, true);
    document.addEventListener('keydown', this.onKey, true);
    card.querySelector('[data-next]').focus();
  }
}
