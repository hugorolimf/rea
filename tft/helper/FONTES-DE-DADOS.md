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

| Dado                                                                         | Fonte                                                                                                                      | Método                                                                                                                                                  | Confiabilidade                                                                                       | Atraso                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Id da partida, fila, set                                                     | `.sentry-native/<execução>.run/__sentry-event` (tags `game.id`, `game.queue`, `set_name`) e LCU `/lol-gameflow/v1/session` | arquivo / HTTPS local                                                                                                                                   | observado                                                                                            | ≤ 0,5 s (intervalo de leitura)                                         |
| **Estágio-rodada** (`2-4`)                                                   | `__sentry-event`, tag `game.tft.round`                                                                                     | `game-log.mjs` → `parseSentryEvent`                                                                                                                     | **observado**                                                                                        | ≤ 0,5 s (observado: mudanças detectadas na leitura seguinte)           |
| **Fase da rodada** (Planning, Combat, Draft = carrossel...)                  | `__sentry-event`, tag `game.tft.phase`                                                                                     | idem                                                                                                                                                    | **observado**                                                                                        | idem                                                                   |
| Fase do cliente (InProgress etc.)                                            | LCU `/lol-gameflow/v1/gameflow-phase`                                                                                      | HTTPS local (`server.mjs`, `readLcu`)                                                                                                                   | observado                                                                                            | até 5 s (cache)                                                        |
| Comp, itens equipados, tabuleiro de todos os jogadores                       | `Saved/Logs/TFTEoGStats.json` (`statsBlock.players[].boardPieces`)                                                         | leitura do arquivo (`capture.mjs`, a cada 0,5 s)                                                                                                        | observado, **só peças em campo**                                                                     | regravado pelo jogo durante a partida                                  |
| Vida, colocação, aprimoramentos de cada jogador                              | `TFTEoGStats.json` (`health`, `ffaStanding`, `augments`)                                                                   | idem                                                                                                                                                    | observado                                                                                            | idem                                                                   |
| **Ouro**                                                                     | GEP `me.gold` (banco do TFTAcademy) quando fresco; senão **sem fonte permitida em arquivo**                                | `gep-reader.mjs`; reserva: leitor de tela (`screen-reader.ps1`, OCR)                                                                                    | GEP: observado (0 é inferido de `{}`); tela: lido da tela                                            | GEP ≤ 1 s de resolução; tela ~2,5 s (`IntervalMs`)                     |
| **Nível**                                                                    | GEP `me.xp.level` quando fresco; senão **sem fonte permitida em arquivo**                                                  | GEP; reserva: leitor de tela; se o OCR falha, derivado do total de XP (`4/10`); validado e, sem leitura, piso por XP passivo (`level.mjs`, ver "Nível") | GEP: observado; tela: lido da tela / derivado (piso)                                                 | idem                                                                   |
| **XP**                                                                       | GEP `me.xp` (`atual/total`) quando fresco; senão **sem fonte permitida em arquivo**                                        | GEP; reserva: leitor de tela                                                                                                                            | GEP: observado; tela: lido da tela                                                                   | idem                                                                   |
| **Reserva (bench)** do jogador                                               | GEP `bench.bench_pieces` quando fresco; **não reconstruível pelo log** (ver "Livro-razão de eventos")                      | `gep-reader.mjs` → `options.bench` (origem `gep`); sem GEP, vazia (a entrada manual saiu); o livro-razão dá só um teto (`unitLedger.bench.upperBound`)  | GEP: observado; teto: **estimado**                                                                   | GEP ≤ 1 s                                                              |
| **Compras e fusões** do jogador (cada uma com o id da entidade)              | `Saved/Logs/TFT.log`, voz `Audio.Event.VO.Unit.Purchase` / `StarUp.2Star                                                   | 3Star`                                                                                                                                                  | `game-log.mjs` → `parseLogLine`; `unit-ledger.mjs`                                                   | **observado** (completo para compras da loja; faltam carrossel/prêmio) | 1 a 4 s (flush do log) |
| Vendas, movimento tabuleiro<->reserva                                        | **não gravados** (só as tentativas recusadas de arrastar)                                                                  | n/a                                                                                                                                                     | sem fonte                                                                                            | n/a                                                                    |
| **Banco de itens** do jogador                                                | GEP `bench.item_bench` (só a linha do jogador local) quando fresco; senão **sem fonte permitida em arquivo**               | GEP; reserva: leitor de tela (comparação de ícones)                                                                                                     | GEP: observado; tela: lido da tela                                                                   | GEP ≤ 1 s; tela idem + debounce (`ITEMS_SETTLE_MS`)                    |
| **Loja** (5 cartas)                                                          | GEP `store.shop_pieces` quando fresco; senão **sem fonte permitida em arquivo**                                            | GEP; reserva: leitor de tela (OCR dos nomes)                                                                                                            | GEP: observado; tela: lido da tela                                                                   | GEP ≤ 1 s; tela idem                                                   |
| **Aprimoramentos do jogador** (oferta e escolhidos)                          | GEP `augments.me` e `picked_augment` (banco do TFTAcademy), só com GEP ativo; senão leitor de tela (oferta) / manual       | `gep-reader.mjs` (`augmentResolver`); o registro manual prevalece sobre os escolhidos do GEP                                                            | GEP: **observado** (partida completa de 2026-10-11: 15 de 15 nomes no catálogo)                      | GEP ≤ 1 s                                                              |
| **Wisps** da loja                                                            | GEP `store.shop_pieces` (entrada comum, sem evento próprio) + catálogo `{5b609ae2}`                                        | `wispCatalog` + `parseShop` (`screen.wisps`, `id: null` na loja)                                                                                        | GEP: **observado** (28 Wisps da loja na partida de 2026-10-11, todos no catálogo; 1 carta fora dele) | GEP ≤ 1 s                                                              |
| Bancos dos rivais                                                            | **inexistente** (o jogo não expõe)                                                                                         | estimativa `hiddenHoldings` (`pool-tracker.mjs`)                                                                                                        | **estimado**                                                                                         | recalculado a cada análise                                             |
| Itens recebidos no banco (só a contagem, `hints.itemsReceived`) e carrosséis | `Saved/Logs/TFT.log`                                                                                                       | `game-log.mjs` → `parseLogLine`                                                                                                                         | **estimado** (não diz qual item)                                                                     | 1 a 4 s (flush do log)                                                 |

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
  - **Onde está a coluna** (`Locate-Column`, `Tft.FindFrame`): não se supõe; acha-se pela **moldura** dos espaços (linha clara
    fina nas bordas esquerda e direita de cada quadro, molde medido na calibração, correlação normalizada: 0,9 a 1,0 na coluna
    real e 0,3 a 0,5 fora dela; mediana entre os 10 espaços). Testado em 16:9, janela 2560x1351 com a coluna à esquerda e com
    o HUD centralizado, e escurecida. Sem moldura por 3 laços (`bankGeometry.mode = "assumed"`), usa o retângulo 16:9 do HUD e
    só aceita item com o mesmo rigor dos raros. Os campos de nível/ouro/XP continuam pelo retângulo centralizado (inalterado).
    Deslocamento de tolerância ±1 px (x) e ±2 px (y).
  - **Diagnóstico ao vivo, sem imagem** (`GET /api/state` → `screen.bankDebug` e `screen.bankGeometry`): por espaço
    `{slot, value, best, d1, d2, mean, spread, kept}` (`best` = melhor candidato, `d1` sua distância, `d2` a do melhor de outra
    família, `mean`/`spread` o brilho e o desvio da assinatura, `kept` = valor mantido pela memória do espaço) e a geometria
    `{mode: "frame"|"assumed", x, ncc, contrast, client}`. É a leitura de agora (não passa pelo debounce de `bank`).
    Com isso cada "?" se explica: `d1` > 0,6 (ou > 0,45 se raro) = ícone fora do que o leitor reconhece; `d2 − d1` pequeno =
    ambiguidade real (ex.: `DA_18_EmblemFloraFatalis` e `DA_18_EmblemJuggernaut` distam 0,405 entre si).
  - **Interface**: o banco mostra "N não reconhecidos: fora da análise" (a dica dá a proporção de componentes entre os
    reconhecidos, só como estimativa); "?" nunca vira item.
  - **Não verificado**: leitura contínua numa partida inteira com o banco cheio; que a moldura é achada na janela real do
    usuário (a escala 1,176 foi testada em imagem reescalada da calibração, não numa captura real); os limites 0,6/0,45 foram
    calibrados com 3 itens de uma coluna escurecida (cálculo pelos dados de `bankDebug` depois que o servidor reiniciar).
