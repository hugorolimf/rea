# Varredura exaustiva de arquivos do TFT e do cliente Riot (sem tela, sem memoria)

Data da varredura: 2026-10-10, 17:55 a 18:50 (hora local, UTC-3). Jogo: TFT 18.4.0, Set 18, patchline BR1. Durante a varredura
houve duas partidas em curso (3291708419 e 3291719626), o que permitiu medir o comportamento ao vivo dos arquivos.
Convencao: **observado** = visto no arquivo/comando, com a evidencia indicada; **derivado** = calculado a partir de observados;
**inferido** = hipotese que nao foi testada. Todos os horarios de `mtime` nas listagens estao em **UTC** (hora local = UTC - 3 h);
os carimbos `[AAAA.MM.DD-HH.MM.SS:ms]` do `TFT.log` tambem estao em UTC.

Nada foi alterado: nenhum arquivo do jogo foi escrito, nenhuma opcao de log foi ativada, nenhum POST foi feito (so GET no LCU),
nenhuma captura de tela, nenhuma leitura de memoria, nenhum codigo editado. O servidor da porta 3218 nao foi tocado.

## 1. Veredito (resposta direta)

**Nenhum arquivo que o jogo ou o cliente Riot gravam em disco contem, nem poderia conter com a configuracao atual, o banco
(reserva) de campeoes do jogador local ou dos rivais, a loja, o ouro, o nivel ou o XP.** Isto foi verificado de quatro formas
independentes:

1. **Inventario completo** (2.232 arquivos em 15 raizes, 2 delas inexistentes) e varredura por palavras-chave em 1.245 arquivos de texto/JSON/log/SQLite/cache
   (secao 7): os unicos arquivos com texto de jogo em andamento sao `TFT.log` (e seus backups), `TFTEoGStats.json` e o contexto do Sentry
   (`__sentry-event`). Nenhum tem ouro/nivel/XP/loja/reserva.
2. **Tabulacao de todos os tipos de linha** do `TFT.log` e dos 10 backups (242.877 linhas, 114 categorias, secao 5): o unico evento
   economico presente e a **voz de compra** (`Audio.Event.VO.Unit.Purchase`) e a de fusao (`StarUp.2Star/3Star`), ja usadas pelo
   livro-razao. Nao existe linha de venda, rolagem, compra de XP, ouro, juros, subida de nivel, movimento tabuleiro<->reserva aceito,
   conteudo da loja ou do banco de itens. Todos os eventos de audio logados sao so quatro tipos de voz (secao 5.3).
3. **Superficies de rede locais** (secao 8): o processo do TFT **nao escuta em nenhuma porta TCP**; tem um unico socket UDP de cliente (o trafego
   do servidor de jogo remoto, em `-ServerIP/-ServerPort` da linha de comando do proprio jogo). Nao ha Live Client Data na 2999
   (recusa conexao, curl codigo 7, medido com a partida em curso). O LCU (porta do `lockfile`) nao tem nenhuma rota/evento de estado de jogo do
   TFT (1.447 funcoes, 920 eventos listados em `/help`; as de TFT sao pass, troves, planner, perfil e `eog-stats`, este so no fim).
4. **Configuracao** (secao 9): nao ha opcao do usuario que ative log verboso de economia. `[Core.Log]` vem vazio no `BaseEngine.ini`; as
   unicas CVars vindas do servidor (`ClientConfig`) sao de Niagara/GPU. Descrevo na secao 9 o mecanismo padrao da Unreal para elevar
   a verbosidade, **sem aplicar**, com a ressalva de que nao ha evidencia de que algum `UE_LOG` de economia exista.

**Mas a informacao existe dentro do cliente e Riot a entrega a parceiros.** Os aplicativos de terceiros instalados nesta maquina
(TFTAcademy, confirmado pelo `main.log` dele: `GEP package is ready: 312.4.3`; o Overwolf instalado tambem tem o app Mobalytics Desktop
e o MetaTFT Standalone tem a mesma estrutura `__owepm__`, o que e so inferido) gravaram em disco, no banco SQLite do TFTAcademy, eventos de TFT com
`gold`, `xp`/`level`, `shop_pieces`, `bench_pieces`, `board_pieces`, `item_bench` de cada jogador e `player_status` (secao 4.5). Essa
via funciona por **componente nativo do Overwolf injetado no processo do jogo** (os logs do proprio Overwolf mostram
`Injecting into game...` e `hookLibraryFunctions ... OK`). Isso e exatamente o que a regra do projeto proibe (injecao/hook), entao
**nao e fonte permitida para este helper**. Registro so como fato; se algum dia o usuario quiser seguir por ai, e uma decisao
dele (aplicativo Overwolf, termos do Overwolf e da Riot), nao algo que eu faca ou contorne.

Resultado pratico para o helper: ouro, nivel, XP, loja, banco de itens e reserva continuam **sem fonte permitida em arquivo**; o que
os arquivos dao de novo/confirmado esta na tabela da secao 2.

## 2. Dado a dado: o que cada fonte entrega (resultado desta varredura)

| Dado                                                               | Existe em arquivo/API local permitida?                         | Onde se procurou                                                                                                                                                                                                                     | Evidencia                                                                                                                       | Classe                                                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ouro                                                               | **Nao**                                                        | `TFT.log` + 10 backups (grep `gold`: so cosmeticos `CD_TFT_GoldMine_Skin9_GainGold`, ComponentTag `IdleGold` e tiers de conta `urn:riot:gold`), `TFTEoGStats.json`, Sentry, logs LCU/Riot Client, tracing do cliente, cache Chromium | secao 7 e 5.4                                                                                                                   | nao encontrado                                                                                                                       |
| Nivel                                                              | **Nao**                                                        | idem                                                                                                                                                                                                                                 | idem                                                                                                                            | nao encontrado                                                                                                                       |
| XP                                                                 | **Nao**                                                        | idem (`xp` aparece 25.675 vezes em `LogAbilitySystem`, mas e a palavra "e**xp**licitly" de "Attempted to remove tag ... not explicitly in the container")                                                                            | secao 7                                                                                                                         | nao encontrado                                                                                                                       |
| Reserva (bench) do jogador                                         | **Nao** (so os arrastos recusados, 322 linhas nos 11 arquivos) | `TFTDragSubsystem`                                                                                                                                                                                                                   | `TFT-backup-...18.16.45.log:22526`: `Dropped[BP_DefaultBench_C_1_Slot_0x0] blocked by DraggedTag[DragDrop.Draggable.BoardOnly]` | so recusados                                                                                                                         |
| Reserva dos rivais                                                 | **Nao**                                                        | todos                                                                                                                                                                                                                                | o log nao traz nenhum evento de outro jogador alem de voz de feitico/vitoria e `TFTPlayerAFKSubsystem`                          | sem fonte                                                                                                                            |
| Loja (5 cartas)                                                    | **Nao**                                                        | `TFTShopPlayerSubsystem` (so tooltips e falha de montagem `TrySetupShop` no menu), `UTFTChemtechShopService` (loja de cosmeticos, HTTP)                                                                                              | secao 5.4                                                                                                                       | nao encontrado                                                                                                                       |
| Banco de itens                                                     | **Nao** (so `ItemFlyToBench_INST`, sem qual item)              | `LogMovieScene`                                                                                                                                                                                                                      | `...18.16.45.log:8233`                                                                                                          | estimado (contagem)                                                                                                                  |
| Compras (campeao + id da entidade)                                 | **Sim**, so as da loja do jogador local                        | `TFTAudioEventSubsystem`                                                                                                                                                                                                             | `...18.16.45.log:8258`: `Trigger[Audio.Event.VO.Unit.Purchase] Actor[TFTCharacter_2147461981 {DA_18_Akali_AD}]`                 | observado (ja usado)                                                                                                                 |
| Fusao/estrela                                                      | **Sim**                                                        | idem                                                                                                                                                                                                                                 | `...18.16.45.log:10517`: `StarUp.2Star`                                                                                         | observado (ja usado)                                                                                                                 |
| Vendas, rolagem, compra de XP, juros                               | **Nao**                                                        | todos os tipos de linha                                                                                                                                                                                                              | secao 5                                                                                                                         | nao encontrado                                                                                                                       |
| Estagio-rodada e fase                                              | **Sim**                                                        | `__sentry-event`, tags `game.tft.round` e `game.tft.phase`                                                                                                                                                                           | ao vivo: `round = "3-1"`, `phase = "Planning"` com `__sentry-event` regravado a cada ~1 a 5 s                                   | observado (ja usado)                                                                                                                 |
| Tabuleiro, itens equipados, vida, posicao, aprimoramentos de todos | **Sim** (so pecas em campo)                                    | `TFTEoGStats.json`                                                                                                                                                                                                                   | regravado durante a partida (mtime 18:45:06 com a partida em 3-1)                                                               | observado (ja usado)                                                                                                                 |
| Id da partida, fila, set                                           | **Sim**                                                        | `__sentry-event` (`game.id`), linha de comando em `TFT.log`, LCU                                                                                                                                                                     | idem                                                                                                                            | observado (ja usado)                                                                                                                 |
| Adversario da rodada                                               | **Parcial/nao**                                                | `TFTRoundSubsystem`                                                                                                                                                                                                                  | so `NextOpponentDetermined skipped, unresolved opponent ParticipantId[7]` (186x)                                                | aviso, nao dado                                                                                                                      |
| Nomes dos jogadores                                                | **Sim** (so quando alguem fica AFK)                            | `TFTPlayerAFKSubsystem: Updated player AFK - PlayerState[TFTPlayerState_8] PlayerName[...]`                                                                                                                                          | `...18.16.45.log:7765`                                                                                                          | observado, parcial                                                                                                                   |
| Banco dos rivais                                                   | **Nao existe**                                                 | todos                                                                                                                                                                                                                                | n/a                                                                                                                             | segue estimado por `hiddenHoldings` (`BENCH_POLICY keep=0.5, halfLifeMs=180000, maxCopies=18`), **estimativa, nunca dado observado** |

## 3. Metodo e limites desta varredura

- Inventario por script Node (`readdirSync` recursivo, sem seguir links simbolicos); `Content/Paks` pulado (registrado como `SKIPDIR`).
  As 15 listagens completas (nome, tamanho em bytes, mtime UTC) estao em
  `tft/helper/pesquisa/varredura-listagens/*.tsv` (2.232 linhas no total); a secao 6 traz o resumo por pasta e a lista das ultimas 48 h.
- Raizes cobertas: `%LOCALAPPDATA%\TFT`, `%LOCALAPPDATA%\Riot Games`, `%APPDATA%\{Riot Client, riot-client-ux, MetaTFT Standalone,
  TFTAcademy}` (as unicas pastas Riot/TFT/League em Roaming), `C:\ProgramData\Riot Games`, `C:\Riot Games\Teamfight Tactics`,
  `C:\Riot Games\Riot Client`, `C:\Riot Games\League of Legends\{Logs, Config, Saved, Plugins}`. `League of Legends\Replays` e
  `Documents\League of Legends` **nao existem** (ENOENT). `LocalLow` nao tem pasta Riot/TFT.
- Palavras-chave (sem distincao de maiusculas, contagem de ocorrencias por arquivo, bytes lidos como latin1): bench, reserve, shop, store,
  gold, xp, level, inventory, unit, champion, TFTCharacter, roster, board, reroll, interest, Slot, Sell, Purchase. 1.245 de 1.558 arquivos
  candidatos lidos (os demais: 0 bytes ou > 80 MB; DLL/EXE/PAK/WAD/WEBM/ICO/TTF/ASAR/BIN, `*.nv-gpudmp`, `*.upipelinecache`, `Plugins/`,
  `locales/`, `Binaries/`, `CEF3/`, GPUCache/Code Cache **listados sem abrir**, conforme combinado).
- Cada contagem alta foi aberta e classificada; os ruidos reconhecidos: "explicitly" (xp), `rerollEnabled` em `UpdateQueueData` do LCU (reroll,
  centenas), `roster`/`Purchase` dentro de `ClientConfiguration.json` e licencas Chromium, `Slot` em `PerksPreferences.yaml`.
- **Nao fiz**: abrir binarios do jogo/Vanguard (os `vgc_*.log` de `C:\Program Files\Riot Vanguard\Logs` sao binarios opacos, tamanho 8 a 133 KB, nao legiveis);
  decodificar `*.nv-gpudmp` (dump de GPU da NVIDIA, binario); ler caches Chromium alem de contar palavras (so contagem; nao e estado de partida); ler memoria.
- Latencia medida do `TFT.log` ao vivo: o jogo descarrega em lotes, ultima linha com 1 a 4 s de atraso em relacao ao relogio
  (ex.: relogio 21:34:24 / ultima linha 21:34:21,276; 21:34:41 / 21:34:39,752). O arquivo **le-se sem bloqueio** durante a partida
  (varias leituras com o jogo aberto, sem erro).

## 4. Arquivos com estado de partida: o que cada um tem

### 4.1 Arquivos do jogo (`%LOCALAPPDATA%\TFT`)

