// ARQUIVO HISTÓRICO (fora da suíte: os globs de teste não entram em .old/). Casos de tests/core-state.test.mjs que só
// existiam para a leitura de tela: precedência e divergência GEP x tela, histerese com a tela como reserva, o descarte de
// leituras de nível do OCR em reduceLevel e o montador de estado com um leitor de tela falso. Copiados como estavam em
// 2026-10-11, antes da remoção; dependem do comportamento antigo de core/state/ (precedência com a tela como "base",
// reduceLevel com a origem "screen" e `createStateHub({ screen })`), que não existe mais. Ver .old/ocr/README.md.
// (Era: node --test tft/helper/tests/core-state.test.mjs)
// Camada de estado (M7): relógio, nível, `Field`, precedência com histerese e divergência GEP x tela, `GameState`, entradas
// da análise e o montador do servidor (app/state.mjs) com fontes falsas.
import test from "node:test";
import assert from "node:assert/strict";
import { parseStage, stageText } from "../../../core/state/clock.mjs";
import {
  field,
  unknownField,
  confidenceOf,
} from "../../../core/state/field.mjs";
import {
  XP,
  levelConsistent,
  levelFloor,
  reduceLevel,
  roundNumber,
} from "../../../core/state/level.mjs";
import {
  HYSTERESIS_READINGS,
  candidatesFor,
  initialPrecedence,
  reduceSources,
} from "../../../core/state/precedence.mjs";
import {
  buildGameState,
  summarizeState,
} from "../../../core/state/game-state.mjs";
import { analysisInputs } from "../../../core/state/inputs.mjs";
import { createStateHub } from "../../../app/state.mjs";
import { levelTracker } from "../../../level.mjs";
import { GAME } from "../../../rules.mjs";

test("nível: reduceLevel (puro) dá o mesmo resultado que o rastreador e não mexe na entrada", () => {
  const seen = {
    stage: "3-2",
    level: 6,
    xp: "10/36",
    stale: {},
    sources: { level: "screen" },
  };
  const frozen = structuredClone(seen),
    pure = reduceLevel({ game: null, anchor: null }, seen, "g1"),
    tracked = levelTracker().apply(seen, "g1");
  assert.deepEqual(seen, frozen);
  assert.deepEqual(pure.seen, tracked);
  assert.equal(pure.memory.anchor.level, 6);
  // Outra partida zera a âncora: a leitura baixa deixa de ser comparada com a partida anterior.
  const next = reduceLevel(pure.memory, { ...seen, level: 2, xp: null }, "g2");
  assert.equal(next.memory.game, "g2");
  assert.ok(next.seen.levelInfo.rejected?.reason.includes("mínimo"));
});

const screenSeen = (extra = {}) => ({
  gold: 12,
  level: 5,
  xp: "3/20",
  stage: "2-5",
  shop: null,
  items: null,
  sources: { stage: "screen" },
  ...extra,
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
      seen: step.seen ?? screenSeen(),
      gep: step.gep ?? null,
      readings,
    });
    memory = r.memory;
    out.push(r);
  }
  return out;
};

test("precedência: GEP fresco e consistente vence a tela; sem GEP vale a tela; um valor só por campo", () => {
  const [first] = run([{ gep: gepNow() }]);
  assert.equal(first.picks.gold, "gep");
  assert.equal(first.picks.level, "gep");
  assert.equal(first.picks.xp, "gep", "o XP acompanha o nível");
  const [alone] = run([{}]);
  assert.equal(alone.picks.gold, "base");
  assert.equal(alone.picks.shop, null, "nenhuma fonte tem a loja");
  const [off] = run([{ gep: { ...gepNow(), available: false } }]);
  assert.equal(off.picks.gold, "base", "GEP indisponível não vale");
  // GEP sem o ouro (campo ausente): o ouro cai para a tela, o resto continua do GEP.
  const [partial] = run([{ gep: gepNow({ gold: null }) }]);
  assert.equal(partial.picks.gold, "base");
  assert.equal(partial.picks.level, "gep");
});

