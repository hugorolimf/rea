import { test } from "node:test";
import assert from "node:assert/strict";
import { BENCH_POLICY, hiddenHoldings } from "../pool-tracker.mjs";
import { isContested, likelyFree } from "../economy.mjs";

const t0 = Date.parse("2026-10-09T20:00:00Z");
const row = (id, ms, units, health = 50) => ({
  id,
  health,
  sourceAt: new Date(t0 + ms).toISOString(),
  units: units.map(([championName, starLevel = 1]) => ({
    championName,
    starLevel,
  })),
});

test("cópia que sai do tabuleiro conta como provavelmente no banco e decai com o tempo", () => {
  const rows = [row("r1", 0, [["A", 2], ["B"]]), row("r1", 1000, [["B"]])];
  const fresh = hiddenHoldings(rows, { now: t0 + 1000 }).get("A");
  assert.equal(fresh, 3 * BENCH_POLICY.keep);
  const later = hiddenHoldings(rows, {
    now: t0 + 1000 + BENCH_POLICY.halfLifeMs,
  }).get("A");
  assert.equal(later, fresh / 2);
});

test("peça que volta ao campo (ou sobe de estrela) deixa de contar como guardada", () => {
  const rows = [
    row("r1", 0, [["A"]]),
    row("r1", 1000, []),
    row("r1", 2000, [["A", 2]]),
  ];
  assert.equal(hiddenHoldings(rows, { now: t0 + 2000 }).has("A"), false);
});

test("rival eliminado devolve tudo e o próprio jogador é ignorado", () => {
  const rows = [
    row("dead", 0, [["A", 2]]),
    row("dead", 1000, [], 0),
    row("me", 0, [["B", 2]]),
    row("me", 1000, []),
  ];
  assert.equal(
    hiddenHoldings(rows, { now: t0 + 1000, skip: new Set(["me"]) }).size,
    0,
  );
});

test("estimativa por rival respeita o teto do banco", () => {
  const units = "ABCDEFGHIJKL".split("").map((c) => [c, 2]);
  const rows = [row("r1", 0, units), row("r1", 1000, [])];
  const total = [...hiddenHoldings(rows, { now: t0 + 1000 }).values()].reduce(
    (a, b) => a + b,
    0,
  );
  assert.ok(Math.abs(total - BENCH_POLICY.maxCopies) < 1e-9);
});

test("banco estimado entra na disputa e sai da pool provável, mas não do teto", () => {
  const p = {
    cost: 4,
    total: 10,
    enemy: 2,
    hidden: 2,
    remainingUpper: 8,
    remainingLikely: 6,
  };
  assert.equal(isContested(p), true);
  assert.equal(isContested({ ...p, hidden: 0 }), false);
  assert.equal(likelyFree(p), 6);
  assert.equal(likelyFree({ remainingUpper: 5 }), 5);
});
