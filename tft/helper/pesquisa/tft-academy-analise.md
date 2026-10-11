# TFTAcademy (app desktop 0.9.22): análise estática

Escopo: análise estática e somente leitura do app instalado em `%LOCALAPPDATA%\Programs\TFTAcademy`, mais os dados que ele mesmo gravou em `%APPDATA%\TFTAcademy`. Nada foi executado, depurado, injetado ou interceptado. Nenhum arquivo do app ou do jogo foi alterado. Não foram feitos screenshots, testes nem benchmarks.

Segredos, PUUIDs, nomes de outros jogadores, IPs, chaves de partida e e-mails foram omitidos ou marcados `<REDACTED>`.

## 0. Método e convenções

- `app.asar` (242 MB) foi lido com um parser próprio do cabeçalho ASAR. Ele extraiu `dist/main.cjs`, `dist/preload.cjs` e o renderer (`dist/renderer/**`) para uma pasta nova e vazia dentro do scratchpad. Nada foi extraído para dentro da instalação.
- O renderer traz source maps com `sourcesContent`. Isso devolve 946 fontes originais (Svelte/TS), e foi assim que se leu o código do renderer. Os caminhos `src/...` e `shared/lib/...` abaixo são esses fontes.
- `dist/main.cjs` é um bundle legível, não minificado. As referências `main.cjs:Lnnn` apontam para a linha do arquivo extraído.
- Os bancos `tft-events.db` e `reportcard-events.db`, com `-wal` e `-shm`, foram copiados para o scratchpad e consultados na cópia. O original não foi aberto.
- O `main.log` foi lido só por `grep` seletivo.
- As ferramentas REA MCP não estavam disponíveis nesta sessão. A skill `skills/reverse-engineer-anything/SKILL.md` não existe neste repositório. Usei leitura direta dos arquivos extraídos.
- Rótulos usados: **[OBS]** observado em arquivo, dado ou log; **[DER]** derivado diretamente do código; **[INF]** inferência; **[INC]** incerteza ou não verificado.

## 1. Arquitetura geral (item 5)

### Pacote e runtime

- [OBS] `package.json` dentro do asar: `TFTAcademy` 0.9.22, empresa "Next Level Tactics LLC", `electronVersion` 42.7.1, `main: dist/main.cjs`.
- [OBS] Bloco `overwolf`: `uid` do app (id público do app Overwolf, mesmo valor de `APP_UID` em `main.cjs:L204`) e `packages: ["gep","recorder","overlay"]`.
- [OBS] O app roda sobre o **ow-electron** (Electron com o gerenciador de pacotes Overwolf: `app.overwolf.packages`). Há `owutility.dll` e `integrity.dll` na pasta de instalação.
- [OBS] Versões carregadas em runtime (`main.log`):
  - GEP 312.4.3 em 11/09 e 315.1.0 em 10/10.
  - recorder 0.32.59.
  - overlay 2.0.13 em 11/09 e 2.1.15 em 10/10.
- [OBS] Os pacotes Overwolf são baixados e atualizados pelo runtime, não ficam embutidos no asar. O app só espera o evento `ready` de cada pacote.

### Processos

- **Main** (`dist/main.cjs`, ~8000 linhas): contém todos os serviços listados abaixo.
- **Renderer**, SvelteKit estático servido por um protocolo próprio `tftacademy://` (`registerFileProtocol`, `main.cjs:L4710`).
  - Rotas HTML: `index`, `replay`, `profile`, `tierlist`, `guides`, `notes`, `customcomps`, `academyplus`, `settings/*`, `tools/builder`.
  - Rotas de overlay: `overlay` e `display`.
  - Um `BrowserWindow` principal sem moldura (`frame:false`, 1500x920 inicial, mínimo 900x920). Usa `webSecurity:false` e `devTools` só fora do pacote.
- **Preload** (`dist/preload.cjs`): `contextBridge.exposeInMainWorld("electronAPI", …)` com `contextIsolation:true` e `nodeIntegration:false` em todas as janelas.
- **Overlay**: duas janelas criadas pelo pacote overlay do ow-electron (ver seção 6).

### Serviços do main

| Serviço                                                                                                                        | Linha                                    | Função                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------- |
| `Application`                                                                                                                  | L59                                      | Costura os serviços.                                      |
| `GameEventsService`                                                                                                            | L5213                                    | Envolve o pacote GEP.                                     |
| `TFTMatchRecorderService`                                                                                                      | L6384                                    | Máquina de partida, persistência e upload do report card. |
| `ScreenCaptureService`                                                                                                         | L5897                                    | Pacote recorder, vídeo `.mp4`.                            |
| `OverlayService` / `DisplayWindowService`                                                                                      | L5479 / L5322                            | Pacote overlay, janelas e hotkeys.                        |
| `ShopMarkersService`, `AugmentNotesService`, `AnvilNotesService`, `WispNotesService`, `StageTipsService`, `PinnedCompsService` | L3441, L3282, L3129, L3408, L3243, L2546 | Decisão do que o overlay mostra.                          |
| `PocketBaseService`                                                                                                            | L1688                                    | Cliente do backend do TFTAcademy.                         |
| `TFTEventDatabase`                                                                                                             | L802                                     | SQLite com Drizzle.                                       |
| `startLCUService`                                                                                                              | L1275                                    | Cliente local do League Client (lib `hexgate`).           |
| `MainWindowController`                                                                                                         | L4675                                    | Janela principal, tray, hotkey.                           |

### IPC

- [OBS] Cerca de 100 canais, definidos em `electron/ipc-channels.ts` e duplicados em `main.cjs:L313-L489` e no preload. Grupos:
  - `app:*`, `tft:*` (gravações, partidas, clipes), `overlay:*`, `overlay-placements:*`, `settings:*`, `custom-comps:*`, `notes:*`, `pocketbase:*`, `lcu:*`, `gep:*`, `log:*`, `window:*`, `shell:*`.
  - Broadcasts main para renderer: `tft-event`, `board-pieces-updated`, `slots-batch-update`, `augment-tiers-updated`, `wisp-tiers-updated`, `item-tiers-updated`, `round-start`, `battle-start`, `match-started`, `match-ended`.
- [DER] O preload expõe `on(channel, cb)` sem lista de canais permitidos. Qualquer janela do app pode ouvir qualquer broadcast e chamar qualquer `invoke` exposto.
- [INC] Há canais declarados no preload sem handler no main (`tft:start-recording`, `tft:stop-recording`, `tft:start-replay-recording`, `tft:capture-replay`). Não localizei registro desses handlers no bundle. A função existe só em teoria.

### Auto-update

