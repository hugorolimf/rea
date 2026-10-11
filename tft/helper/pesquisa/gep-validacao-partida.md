# Validação do `gep-reader.mjs` contra uma partida completa gravada pelo TFTAcademy

Data da análise: 2026-10-11. Partida: `BR1_3291836580`, Set 18, 27 min (1608 s entre o primeiro e o último evento), 3455 eventos, colocação 6.
Método: replay offline e somente leitura. O `tft-events.db` e o `-wal` foram copiados para uma pasta temporária, as linhas da partida
foram passadas **em ordem de `id`** pelas funções puras do leitor (`applyGepEvent`, `parseGold`, `parseXp`, `parseShop`, `parseBench`,
`parseItemBench`, `parseAugmentOffer`, `parseAugmentPickedList`, `evaluateGep`) com o catálogo real do helper (74 campeões, 507 itens,
351 Wisps, 2077 aprimoramentos), e o leitor SQLite completo (`gepReader`) foi exercitado sobre uma cópia com os eventos entrando em lotes
(um por rodada), para validar a leitura incremental. Nada foi escrito no banco original, o servidor da porta 3218 não foi tocado, nenhum
`POST` foi feito e as cópias (que contêm nomes de jogadores) foram apagadas ao fim. Este relatório só traz ids de jogo (`DA_*`), nunca nomes,
tags ou ids de conta.

Limite do método: não há verdade de referência independente (o `TFTEoGStats.json` local é de uma partida posterior). A validação é por
**consistência interna entre fontes do mesmo jogo**: loja x ouro, banco de itens x itens equipados, nível x roster, vida x roster, loja x
falas de compra do `TFT.log`.

## 1. Esquema e identificação da partida (confirmado)

- `events`: `id` (crescente), `game_id`, `timestamp` e `created_at` (segundos Unix), `event_type`, `player_id`, `round` (estágio-rodada
  corrente), `stage_type`, `feature`, `key`, `data` (JSON em texto), `category`. A consulta por par `feature.key` do leitor é a correta
  (`me` também existe em outras features).
- `games`: `started_at`, `ended_at` (esta partida terminou com `ended_at` preenchido, 6 s depois do último evento), `match_id`
  (`BR1_<gameId>`), `set_number` 18.
- A primeira linha (`round_type` 1-1) tem `timestamp` 22 s ANTES do `started_at` e `created_at` 22 s depois do `timestamp`: é o instantâneo
  de início. `timestamp` nunca decresce com o `id` (0 inversões). O último evento é `match_info.match_state {"in_progress":false}`.

## 2. Cobertura de eventos (contagem por `feature.key`)

| Par                                                                                                 |         n | Usado pelo leitor                                     |
| --------------------------------------------------------------------------------------------------- | --------: | ----------------------------------------------------- |
| `me.gold`                                                                                           |       227 | sim                                                   |
| `me.xp`                                                                                             |        52 | sim                                                   |
| `store.shop_pieces`                                                                                 |       132 | sim                                                   |
| `store.shop_visible`                                                                                |        14 | sim                                                   |
| `bench.bench_pieces`                                                                                |       165 | sim                                                   |
| `bench.item_bench`                                                                                  |       435 | sim (só a linha local)                                |
| `roster.player_status`                                                                              |       251 | só para achar o jogador local                         |
| `match_info.round_type`                                                                             |        27 | sim (estágio)                                         |
| `match_info.match_state`                                                                            |         1 | sim (fim)                                             |
| `augments.me`                                                                                       |        12 | sim (oferta)                                          |
| `augments.picked_augment`                                                                           |         3 | sim (escolhidos)                                      |
| `board.board_pieces`                                                                                |        98 | **não** (ver seção 8)                                 |
| `me.health`                                                                                         |        29 | **não**                                               |
| `me.rank`, `me.player_rank`                                                                         |      1, 1 | não                                                   |
| `carousel.carousel_pieces`                                                                          |         3 | **não** (decisão pendente)                            |
| `match_info.opponent`                                                                               |        18 | **não** (decisão pendente)                            |
| `match_info.battle_stats` (1803), `battle_start/end/state` (23, 24, 47), `round_start/end` (26, 23) |      1946 | não                                                   |
| `match_info.round_outcome`, `board.opponent_board_pieces`, `match_stats.board_players`              | 21, 18, 1 | **nunca** (rivais; nem foram parseados nesta análise) |

