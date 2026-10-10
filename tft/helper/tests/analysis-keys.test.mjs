// Rodar com: node --test "tft/helper/tests/analysis-keys.test.mjs"
// O que invalida a análise: regravar o arquivo, mexer em posições ou na loja não refaz a base; o que muda o jogo, sim.
import test from "node:test";
import assert from "node:assert/strict";
import { baseId, baseInputs, snapshotSignature } from "../analysis-keys.mjs";

const piece = (championName, starLevel = 1, itemNames = []) => ({
  championName,
  starLevel,
  itemNames,
  price: 3,
});
const snap = (hero, rival = [piece("X")], extra = {}) => ({
  gameId: 7,
  statsBlock: {
    setCoreName: "TFTSet18",
    gameLengthSeconds: 100,
    players: [
      {
        playerId: 1,
        health: 80,
        ffaStanding: 2,
        augments: [],
        boardPieces: hero,
      },
      {
        playerId: 2,
        health: 70,
        ffaStanding: 3,
        augments: [],
        boardPieces: rival,
      },
    ],
    ...extra,
  },
});

test("assinatura: tempo de partida, ordem das peças e dos itens não mudam; estrela, item, vida e peça nova mudam", () => {
  const base = snapshotSignature(
    snap([piece("A", 1, ["I1", "I2"]), piece("B", 2)]),
  );
  assert.equal(
    snapshotSignature(
      snap([piece("B", 2), piece("A", 1, ["I2", "I1"])], undefined, {
        gameLengthSeconds: 999,
      }),
    ),
    base,
  );
  assert.notEqual(
    snapshotSignature(snap([piece("A", 2, ["I1", "I2"]), piece("B", 2)])),
    base,
    "estrela",
  );
  assert.notEqual(
    snapshotSignature(snap([piece("A", 1, ["I1"]), piece("B", 2)])),
    base,
    "item",
  );
  assert.notEqual(
    snapshotSignature(
      snap([piece("A", 1, ["I1", "I2"]), piece("B", 2), piece("C")]),
    ),
    base,
    "peça nova",
  );
  assert.notEqual(
    snapshotSignature(
      snap(
        [piece("A", 1, ["I1", "I2"]), piece("B", 2)],
        [piece("X"), piece("Y")],
      ),
    ),
    base,
    "rival",
  );
  const hurt = snap([piece("A", 1, ["I1", "I2"]), piece("B", 2)]);
  hurt.statsBlock.players[0].health = 60;
  assert.notEqual(snapshotSignature(hurt), base, "vida");
});

const options = (extra = {}) => ({
  level: 6,
  targetLevel: 7,
  gold: 30,
  playerId: "1",
  bench: [],
  hidden: {},
  inventory: [],
  previewIds: [],
  augmentTraits: [],
  augments: ["b", "a"],
  metaComps: [
    { id: "c1" },
    { id: "c2", appliedSwaps: [{ out: "x", in: "y" }] },
  ],
  goalCarryId: "",
  stickyCompId: "c1",
  sticky: { units: ["u1"] },
  stage: { stage: 3, round: 2 },
  // Só da camada tática: não entram na base.
  shop: ["u1", null],
  xp: "2/20",
  removers: 0,
  streak: { kind: "win", length: 2 },
  trend: null,
  ...extra,
});
const keys = { source: "sig", builds: "b1", comps: "c1" };

test("base: loja, XP, removedores, sequência, rodada e ordem dos aprimoramentos não refazem a análise base", () => {
  const key = baseInputs(options(), keys);
  assert.equal(
    baseInputs(
      options({
        shop: [null, null],
        xp: "9/20",
        removers: 2,
        streak: null,
        stage: { stage: 3, round: 6 },
        augments: ["a", "b"],
      }),
      keys,
    ),
    key,
  );
});

test("base: ouro, nível, banco, inventário, leitura do banco, plano mantido, hold e estágio refazem a base", () => {
  const key = baseInputs(options(), keys);
  for (const [name, extra] of Object.entries({
    gold: { gold: 31 },
    level: { level: 7 },
    bench: { bench: [{ championName: "A" }] },
    inventory: { inventory: ["DA_X"] },
    // Banco lido ou não muda o plano de itens (item-plan.mjs).
    bankRead: { bankRead: false },
    sticky: { stickyCompId: "c2", sticky: { units: ["u2"] } },
    hold: { holdPlan: true },
    stage: { stage: { stage: 4, round: 1 } },
    hidden: { hidden: { 2: 1.5 } },
  }))
    assert.notEqual(baseInputs(options(extra), keys), key, name);
  assert.notEqual(
    baseInputs(options(), { ...keys, source: "outra" }),
    key,
    "snapshot",
  );
  assert.notEqual(
    baseInputs(options(), { ...keys, comps: "c2" }),
    key,
    "cópia de meta",
  );
});

test("baseId: identificador curto e estável da análise base", () => {
  const key = baseInputs(options(), keys);
  assert.equal(baseId(key), baseId(key));
  assert.notEqual(baseId(key), baseId(baseInputs(options({ gold: 5 }), keys)));
  assert.equal(baseId(key).length, 12);
});
