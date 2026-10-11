// Rodar com: node --test tft/helper/tests/analysis-worker.test.mjs
// M10a: fila, coalescência, descarte do obsoleto, timeout, reinício após queda, ordem dos resultados e a resposta
// imediata marcada (`stale`, `ageMs`, `baseAge` <= 1 leitura). A maior parte usa um pipeline falso controlado pelo
// teste e uma "thread" falsa no mesmo processo que roda o MESMO protocolo da thread real (`serveAnalysis`); no fim,
// poucos testes sobem uma thread de verdade (`worker_threads`) com tests/fixtures/analysis-fake-pipeline.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAnalysisWorker, workerSpawner } from "../analysis-worker.mjs";
import { serveAnalysis } from "../analysis-worker-entry.mjs";
import {
  analysisEvent,
  appendFields,
  freshness,
  markBase,
  summarize,
} from "../analysis-protocol.mjs";

/* ---------- apoio ---------- */

const tick = () => new Promise((resolve) => setImmediate(resolve));
const decoder = new TextDecoder();
const parse = (bytes) => JSON.parse(decoder.decode(bytes));

async function until(condition, label, ms = 3000) {
  const t0 = Date.now();
  while (!condition()) {
    if (Date.now() - t0 > ms) assert.fail(`tempo esgotado: ${label}`);
    await tick();
  }
}

/** Pipeline falso: cada `run` fica parado até o teste liberar (`call.resolve`) ou recusar (`call.reject`). */
function controlled({ initFailures = 0 } = {}) {
  const calls = [];
  let failures = initFailures;
  return {
    calls,
    async init(data) {
      if (failures-- > 0) throw new Error("init falhou");
      return { init: data };
    },
    run(args) {
      const call = { ...args };
      calls.push(call);
      return new Promise((resolve, reject) => {
        call.resolve = (value) => resolve(value ?? { n: args.payload.n });
        call.reject = reject;
      });
    },
  };
}

/** Thread falsa: entrega mensagens de forma assíncrona e clonada, como o canal de verdade. */
class FakeThread extends EventEmitter {
  constructor(pipeline, { init = null, now } = {}) {
    super();
    this.dead = false;
    this.sent = [];
    this.inbox = new EventEmitter();
    const port = {
      on: (event, handler) => this.inbox.on(event, handler),
      postMessage: (msg, transfer = []) => {
        if (this.dead) return;
        const copy = structuredClone(msg, { transfer });
        setImmediate(() => {
          if (!this.dead) this.emit("message", copy);
        });
      },
      close: () => {},
    };
    serveAnalysis({ port, pipeline, init, now });
  }
  postMessage(msg) {
    this.sent.push(msg);
    const copy = structuredClone(msg);
    setImmediate(() => {
      if (!this.dead) this.inbox.emit("message", copy);
    });
  }
  terminate() {
    this.dead = true;
    setImmediate(() => this.emit("exit", 1));
    return Promise.resolve(1);
  }
  crash(message = "boom") {
    this.dead = true;
    this.emit("error", new Error(message));
    this.emit("exit", 1);
  }
}

function rig({ pipeline = controlled(), clock = null, ...config } = {}) {
  const threads = [];
  const events = [];
  const bases = []; // revisões avisadas por `onLatest`, na ordem
  const worker = createAnalysisWorker({
    spawn: () => {
      const thread = new FakeThread(pipeline, { now: clock?.now });
      threads.push(thread);
      return thread;
    },
    restartDelayMs: 1,
    now: clock?.now,
    onEvent: (e) => events.push(e),
    onLatest: (result) => bases.push(result.rev),
    ...config,
  });
  return { worker, pipeline, threads, events, bases };
}

const makeClock = (t = 0) => {
  const clock = { t, now: () => clock.t };
  return clock;
};

/** Sobe, deixa o primeiro pedido chegar ao pipeline e devolve o pedido. */
async function started(r, payload, opts) {
  const ticket = r.worker.submit(payload, opts);
  await until(
    () => r.pipeline.calls.some((c) => c.id === ticket.id),
    `pedido ${ticket.id} chegar ao pipeline`,
  );
  return ticket;
}

/* ---------- protocolo da thread (serveAnalysis) ---------- */