## 3. Replay ponto a ponto

O banco de itens, o roster e o resto foram conferidos evento a evento. Amostra do que o leitor completo (`gepReader.status`) devolveu
com os eventos entrando em lotes (um lote por rodada; `*` = zero inferido de `{}`; loja: C campeão, W Wisp, `-` vendida):

| t (s) | estágio | ouro | nível | XP    | loja                    |                 reserva | banco (pilhas totais / itens montáveis) |
| ----: | ------- | ---: | ----: | ----- | ----------------------- | ----------------------: | --------------------------------------- |
|    73 | 1-3     |    2 |     2 | 0/2   | CCCCC                   |                       3 | 2 / 0                                   |
|   112 | 1-4     |   0* |     3 | 0/6   | `---C-`                 |                       9 | 5 / 1                                   |
|   246 | 2-2     |    9 |     4 | 2/10  | `CCC-C`                 |                       4 | 5 / 1                                   |
|   585 | 3-1     |   42 |     5 | 4/20  | `-CCCC`                 |                       6 | 8 / 3                                   |
|   996 | 4-1     |   50 |     6 | 32/36 | `CC-C-`                 |                       7 | 10 / 5                                  |
|  1091 | 4-2     |   77 |     7 | 2/56  | `CC-CC`                 |                       3 | 8 / 1                                   |
|  1392 | 4-7     |   0* |     8 | 6/68  | `C-CCC`                 |                       7 | 7 / 2                                   |
|  1582 | 5-3     |   0* |     8 | 12/68 | `CCC-C`                 | 1 (+1 fora do catálogo) | 5 / 0                                   |
|  1608 | 5-3     |   0* |     8 | 12/68 | `-----` (visível=false) |                       1 | 5 / 0                                   |

61 s depois do último evento a fonte vira `obsoleto / sem-eventos-recentes`; com `ended_at` preenchido, `ausente / partida-encerrada`;
com `inMatch: false`, `fora-de-partida`; com outro `gameId`, `outra-partida`. O leitor incremental reproduziu exatamente o mesmo estado
do reducer puro.

### 3.1 Ouro (227 eventos)

- Texto numérico (`"2"`), sem valor inválido. `{}` apareceu 4 vezes e **é sempre 0**: 2→1→`{}` (t+92), 4→`{}` (t+146, junto com a compra
  de XP: nível 4 e `xp_max` mudando), 3→`{}`→4 (t+1378) e 1→`{}` (t+1548). O reducer o trata como 0 inferido (`inferredZero`) porque já há
  rodada e a partida não terminou. Em nenhuma das 4 vezes ele ocorreu no reset de início/fim.
- Mínimo 1, máximo 85 (nunca negativo, nunca acima de 999).
- Não há evento antes de t+44 (primeira mudança, ouro 2): nos primeiros ~44 s o GEP não diz nada do ouro (o inicial 0 não é emitido).
- Cruzamento com a loja: 54 trocas de carta para `Sold`; **50 casam exatamente com uma queda de ouro igual ao custo do campeão** (±2 s). As 4
  restantes são as 4 cartas que viram `Sold` no instante da eliminação (t+1608), não compras.

### 3.2 Nível e XP (52 eventos)

- Estrutura `{"level","current_xp","xp_max"}`; todos os 52 viram `"atual/total"` (nenhum com `atual > total`). O **nível 1 inicial não é
  emitido**: o primeiro evento é nível 2, `0/2`, em t+44. Nível nunca decresce (2 → 8). `roster.player_status[local].xp` é igual ao nível em
  251 de 251 eventos (confirma o nível, não traz o nível 1 nem o XP).
