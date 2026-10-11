// Golden do pipeline de recomendação (M0): fixa o comportamento ATUAL de `POST /api/recommend` para 16 cenários de
// partidas reais anonimizadas e estados sintéticos, sem rede, sem relógio e sem tocar no servidor.
//
//   node --test tests/golden.test.mjs                      confere contra tests/golden/expected/*.json
//   UPDATE_GOLDEN=1 node --test tests/golden.test.mjs      regrava os esperados (REVISE o diff antes de aceitar)
//
// Passo de migração que muda número: registre cada diferença em ARQUITETURA.md ("Progresso da migração") e só então
// atualize o esperado. Diferença silenciosa é defeito. Ver tests/golden/harness.mjs para o que é transcrição do servidor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { POLICY } from "../economy.mjs";
import { strategy } from "../strategy.mjs";
import { makeState } from "./fixtures.mjs";
import { GAME } from "../rules.mjs";
import {
  canonical,
  diffPaths,
  loadContext,
  loadSnapshots,
  readExpected,
  root,
  runScenario,
  writeExpected,
} from "./golden/harness.mjs";
import { scenarios } from "./golden/scenarios.mjs";

const UPDATE = process.env.UPDATE_GOLDEN === "1";
const ctx = await loadContext();
const snapshots = loadSnapshots();

/** Resposta canônica de cada passo do cenário, mais o cabeçalho que prende o esperado ao catálogo usado. */
const record = (scenario, outputs) => ({
  header: {
    id: scenario.id,
    desc: scenario.desc,
    steps: outputs.length,
    catalogSha256: ctx.digests.catalog,
    augmentsSha256: ctx.digests.augments,
  },
  ...Object.fromEntries(
    outputs.map((o, i) => [
      `step${i + 1}`,
      canonical({ ...o.response, switched: o.switched }),
    ]),
  ),
});

test("os cenários têm ids únicos e cada snapshot congelado existe", () => {
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  assert.ok(scenarios.length >= 12);
  for (const s of scenarios)
    for (const name of [s.snapshot, ...(s.steps ?? []).map((x) => x.snapshot)])
      if (name) assert.ok(snapshots.has(name), `${s.id}: ${name}`);
});

for (const scenario of scenarios)
  test(`golden: ${scenario.id}`, () => {
    const got = record(scenario, runScenario(ctx, scenario, snapshots));
    const want = readExpected(scenario.id);
    if (UPDATE) {
      const diffs = want ? diffPaths(want, got, 25) : ["(novo)"];
      if (writeExpected(scenario.id, got))
        console.log(
          `golden ${scenario.id} atualizado:\n  ${diffs.join("\n  ")}`,
        );
      return;
    }
    assert.ok(
      want,
      `Sem esperado para ${scenario.id}: rode com UPDATE_GOLDEN=1 e revise o arquivo.`,
    );
    assert.equal(
      got.header.catalogSha256,
      want.header.catalogSha256,
      "catalog.json mudou desde o golden: regrave com UPDATE_GOLDEN=1 e revise o diff (dados novos mudam números).",
    );
    assert.equal(
      got.header.augmentsSha256,
      want.header.augmentsSha256,
      "augments.json mudou desde o golden: regrave com UPDATE_GOLDEN=1 e revise o diff.",
    );
    const diffs = diffPaths(want, got);
    assert.deepEqual(
      diffs,
      [],
      `${scenario.id}: a resposta mudou (${diffs.length}+ diferenças; esperado -> obtido):\n${diffs.join("\n")}`,
    );
  });

test("o pipeline é determinístico: duas execuções do mesmo cenário dão a mesma resposta", () => {
  for (const id of [
    "plan-sequence",
    "pinned-comp-swap",
    "reroll-hidden-banks",
  ]) {
    const scenario = scenarios.find((s) => s.id === id),
      a = record(scenario, runScenario(ctx, scenario, snapshots)),
      b = record(scenario, runScenario(ctx, scenario, snapshots));
    assert.deepEqual(diffPaths(a, b), [], id);
  }
});

