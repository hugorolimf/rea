// Rodar com: node --test "tft/helper/tests/plan-state.test.mjs"
// Plano persistente: várias rodadas seguidas mantêm o plano e o progresso; ruído não troca o plano; mudança relevante sim.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIRM, planTracker } from "../plan-state.mjs";
import { buildChecklist, stableOrder } from "../plan-progress.mjs";

const unit = (id, cost, targetStars = 2) => ({
  id,
  name: id,
  cost,
  targetStars,
});
const BOARD = [
  unit("Carry", 4, 3),
  unit("Tank", 3),
  unit("Support", 2),
  unit("Filler", 1),
];
const recommendation = ({
  id = "m1",
  title = "Comp A",
  board = BOARD,
  itemPlans = [],
  swit = null,
  strategy = {},
} = {}) => ({
  meta: id.startsWith("m") ? { id } : null,
  freeId: id.startsWith("free:") ? id : null,
  title,
  carry: "Carry",
  board,
  itemPlans,
  evidence: swit ? { switch: swit } : {},
  evidenceCore: ["Carry"],
  evidenceAsset: "Carry",
  evidenceAssetFilter: "f",
  strategy: {
    interestAt: 40,
    keep: 20,
    floor: 10,
    panels: {
      leveling: { finalLevel: 8, xp: { have: 2, total: 20 } },
      economy: {},
    },
    ...strategy,
  },
});
const analysisOf = (units = [], reserve = []) => ({
  self: {
    units: units.map(([championName, starLevel]) => ({
      championName,
      starLevel,
    })),
    reserve: reserve.map(([championName, starLevel, quantity = 1]) => ({
      championName,
      starLevel,
      quantity,
    })),
  },
});
const held = (toId, title, gain = 0.4) => ({
  kept: true,
  held: true,
  fromId: "m1",
  toId,
  from: "Comp A",
  to: title,
  gain,
  noise: 0.05,
  cost: 0.05,
});

let clock;
const make = (extra = {}) => planTracker({ now: () => clock, ...extra });
const step = (t, input) => {
  clock = Date.parse(`2026-10-10T12:00:00Z`) + t * 1000;
  return t;
};

test("o plano adotado persiste entre rodadas e vira o plano mantido do motor", () => {
  const tracker = make();
  step(0);
  assert.equal(tracker.sticky("G1"), null);
  assert.equal(tracker.holdFor("G1"), false);
  tracker.track({
    gameId: "G1",
    stage: "2-1",
    level: 3,
    top: recommendation(),
    analysis: analysisOf([["Carry", 1]]),
  });
  const sticky = tracker.sticky("G1");
  assert.equal(sticky.id, "m1");
  assert.equal(sticky.carry, "Carry");
  assert.deepEqual(sticky.units, ["Carry", "Tank", "Support", "Filler"]);
  // Outra partida nunca recebe o plano desta.
  assert.equal(tracker.sticky("G2"), null);
  assert.equal(tracker.holdFor("G1"), true);
  assert.equal(tracker.holdFor("G2"), false);
});

