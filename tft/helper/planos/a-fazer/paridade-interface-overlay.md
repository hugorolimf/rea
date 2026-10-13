# Paridade interface × overlay

Auditoria de 2026-10-12 (`tft-paridade`), feita no disco da branch `tft-helper-next` (HEAD `f352cd1d`, árvore limpa), só por
código, funções puras e testes focados. Pergunta do usuário: "a interface e o overlay mostram os mesmos dados?".
Subagentes usados (somente leitura, revisados aqui): decisão da rodada e selos; comp, Formação e itens; avisos, carrossel e
aprimoramentos. O caminho dos dados no servidor, o ritmo de atualização e os testes ficaram com o auditor principal.

> **A v2 auditada é a de antes da reorganização do Ao vivo.** Durante a auditoria (14:14–14:31 de 2026-10-12) outra sessão
> começou a mudar a árvore: "Agora" e "Substituições" passam para dentro do tabuleiro da Formação, a Loja vira uma faixa
> sob o tabuleiro e o Roll vira uma lista única com o "achar rolando" (`v2/js/main.js`, `ui/panel.js`, `ui/steps.js`,
> `ui/subs.js`, `ui/board.js`, `board-look.js`, CSS). Todas as linhas citadas da v2 são as do HEAD `f352cd1d`.
> Não mudaram: `overlay/`, `core/`, `app/`, `strategy.mjs`, `v2/js/model.js`, `focus.js`, `api.js`, `comps.js`, `augs.js`,
> `connection.js`, `ui/inventory.js`, `ui/hud.js` e o laço `pull()` de `main.js`. Por isso as divergências do lado do overlay e
> do servidor (1–13) continuam valendo como estão. O que precisa ser reconferido depois do commit dessa sessão é só o
> **equivalente na interface** de: selo de rolar e pílula do painel Rolagem (1, 4), lista Comprar/Loja (2: a faixa nova mostra
> cada carta de `stage.shop` com a ação dela, a mesma fonte das compras do turn, então a interface passa a marcar a carta que o
> overlay não marca), passos Trocar/Segure/Vaga livre e Substituições (8, 14) e o seletor da Formação (10).
>
> Testes: os focados foram rodados uma vez no início, antes da regra nova do usuário (não rodar testes de nenhum tipo); depois
> dela nada mais foi executado além de funções puras sobre dados gravados.

## Veredito geral

**Não, não totalmente.** O overlay chama o mesmo `buildModel` da interface sobre o mesmo par estado + análise, então a comp
exibida, a Formação da comp do plano, as trocas aceitas, os itens por campeão, o próximo item, o "Passar itens", a oferta
de aprimoramentos, o carrossel e o código "Copiar comp" saem iguais. O que diverge para quem joga é a **decisão da rodada**:
a interface ("Foco agora") lê `strategy.turn`, e os selos e dicas do overlay leem os painéis separados (rolagem, nível,
economia, `stage.buyNow`). Na mesma entrada o overlay manda rolar quando o turn manda subir e guardar, e não marca na loja a
carta que o turn manda comprar. Além disso, o overlay recebe o conselho provisório da rodada nova e a interface não, e a
interface congela a tela inteira enquanto espera a análise.

| Área                      | Veredito                                      | Resumo                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agora / decisão da rodada | **diverge**                                   | O overlay calcula `turn.headline` e não o desenha; só o selo de XP usa o turn. Rolar, ouro e compra vêm de outros campos (divergências 1 e 2)                                                                                                |
| Loja / comprar            | **diverge**                                   | Dicas "Compre X" = linhas Comprar (`buyNow` + cópias); Foco = compras do turn (`stage.shop` "comprar"). 6 casos do pipeline real com carta mandada comprar e sem dica                                                                        |
| Nível / XP / ouro         | igual com ressalvas                           | Selo de XP segue o turn; "suba agora" é a mesma fórmula do turn. Selo de ouro = `economy.keep` (o mesmo "piso" do HUD), some quando `keep` vem nulo e o turn ainda guarda (2 casos)                                                          |
| Rolagem                   | **diverge**                                   | Selo verde "role N vezes" com o turn sem passo de rolar (5 de 18 variantes do pipeline real; 28 de 1960 sintéticos). O selo do painel Rolagem da própria interface contradiz o Foco do mesmo jeito. "achou: X" usa a loja da hora da análise |
| Comp e Formação           | igual na comp do plano                        | Mesma comp ao abrir em 33 de 33 casos; o seletor local "ver recomendada" da interface não afeta o overlay (é só tela). Diverge nas "Sugerida N" e quando o painel do overlay fica preso numa comp                                            |
| Itens                     | igual na regra, diverge na ordem e no frescor | Mesmo `ownedItemAdvice`; o "Montar agora" do overlay ordena pelo carry antes do tipo e esconde o que dá para montar; banco não lido e banco de agora tratados de jeitos diferentes                                                           |
| Aprimoramentos            | igual na oferta                               | Mesma `augOfferView` (5 de 5). Os escolhidos só aparecem na interface                                                                                                                                                                        |
| Substitutos               | igual na comp do plano                        | Mesmo `stage.slots`. Nas "Sugerida N" o overlay inverte titular e temporário (6 de 56 comps); "Vaga livre" só na interface                                                                                                                   |
| Avisos de vida            | **diverge**                                   | `panels.economy.alert` só no overlay (11 de 12 quadros reais); a barra de vida "baixa" da interface usa a própria regra (vida ≤ 30)                                                                                                          |
| Carrossel                 | igual                                         | Mesma fonte (`state.carousel`) e mesma ordem (24 de 24); o overlay corta em 5                                                                                                                                                                |
| Estados e idade do dado   | diverge no texto                              | Dois textos do overlay são falsos desde o laço automático; idades medidas com referências diferentes                                                                                                                                         |