test("thread: ready, contexto, resultado serializado e TRANSFERIDO, etapas medidas", async () => {
  const sent = [];
  let onMessage = null;
  const port = {
    on: (_event, handler) => (onMessage = handler),
    postMessage: (msg, transfer) => sent.push({ msg, transfer }),
    close() {},
  };
  const clock = makeClock(0);
  serveAnalysis({
    port,
    init: { tag: "t" },
    now: clock.now,
    pipeline: {
      init: async (data) => ({ tag: data.tag }),
      run: async ({ id, payload, context, ctxRev, state, lap, sideband }) => {
        clock.t += 30;
        lap("analisar");
        clock.t += 20;
        if (payload.raw) return `{"raw":${id}}`;
        sideband({ top: `plano-${id}` });
        return { id, n: payload.n, x: context.x, ctxRev, tag: state.tag };
      },
    },
  });
  await until(() => sent.length === 1, "ready");
  assert.equal(sent[0].msg.type, "ready");

  onMessage({ type: "context", rev: 3, parts: { x: 9 } });
  onMessage({ type: "run", id: 7, ctxRev: 3, payload: { n: 5 } });
  await until(() => sent.length === 2, "resultado");
  const { msg, transfer } = sent[1];
  assert.equal(msg.type, "result");
  assert.equal(msg.id, 7);
  assert.ok(msg.bytes instanceof ArrayBuffer);
  assert.deepEqual(
    transfer,
    [msg.bytes],
    "o buffer vai na lista de transferência",
  );
  assert.deepEqual(parse(new Uint8Array(msg.bytes)), {
    id: 7,
    n: 5,
    x: 9,
    ctxRev: 3,
    tag: "t",
  });
  assert.deepEqual(
    msg.sideband,
    { top: "plano-7" },
    "dado pequeno ao lado do resultado",
  );
  assert.equal(msg.workerMs, 50);
  assert.deepEqual(msg.stages, [
    ["analisar", 30],
    ["serializar", 0],
  ]);

  // Uma string devolvida pelo pipeline já é o JSON: sai como está.
  onMessage({ type: "run", id: 8, ctxRev: 3, payload: { raw: true } });
  await until(() => sent.length === 3, "resultado 2");
  assert.equal(decoder.decode(new Uint8Array(sent[2].msg.bytes)), '{"raw":8}');
});

test("thread: erro do pipeline, falha ao iniciar e cancelamento (antes e durante a execução)", async () => {
  const sent = [];
  let onMessage = null;
  const port = {
    on: (_event, handler) => (onMessage = handler),
    postMessage: (msg) => sent.push(msg),
    close() {},
  };
  const gate = controlled();
  serveAnalysis({ port, pipeline: gate });
  await until(() => sent.length === 1, "ready");
  onMessage({ type: "run", id: 1, ctxRev: 0, payload: { n: 1 } });
  onMessage({ type: "run", id: 2, ctxRev: 0, payload: { n: 2 } });
  onMessage({ type: "cancel", id: 2 }); // cancelado antes de começar
  await until(() => gate.calls.length === 1, "pedido 1");
  gate.calls[0].reject(new Error("quebrou"));
  await until(() => sent.length === 3, "erro do 1 e cancelado do 2");
  assert.equal(sent[1].type, "error");
  assert.equal(sent[1].id, 1);
  assert.equal(sent[1].error.message, "quebrou");
  assert.deepEqual(sent[2], { type: "cancelled", id: 2 });
  assert.equal(gate.calls.length, 1, "o pedido 2 nunca chegou ao pipeline");

  // Cancelado durante a execução: o sinal fica `aborted` e o resultado é descartado dentro da thread.
  onMessage({ type: "run", id: 3, ctxRev: 0, payload: { n: 3 } });
  await until(() => gate.calls.length === 2, "pedido 3");
  assert.equal(gate.calls[1].signal.aborted, false);
  onMessage({ type: "cancel", id: 3 });
  assert.equal(gate.calls[1].signal.aborted, true);
  gate.calls[1].resolve();
  await until(() => sent.length === 4, "cancelado do 3");
  assert.deepEqual(sent[3], { type: "cancelled", id: 3 });

  // Falha ao iniciar o pipeline: `error` sem id.
  const failed = [];
  serveAnalysis({
    port: { on() {}, postMessage: (m) => failed.push(m), close() {} },
    pipeline: controlled({ initFailures: 1 }),
  });
  await until(() => failed.length === 1, "falha de início");
  assert.equal(failed[0].type, "error");
  assert.equal(failed[0].id, null);
});

/* ---------- fila, coalescência, ordem ---------- */