test("checklist: concluído continua concluído, parcial mostra o que falta e o próximo passo é o carry", () => {
  const tracker = make();
  step(0);
  const r1 = tracker.track({
    gameId: "G1",
    stage: "2-1",
    level: 3,
    gold: 12,
    top: recommendation(),
    analysis: analysisOf(
      [
        ["Tank", 1],
        ["Filler", 2],
      ],
      [["Carry", 1, 2]],
    ),
  });
  const byId = (p, id) => p.units.find((u) => u.id === id);
  assert.equal(byId(r1.progress, "Filler").status, "done");
  assert.equal(byId(r1.progress, "Carry").status, "partial");
  assert.equal(byId(r1.progress, "Carry").copies, 2);
  assert.equal(byId(r1.progress, "Carry").need, 9);
  assert.equal(byId(r1.progress, "Support").status, "missing");
  assert.match(r1.progress.next[0].text, /^Carry: 1→3★ \(2\/9 cópias\)/);
  // Rodadas seguintes: Tank sobe de estrela, Support entra. Nada do que estava feito volta.
  step(60);
  const r2 = tracker.track({
    gameId: "G1",
    stage: "2-2",
    level: 4,
    gold: 20,
    top: recommendation(),
    analysis: analysisOf(
      [
        ["Tank", 2],
        ["Filler", 2],
        ["Support", 1],
      ],
      [["Carry", 1, 2]],
    ),
  });
  assert.equal(byId(r2.progress, "Tank").status, "done");
  assert.equal(byId(r2.progress, "Filler").status, "done");
  assert.equal(byId(r2.progress, "Support").status, "partial");
  assert.ok(r2.progress.summary.done > r1.progress.summary.done);
  assert.ok(
    !r2.progress.next.some((s) => /Filler|Tank/.test(s.text)),
    "peça pronta não volta como passo",
  );
  assert.deepEqual(
    r2.progress.units.map((u) => u.id),
    r1.progress.units.map((u) => u.id),
    "a ordem das linhas não muda entre rodadas",
  );
  const events = r2.progress.changes.map((c) => c.text).join("|");
  assert.match(events, /Tank subiu para 2★/);
  assert.match(events, /Support entrou no time/);
  // A primeira leitura só planta as marcas: nada de "entrou no time" para o que já estava.
  assert.ok(!r1.progress.changes.some((c) => c.type === "unit"));
});

test("peça que chegou a uma estrela e foi vendida aparece como perdida, sem apagar o plano", () => {
  const tracker = make();
  step(0);
  tracker.track({
    gameId: "G1",
    stage: "2-1",
    level: 3,
    top: recommendation(),
    analysis: analysisOf([["Tank", 1]]),
  });
  step(30);
  tracker.track({
    gameId: "G1",
    stage: "2-2",
    level: 3,
    top: recommendation(),
    analysis: analysisOf([["Tank", 2]]),
  });
  step(60);
  const { progress } = tracker.track({
    gameId: "G1",
    stage: "2-3",
    level: 3,
    top: recommendation(),
    analysis: analysisOf([]),
  });
  const tank = progress.units.find((u) => u.id === "Tank");
  assert.equal(tank.status, "missing");
  assert.equal(tank.lost, true);
});

test("itens: alvos congelados, só de peças que já são suas, e montado continua montado", () => {
  const item = (id, extra = {}) => ({
    id,
    name: id,
    components: [
      { id: "c1", name: "Arco" },
      { id: "c2", name: "Cinto" },
    ],
    ...extra,
  });
  const plan = (equipped, ideal) => [
    {
      championId: "Carry",
      name: "Carry",
      equipped,
      ideal,
      slotsFree: 3 - equipped.length,
    },
    {
      championId: "Tank",
      name: "Tank",
      equipped: [],
      ideal: [item("TankItem")],
      slotsFree: 3,
    },
  ];
  const tracker = make();
  step(0);
  const first = tracker.track({
    gameId: "G1",
    stage: "2-1",
    level: 3,
    top: recommendation({
      itemPlans: plan(
        [],
        [
          item("A", { craftable: true }),
          item("B", { missing: [{ id: "c1", name: "Arco" }] }),
          item("C"),
        ],
      ),
    }),
    analysis: analysisOf([["Carry", 1]]),
  }).progress;
  // Tank não é seu: sem alvos de item para ele.
  assert.deepEqual(
    first.items.map((i) => i.unitId),
    ["Carry", "Carry", "Carry"],
  );
  assert.equal(first.items[0].status, "ready");
  assert.equal(first.items[1].status, "partial");
  assert.deepEqual(first.items[1].missing, ["Arco"]);
  assert.equal(first.items[2].status, "missing");
  // O motor reordena a build ideal; os alvos já escolhidos continuam, e A montado conta.
  step(60);
  const next = tracker.track({
    gameId: "G1",
    stage: "2-2",
    level: 3,
    top: recommendation({
      itemPlans: plan(
        [item("A")],
        [item("Z"), item("C"), item("B"), item("A")],
      ),
    }),
    analysis: analysisOf([["Carry", 1]]),
  }).progress;
  assert.deepEqual(
    next.items.map((i) => i.itemId),
    ["A", "B", "C"],
  );
  assert.equal(next.items[0].status, "built");
  assert.ok(
    next.changes.some(
      (c) => c.type === "item" && /A montado em Carry/.test(c.text),
    ),
  );
  assert.ok(
    !next.next.some((s) => /Montar A /.test(s.text)),
    "item montado não volta como passo",
  );
});