- **Loja**: não aparece em nenhum arquivo (`TFTShopPlayerSubsystem` só registra tooltips e a falha de montagem no menu).
  Segue pelo leitor de tela.

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

| Evento                    | Payload (valores reais, truncados)                                                                                                                                                                                                       | Uso                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `me.gold`                 | `2`, `1`, `{}`                                                                                                                                                                                                                           | ouro (ver o `{}` abaixo)                             |
| `me.xp`                   | `{"level":2,"current_xp":0,"xp_max":2}`                                                                                                                                                                                                  | nível e XP `"0/2"` (mesmo formato do leitor de tela) |
| `match_info.round_type`   | `{"stage":"1-3","name":"PVE","type":"Minions_2","native_name":"Intro2"}`                                                                                                                                                                 | estágio-rodada                                       |
| `match_info.match_state`  | `{"in_progress":true}`                                                                                                                                                                                                                   | fim de partida (zera a leitura de `{}`)              |
| `store.shop_pieces`       | `{"slot_1":{"name":"DA_18_Sentry"},...,"slot_5":{...}}`; comprado vira `{"name":"Sold"}`                                                                                                                                                 | loja (5 espaços; vendida = vazio)                    |
| `store.shop_visible`      | `"true"` / `"false"`                                                                                                                                                                                                                     | loja escondida não substitui a lida da tela          |
| `bench.bench_pieces`      | `{"cell_1":{"name":"DA_18_Varus","level":"1","item_1":"","item_2":"","item_3":""},...}`; `{}` = vazia                                                                                                                                    | reserva (estrelas e itens por peça)                  |
| `bench.item_bench`        | `[{"summoner","tag_line","bench_items":[{"name":"DA_Consumable_ItemRemover","count":2}]}, ...]`                                                                                                                                          | banco de itens (só a linha do jogador local)         |
| `roster.player_status`    | `{"<nome>":{"index","health","xp","localplayer":true,"rank","tag_line"}, ...}`                                                                                                                                                           | só para achar quem é o jogador local (`localplayer`) |
| `augments.me`             | **observado**: `{"augment_1":{"name"},"augment_2":{"name"},"augment_3":{"name"}}`, um evento a cada reroll de UMA carta; todos `""` = tela fechada                                                                                       | oferta de aprimoramentos                             |
| `augments.picked_augment` | **observado**: `{"slot_1":{"name"},...,"slot_4":{"name"}}` CUMULATIVO (todos os escolhidos até agora, na ordem; vazios `""`), reenviado a cada escolha. `match_info`/`me` + `picked_augment` seguem aceitos por tolerância, nunca vistos | aprimoramentos escolhidos, em ordem                  |