- [OBS] `electron-updater` com feed `generic` em `https://electron-updates.overwolf.com/electron-updates/electron/<uid>` (também em `resources/app-update.yml`).
  - Canais `latest`, `Beta` (setting `beta_updates`) e `Dev`.
  - `autoDownload` e `autoInstallOnAppQuit` ligados.
  - Checagem na inicialização e a cada minuto (visto no log: "Checking for update" por volta de 1/min).
  - O renderer recebe `update-downloaded` e dispara `app:quit-and-install`.
- Fonte: `main.cjs:L1337-L1394`.

### Autenticação, licença e backend

- [OBS] PocketBase (SDK `pocketbase`) em `https://api.tftacademy.com/`. Dados públicos (tierlists, assets) em `https://tftacademy.com/api/...`. Uma segunda instância "tactician" em `https://tactician.tftacademy.com/` recebe o report card (ver abaixo).
- Login:
  - E-mail e senha, ou OAuth2 (Discord, Patreon, Riot, OIDC).
  - O callback é `https://tftacademy.com/auth/desktop-callback/<provedor>`.
  - O token PocketBase fica no `electron-store` (`config.json`, chave `pb_auth`).
  - O PKCE e o `state` ficam temporariamente na mesma store.
- Licença:
  - [DER] Não é checagem local de chave. O nível do usuário (`tier`: 0 grátis, 2 Gold, etc.) vem da conta PocketBase e do Patreon (`fetchPatreonTier`).
  - Limites de tier no cliente:
    - 8 "My Comps" no plano grátis (`CUSTOM_COMP_LIMIT`).
    - Máximo de 5 gravações favoritadas.
    - Retenção de 72 h para gravações não favoritas no tier 0.
  - [INF] Isso é controle de funcionalidade no cliente. Não identifiquei assinatura criptográfica de licença.

### Telemetria

- [OBS] Report card anônimo: no fim de cada partida gravada, `uploadReportCardGame` cria um registro em `report_card_games` na instância "tactician". Campos:
  - `puuid`, `matchId`, `gameName`, `gameTag`, `set`, `queueType`;
  - rank (tier, divisão, LP), `placement`, `startedAt`, `endedAt`;
  - `gold` (juros), `executionAccuracy`, `scoutingScore`, `luck`, `combat`, `scoutCount`;
  - `compTitle`, `finalComp` (peças e itens).
  - Valores de `puuid`/`gameName`: <REDACTED>.
- [OBS] Compartilhar comp (`shared_custom_comps`) também grava no backend.
- [OBS] Anúncios: o renderer configura "NitroAd" (`shared/lib/scripts/ads.ts`) e há `AdSlot.svelte`. O main expõe `app.overwolf.openAdPrivacySettingsWindow`.
- [OBS] Não encontrei SDK de analytics (gtag, posthog, sentry, mixpanel, plausible, amplitude) no código do app.
- [OBS] O app guarda o PUUID do League Client em `riot_accounts.lcu_puuid` e `games.player_puuid`.

### Ciclo do app

- [OBS] Instância única (`requestSingleInstanceLock`), esquema de deep link `tftacademy://`, ícone de bandeja, "fechar no X" configurável. O auto-start é gerenciado por `app.setLoginItemSettings`.

## 2. Como o app recebe os eventos do jogo (item 1)

### Canal

- [OBS] **Overwolf GEP (Game Events Provider)** pelo pacote `gep` do ow-electron. `GameEventsService` (`main.cjs:L5213`) faz:
  - `app.overwolf.packages.on("ready")`, e se `packageName === "gep"`, pega `app.overwolf.packages.gep`;
  - `gepApi.on("game-detected")`: filtra pelos ids do TFT e chama `e.enable()`;
  - `gepApi.setRequiredFeatures(gameId, features)`;
  - `gepApi.on("new-info-update")` e `gepApi.on("new-game-event")`, que viram o evento interno `new-event(gameId, payload)`;
  - `gepApi.on("game-exit")`;
  - `gepApi.on("error")`;
  - `gepApi.on("elevated-privileges-required")`;
  - `getSupportedGames()`, `getFeatures()` e `getInfo()`, expostos por IPC (`gep:*`).
- Ids de jogo:

| Constante         | Id    | Significado  |
| ----------------- | ----- | ------------ |
| `TFT_GEP_ID`      | 21570 | TFT "legado" |
| `TFT_UE5_GAME_ID` | 28164 | cliente UE5  |
| `TFT_PBE_GAME_ID` | 28162 | PBE          |

- O id reportado pode vir com sufixo (281641, 215701). Por isso `matchesGameId` compara `reportedId === id || floor(reportedId/10) === id`.
- [OBS] O log mostra `GEP: register game-detected: 28164, tft` e, depois, `Teamfight Tactics` (processo `TFTClient-Win64-Shipping.exe`, id 281641).

### Features assinadas

- [OBS] `TFT_FEATURES` (`main.cjs:L561`):

```
gep_internal, live_client_data, me, match_info, match_stats,
roster, store, board, bench, carousel, augments
```

- São as mesmas para os 3 ids de jogo.
- Se a plataforma responder "not supported", o erro é só registrado e ignorado (`main.cjs:L5240`).
- [INC] O app ouve `new-info-update` e `new-game-event` de forma genérica, sem filtro por feature no momento da assinatura. A assinatura das features é a lista acima.

### Formato do evento recebido

- [DER] Cada payload tem a forma `{ feature, category, key, value }`.
- `value` pode vir como string JSON. O app faz `JSON.parse` se começar com `{` ou `[` (`main.cjs:L6618`).
- Se o parse falhar, o evento é descartado com `log.error`.

### Pares (feature, key) que o código trata ou persiste

Os exemplos de payload são do banco real (partida de 11/09) e do log.