test("aprimoramentos, nível e ouro entram no checklist", () => {
  const tracker = make();
  step(0);
  const { progress } = tracker.track({
    gameId: "G1",
    stage: "3-2",
    level: 5,
    targetLevel: 8,
    gold: 33,
    top: recommendation(),
    analysis: analysisOf([["Carry", 1]]),
    chosen: [{ id: "Aug1", name: "Primeiro" }],
  });
  assert.deepEqual(
    progress.augments.map((a) => [a.round, a.status]),
    [
      ["2-1", "done"],
      ["3-2", "now"],
      ["4-2", "later"],
    ],
  );
  assert.equal(progress.level.status, "pending");
  assert.equal(progress.level.target, 8);
  assert.equal(progress.gold.now, 33);
  assert.equal(progress.gold.interestAt, 40);
  assert.ok(progress.next.some((s) => s.kind === "augment"));
});

test("desafiante na mesma rodada, mesmo lendo muitas vezes, não troca o plano", () => {
  const tracker = make();
  step(0);
  tracker.track({
    gameId: "G1",
    stage: "2-3",
    level: 4,
    top: recommendation(),
    analysis: analysisOf(),
  });
  for (let i = 1; i <= 8; i++) {
    step(i * 5);
    assert.equal(
      tracker.holdFor("G1"),
      true,
      `leitura ${i}: o plano segue segurado`,
    );
    const { switched, progress } = tracker.track({
      gameId: "G1",
      stage: "2-3",
      level: 4,
      baseId: `b${i}`,
      top: recommendation({ swit: held("m2", "Comp B") }),
      analysis: analysisOf(),
    });
    assert.equal(switched, null);
    assert.equal(progress.plan.id, "m1");
    assert.equal(progress.challenger.title, "Comp B");
    assert.equal(progress.challenger.rounds, 1);
  }
  assert.equal(tracker.sticky("G1").id, "m1");
});

test("inversão no meio zera a confirmação: Comp B, depois Comp C, depois ninguém", () => {
  const tracker = make();
  step(0);
  tracker.track({
    gameId: "G1",
    stage: "2-3",
    level: 4,
    top: recommendation(),
    analysis: analysisOf(),
  });
  const read = (t, stage, swit, baseId) => {
    step(t);
    return tracker.track({
      gameId: "G1",
      stage,
      level: 4,
      baseId,
      top: recommendation({ swit }),
      analysis: analysisOf(),
    });
  };
  read(10, "2-3", held("m2", "Comp B"), "a");
  read(20, "2-4", held("m2", "Comp B"), "b");
  assert.equal(
    read(30, "2-4", held("m3", "Comp C"), "c").progress.challenger.readings,
    1,
    "outro desafiante recomeça a contagem",
  );
  read(40, "2-5", held("m3", "Comp C"), "d");
  assert.equal(
    read(50, "2-5", null, "e").progress.challenger,
    null,
    "o plano voltou ao topo: sem desafiante",
  );
  assert.equal(tracker.holdFor("G1"), true);
});

test("a mesma análise base não conta duas vezes como leitura do desafiante", () => {
  const tracker = make();
  step(0);
  tracker.track({
    gameId: "G1",
    stage: "2-3",
    level: 4,
    top: recommendation(),
    analysis: analysisOf(),
  });
  for (let i = 0; i < 6; i++) {
    step(10 + i);
    tracker.track({
      gameId: "G1",
      stage: "2-3",
      level: 4,
      baseId: "mesma",
      top: recommendation({ swit: held("m2", "Comp B") }),
      analysis: analysisOf(),
    });
  }
  assert.equal(tracker.snapshot().challenger.readings, 1);
});

