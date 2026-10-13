// Rodar com: node --test tests/recommend-graph.test.mjs
// M8b: os fatos do pipeline da recomendação (app/recommend-facts.mjs) sobre dados reais do golden. Fixa (1) a estrutura do
// grafo e que a loja é entrada da base e não da tática (D1), (2) cada fato pequeno = a função do núcleo que ele embrulha,
// (3) o T6: para cada evento do jogo (XP, sequência, loja, rolagem, subida de nível, rodada, troca de plano...) EXATAMENTE
// quais fatos recalculam, e (4) as bordas (a cópia da tática não suja o fato, o erro do motor chega com a mensagem de
// antes, a simulação de rolagem como fato).
//
// ESCRITO SEM EXECUTAR (ordem do usuário: testes só no fim, pelo orquestrador). As listas de "recalcula"/"não recalcula"
// vêm do grafo de dependências de `describe()`, não de medição: se uma falhar, confira primeiro a dependência.
import test from "node:test";
import assert from "node:assert/strict";
import { GraphError, createGraph, defineFact } from "../core/graph/index.mjs";
import { shopsAhead } from "../core/economy/gold.mjs";
import { traitBook } from "../core/catalog/traits.mjs";
import { isAvatar } from "../core/catalog/champions.mjs";
import { suggestTargetLevel } from "../target-level.mjs";
import { POLICY, rollSim } from "../economy.mjs";
import { simStats, simulate } from "../roll-sim.mjs";
import {
  MAX_PLANS,
  RECOMMEND_FACTS,
  bindRun,
  composeAnalysis,
  computeCounts,
  createRecommendGraph,
  plansOf,
  recomputedText,
} from "../app/recommend-facts.mjs";
import {
  HERO_ID,
  assembleStep,
  evidenceInputs,
  loadContext,
  loadSnapshots,
  newRun,
  resolveSteps,
} from "./golden/harness.mjs";
import { scenarios } from "./golden/scenarios.mjs";

const ctx = await loadContext();
const snapshots = loadSnapshots();
const scenario = scenarios.find((s) => s.id === "shop-cache-d1");

/** A 1ª leitura do cenário "shop-cache-d1" (nível 8, 54 g, 4-2, loja lida, 4 componentes no banco), pronta para o grafo. */
function start() {
  const run = newRun(ctx, 0),
    step = resolveSteps(ctx, scenario, snapshots)[0],
    assembled = assembleStep(ctx, run, step);
  return { run, ...assembled };
}

/** Lê tudo o que uma análise lê (nível-alvo, base, leitura, tática e os planos que existem) com estas entradas. */
function readAll(run, values) {
  const view = bindRun(run.graph, values, () => evidenceInputs(run));
  view.target();
  view.base();
  view.readingId();
  const count = plansOf(view.tactical()).length;
  for (let slot = 0; slot < count; slot++) {
    view.field(slot);
    view.strategy(slot);
  }
  return { view, count };
}

let shared = null;
/** Uma leitura já calculada que os eventos alteram uma entrada por vez (e restauram), para não pagar a base a frio sempre. */
function baseline() {
  if (!shared) {
    shared = start();
    shared.count = readAll(shared.run, shared.values).count;
  }
  return shared;
}

/** Ids dos fatos que recalcularam ao aplicar `change` às entradas de partida (depois volta ao estado de partida). */
function recomputedBy(change) {
  const b = baseline();
  b.run.graph.stats({ reset: true });
  const altered = readAll(b.run, { ...b.values, ...change(b.values, b) });
  const out = new Set(b.run.graph.stats().recomputed);
  out.count = altered.count; // quantos planos a análise alterada tem (os fatos por plano só existem para esses)
  readAll(b.run, b.values); // volta ao estado de partida (tudo no histórico: só acertos)
  return out;
}
const slots = (prefix, count) =>
  Array.from({ length: count }, (_, k) => `${prefix}.${k}`);
