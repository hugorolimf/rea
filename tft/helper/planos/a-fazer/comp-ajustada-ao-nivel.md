# Comp ajustada ao nível: alternativas fortes no lugar de peças baratas fora de hora

## Problema

A comp sugerida é a de `meta-comps.json` (correto), mas o plano pede as peças **originais** dela mesmo quando:

- o estágio/nível já é alto (nível 8–9): a chance de achar uma peça de custo 1–2 na loja é pequena;
- a peça original é fraca nesse momento (1★/2★ de custo 1), e colocá-la **tira força** de um tabuleiro que já está bom.

Hoje `core/board/interim.mjs` só segura um substituto **temporariamente** (até o titular ficar forte); o titular continua
sendo a meta e a loja continua mandando buscá-lo.

## Regra desejada

A comp (identidade, carry, sinergias-chave `key`) não muda. O que muda é **quem ocupa cada vaga de apoio** conforme o nível:

- Vaga "rebaixável": peça de custo baixo (≤ nível − 6, ex.: custo 1–2 no nível 8) que **não** é carry, não está em
  `key`/`stars` (comp de reroll mantém as suas 3★) e cuja força esperada no seu tabuleiro é menor que a de uma alternativa.
- Alternativa: peça de custo ≥ a original, achável no nível atual (odds da loja × cópias livres), que mantém os
  patamares de sinergia que a original sustentava (ou os troca por outro patamar de valor igual/maior).
- A alternativa vira o **titular efetivo** da vaga: loja, "Segure", Formação, overlay e motor passam a pedi-la; a
  original deixa de ser buscada. Se você já tem a original 2★/3★ forte, ela fica (não regredir).

## Fontes de dados (já temos, sem nova coleta)

- `meta-stats.json` → `unit["Peça|estrelas"] = [colocação média, partidas]` (MetaTFT explorer): força medida da peça por
  estrela. `trait["Sinergia|patamar"]`: valor medido do patamar.
- Odds da loja por nível e pool (`core/pool/shop.mjs`, `copies.mjs`) e a força na vaga (`slotStrength` em interim.mjs).
- MetaTFT: as páginas de comp mostram o tabuleiro final e variações; **verificar** se a API expõe "unit options"/
  boards por nível. Se expuser, usar como lista preferencial de alternativas por comp (sincronizada pelo meta-offline);
  se não, derivar pelas estatísticas acima.

## Passos

1. **`core/comps/level-fit.mjs` (novo, puro):** `levelAdjustedBoard(comp, { level, stage, owned, pool, stats, book })`
   → para cada vaga: `{ original, effective, reason }`. Pontua candidatas por: Δ colocação média (meta-stats, na estrela
   provável) + sinergias mantidas (trait stats) + chance de achar no nível (≥ alvo) − perder peça já possuída.
   Regras duras: não mexe em carry, `key`, `stars`/3★ de reroll; só rebaixa vaga com nível ≥ 7 (política em
   `POLICY.levelFit`, limiares marcados como política).
2. **Engine (`engine.mjs`):** depois de escolher a comp, aplicar `levelAdjustedBoard` ao `plan.board` (fonte única);
   guardar `plan.board[i].original` para exibir "no lugar de X". O ranking das comps também passa a usar o tabuleiro
   ajustado no score de alcance (comp forte com 1-custos difíceis deixa de ser penalizada no late).
3. **Continuidade (`plan-state.mjs`):** a troca fica estável (histerese): só volta para a original se ela aparecer 2★
   ou o nível cair de patamar; nada de oscilar a cada rodada.
4. **Loja / interim:** a loja passa a recomendar a alternativa; `interim.mjs` usa o titular efetivo (a original não
   gera mais "compre os dois").
5. **Telas:** Ao vivo, Formação e overlay mostram a alternativa com a nota "melhor que _Original_ no nível 8"; aba Comps
   mostra a variação do nível ao lado do tabuleiro final (mesma regra, via core).
6. **Meta offline:** se a MetaTFT tiver opções por comp, gravar em `meta-comps.json` (`options`) e usar como primeira
   lista de candidatas.

## Casos para conferir (quando for validar)

- Nível 8, tabuleiro forte, comp pede 2 peças de custo 1 que você não tem → sugere 4-custos da mesma sinergia.
- Comp de reroll de custo 1 (lvl 5–6) → nada muda (3★ são a comp).
- Você já tem a peça de custo 1 em 3★ → ela fica.
- Vida em perigo → prioriza a peça mais forte achável agora (mesma direção, margem menor).
