# Fontes de dados do TFT Helper

Registro de **de onde vem cada dado** que o helper usa, como é obtido, com que atraso, quão confiável é e o que não é
possível saber. Verificado em **2026-10-10** (Set 18, TFT@18.4.0, patchline BR1), com uma partida ao vivo e 11 logs reais
(`TFT.log` + 10 `TFT-backup-*.log`, uma partida por arquivo). Revisto em **2026-10-11**: a leitura de tela (OCR, glifos e
ícones) foi removida por decisão do usuário. Ouro, nível, XP, loja, banco de itens, removedores, Wisps e aprimoramentos vêm só do
GEP (TFTAcademy); sem ele ficam **desconhecidos explícitos** (ver "Leitura de tela (removida)").

## Regras

- Só entram arquivos que o próprio jogo/cliente grava e APIs locais documentadas (LCU pelo `lockfile`, somente GET). Única exceção, por
  decisão do usuário: o banco de eventos que o **TFTAcademy** (app de terceiro sobre o Overwolf GEP) grava, lido só para leitura e só
  com os campos do próprio jogador, incluindo os aprimoramentos dele (uso pessoal e local) e os Wisps da loja (ver "GEP / TFTAcademy").
  Nada de rivais.
- **Proibido**: ler a memória do processo, injetar DLL/código, hook, anexar depurador, captura de tela/OCR.
  Se um dado só existir por esses caminhos, ele fica registrado como **sem fonte permitida** (não se contorna).
- Classes de confiabilidade: **observado** (valor gravado pelo jogo ou pelo GEP), **derivado** (calculado de observados),
  **estimado** (hipótese/heurística, nunca tratar como observado), **manual** (digitado pelo usuário). Campo sem fonte fica
  **desconhecido** (`null`), com o motivo em `noSource`; nunca se inventa um valor.

## Resumo: dado, fonte e confiabilidade