const stagePlans = (count) => slots("plan.stage", count);
const strategies = (count) => slots("plan.strategy", count);
const sorted = (set) => [...set].sort();
const hasAll = (set, ids, why) => {
  for (const id of ids)
    assert.ok(set.has(id), `${why}: ${id} deveria recalcular (${sorted(set)})`);
};
const hasNone = (set, ids, why) => {
  for (const id of ids)
    assert.ok(
      !set.has(id),
      `${why}: ${id} não deveria recalcular (${sorted(set)})`,
    );
};

/* ---------- estrutura ---------- */

test("o grafo do pipeline: 18 fatos, ids únicos, sem ciclo, e a loja é entrada da base (D1) e não da tática", () => {
  assert.equal(RECOMMEND_FACTS.length, 18);
  assert.equal(new Set(RECOMMEND_FACTS.map((f) => f.id)).size, 18);
  const { facts } = createRecommendGraph().describe();
  const reads = (id) => Object.values(facts[id].inputs);
  // D1: a base declara a loja (e as lojas ao alcance, não o ouro).
  assert.ok(reads("comps.base").includes("shop"));
  assert.ok(reads("comps.base").includes("economy.shopsAhead"));
  assert.ok(!reads("comps.base").includes("gold"));
  // A tática (tactics) não lê loja, ouro nem XP; o campo de agora lê a loja e o ouro; a estratégia lê ouro, XP e sequência.
  for (const banned of ["shop", "gold", "xp", "streak", "level"])
    assert.ok(!reads("tactics.analysis").includes(banned), banned);
  assert.ok(reads("plan.stage.0").includes("shop"));
  assert.ok(reads("plan.stage.0").includes("gold"));
  for (const wanted of ["gold", "xp", "streak", "trend", "levelEstimated"])
    assert.ok(reads("plan.strategy.0").includes(wanted), wanted);
  // O identificador da leitura não inclui a loja nem a evidência (a loja muda a nota das comps, não a leitura).
  assert.ok(!reads("comps.readingId").includes("shop"));
  assert.ok(!reads("comps.readingId").includes("evidence"));
  assert.ok(reads("comps.readingId").includes("gold"));
  assert.equal(MAX_PLANS, 4);
});

/* ---------- cada fato pequeno = a função do núcleo ---------- */

test("economy.shopsAhead = core/economy shopsAhead (inclusive ouro não lido); clock.stage = só o número do estágio", () => {
  const { run, values } = start();
  const view = bindRun(run.graph, values, () => evidenceInputs(run));
  assert.equal(view.read("economy.shopsAhead"), shopsAhead(values.gold));
  const unread = bindRun(run.graph, { ...values, gold: null }, () =>
    evidenceInputs(run),
  );
  assert.equal(unread.read("economy.shopsAhead"), shopsAhead(null));
  assert.deepEqual(view.read("clock.stage"), { stage: values.stage.stage });
  const noStage = bindRun(run.graph, { ...values, stage: null }, () =>
    evidenceInputs(run),
  );
  assert.deepEqual(noStage.read("clock.stage"), { stage: null });
});

test("level.target = suggestTargetLevel quando 'auto' e o próprio nível quando o usuário escolheu", () => {
  const { run, values, snapshot } = start();
  assert.equal(values.targetLevel, "auto");
  const auto = bindRun(run.graph, values, () => evidenceInputs(run)).target(),
    direct = suggestTargetLevel(snapshot, HERO_ID, values.level, values.gold);
  assert.deepEqual(auto, {
    level: direct.level,
    reasons: direct.reasons,
    auto: true,
  });
  const chosen = bindRun(run.graph, { ...values, targetLevel: 10 }, () =>
    evidenceInputs(run),
  ).target();
  assert.deepEqual(chosen, { level: 10, reasons: [], auto: false });
  assert.equal(
    bindRun(run.graph, values, () => evidenceInputs(run)).read(
      "level.targetLevel",
    ),
    direct.level,
  );
});