- Ao subir de nível saem DOIS eventos no mesmo segundo: primeiro `{nível novo, 0, xp_max antigo}`, depois `{nível novo, 0, xp_max novo}`
  (ex.: nível 4 `0/6` e logo `0/10`). O reducer lê as duas linhas do lote juntas, então o estado transitório quase nunca é visto; se for
  lido entre as duas, o XP mostra o total antigo por menos de 1 s. Tabela observada de `xp_max`: nível 2 → 2, 3 → 6, 4 → 10, 5 → 20,
  6 → 36, 7 → 56, 8 → 68.

### 3.3 Loja (132 eventos)

- Sempre 5 espaços (132 de 132), nenhum nome vazio. Vendida = `{"name":"Sold"}` (78 espaços vendidos). Reroll troca os 5; compra troca 1.
- `store.shop_visible` (14 eventos, `"true"`/`"false"`): a loja fica escondida durante a escolha de aprimoramento (2-1, 3-2, 4-2) e o
  carrossel (2-4, 3-4, 4-4) e some no fim. 5 eventos de loja chegaram enquanto o último `visible` ainda era `false`, todos com cartas e no
  mesmo segundo do `visible=true` seguinte (a loja nova é gravada um pouco antes de ser exibida; a ordem dentro do segundo não é garantida).
  O `mergeGep` ignora a loja só quando o último `visible` lido é `false`, então nesses casos o lote lido junto já traz o `true`.
- Wisps entram como cartas comuns (`DA_*18`, `DA_18_*`): 28 ocorrências, 24 no `slot_5` e uma loja de **5 Wisps** (5-1) com os cinco espaços.
- Última loja da partida (t+1608, eliminação): cinco `Sold`; o `shop_visible=false` chega no mesmo segundo.

### 3.4 Reserva (165 eventos)

- Objeto `cell_1..cell_9` (`name`, `level` como texto "1".."3", `item_1..3`). Máximo 9 células (nunca 10), estrelas 1 a 3. Um payload `{}`
  (reserva vazia) não ocorreu nesta partida (sempre houve ao menos uma peça); o reducer o trataria como reserva vazia, não desconhecida.
- `DA_AnvilComponent` ocupa uma célula da reserva (16 ocorrências) e **não é campeão**: cai em `unknown` (`bench.unknown`), nunca vira
  unidade. Correto para o motor; vale lembrar que a reserva tem uma célula ocupada por algo que não é peça.
- Todos os itens equipados nas peças (496 ocorrências) casam com o catálogo.

### 3.5 Banco de itens e linha do jogador local (435 eventos)

- Cada evento tem **8 linhas** (uma por jogador: `summoner`, `tag_line`, `bench_items`), em **ordem instável**: a linha local apareceu nas
  posições 0, 1, 2, 3, 4 e 5. Portanto o índice não serve; só a identidade serve.
- Identidade local: `roster.player_status` tem exatamente um `localplayer: true` em 251 de 251 eventos, com o mesmo nome e tag do início ao
  fim (uma identidade distinta). `parseLocalIdentity` + comparação sem diferenciar caixa acharam **exatamente 1 linha em 435 de 435 eventos**
  (0 sem linha, 0 duplicadas). Em 8 eventos o `item_bench` chegou antes do primeiro roster; o `pendingItemBench` resolveu todos.
- Validação empírica de que a linha é a do jogador (não de um vizinho): para cada uma das 8 linhas contei as quedas de itens montáveis do
  banco que coincidem (±2 s) com um novo item equipado em peça do jogador local (`board_pieces` + `bench_pieces`): linha local 11 de 22
  quedas; rivais 0 a 2 de 14 a 33. A linha local é a que acompanha os itens equipados.
- Estrutura: `{name, count}`; consumíveis empilham (`DA_Consumable_ItemRemover` chegou a ×5). Soma de contagens até 12 (com consumíveis e o
  seletor), mas **pilhas distintas no máximo 9** e itens não consumíveis no máximo 7; portanto o limite de 10 vale por pilha, não por
  contagem. O reducer repete o item `count` vezes em `bank`, como o leitor de tela.

### 3.6 Estágio

