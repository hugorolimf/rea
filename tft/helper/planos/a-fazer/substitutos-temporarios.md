# Substitutos temporários e substituições plausíveis da comp

Estado: **a fazer** (fase 1 concluída em 2026-10-11: plano e medição, sem código). Executor: `tft-substitutos`.
Ao começar a fase 2, mova este arquivo para `planos/em-andamento/` e atualize `planos/README.md`.

## 1. Pedido

> "Enquanto estou montando a comp recomendada ou seguida, muitas vezes não tenho todos os campeões. O assistente deveria
> sugerir substituições temporárias com outros campeões até eu conseguir o time completo, ou talvez não: ele vai medir a
> força. Se o substituto for bom e tiver nível alto, contra um campeão da comp 1★, às vezes compensa deixar o substituto.
> Isso não muda a comp de fato: o assistente vai recomendar a compra de ambos."

Somado depois: "é interessante ver, na mesma fonte que vemos no meta, substituições plausíveis de comps."

## 2. Quatro coisas diferentes (não misturar)

| Conceito                                    | Pergunta                                                                              | Dono                                                                | Fonte                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| Plano/comp                                  | Qual comp eu sigo?                                                                    | `core/comps/reach.mjs` + `engine.mjs` (`tft-comp-viabilidade`)      | colocação esperada E                               |
| Substituição permanente                     | Esta peça da comp está disputada/inalcançável: qual entra no lugar dela de vez?       | `engine.mjs` `flexOf`, `roll.mjs` `piece.substitute`                | heurística + `options.conditional`                 |
| **Substituição plausível publicada** (novo) | Nos tabuleiros finais do meta, quem joga no lugar de T nesta comp, com que colocação? | `meta-comps.mjs`/`meta-store.mjs` (`tft-meta-offline`) + este plano | MetaTFT explorer (seção 6)                         |
| **Temporário** (este plano)                 | Quem joga **agora** nesta vaga, até o titular ficar forte o bastante?                 | `core/board/interim.mjs` (novo, `tft-substitutos`)                  | régua de força medida no meio da partida (seção 4) |

O temporário não muda o plano nem o ranking. O titular T fica guardado na reserva e os dois são comprados.

Como um alimenta o outro:

- O publicado diz o que acontece **no fim** (tabuleiro final, nível 8). O temporário decide o **agora**. A medição da seção 4.4
  mostra que a estatística de tabuleiro final não serve para medir a força de agora: ela é usada para o desempate, o gatilho
  de volta e a compra, não para a força da vaga.
- S que é substituição plausível publicada para T, com delta pequeno, não precisa "voltar": vira candidato a substituição
  permanente e é entregue ao `flexOf` (dono `tft-comp-viabilidade`). Este módulo só mostra "pode ficar de vez".
- O temporário que joga muitas rodadas e segura a vida é um fato da partida. Ele não muda o publicado.

## 3. O que já existe (conferido no código)

- `stage.mjs:54-70`: a Formação de agora põe **todas** as peças da comp que você tem primeiro e só completa as vagas com
  "temporario", ordenadas por `strength = estrelas × custo + itens × 2`. Uma peça da comp 1★ sempre tira um temporário 2★.
- `stage.mjs:94-107`: cada compra da comp entra numa vaga livre ou **no lugar da temporária mais fraca** (`replaces`), sem
  comparar a força de quem entra com a de quem sai.
- `stage.mjs:108-148`: "pontes" para vagas sem peça da comp (sinergias compartilhadas, chance de loja, disputa e custo).
- `stage.mjs:179-191`: a loja dá prioridade a fechar estrela, ao carry, à peça da comp, à cópia sua e à ponte. Não existe
  o papel "temporário mais forte agora".
- `tactics.mjs:216-249`: `transitions` tem **outra** regra para a mesma decisão: `STAR = [0, 1, 1.8, 3.2]`, só o corpo
  (custo × fator), e quem entra precisa de `power(entra, k★) ≥ 0,9 × power(sai)`. Daí saem "Segure X 2★ em campo. Só troque
  quando T estiver k★" (`requiredStars`, `ready`). A Formação (`v2/js/model.js:354-366`, cartão "hold") mostra essa regra,
  enquanto `stage.board` mostra a outra. **As duas regras se contradizem, inclusive em quem sai.** No golden `danger-hp27`,
  `stage.buyNow` põe Soraka 1★ no lugar de Diana 2★ e Fiddlesticks 1★ no lugar de Brambleback 2★. Já `tactics` (pareando
  por papel) diz "Segure Shen 2★ … até Soraka 1★" e "Segure Diana 2★ … até Fiddlesticks 2★".
- `tactics.mjs:460` diz "vender a unidade quando a substituta entrar" e `tactics.mjs:603` ordena carry > comp > temporária.
- `roll.mjs:220-226`: `piece.substitute` é a troca permanente (`flex.suggest`) para a peça inviável. `R.offPlanWeight = 0.6`.
- `core/economy/policy.mjs:64-65`: `POLICY.star = [0, 1, 1.8, 3.2]` e `itemMight = 0.6`. É a régua do lobby
  (`economy.mjs` `lobbyStrength`), não medida.