test("fila: um pedido ativo; os que chegam enquanto roda são coalescidos e só o mais recente roda depois", async () => {
  const r = rig();
  try {
    const a = await started(r, { n: 1 });
    const b = r.worker.submit({ n: 2 });
    const c = r.worker.submit({ n: 3 });
    const d = r.worker.submit({ n: 4 });
    const [ob, oc] = [await b.done, await c.done];
    assert.equal(ob.status, "superseded");
    assert.equal(ob.successor, c, "b foi substituído por c");
    assert.equal(oc.status, "superseded");
    assert.equal(oc.successor, d, "c foi substituído por d");
    await tick();
    assert.equal(
      r.pipeline.calls.length,
      1,
      "só um pedido ativo, nenhum em paralelo",
    );
    assert.equal(r.worker.stats().waiting, d.id);

    r.pipeline.calls[0].resolve();
    const outA = await a.done;
    assert.equal(outA.status, "ok");
    assert.equal(
      outA.obsolete,
      true,
      "chegaram leituras novas enquanto rodava",
    );
    assert.deepEqual(parse(outA.result.bytes), { n: 1 });

    await until(() => r.pipeline.calls.length === 2, "d começar");
    assert.deepEqual(
      r.pipeline.calls.map((c) => c.payload.n),
      [1, 4],
      "b e c nunca rodaram",
    );
    r.pipeline.calls[1].resolve();
    // Quem esperava b recebe o resultado de d (segue os sucessores).
    const out = await r.worker.resolve(b, { allowStale: false });
    assert.equal(out.id, d.id);
    assert.equal(out.status, "ok");
    assert.equal(out.obsolete, false);
    assert.deepEqual(parse(out.result.bytes), { n: 4 });
    assert.equal(r.worker.stats().counters.superseded, 2);
  } finally {
    await r.worker.close();
  }
});

test("ordem: os resultados chegam em ordem de revisão e a última base só avança", async () => {
  const r = rig();
  try {
    const revs = [];
    for (let n = 1; n <= 5; n++) {
      const t = await started(r, { n });
      r.pipeline.calls[n - 1].resolve();
      const out = await t.done;
      assert.equal(out.status, "ok");
      assert.equal(out.obsolete, false);
      revs.push(out.result.rev);
      assert.equal(r.worker.latest().rev, out.result.rev);
    }
    assert.deepEqual(
      revs,
      [...revs].sort((x, y) => x - y),
    );
    assert.equal(new Set(revs).size, 5);
    assert.deepEqual(r.bases, revs, "onLatest avisou cada base nova, na ordem");

    // Mensagem fora de ordem ou de um pedido que não está rodando é descartada e não mexe na base.
    const before = r.worker.latest();
    r.threads[0].emit("message", {
      type: "result",
      id: 1,
      ctxRev: 0,
      bytes: new TextEncoder().encode('{"n":"velho"}').buffer,
    });
    assert.equal(r.worker.latest(), before);
    assert.equal(r.worker.stats().counters.discardedLate, 1);
    assert.equal(r.worker.stats().counters.completed, 5);
  } finally {
    await r.worker.close();
  }
});

test("métricas: fila, execução, total, etapas e idade do resultado", async () => {
  const clock = makeClock(0);
  const r = rig({ clock });
  try {
    const a = await started(r, { n: 1 });
    clock.t = 100;
    r.pipeline.calls[0].lap("analisar");
    clock.t = 150;
    r.pipeline.calls[0].resolve();
    const out = await a.done;
    assert.equal(out.metrics.queueMs, 0);
    assert.equal(out.metrics.runMs, 150);
    assert.equal(out.metrics.workerMs, 150);
    assert.equal(out.metrics.totalMs, 150);
    assert.deepEqual(out.metrics.stages, [
      ["analisar", 100],
      ["serializar", 0],
    ]);
    // Idade do resultado = agora - fim da execução.
    clock.t = 400;
    const s = r.worker.stats();
    assert.equal(s.latest.ageMs, 250);
    assert.equal(s.runMs.n, 1);
    assert.equal(s.runMs.p50, 150);
    assert.equal(s.counters.completed, 1);
    assert.ok(r.events.some((e) => e.type === "result" && e.runMs === 150));
  } finally {
    await r.worker.close();
  }
});

/* ---------- resposta imediata marcada ---------- */