test("os cenários exercem os caminhos que o golden promete cobrir", () => {
  const out = Object.fromEntries(
    scenarios.map((s) => [s.id, runScenario(ctx, s, snapshots)]),
  );
  const last = (id) => out[id].at(-1).response;
  // Hero eliminado e partida revista: sem plano em andamento.
  assert.ok(last("eliminated-recorded").self.health <= 0);
  assert.equal(last("replay-final").planProgress, undefined);
  // Comp fixada vira `preview`; troca do usuário entra no plano.
  assert.ok(last("pinned-comp-swap").preview);
  assert.ok(last("pinned-comp-swap").goal.found);
  // Aprimoramento: escolhidos e oferta aconselhada.
  assert.equal(last("augments-chosen-offer").chosenAugments.length, 2);
  assert.ok(last("augments-chosen-offer").augmentAdvice);
  // Rival consultado.
  assert.ok(last("viewed-rival").viewedBoard?.units.length);
  // Plano em andamento nas três leituras e cache da base compartilhado entre elas.
  assert.equal(out["plan-sequence"].length, 3);
  assert.ok(out["plan-sequence"].every((o) => o.response.planProgress));
  // Estratégia, loja e rolagem existem no plano exibido nos cenários com loja lida.
  const shown = (r) => r.preview ?? r.recommendations[0];
  assert.ok(shown(last("early-lvl5-shop")).strategy);
  assert.ok(shown(last("mid-lvl7-streak")).stage);
  // Ouro desconhecido continua sem quebrar o pipeline (D14).
  assert.ok(last("gold-unknown").recommendations.length);
  // Todos os cenários devolvem recomendações ou, eliminado, ao menos o corpo da análise.
  for (const [id, steps] of Object.entries(out))
    for (const s of steps) assert.ok(s.bytes > 1000, id);
});

/** Respostas canônicas de todos os cenários sob uma alteração temporária de constante. */
const SENSITIVE = [
  "early-lvl5-shop",
  "mid-lvl7-streak",
  "late-lvl9-critical",
  "items-bank-lvl8",
];
function runAllWith(mutate) {
  const restore = mutate();
  try {
    return scenarios
      .filter((s) => SENSITIVE.includes(s.id))
      .map((s) => record(s, runScenario(ctx, s, snapshots)));
  } finally {
    restore();
  }
}

test("sensibilidade: perturbar uma constante de política ou de regra quebra pelo menos um dos cenários sensíveis", () => {
  const baseline = runAllWith(() => () => {});
  const changed = (other) =>
    baseline.filter((b, i) => diffPaths(b, other[i], 1).length).length;
  // Piso de ouro guardado quando saudável (usado por strategy/stage).
  const floor = runAllWith(() => {
    const was = POLICY.floor.healthy;
    POLICY.floor.healthy = 70;
    return () => (POLICY.floor.healthy = was);
  });
  // Teto de juros do jogo.
  const interest = runAllWith(() => {
    const was = GAME.interestMax;
    GAME.interestMax = 3;
    return () => (GAME.interestMax = was);
  });
  // Faixa de vida "ferido" (piso de ouro e urgência por faixa).
  const hurt = runAllWith(() => {
    const was = POLICY.hp.hurt;
    POLICY.hp.hurt = 90;
    return () => (POLICY.hp.hurt = was);
  });
  assert.ok(
    changed(floor) >= 1,
    "POLICY.floor.healthy não afeta nenhum cenário",
  );
  assert.ok(
    changed(interest) >= 1,
    "GAME.interestMax não afeta nenhum cenário",
  );
  assert.ok(changed(hurt) >= 1, "POLICY.hp.hurt não afeta nenhum cenário");
  assert.equal(POLICY.hp.hurt, 60);
  assert.equal(GAME.interestMax, 5);
});

test("o harness continua sendo uma transcrição fiel do POST /api/recommend de server.mjs", () => {
  const server = fs
      .readFileSync(path.join(root, "server.mjs"), "utf8")
      .replace(/\r\n/g, "\n"),
    post = server.slice(server.indexOf('url.pathname === "/api/recommend"'));
  // Ordem das etapas. Se falhar, o servidor mudou (ou o pipeline saiu dele, M9): religue o harness ao novo ponto de entrada.
  const steps = [
    "validate(JSON.parse(body))",
    "gepBenchUnits(",
    "recommendInventory(",
    "snapshotSignature(snapshot)",
    "analyze(snapshot, catalog, options)",
    "structuredClone(built)",
    "tactics(base, catalog, options)",
    "playbook(plan, analysis, options, metadata)",
    "stagePlan(plan, analysis, catalog, options)",
    "strategy(plan, analysis, options)",
    "planState.track(",
    "augmentAdvice(",
    "decide(analysis, options)",
    "contestAlert(",
  ];
  let at = -1;
  for (const step of steps) {
    const found = post.indexOf(step, at + 1);
    assert.ok(
      found > at,
      `server.mjs: etapa fora de ordem ou ausente: ${step}`,
    );
    at = found;
  }
  // augmentEmblem é regra de servidor copiada no harness: mesmo texto, ignorando aspas, espaços e comentários.
  const flat = (text) =>
    text
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\s+/g, "")
      .replace(/'/g, '"');
  const fromServer = /function augmentEmblem\(a\) \{[\s\S]*?\n\}\n/.exec(
    server,
  )?.[0];
  assert.ok(fromServer, "server.mjs: augmentEmblem não encontrado");
  const fromHarness =
    /export function makeAugmentEmblem[\s\S]*?return (function augmentEmblem\(a\) \{[\s\S]*?\n {2}\});/.exec(
      fs
        .readFileSync(path.join(root, "tests/golden/harness.mjs"), "utf8")
        .replace(/\r\n/g, "\n"),
    )?.[1];
  assert.ok(fromHarness, "harness: augmentEmblem não encontrado");
  assert.equal(flat(fromHarness.replace(/\n {2}\}$/, "\n}")), flat(fromServer));
});