| feature / key                                                                           | Forma do valor                                                                           | Fonte do formato |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| `match_info` / `match_start`, `match_end`, `match_state`                                | `{}` ou `{in_progress:bool}`                                                             | [OBS] BD         |
| `match_info` / `round_type`                                                             | `{stage:"1-2", name:"PVE", type:"Minions_1", native_name:"Intro1"}`                      | [OBS] BD         |
| `match_info` / `round_start`, `round_end`, `battle_start`, `battle_end`, `battle_state` | string curta ou `null`; `battle_state` é `{in_progress}`                                 | [OBS] BD e log   |
| `match_info` / `round_outcome`                                                          | `{<jogador>:{outcome:"victory"/..., tag_line}}`, todos os 8                              | [OBS] BD         |
| `match_info` / `battle_stats`                                                           | `[{team, units:[{name, *_dmg, *_blocked, shielded, healed}]}]`                           | [OBS] BD         |
| `me` / `gold`                                                                           | número (`2`) ou `{}`                                                                     | [OBS] BD         |
| `me` / `xp`                                                                             | `{level, current_xp, xp_max}`                                                            | [OBS] BD         |
| `me` / `health`                                                                         | número                                                                                   | [DER] replay     |
| `me` / `summoner_name`, `rank`                                                          | string / número                                                                          | [DER] main       |
| `store` / `shop_pieces`                                                                 | `{slot_1..slot_5:{name:"DA_18_Rakan"}}`, "Sold" para vendido                             | [OBS] BD         |
| `store` / `shop_visible`                                                                | `"true"` / `"false"`                                                                     | [OBS] BD e log   |
| `bench` / `bench_pieces`                                                                | `{cell_N:{name, level, item_1..3}}`                                                      | [OBS] BD         |
| `bench` / `item_bench`                                                                  | `[{summoner, tag_line, bench_items:[]}]`, **uma entrada por jogador, 8 jogadores**       | [OBS] BD         |
| `board` / `board_pieces`                                                                | `{cell_N:{name, level:"1", item_1..3}}`; células `cell_1..`                              | [OBS] BD         |
| `board` / `opponent_board_pieces`                                                       | idem, tabuleiro do adversário                                                            | [OBS] BD         |
| `roster` / `player_status`                                                              | `{<jogador>:{index, health, xp, localplayer, rank, tag_line}}`                           | [OBS] BD         |
| `board_spectate`, `opponent`                                                            | alvo observado (`{name, tag_line}` ou `"nome#tag"`)                                      | [DER] main       |
| `carousel` / `carousel_pieces`                                                          | peças do carrossel                                                                       | [DER] main       |
| `match_info` / `item_select`                                                            | `{item_1..item_5:{name}}`, bigorna de itens                                              | [DER] main       |
| `match_info` / `picked_item`, `picked_augment`                                          | string (ex.: `DA_Artifact_EternalPact`); objeto de aprimoramentos                        | [OBS] log, [DER] |
| `live_client_data` / `game_data`, `active_player`, `all_players`                        | `gameTime`; `currentGold` e `riotIdGameName`; lista de jogadores com `isDead`, `riotId`… | [DER] main       |
| `augments` / `me`                                                                       | `{augment_1..augment_3:{name}}`                                                          | [DER] main       |

- Chaves de log: no `main.log` só aparecem eventos do tipo `new-game-event` (round_start, round_end, battle_start, battle_end, shop_visible, picked_item, match_start, match_end). Os `new-info-update` não são impressos no log.
- [OBS] Cadência (log de 10/10): ~50 eventos de cada tipo de ciclo de rodada (`round_start`, `battle_start`, `battle_end`, `round_end`, `shop_visible`) por partida. As atualizações de informação (ouro, loja, banco) chegam sempre que o valor muda. O app não faz polling.

### Handlers

- `new-event` chega ao `TFTMatchRecorderService.handleTFTGameEvent` (`main.cjs:L6615`), que:
  1. parseia JSON;
  2. renova um timer de fim de partida em eventos `live_client_data`;
  3. descarta `active_player` com `currentGold > 500`, `live_client_data/me` e `local_player_damage`;
  4. normaliza `round_type` (`native_name` vira `type` por mapa, ex. `Combat`→`PVP`, `Encounter_*`→`Carousel`, `Intro1`→`Minions_1`);
  5. remove de `board_pieces` entradas que não são campeões (`cullUnknownBoardPieces`);
  6. avalia início de partida (`trackMatchStart`);
  7. registra (`recordGenericEvent`).
- Em paralelo, `LCU` (`hexgate`, cliente local HTTPS do League Client) lê:
  - `/lol-summoner/v1/current-summoner` (PUUID, nome);
  - `/lol-gameflow/v1/session` (fila → `queue_type`);
  - `/lol-ranked/v1/current-ranked-stats` (rank);
  - `/riotclient/region-locale`.
  - Isso **não** é GEP.

## 3. O que persiste no SQLite e por que o banco só tem 76 eventos (item 2)

### Esquema (Drizzle, 14 migrações em `app.asar.unpacked/drizzle`)

Dois arquivos SQLite via `better-sqlite3`, `journal_mode=WAL`:

- `tft-events.db`: banco completo.
- `reportcard-events.db`: espelho enxuto, só com as chaves do report card (`board_spectate`, `opponent`, `board_pieces`, `player_rank`, `xp`, `round_type`, `round_start`, `round_outcome`, `gold`, `shop_pieces`, `bench_pieces`, `planner_units`).

Tabelas (`main.cjs:L685-L789`):

- `games(id PK, started_at, ended_at, game_version, set_number, player_puuid, final_placement, queue_type, created_at, match_id, recording_saved_at, recording_file_path, custom_title, favorited)`
- `events(id PK AUTOINCREMENT, game_id FK→games ON DELETE CASCADE, timestamp, event_type, feature, category, player_id, round, stage_type, key, data JSON, created_at)`
  - Índices: `(game_id,timestamp)`, `(event_type)`, `(game_id,round)`.
- `settings(key,value,updated_at)`
- `riot_accounts(game_name, tag_line, profile_icon_id, account_id, lcu_puuid)`
- `custom_comps`, `user_notes`
- `overlay_placements(id, element_id, vw, vh, preset, button_style, keep_open, panel_width)`

Detalhes:

- [OBS] `timestamp` e `created_at` são gravados em **segundos** (modo `timestamp` do Drizzle), embora o app passe milissegundos para `new Date(...)`. Ao ler com SQL, trate como segundos Unix.
- [OBS] `data` é JSON em texto.
- [OBS] `events.round` guarda o estágio atual (`"1-2"`). Fica `"0-0"` antes do primeiro `round_type`.
- [OBS] `events.player_id` guarda o nome do jogador local, ou `"unknown"`.

### Quando e como grava

- [DER] Gravação **evento a evento**, sem lotes: cada evento faz um `INSERT` assíncrono. As promessas ficam em `pendingEventWrites` e são aguardadas em lote só no fim da partida (`flushPendingEventWrites`).
- Não há limite de eventos por partida.
- A partida é criada em `startRecording` → `TFTEventDatabase.startGame` (`main.cjs:L7684`):
  - id = UUID;
  - `queue_type` vem do LCU;
  - `match_id` = `<PlatformID>_<GameId>`, extraído da linha de comando do processo do jogo (`-GameId=…`, `-PlatformID=…`; valores <REDACTED>).
- [DER] **Gatilho de início** (`trackMatchStart`, `main.cjs:L6709`), só para os ids UE5:
  - `match_state` com `in_progress=true`;
  - ou `match_start`;
  - ou, se a partida anterior não foi concluída, qualquer chave do conjunto do report card (`gold`, `round_type`…).
  - Também exige `pendingGameInfo`, que só existe depois de `game-detected`.
  - No log, as partidas de 10/10 começaram por `"gold"` e `"round_type"`.
- [DER] **Gatilho de fim**:
  - `match_end` ou `match_state` com `in_progress=false`; espera 5 s e fecha;
  - ou `game-exit`.
