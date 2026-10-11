# Plano: overlay de decisão rápida (sem OCR) e botão "copiar comp"

Pedido do usuário (2026-10-11): "Um plano para otimizar o overlay para mostrar de forma rápida o que deve ser feito, já que não usaremos
mais OCR e o sistema deve ficar muito mais rápido no overlay, para decisões rápidas. E um botão no overlay para copiar a comp também."

Este documento é **só planejamento**: nenhum código foi alterado. As medições foram feitas assim:

- leitura do `server.log` (`scripts/timing-report.mjs`);
- benchmarks offline: `scripts/bench-state.mjs` e `scripts/bench.mjs --event shop`;
- um script de rascunho que mede o custo do HUD sobre um feed real;
- apenas `GET /api/overlay` e `GET /api/health` no servidor da 3218, com uma partida real em andamento (jogo 3292051438, estágios 2-7 a
  5-1).

Nada de `POST /api/recommend`, nenhum reinício do servidor, nenhuma captura de tela.

Legenda: **[M]** medido nesta data; **[V]** verificado no código; **[?]** só se confirma com o jogo aberto. Os números de linha mudam,
porque vários arquivos estão sendo editados por outros agentes (seção 6).

---

## 0. Resumo

- **Onde está a latência hoje.** Dois fatores dominam o tempo entre um evento do jogo e o pixel no overlay:
  1. **O laço automático é serial.** O tick de 3 s espera a análise terminar (p50 ~2 s, p95 ~9 s ao vivo) antes de ler o estado de
     novo. Durante a análise, ouro, nível e loja ficam parados no overlay. Foi observada uma idade de 12 s no estado servido.
  2. **O feed do overlay é grosso e muda à toa.** Cada mudança de `rev` faz o overlay baixar **~1,1 MB** de novo, e 70 % disso é
     `compRanking`, que o overlay não usa. Basta o estado mudar, ou um acerto de cache regravar a mesma recomendação, para isso
     acontecer. Foram medidos 6,8 MB em 30 s.

  O HUD em si é barato: parse de ~19 ms, modelo de ~1 ms e desenho de ~2 ms por atualização (Node).

- **O que existe só por causa do OCR:**
  - o laço do `screen-reader.ps1` (2,5 s);
  - o debounce de 3 s do banco de itens;
  - a retenção de 15 s;
  - a histerese de 3 leituras GEP × tela;
  - o `screen.sync` dentro do caminho do estado;
  - a rota `/api/screen-capture`;
  - os textos "lido da tela".

  O tick de 3 s e a consulta de 1 s do overlay foram dimensionados para essa cadência. Com o GEP como fonte única, o caminho pode
  ser **dirigido por evento**.

- **Proposta em duas pistas:**
  - **Pista rápida (estado):** loja, ouro, nível e fase chegam ao overlay em menos de 1 s. A interface já cruza a loja nova com o
    último plano (`v2/js/model.js` `crossShop`), então "comprar X" aparece antes da análise nova.
  - **Pista lenta (análise):** refina depois, sem travar a tela, e o HUD mostra "recalculando" enquanto isso.

  O feed passa a ser incremental (partes separadas e projeção enxuta, de ~1,1 MB para menos de 60 KB) e empurrado por long-poll.

- **HUD de decisão.** Um cartão "Agora" traz **uma ação principal** e até três secundárias, conforme a fase:
  - planejamento;
  - combate;
  - carrossel;
  - escolha de aprimoramento;
  - fim de rodada.

  O cartão vem da mesma função pura do "Foco agora" da interface web (`v2/js/focus.js`), estendida com a fase, e as marcas sobre a
  loja dizem **onde** agir. O resto vira detalhe do modo interativo.

- **Botão "Copiar comp".** O botão é a única região clicável fora do modo interativo, com captura do mouse só sobre ele, validada no
  processo principal pela posição real do cursor. A cópia é feita pelo `clipboard` do Electron no processo principal, porque a
  janela não é focável. Há também o atalho global `Ctrl+Shift+F6`. O texto copiado é `plan.teamCode.code`. Sem código, o botão fica
  desabilitado e mostra o motivo (`teamCodeError`). Não há injeção nem tecla simulada no jogo.

---

## 1. Medição do caminho atual (evento → pixel)

### 1.1 O caminho, etapa por etapa [V]

```
jogo ─(Overwolf GEP)─▶ TFTAcademy grava tft-events.db (SQLite, WAL)
                              │  gep-reader.mjs: status(ctx) lê no máx. 1×/s (MIN_INTERVAL_MS), SÍNCRONO, abre o banco a cada leitura
jogo ─▶ __sentry-event (fase/estágio, game-log.mjs, ≥400 ms) ─┐
jogo ─▶ TFTEoGStats.json (tabuleiros, capture.mjs 500 ms) ────┤
screen-reader.ps1 (OCR, 2,5 s; debounce itens 3 s; retenção 15 s) ┘
                              ▼
app/state.mjs createStateHub.seen: mergeSources + levels.apply + reduceSources (histerese 3 leituras) + mergeGep
                              ▼
server.mjs buildStateBody (= GET /api/state) ── chamado por: a interface web (sondagem) e o laço automático
                              │  overlay.recordState(body)  → stateSeq++ (sempre, mesmo com conteúdo igual)
                              ▼
app/auto-refresh.mjs tick a cada 3 s (AUTO_TICK_MS): readState (reusa se < 2,4 s) → analysisKey → se mudou e passou
minGap 3 s → recommender.run → analysis-worker (thread): entrada → base → fila → tactics → planos → serializar
   └ o tick ESPERA a análise; o próximo tick só é agendado 3 s depois que ela termina
                              ▼
app/recommend.mjs: overlay.recordRecommendationJson(bytes com metadata) → recSeq++ (também em acerto de cache)
                              ▼
GET /api/overlay?since=rev (app/overlay-feed.mjs snapshotJson): rev = "estado.recomendação"; qualquer um mudou → manda TUDO
                              ▼
overlay/hud/poll.mjs: 1 consulta/s (POLL_MS), recuo até 5 s em falha
                              ▼
overlay/hud/hud.mjs onUpdate → redraw() → recompute() (overlayView → buildModel → buildHints) + paintData/paintStage
   └ roda a CADA resposta, inclusive `unchanged` (a idade precisa andar)
```

O processo principal do Electron (`overlay/main.mjs`) não entra no caminho dos dados. A página carrega `/overlay/index.html` do
servidor e consulta a rota sozinha. O main só faz:

- a sonda de servidor (`PROBE_INTERVAL_MS` 3 s, que busca `index.html` e chama `moveTop`);
- o acompanhamento da janela do jogo;
- o modo, os atalhos e o click-through.

### 1.2 Números [M]

**Servidor ao vivo** (sessão desde 18:58Z, partida em andamento, interface web também aberta; `timing-report.mjs --since 18:58:30Z`):

