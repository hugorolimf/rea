// Pressão de vida (tft-pressao-vida): a vida em perigo encurta o prazo e valoriza a força de agora, mas não abandona nem
// faz oscilar o plano, e estabiliza com cópias e upgrades do plano. Sequências de vida tiradas de partidas reais
// (data/scouting-captures.jsonl, vida do Hero por leitura) e o golden danger-hp27 (captura real anonimizada).
import test from "node:test";
import assert from "node:assert/strict";
import { POLICY } from "../economy.mjs";
import { pressureOf } from "../core/economy/pressure.mjs";
import { streakTracker } from "../streak.mjs";
import { strategy } from "../strategy.mjs";
import { stagePlan } from "../stage.mjs";
import { suggestTargetLevel } from "../target-level.mjs";
import { buildHints } from "../overlay/hud/hints.mjs";
import { makeState } from "./fixtures.mjs";
import {
  HERO_ID,
  loadContext,
  loadSnapshots,
  runScenario,
} from "./golden/harness.mjs";
import { scenarios } from "./golden/scenarios.mjs";

const MIN = 60_000;
const stageOf = (s) => {
  const [a, b] = s.split("-").map(Number);
  return { stage: a, round: b };
};
/** Alimenta o rastreador com [estágio, vida, minuto] e devolve a tendência na última leitura. */
const feed = (rows) => {
  const t = streakTracker();
  let now = 0;
  for (const [stage, hp, min] of rows) {
    now = min * MIN;
    t.observe({ gameId: 1, stage, hp, now });
  }
  return { trend: t.trend(now), streak: t.current() };
};
// Partida real 3291352802 (vida do Hero por leitura, minutos desde o início): perde de 2-2 a 3-5.
const STREAK_3_5 = [
  ["2-1", 100, 0],
  ["2-2", 97, 1.2],
  ["2-3", 93, 2.4],
  ["2-5", 87, 5.3],
  ["3-1", 77, 8.7],
  ["3-3", 67, 9.9],
  ["3-5", 59, 13],
];

test("sequência de derrotas proposital no 2-x/3-x com vida alta e ouro guardado não é perigo", () => {
  const { trend } = feed(STREAK_3_5);
  // A conta de antes: 3 perdas na janela com vida ≤ 65 disparavam "perigo" no 3-5 com 59 de vida.
  assert.ok(
    trend.recentLosses >= POLICY.trend.losses && 59 <= POLICY.trend.lossesHp,
  );
  const at = stageOf("3-5"),
    saved = pressureOf({ hp: 59, stage: at, trend, gold: 50 });
  assert.equal(saved.danger, false);
  assert.equal(saved.band, "hurt");
  assert.equal(saved.lossStreak, true);
  // Sem a economia guardada não é sequência proposital: a tendência vale (perigo real de quem só está perdendo).
  const broke = pressureOf({ hp: 59, stage: at, trend, gold: 12 });
  assert.equal(broke.danger, true);
  assert.match(broke.why, /derrotas recentes/);
  // Ouro não lido: sem isenção (não dá para afirmar que é proposital).
  assert.equal(
    pressureOf({ hp: 59, stage: at, trend, gold: null }).danger,
    true,
  );
  // A partir do estágio 4 (fim da isenção) a mesma tendência volta a contar; a vida absoluta vale sempre.
  assert.equal(
    pressureOf({ hp: 59, stage: stageOf("4-1"), trend, gold: 50 }).danger,
    true,
  );
  assert.equal(
    pressureOf({ hp: POLICY.hp.danger, stage: at, trend, gold: 50 }).danger,
    true,
  );
  // Pela estratégia inteira: sem "estabilize", sem piso de perigo e sem aviso de vida.
  const s = makeState({ hp: 59, stage: "3-5", gold: 50, level: 6 });
  s.options.trend = trend;
  const r = strategy(s.plan, s.analysis, s.options);
  assert.equal(r.pressure, "hurt");
  assert.equal(r.panels.economy.alert, null);
  assert.ok(!/Estabilize/.test(r.headline), r.headline);
});

test("tendência exige amostras: uma queda grande só não projeta perigo", () => {
  const { trend } = feed([
    ["3-1", 75, 0],
    ["3-2", 52, 1],
  ]);
  assert.equal(trend.samples, 1);
  // Antes: 52 − 3 × 23 = −17 ≤ 15 era "sangrando" com uma única queda.
  assert.equal(
    pressureOf({ hp: 52, stage: stageOf("3-2"), trend }).danger,
    false,
  );
  // Com `drops` quedas a projeção vale.
  const three = feed([
    ["3-1", 100, 0],
    ["3-2", 80, 1],
    ["3-3", 62, 2],
    ["3-5", 46, 3.5],
  ]).trend;
  assert.equal(three.samples, POLICY.trend.drops);
  assert.match(
    pressureOf({ hp: 46, stage: stageOf("3-5"), trend: three }).why,
    /perdendo/,
  );
});