- No fim, `endGame` grava `ended_at` e `final_placement`.
  - A colocação vem de `me/rank`, de `player_status` ou de um fallback (1 se a partida foi concluída, 8 se não).
- [DER] Reconexão (rejoin): se a mesma partida volta em até 15 min com estágio ≥ 2-0, retoma o mesmo `matchId` e abre novo segmento de vídeo.
- [DER] **Persistência pausada** em duas condições:
  - o jogador local morreu (`all_players.isDead`) ou o fim da partida foi detectado (`playerEliminated=true`): o evento ainda é emitido para a interface, mas **não grava**;
  - não há `currentMatch`.

### Por que só existem 76 eventos de setembro e nenhum de hoje

Observado no banco copiado (consultado com o `-wal` junto) e no log.

**Partida de 10/10 (hoje): nenhuma linha em `events`, de propósito.**

- [OBS] A tabela `settings` tem `record_games = 'false'` (e `audio_game_only='false'`).
- [OBS] `persistEvent` retorna logo se `!recordingEnabledForCurrentMatch` (`main.cjs:L7083`). O app **continua emitindo** o evento (`this.emit("tft-event")`), então o overlay funciona, mas nada vai para o SQLite.
- [OBS] No fim de cada partida, com gravação desativada, o app **apaga a própria linha de `games`**. O log mostra:
  - `21:53:46 [TFT] Deleted non-recorded game from DB: <uuid>`
  - `22:27:17 [TFT] Deleted non-recorded game from DB: <uuid>`
  - Dois jogos em 10/10, os dois apagados.
- [OBS] Na minha cópia (tirada às 22:24, durante a segunda partida) havia uma linha de `games` com `ended_at` nulo (`21:59:01`) e **0 eventos** dela. A linha foi apagada no fim da partida.
- Fonte: `main.cjs:L6943-L6987` (`endMatchRecording`, ramo `else`).

**Partida de 11/09: 76 eventos porque a captura durou ~1 minuto.**

- [OBS] Os 76 eventos vão de 19:48:04 a 19:49:04. A partida só foi capturada até a rodada 1-2/1-3.
  - Há 27 `battle_stats`, 13 `item_bench`, 5 `bench_pieces`, 4 `gold`, 3 `round_type`, 3 `shop_pieces`, 2 `board_pieces`, 2 `player_status`, 1 `xp`, 1 `player_rank` e demais.
  - Não há nenhum evento de `augments`, `health`, `opponent` ou `board_spectate`.
- [OBS] A linha de `games` tem `ended_at = NULL` e `final_placement = NULL`.
- [OBS] O `.mp4` correspondente existe (`tft-recordings\<uuid>-2026-09-11-19-48-17.mp4`, ~69 MB, até 19:50:21), mas `recording_saved_at` e `recording_file_path` estão nulos.
- [INF] A partida de 11/09 foi interrompida (jogo ou app fechado, ou erro) antes de `endMatchRecording`, por isso não foi finalizada nem apagada.
- [DER] Partidas sem `ended_at` e sem `final_placement` **ficam para sempre**:
  - as consultas de replay (`getCompletedGamesPage`, `getAllCompletedGames`) filtram `ended_at IS NOT NULL AND final_placement IS NOT NULL`;
  - a limpeza de 72 h (`findExpiredFreeTierRecordings`) varre só partidas concluídas;
  - `cleanupOldGames` existe, mas nenhum chamador foi encontrado.
- [OBS] Mesmo com `record_games=true`, a partida de 11/09 teria só ~1 minuto de eventos. Para o helper, a única fonte de verdade do banco depende de a partida ter sido finalizada.

**Ressalva importante de leitura:** `tft-events.db` fica em WAL. O arquivo principal tem ~100 KB e o `-wal` ~490 KB. Um leitor que abra só o `.db` (ou use `immutable=1`) perde dados que ainda não passaram pelo checkpoint. É preciso abrir com o `-wal` e o `-shm` presentes, em modo somente leitura.

### Limpeza de gravações

- Limpeza periódica 30 s após iniciar e a cada 5 min (`runPeriodicCleanup`).
- Tier 0: apaga gravações concluídas e não favoritas com mais de 72 h. Isso apaga o vídeo **e a linha de `games`**, com cascata nos eventos.
- Limite de armazenamento (`max_storage_gb`, padrão do app; neste PC 15 GB): apaga as mais antigas não favoritas.
- Se as favoritas sozinhas excedem o limite, nada é apagado.

### Gravação de vídeo (`recording_*`)

- [OBS] Pacote `recorder` do ow-electron (`ScreenCaptureService`, `main.cjs:L5897`):
  - `recorderApi.startRecording` com fonte de jogo (`addGameSource`, `captureOverlays:true`);
  - base 2560x1440, saída pela resolução escolhida (padrão 720p), FPS 60 e bitrate 8000 kbps por padrão;
  - áudio só do jogo se `audio_game_only`, senão áudio padrão;
  - arquivo `<matchId>-<AAAA-MM-DD-hh-mm-ss>.mp4` na pasta `tft-recordings`.
- `recordingSavedAt` e `recordingFilePath` são gravados no evento `recording-saved` do recorder.
- Cortes (clipes) usam o `ffmpeg` do pacote recorder, com marca d'água opcional (`watermark-text.png`).
- A gravação só começa quando o serviço de partida chama `startRecording`, e só se `record_games=true`.

## 4. Como a partida é montada na tela (item 3)

### Modelo de dados

- O renderer **não mantém um modelo de partida em tempo real** na tela de replay. Ele reconstrói tudo a partir da lista de eventos do banco: `getGameWithEvents` devolve `{...game, events}` ordenado por `id`.
- Replay (`src/routes/replay/[id]/+page.svelte`, 1852 linhas):
  1. Carrega `getTFTRecordingById`, `getGameWithEvents` e `getReportCardEvents`.
  2. `ReplayUtils.getBoardForRecording` pega o último `board_pieces` não vazio e monta `champions[]` (`shared/lib/components/Overlay/utils.svelte.ts`).
  3. `ReplayUtils.parseTftTimeline` percorre os eventos e cria a linha do tempo a partir de:
     - `round_type`;
     - `health`;
     - `gold`;
     - `shop_pieces` (detecta **rolldown** quando a loja muda dentro do mesmo estágio, com contagem de lojas);
     - `bench_pieces` e `board_pieces` (campeões 2★ ou mais);
     - `xp` (subida de nível);
     - `round_outcome`;
     - `battle_state`;
     - `me` e `picked_augment` (aprimoramentos).
  4. `TFTEvents.svelte` lista a timeline. `Canvas.svelte` e `RecordingInfo.svelte` mostram vídeo e informações.
