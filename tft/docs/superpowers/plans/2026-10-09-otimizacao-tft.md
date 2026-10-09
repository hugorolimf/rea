# Otimização do TFT Helper — Implementation Plan

> Para execução por agentes: seguir os passos e critérios deste plano; usar skills de execução/revisão disponíveis e respeitar as instruções do repositório. Não instalar ferramentas ou iniciar capturas para realizar medições. Suítes de teste só devem ser adicionadas/executadas quando solicitadas pelo usuário.

**Goal:** manter sugestões e scouting atualizados, com interface responsiva e menos CPU durante a partida.

**Architecture:** conservar Node ESM, HTTP local e interface JS/CSS. Separar estado observado, busca de composições, decisões rápidas e renderização; calcular cada parte somente quando suas dependências mudarem. Usar o watcher/SSE existentes, reaproveitar caches e só introduzir worker se o bloqueio do servidor continuar relevante.

**Tech Stack:** Windows nativo, Node 24.18.0, módulos ESM, HTTP/SSE, JS/CSS nativos; o leitor de tela PowerShell atualmente presente é uma fonte separada a medir, sem iniciar novas capturas nesta etapa.

**Data:** 2026-10-09. Plano, não implementação de desempenho.

## Diagnóstico observado

Medição local em processo Node separado, lendo o snapshot e os catálogos existentes; sem alterar o jogo, acionar o leitor de tela ou iniciar testes. Dataset: 8 jogadores, Hero com 8 unidades, alvo 9, 74 campeões, 507 itens, 66 builds de meta locais, banco e componentes manuais vazios.

| Execução | Busca `analyze` | Builds/posições `tactics` | CPU do processo durante a análise | Resultado serializado |
| -------- | --------------: | ------------------------: | --------------------------------: | --------------------: |
| 1        |          937 ms |                     13 ms |                           1125 ms |               161 KiB |
| 2        |          885 ms |                      3 ms |                           1062 ms |               161 KiB |
| 3        |         3073 ms |                     34 ms |                           1063 ms |               161 KiB |

RSS do processo isolado após as três execuções: 86 MiB. CPU pode somar mais de um segundo por segundo de parede devido a threads do runtime. A terceira execução teve tempo de parede muito maior sem crescimento equivalente de CPU: não atribuir essa diferença exclusivamente ao algoritmo. Três amostras não estabelecem p95 nem a carga do servidor durante uma partida.

179 PNGs ocupam 6.229.313 bytes (~5,94 MiB). Servidor já entrega esses assets com cache de um dia. Não há evidência de que trocar imagens seja a primeira otimização necessária.

A porta 3218 estava aberta na primeira inspeção, mas o PID não existia na coleta seguinte. Não foi obtida uma medição confiável da memória/CPU da instância atual. Não confundir RSS do processo de medição com consumo do servidor ou do PowerShell.

### Gargalos confirmados no código

1. `engine.mjs` explora traits, monta tabuleiros por busca gulosa e tenta trocas locais para cada direção. Cada avaliação reconstrói agregados de traits, slots e afinidade de itens. Busca é síncrona e bloqueia o event loop do servidor quando ocorre cache miss.
2. `server.mjs` já tem `analysisCache` com até 12 entradas, porém a chave inclui mtime e **todas** as opções. Alterar ouro, lado, alvo de scouting ou plano manual pode recalcular a busca inteira, mesmo quando apenas decisões/builds/posições mudam.
3. `app.js` executa `/api/state` e `/api/recommend` a cada 5 s. SSE também chama `update()`. `busy/pendingUpdate` evita simultaneidade no browser, mas ainda permite trabalho consecutivo redundante.
4. `current()` lê e faz parse do snapshot em cada consulta, embora `capture.mjs` já leia o mesmo arquivo com watcher e fallback de 500 ms.
5. `render()` e `renderPlanner()` constroem HTML de várias telas, inclusive ocultas. `smooth()`, `setMarkup()` e comparação de HTML já evitam parte das escritas idênticas, mas não evitam construir strings, ordenar alternativas e preparar telas invisíveis. `smooth()` também anima blocos que mudam; animação não substitui renderização seletiva.
6. O leitor de tela já presente roda em processo PowerShell com ciclo de 2500 ms, hashes de regiões e cache por slot. Pode consumir recursos, mas seu custo **não foi medido**. Não assumir que toda leitura repete OCR nem que emitir somente mudanças significa CPU zero em repouso.

### Riscos a preservar durante a otimização