- `engine.mjs:816-920`: trunfos com `stats.unit["id|estrela(|itens)"]`, `shrinkTo` e `MIN_GAMES = 300`. O comentário do
  próprio código já avisa: "Os dados são de tabuleiros FINAIS".
- A reserva do GEP chega por `screen.gepBench` → `options.bench`/`analysis.self.reserve` (com `benchKnown`).

## 4. Medição (fase 1)

Scripts só de leitura no scratchpad da sessão (`subs/load.mjs`, `ruler.mjs`, `cv.mjs`, `band.mjs`, `subs.mjs`, `extra.mjs`,
`golden.mjs`, `meta.mjs`, `meta2.mjs`, `place.mjs`). A fase 2 transforma o essencial em fixture e teste.

### 4.0 Dados

- `../data/scouting-captures.jsonl`: 18.884 linhas, ou seja, 44 partidas reais do Set 18 com o tabuleiro de **todos** os
  8 jogadores ~30 vezes por partida (vida, peças, estrelas e itens). Sem duplicatas sobram 1.251 instantes de lobby e
  5.191 observações jogador→instante seguinte.
- `../data/lobby-boards.jsonl` e `../data/match-history.jsonl`: tabuleiros finais e colocação. São 160 pares
  (partida, jogador), juntados às capturas de 32 partidas.
- `tests/golden/expected/*.json.gz`: 17 cenários com `stage.buyNow.replaces`, ou seja, as trocas que a Formação propõe hoje.
- `../data/match-live/*.json.gz`: 4 instantâneos ao vivo (plano, campo, reserva do GEP e `transitions`).
- MetaTFT explorer com o filtro correto (seção 6.1): `unit_tier` do Set 18, 244 linhas, ~7,5 milhões de tabuleiros.

"Comp" de cada jogador = o tabuleiro final dele (a comp que ele completou). S = peça em campo fora dela, 2★ ou mais. T =
peça dela que ainda não está em campo. Contrafactual: no tabuleiro de **agora**, T entra 1★ no lugar de S e recebe os itens
completos de S (vender S devolve os itens). Assim a comparação é de corpo e sinergia.

### 4.1 Qual régua prevê a vida perdida na rodada seguinte

Métrica: correlação de postos (Spearman) entre a força do tabuleiro e a vida **não** perdida até o instante seguinte,
dentro de cada instante do lobby (mesmo estágio, mesmos rivais). São 571 instantes úteis, com média ponderada pelo tamanho.

| Régua                                                                         | Correlação |
| ----------------------------------------------------------------------------- | ---------- |
| `stage.mjs` (estrelas × custo + itens × 2)                                    | 0,278      |
| `POLICY` (custo × [1; 1,8; 3,2] + item × 0,6)                                 | 0,294      |
| só número de peças                                                            | 0,185      |
| só patamares de sinergia                                                      | 0,173      |
| MetaTFT `unit\|estrela` (Σ 4,5 − média encolhida)                             | **0,068**  |
| MetaTFT `unit\|estrela` (Σ max(0; 5,5 − média))                               | 0,190      |
| **Proposta: custo × [1; 2; 5] + item completo × 2 + patamar de sinergia × 2** | **0,389**  |

Validação cruzada por partida (ajusta nas pares, testa nas ímpares e vice-versa):

- a melhor da grade fica em 0,397 / 0,393 no teste, contra 0,290 / 0,298 da `POLICY`;
- os parâmetros ajustados ficam estáveis: fator da 2★ entre 2 e 2,5, fator da 3★ ≥ 5 (no limite da grade), item entre
  1,5 e 2, sinergia 2;
- o fator da 2★ tem pico em 2,0. Ficam 1,8 = 0,381, 2,2 = 0,384 e 2,5 = 0,378.

Por nível médio do lobby (a sinergia pesa mais do nível 6 em diante):

| Faixa     | Instantes | Melhor                       | `POLICY` | Proposta (2; 5; 2; 2) |
| --------- | --------- | ---------------------------- | -------- | --------------------- |
| nível ≤ 5 | 216       | 0,434 (sinergia 1)           | 0,395    | 0,433                 |
| nível 6-7 | 280       | 0,366 (sinergia 2)           | 0,226    | 0,366                 |
| nível 8+  | 75        | 0,415 (sinergia 2, item 0,6) | 0,261    | 0,344                 |

Inclinação (MQO com a média do instante removida): cada ponto de força acima da média do lobby vale **0,44 / 0,38 /
0,35 de vida por rodada** (nível ≤ 5 / 6-7 / 8+). A perda média por rodada é de 1,85 / 4,92 / 6,41.

Conversão para colocação (136 tabuleiros finais, mesma régua): **~12,6 pontos por colocação**. A amostra é pequena; o valor
fica marcado como "medido, recalibrar".

### 4.2 Quantas vezes S 2★ fora da comp é mais forte agora que T 1★ da comp

Foram 993 instantes com um S 2★+ em campo e alguma peça da comp faltando, e 6.951 pares (S × T).

|                                              | Medida (proposta) | `POLICY` | Regra atual da Formação |
| -------------------------------------------- | ----------------- | -------- | ----------------------- |
| Instantes em que algum S vence algum T 1★    | **66,2 %**        | 53,0 %   | 0 % (T sempre entra)    |
| Pares em que S vence                         | **38,0 %**        | 23,4 %   | 0 %                     |
| Pares em que a medida e a `POLICY` discordam | 24,6 %            |          |                         |

