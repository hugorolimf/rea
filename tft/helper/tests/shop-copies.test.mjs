// Rodar com: node --test tft/helper/tests/shop-copies.test.mjs
// Cartas iguais na mesma loja: cada uma desconta as cópias que as anteriores já trazem (core/pool/buy-copies.mjs
// `shopCopies`, usado por stage.mjs). Antes, duas cartas iguais com 2 cópias suas diziam as duas "fecha um 2★".
import { test } from "node:test";
import assert from "node:assert/strict";
import { shopCopies } from "../core/pool/buy-copies.mjs";
import { stagePlan } from "../stage.mjs";
import { makeState } from "./fixtures.mjs";

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

/** Loja lida com `shop` (nomes) e as cópias suas em campo/reserva; devolve as cartas classificadas por stage.mjs. */
function shopOf({
  shop,
  units,
  reserve = [],
  gold = 54,
  hp = 80,
  stage = "3-2",
  tweak,
}) {
  const s = makeState({
    gold,
    hp,
    stage,
    rivals: { count: 7, cost: 1, stars: 1, size: 2 },
    units,
    reserve,
  });
  tweak?.(s);
  s.options.shop = shop.map((n) => `TFT_${n}`);
  return stagePlan(s.plan, s.analysis, catalog, s.options).shop;
}

test("shopCopies: uma carta só mantém a regra de sempre (3ª e 6ª cópias fecham 2★, a 9ª fecha o 3★)", () => {
  const one = (own) => shopCopies(own, 1)[0].completes;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map(one), [
    null,
    null,
    "fecha um 2★",
    null,
    null,
    "fecha um 2★",
    null,
    null,
    "fecha 3★",
  ]);
  assert.equal(shopCopies(9, 1)[0].text, "cópia extra: a peça já é 3★");
});

test("shopCopies: 2 cópias + 2 cartas iguais -> a 1ª fecha o 2★, a 2ª é cópia a mais rumo ao 3★", () => {
  const [a, b] = shopCopies(2, 2);
  assert.equal(a.completes, "fecha um 2★");
  assert.equal(b.completes, null);
  assert.equal(b.closer, null);
  assert.match(b.text, /cópia a mais rumo ao 3★ \(4\/9/);
});

test("shopCopies: 1 cópia + 2 cartas -> as duas juntas fecham o 2★ (a 2ª fecha, a 1ª vai junto)", () => {
  const [a, b] = shopCopies(1, 2);
  assert.equal(a.completes, null);
  assert.equal(a.closer, 1);
  assert.equal(b.completes, "fecha um 2★");
});

test("shopCopies: rumo ao 3★ com 7 e 8 cópias", () => {
  const seven = shopCopies(7, 3);
  assert.deepEqual(
    seven.map((s) => [s.completes, s.closer]),
    [
      [null, 1],
      ["fecha 3★", null],
      [null, null],
    ],
  );
  assert.match(seven[2].text, /cópia extra: .*já fecham o 3★/);
  const eight = shopCopies(8, 2);
  assert.equal(eight[0].completes, "fecha 3★");
  assert.equal(eight[1].completes, null);
  assert.match(eight[1].text, /já fecham o 3★/);
});

test("loja: 2 cartas iguais e 2 cópias suas (campo + reserva) -> só a 1ª diz que fecha o 2★", () => {
  const [a, b] = shopOf({
    shop: ["Varus", "Varus"],
    units: [
      ["Aphelios", 4, 1, 0],
      ["Varus", 1, 1, 0],
    ],
    reserve: [["Varus", 1, 1]],
  });
  assert.equal(a.completes, "fecha um 2★");
  assert.match(a.reason, /peça da meta · fecha um 2★/);
  assert.equal(b.completes, null);
  assert.doesNotMatch(b.reason, /fecha um 2★/);
  assert.match(
    b.reason,
    /cópia a mais rumo ao 3★ \(4\/9 com as cartas anteriores desta loja\)/,
  );
  // As duas continuam compráveis (peça da meta), a que fecha estrela vem primeiro no orçamento.
  assert.deepEqual([a.action, b.action], ["comprar", "comprar"]);
  assert.ok(a.priority > b.priority);
});

test("loja: a reserva do GEP conta como cópia sua mesmo que a pool não a tenha somado", () => {
  const [a, b] = shopOf({
    shop: ["Varus", "Varus"],
    units: [
      ["Aphelios", 4, 1, 0],
      ["Varus", 1, 1, 0],
    ],
    reserve: [["Varus", 1, 1]],
    // Pool sem a reserva (só a cópia em campo): o piso das peças lidas devolve as 2 cópias.
    tweak: (s) => {
      s.analysis.pool.find((p) => p.name === "Varus").own = 1;
    },
  });
  assert.equal(a.own, 2);
  assert.equal(a.completes, "fecha um 2★");
  assert.equal(b.completes, null);
});

test("loja: 1 cópia sua e 2 cartas -> a 2ª fecha o 2★ com a 1ª, que vai junto", () => {
  const [a, b] = shopOf({
    shop: ["Varus", "Aphelios", "Varus"],
    units: [
      ["Aphelios", 4, 1, 0],
      ["Varus", 1, 1, 0],
    ],
  }).filter((c) => c.name === "Varus");
  assert.equal(a.completes, null);
  assert.equal(a.closesWith, 3);
  assert.match(a.reason, /junto com a carta do slot 3, fecha um 2★/);
  assert.equal(b.completes, "fecha um 2★");
  assert.match(b.reason, /fecha um 2★ \(com a carta do slot 1\)/);
  assert.equal(a.priority, b.priority);
});

test("loja: 7 cópias (rumo ao 3★) -> uma carta só sobe; com duas, a 2ª fecha o 3★; a 3ª é extra", () => {
  const units = [
    ["Aphelios", 4, 1, 0],
    ["Varus", 1, 2, 0],
  ];
  const reserve = [
    ["Varus", 1, 2],
    ["Varus", 1, 1],
  ];
  const [solo] = shopOf({ shop: ["Varus"], units, reserve });
  assert.equal(solo.own, 7);
  assert.equal(solo.completes, null);
  assert.match(solo.reason, /7 cópia\(s\) suas/);
  const [a, b, c] = shopOf({
    shop: ["Varus", "Varus", "Varus"],
    units,
    reserve,
  });
  assert.match(a.reason, /junto com a carta do slot 2, fecha 3★/);
  assert.equal(b.completes, "fecha 3★");
  assert.equal(c.completes, null);
  assert.equal(c.closesWith, null);
  assert.doesNotMatch(c.reason, /fecha 3★/);
  assert.match(
    c.reason,
    /cópia extra: as cartas anteriores desta loja já fecham o 3★/,
  );
});

test("loja: em perigo, a cópia fora do plano que fecha estrela só com a outra carta igual vai junto; sozinha fica", () => {
  const danger = (shop) =>
    shopOf({
      shop,
      gold: 30,
      hp: 42,
      stage: "4-2",
      units: [
        ["Aphelios", 4, 1, 0],
        ["Poppy", 1, 1, 0],
      ],
    });
  assert.equal(danger(["Poppy"])[0].action, "segurar");
  const pair = danger(["Poppy", "Poppy"]);
  assert.deepEqual(
    pair.map((c) => c.action),
    ["comprar", "comprar"],
  );
  assert.equal(pair[1].completes, "fecha um 2★");
});