Os dois últimos foram observados na partida completa de 2026-10-11 (a feature do escolhido é `augments`, não `me`). Nunca lidos (a consulta nem os seleciona): `board.opponent_board_pieces`, `match_info.battle_stats`, `round_outcome`,
`board.board_pieces` (o tabuleiro próprio já vem do `TFTEoGStats.json`), `match_stats`, `carousel` e qualquer campo de rival.

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
  acumulam em ordem, sem repetir, cada um com o estágio (`round_type` corrente) da primeira vez em que apareceu. Nomes com `ChampionItem`
  são ignorados.
- **Mapeamento ao catálogo**: `augmentResolver` casa o nome com o id do `augments.json` (id exato; depois sem caminho/extensão; depois sem
  diferenciar caixa, se único). Fora do catálogo = **desconhecido** (contado em `unknown`, nunca inventado).
- **Campos**: `fields.augmentOffer` (ids do catálogo, `count`, `unknown`) e `fields.augmentPicked` (`[{id, stage}]`, `count`, `unknown`);
  `gepStatus.coverage = {augmentOffer, augmentPicked, augmentUnknown, wisps}`.
- **Precedência no estado** (`mergeGep`): a oferta do GEP substitui `screen.augments` (da tela) só quando **completa** (nenhuma carta
  desconhecida) e com 2 ou 3 cartas; oferta vazia mantém a da tela. `screen.pickedAugments` (`[{id, stage}]`) só existe com GEP ativo.
  `screen.sources.augments` e `screen.sources.pickedAugments` valem `"gep"`.