| Dado                                                                         | Fonte                                                                                                                      | Método                                                                                                                                                 | Confiabilidade                                                                                       | Atraso                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Id da partida, fila, set                                                     | `.sentry-native/<execução>.run/__sentry-event` (tags `game.id`, `game.queue`, `set_name`) e LCU `/lol-gameflow/v1/session` | arquivo / HTTPS local                                                                                                                                  | observado                                                                                            | ≤ 0,5 s (intervalo de leitura)                                         |
| **Estágio-rodada** (`2-4`)                                                   | `__sentry-event`, tag `game.tft.round`                                                                                     | `game-log.mjs` → `parseSentryEvent`                                                                                                                    | **observado**                                                                                        | ≤ 0,5 s (observado: mudanças detectadas na leitura seguinte)           |
| **Fase da rodada** (Planning, Combat, Draft = carrossel...)                  | `__sentry-event`, tag `game.tft.phase`                                                                                     | idem                                                                                                                                                   | **observado**                                                                                        | idem                                                                   |
| Fase do cliente (InProgress etc.)                                            | LCU `/lol-gameflow/v1/gameflow-phase`                                                                                      | HTTPS local (`server.mjs`, `readLcu`)                                                                                                                  | observado                                                                                            | até 5 s (cache)                                                        |
| Comp, itens equipados, tabuleiro de todos os jogadores                       | `Saved/Logs/TFTEoGStats.json` (`statsBlock.players[].boardPieces`)                                                         | leitura do arquivo (`capture.mjs`, a cada 0,5 s)                                                                                                       | observado, **só peças em campo**                                                                     | regravado pelo jogo durante a partida                                  |
| Vida, colocação, aprimoramentos de cada jogador                              | `TFTEoGStats.json` (`health`, `ffaStanding`, `augments`)                                                                   | idem                                                                                                                                                   | observado                                                                                            | idem                                                                   |
| **Ouro**                                                                     | GEP `me.gold` (banco do TFTAcademy) quando fresco; senão **sem fonte permitida em arquivo**                                | `gep-reader.mjs`; sem GEP: sem fonte permitida, desconhecido explícito (`noSource.gold`)                                                               | GEP: observado (0 é inferido de `{}`)                                                                | GEP ≤ 1 s de resolução                                                 |
| **Nível**                                                                    | GEP `me.xp.level` quando fresco; senão **sem fonte permitida em arquivo**                                                  | GEP, aceito só se consistente (`levelConsistent`); sem ele, piso derivado do XP passivo (`core/state/level.mjs`, ver "Nível"); sem piso, desconhecido  | GEP: observado; piso: derivado (`≥N`)                                                                | GEP ≤ 1 s                                                              |
| **XP**                                                                       | GEP `me.xp` (`atual/total`) quando fresco; senão **sem fonte permitida em arquivo**                                        | GEP; sem GEP: sem fonte permitida, desconhecido explícito (`noSource.xp`; no nível máximo, `nivel-maximo`)                                             | GEP: observado                                                                                       | idem                                                                   |
| **Reserva (bench)** do jogador                                               | GEP `bench.bench_pieces` quando fresco; **não reconstruível pelo log** (ver "Livro-razão de eventos")                      | `gep-reader.mjs` → `options.bench` (origem `gep`); sem GEP, vazia (a entrada manual saiu); o livro-razão dá só um teto (`unitLedger.bench.upperBound`) | GEP: observado; teto: **estimado**                                                                   | GEP ≤ 1 s                                                              |
| **Compras e fusões** do jogador (cada uma com o id da entidade)              | `Saved/Logs/TFT.log`, voz `Audio.Event.VO.Unit.Purchase` / `StarUp.2Star                                                   | 3Star`                                                                                                                                                 | `game-log.mjs` → `parseLogLine`; `unit-ledger.mjs`                                                   | **observado** (completo para compras da loja; faltam carrossel/prêmio) | 1 a 4 s (flush do log) |
| Vendas, movimento tabuleiro<->reserva                                        | **não gravados** (só as tentativas recusadas de arrastar)                                                                  | n/a                                                                                                                                                    | sem fonte                                                                                            | n/a                                                                    |
| **Banco de itens** do jogador                                                | GEP `bench.item_bench` (só a linha do jogador local) quando fresco; senão **sem fonte permitida em arquivo**               | GEP (identidade local confirmada); sem GEP: sem fonte permitida, desconhecido explícito (`noSource.items`)                                             | GEP: observado                                                                                       | GEP ≤ 1 s                                                              |
| **Loja** (5 cartas)                                                          | GEP `store.shop_pieces` quando fresco; senão **sem fonte permitida em arquivo**                                            | GEP (loja visível); sem GEP ou loja escondida: desconhecida (`noSource.shop`)                                                                          | GEP: observado                                                                                       | GEP ≤ 1 s                                                              |
| **Aprimoramentos do jogador** (oferta e escolhidos)                          | GEP `augments.me` e `picked_augment` (banco do TFTAcademy), só com GEP ativo; senão sem fonte (oferta) / manual            | `gep-reader.mjs` (`augmentResolver`); o registro manual prevalece sobre os escolhidos do GEP                                                           | GEP: **observado** (partida completa de 2026-10-11: 15 de 15 nomes no catálogo)                      | GEP ≤ 1 s                                                              |
| **Wisps** da loja                                                            | GEP `store.shop_pieces` (entrada comum, sem evento próprio) + catálogo `{5b609ae2}`                                        | `wispCatalog` + `parseShop` (`seen.wisps`, `id: null` na loja)                                                                                         | GEP: **observado** (28 Wisps da loja na partida de 2026-10-11, todos no catálogo; 1 carta fora dele) | GEP ≤ 1 s                                                              |
| Bancos dos rivais                                                            | **inexistente** (o jogo não expõe)                                                                                         | estimativa `hiddenHoldings` (`pool-tracker.mjs`)                                                                                                       | **estimado**                                                                                         | recalculado a cada análise                                             |
| **Carrossel** (aberto agora e as peças que oferece: campeão + item)          | fase `Draft` do `__sentry-event`; GEP `round_type` "Carousel" e `carousel.carousel_pieces`; calendário x-4 (estimativa)    | `core/state/carousel.mjs`, `gep-reader.mjs` → `parseCarouselPieces`, `app/carousel-view.mjs`                                                           | **observado** (jogo e GEP: 19 carrosséis em 5 partidas); calendário **estimado**                     | a cada leitura do estado (≤ 3 s)                                       |
| Itens recebidos no banco (só a contagem, `hints.itemsReceived`) e carrosséis | `Saved/Logs/TFT.log`                                                                                                       | `game-log.mjs` → `parseLogLine`                                                                                                                        | **estimado** (não diz qual item)                                                                     | 1 a 4 s (flush do log)                                                 |

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
- **Limites**: formato interno do Riot/Sentry, pode mudar em patch (o leitor devolve nulo, não lança, e o servidor cai para o
  estágio do GEP). Com o jogo fechado a pasta `.run` não existe (não se verificou o que acontece depois de uma queda do jogo).
  O arquivo contém também nome de usuário e máquina; o helper **não** lê nem expõe esses campos.