O dano esperado de pôr T quando S vence é de **0,91 de vida por rodada em média**: 1,0 no nível ≤ 5, 0,85 no 6-7 e 0,78 no
8+. Um S 3★ ou 2★ de custo 3 chega a 2,0 por rodada. Para comparar, a perda média por rodada no nível ≤ 5 é 1,85: num trecho
de 3 a 5 rodadas até o titular ficar pronto, a diferença é de **3 a 5 de vida** por vaga mal decidida.

Por custo (S 2★ × T 1★; % dos pares em que S vence):

| S \ T      | custo 1             | custo 2           | custo 3    | custo 4    | custo 5    |
| ---------- | ------------------- | ----------------- | ---------- | ---------- | ---------- |
| custo 1 2★ | 79 % (`POLICY` 100) | 51 % (`POLICY` 0) | 36 % (0)   | 7 % (0)    | 16 % (0)   |
| custo 2 2★ | 99 % (100)          | 79 % (100)        | 73 % (100) | 23 % (0)   | 52 % (0)   |
| custo 3 2★ | 100 % (100)         | 100 % (100)       | 94 % (100) | 69 % (100) | 74 % (100) |

A `POLICY` é um degrau (S vence se 1,8 × custo S > custo T) e ignora a sinergia. A medida separa os casos pela sinergia que
S segura no tabuleiro de agora. Exemplo: S de custo 1 2★ × T de custo 2 vai de 0 % para 51 %.

Comportamento real dos jogadores (sem ver a reserva deles):

- Quando T entra em campo pela 1ª vez em 1★, o S 2★ que estava lá **fica** em 62 % dos casos para quem terminou no top 4
  (150 × 92) e em 52 % para quem terminou de 5º a 8º (234 × 214). Quem ganha segura mais o temporário.
- T de custo 4 e 5 aparecem em campo quase sempre já em 1★ (2 % entram 2★). T de custo 1 entra 2★ em 16 a 22 % das vezes,
  sinal de que esperou na reserva.

### 4.3 Antes/depois nas trocas que a Formação propõe hoje (golden)

`stage.buyNow` com `replaces` em 17 cenários: **59 trocas propostas**. Em **21 (36 %)** o temporário que sai é mais forte
que a peça da comp que entra, por mais que a margem (Δ < −1 ponto).

| Cenário                 | Hoje (Formação)                                        | Δ medida | Regra nova                                                                   |
| ----------------------- | ------------------------------------------------------ | -------- | ---------------------------------------------------------------------------- |
| `danger-hp27` (HP 27)   | Fiddlesticks 1★ no lugar de Brambleback 2★ (custo 4)   | −7       | manter Brambleback; Fiddlesticks na reserva                                  |
| `danger-hp27`           | Soraka 1★ no lugar de Diana 2★ (custo 3)               | −4       | manter Diana (o `tactics` também segura Diana, mas pareada com Fiddlesticks) |
| `danger-hp27`           | Teemo 1★ no lugar de Elise 2★ com 3 itens              | −4       | manter Elise; Teemo na reserva                                               |
| `replay-final`          | Ornn 1★ (custo 1) no lugar de Brambleback 2★ (custo 4) | −9       | manter                                                                       |
| `reroll-hidden-banks`   | Murkwolf 1★ no lugar de Pebbles 3★ com 3 itens         | −5       | manter                                                                       |
| `augments-chosen-offer` | Warwick 1★ no lugar de Elise 2★ com 3 itens            | −6       | manter                                                                       |
| `mid-lvl7-streak`       | Nidalee 1★ (custo 4) no lugar de Yorick 2★ (custo 1)   | +4       | trocar (igual)                                                               |
| `mid-lvl7-streak`       | Amumu 1★ (custo 4) no lugar de Master Yi 2★ (custo 3)  | +2       | trocar (igual)                                                               |
| `mid-lvl7-streak`       | Diana 1★ no lugar de Warwick 2★                        | −1       | empate dentro da margem: fica quem está em campo                             |

Instantâneos ao vivo (`match-live`, 4 partidas): todos são de fim de jogo, sem peça da comp na reserva, então nenhum caso
de decisão. Em `3292084330` o `tactics` já dizia "Segure Mama Beak 2★ … até Sentinel 2★", e a regra nova concorda.

### 4.4 Por que a estatística da MetaTFT por peça e estrela não mede a força de agora

Média do tabuleiro **final** por custo × estrela (MetaTFT, Set 18): custo 4 1★ = 5,42; custo 4 2★ = 3,81; custo 1 2★ = 4,70.
"Terminar com uma peça de custo 4 1★" quer dizer "caiu cedo". O número mede quem chegou lá, não a força da peça agora.
Por isso:

- nos 6.873 pares, `unit|estrela` diz que S vence em 79 % dos casos e a régua medida em 37,5 %; as duas concordam em 40 %;
- como régua de tabuleiro no meio da partida, `unit|estrela` correlaciona 0,07–0,19 com a vida perdida, contra 0,39 da
  proposta.

Conclusão: a força **na vaga agora** usa a régua calibrada nas capturas do meio da partida (dado medido pelo próprio helper).
O dado publicado da MetaTFT entra onde mede a coisa certa: o tabuleiro final (seção 6).