test("precedência: o estágio do arquivo do jogo vale mais que o GEP; sem ele, o GEP vale mais que a tela", () => {
  const gep = gepNow({ stage: { value: "2-6", ageMs: 10 } });
  const [withLog] = run([
    { seen: screenSeen({ stage: "2-5", sources: { stage: "game-log" } }), gep },
  ]);
  assert.equal(withLog.picks.stage, "base");
  const [noLog] = run([{ gep }]);
  assert.equal(noLog.picks.stage, "gep");
});

test("histerese: a tela segura o campo até o GEP ser o preferido por N leituras seguidas", () => {
  const steps = [
    {},
    {},
    { gep: gepNow() },
    { gep: gepNow() },
    { gep: gepNow() },
  ];
  const picks = run(steps).map((r) => r.picks.gold);
  assert.deepEqual(picks, ["base", "base", "base", "base", "gep"]);
  // Uma leitura sem GEP no meio zera a contagem: o novo desafiante recomeça.
  const flap = run([
    {},
    { gep: gepNow() },
    { gep: gepNow() },
    {},
    { gep: gepNow() },
    { gep: gepNow() },
  ]).map((r) => r.picks.gold);
  assert.deepEqual(flap, ["base", "base", "base", "base", "base", "base"]);
});

test("histerese: a fonte ativa que perde o valor cede na hora (não se segura campo sem valor)", () => {
  const picks = run([
    { gep: gepNow() },
    { gep: gepNow() },
    { gep: { ...gepNow(), available: false } },
  ]).map((r) => r.picks.gold);
  assert.deepEqual(picks, ["gep", "gep", "base"]);
  // O contrário também: sem tela, o GEP assume na hora.
  const [toGep] = run([
    { seen: screenSeen({ gold: null, level: null }), gep: gepNow() },
  ]);
  assert.equal(toGep.picks.gold, "gep");
  assert.equal(toGep.picks.level, "gep");
});

test("divergência: conta um episódio (não cada leitura), registra o evento e some quando concordam", () => {
  const diverging = { gep: gepNow() }; // ouro 15 (GEP) x 12 (tela)
  const agreeing = { gep: gepNow({ gold: { value: 12, ageMs: 5 } }) };
  const out = run([diverging, diverging, diverging, diverging, diverging]);
  assert.deepEqual(
    out.map((r) => r.events.length),
    [0, 0, 1, 0, 0],
    "um único evento, na N-ésima leitura",
  );
  assert.equal(out[2].events[0].field, "gold");
  assert.equal(out[2].events[0].gep, 15);
  assert.equal(out[2].events[0].base, 12);
  assert.equal(out[2].events[0].active, "gep", "o valor que vale é o do GEP");
  assert.deepEqual(out[4].divergence.current, ["gold"]);
  assert.equal(out[4].divergence.total, 1);
  assert.equal(out[4].divergence.byField.gold, 1);
  // Atraso passageiro da tela (1 ou 2 leituras) não é divergência.
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
  assert.deepEqual(
    again[3].divergence.current,
    [],
    "concordando, não há divergência atual",
  );
});

test("divergência: loja e itens comparam o conteúdo (ids, itens sem ordem), não a referência", () => {
  const shopGep = [{ id: "A" }, null, { id: "B" }],
    shopScreen = [{ id: "A" }, null, { id: "B" }];
  const c = candidatesFor(
    screenSeen({ shop: shopScreen, items: ["x", "y", "x"] }),
    {
      shop: { value: shopGep, visible: true },
      items: { value: ["x", "x", "y"] },
    },
    null,
  );
  assert.equal(c.shop[0].key, c.shop[1].key);
  assert.equal(c.items[0].key, c.items[1].key);
  const hidden = candidatesFor(
    screenSeen({ shop: shopScreen }),
    { shop: { value: shopGep, visible: false } },
    null,
  );
  assert.equal(
    hidden.shop[0].value,
    null,
    "loja escondida segundo o GEP não vale",
  );
});

