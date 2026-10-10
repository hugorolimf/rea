// Rodar com: node --test tft/helper/v2/js/api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { REFRESH_WINDOW_MS, analysisKey } from "./api.js";

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
  },
  ...extra,
});
const payload = { level: 4, gold: 30 };
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
  assert.notEqual(
    at(t, () => analysisKey(state(), { ...payload, gold: 31 })),
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