test("traits.grants = o que o livro de sinergias diz dos aprimoramentos escolhidos (nomes, ids e itens de emblema)", () => {
  const { run, values } = start(),
    book = traitBook(ctx.catalog),
    picks = ctx.augmentList
      .filter((a) => a.id.startsWith("DA_") && book.augmentEmblem(a)?.item)
      .slice(0, 2);
  assert.ok(
    picks.length === 2,
    "o catálogo congelado deveria ter aprimoramentos com emblema",
  );
  const view = bindRun(
    run.graph,
    { ...values, chosen: picks, augments: picks.map((a) => a.id) },
    () => evidenceInputs(run),
  );
  const expected = book.grants(picks);
  assert.deepEqual(view.read("traits.grants"), {
    traits: expected.traits,
    traitsById: expected.traitsById,
    emblems: expected.emblems,
  });
  assert.deepEqual(
    bindRun(run.graph, values, () => evidenceInputs(run)).read("traits.grants"),
    { traits: [], traitsById: {}, emblems: [] },
  );
});

test("comps.swapped: aplica só a troca que vale (sai uma peça da comp, entra uma que não está) e devolve as demais comps como estão", () => {
  const { run, values } = start(),
    comps = ctx.metaComps.comps,
    first = comps[0],
    out = first.units.find((u) => u !== first.carry),
    inn = comps[1].units.find((u) => !first.units.includes(u));
  const view = bindRun(
    run.graph,
    {
      ...values,
      compSwaps: {
        [first.id]: [
          { out, in: inn },
          { out: first.carry, in: inn },
        ],
      },
    },
    () => evidenceInputs(run),
  );
  const swapped = view.read("comps.swapped");
  assert.equal(swapped.length, comps.length);
  assert.deepEqual(swapped[0].appliedSwaps, [{ out, in: inn }]);
  assert.ok(swapped[0].units.includes(inn) && !swapped[0].units.includes(out));
  assert.ok(swapped[0].units.includes(first.carry), "o carry não sai");
  assert.equal(swapped[1], comps[1]);
  const none = bindRun(run.graph, values, () => evidenceInputs(run)).read(
    "comps.swapped",
  );
  assert.equal(none[0], comps[0]);
});

/* ---------- T6: o que recalcula por evento ---------- */

test("T6 XP: só a estratégia dos planos recalcula (a base, a tática e o campo de agora não leem XP)", () => {
  const { count } = baseline();
  assert.ok(count >= 1);
  const set = recomputedBy(() => ({ xp: "40/68" }));
  assert.deepEqual(sorted(set), sorted(strategies(count)));
});

// A sequência entra na loja dos planos também (tft-pressao-vida): vitória na última luta estabiliza o perigo, e a loja usa
// a mesma faixa da estratégia (cartas secundárias abaixo dos juros só rolando para estabilizar).
test("T6 sequência de derrotas: só a loja e a estratégia dos planos recalculam", () => {
  const { count } = baseline();
  const set = recomputedBy(() => ({
    streak: { kind: "loss", length: 3, inferred: true },
  }));
  assert.deepEqual(
    sorted(set),
    sorted([...stagePlans(count), ...strategies(count)]),
  );
});

test("T6 removedores e jogador consultado: a tática e o que depende dela recalculam, a base não", () => {
  const { count, values } = baseline();
  const down = ["tactics.analysis", ...stagePlans(count), ...strategies(count)];
  const removers = recomputedBy(() => ({ hasRemover: !values.hasRemover }));
  assert.deepEqual(sorted(removers), sorted(down));
  const rival = baseline().snapshot.statsBlock.players.find(
    (p) => String(p.playerId) !== HERO_ID,
  );
  const viewed = recomputedBy(() => ({
    viewedPlayerId: String(rival.playerId),
  }));
  assert.deepEqual(sorted(viewed), sorted(down));
});

