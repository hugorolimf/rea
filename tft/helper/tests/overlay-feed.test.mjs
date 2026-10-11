// Rodar com: node --test tft/helper/tests/overlay-feed.test.mjs
// O feed do overlay guarda só em memória os últimos corpos de /api/state e de /api/recommend ao vivo; GET /api/overlay
// os devolve sem calcular nada. Este teste fixa o contrato (rev, unchanged, idade) com relógio injetado.
import test from "node:test";
import assert from "node:assert/strict";
import { createOverlayFeed } from "../app/overlay-feed.mjs";

/** Relógio manual: `clock.t` é o "agora" em ms. */
const makeClock = (t = 1_000) => {
  const clock = { t, now: () => clock.t };
  return clock;
};

test("sem nada registrado: state e recommendation nulos, rev 0.0", () => {
  const feed = createOverlayFeed({ now: makeClock(5_000).now });
  assert.deepEqual(feed.snapshot(), {
    version: 1,
    now: 5_000,
    rev: "0.0",
    state: null,
    recommendation: null,
  });
});

test("registrar só o state não altera a recomendação, e vice-versa; rev conta cada gravação", () => {
  const clock = makeClock(),
    feed = createOverlayFeed({ now: clock.now }),
    state = { screen: { gold: 30 } },
    rec = { metadata: { gameId: "g1" }, recommendations: [] };
  feed.recordState(state);
  let snap = feed.snapshot();
  assert.equal(snap.rev, "1.0");
  assert.equal(snap.state.body, state);
  assert.equal(snap.recommendation, null);
  clock.t += 10;
  feed.recordRecommendation(rec);
  snap = feed.snapshot();
  assert.equal(snap.rev, "1.1");
  assert.equal(snap.recommendation.body, rec);
  assert.equal(snap.state.body, state, "o state anterior segue igual");
  feed.recordState({ screen: { gold: 31 } });
  assert.equal(feed.snapshot().rev, "2.1");
  assert.equal(feed.snapshot().recommendation.body, rec);
});

test("at e ageMs vêm do relógio injetado; now é o do momento da leitura", () => {
  const clock = makeClock(1_000),
    feed = createOverlayFeed({ now: clock.now });
  feed.recordState({ a: 1 });
  clock.t = 1_500;
  feed.recordRecommendation({ b: 2 });
  clock.t = 4_000;
  const snap = feed.snapshot();
  assert.equal(snap.now, 4_000);
  assert.equal(snap.state.at, 1_000);
  assert.equal(snap.state.ageMs, 3_000);
  assert.equal(snap.recommendation.at, 1_500);
  assert.equal(snap.recommendation.ageMs, 2_500);
  // Relógio que anda para trás nunca dá idade negativa.
  clock.t = 900;
  assert.equal(feed.snapshot().state.ageMs, 0);
});

test("rev não depende do relógio: o tempo passar não muda rev", () => {
  const clock = makeClock(),
    feed = createOverlayFeed({ now: clock.now });
  feed.recordState({ a: 1 });
  const before = feed.snapshot().rev;
  clock.t += 60_000;
  assert.equal(feed.snapshot().rev, before);
});

test("snapshot({ since: rev atual }) é curto: unchanged, sem state nem recommendation", () => {
  const clock = makeClock(),
    feed = createOverlayFeed({ now: clock.now });
  feed.recordState({ a: 1 });
  feed.recordRecommendation({ b: 2 });
  const { rev } = feed.snapshot();
  clock.t += 250;
  const short = feed.snapshot({ since: rev });
  assert.deepEqual(short, { version: 1, now: 1_250, rev, unchanged: true });
  assert.ok(!("state" in short) && !("recommendation" in short));
  // Rev defasada, vazia ou ausente devolve o corpo completo.
  for (const since of ["0.0", "1.1x", "", undefined, null]) {
    const full = feed.snapshot({ since });
    assert.notEqual(full.unchanged, true, String(since));
    assert.ok(full.state && full.recommendation, String(since));
  }
  // Uma nova gravação invalida o `since` antigo.
  feed.recordState({ a: 2 });
  const after = feed.snapshot({ since: rev });
  assert.notEqual(after.unchanged, true);
  assert.notEqual(after.rev, rev);
});

test("os corpos não são copiados nem alterados: mesma referência de ida e de volta", () => {
  const feed = createOverlayFeed({ now: makeClock().now }),
    state = { screen: { gold: 30, items: ["a"] } },
    rec = { metadata: { gameId: "g1" }, recommendations: [{ id: 1 }] },
    frozen = JSON.stringify([state, rec]);
  // Os registradores devolvem o próprio corpo (o servidor responde com ele).
  assert.equal(feed.recordState(state), state);
  assert.equal(feed.recordRecommendation(rec), rec);
  const snap = feed.snapshot(),
    again = feed.snapshot();
  assert.equal(snap.state.body, state);
  assert.equal(snap.recommendation.body, rec);
  assert.equal(again.state.body, state);
  assert.equal(
    JSON.stringify([state, rec]),
    frozen,
    "ler o feed não muda os corpos",
  );
  // O envelope é novo a cada leitura: alterar uma leitura não afeta a seguinte.
  snap.state.ageMs = 999;
  assert.notEqual(feed.snapshot().state.ageMs, 999);
});
