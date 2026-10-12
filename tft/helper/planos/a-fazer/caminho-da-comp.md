# Caminho da comp: a recomendação guia early, mid e late

Pedido do usuário (2026-10-11): "A primeira coisa no assistente vai ser a recomendação, e ela vai guiar para a melhor comp
com base na partida. Sem mais campeões aleatórios chegando: ele vai guiar as melhores comps com base na partida. E toda
comp tem um early game (dá para verificar na MetaTFT), então o sistema guia o early, o mid e o late."

Estado: **a fazer**. Executor: o orquestrador, direto, com agentes só para pesquisa ou medição isolada.

## 1. O que existe hoje

- **Uma comp manda** (a fixada ou, sem ela, a recomendada pela colocação esperada E), mas o tabuleiro que a Formação mostra
  é o **final** (nível-alvo). No early, o que entra em campo são "temporários" escolhidos pela força do momento
  (`core/board/interim.mjs`) entre o que você tem e o que a loja traz. Daí a sensação de "campeões aleatórios": nada liga
  esses temporários ao caminho daquela comp.
- A meta (`meta-comps.json`, `comps_data` da MetaTFT) traz, por comp: tabuleiro final (`units`), builds, `stars` (quem
  costuma ser 3★), `levelling` ("lvl 6" = reroll; "Fast 8"; …), contagem, média e tendência. **Não traz tabuleiros de
  early nem de mid.**

## 2. O que a pesquisa mostrou

