# 06 - Fóruns, erros comuns e modelos mentais de decisão (TFT)

Pesquisa feita em 2026-10-10. Set atual: **Set 18 "Enchanted Wilds"** (lançamento global 25/26-ago-2026; patch 18.4 ao vivo desde 07-out-2026, segundo esports.gg e Seemeta; mecânica central: Wisps). Pesquisa em inglês, notas em português.

## 0. Limites desta pesquisa (leia antes)

- **Reddit (r/CompetitiveTFT, r/TeamfightTactics) NÃO foi acessível.** O WebFetch bloqueia reddit.com e o WebSearch recusa o domínio. Nenhuma thread do Reddit foi lida; **não há contagem de upvotes nem comentários de jogadores de rank alto** neste arquivo. Não contornei o bloqueio. Quem quiser esse ângulo precisa colar o texto das threads.
- **Transcrições de YouTube/Twitch (Dishsoap, Setsuko, k3soju, Frodan etc.) não foram acessíveis.** Só achei a página de um vídeo (sem texto). Nada aqui é citação direta desses jogadores.
- **Discord**: nada público encontrado.
- A maior parte do material vem de **sites de guias** (TFT Ninja, MetaBot, Boosteria, Goboost, Dignitas, VoidS1n, NoxuTFT, BunnyMuffins), vários deles **comerciais** (venda de boosting, overlay ou coaching). Isso é opinião de guia, não dado de ladder. Marquei a qualidade de cada fonte.
- Não encontrei **nenhum dado medido** de avg placement / top 4% de Challenger vs. Diamond, nem estudo de EV de colocação. O que existe são heurísticas.
- Muitos guias atribuem regras a "Challengers" sem nomear ninguém. Tratei como **opinião não verificada**.

Legenda dos tipos: **[FATO]** regra oficial/mecânica verificável; **[CONSENSO]** várias fontes independentes concordam; **[OPINIÃO]** uma fonte/jogador; **[DISPUTA]** fontes discordam; **[INFERÊNCIA]** conta ou dedução minha.

---

## 1. Resumo executivo

1. **A estrutura de LP favorece consistência, mas não proíbe risco.** Oficial (Riot): 4º ou melhor nunca perde LP; 5º ou pior nunca ganha LP [FATO]. A tabela do TFT Ninja coloca 8º ≈ -35 a -50 e 1º ≈ +35 a +45, ou seja, **um 8º apaga ~2-3 top 4** [OPINIÃO de site, valores aproximados]. Média de colocação de equilíbrio ≈ 4,5 [INFERÊNCIA/CONSENSO].
2. **O erro nº1 repetido em todas as fontes é econômico sem objetivo**: rolar sem alvo ("donk-roll"), ficar com ouro demais perdendo luta que precisava ganhar, e subir de nível sem tabuleiro que sustente [CONSENSO].
3. **Há uma disputa real e atual sobre "interest vs. board forte".** Guias clássicos: chegue a 50 de ouro. dpei (Masters+, via resumo do TFT Ninja, Set 17): "interest tem teto de +5; vitória e streak compõem mais; quem só busca juros cai num _poverty loop_". Japonês うえさか e Goboost: quebre os juros para manter o tabuleiro forte [DISPUTA/tendência].
4. **HP é o relógio.** O modelo mais útil e quantitativo: pensar em **"quantas derrotas ainda aguento"** = HP / dano por derrota do estágio (Set 18: dano = base do estágio + unidades inimigas sobreviventes; base 8 no estágio 4, 10 no 5, 12 no 6, 17 no 7+) [FATO via TFT Ninja, patch 18.1].
5. **Escolha entre "jogar pro top 4" e "jogar pra ganhar" é função de: HP, força relativa do tabuleiro, lobby (tempo) e contestação.** Consenso: com HP < ~30-40 e tabuleiro mediano, jogue pro top 4; só force o 1º com o tabuleiro mais forte do lobby e recursos sobrando. Mas a comunidade de guias também alerta que **jogar sempre seguro deixa LP na mesa** (VoidS1n, Boostroyal) [CONSENSO com ressalva].
6. **Scout é o diferencial recorrente citado para Diamond->Challenger**: comp, posicionamento e _força relativa/tempo do lobby_ (ElbroC, que se apresenta como Challenger; "o tipo mais avançado e mais valioso no topo") [OPINIÃO de jogador de topo + CONSENSO de guias].
7. **Reposicionar a cada rodada, olhando o log de dano**, é citado como hábito de topo (GG Clan, resumo de vídeo de um Challenger coreano não nomeado; Mobalytics/Grandmaster) [OPINIÃO, baixa verificabilidade].
8. **Revisão de partida**: blocos de 10-20 jogos, métricas (avg placement, top4%, bottom4%, "morri com ouro/greed no banco"), revisar derrotas em que a decisão era evitável, 1-2 erros recorrentes por sessão; "2-3 partidas focadas valem mais que 10 no automático" [CONSENSO fraco: sites de guia].
9. **Psicologia**: julgar a decisão pelo processo, não pelo resultado; parar após 2-3 bottom 4 seguidos; sessões curtas [CONSENSO].
10. **Set 18 específico**: Wisps são decisão de compra, não automática; durante um roll-down comprometido, Wisp não está no alvo; Wisp condicional que obriga a entortar o tabuleiro é armadilha [OPINIÃO de guias].

---

## 2. Qualidade das fontes usadas

