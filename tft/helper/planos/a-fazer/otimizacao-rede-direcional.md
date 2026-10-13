# Otimização: rede direcional com cache

Pedido do usuário (2026-10-12): o sistema está pesado e instável ("hora funciona, hora não"). A tela de score e comps
faz muitas contas em muitas comps. **Regra do pedido: técnicas de otimização de verdade, sem cortar funcionalidade.** As
60 comps continuam com o score completo, as perguntas à MetaTFT continuam exatamente as mesmas (seus itens no campeão,
estrelas, emblemas) e a tela mostra o mesmo resultado. Muda só como e quando cada conta é feita.

Este plano complementa `otimizar-fluxos-de-analise.md` (SSE, reserva separada, atraso do event loop), que continua
valendo.

## 1. O que o log mostra (`server.log`, 2026-10-12)

| Medida                          | Antes das 17h | Das 22h em diante                            |
| ------------------------------- | ------------- | -------------------------------------------- |
| Análise (média)                 | 3–5 s         | ~11 s                                        |
| Pior análise                    | 37–55 s       | 139 s (timeout da thread de 60 s duas vezes) |
| Rede por análise (média)        | ~1 s          | 2,3–3,0 s (pior: 18,5 s)                     |
| Perguntas à MetaTFT por análise | 17–24         | 46–64 (pior: 360, no teto)                   |
| Espera na fila                  | —             | até 94 s                                     |
| Resposta do `/api/recommend`    | ~0,8 MB       | ~1,25 MB                                     |

Onde o tempo vai:

1. **A mesma análise roda até 4 vezes por leitura.** `settleEvidence` (`app/live-load.mjs`) analisa, pergunta à
   MetaTFT o que faltou, e **refaz a análise inteira das 60 comps** para encaixar as respostas, até 3 passadas. As
   respostas mudam a medição de poucas comps, mas tudo é recalculado.
2. **Um nó único para tudo.** O fato `comps.base` (`app/recommend-facts.mjs`) lê loja, ouro, itens, nível e reserva.
   Qualquer mudança (1 de ouro, uma carta nova na loja) invalida o nó inteiro: alcance, vitória, plano de itens
   (algoritmo húngaro com até 4 conjuntos de montagem por comp), troca por nível e prioridade de itens das 60 comps.
   Pior caso: 18 s de CPU, tudo numa thread só (a máquina tem 12 núcleos).
3. **Perguntas em série.** Algumas perguntas só são feitas depois da resposta de outra (a vitória por estrela da
   peça-chave depende da pergunta escolhida), e cada uma volta para a análise inteira (item 1).
4. **Fila.** A análise automática e o POST da tela rodam um atrás do outro (`espera`); no pior caso, 94 s.
5. **Resposta grande.** ~1,25 MB, serializada de novo a cada POST (50–830 ms).

## 2. Meta

- Leitura comum (ouro, loja, um item novo): **p95 < 1,5 s** do estado à tela.
- Mudança grande (nível, compra de peça, comp nova): **p95 < 3 s**.
- Resposta da MetaTFT encaixada em **< 100 ms** (só o nó da comp que perguntou).
- Nenhum timeout de 60 s; nenhuma espera de fila maior que uma análise.
- **Mesmo resultado**: ranking, score, medição e telas idênticos aos de hoje para o mesmo estado (conferido no passo 6).

## 3. A rede direcional (o centro do plano)

Fluxo de mão única: **dados do jogo → entradas → nós por comp → score → modelo de tela**. Nenhum nó lê o resultado de
outro fora dessa ordem, e cada nó guarda o resultado pela chave **só das entradas que ele lê** (computação incremental:
o mesmo cálculo de hoje, refeito só onde a entrada mudou).

### 3.1 Nós por comp

