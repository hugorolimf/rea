# Lobby Compass — protótipo

Execute: node .\tft\helper\server.mjs
Abra http://127.0.0.1:3218. Informe o nível e opcionalmente o ouro. Ctrl+C encerra. Atualiza a cada cinco segundos, lendo o arquivo do jogo diretamente; verifica a sessão LCU por GET, sem salvar credenciais.

Motor heurístico por sinergias, investimento preservado, frontline, afinidade de itens, nível e disputa de pool. Cópias nominais: 1/3/9 para 1/2/3 estrelas. Banco e loja ocultos impedem contagem exata. Entrada manual de banco complementa a contagem e é apagada na troca de partida. Score não é probabilidade de vitória. Sem simulação de combate, augments, emblemas, Wisps, posicionamento ou economia completa. Reservar não significa vender. Lux especial excluída das sugestões.

Catálogo Set 18: https://raw.communitydragon.org/latest/cdragon/tft/en_us.json, snapshot salvo em catalog.json. Pool e odds de referência patch 18.3: https://tftsense.gg/study-hall/tft-champion-pool-and-odds/. Ainda não confirmados no executável 18.4; parâmetros explícitos em engine.mjs.

REA confirmou observação nativa indisponível no Windows, Ghidra sem configuração. Logs e snapshot não deram banco adversário com identidade e ocupação comprovadas. Nenhum banco foi inventado.

Servidor local 127.0.0.1:3218, Node sem dependências adicionais. Não automatiza compras/vendas, não altera jogo, não lê memória. Snapshot antigo e divergência da sessão são sinalizados. Sintaxe conferida com node --check; sem suítes de teste.

Identidade: Hero/playerId 47445859 é fixo no backend e na interface. A área Scouting consulta outro participante sem alterar recomendações ou pool próprios. O seletor é manual; a identidade da arena visitada no jogo ainda não é detectada automaticamente. Backend verificado retornando self=Hero e viewedBoard=Milanor simultaneamente, e rejeitando adversário como self.

## Itens, ícones e planejamento interativo

181 imagens foram baixadas do CommunityDragon para assets/ e mapeadas por ID em assets-manifest.json (74 campeões, 107 itens/componentes). A interface serve os PNGs localmente, com fallback de texto se um ícone falhar. Regenerar: node .\tft\helper\download-assets.mjs.

Cada campeão do plano recebe build heurística, receitas, justificativas contra cura, dano físico/mágico e resistências observados. O adversário selecionado em Scouting orienta os counters; sem seleção, usa o lobby vivo. Itens equipados são preservados, slots livres respeitados, Luvas do Ladrão bloqueiam adições comuns. Duplicação de feridas e shred na equipe é penalizada. Componentes livres não foram capturados; as receitas são objetivos, não autorização de craft possível agora. Build de referência em campeão com três slots não implica substituir seus itens.

O mapa 4×7 sugere frontline/lutadores/carries. Arrastar move ou troca hexágonos só no plano; Espelhar alterna lado. Clique no campeão para examinar itens e simular outra unidade. Mostra quem sai/entra; unidade equipada deve ser preservada até resolver transferência. Restaurar comp desfaz simulações. Os planos não comandam o jogo. Posições inimigas não foram capturadas, portanto não existe garantia de posicionamento ótimo ou anti-controle preciso. Regras especiais de adjacency ainda não modeladas.

API respondeu com builds, sete posições e Hero como identidade local; PNG servido com HTTP 200 image/png. Sintaxe conferida. Browser indisponível neste ambiente, então drag-and-drop e aparência não foram verificados visualmente.

## Captura automática, meta fixada e código TFT

O watcher observa TFTEoGStats.json e faz fallback de stat a cada 500 ms. SSE atualiza a interface e grava alterações de cada jogador em tft/data/scouting-captures.jsonl. A captura depende de o jogo publicar o arquivo: visitar uma arena não comprova por si só publicação nem identifica automaticamente o jogador visitado. Hero permanece fixo. Selecionar um card adversário consulta sua última leitura.

Nível atual pode ser estimado pelo número de unidades, conforme solicitado; slots vazios/extra e invocações podem invalidar a relação. Ouro segue manual, sem fonte automática comprovada. O nível alvo é independente: alvo 9 gera 9 unidades distintas, inclusive quando Hero está abaixo disso. Estrelas atuais e estrelas alvo aparecem no planner; metas são heurísticas, não unidades já adquiridas.