- Sugestões continuam se atualizando automaticamente; somente a comp escolhida fica fixa no planner.
- Reserva e inventário manuais continuam considerados, sem inventar dados automáticos.
- Scouting não muda a identidade do Hero.
- Cache não pode manter decisões ao vivo quando a sessão/idade/eliminação já invalidou o snapshot.
- O cache atual armazena playbooks derivados de `metadata.actionable`; hits devolvem metadata nova com playbook antigo. Corrigir essa dependência ao separar análise e decisões.
- Não alterar pesos, regras ou quantidade de campeões apenas para tornar a busca mais rápida.

## Critérios de sucesso — metas, ainda não resultados

| Métrica                               | Meta inicial                                                         | Como avaliar na execução autorizada                     |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Snapshot e entradas sem mudança       | 0 buscas novas; nenhuma substituição de DOM dos painéis estáticos    | contadores por revisão, observação da UI                |
| Clique/seleção/movimento              | feedback local em até 100 ms                                         | painel Performance do navegador                         |
| Ouro/lado/scouting sem efeito no alvo | sem busca global; atualizar somente derivados                        | tempos e contadores por etapa                           |
| Novo tabuleiro publicado              | captura entregue em até 1 s após publicação, fora de falhas da fonte | timestamps de fonte/recepção/aplicação                  |
| Busca completa com mesmas regras      | reduzir pelo menos 50% da mediana observada em coleta comparável     | 20 medições autorizadas; comparar mesma máquina/entrada |
| Servidor durante busca                | p95 de resposta leve abaixo de 100 ms após worker, se necessário     | medir event-loop delay e endpoints sem iniciar captura  |
| Aba oculta                            | nenhum redraw; manter última revisão pendente                        | visibilidade e contadores de render                     |

O tempo entre a visita à arena e a publicação do arquivo é controlado pelo jogo. Nenhuma destas metas promete forçar essa publicação.

## Mapa de arquivos

| Arquivo                                 | Responsabilidade na otimização                                  |
| --------------------------------------- | --------------------------------------------------------------- |
| `tft/helper/capture.mjs`                | snapshot único validado em memória, revisão semântica, SSE      |
| `tft/helper/server.mjs`                 | separar cache de busca e derivados; estado/frescor; agendamento |
| `tft/helper/app.js`                     | solicitações coalescidas; revisão de estado; telas visíveis     |
| `tft/helper/planner.js`                 | renderizar campeão/tabuleiro apenas quando dependências mudarem |
| `tft/helper/engine.mjs`                 | reduzir custo de score mantendo resultado                       |
| `tft/helper/tactics.mjs`                | reutilizar índices/builds equivalentes por requisição           |
| `tft/helper/playbook.mjs`               | decisões rápidas com metadata e ouro atuais                     |
| `tft/helper/target-level.mjs`           | resolver alvo automático antes de decidir se a busca mudou      |
| `tft/helper/screen-reader.mjs` e `.ps1` | ciclo e lifecycle da fonte visual, caso autorizada/ativa        |
| `tft/helper/style.css`                  | consolidar regras; animação focada em mudança relevante         |
| `tft/helper/README.md`                  | explicar atualização, métricas e limitações                     |

Não criar framework, novo banco, bundler ou migrar para React para resolver estes gargalos.

## Chunk 1: remover trabalho repetido — prioridade máxima

### Tarefa 1 — medir as etapas separadamente

- [ ] Adicionar contadores locais de revisões recebidas, solicitações, cache hit/miss, buscas, builds e renderizações.
- [ ] Medir busca, tactics, playbook, serialização e render com `performance.now()`; usar `monitorEventLoopDelay` no servidor, em modo diagnóstico explícito.
- [ ] Registrar somente tempos/contadores e dimensões do dataset, sem lockfile, credenciais ou ambiente completo.
- [ ] Fazer uma coleta curta com estado estável, alteração de ouro, mudança de adversário e novo snapshot. Separar leitura do jogo, Node, PowerShell e navegador.
- [ ] Salvar a linha de base junto do plano. Não iniciar fonte de captura para obter uma medição.

Exemplo do contador de etapa, a incorporar no caminho existente:

```js
const began = performance.now();
const value = analyze(snapshot, catalog, options);
metrics.searchCount++;
metrics.lastSearchMs = performance.now() - began;
```

**Entrega:** evidência de onde CPU/latência crescem; não apenas tempo total da requisição.

### Tarefa 2 — compartilhar o snapshot do watcher

