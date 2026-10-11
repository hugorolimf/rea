// Rodar com: node --test tests/target-level-steady.test.mjs
// O nível-alvo não alterna dentro da rodada: o ouro passando de 49 para 50 e voltando durante a loja (ou a rolagem
// derrubando o ouro) não muda o alvo nem, com ele, o tamanho do tabuleiro planejado. O alvo lê o ouro e a vida DA RODADA
// (target-level.mjs, steadyTargetInputs); sem estágio lido vale a histerese de POLICY.targetLevel.goldBand.
import test from "node:test";
import assert from "node:assert/strict";
import { POLICY } from "../core/economy/policy.mjs";
import { maxInterestGold } from "../core/economy/gold.mjs";
import {
  steadyTargetInputs,
  suggestTargetLevel,
  targetLevelTracker,
} from "../target-level.mjs";
import {
  bindRun,
  createRecommendGraph,
  recommendValues,
} from "../app/recommend-facts.mjs";

const LEVEL = 7;
/** Hero com `hp` e sete rivais vivos de tabuleiro vazio (sem "fim de jogo", sem tabuleiro acima/abaixo do lobby). */
const snap = (hp) => ({
  statsBlock: {
    players: [
      { playerId: "1", health: hp, boardPieces: [] },
      ...[2, 3, 4, 5, 6, 7, 8].map((i) => ({
        playerId: String(i),
        health: 80,
        boardPieces: [],
      })),
    ],
  },
});
const R = (stage, round) => ({ stage, round });

/** Nível-alvo de cada leitura, passando pela memória da rodada como o pipeline faz. */
function targets(readings, tracker = targetLevelTracker()) {
  return readings.map(({ gameId = "g1", stage, gold, hp = 80 }) => {
    const steady = tracker.observe({ gameId, stage, gold, hp });
    return suggestTargetLevel(snap(hp), "1", LEVEL, steady.gold, {
      hp: steady.hp,
    }).level;
  });
}

test("ouro instantâneo cruzando o teto de juros alternava o alvo (o defeito)", () => {
  const cap = maxInterestGold();
  const raw = [cap - 1, cap, cap - 1, cap].map(
    (gold) => suggestTargetLevel(snap(80), "1", LEVEL, gold).level,
  );
  assert.deepEqual(raw, [LEVEL + 1, LEVEL + 2, LEVEL + 1, LEVEL + 2]);
});

test("ouro 49/50/49/50 na mesma rodada: o alvo sobe uma vez e não volta", () => {
  const cap = maxInterestGold();
  const seq = targets(
    [cap - 1, cap, cap - 1, cap].map((gold) => ({ stage: R(3, 2), gold })),
  );
  assert.deepEqual(seq, [LEVEL + 1, LEVEL + 2, LEVEL + 2, LEVEL + 2]);
  // Começando no teto: estável do início ao fim.
  const fromCap = targets(
    [cap, cap - 1, cap, cap - 1].map((gold) => ({ stage: R(3, 2), gold })),
  );
  assert.deepEqual(fromCap, Array(4).fill(LEVEL + 2));
});

test("a rolagem que derruba o ouro na rodada não muda o alvo; a rodada seguinte, sim", () => {
  const seq = targets([
    { stage: R(4, 1), gold: 62 },
    { stage: R(4, 1), gold: 30 },
    { stage: R(4, 1), gold: 8 },
    // Rodada nova com pouco ouro: mudança real, o alvo acompanha.
    { stage: R(4, 2), gold: 14 },
    { stage: R(4, 2), gold: 9 },
    // Outra rodada, ouro de volta ao teto: o alvo sobe de novo.
    { stage: R(4, 3), gold: 51 },
  ]);
  assert.deepEqual(seq, [9, 9, 9, 8, 8, 9]);
});

test("leitura de ouro ausente no meio da rodada não apaga o ouro da rodada", () => {
  const seq = targets([
    { stage: R(3, 5), gold: 55 },
    { stage: R(3, 5), gold: null },
    { stage: R(3, 5), gold: 44 },
  ]);
  assert.deepEqual(seq, [9, 9, 9]);
});