## 1. Caminho dos dados

**Interface.** `v2/js/main.js:693-812`: `GET /api/state`; chave `analysisKey` (`core/state/analysis-key.mjs:40`) com as
decisões do `localStorage` deste navegador (`decisionsOf`, `v2/js/api.js:81`; lojas `goalStore` em `v2/js/comps.js:177`,
`swapStore`, `augStore`); se a chave mudou, `POST /api/recommend` (`api.js:137`, prazo de 60 s) e **só depois** desenha
`buildModel({ state, rec })` com o `rec` do próprio POST (`main.js:791-812`). A interface nunca lê `/api/overlay` nem as
decisões guardadas no servidor.

**Servidor.** `app/recommend.mjs`: guarda as decisões de todo POST da interface (`source: "ui"`, set 18) em
`planState.setDecisions` (`:292-302`, persistido em disco, `plan-state.mjs:374`); antes da análise pesada,
`roundAdvice.observe` (`:432-444`) grava no feed do overlay o corpo anterior com o conselho refeito para a economia de agora,
marcado `provisional`; no fim, `roundAdvice.publish` (`:488-492`, `:594-601`, `app/round-advice.mjs:131-150`) grava no feed
o corpo novo, ou ele refeito se a economia já mudou. **A resposta do POST é o corpo sem o refeito.** O laço automático
(`server.mjs:643-681`, `app/auto-refresh.mjs:155-214`) só roda com partida em andamento (fase do cliente `InProgress`): lê o
estado a cada 3 s (grava no feed, `server.mjs:658-661`), monta a chave com `planState.decisions(gameId)` (as do último POST
da interface nesta partida, ou `DEFAULT_DECISIONS`) e roda o mesmo pipeline quando a chave muda, publicando no feed.

**Overlay.** O Electron carrega `http://127.0.0.1:3218/overlay/index.html` (`overlay/main.mjs:183`); o HUD faz
`GET /api/overlay` a cada 1 s (`overlay/hud/poll.mjs:7`, `hud.mjs:560`), não usa `localStorage` nem faz POST (conferido por
busca em `overlay/`), e monta a tela com `overlayView` (`overlay/hud/view.mjs`), que chama o `buildModel` da v2 com a mesma
cópia de metadados do estado que `main.js` faz (`adjusted`, `view.mjs:46`). O plano exibido é `rec.preview ?? rec.recommendations[0]`
nos dois (`v2/js/model.js:453`, `view.mjs:851`).

**(a) Com a interface fechada**, o overlay mostra o estado lido pelo laço (a cada 3 s) e a análise do laço com as últimas
decisões que a interface mandou nesta partida (sobrevivem ao reinício do servidor), mais o conselho provisório. Sem nenhum POST
da interface na partida, vale o automático puro (nenhuma comp fixada; aprimoramentos do GEP). Fora de partida nada se renova,
mas a janela do overlay some junto com a do jogo (`overlay/main.mjs:591-597`).

**(b) Decisões da interface chegam ao overlay**, mas só pelo servidor e só pela interface que fez o último POST:

- comp fixada, trocas e aprimoramentos marcados aparecem no overlay quando a análise desse POST é publicada, no mesmo momento
  em que a interface os desenha;
- o seletor local "ver recomendada / ver 1ª sugerida" da Formação (`main.js:387-459`) e o painel de comps do overlay
  (atalhos F3/F4/F5, `comp.mjs:465-500`) são só de tela e não se afetam;
- **risco**: a decisão mora no `localStorage` de cada navegador (Edge × Chrome, `localhost` × `127.0.0.1`, janela anônima,
  outro aparelho). Uma segunda interface manda decisões vazias no primeiro POST e o servidor as grava por cima: o overlay
  perde a comp fixada, as trocas e os aprimoramentos marcados, e as duas interfaces passam a se alternar. Provado em
  `scratchpad/main/two-uis.mjs` com as lojas reais da v2 e o `planTracker`.

**(c) Sim, os dois podem estar com análises diferentes ao mesmo tempo**:

1. conselho provisório: só o feed o recebe (abaixo, "Momento");
2. análise atrasada: o POST devolve à interface o corpo da economia antiga e o feed recebe o mesmo corpo refeito para a
   economia de agora (`round-advice.mjs:131-146`);
3. o laço publica antes de a interface pedir a mesma chave: o overlay fica à frente por até ~5 s mais o tempo da análise
   (dados iguais depois);
4. duas interfaces com decisões diferentes (item b).

