# Plano: remover a leitura de tela (OCR/glifos/ícones) e ficar com o GEP

> **Executado em 2026-10-11** na branch `tft-helper-sem-ocr`, com as decisões do usuário dessa data:
>
> - sem OCR, com o TFTAcademy como fonte (D1 e D2 aceitas);
> - lacunas como desconhecido explícito, inclusive o começo da partida (D5);
> - ponte própria adiada (D3);
> - tudo de OCR movido para `.old/ocr/` em vez de apagado (D6 e D7);
> - `FALLBACK_LEVEL = 7` mantido (D4 em aberto).
>
> Diferenças em relação ao texto abaixo:
>
> - P2 e P4 foram fundidos: não há flag `TFT_SCREEN_READER`, o leitor saiu do sistema de uma vez;
> - o estado neutro (P3) se chama `seen` no `/api/state`;
> - os motivos de cada lacuna estão em `noSource`.
>
> O que é cada arquivo arquivado e como restaurar está em `.old/ocr/README.md`. O texto abaixo é o plano como foi escrito.

Pedido do usuário (2026-10-11): "Crie um plano para deixar salvo para remover o OCR do meu sistema, já que já obtemos os dados
através do GEP." Este documento é **só planejamento**. Nenhum código foi alterado, nenhuma suíte foi rodada, o servidor da porta
3218 não foi tocado e o `tft-events.db` original não foi escrito: ele foi copiado e a cópia foi aberta somente para leitura.

Legenda: **[V]** verificado no código ou no banco nesta data; **[D]** dito por documento do projeto e não reconferido; **[?]**
desconhecido. Os números de linha são do disco em 2026-10-11. Vários arquivos estão modificados no `git status` e sendo editados por
outros agentes (seção 6), então as linhas podem mudar.

---

## 0. Resumo

- **O que é "OCR" aqui.** É o processo `screen-reader.ps1`, comandado por `screen-reader.mjs` e criado só pelo `server.mjs`. Ele lê:
  - por glifo: ouro, nível, XP e estágio;
  - pelo OCR do Windows: os 5 nomes da loja e as cartas de aprimoramento;
  - por ícone: o banco de itens e a quantidade de removedores.

  Não lê reserva, vida, rivais, tabuleiro, fase nem carrossel. **`capture.mjs` não é leitura de tela**: ele lê o arquivo
  `TFTEoGStats.json` e fica.

- **Hoje o GEP já é a fonte primária** de tudo o que a tela lê:
  - `core/state/precedence.mjs` e `gep-reader.mjs` aplicam `mergeGep` com a regra "GEP fresco > tela > estimativa";
  - o estágio segue a regra "arquivo do jogo (Sentry) > GEP > tela".

  A tela só vale em quatro casos:
  - nos primeiros 0 a 55 s da partida;
  - quando o GEP fica obsoleto ou ausente;
  - na loja escondida;
  - na oferta de aprimoramento incompleta.

- **Sem o OCR, o que perde a fonte** quando o Overwolf e o TFTAcademy não estão abertos: ouro, nível exato, XP, loja, banco de
  itens/removedores e a oferta de aprimoramentos. Não existe arquivo do jogo, LCU nem API local permitida que traga esses dados
  [V+D]. O que continua:
  - o estágio e a fase (Sentry);
  - o tabuleiro, os itens equipados, a vida e a colocação (`TFTEoGStats.json`);
  - as compras e fusões (`TFT.log`);
  - o piso derivado do nível (XP passivo por estágio).
- **Proposta.** Sem fonte, cada campo sai como **desconhecido explícito** e a interface diz **"sem fonte"**. O motor degrada sem inventar
  valores. A remoção é feita em 6 passos reversíveis (P0 a P5): caracterizar, fechar as lacunas do GEP, desligar a tela por configuração,
  migrar os consumidores para o estado neutro de `core/state/`, apagar os arquivos e, por fim, limpar a documentação.