test("resposta imediata: a base de uma leitura atrás serve, marcada; duas leituras atrás espera", async () => {
  const clock = makeClock(0);
  const r = rig({ clock });
  try {
    const t1 = await started(r, { n: 1 }, { key: "k1" });
    assert.equal(r.worker.latest(), null, "sem base ainda");
    clock.t = 100;
    r.pipeline.calls[0].resolve();
    assert.equal((await t1.done).stale, false);

    // Leitura 2 chega; a base (leitura 1) está 1 atrás: responde na hora, enquanto a leitura 2 roda.
    const t2 = r.worker.submit({ n: 2 }, { key: "k2" });
    const quick = await t2.usable;
    assert.equal(quick.status, "ok");
    assert.equal(quick.stale, true);
    assert.equal(quick.source, "previous");
    assert.equal(quick.result.rev, t1.id);
    assert.equal(quick.base.baseAge, 1);
    clock.t = 450;
    const { bytes, base } = r.worker.responseBytes(quick);
    assert.deepEqual(parse(bytes), {
      n: 1,
      base: {
        rev: t1.id,
        reading: 1,
        stale: true,
        baseAge: 1,
        ageMs: 350,
        maxBaseAge: 1,
      },
    });
    assert.equal(base.ageMs, 350);
    await until(() => r.pipeline.calls.length === 2, "leitura 2 rodar");

    // Leitura 3 chega com a 2 ainda rodando: a base (leitura 1) está 2 atrás, não serve.
    const t3 = r.worker.submit({ n: 3 }, { key: "k3" });
    let early = false;
    t3.usable.then(() => (early = true));
    await tick();
    await tick();
    assert.equal(early, false, "defasagem de 2 leituras não é aceita");

    // A leitura 2 termina: agora a base está 1 atrás de t3 e passa a servir, marcada.
    r.pipeline.calls[1].resolve();
    const q3 = await t3.usable;
    assert.equal(q3.stale, true);
    assert.equal(q3.result.rev, t2.id);
    assert.equal(q3.base.baseAge, 1);
    assert.equal((await t2.done).obsolete, true);

    // A própria análise fecha o ciclo, sem marca de defasagem.
    await until(() => r.pipeline.calls.length === 3, "leitura 3 rodar");
    r.pipeline.calls[2].resolve();
    const own = await t3.done;
    assert.equal(own.stale, false);
    assert.equal(own.base.baseAge, 0);
    assert.equal(parse(r.worker.responseBytes(own).bytes).base.stale, false);
    assert.deepEqual(analysisEvent(own.result), {
      type: "analysis",
      rev: t3.id,
      reading: 3,
      key: "k3",
    });
  } finally {
    await r.worker.close();
  }
});

test("resposta imediata: maxBaseAge 0, contexto novo e graceMs", async () => {
  const r = rig();
  try {
    const t1 = await started(r, { n: 1 }, { key: "a" });
    r.pipeline.calls[0].resolve();
    await t1.done;

    // maxBaseAge 0: só vale a própria análise.
    const strict = r.worker.submit({ n: 2 }, { key: "b", maxBaseAge: 0 });
    let early = false;
    strict.usable.then(() => (early = true));
    await tick();
    assert.equal(early, false);
    await until(() => r.pipeline.calls.length === 2, "pedido b");
    r.pipeline.calls[1].resolve();
    assert.equal((await strict.done).stale, false);

    // Contexto estático mudou: a base guardada não serve de resposta imediata.
    const rev = r.worker.setContext({ meta: "novo" });
    assert.equal(rev, 1);
    const afterCtx = r.worker.submit({ n: 3 }, { key: "c" });
    let ctxEarly = false;
    afterCtx.usable.then(() => (ctxEarly = true));
    await tick();
    await tick();
    assert.equal(ctxEarly, false, "base de outro contexto não é aceita");
    await until(() => r.pipeline.calls.length === 3, "pedido c");
    assert.equal(r.pipeline.calls[2].ctxRev, 1);
    assert.equal(r.pipeline.calls[2].context.meta, "novo");
    r.pipeline.calls[2].resolve();
    assert.equal((await afterCtx.done).ctxStale, false);

    // graceMs: dá um tempo para a análise própria; se não vier, usa a base de uma leitura atrás.
    const slow = r.worker.submit({ n: 4 }, { key: "d" });
    const t0 = Date.now();
    const out = await r.worker.resolve(slow, { graceMs: 30 });
    assert.equal(out.stale, true);
    assert.ok(
      Date.now() - t0 >= 25,
      "esperou a janela antes de aceitar a base antiga",
    );
    await until(() => r.pipeline.calls.length === 4, "pedido d");
    r.pipeline.calls[3].resolve();
    await slow.done;
    // Se a análise própria chega dentro da janela, ela vence.
    const quick = r.worker.submit({ n: 5 }, { key: "e" });
    const racing = r.worker.resolve(quick, { graceMs: 2000 });
    await until(() => r.pipeline.calls.length === 5, "pedido e");
    r.pipeline.calls[4].resolve();
    assert.equal((await racing).stale, false);
  } finally {
    await r.worker.close();
  }
});

