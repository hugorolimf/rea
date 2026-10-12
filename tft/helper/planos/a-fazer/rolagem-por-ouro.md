# Rolagem por ouro: quem vale a busca, com quanto ouro, e o 3★ no centro

Estado: **a fazer, com R1 feito** (2026-10-11). Executor previsto: `tft-rolagem`. Ver "Progresso" no fim.

Pedidos do usuário (2026-10-11):

> "Agora vamos criar um plano para buscar campeões que valem a pena o roll com base no meu ouro."

> "Entenda que é muito vantajoso ter campeões 3★, e temos a inteligência necessária do tabuleiro e dos adversários para
> implementar isso. Comece esse plano de rolagem."

Complemento do coordenador: as recomendações quase nunca sugerem rolar por 3★. Este plano tem uma seção sobre o reroll lento
(seção 4), e a regra de alcance corrigida pelo `tft-comp-viabilidade` entra como dependência.

## 0. O problema, no exemplo real

O painel hoje mostra:

> Não vale rolar agora · Ouro no piso (50g): rolar derrubaria os juros. Achar rolando · chance de ver uma cópia 45% 45% 37% ↑ …
> | core Kayle 2→3★ 4/9 11% por loja 4 cópias com rivais | Master Yi 1→2★ 8.8% por loja | Azir 1→2★ 8.3% por loja 1 cópias
> com rivais | Rammus 1→2★ 6.3% por loja 4 cópias com rivais | Diana nova 8.8% por loja 1 cópias com rivais | Draven 1→2★ inviável

Problemas:

1. **Os percentuais não dizem com quanto ouro valem.** "11% por loja" é a chance de UMA loja mostrar uma cópia. Não diz a
   chance de fechar o 3★ (faltam 5 cópias), nem quanto ouro isso custa.
2. **"Chance de ver uma cópia" não é a pergunta.** O que importa é fechar a próxima estrela, ou achar a peça que falta, com o
   ouro que dá para gastar. Ver uma cópia de Kayle não fecha nada quando faltam 5.
3. **Não diz quanto rolar nem por quem começar.** O veredito ("ouro no piso") e a lista não conversam. A lista não tem
   ordem de prioridade nem ponto de parada.
4. **O 3★ não aparece como objetivo.** Kayle (custo 2) com 4/9 é um 3★ possível num reroll lento: com 4 cópias com rivais e
   nível 6, a conta exata (`closeCurve`) dá ~5% com 40 g, ~24% com 60 g e ~49% com 80 g. Nenhuma rodada sozinha passa dos
   50% que a regra exige, mas rolar o que passa de 50 g por 4 ou 5 rodadas chega lá. A regra de hoje é de uma rodada só e
   nunca enxerga isso.

## 1. Inventário: o que existe e o que cada parte calcula

