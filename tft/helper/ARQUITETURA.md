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

```
 fontes (cada uma com seu formato e sua idade)
 ├ TFTEoGStats.json    capture.mjs (watch+500 ms, parse próprio)  ┐
 │                     server.mjs:readBoardSnapshot (cache mtime)  ├ duas leituras/parses do mesmo arquivo
 ├ __sentry-event + TFT.log   game-log.mjs (estágio, fase; compras)
 ├ LCU (lockfile, GET)        server.mjs:readLcu (cache 5 s)
 ├ tela (OCR/ícones)          screen-reader.ps1 + screen-reader.mjs (ouro, nível, XP, loja, banco de itens)
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
| Fonte do banco                                             | `screen-reader.mjs` (+ `.ps1`, ícones, filtro `CONSUMABLE` de `item-tiers.mjs`); `bankReading` em `v2/js/items.js`                                                                                                                                           |
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
| Fonte      | tela (`screen-reader`), manual inexistente; GEP (`gep-reader.mjs: parseGold`) ainda não ligado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Cópias** | `engine.mjs:analyze` (`goldNow = options.gold ?? 30`, `income`, `shops = 3 + floor((gold + 4*income - 10)/shopCost)`: renda sem sequência e com default de 30 g, diferente de `incomeOf`); `engine.mjs` (`rollBudget` com piso 20/50 por `health <= 35`); `playbook.mjs` (`gold < 50`, `gold >= 50`); `decision.mjs` (`gold < 30`); `target-level.mjs` (`gold >= 50`); `v2/js/model.js` (`GOLD_PER_SHOP = 2`, `INTEREST_STEP = 10`, `INTEREST_CAP = 50`) usadas por `ui/hud.js`; `v2/js/math.js` (`cumulativeCurve`, `shopsFor`: binomial de reserva no cliente); `plan-progress.mjs` (copia `state.gold`) |

#### c) Nível, XP, estágio

| Papel                             | Lugar                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabela                            | `rules.mjs:GAME.xpToNext`, `passiveXp`, `stageOneRounds`...                                                                                                                                                                                                                                                           |
| Regra                             | `rules.mjs`: `levelFromXp`, `levelsForXp`, `reconcileLevel`, `roundNumber`, `passiveXpBetween`, `levelFloor`                                                                                                                                                                                                          |
| Validação/estado                  | `screen-reader.mjs:accept` (chama `reconcileLevel`), `level.mjs:levelTracker.apply` (âncora, piso), `game-log.mjs:mergeSources` (precedência do estágio), `server.mjs:seenState` (**chamada em `/api/state` e de novo em `/api/recommend`**; `apply` é com estado)                                                    |
| Custo de subir                    | `economy.mjs:levelCostOf` (parse de "atual/total")                                                                                                                                                                                                                                                                    |
| **Cópias de parse "atual/total"** | `v2/js/model.js:parseXp`, `economy.mjs:levelCostOf`, `rules.mjs:levelsForXp`/`levelFromXp`/`levelFloor` (regex própria cada uma)                                                                                                                                                                                      |
| **Cópias de parse "S-R"**         | `server.mjs` (regex em `/api/recommend`), `v2/js/model.js:parseStage`, `plan-progress.mjs:rank`, `rules.mjs:roundNumber`, `level.mjs` (regex), `economy.mjs:roundIndex` (privada e **sem uso**)                                                                                                                       |
| **Cópias da curva/rodadas**       | `economy.mjs:curveLevel`/`POLICY.curve`; `engine.mjs` (fallback `level >= 8 ? 5 : ...` quando não há estágio); `strategy.mjs` (`stageSeen` por `foeLevel`); `augment-advice.mjs` (`{2:"2-1",3:"3-2",4:"4-2"}`); `plan-progress.mjs:AUGMENT_ROUNDS`; `v2/js/augs.js:AUG_STAGES` (3 cópias da trilha de aprimoramentos) |
| Nível dito pelo cliente           | `api.js:recommendPayload` envia `level`, `levelSource`, `levelEstimated` lidos do `/api/state` anterior; `server.mjs:validate` aceita 1..11                                                                                                                                                                           |

#### d) Loja

| Papel                              | Lugar                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Odds                               | `rules.mjs:ODDS` (patch 18.3, marcada "não confirmada no 18.4")                                                                                                                                                                                                                                          |
| Leitura                            | `screen-reader` (5 nomes -> ids); `server.mjs` POST: `options.shop = seen.shop.map(...)`                                                                                                                                                                                                                 |
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
| Veredito                        | `decision.mjs:decide` e `playbook.mjs:playbook`: **a v2 não lê nenhum dos dois** (ver 1.3-D5)                                                                |

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
  SQLite, OCR, LCU ou rede.

### 2.2 Camadas (direção única: de baixo para cima)

```
 5 view      v2/js/model.js + v2/js/ui/*                      só exibe; importa core/ apenas tipos e funções puras de formato
 4 engines   core/engines/*                                   consomem fatos; sem acesso a estado cru, sem E/S, sem Date.now
 3 facts     core/facts/*   (grafo memoizado, graph.mjs)       funções puras de entradas nomeadas; early cutoff
 2 state     core/state/*   (schema, reduce, precedence)       GameState com Field<T> = valor + fonte + confiança + idade
 1 rules     core/rules/*   core/catalog/*                     tabelas do patch, política, índices do catálogo (puro)
 0 sources   sources/*      (gamefile, sentry, lcu, screen, gep, manual, meta, explorer)   E/S; falam com o estado por "ações"
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
 *   source: "gamefile"|"sentry"|"lcu"|"gep"|"screen"|"manual"|"derived"|"estimated",
 *   confidence: "observed"|"read"|"derived"|"manual"|"estimated",
 *   at: number | null,          // epoch ms da observação (não da regravação do arquivo)
 *   stale: boolean              // fora da janela de frescor da fonte (HOLD_MS da tela, GEP_STALE_MS, ...)
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
    state/    schema.mjs (typedefs + validate) · reduce.mjs · precedence.mjs · level.mjs (reconcileLevel/levelFloor)
    facts/    graph.mjs · economy.mjs · pool.mjs · shop.mjs · holdings.mjs · traits.mjs · force.mjs · lobby.mjs · clock.mjs
    engines/  comps/ · plan/ · roll/ · items/ · augments/ · contest/
  sources/    gamefile.mjs · sentry.mjs · tftlog.mjs · lcu.mjs · screen.mjs · gep.mjs · manual.mjs · meta.mjs · explorer.mjs
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
- **Tabelas por patch** (F0.2 do `PLANO-TOTAL.md`): `core/rules/tables/<patch>.json` com `fonte`, `confiança` e `verificado em`;
  trocar de patch muda dados, não código. O detector de patch (F0.4) marca a tabela como "não verificada".
- **Modo sombra** (F0.7): `core/rules/policy.mjs` aceita `{ shadow: true }` por regra; o motor calcula, o `round-log` grava, a tela
  não mostra. Só é possível porque a regra existe num lugar.
- **Fonte nova** = um adaptador em `sources/` que devolve `Field`s; a precedência por campo mora em `state/precedence.mjs`
  (ex.: `me.gold`: `gep` fresco > `screen` > null). Nada mais muda (3.A).
- **Relógio explícito**: `clock.now` entra no estado; `hiddenHoldings` e `streak.trend` recebem o tempo por entrada (acaba o
  arredondamento a 0,5 só para estabilizar a chave de cache, D13).

---

## 3. Como uma alteração se propaga

### 3.1 Exemplos (o que você edita, o que se ajusta sozinho, o que prova)

**A) Mudar a origem do ouro** (GEP no lugar do OCR): `gep-reader.mjs` já entrega `parseGold` com frescor.

- Edita: `sources/gep.mjs` (devolve `Field<number>` com `source: "gep"`), uma linha em `state/precedence.mjs`
  (`me.gold: ["gep", "screen"]` por frescor).
- Ajusta sozinho: `economy.income/shopsAhead/pressure`, estratégia, roll, `stage` (cartas "sem ouro"), `plan-progress`, o selo de fonte no
  HUD (`Field.source`), e o motor de comps (`shopsAhead`). `level.effective`, que hoje desconfia de OCR, aceita
  `confidence: "observed"` sem a plausibilidade extra.
- Prova: teste de precedência (GEP fresco, GEP velho, GEP ausente), golden do pipeline com `gold` vindo das duas fontes.

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
- `screen-reader.ps1`/`.mjs` (OCR e ícones) e `gep-reader.mjs`: são adaptadores; só mudam de pasta e passam a devolver `Field`.
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
   derivado de `level.mjs`).
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

## Apêndice A - Destino de cada arquivo (proposta)

| Hoje                                                                                                                 | Destino                                                                                                                                                                               | Observação                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rules.mjs`                                                                                                          | `core/rules/game.mjs` + `core/rules/tables/<patch>.json`; funções de nível -> `core/state/level.mjs`                                                                                  | reexport em `/rules.mjs`                                                     |
| `economy.mjs`                                                                                                        | `core/rules/policy.mjs` (POLICY), `core/facts/economy.mjs` (juros, renda, pressão, XP), `core/math/shop-math.mjs` (`closeCurve`, `rollSim`, `bestSpend`, `mulberry32`, `binomialPmf`) | reexport em `/economy.mjs`                                                   |
| `level.mjs`, `streak.mjs`, `pool-tracker.mjs`                                                                        | `core/state/level.mjs` (redutor), `core/facts/economy.mjs` (sequência pura), `core/facts/pool.mjs`                                                                                    | a parte com estado do `levelTracker`/`streakTracker` fica em `app/trackers/` |
| `engine.mjs`                                                                                                         | `core/engines/comps/*`                                                                                                                                                                | último passo (M9)                                                            |
| `evidence.mjs`                                                                                                       | `sources/explorer.mjs` (rede/cache) + `core/engines/comps/evidence-filters.mjs` (filtros puros)                                                                                       |                                                                              |
| `item-edge.mjs`, `comp-score.mjs`                                                                                    | `core/engines/comps/`                                                                                                                                                                 |                                                                              |
| `item-holdings.mjs`                                                                                                  | `core/facts/holdings.mjs`                                                                                                                                                             | M6                                                                           |
| `tactics.mjs`                                                                                                        | `core/engines/plan/*` (posições, transições, passar itens), `core/engines/items/build.mjs`, `core/facts/lobby.mjs` (ameaça)                                                           |                                                                              |
| `stage.mjs`, `plan-progress.mjs`, `target-level.mjs`                                                                 | `core/engines/plan/*`                                                                                                                                                                 |                                                                              |
| `strategy.mjs`, `roll.mjs`                                                                                           | `core/engines/roll/*`                                                                                                                                                                 |                                                                              |
| `carousel.mjs`, `contest.mjs`, `augment-advice.mjs`                                                                  | `core/engines/items/carousel.mjs`, `core/engines/contest.mjs`, `core/engines/augments.mjs`                                                                                            |                                                                              |
| `plan-state.mjs`                                                                                                     | `app/trackers/plan-state.mjs` (persistência)                                                                                                                                          |                                                                              |
| `playbook.mjs`, `decision.mjs`                                                                                       | remover (decisão 5)                                                                                                                                                                   |                                                                              |
| `analysis-keys.mjs`                                                                                                  | removido em M8                                                                                                                                                                        |                                                                              |
| `game-log.mjs`, `unit-ledger.mjs`, `screen-reader.*`, `gep-reader.mjs`, `bench-candidates.mjs`, `server.mjs:readLcu` | `sources/*`                                                                                                                                                                           |                                                                              |
| `meta-comps.mjs`, `meta-builds.mjs`, `meta-stats.mjs`, `augment-stats.mjs`                                           | `sources/meta.mjs` (E/S) + `core/catalog` (formatos)                                                                                                                                  |                                                                              |
| `capture.mjs`, `replay.mjs`, `lobbies.mjs`, `match.mjs`, `diagnostics.mjs`                                           | `app/recording/*`, `app/telemetry.mjs`                                                                                                                                                |                                                                              |
| `team-code.mjs`, `build-*.mjs`, `download-assets.mjs`                                                                | `app/` e `tools/`                                                                                                                                                                     |                                                                              |
| `server.mjs`                                                                                                         | `server.mjs` (HTTP) + `app/recommend.mjs` + `app/state.mjs`                                                                                                                           |                                                                              |
| `v2/js/traits.js`, `item-source.js`                                                                                  | `core/catalog/traits.mjs`, `core/facts/holdings.mjs` (reexports finos em `v2/js/`)                                                                                                    |                                                                              |
| `v2/js/comp-items.js`                                                                                                | `core/engines/items/comp-items.mjs` (consome `holdings`)                                                                                                                              |                                                                              |
| `v2/js/model.js`, `ui/*`, `api.js`, `main.js`                                                                        | ficam em `v2/`                                                                                                                                                                        | `model.js` importa de `/core/*` só utilitários de formato                    |

## Apêndice B - O que li e como conferi

- Lidos por inteiro: `pesquisa/00-sistema-atual.md`, `FONTES-DE-DADOS.md`, `rules.mjs`, `economy.mjs`, `roll.mjs`, `strategy.mjs`, `stage.mjs`,
  `tactics.mjs`, `engine.mjs` (e as mudanças em curso), `item-holdings.mjs`, `item-edge.mjs` (função principal), `plan-progress.mjs`, `plan-state.mjs`,
  `analysis-keys.mjs`, `comp-score.mjs`, `playbook.mjs`, `decision.mjs`, `target-level.mjs`, `contest.mjs`, `replay.mjs`, `level.mjs`,
  `v2/js/{model,main,api,item-source,comp-items,items,traits}.js`, `server.mjs` (trechos de estado e todo o POST). Trechos: `game-log.mjs`, `carousel.mjs`,
  `augment-advice.mjs`, `meta-builds.mjs`, `item-tiers.mjs`, `capture.mjs`, `gep-reader.mjs` (cabeçalho), `PLANO-TOTAL.md` (roadmap F0-F12).
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
7. **Precedência GEP × leitura de tela:** nunca devem discordar na saída. Um único valor por campo, escolhido por `core/state/precedence`: GEP fresco e consistente > leitura de tela > estimativa. Quando as fontes divergem, usa-se o GEP, registra-se a divergência (log + contador no `/api/state`) e o valor não oscila entre fontes (histerese: só troca após N leituras concordantes). A leitura de tela vira verificação cruzada.
8. **Commit de checkpoint antes do M0:** autorizado. Antes de commitar: suíte verde, varredura de segredos (PlayerKey, token LCU, chave RSO, PUUID, nomes de jogadores) nos arquivos novos e nas fixtures, e `data/` pessoal fora do commit.

---

## Progresso da migração

Estado: **M0, M1 e M3 concluídos e verificados offline** (2026-10-10, executor `tft-migracao`; M0/M1 sobre o commit `49a17de4`, 350 testes;
M3 sobre `03f522fc`, 404 testes). M0 e M1 só fixaram o comportamento e mediram; o M3 é o primeiro a mover regra (traços e emblemas
para `core/catalog/traits.mjs`) com o golden **idêntico**. Sem commit (cabe ao orquestrador).

| Passo                       | Estado    | Observação                                                                                                      |
| --------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| M0 caracterização + medição | feito     | golden de 18 arquivos, `server.mjs` com `TEMPO` no log, 4 scripts                                               |
| M1 rede de arquitetura      | feito     | catraca com 20 regras (T2), T1, T3, D1, D12, D5; `core/README.md`                                               |
| M3 traços e emblemas        | feito     | `core/catalog/traits.mjs`; golden idêntico; T1 7 -> 4 exceções; T2 `trait-*` 6 -> 0; rota `/core/*`; 421 testes |
| M2, M4..M10                 | pendentes | M2 (catálogo de itens e campeões) é o próximo de menor risco; ele muda número (D2/D9), com `legacy` antes       |

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

`GET /api/state`, offline com os módulos reais do servidor (sem abrir porta, sem o leitor de tela, sem gravar):

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
`recommendations[i].roll`.

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
- Emblema de **aprimoramento** (`server.augmentEmblem`, `makeAugmentEmblem` no harness) continua no servidor: é o motor de aprimoramentos (M9), não o catálogo de traços.
- `tactics.mjs` ainda tem regex de papel/cobertura de item (`VoidStaff|LastWhisper|...`) e `/Emblem|ThiefsGloves/`: pertencem ao catálogo de itens (M2).

### Próximo passo: M2 (catálogo de itens e campeões)

M2 muda número em 11 itens (D2) e Leona (D9): primeiro o modo `legacy` (golden idêntico), depois a tabela única com o diff aprovado (decisão 1:
superconjunto de papéis); coordenar com `tft-motor-itens` (mesmo `engine.mjs`). Depois: M4 (pool e loja, D3 com pool fracionária).