### 4.5 Limites da medição

- Correlação não é causa: quem tem tabuleiro forte também tem economia, posicionamento e aprimoramentos melhores.
- "Comp = tabuleiro final" é uma aproximação do plano. A reserva dos rivais não é vista, então não sei se eles tinham T.
- 44 partidas, a maioria em elos baixos e médios (o lobby do usuário). A faixa de nível 8+ tem só 75 instantes.
- Sinergia contada como patamares ativos, sem o valor de cada sinergia. Papel e posição não entram na régua medida.
- O fator da 3★ ficou no limite da grade (≥ 5): há poucos 3★ no meio da partida e quase todos são de custo 1 a 2.

## 5. Regra proposta

### 5.1 Força na vaga

Para o tabuleiro B de agora e a peça u:

```
corpo(u)        = custo(u) × F[estrela(u)]            F = POLICY.interim.star = [0, 1, 2, 5]
itens(u)        = POLICY.interim.item × itens completos(u)       (componente = 0)
sinergia(u, B)  = W(nível) × (patamares(B) − patamares(B − u))   W = 1 até o nível 5; 2 do nível 6 em diante
papel(u, vaga)  = −POLICY.interim.role se o papel de u (frente/trás, championRole + alcance) não serve à vaga; senão 0
força(u, B)     = corpo + itens + sinergia + papel
```

- `patamares` = soma dos tiers ativos (`traitBook.status`), sem as sinergias solo, com os emblemas dos itens (`book.of`).
  Os aprimoramentos escolhidos entram como emblema (`book.grants`), igual ao motor.
- Ponte: S que mantém um patamar **da comp** soma por esse termo. O desempate dentro da margem prefere quem mantém a
  sinergia da comp.
- Papel: a vaga é a posição planejada (`tactics.positions`: linha 0–1 frente, 3 trás). Esse termo é **política** (não foi
  medido); começa em 1 ponto.

Evidência medida, nesta ordem:

1. **Régua medida no meio da partida** (seção 4.1). É ela que decide a vaga. Os valores ficam em `POLICY.interim`, com o
   rótulo de origem "medido: 44 partidas, 5.191 observações, 2026-10-11".
2. **Substituição plausível publicada** (seção 6), só a partir do nível 8 (o nível em que ela foi medida). Soma
   `−delta × POLICY.interim.placementToPower` à força de S (delta encolhido, ver 6.4). Antes do nível 8 ela só desempata.
3. Sem nenhuma das duas (peça fora do catálogo ou sem custo), cai em `POLICY.star`/`itemMight`, marcada como
   "régua de política".

Não muda: `POLICY.star`/`itemMight` continuam sendo a régua do lobby (`lobbyStrength`, `pressureOf`), que é de outro dono
(`tft-pressao-vida`). A seção 4.1 indica que vale recalibrá-la também; isso fica registrado como pendência para ele.

### 5.2 Decisão por vaga

Para cada T da comp que você **tem** (campo ou reserva) e não está em campo, e cada S fora da comp em campo:

```
Δ = força(T em 1★ ou na estrela que tiver, com os itens de S, em B − S + T) − força(S, B)
quem fica = o ocupante atual, a menos que o outro o supere por mais de margem
margem = POLICY.interim.margin = 1 ponto (≈ 0,4 de vida por rodada; 15 % dos pares ficam com |Δ| < 1)
```

- Histerese sem estado guardado: o ocupante é quem está em campo agora (campo do GEP/captura). T na reserva só entra se
  `Δ > margem`. S só volta a ocupar a vaga de T se `Δ < −margem`. Isso evita oscilação de uma rodada para a outra.
- Escolha conjunta: pareamento guloso pelos maiores |Δ| (cada S serve a uma vaga), o mesmo padrão de `flexOf`. Com mais
  vagas que peças, preencha com a maior força disponível (campo, reserva, loja), preferindo a ponte que mantém um patamar
  da comp.
- Carry: o carry da comp entra assim que tiver 2 ou mais itens completos da build dele prontos (no banco ou em S), mesmo em
  1★, porque os itens rendem nele (política, a confirmar em partida). Fora isso vale a regra geral.
- Vida em perigo (`pressureOf`, faixa danger/critical): margem 0 e sem volta antecipada; fica o mais forte agora.

### 5.3 Gatilho de volta ("volta quando…")

Para cada S mantido, a primeira condição que vira o Δ, nesta ordem:

1. **Estrela:** a menor k ∈ {2, 3} com `força(T k★) − força(S) > margem`, com a chance de juntar as cópias pelo alcance
   (`starCopies(k) − cópias suas`, `chanceAtLeast` nas lojas ao alcance de `core/comps/reach.mjs`/`core/pool`). Texto:
   "volta quando T 2★ (faltam 2 cópias, ~60 % nas próximas 3 lojas)". Só aparece com a chance de pelo menos
   `POLICY.interim.returnChance` (0,5). Abaixo disso, mostra "T fica na reserva; sem previsão".
2. **Nível:** se o Δ com o peso de sinergia do nível 6+ (W = 2) já vira, mostra "volta no nível 6 (as sinergias da comp
   passam a pesar mais)".