test("desafiante que lidera por mais de uma rodada é confirmado: libera a troca e o novo plano vira o mantido", () => {
  const tracker = make();
  step(0);
  tracker.track({
    gameId: "G1",
    stage: "2-3",
    level: 4,
    top: recommendation(),
    analysis: analysisOf(),
  });
  const rounds = ["2-3", "2-4", "2-4", "2-5"];
  rounds.forEach((stage, i) => {
    step(20 + i * 20);
    tracker.track({
      gameId: "G1",
      stage,
      level: 4,
      baseId: `x${i}`,
      top: recommendation({ swit: held("m2", "Comp B") }),
      analysis: analysisOf(),
    });
  });
  assert.ok(tracker.snapshot().challenger.readings >= CONFIRM.readings);
  assert.equal(tracker.holdFor("G1"), false, "confirmado: o motor pode trocar");
  step(140);
  const { switched, progress } = tracker.track({
    gameId: "G1",
    stage: "2-5",
    level: 4,
    baseId: "final",
    top: recommendation({
      id: "m2",
      title: "Comp B",
      swit: { ...held("m2", "Comp B"), kept: false, held: false },
    }),
    analysis: analysisOf(),
  });
  assert.deepEqual([switched.fromId, switched.toId], ["m1", "m2"]);
  assert.equal(progress.plan.id, "m2");
  assert.equal(progress.challenger, null);
  assert.equal(tracker.sticky("G1").id, "m2");
  assert.equal(tracker.holdFor("G1"), true, "o plano novo também é segurado");
  assert.ok(progress.changes.some((c) => c.type === "switch"));
});

test("troca de classe do motor (plano mantido virou aposta) é adotada na hora, sem confirmação", () => {
  const tracker = make();
  step(0);
  tracker.track({
    gameId: "G1",
    stage: "4-1",
    level: 7,
    top: recommendation(),
    analysis: analysisOf(),
  });
  step(10);
  const { switched } = tracker.track({
    gameId: "G1",
    stage: "4-1",
    level: 7,
    top: recommendation({ id: "m9", title: "Outra" }),
    analysis: analysisOf(),
  });
  assert.equal(switched.toId, "m9");
});

test("'Seu tabuleiro atual' não é compromisso: o motor pode sair dele sem esperar", () => {
  const tracker = make();
  step(0);
  tracker.track({
    gameId: "G1",
    stage: "2-1",
    level: 2,
    top: recommendation({ id: "free:current", title: "Seu tabuleiro atual" }),
    analysis: analysisOf(),
  });
  assert.equal(tracker.holdFor("G1"), false);
});

