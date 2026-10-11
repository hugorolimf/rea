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
- A interface continua puxando com a aba oculta ou a janela minimizada (`js/live-loop.js`): buscar (`/api/state` e, quando a chave muda, a análise) roda sempre; só o desenho do DOM espera a aba voltar, e ao voltar aparece na hora com o último dado, seguido de uma leitura nova. Ver "Segundo plano" abaixo.
- O modo de compatibilidade `legacyServer` (servidor anterior ao M7) foi removido de `recommendPayload`/`main.js`.

## Segundo plano (aba oculta, janela minimizada)

O que a página faz:

- **Gatilho principal: eventos do servidor (SSE, `/api/events`).** Cada evento pede uma leitura (rajadas de 200 ms viram uma
  só). O navegador não segura eventos de rede em segundo plano. O `EventSource` é um só por origem, mantido pela aba
  que detém o Web Lock `tft-helper-events` e repassado às outras abas por `BroadcastChannel` (`js/sse-share.js`).
- **Reserva: temporizador** de 5 s depois da última leitura (de qualquer origem), com o mesmo recuo em falha (5, 10, 20,
  30 s). Qualquer leitura empurra o temporizador, então evento e temporizador não se somam; com uma leitura em
  andamento o temporizador não abre outra. É reagendado a partir da resposta de rede, não de dentro do próprio
  temporizador, o que quebra a "cadeia de temporizadores" que o Chrome/Edge espaça para cerca de 1 por minuto depois de
  5 min de aba oculta (throttling intensivo). Continua valendo a regra básica: em segundo plano os temporizadores rodam no
  máximo uma vez por segundo, o que não afeta um ciclo de 5 s.
- **Desenho adiado.** Com a aba oculta só o último desenho fica guardado; quando ela volta (`visibilitychange`, `resume`
  do Page Lifecycle ou `pageshow` do cache de navegação), ele aparece na hora e uma leitura nova é pedida (sem repetir
  uma que já esteja a caminho).
- **Idade na volta.** Se a última leitura tem mais de 8 s quando a aba volta, a barra de conexão mostra
  "atualizando · última leitura há N" até a leitura nova chegar.

O que o servidor avisa por SSE hoje: tabuleiros novos (`boards`, quando o arquivo de tabuleiros do jogo muda, em geral
na troca de rodada), início/fim de partida (`match`) e nova cópia de meta (`meta`). **Não avisa** mudanças só do GEP
(ouro, loja, nível/XP, banco, aprimoramentos) nem o fim de uma análise automática; para essas, a página depende do
temporizador de reserva. Pedido registrado em `../planos/a-fazer/otimizar-fluxos-de-analise.md` ("Pendências de servidor").

Limites reais do navegador (não contornáveis pela página, e sem truques como áudio silencioso):

- **Congelamento** (Energy Saver/"economia de energia" do Chrome/Edge e "Abas em suspensão" do Edge): uma aba congelada
  não roda nada, nem o SSE. Ao descongelar, o `EventSource` reconecta, a página desenha o último dado e busca o atual.
  A aba que detém o Web Lock tende a ser poupada, mas isso não é garantia documentada.
- **Descarte** (Memory Saver/"economia de memória"): a aba é descarregada e, ao voltar, recarrega do zero (casca do
  cache do service worker, dados do servidor).
- Para evitar os dois: adicione `127.0.0.1:3218` em Configurações → Desempenho → "Sempre manter estes sites ativos"
  (Chrome) ou "Nunca colocar estes sites em suspensão" (Edge). Instalar o app (PWA) abre uma janela própria, que não
  disputa espaço com outras abas; minimizada ou coberta, ela também conta como oculta para o navegador.
- O servidor conduz a análise sozinho (M10b): mesmo com a página congelada ou fechada, nada da partida se perde; a
  página só fica sem mostrar até voltar.
- Atualização: os arquivos de `v2/` são lidos do disco a cada pedido (`no-cache`, `static-files.mjs`) e o service worker
  busca a casca na rede primeiro; recarregar a página basta. Só quando `sw.js` muda aparece "Nova versão do app
  disponível".