## 2. Momento

|                   | Overlay                                                                                                                                              | Interface                                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estado            | o último gravado no feed: a cada `GET /api/state` da interface (5 s ou evento SSE) e a cada tick do laço (3 s, só em partida); consultado a cada 1 s | o do próprio `GET /api/state` (5 s ou SSE), mas só desenhado junto com a análise                                                                                                                                                            |
| Análise           | a última publicada: POST da interface, laço, ou provisório refeito na hora                                                                           | a do próprio POST, quando a chave muda                                                                                                                                                                                                      |
| Durante a análise | desenha o estado novo com a análise anterior ou a provisória                                                                                         | **tela inteira congelada** no par anterior (`main.js:791`); só o banco de itens é atualizado (`:786`); a classe `is-loading` (`:693`) não tem CSS, então nada indica "analisando"                                                           |
| Idade mostrada    | idade de cada fatia do feed; aviso e esmaecimento acima de 120 s (`view.mjs:994-1022`)                                                               | idade do arquivo do jogo (`state.ageSeconds`) mais o tempo desde a leitura (`connection.js:44-48`); durante o POST a barra diz "agora" (cada evento SSE redesenha a barra, `api.js:188`, `main.js:895`) enquanto a tela é a do par anterior |

Tempo das análises no `server.log` desde 2026-10-11: laço n = 904, mediana 3,0 s, p90 17,8 s, máximo 80,4 s; POST sem cache
n = 590, mediana 2,7 s, p90 17,2 s, máximo 55,2 s. Nesses intervalos o overlay pode estar numa decisão e a interface noutra.

Prova (`scratchpad/main/provisional.mjs`, sequência real de 4-1 da partida 3292194088, pipeline de `round-advice`): no começo de
4-1 o overlay diz "Suba para 7 → guarde 64g" e a interface continua em "Compre Xayah → guarde 27g" (3-7) até a análise de 4-1
voltar; em 4 de 5 momentos as duas saídas diferem. Num deles a interface recebe "Suba para 7 → guarde 64g" (análise feita com
80 g) enquanto o overlay já mostra "Guarde 40g" (economia de agora).

Defeito do provisório que só aparece no overlay (`scratchpad/main/sameround.mjs`): na mesma rodada,
`refreshAdvice(…, { sameRound: true })` mantém a loja classificada antes (`round-advice.mjs:63-65`). Depois de comprar Xayah
(44 → 40 g) o overlay passa a dizer "Compre Xayah → guarde 36g"; depois de rolar uma vez, "Compre Xayah → guarde 38g" com a loja
já trocada. A chave da economia (`economyKey`, `:20-29`) não inclui a loja.

## 3. Inventário

Classes: **idêntico** (mesma função sobre o mesmo campo), **apresentação** (mesma fonte, outra forma), **regra própria**
(um lado recalcula), **só de um lado**, **tempo diferente**.

