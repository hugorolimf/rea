# 03 - Scouting, pool compartilhada, contest e pivô (Set 18 "Enchanted Wilds")

Pesquisa feita em 2026-10-10. Set atual: **Set 18 - Enchanted Wilds** (lançamento global 2026-08-25/26; patches 18.1 = 08-26, 18.2 = 09-10, 18.3 = 09-23; os guias e sites de meta já falam do 18.4) [Liquipedia Patch TFT18.1; esports.gg]. Primeiro set em Unreal Engine; o Carousel voltou; mecânica nova de Wisps.

## Legenda de confiabilidade e tipos

- **[FATO]** número/regra de sistema confirmado em 2+ fontes ou calculado por mim a partir de números das fontes.
- **[CONSENSO]** várias fontes independentes dizem o mesmo.
- **[OPINIÃO]** heurística de um autor/jogador.
- **[DISPUTA]** fontes discordam ou há inconsistência interna.
- **[CALC]** conta feita por mim (script na pasta de scratch) a partir de pool e odds do Set 18.
- Aviso honesto sobre a qualidade das fontes: a maior parte do que está online sobre este tema são guias de sites (muitos de autoria não identificada, vários com cara de conteúdo gerado/SEO: metabot.gg, ggclan.com, boosteria.org, emblemcomp.gg, tftsense.gg, tft.ninja). Tratei-os como **consenso/opinião de segunda mão**. Fontes realmente de jogador de elite que consegui ler: **ElbroC (Challenger, 2023)** e **ぱうだー/Powder (Master+/Challenger, abr/2025)**. **Não consegui obter** transcrições de Mortdog, Dishsoap, k3soju, Setsuko, Frodan etc. (YouTube/Twitch não indexáveis aqui), nem threads de Reddit (domínio bloqueado para a ferramenta), nem Mobalytics (403). Onde atribuo algo a um pro, é porque a fonte lida disse isso; nada foi inventado.

---

## 1. Resumo executivo

1. **A pool é pequena e compartilhada**; no Set 18 cada campeão tem **30/25/18/10/9 cópias** (custo 1/2/3/4/5) e a pool tem 14/13/14/14/10 campeões por custo (420/325/252/140/90 cópias). Cada cópia que um rival segura sai do seu numerador _e_ aumenta a participação relativa de todos os outros campeões do mesmo custo (efeito composto).
2. **Scouting = contar**: quem tem o meu carry, quantas cópias, quem tem ouro para rolar, quem tem itens prontos em "holders". Os pros (ElbroC) escoutam **após cada escolha de aprimoramento e cada PvE**, **durante o Carousel** e **antes de cada rolldown**; varredura completa dos 7 tabuleiros **pelo menos 1x por estágio**, vizinhos de ranking primeiro.
3. **Contestação não é sempre fatal.** Regra de bolso quase unânime: **1 rival no seu carry = commit**, **2 = jogável se a sua base for mais forte / acompanhar o fluxo de cópias**, **3+ (ou 3 tabuleiros com o mesmo 4 custo) = pool "starved" → pivotar**. Uma simulação (TFTSense, não auditável, autoria comercial) diz que contestar custa só ~0,2 posições, mas o _pivô de pânico_ custa ~0,4.
4. **Pivô bom é planejado um estágio antes**, acontece em **3-x/4-x** (janela "ideal" = estágios 3 e 4, de preferência junto de um level-up/rolldown), com economia, trocando **1-2 unidades por vez**, mantendo itens genéricos num holder temporário. **Pivô no estágio 5 "raramente funciona".**
5. **"Flex early, commit late"** (Mobalytics, TFT Ninja, Metabot): ficar aberto até ~3-2 (ou "até estágio 3-4"), decidir contest no 2º estágio de combate, e **comprometer-se totalmente no rolldown** quando a lane estiver confirmada aberta. Itens: segurar componentes e montar primeiro itens defensivos universais.
6. **Valor de 4/5 custos muda com a disputa**: um 4 custo tem 10 cópias; um 2★ precisa de 3, um 3★ de **9 de 10** (3★ de 4 custo = "presente, não plano"). Contado por mim: com nível 8 e 10 cópias disponíveis, ~19 ouro por cópia; com 4 cópias restantes e a tier esvaziada, ~35-55 ouro por cópia (**2 a 3x mais caro**).
7. **Eliminações devolvem cópias à pool imediatamente** (tabuleiro + banco + itens voltam); quem estava segurando seu carry e morre muda a conta: "rolar mais generoso do que as odds iniciais sugerem" no 4-7/5-1.
8. **Reroll de 1-3 custos só se faz sem contest**: sinais citados - "se rolou um estágio inteiro e nada veio, a pool provavelmente está contestada" (Metabot) e "se por volta de 2-5 outro jogador vai pro mesmo reroll, volte ao leveling padrão" (guia antigo citado).
9. **Erros típicos**: escoutar só o próprio carry; ignorar bancos; escoutar só quando perde HP; escoutar só no fim; panic-pivot do tabuleiro inteiro; pivotar por frustração/sunk cost; vender pares que serviriam ao novo plano; parar de escoutar depois de commit.
10. **Limite desta pesquisa**: não achei dado medido (de partidas reais) separando placement contestado x não contestado, nem partidas de elite do Set 18 analisadas por jogador. Tudo "quantitativo de decisão" abaixo ou é regra de bolso de guia ou é cálculo meu.

---

## 2. Matemática da pool e das lojas (Set 18)

### 2.1 Números de sistema [FATO - 3+ sites concordam: tft.ninja, tftsense.gg, seemeta.com, turboboost (Set 14, mesmos 30/25/18/10/9)]

| Custo | Cópias/campeão | Campeões | Total de cópias |
| ----- | -------------- | -------- | --------------- |
| 1     | 30             | 14       | 420             |
| 2     | 25             | 13       | 325             |
| 3     | 18             | 14       | 252             |
| 4     | 10             | 14       | 140             |
| 5     | 9              | 10       | 90              |