- [DER] Há atrasos fixos ad hoc para alinhar eventos ao vídeo (ex.: `timestamp - 4000`, `PLANNING_TIME = 30000`).
- O tabuleiro final é mostrado pelo mesmo componente das guias (`GuideViewer/Components/Board.svelte`, `TierlistBoard.svelte`, `ChampionHexagon.svelte`). O app **não desenha a loja, o banco nem o ouro** como painéis na tela de replay. Eles aparecem como marcadores na linha do tempo e no report card.

### Ligação com ids `DA_18_*`

- [OBS] Os nomes de peça do GEP são `apiName` de assets: `DA_18_Leona`, `DA_18_Rakan`, `DA_18_Akali_AD`, e também `DA_Minion_ChaosMelee`, `DA_18_SprykinSummonMelee`.
- Os assets (campeões, itens, aprimoramentos, traços, wisps) vêm do backend: `GET https://tftacademy.com/api/assets/{augments|champions|items|wisps}?set=<n>` (`main.cjs:L2036` e `shared/lib/scripts/assets.svelte.ts`).
- O renderer indexa por `id` e por `apiName` (`acc[asset.id]`, `acc[asset.apiName]`). `ChampionAsset.getChampion(apiName, set)` faz a busca direta, com fallback em outros sets carregados.
- No main, `PocketBaseService.resolveChampion` usa um índice com normalização: minúsculas, remove prefixo `tft\d*_`, `set\d+_`, `\d+_`, sufixos de variante `_ad`/`_ap`/`_base`, e usa o nome de exibição como alternativa (`buildNameIndex`, `L1655`).
- `championKey` (`shared/lib/utils/champion-name.ts`) reduz `DA_18_Akali_AD` a `akali` e `TFT13_Leona` a `leona`, e tem um alias `nidaleecougar`→`nidalee`. É isso que `sameChampion` usa para comparar loja com comp fixada.
- [OBS] Se uma peça não existe na base de campeões do set, ela é **removida** do `board_pieces` e registrada em `logs\missing-board-data.log` como JSONL. Exemplo real: `DA_18_SprykinSummonMelee`, `cell_15`, set 18.
- Itens:
  - [DER] `item_1..3` do GEP são nomes de item ou caminhos.
  - O main normaliza com `replaceAll(/.*\/|\..*$/g,"")` (ficar só com o nome base).
  - O placeholder `TFTItem` é ignorado no tabuleiro.
- Set atual: `resolveSetForGame` usa o id do jogo e a fila. Padrão set 18 (`ENCHANTED_WILDS_SET`), fila 6110 = set 15 (revival), fila 1210 = set 16 (Lore & Legends), PBE = 18.

### Report card

- Calculado no main no fim da partida (`buildReportCardUpload`, `main.cjs:L3100`):
  - **Execução** (`executionAccuracy`): o tabuleiro final comparado com as comps do guia (`scoreComp`: peso 0,7 para unidades e 0,3 para itens; usa o multiconjunto de peças e itens).
  - **Scouting** (`computeScouting`): pontua rodadas em que houve `board_spectate` de outro jogador, com bônus para o adversário da rodada e para rodadas de aprimoramento, ponderadas pelo estágio.
  - **Sorte** (`computeLuckScore`): compara as peças desejadas no `planner_units` com a loja (`shop_pieces`) e uma tabela de probabilidades por nível (`SHOP_ODDS`) e custo.
  - **Ouro de juros**: soma `min(5, floor(ouro/10))` entre rodadas.
- Só roda se há `puuid` e dados de referência do backend.

## 5. O que o app "vê": aprimoramentos, Wisps e o resto (pedido adicional)

### 5.1 Canal: GEP, sem visão computacional

**Conclusão: [OBS+DER] aprimoramentos, ofertas, wisps, loja, banco, itens, nível, ouro, vida e oponente chegam todos pelo Overwolf GEP (feature + chave). Não há leitura de tela.**

Evidência negativa:

- Busca no bundle do main, no preload e em todas as fontes do renderer por `tesseract`, `ocr`, `opencv`, `onnx`, `tensorflow`, `template match`, `desktopCapturer`, `getDisplayMedia`, `getUserMedia`, `capturePage` e `readPixels` não achou nada que processe frames do jogo.
  - Única ocorrência de captura de tela: `ContainerToPNGButton.svelte`, que exporta o editor de comps para PNG.
- O recorder grava o jogo em `.mp4`, mas o vídeo só é reproduzido (e cortado com ffmpeg) na tela de replay. **Nenhum código lê o vídeo para extrair dados.**
- Nenhuma leitura de arquivos de log do jogo (sem `fs.watch`, sem varredura de pastas Riot) e nenhum acesso a memória.

Evidência positiva:

- `TFT_FEATURES` inclui `augments`, `store`, `board`, `bench`, `roster`, `me`, `match_info`, `match_stats`, `carousel` e `live_client_data` (`main.cjs:L561`).
- O código do overlay reconhece o evento de aprimoramentos pela feature e a chave: `eventData.feature === AUGMENTS && eventData.key === ME` (`ShopMarkersService.handleRoundEvents`, `main.cjs:L3785`).

**Sobre a hipótese "o GEP público proíbe aprimoramentos em apps publicados":**

- [OBS] O código pede a feature `augments` e consome os dados dela. O app tem `uid` e é um app publicado no ecossistema Overwolf (atualizado pelo feed do próprio Overwolf).
- [INC] Não consigo verificar daqui a política do Overwolf nem se existe autorização específica por app (o `uid` acima). O que o código prova é que **este app obtém aprimoramentos por GEP**, e não por visão. Nenhum evento de aprimoramento está nos dados salvos: a partida de 11/09 acabou antes do estágio 2-1 e as de 10/10 não foram persistidas. O **formato** vem só do código, não de uma amostra real.
- [INF] Se um app nosso não conseguir a feature `augments`, o caminho de contingência é reconstruir os aprimoramentos por outros dados (ver seção 7), não copiar um método de visão do TFTAcademy, porque ele não usa nenhum.

### 5.2 Aprimoramentos (ofertas e escolhido)

- **Oferta:** `feature=augments`, `key=me`, valor `{augment_1:{name}, augment_2:{name}, augment_3:{name}}`.
  - [DER] O nome é um `apiName` de asset (família `DA_*`/`TFT18_*`; o app nunca mostra um exemplo literal).
  - O app só considera oferta se `augment_1.name` existe (`hasAugments`). Se vier vazio, trata como "tela de aprimoramento fechada".
- **Escolhido:** `key=picked_augment`.
  - [DER] O replay pega `Object.values(data).map(a=>a.name).reverse().filter(Boolean)[0]`, ou seja, o último nome não vazio.
  - Aprimoramentos cujo nome contém `ChampionItem` são ignorados na timeline.
