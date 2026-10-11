# core/ - o lugar das regras

Regra de ouro: **uma regra, um lugar.** Toda regra do jogo ou política do helper é uma função pura (ou uma tabela de
dados) dentro de `core/`. Nenhum outro módulo recalcula, reinterpreta ou "arredonda de novo" um valor que `core/` já
produz: ele o **lê**.

Esta pasta nasceu vazia (M1 de `../ARQUITETURA.md`). Cada passo da migração move uma regra para cá e apaga a
exceção correspondente em `../tests/architecture.test.mjs`. Já moram aqui: `state/` (M7: relógio "S-R", nível e XP, `Field`, precedência GEP x tela com histerese, `GameState` e as entradas da análise; M10b: `analysis-key.mjs`, a chave de análise e as decisões do usuário que cliente e servidor calculam igual; M8b: `snapshot-identity.mjs`, o que a análise lê do snapshot do jogo, que é a chave da entrada `snapshot` do grafo e a assinatura do `/api/state`; a memória entre leituras fica em `../app/state.mjs`), `catalog/traits.mjs` (traços, patamares, solo e
emblemas; M3), `catalog/items.mjs` e `catalog/champions.mjs` (papel, tipo, receita, consumível, radiante e cobertura de item; papel e
Avatar de campeão; M2) e `graph/` (grafo de fatos derivados com memoização por entradas declaradas; M8a, em uso desde o M8b: os fatos da
recomendação estão em `../app/recommend-facts.mjs` e a simulação de rolagem em `../roll-sim.mjs`; quem precisar de cache por
chave usa `graph/index.mjs` em vez de um `Map` com chave montada à mão; uma entrada grande pode declarar `identity`, a projeção
que dá a chave dela) e `pool/` (M4: `tables.mjs` com
`POOL`, `ODDS`, `SHOP` e `BUYABLE_ODDS`; `copies.mjs` com cópias por estrela e pool livre fracionária; `shop.mjs` com a chance
por slot e por loja; `curve.mjs` com a chance acumulada por ouro; `buy-copies.mjs` com a regra de compra de cópias de peças do plano que você já tem) e `economy/` (M5b: `policy.mjs` com `POLICY`, todos os limiares de
ouro e de vida; `tables.mjs` com a renda, os juros e o HP máximo; `gold.mjs` com juros, renda, projeção e as lojas ao alcance; `pressure.mjs`
com a faixa de vida e a tendência; `rounds.mjs` com o calendário que a projeção usa), `comps/` (`reach.mjs`: o alcance de uma comp,
a chance de montá-la a tempo e a parte esperada dela no prazo, com as peças em campo e na reserva, as estrelas, a pool livre, os
rivais, o ouro, o nível e a vida; entra no `p` da colocação esperada que ordena as comps em `../engine.mjs`) e `items/` (M6: a posse de itens. `stock.mjs`
gasta uma cópia uma vez; `holdings.mjs` diz onde está cada item, na Formação e comp a comp; `bank.mjs` reparte o banco entre as
builds da aba Comps; `moves.mjs` lê os passes de "Passar itens"; `owned.mjs` tem as contas sem localização; `champion-items.mjs` dá, para cada campeão, os até 3 itens ideais com a situação de cada um e o rótulo curto que a interface e o overlay desenham; motor único de itens: `builds.mjs` decide QUAL build cada campeão usa, a publicada na comp como na aba Comps, ou a reserva declarada e marcada; `scenarios.mjs` tem as fachadas por cenário; `comp-bank.mjs`, os itens do banco que combinam com a comp na aba Comps; ver `../planos/feitos/itens-motor-unico.md`). O valor de cada
situação é política do motor e fica em `../item-holdings.mjs`). O servidor serve esta pasta ao navegador em `/core/*` (só `.mjs`/`.js`/`.html`/`.css`/`.svg`); a interface
importa por caminho relativo (`../../core/...` a partir de `v2/js/`), que resolve igual no Node e no navegador.

## O que pode morar aqui

- ESM puro: carrega igual no servidor e no navegador, sem build.
- Sem `node:*`, `fetch`, `process`, `Date.now`, `new Date()` nem `Math.random`. O tempo entra como argumento
  (`clock.now`); o aleatório, como semente fixa.
- Importa só de `core/`. Nunca de `v2/`, de `server.mjs` nem de fontes de dados.
- Não muta o que recebe. Devolve valores novos.

## Camadas (a dependência só desce)

```
engines/   consomem fatos e produzem decisões (comps, plan, roll, items, augments, contest)
facts/     fatos derivados, funções puras de entradas nomeadas (economia, pool, loja, itens, traços, força)
graph/     o mecanismo dos fatos: defineFact, createGraph, memoização, invalidação mínima (transversal; sem regra de jogo)
state/     GameState: valor + fonte + confiança + idade por campo
rules/     tabelas do patch e política (limiares) com fonte e data de verificação
catalog/   índices do catálogo: itens (papel, receita, radiante), campeões, traços
```

`facts/` não importa `engines/`. `engines/` não lê estado cru nem regra: lê fatos.

## Como saber se a regra já está aqui

`../tests/architecture.test.mjs` lista, por regra, quem ainda a reimplementa (as exceções, com o motivo e o passo que as
remove). O teste falha se uma cópia nova aparece e também se uma cópia some sem o número ser baixado: a catraca só gira
num sentido. `ARCH_REPORT=1 node --test tests/architecture.test.mjs` imprime o estado atual.

## Quando mudar uma regra

Mude-a **aqui**. Se outro arquivo precisar do valor, ele chama a função; se precisar de um número novo, o número entra
na tabela (`rules/`) ou na política, nunca como literal no consumidor. Diferença de resultado entra no golden
(`../tests/golden/`) com o diff revisado e registrado em `../ARQUITETURA.md`.
