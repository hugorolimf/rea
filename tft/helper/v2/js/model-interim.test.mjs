// Rodar com: node --test tft/helper/v2/js/model-interim.test.mjs
// Formação com substitutos (core/board/interim.mjs, `plan.stage.slots`): a casa diz quem joga agora no lugar do original,
// tanto na comp recomendada quanto na fixada; a loja entra como possibilidade de compra; "+N na loja" na contagem.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel, formationChoice, slotView } from "./model.js";
import { compOwnership, rosterOf } from "./roster.js";

const base = JSON.parse(
  readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
);

/** Vaga temporária: Varus 2★ (em campo) joga no lugar de Aphelios (na reserva), volta em 2★. */
const tempSlot = {
  slot: 0,
  unit: { id: "DA_18_Aphelios", name: "Aphelios" },
  cell: null,
  original: {
    id: "DA_18_Aphelios",
    name: "Aphelios",
    cost: 4,
    stars: 1,
    have: "reserva",
    copies: 1,
    shop: null,
  },
  playing: {
    id: "DA_18_Varus",
    name: "Varus",
    cost: 1,
    stars: 2,
    source: "campo",
    items: [],
    buy: null,
  },
  kind: "temporario",
  why: "Varus 2★ supera Aphelios 1★",
  until: {
    kind: "estrela",
    stars: 2,
    need: 2,
    text: "volta quando Aphelios chegar a 2★ (faltam 2 cópias)",
  },
  replaces: null,
  delta: -2,
  ifBought: null,
};
/** Vaga a comprar: Xayah na loja (slot 3) entra na vaga dela. */
const shopSlot = {
  slot: 3,
  unit: { id: "DA_18_Xayah", name: "Xayah" },
  cell: null,
  original: {
    id: "DA_18_Xayah",
    name: "Xayah",
    cost: 1,
    stars: 0,
    have: "falta",
    copies: 0,
    shop: { slot: 3, cost: 1, buy: true },
  },
  playing: {
    id: "DA_18_Xayah",
    name: "Xayah",
    cost: 1,
    stars: 1,
    source: "loja",
    items: [],
    buy: { cost: 1, slot: 3 },
  },
  kind: "titular",
  why: "Na sua loja (slot 3): compre para a vaga livre",
  until: null,
  replaces: null,
  delta: null,
  ifBought: null,
};

const withSlots = (plan) => ({
  ...plan,
  stage: { ...plan.stage, slots: [tempSlot, shopSlot] },
});

test("slotView: temporário diz quem joga no lugar de quem e a volta; o original jogando não muda a casa", () => {
  const t = slotView(tempSlot);
  assert.equal(t.swapped, true);
  assert.equal(t.playing.id, "DA_18_Varus");
  assert.deepEqual(t.original, {
    id: "DA_18_Aphelios",
    name: "Aphelios",
    cost: 4,
  });
  assert.equal(
    t.label,
    "Varus 2★ no lugar de Aphelios (temporário: volta quando Aphelios chegar a 2★ (faltam 2 cópias)) · Aphelios fica guardado na reserva",
  );
  const s = slotView(shopSlot);
  assert.equal(s.swapped, false);
  assert.deepEqual(s.buy, { cost: 1, slot: 3 });
  assert.equal(
    s.label,
    "Na sua loja (slot 3): compre Xayah para a vaga de Xayah",
  );
  // Titular em campo: nada muda.
  assert.equal(
    slotView({
      ...shopSlot,
      playing: { ...shopSlot.playing, source: "campo", buy: null },
    }),
    null,
  );
  // Troca da comp e temporário comprado na loja.
  assert.equal(
    slotView({
      ...tempSlot,
      kind: "troca-da-comp",
      original: { ...tempSlot.original, have: "falta" },
    }).label,
    "troca da comp: Varus no lugar de Aphelios",
  );
  assert.equal(
    slotView({
      ...tempSlot,
      playing: {
        ...tempSlot.playing,
        source: "loja",
        buy: { cost: 1, slot: 2 },
      },
    }).label,
    "Na sua loja (slot 2): compre Varus como temporário no lugar de Aphelios",
  );
});