| Etapa / rota                          | n    | p50  | p95  | máx (ms)        |
| ------------------------------------- | ---- | ---- | ---- | --------------- |
| análise `total`                       | 135  | 2059 | 8911 | 18855           |
| `estado`                              | 135  | 22   | 342  | 1350            |
| `entrada`                             | 135  | 32   | 945  | 4192            |
| `espera` (fila da thread)             | 135  | 0    | 2216 | 7739            |
| `base`                                | 135  | 680  | 4536 | 9198            |
| `tactics`                             | 135  | 99   | 700  | 983             |
| `planos`                              | 135  | 302  | 2160 | 3508            |
| `serializar` (~0,94–1,1 MB)           | 135  | 136  | 719  | 2145            |
| `AUTO analise` (mediana das janelas)  | 77   | 2961 | 4258 | 23696           |
| `POST /api/recommend` (interface web) | 112  | 1947 | 2927 | 23631           |
| `GET /api/state`                      | 292  | 138  | 396  | 8166            |
| `AUTO tick` (sem análise)             | 273  | 65   | 459  | 1361            |
| `GET /api/overlay`                    | 1464 | 3    | 67   | 679             |
| atraso do event loop, p99 por janela  | 28   | 231  | 716  | 2834 (máx 2834) |

`/api/health` registrou na thread de análise `runMs` p50 1121 / p95 6352 / máx 8171 e `queueMs` p95 666 / máx 2654.

**Feed do overlay** (`GET /api/overlay`, ao vivo):

- Resposta completa: **877 KB a 1,14 MB**, servida em 9 a 33 ms. Resposta `unchanged`: 66 B.
- Composição da recomendação (863 KB):

  | Campo             | Tamanho     |
  | ----------------- | ----------- |
  | `compRanking`     | **601 KB**  |
  | `recommendations` | 187 KB      |
  | `currentPlan`     | 21 KB       |
  | `ownedItemAdvice` | 21 KB       |
  | `pool`            | 13 KB       |
  | resto             | < 6 KB cada |

  O estado tem 12,5 KB.

- O overlay usa de `compRanking` **só a entrada da comp do plano exibido** (`v2/js/model.js:123`) [V].
- Em 30 s no estágio 5-1 (combate) foram 23 consultas e **6 respostas completas (6,8 MB)**, mas só 3 mudanças de recomendação. O
  `rev` da recomendação avançou de 2 em 2, porque o laço e o POST da interface gravam o mesmo resultado (acerto de cache) [M+V].
- A idade do estado servido chegou a **11,9 s** enquanto a análise rodava: o tick estava preso esperando `refresh` [M+V].

**Caminho do estado offline** (`bench-state.mjs --iterations 10`, com o jogo rodando na máquina):

| Etapa              | p50     | p95 (ms) | Observação                                                                                          |
| ------------------ | ------- | -------- | --------------------------------------------------------------------------------------------------- |
| total              | 285     | 1085     |                                                                                                     |
| `gep.status`       | **146** | 496      | leitura síncrona do SQLite no thread principal, abrindo o banco a cada vez                          |
| `gameFiles.status` | 60      | 450      |                                                                                                     |
| `screen.status`    | 0,2     | —        | o OCR roda em outro processo; o custo dele é CPU de PowerShell e `CopyFromScreen`, não deste thread |

**Análise offline** (`bench.mjs --runs 3 --event shop`, evidência congelada):

- Por leitura, com o cache quente: mediana de 398 ms, máximo de 3896 ms.
- A serialização JSON sozinha custa de 220 a 630 ms por cenário, com respostas de 736 a 1197 KB.

**HUD offline** (script de rascunho em Node sobre o feed real de 953 KB, 12 repetições):

| Etapa         | Fria (ms) | p50 (ms) |
| ------------- | --------- | -------- |
| `JSON.parse`  | 18,5      | 18,7     |
| `buildModel`  | 13,1      | 1,2      |
| `overlayView` | 4,3       | 1,2      |
| `buildHints`  | —         | 0,2      |
| `draw.*`      | 15,2      | 1,5      |
| `focusView`   | —         | < 0,1    |

No renderer, com o jogo disputando CPU, isso deve multiplicar por 2 a 5 [?]. Não é o gargalo, mas o parse de 1 MB se repete a cada
`rev` novo.

### 1.3 Orçamento de latência hoje (estimado a partir de 1.2)

| Trecho                          | Hoje                                                                             | Por quê                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| jogo → linha no `tft-events.db` | [?] (resolução de 1 s; `created_at - timestamp` = 0 segundo o PLANO-REMOVER-OCR) | Overwolf/TFTAcademy; só com o jogo aberto                                       |
| banco → estado do servidor      | 0 a 3 s, **até 3 s + duração da análise**                                        | Só lê quando alguém chama `/api/state` ou o tick (3 s); o tick espera a análise |
| estado → overlay                | 0 a 1 s + download de ~1,1 MB + parse                                            | Consulta de 1 s; `rev` muda e manda tudo                                        |
| estado → análise nova           | 0 a 3 s (`minGap`) + fila (p95 2,2 s) + análise (p50 2 s, p95 9 s)               | Laço serial                                                                     |
| análise → overlay               | 0 a 1 s + ~1,1 MB                                                                | Mesma consulta                                                                  |

Os totais, sem contar o trecho do GEP:

- **"o que está na loja agora"**, que usa o cruzamento com o plano anterior: p50 ~2 s, pior caso maior que 12 s;
- **plano novo**: p50 ~4 a 6 s, p95 maior que 12 s.

A fase de planejamento dura ~30 s, então hoje uma decisão pode chegar com metade da janela gasta.

### 1.4 O que existe só por causa do OCR e pode sair ou encurtar com o GEP como fonte única [V]

