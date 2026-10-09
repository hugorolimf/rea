# TFT: fontes locais e acompanhamento

Investigação de 2026-10-08 no Windows nativo, sem imagem, OCR, leitura de memória ou injeção de código.

## Tabuleiro confirmado

Cliente separado: `C:\Riot Games\Teamfight Tactics`, processo `TFTClient-Win64-Shipping`.

Fonte: `C:\Users\Hugo\AppData\Local\TFT\Saved\Logs\TFTEoGStats.json`.

Durante a fila 1220 (`PVE_PUZZLE_TFT`), esse arquivo atualizou várias vezes com a sessão em `InProgress`. O `gameId` foi comparado com o da API do League Client e coincidiu. Portanto, nesta execução, o arquivo atualiza durante a partida, apesar do nome. Outras filas e a cadência das atualizações ainda não foram verificadas.

`statsBlock.players[].boardPieces` fornece `championName`, `starLevel`, `itemNames`, `price` e `endOfGameAlias`. Não fornece coordenadas, banco ou ofertas da loja.

Snapshot observado às 21:09:06 (Brasília):

| Identificador   | Estrelas | Itens                                                        |
| --------------- | -------: | ------------------------------------------------------------ |
| DA_18_Varus     |        2 | nenhum                                                       |
| DA_KogMaw18_AD  |        2 | DA_ArchangelsStaff, DA_AdaptiveHelm, DA_JeweledGauntlet      |
| DA_18_Diana     |        2 | DA_NashorsTooth                                              |
| DA_Vi18         |        3 | DA_SteadfastHeart, DA_SpiritVisage, DA_SpiritVisage          |
| DA_18_Aphelios  |        1 | DA_InfinityEdge, DA_Quicksilver, DA_GuinsoosRagebladeRadiant |
| DA_Sentinel18   |        1 | DA_DragonsClaw                                               |
| DA_Nidalee18_AP |        1 | nenhum                                                       |

O nome de exibição de `DA_Sentinel18` é desconhecido.

## Loja: fonte parcial

Fonte: `C:\Users\Hugo\AppData\Local\TFT\Saved\Logs\TFT.log`.

O log registra eventos de áudio `Audio.Event.VO.Unit.Purchase` e `Audio.Event.VO.Unit.StarUp.*`, incluindo o identificador de ator e campeão. Mesmo quando o áudio é bloqueado por um canal de interrupção, a referência ao ator pode aparecer.

Isso permite acompanhar referências a compras e aumento de estrelas. São observações do subsistema de áudio, não confirmação independente de transações. Eventos repetidos do mesmo ator não devem ser contados como compras diferentes.

A busca por `TFTShop`, `ShopSubsystem`, `ShopSlot`, `reroll` e ofertas encontrou inicialização de `TFTShopPlayerSubsystem` e `TFTShopViewModel`, mas não os cinco slots nem campeões ofertados. Não preencher a loja com compras ou unidades do tabuleiro. As ofertas não compradas e rerolls continuam desconhecidos.

## Interfaces verificadas

As rotas `/lol-tft/v1/tft`, `/session`, `/board`, `/game-state` e `/player` retornaram 404 durante a partida. A porta 2999 não tinha listener. O WebSocket do League Client funcionou, mas as amostras observadas não forneceram o estado da loja. Esses resultados têm escopo limitado e não provam inexistência de toda interface possível.

## Leitor

Execute na raiz do REA:

```powershell
node .\tft\monitor.mjs --once
node .\tft\monitor.mjs
```

O primeiro atualiza uma vez. O segundo acompanha os arquivos a cada dois segundos até Ctrl+C. Ele escreve:

- `data/state.json`: snapshot disponível, identidade da partida, horário da fonte e loja explicitamente desconhecida.
- `data/events.jsonl`: mudanças do tabuleiro e referências de áudio a compras/estrelas, com origem e número de linha. A primeira leitura inclui o histórico já existente no log.

A idade do snapshot deve ser consultada antes de tratá-lo como atual. O leitor não verifica automaticamente a correspondência com a sessão LCU a cada leitura. Eventos idênticos não são regravados. As entradas de áudio não permitem reconstruir com certeza todos os slots da loja.

O monitor foi iniciado em segundo plano nesta investigação. Para parar com verificação de identidade do processo:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tft\stop-monitor.ps1

Busca adicional: os tipos de áudio observados foram Purchase, StarUp.2Star, StarUp.3Star e Spell; não apareceu um tipo de oferta/reroll. O diagnóstico local do TFTSense descreve um pipeline de loja com cartões de referência visual e não estabeleceu uma fonte estruturada sem imagem.

## Partida normal: 08/10/2026, 21:25 BRT

Sessão InProgress, gameId 3291102731, fila 1090 NORMAL_TFT. O snapshot do mesmo gameId contém oito jogadores. Hero foi identificado como jogador local por comparação em memória com current-summoner. Existem registros dos sete adversários com campeões, estrelas e itens; posições e banco ausentes. O monitor preserva nome e playerId. Os snapshots mudaram durante a partida.
Loja: Shop.Buying/Selling são erros de UI sem slots. ChemtechShopService consulta catálogo de produtos; nenhuma lista dos cinco campeões ofertados foi encontrada. Referências de áudio de compra continuam registradas sem equivaler a ofertas completas.

