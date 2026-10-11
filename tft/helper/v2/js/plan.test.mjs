// Rodar com: node --test tft/helper/v2/js/plan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { challengerNote, planView, sinceText, unitLine } from "./plan.js";

const progress = {
  plan: {
    id: "m1",
    title: "Comp A",
    since: { stage: "2-3", level: 4 },
    pinned: false,
  },
  challenger: {
    id: "m2",
    title: "Comp B",
    readings: 1,
    need: { facts: 2 },
    gain: 0.3,
    cost: 0.1,
    hysteresis: 0.1,
    expectedFrom: 4.2,
    expectedTo: 3.9,
    unit: "placement",
    pending: true,
  },
  summary: { done: 3, total: 8, pct: 38 },
  next: [{ kind: "unit", id: "Carry", text: "Carry: 1→3★ (2/9 cópias)" }],
  units: [
    {
      id: "Carry",
      name: "Carry",
      cost: 4,
      carry: true,
      stars: 1,
      targetStars: 3,
      copies: 2,
      need: 9,
      status: "partial",
      where: "campo",
      lost: false,
      boughtUpTo: null,
    },
    {
      id: "Tank",
      name: "Tank",
      cost: 3,
      carry: false,
      stars: 2,
      targetStars: 2,
      copies: 3,
      need: 3,
      status: "done",
      where: "campo",
      lost: false,
      boughtUpTo: null,
    },
    {
      id: "Sup",
      name: "Sup",
      cost: 2,
      carry: false,
      stars: 0,
      targetStars: 2,
      copies: 0,
      need: 3,
      status: "missing",
      where: null,
      lost: true,
      boughtUpTo: 2,
    },
  ],
  items: [
    {
      key: "Carry|A",
      unitId: "Carry",
      unit: "Carry",
      itemId: "A",
      name: "A",
      status: "partial",
      missing: ["Arco"],
      components: ["Arco", "Cinto"],
    },
  ],
  augments: [
    { round: "2-1", id: "x", name: "Primeiro", status: "done" },
    { round: "3-2", id: null, name: null, status: "now" },
    { round: "4-2", id: null, name: null, status: "later" },
  ],
  level: { now: 5, target: 8, status: "pending" },
  gold: { now: 33, interestAt: 40, floor: 10, status: "pending" },
  changes: [{ type: "unit", text: "Tank subiu para 2★", stage: "2-3" }],
};

test("planView: resumo, próximo passo, linhas na ordem do servidor e estados", () => {
  const v = planView(progress);
  assert.equal(v.title, "Comp A");
  assert.equal(v.since, "desde 2-3 · nível 4");
  assert.deepEqual([v.done, v.total, v.pct], [3, 8, 38]);
  assert.deepEqual(
    v.units.map((u) => u.id),
    ["Carry", "Tank", "Sup"],
  );
  assert.equal(v.units[0].line, "1→3★ · 2/9 cópias");
  assert.equal(v.units[0].fraction, 2 / 9);
  assert.equal(v.units[1].line, "2★ feito");
  assert.match(v.units[2].line, /comprada 2× \(pode estar na reserva\)/);
  assert.equal(v.units[2].lost, true);
  assert.deepEqual(v.items[0].missing, ["Arco"]);
  assert.deepEqual(
    v.augments.map((a) => a.text),
    ["Primeiro", "escolha agora", "a escolher"],
  );
  assert.equal(v.level.text, "nível 5 de 8");
  assert.equal(v.gold.text, "33g · próximo juros em 40g · piso 10g");
  assert.equal(v.changes[0].text, "Tank subiu para 2★");
});

test("planView: sem plano não há seção; ouro e nível não lidos viram texto honesto", () => {
  assert.equal(planView(null), null);
  const v = planView({
    ...progress,
    level: { now: null, target: 8, status: "pending" },
    gold: { now: null, status: "unknown" },
  });
  assert.equal(v.level.text, "nível não lido");
  assert.equal(v.gold.text, "ouro não lido");
});

test("desafiante: mostra a margem exigida e quanto falta de confirmação; comp fixada some o 'desde'", () => {
  const note = challengerNote(progress.challenger);
  assert.match(
    note,
    /^Mantido: Comp B espera 3,90º contra 4,20º do plano \(0,30 melhor\) · trocar custa 0,10 \+ margem 0,10 · troca no próximo fato novo/,
  );
  assert.equal(
    challengerNote({ ...progress.challenger, pending: false }),
    "Mantido: Comp B espera 3,90º contra 4,20º do plano (0,30 melhor) · trocar custa 0,10 + margem 0,10.",
  );
  assert.equal(challengerNote(null), null);
  assert.equal(
    planView({ ...progress, plan: { ...progress.plan, pinned: true } }).pinned,
    true,
  );
  assert.equal(sinceText({ stage: null, level: null }), "nesta partida");
  assert.equal(
    unitLine({ status: "missing", stars: 0, targetStars: 2, boughtUpTo: null }),
    "0→2★ · falta",
  );
});
