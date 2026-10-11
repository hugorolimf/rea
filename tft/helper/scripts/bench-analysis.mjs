// Benchmark da análise pesada SEM abrir porta nem subir servidor: chama direto o pipeline (app/analysis-pipeline.mjs) no
// processo do script, e depois pela thread de análise (analysis-worker.mjs, uma `worker_thread`, não um servidor), medindo
// o que o usuário sente: quanto o event loop do processo "servidor" fica sem responder enquanto a análise roda, e quanto
// demora cada análise. A evidência é a congelada do golden (sem rede) e o tabuleiro é um cenário do golden.
//
//   node scripts/bench-analysis.mjs [--scenario items-bank-lvl8] [--runs 6] [--burn 0] [--json arquivo]
//
// `--burn N` roda N threads que só queimam CPU (imita a máquina de uma partida). Mede quatro modos:
//   principal  a análise roda no event loop deste processo (como o servidor era antes), cedendo o loop entre as etapas;
//   thread     a análise roda na thread de análise; o loop deste processo só espera mensagens;
//   e, nos dois, por tipo de mudança: "tudo" (aprimoramentos novos: a base é refeita), "ouro" (só o ouro mudou) e "xp" (só o
//   XP mudou: a base não depende dele e fica no grafo).
// O atraso do loop vem de um temporizador de 10 ms que registra o quanto cada disparo atrasou.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  assembleStep,
  loadContext,
  loadSnapshots,
  newRun,
  resolveSteps,
} from "../tests/golden/harness.mjs";
import { scenarios } from "../tests/golden/scenarios.mjs";
import { traitBook } from "../core/catalog/traits.mjs";
import { goldenPipeline } from "../tests/fixtures/analysis-golden-thread.mjs";
import { createAnalysisWorker, workerSpawner } from "../analysis-worker.mjs";
import { yieldToLoop } from "../app/live-load.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const scenarioId = value("scenario", "items-bank-lvl8"),
  runs = Number(value("runs", 6)),
  burn = Number(value("burn", 0)),
  jsonOut = value("json", null);

const q = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const ms = (x) => (x == null ? "-" : x.toFixed(0));

/** Atraso do event loop: um temporizador de 10 ms; o atraso de cada disparo vai para a lista. */
function lagProbe() {
  const lags = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - last - 10));
    last = now;
  }, 10);
  return {
    stop() {
      clearInterval(timer);
      return {
        p50: q(lags, 0.5),
        p99: q(lags, 0.99),
        max: lags.length ? Math.max(...lags) : null,
      };
    },
  };
}

const ctx = await loadContext();
ctx.traitRules = traitBook(ctx.catalog);
const scenario = scenarios.find((s) => s.id === scenarioId);
if (!scenario) throw Error(`Cenário desconhecido: ${scenarioId}`);
const [step] = resolveSteps(ctx, scenario, loadSnapshots());
const assembled = assembleStep(
  ctx,
  newRun(ctx, Date.parse("2026-10-10T20:00:00Z")),
  step,
);
const base = {
  snapshot: assembled.snapshot,
  options: assembled.options,
  chosen: assembled.chosen,
  goal: assembled.goal,
  augmentsFrom: null,
  gepPicked: {},
};
const context = {
  meta: ctx.meta,
  metaComps: ctx.metaComps,
  boardStats: ctx.boardStats,
  augmentStats: ctx.augmentStats,
};
const augmentPool = ctx.augmentList.filter((a) => a.id.startsWith("DA_"));

/** A entrada da n-ésima análise de cada tipo de mudança. */
const variant = (kind, n) => {
  const p = structuredClone(base);
  if (kind === "tudo") {
    p.chosen = [augmentPool[(n * 7) % augmentPool.length]];
    p.options.augments = p.chosen.map((a) => a.id);
  } else if (kind === "ouro")
    p.options.gold = (p.options.gold ?? 20) + 7 * (n + 1);
  else if (kind === "xp") p.options.xp = { cur: n + 1, need: 56 };
  return p;
};
const KINDS = ["tudo", "ouro", "xp"];

const burners = [];
for (let i = 0; i < burn; i++)
  burners.push(new Worker("for(;;){Math.sqrt(Math.random())}", { eval: true }));

async function measure(label, runOne) {
  const out = { label, kinds: {} };
  await runOne(variant("tudo", 99)); // aquece (JIT, histórico do grafo, evidência)
  for (const kind of KINDS) {
    const times = [];
    const probe = lagProbe();
    for (let n = 0; n < runs; n++) {
      const t0 = performance.now();
      await runOne(variant(kind, n));
      times.push(performance.now() - t0);
    }
    out.kinds[kind] = {
      ms: { p50: q(times, 0.5), max: Math.max(...times) },
      lag: probe.stop(),
    };
  }
  return out;
}

const result = { scenario: scenarioId, runs, burn, modes: [] };

{
  const pipeline = goldenPipeline(ctx, { yieldBetween: yieldToLoop });
  result.modes.push(
    await measure("principal (event loop)", (p) =>
      pipeline.compute(p, context),
    ),
  );
  pipeline.close();
}
{
  const worker = createAnalysisWorker({
    spawn: workerSpawner({
      pipeline: new URL(
        "../tests/fixtures/analysis-golden-thread.mjs",
        import.meta.url,
      ),
      init: { root },
    }),
    supersede: false,
    timeoutMs: 120_000,
    startTimeoutMs: 60_000,
  });
  worker.setContext(context);
  worker.start();
  result.modes.push(
    await measure("thread de análise", async (p) => {
      const out = await worker.resolve(worker.submit(p), { allowStale: false });
      if (out.status !== "ok")
        throw Error(`thread: ${out.status} ${out.error?.message ?? ""}`);
    }),
  );
  await worker.close();
}
for (const b of burners) await b.terminate();

console.log(
  `cenário ${scenarioId}; ${runs} análises por tipo; ${burn} threads queimando CPU`,
);
console.log(
  "modo                       mudança   análise p50/máx (ms)   atraso do loop p50 / p99 / máx (ms)",
);
for (const m of result.modes)
  for (const kind of KINDS) {
    const k = m.kinds[kind];
    console.log(
      `${m.label.padEnd(26)} ${kind.padEnd(8)}  ${ms(k.ms.p50).padStart(6)} / ${ms(k.ms.max).padStart(6)}        ${ms(k.lag.p50).padStart(5)} / ${ms(k.lag.p99).padStart(5)} / ${ms(k.lag.max).padStart(5)}`,
    );
  }
if (jsonOut)
  (await import("node:fs")).writeFileSync(
    jsonOut,
    JSON.stringify(result, null, 1),
  );
process.exit(0);
