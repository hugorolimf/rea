// Rodar com: node --test tft/helper/v2/js/
// Itens do banco que combinam com o carry na aba Comps. Parametrizado sobre o catálogo real (catalog.json): todo tipo
// de item do banco cai em exatamente um destino e cada tipo tem a relação com o carry que o contrato descreve.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadComps } from "../../meta-comps.mjs";
import { compItems, emblemBases, equippedBy } from "./comp-items.js";
import { baseItemId } from "./comp-items.js";
import { emblemTraitMap } from "./traits.js";
import { isConsumable, kindOf } from "../../item-tiers.mjs";
// dom.js lê matchMedia ao carregar: um stub mínimo basta para importar a tela.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const { setCatalog } = await import("./ui/glyphs.js");
const { compItemsBlock } = await import("./ui/comps.js");

const read = (f) =>
  JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const catalog = read("../../catalog.json");
// Comps como o servidor as entrega em /api/comps (carry, título e builds resolvidos pelo catálogo).
const { comps: metaComps } = await loadComps(
  fileURLToPath(new URL("../../", import.meta.url)),
  "TFTSet18",
  catalog,
);
const trait = emblemTraitMap(
  catalog.items,
  catalog.traits.map((t) => t.name),
);
// Mesmo formato que /api/catalog entrega à interface (server.mjs).
const items = new Map(
  catalog.items.map((i) => [
    i.apiName,
    {
      id: i.apiName,
      name: i.name,
      composition: i.composition ?? [],
      kind: kindOf(i.apiName, i.composition ?? []),
      consumable: isConsumable(i.apiName),
      trait: trait.get(i.apiName) ?? null,
    },
  ]),
);
const champions = new Map(
  catalog.champions.map((c) => [
    c.apiName,
    { id: c.apiName, name: c.name, cost: c.cost, traits: c.traits },
  ]),
);
const breakpoints = new Map(
  catalog.traits.map((t) => [t.name, t.effects.map((e) => e.minUnits)]),
);
const ctx = (bank, extra = {}) => ({
  bank,
  items,
  champions,
  breakpoints,
  ...extra,
});

const COMP = "DA_Component_";
const byKind = (k) => [...items.values()].filter((i) => i.kind === k);
// Comp sintética: carry sem a sinergia T, dois colegas com ela (T fica ativa), builds dadas.
const withBuild = (build) => ({
  units: ["carry"],
  carry: "carry",
  builds: { carry: build },
});

// Todo item do banco tem um único destino: gasto em linha/emblema, sem uso ou excluído (consumível).
const placed = (r) => [
  ...r.units.flatMap((u) => u.rows.flatMap((x) => x.spent)),
  ...r.emblems.flatMap((e) => e.spent),
  ...r.unused.map((u) => u.id),
  ...r.excluded,
];

test("catálogo: cada tipo de item existe e o consumível é derivado do catálogo, não de lista fixa", () => {
  for (const k of [
    "component",
    "completed",
    "radiant",
    "artifact",
    "emblem",
    "other",
  ])
    assert.ok(byKind(k).length, `sem itens do tipo ${k}`);
  const cons = [...items.values()].filter((i) => i.consumable);
  assert.ok(cons.length >= 5);
  // Removedor, Duplicadores, Reforjador, Poções, Boosters, Melhoria do Mestre-Artesão e Baú da Sorte.
  for (const re of [/ItemRemover/, /Reforger/, /Potion/])
    assert.ok(
      cons.some((i) => re.test(i.id)),
      String(re),
    );
  for (const c of cons) assert.notEqual(c.kind, "completed", c.id);
});

test("todo item do catálogo, sozinho no banco, cai num só destino; consumível fica de fora da lista de sinergia", () => {
  const comp = withBuild(["DA_InfinityEdge"]);
  for (const [id, item] of items) {
    const r = compItems(comp, ctx([id]));
    assert.deepEqual(
      placed(r),
      [id],
      `${id} (${item.kind}) deve cair em exatamente um destino`,
    );
    if (item.consumable) {
      assert.deepEqual(r.excluded, [id], id);
      assert.equal(r.unused.length + r.emblems.length, 0, id);
      assert.ok(
        r.units.every((u) => u.rows.every((x) => x.spent.length === 0)),
        id,
      );
    } else assert.equal(r.excluded.length, 0, id);
  }
});