test("a faixa não oscila com a vida parada: a janela de perdas termina na última queda", () => {
  // Partida real 3291181511: 61 → 49 em quatro perdas seguidas; uma vitória (vida parada) não tira o perigo sozinha.
  const t = streakTracker(),
    rows = [
      [86, 0],
      [77, 2.8],
      [69, 3.6],
      [61, 5.8],
      [49, 6.9],
    ];
  for (const [hp, min] of rows) t.observe({ gameId: 7, hp, now: min * MIN });
  const at = (min) => pressureOf({ hp: 49, trend: t.trend(min * MIN) }).band;
  assert.equal(at(6.9), "danger");
  // 1min45 depois, sem queda nova: antes caía para "hurt" (a janela andava com o relógio); agora segue em perigo.
  assert.equal(at(8.65), "danger");
  // Uma janela inteira sem queda (rodadas ganhas) tira o perigo pela tendência.
  assert.equal(at(6.9 + POLICY.trend.windowMs / MIN + 0.1), "hurt");
});

// Catálogo mínimo para stagePlan (o mesmo formato de tests/strategy.test.mjs).
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

test("vida 28 no 4-x: perigo real, rola por upgrades do plano e a cópia fora do plano fica", () => {
  const run = (hp) => {
    const s = makeState({
      hp,
      stage: "4-2",
      gold: 40,
      level: 8,
      rivals: { count: 7, cost: 2, stars: 1, size: 6 },
      units: [
        ["Aphelios", 4, 1, 3],
        ["Amumu", 4, 2, 2],
        ["Diana", 3, 2, 0],
        ["Rakan", 3, 1, 0],
        ["Vi", 2, 2, 1],
        ["Sentinel", 2, 1, 0],
        ["Varus", 1, 2, 0],
        // Fora do plano, com itens: a cópia na loja não fecha estrela.
        ["Poppy", 1, 1, 2],
      ],
    });
    s.options.shop = ["TFT_Poppy", "TFT_Rakan"];
    // Mesma ordem do servidor: a loja (stagePlan) e depois a estratégia com o campo de agora.
    const field = stagePlan(s.plan, s.analysis, catalog, s.options);
    return {
      s,
      field,
      r: strategy({ ...s.plan, stage: field }, s.analysis, s.options),
    };
  };
  const { s, field, r } = run(28);
  assert.equal(r.pressure, "danger");
  assert.equal(r.pressureWhy, "vida 28 ≤ 30");
  assert.equal(r.action, "ROLAR");
  assert.equal(r.panels.rolling.call.kind, "danger");
  const shop = Object.fromEntries(field.shop.map((c) => [c.name, c]));
  assert.equal(shop.Rakan.action, "comprar");
  assert.equal(shop.Poppy.action, "segurar");
  assert.match(shop.Poppy.reason, /vida em perigo/);
  // O aviso diz o que fazer, em uma linha, e busca só peças do plano.
  const alert = r.panels.economy.alert;
  assert.equal(
    alert.text,
    "Vida 28: role por upgrades do plano até estabilizar",
  );
  assert.ok(!alert.text.includes("\n"));
  const plan = new Set(s.plan.board.map((u) => u.name));
  const named = (text) =>
    [...text.matchAll(/([A-Z][a-z]+) \d★/g)].map((m) => m[1]);
  assert.ok(named(alert.targets).length > 0);
  for (const n of named(alert.targets)) assert.ok(plan.has(n), n);
  // O passo de rolagem cita as peças do plano primeiro.
  const step = r.steps.find((x) => x.startsWith('Role cerca'));
  assert.ok(plan.has(named(step)[0]), step);
  // Vida cheia, mesmo estado: sem aviso.
  assert.equal(run(80).r.panels.economy.alert, null);
});

test("nível-alvo não muda com a vida nem com o ouro cruzando o teto de juros na vida baixa", () => {
  const snap = (hp) => ({
    statsBlock: {
      players: [
        { playerId: "1", health: hp, boardPieces: [] },
        ...[2, 3, 4, 5].map((i) => ({
          playerId: String(i),
          health: 80,
          boardPieces: [],
        })),
      ],
    },
  });
  const levels = new Set();
  for (const hp of [
    POLICY.hp.low + 1,
    POLICY.hp.low,
    POLICY.hp.danger,
    POLICY.hp.critical,
  ])
    for (const gold of [49, 50])
      levels.add(suggestTargetLevel(snap(hp), "1", 8, gold).level);
  assert.deepEqual([...levels], [9]);
});

// Golden danger-hp27 (captura real anonimizada, 4-5, nível 8, 18 g): a vida muda o gasto, não o plano.
const ctx = await loadContext();
const snapshots = loadSnapshots();
const base = scenarios.find((s) => s.id === "danger-hp27");
/** Snapshots do cenário com a vida do Hero trocada (um nome por vida). */
const withHp = (...hps) => {
  const map = new Map(snapshots);
  map.hidden = new Map(snapshots.hidden);
  for (const hp of hps) {
    const snap = structuredClone(snapshots.get(base.snapshot));
    snap.statsBlock.players.find((p) => p.playerId === HERO_ID).health = hp;
    map.set(`hp${hp}`, snap);
    map.hidden.set(`hp${hp}`, snapshots.hidden.get(base.snapshot));
  }
  return map;
};

