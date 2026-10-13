// Rodar com: node --test tft/helper/v2/js/board-look.test.mjs
// O que a casa da Formação desenha com substituto temporário, troca da comp e compra da loja (cell.sub, model.js slotView).
import test from "node:test";
import assert from "node:assert/strict";
import { cellLook, cellMarks } from "./board-look.js";

const cell = (over = {}) => ({
  id: "TFT_Aphelios",
  name: "Aphelios",
  row: 3,
  col: 3,
  cost: 4,
  stars: 1,
  status: "reserve",
  own: "",
  reason: "",
  swap: null,
  sub: null,
  ...over,
});

test("temporário: retrato de quem joga, estrelas e custo dele, original pequeno com o custo dele, selo de troca", () => {
  const label =
    "Varus 2★ no lugar de Aphelios (temporário: volta quando Aphelios chegar a 2★)";
  const look = cellLook(
    cell({
      sub: {
        kind: "temporario",
        swapped: true,
        playing: {
          id: "TFT_Varus",
          name: "Varus",
          stars: 2,
          cost: 2,
          source: "campo",
        },
        original: { id: "TFT_Aphelios", name: "Aphelios", cost: 4 },
        buy: null,
        until: "volta quando Aphelios chegar a 2★",
        label,
      },
    }),
  );
  assert.equal(look.image, "TFT_Varus");
  assert.equal(look.stars, 2);
  assert.equal(look.cost, 2);
  assert.deepEqual(look.original, { id: "TFT_Aphelios", cost: 4 });
  assert.equal(look.sub, "temporario");
  assert.equal(look.badge, "swap");
  assert.equal(look.buy, null);
  assert.ok(look.label.startsWith(label), look.label);
  assert.match(look.label, /no lugar de/);
  assert.match(look.label, /temporário/);
});

test("titular da loja: retrato do original, selo de compra com o preço, sem original no canto", () => {
  const look = cellLook(
    cell({
      status: "incoming",
      stars: 0,
      sub: {
        kind: "titular",
        swapped: false,
        playing: {
          id: "TFT_Aphelios",
          name: "Aphelios",
          stars: 0,
          cost: 4,
          source: "loja",
        },
        original: null,
        buy: { cost: 4, slot: 3 },
        until: null,
        label: "Na sua loja (slot 3): compre Aphelios para a vaga de Aphelios",
      },
    }),
  );
  assert.equal(look.image, "TFT_Aphelios");
  assert.equal(look.badge, "buy");
  assert.deepEqual(look.buy, { cost: 4, slot: 3 });
  assert.equal(look.sub, null);
  assert.equal(look.original, null);
  assert.equal(look.stars, 0);
  assert.match(look.label, /^Na sua loja \(slot 3\): compre/);
});

test("temporário comprado na loja: troca e compra juntas, a compra é o selo principal", () => {
  const look = cellLook(
    cell({
      sub: {
        kind: "temporario",
        swapped: true,
        playing: {
          id: "TFT_Varus",
          name: "Varus",
          stars: 1,
          cost: 2,
          source: "loja",
        },
        original: { id: "TFT_Aphelios", name: "Aphelios", cost: 4 },
        buy: { cost: 2, slot: 2 },
        until: null,
        label:
          "Na sua loja (slot 2): compre Varus como temporário no lugar de Aphelios",
      },
    }),
  );
  assert.equal(look.image, "TFT_Varus");
  assert.equal(look.sub, "temporario");
  assert.equal(look.badge, "buy");
  assert.equal(look.stars, 0, "a peça da loja ainda não é sua");
  assert.deepEqual(look.original, { id: "TFT_Aphelios", cost: 4 });
});

test("sem vaga (sub nulo): a casa desenha como sempre", () => {
  const owned = cellLook(cell({ status: "owned", stars: 2, cost: 4 }));
  assert.equal(owned.image, "TFT_Aphelios");
  assert.equal(owned.stars, 2);
  assert.equal(owned.cost, 4);
  assert.equal(owned.sub, null);
  assert.equal(owned.buy, null);
  assert.equal(owned.original, null);
  assert.equal(owned.badge, null);
  assert.equal(owned.label, "Aphelios 2★ · em campo");
  // A comprar: sem estrelas, como antes.
  assert.equal(cellLook(cell({ status: "incoming", stars: 1 })).stars, 0);
  // Troca do painel continua no rótulo.
  const swapped = cellLook(
    cell({
      status: "owned",
      swap: {
        kind: "hold",
        exit: { id: "TFT_Varus", name: "Varus" },
        have: 1,
        need: 3,
        held: 0,
      },
    }),
  );
  assert.equal(
    swapped.label,
    "Aphelios 1★ · em campo · segure: Varus sai (1/3)",
  );
});