- **Integração**: `app/state.mjs` parte de `gameFilesState` (`game-log.mjs`: estágio e fase do Sentry) e aplica o GEP por cima.
  `seen.stage` e `seen.phase` vêm do arquivo; `seen.sources.stage` vale `"game-log"` ou, sem o arquivo, `"gep"`. O estágio é
  o único campo com duas fontes (ver "Precedência por campo").

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
- **Conclusão**: ouro, nível e XP só existem no estado replicado na memória do jogo, no que ele desenha na tela (captura proibida) e no GEP. Não há arquivo nem API local
  permitida que os traga. Vêm do GEP (TFTAcademy); sem ele ficam desconhecidos explícitos (o nível pode sair como piso
  derivado, ver "Nível"). Obtê-los sem o GEP exigiria ler a memória do processo ou interceptar a rede do jogo, o que é
  proibido (Vanguard).

### Nível: fonte, validação e precedência

- **Fonte**: só o GEP (`me.xp.level`, com o XP `atual/total` junto). O GEP só emite quando o nível muda: o nível 1 nunca aparece e,
  sem mudança, vale o último valor emitido.
- **Validação** (`core/state/precedence.mjs` → `levelConsistent` em `core/state/level.mjs`): o nível do GEP só vale se for inteiro de
  1 a 11, não menor que o maior nível já aceito do GEP na partida (o nível nunca cai), não abaixo do piso que o XP passivo garante no
  estágio, e se o total do XP que veio junto for de um nível que o inclui. Inconsistente = o GEP não vale para o nível nessa leitura.
- **Piso derivado** (`reduceLevel` em `core/state/level.mjs`, pela memória por partida de `level.mjs`, `levelTracker`, em `app/state.mjs`): sem nível observado agora,
  vale o maior piso conhecido: o do último nível observado nesta partida (com o XP dele) mais o XP passivo das rodadas seguintes, ou, a
  partir do estágio 2, o piso global que parte do nível 1 em 1-1. `levelFloor` soma só o XP passivo (`GAME.passiveXp` = 2 por rodada,
  **ignorando o estágio 1 e o carrossel**, onde a regra não foi verificada); quem compra XP só fica acima. Premissa: 2 XP passivos por
  rodada fora do estágio 1 e do carrossel (não observada no jogo). O piso sai com `sources.level = "derived"` e `levelInfo.minimum`
  (o real é este ou maior). XP de outro nível não desenha a barra do nível mostrado.
- **Precedência final**: (1) nível observado pelo GEP e consistente (`sources.level = "gep"`); (2) **piso derivado**; (3)
  **estimativa pelo tabuleiro** (peças em campo, `estimatedLevel`), só como último recurso; (4) sem nada disso, o nível de reserva
  `FALLBACK_LEVEL = 7` (`core/state/inputs.mjs`). Nos casos (3) e (4) `levelEstimated = true`: a estratégia não calcula odds, rolagem
  nem XP com ele (veredito "nível não lido"). **Em aberto** (decisão D4 de `PLANO-REMOVER-OCR.md`): o `FALLBACK_LEVEL` continua; trocar
  por "nível desconhecido" muda a entrada do motor e o golden. Não existe campo manual de nível na interface v2.
- **Rótulo**: `levelSource` = `"lido"` (observado pelo GEP), `"derivado"` (piso) ou `"estimado"` (tabuleiro ou reserva);
  `analysis.levelSource` repete o rótulo no resultado.
- **Interface**: o HUD mostra `≥N` (derivado) ou `~N` (estimado) e esmaece o anel; o tooltip diz a origem e qual nível a análise
  usou. Sem GEP, o chip "GEP off · sem fonte" lista o que ficou desconhecido.
- **Só se confirma ao vivo**: nível máximo (`xp_max` 0, motivo `nivel-maximo` para o XP) e a regra de XP passivo por rodada.
- O histórico da leitura do nível pelo HUD (glifos, `reconcileLevel`, `Hud-Rect`) está em `.old/ocr/README.md` e no git.

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
saldo (nem ouro final em arquivo), **não implementado**. Vem do GEP; sem ele, desconhecido.

**4. Rivais**: o cliente só recebe o que é visível. O log **não traz nenhum evento de compra, venda ou movimento de outro jogador**.
Provas: (a) a voz de compra só ocorre para o jogador local (30 a 66 compras por partida, contra mais de 250 se fossem 8 jogadores);
(b) as únicas aparições de unidades alheias são vozes de feitiço/vitória (`Unit.Spell`, `UnitCombatVictory`) durante o combate e
os tabuleiros de `TFTEoGStats.json`, que já são usados; (c) os nomes de outros jogadores aparecem só em `TFTPlayerAFKSubsystem`.
**Bancos dos rivais seguem como estimativa** (`hiddenHoldings` com `BENCH_POLICY`, abaixo), nunca dado observado.