test("banco misto (vários tipos, repetidos): nenhum item some nem é contado duas vezes", () => {
  const sample = [
    "completed",
    "component",
    "radiant",
    "artifact",
    "emblem",
    "other",
  ].flatMap((k) =>
    byKind(k)
      .slice(0, 4)
      .map((i) => i.id),
  );
  const consumable = [...items.values()]
    .filter((i) => i.consumable)
    .slice(0, 3)
    .map((i) => i.id);
  const bank = [
    ...sample,
    ...sample.slice(0, 5),
    ...consumable,
    "DA_ItemQueNaoExiste",
  ];
  const comp = withBuild([sample[0], sample[4], sample[8]]);
  for (const c of [comp, metaComps[0], metaComps[7]]) {
    const full = c.units ? c : comp;
    const r = compItems(
      { ...full, units: full.units, builds: full.builds },
      ctx(bank),
    );
    assert.deepEqual([...placed(r)].sort(), [...bank].sort());
  }
});

test("completo da build: pronto no banco; o radiante equivale ao item base", () => {
  for (const item of byKind("completed").filter(
    (i) => i.composition.length === 2,
  )) {
    const row = compItems(withBuild([item.id]), ctx([item.id])).units[0]
      .rows[0];
    assert.equal(row.state, "ready", item.id);
  }
  let checked = 0;
  for (const rad of byKind("radiant")) {
    const base = baseItemId(rad.id);
    if (!items.has(base) || base === rad.id) continue;
    const row = compItems(withBuild([base]), ctx([rad.id])).units[0].rows[0];
    assert.equal(row.state, "radiant", rad.id);
    assert.deepEqual(row.spent, [rad.id]);
    checked++;
  }
  assert.ok(checked > 10, `radiantes com base no catálogo: ${checked}`);
});

test("componentes: os dois montam o item; um só diz o que falta; nenhum mostra a receita", () => {
  const made = byKind("completed").filter((i) => i.composition.length === 2);
  assert.ok(made.length > 30);
  for (const item of made) {
    const [a, b] = item.composition;
    assert.ok(a.startsWith(COMP) && b.startsWith(COMP), item.id);
    const both = compItems(withBuild([item.id]), ctx([b, a])).units[0].rows[0];
    assert.equal(both.state, "craft", item.id);
    assert.deepEqual([...both.spent].sort(), [a, b].sort());
    const one = compItems(withBuild([item.id]), ctx([a])).units[0].rows[0];
    assert.equal(one.state, "half", item.id);
    assert.deepEqual(one.have, [a]);
    assert.deepEqual(one.missing, [b]);
    const none = compItems(withBuild([item.id]), ctx([])).units[0].rows[0];
    assert.equal(none.state, "missing", item.id);
    assert.deepEqual(none.recipe, item.composition);
  }
});

test("artefato: só vale se a build o pede; não tem receita e fica 'não está no banco'", () => {
  for (const art of byKind("artifact")) {
    assert.equal(
      compItems(withBuild([art.id]), ctx([art.id])).units[0].rows[0].state,
      "ready",
      art.id,
    );
    const miss = compItems(withBuild([art.id]), ctx([COMP + "BFSword"]))
      .units[0].rows[0];
    assert.equal(miss.state, "missing", art.id);
    assert.deepEqual(miss.recipe, art.composition);
    const other = compItems(withBuild(["DA_InfinityEdge"]), ctx([art.id]));
    assert.equal(other.unused[0].kind, "artifact");
  }
});

test("emblema: dá ao carry uma sinergia ativa da comp que ele não tem; monta com Espátula/Frigideira", () => {
  const bases = emblemBases(items);
  assert.deepEqual([...bases].sort(), [COMP + "FryingPan", COMP + "Spatula"]);
  const emblems = byKind("emblem").filter((i) => i.trait);
  assert.ok(emblems.length > 10);
  let crafted = 0;
  for (const em of emblems) {
    // Carry sem a sinergia; dois colegas com ela: a sinergia fica ativa na comp.
    const lack = catalog.champions.filter((c) => !c.traits.includes(em.trait)),
      mates = catalog.champions
        .filter((c) => c.traits.includes(em.trait))
        .slice(0, 2);
    if (mates.length < 2) continue;
    const carry = lack[0].apiName,
      comp = {
        units: [carry, ...mates.map((m) => m.apiName)],
        carry,
        builds: { [carry]: ["DA_InfinityEdge"] },
      };
    const direct = compItems(comp, ctx([em.id]));
    assert.deepEqual(
      direct.emblems.map((e) => [e.id, e.trait, e.state]),
      [[em.id, em.trait, "ready"]],
      em.id,
    );
    assert.equal(direct.unused.length, 0, em.id);
    // O carry que já tem a sinergia não ganha nada com o emblema.
    const has = {
      units: [mates[0].apiName, mates[1].apiName],
      carry: mates[0].apiName,
      builds: { [mates[0].apiName]: ["DA_InfinityEdge"] },
    };
    const dup = compItems(has, ctx([em.id]));
    assert.equal(dup.emblems.length, 0, em.id);
    assert.equal(dup.unused[0].kind, "emblem");
    if (em.composition.length === 2) {
      const craft = compItems(comp, ctx([...em.composition]));
      assert.deepEqual(
        craft.emblems.map((e) => [e.id, e.state]),
        [[em.id, "craft"]],
        em.id,
      );
      const half = compItems(
        comp,
        ctx([em.composition.find((p) => bases.has(p))]),
      );
      // A Espátula/Frigideira serve a qualquer emblema útil da comp: o desta sinergia está entre os possíveis.
      const mine = half.emblems.find((e) => e.id === em.id);
      assert.equal(mine?.state, "half", em.id);
      assert.deepEqual(
        mine.missing,
        em.composition.filter((p) => !bases.has(p)),
        em.id,
      );
      crafted++;
    }
  }
  assert.ok(crafted >= 10, `emblemas com receita testados: ${crafted}`);
  // Emblema sem sinergia fixa (Fantasma) e item fora do catálogo ficam sem uso, com o motivo.
  const ghost = compItems(
    withBuild(["DA_InfinityEdge"]),
    ctx(["DA_PhantomEmblem18", "DA_ItemQueNaoExiste"]),
  );
  assert.deepEqual(
    ghost.unused.map((u) => u.kind),
    ["emblem", null],
  );
  assert.match(ghost.unused[1].reason, /fora do catálogo/);
});