// O antigo "Agora" e as "Substituições" no tabuleiro: a compra, a troca sugerida e a aplicada viram selos da casa.
const buyRow = (over = {}) => ({
  key: "buy:TFT_Aphelios",
  kind: "buy",
  unit: { id: "TFT_Aphelios", name: "Aphelios", cost: 4 },
  how: "bank",
  chance: 0.12,
  broke: false,
  ...over,
});
const flexOf = (pick) => ({
  id: "TFT_Aphelios",
  name: "Aphelios",
  cost: 4,
  options: pick ? [pick] : [],
  pick,
});

test("marcas da casa: compra, troca sugerida e aplicada por id; compra sem casa fica de fora", () => {
  const plan = {
    steps: [
      {
        id: "buy",
        rows: [
          buyRow(),
          buyRow({ unit: { id: "TFT_Fora", name: "Fora", cost: 1 } }),
        ],
      },
    ],
    subs: [flexOf({ id: "TFT_Varus", name: "Varus", cost: 2 })],
  };
  const { marks, loose } = cellMarks(
    plan,
    [cell(), cell({ id: "TFT_Ashe", name: "Ashe" })],
    [{ out: "TFT_Jinx", in: "TFT_Ashe" }],
  );
  assert.equal(marks.get("TFT_Aphelios").want.chance, 0.12);
  assert.equal(marks.get("TFT_Aphelios").flex.pick.id, "TFT_Varus");
  assert.equal(marks.get("TFT_Ashe").applied.out, "TFT_Jinx");
  assert.deepEqual(
    loose.map((r) => r.unit.id),
    ["TFT_Fora"],
  );
  // Outra comp à vista (sem plano): nenhuma marca, e as compras não têm onde cair.
  assert.equal(cellMarks(null, [cell()]).marks.size, 0);
});

test("casa com compra: fora da loja a chance por loja; na loja o selo de compra (cópia: a estrela que fecha)", () => {
  const out = cellLook(cell({ status: "incoming" }), { want: buyRow() });
  assert.deepEqual(out.want, { text: "12%", broke: false });
  assert.equal(out.buy, null);
  assert.match(out.label, /comprar \(12% por loja\), guardar no banco/);
  const now = cellLook(cell({ status: "incoming" }), {
    want: buyRow({ shop: { mark: "comprar 1 · #3" } }),
  });
  assert.equal(now.want, null);
  assert.equal(now.buy.cost, 4);
  assert.equal(now.badge, "buy");
  assert.match(now.label, /na loja agora: compre/);
  const copy = cellLook(cell({ status: "owned" }), {
    want: buyRow({
      how: "copy",
      copy: { next: 2, text: "→2★" },
      shop: { mark: "comprar 1" },
    }),
  });
  assert.equal(copy.buy.cost, "→2★");
  assert.equal(
    cellLook(cell(), { want: buyRow({ chance: 0.089, broke: true }) }).want
      .text,
    "8.9%",
  );
});

test("casa com troca: a sugerida com o retrato dela, sob pressão sem alternativa e a aplicada", () => {
  const sug = cellLook(cell(), {
    flex: flexOf({ id: "TFT_Varus", name: "Varus", cost: 2 }),
  });
  assert.deepEqual(sug.alt, { kind: "suggest", id: "TFT_Varus", cost: 2 });
  assert.match(sug.label, /troca sugerida: Varus/);
  assert.equal(cellLook(cell(), { flex: flexOf(null) }).alt.kind, "stuck");
  const done = cellLook(cell(), {
    applied: { out: "TFT_Jinx", in: "TFT_Aphelios" },
  });
  assert.equal(done.alt.kind, "applied");
  assert.equal(cellLook(cell()).alt, null);
});
