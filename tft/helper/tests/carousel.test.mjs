// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { carouselPicks, rankCarouselOffer } from "../carousel.mjs";

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

/* ---------- Peças lidas do carrossel (GEP) ---------- */

const slot = (n, id, item) => ({ slot: n, id, text: id, item, itemText: item });
const offered = [
  slot(1, "aph", "DA_Component_BFSword"),
  slot(2, "ali", "DA_Component_NegatronCloak"),
  slot(3, "zzz", "DA_Component_Spatula"),
  slot(4, "ali", "DA_Component_TearOfTheGoddess"),
  slot(5, "aph", "IE"),
  slot(6, "zzz", "DA_18_EmblemLunar"),
];

test("peças lidas: valor do componente é o da lista de prioridade, mais o bônus do campeão do plano", () => {
  const ranked = rankCarouselOffer([carry, tank], offered, {
    carry: "Aphelios",
    inventory: ["DA_Component_ChainVest"],
  });
  // O Manto fecha a Gárgula do tanque (a metade dele já está no banco); o BF começa o 1º item do carry.
  assert.deepEqual(
    ranked.map((r) => r.rank),
    [1, 2, 3, 4, 5, 6],
  );
  const by = Object.fromEntries(ranked.map((r) => [r.slot, r]));
  assert.equal(by[2].completesNow, true);
  assert.equal(by[2].forChampion, "Alistar");
  assert.match(by[2].reason, /Fecha Garg/);
  // O mesmo componente vale mais no campeão do plano (carry) que no que não é do plano.
  assert.equal(by[1].championName, "Aphelios");
  assert.match(by[1].reason, /carry do plano/);
  assert.equal(
    by[3].championName,
    null,
    "campeão fora do plano: sem nome inventado",
  );
  // Ordem do maior para o menor, estável entre empates (a ordem do carrossel).
  const scores = ranked.map((r) => r.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  );
  // O item que o componente fecha vem como alvo, para a interface desenhar a imagem.
  assert.deepEqual(by[2].target, { id: "Garg", name: "Garg" });
  assert.equal(by[2].forChampionId, "ali");
});

test("peças lidas: item pronto da build vale mais que o componente; emblema só pesa se o plano usa a sinergia", () => {
  const ranked = rankCarouselOffer([carry, tank], offered, {
    carry: "Aphelios",
    traits: [{ name: "Lunar", count: 2 }],
    emblemTrait: (id) => (id === "DA_18_EmblemLunar" ? "Lunar" : null),
  });
  const by = Object.fromEntries(ranked.map((r) => [r.slot, r]));
  assert.equal(by[5].kind, "item");
  assert.equal(by[5].completesNow, true);
  assert.match(by[5].reason, /Item pronto da build de Aphelios/);
  assert.ok(by[5].score > by[1].score, "IE pronto > BF que só começa o item");
  assert.equal(by[6].kind, "emblem");
  assert.match(by[6].reason, /usa a sinergia/);
  assert.ok(by[6].score > 0);
  const off = rankCarouselOffer([carry], [offered[5]], {
    traits: [{ name: "Rapidfire", count: 4 }],
    emblemTrait: () => "Lunar",
  });
  assert.equal(off[0].score, 0);
  assert.match(off[0].reason, /não usa essa sinergia/);
  assert.equal(by[3].kind, "tool");
});

test("peças lidas: o banco e o que já está montado mudam o valor; item já no banco não é pedido pronto de novo", () => {
  const withIe = rankCarouselOffer([carry], [slot(1, "aph", "IE")], {
    carry: "Aphelios",
    inventory: ["IE"],
  });
  assert.equal(withIe[0].kind, "item");
  assert.ok(
    !/Item pronto da build/.test(withIe[0].reason),
    "IE já está no banco",
  );
  const equipped = rankCarouselOffer(
    [{ ...carry, equipped: [{ id: "IE" }] }],
    [slot(1, "aph", "IE")],
    { carry: "Aphelios" },
  );
  assert.ok(
    !/Item pronto da build/.test(equipped[0].reason),
    "IE já está equipado",
  );
});

test("peças lidas: lista vazia, sem planos, item e campeão desconhecidos", () => {
  assert.deepEqual(rankCarouselOffer([carry], []), []);
  assert.deepEqual(rankCarouselOffer([carry], null), []);
  const none = rankCarouselOffer([], [slot(1, "aph", "DA_Component_BFSword")]);
  assert.equal(none[0].score, 0);
  assert.equal(none[0].championName, null);
  const unknown = rankCarouselOffer(
    [carry],
    [
      {
        slot: 1,
        id: null,
        text: "DA_Novo",
        item: null,
        itemText: "DA_ItemNovo",
      },
    ],
    { carry: "Aphelios" },
  );
  assert.equal(unknown[0].kind, "unknown");
  assert.equal(unknown[0].championId, null);
  assert.equal(unknown[0].itemId, null);
  assert.equal(unknown[0].score, 0);
});
