// Rodar com: node --test "tft/helper/tests/auto-refresh.test.mjs"
// O laço do servidor (app/auto-refresh.mjs, M10b): conduz a análise sozinho durante a partida. Relógio, estado, fontes e
// pipeline são falsos; o que se prova é a política: chave igual não reanalisa, chave nova analisa (com intervalo mínimo e
// a janela de 120 s), as decisões do usuário são lembradas, o laço volta a só sondar ao fim da partida, e o resultado fica
// no cache que o POST da interface consulta.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DECISIONS,
  createAutoRefresh,
  createRecentResults,
} from "../app/auto-refresh.mjs";
import {
  REFRESH_WINDOW_MS,
  analysisKey,
  decisionPayload,
} from "../core/state/analysis-key.mjs";

const T0 = 15_000_000 * REFRESH_WINDOW_MS; // início de uma janela de 120 s

const makeState = (extra = {}) => ({
  gameId: "G1",
  signature: "s1",
  modifiedAt: "2026-10-10T12:00:00Z",
  phase: "InProgress",
  actionable: true,
  sameGame: true,
  match: { id: "G1", status: "live", boardReady: true },
  localPlayerId: "P1",
  estimatedLevel: 5,
  players: [{ id: "P1" }, { id: "P2" }],
  screen: {
    gold: 30,
    level: 5,
    xp: "2/20",
    stage: "2-1",
    shop: ["A"],
    items: [],
    sources: { level: "tela" },
  },
  ...extra,
});
const withGold = (gold, extra = {}) =>
  makeState({ screen: { ...makeState().screen, gold }, ...extra });

/** Monta o laço com tudo falso. `pipeline` imita app/recommend.mjs: guarda o resultado sob a chave de análise. */
function harness({ status = 200, refresh } = {}) {
  const clock = { t: T0 };
  const h = {
    clock,
    inMatch: true,
    state: makeState(),
    stored: null,
    probes: 0,
    reads: 0,
    refreshed: [],
    logs: [],
    reports: [],
    results: createRecentResults(),
  };
  h.keyOf = (state, decided = DEFAULT_DECISIONS) =>
    analysisKey(state, decisionPayload(state, decided), clock.t);
  h.loop = createAutoRefresh({
    probe: async () => {
      h.probes++;
      return { inMatch: h.inMatch, gameId: h.state.gameId };
    },
    readState: async () => {
      h.reads++;
      return h.state;
    },
    decisions: () => h.stored,
    refresh:
      refresh ??
      (async (decided, state) => {
        h.refreshed.push(decided);
        if (status !== 200) return { status };
        await h.results.run(h.keyOf(state, decided), async () => ({
          n: h.refreshed.length,
        }));
        return { status: 200 };
      }),
    results: h.results,
    now: () => clock.t,
    intervalMs: 3000,
    minGapMs: 3000,
    report: (name, ms) => h.reports.push([name, ms]),
    log: (level, text) => h.logs.push([level, text]),
  });
  return h;
}

test("sem partida o tick só sonda: nenhuma leitura de estado, nenhuma análise", async () => {
  const h = harness();
  h.inMatch = false;
  for (let i = 0; i < 3; i++) {
    h.clock.t += 3000;
    assert.deepEqual(await h.loop.tick(), { action: "idle" });
  }
  assert.equal(h.probes, 3);
  assert.equal(h.reads, 0);
  assert.equal(h.refreshed.length, 0);
  assert.equal(h.loop.status().active, false);
});

test("chave igual não reanalisa; chave nova analisa, respeitando o intervalo mínimo", async () => {
  const h = harness();
  assert.equal((await h.loop.tick()).action, "run");
  assert.equal(h.refreshed.length, 1);
  // Mesmo estado, meio segundo depois: a chave é a mesma e o resultado está guardado.
  h.clock.t += 500;
  assert.equal((await h.loop.tick()).action, "same");
  assert.equal(h.refreshed.length, 1);
  // O ouro mudou 1 s depois da última análise: chave nova, mas o intervalo mínimo (3 s) ainda não passou.
  h.clock.t += 500;
  h.state = withGold(45);
  const early = await h.loop.tick();
  assert.deepEqual([early.action, early.reason], ["wait", "intervalo"]);
  assert.equal(h.refreshed.length, 1);
  // Passado o intervalo (3 s desde a última análise), analisa.
  h.clock.t += 2000;
  assert.equal((await h.loop.tick()).action, "run");
  assert.equal(h.refreshed.length, 2);
  // E o novo estado também fica igual-a-si-mesmo.
  h.clock.t += 3000;
  assert.equal((await h.loop.tick()).action, "same");
  assert.equal(h.refreshed.length, 2);
});