test("golden danger-hp27 explicado: perigo real pela vida no estágio 4; estabiliza com o plano", () => {
  const [o] = runScenario(ctx, base, snapshots),
    top = o.response.recommendations[0],
    st = top.strategy;
  // Vida 44 no 4-5: a regra absoluta (≤ 45 a partir do estágio 4) dispara antes da tendência (14 por derrota, 4 perdas).
  assert.equal(o.response.self.health, 44);
  assert.equal(st.pressure, "danger");
  assert.equal(
    st.pressureWhy,
    `vida 44 ≤ ${POLICY.hp.dangerLate} a partir do estágio ${POLICY.lateStage}`,
  );
  // A cópia solta de Cassiopeia (fora do plano, 1 cópia: não fecha estrela) não é comprada no perigo.
  const cass = (top.stage?.shop ?? []).find((c) => c.name === "Cassiopeia");
  if (cass) assert.equal(cass.action, "segurar");
  const alert = st.panels.economy.alert;
  assert.match(alert.text, /^Vida 44: /);
  const planNames = new Set(top.board.map((u) => u.name));
  for (const m of (alert.targets ?? "").matchAll(/([A-Z][a-z]+) \d★/g))
    assert.ok(planNames.has(m[1]), m[1]);
  // 18 g e ~0% de fechar upgrade do plano com os 8 g acima do piso: a vida em perigo não manda rolar sem chance
  // (POLICY.roll.dangerChance). Não rola, diz por quê e o aviso manda estabilizar com itens e posição.
  assert.notEqual(st.action, "ROLAR");
  assert.equal(st.panels.rolling.go, false);
  assert.equal(st.panels.rolling.call.go, false);
  assert.ok(st.panels.rolling.call.any < POLICY.roll.dangerChance);
  assert.match(
    st.panels.rolling.call.reason,
    /^Vida em risco, mas só \d+% de fechar upgrade do plano com \d+g \(mínimo 10%\)/,
  );
  assert.ok(
    st.steps.some((x) => x.startsWith('Não role: Vida em risco, mas só')),
    st.steps.join(" | "),
  );
  assert.equal(st.panels.economy.sold, 0);
  assert.equal(alert.text, "Vida 44: estabilize com itens e posição");
  assert.equal(alert.targets, null);
  // Sem a tendência e com vida 46 (faixa "hurt"), o plano é o mesmo: a faixa não escolhe comp.
  const [calm] = runScenario(
    ctx,
    { ...base, snapshot: "hp46", trend: null, streak: null },
    withHp(46),
  );
  assert.equal(calm.response.recommendations[0].strategy.pressure, "hurt");
  assert.equal(calm.response.recommendations[0].title, top.title);
});

test("o plano não oscila quando a vida cruza o limiar para lá e para cá", () => {
  // 46 ↔ 45 cruza o perigo tardio (45 no estágio 4); 36 ↔ 35 cruzava o nível-alvo (baixava 9 → 8 e trocava a comp).
  const hps = [46, 45, 46, 45, 36, 35, 36, 35],
    scenario = {
      ...base,
      snapshot: `hp${hps[0]}`,
      trend: null,
      streak: null,
      steps: hps.map((hp) => ({ snapshot: `hp${hp}` })),
    },
    out = runScenario(ctx, scenario, withHp(...new Set(hps)));
  const bands = out.map((o) => o.response.recommendations[0].strategy.pressure);
  assert.deepEqual(bands.slice(0, 4), ["hurt", "danger", "hurt", "danger"]);
  const titles = new Set(out.map((o) => o.response.recommendations[0].title));
  assert.equal(titles.size, 1, [...titles].join(" | "));
  assert.deepEqual(
    new Set(out.map((o) => o.response.targetLevel)),
    new Set([9]),
  );
  for (const o of out) assert.equal(o.switched ?? null, null);
});

test("aviso do overlay: a linha do servidor, só na faixa de perigo", () => {
  const view = (pressure, alert = null) => ({
    status: "ready",
    bar: { hp: 28, live: { kind: "live" } },
    economy: { pressure, alert, alertWhy: alert ? "vida 28 ≤ 30" : null },
    roll: {
      kind: "danger",
      title: "Role para estabilizar",
      reason: "Vida em risco.",
    },
  });
  const line = "Vida 28: role por upgrades do plano até estabilizar",
    [hint] = buildHints(view("danger", line), { verbosity: "normal" }).hints;
  assert.equal(hint.id, "alert:hp");
  assert.equal(hint.text, line);
  assert.equal(hint.why, "vida 28 ≤ 30");
  // Fora da faixa de perigo não há aviso de vida.
  const calm = buildHints(view("hurt"), { verbosity: "normal" }).hints;
  assert.ok(!calm.some((h) => h.id === "alert:hp"));
});
