// Rodar com: node --test "tft/helper/tests/snapshot-identity.test.mjs"
// O que invalida a análise (M8b: era tests/analysis-keys.test.mjs): regravar o arquivo ou reorganizar as peças não refaz a
// base; o que muda o jogo, sim. A identidade do snapshot (core/state/snapshot-identity.mjs) é a chave da entrada `snapshot`
// do grafo de fatos; a assinatura é o resumo estável dela.
import test from "node:test";
import assert from "node:assert/strict";
import {
  snapshotIdentity,
  snapshotSignature,
} from "../core/state/snapshot-identity.mjs";
import { createGraph, defineFact } from "../core/graph/index.mjs";

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

test("identidade: jogo, set e jogadores ordenados pelo id; snapshot ausente não quebra", () => {
  const identity = snapshotIdentity(
    snap([piece("A"), piece("B", 2, ["I2", "I1"])]),
  );
  assert.equal(identity[0], 7);
  assert.equal(identity[1], "TFTSet18");
  assert.deepEqual(
    identity[2].map((p) => p[0]),
    ["1", "2"],
  );
  // Itens e peças ordenados como texto; preço entra.
  assert.deepEqual(identity[2][0][4], ["A:1::3", "B:2:I1+I2:3"]);
  assert.deepEqual(snapshotIdentity(null), [null, null, []]);
  assert.equal(typeof snapshotSignature(undefined), "string");
});

test("como entrada do grafo: o fato recebe o snapshot inteiro, mas só a identidade o invalida", () => {
  let computes = 0;
  const players = defineFact({
    id: "players",
    inputs: ["snapshot"],
    compute: ({ snapshot }) => {
      computes++;
      return snapshot.statsBlock.players.length;
    },
  });
  const graph = createGraph({
    facts: [players],
    inputs: { snapshot: { identity: snapshotIdentity } },
  });
  const hero = [piece("A", 1, ["I1", "I2"]), piece("B", 2)];
  graph.set({ snapshot: snap(hero) });
  assert.equal(graph.get("players"), 2);
  // O arquivo foi regravado (tempo de partida, peças em outra ordem): nada recalcula.
  assert.deepEqual(
    graph.set({
      snapshot: snap([piece("B", 2), piece("A", 1, ["I2", "I1"])], undefined, {
        gameLengthSeconds: 5000,
      }),
    }),
    [],
  );
  graph.get("players");
  assert.equal(computes, 1);
  // Uma peça nova no tabuleiro: a identidade muda e o fato recalcula.
  assert.deepEqual(graph.set({ snapshot: snap([...hero, piece("C")]) }), [
    "snapshot",
  ]);
  graph.get("players");
  assert.equal(computes, 2);
});