test("nível do GEP inconsistente não vale: abaixo do que o XP passivo garante ou do último nível aceito", () => {
  const seen = screenSeen({ level: 7, xp: "20/56", stage: "4-1" });
  const low = run([{ seen, gep: gepNow({ level: { value: 3 }, xp: null }) }]);
  assert.equal(low[0].picks.level, "base", "3 está abaixo do piso de 4-1");
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
  assert.equal(held[1].picks.level, "base", "6 < 7 aceito antes");
  assert.equal(
    held[2].picks.level,
    "gep",
    "partida nova: sem nível aceito, o 6 vale",
  );
  assert.equal(held[2].memory.held, 6);
});

test("outra partida zera a escolha de fonte mas mantém os contadores de divergência", () => {
  const d = { gep: gepNow() };
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

/** Fontes falsas para o montador do servidor. */
function rig({ readings } = {}) {
  const r = {
    screenNow: {
      running: true,
      stage: "3-2",
      gold: 12,
      level: 6,
      levelSource: "ocr+xp",
      xp: "10/36",
      stale: {},
      items: null,
      bank: null,
      shop: null,
      removers: null,
    },
    gameNow: { available: false, stage: null },
    gepNow: null,
    calls: [],
    events: [],
  };
  r.hub = createStateHub({
    screen: { status: () => r.screenNow },
    gameFiles: { status: () => r.gameNow },
    gep: { status: () => r.gepNow },
    now: () => 1_000_000,
    onDivergence: (e) => r.events.push(e),
    readings,
  });
  r.seen = (gepCtx = {}) => r.hub.seen("g1", gepCtx);
  return r;
}
const gepStatus = (gold, level = 6) => ({
  available: true,
  state: "ativo",
  fields: {
    gold: { value: gold, ageMs: 50 },
    level: { value: level, ageMs: 50 },
    xp: { value: "10/36", ageMs: 50 },
    stage: null,
    shop: null,
    items: null,
    bench: null,
  },
});

test("montador: GEP e tela nunca saem discordando; a divergência é registrada e contada", () => {
  const t = rig();
  t.gepNow = gepStatus(15);
  const seen = [t.seen(), t.seen(), t.seen(), t.seen()];
  for (const s of seen) {
    assert.equal(s.gold, 15, "sempre o valor do GEP");
    assert.equal(s.sources.gold, "gep");
    assert.equal(s.sourcesDetail.gold.confidence, "observed");
  }
  assert.equal(t.events.length, 1, "um evento por episódio");
  assert.equal(t.events[0].field, "gold");
  assert.equal(t.hub.divergence().total, 1);
  assert.equal(t.hub.divergence().byField.gold, 1);
  assert.deepEqual(t.hub.divergence().current, ["gold"]);
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

test("montador: GEP some -> a tela assume na hora; GEP volta -> só depois de N leituras", () => {
  const t = rig();
  t.gepNow = gepStatus(15);
  assert.equal(t.seen().gold, 15);
  t.gepNow = { available: false, state: "obsoleto" };
  const fallback = t.seen();
  assert.equal(fallback.gold, 12);
  assert.equal(fallback.sources.gold, "screen");
  assert.equal(fallback.gepStatus.state, "obsoleto");
  t.gepNow = gepStatus(15);
  const back = [t.seen().gold, t.seen().gold, t.seen().gold];
  assert.deepEqual(
    back,
    [12, 12, 15],
    "histerese: a tela segura até a 3ª leitura",
  );
});

test("montador: nível do GEP que contradiz o estágio não vale; a tela fica", () => {
  const t = rig();
  t.screenNow = { ...t.screenNow, stage: "4-1", level: 7, xp: "20/56" };
  t.gepNow = gepStatus(15, 3);
  const s = t.seen();
  assert.equal(s.level, 7);
  assert.equal(s.sources.level, "screen");
  assert.equal(s.gold, 15, "o ouro do mesmo GEP continua valendo");
});
