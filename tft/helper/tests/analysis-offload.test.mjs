// Rodar com: node --test tft/helper/tests/analysis-offload.test.mjs
// M10b: a análise pesada fora do event loop. Caracterização (a thread devolve a MESMA análise do pipeline no processo
// principal e a do golden), fallback seguro, fila sem descarte, resultado compartilhado entre POST e laço, base incremental
// e o laço de acompanhamento que não para. Nenhum teste abre porta: as "threads" são `worker_threads`, sem servidor.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAnalysisWorker, workerSpawner } from "../analysis-worker.mjs";
import { prependField } from "../analysis-protocol.mjs";
import { createAnalysisRunner } from "../app/analysis-runner.mjs";
import {
  createRecentResults,
  createAutoRefresh,
} from "../app/auto-refresh.mjs";
import { createOverlayFeed } from "../app/overlay-feed.mjs";
import { stageTimer } from "../app/recommend.mjs";
import { createSupervision, failRequest } from "../app/supervision.mjs";
import { traitBook } from "../core/catalog/traits.mjs";
import {
  assembleStep,
  canonical,
  loadContext,
  loadSnapshots,
  newRun,
  resolveSteps,
  runScenario,
} from "./golden/harness.mjs";
import { scenarios } from "./golden/scenarios.mjs";
import { goldenPipeline } from "./fixtures/analysis-golden-thread.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = await loadContext();
ctx.traitRules = traitBook(ctx.catalog);
const snapshots = loadSnapshots();
const context = {
  meta: ctx.meta,
  metaComps: ctx.metaComps,
  boardStats: ctx.boardStats,
  augmentStats: ctx.augmentStats,
};

/** A entrada da análise pesada de um passo do cenário (o que `run` de app/recommend.mjs monta). */
function payloadOf(id, stepIndex = 0) {
  const scenario = scenarios.find((s) => s.id === id),
    step = resolveSteps(ctx, scenario, snapshots)[stepIndex],
    a = assembleStep(
      ctx,
      newRun(ctx, Date.parse("2026-10-10T20:00:00Z")),
      step,
    );
  return {
    snapshot: a.snapshot,
    options: a.options,
    chosen: a.chosen,
    goal: a.goal,
    augmentsFrom: null,
    gepPicked: {},
  };
}
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
const plain = (x) => JSON.parse(JSON.stringify(x));
const realThread = () =>
  createAnalysisWorker({
    spawn: workerSpawner({
      pipeline: new URL(
        "./fixtures/analysis-golden-thread.mjs",
        import.meta.url,
      ),
      init: { root },
    }),
    supersede: false,
    timeoutMs: 120_000,
    startTimeoutMs: 60_000,
  });

test("a thread devolve a MESMA análise do pipeline no processo principal e a do golden (caracterização)", async () => {
  const worker = realThread();
  worker.setContext(context);
  const runner = createAnalysisRunner({
    worker,
    context: () => context,
    makePipeline: () => goldenPipeline(ctx),
  });
  try {
    for (const id of [
      "items-bank-lvl8",
      "pinned-comp-swap",
      "augments-chosen-offer",
    ]) {
      const viaThread = await runner.run(payloadOf(id), stageTimer());
      assert.equal(viaThread.via, "thread", id);
      const inline = goldenPipeline(ctx);
      const direct = await inline.compute(payloadOf(id), context);
      inline.close();
      assert.deepEqual(
        canonical(decode(viaThread.bytes)),
        canonical(plain(direct.parts)),
        id,
      );
      assert.equal(viaThread.track.top.title, direct.track.top.title);
      // E a do golden: as partes que o harness também grava.
      const scenario = scenarios.find((s) => s.id === id),
        golden = runScenario(ctx, scenario, snapshots).at(0).response,
        got = decode(viaThread.bytes);
      for (const field of [
        "recommendations",
        "compRanking",
        "preview",
        "self",
        "augmentAdvice",
        "contest",
      ])
        assert.deepEqual(
          canonical(got[field]),
          canonical(golden[field]),
          `${id}.${field}`,
        );
    }
  } finally {
    await runner.close();
  }
});