| Fonte                                                    | Autor/credencial                                                                                                                                                  | Data                                       | Qualidade                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| TFT Ninja (guias + resumos de dpei) tft.ninja            | Autor do site não nomeado; "não endossado pela Riot"; resumos de vídeos do criador dpei (rank não declarado na página; usa exemplos de partida "Road to Masters") | atualizado set/out-2026 (Set 18)           | Boa estrutura e números consistentes com outras fontes; mas opinião secundária |
| ElbroC (elbroc.substack.com)                             | Louis Corbel; escreve como jogador Challenger/analista                                                                                                            | 22-mai-2023; 18-set-2023                   | Alta para raciocínio; **antigo (Set 9.x)**, princípio atemporal                |
| Riot Support, Ranked FAQ                                 | Oficial                                                                                                                                                           | 10-mar-2026 (página)                       | Alta (regras de LP)                                                            |
| Riot Prism, entrevista Coralie                           | Primeira NA a Challenger no Set 4.5                                                                                                                               | 25-fev-2021                                | Antiga; só princípios                                                          |
| MetaBot.GG guias (scouting, slow roll, erros)            | autor não nomeado; promove app                                                                                                                                    | publicado jul-2026, atualizado 05-out-2026 | Média; genérico, bem alinhado ao Set 18                                        |
| Dignitas "Climbing like a Challenger"                    | Quazza                                                                                                                                                            | 04-out-2023 (Set 9.5)                      | Média; itens específicos do set são datados                                    |
| Dignitas "Review your replays"                           | EssentialG                                                                                                                                                        | 01-nov-2022                                | Média; método atemporal                                                        |
| VoidS1n "Stage 4 guide", "Economy basic"                 | sem data/autor na página; guias associados a coach de alto elo                                                                                                    | n/d (listado em "Set 18 info")             | Média                                                                          |
| BunnyMuffins (bunnymuffins.lol)                          | Autor afirma Challenger duas contas no Set 1 e Masters/GM no Set 2, "não sou pro"                                                                                 | patch 18.3b                                | Média; autodeclarado                                                           |
| NoxuTFT guide                                            | vende overlay                                                                                                                                                     | sem data                                   | Baixa-média (comercial)                                                        |
| Boosteria, Goboost, RankForge, ImmortalBoost, BoostRoyal | **sites de boosting**                                                                                                                                             | 2025-2026                                  | **Baixa**: usar só como indício; números de LP discordam entre si              |
| うえさか (note.com)                                      | sem rank declarado                                                                                                                                                | 11-mar-2026                                | Baixa-média; ideia clara de "economia não gananciosa"                          |
| GG Clan (positioning)                                    | resumo de vídeo de Challenger coreano **não nomeado**, site de coaching                                                                                           | 10-set-2026                                | Baixa; não verificável                                                         |

---

## 3. Achados por subtema

### 3.1 Erros mais comuns (e a correção)

Lista consolidada. Cada item: erro -> correção -> fontes.

1. **Donk-roll (rolar sem alvo/depois de uma rodada ruim).** Correção: rolar só com um alvo nomeado ("par de frontline"), parar quando atingir; nunca rolar até 0 num tabuleiro perdedor. MetaBot (set 18, 05-out-2026) [OPINIÃO/CONSENSO]. TFT Ninja (rolling): "cada 2 de ouro gasto deve mirar um upgrade específico; ao gastar 20 sem achar nada, pare e reavalie" [OPINIÃO].
2. **Segurar ouro demais (hoard) e perder luta que precisava ganhar.** Correção: quebrar juros quando o tabuleiro não derrota "2-3 unidades por rodada" (うえさか, 11-mar-2026) [OPINIÃO]; TFT Ninja (tempo): "30 HP com 50 de ouro é pior que 60 HP com 20 de ouro" [OPINIÃO].
3. **Subir de nível sem tabuleiro que use os slots** (MetaBot) e **nível 9 sem ouro** que não ajuda tabuleiro em dificuldade (Mobalytics Set 18 via resumo de busca; página retornou 403, **não li o original**).
4. **Componentes parados no banco** por 3 estágios (MetaBot; Tacter/Frobei Set 11; Sullla). Correção: montar item imperfeito > nenhum [CONSENSO]. **Mas ver disputa 7.3** (dpei: só slame se ganha a rodada).
5. **Item no carry errado** (item bom em unidade que não chega ao late) (MetaBot). Dignitas: **3 itens no carry e 3 no tanque** antes de espalhar; não entregar 3 itens ao backliner sem frontline [OPINIÃO datada Set 9.5].
6. **Posicionamento "colocar e esquecer".** Correção: reposicionar toda rodada contra o próximo oponente; olhar log de dano; checklist ElbroC (acesso à backline, CC em área, itens como Zephyr/Shroud, posição do carry inimigo, tanque que prende seu carry) [OPINIÃO de jogador de topo; Set 9, princípio atemporal]. Set 18: divers citados pelo TFT Ninja são Kha'Zix e Rengar.
7. **Não scoutear / só scoutear no meio-fim do jogo.** ElbroC: scoutear posicionamento _antes de toda rodada_, inclusive cedo, melhora win streaks iniciais.
8. **Forçar comp às cegas quando 2-3 jogadores disputam as mesmas unidades** (MetaBot, TFT Ninja flex-vs-forced, Coralie/BunnyMuffins mostram o contraponto, ver 7.2).
9. **"Jogar para sobreviver"**: gastar a economia para segurar 5º quando o mesmo ouro competiria pelo 1º (MetaBot). Contraponto: ver 3.3.
10. **Pânico/tilt**: decisões emocionais após rodadas ruins (MetaBot, TFT Ninja mental).
11. **Jogar o endgame cedo demais**: pular as unidades do estágio atual, guardar itens para o carry futuro, perseguir traço. dpei (vídeo 09-mar-2026, resumo TFT Ninja): "jogue o _strongest board_ do estágio atual"; contrafactual dele: **-24 ouro e -20 HP no meio do estágio 5** por jogar para o endgame [OPINIÃO de criador; número é da partida dele, não geral].
12. **Fast 9 com HP baixo / tabuleiro ruim**: "tentar Fast 9 abaixo de 40 HP: você morre antes de montar o time" (Goboost, 05-jun-2026; Goboost 05-abr-2026); VoidS1n: HP > ~75 no 4-x como limiar aproximado para greed 9 [OPINIÃO, concordante].
13. **Rolar no nível 7 por 4-custos; segurar 60+ de ouro em 4-2; quebrar streak por ganho marginal de juros; forçar 4-custos disputados; roll-down em pânico abaixo de 30 HP** (TFT Ninja, 4-cost fast 8, lista de erros) [OPINIÃO].
14. **Overindex** (empilhar estatística que o comp já tem; itens/augments com efeito duplicado) (Dignitas, Set 9.5) [OPINIÃO datada].
15. **Set 18 / Wisps**: comprar toda Wisp automaticamente; comprar Wisp no meio do roll-down; entortar o tabuleiro para uma Wisp condicional (ex.: ouro se vencer o próximo combate = aposta quando o tabuleiro está mal) (NoxuTFT/Mobalytics via buscas; não li Mobalytics direto) [OPINIÃO, baixa-média].
16. **Over-greeding e under-greeding no estágio 4** (VoidS1n): over = segurar ouro em 4-1/4-2; under = rolar sempre que tem HP e ouro, perdendo níveis 9/10; "players que jogam para 3º-4º rolam muito no estágio 4 toda partida" [OPINIÃO de coach, citado como diferencial Diamond/Masters].

### 3.2 Modelos mentais de decisão

**A. HP como relógio ("quantas derrotas eu aguento")** [FATO + OPINIÃO]