**5. Integração** (`server.mjs`, `GET /api/state`): campo `unitLedger` (`gameFiles.ledger(gameId, boardPieces do jogador)`) com
`purchases` (observado), `reconciliation` (derivado: adquirido, tabuleiro, sobra, falta por campeão, `soldAtLeast`), `bench`
(`reconstructable: false`, `reliability: "estimated"`, `upperBound` = sobra) e `validation` (os números acima). A validação **não passou**,
então o servidor **não** usa o livro-razão como reserva: a reserva observada vem só do GEP (`seen.sources.bench` = `"gep"`); sem
ele fica sem fonte (`null`). A entrada manual da reserva foi removida. A execução do jogo só entra no livro-razão da partida depois que o arquivo de
contexto (`__sentry-event`) é regravado depois do `BeginGame` dela (evita misturar partidas); se o servidor começar depois de uma
queda, a primeira execução já não está no `TFT.log` atual e fica de fora (compras "sem compra" na conta).

- **Limite da reserva provável**: se algum dia se quiser uma reserva "provável", o único caminho honesto é combinar o teto do livro-razão
  com o que o usuário confirma na interface (manual prevalece), nunca substituí-la.

**Pista (hints) antiga**: a voz de compra continua em `gameFiles.hints.purchases` / `starUps` (estimada, só contagem); o livro-razão a
supera para o ADQUIRIDO.

### Banco de itens e loja

- **Banco de itens**: sem fonte em arquivo. Vem só do GEP (`bench.item_bench`, a linha do jogador local escolhida por identidade;
  ver "Titularidade"), com `items`, `bank`, `removers` e `unknownItems` (ver "Mapeamento para o formato do servidor"). Sem GEP, ou
  com a identidade local `desconhecida`/`divergente`, o banco fica **desconhecido** (nunca "vazio"): `noSource.items` diz o motivo
  (o da fonte GEP, `aguardando-gep` ou `identidade-<estado>`). Pista indireta (estimada): cada `ItemFlyToBench_INST` em `TFT.log` é um
  item que foi para o banco (`hints.itemsReceived`, só a contagem; não diz qual item); ela não substitui o banco.
  - **Interface**: com o banco do GEP, item fora do catálogo é contado em `unknownItems` e mostrado como "N não reconhecidos: fora da
    análise"; nunca vira outro item. Sem fonte, o banco não é mostrado nem entra na análise (`bankRead = false`), o chip "GEP off · sem
    fonte" o lista entre os campos que faltam e o passo "Itens dos campeões" não aparece.
- **Loja**: não aparece em nenhum arquivo (`TFTShopPlayerSubsystem` só registra tooltips e a falha de montagem no menu).
  Vem só do GEP (`store.shop_pieces`). Loja escondida (`store.shop_visible` falso) não vale: as cartas de antes não provam a loja de
  agora, e a loja fica desconhecida (`noSource.shop = "loja-escondida"`). Sem GEP, `noSource.shop` traz o motivo da fonte e a análise
  roda com `shopRead = false` (sem compra pela loja).
