# PLANO - uma engine de itens para Ao vivo, Comps, Itens e overlay

Documento de design do TFT helper (`tft/helper`), escrito em 2026-10-11. Nenhum código foi alterado, nenhum servidor foi iniciado
(a 3218 não foi tocada) e nenhum `POST /api/recommend` foi feito. Só li código, `meta-*.json`, `catalog.json` e os arquivos
`tests/golden/expected/*.json.gz`, e rodei scripts de leitura offline (no scratchpad, fora do projeto).

Legenda: **[V]** verificado lendo o código; **[M]** medido por mim, offline, sobre arquivos que já estão no disco; **[P]** proposta (não
existe); **[?]** desconhecido. Linhas citadas são do disco de agora; `model.js`, `overlay/hud/*`, `carousel.mjs` e `meta-*.mjs` estão
sendo editados por outros agentes (seção 5), então confira a função antes de editar.

## 0. Resumo

1. Hoje "o melhor item de um campeão" é decidido por **quatro critérios diferentes** (valor medido, build publicada da comp, meta geral,
   heurística por papel) em **seis lugares**, e a "situação do item dado o inventário" fala **cinco vocabulários**. Ao vivo, Comps, overlay
   e carrossel mostram listas diferentes para o mesmo campeão na mesma comp (exemplos reais na seção 1.3).
2. O procedimento que você considera certo é o da aba Comps: `item-value.mjs` (valor medido por campeão x item) + `item-plan.mjs`
   (atribuição ótima dos **seus** itens, mais a lista de desejos do meta). Ele já existe, é puro e já alimenta o score; só não é usado fora da aba.
3. A engine proposta é `core/items/engine.mjs` (ESM puro, sem relógio nem `node:*`): **duas funções**, `rankChampionItems` (independe do
   inventário; pesado; memoizado no grafo do servidor) e `placeChampionItems` (dado o inventário; barato; roda no servidor, no navegador
   e no overlay). Tudo o mais (Próximo item, Equipar, Passar itens, Itens dos campeões, carrossel, checklist, aba Itens) vira **projeção** do resultado.
4. Encaixa no **M9** do `ARQUITETURA.md` como o motor `engines/items` (M2, M6 e M8b já entregaram o catálogo, a posse e o grafo que ele consome).
5. Migração em 11 passos pequenos, cada um com a catraca de consistência (S0) caindo até 0. O primeiro ganho visível (S3) troca só a
   leitura da Formação e do overlay para o dado que a aba Comps já recebe, sem mexer no servidor.
6. Achado urgente que afeta a qualidade da referência: o `meta-stats.json` que está no disco agora tem **0 de 589** pares casando com o catálogo (seção 1.4).

---

## 1. Mapa do que existe hoje

### 1.1 Quem decide ou mostra "melhores itens de um campeão" e "situação do item" [V]