| Elemento do overlay (`ELEMENT_IDS`/selo)                  | Fonte no overlay                                            | Equivalente na interface                                                                                              | Classe                                                       | Nota                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `bar`: fase, nível (≥/~), XP, ouro, vida                  | `view.mjs:76-153`, `draw.mjs:95-125`                        | painel de status `ui/hud.js:179-313`                                                                                  | apresentação                                                 | prefixos ≥/~ e títulos escritos duas vezes                                              |
| `bar`: chip ao vivo/nova/encerrada                        | `view.mjs:88-99`                                            | `ui/hud.js:211-222`                                                                                                   | apresentação                                                 | igual em 15 de 15                                                                       |
| `bar`: chip do GEP                                        | `view.mjs:143-149`                                          | `ui/hud.js:199-210`                                                                                                   | apresentação                                                 | o compacto esconde o chip com GEP ativo                                                 |
| `bar`: vida baixa                                         | número só                                                   | `ui/hud.js:231-234` (`POLICY.hp.danger` = 30)                                                                         | regra própria (interface)                                    | o servidor usa `pressure` (perigo até 45–50 conforme estágio e tabuleiro)               |
| `turn.headline` (linha da decisão)                        | `view.mjs:1124`                                             | `focus.js:42-46` (`headline`)                                                                                         | não desenhado em nenhum dos dois                             | o Foco desenha os passos do turn; o overlay não desenha nada do turn além do selo de XP |
| Selo de rolar (botão Atualizar)                           | `badges.mjs:58` ← `view.mjs:272-302` (`rolling.call`)       | Foco `focus.js:153-170` (passo `roll` do turn); pílula do painel Rolagem `model.js:105`                               | **regra própria** frente ao Foco; idêntico ao painel Rolagem | divergência 1                                                                           |
| Alvos do selo (até 3)                                     | `view.mjs:169-242` (`rollFor.targets`)                      | Foco: 2 alvos do passo `roll`                                                                                         | apresentação                                                 |                                                                                         |
| "achou: X" na carta                                       | `badges.mjs:182-199` ← `view.mjs:248-262` (`rollFor.slots`) | "Na loja" do painel Rolagem, cruzado com a loja de agora (`model.js:846`)                                             | **tempo diferente**                                          | divergência 4                                                                           |
| Selo de nível (Comprar XP)                                | `badges.mjs:218-283` ← `view.mjs:860-881`                   | Foco `focus.js:153-160`; painel Nível `panel.js:318-327`                                                              | idêntico com turn; regra própria sem turn (curva padrão)     | o servidor atual sempre manda turn                                                      |
| Selo de ouro ⚑                                            | `badges.mjs:290-318` ← `view.mjs:829-847` (`keep ?? floor`) | "piso" do HUD `ui/hud.js:284-301`; "Guardar Ng" do Foco (`turn.gold.keep`)                                            | idêntico ao HUD; igual ao Foco menos com `keep` nulo         | divergência 6                                                                           |
| Dica "Compre X" na loja                                   | `hints.mjs:142-171` ← `view.mjs:756-780` (passo `buy`)      | lista Comprar `model.js:597-642` (idêntica); Foco "Comprar na loja" (`turn.steps` de compra = `stage.shop` "comprar") | **regra própria** frente ao Foco                             | divergência 2                                                                           |
| "⇄ Compre X (temporário)"                                 | `hints.mjs:172-195` ← `swaps.mjs:69-81`                     | rótulo da vaga `model.js:234-269`                                                                                     | apresentação                                                 | não cobre temporário para vaga vazia                                                    |
| Dicas "Role até Ng", "Vale esperar o nível N", "Não role" | `hints.mjs:241-296`                                         | pílula do painel Rolagem                                                                                              | idêntico                                                     | com turn, o Foco não mostra "esperar/não rolar"                                         |
| Juros, "Suba de nível"                                    | `hints.mjs:297-347`                                         | HUD                                                                                                                   | idêntico                                                     | o overlay omite juros +0                                                                |
| Aviso de vida `alert:hp`                                  | `hints.mjs:110-139` ← `economy.alert`                       | nenhum (só a cor da barra; frase dentro de "Por quê", `panel.js:456-461`)                                             | **só no overlay**                                            | divergência 5                                                                           |
| Wisps                                                     | `hints.mjs:208-232` ← `view.mjs:813-826`                    | `panel.js:445-454`                                                                                                    | idêntico (`wispsView`)                                       | nenhum caso real com Wisp                                                               |
| `roll` (cartão "Vale rolar?", oculto por padrão)          | `draw.mjs:141-171`                                          | painel Rolagem                                                                                                        | idêntico                                                     |                                                                                         |
| `items`: Montar agora                                     | `view.mjs:383-556`                                          | Inventário `ui/inventory.js:34-91`                                                                                    | mesma fonte; **ordem, limite e frescor próprios**            | divergências 7 e 9                                                                      |
| `items`: Próximo item                                     | `view.mjs:305-335`                                          | `ui/steps.js:61-87`                                                                                                   | idêntico                                                     | mesma `nextItemRecipe`                                                                  |
| `items`: Itens dos campeões                               | `view.mjs:344-369` (4 + "+N")                               | passo `builds` `model.js:688-717`                                                                                     | apresentação                                                 |                                                                                         |
| `items`: Equipar                                          | `view.mjs:559-578`                                          | `model.js:575-595`, `ui/steps.js:163-166`                                                                             | idêntico                                                     | nenhum dos dois desenha o titular (`for`)                                               |
| `items`: Passar itens                                     | `view.mjs:581-592`                                          | `model.js:657-669`                                                                                                    | idêntico                                                     |                                                                                         |
| `builds` (itens da formação, oculto)                      | `view.mjs:595-621`                                          | `ui/champ-items.js:28`                                                                                                | idêntico                                                     | mesma `buildStates`                                                                     |
| `plan`: título, carry, score, checklist                   | `view.mjs:624-680`                                          | `ui/plan.js`, `main.js:319-323`                                                                                       | **regra própria**                                            | `planView` sem o roster (`view.mjs:626` × `main.js:322`): divergência 11                |
| `comp`: comp aberta ao iniciar                            | `hud.mjs:336`, `comp.mjs:419-445`                           | `model.js:400-448`                                                                                                    | idêntico                                                     | 33 de 33                                                                                |
| `comp`: lista e rótulos                                   | `comp.mjs:446-457`                                          | a "outra" única da Formação                                                                                           | apresentação                                                 | com fixada, a "Recomendada" vira "Sugerida 1"                                           |
| `comp`: ⇄ e moeda na comp do plano                        | `comp.mjs:78-113, 247-265` (`stage.slots`)                  | `slotView` `model.js:234-269`                                                                                         | idêntico                                                     | 21 de 21 com `stage.slots`                                                              |
| `comp`: ⇄ nas "Sugerida N"                                | `comp.mjs:139-171, 231` (`fallbackSubs`)                    | `formationCells` da outra comp                                                                                        | **regra própria (erro)**                                     | divergência 8                                                                           |
| `comp`: onde está cada peça                               | `comp.mjs:238-242`                                          | `model.js:311-321`                                                                                                    | regra própria                                                | difere sem reserva lida (17 casos)                                                      |
| `comp`: "N/M em campo · +K na reserva"                    | `comp.mjs:546-547`                                          | `ui/hud.js:315-331`                                                                                                   | idêntico                                                     | mesma `compOwnership`                                                                   |
| `comp`: atalhos anterior/próxima                          | `comp.mjs:465-500`                                          | seletor local `main.js:396-404`                                                                                       | **tempo diferente**                                          | divergência 10                                                                          |
| `swaps`: Entra e sai                                      | `swaps.mjs:49-67, 83-93`                                    | passos Trocar e Segure `model.js:569-574, 649-656`                                                                    | apresentação                                                 | sem o aviso "preserve N itens"                                                          |
| `swaps`: Vaga livre                                       | —                                                           | `model.js:643-648`                                                                                                    | só na interface                                              |                                                                                         |
| `swaps`: Vender                                           | `swaps.mjs:95-107`                                          | não desenhado                                                                                                         | só no overlay                                                | sem caso real                                                                           |
| `carousel`                                                | `view.mjs:687-723` (5 + "+N")                               | `model.js:730-781`, `ui/steps.js:185`                                                                                 | apresentação                                                 | mesma ordem em 24 de 24                                                                 |
| `carousel`: aprimoramentos (oferta)                       | `view.mjs:731-742` (`augOfferView`)                         | `ui/augs.js:101`                                                                                                      | idêntico                                                     | 5 de 5                                                                                  |
| Aprimoramentos escolhidos                                 | —                                                           | `ui/augs.js:106-130`                                                                                                  | só na interface                                              |                                                                                         |
| `keys`: Copiar comp                                       | `keys.mjs:40-56` (`plan.teamCode`)                          | `formation-view.js:35-41`                                                                                             | idêntico na vista padrão                                     | a interface copia a comp à vista; o overlay ignora a comp aberta no painel              |
| `dock`: sem resposta do servidor                          | `view.mjs:965-971`, `poll.mjs:13` (2 falhas × 1 s)          | `connection.js:10-13` (3 falhas × 5 s)                                                                                | tempo diferente                                              |                                                                                         |
| `dock`: "leitura de há N" / "análise de há N"             | `view.mjs:994-1012`                                         | `connection.js:110-145`                                                                                               | regra própria (outra referência)                             | divergência 13                                                                          |
| Estados "aguardando análise/leitura"                      | `view.mjs:980-990, 1068-1077`                               | `index.html:166-170`                                                                                                  | apresentação                                                 | o título (`WAITING_TITLE`) é falso: divergência 12                                      |
| "snapshot de outro jogo"                                  | `view.mjs:1029-1034`                                        | `main.js:362-376`                                                                                                     | precedência diferente                                        | o overlay o mostra junto de "Partida encerrada"                                         |
| Modo treino                                               | —                                                           | —                                                                                                                     | falta nos dois                                               | `model.js:507` promete o chip                                                           |