| Nó                                                                       | Lê só                                                               | Refaz quando                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------- |
| `comp.shape` (peças, sinergias, troca por nível, vagas com Elder Dragon) | meta, nível, suas peças (id e estrela)                              | sobe de nível, compra ou vende peça     |
| `comp.reach` (chance de montar, prazo, vitória por estrela)              | `comp.shape`, pool, rivais, ouro, nível, vida                       | loja, ouro, rival                       |
| `comp.items` (plano de itens, prioridade de itens)                       | `comp.shape`, banco, itens equipados                                | item ou componente novo                 |
| `comp.questions` (as perguntas, idênticas às de hoje)                    | `comp.shape`, `comp.items`, suas estrelas, emblemas, aprimoramentos | quando qualquer filtro da pergunta muda |
| `comp.evidence` (a medição)                                              | `comp.questions` e as respostas                                     | chega resposta da comp                  |
| `comp.score`                                                             | os nós acima                                                        | qualquer um deles                       |
| `ranking`                                                                | `comp.score` das 60 comps e a regra de troca de plano               | qualquer score                          |

- Ganhar 1 de ouro refaz só `comp.reach` e o score; um componente novo refaz `comp.items` e as perguntas que dependem
  dele; uma resposta da MetaTFT refaz só `comp.evidence` daquela comp. O resto vem do cache.
- O grafo atual (`core/graph/graph.mjs`, `defineFact`, `cutoff: "key"`) já guarda por chave; falta quebrar
  `comps.base` nesses nós, com chave estável por comp (`core/graph/stable-key.mjs`).
- A passada de evidência deixa de reanalisar tudo: `settleEvidence` passa a só invalidar `comp.evidence` das comps que
  receberam resposta.

### 3.2 Rede (MetaTFT) sem perder pergunta

As perguntas não mudam; muda como são feitas:

- **Todas de uma vez.** As perguntas condicionais (vitória por estrela) são calculadas para todas as perguntas
  candidatas da comp e disparadas junto, na mesma passada, em vez de esperar a resposta anterior.
- **Pré-busca especulativa.** Em segundo plano, fora do caminho crítico, o servidor pergunta o que provavelmente vem a
  seguir: a mesma comp com a peça na próxima estrela, com um item a mais no campeão que a prioridade de itens aponta, e
  as comps do topo no próximo nível. Quando o estado chega lá, a resposta já está no cache (memória e disco, 6 h).
- **Conexão reaproveitada.** Agente HTTP com keep-alive e mais conexões paralelas (hoje 8), sem refazer TLS a cada
  pergunta.
- **Sem pergunta repetida em voo.** Duas comps (ou duas análises) que pedem a mesma pergunta esperam a mesma requisição.
- **Resposta parcial que se completa sozinha.** Enquanto uma pergunta não volta, a comp mostra a medição que já tem
  (a da pergunta mais curta respondida, como hoje no teto de rede) e se atualiza quando a resposta chega, sem refazer as
  outras comps. Nada é descartado: a resposta final é a de hoje.

## 4. Outras técnicas (todas sem corte)

1. **Paralelismo.** As 60 comps são independentes: dividir os nós por comp entre várias threads de trabalho (pool com
   núcleos − 2). O resultado é o mesmo; o tempo de parede cai na proporção dos núcleos.
