# Lentidão ao vivo do helper: causas, evidências e correções

Data: 2026-10-10 (noite, horário local UTC-3; o `server.log` grava em UTC). Investigação somente leitura: nenhum código, dado do jogo ou
processo foi alterado, nenhum `POST /api/recommend`, nenhum benchmark. Medições feitas: 2 `GET /api/state` no servidor vivo, 1 `curl`
ao explorer da MetaTFT, leitura de arquivos e de logs, e três contas únicas e leves em processos isolados (parse de
`scouting-captures.jsonl`, parse e `stringify` de `evidence-cache.json`, laço de CPU de 0,1 s).

Convenção: **[C]** certo (medido ou lido no código), **[P]** provável (consistente com as medições, sem prova direta), **[H]** hipótese.

## 0. Resumo em uma página

1. O `GET /api/state` é barato (3,4 ms offline, 9,8 KB). O que o torna lento ao vivo é **esperar na fila do event loop**: todo o
   `POST /api/recommend` é síncrono (`analyze` até 4 vezes, `structuredClone` de ~1 MB, `tactics`, 3 planos com Monte Carlo,
   `JSON.stringify` de ~1 MB) na mesma thread que atende o `/api/state`. Dois `GET /api/state` que fiz no servidor vivo levaram **0,50 s e
   0,93 s** (offline: 3,7 ms) por cair em cima de uma análise. [C]
2. A espera que o usuário **sente** na HUD é dominada pela **rede do explorer** dentro do `POST`: `base` é 68 % do tempo de uma análise
   (156 s de 229 s numa partida), com até 3 passes de rede e timeout de 30 s por pergunta; o cliente serializa `refresh()` e a HUD fica
   com a leitura velha enquanto isso. [C a medição; P a divisão rede x CPU, porque o log não separa as duas]
3. O código é **10x mais lento ao vivo do que no bench offline** em todas as etapas ao mesmo tempo (`tactics` 91 ms contra 5-14 ms; `clone`
   57 contra 10; `json` 59 contra 12-40). Não é uma etapa: é CPU disputada (jogo + OCR em PowerShell + testes/agentes do desenvolvimento)
   e GC. A mesma versão do servidor foi 6x mais lenta numa partida do que em outra. [C a variação; P a causa]
4. **Quatro** `server.mjs` rodam ao mesmo tempo (o vivo + 3 órfãos de ontem sem porta). Cada partida foi gravada **4 vezes** em
   `match-history.jsonl` e ~74 % das linhas de `scouting-captures.jsonl` são duplicatas. Pouco CPU hoje (~0,5 % cada), mas corrompe dados e
   infla trabalho. [C]
5. O que **cresce**: `data/evidence-cache.json` (5,6 MB para 7,5 MB em 30 min; cada gravação reserializa o arquivo todo, 120 ms
   síncronos), as 11 mil respostas do explorer em memória, o cache de capturas (todas as partidas, 18,7 MB de heap) e a resposta
   (0,74 MB para 1,2 MB ao longo da partida). Não achei vazamento dentro de uma partida: os tempos **caem** com o jogo (ver 3.4). [C]
6. O servidor foi **reiniciado 24 vezes hoje** (44 no log desde ontem), várias no meio de partida. Cada reinício custa 1-2 min de
   análise fria (`base` de 68 e 79 s) e foi onde apareceu o `GET /api/state` de 15,5 s. [C o custo; H a composição dos 15,5 s]

## 1. Onde está o log e como ler

- `tft/helper/server.log` (rotaciona em 1 MB; hoje 86 KB, 815 linhas). Linhas `TEMPO` do M0: uma por análise **calculada**
  (`estado entrada base clone tactics planos plano resto json total bytes base=nova|cache`) e um resumo por ~1 min por rota
  (`n p50 p95 max`). `server.stdout.log` e `server.stderr.log` estão vazios.
- `node scripts/timing-report.mjs` (lê só o arquivo; usado sem argumentos): 231 análises no log inteiro; `base` p50 1.071 ms e p95
  33.838 ms; `total` p50 2.131 ms e p95 38.018 ms; `GET /api/state` 530 requisições, p50 49 ms, p95 727 ms, **máx 15.520 ms**;
  `POST /api/recommend` p50 4.931 ms, máx 91.091 ms.