`round_type` (27 eventos, `stage`, `name` PVE/PVP/Carousel, `type`, `native_name`): 1-1, 1-3, 1-4, 2-1 ... 5-3. **Não há 1-2** nesta partida
(o formato `S-R` se repete; o 1-1 vem como instantâneo de início). O estágio do helper continua vindo do arquivo do Sentry (`game-log`), o GEP
só preenche se faltar.

## 4. Mapeamento ao catálogo do helper

| Domínio                                                | Casaram |   Total |   Taxa | Não casaram (ids de jogo)                                                     |
| ------------------------------------------------------ | ------: | ------: | -----: | ----------------------------------------------------------------------------- |
| Loja: campeões (ocorrências)                           |     553 |     553 |  100 % | -                                                                             |
| Loja: Wisps (etiqueta `{5b609ae2}`)                    |      28 |      29 | 96,6 % | `DA_18_MinorBloodRitual` (1 carta)                                            |
| Reserva: campeões                                      |     968 |     984 | 98,4 % | `DA_AnvilComponent` (16; não é campeão)                                       |
| Tabuleiro: campeões                                    |     628 |     628 |  100 % | -                                                                             |
| Itens equipados em peças (reserva + tabuleiro)         |     496 |     496 |  100 % | -                                                                             |
| Banco de itens (somando `count`, linha local)          |    2992 |    3497 | 85,6 % | `DA_Consumable_TinyChampionDuplicator` (375), `DA_Riftbeast18_Selector` (130) |
| Banco de itens (nomes distintos)                       |      19 |      21 | 90,5 % | os mesmos dois                                                                |
| Aprimoramentos (oferta + escolhidos, nomes distintos)  |      15 |      15 |  100 % | -                                                                             |
| Carrossel: campeões / componentes (só para documentar) | 31 / 31 | 31 / 31 |  100 % | -                                                                             |

Padrão dos ids confirmado: campeões `DA_18_*` (e os de monstro `DA_<Nome>18`, ex. `DA_Cinderling18`, `DA_Gromp18_AP`), itens `DA_*`,
componentes `DA_Component_*`, consumíveis `DA_Consumable_*`, aprimoramentos `DA_*` com o mesmo id de `augments.json`.

O catálogo de itens está defasado em dois nomes (um duplicador consumível "Tiny" e o seletor `Riftbeast18`), o que o leitor conta em
`items.unknown` (não é erro: nunca inventa). Eles não afetam o motor (um é consumível; o `isConsumable` do helper já o reconhece pelo prefixo
`Consumable_`, mas o leitor só o trata como "conhecido" se estiver no catálogo). Recomendação: regenerar `items.json`/`catalog.json` com o
patch atual (`build-items.mjs`) em vez de relaxar o leitor.

## 5. Aprimoramentos: formato real e correção feita

Formato **observado** (antes só se sabia pelo código do TFTAcademy):

- `augments.me` (oferta): `{"augment_1":{"name"},"augment_2":{"name"},"augment_3":{"name"}}`. Chega no início da rodada de aprimoramento (2-1, 3-2,
  4-2). **A cada reroll sai um evento novo** com UMA carta trocada (3 eventos por rodada: oferta inicial, reroll da carta 2, reroll da carta 3);
  ao escolher, vem um evento com os três nomes `""` (tela fechada). O leitor já tratava assim: vazia = `cards: []`.
- `augments.picked_augment` (a feature é `augments`, não `me`): `{"slot_1":{"name"},"slot_2":{"name"},"slot_3":{"name"},"slot_4":{"name"}}`,
  **CUMULATIVO**: o objeto inteiro com todos os escolhidos até agora, na ordem da escolha, espaços vazios com `""`, reenviado a cada
  escolha (1 nome, depois 2, depois 3). É emitido junto com o evento de oferta vazia (mesmo segundo). Três escolhas: `DA_BacklineBlueprint`
  (2-1), `DA_PandorasItemsI` (3-2), `DA_HeroicGrabBagPlusPlus` (4-2). O estágio gravado no leitor bate com a rodada de aprimoramento.
