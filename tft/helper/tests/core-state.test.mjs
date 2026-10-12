// Rodar com: node --test tft/helper/tests/core-state.test.mjs
// Camada de estado (M7): relógio, nível, `Field`, precedência com histerese e divergência GEP x arquivo do jogo,
// `GameState`, entradas da análise e o montador do servidor (app/state.mjs) com fontes falsas. Não há leitura de tela:
// ouro, nível, XP, loja e itens só vêm do GEP.
import test from "node:test";
import assert from "node:assert/strict";
import { parseStage, stageText } from "../core/state/clock.mjs";
import { field, unknownField, confidenceOf } from "../core/state/field.mjs";
import {
  XP,
  levelConsistent,
  levelFloor,
  reduceLevel,
  roundNumber,
} from "../core/state/level.mjs";
import {
  HYSTERESIS_READINGS,
  candidatesFor,
  initialPrecedence,
  reduceSources,
} from "../core/state/precedence.mjs";
import { buildGameState, summarizeState } from "../core/state/game-state.mjs";
import { analysisInputs } from "../core/state/inputs.mjs";
import { createStateHub } from "../app/state.mjs";
import { levelTracker } from "../level.mjs";
import { GAME } from "../rules.mjs";

test("relógio: 'S-R' lido uma vez; formato fora do padrão é desconhecido", () => {
  assert.deepEqual(parseStage("2-4"), { stage: 2, round: 4 });
  assert.deepEqual(parseStage("02-04"), { stage: 2, round: 4 });
  assert.equal(stageText(parseStage("02-04")), "2-4");
  for (const bad of [null, undefined, "", "2", "2-", "a-b", "2-4 ", "2-4-1"])
    assert.equal(parseStage(bad), null, String(bad));
  assert.equal(stageText(null), null);
  assert.equal(roundNumber("1-3"), 3);
  assert.equal(roundNumber("2-1"), GAME.stageOneRounds + 1);
  assert.equal(roundNumber("lixo"), null);
});

test("a tabela de XP é uma só: GAME (rules.mjs) usa os mesmos objetos de core/state/level.mjs", () => {
  assert.equal(GAME.xpToNext, XP.xpToNext);
  assert.equal(GAME.passiveXp, XP.passiveXp);
  assert.equal(GAME.stageRounds, XP.stageRounds);
  assert.equal(GAME.stageOneRounds, XP.stageOneRounds);
  assert.equal(GAME.carouselRound, XP.carouselRound);
});

test("Field: valor ausente é desconhecido (sem origem); com valor leva fonte, confiança e idade", () => {
  assert.deepEqual(field(undefined, "gep", "observed"), unknownField());
  assert.deepEqual(field(null, "gep", "observed"), unknownField());
  const f = field(7, "gep", "observed", { ageMs: 250, now: 10_000 });
  assert.equal(f.value, 7);
  assert.equal(f.source, "gep");
  assert.equal(f.confidence, "observed");
  assert.equal(f.ageMs, 250);
  assert.equal(f.at, 9_750);
  assert.equal(
    field(0, "gep", "observed").value,
    0,
    "zero é um valor, não ausência",
  );
  assert.equal(confidenceOf("gep"), "observed");
  assert.equal(confidenceOf("derived"), "derived");
  assert.equal(confidenceOf("screen"), null, "não há mais origem de tela");
  assert.equal(confidenceOf("nada"), null);
});

