// Comp ajustada ao nível (core/comps/level-fit.mjs) com dados reais da MetaTFT gravados: no nível alto a vaga de apoio
// barata vira a alternativa mais forte medida nos tabuleiros da própria comp; a peça que você já tem forte fica.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { levelFitSwaps } from "../core/comps/level-fit.mjs";
import { traitBook } from "../core/catalog/traits.mjs";

const json = (f) =>
  JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const catalog = json("catalog.json");
const byId = new Map(catalog.champions.map((c) => [c.apiName, c]));
const ctx = (level, owned = {}) => ({
  level,
  owned: new Map(Object.entries(owned)),
  byId,
  book: traitBook(catalog),
  traitName: new Map(catalog.traits.map((t) => [t.apiName, t.name])),
  unitStats: {
    "DA_18_Ornn|1": [5.418, 145078],
    "DA_18_Ornn|2": [4.612, 762023],
    "DA_18_Ornn|3": [4.219, 530855],
    "DA_18_Zyra|1": [5.367, 349806],
  },
});
// Defender · Rengar (MetaTFT, 2026-10-12): no nível 8, os tabuleiros com Zyra no lugar de Ornn terminam melhor.
const board = (extra) => [
  "DA_18_Cassiopeia",
  "DA_18_Lillia",
  "DA_18_Rammus",
  "DA_18_Rengar",
  "DA_18_Shen",
  "DA_18_Soraka",
  "DA_Fiddlesticks18",
  extra,
];
const comp = {
  units: [
    "DA_18_Cassiopeia",
    "DA_18_Lillia",
    "DA_18_Ornn",
    "DA_18_Rammus",
    "DA_18_Rengar",
    "DA_18_Shen",
    "DA_18_Soraka",
    "DA_Fiddlesticks18",
  ],
  carry: "DA_18_Rengar",
  key: ["DA_18_Defender", "DA_18_Rengar"],
  options: {
    8: [
      { u: board("DA_18_Ornn"), n: 839, avg: 2.84 },
      { u: board("DA_18_Leona"), n: 370, avg: 2.86 },
      { u: board("DA_18_Zyra"), n: 120, avg: 2.3 },
    ],
  },
};

test("level-fit: nível 8 troca a peça barata pela alternativa mais forte nos tabuleiros da comp", () => {
  const swaps = levelFitSwaps(comp, ctx(8));
  assert.equal(swaps.length, 1);
  assert.equal(swaps[0].out, "DA_18_Ornn");
  assert.equal(swaps[0].in, "DA_18_Zyra");
  assert.equal(swaps[0].by, "nivel");
  assert.equal(swaps[0].source, "comp");
});

test("level-fit: abaixo do nível mínimo nada muda; carry nunca sai", () => {
  assert.deepEqual(levelFitSwaps(comp, ctx(4)), []);
  for (const s of levelFitSwaps(comp, ctx(9)))
    assert.notEqual(s.out, "DA_18_Rengar");
});

test("level-fit: a peça que você já tem 2★/3★ fica; 1★ ainda troca", () => {
  assert.deepEqual(levelFitSwaps(comp, ctx(8, { DA_18_Ornn: 2 })), []);
  assert.deepEqual(levelFitSwaps(comp, ctx(8, { DA_18_Ornn: 3 })), []);
  assert.equal(
    levelFitSwaps(comp, ctx(8, { DA_18_Ornn: 1 }))[0]?.in,
    "DA_18_Zyra",
  );
});

test("level-fit: alternativa barata para o nível (que você não tem) não entra", () => {
  const cheap = {
    ...comp,
    options: {
      8: [comp.options[8][0], { u: board("DA_18_Leona"), n: 400, avg: 2.0 }],
    },
  };
  assert.deepEqual(levelFitSwaps(cheap, ctx(8)), []);
});