test("mesma chave: reaproveita o resultado guardado ou o pedido em execução", async () => {
  const r = rig();
  try {
    const first = await started(r, { n: 1 }, { key: "k" });
    const twin = r.worker.submit({ n: 1 }, { key: "k" });
    r.pipeline.calls[0].resolve();
    const [o1, o2] = [await first.done, await twin.done];
    assert.equal(o2.joined, true);
    assert.equal(o2.result.rev, o1.result.rev);
    assert.equal(r.pipeline.calls.length, 1, "um só cálculo");

    const again = r.worker.submit({ n: 1 }, { key: "k" });
    const o3 = await again.done;
    assert.equal(o3.cached, true);
    assert.equal(o3.result.rev, o1.result.rev);
    assert.equal(r.pipeline.calls.length, 1);
    assert.equal(r.worker.stats().counters.cached, 1);
    assert.equal(r.worker.stats().counters.joined, 1);

    // Chave diferente: nova leitura, roda de novo.
    const other = r.worker.submit({ n: 2 }, { key: "k2" });
    await until(() => r.pipeline.calls.length === 2, "chave nova");
    r.pipeline.calls[1].resolve();
    assert.equal((await other.done).cached, undefined);
  } finally {
    await r.worker.close();
  }
});

/* ---------- cancelamento ---------- */

test("cancelar: esperando sai da fila; rodando descarta o resultado e libera a vaga quando a thread acaba", async () => {
  const r = rig();
  try {
    const a = await started(r, { n: 1 });
    const b = r.worker.submit({ n: 2 });
    assert.equal(r.worker.cancel(b), true);
    assert.equal((await b.done).status, "cancelled");
    assert.equal(r.worker.cancel(b), false, "cancelar de novo não faz nada");

    // Rodando: o pedido termina `cancelled` na hora; o sinal avisa o pipeline; o resultado não vira base.
    assert.equal(r.worker.cancel(a), true);
    assert.equal((await a.done).status, "cancelled");
    await until(
      () => r.pipeline.calls[0].signal.aborted,
      "sinal de cancelamento",
    );
    const c = r.worker.submit({ n: 3 });
    await tick();
    await tick();
    assert.equal(
      r.pipeline.calls.length,
      1,
      "a thread ainda está ocupada com o cancelado",
    );
    r.pipeline.calls[0].resolve();
    await until(
      () => r.pipeline.calls.length === 2,
      "c rodar depois que a vaga liberou",
    );
    assert.equal(
      r.worker.latest(),
      null,
      "o resultado cancelado foi descartado",
    );
    r.pipeline.calls[1].resolve();
    const out = await c.done;
    assert.equal(out.status, "ok");
    assert.equal(r.worker.latest().rev, c.id);
    assert.equal(r.worker.stats().counters.cancelled, 2);
  } finally {
    await r.worker.close();
  }
});

test("cancelar com kill: recria a thread e o próximo pedido roda na nova", async () => {
  const r = rig();
  try {
    const a = await started(r, { n: 1 });
    const b = r.worker.submit({ n: 2 });
    assert.equal(r.worker.cancel(a, { kill: true }), true);
    assert.equal((await a.done).status, "cancelled");
    assert.equal(r.threads[0].dead, true);
    await until(() => r.pipeline.calls.length === 2, "b na thread nova");
    assert.equal(r.threads.length, 2);
    r.pipeline.calls[1].resolve();
    assert.equal((await b.done).status, "ok");
  } finally {
    await r.worker.close();
  }
});

/* ---------- timeout, queda, reinício ---------- */

