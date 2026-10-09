// Rodar com: node --test tft/helper/v2/js/
import test from "node:test";
import assert from "node:assert/strict";
import { activeTraits, placeTone, summarize, sortUnits } from "./history.js";

test("resumo ignora partidas sem colocação observada", () => {
  const s = summarize([
    { placement: 1 },
    { placement: 4 },
    { placement: 7 },
    { placement: null },
  ]);
  assert.equal(s.games, 4);
  assert.equal(s.placed, 3);
  assert.equal(s.average, 4);
  assert.equal(s.top4, 2 / 3);
  assert.equal(s.wins, 1);
  assert.equal(summarize([]).average, null);
});

test("tom da colocação", () => {
  assert.deepEqual([1, 3, 4, 5, 8, null].map(placeTone), [
    "win",
    "top",
    "top",
    "bottom",
    "bottom",
    "unknown",
  ]);
});

test("sinergias ativas contam cada campeão uma vez e respeitam os patamares", () => {
  const champions = new Map([
      ["a", { cost: 1, traits: ["Guarda", "Mago"] }],
      ["b", { cost: 4, traits: ["Guarda"] }],
      ["c", { cost: 2, traits: ["Mago"] }],
    ]),
    breakpoints = new Map([
      ["Guarda", [2, 4]],
      ["Mago", [3]],
    ]),
    units = [{ id: "a" }, { id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(activeTraits(units, champions, breakpoints), [
    { name: "Guarda", count: 2, tier: 1 },
  ]);
  assert.deepEqual(
    sortUnits(
      [
        { id: "a", stars: 3 },
        { id: "b", stars: 1 },
        { id: "c", stars: 2 },
      ],
      champions,
    ).map((u) => u.id),
    ["b", "c", "a"],
  );
});
