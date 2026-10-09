// Rodar com: node --test tft/helper/v2/js/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCurve, buildEconomy, buildModel } from "./model.js";
import { binomialTail } from "./math.js";

const { state, rec } = JSON.parse(
  readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
);
const live = () => {
  const s = structuredClone(state),
    r = structuredClone(rec);
  s.screen = {
    running: true,
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: [],
  };
  r.metadata.actionable = true;
  r.self.health = 58;
  return { state: s, rec: r };
};

test("modelo ao vivo: números do HUD vêm da tela e a fase é interpretada", () => {
  const m = buildModel(live());
  assert.equal(m.status.live, true);
  assert.deepEqual(m.hero.stage, { stage: 4, round: 2 });
  assert.deepEqual(m.hero.xp, { have: 23, total: 68 });
  assert.equal(m.hero.gold, 54);
  assert.equal(m.hero.level, 8);
  assert.equal(m.hero.levelSource, "tela");
});

test("partida encerrada nunca é considerada ao vivo", () => {
  const input = live();
  input.rec.self.health = 0;
  const m = buildModel(input);
  assert.equal(m.status.live, false);
  assert.equal(m.status.ended, true);
});

test("partida acompanhada: -1 de vida no primeiro tabuleiro não encerra; resultado e espera vêm do servidor", () => {
  const input = live();
  input.rec.self.health = -1;
  input.state.match = { id: 2, status: "live", boardReady: true };
  let m = buildModel(input);
  assert.equal(m.status.ended, false);
  assert.equal(m.status.live, false);
  input.state.match = {
    id: 2,
    status: "ended",
    placement: 3,
    boardReady: true,
  };
  m = buildModel(input);
  assert.equal(m.status.ended, true);
  assert.equal(m.status.placement, 3);
  input.state.match = { id: 3, status: "live", boardReady: false };
  input.rec.self.health = 58;
  m = buildModel(input);
  assert.equal(m.status.waiting, true);
  assert.equal(m.status.live, false);
});

test("formação: cada posição vira uma célula única com status e custo", () => {
  const m = buildModel(live()),
    ids = m.plan.cells.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of m.plan.cells) {
    assert.ok(c.row >= 0 && c.row < 4 && c.col >= 0 && c.col < 7);
    assert.ok(["owned", "incoming", "reserve"].includes(c.status));
    assert.ok(c.cost >= 1 && c.cost <= 5);
  }
  assert.equal(m.plan.cells.filter((c) => c.carry).length <= 1, true);
});

test("trocas: classificação ready/hold/slot e passos agrupados sem duplicar", () => {
  const input = live();
  input.rec.recommendations[0].transitions = [
    {
      enter: { id: "DA_18_Aphelios", name: "Aphelios" },
      exit: { id: "DA_Vi18", name: "Vi", items: ["x", "y"] },
      ready: true,
      enterCopies: 3,
      requiredStars: 2,
    },
    {
      enter: { id: "DA_18_Rakan", name: "Rakan" },
      exit: { id: "DA_Nidalee18_AP", name: "Nidalee", items: [] },
      ready: false,
      enterCopies: 1,
      requiredStars: 2,
    },
    {
      enter: { id: "DA_18_Xayah", name: "Xayah" },
      exit: null,
      source: "reserve",
    },
    {
      enter: { id: "DA_Krug18", name: "Krug" },
      exit: { id: "DA_Sentinel18", name: "Sentinel", items: [] },
      ready: false,
      requiredStars: null,
    },
  ];
  const m = buildModel(input);
  assert.deepEqual(
    m.plan.dock.map((d) => d.kind),
    ["ready", "hold", "slot", "blocked"],
  );
  assert.equal(m.plan.dock[0].held, 2);
  assert.equal(m.plan.dock[1].need, 3);
  assert.equal(m.plan.dock[1].have, 1);
  assert.deepEqual(m.plan.counts, { ready: 1, hold: 1 });
  const byId = Object.fromEntries(m.plan.steps.map((s) => [s.id, s]));
  assert.equal(byId.swap.rows.length, 1);
  assert.equal(byId.hold.rows.length, 2, "hold inclui as bloqueadas");
  assert.equal(byId.slot.rows.length, 1);
  assert.ok(m.plan.steps.every((s) => ["now", "items"].includes(s.group)));
  const keys = m.plan.steps.flatMap((s) =>
    s.rows.map((r) => `${s.id}:${r.key}`),
  );
  assert.equal(new Set(keys).size, keys.length, "chaves de linha únicas");
});

