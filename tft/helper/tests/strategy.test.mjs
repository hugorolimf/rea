// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { strategy } from "../strategy.mjs";
import { stagePlan } from "../stage.mjs";
import { closeCurve, freeByCost } from "../economy.mjs";
import { makeState } from "./fixtures.mjs";

const run = (opts) => {
  const s = makeState(opts);
  return { s, r: strategy(s.plan, s.analysis, s.options) };
};
const card = (name, cost) => ({
  slot: 1,
  id: `TFT_${name}`,
  name,
  cost,
  action: "comprar",
  reason: "peça da meta",
});

test("compras da loja saem do ouro antes da rolagem e não furam o piso", () => {
  const base = {
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  };
  const plain = run(base).r,
    shopping = run({ ...base, shop: [card("Xayah", 4)] }).r;
  assert.equal(plain.action, "ROLAR");
  assert.equal(shopping.action, "ROLAR");
  assert.equal(shopping.cash, 71);
  assert.ok(
    shopping.spend <= plain.spend - 4,
    `${shopping.spend} vs ${plain.spend}`,
  );
  assert.ok(shopping.keep >= 50, "piso de 50g respeitado depois da loja");
  assert.ok(shopping.steps[0].startsWith("Compre na loja"));
});

test("o ganho esperado mostrado é o da rolagem recomendada", () => {
  const { r } = run({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  assert.equal(r.action, "ROLAR");
  assert.equal(r.ev.roll.gold, r.spend);
  assert.equal(r.panels.rolling.spend, r.spend);
  assert.ok(r.reasons.some((t) => t.includes(`rolar ${r.spend}g`)));
});

test("rolar 2g sem ouro para comprar a cópia achada não é recomendado", () => {
  const { r } = run({
    gold: 52,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  assert.equal(r.action, "ECONOMIZAR");
  assert.equal(r.keep, 52);
});

test("chance desta rolagem é de fechar o 2★ (cópias + preço + pool), não de ver uma cópia", () => {
  const { s, r } = run({
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  const t = r.panels.rolling.targets[0];
  assert.equal(t.name, "Aphelios");
  const shops = r.panels.rolling.shops,
    seeOne = 1 - (1 - t.chancePerShop) ** shops;
  const exact = closeCurve({
    level: 8,
    cost: 4,
    own: t.own,
    goal: 3,
    free: t.left,
    denom: freeByCost(s.analysis.pool)[4],
  })[r.spend];
  assert.ok(Math.abs(t.chanceInRoll - exact) < 1e-12);
  assert.ok(t.chanceInRoll < seeOne, `${t.chanceInRoll} < ${seeOne}`);
  assert.equal(t.curve.step, 2);
  assert.ok(t.curve.q80 > 0 && t.curve.p.length > 4);
});

test("XP passivo: faltando 2 XP não compra XP fora de perigo, mas compra em perigo", () => {
  const healthy = run({
    gold: 60,
    hp: 80,
    level: 7,
    xp: "54/56",
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  }).r;
  assert.equal(healthy.action, "ECONOMIZAR");
  assert.equal(healthy.headline, "Suba de graça na próxima rodada");
  assert.equal(healthy.panels.leveling.passive, true);
  assert.equal(healthy.panels.leveling.go, false);
  const hurt = run({ gold: 60, hp: 25, level: 6, xp: "34/36", stage: "4-2" }).r;
  assert.ok(hurt.steps.some((t) => t.startsWith("Suba para o nível 7")));
});

test("nível máximo não sugere comprar XP", () => {
  const { r } = run({
    gold: 90,
    hp: 80,
    level: 10,
    xp: "0/0",
    stage: "5-5",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  assert.notEqual(r.action, "SUBIR NÍVEL");
  assert.equal(r.panels.leveling.cost, null);
  assert.equal(r.panels.leveling.xp.max, true);
});

test("vida crítica: all-in vende o banco fora da comp quando o ouro não basta", () => {
  const { r } = run({
    gold: 12,
    hp: 12,
    level: 8,
    xp: "10/68",
    stage: "5-1",
    reserve: [
      ["Ezreal", 4, 2],
      ["Taric", 1, 1],
    ],
  });
  assert.equal(r.action, "ROLAR");
  assert.equal(r.sellable.gold, 12);
  assert.ok(r.spend > 12, `gasta além do ouro em mãos: ${r.spend}`);
  assert.ok(r.steps.some((t) => t.startsWith("Venda Ezreal 2★")));
  assert.ok(r.keep >= 0);
});

test("reroll: rápido com vida até 50 (piso 20), lento acima (piso 50)", () => {
  const base = {
    comp: "reroll",
    gold: 62,
    level: 6,
    xp: "2/36",
    stage: "3-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  };
  const fast = run({ ...base, hp: 45 }).r,
    slow = run({ ...base, hp: 80 }).r;
  assert.ok(fast.headline.startsWith("Reroll rápido"));
  assert.ok(fast.keep >= 20 && fast.keep < 30);
  assert.ok(slow.headline.startsWith("Reroll lento"));
  assert.ok(slow.keep >= 50);
});

test("reroll disputado: desiste do 3★ com 6 cópias com rivais", () => {
  const { r } = run({
    comp: "reroll",
    gold: 62,
    hp: 80,
    level: 6,
    xp: "2/36",
    stage: "3-2",
    enemy: { Kayle: 6, Garen: 7 },
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  assert.equal(r.action, "SUBIR NÍVEL");
  assert.equal(r.headline, "3★ disputado: desista do reroll e suba de nível");
});

test("unidades repetidas em campo não contam o upgrade duas vezes", () => {
  const base = {
    gold: 75,
    hp: 80,
    level: 8,
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  };
  const units = [
    ["Aphelios", 4, 1, 3],
    ["Amumu", 4, 2, 2],
    ["Sentinel", 2, 1, 0],
  ];
  const twice = run({ ...base, units: [...units, ["Sentinel", 2, 1, 0]] }).r,
    once = run({ ...base, units, extra: { Sentinel: 1 } }).r;
  assert.equal(twice.ev.roll.gainMax, once.ev.roll.gainMax);
});

test("painel de economia: ouro depois da ação, renda, projeção e sequência", () => {
  const s = makeState({
    gold: 44,
    hp: 80,
    level: 7,
    xp: "40/68",
    stage: "4-2",
    rivals: { count: 7, cost: 2, stars: 1, size: 6 },
  });
  s.options.streak = { kind: "loss", length: 3, inferred: true };
  const r = strategy(s.plan, s.analysis, s.options),
    eco = r.panels.economy;
  assert.equal(eco.after, r.keep ?? r.cash);
  assert.equal(eco.projection.length, 4);
  assert.equal(eco.projection[0].label, "4-3");
  assert.equal(eco.income.streak, 1);
  assert.equal(eco.income.total, 5 + Math.floor(eco.after / 10) + 1);
  assert.equal(eco.projection[0].gold, eco.after + eco.income.total);
  assert.equal(eco.streak.gold, 1);
  assert.ok(r.reasons.some((t) => t.startsWith("Sequência de 3 derrotas")));
});

test("comp Standard (sem rerollLevel nem Fast N): rola no nível do custo do carry, sem reroll de 3★", () => {
  const at = (carry, level) => {
    const s = makeState({
      gold: 54,
      hp: 80,
      level,
      xp: "10/48",
      stage: "4-2",
      rivals: { count: 7, cost: 2, stars: 1, size: 6 },
    });
    s.plan.meta = { levelling: "Standard", rerollLevel: null, stars3: [] };
    s.plan.carry = carry;
    return strategy(s.plan, s.analysis, s.options);
  };
  const four = at("Aphelios", 7);
  assert.equal(four.rollAt, 8);
  assert.equal(four.finalLevel, 8);
  assert.equal(four.style, "Standard");
  assert.notEqual(
    four.action,
    "ROLAR",
    "abaixo do nível do carry de custo 4 não rola",
  );
  const three = at("Diana", 7);
  assert.equal(three.rollAt, 7);
  assert.ok(
    !three.headline.startsWith("Reroll"),
    "sem alvos de 3★ não entra no reroll",
  );
  assert.equal(three.panels.rolling.targets[0].goal, 3, "alvo é o carry 2★");
});

// Catálogo mínimo para stagePlan: só os campeões usados no teste.
const catalog = {
  champions: [
    ["Aphelios", 4],
    ["Amumu", 4],
    ["Xayah", 4],
    ["Diana", 3],
    ["Rakan", 3],
    ["Vi", 2],
    ["Sentinel", 2],
    ["Varus", 1],
    ["Poppy", 1],
  ].map(([name, cost]) => ({ apiName: `TFT_${name}`, name, cost, traits: [] })),
  items: [],
};

test("loja: carta secundária abaixo do patamar de juros só é comprada na faixa de perigo", () => {
  const shopFor = (hp, stage) => {
    const s = makeState({
      gold: 30,
      hp,
      stage,
      // Lobby fraco: a board não conta como "abaixo da maioria", só a vida e o estágio definem a faixa.
      rivals: { count: 7, cost: 1, stars: 1, size: 2 },
      units: [
        ["Aphelios", 4, 1, 0],
        ["Poppy", 1, 1, 0],
      ],
    });
    s.options.shop = ["TFT_Poppy"];
    return stagePlan(s.plan, s.analysis, catalog, s.options).shop[0];
  };
  // HP 42: em perigo a partir do estágio 4 (mesma régua da estratégia), saudável o bastante no estágio 3.
  assert.equal(shopFor(42, "4-2").action, "comprar");
  assert.equal(shopFor(42, "3-2").action, "segurar");
  assert.equal(shopFor(80, "4-2").action, "segurar");
});