## Investigação da loja: interface encontrada, captura ainda indisponível

A documentação oficial atual do Overwolf expõe feature store, chave shop_pieces, com slot_1 a slot_5. Uma compra gera atualização marcando o slot como Sold. Exemplos documentais contêm IDs DA_18, compatíveis com a nomenclatura observada nesta instalação; isso não prova entrega ao vivo nesta máquina.
Fonte: https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/teamfight-tactics/#store

Verificações locais: UI Automation executada em leitura para PIDs 23348/10332 retornou zero elementos acessíveis neste ambiente. Isso não distingue ausência de suporte no jogo de isolamento do desktop. Nenhum processo Overwolf/MetaTFT/TFTactics foi retornado na consulta. As pastas Overwolf examinadas contêm apenas Settings XML e DxDiagOutput XML, sem eventos shop_pieces. Não foi encontrado listener TCP dos dois processos TFT na consulta. A busca específica do log por shop-slot/offer/reroll e campeão associado a shop não trouxe listas de ofertas.

Resultado: fonte documentada dos cinco slots identificada; captura real da loja continua desconhecida. Usar integração Overwolf autorizada seria necessário para essa fonte, sem contornar sua liberação. O monitor não foi alterado para simular ofertas e continua registrando eventos de áudio como referências de compra, não como lista de slots.

## Busca direta da loja no jogo

Na partida 3291102731, os registros TFTShopPlayerSubsystem/TFTShopViewModel encontrados no TFT.log informam inicialização e configuração, sem campeões dos slots. Nenhum arquivo extra de loja apareceu em TFT/Saved; TFTEoGStats.json segue sendo fonte de tabuleiros, sem ofertas. A tentativa de acessibilidade retornou zero elementos neste ambiente. A busca estática por strings de exportação/diagnóstico de shop/store no executável Shipping não retornou candidatos; isso é uma busca limitada, não prova de ausência no binário.
Foi encontrado shop_pieces no banco do aplicativo separado TFTAcademy, mas referente à partida antiga BR1_3282025760 de setembro, e não à partida atual. Não foi usado para preencher a loja atual. O usuário reafirmou que deseja leitura direta do jogo.

## Helper funcional

Aplicação local em tft/helper, http://127.0.0.1:3218. Iniciar com node .\tft\helper\server.mjs. Lê snapshots diretamente, identifica jogador pela API local, confere partida/set/fase e oferece comps heurísticas com contestação e investimento preservado. Banco adversário permanece desconhecido: REA reportou observação nativa unsupported_host no Windows, Ghidra not_configured; logs de drag-drop não atribuem ocupação/dono de banco. Entradas manuais são distintas e não afirmadas como leitura automática.

## Registro de observação — 08/10/2026, 22:05 BRT

**Origem:** relato do usuário durante a partida, confirmado por ele: "Sim, na interface isso aconteceu!".

**Observado pelo usuário:** ao clicar para visitar o tabuleiro de um adversário no jogo, o tabuleiro adversário apareceu na interface do helper. O clique de visita à arena adversária é, portanto, um gatilho observado para essa visualização nesta sessão.

**Escopo:** observação da interface relatada pelo usuário; ainda não houve comparação instrumental dos snapshots imediatamente antes e depois do clique. Não confundir esse achado com a confirmação anterior de oito registros de jogadores em TFTEoGStats.json.

**Hipótese a investigar:** visitar a arena adversária pode atualizar os dados disponíveis ou o tabuleiro apresentado. Ainda não está estabelecido qual arquivo/evento muda, se o comportamento vale para todos os adversários, nem se revela também banco ou posições.

**Próxima coleta:** registrar gameId, adversário visitado e horário do clique; comparar snapshot e eventos antes/depois; voltar à própria arena e repetir com outro adversário. Manter a identidade do dono do tabuleiro explícita no helper e não atribuir automaticamente a leitura ao jogador local.

## Identidade e scouting corrigidos — 08/10/2026, 22:10 BRT

A conta local foi fixada no playerId 47445859 (Hero), conforme confirmação do usuário. O seletor antigo podia promover qualquer participante a jogador local. Agora o backend rejeita essa troca, a interface mostra Hero como sua conta fixa e uma área independente permite consultar o tabuleiro de um adversário por nome. A consulta não troca a base das recomendações nem a atribuição de cópias próprias no pool.

Verificação da API: self=Hero e viewedBoard=Milanor foram retornados simultaneamente, com conjuntos diferentes de unidades; pedir Milanor como jogador local retornou 400 com explicação. Sintaxe conferida. Não havia navegador conectado para verificar a renderização visual.

Coleta durante visita relatada pelo usuário: tft/data/scouting-while-open.json. A exportação lida inicialmente era anterior ao clique; por isso essa leitura isolada não confirma troca de dono. O nome do adversário visitado não foi informado. Coleta de atualização subsequente: tft/data/scouting-next-update.json. A visita no jogo ainda não é detectada automaticamente; o seletor da área Scouting informa qual adversário consultar. Não tratar a arena visitada como mudança da identidade da conta.

Atualização do helper: watcher + SSE e registro por jogador, nível estimado, nível alvo com quantidade correspondente de campeões, meta fixada por partida, playbook e chances, estrelas atuais/meta e código de equipe com cópia ao selecionar. Detalhes e limites em helper/README.md.