- O reconhecimento de ícones e o OCR dos nomes que existiam até 2026-10-11 estão descritos em `.old/ocr/README.md`.

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
  A oferta só vale na rodada em que foi lida (o GEP não a apaga: a do carrossel anterior fica no banco); `seen.carouselOffer` = `{stage, slots, unknown, ageMs}` e `seen.gepRound` = `{stage, name, ageMs}`, só com GEP ativo (frescor de 60 s: o maior silêncio medido no carrossel foi 36 s).
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
  `match_id` = `BR1_<gameId>` (o mesmo `gameId` do LCU, do `TFTEoGStats.json` e do `__sentry-event`): liga o banco à partida. Na partida
  curta de 2026-09-11, `ended_at`, `player_puuid` e `final_placement` vieram nulos; no banco real conferido em 2026-10-11 (cópia aberta
  só para leitura, `PLANO-REMOVER-OCR.md` seção 1.6), `ended_at`, `match_id` e `final_placement` vêm **preenchidos** nas partidas
  gravadas. O leitor usa `match_id` para a ligação e `ended_at` para "partida encerrada"; `final_placement` não é usado e o PUUID não é
  lido.
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
  tinha os 76 eventos de 2026-09-11 (~1 min, partida interrompida antes de ser finalizada ou apagada). Na análise do app, `settings` tinha
  `record_games = 'false'`. **Hoje** (banco real conferido em 2026-10-11) `settings.record_games` vale `true` e o banco tem partidas
  completas gravadas.
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
| `me.xp`                    | `{"level":2,"current_xp":0,"xp_max":2}`                                                                                                                                                                                                  | nível e XP `"0/2"` (o mesmo `atual/total` do HUD)    |
| `match_info.round_type`    | `{"stage":"1-3","name":"PVE","type":"Minions_2","native_name":"Intro2"}`                                                                                                                                                                 | estágio-rodada                                       |
| `match_info.match_state`   | `{"in_progress":true}`                                                                                                                                                                                                                   | fim de partida (zera a leitura de `{}`)              |
| `store.shop_pieces`        | `{"slot_1":{"name":"DA_18_Sentry"},...,"slot_5":{...}}`; comprado vira `{"name":"Sold"}`                                                                                                                                                 | loja (5 espaços; vendida = vazio)                    |
| `store.shop_visible`       | `"true"` / `"false"`                                                                                                                                                                                                                     | loja escondida: loja desconhecida (`loja-escondida`) |
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
- **Estado** (`mergeGep`): aprimoramentos vêm **só do GEP, sem OCR**.
  `seen.augments` = ids da oferta aberta (`[]` = escolha fechada; null = sem fonte ou nenhum evento ainda), `seen.augmentOffer` =
  `{open, stage, cards, unresolved, ageMs}`, `seen.pickedAugments` = `[{id, stage}]` e `seen.augmentSource` = `{state: "ativo" |
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
- **Estado**: `seen.wisps = [{slot, id, name, known}]` (slot de 1 a 5) com `seen.sources.wisps = "gep"`, somente quando a loja do
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
  `POST /api/recommend`; agora o laço do servidor (`app/auto-refresh.mjs`) chama o estado a cada ~3 s durante a partida, com ou sem cliente conectado;
  ao fim da partida (fase do cliente fora de `InProgress`/`Reconnect`) para de ler.

### Estados da fonte (`gepStatus` em `/api/state`)

| `state`                | `reason`                                                                                                                                                                                              | Efeito                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ativo`                | -                                                                                                                                                                                                     | os valores do GEP valem (`available: true`)                                                   |
| `obsoleto`             | `sem-eventos-recentes`                                                                                                                                                                                | último evento mais velho que o limite; campos do jogador **sem fonte** (`noSource`), sem erro |
| `ausente`              | `banco-ausente`, `sem-partida`, `fora-de-partida`, `outra-partida`, `partida-encerrada`, `set-diferente`, `banco-travado`, `banco-inacessivel`, `sqlite-indisponivel`, `erro-de-leitura`, `desligada` | idem                                                                                          |
| `ausente`              | `gravacao-desligada` (com `was` = `sem-partida`, `sem-eventos-recentes`, `outra-partida` ou `partida-encerrada`; só se `recordGames === false`)                                                       | idem; o HUD manda ligar "gravar partidas" no TFTAcademy                                       |
| `esquema-desconhecido` | `colunas-ausentes`, `tabela-ausente`, `arquivo-invalido`                                                                                                                                              | idem, com `detail` dizendo a coluna que falta                                                 |

Além disso: `source: "gep"`, `confidence: "observed"`, `gameId`, `binding`, `lastEventAt`, `lastEventAgeMs`, `staleMs`, `rows`, `identity`
(`confirmada` / `divergente` / `desconhecida`), `recordGames` (`true` | `false` | `null`) e, com a fonte ativa, `coverage`
(`{augmentOffer, augmentPicked, augmentUnknown, wisps}`, só contagens). Os valores ficam em `seen`, não em `gepStatus`.

### Precedência por campo

`GEP fresco e consistente > arquivos do jogo > desconhecido explícito`: ouro, nível, XP, loja e banco de itens só o GEP observa (sem
ele, desconhecidos; o nível pode sair como piso derivado); o estágio tem duas fontes e nele o arquivo do jogo (Sentry) vale mais que o
GEP. Não há leitura de tela (removida em 2026-10-11). A decisão é
de `core/state/precedence.mjs` (`reduceSources`, chamada por `app/state.mjs` a cada leitura); a troca de valores é feita por `mergeGep`
e o nível é calculado por último (`level.mjs` -> `core/state/level.mjs`, `reduceLevel`). Ordem em `app/state.mjs`: `gameFilesState`
(estágio e fase do Sentry) → precedência → `mergeGep` → nível → `noSource` (`noSourceOf`).

