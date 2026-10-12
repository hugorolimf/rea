// Rodar com: node --test "tft/helper/tests/round-advice.test.mjs"
// O conselho de nível da rodada nova (app/round-advice.mjs). Reproduz a sequência medida na partida 3292194088
// (2026-10-12, GEP + __sentry-event + server.log): 3-7 termina com nível 6 e pouco ouro ("economize"); em 4-1 o GEP traz no
// mesmo segundo o round_type, a renda (80 g) e o XP passivo (22/36), e o arquivo do tabuleiro (TFTEoGStats.json) só é
// regravado quando o combate começa, ~34 s depois. A análise completa daquela rodada levou 29 s (espera de 7 s atrás de
// uma análise do estado anterior + base de 17 s): o "suba" chegava junto com o combate.
import test from "node:test";
import assert from "node:assert/strict";
import { strategy } from "../strategy.mjs";
import { createOverlayFeed } from "../app/overlay-feed.mjs";
import {
  createRoundAdvice,
  economyKey,
  refreshAdvice,
} from "../app/round-advice.mjs";
import {
  createAutoRefresh,
  createRecentResults,
} from "../app/auto-refresh.mjs";
import { makeState } from "./fixtures.mjs";

const GAME = 3292194088;
const card = (name, cost) => ({
  slot: 1,
  id: `TFT_${name}`,
  name,
  cost,
  action: "comprar",
  reason: "peça da meta",
});
// Fim de 3-7 (estado com que a última análise completa foi feita) e começo de 4-1 (renda e XP passivo já lidos pelo GEP).
const END_37 = { gold: 31, level: 6, xp: "18/36", stage: "3-7", hp: 79 };
const START_41 = { gold: 80, level: 6, xp: "22/36", stage: "4-1", hp: 79 };
const rivals = { count: 7, cost: 2, stars: 1, size: 6 };

/** Corpo como a análise completa o publica (JSON de ida e volta, como os bytes da thread), feito com `at`. */
function analyzedBody(at, { shop = [] } = {}) {
  const s = makeState({ ...at, rivals, shop });
  const plan = { ...s.plan, strategy: strategy(s.plan, s.analysis, s.options) };
  return JSON.parse(
    JSON.stringify({
      metadata: { gameId: GAME },
      ...s.analysis,
      currentLevel: at.level,
      levelEstimated: false,
      levelSource: "lido",
      preview: plan,
      recommendations: [plan],
    }),
  );
}
const optionsOf = (at) => makeState({ ...at, rivals }).options;
const bytesOf = (body) => Buffer.from(JSON.stringify(body), "utf8");
const shownAdvice = (feed) => {
  const rec = JSON.parse(feed.snapshotJson().toString("utf8")).recommendation
    .body;
  return {
    action: rec.preview.strategy.action,
    headline: rec.preview.strategy.headline,
    provisional: rec.provisional ?? null,
    stage: rec.provisional?.stage ?? null,
  };
};

test("o estado de 4-1 pede subir; o de 3-7 pede economizar (a regra não é a causa do atraso)", () => {
  assert.equal(
    analyzedBody(END_37).preview.strategy.action,
    "ECONOMIZAR",
    "3-7 com 31 g e nível 6 na curva: economizar",
  );
  assert.equal(
    analyzedBody(START_41).preview.strategy.action,
    "SUBIR NÍVEL",
    "4-1 com 80 g, nível 6 abaixo da curva (7): subir",
  );
});

test("o laço pede análise no primeiro tick do planejamento: ouro/XP/estágio do GEP mudam a chave sem o arquivo do tabuleiro", async () => {
  const clock = { t: 1_000_000 };
  const seen = (at) => ({
    gold: at.gold,
    level: at.level,
    xp: at.xp,
    stage: at.stage,
    shop: ["A"],
    items: [],
    sources: { level: "gep" },
  });
  let state = {
    gameId: String(GAME),
    signature: "tabuleiro-de-3-7", // TFTEoGStats.json: só é regravado quando o combate de 4-1 começa
    modifiedAt: "2026-10-12T00:51:04Z",
    phase: "InProgress",
    actionable: true,
    sameGame: true,
    match: { id: GAME, status: "live", boardReady: true },
    localPlayerId: "P1",
    players: [{ id: "P1" }],
    seen: seen(END_37),
  };
  const refreshed = [];
  const auto = createAutoRefresh({
    probe: () => ({ inMatch: true, gameId: GAME }),
    readState: () => state,
    refresh: (_decided, st) => {
      refreshed.push(st.seen.stage);
      return { status: 200 };
    },
    results: createRecentResults({ now: () => clock.t }),
    now: () => clock.t,
    timers: { setTimeout: () => null, clearTimeout: () => {} },
  });
  assert.equal((await auto.tick()).action, "run");
  clock.t += 3000;
  // Rodada nova: round_type 4-1, ouro 80 e XP 22/36 chegam juntos; o tabuleiro (assinatura) continua o mesmo.
  state = { ...state, seen: seen(START_41) };
  assert.equal((await auto.tick()).action, "run");
  assert.deepEqual(refreshed, ["3-7", "4-1"]);
});