test("timeout: encerra a thread, o pedido termina `timeout`, o resultado tardio é descartado e o próximo roda", async () => {
  const r = rig({ timeoutMs: 30 });
  try {
    r.worker.setContext({ catalogo: "c1" });
    const a = await started(r, { n: 1 });
    const b = r.worker.submit({ n: 2 });
    const out = await a.done;
    assert.equal(out.status, "timeout");
    assert.equal(out.timeoutMs, 30);
    assert.equal(r.threads[0].dead, true);

    // A thread nova recebeu o contexto de novo e atende o pedido que esperava.
    await until(() => r.pipeline.calls.length === 2, "b na thread nova");
    assert.equal(r.threads.length, 2);
    assert.equal(r.pipeline.calls[1].context.catalogo, "c1");
    r.pipeline.calls[1].resolve();
    const ob = await b.done;
    assert.equal(ob.status, "ok");

    // O pipeline velho termina depois: ninguém ouve. Uma mensagem forçada da thread velha também é ignorada.
    r.pipeline.calls[0].resolve();
    r.threads[0].emit("message", {
      type: "result",
      id: a.id,
      ctxRev: 1,
      bytes: new TextEncoder().encode('{"n":"tardio"}').buffer,
    });
    await tick();
    assert.equal(r.worker.latest().rev, b.id);
    const s = r.worker.stats();
    assert.equal(s.counters.timeouts, 1);
    assert.equal(s.counters.restarts, 1);
    assert.equal(
      s.counters.crashes,
      0,
      "o exit da thread encerrada por nós não conta como queda",
    );
    assert.ok(s.counters.discardedLate >= 1);
    assert.deepEqual(
      r.events.filter((e) => e.type === "timeout").map((e) => e.id),
      [a.id],
    );
  } finally {
    await r.worker.close();
  }
});

test("queda: o pedido em execução termina `crashed`, a thread é recriada e o que esperava roda nela", async () => {
  const r = rig();
  try {
    r.worker.setContext({ meta: "m" });
    const a = await started(r, { n: 1 });
    const b = r.worker.submit({ n: 2 });
    r.threads[0].crash("explodiu");
    const out = await a.done;
    assert.equal(out.status, "crashed");
    assert.equal(out.reason, "error");
    assert.equal(out.error.message, "explodiu");
    await until(() => r.pipeline.calls.length === 2, "b na thread nova");
    assert.equal(r.threads.length, 2);
    assert.equal(r.pipeline.calls[1].context.meta, "m", "contexto reenviado");
    r.pipeline.calls[1].resolve();
    assert.equal((await b.done).status, "ok");
    const s = r.worker.stats();
    assert.equal(
      s.counters.crashes,
      1,
      "error + exit da mesma queda contam uma vez",
    );
    assert.equal(s.counters.restarts, 1);
    assert.equal(s.phase, "ready");
  } finally {
    await r.worker.close();
  }
});

test("queda: limite de recriações vira `unavailable` e `reset` volta a funcionar", async () => {
  const clock = makeClock(0);
  const r = rig({ clock, maxRestarts: 1 });
  try {
    const a = await started(r, { n: 1 });
    r.threads[0].crash();
    assert.equal((await a.done).status, "crashed");
    const b = await started(r, { n: 2 }); // thread nova (1ª recriação, dentro do limite)
    r.threads[1].crash();
    assert.equal((await b.done).status, "crashed");
    await until(
      () => r.worker.stats().phase === "failed",
      "limite de recriações",
    );

    const c = r.worker.submit({ n: 3 });
    const oc = await c.done;
    assert.equal(oc.status, "unavailable");
    assert.equal(oc.reason, "failed");
    assert.ok(r.events.some((e) => e.type === "failed"));

    assert.equal(r.worker.reset(), true);
    const d = await started(r, { n: 4 });
    r.pipeline.calls.at(-1).resolve();
    assert.equal((await d.done).status, "ok");
    assert.equal(r.worker.reset(), false, "só reinicia de `failed`");
  } finally {
    await r.worker.close();
  }
});

test("falha ao iniciar o pipeline: a thread é recriada e o pedido que esperava roda", async () => {
  const r = rig({ pipeline: controlled({ initFailures: 1 }) });
  try {
    const a = r.worker.submit({ n: 1 });
    await until(() => r.pipeline.calls.length === 1, "a rodar na 2ª thread");
    assert.equal(r.threads.length, 2);
    r.pipeline.calls[0].resolve();
    assert.equal((await a.done).status, "ok");
    assert.equal(r.worker.stats().counters.crashes, 1);
  } finally {
    await r.worker.close();
  }
});

