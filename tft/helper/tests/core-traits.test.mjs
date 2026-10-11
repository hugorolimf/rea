// Rodar com: node --test tft/helper/tests/core-traits.test.mjs
// M3: a regra de traços e emblemas mora em core/catalog/traits.mjs. Estes testes fixam que as funções do núcleo dão
// exatamente o que os laços antigos (engine.traits/legal/thresholdsOf/emblemRecipes, tactics.plan, history.activeTraits)
// davam, em milhares de tabuleiros sorteados com o catálogo real, e que o módulo continua carregável sem Node.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  countTraits,
  countUnitTraits,
  emblemRecipes,
  firstBreakpoint,
  emblemTraitMap,
  soloTraitNames,
  tallyTraits,
  traitBook,
  traitStatus,
  traitThresholds,
  traitsWithEmblems,
} from "../core/catalog/traits.mjs";
import { importsOf } from "./architecture/scan.mjs";
import { activeTraits } from "../v2/js/history.js";
import * as viaV2 from "../v2/js/traits.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  readFileSync(path.join(root, "catalog.json"), "utf8"),
);
const traitNames = catalog.traits.map((t) => t.name);
const emblemItems = catalog.items.filter((i) => /Emblem/.test(i.apiName));
const emblemIds = [...emblemTraitMap(catalog.items, traitNames).keys()];

/** Sorteio determinístico (mulberry32) para não depender de Math.random. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

/** Tabuleiros sorteados: 1 a 11 campeões distintos, cada um com 0 a 3 itens (emblemas, repetidos e itens comuns). */
function boards(count, seed = 7) {
  const rand = rng(seed),
    plain = catalog.items.filter((i) => !/Emblem/.test(i.apiName)),
    out = [];
  for (let n = 0; n < count; n++) {
    const size = 1 + Math.floor(rand() * 11),
      chosen = new Set();
    while (chosen.size < size) chosen.add(pick(rand, catalog.champions));
    out.push(
      [...chosen].map((c) => ({
        c,
        items: Array.from({ length: Math.floor(rand() * 4) }, () =>
          rand() < 0.5 ? pick(rand, emblemIds) : pick(rand, plain).apiName,
        ),
      })),
    );
  }
  return out;
}

/* ---------- Referências: os laços de antes da migração, copiados sem mudança ---------- */

function legacyEngine(board, augmentTraits) {
  const traitMap = new Map(catalog.traits.map((t) => [t.name, t]));
  const thresholdsOf = (name) =>
    (traitMap.get(name)?.effects ?? [])
      .map((e) => e.minUnits)
      .filter((n) => n <= 12);
  const emblemTrait = emblemTraitMap(catalog.items, traitMap.keys());
  const traitsOf = (b) =>
    traitsWithEmblems(b.c.traits, b.items, emblemTrait).traits;
  const soloOnly = new Set(
    catalog.traits
      .filter((t) => /Only active while fielding 1\b/i.test(t.desc ?? ""))
      .map((t) => t.name)
      .filter((n) => !(augmentTraits ?? []).includes(n)),
  );
  const legal = (bd) =>
    [...soloOnly].every(
      (n) => bd.filter((b) => traitsOf(b).includes(n)).length < 2,
    );
  const counts = {};
  for (const b of board)
    for (const t of traitsOf(b)) counts[t] = (counts[t] ?? 0) + 1;
  for (const n of soloOnly) if (counts[n] >= 2) delete counts[n];
  const traits = Object.entries(counts).map(([name, count]) => {
    const thresholds = thresholdsOf(name);
    const reached = thresholds.filter((n) => n <= count);
    return {
      name,
      count,
      active: reached.length > 0,
      solo: thresholds[0] === 1,
      tier: reached.length,
      next: thresholds.find((n) => n > count) ?? null,
    };
  });
  return { traits, legal: legal(board), thresholdsOf };
}

function legacyTactics(planned) {
  const traitNames = new Set(catalog.traits.map((t) => t.name));
  const emblemTrait = emblemTraitMap(catalog.items, traitNames);
  const counts = {},
    byEmblem = {};
  for (const u of planned) {
    const base = u.c.traits ?? [];
    for (const t of traitsWithEmblems(base, u.items, emblemTrait).traits) {
      counts[t] = (counts[t] ?? 0) + 1;
      if (!base.includes(t)) byEmblem[t] = (byEmblem[t] ?? 0) + 1;
    }
  }
  return Object.entries(counts).map(([name, count]) => {
    const t = catalog.traits.find((t) => t.name === name);
    return {
      name,
      count,
      emblem: byEmblem[name] ?? 0,
      active: (t?.effects ?? []).some((e) => e.minUnits <= count),
      next:
        (t?.effects ?? []).find((e) => e.minUnits > count)?.minUnits ?? null,
    };
  });
}