test("emblema que a própria build do carry pede conta na linha da build, sem duplicar", () => {
  const comp = metaComps.find((c) =>
    c.builds[c.carry]?.some((i) => /Emblem/.test(i)),
  );
  assert.ok(comp, "alguma comp real pede emblema na build do carry");
  const em = comp.builds[comp.carry].find((i) => /Emblem/.test(i));
  const r = compItems(comp, ctx([em]));
  assert.equal(r.units[0].rows.find((x) => x.want === em).state, "ready");
  assert.equal(r.emblems.length, 0);
});

test("o carry primeiro: cada item do banco serve a uma peça só; equipado não gasta o banco", () => {
  const comp = {
    units: ["carry", "tank"],
    carry: "carry",
    builds: {
      carry: ["DA_InfinityEdge"],
      tank: ["DA_InfinityEdge", "DA_WarmogsArmor"],
    },
  };
  const r = compItems(
    comp,
    ctx(["DA_InfinityEdge"], { equipped: { tank: ["DA_WarmogsArmor"] } }),
  );
  assert.equal(r.units[0].rows[0].state, "ready");
  assert.deepEqual(
    r.units[1].rows.map((x) => x.state),
    ["missing", "on"],
  );
  assert.deepEqual(placed(r), ["DA_InfinityEdge"]);
  assert.deepEqual(
    equippedBy([
      { championName: "a", itemNames: ["x"] },
      { championName: "a", itemNames: ["y"] },
      { championName: "b", itemNames: [] },
      {},
    ]),
    { a: ["x", "y"] },
  );
});

test("sem leitura do banco (null): a build do carry aparece e nada é inventado", () => {
  const r = compItems(metaComps[0], ctx(null));
  assert.equal(r.read, false);
  assert.equal(r.units[0].unit, metaComps[0].carry);
  assert.ok(
    r.units[0].rows.every((x) => x.state === "missing" && !x.spent.length),
  );
  assert.deepEqual(r.excluded.concat(r.unused), []);
});

test("tela: o cartão mostra os itens do banco do carry, o que falta, emblemas e o aviso dos consumíveis", () => {
  setCatalog({ champions, items, traits: breakpoints, traitIcons: new Map() });
  // Comp real; banco com 1 pronto, 2 componentes de outro item, um consumível e um item sem uso.
  const comp = { ...metaComps[0], title: "x" },
    [first, second] = comp.builds[comp.carry].map((id) => items.get(id)),
    parts = second.composition;
  const bank = [
    first.id,
    parts[0],
    "DA_Consumable_ItemRemover",
    COMP + "Spatula",
    COMP + "Spatula",
  ];
  const html = compItemsBlock(compItems(comp, ctx(bank)), champions);
  assert.match(html, /Seus itens no carry/);
  assert.match(html, new RegExp(`data-state="ready"[^>]*title="${first.name}`));
  assert.match(html, /data-state="half"/);
  assert.match(html, /falta /);
  assert.match(html, /1 consumível fora da lista \(não é para montar\)/);
  const unread = compItemsBlock(compItems(comp, ctx(null)), champions);
  assert.match(unread, /banco não lido/);
  assert.doesNotMatch(unread, /data-state="ready"/);
});