Selecionar uma comp fixa IDs/carry por partida no localStorage e copia seu código. A atualização recalcula transição, builds e playbook sem substituir a meta. Liberar meta volta às sugestões; Restaurar comp desfaz trocas simuladas. Slow roll, fast 8/9, acumular e estabilizar usam vida observada, pool parcial e nível/ouro informados ou estimados; snapshot antigo ou Hero eliminado pausa decisões ao vivo. Chances por custo e campeão são aproximadas, não leitura das ofertas da loja.

O ranking busca em todo o catálogo elegível; posse atual tem peso pequeno. Força por custo, sinergias, equilíbrio, itens, resistências inimigas e disputa compõem a heurística. Pequenos priors qualitativos dos buffs/nerfs Riot 18.4/B são explícitos no engine, sem winrates nem garantia de melhor comp global. Fonte: https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-4/ .

Códigos usam IDs oficiais de tftchampions-teamplanner.json (arquivo local com origem/data), formato versão 02, dez slots de três dígitos hex e TFTSet18. Campos importam apenas campeões; estrelas, itens e posições não viajam no código. IDs ausentes ou mais de dez unidades geram erro, sem truncamento. Clipboard negado oferece campo para Ctrl+C. Importação no cliente e interação visual ainda não confirmadas neste ambiente.

Verificação desta atualização: API na partida 3291138173, fase InProgress, Hero identificado, nível estimado 5. As três sugestões para alvo 9 retornaram exatamente nove campeões e nove posições, estrelas atuais/metas, playbook Fast 9 e códigos de equipe. Preview fixado manteve os nove IDs mesmo com nível atual informado 6. SSE respondeu HTTP 200 e entregou snapshot. Sintaxe dos módulos conferida. Clipboard, importação no cliente e aparência não foram verificados em navegador, pois esse ambiente não disponibiliza browser.

## Aproveitar seus itens

Painel de builds para todos os campeões atuais, independente da meta. Equipados são observados e preservados. Itens livres são entrada manual separada (não inventa inventário oculto), apagada ao detectar nova partida. Sugestões imediatas alocam componentes com multiplicidade, sem usar o mesmo item duas vezes e respeitando slots livres; painel mostra receitas com um componente faltante. Luvas do Ladrão bloqueiam adições. Não considera combinar componentes já equipados nem removedores; metas são heurísticas e o inventário deve ser atualizado pelo usuário após uso.

Aprimoramentos: snapshot contém players[].augments, exposto sem inventar interpretação de IDs/objetos. Na investigação atual, Hero.augments=[]; customAugmentContainer é TFT_Portals_Default_NoPortal e não lista opções. Logs registram widgets de escolha e estados de lifecycle, sem os nomes/IDs das três ofertas nas consultas realizadas. Ausência no registro não significa nenhum aprimoramento adquirido. Ainda não há vínculo confiável de efeitos de aprimoramentos ao ranking de comps.

Ranking de comps atualizado: usa itens equipados e inventário livre manual. Componentes contribuem para perfis AD/AP/tanque; itens completos livres e receitas realizáveis orientam carry e composição. Multiplicidade respeitada na verificação de cada receita; diferentes receitas são alternativas, não crafts simultâneos. Pontuação de compatibilidade aparece nos motivos. Equipados só contam como investimento aproveitável no campeão que já os possui; não assume transferência gratuita. Não promete compatibilidade total com itens livres desconhecidos, efeitos especiais ou dados de aprimoramentos ausentes.

Builds ordenam itens adequados ao campeão e adversários pela disponibilidade dos componentes livres informados. Planner mostra disponível/incompleto e componentes faltantes. A meta escolhida permanece fixa. Para porta alternativa: $env:TFT_HELPER_PORT=3219; node .\tft\helper\server.mjs. A instância antiga na porta 3218 não pôde ser encerrada nesta sessão por acesso negado do Windows.

## Estabilidade das sugestões

