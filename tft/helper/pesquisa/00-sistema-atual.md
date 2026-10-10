# 00 - O que o TFT Helper (Lobby Compass / TFT Compass) faz hoje

Inventário do sistema em `tft/helper`, feito em 2026-10-10 lendo o código (não a documentação) e rodando os testes
(200 testes, 0 falhas: `node --test match.test.mjs augment-advice.test.mjs engine-flex.test.mjs item-edge.test.mjs
"v2/js/*.test.mjs" "tests/*.test.mjs"`). Serve de linha de base para comparar com a pesquisa sobre como jogadores de alto
nível jogam. Nada foi alterado; o servidor da porta 3218 não foi tocado e nenhum `POST /api/recommend` foi feito.

Convenção: `arquivo:função` aponta onde a regra mora. "Observado" = valor gravado pelo jogo; "lido da tela" = OCR/ícones;
"estimado" = hipótese do helper; "manual" = digitado pelo usuário. Números marcados como política são escolhas do autor
do helper, não regras do jogo nem medições.

Resumo em cinco linhas:

1. O helper é um **assistente de macro (economia, nível, rolagem, escolha de comp e itens)** que lê o tabuleiro de todos
   os jogadores (só peças em campo), a rodada (arquivo do Sentry), e ouro/nível/XP/loja/banco de itens por **OCR e
   comparação de ícones da tela**. Não lê memória, não injeta, não automatiza cliques.
2. A "inteligência" é uma mistura de **regras de bolso com números fixos** (`POLICY`), **matemática exata de loja**
   (cadeia de Markov + Monte Carlo) e **estatística publicada da MetaTFT/NoxuTFT** (colocação média de comps, builds,
   peça×estrela×itens, tiers de aprimoramento). Não simula combate.
3. **Posicionamento é um esboço fixo** (tanque na frente, alcance atrás), sem olhar o adversário. **Carrossel** só diz
   que componente pegar. **Não existe leitura do oponente da rodada**, de fase (planejamento/combate/carrossel) nas
   decisões, nem estratégia por estágio além de "curva de nível padrão" e de "nível de rolagem".
4. A interface v2 desenha só uma parte do que o servidor calcula (por exemplo, confiança, motivo da troca de plano,
   ameaças do lobby e `decision` são calculados mas **não são mostrados**).
5. Os maiores buracos de dado são: **reserva, ouro dos rivais, loja dos rivais, posições, quem enfrenta quem, resultado de
   cada combate** (inferido só pelo HP).

---

## 1. Fluxo de dados ponta a ponta

### 1.1 Fontes e como chegam

```
 jogo (arquivos)                                  cliente (LCU)              tela do jogo
 ├ TFTEoGStats.json   (tabuleiro de 8 jogadores)  ├ /lol-gameflow/session    └ screen-reader.ps1 (PowerShell 5.1)
 ├ .sentry-native/*.run/__sentry-event            ├ /lol-summoner/current        OCR Windows + ícones: ouro, nível, XP,
 │     (game.tft.round / phase / game.id)         └ /lol-gameflow/phase          estágio (reserva), loja (5 nomes),
 └ Saved/Logs/TFT.log (compra, estrela, item→banco, carrossel, BeginGame)           banco de itens (10 espaços),
                                                                                    cartas de aprimoramento
 rede (não oficial): MetaTFT comps_data/comps_stats, unit_items_processed,
                     tft-explorer-api (total, unit_tier, traits, units_unique, ...),
                     comp_augment_tiers; NoxuTFT (HTML dos aprimoramentos);
                     CommunityDragon (catálogo/itens/ícones, uma vez)
 manual: reserva (campo bench, até 9 peças), aprimoramento "Escolhi este", comp fixada, substituições
```

Tudo roda em `server.mjs` (Node, `127.0.0.1:3218`, sem dependências). A interface é estática em `v2/` (módulos ES, sem build).

| Dado                                                                                  | Fonte                                                                                                            | Módulo                                                      | Frequência / latência                                                                                                              | Confiabilidade                                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tabuleiro, itens equipados, vida, colocação, `augments` (sempre vazio) de 8 jogadores | `TFTEoGStats.json`                                                                                               | `capture.mjs:captureBoards`, `server.mjs:readBoardSnapshot` | `fs.watch` + varredura a cada **500 ms**; SSE para a tela; só grava linha quando o tabuleiro de alguém muda                        | observado, **só peças em campo**, sem posição                                                                                  |
| Estágio-rodada e fase (`Planning`, `Combat`, `Draft`=carrossel...)                    | `__sentry-event` (MessagePack)                                                                                   | `game-log.mjs:parseSentryEvent`, `readTag`                  | leitura no máx. a cada **400 ms** (`minIntervalMs`) por demanda de `/api/state`; mudança detectada na leitura seguinte             | observado; formato interno do Sentry                                                                                           |
| Partida (gameId, fase do cliente)                                                     | LCU HTTPS (`lockfile`, somente GET)                                                                              | `server.mjs:readLcu`                                        | cache de **5 s**, renovado em segundo plano; timeout 2 s                                                                           | observado                                                                                                                      |
| Ouro, nível, XP                                                                       | OCR de recortes 16:9 do HUD                                                                                      | `screen-reader.ps1` + `screen-reader.mjs`                   | laço de **2,5 s** (`IntervalMs`); só relê quando o hash do recorte muda; ouro/nível exigem 3 leituras iguais (recorte repetido 3x) | lido da tela                                                                                                                   |
| Loja (5 cartas)                                                                       | OCR do nome de cada carta + `champion()` com distância de edição (≤1 para nomes ≤4 letras, ≤2 senão, sem empate) | idem                                                        | idem                                                                                                                               | lido da tela                                                                                                                   |
| Banco de itens (10 espaços)                                                           | assinatura 16x16 RGB vs ícones do catálogo (`MATCH_MAX` 30, folga ≥ 8 para o 2º)                                 | idem                                                        | idem + debounce **3 s** (`ITEMS_SETTLE_MS`), x3 se ≥ 5 espaços não reconhecidos                                                    | lido da tela (172 dos 507 itens do catálogo têm ícone em `assets-manifest.json`; o README ainda cita 107; os demais viram "?") |
| Cartas de aprimoramento                                                               | OCR da faixa central, só se rodada ≤ 2 e em laços alternados (~5 s)                                              | idem, `augment()`                                           | exige ≥ 2 cartas reconhecidas                                                                                                      | lido da tela, **não verificado em partida real deste set**                                                                     |
| Compras/fusões do jogador                                                             | `TFT.log` (voz `Unit.Purchase`/`StarUp`)                                                                         | `game-log.mjs:parseLogLine`, `unit-ledger.mjs`              | 1-4 s (flush do log)                                                                                                               | observado, mas **não alimenta a análise**                                                                                      |
| Reserva de campeões                                                                   | **manual**                                                                                                       | `v2/js/bench.js`                                            | n/a                                                                                                                                | manual; o livro-razão só dá teto                                                                                               |
| Banco/itens/reserva dos rivais                                                        | não existe                                                                                                       | `pool-tracker.mjs:hiddenHoldings` estima                    | recalculado a cada análise                                                                                                         | **estimado**                                                                                                                   |
| Sequência vitória/derrota e tendência de vida                                         | derivado do HP entre rodadas                                                                                     | `streak.mjs`                                                | a cada `/api/state` e `/api/recommend`                                                                                             | inferido                                                                                                                       |
| Comps de meta (60 na cópia local, já após o corte de 5000 partidas), builds por comp  | MetaTFT `comps_data` + `comps_stats` (Platina+, últimos 3 dias, fila 1100)                                       | `meta-comps.mjs`                                            | renova se > **2 h**, conferido a cada **15 min**; ao renovar limpa cache e avisa as telas por SSE                                  | estatística pública, não oficial                                                                                               |
| Builds por campeão e desempenho por item                                              | MetaTFT `unit_items_processed`                                                                                   | `meta-builds.mjs`                                           | > 6 h, conferido a cada 30 min                                                                                                     | idem                                                                                                                           |
| Peça×estrela×itens, peça×item, sinergia×patamar                                       | MetaTFT explorer                                                                                                 | `meta-stats.mjs`                                            | > 12 h, conferido a cada 1 h                                                                                                       | idem                                                                                                                           |
| Colocação de tabuleiros inteiros e tabelas condicionais ao "trunfo"                   | MetaTFT explorer sob demanda                                                                                     | `evidence.mjs:explorer`                                     | cache 6 h em memória e disco; até 8 consultas em paralelo; timeout 30 s                                                            | idem                                                                                                                           |
| Aprimoramentos: média por rodada (2-1, 3-2, 4-2) e tier por comp                      | NoxuTFT (HTML) + MetaTFT `comp_augment_tiers`                                                                    | `augment-stats.mjs`                                         | > 6 h, conferido a cada 1 h                                                                                                        | idem (amostras pequenas)                                                                                                       |