| #   | Consumidor (arquivo:linha)                                                                                                                                                                                                                               | De onde vem a lista de melhores itens                                                                                                                                                                                                                                                                                                                           | Como trata o inventário                                                                                                                                                                                                                                                                                       | Quantos mostra                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Aba Comps**: `v2/js/ui/comps.js:192` `itemPlanBlock`, `:171` `planItem`, `:181` `wishItem`; dados: `engine.mjs:518-577` `planFor` -> `item-plan.mjs:138` `buildItemPlan` -> `item-value.mjs:53-118`                                                    | **Valor medido** por (campeão, item): colocação média do campeão com o item contra a do campeão (`stats.unitItem`/`stats.unit`), encolhida por amostra; sem par medido, item da build de meta geral (`metaBuilds`) com confiança <= 0,5. Não usa a build publicada da comp                                                                                      | Atribuição ótima (húngaro) dos itens do **banco**, dos **equipados** nas peças da comp e dos equipados em peças que **saem**; custo por situação `HOLD_VALUE` (equipado 1, banco 0,98, mover de quem sai 0,95, mover de quem fica 0,90, montar 0,90, montar com peça de outro 0,85); gasta cada cópia uma vez | Atribuições: <= 3 por campeão (menos os não-plano equipados). Desejos: <= 5 por campeão (`wishLimit`). Só campeões com algo |
| 2   | **Aba Comps, bloco sem plano**: `ui/comps.js:116` `compItemsBlock`, `v2/js/comp-items.js:65` `compItems`; "Builds e 3★" `ui/comps.js:73` `details`                                                                                                       | **Build publicada da comp** (`comp.builds[unit]`, 3 itens, MetaTFT `comps_data`); carry primeiro                                                                                                                                                                                                                                                                | `core/items/bank.mjs` (equipado, pronto, radiante, montar, metade); emblemas; só vê banco e o que a própria peça leva (não olha outras peças)                                                                                                                                                                 | 3 do carry + peças com algo do banco                                                                                        |
| 3   | **Aba Comps, ganho de média**: `item-edge.mjs:58` `itemEdge`, `ui/comps.js:70` `heldItems` ("Com seus itens: média")                                                                                                                                     | Build publicada + `buildStats` (variação encolhida, K=1500)                                                                                                                                                                                                                                                                                                     | `classifyHoldings` (`engine.mjs:578-606` `holdingsFor`), carry 1 / dano 0,5 / tanque 0                                                                                                                                                                                                                        | Até 3 campeões (pesos 1; 0,6; 0,35; teto 0,4)                                                                               |
| 4   | **Janela de itens do campeão (Formação)**: `v2/js/ui/champ-items.js:21`, `v2/js/model.js:329-354` (`c.build`), `core/items/holdings.mjs:130` `locateItem` / `:209` `buildStates`                                                                         | `plan.itemPlans[].ideal` = `tactics.mjs:118-444` `build`: **build publicada da comp primeiro**, depois meta geral (`wishlist`, `tactics.mjs:22`), medição só desempata (+-2,5) e só se a comp não tem build; bônus de lobby (+6 a +10), +20/+45 se montável, +30 se completa peça solta, -45 se "equipe já cobre o efeito"; heurística por papel se não há meta | `locateItem` (banco + equipados em outras peças + componentes soltos); `main.js:413-418` passa `latestState.screen.items` (cliente, tempo real)                                                                                                                                                               | `ideal.slice(0,3)`                                                                                                          |
| 5   | **Passo "Itens dos campeões"** (`model.js:498-524`, `core/items/champion-items.mjs:49` `championItems`, `stateBrief` `:11`)                                                                                                                              | Mesma `ideal` do item 4                                                                                                                                                                                                                                                                                                                                         | Mesmo `buildStates`; só em campo, com slot livre e algum item pendente; sem banco lido não aparece                                                                                                                                                                                                            | até 3 por campeão, todos os campeões                                                                                        |
| 6   | **Próximo item**: `stage.mjs:233-262`, `tactics.mjs:871-881` (`currentBuilds`), `v2/js/next-item.js:24`                                                                                                                                                  | `build()` de novo, mas sobre as peças **que você tem agora** (`ownedItemAdvice.builds[].additions`), com `coverage` montado de outro jeito (item 4 usa as peças do plano)                                                                                                                                                                                       | `fillRecipe` sobre `options.inventory` (servidor) + peça solta equipada; desconta `movedIn`                                                                                                                                                                                                                   | 1 por campeão em campo                                                                                                      |
| 7   | **Equipar**: `stage.mjs:233-321` + `tactics.mjs:889-951` (`ownedItemAdvice.ready`, ordem por `score + 60 montável + 25 carry + 10/4/-15`) e `bankItems` (item pronto no banco vai a quem tem `wishlist` melhor ou papel compatível, `stage.mjs:285-304`) | `additions` do item 6 e `wishlist` (comp + meta geral)                                                                                                                                                                                                                                                                                                          | estoque do servidor, gasta uma vez                                                                                                                                                                                                                                                                            | todos os que cabem                                                                                                          |
| 8   | **Passar itens**: `tactics.mjs:674-789` `itemMoves`, `model.js:470-482`                                                                                                                                                                                  | `wishlist` (comp + meta geral); carry primeiro; remove só se está fora da `wishlist` do dono ou se a peça sai                                                                                                                                                                                                                                                   | itens equipados em `analysis.self.units`                                                                                                                                                                                                                                                                      | por peça de origem, até o `slotsLeft` do destino                                                                            |
| 9   | **Checklist do plano**: `plan-progress.mjs:75-116` `freezeItems`, `:183-246`                                                                                                                                                                             | `ideal` do item 4, **congelado** na primeira vez (<= 4 peças x 3 itens)                                                                                                                                                                                                                                                                                         | `progressStatus` (`built/move/ready/partial/missing`) de `core/items/holdings.mjs:76`                                                                                                                                                                                                                         | 12 itens                                                                                                                    |
| 10  | **Carrossel**: `carousel.mjs:43` `scorePlans` / `:133` / `:155`, `app/carousel-view.mjs:96-137`, `core/state/carousel.mjs` (só detecta)                                                                                                                  | `itemPlans[].ideal` do item 4; peso 1 / 0,75 / 0,55 por posição na build; carry 3, tanque 1,6, resto 1                                                                                                                                                                                                                                                          | banco `seen.items`, gasta uma vez; `covered` = passes de `itemMoves`                                                                                                                                                                                                                                          | 5 (prioridade) ou todas as peças ofertadas                                                                                  |
| 11  | **Overlay**: `overlay/hud/view.mjs:215` `champsOf` (<= `CHAMPS_SHOWN`=4 campeões, depois "+N"), `:176` `nextOf`, `:234` `equipOf`, `:256` `movesOf`, `:270` `buildsOf`, `draw.mjs:162-194`, `hud.mjs:13,82,221`                                          | `champsOf`/`nextOf`/`equipOf`/`movesOf` leem os passos de `buildModel` (herdam os itens 5-8); `buildsOf` (widget "Itens da formação", oculto por padrão) chama `buildStates` por conta própria, importando `/v2/js/item-source.js` (reexport)                                                                                                                   | `bank = stateBody.screen.items`                                                                                                                                                                                                                                                                               | `champs` 4; `builds` todas as peças do plano com `build`                                                                    |
| 12  | **Aba Itens**: `v2/js/ui/items.js:296-355`, `item-tiers.mjs:103`, `server.mjs:275` `itemsPayload`                                                                                                                                                        | Item-cêntrica: tier por colocação média; "Quem mais usa" = `meta-builds.items[id].units` (**popularidade**, não valor)                                                                                                                                                                                                                                          | Nenhum (não olha seu inventário)                                                                                                                                                                                                                                                                              | `units` publicados                                                                                                          |
| 13  | **Score da comp**: `engine.mjs:726-745,1349-1357`, `comp-score.mjs:47-76`                                                                                                                                                                                | `planPoints(plan.total)` (item 1) 60 % + `itemGain` (item 3) 40 % da parte "itens" (peso 0,3); `engine.mjs` ainda tem `itemProfile/freeProfile/itemFit` por **papel** do item                                                                                                                                                                                   | `planFor` + `holdingsFor`                                                                                                                                                                                                                                                                                     | n/a                                                                                                                         |

### 1.2 Vocabulários de "situação do item" (cinco) [V]

| Onde                                                   | Valores                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `locateItem` / `stateBrief` (Formação, passo, overlay) | `on`, `ready` ("pronto no banco" ou "monta agora"), `move`, `taken`, `half`, `need`              |
| `classifyHoldings` / `item-plan` / `itemHoldings`      | `on`, `bank`, `move`, `moveStay`, `craft`, `craftMove`, `half`, `taken`, `absent` (`HOLD_KINDS`) |
| `progressStatus` (checklist)                           | `built`, `move`, `ready`, `partial`, `missing`                                                   |
| `compItems` (aba Comps sem plano)                      | `on`, `ready`, `radiant`, `craft`, `half`, `missing`                                             |
| `nextItemRecipe` (parte da receita)                    | `bank`, `equipped`, `missing`, `unknown`                                                         |

### 1.3 Divergências, com exemplos concretos [M]

Fontes dos números: `meta-comps.json` (60 comps, 227 pares comp x campeão com build), `meta-builds.json`, o `meta-stats.json` do commit `HEAD`
(ids certos) e os 17 cenários de `tests/golden/expected/*.json.gz` (lidos, sem rodar a suíte).

**D-I1. Dois critérios de "melhor" (Comps x Formação).** Comp `DA_18_Defender/DA_18_Rengar`, stats do `HEAD`:

| Campeão      | Build publicada da comp (base da Formação, antes dos bônus de inventário) | Aba Comps (desejos por valor medido)                                    |
| ------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cassiopeia   | Archangel's Staff, Blue Buff, Hextech Gunblade                            | Hextech Gunblade (0,328), Archangel's Staff (0,254), Void Staff (0,151) |
| Rammus       | Spirit Visage, Sunfire Cape, Warmog's Armor                               | Crownguard (0,487), Gargoyle Stoneplate (0,294), Spirit Visage (0,199)  |
| Fiddlesticks | Adaptive Helm, Archangel's Staff, Titan's Resolve                         | Ionic Spark (0,500), Sunfire Cape (0,421), Crownguard (0,404)           |

