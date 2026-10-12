// Caça por ouro (core/roll/hunt.mjs): quem vale a rolagem com o ouro gastável, com a chance sempre dita com o ouro, e o
// 3★ em várias rodadas (planos/a-fazer/rolagem-por-ouro.md).
import test from "node:test";
import assert from "node:assert/strict";
import {
  HUNT,
  expectedSpend,
  huntBudget,
  huntPlan,
  huntTarget,
  isContested,
  rollFor,
  starValue,
  threeStar,
} from "../core/roll/hunt.mjs";
import { closeCurve } from "../core/pool/curve.mjs";
import { POLICY, isContested as fromEconomy } from "../economy.mjs";

// Livres por custo de um lobby no meio da partida (pool com ~30% fora).
const DENOM = { 1: 290, 2: 230, 3: 160, 4: 90, 5: 70 };
const piece = (over) => ({
  id: "A",
  name: "Azir",
  cost: 3,
  own: 1,
  goal: 3,
  free: 15,
  upper: 16,
  denom: DENOM[over?.cost ?? 3],
  holders: [],
  value: 1,
  ...over,
});

test("orçamento: piso da faixa, venda do banco só no crítico e XP até o nível seguinte", () => {
  const b = huntBudget({ gold: 80, floor: 50, level: 7, levelCost: 16 });
  assert.equal(b.spend, 30);
  assert.equal(b.total, 80);
  assert.deepEqual(b.levelUp, { level: 8, cost: 16, spend: 14 });
  const c = huntBudget({
    gold: 12,
    floor: 0,
    level: 7,
    sellable: 9,
    critical: true,
  });
  assert.equal(c.spend, 21);
  assert.equal(c.total, 21);
  assert.equal(
    huntBudget({ gold: 12, floor: 0, level: 7, sellable: 9 }).spend,
    12,
  );
  assert.equal(huntBudget({ gold: 40, floor: 50, level: 7 }).spend, 0);
});

test("chance do alvo é a conta exata com o orçamento e o texto diz com quanto ouro", () => {
  const x = piece(),
    b = huntBudget({ gold: 90, floor: 50, level: 7 }),
    t = huntTarget(x, { level: 7, budget: b }),
    curve = closeCurve({
      level: 7,
      cost: 3,
      own: 1,
      goal: 3,
      free: 15,
      denom: DENOM[3],
      maxGold: HUNT.maxGold,
    });
  assert.equal(t.chance.spend, curve[40]);
  assert.equal(t.chance.total, curve[90]);
  assert.match(t.text, /\d+g/);
  assert.doesNotMatch(t.text, /por loja/);
  assert.ok(t.spend <= 40 && t.spend >= 2);
});

test("gasto esperado: E[min(G, B)] (fecha na hora → 0; nunca fecha → B)", () => {
  assert.equal(expectedSpend(new Float64Array(50).fill(1), 30), 0);
  assert.equal(expectedSpend(new Float64Array(50), 30), 30);
  const c = closeCurve({
    level: 7,
    cost: 3,
    own: 1,
    goal: 3,
    free: 15,
    denom: DENOM[3],
    maxGold: 60,
  });
  assert.ok(expectedSpend(c, 40) < 40);
  assert.ok(expectedSpend(c, 40) >= expectedSpend(c, 20));
});

test("inviável e disputada saem da lista com o motivo; a disputa diz quem segura as cópias", () => {
  const b = huntBudget({ gold: 80, floor: 50, level: 6 }),
    h = huntPlan({
      level: 6,
      budget: b,
      pieces: [
        piece({
          id: "D",
          name: "Draven",
          cost: 5,
          denom: DENOM[5],
          free: 6,
          upper: 7,
        }),
        piece({ id: "S", name: "Sona", free: 1, upper: 1 }),
        piece({
          id: "R",
          name: "Rammus",
          star3: true,
          own: 4,
          goal: 9,
          free: 6,
          upper: 10,
          enemy: 4,
          hidden: 2,
          holders: [
            { name: "Ana", copies: 3, hidden: 1 },
            { name: "Bia", copies: 1, hidden: 1 },
          ],
        }),
      ],
    });
  assert.equal(h.targets.length, 0);
  const why = Object.fromEntries(h.dropped.map((d) => [d.name, d.text]));
  assert.match(why.Draven, /nível 6 não tem custo 5/);
  assert.match(why.Sona, /faltam 2 cópias e só 1/);
  assert.match(why.Rammus, /Ana segura 4 cópias \(3 em campo \+ ~1 no banco\)/);
  assert.equal(h.verdict.kind, "nada");
});