- [ ] Expor de `captureBoards()` a última cópia validada do snapshot e seu digest/revisão.
- [ ] Usar essa cópia em `current()`, conservando timestamp de fonte, último erro e identidade de partida. Ler disco no bootstrap/recuperação, não a cada GET e POST.
- [ ] Publicação parcial/malformada não deve substituir a última leitura boa; freshness continua baseada na fonte, não na leitura em cache. Guardar o último mtime validado mesmo quando o conteúdo/digest é idêntico: uma publicação idêntica renova o frescor, mas não inicia outra busca. O watcher atual atualiza stamp e retorna sem renovar current.sourceAt quando o digest não muda; corrigir esse caso.
- [ ] Emitir revisão semântica de jogadores/unidades/HP separada do mtime. Timestamp/campos cosméticos não devem disparar uma busca sem necessidade.
- [ ] Fazer o browser coalescer SSE e mudanças de formulário em uma única solicitação pendente. Agendar fallback somente após concluir a atualização anterior.
- [ ] Fazer o heartbeat consultar estado/frescor sem chamar a busca global se entradas/revisão não mudaram. Mudanças de fase, sessão, idade ou actionable devem atualizar/suspender imediatamente os conselhos exibidos, mesmo sem novo board. Recalcular decisões rápidas no servidor ou retornar um estado de invalidação que o browser aplique ao último playbook; não deixar orientações antigas na tela até o próximo snapshot.

**Entrega:** mesmo snapshot não gera novas buscas nem múltiplos parsings por polling.

### Tarefa 3 — separar busca de decisões e apresentação

- [ ] Resolver o nível alvo automático antes de construir a chave da busca.
- [ ] Extrair o resultado estável da busca (IDs das sugestões, scores e carry) dos campos derivados que mudam rapidamente. Cache deve guardar valores imutáveis: tactics() modifica planos e coverage, portanto não reutilizar um objeto cacheado como área de trabalho da próxima resposta.
- [ ] Construir chave canônica com jogo/set, alvo resolvido, tabuleiros/cópias/itens pertinentes, reserva/inventário e revisão do meta. Preservar multiplicidade e dono dos itens.
- [ ] Excluir da chave da **busca** lado, adversário selecionado e IDs da comp fixada, pois no código atual esses campos afetam o planejamento/counters, não a busca global. Ouro e nível atual só invalidam a busca quando mudarem o alvo resolvido ou alguma dependência real da pontuação.
- [ ] Recalcular playbook com metadata, HP e ouro atuais em cada resposta necessária; jamais armazenar `actionable` antigo dentro do cache de busca.
- [ ] Recalcular builds/counters pelas dependências completas: campeão, equipamentos, componentes, matchup, meta e cobertura de feridas/shred da equipe. build() recebe e modifica coverage compartilhada; sua ordem depende de carry/frontline. Preferir cachear candidatos independentes e aplicar cobertura depois em cada plano. Se cachear build final, incluir cobertura de entrada e reproduzir cobertura de saída, além da ordem/carry, sem bloquear utilidades ou duplicar efeitos por cache hit.
- [ ] Posições, transições e metas de estrelas exigem chaves próprias: comp, carry, lado, estrelas, situação do pool, reserva e tabuleiro atual. Espelhar pode ser local, mas não pode ignorar mudança dessas entradas.
- [ ] Canonicalizar multiconjuntos de inventário e reserva; ordem diferente não deve ser cache miss, e cópias repetidas não devem desaparecer.
- [ ] Coalescer cálculos pendentes por chave e limitar tamanho do cache. Invalidar por mudança de jogo/set/versão do catálogo.

**Entrega:** informar ouro e visitar rival deixam de executar busca global; as decisões continuam atuais.

## Chunk 2: deixar o navegador leve

### Tarefa 4 — renderizar por tela e revisão

- [ ] Manter o estado atual centralizado, mas renderizar apenas a tela ativa; marcar as demais como pendentes para o próximo acesso.
- [ ] Separar revisões de board, pool, itens, sugestões, plano escolhido e metadata/frescor.
- [ ] Atualizar contadores/idade sem reconstruir o tabuleiro. Selecionar campeão não deve reconstruir adversários, pool ou todas as builds.
- [ ] Reutilizar índices de campeões/itens no browser. Calcular a lista de substitutos apenas ao mudar campeão, comp ou catálogo.
- [ ] Atualizar hexágonos por ID/casa e trechos do inspector por dependência, preservando foco, posição de scroll e selects abertos.
- [ ] Substituir gradualmente o override de `innerHTML` em `smooth()` por renderizadores explícitos; manter a comparação de markup durante a transição.
- [ ] Cancelar animações anteriores do mesmo elemento antes de iniciar uma nova; limitar animação ao elemento alterado e respeitar movimento reduzido.
- [ ] Suspender renderização quando `document.hidden`, acumulando uma revisão para retomar. Não fazer isso eliminar a captura de dados necessária ao scouting.

**Entrega:** HUD, menu e arrastar continuam responsivos durante atualizações; telas escondidas não montam HTML.

## Chunk 3: reduzir a busca mantendo a lógica

### Tarefa 5 — otimizar avaliação de candidatos