Total 1.227 cópias. Fontes: https://tft.ninja/guides/game-mechanics/champions/champion-pool ; https://tftsense.gg/study-hall/tft-champion-pool-and-odds/ ; https://seemeta.com/en/tft/set-18/odds (2026-10). **[DISPUTA menor]** metabot.gg lista "~29/22/18/10/9 e 13/13/13/12/10 campeões" (aproximado, diz que muda por set) e a página Set 14 da turboboost tem tabelas internas inconsistentes; eu uso a tabela acima (3 sites a repetem e batem com os números clássicos do jogo).

Odds da loja por nível (% por slot; 5 slots por rolagem; rolagem = 2 ouro) [FATO - seemeta e tftsense idênticos]:

| Nível | 1c  | 2c  | 3c  | 4c  | 5c  |
| ----- | --- | --- | --- | --- | --- |
| 5     | 45  | 33  | 20  | 2   | 0   |
| 6     | 30  | 40  | 25  | 5   | 0   |
| 7     | 19  | 30  | 40  | 10  | 1   |
| 8     | 15  | 20  | 32  | 30  | 3   |
| 9     | 10  | 17  | 25  | 33  | 15  |
| 10    | 5   | 10  | 20  | 40  | 25  |
| 11    | 1   | 2   | 12  | 50  | 35  |

(Níveis 1-4 omitidos; ver fonte.) O TFT Ninja menciona que o 4 custo no nível 8 passou de 22% (Set 17) para 30% e foi mantido no Set 18.

### 2.2 Fórmula [FATO - tft.ninja "Champion Pool Math (Set 18)", atualizado 2026-09-25: https://tft.ninja/guides/advanced/pool-math]

`P(slot = campeão-alvo) = P(custo no nível) x cópias_restantes_do_alvo / cópias_restantes_totais_do_custo`

- Cópias restantes = tamanho original - cópias nas suas mãos - cópias em tabuleiros/bancos dos rivais - (em princípio) cópias nas lojas ativas dos jogadores. Ver lacuna sobre lojas em 8.
- Os dois termos caem juntos quando o custo é disputado, mas se **outros campeões do mesmo custo** forem comprados, o denominador diminui e a participação do seu alvo **sobe** um pouco. Ou seja: a tier esvaziada de forma geral não prejudica tanto quanto o alvo esvaziado especificamente. [CALC/inferência da fórmula]
- Exemplo do guia: 4 custo "Ahri", nível 8, você tem 3 cópias → restam 7 de 137 → 1,53% por slot → 7,4% de pelo menos 1 em uma rolagem de 5 slots; P(≥1 Ahri): 20g=54%, 30g=69%, 50g=85%, 60g=90%. **[DISPUTA/erro interno do guia]** a tabela de contest usa "8 Ahri por padrão" enquanto o mesmo guia diz 10 cópias; ignore o 8 e use o número de cópias que você realmente contou.
- Contest (mesma tabela, base 8 cópias): rivais seguram 3 → sobram 5 → 63% das odds; 5 → sobram 3 → 38%; 7 → sobra 1 → 13%.

### 2.3 Cálculo próprio com pool e odds do Set 18 [CALC]

Modelo simples (um slot sorteia o custo e depois o campeão em proporção às cópias restantes; cada slot independente; custo de rolagem 2 ouro/5 slots). Ouro esperado por cópia do alvo (4 custo, alvo único):

| Nível    | Alvo com 10 cópias, tier cheia (140) | 4 sobrando de 10, tier com ~36 cópias retiradas | 2 sobrando, tier com ~58 retiradas |
| -------- | ------------------------------------ | ----------------------------------------------- | ---------------------------------- |
| 7 (10%)  | ~56 ouro/cópia                       | ~104                                            | ~164                               |
| 8 (30%)  | ~19                                  | ~35                                             | ~55                                |
| 9 (33%)  | ~17                                  | ~32                                             | ~50                                |
| 10 (40%) | ~14                                  | ~26                                             | ~41                                |

Outros pontos: 5 custo com 9 cópias, tier cheia (90): ~133 ouro/cópia no nível 8 (3%), **~27 no nível 9 (15%)**, ~16 no nível 10 (25%). 3 custo (18 cópias, tier cheia 252): ~14 ouro/cópia no nível 7, ~17,5 no nível 8; com 6 cópias sobrando: ~35 (nível 7) / ~44 (nível 8).

Ouro **mediano** (simulação de 20 mil tentativas, nível 8, 4 custo, desconta cópias que saem da pool durante as rolagens) para chegar a N cópias:

- 3 cópias (2★) com 10 disponíveis: mediana 56 ouro, p90 110 (confere com seemeta: 56 ouro = 50%, 110 ouro = 90%).
- 3 cópias com 7 disponíveis: mediana 78, p90 156.
- 3 cópias com 4 disponíveis: mediana 150, p90 312.
- 6 cópias (duas 2★, ou 2★+..) com 10 disponíveis: mediana 146, p90 242.
- 9 cópias (3★) com 10 disponíveis: mediana ~328 ouro (impraticável em partida normal; ~7 pessoas dividiriam só 1 cópia sobrando).

Conclusões numéricas utilizáveis:

- Cada cópia retirada de um 4 custo de 10 corta ~10% do numerador; **com 3 rivais segurando 6 cópias, o custo por cópia dobra** em relação ao não contestado.
- "2★ de 4 custo" é viável com ≥7 cópias livres a ~80 ouro mediano; com ≤4 livres a mediana passa de 150 ouro.

### 2.4 Quantas 3★ cabem na pool [FATO - consistente em tft.ninja, metabot (com erros de tabela), tftsense]

- 3★ precisa de **9 cópias**. 1 custo: 30 cópias = 3 3★ possíveis (21 sobram após uma); 2 custo: 25 → 2; 3 custo: 18 → 2 (só 9 sobram); 4 custo: 10 → **1** (e 1 cópia sobra pro lobby inteiro); 5 custo: 9 → 1 (nenhuma sobra).
- Um 3★ de 4 custo só ocorre se praticamente **ninguém mais** tiver o campeão. TFT Ninja: "extremamente raro, precisa de pool quase vazia, trate como presente e não como plano". Riot reduziu a frequência de 3★ de 4 custo no Set 11 (patch 14.9) por considerá-la exagerada, reduzindo odds de nível 8/9 [esports.gg, set 11 - antigo].

