# Fontes de dados do TFT Helper

Registro de **de onde vem cada dado** que o helper usa, como é obtido, com que atraso, quão confiável é e o que não é
possível saber. Verificado em **2026-10-10** (Set 18, TFT@18.4.0, patchline BR1), com uma partida ao vivo e 11 logs reais
(`TFT.log` + 10 `TFT-backup-*.log`, uma partida por arquivo).

## Regras

- Só entram arquivos que o próprio jogo/cliente grava e APIs locais documentadas (LCU pelo `lockfile`, somente GET). Única exceção, por
  decisão do usuário: o banco de eventos que o **TFTAcademy** (app de terceiro sobre o Overwolf GEP) grava, lido só para leitura e só
  com os campos do próprio jogador, incluindo os aprimoramentos dele (uso pessoal e local) e os Wisps da loja (ver "GEP / TFTAcademy").
  Nada de rivais.
- **Proibido**: ler a memória do processo, injetar DLL/código, hook, anexar depurador, captura de tela/OCR para as fontes novas.
  Se um dado só existir por esses caminhos, ele fica registrado como **sem fonte permitida** (não se contorna).
- Classes de confiabilidade: **observado** (valor gravado pelo jogo), **derivado** (calculado de observados),
  **estimado** (hipótese/heurística, nunca tratar como observado), **lido da tela** (OCR/ícones, sujeito a erro de leitura),
  **manual** (digitado pelo usuário).

## Resumo: dado, fonte e confiabilidade

| Dado                                                                         | Fonte                                                                                                                      | Método                                                                                                                                                                                                 | Confiabilidade                                                                                       | Atraso                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Id da partida, fila, set                                                     | `.sentry-native/<execução>.run/__sentry-event` (tags `game.id`, `game.queue`, `set_name`) e LCU `/lol-gameflow/v1/session` | arquivo / HTTPS local                                                                                                                                                                                  | observado                                                                                            | ≤ 0,5 s (intervalo de leitura)                                         |
| **Estágio-rodada** (`2-4`)                                                   | `__sentry-event`, tag `game.tft.round`                                                                                     | `game-log.mjs` → `parseSentryEvent`                                                                                                                                                                    | **observado**                                                                                        | ≤ 0,5 s (observado: mudanças detectadas na leitura seguinte)           |
| **Fase da rodada** (Planning, Combat, Draft = carrossel...)                  | `__sentry-event`, tag `game.tft.phase`                                                                                     | idem                                                                                                                                                                                                   | **observado**                                                                                        | idem                                                                   |
| Fase do cliente (InProgress etc.)                                            | LCU `/lol-gameflow/v1/gameflow-phase`                                                                                      | HTTPS local (`server.mjs`, `readLcu`)                                                                                                                                                                  | observado                                                                                            | até 5 s (cache)                                                        |
| Comp, itens equipados, tabuleiro de todos os jogadores                       | `Saved/Logs/TFTEoGStats.json` (`statsBlock.players[].boardPieces`)                                                         | leitura do arquivo (`capture.mjs`, a cada 0,5 s)                                                                                                                                                       | observado, **só peças em campo**                                                                     | regravado pelo jogo durante a partida                                  |
| Vida, colocação, aprimoramentos de cada jogador                              | `TFTEoGStats.json` (`health`, `ffaStanding`, `augments`)                                                                   | idem                                                                                                                                                                                                   | observado                                                                                            | idem                                                                   |
| **Ouro**                                                                     | GEP `me.gold` (banco do TFTAcademy) quando fresco; senão **sem fonte permitida em arquivo**                                | `gep-reader.mjs`; reserva: leitor de tela (`screen-reader.ps1`, glifos; ver "Leitor de tela próprio")                                                                                                  | GEP: observado (0 é inferido de `{}`); tela: lido da tela                                            | GEP ≤ 1 s de resolução; tela ~2,5 s (`IntervalMs`)                     |
| **Nível**                                                                    | GEP `me.xp.level` quando fresco; senão **sem fonte permitida em arquivo**                                                  | GEP; reserva: leitor de tela (glifos, ver "Leitor de tela próprio"); se o número não é lido, derivado do total de XP (`4/10`); validado e, sem leitura, piso por XP passivo (`level.mjs`, ver "Nível") | GEP: observado; tela: lido da tela / derivado (piso)                                                 | idem                                                                   |
| **XP**                                                                       | GEP `me.xp` (`atual/total`) quando fresco; senão **sem fonte permitida em arquivo**                                        | GEP; reserva: leitor de tela (glifos, ver "Leitor de tela próprio")                                                                                                                                    | GEP: observado; tela: lido da tela                                                                   | idem                                                                   |
| **Reserva (bench)** do jogador                                               | GEP `bench.bench_pieces` quando fresco; **não reconstruível pelo log** (ver "Livro-razão de eventos")                      | `gep-reader.mjs` → `options.bench` (origem `gep`); sem GEP, vazia (a entrada manual saiu); o livro-razão dá só um teto (`unitLedger.bench.upperBound`)                                                 | GEP: observado; teto: **estimado**                                                                   | GEP ≤ 1 s                                                              |
| **Compras e fusões** do jogador (cada uma com o id da entidade)              | `Saved/Logs/TFT.log`, voz `Audio.Event.VO.Unit.Purchase` / `StarUp.2Star                                                   | 3Star`                                                                                                                                                                                                 | `game-log.mjs` → `parseLogLine`; `unit-ledger.mjs`                                                   | **observado** (completo para compras da loja; faltam carrossel/prêmio) | 1 a 4 s (flush do log) |
| Vendas, movimento tabuleiro<->reserva                                        | **não gravados** (só as tentativas recusadas de arrastar)                                                                  | n/a                                                                                                                                                                                                    | sem fonte                                                                                            | n/a                                                                    |
| **Banco de itens** do jogador                                                | GEP `bench.item_bench` (só a linha do jogador local) quando fresco; senão **sem fonte permitida em arquivo**               | GEP; reserva: leitor de tela (comparação de ícones)                                                                                                                                                    | GEP: observado; tela: lido da tela                                                                   | GEP ≤ 1 s; tela idem + debounce (`ITEMS_SETTLE_MS`)                    |
| **Loja** (5 cartas)                                                          | GEP `store.shop_pieces` quando fresco; senão **sem fonte permitida em arquivo**                                            | GEP; reserva: leitor de tela (OCR dos nomes)                                                                                                                                                           | GEP: observado; tela: lido da tela                                                                   | GEP ≤ 1 s; tela idem                                                   |
| **Aprimoramentos do jogador** (oferta e escolhidos)                          | GEP `augments.me` e `picked_augment` (banco do TFTAcademy), só com GEP ativo; senão leitor de tela (oferta) / manual       | `gep-reader.mjs` (`augmentResolver`); o registro manual prevalece sobre os escolhidos do GEP                                                                                                           | GEP: **observado** (partida completa de 2026-10-11: 15 de 15 nomes no catálogo)                      | GEP ≤ 1 s                                                              |
| **Wisps** da loja                                                            | GEP `store.shop_pieces` (entrada comum, sem evento próprio) + catálogo `{5b609ae2}`                                        | `wispCatalog` + `parseShop` (`screen.wisps`, `id: null` na loja)                                                                                                                                       | GEP: **observado** (28 Wisps da loja na partida de 2026-10-11, todos no catálogo; 1 carta fora dele) | GEP ≤ 1 s                                                              |
| Bancos dos rivais                                                            | **inexistente** (o jogo não expõe)                                                                                         | estimativa `hiddenHoldings` (`pool-tracker.mjs`)                                                                                                                                                       | **estimado**                                                                                         | recalculado a cada análise                                             |
| **Carrossel** (aberto agora e as peças que oferece: campeão + item)          | fase `Draft` do `__sentry-event`; GEP `round_type` "Carousel" e `carousel.carousel_pieces`; calendário x-4 (estimativa)    | `core/state/carousel.mjs`, `gep-reader.mjs` → `parseCarouselPieces`, `app/carousel-view.mjs`                                                                                                           | **observado** (jogo e GEP: 19 carrosséis em 5 partidas); calendário **estimado**                     | a cada leitura do estado (≤ 3 s)                                       |
| Itens recebidos no banco (só a contagem, `hints.itemsReceived`) e carrosséis | `Saved/Logs/TFT.log`                                                                                                       | `game-log.mjs` → `parseLogLine`                                                                                                                                                                        | **estimado** (não diz qual item)                                                                     | 1 a 4 s (flush do log)                                                 |

## Dado a dado

### Estágio-rodada e fase da rodada (novo, observado)

- **Arquivo**: `%LOCALAPPDATA%\TFT\.sentry-native\<guid>.run\__sentry-event` (cada processo `TFTClient` cria uma pasta `.run`;
  vale a de modificação mais recente).
- **O que é**: contexto do relatório de falhas do Sentry (sdk `sentry.native.unreal` 0.13.4), em MessagePack, que o jogo
  **regrava a cada mudança de etiqueta**. É gravado pelo próprio jogo; ler o arquivo não toca o processo.
- **Tags úteis**: `game.id` (igual ao `gameId` do LCU e do `TFTEoGStats.json`, ex.: `3291600904`), `game.queue` (`1100` = TFT normal),
  `set_name` (`TFTSet18`), `game.tft.phase`, `game.tft.round` (`"2-4"`), `game.tft.sequentialGames`,
  `game.tft.currentGameReconnectCount`, e cosméticos por jogador (`game.tft.cosmetics.*`).
- **Sequência observada de fases** em 2-3 → 2-4: `CombatArrival, Combat, CombatCeremony, CombatCleanup, CombatDeparture,
  DraftArrival, Draft` (o `Draft` é o carrossel; no `TFT.log` coincide com a música `MS_Music_Set18_Gameplay_Carousel`).
  As fases de planejamento aparecem como `Planning*` (observado `Planning` em 2-7). Em `game-log.mjs` elas são agrupadas
  em `planning | combat | draft | other`.
- **Conferência**: o servidor passa o `gameId` do LCU; se o arquivo é de outra partida, `stage`/`phase` vêm nulos e `stale: true`
  (nunca se usa rodada de partida anterior).
- **Limites**: formato interno do Riot/Sentry, pode mudar em patch (o leitor devolve nulo, não lança, e o servidor cai para a
  tela). Com o jogo fechado a pasta `.run` não existe (não se verificou o que acontece depois de uma queda do jogo).
  O arquivo contém também nome de usuário e máquina; o helper **não** lê nem expõe esses campos.
- **Integração**: `server.mjs` → `seenState()` mescla com o leitor de tela (`mergeSources`). `screen.stage` e `screen.phase`
  passam a vir do arquivo; `screen.sources.stage` vale `"game-log"` ou `"screen"` (reserva). O OCR de estágio no
  `screen-reader.ps1` segue ativo como reserva até alguém decidir desligá-lo.

### Ouro, nível, XP

- **Procurado e não encontrado** em: `TFT.log` e os 10 `TFT-backup-*.log` (grep por gold, level, xp, experience, streak, interest,
  income, buy, reroll, refresh; só aparecem nomes de cosméticos "GoldMine/GoldenEgg" e tags de habilidade), `TFTEoGStats.json`
  (chaves: `PUUID, augments, boardPieces, companionContentId, companionName, companionSkinId, eventPVEData, eventSkillDeltas,
  ffaStanding, health, isInteractable, partnerGroupId, playbookItemId, playerId, riot*, summoner*`), `__sentry-event` e breadcrumbs
  do Sentry (só avisos do log), logs do cliente em `C:\Riot Games\League of Legends\Logs\LeagueClient Logs` (partidas
  anteriores, só fluxo de partida/parties), logs do Riot Client.
- **LCU** (`/help` do cliente em execução: 1447 funções, 917 eventos): sem rota de estado de jogo do TFT.
  As únicas rotas TFT de partida são `lol-end-of-game/v1/tft-eog-stats` (fim de jogo; durante a partida responde 404
  `Game Client stats not found`) e histórico de partidas (`lol-match-history/v1/products/tft/{puuid}/matches`, pós-jogo).
- **Live Client Data** (`https://127.0.0.1:2999`): com o TFT em partida a porta **recusa conexão** (curl código 7). O TFT não
  expõe essa API.
- **Conclusão**: ouro, nível e XP só existem no estado replicado na memória do jogo e na tela. Não há arquivo nem API local
  permitida que os traga. Continuam pelo leitor de tela (reserva) ou entrada manual. Atender "sem OCR" para esses três
  exigiria ler a memória do processo ou interceptar a rede do jogo, o que é proibido (Vanguard).

### Nível: leitura, validação, precedência e causas de erro

- **Causa raiz do "nível não lido" (observada ao vivo, 2026-10-10, 4-3/4-5)**: `/api/state` trazia `screen.level = 2` com
  `stale.level = true` e `screen.xp = null`, enquanto ouro e estágio eram lidos. A janela do TFT estava maximizada com barra de
  título (área cliente 2560x1351, 1,895:1). O HUD é desenhado em 16:9 e **centralizado** (no caso, 79 px de margem de cada lado,
  tamanho 2402x1351), mas `screen-reader.ps1` aplicava as frações (medidas numa captura 2044x1149, 16:9) à área cliente inteira.
  Elementos perto do centro (ouro, estágio) caem dentro do recorte; os longe do centro erravam: nível e XP ~45 px, nome da
  5ª carta da loja ~33 px (observado "istar" no lugar de "Alistar"), coluna de itens à esquerda. O `2` era uma leitura isolada
  do início da partida (janela diferente) retida desde então. Correção: `Hud-Rect` calcula o retângulo 16:9 do HUD
  (centralizado se a janela é mais larga; colado embaixo, ou no topo para o estágio, se é mais alta) e todas as regiões
  usam esse retângulo; enquanto um campo nunca foi lido tenta também a área cliente inteira (reserva) e depois fica só com
  a base que acertou; mudar o tamanho da janela zera isso. Premissa de layout (escala pela altura, centralizado) **inferida de
  uma única janela observada** e não confirmada em outras proporções.
- **Outra causa**: o leitor era parado em `phase = "Reconnect"` (o rastreador de partidas conta `Reconnect` como em partida), o
  que zerava nível e ouro; agora `Reconnect` mantém o leitor.