test("fallback: sem thread, ou com a thread que não sobe, a análise roda no processo principal", async () => {
  const log = [];
  const noThread = createAnalysisRunner({
    context: () => context,
    makePipeline: () => goldenPipeline(ctx),
    log: (l, t) => log.push([l, t]),
  });
  const a = await noThread.run(payloadOf("opening-lvl3"), stageTimer());
  assert.equal(a.via, "inline");
  assert.ok(a.parts.recommendations.length);
  assert.equal(noThread.status().mode, "inline");

  // Uma thread que nunca sobe (spawn lança): vira `failed` e a análise segue inline, com aviso no log.
  const broken = createAnalysisWorker({
    spawn: () => {
      throw new Error("sem thread");
    },
    supersede: false,
    maxRestarts: 1,
    restartDelayMs: 1,
  });
  const runner = createAnalysisRunner({
    worker: broken,
    context: () => context,
    makePipeline: () => goldenPipeline(ctx),
    log: (l, t) => log.push([l, t]),
  });
  const b = await runner.run(payloadOf("opening-lvl3"), stageTimer());
  assert.equal(b.via, "inline");
  assert.deepEqual(
    canonical(plain(b.parts)),
    canonical(plain(a.parts)),
    "inline e fallback dão a mesma análise",
  );
  assert.ok(log.some(([, t]) => /roda no processo principal/.test(t)));
  await runner.close();
});

test("erro DO PIPELINE na thread sobe com a mesma mensagem e não é repetido no processo principal", async () => {
  const worker = realThread();
  worker.setContext(context);
  let inlineCalls = 0;
  const runner = createAnalysisRunner({
    worker,
    context: () => context,
    makePipeline: () => {
      inlineCalls++;
      return goldenPipeline(ctx);
    },
  });
  try {
    const bad = payloadOf("viewed-rival");
    bad.options.viewedPlayerId = "nao-existe";
    await assert.rejects(
      () => runner.run(bad, stageTimer()),
      /Adversário não encontrado nesta partida\./,
    );
    assert.equal(inlineCalls, 0);
    // A thread continua boa depois do erro.
    assert.equal(
      (await runner.run(payloadOf("opening-lvl3"), stageTimer())).via,
      "thread",
    );
  } finally {
    await runner.close();
  }
});

test("a thread não bloqueia o event loop enquanto analisa", async () => {
  const worker = realThread();
  worker.setContext(context);
  const runner = createAnalysisRunner({
    worker,
    context: () => context,
    makePipeline: () => goldenPipeline(ctx),
  });
  try {
    await runner.run(payloadOf("opening-lvl3"), stageTimer()); // aquece a thread
    const lags = [];
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      lags.push(now - last - 10);
      last = now;
    }, 10);
    await runner.run(payloadOf("items-bank-lvl8"), stageTimer());
    await runner.run(payloadOf("augments-chosen-offer"), stageTimer());
    clearInterval(timer);
    assert.ok(lags.length > 20, "o temporizador rodou durante as análises");
    assert.ok(
      Math.max(...lags) < 250,
      `atraso máximo do loop ${Math.max(...lags).toFixed(0)} ms`,
    );
  } finally {
    await runner.close();
  }
});

test("fila sem descarte: pedidos de entradas diferentes esperam a vez e cada um recebe o resultado da PRÓPRIA entrada", async () => {
  const worker = realThread();
  worker.setContext(context);
  try {
    const inputs = [
      payloadOf("opening-lvl3"),
      payloadOf("early-lvl5-shop"),
      payloadOf("mid-lvl7-streak"),
    ];
    const tickets = inputs.map((p) => worker.submit(p));
    const outs = await Promise.all(
      tickets.map((t) => worker.resolve(t, { allowStale: false })),
    );
    assert.deepEqual(
      outs.map((o) => o.status),
      ["ok", "ok", "ok"],
    );
    assert.deepEqual(
      outs.map((o) => decode(o.result.bytes).currentLevel),
      inputs.map((p) => p.options.level),
    );
    assert.equal(worker.stats().counters.superseded, 0);
  } finally {
    await worker.close();
  }
});

