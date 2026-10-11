// A simulação de rolagem do time (Monte Carlo com semente fixa, economy.rollSim) como FATO do grafo (M8b), no lugar do
// `SIMS` com chave montada à mão (`JSON.stringify([nível, denom, alvos])`, teto 24) que vivia em roll.mjs.
//
// A simulação só depende do nível, da pool livre por custo (`denom`) e dos alvos; o ouro não entra: quando só o ouro
// muda, o fato é reaproveitado (é o cálculo a frio de ~370 ms). A chave é o resumo ESTRUTURAL das três entradas
// declaradas (core/graph), então a ordem das chaves de `denom` não importa, e o histórico guarda 24 simulações
// (LRU), como o `SIMS`. O grafo é pequeno e próprio: `strategy()` monta o time por dentro (`teamOf`), então o fato não
// pode depender dos outros fatos do pipeline (app/recommend-facts.mjs) sem partir `strategy`; fica aqui, ao lado da
// regra que o chama, e `simStats()` entrega os contadores para o `TEMPO`.
//
// Regras de fato (travadas por tests/architecture.test.mjs): `defineFact` na raiz do módulo, `compute` é função nomeada
// da raiz, sem estado mutável de módulo.
import { createGraph, defineFact } from "./core/graph/index.mjs";
import { POLICY, rollSim } from "./economy.mjs";

/** Teto de ouro simulado (o das curvas da rolagem). */
const MAX_GOLD = POLICY.simulation.maxGold;
/** Quantas simulações ficam guardadas (a mesma conta do `SIMS` de antes). */
const KEEP = 24;

function simulateTeam({ level, denom, targets }) {
  return rollSim({ level, targets, denom, maxGold: MAX_GOLD });
}

export const rollSimFact = defineFact({
  id: "roll.sim",
  inputs: ["level", "denom", "targets"],
  compute: simulateTeam,
  // A saída tem arrays tipados enormes (ouro x ganho): não resumir; o corte é pela chave das entradas.
  cutoff: "key",
  keep: KEEP,
  doc: "Monte Carlo do time inteiro: ganho esperado e chance de evoluir por orçamento de ouro, para (nível, pool livre por custo, alvos).",
});

const sims = createGraph({
  facts: [rollSimFact],
  inputs: ["level", "denom", "targets"],
  keep: KEEP,
});

/**
 * Simulação do time para `(level, denom, targets)`. Copia `denom` e `targets` antes de entregar ao grafo (a mesma
 * referência mutada depois não seria percebida como mudança). O resultado é compartilhado: não altere.
 */
export function simulate(level, denom, targets) {
  sims.set({ level, denom: { ...denom }, targets: [...targets] });
  return sims.get("roll.sim");
}

/** Contadores do grafo da simulação (computes, hits, reused, entradas), para o relatório de `TEMPO` e os testes. */
export const simStats = (options) => sims.stats(options);