test("subir antes: custo 4 no nível 7 rende mais no 8 com o mesmo ouro; custo 1 não", () => {
  const b = huntBudget({ gold: 70, floor: 30, level: 7, levelCost: 16 }),
    four = huntTarget(
      piece({
        id: "X",
        name: "Xayah",
        cost: 4,
        own: 2,
        goal: 3,
        free: 8,
        upper: 8,
        denom: DENOM[4],
      }),
      { level: 7, budget: b },
    );
  assert.equal(four.verdict, "suba");
  assert.ok(four.chance.levelUp >= four.chance.spend + POLICY.roll.waitMargin);
  assert.match(four.text, /nível 8 antes \(16g de XP\)/);
  const one = huntTarget(
    piece({
      id: "P",
      name: "Poppy",
      cost: 1,
      own: 2,
      goal: 3,
      free: 20,
      upper: 22,
      denom: DENOM[1],
    }),
    { level: 7, budget: b },
  );
  assert.notEqual(one.verdict, "suba");
});

test("peça nova vem junto ('compre se aparecer') e não dispara a rolagem sozinha", () => {
  const b = huntBudget({ gold: 80, floor: 50, level: 7 });
  const alone = huntPlan({
    level: 7,
    budget: b,
    pieces: [
      piece({ id: "N", name: "Diana", own: 0, goal: 1, free: 16, value: 0.5 }),
    ],
  });
  assert.equal(alone.targets[0].verdict, "junto");
  assert.notEqual(alone.verdict.kind, "role");
  const along = huntPlan({
    level: 7,
    budget: b,
    pieces: [
      piece({ id: "N", name: "Diana", own: 0, goal: 1, free: 16, value: 0.5 }),
      piece({
        id: "M",
        name: "Master Yi",
        own: 2,
        goal: 3,
        free: 15,
        value: 1,
      }),
    ],
  });
  assert.equal(along.verdict.kind, "role");
  assert.match(
    along.headline,
    /^Role por: Master Yi \(2★ · \d+% com \d+g\); se aparecer: Diana$/,
  );
  assert.equal(along.verdict.keep, b.total - along.verdict.spend);
});

test("ouro no piso: a peça que fecha guardando 2 rodadas vira 'guarde até Zg'; longe demais não", () => {
  const near = huntPlan({
    level: 7,
    budget: huntBudget({ gold: 52, floor: 50, level: 7 }),
    pieces: [piece({ own: 2 })],
  });
  assert.equal(near.verdict.kind, "guarde");
  assert.match(near.verdict.text, /^Não role: guarde até \d+g/);
  assert.ok(near.verdict.saveTo > 52);
  const far = huntPlan({
    level: 7,
    budget: huntBudget({ gold: 30, floor: 30, level: 7 }),
    pieces: [
      piece({
        id: "X",
        name: "Xayah",
        cost: 4,
        own: 1,
        free: 8,
        upper: 9,
        denom: DENOM[4],
      }),
    ],
  });
  assert.equal(far.targets[0].verdict, "longe");
  assert.match(far.verdict.text, /ninguém fecha/);
});