test("D1 (caracterização): trocar só a loja devolve o compScore antigo do cache da base, embora o motor leia a loja", () => {
  const scenario = scenarios.find((s) => s.id === "shop-cache-d1"),
    cached = runScenario(ctx, scenario, snapshots).map((o) => o.response),
    fresh = runScenario(ctx, scenario, snapshots, { noBaseCache: true }).map(
      (o) => o.response,
    );
  // Com o cache (como o servidor hoje): a 3ª leitura, com outra loja, repete o ranking da 2ª.
  assert.deepEqual(cached[2].compRanking, cached[1].compRanking);
  // Sem o cache a loja entra no score (`scoreParts.shop`): é o valor que o cache esconde.
  assert.notDeepEqual(fresh[2].compRanking, fresh[1].compRanking);
  assert.ok(
    fresh[2].compRanking.some((r) => (r.scoreParts?.shop ?? 0) > 0),
    "a loja deveria somar ao score de alguma comp",
  );
  // Quando M8 corrigir D1 por construção, estas duas asserções passam a ser o contrário: registre o diff aceito.
});

/* ---------- Estratégia sobre estados sintéticos (tests/fixtures.mjs) ---------- */

/**
 * Entradas de `strategy()` das duas comps de tests/fixtures.mjs (fast8 e reroll) em situações de ouro, vida, nível,
 * loja, disputa e pool diferentes. Fixam a camada de rolagem/economia sem depender do motor de comps nem do catálogo:
 * é o que M4 (pool/loja) e M5 (economia/política) mais mexem.
 */
const SYNTHETIC = {
  "fast8-rico-saudavel": {
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    extra: { Aphelios: 1 },
  },
  "fast8-ferido-com-loja": {
    gold: 54,
    hp: 48,
    level: 8,
    stage: "4-5",
    shop: [
      {
        slot: 1,
        id: "TFT_Xayah",
        name: "Xayah",
        cost: 4,
        action: "comprar",
        reason: "peça da meta",
      },
    ],
  },
  "fast8-critico": { gold: 30, hp: 18, level: 8, stage: "5-1" },
  "fast8-nivel9-120g": { gold: 120, hp: 70, level: 9, stage: "5-1" },
  "fast8-pouco-ouro": { gold: 8, hp: 60, level: 4, stage: "2-3" },
  "fast8-lobby-forte": {
    gold: 60,
    hp: 55,
    level: 8,
    stage: "4-2",
    rivals: { count: 7, cost: 4, stars: 2, size: 8 },
  },
  "reroll-nivel6": { comp: "reroll", gold: 40, hp: 70, level: 6, stage: "3-5" },
  "reroll-copias-no-banco": {
    comp: "reroll",
    gold: 60,
    hp: 75,
    level: 6,
    stage: "3-5",
    extra: { Kayle: 4 },
  },
  "reroll-3star-disputado": {
    comp: "reroll",
    gold: 50,
    hp: 65,
    level: 6,
    stage: "4-1",
    enemy: { Kayle: 8 },
  },
  "reroll-vida-baixa": {
    comp: "reroll",
    gold: 35,
    hp: 28,
    level: 6,
    stage: "4-2",
  },
  "reroll-sem-ouro-lido": {
    comp: "reroll",
    gold: null,
    hp: 70,
    level: 6,
    stage: "3-5",
  },
};

test("golden: strategy() em estados sintéticos das duas comps de fixtures", () => {
  const got = Object.fromEntries(
    Object.entries(SYNTHETIC).map(([name, opts]) => {
      const s = makeState(opts);
      return [name, canonical(strategy(s.plan, s.analysis, s.options))];
    }),
  );
  const doc = {
    header: { id: "synthetic-strategy", cases: Object.keys(SYNTHETIC).length },
    ...got,
  };
  const want = readExpected("synthetic-strategy");
  if (UPDATE) {
    const diffs = want ? diffPaths(want, doc, 25) : ["(novo)"];
    if (writeExpected("synthetic-strategy", doc))
      console.log(
        `golden synthetic-strategy atualizado:\n  ${diffs.join("\n  ")}`,
      );
    return;
  }
  assert.ok(
    want,
    "Sem esperado para synthetic-strategy: rode com UPDATE_GOLDEN=1 e revise.",
  );
  const diffs = diffPaths(want, doc);
  assert.deepEqual(
    diffs,
    [],
    `strategy() mudou (esperado -> obtido):\n${diffs.join("\n")}`,
  );
});