- O par `augments.picked_augment` já constava em `KEYS` (o leitor lê a feature correta). Com `slot_N` (e não `augment_N`) a regra antiga
  "último nome não vazio" acertava por acaso (o objeto é lido na ordem), mas **perdia os escolhidos anteriores** quando o leitor começa no
  meio da partida (só o último entrava).

Correções em `gep-reader.mjs` (mínimas):

1. Novo `parseAugmentPickedList(data, resolve)`: devolve TODOS os nomes do payload, em ordem (o payload é cumulativo).
2. O reducer (`case "augmentPicked"`) agora acrescenta cada nome ainda não visto, em ordem, cada um com o estágio de quando apareceu (antes:
   só o último nome). Verificado: replay completo e leitura "tardia" (só o último `picked_augment`) dão os mesmos 3 ids.
3. `FALLBACK_KEYS.picked_augment` aponta para `augments.picked_augment` (a feature real); `match_info.picked_augment` e `me.picked_augment`
   continuam aceitos por tolerância ao código do TFTAcademy (nunca vistos nos dados) e os comentários do arquivo foram atualizados.
4. Teste novo em `tests/gep-reader.test.mjs` (cumulativo, repetido, leitura tardia); os 11 testes de aprimoramento passam. A suíte completa
   não foi rodada (regra desta tarefa).
5. `FONTES-DE-DADOS.md`: formatos, cobertura, cadência, latência e "Pendente de partida ao vivo" atualizados (marcações [DER] retiradas
   do que agora é observado).

## 6. Invariantes

| Invariante                                      | Resultado                                                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ouro nunca negativo, ≤ 999                      | cumpre (1 a 85)                                                                                                                                                                                 |
| `{}` de ouro = 0 apenas em partida em andamento | cumpre (4 de 4)                                                                                                                                                                                 |
| Nível não decresce                              | cumpre (2 → 8)                                                                                                                                                                                  |
| `current_xp ≤ xp_max`                           | cumpre (52 de 52)                                                                                                                                                                               |
| Loja com 5 espaços                              | cumpre (132 de 132)                                                                                                                                                                             |
| Reserva ≤ 9 células                             | cumpre (máx. 9)                                                                                                                                                                                 |
| Peças no tabuleiro ≤ nível                      | cumpre (máx. 8 no nível 8)                                                                                                                                                                      |
| Estrelas de 1 a 3                               | cumpre                                                                                                                                                                                          |
| Banco de itens ≤ 10                             | cumpre **por pilha** (máx. 9); por contagem total chega a 12 (consumíveis empilhados), itens montáveis no máximo 7                                                                              |
| Linha local única em `item_bench`               | cumpre (435 de 435); posição na lista instável (0 a 5)                                                                                                                                          |
| Identidade local estável                        | cumpre (1 identidade, 251 de 251)                                                                                                                                                               |
| `timestamp` monotônico com o `id`               | cumpre                                                                                                                                                                                          |
| Vida ≥ 0                                        | **violada uma vez**: o último `me.health` é `-2` (dano acima do que restava, na eliminação); igual no roster. A vida decresce monotonicamente (94 → 8 → -2). Quem usar a vida deve limitar em 0 |
| `me.health` = vida do roster local              | cumpre (29 de 29)                                                                                                                                                                               |
| Itens equipados ≤ 3 por peça                    | cumpre                                                                                                                                                                                          |

## 7. Cadência e latência (calibração do limite de frescor de 60 s)

Intervalos (s) entre eventos consecutivos, resolução de 1 s:

| Série                                             |    n | p50 | p90 | p99 |    máx |
| ------------------------------------------------- | ---: | --: | --: | --: | -----: |
| Todos os eventos da partida (o que `lastTs` mede) | 3455 |   0 |   1 |   5 | **36** |
| Eventos que o leitor usa                          | 1318 |   0 |   3 |  16 |     41 |
| `me.gold`                                         |  227 |   1 |  22 |  62 |     95 |
| `store.shop_pieces`                               |  132 |   2 |  38 |  97 |    104 |
| `bench.bench_pieces`                              |  165 |   2 |  25 |  93 |     94 |
| `bench.item_bench`                                |  435 |   1 |   9 |  37 |     55 |
| `roster.player_status`                            |  251 |   1 |  24 |  78 |     97 |
| `me.xp`                                           |   52 |  12 |  68 | 107 |    107 |
| `board.board_pieces`                              |   98 |   3 |  54 | 109 |    109 |