- O PID 35848 (iniciado 21:27 local = 00:27Z) **já não existe**: o log registra "terminou sem registrar saída" às 21:54:38 e o servidor
  vivo agora é o **PID 22624** (porta 3218, desde 21:54:38). As medições abaixo cobrem os dois e a partida anterior.

Etapas (ms, `server.log`; "arranque" = 1ª análise depois de reiniciar):

| Janela (local)                        | análises | `total` > 3 s | > 10 s | > 30 s | cauda síncrona p50/p95 (`clone+tactics+planos+plano+resto+json`) | `GET /api/state` p95 (mediana das janelas / máx) |
| ------------------------------------- | -------- | ------------- | ------ | ------ | ---------------------------------------------------------------- | ------------------------------------------------ |
| 20:34-21:08 (jogo anterior)           | 81       | 70            | 44     | 16     | 2.327 / 7.207 ms                                                 | 2.851 ms / 11.516 ms                             |
| 21:27-21:54 (jogo das 21:22)          | 143      | 26            | 1      | 1      | 383 / 1.413 ms                                                   | 292 ms / 15.520 ms (arranque; 2.831 depois)      |
| 21:55-22:35 (jogos das 21:57 e 22:28) | 143      | 71            | 14     | 1      | 1.023 / 2.723 ms (21:57-22:15)                                   | 939 ms / 2.873 ms                                |

Offline (M0, ARQUITETURA.md seção "Medições offline"): base invalidada 143 ms por leitura, só loja 44 ms, `GET /api/state` p50 3,4 ms.

## 2. Causas ranqueadas

### C1. Análise síncrona no event loop bloqueia `/api/state`, SSE e o próprio POST seguinte [C]

Caminho (`server.mjs`, handler `/api/recommend`, de `const stages = (res.stages = stageTimer())` até `return json(200, ...)`): tudo
depois do último `await` é uma sequência síncrona sem ponto de saída:

| Trecho                                                                           | Linhas aprox. | Natureza     | Custo ao vivo (log)                                       |
| -------------------------------------------------------------------------------- | ------------- | ------------ | --------------------------------------------------------- |
| `analyze(snapshot, catalog, options)` e as 1-3 reanálises por passe de evidência | ~1097-1115    | CPU síncrona | não logado; offline 23-157 ms por chamada; até 4 chamadas |
| `structuredClone(built)` (~1 MB)                                                 | ~1141         | CPU/GC       | `clone` p50 57-139 ms, p95 334-528, máx 1.379             |
| `tactics(base, ...)`                                                             | ~1149         | CPU          | `tactics` p50 91-222 ms, p95 441-725, máx 1.030           |
| `playbook`/`stagePlan`/`strategy` x (3 planos + preview), `rollSim` Monte Carlo  | ~1193-1215    | CPU          | `planos` p50 97-225 ms, p95 554-1.232, máx 2.695          |
| `augmentAdvice`, `decide`, `contestAlert`                                        | ~1285-1300    | CPU          | `resto` ~1-3 ms                                           |
| `JSON.stringify` da resposta (0,74-1,2 MB) em `json()`                           | ~790          | CPU/alocação | `json` p50 59-169 ms, p95 215-496, máx 976                |

Medição de impacto no `/api/state`:

- Soma da cauda síncrona = **4,7 % a 10,3 % do tempo de relógio** da partida (só ela, sem contar `analyze`), em blocos de 0,4 a 2,7 s
  (p50 a p95). Um `GET /api/state` que chega num bloco espera até o fim dele.
- `estado` (do `POST`: um `fs.stat` + `fs.readFile` que deveria levar 2 ms) tem p95 de 49-173 ms e máx de 744 a **4.159 ms**; `entrada`
  máx 9.039 ms. Só se explica por fila no loop (outros blocos síncronos antes da continuação da `await`).
- `GET /api/history` (leitura de 76 linhas em memória) levou 971 ms numa janela; `GET /api/comps` 65 ms. Rotas triviais lentas = fila.
- Meus 2 `GET /api/state`: ttfb 0,50 s e 0,93 s, conexão em 25 ms, servidor em jogo, UI aberta.
- O cliente chama `refresh()` a cada 5 s e a cada evento SSE `boards` (debounce 200 ms; `v2/js/main.js:538,558`); cada mudança de
  loja, XP, ouro ou item gera um `POST` novo (`analysisKey`, `v2/js/api.js`). Ritmo medido: 5,3 análises/min, 77 % `base=nova`.

