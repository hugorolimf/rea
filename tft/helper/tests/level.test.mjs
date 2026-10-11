// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// Nível do jogador: totais de XP, piso derivado do XP passivo e rastreador por partida (nível observado pelo GEP ou piso).
import test from "node:test";
import assert from "node:assert/strict";
import {
  levelFloor,
  levelsForXp,
  passiveXpBetween,
  roundNumber,
} from "../rules.mjs";
import { levelTracker } from "../level.mjs";

test("totais de XP repetidos devolvem os dois níveis possíveis", () => {
  assert.deepEqual(levelsForXp("0/2"), [1, 2]);
  assert.deepEqual(levelsForXp("60/68"), [8, 9]);
  assert.deepEqual(levelsForXp("24/36"), [6]);
  assert.deepEqual(levelsForXp("5/7"), [], "total que não existe no jogo");
  assert.deepEqual(levelsForXp(null), []);
});

test("rodadas e XP passivo mínimo: estágio 1 e carrossel não contam", () => {
  assert.equal(roundNumber("1-1"), 1);
  assert.equal(roundNumber("2-1"), 5);
  assert.equal(roundNumber("3-1"), 12);
  assert.equal(roundNumber("x"), null);
  // 2-1..2-3 e 2-5..2-7 (a 2-4 é carrossel) = 6 rodadas.
  assert.equal(passiveXpBetween("1-1", "2-7"), 12);
  assert.equal(passiveXpBetween("2-3", "2-4"), 0, "só o carrossel");
  assert.equal(passiveXpBetween("2-3", "2-3"), 0);
  assert.equal(passiveXpBetween("4-3", "4-1"), 0);
});

test("piso de nível: só XP passivo, parte do 1 e aceita âncora", () => {
  assert.equal(levelFloor("1-3"), 1);
  assert.equal(levelFloor("2-7"), 4, "12 XP: 2 + 2 + 6 = 10 chega ao nível 4");
  assert.equal(levelFloor("4-5"), 5, "32 XP passivos desde o 2-1 chegam ao 5");
  const from = { level: 6, xp: "30/36", stage: "4-1" };
  assert.equal(levelFloor("4-3", from), 6, "4 XP passivos: 34/36");
  assert.equal(levelFloor("4-5", from), 7, "6 XP passivos completam o 6");
});

const seen = (over = {}) => ({
  level: null,
  xp: null,
  stage: "4-5",
  sources: { level: null, xp: null },
  ...over,
});
const observed = (level, xp, stage) =>
  seen({ level, xp, stage, sources: { level: "gep", xp: xp ? "gep" : null } });

test("nível observado (GEP, já validado na precedência) vale como veio e vira a âncora da partida", () => {
  const t = levelTracker();
  const out = t.apply(observed(6, "30/36", "4-1"), "g1");
  assert.equal(out.level, 6);
  assert.equal(out.sources.level, "gep");
  assert.equal(out.xp, "30/36");
  assert.deepEqual(out.levelInfo, { source: "gep", minimum: false, read: 6 });
});

test("sem observação: piso a partir do último observado, subindo só com XP passivo; partida nova zera", () => {
  const t = levelTracker();
  t.apply(observed(6, "30/36", "4-1"), "g1");
  const out = t.apply(seen({ stage: "5-1" }), "g1");
  assert.equal(out.level, 7);
  assert.equal(out.sources.level, "derived");
  assert.equal(out.levelInfo.source, "derived");
  assert.equal(out.levelInfo.minimum, true);
  assert.equal(out.levelInfo.read, null);
  const other = t.apply(seen({ stage: "1-2" }), "g2");
  assert.equal(other.level, null, "nada derivado na partida nova em 1-2");
  assert.equal(other.sources.level, null);
  // Sem nenhum observado na partida, o piso global do estágio (XP passivo desde 1-1).
  assert.equal(levelTracker().apply(seen({ stage: "4-5" }), "g3").level, 5);
});

test("XP de outro nível não acompanha um nível derivado", () => {
  const out = levelTracker().apply(
    seen({ xp: "1/2", sources: { level: null, xp: "gep" } }),
    "g1",
  );
  // Sem nível observado: piso 5 no 4-5, e o XP do nível 1/2 sai.
  assert.equal(out.level, 5);
  assert.equal(out.xp, null);
  assert.equal(out.sources.xp, null);
});

test("sem estágio nem observação: nenhum nível inventado", () => {
  const out = levelTracker().apply(seen({ stage: null }), "g1");
  assert.equal(out.level, null);
  assert.equal(out.levelInfo.source, null);
});