3. **Itens do carry:** se T é o carry, "volta quando os itens do carry ficarem prontos" (regra do carry em 5.2).
4. **Publicado:** se S é substituição plausível publicada para T com delta ≥ −0,10 e partidas ≥ `MIN_GAMES`, mostra
   "S pode ficar de vez (meta: −0,05 · 2,3 mil partidas)" e entrega o par ao `flexOf` como sugestão. A decisão da comp
   continua com `tft-comp-viabilidade`.

Esta regra substitui o `requiredStars` de `tactics.mjs:216-249`: o mesmo cálculo passa a vir de `core/board/interim.mjs`, e o
cartão "hold" da Formação mostra o gatilho.

### 5.4 Compras: os dois

- As cópias de T continuam prioridade na loja e na rolagem: `stage.shop` (prioridades de `stage.mjs:188-191`) e `roll.mjs`
  `teamOf` não mudam para T.
- S da loja (cópia que leva S a 2★, ou S novo para vaga vazia) só é comprado se:
  - `ganho = max(0, Δ_S) × hpPerPoint(nível) × rodadas_até_a_volta` (rodadas limitadas por `POLICY.horizon[faixa]` + 2);
  - `custo = juros perdidos (patamar de juros que cai × rodadas até vender) + (custo − venda)`, com venda igual ao custo em
    1★ e 3 × custo − 1 em 2★ (custo ≥ 2);
  - compra se `ganho ≥ custo × POLICY.urgency[faixa]` (1 saudável, 0,6 ferido, 0,25 perigo, 0 crítico). Faixa e urgência
    vêm de `core/economy/` (`pressureOf`), dono `tft-pressao-vida`. A conversão ouro↔vida é política, marcada.
- Na loja aparece o papel novo "temporário mais forte agora" com o motivo ("+1,2 de vida/rodada até Sentinel 2★").
  Com a vida em perigo, sobe de "segurar" para "comprar". Saudável e juntando ouro, fica em "segurar".
- Reserva com 9 vagas (`benchKnown`): sem vaga para uma cópia de T, venda primeiro o S mais fraco que não é substituição
  plausível publicada e não fecha estrela. Nunca venda cópia de T. Reserva desconhecida: não sugere venda.
- Texto "compre os dois" quando T e S (que vale a compra) aparecem na mesma loja.

### 5.5 Itens no substituto

- S pode segurar itens da build de T (ou do carry) enquanto T espera. Vender S devolve os itens ao banco, e o
  `tactics` já diz "vender a unidade quando a substituta entrar".
- O motor único de itens (`core/items/`, dono `tft-itens-central`) recebe de `interim` o mapa `{vaga T → ocupante S}` e
  trata S como **portador temporário** da build de T: os itens da build de T vão para S se o papel serve (ver
  `championRole`), com o texto "coloque em S agora; passe a T depois (vender S devolve os itens)". Esse texto não é
  reimplementado aqui: é uma entrada nova em `core/items/scenarios.mjs` (fachada), e `stage.mjs:279-345` (itens do banco)
  passa a enxergar o portador temporário.
- Item que só serve a T (papel incompatível com S) fica no banco, com "guarde para T".

## 6. Substituições plausíveis publicadas (MetaTFT)

### 6.1 Problema anterior a tudo: o explorer está devolvendo o set errado

> **Corrigido em 2026-10-11 (`tft-meta-offline`).** O recorte P mora só em `meta-scope.mjs` e vale para `meta-comps.mjs`,
> `meta-stats.mjs` e `evidence.mjs`; `meta-stats.json` foi refeito (base 7.550.720, 65 de 74 campeões do catálogo, patch 18.4b);
> o cache de evidência contaminado foi renomeado para `data/evidence-cache.json.bak-20261011-182056`; estatística ou evidência
> fora do catálogo é recusada ("fora do set"). Ver `FONTES-DE-DADOS.md`, seção MetaTFT offline. O diagnóstico abaixo fica como registro.

- `meta-stats.mjs:18-26` e `evidence.mjs:145-148` chamam `tft-explorer-api/<endpoint>` sem filtros. Sem eles a API devolve
  uma base antiga (`total_games` 12.624, ids `TFT17_*`).
- `meta-stats.json` (`set: TFTSet18`, 2026-10-11) tem cerca de 1.020 chaves `TFT17_*` e nenhuma `DA_*`. O
  `../data/evidence-cache.json` tem 2.027 perguntas `DA_*` e **todas voltaram com `games: 0`**.
- Efeito: `stats.unit` nunca acha peça do Set 18. Os trunfos (`engine.mjs:858-918`), `options.conditional` e
  `conditionalRequests` ficam vazios em toda partida, e os rankings mostram `expectedParts.measured: false`.
- Correção (dono `tft-meta-offline`, fora deste plano mas pré-requisito da seção 6): usar o mesmo filtro do
  `comps_stats`: `queue=1100&patch=current&days=3&rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM&permit_filter_adjustment=true`.
  Com ele, `total` = 7.550.264 tabuleiros e `unit_tier` = 244 linhas `DA_18_*`.
- Também: `comps_stats` não traz mais `filter_adjustment.selected_patch`, então `meta-comps.json` sai com `patch: null`
  (`TFTSet18__sem-patch.json`). O patch está em `unit_items_processed.region_patch_adjustment.selected_patch` ("18.4b").