Já existem `denomByCost`, `roleCache`, `thresholdCache` e `termCache`: reaproveitar; não reconstruir estes mesmos caches em outra camada.

- [ ] Trocar `filter().map().sort()[0]` por procura linear do maior score, preservando desempate e ordem atuais.
- [ ] Pré-computar índices de traits/campeões e demanda de itens da partida uma vez por revisão.
- [ ] Atualizar contagens de traits, número de tanques, roles e capacidade de slots por delta nas adições/trocas, em vez de recriar arrays/sets em cada `score()`.
- [ ] Memoizar scores completos de tabuleiros equivalentes dentro da busca, com chave que inclua focus; limitar cache por execução.
- [ ] Só deduplicar estados equivalentes se a ordem não alterar o resultado/carry/desempate. Não reduzir candidatos nem passes nesta etapa.
- [ ] Comparar IDs, carry, scores, metas de estrelas e explicações antes/depois com entradas equivalentes quando essa verificação for solicitada. Reportar qualquer diferença, não aceitá-la silenciosamente como otimização.

**Entrega:** cálculo mais rápido com mesmas sugestões, sem enfraquecer a análise.

### Tarefa 6 — worker apenas se continuar bloqueando

**Condição:** depois das tarefas anteriores, busca ainda provocar stalls acima de 100 ms em endpoints leves/interações relevantes.

- [ ] Criar `tft/helper/analysis-worker.mjs` com um worker Node persistente para a busca; não criar processo por atualização.
- [ ] Enviar revisão + opções normalizadas; carregar catálogo/meta versionados no worker sem reserializar tudo a cada pedido.
- [ ] Manter o servidor atendendo estado/SSE com a última análise concluída e identificação de revisão/horário; exibir “recalculando” ao invés de apresentar resposta antiga como atual.
- [ ] Descartar resultados de revisões superadas; última entrada pendente substitui a anterior na fila. Tratar erros e encerramento do worker.
- [ ] Lembrar: worker melhora responsividade, mas não reduz por si só a CPU total.

**Entrega:** algoritmo caro não bloqueia estado/scouting. Pular esta tarefa se a responsividade já estiver adequada.

## Chunk 4: medir fontes opcionais e fechar

### Tarefa 7 — leitor de tela e dados estáticos

- [ ] Medir CPU por delta, memória e tempo de ciclo do PowerShell já ativo; não usar CPU acumulada como carga instantânea.
- [ ] Se relevante, adicionar backoff quando a janela não está visível e no estado sem alterações; restaurar frequência ao detectar mudança. Manter validade/idade e controle manual de dados.
- [ ] Confirmar lifecycle único, encerramento e liberação de bitmaps/streams/handles em todos os caminhos de erro.
- [ ] Consolidar CSS duplicado por componente após as otimizações principais; evitar empilhar overrides novos.
- [ ] Só reduzir imagens/payloads após medir transferência/decodificação/serialização. 161 KiB é o resultado da medição isolada, não o tamanho total de todo endpoint.
- [ ] Documentar tempos de captura, cálculo e UI separadamente e o comportamento quando uma fonte falhar.

**Entrega:** fontes independentes não competem desnecessariamente com jogo/interface.

## Ordem de execução e ponto de parada

1. Instrumentar, compartilhar snapshot, coalescer chamadas e corrigir dependências de cache.
2. Renderizar somente o que mudou na tela ativa.
3. Otimizar algoritmo preservando os resultados.
4. Introduzir worker se a medição ainda exigir; tratar leitor de tela conforme custo medido.

Parar quando as metas forem atingidas e os comportamentos preservados. Não executar todos os passos apenas para completar a lista.

### Checklist funcional para a execução autorizada

- Sugestões automáticas mudam com informação nova; meta escolhida não troca sozinha.
- Comp de nível 9 continua com 9 campeões.
- Reserva/inventário/cópias e recipes continuam respeitando quantidade e autoria.
- Alterar ouro atualiza economia/roll sem congelar decisões antigas.
- Adversário selecionado atualiza counters sem virar o jogador local.
- Fase inválida/idade excessiva/eliminação pausam conselho ao vivo inclusive com cache hit.
- Copiar código, mover por mouse/teclado, recolher menu e trocar telas continuam disponíveis.
- Memória/filas/instâncias de worker ou leitor não crescem indefinidamente.

Nenhuma destas alterações de desempenho foi aplicada neste trabalho de planejamento. Revisão visual e métricas do navegador seguem pendentes porque não há browser conectado nesta sessão.

## Revisão do plano

Revisão técnica independente apontou três correções incorporadas: renovação do frescor sem mudança de digest, suspensão de conselhos pelo heartbeat e dependências completas de coverage/carry nos caches de derivados. Não houve implementação de otimização, alteração no jogo ou novas capturas.