test("rodada nova: o conselho de subir sai do último plano na hora, sem a loja velha", () => {
  const before = analyzedBody(END_37, { shop: [card("Xayah", 4)] });
  const out = refreshAdvice(before, optionsOf(START_41), { at: 123 });
  assert.equal(out.preview.strategy.action, "SUBIR NÍVEL");
  assert.equal(out.recommendations[0].strategy.action, "SUBIR NÍVEL");
  assert.equal(out.currentLevel, 6);
  assert.deepEqual(
    out.provisional && {
      stage: out.provisional.stage,
      gold: out.provisional.gold,
      newRound: out.provisional.newRound,
    },
    { stage: "4-1", gold: 80, newRound: true },
  );
  // A loja de 3-7 não existe mais em 4-1: nenhuma compra dela entra no conselho nem no campo publicado.
  assert.deepEqual(out.preview.stage.shop, []);
  assert.ok(
    !out.preview.strategy.steps.some((t) => t.startsWith("Compre na loja")),
  );
  assert.match(out.preview.strategy.reasons[0], /^Rodada nova \(4-1\)/);
  // O corpo de origem não muda.
  assert.equal(before.preview.strategy.action, "ECONOMIZAR");
  assert.equal(before.provisional, undefined);
});

test("mesma rodada: a loja classificada continua valendo no conselho refeito", () => {
  const at = { ...START_41, gold: 40 };
  const before = analyzedBody(at, { shop: [card("Xayah", 4)] });
  const out = refreshAdvice(before, optionsOf({ ...at, gold: 44 }), {
    sameRound: true,
  });
  assert.equal(out.preview.stage.shop.length, 1);
  assert.equal(out.preview.strategy.cash, 40, "44 g menos a compra de 4 g");
  assert.equal(out.provisional.newRound, false);
});

test("sequência real de 4-1: o overlay mostra 'suba' no começo do planejamento e a análise atrasada não o desfaz", () => {
  const feed = createOverlayFeed({ now: () => 0 });
  const advice = createRoundAdvice({ overlay: feed, now: () => 0 });
  // Fim de 3-7: a análise completa daquele estado é publicada.
  const old = optionsOf(END_37),
    oldKey = advice.observe(GAME, old);
  advice.publish(GAME, oldKey, "3-7", { bytes: bytesOf(analyzedBody(END_37)) });
  assert.equal(shownAdvice(feed).action, "ECONOMIZAR");
  assert.equal(shownAdvice(feed).provisional, null);
  // Um POST da interface pede análise ainda com o estado de 3-7 (no combate): nada muda no feed.
  assert.equal(advice.observe(GAME, old), oldKey);
  assert.equal(shownAdvice(feed).action, "ECONOMIZAR");
  // 4-1 começa: o laço lê ouro 80 / XP 22/36 / estágio 4-1 e, ANTES da análise pesada, o feed já diz para subir.
  const now41 = optionsOf(START_41),
    newKey = advice.observe(GAME, now41);
  assert.notEqual(newKey, oldKey);
  assert.deepEqual(
    (({ action, stage }) => ({ action, stage }))(shownAdvice(feed)),
    { action: "SUBIR NÍVEL", stage: "4-1" },
  );
  // A análise do POST (estado de 3-7) termina depois: o feed não volta para "economize" nem para 3-7.
  advice.publish(GAME, oldKey, "3-7", { bytes: bytesOf(analyzedBody(END_37)) });
  assert.deepEqual(
    (({ action, stage }) => ({ action, stage }))(shownAdvice(feed)),
    { action: "SUBIR NÍVEL", stage: "4-1" },
  );
  // A análise completa de 4-1 chega: vale ela, sem a marca de provisório.
  advice.publish(GAME, newKey, "4-1", { body: analyzedBody(START_41) });
  assert.equal(shownAdvice(feed).action, "SUBIR NÍVEL");
  assert.equal(shownAdvice(feed).provisional, null);
});

test("outra partida ou nenhum corpo publicado: nada é refeito", () => {
  const feed = createOverlayFeed({ now: () => 0 });
  const advice = createRoundAdvice({ overlay: feed });
  advice.observe(GAME, optionsOf(START_41));
  assert.equal(feed.recommendationBody(), null, "sem corpo, sem conselho");
  const k = advice.observe(GAME, optionsOf(END_37));
  advice.publish(GAME, k, "3-7", { body: analyzedBody(END_37) });
  advice.observe(GAME + 1, optionsOf(START_41));
  assert.equal(shownAdvice(feed).action, "ECONOMIZAR");
  assert.notEqual(
    economyKey(GAME, optionsOf(START_41)),
    economyKey(GAME + 1, optionsOf(START_41)),
  );
});