| Campo                                        | Ordem                                                       | `seen.sources.<campo>`         |
| -------------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| ouro, XP                                     | só GEP > desconhecido                                       | `"gep"` / `null`               |
| nível                                        | GEP consistente > piso derivado > (motor) estimado          | `"gep"` / `"derived"` / `null` |
| banco de itens (`items`, `bank`, `removers`) | só GEP (identidade confirmada) > desconhecido               | `"gep"` / `null`               |
| loja                                         | só GEP (loja visível) > desconhecido                        | `"gep"` / `null`               |
| estágio                                      | **arquivo do jogo (`__sentry-event`)** > GEP                | `"game-log"` / `"gep"`         |
| reserva                                      | só GEP > desconhecido (sem entrada manual)                  | `"gep"` / `null` (sem fonte)   |
| oferta de aprimoramentos (`augments`)        | só GEP > desconhecido (`augmentSource.state = "sem-fonte"`) | `"gep"` / ausente              |
| aprimoramentos escolhidos (`pickedAugments`) | só GEP (o registro manual prevalece no servidor)            | `"gep"` / ausente              |
| Wisps (`wisps`)                              | só GEP, com a loja do GEP ativa (`wispsInState`)            | `"gep"` / ausente              |

`seen.sourcesDetail.<campo> = {source, ageMs, confidence}` (+ `inferred` no ouro vindo de `{}`). `seen` é o
**estado mesclado** (arquivos do jogo + GEP) que `GET /api/state` publica; até 2026-10-11 ele se chamava `screen`. Com o GEP ativo o nível do GEP vale se for consistente
(`levelInfo.source = "gep"`).

**Desconhecido explícito** (`seen.noSource`, `noSourceOf` em `gep-reader.mjs`): para cada campo do jogador sem valor (ouro, nível,
XP, loja, itens, reserva, Wisps, oferta de aprimoramentos), o motivo. Sem GEP fresco é o motivo da fonte (`banco-ausente`,
`sem-eventos-recentes`, `desligada`, `gravacao-desligada`, `partida-encerrada`...); com ele, `aguardando-gep` (nenhum evento daquele
campo ainda, como nos 0 a 55 s do início da partida), `loja-escondida` (`shop_visible` falso), `identidade-desconhecida` /
`identidade-divergente` (banco de itens) ou `nivel-maximo` (sem barra de XP). O nível com piso derivado tem valor e não entra. A
interface e o overlay mostram o chip "GEP off · sem fonte" com a lista do que falta; nada é preenchido por outra fonte nem inventado.

**Um valor por campo na saída** (M7). Regras de `core/state/precedence.mjs`:

- **Consistente.** O GEP só vale para um campo se o valor for plausível. No nível: inteiro de 1 a 11, não menor que o maior nível já
  aceito do GEP na partida (o nível nunca cai), não abaixo do piso que o XP passivo garante no estágio, e o total do XP lido junto
  tem de ser de um nível que o inclui. Loja escondida (`shop_visible false`) e banco de itens sem identidade confirmada não valem.
- **Histerese (3 leituras).** Só o estágio tem duas fontes. Quando as duas têm valor, a fonte ativa só troca para a preferida depois
  de 3 leituras seguidas em que ela é a preferida. Se a fonte ativa perde o valor (GEP velho, arquivo ausente) a outra assume na
  hora: não se segura campo sem valor. O valor da fonte ativa continua atualizando a cada leitura; só a escolha da fonte tem memória.
  Nos demais campos o único candidato é o GEP.
- **Divergência registrada.** Se o GEP e o arquivo do jogo têm valor e discordam por 3 leituras seguidas, conta-se **uma** divergência
  (por episódio; o GEP uma rodada atrás por instantes não conta), grava-se uma linha "GEP e arquivo do jogo divergem em <campo>" no log
  e o contador sobe. `/api/state` expõe `gameState.divergence = { total, byField, last, current, readings }` e, em `gameState`, o
  `GameState` normalizado (`clock` e `me`: ouro, nível, XP, loja, banco de itens, removedores, reserva; cada campo com `value`, `source`,
  `confidence`, `at`, `ageMs`, `stale`; listas viram `count`). Origens possíveis de um campo (`core/state/field.mjs`): `gamefile`,
  `sentry`, `lcu`, `gep`, `manual`, `derived`, `estimated`.
- **Servidor como fonte.** `POST /api/recommend` lê ouro, nível (e se é piso derivado ou estimado), XP, estágio, loja, banco de itens e
  oferta do estado do servidor (`core/state/inputs.mjs`); o corpo do cliente só leva decisões do usuário (comp fixada, trocas,
  aprimoramentos). `level`, `gold`, `inventory`, `levelEstimated` e `levelSource` do payload antigo continuam sendo aceitos e validados, mas só valem numa
  partida revista (`replayGameId`).

Interface (discreta): o tooltip do indicador "ao vivo" mostra o estado do GEP; os tooltips de nível e ouro dizem "do GEP (TFTAcademy)".

### Limitações

