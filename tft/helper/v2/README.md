# TFT Compass · interface

Interface principal do helper (a v1 foi removida em outubro de 2026; planejador, comps, itens e lobby
ficam no histórico do git). Consome `/api/state`, `/api/recommend`, `/api/catalog`, `/api/comps`, `/api/history` e `/api/events`.

- Abrir: `http://127.0.0.1:3218/` (`/v2/` redireciona). Dados simulados: `/?mock=completo`, galeria em `/live-mock.html`.
- Visões: **Ao vivo** (`/`), **Comps** (`/#comps`) e **Histórico** (`/#historico`).
- Testes: `node --test tft/helper/match.test.mjs "tft/helper/v2/js/*.test.mjs" "tft/helper/tests/*.test.mjs"`.

## Estrutura

| Arquivo         | Papel                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `js/math.js`    | Molas amortecidas (viram `linear()`), hexágonos, arcos Bézier, binomial, interpolação monótona. Puro. |
| `js/model.js`   | `buildModel`: resposta da API → modelo de visão (HUD, formação, trocas, trilha, painel). Puro.        |
| `js/api.js`     | Rede e chave de cache da análise.                                                                     |
| `js/comps.js`   | Seleção de comp: estilo de nível, filtros, ordenação e comp fixada por partida. Puro.                 |
| `js/history.js` | Resumo, sinergias ativas e ordenação dos registros do histórico. Puro.                                |
| `js/dom.js`     | `el`/`svg`, reconciliação por chave, FLIP com mola, publicação das molas como custom properties.      |
| `js/ui/*`       | Componentes com DOM estável: `hud`, `board` (SVG), `steps`, `panel`.                                  |
| `css/*`         | `@layer`, tokens OKLCH, CSS nesting, container queries, `@property`, `@starting-style`.               |

## Decisões

- DOM estável + custom properties: o JS escreve números (`--p`, `--n`, `--x`) e o CSS anima. Nada de recriar HTML a cada leitura.
- Contadores e anéis animam com `@property` (sem `requestAnimationFrame`); posições com `translate` e mola.
- A curva "ouro × chance de fechar o upgrade" é P(X ≥ k), X ~ Binomial(n lojas, chance por loja), aproximação independente.
