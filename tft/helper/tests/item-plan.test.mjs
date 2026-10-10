// Rodar com: node --test tft/helper/tests/item-plan.test.mjs
// Plano de itens: valor medido (campeão × item) com encolhimento, atribuição dos itens do jogador aos campeões da comp
// (máx. 3 por campeão), total acumulado, lista de desejos e a integração com o ranking e o score.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../engine.mjs";
import { compScore } from "../comp-score.mjs";
import { HOLD_VALUE } from "../item-holdings.mjs";
import { buildItemPlan, planPoints, SLOTS } from "../item-plan.mjs";
import { itemValueTable, MAX_VALUE, SHRINK_K } from "../item-value.mjs";

// --- Valor medido -----------------------------------------------------------------------------------------------

const stats = {
  unit: { A: [4.2, 400000], B: [4.5, 400000] },
  unitItem: {
    "A|DA_Big": [3.9, 100000], // 0,3 melhor que o campeão, amostra grande
    "A|DA_Small": [3.9, 1000], // o mesmo ganho, amostra pequena
    "A|DA_Worse": [4.5, 100000], // pior que o campeão: valor negativo
    "A|DA_Huge": [1.0, 1e9], // ganho absurdo: sobe até o teto
  },
};

test("valor medido: ganho do campeão com o item contra o campeão, encolhido pela amostra", () => {
  const t = itemValueTable({ stats, baseAvg: 4.45 });
  const big = t.valueOf("A", "DA_Big"),
    small = t.valueOf("A", "DA_Small");
  assert.equal(big.source, "par");
  assert.equal(big.samples, 100000);
  assert.equal(
    big.value,
    Math.round(0.3 * (100000 / (100000 + SHRINK_K)) * 1000) / 1000,
  );
  assert.equal(
    small.value,
    Math.round(0.3 * (1000 / (1000 + SHRINK_K)) * 1000) / 1000,
  );
  assert.ok(big.value > 4 * small.value, "amostra pequena quase não conta");
  assert.ok(big.confidence > 0.9 && small.confidence < 0.2);
  assert.ok(
    t.valueOf("A", "DA_Worse").value < 0,
    "item pior que o campeão sem ele vale negativo",
  );
  assert.equal(t.valueOf("A", "DA_Huge").value, MAX_VALUE, "teto");
  assert.equal(
    t.valueOf("A", "DA_BigRadiant").value,
    big.value,
    "radiante vale o item base",
  );
  assert.equal(t.valueOf("A", "DA_Big_Radiant").value, big.value);
  assert.equal(t.valueOf("A", "DA_Nada"), null, "sem dado: sem valor");
});

test("valor medido: sem par medido cai na build de meta, com confiança baixa; sem nenhuma, não inventa", () => {
  const itemStats = {
      DA_Meta: { count: 500000, avg: 4.25 },
      DA_Out: { count: 500000, avg: 4.0 },
    },
    t = itemValueTable({
      stats: { unit: {}, unitItem: {} },
      itemStats,
      metaBuilds: new Map([["A", ["DA_Meta"]]]),
      baseAvg: 4.45,
    }),
    m = t.valueOf("A", "DA_Meta");
  assert.equal(m.source, "build-meta");
  assert.ok(
    m.value > 0 && m.value < 0.2 * 0.5 + 1e-9,
    `valor ${m.value} (0,2 de ganho × confiança ≤ 0,5)`,
  );
  assert.ok(m.confidence <= 0.5);
  assert.equal(
    t.valueOf("A", "DA_Out"),
    null,
    "item bom no geral, mas fora da build do campeão: sem dado",
  );
  assert.deepEqual(
    t.rankedOf("A").map((x) => x.id),
    ["DA_Meta"],
  );
});

// --- Atribuição ------------------------------------------------------------------------------------------------

