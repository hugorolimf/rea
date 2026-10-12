// Rodar com: node --test tft/helper/tests/items-plan-targets.test.mjs
// Regra do usuário (motor único de itens, planos/feitos/itens-motor-unico.md): toda recomendação de item é só para os
// campeões da comp do plano (a fixada ou, sem ela, a recomendada). Peça fora da comp, em campo ou na reserva, não recebe
// build, "próximo item", item montado nem item do banco; o temporário de uma vaga só SEGURA um item da build do titular;
// componente sem uso na comp fica guardado e não vira item de outra peça.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tactics } from "../tactics.mjs";
import { buildItemPlan } from "../item-plan.mjs";
import {
  bankItemTargets,
  planBuildsOnly,
  planTargetIds,
} from "../core/items/scenarios.mjs";
import { loadContext } from "./golden/harness.mjs";

const catalog = JSON.parse(
  fs.readFileSync(new URL("../catalog.json", import.meta.url), "utf8"),
);
const ctx = await loadContext();
const byId = new Map(catalog.champions.map((c) => [c.apiName, c]));
const BF = "DA_Component_BFSword",
  GLOVE = "DA_Component_SparringGloves";

const compA = ctx.metaComps.comps.find((c) => c.id === "426001"),
  // Outra comp sem peça em comum com a A (a fixada do teste).
  compB = ctx.metaComps.comps.find(
    (c) =>
      c.carry &&
      c.builds?.[c.carry]?.length &&
      !c.units.some((u) => compA.units.includes(u)),
  ),
  // Peça fora das duas comps, em campo, com um componente equipado.
  outsider = catalog.champions.find(
    (c) =>
      c.cost <= 3 &&
      !compA.units.includes(c.apiName) &&
      !compB.units.includes(c.apiName) &&
      !c.traits.includes("Avatar"),
  );
const boardOf = (comp) =>
  comp.units.map((id) => {
    const c = byId.get(id);
    return {
      id,
      name: c.name,
      cost: c.cost,
      traits: c.traits,
      owned: false,
      stars: 1,
      items: [],
    };
  });
const unit = (id, items = []) => ({
  championName: id,
  name: byId.get(id).name,
  starLevel: 2,
  itemNames: items,
});

function analyze({ pinned = false } = {}) {
  const analysis = {
    self: {
      // O carry da comp A e a peça de fora estão em campo; a de fora leva um BF solto.
      units: [unit(compA.carry), unit(outsider.apiName, [BF])],
      reserve: [],
    },
    opponents: [],
    pool: [],
    recommendations: [
      {
        board: boardOf(compA),
        carry: byId.get(compA.carry).name,
        meta: compA,
      },
    ],
  };
  tactics(analysis, catalog, {
    metaBuilds: ctx.meta.builds,
    metaRoles: ctx.meta.roles,
    metaLabel: ctx.meta.label,
    stats: ctx.boardStats,
    // BF + Luva no banco: com o BF da peça de fora, monta Gume Infinito ou Gume Mortal.
    inventory: [BF, GLOVE],
    ...(pinned
      ? {
          previewIds: compB.units,
          goalComp: compB,
          goalCarryId: compB.carry,
        }
      : {}),
  });
  return analysis;
}

test("item recomendado só para campeões da comp: a peça de fora (com componente) não ganha build nem próximo item", () => {
  const a = analyze(),
    plan = a.recommendations[0],
    ids = planTargetIds(plan),
    advice = a.ownedItemAdvice;
  assert.ok(!compA.units.includes(outsider.apiName));
  // "Próximo item"/"Itens dos campeões" e "Equipar"/"Montar": só peças da comp.
  for (const b of advice.builds) assert.ok(ids.has(b.championId), b.championId);
  assert.ok(!advice.builds.some((b) => b.championId === outsider.apiName));
  for (const c of [...advice.ready, ...advice.near])
    assert.ok(ids.has(c.championId), `${c.championId}: ${c.item.id}`);
  // O carry da comp (em campo) recebe a build publicada da comp.
  const carry = advice.builds.find((b) => b.championId === compA.carry);
  assert.deepEqual(
    carry.ideal.map((i) => i.id),
    compA.builds[compA.carry].slice(0, 3),
  );
  // Plano, carrossel e "Passar itens": só peças da comp como alvo (a de fora só cede).
  for (const p of plan.itemPlans) assert.ok(ids.has(p.championId));
  for (const m of plan.itemMoves)
    for (const x of m.moves) assert.ok(ids.has(x.to.id), x.to.id);
  for (const pick of plan.carousel)
    for (const use of pick.uses) assert.ok(ids.has(use.championId));
  assert.deepEqual(
    planBuildsOnly([{ championId: outsider.apiName }], plan),
    [],
  );
});