| Arquivo                                                              | Natureza                                                                                                                                                                                                                                                                     | Conteudo (observado)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Ouro/nivel/XP/loja/reserva/banco?             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `Saved/Logs/TFT.log`                                                 | log da Unreal, texto UTF-8 com BOM, regravado a cada partida (o anterior vira `TFT-backup-<data>.log`; ~10 backups, o mais antigo e apagado)                                                                                                                                 | 114 categorias (secao 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **nao**                                       |
| `Saved/Logs/TFT-backup-*.log` (10)                                   | idem, uma partida por arquivo (1,5 a 11,7 MB)                                                                                                                                                                                                                                | idem                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **nao**                                       |
| `Saved/Logs/TFTEoGStats.json`                                        | JSON de fim de jogo que o jogo regrava durante a partida (mtime 18:45:06 com a partida em 3-1; 7,5 KB a 10,7 KB)                                                                                                                                                             | chaves (todas, 8 jogadores): `gameId, gameMode, isRanked, queueId, queueType, statsBlock.{customAugmentContainer, gameLengthSeconds, setCoreName, players[].{PUUID, boardPieces[].{championName, endOfGameAlias, itemNames[], price, starLevel}, companionContentId, companionName, companionSkinId, ffaStanding, health, isInteractable, partnerGroupId, playbookItemId, playerId, riotIdGameName, riotIdTagLine, summonerIconID, summonerName}}`. **Novidade desta varredura**: cada peca traz `price` (custo, util para cruzar com o catalogo) | **nao** (so pecas em campo, vida e colocacao) |
| `.sentry-native/<guid>.run/__sentry-event`                           | MessagePack do contexto do Sentry, regravado pelo jogo a cada mudanca de tag (~1 a 5 s ao vivo)                                                                                                                                                                              | tags `game.id`, `game.queue`, `set_name`, `game.tft.phase`, `game.tft.round`, `sequentialGames`, `currentGameReconnectCount`, `totalSessionReconnectCount`, cosmeticos por jogador (arena, boom, portal, tactician) e dados de maquina/versao/GPU (ignorados pelo helper)                                                                                                                                                                                                                                                                         | **nao**                                       |
| `.sentry-native/<guid>.run/__sentry-breadcrumb1/2`                   | MessagePack, ate 100 migalhas por arquivo                                                                                                                                                                                                                                    | decodificado: **so avisos/erros do proprio log** (`LogAbilitySystem` 47, `LogNiagara` 14, `LogMetaSound` 11, `TFT` error 17, `RGIChrono` 4...), `type` vazio, `data` vazio                                                                                                                                                                                                                                                                                                                                                                        | **nao**                                       |
| `.sentry-native/<guid>.run/session.json`, `attachments/`, `reports/` | sessao do Sentry; `attachments` e `reports` **vazios** (nao ha relatorio nem dump de falha acumulado)                                                                                                                                                                        | `{init, sid, status, did, errors, started, duration, attrs}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **nao**                                       |
| `Saved/Config/WindowsClient/GameUserSettings.ini`                    | preferencias; contem `ReplaySettings=(LiveDelay 5, LiveSnapThreshold 10, ...)`, `TelemetrySettings=(SamplingThreshold, SamplingRate=1, ApCollectorUrl=https://data.riotgames.com)`, e `[TFTDeviceSettings] ClientConfig=(Name=..., Value=...)` (copia das CVars do servidor) | so configuracao                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **nao**                                       |
| `Saved/Config/WindowsClient/Engine.ini`                              | 112 B: so `[GameNetDriver StatelessConnectHandlerComponent] CachedClientID`                                                                                                                                                                                                  | **nao ha `[Core.Log]`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | n/a                                           |
| `Saved/Config/CrashReportClient/*/CrashReportClient.ini` (32)        | 274 B cada, um por execucao                                                                                                                                                                                                                                                  | so ids                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **nao**                                       |
| `Saved/SaveGames/EnhancedInputUserSettings.sav`                      | 2,2 KB, atalhos de teclado                                                                                                                                                                                                                                                   | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **nao**                                       |
| `Saved/Logs/D3D12.*.nv-gpudmp` (3)                                   | dumps de GPU da NVIDIA (Aftermath) de 22/09, 10/10 00:17 e 13:17 (quedas de video); binarios                                                                                                                                                                                 | listados sem abrir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | n/a                                           |
| `Saved/TFT_PCD3D_SM5.upipelinecache`                                 | cache de pipeline de shaders, binario                                                                                                                                                                                                                                        | listado sem abrir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | n/a                                           |

Nao ha pastas `Saved/Crashes`, `Saved/Demos`, `Saved/Replays` nem arquivos `.dmp/.mdmp/.replay/.rofl/.demo` em nenhuma das raizes
varridas (busca por extensao nas 15 listagens). `%LOCALAPPDATA%\CrashDumps` so tem dumps do `SamsungDisplayManager` e do
`iCloudChrome`; `ProgramData\Microsoft\Windows\WER\ReportArchive` so tem `AppCrash_LeagueClientUxRe_...` (renderizador de interface, nao o TFT).

### 4.2 Cliente Riot e LCU

| Arquivo/fonte                                                                                                                                                                                                                                                            | Natureza                                                                     | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C:\Riot Games\League of Legends\Logs\LeagueClient Logs\*_LeagueClient.log` (3,3 a 9,1 MB)                                                                                                                                                                               | log do cliente                                                               | `tft` 874 linhas: so preferencias do Team Planner (`TFTU.TeamPlannerPreferences`), `UpdateQueueData`, passes/troves, RMS `gdu/v1/product/tft/match/infoType/SUMMARY` (resumo **pos-jogo**); `gold` (9) = patente (`tier "GOLD"`), `bench` (18) = `teambuilder` de LoL, `shop` (38) = lojas de cosmeticos. Linha util: `mGameflowSession.gameClient updated: running, not visible` e `gameClient.serverPort` (porta do servidor remoto) |
| `*_LeagueClient-tracing.json` (21 a 25 MB)                                                                                                                                                                                                                               | trace do cliente (formato de rede/eventos da UI)                             | `tft` 1.701 linhas: presenca social (`activity.mode = "Teamfight Tactics (Ranqueada)"`, `productData`), `lol-tft-team-planner`, `lol-objectives/tft`, RMS `gdu/.../SUMMARY`. Chaves da presenca em jogo: `activity.{location,mode,progress,spectate}`, `detailedState`, `player.{show,state}`, `productData={championId,companionId,...}`. **Nada de ouro/nivel/XP/loja**                                                              |
| `*_LeagueClientUx.log` + `UX Helper/*.log`                                                                                                                                                                                                                               | log da interface Chromium                                                    | `reroll` (245) = `rerollEnabled` de fila; nada de estado de partida                                                                                                                                                                                                                                                                                                                                                                    |
| `Riot Games\Riot Client\Logs\Riot Client Logs\*.log` (ate 4 MB)                                                                                                                                                                                                          | log do Riot Client                                                           | `teamfighttactics` 2.631 linhas: patch (`OutOfDate/UpToDate`), `product-integration`, `loyalty-v2`, `heartbeat`; nada de estado de partida                                                                                                                                                                                                                                                                                             |
| `Riot Games\Riot Client\Data\Sessions\<sessao>\*.heartbeat.json` (131 B)                                                                                                                                                                                                 | batimento do produto                                                         | `{"data":{"phase":"Idle","sessionTTL":30},"source":{"patchlineId":"live","pid":...,"productId":"teamfighttactics","sessionId":""}}`: so `phase` do produto (`Idle`/`Gameplay`), sem dados de partida                                                                                                                                                                                                                                   |
| `Riot Games\Teamfight Tactics\Config\ClientConfiguration.json` (9,7 MB), `Data\ShutdownData.yaml` (tempos de modulos; o do TFT existia com 7,8 KB logo apos a partida anterior e sumiu ao reiniciar o jogo; o do LoL tem so `DurationMs` por modulo), `HttpCache\*.json` | configuracao do servidor, tempos de desligamento, cache de HTTP              | `ClientConfiguration.json` tem 135.722 chaves no total; as do TFT: `tft.client_settings.enable_send_logs = false`, `tft.client_Toggle_Enable_Gesture_Logs = true` (0 linhas de gesto no `TFT.log`), `tft.client_settings.telemetry.sample_rate = 1`, CVars de Niagara/GPU. Nenhuma chave de log de economia. `tft.client_settings.replay` existe como namespace (replay hospedado no servidor, ver 4.4)                                |
| `C:\ProgramData\Riot Games\Metadata\teamfighttactics.live\teamfighttactics.live.db` (+ `league_of_legends.live.db`, `lion.live.db`, `Riot Client.db`, mesmo papel, nao abertos)                                                                                          | **SQLite do patcher** (tabelas `files` 172, `chunks` 15.521, `sqlite_stat1`) | lista de arquivos instalados e hashes; 0 ocorrencias de gold/bench/shop                                                                                                                                                                                                                                                                                                                                                                |
| `Riot Client\Crashes\...\__sentry-event`, `LeagueClientUx\Crashes\...`                                                                                                                                                                                                   | Sentry do cliente, 0 a 800 B                                                 | vazios de breadcrumbs                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `C:\Program Files\Riot Vanguard\Logs\vgc_*.log`                                                                                                                                                                                                                          | log do anticheat                                                             | binario opaco (cifrado); listado, nao decodificado                                                                                                                                                                                                                                                                                                                                                                                     |
| `Roaming\riot-client-ux\sentry\scope_v3.json`                                                                                                                                                                                                                            | escopo do Sentry da interface do Riot Client                                 | `breadcrumbs: 0`; 0 ocorrencias de gold/bench/shop/xp/tft                                                                                                                                                                                                                                                                                                                                                                              |

LCU ao vivo (so GET): `/help` lista **1.447 funcoes e 920 eventos**; as que contem `tft|gameclient|eog|spectat|replay` sao as de
perfil/pass/troves/planner/historico/`eog-stats`, mais `Post...GameclientEogStatsBlock` (e o **proprio jogo** que posta o resumo no
LCU, `TFTHextechSubsystem: Successfully posted EOG stats block to League Client`, 10x; `PostGameflowEvent` 8x; `PostEarlyExit` 8x).
`/lol-gameflow/v1/gameflow-phase` respondeu `"InProgress"` com a partida em curso. `/lol-gameflow/v1/extra-game-client-args` respondeu `[]`.
`/lol-replays/v1/configuration` e de replays de LoL (`.rofl`), nao do TFT.

### 4.3 Chamadas HTTP que o proprio jogo faz (evidencia de que nao ha canal de estado)

`RGIOPHttp ... Query Start` no `TFT.log`, enumeradas: `GetSignedRankedStats` (30), `GetPlayerPasses` (24), `GetPlayerMissions` (19+11),
`GetSummonerJwtByPuuid` (11), `GetInvertedTypeMap` (11, mapeamento de inventario de **conta**, nao do jogo), `GetActiveStores` (22, loja de
**cosmeticos**), `PostEogStatsBlock` (10), `GetCustomGames` (9), `PostGameflowEvent` (8), `PostEarlyExit` (8), `RemovePlayerFromGame` (8).
Nenhuma carrega estado de partida em tempo real.

### 4.4 Replays do TFT

O TFT tem modo de replay (`Mode_Replay`, `UI_Replay`, CVars `httpReplay.*` e `Replay.UseReplayConnection:1`, `ReplaySettings` em
`GameUserSettings.ini`) mas e **replay transmitido por HTTP pelo servidor** (`httpReplay.ChunkUploadDelayInSeconds:5`,
`BufferedPlaybackTimeInSeconds:3.0`). Nao ha arquivo de replay em disco (nenhuma pasta `Demos`, `Replays` ou extensao de replay em
qualquer raiz; `League of Legends\Replays` nao existe). **Inferido**: um replay do TFT contem o estado replicado e passaria pelo servidor da Riot, nao
por um arquivo local; nao e fonte para este helper.

### 4.5 Aplicativos de terceiros (so como evidencia, nao como fonte)

| Local                                                                                                                                                        | O que e                                                                   | Achado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `%APPDATA%\TFTAcademy\tft-events.db` (102 KB) e `reportcard-events.db` (82 KB)                                                                               | SQLite (Drizzle) do app TFTAcademy, de **11/09/2026** (1 partida, set 18) | tabela `events(game_id, timestamp, event_type, round, stage_type, key, data, feature, category)` com **76 eventos**. Tipos (feature/key, contagem): `match_info/battle_stats` 27, `bench/item_bench` 13, `bench/bench_pieces` 5, `me/gold` 4, `match_info/round_type` 3, `store/shop_pieces` 3, `roster/player_status` 2 (por jogador: `index, health, xp, localplayer, rank`), `board/board_pieces` 2, `board/opponent_board_pieces` 1, `me/xp` 1 (`{"level":2,"current_xp":0,"xp_max":2}`), `info_update/player_rank` 1, `match_info/round_outcome` 1, `match_info/match_state` 1. `bench/item_bench` e uma lista **por jogador** `[{summoner, tag_line, bench_items[]}]` (nas amostras gravadas `bench_items` esta vazio; nao verifiquei se vem preenchido para rivais) |
| `%APPDATA%\TFTAcademy\logs\main.log`                                                                                                                         | log do app                                                                | `GEP package is ready: 312.4.3`, `GEP: register game-detected: ..., tft`, `[Overlay] Injecting into game...`, `[Overlay] Game injected: Teamfight Tactics`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `%LOCALAPPDATA%\Overwolf\Log\Apps\Overwolf General GameEvents Provider\index.html.log`                                                                       | log do Overwolf                                                           | recursos TFT pedidos: `summoner_info, augments, match_info, me, roster, store, board, match_stats, bench, carousel, live_client_data, gep_internal`. Chaves: `me{summoner_name, xp, health, rank, gold}`, `store{shop_pieces; eventos shop_visible, integrity}`, `bench{bench_pieces, item_bench}`, `board{board_pieces, opponent_board_pieces}`, `roster{player_status}`, `match_info{..., round_type, round_outcome, opponent, battle_stats, item_select, ...}`                                                                                                                                                                                                                                                                                                          |
| `%LOCALAPPDATA%\Overwolf\Log\TFTClient-Win64-Shipping_*.Game.html`                                                                                           | log nativo do Overwolf sobre o processo do TFT                            | `OverlayManager::...`, `ANCNClient::hookLibraryFunctions Hook function ... OK`: mostra que o Overwolf **instala hooks no processo do jogo**. Nao contem valores de eventos (so mensagens de overlay/foco)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `%APPDATA%\MetaTFT Standalone`, `%LOCALAPPDATA%\metatft standalone-updater`, `%APPDATA%\Overwolf` (o app Mobalytics Desktop so aparece nos logs do Overwolf) | outros apps                                                               | MetaTFT: `game-lobby.json` `{"pid":..., "saved_at":..., "lobby_info":{"queueId":"1100"}}` (so o ID da fila), caches Chromium; nao gravam o estado do jogo em arquivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Conclusao desta secao (**inferido a partir dos logs deles**): ouro, XP/nivel, loja, reserva (com itens por peca) e banco de itens por jogador
**existem em um provedor de eventos aprovado pela Riot (Overwolf GEP) que roda hooks dentro do jogo**. Nao ha, nos arquivos da propria Riot, um
equivalente. Nao li o conteudo dos logs de terceiros alem do necessario para identificar o mecanismo, e nao ha nenhuma dependencia deles no helper.

## 5. Todos os tipos de linha do `TFT.log` e dos backups

### 5.1 Por categoria (prefixo da Unreal)

Formato da linha: `[AAAA.MM.DD-HH.MM.SS:ms][frame]Categoria: [Verbosidade: ]mensagem`. A primeira coluna "Primeira ocorrencia" usa
`b-AAAA.MM.DD-HH.MM.SS:linha` (backup) para localizar o exemplo. Os backups rotacionam (o mais antigo e apagado); as linhas citadas valem para o conjunto de
arquivos presente em 2026-10-10 ~18:45.

Arquivos analisados (11): TFT-backup-2026.10.10-15.54.38.log, TFT-backup-2026.10.10-16.17.34.log, TFT-backup-2026.10.10-16.25.41.log, TFT-backup-2026.10.10-17.05.15.log, TFT-backup-2026.10.10-17.42.01.log, TFT-backup-2026.10.10-18.16.45.log, TFT-backup-2026.10.10-18.50.01.log, TFT-backup-2026.10.10-20.14.57.log, TFT-backup-2026.10.10-20.51.27.log, TFT-backup-2026.10.10-21.29.16.log, TFT.log. Linhas: 242877; linhas de continuacao (sem prefixo `[data][frame]Categoria:`, blocos multilinha de Niagara/telemetria/JSON): 22210; categorias distintas: 114.

| Linhas | Arquivos | Categoria                         | Primeira ocorrencia (arquivo:linha) | Exemplo                                                                          |
| -----: | -------: | --------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
|  47750 |       11 | `RGIChrono`                       | b-2026.10.10-15.54.38:8501          | [Client] ChronoSequencer_TFTCharacter_2147462365_CD_18_Yorick_Spirit_SpawnCeremo |
|  36478 |       11 | `LogNiagara`                      | b-2026.10.10-15.54.38:8079          | Niagara Effect has completed naturally but has an effect type with the "Asleep"  |
|  28020 |       11 | `LogAbilitySystem`                | b-2026.10.10-15.54.38:1317          | Processing InitializeRuntimeObjectLibrary.                                       |
|  20932 |       11 | `LogRHI`                          | b-2026.10.10-15.54.38:708           | Using Default RHI: D3D12                                                         |
|  15580 |       11 | `RGIOPRiotGamesApiInternal`       | b-2026.10.10-15.54.38:1515          | system settings: {                                                               |
|  13632 |       11 | `TFT`                             | b-2026.10.10-15.54.38:1043          | Constructing loading overlay widget                                              |
|  10352 |       11 | `LogShaderLibrary`                | b-2026.10.10-15.54.38:1034          | Using IoDispatcher for shader code library Global. Total 4446 unique shaders.    |
|  10195 |       11 | `LogGameFeatures`                 | b-2026.10.10-15.54.38:1191          | Initializing game features subsystem                                             |
|  10098 |       11 | `LogPackageName`                  | b-2026.10.10-15.54.38:2619          | FPackageName: Mount point added: '../../Plugins/GameFeatures/Chrono_Shared/Conte |
|   4864 |       11 | `LogConfig`                       | b-2026.10.10-15.54.38:406           | Set CVar [[D3D12.Bindless.SamplerDescriptorHeapSize:2048]]                       |
|   3627 |       11 | `RGIOPInitializer`                | b-2026.10.10-15.54.38:1468          | Initializing platform                                                            |
|   2455 |       11 | `LogUIActionRouter`               | b-2026.10.10-15.54.38:1296          | Found 0 derived classes when attemping to create action router (CommonUIActionRo |
|   2200 |       11 | `LogStreamableManager`            | b-2026.10.10-15.54.38:7874          | RequestAsyncLoad() called with empty or only null assets!                        |
|   1835 |       11 | `LogMovieScene`                   | b-2026.10.10-15.54.38:7897          | Initializing a legacy player for sequence 'IntroBottomAnim_INST'.                |
|   1113 |       11 | `LogRGIMusic`                     | b-2026.10.10-15.54.38:1271          | URGIMusicSubsystem::Initialize GameInstance[TFTGameInstance_2147482497]          |
|   1066 |       11 | `LogSlate`                        | b-2026.10.10-15.54.38:964           | New Slate User Created. Platform User Id 0, User Index 0, Is Virtual User: 0     |
|    932 |       11 | `LogMetaSound`                    | b-2026.10.10-15.54.38:8077          | A non-zero StartTime (0.04) was used in asset 'MS_sfx_Pet_Fenroar_idle1var3d' th |
|    769 |       11 | `LogRGIFriendsRiotGamesApi`       | b-2026.10.10-15.54.38:7702          | ConvertActivePlatformToFriendsPlatform Active Platform set: ios                  |
|    732 |       11 | `LogD3D12RHI`                     | b-2026.10.10-15.54.38:718           | Found D3D12 adapter 0: NVIDIA GeForce RTX 3050 6GB Laptop GPU (VendorId: 10de, D |
|    645 |       11 | `LogWorld`                        | b-2026.10.10-15.54.38:1306          | BeginTearingDown for /Temp/Untitled_0                                            |
|    621 |       11 | `LogAudioMixer`                   | b-2026.10.10-15.54.38:1235          | Audio Mixer Platform Settings:                                                   |
|    513 |       11 | `LogWindows`                      | b-2026.10.10-15.54.38:712           | Attached monitors:                                                               |
|    468 |       11 | `LogStreaming`                    | b-2026.10.10-15.54.38:1088          | FlushAsyncLoading(1): 1 QueuedPackages, 0 AsyncPackages                          |
|    427 |       11 | `RGIOPHttp`                       | b-2026.10.10-15.54.38:1368          | UTFTCapMissionService::GetPlayerMissions: Query Start                            | POST /missions/public/v1 |
|    306 |       11 | `LogTFTMusic`                     | b-2026.10.10-15.54.38:1380          | UTFTMusicPlayerSubsystem::LoadMusicData - No music asset found for type [1] play |
|    274 |        7 | `LogDataTable`                    | b-2026.10.10-17.05.15:26496         | UDataTable::FindRow : 'Attribute Style Lookup' requested invalid row 'None' from |
|    271 |       11 | `LogDeviceProfileManager`         | b-2026.10.10-15.54.38:764           | Going up to parent DeviceProfile [Windows]                                       |
|    262 |       11 | `LogInit`                         | b-2026.10.10-15.54.38:762           | Selected Device Profile: [WindowsClient]                                         |
|    260 |       11 | `RGIOPRms`                        | b-2026.10.10-15.54.38:7365          | RMS state changed: Disconnected                                                  |
|    211 |       11 | `RGIOPGameSession`                | b-2026.10.10-15.54.38:7248          | Using cluster BR1 for creating a game session                                    |
|    210 |       11 | `LogAudio`                        | b-2026.10.10-15.54.38:1180          | Registering Engine Module Parameter Interfaces...                                |
|    209 |       11 | `LogTextLocalizationResource`     | b-2026.10.10-15.54.38:951           | LocRes '../../../Engine/Content/Localization/Engine/pt/Engine.locres' could not  |
|    207 |       11 | `LogPakFile`                      | b-2026.10.10-15.54.38:1092          | New pak file ../../../TFT/Content/Paks/pakchunk0-WindowsClient.pak added to pak  |
|    187 |       11 | `LogPluginManager`                | b-2026.10.10-15.54.38:2429          | Falha ao carregar o plugin “../../../TFT/Plugins/GameFeatures/BaseMaterial/BaseM |
|    139 |       11 | `LogAudioModulation`              | b-2026.10.10-15.54.38:1170          | Initialized Audio Modulation Parameter 'BitDepth'                                |
|    132 |       11 | `LogIoDispatcher`                 | b-2026.10.10-15.54.38:1389          | Reading toc: ../../../TFT/Content/Paks/pakchunk1-WindowsClient.utoc              |
|    128 |       11 | `LogRGIMetricsTelemetry`          | b-2026.10.10-15.54.38:1272          | URGIMetricsTelemetrySubsystem::Initialize                                        |
|    124 |       11 | `LogNet`                          | b-2026.10.10-15.54.38:1304          | Browse: /Mode_Bootstrap/Bootstrap?Name=Player                                    |
|    115 |       11 | `LogHttp`                         | b-2026.10.10-15.54.38:2539          | 000001B89B3324A0: request failed, libcurl error: 3 (URL using bad/illegal format |
|    110 |       11 | `LogRGIChatRiotGamesApi`          | b-2026.10.10-15.54.38:2618          | [SDK]: Chatbox plugin not ready, reason: [awaitingChatConnection]                |
|    108 |       11 | `LogIris`                         | b-2026.10.10-15.54.38:7540          | Iris ReplicationSystem[0]: ReplicationSystem_2147480930 (0x000001B8A4B65380) is  |
|     94 |       11 | `LogStaticMesh`                   | b-2026.10.10-15.54.38:7744          | [SM_Mesh_TFT18Ahri_Swirl_Adjusted] Mesh is marked for CPU read.                  |
|     88 |       11 | `RGIOPIdentity`                   | b-2026.10.10-15.54.38:5106          | FRE state changed enabled: false, loading: false, required: false                |
|     81 |       11 | `LogRGIOperationalTelemetry`      | b-2026.10.10-15.54.38:1275          | Telemetry enabled for this session                                               |
|     81 |       11 | `RGIOPClientConfig`               | b-2026.10.10-15.54.38:2399          | Subscribed Namespace: lol.client_settings                                        |
|     77 |       11 | `LogMemory`                       | b-2026.10.10-15.54.38:937           | Process is running as part of a Windows Job with separate resource limits        |
|     77 |       11 | `LogViewport`                     | b-2026.10.10-15.54.38:1162          | Player bShowMouseCursor Changed, False -> True                                   |
|     77 |       11 | `OnlineSubsystemRiot`             | b-2026.10.10-15.54.38:1472          | Initializing RiotGamesAPI - valid non dedicated server game world                |
|     77 |       11 | `OnlineIdentityRiot`              | b-2026.10.10-15.54.38:5077          | Logging in. UserNum: 0, type: auto                                               |
|     66 |       11 | `LogFilePackageStore`             | b-2026.10.10-15.54.38:1089          | Updated: NewPackages=735, OldPackages=0, TotalPackages=736                       |
|     66 |       11 | `LogAudioEnumeration`             | b-2026.10.10-15.54.38:1248          | FWindowsMMDeviceCache: Default Render Role='Console', Device='Fones de ouvido (R |
|     66 |       11 | `LogBlueprintUserMessages`        | b-2026.10.10-15.54.38:8396          | [ChronoModule_ScreenSpace_VFX_C_2147453130] X=-2000.000 Y=0.000 Z=1500.000       |
|     62 |       11 | `LogRGIMetricsRegistrySubsystem`  | b-2026.10.10-15.54.38:1270          | URGIMetricsRegistrySubsystem::Initialize                                         |
|     55 |       11 | `LogGlobalStatus`                 | b-2026.10.10-15.54.38:1303          | UEngine::Browse Started Browse: "/Mode_Bootstrap/Bootstrap?Name=Player"          |
|     55 |       11 | `LogLoad`                         | b-2026.10.10-15.54.38:1305          | LoadMap: /Mode_Bootstrap/Bootstrap?Name=Player                                   |
|     45 |        9 | `LogExit`                         | b-2026.10.10-15.54.38:22356         | Name:GameNetDriver Def:GameNetDriver TFTNetDriver_2147480932 shut down           |
|     44 |       11 | `LogSentrySdk`                    | b-2026.10.10-15.54.38:1192          | Sentry plugin auto initialization: true                                          |
|     44 |       11 | `RGIOPAntiAddiction`              | b-2026.10.10-15.54.38:7346          | Subscribed to AntiAddiction policy: playTime                                     |
|     42 |       11 | `LogWindowsTextInputMethodSystem` | b-2026.10.10-15.54.38:960           | Available input methods:                                                         |
|     36 |        9 | `LogRiotGamesApi`                 | b-2026.10.10-15.54.38:22749         | FRiotGamesApiImpl::ShutdownNonblocking: Shutdown Start [2026-10-10T12:54:36.397Z |
|     34 |       11 | `LogNvidiaAftermath`              | b-2026.10.10-15.54.38:989           | Aftermath initialized                                                            |
|     33 |       11 | `LogConsoleManager`               | b-2026.10.10-15.54.38:786           | Setting the console variable 'r.Shadow.RadiusThreshold' with 'SetByScalability'  |
|     33 |       11 | `LogUObjectArray`                 | b-2026.10.10-15.54.38:1186          | 56775 objects as part of root set at end of initial load.                        |
|     31 |       11 | `LogMoviePlayer`                  | b-2026.10.10-15.54.38:1189          | PassLoadingScreenWindowBackToGame failed. No Window                              |
|     29 |       11 | `LogUObjectHash`                  | b-2026.10.10-15.54.38:1311          | Compacting FUObjectHashTables data took 1.77ms                                   |
|     29 |       11 | `LogRiotClientHeartbeat`          | b-2026.10.10-15.54.38:1663          | Product session heartbeat started.                                               |
|     29 |        3 | `LogScript`                       | b-2026.10.10-20.14.57:18913         | Script Msg: Attempted to access index 0 from map 'Keys' of length 0 in '/UI_Shar |
|     22 |       11 | `LogAssetRegistry`                | b-2026.10.10-15.54.38:717           | Premade AssetRegistry loaded from '../../../TFT/AssetRegistry.bin'               |
|     22 |       11 | `LogTextLocalizationManager`      | b-2026.10.10-15.54.38:949           | No specific localization for 'pt_BR' exists, so 'pt-BR' will be used for the lan |
|     22 |       11 | `LogTemp`                         | b-2026.10.10-15.54.38:1037          | Clearing the OS Cache                                                            |
|     22 |       11 | `LogRGIOPEndOfGame`               | b-2026.10.10-15.54.38:1153          | Failed to parse -eogDir command line argument!                                   |
|     22 |       11 | `LogAudioCaptureCore`             | b-2026.10.10-15.54.38:1156          | No Audio Capture implementations found. Audio input will be silent.              |
|     22 |       11 | `LogPackageLocalizationCache`     | b-2026.10.10-15.54.38:1157          | Processed 122 localized package path(s) for 2 prioritized culture(s) in 0.000726 |
|     22 |       11 | `LogStats`                        | b-2026.10.10-15.54.38:1158          | UGameplayTagsManager::InitializeManager - 0.002 s                                |
|     22 |       11 | `LogRGIBuildRecipes`              | b-2026.10.10-15.54.38:1201          | Cooked Package Name: Set18FullPC                                                 |
|     22 |       11 | `LogNetVersion`                   | b-2026.10.10-15.54.38:1229          | Set ProjectVersion to 18.4.0-development. Version Checksum will be recalculated  |
|     22 |       11 | `LogEffectSubsystem`              | b-2026.10.10-15.54.38:1322          | Effect Warming Took 0.00s                                                        |
|     22 |       11 | `LogRGIOPStreamingInstall`        | b-2026.10.10-15.54.38:5010          | No patchsieve releases found, streaming install not available                    |
|     20 |       11 | `LogGauntlet`                     | b-2026.10.10-15.54.38:1169          | Gauntlet Initialized                                                             |
|     20 |       11 | `LogRGIChatUI`                    | b-2026.10.10-15.54.38:7898          | URGIChatMessageInputWidget Failed to to bind focus chatbox, unknown input system |
|     18 |       11 | `LogUObjectGlobals`               | b-2026.10.10-15.54.38:1295          | Falha ao encontrar o objeto 'Object /RGIFriendsRiotUI/UI/BP_RGIFriendsController |
|     18 |        9 | `LogCore`                         | b-2026.10.10-15.54.38:22345         | Engine exit requested (reason: Win RequestExit)                                  |
|     11 |       11 | `LogHAL`                          | b-2026.10.10-15.54.38:763           | Platform has ~ 16 GB [16890322944 / 17179869184 / 16], which maps to Larger [Lar |
|     11 |       11 | `LogSpline`                       | b-2026.10.10-15.54.38:945           | Registered spline type: TypeId=0x54E3AD22, Impl=MultiSpline, Value=Vector        |
|     11 |       11 | `LogWindowsTouchpad`              | b-2026.10.10-15.54.38:963           | CacheForceMaxTouchpadSensitivityMode SetMaxTouchpadSensitivity                   |
|     11 |       11 | `LogVRS`                          | b-2026.10.10-15.54.38:1031          | Current RHI supports per-draw and screenspace Variable Rate Shading              |
|     11 |       11 | `LogRendererCore`                 | b-2026.10.10-15.54.38:1033          | Ray tracing is disabled. Reason: disabled through project setting (r.RayTracing= |
|     11 |       11 | `LogCoreSDKUtils`                 | b-2026.10.10-15.54.38:1182          | CoreSDK Startup: 18.4.0-development (5.7.4-19.2) ++tft+rls-18.4.0 r5663767 (comp |
|     11 |       11 | `LogRGIPatchlineData`             | b-2026.10.10-15.54.38:1183          | Successfully read patchline manifest:                                            |
|     11 |       11 | `LogAndroidPermission`            | b-2026.10.10-15.54.38:1185          | UAndroidPermissionCallbackProxy::GetInstance                                     |
|     11 |       11 | `LogEngine`                       | b-2026.10.10-15.54.38:1190          | Initializing Engine...                                                           |
|     11 |       11 | `LogRGISocialShared`              | b-2026.10.10-15.54.38:1268          | URGISocialSharedNavigationViewModel::SetNavigationPath SetNavigationPath from t  |
|     11 |       11 | `LogRGIFriends`                   | b-2026.10.10-15.54.38:1269          | URGIFriendsCollectionViewModel::InitializeViewModel called but not implemented.  |
|     11 |       11 | `RGIJiraSubmitter`                | b-2026.10.10-15.54.38:1273          | Setting up RGIJiraSubmitter config (Project="TFTBUG")                            |
|     11 |       11 | `LogSubsystemCollection`          | b-2026.10.10-15.54.38:1284          | Failed to initialize subsystem dependency (TFTMobileNotificationSubsystem)       |
|     11 |       11 | `LogRGIFriendsUI`                 | b-2026.10.10-15.54.38:1297          | URGISocialPanelViewModel::SetNavigationPath SetNavigationPath from to            |
|     11 |       11 | `LogGameMode`                     | b-2026.10.10-15.54.38:1320          | FindPlayerStart: PATHS NOT DEFINED or NO PLAYERSTART with positive rating        |
|     11 |       11 | `LogEnhancedInput`                | b-2026.10.10-15.54.38:1321          | Enhanced Input local player subsystem has initialized the user settings!         |
|     11 |       11 | `LogRGIPermissionsRiotGamesApi`   | b-2026.10.10-15.54.38:1654          | Initializing Permissions Subsystem with teamfighttactics, live (BatchedPermissio |
|     11 |       11 | `RGIOPNetworkConnectivity`        | b-2026.10.10-15.54.38:2567          | Received Network Connectivity update. State changed from ('Not Set') to ('Connec |
|     11 |       11 | `LogBlades`                       | b-2026.10.10-15.54.38:2582          | Publishing Content Service URL updated to "https://content.publishing.riotgames. |
|     11 |       11 | `RGIOPGameUpdate`                 | b-2026.10.10-15.54.38:7362          | No Available Update!                                                             |
|     11 |       11 | `RGIOPPayments`                   | b-2026.10.10-15.54.38:7363          | Underlying Payments Api is ready                                                 |
|     11 |       11 | `RGIOPPlayerReporting`            | b-2026.10.10-15.54.38:7364          | ReporterFeedbacks updated with 0 entries                                         |
|     11 |       11 | `RGIOPPlayerPreferences`          | b-2026.10.10-15.54.38:7386          | GetV1Ready request completed. bInIsReady[true]                                   |
|     11 |       11 | `LogPushModel`                    | b-2026.10.10-15.54.38:7547          | PushModel HandleCreation is now disabled                                         |
|     11 |       11 | `PacketHandlerLog`                | b-2026.10.10-15.54.38:7552          | Loaded PacketHandler component: Engine.EngineHandlerComponentFactory (StatelessC |
|     11 |       11 | `LogHandshake`                    | b-2026.10.10-15.54.38:7553          | Stateless Handshake: NetDriverDefinition 'GameNetDriver' CachedClientID: 2       |
|     11 |       11 | `LogOnline`                       | b-2026.10.10-15.54.38:7575          | OSS: Created online subsystem instance for: Riot                                 |
|      9 |        9 | `LogRGITelemetry`                 | b-2026.10.10-15.54.38:22709         | Canceling POST https://data.riotgames.com/collector/v2/events request            |
|      9 |        9 | `LogDemo`                         | b-2026.10.10-15.54.38:22739         | Cleaned up 0 splitscreen connections, owner deletion: enabled                    |
|      9 |        9 | `LogMetasoundGenerator`           | b-2026.10.10-15.54.38:22747         | Cancelling active MetaSound Cache Pool Operator build requests...                |
|      9 |        9 | `LogNFORDenoise`                  | b-2026.10.10-15.54.38:22875         | NFORDenoise function shutting down                                               |
|      8 |        8 | `LogAudioStreamCaching`           | b-2026.10.10-15.54.38:9601          | Audio Stream Cache: Using 2560 of 2560 chunks..                                  |

Categorias que carregam algum dado de partida (todas as outras sao carga de assets, plugins, audio, rede de amigos/chat, telemetria ou GPU):
`TFT` (subsistemas do jogo, ver 5.2), `RGIChrono` (31.729 avisos de sequencias de animacao com id de entidade `TFTCharacter_<id>`, sem dono nem estado),
`LogAbilitySystem` (25.742 avisos `Attempted to remove tag: ...`, sem id de entidade), `LogBlueprintUserMessages`, `LogScript`, `LogIris` (so descritores de
replicacao `TFTTargetData`, `GameplayTagCountContainer`), `LogNet` (`Browse: /Mode_Bootstrap/...`), `RGIOPGameSession` (`Using cluster BR1`),
`LogRiotGamesApi/RGIOP*` (SDK de conta, chat, parties, telemetria, client-config).

### 5.2 Subsistemas dentro da categoria `TFT` (contagem nos 11 arquivos; mesma passada de 2026-10-10 18:30)

|            Linhas | Subsistema                                                                                                                                                                                                                                                                                                                                                                           | O que registra                                                                                                                                                                        |
| ----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|             2.670 | `TFTCursorSubsystem`                                                                                                                                                                                                                                                                                                                                                                 | troca de estilo do cursor: `Default` 1.321 / `Drag` 1.310 (um `Drag` = unidade/chave pega para arrastar; igual para mover e vender)                                                   |
|             1.540 | `TFTAudioEventSubsystem`                                                                                                                                                                                                                                                                                                                                                             | so voz: `Unit.Purchase` 471, `Unit.Spell` 902, `Army.Round.UnitCombatVictory` 156, `StarUp.2Star` 123, `StarUp.3Star` 11 (secao 5.3)                                                  |
|             1.300 | `TFTViewSubsystem`                                                                                                                                                                                                                                                                                                                                                                   | `ViewState[...] missing ViewData` (`Shop.Selling` 1.087, `FightButton` 61, `Shop.Buying` 10, `Rounds.Phases.Combat` 1) e `GlobalViewModel ... already created`                        |
|               918 | `TFTPerformanceSubsystem`                                                                                                                                                                                                                                                                                                                                                            | coleta de lixo; `Scheduled phase garbage collection ... Phase[ETFTPhaseType::CombatDeparture                                                                                          | PlanningDeparture                                                                                                                                      | DraftDeparture]` 247/186/45 (fases so quando a GC cai nelas) |
|               755 | `TFTChronoSubsystem`                                                                                                                                                                                                                                                                                                                                                                 | `Chrono has pool-incompatible chrono module: [...] in [CD_...]` (nome de sequencia de animacao; inclui `CD_MapBehavior_WinstreakN`, `LossStreakN`, mas sem o numero atual do jogador) |
|               699 | `TFTDragSubsystem`                                                                                                                                                                                                                                                                                                                                                                   | `IsDragDropCompatible ... Dropped[BP_DefaultBench_C_1_Slot_<l>x<c>                                                                                                                    | BP_DefaultBoard_C_0_Slot_<l>x<c>] blocked by DraggedTag[...]` (so recusados: 377 chave de armario no tabuleiro, 322 unidade "so tabuleiro" na reserva) |
|               550 | `TFTTooltipSubsystem`                                                                                                                                                                                                                                                                                                                                                                | registro de provedores de tooltip (`TFTShopPlayerSubsystem` -> `TFTShopBuyExpTooltipViewModel`, `TFTArmyIncomeTooltipViewModel`) so no carregamento                                   |
|               479 | `TFTWorldContext`                                                                                                                                                                                                                                                                                                                                                                    | aviso `created with invalid world`                                                                                                                                                    |
|               473 | `Garbage collection started...`                                                                                                                                                                                                                                                                                                                                                      | tempo desde a ultima GC                                                                                                                                                               |
|               308 | `Store ...`                                                                                                                                                                                                                                                                                                                                                                          | carregamento de assets de loja de cosmeticos                                                                                                                                          |
|         303 / 238 | `TFTCutsceneAnimClip_C`, `TFTChronoModuleFacing`                                                                                                                                                                                                                                                                                                                                     | avisos de animacao                                                                                                                                                                    |
|               286 | `TFTPatchingSubsystem`                                                                                                                                                                                                                                                                                                                                                               | instalacao em streaming                                                                                                                                                               |
|               275 | `TFTNiagaraSubsystem`                                                                                                                                                                                                                                                                                                                                                                | `Failed to find ComponentTag matching Request[... ComponentTag[IdleGold] ...]` (gold = **efeito visual** de cosmetico)                                                                |
|               189 | `TFTCharmSubsystem`                                                                                                                                                                                                                                                                                                                                                                  | `GetActiveCharmsForArmy found invalid charms in army charm data for army [TFTArmy_<id> {DA_DefaultPlayerArmy_18}]`                                                                    |
|               183 | `TFTPlayerAFKSubsystem`                                                                                                                                                                                                                                                                                                                                                              | `Updated player AFK - PlayerState[TFTPlayerState_<n>] PlayerName[...] bNewIsAFK[0/1]` (unica fonte de nomes de rivais no log; so quando mudam de estado AFK)                          |
|               172 | `TFTRoundSubsystem`                                                                                                                                                                                                                                                                                                                                                                  | 186 `NextOpponentDetermined skipped, unresolved opponent ParticipantId[N]` (aviso: o adversario ainda nao esta resolvido; nao diz quem)                                               |
|               143 | `TFTUpgradeSubsystem`                                                                                                                                                                                                                                                                                                                                                                | registro de "upgrades" de dados (assets)                                                                                                                                              |
|               110 | `BP_Mode_Bootstrap_C`; 110 `Applied CVar change Source[ClientConfig]`                                                                                                                                                                                                                                                                                                                | modo de jogo e CVars vindas do servidor (Niagara, GPU)                                                                                                                                |
| 88 / 86 / 77 / 74 | `TFTServicesSubsystem`, `TFTLoadingSubsystem`, `TFTSessionStateService`, `TFTLobbySubsystem`                                                                                                                                                                                                                                                                                         | servicos de conta, carregamento, sessao (token redigido), `Entering LobbyState[ETFTLobbyState::InGame]`                                                                               |
|                84 | `TFTAugmentPlayerSubsystem`                                                                                                                                                                                                                                                                                                                                                          | `Augment choice lifecycle Event[InitializeSubsystem                                                                                                                                   | BeginGame                                                                                                                                              | EndGame                                                      | DeinitializeSubsystem] ... ChoiceCount[0] ReceivedChoices[0]` (campos de ciclo de vida; **ChoiceCount sempre 0** nas amostras) |
|           67 / 60 | `TFTPlannerSubsystem`, `TFTWebSubsystem`                                                                                                                                                                                                                                                                                                                                             | Team Planner; ligacoes web do menu                                                                                                                                                    |
|                56 | `TFTEncounterSubsystem`                                                                                                                                                                                                                                                                                                                                                              | zoom de introducao dos encontros PVE                                                                                                                                                  |
|                37 | `TFTHextechSubsystem`                                                                                                                                                                                                                                                                                                                                                                | `LCU configured at Port[N]`, `Successfully posted EOG stats block / gameflow event / early-exit to League Client`                                                                     |
|                26 | `BP_MatchGameState_C`                                                                                                                                                                                                                                                                                                                                                                | `Successfully connected to Global chat room for Game[N]`; `MatchId replicated to client MatchId[<uuid>]`                                                                              |
|                22 | `TFTShopPlayerSubsystem`                                                                                                                                                                                                                                                                                                                                                             | so `TrySetupShop failed to resolve the Army ASC` e `TrySetupShop did not complete from BeginGame`, na fase de menu (Army[None])                                                       |
|                22 | `TFTTelemetrySubsystem`; `TFTGameInstance`; `TFTChatSubsystem`; `TFTLoadTimelineSubsystem`                                                                                                                                                                                                                                                                                           | telemetria (`No config value found for tft.client_settings.telemetry.sampling_rates_by_name`), instancia, chat, linha do tempo de carga (`GameMode[Match] Reconnect[0]`)              |
|      17 / 16 / 11 | `TFTScoreboardSubsystem`, `TFTProjectileSubsystem`, `TFTTopCeremonySubsystem`                                                                                                                                                                                                                                                                                                        | `Scoreboard replication recovery: ... MissingArmies[1]` (existe um **placar replicado** no cliente, mas o log nao despeja os valores), cerimonias                                     |
|           11 cada | `TFTTacticianSubsystem`, `TFTTacticianFinisherSubsystem`, `TFTSettingsSubsystem`, `TFTPlayerModerationSubsystem`, `TFTPauseSubsystem`, `TFTOfflinePlayerController`, `TFTNetworkConnectivitySubsystem`, `TFTMenuSubsystem`, `TFTInputSubsystem`, `TFTDeviceSubsystem`, `TFTCosmeticSubsystem`, `TFTCarouselSubsystem` (`Carousel subsystem disabled by config`), `TFTAudioSubsystem` | inicializacao                                                                                                                                                                         |
|              < 10 | `TFTCombatRecapSubsystem` (`SendCombatRecapEvent doesn't have a valid player/opponent army`), `TFTCharacter_<id>` (avisos de malha), `TFTArena`, `TFTTacticianPedestalSubsystem`, `TFTGsmService`, `TFTMatchPlayerController`, `TFTNetConnection`                                                                                                                                    | pontuais                                                                                                                                                                              |

Nenhum subsistema se chama economia, nivel, XP, inventario, banco, loja-do-jogador (alem de `TFTShopPlayerSubsystem`, que so aparece no menu) ou reserva.

### 5.3 Todos os eventos de audio logados

`Trigger[Audio.Event.*]` / `Event[Audio.Event.*]` (varridos nos 11 arquivos): somente `VO.Unit.Spell` (902), `VO.Unit.Purchase` (471),
`VO.Army.Round.UnitCombatVictory` (156), `VO.Unit.StarUp.2Star` (123), `VO.Unit.StarUp.3Star` (11). Os 7 assets `MetaSound` que avisam sao todos `MS_sfx_Pet_*`.
Nao ha evento de audio de venda, rolagem, nivel, ouro, moeda, XP ou loja.

### 5.4 Eventos "de economia" que NAO sao economia (para nao serem confundidos de novo)

- `ViewState[ViewState.Playing.Shop.Selling] missing ViewData` (1.087): disparado ao pegar uma unidade para arrastar (100% dentro de 300 ms de um `Cursor style changed Style[ETFTCursorStyle::Drag]`; medicao ja registrada em `FONTES-DE-DADOS.md`, nao refeita aqui); **nao** e venda.
- `ViewState[ViewState.Playing.Shop.Buying]` (10 no total; 1 em cada uma das 2 partidas conferidas) e `FightButton` (61): erros de configuracao de interface na primeira transicao; **nao** contam compras (a compra e a voz).
- `TFTTooltipSubsystem: Provider[TFTShopPlayerSubsystem] registered for ViewModel[TFTShopBuyExpTooltipViewModel]` e `TFTArmyIncomeTooltipViewModel`: registros de tooltip no carregamento; **sem valores**.
- `CD_MapBehavior_Winstreak*/LossStreak*`, `CD_TFT_GoldMine_Skin9_GainGold`, `CD_CoinFlip18_*`: nomes de sequencias de animacao (cosmeticos e mecanicas do set), sem numero.
- `NSU_TFT_Unit_Combine_Disappear` (1.660 avisos Niagara) e `NS_TFT_UnitCombination_Ceremony` (112): efeitos visuais de fusao; aparecem so nos avisos de Niagara, sem id de entidade confiavel; a voz `StarUp` ja cobre.
- `ItemFlyToBench_INST` (LogMovieScene): animacao de um item indo ao banco, sem dizer qual.
- `xp` com 25.675 ocorrencias: palavra "explicitly".

## 6. Listagem de arquivos

Listagens completas (nome, tamanho em bytes, mtime UTC), uma por raiz, em `tft/helper/pesquisa/varredura-listagens/*.tsv`: `localTFT`,
`localRiot`, `progdata`, `rgTFT`, `rgClient`, `lolLogs`, `lolConfig`, `lolSaved`, `lolReplays` (vazia: pasta inexistente), `lolPlugins`, `roaming_Riot_Client`,
`roaming_riot-client-ux`, `roaming_MetaTFT_Standalone`, `roaming_TFTAcademy`, `docs_League_of_Legends` (vazia).
`Content/Paks` do TFT foi pulado (`SKIPDIR`, como combinado).

### 6.1 Resumo por pasta

| Pasta                                                                        | Arquivos |   Tamanho | Mais recente (UTC) |
| ---------------------------------------------------------------------------- | -------: | --------: | ------------------ |
| `%APPDATA%/MetaTFT Standalone`                                               |        7 |   40.9 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Cache/Cache_Data`                              |      398 |   88.7 MB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Cache/No_Vary_Search`                          |        2 |      24 B | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Code Cache/js`                                 |        1 |      24 B | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Code Cache/js/index-dir`                       |        1 |      48 B | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Code Cache/wasm`                               |        1 |      24 B | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Code Cache/wasm/index-dir`                     |        1 |      48 B | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/DawnGraphiteCache`                             |        5 |  544.4 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/DawnWebGPUCache`                               |        5 |  544.4 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/GPUCache`                                      |        5 |    5.6 MB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/IndexedDB/metatft_app_0.indexeddb.leveldb`     |        5 |    4.8 KB | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Local Storage/leveldb`                         |        6 |   56.1 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Network`                                       |        7 |  154.2 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__`                          |        3 |   40.1 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/Cache`                    |        8 |    2.3 MB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/Code Cache`               |        4 |     144 B | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/DawnGraphiteCache`        |        5 |  544.4 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/DawnWebGPUCache`          |        5 |  544.4 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/GPUCache`                 |        5 |  544.4 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/Local Storage`            |        5 |   11.6 KB | 2026-10-10 03:00   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/Network`                  |        7 |   56.6 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/Session Storage`          |        5 |     415 B | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/Shared Dictionary`        |        4 |   44.1 KB | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Session Storage`                               |        5 |   13.2 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/Shared Dictionary`                             |        2 |   44.0 KB | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Shared Dictionary/cache`                       |        1 |      24 B | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/Shared Dictionary/cache/index-dir`             |        1 |      48 B | 2026-10-10 02:58   |
| `%APPDATA%/MetaTFT Standalone/VideoDecodeStats`                              |        2 |       0 B | 2026-10-10 02:59   |
| `%APPDATA%/MetaTFT Standalone/WebStorage`                                    |        2 |   40.0 KB | 2026-10-10 02:59   |
| `%APPDATA%/MetaTFT Standalone/shared_proto_db`                               |        5 |    1.4 KB | 2026-10-10 03:02   |
| `%APPDATA%/MetaTFT Standalone/shared_proto_db/metadata`                      |        5 |     456 B | 2026-10-10 02:59   |
| `%APPDATA%/Riot Client`                                                      |        3 |    1.5 KB | 2026-10-10 15:17   |
| `%APPDATA%/Riot Client/Cache/Cache_Data`                                     |      259 |  274.0 MB | 2026-10-10 21:42   |
| `%APPDATA%/Riot Client/Code Cache/js`                                        |       36 |   42.2 KB | 2026-10-10 15:16   |
| `%APPDATA%/Riot Client/Code Cache/js/index-dir`                              |        1 |     888 B | 2026-10-10 15:17   |
| `%APPDATA%/Riot Client/Code Cache/wasm`                                      |        1 |      24 B | 2026-09-22 01:34   |
| `%APPDATA%/Riot Client/Code Cache/wasm/index-dir`                            |        1 |      48 B | 2026-09-22 01:34   |
| `%APPDATA%/Riot Client/DawnCache`                                            |        5 |  544.4 KB | 2026-10-10 21:42   |
| `%APPDATA%/Riot Client/GPUCache`                                             |        5 |  544.4 KB | 2026-10-10 21:42   |
| `%APPDATA%/Riot Client/Local Storage/leveldb`                                |        7 |   38.9 KB | 2026-10-10 21:32   |
| `%APPDATA%/Riot Client/Network`                                              |        5 |   26.2 KB | 2026-10-10 21:32   |
| `%APPDATA%/Riot Client/Session Storage`                                      |        6 |    2.6 KB | 2026-10-10 15:16   |
| `%APPDATA%/Riot Client/VideoDecodeStats`                                     |        3 |       0 B | 2026-10-10 15:54   |
| `%APPDATA%/Riot Client/WebStorage`                                           |        2 |   44.0 KB | 2026-09-22 01:34   |
| `%APPDATA%/Riot Client/databases`                                            |        2 |   28.0 KB | 2026-09-22 01:34   |
| `%APPDATA%/Riot Client/shared_proto_db`                                      |        6 |    4.8 KB | 2026-10-10 17:09   |
| `%APPDATA%/Riot Client/shared_proto_db/metadata`                             |        6 |     984 B | 2026-10-10 15:54   |
| `%APPDATA%/TFTAcademy`                                                       |       10 |  252.6 KB | 2026-10-08 22:46   |
| `%APPDATA%/TFTAcademy/Cache/Cache_Data`                                      |      117 |   23.7 MB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Cache/No_Vary_Search`                                  |        2 |      24 B | 2026-09-11 22:41   |
| `%APPDATA%/TFTAcademy/Code Cache/js`                                         |        3 |     529 B | 2026-09-11 22:43   |
| `%APPDATA%/TFTAcademy/Code Cache/js/index-dir`                               |        1 |      96 B | 2026-09-11 22:43   |
| `%APPDATA%/TFTAcademy/Code Cache/wasm`                                       |        1 |      24 B | 2026-09-11 22:41   |
| `%APPDATA%/TFTAcademy/Code Cache/wasm/index-dir`                             |        1 |      48 B | 2026-09-11 22:41   |
| `%APPDATA%/TFTAcademy/DawnGraphiteCache`                                     |        5 |  544.4 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/DawnWebGPUCache`                                       |        5 |  544.4 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/GPUCache`                                              |        5 |    1.6 MB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Local Storage/leveldb`                                 |        7 |   82.7 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Network`                                               |        7 |  153.8 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__`                                  |        3 |   40.1 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/Cache`                            |        8 |    2.3 MB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/Code Cache`                       |        4 |     144 B | 2026-09-11 22:41   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/DawnGraphiteCache`                |        5 |  544.4 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/DawnWebGPUCache`                  |        5 |  544.4 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/GPUCache`                         |        5 |  544.4 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/Local Storage`                    |        5 |   11.4 KB | 2026-09-11 22:46   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/Network`                          |        7 |   56.2 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/Session Storage`                  |        5 |     399 B | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Partitions/__owepm__/Shared Dictionary`                |        4 |   44.1 KB | 2026-09-11 22:41   |
| `%APPDATA%/TFTAcademy/Session Storage`                                       |        5 |   31.0 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/Shared Dictionary`                                     |        2 |   44.0 KB | 2026-09-11 22:41   |
| `%APPDATA%/TFTAcademy/Shared Dictionary/cache`                               |        1 |      24 B | 2026-09-11 22:41   |
| `%APPDATA%/TFTAcademy/Shared Dictionary/cache/index-dir`                     |        1 |      48 B | 2026-09-11 22:41   |
| `%APPDATA%/TFTAcademy/VideoDecodeStats`                                      |        2 |       0 B | 2026-09-11 22:43   |
| `%APPDATA%/TFTAcademy/WebStorage`                                            |        2 |   40.0 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/logs`                                                  |        1 |  124.6 KB | 2026-09-11 22:49   |
| `%APPDATA%/TFTAcademy/shared_proto_db`                                       |        5 |     551 B | 2026-09-11 22:45   |
| `%APPDATA%/TFTAcademy/shared_proto_db/metadata`                              |        5 |     440 B | 2026-09-11 22:43   |
| `%APPDATA%/TFTAcademy/tft-recordings`                                        |        1 |   65.8 MB | 2026-09-11 22:50   |
| `%APPDATA%/riot-client-ux`                                                   |        1 |       2 B | 2026-10-10 15:16   |
| `%APPDATA%/riot-client-ux/Crashpad`                                          |        2 |      40 B | 2026-10-10 15:26   |
| `%APPDATA%/riot-client-ux/logs`                                              |        1 |    1.7 KB | 2026-10-10 15:16   |
| `%APPDATA%/riot-client-ux/sentry`                                            |        2 |   18.9 KB | 2026-10-10 21:43   |
| `%APPDATA%/riot-client-ux/sentry/queue`                                      |        1 |       2 B | 2026-10-10 15:16   |
| `%LOCALAPPDATA%/Riot Games/Install 2XKO/Logs/Agent`                          |        2 |    4.8 KB | 2026-09-27 18:16   |
| `%LOCALAPPDATA%/Riot Games/Install 2XKO/Logs/Launcher`                       |        1 |   11.3 KB | 2026-09-27 18:16   |
| `%LOCALAPPDATA%/Riot Games/Install League of Legends br/Logs/Agent`          |        2 |    6.3 KB | 2026-09-22 01:36   |
| `%LOCALAPPDATA%/Riot Games/Install League of Legends br/Logs/Launcher`       |        1 |  174.1 KB | 2026-09-22 01:34   |
| `%LOCALAPPDATA%/Riot Games/League of Legends/Config`                         |        2 |    5.5 MB | 2026-10-10 21:10   |
| `%LOCALAPPDATA%/Riot Games/League of Legends/Data`                           |        2 |    1.5 KB | 2026-10-10 15:17   |
| `%LOCALAPPDATA%/Riot Games/League of Legends/HttpCache`                      |        2 |   11.5 KB | 2026-10-10 15:17   |
| `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClient/Crashes`           |        8 |    1015 B | 2026-10-10 15:17   |
| `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClientUx/Crashes`         |       24 |       0 B | 2026-10-10 15:17   |
| `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClientUxHelper/Crashes`   |      204 |       0 B | 2026-10-10 15:19   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Config`                               |        3 |   12.6 MB | 2026-10-10 21:18   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client`                  |       12 |    2.0 KB | 2026-10-10 15:16   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Data`                                 |        1 |    3.6 KB | 2026-10-10 21:09   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Data/Sessions`                        |       23 |    3.0 KB | 2026-10-10 21:43   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/HttpCache`                            |        8 |  329.3 KB | 2026-10-10 15:16   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Agent`                           |        3 |    8.4 KB | 2026-10-09 12:52   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Launcher`                        |        9 |   91.2 KB | 2026-10-10 15:16   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Electron Logs`       |        8 |   38.9 KB | 2026-10-10 15:16   |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Logs`                |       19 |    9.4 MB | 2026-10-10 21:43   |
| `%LOCALAPPDATA%/Riot Games/Riot Vanguard`                                    |        2 |    1.8 KB | 2026-10-10 15:17   |
| `%LOCALAPPDATA%/Riot Games/Teamfight Tactics/Config`                         |        2 |    9.3 MB | 2026-10-10 21:34   |
| `%LOCALAPPDATA%/Riot Games/Teamfight Tactics/Data`                           |        1 |       4 B | 2026-10-10 21:33   |
| `%LOCALAPPDATA%/Riot Games/Teamfight Tactics/HttpCache`                      |        7 |  326.8 KB | 2026-10-10 21:34   |
| `%LOCALAPPDATA%/TFT/.sentry-native`                                          |        3 |      56 B | 2026-10-10 21:33   |
| `%LOCALAPPDATA%/TFT/.sentry-native/4ec301bb-2716-43aa-d112-2b613e777e88.run` |        4 |   54.1 KB | 2026-10-10 21:43   |
| `%LOCALAPPDATA%/TFT/Saved`                                                   |        1 |    1.8 MB | 2026-10-10 21:29   |
| `%LOCALAPPDATA%/TFT/Saved/Config/CrashReportClient`                          |       34 |    9.1 KB | 2026-10-10 21:33   |
| `%LOCALAPPDATA%/TFT/Saved/Config/WindowsClient`                              |        2 |    3.2 KB | 2026-10-10 21:36   |
| `%LOCALAPPDATA%/TFT/Saved/Logs`                                              |       15 |   47.4 MB | 2026-10-10 21:43   |
| `%LOCALAPPDATA%/TFT/Saved/SaveGames`                                         |        1 |    2.2 KB | 2026-10-10 21:36   |
| `%PROGRAMDATA%/Riot Games`                                                   |        2 |     431 B | 2026-10-10 15:17   |
| `%PROGRAMDATA%/Riot Games/Metadata/Riot Client`                              |        6 |  203.6 KB | 2026-10-08 12:19   |
| `%PROGRAMDATA%/Riot Games/Metadata/bacon.live`                               |        2 |   52.9 KB | 2026-10-08 21:20   |
| `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live`                   |        8 |    7.7 MB | 2026-10-10 15:17   |
| `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live.game_patch`        |        1 |       0 B | 2026-09-22 01:34   |
| `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.pbe`                    |        2 |     328 B | 2026-10-10 15:16   |
| `%PROGRAMDATA%/Riot Games/Metadata/lion.live`                                |        7 |    3.9 MB | 2026-10-10 15:16   |
| `%PROGRAMDATA%/Riot Games/Metadata/teamfighttactics.live`                    |        6 |    1.2 MB | 2026-10-10 21:34   |
| `%PROGRAMDATA%/Riot Games/Metadata/teamfighttactics.pbe`                     |        2 |     694 B | 2026-10-10 15:16   |
| `%PROGRAMDATA%/Riot Games/Metadata/valorant.live`                            |        2 |   16.0 MB | 2026-10-08 21:20   |
| ``                                                                           |        1 |     NaN B | C:/Riot Games/Le   |
| `RG/League of Legends/Config`                                                |       11 |  142.9 KB | 2026-10-10 21:43   |
| `RG/League of Legends/Config/Global`                                         |        1 |     226 B | 2026-10-08 22:24   |
| `RG/League of Legends/Logs/LeagueClient Logs`                                |       38 |   91.6 MB | 2026-10-10 21:44   |
| `RG/League of Legends/Plugins`                                               |        1 |   23.8 KB | 2026-10-08 21:20   |
| `RG/League of Legends/Plugins/rcp-be-lol-game-data`                          |        4 | 6134.4 MB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-be-lol-license-agreement`                  |        1 |  382.6 KB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-be-sanitizer`                              |        1 |  569.0 KB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-fe-audio`                                  |        2 |   51.4 KB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-fe-common-libs`                            |        2 |  346.0 KB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-fe-ember-libs`                             |        2 |  445.4 KB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-fe-lol-champ-select`                       |        2 |   63.5 MB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-fe-lol-champion-details`                   |        2 |   19.6 MB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-fe-lol-champion-statistics`                |        2 |   11.5 KB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-fe-lol-clash`                              |        2 |   90.5 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-collections`                        |        2 |  112.6 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-esports-spectate`                   |        2 |  220.0 KB | 2026-10-08 21:26   |
| `RG/League of Legends/Plugins/rcp-fe-lol-event-hub`                          |        2 |   15.9 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-highlights`                         |        2 |  167.4 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-jade`                               |        2 |   99.2 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-kickout`                            |        2 |    9.8 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-l10n`                               |        2 |  578.2 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-leagues`                            |        2 |   10.6 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-lock-and-load`                      |        2 |    9.8 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-loot`                               |        2 |  102.6 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-match-history`                      |        2 |    1.9 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-navigation`                         |        2 |   50.3 MB | 2026-10-10 04:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-new-player-experience`              |        2 |    9.3 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-objectives`                         |        2 |    2.7 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-parties`                            |        2 |   16.9 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-paw`                                |        2 |    1.7 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-pft`                                |        2 |   33.8 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-postgame`                           |        2 |    8.4 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-premade-voice`                      |        2 |  537.8 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-profiles`                           |        2 |    1.6 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-settings`                           |        2 |  431.6 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-shared-components`                  |        2 |   22.8 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-skins-picker`                       |        2 |   81.3 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-social`                             |        2 |    3.8 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-static-assets`                      |        2 |  252.2 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-store`                              |        2 |    2.5 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-tft`                                |        2 |   26.0 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-tft-promethium`                     |        2 |    4.9 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-tft-team-planner`                   |        2 |  753.8 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-tft-troves`                         |        2 |   17.9 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-typekit`                            |        2 |  857.7 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-uikit`                              |        2 |    5.1 MB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-lol-yourshop`                           |        2 |   73.3 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-plugin-runner`                          |        2 |   37.9 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Plugins/rcp-fe-tft`                                    |        2 |  179.2 KB | 2026-10-08 21:27   |
| `RG/League of Legends/Saved/webcache`                                        |      250 |   37.8 MB | 2026-10-10 21:43   |
| `RG/Riot Client`                                                             |        9 |  154.6 MB | 2026-10-08 12:19   |
| `RG/Riot Client/Krisp`                                                       |        9 |   81.4 MB | 2026-09-22 01:33   |
| `RG/Riot Client/Resources`                                                   |        1 |  278.8 KB | 2026-09-22 01:33   |
| `RG/Riot Client/RiotClientElectron`                                          |       16 |  195.1 MB | 2026-10-08 12:19   |
| `RG/Riot Client/RiotClientElectron/locales`                                  |       55 |   26.3 MB | 2026-09-22 01:33   |
| `RG/Riot Client/RiotClientElectron/resources`                                |       38 |  246.9 MB | 2026-10-08 12:19   |
| `RG/Teamfight Tactics/Live`                                                  |        1 |  258.9 KB | 2026-10-08 21:34   |
| `RG/Teamfight Tactics/Live/CoreSDK`                                          |        4 |    8.1 MB | 2026-10-08 21:27   |
| `RG/Teamfight Tactics/Live/Engine`                                           |       85 |  355.4 MB | 2026-10-08 21:28   |
| `RG/Teamfight Tactics/Live/TFT`                                              |       65 |  288.1 MB | 2026-10-08 21:28   |

### 6.2 Arquivos modificados nas ultimas 48 horas

Arquivos modificados nas ultimas 48 h (referencia: 2026-10-10 ~19:00 local): 1186 no total; 228 listados abaixo; 958 agrupados como cache/binario/ruido (contagem por pasta ao final).

|  Tamanho | mtime (UTC)         | Arquivo                                                                                                                          |
| -------: | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
|   9.1 MB | 2026-10-10 21:44:00 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-10T12-17-12_36936_LeagueClient.log`                                         |
|   1.3 MB | 2026-10-10 21:43:58 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT.log`                                                                                          |
|  24.4 KB | 2026-10-10 21:43:58 | `%LOCALAPPDATA%/TFT/.sentry-native/4ec301bb-2716-43aa-d112-2b613e777e88.run/__sentry-breadcrumb2`                                |
|   4.0 MB | 2026-10-10 21:43:49 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Logs/2026-10-09T17-23-19_28272_Riot Client.log`                          |
|      0 B | 2026-10-10 21:43:44 | `RG/League of Legends/Saved/webcache/Network/Cookies-journal`                                                                    |
|  20.0 KB | 2026-10-10 21:43:44 | `RG/League of Legends/Saved/webcache/Network/Cookies`                                                                            |
|   1.4 KB | 2026-10-10 21:43:43 | `RG/League of Legends/Config/LeagueClientSettings.yaml`                                                                          |
|   3.8 KB | 2026-10-10 21:43:33 | `%LOCALAPPDATA%/TFT/.sentry-native/4ec301bb-2716-43aa-d112-2b613e777e88.run/__sentry-event`                                      |
| 584.3 KB | 2026-10-10 21:43:15 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-10T12-17-12_36936_23568_LeagueClientUx.log`                                 |
|    306 B | 2026-10-10 21:43:03 | `%APPDATA%/riot-client-ux/sentry/session.json`                                                                                   |
|  18.6 KB | 2026-10-10 21:42:57 | `%APPDATA%/riot-client-ux/sentry/scope_v3.json`                                                                                  |
|   7.5 KB | 2026-10-10 21:42:56 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFTEoGStats.json`                                                                                 |
|  25.6 KB | 2026-10-10 21:42:41 | `%LOCALAPPDATA%/TFT/.sentry-native/4ec301bb-2716-43aa-d112-2b613e777e88.run/__sentry-breadcrumb1`                                |
|   3.1 KB | 2026-10-10 21:36:08 | `%LOCALAPPDATA%/TFT/Saved/Config/WindowsClient/GameUserSettings.ini`                                                             |
|   2.2 KB | 2026-10-10 21:36:08 | `%LOCALAPPDATA%/TFT/Saved/SaveGames/EnhancedInputUserSettings.sav`                                                               |
|  11.1 KB | 2026-10-10 21:34:33 | `RG/League of Legends/Config/LCUAccountPreferences.yaml`                                                                         |
|    112 B | 2026-10-10 21:34:06 | `%LOCALAPPDATA%/TFT/Saved/Config/WindowsClient/Engine.ini`                                                                       |
|    229 B | 2026-10-10 21:34:06 | `%LOCALAPPDATA%/TFT/.sentry-native/4ec301bb-2716-43aa-d112-2b613e777e88.run/session.json`                                        |
|    688 B | 2026-10-10 21:34:03 | `%LOCALAPPDATA%/Riot Games/Teamfight Tactics/Config/RiotClientSettings.yaml`                                                     |
|   9.3 MB | 2026-10-10 21:34:03 | `%LOCALAPPDATA%/Riot Games/Teamfight Tactics/Config/ClientConfiguration.json`                                                    |
|    899 B | 2026-10-10 21:34:02 | `%PROGRAMDATA%/Riot Games/Metadata/teamfighttactics.live/teamfighttactics.live.product_settings.yaml`                            |
|      4 B | 2026-10-10 21:33:58 | `%LOCALAPPDATA%/Riot Games/Teamfight Tactics/Data/RiotGamesPrivateSettings.yaml`                                                 |
|      0 B | 2026-10-10 21:33:57 | `%LOCALAPPDATA%/TFT/.sentry-native/4ec301bb-2716-43aa-d112-2b613e777e88.run.lock`                                                |
|     40 B | 2026-10-10 21:33:57 | `%LOCALAPPDATA%/TFT/.sentry-native/settings.dat`                                                                                 |
|  14.5 KB | 2026-10-10 21:33:34 | `RG/League of Legends/Saved/webcache/shared_proto_db/000003.log`                                                                 |
|   9.4 KB | 2026-10-10 21:33:29 | `RG/League of Legends/Config/PerksPreferences.yaml`                                                                              |
|      0 B | 2026-10-10 21:32:45 | `%APPDATA%/Riot Client/Network/Cookies-journal`                                                                                  |
|  20.0 KB | 2026-10-10 21:32:45 | `%APPDATA%/Riot Client/Network/Cookies`                                                                                          |
|   4.0 KB | 2026-10-10 21:32:35 | `%APPDATA%/Riot Client/Network/Network Persistent State`                                                                         |
|   2.2 KB | 2026-10-10 21:32:26 | `%APPDATA%/Riot Client/Network/TransportSecurity`                                                                                |
|  15.4 KB | 2026-10-10 21:32:20 | `%APPDATA%/Riot Client/Local Storage/leveldb/000004.log`                                                                         |
|  57.2 KB | 2026-10-10 21:31:09 | `RG/League of Legends/Config/PersistedSettings.json`                                                                             |
|  11.7 MB | 2026-10-10 21:29:16 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-21.29.16.log`                                                               |
|   1.8 MB | 2026-10-10 21:29:11 | `%LOCALAPPDATA%/TFT/Saved/TFT_PCD3D_SM5.upipelinecache`                                                                          |
|  24.5 KB | 2026-10-10 21:29:06 | `RG/League of Legends/Config/TFTTeamPlansPreferences.yaml`                                                                       |
|  24.0 MB | 2026-10-10 21:28:10 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-10T12-17-12_36936_LeagueClient-tracing.json`                                |
|  12.6 MB | 2026-10-10 21:18:31 | `%LOCALAPPDATA%/Riot Games/Riot Client/Config/ClientConfiguration.json`                                                          |
|   5.5 MB | 2026-10-10 21:10:42 | `%LOCALAPPDATA%/Riot Games/League of Legends/Config/ClientConfiguration.json`                                                    |
|   3.3 KB | 2026-10-10 21:09:34 | `%LOCALAPPDATA%/Riot Games/Riot Client/Config/RiotClientSettings.yaml`                                                           |
|   3.6 KB | 2026-10-10 21:09:32 | `%LOCALAPPDATA%/Riot Games/Riot Client/Data/RiotGamesPrivateSettings.yaml`                                                       |
|   4.4 MB | 2026-10-10 20:51:27 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-20.51.27.log`                                                               |
|    657 B | 2026-10-10 20:18:43 | `RG/League of Legends/Saved/webcache/LocalPrefs.json`                                                                            |
|   3.1 MB | 2026-10-10 20:14:57 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-20.14.57.log`                                                               |
|   2.5 MB | 2026-10-10 18:50:01 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-18.50.01.log`                                                               |
|   7.9 MB | 2026-10-10 18:16:45 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-18.16.45.log`                                                               |
|    302 B | 2026-10-10 18:06:29 | `%LOCALAPPDATA%/Riot Games/League of Legends/Config/RiotClientSettings.yaml`                                                     |
|   2.3 MB | 2026-10-10 17:42:01 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-17.42.01.log`                                                               |
|   4.2 KB | 2026-10-10 17:09:16 | `%APPDATA%/Riot Client/shared_proto_db/000003.log`                                                                               |
|   6.7 MB | 2026-10-10 17:05:15 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-17.05.15.log`                                                               |
|   1.5 MB | 2026-10-10 16:25:41 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-16.25.41.log`                                                               |
|     16 B | 2026-10-10 16:18:25 | `%LOCALAPPDATA%/TFT/.sentry-native/metadata`                                                                                     |
|   1.6 MB | 2026-10-10 16:17:34 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-16.17.34.log`                                                               |
|  90.3 KB | 2026-10-10 16:17:28 | `%LOCALAPPDATA%/TFT/Saved/Logs/D3D12.0.2026.10.10-13.17.28.nv-gpudmp`                                                            |
|    282 B | 2026-10-10 15:54:51 | `%APPDATA%/Riot Client/shared_proto_db/LOG`                                                                                      |
|    330 B | 2026-10-10 15:54:51 | `%APPDATA%/Riot Client/shared_proto_db/metadata/000003.log`                                                                      |
|    300 B | 2026-10-10 15:54:51 | `%APPDATA%/Riot Client/shared_proto_db/metadata/LOG`                                                                             |
|      0 B | 2026-10-10 15:54:51 | `%APPDATA%/Riot Client/VideoDecodeStats/LOG`                                                                                     |
|   4.1 MB | 2026-10-10 15:54:38 | `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-15.54.38.log`                                                               |
|      0 B | 2026-10-10 15:26:51 | `%APPDATA%/riot-client-ux/Crashpad/metadata`                                                                                     |
|    194 B | 2026-10-10 15:19:16 | `RG/League of Legends/Saved/webcache/shared_proto_db/metadata/000003.log`                                                        |
|    292 B | 2026-10-10 15:19:16 | `RG/League of Legends/Saved/webcache/shared_proto_db/LOG`                                                                        |
|    310 B | 2026-10-10 15:19:16 | `RG/League of Legends/Saved/webcache/shared_proto_db/metadata/LOG`                                                               |
|      0 B | 2026-10-10 15:19:16 | `RG/League of Legends/Saved/webcache/VideoDecodeStats/LOG`                                                                       |
|   1.2 KB | 2026-10-10 15:18:43 | `RG/League of Legends/Saved/webcache/Network/Network Persistent State`                                                           |
|    478 B | 2026-10-10 15:17:39 | `RG/League of Legends/Config/LCULocalPreferences.yaml`                                                                           |
|   5.2 KB | 2026-10-10 15:17:37 | `RG/League of Legends/Config/input.ini`                                                                                          |
|   2.1 KB | 2026-10-10 15:17:37 | `RG/League of Legends/Config/game.cfg`                                                                                           |
|  26.6 KB | 2026-10-10 15:17:36 | `RG/League of Legends/Config/TFTUPreferences.yaml`                                                                               |
|   4.8 KB | 2026-10-10 15:17:36 | `RG/League of Legends/Config/TFTPreferences.yaml`                                                                                |
| 128.0 KB | 2026-10-10 15:17:34 | `RG/League of Legends/Saved/webcache/Visited Links`                                                                              |
|    754 B | 2026-10-10 15:17:33 | `RG/League of Legends/Saved/webcache/Session Storage/000003.log`                                                                 |
|    292 B | 2026-10-10 15:17:33 | `RG/League of Legends/Saved/webcache/Session Storage/LOG`                                                                        |
|    260 B | 2026-10-10 15:17:33 | `RG/League of Legends/Saved/webcache/LOG`                                                                                        |
|    211 B | 2026-10-10 15:17:33 | `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClient/Crashes/da1b7431-0176-4703-46be-e384df10671f.run/session.json`         |
|    762 B | 2026-10-10 15:17:33 | `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClient/Crashes/da1b7431-0176-4703-46be-e384df10671f.run/__sentry-event`       |
|    304 B | 2026-10-10 15:17:33 | `RG/League of Legends/Saved/webcache/Local Storage/leveldb/LOG`                                                                  |
|     32 B | 2026-10-10 15:17:12 | `%LOCALAPPDATA%/Riot Games/League of Legends/Data/RiotGamesPrivateSettings.yaml`                                                 |
|      0 B | 2026-10-10 15:17:12 | `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClient/Crashes/da1b7431-0176-4703-46be-e384df10671f.run.lock`                 |
|     40 B | 2026-10-10 15:17:12 | `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClient/Crashes/settings.dat`                                                  |
|      0 B | 2026-10-10 15:17:12 | `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClient/Crashes/da1b7431-0176-4703-46be-e384df10671f.run/__sentry-breadcrumb2` |
|      0 B | 2026-10-10 15:17:12 | `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClient/Crashes/da1b7431-0176-4703-46be-e384df10671f.run/__sentry-breadcrumb1` |
|    392 B | 2026-10-10 15:17:11 | `%PROGRAMDATA%/Riot Games/RiotClientInstalls.json`                                                                               |
|   1.2 KB | 2026-10-10 15:17:11 | `%LOCALAPPDATA%/Riot Games/Riot Vanguard/vgtray.log`                                                                             |
|    608 B | 2026-10-10 15:17:11 | `%LOCALAPPDATA%/Riot Games/Riot Vanguard/vgtray-settings.json`                                                                   |
|    132 B | 2026-10-10 15:17:01 | `%APPDATA%/Riot Client/Preferences`                                                                                              |
|     94 B | 2026-10-10 15:17:00 | `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.ok`                                             |
|    118 B | 2026-10-10 15:17:00 | `%PROGRAMDATA%/Riot Games/Metadata/teamfighttactics.live/teamfighttactics.live.ok`                                               |
|   2.0 KB | 2026-10-10 15:16:54 | `%APPDATA%/Riot Client/Session Storage/000003.log`                                                                               |
|   4.0 KB | 2026-10-10 15:16:54 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Electron Logs/2026-9-10T12-16-51_401_RiotClientElectron.log`             |
|      2 B | 2026-10-10 15:16:53 | `%APPDATA%/riot-client-ux/sentry/queue/queue.json`                                                                               |
|    282 B | 2026-10-10 15:16:52 | `%APPDATA%/Riot Client/Session Storage/LOG`                                                                                      |
|      2 B | 2026-10-10 15:16:51 | `%APPDATA%/riot-client-ux/config.json`                                                                                           |
|    294 B | 2026-10-10 15:16:51 | `%APPDATA%/Riot Client/Local Storage/leveldb/LOG`                                                                                |
|    987 B | 2026-10-10 15:16:51 | `%APPDATA%/Riot Client/electron-log-preload.js`                                                                                  |
|     40 B | 2026-10-10 15:16:51 | `%APPDATA%/riot-client-ux/Crashpad/settings.dat`                                                                                 |
|   1.7 KB | 2026-10-10 15:16:51 | `%APPDATA%/riot-client-ux/logs/main.log`                                                                                         |
|    928 B | 2026-10-10 15:16:49 | `%PROGRAMDATA%/Riot Games/Metadata/lion.live/lion.live.product_settings.yaml`                                                    |
|    997 B | 2026-10-10 15:16:49 | `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml`                          |
|    694 B | 2026-10-10 15:16:49 | `%PROGRAMDATA%/Riot Games/Metadata/teamfighttactics.pbe/teamfighttactics.pbe.product_settings.yaml`                              |
|      0 B | 2026-10-10 15:16:49 | `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.lockfile`                                       |
|    328 B | 2026-10-10 15:16:49 | `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.pbe/league_of_legends.pbe.product_settings.yaml`                            |
|    808 B | 2026-10-10 15:16:43 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/ace80ccf-44a0-4ed4-af76-e83ca4bbe889.run/__sentry-event`              |
|     52 B | 2026-10-10 15:16:42 | `%LOCALAPPDATA%/Riot Games/Riot Client/Config/lockfile`                                                                          |
|   2.2 KB | 2026-10-10 15:16:42 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Launcher/2026-10-10T12-16-40_24492_Launcher.log`                                     |
|   4.9 KB | 2026-10-10 15:16:42 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Logs/2026-10-10T12-16-40_24492_Riot Client.log`                          |
|    741 B | 2026-10-10 15:16:41 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/877d048f-d384-43e4-570f-ac015808c054.run/__sentry-event`              |
|    246 B | 2026-10-10 15:16:41 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/877d048f-d384-43e4-570f-ac015808c054.run/session.json`                |
|      0 B | 2026-10-10 15:16:41 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/877d048f-d384-43e4-570f-ac015808c054.run.lock`                        |
|      0 B | 2026-10-10 15:16:41 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/ace80ccf-44a0-4ed4-af76-e83ca4bbe889.run.lock`                        |
|      0 B | 2026-10-10 15:16:41 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/877d048f-d384-43e4-570f-ac015808c054.run/__sentry-breadcrumb1`        |
|      0 B | 2026-10-10 15:16:41 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/877d048f-d384-43e4-570f-ac015808c054.run/__sentry-breadcrumb2`        |
|   3.5 MB | 2026-10-10 04:27:54 | `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.db`                                             |
|   1.9 MB | 2026-10-10 03:28:22 | `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.manifest`                                       |
|    103 B | 2026-10-10 03:28:21 | `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.update-status.json`                             |
|   5.1 MB | 2026-10-10 03:28:20 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-09T17-26-44_22240_LeagueClient.log`                                         |
|   1.4 KB | 2026-10-10 03:28:20 | `%LOCALAPPDATA%/Riot Games/League of Legends/Data/ShutdownData.yaml`                                                             |
| 584.2 KB | 2026-10-10 03:28:05 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-09T17-26-44_22240_29132_LeagueClientUx.log`                                 |
| 166.1 KB | 2026-10-10 03:17:14 | `%LOCALAPPDATA%/TFT/Saved/Logs/D3D12.0.2026.10.10-00.17.14.nv-gpudmp`                                                            |
|  26.8 KB | 2026-10-10 03:02:54 | `%APPDATA%/MetaTFT Standalone/Network/Network Persistent State`                                                                  |
|   7.4 KB | 2026-10-10 03:02:54 | `%APPDATA%/MetaTFT Standalone/Network/TransportSecurity`                                                                         |
|  36.0 KB | 2026-10-10 03:02:54 | `%APPDATA%/MetaTFT Standalone/DIPS`                                                                                              |
|      0 B | 2026-10-10 03:02:52 | `%APPDATA%/MetaTFT Standalone/Network/Cookies-journal`                                                                           |
|  84.0 KB | 2026-10-10 03:02:52 | `%APPDATA%/MetaTFT Standalone/Network/Cookies`                                                                                   |
|  12.9 KB | 2026-10-10 03:02:51 | `%APPDATA%/MetaTFT Standalone/Session Storage/000003.log`                                                                        |
|    272 B | 2026-10-10 03:02:49 | `%APPDATA%/MetaTFT Standalone/window-positions.json`                                                                             |
|  11.1 KB | 2026-10-10 03:02:49 | `%APPDATA%/MetaTFT Standalone/Local Storage/leveldb/000004.log`                                                                  |
|   1.1 KB | 2026-10-10 03:02:46 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/000003.log`                                                                        |
|   4.0 KB | 2026-10-10 03:00:39 | `%APPDATA%/MetaTFT Standalone/SharedStorage`                                                                                     |
|     70 B | 2026-10-10 03:00:31 | `%APPDATA%/MetaTFT Standalone/game-lobby.json`                                                                                   |
|    430 B | 2026-10-10 02:59:39 | `%APPDATA%/MetaTFT Standalone/Local Storage/leveldb/LOG`                                                                         |
|    166 B | 2026-10-10 02:59:39 | `%APPDATA%/MetaTFT Standalone/Local Storage/leveldb/MANIFEST-000001`                                                             |
|  44.4 KB | 2026-10-10 02:59:39 | `%APPDATA%/MetaTFT Standalone/Local Storage/leveldb/000005.ldb`                                                                  |
|      0 B | 2026-10-10 02:59:29 | `%APPDATA%/MetaTFT Standalone/WebStorage/QuotaManager-journal`                                                                   |
|  40.0 KB | 2026-10-10 02:59:29 | `%APPDATA%/MetaTFT Standalone/WebStorage/QuotaManager`                                                                           |
|    157 B | 2026-10-10 02:59:22 | `%APPDATA%/MetaTFT Standalone/Preferences`                                                                                       |
|    126 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/metadata/000003.log`                                                               |
|    255 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/LOG`                                                                               |
|     16 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/CURRENT`                                                                           |
|     41 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/MANIFEST-000001`                                                                   |
|      0 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/LOCK`                                                                              |
|    273 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/metadata/LOG`                                                                      |
|     16 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/metadata/CURRENT`                                                                  |
|     41 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/metadata/MANIFEST-000001`                                                          |
|      0 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/shared_proto_db/metadata/LOCK`                                                                     |
|      0 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/VideoDecodeStats/LOCK`                                                                             |
|      0 B | 2026-10-10 02:59:21 | `%APPDATA%/MetaTFT Standalone/VideoDecodeStats/LOG`                                                                              |
|     36 B | 2026-10-10 02:59:12 | `%APPDATA%/MetaTFT Standalone/.updaterId`                                                                                        |
|   4.5 KB | 2026-10-10 02:58:53 | `%APPDATA%/MetaTFT Standalone/IndexedDB/metatft_app_0.indexeddb.leveldb/000003.log`                                              |
|    434 B | 2026-10-10 02:58:49 | `%APPDATA%/MetaTFT Standalone/Local State`                                                                                       |
|    307 B | 2026-10-10 02:58:44 | `%APPDATA%/MetaTFT Standalone/IndexedDB/metatft_app_0.indexeddb.leveldb/LOG`                                                     |
|     16 B | 2026-10-10 02:58:44 | `%APPDATA%/MetaTFT Standalone/IndexedDB/metatft_app_0.indexeddb.leveldb/CURRENT`                                                 |
|     23 B | 2026-10-10 02:58:44 | `%APPDATA%/MetaTFT Standalone/IndexedDB/metatft_app_0.indexeddb.leveldb/MANIFEST-000001`                                         |
|      0 B | 2026-10-10 02:58:44 | `%APPDATA%/MetaTFT Standalone/IndexedDB/metatft_app_0.indexeddb.leveldb/LOCK`                                                    |
|    255 B | 2026-10-10 02:58:44 | `%APPDATA%/MetaTFT Standalone/Session Storage/LOG`                                                                               |
|     16 B | 2026-10-10 02:58:44 | `%APPDATA%/MetaTFT Standalone/Session Storage/CURRENT`                                                                           |
|     41 B | 2026-10-10 02:58:43 | `%APPDATA%/MetaTFT Standalone/Session Storage/MANIFEST-000001`                                                                   |
|      0 B | 2026-10-10 02:58:43 | `%APPDATA%/MetaTFT Standalone/Session Storage/LOCK`                                                                              |
|      4 B | 2026-10-10 02:58:43 | `%APPDATA%/MetaTFT Standalone/Cache/No_Vary_Search/journal.baj`                                                                  |
|     20 B | 2026-10-10 02:58:43 | `%APPDATA%/MetaTFT Standalone/Cache/No_Vary_Search/snapshot.baf`                                                                 |
|     48 B | 2026-10-10 02:58:42 | `%APPDATA%/MetaTFT Standalone/Shared Dictionary/cache/index-dir/the-real-index`                                                  |
|      0 B | 2026-10-10 02:58:42 | `%APPDATA%/MetaTFT Standalone/Network/Trust Tokens-journal`                                                                      |
|      0 B | 2026-10-10 02:58:42 | `%APPDATA%/MetaTFT Standalone/Shared Dictionary/db-journal`                                                                      |
|  44.0 KB | 2026-10-10 02:58:42 | `%APPDATA%/MetaTFT Standalone/Shared Dictionary/db`                                                                              |
|  36.0 KB | 2026-10-10 02:58:42 | `%APPDATA%/MetaTFT Standalone/Network/Trust Tokens`                                                                              |
|     24 B | 2026-10-10 02:58:42 | `%APPDATA%/MetaTFT Standalone/Shared Dictionary/cache/index`                                                                     |
|     16 B | 2026-10-10 02:58:39 | `%APPDATA%/MetaTFT Standalone/Local Storage/leveldb/CURRENT`                                                                     |
|      0 B | 2026-10-10 02:58:39 | `%APPDATA%/MetaTFT Standalone/Network/NetworkDataMigrated`                                                                       |
|      0 B | 2026-10-10 02:58:39 | `%APPDATA%/MetaTFT Standalone/Local Storage/leveldb/LOCK`                                                                        |
|    203 B | 2026-10-10 02:58:06 | `RG/League of Legends/Saved/webcache/Network/TransportSecurity`                                                                  |
|  24.0 MB | 2026-10-10 02:54:18 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-09T17-26-44_22240_LeagueClient-tracing.json`                                |
|    292 B | 2026-10-09 20:28:35 | `RG/League of Legends/Saved/webcache/shared_proto_db/LOG.old`                                                                    |
|    310 B | 2026-10-09 20:28:34 | `RG/League of Legends/Saved/webcache/shared_proto_db/metadata/LOG.old`                                                           |
|      0 B | 2026-10-09 20:28:33 | `RG/League of Legends/Saved/webcache/VideoDecodeStats/LOG.old`                                                                   |
|    292 B | 2026-10-09 20:26:57 | `RG/League of Legends/Saved/webcache/Session Storage/LOG.old`                                                                    |
|    304 B | 2026-10-09 20:26:56 | `RG/League of Legends/Saved/webcache/Local Storage/leveldb/LOG.old`                                                              |
|    260 B | 2026-10-09 20:26:56 | `RG/League of Legends/Saved/webcache/LOG.old`                                                                                    |
|   3.0 MB | 2026-10-09 20:26:24 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-09T17-24-27_28876_LeagueClient-tracing.json`                                |
| 270.8 KB | 2026-10-09 20:26:22 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-09T17-24-27_28876_LeagueClient.log`                                         |
|  25.7 KB | 2026-10-09 20:25:48 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-09T17-24-27_28876_19572_LeagueClientUx.log`                                 |
|   2.2 KB | 2026-10-09 20:25:10 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Launcher/2026-10-09T17-25-08_26540_Launcher.log`                                     |
|   5.3 KB | 2026-10-09 20:25:10 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Logs/2026-10-09T17-25-08_26540_Riot Client.log`                          |
|    279 B | 2026-10-09 20:23:58 | `%APPDATA%/Riot Client/shared_proto_db/LOG.old`                                                                                  |
|    297 B | 2026-10-09 20:23:57 | `%APPDATA%/Riot Client/shared_proto_db/metadata/LOG.old`                                                                         |
|      0 B | 2026-10-09 20:23:57 | `%APPDATA%/Riot Client/VideoDecodeStats/LOG.old`                                                                                 |
|   4.0 KB | 2026-10-09 20:23:35 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Electron Logs/2026-9-9T17-23-32_748_RiotClientElectron.log`              |
|    282 B | 2026-10-09 20:23:34 | `%APPDATA%/Riot Client/Session Storage/LOG.old`                                                                                  |
|    294 B | 2026-10-09 20:23:32 | `%APPDATA%/Riot Client/Local Storage/leveldb/LOG.old`                                                                            |
|    246 B | 2026-10-09 20:23:20 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/ace80ccf-44a0-4ed4-af76-e83ca4bbe889.run/session.json`                |
|      0 B | 2026-10-09 20:23:19 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/ace80ccf-44a0-4ed4-af76-e83ca4bbe889.run/__sentry-breadcrumb1`        |
|      0 B | 2026-10-09 20:23:19 | `%LOCALAPPDATA%/Riot Games/Riot Client/Crashes/Riot Client/ace80ccf-44a0-4ed4-af76-e83ca4bbe889.run/__sentry-breadcrumb2`        |
|   4.1 KB | 2026-10-09 20:23:19 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Launcher/2026-10-09T17-23-18_28272_Launcher.log`                                     |
|   3.8 MB | 2026-10-09 19:09:56 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Logs/2026-10-08T18-17-16_11596_Riot Client.log`                          |
|    150 B | 2026-10-09 18:37:50 | `%APPDATA%/Riot Client/Local Storage/leveldb/MANIFEST-000001`                                                                    |
|  22.8 KB | 2026-10-09 18:37:50 | `%APPDATA%/Riot Client/Local Storage/leveldb/000005.ldb`                                                                         |
| 264.1 KB | 2026-10-09 18:36:53 | `%PROGRAMDATA%/Riot Games/Metadata/teamfighttactics.live/teamfighttactics.live.ico`                                              |
| 361.4 KB | 2026-10-09 18:36:53 | `%PROGRAMDATA%/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.ico`                                            |
|   4.1 KB | 2026-10-09 18:36:52 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Riot Client Electron Logs/2026-9-9T15-36-46_934_RiotClientElectron.log`              |
|   2.8 KB | 2026-10-09 12:52:47 | `%LOCALAPPDATA%/Riot Games/Riot Client/Logs/Agent/2026-10-08T18-20-32_30336_Agent.log`                                           |
|   3.1 MB | 2026-10-09 05:53:08 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-08T19-24-20_17756_LeagueClient.log`                                         |
|  20.3 MB | 2026-10-09 05:53:08 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-08T19-24-20_17756_LeagueClient-tracing.json`                                |
| 756.3 KB | 2026-10-09 05:52:51 | `RG/League of Legends/Logs/LeagueClient Logs/2026-10-08T19-24-20_17756_36184_LeagueClientUx.log`                                 |
|     16 B | 2026-10-08 23:01:29 | `RG/League of Legends/Saved/webcache/shared_proto_db/CURRENT`                                                                    |
|     41 B | 2026-10-08 23:01:29 | `RG/League of Legends/Saved/webcache/shared_proto_db/MANIFEST-000001`                                                            |
|      0 B | 2026-10-08 23:01:29 | `RG/League of Legends/Saved/webcache/shared_proto_db/LOCK`                                                                       |
|     16 B | 2026-10-08 23:01:29 | `RG/League of Legends/Saved/webcache/shared_proto_db/metadata/CURRENT`                                                           |
|     41 B | 2026-10-08 23:01:29 | `RG/League of Legends/Saved/webcache/shared_proto_db/metadata/MANIFEST-000001`                                                   |
|      0 B | 2026-10-08 23:01:29 | `RG/League of Legends/Saved/webcache/shared_proto_db/metadata/LOCK`                                                              |
|      0 B | 2026-10-08 23:01:29 | `RG/League of Legends/Saved/webcache/VideoDecodeStats/LOCK`                                                                      |
|  32.0 KB | 2026-10-08 22:46:40 | `%APPDATA%/TFTAcademy/tft-events.db-shm`                                                                                         |
|      0 B | 2026-10-08 22:46:40 | `%APPDATA%/TFTAcademy/tft-events.db-wal`                                                                                         |
|    226 B | 2026-10-08 22:24:37 | `RG/League of Legends/Config/Global/Recommended/RIOT_ItemSet_1.json`                                                             |
|    296 B | 2026-10-08 22:24:37 | `RG/League of Legends/Config/ItemSets.json`                                                                                      |
|      0 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Network/Reporting and NEL-journal`                                                          |
|  36.0 KB | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Network/Reporting and NEL`                                                                  |
|     16 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Session Storage/CURRENT`                                                                    |
|     41 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Session Storage/MANIFEST-000001`                                                            |
|      0 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Session Storage/LOCK`                                                                       |
|      0 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/000003.log`                                                                                 |
|     16 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/CURRENT`                                                                                    |
|     41 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/MANIFEST-000001`                                                                            |
|      0 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/LOCK`                                                                                       |
|      0 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Web Data-journal`                                                                           |
|  88.0 KB | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Web Data`                                                                                   |
|      0 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Local Storage/leveldb/000003.log`                                                           |
|     16 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Local Storage/leveldb/CURRENT`                                                              |
|     41 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Local Storage/leveldb/MANIFEST-000001`                                                      |
|      0 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Local Storage/leveldb/LOCK`                                                                 |
|      0 B | 2026-10-08 22:24:35 | `RG/League of Legends/Saved/webcache/Network/NetworkDataMigrated`                                                                |

Agrupados (cache Chromium, HttpCache, Plugins, GPUCache, heartbeat, Crashes vazios, UX Helper):

| Grupo                                                                  | Arquivos |  Tamanho |
| ---------------------------------------------------------------------- | -------: | -------: |
| `%APPDATA%/MetaTFT Standalone/Cache/Cache_Data/...`                    |      398 |  88.7 MB |
| `%APPDATA%/MetaTFT Standalone/Code Cache/js/...`                       |        2 |     72 B |
| `%APPDATA%/MetaTFT Standalone/Code Cache/wasm/...`                     |        2 |     72 B |
| `%APPDATA%/MetaTFT Standalone/DawnGraphiteCache/data_0/...`            |        1 |   8.0 KB |
| `%APPDATA%/MetaTFT Standalone/DawnGraphiteCache/data_1/...`            |        1 | 264.0 KB |
| `%APPDATA%/MetaTFT Standalone/DawnGraphiteCache/data_2/...`            |        1 |   8.0 KB |
| `%APPDATA%/MetaTFT Standalone/DawnGraphiteCache/data_3/...`            |        1 |   8.0 KB |
| `%APPDATA%/MetaTFT Standalone/DawnGraphiteCache/index/...`             |        1 | 256.4 KB |
| `%APPDATA%/MetaTFT Standalone/DawnWebGPUCache/data_0/...`              |        1 |   8.0 KB |
| `%APPDATA%/MetaTFT Standalone/DawnWebGPUCache/data_1/...`              |        1 | 264.0 KB |
| `%APPDATA%/MetaTFT Standalone/DawnWebGPUCache/data_2/...`              |        1 |   8.0 KB |
| `%APPDATA%/MetaTFT Standalone/DawnWebGPUCache/data_3/...`              |        1 |   8.0 KB |
| `%APPDATA%/MetaTFT Standalone/DawnWebGPUCache/index/...`               |        1 | 256.4 KB |
| `%APPDATA%/MetaTFT Standalone/GPUCache/data_0/...`                     |        1 |  44.0 KB |
| `%APPDATA%/MetaTFT Standalone/GPUCache/data_1/...`                     |        1 | 264.0 KB |
| `%APPDATA%/MetaTFT Standalone/GPUCache/data_2/...`                     |        1 |   1.0 MB |
| `%APPDATA%/MetaTFT Standalone/GPUCache/data_3/...`                     |        1 |   4.0 MB |
| `%APPDATA%/MetaTFT Standalone/GPUCache/index/...`                      |        1 | 256.4 KB |
| `%APPDATA%/MetaTFT Standalone/Partitions/__owepm__/...`                |       51 |   4.0 MB |
| `%APPDATA%/Riot Client/Cache/Cache_Data/...`                           |       78 |  92.0 MB |
| `%APPDATA%/Riot Client/Code Cache/js/...`                              |       19 |  39.3 KB |
| `%APPDATA%/Riot Client/DawnCache/data_1/...`                           |        1 | 264.0 KB |
| `%APPDATA%/Riot Client/GPUCache/data_1/...`                            |        1 | 264.0 KB |
| `%LOCALAPPDATA%/Riot Games/League of Legends/HttpCache/...`            |        2 |  11.5 KB |
| `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClientUx/...`       |        9 |      0 B |
| `%LOCALAPPDATA%/Riot Games/League of Legends/LeagueClientUxHelper/...` |       84 |      0 B |
| `%LOCALAPPDATA%/Riot Games/Riot Client/Data/...`                       |       23 |   3.0 KB |
| `%LOCALAPPDATA%/Riot Games/Riot Client/HttpCache/...`                  |        3 |  14.5 KB |
| `%LOCALAPPDATA%/Riot Games/Teamfight Tactics/HttpCache/...`            |        3 |  14.5 KB |
| `%LOCALAPPDATA%/TFT/Saved/Config/...`                                  |       34 |   9.1 KB |
| `RG/League of Legends/Logs/LeagueClient Logs/...`                      |       26 | 824.1 KB |
| `RG/League of Legends/Plugins/rcp-fe-lol-navigation/...`               |        1 |  50.3 MB |
| `RG/League of Legends/Saved/webcache/...`                              |      206 |  37.5 MB |

## 7. Varredura por palavras-chave (arquivos de texto, JSON, SQLite, log e cache)

Contagem de ocorrencias (sem distincao de maiusculas) nos 30 arquivos com mais acertos nas palavras fortes (bench, TFTCharacter, Sell,
Purchase, roster, reroll, Slot); excluidos dos acertos `ClientConfiguration.json`, licencas Chromium e blobs de cache identicos (`Cache_Data/f_*`, que
sao o mesmo asset repetido: bundle JS Vite da interface do Riot Client, verificado pelo inicio do arquivo, `const __vite__mapDeps=...`, com `Purchase`/`Slot` de codigo de interface). Contagens de `xp` incluem "explicitly"; `level`, `unit`, `store`,
`board`, `champion`, `interest`, `inventory` estao no JSON bruto da varredura (nao reproduzidos aqui por serem ruido).

| Arquivo                                                                                    |  Tamanho | bench | shop | gold |   xp | TFTCharacter | roster | reroll | Slot | Sell | Purchase |
| ------------------------------------------------------------------------------------------ | -------: | ----: | ---: | ---: | ---: | -----------: | -----: | -----: | ---: | ---: | -------: |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-21.29.16.log`                         |  11.7 MB |    46 |  180 |   19 | 2771 |        22630 |      2 |      0 |    9 |  150 |      111 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-18.16.45.log`                         |   7.9 MB |   120 |  188 |   69 | 3342 |        13767 |      2 |      0 |   97 |  156 |      120 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-15.54.38.log`                         |   4.1 MB |   355 |  136 |   70 | 3670 |         5550 |      2 |      0 |  310 |  106 |      101 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-17.05.15.log`                         |   6.7 MB |    94 |  158 |   51 | 3294 |         3663 |      2 |      0 |    8 |  122 |      128 |
| `ue of Legends/Logs/LeagueClient Logs/2026-10-08T19-24-20_17756_LeagueClient-tracing.json` |  20.3 MB |    22 |   56 |  493 | 4300 |            0 |   2052 |     63 |  197 |   59 |      609 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-20.14.57.log`                         |   3.1 MB |    73 |  145 |   42 | 4008 |         2122 |      2 |      0 |   10 |  115 |      125 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-18.50.01.log`                         |   2.5 MB |    79 |  135 |   57 | 3114 |         1169 |      2 |      0 |    8 |  101 |       93 |
| `ue of Legends/Logs/LeagueClient Logs/2026-10-09T17-26-44_22240_LeagueClient-tracing.json` |  24.0 MB |    20 |   46 |  654 | 3376 |            0 |    583 |     51 |  147 |   64 |      395 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-17.42.01.log`                         |   2.3 MB |   218 |  160 |   79 | 2861 |          418 |      2 |      0 |  174 |  130 |      141 |
| `ue of Legends/Logs/LeagueClient Logs/2026-10-10T12-17-12_36936_LeagueClient-tracing.json` |  24.0 MB |    18 |   46 |  397 | 3462 |            0 |    246 |     48 |  134 |   54 |      347 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-20.51.27.log`                         |   4.4 MB |   106 |  133 |   54 | 2941 |          192 |      2 |      0 |   43 |   97 |      103 |
| `RG/League of Legends/Logs/LeagueClient Logs/2026-10-08T19-24-20_17756_LeagueClient.log`   |   3.1 MB |    55 |   50 |    6 |  615 |            0 |      0 |    181 |  116 |    2 |      122 |
| `RG/League of Legends/Logs/LeagueClient Logs/2026-10-09T17-26-44_22240_LeagueClient.log`   |   5.1 MB |    55 |   55 |    9 |  516 |            0 |      0 |    146 |  110 |    2 |       89 |
| `ue of Legends/Logs/LeagueClient Logs/2026-10-09T17-24-27_28876_LeagueClient-tracing.json` |   3.0 MB |     0 |   50 |   15 | 1032 |            0 |     47 |     21 |   25 |   20 |      280 |
| `RG/League of Legends/Logs/LeagueClient Logs/2026-10-10T12-17-12_36936_LeagueClient.log`   |   9.1 MB |    50 |   58 |    9 |  473 |            0 |      0 |    130 |  102 |    2 |       72 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-16.25.41.log`                         |   1.5 MB |    52 |   54 |   95 |  935 |           99 |      2 |      0 |   50 |   21 |       38 |
| `%APPDATA%/TFTAcademy/tft-events.db`                                                       | 100.0 KB |   224 |    8 |    4 |   28 |            0 |     11 |      0 |   15 |    0 |        0 |
| `gue of Legends/Logs/LeagueClient Logs/2026-10-08T19-24-20_17756_36184_LeagueClientUx.log` | 756.3 KB |     0 |    1 |    0 |  228 |            0 |      0 |    245 |    0 |    0 |        0 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT-backup-2026.10.10-16.17.34.log`                         |   1.6 MB |    32 |   82 |   19 | 1086 |           96 |      3 |      0 |    8 |   53 |       45 |
| `%/Riot Games/Riot Client/Logs/Riot Client Logs/2026-10-09T17-23-19_28272_Riot Client.log` |   4.0 MB |     0 |    0 |    2 |  399 |            0 |      4 |     63 |   84 |    0 |       75 |
| `gue of Legends/Logs/LeagueClient Logs/2026-10-09T17-26-44_22240_29132_LeagueClientUx.log` | 584.2 KB |     0 |    1 |    0 |  143 |            0 |      0 |    190 |    0 |    0 |        0 |
| `gue of Legends/Logs/LeagueClient Logs/2026-10-10T12-17-12_36936_23568_LeagueClientUx.log` | 584.3 KB |     0 |    0 |    0 |  101 |            0 |      0 |    186 |    0 |    0 |        0 |
| `%/Riot Games/Riot Client/Logs/Riot Client Logs/2026-10-08T18-17-16_11596_Riot Client.log` |   3.8 MB |     4 |    1 |    2 |  396 |            0 |      5 |     41 |   52 |    0 |       71 |
| `%LOCALAPPDATA%/TFT/Saved/Logs/TFT.log`                                                    |   1.3 MB |     8 |   65 |   19 |  453 |           33 |      3 |      0 |    6 |   36 |       31 |
| `RG/League of Legends/Logs/LeagueClient Logs/2026-10-09T17-24-27_28876_LeagueClient.log`   | 270.8 KB |     0 |   48 |    2 |   72 |            0 |      0 |      2 |   64 |    2 |       25 |
| `%APPDATA%/TFTAcademy/reportcard-events.db`                                                |  80.0 KB |    41 |    6 |    8 |    7 |            0 |      0 |      0 |   30 |    0 |        0 |
| `RG/League of Legends/Config/PerksPreferences.yaml`                                        |   9.4 KB |     0 |    0 |    0 |    0 |            0 |      0 |      0 |   20 |    0 |        0 |
| `%/Riot Games/Riot Client/Logs/Riot Client Logs/2026-09-27T13-51-40_28264_Riot Client.log` |   1.3 MB |     0 |    0 |    1 |   31 |            0 |      2 |      0 |    0 |    0 |       13 |
| `%APPDATA%/TFTAcademy/Cache/Cache_Data/data_1`                                             | 776.0 KB |     0 |    0 |    0 |   93 |            0 |      0 |      0 |   12 |    1 |        0 |
| `RG/League of Legends/Config/input.ini`                                                    |   5.2 KB |     0 |    4 |    0 |    0 |            0 |      0 |      0 |    9 |    0 |        0 |

Leitura dos acertos (cada um aberto e classificado):

- Os 11 `TFT*.log`: `TFTCharacter` (id de entidade em voz/animacao), `Sell` (todas `Shop.Selling`), `Purchase` (voz `Unit.Purchase` + RMS), `bench`/`Slot`
  (arrastos recusados e `ItemFlyToBench`/`BP_DefaultBench`), `shop` (tooltips, `Shop.Selling`, cosmeticos). Nada alem do ja descrito.
- `*_LeagueClient-tracing.json` e `*_LeagueClient.log`: `roster` (1.139 a 2.052 por arquivo = mensagens de **amigos/chat**), `Purchase` (loja de cosmeticos/RMS de pagamento),
  `bench` (teambuilder de LoL), `reroll` (campo `rerollEnabled` de fila). Nada de partida de TFT em andamento.
- `tft-events.db` / `reportcard-events.db` (TFTAcademy): `bench` 224/41, eventos GEP do **Overwolf** (secao 4.5), nao da Riot.
- `MetaTFT Standalone/Cache/Cache_Data/f_00003c` (1,4 MB): JSON estatico do site do MetaTFT (comeca com `{"augmentOdds":[...]}`; reroll/interest = tabelas de odds e economia do site), nao dado da partida.
- `Riot Client/Config/ClientConfiguration.json`, `Teamfight Tactics/Config/ClientConfiguration.json`, `League of Legends/Config/ClientConfiguration.json`: `roster`/`Purchase` = chaves de configuracao de servico.

## 8. Rede e portas locais (somente leitura)

Medido com `Get-NetTCPConnection` / `Get-NetUDPEndpoint` (consulta de tabela de sockets, sem trafego) e um unico GET recusado:

| Processo                                                | TCP escutando                                  | UDP                           | TCP estabelecido               | Observacao                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------- | ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TFTClient-Win64-Shipping.exe` (com a partida em curso) | **nenhum**                                     | 1 (`0.0.0.0:<porta efemera>`) | 3 (443 e 5223 para a Riot/CDN) | a linha de comando do proprio jogo (gravada em `LogInit: Command Line:` no `TFT.log`) traz `-GameId=`, `-ServerIP=`, `-ServerPort=`, `-LeagueClientPort=` e credenciais; o estado vem por **UDP de um servidor de jogo remoto** |
| `LeagueClient.exe`                                      | `127.0.0.1:<porta do lockfile>` (LCU)          | n/d                           | n/d                            | `TFTHextechSubsystem: LCU configured at Port[...]` confirma que o jogo posta no LCU                                                                                                                                             |
| `RiotClientServices.exe`                                | `127.0.0.1:<porta>` (API local do Riot Client) | n/d                           | n/d                            | nao consultada alem do que o LCU ja expoe                                                                                                                                                                                       |
| `Riot Client.exe` (UX)                                  | `:::<porta>`                                   | n/d                           | n/d                            | interface                                                                                                                                                                                                                       |
| qualquer processo                                       | **nada na 2999** (Live Client Data)            | n/d                           | n/d                            | `curl -sk https://127.0.0.1:2999/liveclientdata/gamestats` -> codigo 7 (recusa), medido com a partida em curso                                                                                                                  |

Nao ha servidor/porta local do jogo que sirva estado de partida. As portas locais existentes sao do LCU e do Riot Client, e o LCU (920 eventos,
1.447 funcoes) nao tem rota de estado de jogo do TFT.

## 9. Configuracao e opcoes de log (descritivo; nada foi aplicado)

Observado:

- `%LOCALAPPDATA%\TFT\Saved\Config\WindowsClient\Engine.ini` (112 B) so tem `[GameNetDriver StatelessConnectHandlerComponent]`. `[Core.Log]` nao existe.
- `C:\Riot Games\Teamfight Tactics\Live\Engine\Config\BaseEngine.ini` (3.286 linhas): `[Core.Log]` (linha 1245) existe e esta **vazio**.
  `StagedBuild_TFT.ini` tem 3 bytes. A pasta `TFT/Config` do jogo nao existe em disco (a configuracao especifica do TFT fica cozida nos paks, que nao foram abertos).
- `GameUserSettings.ini`: `ReplaySettings`, `TelemetrySettings` (`ApCollectorUrl=https://data.riotgames.com`) e as `ClientConfig=` vindas do servidor (Niagara/GPU). Nenhuma chave de log.
- `ClientConfiguration.json`: `tft.client_settings.enable_send_logs = false`; `tft.client_Toggle_Enable_Gesture_Logs = true` (0 linhas de gesto no log);
  `tft.client_settings.telemetry.sample_rate = 1`; `lol.client_settings.datadog_rum_config.sessionReplaySampleRate = 0`.
- O jogo aplica CVars **enviadas pelo servidor** (`Applied CVar change Source[ClientConfig] Name[...]`); isto e controlado pela Riot, nao pelo usuario.
- LCU: `/lol-gameflow/v1/extra-game-client-args` (GET devolveu `[]`; existe o `POST` correspondente) e `LoggingStart/Stop/GetEntries` (logging do **proprio cliente**).

Opcoes que **poderiam** habilitar logs mais verbosos (**nao aplicadas, nao testadas**; hipoteses sobre a Unreal Engine 5.7 padrao):

1. Secao `[Core.Log]` em `Saved\Config\WindowsClient\Engine.ini` com `LogCategoria=Verbose` (ou `VeryVerbose`). A categoria do TFT se chama literalmente `TFT`
   (e `RGIChrono`, `LogAbilitySystem`, etc.), entao seria `TFT=Verbose`.
2. Argumento de linha de comando `-LogCmds="TFT Verbose"` (o LCU tem `/lol-gameflow/v1/extra-game-client-args`; nao ha confirmacao de que o
   `PostLolGameflowV1LaunchTft` o repasse ao TFT).
3. Comando de console `Log TFT Verbose` (so com console habilitado; nao ha evidencia de console no cliente de varejo).

Por que **nao** recomendo e por que o ganho e incerto: (a) o binario e `Shipping`; em UE, chamadas `UE_LOG(... Verbose)` costumam ser descartadas em tempo de compilacao
nesse modo, e o `TFT.log` tem 142.829 linhas com nivel explicito `Display/Warning/Error` e **zero** `Verbose/VeryVerbose` em 242.877 linhas (as demais sao nivel `Log` sem marca e continuacoes); (b) mesmo que existissem, nada indica que a equipe
tenha escrito um `Verbose` de economia (o estado de ouro/XP/loja esta em propriedades replicadas e na UI, e o `TFTAugmentPlayerSubsystem` mostra que os logs sao de
ciclo de vida, nao de valores); (c) alterar `Engine.ini`/argumentos do jogo e modificacao do cliente em area protegida pelo Vanguard; o `Engine.ini` e reescrito pelo
proprio jogo (`;METADATA=(Diff=true, UseCommands=true)`), e eu nao tenho como medir o risco com a Riot. Qualquer teste disso e decisao do usuario.

## 10. Limites desta varredura e o que so se confirma ao vivo

- **Impossivel/nao feito por regra**: abrir binarios do jogo, `*.nv-gpudmp`, `vgc_*.log` (cifrado), dumps de memoria, qualquer coisa de Vanguard; ler memoria ou rede do jogo.
- **Nao verificado**: se o `bench_items` do `item_bench` do Overwolf vem preenchido para rivais (so ha amostras vazias); se `Verbose`/`-LogCmds` mudam
  alguma coisa no TFT (nao testado, por decisao); formato de eventos do TFT em modos de teste (PBE) e em outros sets.
- **Confirmado ao vivo nesta sessao**: `TFT.log` legivel durante a partida com 1 a 4 s de atraso; `__sentry-event` regravado ao vivo (`round 3-1`, `phase Planning`);
  `TFTEoGStats.json` regravado durante a partida; processo do TFT sem porta TCP; 2999 recusa; LCU `InProgress`.
- **Rotacao**: so ha ~10 backups; o mais antigo some quando um novo e criado. O `TFT-backup-2026.10.10-03.17.16.log` (6,5 MB), presente na primeira listagem, ja tinha sumido na segunda (cerca de 50 min depois);
  os trechos reais que os testes usam estao em `tests/fixtures/`.
- **Efeito sobre o helper**: nenhuma nova fonte permitida foi encontrada para ouro, nivel, XP, loja, reserva (jogador ou rivais) ou banco de itens.
  Recomendacao: manter o leitor de tela como reserva para esses seis dados e a reserva manual, e continuar com compras/fusao (voz), estagio/fase (Sentry),
  tabuleiros (EoG) como fontes de arquivo. O campo `price` de `boardPieces` (novo no registro) pode ser cruzado com o catalogo, sem ganho de ouro/nivel.
