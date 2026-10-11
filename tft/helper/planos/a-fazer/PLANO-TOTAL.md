# PLANO-TOTAL - Evoluir o TFT Helper com o que os melhores jogadores fazem

Autor: `tft-estrategista`. Data: 2026-10-10. Set 18 (Enchanted Wilds), patch 18.4/18.4B. Base: pesquisas `00` a `07` da pasta `pesquisa/` (lidas integralmente), mais conferência direta de `rules.mjs`, `data/match-history.jsonl`, `data/lobby-boards.jsonl`, `data/scouting-captures.jsonl`, `data/plan-changes.jsonl`.
Este documento é só plano: nenhum código foi alterado, nenhum `POST /api/recommend` foi feito, o servidor da 3218 não foi tocado, nenhuma captura de tela foi feita.

## Sumário

1. [Resumo executivo](#1-resumo-executivo) (o que falta, as 10 maiores oportunidades, a situação dos dados do usuário)
2. [Catálogo consolidado de regras](#2-catálogo-consolidado-de-regras) (VID, ECO, NIV, ROL, SCO, ITM, CAR, APR, POS, WSP, REV) e [resolução das divergências](#25-divergências-e-resolução-provisória)
3. [Matriz prática para sistema](#3-matriz-prática-para-sistema)
4. [Roadmap em fases](#4-roadmap-em-fases) (F0 a F12, dependências, critérios de aceite)
5. [Política da Riot](#5-política-da-riot-e-modos-de-risco) (classe por fase, quatro modos lado a lado)
6. [Plano de validação](#6-plano-de-validação)
7. [Decisões do usuário, riscos e lacunas](#7-decisões-do-usuário-riscos-e-lacunas-de-dados)

### Convenções

- **Nível de evidência** (coluna Ev. no catálogo):
  - **Medido**: regra do jogo, número reprodutível ou cálculo meu verificável. **Medido†** = regra do jogo declarada por fonte única, a validar com os dados do usuário.
  - **Consenso**: 3 ou mais fontes independentes concordam (guias ou jogadores).
  - **Opinião**: 1 ou 2 fontes, ou criador de conteúdo sem dado.
  - **Disputa**: as fontes divergem; vira linha na tabela 2.5.
- **Referências de fonte**: `01#6` = regra 6 do arquivo 01; `03:R4` = regra R4 do 03; `02§4.3` = seção 4.3 do 02.
- **Coluna Sis.** (estado no sistema): sim / parcial / não, segundo `00-sistema-atual.md`.
- **Origem do dado**: `[arq]` arquivo do jogo (`TFTEoGStats.json`, Sentry, `TFT.log`); `[LCU]`; `[tela]` leitura de tela/OCR; `[manual]`; `[est.]` estimado pelo helper; `[cat.]` catálogo/tabela estática; `[n/d]` não disponível hoje.
- **Esforço** (estimativa minha para quem já conhece o código): **P** até 1 dia, **M** 2 a 5 dias, **G** 1 a 3 semanas.
- **Risco Riot** (do arquivo 07): **E** estático/referência ou pós-partida; **Z** zona cinza; **A** alto. Detalhe na seção 5.
- **Restrições do usuário respeitadas por todo o plano**: não mudar a forma como a build/comp é montada (`engine.mjs` ranking e `tactics.build`) sem pedido; sem screenshots (verificação por teste e código); não reiniciar a 3218; sem `POST /api/recommend` ao vivo; este trabalho não altera código.

---

## 1. Resumo executivo

### 1.1 O que os melhores fazem e o sistema ainda não faz

O sistema hoje é um assistente de macro razoavelmente completo (economia por faixas de HP, matemática exata de loja, ranking de comps com evidência da MetaTFT, troca de plano com confiança, contest básico). Pelos arquivos 01 a 06, o que separa os jogadores de elite do que o sistema faz é principalmente **método de decisão**, não falta de estatística:

1. **Pensam em "quantas derrotas ainda aguento" (HP ÷ dano do estágio)** e deixam esse relógio decidir quando guardar ouro e quando gastar. O sistema usa faixas fixas de HP (`economy.mjs:pressureOf`) e não tem tabela de dano por estágio.
2. **Escolhem uma postura (top 4 ou 1º) em função de HP, força relativa e lobby**; o sistema tem uma só postura.
3. **Seguem um calendário por estágio-rodada × sequência × vida** (4-1: 7 ou 8? 3-2: rolar 10-20 se HP<60?). O sistema só conhece o nível, uma curva de 6 pontos (`economy.mjs:curve`) e a faixa de HP.
4. **Leem o ritmo do lobby ("tempo") e as eliminações** (quem morreu devolve cópias ao pool; lobby rápido pede estabilizar cedo). O sistema compara só a "força" do seu tabuleiro com a dos rivais.
5. **Fazem scouting em checkpoints fixos** (pós-PvE, pós-aprimoramento, carrossel, antes de rolar 30+ ouro, antes de subir de nível) e olham o oponente da próxima rodada. O sistema calcula ameaças e rivais, mas a interface v2 não mostra e não conhece o oponente da rodada.
6. **Avaliam disputa em número de cópias e pagam o custo do pivô com cuidado** ("≤5 cópias de um 4 custo = pivotar", "40 ouro sem achar = olhar os tabuleiros"; pivô planejado um estágio antes, 1-2 peças por vez). O sistema tem alerta de disputa e custo de troca de plano, mas sem esses limiares nem custo em ouro/itens.
7. **Montam ou guardam componentes com regra explícita** ("nomear item, portador e momento"; não terminar o estágio 3 com mais de 1 par sem montar; 3 itens no carry antes do 3º no tanque). O sistema aconselha montagem, não decide "montar vs guardar".
8. **Escolhem aprimoramento por tipo antes de poder** (item, econômico, combate, direção) conforme estágio, HP e lobby. O sistema ordena por colocação média encolhida.
9. **Mudam a ordem do carrossel por vida e usam o carrossel para varrer o lobby.** O sistema só diz o tipo de componente.
10. **Revisam partidas em blocos de 10-20 com métricas** (média, top 4, bottom 4, "morri com ouro"). O sistema grava histórico, mas não calcula nada sobre ele e nenhum código lê `lobby-boards.jsonl`.
11. **Set 18: Wisps** (decisão de compra a cada duas lojas, 200 opções) ainda não existem no sistema, e a loja com Wisp tem 4 slots de campeão.

### 1.2 As 10 maiores oportunidades

Pontuação = Impacto (1-5, julgamento meu sobre efeito na colocação) × Viabilidade dos dados (1-5). Não é medida; é só para ordenar.

| #   | Oportunidade                                                                  | Fase      | Impacto | Viab. | Pont. | Esforço | Risco Riot |
| --- | ----------------------------------------------------------------------------- | --------- | ------- | ----- | ----- | ------- | ---------- |
| 1   | Relógio de vida (derrotas restantes) e postura top 4 vs 1º                    | F3        | 4       | 5     | 20    | P-M     | Z          |
| 2   | Calendário de nível e rolagem por estágio-rodada × sequência × vida           | F4        | 5       | 4     | 20    | M-G     | A          |
| 3   | Revisão pós-partida com métricas + registro por rodada (telemetria)           | F0/F1     | 4       | 5     | 20    | M       | E          |
| 4   | Dados de referência corretos, meta por patch e calibração com dados reais     | F0/F2     | 4       | 5     | 20    | P-M     | E          |
| 5   | Itens: montar vs guardar e divisão de itens                                   | F10       | 4       | 4     | 16    | M       | Z          |
| 6   | Pool/disputa com limiares, eliminações e pivô com custo                       | F7        | 4       | 3     | 12    | M       | A          |
| 7   | Aprimoramentos: tipo antes de poder, por estágio, HP e lobby                  | F11       | 3       | 4     | 12    | M       | Z-A        |
| 8   | Ritmo do lobby e eliminações liberando cópias                                 | F5        | 3       | 3     | 9     | M       | A          |
| 9   | Wisps (dados, regras e correção do nº de slots da loja)                       | F9        | 3       | 3     | 9     | M-G     | E-Z        |
| 10  | Scouting estruturado, oponente da rodada, posicionamento e carrossel por vida | F6/F8/F12 | 4       | 2     | 8     | G       | A          |

Ordem do roadmap ≠ ordem da pontuação: **medir antes de mudar** (F0 a F2 primeiro), porque o único jeito de saber se algo melhora a colocação é ter dados por rodada, e cada partida jogada sem registro por rodada é calibração perdida.

### 1.3 Situação dos dados do usuário (conferida hoje nos arquivos)

| Arquivo                        | Linhas                 | Realidade                                                                                                            | Consequência                                                                                                                                                        |
| ------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/match-history.jsonl`     | 40                     | **17 partidas únicas** (até 4 registros duplicados por partida); 16 com colocação, 1 sem (jogo 3291485607, 4 linhas) | Média 4,44, top 4 = 9/16 (56%), distribuição 1º..8º = 1/1/3/4/2/2/3/0. Indistinguível de 4,5 (erro-padrão ≈ 0,6). Os 32/36 registros citados antes inflam a amostra |
| `data/lobby-boards.jsonl`      | 153 (o `00` dizia 113) | 11 jogos, **55 tabuleiros finais únicos** (até 4 duplicatas cada), 1 lobby completo de 8                             | Pouco para calibrar; serve só como checagem cruzada                                                                                                                 |
| `data/scouting-captures.jsonl` | 8.553                  | **23 jogos com os 8 jogadores**, vida e peças ao longo do tempo (sem estágio)                                        | É o melhor conjunto para calibrar; 17 desses jogos têm a colocação do usuário                                                                                       |
| `data/plan-changes.jsonl`      | 93                     | 9 jogos, média de 10 trocas por jogo, `kept=true` em 2, `stage` nulo em 33; **0 reversões imediatas A→B→A**          | O plano oscila (muda de carry com frequência), não "vai e volta"                                                                                                    |
| `data/events.jsonl`            | 289                    | `board_snapshot` do arquivo do jogo com `reportedPlacement` e `queueId` (inclui PVE)                                 | Fonte de colocação de todos os jogadores                                                                                                                            |

Não existe nenhum registro **por rodada** com ouro, nível, XP, loja, itens no banco e ação recomendada. Sem ele, não dá para medir "morri com ouro", ouro por estágio, tempo de nível, acerto de rolagem, nem a renda de sequência. Isso é a primeira entrega do plano (F0).

---

## 2. Catálogo consolidado de regras

Unifica e remove duplicatas de 01 a 06. Cada linha traz o estado atual do sistema e a origem. Regras com número de guia (limiares de HP, ouro, estágio) são **heurísticas configuráveis**, não leis; a coluna Ev. diz o quanto confiar. Os limiares moram em tabela de configuração por patch (F0), não no código.

### 2.1 Vida e postura (VID)

| ID     | SE                                                                           | ENTÃO                                                                                                                                                                                                                       | PORQUE                                                                    | Ev.                                       | Sis.                                                                  | Fontes                |
| ------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- | --------------------- |
| VID-1  | quer saber quão perto está de morrer                                         | derrotas restantes = HP ÷ dano esperado da derrota. Dano = base do estágio (E2 2, E3 5, E4 8, E5 10, E6 12, E7+ 17) + unidades inimigas sobreviventes; típico por derrota: E3 9-12, E4 13-16, E5 16-19, E6 19-22, E7+ 25-27 | é o relógio comum de todas as decisões de ouro                            | Medido† (TFT Ninja, patch 18.1)           | parcial: faixas fixas em `economy.mjs:pressureOf`, sem tabela de dano | 02§4.3, 06§3.2A, 06#6 |
| VID-2  | aguenta 3 ou mais derrotas                                                   | pode economizar, nivelar, buscar juros                                                                                                                                                                                      | restam rodadas para recuperar                                             | Consenso                                  | parcial                                                               | 02§4.3, 06#6          |
| VID-3  | aguenta só 1-2 derrotas                                                      | estabilizar já (rolar, ou subir e rolar), mesmo gastando a economia                                                                                                                                                         | sobreviver vale mais que juros                                            | Consenso                                  | sim (`strategy.mjs:decide` passo 1)                                   | 02#23, 06#6           |
| VID-4  | 3-2 e HP < 60                                                                | rolar 10-20 de ouro para estabilizar                                                                                                                                                                                        | derrota no estágio 3 já custa 9-12                                        | Consenso                                  | parcial (`behind`)                                                    | 02#8, 06#3            |
| VID-5  | 4-1 com HP < 50 / 50-70 / ≥ 70 em sequência de vitórias                      | nível 7 e rolar 20-40 / nível 7 e rolar 10-20 / nível 7 e avaliar, senão poupar e ir ao 8. Entrar no 4-1 com 60-85                                                                                                          | HP é o recurso escasso a partir do estágio 4                              | Opinião (TFT Ninja)                       | parcial                                                               | 02#12-14, 06§3.4      |
| VID-6  | HP crítico (~20-30) e o tabuleiro não vence                                  | gastar quase tudo mantendo piso 10-20 de ouro; se a próxima derrota elimina, rolar até 0                                                                                                                                    | juros não valem se morrer; reconstruir de 20 é muito mais rápido que de 0 | Consenso (TFT Ninja, Dignitas, Boosteria) | parcial (piso 0 na faixa crítica)                                     | 06#5, 02#23           |
| VID-7  | HP < 20                                                                      | não contar com consumíveis de stats, Golden Goose, Major Gambit, Barter                                                                                                                                                     | o 18.4 os remove abaixo de 20 HP                                          | Medido (regra do jogo)                    | não                                                                   | 02§2.4, 05#8          |
| VID-8  | HP < ~30, tabuleiro mediano, linha disputada ou lobby rápido                 | postura top 4: upgrades 2★ imediatos, posicionar contra os mais fracos, deixar os fracos morrerem primeiro                                                                                                                  | só precisa vencer 3-4 jogadores                                           | Consenso                                  | não                                                                   | 06#21                 |
| VID-9  | tabuleiro mais forte do lobby, HP 30-40+, ouro ≥ 30, ou restam 3-4 jogadores | empurrar o 1º (nível 9 se HP > 60, 50+ ouro e 8 estável)                                                                                                                                                                    | 1º vale mais e a janela existe                                            | Consenso                                  | não                                                                   | 06#22, 06#10          |
| VID-10 | 3 ou mais rivais com < 20 HP                                                 | jogar por colocação, não por 1º                                                                                                                                                                                             | os mortos darão posição                                                   | Opinião (Noxu)                            | não                                                                   | 04§4.3                |
| VID-11 | decidir entre "reduzir bottom 2" e "perseguir mais 1º"                       | usar a estrutura de LP (4º ou melhor nunca perde; 5º ou pior nunca ganha; 8º apaga 2-3 top 4) como prior de risco; ganho de 1º vs risco depende de tabela de LP não oficial                                                 | EV de LP                                                                  | Disputa (DV17)                            | não                                                                   | 06§3.3                |
| VID-12 | partida de torneio "checkmate" e ≥ 20 pontos                                 | linha com condição clara de vitória; fora de check, "negar"                                                                                                                                                                 | só 1º fecha o título                                                      | Opinião                                   | não (e o usuário joga ranqueada)                                      | 01#13-15              |

### 2.2 Economia e juros (ECO)

| ID    | SE                                                   | ENTÃO                                                                                                                                                                                                      | PORQUE                                          | Ev.                                 | Sis.                                                                      | Fontes          |
| ----- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- | --------------- |
| ECO-1 | qualquer decisão de ouro                             | usar: reroll 2g (5 slots), XP 4g=4 (+2 passivo/rodada), juros 1/10g até +5 em 50, +1 por vitória PvP, streak 2-4 = +1, 5 = +2, 6+ = +3 (também após PvE), renda base 2/2/3/4 em 1-2/1-3/1-4/2-1 e 5 depois | regra do jogo                                   | Medido (streak: Disputa DV1)        | sim em `rules.mjs:GAME`; renda base plana em 5, streak PvE não confirmada | 02§2.1          |
| ECO-2 | estágio 1 (1-1 a 1-4)                                | não gastar; juntar 2-3 candidatas sem se comprometer                                                                                                                                                       | gasto cedo custa juros compostos                | Consenso                            | parcial                                                                   | 02#1, 06§3.6    |
| ECO-3 | ouro acima de 50, ou perto de patamar de juros       | gastar primeiro o excedente acima de 50; não cruzar patamar para baixo sem ganho real de combate; vender banco antes do fim do combate para fechar 29→30                                                   | cada 10 de ouro mantido vale +1 por rodada      | Consenso                            | parcial (piso/joelho; sem venda no fim do combate)                        | 02#2, 06#2      |
| ECO-4 | estágio 2                                            | escolher direção de sequência: vitórias (nível 4 em 2-1, slam, nível 5 em 2-5 se forte) ou derrotas controladas (nível 4 em 2-3 com 10+ ouro, só com plano). Misto é o pior caso econômico: econ 20 em 2-5 | sequência é o motor de ouro do estágio 2        | Consenso (loss streak: Disputa DV5) | parcial (`streak.mjs` só infere)                                          | 02#3-5, 06§3.2E |
| ECO-5 | cedo vs tarde                                        | sacrificar HP por ouro cedo; gastar ouro por HP tarde                                                                                                                                                      | HP custa mais caro a cada estágio               | Consenso                            | parcial                                                                   | 02§4.1          |
| ECO-6 | juros vs nivelar barato/"strongest board"            | ver DV6                                                                                                                                                                                                    |                                                 | Disputa                             | parcial                                                                   | 06§7.1          |
| ECO-7 | rolagem terminaria com < 20 de ouro e HP não crítico | parar                                                                                                                                                                                                      | recuperar de 20 a 50 é bem mais rápido que de 0 | Consenso                            | sim (piso 20 no reroll rápido)                                            | 06#5            |
| ECO-8 | rolou ~20 de ouro sem upgrade nem alvo nomeado       | parar e reavaliar (anti "donk-roll")                                                                                                                                                                       | rolagem sem alvo queima juros                   | Opinião                             | não                                                                       | 06§3.1          |

### 2.3 Nível e calendário (NIV)

Âncoras de nível por estado de sequência (BunnyMuffins/TFTSense; coincidem com 02§3.1 e 05§7):

| Estado        | N4         | N5         | N6  | N7         | N8         | N9                 |
| ------------- | ---------- | ---------- | --- | ---------- | ---------- | ------------------ |
| Vitórias (8+) | 2-1        | 2-5        | 3-1 | 3-5 (≥30g) | 4-2        | 5-2 (às vezes 5-5) |
| Derrotas (6+) | 2-3 (≥10g) | 2-7        | 3-2 | 3-5 (≥40g) | **4-1**    | 5-2 (ou 5-5)       |
| Misto         | 2-1 ou 2-3 | 2-5 ou 3-1 | 3-2 | 3-5 ou 4-1 | 4-2 ou 4-5 | 5-2 ou 5-5         |

| ID     | SE                                                                                           | ENTÃO                                                                                                                                                                                 | PORQUE                                      | Ev.                              | Sis.                                      | Fontes              |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------- | ----------------------------------------- | ------------------- |
| NIV-1  | sem sinal contrário                                                                          | seguir a linha-base 4/5/6/7/8 em 2-1, 2-5, 3-2, 3-5 ou 4-1, 4-2; nível 9 em 5-2 a 5-5 só saudável e rico. Nível 8 em 4-2 é o mais frequente (29 de 55 comps vencedoras medidas, Noxu) | consenso dos guias de Set 18                | Consenso (+ medido parcial)      | parcial: `economy.mjs:curve` com 6 pontos | 02§3, 02#8-10, 05§7 |
| NIV-2  | sequência de vitórias / derrotas / mista                                                     | usar a tabela acima; vitórias sobem antes; derrotas rolam **uma rodada antes** (nível 8 em 4-1) para preservar vida                                                                   | derrota no estágio 4 custa ~1 vida por luta | Consenso                         | não                                       | 02#4, 02#15         |
| NIV-3  | 2+ rivais atrás dos mesmos 4 custos                                                          | rolar em 4-1, antes de eles baterem o nível 8                                                                                                                                         | quem rola primeiro leva as cópias           | Consenso                         | não                                       | 02#17, 03§5.3       |
| NIV-4  | Fast 8                                                                                       | entrar em 4-1 com ≥ 50 ouro e HP saudável; subir ao 8 e rolar 30-50 (mínimo 35); prioridade: 2★ do carry 4 custo, 2★ do tanque, completar traço, preencher                            | abaixo de 35 faltam rolls para acertar      | Consenso (números: Disputa DV7)  | parcial: `rollAt`                         | 02#16, 06#8         |
| NIV-5  | considerar nível 9                                                                           | exigir núcleo 2★ completo e ouro ≥ 30; HP > 75 em 4-1 e > 60 em 5-1/5-2; nunca com HP < 40; sem 2★ do carry, ficar no 8 e rolar                                                       | nível 9 sem tabuleiro sangra vida           | Consenso (limiares: Disputa DV7) | parcial (`finalLevelOf`)                  | 02#20, 06#9-10      |
| NIV-6  | perdendo e plano de 4 custos                                                                 | subir direto ao 8 e rolar ali, não all-in no 7; nunca rolar por 4 custo abaixo do nível 8 a menos que esteja prestes a morrer                                                         | all-in no 7 é o padrão perdedor mais citado | Consenso (title; MetaBot)        | não                                       | 01#8, 02#32         |
| NIV-7  | outro jogador mostra sinais da mesma comp de nível 9 (emblemas + 4-1 com HP alto + vitórias) | ficar no 7 (poupar HP) ou no 8 (3★ de 4 custo), não ir ao 9 atrás dele                                                                                                                | disputam as mesmas cópias                   | Opinião (title, Set 9.5)         | parcial (`contestAlert`)                  | 01#3                |
| NIV-8  | nível automático por hábito (nível 4 em 2-1, nível 5 em 2-5 fraco)                           | só subir sabendo que peça/traço o XP compra; nível 5 em 2-5 só se forte, senão econ 20                                                                                                | XP é ouro que não volta                     | Opinião                          | parcial                                   | 02#3, 02#5, 05§8    |
| NIV-9  | reroll de 1/2/3 custos                                                                       | nível de rolagem 4-5 / 6 / 7; hyper roll (gastar a ~0) só com carry de 1 custo, itens de apoio, pool livre e HP > 60; slow roll = segurar 50 e rolar o excedente, chegando a 50 antes | rolar abaixo de 50 é o pior dos dois planos | Consenso                         | sim (`rerollLevelOf`)                     | 02§3.3-3.4, 02#30   |
| NIV-10 | 3-1 e reroll de 1 custo com 5+ cópias e 50-60 ouro                                           | rolar até ~32; 7-8 cópias, aprofundar                                                                                                                                                 | última janela do nível 4 (55% de 1 custos)  | Consenso                         | não                                       | 02#7                |
| NIV-11 | 3-5 e 3+ rivais com aprimoramento econômico preservando HP                                   | evitar greed (esperam Fast 8/9); se o lobby gasta agressivo, não fazer Fast 9, rolar no 8                                                                                             | tempo do lobby                              | Opinião (Goboost)                | não                                       | 06§3.5              |
| NIV-12 | tem mais de 50 ouro e sequência pagando                                                      | pré-nivelar (nível 9) não custa juros                                                                                                                                                 | ouro acima de 50 não rende                  | Opinião (Huanmie, um jogo)       | parcial                                   | 01#6                |

### 2.4 Rolagem e pool (ROL)

| ID     | SE                                                                                   | ENTÃO                                                                                                                                                                   | PORQUE                                        | Ev.                                    | Sis.                                                          | Fontes               |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- | -------------------- |
| ROL-1  | calcular chance de uma peça                                                          | p_slot = odds(nível, custo) × cópias_restantes_da_peça ÷ cópias_restantes_do_custo; P(≥1 na loja) = 1-(1-p)^5; pool 30/25/18/10/9 por campeão (14/13/14/14/10 campeões) | regra do jogo                                 | Medido                                 | sim (`economy.mjs`, `rules.mjs:POOL`)                         | 02§5.1, 03§2.2       |
| ROL-2  | calibrar o motor de rolagem                                                          | tabela de referência (nível 8, 4 custo, tenho 2 cópias, sem rivais): 2★ com 20/30/40/50 ouro = 50/68/79/87%; rivais com 4 cópias: 30/44/55/64%; com 6: 17/26/34/41%     | cálculo exato do 02                           | Medido (cálculo)                       | validar `economy.closeCurve` contra isto                      | 02§5.2               |
| ROL-3  | quer 3★                                                                              | 3★ de 4 custo é presente, não plano (9 de 10 cópias); 3★ de 2-3 custo exige muitas cópias já em mão; 3★ de 1 custo é realista mesmo disputado                           | pool                                          | Medido (cálculo + 3 fontes)            | sim (`isContested`, `stars3`)                                 | 02§5.2, 03§2.4       |
| ROL-4  | restam ≤ 5 cópias de um 4 custo (≤ 3 de um 5 custo), ou já gastou 40+ ouro sem achar | scoutear antes de gastar mais; pivotar ou aceitar 1★. Com 6 cópias retidas pelos rivais o custo por cópia dobra                                                         | efeito composto no numerador e no denominador | Opinião (TFT Ninja) + Medido (cálculo) | parcial                                                       | 02#27-28, 03:R6-R8   |
| ROL-5  | vai rolar 30+ ouro                                                                   | varrer os 7 tabuleiros antes e recontar cópias; rival com 50+ ouro em nível alto fará rolldown                                                                          | disputa enfraquece o rolldown                 | Consenso                               | não (ouro dos rivais: n/d)                                    | 03:R1                |
| ROL-6  | slow roll sem acertos durante um estágio inteiro                                     | assumir disputa; subir de nível, pivotar ou cortar perdas                                                                                                               | pool seca                                     | Consenso                               | não                                                           | 02#29, 03§4.1        |
| ROL-7  | um rival é eliminado                                                                 | recontar a pool (tabuleiro e banco voltam na hora); favorece rolar no 4-7/5-1 se tinha ouro guardado                                                                    | cópias devolvidas multiplicam as odds         | Consenso (+ Huanmie)                   | parcial (`pool-tracker` ignora eliminado; não dispara alerta) | 02#25, 03:R14, 01#11 |
| ROL-8  | precisa subir de nível e não de uma peça específica agora                            | subir antes de rolar; se precisa de peça para vencer a luta ou HP cai, rolar                                                                                            | rolar no nível certo atinge a pool certa      | Opinião (MetaBot)                      | parcial                                                       | 02#31                |
| ROL-9  | rodada com Wisp                                                                      | a loja mostra 4 slots de campeão em vez de 5                                                                                                                            | menos chance por loja                         | Medido†/Disputa (DV10)                 | não                                                           | 02§2.3, 05§3.1       |
| ROL-10 | alvo flex (qualquer peça do time)                                                    | somar as probabilidades de todas as peças elegíveis do custo                                                                                                            | rolagem genérica no nível 8                   | Opinião                                | sim (`roll.mjs:simulate`)                                     | 02§5.3               |
| ROL-11 | rival com o seu carry é eliminado ou vende                                           | recalcular antes de pivotar                                                                                                                                             |                                               | Consenso                               | parcial                                                       | 03:R14               |

### 2.5 Divergências e resolução provisória

A coluna "Como o sistema mede" depende da telemetria por rodada (F0). Onde a medição não é viável com os dados de um único usuário, está escrito.

| ID   | Divergência                                                                                                                                                              | Valor a adotar agora                                                                                                                                                                                                                             | Por quê                                                                                                              | Como o sistema mede (com dados do usuário)                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DV1  | **Tabela de streak**: (a) 2-4=+1, 5=+2, 6+=+3; (b) 3-4/5/6+; (c) 2-3/4/5+                                                                                                | **(a)**, que já é `rules.mjs:GAME.streakGold` (`[6,3],[5,2],[2,1]`). Guardar como configuração por patch                                                                                                                                         | 4 fontes de 2026 (op.gg, TFT Ninja, TFTraits) e o patch 14.8 trouxe de volta o +1 por 2                              | Rodadas sem gasto detectável (sem compra no `TFT.log`, nível e loja inalterados): renda observada = ouro_seguinte − ouro − juros − 5 − vitória; regredir contra tamanho da sequência. Basta ~1 partida com sequência ≥ 5 para separar (b) de (a) |
| DV2  | **Odds do nível 7**: 16/30/43/10/1 (tftflow 18.2, Noxu, BunnyMuffins, tftcodex lendo o cliente 18.3.0, TFT Ninja) vs 19/30/40/10/1 (LoL Wiki/TFTSense, MetaBot, seemeta) | **16/30/43/10/1** provisório, `rules.mjs` hoje usa 19/30/40                                                                                                                                                                                      | 5 fontes, entre elas a que leu o arquivo do cliente 18.3.0; o repo seguiu a Wiki, marcada "não confirmada"           | Contar a nível 7 o custo de cada carta da loja lida (excluindo o slot do Wisp): a diferença é 3 pontos percentuais em 1c e 3c. Precisa ~300 lojas no nível 7 (~1.500 slots; erro de ~1 p.p.), algo como 15-25 partidas                           |
| DV3  | **XP 7→8 / 8→9 / 9→10**: 56/68/68 (Riot, 14/set) vs 60/64/64 em páginas antigas                                                                                          | **56/68/68** (já em `rules.mjs`)                                                                                                                                                                                                                 | a Riot reverteu 8→9 e 9→10 em 14/09                                                                                  | Conferir total "atual/total" lido da tela (já usado em `rules.mjs:levelFromXp`)                                                                                                                                                                  |
| DV4  | **Rolar cedo e fundo (k3soju: "não existe overroll") vs guardar (Dishsoap, Huanmie, title)**                                                                             | Árbitro único: **derrotas restantes (VID-1)**. Enquanto aguenta ≥ 3 derrotas, guardar até o ponto de decisão (4-1/4-2 com ~50 ouro); com 1-2, rolar tudo. É exatamente a "greed" de Dishsoap ("rola até terminar o nível 8 ou restarem 2 vidas") | as duas escolas concordam quando a regra é escrita em vidas, não em ouro                                             | Métrica: ouro gasto em rolagem com ≤ 2 derrotas restantes e "morri com ouro"                                                                                                                                                                     |
| DV5  | **Loss streak**: "ruim em geral" (Dishsoap, BunnyMuffins 18.3b) vs "rei da loss streak" (robinsongz) e Huanmie na final                                                  | **Não recomendar loss streak planejada.** Só tratar a que já existe: Coven e aprimoramento econômico a pagam; exigir HP ≥ ~80 e saída planejada                                                                                                  | depende de aprimoramento/traço; o guia do Set 18 diz "não é ótimo"                                                   | Com n de um usuário não há como arbitrar; registrar partidas com sequência de 4+ derrotas no estágio 2 e olhar só como descrição                                                                                                                 |
| DV6  | **Juros até 50 (guias clássicos) vs nivelar barato/"strongest board" (dpei, Goboost)**                                                                                   | Padrão: juros como piso no estágio 2-3 com HP ≥ 60 e tabuleiro que vence; **quebrar juros** se HP < 60 em 3-2 ou se o tabuleiro não derrota "2-3 unidades por rodada"                                                                            | cobre as duas escolas; o disparo é o relógio de vida                                                                 | Contagem de rodadas em que quebrou juros e HP/rodada seguinte; sem inferência de causa                                                                                                                                                           |
| DV7  | **Limiares de HP para Fast 9**: 40, 60, 75, 80, 90                                                                                                                       | **Bloquear < 40; exigir 2★ do carry entre 40 e 60; permitir ≥ 60 em 5-1/5-2 e ≥ 75 em 4-1/4-2**                                                                                                                                                  | a diferença 60/75 vem das duas páginas do mesmo site e é função do estágio (quanto mais cedo, mais rodadas de risco) | Registrar HP, ouro e 2★ ao entrar no nível 9 e a colocação; amostra descritiva                                                                                                                                                                   |
| DV8  | **Slam vs guardar componentes; emblema com Espátula**                                                                                                                    | Slam se HP cai ou há portador e item flexível; guardar só se nomear item, portador e momento; ≥ 2 pares sem montar em ≥ 3-1 → montar; HP < 70 no estágio 3 ou ≥ 5 componentes → montar. Emblema só com traço-alvo e portador que fica            | é o mínimo comum às fontes (tftitemguide, TFT School, Noxu)                                                          | Medir "componente parado por 3 estágios" e HP no estágio 3                                                                                                                                                                                       |
| DV9  | **Carrossel**: X-4 de cada estágio (TFT Ninja) vs outras datas                                                                                                           | **Usar a fase `Draft` lida no Sentry (observado)**, não o calendário                                                                                                                                                                             | já é dado do jogo                                                                                                    | Log das rodadas em que a fase `Draft` ocorre                                                                                                                                                                                                     |
| DV10 | **Wisps**: "toda segunda loja" (05) vs "rodadas alternadas" (02); 1 por rodada                                                                                           | Anotar "loja com Wisp tem 4 slots de campeão" **sem mudar os números** até medir; depois usar a frequência real                                                                                                                                  | cadência não confirmada                                                                                              | Registrar o conteúdo do slot 5 em cada loja lida; ≥ 100 lojas                                                                                                                                                                                    |
| DV11 | **Reroll de aprimoramento** existe? (Metabot sim, Noxu não)                                                                                                              | Tratar como **desconhecido**; ler da interface                                                                                                                                                                                                   | duas fontes opostas                                                                                                  | Observação manual e nota no registro                                                                                                                                                                                                             |
| DV12 | **Eclipse**: 10 s vs 8 s, repetindo a cada 3,5 s                                                                                                                         | **8 s** (18.4)                                                                                                                                                                                                                                   | notas do 18.4                                                                                                        | Texto do catálogo na atualização por patch                                                                                                                                                                                                       |
| DV13 | **Numeração das fileiras** do tabuleiro (4=frente vs 1=frente)                                                                                                           | Falar em "frente/fundo" na interface                                                                                                                                                                                                             | evitar erro de convenção                                                                                             | n/a                                                                                                                                                                                                                                              |
| DV14 | **Rankings de comps** entre MetaTFT, SeeMeta, TopMeta e Blitz                                                                                                            | Comparar **só dentro da mesma fonte e filtro** (hoje: MetaTFT Platina+, 3 dias)                                                                                                                                                                  | clusters e filtros diferentes                                                                                        | Registrar fonte e filtro no resultado                                                                                                                                                                                                            |
| DV15 | **Top 4 vs 1º** (LP: +35/+45 vs -35/-50; fontes de boosting divergem por 2×)                                                                                             | Postura padrão **equilibrada**: base de top 4, empurrar 1º só pelos critérios VID-9                                                                                                                                                              | EV de LP não se resolve sem tabela oficial; reduzir bottom 2 costuma valer ao menos tanto quanto +1º                 | Distribuição de colocações e LP esperado com tabela configurável rotulada "aproximada"                                                                                                                                                           |
| DV16 | **Custo de disputa/pivô**: TFTSense (simulação comercial): disputa custa ~0,2 colocação, pivô de pânico ~0,4                                                             | **Hipótese**, não adotar como número                                                                                                                                                                                                             | autor vende produto, metodologia não publicada                                                                       | Plan-changes e colocação por jogo (n pequeno)                                                                                                                                                                                                    |
| DV17 | **Rival (Kha'Zix/Rengar) com dois no tabuleiro sem Unrivaled**                                                                                                           | **Desconhecido**; contar Rival "solo" só com exatamente 1                                                                                                                                                                                        | texto do catálogo não é monotônico                                                                                   | Teste em jogo (não por screenshot)                                                                                                                                                                                                               |

### 2.5.1 Regras descartadas ou só informativas

Não implementar como regra: comprar cópia do rival para "negar" (opinião fraca); números de LP de sites de boosting; probabilidade de aprimoramento por raridade do Set 16 (não vale para o Set 18); "Riot Approved" de fornecedores; qualquer estatística de presença no tabuleiro final tratada como causa (viés de sobrevivência, ElbroC); regras de checkmate sem o usuário disputar torneio.

### 2.6 Scouting, disputa e pivô (SCO)

| ID     | SE                                                                 | ENTÃO                                                                                                                                                                                                                                                                                                | PORQUE                                             | Ev.                                           | Sis.                                                                       | Fontes                 |
| ------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| SCO-1  | 2 ou mais rivais na sua linha e você sem vantagem de ouro/HP/itens | mudar para linha sem dono no próximo ponto de decisão. 1 rival = comprometer; 2 = jogável se a sua base for melhor; 3+ (ou 3 tabuleiros com o mesmo 4 custo) = pivô                                                                                                                                  | "disputado por 3 é sentença de morte" (Dishsoap)   | Consenso (Dishsoap, title, Metabot, TFTSense) | parcial (`contest.mjs:contestAlert`: high ≥ 4 peças)                       | 01#1-4, 03:R4-R6       |
| SCO-2  | você é o único na linha                                            | adiar a rolagem e rolar só quando precisar                                                                                                                                                                                                                                                           | as peças não somem                                 | Opinião (Dishsoap)                            | não                                                                        | 01#2                   |
| SCO-3  | pivotar                                                            | planejar um estágio antes; janela estágios 3-4 junto de nível/rolagem; 1-2 peças por vez; vender singles e manter pares compatíveis; itens genéricos em holder temporário; estágio 5 raramente funciona                                                                                              | custo = ouro em unidades vendidas + queda de força | Consenso                                      | parcial (`SWITCH_COST`, `stage.mjs:transitions`)                           | 03:R11-R13, 03§6.2     |
| SCO-4  | frustração, ~10 HP e 10 ouro, ou uma rodada perdida                | não pivotar nem vender o tabuleiro; estabilizar com o que tem                                                                                                                                                                                                                                        | "panic pivot" custa mais                           | Consenso                                      | não                                                                        | 03:R13                 |
| SCO-5  | momentos de scouting                                               | varrer os 7 tabuleiros: após cada PvE e cada aprimoramento, durante o carrossel, antes de rolar 30+ ouro, antes de subir 6/7/8, antes de slam grande, após estabilizar; vizinhos de ranking primeiro; ≥ 1 vez por estágio                                                                            | é quando os rivais mudam de plano                  | Consenso (ElbroC, Metabot, Boosteria, Noxu)   | não (v2 não mostra rivais)                                                 | 03§3, 03:R1-R3         |
| SCO-6  | o que ler em cada rival                                            | unidades + banco + itens completos (holder de carry = comprometido) + aprimoramentos + estrelas + nível + HP; unidade/item que "define a comp" (Rengar, Guinsoo)                                                                                                                                     | prevê a comp final                                 | Opinião (ElbroC, Powder)                      | parcial: tabuleiro/itens/HP lidos; banco, ouro, nível, aprimoramentos: n/d | 03§3.1, 03§3.3, 03:R16 |
| SCO-7  | ritmo (tempo) do lobby                                             | rápido (≥ 2 eliminações antes do 5-1, vários < 50 HP antes do estágio 4, vários no nível 7 no estágio 3, 2★ completos cedo): estabilizar cedo e não fazer slow roll acima de 50; lento (maioria > 70 HP no estágio 4, vários com 50+ ouro, todos vivos no 5-1): priorizar juros e atrasar o rolldown | tempo é relativo aos outros 7                      | Opinião (TFT Ninja, ElbroC, Boosteria)        | parcial (`lobbyStrength`, `weak`)                                          | 06§3.2B, 03:R15        |
| SCO-8  | rival com HP baixo fazendo greed                                   | cronometrar o seu rolldown: ele pode morrer e devolver cópias                                                                                                                                                                                                                                        |                                                    | Opinião                                       | não                                                                        | 03§3.4                 |
| SCO-9  | lobby majoritariamente em reroll de 1-3 custos / vários em Fast 9  | considerar Fast 8/9 com 4-5 custos (tier menos disputada) / preferir reroll com linha livre                                                                                                                                                                                                          | disputa se concentra na tier que os outros compram | Opinião (inferência do pesquisador)           | não                                                                        | 03:R18                 |
| SCO-10 | duas linhas com perfil de dano/itens parecido, uma menos disputada | mover os itens para a menos disputada                                                                                                                                                                                                                                                                | pivô barato                                        | Opinião                                       | parcial (`tactics.itemMoves`)                                              | 03:R17                 |

### 2.7 Itens (ITM)

| ID     | SE                                                                            | ENTÃO                                                                                                                                                                                                 | PORQUE                                                 | Ev.                          | Sis.                                                       | Fontes         |
| ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------- | -------------- |
| ITM-1  | tem 2 componentes que formam item flexível e há portador                      | montar se o HP cai, ou estágio ≥ 3-1, ou há sequência a proteger; esperar só se nomear item, portador e momento                                                                                       | esperar sem plano custa HP (~15 HP em 3 rodadas, Noxu) | Consenso                     | parcial (`ownedItemAdvice`)                                | 04#1-5         |
| ITM-2  | fim do estágio 3                                                              | nunca terminar com mais de 1 par de componentes sem montar; HP < 70 no estágio 3 ou ≥ 5 componentes: montar já; sequência de vitórias com HP > 90 e BiS exato do carry a 1 componente: pode guardar 1 |                                                        | Consenso (limiares: Opinião) | não                                                        | 04#1-3         |
| ITM-3  | slam vs guardar quando o lobby é lento ou a sequência é de derrotas planejada | guardar BiS, sem deixar o HP cair abaixo do limite                                                                                                                                                    | dpei: montar só se vence a rodada                      | Disputa (DV8)                | não                                                        | 06§7.3         |
| ITM-4  | alocar itens                                                                  | 3 no carry principal antes do 3º no tanque; tanque principal 2-3 defensivos; resto no secundário; comp horizontal 2/2/1-2; portador temporário para ser vendido depois                                | "3 no carry é inegociável"                             | Consenso                     | parcial (`tactics.build`: ≤ 3 por campeão, carry primeiro) | 04#7-8, 04§2.3 |
| ITM-5  | unidade evoluiu ou vai ser vendida                                            | mover os itens ao portador definitivo na hora (item completo não sai sem removedor)                                                                                                                   | mover é grátis                                         | Consenso                     | parcial (`itemMoves`)                                      | 04#11          |
| ITM-6  | estágio 4-5                                                                   | reservar 1 componente para utilidade (shred ou anti-cura); não duplicar efeito (Kog'Maw já aplica Shred)                                                                                              | multiplica o dano existente                            | Opinião                      | parcial (penaliza duplicação)                              | 04#10, 04#12   |
| ITM-7  | tanque                                                                        | não empilhar um só balde (HP, resistências, durabilidade); casar com o traço do tanque e com o dano do lobby                                                                                          | vida efetiva é produto dos três                        | Opinião                      | parcial                                                    | 04#9, 04§2.4   |
| ITM-8  | Espátula/Frigideira                                                           | fazer emblema só com traço-alvo e portador que fica até o fim                                                                                                                                         | todas as fontes exigem alvo concreto                   | Disputa (DV8)                | sim (`engine.emblemEdge`)                                  | 04#6           |
| ITM-9  | estágio 2 e carry ainda incerto                                               | não colocar os 3 itens em um 1★; espalhar 1-2 itens em 2-3 unidades até saber o carry                                                                                                                 |                                                        | Opinião                      | não                                                        | 04§2.1         |
| ITM-10 | radiante oferecido                                                            | pegar o que melhora o item que o carry já usa (Rabadon, Adaptive Helm, Thief's Gloves: top 4 de 59-60%, diferença pequena)                                                                            |                                                        | Opinião + Medido             | não                                                        | 04§2.5         |

### 2.8 Carrossel (CAR)

| ID    | SE                  | ENTÃO                                                                                                                      | PORQUE                                     | Ev.                    | Sis.                                   | Fontes        |
| ----- | ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------- | -------------------------------------- | ------------- |
| CAR-1 | carrossel           | menor vida escolhe primeiro (em pares); abertura 1-1: todos entram juntos                                                  | regra                                      | Medido (regra do jogo) | não                                    | 04§2.6, 05#15 |
| CAR-2 | escolher            | item vale mais que campeão, salvo se o campeão fecha 2★/3★; sem plano: Espada, Rod ou Cinto (Set 18); Tear/Espada (Set 17) | flexibilidade                              | Consenso               | parcial (`carousel.mjs` só componente) | 04#14-15      |
| CAR-3 | HP baixo            | prioridade de pick é vantagem; ter 2 picks de reserva                                                                      | os outros escolhem antes se têm menos vida | Opinião                | não                                    | 04#16         |
| CAR-4 | durante o carrossel | aproveitar para varrer os tabuleiros (não dá para agir no seu)                                                             |                                            | Opinião (ElbroC)       | não                                    | 03:R3         |

### 2.9 Aprimoramentos (APR)

| ID    | SE                                                  | ENTÃO                                                                                                                                                                                                                                                                                                     | PORQUE                               | Ev.                                               | Sis.                                           | Fontes       |
| ----- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------- | ---------------------------------------------- | ------------ |
| APR-1 | oferta em 2-1, 3-2, 4-2 (3 cartas cada)             | escolher o **tipo** certo para o tabuleiro e só então o mais forte do tipo: item (tabuleiro forte, antes dos carries completos), econ (tabuleiro fraco/plano de derrotas), direção (sem plano; evitar se já há direção), traço/unidade (3-2, comp definida), combate (4-2, depois dos carries itemizados) | economia no 4-2 quase não paga       | Consenso (MadeByKeo, Noxu, BunnyMuffins, Metabot) | não: `augment-advice.mjs` ordena por média     | 04#17-21     |
| APR-2 | HP caindo / lobby forte                             | poder imediato (ouro/bolsa, combate); com HP ~80 aceitar o lento (Ascension)                                                                                                                                                                                                                              |                                      | Opinião (Dishsoap)                                | parcial (HP no desempate)                      | 01#9, 04§3.2 |
| APR-3 | duas opções encaixam                                | desempatar pela média da rodada, com amostra grande (> 300) e encolhimento; nota nunca sozinha; viés de seleção                                                                                                                                                                                           | Hard Commit 4,02 geral e 2,50 no 4-2 | Consenso (+ Medido)                               | sim (`augment-advice.mjs`, `SHRINK_GAMES=300`) | 04#23, 05§6  |
| APR-4 | Trait Ladder                                        | evitar sem domínio de contagem de traços                                                                                                                                                                                                                                                                  | Riot: 5,22 em Ouro- vs 4,24 GM+      | Medido (Riot)                                     | não                                            | 05#16        |
| APR-5 | oferta de aprimoramento "de queima lenta"           | só se o HP e a economia sobrevivem no estágio 2-3                                                                                                                                                                                                                                                         |                                      | Opinião                                           | não                                            | 04#26        |
| APR-6 | augment de reroll e muitos pares                    | pegar e usar logo                                                                                                                                                                                                                                                                                         | pico precoce                         | Opinião                                           | não                                            | 04#25        |
| APR-7 | aprimoramento de peça específica (Prismatic Ticket) | só se o plano já cobre                                                                                                                                                                                                                                                                                    | demora a chegar ao 8                 | Opinião                                           | não                                            | 01#17        |
| APR-8 | existe reroll de aprimoramento?                     | desconhecido; ler da interface                                                                                                                                                                                                                                                                            |                                      | Disputa (DV11)                                    | não                                            | 04#24        |

Observação: o Set 18 só tem 3 escolhas (2-1, 3-2, 4-2). A lacuna "aprimoramentos de 5-x" do `00` não procede.

### 2.10 Posicionamento (POS)

| ID    | SE                                                    | ENTÃO                                                                                                                                                                                                | PORQUE                              | Ev.                    | Sis.                                                         | Fontes        |
| ----- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------- | ------------------------------------------------------------ | ------------- |
| POS-1 | sem ameaça específica                                 | tanques na frente (o mais resistente no centro); carry sozinho em canto do fundo; carry secundário no canto oposto; carries não adjacentes; ≥ 2 hexes entre frágeis (3 = fora do AoE dos adjacentes) | menor custo de erro                 | Consenso               | parcial: `tactics.mjs:plan→place` sem carry em canto isolado | 04#30, 04§4.1 |
| POS-2 | próximo oponente com assassino itemizado              | agrupar no flanco, carry 1 hex fora do canto, isca no canto oposto (só nesta rodada)                                                                                                                 | assassino pousa no canto previsível | Consenso               | não                                                          | 04#27         |
| POS-3 | oponente com AoE grande centrada, engage com knock-up | espalhar (≥ 2 hexes entre as peças-chave; separar colunas)                                                                                                                                           | AoE pega adjacentes                 | Consenso               | não                                                          | 04#28         |
| POS-4 | gancho/puxão; sniper                                  | tanque barato do lado do puxador, carry na borda oposta; isca ou mover o carry                                                                                                                       |                                     | Opinião                | não                                                          | 04#29         |
| POS-5 | a cada fase de planejamento                           | olhar o oponente da próxima rodada (~5 s), achar a **única** ameaça que mata o carry, mover 1-2 unidades; reposicionar após rolar; mudar o hex do carry de vez em quando                             | o oponente também faz scouting      | Opinião (Noxu, ElbroC) | não                                                          | 04§4.3-4.4    |
| POS-6 | perdeu uma rodada "que não devia"                     | olhar o log de dano e rever o posicionamento; contra Ahri/Morgana, nunca juntar a backline                                                                                                           | efeito dominó no early              | Opinião (Dishsoap)     | não                                                          | 01#16         |

### 2.11 Wisps e traços do Set 18 (WSP)

| ID    | SE                                                                                                 | ENTÃO                                                                                                                                                                                                                                                   | PORQUE                                 | Ev.                                       | Sis.                                                        | Fontes               |
| ----- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- | -------------------- |
| WSP-1 | loja com Wisp (slot mais à direita, compra na fase de planejamento, 1 por rodada; 2 com Blossom 9) | decidir se o Wisp vale mais que (preço ÷ 2) rerolls; Wisps de economia baratos (1-5g) nos estágios 2-3 quase sempre valem                                                                                                                               | 6g ≈ 3 rerolls                         | Opinião (Noxu)                            | não                                                         | 05§3.1, 05#6         |
| WSP-2 | Wisp mantém o ouro acima do patamar de juros ou custa 0                                            | comprar; se derruba um patamar, só se muito forte                                                                                                                                                                                                       |                                        | Opinião (fonte comercial)                 | não                                                         | 05§3.1               |
| WSP-3 | rolldown comprometido, ou Wisp condicional que obriga a entortar o tabuleiro                       | não comprar; não rolar até zero se há Wisp forte na próxima loja                                                                                                                                                                                        | Wisp ocupa 1 de 5 slots                | Opinião                                   | não                                                         | 05#10, 06#24         |
| WSP-4 | estágio 5+ e HP baixo                                                                              | Wisp de Combate é bom (todo segundo Wisp é de Combate depois do 5)                                                                                                                                                                                      |                                        | Medido + Opinião                          | não                                                         | 05#7                 |
| WSP-5 | entre 4-1 e 5-7 com < 10 ouro                                                                      | verificar os 4 Wisps de custo 0 (Drizzle, Grove Armor, Returning Friend, Room for a Shroom)                                                                                                                                                             | 18.4                                   | Medido (Riot)                             | não                                                         | 05#9                 |
| WSP-6 | traços especiais                                                                                   | Rival ativo "solo" só com exatamente 1; Eclipse = 3 Solar + 3 Lunar (Lux conta como qualquer); Elder Dragon ocupa 2 vagas e dá +2 Riftbeast; Lux/Avatar conta a origem em dobro; Blackthorn sacrifica o aliado do hex; Coven ganha Essência por derrota | contagem simples "nº de campeões" erra | Medido (catálogo)                         | parcial (`traits.js`; validar Rival, Eclipse, Avatar, Apex) | 05§3.3-3.6, 05#11-12 |
| WSP-7 | traço com patamar médio fraco (Fae 2-4, Coven, Defender 4, Juggernaut 4, Elderwood 5)              | só ir se vai fechar o patamar alto                                                                                                                                                                                                                      | médias de 4,7 a 5,8 nesses patamares   | Opinião (correlação com viés de presença) | não                                                         | 05#13                |
| WSP-8 | escolher entre piso e teto de comp                                                                 | Fast 9 de 5 custos: vitórias 19-21% e top 4 ~49% (loteria); Aphelios/Lunar: top 4 58% e vitórias 6-9% (piso)                                                                                                                                            | liga ao VID-8/VID-9                    | Medido (MetaTFT Plat+, 3 dias)            | não                                                         | 05§5.1, 05#4-5       |

### 2.12 Revisão e método (REV)

| ID    | SE                              | ENTÃO                                                                                                                                                           | PORQUE                     | Ev.                     | Sis.    | Fontes         |
| ----- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------- | ------- | -------------- |
| REV-1 | revisão de sessão               | blocos de 10-20 jogos: média, top 4%, bottom 4%, vitórias, distribuição, "morri com ouro"; olhar bottom 4 (decisão ou azar?)                                    | amostra, não jogo          | Consenso (fraco, guias) | não     | 06§3.7, 06§3.9 |
| REV-2 | detectores de erro              | rolagem até 0 sem alvo; HP < 40 e nível 9; 60+ ouro em 4-2; componente parado por 3 estágios; 2+ rivais no seu carry sem pivô; plano mudado 2 vezes com HP < 60 | derivados das regras acima | Opinião                 | não     | 06§8           |
| REV-3 | 2-3 bottom 4 seguidos / cansado | parar a sessão                                                                                                                                                  | decisões pioram            | Consenso (fraco)        | não     | 06#23          |
| REV-4 | usar estatística de terceiros   | filtrar por elo, exigir amostra, lembrar viés de sobrevivência/variável omitida; julgar a decisão pelo processo                                                 |                            | Medido (ElbroC)         | parcial | 06§3.7         |
| REV-5 | estudo                          | rever VOD de quem joga 2 níveis acima, pausando antes de cada refresh                                                                                           |                            | Opinião                 | n/a     | 06§3.7         |

---

## 3. Matriz prática para sistema

Origem de dado, esforço e risco já na forma das convenções. "Estado" cita `arquivo:função` do `00`.

### 3.1 Vida, postura, nível e rolagem

| #   | Prática                                                                                                   | Estado atual                                                                                    | Lacuna                                                                                                                                                                                    | Dado necessário e origem                                                                                                                                                       | Esforço | Risco                                 |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------- |
| M1  | Derrotas restantes (VID-1/2/3)                                                                            | `economy.mjs:pressureOf` (faixas ≤20/30/45/50/60, `bleeding`), `streak.mjs`                     | Sem tabela de dano por estágio; sem "derrotas restantes"; não aparece na interface                                                                                                        | HP próprio `[arq]`; estágio `[arq]` Sentry; tabela de dano `[cat.]` por patch; unidades inimigas sobreviventes `[est.]` (nível médio dos rivais) refinado depois pelo ΔHP real | P-M     | Z                                     |
| M2  | Postura top 4 vs 1º (VID-8/9/10)                                                                          | Só `lobbyStrength.weak`                                                                         | Sem postura explícita; sem "restam 3-4 jogadores"                                                                                                                                         | HP e vivos dos rivais `[arq]`; ranque de força `[est.]`; ouro próprio `[tela]`                                                                                                 | M       | Z (HP) a A (se usa tabuleiros rivais) |
| M3  | Calendário de nível/rolagem por estágio-rodada × sequência × HP (NIV-1 a NIV-6, NIV-9/10)                 | `economy.mjs:curve/curveLevel`, `strategy.mjs:decide`, `target-level.mjs`, `economy.mjs:rollAt` | Sem tabela por (estágio-rodada, sequência, faixa de HP, tipo de comp); sem âncoras 3-1/3-2/3-5/4-1/4-2/5-1/5-2; sem "rolar uma rodada antes se disputado"; sem bloqueio de nível 9 por HP | Estágio-rodada `[arq]`; HP `[arq]`; ouro/nível `[tela]`; sequência `[est.]` (inferida pelo HP); tipo de comp `[cat.]` (`meta-comps` `levelling`); disputa `[est.]`             | M-G     | A                                     |
| M4  | Economia fina: renda base com rampa, venda no fim do combate para fechar patamar, streak em PvE (ECO-1/3) | `rules.mjs:GAME.baseIncome=5`, `economy.mjs:incomeOf`                                           | Renda plana; vitória +1 não prevista; sem aviso 29→30                                                                                                                                     | Estágio `[arq]`, ouro `[tela]`, banco `[manual]`                                                                                                                               | P       | Z                                     |
| M5  | Anti-"donk-roll" (ECO-8)                                                                                  | `roll.mjs:rollRule` exige alvo viável                                                           | Sem aviso de "gastou 20 sem alvo"                                                                                                                                                         | Ouro por rodada `[tela]`, alvo `[est.]`                                                                                                                                        | P       | Z                                     |

### 3.2 Lobby, scouting, pool e pivô

| #   | Prática                                               | Estado atual                                                                                                    | Lacuna                                                                                                                                 | Dado necessário e origem                                                                                                                                                  | Esforço     | Risco                                               |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| M6  | Ritmo (tempo) do lobby (SCO-7)                        | `economy.mjs:lobbyStrength`                                                                                     | Sem indicadores (nº < 50 HP, nível ≥ 7 no estágio 3, eliminações, 2★ completos); não aparece                                           | HP, peças e estrelas dos rivais `[arq]`; nível dos rivais `[est.]` (nº de unidades); ouro dos rivais `[n/d]`                                                              | M           | A                                                   |
| M7  | Eliminação devolve cópias e dispara recálculo (ROL-7) | `pool-tracker.mjs` ignora eliminado; `match.mjs:ffaStanding`                                                    | Sem evento nem aviso "recalcule agora"                                                                                                 | HP ≤ 0 `[arq]`                                                                                                                                                            | P           | A                                                   |
| M8  | Oponente da rodada (POS-5, SCO-5)                     | Não existe                                                                                                      | Pareamento não está no arquivo nem no log                                                                                              | Pareamento `[n/d]`; opções a investigar: leitura da tela (nome/indicador do próximo oponente) `[tela]`, ou seleção `[manual]` de 1 clique                                 | G (incerto) | A                                                   |
| M9  | Scouting estruturado em checkpoints (SCO-5/6)         | `tactics.mjs` (ameaças, counters), `lobbies.mjs`, `contest.mjs`; v2 não mostra `opponents`/`counters`/`matchup` | Sem ficha de rival, sem checkpoints, sem holders de item, sem comp provável por rival                                                  | Tabuleiro, itens, HP `[arq]`; comp provável `[est.]` (casar com `meta-comps`); aprimoramentos dos rivais `[n/d]` (`players[].augments` vazio); banco, ouro, nível `[n/d]` | M           | A                                                   |
| M10 | Limiares de pool e disputa (ROL-4, SCO-1)             | `engine.analyze` (`remainingUpper/Likely`), `contest.mjs:contestAlert`, `economy.closeCurve`                    | Sem "≤ 5 cópias (4 custo)", "≤ 3 (5 custo)", "40 ouro sem achar", ouro por cópia, mediana                                              | Tabuleiros `[arq]`; banco de rivais `[est.]` (nunca validado); gasto de ouro `[tela]` com telemetria                                                                      | M           | A (rivais) / E (só pool teórico com as suas cópias) |
| M11 | Pivô com custo (SCO-3/4)                              | `engine.mjs` (`switchNote`, `SWITCH_COST`), `plan-changes.jsonl`                                                | Sem custo em ouro/itens/rodadas, sem janela 3-4, sem "1-2 peças por vez", sem alerta de pivô de pânico; plano oscila (~10 trocas/jogo) | Ouro `[tela]`, cópias e itens `[arq]/[tela]`, plano atual `[est.]`                                                                                                        | M           | Z-A. Não altera o ranking de comps                  |
| M12 | Validação do banco estimado dos rivais                | `pool-tracker.mjs:hiddenHoldings` (`keep 0,5`, meia-vida 3 min, teto 18)                                        | Nunca validado contra verdade                                                                                                          | Estrelas dos rivais ao longo do tempo `[arq]` (captures)                                                                                                                  | M           | E (offline)                                         |

### 3.3 Carrossel, Wisps, itens, aprimoramentos, posicionamento

| #   | Prática                                               | Estado atual                                                                                 | Lacuna                                                                                                                                                    | Dado necessário e origem                                                                                                      | Esforço     | Risco                                                             |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| M13 | Carrossel por vida (CAR-1 a CAR-4)                    | `carousel.mjs:carouselPicks` (só componente); fase `Draft` lida (`game-log.mjs`) e não usada | Sem ordem de escolha, sem opções reais, aparece fora da fase                                                                                              | HP de todos `[arq]`; fase `[arq]`; opções do carrossel `[n/d]` (→ `[manual]` ou `[tela]` a investigar)                        | P-M         | Z-A                                                               |
| M14 | Wisps: catálogo e regras (WSP-1 a WSP-5)              | Não existe; `catalog.json` sem Wisps                                                         | Catálogo de ~200 Wisps (nome, categoria, preço, condição), leitura do Wisp ofertado, regras de compra                                                     | Catálogo `[cat.]` (CommunityDragon); Wisp ofertado `[tela]` (slot mais à direita) ou `[manual]`; ouro `[tela]`                | M-G         | E (catálogo) / Z (conselho)                                       |
| M15 | Loja com 4 slots de campeão em rodada de Wisp (ROL-9) | `economy.mjs:closeCurve` supõe 5 slots                                                       | Superestima 10-20% a chance por loja                                                                                                                      | Conteúdo da loja `[tela]`                                                                                                     | P           | E                                                                 |
| M16 | Montar vs guardar (ITM-1/2/3)                         | `tactics.mjs:ownedItemAdvice`, `stage.mjs`, `item-edge.mjs`                                  | Sem regra explícita por estágio/HP/sequência/nº de pares/componentes; sem "nomear item, portador, momento"; sem 5+ componentes                            | Banco de itens `[tela]` (172 de 507 ícones; resto "?"), HP, sequência, estágio                                                | M           | Z                                                                 |
| M17 | Divisão de itens (ITM-4/5/6/7/9)                      | `tactics.mjs:build` (≤ 3 por campeão), `itemMoves`                                           | Sem alocação carry/tanque/secundário explícita, sem portador temporário, sem componente de utilidade reservado, sem alerta de 3 itens num 1★ no estágio 2 | Itens `[arq]/[tela]`, papéis `[cat.]`                                                                                         | P-M         | Z                                                                 |
| M18 | Aprimoramentos por tipo e estágio (APR-1 a APR-8)     | `augment-advice.mjs`, `augment-stats.mjs`, `v2/js/augs.js`                                   | Sem tipo (item/econ/combate/direção/traço) nem regra por estágio/HP/lobby; ofertas lidas por OCR não verificadas neste set; Trait Ladder sem aviso        | Ofertas `[tela]` (não verificado); tipo `[cat.]` (mapa curado, 260 aprimoramentos); médias por rodada `[cat.]` (Noxu/MetaTFT) | M           | Z-A (estatística de aprimoramento sob restrição incerta, 07§3.2j) |
| M19 | Emblemas com portador que fica (ITM-8)                | `engine.emblemEdge`                                                                          | Já cobre portador; faltaria só o aviso de "sem traço-alvo, guarde"                                                                                        | Traços `[arq]`                                                                                                                | P           | Z                                                                 |
| M20 | Posicionamento padrão (POS-1)                         | `tactics.mjs:plan→place` (esboço fixo; `side` sempre `right`)                                | Carry em canto isolado, carries não adjacentes, ≥ 2 hexes, Espelhar                                                                                       | Nenhum extra `[cat.]`                                                                                                         | P           | E                                                                 |
| M21 | Posicionamento por ameaça (POS-2/3/4)                 | Não existe                                                                                   | "Modo" Corner/Y/Spread/Wall conforme assassino/AoE/gancho no oponente                                                                                     | Unidades do oponente `[arq]` (sem hex); oponente da rodada `[n/d]` (M8); papéis de assassino/AoE `[cat.]`                     | M           | A                                                                 |
| M22 | Leitura da posição própria e do inimigo               | `boardPieces` sem hexágono                                                                   | Impossível julgar posição real                                                                                                                            | Posição `[n/d]` (→ visão sobre a tela)                                                                                        | G (incerto) | Z                                                                 |

### 3.4 Dados, método e infraestrutura

| #   | Prática                                                                          | Estado atual                                                                                         | Lacuna                                                                                                                            | Dado necessário e origem                                                                                        | Esforço | Risco |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| M23 | Registro por rodada (telemetria)                                                 | `tft/data/events.jsonl` (board_snapshot), `plan-changes.jsonl`, `match-history.jsonl`                | Nenhum registro por rodada com ouro, nível, XP, loja, banco de itens, ação mostrada                                               | Servidor + leitor; gravação local `[arq]/[tela]`                                                                | M       | E     |
| M24 | Revisão pós-partida com métricas (REV-1/2)                                       | `match.mjs`, `v2/js/history.js`, `GET /api/history`                                                  | Sem média/top 4/bottom 4/vitórias/distribuição; sem "morri com ouro"; sem detectores                                              | Histórico + round-log                                                                                           | M       | E     |
| M25 | Higiene do histórico                                                             | `match.mjs:matchTracker` grava até 4 registros por partida                                           | 40 linhas = 17 partidas; 1 jogo sem colocação; `lobby-boards` 153 linhas = 55 tabuleiros                                          | Deduplicar por `gameId` com backup                                                                              | P       | E     |
| M26 | Calibração do motor com dados reais                                              | Nenhum código lê `lobby-boards.jsonl`; `scouting-captures.jsonl` alimenta só replay/`hiddenHoldings` | `mightOf`, `weak`, faixas de HP, `BENCH_POLICY`, `isContested`, `SWITCH_COST`, `STICKY_BONUS`, `itemEdge K` são escolhas do autor | 23 jogos completos `[arq]`, colocação `reportedPlacement`                                                       | M       | E     |
| M27 | Tabelas de referência por patch e correções                                      | `rules.mjs:GAME/ODDS/POOL` fixos; `meta-comps.json` com `patch: null`                                | Nível 7 (19/30/40 vs 16/30/43), renda sem rampa, tabela de streak sem verificação, sem versão por patch                           | `[cat.]` + patch `[cat.]` (MetaTFT `region_patch_adjustment`)                                                   | P       | E     |
| M28 | Atualização automática do meta por patch                                         | `meta-comps.mjs` (> 2 h), `meta-builds.mjs` (6 h), `meta-stats.mjs` (12 h)                           | Sem detector de patch, sem invalidar tabelas/`patchBias` no dia do patch (18.5 em 21/10), sem checar `latest_cluster_info`        | `latest_cluster_info`, `unit_items_processed.region_patch_adjustment`, CommunityDragon `Last-Modified` `[cat.]` | P-M     | E     |
| M29 | Mostrar o que já é calculado (confiança, troca de plano, `decision`, `counters`) | calculados e não mostrados (`00§2.15`)                                                               | Interface cala o que o motor sabe                                                                                                 | nenhum novo                                                                                                     | P       | E-Z   |
| M30 | Resiliência ao cliente Unreal (alvo 03/11/2026)                                  | `server.mjs:readLcu`, `game-log.mjs`, `capture.mjs`                                                  | Fontes locais podem mudar; hoje a falha é silenciosa                                                                              | Adaptadores por fonte + autodiagnóstico `[arq]`                                                                 | M       | E     |

Fora de escopo (decidido): simulação de combate; recomendação de loss streak; automação de cliques; leitura de memória.

---

## 4. Roadmap em fases

### 4.0 Visão geral e dependências

| Fase | Nome                                                                         | Depende de                                         | Esforço | Risco | Onda |
| ---- | ---------------------------------------------------------------------------- | -------------------------------------------------- | ------- | ----- | ---- |
| F0   | Fundação: telemetria, tabelas por patch, correções de dados, perfil de risco | nada                                               | M       | E     | 1    |
| F1   | Revisão pós-partida com métricas                                             | F0 (a versão inicial usa só o histórico existente) | M       | E     | 1    |
| F2   | Calibração do motor com os dados gravados                                    | F0 (higiene)                                       | M       | E     | 1    |
| F3   | Vida como relógio e postura                                                  | F0 (tabela de dano)                                | P-M     | Z     | 2    |
| F4   | Nível e rolagem por estágio-rodada e sequência                               | F0, F3                                             | M-G     | A     | 2    |
| F5   | Ritmo do lobby e oponente da rodada                                          | F0                                                 | M       | A     | 3    |
| F6   | Scouting estruturado (ficha de rival)                                        | F5                                                 | M       | A     | 3    |
| F7   | Pool descontado, disputa e pivô com custo                                    | F0, F2, F6                                         | M       | A     | 3    |
| F8   | Carrossel por vida                                                           | F0                                                 | P-M     | Z     | 4    |
| F9   | Wisps                                                                        | F0                                                 | M-G     | E-Z   | 4    |
| F10  | Itens: montar vs guardar e divisão                                           | F0, F3                                             | M       | Z     | 4    |
| F11  | Aprimoramentos por tipo e estágio                                            | F0, F3                                             | M       | Z-A   | 4    |
| F12  | Posicionamento                                                               | F5 (para os itens 12c/12d)                         | P a G   | E-A   | 5    |

Regras do roadmap:

- **Onda 1 mede e corrige; ondas 2 a 5 mudam.** Nada da onda 2 em diante é liberado ao vivo sem passar pelo modo "sombra" (cálculo gravado, não mostrado) por pelo menos algumas partidas, ver seção 6.
- Cada fase só passa com os critérios de aceite abaixo e **sem alterar a escolha de comp/build**. Se uma fase exigir mudar o ranking de comps ou `tactics.build`, ela fica bloqueada até o usuário pedir (decisão 3 da seção 7).
- Toda saída nova nasce com a classe de risco (E/Z/A) e respeita o perfil escolhido pelo usuário (F0.6).

### F0 - Fundação (telemetria, tabelas, dados, perfil de risco)

**Objetivo.** Ter dado por rodada e referência correta antes de qualquer regra nova.

**Entregas.**

1. **Registro por rodada** `tft/data/round-log.jsonl`: um registro por transição de rodada e por evento (compra, nível, nova loja), com `gameId`, estágio-rodada, fase, HP, ouro (e idade da leitura), nível (lido ou derivado), XP, sequência inferida, loja lida (5 nomes e o slot do Wisp), contagem de componentes e de itens prontos no banco, aprimoramentos marcados, e as regras que o motor **teria** mostrado (modo sombra). Restrição conhecida: o leitor de tela só roda com alguma tela chamando `/api/state`; sem a interface aberta, ouro/nível ficam nulos e isso deve ser gravado como `null`, não estimado.
2. **Tabelas por patch** (`tables/<patch>.json` ou equivalente): `GAME`, `ODDS`, `XP`, `streak`, `renda`, `dano por estágio`, cada uma com `fonte`, `confiança` e `verificado em`. `rules.mjs` passa a ler de lá.
3. **Correções**: odds do nível 7 → 16/30/43/10/1 como provisório (DV2); renda base com rampa 2/2/3/4/5; manter streak `[2,1],[5,2],[6,3]` (DV1) com verificação empírica; manter XP 56/68/68 (DV3).
4. **Detector de patch**: gravar `patch` em `meta-comps.json` (hoje `null`); checar `latest_cluster_info` a cada 1-2 h e `region_patch_adjustment` ao baixar `unit_items_processed`; ao mudar de patch, marcar as tabelas como "não verificadas no patch novo", invalidar caches e avisar (primeiro teste: 18.5 em 21/10). `patchBias` (12 campeões à mão) passa a ter data e fica desativado quando o patch muda.
5. **Higiene**: deduplicar `match-history.jsonl` por `gameId` (40 → 17) e `lobby-boards.jsonl` (153 → 55 tabuleiros); explicar o jogo 3291485607 sem colocação; sempre com backup (`.bak-AAAAMMDD…`, como já feito) e de forma idempotente. Corrigir o gravador para não duplicar.
6. **Perfil de risco**: toda saída da interface e da API recebe `classe: E|Z|A`; uma chave global (config do usuário) filtra por classe; padrão decidido pelo usuário (seção 5).
7. **Modo sombra**: infraestrutura para calcular uma regra nova, gravar no `round-log` e não mostrar.
8. **Autodiagnóstico de fontes** (cliente Unreal em 03/11): se `TFT.log`, Sentry, LCU ou `TFTEoGStats.json` mudam de formato, o sistema registra "fonte X mudou" em vez de operar em silêncio.

**Dependências.** Nenhuma.

**Critérios de aceite.**

- Em uma partida real, `round-log` tem uma linha para ≥ 95% das rodadas PvP com HP e estágio, e para ≥ 80% delas com ouro e nível quando a interface está aberta; campos ausentes são `null`.
- Testes de tabela: `ODDS[7]`, XP, streak, renda lidos da tabela do patch; mudar o patch muda o resultado em teste.
- Dedup idempotente: rodar duas vezes não muda nada; contagens esperadas 17 partidas e 55 tabuleiros.
- Teste de regressão: as recomendações de comp/build em fixtures existentes ficam idênticas.
- Detector de patch: com fixture de patch diferente, as tabelas passam a "não verificadas".

**Risco Riot.** E. A gravação local não muda a política; ela é de ouro/nível próprios e já lidos hoje.

**Não fazer.** Ler memória; guardar nome de usuário/máquina do Sentry; gravar dado de rival adicional ao que já é gravado.

### F1 - Revisão pós-partida com métricas

**Objetivo.** O ciclo de aprendizado dos melhores (revisar blocos de 10-20 jogos) dentro do sistema.

**Entregas.**

- Painel/rota "Sessão": média, top 4%, bottom 4%, vitórias, distribuição 1º..8º, intervalo de confiança e **LP esperado** a partir de tabela de LP configurável e rotulada como aproximada.
- Por partida (após F0): HP em 3-2, 4-1, 5-1; nível por estágio-rodada vs referência; ouro ao entrar em cada estágio; "morri com ouro" (ouro na última leitura); nº de trocas de plano; componente parado por 3 estágios; rolagens sem acerto.
- Detectores (REV-2): rolagem até 0 sem alvo, HP < 40 com nível 9, 60+ ouro em 4-2, componente parado, 2+ rivais no seu carry sem pivô, plano mudado 2 vezes com HP < 60.
- Primeira versão **já** com o histórico existente (média/top 4/distribuição), antes da telemetria acumular.

**Critérios de aceite.**

- Sobre os dados de hoje: 16 partidas com colocação, média 4,44, top 4 56%, distribuição 1/1/3/4/2/2/3/0 (teste golden, depois da dedup).
- Cada métrica mostra `n` e intervalo; com `n` < 30 aparece o aviso "dentro do ruído".
- Cada detector é uma função pura com teste de entrada/saída; um detector que depende de campo `null` devolve "desconhecido", não "ok".

**Risco Riot.** E (análise depois da partida; o texto da Riot aprova "training tools that allow players to view their own match histories").

**Não fazer.** Chamar de "erro" algo que depende de limiar de guia sem exibir a regra e a fonte.

### F2 - Calibração do motor com os dados gravados

**Objetivo.** Trocar escolhas do autor por valores ajustados nos 23 jogos completos (`scouting-captures`, `events`), tratando `lobby-boards` (55 tabuleiros únicos) só como checagem.

**Entregas (todas offline, sem tocar o servidor).**

- **Força**: correlação (Spearman) entre `mightOf` e a colocação final para cada jogador × instante nos 23 jogos; comparar variações de pesos (`[0,1,1.8,3.2]`, `0.6` por item) com **validação leave-one-game-out** (treino em 22, teste em 1) ou treino nos 15 primeiros e teste nos 8 últimos. Calibrar o limiar de `weak` (60%).
- **Banco estimado** (`BENCH_POLICY`): a verdade não existe, mas há proxy verificável: a probabilidade de um rival fechar 2★ de uma peça nos próximos N minutos, condicionada às cópias estimadas fora do campo (`keep`, meia-vida, teto). Medir ganho (lift) contra um estimador sem banco.
- **Dano por derrota** (apoio à F3): distribuição dos quedas de HP entre amostras consecutivas por jogador (todos os 8), em função da fração do jogo (proxy do estágio até o `round-log` existir).
- **Oscilação do plano**: quantas trocas por jogo (hoje ~10, `kept` em 2 de 93, estágio nulo em 33) e quantas ocorrem com `gain` menor que o ruído; calibrar `SWITCH_COST` e `STICKY_BONUS` para reduzir trocas sem esconder as que importam.
- Relatório com parâmetros atuais, valores ajustados, ganho e incerteza.

**Critérios de aceite.**

- Cada parâmetro alterado tem: valor antigo, valor novo, métrica de validação em dados retidos (não os de ajuste) e IC; um parâmetro sem melhora sobre o atual **não muda**.
- Declarar o limite: 23 jogos, 1 usuário, 1 patch (18.3/18.4). Resultado é "melhor ajuste observado", não verdade.
- Nada é publicado no motor sem passar pelo modo sombra (F0.7).

**Risco Riot.** E (cálculo offline).

**Não fazer.** Calibrar contra a colocação do usuário (17 jogos, ruído); chamar de "validado" o banco estimado sem o proxy acima.

### F3 - Vida como relógio e postura (top 4 vs 1º)

**Objetivo.** VID-1 a VID-10, DV4, DV15.

**Entregas.**

- `derrotasRestantes` = HP ÷ dano do estágio, dado como **intervalo** (dano mínimo e máximo pelo nº de unidades inimigas estimado) e rotulado "estimado".
- Novo nível de pressão baseado em derrotas restantes (≥ 3 / 2 / 1) ao lado das faixas atuais (`pressureOf`), usado para o piso de ouro e para "greed permitida".
- Postura calculada: `top4` / `equilibrada` / `empurrar1º`, com os critérios VID-8/9/10 (HP, força relativa, vivos, ouro, estágio) e a razão exibida. Padrão `equilibrada`.
- Aviso VID-7 (< 20 HP: consumíveis de stats saem) e a janela de oportunidade.
- Mostrar na interface (HUD/painel) "aguenta ~N derrotas" e a postura, com a fonte da regra.

**Dados.** HP `[arq]`, estágio `[arq]`, tabela de dano `[cat.]`, nº de unidades inimigas `[est.]`.

**Critérios de aceite.**

- Testes tabela: HP 60 no estágio 4 com 13-16 por derrota → 3,75 a 4,6 → "aguenta 3-4"; HP 40 no estágio 5 → 2,1 a 2,5 → "aguenta ~2"; HP 25 no estágio 6 → ~1.
- Quando o intervalo atravessa um limite (ex.: 2,9 a 3,4), a saída diz "2-3" e não escolhe um lado.
- A mudança de `pressureOf` não altera os testes existentes de `tests/strategy.test.mjs` sem justificar caso a caso.
- Backtest: nos 23 jogos, a tabela cobre ≥ 80% das quedas de HP observadas na janela [base, base+12] (limiar provisório; fixar após a medição da F2).
- Modo sombra por ≥ 5 partidas antes de liberar.

**Risco Riot.** Z (usa HP próprio; não dá ordem única). Se a postura usa tabuleiros dos rivais, essa parte vira A.

**Não fazer.** Tratar o intervalo como número exato; planejar loss streak (DV5).

### F4 - Nível e rolagem por estágio-rodada e sequência

**Objetivo.** NIV-1 a NIV-12, ECO-2 a ECO-8, DV4/6/7.

**Entregas.**

- Tabela `calendario[estado de sequência][estágio-rodada] → nível-alvo/ação` (tabela da seção 2.3), por patch e **configurável**, como camada acima de `economy.mjs:curve` (que passa a ser o caso "sem dado").
- Âncoras de decisão: 3-1 (hyper roll de 1 custo), 3-2 (nível 6; HP < 60 → rolar 10-20), 3-5 (nível 7 com ≥ 30/40 ouro), 4-1 (nível 7 vs 8 por HP e sequência; "rolar antes de rivais"), 4-2 (Fast 8), 4-5/5-1 (padrão), 5-2 (nível 9).
- Bloqueios: nível 9 com HP < 40; 40-60 só com 2★ do carry; ≥ 60 (5-1/5-2) e ≥ 75 (4-x) permitido.
- Derrotas restantes (F3) como árbitro: ≥ 3 → guardar até o ponto de decisão; ≤ 2 → rolar tudo.
- A saída é uma **explicação com opções e custo** ("subir agora custa 8g e derruba os juros de 5 para 4; rolar 30g dá 68% de 2★"), não uma ordem única, quando o perfil de risco for Z.
- Remover do código o valor `curve` fixo apenas depois do modo sombra mostrar equivalência ou melhoria.

**Dados.** Estágio-rodada `[arq]`, HP `[arq]`, ouro/nível/XP `[tela]`, sequência `[est.]`, tipo de comp `[cat.]`, disputa `[est.]`.

**Dependências.** F0 (tabelas, round-log), F3 (derrotas restantes).

**Critérios de aceite.**

- Testes de calendário: para cada linha da tabela 2.3 e cada faixa de HP, a saída esperada (≥ 30 casos), incluindo os exemplos de 02§10 (regras 7-25).
- Os testes existentes de `tests/strategy.test.mjs` (árvore de decisão de gasto) continuam passando ou têm caso novo explicando a mudança.
- Concordância medida em modo sombra: porcentagem de rodadas em que a regra nova diverge da atual e por quê (relatório); divergências por motivo têm que ser explicáveis por regra do catálogo.
- Nenhuma mudança em `engine.mjs` (ranking) nem em `tactics.build`.

**Risco Riot.** A (recomendação ao vivo baseada em estado atual). Mitigações disponíveis: mostrar como "destaque de decisão" com opções e custos (Z), ou exibir só no pós-partida (E).

**Não fazer.** Recomendar all-in no nível 7 para 4 custos; tabela fixa no código; tratar 60/75 de HP como verdade (são heurísticas).

### F5 - Ritmo do lobby e oponente da rodada

**Objetivo.** SCO-7, SCO-8, ROL-7, e a leitura do oponente da próxima rodada.

**Entregas.**

- **Índice de ritmo**: nº de rivais com HP < 50 e com HP > 70, nº de eliminações, nº de rivais com 2★ de custo ≥ 3 completos, estimativa de nível (nº de unidades) no estágio 3; produz `rapido | normal | lento` com os critérios e a fonte.
- **Evento de eliminação**: ao detectar HP ≤ 0, avisa "recalcule a pool" e dispara a reanálise (ROL-7).
- **Investigação do oponente da rodada** (coordenar com `tft-fontes-de-dados`): procurar o campo no `TFT.log`, no Sentry, no `TFTEoGStats.json` e na tela. Saídas aceitáveis: (i) fonte estruturada encontrada; (ii) leitura do indicador/nome na tela; (iii) seleção manual de 1 clique; (iv) "não disponível" documentado. Sem pareamento, o posicionamento por oponente (F12c) fica fora.

**Dados.** HP, peças e estrelas dos rivais `[arq]`; nível dos rivais `[est.]`; ouro dos rivais `[n/d]`; pareamento `[n/d]` (a investigar).

**Critérios de aceite.**

- Índice de ritmo: teste com 3 fixtures reais (rápido, normal, lento) retiradas dos 23 jogos, e relatório mostrando a relação do índice no fim do estágio 3 com a data da 1ª eliminação (descritivo).
- Eliminação: teste com a fixture da primeira morte de um jogo: o evento dispara 1 vez, idempotente.
- Investigação: relatório curto com o campo, a fonte e a taxa de acerto em ≥ 10 rodadas verificadas por log (nunca por captura de tela), ou a conclusão "n/d" com evidência.

**Risco Riot.** A (rivais, informação dinâmica; o texto lista "tracking opponents' champions/plays"). Exibição só no pós-partida é E.

**Não fazer.** Inventar o nível ou o ouro dos rivais como dado; rotular estimativa como observação.

### F6 - Scouting estruturado (ficha de rival)

**Objetivo.** SCO-5, SCO-6, SCO-10, CAR-4.

**Entregas.**

- **Ficha por rival** (mostrar o que já se calcula e hoje fica escondido: `opponents`, `counters`, `matchup`): HP, vivo, nível estimado (nº de unidades), peças e estrelas, itens por unidade (holders de carry completos = "comprometido"), comp provável (casada com `meta-comps` por similaridade), traço dominante, estágio de poder (2★ completos), ameaça (assassino, AoE, cura, crítico), e **o que é desconhecido** (banco, ouro, aprimoramentos).
- Cada campo com um rótulo `observado | inferido | desconhecido`.
- **Checkpoints**: o sistema marca "hora de olhar" após cada PvE, após aprimoramento, durante o carrossel (Draft) e antes de rolar ≥ 30 ouro / subir 6-7-8; a ficha aparece pronta (a interface atual obriga o usuário a lembrar).
- Ordenar por vizinhança de ranking e por "disputa com você".

**Dados.** `[arq]` para tabuleiro/itens/HP/estrelas; resto `[est.]` ou `[n/d]`.

**Critérios de aceite.**

- Teste de projeção: a ficha com campos `observado/inferido/desconhecido` não mistura estimativa com dado (teste que falha se `banco` ou `ouro` aparecer como `observado`).
- Casamento de comp provável: nos 23 jogos, qual fração dos tabuleiros finais foi atribuída a uma comp de `meta-comps` com colocação média compatível (descritivo, sem limiar).
- A ficha usa a mesma contagem de traços que o motor (`v2/js/traits.js`).

**Risco Riot.** A (a política lista scouting como não aprovado). Em pós-partida: E.

**Não fazer.** Exibir "banco do rival" como fato; ordenar o usuário a mudar de linha por causa de um único rival (SCO-1 manda considerar 2 ou mais).

### F7 - Pool descontado, disputa e pivô com custo

**Objetivo.** ROL-2 a ROL-7, SCO-1 a SCO-4, SCO-10, DV16.

**Entregas.**

- **Painel de pool do alvo**: cópias restantes (limite superior e provável) e o **ouro por cópia** e a **mediana de ouro para o 2★**; alerta em ≤ 5 cópias (4 custo) / ≤ 3 (5 custo) e em "40 ouro sem achar"; "3★ de 4 custo é presente".
- **Índice de disputa** por comp-alvo (nº de rivais com a peça-chave ou o carry): 1 = comprometer, 2 = jogável se a sua base for melhor, 3+ = pivô, com a regra exibida.
- **Pivô com custo**: custo estimado = ouro perdido em unidades a vender + itens transferíveis + queda de força + HP risco; janela estágios 3-4 (ROL-4/SCO-3); "1-2 peças por vez"; alerta anti-pânico (VID/SCO-4). Compara "ficar" vs "pivotar" usando o `closeCurve` já existente para as duas opções. **Não troca o plano nem reordena as comps**.
- Recalcular ao eliminar rival (F5) e antes de rolagem ≥ 30 ouro.

**Dependências.** F0 (round-log para "40 ouro sem achar"), F2 (calibração do banco estimado), F6.

**Critérios de aceite.**

- Golden tests contra o cálculo do 02§5.2: nível 8, 4 custo, 2 cópias, sem rivais → 50/68/79/87% de 2★ em 20/30/40/50 ouro (tolerância ±2 p.p.); rivais 4 cópias → 30/44/55/64; 6 → 17/26/34/41; contest TFT Ninja 63/38/13% do numerador.
- Testes de limiar (≤ 5 e ≤ 3).
- Custo de pivô: casos de teste com 1 par vs 4 pares vendidos; não pivotar com HP baixo e ouro de 10.
- Proxy do banco estimado (F2) só entra se o lift for positivo.

**Risco Riot.** A para qualquer número que desconta cópias dos rivais; E para o pool teórico com as suas próprias cópias (04 e 07 §3.4).

**Não fazer.** Descontar o banco do rival sem rotular como estimativa; "comprar para negar".

### F8 - Carrossel por vida

**Objetivo.** CAR-1 a CAR-4.

**Entregas.**

- Mostrar "você escolhe em N.º" (menor vida primeiro) usando as vidas de todos.
- Aparecer **somente na fase `Draft`** (já lida no Sentry) e sumir depois.
- Ordem sugerida de pick como lista, com 2 reservas: item de maior flexibilidade para o plano (Espada, Rod, Cinto no Set 18) sobre campeão, salvo 2★/3★ iminente (usa `unit-ledger`/banco).
- Se as opções reais do carrossel não vierem de nenhuma fonte (provável), campo de seleção manual rápido ou nada (decisão 6).

**Critérios de aceite.** Teste da ordem por vida com empates e eliminados; o painel não aparece fora do `Draft`; `tests/carousel.test.mjs` (6 casos) continua passando.

**Risco Riot.** Z (HP dos rivais é informação de lobby; escolha de item é estática).

**Não fazer.** Prometer saber o que o carrossel oferece sem fonte.

### F9 - Wisps (Set 18)

**Objetivo.** WSP-1 a WSP-8, ROL-9, DV10.

**Entregas.**

1. **Catálogo**: extrair do CommunityDragon os ~200 Wisps (nome, categoria entre as 7, preço, condição, versão Blossom) para `wisps.json`, com `patch` e data. Preço que a Riot só publica para os alterados: marcar `preço: desconhecido` e ler do tooltip.
2. **Telemetria da loja**: guardar o conteúdo do slot mais à direita em cada loja lida, para medir a cadência (DV10) e o nº de slots de campeão.
3. **Correção da loja**: `closeCurve` e `rollSim` aceitam 4 slots de campeão por loja quando a loja lida tem Wisp; sem medir a cadência, apenas anotação (não muda número).
4. **Regras** WSP-1 a WSP-5 como destaques: "Wisp barato de economia nos estágios 2-3"; "mantém patamar de juros"; "não comprar durante rolldown comprometido"; "HP baixo no estágio 5+: Wisp de Combate"; "< 10 ouro entre 4-1 e 5-7: veja os 4 de custo 0".
5. **Contagem especial de traços** (WSP-6): validar Rival, Eclipse, Avatar, Apex em `traits.js` contra o catálogo, com testes.

**Dados.** Catálogo `[cat.]`; Wisp ofertado `[tela]` (OCR do slot 5, não verificado) ou `[manual]`; ouro `[tela]`.

**Critérios de aceite.**

- `wisps.json` com ≥ 190 entradas e `categoria` em 7 valores; campos faltantes explícitos.
- O OCR da loja não falha quando o slot 5 é um Wisp (teste com leitor falso: devolve "wisp" ou `null`, nunca um campeão inventado).
- `closeCurve` com 4 slots reduz a chance por loja por fator ≈ 0,8 no p_slot (teste numérico).
- Cadência medida em ≥ 100 lojas antes de ligar a correção numérica.

**Risco Riot.** E para catálogo e regras de referência; Z para o conselho com ouro do usuário.

**Não fazer.** Remodelar o tabuleiro por causa de um Wisp; prometer preços que a Riot não publicou.

### F10 - Itens: montar vs guardar e divisão

**Objetivo.** ITM-1 a ITM-10, DV8.

**Entregas.**

- **Cartão "montar ou guardar"** por rodada, com a regra e as condições: item flexível disponível, portador, momento nomeado; ≥ 2 pares sem montar em ≥ 3-1; HP < 70 no estágio 3; ≥ 5 componentes; exceção de sequência de vitórias com HP > 90.
- **Divisão de itens**: carry principal 3 antes do 3º no tanque; tanque 2-3; secundário; alerta "3 itens num 1★ no estágio 2"; "mover os itens agora" ao evoluir/vender; "reserve 1 componente de utilidade até o 4-5"; portador temporário.
- **Limpeza de brittle code**: as listas de classe de item (`itemRole`, `kind`, regex TANK/AP/AD) hoje repetidas em `meta-builds.mjs`, `engine.mjs`, `stage.mjs`, `tactics.mjs` passam a uma fonte única derivada do catálogo.
- **Ícones**: completar os ícones dos itens de Set 18 (172 de 507) com `download-assets.mjs` para reduzir os "?" no banco (impacta a leitura de itens).

**Critérios de aceite.**

- Testes de decisão por cenário (≥ 20): estágio × HP × sequência × nº de pares, incluindo os casos de 04§2.7.
- A ordem da build recomendada (`tactics.build`) não muda (teste de regressão).
- Itens sem ícone caem de 335 para o valor medido depois do download; relatório do que sobrou.

**Risco Riot.** Z (decisão baseada em estado próprio, sem rivais).

**Não fazer.** Mudar a montagem da build; tratar a ordem "Shojin é o melhor" como fato (é opinião de guia).

### F11 - Aprimoramentos por tipo e estágio

**Objetivo.** APR-1 a APR-8.

**Entregas.**

- **Mapa curado de tipo** para os ~260 aprimoramentos do Set 18 (item, econ, XP/nível, combate, direção/traço, reroll, Wisp) em arquivo de dados com teste de cobertura; **sem classificar por palavra-chave** (frágil).
- Regra de escolha: tipo certo para o estado (tabuleiro forte/fraco/sem plano), estágio (2-1, 3-2, 4-2), HP, lobby; depois a média da rodada com encolhimento (já existente).
- Avisos: Trait Ladder (Riot: 5,22 vs 4,24), aprimoramento de queima lenta com HP baixo, peça específica (Prismatic Ticket) sem plano.
- Reroll de aprimoramento: marcar "desconhecido" (DV11).
- Verificar a leitura das ofertas por OCR numa partida real (hoje "não verificada neste set") e registrá-la no round-log.

**Critérios de aceite.**

- 100% dos aprimoramentos do Set 18 do catálogo têm tipo (ou "sem classificação" explícito), com teste de cobertura.
- Casos de teste de 04§5 (regras 17-26).
- A ordenação por média da rodada continua igual quando o tipo empata.

**Risco Riot.** Z-A. A estatística de aprimoramento vem de NoxuTFT/MetaTFT e a Riot restringe a distribuição de "win rates de Legends/aprimoramentos baseados em Legends"; há contradição com a nota da Overwolf. Opção de reduzir: manter tipo e descrição ao vivo e mostrar a colocação por aprimoramento só no pós-partida.

**Não fazer.** Prometer reroll; mostrar nota sem `n` e sem aviso de viés.

### F12 - Posicionamento

**Objetivo.** POS-1 a POS-6.

**Sub-fases.**

- **12a - Padrão (E, P).** Melhorar `tactics.mjs:place`: carry em canto isolado do fundo, secundário no canto oposto, carries não adjacentes, ≥ 2 hexes entre frágeis, tanque mais resistente no centro; usar "frente/fundo" (DV13); religar o botão Espelhar (a v2 removeu).
- **12b - Modo por ameaça (Z, M).** Sem o oponente: cartões "contra assassino: agrupe", "contra AoE: espalhe", "gancho", "sniper", com a justificativa, escolhidos pelo usuário.
- **12c - Por oponente (A, M).** Com o oponente da rodada (F5): classificar a ameaça pelas unidades dele (papéis do catálogo) e sugerir o modo; mover 1-2 peças, não tudo.
- **12d - Leitura da posição (G, incerto).** Só se houver fonte estruturada ou visão confiável sobre a tela; hoje `boardPieces` não traz hexágono. Sem isso, o sistema não julga a posição real.

**Critérios de aceite.**

- 12a: propriedades testadas (carry em canto; carries não adjacentes; frentes preenchidas por papel) com `tests/` novos (não há testes de `place` hoje).
- 12b/12c: cada recomendação cita a ameaça que a motiva; sem ameaça identificada, cai para o padrão.
- 12d: relatório de viabilidade, não promessa.

**Risco Riot.** 12a E; 12b Z; 12c A; 12d Z (leitura da própria posição).

**Não fazer.** Afirmar posição real do inimigo (não temos); assumir que a numeração de fileiras é universal.

### 4.1 O que NÃO fazer (resumo)

- Ler memória, injetar, hookear, automatizar cliques ou teclas (07).
- Mudar a forma como a comp/build é montada sem pedido do usuário.
- Simular combate; planejar loss streak; recomendar all-in no nível 7 por 4 custos.
- Usar limiares de guia como verdade: cada um é configurável, datado e com fonte.
- Calibrar com 17 partidas (ou com `lobby-boards` bruto, que tem duplicatas).
- Confundir presença no tabuleiro final com causa (viés de sobrevivência).
- Tocar `POST /api/recommend` ao vivo ou a porta 3218 para testar: usar testes, fixtures e `replay`.
- Capturar tela para verificar a interface (verificar por teste e leitura de código).
- Incluir Dupla e Hiper Rolagem sem regras próprias.

---

## 5. Política da Riot e modos de risco

Base: `07-ferramentas-e-regras-da-riot.md`. Não é aconselhamento jurídico. Quem decide o que é permitido e se há ação é a Riot; não achei nenhuma declaração dela aprovando overlays nem relato verificado de banimento por leitura de tela, de log ou por recomendação em TFT.

### 5.1 O que está escrito

- Documento de TFT do Developer Portal: "An app cannot make suggestions based on the player's current game state as that information is dynamic."; "Apps that dictate player decisions", "Scouting - tracking the champions opponents have on their boards" e "Apps that provide dynamic, real-time information" estão na lista de não aprovados; overlays na partida "may not track your opponent's champions/plays" nem "predict their next plays", incluindo "aggregate stats for both individual players and the lobby". Aprovado: "Game overlays that provide static data that is available prior to the game." e "Training tools that allow players to view their own match histories".
- Suporte (jogadores, 2025-02-10): proíbe "Drawing conclusions for you during gameplay" e quer ver o jogador "play the game first, then analyze and reflect later".
- Termos de Serviço 7.1(11): programas de terceiros não autorizados que "interact with the Riot Services in any way, for any purpose".
- Memória do jogo bloqueada por padrão desde 2026-10-06 (o helper não lê memória). Cliente Unreal do TFT alvo 2026-11-03.
- O documento do Developer Portal é política de produtos que pedem chave/registro. Para uma ferramenta local e pessoal, a aplicação direta é incerta, mas a mesma ideia está na página de jogadores e nos termos.
- Overlays comerciais fazem recomendação ao vivo; isso **não** prova permissão.

### 5.2 Classe de cada fase

| Fase | Entrega principal                  | Classe                                      | Motivo                                                               | Como baixar o risco                                                                                                   |
| ---- | ---------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| F0   | Telemetria, tabelas, higiene       | E                                           | Registro local de dado próprio; correção de referência               | n/a                                                                                                                   |
| F1   | Revisão pós-partida                | E                                           | "Analyze and reflect later"                                          | n/a                                                                                                                   |
| F2   | Calibração offline                 | E                                           | Cálculo fora da partida                                              | n/a                                                                                                                   |
| F3   | Derrotas restantes e postura       | Z                                           | Usa HP próprio; não ordena ação                                      | Postura sem tabuleiros rivais; só "aguenta N derrotas"                                                                |
| F4   | Calendário de nível/rolagem        | A                                           | Sugestão baseada em estado atual                                     | "Destaque de decisão" com opções e custos (Z); ou calendário de referência estático sem estado (E); ou só pós-partida |
| F5   | Ritmo do lobby, oponente da rodada | A                                           | Rivais, informação dinâmica                                          | Mostrar só no pós-partida                                                                                             |
| F6   | Ficha de rival                     | A                                           | "Scouting" listado como não aprovado                                 | Pós-partida                                                                                                           |
| F7   | Pool descontado, disputa, pivô     | A / E                                       | Descontar cópias dos rivais é A; pool teórico com as suas cópias é E | Mostrar só o pool teórico e o custo por cópia, sem rivais                                                             |
| F8   | Carrossel por vida                 | Z                                           | HP do lobby; item é estático                                         | Mostrar só a lista de itens flexíveis                                                                                 |
| F9   | Wisps                              | E (catálogo/regras) / Z (conselho com ouro) | Catálogo é conhecimento; conselho usa estado próprio                 | Só catálogo e tabela de preços                                                                                        |
| F10  | Itens                              | Z                                           | Estado próprio, sem rivais                                           | Mostrar regras e deixar a escolha                                                                                     |
| F11  | Aprimoramentos                     | Z-A                                         | Tipo é Z; estatística por aprimoramento tem restrição incerta        | Estatística só no pós-partida                                                                                         |
| F12a | Posicionamento padrão              | E                                           | Conhecimento estático                                                | n/a                                                                                                                   |
| F12b | Cartões por ameaça                 | Z                                           | Genérico, o usuário escolhe                                          | n/a                                                                                                                   |
| F12c | Por oponente                       | A                                           | Rival da rodada                                                      | Pós-partida                                                                                                           |

### 5.3 Modos de operação lado a lado (decisão do usuário)

Os modos são **perfis** da chave global criada na F0.6; o usuário pode mudar a qualquer momento e pode misturar por função.

| Modo                                                                               | O que fica ao vivo                                                                                                                                                                                    | O que fica só no pós-partida                                            | Risco Riot                                                                                       | Impacto na utilidade                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **1 - Completo** (como hoje + roadmap)                                             | Tudo: recomendações de nível, rolagem, itens, aprimoramentos, scouting, pool com rivais                                                                                                               | Revisão e calibração                                                    | Alto (contraria o texto "suggestions based on the player's current game state" e "scouting")     | Máxima (100 no índice abaixo)                |
| **2 - Destaque próprio, sem rivais**                                               | HP/derrotas restantes, calendário como destaque com opções e custos, itens, aprimoramentos por tipo, Wisps, posicionamento padrão; **sem** ficha de rival, ritmo, pool descontado, oponente da rodada | Scouting, ritmo, pool descontado, estatística de aprimoramento, revisão | Médio (zona cinza: usa estado próprio, não rastreia rivais)                                      | ≈ 67                                         |
| **3 - Referência ao vivo + análise depois** (proposta de menor risco para começar) | Só estático: odds e pool teórico, tabelas de economia e dano por estágio, receitas e itens flexíveis, catálogo de Wisps, descrição de aprimoramentos, posição padrão                                  | Tudo o que depende de estado ou de rivais                               | Baixo (dentro do que o texto chama estático/"available prior to the game", mais "analyze later") | ≈ 35 ao vivo + ciclo de aprendizado completo |
| **4 - Somente pós-partida**                                                        | Nada na tela durante a partida                                                                                                                                                                        | Tudo                                                                    | Mínimo                                                                                           | 0 ao vivo; o valor vem da revisão            |

Cálculo do índice (julgamento meu; os pesos podem ser trocados): pesos F3 12, F4 25, F5 8, F6 8, F7 15, F8 3, F9 6, F10 8, F11 5, F12 10 (soma 100); sim=100%, parcial=50%, não=0.

| Fase (peso)               | Modo 1  | Modo 2                                   | Modo 3                        | Modo 4 |
| ------------------------- | ------- | ---------------------------------------- | ----------------------------- | ------ |
| F3 vida/postura (12)      | sim     | sim                                      | não                           | não    |
| F4 nível/rolagem (25)     | sim     | sim (destaque)                           | parcial (calendário estático) | não    |
| F5 ritmo/oponente (8)     | sim     | não                                      | não                           | não    |
| F6 scouting (8)           | sim     | não                                      | não                           | não    |
| F7 pool/disputa/pivô (15) | sim     | parcial (pool teórico + custo por cópia) | parcial (pool teórico)        | não    |
| F8 carrossel (3)          | sim     | parcial                                  | não                           | não    |
| F9 Wisps (6)              | sim     | sim                                      | parcial (catálogo)            | não    |
| F10 itens (8)             | sim     | sim                                      | parcial (receitas/flexíveis)  | não    |
| F11 aprimoramentos (5)    | sim     | parcial (tipo, sem estatística)          | parcial (descrições)          | não    |
| F12 posicionamento (10)   | sim     | parcial (padrão e cartões)               | parcial (padrão)              | não    |
| **Índice**                | **100** | **67,5**                                 | **34,5**                      | **0**  |

Notas:

- Nos modos 3 e 4 as fases F0, F1 e F2 (medir, revisar, calibrar) continuam 100% disponíveis. Elas são onde o usuário aprende o que os melhores fazem. O índice acima mede só a ajuda durante a partida.
- Capturar os tabuleiros dos rivais durante a partida para calibrar a F2 e analisar depois é uma zona cinza própria: o arquivo é gravado pelo jogo, mas o texto da Riot fala em "track" durante a partida. Sem essa captura a calibração da F2 e a ficha da F6 perdem dados. Esta é uma decisão separada do modo.
- **Proposta de menor risco** (sem decidir pelo usuário): começar no modo 3, com F3 e F10 como "destaque" opcional (modo 2 parcial) ligado só por escolha explícita, e manter F5/F6/F7 com rivais **desligados ao vivo** e disponíveis no pós-partida. O próximo passo mais conservador é perguntar à Riot por escrito (07 §4 item 8).

---

## 6. Plano de validação

### 6.1 O que dá e o que não dá para provar

Com um único usuário, o efeito na colocação média **não é detectável no curto prazo**. Desvio-padrão de uma colocação ≈ 2,3. Para 80% de poder e 5% de significância:

| Efeito a detectar (média de colocação) | Partidas (uma amostra contra 4,5) | Partidas por braço (A/B) |
| -------------------------------------- | --------------------------------- | ------------------------ |
| 0,1                                    | ≈ 4.150                           | ≈ 8.300                  |
| 0,2                                    | ≈ 1.040                           | ≈ 2.080                  |
| 0,3                                    | ≈ 460                             | ≈ 920                    |
| 0,5                                    | ≈ 170                             | ≈ 330                    |
| Top 4 de 50% para 60% (10 p.p.)        | ≈ 200                             | ≈ 390                    |

O histórico de hoje tem 17 partidas únicas (16 com colocação, média 4,44, top 4 56%): é ruído. O ritmo observado foi de 17 partidas em ~1,5 dia de calendário; o ritmo sustentado é desconhecido.

Consequência para o plano: a prova direta de melhora na colocação só aparece depois de centenas de partidas. Antes disso, validamos em cinco camadas, da mais forte para a mais fraca.

### 6.2 Camadas

**Camada 1 - Testes automatizados (cada regra, sem depender de sorte).**

- Golden da matemática de rolagem contra o 02§5.2 e o 03§2.2 (50/68/79/87%, 30/44/55/64, 17/26/34/41; contest 63/38/13%).
- Tabelas por fase (F3: derrotas restantes; F4: calendário ≥ 30 casos; F10: montar vs guardar ≥ 20; F11: tipo ≥ 100% do catálogo).
- Regressão de não-interferência: fixtures de comp/build idênticos antes e depois (garante a restrição "não mudar a forma de montar").
- Testes de projeção: nenhum campo `[est.]`/`[n/d]` aparece como observado.
- Verificação de interface por testes (`model.test.mjs`, `panel.test.mjs`) e código, não por captura.
- Saída de cada fase: lista de testes que ela adiciona e o conjunto que já passa (`node --test`, 200 testes hoje).

**Camada 2 - Backtest nos dados gravados (offline, `replay`/scripts, sem 3218).**

| Pergunta                                                    | Dados                               | Método                                                    | Limite                                                                      |
| ----------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| A tabela de dano por estágio descreve as quedas de HP?      | 23 jogos × 8 jogadores, HP no tempo | distribuição de ΔHP por fração do jogo (proxy do estágio) | Sem estágio nas capturas; o proxy tem ± 1 rodada. Refazer com o `round-log` |
| O índice de ritmo do lobby se relaciona com as eliminações? | idem                                | descritivo por jogo                                       | n = 23                                                                      |
| `mightOf` prevê a colocação?                                | idem                                | Spearman por instante; validação leave-one-game-out       | muda pesos só se melhorar fora da amostra                                   |
| O banco estimado dos rivais prevê 2★?                       | idem                                | lift de P(2★ em N min) com e sem banco estimado           | Sem verdade do banco; só proxy                                              |
| O plano oscila demais?                                      | `plan-changes` (93 em 9 jogos)      | trocas por jogo, `kept`, trocas com ganho < ruído         | Não dá para reexecutar o plano (falta estado)                               |
| "Morri com ouro", ouro por estágio, tempo de nível          | só depois do `round-log`            | descritivo                                                | Não retroativo                                                              |

**Camada 3 - Métricas de processo (de cada partida, a partir do `round-log`).** São indicadores mais sensíveis que a colocação. Cada fase tem a sua; todas com direção esperada:

| Fase  | Métrica                                                                             | Direção esperada             |
| ----- | ----------------------------------------------------------------------------------- | ---------------------------- |
| F3    | Ouro ao morrer; ouro gasto em rolagem com ≤ 2 derrotas restantes                    | cai; sobe                    |
| F4    | Nível em cada âncora vs calendário; HP em 4-1; rolagens com 30-50 ouro no 4-2       | aproxima do calendário; sobe |
| F5/F6 | Tempo entre o evento (PvE, aprimoramento, carrossel) e a 1ª consulta à ficha        | cai                          |
| F7    | Ouro gasto sem acerto antes de scoutear; pivôs com custo > limiar                   | cai                          |
| F9    | Wisps de economia comprados nos estágios 2-3; ouro desperdiçado em Wisp condicional | sobe; cai                    |
| F10   | Componente parado por 3 estágios; HP no estágio 3                                   | cai; sobe                    |
| F11   | Escolhas de aprimoramento "do tipo certo" para o estado                             | sobe                         |
| F12   | n/a (sem leitura de posição)                                                        | n/a                          |

**Camada 4 - Experimentos nas próximas partidas.**

- **Modo sombra** (F0.7): a regra nova é calculada e gravada junto da ação real do usuário; depois medimos concordância e o que aconteceu. Não depende da interface nem toca a 3218 em teste automático.
- **Alternância por partida** (par/ímpar do `gameId`) para módulos de exibição, medindo **aderência** (o usuário seguiu?) e a métrica de processo da camada 3. Sem inferir colocação.
- **Janela de decisão pré-registrada**: antes de ligar uma fase ao vivo, escrever qual métrica de processo e qual valor a aceitam, e olhar depois de ≥ 20 partidas (ou 100 rodadas relevantes).

**Camada 5 - Colocação, como guarda e não como prova.**

- Acompanhar média, top 4 e bottom 4 com intervalo, em janelas de 20 partidas, e **parar o envio de uma fase** se o bottom 4 piorar de forma sustentada (por exemplo, três janelas seguidas abaixo do valor anterior). É um freio, não um teste de hipótese.
- Para qualquer afirmação "melhorou", só com ≥ 300-450 partidas e intervalo.

### 6.3 Medição das divergências de dados (DV)

| Divergência   | O que medir                                                  | Quando fica conclusivo                  |
| ------------- | ------------------------------------------------------------ | --------------------------------------- |
| DV1 streak    | renda observada vs tamanho da sequência em rodadas sem gasto | ~1-3 partidas com sequência ≥ 5         |
| DV2 nível 7   | custo das 4 cartas da loja (sem o slot do Wisp)              | ~300 lojas no nível 7 (~15-25 partidas) |
| DV10 Wisp     | conteúdo do slot 5 em cada loja                              | ~100 lojas                              |
| DV7 nível 9   | HP, ouro e 2★ na entrada do nível 9 e o resultado            | só descritivo                           |
| DV9 carrossel | rodadas em que a fase `Draft` ocorre                         | 1 partida                               |

### 6.4 Critério de aceite geral de cada fase

1. Testes da fase verdes; testes antigos verdes ou justificados.
2. Regressão de não-interferência (comp/build) verde.
3. Modo sombra com ≥ 5 partidas e relatório de divergência explicado.
4. Métrica de processo pré-registrada e olhada.
5. Classe de risco atribuída e respeitando o perfil escolhido pelo usuário.

---

## 7. Decisões do usuário, riscos e lacunas de dados

### 7.1 Decisões que dependem do usuário

1. **Modo de operação (seção 5.3):** 1, 2, 3 ou 4, e se algum recurso pode ficar ao vivo e outro só no pós-partida. Padrão sugerido para começar: modo 3.
2. **Captura dos tabuleiros dos rivais durante a partida:** continuar gravando (alimenta F2 e a ficha da F6) ou parar. Decisão separada do modo.
3. **Autorizar mexer na escolha de comp/build?** Padrão do plano: não. Algumas fases (F4, F7) são desenhadas para não tocar nisso.
4. **Registro por rodada (round-log):** pode gravar ouro, nível, XP, loja e itens do banco localmente? Por quanto tempo guardar?
5. **Objetivo de postura:** "equilibrada" (base de top 4) como padrão? Quer que o sistema também considere empurrar o 1º? Joga ranqueada só, ou também torneio com "checkmate" (precisa de chave manual)?
6. **Entradas manuais aceitáveis:** oponente da próxima rodada (1 clique), opções do carrossel, Wisp ofertado, reserva do banco. Quais?
7. **Limiares de HP e ouro:** aceitar os provisórios da seção 2.5 (nível 7 = 16/30/43/10/1, Fast 9 por HP) até a medição?
8. **Posicionamento:** investir em leitura da posição real por visão sobre a tela (G e incerto) ou ficar em padrão e cartões por ameaça?
9. **Higiene de dados:** autorizar a deduplicação de `match-history.jsonl` e `lobby-boards.jsonl` (com backup)?
10. **Cliente Unreal (03/11):** manter uma versão congelada do helper como reserva?
11. **Perguntar à Riot por escrito** (Developer Relations/suporte) com o caso exato antes de ligar as fases A?
12. **Ordem de entrega:** concordar com medir primeiro (F0 a F2) e só depois mudar (F3 em diante)?

### 7.2 Riscos

| Risco                                 | Efeito                                                     | Mitigação                                                                                       |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Política da Riot (fases A)            | Ação sobre a conta; texto ambíguo para ferramenta pessoal  | Perfis de risco; modos 2 a 4; pergunta por escrito                                              |
| Cliente Unreal em 03/11/2026          | LCU, log, `TFTEoGStats.json` e Sentry podem mudar ou sumir | Autodiagnóstico de fonte (F0.8); adaptadores; versão reserva                                    |
| Patch 18.5 em 21/10 e Set 19 em 01/12 | Odds, XP, comps e `patchBias` mudam                        | Detector de patch e tabelas por patch (F0.4); revalidar regras específicas do set (WSP, traços) |
| Amostra do usuário minúscula          | Qualquer conclusão sobre colocação é ruído                 | Camadas 1-3; guarda na camada 5                                                                 |
| Estatística de terceiros enviesada    | Presença no tabuleiro final ≠ causa; Platina+              | Explorer com filtro (já em `evidence.mjs`); rotular                                             |
| Regras de guia com número arbitrário  | Falsa precisão                                             | Configuração, fonte e data; aviso na interface                                                  |
| Oscilação do plano                    | Instabilidade percebida (~10 trocas por jogo)              | F2 (calibração) e F7 (custo do pivô)                                                            |
| Duplicação no gravador                | Estatísticas inflacionadas                                 | Dedup + correção do gravador (F0.5)                                                             |

### 7.3 Lacunas de dado (e como obter)

| Dado                                      | Situação                                                              | Como obter                                                      |
| ----------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Oponente da rodada (pareamento)           | não está no arquivo nem no log                                        | Investigação F5 (log, Sentry, tela) ou 1 clique manual          |
| Posição das peças (própria e dos rivais)  | `boardPieces` sem hexágono                                            | Só visão sobre a tela (G, incerto)                              |
| Banco, ouro, loja e nível dos rivais      | não existem em arquivo                                                | Estimativa rotulada; o jogo mostra parte na tela, não lida hoje |
| Aprimoramentos dos rivais e os seus       | `players[].augments` vazio                                            | Marcação manual do usuário (já existe)                          |
| Opções do carrossel                       | sem fonte                                                             | Manual ou tela (a investigar)                                   |
| Reroll de aprimoramento                   | regra incerta (Metabot sim, Noxu não)                                 | Ler a interface e anotar                                        |
| Cadência do Wisp e catálogo de preços     | não confirmada; Riot só publica preços dos alterados                  | Telemetria da loja; tooltip do jogo                             |
| Rival com dois no tabuleiro sem Unrivaled | catálogo não monotônico                                               | Teste em jogo                                                   |
| Streak em PvE; renda base real            | consenso, sem verificação própria                                     | Rodadas sem gasto do `round-log`                                |
| Elo do usuário                            | não conhecido; as heurísticas vêm de Platina até Challenger           | Perguntar e usar como filtro de leitura das regras              |
| Pro-players do Set 18                     | sem entrevistas longas; Reddit/Mobalytics indisponíveis nas pesquisas | Aceitar que as regras do Set 18 vêm de guias e de dados         |
| Estágio nas capturas antigas              | `scouting-captures` e 33 de 93 `plan-changes` sem estágio             | Usar o `round-log` daqui para frente                            |
| Ícones de itens                           | 172 de 507                                                            | `download-assets.mjs` (F10)                                     |
| Dupla e Hiper Rolagem                     | sem regras                                                            | Fora de escopo                                                  |

### 7.4 Resumo em uma linha por fase

F0 mede e corrige; F1 revisa; F2 calibra; F3 vida e postura; F4 nível e rolagem por calendário; F5 lobby e oponente; F6 ficha de rival; F7 pool, disputa e pivô; F8 carrossel; F9 Wisps; F10 itens; F11 aprimoramentos; F12 posicionamento.
