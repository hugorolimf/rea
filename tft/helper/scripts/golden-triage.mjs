// Triagem do golden: roda cada cenario e lista os CAMINHOS que diferem do esperado gravado, sem sobrescrever nada.
//   node scripts/golden-triage.mjs [id ...] [--raw] [--out=arquivo.json]
// Os caminhos sao agrupados trocando indices de lista por `*` (contagem + 1 exemplo esperado -> obtido).
import fs from "node:fs";
import {
  canonical,
  diffPaths,
  loadContext,
  loadSnapshots,
  readExpected,
  runScenario,
} from "../tests/golden/harness.mjs";
import { scenarios } from "../tests/golden/scenarios.mjs";

const args = process.argv.slice(2),
  ids = args.filter((a) => !a.startsWith("--")),
  out = args.find((a) => a.startsWith("--out="))?.slice(6);
const ctx = await loadContext(),
  snapshots = loadSnapshots();
const report = {};
/** Compara compRanking por id da comp (a ordem vira o caminho ): evita diferenca em cascata por troca de posicao. */
const byId = (doc) => {
  const o = structuredClone(doc);
  for (const k of Object.keys(o))
    if (k.startsWith('step') && Array.isArray(o[k].compRanking)) {
      const list = o[k].compRanking;
      o[k].compRanking = Object.fromEntries(list.map((r, i) => [r.id ?? i, r]));
      o[k].compRanking.__order = list.map((r) => r.id);
    }
  return o;
};
for (const sc of scenarios) {
  if (ids.length && !ids.includes(sc.id)) continue;
  const outputs = runScenario(ctx, sc, snapshots),
    got = {
      header: {
        id: sc.id,
        desc: sc.desc,
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
    },
    want = readExpected(sc.id),
    diffs = diffPaths(byId(want), byId(got), 1e9),
    groups = new Map();
  for (const d of diffs) {
    const at = d.indexOf(": "),
      path = d.slice(0, at),
      key = path.replace(/\.\d+(?=\.|$)/g, ".*");
    const g = groups.get(key) ?? { count: 0, example: d };
    g.count++;
    groups.set(key, g);
  }
  report[sc.id] = {
    total: diffs.length,
    groups: [...groups].map(([k, g]) => ({ path: k, ...g })),
  };
  console.log(
    `\n### ${sc.id}: ${diffs.length} diferencas, ${groups.size} grupos`,
  );
  for (const [k, g] of groups)
    console.log(
      `  ${String(g.count).padStart(5)}  ${k}\n         ${g.example.slice(0, 200)}`,
    );
}
if (out) fs.writeFileSync(out, JSON.stringify(report, null, 1));
