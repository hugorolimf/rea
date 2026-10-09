// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { streakTracker } from "../streak.mjs";

const feed = (t, game, rows) => {
  for (const [stage, hp] of rows) t.observe({ gameId: game, stage, hp });
};

test("derrotas seguidas: o HP cai entre rodadas contra jogador", () => {
  const t = streakTracker();
  feed(t, 1, [
    ["3-1", 70],
    ["3-2", 64],
    ["3-3", 57],
    ["3-4", 50], // carrossel
    ["3-5", 50],
  ]);
  // 3-1, 3-2 e 3-3 perderam; o carrossel 3-4 não conta nem quebra a sequência.
  assert.deepEqual(t.current(), { kind: "loss", length: 3, inferred: true });
});

test("vitórias: HP estável; a sequência para na troca de resultado", () => {
  const t = streakTracker();
  feed(t, 1, [
    ["2-5", 90],
    ["2-6", 84], // 2-5 perdeu
    ["2-7", 84], // 2-6 venceu; 2-7 é monstro
    ["3-1", 84],
    ["3-2", 84], // 3-1 venceu
    ["3-3", 84], // 3-2 venceu
  ]);
  assert.deepEqual(t.current(), { kind: "win", length: 3, inferred: true });
});

test("dano que chega atrasado no arquivo ainda conta para a rodada anterior", () => {
  const t = streakTracker();
  feed(t, 1, [
    ["4-1", 60],
    ["4-2", 60], // arquivo ainda sem o dano de 4-1
    ["4-2", 52], // dano de 4-1 chegou: 4-1 foi derrota
    ["4-3", 52], // 4-2 venceu
  ]);
  assert.deepEqual(t.current(), { kind: "win", length: 1, inferred: true });
  t.observe({ gameId: 1, stage: "4-3", hp: 45 }); // 4-2 na verdade perdeu (dano atrasado)
  assert.deepEqual(t.current(), { kind: "loss", length: 2, inferred: true });
});

test("rodada sem leitura interrompe; partida nova zera", () => {
  const t = streakTracker();
  feed(t, 1, [
    ["3-1", 70],
    ["3-2", 60],
    ["3-5", 50],
    ["3-6", 40],
  ]);
  assert.deepEqual(t.current(), { kind: "loss", length: 1, inferred: true });
  feed(t, 2, [["2-1", 100]]);
  assert.equal(t.current(), null);
});