- Depende do Overwolf e do TFTAcademy **rodando durante a partida**, e do esquema privado do TFTAcademy (pode mudar com qualquer atualização).
- O GEP só emite valores que mudam: o nível 1 e o ouro inicial nunca aparecem; a fonte só prova que "está viva" pelo último evento de qualquer tipo.
- Em 2026-10-10 o banco **não tinha nenhuma partida recente** (única partida: 2026-09-11; `-shm`/`-wal` tocados em 2026-10-08, sem partida
  gravada) e o Overwolf/TFTAcademy não estavam em execução com o TFT aberto: o estado real naquele dia era `obsoleto` (≈695 h).
  Em 2026-10-11 o banco já tinha partidas completas gravadas e `record_games` ligada. Com `settings.record_games` desligada (ver
  "Gravação desligada") o app não grava nada, então o estado passa a `ausente` / `gravacao-desligada` até a configuração ser ligada no
  TFTAcademy (o helper não a altera). Em qualquer estado fora de `ativo`, ouro, nível exato, XP, loja, banco de itens, Wisps e oferta de
  aprimoramentos ficam sem fonte.
- Não há reconstrução de eventos perdidos: se o app abre no meio da partida, os campos só aparecem quando mudam.

### Aviso de política

A Riot restringe aplicativos que fazem sugestões a partir do estado atual da partida, e o GEP exige aprovação da Riot para publicar um app
Overwolf. Este helper é **local e pessoal** e usa o GEP só pelo banco de um app já instalado, sem injeção, memória ou rede. O Overwolf
proíbe dados de **aprimoramentos** em apps **públicos**; por decisão do usuário (2026-10-10) o helper os lê **de forma pessoal e local,
sem publicar**, só os do jogador local. Dados de **rivais** (`item_bench` dos outros, `opponent_board_pieces`, `match_stats` de outros)
**continuam não lidos nem expostos**. O helper também nunca liga `record_games` nem altera qualquer configuração do TFTAcademy. Para desligar a fonte, aponte `TFT_GEP_DB` para um caminho inexistente ou remova o
TFTAcademy: ela vira `ausente` e os campos do jogador ficam sem fonte (desconhecidos explícitos).

## Leitura de tela (removida)

A leitura de tela própria (OCR, glifos e ícones: `screen-reader.ps1`/`.mjs`, `screen-glyphs.json`, `bench-candidates.mjs` e as
ferramentas de medição e calibração) foi **removida em 2026-10-11 por decisão do usuário**. Essa decisão **revoga** a anterior, do
mesmo dia, de que "o helper não pode depender do TFTAcademy/Overwolf e a tela é a fonte própria". Hoje o GEP (TFTAcademy) é a fonte de
ouro, nível, XP, loja, banco de itens, removedores, Wisps e aprimoramentos; sem ele esses campos ficam desconhecidos explícitos
("GEP off · sem fonte"), sem reserva e sem valor inventado, inclusive nos 0 a 55 s do início da partida, antes do primeiro evento do
GEP. A ponte GEP própria (`overwolf-bridge/`) fica fora por enquanto. O plano está em `PLANO-REMOVER-OCR.md`; os arquivos, as medições
(recall e precisão por campo) e como restaurar estão no arquivo histórico `.old/ocr/README.md`, que nenhum arquivo do sistema importa
nem inicia (`tests/architecture.test.mjs`).

## Overlay (janela sobre o jogo, sem fonte nova de dados)

O overlay (`overlay/`, Electron oficial isolado nesse pacote) não lê nenhuma fonte do jogo: ele é uma **apresentação** do que o servidor já calculou.

- **Canal**: `GET /api/overlay[?since=<rev>]`, somente leitura. Devolve, de um cache em memória (`app/overlay-feed.mjs`), o último corpo de
  `GET /api/state` e o último de `POST /api/recommend` ao vivo (partida revista não entra), cada um com `at`/`ageMs`; `rev` muda quando um dos dois
  muda e, com `since == rev`, a resposta é curta (`unchanged: true`). Não calcula, não lê disco e não chama `current()`, o
  rastreador de sequências nem o plano persistente.
- **Por que não faz a própria análise**: `POST /api/recommend` custa ~1 s de CPU e grava o plano em andamento (`plan-state`); o overlay dobraria a
  análise e alteraria esse estado. Consequência: a recomendação só se renova enquanto a interface web está aberta e **visível** (o navegador pausa
  abas ocultas). Sem ela, o HUD mostra o estado e "aguardando análise".