test("trilho de nível marca nível atual, próximo (quando sobe) e níveis de roll/final", () => {
  const input = live(),
    p = input.rec.recommendations[0];
  p.strategy = {
    action: "SUBIR NÍVEL",
    headline: "Suba",
    steps: [],
    reasons: [],
    panels: {
      economy: { gold: 44, interest: 4, next: 50, keep: 10 },
      leveling: {
        level: 7,
        xp: { have: 40, total: 68 },
        cost: 4,
        go: true,
        curve: 7,
        finalLevel: 9,
      },
      rolling: {
        level: 7,
        at: 8,
        go: false,
        spend: 0,
        shops: 0,
        keep: null,
        targets: [],
      },
    },
  };
  const { panel } = buildModel(input).plan,
    byN = Object.fromEntries(panel.level.nodes.map((n) => [n.n, n]));
  assert.equal(byN[7].state, "now");
  assert.equal(byN[8].next, true);
  assert.equal(byN[8].roll, true);
  assert.equal(byN[9].final, true);
  assert.equal(panel.tone, "subirnvel");
});

test("curva de chance sem dados do servidor: binomial por loja, eixo em ouro, quantil 80%", () => {
  const target = {
    id: "a",
    name: "Aphelios",
    goalStars: 2,
    own: 1,
    goal: 3,
    need: 3,
    chancePerShop: 0.12,
  };
  const c = buildCurve(target, 30);
  assert.equal(c.k, 2);
  assert.equal(c.exact, false);
  for (let i = 1; i < c.points.length; i++) {
    assert.ok(c.points[i].v >= c.points[i - 1].v);
    assert.equal(c.points[i].g - c.points[i - 1].g, 2);
  }
  assert.ok(Math.abs(c.plannedValue - binomialTail(2, 15, 0.12)) < 1e-12);
  const shops = c.q80 / 2;
  assert.ok(
    binomialTail(2, shops, 0.12) >= 0.8 &&
      binomialTail(2, shops - 1, 0.12) < 0.8,
  );
  assert.equal(buildCurve(null, 3), null);
});

test("curva de chance do servidor: usa a curva exata e a chance desta rolagem", () => {
  const c = buildCurve(
    {
      name: "Aphelios",
      goalStars: 2,
      own: 1,
      need: 3,
      chancePerShop: 0.12,
      chanceInRoll: 0.4321,
      curve: {
        level: 8,
        step: 2,
        p: [0, 0, 0.05, 0.12, 0.25, 0.4, 0.55],
        q50: 12,
        q80: 30,
        q95: 44,
      },
    },
    9,
  );
  assert.equal(c.exact, true);
  assert.equal(c.level, 8);
  assert.equal(c.maxG, 12);
  assert.deepEqual(c.points[3], { g: 6, v: 0.12 });
  assert.equal(c.q80, 30);
  assert.equal(c.planned, 9);
  assert.equal(c.plannedValue, 0.4321);
});

test("economia: fluxo agora → depois → rodadas, renda decomposta e sequência", () => {
  const e = buildEconomy(
    {
      gold: 54,
      after: 24,
      interest: 5,
      next: null,
      keep: 24,
      shopSpend: 4,
      income: { base: 5, interest: 2, streak: 1, total: 8 },
      projection: [
        { label: "4-3", gold: 32, income: 8 },
        { label: "4-4", gold: 41, income: 9 },
        { label: "4-5", gold: 51, income: 10 },
      ],
      streak: { kind: "loss", length: 3, gold: 1 },
      sellable: { gold: 0, units: [] },
    },
    true,
    "ROLAR",
  );
  assert.equal(e.spend, 30);
  assert.equal(e.afterInterest, 2);
  assert.deepEqual(
    e.incomeParts.map((p) => [p.kind, p.value]),
    [
      ["base", 5],
      ["interest", 2],
      ["loss", 1],
    ],
  );
  assert.deepEqual(
    e.projection.map((r) => [r.label, r.capped, r.reach]),
    [
      ["4-3", false, false],
      ["4-4", false, false],
      ["4-5", true, true],
    ],
  );
  assert.equal(e.reach50, "4-5");
  assert.equal(e.top, 60, "teto em degraus de 10g, sempre acima de 50g");
  assert.equal(e.streak.length, 3);
  assert.equal(e.sellable, null, "banco sem valor não aparece");
});

test("economia fora do ao vivo: sem ação, projeta do ouro atual com as contas do servidor", () => {
  const e = buildEconomy(
    { gold: 44, after: 14, projection: [{ label: "x", gold: 1 }] },
    false,
    "ROLAR",
    { stage: 4, round: 2 },
  );
  assert.equal(e.spend, 0);
  assert.equal(e.after, 44);
  assert.equal(e.shopSpend, 0);
  assert.deepEqual(
    e.projection.map((r) => [r.label, r.gold]),
    [
      ["4-3", 53],
      ["4-4", 63],
      ["4-5", 73],
      ["4-6", 83],
    ],
  );
  assert.equal(e.reach50, "4-3");
  assert.equal(e.top, 90);
  assert.equal(e.income.total, 9);
  const unread = buildEconomy({ gold: null }, false, "ROLAR");
  assert.equal(unread.income, null);
  assert.deepEqual(unread.projection, []);
});

test("sem recomendação o modelo ainda devolve HUD e status", () => {
  const m = buildModel({
    state,
    rec: { recommendations: [], metadata: {}, self: { health: 10 } },
  });
  assert.equal(m.plan, null);
  assert.equal(m.hero.hp, 10);
});
