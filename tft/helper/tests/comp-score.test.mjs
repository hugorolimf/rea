// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// O score é a colocação esperada E numa régua (comp-score.mjs): monótono em E, e as partes são só informação.
import test from "node:test";
import assert from "node:assert/strict";
import { SCORE_SCALE, compScore, scoreFromExpected } from "../comp-score.mjs";

const base = {
  expected: 4.4,
  itemGain: 0,
  carryItems: 0,
  carryWanted: 3,
  reach: 0.5,
  held: 0.3,
  shopHits: 0,
  dispute: 0,
};

test("o score é monótono em E: colocação esperada melhor, score maior; régua de 0 a 100", () => {
  assert.equal(scoreFromExpected(SCORE_SCALE.best), 100);
  assert.equal(scoreFromExpected(SCORE_SCALE.worst), 0);
  assert.equal(scoreFromExpected(1), 100);
  assert.equal(scoreFromExpected(8), 0);
  assert.equal(scoreFromExpected(null), 0);
  let prev = Infinity;
  for (let e = 2; e <= 6; e += 0.05) {
    const s = scoreFromExpected(e);
    assert.ok(s <= prev, `E ${e}: ${s} > ${prev}`);
    prev = s;
  }
  assert.ok(scoreFromExpected(4.2) > scoreFromExpected(4.3));
});

test("as partes não mudam o score: itens, o que você tem, alcance, loja e disputa só informam", () => {
  const a = compScore(base),
    b = compScore({
      ...base,
      itemGain: 0.3,
      carryItems: 3,
      held: 0.9,
      reach: 0.95,
      chance: 0.4,
      shopHits: 2,
      dispute: 9,
    });
  assert.equal(a.score, b.score);
  assert.equal(a.score, scoreFromExpected(4.4));
  assert.ok(b.parts.items > a.parts.items);
  assert.equal(b.parts.reach, 0.95);
  assert.equal(b.chance, 0.4, "a chance de montar tudo é exibida à parte");
  assert.equal(a.chance, 0.5, "sem `chance`, exibe o próprio alcance");
  assert.equal(b.contest, 0.55);
  assert.equal(compScore({ ...base, dispute: 5 }).contest, 0.65);
});

test("E e top 4 saem junto do score; sem E o score é 0 e não quebra", () => {
  const s = compScore({ ...base, expected: 3.876, top4: 61.24 });
  assert.equal(s.expected, 3.88);
  assert.equal(s.top4, 61.2);
  const none = compScore({});
  assert.equal(none.score, 0);
  assert.equal(none.expected, null);
  assert.equal(none.top4, null);
});