test("nível: reduceLevel (puro) dá o mesmo resultado que o rastreador e não mexe na entrada", () => {
  const seen = {
    stage: "3-2",
    level: 6,
    xp: "10/36",
    sources: { level: "gep", xp: "gep" },
  };
  const frozen = structuredClone(seen),
    pure = reduceLevel({ game: null, anchor: null }, seen, "g1"),
    tracked = levelTracker().apply(seen, "g1");
  assert.deepEqual(seen, frozen);
  assert.deepEqual(pure.seen, tracked);
  assert.equal(pure.memory.anchor.level, 6);
  assert.deepEqual(pure.seen.levelInfo, {
    source: "gep",
    minimum: false,
    read: 6,
  });
  // Sem observação: piso a partir do último observado (6 em 3-2, com 10/36 de XP).
  const later = reduceLevel(
    pure.memory,
    { stage: "4-1", level: null, sources: {} },
    "g1",
  );
  assert.equal(
    later.seen.level,
    levelFloor("4-1", { level: 6, xp: "10/36", stage: "3-2" }),
  );
  assert.equal(later.seen.sources.level, "derived");
  assert.equal(later.seen.levelInfo.minimum, true);
  // Outra partida zera a âncora: só o piso global do estágio.
  const next = reduceLevel(
    pure.memory,
    { stage: "4-1", level: null, sources: {} },
    "g2",
  );
  assert.equal(next.memory.game, "g2");
  assert.equal(next.seen.level, levelFloor("4-1"));
});

test("nível consistente (GEP): faixa, nunca cair, piso do XP passivo e total do XP", () => {
  assert.equal(levelConsistent({ level: 5 }), true);
  assert.equal(levelConsistent({ level: 0 }), false);
  assert.equal(levelConsistent({ level: 12 }), false);
  assert.equal(levelConsistent({ level: 5.5 }), false);
  assert.equal(
    levelConsistent({ level: 4, held: 5 }),
    false,
    "o nível nunca cai",
  );
  assert.equal(levelConsistent({ level: 5, held: 5 }), true);
  const floor = levelFloor("4-1");
  assert.ok(floor >= 5);
  assert.equal(levelConsistent({ level: floor - 1, stage: "4-1" }), false);
  assert.equal(levelConsistent({ level: floor, stage: "4-1" }), true);
  // Antes do estágio 2 o piso não vale (o XP passivo do estágio 1 não foi verificado).
  assert.equal(levelConsistent({ level: 1, stage: "1-4" }), true);
  // O total do XP lido junto diz o nível: 24/36 é nível 6.
  assert.equal(levelConsistent({ level: 6, xp: "24/36" }), true);
  assert.equal(levelConsistent({ level: 5, xp: "24/36" }), false);
  assert.equal(levelConsistent({ level: 8, xp: "3/68" }), true);
  assert.equal(levelConsistent({ level: 9, xp: "3/68" }), true);
  assert.equal(levelConsistent({ level: 7, xp: "3/68" }), false);
});

/** Estado dos arquivos do jogo (só o estágio do Sentry), como `gameFilesState` o monta. */
const filesSeen = (stage = "2-5") => ({
  stage,
  sources: { stage: stage ? "game-log" : null },
});
const gepNow = (fields = {}) => ({
  available: true,
  fields: {
    gold: { value: 15, ageMs: 100 },
    level: { value: 5, ageMs: 100 },
    xp: { value: "3/20", ageMs: 100 },
    stage: null,
    shop: null,
    items: null,
    bench: null,
    ...fields,
  },
});
const run = (steps, readings = HYSTERESIS_READINGS) => {
  let memory = initialPrecedence();
  const out = [];
  for (const step of steps) {
    const r = reduceSources(memory, {
      gameId: step.gameId ?? "g1",
      seen: step.seen ?? filesSeen(),
      gep: step.gep ?? null,
      readings,
    });
    memory = r.memory;
    out.push(r);
  }
  return out;
};
const stageGep = (value) => gepNow({ stage: { value, ageMs: 10 } });

