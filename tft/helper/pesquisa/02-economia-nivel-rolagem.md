# 02 - Economia, tempo de nível e rolagem (Set 18 "Enchanted Wilds")

Data da pesquisa: 2026-10-10. Set 18 = **Enchanted Wilds**, lançado com o patch **18.1 em 2026-08-26** (Liquipedia, esports.gg). Patches posteriores: 18.2 (09-10), 18.3 (09-23), 18.4 (10-07, com B-patch no mesmo dia); 18.5 prevista para 10-21 [S1, S2]. Próximo torneio: Enchanted Wilds Tactician's Crown, 13-15/nov/2026 (ainda sem vencedor) [S3].

Legenda de tipo: **[FATO]** número/regra do jogo ou medido; **[CONSENSO]** várias fontes concordam; **[OPINIÃO]** heurística de guia/jogador; **[DISPUTA]** fontes discordam; **[CALC]** cálculo meu (script em Python, ver seção 6); **[ATEMPORAL]** princípio de sets anteriores.

Aviso de qualidade: a maior parte do material encontrado sobre Set 18 vem de sites de guias (BunnyMuffins, TFTSense, TFT Ninja, MetaBot, Noxu), não de falas diretas dos jogadores de elite. Achei apenas fragmentos de pro players (Dishsoap, Huanmie, ver seção 8). Não encontrei transcrições de Mortdog, k3soju, Frodan, Robinsongz etc. sobre economia do Set 18; não invento citações.

---

## 1. Resumo executivo

