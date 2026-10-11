// Pipeline de thread para testes e medições SEM rede: o mesmo `createAnalysisPipeline` que a thread de produção
// (app/analysis-thread.mjs) usa, com o catálogo do golden e a evidência CONGELADA no lugar do explorer da MetaTFT.
// Contrato: analysis-worker-entry.mjs. `init` recebe `{ root }` (a pasta do helper).
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAnalysisPipeline } from "../../app/analysis-pipeline.mjs";
import { filterKey } from "../../evidence.mjs";

/** Cliente de evidência que responde só do subconjunto congelado (o que não está nele responde como a rede fora: null). */
export function frozenEvidence(ctx) {
  const total = new Map(ctx.evidence);
  return {
    conditional: async (filter) => ctx.conditional.get(filter) ?? null,
    totals: async (filterSets) =>
      new Map(
        filterSets.map((f) => [filterKey(f), total.get(filterKey(f)) ?? null]),
      ),
  };
}

/** Cria o pipeline do golden (usado direto nos testes e pela thread). */
export function goldenPipeline(ctx, { yieldBetween } = {}) {
  return createAnalysisPipeline({
    heroId: "47445859",
    catalog: ctx.catalog,
    plannerCatalog: ctx.plannerCatalog,
    localNames: ctx.localNames,
    augmentById: ctx.augmentById,
    traitRules: ctx.traitRules,
    evidenceClient: frozenEvidence(ctx),
    // Evidência congelada responde na hora; o teto de espera nunca pode cortar a busca (máquina carregada = análise lenta).
    budgetMs: 600_000,
    ...(yieldBetween ? { yieldBetween } : {}),
  });
}

export async function init({ root }) {
  const harness = await import(
    pathToFileURL(path.join(root, "tests/golden/harness.mjs")).href
  );
  const ctx = await harness.loadContext();
  const { traitBook } = await import(
    pathToFileURL(path.join(root, "core/catalog/traits.mjs")).href
  );
  ctx.traitRules = traitBook(ctx.catalog);
  return { pipeline: goldenPipeline(ctx, { yieldBetween: async () => {} }) };
}

export async function run({ payload, context, state, lap, sideband }) {
  const out = await state.pipeline.compute(payload, context, { lap });
  sideband({ track: out.track, notes: out.notes, evidence: out.evidence });
  return out.parts;
}