- **MetaTFT:** os tabuleiros de early ("Early Comps": melhores tabuleiros por nível 4–7, com a taxa de vitória da rodada e a
  colocação final) existem, mas só no app e para assinantes no site ([MetaTFT App](https://www.metatft.com/download),
  [Set 13 Early Game Boards](https://www.metatft.com/guides/set-13-early-game-boards)). A API pública que o helper já usa
  (`tft-comps-api/comps_data`, `tft-explorer-api`) só tem tabuleiros **finais**; tentei os endereços óbvios de fases (404/500).
  **Não vamos raspar conteúdo pago.** Se o usuário tiver acesso, a decisão de usar é dele (ver §7).
- **Guias:** os guias de comp descrevem o caminho em fases — o Sett Executioner do Set 18 começa com Karma/Yorick/Yunara,
  soma Rakan/Ornn/Fiddlesticks, entra Azir no 7 e transiciona no 8, com Alistar segurando a vaga de Gnar
  ([Gamewave](https://gamewave.fr/tft/tft-la-composition-sett-avec-executeur-comment-la-jouer-set-18/)). A Mobalytics mostra
  "early" (~4 unidades) e "mid" (~6) por comp e recomenda não travar a comp cedo demais
  ([Mobalytics overlay](https://mobalytics.gg/blog/how-to-use-the-mobalytics-tft-overlay/),
  [erros do Set 18](https://mobalytics.gg/tft/guides/mistakes-to-avoid-in-set-18)). Para o Set 18, "2 Ravager + frontline"
  é citado como abertura forte ([BunnyMuffins](https://bunnymuffins.lol/openers/)).
- **Dados próprios (o melhor que temos sem pagar):** `tft/data/scouting-captures.jsonl` tem ~19,9 mil capturas de
  tabuleiro de **todos os 8 jogadores** ao longo das partidas (hora, vida, peças com estrela e itens), e `lobby-boards.jsonl`
  e `match-history.jsonl` têm os tabuleiros finais e a colocação. Dá para reconstruir **como quem terminou em cada comp
  chegou lá**, rodada a rodada, e quais desses caminhos acabaram no top 4.

## 3. O desenho

### 3.1 Fases

| Fase  | Quando                     | O que o assistente guia                                                                                                                                                                      |
| ----- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Early | 2-1 → 3-2 (nível 3–6)      | **Direção**, não comp travada: 2–3 comps compatíveis com as suas peças e componentes; o tabuleiro de early do caminho delas (peças baratas da comp + pontes de sinergia); economia/sequência |
| Mid   | 3-2 → 4-2 (nível 6–8)      | **Compromisso**: a comp escolhida (fixada ou recomendada); o tabuleiro de mid do caminho (núcleo + carry 1★/2★); onde rolar (reroll) ou quando subir (Fast 8)                                |
| Late  | 4-2 em diante (nível 8–10) | O tabuleiro **final** (o de hoje), 3★/2★-alvo, itens completos, ajuste ao lobby                                                                                                              |

A fase sai do estágio e do nível lidos (com o estilo da comp: reroll fecha o mid mais cedo, Fast 9 estica o mid).

### 3.2 O caminho de cada comp: `path = { early, mid, late }`

Cada fase tem um tabuleiro-alvo (peças + estrelas), o carry provisório que segura os itens, os traços ativos e o gatilho da
próxima fase. Fontes, em ordem de confiança:

1. **Medido nos dados próprios** (P2): para os jogadores que terminaram na comp X, o tabuleiro mais frequente (e o de melhor
   colocação) em cada fase, com contagem; "medido" só com amostra mínima.
2. **Derivado da comp** (P3), quando a amostra não basta: early = as peças de custo 1–2 da própria comp + as **pontes**
   (peças baratas que ativam os mesmos traços), mid = o núcleo de custo ≤ 3 + o carry; late = o final. Política declarada.
3. **(Opcional) MetaTFT Early Comps**, só se o usuário tiver acesso e decidir usar (ver §7).

O caminho é o que dá nome aos "temporários": no early, quem entra é **a ponte do caminho daquela comp**, não uma peça
aleatória; o `interim.mjs` passa a preferir peças do caminho na fase atual e só cai na força pura quando o caminho não tem
ninguém para a vaga.

### 3.3 A recomendação primeiro

- **Early:** a recomendação mostra a **direção** (as 2–3 comps cujo caminho combina com o que você tem: peças, estrelas e
  componentes — o mesmo E de hoje, mas na fase), e a Formação mostra o **tabuleiro de early** delas. Nada de travar cedo.
- **Mid:** uma comp manda (fixada ou recomendada, com a regra de troca de plano); a Formação mostra o tabuleiro de mid.
- **Late:** o final, como hoje.
- **Tudo segue a fase:** a decisão da rodada (compras, nível, rolagem: `core/turn`), os alvos de rolagem (`core/roll/hunt`),
  os itens (o carry provisório da fase segura os itens do carry final), o carrossel, o overlay e o "Copiar código" (código
  do tabuleiro da fase e do final).

## 4. Passos

| #   | O que                                                                                                                                                                                       | Arquivos                                                   | Pronto quando                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P1  | Fase da partida (early/mid/late) a partir do estágio, do nível e do estilo da comp                                                                                                          | `core/comps/phase.mjs` (novo)                              | teste por estilo (reroll, Fast 8, Fast 9)                                                |
| P2  | Medição dos caminhos: reconstruir, das capturas, o tabuleiro por fase de quem terminou em cada comp (casar o final com a comp da meta pelo maior número de peças), com colocação e contagem | `scripts/comp-paths.mjs` (offline) → `comp-paths.json`     | relatório: quantas comps têm caminho medido, amostra por fase                            |
| P3  | Caminho derivado para as comps sem amostra (peças baratas + pontes de traço; núcleo ≤ 3)                                                                                                    | `core/comps/path.mjs`                                      | teste: todo `path.early` tem 4–5 peças, ≥ 2 da comp, traços da comp ativos               |
| P4  | Motor por fase: E da comp e o "alcance" medidos contra o tabuleiro da fase (não só o final); direção de 2–3 comps no early                                                                  | `engine.mjs`, `core/comps/reach.mjs`                       | golden explicados; no 2-x o ranking reflete o que você já tem                            |
| P5  | Temporários do caminho: `interim.mjs` prefere a ponte da fase                                                                                                                               | `core/board/interim.mjs`, `stage.mjs`                      | teste: no early, a vaga vazia recebe a ponte do caminho, não a peça mais forte aleatória |
| P6  | Telas: Formação com "Early · Mid · Late" (a fase atual destacada, as outras ao lado); painel da comp no overlay com a fase; "Copiar código" da fase e do final                              | `v2/js/model.js`, `ui/board.js`, `overlay/hud/comp.mjs`    | testes de modelo                                                                         |
| P7  | Decisão da rodada por fase: compras e rolagem buscam o tabuleiro da fase                                                                                                                    | `core/turn/turn.mjs`, `core/roll/hunt.mjs`, `strategy.mjs` | teste: no early não rola por peça de custo 4 do final                                    |
| P8  | Replay das partidas gravadas (GEP + capturas): a fase, a direção e a Formação rodada a rodada; checar "peça aleatória" (temporário fora do caminho)                                         | `scripts/replay-check.mjs`                                 | zero temporário fora do caminho quando o caminho tem peça para a vaga                    |

## 5. Riscos

- **Amostra própria pequena** (dezenas de partidas, ~60 comps): muitos caminhos serão derivados, não medidos; a tela marca a
  origem ("medido em N partidas" / "derivado").
- **Casar o final com a comp da meta** é aproximado (maioria das peças); os tabuleiros de quem pivotou no meio contaminam o
  early — filtrar quem manteve o núcleo desde o mid.
- **Travar cedo demais** é erro conhecido: no early a recomendação é direção (2–3 comps), não uma comp só.

## 6. Dependências

Antes de começar: commitar a rodada atual (decisão da rodada, Luva de Ladrão, "Copiar código", correções dos agentes) e o
usuário reiniciar o servidor para validar numa partida. P1–P3 não mexem no motor; P4–P7 mexem e devem vir um por vez, com
o replay (P8) como prova.

## 7. Decisão do usuário

- Usar os tabuleiros de early da MetaTFT (app/Patreon) só se você tiver acesso e quiser: seria uma fonte a mais, lida do
  que o seu app já baixa ou exportada por você — nunca raspagem do site pago.
- Aceitar que, até haver amostra, parte dos caminhos é derivada (política) e marcada como tal.