test("precedência: ouro, nível, XP, loja e itens só têm o GEP; sem ele não há fonte", () => {
  const [first] = run([{ gep: gepNow() }]);
  assert.equal(first.picks.gold, "gep");
  assert.equal(first.picks.level, "gep");
  assert.equal(first.picks.xp, "gep", "o XP acompanha o nível");
  const [alone] = run([{}]);
  for (const name of ["gold", "level", "xp", "shop", "items"])
    assert.equal(alone.picks[name], null, name);
  const [off] = run([{ gep: { ...gepNow(), available: false } }]);
  assert.equal(off.picks.gold, null, "GEP indisponível não vale");
  // GEP sem o ouro (campo ausente): o ouro fica sem fonte, o resto continua do GEP.
  const [partial] = run([{ gep: gepNow({ gold: null }) }]);
  assert.equal(partial.picks.gold, null);
  assert.equal(partial.picks.level, "gep");
  const c = candidatesFor(filesSeen(), gepNow().fields, null);
  for (const name of ["gold", "level", "shop", "items"])
    assert.deepEqual(
      c[name].map((x) => x.source),
      ["gep"],
      `${name}: candidato único`,
    );
});

test("precedência: o estágio do arquivo do jogo vale mais que o GEP; sem ele, o GEP", () => {
  const [withLog] = run([{ gep: stageGep("2-6") }]);
  assert.equal(withLog.picks.stage, "base");
  const [noLog] = run([{ seen: filesSeen(null), gep: stageGep("2-6") }]);
  assert.equal(noLog.picks.stage, "gep");
});

test("histerese no estágio: o arquivo do jogo que volta só reassume depois de N leituras; a fonte que perde o valor cede na hora", () => {
  const picks = run([
    { gep: stageGep("2-5") },
    { seen: filesSeen(null), gep: stageGep("2-5") },
    { gep: stageGep("2-5") },
    { gep: stageGep("2-5") },
    { gep: stageGep("2-5") },
  ]).map((r) => r.picks.stage);
  assert.deepEqual(picks, ["base", "gep", "gep", "gep", "base"]);
});

test("divergência: GEP x arquivo do jogo no estágio conta um episódio, registra o evento e some quando concordam", () => {
  const diverging = { gep: stageGep("2-6") }, // GEP uma rodada à frente do Sentry (2-5)
    agreeing = { gep: stageGep("2-5") };
  const out = run([diverging, diverging, diverging, diverging, diverging]);
  assert.deepEqual(
    out.map((r) => r.events.length),
    [0, 0, 1, 0, 0],
    "um único evento, na N-ésima leitura",
  );
  assert.deepEqual(out[2].events[0], {
    field: "stage",
    gep: "2-6",
    base: "2-5",
    active: "base",
  });
  assert.deepEqual(out[4].divergence.current, ["stage"]);
  assert.equal(out[4].divergence.total, 1);
  assert.equal(out[4].divergence.byField.stage, 1);
  // Atraso passageiro (1 ou 2 leituras) não é divergência.
  const transient = run([
    diverging,
    diverging,
    agreeing,
    diverging,
    diverging,
    agreeing,
  ]);
  assert.equal(transient.at(-1).divergence.total, 0);
  // Concordou, depois divergiu de novo por N leituras: segundo episódio.
  const again = run([
    diverging,
    diverging,
    diverging,
    agreeing,
    diverging,
    diverging,
    diverging,
  ]);
  assert.equal(again.at(-1).divergence.total, 2);
  assert.deepEqual(again[3].divergence.current, []);
  // Ouro, nível, loja e itens não têm com quem divergir.
  assert.equal(run([{ gep: gepNow() }])[0].divergence.total, 0);
});

test("loja escondida segundo o GEP não vale; loja e itens comparam o conteúdo, não a referência", () => {
  const shop = [{ id: "A" }, null, { id: "B" }];
  const c = candidatesFor(
    filesSeen(),
    {
      shop: { value: shop, visible: true },
      items: { value: ["x", "x", "y"] },
    },
    null,
  );
  assert.equal(c.shop[0].key, "A||B");
  assert.equal(c.items[0].key, "x|x|y");
  const hidden = candidatesFor(
    filesSeen(),
    { shop: { value: shop, visible: false } },
    null,
  );
  assert.equal(hidden.shop[0].value, null, "loja escondida não vale");
});