### C2. Rede do explorer dentro do POST: `base` = 68 % do tempo, com timeouts de 30 s [C o tempo; P a causa]

- `base` soma 156 s de 229 s (jogo das 21:22) e 456 s de ~600 s (jogos seguintes). Nos grupos "novas": p50 0,46-1,6 s, p95 5,2-10,4 s;
  picos de **24,6; 31,5; 43,3; 68,2; 78,9 s** (`server.log` linhas 484, 521, 550, 483 e a de 01:10:59Z). 30 s é exatamente o
  `AbortSignal.timeout(30000)` de `evidence.mjs:fetchRows`; até 3 passes seguidos no `server.mjs` (~1100): 30+30+30 s.
- Medi 1 pergunta ao explorer agora: **0,46-0,58 s** por requisição (DNS 0,03-0,06; TLS pronto em 0,32-0,43). Com `CONCURRENCY = 8`, 40
  perguntas novas custam ~3 s por passe; as 142 que faltavam no bench do M0 custam ~9 s. O cache em disco ajuda (11.197 entradas),
  mas cada tabuleiro novo (compra, venda, item) gera filtros novos: ~2.800 respostas novas em 35 min.
- O `POST` espera tudo isso e o cliente, que serializa `refresh()` (flag `busy` em `main.js:421-433`, timeout de 120 s em `api.js`),
  não atualiza a HUD até o `POST` voltar. A tela fica parada mesmo com o loop livre. É a causa mais provável da **sensação** de lentidão
  (HUD atrasada) enquanto C1 explica `/api/state` lento e travado.
- O log não separa `analyze` de rede dentro de `base`. Falta de dado: ver seção 6.

### C3. CPU disputada: o mesmo código é 3-20x mais lento ao vivo e varia entre partidas [C a variação; P a causa]

- Cauda síncrona p50 por janela de 5 min, mesma versão do servidor, mesmo tipo de carga (bytes ~0,8-1,2 MB):

  | Partida (servidor)                                                                    | p50 em +5 / +10 / +15 / +20 / +25 min    |
  | ------------------------------------------------------------------------------------- | ---------------------------------------- |
  | 21:22 (35848), máquina "quieta"                                                       | 703 / 630 / 313 / 261 / 159 ms           |
  | 21:57 (22624)                                                                         | 1.100 / 1.290 / 908 / 1.441 ms           |
  | 20:34 (20076), com 3 órfãos a ~96 % de CPU e suíte rodando (ARQUITETURA.md, Achado 1) | 1.253 / 2.065 / 2.813 / 2.642 / 2.857 ms |

  Offline: `tactics` 5-14 ms, `clone` ~10 ms, `json` 12-40 ms, análise inteira 143-290 ms. Ao vivo as etapas inflam juntas (10x, 6x, 4x),
  inclusive etapas sem E/S: assinatura de **escalonamento/CPU/GC**, não de uma função lenta.

- Concorrentes medidos agora: jogo `TFTClient-Win64-Shipping` (prioridade Alta, 3,6 GB), leitor de tela em PowerShell/OCR (processo filho
  do servidor, ~51 s de CPU em ~6 min, ~118 MB, a cada 2,5 s: `screen-reader.ps1:7,427`), Defender (`MsMpEng` 413 MB), `claude.exe` e
  qualquer teste/benchmark dos agentes. Memória física livre **0,6 GB de 15,7 GB** (standby não contado; pagefile com pico de 4,7 GB). [H que
  a pressão de memória contribua; não medi paginação]
- O servidor vivo roda em prioridade Normal, afinidade total, plano de energia "Alto desempenho", na tomada. Um laço de 3x10^7 `sqrt`
  em processo novo levou 107-120 ms (uns 2x o normal), ou seja, a CPU não está 20x mais lenta; o que falta é **o servidor recebendo
  fatias** quando o jogo está em primeiro plano e há rajadas dos agentes. [H: EcoQoS/prioridade de segundo plano do Windows para o
  processo oculto; só vale testar em partida]
- Efeito do desenvolvimento: o doc do M10a registra "execução do golden passou de 5 min com o jogo aberto"; a ordem do usuário de só
  rodar suítes e benchmarks no fim é a correção operacional certa.