test("a janela de 120 s renova a análise mesmo com o jogo parado", async () => {
  const h = harness();
  await h.loop.tick();
  h.clock.t = T0 + REFRESH_WINDOW_MS - 1000;
  assert.equal((await h.loop.tick()).action, "same");
  h.clock.t = T0 + REFRESH_WINDOW_MS;
  assert.equal((await h.loop.tick()).action, "run");
  assert.equal(h.refreshed.length, 2);
});

test("as decisões do usuário são lembradas: sem POST valem os padrões, com POST entram na chave e no pipeline", async () => {
  const h = harness();
  await h.loop.tick();
  assert.deepEqual(h.refreshed[0], DEFAULT_DECISIONS);
  // Chegou um POST que fixou uma comp e marcou um aprimoramento (o servidor guardou em plan-state).
  h.stored = {
    goalCompId: "comp-1",
    goalSwaps: [{ out: "A", in: "B" }],
    compSwaps: {},
    augments: ["Aug1"],
    augmentsKnown: true,
  };
  h.clock.t += 3000;
  assert.equal(
    (await h.loop.tick()).action,
    "run",
    "decisão nova = chave nova",
  );
  assert.deepEqual(h.refreshed[1], h.stored);
  // A chave guardada é a do estado com essas decisões: um POST com as mesmas decisões acerta o cache.
  assert.equal(h.results.has(h.keyOf(h.state, h.stored)), true);
  h.clock.t += 3000;
  assert.equal((await h.loop.tick()).action, "same");
  // Decisões parciais completam com os padrões.
  h.stored = { goalCompId: "comp-2" };
  h.clock.t += 3000;
  await h.loop.tick();
  assert.deepEqual(h.refreshed[2], {
    ...DEFAULT_DECISIONS,
    goalCompId: "comp-2",
  });
});

test("o POST seguinte com a mesma chave responde do cache (e o que está em cálculo é compartilhado)", async () => {
  const h = harness();
  await h.loop.tick();
  const key = h.keyOf(h.state);
  let computed = 0;
  const post = await h.results.run(key, async () => {
    computed++;
    return { n: "do POST" };
  });
  assert.equal(post.via, "cache");
  assert.equal(computed, 0);
  assert.equal(post.parts.n, 1, "o resultado é o do laço");
  // O inverso: um POST em cálculo com a chave que o laço calcularia agora faz o laço esperar (nada de trabalho em dobro).
  h.state = withGold(80);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const running = h.results.run(h.keyOf(h.state), async () => {
    await gate;
    return { n: "do POST em andamento" };
  });
  h.clock.t += 3000;
  assert.equal((await h.loop.tick()).action, "same");
  assert.equal(h.refreshed.length, 1);
  release();
  assert.equal((await running).via, "novo");
});

test("ao fim da partida o laço volta a só sondar; uma partida nova recomeça na hora", async () => {
  const h = harness();
  await h.loop.tick();
  assert.equal(h.loop.status().active, true);
  h.inMatch = false;
  h.clock.t += 3000;
  assert.equal((await h.loop.tick()).action, "idle");
  assert.equal(h.loop.status().active, false);
  const ended = () => h.logs.filter(([, text]) => /terminou/.test(text)).length;
  assert.equal(ended(), 1);
  const reads = h.reads;
  h.clock.t += 3000;
  await h.loop.tick();
  assert.equal(h.reads, reads, "parado: nenhuma leitura de estado");
  assert.equal(ended(), 1, "não repete o fim da partida");
  // Outra partida: analisa na primeira leitura, sem esperar o intervalo da anterior.
  h.inMatch = true;
  h.state = makeState({
    gameId: "G2",
    signature: "s9",
    match: { id: "G2", status: "live", boardReady: true },
  });
  h.clock.t += 500;
  assert.equal((await h.loop.tick()).action, "run");
  assert.equal(h.refreshed.length, 2);
  assert.equal(h.loop.status().active, true);
});

test("guardas da interface: partida nova sem tabuleiro próprio e sem o jogador local não analisam", async () => {
  const h = harness();
  h.state = makeState({
    match: { id: "G1", status: "live", boardReady: false },
  });
  assert.deepEqual(await h.loop.tick(), {
    action: "wait",
    reason: "tabuleiro",
  });
  h.state = makeState({ players: [{ id: "P2" }] });
  h.clock.t += 3000;
  assert.deepEqual(await h.loop.tick(), { action: "wait", reason: "jogador" });
  assert.equal(h.refreshed.length, 0);
});