- **Leituras e origens** (`screen.levelSource`): `ocr+xp` (número lido e total do XP concordam), `ocr` (número lido, XP não lido
  ou total inexistente), `xp` (sem o número, nível inferido do total: "4/10" → 4; empate 2 → 1/2 e 68 → 8/9 resolvido pelo
  último nível e pela queda do XP com o mesmo total, marcado `levelAmbiguous`), `held` (conflito sem saída: mantém o anterior).
  Número e total em conflito: vale o plausível (o nível só sobe, de 1 a 2 por vez em relação ao último nível confiável); se as
  duas leituras são plausíveis, vence o número (OCR com três cópias idênticas). `levelConflict` marca o caso.
- **Validação** (`level.mjs`, em `seenState`): uma leitura fresca **sem corroboração do total de XP** é descartada se for menor que
  o piso do XP passivo garantido no estágio-rodada (do arquivo do jogo) ou menor que o último nível confirmado. Piso =
  `levelFloor(estágio)`: parte do nível 1 (ou do último nível confirmado com o XP dele) e soma só o XP passivo
  (`GAME.passiveXp` = 2 por rodada, **ignorando o estágio 1 e o carrossel**, onde a regra não foi verificada); quem compra XP
  só fica acima. Premissa: 2 XP passivos por rodada fora do estágio 1 e do carrossel (não observada no jogo).
- **Precedência final**: (1) leitura fresca e plausível do HUD (`sources.level = "screen"`); (2) leitura velha (HUD coberto há
  mais de 15 s) ainda acima do piso, marcada `stale`; (3) **piso derivado** (`sources.level = "derived"`, `levelInfo.minimum`: o
  real é este ou maior); (4) **estimativa pelo tabuleiro** (peças em campo, `estimatedLevel`), só como último recurso e sempre
  `levelEstimated = true`: a estratégia não calcula odds, rolagem nem XP com ela (veredito "nível não lido"). Não existe campo
  manual de nível na interface v2.
- **Interface**: o HUD mostra `≥N` (derivado) ou `~N` (estimado) e esmaece o anel; o tooltip diz a origem e qual nível a análise
  usou. `analysis.levelSource` repete a origem no resultado.
- **Só se confirma ao vivo**: que o retângulo 16:9 centralizado acerta nível/XP/itens na janela maximizada, em tela cheia e em
  outras proporções; leitura do nível 10 (dois dígitos) e do XP no nível máximo; a regra de XP passivo por rodada.

### Indicador "achar rolando" e as fontes do banco (revisão de 2026-10-10)

- **Pedido**: indicador verde por peça (as suas e as da comp escolhida) com a chance de achá-la rolando, usando o banco do
  jogador e os bancos dos rivais, sem leitura de tela. **Verificação**: nenhuma fonte permitida entrega esses bancos. Reconferido
  (listagem de `Saved/Logs` e do `.sentry-native` com a partida em curso, mais a investigação já registrada abaixo): o cliente só
  recebe o que é visível (tabuleiro dos rivais, em `TFTEoGStats.json`); compras do jogador local, sem venda nem movimento, no
  `TFT.log`; nada de banco de ninguém. Obter o banco exigiria ler a memória do jogo ou interceptar a rede (proibido: Vanguard).
  Portanto **não há leitura do banco do jogador nem dos rivais**.
- **O que o indicador usa, e como é rotulado**: cópias em tabuleiros rivais (observado), cópias estimadas nos bancos rivais
  (`hiddenHoldings`, **estimativa**, nunca leitura; o tooltip diz "estimativa, não leitura") ; o banco do jogador **não entra** (a entrada
  manual foi removida da interface e o servidor ignora `bench`). `roll.mjs` → `findIndicator`: P(≥1 cópia em N lojas) com N = lojas do orçamento de rolagem (ou 5), no
  nível de agora e no seguinte; verde a partir de 50% (`POLICY.roll.chance`); ↑ quando subir de nível leva ao verde, ↓ quando
  tira (custos baixos). Só informa; não manda comprar nem rolar.

### Reserva (bench) e livro-razão de eventos

Segunda passada (2026-10-10): em vez de procurar um estado pronto, tentou-se **reconstruir a reserva somando eventos** (se
comprei, entrou; se vendi, saiu; o mesmo para o inimigo). Resultado: **a soma das entradas fecha, as saídas não existem no log**.
A reserva **não** é reconstruível por arquivo; continua manual. Módulo: `unit-ledger.mjs` (ligado a `game-log.mjs`).

**1. Todos os tipos de linha que mudam o conjunto de unidades (10 `TFT-backup-*.log` + `TFT.log`, ~50 MB, em fluxo):**

| Evento do jogo                                             | Linha no log                                                                                               | Gravado?                                                                             | Observações                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Compra na loja                                             | `TFTAudioEventSubsystem: Trigger[Audio.Event.VO.Unit.Purchase] Actor[TFTCharacter_<id> {DA_18_<Campeão>}]` | **sim**                                                                              | cada compra cria uma **entidade nova** (`TFTCharacter_<id>`, ids decrescentes a partir de 2147483647). Se outra voz toca, vem `Actor[...] and Event[...Purchase] was blocked by InterruptChannel[AC_VO_Round]`: a compra ocorreu e deve contar. A voz "bloqueada" também aparece **junto** da tocada para a mesma entidade (duplicata, contar uma vez) |
| Fusão / subida de estrela                                  | `Audio.Event.VO.Unit.StarUp.2Star` / `.3Star` com o `TFTCharacter_<id>`                                    | **sim**                                                                              | o id citado é o **da unidade que sobrevive** (é o id de uma compra anterior); as outras duas cópias somem sem linha própria. Cascata: um 3★ pode vir com um 2★ "bloqueado" no mesmo milissegundo                                                                                                                                                       |
| Venda                                                      | nenhuma                                                                                                    | **não**                                                                              | sem `Sell`, `Destroy`, `Remove`, `SetOwner`; só ~900 linhas `ViewState[ViewState.Playing.Shop.Selling] missing ViewData` (ver abaixo)                                                                                                                                                                                                                  |
| Movimento tabuleiro<->reserva                              | só `TFTDragSubsystem: IsDragDropCompatible Dragged[...] Dropped[BP_DefaultBench_C_1_Slot_<l>x<c>           | BP_DefaultBoard_C_0_Slot_<l>x<c>] blocked by DraggedTag[DragDrop.Draggable.BoardOnly | BenchOnly]`                                                                                                                                                                                                                                                                                                                                            | **não** (só os **recusados**) | os aceitos não são gravados. Os recusados são: chave de armário (`TFTArmoryKey`) solta no tabuleiro e unidade "só tabuleiro" solta na reserva. Os ids de espaço (`Slot_0x2`...) existem, mas nunca para um arrasto aceito |
| Entrada por carrossel / aprimoramento / prêmio / reconexão | nenhuma (só a música `Gameplay_Carousel`)                                                                  | **não**                                                                              | essas peças aparecem em campo sem compra no log                                                                                                                                                                                                                                                                                                        |
| Criação / destruição de entidade                           | nenhuma                                                                                                    | **não**                                                                              | o id `TFTCharacter_<id>` só aparece em voz (compra, estrela, `Spell`, `UnitCombatVictory`), em avisos de rede/Chrono (`ChronoSequencer_TFTCharacter_<id>_...`) e em avisos de malha (`GetSocketInfoByName ... Actor(TFTCharacter_<id>)`); nenhum marca nascimento ou morte                                                                             |
| Rolagem, compra de XP, ouro, juros, renda                  | nenhuma                                                                                                    | **não**                                                                              |                                                                                                                                                                                                                                                                                                                                                        |

- **Pistas indiretas que NÃO servem** (medidas): `Shop.Selling` aparece em **100%** das vezes até 300 ms depois de um `Cursor style changed
  Style[ETFTCursorStyle::Drag]` (106/106 e 91/91 nas duas partidas testadas), ou seja, é "uma unidade foi pega para arrastar",
  igual para mover e para vender (e a venda por tecla não arrasta). `Attempted to remove tag: Role.*/Item.*/Movement.*` (~20 mil linhas)
  são avisos de teardown de combate/itens, sem id de entidade. `ClearAllAbilities() without authority` só ocorre no fim da partida.
- **Rotação**: o jogo guarda ~10 `TFT-backup-*.log`; o mais antigo é apagado quando um novo é criado (o de 2026-10-09 23:16 já sumiu).
  Os trechos usados nos testes foram copiados para `tests/fixtures/`.
- **Queda e reconexão**: duas das 8 partidas (3291485607 e 3291600904) tiveram queda de vídeo (`D3D12 ... nv-gpudmp`, "GPU travada") e
  reconexão: o log vira **dois arquivos**, os ids de entidade recomeçam e as unidades da primeira execução voltam a campo sem compra.
  O livro-razão guarda as execuções por partida (`runs`) e soma as duas.

**2. Validação com verdade conhecida** (8 partidas de 2026-10-09/10 cujo log existe; verdade = `boardPieces` do jogador em
`TFTEoGStats.json`, 197 retratos em `scouting-captures.jsonl`, e o tabuleiro final em `match-history.jsonl`). Contagem em cópias
de 1★ (2★ = 3, 3★ = 9). "Sobra" = adquirido menos tabuleiro (= reserva + vendidas, indistinguíveis).

| Partida                  | Compras (log) | Retratos | Retratos explicados pelo adquirido | Sobra média | Reserva provada média | Final: adquirido / tabuleiro / sobra / falta |
| ------------------------ | ------------- | -------- | ---------------------------------- | ----------- | --------------------- | -------------------------------------------- |
| 3291404150               | 66            | 31       | 8                                  | 21,5        | 1,5                   | 66 / 21 / 48 / 3                             |
| 3291418504               | 57            | 31       | 9                                  | 13,3        | 3,4                   | 60 / 41 / 22 / 3                             |
| 3291437763               | 47            | 20       | 10                                 | 10,7        | 1,1                   | 48 / 22 / 26 / 0                             |
| 3291452829               | 51            | 25       | 13                                 | 15,9        | 0,6                   | 54 / 22 / 32 / 0                             |
| 3291470386               | 34            | 21       | 9                                  | 5,8         | 1,0                   | 35 / 15 / 20 / 0                             |
| 3291485607 (2 execuções) | 34            | 18       | 2                                  | 6,7         | 0,8                   | 43 / 26 / 18 / 1                             |
| 3291596434               | 44            | 28       | 4                                  | 10,6        | 1,7                   | 46 / 31 / 16 / 1                             |
| 3291600904 (2 execuções) | 30            | 23       | 7                                  | 6,2         | 0,5                   | 34 / 17 / 17 / 0                             |
| **Total**                |               | **197**  | **62 (31%)**                       | 5,8 a 21,5  | 0,5 a 3,4             | sobra 16 a 48                                |

- **"Reserva provada"** = peça que não estava em campo no retrato e volta a campo (ou funde) depois, sem compra no intervalo: é um
  **piso** da reserva real, só conhecível depois do fato.
- **O que fecha**: as **compras** do log são confiáveis. Nas peças que terminam em campo o adquirido bate exato ou excede por 1 a 2
  cópias (partida 3291596434: Rengar 9/9, Rammus 3/3, Yunara 3/3, Leona 4/3, Lillia 4/3; partida 3291600904: todo o tabuleiro final
  explicado, falta 0). Em 4 das 8 partidas o último retrato é explicado por inteiro; nas outras faltam 1 a 3 cópias (carrossel, prêmio,
  peça do início da partida, ex.: o KhaZix e a Leona 1★ de 2026-10-10 15:58/15:59 não têm compra).
- **O que NÃO fecha**: a **sobra** é de 16 a 48 cópias no fim (reserva comporta 9), em média 5 a 25 vezes a reserva provada. A conta
  `adquirido - tabuleiro` é, portanto, **muito maior que a reserva real**; o resto são vendas que o log não registra. Dizer a reserva
  exigiria o evento de venda e o de movimento, que **não existem**. A taxa de acerto da reserva reconstruída **não se calcula**
  (não há verdade da reserva em arquivo); só os pisos acima.
- Estimador testado: "reserva = sobra das compras dos últimos 90 s". Lembra apenas 15% a 71% (média ~38%) da reserva provada e erra
  as demais: **rejeitado**, não entra no servidor.

**3. Ouro, XP, nível por soma de eventos**: impossível. Não há evento de venda (reembolso), rerolagem (2g), compra de XP (4g), juros,
renda, sequência de vitórias/derrotas nem pontos de combate; só o custo das compras (derivável do catálogo). Sem verdade que feche o
saldo (nem ouro final em arquivo), **não implementado**. Continua tela/manual.

**4. Rivais**: o cliente só recebe o que é visível. O log **não traz nenhum evento de compra, venda ou movimento de outro jogador**.
Provas: (a) a voz de compra só ocorre para o jogador local (30 a 66 compras por partida, contra mais de 250 se fossem 8 jogadores);
(b) as únicas aparições de unidades alheias são vozes de feitiço/vitória (`Unit.Spell`, `UnitCombatVictory`) durante o combate e
os tabuleiros de `TFTEoGStats.json`, que já são usados; (c) os nomes de outros jogadores aparecem só em `TFTPlayerAFKSubsystem`.
**Bancos dos rivais seguem como estimativa** (`hiddenHoldings` com `BENCH_POLICY`, abaixo), nunca dado observado.

**5. Integração** (`server.mjs`, `GET /api/state`): campo `unitLedger` (`gameFiles.ledger(gameId, boardPieces do jogador)`) com
`purchases` (observado), `reconciliation` (derivado: adquirido, tabuleiro, sobra, falta por campeão, `soldAtLeast`), `bench`
(`reconstructable: false`, `reliability: "estimated"`, `upperBound` = sobra) e `validation` (os números acima). A validação **não passou**,
então o servidor **não** usa o livro-razão no lugar da reserva manual: `screen.sources.bench` continua `"manual"` e a entrada manual
segue sendo a única reserva que alimenta a análise. A execução do jogo só entra no livro-razão da partida depois que o arquivo de
contexto (`__sentry-event`) é regravado depois do `BeginGame` dela (evita misturar partidas); se o servidor começar depois de uma
queda, a primeira execução já não está no `TFT.log` atual e fica de fora (compras "sem compra" na conta).