---

## 3. Scouting: o que olhar, quando e com que frequência

### 3.1 Elite (ElbroC, Challenger; Substack 2023-05-22 - set 9.5; princípios atemporais) [OPINIÃO de jogador de elite, a melhor fonte primária que achei]

Fonte: https://elbroc.substack.com/p/how-to-scout-like-a-top-player-in-tft-65b63b93b273
Três tipos de scouting, com **quando**:

1. **Comps dos rivais**: começa em **2-1 ou antes**; regra: **checar após cada escolha de aprimoramento e cada rodada PvE** (grandes mudanças de plano acontecem aí). Olhar não só as sinergias ativas (info "parcial", pode enganar porque os fortes trocam peças) mas **unidades no tabuleiro + banco, itens completos fabricados, aprimoramentos**, e prever a comp final com conhecimento de meta. Objetivo: **evitar contest** ("se o rival quer as mesmas unidades, vocês diminuem a chance um do outro") e adaptar o tabuleiro ao lobby (ex.: 5 de 7 em AP → itens anti-AP; 2 Brawlers + 2 rerolls com muitos 3★ → Giant Slayer vale muito).
2. **Posicionamento**: olhar o adversário da próxima rodada **antes de toda rodada**, inclusive no early game (backline access, CC em área, itens-chave como Zephyr/Shroud, posição do carry inimigo).
3. **Poder relativo e tempo (tempo/tempo do lobby)**, "o mais avançado e talvez o mais valioso no topo": **ativo** = ciclar pelos rivais olhando augments de combate, estrelas, número de unidades, itemização de carry/tank (ex.: "carry 1★ todo itemizado, dois augments de combate, frontline 1★, 6 Ox Force, zero ouro"); **passivo** = a lista de jogadores à direita avisa quando alguém fecha 2★/3★ ou sobe de nível; aprenda a captar isso enquanto rola/posiciona (ex.: três jogadores subindo agressivamente para 7). **Quando: "o máximo possível", priorizando pós-PvE, pós-augment e Carousel** (não dá para agir no seu tabuleiro durante o Carousel). **Por quê**: decide economia. Exemplo dele no 3-2 com tabuleiro fraco e pares: rolar 10-20 ouro ou economizar para o PvE? Se o lobby não está rolando, tem boards fracos e economia saudável, está indo para late game ganancioso → **economizar mantém você no tempo**; rolar sem scoutear pode deixar você "para trás economicamente por poucos HP salvos".

### 3.2 Rotina de checkpoints (consenso dos guias; fontes de média confiabilidade)

- Metabot (publicado 2026-07-28, atualizado 2026-10-05, autor não identificado): https://metabot.gg/en/TFT/guides/tft-scouting-flexible-vs-forcing-comps
  1. vizinhos de ranking primeiro (você os enfrenta mais; "o jogador logo abaixo importa mais");
  2. varredura dos 7 tabuleiros ao menos 1x por estágio ("alguém monta o meu carry?");
  3. **ler item holders**: item completo de carry num placeholder revela a comp antes de ela se formar; itens de AD completos = esse jogador não está em linha de AP;
  4. **economia e nível**: "jogador com 50+ ouro em nível alto está prestes a fazer rolldown e puxar unidades da pool";
  5. **re-escoutar logo antes de qualquer rolldown**, sobretudo de 30+ ouro;
  6. com o tabuleiro pronto, escoutar o adversário e ajustar posicionamento.
- Boosteria (2026-03-28): checkpoints = varredura rápida no early (mais forte/mais fraco, direção de itens), **antes de um slam de item grande**, **antes de level-ups (6, 7 e 8)**, antes de rolldown, após estabilizar ("estabilizar não é vencer"), e _não parar depois de commit_. https://boosteria.org/guides/tft-scouting-guide-read-lobby-pivot-without-panic
- Mobalytics (via resultados de busca; página dá 403): olhar **bancos, itens e augments**, não só o tabuleiro; "contar quantos inimigos têm as unidades que você quer e quantas já têm"; checar também antes de gastar muito ouro porque contest forte enfraquece o rolldown. Mesmo texto repete a rotina de pós-PvE/pós-augment e a ideia de que Carousel é bom momento para ciclar.
- Fontes sobre o que o jogo mostra: a wiki da comunidade (LoL Wiki, não oficial) diz que ao enfrentar um jogador você vê **banco, inventário de itens e geradores de ouro**; guias dizem que olhar o **ouro** do rival é possível ao clicar no retrato. Atalhos citados: `1`/`Q` próximo tabuleiro horário, `3`/`R` anti-horário (1v9.gg, só resultado de busca; página não carregou). **[não verifiquei numa partida real]**.

### 3.3 Scouting no estágio 1/2 e leitura de sinais (Powder, 2025-04-24) [OPINIÃO de jogador Master+/Challenger]

Fonte: https://note.com/jgdpwp281/n/n37c8bfc1392a (japonês; li resumo)

- "Você não consegue rastrear todos": foque em **sinais que definem comp**: (a) **unidade que define a comp** (ex.: Rengar) → esse jogador está comprometido, anote e siga; (b) **unidade que só é boa em comp** (ex.: TF) → não trava ninguém, depende de itens/augments; (c) **item que aponta comp** (Guinsoo, Exos); "TF + Guinsoo" é aproximadamente o ponto em que dá para considerar que alguém commitou.
- Foco: **jogadores que também estão indecisos**, não os que estão na frente; o jogo costuma ser uma briga pelas **duas últimas vagas de top 4** depois que 1-2 jogadores fecharam cedo.
- "Challengers chegam ao top 4 escoutando para escolher a **comp mais forte que poucos disputam**, especialmente no augment de **2-1**." "A maioria dos bottom 4 vem de não ter plano sólido no estágio 1."