- **Rodada de aprimoramento:** `round_type` com `type` começando em `Augment` (`Augment_1/2/3` nos estágios `2-1`, `3-2`, `4-2`; mapa `AUGMENT_STAGES` em `main.cjs:L5829`).
- **O que o overlay faz com isso** (`AugmentNotesService`, `L3282`):
  - ao receber a oferta, esconde os marcadores de loja (`hideAllSlots`);
  - consulta a tier list de aprimoramentos do backend (`api/tierlist/augments?set=`) por estágio (`2`, `3`, `4` ou `All`);
  - cruza com guias que usam aquele aprimoramento (até 3 comps sugeridas por aprimoramento);
  - envia `{augment1..3: {name, tier:S|A|B|C, comps}}` à janela `display` pelo canal `augment-tiers-updated`;
  - ao escolher, ou ao mudar a rodada, ou ao espiar o tabuleiro de outro jogador (`board_spectate` com alvo ≠ jogador local), esconde as dicas e restaura a loja.
- **Condições de ativação:** setting `augment_tiers` (padrão `true`); `NO_AUGMENT_TIERS` quando escondido.

### 5.3 Wisps (fogos-fátuos)

- **Canal:** são itens da loja. [DER, comentário do código] O GEP os reporta "como uma entrada comum de `shop_pieces`, ex.: `slot_5: { name: "DA_AbandonShip18" }`" (`WispNotesService`, `main.cjs:L3408`). Não existe evento separado de wisp.
- **Resolução:** `PocketBaseService.resolveWisp` consulta o catálogo `GET https://tftacademy.com/api/assets/wisps` (sem parâmetro de set) indexado por `apiName` e nome de exibição. Se o nome da loja resolve, o slot é wisp. Se não, é campeão e simplesmente "erra" (`main.cjs:L3418-L3430`).
- **Tipo e condição:** o cliente só enxerga `{apiName, tier}`, com `tier` em S, A, B, C ou D. O D não tem arte de hexágono (`WispTip.svelte`). O texto da condição ou efeito do wisp não é usado no cliente. Ele fica no backend.
- **"Comprado":** [DER] o app **não** modela compra de wisp. Ele só marca o tier nos 5 slots da loja. Quando o slot vira `Sold`, o nome deixa de resolver e a marca some.
- **Condições de ativação:** setting `wisp_tiers`; escondido junto com os marcadores da loja (carrossel, tela de aprimoramento, bigorna, `shop_visible=false`).

### 5.4 O resto: o que mais o app mostra e o canal

| Informação            | Canal / chave                                                            | Observação                                                    |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Ouro                  | `me/gold` (número) e `live_client_data/active_player.currentGold`        | O app descarta `currentGold > 500` (guarda contra dado lixo)  |
| Nível / XP            | `me/xp` `{level, current_xp, xp_max}`                                    |                                                               |
| Vida                  | `me/health` (número); todos os 8 em `roster/player_status`               |                                                               |
| Loja                  | `store/shop_pieces` `slot_1..5.name` e `shop_visible`                    | `Sold` quando comprado                                        |
| Banco de peças        | `bench/bench_pieces` `cell_N` com `name`, `level`, `item_1..3`           |                                                               |
| Tabuleiro             | `board/board_pieces` `cell_1..cell_28` (índice = N-1)                    | Posição = número da célula                                    |
| Itens no banco        | `bench/item_bench`: **lista dos 8 jogadores**, cada um com `bench_items` | O app guarda, mas na tela não usa o banco de itens dos rivais |
| Bigorna de itens      | `item_select` `{item_1..item_5:{name}}`                                  | Mostra tier e campeões sugeridos                              |
| Oponente da rodada    | `opponent` `{name, tag_line}` e `opponent_board_pieces`                  |                                                               |
| Tabuleiros dos rivais | `board_spectate` (quem o jogador está olhando)                           | Usado só no scouting                                          |
| Resultado da rodada   | `round_outcome` por jogador                                              |                                                               |
| Dano por unidade      | `battle_stats`                                                           | Só persistido                                                 |
| Jogador morto, nomes  | `live_client_data/all_players` (`isDead`, `riotId…`)                     |                                                               |
| Rank na ladder        | **LCU** `/lol-ranked/v1/current-ranked-stats`                            | Gravado como `player_rank`                                    |
| Fila                  | **LCU** `/lol-gameflow/v1/session`                                       |                                                               |
| Carrossel             | `carousel_pieces`                                                        | Esconde marcadores                                            |

Itens que o app calcula ou mostra e que o helper atual pode não ter (comparar com `tft/helper`):

- **Marcação de loja:** destaca os slots cuja peça está nas comps fixadas ou no planner, e só enquanto a peça ainda não chegou ao nível alvo (2★ por padrão). Usa `sameChampion`.
- **Dicas por aprimoramento** (tier + comps sugeridas), **por item da bigorna** (tier + campeões recomendados), **por wisp** (tier).
- **Dicas por estágio e notas do usuário com expressões** (`stage_tips`, `user_notes.expression`), disparadas por `round_start`/`battle_start`.
- **Detecção de rolldown** (variações de loja dentro de um estágio, com ouro gasto).
- **Pontuação de sorte** com a tabela de probabilidades por nível e custo.
- **Scouting score** e luta às cegas (`blindFightPct`).
- **Planner**: unidades alvo guardadas como evento `planner_units` junto com a partida.
- **Rank** do jogador pela LCU antes da partida.

### 5.5 Cadência e condições de ativação

- **Janela de ativação:** o GEP só entrega dados depois de `game-detected` e `e.enable()`. As features só são definidas depois disso (`setRequiredFeatures(gameId)`).
- **Início de partida:** só após `pendingGameInfo` existir. Em UE5, os gatilhos são `match_state(true)`, `match_start` ou `gold`/`round_type` e outros do conjunto do report card.
- **Overlay:** não depende de `record_games`. O evento é emitido ao renderer antes da checagem de persistência (`recordGenericEvent` chama `emit("tft-event")` primeiro).
- **Overlay desligado em partida de aprimoramento "Gods"** (`CarouselMarket`): esconde marcadores.
- **Jogador eliminado:** a persistência para, mas os marcadores são limpos (`onGameExit`, `broadcastBoardPiecesUpdate([])`).

## 6. Overlay: janelas, posicionamento, atalhos (item 4)

### Janelas

- [OBS] O overlay é criado com `overlayApi.createWindow(options)` do pacote **overlay** do ow-electron (não é uma `BrowserWindow` comum).
- Duas janelas, ambas transparentes (`transparent:true`, `dpiAware:true`, `resizable:false`), do tamanho da janela do jogo em DIP e posicionadas em `(0,0)` relativas ao jogo:

| Janela                | Rota                     | Características                                                                                                                               |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `tft-overlay`         | `tftacademy://./overlay` | Interativa: botões, painéis de comp fixada, planner, notas, dicas por estágio. Sem `passthrough` explícito.                                   |
| `tft-display-overlay` | `tftacademy://./display` | `focusable:false`, `passthrough:"passThroughAndNotify"`, `ignoreKeyboardInput:true`. Marcadores de loja, dicas de aprimoramento, wisp, itens. |