test("nível do GEP inconsistente não vale: abaixo do que o XP passivo garante ou do último nível aceito", () => {
  const seen = filesSeen("4-1");
  const low = run([{ seen, gep: gepNow({ level: { value: 3 }, xp: null }) }]);
  assert.equal(low[0].picks.level, null, "3 está abaixo do piso de 4-1");
  assert.equal(
    low[0].divergence.current.includes("level"),
    false,
    "descartado não conta como divergência",
  );
  // O nível aceito do GEP vira o piso nesta partida (o nível nunca cai) e zera na partida seguinte.
  const held = run([
    { seen, gep: gepNow({ level: { value: 7 }, xp: { value: "20/56" } }) },
    { seen, gep: gepNow({ level: { value: 6 }, xp: null }) },
    { seen, gameId: "g2", gep: gepNow({ level: { value: 6 }, xp: null }) },
  ]);
  assert.equal(held[0].picks.level, "gep");
  assert.equal(held[0].memory.held, 7);
  assert.equal(held[1].picks.level, null, "6 < 7 aceito antes");
  assert.equal(
    held[2].picks.level,
    "gep",
    "partida nova: sem nível aceito, o 6 vale",
  );
  assert.equal(held[2].memory.held, 6);
});

test("outra partida zera a escolha de fonte mas mantém os contadores de divergência", () => {
  const d = { gep: stageGep("2-6") };
  const out = run([d, d, d, { ...d, gameId: "g2" }]);
  assert.equal(out[2].divergence.total, 1);
  assert.equal(out[3].divergence.total, 1);
  assert.deepEqual(
    out[3].divergence.current,
    [],
    "episódio recomeça na partida nova",
  );
  assert.equal(out[3].memory.game, "g2");
});

test("GameState: cada campo com valor, fonte, confiança e idade; reserva sem GEP é desconhecida", () => {
  const seen = {
    gold: 14,
    level: 6,
    xp: "10/36",
    stage: "3-2",
    phase: "Planning",
    shop: [{ id: "A" }, null],
    items: ["DA_Component_BFSword"],
    removers: 0,
    gepBench: undefined,
    sources: {
      gold: "gep",
      level: "derived",
      xp: "gep",
      stage: "game-log",
      phase: "game-log",
      items: "gep",
      shop: "gep",
      bench: null,
    },
    sourcesDetail: { gold: { source: "gep", ageMs: 400 } },
  };
  const state = buildGameState(seen, { now: 100_000, gameId: "g1" });
  assert.equal(state.me.gold.value, 14);
  assert.equal(state.me.gold.source, "gep");
  assert.equal(state.me.gold.confidence, "observed");
  assert.equal(state.me.gold.ageMs, 400);
  assert.equal(state.me.gold.at, 99_600);
  assert.equal(state.me.level.source, "derived");
  assert.equal(state.me.level.confidence, "derived");
  assert.equal(state.me.xp.confidence, "observed");
  assert.equal(state.clock.stage.source, "sentry");
  assert.equal(state.me.itemBank.source, "gep");
  assert.deepEqual(state.me.bench, unknownField());
  const brief = summarizeState(state);
  assert.equal(brief.me.shop.count, 2);
  assert.equal(
    "value" in brief.me.shop,
    false,
    "listas viram contagem no /api/state",
  );
  assert.equal(brief.me.gold.value, 14);
});