| Onde                                                                                                                  | O que calcula                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | O que falta / onde a tela mostra número sem contexto                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roll.mjs` `teamOf(plan, analysis, options)`                                                                          | Alvos = todo campeão seu (campo + reserva) e os da comp que você tem ou que a loja manda comprar. Para cada um: próxima estrela (3 → 2★, 9 → 3★), `free`/`upper`, `enemy`/`hidden`, `contested`, `chancePerSlot`/`chancePerShop` (agora e no nível +1), curva exata `closeCurve`, `gold50`, peso (`carryWeight` 2, `coreWeight` 1,5, itens +25% cada, `offPlanWeight` 0,6 fora do plano), `status` (`ok`/`longe`/`inviavel`) e `substitute` (troca permanente `flex.suggest`) | 3★ "longe" (faltam 4+ cópias) fica fora da simulação, salvo carry ou `stars3`. O valor da estrela vem de `POLICY.star` (régua do lobby, não medida). Não há conta de várias rodadas                                                   |
| `roll.mjs` `rollRule(team, sim, …)`                                                                                   | Regra única "vale rolar agora?": `any[B] ≥ 50%` (alguma peça evolui com B), menor B que passa (`need`), espera pelo nível de rolagem (`waitMargin` 0,15), perigo com `dangerChance` 0,1 e `dangerGainPerGold` 1/30                                                                                                                                                                                                                                                            | **Só uma rodada.** O reroll lento (rolar o excedente acima de 50 g por várias rodadas) nunca passa nos 50% e o `settle` de `strategy.mjs` troca "ROLAR" por "ECONOMIZAR" (ver 4.4)                                                    |
| `roll.mjs` `findIndicator` / `rollRows` / `rollCurve`                                                                 | "Achar rolando": chance de ver ≥1 cópia em N lojas (5 sem orçamento); linhas por peça com `chance` no orçamento; curva "pelo menos uma evolui"                                                                                                                                                                                                                                                                                                                                | O "achar rolando" é a faixa de 45%/37% do exemplo: ver uma cópia, sem ouro, sem estrela                                                                                                                                               |
| `roll-sim.mjs` (`roll.sim`) + `economy.mjs` `rollSim`                                                                 | Monte Carlo do time (500 corridas, semente fixa): `gain[g]` e `any[g]` por ouro, comprando tudo o que aparece dos `simTargets` (10) alvos                                                                                                                                                                                                                                                                                                                                     | Bom para "quanto rende o ouro"; não separa por alvo                                                                                                                                                                                   |
| `economy.mjs` `bestSpend`, `curveSummary`, `goldFor`, `isContested`                                                   | Quanto rolar (utilidade com urgência e juros perdidos), resumo da curva, menor ouro para q, 3★ disputado (`POLICY.contested`: 6 cópias ou 35% da pool)                                                                                                                                                                                                                                                                                                                        | `goldFor` e `isContested` moram fora de `core/` (o módulo novo precisa deles: R1 os move, com reexportação)                                                                                                                           |
| `strategy.mjs` `decide` / `settle` / `strategy`                                                                       | Árvore: perigo (all-in com venda), reroll (`rerollLevel`, `open3`, reroll rápido piso 20 / lento piso 50, desistência por disputa), comp de nível (`rollAt`), núcleo pronto, nível final. `settle` aplica `rollRule`. Painéis `economy` (com `alert` da vida), `leveling` e `rolling` (`call`, `targets`, `curve`, `shop`)                                                                                                                                                    | `panels.rolling.targets` leva `chancePerShop` e `chance` (com `call.budget`), e a tela mostra o "por loja" como número principal. `call.reason` "Ouro no piso (50g)" não diz o que muda com mais ouro                                 |
| `core/pool/` (`shop.mjs`, `curve.mjs`, `copies.mjs`, `buy-copies.mjs`)                                                | Odds por nível (`ODDS` Set 18), `slotChance` (odds × livres ÷ livres do custo), `shopChance`, `chanceAtLeast`, `closeCurve` exata (cadeia de Markov com a pool encolhendo e o preço das cópias), cópias por estrela, pool livre fracionária, `shopCopies` (cartas iguais na loja)                                                                                                                                                                                             | É a matemática certa. Falta quem a use por alvo e por orçamento                                                                                                                                                                       |
| `core/economy/` (`policy.mjs`, `pressure.mjs`, `gold.mjs`)                                                            | `POLICY.floor` (50/30/10/0, reroll rápido 20), `pressureOf` (faixa, piso, urgência, horizonte de juros), `incomeOf`, `projectGold`, `POLICY.roll` (`chance` 0,5, `dangerChance`, `dangerGainPerGold`, `waitMargin`)                                                                                                                                                                                                                                                           | O orçamento B = ouro − piso já existe implícito (`spare`); não é mostrado como "com Xg"                                                                                                                                               |
| `pool-tracker.mjs` `hiddenHoldings`                                                                                   | Cópias estimadas nos bancos dos rivais (peso 0,5 com meia-vida de 3 min), somadas por campeão                                                                                                                                                                                                                                                                                                                                                                                 | **Soma por campeão**: perde quem segura. Para "desista: X segura 4 cópias" é preciso por rival (R5)                                                                                                                                   |
| `engine.mjs` `analyze` → `analysis.pool[]`                                                                            | `own`, `enemy`, `hidden`, `remainingUpper`, `free`, `rivals` (nomes), `chancePerSlot/Shop`                                                                                                                                                                                                                                                                                                                                                                                    | `rivals` é só a lista de nomes; as cópias de cada rival não chegam (R5, encaixe com `tft-comp-viabilidade`)                                                                                                                           |
| `contest.mjs` `contestAlert`                                                                                          | Rival que joga as mesmas peças da comp (cópias por rival, carry disputado), nível `high`/`medium` e comp alternativa                                                                                                                                                                                                                                                                                                                                                          | Visão por comp, não por peça; não chega à rolagem                                                                                                                                                                                     |
| `stage.mjs` `stagePlan` (buyNow, `shopCopies`)                                                                        | Compras da loja de agora (peça da comp, cópia que fecha estrela, pontes), com `chancePerShop` e o que fica "para depois"                                                                                                                                                                                                                                                                                                                                                      | Compra o que está na loja; não decide rolar. Em edição pelo `tft-substitutos`                                                                                                                                                         |
| `core/comps/reach.mjs` (`compReach`, `pieceChance`, `REACH`)                                                          | Alcance da comp: horizonte por vida e calendário, orçamento com renda, níveis, chance por peça com rivais (`rivalShare` 0,5), parte esperada. **Hoje** exige todas as `stars3` em 3★ e zera a chance quando o ouro de compra passa do orçamento                                                                                                                                                                                                                               | Em edição pelo `tft-comp-viabilidade` (3★ realista: carry de reroll 3★, resto 2★; chance contínua no ouro). A rolagem tem de usar a **mesma** estrela-alvo                                                                            |
| `core/board/interim.mjs` (`slotStrength`, `swapDelta`, `interimBuyWorth`, `hpPerPoint`)                               | Força na vaga medida (custo × [0, 1, 2, 5] + item completo × 2 + sinergia), vida por ponto de força por rodada (0,44/0,38/0,35), ~12,6 pontos de força por colocação, se vale comprar um temporário                                                                                                                                                                                                                                                                           | Em construção pelo `tft-substitutos`. É a régua que deve valorar "achar a peça que falta" e o substituto temporário (seção 2.3)                                                                                                       |
| `meta-stats.mjs` (`unit["id                                                                                           | estrela"]`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Colocação média MetaTFT do Set 18 por campeão × estrela (e × itens)                                                                                                                                                                   | Não é usada na rolagem. Medido no snapshot 18.4b (tabuleiros finais, mediana por custo): 1★→2★ vale 0,55/0,63/0,95/1,63/1,90 colocação (custo 1..5) e 2★→3★ 0,54/1,00/1,34/2,63/1,79 |
| `v2/js/model.js` (`roll`, `findStrip`, `pickRows`, `rollPill`, `targetTitle`)                                         | Modelo da tela: veredito (`call`), gasto, pare em, juros, peças na loja, "achar rolando", até 6 linhas (2 inviáveis), curva                                                                                                                                                                                                                                                                                                                                                   | `findStrip` vira os chips "Achar rolando · chance de ver uma cópia". A linha da peça (`ui/panel.js` `targetHtml`) mostra "11% por loja" grande e "→ x% com Bg" pequeno, só quando há orçamento. Em edição pelo `tft-substitutos` (v2) |
| `overlay/hud` (`view.mjs` `rollOf`, `draw.mjs` `roll`, `hints.mjs` `goldHints`, título "Vale rolar?" em `layout.mjs`) | Cartão com selo, título, motivo, "Xg · até N lojas · pare em Yg" e juros; dicas "Role até Xg" / "Vale esperar o nível N" / "Não role"                                                                                                                                                                                                                                                                                                                                         | Não diz **por quem** rolar nem a chance. Em edição pelo `tft-overlay`                                                                                                                                                                 |

## 2. A pergunta certa

> Com o ouro que posso gastar agora, quais campeões valem a busca, e quanto rolar?

### 2.1 Orçamento

- **B (gastável)** = ouro depois das compras da loja − piso. O piso vem de `pressureOf` (saudável 50, ferido 30, perigo 10,
  crítico 0) ou do reroll (`POLICY.floor.fastReroll` 20 com vida ≤ `POLICY.hp.fastReroll`). No crítico, B soma a venda do
  banco fora do plano (`sellableOf`, como o all-in de hoje).
- **T (total)** = todo o ouro depois da loja. A chance com T aparece só quando muda a conta, por exemplo "com tudo: 61%"
  quando B dá 20% e T passa dos 50%. Isso diz o preço de quebrar os juros.
- **B↑ (subir antes)** = B − custo do XP até o nível seguinte, com as odds do nível seguinte. Entra quando a chance com B↑ no
  nível +1 supera a de B no nível atual por `POLICY.roll.waitMargin` (peças de custo 4 e 5), ou quando cai (custo 1 e 2: "não
  suba antes de rolar").

### 2.2 Alvos (em ordem de prioridade de busca)

1. **Estrelas do plano**: peças do plano em andamento (não a 1ª do ranking: `sugestoes-a-favor-do-plano.md`) que fecham a
   próxima estrela. Carry primeiro, depois quem leva itens (`buildHolders`) e os trunfos.
2. **3★ do plano**: a estrela-alvo da comp (`stars3`, com a regra corrigida do alcance: carry de reroll 3★, resto 2★) e o
   **3★ oportunista** (seção 4.3).
3. **Peças que faltam** no plano (cópia 1, "nova").
4. **Substitutos temporários** que valem pela força (`core/board/interim.mjs`): um 2★ fora da comp que segura a vida até o
   titular chegar. Só entram com o motivo marcado ("temporário: +X de força na vaga") e com peso menor que as peças do plano.

Inviáveis (nível sem o custo, cópias livres < faltam) e 3★ disputados (`isContested`) ficam no fim, marcados com o motivo,
ou fora da lista.

### 2.3 Medidas por alvo

Para cada alvo x e cada orçamento (B, T, B↑):

- **Chance de fechar** = `closeCurve({ level, cost, own, goal, free, denom })[orçamento]` (exata, pool encolhendo, preço das
  cópias). Com cartas do alvo na loja agora, essas cópias já contam como compradas (como `teamOf` faz hoje).
- **Gasto esperado** E[min(G, B)] = Σ_{g<B} (1 − curva[g]): o ouro que se gasta em média até fechar ou bater o teto. Com isso
  vem o **ganho por ouro** = chance × valor ÷ gasto esperado.
- **Valor** da estrela (em colocação esperada), em ordem de preferência:
  1. a medida da MetaTFT para o campeão (`unit["id|estrela"]`: colocação média da estrela atual − a da próxima), encolhida
     para a média do custo quando a amostra é pequena;
  2. sem estatística, a mediana por custo medida (tabela da seção 1);
  3. para uma peça que falta ou para um temporário, a força na vaga (`interim.mjs` `slotStrength`/`swapDelta`) convertida
     por ~12,6 pontos por colocação (valor medido, "recalibrar").

  Pesos de prioridade continuam: carry × `carryWeight`, itens × (1 + `itemWeight` × itens), fora do plano × `offPlanWeight`.

- **Até quando rolar**: o gasto do alvo é o menor entre B e o ouro em que a curva chega a 80% (`enough`, depois disso cada loja
  rende pouco). "Pare em Y g" = ouro − gasto. Pare antes se fechar.
- **Veredito do alvo**: `role` (chance com B ≥ `POLICY.roll.chance`, ou ≥ `dangerChance` em perigo), `suba` (B↑ melhor),
  `guarde` (menor ouro total Z em que passaria: "guarde até Zg"), `segure` (3★ que se fecha em várias rodadas, seção 4),
  `inviavel` ou `disputada`.

O time continua com a simulação conjunta (`roll.sim`) para o "pelo menos um fecha" e o ganho total, porque dividir ouro e pool
entre os alvos importa. A lista por alvo usa a conta exata de cada um. A linha do alvo diz que a chance é "focando nele".

## 3. Saída proposta

Uma função pura em `core/roll/hunt.mjs` monta o modelo. `strategy.mjs` a chama, `panels.rolling.hunt` a leva, e a interface
e o overlay só desenham. Nenhum dos dois recalcula.

```
Role por: Azir (2★ · 52% com 30g) · Kayle (3★ 4/9 · 22% agora · 61% rolando o excedente até 4-1)
Role até 30g, pare em 50g. Se fechar Azir antes, pare.
Com tudo (80g): Azir 98%, Kayle 49%.  Subir antes (nível 8): Azir cai para 29%: role antes de subir.
Fora: Draven 2★ (a loja do nível 7 quase não tem custo 5) · Rammus 3★ (disputado: Ana segura 4 cópias)
```

Quando não vale:

```
Não role: guarde até 72g (Azir 2★ passa de 50% com 22g acima do piso).
Não role: suba para o nível 8 antes (Draven 2★: 6% → 31% com o mesmo ouro).
Não role: nada a fechar (Kayle 3★ disputado; Master Yi nova peça, compre só se aparecer).
```

Formato do modelo (`hunt`):

```js
{
  budget: { spend, total, floor, gold, levelUp: { cost, level } | null },
  verdict: { kind: "role" | "guarde" | "suba" | "segure" | "nada", spend, keep, saveTo, level, text },
  targets: [{
    id, name, cost, kind: "estrela" | "nova" | "temporario", stars, goalStars, own, goal, need,
    free, upper, holders: [{ name, copies, hidden }],
    chance: { spend, total, levelUp }, spend, keep, perGold, value,
    verdict: "role" | "guarde" | "suba" | "segure" | "inviavel" | "disputada", why, text,
    three: null | { own, of: 9, free, holders, slow: { rounds, gold, chance, until }, verdict, text }
  }],
  dropped: [{ id, name, why, text }]
}
```

`text` sempre traz o ouro: "52% com 30g", "22% agora · 61% em 4 rodadas", nunca "x% por loja". O "% por loja" pode ficar
na dica do mouse.

Interface (`v2`, depois do `tft-substitutos`): a seção Roll troca os chips "Achar rolando" (`findStrip`, `findHtml`, `.finds`
em `panel.css`) e o número grande "por loja" de `targetHtml` pela linha "Role por:", a lista ordenada com o ouro e a linha
"Fora:". Saem `findIndicator`/`FIND_DEFAULT_SHOPS` de `roll.mjs`, `findStrip` de `model.js`, o CSS órfão e os testes que
codificavam o indicador.

Overlay (depois do `tft-overlay`): o cartão "Vale rolar?" (`rollOf`/`draw.roll`) passa a mostrar o 1º alvo com o ouro
("Azir 2★ 52% · 30g ⚑50g"), e no modo completo os 3 primeiros. A dica `gold:roll` diz "Role até 30g por Azir".

## 4. 3★ no centro

### 4.1 Por que vale

- Força medida na vaga (`interim`, 44 partidas reais): 3★ = 5 × custo contra 2 × custo do 2★. A régua antiga do lobby
  (`POLICY.star` 1/1,8/3,2) subestima o 3★.
- Colocação MetaTFT do Set 18 (tabuleiros finais, mediana por custo, snapshot 18.4b): 2★→3★ vale ~1,0 colocação no custo 2,
  ~1,3 no custo 3 e ~2,6 no custo 4, mais que o 1★→2★ do mesmo custo. O 3★ de custo 1 vale pouco (~0,5) fora das comps
  de reroll de custo 1. Viés declarado: quem fecha 3★ já estava ganhando. Por isso o valor usado é o da célula do campeão,
  encolhido, e não um fator fixo.

### 4.2 Quando abrir o reroll (comp de reroll: `rerollLevel` da meta ou custo do carry 1→5, 2→6, 3→7)

Abrir = rolar o excedente acima do piso no nível de reroll, rodada após rodada, até fechar. Condições, todas visíveis na linha:

1. **Cópias cedo**: cópias suas (campo + reserva do GEP + as da loja agora) ≥ `HUNT.openCopies` (3, ou seja, já 2★) até o
   estágio 3, ou ≥ 5 depois. Sem isso, a chance de várias rodadas não chega ao limiar (4.3).
2. **Nível**: no `rerollLevel` (ou +1). Abaixo dele, "segure as cópias e role no nível N", com a chance projetada no nível N.
3. **Pool**: cópias livres (`free`, descontado o banco estimado dos rivais) ≥ faltam; teto observado (`upper`) ≥ faltam.
4. **Rivais**: nenhum rival segura ≥ `HUNT.rivalHold` cópias (3, ou seja, ele já tem 2★ ou guarda o par) **e** a soma não
   chega a `POLICY.contested` (6 cópias ou 35% da pool). A linha mostra quem segura: "Ana 3 (2★), ~1 no banco de Bia".
5. **Chance em várias rodadas** ≥ `HUNT.slowChance` (0,4, abaixo dos 50% de uma rodada porque o reroll lento só gasta o que
   passa do piso de juros): fechar até o prazo do alcance (`reachHorizon`: ponto de poder ou o que a vida aguenta), rolando a
   cada rodada o que passa do piso.

Só é alvo de 3★ a peça marcada `star3` (estrela-alvo da comp de reroll; hoje `meta.stars3` + carry, R4 troca pela regra do
alcance) ou a oportunista. Os outros 2★ não aparecem como "desista do 3★" (ninguém ia buscá-los).

### 4.3 Quanto rolar acima de 50 g e com que chance

- **Por rodada**: B = ouro − 50 (lento) ou ouro − 20 (rápido, vida ≤ 50). A rodada mostra a chance de fechar agora com B.
- **Várias rodadas** (`slowRoll`): orçamento acumulado = B agora + (H − 1) × (renda guardando no piso, `incomeOf(piso)`) +
  H lojas grátis (uma por rodada, 2 g cada), com H = rodadas até o prazo. Chance = `closeCurve` com esse orçamento e a
  chance por vaga dividida pelos rivais que seguram a peça (cada um leva `REACH.rivalShare` das cópias que aparecem, como
  no alcance; na conta, o denominador cresce e as cópias livres não). Aproximação declarada: a pool não volta (vendas) e
  as rodadas são somadas como um orçamento só. Esse desconto é forte (2 rivais com a peça derrubam 49% para ~3% com 80 g
  num custo 2 a 4/9): é a primeira coisa a calibrar no R8.
- **Linha**: "Kayle 3★ 4/9 · 8 livres · Ana 2 · 5% com 12g agora · 52% rolando o excedente de 50g até 4-1 (~70g em 5
  rodadas)".
- **3★ oportunista** (fora da comp de reroll): qualquer peça sua de custo 1 a 3 com ≥ `HUNT.opportunistCopies` (6) cópias,
  sem rival que a segure, com chance ≥ 50% no orçamento desta rodada (ou na de várias rodadas sem passar do ponto de poder).
  Entra como alvo "3★" com o valor medido. É o caso "achei 6 cópias de custo 2 no nível 6 de uma comp padrão".

### 4.4 Por que hoje quase nunca sai rolar por 3★

1. `roll.mjs`: 3★ a 4+ cópias é `far` ("longe") e não entra na simulação, salvo carry ou `stars3`.
2. `rollRule`: exige 50% **nesta rodada**. O reroll lento é de várias rodadas (4.3), então nunca passa.
3. `strategy.mjs` `settle`: o ramo de reroll (`decide`, passo 2) manda "Reroll lento: role Xg"; `settle` chama `rollRule` com
   `planned`, cai em `hold` e troca por "Rolar não compensa agora: guarde". A confirmar com um teste de caracterização (R0).
4. `core/comps/reach.mjs`: todas as `stars3` em 3★ ao mesmo tempo e o corte "ouro da compra passa do orçamento → chance 0"
   (`left < 0`). Em correção pelo `tft-comp-viabilidade`, que é dependência.

### 4.5 Quando desistir

- **Disputa**: `isContested` (6+ cópias com rivais ou 35% da pool) ou um rival com ≥ `HUNT.rivalHold` cópias que também
  rola por ela. A linha nomeia: "desista do 3★: Ana segura 4 cópias (2★ + 1 no banco)".
- **Pool**: teto observado < faltam (nem todas as cópias fora dos tabuleiros bastam).
- **Prazo**: chance em várias rodadas < `HUNT.giveUp` (0,25) até o prazo. "Fique no 2★ e suba de nível" (o ramo de
  desistência de `strategy.mjs` passa a usar essa conta, não só `possible`/`contested`).
- **Vida**: em perigo, o 3★ só continua se a chance desta rodada passar de `dangerChance` e o ganho pagar o ouro (a regra de
  perigo de hoje). Caso contrário, role por 2★ do plano ou estabilize.

## 5. Rolagem por estilo de comp

A rolagem segue o **plano em andamento** (mantido ou fixado em `plan-state.mjs`), nunca a 1ª do ranking
(`planos/a-fazer/sugestoes-a-favor-do-plano.md`). O estilo vem da meta do plano (`rerollLevel`, `levelling`, `stars3`).

| Estilo                                | Quando rolar                                                                                                              | Orçamento                                                         | Alvos (ordem)                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Reroll (nível N, 3★)                  | No nível N (ou N+1), toda rodada, enquanto o 3★ do carry estiver aberto (4.2)                                             | O que passa de 50 g (lento) ou de 20 g (rápido, vida ≤ 50)        | Carry 3★, depois os 2★ do plano. 3★ secundários só pela meta corrigida do alcance    |
| Fast 8 / Fast 9                       | Rolagem forte (roll-down) no nível alvo, no ponto de poder (4-1/4-2 no 8; 5-1 no 9); antes, só por vida ou upgrade barato | No roll-down, tudo acima do piso da faixa (normalmente 10 a 30 g) | Carry de custo 4/5 a 2★, peças que faltam do plano, depois 2★ baratos que já têm par |
| Padrão (sem `rerollLevel` nem Fast N) | No nível do custo do carry (`rollLevelOf`); antes, só se a board está abaixo do lobby e o ganho por ouro passa o XP       | Acima do piso da faixa, parando no joelho (`bestSpend`)           | Carry 2★, peças que faltam, upgrades baratos e o 3★ oportunista                      |

Mudança de plano: todas as sugestões mudam juntas e a linha diz "nova comp: rolagem agora por X".

## 6. Validação com dados reais

Dados disponíveis (somente leitura):

- `%APPDATA%\TFTAcademy\tft-events.db` (GEP gravado): 15 partidas, 1.369 lojas (`store.shop_pieces`), 2.400 leituras de ouro
  (`me.gold`), reserva e campo (`bench_pieces`, `board_pieces`) e XP. É a fonte que tem **as lojas que de fato apareceram**.
- `../data/scouting-captures.jsonl` (19.136 linhas, 44 partidas: campo de todos os 8 jogadores ~30 vezes por partida) para os
  rivais, a pool e os bancos estimados (`hiddenHoldings`) no instante de cada loja.
- `../data/match-history.jsonl` (100) e `../data/lobby-boards.jsonl` (426): tabuleiro final e colocação (o 3★ fechou? que
  colocação deu?).
- `../data/match-live/*.json.gz` (5) e `tests/golden/fixtures/snapshots/*.json.gz` (17 cenários, entre eles
  `reroll-hidden-banks`, `danger-hp27`, `late-lvl9-critical`).

Medições (script de leitura no scratchpad, depois fixture higienizada em `tests/fixtures/`):

1. **Calibração por loja**: para cada loja do GEP, o modelo (odds do nível × livres ÷ livres do custo com a pool do instante)
   prevê a chance de cada campeão por vaga. Comparar com a frequência observada nas 5 vagas, por faixa de probabilidade
   (curva de calibração e Brier). Mede `slotChance`, a pool livre e o banco estimado dos rivais.
2. **"Role por X com B" acerta?** Em cada rodada em que o jogador rolou (lojas seguidas na mesma rodada com o ouro caindo de
   2 em 2), pegue o ouro de fato gasto g. Para cada alvo que a função listaria naquele instante, compare a chance prevista
   `curva[g]` com o que **as lojas mostraram** (as cópias que faltavam apareceram dentro de g, comprando tudo o que aparece e
   pagando as cópias). As lojas não dependem da recomendação, então a conta é contrafactual-livre para "fechar com aquele
   gasto". Agrupar por faixa prevista (0–20%, 20–40%, …) e comparar com a frequência real. Critério: erro absoluto médio por
   faixa ≤ 10 pontos e nenhuma faixa com mais de 15 pontos de erro, com pelo menos 30 casos na faixa.
3. **3★ em várias rodadas**: nas partidas em que o jogador ou um rival segurou ≥ 3 cópias de custo 1–3 no estágio 3, prever a
   chance de 3★ até o prazo e conferir com o tabuleiro final (`lobby-boards`, `match-history`). Amostra pequena: reportar com
   o intervalo.
4. **Valor do 3★**: recalcular a tabela por custo da seção 1 com a estatística por campeão e com `lobby-boards` (colocação real
   dos tabuleiros com 3★ contra os sem 3★ no mesmo lobby).
5. **Goldens**: `strategy.panels.rolling` muda nos 17 cenários. Cada mudança precisa de justificativa (qual alvo entrou,
   que veredito mudou e por quê). Não regravar sem o orquestrador pedir.

## 7. Passos incrementais

Coordenação (2026-10-11): `tft-comp-viabilidade` edita `core/comps/reach.mjs` e `engine.mjs`; `tft-substitutos` edita
`stage.mjs`, `tactics.mjs`, `core/board/` e `v2/`; `tft-overlay` edita `overlay/`. Nada disso é tocado até eles terminarem.
Com partida em andamento: só testes focados, nada de suíte inteira nem benchmark.

| Passo | O que                                                                                                                                                                                                                                                                                                                                                                                                        | Arquivos                                                                                            | Testes / critério de pronto                                                                                                                                                                                                                                                                               | Depende de                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R0    | Caracterização do problema: reroll lento morto pelo `settle` (4.4.3) e 3★ "longe" fora da simulação                                                                                                                                                                                                                                                                                                          | `tests/strategy.test.mjs` (caso novo, marcado como comportamento atual)                             | O teste mostra o "guarde" de hoje; vira o caso que R3 inverte                                                                                                                                                                                                                                             | nada                                                               |
| R1    | **Módulo puro** `core/roll/hunt.mjs`: orçamento, chance por alvo com B/T/B↑, gasto esperado, ganho por ouro, veredito e texto com ouro; 3★ (`threeStar`: cópias/9, livres, quem segura, chance agora e em várias rodadas, `role`/`segure`/`desista`); `HUNT` (limiares desta regra). `goldFor` passa para `core/pool/curve.mjs` e `isContested` para `core/roll/hunt.mjs`, com reexportação em `economy.mjs` | `core/roll/hunt.mjs` (novo), `core/pool/curve.mjs`, `economy.mjs` (só reexportação)                 | `tests/core-hunt.test.mjs`: chance = `closeCurve`; gasto esperado; ordem por ganho por ouro; inviável/disputada com o nome de quem segura; subir antes (custo 4) e não subir (custo 1); 3★ em várias rodadas > uma rodada; desistência; textos sempre com "g". `tests/economy.test.mjs` continua passando | nada (não toca arquivo de outro agente)                            |
| R2    | Valor medido da estrela: `starValue(stats, id, from, to, cost)` com encolhimento para a mediana do custo; a régua de `interim` para peça nova e temporário entra por parâmetro                                                                                                                                                                                                                               | `core/roll/hunt.mjs`                                                                                | Teste com tabela de estatística pequena (fixture), sem rede                                                                                                                                                                                                                                               | R1                                                                 |
| R3    | Encaixe na regra: `teamOf` deixa de cortar 3★ "longe" quando `threeStar` diz `role`/`segure`; `rollRule` aceita a chance de várias rodadas no reroll lento; `settle` não mata o reroll lento; o ramo de desistência usa `threeStar`; `panels.rolling.hunt` com o modelo da seção 3                                                                                                                           | `roll.mjs`, `strategy.mjs`                                                                          | R0 invertido; `tests/roll.test.mjs` e `tests/strategy.test.mjs` ajustados onde codificavam a regra de uma rodada; goldens com a diferença justificada (não regravados)                                                                                                                                    | R1, R2; estrela-alvo do alcance corrigida (`tft-comp-viabilidade`) |
| R4    | Mesma estrela-alvo da comp: a rolagem lê a função de estrela-alvo do alcance (carry de reroll 3★, resto 2★) em vez de `stars3` cru                                                                                                                                                                                                                                                                           | `roll.mjs`                                                                                          | Teste: comp de reroll com duas `stars3` → só o carry rola por 3★                                                                                                                                                                                                                                          | `tft-comp-viabilidade` publicar a função                           |
| R5    | Quem segura cada peça: `analysis.pool[].holders` = `[{ name, copies, hidden }]` (campo por rival e banco estimado por rival: `hiddenHoldings` passa a devolver também o mapa por rival)                                                                                                                                                                                                                      | `pool-tracker.mjs`, `engine.mjs` (encaixe: pedir ao `tft-comp-viabilidade` ou esperar ele terminar) | `tests/pool-tracker.test.mjs` (por rival soma o total de hoje); o texto "desista: Ana segura 4 cópias"                                                                                                                                                                                                    | engine livre                                                       |
| R6    | Interface: seção Roll com "Role por:", lista com ouro e "Fora:"; tirar "Achar rolando" (`findIndicator`, `FIND_DEFAULT_SHOPS`, `findStrip`, `findHtml`, CSS `.finds`) e o "% por loja" como número principal                                                                                                                                                                                                 | `v2/js/model.js`, `v2/js/ui/panel.js`, `v2/css/panel.css`, `roll.mjs`                               | `v2/js/model.test.mjs`, `v2/js/panel.test.mjs` (linha sempre com "com Xg"; sem "chance de ver uma cópia")                                                                                                                                                                                                 | R3; `tft-substitutos` fora de v2                                   |
| R7    | Overlay: "Vale rolar?" com o 1º alvo e o ouro; dica "Role até Xg por Azir"                                                                                                                                                                                                                                                                                                                                   | `overlay/hud/view.mjs`, `draw.mjs`, `hints.mjs`                                                     | `tests/overlay-hud.test.mjs`, `tests/overlay-hints.test.mjs`                                                                                                                                                                                                                                              | R3; `tft-overlay` livre                                            |
| R8    | Validação (seção 6): calibração por loja e "role por X com B" com o `tft-events.db` e as capturas; fixture higienizada e teste que trava a calibração                                                                                                                                                                                                                                                        | script no scratchpad; `tests/fixtures/roll-calibration.json`; `tests/roll-calibration.test.mjs`     | Critério da seção 6.2; relatório com faixas e amostras                                                                                                                                                                                                                                                    | R1 (pode correr em paralelo a R3)                                  |
| R9    | Plano em andamento: a rolagem cita peças, nível e estilo do plano mantido/fixado em toda a sequência de uma partida real (`plan-sequence`)                                                                                                                                                                                                                                                                   | `tests/strategy.test.mjs` ou golden `plan-sequence`                                                 | Teste de sequência                                                                                                                                                                                                                                                                                        | `sugestoes-a-favor-do-plano.md`                                    |

## 8. O que só se confirma com o jogo aberto

- Se a linha "Role por" cabe no painel e no overlay sem quebrar a leitura durante a rodada.
- A loja com Wisp (4 vagas de campeão): a chance por loja fica superestimada até o PLANO-TOTAL tratar isso.
- O banco dos rivais é estimado (meia-vida de 3 min); em partidas reais o erro só aparece na calibração (R8).
- Se o jogador para de rolar quando fecha (a recomendação supõe que sim).

## 9. Contrato "por quem rolar" (para o overlay e a interface)

Pedido do usuário (via coordenador): "quando o overlay recomenda rolar, ele tem que informar por quem é para eu rolar, o
que é para buscar na rolagem." Regra: **sem alvo com chance, a decisão não é "rolar"** (`strategy.mjs` `withoutTarget`
troca por guardar).

`rec.strategy.panels.rolling.rollFor` (ao lado de `call`, o veredito de sempre), `null` sem ouro/nível lido ou fora da
partida:

```js
{
  go: true,                       // a decisão é rolar e há alvo; false = nenhum alvo (targets vazio)
  spend: 25, keep: 50,            // ouro a gastar e onde parar (= strategy.spend / strategy.keep)
  text: "Role 25g (até 12 lojas), pare em 50g",
  targets: [                      // até 3, em ordem: evoluções (2★/3★) por chance × valor, depois as peças que faltam
    {
      id: "TFT_Aphelios", name: "Aphelios", cost: 4,
      goal: "2★",                 // "2★" | "3★" | "falta"
      have: "2/3",                // cópias suas / meta ("4/9" no 3★, "0/1" na peça que falta)
      chance: 0.68,               // chance de fechar (ou achar) com `spend`, focando nesta peça
      slow: null,                 // 3★ de reroll lento: { chance, rounds } em várias rodadas
      rivals: { copies: 0, hidden: 0, names: [] }, // cópias em campo de rivais, estimadas nos bancos, quem tem
      why: "2★ do carry",         // "2★ do carry" | "fecha o 2★" | "3★ do carry" | "3★" | "peça do plano que falta"
      text: "Aphelios 2★ · 68% com 25g",
      detail: "…",                // a linha longa da caça (motivo completo)
      carry: true,
      inShop: false, slots: []    // carta do alvo na loja de agora (destaque "achou: X")
    }
  ]
}
```

`rec.strategy.panels.rolling.hunt`: a caça inteira para o painel (`verdict { kind: role|suba|guarde|segure|nada, spend,
keep, saveTo, level, text }`, `headline` "Role por: …", `targets` com `verdict`, `chance { spend, total, levelUp }`,
`three { verdict, own, of, now, slow, rounds, level, text }`, e `dropped` com o motivo). Com a decisão de guardar, ela mostra
o que aconteceria rolando o ouro acima do piso. Até o R3, `hunt.verdict` pode divergir da decisão da árvore (`action`):
a tela deve seguir `call`/`action` e usar `hunt` só como lista.

## Progresso

- 2026-10-11, R1 feito: `core/roll/hunt.mjs` (`HUNT`, `huntBudget`, `huntTarget`, `threeStar`, `huntPlan`, `rollFor`,
  `starValue`, `expectedSpend`, `holdersText`, `isContested`), `goldFor` movido para `core/pool/curve.mjs`, `isContested`
  movido para `core/roll/hunt.mjs` (os dois reexportados por `economy.mjs`, sem mudar quem os importa).
  `tests/core-hunt.test.mjs` (15 casos).
- 2026-10-11, parte de R3: `strategy.mjs` monta a caça com o orçamento da decisão (`huntOf`), expõe `rollFor` e `hunt` em
  `panels.rolling`, e rolar sem alvo vira guardar (`withoutTarget`). Teste novo em `tests/strategy.test.mjs`. Custo medido:
  ~16 ms por chamada com 16 peças (curvas exatas); cache das curvas por (nível, custo, cópias, livres) fica para depois.
  Falta de R3: `teamOf`/`rollRule`/`settle` com a conta de várias rodadas (o reroll lento ainda pode ser trocado por
  guardar pela regra de uma rodada) e os goldens com a diferença justificada.