- Os maiores silêncios de todo o app (36, 36, 35 s) caem nos carrosséis (2-4, 3-4, 4-4). Até 13 eventos no mesmo segundo.
- Os eventos são **por mudança** (sem batimento): um campo pode ficar 95 a 109 s sem evento e continuar valendo. Por isso o frescor é do app
  inteiro (`MAX(timestamp)` da partida), não por campo, e o limite de 60 s está certo: **24 s de folga sobre o pior silêncio medido (36 s)**.
  Reduzir para 45 s ainda caberia, mas com pouca margem; recomendo manter 60 s.
- Latência evento → banco: `created_at - timestamp` = 0 s em 3452 de 3455 linhas (1 s em 2; 22 s só na linha de instantâneo inicial).
- Latência evento → jogo: as 35 compras com falas no `TFT.log` (UTC, ms) foram pareadas com a troca da loja para `Sold`: o `timestamp` do GEP
  fica entre -1,3 e -0,4 s do instante da fala (um par a -4,8 s), ou seja, o GEP **não atrasa** (o intervalo negativo é o truncamento do
  timestamp em segundos). A precisão do GEP é de 1 s.

## 8. Campos fora do leitor atual (documentados, não integrados)

- **`me.health`**: número em texto (`"94"`), um evento por perda de vida (29), só depois da primeira perda (a vida 100 inicial não é emitida);
  chega a negativo no fim (`"-2"`). Igual ao `health` do jogador local em `roster.player_status`. **O sistema atual não o usa** (a vida vem do
  `TFTEoGStats.json`/snapshot do jogo e do rastreador de sequências).
- **`board.board_pieces`** (próprio jogador): mesmo formato da reserva, `cell_1..cell_28` (vistas 1 a 26), com `name`, `level` e `item_1..3`; 98
  eventos; 628 de 628 campeões e 496 de 496 itens casam. É o tabuleiro **ao vivo com itens por peça**. O `parseBench` o lê tal como está. O
  helper hoje usa o `TFTEoGStats.json` (regravado durante a partida) para o tabuleiro dos jogadores e nunca lê `board.board_pieces`. É uma
  integração simples e segura (mesmo jogador, mesmo formato) que o usuário pode autorizar depois.
- **`match_info.opponent`**: `{"name","tag_line"}` do adversário da rodada, um evento por rodada PvP (18; no começo da fase, ex.: 2-1, 2-2,
  2-3, 2-5...). Não há PvE nem carrossel. **O sistema não o usa.** Dado de rival (identifica o oponente da rodada): decisão de política pendente.
- **`carousel.carousel_pieces`**: `{"slot_1":{"name","item_1","item_2"},...}` com 13 campeões no primeiro carrossel (2-4) e 9 nos outros dois
  (3-4, 4-4); cada campeão traz o componente exposto em `item_1` (`DA_Component_*`) e `item_2` vazio; os 31 campeões e 31 componentes casam.
  Um evento por carrossel (sem atualizar quando alguém escolhe). **O sistema não o usa** (`carousel.mjs` recomenda com base na build, e o
  `TFT.log` só dá a contagem de itens recebidos). Decisão de política pendente.
- `roster.player_status`, `round_outcome`, `battle_stats` e `board.opponent_board_pieces` trazem dados de todos os jogadores e **não são usados**
  (o roster só serve para achar `localplayer`).

## 9. Veredito por campo: a leitura de tela (OCR/ícones) pode virar só verificação?

Hoje o leitor de tela fornece: ouro, nível, XP, loja, banco de itens e a oferta de aprimoramentos. Cobertura do GEP **nesta partida**:

| Campo (hoje na tela)                | GEP cobre integralmente?                                               | Lacuna                                                                               | Veredito                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Ouro                                | Sim, 227 eventos, `{}` = 0 confirmado 4 vezes, casa com 50/50 compras  | nenhum valor nos primeiros ~44 s (ouro inicial 0 não é emitido)                      | Dispensável com GEP fresco; manter a tela só para o começo e como reserva                                                     |
| Nível                               | Sim (2 → 8, igual ao roster)                                           | nível 1 inicial nunca é emitido; nível máximo (`xp_max` 0?) não aconteceu            | Dispensável com GEP fresco; o 1-1 vem da tela ou da regra                                                                     |
| XP                                  | Sim (`atual/total`, 52 de 52)                                          | transitório de <1 s ao subir de nível (total antigo)                                 | Dispensável; verificação opcional                                                                                             |
| Loja (5 cartas)                     | Sim, 132 eventos, 99,8 % mapeado, `Sold` e Wisps                       | 1 carta fora do catálogo (`DA_18_MinorBloodRitual`)                                  | Dispensável: mais exata que o OCR (que tem custo de nome)                                                                     |
| Banco de itens                      | Sim, linha local única em 435/435, contagens exatas                    | 2 ids fora do catálogo (consumível "Tiny" e seletor); atraso do catálogo, não do GEP | Dispensável com a linha local confirmada; manter a tela como verificação quando `identity` for `desconhecida` ou `divergente` |
| Oferta de aprimoramento             | Sim, `augments.me` (12 eventos, 3 rodadas, 15 de 15 nomes no catálogo) | nenhuma                                                                              | Dispensável (e escolhidos só existem no GEP)                                                                                  |
| Aprimoramentos escolhidos           | Só GEP (a tela nunca os lia)                                           | só o registro manual como alternativa                                                | GEP é a fonte; manual prevalece                                                                                               |
| Reserva (campeões, estrelas, itens) | Sim, 165 eventos (a tela não lia)                                      | `DA_AnvilComponent` ocupa célula                                                     | GEP é a única fonte                                                                                                           |
| Itens equipados por peça            | Sim, em reserva e tabuleiro (496/496)                                  | o helper só consome o da reserva; o do tabuleiro vem do `TFTEoGStats.json`           | Coberto pelo GEP (tabuleiro ainda não integrado)                                                                              |
| Estágio                             | Sim (`round_type`), mas sem 1-2                                        | fase (Planejamento/Combate) o GEP não diz com a mesma finura                         | Fica com o arquivo do Sentry, como hoje                                                                                       |
| Loja de fim de partida              | A última loja é `Sold` x5 com `visible=false`                          | n/a                                                                                  | Sem valor útil; o fim vem de `match_state`                                                                                    |

Resposta curta: **sim, a leitura de tela pode virar só verificação/reserva enquanto o `gepStatus` estiver `ativo` e a identidade local
`confirmada`**, para ouro, nível, XP, loja, banco de itens e oferta de aprimoramento. Ela continua necessária (a) nos primeiros ~45 s da
partida (ouro 0 e nível 1 não são emitidos), (b) sempre que o GEP ficar obsoleto/ausente (Overwolf ou TFTAcademy fechados, gravação
desligada), e (c) como verificação cruzada (`core/state/precedence.mjs` já trata a divergência). Ainda só se confirma com o servidor ligado
durante uma partida real: o estado `ativo` no 1-1, a ligação por `match_id` com o `gameId` do LCU e a precedência por campo contra a tela ao
vivo.

## 10. Pendências apontadas por esta validação

1. Regenerar o catálogo de itens (`DA_Consumable_TinyChampionDuplicator`, `DA_Riftbeast18_Selector`) e de Wisps (`DA_18_MinorBloodRitual`).
2. (Opcional, depende do usuário) ler `board.board_pieces` e `me.health` (mesmo jogador, mesmo formato, sem risco de política). Se a vida for
   lida, limitar em 0.
3. Decisão do usuário sobre `match_info.opponent` e `carousel.carousel_pieces` antes de qualquer integração.
4. Nível 1 e ouro inicial: se quiser cobrir os ~45 s iniciais sem tela, é regra do jogo (nível 1, ouro 0 antes do primeiro evento), não dado;
   hoje o leitor deixa desconhecido (`null`) e a tela preenche.