- **Antes de começar, o usuário precisa confirmar** que aceita reverter a decisão de 2026-10-11 ("o helper não pode depender do
  TFTAcademy/Overwolf; a tela é a fonte própria", `FONTES-DE-DADOS.md` §"Leitor de tela próprio") e a decisão 7 de `ARQUITETURA.md`
  ("a leitura de tela vira verificação cruzada"). Ver a seção 5.

---

## 1. Inventário da leitura de tela

### 1.1 Núcleo [V]

| Arquivo                                                     | Papel                                                                                                                               | Funções e pontos principais                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screen-reader.ps1` (685 linhas)                            | Processo PowerShell 5.1 que captura recortes da janela `UnrealWindow` "TFT" com `CopyFromScreen` e emite uma linha JSON por mudança | Classes C# `Tft` (janela, assinatura de ícone, `Best`), `Glyph` (Otsu, segmentação, `Classify`) e `Bank` (`Lattice`, `YellowBox`, `Column`). Funções `Recognize` (WinRT `Windows.Media.Ocr`), `Read-FieldOcr`, `Glyph-Read`, `Read-StageGlyph`, `Read-Field`, `Hud-Rect`, `Classify-Slot`, `Locate-Column` e `Grab`. Laço em 542-685 com `-IntervalMs 2500`. Modos `-FullPng` (calibração), `-TestImage` e `-TestManifest` |
| `screen-reader.mjs` (472 linhas)                            | Controla o processo e interpreta a saída                                                                                            | `championResolver` (texto da loja → campeão), `readFrame`, `screenReader(root, candidates, champions, augments)` com `sync(active)`, `status()` e `capture(file)`. Internas: `accept` (retenção de 15 s, _debounce_ do banco de 3 s, `reconcileLevel`), `augment` (OCR → id de aprimoramento) e `start` (grava `../data/item-icon-candidates.json` e chama `powershell.exe -File screen-reader.ps1`)                       |
| `screen-glyphs.json` (47 KB)                                | Gabaritos de glifo: ouro 0-9, nível 2-8, XP 0-6/8/`/`, estágio 1-7, selo 2-5                                                        | Lido pelo `.ps1`                                                                                                                                                                                                                                                                                                                                                                                                           |
| `bench-candidates.mjs`                                      | Lista de ícones `[{id, file}]` que o leitor compara com o banco                                                                     | Usado em `server.mjs:297` e em `scripts/lib/screen-corpus.mjs`                                                                                                                                                                                                                                                                                                                                                             |
| `rules.mjs:35` → `core/state/level.mjs:61` `reconcileLevel` | Junta o número lido com o total do XP                                                                                               | Só `screen-reader.mjs:224` o usa                                                                                                                                                                                                                                                                                                                                                                                           |

### 1.2 Onde a tela entra no servidor [V]

O arquivo `server.mjs` está em transição.

- `:14`: import.
- `:297-306`: `benchCandidates` e `screenReader(...)`.
- `:307`: `screen.stop()` no `exit`.
- `:369`: `screen.stop()` no início de partida.
- `:321`: `createStateHub({ screen, gameFiles, gep })`.
- `:614`: `screen.sync(InProgress|Reconnect)` em `buildStateBody`.
- `:746`: `sources.sync` do laço automático, usado em `app/auto-refresh.mjs:101,151,266`.
- `:769`: `/api/health.screenReader.running`, sem nenhum consumidor em `v2/` nem em `overlay/`.
- `:902-911`: `POST /api/screen-capture`, que grava `../data/screen-calibration.png`. Não há chamador em `v2/` nem em `overlay/`.
- `:576`: aviso fixo "A loja é lida da tela quando o leitor está ativo".

A mescla acontece em `app/state.mjs` `createStateHub().seen`, nesta ordem:

1. `mergeSources(screen.status(), gameFiles.status())` (`game-log.mjs:397`): o estágio do Sentry vence o da tela e o resto vem da tela.
2. `levelTracker().apply` (`level.mjs` → `core/state/level.mjs` `reduceLevel`): valida o nível e dá o piso derivado.
3. `reduceSources` (`core/state/precedence.mjs`): histerese de 3 leituras e contagem de divergência GEP × tela.
4. `mergeGep` (`gep-reader.mjs:1151`): o GEP sobrescreve campo a campo.

**Atenção:** `body.screen` (`server.mjs:633`) é o nome do **estado mesclado inteiro** (GEP + arquivos + tela), não só do OCR. Por isso a
maioria dos "consumidores de `screen.*`" continua precisando dos dados depois da remoção. O que muda para eles é o nome e a origem.

### 1.3 O que cada dado da tela alimenta [V]

**Campos que só existem pelo OCR:**

| Campo                                                                               | Consumidores                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screen.running`, `window`, `error`                                                 | `v2/js/model.js:298-299` → `main.js:385` ("Leitor de tela: …") e `overlay/hud/view.mjs:486` → `overlay/hud/health.mjs:78-112` ("Leitura de tela em uso / em reserva") |
| `levelSource` (`ocr` / `ocr+xp` / `xp` / `held`), `levelConflict`, `levelAmbiguous` | `model.js:254` (`levelInfo.conflict`)                                                                                                                                 |
| `bankDebug`, `bankGeometry`                                                         | Nenhum consumidor em código, só documentação                                                                                                                          |
| `stale.{gold, level, xp, stage}`                                                    | `model.js:254,263` e `shop-match.js:69`                                                                                                                               |

**Campos que a tela divide com o GEP:**

| Campo                           | Consumidores no servidor e no núcleo                                                                                                                                       | Consumidores na interface e no overlay                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `gold`                          | `core/state/inputs.mjs:50`, `analysis-key.mjs:58`                                                                                                                          | `model.js:258`, `ui/hud.js:282-312`, `live-mock.js:666`                                       |
| `level`                         | `inputs.mjs:38`, `analysis-key.mjs:59,64`                                                                                                                                  | `model.js:245-251`, `api.js:108-113` (revisão)                                                |
| `xp`                            | `inputs.mjs:29`, `analysis-key.mjs:48`                                                                                                                                     | `model.js:257` → `panel.js:326` ("XP não lido da tela")                                       |
| `shop`                          | `inputs.mjs:26`, `analysis-key.mjs:50`, `core/catalog/wisps.mjs:342` (`wispsOfScreen`); motor via `stage.mjs:349` `shopRead`                                               | `shop-match.js:41-69` (`shopView`, "confiável" vs "provável"), `overlay/hud/view.mjs:483,487` |
| `items`, `bank`, `unknownItems` | `item-holdings.mjs:69` (`recommendInventory`), `app/recommend.mjs:345-347` (`bankRead` → `engine.mjs:552`, `item-plan.mjs`), `carousel-view.mjs:63`, `analysis-key.mjs:61` | `v2/js/items.js:213-224` → `main.js` → `ui/inventory.js`, `overlay/hud/view.mjs:653`          |
| `removers`                      | `inputs.mjs:30-31`, `analysis-key.mjs:55`                                                                                                                                  | —                                                                                             |
| `augments` (oferta)             | `inputs.mjs:23` ("Oferta lida da tela"), `analysis-key.mjs:51`                                                                                                             | Seção Aprimoramentos do Ao vivo                                                               |
| `stage`                         | Sentry vence; `inputs.mjs:22`, `carousel-view.mjs:43`, `recommend.mjs:393,472`                                                                                             | `model.js:264`, `main.js:114,329`                                                             |

**Rótulos de origem que dizem "tela":**

- `core/state/inputs.mjs:43-48` e `v2/js/api.js:113`: `levelSource` = `"tela"` **inclusive quando o nível veio do GEP**.
- `v2/js/ui/hud.js:248` e `overlay/hud/view.mjs:21-25,109`: tratam `levelSource !== "tela"` como incerteza.
- `v2/js/model.js:152-210` (`gepNote`, `SCREEN_FIELDS`): "usando a leitura de tela", "Lendo da tela: …", chip "· tela".
- `overlay/hud/health.mjs:10` (`SCREEN_SOURCES`): conta `"derived"`/`"derivado"` como leitura de tela.
- `core/state/field.mjs:5-13,59-75` e `core/state/game-state.mjs:6-11`: a origem `"screen"`, com confiança `"read"`.

**Não leem `screen`:** `engine.mjs`, `strategy.mjs`, `stage.mjs`, `carousel.mjs`, `analysis-worker.mjs` e `analysis-protocol.mjs`. O motor só
recebe `options` (`levelEstimated`, `levelSource`, `bankRead`, `shop`) [V].

### 1.4 Ferramentas, dados e scripts de tela [V]

**Só de tela (saem na remoção):**

- `screen-accuracy.mjs` (raiz, 277 linhas).
- `scripts/screen-accuracy.mjs`, `scripts/screen-glyphs.mjs`, `scripts/screen-fixtures.mjs`.
- `scripts/lib/glyph-train.mjs`, `scripts/lib/screen-corpus.mjs` (usa ffmpeg e os vídeos do TFTAcademy).

**Usam o leitor de passagem (precisam de ajuste):**

- `scripts/bench-state.mjs:17,44-54`: cria o leitor com um `launch` que lança exceção.
- `live-mock.js:647-687,744,1131-1174`: grupo "Leitura da tela".
- `live-mock-base.json`: chave `screen` com `running`, `error` e `window`.

**Dados:**

- `tests/fixtures/screen/`: 24 PNG mais `index.json`, 2,3 MB.
- `tests/fixtures/item-bank-*.png`, `tests/fixtures/classify-bank.ps1`, `tests/fixtures/make-canvas.ps1`.
- `../data/item-icon-candidates.json`: regravado a cada início.
- `../data/screen-calibration.png`: 3,1 MB, dado do usuário.

**Ficam** (não são OCR):

- `assets/`: ícones da interface.
- `overlay/hud/geometry.mjs` (`HUD_REGIONS`): layout do overlay. Copia as frações do `.ps1`, mas não captura pixels.
- `overlay/game-tracker.mjs`: só a posição da janela.
- `overlay/hud/calibrate.mjs` (F7): calibração do overlay.
- `capture.mjs` e `replay.mjs`: arquivo do tabuleiro.

**Scripts de início e parada:**

- `start-all.ps1`, `start-background.ps1`, `start.ps1` e `supervisor.ps1` **não citam o leitor**: ele nasce dentro do `server.mjs`.
- Só `stop.ps1:1,14-16` o cita: mata os `powershell.exe` cuja linha de comando contém `screen-reader.ps1`.
- Não existe `package.json` em `helper/`.

### 1.5 Testes [V]

Os números são contagens de `test(`.

**Só de tela (saem no P4):**

| Arquivo                                                           | Testes |
| ----------------------------------------------------------------- | -----: |
| `tests/screen-reader.test.mjs`                                    |      9 |
| `tests/screen-fixtures.test.mjs`                                  |      2 |
| `tests/screen-accuracy.test.mjs`                                  |      6 |
| `tests/screen-glyphs.test.mjs`                                    |      5 |
| `tests/screen-independence.test.mjs`                              |      2 |
| `tests/item-bank.test.mjs` (inclui 1 teste de `bench-candidates`) |      9 |
| **Total**                                                         | **33** |

**Mistos (trocar só a parte de tela):**

- `tests/overlay-geometry.test.mjs:64-119` lê o `.ps1` para conferir `HUD_REGIONS` e `Hud-Rect`.
- `tests/level.test.mjs:~185-190` executa `Hud-Rect`; os casos 40-178 testam o nível do OCR e o piso.
- `tests/item-holdings.test.mjs:378` "(f) o banco lido da tela chega ao motor" usa `screenReader`.
- `tests/auto-refresh.test.mjs:95,203,312` usa `sources.sync`.
- `tests/core-state.test.mjs:151-530`: precedência, histerese e divergência GEP × tela.
- `tests/gep-reader.test.mjs:675-760,1093,1441-1519`: reserva da tela por campo.
- `tests/game-log.test.mjs:295`.
- `tests/core-wisps.test.mjs:195-242,422` (`wispsOfScreen`).
- `v2/js/model.test.mjs:37,404,522-612` (chip "a tela assumiu").
- `v2/js/shop-match.test.mjs:27,76,290`.
- `tests/overlay-page.test.mjs:169`, `tests/overlay-hints.test.mjs:259,359`, `tests/overlay-hud.test.mjs:347`.

**Montam `state.screen` só como entrada:** `analysis-key`, `api`, `buy-copies`, `item-source`, `next-item`, `panel`, `carousel-ui`,
`champion-items` e outros. Esses mudam só no P3, se a chave for renomeada.

### 1.6 Documentação [V]

- `README.md`:
  - §"Leitura da tela" (77-82);
  - loja por OCR (91);
  - `strategy.mjs` "lidos da tela" (97);
  - removedor (127);
  - "Corrigir dados e calibrar leitura" (135);
  - aprimoramentos pela tela (179, 183);
  - laço automático "liga o leitor de tela" (205-210).
- `FONTES-DE-DADOS.md`:
  - tabela-resumo (29-36);
  - §"Nível" (84-117);
  - §"Banco de itens e loja" (214-262);
  - precedência (528-568);
  - §"Leitor de tela próprio" inteira (588-685);
  - 692 e 823.

  Está desatualizado em dois pontos [V no banco]: hoje `settings.record_games` vale `true` (o doc diz `false`, ~391) e `ended_at`,
  `match_id` e `final_placement` vêm preenchidos (o doc diz nulos, ~374).

- `ARQUITETURA.md`: decisão 7 (750) e linhas soltas (44, 84, 106, 115, 127, 255, 400, 405, 495, 618, 681, 718, 838, 1587, 1632, 1801,
  1939).
- `overlay/README.md`: 47, 55, 88-90 e 137.
- `core/README.md`: 8 ("precedência GEP x tela").
- `pesquisa/*.md`: são registros históricos e não se reescrevem (ver P5).

---

## 2. Cobertura do GEP campo a campo

**Fonte:** `gep-reader.mjs`, que lê nesta ordem a ponte própria `%APPDATA%\TFT Helper Bridge\tft-events.db` e o TFTAcademy
`%APPDATA%\TFTAcademy\tft-events.db`. O banco é aberto em `readOnly`/`immutable`, no máximo uma leitura por segundo. Ele é consultado
pelo laço do servidor a cada ~3 s e por `/api/state`.

**Frescor:** é o do app inteiro. O último evento de qualquer tipo precisa ter menos de 60 s (`GEP_STALE_MS`). A fonte também é recusada
fora de partida, em partida encerrada, com set diferente e em outra partida.

**Medição desta data, na cópia do banco real** [V]:

- 29.881 eventos em 10 partidas, de 2026-09-11 a 2026-10-11, 7 delas completas (27 a 37 min).
- Resolução de 1 s.
- `created_at - timestamp` = 0.
- O maior silêncio de qualquer evento foi 36 s em todas as partidas completas.
- O primeiro ouro, XP e loja chegam de 0 a 55 s depois do início.
- O nível 1 nunca é emitido.

| Dado                         | Tela hoje                          | GEP (`feature.key`)                                             | Latência e confiabilidade medidas                                                                                                                            | Alternativa estruturada (sem GEP)                                                                                              | Sem OCR e sem GEP                    |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Ouro                         | glifo, 98 %                        | `me.gold` (`{}` = 0 inferido)                                   | Por mudança; intervalo p50 1 s, p90 26 s, máx. 101 s; 100 % das rodadas; casa com 50/50 compras [D]                                                          | **Nenhuma**: `TFT.log`, `TFTEoGStats`, LCU e porta 2999 não têm ouro                                                           | **Sem fonte**                        |
| Nível                        | glifo + total do XP                | `me.xp.level` (validado por `levelConsistent`)                  | Só quando muda; p50 15 s, p90 77 s; falta em 7 a 10 rodadas por partida (sem mudança = vale o último); nível 1 nunca é emitido; nível máximo sem amostra [?] | **Piso derivado** do XP passivo pelo estágio do Sentry (`core/state/level.mjs`); estimativa pelo tabuleiro como último recurso | Só piso (`≥N`) ou estimativa marcada |
| XP                           | glifo                              | `me.xp` (`current_xp/xp_max`)                                   | Igual ao nível; transitório de <1 s ao subir                                                                                                                 | Nenhuma                                                                                                                        | **Sem fonte**                        |
| Estágio                      | glifo (reserva)                    | `match_info.round_type`                                         | 1 por rodada; o GEP fica às vezes uma rodada atrás [D]                                                                                                       | **Sentry `game.tft.round`**, observado, lido a cada 0,4 s, **já vence o GEP**                                                  | Coberto                              |
| Fase                         | —                                  | `round_start`/`battle_*` existem e não são lidos                | —                                                                                                                                                            | **Sentry `game.tft.phase`**                                                                                                    | Coberto                              |
| Loja (5 cartas)              | OCR do Windows, 95 %               | `store.shop_pieces` + `store.shop_visible`                      | p50 2 s, p90 46 s; 27/27 rodadas; 99,8 % no catálogo [D]; loja escondida não substitui                                                                       | Nenhuma                                                                                                                        | **Sem fonte** (`shopRead=false`)     |
| Wisps da loja                | via loja da tela (`wispsOfScreen`) | dentro de `shop_pieces` + catálogo de Wisps                     | 28/28 no catálogo numa partida [D]; não reconferido nesta data [?]                                                                                           | Nenhuma                                                                                                                        | Sem fonte                            |
| Banco de itens + removedores | ícones, 97 %                       | `bench.item_bench` (só a linha local, identificada pelo roster) | p50 1 s, p90 9 s; 100 % das rodadas                                                                                                                          | `TFT.log ItemFlyToBench`: só a **contagem**, estimada                                                                          | **Sem fonte** (só "chegou item")     |
| Oferta de aprimoramentos     | OCR, só nas rodadas ≤ 2            | `augments.me`                                                   | 3 rodadas por partida; 15/15 no catálogo [D]; 21 de 78 vazios (tela fechada)                                                                                 | `TFTEoGStats.players[].augments`: vazio durante a partida [?]                                                                  | **Sem fonte** (registro manual)      |
| Aprimoramentos escolhidos    | a tela nunca leu                   | `augments.picked_augment`                                       | Cumulativo, 3 por partida                                                                                                                                    | Registro manual (que já prevalece)                                                                                             | Manual                               |
| Reserva (bench)              | a tela não lê (decisão)            | `bench.bench_pieces`                                            | p50 2 s, p90 41 s                                                                                                                                            | `TFT.log`: compras e fusões dão só um teto (`unitLedger`)                                                                      | Sem fonte, como hoje                 |
| Carrossel (peças)            | a tela não lê                      | `carousel.carousel_pieces`                                      | 1 evento por carrossel                                                                                                                                       | Sentry fase `Draft` (só detecta)                                                                                               | Só detecção; lista por prioridade    |
| Tabuleiro e itens equipados  | —                                  | `board.board_pieces` existe e **não é lido**                    | —                                                                                                                                                            | **`TFTEoGStats.json`** (`capture.mjs`, 0,5 s); latência de regravação [?]                                                      | Coberto                              |
| Vida e colocação             | —                                  | `me.health` e `me.rank` existem e não são lidos                 | —                                                                                                                                                            | **`TFTEoGStats.json`** e LCU                                                                                                   | Coberto                              |
| Partida (início e fim, id)   | —                                  | `match_state`, `games.*`                                        | —                                                                                                                                                            | **LCU `gameflow`**, Sentry `game.id`, `match.mjs`                                                                              | Coberto                              |
| Rivais                       | —                                  | Excluídos por política                                          | —                                                                                                                                                            | `TFTEoGStats.json` (tabuleiros e vida de todos)                                                                                | Coberto (sem bancos)                 |

**Lacunas do GEP mesmo com o TFTAcademy aberto.** Hoje a tela as cobre:

| #   | Lacuna                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------- |
| L1  | Primeiros 0 a 55 s da partida: sem ouro, XP e loja; nível 1 nunca é emitido                              |
| L2  | Loja com `shop_visible=false`: hoje mantém a da tela                                                     |
| L3  | Oferta de aprimoramentos incompleta (carta fora do catálogo ou menos de 2 cartas): hoje mantém a da tela |
| L4  | Banco de itens com identidade local `desconhecida`/`divergente`: hoje cai para a tela [D]                |
| L5  | Wisps fora do GEP                                                                                        |

**Fontes estruturadas alternativas** (`FONTES-DE-DADOS.md`, reconferidas no código):

- `game-log.mjs` lê o `__sentry-event`, que dá estágio, fase, id, fila e set.
- `game-log.mjs` lê também o `TFT.log`, que dá compras, fusões, a contagem de itens e o carrossel, tudo marcado como estimativa.
- `capture.mjs` e `match.mjs` leem o `TFTEoGStats.json`: tabuleiros, itens equipados, vida, colocação e Riot ID.
- No LCU o servidor só lê `gameflow`, `session` e `current-summoner`. **Não há rota de estado do TFT**.
- A Live Client Data (porta 2999) recusa conexão no TFT.

Nenhuma dessas fontes substitui ouro, XP, loja ou banco de itens.

---

## 3. Sem o Overwolf/TFTAcademy abertos

### 3.1 Hoje

O `gepStatus` cai para `obsoleto` em até 60 s, ou para `ausente`. O chip diz "GEP off · tela" e a tela assume ouro, nível, XP, loja,
itens e oferta de aprimoramentos. A cobertura disso está em `tests/screen-independence.test.mjs`.

### 3.2 Proposta sem OCR: "sem fonte" explícito e motor degradado, sem inventar

1. **Estado.** Cada campo sem fonte sai `value: null` com `source: null` (`unknownField()` de `core/state/field.mjs`, que já existe).
   Nunca sai lista vazia nem zero inventado. O nível sai como piso derivado (`source: "derived"`, `minimum: true`) quando há estágio do
   Sentry. A reserva continua `null`, como hoje.
2. **Interface e overlay.**
   - O chip passa de "GEP off · tela" para **"GEP off · sem fonte"**. A dica lista o que ficou desconhecido ("ouro, XP, loja, itens,
     aprimoramentos: abra o Overwolf com o TFTAcademy (gravação ligada) ou a ponte própria").
   - O HUD mostra "—" no ouro e no XP e `≥N` no nível.
   - A loja e o banco de itens mostram "sem fonte" em vez de vazio.
   - A saúde do overlay passa a dizer "sem fonte" em vez de "leitura de tela em reserva".
3. **Motor.** Hoje a maior parte já degrada sem inventar:
   - `gold: null` vem de `inputs.mjs`, que "nunca usa padrão";
   - `shopRead=false` (`stage.mjs:349`) desliga a compra pela loja;
   - `bankRead=false` (`app/recommend.mjs:345`) zera o banco do motor;
   - `levelEstimated=true` faz a estratégia dizer "nível não lido" e não calcular odds nem rolagem.

   **Ponto que inventa:** `FALLBACK_LEVEL = 7` (`core/state/inputs.mjs:8`) entra quando não há leitura, nem piso, nem tabuleiro. Mesmo
   marcado `levelEstimated`, é um número inventado (decisão D4).

4. **Partida revista** (`api.js`): continua usando os campos guardados.

### 3.3 Ponte GEP própria (`overwolf-bridge/`, agente `tft-overwolf-gep`) como dependência

**Estado** [V]:

- Esqueleto ow-electron com 1103 linhas e testes próprios.
- Grava no mesmo esquema e já é consumido: `gepReader` tenta a ponte antes do TFTAcademy (`origin: "proprio"`).
- **Nunca rodou**: não há `node_modules` nem `%APPDATA%\TFT Helper Bridge\`.
- Falta a aprovação do app no Overwolf e a `OW_DEV_KEY`, que são passos do usuário.
- **Não pede `augments`** (política da Riot) nem `board`.

**Avaliação:**

- **Remove a dependência do TFTAcademy.** Isso protege contra mudanças de esquema e contra a gravação desligada.
- **Não remove a dependência do Overwolf.** Com só a ponte, a oferta e os escolhidos de aprimoramento ficam no registro manual.
- **Recomendação:** não bloquear a remoção do OCR na ponte. O TFTAcademy já entrega tudo o que a tela lia. A ponte é o plano B para
  quando o TFTAcademy mudar de esquema, sair do ar ou desligar a gravação. Ela entra como passo paralelo (P-ponte, fora deste plano),
  com critério de pronto de uma partida real gravada pela ponte e `gepStatus.origin = "proprio"` ativo.
- **Risco de esquema:** se o TFTAcademy mudar o esquema, o estado `esquema-desconhecido` já existe e, sem OCR, tudo vira "sem fonte".
  Mitigação: teste de contrato do esquema com a fixture `tests/fixtures/gep-events.json`, mais o aviso claro no chip.

---

## 4. Passos incrementais

**Regras para todos os passos:**

- A suíte fica verde a cada passo: `node --test tests/*.test.mjs v2/js/*.test.mjs *.test.mjs`, mais
  `node --test overwolf-bridge/test/bridge.test.mjs` quando tocar o GEP.
- O golden (`node --test tests/golden.test.mjs`) não muda sem diferença registrada.
- Cada passo é um commit separado, que cabe ao orquestrador.
- A reversão padrão é `git revert` do commit do passo. Nunca stash, checkout ou reset em árvore compartilhada.
- Ao vivo, só com o servidor reiniciado pelo usuário, nunca por agente.

### P0. Caracterização (nenhuma mudança de comportamento)

- **Arquivos:**
  - novos: `tests/no-screen.test.mjs` e `tests/fixtures/no-screen/*.json`;
  - leitura: `app/state.mjs`, `gep-reader.mjs`, `core/state/*`, `tests/golden/*`, `tests/fixtures/gep-events.json`.
- **Testes de caracterização:**
  1. **Replay de partida gravada sem tela.** Passa os eventos de `gep-events.json` (e, fora do repositório, uma cópia de uma partida
     completa do banco real) por `createStateHub` com um leitor de tela nulo (`status()` só com nulos). Congela, por rodada, `sources`,
     `stale` e os valores de ouro, nível, XP, loja, itens, oferta e Wisps. Isso documenta L1 a L5 como estão.
  2. **GEP ausente e obsoleto sem tela.** Congela o `GameState` (todos `unknownField`, nível piso) e o `buildModel` da interface (chip
     atual "GEP off" com "Nada lido da tela agora").
  3. **Golden com a tela vazia.** Roda os 17 cenários de `tests/golden/scenarios.mjs` com `screen` reduzido ao que o GEP daria e
     registra os resultados (base de comparação para P2 e P3).
- **Pronto:** os testes novos passam contra o código atual; a suíte e o golden estão verdes; o arquivo de partida real fica fora do commit
  (dados pessoais).
- **Reverter:** apagar os testes novos.
- **Risco:** baixo. **Esforço:** ~0,5 dia. **Depende de:** nada.

### P1. GEP como fonte primária de cada campo, com as lacunas fechadas sem a tela (a)

| Sub | Mudança                                                                                                           | Arquivos                                                                                                                                         | Comportamento novo (com tela ainda ligada)                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| P1a | Rótulo de origem neutro: `levelSource` "tela" → "lido" (ou "gep"/"lido"), e `SCREEN_SOURCES` sem "derived"        | `core/state/inputs.mjs`, `v2/js/api.js`, `v2/js/model.js`, `v2/js/ui/hud.js`, `overlay/hud/view.mjs`, `overlay/hud/health.mjs` e os testes deles | Nenhum no motor (só texto e marcação de incerteza). O golden só muda se `analysis.levelSource` aparecer nele: registrar |
| P1b | L2 loja escondida: a loja do GEP escondida vira `shopRead=false` com `stale` em vez de cair para a tela           | `gep-reader.mjs` `mergeGep`, `core/state/precedence.mjs`                                                                                         | Com tela ligada, a tela ainda pode preencher; o teste cobre o caso "sem tela"                                           |
| P1c | L3 oferta incompleta: aceitar a oferta parcial com as cartas desconhecidas marcadas (`unknown`)                   | `gep-reader.mjs`, `core/state/inputs.mjs`, `augment-advice.mjs`                                                                                  | **Do agente `tft-aprimoramentos`** (seção 6)                                                                            |
| P1d | L4 identidade local não confirmada: banco "sem fonte" com motivo `identity`, em vez de cair para a tela           | `gep-reader.mjs`, `app/state.mjs`                                                                                                                | Sem tela: desconhecido explícito                                                                                        |
| P1e | L5 Wisps: `wispsOfScreen` passa a ler só `screen.wisps` (do GEP); o ramo "loja lida" fica morto até o P4          | `core/catalog/wisps.mjs`, `v2/js/wisps.js`                                                                                                       | Igual com GEP ativo                                                                                                     |
| P1f | L1 início da partida: piso derivado do nível já cobre (`≥1`); ouro, XP e loja ficam desconhecidos até o 1º evento | só testes (o comportamento já é esse sem tela)                                                                                                   | —                                                                                                                       |

- **Testes:** os casos de P0 passam a esperar o comportamento novo. `tests/gep-reader.test.mjs:737-760,1441-1475` ganham o ramo
  "sem tela".
- **Pronto:**
  - com o leitor de tela nulo, nenhum campo vem de `"screen"`;
  - cada lacuna sai `null` com motivo;
  - o golden é idêntico ou tem as diferenças registradas.
- **Reverter:** `git revert` por subpasso.
- **Risco:** médio em P1c e P1d (GEP e aprimoramentos em edição), baixo no resto. **Esforço:** 1 a 1,5 dia. **Depende de:** P0.

### P2. Tela opcional e desligada por configuração (b)

- **Arquivos:**
  - `server.mjs` (instancia ou não);
  - novo `app/no-screen.mjs`: objeto nulo com a mesma interface, em que `status()` devolve nulos e `disabled: true`, `sync` não faz
    nada e `capture` responde 410;
  - `app/auto-refresh.mjs` (o `sync` vira nada);
  - `v2/js/model.js` (`gepNote`: "sem fonte" quando a tela está desligada);
  - `overlay/hud/health.mjs`;
  - `/api/health` (`screenReader: { enabled: false }`).
- **Configuração:** `TFT_SCREEN_READER=0|1`, no mesmo padrão de `TFT_ANALYSIS_WORKER`.
  - Fase 1: o padrão continua `1` e o usuário testa com `0`.
  - Fase 2: depois de 3 partidas reais com `0` sem regressão, o padrão vira `0`.
- **Testes:**
  - `tests/no-screen.test.mjs` com `TFT_SCREEN_READER=0` (estado, chip e saúde);
  - `tests/auto-refresh.test.mjs` sem `sources.sync`;
  - `v2/js/model.test.mjs` com o chip novo ("GEP off · sem fonte").
- **Pronto:**
  - com `0`, nenhum `powershell.exe` com `screen-reader.ps1` é criado (o teste usa o `launch` falso, sem processo real);
  - `/api/state` traz os campos desconhecidos explícitos;
  - a interface e o overlay dizem "sem fonte";
  - a suíte está verde;
  - o golden de P0 cenário 3 é idêntico.
- **Validação ao vivo (usuário):** 1 partida com o TFTAcademy ativo e `TFT_SCREEN_READER=0`. Os números batem com o jogo. A partir da
  1ª rodada com eventos do GEP, nenhum campo fica desconhecido.
- **Reverter:** `TFT_SCREEN_READER=1`, sem precisar revert de código.
- **Risco:** baixo. **Esforço:** ~1 dia. **Depende de:** P1.

### P3. Consumidores leem o estado neutro de `core/state/` em vez de `screen.*` (c)

- **Ideia:** o estado mesclado deixa de se chamar `screen`.
  - `core/state/game-state.mjs` `buildGameState` vira o contrato único, com os valores completos e não só o resumo
    (`summarizeState` hoje troca listas por contagem).
  - O `/api/state` publica o estado como `gameState` com valores. Mantém `screen` como **apelido somente leitura** durante uma versão,
    para o front antigo em cache e o `live-mock`.
- **Simplificações no núcleo:**
  - `mergeSources` deixa de receber a tela: arquivos do jogo mais GEP.
  - `core/state/precedence.mjs` encolhe para o único campo ainda disputado, o estágio (Sentry > GEP). A divergência GEP × tela some;
    pode virar GEP × Sentry no estágio, que já é observada como "GEP uma rodada atrás".
  - `core/state/field.mjs` e `game-state.mjs` perdem a origem `"screen"`.
- **Arquivos:**
  - **servidor e núcleo:** `app/state.mjs`, `game-log.mjs` (`mergeSources`), `gep-reader.mjs` (`mergeGep`), `core/state/precedence.mjs`,
    `field.mjs`, `game-state.mjs`, `inputs.mjs`, `analysis-key.mjs`, `level.mjs`, `app/recommend.mjs`, `app/carousel-view.mjs`,
    `item-holdings.mjs`;
  - **interface:** `v2/js/model.js`, `api.js`, `main.js`, `items.js`, `shop-match.js`, `wisps.js`, `panel.js`, `ui/hud.js`;
  - **overlay:** `overlay/hud/view.mjs`, `health.mjs`;
  - **mocks:** `live-mock.js`, `live-mock-base.json`.
- **Cuidado com a chave de análise.** `core/state/analysis-key.mjs` é calculada igual no cliente e no servidor. Mudar de `state.screen`
  para `state.gameState` tem de produzir **a mesma chave** para os mesmos valores. Teste de contrato: chave antiga = chave nova sobre
  todos os estados de `tests/fixtures` e `live-mock-base.json`.
- **Ordem interna** (cada uma um commit):
  1. Publicar `gameState` com valores, mantendo `screen` igual.
  2. Migrar o servidor e o núcleo.
  3. Migrar a interface.
  4. Migrar o overlay.
  5. Remover o apelido `screen`.
- **Testes:**
  - Teste de contrato novo em `tests/architecture.test.mjs`: nenhum arquivo fora de `core/state/` e `app/state.mjs` lê `.screen.` nem
    usa a origem `"screen"`. Ele começa como catraca com a lista atual de exceções e termina com zero.
  - Golden idêntico.
  - Os testes de `v2/` e do overlay são reescritos sobre `gameState`.
- **Pronto:**
  - a catraca chega a 0;
  - o golden é idêntico;
  - a suíte está verde;
  - a chave de análise é igual antes e depois.
- **Reverter:** `git revert` por subpasso. Enquanto o apelido existe, reverter um consumidor não quebra os outros.
- **Risco:** **médio-alto** (muitos arquivos em edição por outros agentes). **Esforço:** 2 a 3 dias. **Depende de:** P2, mais a janela
  combinada com `tft-itens-central` e `tft-aprimoramentos` (seção 6).

### P4. Remoção do leitor de tela (d)

- **Apagar:**
  - `screen-reader.ps1`, `screen-reader.mjs`, `screen-glyphs.json`, `bench-candidates.mjs`, `screen-accuracy.mjs`;
  - `scripts/screen-accuracy.mjs`, `scripts/screen-glyphs.mjs`, `scripts/screen-fixtures.mjs`;
  - `scripts/lib/glyph-train.mjs`, `scripts/lib/screen-corpus.mjs`;
  - `app/no-screen.mjs` (vira desnecessário);
  - `tests/screen-*.test.mjs` (5 arquivos), `tests/item-bank.test.mjs`;
  - `tests/fixtures/screen/`, `tests/fixtures/item-bank-*.png`, `tests/fixtures/classify-bank.ps1`, `tests/fixtures/make-canvas.ps1`.
- **Editar:**
  - `server.mjs`: tirar o import, `benchCandidates`, `screen.*`, `POST /api/screen-capture`, `screenReader` do `/api/health` e o aviso
    da loja em `:576`;
  - `stop.ps1`: manter por uma versão o trecho que mata um `screen-reader.ps1` órfão de instalação antiga e depois remover;
  - `core/state/level.mjs`: remover `reconcileLevel`, `levelConflict`/`levelAmbiguous` e o ramo "screen" de `reduceLevel`; manter
    `levelConsistent` e o piso;
  - `rules.mjs`: remover a reexportação;
  - `scripts/bench-state.mjs`;
  - `live-mock.js`: remover o grupo "Leitura da tela";
  - `tests/overlay-geometry.test.mjs`: fixar `HUD_REGIONS` por valores literais em vez de ler o `.ps1`;
  - `tests/level.test.mjs`: remover o teste do `Hud-Rect`;
  - `tests/item-holdings.test.mjs` (f): trocar pelo banco do GEP;
  - `core/catalog/wisps.mjs`: o ramo da loja lida em `wispsOfScreen` vira só GEP, e o nome pode virar `wispsInState`.
- **Dados do usuário:** `../data/item-icon-candidates.json` e `../data/screen-calibration.png` ficam (decisão D6). O código só deixa de
  gravá-los.
- **Testes:** a contagem cai cerca de 33 testes exclusivos de tela, mais os mistos reescritos. É preciso registrar a contagem nova da
  suíte (a referência atual é 421+, segundo `ARQUITETURA.md`). Um teste de arquitetura novo falha se surgir `CopyFromScreen`,
  `Windows.Media.Ocr`, `screen-reader` ou `powershell.exe -File screen` em qualquer arquivo.
- **Pronto:**
  - a suíte está verde;
  - o golden é idêntico;
  - `grep -ri "screen-reader\|screenReader\|CopyFromScreen\|Windows.Media.Ocr"` só acha documentação histórica;
  - o servidor sobe sem o PowerShell do leitor (validação do usuário).
- **Reverter:** `git revert` do commit único do P4. Os arquivos voltam, o P2 ainda tem a flag e com `TFT_SCREEN_READER=1` tudo volta a
  funcionar. Por isso **P2 e P4 não devem ir juntos**.
- **Risco:** baixo, se P3 terminou. **Esforço:** ~1 dia. **Depende de:** P3, mais 3 partidas reais com `TFT_SCREEN_READER=0`.

### P5. Documentação e scripts de início (e)

- `README.md`:
  - trocar §"Leitura da tela" por §"Fontes ao vivo" (GEP, arquivos do jogo, LCU; sem fonte = desconhecido);
  - corrigir 91, 97, 127, 135, 179, 183 e 205-210.
- `FONTES-DE-DADOS.md`:
  - na tabela-resumo, a coluna "reserva: leitor de tela" vira "sem GEP: sem fonte permitida";
  - remover a §"Leitor de tela próprio" (fica no histórico do git; deixar uma linha "removido em <data>, ver `PLANO-REMOVER-OCR.md`");
  - atualizar a precedência;
  - corrigir `record_games` e `ended_at`/`match_id` (desatualizados hoje).
- `ARQUITETURA.md`: decisão 7 reescrita ("GEP > arquivos do jogo > desconhecido"), mais as linhas soltas. `core/README.md:8`.
  `overlay/README.md` 47, 55, 88-90 e 137 (o F7 continua, mas é calibração do overlay).
- `pesquisa/*.md`: **não reescrever** (são registros datados). No máximo uma nota no topo de `00-sistema-atual.md`.
- Scripts de início: `start-all.ps1`, `start-background.ps1`, `start.ps1` e `supervisor.ps1` não mudam, porque não citam o leitor [V].
  `stop.ps1` perde o trecho do leitor uma versão depois do P4.
- **Pronto:** nenhum documento vivo diz que a tela é fonte ou reserva. `grep -n "leitor de tela\|lida da tela\|lido da tela"` só acha
  `pesquisa/` e este plano.
- **Reverter:** `git revert`.
- **Risco:** nenhum. **Esforço:** ~0,5 dia. **Depende de:** P4.

### Resumo da ordem

| Passo                       | Risco           | Esforço | Depende de                                                | Reversão                               |
| --------------------------- | --------------- | ------- | --------------------------------------------------------- | -------------------------------------- |
| P0 caracterização           | baixo           | 0,5 d   | —                                                         | apagar testes                          |
| P1 lacunas do GEP           | médio (P1c/P1d) | 1-1,5 d | P0, `tft-aprimoramentos` (P1c)                            | revert por subpasso                    |
| P2 flag `TFT_SCREEN_READER` | baixo           | 1 d     | P1                                                        | flag `=1`                              |
| P3 estado neutro            | médio-alto      | 2-3 d   | P2, janela com `tft-itens-central` e `tft-aprimoramentos` | revert por subpasso (apelido `screen`) |
| P4 remoção                  | baixo           | 1 d     | P3 + 3 partidas com `=0`                                  | revert do commit                       |
| P5 documentação             | nenhum          | 0,5 d   | P4                                                        | revert                                 |

**O que NÃO fazer agora:**

- integrar `board.board_pieces`, `me.health` ou `match_info.opponent` do GEP. Não é preciso para remover o OCR e depende de decisão de
  política;
- apagar `overlay/hud/geometry.mjs`, `calibrate.mjs` ou `game-tracker.mjs`;
- mexer em `capture.mjs`;
- tocar `pesquisa/`.

---

## 5. Riscos e decisões do usuário

1. **D1. Reverter a independência pela tela.** Em 2026-10-11 ficou decidido que o helper não dependeria do TFTAcademy/Overwolf e que a tela
   seria a fonte própria (`FONTES-DE-DADOS.md` §588). A decisão 7 de `ARQUITETURA.md` diz que a tela é a verificação cruzada. Remover o
   OCR revoga as duas. **Confirmar.**
2. **D2. Partidas sem Overwolf.** Sem o Overwolf, com o TFTAcademy (gravação ligada) ou a ponte, ficam **sem fonte**:
   - ouro, XP, loja, banco de itens e removedores, e a oferta de aprimoramentos;
   - o nível só aparece como piso (`≥N`).

   O helper passa a recomendar comp e posicionamento pelo tabuleiro (arquivo do jogo), mas não compra, rolagem, juros nem itens do banco.
   **Aceitar** esse modo degradado, ou manter o OCR atrás da flag do P2 sem fazer o P4.

3. **D3. Ponte própria.** Para depender só do Overwolf, e não do TFTAcademy, o usuário precisa:
   - aprovar a ideia no Overwolf;
   - gerar a `OW_DEV_KEY`;
   - definir o nome e a identidade;
   - escrever a política de privacidade.

   Mesmo com a ponte, os aprimoramentos ficam **manuais** (a Riot proíbe a feature `augments` em apps de terceiros). Fazer em paralelo
   ou adiar?

4. **D4. `FALLBACK_LEVEL = 7`** (`core/state/inputs.mjs:8`). É usado quando não há nível, nem piso, nem tabuleiro. Sem OCR esse caminho
   fica mais frequente fora do GEP. Manter (marcado como estimado) ou trocar por "nível desconhecido"? Trocar muda a entrada do motor e
   o golden; coordenar com `tft-comp-viabilidade`.
5. **D5. Início da partida (0 a 55 s).** Ouro, XP e loja ficam desconhecidos até o primeiro evento do GEP. Aceitar, ou usar a **regra do
   jogo** (por exemplo, nível 1 em 1-1, já coberto pelo piso), sempre marcada `derived`? O ouro inicial por regra não foi verificado [?]
   e por isso não se propõe.
6. **D6. Arquivos de dados.** `../data/screen-calibration.png` (3,1 MB) e `../data/item-icon-candidates.json`: apagar ou manter?
7. **D7. Ferramentas de medição.** Remover `screen-accuracy`, `screen-glyphs` e `screen-corpus` (ficam no histórico do git), ou guardar
   em `scripts/arquivo/`? O plano propõe remover.
8. **Restrições que continuam** (não são decisões):
   - nada de leitura de memória, injeção, hook ou depurador (Vanguard);
   - nada de captura de tela para fontes novas;
   - GEP só do jogador local, sem rivais;
   - `tft-events.db` sempre somente leitura.

**Riscos técnicos:**

| Risco                                                                                   | Mitigação                                                                                                   |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| R1. O TFTAcademy muda o esquema ou desliga a gravação: tudo vira "sem fonte" de uma vez | `esquema-desconhecido`/`gravacao-desligada` já detectados; teste de contrato do esquema; ponte como plano B |
| R2. A renomeação de `screen` (P3) quebra a chave de análise cliente/servidor            | Teste de igualdade de chave; apelido por uma versão                                                         |
| R3. Arquivos em edição paralela                                                         | Ordem da seção 6; P3 em janela combinada                                                                    |
| R4. A validação ao vivo depende do usuário                                              | P2 com flag antes do P4; 3 partidas reais                                                                   |
| R5. `levelSource` "tela" é usado como sinal de certeza na interface e no overlay        | P1a primeiro, com testes                                                                                    |

---

## 6. Coordenação com os agentes que editam agora

| Agente                                                              | Área que edita                                   | Passos que conflitam                                                                                                                                                                                                                                                        | Como sequenciar                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tft-aprimoramentos`                                                | `gep-reader.mjs`, `core/state/`, `augment-*.mjs` | **P1c** (oferta incompleta é dele), **P1b/P1d** (`mergeGep`), **P3** (`inputs.mjs`, `precedence.mjs`, `game-state.mjs`, `analysis-key.mjs`), **P4** (`core/state/level.mjs`)                                                                                                | P1c entregue por ele ou depois dele. P1b/P1d e P3 só depois de ele fechar as mudanças em `gep-reader.mjs`/`core/state/`                                    |
| `tft-itens-central`                                                 | `core/items/`, itens no motor, `v2/`, `overlay/` | **P1a** (`v2/js/model.js`, `ui/hud.js`, `overlay/hud/view.mjs`, `health.mjs`), **P2** (`gepNote`, saúde do overlay), **P3** (`model.js`, `items.js`, `shop-match.js`, `overlay/hud/view.mjs`, `item-holdings.mjs`), **P4** (`tests/item-holdings.test.mjs`, `live-mock.js`) | P1a e P2 tocam funções pequenas e isoladas (`gepNote`, rótulos); podem ir antes, com aviso. P3 nas partes de `v2/` e `overlay/` só depois que ele terminar |
| `tft-comp-viabilidade`                                              | `engine.mjs`, `comp-score.mjs`, `core/comps/`    | Quase nenhum: o motor não lê `screen`. **D4** (`FALLBACK_LEVEL`) muda as entradas do ranking. O golden de P0/P2/P3 pode ser confundido pelas mudanças dele                                                                                                                  | Fazer o P0 sobre uma base acordada (golden congelado depois do commit dele). D4 só com ele                                                                 |
| Vários (`server.mjs`, `app/*` aparecem modificados no `git status`) | —                                                | P2 e P4 em `server.mjs`; P2 em `app/auto-refresh.mjs`                                                                                                                                                                                                                       | Trechos pequenos e localizados (instância do leitor, `sync`, rota); aplicar em cima do estado do disco no momento                                          |

**Pode começar já, sem conflito:** P0 (só testes novos) e a parte "desatualizada" de P5 (`record_games`, `ended_at`), que fica de fato com
quem edita `FONTES-DE-DADOS.md`.