test("resultado compartilhado: POST e laço com a mesma entrada dividem o cálculo (por qualquer uma das chaves)", async () => {
  const results = createRecentResults();
  let computes = 0;
  const compute = () =>
    new Promise((resolve) =>
      setTimeout(() => {
        computes++;
        resolve({ bytes: new Uint8Array([123, 125]) });
      }, 20),
    );
  // Chave da tela diferente (relógio, fase) mas o MESMO conteúdo de entrada: o segundo espera o primeiro.
  const [a, b] = await Promise.all([
    results.run(["ui:1", "c:x"], compute),
    results.run(["ui:2", "c:x"], compute),
  ]);
  assert.equal(computes, 1);
  assert.deepEqual([a.via, b.via].sort(), ["junto", "novo"]);
  // Depois de pronto, qualquer das três chaves acerta.
  for (const key of ["ui:1", "ui:2", "c:x"])
    assert.equal((await results.run([key], compute)).via, "cache");
  assert.equal(computes, 1);
  // Entrada diferente calcula; `clear` (estado mudou) esquece tudo; resultado velho (> prazo) não vale.
  assert.equal((await results.run(["c:y"], compute)).via, "novo");
  results.clear();
  assert.equal(results.has("c:x"), false);
  let t = 0;
  const aging = createRecentResults({ ttlMs: 1000, now: () => t });
  await aging.run(["k"], compute);
  t = 999;
  assert.equal(aging.has("k"), true);
  t = 1001;
  assert.equal(aging.has("k"), false);
});

test("base incremental: só XP não refaz a base; aprimoramento novo refaz", async () => {
  const pipeline = goldenPipeline(ctx, { yieldBetween: async () => {} });
  const base = () => pipeline.graph.stats().facts["comps.base"].computes;
  const p0 = payloadOf("items-bank-lvl8");
  await pipeline.compute(structuredClone(p0), context);
  const afterFirst = base();
  assert.ok(afterFirst >= 1);
  // Mesma entrada: nada recalcula.
  await pipeline.compute(structuredClone(p0), context);
  assert.equal(base(), afterFirst, "entrada igual");
  // Só o XP: não entra na base.
  const xp = structuredClone(p0);
  xp.options.xp = { cur: 3, need: 56 };
  await pipeline.compute(xp, context);
  assert.equal(base(), afterFirst, "só XP");
  // Aprimoramento escolhido: a base é refeita.
  const augmented = structuredClone(p0);
  augmented.chosen = ctx.augmentList
    .filter((a) => a.id.startsWith("DA_"))
    .slice(5, 6);
  augmented.options.augments = augmented.chosen.map((a) => a.id);
  await pipeline.compute(augmented, context);
  assert.ok(base() > afterFirst, "aprimoramento novo");
  pipeline.close();
});

test("a análise não altera a `options` do chamador (a chave de conteúdo continua válida)", async () => {
  const pipeline = goldenPipeline(ctx, { yieldBetween: async () => {} }),
    p = payloadOf("augments-chosen-offer"),
    before = JSON.stringify(p);
  await pipeline.compute(p, context);
  assert.equal(JSON.stringify(p), before);
  pipeline.close();
});

