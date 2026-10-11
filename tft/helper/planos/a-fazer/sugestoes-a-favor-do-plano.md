# Sugestões a favor do plano

Pedido do usuário (2026-10-11): "Quando estamos com uma comp, as sugestões precisam ser de acordo com aquela comp: rolar,
economizar juros, juntar ouro etc. Os dados param de ser tão dinâmicos e começam a trabalhar a favor da comp."

Estado: **a fazer**, depois que terminarem `tft-comp-viabilidade` (regra de troca estável), `tft-pressao-vida` (vida sem
derrubar o plano), `tft-itens-central` e `tft-overlay`. Executor previsto: `tft-progresso`.

## O que já é assim (verificado em 2026-10-11)

- `strategy.mjs` (`strategy(plan, …)`): economia, nível e rolagem pelo estilo da comp alvo (`rerollLevelOf`,
  `finalLevelOf`, `meta.levelling`, `stars3`): reroll no nível N, "Fast 8/9", padrão.
- `roll.mjs` (`teamOf(plan, …)`): peso cheio para as peças do plano, `R.offPlanWeight` para o resto, estrela-alvo por peça.
- A comp fixada pelo usuário vira o plano sem confirmação (`plan-state.mjs`).

## Auditoria a fazer

1. Toda sugestão lê o **plano em andamento** (mantido ou fixado), nunca a 1ª do ranking: Ao vivo, overlay (cartão "Agora",
   compra, rolagem, itens, carrossel, aprimoramento), loja (`stage.mjs` buyNow), itens (`core/items/` por cenário), carrossel,
   aprimoramentos (`augment-advice.mjs`) e nível (`target-level.mjs`). Listar cada consumidor e de onde ele tira a comp.
2. Os dados da rodada (ouro, loja, vida, rivais) mudam **como** chegar à comp, e só mudam **qual** comp pela regra de troca
   (uma medida, custo + histerese, fato novo). Teste de caracterização: uma sequência de estados de uma partida real, com o plano
   fixo, em que todas as sugestões citam peças, nível e estilo do plano.
3. Quando o plano muda, todas as sugestões mudam juntas, na mesma leitura, e a tela diz o porquê. Nenhuma tela pode ficar com
   o plano anterior.
4. As sugestões genéricas que não servem à comp (comprar peça fora do plano, rolar por qualquer upgrade) só aparecem com
   motivo explícito (vida crítica, pivô anunciado) e marcadas como tal.