- Fórmula do Set 18 (TFT Ninja, patch 18.1): `dano = dano_base_do_estágio + unidades inimigas sobreviventes (1 por unidade, independente da estrela)`.
- Base: E1: 0, E2: 2, E3: 5, E4: 8, E5: 10, E6: 12, E7+: 17. Faixa típica por derrota: E3: 9-12; E4: 13-16; E5: 16-19; E6: 19-22; E7+: 25-27+.
- Leitura do TFT Ninja: 60 HP no E4 ≈ 4 derrotas ("pode economizar e procurar upgrades"); 40 HP no E5 ≈ 2 ("estabilize já"); 25 HP no E6 ≈ 1; 15 HP no E7 ≈ fim.
- Regra de ouro derivada: **se aguenta 3+ derrotas, economize/nivele; se 1-2, role agora** [OPINIÃO, coerente entre TFT Ninja e Dignitas].

**B. Tempo (tempo do lobby)** [OPINIÃO, TFT Ninja "Tempo & Pacing"]

- Tempo = ritmo em que o lobby ganha poder e elimina jogadores; é _relativo_ aos outros 7.
- **Lobby rápido**: vários abaixo de 50 HP antes do E4; vários no nível 7 no E3; qualquer eliminação antes do E5 (2+ antes de 5-1 = "muito rápido"); maioria com carries 2★ completos no E3; vários com <20 de ouro após roll-down em 3-2/4-1. Resposta: estabilizar cedo (3-2 ou 4-1), nivelar no ritmo, não fazer slow roll acima de 50 (cada derrota custa 10+).
- **Lobby lento**: maioria >70 HP entrando no E4; vários com 50+ de ouro; todos vivos em 5-1. Resposta: priorizar juros, atrasar roll para odds melhores (3-custo: nível 7 em 4-1; 4-custo: nível 8 em 4-1/4-2 ou 4-5/5-1), segurar componentes.
- ElbroC chama a leitura de "força relativa/tempo" de **o tipo mais avançado e valioso de scouting no topo**; exemplo: em 3-2 com tabuleiro fraco, role 10-20 ou economize? Se o scout mostra que ninguém está rolando e todos têm economia saudável, **economizar é melhor**; rolar sem scoutear pode atrasar a economia por pouco ganho de HP. Passivamente: a lista de jogadores à direita avisa quando alguém sobe de nível ou faz 2★/3★; ciclar boards durante carrossel [OPINIÃO de jogador de topo, 22-mai-2023].

**C. "Strongest board" e o ciclo ouro-tabuleiro** (dpei via TFT Ninja, Set 17, março 2026) [OPINIÃO de criador; DISPUTA parcial, ver 7.1]

- Ouro não faz ouro sozinho: juros têm teto (+5); vitórias (+1) e streaks (+1 a +3) compõem; tabuleiro forte -> vitória -> ouro e HP -> mais tabuleiro. O oposto é o **poverty loop**: tabuleiro fraco -> derrotas -> HP/ouro baixos.
- Causas citadas do poverty loop: guardar pares-chave "caso mude", pular unidades para "ficar aberto", desperdiçar os 5 refreshes grátis do E2, ficar fraco de propósito para streakar.
- As **5 perguntas recorrentes**: (1) qual meu strongest board agora? (2) qual meu "next in" (a unidade mais barata que melhora o board)? (3) preciso slamar este item agora? (4) vale nivelar aqui? (5) estou streakando e o que mantém?
- Item: dar o componente a quem vai segurá-lo nas próximas 3-5 rodadas, não ao carry do endgame a dois estágios; não quebrar win streak para destravar traço (destravar em rodada neutra).
- Ordem de avaliação do board (TFT Ninja "Strongest Board"): 1) estrela, 2) estatística, 3) traço, 4) itens. Um 2★ sem sinergia vence 1★ que completa traço.

**D. Processo vs. resultado / variância** [CONSENSO]

- TFT Ninja (mental): teste central: "tomei a melhor decisão com a informação que tinha?" Decisão certa com resultado ruim continua certa. Rank após ~10 jogos quase não significa nada; após ~200, é medida melhor.
- dpei (resumo): "não é importante chegar à conclusão certa; importante é fazer as perguntas certas."
- Mavericks Invitational (via busca; domínio falhou no fetch, **não li**): comparação com poker e blocos de 3-5 jogos.

**E. Calculated loss / loss streak só com plano** [DISPUTA; ver 7.1]

- dpei: só vale se você responde três perguntas: quando vai rolar, qual é seu spike (quais unidades em que custo completam o comp) e quando exatamente o streak termina. Benefício principal: prioridade no carrossel; comps de reroll convertem bem em um roll grande no E3.
- BunnyMuffins (Set 18, patch 18.3b): loss streak "não é ótimo" neste patch, sem caminho confiável para "capar" com ele; planos confiáveis de abertura fraca: augment de economia em 2-1, estabilização dura no E4 com condição (emblemas ou linha Solar) e jogar pro top 4, ou augment direcional forte em 3-2. Misturar streak.

### 3.3 "Top 4 vs. primeiro" (gestão de risco)

- **Mecânica oficial**: sem série de promoção; 100 LP promove com sobra; só desce de divisão em 0 LP com 5º ou pior; Master+ desce a Diamond I se LP < 0; decay em Master+: banco de até 14 jogos, -1 por dia; sem jogos, perde 50/150/250 LP por dia (Master/GM/Challenger) [FATO, Riot Support FAQ, 10-mar-2026]. Cortes de GM/Challenger são por LP e vagas (snapshot não confirmado: Challenger ≥ 500 LP e top 250; GM ≥ 200 LP e top 750 [OPINIÃO, fonte secundária]).
- **Valores de LP por colocação não são oficiais.** TFT Ninja (06-out-2026): 1º +35 a +45; 2º +25 a +35; 3º +15 a +25; 4º +5 a +15; 5º -5 a -15; 6º -15 a -25; 7º -25 a -35; 8º -35 a -50. RankForge: de +60-90 (1º) a -70-90 (8º). ImmortalBoost: 1º 40-56. **Fontes discordam por fator 2; usar só como ordem de grandeza.** MMR acima do rank aumenta ganhos e reduz perdas; MMR abaixo faz o contrário [CONSENSO].
- **Conta de EV (INFERÊNCIA minha, com os pontos médios do TFT Ninja: +40, +30, +20, +10, -10, -20, -30, -42,5).** Distribuição uniforme dá ≈ -0,3 LP/jogo (≈ equilíbrio em avg 4,5). Exemplo "seguro" (1º 8%, 2º 12%, 3º 17%, 4º 20%, 5º 15%, 6º 12%, 7º 9%, 8º 7%; avg 4,29): ≈ +2,6 LP/jogo. Exemplo "alta variância" (1º 18%, 2º 12%, 3º 10%, 4º 8%, 5º 8%, 6º 10%, 7º 14%, 8º 20%; avg 4,62): ≈ -1,9 LP/jogo. Moral: **a perda de 7º/8º pesa tanto quanto os ganhos do 1º; reduzir bottom 2 é frequentemente mais valioso do que perseguir mais 1º** (Boosteria; Mobalytics via TFT Ninja "8º ≈ um 1º"). Não é um teorema: se o ganho de LP do 1º for bem maior que o de 2º-4º (como RankForge sugere), a conta inclina para risco.
- **Quando jogar pro top 4** [CONSENSO]: HP < ~30; tabuleiro funcional mas não o mais forte; promoção/risco de queda; contestado; lobby rápido. Ação: gastar ouro em upgrades 2★ imediatos, posicionar para vencer os mais fracos, deixar os mais fracos morrerem primeiro (TFT Ninja endgame + playing-from-behind).
- **Quando empurrar o 1º**: tabuleiro mais forte do lobby; 30-40+ HP e 30+ ouro; lobby reduzido a 3-4 jogadores; nível 9 se HP > 60, 50+ ouro e 8 estável (TFT Ninja endgame-decisions).
- **Contra-argumento sobre segurança**: VoidS1n: jogadores "seguros" deixam LP na mesa; tentar mais greed quando não há risco de queda (ex.: Masters 0 LP não cai). Boostroyal: Plat/Emerald com média ~4,5 e poucos 1º; sugere arriscar um 5º por chance de 1º quando não contestado (fonte de boosting) [OPINIÃO].
- **Para Masters** (VoidS1n): "saber quando você joga pro 1º/2º vs. 4º-7º" é a habilidade citada.

