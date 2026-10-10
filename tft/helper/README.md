# Lobby Compass — protótipo

Execute: node .\tft\helper\server.mjs
Abra http://127.0.0.1:3218. Informe o nível e opcionalmente o ouro. Ctrl+C encerra. Atualiza a cada cinco segundos, lendo o arquivo do jogo diretamente; verifica a sessão LCU por GET, sem salvar credenciais.

Motor heurístico por sinergias, investimento preservado, frontline, afinidade de itens, nível e disputa de pool. Cópias nominais: 1/3/9 para 1/2/3 estrelas. Banco e loja ocultos impedem contagem exata. Entrada manual de banco complementa a contagem e é apagada na troca de partida. Score não é probabilidade de vitória. Sem simulação de combate, augments, emblemas, Wisps, posicionamento ou economia completa. Reservar não significa vender. Lux especial excluída das sugestões.

Catálogo Set 18: https://raw.communitydragon.org/latest/cdragon/tft/en_us.json, snapshot salvo em catalog.json. Pool e odds de referência patch 18.3: https://tftsense.gg/study-hall/tft-champion-pool-and-odds/. Ainda não confirmados no executável 18.4; parâmetros explícitos em engine.mjs.

REA confirmou observação nativa indisponível no Windows, Ghidra sem configuração. Logs e snapshot não deram banco adversário com identidade e ocupação comprovadas. Nenhum banco foi inventado.

Servidor local 127.0.0.1:3218, Node sem dependências adicionais. Não automatiza compras/vendas, não altera jogo, não lê memória. Snapshot antigo e divergência da sessão são sinalizados. Sintaxe conferida com node --check; sem suítes de teste.

Identidade: Hero/playerId 47445859 é fixo no backend e na interface. A área Scouting consulta outro participante sem alterar recomendações ou pool próprios. O seletor é manual; a identidade da arena visitada no jogo ainda não é detectada automaticamente. Backend verificado retornando self=Hero e viewedBoard=Milanor simultaneamente, e rejeitando adversário como self.

## Itens, ícones e planejamento interativo

181 imagens foram baixadas do CommunityDragon para assets/ e mapeadas por ID em assets-manifest.json (74 campeões, 107 itens/componentes; em outubro de 2026 somaram-se os 36 ícones de sinergia, com chave `trait:<apiName>`, expostos em `/api/catalog` como `traits[].icon` e desenhados na faixa de sinergias da Formação, tingidos pelo estado). A interface serve os PNGs localmente, com fallback de texto se um ícone falhar. Regenerar: node .\tft\helper\download-assets.mjs.

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

## Plano em andamento: progresso em vez de recomeço (v2)

A análise não recomeça a cada rodada: o servidor guarda, por partida, o **plano em andamento** e o que já foi conquistado (`plan-state.mjs` e `plan-progress.mjs`; arquivo `data/plan-state.json`, que sobrevive ao reinício do servidor e é apagado quando a partida é registrada no histórico). Cada análise é um delta sobre esse estado.