test("o estado sobrevive ao reinício do servidor e some ao fim da partida", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-state-"));
  try {
    const file = path.join(dir, "data", "plan-state.json");
    const a = make({ file });
    step(0);
    a.track({
      gameId: "G1",
      stage: "2-1",
      level: 3,
      top: recommendation({
        itemPlans: [
          {
            championId: "Carry",
            equipped: [],
            ideal: [{ id: "A", name: "A", components: [] }],
          },
        ],
      }),
      analysis: analysisOf([["Carry", 2]]),
    });
    step(30);
    a.track({
      gameId: "G1",
      stage: "2-2",
      level: 3,
      baseId: "q",
      top: recommendation({ swit: held("m2", "Comp B") }),
      analysis: analysisOf([["Carry", 2]]),
    });
    await a.flush();
    // Servidor reiniciado no meio da partida.
    const b = make({ file });
    assert.equal(b.sticky("G1").id, "m1");
    assert.equal(b.snapshot().challenger.id, "m2");
    assert.equal(
      b.snapshot().memory.units.Carry,
      2,
      "marcas de progresso preservadas",
    );
    assert.deepEqual(
      b.snapshot().memory.itemTargets.Carry.map((t) => t.id),
      ["A"],
    );
    // O progresso continua do ponto em que estava: Carry 2★ já visto, nada de "entrou no time" de novo.
    step(60);
    const again = b.track({
      gameId: "G1",
      stage: "2-3",
      level: 3,
      baseId: "r",
      top: recommendation(),
      analysis: analysisOf([["Carry", 2]]),
    });
    assert.ok(!again.progress.changes.some((c) => /Carry entrou/.test(c.text)));
    // Fim da partida: nada vale para a próxima.
    b.reset();
    await b.flush();
    const c = make({ file });
    assert.equal(c.sticky("G1"), null);
    // Partida diferente começa vazia, mesmo com arquivo de outra.
    a.track({
      gameId: "G9",
      stage: "2-1",
      level: 2,
      top: recommendation(),
      analysis: analysisOf(),
    });
    assert.equal(a.sticky("G1"), null);
    assert.equal(a.sticky("G9").id, "m1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a ordem estável mantém as linhas no lugar e põe as novas no fim", () => {
  const first = stableOrder([], BOARD, "Carry");
  assert.deepEqual(first, ["Carry", "Tank", "Support", "Filler"]);
  const grown = stableOrder(
    first,
    [...BOARD, unit("New", 5)].reverse(),
    "Carry",
  );
  assert.deepEqual(grown, ["Carry", "Tank", "Support", "Filler", "New"]);
  assert.deepEqual(stableOrder(grown, BOARD.slice(1), "Carry"), [
    "Tank",
    "Support",
    "Filler",
  ]);
});

test("livro-razão do log: compra sem peça em campo aparece só como teto da reserva", () => {
  const { checklist } = buildChecklist({
    shown: recommendation(),
    analysis: analysisOf([["Tank", 1]]),
    state: {
      level: 4,
      stage: "2-2",
      ledger: {
        reconciliation: {
          champions: [
            { id: "Support", acquired: 2, board: 0, surplus: 2 },
            { id: "Tank", acquired: 1, board: 1, surplus: 0 },
          ],
        },
      },
    },
  });
  assert.equal(checklist.units.find((u) => u.id === "Support").boughtUpTo, 2);
  assert.equal(checklist.units.find((u) => u.id === "Tank").boughtUpTo, null);
  assert.equal(
    checklist.units.find((u) => u.id === "Support").status,
    "missing",
    "o teto não conta como peça obtida",
  );
});

/* ---------- Motor: o `holdPlan` mede a vantagem do desafiante e a registra, mas não troca ---------- */
test("motor: com holdPlan o plano mantido fica no topo e a vantagem do desafiante é registrada", async () => {
  const { analyze } = await import("../engine.mjs");
  const { loadComps } = await import("../meta-comps.mjs");
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, "$1:")),
    "..",
  );
  const catalog = JSON.parse(
      fs.readFileSync(path.join(root, "catalog.json"), "utf8"),
    ),
    { comps } = await loadComps(root, "TFTSet18", catalog),
    byName = new Map(catalog.champions.map((c) => [c.name, c])),
    HERO = 47445859;
  // Evidência sintética e determinística por pergunta: não depende da rede nem do cache do explorer.
  const hash = (s) =>
    [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1000003, 7);
  const evidence = {
    has: () => true,
    get: (k) => ({ avg: 3.2 + (hash(k) % 1000) / 500, games: 5000, top4: 50 }),
  };
  const piece = (name, starLevel = 1) => ({
    championName: byName.get(name).apiName,
    starLevel,
    itemNames: [],
    price: byName.get(name).cost,
  });
  const snapshot = {
    gameId: 1,
    statsBlock: {
      setCoreName: "TFTSet18",
      players: [
        {
          playerId: HERO,
          health: 60,
          ffaStanding: 3,
          boardPieces: ["Shen", "Vi", "Sentinel", "Diana", "Rammus"].map(
            (n, i) => piece(n, i < 3 ? 2 : 1),
          ),
        },
        { playerId: 2, health: 50, boardPieces: [] },
      ],
    },
  };
  const run = (extra = {}) =>
    analyze(snapshot, catalog, {
      level: 6,
      targetLevel: 7,
      gold: 30,
      bench: [],
      inventory: [],
      playerId: String(HERO),
      metaComps: comps,
      evidence,
      conditional: new Map(),
      stage: { stage: 2, round: 3 },
      ...extra,
    });
  const ranking = run().compRanking.filter((r) => r.evidence);
  assert.ok(ranking.length > 5, "comps medidas na cópia local");
  // Do pior para o melhor: o primeiro plano que o motor abandona sozinho pela regra de troca (mesma classe, ganho acima
  // da incerteza + custo) é o caso que o hold precisa segurar.
  let found = null;
  for (const cand of [...ranking].reverse()) {
    const m = comps.find((c) => c.id === cand.id),
      sticky = {
        id: cand.id,
        units: m.units,
        carry: m.carry,
        title: m.title,
        core: [],
        asset: null,
        assetFilter: null,
      },
      free = run({ sticky, stickyCompId: cand.id }).recommendations[0];
    if (
      (free.meta?.id ?? free.freeId) !== cand.id &&
      free.evidence?.switch?.kept === false
    ) {
      found = { sticky, free };
      break;
    }
  }
  assert.ok(found, "há um plano mantido que o motor troca sem o hold");
  const { sticky, free } = found,
    hold = run({ sticky, stickyCompId: sticky.id, holdPlan: true })
      .recommendations[0];
  assert.equal(free.evidence.switch.kept, false);
  assert.equal(free.evidence.switch.held, false);
  assert.equal(
    hold.meta?.id ?? hold.freeId,
    sticky.id,
    "com hold o plano mantido segue no topo",
  );
  const sw = hold.evidence.switch;
  assert.equal(sw.kept, true);
  assert.equal(
    sw.held,
    true,
    "a vantagem do desafiante foi medida e ficou registrada",
  );
  assert.equal(sw.fromId, sticky.id);
  assert.equal(
    sw.toId,
    free.meta?.id ?? free.freeId,
    "o desafiante registrado é o que o motor escolheria",
  );
  assert.ok(sw.gain > sw.noise + sw.cost);
});

