# Vitória como a medida das comps (itens e estrelas pelos dados da MetaTFT)

Estado: **em andamento** (código escrito em 2026-10-12; nenhum teste rodado, por regra do usuário). Executor: o
orquestrador, direto.

## 1. Pedido

1. "O peso dos itens que eu tenho na comp faz total diferença. O peso deve ser considerado com base nas colocações do
   meta TFT."
2. "A linha de raciocínio da pontuação deve considerar sempre a maior taxa de vitória dadas variáveis da partida, isso
   serve para comps e para recomendado, cruzando dados e fazendo cálculos."
3. "Inclusive chance de obter campeão devido os rivais, ou seja, chance de obter os campeões 1, 2 ou 3 estrelas."

Decisão do usuário (2026-10-12): a medida é a **vitória (1º lugar)**; top 4 e colocação média ficam só como informação.

## 2. O que os dados mostraram

- **Os itens pesavam quase nada.** Na colocação esperada E, os itens entravam por `0,3 × planPoints(total) / 20`: no
  máximo **0,375 de colocação**, por mais itens que você tivesse (1 colocação de valor medido virava 0,15). E a pergunta
  medida levava 2 itens como "o tabuleiro tem o item", em qualquer peça.
- **Colocação média não serve para estimar vitória.** Nas 60 comps do Set 18 (patch 18.4b), a reta vitória × colocação
  tem R² = 0,19: comps com a mesma média vencem de 8,5% a 15%.
- **A estrela muda tudo.** Cassiopeia com 3 itens: 7,6% de vitória e 36% de top 4 em 2★; 19,2% e 70% em 3★.
- **Itens por quantidade não servem como peso.** Rengar 2★: 5,42º com 0 itens e 6,03º com 3, porque peça de reroll com
  itens e sem 3★ é partida que deu errado. O peso tem de vir condicionado à comp.
- **O explorer da MetaTFT dá o que falta:** `win_percentage` e `placement_count` em toda resposta, e o filtro
  `unit_item=<campeão>&<item>` (com o `&` codificado) mede o item **naquele** campeão. Cassiopeia com Blue Buff: 107.585
  partidas, 11,8% de vitória.

## 3. O desenho

Vitória esperada de cada comp (`engine.mjs` `winExpectedOf`), na mesma forma da colocação esperada:

```
W = p · (vitória montada + itens fora da pergunta + aprimoramentos − descarte) + (1 − p) · vitória da reserva
```

- **p**: o alcance de antes (as suas peças, a pool livre depois do que os rivais seguram, o ouro, o nível, o prazo pela
  vida).
- **Vitória montada**: a pergunta medida da comp (`measure`) agora:
  - leva **os seus itens no campeão para onde o plano de itens os manda** (`unit_item`, até 3, do maior valor medido
    para o menor; a pergunta mais longa com 300+ partidas é a que vale);
  - é refeita **com a peça-chave em cada estrela** (`starSplit`): a 3★ principal do reroll ou o carry 2★, na
    estrela-alvo e na de baixo, pesadas pela chance de chegar à estrela-alvo (`reachOf` com a estrela da comp: cópias
    que faltam, cópias livres depois dos rivais, ouro, odds do nível e prazo).
  - Sem pergunta medida: a vitória publicada da comp (`meta-comps.json` `win`), corrigida pelo ganho publicado das
    builds que você tem (`item-edge.mjs`).
- **Itens fora da pergunta**: o valor medido (MetaTFT, campeão × item) dos seus itens que o plano põe na comp e que a
  pergunta não levou, pela curva de retorno decrescente do plano de itens, **inteiro** (sem a fatia de 30%). A mesma
  regra vale para E (`residualItemsOf`).
- **O que ainda chega em colocações** (custo de trocar, histerese, tier de aprimoramento, descarte, ganho publicado das
  builds, reserva sem medida) vira vitória pela reta medida nas comps de meta (`core/comps/win.mjs` `winFit`, recalculada
  a cada análise; reserva fixa: vitória ≈ 0,364 − 0,0531 × colocação).
- **Ordem, troca de plano, confiança e score** saem de W. O score é W numa curva sem teto (2% = 0, 12,5% = 50, 25% ≈ 78, 40% ≈ 92; 2026-10-12: a régua linear até 25% empatava as comps fortes em 100 no fim de jogo)
  (`scoreFromWin`). A troca exige `W_desafiante − W_mantido > custo + histerese` (os dois convertidos pela reta).
- Sem vitória em nenhuma resposta (cache antigo, golden congelado), W = a + b·E: a ordem é exatamente a de E.

## 4. O que foi feito (2026-10-12)

| Arquivo                                                          | Mudança                                                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/comps/win.mjs` (novo)                                      | `winFit`, `winOfAvg`, `winOfPlacementDelta`, `winSe`, `winOf`, `scoreFromWin`, `WIN_SCALE`                                                                           |
| `evidence.mjs`                                                   | respostas guardam `win`; filtro `unitItem`; o cache descarta ao carregar o total antigo sem vitória (`rejected.format`)                                              |
| `meta-scope.mjs`                                                 | `evidenceIds` lê o campeão do `unit_item` (checagem do set)                                                                                                          |
| `meta-stats.mjs`, `meta-store.mjs`                               | estatísticas `[média, partidas, vitória %]`; a validação aceita o terceiro número                                                                                    |
| `engine.mjs`                                                     | itens por campeão na pergunta, `starSplit`, `winExpectedOf`, `residualItemsOf`; ordem, troca, confiança, score e ranking por W; `compRanking[].win` (%) e `winParts` |
| `comp-score.mjs`                                                 | score de W (`win`); sem W, a régua antiga de E                                                                                                                       |
| `plan-state.mjs`                                                 | frase da troca de plano em pontos de vitória                                                                                                                         |
| `v2/js/model.js`, `ui/comps.js`, `ui/comp-modal.js`, `ui/hud.js` | "X% de vitória" à frente; colocação e top 4 ao lado                                                                                                                  |
| `overlay/hud/comp.mjs`, `view.mjs`, `draw.mjs`                   | a vitória ao lado do score, como na interface                                                                                                                        |
| `tests/meta-scope.test.mjs`, `tests/live-load.test.mjs`          | ajustados ao formato novo (sem rodar)                                                                                                                                |

## 5. Falta

1. **Rodar a suíte e regravar o golden** quando o usuário pedir: o score, E (itens fora da pergunta) e a ordem offline
   (vitória publicada) mudam de propósito.
2. **Reiniciar o servidor** (o usuário): o motor e o cache de evidência só valem depois. Na primeira análise, as perguntas
   sem vitória e as novas (itens por campeão, estrelas) vão à MetaTFT: espere mais requisições na primeira rodada.
3. **Conferir numa partida**: a linha do porquê ("X% de vitória · Nº esperado · Peça 3★ com N% de chance (Y% em 3★, Z%
   em 2★)"), a ordem das comps com itens diferentes no banco e a troca de plano.
4. **Política que segue fixa** (registrada, calibrar): `WIN_SCALE` do score, a curva `planPoints` dos itens fora da
   pergunta, `ITEMS_ASKED = 3`, `MIN_GAMES = 300` e a reserva `FALLBACK_FIT`.
5. **Próximos passos possíveis**: medir a vitória de cada item fora da pergunta por comp (uma pergunta por item); usar a
   distribuição de colocações (`placement_count`) para a vitória da reserva; levar a vitória às tabelas por campeão ×
   item (`meta-stats.json` já guarda o terceiro número na próxima sincronização).
