// Rodar com: node --test tft/helper/tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  bestSpend,
  binomialPmf,
  closeCurve,
  finalLevelOf,
  goldFor,
  incomeOf,
  interestOf,
  isContested,
  levelCostOf,
  nextTier,
  pressureOf,
  projectGold,
  rerollLevelOf,
  rollLevelOf,
  rollSim,
  sellValue,
  slotChance,
  streakGold,
  tierFloor,
} from "../economy.mjs";

test("juros: 1g a cada 10g guardados, máximo 5; patamares", () => {
  assert.deepEqual([0, 9, 10, 49, 50, 120].map(interestOf), [0, 0, 1, 4, 5, 5]);
  assert.deepEqual([0, 9, 10, 49, 50].map(nextTier), [10, 10, 20, 50, null]);
  assert.deepEqual([9, 31, 77].map(tierFloor), [0, 30, 50]);
  assert.equal(interestOf(null), null);
});

test("renda da rodada soma base, juros e sequência", () => {
  assert.deepEqual([1, 2, 4, 5, 6, 9].map(streakGold), [0, 1, 1, 2, 3, 3]);
  assert.deepEqual(incomeOf(34, { kind: "loss", length: 5 }), {
    base: 5,
    interest: 3,
    streak: 2,
    total: 10,
  });
});

test("venda: 1★ devolve o custo; 2★/3★ devolvem as cópias menos 1, exceto custo 1", () => {
  assert.equal(sellValue(4, 1), 4);
  assert.equal(sellValue(4, 2), 11);
  assert.equal(sellValue(4, 3), 35);
  assert.equal(sellValue(1, 2), 3);
  assert.equal(sellValue(1, 3), 9);
});

test("XP: compras de 4 XP, XP passivo e nível máximo", () => {
  assert.deepEqual(levelCostOf("23/68"), {
    have: 23,
    total: 68,
    need: 45,
    buys: 12,
    cost: 48,
    passive: false,
    max: false,
  });
  assert.equal(levelCostOf("6/8").passive, true);
  assert.equal(levelCostOf("6/8").cost, 4);
  assert.equal(levelCostOf("5/8").passive, false);
  assert.equal(levelCostOf("0/0").max, true);
  assert.equal(levelCostOf("0/0").cost, null);
  assert.equal(levelCostOf("?"), null);
});

test("projeção: ouro guardado rende juros compostos e as rodadas avançam no calendário do jogo", () => {
  const p = projectGold(44, { stage: { stage: 4, round: 2 }, rounds: 3 });
  assert.deepEqual(
    p.map((r) => [r.label, r.gold]),
    [
      ["4-3", 53],
      ["4-4", 63],
      ["4-5", 73],
    ],
  );
  assert.equal(
    projectGold(10, { stage: { stage: 1, round: 4 }, rounds: 1 })[0].label,
    "2-1",
  );
  assert.equal(
    projectGold(10, { stage: { stage: 2, round: 7 }, rounds: 1 })[0].label,
    "3-1",
  );
  assert.equal(projectGold(30, { spend: 30, rounds: 1 })[0].gold, 5);
  assert.deepEqual(projectGold(null), []);
});

test("níveis: reroll pela meta ou pelo custo do carry; roll do carry limitado ao nível final", () => {
  assert.equal(rerollLevelOf({ rerollLevel: 6 }, 4), 6);
  assert.equal(rerollLevelOf(null, 1), 5);
  assert.equal(rerollLevelOf(null, 4), null);
  assert.equal(finalLevelOf({ levelling: "Fast 9" }, 8, null), 9);
  assert.equal(finalLevelOf({ levelling: "Fast 8" }, 8, null), 8);
  assert.equal(rollLevelOf({ carryCost: 4, finalLevel: 9 }), 8);
  assert.equal(rollLevelOf({ carryCost: 5, finalLevel: 8 }), 8);
  assert.equal(rollLevelOf({ carryCost: 2, finalLevel: 8, rerollLevel: 6 }), 6);
  assert.equal(rollLevelOf({ carryCost: 2 }), 6);
});