Cópias locais hoje: `meta-comps.json` (60 comps; `patch: null`), `meta-builds.json` (patch 18.4b, 66 campeões, 142 itens,
1,45 milhão de partidas), `meta-stats.json` (base 4,453 em 2,84 milhões; 2294 células de unidade, 580 campeão×item, 191
sinergia×patamar), `augment-stats.json` (160 aprimoramentos medidos, 37 comps com tier), `augments.json` (2077 entradas).

### 1.2 Do dado ao conselho

1. `GET /api/state` (`server.mjs`, rota em `handle`): lê tabuleiro + LCU, `screen.sync()` liga/desliga o leitor conforme a
   fase do cliente (**o leitor só roda enquanto alguma tela chama `/api/state`**), funde tela e arquivo do jogo
   (`game-log.mjs:mergeSources`: a rodada do arquivo vale mais que a do OCR), passa o nível por `level.mjs:levelTracker`
   (valida contra piso de XP passivo e último nível confirmado), alimenta `streak.mjs` e devolve também `gameFiles`,
   `unitLedger` (informativo) e `match`.
2. A interface (`v2/js/main.js:refresh`) chama `POST /api/recommend` quando a chave de análise muda
   (`api.js:analysisKey`: payload, mtime do arquivo, fase, XP, estágio, loja, aprimoramentos, removedores e uma janela de
   **30 s**, ou seja, reanálise obrigatória a cada 30 s). Sondagem a cada **5 s** (pausa com a aba oculta) + SSE
   (`type: boards|match|meta`) com debounce de 200 ms.
3. `/api/recommend`: `validate()` → `analyze` (`engine.mjs`) com até **3 passes** de consulta ao explorer da MetaTFT (trunfos →
   candidatos → medição) → `tactics` (`tactics.mjs`: posições, trocas, builds de item, carrossel) → por plano:
   `playbook`, `stagePlan` (`stage.mjs`), `strategy` (`strategy.mjs`) e `teamCode` → `augmentAdvice`, `decide`,
   `contestAlert`. Cache de análise (12 entradas) e de base de análise (12), sem a evidência versionada à parte. Custo
   declarado: ~1 s de CPU; timeout do cliente 120 s.
4. `buildModel` (`v2/js/model.js`) reorganiza a resposta em HUD, formação, trilha "Agora" (Trocar, Equipar, Comprar, Vaga
   livre, Segure, Passar itens, Próximo item, Loja, Carrossel) e painel (Nível, Roll, Loja, "Por que esta decisão").

Latência fim a fim estimada pelo código (não medida): mudança de tabuleiro ≤ 0,5 s até o servidor + 0,2 s de debounce +
tempo de análise (≈ 1 s com cache de evidência quente; mais quando há perguntas novas ao explorer); ouro/nível/loja ≤ 2,5 s
de laço + OCR; banco de itens + 3 s de debounce; fase/rodada ≤ 0,4 s. Ouro mantido da última leitura fica marcado "velho"
após **15 s** (`HOLD_MS`) sem confirmação. Só é "ao vivo" (`actionable`) com `sameGame && phase === "InProgress" && idade
do arquivo < 120 s` (`server.mjs:current`).

### 1.3 Identidade e escopo

- Jogador local fixo: `HERO_ID = "47445859"` (`server.mjs`). Tudo (análise, histórico, registro de partidas) é do Hero.
- Só **TFTSet18**; outro set devolve 409. Fila: o registro de histórico reconhece Ranqueada, Normal, Dupla, Hiper Rolagem e
  Desafio PVE, mas as regras (economia, ODDS, pool) assumem partida normal solo de 8; **Dupla e Hiper Rolagem não foram
  verificadas** e não têm regra própria.
- Local-only: nada sai da máquina além de GETs às fontes públicas acima.

---

## 2. O que existe, por área

### 2.1 Economia e nível

