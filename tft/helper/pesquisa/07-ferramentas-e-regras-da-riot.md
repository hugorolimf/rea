# 07 - Ferramentas de terceiros em TFT e regras da Riot

Pesquisa feita em 2026-10-10 (Set 18, patch 18.4). Notas em português; citações literais em inglês, como as fontes as trazem.
Nada aqui é aconselhamento jurídico. É leitura das regras publicadas pela Riot e comparação com o que o helper faz.

Legenda de tipo: **[FATO-RIOT]** texto publicado pela Riot e lido por mim na página; **[FATO-SECUNDÁRIO]** relato de terceiro sobre um texto da Riot que não consegui abrir; **[VENDOR]** afirmação de empresa sobre o próprio produto; **[INFERÊNCIA]** minha leitura; **[NÃO ENCONTREI]** lacuna.

---

## 1. Resumo executivo

1. A regra escrita mais direta da Riot para este caso está na página oficial de desenvolvedores de TFT: **"An app cannot make suggestions based on the player's current game state as that information is dynamic."** [FATO-RIOT]. O mesmo documento lista como _não aprovados_ "Apps that provide dynamic, real-time information" e "Apps that dictate player decisions", e proíbe apps e overlays durante a partida de rastrear "your opponent's champions/plays". Isso atinge o centro do helper: recomendações ao vivo de rolar, subir de nível, itens e comp, e leitura dos tabuleiros rivais.
2. Esse documento é uma política de **produtos que pedem chave de API / registro no Developer Portal**. O helper é local e pessoal. Mas a Riot repete o mesmo princípio para jogadores na página de suporte "Third Party Applications" (10/02/2025): proíbe "Drawing conclusions for you during gameplay". E os Termos de Serviço (última modificação 01/12/2024) proíbem "unauthorized third party programs ... that interact with the Riot Services in any way, for any purpose". Quem decide o que é "unauthorized" e se há ação é a Riot.
3. **Leitura de tela/OCR e leitura de arquivos de log**: não achei nenhum texto da Riot que proíba ou autorize expressamente esses métodos. As regras recaem sobre **o que a ferramenta mostra** (informação dinâmica, scouting, recomendação automática), não sobre o método de captura. Trocar OCR por log não muda a avaliação das recomendações.
4. A parte tecnicamente mais arriscada hoje é a **leitura de memória**: desde **2026-10-06** a Riot bloqueia por padrão acesso à memória do jogo por apps desconhecidos (LoL, TFT, VALORANT). O helper não lê memória. A Riot diz que isso "does not result in bans by itself".
5. O que mais destoa da política, em ordem: (a) tabuleiros de todos os rivais ao vivo (`TFTEoGStats.json` + `scouting-captures.jsonl`), (b) estimativa do banco rival e chances de rolar por pool, (c) recomendações ao vivo de ação (rolar/nível/comprar/aprimoramento), (d) estatística de aprimoramentos. Leitura da própria loja/ouro/nível por OCR e leitura de LCU por GET são o que tem menos suporte textual para proibição.
6. O mercado já tem ferramentas com "BUY/CONSIDER/SKIP", odds ao vivo, scouting de lobby e win chance (MetaTFT, MetaBot, TFTSense). **Não achei** declaração da Riot aprovando nem relato de onda de bans contra elas. Isso mostra tolerância na prática (ou fiscalização não documentada), não permissão escrita.
7. Mudança iminente: o cliente próprio do TFT (Unreal) tem data alvo **2026-11-03**. A Riot não diz nada publicado sobre LCU, logs ou APIs locais nesse cliente. As fontes de dados do helper (LCU `lol-gameflow`, `TFT.log`, `TFTEoGStats.json`, `.sentry-native`) podem sumir ou mudar.

---

## 2. Parte A - ferramentas e dados usados por jogadores e assistentes

### 2.1 Mapa de ferramentas

