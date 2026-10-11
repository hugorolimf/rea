// Rodar com: node --test tft/helper/v2/js/focus.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { focusView } from "./focus.js";

const steps = (o = {}) =>
  Object.entries(o).map(([id, rows]) => ({ id, group: "now", rows }));
const model = ({ live = true, level, roll, ...stepRows } = {}) => ({
  status: { live },
  plan: { steps: steps(stepRows), panel: { level, roll } },
});
const ids = (v) => v.items.map((i) => i.id);

test("fora de partida ao vivo ou sem plano: sem faixa", () => {
  assert.equal(focusView(null), null);
  assert.equal(focusView({ status: { live: true }, plan: null }), null);
  assert.equal(focusView(model({ live: false })), null);
});

test("sem nada a decidir: faixa vazia marcada como ociosa", () => {
  const v = focusView(model());
  assert.deepEqual(v, { items: [], idle: true });
});

test("peça do plano na loja vem primeiro e é a ação verde", () => {
  const v = focusView(
    model({
      buy: [{ shop: { badge: "NA LOJA" } }, { shop: { badge: "NA LOJA" } }, {}],
      level: { go: true, level: 7, cost: 12 },
      roll: { call: { kind: "go" }, spend: 24, shops: 4 },
    }),
  );
  assert.deepEqual(ids(v), ["shop", "level", "roll"]);
  assert.equal(v.items[0].tone, "go");
  assert.equal(v.items[0].detail, "2 peças do plano");
  assert.equal(v.items[1].detail, "para 8 · 12g");
  assert.equal(v.items[2].detail, "24g · até 4 lojas");
  assert.equal(v.idle, false);
});

test("na loja mas sem ouro é perigo, não compra", () => {
  const v = focusView(model({ buy: [{ shop: {}, broke: true }] }));
  assert.equal(v.items[0].tone, "danger");
  assert.equal(v.items[0].label, "Na loja, sem ouro");
});

test("peças a buscar (nenhuma na loja) vêm depois da decisão de rolar", () => {
  const v = focusView(
    model({ buy: [{}, {}, {}], roll: { call: { kind: "hold" } } }),
  );
  assert.deepEqual(ids(v), ["roll", "buy"]);
  assert.equal(v.items[0].label, "Não role");
  assert.equal(v.items[1].detail, "3 peças");
});

test("XP passivo, estabilizar e rolar depois", () => {
  assert.equal(
    focusView(model({ level: { passive: true, level: 6 } })).items[0].label,
    "Não compre XP",
  );
  const danger = focusView(model({ roll: { call: { kind: "danger" } } }))
    .items[0];
  assert.equal(danger.tone, "danger");
  const wait = focusView(
    model({ roll: { call: { kind: "wait", at: { level: 8 } }, at: 8 } }),
  ).items[0];
  assert.equal(wait.detail, "no nível 8");
});

test("rolar sem número de lojas não imprime 'undefined'", () => {
  const v = focusView(model({ roll: { call: { kind: "go" }, spend: 30 } }));
  assert.equal(v.items[0].detail, "30g");
});

test("trocas e equipar entram no fim, com contagem no singular e no plural", () => {
  const v = focusView(model({ swap: [{}], equip: [{}, {}] }));
  assert.deepEqual(ids(v), ["swap", "equip"]);
  assert.equal(v.items[0].detail, "1 peça");
  assert.equal(v.items[1].detail, "2 itens");
});

test("carrossel aberto vem primeiro: peças lidas ou, sem leitura, a lista de prioridade", () => {
  const withNote = (state, rows) => ({
    status: { live: true },
    plan: {
      steps: [{ id: "carousel", group: "items", rows, note: { state } }],
      panel: {},
    },
  });
  const a = focusView(withNote("now", [{}, {}, {}]));
  assert.deepEqual(ids(a), ["carousel"]);
  assert.equal(a.items[0].detail, "3 peças lidas");
  assert.equal(a.items[0].tone, "go");
  const b = focusView(withNote("priority", [{}]));
  assert.equal(b.items[0].detail, "prioridade · 1 componente");
  // A sugestão do plano fora do carrossel (sem selo) não entra na faixa.
  const c = focusView({
    status: { live: true },
    plan: { steps: [{ id: "carousel", rows: [{}] }], panel: {} },
  });
  assert.deepEqual(ids(c), []);
});