### 3.4 HP baixo e estabilização

- **Playing from behind** (TFT Ninja): estar atrás = HP na metade inferior do lobby (<50-60 no E3 ou <30-40 no E4), tabuleiro mais fraco que a maioria, derrotas > vitórias, e sem estar loss-streakando de propósito com 50+ de ouro. Passos: 1) estabilizar (força bruta > sinergia; itens completos já; parar de guardar componentes), 2) identificar "outs" realistas (outs que 3+ jogadores também precisam são pouco confiáveis), 3) **desperate rolling** com HP < ~20-30: gastar quase tudo, manter piso de 10-20 de ouro, 4) jogar pro top 4, 5) aceitar variância e revisar.
- Dignitas (Set 9.5): ao rolar manter ≥ 20 de ouro (recuperar de 20 a 50 é bem mais rápido que de 0); **exceção**: se a próxima derrota elimina, rolar até 0 pode garantir o 4º.
- Boosteria: "não role abaixo de 20 de ouro, exceto se for morrer (1-2 vidas), augment de baixa economia ou estratégia hyper roll"; tamanhos de roll por nível: N4-5: 0-10; N6: 10-30; N7: 20-40; N8: 50+ [OPINIÃO de site de boosting, internamente inconsistente quanto ao nível 7].
- Faixas de HP do TFT Ninja (4-cost fast 8): >50 com board jogável: priorize economia, roll-down pode esperar uma rodada; 30-50: comprometido, role no spike (4-2 ou 5-1); <30: gaste tudo. Alvo em 4-1: **60-85 HP**; acima disso "joga seguro demais", abaixo entra em roll forçado.
- うえさか: "abaixo de 60 HP você não pode mudar de estratégia duas vezes"; "perder pequeno": adicionar frontline, ajustar posição, equipar item em vez de forçar vitória que quebra o board; reduzir dano em ~5-8 por rodada.
- Setsuko (perfil esports.gg, via busca; **não li a matéria completa**): slama itens para salvar HP em vez de greedar componentes [OPINIÃO indireta].

### 3.5 "When to commit" (comp, nível, roll)

- **Comp**: comprometa por volta do estágio 3 (TFT Ninja pivoting/flex: "não se comprometa com endgame antes do E3"; janela ideal de pivô E3-E4, "no E5 pivôs raramente funcionam"). MetaBot: "um pivô real é planejado com um estágio de antecedência"; "saiba quem disputa o quê no segundo estágio de combate e então comprometa".
- **Contestação**: TFT Ninja pool-math (Set 18): 4-custo tem 10 cópias; com 3 outros jogadores na mesma unidade, odds ≈ 63% do não-contestado; com 5, 38%; com 7, 13% (conta do próprio site; ele mesmo avisa que um número de "5,5% por shop" não fecha, tratar com cautela). Sinais de pivô: 4-custo com ≤ 5 cópias restantes; 5-custo com ≤ 3; 40+ de ouro gasto sem achar cópia -> scoutear antes de gastar mais. 1 contestador: ~5 cópias realistas; 2+: pool praticamente vazio -> pivote (TFT Ninja, 4-cost). MetaBot: 3 ou mais no mesmo carry = pool seco.
- **Nível (padrão)**: N4 em 2-1 (quase sempre correto), N5 em 2-5, N6 em 3-2, N7 em 3-5/4-1, fast 8 em 4-1/4-2 com 30-50 de ouro sobrando, 8 padrão em 4-5/5-1; 9 só com HP > 60 (5-1) ou > 75 (4-1), 2★ no core e lobby sem tampar você [CONSENSO entre TFT Ninja, Goboost, Boosteria, VoidS1n].
- **Odds Set 18** (TFT Ninja): N7: 3-custo 43%, 4-custo 10%, 5-custo 1%; N8: 4-custo 30%, 5-custo 3%; N9: 4-custo 33%, 5-custo 15%; N10: 4-custo 40%, 5-custo 25%. 8→9 custa ~60-80 de ouro em XP; 56 XP de 7→8. Cópias: 1-custo 30, 2-custo 25, 3-custo 18, 4-custo 10, 5-custo 9.
- **Fast 8 vs. outras**: Fast 8 quando o comp depende de 4-custo, HP saudável, economia forte, lobby não também correndo ao 8; ruim com HP crítico, sem alvo 4-custo, ou vários economizando (pool disputado). Slow roll (segurar 50, rolar excesso) é o padrão de menor variância; hyper roll só com carry 1-custo, itens, pool livre e HP saudável (MetaBot: justificado acima de ~60 HP; "~20 HP é cara ou coroa que você provavelmente perde").
- Lobby check em 3-5 (Goboost): se 3+ oponentes têm augments de economia e preservam HP, esperam fast 8/9 -> evite greed; se o lobby gasta agressivo, não faça Fast 9, role no 8 para sobreviver.
- **Scout de 30+ ouro**: "o scout mais valioso é o imediatamente antes de gastar 30+" e jogador com 50+ ouro em nível alto = roll-down iminente (MetaBot) [OPINIÃO].

