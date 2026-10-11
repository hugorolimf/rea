# core/ - o lugar das regras

Regra de ouro: **uma regra, um lugar.** Toda regra do jogo ou política do helper é uma função pura (ou uma tabela de
dados) dentro de `core/`. Nenhum outro módulo recalcula, reinterpreta ou "arredonda de novo" um valor que `core/` já
produz: ele o **lê**.

Esta pasta nasceu vazia (M1 de `../ARQUITETURA.md`). Cada passo da migração move uma regra para cá e apaga a
exceção correspondente em `../tests/architecture.test.mjs`. Já moram aqui: `catalog/traits.mjs` (traços, patamares, solo e
emblemas; M3). O servidor serve esta pasta ao navegador em `/core/*` (só `.mjs`/`.js`/`.html`/`.css`/`.svg`); a interface
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