// Tabela sintética: { "campeão|item": valor }. Ids de item "DA_X"; componentes "DA_Component_P".
const fixture = (values) => {
  const valueOf = (u, item) => {
    const v = values[`${u}|${item.replace(/_?Radiant$/, "")}`];
    return v == null
      ? null
      : { value: v, confidence: 1, samples: 1000, source: "par" };
  };
  const rankedOf = (u) =>
    Object.entries(values)
      .filter(([k]) => k.startsWith(`${u}|`))
      .map(([k, v]) => ({
        id: k.split("|")[1],
        m: { value: v, confidence: 1, samples: 1000, source: "par" },
      }))
      .filter((x) => x.m.value > 0)
      .sort((a, b) => b.m.value - a.m.value);
  return { valueOf, rankedOf };
};
const unit = (id, extra = {}) => ({
  id,
  name: id,
  owned: true,
  equipped: [],
  ...extra,
});
const BANK = HOLD_VALUE.bank;
const near = (a, b) => assert.ok(Math.abs(a - b) < 2e-3, `${a} ≠ ${b}`);

test("atribuição ótima (calculada à mão): dois campeões, três itens, o melhor item de um é o único do outro", () => {
  // A tem só uma vaga (2 emblemas equipados); B tem 3. Valores: A: X .4  Y .3  Z .1 · B: X .2  Y .35  Z .3.
  // A=X + B=Y,Z = .4+.35+.3 = 1,05 (A=Y dá .8; A=Z dá .65). Tudo do banco: × 0,98.
  const f = fixture({
    "A|DA_X": 0.4,
    "A|DA_Y": 0.3,
    "A|DA_Z": 0.1,
    "B|DA_X": 0.2,
    "B|DA_Y": 0.35,
    "B|DA_Z": 0.3,
  });
  const plan = buildItemPlan({
    units: [
      unit("A", { equipped: ["DA_18_EmblemLunar", "DA_18_EmblemFae"] }),
      unit("B"),
    ],
    bank: ["DA_X", "DA_Y", "DA_Z"],
    ...f,
  });
  const pairs = plan.assignments
    .map((a) => `${a.champion.id}:${a.item.id}`)
    .sort();
  assert.deepEqual(pairs, ["A:DA_X", "B:DA_Y", "B:DA_Z"]);
  near(plan.total, 1.05 * BANK);
  assert.deepEqual(
    plan.champions.map((c) => c.champion.id),
    ["B", "A"],
    "B soma .65, A soma .4: B é o campeão de maior impacto",
  );
});

test("atribuição exata: o melhor par isolado (A+X) não é o melhor conjunto (A leva Y, B leva X)", () => {
  // Uma vaga cada (2 emblemas). A: X .5 Y .4 · B: X .45 e Y sem valor. O melhor par isolado é A+X (.5), mas
  // então B fica sem nada: .5. O ótimo é A+Y (.4) e B+X (.45) = .85.
  const f = fixture({ "A|DA_X": 0.5, "A|DA_Y": 0.4, "B|DA_X": 0.45 });
  const full = ["DA_18_EmblemLunar", "DA_18_EmblemFae"];
  const plan = buildItemPlan({
    units: [unit("A", { equipped: full }), unit("B", { equipped: full })],
    bank: ["DA_X", "DA_Y"],
    ...f,
  });
  near(plan.total, 0.85 * BANK);
  assert.deepEqual(
    plan.assignments.map((a) => `${a.champion.id}:${a.item.id}`).sort(),
    ["A:DA_Y", "B:DA_X"],
  );
});

// Força bruta: cada item vai a um campeão ou a ninguém, no máximo SLOTS por campeão e sem repetir item no campeão.
function optimum(values, units, items, caps) {
  let best = 0;
  const walk = (i, used, sum) => {
    if (i === items.length) return void (best = Math.max(best, sum));
    walk(i + 1, used, sum);
    units.forEach((u, k) => {
      const v = values[`${u}|${items[i]}`] ?? 0;
      if (v <= 0 || used[k].length >= caps[k] || used[k].includes(items[i]))
        return;
      used[k].push(items[i]);
      walk(i + 1, used, sum + v);
      used[k].pop();
    });
  };
  walk(
    0,
    units.map(() => []),
    0,
  );
  return best;
}

test("em instâncias pequenas aleatórias (semente fixa), o plano iguala a força bruta", () => {
  let seed = 12345;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 150; n++) {
    const us = ["A", "B", "C"].slice(0, 2 + Math.floor(rnd() * 2)),
      items = ["DA_I1", "DA_I2", "DA_I3", "DA_I4", "DA_I5"].slice(
        0,
        2 + Math.floor(rnd() * 4),
      ),
      values = {},
      caps = us.map(() => 1 + Math.floor(rnd() * SLOTS));
    for (const u of us)
      for (const i of items)
        if (rnd() < 0.75) values[`${u}|${i}`] = Math.round(rnd() * 100) / 100;
    const plan = buildItemPlan({
      units: us.map((u, k) =>
        unit(u, { equipped: Array(SLOTS - caps[k]).fill("DA_18_EmblemLunar") }),
      ),
      bank: items,
      ...fixture(values),
    });
    near(plan.total, optimum(values, us, items, caps) * BANK);
  }
});