- **Plano mantido com confirmação.** O plano em andamento (comp de meta ou tabuleiro de vantagem) concorre sempre, com o bônus de inércia, a incerteza de 95% e o custo de troca por estágio que já existiam. Além disso, um desafiante só assume o plano depois de liderar com ganho acima de incerteza + custo por pelo menos 3 leituras de análise distintas e 2 rodadas distintas (`CONFIRM`). Uma inversão no meio (outro desafiante, ou o plano mantido de volta ao topo) zera a contagem. O motor mede e registra a vantagem (`evidence.switch.held`, `toId`) mas não troca enquanto `options.holdPlan` vale. Troca de classe (o plano mantido virou aposta ou deixou de usar o aprimoramento escolhido) e "Seu tabuleiro atual" não esperam confirmação. As trocas efetivas continuam em `data/plan-changes.jsonl`; as seguradas ficam no histórico do estado.
- **Checklist de progresso** (`analysis.planProgress`, seção "Plano" do Ao vivo): peças do plano com estrela-alvo e cópias (`3^(estrela-1)`), itens-alvo por peça (congelados na primeira vez que aparecem; só de peças que já são suas), os três aprimoramentos (2-1, 3-2, 4-2), nível atual contra o alvo, ouro contra o próximo patamar de juros e o piso da decisão, o próximo passo e o que mudou desde a leitura anterior. O progresso é derivado do estado de agora; as marcas guardadas (maior estrela vista, item montado, aprimoramentos) só dizem que algo já foi conquistado (e perdido, quando for o caso). Compras do `TFT.log` (`unit-ledger.mjs`) aparecem apenas como **teto** da reserva de uma peça ainda fora de campo, nunca como peça obtida.
- **O que dispara uma análise.** A camada base (motor e evidência) depende do conteúdo do snapshot (`snapshotSignature`, não do horário em que o jogo regravou o arquivo), nível, nível-alvo, ouro, reserva, inventário, aprimoramentos, trocas, estágio, plano mantido e `holdPlan`. Loja, XP, removedores e sequência de vitórias só refazem a camada tática. A tela só pede análise nova quando algum desses muda ou a cada 2 minutos (antes 30 s) por causa do decaimento do banco estimado dos rivais. Tabela completa em `analysis-keys.mjs`.
- Testes: `tests/plan-state.test.mjs`, `tests/analysis-keys.test.mjs`, `v2/js/plan.test.mjs`, `v2/js/api.test.mjs`.

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

`strategy.mjs` devolve a ação de agora — comprar, economizar, subir de nível ou rolar, com quanto gastar e o piso de ouro — a partir de estágio, nível, XP e ouro lidos da tela, HP, pool, loja e o estilo da comp (reroll no nível N, Fast 8, Fast 9). Também mede a força da sua board contra a de cada rival vivo com a mesma régua (custo × estrelas + itens). Não simula combate.

A matemática fica em `economy.mjs` (puro, também carregado pelo mock no navegador) e as regras do jogo em `rules.mjs` (pool, odds, renda, XP, sequência); os limiares desta ferramenta ficam em `POLICY`:

- **Chance de fechar um upgrade**: cadeia de Markov exata em (cópias × ouro) — cada loja custa 2g, cada cópia achada é paga e a pool encolhe a cada compra. É a chance de cada peça na lista do painel Roll.
- **Rolar pelo time inteiro** (`roll.mjs`): os alvos são todo campeão do tabuleiro, do banco e da comp recomendada que ainda sobe de estrela (3 cópias → 2★, 9 → 3★; peça nova da comp à venda só vale uma cópia). Cada peça tem cópias suas, cópias que faltam, livres na pool (provável, descontado o banco estimado dos rivais, e teto observado), chance por loja no nível (ODDS) e chance de fechar com o orçamento; o core pesa mais (carry 2×, demais cores 1,5×, +25% por item, peça fora da comp 0,6×). Peça sem cópias livres, com a loja do nível sem o seu custo ou com 3★ disputado fica **inviável** e sugere o substituto do plano. As cópias da loja lida que o plano manda comprar já contam como suas e a peça aparece marcada na lista.
- **Vale rolar agora?** (regra única, `rollRule`): rola quando há ≥ 50% de chance de evoluir alguma peça do time que valha a evolução (a melhor entre comprar tudo o que aparecer e focar numa peça) com o ouro acima do piso da faixa de vida; com a vida em perigo basta ganho esperado positivo; sem peça viável, sem ouro acima do piso ou com a peça principal bem mais provável no nível de rolagem, espera. A mesma regra vira a decisão (rolar↔guardar) e o veredito do painel.
- **Quanto rolar**: o ganho esperado de força do time por ouro é simulado (Monte Carlo com números aleatórios comuns, semente fixa, uma passada por nível/alvos/pool, reaproveitada quando só o ouro muda) com todos os upgrades disputando o mesmo ouro; o gasto vai até onde a próxima loja rende menos que a média do plano, descontada pela urgência da faixa de vida e pelos juros perdidos. Compras da loja saem do ouro antes da rolagem. Os juros só entram no painel como nota quando rolar derruba o patamar.
- **Faixa de vida** (crítica, perigo, ferido, saudável) única para estratégia e loja: define piso, urgência e horizonte de juros. Vida crítica faz all-in, vendendo do banco fora da comp; comps de reroll fazem reroll rápido (piso 20g) com vida até 50.
- **XP**: faltando até 2 XP, o XP passivo da próxima rodada sobe o nível de graça (fora de perigo não compra XP); nível máximo não sugere XP.
- **Renda e projeção**: base + juros + sequência para as próximas 4 rodadas, com a rodada em que chega a 50g. A sequência de vitórias/derrotas é inferida pelo HP entre rodadas (`streak.mjs`).

