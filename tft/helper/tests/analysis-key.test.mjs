// Rodar com: node --test "tft/helper/tests/analysis-key.test.mjs"
// A chave de análise mora em core/state/analysis-key.mjs (M10b): o cliente (v2/js/api.js) e o servidor (laço automático e
// POST) calculam a MESMA chave. Estes testes fixam a equivalência com o código de antes (copiado de v2/js/api.js) e a
// igualdade entre as decisões que o cliente manda e as que o servidor lembra.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFRESH_WINDOW_MS,
  analysisKey,
  decisionPayload,
} from "../core/state/analysis-key.mjs";
import * as api from "../v2/js/api.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- Referência: a chave de antes da migração (v2/js/api.js), copiada sem mudança ---------- */
const legacyKey = (state, payload, now) =>
  JSON.stringify({
    payload,
    source: state.signature ?? state.modifiedAt,
    phase: state.phase,
    actionable: state.actionable,
    sameGame: state.sameGame,
    match: state.match?.id,
    screen: {
      xp: state.screen?.xp,
      stage: state.screen?.stage,
      shop: state.screen?.shop,
      augments: state.screen?.augments,
      pickedAugments: state.screen?.pickedAugments,
      removers: state.screen?.removers,
      gold: state.screen?.gold,
      level: state.screen?.level,
      levelSource: state.screen?.sources?.level,
      items: state.screen?.items,
      bench: state.screen?.gepBench,
    },
    estimatedLevel: state.screen?.level == null ? state.estimatedLevel : null,
    window: Math.floor(now / REFRESH_WINDOW_MS),
  });

const state = (extra = {}) => ({
  signature: "sig1",
  modifiedAt: "2026-10-10T12:00:00Z",
  phase: "InProgress",
  actionable: true,
  sameGame: true,
  match: { id: "G1" },
  localPlayerId: "47445859",
  estimatedLevel: 6,
  screen: {
    xp: "2/20",
    stage: "2-3",
    shop: ["A", "B"],
    augments: [],
    pickedAugments: [],
    removers: 0,
    gold: 30,
    level: 4,
    items: ["I1"],
    gepBench: [],
    sources: { level: "tela" },
  },
  ...extra,
});
const T0 = 15_000_000 * REFRESH_WINDOW_MS; // início de uma janela

test("a chave do núcleo é idêntica à de antes, para estados e instantes variados", () => {
  const states = [
    state(),
    state({ signature: undefined }),
    state({ screen: { ...state().screen, level: null, gold: null } }),
    state({ screen: undefined }),
    state({ match: undefined, phase: null, sameGame: null }),
  ];
  const payloads = [
    { goalCompId: "", compSwaps: {} },
    decisionPayload(state(), { goalCompId: "c1", augmentsKnown: true }),
  ];
  for (const s of states)
    for (const p of payloads)
      for (const t of [
        T0,
        T0 + 1,
        T0 + REFRESH_WINDOW_MS - 1,
        T0 + 5 * REFRESH_WINDOW_MS,
      ])
        assert.equal(analysisKey(s, p, t), legacyKey(s, p, t));
});

test("a janela de renovação é de 120 s e o cliente só acrescenta o relógio", () => {
  assert.equal(REFRESH_WINDOW_MS, 120000);
  assert.equal(api.REFRESH_WINDOW_MS, REFRESH_WINDOW_MS);
  const p = decisionPayload(state());
  assert.equal(
    analysisKey(state(), p, T0),
    analysisKey(state(), p, T0 + REFRESH_WINDOW_MS - 1),
  );
  assert.notEqual(
    analysisKey(state(), p, T0),
    analysisKey(state(), p, T0 + REFRESH_WINDOW_MS),
  );
  const real = Date.now;
  Date.now = () => T0 + 7;
  try {
    assert.equal(api.analysisKey(state(), p), analysisKey(state(), p, T0 + 7));
  } finally {
    Date.now = real;
  }
});

test("as decisões que o cliente manda e as que o servidor lembra dão o mesmo corpo e a mesma chave", () => {
  const s = state();
  const goal = {
    id: "comp-1",
    swaps: [{ out: "A", in: "B" }],
  };
  const cases = [
    { goal: null, augments: [], compSwaps: {}, known: false },
    {
      goal: null,
      augments: [{ id: "Aug1" }],
      compSwaps: { c9: [{ out: "X", in: "Y" }] },
      known: true,
    },
    {
      goal,
      augments: [{ id: "Aug1" }, { id: "Aug2" }],
      compSwaps: { c9: [{ out: "X", in: "Y" }] },
      known: true,
    },
  ];
  for (const c of cases) {
    const fromClient = api.decisionsOf(
      s,
      c.goal,
      c.augments,
      c.compSwaps,
      c.known,
    );
    // O servidor guarda o que validou do POST: ids, comp fixada, trocas e se a tela tem registro de aprimoramentos.
    const stored = JSON.parse(
      JSON.stringify({
        goalCompId: c.goal?.id ?? "",
        goalSwaps: c.goal?.swaps ?? [],
        compSwaps: c.goal ? {} : c.compSwaps,
        augments: c.augments.map((a) => a.id),
        augmentsKnown: c.known,
      }),
    );
    const fromServer = decisionPayload(s, stored);
    assert.equal(JSON.stringify(fromServer), JSON.stringify(fromClient));
    assert.equal(
      analysisKey(s, fromServer, T0),
      analysisKey(s, fromClient, T0),
    );
    // É o corpo do POST sem os campos do servidor legado, mais augmentsKnown.
    assert.deepEqual(
      {
        ...api.recommendPayload(s, c.goal, c.augments, c.compSwaps),
        augmentsKnown: c.known,
      },
      fromClient,
    );
  }
});

test("sem nenhuma decisão valem os padrões (e augmentsKnown só entra quando informado)", () => {
  const d = decisionPayload(state());
  assert.deepEqual(d, {
    augments: [],
    playerId: "47445859",
    viewedPlayerId: "",
    targetLevel: "auto",
    previewIds: [],
    side: "right",
    goalCarryId: "",
    goalCompId: "",
    goalSwaps: [],
    compSwaps: {},
  });
  assert.ok(!("augmentsKnown" in d));
  assert.equal(
    decisionPayload(state(), { augmentsKnown: false }).augmentsKnown,
    false,
  );
});

test("a chave reage ao que o jogo mudou e às decisões, e ignora o que não muda a análise", () => {
  const p = decisionPayload(state());
  const base = analysisKey(state(), p, T0);
  assert.notEqual(
    base,
    analysisKey(state({ screen: { ...state().screen, gold: 31 } }), p, T0),
  );
  assert.notEqual(base, analysisKey(state({ signature: "sig2" }), p, T0));
  assert.notEqual(
    base,
    analysisKey(state(), decisionPayload(state(), { goalCompId: "c1" }), T0),
  );
  // O horário do arquivo e a idade não entram quando há assinatura.
  assert.equal(
    base,
    analysisKey(state({ modifiedAt: "outro", ageSeconds: 99 }), p, T0),
  );
});

test("o núcleo da chave é puro: sem relógio próprio e sem node:*", () => {
  const text = fs.readFileSync(
    path.join(root, "core/state/analysis-key.mjs"),
    "utf8",
  );
  const code = text.replace(/\/\/.*$/gm, "");
  assert.ok(!/Date\.now|new Date|Math\.random|process\.|node:/.test(code));
});
