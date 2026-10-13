// Correção pontual de carga ao vivo (planos/feitos/lentidao-ao-vivo.md): ceder o loop, fila das análises, teto de espera de
// rede da evidência, medição do loop e gravação espaçada do cache do explorer.
// Rodar com: node --test tests/live-load.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  evidenceStats,
  loadProbe,
  settleEvidence,
  turnLock,
  yieldToLoop,
} from "../app/live-load.mjs";
import { explorer } from "../evidence.mjs";

const fresh = (n) => ({
  conditionalRequests: Array.from({ length: n }, (_, i) => `c${i}`),
  evidenceRequests: [],
});

test("settleEvidence: sem perguntas pendentes não pergunta nada e guarda a base", async () => {
  let asked = 0,
    analyzed = 0;
  const committed = [];
  const out = await settleEvidence({
    analyzeNow: () => (analyzed++, fresh(0)),
    ask: async () => void asked++,
    budgetMs: 1000,
    commit: (f) => committed.push(f),
  });
  assert.equal(asked, 0);
  assert.equal(analyzed, 1);
  assert.deepEqual(committed, [out]);
});

test("settleEvidence: refaz a análise a cada rodada, no máximo 3, e guarda só o resultado final", async () => {
  let analyzed = 0,
    asked = 0;
  const stats = evidenceStats(),
    committed = [];
  await settleEvidence({
    // Sempre sobra pergunta: para na 3ª rodada (comportamento de antes do teto).
    analyzeNow: () => (analyzed++, fresh(2)),
    ask: async () => void asked++,
    budgetMs: 10_000,
    stats,
    commit: (f) => committed.push(f),
  });
  assert.equal(asked, 3);
  assert.equal(analyzed, 4, "1 inicial + 1 por rodada");
  assert.equal(stats.passes, 3);
  assert.equal(stats.asks, 6);
  assert.equal(stats.capped, 0);
  assert.equal(committed.length, 1);
  assert.match(stats.text(), /passes=3 perguntas=6 teto=0/);
});

test("settleEvidence: passado o teto de espera segue com o que chegou e deixa as perguntas abertas", async () => {
  let release;
  const stats = evidenceStats(),
    open = new Promise((resolve) => (release = resolve));
  const t0 = performance.now();
  const out = await settleEvidence({
    analyzeNow: () => fresh(1),
    ask: () => open,
    budgetMs: 40,
    stats,
  });
  const waited = performance.now() - t0;
  assert.ok(waited >= 30 && waited < 1000, `esperou ${waited} ms`);
  assert.equal(stats.capped, 1);
  assert.equal(
    out.conditionalRequests.length,
    1,
    "base não resolvida: o chamador não a guarda",
  );
  release();
});

test("settleEvidence: orçamento já gasto dispara as próximas perguntas sem esperar por elas", async () => {
  let asked = 0,
    analyzed = 0;
  const stats = evidenceStats();
  await settleEvidence({
    // A 2ª análise (depois da 1ª rodada) leva mais que o orçamento: a rodada seguinte só dispara, não espera.
    analyzeNow: () => {
      if (analyzed++ === 1)
        for (const t = performance.now(); performance.now() - t < 40;);
      return fresh(1);
    },
    ask: () => {
      asked++;
      return asked === 1 ? Promise.resolve() : new Promise(() => {});
    },
    budgetMs: 20,
    stats,
  });
  assert.equal(asked, 2);
  assert.equal(stats.passes, 1, "só a 1ª rodada foi esperada");
  assert.equal(stats.capped, 1);
});

test("turnLock: ordem FIFO, release idempotente e liberação automática", async () => {
  const lock = turnLock({ maxHoldMs: 50 }),
    order = [];
  const first = await lock();
  const second = lock().then((release) => (order.push("b"), release));
  const third = lock().then((release) => (order.push("c"), release));
  await yieldToLoop();
  assert.deepEqual(order, [], "a vaga está ocupada");
  order.push("a");
  first();
  first(); // idempotente
  (await second)();
  (await third)();
  assert.deepEqual(order, ["a", "b", "c"]);
  // Esquecer de liberar não trava a fila para sempre (o timer da vaga é unref: o teste mantém o processo vivo).
  const keepAlive = setTimeout(() => {}, 5000);
  await lock();
  const t0 = performance.now();
  (await lock())();
  clearTimeout(keepAlive);
  assert.ok(performance.now() - t0 < 1000);
});

test("yieldToLoop: deixa uma macrotarefa já agendada rodar antes de continuar", async () => {
  const seen = [];
  setImmediate(() => seen.push("imediato"));
  await yieldToLoop();
  seen.push("depois");
  assert.deepEqual(seen, ["imediato", "depois"]);
});

test("loadProbe: resume atraso do loop, CPU e memória em uma linha", async () => {
  const probe = loadProbe({ resolutionMs: 10 });
  await new Promise((r) => setTimeout(r, 60));
  const text = probe.sample();
  assert.match(
    text,
    /loop-lag p50=\d+ p99=\d+ max=\d+ \(ms\); cpu=\d+%; heap=\d+MB rss=\d+MB/,
  );
});

test("explorer: gravação do cache é atômica, igual ao JSON de antes e só acontece sob demanda/espaçada", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-")),
    file = path.join(dir, "evidence-cache.json"),
    realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => [
        {
          avg_placement: 4.2,
          total_games: 100,
          top4_percentage: 55.5,
          win_percentage: 14.25,
        },
      ],
    };
  };
  try {
    const ex = explorer(file, { minGapMs: 60_000 });
    assert.deepEqual(await ex.total(["unit=A"]), {
      avg: 4.2,
      games: 100,
      top4: 55.5,
      win: 14.25,
    });
    assert.ok(!fs.existsSync(file), "a gravação espera o lote (mín. 2 s)");
    await ex.flush();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(saved), ["total?unit=A"]);
    assert.deepEqual(saved["total?unit=A"].value, {
      avg: 4.2,
      games: 100,
      top4: 55.5,
      win: 14.25,
    });
    assert.ok(!fs.existsSync(`${file}.tmp`), "o temporário foi renomeado");
    assert.match(ex.takeStats(), /evidencia gravou=1 ms=\d+ KB=\d+/);
    assert.match(ex.takeStats(), /gravou=0/, "takeStats zera a janela");
    // Pergunta repetida vem do cache: nada de rede nem de nova gravação.
    await ex.total(["unit=A"]);
    assert.equal(calls, 1);
    // Um novo processo lê o que foi gravado.
    const again = explorer(file);
    await again.total(["unit=A"]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true });
  }
});