- **Limite da reserva provável**: se algum dia se quiser uma reserva "provável", o único caminho honesto é combinar o teto do livro-razão
  com o que o usuário confirma na interface (manual prevalece), nunca substituí-la.

**Pista (hints) antiga**: a voz de compra continua em `gameFiles.hints.purchases` / `starUps` (estimada, só contagem); o livro-razão a
supera para o ADQUIRIDO.

### Banco de itens e loja

- **Banco de itens**: sem fonte em arquivo. Pista indireta (estimada): cada `ItemFlyToBench_INST` em `TFT.log` é um item que
  foi para o banco (`hints.itemsReceived`, só a contagem; não diz qual item). Segue pelo leitor de tela (ícones).
  - **Por que apareciam "?" (verificado sobre uma coluna real gravada, sem captura nova)**: (1) o HUD escalado/centralizado em
    janela não 16:9 deslocava a coluna (ver "Nível"); (2) a distância era RGB absoluta, e o jogo escurecido por um painel
    (escolha de aprimoramento) deixava até o ícone certo fora do limite, com folga de 1 a 2 do segundo colocado; (3) o selo
    de quantidade do item empilhado (ex.: "6" no Removedor) sujava o canto do ícone; (4) espaço vazio com média de brilho
    acima de 14 (cenário claro atrás do espaço; observado 15 no 10º espaço) virava item "?"; (5) o item e a sua variação
    radiante, de ícones quase iguais, se anulavam como 1º e 2º candidatos.
  - **Reconhecimento atual** (`Tft.Match`, `Classify-Slot` em `screen-reader.ps1`): distância invariante ao brilho = 1 −
    correlação normalizada por canal (forma) + 2 × diferença de proporção de cor (separa o Removedor comum do dourado), sem o
    canto do selo; o 2º colocado é o melhor de OUTRA família (item e radiante são a mesma família, nas duas grafias do id:
    `DA_XRadiant` e `DA_X_Radiant`); vale se a distância ≤ 0,6 e a folga ≥ 0,1 (ou 1º a ≤ 75% do 2º); item **raro**
    (artefato, emblema, radiante) pede ≤ 0,45, folga ≥ 0,15 (ou 60%); vazio = escuro e liso (média ≤ 14, ou ≤ 40 com desvio
    ≤ 10); espaço que já foi reconhecido e passa a não reconhecido mas ainda é o mesmo ícone (distância ≤ 0,45 do que foi
    reconhecido) mantém o item em vez de piscar "?". Validado em `tests/item-bank.test.mjs` (coluna real: Removedor
    empilhado, Cinturão do Gigante, vazios, brilho ×0,7 e ×1,4). **Limite**: um ícone que não está no catálogo local (um item
    no 2º espaço dessa coluna) segue "?", de propósito.
  - **Falso positivo (revisão de 2026-10-10 17h, ao vivo: banco "[BrambleVest, MogulsMail, Manazane, Manazane] + 6 ?", e o
    usuário disse que não eram os itens dele)**: o leitor lia a região errada. Na janela maximizada (cliente 2560x1351) a
    coluna ficava ancorada à borda esquerda, mas o retângulo 16:9 centralizado a procurava 79 px à direita, em cima da lista
    de sinergias (ícones hexagonais com a mesma pitch dos espaços): 10 regiões "ocupadas", das quais 4 passavam no limite antigo
    (0,75 e folga 0,08, com deslocamento de ±3 px escolhendo o mínimo de 35 distâncias). **Evidência, sem captura nova**
    (`data/screen-calibration.png`, só como arquivo): na coluna real, itens certos medem 0,14 a 0,51 (escurecido); a região da
    lista de sinergias, 0,55 a 0,90 e dava artefatos (MogulsMail 0,656, Manazane 0,655 a 0,704, TitanicHydra 0,55). A
    hipótese de ícone faltando **não** se sustenta: os 118 ids de item equipados distintos dos dados gravados têm candidato
    (4 compartilham o ícone do item base) e os excluídos de `bench-candidates.mjs` só usam o ícone genérico de mecânica
    (`set18_mechanicicon`). Outra falha achada: a radiante `DA_X_Radiant` (7 itens) não era da família do item base e
    anulava a folga (item reconhecido virava "?").
  - **Onde está a coluna** (`Locate-Column`, `Bank.Lattice`; **substituiu o molde `Tft.FindFrame` em 2026-10-11**, ver "Leitor de tela
    próprio"): não se supõe; a grade dos espaços é **medida na imagem** (passo, primeiro topo e bordas laterais), porque o HUD não
    escala linearmente com a altura (passo de 36 px em 720p e 56 px em 1149p; o molde de 1149p e as frações `$SLOT` erravam ~0,9 px por
    espaço em 720p, 8 px no 10º). Sem grade confirmada por 3 laços (`bankGeometry.mode = "assumed"`), usa o retângulo 16:9 do HUD e só
    aceita item com o mesmo rigor dos raros. Os campos de nível/ouro/XP continuam pelo retângulo centralizado.
  - **Diagnóstico ao vivo, sem imagem** (`GET /api/state` → `screen.bankDebug` e `screen.bankGeometry`): por espaço
    `{slot, value, best, d1, d2, mean, spread, kept}` (`best` = melhor candidato, `d1` sua distância, `d2` a do melhor de outra
    família, `mean`/`spread` o brilho e o desvio da assinatura, `kept` = valor mantido pela memória do espaço) e a geometria
    `{mode: "frame"|"assumed", x, pitch, hits, edge, client}` (`pitch` = passo medido entre os espaços em px; `hits` = espaços, de 10,
    cujo topo ou borda de baixo bateram na grade; `edge` = nitidez das bordas laterais). É a leitura de agora (não passa pelo debounce de `bank`).
    Com isso cada "?" se explica: `d1` > 0,6 (ou > 0,45 se raro) = ícone fora do que o leitor reconhece; `d2 − d1` pequeno =
    ambiguidade real (ex.: `DA_18_EmblemFloraFatalis` e `DA_18_EmblemJuggernaut` distam 0,405 entre si).
  - **Interface**: o banco mostra "N não reconhecidos: fora da análise" (a dica dá a proporção de componentes entre os
    reconhecidos, só como estimativa); "?" nunca vira item.
  - **Não verificado**: leitura contínua numa partida inteira com o banco cheio; que a moldura é achada na janela real do
    usuário (a escala 1,176 foi testada em imagem reescalada da calibração, não numa captura real); os limites 0,6/0,45 foram
    calibrados com 3 itens de uma coluna escurecida (cálculo pelos dados de `bankDebug` depois que o servidor reiniciar).
- **Loja**: não aparece em nenhum arquivo (`TFTShopPlayerSubsystem` só registra tooltips e a falha de montagem no menu).
  Segue pelo leitor de tela.

### Carrossel (aberto agora, peças que oferece e o que pegar)

O carrossel (rodada em que todos escolhem um campeão com o item que ele traz) é detectado e lido SEM fonte nova: usa os arquivos do jogo e o GEP que o helper já lia. `core/state/carousel.mjs` (puro) decide; `app/carousel-view.mjs` monta o bloco `carousel` de `/api/state`.

- **Quando é carrossel** (sinais independentes; vale o de maior confiança, e o desacordo fica em `conflict`):
  1. **fase do jogo** (`game.tft.phase` do `__sentry-event`, `phaseKind`): `Draft` = carrossel, qualquer outra fase = não. Origem `game-log`, **observada**;
  2. **GEP `match_info.round_type`** com `name: "Carousel"` (`type: "Carousel"`), só se for a MESMA rodada do estágio atual (um `round_type` de outra rodada é atraso do GEP). Origem `gep`, **observada**;
  3. **calendário**: `x-4` a partir do estágio 2 (observado `2-4`, `3-4`, `4-4`, `5-4`, `6-4` em 5 partidas gravadas). Só **estimativa** (`confidence: "estimated"`, origem `schedule`).
     A `1-1` é `Encounter` (PVE) em todas as partidas gravadas: no Set 18 **não há carrossel no estágio 1**.
     Sem nenhum sinal o estado é `active: null` (desconhecido), nunca "não é carrossel".
- **O que o carrossel oferece** (leitura real): GEP `carousel.carousel_pieces`, um evento no início de cada carrossel (mesmo segundo do `round_type`), coluna `round` = rodada:
  `{"slot_1":{"name":"DA_18_MasterYi_AD","item_1":"DA_Component_RecurveBow","item_2":""}, ..., "slot_13":{...}}`. Cada peça é um **campeão com um item** (`item_2` nunca veio preenchido). Medido nos 5 jogos do banco do TFTAcademy: 19 carrosséis, 9 a 13 peças, **0 nomes fora do catálogo**.
  Estágios 2 a 4: só componentes (e Espátula/Frigideira); do 5 em diante, itens completos e emblemas. É a oferta **inicial**: o GEP não grava quem escolheu o quê, nem a ordem de escolha, nem o tempo restante; a peça que alguém levou continua na lista.
  A oferta só vale na rodada em que foi lida (o GEP não a apaga: a do carrossel anterior fica no banco); `screen.carouselOffer` = `{stage, slots, unknown, ageMs}` e `screen.gepRound` = `{stage, name, ageMs}`, só com GEP ativo (frescor de 60 s: o maior silêncio medido no carrossel foi 36 s).
- **O que pegar**:
  - **com a leitura** (`carousel.from: "reading"`): todas as peças em ordem de valor (`carousel.mjs:rankCarouselOffer`, a mesma conta da lista de prioridade): componente = o quanto fecha/começa item de quem importa (carry > tanque > demais; o banco de agora distribui); item completo de uma build do plano = pronto (poupa dois componentes); emblema = vale se o plano usa a sinergia; o resto vale 0. Soma um bônus pequeno se o campeão da peça é o carry (ou peça) do plano. Pesos **heurísticos** (mesma escala da conta de componentes), não medidos contra resultado de partida;
  - **sem a leitura** (GEP ausente/velho/oferta de outra rodada: `from: "priority"`): lista dos até 5 componentes que mais valem **se aparecerem** (`carouselPicks`), com o motivo; a interface diz "prioridade: não lido" e o bloco traz `note`. Nunca é apresentada como leitura;
  - as duas usam as builds da última análise (`recommendationBody()` do feed do overlay) e o banco de itens de AGORA; sem análise (ou de outra partida) a leitura sai na ordem do carrossel, sem nota, e a prioridade não existe (`note`).
- **Ponte GEP própria** (`overwolf-bridge/`): já pede a feature `carousel` e grava `carousel.carousel_pieces` no mesmo esquema (coluna `round`; "0-0" antes da primeira rodada é ignorada, vale a rodada do último `round_type`). O TFTAcademy também pede `carousel` (`TFT_FEATURES`) e trata a chave `carousel_pieces`; nenhum outro dado de carrossel (escolhas, tempo) aparece nos eventos gravados nem nas chaves tratadas por ele.
- **Outros eventos parecidos, não usados**: `match_info.item_select` (escolha de componentes/itens/aprimoramentos de rodadas de saque, como 4-1 e 5-1, não do carrossel) e `picked_item`. Ficam fora até haver um uso.
- **Bloco no `/api/state`**: `carousel = { active, stage, round, source, confidence, signals: {phase, gep, schedule}, conflict, from, picks[], offer, plan, note }`; `picks[]` = `{rank, slot, championId, championName, itemId, itemName, kind, score, reason, completesNow, forChampion, forChampionId, target}` (nomes `null` quando só os ids são conhecidos: a interface os resolve pelo catálogo). Fora do carrossel `picks` é vazio e nada é calculado.
- **Não verificado ao vivo**: o bloco ao vivo no servidor durante um carrossel real (a oferta, a detecção e a composição estão testadas com os payloads gravados e com o estado composto como o servidor o faz); a latência entre o início do carrossel e o `Draft` do `__sentry-event`; se o `Draft` aparece também em outras rodadas de escolha (o GEP as chama de `item_select`, não de `Carousel`).

### Comp, itens equipados e tabuleiros de todos os jogadores

- `TFTEoGStats.json`: o jogo regrava durante a partida (mtime e tamanho mudaram ao longo da partida observada: 4,3 KB → 6,4 KB → 7,5 KB em ~10 min). Lido por
  `capture.mjs` a cada 0,5 s. Nomes são ids `DA_*` iguais aos `apiName` do catálogo. Contém só peças **em campo**. `itemNames`
  traz itens equipados; a Luva de Ladrão traz também os 2 itens sorteados (tratado em `server.mjs`).

### Bancos dos rivais (estimados, não observados)

- O jogo não grava o banco de ninguém. O helper estima com `hiddenHoldings(rows, {policy})` em `pool-tracker.mjs` a partir da
  sequência de tabuleiros capturados: uma cópia que sai do campo pode ter sido vendida (volta à pool) ou guardada (continua
  fora). Hipótese registrada: cada cópia que sai conta como "provavelmente guardada" com peso `keep` que decai com a idade;
  se a peça volta ao campo (ou vira 2★) a cópia guardada é reconhecida e deixa de contar; rival eliminado é ignorado.
- **Parâmetros (`BENCH_POLICY`)**: `keep = 0.5` (chance inicial de a cópia ter ficado no banco), `halfLifeMs = 180000`
  (meia-vida de 3 min), `maxCopies = 18` (teto por rival). **São estimativas; nunca apresentar como dado observado.**
- Usado no cálculo de pool/rolagem (`server.mjs`, `hiddenHoldings(...)`).

## MetaTFT offline (extensão `meta-store.mjs`)

Os quatro conjuntos de meta passam por um módulo só, `meta-store.mjs`; o servidor e o script do atalho usam a mesma interface
(`load`, `refresh`, `sync`, `freshness`, `status`). A recomendação não muda: só a camada de dados.

| Conjunto (`nome`) | Origem (não oficial)                                                      | Cópia no repositório | Vence após |
| ----------------- | ------------------------------------------------------------------------- | -------------------- | ---------- |
| `comps`           | MetaTFT `tft-comps-api` (`comps_data`, `comps_stats`)                     | `meta-comps.json`    | 2 h        |
| `builds`          | MetaTFT `unit_items_processed` (builds e desempenho por item)             | `meta-builds.json`   | 6 h        |
| `stats`           | MetaTFT `tft-explorer-api` (peça × estrela × itens, sinergia × patamar)   | `meta-stats.json`    | 12 h       |
| `augments`        | NoxuTFT (colocação medida) + MetaTFT `comp_augment_tiers` (tier por comp) | `augment-stats.json` | 6 h        |

- **Funciona sem rede desde a primeira execução.** A leitura escolhe a cópia de `fetchedAt` mais recente que passa na validação,
  entre (1) os snapshots do usuário em `tft/data/meta-store/<conjunto>/<set>__<patch>.json` (mais a cópia boa anterior de cada patch,
  `.prev.json`) e (2) o snapshot embarcado no repositório (`meta-*.json`, que **nunca é reescrito em execução**; a pasta `tft/data/` fica
  fora do Git). Sem nenhuma cópia válida o conjunto vem vazio (`origem: ausente`) e a interface avisa.
- **Validação ao ler e ao gravar.** JSON ilegível ou cortado, outro `set`, `fetchedAt` inválido ou fora do esquema (comps sem unidades,
  builds vazias, estatísticas sem sinergias...) descarta a cópia, que fica em `problems` (com o motivo) e a leitura cai na seguinte. O
  download vai para uma pasta de preparo, é validado e só então promovido por escrita atômica (arquivo temporário + `rename`); resposta
  ruim (set errado, HTTP 5xx, lista vazia) nunca substitui a cópia boa. A cópia boa do mesmo patch vira `.prev.json` antes de ser trocada.
- **Recorte único (`meta-scope.mjs`).** Comps (`comps_stats`), estatísticas (`tft-explorer-api/*`, `meta-stats.mjs`) e as perguntas de
  evidência (`evidence.mjs`) usam o mesmo filtro, definido só ali: `queue=1100&patch=current&days=3&rank=CHALLENGER,…,PLATINUM&permit_filter_adjustment=true`.
  Sem ele o explorer devolve uma base antiga de outro set: em 2026-10-11, `total` sem filtro = 12.616 tabuleiros com ids `TFT17_*`; com ele,
  7,55 milhões do Set 18. Foi o que contaminou o `meta-stats.json` daquele dia (1.023 chaves de peça, todas `TFT17_*`, 0 do catálogo) e o
  `data/evidence-cache.json` (2.027 perguntas `DA_*`, todas com 0 partidas): trunfos, `options.conditional` e a medição de tabuleiros
  ficaram vazios. Um teste (`tests/meta-scope.test.mjs`) garante que o recorte e a leitura do patch só existem em `meta-scope.mjs`.
- **Fora do set.** Ao ler e ao baixar, uma cópia de `stats` que não cobre pelo menos metade dos campeões e das sinergias do catálogo
  (`catalog.json`) é recusada com o motivo `fora do set: X de 74 campeões e Y de 36 sinergias…` (fica em `problems`, `freshness().outOfSet`
  vira `true`) e a leitura cai na cópia seguinte; a do Set 18 cobre 65 de 74 e 36 de 36. No cache de evidência, ao ler o arquivo, são
  descartadas as respostas sem a etiqueta do recorte atual (`scope`, hash do filtro), as que citam peça ou sinergia fora do catálogo e, por
  último, o cache inteiro quando tudo o que sobrou tem 0 partidas (a partir de 5 respostas); o descarte vai para o log e as perguntas são
  refeitas. Resposta condicional nova (`units_unique`, `traits`) com a maioria dos ids fora do catálogo é recusada e não entra no cache.
- **Patch.** Cada patch publicado tem o seu arquivo e os 3 mais recentes ficam; se o patch novo estiver corrompido, a leitura volta ao
  anterior. O patch vem de `unit_items_processed.region_patch_adjustment.selected_patch` ("18.4b"): `builds` o lê da própria resposta;
  `comps` e `stats` o pedem à mesma rota (66 KB) em paralelo, porque `comps_stats` deixou de trazer `filter_adjustment.selected_patch`.
  Sem o patch (rota fora do ar) o download segue com `patch: null` (`<set>__sem-patch.json`). `augments` não tem patch: um arquivo por set
  e a reserva é o `.prev.json`.
- **Frescor** (`freshness(nome)`, `status()`): `modo` = `em-dia` (dentro do prazo da tabela), `offline` (vencido e a última tentativa
  falhou por rede ou prazo) ou `desatualizado` (vencido por outro motivo, p.ex. renovação ainda pendente ou resposta recusada); mais
  `origem` (`local`, `repositorio`, `ausente`), `fetchedAt`, `patch`, `ageMs` e `recovered` (a leitura precisou de uma reserva). A última
  tentativa de cada conjunto fica em `tft/data/meta-store/status.json`, então o servidor enxerga o resultado da sincronização do atalho.
- **Onde aparece.** `GET /api/comps` e `GET /api/items` (e o evento SSE `meta`) trazem `freshness`; a interface mostra uma nota ao lado da
  fonte que já exibia (`v2/js/meta-freshness.js`): "offline · dados de 5 h", "desatualizada · dados de 3 d · snapshot do repositório" etc.
  Em dia e vindo da rede, não há nota.
- **Atalho.** `start-all.ps1` roda `node scripts/meta-sync.mjs --timeout=12000` **antes** de subir o servidor (só quando ele ainda não
  está no ar; se já está, ele mesmo renova em segundo plano). O script baixa só o que venceu, tem teto de 12 s (máximo 15 s; o
  PowerShell ainda encerra o processo aos 18 s), imprime **uma linha** no resumo e sempre sai com 0:
  `meta atualizada (comps, builds, ...; patch X)`, `meta em dia (dados de N atrás)`, `meta atualizada em parte (...)` ou
  `meta offline: dados de N atrás (cópia local | snapshot do repositório)`. Opções: `--force`, `--only=comps,builds`, `--dir=PASTA` e
  `--embed` (manutenção, nunca no atalho: o que foi baixado e validado nesta execução também regrava o snapshot do repositório,
  `meta-*.json`; foi assim que o `meta-stats.json` foi refeito com o recorte em 2026-10-11).
  O servidor continua renovando em segundo plano (comps a cada 15 min, builds 30 min, estatísticas e aprimoramentos 60 min, cada um só
  se vencido) e, sem rede, segue com a cópia que tem.
- Testes: `node --test tests/meta-store.test.mjs tests/meta-scope.test.mjs v2/js/meta-freshness.test.mjs` (rede ok, rede fora, cópia
  corrompida, resposta ruim, troca de patch, prazo estourado, o script com a rede desligada, recorte em toda consulta, estatística e
  evidência fora do set, cache inteiro com 0 partidas; disco real em pasta temporária e respostas no formato da MetaTFT, cujo explorer
  falso responde outro set quando a consulta vem sem o recorte).
  Sincronizar à mão: `node scripts/meta-sync.mjs --force` em `tft/helper`.
- Limitações: os endpoints são não oficiais e podem mudar; a validação confere o esquema que o helper consome, não a exatidão dos números.
  O prazo de 12 s do atalho vale para o conjunto inteiro; downloads que não terminam ficam para a renovação em segundo plano do servidor.

## GEP / TFTAcademy (banco de eventos do Overwolf, somente leitura)

Decisão do usuário (2026-10-10): obter ouro, nível/XP, loja (campeões e Wisps), reserva, banco de itens e aprimoramentos (oferta e
escolhidos) **do próprio jogador** sem leitura de tela, pelo banco SQLite que o app **TFTAcademy** grava a partir do Overwolf Game
Events Provider (GEP). Implementação: `gep-reader.mjs`; testes: `tests/gep-reader.test.mjs` (fixture sem dados pessoais em
`tests/fixtures/gep-events.json`). Pesquisa de origem: `pesquisa/canais-locais-alternativos.md` e `pesquisa/tft-academy-analise.md`
(seções 3, 5.2 e 5.3). Verificado em 2026-10-10 sobre a partida curta de 2026-09-11 (~60 s) e, em 2026-10-11, sobre uma **partida completa**
(27 min, 3455 eventos, colocação 6): replay ponto a ponto, mapeamento ao catálogo, invariantes e cadência em
`pesquisa/gep-validacao-partida.md`. [DER] = vem do código do TFTAcademy e continua sem amostra real; [INC] = a confirmar.

### Arquivo e acesso

- `%APPDATA%\TFTAcademy\tft-events.db` (`TFT_GEP_DB` troca o caminho). SQLite em modo WAL, esquema Drizzle do app (privado, pode mudar).
- **Somente leitura**: `node:sqlite` (Node 24.18, sem pacote novo). `gepOpenMode(file)` devolve `"compartilhado"` (leitura `readOnly`
  normal, que enxerga o `-wal`) se existir `-wal` ou `-shm`, e `"imutavel"` (`immutable=1`, que não cria arquivos na pasta do
  TFTAcademy) **só** quando nenhum dos dois existe: `immutable=1` com `-wal` ignoraria as linhas ainda não passadas ao `.db` e perderia
  dados. `timestamp`/`created_at` são segundos. A consulta de eventos filtra pelo **par `feature.key`** (a chave `me` também existe em
  `live_client_data`); só quando a coluna `feature` falta ou é nula cai para a chave sozinha, e a chave `me` isolada é ambígua e fica
  fora desse fallback (sem a coluna, a oferta de aprimoramentos não é lida). Cada leitura abre, consulta e fecha (nada fica aberto), com
  `busy_timeout` de 150 ms e intervalo mínimo de 1 s entre leituras; erro não transitório recua 5 s. Medido: ~12 ms a primeira leitura,
  ~0,04 ms as seguintes (dentro do intervalo). O arquivo `.db` nunca é escrito (SHA-1, tamanho e mtime idênticos antes e depois de ler o
  original). Efeito inevitável de qualquer leitor WAL: o `-shm` (índice em memória compartilhada) tem a mtime atualizada.
- Não inicia, não configura e não controla o Overwolf nem o TFTAcademy. Sem os dois rodando durante a partida **não há dados**.

### Esquema observado

- `games(id TEXT PK, started_at, ended_at, game_version, set_number REAL, player_puuid, final_placement, queue_type, created_at, match_id, recording_*, favorited, custom_title)`.
  `match_id` = `BR1_<gameId>` (o mesmo `gameId` do LCU, do `TFTEoGStats.json` e do `__sentry-event`): liga o banco à partida. `ended_at`,
  `player_puuid` e `final_placement` vieram nulos na partida gravada (o leitor não depende deles; o PUUID não é lido).
- `events(id INTEGER PK AUTOINCREMENT, game_id → games.id, timestamp, event_type, player_id, round, stage_type, key, data, created_at, feature, category)`;
  índices `(game_id, timestamp)`, `event_type`, `(game_id, round)`. `timestamp` e `created_at` são segundos (época Unix; iguais nas 76 linhas:
  o app não grava com atraso mensurável). `round` = estágio-rodada ("1-2"; "0-0" antes de começar). `data` é texto JSON (alguns campos têm
  JSON dentro de JSON: "parse it twice").
- Outras tabelas (`riot_accounts`, `custom_comps`, `user_notes`) **não são lidas**. De `settings` lê-se **uma única chave**,
  `record_games` (`SELECT value FROM settings WHERE key = ?`, somente leitura), só para diagnosticar a falta de eventos (ver "Gravação
  desligada").
- Partida mais recente: `ORDER BY started_at DESC`. Linhas novas: `id` crescente (`id > último lido`); o "evento mais recente" é
  `MAX(timestamp)` de **qualquer** linha da partida (inclusive as não lidas: prova que o GEP está vivo).

### Gravação desligada (diagnóstico)

- **Causa de o banco quase não ter eventos** ([DER] do código do TFTAcademy, `pesquisa/tft-academy-analise.md` seção 3): o app só grava em
  `tft-events.db` com a configuração `record_games` **ligada**. Desligada, ele continua emitindo os eventos ao próprio overlay, mas não
  grava nada, e no fim da partida apaga a linha dela em `games` (log do app: "Deleted non-recorded game from DB"). Por isso o banco só
  tem os 76 eventos de 2026-09-11 (~1 min, partida interrompida antes de ser finalizada ou apagada). Na análise do app, `settings` tinha
  `record_games = 'false'`.
- **O que o leitor faz**: lê só `settings.record_games` (`parseRecordGames`: texto `"true"`/`"false"`, JSON ou 0/1; ausente ou ilegível
  = `null`) e expõe `gepStatus.recordGames` (`true` | `false` | `null`). Com `false` e a fonte **não** ativa por falta de partida ou de
  eventos (motivos `sem-partida`, `sem-eventos-recentes`, `outra-partida`, `partida-encerrada`), o estado vira `ausente` com
  `reason: "gravacao-desligada"` e o motivo original em `was`. Com dados frescos (partida que já estava sendo gravada) segue `ativo`.
- **Efeito**: o HUD (chip e dica) manda ligar "gravar partidas" no TFTAcademy. O helper **nunca altera essa configuração** (nem escreve
  no banco).

### Eventos lidos (`feature.key`) e formato real

| Evento                     | Payload (valores reais, truncados)                                                                                                                                                                                                       | Uso                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `me.gold`                  | `2`, `1`, `{}`                                                                                                                                                                                                                           | ouro (ver o `{}` abaixo)                             |
| `me.xp`                    | `{"level":2,"current_xp":0,"xp_max":2}`                                                                                                                                                                                                  | nível e XP `"0/2"` (mesmo formato do leitor de tela) |
| `match_info.round_type`    | `{"stage":"1-3","name":"PVE","type":"Minions_2","native_name":"Intro2"}`                                                                                                                                                                 | estágio-rodada                                       |
| `match_info.match_state`   | `{"in_progress":true}`                                                                                                                                                                                                                   | fim de partida (zera a leitura de `{}`)              |
| `store.shop_pieces`        | `{"slot_1":{"name":"DA_18_Sentry"},...,"slot_5":{...}}`; comprado vira `{"name":"Sold"}`                                                                                                                                                 | loja (5 espaços; vendida = vazio)                    |
| `store.shop_visible`       | `"true"` / `"false"`                                                                                                                                                                                                                     | loja escondida não substitui a lida da tela          |
| `bench.bench_pieces`       | `{"cell_1":{"name":"DA_18_Varus","level":"1","item_1":"","item_2":"","item_3":""},...}`; `{}` = vazia                                                                                                                                    | reserva (estrelas e itens por peça)                  |
| `bench.item_bench`         | `[{"summoner","tag_line","bench_items":[{"name":"DA_Consumable_ItemRemover","count":2}]}, ...]`                                                                                                                                          | banco de itens (só a linha do jogador local)         |
| `roster.player_status`     | `{"<nome>":{"index","health","xp","localplayer":true,"rank","tag_line"}, ...}`                                                                                                                                                           | só para achar quem é o jogador local (`localplayer`) |
| `carousel.carousel_pieces` | **observado**: `{"slot_1":{"name":"DA_18_MasterYi_AD","item_1":"DA_Component_RecurveBow","item_2":""},...}`, um evento no início de cada carrossel (coluna `round`)                                                                      | peças do carrossel: campeão + item                   |
| `augments.me`              | **observado**: `{"augment_1":{"name"},"augment_2":{"name"},"augment_3":{"name"}}`, um evento a cada reroll de UMA carta; todos `""` = tela fechada                                                                                       | oferta de aprimoramentos                             |
| `augments.picked_augment`  | **observado**: `{"slot_1":{"name"},...,"slot_4":{"name"}}` CUMULATIVO (todos os escolhidos até agora, na ordem; vazios `""`), reenviado a cada escolha. `match_info`/`me` + `picked_augment` seguem aceitos por tolerância, nunca vistos | aprimoramentos escolhidos, em ordem                  |

Os dois últimos foram observados na partida completa de 2026-10-11 (a feature do escolhido é `augments`, não `me`). Nunca lidos (a consulta nem os seleciona): `board.opponent_board_pieces`, `match_info.battle_stats`, `round_outcome`,
`board.board_pieces` (o tabuleiro próprio já vem do `TFTEoGStats.json`), `match_stats` e qualquer campo de rival. `carousel.carousel_pieces` É lido (a oferta do carrossel é a mesma para a mesa toda, não é dado de rival; ver "Carrossel").

### Cobertura medida (partida de 2026-09-11, 76 eventos em 60 s)

| Dado           | Gravado?                               | Evidência                                                                                                        |
| -------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Ouro           | sim, 4 eventos                         | `2` (início do 1-2), `1` (comprou Rakan), `{}` (comprou Pebbles)                                                 |
| Nível / XP     | sim, **1 evento**                      | `level 2, 0/2` em 1-3. Só é emitido quando muda: o nível 1 nunca aparece (fica desconhecido até o 1º `me.xp`)    |
| Estágio-rodada | sim                                    | `round_type` em 1-1, 1-2, 1-3 (e a coluna `round`)                                                               |
| Loja           | sim, 3 eventos                         | `shop_pieces` no início do 1-2, depois uma por compra, com `Sold`                                                |
| Reserva        | sim, 5 eventos                         | `bench_pieces` acompanha cada compra e a ida de Leona ao tabuleiro                                               |
| Banco de itens | sim, 13 eventos                        | `item_bench`: só `ItemRemover ×2` na linha local; ver "Titularidade"                                             |
| Aprimoramentos | sim, na partida completa de 2026-10-11 | oferta `augments.me` (12 eventos, 3 rodadas) e `augments.picked_augment` (3 eventos); 15 de 15 nomes no catálogo |
| Wisps          | sim, na partida completa de 2026-10-11 | `shop_pieces` comum: 28 cartas (24 no `slot_5`; uma loja de 5 Wisps no 5-1); ver "Aprimoramentos e Wisps"        |

### Titularidade: só o jogador local

- `shop_pieces`, `bench_pieces`, `gold` e `xp` são do jogador local: Leona está na reserva (0 s), sai dela e entra em `board_pieces` e no
  `battle_stats` do time 0 (18 a 24 s); a compra de Rakan (56 s) e de Pebbles (58 s) vira `Sold` na loja, soma uma peça na reserva e tira
  1 ouro cada (2 → 1 → 0).
- `item_bench` traz **os 8 jogadores**, em **ordem instável** (a posição do jogador local mudou de 2 a 6 entre eventos). Por isso a linha
  é escolhida por identidade (`summoner` + `tag_line` iguais ao `localplayer: true` do roster, sem diferenciar maiúsculas), nunca por posição.
  Sem identidade, sem a linha ou com a linha duplicada, o banco de itens fica **desconhecido** (não "vazio"). Se o servidor sabe o nome do
  jogador (`riotIdGameName`/`riotIdTagLine` do `TFTEoGStats.json`) e o roster diz outro, o banco de itens também fica desconhecido
  (`gepStatus.identity = "divergente"`). As linhas dos outros 7 jogadores são descartadas na hora e nunca guardadas nem expostas.
- **Não verificado contra o inventário real**: na janela gravada a linha local nunca recebeu componentes (4 de 7 rivais receberam), e não
  há como saber, só pelo banco, se o jogador local de fato não pegou nenhum. A atribuição é a rotulada pelo próprio GEP.

### Mapeamento para o formato do servidor

- `gold` (int), `level` (int), `xp` (`"atual/total"`; `null` no nível máximo, `xp_max` 0), `stage` (`"1-3"`), `shop` (5 posições,
  `{text, id, source: "gep"}` ou `null` se vendida; nome fora do catálogo → `id: null`), `items`/`bank`/`removers`/`unknownItems`
  (`bank` repete cada item `count` vezes e inclui consumíveis; `items` tira os consumíveis; `removers` soma os `*ItemRemover`; nome fora
  do catálogo é contado em `unknownItems`, nunca adivinhado).
- Novo: `gepBench` (reserva) = `[{id, stars, items[], cell, source: "gep"}]` e, no motor, `options.bench = [{playerId, championName, starLevel, itemNames, source: "gep"}]`.
  A reserva só entra no motor com origem GEP fresca (`server.mjs` → `gepBenchUnits`); o `validate` continua ignorando o `bench` enviado
  pela interface. Peça com estrela desconhecida fica de fora.
- Ids `DA_18_*` e `DA_*` são os `apiName` do `catalog.json` (conferidos: Sentry = Pebbles, Akali_AD, `DA_Component_*`, `DA_Consumable_ItemRemover`).
- **`me.gold` `{}`**: aparece no começo da partida e quando o ouro chega a 0 (observado 2 → 1 → `{}` com duas compras de 1 ouro). Vale **0**
  somente depois de um `round_type` e antes do fim da partida (`sourcesDetail.gold.inferred = true`); no reset do começo/fim é desconhecido.
  Inferência de uma única partida; confirmar ao vivo.

### Aprimoramentos e Wisps (formato observado na partida completa de 2026-10-11)

**Aprimoramentos** (decisão do usuário, uso pessoal e local; o Overwolf proíbe esses dados em apps **públicos**, e este helper não é
publicado):

- **Formato**: `augments.me` = oferta `{augment_1..3:{name}}`, um evento por reroll (muda uma carta), `""` nos três = tela fechada (vem
  logo antes da escolha). `augments.picked_augment` = lista CUMULATIVA `{slot_1..4:{name}}` dos escolhidos até agora, reenviada a cada
  escolha (`parseAugmentPickedList` lê todos os nomes: quem liga o leitor no meio da partida não perde os anteriores). Os escolhidos se
  acumulam em ordem, sem repetir, cada um com o estágio da coluna `round` do evento (sem ela, o `round_type` corrente) da primeira vez
  em que apareceu. Nomes com `ChampionItem` são ignorados. Auditoria de 2026-10-11 (7 partidas com escolha no `tft-events.db`): sempre
  `event_type` `me`, `feature` `augments`, chaves `me` (oferta) e `picked_augment`; nas rodadas 2-1, 3-2 e 4-2 (`round_type.type`
  `Augment_1..3`); cada reroll troca UMA carta (até 3 linhas extras por rodada); a oferta vazia e o `picked_augment` chegam no mesmo
  segundo; os 78 nomes vistos (`DA_*`, ex. `DA_PandorasItemsI`, `DA_18_CaretakersAlly`) existem todos no `augments.json`.
- **Troca (reroll)**: dentro da mesma rodada, a carta cujo nome mudou fica marcada `rerolled` até a oferta da rodada seguinte (cada carta
  troca uma vez; a interface não sugere trocar a que já foi trocada).
- **Mapeamento ao catálogo**: `augmentResolver` casa o nome com o id do `augments.json` (id exato; depois sem caminho/extensão; depois sem
  diferenciar caixa, se único). Fora do catálogo = **desconhecido** (contado em `unknown` e NOMEADO em `unresolved`, nunca inventado
  nem descartado em silêncio).
- **Campos**: `fields.augmentOffer` (ids do catálogo, `count`, `unknown`, `stage`, `cards: [{slot, id, text, rerolled}]`, `unresolved`) e
  `fields.augmentPicked` (`[{id, stage}]`, `count`, `unknown`, `unresolved`); `gepStatus.coverage = {augmentOffer, augmentPicked,
  augmentUnknown, augmentUnresolved, wisps}`.
- **Estado** (`mergeGep`): aprimoramentos vêm **só do GEP, sem OCR** (a oferta que o leitor de tela lê dos cards é descartada).
  `screen.augments` = ids da oferta aberta (`[]` = escolha fechada; null = sem fonte ou nenhum evento ainda), `screen.augmentOffer` =
  `{open, stage, cards, unresolved, ageMs}`, `screen.pickedAugments` = `[{id, stage}]` e `screen.augmentSource` = `{state: "ativo" |
  "aguardando" | "sem-fonte", source, reason, held, picked, unresolved}`. Os escolhidos são retidos na mesma partida quando o GEP fica
  obsoleto por um momento (`holdPickedAugments` em app/state.mjs, `held: true`) e zeram na partida nova. `gameState.me.augmentOffer` e
  `gameState.me.pickedAugments` têm origem `gep`.
- **No servidor** (`POST /api/recommend`): o registro manual do usuário (`augments` não vazio ou `augmentsKnown`, inclusive lista vazia)
  **prevalece**. Sem ele valem os escolhidos do GEP (`options.augments`), que alimentam `matches.augments`, `chosenAugments` (cada item
  ganha `source` `"gep"` | `"manual"` e `stage`) e `augment-advice`. A oferta (`seen.augments`) é descartada quando uma das cartas já é
  escolhida. Na interface (`v2/js/main.js`, `v2/js/augs.js` `augOfferView`) a trilha mostra os escolhidos lidos agora e a oferta aberta
  com a ordem da análise (só quando a análise é desta mesma oferta; senão "analisando"); não há botão de marcar: desmarcar só corrige
  uma leitura errada (o registro manual é semeado com os do GEP antes da edição). Sem GEP: "aprimoramentos: sem fonte". O overlay usa a
  mesma `augOfferView` no cartão "Aprimoramento" (elemento do carrossel), enquanto a escolha está aberta.

**Wisps** (fogos-fátuos):

- **Canal**: entram como entrada comum de `store.shop_pieces` (ex.: `slot_5: {"name": "DA_AbandonShip18"}`); não há evento separado.
- **Catálogo do helper**: `catalog.json` `items[]` com a etiqueta (hash) `{5b609ae2}` (351 itens, ex.: `DA_AbandonShip18`,
  `DA_BeggarsWisp18`, `DA_TigersVisit18_Wisp`, variantes `_Upgrade`/`_Prismatic`) e nomes pt-BR em `items.json` (kind `other`).
  `wispCatalog(catalog.items, itemCatalog)` monta o Map e o servidor o passa ao leitor; sem catálogo só se reconhece id com "Wisp".
- **Carta na loja**: `{text, id: null, wisp: true, wispId, wispName, wispKnown, source: "gep"}`. Com `id: null` o Wisp **nunca é
  campeão**: `analysisInputs` mapeia a loja para ids de campeão, `engine.mjs` (`shopIds`, `byId`) e `stage.mjs` descartam `id` nulo, e
  `roll.mjs` só lê `plan.stage.shop`, derivado do stage; portanto o Wisp não entra como alvo de rolagem nem de pool.
- **Estado**: `screen.wisps = [{slot, id, name, known}]` (slot de 1 a 5) com `screen.sources.wisps = "gep"`, somente quando a loja do
  GEP é a ativa; e `gameState.me.wisps`.
- **Limites**: a compra de Wisp não é modelada (o TFTAcademy também não): o espaço `Sold` vira vazio. O tier S/A/B/C/D do Wisp existe só
  no backend do TFTAcademy e não é usado aqui.

### Frescor e cadência

- A fonte só vale se: há partida mais recente no banco; o `match_id` (quando gravado) é o `gameId` da partida atual; `games.ended_at` é nulo;
  o set é o do catálogo; o cliente está em partida (`InProgress`/`Reconnect`; fase desconhecida não bloqueia); e o **último evento de
  qualquer tipo** da partida tem menos de `GEP_STALE_MS` = **60 s** (`TFT_GEP_STALE_MS` troca). Os eventos só saem quando o valor muda,
  então o limite é de silêncio do app inteiro, não de cada campo (`fields.<campo>.ageMs` diz a idade do último evento daquele campo).
- Cadência medida na partida completa de 2026-10-11 (27 min, 3455 eventos): maior silêncio entre eventos de QUALQUER tipo 36 s (carrossel),
  p99 5 s; entre os eventos que o leitor usa, 41 s. Por campo o silêncio chega a 95 s (ouro), 104 s (loja) e 107 s (XP): por isso o limite é
  do app inteiro e não de cada campo. 60 s dá 24 s de folga sobre o pior silêncio medido; mantido. Detalhes em `pesquisa/gep-validacao-partida.md`.
- Latência evento → banco: `created_at - timestamp` é 0 s em 99,9 % das linhas (máximo 1 s; a única exceção é a 1ª linha da partida, 22 s,
  que é o instantâneo do início). Contra o `TFT.log` do jogo (35 compras pareadas com a troca da loja para `Sold`) o `timestamp` do GEP
  fica entre 1,3 s antes e 0 s do instante da fala de compra (a diferença é o truncamento em segundos): sem atraso mensurável.
- Sem `match_id` gravado, a ligação é por recência (`binding: "recencia"`): vale a partida mais recente enquanto o frescor e o cliente em
  partida se mantêm. Uma partida anterior terminada há menos de 60 s pode ser aceita nesse caso.
- **Quem lê a fonte (M10b).** GEP e arquivos do jogo são lidos sob demanda por `stateHub.seen`. Antes só quando alguma tela chamava `/api/state` ou
  `POST /api/recommend`; agora o laço do servidor (`app/auto-refresh.mjs`) chama o estado a cada ~3 s durante a partida, com ou sem cliente conectado, e
  liga o leitor de tela junto; ao fim da partida (fase do cliente fora de `InProgress`/`Reconnect`) para de ler e desliga o leitor de tela.

### Estados da fonte (`gepStatus` em `/api/state`)

| `state`                | `reason`                                                                                                                                                                                              | Efeito                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ativo`                | -                                                                                                                                                                                                     | os valores do GEP valem (`available: true`)                      |
| `obsoleto`             | `sem-eventos-recentes`                                                                                                                                                                                | último evento mais velho que o limite; **volta à tela** sem erro |
| `ausente`              | `banco-ausente`, `sem-partida`, `fora-de-partida`, `outra-partida`, `partida-encerrada`, `set-diferente`, `banco-travado`, `banco-inacessivel`, `sqlite-indisponivel`, `erro-de-leitura`, `desligada` | idem                                                             |
| `ausente`              | `gravacao-desligada` (com `was` = `sem-partida`, `sem-eventos-recentes`, `outra-partida` ou `partida-encerrada`; só se `recordGames === false`)                                                       | idem; o HUD manda ligar "gravar partidas" no TFTAcademy          |
| `esquema-desconhecido` | `colunas-ausentes`, `tabela-ausente`, `arquivo-invalido`                                                                                                                                              | idem, com `detail` dizendo a coluna que falta                    |

Além disso: `source: "gep"`, `confidence: "observed"`, `gameId`, `binding`, `lastEventAt`, `lastEventAgeMs`, `staleMs`, `rows`, `identity`
(`confirmada` / `divergente` / `desconhecida`), `recordGames` (`true` | `false` | `null`) e, com a fonte ativa, `coverage`
(`{augmentOffer, augmentPicked, augmentUnknown, wisps}`, só contagens). Os valores ficam em `screen`, não em `gepStatus`.

### Precedência por campo

`GEP fresco e consistente > leitor de tela (OCR/ícones) > estimativa`. A decisão é de `core/state/precedence.mjs` (`reduceSources`, chamada por
`app/state.mjs` a cada leitura) e a troca de valores é feita por `mergeGep` depois do nível validado (`level.mjs` -> `core/state/level.mjs`):

| Campo                                        | Ordem                                               | `screen.sources.<campo>`            |
| -------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| ouro, nível, XP                              | GEP > tela                                          | `"gep"` / `"screen"` / `"derived"`  |
| banco de itens (`items`, `bank`, `removers`) | GEP (identidade confirmada) > tela                  | `"gep"` / `"screen"`                |
| loja                                         | GEP (loja visível) > tela                           | `"gep"` / `"screen"`                |
| estágio                                      | **arquivo do jogo (`__sentry-event`)** > GEP > tela | `"game-log"` / `"gep"` / `"screen"` |
| reserva                                      | GEP > nada (sem entrada manual)                     | `"gep"` / `null` (sem fonte)        |
| oferta de aprimoramentos (`augments`)        | só GEP (sem OCR; sem GEP = sem fonte)               | `"gep"` / ausente                   |
| aprimoramentos escolhidos (`pickedAugments`) | só GEP (o registro manual prevalece no servidor)    | `"gep"` / ausente                   |
| Wisps (`wisps`)                              | só GEP, com a loja do GEP ativa                     | `"gep"` / ausente                   |

`screen.sourcesDetail.<campo> = {source, ageMs, confidence}` (+ `inferred` no ouro vindo de `{}`). O leitor de tela **continua rodando**
durante a partida: é o reserva de cada campo acima, menos dos aprimoramentos (a leitura de cards por OCR que ele ainda faz não é usada).
Com o GEP ativo o nível do GEP é aceito sem a revalidação por OCR (`levelInfo.source = "gep"`).

**GEP e tela nunca discordam na saída** (M7): há UM valor por campo. Regras de `core/state/precedence.mjs`:

- **Consistente.** O GEP só vale para um campo se o valor for plausível. No nível: inteiro de 1 a 11, não menor que o maior nível já
  aceito do GEP na partida (o nível nunca cai), não abaixo do piso que o XP passivo garante no estágio, e o total do XP lido junto
  tem de ser de um nível que o inclui. Loja escondida (`shop_visible false`) e banco de itens sem identidade confirmada não valem.
- **Histerese (3 leituras).** Quando as duas fontes têm valor, a fonte ativa de um campo só troca para a preferida depois de 3
  leituras seguidas em que ela é a preferida. Se a fonte ativa perde o valor (GEP velho, tela fechada) a outra assume na hora: não se
  segura campo sem valor. O valor da fonte ativa continua atualizando a cada leitura; só a escolha da fonte é que tem memória. O XP acompanha o nível.
- **Divergência registrada.** Se o GEP e a tela têm valor e discordam por 3 leituras seguidas, conta-se **uma** divergência (por episódio;
  atraso passageiro da tela não conta), grava-se uma linha `AVISO "GEP e tela divergem em <campo>"` no log e o contador sobe. A tela passa a ser
  só a verificação cruzada. `/api/state` expõe `gameState.divergence = { total, byField, last, current, readings }` e, em `gameState`, o
  `GameState` normalizado (`clock` e `me`: ouro, nível, XP, loja, banco de itens, removedores, reserva; cada campo com `value`, `source`,
  `confidence`, `at`, `ageMs`, `stale`; listas viram `count`).
- **Servidor como fonte.** `POST /api/recommend` lê ouro, nível (e se é piso derivado ou estimado), XP, estágio, loja, banco de itens e
  oferta do estado do servidor (`core/state/inputs.mjs`); o corpo do cliente só leva decisões do usuário (comp fixada, trocas,
  aprimoramentos). `level`, `gold`, `inventory`, `levelEstimated` e `levelSource` do payload antigo continuam sendo aceitos e validados, mas só valem numa
  partida revista (`replayGameId`).

Interface (discreta): o tooltip do indicador "ao vivo" mostra o estado do GEP; os tooltips de nível e ouro dizem "do GEP (TFTAcademy)".

### Limitações

- Depende do Overwolf e do TFTAcademy **rodando durante a partida**, e do esquema privado do TFTAcademy (pode mudar com qualquer atualização).
- O GEP só emite valores que mudam: o nível 1 e o ouro inicial nunca aparecem; a fonte só prova que "está viva" pelo último evento de qualquer tipo.
- Em 2026-10-10 o banco **não tinha nenhuma partida recente** (única partida: 2026-09-11; `-shm`/`-wal` tocados em 2026-10-08, sem partida
  gravada) e o Overwolf/TFTAcademy não estavam em execução com o TFT aberto: o estado real hoje é `obsoleto` (≈695 h) e tudo cai na tela.
  Com `settings.record_games` desligada (ver "Gravação desligada") o app não grava nada, então o estado passa a `ausente` /
  `gravacao-desligada` até a configuração ser ligada no TFTAcademy (o helper não a altera).
- Não há reconstrução de eventos perdidos: se o app abre no meio da partida, os campos só aparecem quando mudam.

### Aviso de política

A Riot restringe aplicativos que fazem sugestões a partir do estado atual da partida, e o GEP exige aprovação da Riot para publicar um app
Overwolf. Este helper é **local e pessoal** e usa o GEP só pelo banco de um app já instalado, sem injeção, memória ou rede. O Overwolf
proíbe dados de **aprimoramentos** em apps **públicos**; por decisão do usuário (2026-10-10) o helper os lê **de forma pessoal e local,
sem publicar**, só os do jogador local. Dados de **rivais** (`item_bench` dos outros, `opponent_board_pieces`, `match_stats` de outros)
**continuam não lidos nem expostos**. O helper também nunca liga `record_games` nem altera qualquer configuração do TFTAcademy. Para desligar a fonte, aponte `TFT_GEP_DB` para um caminho inexistente ou remova o
TFTAcademy: ela vira `ausente` e o helper volta à tela.

## Leitor de tela próprio (independência do GEP)

Objetivo (decisão do usuário, 2026-10-11): o helper não pode depender do TFTAcademy/Overwolf para ouro, nível, XP, estágio, loja e banco de
itens. A tela (`screen-reader.ps1` + `screen-reader.mjs`) é a fonte própria e **assume sozinha quando o GEP some**: a precedência
`GEP > tela > estimativa` (`core/state/precedence.mjs`) já fazia isso e está coberta por `tests/screen-independence.test.mjs` (leitor real
com processo falso, montador de estado e modelo da interface: todos os campos saem com `sources.<campo> = "screen"`, e o chip da interface
mostra `GEP off · tela` com a lista dos campos lidos da tela, ou `GEP parado · tela`; sem leitura nenhuma o chip continua `GEP off` e a dica
diz "Nada lido da tela agora"). O GEP segue como **gabarito** para medir a tela enquanto existir. Só captura pixels da janela do TFT, como antes.

### Campos por confiabilidade (medido contra o GEP em partidas gravadas)

Corpus: as 2 partidas completas gravadas pelo TFTAcademy em 2026-10-10 (vídeo 1280x720 H.264 + eventos do GEP), um quadro a cada 6 s
(535 quadros; "antes" a cada 12 s), cada um lido a frio pelo `screen-reader.ps1` (`-TestManifest`). Só valem os campos que o GEP não mudou nos ±2,5 s em volta do
quadro; com a barra de baixo escondida (carrossel, escolha de aprimoramento) o certo é **não ler** ouro, nível, XP e loja, e ler algo ali conta como falso.
Recall = acertos / casos; precisão = acertos / (acertos + falsos); perda = não leu; falso = leu outro valor. "Antes" = o leitor
anterior (OCR dos dígitos, molde `FindFrame` e frações `$SLOT`) nos mesmos vídeos, um quadro a cada 12 s.

| Campo (método)                                     | Antes (recall)          | Agora: recall / precisão  | Casos | O que sobra (causas observadas)                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------- | ------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ouro** (glifos)                                  | 52%                     | **98,1% / 98,9%**         |   363 | perdas: número em transição; falsos: mudança de ouro entre o evento do GEP e o quadro                                                                                                              |
| **Nível** (glifos + total do XP, `reconcileLevel`) | 92%                     | **98,4% / 100%**          |   492 | painel dourado por cima da barra de baixo (não há HUD de nível ali)                                                                                                                                |
| **XP** (glifos, `atual/total`)                     | 71%                     | **97,8% / 99,6%**         |   462 | idem; o GEP e a tela divergem 1 rodada por alguns segundos no começo da rodada (+2 de XP passivo)                                                                                                  |
| **Estágio** (glifos, rótulo varrido no cabeçalho)  | 90% (o estágio 1 nunca) | **98,6% / 99,0%**         |   492 | os 5 "falsos" são o **GEP uma rodada atrás** da tela (`1-1` x `1-2` no começo, `3-5` x `3-6` depois): a tela está certa (o log já registrava `vale a tela`)                                        |
| **Loja** (nomes por OCR do Windows, só os 5 nomes) | 91%                     | **95,0% / 99,7%**         |  1864 | perdas: unidade arrastada para vender (o painel vira "Vender por N de ouro" e some), cartas ocultas por painel; nome curto some do OCR em um tamanho (agora tenta mais 3 aumentos: 93,1% -> 95,0%) |
| **Banco de itens** (ícones; sem consumíveis)       | 73%                     | **97,2% / 99,4%**         |   720 | item **na mão** (o espaço fica vazio enquanto o jogador o arrasta, e o GEP ainda o conta); ícones de emblema/item pronto fora do catálogo; 434 de 448 quadros com o banco exato                    |
| **Quantidade do removedor** (selo, glifos)         | 1% (lia sempre 1)       | **96,9%** (exata)         |   448 | com a tela escurecida por um painel o selo fica pequeno demais e a quantidade cai para 1                                                                                                           |
| **Reserva (bench)**                                | sem fonte               | **sem leitura (decisão)** |     - | ver abaixo                                                                                                                                                                                         |

**Antes → agora, por quê.** Os números "antes" vinham de três falhas medidas nos mesmos quadros: (1) o OCR do Windows lia mal os dígitos
pequenos do HUD (ouro `494949` -> 49 só em metade dos quadros, o `1` fino do XP como `I`, o rótulo do estágio do estágio 1 em outro lugar do
cabeçalho que a região fixa nunca olhava); (2) o HUD **não escala linearmente** com a altura da janela: o passo entre os espaços do banco é
**36 px em 720p** (as frações `$SLOT` davam 35,1: 0,9 px a mais por espaço, **8 px no 10º**) e **56 px em 1149p**, então o molde de moldura
(medido em 1149p) nunca era achado em janela pequena e a geometria "assumida" **exigia a evidência dos itens raros** (distância ≤ 0,45), recusando a Lágrima da
Deusa a 0,50 (com segundo colocado a 1,47); (3) o ícone de um item repetido (dois Coletes) também caía fora do limite pelo mesmo motivo. Foi
isso que a divergência registrada no M7 mostrava (`gep=[Tear, Tear, Gloves] tela=[]`, e o ouro `gep=1 tela=33`: o ouro da tela ficava velho).

### Como o leitor lê agora

- **Dígitos por glifo** (`Glyph` no `.ps1`; gabaritos em `screen-glyphs.json`): binariza o recorte pelo Otsu, separa os glifos por componentes
  conectados (descarta o que a borda esquerda/direita do recorte corta), normaliza cada glifo pela **altura da linha** (grade 12x16, sem esticar
  a largura, vizinho mascarado) e compara por distância RMS com os gabaritos do campo (`gold`, `level`, `xp`, `stage`, `badge`). Aceita se a
  distância ≤ 0,25 (selo ≤ 0,20) e a folga para o melhor de **outro** caractere ≥ 0,03 (ou 1º a ≤ 70% do 2º); senão `?`. Tenta 6 limiares (múltiplos do
  Otsu: os baixos fecham o anel do 0 que o traço fino abre, os altos separam o `/2` colado do XP e soltam o texto de um fundo claro) e **exige 2 limiares
  concordando** em ouro e nível (um traço do cenário imita um `1` solto quando a barra de baixo some: 3 quadros). Texto gramatical por campo
  (`\d{1,3}`, nível 1 a 11, `\d{1,2}/\d{1,3}`, `[1-9]-[1-7]`). O estágio é varrido em janelas do tamanho do rótulo sobre a faixa do topo (o rótulo muda de lugar:
  0,401 da largura em 720p com o cabeçalho expandido e 0,384 na captura nativa com ele recolhido, e o painel do estágio 1 é mais estreito). Sem
  `screen-glyphs.json` (ou numa instalação sem ele) volta ao OCR do Windows, bem menos preciso.
- **Gabaritos** (`scripts/screen-glyphs.mjs`): montados dos próprios vídeos, com o GEP dizendo o que estava escrito, em 3 tamanhos (1x, 1,5x e 2x do
  vídeo), até 5 centros por caractere (k-médias). Descarta rótulos que um gabarito treinado nas outras partidas contradiz (o GEP e a tela divergem) e só se
  o caractere do rótulo é conhecido por elas. Cobertura: ouro 0 a 9; XP 0 a 6, 8 e `/` (**7 e 9 nunca apareceram**: o XP sobe de 2 em 2 e de 4 em 4; sem gabarito o dígito
  vira `?`); estágio 1 a 7; nível 2 a 8 (9 a 11 saem pelo total do XP); selo 2 a 5. **Fora da amostra** (treino sem uma partida, teste na outra, todos os tamanhos): nível 100%,
  XP 100% e 99,9%, estágio 99,9%, ouro 85% (perdas: dígitos que só uma das duas partidas teve) com 0 a 1 falso; **selo do removedor 43 a 55% com até 114 falsos**
  (poucos dígitos vistos): por isso o selo é mais restrito e, com um dígito que ele não conhece, a quantidade cai para 1.
- **Grade do banco medida na imagem** (`Locate-Column`, `Bank.Lattice`, `Bank.Column`): o topo de cada espaço é uma subida de brilho ao longo da largura do
  espaço e a borda de baixo outra; acha-se o (primeiro topo, passo) que encaixa nas 10 subidas (topo e borda de baixo juntos, para não encaixar só nas bordas de baixo),
  depois o par de bordas verticais separado por ~0,78 do passo. Confirmada com ≥ 3 espaços, bordas nítidas e a esquerda a ≥ 0,12 passo da borda da janela. Cada espaço vira um quadrado
  32x32 do miolo (frações 0,09 / 0,14 / 0,90 / 0,84 do espaço, calibradas em 104 combinações contra os itens do GEP: distância média do item certo 0,085) e passa pela comparação de
  ícones de sempre (`Classify-Slot`, limites inalterados). O diagnóstico ao vivo (`screen.bankGeometry`) agora traz `pitch`, `hits` e `edge`.
- **Itens**: a Lágrima da Deusa lida a 0,12 a 0,31 (era recusada a 0,50), item repetido reconhecido nos dois espaços. O Duplicador de Campeão (3 tamanhos, ícone idêntico) vale como
  `DA_Consumable_LesserChampionDuplicator` (consumível: não entra na análise). **Não reconhecidos hoje**: ícones de emblema e de item pronto que não casam com o do catálogo (Flora Fatalis,
  Vanguard, Quicksilver, Edge of Night, Guinsoo: 20 itens perdidos em 720 casos), que seguem `?` sem virar outro item.
- **Quantidade do removedor**: recorta o retângulo amarelo do selo (`Bank.YellowBox`) e lê o número escuro por glifo (texto invertido); sem amarelo vivo (tela escurecida) cai para o recorte do canto e, se nada, 1.
- **Loja**: continua o OCR do Windows nos 5 nomes (nome -> campeão por distância de edição, `championResolver`); quando há texto na carta e o OCR volta vazio, tenta mais 3 aumentos.

### Reserva (bench): sem leitura por ícone

Os campeões da reserva são **modelos 3D parados nos espaços do tabuleiro, sem retrato nem ícone** (só uma barra de vida com marcas de estrela). Não há template de ícone que os identifique
(os retratos de `assets/` são outra imagem) e uma biblioteca de aparência 3D por campeão exigiria capturas de todos os campeões em todas as poses. O que a tela dá: a barra de vida de cada unidade, **só no planejamento** (no combate
as barras somem). Medido nas partidas gravadas (célula `bench_pieces.cell_N` do GEP = posição do espaço, 9 espaços): as barras apareceram em 43 de 120 quadros; nesses, acusam 165 das 185 células ocupadas (89%) **sem nenhum falso positivo** (36 dos 43 quadros exatos), mas no conjunto
só 165 das 496 células ocupadas (33%), e **nenhuma identidade**. Por isso o campo **não foi implementado**: sem o GEP a reserva continua desconhecida (`sources.bench = null`, nunca
uma lista vazia inventada), como já descrito em "Reserva (bench) e livro-razão de eventos". O caminho possível é combinar ocupação (barras) com o teto do livro-razão, só como **estimativa** e nunca no lugar do dado observado.

### Divergências GEP x tela vistas nas partidas (não são erro da tela)

O GEP não é perfeito como gabarito, e a medição deixa de fora ou sinaliza: **estágio** do GEP uma rodada atrás (minutos, nas duas direções; o log de divergência do M7 já mostrava `gep="1-1" tela="1-2"`); **XP** do GEP
sem o +2 passivo no começo da rodada; **item na mão** (o GEP o conta, o espaço da tela fica vazio); **loja** com "Vender por N de ouro" no lugar das cartas ao arrastar uma unidade;
**painel por cima** (moldura dourada no lugar da barra de nível/XP) com `shop_visible` ainda verdadeiro; e **a gravação do TFTAcademy pode ir além do último evento** do GEP (uma terceira partida, `b7f42f17`, tem 36 min de vídeo para 7 min de eventos e o
arquivo não tem o átomo `moov`): fica de fora, e `truthAt` não dá verdade 30 s depois do último evento.

### Como medir e refazer (Windows, ffmpeg no PATH; nada disso roda no servidor)

- `node scripts/screen-accuracy.mjs [--game ID ...] [--every 6] [--scale 2]`: relatório por campo (acertos, perdas, falsos, recall, precisão, quadros de itens exatos) e as primeiras divergências, das partidas do banco do TFTAcademy
  (vídeo + eventos, **somente leitura**; o deslocamento vídeo -> relógio do GEP é descoberto pelas mudanças bruscas da faixa da loja contra os `shop_visible`: 13,5 s e 15,75 s nas duas partidas). `--fixtures` mede os recortes guardados em `tests/fixtures/screen/`.
  `--scale 1.5|2` lê os mesmos quadros reescalados (o vídeo é 720p; a tela nativa é maior).
- `node scripts/screen-glyphs.mjs [--game ID ...] [--scales 1,1.5,2]`: remonta `screen-glyphs.json` (e imprime o acerto fora da amostra). Mais partidas gravadas cobrem os dígitos que faltam (7 e 9 do XP, o selo).
- `node scripts/screen-fixtures.mjs`: regera `tests/fixtures/screen/` (24 telas 1280x720 pretas com só os recortes do HUD que o leitor usa, 2,2 MB, e a verdade esperada em `index.json`; nada do desktop).
- Testes: `tests/screen-accuracy.test.mjs` (verdade, placar, relatório), `tests/screen-glyphs.test.mjs` (cobertura dos gabaritos, treino, limpeza), `tests/screen-fixtures.test.mjs` (o leitor inteiro sobre os recortes reais, com
  pisos), `tests/screen-independence.test.mjs` (sem GEP a tela assume e o chip avisa) e `tests/item-bank.test.mjs` (coluna real, 4 layouts de janela, sem moldura de coluna).

### Limites e o que não foi verificado

- **Ao vivo, nada**: tudo foi medido sobre vídeos 720p H.264 de 2 partidas, mais **1 captura nativa** (2044x1149, tela de aprimoramento escurecida: o estágio `3-2` com o cabeçalho recolhido e os 3 itens do banco, incluindo o Duplicador, saíram certos)
  e os mesmos quadros reescalados para 1,5x e 2x (2x: ouro 99,4%, nível 98,8%, XP 98,6%, estágio 99,6%, loja 94,3%, itens 96,9%, removedores 95 a 99%; os gabaritos incluem esses tamanhos, então isso mostra a independência de escala e **não** é medida
  de captura nativa). A janela real do usuário (2560x1351, HUD centralizado ou não) e uma partida inteira ao vivo seguem **por confirmar** (`bankGeometry.mode` deve sair `frame`).
- Os gabaritos de glifo foram montados nas mesmas partidas medidas: ouro, nível, XP, estágio e selo estão **em amostra**; itens e loja (ícones do catálogo e OCR) não treinam com elas, exceto os 4 números do miolo do espaço.
- Nível 9 a 11 e dígitos 7 e 9 do XP nunca foram vistos ao vivo; selo do removedor só viu 2 a 5.
- Não medido: carrossel com a tela cheia, reconexão, tela cheia exclusiva, outro tamanho de HUD nas opções do jogo, outro idioma (os nomes da loja usam o OCR do idioma do Windows).

## Overlay (janela sobre o jogo, sem fonte nova de dados)

O overlay (`overlay/`, Electron oficial isolado nesse pacote) não lê nenhuma fonte do jogo: ele é uma **apresentação** do que o servidor já calculou.

- **Canal**: `GET /api/overlay[?since=<rev>]`, somente leitura. Devolve, de um cache em memória (`app/overlay-feed.mjs`), o último corpo de
  `GET /api/state` e o último de `POST /api/recommend` ao vivo (partida revista não entra), cada um com `at`/`ageMs`; `rev` muda quando um dos dois
  muda e, com `since == rev`, a resposta é curta (`unchanged: true`). Não calcula, não lê disco e não chama `current()`, o leitor de tela, o
  rastreador de sequências nem o plano persistente.
- **Por que não faz a própria análise**: `POST /api/recommend` custa ~1 s de CPU e grava o plano em andamento (`plan-state`); o overlay dobraria a
  análise e alteraria esse estado. Consequência: a recomendação só se renova enquanto a interface web está aberta e **visível** (o navegador pausa
  abas ocultas). Sem ela, o HUD mostra o estado e "aguardando análise".
- **Origem dos números no HUD**: a mesma da interface (`v2/js/model.js`): ouro/nível/XP com a fonte GEP ou tela, `gepStatus` no chip, vida do snapshot
  do jogo. O overlay não reconcilia nem escolhe fontes.
- **Sem dado de rivais além do que a interface já mostra**; nenhum aprimoramento é derivado no overlay (o cartão de aprimoramentos usa a
  oferta do estado e a ordem da última análise, pela mesma `augOfferView` da interface).
- **Duas leituras locais somente-leitura, só para posicionar a janela**: (1) a área cliente da janela do TFT (`UnrealWindow`, título "TFT…") por um
  PowerShell persistente (`EnumWindows`, `GetClientRect`, `ClientToScreen`), sem tocar no processo do jogo; (2) o `FullscreenMode` de
  `%LOCALAPPDATA%\TFT\Saved\Config\WindowsClient\GameUserSettings.ini` para avisar de tela cheia exclusiva. Nenhuma das duas alimenta o motor nem o estado da partida.
- **Exibição**: janela transparente de outro processo (sem injeção, hook, memória, captura de tela ou automação de entrada); só aparece sobre o
  TFT em janela ou janela sem borda. Detalhes, atalhos e limites em `overlay/README.md`; opções e política em `pesquisa/overlay-opcoes.md`.

## Compra na loja e itens por campeão (sem fonte nova)

Duas regras de apresentação sobre dados que o servidor já entrega; nenhuma lê o jogo.

- **Compra de peça que você já tem** (`core/pool/buy-copies.mjs`, usada por `v2/js/model.js`; interface e overlay leem o mesmo resultado). Entrada: `plan.board`
  (`owned`, `stars`), `rec.pool` (`own` = cópias de 1★, `chancePerShop`, `remainingUpper`/`free`), ouro e a loja de agora (`screen.shop`, GEP ou tela).
  Regra: peça do plano em campo ou na reserva, abaixo de 3★ e com cópias suficientes na pool para o próximo marco vira linha "Comprar" (`how: "copy"`) **somente
  enquanto a loja a mostra**; texto "cópia · fecha o 2★/3★" (uma cópia fecha) ou "cópia · sobe para N★ (faltam K)". Prioridade: fecha estrela, depois o carry, depois
  a chance de aparecer. `stage.buyNow` (peças que faltam) não mudou, nem o ranking das comps. Loja não lida: nenhuma linha de cópia e nenhum aviso.
- **Itens por campeão** (`core/items/champion-items.mjs`, sobre `buildStates` da Formação). Entrada: `plan.itemPlans[*].ideal` (até 3), `equipped`, os donos dos itens
  (`owners`) e o banco lido (`screen.items`). Cada item: `on` (equipado), `ready` (no banco ou monta agora), `move` (mover de outra peça), `taken`, `half`/`need`
  (falta N). Passo "Itens dos campeões" do modelo (campeões em campo, com slot livre e item pendente, carry primeiro); sem banco lido o passo não aparece.

## Estado exposto pelo servidor

- `GET /api/state`: `screen.stage`, `screen.phase`, `screen.phaseKind` (do arquivo do jogo, com reserva na tela) e
  `screen.sources = { stage, phase, gold, level, xp, items, shop, bench }` (mais `augments`, `pickedAugments` e `wisps` quando vêm do GEP)
  com a origem de cada campo (`"game-log"`, `"gep"`, `"screen"`, `"derived"`, `"manual"` ou `null` se não lido) e `screen.sourcesDetail` com
  `{source, ageMs, confidence}` dos campos do GEP. `screen.pickedAugments` (`[{id, stage}]`) e `screen.wisps` (`[{slot, id, name, known}]`) só existem
  com GEP ativo. `gepStatus` (topo da resposta) é o estado da fonte GEP, com `recordGames` e `coverage` (ver "GEP / TFTAcademy"). `gameFiles` traz o estado bruto da leitura (`available`, `source`, `gameId`,
  `sameGame`, `stale`, `phase`, `stage`, `writtenAt`, `error` e `hints` marcadas `reliability: "estimated"`).
- `GET /api/state` também traz `carousel` (aberto agora, peças lidas do GEP e o que pegar; ver "Carrossel") e, só com GEP ativo, `screen.gepRound` (`round_type`) e `screen.carouselOffer`.
- `GET /api/state` também traz `unitLedger` (livro-razão de compras/fusões, ver "Reserva (bench) e livro-razão de eventos"): informativo,
  não alimenta a análise.
- `POST /api/recommend`: usa a mesma rodada mesclada (`options.stage`). Os aprimoramentos escolhidos vêm do registro manual do usuário
  (prevalece) ou, sem ele, do GEP; `analysis.chosenAugments[].source` diz qual (ver "Aprimoramentos e Wisps").

## Pendente de partida ao vivo

- **Carrossel**: o bloco `carousel` do `/api/state` e o cartão do overlay durante um carrossel real (detecção pela fase `Draft`, oferta do GEP, ordem das peças, o cartão sobre o jogo); ver "Carrossel" em "Dado a dado".
- **GEP**: a partida completa de 2026-10-11 (27 min, 3455 eventos) foi gravada pelo TFTAcademy e **reproduzida offline** contra o leitor
  (`pesquisa/gep-validacao-partida.md`: ouro, nível/XP, loja, reserva, banco de itens, aprimoramentos e Wisps conferem; `{}` = 0 visto 4
  vezes; linha local de `item_bench` única em 435 de 435 eventos; maior silêncio 36 s). O que ainda **só se confirma com o servidor ligado
  durante uma partida**: `gepStatus.state` virar `ativo` no 1-1 (e a ligação por `match_id` com o `gameId` do LCU), a precedência por campo
  contra a tela ao vivo, e o que o app grava ao abrir no meio da partida. Sem amostra: nível 1 e ouro inicial (o GEP só emite quando muda: nos
  primeiros ~45 s não há ouro, nível nem XP), nível máximo (`xp_max`), e a loja `shop_visible` em reconexão.
- **GEP, gravação**: ligar `record_games` no TFTAcademy e jogar com Overwolf + TFTAcademy abertos (sem isso o estado é `ausente` /
  `gravacao-desligada`). Formato de `augments.me` e `augments.picked_augment` já confirmado (oferta por reroll; escolhidos cumulativos) e
  os 15 nomes da partida casam com `augments.json`; `gepStatus.coverage.augmentUnknown` acusa o que não casar. Wisps: 28 de 29 cartas de
  `shop_pieces` fora do campeão casam com a etiqueta `{5b609ae2}` (a que sobra, `DA_18_MinorBloodRitual`, não está no catálogo).

- **Leitor de tela próprio** (ver "Leitor de tela próprio"): só foi medido em vídeos 720p de 2 partidas, 1 captura nativa e quadros reescalados. Falta ao vivo, na janela real do usuário (2560x1351):
  `screen.bankGeometry.mode` sair `frame` (com `pitch` perto de 0,049 a 0,050 da altura da janela), ouro/nível/XP/estágio lidos sem `?` (`/api/state` -> `screen.sources`), o chip `GEP off · tela` com o TFTAcademy fechado, o estágio 1
  (rótulo em outro lugar) e o cabeçalho recolhido, e o selo do removedor com mais de 5.
- Livro-razão ao vivo: a execução só é ligada à partida depois que o `__sentry-event` é regravado após o `BeginGame`; na validação foi
  testado com arquivos temporários e os logs de partidas passadas, não com uma partida em andamento. Confirmar que `unitLedger.available`
  vira `true` na primeira rodada e que `purchases.count` acompanha as compras feitas.
- Reconexão (`TFT.log` novo na mesma partida) com o servidor ligado: o caminho (duas execuções ligadas ao mesmo `game.id`) está
  testado com os trechos reais, mas só se confirma derrubando/reabrindo o jogo.
- Atraso real entre a mudança de fase no jogo e a regravação do `__sentry-event` (medido só que a leitura de 0,5 s a detecta;
  não há relógio externo do jogo).
- Comportamento do `.sentry-native` após fechar o jogo, queda ou várias partidas seguidas no mesmo processo
  (`game.tft.sequentialGames` > 1): a conferência por `game.id` cobre o caso, mas não foi exercitada com a segunda partida.
- Fases de planejamento fora de `Planning` (nomes exatos de `PlanningArrival/Departure`), observadas só em parte.
- Estágios 1-1 a 1-4 (PvE) e rodadas de aprimoramento: o formato `S-R` foi visto de 2-2 a 2-7; assume-se o mesmo nos demais.

## GEP próprio (ponte ow-electron do helper, `overwolf-bridge/`)

Pedido do usuário: rodar só com a dependência do Overwolf, sem o TFTAcademy. Análise estática (somente leitura de arquivos, com o
jogo e o TFTAcademy abertos) de `resources\app.asar` do TFTAcademy 0.9.22 (Electron 42.7.1), extraindo para uma pasta temporária só
`dist/main.cjs`, `dist/preload.cjs`, `package.json`, `_metadata.json` e `drizzle/*.sql`; a análise do REA
(`analyze-javascript-application`, CLI, modo diretório) deu o inventário (1 BrowserWindow, 121 membros expostos pelo preload, 208
operações IPC todas de canal dinâmico, sem addon nativo próprio) e as chamadas ao Overwolf foram lidas direto no `main.cjs`.
Números de linha abaixo são do `dist/main.cjs` dentro do asar. **Nada do código do TFTAcademy foi copiado**: só o fluxo e os nomes de API.

### O que o TFTAcademy faz com o Overwolf (comprovado por leitura estática)

- É um app **ow-electron**: `package.json` declara `overwolf.uid` (mesmo valor de `APP_UID`, `main.cjs:204`), `overwolf.packages =
  ["gep","recorder","overlay"]` e `timestamp`; `_metadata.json` traz hashes de `main.cjs` e `package.json` e uma assinatura JWT cujo
  emissor é `overwolf.com` (integridade assinada pelo Overwolf, é isso que libera os pacotes em build distribuído).
- GEP (`main.cjs:5213-5330`, classe `GameEventsService`): espera `app.overwolf.packages.on("ready", (e, nome, versão))` com `nome ===
  "gep"`; então `gepApi = app.overwolf.packages.gep`, `gepApi.on("game-detected", (e, gameId, nome, gameInfo))` e **`e.enable()`**
  (linha 5276; sem isso o GEP não entrega o jogo); depois `gepApi.setRequiredFeatures(gameId, features)` (5237). Eventos:
  `new-info-update` e `new-game-event` (`(e, gameId, ...args)`; `args[0]` = `{feature, category, key, value}`), `game-exit`,
  `elevated-privileges-required`, `error`; também `getInfo`, `getSupportedGames` e `getFeatures`.
- IDs de jogo (`main.cjs:175-179`): `21570` (TFT), `28164` (TFT UE5, processo `TFTClient-Win64-Shipping.exe`) e `28162` (PBE); o id
  reportado pode vir com sufixo (`matchesGameId`: `reportado === id || floor(reportado/10) === id`, linha 182).
- Features pedidas (`TFT_FEATURES`, `main.cjs:561`): `gep_internal`, `live_client_data`, `me`, `match_info`, `match_stats`, `roster`,
  `store`, `board`, `bench`, `carousel`, `augments`. Chaves tratadas (`TFTEventKeys`, ~linha 243): `round_start/end`, `round_outcome`,
  `battle_state/start/end`, `match_state/start/end`, `local_player_damage`, `summoner_name`, `round_type`, `rank`, `game_data`,
  `active_player`, `all_players`, `me`, `picked_augment`, `carousel_pieces`, `shop_pieces`, `shop_visible`, `item_select`,
  `picked_item`, `bench_pieces`, `board_pieces`, `gold`, `player_rank`, `board_spectate`, `opponent`, `xp`. Observação: ele pede e
  grava dados de rivais (`board_spectate`, `opponent`, `all_players`); a ponte própria não.
- Gravação (`main.cjs:802-900`, `TFTEventDatabase`): `better-sqlite3` + Drizzle, `journal_mode = WAL`, migrações em
  `app.asar.unpacked/drizzle` (migrações 0000 a 0013; tabelas `games`, `events`, `settings`, `riot_accounts`, `custom_comps`, `user_notes`,
  `overlay_placements`). `insertEvent` grava `game_id, timestamp, event_type, feature, category, round, key, data(JSON)`.
  `match_id` = `<PlatformID>_<GameId>` tirado da **linha de comando do processo do jogo** (`-GameId=`, `-PlatformID=`) em `startGame`
  (823); a partida só nasce com `match_start`/`match_state` em andamento/`round_type` de abertura. `record_games` (`SettingsKeys`,
  linha 4212; padrão `true`) desligada: não grava e apaga a partida no fim (`deleteGame`, 6978).
- Gravação de vídeo: pacote `recorder` (`owElectronPackages.recorder`, `registerGames({gamesIds, all:false})` na 5937,
  `ffmpegPath` do próprio pacote), `.mp4` em `tft-recordings`; `autoShutdownOnGameExit: true`. Não é necessário para o helper.
- Overlay: pacote `overlay` (`createWindow`, `getActiveGameInfo`, `hotkeys.register`). O helper já tem overlay próprio (Electron comum).
- Também usa o LCU (`queryLcu`, `/lol-gameflow/v1/session`) e o atualizador `electron-updater` apontando para
  `electron-updates.overwolf.com/.../<APP_UID>` (1345): o canal de atualização é do Overwolf.

### O que um app próprio exige (documentação pública do Overwolf, ow-electron)

- Conta em dev.overwolf.com e **ideia do app aprovada pela DevRel** (status _Approved_); os pacotes `@overwolf/ow-electron`,
  `@overwolf/ow-electron-builder` e os pacotes de jogo (GEP) só são liberados a contas aprovadas ("whitelisted"). Passo do usuário.
- **App UID** gerado de `productName` + `author.name` do `package.json` (disponível em `process.env.OVERWOLF_APP_UID` após
  `app.whenReady()`); `overwolf.packages: ["gep"]`. Nome sem "bot".
- **Modo de desenvolvimento** (Windows, `ow-electron` >= 39.8.10, `ow-electron-builder` >= 26.9.0): roda GEP em build não assinado e não
  empacotado, exige credencial de dev: `OW_DEV_KEY` (perfil aprovado, sem Console) ou `OW_CLI_EMAIL` + `OW_CLI_API_KEY` (Console, só após a QA).
  Sem credencial o app abre mas os pacotes de jogo não carregam.
- **Produção**: assinatura de código própria + integridade assinada pelo Overwolf (App UID do Console, `OW_BUILD_KEY`); QA da DevRel antes do lançamento.
- **Política de dados** (página de TFT do GEP): a Riot proíbe dados de aprimoramentos em apps de terceiros; `roster`, `opponent`,
  `board`/`opponent_board_pieces`, `item_bench`, `match_stats` e `battle_stats` trazem dados de outros jogadores. A ponte não pede
  `augments`, `board`, `match_stats` nem `live_client_data`, e descarta tudo que não é do jogador local antes de gravar.

### O que foi construído e como o helper o usa

- `overwolf-bridge/` (projeto separado, ver o `README.md` dele): janela visível, bandeja, `GepService` (fluxo acima), filtro por lista de
  permissão (`src/sanitize.cjs`), gravador SQLite com **o mesmo esquema** que o `gep-reader.mjs` lê (`src/recorder.cjs`) e status em
  `127.0.0.1:18795`. Banco: `%APPDATA%\TFT Helper Bridge\tft-events.db` (`TFT_BRIDGE_DB` troca).
- `gep-reader.mjs`: sem `file`/`TFT_GEP_DB`, `gepReader` consulta **ponte própria > TFTAcademy** (a segunda só é lida se a primeira não
  está `ativo`); o resultado traz `origin` (`"proprio"` | `"tftacademy"`) e `origins`. `gepStatus.origin` chega a `/api/state`
  (via `gepSummary`); **o chip da interface ainda não o mostra** (arquivos de `v2/` e `server.mjs` pertencem a outros agentes).
  Precedência completa por campo: GEP fresco (própria, depois TFTAcademy) > leitor de tela > estimativa.
- Testes: `node --test overwolf-bridge/test/bridge.test.mjs` (filtro, ponta a ponta até o `gep-reader`, precedência, `GepService` com
  dublê do Overwolf) e `node --test tests/gep-reader.test.mjs` (sem regressão).

### O que está e o que não está comprovado

- Comprovado: nomes de API, ids de jogo, features, tratamento de eventos e esquema do TFTAcademy (leitura estática); filtro,
  gravação e leitura pelo helper (testes com mensagens no formato documentado).
- **Não comprovado**: o pacote `gep` do ow-electron rodando com este app (falta conta aprovada/`OW_DEV_KEY`); o formato real dos
  argumentos dos eventos e de `gameInfo.commandLine` no `game-detected` na ponte; a janela e a bandeja no Electron (nunca iniciados);
  o aceite do Overwolf (aprovação, QA, assinatura). Dependem do usuário: aprovação da ideia, chave de dev, nome/identidade final,
  política de privacidade, ícone definitivo.

## Reprodução

- Testes: `node --test tests/game-log.test.mjs tests/unit-ledger.test.mjs` (trechos reais do `__sentry-event` e do `TFT.log`;
  `tests/fixtures/` guarda as linhas de compra/estrela das partidas 3291596434 e 3291600904 e o tabuleiro final/retratos do jogador).
- Sondar ao vivo: `node -e "import('./game-log.mjs').then(m=>console.log(m.gameLog().status()))"` em `tft/helper`.
- GEP: `node --test tests/gep-reader.test.mjs` (banco SQLite temporário no esquema do TFTAcademy, preenchido com a fixture real sem dados
  pessoais). Sondar o banco de verdade, sem escrever nada: `node -e "import('./gep-reader.mjs').then(m=>console.log(JSON.stringify(m.gepReader({}).status({inMatch:true}),null,1)))"`.