As três direções são fixadas por partida e nível alvo e persistidas como IDs/carry no navegador. O backend recalcula instruções, itens, transições, disputas e score para esses mesmos campeões, sem ordenar novamente a lista. Buscar novas comps permite substituir as alternativas explicitamente; mudança de nível alvo ou nova partida também gera novas alternativas. A meta priorizada continua separada e não é liberada por uma nova busca. Respostas em andamento são descartadas quando a busca/nível alvo mudar, evitando recuperar a lista antiga.

Planner mostra dois mapas: unidades atuais com estrelas/itens observados e posicionamento heurístico sugerido, e meta escolhida com estrelas/itens recomendados. Hexágonos atuais não são capturados. Clique no campeão atual para builds com componentes livres e indicação de manter/substituir conforme a meta. Clique na meta para builds e simulações. Ícones de equipamento atual e adições recomendadas aparecem nos respectivos mapas.

## Interface e correção do modo de sugestões

Planejador sobe para o início, com abas Seu campo/Comp alvo, retratos maiores, estados manter/comprar/trocar e inspetor ao lado. Ajustar posições aceita arrastar ou Mover campeão seguido de clique, além de navegação por teclado. Menu lateral tem ícones SVG, seção ativa, recolhimento persistido e grade compacta em telas pequenas. O CSS do menu foi concluído após a troca da marcação.

Correção solicitada: removido congelamento das alternativas. Comps que fazem sentido agora volta a recalcular automaticamente. Somente a meta escolhida permanece fixa no planner; o seletor mostra Sua meta separadamente das sugestões que mudam. Builds, transições e instruções continuam atualizando para os mesmos IDs escolhidos. Sintaxe conferida; não houve revisão visual porque o controle de navegador não disponibiliza superfícies neste ambiente.

Reserva manual agora aparece no planejador e entra no preview da meta (posse/estrelas), além de já afetar recomendações e pool. Transição distingue Da reserva de Comprar. Não existe leitura automática confiável do banco; itens das unidades de reserva não foram capturados. Carrossel sugere até três componentes pelo carry/tanque, receitas e componentes livres informados; não captura as ofertas reais. Copiar código usa textarea temporário fora da seção recolhida e fallback clipboard, com campo visível para Ctrl+C se bloqueado.

## Builds de meta

As builds por campeão usam a ordem de itens publicada pela MetaTFT (`https://api-hc.metatft.com/tft-comps-api/unit_items_processed`, endpoint não oficial). `meta-builds.mjs` guarda uma cópia em `meta-builds.json` com origem, data e patch, e o servidor a renova quando passa de seis horas. Sem rede, segue com a cópia; sem cópia, ou para campeão sem dado (variantes de Lux), volta à heurística local e o inspetor informa a fonte. O lobby observado só desempata itens que já estão na lista de meta. O papel (tanque/AD/AP) usado em posição e encaixe de itens é inferido dos cinco primeiros itens de meta.

## Leitura da tela (ouro, nível, XP e banco de itens)

`screen-reader.ps1` lê a janela do TFT sem tocar no processo do jogo: captura recortes pequenos da tela e a posição da janela. Ouro, nível e XP usam o OCR nativo do Windows; o banco de itens é reconhecido comparando cada espaço com os ícones do catálogo (não é OCR). `screen-reader.mjs` mantém um único processo, só com partida confirmada, e cada leitura só roda quando o seu recorte muda. As regiões são frações da área cliente, medidas numa captura 2044×1149 do HUD padrão em janela 16:9; outro layout de HUD ou proporção exige recalibrar (`Capturar tela p/ calibrar` grava `tft/data/screen-calibration.png`).

Verificado contra uma captura real (estágio 4-1): ouro 51, nível 6, XP 24/36 e dois Recurve Bow lidos corretamente; dois itens ficaram como não reconhecidos por não terem ícone baixado (107 de 507 itens têm ícone). Não verificado: leitura contínua durante uma partida inteira, ouro de três dígitos, nível 10+, tela cheia exclusiva e outras resoluções. Valor não lido chega como nulo, nunca como zero; campo preenchido à mão tem prioridade sobre a tela.

## Evoluir, ajustar ou trocar

`decision.mjs` devolve um veredito por leitura: evoluir a comp atual, ajustar parte dela, estabilizar ou trocar. Usa quantas unidades em campo cada rota mantém, itens equipados em unidades que sairiam, disputa, HP e ouro. É regra de bolso sobre o snapshot; não simula combate.