### 6.2 O que a MetaTFT publica sobre variação de peças (público, sem login)

| Fonte                                                                                          | O que traz                                                                                                                                                     | Tamanho              | Uso                 |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------- |
| `tft-comps-api/comps_data` (já usado)                                                          | `cluster_details` com `units_string`, `stars`, `builds`; o `centroid` é peso, não frequência                                                                   | 257 KB               | nada novo           |
| `tft-comps-api/comp_details?comp=<id>&cluster_id=<c>`                                          | `unit_stats[]`: presença de cada peça no cluster (`pcnt`, `avg`, `count`, por estrela); `options`, `early_options` (tabuleiros de nível 4 a 7), `final_levels` | 275 KB por comp      | `c.flex` (presença) |
| `tft-comps-api/comp_options[?comp=<id>]`                                                       | tabuleiros finais exatos por nível (`units_list`, `count`, `avg`); 14.410 no total                                                                             | 5 MB (todas) / 83 KB | conferência         |
| `tft-explorer-api/units_unique` com `unit=<id>` (presente), `unit=!<id>` (ausente) e `level=N` | colocação de cada peça **dado** o resto da comp sem T                                                                                                          | 1 consulta por peça  | `c.subs` (deltas)   |

`comp_details` e `comp_options` são pré-calculados e ignoram os filtros. A escala deles (1,65 M tabuleiros) não pode ser
misturada com a do `comps_stats` (7,5 M).

### 6.3 A pergunta "comp X com S no lugar de T", medida

```
substitutos: tft-explorer-api/units_unique?{P}&unit=<as outras 6 peças>&unit=!<T>&level=8
referência:  tft-explorer-api/total?{P}&unit=<as 7 peças>&level=8
```

Exemplo real, comp 426000 (Cassiopeia, Lillia, Ornn, Rammus, Rengar, Shen, Fiddlesticks), nível 8, sai Ornn:

| No lugar de Ornn       | Colocação | Partidas | Delta |
| ---------------------- | --------- | -------- | ----- |
| (referência, com Ornn) | 2,973     | 7.171    |       |
| Leona                  | 2,734     | 2.256    | −0,24 |
| Soraka                 | 2,757     | 1.185    | −0,22 |
| Kennen                 | 2,692     | 224      | −0,28 |
| Ivern                  | 2,915     | 284      | −0,06 |

Na comp 426003, nível 8, sai Teemo: GnarSmall +0,14 (2.629 partidas) e Kennen +0,15 (1.466).

O filtro de nível é **obrigatório**. Sem ele, a peça que é uma 8ª unidade parece muito melhor (Soraka −1,01) só por haver
mais peças no tabuleiro. Peça central (Azir, Rammus) quase não tem substituto (117–158 tabuleiros sem ela): isso também é
informação ("sem substituto plausível").

Como o motor já pergunta hoje: `options.conditional` é `units_unique` condicionado a **um** trunfo (`evidence.mjs:202-224`,
consumido em `engine.mjs:927-1000` e no contexto de `flexOf`, `engine.mjs:1775-1793`). É a mesma rota com outro filtro. A
pergunta nova acrescenta `unit=!T` e `level`, encolhe com `shrinkTo` (`MIN_GAMES = 300`) e reaproveita o cache de
`evidence.mjs`.

### 6.4 Proposta: `c.subs` no snapshot offline

```json
"subs": [{ "out": "DA_18_Ornn", "in": "DA_18_Leona", "level": 8,
           "avg": 2.734, "games": 2256, "top4": 87.1,
           "ref": 2.973, "refGames": 7171, "delta": -0.24 }],
"flex": [{ "id": "DA_18_Leona", "pct": 0.371, "avg": 4.291, "games": 4098 }]
```

- `delta = avg − ref`, ambos com o mesmo filtro e o mesmo nível. Delta negativo = melhor que o titular. Quem consome encolhe
  o delta: `delta × games / (games + MIN_GAMES)`.
- Até 5 substitutos com 100 ou mais partidas por peça (menos o carry): ~2.400 entradas, **~100–150 KB**. `flex` (presença
  ≥ 2 %): ~60 KB.
- Coordenação com `tft-meta-offline` (dono do formato, do frescor e do fallback):
  - conjunto novo `subs` em `DATASETS` (`meta-store.mjs:72-115`), arquivo `meta-subs.json`, `needsSet: true`, validação
    própria e `seed: true` (como `augments`), para preservar as comps cuja consulta falhou;
  - ~8 a 10 consultas por comp; com ~60 comps, ~520 consultas, ~15 a 20 s e ~5 MB. Isso **não cabe** no teto de 12 a 15 s
    do `scripts/meta-sync.mjs:12-13`: renovar em segundo plano pelo servidor ou num sync separado com teto maior; validade
    de 12 h;
  - a chave da ligação é `id` **mais** `units`, porque os ids de cluster mudam quando a MetaTFT reagrupa (426 → 4260xx);
  - sem rede: usa a última cópia; sem cópia, `subs` ausente e a tela diz "substituições não sincronizadas" (desconhecido
    explícito, não lista vazia);
  - a junção fica em `shapeComps` (`meta-comps.mjs:24-65`), cujo `...c` já repassa campos extras, e `validateComps`
    (`meta-store.mjs:29-44`) aceita campos a mais.
