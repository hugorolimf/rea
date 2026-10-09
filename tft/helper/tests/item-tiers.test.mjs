// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import {
  PLACEMENT_VAR,
  itemTiers,
  kindOf,
  normalizeStats,
  renderDesc,
} from "../item-tiers.mjs";

test("tipo do item: componente, completo, emblema, artefato, radiante; itens de aprimoramento ficam em outros", () => {
  const parts = ["DA_Component_BFSword", "DA_Component_SparringGloves"];
  assert.equal(kindOf("DA_Component_BFSword"), "component");
  assert.equal(kindOf("DA_InfinityEdge", parts), "completed");
  assert.equal(
    kindOf("DA_18_EmblemLunar", [
      "DA_Component_Spatula",
      "DA_Component_ChainVest",
    ]),
    "emblem",
  );
  assert.equal(kindOf("DA_Artifact_Dawncore"), "artifact");
  assert.equal(kindOf("DA_Item_Artifact_TalismanOfAscension"), "artifact");
  assert.equal(kindOf("DA_InfinityEdgeRadiant"), "radiant");
  assert.equal(kindOf("DA_RabadonsDeathcap_Radiant"), "radiant");
  for (const id of [
    "DA_HealthPotion18_Radiant",
    "DA_18_Radiantize",
    "DA_Artifactinate18",
    "DA_RadiantLuckyItemChest",
  ])
    assert.equal(kindOf(id), "other", id);
});

test("atributos: frações viram pontos percentuais, valores planos ficam, zeros e chaves fora da barra somem", () => {
  assert.deepEqual(
    normalizeStats({ AD: 0.35, CritChance: 35, CritDamageToGive: null }),
    { AD: 35, Crit: 35 },
  );
  assert.deepEqual(
    normalizeStats({ AD: 10 }),
    { AD: 10 },
    "componente já vem em pontos",
  );
  assert.deepEqual(
    normalizeStats({
      AP: 15,
      ManaRegen: 1,
      Health: 500,
      BonusPercentHP: 0.18,
      Armor: 0,
    }),
    { AP: 15, HP: 500, ManaRegen: 1 },
  );
  assert.deepEqual(normalizeStats({ StatOmnivamp: 0.2, MagicResist: 20 }), {
    MR: 20,
    Omnivamp: 20,
  });
  assert.deepEqual(
    normalizeStats({ BaseDurability: 0.05, DamageReduction: 100 }),
    { Durability: 5 },
    "redução passiva não é durabilidade",
  );
});

test("descrição: preenche @Var@ e @Var*100@, troca ícones/marcações e mostra X para valor de combate", () => {
  const fx = {
    FlatManaRestore: 5,
    BonusPercentHP: 0.18,
    ReductionPerCast: 0.1,
  };
  assert.equal(
    renderDesc("Attacks grant @FlatManaRestore@ bonus Mana.", fx),
    "Attacks grant 5 bonus Mana.",
  );
  assert.equal(
    renderDesc("Gain @BonusPercentHP*100@% max Health.<br>", fx),
    "Gain 18% max Health.",
  );
  assert.equal(
    renderDesc("%i:scaleAD% +@AD@ Attack Damage", { AD: 10 }),
    "+10 Attack Damage",
  );
  assert.equal(renderDesc("Reduz @ReductionPerCast*100@%.", fx), "Reduz 10%.");
  assert.equal(
    renderDesc(
      "Causa @Dano@ de dano.<br><br>Cura de aliado: @Cura@<br>{{TFT_Keyword_X}}<tftitemrules>regra</tftitemrules>",
      {},
    ),
    "Causa X de dano.",
  );
  assert.equal(renderDesc("1,5 <b>s</b>", {}), "1,5 s");
});

test("tier: média encolhida pela amostra, dentro de cada categoria, com posição e z", () => {
  const items = [
    { id: "a", kind: "completed" },
    { id: "b", kind: "completed" },
    { id: "c", kind: "completed" },
    { id: "d", kind: "completed" },
    { id: "e", kind: "completed" },
    { id: "rare", kind: "completed" },
    { id: "x", kind: "artifact" },
    { id: "y", kind: "artifact" },
    { id: "none", kind: "completed" },
  ];
  const stats = {
    a: { count: 200000, avg: 3.9 },
    b: { count: 200000, avg: 4.1 },
    c: { count: 200000, avg: 4.2 },
    d: { count: 200000, avg: 4.3 },
    e: { count: 200000, avg: 4.5 },
    rare: { count: 50, avg: 3.0 }, // 50 partidas: média ótima, mas é ruído
    x: { count: 10000, avg: 4.0 },
    y: { count: 10000, avg: 4.6 },
  };
  const out = Object.fromEntries(itemTiers(items, stats).map((i) => [i.id, i]));
  assert.equal(out.none.perf, null, "sem estatística não entra no tier");
  // Com 200 mil partidas a média publicada praticamente não muda; com 50 é puxada para a média da categoria.
  assert.ok(Math.abs(out.a.perf.post - 3.9) < 0.001);
  assert.ok(out.rare.perf.shrink > 0.5, `encolhimento ${out.rare.perf.shrink}`);
  assert.ok(out.rare.perf.post > 3.5 && out.rare.perf.post < out.a.perf.mean);
  assert.equal(
    out.rare.perf.se,
    Math.round(Math.sqrt(PLACEMENT_VAR / 50) * 1e4) / 1e4,
  );
  // Melhor colocação = z maior = tier melhor; a ordem segue a média encolhida.
  assert.equal(out.a.perf.tier, "S");
  assert.equal(out.e.perf.tier, "D");
  assert.ok(out.a.perf.z > out.b.perf.z && out.b.perf.z > out.e.perf.z);
  const ranks = ["a", "b", "c", "d", "e"].map((k) => out[k].perf.rank);
  assert.deepEqual(
    ranks,
    [...ranks].sort((x, y) => x - y),
    "posição segue a média encolhida",
  );
  assert.equal(out.a.perf.of, 6);
  // Categorias não se misturam: o artefato pior é comparado só com artefatos.
  assert.equal(out.x.perf.of, 2);
  assert.ok(out.x.perf.z > 0 && out.y.perf.z < 0);
  assert.equal(out.x.perf.mean, 4.3);
});

test("componentes e consumíveis têm média e posição, mas não tier", () => {
  const out = itemTiers(
    [
      { id: "c1", kind: "component" },
      { id: "c2", kind: "component" },
    ],
    { c1: { count: 50000, avg: 4.6 }, c2: { count: 50000, avg: 5.0 } },
  );
  for (const i of out) {
    assert.equal(i.perf.tier, null);
    assert.ok(Number.isFinite(i.perf.post) && i.perf.rank >= 1);
  }
});