test("entradas da análise: ouro, nível, XP, estágio e loja saem do estado do servidor", () => {
  const seen = {
    gold: 54,
    level: 8,
    xp: "23/68",
    stage: "4-2",
    shop: [{ id: "DA_18_Elise" }, null],
    removers: 0,
    augments: ["AUG_A", "AUG_B"],
    sources: { level: "gep" },
  };
  const live = analysisInputs(seen, { augments: [], estimatedLevel: 5 });
  assert.equal(live.level, 8);
  assert.equal(live.levelEstimated, false);
  assert.equal(live.levelSource, "lido");
  assert.equal(live.gold, 54);
  assert.deepEqual(live.stage, { stage: 4, round: 2 });
  assert.deepEqual(live.shop, ["DA_18_Elise", null]);
  assert.equal(live.removers, 0);
  assert.equal(live.hasRemover, false);
  assert.deepEqual(live.augmentIds, ["AUG_A", "AUG_B"]);
  // A oferta some quando uma das cartas já foi marcada.
  assert.deepEqual(
    analysisInputs(seen, { augments: ["AUG_B"] }).augmentIds,
    [],
  );
  // Piso derivado: nível usado, marcado "derivado".
  const derived = analysisInputs({ ...seen, sources: { level: "derived" } });
  assert.equal(derived.levelSource, "derivado");
  assert.equal(derived.levelEstimated, false);
  // Sem leitura nem piso: o tabuleiro (estimativa de último recurso) ou o padrão antigo, sempre marcado.
  const unread = analysisInputs({ stage: "2-1" }, { estimatedLevel: 5 });
  assert.equal(unread.level, 5);
  assert.equal(unread.levelEstimated, true);
  assert.equal(unread.levelSource, "estimado");
  assert.equal(unread.gold, null, "ouro não lido é null, nunca um padrão");
  assert.equal(analysisInputs({}).level, 7);
  assert.equal(analysisInputs({ gold: 1200 }).gold, null);
  assert.equal(analysisInputs({ gold: 0 }).gold, 0);
  assert.equal(analysisInputs({ stage: "lixo" }).stage, null);
});

test("entradas da análise: o payload do cliente não decide (D6) e a partida revista mantém o dele", () => {
  // O servidor compõe `options` com Object.assign(options, analysisInputs(...)): os campos do cliente (defasados) perdem.
  const stale = {
      level: 3,
      gold: 99,
      levelEstimated: true,
      levelSource: "estimado",
    },
    server = { gold: 12, level: 7, stage: "3-1", sources: { level: "gep" } };
  const merged = { ...stale, ...analysisInputs(server, { estimatedLevel: 4 }) };
  assert.equal(merged.level, 7);
  assert.equal(merged.gold, 12);
  assert.equal(merged.levelEstimated, false);
  assert.equal(merged.levelSource, "lido");
  // Partida revista: nenhum dos quatro campos é tocado (ficam os do cliente).
  const replay = analysisInputs({}, { live: false });
  for (const k of ["level", "gold", "levelEstimated", "levelSource"])
    assert.equal(k in replay, false, k);
  assert.deepEqual({ ...stale, ...replay }.level, 3);
});

/** Fontes falsas para o montador do servidor: o arquivo do jogo (Sentry) e o GEP. */
function rig({ readings } = {}) {
  const r = {
    gameNow: {
      available: true,
      stage: "3-2",
      phase: "Planning",
      phaseKind: "planning",
    },
    gepNow: null,
    events: [],
  };
  r.hub = createStateHub({
    gameFiles: { status: () => r.gameNow },
    gep: { status: () => r.gepNow },
    now: () => 1_000_000,
    onDivergence: (e) => r.events.push(e),
    readings,
  });
  r.seen = (gepCtx = {}) => r.hub.seen("g1", gepCtx);
  return r;
}
const gepStatus = (gold, level = 6, stage = null) => ({
  available: true,
  state: "ativo",
  fields: {
    gold: { value: gold, ageMs: 50 },
    level: { value: level, ageMs: 50 },
    xp: { value: "10/36", ageMs: 50 },
    stage: stage ? { value: stage, ageMs: 50 } : null,
    shop: null,
    items: null,
    bench: null,
  },
});