### 3.6 Checklists por estágio (consolidado de TFT Ninja Set 18; fontes: stage-by-stage e 4-cost fast 8, atualizados 06-out-2026) [OPINIÃO de site, números consistentes]

- **E1 (PvE)**: não gastar; coletar componentes; comprar pares fortes; 2-3 comps candidatos sem se comprometer.
- **E2**: N4 em 2-1; 10 de ouro até 2-4; melhor board disponível, sem forçar comp; escolher direção de streak (meio a meio é o pior para a economia); slamar itens completos só se win streak. Entrar em 3-1 com ~20.
- **E3**: N6 em 3-2 (custa ~8-12 de ouro); se HP < 60 em 3-2, role 10-20 para estabilizar; carry principal com itens até 3-4; scout para ver contestação; N7 em 3-5/4-1; bank para 50 em 4-1; identificar alvo 4-custo e checar contestação até 3-5.
- **4-1 (decisão-chave por HP/board)**: fraco (<50 HP ou perdendo): N7 e role 20-40; estável (50-70, ~metade): N7, role leve 10-20 e reconstrua; forte (70+, streakando): N7 e avalie, ou economize rumo ao 8. Fast 8 requer boa saúde e 50+ ouro entrando no E4; entrar 4-1 com 60-85 HP.
- **4-2 (roll-down fast 8)**: nível 8 com 30-50 sobrando (abaixo de 35 faltam rolls para acertar de forma confiável); prioridade 4-custo carry 2★, tanque principal 2★, 4-custo que completa traço; slamar itens completos agora.
- **E4 (4-3..4-7)**: estabilizar 2★ carry/frontline com itens e HP; rebancar 30-50 para 5-1; posicionar para o board real.
- **5-1**: N9 se HP > 60, core 2★ pronto e lobby não te passando; ficar no 8 com alvos 3★ de 4-custo; não subir com HP < 40 ou faltando peça 2★.
- **E5+**: finalizar comp até 5-2; 2★ no carry e suporte; posicionar contra os 3-4 mais fortes; gastar tudo no E6+.
- Pontos de scout (TFT Ninja): 3-1, 4-1, 5-1; antes de roll-down; antes do carrossel; com HP baixo.
- Resumo de ritmo de ElbroC: comp scout a partir de 2-1 e após cada augment/PvE; posição antes de toda rodada.

### 3.7 Hábitos de revisão de partida

- **Blocos de 10-20 jogos** com: avg placement, top 4%, bottom 4%, e "quantas vezes morri com greed no banco" (Boosteria, 14-mar-2026; NoxuTFT: "julgue por amostra, não por jogo") [OPINIÃO].
- **Qual jogo revisar**: jogos em que você achava que estava bem e perdeu, ou vice-versa (Mobalytics/Grandmaster via busca; SpencerTFT/Metafy: pular 1º e 8º) [OPINIÃO de coach].
- **Perguntas por estágio** (Dignitas/EssentialG, 2022): scoutei? considerei todos os boards possíveis e usei o melhor? posicionei para os próximos confrontos? Rever shops nos grandes roll-downs e quais comps foram ignorados; checar augment vs. dados de colocação (Tactics.tools); não "skim"; **2-3 jogos focados valem mais que 10 no automático**.
- **TFT Ninja (climbing tips)**: após cada sessão, examinar bottom 4: decisão ou azar? Poderia ter pivotado antes? Segurou ouro demais em vez de rolar? Slamou cedo demais ou esperou o item perfeito? Escolher 1-2 erros recorrentes por sessão.
- **Assistir VODs de quem está 2 tiers acima**, pausando no início de cada estágio e a cada refresh, decidindo antes de ver (BunnyMuffins, autodeclarado ex-Challenger/GM). Estuda ~3 jogadores, um por semana.
- **Cuidado ao ler estatísticas** (ElbroC, 18-set-2023): viés de sobrevivência (unidade aparece no fim em jogadores que já iam bem), variável omitida (o efeito é do traço/item, não da unidade), confirmação, publicação, **amostra** (filtre por elo: ex. um augment com +0,40 de diferença Master+ vs Gold+; "21 jogos" é pouco). Aplicável a qualquer assistente que use avg placement de augments/comps.

### 3.8 Psicologia (tilt, consistência)

- Sinais de tilt (TFT Ninja): culpar RNG a cada derrota, apressar rodadas, entrar na fila logo após derrota para "recuperar" LP, recusar pivô. Resposta: parar (~15 min, caminhada).
- Regras de parada: **2-3 bottom 4 seguidos** (TFT Ninja, mental e climbing tips); evitar sessões longas e jogar cansado; terminar a sessão após um bom jogo; "3 partidas focadas > 8 no automático".
- Sessões em "sets" (melhor de 3/5, para ao perder o set): MyBoosting (10-fev-2023) atribui a pros sem fonte [OPINIÃO não verificada]; Mavericks Invitational recomenda 3-5 jogos por bloco (não li a página).
- Consistência: ter plano pré-jogo (abertura, traços fortes do patch, metas de ouro/nível por estágio), uma nota por partida (The Game Haus, ago-2025, via busca; não li a página completa).
- Coralie (Riot Prism, 25-fev-2021): escolheu **mestrar um comp e variações** em vez de aprender todos os pivôs porque a fadiga prejudica pivôs tardios; mirava top 4 consistente com board forte de nível 7. Exemplo de jogadora de topo que reconhece o limite cognitivo do tempo [FATO de entrevista, Set 4.5].
- Mentalidade (post de LinkedIn de um jogador Challenger citado em busca; não li): "o que separa os melhores é saber o que ignorar"; "resultados ruins acontecem com boas decisões" [OPINIÃO; fonte não verificada].

### 3.9 Métricas que jogadores acompanham

- Avg placement (equilíbrio = 4,5; uma fonte diz que 4,3 já sobe, 12-20 jogos por divisão dependendo da diferença de MMR) [OPINIÃO]. Um guia sugere meta < 4,0 e top 4 > 50% como "tier list guide" e outro cita 55-65% top 4 como base para Plat+ e 60%+ Diamond+ (sem metodologia) [OPINIÃO, baixa]. Boosting vende "3,5 sobe quase tudo" (**ignorar**).
- Top 4%, bottom 4%, win% (1º), "morreu com greed", distribuição de colocações em ≥ 50 jogos.
- Não encontrei, em nenhuma fonte, números medidos de Challenger (avg placement, top 4%). Esse dado precisaria ser extraído de MetaTFT/Tactics.tools/LeagueOfGraphs com filtro de elo, **que eu não consegui consultar**.
- Ferramentas citadas: MetaTFT, Tactics.tools (dados de augment/comp), LoLCHESS/MetaTFT para histórico, overlays (MetaBot, NoxuTFT: dicas de roll-down, odds, badges de loja).