## 4. Divergências, em ordem de impacto para quem joga

1. **Selo de rolar "role" quando a decisão da rodada não rola.** `strategy.mjs:702` mantém `call.kind: "go"` quando a ação é
   "SUBIR NÍVEL" e a regra de rolagem aprova; o turn só cria passo de rolar com a ação "ROLAR" (`core/turn/turn.mjs:97`).
   O selo do overlay (`badges.mjs:58` ← `view.mjs:272`) e a pílula do painel Rolagem da interface (`model.js:105`) leem
   `call`; o Foco (`focus.js:161-168`) lê o turn. Exemplo (pipeline real do golden `reroll-hidden-banks`, 100 g, nível 6, 3-5):
   Foco "Compre Hecarim → suba para 7 → guarde 69g"; overlay "↻ role 20 vezes" (verde), "↑ suba agora · 28g", "⚑ 69g".
   Aconteceu em 5 de 18 variantes do pipeline real (80–100 g) e em 28 de 1960 casos sintéticos.
2. **O turn manda comprar e a loja do overlay não marca a carta.** As compras do turn são `stage.shop` com "comprar"
   (`turn.mjs:34`); a dica do overlay (`hints.mjs:142-171`) cobre só `stage.buyNow`, as cópias (`copyBuys`) e temporários com
   titular. Ficam de fora peça da comp de custo "não comprável" no nível (`stage.mjs:146`), cópia de peça fora do plano e
   temporário para vaga vazia. Exemplo (`reroll-hidden-banks`, 60 g): Foco "Comprar na loja: Aphelios · 4g" (espaço 2, carry);
   overlay sem dica nem selo. Também em `early-lvl5-shop` 60 g (Cassiopeia), `items-bank-lvl8` 80 g, `shop-cache-d1#3` 5 g.
3. **Conselho provisório só no overlay, e a interface congelada durante a análise.** Ver "Momento". Pendência confirmada:
   `round-advice.mjs:117-150` grava só no feed, a v2 não tem referência a `provisional`, e o overlay também não marca o corpo
   como provisório (a nota vai para `strategy.reasons`, que ele não desenha). No quadro real 3292238368 o último corpo do overlay
   era provisório (6-1, 13 g). Junto: o provisório da mesma rodada repete a compra já feita ("Compre Xayah → guarde 36g").