test("as decisões do usuário ficam por partida, só tocam o estado quando mudam e sobrevivem ao reinício (M10b)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-state-dec-"));
  try {
    const file = path.join(dir, "data", "plan-state.json");
    const a = make({ file });
    step(0);
    assert.equal(a.decisions("G1"), null, "sem POST ainda: valem os padrões");
    const picked = {
      goalCompId: "c1",
      goalSwaps: [{ out: "A", in: "B" }],
      compSwaps: {},
      augments: ["Aug1"],
      augmentsKnown: true,
    };
    assert.equal(a.setDecisions("G1", picked), true);
    const rev = a.snapshot().revision;
    assert.deepEqual(a.decisions("G1"), picked);
    assert.equal(
      a.setDecisions("G1", { ...picked }),
      false,
      "igual: nada muda",
    );
    assert.equal(a.snapshot().revision, rev);
    // É cópia: mexer no que foi devolvido não altera o guardado.
    a.decisions("G1").augments.push("x");
    assert.deepEqual(a.decisions("G1").augments, ["Aug1"]);
    assert.equal(a.decisions("G2"), null, "outra partida não herda");
    // Decisões e plano convivem no mesmo estado (uma partida por vez).
    a.track({
      gameId: "G1",
      stage: "2-1",
      level: 3,
      top: recommendation(),
      analysis: analysisOf([["Carry", 1]]),
    });
    assert.deepEqual(
      a.decisions("G1"),
      picked,
      "o plano adotado não apaga as decisões",
    );
    await a.flush();
    const b = make({ file });
    assert.deepEqual(
      b.decisions("G1"),
      picked,
      "servidor reiniciado no meio da partida",
    );
    assert.equal(b.sticky("G1").id, "m1");
    // Mudou a decisão: muda e persiste; fim da partida (reset) zera.
    assert.equal(b.setDecisions("G1", { ...picked, goalCompId: "" }), true);
    assert.equal(b.decisions("G1").goalCompId, "");
    b.reset();
    assert.equal(b.decisions("G1"), null);
    await b.flush();
    // Estado de versão anterior (sem o campo) continua carregando.
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    delete old.decisions;
    fs.writeFileSync(file, JSON.stringify({ ...old, gameId: "G1" }));
    assert.equal(make({ file }).decisions("G1"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