- **Origem dos números no HUD**: a mesma da interface (`v2/js/model.js`): ouro/nível/XP do GEP (ou "sem fonte"), `gepStatus` no chip, vida do snapshot
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
  (`owned`, `stars`), `rec.pool` (`own` = cópias de 1★, `chancePerShop`, `remainingUpper`/`free`), ouro e a loja de agora (`seen.shop`, do GEP).
  Regra: peça do plano em campo ou na reserva, abaixo de 3★ e com cópias suficientes na pool para o próximo marco vira linha "Comprar" (`how: "copy"`) **somente
  enquanto a loja a mostra**; texto "cópia · fecha o 2★/3★" (uma cópia fecha) ou "cópia · sobe para N★ (faltam K)". Prioridade: fecha estrela, depois o carry, depois
  a chance de aparecer. `stage.buyNow` (peças que faltam) não mudou, nem o ranking das comps. Loja não lida: nenhuma linha de cópia e nenhum aviso.
- **Itens por campeão** (`core/items/champion-items.mjs`, sobre `buildStates` da Formação). Entrada: `plan.itemPlans[*].ideal` (até 3), `equipped`, os donos dos itens
  (`owners`) e o banco lido (`seen.items`). Cada item: `on` (equipado), `ready` (no banco ou monta agora), `move` (mover de outra peça), `taken`, `half`/`need`
  (falta N). Passo "Itens dos campeões" do modelo (campeões em campo, com slot livre e item pendente, carry primeiro); sem banco lido o passo não aparece.

## Estado exposto pelo servidor

- `GET /api/state`: `seen.stage`, `seen.phase`, `seen.phaseKind` (do arquivo do jogo; sem ele, o estágio do GEP) e
  `seen.sources = { stage, phase, gold, level, xp, items, shop, bench }` (mais `augments`, `pickedAugments` e `wisps` quando vêm do GEP)
  com a origem de cada campo (`"game-log"`, `"gep"`, `"derived"` ou `null` se sem fonte), `seen.noSource` com o motivo de cada campo
  do jogador sem valor (ver "Precedência por campo") e `seen.sourcesDetail` com
  `{source, ageMs, confidence}` dos campos do GEP. `seen.pickedAugments` (`[{id, stage}]`) e `seen.wisps` (`[{slot, id, name, known}]`) só existem
  com GEP ativo. `gepStatus` (topo da resposta) é o estado da fonte GEP, com `recordGames` e `coverage` (ver "GEP / TFTAcademy"). `gameFiles` traz o estado bruto da leitura (`available`, `source`, `gameId`,
  `sameGame`, `stale`, `phase`, `stage`, `writtenAt`, `error` e `hints` marcadas `reliability: "estimated"`).
- `GET /api/state` também traz `carousel` (aberto agora, peças lidas do GEP e o que pegar; ver "Carrossel") e, só com GEP ativo, `seen.gepRound` (`round_type`) e `seen.carouselOffer`.
- `GET /api/state` também traz `unitLedger` (livro-razão de compras/fusões, ver "Reserva (bench) e livro-razão de eventos"): informativo,
  não alimenta a análise.
- `POST /api/recommend`: usa a mesma rodada mesclada (`options.stage`). Os aprimoramentos escolhidos vêm do registro manual do usuário
  (prevalece) ou, sem ele, do GEP; `analysis.chosenAugments[].source` diz qual (ver "Aprimoramentos e Wisps").

## Pendente de partida ao vivo

- **Carrossel**: o bloco `carousel` do `/api/state` e o cartão do overlay durante um carrossel real (detecção pela fase `Draft`, oferta do GEP, ordem das peças, o cartão sobre o jogo); ver "Carrossel" em "Dado a dado".
- **GEP**: a partida completa de 2026-10-11 (27 min, 3455 eventos) foi gravada pelo TFTAcademy e **reproduzida offline** contra o leitor
  (`pesquisa/gep-validacao-partida.md`: ouro, nível/XP, loja, reserva, banco de itens, aprimoramentos e Wisps conferem; `{}` = 0 visto 4
  vezes; linha local de `item_bench` única em 435 de 435 eventos; maior silêncio 36 s). O que ainda **só se confirma com o servidor ligado
  durante uma partida**: `gepStatus.state` virar `ativo` no 1-1 (e a ligação por `match_id` com o `gameId` do LCU), o "sem fonte" de
  cada campo ao vivo com o TFTAcademy fechado, e o que o app grava ao abrir no meio da partida. Sem amostra: nível 1 e ouro inicial (o GEP só emite quando muda: nos
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
  Precedência completa por campo: GEP fresco (própria, depois TFTAcademy) > desconhecido explícito
  (o nível pode sair como piso derivado). A ponte fica fora por enquanto (decisão de 2026-10-11): o TFTAcademy é a fonte em uso.
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
