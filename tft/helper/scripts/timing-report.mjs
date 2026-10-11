// Resume as linhas TEMPO do server.log (instrumentação do M0 em server.mjs): por etapa de /api/recommend e por rota.
//
//   node scripts/timing-report.mjs [server.log] [--since 2026-10-10T23:30:00Z] [--until ...]
//
// Só lê o log; não fala com o servidor. As linhas de etapas ("POST /api/recommend estado=.. base=..") são uma por
// análise calculada (sem acerto no cache de resposta); as de resumo ("últimos N s") trazem p50/p95/máx por rota em
// janelas de ~1 min. ATENÇÃO: o tempo ao vivo inclui espera de rede (evidência do explorer na 1ª análise) e disputa de
// CPU com o jogo; compare sempre com `scripts/bench.mjs` (offline, sem rede).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  file =
    args.find((a) => !a.startsWith("--") && !/^\d{4}-/.test(a)) ??
    path.join(root, "server.log"),
  flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Date.parse(args[i + 1]) : null;
  },
  since = flag("since"),
  until = flag("until");

const q = (xs, p) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(xs.length * p))
  ];
const stages = new Map(),
  routes = new Map();
let analyses = 0;
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const m = /^(\S+) TEMPO\s+(.*)$/.exec(line);
  if (!m) continue;
  const at = Date.parse(m[1]);
  if ((since && at < since) || (until && at > until)) continue;
  const body = m[2];
  const detail = /^POST \/api\/recommend (.*) \(ms\)$/.exec(body);
  if (detail) {
    analyses++;
    for (const kv of detail[1].matchAll(/(\w+)=(\d+)/g)) {
      const list = stages.get(kv[1]) ?? [];
      list.push(Number(kv[2]));
      stages.set(kv[1], list);
    }
    continue;
  }
  for (const r of body.matchAll(
    /(GET|POST) (\S+) n=(\d+) p50=(\d+) p95=(\d+) max=(\d+)/g,
  )) {
    const key = `${r[1]} ${r[2]}`,
      list = routes.get(key) ?? { n: 0, p50: [], p95: [], max: [] };
    list.n += Number(r[3]);
    list.p50.push(Number(r[4]));
    list.p95.push(Number(r[5]));
    list.max.push(Number(r[6]));
    routes.set(key, list);
  }
}
console.log(`análises calculadas: ${analyses}`);
console.log(
  "etapa".padEnd(10),
  "n".padStart(4),
  "p50".padStart(8),
  "p95".padStart(8),
  "máx".padStart(8),
  " (ms)",
);
for (const [k, xs] of stages)
  console.log(
    k.padEnd(10),
    String(xs.length).padStart(4),
    String(q(xs, 0.5)).padStart(8),
    String(q(xs, 0.95)).padStart(8),
    String(Math.max(...xs)).padStart(8),
  );
console.log(
  "\nrota".padEnd(26),
  "reqs".padStart(5),
  "p50(med)".padStart(9),
  "p95(med)".padStart(9),
  "máx".padStart(8),
  " (janelas de ~1 min)",
);
for (const [k, v] of routes)
  console.log(
    k.padEnd(25),
    String(v.n).padStart(5),
    String(q(v.p50, 0.5)).padStart(9),
    String(q(v.p95, 0.5)).padStart(9),
    String(Math.max(...v.max)).padStart(8),
  );
