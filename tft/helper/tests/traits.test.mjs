// Rodar com: node --test tft/helper/tests/traits.test.mjs
// Emblemas equipados contam para a sinergia: regra única (v2/js/traits.js) vista pelo motor, pelo plano
// (tactics) e pela interface, com o catálogo real do set.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyze } from "../engine.mjs";
import { tactics } from "../tactics.mjs";
import {
  countTraits,
  emblemTraitMap,
  traitsWithEmblems,
  unmappedEmblems,
} from "../v2/js/traits.js";
import { activeTraits } from "../v2/js/history.js";
import { loadComps } from "../meta-comps.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  catalog = JSON.parse(readFileSync(path.join(root, "catalog.json"), "utf8")),
  { comps } = await loadComps(root, "TFTSet18", catalog),
  traitNames = catalog.traits.map((t) => t.name),
  emblems = emblemTraitMap(catalog.items, traitNames),
  byName = new Map(catalog.champions.map((c) => [c.name, c])),
  HERO = 1;

const piece = (name, itemNames = [], starLevel = 1) => {
  const c = byName.get(name);
  assert.ok(c, `campeão ${name} no catálogo`);
  return { championName: c.apiName, starLevel, itemNames, price: c.cost };
};
const snapshot = (boardPieces) => ({
  gameId: 1,
  statsBlock: {
    setCoreName: "TFTSet18",
    players: [{ playerId: HERO, health: 60, ffaStanding: 1, boardPieces }],
  },
});
const options = {
  level: 8,
  targetLevel: 8,
  gold: 30,
  bench: [],
  inventory: [],
  playerId: String(HERO),
};
/** Análise do motor mais o plano do que está em campo, como o servidor entrega. */
const plan = (pieces) => {
  const analysis = tactics(
    analyze(snapshot(pieces), catalog, options),
    catalog,
    options,
  );
  return {
    units: analysis.self.units,
    trait: (name) => analysis.currentPlan.traits.find((t) => t.name === name),
  };
};

const DEFENDER_EMBLEM = "DA_18_EmblemDefender";

test("3 Defenders + 1 campeão sem Defender com emblema = 4 Defenders", () => {
  const three = [piece("Ornn"), piece("Lillia"), piece("Rammus")];
  assert.ok(byName.get("Vi").traits.every((t) => t !== "Defender"));
  assert.equal(plan([...three, piece("Vi")]).trait("Defender").count, 3);
  const withEmblem = plan([...three, piece("Vi", [DEFENDER_EMBLEM])]);
  assert.equal(withEmblem.trait("Defender").count, 4);
  assert.equal(withEmblem.trait("Defender").emblem, 1);
  const vi = withEmblem.units.find((u) => u.name === "Vi");
  assert.ok(vi.traits.includes("Defender"));
  assert.deepEqual(vi.emblemTraits, ["Defender"]);
});

test("emblema do mesmo traço num campeão que já o tem não soma de novo", () => {
  const board = [
    piece("Ornn", [DEFENDER_EMBLEM, DEFENDER_EMBLEM]),
    piece("Lillia"),
  ];
  const p = plan(board);
  assert.equal(p.trait("Defender").count, 2);
  assert.equal(p.trait("Defender").emblem, 0);
  assert.deepEqual(p.units[0].emblemTraits, []);
  // Dois emblemas iguais num campeão sem o traço também dão só uma unidade.
  assert.equal(
    plan([piece("Vi", [DEFENDER_EMBLEM, DEFENDER_EMBLEM])]).trait("Defender")
      .count,
    1,
  );
});

test("todo emblema do catálogo soma seu traço a quem não o tem e não duplica em quem já o tem", () => {
  const items = catalog.items.filter((i) => /Emblem/.test(i.apiName));
  const unmapped = unmappedEmblems(catalog.items, traitNames).map((i) => i.id);
  // Só o emblema que copia a sinergia mais ativa (sem sinergia fixa) pode ficar sem mapeamento.
  assert.ok(
    unmapped.every((id) => /Phantom/.test(id)),
    `sem mapeamento: ${unmapped}`,
  );
  const covered = [];
  for (const item of items) {
    const trait = emblems.get(item.apiName);
    if (!trait) continue;
    const without = catalog.champions.find(
        (c) => !c.traits.includes(trait) && !c.traits.includes("Avatar"),
      ),
      withTrait = catalog.champions.find(
        (c) => c.traits.includes(trait) && !c.traits.includes("Avatar"),
      );
    assert.ok(without && withTrait, `campeões de teste para ${trait}`);
    // Camada pura.
    assert.deepEqual(
      traitsWithEmblems(without.traits, [item.apiName], emblems).added,
      [trait],
    );
    assert.deepEqual(
      traitsWithEmblems(withTrait.traits, [item.apiName], emblems).added,
      [],
    );
    // Motor + plano, pela mesma entrada que o servidor usa.
    const base = plan([piece(withTrait.name)]).trait(trait).count,
      added = plan([
        piece(withTrait.name),
        piece(without.name, [item.apiName]),
      ]),
      dup = plan([piece(withTrait.name, [item.apiName])]);
    assert.equal(
      added.trait(trait).count,
      base + 1,
      `${item.apiName} em quem não tem ${trait}`,
    );
    assert.equal(added.trait(trait).emblem, 1);
    assert.equal(
      dup.trait(trait).count,
      base,
      `${item.apiName} em quem já tem ${trait}`,
    );
    assert.equal(dup.trait(trait).emblem, 0);
    covered.push(item.apiName);
  }
  assert.equal(covered.length, emblems.size);
  console.log(
    `emblemas cobertos: ${covered.length}; sem mapeamento: ${unmapped.join(", ") || "nenhum"}`,
  );
});