test("carries emergentes: o campeão de maior impacto muda conforme os itens do banco", () => {
  const f = fixture({
    "A|DA_X": 0.4,
    "B|DA_Y": 0.45,
    "A|DA_Y": 0.1,
    "B|DA_X": 0.05,
  });
  const units = [unit("A"), unit("B")];
  const top = (bank) =>
    buildItemPlan({ units, bank, ...f }).champions[0].champion.id;
  assert.equal(top(["DA_X"]), "A");
  assert.equal(top(["DA_Y"]), "B");
  assert.equal(top(["DA_X", "DA_Y"]), "B", "com os dois, B soma .45 e A .4");
});

test("os valores acumulam: cada item útil a mais soma ao total, e item sem valor não soma", () => {
  const f = fixture({ "A|DA_X": 0.3, "A|DA_Y": 0.2, "A|DA_Z": 0.1 });
  const total = (bank) =>
    buildItemPlan({ units: [unit("A")], bank, ...f }).total;
  const one = total(["DA_X"]),
    two = total(["DA_X", "DA_Y"]),
    three = total(["DA_X", "DA_Y", "DA_Z"]);
  near(one, 0.3 * BANK);
  near(two, 0.5 * BANK);
  near(three, 0.6 * BANK);
  assert.equal(
    total(["DA_X", "DA_Y", "DA_Z", "DA_Nada"]),
    three,
    "item sem valor em nenhum campeão fica de fora",
  );
  assert.ok(
    planPoints(three) > planPoints(two) && planPoints(two) > planPoints(one),
    "os pontos acompanham, com retorno decrescente",
  );
  assert.ok(
    planPoints(two) - planPoints(one) > planPoints(three) - planPoints(two) - 5,
  );
  // Limite de 3 itens por campeão.
  const four = buildItemPlan({
    units: [unit("A")],
    bank: ["DA_X", "DA_Y", "DA_Z", "DA_W"],
    ...fixture({ "A|DA_X": 0.4, "A|DA_Y": 0.3, "A|DA_Z": 0.2, "A|DA_W": 0.1 }),
  });
  assert.equal(four.assignments.length, SLOTS);
  assert.ok(
    !four.assignments.some((a) => a.item.id === "DA_W"),
    "fica de fora o de menor valor",
  );
});

test("situação e custo: equipado > banco > mover de quem sai > mover de quem fica; componentes montam uma vez", () => {
  const f = fixture({ "A|DA_X": 0.4, "A|DA_R": 0.3, "B|DA_R": 0.25 });
  const recipes = new Map([["DA_R", ["DA_Component_P", "DA_Component_Q"]]]);
  const one = (extra) =>
    buildItemPlan({
      units: [unit("A", extra.a), unit("B")],
      recipes,
      ...f,
      ...extra.rest,
    }).assignments;
  const on = one({ a: { equipped: ["DA_X"] }, rest: {} })[0];
  assert.deepEqual([on.situation, on.kind, on.from], ["equipado", "on", null]);
  near(on.value, 0.4);
  const bank = one({ rest: { bank: ["DA_X"] } })[0];
  assert.deepEqual([bank.situation, bank.kind], ["banco", "bank"]);
  near(bank.value, 0.4 * HOLD_VALUE.bank);
  const leaving = one({
    rest: { leaving: [{ name: "Fora", items: ["DA_X"] }] },
  })[0];
  assert.deepEqual([leaving.situation, leaving.from], ["mover", "Fora"]);
  near(leaving.value, 0.4 * HOLD_VALUE.move);
  const staying = one({ a: {}, rest: { bank: [] } });
  assert.deepEqual(staying, []);
  const moveStay = buildItemPlan({
    units: [unit("A"), unit("B", { equipped: ["DA_X"] })],
    ...f,
  }).assignments[0];
  assert.deepEqual(
    [moveStay.champion.id, moveStay.kind, moveStay.from],
    ["A", "moveStay", "B"],
  );
  // Montar: um par de componentes faz um DA_R, só um (o par de componentes não se repete).
  const craft = one({ rest: { bank: ["DA_Component_P", "DA_Component_Q"] } });
  assert.equal(craft.length, 1);
  assert.deepEqual(
    [craft[0].champion.id, craft[0].situation, craft[0].componentsNeeded],
    ["A", "montar", ["DA_Component_P", "DA_Component_Q"]],
  );
  near(craft[0].value, 0.3 * HOLD_VALUE.craft);
  const twice = one({
    rest: { bank: ["DA_Component_P", "DA_Component_Q", "DA_Component_P"] },
  });
  assert.equal(twice.length, 1, "o terceiro componente não faz nada sozinho");
  const two = one({
    rest: {
      bank: [
        "DA_Component_P",
        "DA_Component_Q",
        "DA_Component_P",
        "DA_Component_Q",
      ],
    },
  });
  assert.deepEqual(
    two.map((a) => a.champion.id).sort(),
    ["A", "B"],
    "dois pares: A e B levam um DA_R cada",
  );
  // Componentes soltos em quem sai também montam, com custo maior.
  const loose = one({
    rest: {
      leaving: [{ name: "Fora", items: ["DA_Component_P", "DA_Component_Q"] }],
    },
  })[0];
  assert.equal(loose.kind, "craftMove");
  near(loose.value, 0.3 * HOLD_VALUE.craftMove);
});