test("montador: o GEP preenche os campos do jogador; o estágio do arquivo do jogo vale e a divergência é contada", () => {
  const t = rig();
  t.gepNow = gepStatus(15, 6, "3-3");
  const seen = [t.seen(), t.seen(), t.seen(), t.seen()];
  for (const s of seen) {
    assert.equal(s.gold, 15);
    assert.equal(s.sources.gold, "gep");
    assert.equal(s.sourcesDetail.gold.confidence, "observed");
    assert.equal(s.stage, "3-2", "o Sentry vale mais que o GEP");
    assert.equal(s.sources.stage, "game-log");
  }
  assert.equal(t.events.length, 1, "um evento por episódio");
  assert.deepEqual(t.events[0], {
    field: "stage",
    gep: "3-3",
    base: "3-2",
    active: "base",
  });
  assert.equal(t.hub.divergence().total, 1);
  assert.deepEqual(t.hub.divergence().current, ["stage"]);
  const gs = t.hub.gameState(seen[3], "g1");
  assert.equal(gs.me.gold.value, 15);
  assert.equal(gs.me.gold.source, "gep");
  assert.equal(gs.me.level.source, "gep");
  assert.deepEqual(
    gs.me.bench,
    { ...unknownField(), reason: "aguardando-gep" },
    "sem reserva do GEP, a reserva não tem fonte (e diz o motivo)",
  );
});

test("montador: GEP some -> campos do jogador desconhecidos na hora (com o motivo) e o nível vira piso do último observado; GEP volta -> vale na hora", () => {
  const t = rig();
  t.gepNow = gepStatus(15, 6);
  const on = t.seen();
  assert.equal(on.gold, 15);
  assert.equal(on.level, 6);
  t.gameNow = { ...t.gameNow, stage: "4-1" };
  t.gepNow = {
    available: false,
    state: "obsoleto",
    reason: "sem-eventos-recentes",
  };
  const off = t.seen();
  assert.equal(off.gold, null, "nada de ouro inventado");
  assert.equal(off.xp, null);
  assert.equal(off.sources.gold, null);
  assert.equal(off.noSource.gold, "sem-eventos-recentes");
  assert.equal(off.noSource.shop, "sem-eventos-recentes");
  assert.equal(off.noSource.level, undefined, "o piso derivado é um valor");
  assert.equal(
    off.level,
    levelFloor("4-1", { level: 6, xp: "10/36", stage: "3-2" }),
  );
  assert.equal(off.sources.level, "derived");
  assert.equal(off.levelInfo.minimum, true);
  assert.equal(off.gepStatus.state, "obsoleto");
  t.gepNow = gepStatus(15, 6);
  const back = t.seen();
  assert.equal(
    back.gold,
    15,
    "sem outra fonte para segurar o campo, o GEP vale na hora",
  );
  assert.equal(back.level, 6);
  assert.equal(back.sources.level, "gep");
  // O GEP falso não traz a identidade local: o banco de itens diz isso, e não "vazio".
  assert.deepEqual(back.noSource, {
    shop: "aguardando-gep",
    items: "identidade-desconhecida",
    bench: "aguardando-gep",
    board: "aguardando-gep",
    wisps: "aguardando-gep",
    augments: "aguardando-gep",
  });
});

test("montador: nível do GEP que contradiz o estágio não vale; fica o piso derivado", () => {
  const t = rig();
  t.gameNow = { ...t.gameNow, stage: "4-1" };
  t.gepNow = gepStatus(15, 3);
  const s = t.seen();
  assert.equal(s.level, levelFloor("4-1"));
  assert.equal(s.sources.level, "derived");
  assert.equal(s.gold, 15, "o ouro do mesmo GEP continua valendo");
});

test("montador: sem fonte nenhuma de reserva, sources.bench é null (não 'manual')", () => {
  const t = rig();
  assert.equal(t.seen().sources.bench, null);
  t.gepNow = gepStatus(15);
  assert.equal(
    t.seen().sources.bench,
    null,
    "GEP ativo sem reserva lida: continua sem fonte",
  );
  assert.equal(t.seen().gepBench, undefined);
  t.gepNow = {
    ...gepStatus(15),
    fields: {
      ...gepStatus(15).fields,
      bench: {
        value: [{ id: "DA_18_Elise", stars: 1, items: [] }],
        ageMs: 10,
        unknown: 0,
      },
    },
  };
  const s = t.seen();
  assert.equal(s.sources.bench, "gep");
  assert.equal(s.gepBench.length, 1);
});