### C4. Reinício do servidor no meio da partida: análise fria e `GET /api/state` de 15,5 s [C o custo; H a composição]

- 24 inícios do servidor hoje (UTC 10-10 00h a 10-11 00h, `grep "INFO  iniciado"`); 44 mortes "à força" no log. O das 21:27 (PID 35848) ocorreu
  com a partida das 21:22 em curso.
- Depois dele: 1ª janela `GET /api/state` n=5, p50 759 ms, **p95 15.520 ms**; 2ª janela p50 3.866 ms; 1ª análise `base` 68.226 ms, `total`
  76.977 ms, `planos` 5.117 ms, `tactics` 1.317 ms, `estado` 4.159 ms na 2ª. No reinício das 20:34 (PID 20076) a 1ª análise também levou 91 s (`total` máx do `timing-report`, 91.091 ms). No
  reinício das 21:54 (PID 22624) a 1ª foi menor (4,2 s), mas `GET /api/state` teve p95 de 1,0-2,9 s nos 15 min seguintes.
- Cabe no arranque, tudo no mesmo loop: carregar 7 MB do cache de evidência (`readFileSync` 79 ms + `JSON.parse` 108 ms medidos), parse
  único de `scouting-captures.jsonl` (342 ms, 14.808 linhas), até 4 atualizações de meta/estatísticas por estarem velhas
  (`updateMeta`/`updateStats`/`updateAugmentStats`/`updateComps`, parse de 50-100 KB cada + `analysisCache.clear()`), 1ª leitura de
  `TFT.log` (89-150 ms para 12-20 MB), espera do LCU (até 2 s), JIT frio (1ª análise 3x a quente), arranque do PowerShell do leitor
  (`Add-Type` de C# e OCR do Windows) e 2-4 análises seguidas. Soma plausível de 5-10 s com CPU disputada, não de 15,5 s. [H]
  A medição de loop-lag (seção 6) fecha isso.

### C5. Quatro processos `server.mjs`: duplicação de dados e de trabalho [C]

- Vivo: 22624 (porta 3218). Órfãos sem porta, de 09/10 22:23, 22:58 e 23:00: **23148, 15540, 37388** (510, 467 e 474 s de CPU acumulada,
  ~50-58 MB, 12 threads). Em 10 s medi +0,03 a +0,09 s de CPU em cada (~0,5 %); não são o gargalo de agora (o M0 viu ~96 % de uma leitura
  durante o jogo; não reproduzi).
- Provas de que gravam: 4 linhas idênticas "partida N iniciada/encerrada/registrada" em `server.log` (00:08:02Z, 00:53:47Z, 01:28:45Z);
  `data/match-history.jsonl` tem **4 registros por `gameId`** (3291708419, 3291719626, 3291734382, 3291766659, 3291790043,
  3291805442); nas últimas 4.241 linhas de `scouting-captures.jsonl`, **3.150 (74 %) são duplicatas**. O comentário de
  `server.mjs:~83` ("segunda instância ... gravava tudo em dobro") confirma que a correção "porta antes de tudo" existe; os órfãos são anteriores.
- Efeito em latência: pequeno hoje (4x linhas em `gameRows`/`hiddenHoldings`, centenas por partida; 4 leituras e hashes de `TFTEoGStats.json`
  por mudança). Efeito em dados: `readHistory` já deduplica por `gameId`, mas `scouting-captures.jsonl` cresce 4x mais rápido (9,5 MB) e
  quem consome por linha (replay, pool-tracker) vê quadruplicatas. Não toquei neles: matar processo é decisão do usuário.

### C6. O que cresce com o tempo [C]

| Item                                     | Crescimento medido/lido                                                                                                  | Custo                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/evidence-cache.json`               | 5,6 MB (22:0x) para 7,5 MB (22:32); 8.419 para 11.197 entradas; TTL de 6 h (`evidence.mjs:TTL_MS`), 99 % são `total?...` | `persist()` = `JSON.stringify` do mapa inteiro, **120 ms síncronos** por gravação (7,2 MB), 2 s após o último lote; sobe linear com o arquivo (~300 ms em ~18 MB, teto de 6 h de jogo); parse no arranque 108 ms |
| `evidenceMap`/`conditionalMap` (memória) | sem limite (só tira `null` a cada 10 min); ~11 mil entradas                                                              | pequeno por entrada; participa da chave `evidenceVersion` e da pressão de GC                                                                                                                                     |
| `replay.mjs` (`cache.games`)             | guarda **todas** as partidas do arquivo; 14.808 linhas = 33 partidas; ~700 linhas (x4 com duplicatas) por partida        | 18,7 MB de heap, 342 ms no primeiro parse, para sempre no processo                                                                                                                                               |
| `baseAnalysisCache` + `analysisCache`    | tetos de 12 + 12 entradas de ~1 MB (ou ~5 MB de heap cada)                                                               | limitado; explica o servidor ir de 216 MB para 314 MB nos primeiros 30 min                                                                                                                                       |
| Resposta de `/api/recommend`             | 0,74-0,80 MB no começo, 1,0-1,2 MB no fim (`compRanking` ~580 KB, `recommendations` ~210 KB)                             | `clone` + `json` sobem junto; v2 só desenha `recommendations[0]`                                                                                                                                                 |
| `TFT.log`                                | 2,3-19,7 MB por partida; leitura incremental por offset (`game-log.mjs:readLog`), ~50 KB a cada 5 s                      | desprezível; só o arranque no meio da partida relê tudo                                                                                                                                                          |
| `server.log`                             | rotaciona em 1 MB                                                                                                        | nenhum                                                                                                                                                                                                           |
| `.sentry-native`                         | 1 pasta `.run` (`__sentry-event` 4 KB)                                                                                   | nenhum                                                                                                                                                                                                           |

Dentro de uma partida os tempos **diminuem** (ver tabela de C3, 21:22: 703 para 159 ms), então não há vazamento que degrade um jogo; a
degradação vem de carga externa, de reinício e do cache de evidência que cresce ao longo do dia.

### C7. Outros pontos lidos, de baixo impacto [C]

- `GET /api/state` em si (handler ~`server.mjs:800`): `readBoardSnapshot` (stat + cópia de 11 KB), `lcu()` (cache de 5 s, não espera depois da
  1ª), `gameFiles.status` (≤ 1 vez a cada 400 ms: `readdirSync` + `statSync` + `readFileSync` de 4 KB + leitura incremental do log),
  `gep.status` (≤ 1 vez/s, **reabre o SQLite**: `PRAGMA` x3 + 3 consultas; 47 ms de pico medido no M0; banco de 100 KB + WAL de 500 KB),
  `streaks.observe`. Soma 3-10 ms quando o loop está livre.
- `watchMatch` a cada 2 s e `captureBoards.scan` a cada 500 ms (+ `fs.watch`) releem e reparseiam `TFTEoGStats.json` (11 KB) em dois lugares
  (`capture.mjs` e `readBoardSnapshot`); custo mínimo.
- Leitor de tela: processo filho, não bloqueia o loop; só consome CPU (acima).
- SSE: eventos pequenos, 1 `EventSource` compartilhado por aba (`sse-share.js`).
- `execFileSync`/`spawnSync`: nenhum no servidor. Síncronos no caminho: `fs.*Sync` do `game-log.mjs`, `appendFileSync` de `diagnostics.mjs`
  (1 stat + 1 append por linha de log), `DatabaseSync` do GEP e os `JSON.stringify/parse` citados.
- `validate()` usa `catalog.items.some(...)` por item do inventário (O(60 x ~300)): irrelevante.

## 3. Correções propostas (ordem: ganho / risco)

### 3.1 Correções pontuais, já possíveis (sem esperar M8/M10)

| #   | Mudança                                                                                                                                                                                                                                                                                       | Ganho esperado                                                                                                                                                | Risco                                                                                                                                                                                                                   | Como validar                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| P0  | **Operacional**: encerrar os 3 órfãos (23148, 15540, 37388) com aprovação do usuário; não reiniciar o servidor no meio de partida; suítes e benchmarks só no fim (já ordenado)                                                                                                                | Tira a duplicação de dados; evita 1-2 min de arranque frio e o `GET` de 15 s; remove a maior fonte de variação de C3                                          | Nenhum no código                                                                                                                                                                                                        | `grep "INFO  iniciado" server.log`; contar `match-history.jsonl` por `gameId`                       |
| P1  | **Instrumentar sem mudar resposta**: no resumo por minuto do `TEMPO`, `perf_hooks.monitorEventLoopDelay` (p50/p99/máx), `process.cpuUsage()`, `process.memoryUsage().heapUsed/rss`, e dentro de `base` os tempos de `analyze` (soma), de rede (`fetch`), número de passes e de perguntas      | Separa rede de CPU em `base` e dá o loop-lag que falta para fechar C1, C3 e C4                                                                                | Muito baixo (só `diag.write`)                                                                                                                                                                                           | Uma partida e `scripts/timing-report.mjs` estendido                                                 |
| P2  | **Não segurar a HUD na rede**: teto de espera de evidência por `POST` (ex.: 2-3 s no total, em vez de 3 passes x 30 s); perguntas ainda abertas continuam em `inflight` e entram no cache para a próxima leitura (já é o comportamento de `cached()`); `AbortSignal.timeout` de 30 s para 8 s | Corta os picos de 24-79 s; `total` p95 de ~10 s para ~2-4 s                                                                                                   | **Médio**: o ranking inicial usa menos evidência e pode mudar entre leituras; o golden congela a evidência e não cobre; precisa de decisão do usuário (é a decisão 4 da seção 5.4 em versão pequena)                    | Comparar `compRanking` com e sem teto num replay; ver que a base completa chega na leitura seguinte |
| P3  | **Ceder o loop entre as etapas síncronas** do `POST`: `await new Promise(setImmediate)` após cada `analyze`/passe, depois do `clone`, depois de `tactics`, antes do `JSON.stringify`, no laço dos planos                                                                                      | O maior bloco síncrono cai da soma (p95 1,4-2,7 s) para a maior etapa (~100-400 ms); `/api/state` e SSE passam a entrar entre as etapas. Não reduz o trabalho | Baixo-médio: outro `POST` pode intercalar; `planState.track`, `streaks.observe` e `matches.augments` já são chamados em pontos com `await`; as chaves de cache já são montadas sem `await` entre `analyze` e a gravação | Golden idêntico + teste de 2 `POST` concorrentes; `GET /api/state` p95 medido pelo P1               |
| P4  | **`persist()` do cache de evidência**: debounce de 30-60 s (ou só quando o loop está ocioso e no `exit`), em vez de 2 s; prefira JSONL de acrescentar (só o novo) com compactação ocasional; podar entradas com `> TTL` na leitura                                                            | Remove ~120 ms (e crescendo) por lote; menos 7 MB de string e GC por gravação                                                                                 | Baixo (perde no máximo o último minuto de cache em queda)                                                                                                                                                               | Tempo de `persist` no P1; arquivo estável                                                           |
| P5  | **`structuredClone` sem `compRanking`**: `tactics`/`stage`/`strategy` não mexem em `compRanking` (busca em `tactics.mjs` e `server.mjs`: só leitura em `contest` e `.find` da comp fixada); clonar `recommendations`/`preview` e compartilhar `compRanking` por referência                    | `clone` cai uns 50 % (580 de ~1.000 KB), tira 28-700 ms e GC por resposta                                                                                     | Baixo; exige conferir `augmentAdvice`/`contestAlert` (só leem) e que `analysisCache` guarda objetos compartilhados                                                                                                      | Golden idêntico                                                                                     |
| P6  | **Cache de capturas só da partida corrente + a anterior** em `replay.mjs` (ou por `gameId` sob demanda)                                                                                                                                                                                       | -18,7 MB de heap, parse de arranque de 342 ms para ~30 ms                                                                                                     | Baixo; `replayState` (partidas passadas) lê sob demanda                                                                                                                                                                 | `tests/contest-replay.test.mjs`                                                                     |
| P7  | **Tática só do plano exibido** (`preview ?? recommendations[0]`)                                                                                                                                                                                                                              | `planos` p50 97-225 ms para ~1/3; resposta -210 KB; `json` e `clone` caem                                                                                     | **Médio**: muda o contrato interno (planos 2 e 3 sem `playbook/stage/strategy`); confirmar que nenhum consumidor v1/mock lê `recommendations[1..2]`; golden precisa ser regravado com diff aprovado                     | Golden com diff listado; já é o degrau 1 da seção 5.4                                               |
| P8  | **Restringir `clearAnalysis` quando o meta é atualizado ao vivo**: `updateComps`/`updateStats`/`updateAugmentStats` limpam os caches no meio da partida (nova rede + análise fria); adiar para a fase de combate/fim de partida                                                               | Evita 1 análise fria a cada 15 min-1 h                                                                                                                        | Baixo                                                                                                                                                                                                                   | log                                                                                                 |

Ordem sugerida: P0 e P1 (hoje, risco nulo) > P4 e P6 (simples) > P3 e P5 > P2 (decisão do usuário) > P7.

### 3.2 O que cabe nos passos já planejados

| Passo                                                                                            | O que resolve desta lista                                                                                                                                                                                                                                        | Observação                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M10b** (religar a thread de análise; M10a já escrito em `analysis-worker*.mjs`, não executado) | **C1 e C2 de vez**: `analyze`, `structuredClone`, `tactics`, planos e `JSON.stringify` saem do loop; rede do explorer e `evidence-cache.json` ficam na thread (um único escritor); resposta imediata com base anterior (`stale`) tira a HUD da espera de 30-80 s | O doc coloca o M10b depois de M7/M8. Como C1/C2 dominam o que o usuário sente, vale **antecipar um M10b mínimo** (só `analyze` + rede + serialização na thread, sem esperar o grafo) ou fazer P2+P3 enquanto isso |
| **M8** (grafo de fatos e memoização)                                                             | Corta o custo de `analyze` e `tactics` por evento (hoje cada -2 g refaz a base inteira; `holdings`, `traits`, `rollSim` recalculados); a seção 5.3 estima cauda tática de 50-80 ms para evento de ouro                                                           | Reduz CPU, não a fila; ganho multiplica o de M10b. Também fecha `D11` (mapas sem limite)                                                                                                                          |
| **M5/M5a**                                                                                       | M5a já tirou `playbook`/`decision`/`roll` do pipeline (ver ARQUITETURA.md; o processo vivo, desde 21:54, ainda carrega a versão anterior); o resto do M5 (remover `economy.roundIndex`, unificar limiares)                                                       | Ganho de velocidade marginal (`playbook` 0,3-3 ms); vale por consistência                                                                                                                                         |
| **M9** (`tactics` não muta `analysis`)                                                           | Elimina o `structuredClone` (P5 definitivo) e permite cache de camadas                                                                                                                                                                                           | Depende de M8                                                                                                                                                                                                     |
| **M4/M7**                                                                                        | Sem efeito de velocidade relevante                                                                                                                                                                                                                               |                                                                                                                                                                                                                   |

### 3.3 O que NÃO resolve

- Trocar `structuredClone` por outra cópia sozinho (o custo é do GC de 1 MB, que some quando a tática deixar de mutar).
- Mexer nos intervalos de `captureBoards` (500 ms) ou `watchMatch` (2 s): custo desprezível.
- Otimizar `game-log.mjs`: já é incremental.
- Aumentar a concorrência do explorer sem teto de espera: mais conexões, mesmo timeout.

## 4. O que ficou por medir (rodada final, com o orquestrador)

1. Loop-lag real do servidor vivo (P1): `monitorEventLoopDelay` durante uma partida, com e sem agentes rodando testes.
2. Divisão `analyze` x rede em `base`, e número de perguntas novas por análise (P1).
3. `scripts/bench.mjs --event gold` e `--event shop` e `scripts/bench-state.mjs` na máquina quieta, para a linha de base do P3/P5/P7 (não executei: ordem do usuário).
4. Reinício a frio **fora de partida** e **em partida** (tempo da 1ª `GET /api/state` e da 1ª análise), para decompor os 15,5 s de C4.
5. Prioridade/EcoQoS do processo Node com o jogo em primeiro plano (`Get-Process` + contadores de CPU por thread) e paginação (`Memory\Pages/sec`).
6. Custo do `JSON.parse` de ~1 MB e do `buildModel` no navegador por `refresh` (a lentidão sentida pode incluir a UI; não medi, a regra do projeto proíbe captura de tela).
7. CPU do leitor de PowerShell por ciclo (51 s em ~6 min) e se o OCR pode rodar a 5 s quando não há mudança de fase.

## 5. Evidências, arquivos e comandos

- Código: `tft/helper/server.mjs` (POST ~1000-1330; `readBoardSnapshot` ~230; `evidence` loop ~1097-1125; `recordTiming` ~690;
  `json()` ~788), `evidence.mjs` (`TTL_MS`, `CONCURRENCY`, `persist`, `fetchRows` com 30 s), `replay.mjs` (`cache.games`),
  `capture.mjs` (`scan` 500 ms), `game-log.mjs` (`readLog` incremental), `gep-reader.mjs` (`open`/`readOnce`), `screen-reader.mjs`/`screen-reader.ps1`
  (2,5 s), `v2/js/main.js:421-558` (`busy`, `setInterval 5000`, SSE), `v2/js/api.js` (timeouts 20 s e 120 s).
- Logs: `tft/helper/server.log` (linhas TEMPO e "partida ... iniciada" x4), `data/match-history.jsonl`, `data/scouting-captures.jsonl`.
- Processos (leitura): 22624 vivo (314 MB, 118 s de CPU); órfãos 23148/15540/37388; leitor PowerShell 9860 (ao fim da partida some).
- Scripts auxiliares só de leitura, rodados no scratchpad/`/tmp`, nada gravado em `tft/helper` nem `tft/data`.

## 6. Correções aplicadas (pontual, antes do M10b)

Data: 2026-10-10. Escritas e checadas só com `node --check` e leitura; **nada foi executado** (nem suíte, nem golden, nem benchmark, nem servidor
reiniciado, nenhum `POST /api/recommend`). Detalhe, arquivos, riscos e testes novos: `ARQUITETURA.md`, "Progresso da migração", seção
"Correção pontual de carga ao vivo (antes do M10b)".

| Proposta                                                     | Estado                     | O que foi feito                                                                                                                                                                                           |
| ------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 instrumentar                                              | feito                      | `TEMPO carga:` por minuto (loop-lag p50/p99/máx, CPU %, heap, rss, gravações do cache); no `POST`: `analise= rede= passes= perguntas= teto=` e etapa `fila=`; `scripts/timing-report.mjs` imprime a carga |
| P4 `persist()`                                               | feito (variante sem JSONL) | mín. 30 s entre gravações + serialização em fatias cedendo o loop; escrita atômica mantida. Não foi feito: JSONL de acrescentar, poda por TTL na leitura (a poda na gravação já existia)                  |
| P6 cache de capturas                                         | feito                      | só a partida corrente em memória; antigas relidas do arquivo sob demanda (1 vaga)                                                                                                                         |
| P3 ceder o loop                                              | feito                      | `setImmediate` após a base, clone, `tactics`, cada plano e antes do `JSON.stringify`; vaga FIFO preserva a ordem das análises                                                                             |
| P5 clone sem `compRanking`                                   | feito                      | por referência; prova por leitura em ARQUITETURA.md. Outros blocos grandes (`recommendations`, ~210 KB) **não**: `tactics` os muta                                                                        |
| P2 teto de rede                                              | feito, modo conservador    | 15 s por análise nova (era até 3 x 30 s) e 15 s por pergunta (era 30 s); sem mudança quando o cache responde                                                                                              |
| P0 órfãos, P7 tática só do plano exibido, P8 `clearAnalysis` | **não feitos**             | P0 é decisão do usuário; P7 muda o golden; P8 fica para depois                                                                                                                                            |

**Risco documentado (P2).** Passado o teto, a análise segue com a evidência que chegou e não é guardada; a leitura seguinte (5 s ou próximo evento) usa as
respostas que terminaram e refaz a base. O ranking pode, portanto, **variar entre duas leituras** no arranque frio ou depois de uma mudança grande de
tabuleiro; com cache quente nada muda. `TFT_EVIDENCE_BUDGET_MS` ajusta (valor muito alto = sem teto).

**Ainda por medir** (os mesmos itens 1, 2 e 3 da seção 4, agora com as linhas novas no log): atraso do loop antes/depois; `base` p95 e `GET /api/state` p95 numa
partida real; `gravou=`/`ms=` do cache; se a cauda síncrona restante (`analyze` de até 157 ms, `tactics`, o maior plano) ainda incomoda, o próximo ganho é o
M10b (thread de análise). O processo vivo (PID 22624) continua com o código antigo até o próximo reinício, que é decisão do usuário.