Testes: `node --test "tft/helper/tests/*.test.mjs"` (economia, estratégia, loja e sequência, com estado sintético em `tests/fixtures.mjs`).

### Itens: tier e atributos

A tela **Itens** (`#itens`) tem três abas: **Tier** (faixas S–D por categoria, com o detalhe do item à direita), **Receitas** (grade componente × componente colorida pelo tier) e **Atributos** (matriz item × atributo, ordenável por coluna). Busca sem acento por nome em pt-BR/inglês, componente ou sinergia; os filtros de atributo destacam os itens que têm todos os marcados.

- `build-items.mjs` gera `items.json` a partir do CommunityDragon (pt_br + en_us): nome, tipo, receita, atributos normalizados (frações viram pontos percentuais) e descrição com os valores preenchidos. Os itens `DA_` do set vêm sem números; eles saem do item genérico equivalente (`TFT_Item_*`, `TFT5_Item_*Radiant`, `TFT_Item_Artifact_*`). Valores calculados em combate aparecem como "X".
- O desempenho vem da mesma resposta da MetaTFT que alimenta as builds (`meta-builds.json` guarda colocação média, usos, taxa de uso e campeões por item). `GET /api/items` junta os dois.
- **Tier** (`item-tiers.mjs`), por categoria: a média de cada item é encolhida para a média da categoria (Bayes empírico; a variância entre itens vem do estimador de DerSimonian–Laird, que pesa cada item pela amostra), e o tier sai de z = (referência − média encolhida) / τ, com cortes em ±0,4 e ±1. A referência é a média de efeitos aleatórios (o item típico), não a média por partida dominada pelos itens populares. Componentes e consumíveis mostram média e posição, mas não tier.

Atualizar os dados de itens: `node tft/helper/build-items.mjs` e, para ícones novos, `node tft/helper/download-assets.mjs`.

Uma troca só aparece como pronta quando a unidade que entra vale pelo menos 90% do corpo (custo × estrelas) da que sai; caso contrário o helper manda segurar a atual e informa quantas cópias faltam. A loja segue a prioridade: carta que fecha upgrade, carry, peça da meta, cópia de unidade sua, ponte; cartas secundárias não são compradas se derrubarem o patamar de juros, salvo com a vida em risco.

## Itens: onde montar, de quem tirar, o que pegar no carrossel

O bloco central do Planejador reúne a decisão inteira: ação de agora, quadros de Economia, Nível e Roll, o campo atual, trocas de unidade (trocar agora / segurar), a loja lida e os itens. Para itens: (1) o que já dá para montar com o banco e em qual campeão equipar; (2) mudanças de item entre campeões — item em unidade que sai da comp, ou fora da build de quem o carrega, vai para quem o usa melhor entre as unidades em campo; (3) o próximo item de cada unidade e o que falta; (4) o componente a pegar no carrossel, calculado distribuindo o banco entre as builds (carry primeiro) e priorizando o que fecha um item agora.

O leitor de tela reconhece o Removedor de Itens no banco, mas não lê a quantidade no selo do ícone (o OCR não pegou o número na captura de teste); o helper só sabe se há ou não removedor. A estratégia também compara o ganho esperado de força de rolar contra subir de nível, com as chances reais da pool, e usa nível médio e unidades 2★+ dos rivais. Tudo heurístico; não simula combate.

