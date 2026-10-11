# ARQUITETURA - um núcleo que alimenta tudo

Documento de design do TFT helper (`tft/helper`). Escrito em 2026-10-10 por leitura do código e por medição offline;
nenhum código foi alterado, o servidor da 3218 não foi tocado e nenhum `POST /api/recommend` foi feito.

Legenda: **[V]** verificado lendo o código; **[M]** medido por mim (offline, descrito na seção 5); **[P]** proposta (ainda
não existe); **[?]** desconhecido ou não verificado. `arquivo:função` aponta onde a regra mora. Número de linha só quando o
arquivo está estável; `engine.mjs`, `server.mjs`, `item-edge.mjs` e `comp-score.mjs` estavam sendo editados por outros
agentes durante a leitura (ver 1.4), então a referência ali é pela função.

---

## 0. Resumo

1. O pedido do usuário ("um motor que alimente tudo; mudou num lugar, mudou em todos") é correto e mensurável: hoje a mesma
   regra de jogo existe em vários lugares, e já divergiu em pelo menos 12 pontos que verifiquei (seção 1.3).
2. A causa não é falta de módulos (o repositório tem boas peças puras: `rules.mjs`, `economy.mjs`, `roll.mjs`,
   `traits.js`); é que **o fluxo de dados é um objeto `options` de ~45 campos e um objeto `analysis` mutado em ordem
   implícita** (`engine -> tactics -> stage -> strategy`), e que cada consumidor recalcula o que precisa em vez de ler um fato.
3. A arquitetura-alvo tem cinco camadas com direção única de dependência: **fontes -> estado do jogo -> fatos derivados
   (grafo memoizado) -> motores -> modelo de tela**. A regra de ouro é **"uma regra, um lugar"**: toda regra do jogo é uma
   função pura ou uma tabela em `core/`, e um teste de arquitetura falha se outro módulo a reimplementa.
4. A migração é incremental: **M0 congela o comportamento atual em testes golden** (já provei que dá para rodar o pipeline
   inteiro offline em ~1 s com capturas reais), depois consolida regra por regra, do menor risco ao maior ganho:
   catálogo de itens e traços -> pool e loja -> economia/limiares -> posse de itens -> camada de estado -> grafo de fatos ->
   motores. `server.mjs` vira só transporte.
5. Desempenho: a análise custa ~0,2-0,3 s a quente e ~0,9 s a frio [M]; o grafo faz um evento de ouro, de loja ou de item
   recalcular só o que depende dele, e a camada tática de 2 dos 3 planos (que a v2 nem usa) sai do caminho crítico.
6. Seis decisões dependem do usuário (seção 6); a principal: **quando duas cópias de uma regra discordam, qual vale** (ex.:
   11 de 39 itens montáveis têm papel diferente conforme o módulo).

---

## 1. Mapa atual verificado

### 1.1 Fluxo hoje [V]

Retrato de 2026-10-10. A leitura de tela citada nesta seção (`screen-reader.*`, `reconcileLevel`, `mergeSources`) foi removida em
2026-10-11 e está no arquivo histórico `.old/ocr/README.md` (ver a decisão 7 em "Decisões do usuário" e, em "Progresso da migração", o registro "Remoção da leitura de tela").

```
 fontes (cada uma com seu formato e sua idade)
 ├ TFTEoGStats.json    capture.mjs (watch+500 ms, parse próprio)  ┐
 │                     server.mjs:readBoardSnapshot (cache mtime)  ├ duas leituras/parses do mesmo arquivo
 ├ __sentry-event + TFT.log   game-log.mjs (estágio, fase; compras)
 ├ LCU (lockfile, GET)        server.mjs:readLcu (cache 5 s)
 ├ tela (glifos/ícones; OCR só na loja) screen-reader.ps1 + screen-reader.mjs (ouro, nível, XP, loja, banco de itens) (removido em 2026-10-11)
 ├ GEP/TFTAcademy (SQLite)    gep-reader.mjs  ........ NOVO, ainda não ligado ao servidor [V: grep "gep" em server.mjs vazio]
 └ manual/localStorage        v2/js/comps.js, augs.js  (comp fixada, trocas, aprimoramentos)
        |
        v
 GET /api/state  = current() + seenState() = mergeSources(screen, gameFiles) -> levels.apply()   (server.mjs)
        |                                          (o cliente guarda isto e monta o payload do POST)
        v
 v2/js/api.js:recommendPayload  -> level, gold, inventory vêm do cliente; shop, xp, removers, stage, augmentIds
        |                          são relidos pelo servidor (seenState de novo) dentro do POST
        v
 POST /api/recommend  (server.mjs ~415 linhas: validate + dezenas de regras de negócio + cache + log)
   options (~45 campos)  ->  engine.analyze(snapshot, catalog, options)    1760 linhas, UMA função-closure
                          ->  tactics(base, ...)         muta analysis: recommendations[i], preview, currentPlan, ownedItemAdvice
                          ->  por plano: playbook, stagePlan, strategy(roll.teamOf, simulate), teamCode
                          ->  planState.track, augmentAdvice, decide, contestAlert, viewedBoard
        |
        v   JSON ~430 KB [M]
 v2/js/model.js:buildModel -> v2/js/ui/*   (só exibe recommendations[0] ou preview)
```

Dependências de módulo notáveis [V]:

- **O servidor importa do diretório do navegador**: `engine.mjs`, `tactics.mjs`, `server.mjs` importam `./v2/js/traits.js`
  e `item-holdings.mjs` importa `./v2/js/item-source.js`. Funciona porque ambos são ESM puros, mas a pasta `v2/` virou, na
  prática, parte do núcleo.
- `stage.mjs` importa `wishlist` de `tactics.mjs`; `strategy.mjs` -> `roll.mjs` -> `economy.mjs` -> `rules.mjs`. Não achei ciclo
  de import. As dependências circulares são **de dados**: `stage.mjs` lê `analysis.ownedItemAdvice` (criado por `tactics`),
  `strategy.mjs` lê `plan.stage.shop` (criado por `stage`), `roll.teamOf` lê `plan.stage.buyNow`. Trocar a ordem de chamada
  em `server.mjs` quebra o resultado sem erro de import.
- O servidor também serve ao navegador `/economy.mjs` e `/rules.mjs` (para `live-mock.js`) por uma lista branca em `server.mjs`.

### 1.2 Cada conceito: todos os lugares que o calculam ou reinterpretam [V]

Notação: **regra** = onde a regra deveria morar; **cópias** = outros lugares que a recalculam ou reinterpretam.

#### a) Itens do jogador e onde estão (a regra "o item já existe em outra peça")

| Papel                                                      | Lugar                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fonte do banco                                             | `screen-reader.mjs` (+ `.ps1`, ícones, filtro `CONSUMABLE` de `item-tiers.mjs`; removido em 2026-10-11); `bankReading` em `v2/js/items.js`                                                                                                                   |
| Fonte dos equipados                                        | `boardPieces[].itemNames` (`TFTEoGStats.json`); Luva do Ladrão tratada em `server.mjs` (POST)                                                                                                                                                                |
| Entrada do motor                                           | `v2/js/api.js:recommendPayload` (`inventory: screen.items`); `server.mjs:validate`; `item-holdings.mjs:recommendInventory` (já ligado em `server.mjs`, prefere a leitura fresca à do cliente)                                                                |
| **Regra da Formação** (a que o usuário quer como canônica) | `v2/js/item-source.js`: `ownersOf`, `locateItem`, `buildStates`                                                                                                                                                                                              |
| Aplicação da regra comp a comp                             | `item-holdings.mjs:resolveHoldings` (**novo**, importa `item-source.js`); usada por `engine.mjs` (`holdingsFor`, `buildFit`) e `item-edge.mjs:itemEdge(..., resolved)`                                                                                       |
| **Cópia 1** (contagem simples)                             | `engine.mjs:analyze`: `ownedItems`, `itemStock`, `itemProfile`, `freeProfile`, `itemFit`, `readyRecipes`, `bankFree`, `myItems`, `emblemEdge`, `emblemFor` (equipado + banco somados sem localização)                                                        |
| **Cópia 2**                                                | `item-edge.mjs:itemEdge` caminho antigo (`have`, `recipes`) ainda existe quando `resolved` não vem                                                                                                                                                           |
| **Cópia 3**                                                | `tactics.mjs:build` (`stock = options.inventory`, `heldParts`), `itemMoves` (`analysis.self.units`), `ownedItemAdvice` (`remaining`), `synergyTips` (`stockAll`)                                                                                             |
| **Cópia 4**                                                | `stage.mjs`: `movedIn`, `bankItems`, `kind`, `equipNow`/`nextItem`                                                                                                                                                                                           |
| **Cópia 5**                                                | `plan-progress.mjs:buildChecklist` (status `built`/`move`/`ready`/`partial`)                                                                                                                                                                                 |
| **Cópia 6**                                                | `carousel.mjs:carouselPicks` (aloca o banco por conta própria)                                                                                                                                                                                               |
| **Cópia 7**                                                | `v2/js/comp-items.js:compItems` (aba Comps: aloca o banco entre as builds, emblemas, `on`/`ready`/`radiant`/`craft`/`half`)                                                                                                                                  |
| **Cópia 8**                                                | `v2/js/model.js` (`ownersOf` + `builds`), `v2/js/ui/champ-items.js`, `ui/inventory.js`                                                                                                                                                                       |
| Id do item base de radiante                                | `item-tiers.mjs:baseItemId`, `v2/js/item-source.js:baseItem`, `v2/js/comp-items.js:baseItemId` (3 cópias idênticas hoje)                                                                                                                                     |
| Papel/classe do item (tanque/AD/AP)                        | `engine.mjs:itemRole` + `holderRole`; `stage.mjs:kind`; `meta-builds.mjs` (`TANK`/`AP`/`AD`, `roleOf`); `tactics.mjs` (regex avulsas de cobertura: VoidStaff/LastWhisper/Sunfire); `item-tiers.mjs:kindOf` (outra taxonomia: completed/component/radiant...) |

#### b) Ouro, juros, renda

| Papel      | Lugar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constantes | `rules.mjs:GAME` (`interestStep`, `interestMax`, `baseIncome`, `streakGold`, `shopCost`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Regra      | `economy.mjs`: `interestOf`, `nextTier`, `tierFloor`, `streakGold`, `incomeOf`, `projectGold`, `sellValue`, `bestSpend`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Fonte      | tela (`screen-reader`, removido em 2026-10-11), manual inexistente; GEP (`gep-reader.mjs: parseGold`) ainda não ligado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Cópias** | `engine.mjs:analyze` (`goldNow = options.gold ?? 30`, `income`, `shops = 3 + floor((gold + 4*income - 10)/shopCost)`: renda sem sequência e com default de 30 g, diferente de `incomeOf`); `engine.mjs` (`rollBudget` com piso 20/50 por `health <= 35`); `playbook.mjs` (`gold < 50`, `gold >= 50`); `decision.mjs` (`gold < 30`); `target-level.mjs` (`gold >= 50`); `v2/js/model.js` (`GOLD_PER_SHOP = 2`, `INTEREST_STEP = 10`, `INTEREST_CAP = 50`) usadas por `ui/hud.js`; `v2/js/math.js` (`cumulativeCurve`, `shopsFor`: binomial de reserva no cliente); `plan-progress.mjs` (copia `state.gold`) |

#### c) Nível, XP, estágio

| Papel                             | Lugar                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabela                            | `rules.mjs:GAME.xpToNext`, `passiveXp`, `stageOneRounds`...                                                                                                                                                                                                                                                           |
| Regra                             | `rules.mjs`: `levelFromXp`, `levelsForXp`, `reconcileLevel`, `roundNumber`, `passiveXpBetween`, `levelFloor`                                                                                                                                                                                                          |
| Validação/estado                  | `screen-reader.mjs:accept` (chama `reconcileLevel`; removidos em 2026-10-11), `level.mjs:levelTracker.apply` (âncora, piso), `game-log.mjs:mergeSources` (precedência do estágio), `server.mjs:seenState` (**chamada em `/api/state` e de novo em `/api/recommend`**; `apply` é com estado)                           |
| Custo de subir                    | `economy.mjs:levelCostOf` (parse de "atual/total")                                                                                                                                                                                                                                                                    |
| **Cópias de parse "atual/total"** | `v2/js/model.js:parseXp`, `economy.mjs:levelCostOf`, `rules.mjs:levelsForXp`/`levelFromXp`/`levelFloor` (regex própria cada uma)                                                                                                                                                                                      |
| **Cópias de parse "S-R"**         | `server.mjs` (regex em `/api/recommend`), `v2/js/model.js:parseStage`, `plan-progress.mjs:rank`, `rules.mjs:roundNumber`, `level.mjs` (regex), `economy.mjs:roundIndex` (privada e **sem uso**)                                                                                                                       |
| **Cópias da curva/rodadas**       | `economy.mjs:curveLevel`/`POLICY.curve`; `engine.mjs` (fallback `level >= 8 ? 5 : ...` quando não há estágio); `strategy.mjs` (`stageSeen` por `foeLevel`); `augment-advice.mjs` (`{2:"2-1",3:"3-2",4:"4-2"}`); `plan-progress.mjs:AUGMENT_ROUNDS`; `v2/js/augs.js:AUG_STAGES` (3 cópias da trilha de aprimoramentos) |
| Nível dito pelo cliente           | `api.js:recommendPayload` envia `level`, `levelSource`, `levelEstimated` lidos do `/api/state` anterior; `server.mjs:validate` aceita 1..11                                                                                                                                                                           |

#### d) Loja

| Papel                              | Lugar                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Odds                               | `rules.mjs:ODDS` (patch 18.3, marcada "não confirmada no 18.4")                                                                                                                                                                                                                                          |
| Leitura                            | `screen-reader` (5 nomes -> ids; removido em 2026-10-11); `server.mjs` POST: `options.shop = seen.shop.map(...)`                                                                                                                                                                                         |
| Chance por slot / por loja         | **duas implementações**: `engine.mjs:analyze -> probability()` (denominador **fracionário**; alimenta `pool[].chancePerSlot/chancePerShop`, `stage.mjs`, `tactics`) e `economy.mjs:slotChance` + `likelyFree` + `freeByCost` (denominador **arredondado**; alimenta `roll.mjs`, `closeCurve`, `rollSim`) |
| Lojas ao alcance                   | `engine.mjs` (`shops`, ver b); `roll.mjs:teamOf` (orçamento); `strategy.mjs` (`shopsIn`); `v2/js/math.js:shopsFor`                                                                                                                                                                                       |
| Cartas viram ação                  | `stage.mjs` (`cards`, `comprar`/`segurar`/`ignorar`, `MIN_ODDS = 10`); `engine.mjs` (`shopHits` no `compScore`, **ver D1**); `roll.mjs:teamOf` (compra da loja sai da pool antes de simular); `strategy.mjs` (`shopBuys`, `shopSpend`)                                                                   |
| Limite "comprável no nível" (10 %) | `stage.mjs:MIN_ODDS`; `engine.mjs` (`>= 10` literal em 3 lugares: `available`, `extend`, `shopOk`)                                                                                                                                                                                                       |
| Número de slots                    | `rules.mjs:GAME.shopSlots` (usado por `economy.mjs`); `engine.mjs` (literal `5` em 7 lugares, **não** usa `GAME.shopSlots`)                                                                                                                                                                              |
| Acesso direto a `ODDS[...]`        | 5 arquivos: `economy.mjs` (2), `engine.mjs` (5), `roll.mjs`, `stage.mjs` (2), `strategy.mjs`                                                                                                                                                                                                             |

#### e) Pool e cópias livres

| Papel                                            | Lugar                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tamanho da pool                                  | `rules.mjs:POOL`                                                                                                                                                                                                                                                         |
| Cópias vistas                                    | `engine.mjs:analyze -> count()` (`visible`, `own`, `enemy`, `rivals`): tabuleiros vivos; banco do Hero só via `options.bench` (hoje sempre `[]`, `validate` zera)                                                                                                        |
| Banco dos rivais                                 | `pool-tracker.mjs:hiddenHoldings` (estimado); `server.mjs` POST (`options.hidden`, arredondado a 0,5, usa `Date.now()`)                                                                                                                                                  |
| Livres                                           | `engine.mjs` (`upper`, `free`, `pool[].remainingUpper/remainingLikely`); `economy.mjs:likelyFree` (reinterpreta `remainingLikely` com `Math.round`)                                                                                                                      |
| Re-agregação                                     | `roll.mjs:teamOf` (`denom` por custo, desconta compras da loja); `stage.mjs` (lê `pool[].chancePerShop`); `tactics.mjs:plan` (`pool.own`, `remainingUpper`); `strategy.mjs` (`own`, `remainingUpper`, `isContested`); `playbook.mjs`; `contest.mjs` (`copies` de rivais) |
| Disputa                                          | `economy.mjs:isContested` (usada por `engine`, `tactics`, `strategy`, `playbook`, `roll`); `engine.mjs` (`contestOf`, `dispute`)                                                                                                                                         |
| **Cópias estrela<->cópias** (`3 ** (estrela-1)`) | `engine.mjs` (4x), `pool-tracker.mjs`, `contest.mjs:copies`, `unit-ledger.mjs:copies` (**exportada, usada só por `plan-progress`**), `roll.mjs:starOf`, `tactics.mjs` (`haveStars`), `economy.mjs:sellValue`, `v2/js/model.js`                                           |

#### f) Traços e emblemas

| Papel                   | Lugar                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regra declarada "única" | `v2/js/traits.js`: `emblemTraitMap`, `traitsWithEmblems`, `countTraits`, `unmappedEmblems`                                                                                                                                                                                                                                                                                                                                                              |
| Uso                     | `engine.mjs` (`traitsOf`, `traits(board)`, `soloOnly`, `legal`, `emblemEdge`, `emblemFor`), `tactics.mjs` (`traitsOfUnit`, `counts`, `synergyTips`, `emblemByTrait`), `server.mjs` (`emblemTraits`, `augmentEmblem`, `viewedBoard`, `/api/catalog.items[].trait`), `v2/js/history.js:activeTraits`, `v2/js/api.js:loadCatalog` (`emblems`)                                                                                                              |
| **Cópias**              | O **laço de contagem** é reescrito em 4 lugares (`engine.traits`, `tactics.plan -> counts`, `history.activeTraits`, `server viewedBoard`); `countTraits`, que seria a versão única, **só é usada em `tests/traits.test.mjs`** [V: grep]. Patamares: `engine.mjs:thresholdsOf` (filtra `minUnits <= 12`), `tactics.mjs` (`t.effects.find`), `server.mjs` (`breakpoints` do catálogo). Solo (`Only active while fielding 1`): só em `engine.mjs:soloOnly` |

#### g) Plano, trocas, comp

| Papel                           | Lugar                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Escolha                         | `engine.mjs:analyze` (heurística `score`, `buildFit`, `extend`, evidência `measure`, `compScore`, `contenders`, `switchNote`, `STICKY_BONUS`, `SWITCH_COST`) |
| Continuidade                    | `plan-state.mjs:planTracker` (sticky, `CONFIRM`, disco), `plan-progress.mjs:buildChecklist`                                                                  |
| Trocas de peça                  | `engine.mjs:flexOf`; `tactics.mjs:plan -> transitions` (limiar 0,9 de "corpo" `custo*estrela`); `stage.mjs:buyNow`; `v2/js/model.js:dock`                    |
| Comp fixada / trocas do usuário | `v2/js/comps.js` (`goalStore`, `swapStore`) + `server.mjs` POST (filtra `goalSwaps`, monta `previewIds`)                                                     |
| Nível alvo                      | `target-level.mjs:suggestTargetLevel` (sem teste, regra `pressure` própria)                                                                                  |
| Veredito                        | (removido em M5a) `decision.mjs:decide` e `playbook.mjs:playbook`: a v2 nunca leu nenhum dos dois (ver 1.3-D5)                                               |

#### h) Rolagem

| Papel            | Lugar                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matemática       | `economy.mjs`: `closeCurve`, `rollSim`, `bestSpend`, `curveSummary`                                                                                                                          |
| Time e regra     | `roll.mjs`: `teamOf`, `rollRule`, `findIndicator`, `rollRows`, `rollCurve`                                                                                                                   |
| Árvore de gasto  | `strategy.mjs:decide` + `settle` + `strategy`                                                                                                                                                |
| Nível de rolagem | `economy.mjs:rerollLevelOf`/`finalLevelOf`/`rollLevelOf`; **cópia divergente** `playbook.mjs` (`rollLevelOf({ carryCost })` sem meta) e `engine.mjs` (`recommendations[i].roll.level`, idem) |
| Orçamento        | `strategy.mjs`/`roll.mjs`; **cópia morta** `engine.mjs` (`recommendations[i].roll.budget`, `neededForTwoStar`, `chanceOneCopy`: nenhum consumidor em `v2/` [V: grep])                        |
| Cliente          | `v2/js/model.js:rollPill`, `pickRows`, `findStrip`, `buildCurve` (fallback binomial)                                                                                                         |

#### i) Perigo, vida, sequência

| Papel                         | Lugar                                                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regra                         | `economy.mjs:pressureOf`, `POLICY.hp/floor/urgency/horizon`; `streak.mjs` (sequência e `trend`, este com `Date.now()`)                                                                                                                                     |
| Usada por                     | `strategy.mjs`, `stage.mjs` (os dois via `pressureOf`)                                                                                                                                                                                                     |
| **Cópias dos limiares de HP** | `playbook.mjs` (`hp <= 35`, `hp > 45`); `decision.mjs` (`hp <= 45`, `hp <= 40`); `target-level.mjs` (`hp <= 35`, `< 60`, `>= 60`, `>= 70`); `engine.mjs` (`rollBudget`: `health <= 35 ? 20 : 50`); `augment-advice.mjs` (`hp >= 60`, `hp < 40`, `hp < 50`) |
| Cliente                       | `v2/js/model.js:hero.hp`; `ended` calculado por `match.status`/`hp`                                                                                                                                                                                        |

#### j) Score e ranking de comps

| Papel                  | Lugar                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Heurístico + evidência | `engine.mjs` (acima)                                                                                                        |
| Score 0-100            | `comp-score.mjs:compScore` (`WEIGHTS`, `PLACEMENT_RANGE`...) alimentado por `engine.mjs` (`chanceOf`, `heldOf`, `shopHits`) |
| Ajuste por itens       | `item-edge.mjs:itemEdge`, `tierOf`, `compBuildStats` (usado também por `meta-comps.mjs`)                                    |
| Valor de posse         | `item-holdings.mjs:HOLD_VALUE`                                                                                              |
| Disputa/alternativa    | `contest.mjs:contestAlert` (usa `compRanking.total`)                                                                        |
| Cliente                | `v2/js/comps.js` (faixas alto >= 60, médio >= 40 só para cor), `ui/comps.js`, `ui/hud.js`                                   |

#### k) Regras transversais repetidas

| Regra                                        | Cópias                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Força de uma unidade/tabuleiro ("might")** | `economy.mjs:mightOf` (`custo * [0,1,1.8,3.2][estrela] + 0.6*itens`); `tactics.mjs:plan -> power` (mesma fórmula, `STAR` redeclarado); `stage.mjs:strength` (`estrela*custo + 2*itens`); `engine.mjs:opponents[].pressure` (`estrela*custo + 2*itens`); `target-level.mjs:pressure` (`estrela*preço + 2*itens`). **Cinco fórmulas**, três famílias numéricas |
| **Papel do campeão (tank/ad/ap)**            | `engine.mjs:computeRole` e `tactics.mjs:role` (regex diferente: o motor inclui `resist`; só **Leona** muda de papel no catálogo atual sem `metaRoles` [V: comparei os 64 campeões]); o papel real vem de `meta-builds.mjs:roleOf` (`metaRoles`)                                                                                                              |
| Parâmetros do reroll                         | `economy.mjs:rerollLevelOf` (`{1:5,2:6,3:7}`) e `rollLevelOf` (`{1:5..5:9}`); `playbook.mjs` (`reroll = custo <= 2                                                                                                                                                                                                                                           |     | (custo === 3 && own >= 4)`) |
| Aprimoramentos escolhidos                    | `server.mjs` (`augmentEmblem`, `augmentTraits`, `augmentTraitsById`), `engine.mjs` (`augTraits`, `augAdj`), `augment-advice.mjs`, `plan-progress.mjs`, `v2/js/augs.js`                                                                                                                                                                                       |

### 1.3 Divergências verificadas

| #      | Divergência                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Evidência                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **A chave de cache da análise base não contém a loja, mas o motor lê a loja.** `analysis-keys.mjs:baseInputs` documenta (e `tests/analysis-keys.test.mjs` afirma) que `shop` não entra na camada base; `engine.mjs` calcula `shopHits` de `options.shop` para o `compScore` (peso 0,10 dentro do score 0-100; o score entra na ordenação com `SCORE_POINTS = 0.1`). Trocar a loja sem mudar mais nada devolve o `compScore` antigo do `baseAnalysisCache` (efeito pequeno, mas é número exibido no HUD e na aba Comps) | `analysis-keys.mjs` L45-69 vs `engine.mjs` (`shopIds`, `shopHits`) [V]. É o exemplo exato do problema: uma lista de dependências mantida à mão que já está errada |
| D2     | **Papel de item**: 3 classificadores discordam em **11 dos 39** itens montáveis (RedBuff, Evenshroud, Morellonomicon, ProtectorsVow, EdgeOfNight, TitansResolve, HandOfJustice, Bloodthirster, Crownguard, SteraksGage, KrakensFury): `engine.itemRole` os trata como `flex` (e isso alimenta `itemProfile`/`freeProfile`/`itemFit`/`mismatch`), `stage.kind` e `meta-builds` como AD/AP/tanque; `HandOfJustice` ainda difere entre os dois últimos                                                                    | script sobre `catalog.json` [M]                                                                                                                                   |
| D3     | **Chance por loja**: `pool[].chancePerShop` (motor, fracionário) e `rollRows[].chancePerShop` (`economy.slotChance` sobre `likelyFree` arredondado) divergem quando `hiddenHoldings` entrega frações de 0,5. Num cenário de reprodução com bancos rivais fracionários: **12 de 14 alvos** mostram valor diferente entre o painel "Comprar"/loja e o painel Roll (até 0,2 ponto percentual; ex.: Sett 3,95 % vs 3,89 %; Ezreal 3,74 % vs 3,89 %)                                                                        | script offline [M]; sem bancos fracionários a divergência é 0 de 14                                                                                               |
| D4     | **Piso e limiar de HP**: `engine.rollBudget` usa `health <= 35` para piso 20 g, enquanto `strategy.decide` usa `POLICY.hp.fastReroll = 50` e `floor.fastReroll = 20`; `playbook`/`decision`/`target-level` têm 35/40/45 próprios                                                                                                                                                                                                                                                                                       | código [V]; o `engine.rollBudget` não tem consumidor no front [V]                                                                                                 |
| D5     | **Código que calcula e ninguém exibe**: `decision.mjs` (`analysis.decision`) e `playbook.mjs` (`plan.playbook`; em `server.mjs` serve de portão `if (plan.playbook && ...)` e seu texto é sobrescrito por `strategy`): **a v2 não lê nenhum dos dois**; `engine.recommendations[i].roll`; `recommendations[1..2]` inteiros (a v2 só lê `recommendations[0]` ou `preview`)                                                                                                                                              | `grep` em `v2/js` por `decision`, `playbook`, `recommendations` [V]; custo na seção 5                                                                             |
| D6     | **Cópia cliente vs servidor**: o cliente manda `level`, `gold` (e antes `inventory`) lidos no `/api/state` anterior; o servidor relê `shop`, `xp`, `removers`, `stage`, `augmentIds` no mesmo POST. O inventário já foi corrigido por `recommendInventory` (remendo no consumidor); `level` e `gold` continuam do cliente, então uma análise pode combinar ouro de um instante com loja de outro [V]; frequência real [?]                                                                                              |
| D7     | **Traços**: `countTraits` (a "regra única") só é usada em teste; 4 laços de contagem equivalentes no código [V: grep]                                                                                                                                                                                                                                                                                                                                                                                                  |
| D8     | **Posse de itens**: ~9 implementações (1.2-a). A migração para `resolveHoldings` está em curso, mas o `engine.score()` ainda usa a contagem simples, e `item-edge.mjs` mantém os dois caminhos                                                                                                                                                                                                                                                                                                                         | [V], marcado "em transição"                                                                                                                                       |
| D9     | **Papel de campeão**: `computeRole` vs `role` (1 campeão diverge sem `metaRoles`, Leona)                                                                                                                                                                                                                                                                                                                                                                                                                               | script [M]                                                                                                                                                        |
| D10    | **Força**: 5 fórmulas; **cópias estrela**: 8 lugares; **parse "S-R"**: 6; **trilha de aprimoramentos**: 3; **id base de radiante**: 3                                                                                                                                                                                                                                                                                                                                                                                  | grep [V]                                                                                                                                                          |
| D11    | **Caches independentes (8)**, cada um com chave própria: `analysisCache` (JSON.stringify(options), 12), `baseAnalysisCache` (`baseInputs`+versão da evidência, 12), `pendingBase`, `roll.mjs:SIMS` (24, `JSON.stringify([nível, denom, alvos])`), `boardSnapshotCache` (mtime:size), `lcuCache` (5 s), `explorer` (6 h, disco) + `evidenceMap`/`conditionalMap`, `replay.mjs` cache incremental; mais `termCache`/`thresholdCache`/`roleCache` por chamada                                                             | [V]                                                                                                                                                               |
| D12    | **Orquestração dentro do transporte**: o bloco `POST /api/recommend` de `server.mjs` tem ~415 linhas com regras de negócio (emblema de aprimoramento, filtro de `goalSwaps`, bancos rivais, sequência, plano em andamento, log de troca, filtro da Luva do Ladrão)                                                                                                                                                                                                                                                     | [V]                                                                                                                                                               |
| D13    | **Sem relógio explícito**: `hiddenHoldings` e `streak.trend` usam `Date.now()`; `options.hidden` é arredondado a 0,5 só para a chave de cache não girar                                                                                                                                                                                                                                                                                                                                                                | [V]                                                                                                                                                               |
| D14    | **Ouro default**: `engine.mjs` usa `options.gold ?? 30` para `shops`, enquanto `strategy` trata `gold === null` como "não lido" e se recusa a decidir. Os dois comportamentos coexistem                                                                                                                                                                                                                                                                                                                                | [V]                                                                                                                                                               |

### 1.4 Em transição agora (outros agentes editando)

- `engine.mjs` (mudou duas vezes durante a leitura): integração de `item-holdings.mjs` em `buildFit`/`itemEdge`. **Arquivo novo
  e ainda não rastreado**: `item-holdings.mjs`.
- `server.mjs`: `recommendInventory` ligado (≈ L755).
- `gep-reader.mjs` (novo, 25 KB, `tft-fonte-gep`): fonte GEP pronta, **não ligada** ao servidor.
- `v2/js/comp-items.js`, `ui/champ-items.js`, `ui/inventory.js`, `plan*.js` (novos, não rastreados).
- **48 arquivos .mjs/.js novos não rastreados** (62 itens `??` no total, contando testes, css e dados) e 55 modificados
  (incluindo json/css) em `tft/helper`; a branch é `tft-helper-next`. Boa parte do que descrevo **nunca foi commitado**. Recomendo um commit de checkpoint antes do M0 (decisão
  do usuário; não fiz commit).
- Linha de base de testes: **266 testes passam** em ~111 s (`node --test` com o conjunto do README, 18:5x) [M].

---

## 2. Arquitetura-alvo

### 2.1 Regra de ouro e vocabulário

> **Uma regra, um lugar.** Toda regra do jogo ou política do helper é uma função pura (ou uma tabela de dados) dentro de `core/`.
> Nenhum outro módulo recalcula, reinterpreta ou "arredonda de novo" um valor que `core/` já produz; ele o **lê**.

- **Estado do jogo** (`GameState`): fatos observados ou informados, normalizados, versionados, com origem/confiança/idade
  **por campo**. Nunca contém conclusões.
- **Fato derivado** (`Fact`): função pura de entradas nomeadas; memoizada; entra num grafo explícito. Ex.: cópias livres,
  posse de itens, traços com emblemas, nível efetivo, lojas ao alcance.
- **Motor** (`Engine`): consome fatos (nunca o estado cru nem regras) e produz decisões: ranking de comps, plano, rolagem,
  itens, aprimoramentos, carrossel, disputa.
- **Modelo de tela** (`ViewModel`): reorganiza decisões para desenhar. Não decide nada de jogo (como `v2/js/model.js` já
  declara no cabeçalho).
- **Fonte** (`Source`): adaptador de E/S que entrega fatos parciais com metadados. É o único lugar que conhece formato de arquivo,
  SQLite, LCU ou rede.

### 2.2 Camadas (direção única: de baixo para cima)

```
 5 view      v2/js/model.js + v2/js/ui/*                      só exibe; importa core/ apenas tipos e funções puras de formato
 4 engines   core/engines/*                                   consomem fatos; sem acesso a estado cru, sem E/S, sem Date.now
 3 facts     core/facts/*   (grafo memoizado, graph.mjs)       funções puras de entradas nomeadas; early cutoff
 2 state     core/state/*   (schema, reduce, precedence)       GameState com Field<T> = valor + fonte + confiança + idade
 1 rules     core/rules/*   core/catalog/*                     tabelas do patch, política, índices do catálogo (puro)
 0 sources   sources/*      (gamefile, sentry, lcu, gep, manual, meta, explorer)   E/S; falam com o estado por "ações"
 app/        recommend.mjs, state.mjs, trackers (plan-state, streak, match), recording (capture, replay, lobbies)   orquestra e persiste
 server.mjs  HTTP, SSE, estáticos                              nada de regra
```

Regras de importação (verificadas por teste, seção 3.3): `core/` não importa nada fora de `core/`; `core/` não usa `node:*`,
`fetch`, `Date.now`, `Math.random`; `v2/` importa de `/core/*` pelo mesmo caminho estático que o servidor passa a servir;
`server.mjs` e `sources/` nunca importam `v2/`; ninguém importa `engines/` de dentro de `facts/`.

### 2.3 Contratos (JSDoc, sem build)

```js
/** Um valor lido de alguma fonte. null = desconhecido; nunca um palpite (um palpite tem confidence "estimated"). */
/** @template T @typedef {{
 *   value: T | null,
 *   source: "gamefile"|"sentry"|"lcu"|"gep"|"manual"|"derived"|"estimated",   // sem "screen" desde 2026-10-11
 *   confidence: "observed"|"derived"|"manual"|"estimated",                       // sem "read" desde 2026-10-11
 *   at: number | null,          // epoch ms da observação (não da regravação do arquivo)
 *   stale: boolean              // fora da janela de frescor da fonte (GEP_STALE_MS, ...)
 * }} Field<T> */

/** @typedef {{
 *   rev: number,                // sobe só quando o CONTEÚDO muda (substitui snapshotSignature/analysisKey)
 *   gameId: string|null, set: string, patch: string|null,
 *   clock: { now: number, stage: Field<{stage:number, round:number}>, phase: Field<string>, phaseKind: Field<"planning"|"combat"|"draft"|"other"> },
 *   me: {
 *     id: string, health: number|null,
 *     gold: Field<number>, level: Field<number>, xp: Field<{have:number,total:number}>,
 *     board: Unit[],                       // gamefile: só peças em campo
 *     bench: Field<Unit[]>,                // gep|manual; hoje sempre desconhecido
 *     shop: Field<(string|null)[]>,        // 5 slots (4 de campeão com Wisp: 'slot de 5 tipos' no contrato de loja)
 *     itemBank: Field<string[]>,           // completo e componentes, sem consumíveis; consumíveis em outro campo
 *     augments: Field<string[]>,           // manual (o jogo não grava)
 *   },
 *   rivals: Rival[],                       // tabuleiros observados + histórico de capturas (para o banco estimado)
 *   user: { goalCompId, goalSwaps, compSwaps, targetLevel: "auto"|number, replayGameId },   // só decisões do usuário
 *   meta: { comps, builds, roles, stats, augmentStats, evidenceVersion, fetchedAt },        // cópias versionadas
 * }} GameState */

/** Fato: entradas NOMEADAS e puras. A função só enxerga o que foi declarado, então não dá para ler dado sem declarar. */
/** @typedef {{ id: string,
 *              inputs: Record<string, string | ((s: GameState) => unknown)>,   // "facts.id" ou seletor sobre o estado
 *              compute: (inputs: object) => unknown,
 *              equals?: (a: unknown, b: unknown) => boolean }} FactDef */ // early cutoff: igual -> dependentes não rodam

/** Motor: puro, sem estado entre chamadas. Recebe fatos, devolve decisão serializável. */
/** @typedef {(facts: Facts, state: Readonly<GameState>) => Decision} Engine */
```

Um fato com `inputs` explícitos resolve exatamente o que `analysis-keys.mjs` tenta fazer à mão: **a função só recebe o que foi
declarado**, então "ler `options.shop` sem avisar" (D1) deixa de ser possível por construção, e a chave de memoização é a
identidade das entradas.

### 2.4 Catálogo de fatos (substitui o quê)

| Fato                                   | Entradas                                                     | Saída                                                                                                                    | Substitui                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog.items`                        | catálogo do patch                                            | `kind`, `role` (tank/ad/ap/flex), `isComponent`, `isConsumable`, `baseId`, `recipe`, `emblemTrait`                       | `item-tiers.kindOf/CONSUMABLE/baseItemId`, `engine.itemRole/holderRole`, `stage.kind`, `meta-builds.TANK/AP/AD`, `item-source.baseItem`, `comp-items.baseItemId`, regex avulsas de `tactics` |
| `catalog.champions`                    | catálogo + `meta.roles`                                      | `role(champion)` (uma só ordem de precedência: meta, depois heurística), `traits`, `range`, `cost`                       | `engine.computeRole`, `tactics.role`                                                                                                                                                         |
| `rules.*`                              | tabela do patch (`core/rules/tables/<patch>.json`)           | `GAME`, `ODDS`, `POOL`, `XP`, `STREAK` com `fonte`/`verificado em`                                                       | `rules.mjs` (passa a ler a tabela, F0.2 do plano)                                                                                                                                            |
| `clock.round`                          | `clock.stage`                                                | `{ index, isPvp, isCarousel, isPve }`                                                                                    | parse "S-R" x6, `economy.nextRound/isPvp/roundIndex`, `rules.roundNumber`                                                                                                                    |
| `level.effective`                      | `me.level`, `me.xp`, `clock.round`                           | `{ value, source, minimum, ambiguous }`                                                                                  | `level.mjs`, `reconcileLevel`/`levelFloor` (viram o redutor do campo `level`)                                                                                                                |
| `economy.income`                       | `me.gold`, `streak`                                          | `{ base, interest, streak, total }`                                                                                      | `economy.incomeOf`, `engine` (renda inline), `playbook`/`decision` (50/30 g)                                                                                                                 |
| `economy.shopsAhead`                   | `me.gold`, `economy.income`, `rules.GAME`                    | inteiro                                                                                                                  | `engine.mjs` (`shops`), `v2/js/math.js:shopsFor` quando só há reserva                                                                                                                        |
| `economy.pressure`                     | `me.health`, `clock.round`, `lobby.weak`, `streak.trend`     | faixa + piso/urgência/horizonte                                                                                          | `economy.pressureOf`, os 5 limiares avulsos de HP (D4)                                                                                                                                       |
| `economy.levelCost`                    | `me.xp`, `level.effective`                                   | `{ need, buys, cost, passive, max }`                                                                                     | `economy.levelCostOf`, `model.parseXp`                                                                                                                                                       |
| `units.held`                           | `me.board`, `me.bench`                                       | por campeão: cópias, maior estrela, onde (campo/reserva), itens                                                          | `engine.count/own`, `roll.teamOf` (`mine`), `plan-progress.holdings`, `tactics current/reserve`, `stage field/reserve`                                                                       |
| `holdings.items`                       | `me.board`, `me.bench`, `me.itemBank`, `catalog.items`       | por item: onde está (peça, banco, componentes)                                                                           | `engine.ownedItems/itemStock/freeItems`, `tactics` estoques, `carousel` banco, `comp-items` estoque                                                                                          |
| `holdings.byBuild(compId)`             | `holdings.items`, `units.held`, build da comp                | situação de cada item pedido (`on`, `bank`, `move`, `moveStay`, `craft`, `craftMove`, `half`, `taken`, `absent`) e valor | `item-holdings.resolveHoldings` + `item-source.locateItem` (viram **a** implementação), `item-edge` caminho antigo, `plan-progress` status, `stage.movedIn/bankItems`, `comp-items`          |
| `pool.visible`                         | `me.board`, `me.bench`, `rivals[].board`                     | cópias vistas por campeão (`own`, `enemy`, `rivals`)                                                                     | `engine.count`                                                                                                                                                                               |
| `pool.hidden`                          | `rivals[].history`, `clock.now` em degraus (ex.: 30 s)       | cópias estimadas nos bancos rivais (fracionárias)                                                                        | `pool-tracker.hiddenHoldings` + o arredondamento a 0,5 do servidor                                                                                                                           |
| `pool.free`                            | `pool.visible`, `pool.hidden`, `rules.POOL`                  | por campeão: `upper`, `free` (**um** tratamento de arredondamento), por custo: `denom`                                   | `engine.upper/free/denomByCost`, `economy.likelyFree/freeByCost`, `roll.denom`                                                                                                               |
| `shop.model`                           | `level.effective`, `rules.ODDS`, `rules.GAME`, regra de Wisp | `slots`, `odds(custo)`, `buyable(custo)`                                                                                 | `ODDS[...]` em 5 arquivos, o literal `5` de slots em 7 lugares do motor, `MIN_ODDS` e os 3 `>= 10`                                                                                           |
| `shop.slotChance`                      | `shop.model`, `pool.free`                                    | `chancePerSlot/PerShop` por campeão, para o nível de agora e o alvo                                                      | `engine.probability`, `economy.slotChance`, `roll` (`chancePerSlot[Next]`)                                                                                                                   |
| `traits.byBoard(units)`                | `catalog.*`, `holdings.items`, aprimoramentos                | contagens, patamares, ativos, solo, emblemas                                                                             | `engine.traits/traitsOf/soloOnly/legal`, `tactics counts/traitsOfUnit`, `history.activeTraits`, `server viewedBoard`, `traits.countTraits`                                                   |
| `force.unit(u)` / `force.board(units)` | `rules.POLICY.star`, `itemMight`                             | um número                                                                                                                | as 5 fórmulas de "might" (D10)                                                                                                                                                               |
| `lobby.strength`                       | `force.board`, `rivals[].board`                              | posição, mediana, `weak`, nível médio dos rivais                                                                         | `economy.lobbyStrength`                                                                                                                                                                      |
| `lobby.threat`                         | `rivals[].board`, `catalog.*`                                | share físico/mágico, cura, crítico, armadura, RM                                                                         | `tactics.mjs` (bloco `threat`), `engine` (`armorCount`, `mrCount`, `healing`, `counters`)                                                                                                    |

### 2.5 Motores

| Motor              | Consome                                                                                                                                                                          | Produz                                                                 | Hoje                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `engines/comps`    | `units.held`, `holdings.byBuild`, `pool.*`, `shop.slotChance`, `economy.shopsAhead`, `traits.byBoard`, `lobby.*`, `meta` (inclui evidência), `user.augments`, plano em andamento | candidatas, `compRanking`, `compScore`, `switch`, `confidence`, `flex` | `engine.mjs:analyze`, `comp-score.mjs`, `item-edge.mjs`, `evidence.mjs` (parte pura)           |
| `engines/plan`     | resultado de `comps`, `units.held`, `holdings.*`, `pool.free`, `shop`                                                                                                            | transições, "campo de agora", compras, itens a passar, progresso       | `tactics.mjs:plan/transitions/itemMoves`, `stage.mjs`, `plan-progress.mjs`, `target-level.mjs` |
| `engines/roll`     | `pool.free`, `shop.slotChance`, `economy.*`, `plan`                                                                                                                              | time, regra "vale rolar", orçamento, curva, indicador                  | `roll.mjs`, `strategy.mjs`, `economy.closeCurve/rollSim/bestSpend`                             |
| `engines/items`    | `holdings.*`, `catalog.items`, `meta.builds`, `lobby.threat`                                                                                                                     | build por peça, montar/equipar, carrossel                              | `tactics.mjs:build`, `carousel.mjs`, `v2/js/comp-items.js`                                     |
| `engines/augments` | `traits.byBoard`, `comps`, `economy.pressure`, `meta.augmentStats`                                                                                                               | ordem das ofertas, emblemas                                            | `augment-advice.mjs`, trecho de `server.mjs`                                                   |
| `engines/contest`  | `rivals`, `comps`                                                                                                                                                                | alerta e alternativa                                                   | `contest.mjs`                                                                                  |

Cada motor expõe **uma** função `run(facts, state)`. O que um motor decide pode ser lido por outro como entrada (ex.: `plan` lê o
resultado de `comps`), mas sempre pelo grafo, sem mutar o objeto do outro (acaba a mutação em `tactics`/`server`).

### 2.6 Onde cada coisa existe no disco [P]

```
tft/helper/
  core/                         ESM puro. Sem node:*, sem fetch, sem Date.now/Math.random. Carregável no servidor e no navegador.
    rules/    game.mjs (lê tables/<patch>.json) · policy.mjs (POLICY, thresholds, SWITCH_COST...) · tables/18.4.json
    catalog/  index.mjs · items.mjs · champions.mjs · traits.mjs (de v2/js/traits.js, que fica como reexport)
    math/     shop-math.mjs (binomialPmf, closeCurve, rollSim, mulberry32, bestSpend: hoje em economy.mjs)
    state/    schema.mjs (typedefs + validate) · reduce.mjs · precedence.mjs · level.mjs (levelFloor/levelConsistent/reduceLevel)
    facts/    graph.mjs · economy.mjs · pool.mjs · shop.mjs · holdings.mjs · traits.mjs · force.mjs · lobby.mjs · clock.mjs
    engines/  comps/ · plan/ · roll/ · items/ · augments/ · contest/
  sources/    gamefile.mjs · sentry.mjs · tftlog.mjs · lcu.mjs · gep.mjs · manual.mjs · meta.mjs · explorer.mjs
  app/        state.mjs (junta as fontes -> GameState) · recommend.mjs (pipeline) · trackers/ (plan-state, streak, match) · recording/ (capture, replay, lobbies) · telemetry.mjs
  server.mjs  rotas, SSE, estáticos (incluindo /core/*), nada de regra
  v2/         navegador: main.js, model.js (view-model), ui/*
  tests/      golden/ · architecture.test.mjs · (testes atuais)
```

Mapa completo arquivo -> destino está no apêndice A.

### 2.7 Como o resto do sistema se encaixa

- **Servidor serve `/core/*`** (estático, mesma lista de segurança de `/v2/*`); `/rules.mjs` e `/economy.mjs` continuam como
  reexports enquanto `live-mock.js` os usar. `v2/js/traits.js` e `v2/js/item-source.js` ficam como reexports finos.
- **Pipeline único no servidor.** O navegador não recalcula regra: só `model.js` (formato) e, para exibição instantânea, funções
  puras de `core/` já carregadas (ex.: conta de juros do medidor de ouro, que hoje tem `INTEREST_*` próprias). A análise
  continua em `POST /api/recommend` com o **mesmo formato de resposta** durante toda a migração (compatibilidade com o front e o mock).
- **Tabelas por patch** (F0.2 do `planos/a-fazer/PLANO-TOTAL.md`): `core/rules/tables/<patch>.json` com `fonte`, `confiança` e `verificado em`;
  trocar de patch muda dados, não código. O detector de patch (F0.4) marca a tabela como "não verificada".
- **Modo sombra** (F0.7): `core/rules/policy.mjs` aceita `{ shadow: true }` por regra; o motor calcula, o `round-log` grava, a tela
  não mostra. Só é possível porque a regra existe num lugar.
- **Fonte nova** = um adaptador em `sources/` que devolve `Field`s; a precedência por campo mora em `state/precedence.mjs`
  (ex.: `me.gold`: `gep` fresco > null). Nada mais muda (3.A).
- **Relógio explícito**: `clock.now` entra no estado; `hiddenHoldings` e `streak.trend` recebem o tempo por entrada (acaba o
  arredondamento a 0,5 só para estabilizar a chave de cache, D13).

---

## 3. Como uma alteração se propaga

### 3.1 Exemplos (o que você edita, o que se ajusta sozinho, o que prova)

**A) Mudar a origem do ouro** (GEP no lugar do OCR; feito: o M7 pôs o GEP na frente e, em 2026-10-11, a leitura de tela foi
removida, então o GEP é a única fonte do ouro): `gep-reader.mjs` já entrega `parseGold` com frescor.

- Edita: `sources/gep.mjs` (devolve `Field<number>` com `source: "gep"`), uma linha em `state/precedence.mjs`
  (os candidatos de `me.gold`; hoje só `"gep"`).
- Ajusta sozinho: `economy.income/shopsAhead/pressure`, estratégia, roll, `stage` (cartas "sem ouro"), `plan-progress`, o selo de fonte no
  HUD (`Field.source`), e o motor de comps (`shopsAhead`). `level.effective` aceita `confidence: "observed"` do GEP depois de
  `levelConsistent`.
- Prova: teste de precedência (GEP fresco, GEP velho, GEP ausente = desconhecido com motivo), golden do pipeline.

**B) Mudar uma regra de item** (ex.: "item só em peça que fica e que usa o item" passa a contar como `moveStay`):

- Edita: `core/facts/holdings.mjs` (e `HOLD_VALUE` em `core/rules/policy.mjs`).
- Ajusta sozinho: Formação (`ui/champ-items`), score e ranking de comps (`buildFit`, `itemEdge`, `compScore`), aba Comps (`compItems` passa
  a ler `holdings.byBuild`), "Equipar/Próximo item/Passar itens", checklist do plano, carrossel e a nota de itens do painel.
- Prova: `architecture.test` falha se alguém reintroduz um estoque `indexOf/splice` de itens fora de `holdings`; teste de
  consistência cruzada (3.3-T4) compara Formação x motor x aba Comps no mesmo estado.

**C) Mudar as odds de loja num patch:**

- Edita: `core/rules/tables/18.5.json` (e o campo `patch`).
- Ajusta sozinho: `shop.model` -> chance por slot/loja (pool, `stage`, painel Roll), `closeCurve/rollSim`, nível de rolagem, `levelGain` do
  `strategy`, a barra de odds do painel (que lê `rec.odds`), o mock.
- Prova: golden mostra **exatamente quais números mudaram**; teste de tabela (`ODDS[7]` lido da tabela do patch).

**D) Adicionar uma fonte de dados** (ex.: banco de campeões pelo GEP): ver (A) + campo `me.bench` com `Field<Unit[]>`.
Hoje a reserva chega **vazia** (`validate` zera `bench`) a ~8 consumidores que já a leem (`engine count`, `roll.teamOf mine`, `stage reserve`,
`tactics reserve`, `strategy sellableOf`, `plan-progress holdings`, `model owners`, `item-source`). Com `units.held` como único ponto de leitura, a
reserva do GEP entra por `me.bench` e todos a veem sem mudar código; sem isso, cada um precisa ser revisado para a reserva voltar a valer.

**E) Mudar uma política** (ex.: perigo `POLICY.hp.danger` 30 -> 35, ou piso do reroll rápido):

- Edita: `core/rules/policy.mjs`.
- Ajusta sozinho: `strategy`, `stage`, `playbook`/`decision`/`target-level` (se ainda existirem) e o rollBudget do motor, porque deixam
  de ter número próprio (D4).

### 3.2 Como a regra se mantém num lugar só (mecanismos)

1. **Grafo de fatos** com entradas declaradas (2.3): o consumidor lê `facts.get("pool.free")`; não existe outro jeito de obter cópias
   livres.
2. **Estado imutável com compartilhamento estrutural**: subárvores que não mudaram mantêm a identidade, então `===` basta para a memoização.
3. **Early cutoff**: um fato recalculado que dá o mesmo valor (`equals`) não invalida os dependentes.
4. **`explain()` e contadores** (`graph.stats()`): "recalculou X porque a entrada Y mudou". É a ferramenta de desempenho e de depuração.

### 3.3 Testes de contrato (nenhum consumidor reimplementa a regra)

| #   | Teste                                                                                                                                                                                                                                                                            | Falha quando                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | **Grafo de imports** (`tests/architecture.test.mjs`, lê os `import` estáticos): `core/` só importa de `core/`; `server.mjs`/`sources/` não importam `v2/`; `facts/` não importa `engines/`                                                                                       | alguém importa na direção errada. Começa com lista de exceções (hoje: `engine.mjs` -> `v2/js/traits.js`, `item-holdings.mjs` -> `v2/js/item-source.js`) que só encolhe |
| T2  | **Padrões proibidos fora do dono**: `/_?Radiant\$/` e `DA_Component_` só em `core/catalog`; `3 \*\* ` com estrela só em `core/facts/units`; `ODDS\[` só em `core/facts/shop`; `GAME.interestStep`/`/ 10)` com ouro só em `core/facts/economy`; regex de classe de item (`Rabadon | InfinityEdge                                                                                                                                                           | ...`) só no catálogo | outro módulo recalcula a regra. Exemplo do teste: lê cada `.mjs`/`.js` fora do dono e acusa o padrão com arquivo:linha; lista de exceções por arquivo que só encolhe (catraca) |
| T3  | **Pureza de `core/`**: nenhum `node:`, `fetch`, `Date.now`, `Math.random`, `process`, `fs`                                                                                                                                                                                       | alguém põe E/S ou tempo implícito no núcleo                                                                                                                            |
| T4  | **Consistência cruzada**: no mesmo `GameState` de teste, Formação (`item-source`), motor (`holdings.byBuild`), aba Comps (`compItems`) e checklist (`plan-progress`) concordam sobre "falta / existe em outra peça / monta agora"                                                | duas visões do mesmo fato divergem. Não verifiquei se passariam hoje; o M6 não fecha enquanto não passarem [?]                                                         |
| T5  | **Golden do pipeline** (`tests/golden/*.test.mjs`): resposta completa normalizada para ~12 cenários                                                                                                                                                                              | qualquer número muda; a atualização exige `UPDATE_GOLDEN=1` e um diff revisado                                                                                         |
| T6  | **Invalidação** (`tests/graph-invalidation.test.mjs`): para cada evento da seção 5.3, os contadores do grafo mostram que só os fatos esperados recalcularam                                                                                                                      | uma dependência nova vaza (ex.: "ouro mexe em `holdings`")                                                                                                             |
| T7  | **Contrato de entradas**: cada fato roda com um `Proxy` que lança se ler chave não declarada                                                                                                                                                                                     | uma função de fato fecha sobre variável externa                                                                                                                        |

---

## 4. Plano de migração incremental

Princípios: cada passo é pequeno, termina com a suíte verde (hoje 266 testes) e o **golden idêntico**, salvo passos marcados "muda
número" (a diferença vem listada e aprovada antes de fundir). Não muda como a build/comp é montada, não mexe no roteamento do front
e não muda o formato da resposta. Esforço: P (< 0,5 dia), M (~1 dia), G (2-4 dias) para um desenvolvedor.

**Rede de segurança do M0.** Já provei que o pipeline inteiro roda offline: `replay.mjs:replaySnapshot` reconstrói tabuleiros reais
de `data/scouting-captures.jsonl`, `data/evidence-cache.json` (6.713 totais e 53 condicionais) alimenta `options.evidence` e
`options.conditional`, e `rollSim` usa semente fixa. Meu script (`scratchpad/bench.mjs`) executou `analyze -> tactics -> playbook/stage/strategy`
por replay de uma partida real em ~0,3-0,9 s [M]. O golden usa o mesmo caminho, com relógio injetado e a evidência congelada num
subconjunto commitado (sem dado pessoal).

| Passo   | O que faz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Arquivos tocados                                                                                                                                                                          | Risco                                         | Critério de aceite                                                                                                                                                                      | Esforço | Depende de                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| **M0**  | **Caracterização + medição.** Harness golden: 12+ cenários (replays reais em 3 níveis/estágios, `tests/fixtures.mjs` das duas comps, `live-mock-base.json`, estados com banco de itens, loja lida, aprimoramento escolhido, comp fixada, HP crítico), relógio injetado (`now`), evidência congelada, normalizador (remove tempos, arredonda floats). Instrumentação de tempo por etapa em `server.mjs` (`diag.write` com ms de `analyze`, `tactics`, cada `strategy`, serialização, `/api/state`).                                                                                                     | `tests/golden/**` (novo), `scripts/bench.mjs` (novo), `server.mjs` (log de tempo, 15 linhas)                                                                                              | Baixo                                         | Golden estável em 3 execuções seguidas; perturbar uma constante (ex.: `POLICY.hp.danger`) quebra pelo menos um cenário; tempos aparecem no `server.log`                                 | M       | commit de checkpoint (recomendado)                              |
| **M1**  | **Rede de arquitetura.** `tests/architecture.test.mjs` com T1-T3 em modo catraca (lista de exceções = estado de hoje). Cria `core/` vazia com `README` de uma página (a regra de ouro).                                                                                                                                                                                                                                                                                                                                                                                                                | `tests/architecture.test.mjs` (novo), `core/README.md`                                                                                                                                    | Baixo                                         | Teste passa hoje com as exceções listadas; adicionar uma violação nova o faz falhar                                                                                                     | P       | M0                                                              |
| **M2**  | **Catálogo de itens e campeões.** `core/catalog/items.mjs` com `kind`, `role`, `isComponent`, `isConsumable`, `baseId`, `recipe`; `champions.mjs` com `role`. Troca `engine.itemRole/holderRole`, `stage.kind`, `meta-builds.TANK/AP/AD`, as 3 `baseItemId`, `engine.computeRole`/`tactics.role`. **Muda número** em 11 itens (D2) e Leona (D9): primeiro o módulo reproduz cada classificador em modo `legacy` e o golden fica idêntico; depois a tabela única entra e o diff é aprovado                                                                                                              | `core/catalog/*`, `engine.mjs`, `stage.mjs`, `meta-builds.mjs`, `tactics.mjs`, `item-tiers.mjs`, `v2/js/item-source.js`, `v2/js/comp-items.js`                                            | Médio (toca `engine.mjs` em edição)           | Golden idêntico no passo `legacy`; no passo final, o diff lista só itens/campeões de D2/D9 e foi aprovado; T2 acusa 0 regex de classe fora do catálogo                                  | M       | M1; **coordenar com `tft-motor-itens`** (mesmo arquivo)         |
| **M3**  | **Traços e emblemas.** Move `v2/js/traits.js` para `core/catalog/traits.mjs` (reexport em `v2/js/traits.js`), adiciona `traits.byBoard` (patamares, solo, emblemas) e troca os 4 laços (`engine.traits`, `tactics.plan`, `history.activeTraits`, `server viewedBoard`). `countTraits` passa a ser a única                                                                                                                                                                                                                                                                                              | `core/catalog/traits.mjs`, `engine.mjs`, `tactics.mjs`, `server.mjs`, `v2/js/history.js`                                                                                                  | Baixo-médio                                   | Golden idêntico; `tests/traits.test.mjs` passa sem mudança; T2 sem laço de contagem fora de `traits`                                                                                    | M       | M1                                                              |
| **M4**  | **Pool e loja.** `core/facts/pool.mjs` (visible/hidden/free/upper/denom, **uma** política de arredondamento) e `core/facts/shop.mjs` (`slotChance`, `shopsAhead`, `odds`, 10 %, `shopSlots`). Troca `engine.probability/free/upper`, `economy.slotChance/likelyFree/freeByCost`, `roll.denom`, os `** 5` e `>= 10`. **Muda número** em D3 (≤ 0,2 p.p.) — decisão: manter o fracionário (mais exato) ou o inteiro (o que a rolagem usa)                                                                                                                                                                 | `core/facts/{pool,shop}.mjs`, `engine.mjs`, `economy.mjs`, `roll.mjs`, `stage.mjs`                                                                                                        | Médio                                         | Golden idêntico no modo "igual ao motor atual" e depois diff D3 aprovado; roll e `stage` mostram a mesma chance por loja para o mesmo campeão (T4)                                      | M       | M1, decisão 1                                                   |
| **M5**  | **Economia, política e limiares.** `core/facts/economy.mjs` e `core/rules/policy.mjs`: `income`, `shopsAhead`, `pressure`, `levelCost`, `force`. Troca `engine` (renda, `rollBudget`), `playbook`/`decision`/`target-level` (limiares), `stage.strength`, `tactics.power`, `engine.opponents.pressure`, parse "S-R" x6, `model.js` (`INTEREST_*`). **Remove código morto** (D5) depois de mostrar que nenhum consumidor o lê: `engine.recommendations[i].roll`, `economy.roundIndex`; `playbook`/`decision` entram na decisão 5                                                                        | `economy.mjs`, `rules.mjs`, `engine.mjs`, `playbook.mjs`, `decision.mjs`, `target-level.mjs`, `stage.mjs`, `tactics.mjs`, `v2/js/model.js`                                                | Médio                                         | Golden idêntico exceto o campo removido; D4 resolvido (um único piso de reroll rápido); T2 sem `gold >= 50` literal fora de `economy`                                                   | G       | M1, M4, decisão 1 e 5                                           |
| **M6**  | **Posse de itens e unidades.** `core/facts/holdings.mjs` = `item-source.locateItem/ownersOf` + `item-holdings.resolveHoldings` (a regra da Formação passa a ser **a** implementação, com os mesmos testes `tests/formation-items.test.mjs`, `v2/js/item-source.test.mjs`). Troca a contagem simples de `engine.score()` (`itemProfile/freeProfile/itemFit/emblemEdge/emblemFor`), `item-edge` (remove o caminho antigo), `tactics.build/itemMoves/ownedItemAdvice`, `stage.bankItems/movedIn`, `plan-progress`, `carousel`, `comp-items`. `units.held` (cópias/estrelas) entra junto, trazendo `bench` | `core/facts/holdings.mjs`, `engine.mjs`, `item-holdings.mjs`, `item-edge.mjs`, `tactics.mjs`, `stage.mjs`, `plan-progress.mjs`, `carousel.mjs`, `v2/js/{item-source,comp-items,model}.js` | **Alto** (maior dívida, mais agentes na área) | Golden idêntico **ou** diff por item aprovado; T4 (Formação = motor = aba Comps = checklist) verde; T2 sem estoque de itens fora de `holdings`                                          | G       | M2; **só depois que `tft-motor-itens` fechar o trabalho atual** |
| **M7**  | **Camada de estado.** `sources/*` devolvem `Field`s; `core/state/reduce.mjs` + `precedence.mjs` montam `GameState`; `app/state.mjs` chama as fontes. `seenState`, `mergeSources`, `levels.apply` viram redutores. O servidor passa a usar **o próprio estado** para `level/gold` e a ler do cliente só `user` (comp fixada, trocas, aprimoramentos); o payload antigo continua aceito (compatibilidade). GEP entra como fonte                                                                                                                                                                          | `sources/*`, `core/state/*`, `app/state.mjs`, `server.mjs`, `v2/js/api.js`                                                                                                                | Médio-alto                                    | Golden idêntico com o estado montado pelo caminho antigo e pelo novo; D6 eliminado (teste: um POST com `level/gold` defasados no payload usa o estado do servidor); precedência testada | G       | M0, M5; GEP quando `tft-fonte-gep` entregar                     |
| **M8**  | **Grafo de fatos + memoização.** `core/facts/graph.mjs` (~100 linhas) e migração dos fatos de M2-M7 para `defineFact`. Aposenta `analysis-keys.mjs`, `analysisKey` (cliente), `termCache/thresholdCache/roleCache` e o `SIMS` manual (virá `shop-math` memoizado). Contadores e `explain()`                                                                                                                                                                                                                                                                                                            | `core/facts/graph.mjs`, `analysis-keys.mjs` (removido), `server.mjs`, `v2/js/api.js`, `roll.mjs`                                                                                          | Médio                                         | Golden idêntico; T6/T7 verdes; D1 corrigido por construção (a loja entra nas entradas do fato `comps.shopHits`); tempo da camada tática ≤ metade do M0 num evento de ouro               | G       | M2-M7                                                           |
| **M9**  | **Motores como consumidores + pipeline fora do servidor.** Parte `engine.analyze` em fatos e etapas (`candidates`, `staticFit`, `dynamicChance`, `evidence`, `switch`); `tactics` deixa de mutar `analysis`; `app/recommend.mjs` recebe as ~415 linhas do POST; `server.mjs` fica só com rotas                                                                                                                                                                                                                                                                                                         | `engine.mjs` -> `core/engines/comps/*`, `tactics.mjs`, `stage.mjs`, `strategy.mjs`, `roll.mjs`, `app/recommend.mjs`, `server.mjs`                                                         | **Alto**                                      | Golden idêntico; nenhuma regra de negócio em `server.mjs` (T2); `server.mjs` < 400 linhas                                                                                               | G       | M8                                                              |
| **M10** | **Fora do caminho crítico.** Análise base em `worker_threads` e resposta tática imediata (seção 5.4); camada tática só para o plano exibido; endpoints por faceta                                                                                                                                                                                                                                                                                                                                                                                                                                      | `app/recommend.mjs`, `server.mjs`, `v2/js/api.js`                                                                                                                                         | Médio                                         | `/api/state` e SSE não travam durante `analyze` (medido); tática < 50 ms num evento de ouro                                                                                             | G       | M8, M9                                                          |

**Ordem e por quê:** M0-M1 são a rede; M2-M3 dão o maior ganho de consistência com o menor risco (dados e funções puras, quase sem estado);
M4-M5 corrigem as divergências numéricas (D3, D4) e já reduzem trabalho redundante; M6 é a dívida maior e depende de gente em outro
arquivo; M7 resolve a verdade dupla e abre espaço para o GEP; M8 colhe o desempenho e fecha o "uma mudança, tudo ajusta"; M9-M10 são
estruturais e só valem a pena depois.

**Valor entregue cedo** (se parar em M5): D2, D3, D4, D5, D7, D9, D10 resolvidos; só restam posse de itens, estado e grafo.

### 4.1 O que NÃO mover agora

- `engine` pesos e política: `STICKY_BONUS`, `PLACEMENT_POINTS`, `SWITCH_COST`, `Z95`, pesos de `buildFit`, `extend`, `patchBias`: mudar a
  forma de montar a comp/build **não foi pedido** (restrição herdada). Os passos apenas **trocam a origem** do número, nunca o valor.
- `tactics.build` (tabelas de pontos por papel e a ordem da meta) e a seleção/ordenação de comps: idem.
- `gep-reader.mjs`: é adaptador; só muda de pasta e passa a devolver `Field`. (`screen-reader.ps1`/`.mjs`, OCR e ícones, estavam aqui
  com a mesma regra; removidos em 2026-10-11, ver `.old/ocr/README.md`.)
- `capture.mjs`, `replay.mjs`, `lobbies.mjs`, `match.mjs`, `unit-ledger.mjs`: gravação e histórico, outro assunto. (Anotado: `capture.mjs`
  e `server.readBoardSnapshot` leem e parseiam o mesmo arquivo; unificar é bom, mas depois de M7.)
- `evidence.mjs` (cliente de rede com cache em disco), `meta-*.mjs`, `augment-stats.mjs`: viram `sources/`, sem mudar.
- `positions` (`tactics.plan -> place`), `carousel`, `augment-advice` (pontuação): só passam a consumir fatos.
- CSS e `ui/*`: a v2 não muda de aparência por causa desta migração.
- `live-mock.js`: continua funcionando via reexports de `/rules.mjs` e `/economy.mjs`; ajustar depois de M5.

### 4.2 Coordenação com quem está editando agora

- `tft-motor-itens` (engine/item-holdings/comp-score): trabalha exatamente na dívida de M6. Recomendo que o resultado dele já
  nasça como `core/facts/holdings.mjs` quando o passo chegar; até lá, **não abrir um 10º lugar** que aloca itens.
- `tft-fonte-gep`: devolver `Field`s (valor + `source` + `at` + `stale`) em vez de campos soltos facilita M7; precedência já descrita em 3.A.
- `tft-comps-ui` / `tft-formacao`: `comp-items.js` e `item-source.js` serão consumidores de `holdings`; manter as funções puras e com teste.
- Nenhuma dessas frentes precisa parar: M0-M3 não tocam a lógica de itens além do catálogo.

---

## 5. Desempenho

### 5.1 O que medi (offline, sem tocar o servidor) [M]

Método: `scratchpad/bench.mjs` roda `analyze -> structuredClone -> tactics -> (playbook, stagePlan, strategy) x 3 planos -> JSON.stringify`
sobre o replay de uma partida real (`3291708419`, tabuleiros finais de 8 jogadores, nível 8, 54 g, 4 componentes no banco, 60 comps de meta),
com a evidência lida de `data/evidence-cache.json` (6.713 totais, 53 condicionais). **142 perguntas ao explorer ficaram sem resposta**, então
`measure()` rodou menos que numa partida ao vivo com cache completo: tratar os números como **piso**. Uma máquina, 4 execuções seguidas.

| Etapa                                                     | 1ª (frio)   | 2ª       | 3ª       | 4ª       |
| --------------------------------------------------------- | ----------- | -------- | -------- | -------- |
| `analyze` (`engine.mjs`)                                  | 353 ms      | 210      | 114      | 146      |
| `structuredClone(base)` (o servidor faz uma por resposta) | 19          | 11       | 15       | 8        |
| `tactics`                                                 | 171         | 44       | 51       | 67       |
| `playbook` x3                                             | 3           | 2        | 1        | 0,3      |
| `stagePlan` x3                                            | 10          | 3        | 4        | 5        |
| `strategy` x3 (inclui `rollSim`, Monte Carlo)             | **368**     | 12       | 11       | 12       |
| `JSON.stringify` da resposta                              | 14          | 10       | 12       | 22       |
| **Total**                                                 | **~940 ms** | **~290** | **~210** | **~260** |

- Resposta: **432 KB** por análise (JSON). A v2 desenha só `recommendations[0]` (ou `preview`).
- Só a camada tática com o ouro mudando de 54 para 52 g (clone da base + `tactics` + 3 planos): **53-82 ms**.
- Perfil de CPU agregado (4 execuções + extras, inclui aquecimento do JIT): `rollSim` ~206 ms (só a 1ª, depois `SIMS` acerta), `analyze` ~570 ms
  inclusivo; dentro dele `holdingsFor`/`resolveHoldings` ~100 ms (60 comps), `engine.traits()` ~123 ms (recalcula do zero para cada
  candidato de `extend` e `score`), `extend` ~99 ms; `tactics.build` ~190 ms inclusivo (é chamado por peça, por plano e para o campo atual).
- Consistente com o "~1 s de CPU" comentado em `server.mjs`: a frio é ~0,9 s, a quente 0,2-0,3 s.
- **Não medido [?]**: latência de `/api/state` (o histórico diz que já foi lento; leituras síncronas `fs.statSync/readFileSync` do Sentry
  e do `TFT.log` rodam no caminho da requisição, mas não perfilei), custo com cache de evidência completo, custo sob carga ao vivo.
  O M0 instrumenta isso.

### 5.2 Onde o tempo é desperdiçado hoje [V + M]

1. **Cada mudança de ouro refaz a análise base inteira.** `ouro` está em `baseInputs` (porque o motor usa `shops`, `pFind`, `heldOf`, `chanceOf`)
   e na chave do `analysisCache`; rolar a loja (-2 g) já invalida os dois caches. Não é possível "só recalcular o dinheiro" porque o motor
   mistura a parte que depende de ouro com a que não depende.
2. **Tática de 3 planos, UI usa 1.** `server.mjs` roda `playbook`, `stagePlan` e `strategy` (com `teamOf`/Monte Carlo) para `recommendations[0..2]`
   e `preview`; `model.js` lê `rec.preview ?? rec.recommendations[0]`. Os planos 2 e 3 são computados para ninguém.
3. **Monte Carlo a frio (~370 ms)** a cada mudança de `(nível, denom, alvos)`, e `denom` muda a cada cópia vista; o `SIMS` é por chave exata de `JSON.stringify`.
4. **`structuredClone` + `JSON.stringify` de 430 KB** por resposta, mesmo que só o painel de ouro tenha mudado; `compRanking` (60 comps com evidência) vai em toda resposta.
5. **O cliente decide quando pedir.** `v2/js/api.js:analysisKey` replica, no navegador, o que o servidor considera "mudou" (e a janela de 120 s reanalisa mesmo com o jogo parado).
6. **Duas leituras do mesmo arquivo** (`capture.mjs` e `readBoardSnapshot`) e `seenState` duas vezes por ciclo.
7. **Event loop único**: ~0,2-0,9 s de `analyze` bloqueiam SSE e `/api/state` no mesmo processo.

### 5.3 O que muda por evento: hoje vs com o grafo [P]

"Hoje": o que é recalculado. "Grafo": o que **precisa** ser (fatos que dependem do que mudou; early cutoff corta o resto).

| Evento                                   | Muda no estado                                | Hoje                                         | Com o grafo (recalcula só)                                                                                                                                                           | Não recalcula                                                                          |
| ---------------------------------------- | --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **Nova rodada** (estágio+1, renda)       | `clock`, `gold`, `shop` novo, `health` talvez | tudo (`analysisKey` muda por estágio e ouro) | `clock.round`, `economy.income/shopsAhead/pressure`, `shop.model` se o nível mudou, `roll` (orçamento), `stage` (cartas); `comps` só a parte `dynamic` (chance)                      | `holdings.*`, `pool.*`, `traits`, parte `static` de `comps`                            |
| **Compra de campeão**                    | `gold`, `bench`/`board`, `shop` slot          | tudo                                         | `units.held`, `pool.visible/free` (só do campeão e do custo), `shop.slotChance` desse custo, `traits` se entrou em campo, `comps` (comps que contêm o campeão + chance), `roll.team` | `holdings.items`, `economy.pressure`, `lobby.*`, `catalog.*`                           |
| **Rolagem (-2 g, loja nova)**            | `gold`, `shop`                                | tudo (por causa do ouro)                     | `economy.shopsAhead`, `roll` (orçamento/regra), `stage.cards`, `comps.shopHits`                                                                                                      | `holdings.*`, `pool.free` (hoje a loja própria não desconta), `traits`, `comps.static` |
| **Subir de nível**                       | `level`, `xp`, `gold`                         | tudo                                         | `shop.model` (odds), `shop.slotChance` de **todos** os custos, `comps.dynamic`, `roll` (curvas e Monte Carlo), `stage.buyable`, `economy.levelCost`                                  | `holdings.*`, `pool.visible`, `traits`                                                 |
| **Item chega ao banco / equipa / passa** | `itemBank`, `board[].itemNames`               | tudo                                         | `holdings.items`, `holdings.byBuild(*)` (60), `comps.static` (itens, edge), `items` (build, carrossel), `plan` (equipar/passar), checklist                                           | `pool.*`, `economy.*`, `shop.*`, `roll.*`                                              |
| **Rival muda o tabuleiro**               | `rivals[i].board`                             | tudo (muda `snapshotSignature`)              | `pool.visible/hidden/free` das peças afetadas, `lobby.strength/threat`, `economy.pressure` se muda `weak`, `contest`, `comps.static` (disputa), `roll.team` (livres)                 | `holdings.*`, `economy.income`, `shop.model`                                           |
| **Perde vida**                           | `health`, `streak`                            | tudo                                         | `economy.pressure`, `roll` (piso/urgência), `plan-state.hold`, `decision`s                                                                                                           | `pool.*`, `holdings.*`, `traits`, `comps.static`                                       |
| **Escolhe aprimoramento**                | `user.augments`                               | tudo                                         | `traits.augment`, `comps.static` e `evidence` (perguntas novas), `augments`, `items` (emblema)                                                                                       | `economy.*`, `pool.*`                                                                  |
| **Meta/estatística renova** (2 h)        | `meta`                                        | tudo (`caches.clear()`)                      | `comps.*`, `items.build`, `augments`                                                                                                                                                 | `economy.*`, `pool.*`, `shop.*`                                                        |

Só os eventos "rodada", "compra" e "rolagem" são frequentes dentro de uma rodada de planejamento (~30-45 s); hoje todos custam a análise
inteira. A melhoria depende de partir `analyze` em parte estática (itens, pool, traços, disputa, evidência) e parte dinâmica (chance
com `shopsAhead`) — é a etapa interna de M9; antes disso, M8 já reduz o custo da camada tática e dos caches, porque cada fato vale por si.

### 5.4 A análise pode sair do caminho crítico? [P]

Sim, em três degraus independentes, do mais barato ao mais estrutural:

1. **Tática só do plano exibido (M10, ou antes).** Computar `stagePlan/strategy/playbook` apenas para `preview ?? recommendations[0]`; os outros
   planos sob demanda (`?plan=2`, que a UI não pede hoje). Corta ~2/3 do trabalho tático e do tamanho da resposta. É mudança de contrato
   interno, não de comportamento visível.
2. **Pré-aquecer o que é caro e raro de mudar.** Monte Carlo e `closeCurve` memoizados por `(nível, denom por custo, alvos)` com `denom`
   quantizado ao evento que de fato o muda; calcular no começo da fase de planejamento (`phaseKind === "planning"`), antes do primeiro clique.
3. **Stale-while-revalidate + worker.** `analyze` em `worker_threads`; o servidor responde na hora com a base anterior + tática nova (barata,
   ~50-80 ms) marcada `base: { rev, stale: true }`, e empurra a atualização por SSE (`type: "analysis"`, só as facetas que mudaram). O ranking de
   comps muda devagar (há `STICKY_BONUS`, confirmação do plano e custo de troca), então a defasagem de uma leitura é aceitável **se o usuário concordar** (decisão 4).

Metas propostas (a validar depois do M0): evento de ouro/loja ≤ 80 ms no p95; evento de item ≤ 150 ms; análise base completa ≤ 250 ms quente;
`/api/state` ≤ 20 ms; nenhum bloqueio do event loop > 100 ms.

### 5.5 Quantização (decisão)

`shopsAhead` muda a cada 2 g, então o ranking de comps recalcularia a cada rolagem mesmo com o fato isolado. Para parar de recalcular o
ranking por rolagem, a chance de montar pode usar `shopsAhead` em degraus (ex.: de 5 em 5 lojas) ou ser usada só na etapa `dynamic`.
**Muda levemente a ordenação marginal** (o que `PLANO-TOTAL` F2 pretende calibrar), por isso é decisão 3.

---

## 6. Riscos, decisões do usuário e restrições

### 6.1 Decisões que dependem do usuário

1. **Quando as cópias de uma regra discordam, qual vale?** D2 (papel de 11 itens), D3 (arredondar ou não a pool livre), D4/D9. Proposta:
   papel do item pelo superconjunto de `stage.kind` e `meta-builds.roleOf` (que concordam entre si exceto `HandOfJustice`), pool livre
   **fracionária** em tudo (é o que o motor já usa; a rolagem passa a usar o mesmo), um só piso de reroll rápido (o de `strategy`).
   Cada escolha muda alguns números; o golden lista exatamente quais.
2. **Tolerância de mudança por passo:** exigir golden **idêntico** em cada passo (e adiar os passos que corrigem divergência até a
   decisão 1) ou aceitar diffs pequenos e documentados em M2/M4/M5? Proposta: idêntico por padrão, diff só nos três passos citados.
3. **Quantizar a chance de montar no ranking de comps (5.5)?** Reduz recomputação por rolagem; muda marginalmente a ordem entre comps
   próximas. Pode ficar para depois da calibração (F2).
4. **Resposta tática imediata com base anterior (5.4-3)?** Aceita uma defasagem de uma leitura no ranking de comps em troca de nenhum
   travamento. Sem isso, o ganho de desempenho fica limitado aos degraus 1-2.
5. **Código que ninguém exibe:** remover `playbook.mjs` (hoje só portão), `decision.mjs`, `engine.recommendations[i].roll` e a tática de
   `recommendations[1..2]`? Proposta: remover o morto (D5) em M5, deixar `decision.mjs` atrás de um flag se quiser exibi-lo depois.
6. **Contrato do cliente (M7):** o servidor passa a ser a fonte de `level/gold/inventory`; o cliente envia só decisões do usuário. Aceita
   mudar `recommendPayload` mantendo o antigo como compatível por um tempo? E o `live-mock.js` acompanha?
7. **Precedência entre fontes** quando GEP e OCR discordam, e se o GEP, quando fresco, **sempre** vence (e o que fazer com o piso
   derivado de `level.mjs`). Respondida em "Decisões do usuário", item 7 (revisto em 2026-10-11: não há mais OCR).
8. **Checkpoint no Git antes do M0** (62 itens não rastreados, 55 modificados; nada disso está commitado) e política de branch para a migração.

### 6.2 Riscos

| Risco                                                                                                        | Probabilidade/impacto | Mitigação                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Refatorar enquanto outros agentes editam `engine.mjs`/`server.mjs`                                           | Alta/Alto             | M0-M1 não tocam lógica; M2 e M6 coordenados; passos curtos, golden a cada um                                                                                             |
| Golden não captura um caso de partida ao vivo (loja lida, ouro de 3 dígitos, reconexão, Dupla/Hiper Rolagem) | Média/Médio           | cenários sintéticos além dos replays; marcar o que só se confirma ao vivo (já é prática do projeto); modo sombra para regras novas                                       |
| "Idêntico" falso por tolerância do normalizador                                                              | Baixa/Alto            | normalizador só remove tempo/aleatório; floats comparados com tolerância de 1e-9, e o golden guarda o JSON completo, não só hash                                         |
| Memoização com entrada impura (tempo, aleatório, objeto mutado)                                              | Média/Alto            | `core/` sem `Date.now/Math.random` (T3), estado imutável (`Object.freeze` em teste), Proxy de entradas (T7), relógio explícito                                           |
| Navegador carregando `core/` sem build                                                                       | Baixa/Médio           | ESM puro já funciona assim (`v2/js/traits.js`); novo caminho estático `/core/*` com a mesma lista de segurança de `/v2/*`; cabeçalho `Cache-Control: no-cache` como hoje |
| Regressão de desempenho por abstração (grafo, `Field`)                                                       | Baixa/Médio           | contadores do grafo + metas de 5.4 medidas em CI local; `Field` só no limite do estado, não dentro dos laços quentes dos motores                                         |
| Mudar o contrato HTTP quebra o front                                                                         | Média/Alto            | formato de resposta intocado até M9; mudanças aditivas; flag de compatibilidade                                                                                          |
| Esconder dado desconhecido sob um valor padrão (ex.: `gold ?? 30`)                                           | Média/Alto            | `Field.value === null` explícito em `core/`; o padrão de 30 g do motor (D14) vira decisão visível                                                                        |

### 6.3 Restrições herdadas (respeitadas)

- **Não mudar como a build/comp é montada** sem pedido: nenhum passo troca peso, política de seleção, ordem de itens ou ranking; só a origem das contas.
- **Manter o comportamento de rolagem, o plano persistente e a confiança**: `roll.mjs`/`strategy.mjs` mudam de pasta e de entradas, não de saída;
  `plan-state.mjs` (`CONFIRM`, disco, sticky) e `engine` (`switchNote`, `Z95`, `SWITCH_COST`) permanecem; o golden cobre troca de plano com `holdPlan`.
- **Compatibilidade com o front**: módulos ESM sem build, resposta com o mesmo formato, mock e telas atuais funcionando durante toda a migração.
- **Sem screenshots, sem reiniciar a 3218, sem `POST /api/recommend`, sem commit** (e as medições foram offline, em scripts no scratchpad).

---

## Overlay (fora da cadeia de migração)

O overlay é uma folha: **consome** a saída do servidor e não alimenta nenhum motor.

```
interface web ──GET /api/state, POST /api/recommend──▶ server.mjs ──▶ app/overlay-feed.mjs (cache em memória)
                                                                            │ GET /api/overlay[?since=rev]
overlay/main.mjs (Electron: janela, atalhos, sonda) ──carrega──▶ /overlay/index.html (overlay/hud/, servido por static-files.mjs)
                                                                            └─ importa /v2/js/model.js, rich-text.js, glyphs.js, plan.js, next-item.js
```

- **Isolamento**: `overlay/package.json` próprio (só `electron` fixo); o servidor e a interface continuam sem dependências e sem build.
- **Regras**: nenhuma regra de jogo no overlay. `hud/view.mjs` só monta o modelo de tela a partir de `buildModel` (injetado) e `hud/draw.mjs` desenha.
  Qualquer regra nova nasce em `core/` ou no motor, nunca em `overlay/`.
- **Dependências em sentido único**: `overlay/hud/` importa de `v2/`; nada em `v2/`, `core/` ou nos motores importa de `overlay/`. O servidor só conhece
  `app/overlay-feed.mjs` e o prefixo estático `/overlay/` (-> `overlay/hud`).
- **Custo no servidor**: duas gravações de referência (state e recomendação) e uma rota que serializa o cache; nenhum cálculo novo.
- **Limite conhecido (resolvido no M10b)**: a recomendação em cache só se renovava com a interface web aberta e visível. Agora o servidor
  conduz a análise sozinho durante a partida (`app/auto-refresh.mjs`) e grava no mesmo feed; o overlay e o chip do HUD vivem sem a janela. Falta
  só rodar o pipeline na thread de análise (ver "M10b").

### Overlay integrado ao jogo (fase 2)

O overlay deixa de ser só um painel lateral: a janela cobre a área cliente do TFT e desenha dicas ancoradas nos elementos do jogo. Continua sendo uma folha
(só apresenta) e sem injeção, hook, leitura de memória, captura de tela ou automação de entrada.

```
game-tracker.mjs (PowerShell persistente, só posição da janela do TFT) ─▶ main.mjs (setBounds sobre a área cliente; IPC; atalhos)
display-mode.mjs (FullscreenMode do ini local, só leitura)             ─┘            │ window.overlayHost v2 (preload.cjs)
                                                                                     ▼
GET /api/overlay ─▶ poll.mjs ─▶ view.mjs ─▶ hints.mjs ─▶ markers.mjs (+ geometry.mjs: âncoras) ─▶ contornos/etiquetas sobre o jogo
                                       └──▶ draw.mjs ─▶ cartões em elementos posicionáveis (widgets.mjs + layout.mjs); help.mjs; calibrate.mjs; health.mjs
```

- **Uma regra, um lugar**: as dicas (`hints.mjs`) só escolhem, ordenam e ancoram o que `view.mjs` extraiu do que o servidor já calculou (`buy` cruzado com a
  loja por `v2/js/shop-match.js`, `roll`, `level`, `economy`, `wisps`); a única regra nova é de apresentação (categorias, verbosidade, tetos).
- **Geometria única**: `hud/geometry.mjs` guarda as frações do HUD (loja, banco, ouro, nível, XP, estágio) e o porte de `Hud-Rect`, só para posicionar o
  overlay (não captura pixels). Até 2026-10-11 os números vinham do `screen-reader.ps1` e `tests/overlay-geometry.test.mjs` lia o `.ps1` para conferir; com a
  leitura de tela removida, o teste fixa os valores literais (a conferência antiga está em `.old/ocr/`). Valores derivados, sem medição (cartão inteiro da loja,
  folga do banco e da área nível/XP), estão marcados `[ESTIMADO]` e são corrigidos pela calibração do overlay (`calibration`, por controles).
- **Camadas**: `config.mjs` (Node) importa os parsers de `hud/` (`parseLayout`, `parseCalibration`, `parseHintSettings`), que são puros e rodam no navegador e no
  Node; nenhum módulo de `hud/` importa `node:*`. O main revalida tudo o que a página manda (nada vindo da página é confiável).
- **Fronteira de segurança**: a ponte `overlayHost` só pede ajustes da própria janela (posição, ignorar mouse, salvar configuração); não existe método que envie
  teclado ou mouse ao jogo. A janela é `focusable: false`, click-through por padrão e só captura o ponteiro sobre elementos do overlay no modo interativo.
- **Dependência de entrada, não de saída**: o modo integrado só aparece com o TFT em janela ou janela sem borda; em tela cheia exclusiva o Windows esconde a janela
  e o overlay avisa a partir do `FullscreenMode` do ini local.
- **Adaptação ao tamanho do jogo** (`hud/fit.mjs`, puro; `follow.mjs`, puro): o layout salvo é fração do **retângulo 16:9 do HUD** (`hudRect`), não do palco
  (idêntico em janela 16:9; em ultrawide/4:3/retrato a coluna acompanha o HUD, sem migração de formato). A escala `--k` é a do HUD (o menor dos eixos) x a do
  usuário, com piso 0,6 e teto 3. Colisões e falta de espaço se resolvem por prioridade (`ELEMENT_PRIORITY`): o mais importante fica onde o usuário o pôs, o
  outro procura vaga na coluna e nas faixas livres sem cobrir banco, loja, nível/ouro e estágio, e o que não cabe é **recolhido** (o dock avisa) e volta
  sozinho. É um layout **efetivo**, refeito a cada desenho; o salvo nunca é gravado por ele (no modo interativo vê-se o salvo). O acompanhamento da janela
  ignora mudança de até 2 px, segue ao vivo (rastreador a 120 ms enquanto muda, 750 ms em repouso, ajuste exato 400 ms depois de assentar) e tolera a
  ausência do jogo por 1,5 s antes de esconder o overlay (minimizado/fechado), reexibindo ao voltar. O contrato `overlayHost` v2 não mudou.

---

## Apêndice A - Destino de cada arquivo (proposta)

| Hoje                                                                                                                                            | Destino                                                                                                                                                                               | Observação                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rules.mjs`                                                                                                                                     | `core/rules/game.mjs` + `core/rules/tables/<patch>.json`; funções de nível -> `core/state/level.mjs`                                                                                  | reexport em `/rules.mjs`                                                     |
| `economy.mjs`                                                                                                                                   | `core/rules/policy.mjs` (POLICY), `core/facts/economy.mjs` (juros, renda, pressão, XP), `core/math/shop-math.mjs` (`closeCurve`, `rollSim`, `bestSpend`, `mulberry32`, `binomialPmf`) | reexport em `/economy.mjs`                                                   |
| `level.mjs`, `streak.mjs`, `pool-tracker.mjs`                                                                                                   | `core/state/level.mjs` (redutor), `core/facts/economy.mjs` (sequência pura), `core/facts/pool.mjs`                                                                                    | a parte com estado do `levelTracker`/`streakTracker` fica em `app/trackers/` |
| `engine.mjs`                                                                                                                                    | `core/engines/comps/*`                                                                                                                                                                | último passo (M9)                                                            |
| `evidence.mjs`                                                                                                                                  | `sources/explorer.mjs` (rede/cache) + `core/engines/comps/evidence-filters.mjs` (filtros puros)                                                                                       |                                                                              |
| `item-edge.mjs`, `comp-score.mjs`                                                                                                               | `core/engines/comps/`                                                                                                                                                                 |                                                                              |
| `item-holdings.mjs`                                                                                                                             | `core/facts/holdings.mjs`                                                                                                                                                             | M6                                                                           |
| `tactics.mjs`                                                                                                                                   | `core/engines/plan/*` (posições, transições, passar itens), `core/engines/items/build.mjs`, `core/facts/lobby.mjs` (ameaça)                                                           |                                                                              |
| `stage.mjs`, `plan-progress.mjs`, `target-level.mjs`                                                                                            | `core/engines/plan/*`                                                                                                                                                                 |                                                                              |
| `strategy.mjs`, `roll.mjs`                                                                                                                      | `core/engines/roll/*`                                                                                                                                                                 |                                                                              |
| `carousel.mjs`, `contest.mjs`, `augment-advice.mjs`                                                                                             | `core/engines/items/carousel.mjs`, `core/engines/contest.mjs`, `core/engines/augments.mjs`                                                                                            |                                                                              |
| `plan-state.mjs`                                                                                                                                | `app/trackers/plan-state.mjs` (persistência)                                                                                                                                          |                                                                              |
| `playbook.mjs`, `decision.mjs`                                                                                                                  | remover (decisão 5)                                                                                                                                                                   |                                                                              |
| `analysis-keys.mjs`                                                                                                                             | removido em M8                                                                                                                                                                        |                                                                              |
| `game-log.mjs`, `unit-ledger.mjs`, `gep-reader.mjs`, `server.mjs:readLcu` (`screen-reader.*` e `bench-candidates.mjs`: removidos em 2026-10-11) | `sources/*`                                                                                                                                                                           |                                                                              |
| `meta-comps.mjs`, `meta-builds.mjs`, `meta-stats.mjs`, `augment-stats.mjs`                                                                      | `sources/meta.mjs` (E/S) + `core/catalog` (formatos)                                                                                                                                  |                                                                              |
| `capture.mjs`, `replay.mjs`, `lobbies.mjs`, `match.mjs`, `diagnostics.mjs`                                                                      | `app/recording/*`, `app/telemetry.mjs`                                                                                                                                                |                                                                              |
| `team-code.mjs`, `build-*.mjs`, `download-assets.mjs`                                                                                           | `app/` e `tools/`                                                                                                                                                                     |                                                                              |
| `server.mjs`                                                                                                                                    | `server.mjs` (HTTP) + `app/recommend.mjs` + `app/state.mjs`                                                                                                                           |                                                                              |
| `v2/js/traits.js`, `item-source.js`                                                                                                             | `core/catalog/traits.mjs`, `core/facts/holdings.mjs` (reexports finos em `v2/js/`)                                                                                                    |                                                                              |
| `v2/js/comp-items.js`                                                                                                                           | `core/engines/items/comp-items.mjs` (consome `holdings`)                                                                                                                              |                                                                              |
| `v2/js/model.js`, `ui/*`, `api.js`, `main.js`                                                                                                   | ficam em `v2/`                                                                                                                                                                        | `model.js` importa de `/core/*` só utilitários de formato                    |

## Apêndice B - O que li e como conferi

- Lidos por inteiro: `pesquisa/00-sistema-atual.md`, `FONTES-DE-DADOS.md`, `rules.mjs`, `economy.mjs`, `roll.mjs`, `strategy.mjs`, `stage.mjs`,
  `tactics.mjs`, `engine.mjs` (e as mudanças em curso), `item-holdings.mjs`, `item-edge.mjs` (função principal), `plan-progress.mjs`, `plan-state.mjs`,
  `analysis-keys.mjs`, `comp-score.mjs`, `playbook.mjs`, `decision.mjs`, `target-level.mjs`, `contest.mjs`, `replay.mjs`, `level.mjs`,
  `v2/js/{model,main,api,item-source,comp-items,items,traits}.js`, `server.mjs` (trechos de estado e todo o POST). Trechos: `game-log.mjs`, `carousel.mjs`,
  `augment-advice.mjs`, `meta-builds.mjs`, `item-tiers.mjs`, `capture.mjs`, `gep-reader.mjs` (cabeçalho), `planos/a-fazer/PLANO-TOTAL.md` (roadmap F0-F12).
- Conferências por script (em `scratchpad`, nada gravado no projeto): classificadores de item sobre `catalog.json` (11/39), papel de campeão (Leona),
  chance por loja com bancos fracionários (12/14), benchmark do pipeline por replay e perfil de CPU (`--cpu-prof`).
- Suíte: 266 testes passam (`node --test match.test.mjs augment-advice.test.mjs engine-flex.test.mjs item-edge.test.mjs "v2/js/*.test.mjs" "tests/*.test.mjs"`).
- **Desconhecido [?]**: latência real de `/api/state`; comportamento com cache de evidência completo; efeito prático de D6 (corrida entre ouro/nível do cliente e loja do servidor);
  se algum código externo ao repositório (scripts em `data/*.cjs`) importa módulos que mudarão de lugar.

---

## Decisões do usuário (2026-10-10) — vinculam a migração M0–M10

1. **Regras duplicadas que discordam:** vale o superconjunto. Papel do item = superconjunto de `stage.kind`/`meta-builds`; pool livre **fracionária** em todos os módulos; **um só** piso de reroll rápido.
2. **Golden:** aceitar diferenças documentadas em M2, M4 e M5 (cada diff registrado e justificado, nunca silencioso).
3. **Quantizar a chance de montar no ranking de comps:** decisão delegada ao orquestrador, **com base no que dá melhor resultado** (colocação/win rate nos dados gravados). Regra: só quantizar se o backtest em `data/` mostrar que a ordem do ranking não piora; senão manter a chance exata e reduzir recomputação por memoização.
4. **Resposta tática imediata com a base de uma leitura atrás:** decisão delegada. Regra: aceitar somente se a defasagem for limitada (no máximo uma leitura), explícita no payload (`stale`/`ageMs`) e corrigida por SSE; caso contrário, esperar a análise completa.
5. **Código que ninguém exibe** (`playbook`, `decision`, `recommendations[i].roll`): **remover** (M5), depois de confirmar por busca que nenhum consumidor os lê.
6. **Servidor como fonte de ouro, nível e inventário:** sim, quando fizer sentido (o cliente passa a mandar só decisões do usuário); manter o campo do cliente apenas para partida revista.
7. **Precedência entre fontes** (revista em 2026-10-11): **GEP > arquivos do jogo > desconhecido explícito**. Um único valor por campo, escolhido por `core/state/precedence`. Ouro, nível, XP, loja, banco de itens, removedores, Wisps e aprimoramentos só o GEP (TFTAcademy) observa: vale o GEP fresco e consistente; sem ele o campo fica desconhecido, com o motivo em `noSource` ("GEP off · sem fonte"), e nada é inventado (o nível pode sair como piso derivado, sempre marcado). O estágio é o único campo com duas fontes: nele o arquivo do jogo (Sentry) vale mais que o GEP, com histerese (só troca após 3 leituras) e a divergência GEP × arquivo do jogo registrada (log + contador no `/api/state`). A leitura de tela foi removida em 2026-10-11 por decisão do usuário, revogando a versão anterior desta decisão ("GEP fresco e consistente > leitura de tela > estimativa; a leitura de tela vira verificação cruzada"); ver `.old/ocr/README.md` e `PLANO-REMOVER-OCR.md`. Em aberto: o nível de reserva `FALLBACK_LEVEL = 7` (`core/state/inputs.mjs`, marcado `levelEstimated`) continua.
8. **Commit de checkpoint antes do M0:** autorizado. Antes de commitar: suíte verde, varredura de segredos (PlayerKey, token LCU, chave RSO, PUUID, nomes de jogadores) nos arquivos novos e nas fixtures, e `data/` pessoal fora do commit.

---

## Progresso da migração

Estado: **M0, M1 e M3 concluídos e verificados offline** (2026-10-10, executor `tft-migracao`; M0/M1 sobre o commit `49a17de4`, 350 testes;
M3 sobre `03f522fc`, 404 testes). M0 e M1 só fixaram o comportamento e mediram; o M3 é o primeiro a mover regra (traços e emblemas
para `core/catalog/traits.mjs`) com o golden **idêntico**. Sem commit (cabe ao orquestrador).

| Passo                           | Estado    | Observação                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 caracterização + medição     | feito     | golden de 18 arquivos, `server.mjs` com `TEMPO` no log, 4 scripts                                                                                                                                                                                                                                                                                                                |
| M1 rede de arquitetura          | feito     | catraca com 20 regras (T2), T1, T3, D1, D12, D5; `core/README.md`                                                                                                                                                                                                                                                                                                                |
| M3 traços e emblemas            | feito     | `core/catalog/traits.mjs`; golden idêntico; T1 7 -> 4 exceções; T2 `trait-*` 6 -> 0; rota `/core/*`; 421 testes                                                                                                                                                                                                                                                                  |
| M8a módulo `core/graph/`        | escrito   | só o módulo e 29 testes, **não executados**; plano do M8b na seção "M8a" abaixo; em uso desde o M8b                                                                                                                                                                                                                                                                              |
| M8b fatos do pipeline no grafo  | escrito   | `app/recommend-facts.mjs` (18 fatos) + `roll-sim.mjs` (`roll.sim`); `analysis-keys.mjs`, `analysisCache`, `baseAnalysisCache`, `pendingBase` e `SIMS` saem; **D1 corrigido** (a loja entra na base): golden **não executado**, esperado idêntico salvo `shop-cache-d1` passo 3; `manual-memo-key` 5 -> 1, `server-option-assembly` 33 -> 17 (seção "M8b" abaixo)                 |
| M4 pool e loja                  | escrito   | `core/pool/` (4 módulos); `**` 5, `ODDS[`, `3 **` e 10 % saem do produto; golden **não executado**, diffs esperados na seção "M4" abaixo                                                                                                                                                                                                                                         |
| M2 catálogo de itens e campeões | escrito   | `core/catalog/{items,champions}.mjs`; 11 itens (D2) mudam de papel no motor, golden **não executado**, 12 de 18 arquivos devem mudar (seção "M2" abaixo)                                                                                                                                                                                                                         |
| M7 camada de estado e fontes    | escrito   | `core/state/` + `app/state.mjs`; GEP x tela com uma fonte por campo (histerese 3, divergência contada; a tela saiu em 2026-10-11, ver "Remoção da leitura de tela"); servidor fonte de ouro/nível/itens; rota estática 404 limpo; golden **não executado**, esperado **idêntico** (seção "M7" abaixo)                                                                            |
| M5b limiares de ouro e vida     | escrito   | `core/economy/` (5 módulos); `interest-constants`, `hp-literal-threshold` e `gold-default` a 0, `gold-literal-threshold` a 1; golden **não executado**, esperado **idêntico** (seção "M5b" abaixo)                                                                                                                                                                               |
| M6 posse de itens               | escrito   | `core/items/` (5 módulos); o estoque, a Formação, o motor, a aba Comps e o checklist leem a mesma regra; `item-stock-consumption`, `radiant-base-id`, `item-recipe-length` a 0, `component-id-literal` a 1 (mock), T1 sem exceção; golden **não executado**, esperado **idêntico**; 3 diferenças só na Formação (UI, fora do golden) e 2 detalhes invisíveis (seção "M6" abaixo) |
| Remoção da leitura de tela      | escrito   | 2026-10-11, branch `tft-helper-sem-ocr`: GEP como fonte única do jogador, `noSource`, rótulo "lido", leitor movido para `.old/ocr/`; golden: só `levelSource` e textos mudam (seção "Remoção da leitura de tela" abaixo)                                                                                                                                                         |
| M5c..M10                        | pendentes | ver a seção de cada passo                                                                                                                                                                                                                                                                                                                                                        |

Suíte: `node --test tests/*.test.mjs v2/js/*.test.mjs *.test.mjs` = **421 testes verdes** (404 do fim do M1 + 11 de `core-traits` + 2 de
`static-files` + 4 regras T2 novas). Leva 30-52 s com a máquina folgada; com o jogo aberto e processos concorrentes uma execução só do golden passou de 5 min (ver "Achados").

### Como usar o que o M0/M1 criou

| Para quê                              | Comando (em `tft/helper`)                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Conferir o golden                     | `node --test tests/golden.test.mjs`                                                                                           |
| Aceitar uma diferença revisada        | `UPDATE_GOLDEN=1 node --test tests/golden.test.mjs` (imprime os caminhos que mudaram; regrave só depois de registrá-los aqui) |
| Refazer as entradas congeladas        | `node scripts/golden-freeze.mjs` (lê `../data`; só ao começar uma nova base de comparação)                                    |
| Tempo por etapa do pipeline, offline  | `node scripts/bench.mjs [--runs 8] [--event shop ou gold] [--scenario id]`                                                    |
| Custo do `GET /api/state`, offline    | `node scripts/bench-state.mjs [--iterations 40]`                                                                              |
| Resumir o `TEMPO` do servidor ao vivo | `node scripts/timing-report.mjs [server.log] [--since ISO]`                                                                   |
| Estado atual da catraca               | `ARCH_REPORT=1 node --test tests/architecture.test.mjs`                                                                       |

### M0 - caracterização e medição

**O que existe**

- `tests/golden/harness.mjs`: o pipeline inteiro de `POST /api/recommend` offline (montagem de `options`, `analyze` com cache da
  base e convergência da evidência, `tactics`, `playbook`/`stagePlan`/`strategy` por plano, plano em andamento, aprimoramentos,
  decisão, disputa, tabuleiro visto). Relógio injetado, evidência congelada, semente fixa: determinístico. **É uma transcrição do
  trecho de `server.mjs`** (o servidor não exporta o pipeline); `tests/golden.test.mjs` falha se a ordem das etapas ou o texto de
  `augmentEmblem` divergirem do servidor. No M9 o harness passa a chamar `app/recommend.mjs` e a guarda some.
- `tests/golden/scenarios.mjs`: **17 cenários** (mais 11 estados sintéticos de `strategy()` em `tests/fixtures.mjs`): abertura nível
  3; 2-5 com loja lida; 4-1 com sequência de derrotas; 5-2 com vida 19 (crítica); 4-2 com 8 componentes no banco; comp fixada com
  troca; dois aprimoramentos com emblema e oferta de três; troca do usuário no automático; 3 leituras da mesma partida (adoção e
  manutenção do plano); D1; Hero eliminado (`live-mock-base.json`); ouro e XP não lidos (D14); rival consultado; 120 g nível 10;
  bancos ocultos; vida 27; partida revista. Cobre níveis 3, 5, 6, 7, 8, 9 e 10 e os estágios 2-1 a 5-6, em 3 partidas capturadas.
- Entradas congeladas em `tests/golden/fixtures/`: **7 snapshots reais de `data/scouting-captures.jsonl`, anonimizados** (rivais viram
  `Rival N`, ids `9000001+`, partida com id sintético; o Hero mantém o id do projeto) com o banco oculto estimado no instante; o
  tabuleiro de `live-mock-base.json`; 4 cópias de meta (as da raiz são regravadas pelo servidor); e só as **1.067 respostas do
  explorer (de 8.419) e 11 tabelas condicionais (de 50)** que os cenários consultam. Varredura de segredos: nenhum nome de jogador,
  PUUID, token ou chave nos fixtures, nos esperados nem nos scripts.
- `tests/golden/expected/*.json.gz`: 18 respostas esperadas (1,7 MB no total; cada resposta tem 0,7-1,2 MB sem compressão). O
  `catalog.json` e o `augments.json` entram no cabeçalho por SHA-256: mudar o catálogo exige regravar o golden de propósito.
- Testes: golden por cenário; determinismo (3 cenários rodados 2x); cobertura dos caminhos prometidos; **sensibilidade**
  (`POLICY.floor.healthy`, `GAME.interestMax` e `POLICY.hp.hurt` perturbados quebram cenários); **D1 caracterizado** (abaixo); guarda
  contra desvio do harness em relação ao servidor.
- `server.mjs` (+67/-2 linhas, só mede): linha `TEMPO` por análise calculada com as etapas (`estado entrada base clone tactics planos
  plano resto json total bytes`) e resumo por minuto (n, p50, p95, máx) das rotas `/api/*` (menos `/api/events`, que é SSE).
  **Só vale depois de reiniciar o servidor**; o processo 20076 (porta 3218, iniciado às 23:34Z por terceiros) já a carrega.

**Golden: antes/depois e diffs aceitos.** Não há "antes" a comparar: M0 cria a base. Estável em 3 execuções seguidas (processos
separados) e `UPDATE_GOLDEN=1` não reescreve nenhum arquivo numa 4ª. Nenhuma diferença aceita.

**D1 confirmado e fixado no golden** (`shop-cache-d1`): depois do plano adotado, trocar só a loja devolve o ranking do cache
(`compRanking` idêntico entre a leitura 2 e a 3); recalculando a base, a loja entra no score (`scoreParts.shop` 0 -> 0,5 e 1;
`score` 21,9 -> 24,7, 23 -> 28,5, 34 -> 31,3 em comps do ranking). O M8 deve inverter as duas asserções do teste
"D1 (caracterização)" e registrar o diff.

**Medições offline** (máquina ociosa, jogo fechado, evidência congelada: é piso do custo ao vivo, que tem rede)

| Evento                                  | Por leitura (quente)                               | `analyze` | `tactics` | `json`   | Observação                                |
| --------------------------------------- | -------------------------------------------------- | --------- | --------- | -------- | ----------------------------------------- |
| Base invalidada (nível, ouro, itens...) | mediana **143 ms**, máx 215 ms (`items-bank-lvl8`) | 23-157 ms | 5-14 ms   | 12-40 ms | 1ª execução do processo (fria): 91-335 ms |
| Só a loja muda (acerta o cache da base) | mediana **44 ms**, máx 73 ms                       | 0         | 5-13 ms   | 12-21 ms | clone da base ~10 ms                      |
| Ouro -2 g (uma rolagem)                 | mediana **100 ms**, máx 167 ms                     | 10-102 ms | 5-21 ms   | 12-47 ms | o ouro está na chave: refaz a base        |

`playbook`, `stagePlan` e `strategy` somam 2-8 ms depois do 1º `rollSim` (o Monte Carlo frio, ~370 ms no levantamento anterior,
fica no `SIMS`). A resposta tem **0,74-1,2 MB** (o levantamento anterior media 432 KB): `compRanking` ~580 KB (60 comps com
evidência) e `recommendations` ~210 KB; a v2 desenha só `recommendations[0]` ou `preview`.

`GET /api/state`, offline com os módulos reais do servidor (sem abrir porta, sem o leitor de tela, que foi removido em 2026-10-11, sem gravar):

| Medida                                                                                | Resultado                                                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1ª leitura (fria, `TFT.log` de 12 MB lido do início)                                  | 104 ms, dos quais `gameFiles.status` 89 ms                                                    |
| Quente, 19 leituras a cada 450 ms (jogo fechado)                                      | p50 **3,4 ms**; picos de 58 ms (`gep.status` 47 ms: reabre o SQLite; `gameFiles.status` 9 ms) |
| HTTP numa instância isolada (porta 3299, home e `data` temporários, depois encerrada) | n=60: p50 **3,7 ms**, p90 8,7 ms, máx 12,7 ms                                                 |

Não medido offline: a espera do LCU na 1ª chamada (até 2 s de timeout), `matches.observe` e `captures.status()` (gravam em `data/`).
Com o jogo aberto e a máquina saturada, a mesma medição deu p50 54 ms e p95 2,7 s (até `fs.stat` levou 0,4-0,8 s): é a CPU, não o
código (ver achado 1).

**Medição ao vivo (indicativa, confundida).** O servidor da 3218 foi reiniciado por terceiros às 23:34Z já com o `TEMPO`; as linhas
de `server.log` (resumo: `node scripts/timing-report.mjs --since 2026-10-10T23:32:00Z`) mostram, durante uma partida e **com
testes meus e três `server.mjs` órfãos disputando a CPU**: 15 análises, `total` p50 5,9 s e p95 91 s (a 1ª depois do restart);
`base` típica 1,9-2,2 s e até 73 s (inclui a espera da rede do explorer, até 3 passes); `tactics` 0,1-2,6 s; `planos` 0,06-4,1 s;
`json` 0,1-1,1 s; `GET /api/state` com p95 de 3,9-5 s em várias janelas de 1 min (n pequeno). O contraste com o offline (143 ms)
é de 15-40x e **não se explica só pelo código**: rede na base, jogo aberto, event loop bloqueado pela própria análise (síncrona; o
`/api/state` espera na mesma fila) e CPU saturada. Reler com a máquina quieta antes de usar como linha de base do M10.

**Achados que mudam o plano**

1. **Três processos `server.mjs` órfãos** (PIDs 15540, 23148 e 37388, iniciados em 09/10 22:23-23:00, ~410-450 s de CPU cada, nenhum
   escutando porta) mantinham a CPU em ~96 % (uma leitura) e distorcem qualquer medição ao vivo. Pelo horário, são segundas
   instâncias de versões antigas (provavelmente anteriores à correção "porta antes de tudo"; não investiguei a origem). **Não mexi neles** (restrição: não matar servidores); o
   orquestrador ou o usuário deve encerrá-los antes de medir de novo e de gravar mais capturas (cada um pode duplicar gravações em
   `data/`).
2. O cache da base é invalidado quando o **plano adotado** muda `options.sticky`, então D1 só aparece depois da adoção; o teste
   usa 3 leituras por isso.
3. O tamanho da resposta (~1 MB) pesa na serialização (12-97 ms offline, até 1 s ao vivo) e na rede local: o M10 deve cortar o que a
   v2 não lê (planos 2 e 3, `compRanking` completo) além de tirar a análise do event loop.
4. O mapa 1.2-a estava incompleto: `v2/js/next-item.js` é um décimo consumidor que aloca o estoque de itens sozinho (M6).

**Riscos e pendências do M0**

- O harness é cópia do servidor: se outro agente mexer no POST, o teste de guarda acusa; religar o harness ao novo ponto de entrada.
- Sem rede, a evidência não respondida vira `null` (como a rede indisponível). O golden não cobre respostas novas do explorer.
- Só se confirma ao vivo: loja lida de verdade, Dupla/Hiper Rolagem, reconexão e `matches.observe` (não passam pelo pipeline).
- A instrumentação `TEMPO` foi verificada por `node --check`, por uma instância isolada (rota `/api/state` e resumo por minuto) e agora
  pelo log ao vivo (linhas de `/api/recommend`). Não fiz `POST` (restrição).

### M1 - rede de arquitetura (catraca)

`tests/architecture.test.mjs` e `tests/architecture/scan.mjs` (leitor estático: tira comentários, textos e regex; acha imports
estáticos e dinâmicos; com teste próprio) e `core/README.md` (a regra de ouro em uma página; `core/` nasce sem código). Regras da
catraca: cópia nova ou mais ocorrências **falha**; menos ocorrências também **falha**, pedindo para baixar o número (a melhora não
volta). Cada exceção traz o motivo e o passo que a remove.

**T1 (imports).** Exceções iniciais, 7 (o texto da seção 3.3 listava 2; o código tem 7):

| Importador -> alvo                                                                             | Dívida | Sai em |
| ---------------------------------------------------------------------------------------------- | ------ | ------ |
| `engine.mjs`, `tactics.mjs`, `server.mjs` -> `v2/js/traits.js`                                 | D7     | M3     |
| `engine.mjs`, `item-holdings.mjs`, `item-plan.mjs`, `item-value.mjs` -> `v2/js/item-source.js` | D8     | M6     |

Também verificados e sem exceção hoje: nenhum ciclo no grafo de imports; ninguém importa `server.mjs`; `v2/` e `live-mock.js` não
importam `node:*`, nem o servidor, nem arquivos fora de `v2/` (salvo `/rules.mjs` e `/economy.mjs`); `core/` só importa de `core/`.

**T2 (regra reimplementada fora do dono).** 20 regras, todas com baseline igual ao estado de hoje:

| Regra                              | Cobre   | Total hoje | Onde (ocorrências)                                                                                                    |
| ---------------------------------- | ------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `radiant-base-id`                  | D10     | 4          | item-tiers 2, comp-items 1, item-source 1                                                                             |
| `component-id-literal`             | D2      | 14         | live-mock 4, item-tiers 2, items.js 2, carousel, engine, item-holdings, item-plan, tactics, item-source               |
| `item-class-regex` (linhas)        | D2, D9  | 42         | tactics 18, live-mock 12, engine 6, meta-builds 3, stage 3                                                            |
| `star-copies` (`3 ** (estrela-1)`) | D10     | 11         | engine 4, economy 2, contest, pool-tracker, tactics, unit-ledger, model.js                                            |
| `might-formula` (`const STAR`)     | D10     | 2          | roll, tactics                                                                                                         |
| `odds-index`                       | D3      | 11         | engine 5, economy 2, stage 2, roll, strategy                                                                          |
| `per-shop-chance`                  | D3      | 3          | engine 2, live-mock                                                                                                   |
| `buyable-odds-literal`             | D3      | 4          | engine 3, stage 1                                                                                                     |
| `interest-constants`               | 1.2-b   | 23         | hud.js 9, economy 8, engine 2, rules 2, model.js 2                                                                    |
| `gold-literal-threshold`           | D4, D14 | 9          | playbook 3, target-level 2, decision, live-mock, server, strategy                                                     |
| `hp-literal-threshold`             | D4      | 17         | target-level 5, decision 3, augment-advice 3, playbook 2, economy, engine, streak, hud.js                             |
| `trait-breakpoints`                | D7      | 5          | tactics 3, engine, server                                                                                             |
| `trait-solo-rule`                  | D7      | 1          | engine                                                                                                                |
| `stage-round-parse`                | D10     | 8          | game-log, gep-reader, live-mock, plan-progress, rules, server, streak, model.js                                       |
| `augment-round-track`              | D10     | 3          | augment-advice, plan-progress, augs.js                                                                                |
| `curve-level-fallback`             | 1.2-c   | 1          | engine                                                                                                                |
| `gold-default` (`gold ?? 30`)      | D14     | 1          | engine                                                                                                                |
| `item-stock-consumption`           | D8      | 21         | tactics 6, comp-items 5, carousel 2, engine 2, item-edge 2, next-item 2, item-holdings 1 (dono), item-source 1 (dono) |
| `server-option-assembly`           | D12     | 39         | server                                                                                                                |
| `unbounded-memo-maps`              | D11     | 11         | engine 3, item-value 3, server 3, roll, evidence                                                                      |

Os donos atuais das regras (economy, rules, item-tiers, item-holdings, item-source, model.js...) também estão como exceção, com a nota
"dono atual", para a lista encolher quando a regra for para `core/`. `item-stock-consumption` é uma heurística (`indexOf` ou
`findIndex` até 2 linhas antes de `splice` em lista de estoque), não prova posse: `stage`, `plan-progress` e `model.js` (cópias 4, 5 e
8 do mapa) usam outros idiomas e **não** são detectadas por ela.

**T3 (pureza).** `core/` e os 28 módulos que o apêndice A destina ao núcleo: sem `node:*`, `fetch`, `process`, `Date.now`,
`new Date`, `Math.random` e sem depender de módulo que não seja núcleo. 5 exceções: `engine.mjs` -> `evidence.mjs` e ->
`augment-stats.mjs` (misturam rede/disco com lógica pura) e `augment-advice.mjs` -> `augment-stats.mjs` (só quer `TIER_PLACE`), saem
no M9; `pool-tracker.mjs` e `streak.mjs` com `Date.now()` como valor padrão (D13), saem em M4/M5/M7.

**D1/D11 (a chave da base).** Teste dinâmico: um `Proxy` registra as opções que `engine.analyze` lê nos 17 cenários e as compara com
as que `analysis-keys.baseInputs` usa. Lidas sem chave: `shop` (**D1, a única exceção real**) e 9 justificadas (cópias de meta
versionadas por data, `evidence` e `conditional` versionadas à parte, derivados de `augments` e `stats`; `augmentStats` depende de o
servidor apagar os caches). Opção nova lida pelo motor e fora da chave **falha**.

**D12 (servidor).** Teto de linhas de `server.mjs` em 1.409 (só baixa; meta do M9: menos de 400) e a regra `server-option-assembly`
(39 atribuições a `options.X` no POST).

**D5 (premissa do M5).** A v2 não lê `.playbook` nem `.decision` do servidor (testado). Pendências da busca do M5: `live-mock.js` ainda
gera `rec.decision` (só o mock), e `p.roll` em `v2/js/ui/panel.js` vem do view-model (`model.js`, a partir de `strategy`), não de
`recommendations[i].roll`. **Resolvido no M5a** (seção abaixo): os três foram removidos depois da busca.

**Riscos e pendências do M1**

- Contagens por linha e por janela podem mudar com o formatador (`oxfmt`) em arquivos reescritos; se um commit reformatar um arquivo
  e a contagem mexer sem mudança de lógica, ajuste o número e registre aqui.
- Outros agentes editando `engine.mjs` ou `tactics.mjs` vão acionar a catraca (ao copiar regra **ou** ao removê-la): a mensagem do
  teste diz o que fazer; não é para afrouxar o número.
- Os fixtures `fixtures/meta` são cópias de 2026-10-10; o golden não acompanha atualizações de meta (de propósito).

### M3 - traços e emblemas

**O que mudou.** A regra de traços e emblemas passou de `v2/js/traits.js` (pasta do navegador) para `core/catalog/traits.mjs` (ESM puro,
sem imports, carregável no servidor e no navegador). O módulo reúne o que estava espalhado:

| Regra (função em `core/catalog/traits.mjs`)                                                                                       | Substitui                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `emblemTraitMap`, `traitsWithEmblems`, `unmappedEmblems`, `countTraits`                                                           | as quatro de `v2/js/traits.js` (movidas sem mudar o corpo; `countTraits` agora é de fato usada)                          |
| `tallyTraits(units, emblems)` -> `{counts, byEmblem}`                                                                             | os laços de contagem de `engine.traits` e de `tactics.plan`, e o de `history.activeTraits` (via `countTraits`)           |
| `countUnitTraits(ids, traitsOf)`, `firstBreakpoint(steps)`                                                                        | os laços de `comps.activeTraits` e `comp-items.traitsToGain` (contagem de uma comp de meta) e o `Math.min(...[2])` x2    |
| `traitThresholds(trait, max)`, `traitStatus(thresholds, count)`                                                                   | `engine.thresholdsOf` + o cálculo de `active/solo/tier/next` do motor; `active/next` do plano; `breakpoints` do servidor |
| `soloTraitNames(traits, exempt)`                                                                                                  | `engine.soloOnly` (texto "Only active while fielding 1" do catálogo, liberado por aprimoramento)                         |
| `emblemRecipes(items, traitNames)`                                                                                                | `engine.emblemRecipes` (filtro `DA_`) e `tactics.emblemByTrait` (filtro por traço do set): dois filtros viraram um       |
| `traitBook(catalog, {maxUnits, exempt})`: `of`, `status`, `tally`, `summary`, `legal`, `thresholds`, `recipes`, `solo`, `emblems` | o índice por chamada que `engine`, `tactics` e `server` montavam cada um (`maxUnits: 12` no motor, como antes)           |

**Consumidores.** `engine.mjs` (`traitBook` com `maxUnits: 12` e `exempt: options.augmentTraits`; `traits()`/`legal()` viram uma chamada),
`tactics.mjs` (`book.tally/status/of/recipes`; o campo `e.apiName/composition` do emblema virou `e.id/parts`), `server.mjs` (`traitRules.of`,
`.emblems`, `.thresholds`), `v2/js/history.js`, `v2/js/comps.js`, `v2/js/comp-items.js` (via `./traits.js`) e o harness do golden
(`tests/golden/harness.mjs`, só o caminho do import). `v2/js/traits.js` ficou como **reexport fino** (7 linhas; o relativo `../../core/...` resolve
igual no Node e no navegador) porque ainda tem consumidores (`history`, `comps`, `comp-items`, `tests/traits.test.mjs`, `comp-items.test.mjs`).

**Servir o núcleo ao navegador.** O front é servido de `/v2/*`, então `../../core/catalog/traits.mjs` a partir de `/v2/js/traits.js` vira
`/core/catalog/traits.mjs`. O servidor não tinha essa rota. Em vez de acrescentar um segundo bloco ao `server.mjs`, a resolução de estáticos foi
extraída para `static-files.mjs` (`staticTarget(root, pathname)`: `/`, `/v2/*` e `/core/*`; só `.html .js .mjs .css .svg`; nunca sai da pasta) e o
bloco de rota ficou menor. Resultado: `server.mjs` 1.408 -> 1.393 linhas (o teto de D12 desceu de 1.409 para 1.394), mesmas respostas para
`/` e `/v2/*`. `/core/README.md` e qualquer outro tipo dão 404. Não toquei no servidor da 3218: a rota `/core/*` só existe depois de um
reinício dele (ver o risco 1 abaixo: o processo em execução lê `v2/` do disco a cada requisição, então já entrega o `traits.js` novo).

**Golden: antes/depois.** `tests/golden.test.mjs` (24 testes, 18 respostas completas de 0,7-1,2 MB) passou **sem nenhuma regravação**: idêntico
(nenhum `UPDATE_GOLDEN`). O golden não exercita o traço solo (nenhum cenário põe 2 campeões de Rival), então a equivalência desse caminho foi
fixada por um teste novo, abaixo. Perturbar `traitStatus` (`next`) quebra os 17 cenários do golden (os 7 testes de `strategy` seguem verdes); perturbar o limite do solo não quebra nenhum (por isso o teste dedicado).

**Diferenças de comportamento: nenhuma no catálogo atual.** Há três equivalências que valem só para o catálogo/dados atuais e estão registradas aqui:

1. `emblemRecipes` junta dois filtros: o do motor exigia `apiName` com `DA_` e **não** exigia traço do set; o do plano exigia traço do set e **não** `DA_`.
   Neste catálogo os dois dão a mesma lista (todo emblema com 2 componentes é `DA_` e de traço do set; teste `emblemRecipes = os dois filtros de antes`).
   Num patch futuro com um emblema `TFT_...` ou com traço desconhecido, o motor deixaria de ver/passaria a ver um emblema: o teste acusa na hora.
2. Patamares (`traitStatus`): o motor ignora patamares acima de 12 (`maxUnits: 12`) e o plano não; o catálogo não tem patamar acima de 9, então coincidem. A diferença
   continua explícita nos dois pontos de uso (`traitBook(catalog, {maxUnits: 12})` no motor; `traitBook(catalog)` no plano e no servidor).
3. `comps.activeTraits`/`comp-items.traitsToGain`: o laço de antes usava `Set` por campeão e por traço; `countUnitTraits` mantém isso (sem itens, sem emblema).

**Testes novos.**

- `tests/core-traits.test.mjs` (11 testes): os laços **antigos copiados sem mudança** (motor, plano, histórico, comps/comp-items, receitas) contra as funções do núcleo
  em ~1.500 tabuleiros sorteados (semente fixa) com o catálogo real, incluindo emblemas repetidos, cópias do mesmo campeão e o traço solo (Rival) com e sem
  aprimoramento que o libera; casos de `traitStatus`, `traitThresholds`, `countTraits`; `v2/js/traits.js` reexporta as mesmas funções; o módulo do núcleo não importa nada.
- `tests/static-files.test.mjs` (2 testes): `staticTarget` (raiz, v2, core, tipos, `..`, prefixos parecidos) e **todo import estático alcançável de `v2/js/main.js`,
  resolvido como URL, cai num arquivo que o servidor serve** (inclui `/core/catalog/traits.mjs`).
- `tests/architecture.test.mjs`: 4 regras T2 novas que travam a regressão (`trait-count-loop`, `trait-first-breakpoint`, `emblem-trait-rule`, `emblem-name-parse`).

**Catraca: o que desceu.**

| Item                                                              | Antes                                                                       | Depois                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| T1: exceções                                                      | 7 (3 para `v2/js/traits.js`)                                                | **4** (só `item-source.js`, M6)                                                                         |
| T1: regra nova                                                    | `v2/` não podia importar fora de `v2/` por caminho relativo                 | permitido **só** `v2/ -> core/` (o servidor serve `/core/*` ao lado de `/v2/*`; é o reexport de traits) |
| T2 `trait-breakpoints` (`minUnits`)                               | 5 (tactics 3, engine 1, server 1)                                           | **0**                                                                                                   |
| T2 `trait-solo-rule`                                              | 1 (engine)                                                                  | **0**                                                                                                   |
| T2 `trait-count-loop` / `-first-breakpoint` / `emblem-name-parse` | (regras novas; achavam 5 laços, 2 `Math.min` e 2 `/ Emblem$/` fora do dono) | **0**                                                                                                   |
| T2 `emblem-trait-rule`                                            | (regra nova)                                                                | 2: o reexport `v2/js/traits.js` (permanente, com motivo)                                                |
| T2 `unbounded-memo-maps` (`engine.mjs`)                           | 3                                                                           | **2** (o `thresholdCache` virou o cache do livro de traços)                                             |
| D12: teto de linhas do `server.mjs`                               | 1.409                                                                       | **1.394**                                                                                               |
| T3: `CORE_CANDIDATES`                                             | `v2/js/traits.js` era candidato                                             | continua (agora é só reexport de `core/`, pura)                                                         |

**Medição.** O benchmark do pipeline (`scripts/bench.mjs`) ficou inconclusivo: a máquina estava saturada por outros processos (a mediana por
leitura foi de 71 ms numa execução e 121 ms e 417 ms nas seguintes, e `tactics`/`json`, que o M3 não alterou, subiram na mesma proporção).
O caminho que mudou, `traits(board)`, medido em processo único com 2.000 tabuleiros de 9 peças: laço antigo 64-88 us por tabuleiro, `book.summary` 23-68 us (igual ou
melhor). Reler `bench.mjs` com a máquina quieta antes de usar como base do M4.

**Riscos e pendências do M3.**

- **1. O servidor da 3218 precisa ser reiniciado por quem o controla, e isso é urgente.** O processo em execução serve `v2/` lendo o disco a cada requisição
  (`Cache-Control: no-cache`), então o navegador já recebe o `v2/js/traits.js` novo, que importa `../../core/catalog/traits.mjs`; o código antigo do servidor não tem a rota
  `/core/*` e responde 404. Um 404 num `import` estático derruba o grafo de módulos de `main.js` (a interface inteira, não só Histórico/Comps) na próxima
  recarga da página. Reiniciar o servidor e recarregar a página é um passo só. Sem reinício, nada do lado do servidor muda (o processo tem o `engine.mjs` e o `tactics.mjs`
  antigos na memória). Não reiniciei nem fiz GET no servidor vivo.
- Bug anterior, não tocado: na rota estática, `res.writeHead(200)` roda antes de `fs.readFile`; um arquivo ausente (`/v2/x.js`, `/core/x.mjs`) cai no `catch` e tenta
  `writeHead` outra vez (erro de cabeçalhos já enviados, 400 do `catch` externo). Corrigir ler o arquivo antes de escrever o cabeçalho é uma linha, mas é mudança de comportamento; fica para o orquestrador decidir.
- `unmappedEmblems` e o emblema "Phantom" (copia a sinergia mais ativa, sem traço fixo) continuam fora do mapa; é regra de produto, não de M3.
- Emblema de **aprimoramento** (`server.augmentEmblem`, `makeAugmentEmblem` no harness) continuava no servidor: foi para `core/catalog/traits.mjs` na fatia "M9 - emblema vindo de aprimoramento" (abaixo).
- `tactics.mjs` ainda tem regex de papel/cobertura de item (`VoidStaff|LastWhisper|...`) e `/Emblem|ThiefsGloves/`: pertencem ao catálogo de itens (M2).

### M9 (fatia) - emblema vindo de aprimoramento

**Estado: escrito e verificado só por `node --check` e leitura; NENHUM teste, golden ou benchmark foi executado** (regra do usuário: a suíte roda
uma vez no fim, pelo orquestrador). Sem commit.

**O que mudou.** A regra "aprimoramento que concede emblema/sinergia -> sinergias efetivas, nomes e itens de emblema" saiu de `server.mjs`
(`augmentEmblem`, `traitsOfAug`, o mapa `traitNameByApi` e três atribuições espalhadas no POST) e da cópia transcrita no harness do golden
para `core/catalog/traits.mjs`, dentro do mesmo livro que M3 criou:

| Em `traitBook(catalog)` | O que faz                                                                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `augmentEmblem(a)`      | `{ trait (apiName), item (id do emblema ou null) }` ou `null`: só aprimoramento `DA_`; nome em inglês "X Crest/Crown/Circlet/Emblem", ou texto "Recebe um Emblema de X.", ou a única sinergia listada; o item é o "X Emblem" `DA_` que não termina em `Augment` (texto idêntico ao de antes)    |
| `grants(chosen)`        | `{ traits, traitsById, emblems, emblemOf, traitsOf }`: exatamente os valores de `options.augmentTraits` (nomes, libera o traço solo), `options.augmentTraitsById` (apiNames; o motor não soma o tier de quem a sinergia já mediu) e `options.augmentEmblems` (itens que entram em `myItemsFor`) |
| `nameOf(apiName)`       | nome da sinergia (substitui os `traitNameByApi` de `server.mjs` e do harness; `chosenAugments[i].traits`)                                                                                                                                                                                       |

**Consumidores.** `server.mjs`: `const grants = traitRules.grants(chosen)` e as três opções atribuídas nos **mesmos pontos de antes** (duas antes da chave de
cache, `augmentEmblems` depois dela, como era), `chosenAugments` via `traitRules.nameOf`. Harness (`tests/golden/harness.mjs`): mesma chamada;
`makeAugmentEmblem` virou `traitBook(catalog).augmentEmblem` (os cenários o usam para escolher aprimoramentos). Motor (`engine.mjs`, `roll.mjs`): **sem
edição**; eles só leem `options.augmentTraits/augmentTraitsById/augmentEmblems` (consumidores puros: nenhuma regra de emblema de aprimoramento sobrou
neles; a catraca confirma). Interface: não calcula nada disso (só mostra `chosenAugments` que o servidor manda); nada a mudar. `augment-advice.mjs` usa só
`a.traits` do aprimoramento (sem a sinergia do emblema) e continua assim: é política de ordenação das ofertas, não esta regra.

**Formato do pipeline e do golden: idêntico por construção.** As opções têm os mesmos valores, a mesma ordem de chaves e os mesmos pontos de atribuição;
`analysis-keys` e as chaves de cache não mudam. Diferença esperada no golden: **nenhuma** (não regravar). Suposição única, agora testada: `apiName` e
`name` de sinergia são únicos no catálogo (antes, `Map` pegava o último e `find` o primeiro; com unicidade dá igual).

**Catraca e testes (escritos, não executados).**

- `tests/architecture.test.mjs`: regra T2 nova `augment-emblem-rule` (`Crest|Crown|Circlet` fora de `core/`, baseline vazia) que trava a regressão. Antes não havia
  regra para isso (a cópia no servidor e a no harness eram guardadas pelo teste de texto, abaixo). T3 e T1 não mudam.
- `tests/golden.test.mjs`, teste "o harness continua sendo uma transcrição fiel...": a comparação de texto de `augmentEmblem` (servidor x harness) foi
  trocada por uma conferência de que os dois chamam `.grants(chosen)` e atribuem as três opções a partir dele; a ordem das etapas segue conferida.
  A guarda inteira some quando o harness passar a chamar `app/recommend.mjs`.
- `tests/core-augment-emblem.test.mjs` (novo, 6 testes): o código antigo do servidor copiado sem mudança contra o núcleo, em todos os aprimoramentos reais de
  `augments.json` e em 600 conjuntos sorteados (semente fixa); casos de borda (id antigo, quatro sufixos, texto, sinergia única, duas sinergias, item `…Augment`);
  unicidade de `apiName`/`name`; servidor e harness sem a cópia.
- D12: `server.mjs` 1.394 -> 1.351 linhas hoje (inclui edições de outros agentes na árvore); o teste só exige >= 95 % do teto, então o teto
  `SERVER_MAX_LINES` **não foi baixado** por mim (muita gente editando o arquivo): quem fechar a sequência deve baixar para o valor final.
  `server-option-assembly` não muda (as 3 atribuições a `options.augment*` continuam, só com a regra por trás).

**Pendências.** (1) Rodar a suíte no fim: o que mais pode acusar é `tests/core-augment-emblem.test.mjs` (escrito sem execução) e a nova regra T2. (2) O motor
ainda recebe `augmentTraits/ById/Emblems` como opções montadas fora dele; o desenho final (M9 inteiro) é o motor receber os aprimoramentos escolhidos e chamar
`grants`, mas isso muda o conteúdo da chave de cache (`options` inteira entra nela) e foi deixado de fora para manter o golden e as chaves idênticos.
(3) `augment-advice.mjs` e `engine.mjs` ainda têm seu próprio `traitByApi` (nome por apiName) para outras finalidades; podem usar `book.nameOf` quando forem tocados.

### M8a - módulo do grafo de fatos (`core/graph/`), sem consumidores

**Estado: escrito e verificado só por `node --check` e por revisão/simulação mental dos testes; NENHUM teste, golden ou benchmark foi
executado** (regra do usuário: a suíte roda uma vez no fim, pelo orquestrador). Sem commit. **Nenhum consumidor foi trocado**: o grafo
existe e está testado isolado; `analysis-keys.mjs`, `baseAnalysisCache`, `SIMS` etc. continuam como estão (a troca é o M8b, depois que
M2/M4/M7 terminarem). Golden: não tocado, portanto idêntico por construção.

**Arquivos.**

| Arquivo                       | Papel                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `core/graph/stable-key.mjs`   | `canonical`, `stableKey`, `digestString`: chave estrutural estável (ordem de chaves, `Map`/`Set`, `-0`, `NaN`, voláteis via `ignore`) |
| `core/graph/graph.mjs`        | `defineFact`, `createGraph`, `DEFAULT_KEEP`; o grafo, a memoização, a invalidação e as estatísticas                                   |
| `core/graph/errors.mjs`       | `GraphError` com `code` estável (13 códigos, listados no arquivo)                                                                     |
| `core/graph/index.mjs`        | ponto de entrada único (reexporta os três)                                                                                            |
| `tests/core-graph.test.mjs`   | 29 testes (escritos, **não executados**)                                                                                              |
| `tests/architecture.test.mjs` | regra T2 nova `manual-memo-key` (só exceções contadas) e dono de `unbounded-memo-maps` corrigido para `core/graph/`                   |

**API (pequena).**

```js
import { createGraph, defineFact } from "../core/graph/index.mjs";

const income = defineFact({
  id: "economy.income",
  inputs: ["gold", "streak"], // lista = apelido igual ao nome; ou { apelido: "nome de entrada ou de fato" }
  compute: ({ gold, streak }) => incomeOf(gold, streak), // pura, síncrona; só enxerga gold e streak
});
const graph = createGraph({
  facts: [income /* , ... */],
  inputs: { gold: null, streak: null, players: { ignore: ["modifiedAt"] } }, // entradas que `set` aceita; `ignore` = voláteis
  keep: 8, // teto de entradas memoizadas por fato (cada fato pode ter o seu)
  clock: now, // injetado, só para medir o tempo de cada cálculo em stats()
});
graph.set({ gold: 54, streak: 2, players }); // devolve os nomes cujo CONTEÚDO mudou
graph.get("economy.income"); // calcula sob demanda só o que está sujo e ainda não foi visto
graph.stats({ reset: true }); // { computes, hits, reused, evictions, entries, capacity, recomputed: [...], facts: {...} }
graph.explain("economy.income"); // chave atual, entradas que mudaram na última resolução, de onde veio o valor
graph.describe(); // entradas, fatos, dependentes diretos e transitivos
```

**Como cumpre cada requisito do pedido.**

1. **A função só enxerga o que declarou.** `compute` recebe um `Proxy` somente leitura que contém só os apelidos declarados: `inputs.shop`,
   `const { shop } = inputs` e `"shop" in inputs` lançam `UNDECLARED_INPUT` (com o fato e a entrada no erro), mesmo que `shop` exista no grafo; escrever
   lança `READONLY_INPUT`. É o D1 por construção: um fato não consegue ler a loja sem declará-la, e declará-la a põe na chave. **Limite honesto:**
   o `Proxy` não impede ler uma variável do módulo por fechamento nem mutar o objeto de uma entrada. Contra isso: (a) escrever fatos como funções
   de topo de módulo (revisão + um teste estático no M8b que recusa `compute` que referencia nomes de fora), (b) `createGraph({ verify: true })` nos
   testes: roda cada fato duas vezes e exige saída igual (pega relógio, aleatório e estado oculto), confere por chave que a entrada não mudou (pega
   mutação) e congela a saída em profundidade (pega consumidor que muta o cache).
2. **Memoização por chave estável.** A chave de um fato é a junção, na ordem alfabética dos apelidos, do "token" de cada dependência: para entrada, o resumo
   estrutural do conteúdo (sem os campos de `ignore`); para fato, o resumo estrutural da saída (`cutoff: "structural"`, padrão) ou, quando a saída tem funções
   ou é enorme, o resumo da própria chave (`cutoff: "key"`). Não depende da ordem do `set`, da ordem das chaves dos objetos, da ordem de inserção de `Map`/`Set`
   nem de identidade de objeto. Resumo = dois hashes de 53 bits + comprimento (106 bits efetivos). **Diferença do desenho de 2.3:** o `FactDef` previa `equals`
   e seletores sobre o estado; ficou `cutoff` (dois modos) e entradas só por nome, porque a comparação por resumo permite histórico (voltar ao ouro 54 reaproveita o
   cálculo de antes) e o estado achatado em entradas nomeadas deixa a dependência visível. Isto não impede o M7: o `GameState` entra como várias entradas.
3. **Invalidação mínima com relatório.** O grafo é estático; na criação calcula o fecho de dependentes de cada nó. `set` compara o conteúdo (atalho por
   referência igual; troca por cópia estruturalmente igual não invalida nada) e só marca como sujos os dependentes transitivos das entradas que mudaram. `get` é
   sob demanda: um fato sujo recalcula as chaves das dependências, e se a chave dele é a mesma (**corte antecipado**) ou já foi vista (**histórico**) não
   executa a função. `stats()` conta por fato `computes` (executou), `hits` (reaproveitou do histórico), `reused` (conferiu e nada mudou) e lista `recomputed`
   na ordem em que rodaram (teto de 512 nomes; o excedente só é contado). `explain()` mostra por que o fato rodou (quais apelidos mudaram).
4. **Teto de memória.** Cada fato guarda no máximo `keep` entradas (LRU; o uso de uma entrada a leva ao fim da fila; a mais recente nunca sai); o total do grafo
   nunca passa da soma dos `keep` (`stats().capacity`). Não há outro `Map` que cresça: o valor atual é uma entrada do mesmo LRU e a lista de recalculados é
   limitada. Chave e resumo são textos curtos; o grafo não guarda cópia das entradas além da referência atual.
5. **Ciclos e erros.** Ciclo, dependência desconhecida, nome repetido e fato com nome de entrada falham em `createGraph` (`CYCLE` traz o caminho `a -> b -> a`).
   `set` é atômico (valida e calcula todas as chaves antes de aplicar). `get`/`set` de dentro de um fato dão `REENTRANT`; fato que devolve `Promise`, `ASYNC_FACT`
   (E/S fica fora do grafo e entra como entrada); falha de cálculo não é memoizada (`COMPUTE_FAILED` com `cause`).
6. **Relógio injetado e pureza.** Sem `Date.now`, `new Date`, `Math.random`, `process`, `fetch` nem `node:*`; o relógio opcional só mede milissegundos. Um teste estático
   (`tests/core-graph.test.mjs`) e a regra T3 existente (que varre `core/`) travam isso.

**Testes (escritos, não executados; simulados à mão contra o código).** `tests/core-graph.test.mjs`: chave estável (ordem, `undefined`, `Map`/`Set`, `-0`, `NaN`, ciclo e função
com caminho, voláteis em qualquer profundidade); validação de `defineFact`/`createGraph`; **ciclo** (A↔B, autociclo, ciclo de 3 com ramo inocente, diamante aceito); **memoização**
(sem recalcular, cópia estrutural, voltar a valor visto); **invalidação mínima** num grafo com a forma do pipeline (ouro -2: só renda, lojas ao alcance e resumo; nível: odds, chance e
resumo; troca de tabuleiro com mesmo tamanho: só `held`, `chance` e `summary` conferidos e não recalculados; sob demanda: marcar como sujo não calcula); `describe`; **D1**
(a loja declarada invalida só quem a declara); **leitura não declarada** (`inputs.x`, desestruturação e `in`); somente leitura; `COMPUTE_FAILED`; `REENTRANT`/`ASYNC_FACT`;
**determinismo da chave** entre dois grafos (ordem do `set`, das chaves, do `Map`, dos apelidos); **campos voláteis**; **limites de memória** (`keep`, LRU, padrão 8, lista de
recalculados limitada, reset não esvazia o histórico); relógio; `cutoff: "key"`; `verify` (mutação, não determinismo, saída congelada); pureza do módulo.

**Catraca.** Regra T2 nova `manual-memo-key` (dono: `core/graph/`): conta consultas a cache por chave montada à mão (`*Cache*/SIMS/pending*/*Memo*` `.get/.has(` com argumento `*Key*`,
`JSON.stringify` ou `*Inputs`) fora de `core/`. Exceções contadas, **5 ocorrências em 3 arquivos**, todas removidas pelo M8b: `server.mjs` 3 (`analysisCache.get(cacheKey)`,
`baseAnalysisCache.get(baseKey())`, `pendingBase.get(baseInputs)`), `roll.mjs` 1 (`SIMS.get(key)`), `engine.mjs` 1 (`planMemo.get(memoKey)`). Contagem feita por busca textual com a mesma
expressão (não pelo leitor do teste): se a árvore tiver mudado em `engine.mjs`/`server.mjs` por outro agente, o primeiro a falhar deve ser ajustado olhando `ARCH_REPORT=1`. A regra existente
`unbounded-memo-maps` (11 `new Map` de cache) continua com suas exceções; só o dono mudou de `core/facts/graph.mjs` para `core/graph/`.

#### Plano do M8b: fatos concretos a criar a partir do pipeline atual

Pré-condições: M2, M4 e M7 fechados (os fatos de catálogo, pool/loja e estado já existem como funções puras de `core/`), e M5 (economia). O M8b **não parte `analyze`** (isso é o M9):
`comps.base` embrulha o `analyze` de hoje, mas com **todas** as entradas que ele lê declaradas, inclusive `shop`. Convenções: `id` em minúsculas com ponto; `.i` = um fato por plano
(`0`, `1`, `2`; a v2 só mostra um, o corte para o plano exibido é M10); `cutoff` é `structural` salvo indicação; `keep` entre colchetes.

**Entradas do grafo, por volatilidade** (quem chama `graph.set` e quando):

| Classe                | Entradas                                                                                                                                                              | Muda quando                                                                                 | Observação                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Patch/meta (estáveis) | `catalog`, `table` (tabela do patch: GAME/ODDS/POOL/POLICY), `metaComps`, `metaBuilds`, `metaRoles`, `stats`, `itemStats`, `baseAvg`, `augmentStats`, `augments.json` | troca de patch, renovação de meta (2 h), reinício                                           | substituem a data/versão que `baseInputs` põe na chave (`builds`, `comps`, `stats`)      |
| Evidência             | `evidence`, `conditional`                                                                                                                                             | resposta nova do explorer (a convergência de até 3 passes fica FORA do grafo e chama `set`) | substituem `evidenceVersion`; a referência igual é atalho (não reamostra 6,7 mil totais) |
| Leitura do jogo       | `players` (`ignore: ["modifiedAt"]`), `playerId`, `viewedPlayerId`, `hidden`                                                                                          | rival muda tabuleiro, peça/item/estrela, banco estimado                                     | substituem `snapshotSignature` (assinatura à mão)                                        |
| **Por rodada**        | `stage`, `health`, `streak`, `xp`, `level`, `levelEstimated`, `targetLevel`, `bankRead`                                                                               | rodada nova, perda de vida, sequência, XP                                                   | `stage` com round em `clock.round`                                                       |
| **Por compra**        | `gold`, `bench`, `inventory`, `removers`                                                                                                                              | compra/venda de campeão, item chega/passa, remover                                          | o Hero em campo vem de `players` + `playerId`                                            |
| **Por rolagem**       | `shop`, `gold`                                                                                                                                                        | rolagem (-2 g, loja nova), compra na loja                                                   | `shop` entra em `comps.base` (corrige D1)                                                |
| Decisão do usuário    | `augments`, `augmentTraits`, `previewIds`, `goalCarryId`, `goalComp`, `swaps`, `sticky`, `stickyCompId`, `holdPlan`                                                   | clique do usuário; plano adotado/mantido                                                    | `sticky`/`holdPlan` ainda decididos no servidor até o M7/M9                              |

**Fatos** (entradas declaradas; "substitui" é o que some do código):

| Fato                 | Entradas declaradas                                                                                                                                                                                                                                                                                                                                            | Substitui hoje                                                                                               | cutoff / keep      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| `catalog.items`      | `catalog`                                                                                                                                                                                                                                                                                                                                                      | `item-tiers.kindOf/CONSUMABLE/baseItemId`, `engine.itemRole`, `stage.kind` (resultado do M2)                 | key / 2            |
| `catalog.champions`  | `catalog`, `metaRoles`                                                                                                                                                                                                                                                                                                                                         | `engine.computeRole`/`roleCache`, `tactics.role` (M2)                                                        | key / 2            |
| `catalog.traits`     | `catalog`                                                                                                                                                                                                                                                                                                                                                      | `traitBook` por chamada (M3) e `thresholdCache` do motor                                                     | key / 2            |
| `clock.round`        | `stage`                                                                                                                                                                                                                                                                                                                                                        | parse "S-R" (M5)                                                                                             | structural / 8     |
| `units.board`        | `players`, `playerId`                                                                                                                                                                                                                                                                                                                                          | `engine.count/own` (tabuleiro do Hero), `viewedBoard` do servidor                                            | structural / 8     |
| `rivals.boards`      | `players`, `playerId`                                                                                                                                                                                                                                                                                                                                          | `engine.opponents`, `count().enemy/rivals`                                                                   | structural / 8     |
| `units.held`         | `units.board`, `bench`                                                                                                                                                                                                                                                                                                                                         | `engine.own`, `roll.teamOf.mine`, `tactics current/reserve`, `stage field/reserve`                           | structural / 8     |
| `pool.visible`       | `units.held`, `rivals.boards`, `catalog.champions`                                                                                                                                                                                                                                                                                                             | `engine.count()` (`visible`, `own`, `enemy`, `rivals`)                                                       | structural / 8     |
| `pool.hidden`        | `hidden`                                                                                                                                                                                                                                                                                                                                                       | `options.hidden` arredondado a 0,5 no servidor (D13; vira `captures` + `clock.now` no M7)                    | structural / 8     |
| `pool.free`          | `pool.visible`, `pool.hidden`, `table`                                                                                                                                                                                                                                                                                                                         | `engine.upper/free/denomByCost`, `economy.likelyFree/freeByCost`, `roll.denom` (resultado do M4)             | structural / 16    |
| `economy.income`     | `gold`, `streak`                                                                                                                                                                                                                                                                                                                                               | `economy.incomeOf`, renda inline do motor (M5)                                                               | structural / 8     |
| `economy.shopsAhead` | `gold`, `economy.income`, `table`                                                                                                                                                                                                                                                                                                                              | `engine` (`shops`), `math.shopsFor` (D14: `gold` nulo vira `null`, não 30)                                   | structural / 16    |
| `lobby.strength`     | `rivals.boards`, `units.board`, `table`                                                                                                                                                                                                                                                                                                                        | `economy.lobbyStrength`                                                                                      | structural / 8     |
| `economy.pressure`   | `health`, `clock.round`, `lobby.strength`, `streak`                                                                                                                                                                                                                                                                                                            | `economy.pressureOf` e os limiares avulsos (M5)                                                              | structural / 16    |
| `economy.levelCost`  | `xp`, `level`, `table`                                                                                                                                                                                                                                                                                                                                         | `economy.levelCostOf`, `model.parseXp`                                                                       | structural / 8     |
| `shop.model`         | `level`, `table`                                                                                                                                                                                                                                                                                                                                               | `ODDS[...]`, slots, `MIN_ODDS` (M4)                                                                          | structural / 16    |
| `shop.read`          | `shop`, `catalog.champions`                                                                                                                                                                                                                                                                                                                                    | `seen.shop.map(...)` do servidor (slots -> id/custo)                                                         | structural / 8     |
| `shop.slotChance`    | `shop.model`, `pool.free`, `level`, `targetLevel`                                                                                                                                                                                                                                                                                                              | `engine.probability`, `economy.slotChance` (nível de agora e alvo)                                           | structural / 16    |
| `holdings.items`     | `units.board`, `bench`, `inventory`, `bankRead`, `catalog.items`                                                                                                                                                                                                                                                                                               | `engine.ownedItems/itemStock/freeItems`, estoques de `tactics`, `carousel`, `comp-items` (M6)                | structural / 8     |
| `holdings.byBuild`   | `holdings.items`, `units.held`, `metaBuilds`, `metaComps`                                                                                                                                                                                                                                                                                                      | `item-holdings.resolveHoldings` por comp (60 comps) (M6)                                                     | structural / 4     |
| `traits.board`       | `units.board`, `catalog.traits`, `holdings.items`, `augments`                                                                                                                                                                                                                                                                                                  | `engine.traits()`, `tactics.counts`, `server viewedBoard` (M3)                                               | structural / 8     |
| `lobby.threat`       | `rivals.boards`, `catalog.champions`                                                                                                                                                                                                                                                                                                                           | bloco `threat` do `tactics`                                                                                  | structural / 8     |
| `lobby.contest`      | `rivals.boards`, `pool.visible`, `units.held`                                                                                                                                                                                                                                                                                                                  | `economy.isContested`, `contestOf`/`dispute`, `contest.contestAlert`                                         | structural / 8     |
| **`comps.base`**     | `players`, `playerId`, `bench`, `hidden`, `inventory`, `bankRead`, `level`, `targetLevel`, `gold`, **`shop`**, `previewIds`, `augmentTraits`, `augments`, `swaps`, `goalCarryId`, `stickyCompId`, `sticky`, `holdPlan`, `stage`, `metaComps`, `metaBuilds`, `metaRoles`, `stats`, `itemStats`, `baseAvg`, `augmentStats`, `evidence`, `conditional`, `catalog` | `engine.analyze` + `analysis-keys.baseInputs` + `baseAnalysisCache` + `pendingBase` (D1 e D11)               | structural / **4** |
| `plan.tactics.i`     | `comps.base`, `inventory`, `removers`, `metaBuilds`, `stats`, `previewIds`, `goalCarryId`, `goalComp`, `viewedPlayerId`, `holdings.items`, `lobby.threat`                                                                                                                                                                                                      | `tactics(base, ...)` por plano (hoje muta `analysis`; o fato devolve o resultado, o servidor para de clonar) | structural / 4     |
| `plan.stage.i`       | `plan.tactics.i`, `shop.read`, `shop.slotChance`, `shop.model`, `economy.shopsAhead`, `gold`, `level`, `stage`, `inventory`, `metaBuilds`                                                                                                                                                                                                                      | `stage.mjs:stagePlan`                                                                                        | structural / 8     |
| `roll.team.i`        | `plan.tactics.i`, `plan.stage.i`, `pool.free`, `units.held`, `level`, `augmentTraits`                                                                                                                                                                                                                                                                          | `roll.teamOf`                                                                                                | structural / 8     |
| `roll.sim.i`         | `shop.model`, `roll.team.i` (só `denom` e `targets`, via fato `roll.simInput.i`)                                                                                                                                                                                                                                                                               | `roll.SIMS` (`JSON.stringify([nível, denom, alvos])`, teto 24) e o Monte Carlo a frio (~370 ms)              | key / **24**       |
| `roll.strategy.i`    | `roll.team.i`, `roll.sim.i`, `plan.stage.i`, `economy.pressure`, `economy.levelCost`, `economy.income`, `gold`, `level`, `stage`, `xp`, `levelEstimated`, `streak`                                                                                                                                                                                             | `strategy.mjs:strategy` (+ `rollRule`, `rollRows`)                                                           | structural / 8     |
| `plan.progress.i`    | `plan.tactics.i`, `holdings.byBuild`, `units.held`, `augments`, `stage`                                                                                                                                                                                                                                                                                        | `plan-progress.buildChecklist`                                                                               | structural / 4     |
| `augments.advice`    | `traits.board`, `comps.base`, `economy.pressure`, `augmentStats`, `augments`, `stage`                                                                                                                                                                                                                                                                          | `augment-advice`                                                                                             | structural / 4     |
| `contest.alert`      | `comps.base`, `lobby.contest`                                                                                                                                                                                                                                                                                                                                  | `contest.contestAlert`                                                                                       | structural / 4     |

Total: 26 fatos únicos mais 7 por plano (`plan.tactics`, `plan.stage`, `roll.team`, `roll.simInput` [structural / 8], `roll.sim`, `roll.strategy`, `plan.progress`) x 3 planos = 47 fatos, e
`capacity` somada de ~410 entradas (214 dos únicos + 3 x 64 por plano); o peso é dominado por `comps.base` e `plan.tactics.i` (~0,7–1,2 MB por resposta
completa hoje, ver M0), por isso `keep` 4 (hoje o cache da base guarda 12). **Medir** a memória real antes de subir esses tetos.

**Eventos e o que a suíte T6 do M8b deve afirmar** (`recomputed` máximo; corte antecipado pode reduzir). Com `comps.base` ainda monolítico, `gold`, `shop` e `stage` continuam recalculando o
ganho de decisão da base; o ganho do M8b está nos fatos fora dela, no histórico (voltar a um estado visto) e na eliminação do cache manual. A divisão estática/dinâmica de `comps.base` que isola
o ouro e a loja é o M9.

| Evento                              | `set` (entradas que mudam)                        | Recalcula (máx.)                                                                                                                          | Não recalcula                                                                                                      |
| ----------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Rolagem (-2 g, loja nova)           | `gold`, `shop`                                    | `economy.income`, `economy.shopsAhead`, `shop.read`, `comps.base`, `plan.*`, `roll.*`, `contest.alert`, `augments.advice` se mudar a base | `units.*`, `pool.*`, `holdings.*`, `traits.board`, `lobby.*`, `catalog.*`, `economy.levelCost`, `economy.pressure` |
| Só a loja muda (compra 0 g, relida) | `shop`                                            | `shop.read`, `comps.base` (**D1 corrigido**), `plan.*`, `roll.*`                                                                          | `economy.*`, `units.*`, `pool.*`, `holdings.*`, `traits.board`                                                     |
| Compra de campeão                   | `gold`, `bench` ou `players`, `shop`              | acima + `units.*`, `pool.visible/free`, `shop.slotChance`, `holdings.items` (se há itens), `traits.board`, `lobby.contest`                | `catalog.*`, `lobby.threat`, `economy.pressure`, `economy.levelCost`                                               |
| Subir de nível                      | `level`, `xp`, `gold`                             | `shop.model`, `shop.slotChance`, `economy.levelCost`, `comps.base`, `plan.*`, `roll.sim.i` (muda o nível)                                 | `units.*`, `pool.visible`, `holdings.*`, `traits.board`, `lobby.*`                                                 |
| Nova rodada                         | `stage`, `gold`, `shop`, talvez `health`/`streak` | `clock.round`, `economy.*`, `shop.*`, `comps.base` (a rodada está na chave), `plan.*`, `roll.*`                                           | `catalog.*`, `units.*`, `pool.visible`, `holdings.*`, `traits.board`, `lobby.threat`                               |
| Item chega/equipa/passa             | `inventory` ou `players`                          | `holdings.items`, `holdings.byBuild`, `traits.board` (emblema), `comps.base`, `plan.tactics.i`, `plan.progress.i`                         | `pool.*`, `economy.*`, `shop.*`, `roll.sim.i`, `lobby.*`                                                           |
| Rival muda o tabuleiro              | `players`                                         | `rivals.boards`, `pool.visible/free`, `lobby.*`, `economy.pressure` (se muda `weak`), `comps.base`, `contest.alert`, `roll.team.i`        | `holdings.*`, `economy.income`, `shop.model`, `catalog.*`                                                          |
| Perde vida / sequência              | `health`, `streak`                                | `economy.income` (sequência), `economy.pressure`, `roll.strategy.i`                                                                       | **`comps.base`** (vida não está na chave), `plan.tactics.i`, `pool.*`, `holdings.*`                                |
| XP/remover muda                     | `xp` ou `removers`                                | `economy.levelCost`, `plan.tactics.i` (remover), `roll.strategy.i`                                                                        | `comps.base`, `pool.*`, `holdings.*`                                                                               |
| Escolhe aprimoramento               | `augments`, `augmentTraits`                       | `traits.board`, `comps.base`, `augments.advice`, `plan.*`                                                                                 | `economy.*`, `pool.*`, `shop.*`, `holdings.byBuild`                                                                |
| Meta renova                         | `metaComps`/`metaBuilds`/`stats`...               | `catalog.champions` (roles), `holdings.byBuild`, `comps.base`, `plan.*`, `augments.advice`                                                | `economy.*`, `pool.*`, `shop.*`, `units.*`                                                                         |
| Volta a um estado já visto          | qualquer                                          | nada (histórico): `hits` em vez de `computes` (ex.: ouro 54 -> 52 -> 54)                                                                  | tudo                                                                                                               |

**Ordem de trabalho do M8b (sub-passos, cada um com a suíte verde).**

1. Fatos puros pequenos (`economy.*`, `shop.*`, `pool.*`, `holdings.*`, `traits.board`, `lobby.*`, `clock.round`) criados como `defineFact` chamando as funções do núcleo que M2-M7 entregaram; o
   `server`/harness ainda calcula como hoje e uma comparação lado a lado afirma que o fato = a função (golden idêntico).
2. `comps.base` com **todas** as entradas declaradas (lista da tabela, derivada do teste D1 de `tests/architecture.test.mjs`, que já enumera o que o motor lê). **Muda número** (D1): a loja entra na
   chave; o diff esperado é o do cenário `shop-cache-d1` (`scoreParts.shop` e `score` de 3 comps) e deve ser registrado aqui antes de regravar o golden; as duas asserções do teste "D1
   (caracterização)" se invertem e `D1_UNKEYED` é apagada.
3. `roll.sim.i` com `keep: 24` no lugar de `SIMS`; o harness do golden e o servidor passam a chamar o grafo; `analysis-keys.mjs`, `baseAnalysisCache`, `pendingBase` (mantendo a coalescência de
   análises em andamento no servidor, que é E/S) e `analysisCache` saem; `v2/js/api.js:analysisKey` deixa de replicar a chave (o servidor devolve `baseId`/`rev` a partir de `explain`).
4. Catraca: apagar `manual-memo-key` (5 -> 0) e baixar `unbounded-memo-maps`; teste estático "todo `compute` é função de topo de módulo ou importada" (T7) e **T6** com a tabela de eventos acima
   (`recomputed` por evento, lido de `stats()`); rodar o golden uma vez com `verify: true` apenas em `comps.base` (prova que `analyze` não muta as entradas).
5. Medição (só então): tempo da camada tática num evento de ouro ≤ metade do M0 (critério do M8) e memória do grafo (`capacity` x bytes).

**Riscos e pendências do M8b/M8a.**

- **Mutação de saída.** Hoje `server.mjs` faz `structuredClone(base)` porque `tactics` muta `analysis`. Os fatos devolvem referências compartilhadas do histórico: `plan.tactics.i` precisa ser
  imutável (ou continuar clonando a entrada) antes de ligar `verify`; o motor de comps ainda não foi testado com saída congelada.
- **Entradas por referência.** `set` confia em que a mesma referência não foi mutada; os adaptadores do `app/state` devem entregar objetos novos (estado imutável, M7).
- **Hash não criptográfico.** 106 bits bastam para o histórico de dezenas de entradas; não usar como identidade de segurança. Se o custo de resumir `players` (~dezenas de KB) a cada leitura aparecer
  na medição, a referência igual já é atalho; o `rev` do estado (M7) pode substituir o resumo por um contador.
- **`getters` e classes.** `canonical` resume por propriedades próprias enumeráveis (objetos de classe valem como simples); funções, símbolos, `Promise` e ciclos são recusados com o caminho.
- **O teto de linhas do `server.mjs` (D12) e a lista de exceções T2 podem ter mudado** por outros agentes entre esta escrita e a execução; reler `ARCH_REPORT=1` antes de ajustar números.
- **Não verificado em execução.** Tudo acima é leitura e simulação mental; o primeiro `node --test tests/core-graph.test.mjs` pode acusar erro de digitação nos testes ou no módulo.

### M8b - os fatos do pipeline no grafo (`app/recommend-facts.mjs`); D1 corrigido

**Estado: escrito e conferido SEM executar nenhum teste, golden ou benchmark** (ordem do usuário: a suíte roda uma vez no fim, pelo orquestrador). Dois subagentes revisores (modelo opus, SÓ leitura, nada executado nem editado) rastrearam o código e os testes à mão: um achado bloqueante de teste (a guarda "transcrição fiel" recortava o harness em `runStep`, mas a montagem de `options` está em `assembleStep`), um provável de concorrência (a evidência fixada, acima) e três menores (contagem de planos da análise alterada nos testes T6, um teste de `identity` sem caso de mutação, diagnóstico `base=` por contador global) -- todos corrigidos. O que foi feito
no lugar: `node --check` em tudo o que toquei; revisão linha a linha; um leitor estático, fora do repositório, que reproduz a catraca T1, T2 (40 regras), T3 e
a nova T7 contra a árvore (nenhuma novidade além das 4 exceções de T3 que já existiam); e **uma carga** das entradas reais de 5 cenários do golden
(`shop-cache-d1`, `pinned-comp-swap`, `augments-chosen-offer`, `viewed-rival`, `gold-unknown`) no grafo (`graph.set` com as 40 entradas + os fatos pequenos
`clock.stage`, `economy.shopsAhead`, `level.target`, `traits.grants`, `comps.swapped`, `comps.readingId`: 13-24 ms cada), para provar que nenhuma entrada real é "sem
chave estável". **`analyze`, `tactics`, `stagePlan` e `strategy` NUNCA rodaram pelo grafo**; o primeiro `node --test tests/golden.test.mjs` é a primeira execução de
verdade. Sem commit; o servidor da 3218 não foi tocado nem consultado.

**Arquivos.**

| Arquivo                                                                                                                     | O que é                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/recommend-facts.mjs` (novo)                                                                                            | Os 18 fatos do pipeline, `GRAPH_INPUTS` (40 entradas), `baseOptions` (o `options` do motor montado SÓ com as entradas declaradas de `comps.base`), `recommendValues` (traduz o `options` do pipeline e as cópias de meta em entradas), `bindRun` (cada leitura faz `graph.set(tudo)` + `graph.get` no mesmo trecho síncrono; o erro do motor chega sem o embrulho `COMPUTE_FAILED`), `composeAnalysis` (cópia mutável do fato para o resto do pipeline), `computeCounts`/`recomputedText` (o `fatos=` do `TEMPO`) |
| `roll-sim.mjs` (novo)                                                                                                       | `roll.sim` (a simulação de rolagem do time) como fato, com `keep` 24 como o `SIMS` que substitui, num grafo próprio e pequeno (`strategy()` monta o time por dentro: não dá para depender dos outros fatos sem partir `strategy`); `roll.mjs` só chama `simulate`                                                                                                                                                                                                                                                 |
| `app/recommend.mjs`                                                                                                         | O pipeline lê a base, a tática e os planos pelos fatos. Saem `analysisCache`, `baseAnalysisCache`, `pendingBase`, `cacheKey`, `baseKey`, `evidenceVersion` como chave, o `structuredClone` da base, a montagem de `options.metaComps/metaBuilds/metaRoles/metaLabel/stats/itemStats/baseAvg/augment*/conditional/evidence/goalComp/stickyCompId` e o laço de planos (681 linhas; eram 771)                                                                                                                        |
| `core/state/snapshot-identity.mjs` (novo)                                                                                   | `snapshotIdentity` (o que a análise lê do snapshot: era o recheio de `snapshotSignature`) e `snapshotSignature` (o resumo estável, agora sem `node:crypto`)                                                                                                                                                                                                                                                                                                                                                       |
| `core/graph/graph.mjs`                                                                                                      | Entrada com `identity: (valor) => projeção`: a chave da entrada é a da projeção e o fato continua recebendo o valor inteiro (o snapshot é regravado a cada segundo e tem as peças em ordem solta)                                                                                                                                                                                                                                                                                                                 |
| `engine.mjs`                                                                                                                | Uma linha: `options.shopsAhead ?? shopsAhead(options.gold)` (a base declara as lojas ao alcance, não o ouro; quem chama o motor direto continua passando `gold`)                                                                                                                                                                                                                                                                                                                                                  |
| removidos                                                                                                                   | `analysis-keys.mjs`, `tests/analysis-keys.test.mjs` (o que testavam foi para `tests/snapshot-identity.test.mjs` e `tests/recommend-graph.test.mjs`)                                                                                                                                                                                                                                                                                                                                                               |
| `server.mjs`, `scripts/bench-state.mjs`                                                                                     | Só o import de `snapshotSignature` (agora `core/state/snapshot-identity.mjs`); `server.mjs` segue em 886 linhas (teto D12 = 900)                                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/golden/harness.mjs`, `tests/golden.test.mjs`                                                                         | O harness usa os MESMOS fatos (`assembleStep` + `bindRun`); `newRun(..., { fresh, overrides })`; o teste D1 do golden foi invertido; a guarda "transcrição fiel" confere a ordem das chamadas no servidor E no harness                                                                                                                                                                                                                                                                                            |
| `tests/architecture.test.mjs`                                                                                               | D1 novo (espião no lugar de `comps.base`), T7 novo, regra T2 `base-cache-resurrection`, baselines abaixados, `roll-sim.mjs` em `CORE_CANDIDATES`                                                                                                                                                                                                                                                                                                                                                                  |
| `tests/recommend-graph.test.mjs` (novo, 24), `tests/snapshot-identity.test.mjs` (novo, 3), `tests/core-graph.test.mjs` (+2) | ver "Testes"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `README.md`, `core/README.md`, `scripts/bench.mjs` (comentários), `analysis-worker.mjs` (comentário)                        | texto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Os fatos.** Entradas = o que a função lê (a função só enxerga o declarado). `cutoff` estrutural salvo indicação; entre colchetes o `keep`. Capacidade somada do grafo do
pipeline: 142 entradas (mais 24 do `roll.sim`).

| Fato                                  | Entradas declaradas                                                                                                                                                                                                                                                                                                                                                      | Substitui                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `clock.stage` [8]                     | `stage`                                                                                                                                                                                                                                                                                                                                                                  | o motor só lê `options.stage?.stage` (a rodada dentro do estágio não refaz a base)                                                        |
| `catalog.traits` [2, key]             | `catalog`                                                                                                                                                                                                                                                                                                                                                                | `traitBook(catalog)` por chamada                                                                                                          |
| `traits.grants` [8]                   | `catalog.traits`, `chosen`                                                                                                                                                                                                                                                                                                                                               | `options.augmentTraits/ById/Emblems` montados no servidor e no harness (M9 slice)                                                         |
| `economy.shopsAhead` [16]             | `gold`                                                                                                                                                                                                                                                                                                                                                                   | `shopsAhead(options.gold)` dentro do motor (agora entra por `options.shopsAhead`)                                                         |
| `level.target` [8]                    | `snapshot`, `playerId`, `level`, `gold`, `targetLevel`                                                                                                                                                                                                                                                                                                                   | `suggestTargetLevel` inline do pipeline (`{ level, reasons, auto }`)                                                                      |
| `level.targetLevel` [8]               | `level.target`                                                                                                                                                                                                                                                                                                                                                           | só o número (os motivos citam o ouro em texto e não devem refazer a base)                                                                 |
| `comps.swapped` [4]                   | `metaComps`, `compSwaps`                                                                                                                                                                                                                                                                                                                                                 | as trocas do usuário aplicadas às comps de meta (duplicado em servidor e harness)                                                         |
| **`comps.base`** [4, key]             | `snapshot`, `catalog`, `playerId`, `bench`, `hidden`, `inventory`, `bankRead`, `level`, `previewIds`, `goalCarryId`, `sticky`, `holdPlan`, `augments`, `chosen`, `clock.stage`, `level.targetLevel`, `traits.grants`, `comps.swapped`, **`economy.shopsAhead`, `shop`**, `metaBuilds`, `metaRoles`, `itemStats`, `boardStats`, `augmentStats`, `evidence`, `conditional` | `engine.analyze` + `baseInputs` + `baseAnalysisCache` + `pendingBase` (D1 e D11)                                                          |
| `comps.readingId` [16]                | as de estado acima (sem a loja, a evidência, as lojas ao alcance) + `gold` + `metaDates`                                                                                                                                                                                                                                                                                 | o `baseId` de `planState.track`                                                                                                           |
| `tactics.analysis` [4, key]           | `comps.base`, `catalog`, `metaRoles`, `viewedPlayerId`, `boardStats`, `metaBuilds`, `inventory`, `metaLabel`, `side`, `removers`, `hasRemover`, `previewIds`, `goalCarryId`, `goal`, `goalCompId`, `goalSwaps`, `comps.swapped`                                                                                                                                          | `structuredClone(base)` + `tactics` + a comp fixada (`goalIds`, `goal`, `autoSwaps`, `preview.flex`, emblema e evidência do plano fixado) |
| `plan.stage.0..3` [8]                 | `tactics.analysis`, `catalog`, `level`, `gold`, `stage`, `shop`, `metaBuilds`, `inventory`                                                                                                                                                                                                                                                                               | `stagePlan` por plano                                                                                                                     |
| `plan.strategy.0..3` [8]              | `tactics.analysis`, `plan.stage.K`, `level`, `gold`, `stage`, `streak`, `trend`, `xp`, `levelEstimated`, `traits.grants`                                                                                                                                                                                                                                                 | `strategy` por plano                                                                                                                      |
| `roll.sim` [24, key] (`roll-sim.mjs`) | `level`, `denom`, `targets`                                                                                                                                                                                                                                                                                                                                              | `SIMS` (`JSON.stringify([nível, denom, alvos])`)                                                                                          |

**Decisões e diferenças de comportamento (cada uma justificada).**

1. **D1 corrigido por construção.** A loja é entrada de `comps.base`; o motor a lê (`shopHits` -> `compScore`) e a chave antiga não a tinha. O teste de arquitetura D1 lê o `options` que o motor recebe e
   exige que tudo o que ele lê seja declarado pelo fato (a exceção `D1_UNKEYED` foi apagada). **Muda número** em `shop-cache-d1` passo 3 (abaixo).
2. **O ouro entra na base só como lojas ao alcance e como nível-alvo.** O motor usa o ouro em um único lugar (`shopsAhead`) e o nível-alvo automático usa o ouro em `suggestTargetLevel`; os dois são fatos. Efeito:
   mudar o ouro sem mudar as lojas ao alcance nem o nível-alvo (54 -> 55 g) **não refaz a base** (antes refazia). O resultado é o mesmo número; só o custo muda. Um teste (T6 "ouro +1") fixa isso.
3. **`baseId` = `comps.readingId`**, com o mesmo recorte do `baseInputs` antigo (sem a loja nem a evidência, COM o ouro de verdade). Por isso a leitura do desafiante em `planState.track` conta como antes: trocar só a loja
   não é uma leitura nova. (Se o `baseId` mudasse com a loja, `shop-cache-d1` passo 3 contaria uma leitura a mais do desafiante e mudaria `planProgress`.)
4. **O plano mantido (`sticky`) entra INTEIRO** (id, peças, carry, título, núcleo, trunfo), não só `id` e `units` como na chave antiga: o motor lê todos esses campos. No golden isso pode mudar o passo 3 de
   `shop-cache-d1` além do efeito D1 (o `track` do passo 2 pode ter atualizado `title/core/asset` do plano mantido). Ao vivo, uma base a mais depois de cada atualização do plano mantido.
5. **`analysisCache` saiu** (o cache da resposta inteira por `JSON.stringify(options)`). A camada por chave de análise do M10b (`results`) cobre os pedidos "simples"; um pedido repetido idêntico que não é "simples" (rever
   partida, consultar rival) agora refaz só os passos do fim (`planState.track`, aprimoramentos, disputa), que são baratos e idempotentes para o mesmo `baseId`; a base, a tática e os planos vêm do histórico.
6. **`pendingBase` saiu.** Duas análises iguais em andamento não compartilham mais a MESMA espera de rede, mas o histórico do grafo dá a segunda a base da primeira assim que existir, e o cliente do explorer já compartilha
   as perguntas abertas (`inflight`). A coalescência de pedidos iguais continua em `results.run(uiKey)`.
7. **Evidência.** Os mapas do explorer seguem mutáveis no pipeline; o grafo recebe CÓPIAS, refeitas só quando `evidenceVersion` muda (as entradas do grafo são imutáveis; a referência igual é atalho). Uma base com
   perguntas ainda abertas (parou no 3º passe ou no teto de espera) agora fica no histórico (antes não era guardada); a leitura seguinte a reencontra, pergunta o resto e refaz com a evidência nova. Cada mudança de evidência
   custa uma cópia de ~6,7 mil entradas e o resumo delas (~15-30 ms, estimado). **A tática e os planos partem da evidência que a ÚLTIMA leitura da base usou** (fixada ao fim de `settleEvidence`): depois da base há `await`s (a vaga, o loop cedido entre os planos) em que a evidência pode mudar por outra análise, por perguntas que o teto de espera deixou abertas ou pela limpeza de 10 min; sem fixar, `comps.base` seria refeito no meio do laço de planos e o campo/estratégia de uma tática seriam colados em planos de outra (achado de uma revisão só-leitura, corrigido).
8. **Tática e planos por fato, e duas cópias.** `tactics.analysis` clona a base dentro do fato (como o servidor fazia por resposta); `composeAnalysis` faz a SEGUNDA cópia (a da análise que o resto do pipeline altera),
   porque os fatos memoizados não podem ser mutados por `track`, `augmentAdvice`, `contestAlert` nem pelo overlay. O custo extra de uma cópia por resposta é aceito nesta etapa e some quando a tática passar a devolver dados imutáveis (M9/M10).
9. **`signature` do `/api/state` mudou de formato** (de SHA-1 de 16 hex para o resumo estável do grafo). É texto opaco que entra na chave de análise do cliente.
10. **O erro do motor chega com a mensagem de sempre** ("Selecione o seu jogador.", "Não há N campeões distintos..."): `bindRun` desembrulha o `COMPUTE_FAILED`. Um teste fixa isso.
11. **`TEMPO`.** A linha de etapas ganhou ` fatos=comps.base,tactics.analysis,plan.stage.0x3,...` (só o que recalculou nessa análise, pela diferença de `computes` do grafo; nada é zerado, várias análises dividem o grafo).
    `base=nova|cache` agora vem da diferença de `computes` de `comps.base` na leitura da própria análise (sem `await` no meio, então exata); `fatos=` é aproximado (inclui o que outra análise em andamento recalculou no mesmo intervalo). Etapas: `estado entrada base fila tactics planos plano resto` (`clone` saiu; o clone está em `tactics` e `planos`).
12. **Quantização da chance de montar: NÃO feita** (decisão do usuário: só se o backtest mostrar que o ranking não piora). Fica registrada como opção para depois: `economy.shopsAhead` é o ponto natural (a base deixaria
    de refazer a cada 2 g de ouro se o fato devolvesse degraus de lojas ao alcance).

**Golden: antes/depois (esperado; NÃO executado).**

| Arquivo                                                                               | Esperado                               | Por quê                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| os outros 16 cenários (inclusive `plan-sequence`, de 3 passos) e `synthetic-strategy` | **idêntico** ao estado anterior ao M8b | os fatos chamam as mesmas funções com as mesmas entradas; a base e o `baseId` só mudam de chave, não de valor. A carga das entradas confirmou os valores de `economy.shopsAhead` (45; 29 sem ouro lido), `level.target` e `traits.grants`                                                                                                                                                                                                                                                                                                                                                                  |
| `shop-cache-d1`, passo 3                                                              | **muda**                               | a 3ª leitura troca só a loja: antes repetia o `compRanking` do passo 2 (base do cache sem a loja); agora a base é refeita com a loja nova. Diff esperado: `compRanking[*].scoreParts.shop` e `score` das comps cujas peças aparecem na loja nova (antes 0 de loja ou a loja velha); em cascata, o que depende do ranking (`recommendations[*].evidence`, a ordem entre comps próximas, `stage.shop`/`buyNow` já eram novos). Se a ordem das 3 recomendações mudar, o `planProgress`/`challenger` do passo 3 também pode mudar. Se aparecer diferença no `title/core/asset` do plano mantido, é a decisão 4 |
| `shop-cache-d1`, passos 1 e 2                                                         | idênticos                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Os dois testes "D1" foram invertidos: o do golden agora exige `cached[2].compRanking != cached[1].compRanking` e `cached == fresh` (sem histórico do grafo, o mesmo resultado); o de arquitetura exige que o motor só leia o declarado.
Qualquer diferença fora do passo 3 de `shop-cache-d1` é defeito do M8b, não esperado.

**Catraca.**

| Regra                                             | Antes                                                        | Depois                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2 `manual-memo-key`                              | 5 (engine 1, roll 1, recommend 3)                            | **1** (`engine.mjs`: `planMemo`, o memo do plano de itens DENTRO de `analyze`, por tabuleiro candidato; só vira fato quando `analyze` for dividido, M9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| T2 `unbounded-memo-maps`                          | 10 (engine 2, evidence 1, item-value 3, roll 1, recommend 3) | **6** (engine 2 e item-value 3 são memos por chamada, sem chave a invalidar; evidence 1 é E/S real)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| T2 `server-option-assembly` (`app/recommend.mjs`) | 33                                                           | **17**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T2 `base-cache-resurrection` (nova)               |                                                              | baseline vazio: `analysisCache`, `baseAnalysisCache`, `pendingBase`, `baseInputs`, `baseKey` e `analysis-keys` não voltam                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T7 (nova)                                         |                                                              | todo `defineFact` é a `const` da raiz com `compute` nomeado da raiz; sem `let`/`var`/`Map`/`Set` na raiz; sem `Date`, `performance`, `process`, `fetch`, `await`, `async`, `Math.random` nos arquivos de fatos (`app/recommend-facts.mjs`, `roll-sim.mjs`, `core/facts/*`); as funções de fato da raiz não citam `graph`, `view`, `deps`, `options`, `globalThis`, `window`, `document` nem `localStorage` (o limite apontado no M8a: um `compute` que lê nome de fora; as 6 funções que ligam o grafo ao pipeline ficam numa lista). **Limite que sobra:** é uma leitura de texto, não uma análise de escopo: um `compute` que citasse uma `const` da raiz com dado mutável passaria (mas T7 já proíbe `let`/`var`/`Map`/`Set` na raiz, e o modo `verify` do grafo pega a mutação em execução) |
| T3 `CORE_CANDIDATES`                              |                                                              | `roll-sim.mjs` entra (puro; importa só `core/graph` e `economy.mjs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D1                                                | exceção `D1_UNKEYED` (a loja)                                | **apagada**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Testes (escritos por leitura, NÃO executados).**

- `tests/recommend-graph.test.mjs` (24): estrutura (18 fatos, ids únicos, a loja é da base e não da tática, a tática não lê ouro/loja/XP); cada fato pequeno contra a função do núcleo (`shopsAhead`, `suggestTargetLevel`,
  `traitBook().grants`, as trocas); **T6** sobre dados reais do golden, com os mesmos conjuntos da tabela abaixo; `composeAnalysis` não suja o fato; o erro do motor sem embrulho; `recomputedText`; `roll.sim` = `rollSim`.
- `tests/snapshot-identity.test.mjs` (3) e 2 testes de `identity` em `tests/core-graph.test.mjs`.
- `tests/architecture.test.mjs`: D1 (espião), T7, `base-cache-resurrection`. `tests/golden.test.mjs`: guarda "transcrição fiel" (servidor e harness) e D1 invertido.

**T6: o que recalcula por evento** (conjuntos que `tests/recommend-graph.test.mjs` afirma; "planos" = `plan.stage.K` e `plan.strategy.K` dos planos que existem).

| Evento (entradas que mudam)                             | Recalcula                                                                                         | Não recalcula                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| XP                                                      | só `plan.strategy.K` (igualdade exata)                                                            | base, tática, `plan.stage.K`                                                                             |
| Sequência de derrotas                                   | só `plan.strategy.K` (igualdade exata)                                                            | idem                                                                                                     |
| Removedor / jogador consultado                          | `tactics.analysis` + planos (igualdade exata)                                                     | a base                                                                                                   |
| Só a loja (D1)                                          | `comps.base`, `tactics.analysis`, planos                                                          | `economy.shopsAhead`, `level.target`, `clock.stage`, `traits.grants`, `comps.swapped`, `comps.readingId` |
| Rolagem (-2 g)                                          | `economy.shopsAhead`, `level.target`, `comps.base`, `comps.readingId`, `tactics.analysis`, planos | `clock.stage`, `catalog.traits`, `traits.grants`, `comps.swapped`                                        |
| Ouro +1 (mesmas lojas ao alcance e mesmo alvo)          | `economy.shopsAhead` (corte), `comps.readingId`, planos                                           | **`comps.base`, `tactics.analysis`**                                                                     |
| Subir de nível                                          | `level.target`, `comps.base`, `comps.readingId`, `tactics.analysis`, planos                       | `economy.shopsAhead`, `clock.stage`, `traits.grants`, `comps.swapped`                                    |
| Rodada dentro do estágio                                | `clock.stage` + planos (igualdade exata)                                                          | `comps.base`, `comps.readingId`, `tactics.analysis`                                                      |
| Estágio novo                                            | `clock.stage`, `comps.base`, `comps.readingId`, `tactics.analysis`, planos                        | `economy.shopsAhead`, `level.target`, `traits.grants`                                                    |
| Troca de plano (comp fixada)                            | `comps.base`, `comps.readingId`, `tactics.analysis`, planos                                       | `economy.shopsAhead`, `level.target`, `clock.stage`, `traits.grants`, `comps.swapped`                    |
| Aprimoramento escolhido                                 | `traits.grants`, `comps.base`, `comps.readingId`, `tactics.analysis`                              | `economy.shopsAhead`, `level.target`, `catalog.traits`, `comps.swapped`                                  |
| Trocas do usuário no automático                         | `comps.swapped`, `comps.base`, `comps.readingId`, `tactics.analysis`                              | `economy.shopsAhead`, `level.target`, `traits.grants`                                                    |
| Evidência nova do explorer                              | `comps.base`, `tactics.analysis`                                                                  | `comps.readingId`, `economy.shopsAhead`, `level.target`, `traits.grants`                                 |
| Cópia de meta com o mesmo conteúdo (referência nova)    | nada                                                                                              | tudo                                                                                                     |
| Voltar a um estado já visto (ouro 54 -> 48 -> 54 -> 48) | nada na 2ª ida (histórico)                                                                        | tudo                                                                                                     |

**O que não foi feito (e por quê).**

- **Fatos "itens por localização", "cópias livres/pool" e "chance por slot/loja" como fatos separados.** Hoje nascem DENTRO de `analyze` (fechamentos sobre `own`, `visible`, `held`, `denomByCost`) e são consumidos por `stage`/`strategy` através de `analysis.pool`;
  tirá-los de lá é partir `analyze` (M9). Tirá-los agora criaria fatos que ninguém lê. Os fatos de base de baixo risco que TÊM consumidor foram feitos: sinergias/emblemas (`catalog.traits`, `traits.grants`), orçamento de ouro (`economy.shopsAhead`),
  nível efetivo/alvo (`level.target`, `level.targetLevel`), estágio (`clock.stage`) e trocas (`comps.swapped`).
- **`lobby.*`, `economy.pressure/levelCost`, `holdings.*`, `augments.advice`, `contest.alert`, `plan.progress`**: idem, ainda dentro de `stage`/`strategy`/`engine`/`augmentAdvice`/`contestAlert` (M9).
- **`comps.base` segue monolítico**: a vida mora no snapshot (como na assinatura antiga), então perder vida refaz a base, e o isolamento do ouro e da loja da parte estática do motor (`staticFit` x `dynamicChance`) é o M9. O ganho do M8b está no histórico, na camada
  tática/planos fora da base, no corte antecipado (ouro +1) e na ausência de chaves à mão.
- **`verify: true`** (o modo de teste do grafo que roda cada fato duas vezes, congela a saída e confere que as entradas não mudaram) **não foi ligado nem rodado** em `comps.base`; é o próximo passo de verificação (ver pendências).
- **Quantização** (item 12 acima).
- **Resposta tática imediata / só o plano exibido** (M10).

**Riscos e pendências.**

1. **Primeira execução.** Tudo acima é leitura. O primeiro `node --test tests/recommend-graph.test.mjs tests/golden.test.mjs tests/architecture.test.mjs` pode acusar erro de digitação ou uma suposição minha errada; se o T6 falhar, confira primeiro a dependência declarada do fato.
2. **Mutação de entradas/saídas.** O motor, `tactics`, `stagePlan` e `strategy` não foram provados imutáveis em execução (li o código: `stagePlan` e `strategy` não mutam o `analysis` nem o plano; `tactics` muta só a cópia que o fato faz). Rodar uma vez o golden com
   `createRecommendGraph({ verify: true })` (o harness aceita `overrides`/opções do grafo) prova isso; `verify` congela a saída (deepFreeze) e acusa `IMPURE`.
3. **Memória.** `comps.base` guarda 4 bases (~1 MB cada com o ranking de comps) e `tactics.analysis` 4 análises (~0,5 MB cada, o ranking é compartilhado); antes o cache da base guardava 12. Medir RSS ao vivo antes de subir os tetos.
4. **Custo por leitura.** `bindRun` reafirma 40 entradas a cada `get`; só as que mudaram de referência são resumidas (o snapshot, a evidência quando muda, os arrays pequenos). Se o `TEMPO` mostrar peso, o `rev` do estado (M7) pode substituir o resumo do snapshot.
5. **`structuredClone` do `composeAnalysis`** exige que a saída da tática e dos planos não tenha funções (a chave Symbol que `strategy` usa entre `decide` e `settle` é ignorada pelo clone). Se um dia alguém puser função na resposta, o erro é `DataCloneError` com o caminho.
6. **Interferência entre análises.** O grafo é um só e as análises se intercalam nos `await`: cada trecho síncrono reafirma as entradas, então o resultado é correto, mas duas análises com entradas diferentes que se alternam fazem o grafo "vai e volta" (o histórico absorve; custa o resumo do que mudou).
7. **Reiniciar o servidor da 3218** para a mudança valer ao vivo (não reiniciei).
8. `tests/golden/harness.mjs` ainda é uma transcrição do trecho de `app/recommend.mjs` que depende de estado do servidor (a guarda confere a ordem nos dois); o M9 a elimina com o pipeline único.

### Correção pontual de carga ao vivo (antes do M10b)

Origem: `planos/feitos/lentidao-ao-vivo.md` (seção "Correções aplicadas" lá). **Escrita e checada só com `node --check` e leitura; NADA foi executado**
(nem suíte, nem golden, nem benchmark, por ordem do usuário). Seis edições mínimas; não muda a ordem das etapas do pipeline nem o motor, a tática ou
os planos; o golden tem pipeline próprio (`tests/golden/harness.mjs`) e **não deve mudar**.

| #   | Mudança                                                                                                                                                                                                                                                                                                                            | Arquivos                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Instrumentação: linha `TEMPO carga:` por janela de ~1 min (atraso do loop p50/p99/máx via `monitorEventLoopDelay`, CPU %, heap, rss, gravações do cache de evidência); na linha de etapas do `POST`: `analise= rede= passes= perguntas= teto=` (CPU de `analyze` x espera de rede, só em quem criou a base) e a nova etapa `fila=` | `app/live-load.mjs` (novo), `server.mjs`, `evidence.mjs` (`takeStats`), `scripts/timing-report.mjs` (imprime a carga) |
| 2   | `evidence-cache.json`: gravação espaçada (mín. 30 s entre gravações, a 1ª pergunta nova agenda com mín. 2 s) e serialização em fatias de 1.000 entradas cedendo o loop (`setImmediate`); mesma escrita atômica (`.tmp` + rename) e mesmo texto de antes; `flush()` para teste/encerramento                                         | `evidence.mjs`                                                                                                        |
| 3   | Cache de capturas: só a partida corrente fica no Map; as anteriores vão para `evicted` e, se alguém as pedir (rever partida), são relidas do arquivo (`scanGame`, 1 vaga `pinned`); linhas tardias de partida já descartada são ignoradas (nunca fica parcial)                                                                     | `replay.mjs`                                                                                                          |
| 4   | O `POST` cede o loop (`setImmediate`) depois da base, depois do clone, depois de `tactics`, a cada plano do laço de planos e antes do `JSON.stringify`; uma vaga FIFO (`turnLock`) mantém a ordem das análises (plano em andamento, sequências) como era                                                                           | `app/live-load.mjs`, `server.mjs`                                                                                     |
| 5   | `structuredClone` sem `compRanking` (~580 KB): segue por referência. Provado por leitura (abaixo)                                                                                                                                                                                                                                  | `server.mjs`                                                                                                          |
| 6   | Teto de espera de rede por análise nova: 15 s no total (`TFT_EVIDENCE_BUDGET_MS`; era 3 x 30 s) e 15 s por pergunta (era 30 s). Com tudo em cache o laço nem começa e nada muda                                                                                                                                                    | `app/live-load.mjs` (`settleEvidence`), `evidence.mjs`, `server.mjs`                                                  |

**Prova do item 5 (ninguém muta `compRanking`).** `compRanking` é montado em `engine.mjs` (`compRanking = [...ranked].sort().map(...)`) e só é
lido depois: `server.mjs` (`.find` da comp fixada e `contestAlert({ranking})`, que só filtra/mapeia e ordena cópias), `contest.mjs` (sem mutação). Busca
por `compRanking`/`ranking` em `tactics`, `stage`, `strategy`, `plan-state`, `plan-progress`, `augment-advice`: **nenhuma ocorrência**. O objeto também
era compartilhado por referência com `recommendations[i].evidence` dentro do clone antigo; nada escreve em `evidence`/`itemPlan`/`itemHoldings`/`emblem`
depois da análise (só `plan-state` lê `top.evidence?.switch`), então separar o clone não muda o que a tela vê. `analysisCache`/`baseAnalysisCache`
passam a guardar a mesma lista em várias respostas: se alguém passar a mutá-la, vai corromper o cache (M9 deve congelá-la em `verify`).

**Riscos e decisões (modo conservador).**

- **Ranking pode variar entre leituras (item 6).** Passados 15 s, a análise segue com a evidência que chegou e **não é guardada** (há perguntas abertas);
  as perguntas continuam em `inflight` e entram no cache para a leitura seguinte, que refaz a base completa. Na prática: no frio, a 1ª leitura pode mostrar
  um ranking com menos medições e a seguinte corrige. Com o cache quente (o caso normal) não há diferença. `TFT_EVIDENCE_BUDGET_MS=3600000` desliga o teto.
  Um timeout de pergunta menor também grava `null` (nova tentativa só em 10 min) mais cedo numa rede lenta; por isso 15 s e não 8-10 s.
- **Perda de cache numa queda (item 2).** Até 30 s de respostas novas do explorer podem se perder se o processo morrer; elas voltam a ser perguntadas.
- **Ordem entre `POST`s (item 4).** A vaga é pedida depois da base e solta em `finish`/`close` da resposta (com guarda de 60 s). Dois `POST`s iguais em fila
  repetem o trabalho em vez de um acertar o cache do outro (não reconsultei `analysisCache` na fila: a catraca `manual-memo-key` conta cada `analysisCache.get(cacheKey)`). Um `updateStats`
  no meio da fila limpa os caches e a análise em curso ainda guarda a resposta com a chave antiga (a janela já existia durante a espera de rede).
- **Cache de capturas (item 3).** O arranque ainda parseia o arquivo inteiro uma vez (342 ms medidos; só a memória baixa, 18,7 MB, não esse tempo). Rever uma partida
  antiga relê o arquivo (~100-350 ms) uma vez e a mantém na vaga `pinned`; se a partida descartada receber linhas depois (dois processos gravando, o caso dos
  órfãos), a cópia `pinned` pode ficar defasada até a próxima troca.
- **`server.mjs`: 1.381 linhas** (teto D12 = 1.394; M7 também editou o arquivo). A lógica nova mora em `app/live-load.mjs`; o servidor só liga.
- Catraca T2: não criei `options.X =`, nem `*Cache = new Map`, nem `.get(...Key...)`; `evidence.mjs` segue com 1 `new Map` de cache. Não rodei `ARCH_REPORT=1`.

**Testes novos (não executados).** `tests/live-load.test.mjs` (8): `settleEvidence` (sem perguntas, 3 rodadas, teto de espera, orçamento já gasto), `turnLock`
(FIFO, idempotente, guarda de tempo), `yieldToLoop`, `loadProbe` e `explorer` (gravação atômica com `flush`, mesmo JSON, estatística, cache quente). Em
`tests/contest-replay.test.mjs`: "capturas: só a partida corrente fica em memória" (descarte, releitura sob demanda, crescimento do arquivo).

**Por medir (rodada final, com o orquestrador).** Linhas `carga:` e `analise/rede/fila` do `server.log` numa partida real
(`node scripts/timing-report.mjs`): atraso do loop antes/depois, `GET /api/state` p95, `base` p95 (esperado: sem os picos de 24-79 s) e
`gravou=/ms=` do cache; `tests/live-load.test.mjs` e `tests/contest-replay.test.mjs`; suíte inteira; golden sem diff; `ARCH_REPORT=1`.

### M10a - thread de análise (infraestrutura, sem religar o servidor)

**Estado: escrito e checado só com `node --check` e leitura; NADA foi executado** (nem a suíte, nem o golden, nem benchmark, por ordem do
usuário; o orquestrador roda no fim). `server.mjs`, `engine.mjs` e `strategy.mjs` não foram tocados; nenhum arquivo existente do produto mudou. O
M10b (religar) vem depois de M7/M8.

**Arquivos novos.**

| Arquivo                                     | Papel                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analysis-protocol.mjs`                     | Contrato puro (sem `node:*`, sem relógio): tipos de mensagem, `freshness`, `markBase`/`appendFields`, `analysisEvent`, `summarize`, `errorInfo`                                                                               |
| `analysis-worker-entry.mjs`                 | Lado da thread: `serveAnalysis({ port, pipeline, init })` (o mesmo código roda numa porta falsa nos testes) e o arranque em `worker_threads`                                                                                  |
| `analysis-worker.mjs`                       | Lado do servidor: `createAnalysisWorker({ spawn, ... })` (fila, coalescência, timeout, reinício, métricas) e `workerSpawner({ pipeline, init })` (cria a thread real)                                                         |
| `tests/analysis-worker.test.mjs`            | 22 testes: protocolo da thread, coalescência, ordem, métricas, resposta imediata, chave repetida, cancelamento, timeout, queda, limite de reinícios, init que falha, fechar, contrato puro, 3 com `worker_threads` de verdade |
| `tests/fixtures/analysis-fake-pipeline.mjs` | Pipeline falso para as threads reais (`echo`, `raw`, `spin`, `exit`, `throw`)                                                                                                                                                 |

**O pipeline é um módulo injetado** (nada do motor entra aqui):
`export async function init(initData) -> state` (opcional) e
`export async function run({ id, payload, context, ctxRev, state, signal, lap, sideband }) -> string | object`. Devolver `string` = já é o JSON; objeto é
serializado **dentro da thread** (a serialização de 12-97 ms offline, até 1 s ao vivo, sai do event loop). O resultado volta como `ArrayBuffer`
**transferido** (sem clone); `lap("etapa")` alimenta as métricas por etapa; `sideband(valor)` entrega um dado pequeno ao lado (ver a integração);
`signal.aborted` é o cancelamento cooperativo.

**Política da fila (decidida e testada).**

1. Um pedido ativo por vez e **no máximo um esperando**. Chegou outro com um rodando e outro esperando: o que esperava termina `superseded` (com `successor`) e só o mais
   recente roda depois. `resolve(ticket)` segue os sucessores, então quem esperava o pedido substituído recebe o resultado do que o substituiu.
2. O pedido em execução **não é interrompido** por um mais novo (a análise é síncrona e não se interrompe no meio; matar a thread jogaria fora o JIT quente e o estado do pipeline). Só
   `timeout`, `cancel(t, { kill: true })` ou queda a encerram. Terminando, o resultado vale para quem pediu (`obsolete: true` se já chegou leitura mais nova) e vira `latest` só se a
   revisão for maior que a atual (**nunca regride**).
3. `timeout` (padrão 20 s, por execução, contado a partir de `ready`): `worker.terminate()`, pedido `timeout`, thread nova, e o resultado tardio do pipeline velho é descartado (geração da
   thread na mensagem; contador `discardedLate`). Queda (`error`/`exit`, falha em `init`, sem `ready` em 15 s): pedido em execução termina `crashed`, a thread é recriada com **o contexto
   reenviado inteiro**, o que esperava roda nela. O pedido que derrubou a thread **não** é repetido (poderia ser o veneno). Limite de recriações (5 em 60 s, atraso 250 ms dobrando até 5 s):
   passado dele a fila entra em `failed` e os pedidos terminam `unavailable` (o servidor decide: voltar a analisar no processo principal); `reset()` tenta de novo.
4. Cancelamento: esperando sai da fila; rodando termina `cancelled` na hora, o sinal avisa o pipeline e o resultado é descartado **dentro da thread** (mensagem `cancelled`, os bytes nem saem). A vaga só
   libera quando a thread acaba (ou na hora, com `kill`).
5. Nada rejeita: cada pedido termina num `outcome` com `status` entre `ok`, `superseded`, `cancelled`, `timeout`, `crashed`, `error`, `unavailable`, `closed`.
6. Chave de entrada (`submit(payload, { key })`, no servidor: o `cacheKey` do POST de hoje): a mesma chave seguida não é leitura nova; reaproveita o resultado guardado (`cached`) ou o pedido em
   execução (`joined`). Sem chave, cada pedido é uma leitura nova.
7. Contexto estático (`setContext(parts)`): catálogo, meta, estatísticas etc. vão **uma vez por mudança** e o pedido leva só `ctxRev` e um `payload` pequeno. Mudou o contexto: a base guardada **não** serve mais de
   resposta imediata e `cached` não vale (o equivalente de `analysisCache.clear()` / `baseAnalysisCache.clear()` de hoje).

**Contrato da resposta tática imediata (decisão 4 do usuário).** `leitura` = número da leitura de estado do pedido (cresce quando a chave muda). `baseAge = leitura do pedido - leitura da base`.
Cada pedido devolve `ticket = { id, reading, key, done, usable }`:

- `done`: o desfecho da **própria** análise (`stale: false`, `base.baseAge: 0`, `metrics`, `obsolete`, `ctxStale`, `result`).
- `usable`: o primeiro momento em que dá para responder: ou a própria análise, ou a **última base** se `baseAge <= maxBaseAge` (1, por pedido ou global) **e** o mesmo contexto. Vem com `stale: true`,
  `source: "previous"`, `base: { rev, reading, stale, baseAge, ageMs, maxBaseAge }`. Defasagem de 2 leituras **não** responde: espera a leitura anterior terminar (aí passa a ser 1) ou a própria.
- `resolve(ticket, { allowStale = true, graceMs = 0 })`: espera `graceMs` pela própria análise e, se não vier, usa `usable`. `allowStale: false` = esperar a análise completa.
- `responseBytes(outcome)` devolve `{ bytes, base }`: os bytes JSON com o campo `"base": { rev, reading, stale, baseAge, ageMs, maxBaseAge }` acrescentado **sem reparsear** (ageMs calculado na hora de responder). O
  front lê `base.stale`; o campo `base` não existe hoje na resposta (verificado por busca em `engine`, `tactics` e `v2/js`).
- SSE: `onLatest(result)` roda a cada base nova (inclusive de pedidos que ninguém espera mais); o servidor faz `captures.broadcast(analysisEvent(result))` = `{ type: "analysis", rev, reading, key }` e a tela que
  recebeu `stale` busca a atualização. O aviso é pequeno de propósito (não carrega a análise).

**Métricas** (`stats()` e o campo `metrics` de cada `ok`): `queueMs` (do pedido ao despacho), `runMs` (despacho a resultado, relógio do servidor), `workerMs` e `stages` (relógio da thread, com `serializar`), `totalMs`,
`latest.ageMs` (idade da base), contadores (`submitted completed superseded cancelled timeouts crashes errors restarts cached joined discardedLate unavailable`) e p50/p95/máx das últimas 64
execuções. Gancho `onEvent` para o `diag.write` (`spawn ready result superseded timeout crash restart failed`). O relógio (`now`) é injetável.

**Ponto exato de integração no `server.mjs` (M10b; não aplicado).** O POST de hoje (`POST /api/recommend`, de `const stages = (res.stages = stageTimer())` até
`analysisCache.set(cacheKey, ...)` + `return json(200, ...)`, ~470 linhas) se divide pelo que tem **estado/efeito** e pelo que é **função pura**:

| Fica no processo principal (estado, disco, efeito)                                                                                                                                                                                                                                  | Vai para o pipeline na thread (puro, só entra por `payload`/`context`)                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate`, `current()`/`replayState`, `seenState`/GEP, `recommendInventory`, `gepBenchUnits`, `options.shop/xp/stage/augmentIds`, `hiddenHoldings` (lê `scouting-captures.jsonl`), `planState.sticky/holdFor`, `streaks.observe` (efeito), `matches.augments` (efeito), `cacheKey` | `goal`/`goalSwaps`/`previewIds`, `options.metaComps` com as trocas, `suggestTargetLevel`, `analyze` com as passadas de evidência (`conditionalRequests`/`evidenceRequests`), `structuredClone(base)`, `tactics`, `playbook`/`stagePlan`/`strategy`/`teamCode` por plano, `augmentAdvice`, `decide`, `contestAlert`, `viewedBoard` |
| Depois do resultado: `planState.track(...)` (estado em disco), `fs.appendFile(planLog)`, mesclar `planProgress`, `diag`/`TEMPO`, SSE                                                                                                                                                | `JSON.stringify` da resposta (dentro da thread)                                                                                                                                                                                                                                                                                   |

- **Contexto (`setContext`, uma vez por mudança):** `catalog`, `plannerCatalog`, `localNames`, `augmentById`/lista, `meta` (builds, roles, items, label, `fetchedAt`), `metaComps`, `boardStats`, `augmentStats`. Os
  quatro `*.clear()`/atribuições de hoje (`updateMeta`, `updateStats`, `updateAugmentStats`, `updateComps`) viram `worker.setContext({...})`. (`Map` e `Set` são clonáveis.)
- **Payload (por pedido, pequeno):** `snapshot` já com a Luva de Ladrão corrigida, `metadata`, as `options` que vêm do cliente/estado (nível, ouro, `inventory`, `bench`, `shop`, `xp`, `stage`, `augments`/`augmentIds`, `sticky`, `holdPlan`, `streak`, `trend`, `hidden`, `goal*`, `compSwaps`, `previewIds`...) **sem** `metaComps`, `metaBuilds`, `metaRoles`, `metaLabel`, `stats`, `itemStats`, `augmentStats`, `evidence`, `conditional` (esses vêm do contexto). `key` = o `cacheKey`.
- **Evidência:** `evidenceMap`, `conditionalMap`, `evidenceVersion`, `baseAnalysisCache` e `pendingBase` passam a morar **na thread** (o `explorer()` e `data/evidence-cache.json` ficam com um único escritor). A rede do explorer roda na thread (`fetch` existe em `worker_threads`), então
  as até 3 passadas de rede (que chegaram a 73 s ao vivo) deixam de segurar o event loop. A thread invalida a base quando `ctxRev` muda.
- **Efeito pós-resultado:** `planState.track` lê só `analysis.self.units/reserve` e as recomendações `top`/`shown` (verificar de novo no M10b: `buildChecklist` recebe `analysis`); o pipeline os entrega por `sideband({ top, shown, self: { units, reserve }, baseId, chosen })`, o
  principal chama `track`, e `appendFields(bytes, { planProgress: progress })` põe o resultado na resposta sem reparsear. Nenhum consumidor do pipeline (`augmentAdvice`, `decide`, `contestAlert`) lê `planProgress` (verificado por busca).
- **Rota:** `const ticket = analysis.submit(payload, { key: cacheKey })`; `const out = await analysis.resolve(ticket, { graceMs })`; se `out.status === "ok"`: `res.end(analysis.responseBytes(out).bytes)`; senão `500/503` com `out.status` (e `unavailable`/`failed`:
  cair na análise no processo principal, que continua existindo até o M9 mover o pipeline). `/api/state`, SSE e o resto não esperam mais a análise.
- **Cuidado de ordem:** hoje a análise de um POST usa `planState.sticky` no instante da requisição; com a fila, o `payload` carrega o `sticky` lido naquele instante (a leitura seguinte pode lê-lo já mudado por `track`). Isso é a defasagem de uma leitura da decisão 4, só que no plano; o golden precisa de um cenário de 3 leituras em sequência (o `plan-adoption` já existe) rodando pela fila.

**Pendências e riscos do M10a/M10b.**

- **Não executado.** Primeira execução de `node --test tests/analysis-worker.test.mjs` pode acusar erro de digitação nos testes ou no módulo; os 3 testes com `worker_threads` de verdade dependem de timers reais (`timeoutMs: 1500` no laço sem fim) e de a máquina não estar saturada.
- **Catraca:** os arquivos novos estão fora de `core/` e de `CORE_CANDIDATES`; não acrescentam nenhuma regra T2 (evitei os padrões `options.X =`, `*Cache = new Map(`, `pending* = new Map(` etc.). `analysis-protocol.mjs` é puro e poderia ir para `core/` depois (T3) se o front precisar ler `base`.
- **Custo de clonar o `payload`** (snapshot ~dezenas de KB + opções) por pedido não foi medido; se aparecer, o `snapshot` pode ir por `setContext`-like (assinatura) ou como `ArrayBuffer` transferido.
- **Memória:** a thread tem o catálogo/meta em dobro (~10-20 MB estimados, não medido). `resourceLimits` existe em `workerSpawner`.
- **Windows:** `new Worker(URL)` com `file:` href e `import()` do pipeline por `pathToFileURL` (caminho com `C:\`) foi tratado, mas só a primeira execução prova.
- **Tempo de arranque da thread** (carregar o motor + catálogo) entra no 1º pedido depois de cada reinício; `start()` pré-aquece na subida do servidor.
- **O harness do golden** continua sendo cópia do servidor; depois do M10b ele passa a chamar o mesmo pipeline que a thread (um único lugar), e a guarda `golden.test.mjs` x `server.mjs` é religada.

### M10b (fechamento) - análise numa thread, resultado compartilhado e servidor que não para

**Pedido do usuário:** "Servidor indisponível / demorou demais" e "o servidor nunca deve parar". **Estado:** implementado e testado (`tests/analysis-offload.test.mjs`, suíte completa); o servidor da 3218 NÃO foi reiniciado, então nada disto vale nele até um reinício.

| Item                  | O que foi feito                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread de análise     | `app/analysis-pipeline.mjs` é a parte pesada de `run` (da base com evidência até a disputa), extraída sem mudar regra nem ordem; `app/analysis-thread.mjs` a roda numa `worker_thread` (dona do cache de evidência e do grafo de fatos); `app/analysis-runner.mjs` decide onde roda e cai para o processo principal (mesmo código) se a thread falhar. `planState.track` e o arquivo de trocas de plano ficam no servidor, com o que o pipeline capturou **antes** de aprimoramentos e disputa (a ordem de sempre). O JSON da resposta nasce na thread e o servidor só põe `metadata` na frente (`prependField`) e `planProgress` no fim (`appendFields`): ~1 MB que já não é reserializado nem reparseado (o feed do overlay o guarda como bytes). |
| Fila                  | `createAnalysisWorker({ supersede: false })`: fila FIFO sem descarte (entradas diferentes — decisões do usuário, partida revista, adversário visto — nunca trocam de resultado). Prazo de 60 s por análise (`TFT_ANALYSIS_TIMEOUT_MS`); estouro recria a thread e o pedido falha com mensagem clara.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AUTO e POST           | `createRecentResults` guarda cada resultado por **duas chaves**: a chave de análise da tela e o **conteúdo da entrada** da análise pesada; quem pedir qualquer uma recebe o resultado pronto ou espera o cálculo em andamento. Prazo de 2 min (a janela da chave) e descarte quando o estado/meta muda (`clear`).                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Base incremental      | Já era do grafo de fatos (M8b): o fato `comps.base` só refaz com entrada declarada diferente. Agora o grafo mora na thread e o teste fixa: só XP ou entrada igual não refaz a base; aprimoramento novo refaz.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Cliente               | `v2/js/api.js`: prazo da análise 60 s; passado ele, `GET /api/health` decide: servidor responde = erro `analyzing` ("Analisando a partida", não conta como queda de conexão); sem resposta = `network` ("Sem resposta do servidor").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Servidor que não para | Requisição que falha vira 500 (ou fecha a conexão) e `clientError` responde 400; laços protegidos (`app/supervision.mjs`, `every`: erro vai ao log e a rodada seguinte roda, rodada presa é abandonada) para partida e metas; o laço automático abandona um tick preso (`maxTickMs`) e nunca deixa de reagendar; SSE quebrado sai da lista. `GET /api/health`: atraso do loop, onde a análise roda, fila, laço e idade do último ciclo de cada fonte. `supervisor.ps1` sobe o servidor de novo (espera 2, 4... 30 s) e não mexe em servidor que já está na porta; `stop.ps1` o encerra.                                                                                                                                                             |
| Medição               | `scripts/bench-analysis.mjs` (sem porta): análise no event loop x na thread, por tipo de mudança, com atraso do loop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Medição (cenário items-bank-lvl8, 5 análises por tipo, evidência congelada; atraso do loop p99 / máx em ms).** Máquina livre: no processo principal 305 / 305 (tudo), 287 (ouro), 128 (XP); na thread 13 (tudo), 16 (ouro), 24 (XP). Com 10 threads queimando CPU: processo principal 649 (tudo), 585 (ouro), 249 (XP); thread 42, 53, 54. Tempo de cada análise parecido (a thread soma o custo de mensagens: 204 x 206 ms livre, 517 x 428 ms saturado em "tudo"); o ganho é a resposta do servidor durante a análise.

**Diferenças aceitas.** (1) `stages` do `TEMPO` ganha `espera` (fila da thread) e as etapas da thread; (2) com a thread, o `TEMPO` de evidência vem como texto da thread; (3) `TFT_ANALYSIS_WORKER=1` deixou de existir: a thread é o padrão e `=0` a desliga.

**Pendências.** Memória: a thread guarda catálogo e meta em dobro (não medida ao vivo). Um erro de pilha da thread não chega ao `server.log` (só a mensagem). O benchmark ao vivo da 3218 não foi feito (o servidor lá é o antigo).

### M10b - o servidor conduz a análise sozinho (laço automático; thread de análise ainda atrás de opção)

**Pedido do usuário:** "faça o servidor rodar sempre, sem a necessidade da janela estar aberta". **Estado: escrito e checado só com `node --check`,
`oxlint` (estático, sem corrigir nada) e leitura; NADA foi executado** (nem suíte, nem golden, nem benchmark, nem o servidor; por ordem do usuário).
Escopo entregue: itens 1 a 3 e 5 a 8 do pedido (laço, decisões lembradas, fontes ativas, golden, não duplicar o trabalho da UI, `TEMPO`, documentação) com
o pipeline no processo principal; o item 4 (a thread) ficou **atrás de `TFT_ANALYSIS_WORKER=1`, reconhecida mas ainda sem efeito** (a integração completa
é grande demais para fazer sem poder executar; o que falta está abaixo).

**O que mudou.**

| Arquivo                                                                                      | O que é                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/state/analysis-key.mjs` (novo)                                                         | `analysisKey(state, decisões, now)` (a chave de análise que estava em `v2/js/api.js`, só que o relógio é argumento), `REFRESH_WINDOW_MS` (120 s) e `decisionPayload(state, guardado)` (as decisões do usuário no formato do POST e da chave). Puro; cliente e servidor importam o mesmo                                                                                                                           |
| `app/recommend.mjs` (novo)                                                                   | O pipeline do `POST /api/recommend` **movido de `server.mjs`** (validação, estado, `options`, base com evidência, tática, planos, plano em andamento, aprimoramentos, disputa) como `createRecommender(deps).run(entrada, { source, stages })`. Devolve `{ status, data, stages }` em vez de escrever na resposta HTTP. Mesma ordem de etapas, mesmas linhas; mudou só o que está listado em "Diferenças aceitas" |
| `app/auto-refresh.mjs` (novo)                                                                | O laço (`createAutoRefresh`) e o armazém de resultados recentes por chave de análise (`createRecentResults`, compartilhado com o POST). Não importa o servidor nem o motor: sonda, estado, pipeline, relógio e fontes entram por parâmetro                                                                                                                                                                        |
| `plan-state.mjs`                                                                             | Guarda `decisions` por partida (`setDecisions(gameId, d)` só toca o estado e a revisão se mudou; `decisions(gameId)` devolve cópia ou null). Persiste junto do plano (`data/plan-state.json`; estado antigo sem o campo carrega com `null`); `reset()` (partida registrada) as apaga                                                                                                                              |
| `server.mjs`                                                                                 | 1.429 -> 886 linhas: `validate` e o corpo do POST saíram; ficou `buildStateBody()` (o corpo de `GET /api/state`, usado pela rota e pelo laço), a criação do pipeline e do laço, e a rota fina `recommender.run(JSON.parse(body), { source: "ui" })`. Os `*.clear()` de cópias de meta viraram `recommender?.clear()`                                                                                              |
| `v2/js/api.js`, `v2/js/main.js`                                                              | `analysisKey` do cliente = a do núcleo + `Date.now()`; `decisionsOf(state, goal, augments, compSwaps, known)` (= `recommendPayload` sem os campos do servidor legado + `augmentsKnown`); o `main.js` calcula a chave com `decisionsOf`, não mais com o corpo do POST com os campos legados                                                                                                                        |
| `scripts/timing-report.mjs`                                                                  | Lê também as linhas `AUTO`                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/golden.test.mjs`, `tests/core-augment-emblem.test.mjs`, `tests/architecture.test.mjs` | Guardas apontadas para `app/recommend.mjs`; catraca (abaixo)                                                                                                                                                                                                                                                                                                                                                      |

**O laço (política, `app/auto-refresh.mjs`).**

1. **Tick barato** a cada 3 s (`TFT_AUTO_REFRESH_MS`): `probe()` = fase do cliente em cache (`lcu()`, que `watchMatch` já renova a cada 2 s) ou, sem cliente, `matches.status()` em `live`. Sem partida
   não há leitura de estado nem análise. Com partida, `sources.sync(true)` (leitor de tela; idempotente como já era em `/api/state`; removido em 2026-10-11, hoje o laço só chama `readState()`) e `readState()`.
2. **O estado** é o corpo que `GET /api/state` devolve (`buildStateBody`), então o laço vê o que a interface vê e alimenta o feed do overlay (`recordState`). Se uma rota o montou há menos de 0,8 tick,
   o laço o reaproveita (a interface aberta não dobra o custo). GEP e arquivos do jogo são lidos dentro de `stateHub.seen`, a cada tick: ficam ativos sem cliente conectado; o leitor de tela era o único
   com processo próprio, ligado e desligado pelo laço (removido em 2026-10-11: o laço não liga nem desliga leitor nenhum).
3. **A chave** = `analysisKey(estado, decisionPayload(estado, { ...padrões, ...decisões lembradas }), agora)`. Se já há resultado (ou cálculo em andamento) para ela em `results`, nada a fazer (`same`).
   Chave nova: respeita o intervalo mínimo (3 s desde a última análise; dobra a cada falha seguida até 30 s) e roda `refresh` = `recommender.run(decisões, { source: "auto" })`. A janela de 120 s está dentro da chave: o jogo parado
   renova a cada 2 min, como a interface.
4. **Guardas iguais às da interface:** partida nova sem tabuleiro próprio (`match.boardReady === false`) e jogador local ausente não analisam; snapshot de outro set (409) não repete a mesma chave.
5. **Fim da partida:** a sonda diz que acabou -> `sources.sync(false)` (removido em 2026-10-11 com o leitor de tela), zera o estado do laço e volta a só sondar. Uma partida nova (outro `gameId`) analisa na primeira leitura.
6. **Falhas** nunca derrubam o laço: o erro vira `AVISO` no log (no máximo 1 por minuto por texto) e o recuo cresce. `ENOENT` (arquivo do jogo ainda ausente) é silencioso.
7. **Medição (`TEMPO`):** `AUTO tick` (tick que leu estado sem analisar) e `AUTO analise` entram no resumo por minuto (p50/p95/máx); cada análise nova imprime `AUTO recomendação <etapas>` (as mesmas etapas do POST); a linha `carga:` ganhou
   `auto: em partida|sem partida ticks= analises= iguais= esperas= recusadas= erros=`. `TFT_AUTO_REFRESH=0` desliga o laço.

**Decisões do usuário lembradas pelo servidor.** `run(..., { source: "ui" })` grava `{ goalCompId, goalSwaps, compSwaps, augments, augmentsKnown }` (como chegaram e validadas, antes de qualquer ajuste) em `planState.setDecisions(gameId, ...)`; o
laço usa `planState.decisions(gameId)` (ou os padrões). Partida revista não grava. `source: "auto"` nunca grava (não sobrescreve a escolha do usuário com a lembrada).

**Camada por chave de análise (acerto de cache para o POST).** Dentro de `run`, para pedidos "simples" (sem `replayGameId`, `viewedPlayerId`, `previewIds`, `targetLevel`, `side` ou `goalCarryId` fora do padrão: tudo que a chave do cliente
assume constante), calcula-se `analysisKey({ ...metadata, screen: seen }, decisionPayload(metadata, decisões), agora)` com o estado que a própria chamada leu e a computação toda passa por `results.run(chave, compute)`: resultado pronto -> `chave=cache`, em
cálculo -> `chave=junto` (espera o mesmo), senão calcula. Isto é necessário (e não basta o `cacheKey` antigo) porque o `cacheKey` inclui `options.sticky`/`holdPlan`, que a PRÓPRIA análise muda (`planState.track` adota o plano):
duas análises seguidas do mesmo estado nunca bateriam no `analysisCache`. Os efeitos de entrada (`streaks.observe`, `matches.augments`, `hidden`...) continuam rodando antes da camada, como antes; o `analysisCache`/`baseAnalysisCache` seguem por baixo.
`recommender.clear({ base })` zera também `results`; `updateComps` mantém a base (`clear({ base: false })`, como antes só limpava `analysisCache`).

**A chave do núcleo (equivalência).** O corpo de `analysisKey` é o do cliente, linha a linha; `tests/analysis-key.test.mjs` compara com uma cópia da versão antiga em estados e instantes variados, fixa que as decisões que o cliente
manda (`decisionsOf`) e as que o servidor lembra (`decisionPayload`) dão o mesmo JSON e a mesma chave, e que o núcleo é puro. **Diferença aceita:** o `main.js` calculava a chave sobre o corpo do POST _com os campos do servidor legado_
(`level`, `gold`, `inventory`, `bench`, `levelEstimated`, `levelSource`); agora usa só as decisões. Esses campos derivam de `state.screen`, que já está na chave: a sensibilidade é a mesma, só muda o texto da chave (sem efeito, a chave é interna ao cliente).
A janela de 120 s continua do cliente por `Date.now()` (a função do núcleo só recebe o relógio). A catraca nova `analysis-key-rule` impede o cálculo `Math.floor(agora / REFRESH_WINDOW_MS)` fora do dono.

**Golden (esperado idêntico, não executado).** O harness (`tests/golden/harness.mjs`) segue como transcrição do pipeline e **não foi tocado**; o código de `app/recommend.mjs` é o do servidor, deslocado. A guarda
(`golden.test.mjs`, "transcrição fiel") passou a ler `app/recommend.mjs` a partir de `async function run(` e confere a mesma ordem de etapas. Nota: a guarda tinha o passo `structuredClone(built)`, que já não existia
no servidor desde a correção de carga (agora `structuredClone({ ...built`); corrigido junto. A guarda de `.grants(chosen)` (golden e `core-augment-emblem`) também lê `app/recommend.mjs`.

**Diferenças aceitas (comportamento, documentadas).**

1. **Vaga de análise (`turnLock`)** é solta ao fim do cálculo (`finally`), não ao fim da resposta HTTP: a serialização do JSON (que cede o loop) já não segura a próxima análise; a ordem das análises (plano, sequências) é a mesma.
2. **O POST pode devolver a análise do laço** (mesma chave) sem repetir `tactics`/`planState.track`: a segunda análise do mesmo estado não contava como leitura nova do desafiante (`baseId` igual), então o plano em andamento não muda.
3. **O laço também alimenta o histórico:** `matches.augments` (aprimoramentos da partida) e `streaks.observe` passam a rodar sem a interface.
4. **Cópias de meta renovadas** (`updateStats`, `updateAugmentStats`, nova partida) limpam também o armazém por chave; com o laço ligado, a próxima leitura reanalisa sozinha (antes esperava a tela).
5. **Histerese de precedência** (M7, risco 2): o estado agora avança por tick do laço (3 s) durante a partida, com ou sem tela; com a tela aberta o laço reaproveita o estado montado há instantes, então a contagem não dobra.
6. `TFT_ANALYSIS_WORKER=1` apenas registra um aviso no log.

**Catraca.** Mudaram de dono sem mudar a contagem: `server-option-assembly` 33, `gold-literal-threshold` 1, `unbounded-memo-maps` 3 e `manual-memo-key` 3 (de `server.mjs` para `app/recommend.mjs`; conferi com um leitor estático da própria `RULES`,
fora do repositório, que `server.mjs` ficou com 0 em todas e `app/recommend.mjs` com 33/1/3/3); regra nova `analysis-key-rule` (baseline vazio); `SERVER_MAX_LINES` (D12) **1.394 -> 900** (server.mjs: 886). O
armazém por chave ficou em `app/auto-refresh.mjs` (`createRecentResults`) e **não** é um `Map` de cache com chave manual dentro do pipeline; não acrescentei exceção.

**Testes novos (não executados).** `tests/auto-refresh.test.mjs` (13): sem partida só sonda; chave igual não reanalisa e chave nova sim com o intervalo mínimo; janela de 120 s; decisões lembradas (padrões, entram na chave e no pipeline, parciais);
o POST seguinte acerta o cache e o cálculo em andamento é compartilhado; fim de partida desliga o leitor de tela (removido em 2026-10-11) e outra partida recomeça na hora; guardas; falha com recuo e aviso único; 409; tick sem sobreposição; `start`/`stop` com timers falsos;
`TEMPO`/contadores; `createRecentResults` (cache, junto, falha, limite). `tests/analysis-key.test.mjs` (6): equivalência com a chave antiga, janela, decisões cliente x servidor, padrões, sensibilidade, pureza. `tests/plan-state.test.mjs` (+1): decisões por partida,
persistência, estado antigo, reset. Traçados à mão; se algum falhar, suspeitar primeiro de erro de rastreio meu.

**O que falta para a thread de análise (item 4; `TFT_ANALYSIS_WORKER=1` ainda sem efeito).** A fronteira está marcada no cabeçalho de `app/recommend.mjs` e é a da tabela do M10a. Falta:

1. Separar `run` em _preparar_ (estado e efeitos: `validate`, `current`/`seenState`, `hidden`, `sticky`/`holdPlan`, `streaks`, `matches.augments`, `cacheKey`/`uiKey`) e _computar_ (da base de evidência até `contestAlert`, puro), e um módulo de pipeline `export async function init/run` para
   `workerSpawner` (hoje o `compute` é uma closure sobre `options`, `snapshot`, `meta`... que não atravessa a thread).
2. Mover para a thread `evidenceMap`/`conditionalMap`/`baseAnalysisCache`/`pendingBase` e o `explorer()` (um único escritor de `evidence-cache.json`), mantendo `analysisCache` e `results` no principal.
3. `planState.track` e o `appendFile` do `plan-changes.jsonl` viram efeito pós-resultado via `sideband({ top, shown, self, baseId, chosen })`, com `appendFields(bytes, { planProgress })`; reverificar que `augmentAdvice`/`contestAlert` não leem `planProgress` (a ordem atual é `track` antes de `augmentAdvice`, que o golden fixa).
4. Resposta tática imediata (`stale`/`ageMs`) e o aviso `analysisEvent` por SSE: o laço já é o produtor natural (`onLatest`); a UI precisa tratar `base.stale`.
5. O harness do golden passar a chamar o mesmo módulo de pipeline (um lugar só) e o golden ganhar o cenário de 3 leituras pela fila.

**Riscos e pendências.**

- **Reiniciar o servidor da 3218** para ter o laço (não reiniciei nem fiz GET/POST). O cliente novo continua compatível com o servidor antigo (o corpo do POST não mudou; `legacyServer: true` seguia; `/core/state/analysis-key.mjs` é servido do disco). _Atualização (modernização da interface):_ o modo `legacyServer` foi removido de `v2/js/api.js` e do `main.js` (o servidor atual é posterior ao M7); o que mudou no cliente está em `v2/DESIGN.md` §2.
- **Primeira execução** pode acusar erro de digitação nos módulos novos ou nos testes; `app/recommend.mjs` é longo (a regra de lint de tamanho já acusava `server.mjs`).
- **Medir ao vivo:** custo do tick barato (`AUTO tick` p95) e da análise (`AUTO recomendação`), atraso do loop com a UI fechada, e se a leitura de estado a cada 3 s pesa (GEP/SQLite, `gameFiles.ledger`). Se pesar, subir `TFT_AUTO_REFRESH_MS`.
- A UI ainda faz seu próprio `POST` quando a chave dela muda; ela continua útil (carrega decisões) mas já não é necessária para a recomendação se renovar.
- `lcu()` renova a cada 5 s: o fim da partida chega ao laço com até 5 s de atraso.
- `gameState.divergence` conta leituras por chamada de `seen`; o laço soma uma por tick (3 s).

### M5a - remoção de código sem consumidor (`playbook`, `decision`, `recommendations[i].roll`)

**Nada foi executado** (suíte, golden e benchmarks ficam para o orquestrador; só `node --check` nos arquivos tocados).

**Busca que prova a ausência de consumidor** (`tft/helper`, sem `data/`, `node_modules/`, `pesquisa/`, `catalog.raw.json`):

| Item                                                                                                 | Quem produzia                                               | Leitores encontrados                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan.playbook`                                                                                      | `server.mjs` (POST) e harness do golden, via `playbook.mjs` | nenhum: 0 ocorrências de `playbook` em `v2/` (js, ui, html, testes), `tactics`, `stage`, `strategy`, `plan-state`, `augment-advice`, `contest`, `diagnostics`. O único uso fora da produção era `Object.assign(plan.playbook, ...)` que o próprio servidor fazia |
| `analysis.decision`                                                                                  | `server.mjs` e harness, via `decision.mjs:decide`           | nenhum: 0 ocorrências de `.decision` em `v2/`. Só o `live-mock.js` fabricava `rec.decision` (6 cenários "Decisão: ..." da galeria do mock, sem tela que os desenhe)                                                                                              |
| `recommendations[i].roll` (`level`, `budget`, `neededForTwoStar`, `availableUpper`, `chanceOneCopy`) | `engine.mjs` (mapa de `recommendations`)                    | nenhum: `neededForTwoStar` e `chanceOneCopy` só apareciam no produtor e em `live-mock-base.json`. Os `.roll` lidos são outros: `ev.roll` do `strategy` e `plan.panel.roll`/`p.roll` do view-model (`model.js`), que vêm de `strategy`/`roll.mjs`                 |

**O que mudou**

- Removidos: `playbook.mjs`, `decision.mjs`.
- `server.mjs`: sem os imports, sem `plan.playbook = playbook(...)` e o `Object.assign(plan.playbook, ...)`, sem `analysis.decision = decide(...)` (14 linhas a menos; 1.334 ao fim).
- `engine.mjs`: sem o campo `roll` por recomendação e sem as variáveis que só ele usava (`carryOwn`, `needed`, `p`, `rollLevel`, `rollBudget`) nem o import `rollLevelOf`. Isso também tira o último limiar de vida literal do motor (`health <= 35 ? 20 : 50`, a divergência D4 com `POLICY.hp.fastReroll`).
- `economy.mjs` e `analysis-keys.mjs`: só comentários. `rollLevelOf` continua em `economy.mjs` (usado por `strategy.mjs` e `tests/economy.test.mjs`).
- `live-mock.js`: removidos `decisionFor` e as 6 galerias "Decisão: ..." (ficou uma, `encerrado`, para a leitura não acionável). `live-mock-base.json`: removidos 3 `playbook`, 3 `roll` por recomendação e o `decision` da raiz (113 linhas; verificado que o JSON equivale ao anterior sem essas chaves).
- `scripts/bench.mjs`: as etapas `playbook` e `decide` saem da lista. `README.md`: seção "Evoluir, ajustar ou trocar" reescrita.
- Testes: `tests/golden/harness.mjs` e `tests/golden.test.mjs` (lista de etapas do POST) sem `playbook`/`decide`; `tests/architecture.test.mjs`: o teste "D5 (premissa)" virou "D5 (M5a)" e falha se os dois módulos voltarem ou se o produto voltar a ler/gravar `playbook`, `decision`, `neededForTwoStar` ou `chanceOneCopy`.

**Catraca (D5 baixou)**: `gold-literal-threshold` sem `decision.mjs` (1) e `playbook.mjs` (3); `hp-literal-threshold` sem `decision.mjs` (3), `playbook.mjs` (2) e `engine.mjs` (1); `playbook.mjs` e `decision.mjs` saem de `CORE_CANDIDATES`. As demais exceções ficam como estavam. Não mexi em `SERVER_MAX_LINES` (hoje 1.394; o servidor está em 1.334, dentro da faixa de 95 %, e outros passos editam o arquivo ao mesmo tempo): quem fechar a rodada deve baixá-lo.

**Diferença esperada no golden** (nada além de remoção; `strategy`, `stage`, `teamCode`, ranking, pool, loja e itens não leem os campos removidos). Ao regravar com `UPDATE_GOLDEN=1`, o diff deve ser **só** estes caminhos, em todos os cenários e passos que tenham recomendações:

1. `recommendations[i].playbook` e `preview.playbook` (inclusive o conteúdo que o servidor sobrescrevia com `strategy`);
2. `recommendations[i].roll` (e `preview.roll`, quando houver `preview`);
3. `decision` na raiz da resposta.

Qualquer outra diferença é defeito do M5a, não esperado. O `synthetic-strategy.json.gz` não muda (chama só `strategy()`). Os tempos de etapa `playbook` e `decide` deixam de existir no `TEMPO`/`bench`.

**Pendências / riscos**

- Rodar a suíte inteira e regravar o golden (diff conferido contra a lista acima) é o primeiro passo do orquestrador.
- A seção do M10a/M10b (thread de análise) ainda cita `decide` entre os estágios que não leem `planProgress`; é só texto.
- `rollBudget` (divergência D4) saiu junto com `roll`, então o M5b não tem mais esse ponto no motor; `strategy.mjs`/`roll.mjs` continuam donos do orçamento de rolagem.
- A galeria do mock perdeu 5 cenários de banner (não existiam na v2).

### M4 - pool e loja (`core/pool/`)

**Nada foi executado** (suíte, golden, `UPDATE_GOLDEN` e benchmarks ficam para o orquestrador; só `node --check` nos arquivos tocados,
revisão por leitura e testes ajustados/escritos por leitura). As diferenças do golden abaixo são **esperadas por leitura do código**; a
conferência real é a regravação revisada da rodada final.

**Decisões do usuário aplicadas.** Pool livre **fracionária** em todos os módulos; **uma** implementação da chance por slot de loja;
uma regra de cópias por estrela (1★ = 1, 2★ = 3, 3★ = 9) e de índice de odds por nível.

**O que existe agora (`core/pool/`, ESM puro, sem `node:*`/`Date.now`/`Math.random`, importa só de `core/pool`)**

| Módulo       | Regra                                                                                                                                                                                                                 | Substitui                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tables.mjs` | `POOL`, `ODDS`, `SHOP` (`slots` 5, `cost` 2), `LEVELS` (1..11), `BUYABLE_ODDS` (10 %), `COPIES_PER_STAR` (3)                                                                                                          | a definição em `rules.mjs` (que agora reexporta `POOL`/`ODDS` e lê `GAME.shopCost`/`shopSlots` daqui), `MIN_ODDS` de `stage.mjs`, os `>= 10` e o literal `5` do motor              |
| `copies.mjs` | `starCopies(estrelas)`, `starsForCopies(cópias)`, `upperCopies`/`freeCopies` (teto e livre **fracionária**), `freeOf(entrada)` (`free` ?? `remainingLikely` ?? `remainingUpper`, nunca arredonda), `freeByCost(pool)` | `3 ** (estrela - 1)` em 8 lugares, `copies >= 9 ? 3 : ...` (roll, tactics), `economy.likelyFree`/`freeByCost` (arredondavam), `upper`/`free` do motor                              |
| `shop.mjs`   | `levelOdds`, `oddsAt`, `isBuyable`, `unlockLevel`, `slotChance` (**a** chance por slot), `shopChance(p, lojas = 1)`, `chanceAtLeast`, `slotsIn`                                                                       | `engine.probability` (denominador fracionário) e `economy.slotChance` (denominador inteiro), `1 - (1 - p) ** 5` (engine 2x, roll 2x), `atLeast` do motor, `unlockLevel` de `stage` |
| `curve.mjs`  | `binomialPmf`, `closeCurve` (chance acumulada por ouro; o teto de ouro da política é passado por `economy.closeCurve`)                                                                                                | a implementação que estava em `economy.mjs` (mesma conta, mesmos números)                                                                                                          |

**Consumidores trocados** (edições mínimas, arquivo por arquivo)

- `rules.mjs`: `POOL`/`ODDS` viram `export ... from core/pool/tables.mjs`; `GAME.shopCost`/`shopSlots` vêm de `SHOP`.
- `economy.mjs`: sem `likelyFree`, `slotChance`, `binomialPmf`, `ODDS`; reexporta `slotChance`, `binomialPmf`, `freeByCost`, `freeOf` (o mock da interface e os testes
  consomem por este caminho); `closeCurve` é o do núcleo com o teto `POLICY.simulation.maxGold`; `sellValue` usa `starCopies`; `rollSim` lê `levelOdds` e **não deixa a
  probabilidade de um alvo ficar negativa** quando a pool livre fracionária termina uma corrida abaixo de zero (`left > 0`; com inteiros nunca acontecia).
- `engine.mjs`: `upper`/`free` por `upperCopies`/`freeCopies`; **cada entrada de `pool[]` ganha `free` (a pool livre exata)**; `remainingLikely` continua arredondado a 0,1 só para exibir;
  `denomByCost = freeByCost(pool)`; `probability` = `slotChance`; `chancePerShop`, `pFind`, `findAt` = `shopChance`; `atLeast` = `chanceAtLeast(slotsIn(lojas), p, k)`; `isBuyable` nos três
  limiares de 10 %; `starCopies` nos quatro `3 ** ...`; `odds: levelOdds(level)` no payload.
- `roll.mjs`: `free = freeOf(entrada) - compras da loja`, **sem arredondar**; `denom` por `freeByCost`; `slotChance`/`shopChance`/`oddsAt` do núcleo; `TWO_STAR`/`THREE_STAR` =
  `starCopies(2)`/`starCopies(3)` no lugar dos literais 3 e 9; `starOf = starsForCopies`; `left` das linhas passa a sair arredondado a 0,1 (era inteiro; só exibição) e o texto
  "só ~N livres" também.
- `stage.mjs`: `isBuyable`, `levelOdds`, `unlockLevel` e `BUYABLE_ODDS` (o texto "menos de 10%" lê a constante). `strategy.mjs`: `levelOdds(level + 1)` e `starCopies(3)`.
- `contest.mjs`, `pool-tracker.mjs`, `unit-ledger.mjs` (`copies` = `starCopies`), `tactics.mjs` (`starsForCopies`, `starCopies`), `v2/js/model.js` (`starCopies`, import `../../core/pool/copies.mjs`).
- `pool-tracker.mjs`: sem `Date.now()` como padrão. `hiddenHoldings` recebe `now` por argumento (o servidor e o harness já passavam); sem um `now` válido usa a hora da última
  captura (antes, `now` inválido virava `NaN` nos pesos). Sai a exceção `pool-tracker.mjs|Date.now` do T3.

**Diferenças esperadas no golden (a conferir na regravação).** Premissa: antes, `roll.teamOf` lia `Math.round(remainingLikely)` (`remainingLikely` = livre exata arredondada a
0,1), logo **cada meia cópia de banco estimado (`x,5`) era arredondada para cima, isto é, ignorada**; o motor sempre usou a livre exata. Agora os dois usam a exata (`pool[].free`).
Os snapshots congelados têm `hidden` em múltiplos de 0,5: `opening-3u`, `early-5u`, `mid-7u`, `items-8u`, `late-hp19`, `reroll-3star` e `danger-hp27` têm
vários campeões com 0,5 (e alguns com 1); `mock-base` não tem `hidden`.

| #   | Onde                                                                                                                                                                                            | Cenários                                                                                                                                                                                                                                                                                                                       | Antes -> depois esperado                                                                                                                                                                                                                                                                                                                                                              | Justificativa                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | `pool[*].free` (campo **novo**, em toda entrada da pool, em todos os passos com análise)                                                                                                        | todos os 17 (também `eliminated-recorded`, `gold-unknown`, `replay-final`)                                                                                                                                                                                                                                                     | ausente -> número exato (ex.: `6.5`)                                                                                                                                                                                                                                                                                                                                                  | aditivo: é o valor que o motor e a rolagem passam a compartilhar; `remainingLikely` não muda |
| 2   | `pool[*].chancePerSlot`/`chancePerShop` e tudo que o motor deriva (`compScore`, `compRanking`, `pFind`, `access`, `recommendations[*].targets[].chancePerShop`, `stage.buyNow[].chancePerShop`) | todos                                                                                                                                                                                                                                                                                                                          | **idêntico** (o motor já era fracionário) até o último bit da ordem das contas (`(odds/100)*(livres/denom)` em vez de `((odds/100)*livres)/denom`), invisível no normalizador (1e-9)                                                                                                                                                                                                  | a mesma fórmula, agora única                                                                 |
| 3   | `strategy.panels.rolling.targets[*]`: `chancePerSlot`, `chancePerShop`, `find.now/next`, `chance`, `gain`, `gold50`, `left`, `status/why/whyText`                                               | todos com ouro lido e `hidden` não vazio: `opening-lvl3`, `early-lvl5-shop`, `mid-lvl7-streak`, `late-lvl9-critical`, `items-bank-lvl8`, `pinned-comp-swap`, `augments-chosen-offer`, `auto-comp-swaps`, `plan-sequence` (3 leituras), `shop-cache-d1` (3), `viewed-rival`, `rich-lvl10`, `reroll-hidden-banks`, `danger-hp27` | `chancePerSlot` do campeão com 0,5 no banco **cai** (ex.: 3,00 -> 2,92 %, livre 8 -> 7,5) e o de quem tem 0 **sobe um pouco** (denominador do custo menor); `chancePerShop` da rolagem passa a **igualar** `pool[].chancePerShop` (era a divergência D3: até 0,2 p.p. em 12 de 14 alvos); `left` de inteiro para décimos (ex.: `17` -> `16.5`); `whyText` "só ~N livres" com uma casa | pool livre fracionária em todo lugar; fim do arredondamento para cima das meias cópias       |
| 4   | `strategy.panels.rolling.curve`/`call` (`any`, `gain`, `mainChance`, `need`, `q50/q80/q95`, `spend`, textos "N% de evoluir...") e `ev.roll`                                                     | os mesmos de 3                                                                                                                                                                                                                                                                                                                 | variações pequenas em frações; `spend` e `go/hold` só mudam se um valor cruzava o limiar (`chance` 0,5, `waitMargin` 0,15, empate de `bestSpend`)                                                                                                                                                                                                                                     | consequência de 3 (a simulação e a curva leem `free`/`denom` novos)                          |
| 5   | `status` `inviavel/bancos` de uma peça                                                                                                                                                          | só se `free` cruzar `need` (ex.: livre exata 2,6 com 3 pedidos: antes `round` = 3 passava, agora fica `bancos`)                                                                                                                                                                                                                | pode mudar 0 ou 1 linha                                                                                                                                                                                                                                                                                                                                                               | `free < need` agora compara a livre exata                                                    |
| 6   | `gold-unknown`, `replay-final` (`gold: null`)                                                                                                                                                   |                                                                                                                                                                                                                                                                                                                                | apenas o item 1 (a estratégia não decide sem ouro)                                                                                                                                                                                                                                                                                                                                    |                                                                                              |
| 7   | `eliminated-recorded` (`hidden` vazio)                                                                                                                                                          |                                                                                                                                                                                                                                                                                                                                | apenas o item 1                                                                                                                                                                                                                                                                                                                                                                       | livres inteiras: nada a arredondar                                                           |

Os 11 estados sintéticos de `strategy()` (`synthetic-strategy.json.gz`) **não mudam**: a pool dos fixtures é inteira (e quando o teste põe banco oculto é inteiro), `left` com uma casa de
um inteiro é o mesmo número e `whyText` imprime o mesmo texto. Qualquer diferença fora dos caminhos 1-5 (por exemplo em `recommendations[*].traits`, `items`, `plan`, `stage` sem
`chancePerShop`, `contest`, `augmentAdvice`) é defeito do M4, não esperado.

**Catraca (T2/T3) - o que desceu**

| Regra / exceção                                | Antes                                                                           | Depois                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `star-copies` (`3 ** (estrela-1)`)             | 11 (contest, economy 2, engine 4, pool-tracker, tactics, unit-ledger, model.js) | **0** (dono: `core/pool/copies.mjs`)                                                                                                                              |
| `odds-index` (`ODDS[`)                         | 11 (economy 2, engine 5, roll, stage 2, strategy)                               | **0**                                                                                                                                                             |
| `per-shop-chance` (`) ** 5`)                   | 3 (engine 2, live-mock)                                                         | **1** (só `live-mock.js`, que reimplementa o servidor)                                                                                                            |
| `buyable-odds-literal` (`>= 10`, `MIN_ODDS =`) | 4 (engine 3, stage)                                                             | **0**                                                                                                                                                             |
| T3 `pool-tracker.mjs\|Date.now`                | exceção (D13)                                                                   | **removida**                                                                                                                                                      |
| Regras novas (baseline vazio)                  |                                                                                 | `stars-from-copies-literal` (`copies >= 9`), `pool-free-rounding` (`Math.round` sobre `remainingLikely`/`likelyFree`/`.free`), `shop-slots-literal` (`5 * lojas`) |

**Testes.** Novos: `tests/core-pool.test.mjs` (cópias por estrela e inversa, pool livre fracionária, odds/comprável/desbloqueio contra o laço antigo de `stage`, chance por slot
contra a fórmula do motor, `shopChance`, cauda da binomial, curva exata com pool fracionária e o teto de ouro da economia, reexports sem reimplementação, **D3**: a rolagem lê a mesma
pool livre fracionária e dá `chancePerSlot` igual à conta do motor com bancos de 0,25 e 0,5, e pureza do módulo). Ajustados por leitura: `tests/pool-tracker.test.mjs` (`likelyFree` -> `freeOf`, caso
da fração e o `now` implícito), `tests/architecture.test.mjs` (as 4 regras acima + T3). **Nenhum foi executado.**

**Piso de reroll rápido (D4).** Já estava resolvido: o `rollBudget` do motor (`health <= 35 ? 20 : 50`) saiu com o `recommendations[i].roll` no M5a; o único piso que resta é
`POLICY.hp.fastReroll`/`POLICY.floor.fastReroll` em `strategy.mjs`. Não toquei em limiares de ouro/vida.

**Pendências / riscos**

- **Rodar a suíte e regravar o golden** com os diffs 1-5 acima conferidos é o primeiro passo; se aparecer diferença em outro caminho, é defeito do M4.
- Não mexi na chave de cache da base (D1/M8): `pool[].free` e as chances dependem de `options.hidden`, que já está na chave.
- `server.mjs` ainda arredonda `options.hidden` a 0,5 (D13: só para a chave de cache). Com a pool fracionária isso aparece como a meia cópia que agora conta; sai no M7/M8.
- `live-mock.js` ainda tem `1 - (1 - slot) ** 5` (exceção da catraca) e consome `E.closeCurve`/`E.slotChance` do `/economy.mjs`: continuam existindo (reexport). Como `/rules.mjs` e
  `/economy.mjs` agora importam `./core/pool/*`, o servidor **da 3218 precisa ser reiniciado** (o código antigo não serve `/core/*`): sem isso `live-mock.html` não carrega (a v2 já
  dependia disso desde o M3). Não reiniciei nem fiz GET no servidor.
- Ainda lê `POOL[...]` direto o motor (`total`, disputa), o que a catraca não cobre; `GAME.shopSlots`/`shopCost` continuam em `GAME` por serem do M5.
- `findIndicator` (`roll.mjs`) compõe lojas com `1 - (1 - perShop) ** n` (equivalente a `shopChance(p, n)` a menos do último bit); não unifiquei para não alterar números além do pedido.
- `pool[].free` entra no payload (aditivo). Se algum consumidor externo fizer `deepEqual` do formato da pool, precisa conhecer o campo.

### M2 - catálogo de itens e campeões (`core/catalog/items.mjs`, `core/catalog/champions.mjs`)

**Estado: escrito e conferido só com `node --check` e leitura; o golden e a suíte NÃO foram executados** (ordem do usuário: testes e
benchmarks só na rodada final, pelo orquestrador). Os diffs de golden abaixo são **esperados por leitura do código e dos esperados
gravados**, não medidos; a rodada final deve confirmá-los antes de `UPDATE_GOLDEN=1`. O passo em modo `legacy` (código novo reproduzindo os
classificadores antigos, golden idêntico, e só depois a tabela única) não foi feito como dois commits: em vez disso,
`tests/core-items.test.mjs` copia os classificadores antigos **sem mudança** e prova, em todo o `catalog.json`, que o núcleo dá o mesmo
resultado e que as ÚNICAS diferenças são as aceitas (lista item a item abaixo). A equivalência está fixada por teste, não por golden.

**O que existe.**

| Função (em `core/catalog/`)                                                                                   | Substitui                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items.mjs`: `itemRole`, `holderRole`, `componentFamily`                                                      | `engine.itemRole/holderRole` e o ramo de componentes do `itemProfile`, `stage.kind`, `meta-builds.TANK/AP/AD` (papel do item **único**: superconjunto)                                                                                                                        |
| `isConsumable`, `CONSUMABLE`, `isComponent`, `componentId`, `baseItemId`, `isRadiant`, `isArtifact`, `kindOf` | `item-tiers.kindOf/CONSUMABLE/isConsumable/baseItemId`, `engine.isComponent` e os `/Component_/`, `carousel`/`tactics` (`startsWith("DA_Component_")`), `screen-reader` e `gep-reader` (regex de consumível), `stage` (`Component_\|Consumable_\|Reforger`), `v2/js/items.js` |
| `isEmblemItem`, `isEmblemTool`, `isThiefsGloves`, `isManaItem`, `isPlanItem`                                  | `/Emblem\|ThiefsGloves/`, `/BlueBuff\|SpearOfShojin/` (tactics), `isTool` (engine), `server` (Luva do Ladrão), `item-value.isPlanItem` (que passou a reexportar)                                                                                                              |
| `recipeOf`, `recipeMap`, `standardRecipes`                                                                    | `composition?.length === 2` (engine 4x, tactics) e o filtro `DA_ + 2 componentes + sem Emblem\|Radiant` do `readyRecipes`                                                                                                                                                     |
| `coverageOf`, `addCoverage`                                                                                   | as três linhas `VoidStaff/LastWhisper/Sunfire\|Morello\|RedBuff` repetidas em 4 lugares de `tactics` + o `utility` do `build`                                                                                                                                                 |
| `champions.mjs`: `championRole(champion, metaRoles)`, `isAvatar`, `poolName`                                  | `engine.computeRole` e `tactics.role`; o teste de Avatar escrito em 9 lugares (engine 6, stage, tactics, server); `engine.key`                                                                                                                                                |

`item-tiers.mjs` ficou como reexport fino (`CONSUMABLE`, `isConsumable`, `baseItemId`, `kindOf`) porque `tests/item-tiers.test.mjs`,
`comp-items.test.mjs` e `catalog-fixture.mjs` ainda importam o nome antigo. Consumidores trocados: `engine.mjs`, `tactics.mjs`, `stage.mjs`,
`meta-builds.mjs` (`roleOf` usa `itemRole`), `server.mjs` (3 linhas: imports, Luva do Ladrão, Avatar), `item-edge.mjs`, `plan-progress.mjs`,
`carousel.mjs`, `screen-reader.mjs` (removido em 2026-10-11), `gep-reader.mjs`, `item-value.mjs`, `v2/js/items.js` (importa `../../core/catalog/items.mjs`, servido por
`/core/*`), `build-items.mjs`. **Não toquei** nos arquivos de posse de itens (M6): `item-holdings.mjs`, `item-plan.mjs`, `v2/js/item-source.js`,
`v2/js/comp-items.js`; as cópias de `baseItem`/`isComponent`/`composition.length === 2` que eles têm ficam como exceções da catraca.

**Diferenças aceitas (decisão 1: superconjunto), item a item.** O papel de cada item agora é o de `meta-builds` (que já era a união);
`stage.kind` só diferia em `HandOfJustice`; o motor (`engine.itemRole`) diferia em 11 itens montáveis e nos radiantes deles. Nenhum item que o
motor já classificava mudou de papel; o motor só passa a saber um papel onde antes dizia `flex`.

| Item (montável)     | Motor (antes) | `stage.kind` (antes) | `meta-builds` (antes) | Agora, em todos |
| ------------------- | ------------- | -------------------- | --------------------- | --------------- |
| `DA_RedBuff`        | flex          | ad                   | ad                    | ad              |
| `DA_Evenshroud`     | flex          | tank                 | tank                  | tank            |
| `DA_Morellonomicon` | flex          | ap                   | ap                    | ap              |
| `DA_ProtectorsVow`  | flex          | tank                 | tank                  | tank            |
| `DA_EdgeOfNight`    | flex          | ad                   | ad                    | ad              |
| `DA_TitansResolve`  | flex          | ad                   | ad                    | ad              |
| `DA_HandOfJustice`  | flex          | **flex**             | ad                    | ad              |
| `DA_Bloodthirster`  | flex          | ad                   | ad                    | ad              |
| `DA_Crownguard`     | flex          | tank                 | tank                  | tank            |
| `DA_SteraksGage`    | flex          | ad                   | ad                    | ad              |
| `DA_KrakensFury`    | flex          | ad                   | ad                    | ad              |

Os radiantes desses itens (`DA_*Radiant`, `DA_*_Radiant`) seguem o item base, também. Justificativa: `stage.kind` e `meta-builds` são a classificação
que decide o que o jogador de fato faz com o item (Sunfire/Morello/Redbuff dão cura, Bloodthirster dá AD...), e o motor tratava como "serve a qualquer portador"
(`flex`) itens que a meta publica sempre em tanque/AD/AP. `HandOfJustice` é AD só em `meta-builds`; `stage` o deixava `flex`.

Efeito no motor: `itemProfile` (campo `itemProfile` da resposta: cada item completo conta 1 no seu papel em vez de no `flex`), `freeProfile` (item
pronto no banco, e +1,5 para o papel que algum item montável com os componentes do banco tem), `itemFit` (`holderRole`: o item precisa de portador de papel
compatível) e `unitTerms.matching` (item equipado casa com o papel da peça ou é `flex`: o item de outro papel deixa de casar). Efeito no `stage`:
`bankItems` (item pronto no banco vai para quem usa o papel dele): só muda se o banco tiver `HandOfJustice` (nenhum cenário do golden tem).

**Outras equivalências (valem só para o catálogo e os dados atuais; registradas, sem diferença hoje).**

1. `Dragon` (motor) virou `DragonsClaw`: no catálogo só `DA_DragonsClaw` e `DA_DragonsClawRadiant` contêm "Dragon". `Runaans` (motor) virou `Runaan` (stage/meta-builds). Nenhum id casa dois papéis (testado).
2. `stage.bankItems` excluía `Component_|Consumable_|Reforger`; agora exclui `isComponent || isConsumable` (superconjunto: também `Potion`, `Booster`, `Masterwork`, `LuckyItemChest`). O banco lido da tela (removida em 2026-10-11) e do GEP já tira consumíveis, então não muda nada hoje.
3. Em `tactics.build`, o `utility` do item usava `id === "DA_VoidStaff"` e `id === "DA_LastWhisper"` (exato) mas regex para Sunfire/Morello/RedBuff; agora os três usam regex (inclui o radiante). Só muda se um radiante de cobertura estiver no banco **e** na lista desejada da peça.
4. `championRole` usa a heurística do motor (inclui `resist`) também no plano. Só a **Leona** muda de papel pela heurística (ap -> tank no `tactics`). **No golden não muda nada**: a meta congelada dá `tank` à Leona (`roleOf` da build dela), e a meta vale primeiro. Ao vivo só muda se o servidor não tiver a build da Leona.
5. `isComponent` (`startsWith("DA_Component_")`) e `/Component_/.test` (substring) eram usados como se fossem a mesma coisa; no catálogo atual todo id com `Component_` começa com `DA_Component_`.

**Golden esperado (a confirmar na rodada final; 6 de 18 arquivos idênticos, 12 mudam).** O que dá para prever por leitura: o campo `itemProfile`
exato (cada item da lista sai do `flex` e entra no papel dele); o resto (`compRanking[].score`, `recommendations[].fit/itemFit`, `evidence`, ordem do ranking)
muda em valor, não em formato, nos cenários marcados "sim"; não há previsão numérica sem executar.

| Cenário (arquivo)                 | Muda? | Motivo (itens do Hero equipados ou no banco)                                                          | `itemProfile` antes -> depois esperado                 |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `opening-lvl3`                    | não   | sem itens                                                                                             | igual                                                  |
| `gold-unknown`, `auto-comp-swaps` | não   | nenhum item dos 11/HandOfJustice; receitas prontas sem papel novo                                     | igual                                                  |
| `replay-final`                    | não   | idem                                                                                                  | igual                                                  |
| `danger-hp27`                     | não   | tem 5 itens no banco com 5 receitas dos 11 prontas, mas os papéis ad/ap/tank já tinham receita pronta | igual                                                  |
| `synthetic-strategy` (11 estados) | não   | só `strategy()`: nem usa itens                                                                        | n/a                                                    |
| `early-lvl5-shop`                 | sim   | `EdgeOfNight` (BF + Recurve) monta com o banco: `freeProfile.ad` +1,5                                 | igual (`itemProfile` só conta o que é item pronto)     |
| `mid-lvl7-streak`                 | sim   | receitas prontas Morello/EdgeOfNight/Crownguard/Sterak: `freeProfile` ganha ap e ad                   | igual                                                  |
| `plan-sequence` (3 passos)        | sim   | idem `mid-lvl7-streak`, nos três passos                                                               | igual                                                  |
| `augments-chosen-offer`           | sim   | `Morellonomicon` equipada; receitas EdgeOfNight/Crownguard prontas: `freeProfile` ganha ad e tank     | ad 1,2 / ap 5,2 / flex 3 / tank 4 -> ap 6,2 / flex 2   |
| `items-bank-lvl8`                 | sim   | `Morellonomicon` equipada                                                                             | ad 2 / ap 6,8 / flex 4,5 / tank 6 -> ap 7,8 / flex 3,5 |
| `pinned-comp-swap`                | sim   | `Morellonomicon` equipada; `freeProfile` ganha ap e ad                                                | ad 1,2 / ap 5,2 / flex 3 / tank 5 -> ap 6,2 / flex 2   |
| `shop-cache-d1` (3 passos)        | sim   | idem `pinned-comp-swap`; a asserção D1 (loja fora da chave) continua valendo                          | idem nos 3 passos                                      |
| `viewed-rival`                    | sim   | `Morellonomicon` equipada                                                                             | ad 0 / ap 4 / flex 3 / tank 3 -> ap 5 / flex 2         |
| `late-lvl9-critical`              | sim   | `TitansResolve` no banco (item pronto): conta no `itemProfile` e no `freeProfile`                     | ad 1 / ap 3 / flex 5 / tank 2 -> ad 2 / flex 4         |
| `rich-lvl10`                      | sim   | `ProtectorsVow` equipada                                                                              | ad 2 / ap 3 / flex 2 / tank 5 -> flex 1 / tank 6       |
| `reroll-hidden-banks`             | sim   | `ProtectorsVow` equipada                                                                              | ap 3 / flex 2 / tank 5 -> flex 1 / tank 6              |
| `eliminated-recorded`             | sim   | `SteraksGage`, `EdgeOfNight`, `Evenshroud` equipados                                                  | ad 1 / flex 3 / tank 6 -> ad 3 / flex 0 / tank 7       |

("Muda" nos 12 cenários significa: o `itemProfile` e, por consequência, o placar de `itemFit`/`matching`/`freeProfile` no `compRanking` e nas
`recommendations`; o `stage`/`tactics` não mudam em nenhum cenário. Previsão feita com os esperados gravados e `catalog.json`; as contagens
usam `self.units` + `self.reserve` + `ownedItemAdvice.inventory`, então um item que esteja em peça fora de `self` poderia escapar.)
Quando a rodada final regravar, conferir: (a) os 6 arquivos "não" ficam byte a byte iguais; (b) nos 12 "sim", o diff do `itemProfile` bate com a coluna acima
e não há diferença em `stage`/`currentPlan.itemMoves`/`carousel`; (c) o resto é só número em `score`/`evidence`.

**Catraca (T2) que desceu.**

| Regra                                                                                                                | Antes                                                           | Depois                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `radiant-base-id`                                                                                                    | 4 (item-tiers 2, comp-items 1, item-source 1)                   | **2** (comp-items, item-source: arquivos de posse, M6)                  |
| `component-id-literal`                                                                                               | 14                                                              | **7** (item-holdings 1, item-plan 1, item-source 1, live-mock 4)        |
| `item-class-regex`                                                                                                   | 42 (engine 6, live-mock 12, meta-builds 3, stage 3, tactics 18) | **29** (engine 3, live-mock 12, tactics 14); meta-builds e stage saíram |
| `item-consumable-regex`, `item-coverage-regex`, `item-special-regex`, `champion-role-heuristic`, `avatar-trait-test` | (regras novas)                                                  | **0** cada (travam a regressão)                                         |
| `item-recipe-length`                                                                                                 | (regra nova)                                                    | 3 (`v2/js/comp-items.js`, M6)                                           |

T1/T3: sem exceção nova (`core/catalog/*` não importa nada; `v2/js/items.js` importa de `core/`, permitido desde o M3).

**Testes.** Novo `tests/core-items.test.mjs` (15 testes, **não executados**): os classificadores antigos copiados contra o núcleo em todo o `catalog.json`
(papel = `meta-builds`; contra `stage.kind` só `HandOfJustice`; contra o motor só os 11 itens e radiantes, nunca contradizendo; `holderRole`; `kindOf`,
`baseItemId`, `isConsumable`, `isComponent`, `isPlanItem`; receitas; cobertura; `championRole`: motor idêntico e plano só Leona; Avatar/pool), reexport de
`item-tiers.mjs` e pureza (`core/catalog/*` não importa nada). `tests/architecture.test.mjs`: baselines abaixados e 6 regras novas. **Testes
existentes lidos e que podem ser sensíveis ao novo papel**: `engine-flex.test.mjs` ("regra do Rival": Rengar com `DA_Bloodthirster`; a heurística dá `tank` ao
Rengar, então o item deixa de casar com o papel e a preservação dele cai ~1,1 ponto; as asserções comparam 0,6 de colocação, ~12 pontos, e `rivals < 2`, que só
fica mais fácil); nenhum outro teste de `engine`/`stage`/`tactics`/`meta-builds` cita os 11 itens.

**Achado novo (D15) e pendências.**

- **D15 - `mrCount` do motor x `resists` do plano.** O motor conta rivais com resistência mágica por `Dragon|Gargoyle` (`matchup`: `mrCount * 0,35` para o AD),
  o plano por `Dragon|SpiritVisage|Gargoyle|AdaptiveHelm`. A cura (`Bloodthirster|HandOfJustice|SpiritVisage|HextechGunblade|Redemption`) e a armadura (`Bramble|Gargoyle|Steadfast`)
  são idênticas nos dois. São "ameaça do lobby" (fato `lobby.threat`, seção 2.4), não papel de item: **não unifiquei** (mudar `mrCount` mexeria no ranking sem estar entre as
  diferenças aceitas). Ficam como exceção de `item-class-regex` (engine 3, tactics 4 linhas da ameaça) até o passo do `lobby.threat`; unificar lá pelo superconjunto (o do plano) é a proposta, com diff de golden registrado.
- Os 10 `add("DA_...")` de `tactics.build` (tabela de pontos por item da build) são política da build (não se mexe) e seguem contados em `item-class-regex`.
- `v2/js/item-source.js`, `v2/js/comp-items.js` e `item-holdings.mjs` (M6) mantêm cópias de `baseItem`/`isComponent`/`composition.length === 2`; trocar cada uma pela função do núcleo é de uma linha e fica para o M6.
- `live-mock.js` reimplementa papéis e componentes (M5); `download-assets.mjs` tem um filtro de ids de item (ferramenta, fora da catraca).
- `Date.now`/E-S: nada novo no núcleo. `server.mjs` ganhou 2 linhas de import e perdeu 3 de regex.

### M7 - camada de estado e fontes (`core/state/`, `app/state.mjs`)

**Nota (2026-10-11):** registro histórico. A leitura de tela foi removida depois dele: o que segue sobre a tela (precedência e divergência
GEP × tela, `levelSource` "tela", `reconcileLevel`, `createStateHub({screen, ...})`, `mergeSources`) não vale mais. O estado atual está no
registro "Remoção da leitura de tela", abaixo, e em `FONTES-DE-DADOS.md`, "Precedência por campo".

**Aviso: nada foi executado.** Por ordem do usuário, o golden, a suíte e os benchmarks ficam para a rodada final do orquestrador. Validei só com
`node --check` em todos os arquivos tocados, import (carga) dos módulos novos, um leitor estático da catraca T2 (cópia fiel de `RULES`, ver abaixo) e
revisão linha a linha. Os testes novos foram traçados à mão; se algum falhar, é erro meu de rastreio, não regra: reportar.

**O que mudou.**

| Arquivo                            | O que é                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/state/clock.mjs` (novo)      | `parseStage("S-R")` -> `{stage, round}` e `stageText`: o estágio é lido uma vez, na fronteira. Dono do `stage-round-parse`                                                                                                                                                           |
| `core/state/level.mjs` (novo)      | A tabela de XP (`XP`) e as regras de nível que moravam em `rules.mjs`: `levelFromXp`, `levelsForXp`, `reconcileLevel`, `roundNumber`, `passiveXpBetween`, `levelFloor`; mais `reduceLevel` (puro, era `levelTracker.apply`) e `levelConsistent` (a regra "GEP consistente" do nível) |
| `core/state/field.mjs` (novo)      | `Field<T>` = `{value, source, confidence, at, ageMs, stale}`; `unknownField`, `confidenceOf`                                                                                                                                                                                         |
| `core/state/precedence.mjs` (novo) | Precedência por campo (`gold`, `level` + `xp`, `stage`, `shop`, `items`) com histerese e divergência: `reduceSources(memória, {gameId, seen, gep})` -> `{memory, picks, events, divergence}`. Puro                                                                                   |
| `core/state/game-state.mjs` (novo) | `buildGameState(seen)` -> `GameState` normalizado (`clock.{stage,phase,phaseKind}`, `me.{gold,level,xp,shop,itemBank,removers,bench}`, cada um um `Field`) e `summarizeState` (listas viram contagem)                                                                                |
| `core/state/inputs.mjs` (novo)     | `analysisInputs(seen, {augments, estimatedLevel, live})`: a única tradução estado -> `options` (`level`, `levelEstimated`, `levelSource`, `gold`, `xp`, `stage`, `shop`, `removers`, `hasRemover`, `augmentIds`)                                                                     |
| `app/state.mjs` (novo)             | `createStateHub({screen, gameFiles, gep, now, onDivergence})` (sem `screen` desde 2026-10-11): chama as fontes, valida o nível, decide a fonte de cada campo, aplica o GEP onde vale e guarda a memória (nível confirmado, fonte ativa, contadores)                                  |
| `rules.mjs`, `level.mjs`           | `rules.mjs` reexporta as seis funções de nível e monta `GAME` com os MESMOS objetos de `XP`; `level.mjs` ficou só com a memória por partida em volta de `reduceLevel`                                                                                                                |
| `game-log.mjs`, `gep-reader.mjs`   | Estágio via `parseStage`; `sources.bench` passou de `"manual"` para `null` (a entrada manual foi removida; a reserva só existe com GEP fresco); `mergeGep(seen, gep, pick)` aceita a decisão por campo (sem `pick`, o GEP vale em tudo, como antes)                                  |
| `server.mjs`                       | `seenState = stateHub.seen`; `/api/state` ganhou `gameState` (aditivo); o POST usa `analysisInputs`; `validate` aceita payload sem `level`; `sendStatic` (abaixo). 1.351 linhas (teto 1.394)                                                                                         |
| `static-files.mjs`                 | `sendStatic(res, root, pathname, json)`: lê o arquivo ANTES de escrever o cabeçalho                                                                                                                                                                                                  |
| `v2/js/api.js`, `v2/js/main.js`    | `recommendPayload` manda só decisões do usuário (a partida revista mantém os campos antigos); `analysisKey` passou a incluir ouro, nível, banco de itens e reserva do GEP do estado (antes iam no payload)                                                                           |

**Decisões do usuário aplicadas (e como).**

- **(a) `GameState` normalizado com `Field<T>`**: `buildGameState`. Exposto em `/api/state` como `gameState` (aditivo; `screen` e o resto do formato não mudaram).
- **(b) Precedência única, histerese, divergência.** Regras em `core/state/precedence.mjs` (documentadas também em `FONTES-DE-DADOS.md`, "Precedência por campo"):
  GEP fresco e **consistente** > tela/arquivo do jogo > nada (a estimativa continua só em `analysisInputs`, sempre marcada `levelEstimated`/"estimado");
  estágio: arquivo do jogo (Sentry) > GEP > tela (como antes). (A tela saiu dessas duas ordens em 2026-10-11.) **Histerese**: com as duas fontes presentes, a fonte ativa só troca depois de **3 leituras
  seguidas** em que outra é a preferida (`HYSTERESIS_READINGS`); se a ativa perde o valor, a outra assume na hora; a 1ª leitura de uma partida escolhe direto.
  **Divergência**: GEP e tela com valor e discordando por 3 leituras seguidas = **uma** divergência (por episódio); o servidor grava `AVISO GEP e tela divergem em <campo>`
  e `/api/state.gameState.divergence = {total, byField, last, current, readings}` conta. Uma "leitura" é uma chamada de `stateHub.seen` (as do `GET /api/state` e as do POST contam).
  GEP e tela nunca saem discordando: o `screen` entregue tem UM valor e `sources.<campo>` diz de quem é. (Desde 2026-10-11 a divergência
  contada é só GEP × arquivo do jogo, no estágio; o log diz "GEP e arquivo do jogo divergem em <campo>".)
- **(c) Servidor fonte de ouro, nível e inventário.** O POST faz `Object.assign(options, analysisInputs(seen, ...))` depois do `validate`, então `level/gold/levelEstimated/levelSource`
  do payload perdem para o estado do servidor; o inventário do cliente só entra em `replayGameId`. O `validate` aceita payload sem `level` (e continua validando o antigo). D6 (corrida
  entre ouro/nível do cliente e a loja do servidor) deixa de existir: tudo sai de **uma** chamada de `seenState` por POST.
- **(d) `sources.bench = "manual"` -> `null`**: `game-log.mjs:mergeSources`, `gep-reader.mjs:mergeGep`; testes ajustados (`tests/game-log.test.mjs`, `tests/gep-reader.test.mjs`).
- **(e) Nível, ouro, XP, estágio, itens e loja na mesma camada.** Regras preservadas: nível lido > piso derivado do XP > estimativa (`reduceLevel` é o corpo do antigo
  `levelTracker.apply`, só que puro; `tests/level.test.mjs` não mudou); consumíveis fora de `items` (continua em `gep-reader`/`screen-reader`, via `core/catalog/items.mjs` do M2; o `screen-reader` foi removido em 2026-10-11).
- **(f) Rota estática.** `sendStatic` lê antes de `writeHead(200)`: arquivo ausente responde `404 {"error":"Arquivo não encontrado."}`, tipo não web `404 "Rota não encontrada."`.
  Corrigi também o bloco `files` (`/economy.mjs`, `/rules.mjs`, `/live-mock.*`) pelo mesmo motivo (lê, depois escreve).

**Golden: antes/depois.** Esperado **idêntico** (nenhuma regravação), **não executado**. Por quê: (1) o harness continua uma transcrição do POST e agora chama a mesma
`analysisInputs`; os cenários declaram `level`/`gold` em `client` (herança do payload antigo), e o harness os entrega como "o que o servidor leria" (`seen.level`, `seen.gold`, `sources.level`) com
`estimatedLevel = client.level` quando `levelEstimated` (o cenário `eliminated-recorded`), então `options.level/gold/levelEstimated/levelSource/shop/xp/stage/removers/hasRemover/augmentIds` saem com os mesmos valores
de antes nos 17 cenários (conferi um a um: `levelSource` é "tela" em todos menos "estimado" no `eliminated-recorded`, e virou "lido" em 2026-10-11; `gold` null em `gold-unknown` e `replay-final`); (2) `options.inventory` ao vivo agora é
`recommendInventory([], seen)`, que dá `[]` como antes (nenhum cenário põe `client.inventory`); (3) a ordem das chaves de `options` mudou (as chaves vêm de `Object.assign`), o que só afeta a chave de cache
`JSON.stringify(options)` do servidor, não a resposta; (4) `parseStage` aceita `\d+` onde havia `\d`: só diferiria com estágio de 2 dígitos, que o jogo não tem; (5) nenhuma regra numérica foi tocada.
Se o golden mudar, o suspeito é o harness (`tests/golden/harness.mjs`, trecho do `Object.assign`), não a regra.

**Testes novos e ajustados** (nenhum executado):

- `tests/core-state.test.mjs` (20 testes): relógio, a tabela de XP única (`GAME` usa os objetos de `XP`), `Field`, `reduceLevel` = rastreador, `levelConsistent`, precedência (GEP vence; sem GEP vale a tela, o que deixou de valer em 2026-10-11;
  estágio do Sentry; histerese N=3 incluindo o "pisca-pisca" que zera a contagem; a fonte ativa que perde o valor cede na hora), divergência (um evento por episódio, atraso passageiro não conta, segundo episódio, loja e itens comparados por
  conteúdo), nível do GEP inconsistente (abaixo do piso, abaixo do já aceito, partida nova zera), `GameState`, `analysisInputs` (ao vivo, derivado, estimado, ouro não lido, partida revista, o payload defasado perde — D6),
  e o montador `createStateHub` com fontes falsas (GEP e tela nunca discordam, divergência registrada e contada, volta da tela e do GEP com histerese, nível do GEP contradizendo o estágio, `sources.bench = null`).
- `tests/static-files.test.mjs` (+2): 404 limpo da rota estática com um servidor HTTP em porta efêmera (`/v2/js/nao-existe.js`, `/core/nao-existe.mjs`, `/v2/css/nada.css` -> 404 JSON; `README.md` -> 404 de rota; arquivo existente -> 200 `text/javascript`;
  o servidor segue de pé); e `rules.mjs` (que o mock carrega no navegador) só importa módulos que o servidor serve.
- `v2/js/api.test.mjs`: a chave de análise reage a ouro/nível/itens/piso derivado pelo **estado** (não mais pelo payload) e a decisões do usuário; o payload só leva decisões; a partida revista mantém os campos antigos (+2 testes).
- `tests/game-log.test.mjs`, `tests/gep-reader.test.mjs`: `bench` `"manual"` -> `null`.
- Não consegui escrever (por falta de fixtures sem rede e sem snapshot do jogo) um teste que **faça POST real** com `level/gold` defasados: o servidor precisa de `TFTEoGStats.json`. A garantia é a de unidade acima (`analysisInputs` por cima do
  cliente) mais a composição `Object.assign(options, analysisInputs(...))` no POST (e no harness); a confirmação com o jogo aberto é manual.

**Catraca: o que desceu** (calculada pelo leitor estático da própria `RULES`; ver `scripts` do scratchpad, fora do repositório).

| Item                                                | Antes                                       | Depois                                                                                                                |
| --------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| T2 `stage-round-parse`                              | 8 (game-log, gep-reader, rules, server + 4) | **4** (live-mock, plan-progress, streak, model.js)                                                                    |
| T2 `server-option-assembly` (`options.X =` no POST) | 39                                          | **33** (loja, oferta, XP, removedores e estágio)                                                                      |
| T2 `gold-literal-threshold` (`server.mjs`)          | 1 (validação `gold > 999`)                  | 1 (inalterado)                                                                                                        |
| T1, T3                                              | -                                           | sem exceção nova: `core/state/*` só importa de `core/`, `rules.mjs` e `level.mjs` (candidatos a núcleo) só de `core/` |
| D12 (`server.mjs`)                                  | 1.394 (teto)                                | 1.351 linhas (dentro de 95-100 % do teto; **não baixei o teto**, outros passos também mexem no arquivo)               |

**Exceções que restam desta frente.** (1) `live-mock.js`, `plan-progress.mjs`, `streak.mjs`, `v2/js/model.js` ainda têm parse de "S-R" próprio (M5). (2) `v2/js/model.js` ainda calcula a fonte do nível
no cliente (`hero.levelSource`) a partir de `screen.sources.level`; passa a ler `gameState.me.level` quando a v2 for para o `/api/state` novo. (3) `scripts/bench-state.mjs` recompõe a rota sem a etapa de precedência (mede
`mergeSources`/`levels`/`mergeGep` como antes): ajustar para `createStateHub` na rodada de medição. (4) `gep-reader.mjs`/`game-log.mjs` ainda têm `Date.now` como relógio padrão (D13): o hub aceita `now`, mas as fontes ainda não
o recebem do hub; fica para o M8. (5) O `streaks.observe` ainda recebe o estágio do `seen` do `/api/state` e do POST (duas chamadas por ciclo avançam a histerese duas vezes: aceitável, mas é uma "leitura" por chamada, não por tempo).

**Riscos e pendências.**

1. **Reiniciar o servidor da 3218** (já exigido pelo M3, agora também pelo M7): o cliente novo **não manda `level`**; o servidor antigo responderia `400 "Nível deve ser de 1 a 11."` a todo POST. O processo em execução serve `v2/` do disco
   a cada requisição, então o cliente novo chega antes do servidor novo. Sem reinício, a interface deixa de analisar. Não reiniciei nem fiz GET no servidor vivo.
2. A histerese conta chamadas, não tempo. Com a tela aberta em duas abas as leituras dobram (a troca de fonte demora metade do tempo); com nenhuma tela aberta o estado não avança (ninguém chama). Se isso importar, o passo seguinte é
   contar por `now` (já é injetável: `createStateHub({now})`) com um intervalo mínimo entre leituras.
3. `levelConsistent` usa o piso do XP passivo e o "nunca cai" do GEP; um GEP legítimo que desse um nível **abaixo** do piso (compra de XP nunca diminui; regra do estágio 1 não verificada) seria descartado e registrado como tela
   (desde 2026-10-11, sem tela: o nível sai como piso derivado). O estágio 1 não tem piso (como em `level.mjs`).
4. A reserva (`gepBench`) continua sendo aplicada sempre que o GEP está ativo e a traz (não passa pela histerese: não tem outra fonte).
5. `gameState.me.*.at` usa `now - ageMs`; o `ageMs` do GEP é o do evento no banco (relógio do TFTAcademy). Em máquina com relógio fora de hora o `at` sai errado; `ageMs` é o campo confiável.
6. Se o `GET /api/state` ficar mais pesado: `gameState` soma ~2 KB; listas vêm como contagem.

### M5b - limiares de ouro e vida (`core/economy/`)

**Nada foi executado** (suíte, golden, `UPDATE_GOLDEN`, benchmarks e a catraca ficam para o orquestrador; só `node --check` nos arquivos tocados, busca e revisão por
leitura; testes escritos e ajustados por leitura). O passo **não acrescenta regra de jogo**: unifica onde as cópias estavam e mantém cada valor de antes.

**Decisões do usuário aplicadas.** Um só piso de reroll rápido; superconjunto onde regras divergem; ESM puro em `core/` (sem `node:*`/`Date.now`/`Math.random`).
Sobre o risco por vida e tendência: **só o que já estava na política** (`pressureOf`: ritmo da queda média em 3 rodadas até 15 de vida, ou 3+ perdas recentes com vida até 65).
"Derrotas restantes pelo dano do estágio" (`pesquisa/02-economia-nivel-rolagem.md`, `planos/a-fazer/PLANO-TOTAL.md` F3) **não está na política atual** e portanto **não foi acrescentado**.

**O que existe agora (`core/economy/`, importa só de `core/`)**

| Módulo         | Regra                                                                                                                                                                                                                                           | Substitui                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tables.mjs`   | `INCOME` (ouro base 5, passo de juros 10, teto 5, ouro por sequência), `HP.max` (100), `ROUND.pve` (7)                                                                                                                                          | `GAME.baseIncome/interestStep/interestMax/streakGold` (saem de `GAME`; `pveRound` passa a vir daqui), `INTEREST_STEP/CAP` e `GOLD_PER_SHOP` do cliente, o `100` de `streak.mjs` e do HUD |
| `policy.mjs`   | `POLICY` inteira (movida sem mudar valor de `curve`, `hp`, `floor`, `urgency`, `horizon`, `contested`, `star`, `roll`...) mais os números que eram literais espalhados: `hp.low/comfortable/shaky`, `trend.*`, `weakLobbySpare`, `shopsAhead.*` | `POLICY` de `economy.mjs` (que reexporta o MESMO objeto) e os literais de `target-level`, `augment-advice`, `streak`, `strategy`, `engine`, `hud.js`, `live-mock.js`                     |
| `gold.mjs`     | `interestOf`, `nextTier`, `tierFloor`, `maxInterestGold`, `interestTiers`, `streakGold`, `incomeOf`, `projectGold`, `shopsAhead` (lojas ao alcance do motor, com o 30 g de ouro não lido em `POLICY.shopsAhead.assumedGold`, D14)               | as funções de `economy.mjs` (reexportadas), a renda inline de `engine.mjs` (`GAME.baseIncome + min(interestMax, floor(ouro / interestStep))`), os `50` de teto de juros                  |
| `pressure.mjs` | `pressureOf` (faixa, piso, urgência, horizonte; tendência lida de `POLICY.trend`)                                                                                                                                                               | `economy.pressureOf` e os literais `15`, `3` e `65` dele                                                                                                                                 |
| `rounds.mjs`   | `nextRound`, `isPvp`, `roundLabel` (só o que a projeção de ouro usa; o parse "S-R" fica para o M5c)                                                                                                                                             | as de `economy.mjs`; some também o `roundIndex` (privado, sem uso, apontado como morto no M5)                                                                                            |

**Consumidores trocados** (edições mínimas, arquivo por arquivo)

- `economy.mjs`: sem `POLICY`, juros, renda, projeção, rodadas e `pressureOf` (reexporta do núcleo; `interestOf` importado para `bestSpend`). O que fica é o que ainda não é M5b: `sellValue`, `curveLevel`, `levelCostOf`, `rerollLevelOf/finalLevelOf/rollLevelOf`, `lobbyStrength`/`mightOf`, `isContested`, curvas, `rollSim`, `bestSpend`.
- `rules.mjs`: `GAME` sem `baseIncome`, `interestStep`, `interestMax` nem `streakGold`; `pveRound: ROUND.pve`.
- `engine.mjs`: `shops = shopsAhead(options.gold)` no lugar de `goldNow`/`income` inline; sem o import de `GAME`.
- `strategy.mjs`: `maxInterestGold()` no lugar de `50` (`interestAt`, "Economize até", `reach50`, texto "Juros no máximo"); colchão depois de comprar XP lido de `POLICY.floor.*` (perigo `danger` 10, reroll antes do nível `healthy` 50, 3★ inviável e `Math.min(floor, ...)` `hurt` 30); `spare >= POLICY.weakLobbySpare` (6). `roll.mjs` e `stage.mjs` não tinham limiar de ouro/vida literal (consomem `pressureOf` e `tierFloor` pelo `economy.mjs`): sem mudança.
- `streak.mjs`: `HP.max` no filtro de leitura inválida; `POLICY.trend.drops/windowMs` na tendência (`pressureOf` e `streak.trend` leem a mesma política). O `Date.now()` padrão (D13) e o parse "S-R" ficam (M7/M5c).
- `target-level.mjs`: `POLICY.hp.low/hurt/comfortable` e `maxInterestGold()`; `augment-advice.mjs`: `POLICY.hp.hurt/shaky/weak`; `v2/js/ui/hud.js`: `maxInterestGold`, `interestTiers`, `HP.max`, `POLICY.hp.danger` (a barra "baixa" é a faixa de perigo); `v2/js/model.js`: `SHOP.cost` no lugar de `GOLD_PER_SHOP`, sem `INTEREST_*`; `live-mock.js`: `E.maxInterestGold()`, `E.POLICY.floor.healthy`.

**D4 (um só piso de reroll rápido).** `POLICY.floor.fastReroll` (20) com `POLICY.hp.fastReroll` (50) é o único par, lido só por `strategy.mjs`; o `rollBudget` do motor saiu no M5a. Os demais limiares de vida que
eram "próprios" ficaram **com o valor de antes**, agora como chaves nomeadas da mesma política: `hp.low` (35) e `hp.comfortable` (70) do nível-alvo, `hp.shaky` (40) do aprimoramento de economia
(`>= 60` e `< 50` do aprimoramento viraram `hp.hurt` e `hp.weak`, mesmos números e mesmos operadores). **Não** os encostei nas faixas do `pressureOf` (por exemplo `low` 35 contra `danger` 30) porque isso
mudaria o nível-alvo para HP 31-35 e 70 (campo `targetAuto` do golden e do servidor); é decisão de produto, e a política já é o lugar de fazê-la (um número em `policy.mjs`). Pendência: dizer se `low` deve
virar `danger`.

**Diferenças esperadas no golden: nenhuma.** Cada substituição conserva o valor e o operador (`>=`/`<`/`<=`) e o motor, a estratégia e o nível-alvo calculam as mesmas contas:

| Troca                                                                   | Por que o resultado é o mesmo                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine.shops` por `shopsAhead`                                         | `incomeOf(g).total` = `5 + min(5, floor(g/10))` para ouro ≥ 0; mesma soma (`3 + floor(max(0, g + 4*renda - 10) / 2)`); `gold ?? 30` ficou em `POLICY.shopsAhead.assumedGold`. Único caso não coberto: ouro **negativo** (a validação do servidor rejeita) |
| `50`/`10`/`30` da estratégia por `maxInterestGold()` e `POLICY.floor.*` | os valores da política são 50, 10 e 30; só mudam se alguém perturbar a política (o teste de sensibilidade do golden faz isso de propósito)                                                                                                                |
| `nextTier`/`tierFloor` com teto lido a cada chamada                     | antes o teto era uma constante calculada na carga; sem perturbação são iguais (com `INCOME.interestMax` perturbado agora o teto do medidor acompanha)                                                                                                     |
| `target-level` e `augment-advice` por `POLICY.hp.*`                     | `35`, `60`, `70`, `40`, `50` iguais; `gold >= 50` por `maxInterestGold()` (50)                                                                                                                                                                            |
| `isPvp`/`nextRound` com `XP.*` e `ROUND.pve`                            | os mesmos 4, 7, 4 e 7 do `GAME`                                                                                                                                                                                                                           |

Qualquer diferença do golden é defeito do M5b, não esperado. O `synthetic-strategy.json.gz` também não deve mudar (chama `strategy()`; os pisos e colchões têm os mesmos valores).
**Teste de sensibilidade do golden** (`tests/golden.test.mjs`): a perturbação do teto de juros passou de `GAME.interestMax` para `INCOME.interestMax` (a tabela do núcleo); continua exigindo que mude pelo menos um cenário.

**Catraca (T2) - o que desceu**

| Regra                         | Antes                                                                | Depois                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `interest-constants`          | 23 (economy 8, engine 2, rules 2, model.js 2, hud.js 9)              | **0**                                                                                                                                                        |
| `gold-literal-threshold`      | 5 no produto (live-mock 1, server 1, strategy 1, target-level 2)     | **1** (`server.mjs`: `gold > 999`, validação de entrada; sai no M7)                                                                                          |
| `hp-literal-threshold`        | 11 (augment-advice 3, economy 1, streak 1, target-level 5, hud.js 1) | **0**                                                                                                                                                        |
| `gold-default` (`gold ?? 30`) | 1 (engine)                                                           | **0**                                                                                                                                                        |
| Regras novas (baseline vazio) |                                                                      | `income-table-read` (`INCOME.`/`baseIncome` fora do núcleo), `gold-keep-literal` (`levelCost >= N`, `Math.min(floor, N)`, `spare >= N`, `nextTier(..) ?? N`) |
| Teste novo no `architecture`  |                                                                      | `D4 (M5b)`: `fastReroll` só em `strategy.mjs`, `rollBudget` não volta e as funções de ouro/vida não são redefinidas fora de `core/economy`                   |

(As contagens "antes" desta tabela são as de verdade no início do M5b, depois do M5a; a tabela T2 do M1 acima é histórica.)

**Testes.** Novo: `tests/core-economy.test.mjs` (reexportação sem cópia, juros e renda, teto lido a cada chamada, `shopsAhead` contra a conta antiga do motor para 0-150 g e ouro não lido,
calendário, `pressureOf` com tendência e perturbação da política, `streak.trend` pela política, nível-alvo pela política e pelo teto de juros, pureza de `core/economy`). Ajustados:
`tests/golden.test.mjs` (perturbação do teto de juros) e `tests/architecture.test.mjs` (as regras acima). **Nenhum foi executado.**

**Pendências / riscos**

- Rodar a suíte inteira e o golden (esperado idêntico) é o primeiro passo do orquestrador; depois `ARCH_REPORT=1 node --test tests/architecture.test.mjs` para conferir as contagens acima (a única fora do zero é `server.mjs`, `gold > 999`).
- Fora do M5b e ainda com literal: o parse "S-R" (`streak.mjs`, `model.js`, `plan-progress`, `server.mjs`...), o fallback `level >= 8 ? 5 : ...` do motor, `stageSeen` por `foeLevel` na estratégia, `tactics.power`/`stage.strength`/`STAR` redeclarado (`might-formula`), a trilha de aprimoramentos e o `Date.now()` padrão de `streak.mjs` (T3): ficam para o M5c/M7.
- `mightOf`/`lobbyStrength`/`isContested` continuam em `economy.mjs` (força é M5c, junto com `might-formula`).
- `v2/js/ui/hud.js` e `v2/js/model.js` importam de `/core/economy/*` e `/core/pool/*`: o servidor da 3218 já serve `/core/*` desde o M3; se estiver anterior a isso, precisa reiniciar para a interface carregar. Não reiniciei nem fiz GET.
- `GAME.winGold` e `GAME.pveRound` não têm leitor (ficaram por compatibilidade; `ROUND.pve` é o dono).

### M6 - posse de itens (`core/items/`)

**Nada foi executado** (suíte, golden, benchmarks e `UPDATE_GOLDEN` ficam para o orquestrador; só `node --check` nos arquivos tocados,
busca por padrões e revisão por leitura; os testes novos e os ajustados também **não foram executados**). As afirmações de "idêntico"
abaixo são por leitura do código antigo contra o novo, linha a linha.

**O que existe (`core/items/`, ESM puro, sem `node:*`/`Date.now`/`Math.random`, importa só de `core/catalog` e de si mesmo)**

| Módulo         | Regra                                                                                                                                                                                                                                                                                                                                                                                            | Substitui                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stock.mjs`    | gastar UMA cópia: `takeOne` (id ou predicado), `takeItem` (a exata primeiro; o radiante vale o item base), `takeAll` (tudo ou nada), `spend` (o que falta e o que sobra, sem mutar), `hasAll`, `takeHalf` (metade de receita), `fillRecipe` (banco + uma peça solta que a peça já leva)                                                                                                          | os 21 laços `indexOf/findIndex + splice` de `carousel`, `engine` (2), `item-edge` (2), `item-holdings`, `tactics` (6), `comp-items` (5), `item-source`, `next-item` (2)                                             |
| `holdings.mjs` | `locateItem`/`ownersOf`/`buildStates` (a regra da Formação, movida), `classifyHoldings` (a regra aplicada comp a comp: posicionado, banco, quem sai, quem fica sem usar, montar com banco, montar com componentes de outras peças, metade da receita, `taken`, ausente), `HOLD_KINDS`, `AVAILABLE_KINDS`, `kindFromOrigin`/`craftKindFromOrigins`, `progressStatus` (o vocabulário do checklist) | `item-source.js` (a regra inteira), `item-holdings.resolveHoldings` (a classificação), `item-plan.kindOf`, a cadeia de status de `plan-progress`, `baseItem`/`isComponent`/receita de `item-source`/`item-holdings` |
| `bank.mjs`     | `spendBankOnBuilds` (equipado, item pronto exato ou radiante, montagem completa) e `spendBankHalves` (metade de receita), na ordem das peças recebidas (o carry primeiro)                                                                                                                                                                                                                        | os laços da aba Comps (`comp-items.js`)                                                                                                                                                                             |
| `moves.mjs`    | `movesInto(passes, peça)`, `movedInto(passes)` (peça -> ids base), `coveredKeys(passes)` ("peça:item"), sempre pelo item base                                                                                                                                                                                                                                                                    | `tactics.coveredByMoves`, `stage.movedIn`, o `find` de `plan-progress`, o `flatMap` de `model.js`                                                                                                                   |
| `owned.mjs`    | `ownedItems`, `itemStock` (completos e componentes), `readyRecipes` (receitas que o banco fecha), `movableItems` (banco + o que está em peça que sai)                                                                                                                                                                                                                                            | `engine`: `ownedItems`, `itemStock`, `readyRecipes`, `movable`                                                                                                                                                      |

**Consumidores trocados** (edições mínimas)

- `item-holdings.mjs`: só a POLÍTICA do motor (`HOLD_VALUE`) e o inventário recomendado; `resolveHoldings` = `classifyHoldings` + valor por situação (mesmo formato: `{unit,id,kind,value,from,available}`, `counts`, `carry`). `AVAILABLE` reexporta `AVAILABLE_KINDS`.
- `item-plan.mjs` (situação por origem via `kindFromOrigin`/`craftKindFromOrigins`, `isPart` por `isComponent`/`isEmblemTool`, `baseItemId`), `item-value.mjs` (`baseItemId`), `item-edge.mjs` (o caminho sem localização e o `resolved` gastam por `takeOne`/`takeAll`).
- `engine.mjs`: `ownedItems`/`itemStock`/`readyRecipes`/`movable` do núcleo, `planRecipes` por `recipeMap`; sem import de `v2/`.
- `tactics.mjs`: `fillRecipe` na build (usa o banco e a peça solta), `spend` no `ownedItemAdvice` e nas dicas de sinergia, `takeOne` na lista de peças soltas, `coveredKeys`, `recipeOf` no lugar de `composition.length === 2`. `carousel.mjs`: `takeOne`. `stage.mjs`: `movedInto`. `plan-progress.mjs`: `movesInto` e `progressStatus`.
- `v2/js/item-source.js`: reexport fino de `core/items/holdings.mjs` (a regra morreu aqui). `model.js` e `ui/champ-items.js` importam do núcleo (`movesInto`, `ownersOf`, `buildStates`); `v2/js/comp-items.js` reexporta `baseItemId` do catálogo e usa `bank.mjs`/`stock.mjs`/`recipeOf`; `v2/js/next-item.js` usa `takeOne` e `baseItemId`.

**Diferenças de comportamento (cada uma justificada).** Em TODO o caminho do motor (golden, ranking, `itemHoldings`, `itemPlan`, `tactics`, `stage`, checklist, carrossel) o resultado é **idêntico** ao de antes do M6: cada bloco foi comparado com o antigo por leitura e a equivalência está fixada em `tests/core-items-holdings.test.mjs` com as implementações antigas copiadas. As únicas diferenças:

| #   | Onde                                        | Cenário                                                                                                                        | Antes -> depois                                                                                                                            | Justificativa                                                                                                                                               |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formação (`locateItem`; UI, fora do golden) | peça que fica com cópia SOBRANDO do item (tem 2, a build dela pede 1)                                                          | `taken` ("só em X") -> `move` ("mover de X")                                                                                               | o motor já gastava primeiro a cópia que a peça usa e cedia a outra (`moveStay`); a Formação ignorava cópias. T4 exige que as duas vejam o mesmo estado      |
| 2   | Formação (`locateItem`)                     | o item só existe em peça que fica e usa, e o banco tem os dois componentes (ou um)                                             | `taken` -> `ready` "monta agora" (ou `half` "falta 1")                                                                                     | o motor já preferia montar/metade a `taken`; mostrar "só em X" escondia que dá para montar outro. `taken` só vale sem como montar                           |
| 3   | Formação (`locateItem`)                     | peça que fica, que já TEM o item que a build dela pede, e leva componentes soltos da receita de outro item que outra peça pede | os soltos eram guardados (a peça era tratada como "usa o item") -> a peça cede os soltos e o item monta ("mover componente de X e montar") | o motor já cedia (depois de gastar a cópia que ela usa, a peça deixa de pedir o item); só quem AINDA precisa do item guarda os componentes (igual nos dois) |
| 4   | Banco (`takeItem`)                          | banco com o item e o radiante dele                                                                                             | gastava a primeira cópia que casasse -> gasta a EXATA primeiro                                                                             | determinismo; a situação (`bank`) e o valor não mudam, só qual cópia sobra no banco restante (também igual ao `comp-items`, que já fazia assim)             |
| 5   | `coveredKeys` (tactics)                     | passe de item radiante (só a Luva do Ladrão sai com o id cru; os demais já saem com o id base)                                 | chave "peça:id cru" -> "peça:id base"                                                                                                      | radiante = item base em todo lugar; nenhum candidato (`additions`) é a Luva, então nada que dependia da chave muda                                          |

Não é diferença: `parts.splice(parts.indexOf(usesHeld), 1)` (que tiraria o ÚLTIMO se o id faltasse) virou `takeOne`, equivalente porque `usesHeld` sempre está na receita.

**O que não mudou (e por quê).** Pesos e política: `HOLD_VALUE`, `itemProfile`/`freeProfile`/`itemFit` do motor (somas e pesos dos componentes por família: política do motor, o papel vem de `core/catalog`), `item-plan` (atribuição húngara com valor medido), `tactics.build` (tabelas de pontos), `tactics.itemMoves` (quem recebe cada item passado), `stage.bankItems` (a que unidade o item do banco vai: consome a lista `ready` do conselho, não o estoque) e o carrossel (pontos por uso). A classificação de cada um desses vem do núcleo; o que ele pontua, não.

**T4 (consistência cruzada, seção 3.3).** `tests/core-items-holdings.test.mjs` compara, em estados sorteados, (a) a Formação (`locateItem`) com o motor (`classifyHoldings`) para o primeiro item de uma peça, com as nove situações, e (b) a aba Comps (`compItems`) com o motor para o banco (`ready`/`radiant` = `bank`, `craft`, `on`, `half`; `missing` = `absent`/`half`/`taken`). O checklist (`plan-progress`) lê a mesma posse por `progressStatus`/`movesInto`. A aba Comps só vê banco e o que a peça usa (não olha outras peças), por isso o par aba x motor é verificado em estados sem item sobrando em outra peça; a metade de receita da aba gasta o componente e a do motor não (o motor pode dizer `half` onde a aba diz `missing`, nunca o contrário).

**Catraca (T1/T2) - o que desceu**

| Regra / exceção                                                                | Antes                                                                                                        | Depois                                                                                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 `engine`/`item-holdings`/`item-plan`/`item-value` -> `v2/js/item-source.js` | 4 exceções                                                                                                   | **0** (T1 sem nenhuma exceção)                                                                                                                |
| `item-stock-consumption` (indexOf/findIndex + splice sobre estoque)            | 21 (carousel 2, engine 2, item-edge 2, item-holdings 1, tactics 6, comp-items 5, item-source 1, next-item 2) | **0** (dono: `core/items/stock.mjs`); a lista de nomes cobre também `remaining`, `inventory`, `bankLeft`, `loose`, `stockAll`, `missingNames` |
| `radiant-base-id`                                                              | 2 (comp-items, item-source)                                                                                  | **0**                                                                                                                                         |
| `component-id-literal`                                                         | 7 (item-holdings, item-plan, item-source, live-mock 4)                                                       | **4** (só `live-mock.js`)                                                                                                                     |
| `item-recipe-length`                                                           | 3 (comp-items)                                                                                               | **0**; o padrão agora pega também `(composition?.length ?? 0) === 2` (era a forma de `tactics.mjs`)                                           |
| `item-holdings-reimplemented` (regra nova)                                     |                                                                                                              | **0**: `locateItem`, `ownersOf`, `classifyHoldings`, `buildStates`, `spendBank*`, `movedInto`, `movesInto` só em `core/items/`                |

**Testes.** Novo `tests/core-items-holdings.test.mjs` (22 testes, **não executados**): estoque (`takeOne`/`takeItem`/`takeAll`/`spend`/`takeHalf`/`fillRecipe` contra os laços antigos copiados), Formação e `resolveHoldings` contra a implementação antiga copiada em centenas de cenários sorteados com semente fixa (o sorteio continua até produzir as nove situações), os três pontos de diferença da Formação acima (dirigidos, não sorteados), invariante de cópias (nenhuma situação a mais do que as cópias que existem), `compItems` contra o `compItems` antigo copiado (linhas, emblemas e sobras), `nextItemRecipe` contra o antigo, passes (`movedInto`/`coveredKeys`/`movesInto` contra `stage`/`tactics`/`plan-progress`/`model`), contas de `owned` e o caminho sem localização do `item-edge`, `HOLD_VALUE` x `HOLD_KINDS`, T4 (dois testes), pureza de `core/items` e "ninguém mais importa `item-source.js`". `tests/architecture.test.mjs`: T1 sem exceção, as quatro regras acima e a regra nova. Existentes lidos e que continuam valendo sem mudança: `tests/item-holdings.test.mjs`, `tests/item-plan.test.mjs`, `v2/js/item-source.test.mjs` (importa o reexport; os casos de `taken` têm banco vazio), `v2/js/next-item.test.mjs`, `v2/js/comp-items.test.mjs` (importa `baseItemId` do reexport), `tests/formation-items.test.mjs`, `tests/carousel.test.mjs`, `item-edge.test.mjs`.

**Pendências / riscos**

- Rodar a suíte e o golden (esperado idêntico ao estado anterior ao M6; o golden ainda carrega os diffs pendentes de M2/M4/M5b/M7) é o primeiro passo do orquestrador; depois `ARCH_REPORT=1 node --test tests/architecture.test.mjs`.
- O arquivo de teste novo é grande e tem sorteios adaptativos (até 8.000 cenários); se algum ficar lento, baixar o teto.
- `stage.bankItems`, `tactics.itemMoves`, `item-plan` e `carousel` continuam com a sua política de atribuição (quem recebe o quê); migrá-las para um motor `items` é do M9.
- `live-mock.js` ainda tem 4 ids de componente e os papéis de item escritos (M5/M9).
- `overlay/hud/hud.mjs` (outra frente) importa `buildStates` de `/v2/js/item-source.js`: segue funcionando pelo reexport (que resolve `/core/items/holdings.mjs`, servido em `/core/*`); quem cuida do overlay pode trocar o import para o núcleo.
- Revisão por leitura (subagente, sem executar nada) apontou e corrigiu um defeito real do teste T4: a Formação excluía do reservatório de componentes soltos a peça que fica e já tem o item que usa, o motor não (diferença 3 acima); o `locateItem` agora segue o motor e o teste ganhou o caso dirigido. Registrou também, sem ação: o filtro do banco de `stage.bankItems` (`isComponent`/`isConsumable`) e o `coverageOf` por substring de `tactics.build` vêm do M2 (já documentados) e `baseItemId(null)` agora dá `""` em vez de `"null"`.
- Não toquei no formato de nenhuma saída (`itemHoldings`, `itemPlan`, Formação, Próximo item).

### Próximo passo

Rodada final de testes (orquestrador): suíte inteira, `UPDATE_GOLDEN=1 node --test tests/golden.test.mjs` conferindo o diff do M2 contra a tabela
acima (e o do M4), `ARCH_REPORT=1 node --test tests/architecture.test.mjs` para confirmar os números da catraca. Depois: M6 (posse de itens; troca as cópias de
`baseItem`/`isComponent`/receita de `item-source.js`, `comp-items.js` e `item-holdings.mjs` pelas funções de `core/catalog/items.mjs`) e o fato `lobby.threat` (D15).

**Atualização (M8b).** M6 e M8b estão escritos (ver as seções deles). A rodada final tem agora, além do que está acima: `node --test tests/recommend-graph.test.mjs tests/snapshot-identity.test.mjs tests/core-graph.test.mjs`
(testes novos do M8b, nunca executados), conferir que o golden só muda em `shop-cache-d1` passo 3 (diff D1, tabela do M8b) antes de `UPDATE_GOLDEN=1`, `ARCH_REPORT=1` para confirmar `manual-memo-key` = 1 (`engine.mjs`),
`server-option-assembly` = 17 e a regra T7; e uma execução do golden com o grafo em modo `verify` (`createRecommendGraph({ verify: true })`) para provar que `analyze`, `tactics`, `stagePlan` e `strategy` não mutam entradas
nem saídas memoizadas. Depois: dividir `analyze` em fatos (M9: pool/livres/chance, itens por localização, parte estática x dinâmica da base) e, com o backtest, decidir a quantização de `economy.shopsAhead`.

### Rodada final

Primeira execução da suíte inteira depois da migração: 836 testes, 811 passavam e 25 falhavam. Esta subseção cobre 8 dessas falhas (as 17 do golden foram tratadas à parte). Nenhuma regra de jogo mudou: seis eram guardas de teste desatualizadas ou com defeito próprio e duas eram falsos positivos de nome em código de produção (renomeados, sem mudar comportamento).

| Teste                                                 | Causa                                                                                                                                                                                                                          | Correção                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D5 (M5a) `architecture.test.mjs`                      | Falso positivo: `strategy.mjs` fazia `const { call: _call, ...decision } = d`; a guarda procura `.decision` e casa com o `...decision` do spread (variável local, não o módulo removido).                                      | Local renomeada para `strategyCore` em `strategy.mjs`. A guarda continua estrita.                                                                                                                                                              |
| D4 (M5b) `architecture.test.mjs`                      | Falso positivo: `v2/js/wisps.js` define um helper local `pressureOf` que só lê a faixa que o servidor já mandou (`strategy.panels.economy.pressure`); não é a regra de pressão. O nome colidia com o de `core/economy`.        | Helper renomeado para `serverPressureBand`. A guarda continua proibindo `pressureOf` fora de `core/economy`.                                                                                                                                   |
| `core-augment-emblem.test.mjs` (servidor e harness)   | Guarda desatualizada: lia `app/recommend.mjs` procurando `.grants(chosen)`, mas desde o M8b a chamada está no fato `traits.grants` de `app/recommend-facts.mjs`.                                                               | A guarda confere que o fato chama `grants(chosen)`, que `app/recommend.mjs` e o harness consomem `recommend-facts.mjs`, e que nenhum de `server.mjs`, `app/recommend.mjs`, `app/recommend-facts.mjs` e do harness tem a cópia da regra (`Crest | Crown | Circlet`, `function augmentEmblem`). |
| `core-economy.test.mjs` (pressão; nível-alvo)         | Defeito do teste: `const H = POLICY.hp` é o mesmo objeto que `perturb` altera, então `H.danger + 5` lido dentro do callback já usava o valor perturbado.                                                                       | `H` e `T` viram cópias (`{ ...POLICY.hp }`, `{ ...POLICY.trend }`) dos valores de fábrica; as asserções são as mesmas.                                                                                                                         |
| `overlay-hints.test.mjs` (verbosidade; ordem estável) | Guarda desatualizada: a visão de teste tem nível na barra, então o gerador emite também o selo passivo `level:seal` (prioridade 20, só no detalhado; especificado em outros testes). Os números esperados não o contavam.      | `total` 11 passa a 12; `hidden` `[7,5,2]` passa a `[8,6,3]` (conferido: a única dica a mais é o selo); no caso do id repetido, `total` 2 e a única dica visível continua sendo `buy:U0`, sem repetição.                                        |
| `v2/js/names-guard.test.mjs`                          | Guarda desatualizada: cinco linhas novas usam `.name` apenas como texto de dica (`title`) ou nome de aprimoramento, com a imagem desenhada por `itemPortrait`/`portrait`: `ui/comps.js` (2), `ui/steps.js` (2), `main.js` (1). | Cinco exceções documentadas (arquivo, trecho exato e motivo) em `EXCEPTIONS`. A regra e a varredura não mudaram.                                                                                                                               |

Resultado dos arquivos após a correção: `architecture` 52/52, `core-augment-emblem` 6/6, `core-economy` 10/10, `overlay-hints` 27/27, `names-guard` 4/4; vizinhos tocados por renomeação: `strategy` 27/27, `core-wisps` 15/15, `v2/js/wisps.test.mjs` 5/5. A catraca de arquitetura não ganhou nem perdeu exceção.

#### Golden: triagem das 17 falhas `golden: <cenário>` e regravação

Os 17 cenários falhavam (as 7 outras asserções do arquivo passavam: ids únicos, determinismo, cobertura, sensibilidade, transcrição fiel, D1 e `synthetic-strategy`). Método, sem regravar às cegas:

1. `scripts/golden-triage.mjs` (novo) roda cada cenário e lista os **caminhos** que diferem do esperado, agrupados com índices trocados por `*`; compara `compRanking` por **id da comp** (a ordem vira o caminho `compRanking.__order`), porque comparar por posição espalha uma troca de ordem em centenas de falsos caminhos (1.430 caminhos em `late-lvl9-critical` viram 207; 8.583 em `shop-cache-d1` viram 972). Não grava nada.
2. Cada caminho foi classificado contra as diferenças esperadas (M2, M4, M5a, M8b; M5b, M6, M7, M9 e M10 esperados idênticos: nenhum caminho deles apareceu).
3. **Prova por reversão, em cópia do projeto no scratchpad** (o código real não foi tocado): (a) na cópia, o `engine.mjs` voltou aos classificadores antigos de papel de item (as 11 montáveis em `flex`, a regex antiga do motor): **todas** as diferenças de M2 (`itemProfile`, `fit`, `total`, `components.*`, `reasons`, `rank`, `compRanking.__order`) desaparecem, em todos os cenários; (b) além disso, o `roll.mjs` da cópia voltou a arredondar a pool livre (`Math.round(remainingLikely)`, a regra antiga de `likelyFree`): **todas** as diferenças de `strategy.panels.rolling.*`, `ev.roll.*` e `reasons` desaparecem. O que sobra é só `pool[*].free` (novo), `decision`, `playbook`, `roll` (removidos) e, em `shop-cache-d1`, o passo 3 (M8b). Ou seja, não há nenhuma diferença sem causa documentada: **nenhum defeito de código da migração foi encontrado e nada foi corrigido em código de produção**.
4. `scripts/golden-verify.mjs` (novo) roda os 17 cenários com o grafo em modo `verify` (cada fato roda duas vezes, saída congelada, mutação de entrada acusa `IMPURE`) e confere que a resposta é idêntica à do modo normal: **17/17 ok** (`analyze`, `tactics`, `stagePlan` e `strategy` não mutam entradas nem saídas memoizadas).
5. Só então `UPDATE_GOLDEN=1 node --test tests/golden.test.mjs`: 17 arquivos regravados, `synthetic-strategy.json.gz` e `header.catalogSha256/augmentsSha256` intactos. Três execuções seguintes sem a variável: 24/24, 24/24, 24/24; a triagem dá 0 diferenças nos 17.

Tabela da triagem (caminhos que mudaram, por passo da migração):

| Cenário                    | M2 papel dos 11 itens (`itemProfile`; `compRanking[].fit/total`; `recommendations[].components.fit/items`, `reasons`)                                                                                                                                 | M4 (`pool[*].free` novo; `strategy.panels.rolling.*`, `ev.roll.*`) | M5a (remoções: `decision`, `recommendations[i].playbook/roll`) | M8b                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opening-lvl3`             | não (sem itens)                                                                                                                                                                                                                                       | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `early-lvl5-shop`          | só `fit`/`total`/`components`/`reasons` (`freeProfile.ad` +1,5; `itemProfile` igual): fit +3                                                                                                                                                          | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `mid-lvl7-streak`          | idem: fit +6                                                                                                                                                                                                                                          | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `late-lvl9-critical`       | `itemProfile` ad 1->2, flex 5->4; fit +4; 3 comps trocam de posição perto do 54º lugar (`rank` 54->56)                                                                                                                                                | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `items-bank-lvl8`          | `itemProfile` ap 6,8->7,8, flex 4,5->3,5; fit -5,5 em 20 comps (Morellonomicon equipada deixa de casar com portador não-AP)                                                                                                                           | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `pinned-comp-swap`         | `itemProfile` ap 5,2->6,2, flex 3->2; fit +6; `buildFit.mismatch` 4->5, `orphanItems` +1                                                                                                                                                              | sim (+ `preview.playbook`, `preview.strategy`)                     | sim                                                            | n/a                                                                                                                                                                         |
| `augments-chosen-offer`    | `itemProfile` ap 5,2->6,2, flex 3->2; fit +4,5; 2 comps trocam de posição (`rank` 59->58)                                                                                                                                                             | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `auto-comp-swaps`          | não                                                                                                                                                                                                                                                   | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `plan-sequence` (3 passos) | só `fit`/`total`/`components`/`reasons` nos 3 passos (fit +6); `itemProfile` igual                                                                                                                                                                    | sim (3 passos)                                                     | sim                                                            | n/a                                                                                                                                                                         |
| `shop-cache-d1` (3 passos) | `itemProfile` ap 5,2->6,2, flex 3->2 e fit +6, nos 3 passos                                                                                                                                                                                           | sim (3 passos)                                                     | sim                                                            | **sim, só no passo 3**: `compRanking[*].score` e `scoreParts.shop` (26 comps), `rank`/ordem (17 comps), `recommendations[1].compScore.score` 26,2->31,7 e `parts.shop` 0->1 |
| `eliminated-recorded`      | `itemProfile` ad 1->3, flex 3->0, tank 6->7; fit +5,5; `components.build` 2,16->-9,84 e `buildFit.mismatch` 0->3 numa recomendação (mesma causa: itens equipados que eram `flex` e agora têm papel; a reversão do papel na cópia zera estes caminhos) | só `pool[*].free` (sem banco oculto, como previsto)                | sim                                                            | n/a                                                                                                                                                                         |
| `gold-unknown`             | não                                                                                                                                                                                                                                                   | sim (também `rolling.targets`: ver nota 1)                         | sim                                                            | n/a                                                                                                                                                                         |
| `viewed-rival`             | `itemProfile` ap 4->5, flex 3->2; fit -5,5 em 20 comps                                                                                                                                                                                                | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `rich-lvl10`               | `itemProfile` flex 2->1, tank 5->6; fit +1,5                                                                                                                                                                                                          | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `reroll-hidden-banks`      | `itemProfile` flex 2->1, tank 5->6; fit +1,5                                                                                                                                                                                                          | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `danger-hp27`              | não                                                                                                                                                                                                                                                   | sim                                                                | sim                                                            | n/a                                                                                                                                                                         |
| `replay-final`             | não                                                                                                                                                                                                                                                   | sim (também `rolling.targets`: ver nota 1)                         | sim                                                            | n/a                                                                                                                                                                         |

Conferido contra as previsões: os `itemProfile` acima batem, um a um, com a coluna "antes -> depois esperado" da tabela do M2; os 5 cenários marcados "não" no M2 (`opening-lvl3`, `gold-unknown`, `auto-comp-swaps`, `replay-final`, `danger-hp27`; mais `synthetic-strategy`, que nem muda) ficaram sem nenhum caminho de M2; nenhum caminho de `stage`, `currentPlan.itemMoves`, `carousel`, `contest`, `augmentAdvice`, `planProgress` ou `teamCode` mudou em nenhum cenário; `recommendations[].roll`/`playbook`/`decision` foram só removidos (21 `decision`, 63 `playbook`, 63 `roll`, 1 `preview.playbook`); `shop-cache-d1` passo 3 é a única diferença do M8b e **só aparece lá** (nos passos 1 e 2 é idêntico, e o `planProgress`/`challenger` do passo 3 e as 3 recomendações não mudam: a decisão 4 do M8b, plano mantido inteiro, não teve efeito no golden).

Notas:

1. **Previsão errada do M4 (não é defeito).** A linha 6 do M4 dizia que `gold-unknown` e `replay-final` (`gold: null`) mudariam "apenas pelo item 1". Mudam também `rolling.targets[*]` e `curve`, porque a lista de alvos e a curva existem sem ouro lido e esses dois snapshots têm banco oculto em meias cópias; a causa é a mesma (pool livre fracionária: a reversão do arredondamento na cópia zera essas diferenças). `eliminated-recorded` (sem banco oculto) mudou só em `pool[*].free`, como previsto.
2. **A rolagem e a pool continuam diferindo em 92 de 704 alvos** (`chancePerSlot` da rolagem x `pool[].chancePerSlot`): é a regra antiga e deliberada de `roll.teamOf` (linha 95: cada peça comprada na loja sai do denominador do custo), não a D3; nos demais 612 os dois são iguais.
3. **Efeito de M2 que baixa o `fit`** (`items-bank-lvl8`, `viewed-rival`: -5,5 em 20 comps): é o lado "papel deixa de ser `flex`" da decisão 1 (superconjunto): a Morellonomicon equipada, que casava com qualquer portador, agora só casa com portador AP; comps sem portador AP livre perdem o ponto de compatibilidade. A mudança de ordem do ranking se limita a posições baixas (54º-59º), nunca às 3 recomendações exibidas.
4. `tests/golden/scenarios.mjs`: a `desc` de `shop-cache-d1` passou a descrever o M8b (a asserção D1 do `tests/golden.test.mjs` já estava invertida pelo M8b e passa: `cached[2] != cached[1]` e `cached == fresh`, e o passo 3 esperado difere do passo 2, o que no esperado antigo era igual: `compRanking` com o mesmo `scoreParts.shop`/`score` nos dois).
5. Tempo: o golden inteiro leva ~14,6 s; a triagem, ~4 s; o `golden-verify`, ~15 s.

### Remoção da leitura de tela (2026-10-11, branch `tft-helper-sem-ocr`)

Decisão do usuário (2026-10-11): o sistema fica **sem OCR** e com o GEP do TFTAcademy (`%APPDATA%\TFTAcademy\tft-events.db`) como fonte
de ouro, nível, XP, loja, banco de itens, removedores, Wisps e aprimoramentos. Sem o Overwolf/TFTAcademy esses campos ficam
**desconhecidos explícitos** ("GEP off · sem fonte"), sem reserva por tela e sem valor inventado, inclusive nos 0 a 55 s do início da
partida, antes do primeiro evento do GEP. A ponte GEP própria (`overwolf-bridge/`) fica fora por enquanto. Isso revoga a versão
anterior da decisão 7 ("a leitura de tela vira verificação cruzada") e a decisão de `FONTES-DE-DADOS.md` de que a tela seria a fonte
própria. Plano: `PLANO-REMOVER-OCR.md`; arquivo histórico e como restaurar: `.old/ocr/README.md`.

| Passo             | O que mudou                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 caracterização | `tests/no-screen.test.mjs`: uma partida gravada (`tests/fixtures/gep-events.json`) passa pelo montador de estado sem tela; GEP ausente ou obsoleto; o chip da interface; a chave de análise contra uma cópia congelada da regra                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P1 GEP primário   | `mergeGep` publica `noSource` (`noSourceOf`): o motivo de cada campo do jogador sem valor (o da fonte GEP, `aguardando-gep`, `loja-escondida`, `identidade-<estado>`, `nivel-maximo`). `levelSource` "tela" vira **"lido"** (núcleo, interface, overlay, validação do POST e harness do golden); o piso derivado deixa de contar como leitura na saúde do overlay. Wisps só do GEP (`wispsInState`): a loja não é relida pelo catálogo. Textos do motor sem "lido da tela"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P2/P4 leitor fora | `screen-reader.ps1`/`.mjs`, `screen-glyphs.json`, `bench-candidates.mjs`, `reconcileLevel`/`levelFromXp`, ferramentas de medição, testes e fixtures de tela movidos com `git mv` para `.old/ocr/`. `server.mjs` sem leitor, sem `POST /api/screen-capture` e sem `screenReader` em `/api/health`; `stop.ps1` e o laço automático não ligam nem matam leitor. Estado: `gameFilesState` (Sentry) → precedência (só o estágio tem duas fontes: arquivo do jogo > GEP, histerese de 3 leituras, divergência GEP × arquivo do jogo) → `mergeGep` → nível (observado pelo GEP, aceito só se `levelConsistent`, ou piso derivado do último observado) → `noSource`. Origens de campo sem `"screen"` e confiança sem `"read"`. Interface e overlay: chip "GEP off · sem fonte" com a lista do que falta; saúde "data" do overlay ("Sem fonte: ..." / "Dados do jogador pelo GEP"). `tests/architecture.test.mjs` falha se algo fora de `.old/` importar ou citar `.old/`, usar `screen-reader`, `Windows.Media.Ocr`, captura de tela, glifos, templates de ícone ou calibração, ou se o servidor e os scripts iniciarem leitor |
| P3 estado neutro  | `GET /api/state` publica o estado visto em `seen` (sem o apelido `screen`); POST, laço automático, interface, overlay e `live-mock` leem `seen`. `core/state/analysis-key.mjs` lê `state.seen` e mantém o rótulo interno "screen" da chave para ela continuar idêntica (comparada com a regra congelada). `app/live-snapshot.mjs` lê os arquivos antigos (estado em `screen`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P5 documentação   | `README.md`, `FONTES-DE-DADOS.md` (tabela-resumo, "Nível", "Banco de itens e loja", precedência; seção do leitor trocada por "Leitura de tela (removida)"), este documento (decisão 7 e notas "(removido em 2026-10-11)" nos registros antigos), `core/README.md`, `overlay/README.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Golden.** A diferença registrada é só textual: `analysis.levelSource` passa de "tela" a "lido" e os textos do motor "Ouro/Nível/XP não
lido da tela" passam a "... sem fonte agora" (ex.: "Ouro sem fonte agora" em `synthetic-strategy`). **Nenhum número nem ranking muda.**
O golden **já falhava na base** desta remoção, alheio a ela: `catalog.json` e `augments.json` mudaram e o `header.catalogSha256` /
`augmentsSha256` gravado não bate mais.

**Em aberto** (não mudou): o nível de reserva `FALLBACK_LEVEL = 7` em `core/state/inputs.mjs` (decisão D4 do plano), usado sem nível
observado, sem piso e sem tabuleiro, sempre marcado `levelEstimated`/"estimado". Os dados ignorados pelo git
(`tft/data/screen-calibration.png`, `tft/data/item-icon-candidates.json`) vão para `.old/ocr/data/` com `mv` quando a branch for aplicada
(a worktree não tem `tft/data/`).

**Suíte.** Os 33 testes exclusivos de tela e os trechos de tela dos testes mistos foram para `.old/ocr/tests/`. Contagem
(`node --test tests/*.test.mjs v2/js/*.test.mjs *.test.mjs` na worktree): antes 1039 testes, 1013 passando e 26 falhando; depois
1010 testes, 985 passando e 25 falhando. As 25 falhas são todas anteriores à remoção (golden com catálogo novo, catracas T2 e D12,
score/plano de comps e "estado da comp"); a 26ª da base era a geometria `Hud-Rect` do `.ps1`, que foi para o arquivo histórico.

## Compra de cópias e itens por campeão (apresentação; sem mudança de plano nem de ranking)

Duas regras novas moram em `core/` e são lidas por `v2/js/model.js`, que a interface e o overlay (`overlay/hud/view.mjs`) já compartilham:

- `core/pool/buy-copies.mjs` (`copyBuys`, `nextStar`): a lista "Comprar" do servidor (`stage.buyNow`) só tem peças que faltam; peça do plano em campo ou na
  reserva (abaixo de 3★, com cópias na pool para o próximo marco) ganha uma linha `how: "copy"` que só aparece enquanto a loja a mostra. O servidor
  (`stage.mjs`, `golden`) não mudou: a loja de agora é lida no cliente (`shop-match.js`), que é mais fresca que a do instante da análise.
- `core/items/champion-items.mjs` (`championItems`, `stateBrief`): os até 3 itens ideais de um campeão com a situação de cada um (`locateItem`/`buildStates`, a regra
  da Formação) e o rótulo curto. Passo "Itens dos campeões" do modelo, cartão "Itens dos campeões" do overlay (até 4, o resto "+N") e linha `buildsRow` da interface.

Testes: `v2/js/buy-copies.test.mjs`, `tests/champion-items.test.mjs`, `tests/overlay-hints.test.mjs` (dica `Compre` de cópia). Detalhes em `overlay/README.md` e `FONTES-DE-DADOS.md`.