test("radiante vale o item base; emblema ocupa vaga e fica fora do plano", () => {
  const f = fixture({ "A|DA_X": 0.4 });
  const radiant = buildItemPlan({
    units: [unit("A")],
    leaving: [{ name: "Fora", items: ["DA_X_Radiant"] }],
    ...f,
  }).assignments[0];
  assert.equal(radiant.item.id, "DA_X");
  assert.equal(radiant.item.radiant, true);
  near(radiant.value, 0.4 * HOLD_VALUE.move);
  // Dois emblemas na peça que fica: sobra 1 vaga; o emblema não vira atribuição nem desejo.
  const emblem = buildItemPlan({
    units: [unit("A", { equipped: ["DA_18_EmblemLunar", "DA_18_EmblemFae"] })],
    bank: ["DA_X", "DA_Y"],
    ...fixture({ "A|DA_X": 0.4, "A|DA_Y": 0.3, "A|DA_18_EmblemLunar": 0.9 }),
  });
  assert.deepEqual(
    emblem.assignments.map((a) => a.item.id),
    ["DA_X"],
  );
  assert.ok(
    !emblem.wishlist.some((w) => w.items.some((i) => /Emblem/.test(i.item.id))),
    "emblema não vai para a lista de desejos",
  );
});

test("lista de desejos: melhores itens do meta que você ainda não tem, ordenados por valor, separada da atribuição", () => {
  const f = fixture({
    "A|DA_X": 0.4,
    "A|DA_Y": 0.3,
    "A|DA_Z": 0.2,
    "B|DA_Y": 0.1,
  });
  const plan = buildItemPlan({
    units: [unit("A"), unit("B")],
    bank: ["DA_X"],
    recipes: new Map([["DA_Y", ["DA_Component_P", "DA_Component_Q"]]]),
    ...f,
  });
  assert.deepEqual(
    plan.assignments.map((a) => a.item.id),
    ["DA_X"],
  );
  const a = plan.wishlist.find((w) => w.champion.id === "A");
  assert.deepEqual(
    a.items.map((i) => i.item.id),
    ["DA_Y", "DA_Z"],
    "DA_X já está no banco",
  );
  assert.deepEqual(a.items[0].componentsNeeded, [
    "DA_Component_P",
    "DA_Component_Q",
  ]);
  assert.equal(
    plan.wishlist[0].champion.id,
    "A",
    "campeões ordenados pelo melhor desejo",
  );
});

test("banco não lido: não inventa atribuição, devolve só a lista de desejos do meta", () => {
  const plan = buildItemPlan({
    units: [unit("A", { equipped: ["DA_X"] })],
    bank: ["DA_Y"],
    bankRead: false,
    ...fixture({ "A|DA_X": 0.4, "A|DA_Y": 0.3 }),
  });
  assert.equal(plan.active, false);
  assert.equal(plan.bankRead, false);
  assert.deepEqual(plan.assignments, []);
  assert.equal(plan.total, 0);
  assert.deepEqual(plan.champions, []);
  assert.deepEqual(
    plan.wishlist[0].items.map((i) => i.item.id),
    ["DA_X", "DA_Y"],
  );
});

