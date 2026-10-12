// Rodar com: node --test tft/helper/v2/js/board-look.test.mjs
// O que a casa da Formação desenha com substituto temporário, troca da comp e compra da loja (cell.sub, model.js slotView).
import test from "node:test";
import assert from "node:assert/strict";
import { cellLook } from "./board-look.js";

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