| Ferramenta                        | Tipo                                    | Funcionalidades (como descritas)                                                                                                                                                                                                                         | Dados que consome                                                                                                                                                                                                                                  | Funcionalidade de "decisão ao vivo"                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MetaTFT**                       | site + overlay Overwolf                 | Overlay: "live augment stats, up-to-date comp recommendations, win chance estimates, detailed match histories, lobby scouting, matchup tracking"; histórico round a round                                                                                | Estatísticas agregadas de ladder; dados da partida via Overwolf (eventos de jogo)                                                                                                                                                                  | Sim: comp recomendada, win chance, scouting de lobby (via histórico dos oponentes). Fontes: [Overwolf MetaTFT](https://overwolf.com/app/metatft.com-metatft) [VENDOR], [mobi.gg](https://mobi.gg/de/tipps/beste-tft-tools/)                                                                                                                 |
| **Tactics.tools**                 | site                                    | Top comps por patch (play rate, colocação média, top 4, win), tendências de unidades, Team Builder, tabelas, tier lists, leaderboards, perfis, Wrapped                                                                                                   | Dados de partidas agregados (origem não declarada na página)                                                                                                                                                                                       | Nenhuma ao vivo (site, não overlay). A página não cita calculadora de odds [FATO] ([tactics.tools](https://tactics.tools/), lido 2026-10-10). Um roundup cita "rolling odds" para "TFTactics", sem confirmar o domínio ([Bamboo Gaming](https://www.bamboogaming.net/tft/tools))                                                            |
| **TFTAcademy**                    | site + app Overwolf                     | "pro-backed recommendations, a smart in-game planner, a replay system" (listagem); comps, tier lists, gravação de partidas                                                                                                                               | Dados agregados + Overwolf                                                                                                                                                                                                                         | Planner e cheat sheet no jogo; não confirmei itens/aprimoramentos                                                                                                                                                                                                                                                                           |
| **Mobalytics**                    | site + overlay Overwolf                 | Overlay abre com a partida; comps, itens ideais por carry, posicionamento, avanço de níveis por estágio                                                                                                                                                  | Dados agregados + Overwolf                                                                                                                                                                                                                         | Sim (recomendações). Página oficial devolveu 403; descrição vem de [TFTSense](https://tftsense.gg/study-hall/best-tft-overlay/) [VENDOR concorrente] e da [listagem Overwolf](https://overwolf.com/browse-by-game/teamfight-tactics)                                                                                                        |
| **Blitz**                         | app                                     | Overlay: stats, cheat sheet de itens, informação de nível, "opponent tracking", benchmarking; taxas de drop de campeões                                                                                                                                  | Dados agregados; leitura do jogo não detalhada                                                                                                                                                                                                     | Parcial (descrições secundárias, [mobi.gg](https://mobi.gg/de/tipps/beste-tft-tools/)); não confirmei pool tracker                                                                                                                                                                                                                          |
| **LoLChess**                      | site                                    | Não consegui abrir (404 na raiz testada)                                                                                                                                                                                                                 | -                                                                                                                                                                                                                                                  | [NÃO ENCONTREI]                                                                                                                                                                                                                                                                                                                             |
| **MetaBot.GG Desktop**            | overlay Overwolf                        | "Recommended Comps", "Shop Tier Ratings", "Win Odds" (win ao vivo contra o lobby antes da luta), "Round History", "Board Search". Exibe selo "Riot Approved" e diz "never reads memory or modifies TFT's files"                                          | Dados de ranked; Overwolf                                                                                                                                                                                                                          | Sim: avalia cada carta da loja, estima vitória. Selo "Riot Approved" é **[VENDOR]**, sem link para a Riot ([página](https://metabot.gg/en/download/teamfight-tactics), Out/2026)                                                                                                                                                            |
| **TFTSense**                      | app Windows (sem Overwolf)              | "Reads the game screen and draws calls over the board"; chamadas **BUY / CONSIDER / SKIP**, "when to roll, level, or hold gold", posicionamento, itens pelos componentes, contagem de pool ("you own 2 of 9"), scouting de lobby (rank, comps favoritas) | **Visão computacional da tela**; "No Memory"                                                                                                                                                                                                       | Sim, é o análogo mais próximo do helper. Declara: "Not affiliated with or endorsed by Riot Games" ([site](https://tftsense.gg/), [TFTSense overlay safety](https://tftsense.gg/study-hall/are-tft-overlays-safe/), atualizado 2026-09-27) [VENDOR]                                                                                          |
| **Calculadoras de odds / pool**   | páginas e tabelas                       | Tabelas de odds por nível e tamanho do pool por custo; contagem de cópias que você possui                                                                                                                                                                | Valores estáticos do patch. Set 18 (patch 18.3): pool por campeão 1c=30, 2c=25, 3c=18, 4c=10, 5c=9; odds por nível (ex.: nível 8 = 15/20/32/30/3) ([TFTSense pool e odds](https://tftsense.gg/study-hall/tft-champion-pool-and-odds/), 2026-09-27) | Estático = baixo atrito com a política. Contar "cópias de rivais em jogo" é outra coisa (ver 3.3)                                                                                                                                                                                                                                           |
| **Overwolf GEP (API de eventos)** | plataforma que alimenta vários overlays | Eventos TFT: `gold`, `xp` (nível/xp/xp_max), `health`, `round_type`, `shop_pieces`, `board_pieces`, **`opponent_board_pieces`**, `bench_pieces`, `item_bench`, `carousel_pieces`, `match_stats`, `board_spectate`, `battle_stats`                        | Dados do jogo extraídos pela Overwolf                                                                                                                                                                                                              | Base técnica dos overlays. Nota importante: a doc da própria Overwolf diz do bloco `augments`: **"DO NOT include augment data support in your apps."** e que o dado "can't be displayed on third-party apps and websites by any means" ([doc TFT](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/teamfight-tactics)) |

### 2.2 O que existe hoje como "assistente de decisão ao vivo" e seus limites

- **Existem**, comercialmente: recomendação de comp pelo lobby, nota de cada carta da loja, win chance/odds contra o lobby, chamadas de rolar/nível/segurar ouro (TFTSense), cheat sheet de itens, planner. [VENDOR]
- **Limites declarados ou visíveis**:
  - Nenhuma dessas ferramentas cita aprovação formal da Riot além de afirmações do próprio vendor. Os próprios concorrentes dizem: "No mainstream third-party TFT tool is 'approved by Riot' in a formal sense" ([TFTSense](https://tftsense.gg/study-hall/are-tft-overlays-safe/)) [VENDOR concorrente].
  - Os dados de **aprimoramentos** foram retirados por Riot do resumo final/histórico (Overwolf, newsletter de 2024-11-29: "This information is no longer accessible via Riot's or Overwolf's APIs") ([blog Overwolf](https://blog.overwolf.com/developers-november-newsletter-user-reviews/)) [FATO-SECUNDÁRIO].
  - A Overwolf nunca reconhece garantia de que um app seguirá funcionando; a Riot idem no aviso de out/2026.
  - A origem exata dos dados de gold/shop/bench em cada overlay não é declarada pelas fontes que li (só TFTSense declara tela).

---

## 3. Parte B - política da Riot (o que está escrito)

### 3.1 Hierarquia das fontes (da mais vinculante à mais interpretativa)

1. **Termos de Serviço da Riot** (vale para qualquer jogador) - [riotgames.com/en/terms-of-service](https://www.riotgames.com/en/terms-of-service), "Last Modified: December 1, 2024".
2. **Página de suporte "Third Party Applications"** (jogador) - [support.riotgames.com ... third-party-applications](https://support.riotgames.com/en-us/riot/events/third-party-applications), 2025-02-10.
3. **Developer Policy / Game Integrity** (quem usa a API) - [developer.riotgames.com/policies/general](https://developer.riotgames.com/policies/general), "LAST UPDATED: MAY 29, 2025".
4. **Documento TFT do Developer Portal** (aprovações e proibições para TFT) - [developer.riotgames.com/docs/tft](https://developer.riotgames.com/docs/tft), sem data na página; cita Data Dragon `dragontail-16.20.1`, então é a versão vigente em out/2026. O mesmo texto está espelhado em [support-developer ... Teamfight-Tactics](https://support-developer.riotgames.com/hc/en-us/articles/22698732381587-Teamfight-Tactics) (403 para mim, só vi resumo de busca).
5. **Posts de Developer Relations (2019)** - orientação de design, não lista de bans.
6. **Post da equipe Anti-Cheat sobre ferramentas de terceiros em TFT** - proibições concretas (não consegui abrir; ver 3.4).
7. **Aviso de memória** (2026-09-29, em vigor desde 2026-10-06).

### 3.2 Citações literais por regra

**(a) Termos de Serviço** - [FATO-RIOT]

- Seção 7.1, item 11: "Using any unauthorized third party programs, including mods, hacks, cheats, scripts, bots, trainers and automation programs" / "that interact with the Riot Services in any way, for any purpose".
- Seção 3.1: "reverse engineer, decompile, derive source code from, translate".
- Seção 2.3: perda de conta: "you'll no longer have access to your account, including any of the associated data or Virtual Content"; sem reembolso.
- [INFERÊNCIA] Não está dito se "interact" inclui só ler a tela ou ler arquivos que o jogo grava. É a ambiguidade central.

**(b) Suporte, "Third Party Applications" (2025-02-10)** - [FATO-RIOT]

- "No software should compromise game integrity or negatively impact the in-game player experience"
- Proibido: "Exposing information that's intentionally obfuscated"; "Drawing conclusions for you during gameplay" (Riot quer que "see you play the game first, then analyze and reflect later"); "Altering your field of intelligence (zoomhacks or global ult alerts)"; "Taking actions on your behalf (botting or scripting)".
- "if an app provides an unfair advantage, it's not acceptable"; na dúvida, "better to be safe and not use it".
- A página **não** cita overlays, leitura de tela nem arquivos de log.

**(c) Developer Policy, Game Integrity (2025-05-29)** - [FATO-RIOT]

- "Products cannot create an unfair advantage for players, like a cheating program"
- "Products should increase, and not decrease the diversity of game decisions"
- "Products should not remove game decisions" / "may highlight decisions that are important"
- "Products cannot de-anonymize players who cannot reasonably be identified from visible information."
- "Products should use supported services from Riot Games for data ingestion"
- Sobre o LCU: se o produto usa a League Client API, deve ler a documentação e registrar o produto.

**(d) Documento TFT do Developer Portal** - [FATO-RIOT]

- Aprovado: "Showing (self) player stats", "Training tools that allow players to view their own match histories and aggregate stats", **"Game overlays that provide static data that is available prior to the game."**
- "Will not be approved": "Scouting - tracking the champions opponents have on their boards."; "Products that bypass a skill test for the player."; "Apps that provide dynamic, real-time information."; "Apps that dictate player decisions."
- Em jogo: "Apps and Overlays during gameplay (including the loading screen) may not track your opponent's champions/plays"; não podem "predict their next plays"; "This includes aggregate stats for both individual players and the lobby."
- "may not include any real-time data that would improve a player's performance immediately."
- **"An app cannot make suggestions based on the player's current game state as that information is dynamic."**; "Having a static recommendation for a player pre-game is acceptable."
- "Products may not provide information that was not available prior to the game." (exemplo permitido: estatísticas de aprimoramento, por existirem antes da partida)
- "Products cannot identify or analyze players who are deliberately hidden by the game."
- "Products cannot display win rates for Legends and Legend-based Augments." / "This applies to all websites, applications, and overlays."

**(e) Developer Relations, 2019-09-26 (Gene Chorba)** - [FATO-RIOT], [riotgames.com/en/DevRel/teamfight-tactics-match-history](https://www.riotgames.com/en/DevRel/teamfight-tactics-match-history)

- "Providing deterministic answers about what players 'should' choose in a given moment ultimately robs players of agency"
- "It's important that players have a level field in using their time between rounds" (cita scouting de tabuleiros); "all players should share the same 'expense' for each action in a given game."
- Exemplos: "Knowing the probability of rolling for an exact champion at any given time", e empurrar o jogador a "re-roll or level up".
- "These are very much not confined to Teamfight Tactics" e "keep them in mind as you work on applications for any of Riot's game(s)".
- Valor positivo: "We want third-party tools to accurately represent player mastery as juggling many potential paths to victory."

**(f) Aviso de acesso à memória (2026-09-29; vigência 2026-10-06)** - [FATO-RIOT], [support.riotgames.com ... game-memory-access-removed-for-third-party-apps](https://support.riotgames.com/en-us/riot/performance/game-memory-access-removed-for-third-party-apps)

- Riot passa a impedir "game memory access by default for all unknown third-party applications", para todos os títulos "including League, TFT, and VALORANT"; a API oficial é "the only allowed mechanism for retrieving game data".
- Ferramentas conhecidas e aprovadas: período de graça até **abril de 2027**.
- "This change does not result in bans by itself" / "just blocks unauthorized tools from interacting with the game client."
- "Many third party tools do not pilfer game memory". O texto **não** menciona LCU, arquivos locais nem captura de tela.

**(g) Vanguard FAQ para terceiros (2024-04-01)** - [FATO-RIOT], [riotgames.com/en/DevRel/vanguard-faq](https://www.riotgames.com/en/DevRel/vanguard-faq)

- "External tools reading memory will no longer work."
- "Overlays and internal tools using the API, game client, and in-game APIs should continue to function."
- Sobre LCU/APIs de jogo: a Developer Relations não os possui nem garante suporte. "There is absolutely no allow list for Vanguard."
- O Vanguard é exigido para TFT em PC porque o TFT roda pelo cliente do LoL [FATO-SECUNDÁRIO]. Em 2026-06-24 a Riot anunciou o modo opcional "Vanguard On-Demand"; não muda a exigência.

**(h) Documentação do LCU** - [FATO-RIOT], [developer.riotgames.com/docs/lol](https://developer.riotgames.com/docs/lol)

- O LCU é "not officially supported for use with third party applications"; sem garantia de documentação, disponibilidade ou aviso de mudanças. Quem o combina com a API da Riot deve registrar o app e listar os endpoints: "we need to know about it."

**(i) Post da Anti-Cheat sobre ferramentas de terceiros em TFT** - [FATO-SECUNDÁRIO]

- Título: "Our Approach to Teamfight Tactics Third-Party Tools" (Developer Corner, autor citado: Riot K3o pela equipe Anti-Cheat). **Não consegui abrir** (o domínio `boards.na.leagueoflegends.com` não resolve, o fórum parece desativado) e a data não foi confirmada; resultados de busca o descrevem como com cerca de sete anos (c. 2019). O conteúdo abaixo vem de resumos de busca, não da página.
- Categorias proibidas, segundo o resumo: (1) informação só obtida por ferramenta, como "exact future rolls", "future item drops", "win percentages for matchups", "specific opponent gold amounts"; (2) informação dinâmica do estado do jogo, como "percentage of rolling a unit based on units in play across all boards" e visões agregadas de sinergias/ouro dos tabuleiros; (3) **"automatic recommendations based on the current game state, such as recommended comps based on your current units or itemization suggestions"**.
- Consequência segundo o resumo: ações na conta pela "Section IX of the Code of Conduct".
- Tratar como evidência indireta de que a Riot pensava assim; não como regra atual verificada.

**(j) Dados de Legends e aprimoramentos**

- 2023: sites de terceiros proibidos de expor win rate de Legends (Set 9) e depois de aprimoramentos por estágio; Mortdog em 12/06/2023: "third-party sites will not be allowed to share any data around the performance of individual legends" ([Dexerto](https://www.dexerto.com/league-of-legends/teamfight-tactics-runeterra-reforged-to-prevent-third-party-sites-from-sharing-data-2173352/)) [FATO-SECUNDÁRIO].
- Agosto de 2023: Mortdog anunciou reversão da restrição de aprimoramentos ("We were naive to think that everyone would happily go along with this") ([Dot Esports](https://dotesports.com/tft/news/mortdog-admits-tfts-ban-on-augment-stats-sites-was-naive-as-riot-changes-course), resumo de busca) [FATO-SECUNDÁRIO].
- Nov/2024 (Set 13): Riot removeu aprimoramentos do histórico e do resumo; a Overwolf diz "DO NOT include augment data support" e que a Riot "has updated their Terms of Service regarding augment data" [FATO-SECUNDÁRIO via doc Overwolf].
- Estado hoje: o texto vigente do Developer Portal restringe apenas "win rates for Legends and Legend-based Augments". Sites como NoxuTFT e MetaTFT ainda publicam dados de aprimoramento. [NÃO ENCONTREI] uma declaração atual da Riot que reconcilie isso com a nota da Overwolf. Tratar como **disputa**.

### 3.3 Exemplos de bans/avisos (o que achei e o que não)

- **TFT, ferramenta de overlay/leitura de tela**: [NÃO ENCONTREI] relato verificável de banimento por esse motivo, nem aviso da Riot a um overlay específico. Guias de terceiros dizem que "even overlays or 'harmless' mods that read game memory can trigger Riot's anti-cheat" ([1v9.gg](https://1v9.gg/blog/teamfight-tactics-tft-how-to-get-unbanned-ban-appeal-guide)) - isso é sobre memória e é opinião de site.
- **LoL, informação oculta (precedente de postura, não de TFT)**: onda de bans a usuários de "lobby revealers" (Vanguard); em 2024-05-21 Matt Paoletti (@RiotK3o) corrigiu a mensagem para suspensão temporária, e disse que scripting continua "still permanent on first infraction" ([RiftFeed](https://riftfeed.gg/lol-news/lol-riot-clarifies-stance-on-lobby-revealers-amidst-current-account-ban-wave), 2024-05-22) [FATO-SECUNDÁRIO]. Mostra que a Riot pune ferramentas que expõem informação escondida antes do jogo.
- **VALORANT**: relatos de bans temporários a usuários de trackers de terceiros, com texto da Riot descrito como vago ([Sportskeeda](https://sportskeeda.com/valorant/news-valorant-reportedly-banning-players-using-third-party-trackers)) [FATO-SECUNDÁRIO]; outro jogo, uso apenas como contexto.
- **Erro de onda de bans**: houve contas banidas por engano em onda de bans de aplicativos não autorizados (fórum LoL, data não verificada) - mostra que o sistema tem falsos positivos e há apelação.
- **Aviso out/2026**: "This change does not result in bans by itself".

### 3.4 Matriz: uso do helper x regra x risco

Risco = minha estimativa qualitativa de conflito com texto publicado e de exposição a ação; não é previsão do que a Riot fará.

| Uso do helper                                                                                                                             | Regra que se aplica                                                                                                                                                                                  | Situação                                                                                                                                                               | Risco                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Ler `TFT.log` (compras, fusões, rodada) e `__sentry-event` (estágio/fase)                                                                 | Nenhuma regra citando logs. Termos 7.1(11) "interact ... in any way" é genérico; aviso 2026 trata só de memória                                                                                      | **Cinza** (não proibido por texto, não autorizado). Dado é do próprio jogador                                                                                          | Baixo-médio                               |
| LCU por GET (`gameflow-phase`, `session`) via `lockfile`                                                                                  | Doc LCU: "not officially supported"; Vanguard FAQ: apps via game client/API "should continue to function"; registro só se combinar com API de chave                                                  | **Tolerado, sem garantia**; sem leitura de memória; sem escrita                                                                                                        | Baixo (técnico), médio de fragilidade     |
| OCR/captura de tela de ouro, nível, XP, loja, banco de itens                                                                              | Nenhuma regra citando captura de tela. O dado já está na tela do jogador                                                                                                                             | **Cinza quanto ao método**; o risco é a saída (abaixo). Precedente comercial: TFTSense                                                                                 | Baixo (método)                            |
| Recomendação ao vivo "rolar/subir de nível/comprar/segurar" a partir do estado atual                                                      | "An app cannot make suggestions based on the player's current game state"; "Apps that dictate player decisions"; "Drawing conclusions for you during gameplay"; DevRel 2019 "robs players of agency" | **Contraria o texto publicado** (política de API e orientação de suporte). Aplicação a um app pessoal não é clara                                                      | **Alto** (política), médio (fiscalização) |
| Chances de rolar por pool descontando o banco estimado dos rivais                                                                         | Anti-Cheat (secundário): "percentage of rolling a unit based on units in play across all boards"; DevRel: "probability of rolling for an exact champion at any given time"                           | **Proibido segundo fontes secundárias/antigas**; alinhado com "dynamic, real-time"                                                                                     | Alto                                      |
| Tabuleiros e itens de todos os rivais ao vivo (`TFTEoGStats.json`), gravar em `scouting-captures.jsonl`, score de força contra cada rival | "Scouting - tracking the champions opponents have on their boards"; "may not track your opponent's champions/plays ... aggregate stats ... for the lobby"; DevRel "level field"                      | **Proibido (aprovação), texto direto.** O arquivo é gravado pelo jogo; isso não altera a regra                                                                         | **Alto**                                  |
| Estimar o banco dos rivais (`hiddenHoldings`)                                                                                             | Mesma família de scouting/informação "not available prior"; Termos/Suporte "Exposing information that's intentionally obfuscated"                                                                    | **Proibido/cinza-alto** (é inferência, mas sobre informação que o jogo não mostra)                                                                                     | Alto                                      |
| Recomendar aprimoramentos ao vivo com colocação média e tiers (`augment-stats.json`)                                                      | "suggestions based on current game state"; "win rates for Legends and Legend-based Augments"; nota Overwolf sobre dados de aprimoramentos                                                            | **Cinza-alto** (estatística pré-jogo é aceita; escolha ao vivo com as 3 cartas lidas da tela é sugestão por estado atual; dado de aprimoramento sob restrição incerta) | Médio-alto                                |
| Dados de meta (comps, itens, builds) como referência                                                                                      | "Having a static recommendation for a player pre-game is acceptable"; overlays com "static data that is available prior to the game"                                                                 | **Permitido pelo texto**, se apresentado como referência e sem ligar ao estado atual                                                                                   | Baixo                                     |
| Interface web local em outra janela/monitor (não overlay no jogo)                                                                         | Regras de conteúdo valem do mesmo jeito; não injeta nada                                                                                                                                             | Menos exposto tecnicamente que overlay injetado                                                                                                                        | Reduz risco técnico, não o de conteúdo    |
| Automação de entrada (cliques/teclas)                                                                                                     | "Taking actions on your behalf (botting or scripting)"                                                                                                                                               | O helper não faz isso (busquei `SendInput`, `mouse_event`, `PostMessage`, `click` nos scripts de leitura/servidor e não achei)                                         | Não se aplica; manter assim               |
| Leitura de memória, DLL, hook, depurador                                                                                                  | Vanguard FAQ + aviso 2026-10-06                                                                                                                                                                      | O helper se proíbe disso (`FONTES-DE-DADOS.md`)                                                                                                                        | Não se aplica; manter assim               |

Observação sobre o `.sentry-native/__sentry-event`: é arquivo de relatório de falhas do Sentry que o jogo regrava. Nenhuma regra da Riot o cita. Não é API suportada, pode mudar sem aviso e o arquivo contém nome de usuário e máquina (o helper diz não ler esses campos). Risco regulatório baixo, fragilidade alta.

### 3.5 Contradição entre texto e prática

- O texto da Riot diz que overlays só podem mostrar "static data that is available prior to the game" e que apps não podem "make suggestions based on the player's current game state".
- Overlays populares fazem: comps recomendadas pelo lobby (MetaTFT), nota por carta da loja e win odds (MetaBot), BUY/CONSIDER/SKIP e quando rolar (TFTSense), `opponent_board_pieces` exposto no GEP da Overwolf.
- Explicações possíveis [INFERÊNCIA]: (1) a política escrita vale para produtos com chave de API e Overwolf negocia termos próprios; (2) a Riot tolera sem aprovar; (3) a política não foi atualizada. Nenhuma foi confirmada por texto da Riot. **Não deduzir permissão a partir da existência dessas ferramentas.**

---

## 4. Opções de menor risco (para o dono do helper decidir)

Ordenadas do que mais reduz risco de conteúdo ao que menos.

1. **Separar "referência" de "decisão ao vivo".** Manter na UI: odds por nível, tamanho do pool, receitas de itens, comps e builds do patch, tabelas de economia (juros). É o que o texto chama de dado "available prior to the game". Mostrar o que é conhecimento, não o que fazer agora.
2. **Remover scouting de rivais durante a partida.** Não ler `boardPieces` dos outros jogadores nem gravar `scouting-captures.jsonl` durante a partida; ou guardar e só exibir **depois** da partida (revisão). É a regra mais literal: "Scouting - tracking the champions opponents have on their boards."
3. **Remover estimativa do banco rival e "chance de rolar descontando rivais".** Usar só pool teórico menos o que **você** possui (informação própria), como faz a calculadora estática.
4. **Trocar "recomendação" por "destaque de decisão".** A Developer Policy aceita produtos que "may highlight decisions that are important" e dão "multiple choices". Exemplo: "você tem 50+ ouro: decisão de juros/rolagem à vista" com as opções e custos, sem ordenar uma ação única "faça X". É menos "dictate player decisions", ainda que a fronteira seja da Riot.
5. **Mostrar sugestões depois, não durante.** Modo pós-jogo: reconstruir a partida com `TFT.log`/histórico e apontar erros. Casa com "see you play the game first, then analyze and reflect later" (suporte, 2025-02-10) e com "Training tools that allow players to view their own match histories".
6. **Usar a API oficial para dados que ela oferece** (match history TFT por RSO/chave) para análises do próprio jogador; registrar o produto no Developer Portal se combinar LCU com a API. A Developer Policy pede "supported services ... for data ingestion". Para uso estritamente pessoal, a Riot permite chave pessoal ("Personal sites", "Creating a proof of concept").
7. **Aprimoramentos**: não exibir taxa de colocação por aprimoramento ao vivo; manter só descrição e sinergias (estático). Verificar a origem dos dados (NoxuTFT/MetaTFT) frente à restrição atual antes de redistribuir.
8. **Perguntar à Riot por escrito** (Developer Relations / suporte) com o caso exato. Ninguém mais pode dar a resposta definitiva; os próprios vendors reconhecem "Only Riot rules on bans" ([TFTSense](https://tftsense.gg/study-hall/are-tft-overlays-safe/)).
9. **Manter o que já é boa prática**: sem leitura de memória/injeção/hook, sem automação de entrada, só GET no LCU, sem alterar arquivos do jogo, sem publicar/vender o helper com selo de aprovação.

---

## 5. Regras de decisão de conformidade (formato SE / ENTÃO / PORQUE)

- SE o dado exibido depende do **estado atual da partida** (ouro, nível, loja, banco, tabuleiros) E a saída é uma **ação sugerida** ENTÃO tratar como alto risco de política PORQUE "An app cannot make suggestions based on the player's current game state as that information is dynamic" [developer.riotgames.com/docs/tft].
- SE a funcionalidade rastreia o que os rivais têm em campo durante o jogo ENTÃO removê-la da fase de partida PORQUE "Scouting - tracking the champions opponents have on their boards" está na lista de não aprovados e overlays "may not track your opponent's champions/plays" [idem].
- SE um número depende de unidades em posse dos rivais (pool descontado) ENTÃO calcular só com o que o próprio jogador possui PORQUE o post da Anti-Cheat (secundário) lista "percentage of rolling a unit based on units in play across all boards" e a DevRel 2019 critica "probability of rolling for an exact champion at any given time".
- SE a fonte é leitura de memória, injeção, hook ou depurador ENTÃO não usar, nem como fallback PORQUE o Vanguard FAQ diz "External tools reading memory will no longer work" e a Riot bloqueia por padrão desde 2026-10-06.
- SE a fonte é arquivo que o próprio jogo grava, LCU por GET ou captura de tela ENTÃO é cinza, não proibida por texto encontrado; classificar a funcionalidade pelo que ela **mostra**, não pelo método PORQUE nenhum documento da Riot que li cita OCR, logs ou captura de tela.
- SE houver ação sobre o jogo (clicar, comprar, rolar) automatizada ENTÃO nunca PORQUE "Taking actions on your behalf (botting or scripting)" e Termos 7.1(11).
- SE for distribuir o helper ENTÃO registrar no Developer Portal se usar API ou LCU junto, e não usar selo "Riot Approved" PORQUE "All products must be registered in, and audited by Riot Games through the Developer Portal" [developer policy] e o LCU exige "we need to know about it".
- SE a Riot publicar regras sobre o cliente Unreal do TFT (alvo 2026-11-03) ENTÃO reavaliar fontes (LCU, logs, `TFTEoGStats.json`, `.sentry-native`) PORQUE nenhuma documentação publicada cobre APIs locais nesse cliente.

---

## 6. Lacunas e incertezas

- Não consegui abrir: o post da Anti-Cheat (domínio fora do ar), páginas de Mobalytics (403), Dot Esports (403), `support-developer.riotgames.com` (403), LoLChess (404), MetaTFT download (só título). Citações dessas fontes são indiretas.
- Não achei texto da Riot sobre: leitura de tela/OCR, leitura de logs e arquivos locais do TFT, ou o status de overlays que não leem memória.
- Não achei relato verificável de ban em TFT por overlay, por OCR ou por recomendação.
- A data exata do post da Anti-Cheat não foi confirmada.
- Não confirmei se o jogador consegue ver o banco dos rivais no jogo; o `FONTES-DE-DADOS.md` do projeto diz que o jogo não expõe, e usei isso como premissa.
- Funcionalidades de Blitz, TFTAcademy e Mobalytics vêm de listagens/terceiros, não das páginas oficiais.
- O estado atual da restrição de dados de aprimoramentos é contraditório entre fontes (ver 3.2 j).

---

## 7. Como isso se aplicaria a um assistente de decisão

Quais dados o sistema precisaria por tipo de uso, já marcando o que a política deixa mais ou menos exposto:

| Uso                                                                            | Dados necessários                                  | Estado da política                                            |
| ------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------- |
| Referência estática (odds por nível, pool por custo, receitas, comps do patch) | Nível/set/patch (para escolher a tabela), catálogo | Dentro do que a Riot chama de estático/pré-jogo               |
| Calculadora "o que eu tenho versus o que falta"                                | Suas cópias (tabuleiro + reserva), pool teórico    | Informação própria; sem rivais                                |
| Destaque de decisão (juros, nível, dinheiro) sem ordem única                   | Ouro, nível, XP, estágio, HP próprio               | Mais próximo de "highlight decisions"; ainda usa estado atual |
| Recomendação ao vivo de ação (rolar/nível/comprar)                             | Ouro, nível, XP, loja, banco, HP, estágio          | Contraria "suggestions based on current game state"           |
| Disputa de pool com rivais                                                     | Tabuleiros/bancos rivais, pool                     | Contraria scouting/rolling-odds                               |
| Revisão pós-jogo                                                               | `TFT.log`, histórico, API de match history         | Alinha com "Training tools" e "analyze and reflect later"     |

Se o objetivo do projeto for continuar com decisão ao vivo, os pontos acima deixam claro que o usuário assume risco de política não resolvido por texto da Riot; a opção mais conservadora é migrar as saídas ao vivo para referência estática e deixar a análise específica para depois da partida.

## Fontes consultadas (resumo)

- Riot, Developer Policy geral: https://developer.riotgames.com/policies/general (lido 2026-10-10; "LAST UPDATED: MAY 29, 2025")
- Riot, TFT docs / política de apps: https://developer.riotgames.com/docs/tft (lido 2026-10-10)
- Riot, LoL/LCU docs: https://developer.riotgames.com/docs/lol
- Riot Support, Third Party Applications (2025-02-10): https://support.riotgames.com/en-us/riot/events/third-party-applications
- Riot Support, acesso à memória (2026-09-29; vigência 2026-10-06): https://support.riotgames.com/en-us/riot/performance/game-memory-access-removed-for-third-party-apps
- Riot ToS (modificado 2024-12-01): https://www.riotgames.com/en/terms-of-service
- Riot DevRel, TFT match history (2019-09-26): https://www.riotgames.com/en/DevRel/teamfight-tactics-match-history
- Riot DevRel, nova política e match history (2019-10-28): https://www.riotgames.com/en/DevRel/new-game-policy-and-tft-match-history
- Riot DevRel, Vanguard FAQ (2024-04-01): https://www.riotgames.com/en/DevRel/vanguard-faq
- Riot Support, migração Unreal (alvo 2026-11-03): https://support.riotgames.com/en-us/tft/client/tft-unreal-engine-migration-faq
- Overwolf, eventos TFT: https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/teamfight-tactics ; newsletter 2024-11-29: https://blog.overwolf.com/developers-november-newsletter-user-reviews/
- Overwolf MetaTFT: https://overwolf.com/app/metatft.com-metatft ; MetaBot: https://metabot.gg/en/download/teamfight-tactics ; TFTSense: https://tftsense.gg/ e https://tftsense.gg/study-hall/ (vários); tactics.tools: https://tactics.tools/
- Dexerto 2023 (Legends): https://www.dexerto.com/league-of-legends/teamfight-tactics-runeterra-reforged-to-prevent-third-party-sites-from-sharing-data-2173352/
- Dot Esports 2023 (aprimoramentos, via busca): https://dotesports.com/tft/news/mortdog-admits-tfts-ban-on-augment-stats-sites-was-naive-as-riot-changes-course
- RiftFeed 2024-05-22 (lobby revealers): https://riftfeed.gg/lol-news/lol-riot-clarifies-stance-on-lobby-revealers-amidst-current-account-ban-wave
- Post Anti-Cheat TFT (não aberto): https://boards.na.leagueoflegends.com/en/c/developer-corner/YvAMskwh-our-approach-to-teamfight-tactics-third-party-tools
