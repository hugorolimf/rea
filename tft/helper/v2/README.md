# TFT Compass · interface

Interface principal do helper (a v1 foi removida em outubro de 2026; planejador, comps, itens e lobby
ficam no histórico do git). App web instalável (PWA) servido pelo próprio servidor do helper, em módulos ESM sem build e sem
dependências. Consome `/api/state`, `/api/recommend`, `/api/catalog`, `/api/comps`, `/api/items`, `/api/history` e `/api/events` (SSE).

- Abrir: `http://127.0.0.1:3218/` (`/v2/` redireciona). Dados simulados: `/?mock=completo`, galeria de cenários em `/live-mock.html`.
- Telas por endereço: **Ao vivo** (`#ao-vivo` ou vazio), **Comps** (`#comps`), **Itens** (`#itens`), **Histórico** (`#historico`) e partida revista (`#partida/<id>`).
- Tema: segue o sistema; `?theme=light|dark` na URL ou Ajustes (`?`) forçam um.
- Design system, decisões de tecnologia, componentes e checklist de acessibilidade: [`DESIGN.md`](DESIGN.md). Galeria dos componentes (abre do disco, sem servidor): [`gallery.html`](gallery.html).
- Testes: `node --test match.test.mjs "v2/js/*.test.mjs" "tests/*.test.mjs"` (a partir de `tft/helper`).

## Estrutura

| Arquivo                                                             | Papel                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `index.html`                                                        | Casca: barra do app, navegação, palco, diálogo de ajustes, sprite de ícones, `modulepreload`                 |
| `manifest.webmanifest`, `icons/`, `sw.js`                           | PWA: instalável, casca offline (nunca guarda `/api/*`); servidos em `/manifest.webmanifest` e `/sw.js`       |
| `js/router.js`                                                      | Telas e hash (`parseHash`, `hashFor`, títulos, atalhos 1–4). Puro.                                           |
| `js/prefs.js`                                                       | Preferências (tema, movimento, topo fixo) e `safeStorage` (localStorage com fallback em memória). Puro.      |
| `js/connection.js`                                                  | Estado da conexão, idade do dado e recuo das tentativas (`connectionView`, `retryDelay`). Puro.              |
| `js/focus.js`                                                       | "Foco agora": o resumo de urgência da rodada a partir do modelo. Puro.                                       |
| `js/math.js`                                                        | Molas amortecidas (viram `linear()`), hexágonos, arcos Bézier, binomial, interpolação monótona. Puro.        |
| `js/model.js`                                                       | `buildModel`: resposta da API → modelo de visão (HUD, formação, trocas, trilha, painel). Puro.               |
| `js/api.js`, `js/sse-share.js`                                      | Rede (erros de conexão distintos de erros de resposta), chave de cache da análise, SSE compartilhado.        |
| `js/comps.js`, `js/suggest.js`, `js/history.js`, `js/items.js`, ... | Lógica pura de cada tela (seleção de comp, sugestões, histórico, banco de itens, plano, Wisps, ...).         |
| `js/dom.js`                                                         | `el`/`svg`, reconciliação por chave, FLIP com mola, publicação das molas como custom properties.             |
| `js/pwa.js`                                                         | Registro do service worker e aviso de versão nova.                                                           |
| `js/ui/*`                                                           | Componentes com DOM estável: `shell`, `focus-bar`, `tooltip`, `hud`, `board`, `steps`, `panel`, `comps`, ... |
| `css/*`                                                             | `@layer`, tokens OKLCH com tema claro/escuro, nesting, container queries, `@property`, `@starting-style`.    |

## Decisões

- DOM estável + custom properties: o JS escreve números (`--p`, `--n`, `--x`) e o CSS anima. Nada de recriar HTML a cada leitura.
- Contadores e anéis animam com `@property` (sem `requestAnimationFrame`); posições com `translate` e mola.
- A curva "ouro × chance de fechar o upgrade" é P(X ≥ k), X ~ Binomial(n lojas, chance por loja), aproximação independente.
- O servidor conduz a análise sozinho (M10b): a janela só mostra. A barra do app diz se esta janela está falando com o servidor e quão velho é o dado; sem servidor a interface abre do cache e mostra a última leitura.
- O modo de compatibilidade `legacyServer` (servidor anterior ao M7) foi removido de `recommendPayload`/`main.js`.