- **No servidor** (`POST /api/recommend`): o registro manual do usuário (`augments` não vazio ou `augmentsKnown`, inclusive lista vazia)
  **prevalece**. Sem ele valem os escolhidos do GEP (`options.augments`), que alimentam `matches.augments`, `chosenAugments` (cada item
  ganha `source` `"gep"` | `"manual"` e `stage`) e `augment-advice`. A oferta (`seen.augments`) é descartada quando uma das cartas já é
  escolhida. Na interface (`v2/js/main.js`) a trilha mostra os escolhidos do GEP e, ao marcar/desmarcar à mão, o registro manual é
  semeado com eles antes da edição.

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
| oferta de aprimoramentos (`augments`)        | GEP (completa, 2 ou 3 cartas) > tela                | `"gep"` / `"screen"`                |
| aprimoramentos escolhidos (`pickedAugments`) | só GEP (o registro manual prevalece no servidor)    | `"gep"` / ausente                   |
| Wisps (`wisps`)                              | só GEP, com a loja do GEP ativa                     | `"gep"` / ausente                   |

`screen.sourcesDetail.<campo> = {source, ageMs, confidence}` (+ `inferred` no ouro vindo de `{}`). O leitor de tela **continua rodando**
durante a partida: é o reserva de cada campo acima e a fonte da oferta de aprimoramentos sempre que o GEP não a entrega completa
(fonte inativa, oferta vazia ou com carta fora do catálogo).
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
- **Sem dado de rivais além do que a interface já mostra**; nenhum aprimoramento é derivado no overlay.
- **Duas leituras locais somente-leitura, só para posicionar a janela**: (1) a área cliente da janela do TFT (`UnrealWindow`, título "TFT…") por um
  PowerShell persistente (`EnumWindows`, `GetClientRect`, `ClientToScreen`), sem tocar no processo do jogo; (2) o `FullscreenMode` de
  `%LOCALAPPDATA%\TFT\Saved\Config\WindowsClient\GameUserSettings.ini` para avisar de tela cheia exclusiva. Nenhuma das duas alimenta o motor nem o estado da partida.
- **Exibição**: janela transparente de outro processo (sem injeção, hook, memória, captura de tela ou automação de entrada); só aparece sobre o
  TFT em janela ou janela sem borda. Detalhes, atalhos e limites em `overlay/README.md`; opções e política em `pesquisa/overlay-opcoes.md`.

## Estado exposto pelo servidor

- `GET /api/state`: `screen.stage`, `screen.phase`, `screen.phaseKind` (do arquivo do jogo, com reserva na tela) e
  `screen.sources = { stage, phase, gold, level, xp, items, shop, bench }` (mais `augments`, `pickedAugments` e `wisps` quando vêm do GEP)
  com a origem de cada campo (`"game-log"`, `"gep"`, `"screen"`, `"derived"`, `"manual"` ou `null` se não lido) e `screen.sourcesDetail` com
  `{source, ageMs, confidence}` dos campos do GEP. `screen.pickedAugments` (`[{id, stage}]`) e `screen.wisps` (`[{slot, id, name, known}]`) só existem
  com GEP ativo. `gepStatus` (topo da resposta) é o estado da fonte GEP, com `recordGames` e `coverage` (ver "GEP / TFTAcademy"). `gameFiles` traz o estado bruto da leitura (`available`, `source`, `gameId`,
  `sameGame`, `stale`, `phase`, `stage`, `writtenAt`, `error` e `hints` marcadas `reliability: "estimated"`).
- `GET /api/state` também traz `unitLedger` (livro-razão de compras/fusões, ver "Reserva (bench) e livro-razão de eventos"): informativo,
  não alimenta a análise.
- `POST /api/recommend`: usa a mesma rodada mesclada (`options.stage`). Os aprimoramentos escolhidos vêm do registro manual do usuário
  (prevalece) ou, sem ele, do GEP; `analysis.chosenAugments[].source` diz qual (ver "Aprimoramentos e Wisps").

## Pendente de partida ao vivo

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

## Reprodução

- Testes: `node --test tests/game-log.test.mjs tests/unit-ledger.test.mjs` (trechos reais do `__sentry-event` e do `TFT.log`;
  `tests/fixtures/` guarda as linhas de compra/estrela das partidas 3291596434 e 3291600904 e o tabuleiro final/retratos do jogador).
- Sondar ao vivo: `node -e "import('./game-log.mjs').then(m=>console.log(m.gameLog().status()))"` em `tft/helper`.
- GEP: `node --test tests/gep-reader.test.mjs` (banco SQLite temporário no esquema do TFTAcademy, preenchido com a fixture real sem dados
  pessoais). Sondar o banco de verdade, sem escrever nada: `node -e "import('./gep-reader.mjs').then(m=>console.log(JSON.stringify(m.gepReader({}).status({inMatch:true}),null,1)))"`.
