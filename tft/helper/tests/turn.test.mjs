// Decisão da rodada (core/turn/turn.mjs): uma conta de ouro só, em ordem, e o próximo nível pela mesma decisão.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurn, headlineOf, nextCurveStage } from "../core/turn/turn.mjs";

const kinds = (t) => t.steps.map((s) => s.kind);

test("compra, rolagem e piso numa conta só: nunca gasta o que um passo anterior já usou", () => {
  const t = buildTurn({
    gold: 60,
    level: 8,
    d: { action: "ROLAR", spend: 26, keep: 30, levelCost: 36 },
    buys: [
      {
        id: "A",
        name: "Aphelios",
        cost: 4,
        reason: "peça da comp",
        slots: [2],
      },
    ],
    rollFor: {
      text: "Role 26g",
      targets: [
        { id: "K", name: "Kayle", goal: "3★", have: "5/9", chance: 0.4 },
      ],
    },
  });
  assert.deepEqual(kinds(t), ["buy", "roll", "keep"]);
  assert.equal(t.steps[0].slot, 2);
  assert.equal(t.steps[1].times, 13);
  assert.equal(t.steps[1].targets[0].name, "Kayle");
  assert.equal(t.gold.spent, 30);
  assert.equal(t.gold.after, 30);
  assert.equal(t.ok, true);
  assert.equal(
    t.headline,
    "Compre Aphelios → role 13 vezes por Kayle 3★ → guarde 30g",
  );
});

test("subir de nível: o XP é um passo com custo e o selo não precisa da curva", () => {
  const t = buildTurn({
    gold: 40,
    level: 7,
    d: {
      action: "SUBIR NÍVEL",
      spend: 36,
      keep: 4,
      levelCost: 36,
      headline: "Suba para o nível 8",
    },
  });
  assert.deepEqual(kinds(t), ["level", "keep"]);
  assert.deepEqual(
    [t.steps[0].from, t.steps[0].to, t.steps[0].cost],
    [7, 8, 36],
  );
  assert.equal(t.level.up, true);
  assert.equal(t.level.next, null);
});

test("perigo: XP junto da rolagem e venda do banco entram na mesma conta", () => {
  const t = buildTurn({
    gold: 20,
    level: 6,
    d: {
      action: "ROLAR",
      spend: 18,
      keep: 0,
      levelUp: 8,
      levelCost: 8,
      sold: 6,
      pressure: "critical",
    },
  });
  assert.deepEqual(kinds(t), ["sell", "level", "roll", "keep"]);
  assert.equal(t.steps[2].times, 9);
  assert.equal(t.gold.spent, 26);
  assert.equal(t.gold.after, 0);
  assert.equal(t.ok, true);
});

test("sem subir agora: o próximo nível vem da curva depois do estágio lido, ou do XP passivo", () => {
  const wait = buildTurn({
    gold: 50,
    level: 6,
    stage: { stage: 3, round: 2 },
    d: { action: "ECONOMIZAR", keep: 50 },
  });
  assert.deepEqual(kinds(wait), ["keep"]);
  assert.ok(wait.level.next, "tem próximo nível");
  assert.ok(
    wait.level.next.stage > 3 ||
      (wait.level.next.stage === 3 && wait.level.next.round > 2),
    "o próximo nível nunca é numa rodada que já passou",
  );
  const passive = buildTurn({
    gold: 30,
    level: 5,
    d: { action: "ECONOMIZAR", keep: 30, passiveLevel: true },
  });
  assert.equal(passive.level.next.when, "próxima rodada");
});

test("nível-alvo do motor: no alvo não há próximo nível nem pedido de subir", () => {
  const t = buildTurn({
    gold: 30,
    level: 9,
    target: 9,
    d: { action: "ECONOMIZAR", keep: 30, finalLevel: 8 },
  });
  assert.equal(t.level.target, 9, "o alvo é o do motor");
  assert.equal(
    t.level.final,
    9,
    "pronto de nível no maior entre o alvo do motor e o do estilo",
  );
  assert.equal(t.level.done, true);
  assert.equal(t.level.next, null);
  const early = buildTurn({
    gold: 30,
    level: 7,
    target: 7,
    stage: { stage: 4, round: 1 },
    d: { action: "ECONOMIZAR", keep: 30, finalLevel: 8 },
  });
  assert.equal(
    early.level.done,
    false,
    "ainda falta chegar ao nível em que a comp é jogada",
  );
});

test("sem ouro lido: só as compras, sem conta", () => {
  const t = buildTurn({
    gold: null,
    level: 5,
    d: { action: "COMPRAR" },
    buys: [{ id: "X", name: "X", cost: 1 }],
  });
  assert.deepEqual(kinds(t), ["buy"]);
  assert.equal(t.gold.now, null);
  assert.equal(t.ok, true);
});

test("rolagem menor que uma loja não vira passo; textos", () => {
  const t = buildTurn({
    gold: 11,
    level: 7,
    d: { action: "ROLAR", spend: 1, keep: 10 },
  });
  assert.deepEqual(kinds(t), ["keep"]);
  assert.equal(
    headlineOf([{ kind: "roll", times: 1, targets: [] }]),
    "Role 1 vez",
  );
  assert.equal(nextCurveStage(null), null);
});

test("partida encerrada e ouro sem fonte: a frase é a da decisão, sem passo de guardar", () => {
  const end = buildTurn({
    gold: 0,
    level: 8,
    d: { action: "ENCERRADA", headline: "Partida encerrada para o Hero" },
  });
  assert.deepEqual(end.steps, []);
  assert.equal(end.headline, "Partida encerrada para o Hero");
  const unk = buildTurn({
    gold: null,
    level: 7,
    d: { action: "AGUARDAR", headline: "Ouro ainda não lido" },
  });
  assert.equal(unk.headline, "Ouro ainda não lido");
});

test("próximo nível: limitado pelo ouro diz quanto falta; a peça nova aparece como nova", () => {
  const t = buildTurn({
    gold: 54,
    level: 8,
    d: { action: "ECONOMIZAR", keep: 47, levelCost: 48 },
    buys: [{ id: "C", name: "C", cost: 7 }],
  });
  assert.equal(t.level.next.when, "com 48g");
  assert.equal(
    headlineOf([
      {
        kind: "roll",
        times: 3,
        targets: [{ name: "Elder Dragon", goal: "falta" }],
      },
    ]),
    "Role 3 vezes por Elder Dragon (nova)",
  );
});