test("contagem pura: campeões distintos, cópias juntam os itens", () => {
  const units = [
    { id: "a", traits: ["Defender"] },
    { id: "b", traits: ["Defender"] },
    { id: "c", traits: ["Defender"] },
    { id: "d", traits: ["Hunter"], items: [DEFENDER_EMBLEM] },
    { id: "d", traits: ["Hunter"] },
  ];
  assert.equal(countTraits(units, emblems).get("Defender"), 4);
  assert.equal(countTraits(units, emblems).get("Hunter"), 1);
});

test("histórico: o tabuleiro final conta o emblema equipado", () => {
  const champions = new Map(
      catalog.champions.map((c) => [
        c.apiName,
        { traits: c.traits, cost: c.cost },
      ]),
    ),
    breakpoints = new Map(
      catalog.traits.map((t) => [t.name, t.effects.map((e) => e.minUnits)]),
    ),
    id = (n) => byName.get(n).apiName,
    units = [
      { id: id("Ornn") },
      { id: id("Lillia") },
      { id: id("Rammus") },
      { id: id("Vi"), items: [DEFENDER_EMBLEM] },
    ],
    find = (list) => list.find((t) => t.name === "Defender");
  assert.equal(find(activeTraits(units, champions, breakpoints, 99)).count, 3);
  assert.equal(
    find(activeTraits(units, champions, breakpoints, 99, emblems)).count,
    4,
  );
});

test("motor e plano concordam na contagem de cada sinergia com emblema equipado", () => {
  const comp = comps.find(
    (c) =>
      c.units.filter((id) =>
        catalog.champions
          .find((x) => x.apiName === id)
          ?.traits.includes("Defender"),
      ).length >= 2,
  );
  assert.ok(comp, "comp de meta com Defenders");
  const members = comp.units.map((id) =>
      catalog.champions.find((c) => c.apiName === id),
    ),
    holder = members.find((c) => !c.traits.includes("Defender")),
    pieces = members.map((c) =>
      piece(c.name, c === holder ? [DEFENDER_EMBLEM] : []),
    ),
    opts = {
      ...options,
      metaComps: comps,
      previewIds: comp.units,
      goalCarryId: comp.carry,
    };
  const engineSide = analyze(snapshot(pieces), catalog, opts),
    planSide = tactics(analyze(snapshot(pieces), catalog, opts), catalog, opts);
  assert.ok(engineSide.recommendations.length > 0);
  engineSide.recommendations.forEach((r, i) => {
    const counts = new Map(r.traits.map((t) => [t.name, t.count]));
    // O motor lista só as sinergias que importam para o ranking; o plano lista todas. Onde ambos listam, iguais.
    for (const t of planSide.recommendations[i].traits)
      if (counts.has(t.name))
        assert.equal(t.count, counts.get(t.name), `${t.name} na comp ${i}`);
  });
  const preview = planSide.preview.traits.find((t) => t.name === "Defender");
  const expected = members.filter(
    (c) => c.traits.includes("Defender") || c === holder,
  ).length;
  assert.equal(preview.count, expected);
});

test("emblema no banco (ainda não equipado) vira oportunidade, não contagem", () => {
  const comp = comps.find((c) => c.units.length >= 6),
    members = comp.units.map((id) =>
      catalog.champions.find((c) => c.apiName === id),
    ),
    // Emblema de uma sinergia que nenhuma peça da comp tem: é a oportunidade de abrir uma sinergia nova.
    [bankEmblem, trait] = [...emblems].find(([, t]) =>
      members.every((c) => !c.traits.includes(t)),
    ),
    pieces = members.slice(0, 4).map((c) => piece(c.name)),
    analysis = analyze(snapshot(pieces), catalog, {
      ...options,
      metaComps: comps,
      inventory: [bankEmblem],
    });
  const offered = analysis.recommendations.flatMap((r) => r.emblems ?? []);
  assert.ok(
    offered.some((e) => e.id === bankEmblem && e.ready && e.trait === trait),
    `emblema pronto no banco (${trait}) aparece entre as opções da comp`,
  );
  // Sem equipar, nenhuma peça ganha o traço.
  for (const u of analysis.self.units) assert.deepEqual(u.emblemTraits, []);
});