1. A base do jogo no Set 18 [FATO]: reroll custa 2 ouro (5 slots), XP custa 4 ouro por 4 XP (+2 XP passivo por rodada), juros 1 por 10 de ouro até +5 em 50, renda base 5 (rampa 2/2/3/4 em 1-2/1-3/1-4/2-1), +1 por vitória PvP, bônus de streak 2-4 = +1, 5 = +2, 6+ = +3.
2. XP atual (pós-B-patch 18.2, de 14/set) [FATO]: 3→4 6, 4→5 10, 5→6 20, 6→7 36, **7→8 56**, **8→9 68**, **9→10 68**. A Riot cortou 8→9 e 9→10 para 64 no 18.2, depois reverteu porque "Fast 9 ficou fácil demais"; manteve 7→8 mais barato (-4).
3. Linha-base de nível, consenso entre guias de Set 18 [CONSENSO]: 4 em 2-1, 5 em 2-5, 6 em 3-2, 7 em 3-5/4-1, **8 em 4-2** (timing mais comum: 29 de 60 comps vencedoras medidas no Noxu), 9 em 5-2 a 5-5 (só saudável e rico).
4. A postura muda com o **estado de streak/HP**: win streak sobe de nível antes e usa HP como recurso; loss streak rola **uma rodada antes** (8 em 4-1) para preservar vida; streak misto é o pior caso (pouco ouro e vida média) e pede comps baratas/verticais.
5. HP de referência (TFT Ninja, opinião de guia) [OPINIÃO]: 3-2 com HP < 60 = rolar 10-20 para estabilizar; 4-1 com HP < 50 = nível 7 e rolar 20-40; 50-70 = rolar leve (10-20); 70+ = considerar poupar; Fast 9 só com HP > 60 (outra página do mesmo site diz > 75 em 4-1); abaixo de 40 HP, Fast 9 é suicídio (Goboost, jun/2026).
6. Dano por derrota [FATO, TFT Ninja]: estágio 3 = base 5 (+unidades sobreviventes = 9-12 total), estágio 4 = base 8 (13-16), estágio 5 = 10 (16-19), estágio 6 = 12 (19-22), 7+ = 17 (25-27+). "Derrotas restantes" = HP atual / dano esperado do estágio.
7. Matemática de rolagem [FATO + CALC]: chance por slot de uma peça específica = odds_do_custo(nível) x cópias_restantes_da_peça / cópias_restantes_do_custo. Pool por campeão: 30/25/18/10/9 (custos 1-5), com 14/13/14/14/10 campeões diferentes = 420/325/252/140/90 cópias. Em nível 8, 2★ de 4 custos tendo 2 cópias e sem concorrência: ~79% com 40 ouro, ~87% com 50 [CALC]; com 4 cópias nas mãos dos rivais cai para 55% / 64%; com 6, 34% / 41%.
8. Concorrência muda o ponto de rolar: regra de guia = 5 ou menos cópias restantes de um 4 custos (3 ou menos de 5 custos) = pivotar; 40+ ouro gasto sem achar = contar o que está nos tabuleiros rivais antes de gastar mais [OPINIÃO, TFT Ninja pool-math]. Rolar **antes** dos concorrentes baterem nível 8 (4-1 em vez de 4-2) [CONSENSO].
9. "Três pontos de decisão por estágio": não encontrei uma regra com esse nome em nenhuma fonte. O que existe é o trio **subir de nível / rolar / poupar** como usos mutuamente exclusivos do mesmo ouro (MetaBot, tftsense; Bamboo Gaming só via resumo de busca) e âncoras de decisão em **3-2, 4-1/4-2 e 5-1**. Na seção 9 proponho uma formalização própria, marcada como síntese minha.
10. Jogadores de elite não ancoram em um número fixo: Huanmie (campeão do Space Gods Tactician's Crown, 07/2026) escolheu o plano de nível 9 pelo contexto (Space God Ahri + augment de nível) [S19]; Dishsoap (tweet de ~dez/2025, set anterior, só via resumo de busca) vincula o roll "greed" a HP restante (rolar até terminar o nível 8 ou restarem 2 vidas) [S20].

---

## 2. Regras de economia do Set 18

### 2.1 Renda

| Item                        | Valor                                                                                                       | Tipo                      | Fonte                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| Renda base                  | 1-2: 2, 1-3: 2, 1-4: 3, 2-1: 4, de 2-2 em diante: 5                                                         | FATO (3 fontes concordam) | op.gg [S4], TFT Ninja [S5], LoL Wiki [S6]                                    |
| Vitória PvP                 | +1 (derrota 0)                                                                                              | FATO                      | S4, S5, S6                                                                   |
| Juros                       | +1 por 10 de ouro no fim da rodada, máx. +5 em 50. 49 de ouro = +4. Juros calculados antes da renda passiva | FATO                      | S4, S5, S6                                                                   |
| Streak (vitória ou derrota) | 2-4 seguidas: +1; 5: +2; 6+: +3. Streak paga também após rodadas PvE neutras                                | CONSENSO                  | op.gg, TFT Ninja (atualizado 25/set/2026), tfthub (volta do +1 em 2 em 14.8) |
| Reroll                      | 2 ouro, 5 slots                                                                                             | FATO                      | MetaBot [S7]                                                                 |
| XP                          | 4 ouro = 4 XP; +2 XP passivo/rodada                                                                         | FATO                      | Noxu [S8], wiki [S9]                                                         |
| Máximo teórico por rodada   | 5 base + 5 juros + 3 streak (+1 se vitória)                                                                 | derivado                  |                                                                              |

**[DISPUTA] Tabela de streak.** Quatro versões circulam: (a) 2-4 = +1, 5 = +2, 6+ = +3 (op.gg, TFT Ninja, "tftraits" patch 16.15); (b) 3-4 = +1, 5 = +2, 6+ = +3 (LoL Wiki, que o próprio texto marca como possivelmente desatualizado; é a regra do patch 14.1); (c) 2-3 = +1, 4 = +2, 5+ = +3 (MetaBot, TFTEmblem Set 17); (d) 2-3, 4, 5+ idêntica a (c). O patch 14.8 "trouxe de volta" o +1 por 2 seguidas (tfthub, 2024-04-08), o que torna (a) a mais provável. **Não consegui confirmar na página oficial da Riot do 18.x; o assistente deve ler a tabela de streak de uma fonte estruturada ou configurável, não fixar no código.**

### 2.2 Tabela de XP (pós-B-patch 18.2, 14/set/2026) [FATO]

| Nível | XP para subir   | Ouro (comprando tudo) | Rodadas de XP passivo |
| ----- | --------------- | --------------------- | --------------------- |
| 3     | 2               | 4                     | 1                     |
| 4     | 6               | 8                     | 3                     |
| 5     | 10              | 12                    | 5                     |
| 6     | 20              | 20                    | 10                    |
| 7     | 36              | 36                    | 18                    |
| 8     | **56** (era 60) | ~56                   | ~28                   |
| 9     | **68**          | 68                    | 34                    |
| 10    | **68**          | 68                    | 34                    |

Atenção: o Noxu e o op.gg ainda listam 60 para o nível 8 (página sem data); tftflow (atualizado em 18.2) lista 56. Por Riot/tftsense/gamer.org: 7→8 = 56; 8→9 e 9→10 voltaram a 68 (14/set). Algumas páginas ainda trazem 64 para 8→9 e 9→10 (desatualizadas). Na tabela de Noxu a coluna "XP needed" parece ser o custo do degrau (não o cumulativo) mesmo que a página diga o contrário; o cumulativo até nível 8 é 2+6+10+20+36+56 = 130 XP.
Raciocínio da Riot no 18.2 (patch notes oficiais): "após as ofertas inflacionárias de Space Gods, os níveis tardios ficaram difíceis de alcançar", e depois: as mudanças reduziram 12 de ouro o custo de chegar ao nível 10, e os Wisps mais baratos poupam outros 5-15 [S10, S11, S12].

### 2.3 Odds de loja por nível (por slot) [FATO]

| Nível | 1c         | 2c  | 3c         | 4c  | 5c  |
| ----- | ---------- | --- | ---------- | --- | --- |
| 4     | 55         | 30  | 15         | 0   | 0   |
| 5     | 45         | 33  | 20         | 2   | 0   |
| 6     | 30         | 40  | 25         | 5   | 0   |
| 7     | 16 (ou 19) | 30  | 43 (ou 40) | 10  | 1   |
| 8     | 15         | 20  | 32         | 30  | 3   |
| 9     | 10         | 17  | 25         | 33  | 15  |
| 10    | 5          | 10  | 20         | 40  | 25  |
| 11    | 1          | 2   | 12         | 50  | 35  |

**[DISPUTA] Nível 7:** tftflow (patch 18.2), Noxu, BunnyMuffins, tftcodex (lido direto do cliente 18.3.0, arquivos de 2026-09-25) dão 16/30/43/10/1; tftsense (citando a LoL Wiki, 18.3) e MetaBot dão 19/30/40/10/1. A leitura do cliente 18.3.0 é a mais direta, mas não verifiquei o cliente. O assistente deve ler odds do jogo/patch atual, não fixar.
Pool: tamanho do saco **por campeão** 30/25/18/10/9; campeões por custo 14/13/14/14/10 (tftsense, tftcodex, tftflow) [FATO]. Obs.: a pesquisa do esportstales/TFT Ninja inicial dá a entender "por custo", mas as fontes de Set 18 mais detalhadas (tftcodex, tft.ninja/pool-math) usam por campeão.
Wisps: aparecem no slot mais à direita **de rodadas alternadas** (a loja nessas rodadas tem 4 campeões); Blossom (5) faz aparecer toda rodada [S13, S14]. Isso reduz em ~20% os slots de campeão nessas lojas (um dos erros que os cálculos de odds ignoram).

### 2.4 Mudanças recentes que afetam o ouro (18.1-18.4) [FATO, tftsense news log + patch notes]

- 18.1: PvE perdido de 4-7 em diante transborda para o próximo PvE; Carousel voltou; Luxury Subscription 7→3, Going Long 16→10, Money Hungry+ 10→13, Build-a-Bud 10→6; encontro Loot Subscription removido; Reroll Subscription (rerolls no início de cada estágio) novo; Max Build deu 10 rerolls grátis e 3 + Duplicador no nível 9.
- 18.2: XP 7→8 -4 (permanece); Wisps de economia mais baratos (Cutpurse 3→2 e chance 15→20%, Good Loss 5→4, Payday 4→3, Slow Study 4→2).
- 18.3: Wisps "must-buy" nerfados.
- 18.4 (07/out): abaixo de **20 HP o jogo deixa de oferecer consumíveis de stat, Golden Goose, Major Gambit e Barter**; quatro Wisps 0-ouro (Drizzle, Grove Armor, Returning Friend, Room for a Shroom) entre 4-1 e 5-7, apenas com < 10 de ouro; Veigar (reroll 1 custo) nerfado.

---

## 3. Tabelas de nível (consenso dos guias de Set 18)

Fonte principal: BunnyMuffins "Leveling & Econ Guide Set 18" (sem data na página, URLs de imagem 2025/08, rodapé 2026; patch aparentemente 18.x), TFTSense "Leveling Guide" (MadeByKeo, atualizado 2026-06-27, página cita Set 18 comps), Noxu (sem data), Goboost (2026-06-05, set não citado), tft.ninja (2026-09-25, patch 18.3). Note que o TFTSense foi atualizado em junho (antes do lançamento do Set 18, 08/26), então seus timings são genéricos; trate como aproximação.

### 3.1 Padrão (Fast 8 / Fast 9)

| Estado               | 4              | 5          | 6   | 7                  | 8                             | 9                                                      |
| -------------------- | -------------- | ---------- | --- | ------------------ | ----------------------------- | ------------------------------------------------------ |
| **Win streak (8+)**  | 2-1            | 2-5        | 3-1 | 3-5 (com 30+ ouro) | 4-2                           | 5-2 (às vezes 5-5; com augment de econ, 4-5)           |
| **Loss streak (6+)** | 2-3 (10+ ouro) | 2-7        | 3-2 | 3-5 (40+ ouro)     | **4-1** (rola 1 rodada antes) | 5-2 (TFTSense: 5-5); com augment de econ quebrado, 4-5 |
| **Misto**            | 2-1 ou 2-3     | 2-5 ou 3-1 | 3-2 | 3-5 ou 4-1         | 4-2 ou 4-5                    | 5-2 ou 5-5 (TFTSense: 5-5 ou 6-1)                      |

Fonte: BunnyMuffins [S15], TFTSense [S16]. **[CONSENSO]** nas três linhas; diferença pequena no nível 9 de loss streak.

- Win streak: BunnyMuffins: "não podemos tomar 20 de dano por luta no estágio 4" (regra de HP); TFTSense: rolar a maior parte do ouro no nível 8 em 4-2 mirando alguns 4 custos 1★, talvez um 5 custos, idealmente um 4 custos 2★; com um 4 custos 2★ o nível 9 em 5-2 é fácil, e rolar muito no 8 pode atrasar o 9 até 5-5.
- Loss streak: HP baixo (~50-60 de déficit segundo BunnyMuffins), "perdemos uma vida a cada derrota no estágio 4", logo rolar antes, preservar HP e fazer um roll-down maior no estágio 4 ("o estágio com as lutas mais decisivas") [TFTSense].
- Misto: "extremamente eficiente", sem renda de streak; cuidado com HP; objetivo top 4 e eliminar os loss-streakers [TFTSense, BunnyMuffins].

Dados medidos (Noxu, 60 comps vencedoras rastreadas, sem data): nível 8 em 4-2 = 29 comps; 6-1 = 9; 5-5 = 5; 5-2 = 5; 5-6 = 4; 5-3 = 3 (soma 55) [FATO, mas amostra não filtrada por elo; não vi o recorte por Challenger]. Noxu também diz que subir ao 8 antes de 4-1 costuma chegar sem ouro para rolar.

### 3.2 Fast 9

- Mobalytics (guia Fast 9 do Set 18, inacessível por 403; conhecido só pelo resumo do buscador): começar a mirar Fast 9 já no estágio 2 se houver augment prismático de economia/nível (Level Up, Upward Mobility, Hedge Fund); sem isso, esperar o opener; "não force Fast 9 de uma posição fraca; se estiver perdendo muito, role no nível 8". Nível 7 em 3-5 se rico ou protegendo win streak, senão 4-1; nível 8 por volta de 4-2 [S17, via resumo da busca, não li a página].
- TFTComps.gg (sem data): nível 9 em 4-2 se muito rico (30-50 ouro), 4-5, ou 5-1 depois de vencer o estágio 2-3; "evite chegar ao 9 com uma vida, porque exige rolar tudo em um turno; não recomendado para subir de elo".
- Goboost (2026-06-05): Fast 9 em ~5-2, só com início forte, quase toda a vida e "enorme excedente de ouro"; **abaixo de 40 HP não tente**; Fast 8 com ~40 de ouro sobrando para rolar.
- TFT Ninja (2026-09-25, patch 18.3): empurrar 9 só com HP > 60, núcleo 2★ completo e sem pressão de lobby; "não empurre abaixo de 40 HP nem com 2★ faltando". Outra página (4-cost econ and gameplan, mesmo patch): Fast 9 exige **> 75 HP em 4-1** e um tabuleiro de nível 8 com 2★ viável. [DISPUTA 60 vs 75, mesma casa]. Valor do 9: 5 custos sobem de 3% (nível 8) para 15% por slot.
- VoidS1n (guia de estágio 4, sem data, autor sem rank declarado): evite nível 9 com tabuleiro fraco e HP não acima de 75; "mais de 35 de ouro depois de subir para 8 ou 9 e HP baixo: suba e role".
- Riot 18.2/B-patch (gamer.org, 2026-09-17): Fast 9 estava "dominante demais" após XP e Wisps baratos; a Riot reverteu 8→9 e 9→10 mas manteve 7→8 barato; autor prevê Fast 8 de 4 custos (Ahri, Aphelios, Nidalee, Sivir) mais comum [previsão do autor, não da Riot].
- Caso de elite: Huanmie (Space Gods Tactician's Crown) escolheu nível 9 quando o Space God foi Ahri e pegou Caretaker's Ally (augment de nível); "meu roll-down no nível 9 no estágio 4 não foi muito bem-sucedido", mas guardou muito ouro para um roll depois de uma eliminação devolver cópias de 4 custos ao pool [S19]. (Evento do Set 17; princípio, não números.)

### 3.3 Reroll de 1, 2 e 3 custos (BunnyMuffins/TFTSense)

| Estilo                  | Níveis                                                                                                    | Rolar                                                                                                                        | Observações                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 custo (hyper)         | fica no 4; **não aperte o botão no estágio 2**                                                            | 3-1 com 50-60 de ouro, rolar até ~32 ("32g > 40g > 50g"); com 7-8 cópias, aprofundar; 3-5 rola agressivo                     | 3-1 é a última janela de nível 4 (55% de 1 custos); após o 5 as odds de 1 custos caem. Se 3★: sobe de nível e gasta o resto. 4-1: se não tem 3★, rolar até ~10 ou 0 e subir ao 6 |
| 1 custo (slow, nível 6) | 6                                                                                                         | segurar 50 e rolar só o excedente                                                                                            | MetaBot                                                                                                                                                                          |
| 2 custos                | 4 em 2-1 (se forte ou com cópia + item), 5 em 2-5 (se forte, senão faz econ 20), **6 em 3-2 e slow-roll** | 4-2: com HP baixo, rolar até 10 a cada turno até faltar uma cópia dos centrais e depois rolar a 0; com HP alto, rolar até 50 | Nível 7 até 4-5 se possível; 8 em 5-2 se possível; "pode ficar no 7 o resto do jogo"                                                                                             |
| 3 custos                | 4/5/6 como acima; **7 em 3-5 (com augment de econ) ou 4-1**                                               | Rolar no 7 até 2★; "nível 7 em 4-1 e acertar o carry 2★ para estabilizar"                                                    | Condições de forçar: artefato, cópia inicial, bom augment. Se não, empurre o 8 e jogue padrão                                                                                    |
| Híbrido 1+2 custos      | 5 é o timing principal, 6-7 em 4+, 8 em 5+                                                                | cavar 2★ de pares a partir de 3-1 e slow-roll para 3★                                                                        | Não suba ao 5 em 2-5 (caro). Só se conseguir ganhar 3 de 5 lutas do estágio 2                                                                                                    |

Melhor nível por custo [CONSENSO, 4 fontes]: 1c = 4-5, 2c = 6, 3c = 7, 4c = 8, 5c = 9-10. "Não role por um 4 custos abaixo do nível 8 a menos que esteja prestes a morrer" [MetaBot].

### 3.4 Slow roll, hyper roll, roll down (definições e quando)

- **Slow roll** [CONSENSO]: segurar o ouro num ponto de quebra (normalmente 50) e gastar só o excedente em rolls, mantendo os juros. Executar: chegar a 50 antes de começar ("rolar abaixo de 50 é o pior dos dois planos"), ~2-3 rolls por rodada, comprar todas as cópias do alvo, e se um estágio inteiro rende nada o pool provavelmente está disputado: subir nível, pivotar ou cortar perdas [MetaBot, publicado 2026-07-28, atualizado 10-05].
- **Hyper roll** [CONSENSO]: gastar tudo a ~0, tipicamente nível 4 (1 custos 3★). MetaBot: razoável acima de 60 HP com tabuleiro de verdade; por volta de 20 HP é "cara ou coroa que provavelmente perde"; exigir as quatro: carry de 1 custo, itens de apoio, pool sem concorrência, HP saudável. Se em dúvida, slow roll.
- **Roll down** (nível 8 em 4-2, 5-1 etc.) [OPINIÃO de guia, números divergem]:
  - TFT Ninja gameplan: mínimo 35 de ouro; alvo 30-50; abaixo disso segurar para 5-1 ou ir all-in; prioridade: 2★ do carry 4 custos, 2★ do tank principal, completar traço utilitário, preencher. Se contestado, rolar em 4-1 em vez de 4-2.
  - Goboost/TFTSense/TFT Ninja stage: "~40 de ouro sobrando depois de subir ao 8"; VoidS1n e TFTComps: > 35.
  - Estágio 4 (TFT Ninja stage-by-stage, 2026-10-06): saúde "fraca" (< 50 HP ou perdendo): nível 7 e rolar 20-40, estabilizar mesmo que custe quase toda a economia; "estável" (50-70, ~50% de vitórias): nível 7, rolar leve 10-20, depois reconstruir; "forte" (70+ e win streak): nível 7, ver se rolar ajuda, senão poupar e empurrar o 8. Fast 8 exige tabuleiro saudável e 50+ ouro ao entrar no estágio 4.
  - Dishsoap (tweet, 2025-12 pelo ID, sobre a meta do Bardo no Set 16/17): "greed" rola até terminar o nível 8 ou restarem 2 vidas; "se HP baixo, role em 3-5; se HP alto, pode rolar o nível 8 [mais tarde]" [S20, via resultado de busca; não consegui abrir o tweet (402)].

---

## 4. Quando abrir mão dos juros, quando ficar em 50, streak intencional

### 4.1 Fatos e regras de interesse

- Cada 10 de ouro acima de um limiar vale ~+1 por rodada enquanto mantido; gaste primeiro o excedente acima de 50 (não rende nada) [MetaBot econ guide 2026-07-25/10-05; TFT Ninja]. Atenção: os dois sites têm erros de aritmética na página (50→39 custa 2 de juros, não 1; 49 paga 4, não "nada"); a regra correta é a tabela de juros.
- Pontos-chave de economia que alcançam o próximo limiar (TFTSense): 14 (14→20→27→34→42→51 em 6 rodadas), 23, 32, 41.
- Vender uma unidade da bancada logo antes do fim do combate para cruzar 29→30 é hábito de Challenger (TFTEmblem Set 17, 2026-06-03) [FATO/atemporal].
- Desistir de juros é aceito quando o tabuleiro não aguenta: "no início, sacrifique HP por ouro; no fim, gaste ouro para preservar HP" (TFTSense fundamentals, 2026-09-27, patch 18.3). "Ouro vale mais cedo, vida vale mais tarde." [OPINIÃO/atemporal]
- Em estágio 1-2: guardar tudo; estágio 2: meta 30-50 ouro ao final dependendo da estratégia de streak (TFT Ninja); 10 ouro no carrossel 2-4; 20 ao entrar em 3-1 (TFT Ninja 4-cost econ).
- Âncoras de TFT Ninja: ~30 ouro e +10/rodada no estágio 3 chegando ao nível 6 em 3-2; **50 ao entrar em 4-1** para nível 7 e rolar; 50 + nível 8 no estágio 5 para postura de reroll de 4 custos.

### 4.2 Streaks intencionais

- Estágio 2 é onde se decide: win streak (subir nível, slammar itens) ou loss streak (vender, abrir-forte, board fraco) [CONSENSO, TFT Ninja, TFTEmblem, TFTSense]. Misto é o pior resultado econômico.
- Loss streak dá prioridade no carrossel, mas BunnyMuffins/guia 18.3b diz misturar streaks "na maioria das vezes" em vez de full loss streak; se for full, tentar fazer ao menos um turno de 6+ derrotas; Coven (traço de Set 18) não deve sozinho segurar o loss streak [S21, patch 18.3b].
- Win streak: scouting detalhado para confirmar que consegue 3+ vitórias seguidas antes de abrir com win streak [S21]; tomar augments de combate/itens e slammar [TFTSense fundamentals].
- Ao final de loss streak: ter perdido ~50-60 de HP já força rolar mais cedo (4-1).
- Custo/benefício: perder as cinco lutas do estágio 2 custa tanto HP quanto perder duas lutas do estágio 4 (Goboost/TFTComps; consistente com a tabela de dano) [OPINIÃO baseada em fato].

### 4.3 Orçamento de vida

Dano por derrota (TFT Ninja, patch 18.1, 2026-10-06): dano total = base do estágio + unidades inimigas sobreviventes (1 por unidade, independentemente de estrelas).

| Estágio                                                                                                                                                                                                         | Base | Total típico por derrota |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------ |
| 1                                                                                                                                                                                                               | 0    | 2-8 (estágios 1-2)       |
| 2                                                                                                                                                                                                               | 2    | 2-8                      |
| 3                                                                                                                                                                                                               | 5    | 9-12                     |
| 4                                                                                                                                                                                                               | 8    | 13-16                    |
| 5                                                                                                                                                                                                               | 10   | 16-19                    |
| 6                                                                                                                                                                                                               | 12   | 19-22                    |
| 7+                                                                                                                                                                                                              | 17   | 25-27+                   |
| Exemplo da fonte: ~4 derrotas restantes com 60 HP no estágio 4; só 1-2 com 40 HP no estágio 5. Regra da fonte: se aguenta várias, pode poupar e subir; se só uma ou duas, estabilize agora rolando ou gastando. |

---

## 5. Pool, contest e como corrigir pelo que os rivais seguram

### 5.1 Fórmulas [FATO, TFT Ninja pool-math (patch 18.3, 2026-09-25), tftcodex (cliente 18.3.0)]

- p_cost = odds do custo no seu nível (%) / 100.
- p_slot(peça) = p_cost x C_peça / C_custo, onde C_peça = cópias restantes da peça no saco (30/25/18/10/9 menos as suas, menos as que estão em tabuleiros/bancos rivais) e C_custo = cópias restantes do custo todo (tamanho do saco x nº de campeões, menos tudo que já saiu).
- Chance de ao menos 1 em uma loja de 5 slots: P = 1 - (1 - p_slot)^5. Ouro G = 2 por loja, então lojas = G/2.
- Cópias esperadas por 10 ouro (5 lojas = 25 slots), peça específica, pool sem concorrência: E = 25 x p_slot.
- Wisp: nas lojas alternadas, um dos 5 slots é Wisp, reduzindo E em ~10% em média (4 de 5 slots a cada duas lojas) (sinalizado pelo tftcodex, que tem opção de Wisp no cálculo).
- Cópias restantes = tamanho do saco - suas - visíveis em outros tabuleiros (TFT Ninja "champion-pool"). Banco rival e itens "Pandora's Bench" também retiram cópias; unidades vendidas voltam; **eliminação de um jogador devolve imediatamente todo o seu tabuleiro e banco** [TFT Ninja; confirmado pelo caso Huanmie].
- Importante: "chance de achar 1 cópia" não é "chance de 2★" (precisa de 3 cópias totais) nem de 3★ (9).

### 5.2 Valores de referência (meus cálculos, [CALC])

Modelo: DP exato sobre as 5 posições de cada loja, comprando toda cópia do alvo ao ver (paga o custo da cópia: 4 por 4 custos, 3, 2, 1 conforme custo), sem Wisps, sem outras compras, rivais não mexem no pool durante o roll, e as cópias de outros campeões do mesmo custo que os rivais seguram **não** são subtraídas do denominador (isso favorece levemente o rival: ignorado). Ouro = ouro total gasto (rerolls + cópias).

| Cenário                                 | Meta               | 20g | 30g | 40g | 50g | 60g | 80g |
| --------------------------------------- | ------------------ | --- | --- | --- | --- | --- | --- |
| N8 4c, tenho 2 cópias, rivais 0         | achar 1 cópia (2★) | 50% | 68% | 79% | 87% | –   | –   |
| N8 4c, tenho 2, rivais com 4            | 2★                 | 30% | 44% | 55% | 64% | 72% | 82% |
| N8 4c, tenho 2, rivais com 6            | 2★                 | 17% | 26% | 34% | 41% | 47% | 58% |
| N8 4c, tenho 2, rivais com 7 (sobra 1)  | 2★                 | –   | 14% | –   | 23% | 27% | 35% |
| N8 4c, tenho 1, rivais 0                | 2★ (2 cópias)      | 10% | 27% | 43% | 58% | 69% | 84% |
| N8 4c, tenho 1, rivais com 4            | 2★                 | 4%  | 10% | 19% | 28% | 37% | 54% |
| N8 4c, tenho 1, rivais com 6            | 2★                 | 1%  | 4%  | 7%  | 12% | 16% | 26% |
| N8 4c, tenho 0, rivais 0                | 2★ (3 cópias)      | 1%  | 6%  | 15% | 28% | 41% | 64% |
| N9 5c, tenho 1, rivais 0                | 2★ (2 cópias)      | –   | 13% | –   | 36% | 47% | 65% |
| N9 5c, tenho 2, rivais 0                | 2★ (1 cópia)       | –   | 51% | –   | 73% | 80% | 89% |
| N9 4c, tenho 2, rivais 0                | 2★ (1 cópia)       | –   | 72% | –   | 89% | 93% | –   |
| N7 3c, tenho 2, rivais 0                | 2★ (1 cópia)       | 67% | 84% | 92% | 96% | –   | –   |
| N7 4c (10% por slot), tenho 2, rivais 0 | 2★ (1 cópia)       | 21% | 31% | 41% | 49% | –   | –   |

(No N8 4c, tenho 2/rivais 0, com 10g já dá 23%.)

Mais: 3★ de 1 custo no nível 4 com 4 cópias suas e 4 rivais: 50g = 17%, 60g = 29%; no nível 5, 50g = 9% [CALC]; 3★ de 2 custos no nível 6 com 3 cópias: 70g = 14%, 100g = 44%; 3★ de 3 custos no 7 com 3 cópias: 80g = 12%, 100g = 28%. Ou seja, 3★ de 2/3 custos são caros e raramente viáveis sem muitas cópias já em mãos (consistente com TFT Ninja: 3★ de 3 custos "desafiador", 4 custos "extremamente raro", 5 custos requer o pool inteiro).

Cópias esperadas por 10 ouro (peça específica, sem concorrência; usa C_custo cheio) [CALC]:

- 1 custo no nível 4: 25 x 0,55 x 30/420 = **0,98**
- 2 custos no nível 6: 25 x 0,40 x 25/325 = **0,77**
- 3 custos no nível 7: 25 x 0,43 x 18/252 = **0,77** (0,72 com 40%)
- 4 custos no nível 8: 25 x 0,30 x 10/140 = **0,54**
- 4 custos no nível 9: **0,59**
- 5 custos no nível 9: 25 x 0,15 x 9/90 = **0,375**
  (Ordem de magnitude é a razão de "o nível certo para cada custo".) Validação cruzada: TFT Ninja dá 54% de achar ao menos 1 Ahri com 20g, 69% com 30g, 85% com 50g, com 7 cópias restantes de 14x10; meu modelo com 8 restantes dá 50%/68%/87% (inclui o gasto das cópias). O tftcodex dá "50g = 52% de acertar, ~57g em média" para uma configuração não especificada na página, não comparável.

### 5.3 Correção por concorrência (como os guias fazem)

- Recalcule o numerador e o denominador subtraindo cada cópia vista nos tabuleiros/bancos/lojas rivais; as odds caem mais rápido que a contagem de cópias (a TFT Ninja mostra: 3 cópias a menos = 63% das odds-base; 5 menos = 38%; 7 menos = 13%).
- Limiares de pivô [OPINIÃO de guia, TFT Ninja pool-math]: 4 custos com ≤ 5 cópias restantes (~5,5% por loja no nível 8, ~12 lojas para 50%); 5 custos com ≤ 3; gatilho de scouting: 40+ ouro gasto sem achar. "Duas ou mais pessoas no mesmo 4 custos = pool efetivamente vazio; pivote" (TFT Ninja gameplan, patch 18.3). Pivotar de um 4 custos disputado até 4-1 no máximo.
- Se há 2 jogadores disputando os mesmos 4 custos que você, role no nível 8 **antes** deles (4-1) [BunnyMuffins/VoidS1n/TFT Ninja; CONSENSO].
- MetaBot: se um estágio inteiro de slow roll rende nada, assuma concorrência e corte perdas.
- Slow roll e hyper roll são péssimos com pool contestado (MetaBot): "scout primeiro; se as peças foram tomadas, pivote em vez de rolar mais".
- Heurística de TFTSense reroll guide (2026-09-27): "segurar 12+ possíveis acertos torna o roll eficiente; ~6 unidades específicas normalmente erram" (heurística de variedade de alvos, sem prova numérica).
- Para um alvo "flex" (qualquer peça do time): some as probabilidades de todas as peças elegíveis do custo; é o que faz mais sentido em rolagens genéricas de nível 8.

---

## 6. Método de cálculo (para reprodução)

Cálculo feito com um DP exato (Python), estado = (ouro restante, cópias já compradas do alvo). Para cada loja: pagar 2; para cada um dos 5 slots, probabilidade de acerto p = (odds do custo) x (C_peça - k) / (C_custo - k), onde k = cópias já compradas; ao acertar, pagar o custo da peça e k += 1. Não modela: Wisps, compras de outras peças, rivais mexendo no pool durante o roll, cópias de campeões do mesmo custo seguradas pelos rivais (diminuem C_custo e elevam levemente p). Script em um diretório temporário da sessão (não versionado). As odds usadas: tabela 2.3 com nível 7 = 16/30/43/10/1 (cliente 18.3.0).

---

## 7. Tempo de nível: "Fast 8", "Fast 9", "Econ vs HP", "Stabilize"

- **Fast 8** [CONSENSO]: nível 8 em 4-1 a 4-2 e rolar na hora, com 50+ ouro ao entrar em 4-1 e tabuleiro saudável (TFT Ninja); Noxu: antes de 4-1, chega-se sem ouro; Goboost: ~40 sobrando. Standard 8 em 4-5/5-1 (TFT Ninja) é o plano de quem não pode ou não quer Fast 8. "Se desconcertado em 3-6 com 60 ouro, ou com 20 de HP em 4-1, a curva padrão deve ser sobrescrita" (Noxu).
- **Fast 9**: ver 3.2.
- **Econ vs HP** [OPINIÃO consistente]: acima de 50 HP e tabuleiro jogável, priorizar economia e atrasar o roll-down (TFT Ninja gameplan); 30-50 = faixa de compromisso, rolar no spike; < 30 = gastar tudo, rolando ou subindo e rolando; destino em 4-1: 60-85 HP. MetaBot (when-to-roll): "acima de 50 pode continuar subindo nível; abaixo de 30 procure razão forte para não rolar... não morra com ouro".
- **Quando abrir mão da vida por ouro**: estágio 1-2 (perda cara em ouro, barata em HP); estágio 4 em diante a vida é o recurso escasso (BunnyMuffins win streak "não podemos tomar 20 por luta no estágio 4"; guia 18.3b: com 80+ HP no estágio 4 pode-se pegar augment de econ em 4-2 e "sacrificar o estágio").
- **Stabilize** (TFTSense fundamentals): em loss streak, guardar ouro e rolar em 3-2 e 4-1; 18.4: abaixo de 20 HP não há mais consumíveis de stat/Golden Goose/Barter, então a janela de "ganhar valor depois" acaba.

---

## 8. Fragmentos de falas de jogadores de elite (poucos)

| Quem                | O que                                                                                                                                                                                                                         | Data / contexto                                                                                       | Tipo               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------ |
| Dishsoap (tweet)    | Meta do Bardo: pegar augment de econ e rolar para o Bardo >80% dos jogos, "os rerolls nas derrotas compensam a econ que se perde, especialmente no estágio 4"; greed do Bardo rola até terminar o nível 8 ou restarem 2 vidas | ID do tweet 2003596421946311112 (aprox. dez/2025), set anterior, [fora do Set 18, só princípio]       | OPINIÃO de jogador |
| Huanmie             | Nível 9 por Space God Ahri + Caretaker's Ally (augment de nível) + Forward Thinking em 3-2; roll-down no 9 em estágio 4 foi mal; guardou ouro para um roll-down depois de eliminação devolver 4 custos                        | Entrevista oficial 2026-07-20 (Space Gods Tactician's Crown, 10-12/jul/2026, US$ 150 mil ao 1º lugar) | Fato (relato)      |
| Challenger genérico | "Challengers obcecam por cada moeda, reduzem a força do tabuleiro para atingir 10/20/30 ao final da rodada e frequentemente fazem loss streak deliberada"                                                                     | Artigo de Set 7 (sullla.com, atemporal, blog de um autor, não de um jogador identificado como pro)    | ATEMPORAL, OPINIÃO |

Não encontrei: dados de Challenger de nível-por-estágio versus colocação média (MetaTFT/tactics.tools têm os dados, mas as páginas não renderizam sem JS); nem os 5 guias do Mobalytics acessíveis (403).

---

## 9. "Três pontos de decisão por estágio" (síntese minha, não achada nas fontes)

Nenhuma fonte usa esse nome. Combinando o que as fontes dizem, o modelo mais útil para um assistente é: em cada rodada decidir **(1) nível/rolagem/poupança** (um único bolso de ouro, usos mutuamente exclusivos [MetaBot, tftsense]); **(2) postura**: streak (ganhar/perder/misto) e HP; **(3) alvo e disputa** (quais peças, quantas cópias restam, quem disputa). Os pontos de decisão calendarizados (âncoras repetidas em 5+ fontes):

- Estágio 2: 2-1 (nível 4?), 2-4 carrossel/10 de ouro, 2-5 (nível 5?), fixar direção de streak.
- Estágio 3: **3-1** (janela do hyper roll de 1 custos), **3-2** (nível 6; HP < 60 = roll leve), **3-5** (nível 7 com 30+/40+).
- Estágio 4: **4-1** (loss streak: nível 8; HP baixo: 7 e rolar; 50 ouro para Fast 8), **4-2** (Fast 8, o timing mais comum), **4-5** (Standard 8/9 com econ).
- Estágio 5: **5-1** (último grande roll-down/ponto de decisão do Fast 9), **5-2** (nível 9 em win streak).
  Esta é uma estrutura de apoio ao assistente, não uma citação.

---

## 10. Regras SE/ENTÃO (acionáveis)

Convenção: HP = vida atual; "ouro" = ouro em mãos antes de gastar; fontes entre colchetes (S = lista no fim). Todos os limiares de HP/ouro de guias são [OPINIÃO]; as de matemática são [CALC/FATO].

### Estágios 1-2

1. SE estágio 1 (1-1 a 1-4) ENTÃO não gastar ouro; guardar para o estágio 2; juntar 2-3 candidatas de comp sem se comprometer. PORQUE gastos cedo custam juros compostos. [TFT Ninja stage-by-stage, 2026-10-06]
2. SE ouro >= 10, 20, 30, 40 ou 50 no fim da rodada ENTÃO evite cruzar o limiar para baixo sem ganho de combate real; considere vender uma unidade de bancada antes do combate acabar para atingir o limiar (29→30). [TFTEmblem, 2026-06-03; MetaBot econ]
3. SE 2-1 E tabuleiro não perde ENTÃO comprar 4 XP (nível 4); SE 1-cost reroll ENTÃO não subir de nível. [BunnyMuffins; TFT Ninja]
4. SE estágio 2 E fonte de win streak crível (3+ vitórias) ENTÃO win streak (slam itens, nível 4 em 2-1, 5 em 2-5); SE sem peças/itens fortes E HP alto ENTÃO loss streak controlado, nível 4 em 2-3 com 10+ ouro; SE alternando V/D ENTÃO fazer econ (20 em 2-5) e evitar nivelar sem motivo. [BunnyMuffins; TFTSense; TFT Ninja]
5. SE nível 5 em 2-5 ENTÃO só se estiver forte; senão "faça econ 20". [BunnyMuffins]
6. SE tem augment de nível/econ prismático nos estágios 2-3 E quer Fast 9 ENTÃO considerar; sem ele Fast 9 sem win streak "é quase impossível". [Mobalytics via busca; BunnyMuffins 18.3b]

### Estágio 3

7. SE 3-1 E reroll de 1 custo com 5+ cópias do alvo E 50-60 ouro ENTÃO rolar até ~32 ouro; SE 7-8 cópias ENTÃO aprofundar. PORQUE 3-1 é a última janela de nível 4 (55%). [BunnyMuffins; TFTSense; TFTEmblem]
8. SE 3-2 ENTÃO nível 6 (consenso). SE 3-2 E HP < 60 ENTÃO rolar 10-20 ouro para achar upgrades e parar de perder HP. PORQUE derrota no estágio 3 já custa 9-12. [TFT Ninja]
9. SE 3-5 E win streak E ouro >= 30 ENTÃO nível 7. SE 3-5 E loss streak ENTÃO nível 7 só com ouro >= 40. [BunnyMuffins; TFTSense]
10. SE reroll de 2 custos ENTÃO nível 6 em 3-2 e slow roll (segurar 50). SE reroll de 3 custos ENTÃO nível 7 em 3-5 (com augment de econ) ou 4-1; só se forte/cópia inicial/artefato. [BunnyMuffins]
11. SE 3 estrelas: só viável se cópias nas mãos (tabela 5.2). SE 3★ de 2-3 custos com < 3 cópias em mãos ENTÃO não force; ver CALC (3★ 2c com 3 cópias: 70g = 14%). [CALC]

### Estágio 4 (decisão central)

12. SE 4-1 E HP < 50 (ou perdendo quase tudo) ENTÃO nível 7 e rolar 20-40; estabilize mesmo gastando quase toda a economia. [TFT Ninja]
13. SE 4-1 E HP 50-70 E ~50% de vitórias ENTÃO nível 7, rolar leve (10-20) e reconstruir. [TFT Ninja]
14. SE 4-1 E HP >= 70 E win streak ENTÃO nível 7, reavaliar se rolar ajuda; se não, poupar e empurrar para 8. [TFT Ninja]
15. SE loss streak (déficit ~50-60 HP) ENTÃO nível 8 em **4-1** (uma rodada antes dos win streakers) e roll-down maior. [BunnyMuffins; TFTSense]
16. SE Fast 8 (4 custos) E ouro >= 50 ao entrar em 4-1 E HP saudável ENTÃO nível 8 em 4-1/4-2 e rolar imediatamente, mirando 2★ do carry; rolar com 30-50 ouro (mínimo 35). [TFT Ninja; Goboost 40]
17. SE contestado nos mesmos 4 custos (2+ rivais) ENTÃO rolar em 4-1 antes de eles baterem nível 8; SE 2+ rivais no mesmo alvo e <= 5 cópias restantes ENTÃO pivotar (não rolar mais forte). [TFT Ninja; BunnyMuffins; VoidS1n]
18. SE ouro após subir ao 8 ou 9 < 35 E HP baixo ENTÃO subir e rolar; SE > 35 E HP alto ENTÃO roll-down até ~50, sem pressa; SE HP muito baixo ENTÃO rolar até 10 a cada turno, depois a 0 quando faltar 1 cópia dos centrais. [VoidS1n; TFTComps; BunnyMuffins]
19. SE HP > 80 ao chegar em 4-2 E augment disponível de econ ENTÃO pode sacrificar o estágio e pegar econ (guia 18.3b/BunnyMuffins); com HP < 80 trate o estágio 4 como crítico.
20. SE nível 8 atingido E 2★ do carry 4 custos pronto E HP > 60 (alguns pedem > 75) E ouro 30+ ENTÃO considerar nível 9 em 5-2 (5-5 se rolou muito no 8). SE HP < 40 ENTÃO não. [TFT Ninja; Goboost; VoidS1n]
21. SE 4-2 E reroll de 2 custos E HP baixo e perdendo ENTÃO rolar até 10 ouro a cada turno até faltar 1 cópia do núcleo, depois a 0; SE HP alto ENTÃO rolar até 50. [TFTComps]

### Estágios 5+

22. SE 5-1 E não fez Fast 8 ENTÃO nível 8 e rolar (último grande roll-down); finalizar comp até 5-2; priorizar 2★ do carry e do tank. [TFT Ninja stage-by-stage]
23. SE estágio 5 E HP < 40 E ouro disponível ENTÃO gastar tudo (rolar/XP). PORQUE derrota custa 16-19 (restam 1-2). [TFT Ninja; dano por estágio]
24. SE estágio 6+ ENTÃO economia não importa mais; gastar tudo em rolagem e nível, escolher nível 9-10 para 5 custos (9: 15% por slot). [TFT Ninja]
25. SE um jogador é eliminado ENTÃO recalcular C_peça e C_custo (cópias voltam ao pool imediatamente); pode justificar um roll-down que antes estava inviável. [TFT Ninja pool-math; Huanmie]

### Rolagem e pool (qualquer estágio)

26. SE vai rolar por X ENTÃO calcule P(sucesso) = DP da seção 6; 4 custos no nível 8 sem concorrência: 2★ com 1 cópia a mais = ~50% com 20g, ~68% com 30g, ~87% com 50g; SE concorrência elevar o custo (rivais com 4+ cópias) ENTÃO multiplique o ouro necessário por ~1,5-2. [CALC]
27. SE já gastou 40+ ouro sem achar o alvo ENTÃO conte as cópias nos tabuleiros rivais antes de gastar mais. [TFT Ninja pool-math]
28. SE 4 custos com <= 5 cópias restantes (5 custos <= 3) ENTÃO considerar pivô ou compensar com outro alvo do mesmo custo. [TFT Ninja]
29. SE slow roll ENTÃO só rolar acima de 50; SE estágio inteiro de slow roll sem acertos ENTÃO assumir concorrência e subir/pivotar. [MetaBot]
30. SE hyper roll de 1 custos ENTÃO só com: carry de 1 custo, 5+ cópias em 3-1, itens de apoio, pool livre, HP > ~60. SE HP ~20 ENTÃO é cara-ou-coroa. [MetaBot; BunnyMuffins 2021 para 5+ cópias, atemporal]
31. SE nível >= 8 E ouro suficiente E não precisa de unidade específica ENTÃO subir antes de rolar ("level first so your rolls hit the right pool"); SE precisa de uma peça específica para vencer a luta atual ou HP em queda ENTÃO rolar. [MetaBot]
32. SE quer um 4 custos abaixo do nível 8 ENTÃO não rolar, a menos que esteja prestes a morrer. [MetaBot]

### Regras por faixa de HP (resumo)

- HP >= 80: Fast 9 possível (> 75 em 4-1 segundo uma página do TFT Ninja), poupar econ, até sacrificar estágio 4 por augment de econ.
- 60-80: padrão; Fast 8 ok; Fast 9 só se 2★ completo.
- 50-60: ainda pode poupar, mas roll leve se perdendo; cuidado no estágio 4.
- 40-50: comprometer rolagem no spike (30-50 ouro), não tentar Fast 9.
- 30-40: faixa de compromisso total; gastar a maior parte do ouro; pivôs em pool contestado.
- < 30: gastar tudo (nível/roll); 18.4 corta consumíveis de stat abaixo de 20.

---

## 11. Como isso se aplicaria a um assistente de decisão

Dados que o sistema precisaria (e o que já seria suficiente em aproximação):

| Regra                                            | Dados necessários                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nível pela tabela (seção 3 e regras 3-10, 15-16) | Estágio-rodada atual (ex.: "3-2"), nível, XP atual, ouro, HP, streak atual (V/D/misto e tamanho), fase do comp (reroll 1/2/3 custos, Fast 8/9)   |
| Orçamento de HP (4.3)                            | HP atual, estágio, tabela de dano por estágio (base + nº de unidades inimigas ~ nível do rival)                                                  |
| Juros (2, 4.1)                                   | Ouro, limiar mais próximo, valor da unidade a vender para cruzá-lo                                                                               |
| Odds por loja (5.1, 5.2)                         | Nível, tabela de odds do patch, loja atual (5 slots, Wisp?), custo do alvo                                                                       |
| Correção por concorrência                        | Cópias do alvo no seu banco+tabuleiro, nos tabuleiros e bancos rivais (scouting), cópias totais do custo, jogadores eliminados e o que seguravam |
| Hit chance / ouro p/ 50-80-95%                   | Cálculo DP (seção 6) com pool atual; saída: P(sucesso) para G ouro e "ouro necessário"                                                           |
| Pivô (28)                                        | Cópias restantes do alvo; nº de rivais com a peça; ouro já gasto sem acerto                                                                      |
| Fast 9 (20)                                      | HP, núcleo 2★ presente, ouro, augments de nível/econ, ouro disponível                                                                            |
| Loss streak (15)                                 | Contagem de derrotas seguidas, HP, ouro, augment de econ                                                                                         |
| Eliminações                                      | Eventos do lobby (quem saiu, o que tinha)                                                                                                        |

Observações para implementação (dados já disponíveis no projeto são decididos por outros agentes; aqui só o que as regras exigem):

- Tabelas de odds/XP/streak devem ser **configuráveis por patch** (nível 7 disputado 16 vs 19; XP 8→9 mudou duas vezes em 18.2; streak em 3 versões).
- O que as fontes tratam como "estágio-rodada" (3-2, 4-1) é o gatilho de calendário; o assistente deve usá-lo junto com HP e streak, não sozinho.
- Mantenha a distinção entre observado (ouro, HP, loja), inferido (cópias dos rivais a partir de tabuleiros visíveis) e desconhecido (bancos rivais não vistos, itens do tipo Pandora).

---

## 12. Lacunas

- Falas diretas de Mortdog, k3soju, Frodan, Robinsongz, Setsuko, Souless etc. sobre economia do Set 18: **não encontrei**.
- Estatísticas por nível/estágio em Challenger (MetaTFT/tactics.tools): a página existe, mas não retornou os dados (conteúdo dinâmico); não pude cruzar tempos com colocação média.
- Mobalytics (403), Blitz (403), Dishsoap tweet (402), Bamboo (429): lidos só por resumo da busca ou não lidos.
- Tabela oficial de streak do 18.x não confirmada; usar a versão (a) com cautela.
- O termo "três pontos de decisão por estágio" não foi encontrado; a seção 9 é síntese minha.
- Nível 7 (16/30/43 vs 19/30/40) e se o nível 11 existe em partidas normais (aparece nas tabelas via itens/augments): não resolvido.
- Cálculo DP assume pool sem mudança durante o roll e sem Wisps; na prática os Wisps tiram ~10% dos slots de campeão e rivais compram cópias.

---

## Fontes (acessadas em 2026-10-10 salvo indicação)

- S1 Liquipedia, Patch TFT18.1 (lançamento 2026-08-26): https://liquipedia.net/tft/Patch_TFT18.1
- S2 TFTSense, Set 18 news log 18.1 a 18.4 (datas de patch e mudanças de economia): https://tftsense.gg/study-hall/tft-set-18-news/
- S3 Resultados de busca/Liquipedia sobre Tactician's Crown (próximo evento 13-15/nov/2026): https://liquipedia.net/tft/Tactician's_Crown
- S4 op.gg, Season 18 Gold and Experience (renda, juros, streak, XP; sem data): https://op.gg/tft/game-guide/gold-xp
- S5 TFT Ninja, Economy (atualizado 2026-09-25): https://tft.ninja/guides/game-mechanics/economy
- S6 LoL Wiki, TFT:Gold (streak 3-4, marcado como possivelmente desatualizado): https://wiki.leagueoflegends.com/en-us/TFT:Gold
- S7 MetaBot, Slow Roll vs Hyper Roll (2026-07-28, atualizado 10-05); Economy (2026-07-25, atualizado 10-05); When to Roll vs Level (idem): https://metabot.gg/en/TFT/guides/tft-slow-roll-vs-hyper-roll , https://metabot.gg/en/TFT/guides/tft-economy-gold-interest-streaks-explained , https://metabot.gg/en/TFT/guides/tft-when-to-roll-vs-level-up-shop-odds
- S8 Noxu TFT, Leveling Guide Set 18 (sem data): https://noxutft.com/guide/leveling
- S9 LoL Wiki, TFT:Experience: https://wiki.leagueoflegends.com/en-us/TFT:Experience
- S10 Riot, Teamfight Tactics patch 18.2 (XP, Wisps, razões): https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-2/
- S11 gamer.org, "TFT Patch 18.2 B-Patch Hits Fast 9 Hard" (2026-09-17): https://www.gamer.org/tft-patch-18-2-b-patch-hits-fast-9-hard-riot-reverses-its-leveling-buffs/
- S12 tftflow, Shop Odds, Pool Size, XP Table (patch 18.2): https://tftflow.com/tables/set18/shop-odds-pool-size-xp-table
- S13 Riot, patch 18.1 (Wisps, Carousel, rerolls, ouro): https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-1/
- S14 tftcodex, Roll Calculator (cliente 18.3.0, 2026-09-25): https://tftcodex.com/tools/roll-calculator.html
- S15 BunnyMuffins, Leveling & Econ Guide Set 18: https://bunnymuffins.lol/tft-leveling-guide/ ; Opener Guide (patch 18.3b): https://bunnymuffins.lol/openers/
- S16 TFTSense, Leveling Guide (MadeByKeo, 2026-06-27) e Fundamentals (2026-09-27, patch 18.3): https://tftsense.gg/study-hall/tft-leveling-guide/ , https://tftsense.gg/study-hall/tft-fundamentals/ , https://tftsense.gg/study-hall/tft-champion-pool-and-odds/ , https://tftsense.gg/study-hall/tft-reroll-guide/
- S17 Mobalytics Fast 9 Set 18 (403, só resumo de busca): https://mobalytics.gg/tft/guides/set-18-how-to-play-fast-9
- S18 TFT Ninja: stage-by-stage (2026-10-06), 4-cost econ gameplan e pool math (patch 18.3, 2026-09-25), damage per stage (patch 18.1, 2026-10-06), champion pool: https://tft.ninja/guides/advanced/stage-by-stage , https://tft.ninja/guides/strategy/4-cost-econ-and-gameplan , https://tft.ninja/guides/advanced/pool-math , https://tft.ninja/guides/game-mechanics/player-damage-calculation , https://tft.ninja/guides/game-mechanics/champions/champion-pool
- S19 Riot, "5 Questions with AUR Huanmie, the Space Gods Champion" (2026-07-20): https://teamfighttactics.leagueoflegends.com/en-us/news/esports/5-questions-with-aur-huanmie-the-space-gods-champion/
- S20 Dishsoap no X (conteúdo só via resumo da busca, não abri o tweet): https://x.com/Dishsoaptft/status/2003596421946311112
- S21 BunnyMuffins Opener Guide (patch 18.3b, perdas de streak / 8+ vitórias): https://bunnymuffins.lol/openers/
- Outras: Goboost (2026-06-05) https://goboost.gg/blog/tft-leveling-guide-exactly-when-to-push-level-8-and-level-9/ ; VoidS1n https://voids1n.com/tft-guides/youre-playing-stage-4-wrong-stage-4-guide/ ; TFTComps https://tftcomps.gg/news/tft-leveling-guide/ ; TFTEmblem (Set 17, 2026-06-03) https://tftemblem.com/guides/economy-guide/ ; tfthub (14.8 streak, 2024-04-08) https://tfthub.com/2024/04/08/set-11-player-damage-streak-gold-changes/ ; esportstales https://www.esportstales.com/teamfight-tactics/champion-pool-size-and-draw-chances ; BunnyMuffins reroll explained (2021, atemporal) https://bunnymuffins.lol/reroll-hyperroll-slowroll-explained/ ; sullla (Set 7, atemporal) https://sullla.com/LoL/TFT7badhabits.html ; MetaBot Rolldown Calculator https://metabot.gg/en/TFT/rolldown-odds
