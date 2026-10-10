// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { carouselPicks } from "../carousel.mjs";

const C = (n) => ({ id: `DA_Component_${n}`, name: n });
const recipe = (id, a, b) => ({ id, name: id, components: [C(a), C(b)] });
const IE = recipe("IE", "BFSword", "SparringGloves"),
  GS = recipe("GS", "BFSword", "RecurveBow"),
  LW = recipe("LW", "RecurveBow", "SparringGloves"),
  GARG = recipe("Garg", "ChainVest", "NegatronCloak"),
  WARM = recipe("Warmog", "GiantsBelt", "GiantsBelt"),
  SUN = recipe("Sunfire", "ChainVest", "GiantsBelt");
const carry = {
    championId: "aph",
    name: "Aphelios",
    role: "ad",
    equipped: [],
    slotsFree: 3,
    ideal: [IE, GS, LW],
  },
  tank = {
    championId: "ali",
    name: "Alistar",
    role: "tank",
    equipped: [],
    slotsFree: 3,
    ideal: [GARG, WARM, SUN],
  };

test("sem nada no banco, o carry vem antes do tanque com muitas receitas", () => {
  const picks = carouselPicks([carry, tank], { carry: "Aphelios" });
  assert.equal(picks[0].uses[0].champion, "Aphelios");
  assert.equal(
    picks[0].id,
    "DA_Component_BFSword",
    "BF começa o 1º e o 2º item do carry",
  );
  assert.ok(
    picks.some((p) => p.uses[0].champion === "Alistar") || picks.length === 3,
  );
});

test("componente que fecha um item agora vem primeiro, mesmo de um tanque", () => {
  const picks = carouselPicks([carry, tank], {
    carry: "Aphelios",
    inventory: ["DA_Component_ChainVest"],
  });
  assert.equal(picks[0].id, "DA_Component_NegatronCloak");
  assert.equal(picks[0].uses[0].completesNow, true);
  assert.equal(picks[0].uses[0].item, "Garg");
});

test("fechar o 1º item do carry ganha de fechar o item do tanque", () => {
  const picks = carouselPicks([carry, tank], {
    carry: "Aphelios",
    inventory: ["DA_Component_BFSword", "DA_Component_ChainVest"],
  });
  assert.equal(picks[0].id, "DA_Component_SparringGloves");
  assert.equal(picks[0].uses[0].itemId, "IE");
  assert.equal(picks[0].uses[0].completesNow, true);
});

test("componente equipado é completado sem gastar vaga; itens prontos e equipados não pedem nada", () => {
  const full = {
    ...carry,
    equipped: [{ id: "GS" }, { id: "DA_Component_BFSword" }],
    slotsFree: 1,
  };
  const picks = carouselPicks([full], { carry: "Aphelios", inventory: ["LW"] });
  // GS equipado; IE completa o BF equipado; LW está pronta no banco e usa a última vaga.
  assert.equal(picks.length, 1);
  assert.equal(picks[0].id, "DA_Component_SparringGloves");
  assert.match(picks[0].uses[0].reason, /equipada/);
});

test("cada componente do banco é usado uma vez, e no máximo 3 escolhas", () => {
  const picks = carouselPicks([carry, tank], {
    carry: "Aphelios",
    inventory: ["DA_Component_BFSword"],
  });
  // O BF do banco vai para o IE do carry; o GS ainda pede outro BF.
  const bf = picks.find((p) => p.id === "DA_Component_BFSword");
  assert.ok(!bf || bf.uses.every((u) => u.itemId !== "IE"));
  assert.ok(picks.length <= 3);
  assert.deepEqual(
    picks.map((p) => p.rank),
    picks.map((_, i) => i + 1),
  );
});

test("item já montado em outro campeão e que será passado não é pedido de novo", () => {
  const picks = carouselPicks([carry], {
    carry: "Aphelios",
    covered: new Set(["aph:IE"]),
  });
  assert.ok(picks.every((p) => p.uses.every((u) => u.itemId !== "IE")));
  // O IE passado ocupa a 1ª vaga: o BF ainda serve ao GS, mas sem a soma do IE.
  assert.equal(
    picks.find((p) => p.id === "DA_Component_BFSword")?.uses.length,
    1,
  );
});