test("T6 só a loja muda (D1): a base recalcula, e com ela a tática e os planos; nenhuma regra de ouro, nível ou leitura", () => {
  const set = recomputedBy((values) => ({ shop: [...values.shop].reverse() }));
  hasAll(
    set,
    [
      "comps.base",
      "tactics.analysis",
      ...stagePlans(set.count),
      ...strategies(set.count),
    ],
    "loja",
  );
  hasNone(
    set,
    [
      "economy.shopsAhead",
      "level.target",
      "level.targetLevel",
      "clock.stage",
      "traits.grants",
      "catalog.traits",
      "comps.swapped",
      "comps.readingId",
    ],
    "loja",
  );
});

test("T6 rolagem (-2 g): lojas ao alcance, base, leitura, tática e planos recalculam; o resto do mundo não", () => {
  // Na mesma rodada o ouro da rodada (targetGold, o maior lido nela) não cai com a rolagem: o nível-alvo não recalcula
  // (target-level.mjs, steadyTargetInputs). Antes ele lia o ouro de agora e alternava em 49/50 g.
  const set = recomputedBy((values) => ({ gold: values.gold - 2 }));
  hasAll(
    set,
    [
      "economy.shopsAhead",
      "comps.base",
      "comps.readingId",
      "tactics.analysis",
      ...stagePlans(set.count),
      ...strategies(set.count),
    ],
    "rolagem",
  );
  hasNone(
    set,
    [
      "level.target",
      "clock.stage",
      "catalog.traits",
      "traits.grants",
      "comps.swapped",
    ],
    "rolagem",
  );
});

test("T6 ouro da rodada novo (rodada seguinte com outro ouro): o nível-alvo recalcula", () => {
  const set = recomputedBy((values) => ({ targetGold: values.gold - 30 }));
  hasAll(set, ["level.target"], "ouro da rodada");
  hasNone(set, ["economy.shopsAhead", "clock.stage"], "ouro da rodada");
});

test("T6 ouro +1 sem mudar as lojas ao alcance nem o nível-alvo: a base e a tática NÃO recalculam (corte antecipado)", () => {
  const { values } = baseline();
  assert.equal(shopsAhead(values.gold), shopsAhead(values.gold + 1));
  const set = recomputedBy(() => ({ gold: values.gold + 1 }));
  hasAll(
    set,
    [
      "economy.shopsAhead",
      "comps.readingId",
      ...stagePlans(set.count),
      ...strategies(set.count),
    ],
    "ouro +1",
  );
  hasNone(set, ["comps.base", "tactics.analysis"], "ouro +1");
});

test("T6 subir de nível: nível-alvo, trocas pelo nível, base, leitura e tática recalculam; lojas ao alcance e sinergias não", () => {
  const set = recomputedBy((values) => ({ level: values.level + 1 }));
  hasAll(
    set,
    [
      "level.target",
      // A comp ajustada ao nível (core/comps/level-fit.mjs) troca a vaga de apoio pelo nível.
      "comps.swapped",
      "comps.base",
      "comps.readingId",
      "tactics.analysis",
      ...stagePlans(set.count),
      ...strategies(set.count),
    ],
    "nível",
  );
  hasNone(
    set,
    ["economy.shopsAhead", "clock.stage", "catalog.traits", "traits.grants"],
    "nível",
  );
});

test("T6 rodada dentro do mesmo estágio: só o campo de agora e a estratégia leem a rodada; a base e a leitura ficam", () => {
  const { count, values } = baseline();
  const set = recomputedBy(() => ({
    stage: { stage: values.stage.stage, round: values.stage.round + 1 },
  }));
  assert.deepEqual(
    sorted(set),
    sorted(["clock.stage", ...stagePlans(count), ...strategies(count)]),
  );
});

test("T6 estágio novo: o número do estágio refaz a base, a leitura e a tática", () => {
  const { values } = baseline();
  const set = recomputedBy(() => ({
    stage: { stage: values.stage.stage + 1, round: 1 },
  }));
  hasAll(
    set,
    [
      "clock.stage",
      "comps.base",
      "comps.readingId",
      "tactics.analysis",
      ...stagePlans(set.count),
      ...strategies(set.count),
    ],
    "estágio",
  );
  hasNone(
    set,
    ["economy.shopsAhead", "level.target", "traits.grants", "comps.swapped"],
    "estágio",
  );
});