**Regras do jogo codificadas** (`rules.mjs:GAME/ODDS/POOL`): loja custa 2g, 5 slots; XP custa 4g por 4 XP; XP passivo 2 por
rodada; renda base 5; juros 1 por 10g até 5 (50g); ouro de sequência `[[6,3],[5,2],[2,1]]`; XP para o próximo nível
`{1:2, 2:2, 3:6, 4:10, 5:20, 6:36, 7:56, 8:68, 9:68}`; estágio 1 com 4 rodadas, demais com 7, carrossel na 4ª e monstros
na 7ª de cada estágio; pool por custo `{1:30, 2:25, 3:18, 4:10, 5:9}`; ODDS por nível (1-11) da tabela do patch 18.3 (marcada "não
confirmada no 18.4"). Valor de venda: 1★ devolve o custo, 2★/3★ `3^(★-1)·custo - 1` (custo 1 devolve tudo) (`economy.mjs:sellValue`).

**Decisão de gasto** (`strategy.mjs:decide`, ordem fixa de regras; depois `settle` reconcilia com a regra de rolagem):

| Passo | Condição                                                                               | Ação                                                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | HP ≤ 0                                                                                 | "Partida encerrada"                                                                                                                                                                                                                                         |
| pré   | cartas da loja com `action = comprar`                                                  | listadas primeiro; o ouro delas sai antes de rolar/XP                                                                                                                                                                                                       |
| pré   | ouro nulo ou nível só estimado pelo tabuleiro                                          | não calcula odds/rolagem/XP; "AGUARDAR/COMPRAR"                                                                                                                                                                                                             |
| 1     | `pressure.danger`                                                                      | sobe de nível se `behind` e sobra ≥ 10g; rola até `budget(cash + venda - piso)`; na faixa crítica vende do banco o que passa do ouro (`sellableOf`, só banco fora da comp)                                                                                  |
| 2     | comp de reroll (nível de reroll conhecido) com 3★ pendente e `level ≤ rerollLevel + 1` | abaixo do nível: sobe se `behind` ou sobra ≥ 50g, senão economiza até 50g; no nível: desiste se todos os 3★ são inviáveis/disputados (sobe de nível se sobrar ≥ 30g), senão rola o excedente (piso **20g** se HP ≤ 50 = "rápido"; **50g** se não = "lento") |
| 3     | `level < rollAt` (comp de nível)                                                       | sobe de nível se (`behind` ? sobra ≥ min(piso,30) : sobra ≥ piso); se o lobby é fraco (`weak`) e rolar rende mais força/ouro que subir, rola; senão economiza                                                                                               |
| 4     | carry com < 3 cópias no nível de rolagem                                               | rola com o orçamento do ganho esperado                                                                                                                                                                                                                      |
| 5     | `level < finalLevel`                                                                   | sobe se sobra ≥ min(piso,30), senão economiza                                                                                                                                                                                                               |
| 6     | nível final                                                                            | rola o excedente ou mantém                                                                                                                                                                                                                                  |

Parâmetros (`economy.mjs:POLICY`, política do autor):

- Curva de nível "padrão" por estágio-rodada (`curve`): 2-1 → 4, 2-5 → 5, 3-2 → 6, 4-1 → 7, 4-5 → 8, 5-5 → 9; antes de 2-1 vale 3 (`curveLevel`). `behind = level < curva` ou rival médio ≥ 1 nível acima.
- Nível de reroll: o da comp de meta (`lvl N`) ou, sem ele, `{1:5, 2:6, 3:7}[custo do carry]` (`rerollLevelOf`). Nível final: Fast 9 → 9; senão `min(10, max(tamanho da comp, reroll, 8))` (`finalLevelOf`). Nível de rolagem do carry: reroll, ou `{1:5,2:6,3:7,4:8,5:9}` limitado ao nível final (`rollLevelOf`).
- 3★ disputado: ≥ **6 cópias** com rivais (em campo + banco estimado) ou > **35%** da pool (`isContested`).
- Força de unidade: `custo · [0, 1, 1.8, 3.2][★] + 0.6 · itens` (`mightOf`, mesma régua para o lobby, para a troca de peças e para o valor dos degraus de rolagem).
- XP: faltando ≤ 2 XP com o XP passivo da próxima rodada, não compra XP fora de perigo (`levelCostOf.passive`, `passiveWait`); nível máximo não sugere XP.
- Renda e projeção: `incomeOf` (base + juros + sequência atual mantida; vitória não prevista) e `projectGold` para 4 rodadas, com `reach50` (rodada em que chega a 50g).
- Estimativa de estágio quando não lido: pelo nível médio dos rivais (≥ 8 → 5-1, ≥ 7 → 4-1, ≥ 5,5 → 3-1).
- Nível-alvo (`target-level.mjs:suggestTargetLevel`): `level + 1` por padrão; HP ≤ 35 e < 50g → `level`; tabuleiro < 75% da mediana com HP < 60 → +1; ≥ 50g e HP ≥ 60 → +2; > 115% da mediana e HP ≥ 70 → +2; ≤ 3 rivais vivos e HP > 35 → +1; limite `[max(level,5), 10]`. Só dita o tamanho da comp planejada (`engine.growTo`), não a hora de subir.

**Leitura do nível** (`rules.mjs:reconcileLevel/levelFromXp/levelsForXp/levelFloor`, `level.mjs`, `screen-reader.mjs:accept`):
número OCR + total do XP ("4/10" → 4) se conferem; totais repetidos (2: nível 1/2; 68: 8/9) resolvidos pelo último nível e
pela queda do XP; conflito → vale o plausível (nível só sobe, `held..held+2`); leitura inverossímil é descartada se o XP não a
corrobora e ficar abaixo do piso do XP passivo ou do último nível confirmado; sem leitura, **piso derivado** (nunca cai);
última escolha é "estimado pelo tabuleiro" e então a estratégia não calcula nada. Premissa não verificada: 2 XP passivos
por rodada fora do estágio 1 e do carrossel.

**Como é testado:** `tests/economy.test.mjs` (juros, renda, venda, XP, projeção, níveis, pressão, `isContested`, PMF, curva
exata vs binomial, Monte Carlo vs exata, `bestSpend`, time inteiro), `tests/level.test.mjs` (14 casos, incluindo o caso real do
nível 2 retido no 4-5; o teste do HUD 16:9 só roda no Windows), `tests/strategy.test.mjs` (árvore de decisão por
cenário sintético de `tests/fixtures.mjs`), `tests/screen-reader.test.mjs` (leitor com `launch` falso). `target-level.mjs`,
`playbook.mjs` e `decision.mjs` **não têm teste**.

### 2.2 Rolagem (roll)

Dois níveis de cálculo, ambos puros (`economy.mjs`, `roll.mjs`):

1. **Chance exata de fechar uma estrela** (`economy.closeCurve`): cadeia de Markov em (cópias compradas × ouro). Cada loja
   custa 2g e mostra `Binomial(5, p_k)` cópias com `p_k = ODDS[nível][custo] · (livres - k) / (livres do custo - k)`; cada cópia
   achada é paga (`custo`) e a pool encolhe. Compra tudo o que aparecer e couber. `goldFor(curve, q)` dá o ouro para 50/80/95%.
2. **Rolagem do time inteiro** (`economy.rollSim`): Monte Carlo com números aleatórios comuns (**500 corridas**, semente
   `0x7f4a7c15`, teto de **120g**), todos os alvos disputando o mesmo ouro e a mesma pool; entrega `gain[g]` (força esperada
   ganha) e `any[g]` (chance de pelo menos um alvo que evolui fechar o 1º degrau). Só entram os **10** alvos que mais rendem
   por cópia (`simTargets`); o resto fica com a conta exata. `roll.mjs:simulate` guarda `SIMS` (24 entradas) para reaproveitar a
   simulação quando só o ouro muda.

**Quem são os alvos** (`roll.mjs:teamOf`): todo campeão do tabuleiro, do banco (manual) e da comp recomendada que sobe de
estrela (3 cópias → 2★, 9 → 3★; peça nova da comp à venda só vale 1 cópia, e no carry mais o 2★). 3★ distante (≥ 4 cópias
faltando, fora do plano e fora do `stars3`) aparece na lista mas fica fora da conta. Cada peça tem cópias suas (pool
`own` + compras da loja lida), `free` (provável: teto observado menos o banco estimado dos rivais), `upper` (teto
observado), chance por slot/loja, `gold50` e um **peso de valor**: `w = (carry 2 | core 1.5 | 1) · (1 + 0.25·itens) · (fora da
comp ? 0.6 : 1)` e valor do degrau `w · custo · (STAR[to] - STAR[to-1])`; peça nova vale `w · custo · 1 · 0.5`. Core =
carry, "trunfos" medidos, peças ligadas ao aprimoramento escolhido, quem tem build na comp de meta ou ≥ 2 itens.

**Inviável** (`piece.why`): `nivel` (a loja do nível tem 0% do custo), `sem-copias` (teto < faltam), `bancos` (livres
prováveis < faltam; o resto deve estar no banco de rivais), `disputada` (3★ disputado). Sugere o substituto de `flexOf`.

**Regra única "vale rolar agora?"** (`roll.mjs:rollRule`, aplicada por `strategy.mjs:settle`): rola se existe orçamento ≥ 2g
acima do piso com **≥ 50% (`roll.chance`) de chance de evoluir alguma peça que valha a evolução** (`minValue` 1: um 2★ de custo
1 sozinho não vale), usando o melhor entre "comprar tudo o que aparecer" e "focar numa peça só" (`sim.mix`). Em perigo basta
ganho esperado > 0. Sem peça viável → `blocked`/`none`; sem ouro acima do piso → "juros caem"; se a peça principal fica
≥ **15 pontos percentuais** (`waitMargin`) mais provável no nível de rolagem da comp → `wait` ("espere o nível N"). Se a árvore
mandava rolar e a regra contradiz, vira guardar; se mandava guardar e a regra passa, vira rolar o menor gasto (par) que passa.

**Quanto rolar** (`economy.bestSpend`): maximiza `gain(B) - preço · custo(B)`, com `custo(B) = B + horizonte · juros perdidos`
e `preço = urgência · ganho médio por ouro de gastar o máximo`; empates dentro de **4%** (`spendTolerance`) ficam com o maior
gasto. Faixas: urgência `{saudável 1, ferido 0.6, perigo 0.25, crítico 0}`, horizonte de juros `{3, 2, 1, 0}` rodadas.

**O que a interface mostra** (`ui/panel.js`): veredito, orçamento ("até N lojas", "pare em Xg", "de Yg" quando o joelho antecede
o piso), nota de juros só quando rolar derruba o patamar, peças na loja agora, até 6 linhas (as melhores + até 2 inviáveis) com
cópias, chance por loja, chance de fechar com o orçamento, rivais/banco estimado, curva "pelo menos uma peça evolui", barra de odds da loja
com o custo do carry aceso.

**Como é testado:** `tests/roll.test.mjs` (7 casos: alvos, pesos, inviável, peça nova, espera, piso, reaproveitar simulação),
`tests/strategy.test.mjs` (≈ 20 casos de rolar/guardar, perigo, reroll rápido/lento, 3★ disputado, loja lida, juros),
`tests/economy.test.mjs` (convergência MC → exata), `v2/js/panel.test.mjs`, `v2/js/model.test.mjs`.

**Não considerado na rolagem:** a loja atual já aberta só entra via cartas lidas (OCR); a rolagem não conhece o
**conjunto de peças que o jogador de fato quer por estágio** (ex.: "rolar em 3-2 para 4-1"), só o custo de reroll e o nível.
Rolagens grátis, "re-roll" de augment e Hyper Roll não existem no modelo.

### 2.3 Escolha de comp/plano e troca de plano

**Fonte única de candidatas:** as comps da MetaTFT (`meta-comps.mjs`), com tier **próprio** do helper pela colocação média
(`item-edge.mjs:tierOf`: S ≤ 4,25; A ≤ 4,40; B ≤ 4,60; C acima; hoje 6 S, 12 A, 13 B, 29 C) e corte de 5000 partidas. Sem
cópia local, cai numa busca heurística própria (`engine.score`).

**Pontuação heurística de encaixe** (`engine.mjs:analyze`, usada sem evidência e como desempate): para cada unidade da
comp, `preservation` (investimento já feito: `(1.5 + log2(cópias+1)·custo·0.6 + 2·itens) · (0.6 + 0.08·nível)`), `strength`
(`custo^1.25 · 2`), `dispute` (`cópias com rivais / pool · 12`, subtrai), `access` (`ln(1 + chance_por_slot_no_nível_alvo·100) · 0.7`),
itens que combinam com o papel (`1.1` cada; +1 para on-hit com Guinsoo/Nashor), casamento com itens defensivos dos rivais
(`0.35` por item de armadura/RM observado contra o papel AP/AD), `patchBias` (12 campeões com bônus -0,4..+0,8, "priors
qualitativos do 18.4/B-patch"), mais sinergias (patamar ativo `4 + 3·tier`, progresso `0.8·count/next`), equilíbrio (-6 por tanque
faltando até `floor(nível/3)` ≤ 3, -9 sem alcance ≥ 3) e encaixe de itens (`+1.5` por item com portador, `-4` por item órfão).
Para comps de meta: `fit = preservation + items + access + matchup - dispute`; `meta = (5 - colocação ajustada pelos itens) · 15`;
`build` (`buildFit`: itens da build do carry prontos/montáveis `6` cada, outros `1.2`, componente sozinho `0.35`, desajuste AD/AP até `-18`);
`+4` por unidade ligada a sinergia de aprimoramento escolhido; `+10` de inércia (`STICKY_BONUS`) para a comp já sugerida; `+` emblema alcançável.
Comps menores que o nível são "ampliadas" (`extend`) pondo a unidade que mais soma (novo patamar `+8`, custo `·1.5`, já é sua `+4+★`, disputa `-6·fração`).
Só entram unidades que a loja do nível alvo oferece com ≥ 10% por slot (custo 5 só com nível ≥ 9) ou que já são suas.

**Evidência medida (quando o explorer responde):** `engine.measure`. Para cada candidata (comp de meta, "tabuleiros de vantagem" em
volta de até 2 "trunfos" seus, e o "seu tabuleiro atual") monta perguntas encadeadas à MetaTFT (`evidence.mjs`: trunfo exato ou
"presente", sinergias do aprimoramento, até 3 peças principais, até 2 itens prontos/emblema) e usa a **pergunta mais longa com
≥ 300 partidas** (`MIN_GAMES`). Colocação esperada = `p·média_medida + (1-p)·fallback + Σ ajuste de tier dos aprimoramentos`
(`TIER_PLACE`: S -0,30, A -0,15, B 0, C +0,15, D +0,30), em que `p` é a chance de montar o que foi medido
(`pFind` = ≥ 1 cópia nas lojas que o ouro das próximas 4 rodadas paga). Total = `(baseAvg - esperado) · 20` (`PLACEMENT_POINTS`).
Uma candidata com `p < 0,5` é "aposta" (`SAFE`; `0,35` para o plano em andamento, `SAFE_KEPT`) e só passa à frente se não houver nenhuma segura;
com aprimoramento de sinergia escolhido, quem o usa vem antes de quem o descarta.

**Troca de plano com confiança** (`engine.mjs`, bloco `switchNote`): o plano em andamento (`options.sticky`) só cede ao melhor se
`ganho > Z95·√(se_a² + se_b²) + custo de trocar`; `Z95 = 1,645`; `se = max(p, 0,2) · 2,29/√partidas`; custo = `SWITCH_COST[estágio] ·
fração de peças que mudam` com `{1:0.1, 2:0.1, 3:0.25, 4:0.5, 5:0.8}` colocações. Confiança da escolha (`alta` z ≥ 1,645, `média` ≥ 0,5,
`baixa`) fica em `evidence.confidence`. Cada troca de plano na mesma partida é gravada em `tft/data/plan-changes.jsonl`.
Desfecho observado nesses logs: ~82 trocas em 8 partidas (30 só numa partida; `kept` verdadeiro em apenas 2; o arquivo cresce com o servidor ligado) — o plano oscila
bastante nos primeiros estágios.

**Seleção manual:** tela Comps (`/#comps`): filtros (texto sem acento, estilo, tier), ordenações (encaixe, "com seus itens",
média, top 4), "Seguir esta comp" (`goalCompId`) e "Liberar". Comp fixada vale só na partida em que foi escolhida.
`compRanking` devolve todas as comps com posição, peças já suas, disputa, itens do carry, `adjustedAvg`, `itemTier`, `evidence`.

**Ajuste pelos itens** (`item-edge.mjs:itemEdge`): para cada campeão da comp cuja build publicada melhora a colocação
(`place_change` < 0) conta quantos itens você tem prontos ou monta com componentes (cada peça de estoque serve a uma build só);
efeito = variação encolhida `Δ·n/(n+1500)` × (fração de itens)² × peso do papel (carry 1, dano 0,5, tanque 0); as 3 maiores somam com
pesos `1 / 0,6 / 0,35` e teto de **0,4** colocação. Comentário do código: a fonte só publica a melhor build, o efeito vem inflado
(235 de 236 builds "ganham").

**Como é testado:** `engine-flex.test.mjs` (substituições, carry intocável, evidência manda, aposta, regra do Rival, confiança/troca),
`item-edge.test.mjs`, `v2/js/comps.test.mjs`. Ranking heurístico base (`score`, `buildFit`, `extend`) **não tem teste direto**; `decision.mjs`
(evoluir/ajustar/trocar) **não tem teste** e **não aparece na v2**.

### 2.4 Substituições dentro da comp (flex)

`engine.mjs:flexOf` (e `previewFlex` para a comp fixada): para cada peça que não é o carry, procura campeões de custo ±1 e
mesmo papel (tanque ou dano) alcançáveis (já seus, ou cópia livre + ≥ 10% por slot no nível alvo). Pontua
`6·Δpatamares de sinergia + (já é sua: 5+2★) - (peça atual sua: 6+2★) + 12·(disputa atual - disputa da alternativa) + 1,5·(acesso) +
1,5·Δcusto + 2 se mesmo papel + 20·Δ(colocação com o trunfo, MetaTFT)`. Descarta quem perde > 1 patamar ou é disputado. Sugere trocar
quando a peça está sob pressão (disputada, sem cópias, fora da loja) e a alternativa não perde > 1 patamar, ou quando a alternativa
já é sua, não perde sinergia e a peça da comp ainda não é. Cada substituto serve a uma peça. UI: `ui/subs.js` ("Usar"/"Desfazer";
`goalSwaps`/`compSwaps` por partida).

### 2.5 Scouting, pool, contest e bancos rivais

- **Pool** (`engine.analyze`): cópias vistas = tabuleiros de todos os jogadores vivos + reserva manual do Hero, com cópias
  nominais 1/3/9 por ★ (`3^(★-1)·quantity`). `remainingUpper` = pool - visíveis; `remainingLikely` desconta também o banco estimado dos
  rivais. Chance por slot = `ODDS[nível][custo] · livres do campeão / livres do custo` (denominador usa o provável), chance por loja
  `1 - (1 - p)^5`. Não desconta: as 5 cartas da própria loja (só as compradas, via `denom`), lojas dos rivais, cópias vendidas que
  voltaram sem aparecer, nem unidades dos rivais que estão no banco além da estimativa.
- **Banco dos rivais estimado** (`pool-tracker.mjs:hiddenHoldings`, política `BENCH_POLICY`): cada cópia que sai do tabuleiro de um
  rival conta como "guardada" com peso `keep = 0,5` que decai com meia-vida de **3 min**; se a peça volta ao campo ou vira 2★, o
  peso some; teto de **18** cópias por rival; eliminado ignorado. O servidor arredonda a 0,5 para a chave de cache.
  Testado em `tests/pool-tracker.test.mjs`; **nunca validado contra verdade** (não há banco de rival em arquivo).
- **Disputa da comp** (`contest.mjs:contestAlert`): rival que joga peças da comp exibida **ou** suas peças em campo. Nível
  `high`: rival com o seu carry e ≥ 3 peças, ou ≥ 4 peças; `medium`: carry, ou 3 peças, ou ≥ 2 rivais com ≥ 2 peças. Se estágio < 4 sugere
  comp de meta alternativa (carry diferente, ≤ 1 peça em disputa, total dentro de `max(15, 20% do melhor)`), maior número de peças já suas;
  estágio ≥ 4 só diz "tarde para trocar". Banner em `ui/contest.js`. Testado em `tests/contest-replay.test.mjs`.
- **Força do lobby** (`economy.lobbyStrength`): `mightOf` do Hero vs cada rival vivo → posição no lobby, mediana, nível médio dos
  rivais (= número de unidades em campo), unidades 2★+ dos rivais; `weak` = lobby ≥ 4 jogadores e posição abaixo dos 60%.
  Usado em estratégia, perigo e na escolha entre rolar e subir.
- **Ameaça do lobby** (`tactics.mjs`): participação de dano físico vs mágico (peso `★·(itens+1)` por papel), contagem de unidades com cura,
  crítico (Infinity Edge), armadura, resistência. Altera a pontuação de itens (+8..+10 para Last Whisper, Void Staff, Sunfire/Morello/Red
  Buff, Dragon's Claw, Bramble, Giant Slayer) e vira 3 textos de "counters". **A v2 não mostra os counters nem os rivais**; o seletor de
  scouting da v1 foi removido e `viewedPlayerId` vai sempre vazio.
- **Livro-razão de compras** (`unit-ledger.mjs`): exposto em `/api/state.unitLedger`, mas **não usado**: a reconstrução da reserva
  falhou na validação com 8 partidas reais (sobra de 16-48 cópias contra 9 vagas, vendas e movimentos não são gravados).
- **Gravações para validação futura:** `tft/data/lobby-boards.jsonl` (tabuleiros finais dos 8 com colocação oficial, 113 linhas) —
  **nenhum código lê esse arquivo**; `scouting-captures.jsonl` (7569 linhas) alimenta replay e `hiddenHoldings`.

### 2.6 Itens

- **Banco**: lido da tela (ícones). Removedor de Itens é reconhecido, mas a quantidade só é lida pelo selo (OCR do número) e o helper
  só garante "há/não há" (`removers === 0 ? 0 : null`).
- **Build por campeão** (`tactics.mjs:build`): com dados, a ordem é a da MetaTFT (build da comp primeiro, depois a geral;
  `wishlist`); posição `126 - 6·rank`; item medido (≥ 300 partidas) desempata `±2,5` se há build da comp, ou vira `110 - 40·Δcolocação` se não;
  bônus por ameaça do lobby (+6..+10); duplicação de efeito já coberto (Void Staff / Last Whisper / feridas) `-45`; completa componente já
  equipado `+30`; montável agora `+20` (meta) ou `+45` (heurística). Sem dados de meta, usa tabelas fixas por papel (tanque/AD/AP) com
  pontos hard-coded. Não repete Blue Buff + Shojin; Luvas do Ladrão travam o campeão; ≤ 3 itens por campeão.
- **Passar itens** (`tactics.mjs:plan`, `itemMoves`): item em unidade que sai da comp, ou fora da build de quem o leva, vai para quem o usa
  melhor entre os em campo (carry primeiro, depois posição na lista). Método: removedor, vender a unidade que sai, ou "sem removedor".
- **Montar/Equipar** (`ownedItemAdvice`, `stage.mjs`): receitas que o banco permite, em quem equipar, `near` (falta 1 componente),
  item pronto no banco → unidade com slot que mais o usa (`20 - 2·rank` se está na build, `6` se o papel serve, `+4` peça da meta, `+3` carry).
- **Tier de itens** (`item-tiers.mjs:itemTiers`): média de colocação por item (MetaTFT) → Bayes empírico por categoria
  (DerSimonian-Laird), z com cortes **±0,4 e ±1** → S-D; componentes/consumíveis sem tier. Tela Itens (Tier / Receitas / Atributos).
- **Atributos e receitas**: `build-items.mjs` (CommunityDragon pt_br + en_us), grade de receitas, matriz de atributos.
- **Testes**: `tests/item-tiers.test.mjs`, `v2/js/items.test.mjs`, `tests/carousel.test.mjs`, `item-edge.test.mjs`. `tactics.build`/`itemMoves`
  são exercitados indiretamente (traits.test.mjs, strategy.test.mjs); **não há teste direto das pontuações de item**.
- **Rigidez**: as classes de item (`itemRole`, `kind`, `TANK/AP/AD` regex em `meta-builds.mjs`, `engine.mjs`, `stage.mjs`, `tactics.mjs`) são listas
  de nomes escritas à mão, repetidas em quatro arquivos e não derivadas dos atributos do catálogo.

### 2.7 Aprimoramentos

- **Registro**: o jogo não grava qual aprimoramento o jogador escolheu (`players[].augments` vem vazio; `customAugmentContainer` não lista
  ofertas). O usuário marca "Escolhi este" (ou desmarca) na interface (`v2/js/augs.js:augStore`, `localStorage`, até 8, só na partida);
  vão em `augments` para o servidor, que registra no histórico (`match.mjs:augments`).
- **Ofertas**: lidas por OCR da faixa central (rodada ≤ 2 do estágio, ≥ 2 cartas reconhecidas). `augmentAdvice` (`augment-advice.mjs`):
  - Com dados medidos: ordena por colocação esperada = média geral encolhida para 4,47 com `SHRINK_GAMES = 300`, desvio da rodada
    (2-1, 3-2, 4-2; partidas da rodada estimadas dividindo o total entre as rodadas) + ajuste do tier na comp do plano (`TIER_PLACE`). Sem dado
    medido o card recebe a média geral e `estimated: true`. Empate se a diferença < 0,05. `reroll` marca quem fica ≥ 0,1 pior que a média.
  - Sem dados: pontos de bolso (sinergia da comp alvo `+6` (`+2` se ativa, `+min(4,count)`); sinergia fora `-5`; "segue o seu caminho" `+4`;
    emblema que fecha patamar `+5`; cita campeões da comp `+2` cada; ouro `+3/+1/-2` por HP e estágio; itens `+3/+1`; sustentação com HP < 50 `+2`;
    XP em comp Fast 9 `+2`; rolagens grátis no nível de roll `+7`, senão `+2`).
  - A escolha afeta a análise: sinergias do aprimoramento favorecem comps que as usam (`+4` por unidade, `augmentTraits`), liberam traços
    "solo" (Rival com Aminimigos), definem "trunfos" (peças ligadas) e o emblema que ele dá entra como item seu (`augmentEmblem` em `server.mjs`).
- **Trilha** 2-1 → 3-2 → 4-2 (3 escolhas): fixa em `AUG_STAGES`. Aprimoramentos de Prismático/rodada 5-x e ajustes por estágio posterior
  **não existem**.
- **Testes**: `augment-advice.test.mjs` (2 casos), `v2/js/augs.test.mjs` (3 casos). `augment-stats.mjs` (parser Noxu) e a leitura por OCR das
  cartas não têm teste de ponta a ponta.

### 2.8 Emblemas e traços

- **Contagem de traços** (`v2/js/traits.js`, regra única usada por engine, tactics, servidor, UI e histórico): campeões **distintos** por
  traço; emblema equipado (`X Emblem`, cujo X seja traço do set) soma à peça que ainda não tem esse traço; duas cópias do mesmo
  campeão contam uma vez e juntam os itens; emblema repetido ou no portador que já tem o traço não soma.
- **Patamares** vêm de `catalog.traits[].effects[].minUnits` (≤ 12). Traço "solo" (texto "Only active while fielding 1") desliga com 2 peças, salvo se um
  aprimoramento o libera (`soloOnly` em `engine.mjs`). Lux/Avatar é excluída das sugestões (`Avatar` no traço).
- **Emblemas montáveis** (`engine.emblemEdge`): com Espátula/Frigideira e o outro componente no banco (ou emblema pronto), escolhe o que mais
  rende na comp: fechar o próximo patamar `10 + 4·(tier+1)`, reforçar traço ativo `3`, senão `2·(count+1)/next`; sem o 2º componente vale **60%**.
  Portador: peça da comp sem o traço, de preferência sua e com menos itens. Entra no total da comp (`+points`) e em `emblemFor` para a
  pergunta de evidência (efeito medido do patamar em `meta-stats.trait`).
- **Dicas de sinergia** (`tactics.synergyTips`): traços a 1 unidade do próximo patamar → 3 campeões mais baratos + emblema montável e quem recebe.
- **Não modelado**: Wisps, invocações, regras especiais de adjacency, traços que mudam com o nível do jogador ou a mais de um emblema
  de efeito próprio (há `unmappedEmblems`, emblemas do catálogo sem traço correspondente), nem traços de aprimoramento sem item.
- **Testes**: `tests/traits.test.mjs` (7 casos: 3+1 com emblema, sem duplicar, todo emblema do catálogo, contagem pura, histórico, concordância
  motor/plano, emblema no banco só como oportunidade).

### 2.9 Posicionamento (existe, mas é um esboço)

`tactics.mjs:plan` → `place`. Grade de 4 linhas × 7 colunas. Regras:

- **Linha 0**: tanques; **linha 1**: lutadores melhores primeiro (papel tanque, depois mais ★); **linha 3** (fundo): unidades com alcance ≥ 3, o
  carry primeiro. Se a linha está cheia, usa as outras (na linha 3, desce 2→1→0).
- Colunas dos de frente: `[3,2,4,1,5,0,6]` (centro para fora). Colunas dos de trás: lado direito `[5,6,4,3,2,1,0]` (carry em 5) ou lado
  esquerdo `[1,0,2,3,4,5,6]`.
- Motivo textual por papel ("absorver o primeiro contato", "manter alcance atrás da frontline", "entrar na luta sem receber todo o foco").
- `positionNote`: "posições reais dos adversários, alcance de todas as habilidades e regras de adjacency não foram capturados".

Limites reais: `side` é sempre `"right"` na v2 (`api.js:recommendPayload`); o botão Espelhar e o arrastar/trocar hexágonos eram da v1 e
**foram removidos**; a v2 desenha a formação alvo (clique = ver itens), não a posição atual (`boardPieces` não traz posição). Não há: carry no canto oposto
ao do adversário, isca, agrupamento contra assassinos, separação de carries, anti-controle, posição de unidades de apoio/invocação, reposicionamento
por rodada, nem leitura do tabuleiro do próximo adversário. **Sem testes** de `place`/`positions`.

### 2.10 Carrossel

`carousel.mjs:carouselPicks` (até 3 componentes, só do banco/builds): distribui o banco entre as builds recomendadas na ordem carry →
tanque → demais; peso do campeão `{carry 3, tanque 1.6, outros 1}`, do item da build `[1, 0.75, 0.55, 0.45...]`; componente que **fecha** um item agora
vale `10 ×` peso, que **começa** o próximo `3 ×`; usos extras do mesmo componente somam `0,25`. Cada componente do banco é usado uma vez. Mostrado
como etapa "Carrossel" na trilha de itens (componente → item que fecha/começa → campeão).
Limitações: **só diz o tipo de componente**; não lê as opções reais do carrossel (campeões com item), não ordena a escolha por vida (ordem
de pick), não aparece só na fase certa (a fase `Draft` é lida do `__sentry-event`, mas `phaseKind` não é consumido por nenhuma decisão), não
pondera item pronto vs componente vs unidade, nem considera sorte/ordem de pick. Testado em `tests/carousel.test.mjs` (6 casos).

### 2.11 Perigo, HP e sequência

- **Faixas de vida** (`economy.mjs:pressureOf`, `POLICY.hp`): `critical` ≤ **20**; `danger` ≤ **30**, ou ≤ **45** a partir do estágio **4**, ou ≤ **50** com lobby fraco
  (`weak`), ou "sangrando" (`bleeding`: vida projetada ≤ 15 em 3 rodadas no ritmo da perda média das últimas 3, ou ≥ 3 derrotas em 5 min
  com HP ≤ 65); `hurt` ≤ **60**; `healthy` acima. Piso de ouro `{50, 30, 10, 0}` (+ `fastReroll` 20), urgência e horizonte como em 2.2.
- **Sequência** (`streak.mjs`): o arquivo do jogo não grava resultado; a derrota é inferida quando o HP da rodada seguinte cai (menor HP visto por rodada),
  só rodadas PvP (`isPvp`: estágio ≥ 2, não carrossel nem monstros); rodada sem leitura interrompe. `trend()` olha as quedas em uma lista própria de HP (não
  depende do estágio lido). Dano que chega atrasado no arquivo está coberto por teste. **Vitória e derrota empatada não distinguem "perdeu por pouco".**
- Efeito: a faixa muda o piso de ouro, a urgência de gasto, o horizonte de juros, se vende o banco, se compra cartas secundárias na loja
  abaixo do patamar de juros (`stage.mjs`), a ponderação de ouro/sustento de aprimoramentos e a "troca de plano" (`SWITCH_COST`).
- Testado em `tests/streak.test.mjs`, `tests/economy.test.mjs` (pressão), `tests/strategy.test.mjs`.

### 2.12 Confiança e transparência

- `evidence.confidence` (z, nível, margem, ruído) e `evidence.switch` existem no JSON e vão para `plan-changes.jsonl`; a v2 **não os mostra**.
- Cada decisão carrega `reasons` e `steps` (texto) exibidos em "Por que esta decisão"; o veredito de rolagem mostra a chance e a peça principal.
- Avisos de fonte: `status.reader` (erro do leitor), "snapshot de outro jogo", "planejamento · leitura de há Ns", nível `≥N` (piso) ou `~N` (estimado), ouro velho esmaecido.
- Texto de limite recorrente nas respostas: "não simula combate".

### 2.13 Loja lida e campo de agora (`stage.mjs`)

Campo sugerido para o nível atual (peças da meta primeiro, depois temporárias mais fortes por `★·custo + 2·itens`), compras da meta que a loja
do nível oferece (≥ **10%** por slot, `MIN_ODDS`) com chance por loja e quantas lojas até achar, pontes que ativam sinergias da meta, o que fica "para depois"
(com o nível em que desbloqueia). Cada carta lida vira ação: prioridade `fecha upgrade 4 + carry 3 / meta 2 / cópia sua 1`; ignora o que não está no plano; "sem ouro"; "segure"
se não é do núcleo, o HP não está em perigo e comprar derrubaria o patamar de juros. Troca de unidade (`tactics.transitions`) só fica "pronta" quando a
entrante vale ≥ **90%** do corpo `custo·★` da que sai; senão "segure e junte N cópias". Testado dentro de `tests/strategy.test.mjs`.

### 2.14 Ciclo de partida, histórico e replay

`match.mjs:matchTracker` (a cada **2 s**, mesmo sem tela aberta): início por LCU (`InProgress`/`Reconnect` + gameId novo) ou por tabuleiro; fim por vida ≤ 0
(`ffaStanding`), Hero único vivo, fase `WaitingForStats/PreEndOfGame/EndOfGame` ou duas leituras seguidas fora da partida; espera até 3 min pela colocação.
Histórico `tft/data/match-history.jsonl` (32 registros hoje, alguns sem colocação); `GET /api/history`. Replay (`replay.mjs`, `#partida/<id>`) reconstrói o
último tabuleiro de cada jogador a partir das capturas e roda a mesma análise com nível = nº de peças (sem banco, loja, ouro nem XP). Início de partida limpa
caches, plano fixado e leitor. Testes: `match.test.mjs` (12), `tests/contest-replay.test.mjs`, `tests/game-log.test.mjs`, `tests/unit-ledger.test.mjs`.

### 2.15 O que a interface v2 realmente mostra

Mostra: HUD (fase, vida, nível/XP, ouro com piso e juros, progresso da meta), formação alvo em hexágonos + sinergias, trilha de ações, inventário
lido, painel Nível/Roll/Loja/"Por quê", Substituições, Aprimoramentos, aviso de disputa, Comps, Itens, Histórico, Resultado, código do planejador do jogo
(`team-code.mjs`: formato "02" + 10 slots hex + `TFTSet18`, só campeões).
Calculado mas **não mostrado**: `recommendations[1..2]` (só a primeira ou a comp fixada é desenhada), `decision` (evoluir/ajustar/trocar/estabilizar),
`playbook` (só como gate), `counters`/`matchup` (ameaça do lobby), `opponents`, `evidence.confidence/switch/top4/measured`, `targetLevelReasons`,
`unitLedger`, `gameFiles.hints`.

---

## 3. O que não existe ou é fraco (frente ao jogo)

Ordenado por impacto provável num jogador competitivo; "fraco" = existe, mas com premissa frágil.

1. **Posicionamento real**: nenhuma leitura de onde estão as peças (nem as suas nem as do adversário); formação fixa por papel; sem
   plano contra o próximo adversário, sem canto/isca/agrupamento, sem reposicionamento por fase. A UI não mostra mais a posição atual.
2. **Oponente da rodada**: o helper não sabe quem você vai enfrentar (o arquivo do jogo e o log não expõem o pareamento) e não faz "scouting do próximo
   adversário" nem "olhar os 7 tabuleiros 1 vez por estágio". A lista de rivais calculada não é exibida na v2; não há seleção de rival.
3. **Fase da rodada nas decisões**: planejamento vs combate vs carrossel vs PvE é lido (`phaseKind`) mas ignorado. O conselho é o mesmo durante o
   combate, não prioriza "o que fazer agora nos 30 s de planejamento", nem tem aviso de tempo.
4. **Rolagem por estágio**: a regra é por **nível** e por faixa de vida, não por estágio-rodada. Não modela "rolar em 3-2/3-5/4-1", "rolar para
   estabilizar no 2-x", economia mínima por estágio, nem o ponto de "all-in pelo fast 8" além de `rollAt`. A curva padrão (`curve`) é o único
   conceito de estágio, e só seis pontos.
5. **Pool e shop dos rivais**: as 5 cartas da sua loja que ainda não foram compradas e as lojas dos rivais não entram; bancos rivais são só uma heurística
   de decaimento (`keep 0,5`, meia-vida 3 min), nunca validada.
6. **Carrossel**: só componente; sem as opções reais, sem prioridade por vida/ordem, sem campeão com item, sem relação com a fase.
7. **Itens**: sem ponderação slam-vs-guardar nem previsão de qual item vem (o log só conta `ItemFlyToBench`); listas hard-coded por papel; ícones
   de 172 de 507 itens (itens sem ícone viram "?"); consumíveis, Reforger, Masterwork e baús ficam fora da análise (`NOT_BUILDABLE`); sem Thief's Gloves além de bloqueio; o efeito de
   item sobre a comp usa builds da MetaTFT com viés conhecido (só a melhor build é publicada).
8. **Aprimoramentos**: só 3 escolhas (2-1, 3-2, 4-2); dependem de marcação manual; leitura por OCR não verificada neste set; valores medidos (Noxu) com
   amostra pequena e sem separar nível de elo; sem lógica de "tipo certo antes do mais forte" (econômico/itens/combate) além de pistas textuais;
   sem reroll de card como decisão (só marca `reroll`).
9. **Combate**: nenhuma simulação, nem estimativa de quem ganha a luta; "força" é `custo·★ + itens` e a sequência vem do HP.
10. **Perigo/HP**: faixas e limiares de política; não distingue "perder por pouco" de "ser aniquilado", não usa o HP do oponente da rodada, não
    modela bônus de sequência em risco, nem o custo de "cair de ouro" por estágio (juros) fora do patamar de 10g.
11. **Dupla (Double Up) e Hiper Rolagem**: sem regra nem fluxo; `partnerGroupId` existe no arquivo e é ignorado.
12. **Pivô/flex**: substituições só dentro da comp (±1 custo, mesmo papel); não há pivô de comp planejado nem "comp de transição" explícita além de `extend`.
13. **Dependência do nível**: sem nível lido (OCR falhou) o helper não calcula odds, rolagem nem XP (`levelEstimated`); o nível é o dado mais crítico e
    o mais frágil (layout 16:9 centralizado inferido de uma janela só; nível 10+ e ouro de 3 dígitos não verificados).
14. **Reserva**: manual e sem sincronização; unidades do banco com itens não existem no arquivo; o Hero precisa digitar a reserva para o motor contar cópias.
15. **Confiança**: calculada e não exibida; plano oscila nos primeiros estágios (~82 trocas em 8 partidas).
16. **Patch**: `ODDS` e pool são do 18.3, "não confirmados no 18.4"; `patchBias` é de 12 campeões à mão; `meta-comps.json` não registra o patch (`null`).
17. **Cobertura de teste**: ver 4.2.

## 4. Limitações

### 4.1 O que o sistema não consegue saber (por causa dos dados)

- Ouro, nível, XP, loja e banco de itens: **não existem em arquivo ou API local permitida**; só OCR/ícones (sujeitos a erro de leitura, janela coberta,
  resolução e proporção diferentes de 16:9, tela cheia exclusiva) ou entrada manual. Premissa registrada: o HUD é 16:9 centralizado e escalado pela altura.
- Reserva de campeões do Hero e dos rivais; vendas; movimentos tabuleiro↔reserva; compras de XP; rerrolagens; ouro gasto — nenhum é gravado.
- Posição das peças (`boardPieces` traz `championName`, `endOfGameAlias`, `itemNames`, `price`, `starLevel`: nada de hexágono).
- Ouro, nível, XP, vida exata do dano recebido, loja e itens no banco dos rivais; aprimoramentos escolhidos (nem os seus: `augments` vazio); itens
  fora do tabuleiro (componentes livres) dos rivais.
- Quem enfrenta quem na rodada e o resultado do combate (só HP no arquivo seguinte, com possível atraso).
- Nível dos rivais: só o número de unidades em campo (invalidado por slot extra, invocações, jogar abaixo do nível).
- Quanto XP ou quanto ouro de sequência de fato foi ganho (a sequência é inferência pelo HP).
- Campos do arquivo ignorados hoje: `eventSkillDeltas`, `eventPVEData`, `playbookItemId`, `partnerGroupId`, `companion*`, `isInteractable`,
  `gameLengthSeconds` (só usado no histórico).
- A pasta `.sentry-native` é formato interno do Riot (pode mudar em patch); o `TFT.log` não grava ouro nem venda; Live Client Data (porta 2999) recusa conexão no TFT.

### 4.2 Limitações de método e cobertura

- Estatísticas de terceiros (MetaTFT/NoxuTFT) não oficiais, de Platina+ nos últimos 3 dias (comps) ou sem filtro declarado (Noxu); viés de sobrevivência
  conhecido (o código reconhece e encolhe `K = 1500`, `MIN_GAMES = 300`). Colocação medida em tabuleiros **finais**, não no estágio atual.
- Números de `POLICY`, `SWITCH_COST`, `STICKY_BONUS`, `patchBias`, pesos de itens e limiares de nível/HP são **escolhas do autor**, sem calibração contra
  as partidas do usuário (os 113 registros de `lobby-boards.jsonl` poderiam servir e não são lidos).
- Módulos sem teste: `engine.analyze` (ranking heurístico base e `buildFit`; só `engine-flex.test.mjs` cobre flex/evidência/troca), `tactics.build/itemMoves/positions`,
  `decision.mjs`, `playbook.mjs`, `target-level.mjs`, `server.mjs` (rotas e `validate`), `capture.mjs`, `meta-*.mjs`/`augment-stats.mjs` (download/parse),
  `lobbies.mjs`, `team-code.mjs`, `screen-reader.ps1` (OCR e ícones só foram verificados à mão contra 2 capturas reais; o `.mjs` é testado com leitor falso).
- Itens e verificações declaradas como **não verificadas** nos próprios documentos: leitura contínua durante uma partida inteira, ouro de 3 dígitos, nível 10+, tela cheia
  exclusiva, outras resoluções, cartas de aprimoramento neste set, livro-razão ao vivo, reconexão com o servidor ligado, Dupla/Hiper Rolagem, transição de partida ao vivo com LCU.
- Interface sem revisão visual automatizada nesta sessão (restrição do usuário: não capturar tela).

---

## 5. Mapa rápido de arquivos

| Assunto                                                           | Arquivo                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Regras do jogo (pool, odds, XP, renda)                            | `rules.mjs`                                                                                                                                     |
| Matemática de economia/roll/pressão e `POLICY`                    | `economy.mjs`                                                                                                                                   |
| Árvore de decisão de gasto                                        | `strategy.mjs`                                                                                                                                  |
| Rolagem do time inteiro e regra "vale rolar"                      | `roll.mjs`                                                                                                                                      |
| Pool, ranking de comps, evidência, troca de plano, flex, emblemas | `engine.mjs`, `evidence.mjs`, `item-edge.mjs`                                                                                                   |
| Posições, builds, trocas, passar itens, ameaça                    | `tactics.mjs`                                                                                                                                   |
| Loja e campo de agora                                             | `stage.mjs`                                                                                                                                     |
| Carrossel                                                         | `carousel.mjs`                                                                                                                                  |
| Disputa                                                           | `contest.mjs`                                                                                                                                   |
| Banco dos rivais estimado                                         | `pool-tracker.mjs`                                                                                                                              |
| Aprimoramentos                                                    | `augment-advice.mjs`, `augment-stats.mjs`                                                                                                       |
| Nível, sequência, tendência                                       | `rules.mjs`, `level.mjs`, `streak.mjs`                                                                                                          |
| Partida, histórico, replay                                        | `match.mjs`, `lobbies.mjs`, `replay.mjs`, `capture.mjs`                                                                                         |
| Fontes do jogo                                                    | `game-log.mjs`, `unit-ledger.mjs`, `screen-reader.mjs/.ps1`, `server.mjs:readLcu`                                                               |
| Meta                                                              | `meta-comps.mjs`, `meta-builds.mjs`, `meta-stats.mjs`                                                                                           |
| Servidor e rotas                                                  | `server.mjs` (`/api/state`, `/api/recommend`, `/api/comps`, `/api/items`, `/api/history`, `/api/catalog`, `/api/events`, `/api/screen-capture`) |
| Interface                                                         | `v2/js/main.js`, `model.js`, `api.js`, `ui/*`                                                                                                   |
| Tabela de fontes e limites detalhados                             | `FONTES-DE-DADOS.md`                                                                                                                            |