Estratégia em painel lateral direito persistente no desktop, compartilhado entre telas: nível/XP, roll, upgrades de campeões e economia acompanham a comp ativa/selecionada. Menu esquerdo inicia compacto. Em telas estreitas a estratégia entra no fluxo para não encobrir tabuleiro/controles. A estratégia saiu do bloco central stageplan; IDs são únicos e cálculo permanece o mesmo.

## Aplicativo de acompanhamento — outubro de 2026

A rota inicial `#live` reúne o campo observado, os itens equipados, trocas e compras sugeridas. A página `#planner` mantém o planejamento e posicionamento separado da leitura do campo. Cards de campeão abrem a inspeção; filtros e grupos recolhíveis preservam foco e preferências durante as atualizações. As alternativas de comps continuam dinâmicas; a meta que você escolheu continua prioritária.

No desktop, economia e estratégia permanecem à direita. Em telas menores, abra **Economia e estratégia**; Escape ou o botão Fechar devolvem o foco ao controle de origem. Mobile tem cinco destinos e acesso a adversários/pool pelo Lobby. **Corrigir dados e calibrar leitura** permite informar nível, ouro e nível alvo quando a captura não reconhece esses valores.

Dados antigos/eliminado usam modo planejamento e não têm chamadas de gasto ao vivo. Campo observado e peças da reserva não são tratados como a mesma coisa; posições continuam sugestões inferidas. Os controles só alteram o helper, nunca compram/vendem/movem peças no jogo.

O cliente evita repetir análise com entradas iguais, pausa atualizações de fundo quando a página não está visível e usa SSE para invalidar dados novos. Snapshot é reutilizado somente enquanto mtime/tamanho permanecem iguais; busca de comps e análise final usam caches separados. Scouting, itens, aprimoramentos, estágio, XP, ouro e mudança de validade invalidam suas etapas correspondentes. Resultados do motor são clonados antes de atualizar táticas.

Verificação efetuada: sintaxe JavaScript, contratos de IDs/rotas e diagnóstico de APIs com snapshot real. Três sugestões de alvo nível 9 retornaram nove campeões e códigos TFT. Nenhuma suíte de testes executada. Revisão visual por computer-use interrompida conforme instrução do usuário; aparência e gestos em navegador ainda precisam de avaliação do usuário. O planejador ainda identifica cópias repetidas pelo campeão, sem identidade individual para cada peça.

## Interface única, início/fim de partida e histórico

A interface v2 passou a ser a principal em `http://127.0.0.1:3218/` (`/v2/` redireciona) e a v1 foi removida (`index.html`, `app.js`, `planner.js`, `live-view.*`, `strategy-view.js`, `style.css`, `app-shell.css`). Os trechos acima sobre planejador, abas, scouting manual e itens livres descrevem essa interface antiga; o motor e a API continuam os mesmos.

`match.mjs` acompanha a partida a cada 2 s, mesmo sem a interface aberta. Início: o cliente (LCU) entra em `InProgress`/`Reconnect` com um `gameId` novo, ou, sem cliente, o tabuleiro passa a ser de outra partida com o Hero. Fim: Hero com vida ≤ 0 (colocação = `ffaStanding`), Hero único vivo (1º) ou o cliente sai da partida. O primeiro arquivo de cada partida traz vida e colocação -1 em todos e não conta como eliminação. Se o cliente sai antes do tabuleiro final, o registro espera até 3 min pela colocação e, sem ela, grava "colocação não observada".

No início de cada partida o servidor descarta caches de análise, a comp fixada da partida anterior e as leituras do leitor de tela; a interface descarta a última análise e, enquanto o jogo não publica o primeiro tabuleiro da partida nova (1–4 min), mostra "Nova partida em andamento" em vez do tabuleiro antigo. Início, fim e registro chegam às telas pelo SSE (`type: "match"`); `/api/state` traz `match` (`status`, `placement`, `boardReady`, `last`).