test("sem estágio lido: histerese de POLICY.targetLevel.goldBand abaixo do teto", () => {
  const cap = maxInterestGold(),
    band = POLICY.targetLevel.goldBand;
  const seq = targets(
    [cap - 1, cap, cap - 1, cap, cap - band, cap - band - 1, cap - 1, cap].map(
      (gold) => ({ stage: null, gold }),
    ),
  );
  assert.deepEqual(seq, [8, 9, 9, 9, 9, 8, 8, 9]);
  // A banda é política: perturbá-la muda onde o alvo desce.
  const was = POLICY.targetLevel.goldBand;
  POLICY.targetLevel.goldBand = 2;
  try {
    assert.deepEqual(
      targets([cap, cap - 2, cap - 3].map((gold) => ({ stage: null, gold }))),
      [9, 9, 8],
    );
  } finally {
    POLICY.targetLevel.goldBand = was;
  }
});

test("vida da rodada: uma leitura velha acima do limiar não alterna o alvo; a queda entre rodadas conta", () => {
  const hurt = POLICY.hp.hurt;
  const seq = targets([
    { stage: R(3, 3), gold: 55, hp: hurt },
    { stage: R(3, 3), gold: 55, hp: hurt - 1 },
    // Snapshot atrasado com a vida de antes: a rodada guarda a menor vida lida.
    { stage: R(3, 3), gold: 55, hp: hurt },
    { stage: R(3, 4), gold: 55, hp: hurt - 1 },
  ]);
  assert.deepEqual(seq, [9, 8, 8, 8]);
  // A vida baixa não tira o próximo nível (regra do tft-pressao-vida): só decide o "+2".
  assert.equal(
    suggestTargetLevel(snap(80), "1", LEVEL, 60, { hp: POLICY.hp.low }).level,
    LEVEL + 1,
  );
});

test("partida nova recomeça a memória da rodada", () => {
  const tracker = targetLevelTracker();
  targets([{ gameId: "a", stage: R(3, 2), gold: 60 }], tracker);
  assert.deepEqual(
    targets([{ gameId: "b", stage: R(3, 2), gold: 20 }], tracker),
    [8],
  );
});

test("steadyTargetInputs é puro: devolve a memória para a próxima leitura", () => {
  const a = steadyTargetInputs(null, {
    gameId: "g",
    stage: R(2, 1),
    gold: 10,
    hp: 90,
  });
  assert.deepEqual(a, {
    gold: 10,
    hp: 90,
    memo: { gameId: "g", round: "2-1", gold: 10, hp: 90 },
  });
  const b = steadyTargetInputs(a.memo, {
    gameId: "g",
    stage: R(2, 1),
    gold: 4,
    hp: 88,
  });
  assert.deepEqual([b.gold, b.hp], [10, 88]);
  assert.deepEqual(a.memo, { gameId: "g", round: "2-1", gold: 10, hp: 90 });
});

test("o fato level.target lê o ouro da rodada (targetGold), não o ouro de agora", () => {
  const values = recommendValues({
    snapshot: snap(80),
    catalog: { champions: [], items: [], traits: [] },
    options: {
      playerId: "1",
      level: LEVEL,
      gold: 49,
      targetGold: 50,
      targetHp: 80,
      stage: R(3, 2),
      augments: [],
    },
    meta: { builds: {}, roles: {}, label: "", fetchedAt: null },
    metaComps: { comps: [], fetchedAt: null },
    boardStats: null,
    augmentStats: null,
    chosen: [],
    goal: null,
    targetLevel: "auto",
  });
  assert.equal(values.targetGold, 50);
  const view = bindRun(createRecommendGraph(), values, () => ({
    evidence: {},
    conditional: {},
  }));
  assert.equal(view.target().level, LEVEL + 2);
  // Sem ouro da rodada (partida revista, harness do golden): o ouro lido.
  const plain = recommendValues({
    snapshot: snap(80),
    catalog: { champions: [], items: [], traits: [] },
    options: { playerId: "1", level: LEVEL, gold: 49, augments: [] },
    meta: { builds: {}, roles: {}, label: "", fetchedAt: null },
    metaComps: { comps: [], fetchedAt: null },
    boardStats: null,
    augmentStats: null,
    chosen: [],
    goal: null,
    targetLevel: "auto",
  });
  assert.equal(plain.targetGold, 49);
});