2. **Uma análise por estado.** A análise automática e o POST da tela pedem pela mesma chave de estado; quem chega depois
   espera a mesma promessa, sem fila. A análise de um estado já superado é cancelada (pendência "Análises obsoletas na
   fila"); o estado novo herda os nós já prontos.
3. **Coalescer eventos do GEP.** Mudanças que chegam juntas (ouro, loja, XP no início da rodada) são agrupadas numa
   janela curta (~250 ms) antes de disparar a análise. O estado final analisado é o mesmo.
4. **Pré-cálculo estático no carregamento.** O que não depende da partida é calculado uma vez quando a meta carrega:
   sinergias e patamares de cada comp, receitas, a lista de itens de cada campeão na comp (`compItemOptions`), as tabelas
   de chance da loja por nível e custo, as combinações (hipergeométrica) usadas no alcance.
5. **Memoização das funções puras quentes.** Chance de achar k cópias (por custo, nível, cópias livres, lojas), contagem
   de sinergias por tabuleiro, força da vaga do substituto: cache por chave numérica.
6. **Chaves baratas.** Trocar `JSON.stringify` em laço quente (chave do plano de itens em `engine.mjs` `planFor`, chaves
   de memo) por hash incremental das entradas; evitar recriar `Map`/arrays por comp.
7. **Plano de itens incremental.** O algoritmo húngaro (`item-plan.mjs`) guarda o resultado por (peças da comp, banco,
   itens equipados); comps com as mesmas peças e o mesmo banco reaproveitam. É o mesmo ótimo de hoje.
8. **Perfil antes de cada passo.** `node --cpu-prof` numa partida gravada para achar as funções que mais gastam; cada
   técnica acima só entra onde o perfil mostrar ganho.
9. **Resposta leve sem perder dado.** Serializar uma vez por versão e reaproveitar a string; compressão (gzip/brotli)
   no `/api/recommend`; ETag para o cliente receber "não mudou" (304) sem baixar de novo; enviar ao cliente só o que
   mudou desde a versão que ele tem (diff por comp). O cliente remonta o mesmo objeto.
10. **Resposta progressiva.** Cada nó pronto é publicado pelo SSE (`analysis`, pedido em `otimizar-fluxos-de-analise.md`):
    a decisão da rodada e a Formação aparecem primeiro, o ranking se completa em seguida. Nada fica de fora; só a ordem
    de chegada muda.
11. **Orçamento por etapa no log.** A linha `TEMPO` ganha os nós do grafo (acerto do cache por nó, perguntas feitas na
    hora × vindas do cache ou da pré-busca) e um aviso quando a leitura comum passa de 1,5 s.

## 5. Ordem dos passos

| Passo | O que                                                                                   | Ganho esperado                                                | Risco                                            |
| ----- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| P1    | Perfil (4.8) + log por etapa (4.11) numa partida gravada                                | saber onde está cada ms                                       | nenhum                                           |
| P2    | Uma análise por estado + cancelar a obsoleta (4.2) e coalescer o GEP (4.3)              | acaba a espera de fila                                        | baixo                                            |
| P3    | Rede: perguntas juntas, sem repetição em voo, keep-alive e pré-busca especulativa (3.2) | rede quase sempre do cache                                    | baixo                                            |
| P4    | Quebrar `comps.base` em nós por comp e encaixar a resposta só na comp (3.1)             | fim das 4 análises por leitura; leitura comum recalcula pouco | alto: mexe no grafo e nos fatos                  |
| P5    | Paralelismo por comp (4.1)                                                              | tempo de parede ÷ núcleos                                     | médio: dados entre threads                       |
| P6    | Pré-cálculo, memoização, chaves baratas e plano de itens incremental (4.4–4.7)          | CPU por comp menor                                            | baixo                                            |
| P7    | Resposta leve e progressiva (4.9–4.10)                                                  | tela e overlay mais leves                                     | médio: contrato novo com a interface e o overlay |

P2 e P3 resolvem a instabilidade; P4 e P5, o peso. Cada passo fica de pé sozinho e é medido pelo log antes do próximo.

## 6. Regras de execução

- **Mesmo resultado:** cada passo compara, em partidas gravadas, o ranking, o score, as perguntas feitas e o modelo de
  tela antes e depois; qualquer diferença é um defeito do passo, não uma mudança aceita.
- O usuário reinicia o servidor; cada passo diz se exige reinício.
- Testes só quando o usuário pedir; cada passo lista os testes que vão mudar.

Executor previsto: `tft-desempenho` (P1, P2, P3, P5, P6, P7); `tft-arquiteto` desenha e `tft-migracao` executa o P4.

## 7. Andamento

**2026-10-12, primeira rodada (código, sem testes nem validação, por pedido do usuário).** Perfil de CPU com
`scripts/bench-analysis.mjs` (cenário `items-bank-lvl8`, evidência congelada) apontou as contas quentes; corrigidas sem
mudar resultado:

- `engine.mjs`: `traits(board)` e `legal(board)` com cache pelo conjunto de peças dentro da análise (eram a maior conta:
  `traits.mjs` somava ~3,4 s de 26 s no perfil); a peça no formato de contagem (`traitUnit`) guardada por campeão; o
  laço `extend` calcula as vagas usadas uma vez por volta e testa presença por `Set`.
- `core/catalog/champions.mjs`: `isAvatar` e `unitSlots` com cache (0,35 s e 0,5 s no perfil).
- `core/items/builds.mjs`: itens medidos de cada campeão indexados uma vez (`measuredItemsOf`), em vez de varrer todos os
  pares `unitItem` por campeão (`reserveScores`).
- `evidence.mjs`: 16 perguntas em paralelo (eram 8); a deduplicação em voo e o keep-alive já existiam.
- P2: a análise automática já é uma por vez e o POST já reaproveita o resultado da mesma chave
  (`app/auto-refresh.mjs` `createRecentResults`); a espera restante é de estados diferentes atrás de uma análise longa
  e cai com o P4.

Falta: P4 (nós por comp e respostas encaixadas só na comp: fim das até 4 análises completas por leitura), P5
(paralelismo), o resto do P6 (pré-cálculo e plano de itens incremental) e o P7. Medir com a linha `TEMPO` da próxima
partida antes do P4.

**2026-10-12, segunda rodada.** Novo perfil mostrou que o `extend` (crescer cada comp até o nível) era metade da
análise: para cada vaga recontava as sinergias do tabuleiro inteiro com cada um dos ~60 candidatos.

- `engine.mjs` `extend`: conta incremental exata (o tabuleiro é contado uma vez por vaga; cada candidato soma só as
  sinergias dele, com a mesma regra de patamar, de sinergia solo e o mesmo desempate) e resultado guardado **entre
  análises** (`EXTEND_MEMO`) pela chave de tudo o que ele lê (`extendCtx`: nível, aprimoramentos, suas peças com estrela
  e itens, cópias vistas e disputa). As passadas de evidência e as leituras em que isso não mudou reaproveitam.
- `engine.mjs` `prefetchStars`: as variações por estrela da peça-chave de cada pergunta ainda sem resposta entram na
  mesma leva da pergunta (antes esperavam a escolha da pergunta e uma passada a mais de rede e de análise). As respostas
  usadas são as mesmas.

Medido com `scripts/bench-analysis.mjs` (cenário `items-bank-lvl8`), antes → depois das duas rodadas:

| Modo               | Mudança | Análise p50   | Atraso do loop máx. |
| ------------------ | ------- | ------------- | ------------------- |
| processo principal | tudo    | 2932 → 232 ms | 2752 → 193 ms       |
| processo principal | ouro    | 1435 → 82 ms  | 1002 → 45 ms        |
| thread             | tudo    | 756 → 394 ms  | 60 → 2 ms           |
| thread             | ouro    | 301 → 134 ms  | 10 → 3 ms           |

`analyze` somado no perfil: 10,9 s → 0,96 s.

Decisões: P5 (paralelismo por comp) não compensa mais: a análise ficou em 0,2–0,4 s e repartir as comps entre threads
custaria mais em cópia de dados do que economiza. P7: a resposta já sai serializada uma vez pela thread; compressão não
ganha nada no localhost. P2 já existia (`createRecentResults`). O que resta de tempo na partida é a rede da MetaTFT
(cache de 6 h, 16 em paralelo, pergunta repetida em voo compartilhada, estrelas na mesma leva).

**2026-10-12, ajuste depois da partida.** No late game a análise voltou a 24–71 s. Pelo log: a pré-busca das estrelas
(`prefetchStars`) triplicou as perguntas (até 1.018 numa análise; antes, até ~360) e a rede foi a 10–23 s; foi retirada.
O teto de espera de rede por análise caiu de 15 s para 5 s (`EVIDENCE_BUDGET_MS`, `server.mjs`): o que não chega a tempo
segue em busca e entra no cache para a leitura seguinte. Além disso, a máquina estava sem folga: CPU do servidor 6–9% com
o event loop parado 3–6 s; os maiores consumidores eram `audiodg` (áudio do Windows), o cliente do LoL e o TFT.
