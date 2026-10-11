// Rodar com: node --test tft/helper/v2/js/api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { REFRESH_WINDOW_MS, analysisKey, recommendPayload } from "./api.js";

const state = (extra = {}) => ({
  signature: "sig1",
  modifiedAt: "2026-10-10T12:00:00Z",
  phase: "InProgress",
  actionable: true,
  sameGame: true,
  match: { id: 1 },
  screen: {
    xp: "2/20",
    stage: "2-3",
    shop: ["A", "B"],
    augments: [],
    removers: 0,
    gold: 30,
    level: 4,
    items: ["A"],
    sources: { level: "screen" },
  },
  ...extra,
});
// O payload do POST só leva decisões do usuário; ouro, nível e banco de itens vêm do estado (screen).
const payload = { goalCompId: "", compSwaps: {} };
const at = (ms, fn) => {
  const real = Date.now;
  Date.now = () => ms;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
};

test("regravar o arquivo sem mudar o jogo não pede análise nova; mudar o jogo, sim", () => {
  const t = 1_800_000_000_000;
  const key = at(t, () => analysisKey(state(), payload));
  assert.equal(
    at(t, () =>
      analysisKey(state({ modifiedAt: "2026-10-10T12:00:09Z" }), payload),
    ),
    key,
  );
  assert.notEqual(
    at(t, () => analysisKey(state({ signature: "sig2" }), payload)),
    key,
  );
  // Ouro, nível, banco de itens e se o nível é piso derivado entram na chave pelo estado, não pelo payload.
  for (const screen of [
    { gold: 31 },
    { level: 5 },
    { items: ["A", "B"] },
    { sources: { level: "derived" } },
  ])
    assert.notEqual(
      at(t, () =>
        analysisKey(
          state({ screen: { ...state().screen, ...screen } }),
          payload,
        ),
      ),
      key,
      JSON.stringify(screen),
    );
  // Uma decisão do usuário (comp fixada) continua mudando a chave.
  assert.notEqual(
    at(t, () => analysisKey(state(), { ...payload, goalCompId: "comp-x" })),
    key,
  );
  assert.notEqual(
    at(t, () =>
      analysisKey(
        state({ screen: { ...state().screen, shop: ["A", "C"] } }),
        payload,
      ),
    ),
    key,
  );
});

test("parado, a análise só é refeita depois da janela de renovação (não a cada 30 s)", () => {
  const t =
    Math.floor(1_800_000_000_000 / REFRESH_WINDOW_MS) * REFRESH_WINDOW_MS;
  const key = at(t, () => analysisKey(state(), payload));
  assert.equal(
    at(t + 60_000, () => analysisKey(state(), payload)),
    key,
    "60 s depois: mesma análise",
  );
  assert.notEqual(
    at(t + REFRESH_WINDOW_MS, () => analysisKey(state(), payload)),
    key,
  );
  assert.ok(REFRESH_WINDOW_MS > 30_000);
});

test("servidor antigo sem assinatura: cai para o horário do arquivo", () => {
  const t = 1_800_000_000_000;
  const old = (modifiedAt) => state({ signature: undefined, modifiedAt });
  assert.notEqual(
    at(t, () => analysisKey(old("a"), payload)),
    at(t, () => analysisKey(old("b"), payload)),
  );
});

test("o payload do POST leva só decisões do usuário; o servidor lê ouro, nível e itens do próprio estado", () => {
  const live = {
    localPlayerId: "47445859",
    estimatedLevel: 6,
    screen: {
      gold: 54,
      level: 8,
      items: ["DA_Component_BFSword"],
      sources: { level: "derived" },
    },
  };
  const goal = { id: "comp-a", swaps: [{ out: "X", in: "Y" }] },
    body = recommendPayload(live, goal, [{ id: "AUG_1" }], { "comp-b": [] });
  for (const gone of [
    "level",
    "gold",
    "inventory",
    "bench",
    "levelEstimated",
    "levelSource",
  ])
    assert.equal(gone in body, false, `${gone} não vai mais do cliente`);
  assert.deepEqual(body.augments, ["AUG_1"]);
  assert.equal(body.goalCompId, "comp-a");
  assert.deepEqual(body.goalSwaps, goal.swaps);
  assert.deepEqual(
    body.compSwaps,
    {},
    "com comp fixada as trocas do automático não valem",
  );
  assert.deepEqual(
    recommendPayload(live, null, [], { "comp-b": [{ out: "A", in: "B" }] })
      .compSwaps,
    {
      "comp-b": [{ out: "A", in: "B" }],
    },
  );
});

test("partida revista: os campos antigos do cliente continuam indo (a leitura de agora não vale para ela)", () => {
  const body = recommendPayload(
    { localPlayerId: "1", estimatedLevel: 6, screen: {} },
    null,
    [],
    {},
    { replay: true },
  );
  assert.equal(body.level, 6);
  assert.equal(body.gold, null);
  assert.deepEqual(body.inventory, []);
  assert.equal(body.levelEstimated, true);
  assert.equal(body.levelSource, "estimado");
});