### 3.4 Scouting não é só contest: usar para decidir ritmo (TFT Ninja/outros)

Ver 3.1 (3). Também: se um rival com pouca vida fizer all-in ganancioso, ele "pode morrer logo e devolver unidades à pool: cronometre seu rolldown" (Metabot).

---

## 4. Contested vs. uncontested: limiares e evidências

### 4.1 Limiares que os guias dão

- **Metabot** [OPINIÃO/CONSENSO]: 2 jogadores no mesmo carry = administrável; **3 jogadores com o mesmo carry (ou 3 tabuleiros segurando o mesmo 4 custo) = pool starved, ninguém acerta limpo → pivotar** (para carry sem contest ou fast 8). Trait espalhada em 2-3 tabuleiros indica unidades/emblemas "hoardados": evitar a menos que você já tenha as peças.
- **TFTSense** (autor MadeByKeo, 2026-07-12, simulação própria sem metodologia publicada, **autor vende produto**): ~90% dos lobbies reais (9.169 lobbies high elo) contestam pelo menos uma linha que o jogador escolheria; contestado perde ~**0,2** posições médias vs não contestado; **panic-pivot** custa ~**0,4**. Regra: 1 rival = commit; 2 = jogável se o tabuleiro for forte, vigiar fluxo de cópias; **3+ = pivô "genuinamente correto"**; "alguém pegando minha comp não é motivo suficiente". Recomenda comprar cópias do carry cedo para "starvar" contestadores, ganhar a corrida de itens, ter slots flex e "out-tempo em vez de out-greed". https://tftsense.gg/study-hall/why-everyone-plays-the-same-comp-tft/ **[tratar como hipótese; sem auditoria]**
- **TFT Ninja pool math (Set 18)** [OPINIÃO baseada em fórmula; a conta é verificável]: pivotar quando **restarem ≤5 cópias de um 4 custo** (você tem 2-3 e outros 5+) - ~5,5%/rolagem no nível 8, ~12 rolagens (~25-30 ouro) para 50% de achar _uma_ cópia, e 2★ precisa de mais; **≤3 cópias de um 5 custo restantes: limitar a 1★**; **40+ ouro gastos sem achar cópia: escoute os tabuleiros antes de gastar mais**.
- **TFT Ninja flex vs forced / pivoting**: "um carry 2★ sem contest é quase sempre melhor que um carry 1★ contestado". Pivot se estiver atrás dos outros em cópias-chave ou itens.
- **GGClan** (2026-08-28, sem autor): trait única compartilhada com **2 outros tabuleiros** vira "guerra de lances" por uma pool; **quem tem mais ouro costuma ganhar**; para forçar uma trait única três condições: (1) o lobby te deu a trait cedo (componentes/augment), (2) scouting mostra que ninguém mais constrói nela, (3) sua vida dá rodadas suficientes até o breakpoint sem rolldown inviável. Se alguma falhar, "forçar é apostar". Também: decida antes do estágio 3 se o board quer **níveis ou cópias** ("boards que querem os dois terminam em quinto"); desenhe o board final de 8-9 unidades antes do estágio 3. https://ggclan.com/news/tft-set-18-traits-guide-force-or-pivot
- **Metabot slow vs hyper roll**: se rolar um estágio inteiro sem nada, pool provavelmente contestada → subir de nível, pivotar de carry ou cortar perdas; "se contestado, pivote para linha aberta em vez de rolar mais forte". HP: acima de 60 com tabuleiro real hyper roll é ok; ~20 HP "coin flip que você provavelmente perde". https://metabot.gg/en/TFT/guides/tft-slow-roll-vs-hyper-roll
- **Boosteria**: sem números; testes qualitativos: o overlap é o carry final ou só peças temporárias? Os itens do outro jogador encaixam na sua linha? Quem tem posse mais natural (cópias, itens, augments, holders)? Vida e ouro do outro? Quão estreita é a sua linha (linhas estreitas toleram menos contest)? **"Esperar até dois jogadores já terem acertado exatamente o seu tabuleiro final é tarde demais."**

### 4.2 Exemplos de linhas contestáveis no Set 18 (BunnyMuffins, patch 18.4; sem autor; atualizado semanalmente) [OPINIÃO de site de meta]

Fonte: https://bunnymuffins.lol/meta/