Histórico: uma linha JSON por partida em `tft/data/match-history.jsonl` (ignorado pelo git), só para registro visual: `gameId`, fila, set, término, duração, colocação e o tabuleiro final do Hero (campeão, estrelas, itens). `GET /api/history` devolve da mais recente para a mais antiga; a visão Histórico mostra partidas, colocação média, top 4, vitórias e, por partida, colocação, fila, duração, sinergias ativas (sem emblemas) e unidades. Partidas sem o Hero (tutorial, desafios PVE) não entram. Ao abrir o servidor depois de uma partida, o tabuleiro final ainda presente é registrado uma única vez.

Verificado: testes de `match.test.mjs` (início pelo cliente com tabuleiro antigo, primeiro arquivo com -1, eliminação, vitória, saída antes do tabuleiro final, reinício sem duplicar, sem cliente, partida sem o Hero), replay dos snapshots reais de `tft/data/events.jsonl` (8º e 6º, desafio PVE ignorado), servidor real registrando a última partida (2º, Ranqueada) e capturas do Edge headless das telas Histórico, Resultado e Nova partida (mock). Não verificado: uma transição ao vivo com o cliente do jogo aberto (LCU) e Dupla/Hiper Rolagem.

## Tela de seleção de comp (v2)

A visão **Comps** (`/#comps`, também pelo atalho "Escolher comp" no HUD) lista todas as comps de meta da cópia local (`GET /api/comps`) com tier, estilo de nível (reroll no nível N, Fast 8, Fast 9), colocação média, top 4, vitória e número de partidas. Cada cartão mostra as unidades (carry com coroa, as que você já tem em campo marcadas), builds por campeão e alvos de 3★. O encaixe nesta partida vem do motor: `analyze` passou a devolver `compRanking` com todas as comps avaliadas (posição, unidades já suas, itens do carry, disputa na pool) além das 3 sugeridas. Filtros por texto (campeão, sinergia ou nome, sem acento), estilo e tier; ordenação por encaixe, colocação média ou top 4. Filtros ficam no navegador.

Atualização: `meta-comps.mjs` renova a cópia local quando ela passa de 2 h (antes 6 h); o servidor confere a cada 15 min e, ao renovar, descarta as análises em cache e avisa as telas pelo SSE (`type: "meta"`), que relêem a lista e pedem uma análise nova. Sem rede, segue com a cópia anterior e tenta de novo na checagem seguinte. A quantidade de comps é a da MetaTFT: em 09/10/2026 ela publicava 60 comps para o Set 18 (Platina+, últimos 3 dias); o filtro de 5000 partidas deixou 59. O estilo "Standard" publicado pela fonte aparece como "Nível padrão".

"Seguir esta comp" fixa a escolha: a interface envia `goalCompId` e o servidor resolve unidades, carry e builds da comp, devolvendo-a como `preview` com título e `meta` próprios; o Ao vivo, as trocas, os itens e a economia passam a usar esse plano (HUD mostra "fixada"). A escolha fica no navegador por partida: feita fora de partida vale para a próxima que começar; feita durante uma partida some quando ela termina. Se a lista de meta for atualizada e a comp sair dela (`goal.found = false`), a interface volta às sugestões e avisa. "Liberar" retorna ao automático.

Verificado: testes de `v2/js/comps.test.mjs` sobre as 58 comps reais; `/api/recommend` real com e sem `goalCompId` (58 comps no ranking, comp fixada com builds e estratégia "lvl 7", id inexistente com `found: false`); fluxo completo no Edge pelo DevTools Protocol (listar, filtrar Fast 9, fixar, Ao vivo seguindo a comp, liberar). Não verificado: troca de comp durante uma partida ao vivo.

## Substituições: a comp de meta como ponto de partida