Nos 227 pares: o top-3 por valor tem o **mesmo conjunto** da build publicada em 15 (6,6 %), a **mesma ordem** em 1 e o **mesmo primeiro item** em 31 (13,7 %).
Nos goldens (58 linhas campeão x comp do plano): o primeiro item da aba Comps (atribuição, senão desejo) é o primeiro `ideal` da Formação em só **10** (17 %).
Malphite: Formação [Gargoyle, Protector's Vow, Crownguard]; Comps atribui [Warmog, Gargoyle] e deseja [Adaptive Helm, Spirit Visage, Steadfast Heart...].

**D-I2. Mesma Formação, duas builds (Próximo item/Equipar x Formação/carrossel/checklist).** `ownedItemAdvice.builds[].ideal` (item 6) x
`recommendations[0].itemPlans[].ideal` (item 4), mesmo campeão, mesmo golden: **5 de 49 pares** diferem, nenhum só de ordem. Ex. (rich-lvl10): Krug
`[Bramble, Evenshroud, Crownguard]` x `[Sunfire, Bramble, Evenshroud]`; Sentinel `[Bramble, Adaptive Helm, Ionic Spark]` x `[Sunfire, Bramble, Adaptive Helm]`;
reroll-hidden-banks, Mama Beak `[Giant Slayer, Kraken's Fury, Deathblade]` x `[Last Whisper, Giant Slayer, Kraken's Fury]`. Causa [V]: `build()` roda
duas vezes com `coverage` e peças de contextos diferentes (`tactics.mjs:587-598` x `:863-881`) e a cobertura aplica -45.

**D-I3. Luva do Ladrão.** `item-plan` aceita (`isPlanItem` não a exclui); `build()` a exclui (`tactics.mjs:161`) e `itemMoves` a trata à parte (`:688-725`).
Nos goldens: **472 de 6.742 atribuições** (7 %) do plano de itens da aba Comps são Thief's Gloves, e ela está no top-3 dos desejos em **2.369** linhas campeão x comp.
Exemplo: Rek'Sai recebe Thief's Gloves na aba Comps; a Formação nunca a mostra (0 ocorrências em `itemPlans[].ideal`). Em jogo a Luva ocupa os 3 slots.

**D-I4. Item de mana.** `build()` deixa só um entre Blue Buff e Spear of Shojin (`tactics.mjs:399`); `item-plan`/`rankedOf` não tem a regra (28 linhas de desejos
com os dois no top-3 nos goldens; 0 atribuições com dois).

**D-I5. Banco em instantes diferentes.** Aba Comps: `bankReading(screen).items` no cliente (`main.js:463`); plano de itens do servidor: `options.inventory`
(`recommendInventory`, leitura mais fresca do servidor); Formação: `latestState.screen.items` (`main.js:417`). Todos sem consumíveis (`screen-reader.mjs:108`), mas
a lista da aba Comps vem de uma análise que pode estar um ciclo atrás da Formação.

**D-I6. Dono do item.** `engine.mjs:115-122` junta campo e reserva num único registro por campeão (itens somados); `tactics.mjs:34-52` usa só a cópia de maior estrela;
`model.js:331-338` lista cada peça com `zone`.

**D-I7. Itens x carrossel.** O carrossel pondera pela posição na `ideal` (item 4), não pelo valor medido: pode mandar pegar componente de item que a aba Comps
considera fraco para aquele campeão.

**D-I8. Overlay duplica a si mesmo.** `items.champs` (<= 4 campeões, só em campo com item pendente, rótulos de `stateBrief`) e `builds` (todas as peças do plano, só
`s.state.kind !== "on"`) descrevem o mesmo dado com filtros e limites diferentes.

**D-I9. Aba Itens.** "Quem mais usa" é popularidade publicada, enquanto Comps usa valor; não há "melhor em" nem situação no seu inventário.

### 1.4 Dado: o `meta-stats.json` do disco não casa com o catálogo [M]

| Arquivo                                       | `fetchedAt`       | Ids de campeão/item                     | Casam com `catalog.json`?                    |
| --------------------------------------------- | ----------------- | --------------------------------------- | -------------------------------------------- |
| `meta-stats.json` no commit `HEAD`            | 2026-10-11T00:23Z | `DA_Draven18\|DA_GuinsoosRageblade`     | sim (579 de 579 pares)                       |
| `meta-stats.json` no disco agora (modificado) | 2026-10-11T13:23Z | `TFT17_Vex\|TFT_Item_GuinsoosRageblade` | **0 de 589 pares; 0 de 1.023 chaves `unit`** |
| `meta-builds.json`, `meta-comps.json` (disco) | 13:23Z / 16:33Z   | `DA_...`                                | sim (142 de 142 itens)                       |

Consequência [V]: com esse arquivo, `valueOf` nunca encontra "par"; todo valor da aba Comps cai em `build-meta` (confiança <= 0,5), `tactics.measured` nunca
dispara e as estatísticas de trunfo do motor (`stats.unit`) ficam vazias para o set 18. `meta-store.mjs` (novo, não commitado) valida só o **esquema**
(`validateStats`), não se os ids existem no catálogo. Não sei se foi mudança da MetaTFT ou escrita de um agente [?]; é o primeiro item do plano (S1).

---

## 2. Referência: o procedimento da aba Comps (o contrato da engine)

Tudo abaixo é o que `item-value.mjs` + `item-plan.mjs` + `ui/comps.js` fazem hoje [V]. A engine **preserva** isto como padrão.

1. **Candidatos de um campeão** (`item-value.mjs:98-106` `itemsOf`): chaves `stats.unitItem["campeão|item"]` do campeão **mais** a build de meta geral dele
   (`metaBuilds`, `unit_items_processed`), em ids base (radiante = item base), só itens de plano (`isPlanItem`: completo e equipável).
2. **Valor** (`:53-97` `valueOf`), em colocações (positivo = melhora), com teto +-0,5:
   - `par`: `(ref - avg) * n/(n + 5000)`, `ref` = média do campeão (`stats.unit[campeão][0]`, senão `baseAvg` 4,466);
   - `build-meta` (sem par, item na build de meta do campeão): `(baseAvg - avg_item) * 0,5 * count/(count + 50000)`;
   - sem dado: `null` (o item não é candidato).
3. **Ranking** (`:108-118` `rankedOf`): só valor > 0, ordem decrescente. **Empate**: ordem de inserção (chaves do `unitItem`, depois a build de meta); não há
   critério explícito [V], e o valor é arredondado a 3 casas, então empate acontece.
4. **Seus itens** (`item-plan.mjs:156-196`): equipados nas peças da comp (item de plano entra; emblema/artefato/componente solto ocupam vaga), equipados em peças que **saem**,
   e o banco. Componentes soltos formam receitas (<= 5 receitas úteis, <= 4 conjuntos de montagem).
5. **Atribuição** (`:67-125`, `:279-363`): húngaro exato maximizando a soma de `valor * HOLD_VALUE[situação]`; capacidade `SLOTS=3` menos vagas ocupadas por não-plano; um item por
   campeão não repete; item sem valor positivo no campeão não entra; cada cópia/componente gasta uma vez. O "carry" **emerge** (campeão cujos itens somam mais), não é dado.
6. **Saída** (`:365-443`): `assignments` por valor desc (`situation`: equipado, banco, mover, montar; `from`; `componentsNeeded`); `champions` por total desc; `total`;
   `wishlist` = por campeão, os melhores do `rankedOf` que você **não tem** (<= 5), campeões ordenados pelo valor do primeiro desejo.
7. **Tela** (`comp-items.js:205` `planView`, `ui/comps.js:192`): banco lido -> grupos por campeão (itens por valor, "acumulado") + desejos recolhidos; banco não lido -> **só** desejos
   ("Itens do meta para esta comp"). Só entra o que tem valor medido positivo; "nenhum item seu tem valor" é um estado explícito.
8. **Score** (`item-plan.mjs:34-43`, `comp-score.mjs:26-28,69-76`, `engine.mjs:1355-1357`): `planPoints(total) = 25 * (1 - e^(-total/2))` entra no ranking das comps; na parte "itens" do
   `compScore`, 60 % `1 - e^(-total/1,5)` e 40 % o ganho da build publicada (`itemGain/0,3`).
9. **Fallback sem plano** (`compItems`): build publicada da comp, carry primeiro, `spendBankOnBuilds` (equipado > o próprio > radiante > montar completo) e depois metades; emblema que dá ao carry uma
   sinergia nova; o que sobra do banco vai para "sem uso" com o motivo; consumíveis ficam fora. Isto **não** é o procedimento principal; vira o caso "sem dado medido" da engine.

Limites já documentados no código e que a engine herda: valor aditivo por item; mistura efeito do item com "partida rica" (piso otimista); amostra encolhida.

---

## 3. Arquitetura alvo

### 3.1 Um módulo, duas funções, várias projeções [P]

```
core/items/                      (já existem: stock, holdings, bank, moves, owned, champion-items)
  policy.mjs   [novo]  ITEM_POLICY: SLOTS, HOLD_VALUE, SHRINK_K, MAX_VALUE, META_BUILD_TRUST, WISH_LIMIT, MAX_CRAFT_SETS, MAX_RECIPES, PLAN_POINTS_*,
                       pesos do carrossel; CONSTRAINTS (travas e grupos exclusivos). Única fonte desses números.
  value.mjs    [de item-value.mjs]   tabela de valor (valueOf/rankedOf/wantsOf)
  assign.mjs   [de item-plan.mjs]    húngaro + conjuntos de montagem (algoritmo puro)
  engine.mjs   [novo]  API pública única (abaixo)
  vocab.mjs    [novo]  HOLD_KINDS (o ÚNICO vocabulário) + rótulo/marca/tom (hoje stateBrief) + mapa para o checklist
```

Nome e lugar: `core/items/engine.mjs` agora (não existe `core/engines/`); no M9, quando `comps`/`plan` se mudarem, vira `core/engines/items/` (renomeação mecânica,
`ARQUITETURA.md` 2.6). Regras de pureza do `core/` valem (sem `node:*`, `Date.now`, `Math.random`; não muta entrada; importa só de `core/`).

**API pública** (nenhum outro módulo calcula "melhor item" nem "onde está o item"):

| Função                                                                                         | O que faz                                                                                                                           | Custo / onde roda                                                                                             |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `rankChampionItems({ champions, meta, catalog, policy })`                                      | por campeão, lista ordenada de candidatos com valor, fonte, ordem da build publicada, restrições de jogo. **Não olha o inventário** | pesado; servidor, memoizado (fato do grafo `items.rank.K`, entradas: tabuleiro K + `meta.version` + catálogo) |
| `placeChampionItems({ ranked, champions, holders, bank, catalog, context, policy })`           | atribui os seus itens (húngaro), define a situação de cada recomendado (`HoldKind`), os passes, o uso do banco e o total            | barato; servidor (plano e score), navegador e overlay (com o banco fresco)                                    |
| `projectNext / projectEquip / projectPasses / projectCarousel / projectChecklist / projectRow` | projeções puras do resultado (um campeão, um passo, uma tela)                                                                       | trivial                                                                                                       |

### 3.2 Contratos (JSDoc) [P]

```js
/** @typedef {"on"|"bank"|"move"|"moveStay"|"craft"|"craftMove"|"half"|"taken"|"absent"} HoldKind */ // = HOLD_KINDS de holdings.mjs
/** @typedef {{ id:string, name:string, radiant:boolean, components:{id:string,name:string}[] }} ItemRef */

/** Entrada. Nada de relógio nem I/O; `bank.read=false` => só candidatos, nunca atribuição. */
/** @typedef {{
 *   champions: { id:string, name:string, isCarry?:boolean, zone:"board"|"reserve"|"plan", stars?:number }[],   // peças do plano/comp, em ordem de prioridade
 *   holders:   { id:string, name:string, zone:"board"|"reserve", stays:boolean, items:string[] }[],          // TODAS as suas peças; stays=false => cede o item
 *   bank:      { read:boolean, ids:string[], unknown?:number },                                              // sem consumíveis
 *   meta:      { version:string, pair:object|null, unitAvg:object|null, itemStats:object|null, generalBuilds:Map|object|null,
 *                publishedBuilds:Record<string,string[]>|null, baseAvg:number },
 *   catalog:   ItemCatalogView,                       // core/catalog/items.mjs (receita, papel, consumível, radiante, nome)
 *   context?:  { stage?:string, carousel?:{active:boolean, offer?:object[]}, threat?:object|null, passes?:object[] },
 *   policy?:   ItemPolicy                             // padrão = ITEM_POLICY
 * }} ItemsInput */

/** Um item recomendado para um campeão. `rank` é a ordem de exibição em TODAS as telas. */
/** @typedef {{
 *   item: ItemRef, rank:number,
 *   origin: "assigned"|"wish",                        // assigned: você já pode ter isto aí; wish: o meta valoriza e você não tem
 *   worth: { value:number, measured:number, confidence:number, samples:number,
 *            source:"par"|"build-meta"|"published"|"heuristic", publishedRank:number|null },
 *   kind: HoldKind, text:string,                      // situação no inventário e frase curta pt-BR
 *   from: {id:string, name:string}|null, have:string[], missing:string[],
 *   action: "keep"|"equip"|"craft"|"move"|"collect"|"wait",   // derivada de kind (tabela única em vocab.mjs)
 *   why: string[]                                     // códigos: measured, build-meta, published, constraint:gloves, ...
 * }} Recommended */

/** @typedef {{ championId:string, name:string, isCarry:boolean, rank:number,
 *   slots:{ cap:number, free:number, locked:boolean },
 *   equipped: ItemRef[],
 *   recommended: Recommended[],                       // <= SLOTS: assigned por valor, depois wish até encher
 *   wishlist: Recommended[],                          // o resto, <= WISH_LIMIT
 *   total:number, acc:number }} ChampionItems */

/** @typedef {{ version:string, active:boolean, bankRead:boolean, total:number,
 *   champions: ChampionItems[],                       // por impacto (o "carry" emerge)
 *   passes: { item:ItemRef, from:{id,name}, to:{id,name}, leaving:boolean }[],
 *   bankUse: { toChampion:{itemId:string, championId:string}[], unused:{id:string,reason:string}[], excluded:string[] },
 *   ignored: { id:string, reason:"fora-do-catalogo"|"sem-dado"|"restricao" }[],
 *   limitations: string[] }} ItemsPlan */
```

**Regras do contrato** (viram testes):

- **Ordem de `recommended`**: `assigned` por `worth.value` desc; depois `wish` por valor desc até `SLOTS`. Desempate **explícito**: valor desc, amostras desc, `publishedRank` asc, id asc (hoje é ordem de inserção).
- **Sem dado medido**: usa `publishedRank` da build da comp (`source:"published"`, confiança 0); sem build, a heurística por papel hoje em `tactics.build` (`source:"heuristic"`). A lista nunca fica vazia por falta de dado.
- **Restrições de jogo** em `policy.CONSTRAINTS`, aplicadas em toda saída: Luva do Ladrão trava os 3 slots (só entra como `wish` explícito, nunca como atribuição de peça com slot livre); um só item de mana por campeão; artefato, emblema, consumível e fora do catálogo vão para `ignored` com o motivo.
- **Radiante = item base** (`baseItemId`); cada cópia e cada componente é gasto uma vez (`stock.mjs`); vocabulário de situação = `HOLD_KINDS` (o rótulo curto de `stateBrief` e o `progressStatus` do checklist são tabelas em `vocab.mjs`, não regras novas).
- **Banco não lido**: `active=false`, `recommended` só com `wish`, `kind` desconhecido (`absent` com `text:""`), sem "falta N" inventado (mesma postura de hoje, `model.js:500`).
- **Determinismo e pureza**: mesma entrada, mesma saída (golden); entrada congelada não muta (`graph` em modo `verify`).

### 3.3 O que sai de cada módulo atual [P]

| Módulo                                                                                                           | Sai                                                                                                                      | Fica (adaptador fino)                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item-value.mjs`, `item-plan.mjs`                                                                                | corpo inteiro                                                                                                            | reexports de `core/items/value.mjs`, `assign.mjs` (some no S10)                                                                                                                         |
| `item-holdings.mjs`                                                                                              | `HOLD_VALUE` (vai para `policy.mjs`)                                                                                     | `resolveHoldings`/`holdValue` para `itemEdge`/`buildFit` até a decisão 8; `recommendInventory`                                                                                          |
| `tactics.mjs`                                                                                                    | `build` (118-444), `wishlist` (22), `itemMoves` (674-789), `ownedItemAdvice` (862-965), chamada de `carouselPicks` (792) | posições, transições, traços, `synergyTips`, ameaça do lobby (vira `context.threat`). `itemPlans[]` continua no payload como projeção (`ideal := recommended` no formato antigo) até S8 |
| `stage.mjs`                                                                                                      | `movedIn`/`equipNow`/`nextItem`/`bankItems` (228-321)                                                                    | campo, compras, loja (`stage.mjs` 1-227, 322-361)                                                                                                                                       |
| `engine.mjs`                                                                                                     | `planFor`/`valueTable`/`planRecipes` (516-577)                                                                           | chama a engine; `holdingsFor`/`buildFit`/`itemEdge`/`itemProfile`/`itemFit` **ficam** (não mudar score de comp sem pedido)                                                              |
| `plan-progress.mjs`                                                                                              | `freezeItems` lê `ideal`, `status` por `progressStatus`                                                                  | congelamento e memória (continuam como estão), agora lendo `recommended`/`kind`                                                                                                         |
| `carousel.mjs`, `app/carousel-view.mjs`                                                                          | `scorePlans` lê `ideal`                                                                                                  | pesos/`rankCarouselOffer` ficam; entrada = `projectCarousel(plan)`                                                                                                                      |
| `core/items/holdings.mjs`                                                                                        | `locateItem`, `buildStates` (Formação)                                                                                   | `classifyHoldings`, `ownersOf`, `kindFromOrigin` (insumos de `itemEdge` e da engine)                                                                                                    |
| `core/items/champion-items.mjs`                                                                                  | corpo                                                                                                                    | `projectRow` (mantém `stateBrief` -> `vocab.mjs`)                                                                                                                                       |
| `v2/js/model.js`                                                                                                 | `c.build` (329-354), passos `next`/`equip`/`moves`/`builds` por regra                                                    | monta passos a partir de `projectNext/Equip/Passes/Row`                                                                                                                                 |
| `v2/js/ui/champ-items.js`, `ui/steps.js:buildsRow`, `ui/comps.js:itemPlanBlock/compItemsBlock/planItem/wishItem` | HTML duplicado por tela                                                                                                  | **um** renderizador de linha de campeão (`ui/item-row.js`)                                                                                                                              |
| `v2/js/comp-items.js`                                                                                            | `compItems` (menos a parte de emblemas)                                                                                  | `planView` some (dado já vem em `ChampionItems`); emblemas ficam no domínio de traços                                                                                                   |
| `overlay/hud/view.mjs`                                                                                           | `buildsOf` (270-296)                                                                                                     | `champsOf`/`nextOf`/`equipOf`/`movesOf` já são finos sobre o modelo                                                                                                                     |
| `ui/items.js` (aba Itens)                                                                                        | n/a                                                                                                                      | acrescenta "Melhor em" (inverso de `value.mjs`) e a situação do seu inventário                                                                                                          |

### 3.4 Encaixe com o `ARQUITETURA.md` (sem outro caminho) [P]

- É o **motor `engines/items`** da tabela 2.5, hoje "`tactics.mjs:build`, `carousel.mjs`, `v2/js/comp-items.js`"; consome `holdings.*` (M6 feito), `catalog.items` (M2 feito),
  `meta.builds` e `lobby.threat` (fato D15, pendente). Entra como **M9a - motor de itens** (primeira fatia do M9), antes de `comps` e `plan`.
- No grafo (M8b, `app/recommend-facts.mjs`): `items.rank.K` (entradas: tabuleiro do plano K, `meta`, catálogo) e `items.place.K` (entradas: `items.rank.K`, `holders`, `bank`, `threat`). Substitui `planMemo`/`planCache` manuais de `engine.mjs:528-576`.
- Catraca (M1): novas regras T2 `item-ranking-outside-core`, `hold-kind-vocab`, `item-constraint-literal` (S10); a regra `item-holdings-reimplemented` já existe e passa a cobrir `locateItem`.
- Golden (M0): diferenças só com o diff registrado em `ARQUITETURA.md`, no mesmo formato das tabelas de M2/M4.
- `ARQUITETURA.md` ganha uma seção "M9a" e a linha do motor na 2.5 deve apontar para este plano (não editei nada lá).

---

## 4. Plano de migração (passos pequenos)

Esforço: P < 0,5 dia, M ~1 dia, G 2-4 dias. "Rede" = o que trava o comportamento atual **antes** de mexer. Suíte hoje: 836+ testes (o `ARQUITETURA.md` registra 836 na rodada final); o golden demora ~15 s.

| Passo   | O que faz                                                                                                                                                                                                                                                                                                                                                                                    | Arquivos                                                                                                                                                         | Rede (antes de mudar)                                                                                                          | Pronto quando                                                                                                                                                                                             | Risco                                                                   | Reiniciar / validar ao vivo                                                                           | Esf. | Depende                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| **S0**  | **Matriz de consistência** com catraca: para cada cenário do golden e cada campeão do plano, coleta a lista de itens vista por Comps, Formação, Próximo item/Equipar, carrossel, checklist e overlay (`champs` e `builds`), e fixa os números de hoje (5/49 de D-I2, 10/58 de D-I1, 472 de D-I3...)                                                                                          | `tests/items-consistency.test.mjs` (novo); lê `tests/golden/harness.mjs`, `v2/js/model.js`, `overlay/hud/view.mjs`                                               | é a própria rede                                                                                                               | passa 3x seguidas; um consumidor alterado à mão faz falhar; número só pode **descer**                                                                                                                     | Baixo                                                                   | nada                                                                                                  | P    | --                                                                    |
| **S1**  | **Guarda de ids da meta**: `core/items/meta-ids.mjs:metaCoverage(stats, builds, catalog)` (puro); `meta-store.validateStats` recusa cópia com cobertura baixa e marca `problems`; `/api/state` e a aba Itens/Comps mostram o chip "meta de outro set de ids"                                                                                                                                 | `core/items/meta-ids.mjs`, `meta-store.mjs`, `server.mjs` (chip), `v2/js/meta-freshness.js`                                                                      | `tests/meta-store.test.mjs`, teste novo com o `HEAD` e com o disco                                                             | o `meta-stats.json` atual é reportado com 0 % e a cópia do `HEAD` com 579/579 pares; a leitura cai na anterior                                                                                            | Baixo (mexe em arquivo de outro agente)                                 | servidor; confirmar a cobertura no `/api/state`                                                       | P    | decisão 9; coordenar com `tft-meta-offline`                           |
| **S2**  | **Extrair a referência sem mudar nada**: `policy.mjs`, `value.mjs`, `assign.mjs` (git mv + reexport nos nomes antigos); `HOLD_VALUE` e as constantes de plano para `policy.mjs`                                                                                                                                                                                                              | `core/items/{policy,value,assign}.mjs`, `item-value.mjs`, `item-plan.mjs`, `item-holdings.mjs`, `engine.mjs` (imports)                                           | `tests/item-plan.test.mjs` (força bruta), `tests/item-holdings.test.mjs`, golden                                               | golden **idêntico**; testes existentes verdes sem edição; `core/items/*` puro (teste de pureza existente)                                                                                                 | Baixo                                                                   | servidor (import)                                                                                     | M    | S0                                                                    |
| **S3**  | **Ganho rápido**: `engine.mjs` v0 só com `championItemsFromPlan(compRanking[idDoPlano].itemPlan)` -> `ChampionItems[]` (mapeia `assignments` e `wishlist` para `recommended`); `model.js` (`c.build`, passo `builds`), `champ-items.js` e o overlay (`champsOf`, `buildsOf`) leem isso. Sem entrada em `compRanking` (tabuleiro de vantagem) usa o caminho antigo, marcado `source:"legacy"` | `core/items/engine.mjs` (novo, v0), `core/items/champion-items.mjs`, `v2/js/model.js`, `v2/js/ui/champ-items.js`, `overlay/hud/view.mjs`, `overlay/hud/draw.mjs` | S0 + `tests/champion-items.test.mjs`, `v2/js/model.test.mjs`, `tests/overlay-hints.test.mjs`, `tests/formation-items.test.mjs` | Formação, "Itens dos campeões" e overlay mostram, para a comp do plano, a **mesma** lista da aba Comps (matriz Comps x Formação x overlay = 0 divergentes); sem banco lido não afirma "pronto/falta"      | Médio (`model.js`/overlay em edição por `tft-loja-itens`/`tft-overlay`) | **sem reiniciar o servidor** (não muda payload): recarregar a página e reiniciar o overlay (Electron) | M    | S0, S2; esperar os agentes do overlay/loja fecharem                   |
| **S4**  | **Engine completa, fase 1 (`rank`)**: `rankChampionItems` com desempate explícito, `publishedRank`, fallback publicada/heurística, `CONSTRAINTS` (Luva, mana, artefato). `item-plan`/`engine.planFor` passam a usar `rank`                                                                                                                                                                   | `core/items/engine.mjs`, `policy.mjs`, `value.mjs`, `engine.mjs:516-577`, `tests/golden` (regravar com diff)                                                     | S0 + golden de S2                                                                                                              | **muda número**: `compRanking[].itemPlan` perde Luva/duplo mana e fixa desempates; diff por caminho registrado no `ARQUITETURA.md`; `compRanking` (ordem/score) só pode mudar onde o total do plano mudou | Médio-alto                                                              | servidor                                                                                              | M    | S2; decisões 3 e 4                                                    |
| **S5**  | **Fase 2 (`place`)**: atribuição única e situação em `HOLD_KINDS`; `ItemsPlan` com `passes`, `bankUse`, `ignored`; `tactics`/`stage` recebem o plano pronto (aditivo em `itemPlans[]`: `recommended`)                                                                                                                                                                                        | `core/items/{engine,vocab}.mjs`, `tactics.mjs`, `engine.mjs`, `app/recommend-facts.mjs` (fatos `items.rank.K`/`items.place.K`)                                   | S0, golden, `tests/recommend-graph.test.mjs` (`verify`)                                                                        | só campos novos no payload; `verify` do grafo limpo; tática < 50 ms num evento de ouro (mede-se com `scripts/bench.mjs`)                                                                                  | Alto (muitos consumidores)                                              | servidor                                                                                              | G    | S4; decisão 2                                                         |
| **S6**  | **Próximo item / Equipar / Passar itens como projeções**: remove `build`, `wishlist`, `itemMoves`, `ownedItemAdvice` de `tactics`; `stage.mjs` 228-321 vira `projectNext/Equip`; `itemPlans[].ideal` fica como espelho compatível                                                                                                                                                            | `tactics.mjs`, `stage.mjs`, `v2/js/model.js`, `v2/js/next-item.js`                                                                                               | S0, `tests/item-bank.test.mjs`, `tests/formation-items.test.mjs`, `v2/js/next-item.test.mjs`, golden                           | **muda número** em `stage.*`, `itemMoves`, `ownedItemAdvice` (diff aprovado); D-I2 = 0                                                                                                                    | Alto                                                                    | servidor + página + overlay                                                                           | G    | S5; coordenar com `tft-motor-itens`, `tft-formacao`, `tft-loja-itens` |
| **S7**  | **Cliente re-coloca com o banco fresco**: servidor envia `ranked`; `model.js` e o overlay chamam `placeChampionItems` com `screen.items`; remove `locateItem`/`buildStates`                                                                                                                                                                                                                  | `core/items/holdings.mjs`, `v2/js/model.js`, `v2/js/ui/champ-items.js`, `overlay/hud/hud.mjs` (`buildStates` -> engine), `app/recommend.mjs`                     | S0 + testes de `core-items-holdings` (equivalência com a regra antiga, depois removida)                                        | D-I5 = 0 (mesmo banco, mesma lista em qualquer tela, sem esperar análise); nenhum consumidor chama `locateItem` fora do `core/items`                                                                      | Médio                                                                   | servidor + página + overlay                                                                           | M    | S5                                                                    |
| **S8**  | **Carrossel e checklist**: `scorePlans` lê `projectCarousel`; `freezeItems`/`progressStatus` leem `recommended`/`kind` (congelamento intocado)                                                                                                                                                                                                                                               | `carousel.mjs`, `app/carousel-view.mjs`, `plan-progress.mjs`, `core/items/vocab.mjs`                                                                             | `tests/carousel*.test.mjs`, `tests/plan-state.test.mjs`, S0                                                                    | D-I7 = 0; alvos congelados de partida em andamento continuam; golden `carousel`/`planProgress.items` com diff aprovado                                                                                    | Médio                                                                   | servidor                                                                                              | M    | S6                                                                    |
| **S9**  | **Aba Comps/modal e aba Itens**: um renderizador `ui/item-row.js` para Comps, Formação e passo; some `compItemsBlock`/`compItems` (fica emblema); aba Itens ganha "Melhor em" e a situação no seu inventário                                                                                                                                                                                 | `v2/js/ui/{comps,champ-items,steps,items,comp-modal}.js`, `v2/js/comp-items.js`, `server.mjs:itemsPayload`                                                       | `v2/js/comp-items.test.mjs`, `v2/js/comp-plan.test.mjs`, `v2/js/names-guard.test.mjs`, `v2/js/design-rules.test.mjs`           | mesma comp = mesma lista em Comps, Formação e overlay (S0 = 0); itens como imagem (guard de nomes)                                                                                                        | Médio                                                                   | página                                                                                                | M    | S3 (pode rodar em paralelo a S6-S8)                                   |
| **S10** | **Catraca e limpeza**: regras `item-ranking-outside-core`, `hold-kind-vocab`, `item-constraint-literal`; apaga código morto e os reexports; `ARQUITETURA.md` ganha M9a                                                                                                                                                                                                                       | `tests/architecture.test.mjs`, `item-plan.mjs`, `item-value.mjs`, `tactics.mjs`, `core/README.md`, `ARQUITETURA.md`                                              | arquitetura (T1-T7)                                                                                                            | catraca em 0 para itens; matriz S0 em 0; suíte verde                                                                                                                                                      | Baixo                                                                   | --                                                                                                    | P    | S6-S9                                                                 |

**O que NÃO mover agora**: pesos e política de score de comp (`STICKY_BONUS`, `buildFit`, `itemEdge`, `itemProfile/itemFit` por papel, `EVIDENCE_ITEM_SHARE`, `WEIGHTS` de `comp-score`);
`holdingsFor`/`classifyHoldings` guloso do carry (continua alimentando `itemEdge`); a memória do checklist (`plan-state`); `screen-reader`/GEP; `emblemEdge` e a escolha de emblemas;
aparência (CSS) das telas; `live-mock.js`.

---

## 5. Riscos e decisões que dependem de você

**O que a regra "não mudar como build/comp é montado sem pedido" implica.** Este pedido **autoriza** mudar _quais itens são recomendados e mostrados_. Não autoriza
mudar _quais comps são sugeridas nem a ordem delas_. Plano: S2-S3 não mudam nenhum número de servidor; S4-S8 mudam só o que está listado abaixo, cada diff registrado antes de regravar o golden.

Resultado **visível** que muda:

1. Formação, "Itens dos campeões" e overlay: de "build publicada da comp + bônus" para "valor medido" (ex.: Cassiopeia passa de Archangel/Blue Buff/Gunblade para Gunblade/Archangel/Void Staff).
2. Próximo item, Equipar, Passar itens, carrossel e checklist (alvos **novos**; os já congelados numa partida em andamento ficam) seguem a nova lista.
3. Aba Comps: a Luva do Ladrão e o segundo item de mana saem das atribuições (D-I3/D-I4); desempates passam a ser determinísticos; `compRanking[].itemPlan.total` e, por consequência, o score/posição de comps podem se mexer **só** onde a restrição trocou uma atribuição (esperado: posições baixas, como no M2).
4. Não muda: seleção e ordem das 3 sugestões fora do item 3, rolagem, plano persistente, pesos de score, confiança.

**Decisões do usuário** (numeradas; as que travam passos estão marcadas):

1. **"Melhor item" = valor medido (Comps) ou build publicada da comp?** Proposta: valor medido como padrão (é o que você apontou como certo) e a build publicada entra como `publishedRank` (selo e desempate) e como fonte quando não há medida. (trava S3, S4)
2. **Item disputado por dois campeões**: maximizar o valor total (húngaro, como a aba Comps) ou o carry primeiro (como a Formação/motor)? Proposta: valor total. Muda quem fica com o item em `taken`/`move`. (trava S5)
3. **Restrições de jogo em todas as telas** (Luva do Ladrão trava os 3 slots; um só item de mana)? Proposta: sim, também na aba Comps; e em S4 aplicar só à exibição e ligar ao total/score em passo separado. (trava S4)
4. **Ajustes de lobby e de cobertura** (hoje +6/+10 contra armadura/cura e -45 por efeito repetido em `build()`): manter como ajuste pequeno sobre o valor, descartar, ou só como selo de motivo? Proposta: só motivo (`why`) no S4, ajuste de ordem depois, com `lobby.threat` (D15).
5. **Quando o inventário diverge do meta** (você tem Warmog, o meta quer Gargoyle): a lista mostra primeiro o que você **pode fazer agora** (atribuições por valor) e depois o que **perseguir** (desejos), como a aba Comps. "Próximo item" seria então o melhor item **viável** e não o #1 do meta. Confirma? Alternativa: separar em "Agora" e "Perseguir" também na Formação.
6. **Item fora do catálogo / não reconhecido / artefato / emblema**: ignorar com motivo no `ignored` (proposta) em vez de entrar no ranking. Confirma que "banco não reconhecido" continua só como contador.
7. **Quantos mostrar**: 3 por campeão (os 3 slots) + até 5 desejos; overlay 4 campeões + "+N" (limite de espaço, não regra). Mantém? Proposta: o overlay ordena os 4 por impacto (`total`), não por "carry".
8. **`itemEdge`/`buildFit` (score por build publicada)**: ficam como estão nesta migração (proposta) ou migram para a engine depois do S8?
9. **Meta de outro conjunto de ids (S1)**: se o disco continuar com `TFT17_*`, a referência rebaixa para `build-meta`. Quer que a cópia boa anterior vença (proposta) ou prefere ser avisado e decidir?
10. **Aba Itens**: acrescentar "Melhor em" (valor) mantendo "Quem mais usa" (popularidade)? Proposta: sim, sem trocar a métrica existente.

**Riscos e pontos [?]**

- O valor medido "mistura efeito do item com partida rica" (já documentado em `item-value.mjs`): tanques e itens de poder tendem a ficar altos; o teto 0,5 e o encolhimento seguram, mas a aba Comps já convive com isso.
- Custo do húngaro no navegador/overlay não foi medido [?]; no servidor roda para todas as comps e está memoizado (`planMemo`, até 600 entradas). Medir em S7 com `scripts/bench.mjs` antes de ligar.
- Conflito de edição: `model.js`, `overlay/hud/*`, `carousel.mjs`, `meta-*.mjs` estão modificados por outros agentes agora; S3 e S7 só depois que eles fecharem, ou em fatias que não toquem os mesmos trechos.
- O overlay (Electron) importa módulos do servidor (`/v2/js/...`, `/core/...`): qualquer mudança de caminho em `core/` exige reiniciar o overlay.
- Não conferi [?] se `compRanking` traz **todas** as comps ou um recorte (`engine.mjs:1550`); S3 depende de a comp do plano estar nele (senão cai no caminho antigo, como previsto).
- Tabuleiros de vantagem (sem comp de meta) não têm `itemPlan` pronto; a engine precisa aceitar qualquer tabuleiro (S5).

---

## 6. Ordem dos passos e agentes sugeridos

| Ordem | Passo                                            | Agente executor                                           | Revisão / apoio                    |
| ----- | ------------------------------------------------ | --------------------------------------------------------- | ---------------------------------- |
| 1     | S0 matriz de consistência                        | `tft-migracao`                                            | `tft-arquiteto`                    |
| 2     | S1 guarda de ids da meta                         | `tft-meta-offline`                                        | `tft-migracao`                     |
| 3     | S2 extrair a referência                          | `tft-migracao`                                            | `tft-motor-itens`                  |
| 4     | **S3 ganho rápido (Formação + overlay = Comps)** | `tft-formacao` (modelo, janela) + `tft-overlay` (overlay) | `tft-loja-itens`, `tft-ui-imagens` |
| 5     | S4 `rank` + restrições                           | `tft-motor-itens`                                         | `tft-migracao` (golden/diff)       |
| 6     | S5 `place` + fatos no grafo                      | `tft-motor-itens` + `tft-desempenho` (memoização, tempo)  | `tft-arquiteto`                    |
| 7     | S6 Próximo item / Equipar / Passar itens         | `tft-loja-itens` + `tft-formacao`                         | `tft-motor-itens`                  |
| 8     | S7 cliente re-coloca com o banco fresco          | `tft-formacao` + `tft-overlay`                            | `tft-inventario`                   |
| 9     | S8 carrossel e checklist                         | `tft-carrossel` + `tft-progresso`                         | `tft-migracao`                     |
| 10    | S9 Comps/modal e aba Itens                       | `tft-comps-ui` + `tft-ui-imagens`                         | `tft-web-ui`                       |
| 11    | S10 catraca e limpeza                            | `tft-migracao`                                            | `tft-arquiteto`                    |

Paralelismo seguro: S1 com S0; S9 com S6-S8 depois do S3. Qualquer passo termina com a suíte verde, o golden idêntico ou com diff registrado, e a matriz S0 igual ou menor.