test("3★ em várias rodadas: rolar o que passa de 50g soma mais chance que a rodada de agora", () => {
  const k = piece({
      id: "K",
      name: "Kayle",
      cost: 2,
      own: 4,
      goal: 9,
      free: 21,
      upper: 21,
      denom: DENOM[2],
      value: 2,
    }),
    v = threeStar(k, {
      level: 6,
      rollLevel: 6,
      gold: 62,
      floor: 50,
      rounds: 5,
      deadline: "4-1",
      stage: 3,
    });
  assert.ok(v.slow > v.now);
  assert.equal(v.gold, 12 + 4 * 10 + 5 * 2);
  assert.equal(v.verdict, "role");
  assert.match(v.text, /4\/9/);
  assert.match(v.text, /role o que passa de 50g, 12g agora/);
  assert.match(v.text, /até 4-1/);
});

test("3★: abaixo do nível de reroll segura as cópias e diz o nível; rival com 3 cópias faz desistir com o nome", () => {
  const k = piece({
    id: "K",
    name: "Kayle",
    cost: 2,
    own: 4,
    goal: 9,
    free: 21,
    upper: 21,
    denom: DENOM[2],
  });
  const low = threeStar(k, {
    level: 5,
    rollLevel: 6,
    gold: 50,
    floor: 50,
    rounds: 5,
    stage: 3,
  });
  assert.equal(low.verdict, "segure");
  assert.match(low.text, /role no nível 6/);
  const rival = threeStar(
    { ...k, free: 16, holders: [{ name: "Ana", copies: 3, hidden: 0 }] },
    { level: 6, rollLevel: 6, gold: 70, floor: 50, rounds: 5, stage: 3 },
  );
  assert.equal(rival.verdict, "desista");
  assert.match(rival.text, /desista do 3★, Ana segura 3 cópias/);
});

test("3★: sem chance até o prazo desiste no nível de rolagem; poucas cópias cedo só segura", () => {
  const k = piece({
    id: "K",
    name: "Kayle",
    cost: 2,
    own: 4,
    goal: 9,
    free: 9,
    upper: 9,
    denom: DENOM[2],
  });
  const late = threeStar(k, {
    level: 6,
    rollLevel: 6,
    gold: 50,
    floor: 50,
    rounds: 1,
    stage: 4,
  });
  assert.equal(late.verdict, "desista");
  assert.equal(late.why, "prazo");
  assert.match(late.text, /fique no 2★/);
  const few = threeStar(
    { ...k, own: 2, free: 21, upper: 21 },
    { level: 6, rollLevel: 6, gold: 90, floor: 50, rounds: 8, stage: 4 },
  );
  assert.equal(few.verdict, "segure");
  assert.equal(few.why, "copias");
});

test("plano com 3★ de reroll: a linha 'Role por' traz cópias/9, a chance agora e em várias rodadas", () => {
  const h = huntPlan({
    level: 6,
    budget: huntBudget({ gold: 62, floor: 50, level: 6 }),
    three: { rollLevel: 6, rounds: 5, deadline: "4-1", stage: 3 },
    pieces: [
      piece({
        id: "K",
        name: "Kayle",
        cost: 2,
        own: 4,
        goal: 9,
        free: 21,
        upper: 21,
        denom: DENOM[2],
        value: 2,
        carry: true,
        star3: true,
      }),
    ],
  });
  assert.equal(h.verdict.kind, "role");
  assert.equal(h.verdict.spend, 12);
  assert.equal(h.verdict.keep, 50);
  assert.match(
    h.headline,
    /^Role por: Kayle \(3★ 4\/9 · .+ agora · \d+% em 5 rodadas\)$/,
  );
});

test("valor da estrela: mediana medida por custo, e a célula do campeão encolhida pelas partidas", () => {
  assert.equal(starValue({ cost: 4, from: 2, to: 3 }), HUNT.starGain[3][3]);
  assert.ok(
    starValue({ cost: 2, from: 1, to: 3 }) >
      starValue({ cost: 2, from: 1, to: 2 }),
  );
  const stats = { unit: { "K|2": [4.5, 10000], "K|3": [2.5, 500] } },
    v = starValue({ stats, id: "K", cost: 2, from: 2, to: 3 });
  // Metade do peso na célula (500 partidas = shrinkGames) e metade na mediana do custo 2.
  assert.ok(Math.abs(v - (0.5 * 2 + 0.5 * HUNT.starGain[3][1])) < 1e-9);
  assert.equal(
    starValue({ cost: 3, from: 0, to: 1 }),
    POLICY.newUnitWeight * HUNT.starGain[2][2],
  );
});

