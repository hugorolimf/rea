// Rodar com: node --test "tft/helper/v2/js/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { itemTiers } from "../../item-tiers.mjs";
import {
  COMPONENTS,
  attrMatrix,
  filterItems,
  formatStat,
  recipeGrid,
  statList,
  tierRows,
} from "./items.js";

// Mesmo dado que /api/items entrega: catálogo gerado + desempenho da cópia de meta.
const read = (f) =>
  JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"));
const items = itemTiers(
  read("items.json").items.filter((i) => i.kind !== "other"),
  read("meta-builds.json").items ?? {},
);
const byId = new Map(items.map((i) => [i.id, i]));
const names = new Map(items.map((i) => [i.id, i.name]));

test("atributos formatados como no jogo e na ordem da barra de status", () => {
  assert.equal(formatStat("AD", 35), "+35%");
  assert.equal(formatStat("AP", 15), "+15");
  assert.equal(formatStat("HP", 150.5), "+150,5");
  assert.deepEqual(
    statList(byId.get("DA_InfinityEdge")).map((s) => s.text),
    ["+35%", "+35%"],
  );
  assert.deepEqual(
    statList(byId.get("DA_InfinityEdge")).map((s) => s.key),
    ["AD", "Crit"],
  );
});

test("grade de receitas: simétrica, com o item certo em cada par", () => {
  const g = recipeGrid(items),
    at = (a, b) =>
      g.cells[COMPONENTS.indexOf(`DA_Component_${a}`)][
        COMPONENTS.indexOf(`DA_Component_${b}`)
      ];
  assert.equal(g.components.length, 10);
  assert.equal(at("BFSword", "SparringGloves")?.id, "DA_InfinityEdge");
  assert.equal(at("SparringGloves", "BFSword")?.id, "DA_InfinityEdge");
  assert.equal(at("BFSword", "BFSword")?.id, "DA_Deathblade");
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++)
      assert.equal(g.cells[r][c]?.id, g.cells[c][r]?.id);
  // Cada completo da categoria aparece na grade.
  const inGrid = new Set(
    g.cells
      .flat()
      .filter(Boolean)
      .map((i) => i.id),
  );
  for (const i of items.filter((x) => x.kind === "completed"))
    assert.ok(inGrid.has(i.id), i.id);
});

test("filtro: texto sem acento em pt-BR/inglês e componentes; atributos exigem todos", () => {
  const found = (q) => filterItems(items, { query: q }, names).map((i) => i.id);
  assert.ok(found("gume infinito").includes("DA_InfinityEdge"));
  assert.ok(found("infinity edge").includes("DA_InfinityEdge"));
  assert.ok(
    found("lagrima").includes("DA_Component_TearOfTheGoddess"),
    "sem acento casa Lágrima",
  );
  const adCrit = filterItems(items, {
    kind: "completed",
    attrs: ["AD", "Crit"],
  });
  assert.ok(adCrit.length >= 2);
  assert.ok(
    adCrit.every((i) => i.stats.AD && i.stats.Crit && i.kind === "completed"),
  );
});

test("faixas de tier: S a D pela média encolhida; sem dados vai para o fim", () => {
  const rows = tierRows(items.filter((i) => i.kind === "completed"));
  assert.deepEqual(
    rows.slice(0, 5).map((r) => r.tier),
    ["S", "A", "B", "C", "D"],
  );
  for (const r of rows.slice(0, 5))
    for (let k = 1; k < r.items.length; k++)
      assert.ok(r.items[k - 1].perf.post <= r.items[k].perf.post);
  const total = rows.reduce((n, r) => n + r.items.length, 0);
  assert.equal(total, items.filter((i) => i.kind === "completed").length);
});

test("matriz de atributos: ordena pela coluna escolhida e guarda o máximo de cada coluna", () => {
  const m = attrMatrix(
    items.filter((i) => i.kind === "completed"),
    "AP",
  );
  const ap = m.rows.map((i) => i.stats.AP ?? -Infinity);
  for (let k = 1; k < ap.length; k++) assert.ok(ap[k - 1] >= ap[k]);
  assert.equal(
    m.columns.find((c) => c.key === "AP").max,
    Math.max(...ap.filter(Number.isFinite)),
  );
  assert.ok(m.columns.every((c) => c.max > 0));
});