test("falha do pipeline: o laço sobrevive, avisa uma vez por minuto e recua antes de tentar de novo", async () => {
  let fail = true;
  const h = harness({
    refresh: async (decided, state) => {
      h.refreshed.push(decided);
      if (fail) throw Error("boom");
      await h.results.run(h.keyOf(state, decided), async () => ({}));
      return { status: 200 };
    },
  });
  assert.equal((await h.loop.tick()).action, "error");
  assert.equal(h.loop.status().failures, 1);
  h.clock.t += 3000; // recuo de 6 s depois da 1ª falha
  assert.equal((await h.loop.tick()).reason, "intervalo");
  h.clock.t += 3000;
  assert.equal((await h.loop.tick()).action, "error");
  assert.equal(h.loop.status().failures, 2);
  assert.equal(
    h.logs.filter(([, text]) => /boom/.test(text)).length,
    1,
    "mesmo aviso: uma vez por minuto",
  );
  fail = false;
  h.clock.t += 12_000; // recuo de 12 s depois da 2ª falha
  assert.equal((await h.loop.tick()).action, "run");
  assert.equal(h.loop.status().failures, 0);
});

test("snapshot de outro set (409) não repete a mesma chave", async () => {
  const h = harness({ status: 409 });
  assert.equal((await h.loop.tick()).action, "rejected");
  h.clock.t += 3000;
  assert.equal((await h.loop.tick()).action, "same");
  assert.equal(h.refreshed.length, 1);
  h.state = withGold(99);
  h.clock.t += 3000;
  assert.equal(
    (await h.loop.tick()).action,
    "rejected",
    "estado novo tenta de novo",
  );
  assert.equal(h.refreshed.length, 2);
});

test("um tick não começa enquanto o anterior roda", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const h = harness({
    refresh: async () => {
      await gate;
      return { status: 200 };
    },
  });
  const first = h.loop.tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await h.loop.tick(), { action: "busy" });
  release();
  assert.equal((await first).action, "run");
});

test("start agenda o primeiro tick, repete a cada intervalo e stop desliga o laço", async () => {
  const queue = [];
  const cleared = [];
  const h = harness();
  const loop = createAutoRefresh({
    probe: async () => ({ inMatch: true, gameId: "G1" }),
    readState: async () => h.state,
    refresh: async () => ({ status: 200 }),
    results: h.results,
    now: () => h.clock.t,
    timers: {
      setTimeout: (fn, ms) => {
        const handle = { fn, ms, unref() {} };
        queue.push(handle);
        return handle;
      },
      clearTimeout: (handle) => cleared.push(handle),
    },
    startDelayMs: 1000,
    intervalMs: 3000,
  });
  loop.start();
  loop.start(); // idempotente
  assert.equal(queue.length, 1);
  assert.equal(queue[0].ms, 1000);
  await queue[0].fn();
  assert.equal(queue.length, 2);
  assert.equal(queue[1].ms, 3000);
  assert.equal(loop.status().running, true);
  assert.equal(loop.status().active, true);
  loop.stop();
  assert.equal(cleared.at(-1), queue[1]);
  assert.equal(loop.status().running, false);
  assert.equal(loop.status().active, false);
});

test("o tempo do laço é registrado (tick barato e análise) e o resumo de contadores zera a cada leitura", async () => {
  const h = harness();
  await h.loop.tick(); // roda a análise
  h.clock.t += 3000;
  await h.loop.tick(); // chave igual
  const names = h.reports.map(([name]) => name);
  assert.ok(names.includes("AUTO analise"));
  assert.ok(names.includes("AUTO tick"));
  const text = h.loop.takeStats();
  assert.match(text, /em partida ticks=2 analises=1 iguais=1/);
  assert.match(h.loop.takeStats(), /ticks=0 analises=0 iguais=0/);
});

test("resultados recentes: pronto serve do cache, cálculo em andamento é compartilhado, falha não fica e o limite descarta o mais antigo", async () => {
  const r = createRecentResults({ max: 2 });
  assert.equal((await r.run("a", async () => 1)).via, "novo");
  assert.deepEqual(await r.run("a", async () => 2), { parts: 1, via: "cache" });
  assert.equal(r.peek("a"), 1);
  // Cálculo em andamento: o segundo pedido espera o primeiro.
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let calls = 0;
  const first = r.run("b", async () => {
    calls++;
    await gate;
    return "B";
  });
  assert.equal(r.has("b"), true);
  const second = r.run("b", async () => {
    calls++;
    return "outro";
  });
  release();
  assert.deepEqual(await first, { parts: "B", via: "novo" });
  assert.deepEqual(await second, { parts: "B", via: "junto" });
  assert.equal(calls, 1);
  // Limite 2: "c" entra, "a" (a mais antiga) sai.
  await r.run("c", async () => "C");
  assert.equal(r.has("a"), false);
  assert.equal(r.size, 2);
  // Falha: nada fica guardado, e quem esperava calcula por conta própria.
  let fail;
  const broken = new Promise((_, reject) => (fail = reject));
  const owner = r.run("d", () => broken);
  const waiter = r.run("d", async () => "D2");
  fail(Error("falhou"));
  await assert.rejects(owner, /falhou/);
  assert.deepEqual(await waiter, { parts: "D2", via: "novo" });
  r.clear();
  assert.equal(r.size, 0);
  assert.equal(r.has("c"), false);
});