test("disputa do 3★ tem um dono só: economy.mjs reexporta a regra de core/roll/hunt.mjs", () => {
  assert.equal(fromEconomy, isContested);
  assert.equal(isContested({ cost: 3, enemy: 4, hidden: 2 }), true);
  assert.equal(isContested({ cost: 3, enemy: 2, hidden: 1 }), false);
});

test("rollFor: rolar sempre diz por quem, em ordem (evolução antes da peça que falta), com o ouro em cada alvo", () => {
  const budget = huntBudget({ gold: 75, floor: 50, level: 7 }),
    h = huntPlan({
      level: 7,
      budget,
      pieces: [
        piece({
          id: "N",
          name: "Diana",
          own: 0,
          goal: 1,
          free: 16,
          value: 0.5,
        }),
        piece({
          id: "M",
          name: "Master Yi",
          own: 2,
          goal: 3,
          free: 15,
          value: 1,
          holders: [{ name: "Ana", copies: null }],
        }),
      ],
    }),
    rf = rollFor(h, {
      go: true,
      shop: new Map([["N", { slots: [2], buy: 1 }]]),
    });
  assert.equal(rf.go, true);
  assert.equal(rf.spend, 25);
  assert.equal(rf.keep, 50);
  assert.equal(rf.text, "Role 25g (até 12 lojas), pare em 50g");
  assert.deepEqual(
    rf.targets.map((t) => [t.name, t.goal, t.have]),
    [
      ["Master Yi", "2★", "2/3"],
      ["Diana", "falta", "0/1"],
    ],
  );
  assert.match(rf.targets[0].text, /^Master Yi 2★ · \d+% com 25g$/);
  assert.deepEqual(rf.targets[0].rivals.names, ["Ana"]);
  assert.equal(rf.targets[1].inShop, true);
  assert.deepEqual(rf.targets[1].slots, [2]);
  // Sem a decisão de rolar (ou sem alvo com chance) não há alvo: rolar sem saber por quem não é recomendação.
  assert.deepEqual(rollFor(h, { go: false }).targets, []);
  const none = huntPlan({
    level: 6,
    budget,
    pieces: [piece({ id: "D", name: "Draven", cost: 5, denom: DENOM[5] })],
  });
  assert.equal(rollFor(none, { go: true }).go, false);
});

test("3★ só é alvo quando é do reroll (star3) ou oportunista; 2★ comum não lista 'desista do 3★'", () => {
  const budget = huntBudget({ gold: 62, floor: 50, level: 6 }),
    three = { rollLevel: 6, rounds: 5, stage: 3 },
    two = piece({
      id: "V",
      name: "Vi",
      cost: 2,
      own: 3,
      goal: 9,
      free: 20,
      upper: 20,
      denom: DENOM[2],
    });
  assert.equal(
    huntPlan({ level: 6, budget, three, pieces: [two] }).targets.length,
    0,
  );
  assert.equal(
    huntPlan({ level: 6, budget, three, pieces: [two] }).dropped.length,
    0,
  );
  const star3 = huntPlan({
    level: 6,
    budget,
    three,
    pieces: [{ ...two, star3: true, own: 4 }],
  });
  assert.equal(
    star3.targets[0].three.verdict === "role" ||
      star3.targets[0].three.verdict === "segure",
    true,
  );
  const opp = huntPlan({
    level: 6,
    budget,
    three: { ...three, reroll: false },
    pieces: [{ ...two, own: 6 }],
  });
  assert.ok(opp.targets[0].three, "6 cópias de custo 2: 3★ oportunista");
});