test("Recomendada com substituto: a casa de Aphelios mostra Varus no lugar dele; a de Xayah, a compra da loja", () => {
  const rec = structuredClone(base.rec);
  rec.recommendations[0] = withSlots(rec.recommendations[0]);
  const m = buildModel({ state: structuredClone(base.state), rec });
  assert.equal(m.plan.formation.shown, "recomendada");
  assert.equal(m.plan.formation.label, "Recomendada");
  const aph = m.plan.cells.find((c) => c.id === "DA_18_Aphelios"),
    xay = m.plan.cells.find((c) => c.id === "DA_18_Xayah");
  assert.equal(aph.sub.kind, "temporario");
  assert.equal(aph.sub.playing.id, "DA_18_Varus");
  assert.match(
    aph.sub.label,
    /^Varus 2★ no lugar de Aphelios \(temporário: volta quando/,
  );
  assert.equal(xay.sub.buy.slot, 3);
  // Peça sem vaga substituída: casa igual a antes.
  assert.equal(m.plan.cells.find((c) => c.id === "DA_18_Rakan").sub, null);
});

test("Fixada com substituto: a Formação mostra a fixada com o mesmo modelo por vaga e oferece 'ver recomendada'", () => {
  const rec = structuredClone(base.rec);
  rec.preview = withSlots(structuredClone(rec.recommendations[1]));
  rec.preview.stage.slots = [
    {
      ...tempSlot,
      unit: { id: rec.preview.board[0].id, name: rec.preview.board[0].name },
      original: {
        ...tempSlot.original,
        id: rec.preview.board[0].id,
        name: rec.preview.board[0].name,
      },
    },
  ];
  rec.goal = { id: "x", found: true, swaps: [] };
  const m = buildModel({ state: structuredClone(base.state), rec });
  assert.equal(m.status.pinned, true);
  assert.equal(m.plan.formation.shown, "fixada");
  const cell = m.plan.cells.find((c) => c.id === rec.preview.board[0].id);
  assert.equal(cell.sub.playing.id, "DA_18_Varus");
  const alt = m.plan.formation.alt;
  assert.equal(alt.which, "recomendada");
  assert.equal(alt.label, "ver recomendada");
  assert.equal(alt.title, rec.recommendations[0].title);
  // A recomendada desta análise não trouxe `stage.slots`: a outra vista diz o que falta, sem inventar substitutos.
  assert.deepEqual(alt.missing, ["vagas (stage.slots)"]);
});

test("sem fixada e com o plano mantido à frente da 1ª: 'ver 1ª sugerida' com a nota do plano mantido", () => {
  const rec = structuredClone(base.rec);
  const first = rec.recommendations[1];
  rec.recommendations[0].switch = {
    kept: true,
    held: false,
    toId: first.meta?.id ?? first.freeId,
    to: first.title,
    expectedFrom: 4.2,
    expectedTo: 3.9,
    gain: 0.3,
    cost: 0.4,
    hysteresis: 0.1,
    unit: "placement",
  };
  const choice = formationChoice(rec, rosterOf({ units: rec.self.units }));
  assert.equal(choice.shown, "recomendada");
  assert.equal(choice.alt.which, "sugerida");
  assert.equal(choice.alt.label, "ver 1ª sugerida");
  assert.equal(choice.alt.title, first.title);
  assert.ok(choice.alt.cells.length > 0);
  assert.match(choice.note, /^Mantido: /);
  // A 1ª sugerida fora dos planos analisados: diz o que falta.
  rec.recommendations[0].switch.toId = "nao-analisada";
  assert.deepEqual(formationChoice(rec, null).alt.missing, [
    "a 1ª sugerida não veio entre os planos desta análise",
  ]);
  // Sem plano mantido nem fixada: sem seletor.
  delete rec.recommendations[0].switch;
  assert.equal(formationChoice(rec, null).alt, null);
});

test("contagem da comp: '+N na loja' só com a loja do GEP lida; sem ela nada é inventado", () => {
  const units = [{ championName: "DA_18_Varus", starLevel: 2 }],
    ids = ["DA_18_Varus", "DA_18_Aphelios", "DA_18_Xayah", "DA_18_Rakan"];
  const seen = {
    sources: { bench: "gep", shop: "gep" },
    gepBench: [{ id: "DA_18_Aphelios", stars: 1 }],
    shop: [{ id: "DA_18_Xayah" }, { id: "DA_18_Varus" }, null],
  };
  const own = compOwnership(rosterOf({ units, seen }), ids);
  assert.equal(own.shop, 1); // Varus já é seu: a carta dele não conta como "na loja"
  assert.equal(own.text, "1/4 em campo · +1 na reserva · +1 na loja");
  const blind = compOwnership(
    rosterOf({ units, seen: { ...seen, sources: { bench: "gep" } } }),
    ids,
  );
  assert.equal(blind.shop, 0);
  assert.equal(blind.text, "1/4 em campo · +1 na reserva");
});
