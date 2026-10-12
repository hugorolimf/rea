// Rodar com: node --test tft/helper/tests/interim-unify.test.mjs
// Uma só decisão de troca: antes, stage.mjs (Formação/compras) e tactics.mjs (trocas "Segure X até Y") tinham regras
// diferentes e se contradiziam no cenário real `danger-hp27` (a Formação punha uma peça da comp no lugar de Diana 2★
// enquanto as trocas seguravam Diana para outra peça). Agora as duas leem as vagas de core/board/interim.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadContext, loadSnapshots, runScenario } from "./golden/harness.mjs";
import { scenarios } from "./golden/scenarios.mjs";

const ctx = await loadContext(),
  snapshots = loadSnapshots();
const responseOf = (id) =>
  runScenario(
    ctx,
    scenarios.find((s) => s.id === id),
    snapshots,
  ).at(-1).response;
const plansOf = (r) => [
  ...r.recommendations,
  ...(r.preview ? [r.preview] : []),
];

for (const id of ["danger-hp27", "mid-lvl7-streak"])
  test(`${id}: Formação, trocas e compras dizem a mesma coisa em cada vaga`, () => {
    const r = responseOf(id);
    for (const plan of plansOf(r).filter((p) => p.stage?.slots)) {
      const slots = new Map(
        plan.stage.slots.filter((s) => s.unit).map((s) => [s.unit.id, s]),
      );
      // Cada peça fora da comp segura no máximo uma vaga.
      const holders = plan.stage.slots
        .filter((s) => s.kind === "temporario" && s.playing)
        .map((s) => s.playing.id);
      assert.equal(new Set(holders).size, holders.length);
      for (const t of plan.transitions) {
        const s = slots.get(t.enter.id);
        assert.ok(s, `${t.enter.name} sem vaga`);
        if (t.ready) assert.equal(s.playing.id, t.enter.id);
        else if (t.exit) {
          // "Segure S": S é quem joga na vaga de T na Formação.
          assert.equal(s.kind, "temporario");
          assert.equal(s.playing.id, t.exit.id);
        } else assert.equal(s.playing, null);
      }
      // A compra que diz "entra no lugar de S" troca justamente quem segura a vaga dela.
      for (const b of plan.stage.buyNow) {
        if (!b.replaces) continue;
        const s = slots.get(b.id);
        const out =
          s.playing?.id === b.id
            ? s.replaces?.name
            : s.ifBought?.replaces?.name;
        assert.equal(b.replaces, out, `${b.name}`);
      }
      // O tabuleiro de agora tem exatamente quem joga (sem as compras da loja).
      const playing = plan.stage.slots
        .filter((s) => s.playing && s.playing.source !== "loja")
        .map((s) => s.playing.id)
        .sort();
      assert.deepEqual(plan.stage.board.map((u) => u.id).sort(), playing);
    }
  });

test("danger-hp27: Diana 2★ segura uma vaga só, e nenhuma compra a tira de campo por uma peça 1★ mais fraca", () => {
  const plan = responseOf("danger-hp27").recommendations[0];
  const diana = plan.stage.slots.filter((s) => s.playing?.name === "Diana");
  assert.equal(diana.length, 1);
  assert.ok(!plan.stage.buyNow.some((b) => b.replaces === "Diana"));
  // Depois da correção do ranking no fim de jogo (sem prazo para montar, vale o que você já tem), o plano deste cenário
  // pode ser o próprio tabuleiro, com Diana titular; com outra comp, Diana segura a vaga de uma peça dela.
  if (plan.board.some((u) => u.name === "Diana"))
    assert.equal(diana[0].kind, "titular");
  else {
    assert.equal(diana[0].kind, "temporario");
    const t = plan.transitions.find((x) => x.exit?.name === "Diana");
    assert.equal(t.enter.id, diana[0].unit.id);
    assert.match(t.reason, /^Segure Diana 2★ \(temporário\): volta quando/);
  }
});