## Campo de agora e loja

`stage.mjs` separa a meta (comp alvo) do que montar no nível atual: mantém em campo o que já é seu (peças da meta e temporárias mais fortes), lista as peças da meta que a loja deste nível oferece com a chance por loja dada a pool visível, sugere pontes que ativam sinergias da meta e deixa para depois o que a loja ainda oferece a menos de 10% por slot, com o nível em que passa a aparecer. O motor também só inclui na meta custos com pelo menos 10% por slot no nível alvo, salvo unidades já suas.

O leitor de tela também lê o nome das cinco cartas da loja (OCR) e `screen-reader.mjs` as converte em campeões usando os nomes em inglês do catálogo e os pt-BR de `names-pt_br.json` (CommunityDragon). Cada carta vira uma ação: comprar (peça da meta, cópia de unidade sua ou ponte), falta ouro, ou ignorar. Verificado contra duas capturas reais (ouro 51 e 33, níveis 6 e 5, XP, loja LeBlanc/Caitlyn/Leona com dois espaços vazios, itens do banco). Não verificado: uma partida inteira com a interface aberta, nomes pt-BR com acento no OCR, carrossel e telas que cobrem o HUD.

## Comps de meta, ação de agora e trava de troca

`meta-comps.mjs` baixa as comps da MetaTFT (unidades, estilo de nível, alvos de 3★, build por campeão dentro da comp e distribuição de colocações) e guarda em `meta-comps.json`. O tier (S ≤ 4,25; A ≤ 4,40; B ≤ 4,60; C acima) é uma faixa própria deste helper sobre a colocação média, não o tier da MetaTFT; comps com menos de 5000 partidas ficam de fora. Com essas comps disponíveis, o motor deixa de montar comps próprias: escolhe entre as de meta somando a força da meta ao encaixe na partida (unidades que você já tem, itens, disputa na pool, acesso na loja, lobby). Sem a cópia local, volta à busca heurística antiga.

`strategy.mjs` devolve a ação de agora — comprar, economizar, subir de nível ou rolar, com quanto gastar e o piso de ouro — a partir de estágio, nível, XP e ouro lidos da tela, HP, pool, loja e o estilo da comp (reroll no nível N, Fast 8, Fast 9). Também mede a força da sua board contra a de cada rival vivo com a mesma régua (custo × estrelas + itens). São regras usuais de economia; não simulam combate nem streak.

Uma troca só aparece como pronta quando a unidade que entra vale pelo menos 90% do corpo (custo × estrelas) da que sai; caso contrário o helper manda segurar a atual e informa quantas cópias faltam. A loja segue a prioridade: carta que fecha upgrade, carry, peça da meta, cópia de unidade sua, ponte; cartas secundárias não são compradas se derrubarem o patamar de juros, salvo com a vida em risco.

## Itens: onde montar, de quem tirar, o que pegar no carrossel

O bloco central do Planejador reúne a decisão inteira: ação de agora, quadros de Economia, Nível e Roll, o campo atual, trocas de unidade (trocar agora / segurar), a loja lida e os itens. Para itens: (1) o que já dá para montar com o banco e em qual campeão equipar; (2) mudanças de item entre campeões — item em unidade que sai da comp, ou fora da build de quem o carrega, vai para quem o usa melhor entre as unidades em campo; (3) o próximo item de cada unidade e o que falta; (4) o componente a pegar no carrossel, calculado distribuindo o banco entre as builds (carry primeiro) e priorizando o que fecha um item agora.

O leitor de tela reconhece o Removedor de Itens no banco, mas não lê a quantidade no selo do ícone (o OCR não pegou o número na captura de teste); o helper só sabe se há ou não removedor. A estratégia também compara o ganho esperado de força de rolar contra subir de nível, com as chances reais da pool, e usa nível médio e unidades 2★+ dos rivais. Tudo heurístico; não simula combate.

Estratégia em painel lateral direito persistente no desktop, compartilhado entre telas: nível/XP, roll, upgrades de campeões e economia acompanham a comp ativa/selecionada. Menu esquerdo inicia compacto. Em telas estreitas a estratégia entra no fluxo para não encobrir tabuleiro/controles. A estratégia saiu do bloco central stageplan; IDs são únicos e cálculo permanece o mesmo.