- O comentário do código diz que as dicas de aprimoramento ficam na janela `display` justamente porque ela é `passThroughAndNotify`: elas continuam passando o mouse (hover) sem engolir cliques destinados ao jogo (`display/+page.svelte`).
- [INC] Pela documentação pública do ow-electron, o padrão do campo `passthrough` é `noPassThrough` (a janela trata e bloqueia a entrada). A janela `tft-overlay` não define o campo. Não consigo verificar estaticamente como o runtime trata áreas transparentes dessa janela.
- Tamanho:
  - `getOverlayBoundsInDIP` usa `activeGame.gameWindowInfo.size / scaleFactor` do display onde está o jogo.
  - Em `game-window-changed` (mover ou redimensionar o jogo), redimensiona as duas janelas e avisa o renderer (`overlay-window-resized`).
- [OBS] Exemplo do log: jogo em janela de 1920x1080 em (311,112) num monitor 2048x1152 com escala 1,25. Overlay criado com 1536x864 DIP. `gameInputInfo: { canInterceptInput: true, exclusiveMode: false }`.
- Injeção (`main.cjs:L5535`):
  1. Em `game-launched`, injeta (`event.inject()`) só se o processo é TFT: o id é UE5, ou o nome do processo é `TFTClient-Win64-Shipping.exe`, ou a linha de comando contém `-Product=TFT`.
  2. Se o jogo está **elevado** (admin), não injeta e dispara `admin-warning` (aviso na janela principal).
  3. Após `game-injected` ou quando `game-window-changed` traz tamanho válido, cria as janelas.
- Registro de jogos: `overlayApi.registerGames({gamesIds: OVERLAY_GAME_IDS})` com os ids 5426 (League overlay) e os três de TFT.

### Posicionamento (`overlay_placements`)

- Oito elementos, ids em `OVERLAY_ELEMENT_IDS`:
  - `stage-tips-button`, `notes-button`, `all-comps`;
  - `pinned-comp-button`, `pinned-comp`;
  - `planner-button`, `planner`, `stage-notes`.
- Colunas: `vw` e `vh` (posição; `0,0` significa layout padrão), `preset` (`default`), `button_style` (`circular` ou `full`), `keep_open`, `panel_width` (`slim` ou `wide`).
- [DER] Normalização no main: ids duplicados por elemento e preset são fundidos, preferindo o que tem posição personalizada; faltantes são preenchidos com padrão.
- Posição personalizada: o renderer (`OverlayPlaced.svelte`, `lib/scripts/overlay-placements.ts`) converte a porcentagem para pixel pelo tamanho do contêiner, mantém uma margem de 0,75% das bordas e evita uma **área reservada da loja** (53% da largura x 15% da altura, com folga lateral de 10%). Há snap magnético de 6 px no editor (`overlaySnap.svelte.ts`, `settings/placement`).
- Layouts-padrão por contexto: `legacy`, `ue5` e `ue5Pve` (`shared/lib/constants/overlay.ts`), com posições relativas em `cqh`/`%`/`rem`.

### Atalhos

