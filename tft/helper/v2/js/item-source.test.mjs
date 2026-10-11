// Rodar com: node --test tft/helper/v2/js/item-source.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseItem, buildStates, locateItem, ownersOf } from "./item-source.js";
import { buildModel } from "./model.js";

const IE = {
  id: "DA_InfinityEdge",
  name: "Infinity Edge",
  components: [
    { id: "DA_Component_BFSword", name: "B.F. Sword" },
    { id: "DA_Component_SparringGloves", name: "Sparring Gloves" },
  ],
};
const owner = (unitId, items, extra = {}) => ({
  unitId,
  name: unitId,
  stars: 2,
  zone: "board",
  stays: false,
  items,
  wants: [],
  ...extra,
});
const locate = (opts) => locateItem(IE, { cellId: "Varus", ...opts });

test("item equipado em quem sai da formação não falta: é mover", () => {
  const s = locate({
    owners: [owner("Nidalee", ["DA_SteraksGage", "DA_InfinityEdge"])],
  });
  assert.equal(s.kind, "move");
  assert.equal(s.from.unitId, "Nidalee");
  assert.equal(s.text, "mover de Nidalee");
});

test("já equipado na própria peça, mesmo radiante, e pronto no banco vêm antes de qualquer mover", () => {
  const sai = [owner("Nidalee", ["DA_InfinityEdge"])];
  assert.equal(
    locate({ equipped: [{ id: "DA_InfinityEdge_Radiant" }], owners: sai }).kind,
    "on",
  );
  assert.equal(
    locate({ bank: ["DA_InfinityEdge"], owners: sai }).kind,
    "ready",
  );
  assert.equal(baseItem("DA_VoidStaffRadiant"), "DA_VoidStaff");
});

test("radiante em outra peça vale o item base", () => {
  const owners = ownersOf(
    [{ championName: "Vi", itemNames: ["DA_InfinityEdge_Radiant"] }],
    new Set(),
  );
  assert.equal(locate({ owners }).kind, "move");
});

test("quem sai tem prioridade sobre quem fica; quem fica e usa o item só informa (taken)", () => {
  const fica = owner("Aphelios", ["DA_InfinityEdge"], {
      stays: true,
      wants: ["DA_InfinityEdge"],
    }),
    sai = owner("Nidalee", ["DA_InfinityEdge"]);
  assert.equal(locate({ owners: [fica, sai] }).from.unitId, "Nidalee");
  const so = locate({ owners: [fica] });
  assert.equal(so.kind, "taken");
  assert.equal(so.from.unitId, "Aphelios");
  // Quem fica mas não usa o item na própria build pode cedê-lo.
  assert.equal(
    locate({
      owners: [owner("Aphelios", ["DA_InfinityEdge"], { stays: true })],
    }).kind,
    "move",
  );
  // O "Passar itens" do servidor decide quando há mais de uma origem possível.
  const planned = locate({
    owners: [fica, sai],
    moves: [{ itemId: "DA_InfinityEdge", fromId: "Aphelios" }],
  });
  assert.equal(planned.from.unitId, "Aphelios");
  assert.equal(planned.kind, "move");
});

test("componentes: banco monta; solto em quem sai completa a receita; só falta o que não existe", () => {
  assert.equal(
    locate({ bank: ["DA_Component_BFSword", "DA_Component_SparringGloves"] })
      .text,
    "monta agora",
  );
  const parts = locate({
    bank: ["DA_Component_BFSword"],
    owners: [owner("Vi", ["DA_Component_SparringGloves"])],
  });
  assert.equal(parts.kind, "move");
  assert.match(parts.text, /Vi/);
  assert.deepEqual(parts.got, [true, true]);
  const half = locate({ bank: ["DA_Component_BFSword"] });
  assert.equal(half.kind, "half");
  assert.equal(half.text, "falta 1");
  assert.deepEqual(half.got, [true, false]);
  const none = locate({ owners: [owner("Vi", ["DA_SunfireCape"])] });
  assert.equal(none.kind, "need");
  assert.equal(none.missing, 2);
  // Um componente só pode ser usado uma vez, mesmo que haja uma receita com dois iguais.
  const bf = {
    id: "DA_Deathblade",
    name: "Deathblade",
    components: [
      { id: "DA_Component_BFSword" },
      { id: "DA_Component_BFSword" },
    ],
  };
  assert.equal(
    locateItem(bf, { cellId: "Varus", bank: ["DA_Component_BFSword"] }).text,
    "falta 1",
  );
});

test("peça da reserva também conta como dona do item", () => {
  const [o] = ownersOf(
    [
      {
        championName: "Vi",
        name: "Vi",
        starLevel: 1,
        zone: "reserve",
        itemNames: ["DA_InfinityEdge"],
      },
    ],
    new Set(),
  );
  assert.equal(o.zone, "reserve");
  assert.equal(locate({ owners: [o] }).kind, "move");
});

test("Formação com dados reais gravados: Varus pede o Infinity Edge que está na Nidalee que sai", () => {
  const { state, rec } = JSON.parse(
    readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
  );
  state.screen = {
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: [],
  };
  rec.metadata.actionable = true;
  rec.self.health = 58;
  const m = buildModel({ state, rec });
  const varus = m.plan.cells.find((c) => c.id === "DA_18_Varus");
  const states = buildStates(varus, []);
  const ie = states.find((s) => s.item.id === "DA_InfinityEdge");
  assert.ok(ie, "Infinity Edge está entre os itens ideais do Varus");
  assert.equal(ie.state.kind, "move");
  assert.equal(ie.state.from.unitId, "DA_Nidalee18_AP");
  // Nada que exista em outra peça pode aparecer como "falta".
  const owned = new Set(varus.build.owners.flatMap((o) => o.items));
  for (const s of states)
    if (owned.has(baseItem(s.item.id)))
      assert.notEqual(s.state.kind, "need", s.item.name);
});