function legacyHistory(units, champions, breakpoints, limit, emblems) {
  const count = new Map(),
    items = new Map();
  for (const u of units)
    items.set(u.id, [...(items.get(u.id) ?? []), ...(u.items ?? [])]);
  for (const [id, equipped] of items)
    for (const t of traitsWithEmblems(
      champions.get(id)?.traits,
      equipped,
      emblems,
    ).traits)
      count.set(t, (count.get(t) ?? 0) + 1);
  return [...count]
    .map(([name, n]) => {
      const steps = breakpoints.get(name) ?? [];
      return { name, count: n, tier: steps.filter((m) => n >= m).length };
    })
    .filter((t) => t.tier > 0)
    .sort((a, b) => b.tier - a.tier || b.count - a.count)
    .slice(0, limit);
}

/* ---------- Equivalência com os laços antigos ---------- */

test("motor: summary, legal e thresholds do livro = engine.traits/legal/thresholdsOf de antes (com e sem liberar o traço solo)", () => {
  const solo = soloTraitNames(catalog.traits);
  assert.ok(
    solo.size >= 1,
    "o catálogo tem ao menos uma sinergia solo (Rival)",
  );
  for (const exempt of [[], [...solo]]) {
    const book = traitBook(catalog, { maxUnits: 12, exempt });
    for (const board of boards(1500)) {
      const ref = legacyEngine(board, exempt),
        units = board.map((b) => ({ traits: b.c.traits, items: b.items }));
      assert.deepEqual(book.summary(units), ref.traits);
      assert.equal(book.legal(units), ref.legal);
    }
    for (const t of catalog.traits)
      assert.deepEqual(
        book.thresholds(t.name),
        legacyEngine([], exempt).thresholdsOf(t.name),
      );
    assert.deepEqual(book.thresholds("Sinergia que não existe"), []);
  }
});

test("motor: dois campeões da sinergia solo a desligam, e o aprimoramento a libera", () => {
  const holders = catalog.champions.filter((c) => c.traits.includes("Rival"));
  assert.ok(holders.length >= 2, "o catálogo tem 2 campeões com Rival");
  const units = holders
    .slice(0, 2)
    .map((c) => ({ traits: c.traits, items: [] }));
  const locked = traitBook(catalog, { maxUnits: 12 }),
    freed = traitBook(catalog, { maxUnits: 12, exempt: ["Rival"] });
  assert.equal(locked.legal(units), false);
  assert.equal(locked.legal(units.slice(0, 1)), true);
  assert.ok(!locked.summary(units).some((t) => t.name === "Rival"));
  assert.equal(freed.legal(units), true);
  assert.equal(freed.summary(units).find((t) => t.name === "Rival").count, 2);
});

test("plano: tally + status = a contagem do tactics.plan de antes (count, emblem, active, next)", () => {
  const book = traitBook(catalog);
  for (const board of boards(1500, 11)) {
    const { counts, byEmblem } = book.tally(
      board.map((b) => ({ traits: b.c.traits ?? [], items: b.items })),
    );
    const got = [...counts].map(([name, count]) => {
      const { active, next } = book.status(name, count);
      return { name, count, emblem: byEmblem.get(name) ?? 0, active, next };
    });
    assert.deepEqual(got, legacyTactics(board));
  }
});

test("histórico: activeTraits (agora sobre countTraits) = o laço de antes", () => {
  const champions = new Map(catalog.champions.map((c) => [c.apiName, c])),
    breakpoints = new Map(
      catalog.traits.map((t) => [t.name, traitThresholds(t)]),
    ),
    emblems = emblemTraitMap(catalog.items, traitNames);
  const rand = rng(23);
  for (const board of boards(800, 5)) {
    // Cópias repetidas do mesmo campeão (itens de todas valem para ela) e itens ausentes.
    const units = board.flatMap((b) => {
      const copies = rand() < 0.3 ? 2 : 1;
      return Array.from({ length: copies }, (_, k) => ({
        id: b.c.apiName,
        items: k === 0 && rand() < 0.1 ? undefined : b.items,
      }));
    });
    for (const limit of [4, 20])
      assert.deepEqual(
        activeTraits(units, champions, breakpoints, limit, emblems),
        legacyHistory(units, champions, breakpoints, limit, emblems),
      );
  }
});

test("emblemRecipes = os dois filtros de antes (motor: DA_ + 2 componentes; plano: Emblem + 2 componentes + traço do set)", () => {
  const names = new Set(traitNames);
  const engineOld = catalog.items
    .filter(
      (i) =>
        i.apiName.startsWith("DA_") &&
        /Emblem/.test(i.apiName) &&
        i.composition?.length === 2,
    )
    .map((i) => ({
      id: i.apiName,
      name: i.name,
      trait: i.name.replace(/ Emblem$/, ""),
      parts: i.composition,
    }));
  const tacticsOld = new Map(
    catalog.items
      .filter((i) => /Emblem/.test(i.apiName) && i.composition?.length === 2)
      .map((i) => [i.name.replace(/ Emblem$/, ""), i])
      .filter(([name]) => names.has(name)),
  );
  const recipes = emblemRecipes(catalog.items, traitNames);
  assert.ok(recipes.length >= 15, "o set 18 tem 15+ emblemas montáveis");
  assert.deepEqual(recipes, engineOld);
  assert.deepEqual(
    new Map(recipes.map((e) => [e.trait, e.id])),
    new Map([...tacticsOld].map(([t, i]) => [t, i.apiName])),
  );
});

