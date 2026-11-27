# Histórico de versões

## 1.0.0 — 27/11/2026

Primeira versão do Vinco, editor de ilustração vetorial que roda no navegador.

**Desenho:** 36 ferramentas em duas colunas, com ícones vetoriais: Seleção, Seleção direta, Varinha mágica, Laço, Caneta, Ponto de ancoragem, Adicionar e Excluir ponto, Texto, Texto no caminho, Segmento de linha, Arco, Espiral, Grade retangular, Retângulo, Retângulo arredondado, Elipse, Polígono, Estrela, Pincel, Pincel de bolhas, Lápis, Borracha, Tesoura, Girar, Refletir, Escala, Distorcer, Construtor de formas, Degradê, Conta-gotas, Medida, Mesclagem, Prancheta, Mão e Zoom. Cada uma com os atalhos de sempre, Shift e Alt para travar ângulos, proporções e desenhar a partir do centro, e opções com clique duplo.

**Objetos:** caminhos Bézier com subcaminhos e regras de preenchimento, grupos com modo de isolamento, máscaras de recorte, caminhos compostos, mesclagens com etapas, símbolos com instâncias, texto de ponto, de área (com quebra e justificação) e no caminho, e imagens inseridas com Traçado de imagem.

**Pathfinder e geometria:** Unir, Menos frente, Interseção, Excluir sobreposição, Dividir, Aparar, Mesclar, Cortar demarcação, Contorno e Menos fundo, com recuperação das curvas do resultado; Construtor de formas; Contornar traçado; Deslocar caminho; Simplificar; Unir; Média; Inverter direção.

**Aparência:** cor em RGB, HSB e CMYK, amostras, degradês lineares e radiais com paradas e opacidade, traçado com pontas, cantos, tracejado e setas, opacidade, 16 modos de mesclagem e oito efeitos editáveis (sombra projetada, desfoque gaussiano, brilho externo, brilho interno, cantos arredondados, zigue-zague, áspero e franzir e inchar).

**Interface:** quatro paletas de cores, cada uma com tema claro e escuro; 9 menus, barra de controle, 13 painéis recolhíveis (Transformar, Aparência, Cor, Amostras, Degradê, Traçado, Transparência, Alinhar, Pathfinder, Caractere e parágrafo, Símbolos, Pranchetas e Camadas), abas para vários documentos, réguas com guias, grade, guias inteligentes, modo Contorno, tela cheia, tutorial rápido e lista de atalhos.

**Arquivos:** formato `.vinco` com imagens embutidas, Salvar como na pasta escolhida, rascunho automático no navegador com recuperação, importação de SVG e de PNG, JPEG, GIF e WebP, colagem de SVG e de imagens da área de transferência, e exportação em SVG, PDF com uma página por prancheta, PNG e JPEG em até 300 ppi.

**Servidor:** Django 6.1 com PostgreSQL 17 (ou SQLite), API REST com documentos, versões, restauração, controle de conflitos por revisão, exportação SVG no servidor e download do `.vinco`; imagens guardadas uma vez por documento e conferidas pela assinatura dos bytes; Docker Compose e scripts de início para Windows, Linux e macOS.

**Qualidade e segurança:** 55 testes do núcleo em JavaScript, 27 testes da API e 33 testes ponta a ponta da interface, Ruff, Bandit, `check --deploy`, CSP restrita no servidor e no `Vinco.html`, CSRF, token de API, limite de escritas por IP e validação completa dos documentos no editor e no servidor. CI no GitHub Actions e publicação automática no GitHub Pages.