| Mecanismo                                         | Onde                                                                                          | Hoje                                                                                  | Com só o GEP                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Laço de captura de tela                           | `screen-reader.ps1` (`IntervalMs = 2500`), `screen-reader.mjs`                                | PowerShell lendo a tela a cada 2,5 s (CPU disputando com o jogo)                      | **Sai** (PLANO-REMOVER-OCR P2/P4)                                                                         |
| Debounce do banco de itens                        | `ITEMS_SETTLE_MS = 3000`                                                                      | Item novo só aparece depois de 3 s estável                                            | **Sai**; o banco vem do `bench.item_bench` do GEP                                                         |
| Retenção de leitura                               | `HOLD_MS = 15000`                                                                             | Valor velho segurado por 15 s com a tela coberta                                      | **Sai**                                                                                                   |
| Relançamento do leitor                            | `RETRY_MS 30 s → 300 s`                                                                       | —                                                                                     | **Sai**                                                                                                   |
| Histerese GEP × tela                              | `core/state/precedence.mjs` `HYSTERESIS_READINGS = 3`                                         | 3 leituras (até ~9 s com o tick de 3 s) para trocar de fonte; contagem de divergência | **Encolhe** para o estágio (Sentry × GEP); o resto deixa de disputar                                      |
| Reconciliação do nível lido                       | `level.mjs`, `levelConflict`/`levelAmbiguous`                                                 | Valida glifo contra XP                                                                | Encolhe para `levelConsistent` do GEP + piso derivado                                                     |
| `screen.sync` no caminho do estado                | `server.mjs` `buildStateBody`, `auto-refresh.mjs` `sources.sync`                              | Liga e desliga o processo a cada leitura                                              | **Sai**                                                                                                   |
| `POST /api/screen-capture`                        | `server.mjs`                                                                                  | Grava `screen-calibration.png`                                                        | **Sai** (a calibração do overlay, `hud/calibrate.mjs`, **fica**: é âncora, não leitura)                   |
| Tick do laço de 3 s e `minGap` de 3 s             | `server.mjs` `AUTO_TICK_MS`, `auto-refresh.mjs`                                               | Cadência de sondagem compatível com o OCR de 2,5 s                                    | **Encurta e vira evento**: aviso de mudança no WAL do GEP → leitura → análise com coalescência de ~300 ms |
| Consulta do overlay de 1 s                        | `overlay/hud/poll.mjs` `POLL_MS`                                                              | Sondagem                                                                              | **Vira long-poll** (resposta na hora da mudança); a sondagem fica só como reserva                         |
| Textos "lido da tela" / "Nada lido da tela agora" | `overlay/hud/view.mjs` `LEVEL_SOURCE`, `health.mjs` `SCREEN_SOURCES`, `server.mjs` `warnings` | —                                                                                     | Rótulo neutro ("lido"/"GEP") e "sem fonte" (PLANO-REMOVER-OCR P1a)                                        |

**Não é do OCR e fica:**

- `GEP_STALE_MS = 60 s`: o maior silêncio medido do GEP é de 36 s, então baixar o limite gera falso "obsoleto";
- `REFRESH_WINDOW_MS = 120 s`: decaimento dos bancos dos rivais;
- `MIN_INTERVAL_MS = 1 s` do leitor GEP, que vira teto e não cadência;
- a sonda de servidor do Electron (3 s);
- a calibração e a geometria do overlay.

**Texto desatualizado no overlay** [V]:

- `WAITING_TITLE`, em `overlay/hud/view.mjs`, ainda diz que "a análise só existe enquanto a interface web está aberta";
- o aviso `analysis-old` também diz isso.

Desde o M10b o servidor analisa sozinho. Corrigir no passo O9.

---

## 2. Overlay de decisão rápida

### 2.1 Princípio

O overlay continua **só apresentando**:

- as decisões vêm do servidor (`rec`: plano, rolagem, nível, economia, itens, carrossel, aprimoramentos);
- o modelo de tela é `buildModel` (`v2/js/model.js`), o mesmo da interface web;
- a ordem "o que fazer agora" é a de `focusView` (`v2/js/focus.js`, "Foco agora").

O teste de arquitetura T1 proíbe o servidor de importar `v2/`, então a projeção "decisão" não pode ser calculada no servidor com o
modelo da interface. Ela fica em **uma função pura de `v2/js/focus.js`**, estendida com a fase, e é usada pela interface web e pelo
overlay. O servidor entrega os insumos já decididos e enxutos (seção 3).

Proposta: `decisionView(model, ctx)`, com `ctx = { phase, phaseKind, carousel, augmentOffer, gep, freshness }`. Ela devolve:

```
{ phase: "planning"|"combat"|"carousel"|"augment"|"roundEnd"|"idle",
  main: { id, tone, verb, refs:[{kind:"unit"|"item"|"augment", id}], detail, anchor },   // UMA ação
  more: [ ...até 3 do mesmo formato ],
  stale: null | { kind: "state"|"analysis"|"gep"|"offline", text, ageMs },
  teamCode: { code, error, title } }
```

O campo `anchor` (`shop:2`, `gold`, `level`, `itemBench`, `augment:1`, `carousel`) liga a ação à marca ancorada que já existe
(`markers.mjs` + `geometry.mjs`), e assim o olho vai direto ao lugar certo.

### 2.2 Ação principal e secundárias por fase

A fase vem do estado:

- `screen.phase`/`phaseKind` do Sentry (`planning` | `combat` | `draft` | `other`, com nomes como `PlanningArrival`, `Combat`,
  `CombatArrival`, `CombatCleanup`);
- `state.carousel.active`;
- a oferta de aprimoramentos (`screen.augments`, do GEP `augments.me`).

Nada disso é regra nova de jogo: é escolher **qual** decisão já calculada vai na frente.

| Fase (como se detecta)                                                                                       | Ação principal (a primeira que existir, nesta ordem)                                                                                                                                                                                                                                                                                                   | Secundárias (máx. 3)                                                                                                                                                                       | Some do HUD nesta fase                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Planejamento / loja** (`phaseKind=planning`, sem oferta nem carrossel)                                     | 1. vida crítica: **"Estabilize: role até Ng"** (`roll.call.kind=danger`). 2. peça do plano na loja com ouro: **"Compre [X] (slot n)"**, com contorno no slot (`buy` × `shop`, `crossShop`). 3. **"Role até Ng, guarde Kg"** (`roll.call=go`). 4. **"Suba para N (Ng)"** (`level.go`). 5. **"Guarde ouro: +k de juros"** (`roll.call=hold` + `economy`) | Montar item: **"[A]+[B] → [Y] em [Z]"** (`items.next`). Mover: **"[Y]: [A] → [B]"** (`items.moves`). Trocar: **"[A] sai, [B] entra"** (`swap`). Peça do plano que falta, sem estar na loja | Lista completa de builds, plano da comp, textos "aprender", XP detalhado, avisos que não sejam de frescor |
| **Combate** (`Combat*`, exceto `CombatCleanup`)                                                              | Comprar, rolar e subir continuam possíveis no combate: a mesma escolha econômica do planejamento (itens 2 a 5). Sem nada a fazer: **"Nada urgente: próxima rodada [resumo]"**                                                                                                                                                                          | Item para **montar na reserva** (equipar em peça do campo não vale no combate: a ação vem marcada "após o combate"). Juros previstos                                                       | Movimentos de item entre peças em campo (adiados), dicas da loja se nada do plano estiver nela            |
| **Carrossel** (`phaseKind=draft` ou `carousel.active`)                                                       | **"Pegue [campeão] com [item]"** (1º de `carousel.picks`; se `completesNow`, "fecha [Y]")                                                                                                                                                                                                                                                              | 2º e 3º da lista; "sem leitura: prioridade [componente]" quando a oferta não foi lida (`carousel.offer=null`)                                                                              | **Tudo** de loja, rolagem, nível e economia                                                               |
| **Escolha de aprimoramento** (oferta com 2 ou mais cartas no estágio de oferta; agente `tft-aprimoramentos`) | **"Escolha [aprimoramento] (carta N)"** (o melhor de `augmentAdvice`)                                                                                                                                                                                                                                                                                  | 2ª opção com a diferença; "rerrolar a carta X" se o conselho disser; o efeito no plano ("vira [comp]") se vier pronto                                                                      | Marcas sobre a loja (as cartas cobrem o centro), builds                                                   |
| **Fim de rodada** (`CombatCleanup` e o início de `PlanningArrival`; rodada de PvE com orbes)                 | **"Monte [Y]"** se o banco de itens fechou receita nova (`items.next` com as partes no banco). Senão, a principal do planejamento que vai valer                                                                                                                                                                                                        | Juros da próxima rodada (`economy.after/keep`), sequência (`streak`)                                                                                                                       | Igual ao planejamento                                                                                     |
| **Sem partida / aguardando / encerrada**                                                                     | Mensagem única ("aguardando o 1º tabuleiro", "partida encerrada · Nº")                                                                                                                                                                                                                                                                                 | —                                                                                                                                                                                          | Todo o resto                                                                                              |

