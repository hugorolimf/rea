// Prova de pureza: roda cada cenario do golden com o grafo em modo `verify` (cada fato roda 2x, a saida e congelada e a
// mutacao de entrada acusa IMPURE) e confere que a resposta e a mesma do modo normal.
//   node scripts/golden-verify.mjs
import {
  canonical,
  diffPaths,
  loadContext,
  loadSnapshots,
  runScenario,
} from "../tests/golden/harness.mjs";
import { scenarios } from "../tests/golden/scenarios.mjs";

const ctx = await loadContext(),
  snapshots = loadSnapshots();
let bad = 0;
for (const sc of scenarios) {
  try {
    const a = runScenario(ctx, sc, snapshots).map((o) =>
        canonical({ ...o.response, switched: o.switched }),
      ),
      b = runScenario(ctx, sc, snapshots, { verify: true }).map((o) =>
        canonical({ ...o.response, switched: o.switched }),
      ),
      d = diffPaths(a, b, 5);
    console.log(
      `${d.length ? "DIFERE" : "ok    "} ${sc.id}${d.length ? "\n  " + d.join("\n  ") : ""}`,
    );
    if (d.length) bad++;
  } catch (e) {
    bad++;
    console.log(`ERRO   ${sc.id}: ${e.message.split("\n")[0]}`);
  }
}
process.exit(bad ? 1 : 0);
