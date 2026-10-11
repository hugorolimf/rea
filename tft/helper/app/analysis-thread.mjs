// O módulo de pipeline da thread de análise (contrato em analysis-worker-entry.mjs): carrega do disco o que não muda
// (catálogo, planejador, nomes, aprimoramentos), cria o explorer da MetaTFT e o pipeline pesado
// (app/analysis-pipeline.mjs) e atende os pedidos do servidor. A thread é o ÚNICO escritor de data/evidence-cache.json
// enquanto estiver de pé; as cópias de meta (que o servidor renova) chegam por `setContext`.
//
// Importar este módulo fora de uma thread não faz nada além de definir as funções (testes o usam direto).
import fs from "node:fs/promises";
import path from "node:path";
import { traitBook } from "../core/catalog/traits.mjs";
import { explorer } from "../evidence.mjs";
import { setIdsOf } from "../meta-scope.mjs";
import { createAnalysisPipeline } from "./analysis-pipeline.mjs";

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

/**
 * Carrega o que o pipeline precisa e o cria. `data`: `{ root, evidenceFile, budgetMs, heroId }` (clonável e pequeno).
 * `root` é a pasta do helper; os arquivos opcionais ausentes viram vazios, como no servidor.
 */
export async function init(data) {
  const { root, evidenceFile, budgetMs, heroId } = data;
  const catalog = await readJson(path.join(root, "catalog.json"));
  const plannerCatalog = (
    await readJson(path.join(root, "teamplanner-catalog.json"))
  ).data.TFTSet18;
  const optional = async (file, pick, fallback) => {
    try {
      return pick(await readJson(path.join(root, file))) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const localNames = await optional("names-pt_br.json", (j) => j.names, {});
  const augmentList = await optional("augments.json", (j) => j.augments, []);
  const pipeline = createAnalysisPipeline({
    heroId,
    catalog,
    plannerCatalog,
    localNames,
    augmentById: new Map(augmentList.map((a) => [a.id, a])),
    traitRules: traitBook(catalog),
    // Com os ids do catálogo, o cache e as respostas de outro set são recusados ("fora do set").
    evidenceClient: explorer(evidenceFile, { ids: setIdsOf(catalog) }),
    budgetMs,
    // Na thread não há o que ceder: o loop dela só atende mensagens do servidor.
    yieldBetween: async () => {},
  });
  return { pipeline };
}

/**
 * Um pedido: roda a análise pesada e devolve a resposta (o contrato da thread a serializa e transfere os bytes). O que o
 * servidor lê sem reparsear (o que `planState.track` precisa e as notas do `TEMPO`) vai pelo canal lateral.
 */
export async function run({ payload, context, state, lap, sideband }) {
  const out = await state.pipeline.compute(payload, context, { lap });
  sideband({ track: out.track, notes: out.notes, evidence: out.evidence });
  return out.parts;
}