// --- Integração com o motor e o score ---------------------------------------------------------------------------

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  catalog = JSON.parse(readFileSync(path.join(root, "catalog.json"), "utf8")),
  byName = new Map(catalog.champions.map((c) => [c.name, c])),
  HERO = 47445859,
  id = (name) => byName.get(name).apiName;
const IE = "DA_InfinityEdge",
  GS = "DA_GiantSlayer",
  BT = "DA_Bloodthirster",
  BRAMBLE = "DA_BrambleVest";
const meta = {
  base: [4.45, 1e6],
  unit: Object.fromEntries(
    ["Aphelios", "Varus", "Vi", "Amumu", "Sentinel", "Diana", "Xayah"].map(
      (n) => [id(n), [4.4, 300000]],
    ),
  ),
  unitItem: {
    [`${id("Aphelios")}|${IE}`]: [3.9, 100000],
    [`${id("Aphelios")}|${GS}`]: [4.0, 100000],
    [`${id("Varus")}|${BT}`]: [4.1, 100000],
    [`${id("Amumu")}|${BRAMBLE}`]: [4.0, 100000],
  },
  trait: {},
};
const mk = (cid, units) => ({
  id: cid,
  units: units.map(id),
  key: [id(units[0])],
  carry: id(units[0]),
  levelling: "",
  stars: [],
  stars3: [],
  rerollLevel: null,
  title: cid,
  builds: {},
  buildStats: {},
  games: 9000,
  avg: 4.4,
  top4: 52,
  win: 12,
  tier: "A",
});
const A7 = ["Aphelios", "Varus", "Vi", "Amumu", "Sentinel", "Diana", "Xayah"];
const other = ["Varus", "Vi", "Amumu", "Sentinel", "Diana", "Xayah", "Rakan"];
const piece = (name, itemNames = [], starLevel = 2) => ({
  championName: id(name),
  starLevel,
  itemNames,
  price: byName.get(name).cost,
});
const run = (hero, inventory, extra = {}) =>
  analyze(
    {
      gameId: 1,
      statsBlock: {
        setCoreName: "TFTSet18",
        players: [
          { playerId: HERO, health: 60, ffaStanding: 3, boardPieces: hero },
          {
            playerId: 101,
            health: 50,
            ffaStanding: 4,
            riotIdGameName: "R",
            boardPieces: [],
          },
        ],
      },
    },
    catalog,
    {
      level: 7,
      targetLevel: 7,
      gold: 30,
      bench: [],
      inventory,
      playerId: String(HERO),
      previewIds: [],
      baseAvg: 4.45,
      metaComps: [mk("x", A7), mk("y", other)],
      stats: meta,
      itemStats: {},
      metaBuilds: new Map(),
      conditional: new Map(),
      evidence: new Map(),
      bankRead: true,
      ...extra,
    },
  );
const row = (a, cid = "x") => a.compRanking.find((r) => r.id === cid);
const hero = () => [
  piece("Aphelios"),
  piece("Varus"),
  piece("Vi"),
  piece("Amumu"),
  piece("Sentinel"),
];

test("motor: itens do banco viram atribuições por campeão, entram no total, no score e no ranking", () => {
  const none = run(hero(), []),
    withIe = run(hero(), [IE]),
    both = run(hero(), [IE, BT, BRAMBLE]);
  assert.equal(row(none).itemPlan.total, 0);
  const a = row(withIe).itemPlan.assignments[0];
  assert.deepEqual(
    [a.champion.name, a.item.id, a.situation],
    ["Aphelios", IE, "banco"],
  );
  assert.equal(a.samples, 100000);
  assert.ok(a.confidence > 0.9);
  // (4,4 − 3,9) × 100000/(100000+5000) × 0,98 de custo do banco
  assert.ok(a.value > 0.45 && a.value < 0.48, `${a.value}`);
  assert.deepEqual(
    row(withIe, "y").itemPlan.assignments,
    [],
    "a comp sem o Aphelios não tem onde pôr o IE",
  );
  assert.ok(row(withIe).score > row(none).score, "score sobe");
  assert.ok(row(withIe).total > row(none).total, "total sobe");
  assert.ok(
    row(withIe).rank < row(withIe, "y").rank,
    "a comp que aproveita o item vem antes",
  );
  // Acumula: mais itens úteis, mais total, mais score; Bramble no Amumu e BT no Varus emergem como outros campeões de impacto.
  assert.ok(row(both).itemPlan.total > row(withIe).itemPlan.total);
  assert.ok(row(both).score > row(withIe).score);
  assert.deepEqual(
    row(both).itemPlan.champions.map((c) => c.champion.name),
    ["Aphelios", "Amumu", "Varus"],
  );
  // O mesmo banco rende menos na comp que tem só parte dos campeões.
  assert.ok(row(both).itemPlan.total > row(both, "y").itemPlan.total);
});