test("thread que não avisa `ready` no prazo é recriada", async () => {
  let spawned = 0;
  const hung = new EventEmitter();
  hung.postMessage = () => {};
  hung.terminate = () => Promise.resolve(1);
  const pipeline = controlled();
  const worker = createAnalysisWorker({
    spawn: () => (++spawned === 1 ? hung : new FakeThread(pipeline)),
    startTimeoutMs: 20,
    restartDelayMs: 1,
  });
  try {
    const a = worker.submit({ n: 1 });
    await until(() => pipeline.calls.length === 1, "pedido na 2ª thread");
    assert.equal(spawned, 2);
    pipeline.calls[0].resolve();
    assert.equal((await a.done).status, "ok");
  } finally {
    await worker.close();
  }
});

test("erro do pipeline: o pedido termina `error` e a thread continua", async () => {
  const r = rig();
  try {
    const a = await started(r, { n: 1 });
    r.pipeline.calls[0].reject(new Error("falhou"));
    const out = await a.done;
    assert.equal(out.status, "error");
    assert.equal(out.error.message, "falhou");
    const b = await started(r, { n: 2 });
    r.pipeline.calls[1].resolve();
    assert.equal((await b.done).status, "ok");
    assert.equal(r.threads.length, 1, "sem recriar");
    assert.equal(r.worker.stats().counters.errors, 1);
  } finally {
    await r.worker.close();
  }
});

test("payload que não se clona falha só o pedido", async () => {
  const r = rig();
  try {
    const a = await started(r, { n: 1 });
    r.pipeline.calls[0].resolve();
    await a.done;
    const bad = r.worker.submit({ n: 2, fn: () => {} });
    const out = await bad.done;
    assert.equal(out.status, "error");
    const ok = await started(r, { n: 3 });
    r.pipeline.calls.at(-1).resolve();
    assert.equal((await ok.done).status, "ok");
  } finally {
    await r.worker.close();
  }
});

test("fechar: pendentes terminam `closed`, a thread é encerrada e novos pedidos não rodam", async () => {
  const r = rig();
  const a = await started(r, { n: 1 });
  const b = r.worker.submit({ n: 2 });
  await r.worker.close();
  assert.equal((await a.done).status, "closed");
  assert.equal((await b.done).status, "closed");
  assert.equal(r.threads[0].dead, true);
  const c = r.worker.submit({ n: 3 });
  assert.equal((await c.done).status, "closed");
});

/* ---------- contrato puro ---------- */

test("freshness, markBase e summarize", () => {
  const base = { rev: 4, reading: 5, completedAt: 1000 };
  assert.deepEqual(freshness({ readingNow: 5, base, now: 1000 }), {
    rev: 4,
    reading: 5,
    stale: false,
    baseAge: 0,
    ageMs: 0,
    maxBaseAge: 1,
    acceptable: true,
  });
  const one = freshness({ readingNow: 6, base, now: 1250.4 });
  assert.equal(one.stale, true);
  assert.equal(one.baseAge, 1);
  assert.equal(one.ageMs, 250);
  assert.equal(one.acceptable, true);
  assert.equal(freshness({ readingNow: 7, base, now: 1300 }).acceptable, false);
  assert.equal(
    freshness({ readingNow: 7, base, now: 1300, maxBaseAge: 2 }).acceptable,
    true,
  );
  assert.equal(
    freshness({ readingNow: 4, base, now: 1300 }).baseAge,
    0,
    "base mais nova que o pedido",
  );
  const none = freshness({ readingNow: 1, base: null, now: 0 });
  assert.equal(none.acceptable, false);
  assert.equal(none.baseAge, null);

  const enc = (s) => new TextEncoder().encode(s);
  const info = {
    rev: 1,
    reading: 1,
    stale: true,
    baseAge: 1,
    ageMs: 5,
    maxBaseAge: 1,
  };
  assert.deepEqual(parse(markBase(enc('{"a":1}'), info)), { a: 1, base: info });
  assert.deepEqual(parse(markBase(enc(' {"a":{"b":[1,2]}}\n'), info)), {
    a: { b: [1, 2] },
    base: info,
  });
  assert.deepEqual(parse(markBase(enc("{}"), info)), { base: info });
  assert.deepEqual(parse(markBase(enc("{ }"), info)), { base: info });
  // appendFields: vários campos, ignora `undefined`, nada a acrescentar devolve os mesmos bytes.
  assert.deepEqual(
    parse(
      appendFields(enc('{"a":1}'), {
        planProgress: { x: [1] },
        skip: undefined,
        z: null,
      }),
    ),
    { a: 1, planProgress: { x: [1] }, z: null },
  );
  const same = enc('{"a":1}');
  assert.equal(appendFields(same, { skip: undefined }), same);
  assert.throws(() => markBase(enc("[1]"), info), TypeError);
  assert.throws(() => markBase(enc(""), info), TypeError);
  const win = parse(markBase(enc('{"base":"velho"}'), info));
  assert.deepEqual(
    win.base,
    info,
    "a marca nova vence uma chave `base` anterior",
  );

  assert.deepEqual(summarize([]), { n: 0, p50: null, p95: null, max: null });
  assert.deepEqual(summarize([5, 1, 3, 2, 4]), {
    n: 5,
    p50: 3,
    p95: 5,
    max: 5,
  });
});

