# TFT Compass v2 · tela Ao vivo

Nova interface, só de apresentação: consome os mesmos endpoints da v1 (`/api/state`, `/api/recommend`,
`/api/catalog`, `/api/events`) e não altera motor, estratégia nem regras.

- Abrir: `http://127.0.0.1:3218/v2/` (com dados simulados: `/v2/?mock=completo`, galeria em `/live-mock.html`).
- Testes de matemática e do modelo de visão: `node --test tft/helper/v2/js/math.test.mjs tft/helper/v2/js/model.test.mjs`.

## Estrutura

| Arquivo       | Papel                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `js/math.js`  | Molas amortecidas (viram `linear()`), hexágonos, arcos Bézier, binomial, interpolação monótona. Puro. |
| `js/model.js` | `buildModel`: resposta da API → modelo de visão (HUD, formação, trocas, trilha, painel). Puro.        |
| `js/api.js`   | Rede e chave de cache da análise.                                                                     |
| `js/dom.js`   | `el`/`svg`, reconciliação por chave, FLIP com mola, publicação das molas como custom properties.      |
| `js/ui/*`     | Componentes com DOM estável: `hud`, `board` (SVG), `steps`, `panel`.                                  |
| `css/*`       | `@layer`, tokens OKLCH, CSS nesting, container queries, `@property`, `@starting-style`.               |

## Decisões

- DOM estável + custom properties: o JS escreve números (`--p`, `--n`, `--x`) e o CSS anima. Nada de recriar HTML a cada leitura.
- Contadores e anéis animam com `@property` (sem `requestAnimationFrame`); posições com `translate` e mola.
- A curva "ouro × chance de fechar o upgrade" é P(X ≥ k), X ~ Binomial(n lojas, chance por loja), aproximação independente.