test("prependField e o feed do overlay: JSON pronto entra sem reparsear e dá o mesmo corpo que o objeto", () => {
  const enc = new TextEncoder(),
    dec = new TextDecoder();
  assert.deepEqual(
    JSON.parse(
      dec.decode(prependField(enc.encode('{"a":[1,2]}'), "metadata", { x: 1 })),
    ),
    {
      metadata: { x: 1 },
      a: [1, 2],
    },
  );
  assert.deepEqual(
    JSON.parse(dec.decode(prependField(enc.encode("{}"), "m", 2))),
    { m: 2 },
  );
  assert.throws(() => prependField(enc.encode("[1]"), "m", 2), TypeError);

  let t = 1000;
  const body = { metadata: { gameId: "g" }, recommendations: [{ title: "ç" }] },
    objectFeed = createOverlayFeed({ now: () => t }),
    jsonFeed = createOverlayFeed({ now: () => t });
  for (const feed of [objectFeed, jsonFeed]) feed.recordState({ gold: 3 });
  objectFeed.recordRecommendation(body);
  jsonFeed.recordRecommendationJson(enc.encode(JSON.stringify(body)));
  t = 1500;
  assert.deepEqual(
    JSON.parse(jsonFeed.snapshotJson().toString("utf8")),
    objectFeed.snapshot(),
  );
  assert.deepEqual(jsonFeed.snapshot(), objectFeed.snapshot());
  assert.deepEqual(jsonFeed.recommendationBody(), body);
  const unchanged = JSON.parse(
    jsonFeed.snapshotJson({ since: jsonFeed.snapshot().rev }).toString("utf8"),
  );
  assert.equal(unchanged.unchanged, true);
});

test("o laço automático não para: um tick preso é abandonado", async () => {
  let t = 0,
    stuck = true,
    calls = 0;
  const logs = [];
  const auto = createAutoRefresh({
    probe: () => {
      calls++;
      return stuck ? new Promise(() => {}) : { inMatch: false };
    },
    readState: async () => null,
    refresh: async () => ({ status: 200 }),
    results: createRecentResults(),
    now: () => t,
    maxTickMs: 1000,
    timers: { setTimeout: () => 0, clearTimeout() {} },
    log: (l, x) => logs.push(x),
  });
  void auto.tick(); // preso
  assert.deepEqual(await auto.tick(), { action: "busy" });
  t = 2000;
  stuck = false;
  assert.equal((await auto.tick()).action, "idle");
  assert.equal(calls, 2);
  assert.ok(logs.some((x) => /abandonado/.test(x)));
  assert.ok(auto.status().lastTickAt >= 2000);
});

test("supervisão: laço protegido sobrevive ao erro e à rodada que não termina; a saúde mostra a idade de cada fonte", async () => {
  let t = 0;
  const logs = [];
  const sup = createSupervision({
    log: (l, x) => logs.push([l, x]),
    now: () => t,
  });
  let n = 0;
  const timer = sup.every(
    "fonte",
    5,
    async () => {
      n++;
      if (n === 1) throw new Error("falhou");
      if (n === 3) await new Promise(() => {}); // nunca termina
    },
    { stuckMs: 20 },
  );
  // O relógio do supervisor anda junto com o real para a rodada presa ser abandonada.
  const clock = setInterval(() => (t += 5), 5);
  await new Promise((r) => setTimeout(r, 200));
  clearInterval(timer);
  clearInterval(clock);
  assert.ok(
    n >= 4,
    `continuou rodando depois do erro e da rodada presa (${n})`,
  );
  assert.ok(logs.some(([, x]) => /falhou/.test(x)));
  assert.ok(logs.some(([, x]) => /abandonada/.test(x)));
  const h = sup.health().fonte;
  assert.ok(h.ageMs >= 0);
  assert.match(h.error, /falhou/);

  // Resposta de erro nunca lança, nem com a conexão já fechada.
  const res = {
    headersSent: true,
    destroy() {
      this.destroyed = true;
    },
  };
  failRequest({ method: "GET", url: "/x" }, res, new Error("x"));
  assert.equal(res.destroyed, true);
  const res2 = {
    headersSent: false,
    writeHead() {
      throw new Error("socket fechado");
    },
    end() {},
  };
  assert.doesNotThrow(() =>
    failRequest({ method: "GET", url: "/y" }, res2, new Error("y")),
  );
});