4. **"achou: X" aponta carta que já saiu.** `rollFound` (`view.mjs:248-262`) prefere os espaços de `rollFor` (loja da hora da
   análise) aos de `panel.roll.shop` (cruzados com a loja de agora). Sintético: Rakan comprado, espaço 3 vazio, overlay ainda
   "achou: Rakan"; o "Na loja" da interface some. O "Comprar na loja" do Foco tem o mesmo atraso.
5. **Aviso de vida só no overlay.** `model.js:869-872` copia só `keep` e `interest` de `panels.economy`; nada na v2 lê `alert`
   nem `pressure`. Nos 12 quadros reais, 11 divergem (ex.: 3292194088, overlay "Vida 6 · tabuleiro estabilizado: pare de rolar,
   guarde 17g"; interface só a barra vermelha). No golden `danger-hp27` (vida 44 em 4-5) a interface nem pinta a barra.
   No overlay, o selo de ouro diz "gaste até 15g" ao lado do aviso "guarde 15g" (`badges.mjs:298-300`).
6. **Selo de ouro some quando o turn ainda guarda.** Com o nível só estimado, `economy.keep` vem nulo e o selo some; o Foco diz
   "Guardar 34g" (2 casos sintéticos).
7. **"Montar agora" esconde o que dá para montar.** `finishBuild` (`view.mjs:547-555`) ordena primeiro pelo carry e só depois
   pelo tipo, e só 3 linhas ficam visíveis. Golden `pinned-comp-swap`: "monte Sunfire Cape em Fiddlesticks" vai para a dica do
   mouse e ficam visíveis dois "falta … de Azir"; a interface mostra Sunfire em "Montar agora" (`inventory.js:74`). Em
   `mid-lvl7-streak` e `plan-sequence#1` a 1ª linha do overlay é "falta B.F. Sword para Deathblade de Aphelios".
8. **Titular e temporário invertidos nas "Sugerida N".** `fallbackSubs` (`comp.mjs:153-169`) trata toda transição como
   temporária e ignora `t.ready`. Quadro 3292238368, "Sugerida 1: Executioner · Sett": overlay "Kobuko 2★ no lugar de Azir
   (temporário…)"; interface: Azir é titular e entra da reserva. 6 de 56 comps sugeridas, 9 peças.
9. **Frescor do conselho de itens.** Sem banco lido, `adviceFor` (`view.mjs:400-407`) descarta o conselho e o overlay mostra os
   itens dos campeões em campo; a interface o aceita (`inventory.js:39-45`). Quadro 3292138469: interface 3 linhas "Falta 1
   componente", overlay nenhuma. Com banco mudado depois da análise, o overlay mostra a reserva e a interface espera. Decidir
   qual regra vale. `stage.bankItems` aparece duas vezes no overlay ("Montar agora" e "Equipar").
10. **Painel da comp preso.** Depois de andar com F5, `compPanelStep` guarda a chave da comp (`comp.mjs:472-480`); se o plano
    trocar, o overlay segue na comp antiga ("Sugerida 1: Krug…") enquanto a Formação mostra "Recomendada: Executioner · Sett".
    A interface volta à comp padrão quando a lista muda (`main.js:400-404`).
11. **Cartão Plano sem a reserva** (oculto por padrão). `view.mjs:626` chama `planView` sem `model.roster`
    (`main.js:322` passa). Quadro 3292221230, Rakan: overlay "comprada 2× (pode estar na reserva)", interface "(não está em
    campo nem na reserva)". O cartão mostra só "N/M peças em campo" (`view.mjs:637`).
12. **Textos falsos no overlay.** `WAITING_TITLE` (`view.mjs:14-15`) e o título de "análise velha" (`view.mjs:1008-1012`)
    dizem que a análise só existe com a interface aberta; o laço automático analisa sozinho (`server.mjs:640-681`, e
    `/api/health` mostrou `auto.running: true`). `tests/overlay-hud.test.mjs:284` exige esse texto.
13. **Idade com referências diferentes.** O overlay mede a idade da fatia do feed (o laço a renova a cada 3 s, então nunca acusa
    arquivo do jogo parado); a interface mede a idade do arquivo do jogo. Com o arquivo parado há 130 s, o overlay só troca o chip
    para "snapshot", e a interface diz "leitura de há 130 s".
14. **Menores.** "snapshot de outro jogo" junto de "Partida encerrada" (`view.mjs:1029`); aprimoramentos escolhidos só na
    interface; Copiar comp do overlay ignora a comp aberta no painel; "Vaga livre" só na interface; peça na loja como
    temporário: a interface manda "Segure Lillia → Sett 0/1" com a carta ainda na loja (`model.js:331`, causa em
    `core/board/interim.mjs:835-846`), o overlay diz "compre Lillia da loja"; modo treino sem chip nos dois.

Fora da paridade (os dois lados mostram o mesmo problema, vale registrar): o painel Rolagem da interface contradiz o próprio
Foco (item 1); a interface tem dois "piso" diferentes (HUD `keep`, Plano `floor`, diferem em 28 de 33 casos); "Guardar -12g"
quando `canLevel` (`strategy.mjs:288`, usado em `:355`) não confere o ouro.

