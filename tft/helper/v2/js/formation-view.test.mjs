// Rodar com: node --test tft/helper/v2/js/formation-view.test.mjs
// Seletor da Formação: qual comp o tabuleiro mostra (Fixada/Recomendada e a outra), sem mexer no modelo.
import test from "node:test";
import assert from "node:assert/strict";
import { formationShown } from "./formation-view.js";

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

const cellOf = (id, name) => ({
  id,
  name,
  row: 0,
  col: 0,
  cost: 1,
  stars: 1,
  status: "owned",
  sub: null,
});

const pinnedPlan = () => ({
  title: "Comp fixada",
  cells: [cellOf("A", "Alfa")],
  traits: [{ name: "T1", count: 2, next: 4, active: true, emblem: 0 }],
  teamCode: "CODE-PIN",
  teamCodeError: null,
  counts: { ready: 1, hold: 0 },
  formation: {
    shown: "fixada",
    label: "Fixada",
    note: null,
    alt: {
      which: "recomendada",
      label: "ver recomendada",
      title: "Comp recomendada",
      compId: "rec-1",
      cells: [cellOf("B", "Beta"), cellOf("C", "Gama")],
      traits: [{ name: "T2", count: 3, next: null, active: true, emblem: 0 }],
      teamCode: "CODE-REC",
      teamCodeError: null,
      own: "1/2",
      missing: [],
    },
  },
});

test("fixada com a recomendada ao lado: padrão mostra a fixada; wantAlt mostra a recomendada; o plano não muda", () => {
  const plan = pinnedPlan(),
    before = structuredClone(plan);
  deepFreeze(plan);
  const base = formationShown(plan, false);
  assert.equal(base.label, "Fixada");
  assert.equal(base.title, "Comp fixada");
  assert.deepEqual(
    base.cells.map((c) => c.id),
    ["A"],
  );
  assert.equal(base.teamCode, "CODE-PIN");
  assert.deepEqual(base.missing, []);
  assert.deepEqual(base.toggle, { label: "ver recomendada", pressed: false });
  assert.equal(base.note, null);

  const alt = formationShown(plan, true);
  assert.equal(alt.label, "Recomendada");
  assert.equal(alt.title, "Comp recomendada");
  assert.deepEqual(
    alt.cells.map((c) => c.id),
    ["B", "C"],
  );
  // Pedido do usuário: com comp fixada, "Copiar código" copia a fixada mesmo vendo a recomendada (não a alternativa).
  assert.equal(alt.teamCode, "CODE-PIN");
  assert.equal(alt.traits[0].name, "T2");
  assert.deepEqual(alt.toggle, { label: "ver fixada", pressed: true });
  assert.deepEqual(plan, before);
});

test("sem outra comp: não há botão e wantAlt não muda nada", () => {
  const plan = deepFreeze({
    ...pinnedPlan(),
    formation: {
      shown: "recomendada",
      label: "Recomendada",
      note: null,
      alt: null,
    },
  });
  for (const want of [false, true]) {
    const v = formationShown(plan, want);
    assert.equal(v.toggle, null);
    assert.equal(v.label, "Recomendada");
    assert.equal(v.teamCode, "CODE-PIN");
  }
  assert.equal(formationShown(null, true), null);
});

test("1ª sugerida que a análise não trouxe: missing, nenhuma casa, nota de plano mantido e botão para voltar", () => {
  const plan = deepFreeze({
    ...pinnedPlan(),
    formation: {
      shown: "recomendada",
      label: "Recomendada",
      note: "Plano mantido: trocar renderia pouco",
      alt: {
        which: "sugerida",
        label: "ver 1ª sugerida",
        title: "Comp sugerida",
        cells: [],
        traits: [],
        teamCode: null,
        teamCodeError: null,
        own: "",
        missing: ["a 1ª sugerida não veio entre os planos desta análise"],
      },
    },
  });
  const base = formationShown(plan, false);
  assert.equal(base.note, "Plano mantido: trocar renderia pouco");
  assert.deepEqual(base.toggle, { label: "ver 1ª sugerida", pressed: false });
  const alt = formationShown(plan, true);
  assert.deepEqual(alt.missing, [
    "a 1ª sugerida não veio entre os planos desta análise",
  ]);
  assert.deepEqual(alt.cells, []);
  assert.equal(alt.label, "1ª sugerida");
  assert.equal(alt.teamCode, null);
  assert.deepEqual(alt.toggle, { label: "ver recomendada", pressed: true });
  assert.equal(alt.note, "Plano mantido: trocar renderia pouco");
});

test("outra comp com casas mas sem vagas na análise: missing esconde as casas", () => {
  const p = pinnedPlan();
  p.formation.alt.missing = ["vagas (stage.slots)"];
  const v = formationShown(deepFreeze(p), true);
  assert.deepEqual(v.cells, []);
  assert.deepEqual(v.missing, ["vagas (stage.slots)"]);
});
