// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { WEIGHTS, compScore } from "../comp-score.mjs";

const base = {
  expected: 4.4,
  itemGain: 0,
  carryItems: 0,
  carryWanted: 3,
  chanceNow: 0.5,
  chancePlan: null,
  held: 0.3,
  shopHits: 0,
  dispute: 0,
};

test("pesos somam 1 e os itens são a maior parte", () => {
  assert.ok(
    Math.abs(Object.values(WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9,
  );
  assert.equal(Math.max(...Object.values(WEIGHTS)), WEIGHTS.items);
});

test("itens que você tem sobem o score; sem itens e sem nada, o score é baixo", () => {
  const none = compScore({ ...base, held: 0, chanceNow: 0, expected: 4.9 });
  assert.equal(none.score, 0);
  const without = compScore(base),
    withItems = compScore({ ...base, itemGain: 0.3, carryItems: 3 });
  assert.ok(
    withItems.score - without.score >= 25,
    `${withItems.score} vs ${without.score}`,
  );
});

test("chance de montar no seu nível pesa; o nível alvo só completa", () => {
  const low = compScore({ ...base, chanceNow: 0.02 }),
    high = compScore({ ...base, chanceNow: 0.9 });
  assert.ok(high.score > low.score + 10);
  assert.equal(high.chance, 0.9);
  const withPlan = compScore({ ...base, chanceNow: 0.1, chancePlan: 0.9 });
  assert.ok(withPlan.parts.chance > 0.1 && withPlan.parts.chance < 0.9);
  assert.equal(withPlan.chancePlan, 0.9);
});

test("o que você já tem (com chance de subir de estrela) e a loja de agora somam", () => {
  assert.ok(
    compScore({ ...base, held: 0.8 }).score >
      compScore({ ...base, held: 0.3 }).score,
  );
  assert.ok(compScore({ ...base, shopHits: 2 }).score > compScore(base).score);
});

test("disputa alta reduz o score em até 45%", () => {
  const free = compScore({
      ...base,
      itemGain: 0.3,
      carryItems: 3,
      held: 0.8,
      chanceNow: 0.9,
    }),
    alta = compScore({
      ...base,
      itemGain: 0.3,
      carryItems: 3,
      held: 0.8,
      chanceNow: 0.9,
      dispute: 5,
    }),
    maxima = compScore({
      ...base,
      itemGain: 0.3,
      carryItems: 3,
      held: 0.8,
      chanceNow: 0.9,
      dispute: 40,
    });
  assert.ok(alta.score < free.score * 0.7);
  assert.equal(alta.contest, 0.65);
  assert.equal(maxima.contest, 0.55);
});

test("sem colocação esperada nem ganho: não quebra e fica entre 0 e 100", () => {
  const s = compScore({});
  assert.ok(s.score >= 0 && s.score <= 100);
  assert.equal(
    compScore({
      expected: 1,
      itemGain: 9,
      carryItems: 9,
      carryWanted: 3,
      chanceNow: 2,
      held: 2,
      shopHits: 9,
    }).score,
    100,
  );
});