- Via `overlayApi.hotkeys.register({name, keyCode, modifiers, passthrough:false}, cb)`. Padrões dos settings:
  - `overlay_hot_key` (padrão `` ` ``): alterna a janela principal do app dentro do jogo (`focus-main-window`).
  - `hide_overlay_hot_key` (padrão vazio): esconde os elementos do overlay (`overlay-elements-hidden-changed`).
- A tecla de interface é convertida em código virtual. Há tabela própria de teclas especiais (`KEY_TO_CODE`).
- Também existe um atalho local `before-input-event` na janela principal quando o TFT é detectado.

### Tela cheia vs. janela sem borda

- [OBS] O código **não distingue** modos de tela. Não há chamada a `enterExclusiveMode`. O único dado de modo que o app registra é o `gameInputInfo` do próprio runtime, e só nos logs.
- [INC] Pela documentação do ow-electron, o modo exclusivo só é suportado quando `canInterceptInput` é falso. Em tela cheia exclusiva (não sem borda), a interação com a janela é limitada pelo runtime Overwolf. Não verifiquei o TFT em tela cheia exclusiva. O log desta máquina só cobre janela (`exclusiveMode:false`, `canInterceptInput:true`).

## 7. O que podemos reproduzir no nosso projeto com código próprio

Premissas: nosso helper não é um app Overwolf; não usa o `uid`, os pacotes `gep`/`overlay`/`recorder` nem o backend do TFTAcademy.

### 7.1 Receber eventos

**Exige runtime e credenciais Overwolf:**

- O GEP em si (assinatura de `augments`, `store`, `board`, `bench`, `roster`, `me`, `match_info`, `live_client_data`). Só existe dentro de um app ow-electron (ou Overwolf nativo), com `uid` aprovado e pacotes baixados pelo runtime.
- Nosso app só receberia eventos se fosse um app Overwolf aprovado. Se o Overwolf restringe a feature `augments` para apps sem autorização, é questão a tratar com o suporte do Overwolf, não algo que a análise estática resolve. [INC]

**Não exige Overwolf:**

- **Ler `tft-events.db` do TFTAcademy** (somente leitura):
  - Funciona só com o TFTAcademy instalado e com `record_games = true`.
  - Abrir com o WAL visível.
  - Esperar linhas em `games` com `ended_at` nulo enquanto a partida está em andamento (o evento é gravado ao vivo, evento a evento).
  - Cuidado: `timestamp` em segundos; `data` em JSON; peças fora do catálogo são removidas de `board_pieces`; a linha da partida some no fim se a gravação estiver desligada; partidas finalizadas de jogadores no tier 0 são apagadas após 72 h.
  - Isso é a ponte mais barata. Dependência: a gravação ligada no outro app, por escolha do usuário.
- **LCU** (cliente local do League Client): resolve fila, rank, nome e PUUID do jogador. É uma API local do próprio cliente da Riot, sem Overwolf. O `lockfile` e a porta ficam no cliente.
  - O TFTAcademy usa essa rota para fila e rank. Não entrega ouro nem loja.
- **Nossa própria captura de tela** (o que o helper já faz): continua independente de Overwolf. Evidência desta análise: o TFTAcademy **não** usa isso, então não há método de visão dele para reproduzir. Para aprimoramentos sem GEP, o caminho seria leitura de tela própria (reconhecimento da tela de oferta) ou a combinação de rodada (`2-1`, `3-2`, `4-2`) mais fontes locais. [INF]

### 7.2 Persistir

**Não exige Overwolf nem credenciais:** tudo isto é código nosso.

- Esquema equivalente: `games(id, started_at, ended_at, queue_type, match_id, set_number, final_placement)` e `events(game_id, timestamp, feature, category, key, round, player_id, data JSON)`, com `ON DELETE CASCADE` e índice `(game_id, timestamp)`.
- Regras que valem copiar como ideia (descritas com palavras nossas):
  - gravar evento a evento num SQLite em WAL, esperar só no fim;
  - criar a partida no primeiro sinal de início confiável (estado da partida, ouro ou tipo de rodada), com `match_id` derivado da linha de comando do processo do jogo;
  - parar de gravar quando o jogador morre;
  - tratar retorno à mesma partida em até 15 min como continuação;
  - **não apagar** a partida quando a gravação estiver desligada, e **finalizar** partidas abandonadas (o TFTAcademy deixa partidas sem fim para sempre, e esse é o motivo dos 76 eventos).
- Lembrar que gravar não é pré-requisito para o overlay. Nossa fonte única de estado em memória deve alimentar a tela mesmo sem persistência.

### 7.3 Visualizar

**Não exige Overwolf:**

- Normalização de nomes: `DA_18_*` → chave comparável (minúsculas, remove `da_`, número do set, sufixos `_AD`/`_AP`/`_base`, caracteres não alfanuméricos), com tabela de alias e tratamento de peças fora do catálogo (invocações, minions, `TFTItem`).
- Itens do GEP: aceitar nome puro ou caminho (`…/Nome.Nome`) e extrair o nome base.
- Montar a partida a partir dos eventos:
  - tabuleiro = último `board_pieces` não vazio, célula N → índice N-1;
  - ouro = `me/gold`, nível = `me/xp.level`, vida = `me/health` ou `player_status`;
  - loja = `shop_pieces` slot 1 a 5, valor `Sold` quando comprado;
  - rolldown = loja muda dentro do mesmo estágio;
  - nível sobe = `xp.level` aumenta.
- Catálogos de campeões, itens, aprimoramentos e wisps: o TFTAcademy os serve do backend dele (`api/assets/...`, `api/tierlist/...`). **Não podemos depender dessa API sem autorização.** O helper já tem catálogo próprio (meta, Data Dragon / CommunityDragon).

### 7.4 Overlay

**Exige Overwolf:**

- As janelas injetadas no processo do jogo (`overlay.createWindow`, injeção, hotkeys do jogo que não passam o evento adiante, `passthrough`, reposicionamento automático por `game-window-changed`, uso em tela cheia exclusiva).

**Não exige Overwolf (alternativas com código próprio):**

- Uma janela Electron/Qt transparente, sempre no topo e sem moldura, posicionada sobre a janela do jogo com a geometria lida do sistema (posição, tamanho, escala DPI). Funciona em janela e sem borda; tela cheia exclusiva continua sendo limitação de qualquer sobreposição que não injeta.
- Click-through (`setIgnoreMouseEvents`) e atalho global do sistema para abrir/ocultar.
- Reproduzir a **lógica de conteúdo** é independente do meio:
  - marcadores de slot da loja (quando a peça está no plano e ainda não chegou ao nível alvo);
  - tier de aprimoramento, wisp e item de bigorna;
  - dicas por estágio;
  - posições configuráveis com 8 elementos, em porcentagem da altura do contêiner, com margem e área reservada para a loja;
  - esconder tudo quando a loja está coberta (carrossel, tela de aprimoramento, bigorna, espionando outro jogador).
- Decisão de produto fora do escopo desta análise: o helper hoje é web (servidor + navegador). Um overlay "sobre o jogo" exige um processo desktop adicional.

### 7.5 Resumo

| Capacidade                                | Precisa de Overwolf                          | Alternativa sem Overwolf                                                                |
| ----------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Ouro, loja, banco, tabuleiro, nível, vida | Sim (GEP)                                    | Ler `tft-events.db` do TFTAcademy (WAL, `record_games=true`) ou captura de tela própria |
| Aprimoramentos (oferta e escolha)         | Sim (feature `augments`, sujeita a política) | Captura de tela própria; **sem amostra real** de payload neste PC                       |
| Wisps                                     | Sim (`shop_pieces`)                          | Mesma loja lida por captura de tela, mais catálogo próprio de wisps                     |
| Fila, rank, nome                          | Não                                          | LCU local                                                                               |
| Persistência                              | Não                                          | SQLite próprio                                                                          |
| Visualização, normalização de ids         | Não                                          | Código nosso                                                                            |
| Overlay dentro do jogo                    | Sim (injetado)                               | Janela transparente sobreposta (sem tela cheia exclusiva)                               |
| Vídeo da partida                          | Sim (`recorder`)                             | OBS, ou captura própria                                                                 |

## 8. Lacunas e verificações pendentes

- [INC] Formato real de `augments/me` e de `picked_augment`: só vem do código. Não há evento de aprimoramento em nenhum dos bancos.
- [INC] Comportamento de entrada (clique através de áreas transparentes) da janela `tft-overlay` e comportamento em tela cheia exclusiva.
- [INC] Política do Overwolf para a feature `augments` em apps publicados.
- [INC] Canais `tft:start-recording` e similares sem handler no bundle.
- [INC] Conteúdo atual da tabela `overlay_placements` do usuário não foi consultado.
- A fonte extraída fica em pasta temporária de sessão (scratchpad) e não foi copiada para o repositório.

## 9. Referências principais (arquivo e módulo)

- `resources\app.asar` → `dist/main.cjs`: `GameEventsService` L5213, `TFTMatchRecorderService` L6384, `TFTEventDatabase` L802, `OverlayService` L5479, `DisplayWindowService` L5322, `ScreenCaptureService` L5897, `ShopMarkersService` L3441, `AugmentNotesService` L3282, `WispNotesService` L3408, `AnvilNotesService` L3129, `PocketBaseService` L1688, `MainWindowController` L4675, `TFT_FEATURES` L561, settings L4211.
- `dist/preload.cjs` (ponte `electronAPI`).
- Fontes do renderer via source maps:
  - `src/routes/(overlay)/overlay/+page.svelte`;
  - `src/routes/(overlay)/display/+page.svelte`;
  - `src/routes/replay/[id]/+page.svelte`;
  - `shared/lib/components/Overlay/utils.svelte.ts`;
  - `shared/lib/utils/champion-name.ts`;
  - `shared/lib/constants/overlay.ts`;
  - `src/lib/constants/overlay-placements.ts`;
  - `src/lib/scripts/overlay-placements.ts`.
- `resources\app.asar.unpacked\drizzle\*.sql` (migrações).
- Dados do usuário: `%APPDATA%\TFTAcademy\tft-events.db` (+`-wal`), `reportcard-events.db`, `logs\main.log`, `logs\missing-board-data.log`, `tft-recordings\`.
- Documentação pública do Overwolf citada para `passthrough` e modo exclusivo: https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/overlay/type-aliases/PassthroughType e https://dev.overwolf.com/ow-electron/guides/general-tech/exclusive-mode-overlay