---

## 4. Regras de decisão acionáveis (SE / ENTÃO / PORQUE)

Todas são **heurísticas de guias/jogadores**, não leis. Fonte entre colchetes; limiares são aproximados.

**Economia e nível**

1. SE estágio 2 e nível < 4 e é 2-1 ENTÃO comprar XP até N4 PORQUE é "quase sempre correto" e dá slots de board [TFT Ninja stage-by-stage].
2. SE (juros) ouro entre 10 e 50 e não há objetivo de gasto ENTÃO manter no múltiplo de 10 mais próximo (evitar 28/38/48) PORQUE cada 10 vale +1 de juros até +5 [MetaBot, Boosteria, VoidS1n].
3. SE o tabuleiro não derrota "2-3 unidades por rodada" OU HP < 60 em 3-2 ENTÃO quebrar juros e rolar 10-20 (mini-roll) PORQUE economia ganha de nada se o HP acaba [うえさか, TFT Ninja, Boosteria].
4. SE posso nivelar barato E isso aumenta chance de vitória/streak ENTÃO nivelar mesmo perdendo 1 de juros PORQUE vitória (+1) e streak (+1 a +3) compõem mais que juros; "fazer 20 é bem pior que nivelar e acertar" [dpei via TFT Ninja]. **Ver disputa 7.1.**
5. SE rolando e ouro após o roll < 20 e HP não é crítico ENTÃO parar PORQUE reconstruir de 20 é muito mais rápido que de 0 [Dignitas; Boosteria]. EXCEÇÃO: SE a próxima derrota elimina OU HP < ~20-30 com board que não vence ENTÃO rolar tudo (manter piso 10-20 se houver próxima rodada) PORQUE juros são inúteis se morrer [Dignitas; TFT Ninja behind].
6. SE dano estimado por derrota × 3 > HP ENTÃO estabilizar agora (rolar/nivelar+rolar) PORQUE restam < 3 derrotas [derivado de TFT Ninja player-damage; INFERÊNCIA].
7. SE nível 7 e comp precisa de 4-custos ENTÃO não rolar por 4-custos no 7 (10%); subir ao 8 (30%) PORQUE odds triplicam [TFT Ninja].
8. SE HP ≥ 60-70 e 4-1 e comp depende de 4-custo e ≥ 50 de ouro e nenhum oponente correndo ao 8 ENTÃO fast 8 em 4-1/4-2 com 30-50 sobrando PORQUE primeira escolha no pool de 4-custos [TFT Ninja; Goboost; MetaBot].
9. SE HP < 40 OU core 1★ OU faltam 2★ de 4-custo ENTÃO ficar no 8 e rolar; não ir ao 9 PORQUE ir ao 9 gasta 60-80 sem melhorar o board [TFT Ninja endgame].
10. SE HP > 60, ≥ 50 de ouro e board 8 estável, e 9º slot dá spike (breakpoint/lendária) OU precisa de 5-custo ENTÃO nível 9 em 5-1 PORQUE 5-custo 15% no 9 [TFT Ninja].

**Pool e comp** 11. SE 2+ jogadores no mesmo carry 4-custo OU você gastou 40+ de ouro sem achar cópia ENTÃO scoutear e pivotar para carry livre PORQUE pool efetivamente seco [TFT Ninja pool-math, 4-cost]. 12. SE você tem um 2★ não contestado ENTÃO ele quase sempre vale mais que um 1★ contestado PORQUE força > traço/ideal [TFT Ninja pivoting]. 13. SE antes do E3 ENTÃO jogar o melhor board disponível e não se comprometer com o endgame PORQUE itens/augments/lobby ainda mudam [TFT Ninja; MetaBot; dpei]. 14. SE ≥ 3 boards têm o mesmo carry/traço ENTÃO evitar o comp, a menos que já tenha as peças PORQUE disputa gera pool seco [MetaBot sinal-table]. 15. SE vizinho slama itens AD ENTÃO considere a linha AP/tank que ele deixou aberta PORQUE o carry dele está travado [MetaBot].

**Itens** 16. SE componente disponível e há carry utilizável nas próximas 3-5 rodadas ENTÃO montar item "do board mais próximo" PORQUE item imperfeito que mantém streak > item perfeito que chega tarde [dpei]. **Ver disputa 7.3.** 17. SE o item só é necessário para vencer uma rodada que perderia ou para liberar slot de componente ENTÃO slamar; caso contrário segurar flexibilidade [dpei "strongest board, infinite money"] PORQUE manter opção para o carry real.

**Posicionamento e scout** 18. SE vai enfrentar oponente X ENTÃO checar: acesso à backline (assassinos/divers), CC em área, itens de contra (Zephyr/Shroud), posição do carry rival, tanque que prende o seu carry [ElbroC]. 19. SE acabou o combate ENTÃO olhar log de dano antes de mexer e reposicionar a cada rodada [GG Clan/Grandmaster Mobalytics, baixa verificabilidade]. 20. SE vai gastar 30+ ouro ENTÃO scoutear nos 10 s antes [MetaBot].

**Risco e colocação** 21. SE HP < ~30 e board mediano ENTÃO jogar pro top 4 (upgrades 2★ imediatos, não bancar, posicionar contra os mais fracos) PORQUE só precisa sobreviver a 3-4 jogadores [TFT Ninja endgame/behind]. 22. SE tem o board mais forte, 30-40+ HP e 30+ ouro OU restam 3-4 jogadores ENTÃO empurrar o 1º PORQUE vale mais LP [TFT Ninja endgame]. 23. SE 2-3 bottom 4 seguidos OU cansado/tiltado ENTÃO parar a sessão PORQUE decisões pioram [TFT Ninja mental].

**Set 18 (Wisps)** 24. SE no meio de um roll-down comprometido ENTÃO não comprar Wisp que não é o alvo; SE Wisp exige entortar o board ENTÃO ignorar; SE HP baixo ENTÃO preferir Wisp de combate imediato [NoxuTFT/Mobalytics via busca; baixa-média].

---

## 5. Números de referência