### 2.3 Layout para leitura de relance

O elemento novo **`decision`** ("Agora") entra no topo da coluna direita (posição padrão `x ≈ 0,735`, acima de `roll`), com prioridade
0,5 em `ELEMENT_PRIORITY`: nunca é recolhido antes de `bar`.

```
┌ Agora ─────────────────────────── [GEP 42 s] [⧉ Copiar comp] ┐
│ ● COMPRE  [retrato X]  slot 3                                    │   ← 1 linha, ~1,6× a fonte base, cor do tom
│   ↻ Role até 20g · guarde 30g                                    │   ← secundárias: ícone + imagens + ≤ 4 palavras
│   ⚒ [A]+[B] → [Y] em [Z]                                         │
│   ⇄ [Y]: [A] → [B]                                               │
└──────────────────────────────────────────── recalculando 3 s ┘
```

- **Imagens no lugar de nomes**, com `rich-text.js`/`glyphs.js`.
- **Tons:**

  | Tom      | Cor      | Uso       |
  | -------- | -------- | --------- |
  | `go`     | verde    | agir      |
  | `amber`  | âmbar    | preparar  |
  | `danger` | vermelho | urgente   |
  | `wait`   | cinza    | não fazer |

- **Um pulso de 300 ms** só quando o `id` da ação principal muda (`prefers-reduced-motion` desliga). Fora isso nada se mexe, para não
  distrair.
- **Frescor só quando importa.** O chip aparece apenas nestes casos:
  - estado com mais de 5 s no planejamento;
  - análise atrás do estado (seção 3.3): "recalculando N s";
  - GEP obsoleto ou ausente;
  - servidor sem resposta.

  Com tudo em dia, nenhum chip.

- **O que sai do HUD padrão** (vai para o modo interativo ou para a interface web):
  - os cartões `builds` e `plan`, que já começam ocultos;
  - os itens por campeão além do carry;
  - o texto longo do veredito de rolagem;
  - o XP detalhado da barra;
  - as dicas "aprender";
  - os avisos `warnings`;
  - o painel de saúde do dock (fica só o ponto colorido);
  - o progresso do plano.

  As marcas ancoradas de compra, ouro e banco de itens **ficam**, porque dizem onde agir.

- **A barra `bar`** encolhe para fase, ouro, nível e vida, numa linha.

---

## 3. Atualização incremental

### 3.1 Feed por partes, com `rev` separado e sem regravação à toa

`app/overlay-feed.mjs` passa a ter os seguintes contadores:

- `stateRev`, que só muda quando o **conteúdo** do estado muda: assinatura do corpo sem os campos que andam com o relógio
  (`ageSeconds`, `ageMs`, `at`), calculada uma vez em `recordState`;
- `recRev`, que só muda quando a recomendação é **outra**. Em `app/recommend.mjs`, um acerto de cache (`via !== "novo"`) com o mesmo
  `shared.bytes` não regrava.

Contrato v2 (aditivo: a v1 continua para quem não mandar `v=2`):

```
GET /api/overlay?v=2&since=<stateRev>.<recRev>[&wait=<ms>]
→ { version: 2, now, rev: "<s>.<r>",
    state?:          { at, ageMs, body },            // só se stateRev mudou
    recommendation?: { at, ageMs, body, forKey },    // só se recRev mudou; body = projeção enxuta (3.2)
    analysis:        { key, pendingSince|null, behind: bool },  // sempre, ~100 B (3.3)
    unchanged?: true }
```

O cliente (`overlay/hud/poll.mjs`) **funde** as partes na última resposta completa.

Com isso, mudar só o estado custa ~12 KB, e não 1,1 MB. Uma consulta sem mudança continua com menos de 100 B.

### 3.2 Projeção enxuta da recomendação

`app/overlay-feed.mjs` passa a guardar, junto com os bytes, uma **projeção para o HUD**, calculada **uma vez por recomendação nova**
(no ideal, pela própria thread de análise, que já entrega bytes prontos).

A projeção mantém só o que `buildModel`/`overlayView` leem:

- `metadata`, `recommendations`, `currentPlan`, `goal`, `self`, `pool`, `odds`, `preview*`, `autoSwaps`, `currentLevel`,
  `planProgress`, `augmentAdvice`, `contest`, `ownedItemAdvice`;
- `compRanking` filtrado às comps de `recommendations`/`goal` (de 1 a 3 entradas).

Ficam de fora `evidenceRequests`, `conditionalRequests`, `measured`, `assets`, `unknown` e o `compRanking` completo.

A meta é menos de 60 KB. A lista de campos é um **contrato** entre `model.js` e o servidor, e o teste de contrato do passo O2 é a rede
de segurança: `buildModel(completo)` precisa ser idêntico a `buildModel(projeção)`.

### 3.3 Resposta rápida primeiro, refinamento depois, sem travar

- **Pista rápida (estado).** O laço lê o estado num tique próprio e **não espera a análise**. Duas formas, nesta ordem:
  - a mudança do arquivo `-wal` do `tft-events.db` (`fs.watch`, só leitura) dispara uma leitura com coalescência de ~300 ms;
  - sem o aviso, a sondagem fica em 1 s durante a partida.

  O estado novo vai ao feed na hora. O HUD redesenha com o **último plano** e a **loja, o ouro e o nível novos**. O cruzamento da
  loja com as peças do plano já acontece no cliente (`model.js` `crossShop`/`shopView`), sem regra nova. Por isso "Compre X (slot n)"
  aparece em menos de 1 s depois da linha no banco.

- **Pista lenta (análise).** Ao detectar uma chave nova, o laço **dispara** a análise (thread) e segue. A política é "a última vence":
  - a thread já descarta pedidos superados (`superseded`/`cancel`);
  - o feed publica `analysis: { key, pendingSince, behind: true }`;
  - o HUD mostra "recalculando N s" no rodapé do cartão, sem esmaecer nada;
  - quando o resultado chega, `recRev` muda e o cartão troca, com o pulso só se a ação principal mudou.