## 5. Pendências já registradas (`pendencias.md`)

- **Conselho provisório chega ao overlay e não à interface**: confirmada (divergência 3).
- **"+K na reserva" no overlay**: resolvida no painel da comp, visível por padrão (`comp.mjs:546-547`, conferido em
  3292171991: "7/9 em campo · +1 na reserva" nos dois). Ainda falta no cartão Plano (`view.mjs:637`, `draw.mjs:424-426`).
- **`panels.economy.alert` na interface**: confirmada (divergência 5).
- **Retrato do titular no item segurado**: já desenhado no "Montar agora" ("segure X em S → para T", `draw.mjs:358-359`).
  Continua faltando em "Equipar" nos dois lados (`view.mjs:569-576` descarta `for`; `ui/steps.js:165-166` ignora `r.for`), na
  dica "Equipe X em S" (`hints.mjs:378-403`) e no caso "guarde para T" sem portador (golden `rich-lvl10`).

## 6. Provas rodadas

2119 execuções comparando os dois lados sobre a mesma entrada: 1960 da grade sintética e 159 sobre quadros reais, golden,
pipeline real e cenários montados.

| Entrada                                                                                                          | Casos                         |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 12 quadros reais ao vivo de `tft/data/match-live` (5 em formato v1, `screen` → `seen`; 2 com turn, 1 provisório) | 12 em cada uma das três áreas |
| Corpos do golden (`tests/golden/expected`) com o estado de `tests/golden/scenarios.mjs`                          | 21 + 21 + 3                   |
| `live-mock-base.json`                                                                                            | 1                             |
| Pipeline real em memória (harness do golden), ouro variado                                                       | 21                            |
| Carrossel (lido e por prioridade) sobre os quadros, estados de fim/nova/treino, aprimoramentos, idades           | 28 + 12                       |
| `GET /api/overlay` real salvo (partida encerrada)                                                                | 3                             |
| Sequência provisória de 4-1, mesma rodada, duas interfaces                                                       | 5 + 2 + 2                     |
| Grade sintética com `strategy()` e casos de "achou"/nível estimado                                               | 1960 + 4                      |