test("T6 troca de plano (o usuário fixa uma comp): a base e a tática recalculam; ouro, nível-alvo e sinergias não", () => {
  const { count } = baseline();
  const comp = ctx.metaComps.comps[1],
    units = comp.units.filter(
      (id) => !isAvatar(ctx.catalog.champions.find((c) => c.apiName === id)),
    );
  const set = recomputedBy(() => ({
    goal: comp,
    goalCompId: comp.id,
    goalSwaps: [],
    previewIds: units,
    goalCarryId: units.includes(comp.carry) ? comp.carry : "",
  }));
  hasAll(
    set,
    ["comps.base", "comps.readingId", "tactics.analysis"],
    "plano fixado",
  );
  hasNone(
    set,
    [
      "economy.shopsAhead",
      "level.target",
      "clock.stage",
      "traits.grants",
      "comps.swapped",
    ],
    "plano fixado",
  );
  assert.ok(count >= 1);
});

test("T6 aprimoramento escolhido: as sinergias concedidas, a base e a tática recalculam; lojas ao alcance e nível-alvo não", () => {
  const book = traitBook(ctx.catalog),
    picks = ctx.augmentList
      .filter((a) => a.id.startsWith("DA_") && book.augmentEmblem(a)?.item)
      .slice(0, 1);
  const set = recomputedBy(() => ({
    chosen: picks,
    augments: picks.map((a) => a.id),
  }));
  hasAll(
    set,
    ["traits.grants", "comps.base", "comps.readingId", "tactics.analysis"],
    "aprimoramento",
  );
  hasNone(
    set,
    [
      "economy.shopsAhead",
      "level.target",
      "catalog.traits",
      "comps.swapped",
      "clock.stage",
    ],
    "aprimoramento",
  );
});

test("T6 trocas do usuário no automático: as comps trocadas, a base e a tática recalculam; nada de ouro ou nível", () => {
  const first = ctx.metaComps.comps[0],
    out = first.units.find((u) => u !== first.carry),
    inn = ctx.metaComps.comps[1].units.find((u) => !first.units.includes(u));
  const set = recomputedBy(() => ({
    compSwaps: { [first.id]: [{ out, in: inn }] },
  }));
  hasAll(
    set,
    ["comps.swapped", "comps.base", "comps.readingId", "tactics.analysis"],
    "trocas",
  );
  hasNone(
    set,
    ["economy.shopsAhead", "level.target", "traits.grants", "clock.stage"],
    "trocas",
  );
});

test("T6 cópia de meta com o MESMO conteúdo (referência nova): nada recalcula", () => {
  const set = recomputedBy((values) => ({
    boardStats: structuredClone(values.boardStats),
    itemStats: structuredClone(values.itemStats),
    snapshot: structuredClone(values.snapshot),
    shop: [...values.shop],
    inventory: [...values.inventory],
    hidden: { ...values.hidden },
  }));
  assert.deepEqual(sorted(set), []);
});

test("T6 evidência nova do explorer: a base e a tática recalculam; a leitura do jogo (baseId) e o nível-alvo não", () => {
  const b = baseline(),
    key = "teste:evidencia-nova";
  b.run.graph.stats({ reset: true });
  b.run.evidence.set(key, null);
  b.run.evidenceVersion++;
  readAll(b.run, b.values);
  const set = new Set(b.run.graph.stats().recomputed);
  b.run.evidence.delete(key);
  b.run.evidenceVersion++;
  readAll(b.run, b.values);
  hasAll(set, ["comps.base", "tactics.analysis"], "evidência");
  hasNone(
    set,
    ["comps.readingId", "economy.shopsAhead", "level.target", "traits.grants"],
    "evidência",
  );
});