- **Primeiro o "base", depois o completo (opcional, passo O5b).** O pipeline (`app/analysis-pipeline.mjs`) poderia publicar um
  resultado provisório depois de `planos` só para o plano exibido (slot 0), antes da disputa, dos aprimoramentos e do resto, e
  completar depois.

  A thread já tem a "resposta imediata" (`analysis-protocol.mjs` `freshness`, `maxBaseAge` 1). Este passo fica com o agente
  `tft-desempenho` e só vale se a medição do O0 mostrar que a pista lenta continua acima de 3 s no p50 com a pista rápida pronta.

- **O HUD só recalcula quando algo muda.** Hoje `onUpdate → redraw()` roda `overlayView` e `buildHints` a cada resposta, inclusive
  `unchanged`. A proposta:
  - recalcular só quando `rev` ou o modo mudarem;
  - um temporizador de 1 s atualiza **apenas** os textos de idade (`data-age`);
  - `put()` continua evitando trocar o DOM igual.

### 3.4 Quando o GEP cai, a análise atrasa ou o servidor some

| Situação (quem detecta)                                                                                               | O que o HUD faz                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gepStatus.state = "obsoleto"` (sem evento por mais de 60 s) ou `ausente`/`esquema-desconhecido` (estado do servidor) | Chip vermelho **"GEP off · desde N s"**. As ações que dependem de ouro, loja ou nível (comprar, rolar, subir, juros) são **suprimidas**, para não induzir erro. Ficam as que vêm do tabuleiro (`TFTEoGStats`): trocar, montar item com o que está equipado, comp e "Copiar comp". A ação principal vira **"Sem dados da loja: [motivo]"** com a instrução ("abra o TFTAcademy / Overwolf") |
| GEP sem evento há mais de 40 s, mas ainda ativo                                                                       | Chip âmbar discreto "GEP quieto 45 s" (o maior silêncio normal medido é de 36 s)                                                                                                                                                                                                                                                                                                           |
| Análise atrás do estado (`analysis.behind`) por até 10 s                                                              | "recalculando N s" no rodapé. A ação principal continua (ela já usa a loja nova)                                                                                                                                                                                                                                                                                                           |
| Análise atrás por mais de 10 s ou com falha (`/api/health` `auto.lastError`)                                          | O chip âmbar "plano de há N s" e as ações que dependem só do plano (montar, mover) ficam marcadas "provisório"                                                                                                                                                                                                                                                                             |
| Servidor sem resposta (2 falhas, `OFFLINE_AFTER`)                                                                     | O que já existe: aviso "sem resposta do servidor", corpo esmaecido. O long-poll cai para a sondagem com recuo (1 a 5 s), e o Electron reabre a página quando o servidor volta (`syncTarget`)                                                                                                                                                                                               |
| Leitura de estado velha (mais de 5 s no planejamento, mais de 120 s fora dele)                                        | Chip "leitura de há N s". Com mais de 120 s, esmaece (como hoje)                                                                                                                                                                                                                                                                                                                           |

---

## 4. Botão "Copiar comp"

### 4.1 O que copia

O botão copia `model.plan.teamCode`, que já existe:

- `buildModel` expõe `teamCode`/`teamCodeError` (`v2/js/model.js:708-709`);
- a origem é `plan.teamCode = teamCode(ids, plannerCatalog)` em `app/recommend-facts.mjs` `composeAnalysis`, com `team-code.mjs` e
  `teamplanner-catalog.json`.

É o código do **plano exibido**: a comp fixada ou a primeira sugestão. O formato é `"02" + 10×3 hex + "TFTSet18"` (40 caracteres).
Na partida medida veio `023f13fa4144234383f340f419000000TFTSet18` [M].

A interface web já tem o mesmo botão (`v2/js/main.js:333-341`): o overlay usa o mesmo título e o mesmo texto de erro.

`overlayView` passa a devolver:

```
teamCode: { code | null, error | null, title: "Copiar o código da equipe para importar no planejador do jogo" | erro }
```

### 4.2 Como só o botão fica clicável (sem tirar o click-through do resto)

Estado atual [V]:

- fora do modo interativo, `mouseIgnore()` (`overlay/config.mjs`) devolve sempre `true` e a janela é `setIgnoreMouseEvents(true,
  { forward: true })`;
- no modo integrado interativo, a página já liga e desliga a captura conforme o ponteiro fica sobre `[data-hit]` (`mountHitTest`,
  `widgets.mjs`, canal `overlay:setIgnore`).

Proposta: uma **região quente** que vale **também fora do modo interativo**.

1. **Página.** O botão recebe `data-hot`. `mountHitTest` ganha um segundo conjunto `hotRects()` (os `[data-hot]` visíveis), avaliado
   mesmo com `isActive()` falso. Os eventos de movimento chegam porque `forward: true` repassa o `mousemove` à página.
   - Ponteiro sobre o botão: `host.setHot(true)`.
   - Ponteiro fora: `host.setHot(false)`.
   - A página também informa os retângulos quentes com `host.setHotRects([{x,y,w,h}])` a cada desenho: no máximo 2, cada um com no
     máximo 160×48 px CSS.
2. **Processo principal** (`overlay/main.mjs`), que é o guardião:
   - `mouseIgnore({ interactive, mode, pageCapture, hotCapture })` só aceita `hotCapture` se `screen.getCursorScreenPoint()`, convertido
     para coordenadas da janela (`win.getBounds()`, zoom do `webContents`), cair dentro de um retângulo quente declarado;
   - enquanto captura fora do modo interativo, um vigia de 100 ms reconfere o cursor e **devolve o click-through** se ele sair, mesmo
     que a página não avise;
   - teto de 5 s por captura sem movimento.

   Assim, um erro na página nunca deixa a janela inteira bloqueando cliques no jogo.

3. **Clique** → `host.copyTeamCode(code)` (IPC `invoke`). O main:
   - revalida com `/^02[0-9a-f]{30}TFTSet\d{1,3}$/`;
   - chama `clipboard.writeText(code)` do Electron e devolve `{ ok: true }`.

   O `navigator.clipboard` **não** serve: ele exige documento focado e a janela é `focusable: false`.

4. **Foco.** A janela continua `focusable: false` (`WS_EX_NOACTIVATE`): o clique não tira o foco do TFT. Isso só se confirma com o
   jogo aberto [?].
5. **Atalho global** `copyComp: "Control+Shift+F6"`, no padrão de teclas de função de `DEFAULT_HOTKEYS` e configurável:
   - o main manda `overlay:copyRequest` à página;
   - a página responde com o código atual pelo mesmo `copyTeamCode`, o que mantém uma fonte só;
   - o retorno visual é o mesmo do clique.

   Isso serve a quem não quer tirar a mão do teclado.

### 4.3 Retorno visual e ausência de código

| Estado                                                                                    | Botão                                                              | Depois do clique ou atalho                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Com código                                                                                | "⧉ Copiar comp" (título = nome da comp)                            | Por 1,5 s: **"✓ Copiado: cole no Planejador (Ctrl+V)"** em verde; `aria-live="polite"` |
| Falha ao gravar na área de transferência                                                  | —                                                                  | "Não foi possível copiar" em vermelho (o motivo vai ao `overlay.log`)                  |
| Sem código, com erro (`teamCodeError`, ex.: "Campeão sem ID de importação confirmado: X") | Desabilitado, ícone de aviso, título = erro                        | O atalho mostra o erro por 2 s                                                         |
| Sem plano (aguardando análise ou partida encerrada)                                       | Oculto                                                             | O atalho mostra "sem comp sugerida agora"                                              |
| GEP off                                                                                   | **Continua ativo**: a comp vem do tabuleiro e da meta, não da loja | —                                                                                      |

Nada é digitado nem colado no jogo pelo helper: o usuário abre o Planejador e cola.

### 4.4 Riscos do botão

- **O sufixo `TFTSet18` está fixo em `team-code.mjs`.** Na troca de set o código fica inválido sem aviso. Proposta:
  - o sufixo vem do set do catálogo ou do estado (`state.set`);
  - um teste confere que o sufixo é igual a `catalog set`.

  Dono: quem cuida de `team-code.mjs`/catálogo (combinar com o orquestrador).

- **Captura do mouse presa por bug.** Mitigada pelo vigia do main, que tem a palavra final.
- **Atalho em uso por outro programa.** O registro já avisa "(FALHOU)" no console e no log (`registerHotkeys`).

---

## 5. Passos incrementais

Regras para todos os passos:

- cada passo é um commit do orquestrador;
- a suíte só roda no fim, pelo orquestrador: `node --test tests/*.test.mjs v2/js/*.test.mjs *.test.mjs`;
- `node --check` e revisão durante o trabalho;
- nada de reiniciar o servidor da 3218 (os módulos do HUD são servidos do disco, mas **mudanças em `server.mjs`/`app/*` só valem
  depois que o usuário reiniciar o servidor**);
- validação ao vivo só pelo usuário.

| Passo                                                                                                                                                                                                                                                                     | O quê                                                                                                                                                                                                                                                                                                                                                                                                                    | Arquivos                                                                                                                                                                                                                                                                                                                                                                                                                 | Testes (escritos, rodados no fim)                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pronto quando                                                                                                                                            | Depende de                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **O0** Instrumentar                                                                                                                                                                                                                                                       | Latência por trecho, sem mudar comportamento: o feed registra `state.gepEventAt` (de `gepStatus.lastEventAt`) e `recordedAt`; o HUD calcula `evento→estado`, `estado→recebido` e `recebido→pintado` e guarda p50/p95 por minuto no `overlay.log` (via IPC `overlay:metrics`, com o main só gravando texto); `scripts/bench-overlay.mjs` mede parse/modelo/desenho sobre um feed salvo e observa `rev` ao vivo só com GET | `app/overlay-feed.mjs`, `overlay/hud/hud.mjs`, `overlay/hud/health.mjs`, `overlay/preload.cjs`, `overlay/main.mjs` (gravar texto), `scripts/bench-overlay.mjs` (novo)                                                                                                                                                                                                                                                    | `tests/overlay-feed.test.mjs` (campos novos, relógio injetado); `tests/overlay-hud.test.mjs` (cálculo das latências puro)                                                                                                                                                                                                                                                                                                                                              | Números de 1.2 reproduzíveis e o log com uma linha `LAT` por minuto em partida                                                                           | —                                                                                                                                          |
| **O1** Feed por partes                                                                                                                                                                                                                                                    | `stateRev`/`recRev` por conteúdo; `v=2` só com as partes que mudaram; acerto de cache não regrava; cliente funde                                                                                                                                                                                                                                                                                                         | `app/overlay-feed.mjs`, `app/recommend.mjs` (uma condição em `recordRecommendationJson`), `server.mjs` (passar `v`), `overlay/hud/poll.mjs`, `overlay/hud/hud.mjs`                                                                                                                                                                                                                                                       | `overlay-feed.test.mjs`: estado igual não muda `rev`; só estado mudou → sem `recommendation`; v1 intacta. `overlay-hud.test.mjs`: `parseFeed` v2 e fusão                                                                                                                                                                                                                                                                                                               | Em 30 s de partida (observação só com GET), downloads completos iguais às mudanças reais de recomendação, e cada mudança só de estado com menos de 20 KB | O0                                                                                                                                         |
| **O2** Projeção enxuta                                                                                                                                                                                                                                                    | Projeção `hud` da recomendação, calculada uma vez por gravação (na thread, se o agente da thread aceitar)                                                                                                                                                                                                                                                                                                                | `app/overlay-feed.mjs` (ou `app/overlay-projection.mjs` novo), `analysis-worker.mjs` (opcional), `server.mjs`                                                                                                                                                                                                                                                                                                            | Novo `tests/overlay-projection.test.mjs`: para os 17 cenários do golden + `live-mock-base.json` + um feed real anonimizado em `tests/fixtures/overlay/`, `buildModel(completo)` deep-equal `buildModel(projeção)` e `overlayView` idêntico; tamanho abaixo de 60 KB                                                                                                                                                                                                    | Resposta completa do overlay abaixo de 80 KB ao vivo                                                                                                     | O1; `tft-itens-central` (campos que `model.js` lê podem mudar)                                                                             |
| **O3** Long-poll                                                                                                                                                                                                                                                          | `wait=<ms>` segura a resposta até `rev` mudar (fila de espera no feed, teto de 25 s, cancelada no `close`); a sondagem fica de reserva                                                                                                                                                                                                                                                                                   | `app/overlay-feed.mjs` (`waitChange`), `server.mjs` (rota: poucas linhas), `overlay/hud/poll.mjs`                                                                                                                                                                                                                                                                                                                        | `overlay-feed.test.mjs` (acorda na gravação, expira no teto, libera no fechamento, com relógio falso); `overlay-hud.test.mjs` (`startPolling` com `wait`, recuo em falha)                                                                                                                                                                                                                                                                                              | Mudança no feed → resposta em menos de 50 ms (medido pelo O0)                                                                                            | O1                                                                                                                                         |
| **O4** HUD recalcula só com mudança                                                                                                                                                                                                                                       | `recompute` só com `rev` ou modo novos; temporizador de idade separado                                                                                                                                                                                                                                                                                                                                                   | `overlay/hud/hud.mjs`, `overlay/hud/view.mjs` (idade fora do modelo)                                                                                                                                                                                                                                                                                                                                                     | `overlay-hud.test.mjs` (função pura `needsRecompute`); `overlay-page.test.mjs` (o temporizador só toca `[data-age]`)                                                                                                                                                                                                                                                                                                                                                   | Nenhum `buildModel` em respostas `unchanged`                                                                                                             | O1                                                                                                                                         |
| **O5** Pista rápida no servidor                                                                                                                                                                                                                                           | Leitura de estado desacoplada da análise; disparo por aviso do GEP com coalescência de 300 ms; sondagem de 1 s como reserva; `analysis: {key, pendingSince, behind}` no feed                                                                                                                                                                                                                                             | `app/auto-refresh.mjs`, `server.mjs` (ligação), `gep-reader.mjs` (`onChange` com `fs.watch` do `-wal`, leitura incremental por `id`)                                                                                                                                                                                                                                                                                     | `tests/auto-refresh.test.mjs` (estado gravado durante a análise; sem análise dupla; "a última vence"); `tests/gep-reader.test.mjs` (aviso → leitura; sem escrita no banco)                                                                                                                                                                                                                                                                                             | Estado no feed menos de 1,5 s depois da linha no banco (O0); `gep.status` p50 abaixo de 20 ms (`bench-state`)                                            | `tft-desempenho` (laço/thread), `tft-fonte-gep` (`gep-reader.mjs`), PLANO-REMOVER-OCR P2 (`sources.sync`)                                  |
| **O5b** (opcional) Resultado provisório                                                                                                                                                                                                                                   | Publicar o plano exibido depois de `planos` e completar depois                                                                                                                                                                                                                                                                                                                                                           | `app/analysis-pipeline.mjs`, `analysis-worker.mjs`, `app/recommend.mjs`                                                                                                                                                                                                                                                                                                                                                  | `tests/analysis-worker.test.mjs`, golden igual no resultado final                                                                                                                                                                                                                                                                                                                                                                                                      | Só se o O0 mostrar a pista lenta acima de 3 s no p50 depois do O5                                                                                        | `tft-desempenho`                                                                                                                           |
| **O6** Cartão "Agora"                                                                                                                                                                                                                                                     | `decisionView` em `v2/js/focus.js` (fase + ação principal + secundárias + âncora); elemento `decision` no HUD; a web "Foco agora" usa a mesma função; o ruído sai do padrão (2.3)                                                                                                                                                                                                                                        | `v2/js/focus.js`, `overlay/hud/view.mjs`, `overlay/hud/draw.mjs`, `overlay/hud/layout.mjs` (`decision`, prioridade 0,5), `overlay/hud/fit.mjs`, `overlay/hud/hints.mjs` (dicas por fase), `overlay/hud/hud.css`, `overlay/hud/index.html`, `overlay/hud/help.mjs`                                                                                                                                                        | `v2/js/focus.test.mjs` (uma tabela por fase da seção 2.2); `tests/overlay-hints.test.mjs` (sem dica de loja no carrossel nem na oferta; "learn" desligado); `tests/overlay-geometry.test.mjs` e `tests/overlay-fit.test.mjs` (`decision` não cobre loja, ouro, banco de itens nem cartas de aprimoramento em 16:9, ultrawide e 4:3); `tests/overlay-hud.test.mjs` (cartão a partir de `live-mock-base.json`); `v2/js/names-guard.test.mjs` (imagens no lugar de nomes) | As 5 fases com a ação principal certa nos testes; HUD padrão sem `builds`/`plan`/"learn"                                                                 | `tft-itens-central` (`items.next`/`moves`), `tft-aprimoramentos` (oferta e `augmentAdvice` no overlay), `tft-carrossel` (`carousel.picks`) |
| **O7** Copiar comp — **FEITO (2026-10-11)**: legenda `keys` + botão "⧉ Copiar" e `Ctrl+Shift+F6`; a região quente é conferida pelo cursor real no main (polling de 100 ms com o overlay visível), não pelo movimento encaminhado; testes em `tests/overlay-keys.test.mjs` | Botão `data-hot`, região quente validada no main, IPC `copyTeamCode` com `clipboard`, atalho `copyComp`, retorno visual                                                                                                                                                                                                                                                                                                  | `overlay/preload.cjs` (`copyTeamCode`, `setHot`, `setHotRects`, `onCopyRequest`; contrato `overlayHost` v3, só acréscimos), `overlay/main.mjs`, `overlay/config.mjs` (`DEFAULT_HOTKEYS.copyComp`, `mouseIgnore` com `hotCapture`, `isTeamCode`), `overlay/hud/widgets.mjs` (`hotRects`), `overlay/hud/view.mjs` (`teamCode`), `overlay/hud/draw.mjs`, `overlay/hud/hud.css`, `overlay/hud/help.mjs`, `overlay/README.md` | `tests/overlay-config.test.mjs` (`mouseIgnore` com `hotCapture` dentro e fora do retângulo; `isTeamCode` aceita o código medido e recusa lixo; atalho novo validado e sem colisão); `tests/overlay-hud.test.mjs` (`teamCode` com código, com erro e sem plano); `tests/overlay-page.test.mjs` (botão com `data-hot`, `aria-live`, sem `navigator.clipboard`)                                                                                                           | Os testes escritos; com o jogo aberto, colar no Planejador importa a comp (validação do usuário)                                                         | Nenhum agente (arquivos do overlay); sufixo do set (4.4) com o dono de `team-code.mjs`                                                     |
| **O8** GEP caiu / atraso                                                                                                                                                                                                                                                  | Supressão e chips da tabela 3.4                                                                                                                                                                                                                                                                                                                                                                                          | `overlay/hud/view.mjs`, `overlay/hud/health.mjs`, `v2/js/focus.js`                                                                                                                                                                                                                                                                                                                                                       | `overlay-hud.test.mjs` (GEP obsoleto, ausente e quieto; `behind` por 3 s e por 15 s); `focus.test.mjs`                                                                                                                                                                                                                                                                                                                                                                 | Nenhuma ação de loja, ouro ou rolagem com GEP off                                                                                                        | O5 (campo `analysis`), PLANO-REMOVER-OCR P1a/P2                                                                                            |
| **O9** Limpeza pós-OCR no overlay                                                                                                                                                                                                                                         | `LEVEL_SOURCE`/"lido da tela" neutros, `SCREEN_SOURCES` sem "derived", `WAITING_TITLE` e o aviso `analysis-old` corrigidos (o servidor analisa sozinho), README sem OCR                                                                                                                                                                                                                                                  | `overlay/hud/view.mjs`, `overlay/hud/health.mjs`, `overlay/README.md`, `FONTES-DE-DADOS.md`/`ARQUITETURA.md` (seção do overlay)                                                                                                                                                                                                                                                                                          | Os testes de overlay que citam "tela" (PLANO-REMOVER-OCR §1.5)                                                                                                                                                                                                                                                                                                                                                                                                         | Nenhum texto do overlay fala de leitura de tela                                                                                                          | PLANO-REMOVER-OCR P1a (mesmo trecho; fazer junto)                                                                                          |

**Ordem sugerida:**

1. O0, O1, O3 e O4: só overlay e feed, sem conflito com o motor. Já dão quase todo o ganho de transporte.
2. O7: independente; pode ir em paralelo.
3. O2.
4. O6, quando `tft-itens-central` e `tft-aprimoramentos` fecharem `model.js` e a oferta.
5. O5, com `tft-desempenho` e `tft-fonte-gep`.
6. O8 e O9.

**Metas medidas pelo O0:**

| Caminho                               | p50                    | p95   |
| ------------------------------------- | ---------------------- | ----- |
| linha no banco → pixel (pista rápida) | ≤ 1 s                  | ≤ 2 s |
| chave nova → plano novo no pixel      | ≤ 3 s                  | ≤ 6 s |
| bytes por atualização                 | < 80 KB (hoje ~1,1 MB) | —     |

E zero `buildModel` em resposta sem mudança.

---

## 6. Coordenação com os agentes em andamento

| Agente                              | Área                                                                    | Conflito com este plano                                                                   | Como sequenciar                                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tft-itens-central`                 | `core/items/`, `v2/`, `overlay/` (itens no HUD)                         | O6 (`view.mjs`, `draw.mjs`, `focus.js`), O2 (campos que `model.js` lê)                    | O0, O1, O3, O4 e O7 tocam funções separadas (`poll.mjs`, feed, região quente). O6 e O2 só depois de ele fechar o HUD de itens. O teste de contrato do O2 protege a mudança de campos |
| `tft-aprimoramentos`                | Aprimoramentos no Ao vivo e no overlay, `gep-reader.mjs`, `core/state/` | O6 (fase "escolha de aprimoramento"), O5 (`gep-reader.mjs`)                               | A linha "aprimoramento" de `decisionView` consome o que ele expuser no modelo. O5 em `gep-reader.mjs` só depois de ele fechar                                                        |
| `tft-comp-viabilidade`              | Ranking de comps (`engine.mjs`, `core/comps/`)                          | O2 (`compRanking` filtrado: a entrada da comp exibida precisa continuar com o mesmo `id`) | Nenhuma edição em arquivo dele; o teste do O2 detecta mudança de formato                                                                                                             |
| `tft-arquiteto` (PLANO-REMOVER-OCR) | Remoção do OCR                                                          | O5 (`sources.sync`), O8 e O9 (P1a, P2)                                                    | O9 junto com o P1a; O5 depois do P2 (flag `TFT_SCREEN_READER`)                                                                                                                       |
| `tft-desempenho` / `tft-fonte-gep`  | Laço, thread e leitor GEP                                               | O5, O5b                                                                                   | Os dois agentes executam; este plano só fixa a meta e a medição                                                                                                                      |

---

## 7. O que só se confirma com o jogo aberto [?]

- Latência real **jogo → GEP → `tft-events.db`**: Overwolf e TFTAcademy.
- **Linha no banco → pixel** com O0 a O5 em partida real, e a CPU do overlay e do servidor disputando com o jogo.
- O **clique no botão** não tira o foco do TFT e não minimiza a janela sem borda. O `mousemove` repassado (`forward: true`) chega à
  página sobre o jogo.
- **Colar o código no Planejador do TFT** importa a comp certa (formato, sufixo do set).
- Legibilidade do cartão "Agora" em 1920×1080 com a escala padrão. O cartão não pode cobrir:
  - as cartas de aprimoramento (centro);
  - o carrossel;
  - a loja;
  - o banco de itens.
- Fases do Sentry na prática: a ordem de `PlanningArrival`, `Combat`, `CombatCleanup` e `Draft` e quanto dura cada uma, para os
  limiares de "fim de rodada".
- Comportamento com o Vanguard: a janela é comum, sem injeção, mas não foi testada contra ele.
- Nenhuma dessas validações é feita por agente: o usuário joga e devolve o `overlay.log` e o `server.log`.

## 8. Zonas livres e ocupadas do HUD do jogo, encaixe ao arrastar e layout padrão (a fazer)

Pedido do usuário (2026-10-11): "na tela do TFT existem espaços vazios e posições corretas onde podemos colocar o overlay; o
modo interativo permite eu clicar e arrastar?". Arrastar e redimensionar já funcionam no modo de edição (`Ctrl+Shift+F10`, que
agora captura a janela inteira; ver `overlay/README.md`). Falta saber **onde está livre**. Não foi feito nesta rodada: fica
descrito aqui.

**O que já está medido** (`overlay/hud/geometry.mjs`, a partir do leitor de tela, captura 2044x1149): ouro, nível, XP, estágio,
banco de itens e loja (parte `[ESTIMADO]`: `SHOP_CARD`, `BANK_PAD`, `LEVEL_XP_PAD`). **Não medido**: a lista de jogadores (vida
dos rivais, borda direita), o rastreador de sinergias (esquerda), as cartas de aprimoramento e o carrossel (centro), o tabuleiro
e a reserva de campeões.

Proposta, sem captura de tela:

1. `geometry.mjs` ganha regiões `[ESTIMADO]` em fração do HUD 16:9, para o usuário corrigir pela calibração: `players`
   (x ~0,865–0,995, y ~0,12–0,74), `traits` (x ~0,0–0,13, y ~0,18–0,70), `center` (cartas e carrossel, x ~0,20–0,78,
   y ~0,15–0,85), `board` e `benchRow` (reserva, y ~0,70–0,80). Cada uma marcada `estimated: true`.
2. Um módulo puro `overlay/hud/zones.mjs`: `occupiedZones(rects)` (medidas + estimadas, com nome e a marca de estimada),
   `freeZones(stage)` (o complemento no HUD 16:9 e as faixas laterais/superior que `fit.mjs` já calcula) e
   `snapRect(rect, targets, tol)` (encaixe nas bordas das zonas livres e dos outros blocos, a até `tol` px, sem sair do palco).
3. No modo de edição: contornos tênues das zonas ocupadas (nome; tracejado quando estimada) e das livres; ao arrastar
   (`widgets.mjs` `gestureResult`), o retângulo passa por `snapRect`; se o bloco cobre uma zona ocupada, a borda dele fica âmbar
   e o título diz qual ("cobre a lista de jogadores (estimada)").
4. Rever o `DEFAULT_LAYOUT`: a coluna padrão (x 0,735–0,925) cobre a faixa estimada da lista de jogadores (x ≥ 0,865). A
   migração de padrões já existe (`overlay/config.mjs` `DEFAULT_CHANGES`, `defaultsVersion`): ao mudar a coluna, subir a versão e
   listar os valores antigos dos elementos, para mover só o que o usuário nunca mexeu (com backup e log). A legenda `keys` já foi
   posta abaixo da lista estimada (y 0,745) e à direita da loja.
5. Testes: os padrões não cobrem nenhuma zona ocupada declarada em 16:9, 21:9 e 4:3; `snapRect` encaixa dentro da tolerância e
   nunca sai do palco nem entra numa zona ocupada que não cobria antes.

Risco: todos os limites novos são estimativas a partir do HUD padrão; o tamanho do HUD nas opções do jogo muda tudo. Só o
usuário, com o jogo aberto e a calibração, confirma.
