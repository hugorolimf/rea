// Item que já existe em outra peça (a que sai da formação) não "falta": o plano e o próximo item o tratam como mover.
import test from "node:test";
import assert from "node:assert/strict";
import { stagePlan } from "../stage.mjs";
import { buildChecklist } from "../plan-progress.mjs";
import { makeState } from "./fixtures.mjs";

const catalog = {
  champions: [
    "Aphelios",
    "Amumu",
    "Xayah",
    "Diana",
    "Rakan",
    "Vi",
    "Sentinel",
    "Varus",
  ].map((name, i) => ({
    apiName: `TFT_${name}`,
    name,
    cost: (i % 4) + 1,
    traits: [],
  })),
  items: [],
};
const IE = { id: "DA_InfinityEdge", name: "Infinity Edge" };
const gloves = { id: "DA_Component_SparringGloves", name: "Sparring Gloves" };

function stageWith(itemMoves) {
  const s = makeState({ level: 8 });
  s.plan.itemMoves = itemMoves;
  s.analysis.ownedItemAdvice = {
    ready: [],
    builds: [
      {
        championId: "TFT_Aphelios",
        slotsFree: 2,
        additions: [{ ...IE, missing: [gloves] }],
      },
    ],
  };
  s.options.inventory = [];
  return stagePlan(s.plan, s.analysis, catalog, s.options).board.find(
    (u) => u.id === "TFT_Aphelios",
  );
}

test("Próximo item: item que a comp passa de quem sai não aparece com componente faltando", () => {
  const before = stageWith([]);
  assert.equal(before.nextItem.id, "DA_InfinityEdge");
  assert.deepEqual(before.nextItem.missing, ["Sparring Gloves"]);
  // A interface desenha a receita: ids do que falta e a situação das peças acompanham o item (só apresentação).
  assert.deepEqual(before.nextItem.missingIds, ["DA_Component_SparringGloves"]);
  assert.equal(before.nextItem.usesHeld, null);
  assert.ok(Array.isArray(before.nextItem.components));
  assert.equal(before.slotsFree, 2);
  const after = stageWith([
    {
      from: { id: "TFT_Vi", name: "Vi" },
      leaving: true,
      moves: [{ item: IE, to: { id: "TFT_Aphelios", name: "Aphelios" } }],
    },
  ]);
  assert.equal(
    after.nextItem,
    null,
    "o item já existe na peça que sai: é Passar itens, não falta",
  );
  assert.equal(after.slotsFree, 1, "o item que chega já ocupa um slot");
});

test("Plano: item que existe em quem sai vira passar, não falta", () => {
  const item = (id, name) => ({
    id,
    name,
    components: [{ id: "DA_Component_BFSword" }, gloves],
    craftable: false,
    missing: [gloves],
  });
  const shown = {
    carry: "Aphelios",
    board: [{ id: "Aphelios", name: "Aphelios", cost: 4, targetStars: 2 }],
    itemPlans: [
      {
        championId: "Aphelios",
        name: "Aphelios",
        equipped: [],
        ideal: [item(IE.id, IE.name)],
        slotsFree: 3,
      },
    ],
    itemMoves: [
      {
        from: { id: "Vi", name: "Vi" },
        moves: [{ item: IE, to: { id: "Aphelios", name: "Aphelios" } }],
      },
    ],
  };
  const analysis = {
    self: {
      units: [{ championName: "Aphelios", starLevel: 1, itemNames: [] }],
      reserve: [],
    },
  };
  const run = (extra) =>
    buildChecklist({
      shown: { ...shown, ...extra },
      analysis,
      state: { stage: "4-2", level: 8 },
    }).checklist;
  const moved = run({}).items[0];
  assert.equal(moved.status, "move");
  assert.equal(moved.from, "Vi");
  assert.deepEqual(moved.missing, []);
  assert.equal(
    run({}).next.find((n) => n.kind === "item").text,
    "Passar Infinity Edge de Vi para Aphelios",
  );
  // Sem a movimentação (o item não existe em outro lugar), segue como falta.
  const missing = run({ itemMoves: [] }).items[0];
  assert.equal(missing.status, "partial");
  assert.deepEqual(missing.missing, ["Sparring Gloves"]);
});