test("T6 voltar a um estado já visto (ouro 54 -> 48 -> 54 -> 48): o histórico responde, nada recalcula", () => {
  // 48 g ainda não apareceu nos testes acima (cada ouro novo é um estado novo), e as lojas ao alcance mudam (45 -> 40).
  const lower = (values) => ({ gold: values.gold - 6 });
  const first = recomputedBy(lower);
  assert.ok(first.has("comps.base") && first.has("economy.shopsAhead"));
  const again = recomputedBy(lower);
  assert.deepEqual(sorted(again), []);
});

/* ---------- bordas ---------- */

test("composeAnalysis devolve uma cópia: alterar a análise não suja o fato memoizado, e o ranking de comps segue por referência", () => {
  const { run, values } = baseline(),
    { view, count } = readAll(run, values),
    tactical = view.tactical(),
    perPlan = Array.from({ length: count }, (_, k) => ({
      stage: view.field(k),
      strategy: view.strategy(k),
    }));
  const before = structuredClone({ ...tactical, compRanking: undefined });
  const analysis = composeAnalysis(tactical, perPlan, () => "CODE");
  assert.equal(analysis.compRanking, tactical.compRanking);
  assert.notEqual(analysis.self, tactical.self);
  assert.equal(plansOf(analysis).length, count);
  assert.equal(plansOf(analysis)[0].teamCode, "CODE");
  assert.ok(plansOf(analysis)[0].stage && plansOf(analysis)[0].strategy);
  analysis.self.health = -99;
  analysis.recommendations[0].title = "alterado";
  plansOf(analysis)[0].stage.note = "alterado";
  assert.deepEqual({ ...tactical, compRanking: undefined }, before);
  assert.equal(view.field(0).note === "alterado", false);
});

test("erro do motor chega ao chamador com a mensagem original (não embrulhado em COMPUTE_FAILED)", () => {
  const { run, values } = start();
  const boom = defineFact({
    id: "comps.base",
    inputs: ["level"],
    compute: () => {
      throw Error("Selecione o seu jogador.");
    },
    cutoff: "key",
  });
  const graph = createRecommendGraph({ overrides: [boom] });
  const view = bindRun(graph, values, () => evidenceInputs(run));
  assert.throws(
    () => view.base(),
    (error) =>
      !(error instanceof GraphError) &&
      error.message === "Selecione o seu jogador.",
  );
});

test("recomputedText: ids repetidos viram contagem, e só conta o que executou desde a marca", () => {
  const a = defineFact({ id: "a", inputs: ["x"], compute: ({ x }) => x });
  const b = defineFact({
    id: "b",
    inputs: { a: "a" },
    compute: ({ a }) => a + 1,
  });
  const graph = createGraph({ facts: [a, b], inputs: ["x"] });
  const before = computeCounts(graph);
  graph.set({ x: 1 });
  graph.get("b");
  graph.set({ x: 2 });
  graph.get("b");
  assert.equal(recomputedText(graph, before), "ax2,bx2");
  assert.equal(recomputedText(graph, computeCounts(graph)), "");
});

test("roll.sim: a simulação de rolagem é um fato memoizado por (nível, pool livre por custo, alvos) e dá o mesmo que economy.rollSim", () => {
  const targets = [
      { cost: 2, free: 10, evolve: true, steps: [{ copies: 2, value: 3 }] },
    ],
    denom = { 1: 20, 2: 18, 3: 15, 4: 10, 5: 9 };
  const before = simStats().computes;
  const a = simulate(5, denom, targets),
    b = simulate(5, { 5: 9, 4: 10, 3: 15, 2: 18, 1: 20 }, [...targets]);
  assert.equal(a, b, "mesma entrada (em outra ordem de chaves) reaproveita");
  assert.equal(simStats().computes, before + 1);
  const direct = rollSim({
    level: 5,
    targets,
    denom,
    maxGold: POLICY.simulation.maxGold,
  });
  assert.deepEqual([...a.gain], [...direct.gain]);
  assert.deepEqual([...a.any], [...direct.any]);
  const other = simulate(6, denom, targets);
  assert.notEqual(other, a);
  assert.equal(simStats().computes, before + 2);
});