- API não oficial: sem cabeçalho de limite (47 consultas com 8 em paralelo levaram 1,4 s). Use concorrência baixa e
  cache.

### 6.5 Na aba Comps

Abaixo de "Builds e 3★", uma seção **Substituições**, no mesmo formato das builds:
"S no lugar de T · −0,20 · 1,2 mil partidas (nível 8)", com retrato de S e de T, ordenada por delta encolhido. Peça sem
substituto com amostra aparece como "sem substituto medido". Dono da tela: `tft-comps-ui`. A aba e o ranking não mudam de
outra forma.

### 6.6 Diferença entre publicado e temporário

|                       | Substituição plausível publicada                                           | Temporário                                   |
| --------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| Pergunta              | quem joga **no fim** no lugar de T nesta comp                              | quem joga **agora** nesta vaga               |
| Dado                  | MetaTFT, tabuleiros finais no nível 8                                      | régua medida nas capturas do meio da partida |
| Duração               | permanente (vira `flexOf` se a comp adotar)                                | até o gatilho de volta                       |
| Compra                | troca a peça a procurar                                                    | compra os dois                               |
| Onde aparece          | aba Comps, `flexOf`, `roll.substitute`                                     | Formação, loja, overlay                      |
| Como alimenta o outro | desempata o temporário, decide "pode ficar de vez", soma força no nível 8+ | nada volta para o publicado                  |

## 7. Telas

- **Formação** (`v2/js/model.js` `dock`/`cells`, `v2/js/ui/board.js`, `v2/js/ui/steps.js`): o cartão "hold" passa a vir de
  `interim`: "temporário: S 2★ · até T 2★ (faltam 2 cópias)". A célula de T fica "guardar na reserva" (estado `reserve` já
  existe). A célula de S ganha o selo ⇄ e "pode ficar de vez" quando for o caso. `stage.board` e o dock passam a dizer a
  mesma coisa, sem contradição.
- **Loja/compra** (`stage.shop`, linhas de compra de `v2/js/model.js:441-470`): papel "temporário mais forte agora";
  "compre os dois" quando T e S aparecem juntos; `replaces` só quando a peça da comp que entra é de fato mais forte
  (Δ > margem). Senão a compra vai "para a reserva".
- **Overlay compacto** (`app/overlay-feed.mjs`, `overlay/hud/view.mjs:420-440`, `overlay/hud/hints.mjs`): retrato de S com
  o selo ⇄; a dica mostra o gatilho ("volta quando Sentinel 2★"). Nada de texto longo no HUD. Dono: `tft-overlay`.
- **Aba Comps:** seção 6.5. O ranking e os cartões não mudam.

## 8. Arquivos a tocar (fase 2)

| Arquivo                                                                 | Mudança                                                                                                                                                                                                      | Dono atual / coordenação                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `core/board/interim.mjs` (novo)                                         | módulo puro: `slotStrength`, `interimBoard` (decisão por vaga e pareamento), `returnTrigger`, `interimBuy`; sem I/O                                                                                          | `tft-substitutos`                                              |
| `core/economy/policy.mjs`                                               | `POLICY.interim = { star, item, synergy: {early, late, lateLevel}, margin, role, hpPerPoint, placementToPower, returnChance }`                                                                               | `tft-pressao-vida` (só acrescentar a chave)                    |
| `stage.mjs`                                                             | linhas 54-70 (campo: `interimBoard` no lugar de "comp sempre primeiro"), 94-107 (`replaces` só com Δ > margem), 179-241 (papel "temporário" na loja + `interimBuy`), 279-345 (portador temporário dos itens) | `tft-loja-itens`, `tft-pressao-vida`: reler antes de cada Edit |
| `tactics.mjs`                                                           | linhas 216-249: `requiredStars`/`ready`/`reason` vêm de `returnTrigger` (uma régua só)                                                                                                                       | `tft-motor-itens`, `tft-formacao`                              |
| `core/items/scenarios.mjs`                                              | fachada "portador temporário" (`{vaga T → S}`)                                                                                                                                                               | `tft-itens-central`                                            |
| `v2/js/model.js`, `v2/js/ui/board.js`, `v2/js/ui/steps.js`              | rótulos do dock/células e "compre os dois"                                                                                                                                                                   | `tft-formacao`, `tft-web-ui`                                   |
| `app/overlay-feed.mjs`, `overlay/hud/view.mjs`, `overlay/hud/hints.mjs` | selo ⇄ e gatilho na dica                                                                                                                                                                                     | `tft-overlay`                                                  |
| `meta-stats.mjs`, `evidence.mjs`                                        | filtro P do explorer (6.1)                                                                                                                                                                                   | `tft-meta-offline` (pré-requisito)                             |
| `meta-comps.mjs`, `meta-store.mjs`, `scripts/meta-sync.mjs`             | `subs`/`flex` (6.4)                                                                                                                                                                                          | `tft-meta-offline`                                             |
| `v2/js/ui/comps.js`                                                     | seção Substituições (6.5)                                                                                                                                                                                    | `tft-comps-ui`                                                 |
| `tests/architecture.test.mjs`                                           | regra: só `core/board/interim.mjs` calcula a força na vaga (nada de `STAR = [...]` local em `tactics.mjs`/`stage.mjs`)                                                                                       |                                                                |