test("pressão: faixas de vida, piso e urgência numa régua só", () => {
  assert.equal(pressureOf({ hp: 15 }).band, "critical");
  assert.equal(pressureOf({ hp: 15 }).floor, 0);
  assert.equal(pressureOf({ hp: 28 }).band, "danger");
  assert.equal(
    pressureOf({ hp: 42, stage: { stage: 3, round: 2 } }).band,
    "hurt",
  );
  assert.equal(
    pressureOf({ hp: 42, stage: { stage: 4, round: 1 } }).band,
    "danger",
  );
  assert.equal(pressureOf({ hp: 48, weak: true }).band, "danger");
  assert.equal(pressureOf({ hp: 80 }).floor, 50);
  assert.equal(pressureOf({ hp: 55 }).floor, 30);
});

test("disputa de 3★: 6 cópias com rivais ou mais de 35% da pool", () => {
  assert.equal(isContested({ enemy: 6, total: 30 }), true);
  assert.equal(isContested({ enemy: 4, total: 10 }), true);
  assert.equal(isContested({ enemy: 3, total: 18 }), false);
  assert.equal(isContested(undefined), false);
});

test("PMF binomial soma 1 e bate com casos extremos", () => {
  const pmf = binomialPmf(5, 0.12);
  assert.ok(Math.abs(pmf.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(pmf[0] - 0.88 ** 5) < 1e-12);
  assert.deepEqual(binomialPmf(3, 0), [1, 0, 0, 0]);
  assert.deepEqual(binomialPmf(3, 1), [0, 0, 0, 1]);
});

test("curva exata: com 1 cópia faltando é 1−(1−p)^(5n), n = lojas que ainda deixam ouro para comprar", () => {
  const args = { level: 8, cost: 4, own: 2, goal: 3, free: 7, denom: 80 },
    p = slotChance(8, 4, 7, 80),
    curve = closeCurve(args);
  for (const g of [0, 4, 6, 10, 20, 41]) {
    const shops = Math.max(0, Math.floor((g - args.cost) / 2));
    assert.ok(
      Math.abs(curve[g] - (1 - (1 - p) ** (5 * shops))) < 1e-12,
      `g=${g}`,
    );
  }
});

test("curva exata: monótona, zero sem cópias suficientes, 1 quando já fechou", () => {
  const curve = closeCurve({
    level: 6,
    cost: 2,
    own: 2,
    goal: 9,
    free: 15,
    denom: 200,
  });
  for (let g = 1; g < curve.length; g++)
    assert.ok(curve[g] >= curve[g - 1] - 1e-15);
  assert.equal(
    closeCurve({
      level: 6,
      cost: 2,
      own: 2,
      goal: 9,
      free: 5,
      denom: 200,
    })[100],
    0,
  );
  assert.equal(
    closeCurve({ level: 6, cost: 2, own: 9, goal: 9, free: 5, denom: 200 })[0],
    1,
  );
});

test("curva exata: a pool encolhendo deixa o 3★ mais difícil que a binomial de chance fixa", () => {
  const level = 6,
    args = { level, cost: 2, own: 3, goal: 9, free: 10, denom: 180 };
  const depleting = closeCurve(args);
  // Mesma conta com a chance da primeira cópia mantida fixa: soma de compras sem tirar da pool.
  const fixed = closeCurve({ ...args, free: 1000, denom: 18000 });
  assert.ok(
    depleting[60] < fixed[60] - 0.02,
    `${depleting[60]} vs ${fixed[60]}`,
  );
});

test("Monte Carlo de um alvo converge para a curva exata", () => {
  const args = { level: 8, cost: 4, own: 1, goal: 3, free: 8, denom: 80 },
    exact = closeCurve({ ...args, maxGold: 60 });
  const sim = rollSim({
    level: 8,
    targets: [{ cost: 4, free: 8, steps: [{ copies: 2, value: 1 }] }],
    denom: { 1: 0, 2: 0, 3: 0, 4: 80, 5: 0 },
    maxGold: 60,
    runs: 6000,
  });
  for (const g of [10, 20, 30, 40, 60]) {
    assert.ok(
      Math.abs(sim.gain[g] - exact[g]) < 0.035,
      `g=${g}: ${sim.gain[g]} vs ${exact[g]}`,
    );
    // Com um alvo só, "pelo menos uma evolui" é a própria chance de fechar.
    assert.ok(Math.abs(sim.any[g] - exact[g]) < 0.035, `any g=${g}`);
  }
  for (let g = 1; g <= 60; g++) {
    assert.ok(sim.gain[g] >= sim.gain[g - 1]);
    assert.ok(sim.any[g] >= sim.any[g - 1]);
  }
});

test("quanto rolar: para no joelho de uma curva que satura e gasta tudo numa reta", () => {
  const sat = Float64Array.from({ length: 41 }, (_, g) => 1 - Math.exp(-g / 5)),
    line = Float64Array.from({ length: 41 }, (_, g) => g / 40);
  const opts = { gold: 90, max: 40, urgency: 1, horizon: 0 };
  assert.ok(bestSpend(sat, opts).spend < 40);
  assert.equal(bestSpend(line, opts).spend, 40);
  // Sem urgência, gasta até onde o ganho ainda cresce.
  assert.equal(bestSpend(sat, { ...opts, urgency: 0 }).spend, 40);
  assert.equal(bestSpend(new Float64Array(41), opts).spend, 0);
  assert.equal(goldFor(sat, 0.5), 4);
});

test("quanto rolar: perder patamar de juros custa ouro futuro", () => {
  const line = Float64Array.from({ length: 41 }, (_, g) => g / 40);
  // Com 50g, gastar 1g já derruba de 5 para 4 de juros; o horizonte encarece esse ouro.
  const a = bestSpend(line, { gold: 50, max: 40, urgency: 1, horizon: 0 }),
    b = bestSpend(line, { gold: 50, max: 40, urgency: 1, horizon: 3 });
  assert.equal(a.spend, 40);
  assert.ok(b.price < a.price);
});

test("time inteiro: uma peça barata e fácil de fechar sobe a chance de evoluir alguma; mais ouro nunca piora", () => {
  const args = {
      level: 8,
      denom: { 1: 300, 2: 250, 3: 200, 4: 100, 5: 60 },
      maxGold: 80,
    },
    one = { cost: 4, free: 9, steps: [{ copies: 2, value: 5 }] },
    two = { cost: 1, free: 25, steps: [{ copies: 1, value: 1 }] },
    alone = rollSim({ ...args, targets: [one] }),
    both = rollSim({ ...args, targets: [one, two] });
  assert.equal(both.any[1], 0, "sem ouro para uma loja não há chance");
  assert.ok(
    both.any[30] > alone.any[30] + 0.1,
    `${both.any[30]} vs ${alone.any[30]}`,
  );
  for (let g = 1; g <= 80; g++) assert.ok(both.any[g] >= both.any[g - 1]);
  assert.ok(both.any[80] > both.any[30]);
});

test("time inteiro: peça nova não conta como evolução e alvo sem cópias livres é ignorado", () => {
  const args = {
    level: 8,
    denom: { 1: 300, 2: 250, 3: 200, 4: 100, 5: 60 },
    maxGold: 60,
  };
  const nova = rollSim({
    ...args,
    targets: [
      { cost: 4, free: 9, evolve: false, steps: [{ copies: 1, value: 2 }] },
    ],
  });
  assert.equal(nova.any[60], 0, "comprar peça nova não é evolução");
  assert.ok(nova.gain[60] > 0, "mas rende força");
  const vazio = rollSim({
    ...args,
    targets: [{ cost: 4, free: 0, steps: [{ copies: 1, value: 2 }] }],
  });
  assert.equal(vazio.gain[60], 0);
});
