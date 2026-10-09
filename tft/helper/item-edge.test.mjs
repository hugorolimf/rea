// Rodar com: node --test tft/helper/item-edge.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { compBuildStats, itemEdge, shrunk, tierOf } from "./item-edge.mjs";

const comp = (builds, avg = 4.5) => ({
  avg,
  units: Object.keys(builds),
  buildStats: builds,
});
const build = (items, delta, n) => ({ items, delta, n });
const recipes = new Map([
  ["GS", ["Bow", "Sword"]],
  ["IE", ["Glove", "Sword"]],
]);

test("lê a melhor build de cada campeão do cluster da MetaTFT", () => {
  const b = compBuildStats({
    builds: [
      {
        unit: "R",
        buildName: ["A", "B", "C"],
        avg: 3.78,
        place_change: -0.243,
        count: 2127,
        score: 0.5,
      },
      {
        unit: "R",
        buildName: ["X", "Y", "Z"],
        avg: 3.1,
        place_change: -1,
        count: 10,
        score: 0.1,
      },
    ],
  });
  assert.deepEqual(b.R, {
    items: ["A", "B", "C"],
    avg: 3.78,
    delta: -0.24,
    n: 2127,
  });
});

test("encolhimento: build com poucas partidas quase não conta", () => {
  assert.ok(Math.abs(shrunk(build([], -1.8, 22))) < 0.03);
  assert.ok(Math.abs(shrunk(build([], -0.24, 2127)) + 0.14) < 0.01);
  assert.equal(shrunk(build([], Number.NaN, 100)), 0);
});

test("crédito parcial cresce com o quadrado da fração da build", () => {
  const c = comp({ K: build(["A", "B", "C"], -0.3, 6000) }); // abaixo do teto
  const full = itemEdge(c, { completed: ["A", "B", "C"] }),
    one = itemEdge(c, { completed: ["A"] });
  assert.ok(full.gain > 0);
  assert.ok(Math.abs(one.gain - full.gain / 9) < 0.01);
  assert.equal(itemEdge(c, { completed: [] }).gain, 0);
});

test("peso por campeão: tanque fora, carry inteiro, o total tem teto", () => {
  const c = comp({
    Carry: build(["A", "B", "C"], -2, 50000),
    Tank: build(["T1", "T2", "T3"], -2, 50000),
  });
  const w = (u) => (u === "Carry" ? 1 : 0);
  const e = itemEdge(
    c,
    { completed: ["A", "B", "C", "T1", "T2", "T3"] },
    new Map(),
    w,
  );
  assert.deepEqual(
    e.gains.map((g) => g.unit),
    ["Carry"],
  );
  assert.equal(e.gain, 0.4);
  assert.equal(e.adjustedAvg, 4.1);
});

test("componentes montam itens da build e cada componente serve a uma build só", () => {
  const c = comp({
    P: build(["GS"], -0.5, 6000),
    Q: build(["IE"], -0.4, 6000),
  });
  // Uma Espada só: monta o Matador (melhor build) e não sobra para o Gume.
  const e = itemEdge(
    c,
    { completed: [], components: ["Bow", "Sword", "Glove"] },
    recipes,
  );
  assert.deepEqual(
    e.gains.map((g) => [g.unit, g.craft]),
    [["P", ["GS"]]],
  );
});

test("tier pelas faixas do helper", () => {
  assert.deepEqual([4.1, 4.25, 4.3, 4.4, 4.5, 4.61].map(tierOf), [
    "S",
    "S",
    "A",
    "A",
    "B",
    "C",
  ]);
});
