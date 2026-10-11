// Tempo por etapa do pipeline de /api/recommend, offline (mesmos cenários do golden; não toca o servidor).
//
//   node scripts/bench.mjs [--runs 4] [--scenario id[,id]] [--event shop|gold] [--json]
//
// A 1ª execução de cada cenário é a "fria" (JIT e `SIMS` da rolagem vazios); as demais, "quente". Sem `--event`, cada
// execução recomeça do zero e inclui todos os passos do cenário (a base é recalculada: evento que a invalida).
// Com `--event`, o 1º passo roda duas vezes (plano adotado e base em cache) e se mede uma 3ª leitura em que muda só:
//   shop  a loja (não entra na chave da base: acerta o cache, só a tática refaz);
//   gold  -2 g (o ouro entra na chave da base: recalcula a base inteira, como uma rolagem).
// Evidência congelada: a medição é piso do custo ao vivo.
import {
  loadContext,
  loadSnapshots,
  newRun,
  resolveSteps,
  runStep,
} from "../tests/golden/harness.mjs";
import { scenarios } from "../tests/golden/scenarios.mjs";

const args = process.argv.slice(2),
  flag = (name) => args.includes(`--${name}`),
  value = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
const runs = Number(value("runs", 4)),
  only = value("scenario", null)?.split(","),
  asJson = flag("json"),
  event = value("event", null);

const STAGES = [
  "analyze",
  "clone",
  "tactics",
  "playbook",
  "stagePlan",
  "strategy",
  "planTrack",
  "augmentAdvice",
  "decide",
  "contest",
  "json",
];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const ctx = await loadContext(),
  snapshots = loadSnapshots(),
  picked = scenarios.filter((s) => !only || only.includes(s.id)),
  report = [];

for (const scenario of picked) {
  const rows = [];
  for (let n = 0; n < runs; n++) {
    const steps = resolveSteps(ctx, scenario, snapshots),
      run = newRun(ctx, Date.parse("2026-10-10T20:00:00Z")),
      stage = Object.fromEntries(STAGES.map((k) => [k, 0]));
    let bytes = 0,
      measured = steps;
    if (event) {
      const first = steps[0];
      runStep(ctx, run, first);
      runStep(ctx, run, first);
      const shopNow = first.seen.shop ?? [];
      measured = [
        {
          ...first,
          client:
            event === "gold"
              ? {
                  ...first.client,
                  gold: Math.max(0, (first.client.gold ?? 2) - 2),
                }
              : first.client,
          seen:
            event === "shop"
              ? { ...first.seen, shop: [...shopNow].reverse() }
              : first.seen,
        },
      ];
    }
    const total0 = performance.now();
    for (const step of measured) {
      const out = runStep(ctx, run, step, {
        time(label, fn) {
          const t0 = performance.now(),
            r = fn();
          stage[label] = (stage[label] ?? 0) + performance.now() - t0;
          return r;
        },
      });
      bytes = out.bytes;
      run.advance(30_000);
    }
    rows.push({ total: performance.now() - total0, bytes, ...stage });
  }
  report.push({
    scenario: scenario.id,
    steps: event ? 1 : (scenario.steps?.length ?? 1),
    cold: rows[0],
    warm: Object.fromEntries(
      ["total", "bytes", ...STAGES].map((k) => [
        k,
        median(rows.slice(1).map((r) => r[k])),
      ]),
    ),
  });
}

if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  const f = (x) =>
    (x == null || Number.isNaN(x) ? "-" : x.toFixed(1)).padStart(7);
  console.log(
    `${event ? `evento ${event}` : "cenário completo, base recalculada no 1º passo"}; ${runs} execuções por cenário (1ª fria, mediana das demais quente)`,
  );
  console.log(
    [
      "cenário".padEnd(24),
      "passos",
      "fria",
      "quente",
      "analyze",
      "tactics",
      "stage",
      "strategy",
      "json",
      "KB",
    ]
      .map((h, i) => (i === 0 ? h : h.padStart(7)))
      .join(" "),
  );
  for (const r of report)
    console.log(
      [
        r.scenario.padEnd(24),
        String(r.steps).padStart(7),
        f(r.cold.total),
        f(r.warm.total),
        f(r.warm.analyze),
        f(r.warm.tactics),
        f(r.warm.stagePlan),
        f(r.warm.strategy),
        f(r.warm.json),
        f(r.warm.bytes / 1024),
      ].join(" "),
    );
  const warm = report.map((r) => r.warm.total / r.steps);
  console.log(
    `por leitura (quente): mediana ${median(warm).toFixed(1)} ms, máx ${Math.max(...warm).toFixed(1)} ms`,
  );
}