| Item                             | Valor                                                                       | Fonte/Tipo                          |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| Juros                            | +1 por 10 de ouro, teto +5 em 50                                            | consenso/FATO                       |
| Streak bônus                     | 2-4: +1; 5: +2; 6+: +3 (vitória e derrota; vale em PvE)                     | TFT Ninja [FATO de regra do jogo]   |
| Vitória                          | +1 ouro                                                                     | TFT Ninja                           |
| Dano por derrota                 | base E2 2, E3 5, E4 8, E5 10, E6 12, E7+ 17, mais unidades vivas do inimigo | TFT Ninja (patch 18.1)              |
| Cópias/champ                     | 1-custo 30; 2-custo 25; 3-custo 18; 4-custo 10; 5-custo 9                   | TFT Ninja (Set 18)                  |
| Odds nível 7                     | 3c 43%, 4c 10%, 5c 1%                                                       | TFT Ninja                           |
| Odds nível 8                     | 4c 30%, 5c 3%                                                               | TFT Ninja; NoxuTFT confirma 10%/30% |
| Odds nível 9                     | 4c 33%, 5c 15%                                                              | TFT Ninja                           |
| XP                               | 7→8: 56; 8→9: ~60-80 de ouro                                                | TFT Ninja                           |
| HP em 4-1 saudável               | 60-85                                                                       | TFT Ninja                           |
| HP para N9                       | >60 (5-1) ou >75 (4-1)                                                      | TFT Ninja, VoidS1n                  |
| Ouro mínimo para 4-cost rolldown | 30-50 (abaixo de 35 insuficiente)                                           | TFT Ninja                           |
| LP                               | 1º +35~45 ... 8º -35~50 (aprox.)                                            | TFT Ninja (não oficial)             |
| Regra LP                         | 4º+ nunca perde; 5º- nunca ganha                                            | Riot FAQ [FATO]                     |
| Decay Master+                    | banco 14 jogos; -50 / -150 / -250 LP por dia                                | Riot FAQ [FATO]                     |
| Equilíbrio avg placement         | 4,5                                                                         | matemática [INFERÊNCIA]             |

---

## 6. Disputas na comunidade (registradas)

7.1 **Juros (50 de ouro) vs. strongest board / nivelar barato.** Guias clássicos (VoidS1n, Boosteria, MetaBot: "mantenha em breakpoint de juros salvo plano") vs. dpei ("fazer 20 é pior que nivelar e acertar", poverty loop) e うえさか/Goboost (quebre juros pelo board). Contexto: dpei analisa Set 17 em jogo de Masters; limitações de transferência para Set 18 declaradas pelo TFT Ninja. **Não encontrei dado medido que arbitre.** VoidS1n também diz que a prioridade de juros é maior no Stage 2 do que depois; Boosteria separa estilos: agressivo/greedy/balanceado ("balanceado é o mais seguro para subir"). [DISPUTA]

7.2 **Forçar comp vs. flexar.** TFT Ninja flex-vs-forced: iniciantes devem conhecer 2-3 comps e "soft-force"; Platinum+ devem ter 2-3 opções; Master+ flexam, mas a maioria tem comps favoritos. BunnyMuffins: maioria deve focar num estilo; "muitos Challengers já forçaram". dpei: forçar é válido para aprender/jogar um comp, **mas "não force ao empurrar de Diamond a Challenger"** nem contra comp contestado. MetaBot: "force para aprender, depois flexe fora da contestação". Coralie escolheu one-trick por fadiga. [DISPUTA moderada: depende do rank e do objetivo]

7.3 **Slamar itens vs. segurar componentes.** MetaBot/Tacter/Sullla: monte item imperfeito, não deixe componente parado 3 estágios. TFT Ninja (tempo, lobby lento): "segure componentes para combinações ótimas em lobby lento"; TFT Ninja 4-cost: "não slamar no E3 pro carry do endgame". dpei: slame só se ganha a rodada ou o slot de componente limita. NoxuTFT: monte o imperfeito que mantém vivo. Setsuko (perfil): slama para salvar HP. [DISPUTA: depende do lobby/estágio]

7.4 **Loss streak.** dpei (Set 17): válido com plano de 3 respostas; BunnyMuffins (Set 18): "não é ótimo" neste patch; TFT Ninja loss-streaking e Mobalytics (via busca): é opção legítima com saída planejada. [DISPUTA dependente de set]

7.5 **Estar seguro vs. pegar risco.** VoidS1n/Boostroyal pedem mais greed; Sullla/MetaBot/Boosteria alertam contra copiar hábitos de Challenger (greed) sem conhecimento e contra jogar para sobreviver. Nenhum dado de EV para resolver. [DISPUTA]

7.6 **Acessibilidade de dados**: LP por colocação, thresholds de HP e "limiar de Fast 9" variam entre fontes (60+, 75+, 90+ HP; 40 HP como piso). Não há fonte primária. [DISPUTA numérica]

---

## 7. Lacunas

- Nenhum conteúdo do Reddit nem de transcrições de streamers/pros (acesso bloqueado ou texto indisponível). Falta saber o consenso real em r/CompetitiveTFT sobre os pontos da seção 6.
- Sem dados medidos de avg placement/top 4%/win% por elo.
- Mobalytics (403) e Tacter (404 em vários) não puderam ser lidos; só trechos de resultados de busca.
- Falta pesquisa sobre benchmarks de HP/ouro por estágio feitos por Challengers do Set 18 especificamente (a maior parte das heurísticas é do Set 17 ou genérica).
- Sem estudo quantitativo de EV (colocação esperada) para greed vs. segurança.

---

## 8. Como isso se aplicaria a um assistente de decisão

Dados que o sistema precisaria por regra (sem OCR de memória; fontes estruturadas quando possível):

| Regra                            | Dados necessários                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 2, 3, 4, 5 (economia e nível) | ouro atual, nível, XP/XP restante, estágio-rodada, streak (vitórias/derrotas seguidas), HP, tamanho e força do board próprio (unidades 2★, itens completos), augments de economia/roll |
| 6 (HP como relógio)              | HP, estágio, tabela de dano base do set, estimativa de unidades vivas do inimigo (ou do último dano sofrido do log)                                                                    |
| 7, 8, 9, 10 (nível 8/9)          | nível, ouro, HP, nº de unidades 2★ no core, alvo 4-custo escolhido, odds por nível do set, pool restante das unidades-alvo                                                             |
| 11, 12, 14 (contestação/pivô)    | tabuleiros/bancos/itens dos 7 rivais (ou estimativa de cópias vistas), cópias do alvo que você tem, pool remanescente por champion, ouro gasto sem achar cópia desde o último pivô     |
| 13 (comprometimento)             | estágio-rodada, itens/componentes, augments, lobby                                                                                                                                     |
| 16, 17 (itens)                   | banco de itens/componentes, receitas, qual unidade segura item nas próximas 3-5 rodadas, se o item vence a rodada                                                                      |
| 18, 19, 20 (scout e posição)     | próximo oponente (ou tabuleiros dos 3-4 mais fortes), posição das unidades deles, itens contra (Zephyr/Shroud/etc.), log de dano da luta anterior, traços dos divers do set            |
| 21, 22 (top 4 vs. 1º)            | HP próprio, HP dos rivais e nº vivos, força relativa do board (rank no lobby), ouro, nível, risco de queda/promoção                                                                    |
| 23 (tilt)                        | histórico de colocações das últimas partidas da sessão, duração da sessão                                                                                                              |
| 24 (Wisps)                       | conteúdo da loja de Wisps, condição da Wisp, HP, estado do roll-down                                                                                                                   |