## 9. Testes

- `tests/core-board-interim.test.mjs` (novo), com casos reais deste documento:
  - golden `danger-hp27`: Diana 2★ (custo 3) fica e Soraka 1★ vai para a reserva (Δ −4). Brambleback 2★ fica no lugar de
    Fiddlesticks 1★ (Δ −7);
  - golden `mid-lvl7-streak`: Nidalee 1★ (custo 4) entra no lugar de Yorick 2★ (custo 1) (Δ +4). Diana × Warwick 2★ (Δ −1)
    fica com o ocupante (histerese);
  - `reroll-hidden-banks`: Pebbles 3★ com 3 itens fica;
  - gatilho: T 2★ alcançável → "volta quando T 2★"; sem cópias → "sem previsão"; nível 6 vira o Δ → "volta no nível 6";
  - carry com 2 itens prontos entra em 1★; vida em perigo → margem 0;
  - compra: saudável, S derruba o juro → "segurar"; perigo → "comprar"; reserva cheia → vende o S mais fraco, nunca cópia
    de T; reserva desconhecida → não sugere venda;
  - publicado: S com delta −0,05 e 2.000 partidas → "pode ficar de vez"; nível 8 soma `−delta × placementToPower`.
- Fixture `tests/fixtures/interim-captures.json`: ~20 instantes higienizados de `scouting-captures` (sem nomes de jogador),
  mais um teste que recalcula a correlação da régua e falha se ela cair abaixo da `POLICY` (guarda contra regressão da
  calibração, sem congelar números).
- `tests/core-economy.test.mjs`: `POLICY.interim` presente e `POLICY.star` intacta.
- `meta-store.test.mjs` (dono `tft-meta-offline`): conjunto `subs` com set errado → rejeitado; sem rede → última cópia.
- Golden: as partes `stage.board`/`buyNow.replaces`/`transitions.reason` mudam nos 17 cenários. Justificar caso a caso (36 %
  das trocas viram "manter") e não regravar às cegas.
- Verificação real: uma partida ao vivo observando a Formação e o overlay. O que só se confirma em partida: a histerese, o
  gatilho e o texto "compre os dois".

## 10. Riscos

- **Causalidade:** a régua foi calibrada por correlação; ela pode premiar o que acompanha jogadores melhores. Mitigação:
  margem explícita, histerese e recalibração com mais partidas (o helper grava `scouting-captures` em toda partida).
- **Duas regras hoje:** mexer só em `stage.mjs` deixaria `tactics` contradizendo a Formação. As duas precisam passar a usar
  `interim` no mesmo passo.
- **Oscilação** entre rodadas: histerese pelo ocupante e margem de 1 ponto. Um teste cobre.
- **Arquivos em edição por outros agentes** (`stage.mjs`, `tactics.mjs`, `core/economy/`, `core/items/`, `v2/`,
  `overlay/`): edições mínimas, relendo antes de cada Edit.
- **Explorer com set errado** (6.1): sem a correção, o publicado não existe e a regra roda só com a régua medida. Ela
  funciona sem o publicado, que é um acréscimo.
- **API não oficial da MetaTFT:** rotas mudam (cinco já deram 404) e os ids de cluster mudam. Chave por `id` + `units`;
  falha vira "não sincronizado".
- **Compra de S gasta ouro do plano:** limitada por `urgency` e juros. Com a vida saudável, o padrão é "segurar".
- **Ruído no texto:** o gatilho só aparece com chance ≥ 0,5 e no máximo um por vaga.

## 11. Ordem dos passos

1. `tft-meta-offline`: filtro P no explorer (6.1). Pré-requisito do publicado e já conserta os trunfos.
2. `POLICY.interim` + `core/board/interim.mjs` + `tests/core-board-interim.test.mjs` (puro, sem encaixe).
3. `tactics.mjs` `transitions` passa a usar `returnTrigger` (uma régua só); o dock da Formação já mostra o gatilho.
4. `stage.mjs`: campo (`interimBoard`), `replaces` com margem, papel "temporário" na loja + `interimBuy`.
5. `core/items/scenarios.mjs`: portador temporário (com `tft-itens-central`).
6. `v2` (Formação/compra) e overlay (selo ⇄, gatilho).
7. `tft-meta-offline`: `subs`/`flex` no snapshot offline; `tft-comps-ui`: seção Substituições; `interim` lê `c.subs`
   (desempate, "pode ficar de vez", força no nível 8+).
8. Golden justificado, `node --check`, suíte, uma partida real.

## 12. Dependências

- `tft-meta-offline`: 6.1 (filtro do explorer, patch) e 6.4 (formato, frescor, fallback de `subs`).
- `tft-pressao-vida`: chave `POLICY.interim` em `core/economy/policy.mjs`, `pressureOf`/`urgency` na compra de S, e a
  recalibração opcional de `POLICY.star`/`itemMight` (seção 4.1).
- `tft-itens-central`: portador temporário em `core/items/`.
- `tft-comp-viabilidade`: recebe "pode ficar de vez" como sugestão para `flexOf`; o plano não muda por este módulo.
- `tft-formacao` / `tft-web-ui` / `tft-overlay` / `tft-comps-ui`: telas.