test("motor: item de peça que sai conta e muda o campeão de maior impacto", () => {
  const leaving = run([...hero(), piece("Lillia", [IE])], []),
    a = row(leaving).itemPlan.assignments[0];
  assert.deepEqual([a.item.id, a.situation, a.from], [IE, "mover", "Lillia"]);
  // Sem o Aphelios na comp, o mesmo IE não rende (Aphelios é o único com valor medido nele).
  assert.equal(row(leaving, "y").itemPlan.total, 0);
  // IE no Aphelios vs. GS: com o IE o Aphelios é o de maior impacto; com Bramble, o Amumu.
  assert.equal(
    row(run(hero(), [BRAMBLE])).itemPlan.champions[0].champion.name,
    "Amumu",
  );
  assert.equal(
    row(run(hero(), [IE])).itemPlan.champions[0].champion.name,
    "Aphelios",
  );
});

test("motor: banco não lido devolve só a lista de desejos e mantém a conta de antes no ranking", () => {
  const unread = run(hero(), [IE], { bankRead: false }),
    p = row(unread).itemPlan;
  assert.equal(p.bankRead, false);
  assert.deepEqual(p.assignments, []);
  assert.ok(
    p.wishlist.some(
      (w) => w.champion.name === "Aphelios" && w.items[0].item.id === IE,
    ),
  );
  assert.equal(
    row(unread).scoreParts.items,
    row(run(hero(), [IE], { bankRead: false })).scoreParts.items,
  );
});

test("motor: sem itens a ordem e o score não mudam entre banco lido e não lido", () => {
  const read = run(hero(), []),
    unread = run(hero(), [], { bankRead: false });
  assert.deepEqual(
    read.compRanking.map((r) => [r.id, r.rank, r.score, r.total]),
    unread.compRanking.map((r) => [r.id, r.rank, r.score, r.total]),
  );
});

test("score: o total do plano soma com retorno decrescente; sem plano, a conta de antes", () => {
  const base = { expected: 4.4, chanceNow: 0.5, held: 0.3 };
  const s = (itemPlan) => compScore({ ...base, itemPlan }).parts.items;
  assert.equal(s(0), 0);
  assert.ok(s(0.5) < s(1) && s(1) < s(2) && s(2) < s(4));
  assert.ok(s(1) - s(0.5) > s(4) - s(3.5), "retorno decrescente");
  assert.ok(
    s(50) <= 0.6 + 1e-9,
    "o plano sozinho vale até 60% da parte de itens; o resto vem da build publicada da comp",
  );
  assert.equal(
    compScore({ ...base, itemGain: 0.3, carryItems: 3, carryWanted: 3 }).parts
      .items,
    1,
    "sem plano: conta antiga",
  );
});

test("motor: o plano é reaproveitado entre rodadas iguais, mas não entre cópias diferentes das estatísticas", () => {
  const first = run(hero(), [IE]),
    again = run(hero(), [IE]);
  assert.deepEqual(
    again.compRanking.map((r) => r.itemPlan.total),
    first.compRanking.map((r) => r.itemPlan.total),
  );
  const worse = {
      ...meta,
      unitItem: {
        ...meta.unitItem,
        [`${id("Aphelios")}|${IE}`]: [4.3, 100000],
      },
    },
    changed = run(hero(), [IE], { stats: worse });
  assert.ok(
    row(changed).itemPlan.total < row(first).itemPlan.total,
    "estatística nova, valor novo (sem plano velho em cache)",
  );
});