Outputs de revisão que o sistema poderia gerar com dados já capturados:

- Por partida: colocação, HP por rodada, ouro/nível por estágio, bancos e itens, roll-downs com ouro gasto e resultado (acertou/não), contestações detectadas (número de rivais com o mesmo carry), quanto ouro tinha ao morrer ("morri com greed").
- Por bloco de 10-20 partidas: avg placement, top 4%, bottom 4%, win%, distribuição, LP esperado estimado a partir da distribuição (com tabela de LP configurável e rotulada como aproximação).
- Detectores de erro baseados nas regras acima (ex.: roll até 0 sem alvo, HP < 40 e tentativa de nível 9, 60+ de ouro em 4-2, componente parado por 3 estágios, mais de 1 jogador no mesmo carry sem pivô).
- Sempre separar no resultado: **fato medido** (HP, ouro, odds do set), **inferência** (probabilidade de acertar), **desconhecido** (rivais não scoutados), e **heurística de guia** (qualquer limiar de HP/ouro acima), com a fonte e o set de origem.

---

## 9. Fontes (URL, data, tipo)

- Riot Support, Teamfight Tactics Ranked FAQ: https://support.riotgames.com/tft/account/teamfight-tactics-ranked-faq (página datada 10-mar-2026) [FATO]
- Riot/TFT, "Race to the Top: What it takes to hit Challenger first" (Coralie, Set 4.5): https://teamfighttactics.leagueoflegends.com/en-gb/news/community/race-to-the-top-what-it-takes-to-hit-challenger-first/ (25-fev-2021)
- ElbroC, "How to Scout like a Challenger in TFT": https://elbroc.substack.com/p/how-to-scout-like-a-top-player-in-tft-65b63b93b273 (22-mai-2023)
- ElbroC, "5 Biases that Stop You from Mastering TFT Stats Analysis": https://elbroc.substack.com/p/5-biases-that-stop-you-from-mastering-tft-stats-analysis-e1242ef92911 (18-set-2023)
- TFT Ninja: https://tft.ninja/guides/ranked/mentality ; /guides/ranked/climbing-tips ; /guides/ranked/tiers-and-lp (06-out-2026) ; /guides/advanced/tempo ; /guides/advanced/endgame-decisions ; /guides/advanced/stage-by-stage (06-out-2026) ; /guides/advanced/pool-math ; /guides/game-mechanics/player-damage-calculation ; /guides/strategy/playing-from-behind ; /guides/strategy/pivoting ; /guides/strategy/loss-streaking ; /guides/strategy/win-streaking ; /guides/strategy/when-to-level ; /guides/strategy/rolling-strategy ; /guides/strategy/strongest-board (31-mar-2026) ; /guides/strategy/scouting ; /guides/strategy/4-cost-econ-and-gameplan ; /guides/team-comps/flex-vs-forced ; resumos de dpei: /guides/creators/dpei/econ-loop-explained (vídeo 20-fev-2026), /how-to-highroll (28-fev-2026), /stop-playing-for-endgame (09-mar-2026), /how-to-force-a-comp (20-mar-2026), /strongest-board-infinite-money (25-mar-2026); páginas dos resumos atualizadas 02-set-2026, escritas para Set 17.
- MetaBot.GG: https://metabot.gg/en/TFT/guides/common-tft-mistakes-to-avoid ; /tft-scouting-flexible-vs-forcing-comps ; /tft-slow-roll-vs-hyper-roll (publicados jul-2026, atualizados 05-out-2026)
- Dignitas, "TFT Tips to Get You Climbing Like a Challenger" (Quazza, 04-out-2023, Set 9.5): https://dignitas.gg/articles/tft-tips-to-get-you-climbing-like-a-challenger
- Dignitas, "How to Review Your Own Replays" (EssentialG, 01-nov-2022): https://dignitas.gg/articles/how-to-review-your-own-replays-to-improve-your-gameplay
- VoidS1n, "You're Playing Stage 4 Wrong": https://voids1n.com/tft-guides/youre-playing-stage-4-wrong-stage-4-guide/ ; "Economy management (basic)": https://voids1n.com/tft-guides/economy-management-basic/ (sem data)
- BunnyMuffins: https://bunnymuffins.lol/?p=1235 ("How I Got Good at TFT") ; https://bunnymuffins.lol/openers/ (Set 18, patch 18.3b)
- NoxuTFT: https://noxutft.com/guide (comercial, sem data)
- Boosteria: https://boosteria.org/guides/tft-economy-mastery (22-nov-2025) ; https://boosteria.org/guides/tft-lp-mmr-explained-tft-ranked-really-works (14-mar-2026) [boosting]
- Goboost: https://goboost.gg/blog/tft-economy-masterclass-fast-8-vs-fast-9-strategies-pre-april-15/ (05-abr-2026) ; https://goboost.gg/blog/tft-leveling-guide-exactly-when-to-push-level-8-and-level-9/ (Nano, 05-jun-2026) [boosting]
- うえさか, "Non-Greedy Economy": https://note.com/uesaka_games/n/nd6b3ace686d8 (11-mar-2026)
- MyBoosting, "How to reduce tilt in TFT": https://www.myboosting.gg/blog/tft/howto-reducetilt-tft (10-fev-2023) [boosting]
- Sullla, "Seven Bad Habits": https://sullla.com/LoL/TFT7badhabits.html (sem data)
- GG Clan (resumo de vídeo coreano): https://ggclan.com/news/tft-unit-positioning-tips-challenger-guide (10-set-2026) [baixa]
- Contexto de set/patch (só resultados de busca): esports.gg (Set 18 Enchanted Wilds), Liquipedia Patch TFT18.1, Seemeta patch 18.4.
- Apenas via trecho de busca (não li a página): Mobalytics "mistakes to avoid in set 18", Mobalytics "Tips for Climbing Every Rank" (Grandmaster; 403), Tacter/Frobei, Mavericks Invitational (host não resolveu), The Game Haus (404), Metafy/SpencerTFT, esports.gg setsuko profile.