A comp de meta não precisa ser seguida à risca. Para cada peça da comp seguida (sugerida ou fixada), exceto o carry, o motor (`flexOf` em `engine.mjs`) procura campeões de custo próximo (±1) e mesmo papel (tanque ou dano) que você consegue obter (já seus, ou com cópias livres e chance de loja ≥ 10% no nível alvo). Cada alternativa é avaliada pelo efeito nas sinergias da comp (patamares mantidos, perdidos e ganhos), por já ser sua (e com quantas estrelas), pela disputa na pool (cópias com rivais, mesma régua de `isContested`) e pela chance na loja. Alternativas que perdem mais de um patamar ou que estão disputadas ficam de fora: aí já é outra comp.

A troca vira sugestão quando a peça está sob pressão (disputada pelos rivais, sem cópias livres ou fora da loja no nível alvo) e há alternativa sem perder mais de um patamar, ou quando a alternativa já é sua, não perde nenhuma sinergia e a peça da comp ainda não é. Cada substituto serve a uma peça só; as trocas mais vantajosas escolhem primeiro. As recomendações trazem `flex` e a comp fixada traz `preview.flex`.

No Ao vivo, a seção **Substituições** mostra a sugestão (por que trocar, o que a alternativa traz) e outras opções; "Usar" fixa a comp seguida, se ainda era automática, com a troca aplicada, e o servidor recebe `goalSwaps` ([{out, in}]) junto de `goalCompId`. Trocar de novo uma peça que já entrou por substituição refaz a troca a partir da peça original; "Desfazer" remove a troca. As trocas ficam guardadas com a comp fixada e seguem a mesma regra por partida.

Correção junto: com cópias repetidas de um campeão em campo, a tática usava a última lida (um Sentinel 2★ aparecia como 1★ na comp fixada); agora vale a de mais estrelas e itens, como já acontecia na reserva.

Verificado: `engine-flex.test.mjs` (peça disputada por dois rivais recebe substituto não disputado, carry nunca substituído, substitutos únicos, peça sua sem pressão não é trocada), o motor sobre o tabuleiro real e o fluxo no Edge (sugestão Warwick → Varus 2★, usar, desfazer). Não verificado: uma partida ao vivo com rivais disputando peças da comp.

## Aprimoramentos: caminho e escolha (v2)

No Ao vivo, a seção **Aprimoramentos** mostra a trilha 2-1 → 3-2 → 4-2 com o que você escolheu (nome e sinergias com ícone) e, quando o leitor de tela reconhece as cartas na tela, as três opções na ordem sugerida para a comp seguida (recomendada, motivos, "troque este card"). "Escolhi este" marca a escolha com o estágio lido; o × desmarca. O jogo não grava no arquivo do tabuleiro qual carta você pegou (`players[].augments` vem vazio), por isso a escolha é marcada na interface; ela fica no navegador só para a partida em andamento.

As escolhas vão para `/api/recommend` em `augments`: as sinergias delas já favoreciam as comps que as usam (`augmentTraits`) e agora também ordenam as próximas ofertas — uma carta que segue a sinergia de um aprimoramento já escolhido ganha pontos ("Segue o seu caminho"). Corrigido em `augment-advice.mjs`: as expressões do nível das rolagens grátis tinham perdido a barra (`/nivel (d+)/`), então a regra "rolagens grátis no nível de roll da comp" nunca valia; o nível de roll agora vem de `strategy.rollAt`.

Verificado: `augment-advice.test.mjs` (rolagens no nível de roll, caminho), `v2/js/augs.test.mjs` (trilha e registro por partida) e o cenário de mock `caminho-aprimoramentos` no Edge (escolher, desmarcar). Não verificado: o reconhecimento das cartas pela tela numa partida real deste set; a ordem continua sem taxa de vitória por aprimoramento, porque a fonte de meta não publica esse dado por comp (`top_augments` vazio).

## Itens e força da comp: "esta comp B, com os seus itens, joga como A"