test("comp fixada contra a recomendada: com a fixada, o alvo é a fixada; sem ela, a recomendada", () => {
  const free = analyze(),
    pinned = analyze({ pinned: true });
  const targets = (a) =>
    new Set(
      [...a.ownedItemAdvice.builds, ...a.ownedItemAdvice.ready].map(
        (b) => b.championId,
      ),
    );
  // Sem fixada: o carry da A (em campo) é alvo.
  assert.ok(targets(free).has(compA.carry));
  // Com a B fixada: nada da A nem a peça de fora recebe item; os alvos são peças da B.
  for (const id of targets(pinned))
    assert.ok(compB.units.includes(id), `${id} fora da comp fixada`);
  assert.ok(!targets(pinned).has(compA.carry));
  assert.ok(!targets(pinned).has(outsider.apiName));
  for (const p of pinned.preview.itemPlans)
    assert.ok(compB.units.includes(p.championId));
});

test("temporário segura o item da build do titular (o alvo continua sendo o titular)", () => {
  const out = bankItemTargets({
    items: ["DA_InfinityEdge", "DA_WarmogsArmor"],
    members: [
      // Titular ainda fora de campo; o carry em campo, sem vaga.
      { id: "T", name: "Aphelios", onField: false, room: 0, role: "ad" },
      { id: "C", name: "Xayah", onField: true, room: 0, role: "ad" },
    ],
    holders: [
      { id: "S", name: "Kog'Maw", room: 2, for: { id: "T", name: "Aphelios" } },
    ],
    wish: (id) => (id === "T" ? ["DA_Deathblade", "DA_InfinityEdge"] : []),
    roleOf: () => "flex",
    carry: "Xayah",
    nameOf: (id) => (id === "DA_InfinityEdge" ? "Gume Infinito" : "Warmog"),
  });
  assert.deepEqual(out[0].to, { id: "S", name: "Kog'Maw" });
  assert.deepEqual(out[0].for, { id: "T", name: "Aphelios" });
  assert.match(out[0].reason, /segure Gume Infinito em Kog'Maw para Aphelios/);
  // Item que nenhuma build da comp pede e ninguém da comp em campo com vaga: guarda (o temporário não leva).
  assert.equal(out[1].to, null);
  assert.match(out[1].reason, /guarde/);
});

test("item pronto do banco nunca vai para peça fora da comp, e a peça da comp que o pede vem primeiro", () => {
  const out = bankItemTargets({
    items: ["DA_InfinityEdge"],
    members: [
      { id: "A", name: "Aphelios", onField: true, room: 1, role: "ad" },
      { id: "X", name: "Xayah", onField: true, room: 3, role: "ad" },
    ],
    wish: (id) => (id === "A" ? ["DA_Deathblade", "DA_InfinityEdge"] : []),
    roleOf: () => "ad",
  });
  assert.equal(out[0].to.id, "A");
  assert.match(out[0].reason, /2º item de Aphelios na build da comp/);
});

test("componente sem uso na comp fica guardado: o plano de itens só monta itens da build publicada", () => {
  // Medido: Gume Infinito vale em B, mas a build publicada de B não o pede; A pede Gume Mortal.
  const value = {
    "A|DA_Deathblade": 0.1,
    "B|DA_InfinityEdge": 0.4,
    "B|DA_Deathblade": 0.05,
  };
  const valueOf = (u, id) =>
    value[`${u}|${id}`]
      ? {
          value: value[`${u}|${id}`],
          confidence: 1,
          samples: 9000,
          source: "par",
        }
      : null;
  const plan = buildItemPlan({
    units: [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
    ],
    bank: [BF, BF, GLOVE],
    recipes: new Map([
      ["DA_Deathblade", [BF, BF]],
      ["DA_InfinityEdge", [BF, GLOVE]],
    ]),
    valueOf,
    rankedOf: (u) =>
      Object.keys(value)
        .filter((k) => k.startsWith(`${u}|`))
        .map((k) => ({ id: k.split("|")[1], m: valueOf(u, k.split("|")[1]) })),
    buildOf: (u) =>
      u === "A" ? ["DA_Deathblade"] : u === "B" ? ["DA_WarmogsArmor"] : null,
  });
  const given = plan.assignments.map((x) => `${x.champion.id}:${x.item.id}`);
  // Sem a regra, B levaria o Gume Infinito (0,4). Com ela, só o Gume Mortal de A é montado; a Luva fica guardada.
  assert.deepEqual(given, ["A:DA_Deathblade"]);
});