/* ---------- thread de verdade (worker_threads) ---------- */

const FIXTURE = new URL(
  "./fixtures/analysis-fake-pipeline.mjs",
  import.meta.url,
);
const realWorker = (config = {}) =>
  createAnalysisWorker({
    spawn: workerSpawner({ pipeline: FIXTURE, init: { tag: "real" } }),
    restartDelayMs: 5,
    ...config,
  });

test(
  "thread real: ida e volta com bytes transferidos, contexto e base marcada",
  { timeout: 30_000 },
  async () => {
    const w = realWorker();
    try {
      w.setContext({ mark: "ctx1" });
      const t = w.submit({ op: "echo", n: 7, size: 300_000 }, { key: "a" });
      const out = await t.done;
      assert.equal(out.status, "ok");
      assert.ok(out.result.bytes instanceof Uint8Array);
      const body = parse(out.result.bytes);
      assert.equal(body.n, 7);
      assert.equal(body.tag, "real");
      assert.equal(body.mark, "ctx1");
      assert.equal(body.ctxRev, 1);
      assert.equal(body.filler.length, 300_000);
      assert.deepEqual(out.result.sideband, { n: 7 });
      assert.deepEqual(
        out.metrics.stages.map(([name]) => name),
        ["eco", "serializar"],
      );

      // Pipeline que já devolve JSON em texto.
      const raw = await w.submit({ op: "raw", n: 5 }, { key: "b" }).done;
      assert.deepEqual(parse(raw.result.bytes), { raw: 5 });

      // Erro do pipeline não derruba a thread.
      const bad = await w.submit({ op: "throw" }, { key: "c" }).done;
      assert.equal(bad.status, "error");
      assert.match(bad.error.message, /falha-de-teste/);
      const next = await w.submit({ op: "echo", n: 8 }, { key: "d" }).done;
      assert.equal(
        parse(next.result.bytes).runs,
        4,
        "a mesma thread atendeu os quatro",
      );

      const stamped = parse(w.responseBytes(next).bytes);
      assert.equal(stamped.base.stale, false);
      assert.equal(stamped.base.baseAge, 0);
    } finally {
      await w.close();
    }
  },
);

test(
  "thread real: laço sem fim estoura o timeout, a thread é recriada e atende de novo",
  { timeout: 30_000 },
  async () => {
    const w = realWorker({ timeoutMs: 1500 });
    try {
      w.setContext({ mark: "depois" });
      const stuck = w.submit({ op: "spin" }, { key: "a" });
      const out = await stuck.done;
      assert.equal(out.status, "timeout");
      const after = await w.submit({ op: "echo", n: 1 }, { key: "b" }).done;
      assert.equal(after.status, "ok");
      const body = parse(after.result.bytes);
      assert.equal(body.runs, 1, "thread nova, estado novo");
      assert.equal(body.mark, "depois", "contexto reenviado à thread nova");
      assert.equal(w.stats().counters.timeouts, 1);
      assert.equal(w.stats().counters.restarts, 1);
    } finally {
      await w.close();
    }
  },
);

test(
  "thread real: saída inesperada vira `crashed` e a thread volta",
  { timeout: 30_000 },
  async () => {
    const w = realWorker();
    try {
      const dead = await w.submit({ op: "exit" }, { key: "a" }).done;
      assert.equal(dead.status, "crashed");
      const after = await w.submit({ op: "echo", n: 2 }, { key: "b" }).done;
      assert.equal(after.status, "ok");
      assert.equal(parse(after.result.bytes).runs, 1);
      assert.equal(w.stats().counters.crashes, 1);
    } finally {
      await w.close();
    }
  },
);