- Meta descrita como "estreita", empurra para commit cedo; **reroll de 3 custo muito comum** (Kha'Zix, Azir/Rammus, Riftbeast, Cassiopeia, Tristana/Rengar, Adaptor/Master Yi).
- **Kha'Zix Reroll (S)**: exige Kha'Zix em **2-1 a 2-3**; "sem Kha'Zix no estágio 3 a linha é impossível" (ou seja, quem escouta cedo sabe se está contestado). O guia de Azir Reroll (tftflow, 18.4) diz o mesmo: "a maioria dos jogadores só rerola Kha'Zix se o tem no estágio 2; escoute cedo para garantir que você não está contestado".
- **Solar Kayle**: escoute para garantir que não está contestado e pivote se estiver. **Solar Akali**: só jogar com spot **completamente sem contest** salvo condição forte. **Tristana/Rengar**: se pivotar tarde, garanta que está sem contest. **Elderwood Executioners**: jogue quando "sem contest e saudável" para considerar rolar no 4-5.
- Pares conhecidos de contest: Primal Malphite contesta Sentinel/Malphite; Invoker Nidalee contesta Sentinel/Morgana; Flora Malphite deve contestar Malphite 2 no 4-2.
- **Pivôs sugeridos**: Draven Fast 9 → Aphelios Flex; Dragon Fast 9 → Sivir/Nidalee/Aphelios; Invoker Nidalee, se o estágio 3 estiver inconsistente → linha de 4 custo.
- Também "Metabot" (resultados) lista Brawler/Elderwood com 1,4% de pick rate como "muito contestado", mas isso é pick rate baixo, não prova de contest [não usar].

### 4.3 Dado medido

**Não encontrei** estudo com dados de partidas reais separando contested x uncontested. A única quantificação é a simulação do TFTSense (4.1). Recomendação: tratar "contest" como custo de ouro (seção 2.3), não como probabilidade abstrata.

---

## 5. Rastrear bancos, vendas e compras dos rivais

O que as fontes dizem (nenhuma fonte de pro detalhou um método sistemático; achei só guias):

- É **contagem manual**: partir do tamanho da pool, subtrair o que você tem e o que vê em tabuleiros **e bancos** (tft.ninja, Mobafire). A mesma leitura aparece na descrição de Mobalytics: contar quantos inimigos têm as unidades e quantas cada um tem.
- **Bancos importam** (Mobalytics, Boosteria, ElbroC): um erro frequente é ignorar bancos; o rival pode estar segurando pares/cópias fora do tabuleiro.
- **Cópias nas lojas dos rivais não são visíveis** a você [limitação, não achei nada que diga o contrário]. **Hipótese minha (conhecimento de jogo, não achei fonte):** unidades mostradas numa loja saem temporariamente da pool até a loja ser atualizada.
- Quanto ao **ouro**: "50+ ouro em nível alto = rolldown iminente" (Metabot). Isso permite prever quem vai drenar a pool no próximo turno.
- Vendas: unidades vendidas (e jogadores eliminados) devolvem cópias à pool; unidade que usa duplicador devolve apenas 1 cópia (guia esports.gg Set 11 - antigo; confirmar). Em TFT Ninja pivoting: "unidades vendidas devolvem os itens ao banco" (bench de itens), e o guia tem inconsistência sobre valor de venda [DISPUTA].
- **Eliminações**: tabuleiro e banco voltam imediatamente (tft.ninja pool-math). Sinal para commit: "cópias voltando de um jogador que segurava muitas do seu carry" (TFT Ninja). Mais cópias devolvidas = "rolar nível 8/9 no 4-7 ou 5-1 é mais generoso do que os números iniciais sugerem".
- **Ferramentas**: não encontrei overlay oficial que rastreie compras dos rivais. Mobalytics oferece "TFT Overlay" (não verifiquei se mostra pool). O guia Set 14 da turboboost recomenda rastrear unidades contestadas e "olhar o banco dos oponentes antes de commit".

---

## 6. Flexibilidade e pivô

### 6.1 Hard force vs flex

- **TFT Ninja (atualizado 2026-03-31, https://tft.ninja/guides/team-comps/flex-vs-forced)**: Force = decidir antes/cedo e comprometer-se; prós: plano claro, maestria por repetição, decisões rápidas; contras: outros podem forçar a mesma; dependência de itens. Flex = comp final pode não ficar definida até estágio 3-4; prós: melhor encaixe itens/carry, menos contestado; contras: exige conhecimento amplo, paralisia, board mediano. "Soft-force" (iniciante): 2-3 comps conhecidas, casar itens/augments com a que encaixa e **"até o estágio 3 comprometa-se com uma"**. **Commit cedo** quando: carry forte cedo com bons itens, augment que favorece claramente uma comp, ou ninguém joga sua comp. **Fique aberto** quando: itens ambíguos, augments genéricos, ou vários contestam sua comp.
- **Metabot veredito** [OPINIÃO]: iniciantes devem forçar 1-2 comps (mas escoutar sempre); quem sobe do meio do elo deve flexar fora de contest.
- **Dishsoap "hard-force"** (Tacter, Set antigo; **a página deu 404, só vi o trecho da busca**): plano = escoutar por volta do estágio 3; se não contestado, ir para Thresh 3 e Aphelios 3; se contestado, subir de nível, fast 8/9 e ir ao board final. Ou seja: _forçar com plano B embutido_, não flex puro. URL: https://www.tacter.com/tft/guides/dishsoap-hard-forced-this-comp-to-be-the-first-challenger-in-na-a9319c13 [fonte não lida integralmente; baixa confiança]
- **Mobalytics "flex"** (via snippet): construir cedo/meio em torno das unidades 2★ que achar e **transicionar no rolldown do nível 8 para o melhor encaixe**. Bamboo: boards iniciais são mais "item holders e pistas de direção" que a comp final; trocar de plano a cada rodada arruína a economia.
- "Play the highest value board" / "flex early, commit late": a expressão literal não apareceu em fonte de pro que eu pude ler; o conteúdo equivalente está em Metabot ("early: strongest board available, don't marry a comp on turn one"), Mobalytics (flex) e TFT Ninja ("play the strongest board with what you hit; don't commit before stage 3"). **[CONSENSO de guias, sem atribuição a pro específico]**

### 6.2 Quando e como pivotar

Fonte principal: TFT Ninja Pivoting (2026-03-31, https://tft.ninja/guides/strategy/pivoting) + Metabot + TFTSense study hall (snippets).

- **Gatilhos**: contest pesado onde você está atrás em cópias/itens; carry 2★ ou sem contest inesperado; augment que favorece outra linha; itens que servem melhor a outro carry.
- **Janela**: "não comprometa antes do estágio 3"; **ideal: estágios 3-4**, durante/em torno de um rolldown de level-up; **estágio 5 é tarde demais** ("pivôs tardios raramente funcionam").
- **Execução**: pivotar **de posição econômica forte**; trocar **1-2 unidades por vez**; manter frontline; itens num holder temporário; **vender cópias soltas primeiro, manter pares que servem ao novo plano**; priorizar itens genéricos (AD/AP) que transferem.
- **Custos**: ouro gasto em rolagens para unidades vendidas, rodadas na linha antiga parcialmente perdidas, **queda temporária de força que pode custar HP**, falta de familiaridade.
- **Erros**: pivotar cedo demais por contest leve (um jogador com algumas cópias); pivotar tarde (vender 2★ por 1★ sem ouro); **vender o board inteiro com 10 ouro e tentar reconstruir**; vender pares úteis; pivô impulsivo.
- Metabot: pivô real é **planejado um estágio antes**; "panic sell em 10 HP no bottom 4 é flailing, não flex"; "não pivote em tilt: perder uma ou duas rodadas não é motivo"; pergunte se o scout mostra _lane morta_ ou se você só está frustrado.
- Esports.gg (Set 3/4, **muito antigo** - princípio): comprar algumas unidades extras que sirvam a **dois** planos (ex.: ao ver Malzahar para Mutant, pegue Arcanists também) mesmo com custo de economia, para poder pivotar se o rival contestador ficar à frente.
- Itens: guias recomendam **segurar componentes na bancada** nas primeiras passagens de scouting, montar cedo um primeiro item defensivo universal (Bramble Vest, Warmog's) e **atrasar itens ofensivos** até ler o lobby, "porque o slam compromete" (Metabot, TFT Ninja). Pivô fácil = outra comp **com perfil de dano/itens parecido e menos contestada**.
- Pivô tardio: "gastar ouro para pivotar tarde" só com economia forte (Mobalytics via snippet: "se você tem economia forte, pode fazer os pivôs/transições mais difíceis").

---

## 7. Valor de peças de 4/5 custo, 3★ de 4 custo e hyperroll

- Valor depende de **cópias livres**, não só do poder da unidade. Cópias livres do alvo = 10 - minhas - dos rivais (4c). Com ≥7 livres e nível 8: 2★ em ~56-78 ouro (mediana) [CALC]; com ≤4 livres: ≥150 ouro mediana → "mathematically unrollable" no sentido prático (TFT Ninja Set 17: "um 4 custo muito contestado vira matematicamente inrolável" - citado em busca).
- **5 custos**: 90 cópias na tier inteira, 9 por campeão; ~27 ouro/cópia só no nível 9 e ~16 no 10 (tier cheia); no nível 8 (3%) é ~133 ouro/cópia - hit de 5 custo em nível 8 é sorte. Com ≤3 cópias restantes: ficar em 1★ (TFT Ninja).
- **Poucos jogadores no 4/5 custo = valor de 4/5 sobe**: tier de 4 custo tem 140 cópias; se a maioria dos rivais está em reroll de 1-3 custo (como o meta atual do Set 18, "3-cost reroll muito prevalente"), quase ninguém consome a tier 4/5. **[inferência minha a partir da fórmula e do meta descrito pelo BunnyMuffins]**. Fast 8/9 (Aphelios Flex, Draven, Dragon, Ashe) disputa a tier 4/5 entre si; por isso a lista de pivôs entre fast 9 (Draven↔Aphelios etc.).
- **3★ de 4 custo**: 9 de 10 cópias; só se quase ninguém no lobby tocar no campeão (TFT Ninja: "presente"). Não é plano; se acontecer, é fruto de lane totalmente livre + alto nível.
- **Hyperroll** (gastar tudo): guias dizem que quase sempre mira **3★ de 1 custo** ("pool mais funda"): hyper roll nível 4-5 de 1 custo; slow roll 1 custo seguro nível 6; 2 custo nível 6-7; 3 custo nível 7-8 (Metabot); HP >60 com board real ok, ~20 HP coin flip. **3★ de 1 custo é realista mesmo contestado** (21 cópias sobram), 2 custo "realista se commitado cedo", 3 custo "um ou dois contestadores podem impedir" (TFT Ninja).
- **Exemplo Set 18 (guia Azir Reroll, tftflow, patch 18.4, 3 custo)**: nível 4 se board forte; 5 salvo 3 derrotas seguidas; 6 salvo se ficar abaixo de 30 ouro; ficar no 6 a não ser que dê para segurar 50+ no 7 (ou <40 HP e 30+); nível 7 e rolar até board "quase tudo upgradado", **nunca abaixo de 10 ouro**; slow roll a 50 até 5-1; abaixo de ~25 HP rolar até 3★; só greed acima de ~60 HP; se acertar, nível 8; senão fica no 7. https://tftflow.com/composition/set18/azir-reroll (sem regra formal de scouting; só "escoute cedo").

---

## 8. Erros típicos de quem não faz scouting (agregado) [CONSENSO]

1. **Escoutar só o próprio carry** e ignorar bancos, itens, augments, ouro e nível dos rivais (Boosteria, Mobalytics).
2. **Escoutar tarde ou só ao perder HP** ("só quando restam 2 jogadores" - guias; Boosteria "esperar dois jogadores terem o seu board final é tarde demais").
3. **Fixar a comp no primeiro carousel e queimar todos os itens nela** e descobrir no estágio 4 que 2 rivais queriam o mesmo (guias via busca).
4. **Rolar o rolldown (30+ ouro) sem re-escoutar** (Metabot).
5. **Panic-pivot do tabuleiro inteiro**, vender o board com 10 ouro; pivotar por frustração (TFT Ninja, Metabot, Boosteria).
6. **Tratar toda sobreposição como fatal** (Boosteria, TFTSense, Mobalytics): uma cópia ou um rival não é motivo.
7. **Não escoutar posicionamento** do adversário da próxima rodada (ElbroC) e, mais amplamente, não adaptar o tabuleiro à composição do lobby (ex.: AP majoritário → itens defensivos mágicos).
8. **Não olhar tempo do lobby**: rolar por causa de "pânico" quando o lobby está pobre (ElbroC) ou economizar quando o lobby está acelerando (Boosteria: "role quando você está mais fraco que o esperado ou o lobby acelera").

---

## 9. Exemplos de elite

- **ElbroC (3.1)**: o exemplo do 3-2: decidir entre rolar 10-20 ou poupar lendo o tempo do lobby; exemplos de 5/7 em AP e Brawlers/rerolls.
- **Powder (3.3)**: regras de leitura de sinais e foco em jogadores indecisos.
- **EWC 2026 (Esports World Cup, Paris, 4v4; Team Vision 3-0 Aurora Gaming; MVP Flancy; data 2026-07-25/26)**: apenas contexto de formato - no 4v4 os companheiros podem proteger um jogador, "permitindo mais risco para um board de teto alto"; o vencedor falou em "eliminar todas as formas de perder" e em estudar o adversário por scrims. https://www.hotspawn.com/other/news/tft-esports-world-cup-final . **Não é contest/pool** e o formato não é o lobby solo de 8; baixa relevância direta.
- **Não consegui** exemplos de partidas de Worlds/Set 17-18 com raciocínio de contest/pivô por jogador (Setsuko, k3soju, Dishsoap, Frodan, Mortdog); os resultados de busca eram títulos de vídeos sem transcrição. Melhor via para o orquestrador/usuário: assistir VODs e extrair manualmente.

---

## 10. Regras de decisão acionáveis

Formato: SE condição ENTÃO ação PORQUE razão [fonte/tipo].

R1. SE vou rolar 30+ ouro (rolldown) ENTÃO varrer os 7 tabuleiros antes e recontar cópias do alvo PORQUE contest forte enfraquece o rolldown e um rival com 50+ ouro pode puxar cópias antes de mim [Metabot, Mobalytics, CONSENSO].
R2. SE terminou uma rodada PvE ou escolhi um aprimoramento ENTÃO fazer varredura de comps (unidades + banco + itens completos + augments) PORQUE é aí que os rivais mudam de plano e fazem rolldown [ElbroC, elite].
R3. SE o Carousel está em andamento ENTÃO usar para ciclar os tabuleiros PORQUE não dá para agir no seu [ElbroC].
R4. SE 0 ou 1 rival tem o meu carry (e as cópias dele ≤ 2★ parcial) ENTÃO commit e rolar normalmente PORQUE ambos podem acertar [Metabot/TFTSense, CONSENSO fraco].
R5. SE 2 rivais têm meu carry ENTÃO só continuar se meu banco/cópias + itens + ouro forem maiores que os deles, senão preparar plano B com itens transferíveis PORQUE a pool de 4 custo (10) só suporta ~1 2★ extra [Metabot, TFTSense, TFT Ninja].
R6. SE ≥3 tabuleiros seguram o mesmo 4 custo (ou cópias restantes do alvo ≤ 5) ENTÃO pivotar para 4 custo sem contest ou fast 8, mantendo itens genéricos PORQUE ≤5 cópias dá ~5,5%/rolagem no nível 8, mediana ≥150 ouro para 2★ [TFT Ninja pool-math; CALC].
R7. SE cópias restantes de 5 custo alvo ≤ 3 ENTÃO aceitar 1★ ou trocar de carry PORQUE 2★ vira inviável [TFT Ninja].
R8. SE gastei ≥40 ouro rolando sem achar o alvo ENTÃO escoutar antes de gastar mais PORQUE provavelmente a pool está drenada [TFT Ninja; Metabot "um estágio rolando sem nada"].
R9. SE vou rerrolar 1-3 custo (hyper ou slow) ENTÃO exigir confirmação "ninguém mais tem o carry" no 2-x e de novo no estágio 3 antes de passar de nível PORQUE reroll contestado quebra (Kha'Zix: sem cópia em 2-1/2-3 ou 3 → linha impossível) [BunnyMuffins/tftflow; Metabot; guia antigo "2-5"].
R10. SE o lobby tem rivais com ≥3 mesmos reroll de 1 custo ENTÃO mesmo assim 3★ de 1 custo ainda é possível (21 cópias sobram), mas 3 custo com 1-2 contestadores é "desafiador" PORQUE 18 cópias - 9 = 9 [TFT Ninja pool-math].
R11. SE ainda é < estágio 3 (3-1 a 3-2) ENTÃO não gastar item ofensivo grande nem vender para comprometer; segurar componentes, montar item defensivo universal PORQUE slam compromete e a leitura de contest só fecha no 2º estágio de combate [Metabot, TFT Ninja].
R12. SE decidir pivotar ENTÃO fazer em 3-x/4-x, junto de level-up/rolldown, com ouro, trocando 1-2 unidades por vez; vender singles primeiro e manter pares compatíveis PORQUE pivô tardio no estágio 5 raramente funciona e pivô de pânico custa mais [TFT Ninja, Metabot].
R13. SE estou em baixo HP (≈10) e bottom 4 sem plano ENTÃO não vender board inteiro; estabilizar com o que tenho PORQUE vender tudo com ~10 ouro é erro clássico [TFT Ninja, Metabot].
R14. SE um rival que segura cópias do meu alvo é eliminado ENTÃO recontar a pool e favorecer commit/rolldown no 4-7/5-1 PORQUE as cópias voltam imediatamente e dobram/triplicam as odds [TFT Ninja].
R15. SE o lobby está poupando, com boards fracos e economia saudável ENTÃO poupar (não rolar por pânico); SE vários sobem para nível 7 agressivamente ou têm augments de combate e 1★ itemizados ENTÃO rolar mais cedo PORQUE tempo do lobby define quanto você precisa gastar [ElbroC, elite; Boosteria].
R16. SE um rival tem item completo de carry num placeholder ENTÃO classificá-lo como "committed" na linha desse carry mesmo sem o carry no board PORQUE o holder revela o plano [Metabot, Powder 2025 sobre itens-chave].
R17. SE duas comps têm perfil de dano e itens parecidos e uma é menos contestada ENTÃO mover os itens para ela PORQUE pivô com itens transferíveis é o mais barato [TFTSense study hall/Mobalytics snippets].
R18. SE o lobby está majoritariamente em reroll de 1-3 custo ENTÃO considerar fast 8/9 com 4/5 custo (tier 4/5 menos disputada) e vice-versa SE vários são fast 9 ENTÃO preferir reroll com linha livre PORQUE contest se concentra na tier que os outros compram [inferência minha, baseada em fórmula de pool + meta 18.4].
R19. SE tenho opção de comprar uma cópia que me serve e que o rival precisa (par de 2★) ENTÃO comprar mesmo que não seja essencial quando o custo for baixo PORQUE segurar cópias do rival atrasa o 2★/3★ dele (denial) [Metabot, turboboost "buy contested units to deny", opinião fraca].

---

## 11. Como isso se aplicaria a um assistente de decisão

Dados necessários (e se um leitor de tela/LCU consegue obter):

| Regra           | Dados necessários                                                                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1-R3, R15      | Fase/estágio atual, saída de PvE/augment (eventos), nível e ouro de cada rival, estrelas das unidades, número de unidades, lista de augments de cada rival, lista de eventos "jogador X subiu nível / 2★ / 3★"                                                                         |
| R4-R8, R10, R14 | **Contagem de cópias por campeão em todos os tabuleiros e bancos** (7 rivais + seu), nível meu, ouro, tabela de odds do nível, tamanho da pool por custo (30/25/18/10/9), lista de jogadores eliminados e suas unidades antes de morrer, histórico de ouro gasto em rolagem no estágio |
| R9              | Quem tem o carry de reroll em 2-1/2-3; se o rival tem o campeão-chave; HP e ouro                                                                                                                                                                                                       |
| R11-R13, R17    | Itens meus (componentes e prontos), augments, HP, banco, ouro, itens de cada rival por unidade (holders), tabela de perfis de dano/itens por comp                                                                                                                                      |
| R16             | Itens completos num placeholder em cada rival                                                                                                                                                                                                                                          |
| R18-R19         | Distribuição de rivais por tipo de comp (reroll vs fast 9) e pool de 4/5 custo                                                                                                                                                                                                         |

Pontos críticos de implementação:

- **Fórmula** `P(slot) = P(custo|nível) x cópias_alvo / cópias_tier` precisa do numerador e do denominador reais. Contar só tabuleiros (sem bancos) subestima contest.
- **Lojas dos rivais são invisíveis**; trate "cópias restantes" como estimativa com intervalo, não valor exato, e exiba o nível de certeza (observado/inferido/desconhecido).
- **Limiares da UI**: avisar "contest" quando cópias_restantes_do_alvo ≤ 5 (4 custo) ou ≤ 3 (5 custo); avisar "pivô" quando ≥3 rivais mostram o mesmo carry; avisar "rolagem arriscada" quando custo esperado por cópia > ~50 ouro ou gasto ≥40 ouro sem acerto.
- Dados **observados** (tabuleiros, bancos, itens, nível, ouro quando visível) devem ser rotulados separados de **inferidos** (comp final prevista, plano do rival) e **desconhecidos** (lojas, cópias não vistas).
- Considerar também a janela de tempo: janelas de scouting (pós-PvE, pós-augment, Carousel, pré-rolldown) como gatilhos para atualizar a leitura do lobby no assistente.

---

## 12. Lacunas

- Sem transcrições de pros (Mortdog, Dishsoap, k3soju, Setsuko, Frodan, Robinsongz, Milk, Kiyoon, LS...).
- Sem Reddit (domínio bloqueado) e sem Mobalytics/esports.gg/Bamboo (403/429); usei apenas snippets desses.
- Sem dados medidos de placement contestado x não contestado e sem frequência real de 3★ de 4 custo no Set 18 (só uma simulação comercial não auditável).
- Não verifiquei em jogo quais campos de rival (ouro, banco, itens, augments) são visíveis no Set 18 (dependem do patch e da UI Unreal); informação veio de wiki de comunidade e guias.
- Sem confirmação se as "lojas dos rivais" removem cópias da pool temporariamente.
- Wisps e Carousel novo podem alterar contest (coleta de unidades/itens); não encontrei patch notes detalhados.
- Os números do Set 18 vêm de sites terceiros (concordantes, mas não oficiais); confirmar com o jogo/Riot.

## Fontes (URL, data)

- ElbroC, https://elbroc.substack.com/p/how-to-scout-like-a-top-player-in-tft-65b63b93b273 (2023-05-22)
- Powder, https://note.com/jgdpwp281/n/n37c8bfc1392a (2025-04-24)
- TFT Ninja pool math Set 18, https://tft.ninja/guides/advanced/pool-math (2026-09-25); champion pool, https://tft.ninja/guides/game-mechanics/champions/champion-pool ; flex vs forced, https://tft.ninja/guides/team-comps/flex-vs-forced (2026-03-31); pivoting, https://tft.ninja/guides/strategy/pivoting (2026-03-31)
- Metabot scouting, https://metabot.gg/en/TFT/guides/tft-scouting-flexible-vs-forcing-comps (2026-07-28/10-05); slow vs hyper roll, https://metabot.gg/en/TFT/guides/tft-slow-roll-vs-hyper-roll ; star levels, https://metabot.gg/en/TFT/guides/tft-star-levels-champion-pool-explained
- TFTSense pool/odds, https://tftsense.gg/study-hall/tft-champion-pool-and-odds/ ; why everyone plays same comp, https://tftsense.gg/study-hall/why-everyone-plays-the-same-comp-tft/ (2026-07-12)
- Seemeta odds, https://seemeta.com/en/tft/set-18/odds
- GGClan traits, https://ggclan.com/news/tft-set-18-traits-guide-force-or-pivot (2026-08-28)
- Boosteria, https://boosteria.org/guides/tft-scouting-guide-read-lobby-pivot-without-panic (2026-03-28)
- BunnyMuffins meta 18.4, https://bunnymuffins.lol/meta/ ; tftflow Azir reroll, https://tftflow.com/composition/set18/azir-reroll
- Turboboost Set 14 pool, https://turboboost.gg/article/tft-champion-pool-set-14 (2025-07-24)
- Hotspawn EWC final, https://www.hotspawn.com/other/news/tft-esports-world-cup-final (2026-07)
- Liquipedia Patch TFT18.1, https://liquipedia.net/tft/Patch_TFT18.1
- Tacter (Dishsoap hard force; só snippet), https://www.tacter.com/tft/guides/dishsoap-hard-forced-this-comp-to-be-the-first-challenger-in-na-a9319c13
- Mobalytics (só snippets, 403): https://mobalytics.gg/blog/how-to-improve-scouting-tft/ ; https://mobalytics.gg/blog/tft/tft-how-to-pivot-your-comp-and-transition/ ; https://mobalytics.gg/blog/tft/tft-commit-tft-team-comp/
- Cálculos: script em `C:\Users\Hugo\AppData\Local\Temp\claude\...\scratchpad\pool.py` (não commitado)