test("comps de meta: countUnitTraits e firstBreakpoint = os laços de comps.js e comp-items.js de antes", () => {
  const champions = new Map(catalog.champions.map((c) => [c.apiName, c]));
  const breakpoints = new Map(
    catalog.traits.map((t) => [t.name, traitThresholds(t)]),
  );
  const legacyCounts = (ids) => {
    const counts = new Map();
    for (const id of new Set(ids))
      for (const t of new Set(champions.get(id)?.traits ?? []))
        counts.set(t, (counts.get(t) ?? 0) + 1);
    return counts;
  };
  const legacyFirst = (name) =>
    Math.min(...(breakpoints.get(name)?.length ? breakpoints.get(name) : [2]));
  for (const board of boards(500, 3)) {
    // Ids repetidos e ids fora do catálogo também.
    const ids = [
      ...board.map((b) => b.c.apiName),
      board[0].c.apiName,
      "TFT_Fantasma",
    ];
    assert.deepEqual(
      [...countUnitTraits(ids, (id) => champions.get(id)?.traits)],
      [...legacyCounts(ids)],
    );
  }
  for (const t of [...catalog.traits.map((t) => t.name), "Sem patamar"])
    assert.equal(firstBreakpoint(breakpoints.get(t)), legacyFirst(t), t);
  assert.equal(firstBreakpoint(undefined), 2);
  assert.equal(firstBreakpoint([]), 2);
  assert.equal(firstBreakpoint([3, 5]), 3);
});

/* ---------- Casos da regra (fora dos laços antigos) ---------- */

test("traitStatus: patamares 2/4/6 com 5 peças", () => {
  assert.deepEqual(traitStatus([2, 4, 6], 5), {
    active: true,
    solo: false,
    tier: 2,
    next: 6,
  });
  assert.deepEqual(traitStatus([2, 4, 6], 1), {
    active: false,
    solo: false,
    tier: 0,
    next: 2,
  });
  assert.deepEqual(traitStatus([1, 1, 2], 2), {
    active: true,
    solo: true,
    tier: 3,
    next: null,
  });
  assert.deepEqual(traitStatus([], 3), {
    active: false,
    solo: false,
    tier: 0,
    next: null,
  });
});

test("traitThresholds respeita o teto de peças e tolera sinergia desconhecida", () => {
  const trait = {
    effects: [{ minUnits: 2 }, { minUnits: 9 }, { minUnits: 25 }],
  };
  assert.deepEqual(traitThresholds(trait), [2, 9, 25]);
  assert.deepEqual(traitThresholds(trait, 12), [2, 9]);
  assert.deepEqual(traitThresholds(undefined, 12), []);
});

test("countTraits: cópias do mesmo campeão contam uma vez e juntam os itens", () => {
  const emblems = new Map([["EmblemX", "X"]]);
  const counts = countTraits(
    [
      { id: "a", traits: ["Y"], items: [] },
      { id: "a", traits: ["Y"], items: ["EmblemX"] },
      { id: "b", traits: ["X", "Y"], items: ["EmblemX"] },
    ],
    emblems,
  );
  assert.deepEqual(
    [...counts],
    [
      ["Y", 2],
      ["X", 2],
    ],
  );
  assert.deepEqual(
    [...tallyTraits([{ traits: ["Y"], items: ["EmblemX"] }], emblems).byEmblem],
    [["X", 1]],
  );
});

/* ---------- Pureza e entrega ---------- */

test("v2/js/traits.js reexporta o núcleo (mesmas funções) e o módulo do núcleo não importa nada", () => {
  assert.equal(viaV2.emblemTraitMap, emblemTraitMap);
  assert.equal(viaV2.traitsWithEmblems, traitsWithEmblems);
  assert.equal(viaV2.countTraits, countTraits);
  assert.deepEqual(importsOf("core/catalog/traits.mjs"), []);
});

test("todo emblema do catálogo é visto como emblema montável ou como emblema sem receita (nenhum some)", () => {
  const recipes = new Set(
    emblemRecipes(catalog.items, traitNames).map((e) => e.id),
  );
  for (const i of emblemItems)
    assert.ok(
      recipes.has(i.apiName) || i.composition?.length !== 2,
      `${i.apiName}: emblema com receita de 2 componentes fora de emblemRecipes`,
    );
});