`item-edge.mjs` ajusta a colocação média de cada comp de meta aos itens que você tem. `meta-comps.mjs` passou a guardar, por comp, a build publicada de cada campeão com a variação da colocação (`buildStats`: itens, média, `place_change`, partidas). Essa variação compara a build com qualquer outra build de 3 itens no mesmo campeão daquela comp, controlando a quantidade de itens; as médias por item isolado (`build_items`) não são usadas porque medem sobretudo "partida rica" (tanques extras pareciam os melhores itens e o item central do carry parecia fraco).

Para cada campeão da comp, o motor conta quantos itens da build você tem prontos (equipados ou no banco) ou consegue montar com os componentes livres, cada item ou componente servindo a uma build só, e aplica: variação encolhida pelo número de partidas (K = 1500, porque a fonte publica só a melhor build e o efeito vem inflado: 235 de 236 builds aparecem como ganho), vezes a fração de itens ao quadrado (1 de 3 vale 1/9), vezes o peso do campeão (carry 1, outras unidades de dano 0,5, tanques 0). As três maiores contribuições somam com pesos 1 / 0,6 / 0,35 e o ganho total tem teto de 0,4 colocação. A força de meta no ranking usa essa média ajustada; `compRanking` traz `adjustedAvg`, `itemTier`, `itemGain` e `itemGains`.

Na tela de Comps, quando o ganho passa de 0,05 colocação, o cartão mostra "Com seus itens: média X (−Y)" com o campeão e os itens que contam, e o tier novo ao lado do original quando muda (ganhos menores ficam só no ranking, para não anunciar troca de tier por ruído de fronteira). Nova ordenação "Com seus itens". Nos detalhes, cada build mostra a variação publicada e as partidas, e os itens que você tem ou monta ficam destacados.

Verificado: `item-edge.test.mjs` (leitura das builds, encolhimento, crédito parcial, pesos por papel, teto, componentes sem uso duplo, faixas de tier), dados reais (com os itens do seu último tabuleiro, 25 de 59 comps ganham algo e nenhuma muda de tier; com a build completa do carry, Inferno · Elder Dragon iria de 4,52 B para 4,12 S) e a tela no Edge. Limite: a fonte não permite separar o efeito do item do efeito de partidas que vão bem; os números são uma estimativa conservadora, não uma medida causal.

## Painel direito (v2): o que sobrou

O cartão de decisão ("ECONOMIZAR / Economize até Ng"), com evidência, confiança e troca de plano, e o bloco **Ouro** (guia de juros, "Rolar pelo core", renda e próximas rodadas) foram retirados da interface; `v2/js/gold.js` não existe mais. O painel mostra **Nível**, **Roll** (gasto, curva de chance e peças-alvo), **Loja** (odds do nível) e **Por que esta decisão**. O medidor de ouro do HUD (piso e juros) continua. A lógica de estratégia e economia do servidor (`strategy.mjs`, `economy.mjs`, `engine.mjs`) fica intacta para o motor de rolagem por time inteiro.

## Score das comps (substitui as faixas S/A/B/C)

`comp-score.mjs` dá a cada comp um score de 0 a 100 para a sua partida, mostrado na aba Comps e no Ao vivo junto com a chance de montar e a marca "Melhor comp" (a primeira do ranking). Pesos (política deste helper, ajustáveis num lugar só): itens que você tem 30% (ganho de colocação das builds publicadas e itens do carry), o que você já tem em campo 25% (peso por custo; 1★ 0,35, 2★ 0,65, 3★ 1, mais a chance de subir de estrela com o seu nível), força medida da comp 20%, chance de achar as peças principais que faltam com o **nível de agora** (60%) e o nível alvo (40%) 15%, e peças que faltam e estão na loja agora 10%. A disputa dos rivais multiplica o total (cada ponto de disputa tira 7%, até 45%). O score soma `0,1` por ponto à pontuação medida na ordenação do motor; a decisão de trocar de plano em andamento continua pela colocação esperada medida. A busca na aba Comps casa campeões e **sinergias ativas** (patamar atingido), não o texto do título. Os pesos não foram calibrados contra resultados de partidas.