test("composição de app/recommend.mjs: thread, plano em andamento, metadata, feed do overlay e resultado compartilhado", async () => {
  const { createRecommender } = await import("../app/recommend.mjs");
  const { planTracker } = await import("../plan-state.mjs");
  const { frozenEvidence } =
    await import("./fixtures/analysis-golden-thread.mjs");
  const scenario = scenarios.find((s) => s.id === "items-bank-lvl8"),
    step = resolveSteps(ctx, scenario, snapshots)[0],
    assembled = () =>
      assembleStep(ctx, newRun(ctx, Date.parse("2026-10-10T20:00:00Z")), step);
  const tracker = planTracker({ file: null }),
    overlay = createOverlayFeed(),
    results = createRecentResults(),
    tmp = path.join(root, "..", "data", "does-not-exist");
  const worker = realThread();
  const recommender = createRecommender({
    analysisWorker: worker,
    heroId: "47445859",
    catalog: ctx.catalog,
    itemIds: new Set(ctx.catalog.items.map((i) => i.apiName)),
    plannerCatalog: ctx.plannerCatalog,
    localNames: ctx.localNames,
    augmentById: ctx.augmentById,
    traitRules: ctx.traitRules,
    capturesFile: path.join(tmp, "captures.jsonl"),
    planLog: path.join(tmp, "plan.jsonl"),
    budgetMs: 600_000,
    meta: ctx.meta,
    metaComps: ctx.metaComps,
    boardStats: ctx.boardStats,
    augmentStats: ctx.augmentStats,
    current: async () => {
      const a = assembled();
      return { snapshot: a.snapshot, metadata: a.metadata };
    },
    replayState: async () => {
      throw Error("sem replay");
    },
    seenState: () => assembled().seen,
    gepContext: () => null,
    matches: { augments() {} },
    planState: tracker,
    streaks: { observe() {}, current: () => null, trend: () => null },
    gameFiles: { ledger: () => null },
    evidenceClient: frozenEvidence(ctx),
    overlay,
    results,
  });
  try {
    const stages = stageTimer();
    const first = await recommender.run({}, { source: "auto", stages });
    assert.equal(first.status, 200);
    assert.ok(first.bytes, "a thread entrega o JSON pronto");
    const body = decode(first.bytes);
    assert.equal(body.metadata.gameId, assembled().metadata.gameId);
    assert.ok(body.recommendations.length);
    assert.ok(
      body.planProgress?.plan?.id,
      "plano em andamento adotado (planState.track com o que a thread capturou)",
    );
    assert.equal(tracker.snapshot().plan.id, body.planProgress.plan.id);
    assert.equal(recommender.analyzer.status().mode, "thread");
    // O feed do overlay recebeu o mesmo corpo (bytes), sem reparsear até alguém ler.
    assert.deepEqual(
      JSON.parse(overlay.snapshotJson().toString("utf8")).recommendation.body
        .planProgress,
      body.planProgress,
    );
    // A mesma entrada de novo (por exemplo o POST depois do laço): resposta do resultado compartilhado, sem recalcular.
    const again = stageTimer();
    const second = await recommender.run({}, { source: "ui", stages: again });
    assert.equal(again.cacheHit, true);
    assert.match(again.note, /chave=(cache|junto)/);
    assert.deepEqual(
      decode(second.bytes).recommendations,
      body.recommendations,
    );
    // Entrada inválida: a mensagem de sempre, sem passar pela thread.
    await assert.rejects(
      () => recommender.run({ gold: -5 }),
      /Ouro inválido\./,
    );
  } finally {
    await recommender.analyzer.close();
  }
});

test("a thread de produção (app/analysis-thread.mjs) inicia: catálogo, planejador e pipeline, sem rede", async () => {
  const thread = await import("../app/analysis-thread.mjs");
  const { pipeline } = await thread.init({
    root,
    evidenceFile: path.join(
      root,
      "..",
      "data",
      "does-not-exist",
      "evidence.json",
    ),
    budgetMs: 1000,
    heroId: "47445859",
  });
  assert.equal(typeof pipeline.compute, "function");
  pipeline.close();
});