Scripts (fora do repositório) em `C:\Users\Hugo\AppData\Local\Temp\claude\C--Users-Hugo-Desktop-Hugo-rea\80b03ef3-a307-4b48-9f89-cd7a332f0e7f\scratchpad\`:
`main/` (`provisional.mjs`, `sameround.mjs`, `two-uis.mjs`, `frames.mjs`), `sub-turno/` (`lib.mjs`, `run.mjs`,
`golden-variants.mjs`, `synth.mjs`, `found.mjs`, `estimated.mjs`, `buyscan.mjs`), `sub-comp/` (`compare.mjs`, `run-live.mjs`,
`run-golden.mjs`, `montar.mjs`, `sticky2.mjs`…), `sub-avisos/` (`parity.mjs`, `parity2.mjs`, `parity-out.json`).

## 7. Testes

Rodados uma vez no HEAD, antes da regra de não rodar testes: `node --test tests/overlay-*.test.mjs v2/js/*.test.mjs
tests/round-advice.test.mjs tests/auto-refresh.test.mjs tests/turn.test.mjs` = 507 testes, 0 falhas (com a v2 sendo
reorganizada, o resultado vale só para o HEAD). Eles garantem cada lado por si: o overlay sobre o
`buildModel` real com valores esperados escritos à mão (`live-mock-base`, sem turn e com painéis editados), a v2 sobre o
próprio modelo, `round-advice` só o feed. O que já é paridade por construção: mesma `buildModel`, `augOfferView`,
`nextItemRecipe`, `buildStates`, `compOwnership`, `wispsView`. Nenhum teste dá a mesma entrada aos dois lados e compara o que
cada um mostra; `focus.test.mjs` não cobre o ramo com turn; `overlay-badges.test.mjs:884` ("igual à interface") não roda o
Inventário real; `overlay-hud.test.mjs:275` congela a linha da peça sem roster e `:284` o texto falso.

**Teste proposto (não escrito)**, `tests/paridade-interface-overlay.test.mjs`: para cada entrada (os 12 quadros de
`match-live` convertidos com `app/live-snapshot.mjs`, os passos do golden com o estado de `scenarios.mjs`, `live-mock-base`)
montar `buildModel` + `focusView` + o Inventário (`ui/inventory.js` com raiz falsa) e `overlayView` + `buildBadges` +
`buildHints` com as deps reais de `hud.mjs`, e exigir:

- selo de rolar verde ⇔ o turn tem passo `roll`; ⚑ = `turn.gold.keep`; selo de XP "suba" ⇔ passo `level`;
- dicas "Compre" ⊇ compras do turn presentes na loja de agora; "achou" só onde a carta está agora;
- mesma comp, mesmo carry, mesmas trocas aceitas e o mesmo titular/temporário em todas as comps listadas;
- "Montar agora" visível ⊇ as primeiras linhas "Montar agora" do Inventário;
- aviso de vida presente nos dois quando `economy.alert` existe;
- e, no servidor, para a mesma chamada de `recommend.run`, o corpo devolvido ao POST = o corpo gravado no feed, salvo o
  campo `provisional` documentado.

## 8. O que só se confirma em partida

- O tempo real entre a interface e o overlay na virada de rodada (o "suba" do provisório e a tela congelada da interface).
- O desenho real e as âncoras no Electron (aqui foram comparados modelos e HTML).
- Wisps (nenhum caso real com Wisp nos dados).
- O cenário de duas interfaces abertas (provado só com as funções puras).
- O que a interface mostrava no momento do quadro provisório 3292238368 (desconhecido).
- O caso inverso da compra (dica "Compre" que o turn não compra por reserva cheia ou orçamento esgotado, `stage.mjs:331-348`):
  existe no código, não foi reproduzido.

## 9. Correções propostas, em ordem

Preferência: um lado passa a ler o mesmo campo ou função do outro, sem regra nova.

| #   | Correção                                                                                                                                                                                                                                                                                                      | Executor previsto                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Selo de rolar (`view.mjs:272` `rollOf`) e pílula do painel Rolagem (`model.js:105` `rollPill`) leem o passo `roll` do turn quando ele existe, como `focus.js:161-168`; sem passo, nada de "role". Alternativa na origem: `settle` (`strategy.mjs:702`) não deixar `call.kind: "go"` quando a ação não é rolar | `tft-overlay` + `tft-web-ui` (ou `tft-rolagem` na origem)       |
| 2   | `buyHints` (`hints.mjs:142`) lê as compras do turn (id, espaço, custo, motivo) cruzadas com a loja de agora por `shop-match.js`; as linhas Comprar só enriquecem o texto                                                                                                                                      | `tft-overlay`                                                   |
| 3   | Selo de ouro lê `turn.gold.keep`; remover a curva própria do selo de nível (`badges.mjs:250-282`)                                                                                                                                                                                                             | `tft-overlay`                                                   |
| 4   | Uma análise só para os dois: a resposta do POST passa a ser o corpo que `roundAdvice.publish` gravou no feed, e a interface, entre POSTs, lê a recomendação de `/api/overlay` quando ela é mais nova (inclusive a provisória, marcada como tal nos dois lados)                                                | `tft-desempenho` + `tft-web-ui`                                 |
| 5   | Provisório da mesma rodada: a loja entra em `economyKey` ou, com a loja mudada, as compras saem do campo como na rodada nova (`round-advice.mjs:63-65`)                                                                                                                                                       | `tft-nivel`                                                     |
| 6   | Interface: desenhar o estado novo enquanto a análise roda (ou mostrar "analisando") e a barra de conexão dizer a idade da análise exibida                                                                                                                                                                     | `tft-web-ui`                                                    |
| 7   | Decisões com uma fonte só: `GET /api/state` expõe `planState.decisions(gameId)` e a interface as adota quando a loja local da partida está vazia, em vez de apagar as do servidor                                                                                                                             | `tft-web-ui` (+ campo no servidor)                              |
| 8   | Aviso de vida: `model.js:869-872` leva `pressure`, `floor` e `alert`; a interface mostra `alert.text` e pinta a barra pela `pressure`; o `economyOf` do overlay lê o mesmo `model.plan.panel.economy`; o selo de ouro não diz "gaste" ao lado de "guarde"                                                     | `tft-web-ui` + `tft-pressao-vida`                               |
| 9   | Comps sugeridas: `compOf` usa `formationCells`/`slotModelOf` em todas as comps e respeita `t.ready` (`comp.mjs:153-169, 231`); o painel volta à comp padrão quando a lista muda, como `main.js:400-404`                                                                                                       | `tft-overlay` (+ `tft-substitutos`)                             |
| 10  | "Montar agora": ordenar por tipo e manter a ordem do servidor dentro dele; usar `bankReading`/`sameItems` da v2 no frescor; não repetir `stage.bankItems`                                                                                                                                                     | `tft-overlay` (regra do banco não lido com `tft-itens-central`) |
| 11  | "achou: X" usa só `panel.roll.shop` (já cruzado com a loja de agora) filtrado pelos alvos                                                                                                                                                                                                                     | `tft-overlay`                                                   |
| 12  | Textos `WAITING_TITLE` e "análise velha" de acordo com o laço automático, e o teste que os exige                                                                                                                                                                                                              | `tft-overlay`                                                   |
| 13  | Cartão Plano com `model.roster` e `model.plan.reserve`; idade do arquivo do jogo (`status.ageSeconds`) no overlay com o texto da interface; "outro jogo" só fora de fim/nova partida                                                                                                                          | `tft-overlay`                                                   |
| 14  | Menores: titular em "Equipar" nos dois lados e na dica "Equipe"; "Vaga livre" no "Entra e sai"; "Segure" da interface sem carta comprada (`model.js:331` excluir `playing.source === "loja"`); Copiar comp do overlay segue o painel aberto; chip de treino                                                   | `tft-overlay`, `tft-web-ui`, `tft-substitutos`                  |
| 15  | Escrever o teste de paridade da seção 7 depois das correções 1–3                                                                                                                                                                                                                                              | `tft-overlay` + `tft-web-ui`                                    |
