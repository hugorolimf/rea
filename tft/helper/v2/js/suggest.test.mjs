// Rodar com: node --test tft/helper/v2/js/
// Lógica pura do modal da célula "Meta" do HUD (suggest.js) e o que o HUD lê do modelo para abri-lo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel } from "./model.js";
import {
  SUGGESTION_COUNT,
  choiceState,
  keepIndex,
  navKey,
  positionLabel,
  stepIndex,
  suggestionIds,
} from "./suggest.js";

// Ranking como o motor devolve: posição final (`rank`), as 3 sugeridas marcadas e o resto avaliado.
const ranking = [
  { id: "c1", rank: 1, suggested: true, score: 71, best: true },
  { id: "c5", rank: 5, suggested: false, score: 40 },
  { id: "c3", rank: 3, suggested: true, score: 58 },
  { id: "c2", rank: 2, suggested: true, score: 64 },
  { id: "c4", rank: 4, suggested: false, score: 52 },
];
const known = new Set(["c1", "c2", "c3", "c4", "c5", "c6"]);

test("sugestões: as marcadas pelo motor, na ordem final dele, abrindo na comp do Ao vivo", () => {
  const r = suggestionIds({ ranking, knownIds: known, planId: "c2" });
  assert.deepEqual(r.ids, ["c1", "c2", "c3"]);
  assert.equal(r.ids.length, SUGGESTION_COUNT);
  assert.equal(r.start, 1);
});

test("sem comp do Ao vivo conhecida, abre na primeira sugestão", () => {
  assert.equal(suggestionIds({ ranking, knownIds: known }).start, 0);
  // Plano que é um tabuleiro de vantagem fora da lista de meta (id desconhecido): não entra nem desloca a abertura.
  const r = suggestionIds({ ranking, knownIds: known, planId: "fora" });
  assert.deepEqual(r.ids, ["c1", "c2", "c3"]);
  assert.equal(r.start, 0);
});

test("comp fixada ou do Ao vivo fora das sugeridas entra à frente, sem duplicar", () => {
  let r = suggestionIds({
    ranking,
    knownIds: known,
    planId: "c4",
    goalId: "c4",
  });
  assert.deepEqual(r.ids, ["c4", "c1", "c2", "c3"]);
  assert.equal(r.start, 0);
  // Fixada com encaixe ruim, Ao vivo mostrando a fixada: a fixada vem à frente e é onde abre.
  r = suggestionIds({ ranking, knownIds: known, planId: "c5", goalId: "c5" });
  assert.deepEqual(r.ids, ["c5", "c1", "c2", "c3"]);
  // Fixada que o ranking nem avaliou (fit null) continua oferecida.
  r = suggestionIds({ ranking, knownIds: known, goalId: "c6" });
  assert.deepEqual(r.ids, ["c6", "c1", "c2", "c3"]);
  assert.equal(r.start, 0);
});

test("motor sem `suggested`: as primeiras do ranking; ids que não são comps de meta carregadas ficam de fora", () => {
  const old = ranking.map(({ suggested, ...r }) => r);
  assert.deepEqual(suggestionIds({ ranking: old, knownIds: known }).ids, [
    "c1",
    "c2",
    "c3",
  ]);
  const partial = suggestionIds({
    ranking,
    knownIds: new Set(["c2", "c3"]),
    planId: "c1",
  });
  assert.deepEqual(partial.ids, ["c2", "c3"]);
  assert.deepEqual(suggestionIds({ ranking: [], knownIds: known }), {
    ids: [],
    start: 0,
  });
  assert.deepEqual(suggestionIds({ ranking: null }), { ids: [], start: 0 });
});

test("manter a comp vista depois de uma atualização; senão voltar ao início sugerido", () => {
  const ids = ["c1", "c2", "c3"];
  assert.equal(keepIndex(ids, "c3", 1), 2);
  assert.equal(keepIndex(ids, "sumiu", 1), 1);
  assert.equal(keepIndex(ids, null, 2), 2);
  assert.equal(keepIndex(ids, null, 9), 2, "início fora da lista é limitado");
  assert.equal(keepIndex([], "c1", 0), 0);
});

test("setas dão a volta nas pontas", () => {
  assert.equal(stepIndex(0, -1, 3), 2);
  assert.equal(stepIndex(2, 1, 3), 0);
  assert.equal(stepIndex(1, 1, 3), 2);
  assert.equal(stepIndex(0, 1, 0), 0);
  assert.equal(navKey("ArrowLeft"), -1);
  assert.equal(navKey("ArrowRight"), 1);
  assert.equal(navKey("ArrowUp"), null);
  assert.equal(navKey("Enter"), null);
});

test("posição entre as sugestões, em texto", () => {
  assert.equal(positionLabel(0, 3), "1 de 3");
  assert.equal(positionLabel(2, 3), "3 de 3");
  assert.equal(positionLabel(0, 0), "sem sugestões");
});

test("estado da comp: escolhida (fixada), a do Ao vivo e sugerida", () => {
  assert.deepEqual(
    choiceState({ id: "c2", goalId: "c2", planId: "c2", ranking }),
    // A do Ao vivo (64) atrás da melhor sugestão (71): "Plano atual (mantido)".
    { chosen: true, live: true, suggested: true, best: false, kept: true },
  );
  assert.deepEqual(
    choiceState({ id: "c3", goalId: "c2", planId: "c2", ranking }),
    { chosen: false, live: false, suggested: true, best: false, kept: false },
  );
  assert.deepEqual(
    choiceState({ id: "c4", goalId: null, planId: "c1", ranking }),
    { chosen: false, live: false, suggested: false, best: false, kept: false },
  );
  assert.deepEqual(
    choiceState({ id: "c1", goalId: null, planId: "c2", ranking }),
    { chosen: false, live: false, suggested: true, best: true, kept: false },
  );
  // A do Ao vivo é a melhor: não está "mantida".
  assert.equal(choiceState({ id: "c1", planId: "c1", ranking }).kept, false);
  // Sem fixar nada, nenhuma comp está escolhida.
  assert.equal(choiceState({ id: null, goalId: null }).chosen, false);
});

test("o HUD abre o modal na comp do plano e o anel N/M é o progresso em campo, não a posição", () => {
  const { state, rec } = JSON.parse(
    readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
  );
  const model = buildModel({ state, rec });
  const planId = rec.recommendations[0].meta.id;
  assert.equal(model.plan.compId, planId);
  // "4/9" do anel = peças da comp em campo (stage.goalProgress), independentes do ranking.
  assert.deepEqual(model.plan.progress, {
    have: rec.recommendations[0].stage.goalProgress.onBoard,
    total: rec.recommendations[0].stage.goalProgress.goal,
  });
  const r = suggestionIds({
    ranking: rec.recommendations.map((p, i) => ({
      id: p.meta.id,
      rank: i + 1,
      suggested: true,
    })),
    planId: model.plan.compId,
  });
  assert.equal(r.ids[r.start], planId);
  // Com a comp fixada (preview), o plano e o id exibidos passam a ser os dela.
  const pinned = structuredClone(rec);
  pinned.goal = { found: true, swaps: [] };
  pinned.preview = structuredClone(rec.recommendations[1]);
  const m2 = buildModel({ state, rec: pinned });
  assert.equal(m2.status.pinned, true);
  assert.equal(m2.plan.compId, rec.recommendations[1].meta.id);
});
