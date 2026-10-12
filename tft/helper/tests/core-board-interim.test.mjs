// Rodar com: node --test tft/helper/tests/core-board-interim.test.mjs
// Substituto temporário (core/board/interim.mjs): quem joga AGORA em cada vaga da comp. S só joga no lugar do titular T
// quando força(S) − força(T) > margem; empate fica com o titular; a volta é prevista; a loja entra como possibilidade de
// compra; os dois são comprados; a reserva cheia vende o substituto mais fraco. Planos/em-andamento/substitutos-temporarios.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { POLICY } from "../core/economy/policy.mjs";
import { traitBook } from "../core/catalog/traits.mjs";
import {
  interimBuyWorth,
  interimContext,
  interimSlots,
  slotStrength,
  slotTransitions,
} from "../core/board/interim.mjs";
import { stagePlan } from "../stage.mjs";
import { makeState } from "./fixtures.mjs";

// Catálogo sintético sem sinergias (a força é só corpo + itens + papel): as contas do teste ficam à vista.
const champ = (apiName, cost, range = 1) => ({
  apiName,
  name: apiName,
  cost,
  traits: [],
  stats: { range },
});
const catalog = {
  champions: [
    champ("Tee", 2),
    champ("Ti", 1),
    champ("Ca", 1, 4),
    champ("Sa", 3),
    champ("Sb", 2),
    champ("Sc", 4),
    champ("Sd", 1),
  ],
  traits: [],
  items: [],
};
const ctx = interimContext(catalog, traitBook(catalog));
const u = (id, stars = 1, items = []) => ({ id, name: id, stars, items });
const run = (input) =>
  interimSlots({ level: 1, gold: null, band: null, shop: null, ...input }, ctx);
const slotOf = (res, id) => res.slots.find((s) => s.unit?.id === id);

test("POLICY.interim existe e POLICY.star (régua do lobby) continua igual", () => {
  assert.deepEqual(POLICY.interim.star, [0, 1, 2, 5]);
  assert.equal(POLICY.interim.margin, 1);
  assert.deepEqual(POLICY.star, [0, 1, 1.8, 3.2]);
});

test("força na vaga: corpo × estrela + itens completos; peça de frente numa vaga de trás perde o papel", () => {
  const s = slotStrength(u("Sa", 2, ["X", "DA_Component_BFSword"]), [], {
    ...ctx,
    level: 1,
  });
  // 3 × 2 + 1 item completo × 2 (o componente não conta).
  assert.equal(s.value, 8);
  assert.equal(s.ruler, "medido");
  assert.equal(slotStrength(u("Sa"), [], { ...ctx, level: 1 }, false).role, -1);
});

test("S 2★ vence T 1★ pela margem: S fica (temporário), T guardado na reserva, volta prevista em 2★", () => {
  const res = run({
    goal: [{ id: "Tee", name: "Tee", cost: 2 }],
    field: [u("Sb", 2)],
    reserve: [u("Tee", 1)],
    pool: new Map([["Tee", { chancePerSlot: 0.3, own: 1 }]]),
  });
  const s = slotOf(res, "Tee");
  assert.equal(s.kind, "temporario");
  assert.equal(s.playing.id, "Sb");
  assert.equal(s.original.have, "reserva");
  // Sb 2★ = 2 × 2 = 4 contra Tee 1★ = 2: −2, além da margem.
  assert.equal(s.delta, -2);
  assert.equal(s.until.kind, "estrela");
  assert.equal(s.until.stars, 2);
  assert.equal(s.until.need, 2);
  assert.match(
    s.until.text,
    /volta quando Tee chegar a 2★ \(faltam 2 cópias, ~\d+% nas próximas 3 lojas\)/,
  );
  // A troca (tactics/plan.transitions) lê a mesma vaga: segure Sb até Tee 2★.
  const [t] = slotTransitions(res.slots);
  assert.equal(t.exit.id, "Sb");
  assert.equal(t.ready, false);
  assert.equal(t.requiredStars, 2);
});

test("empate (ou diferença dentro da margem) fica com o titular; com a vida em perigo a margem é 0", () => {
  const tie = run({
    goal: [{ id: "Tee", name: "Tee", cost: 2 }],
    field: [u("Sb", 1)],
    reserve: [u("Tee", 1)],
  });
  assert.equal(slotOf(tie, "Tee").playing.id, "Tee");
  assert.equal(slotOf(tie, "Tee").playing.source, "reserva");
  assert.equal(slotOf(tie, "Tee").replaces.id, "Sb");
  // Sa 1★ (3) contra Tee 1★ (2): −1, dentro da margem de 1 → o titular entra.
  const inside = run({
    goal: [{ id: "Tee", name: "Tee", cost: 2 }],
    field: [u("Sa", 1)],
    reserve: [u("Tee", 1)],
  });
  assert.equal(slotOf(inside, "Tee").playing.id, "Tee");
  // Vida em perigo: margem 0, joga o mais forte agora.
  const danger = run({
    goal: [{ id: "Tee", name: "Tee", cost: 2 }],
    field: [u("Sa", 1)],
    reserve: [u("Tee", 1)],
    band: "danger",
  });
  assert.equal(danger.margin, 0);
  assert.equal(slotOf(danger, "Tee").playing.id, "Sa");
  assert.equal(slotOf(danger, "Tee").kind, "temporario");
});

test("carry entra em 1★ quando o substituto já segura os itens completos dele", () => {
  const res = run({
    goal: [{ id: "Ca", name: "Ca", cost: 1 }],
    carry: "Ca",
    field: [u("Sc", 2, ["IE", "GS"])],
    reserve: [u("Ca", 1)],
  });
  const s = slotOf(res, "Ca");
  assert.equal(s.playing.id, "Ca");
  assert.match(s.why, /Carry/);
  assert.equal(s.replaces.id, "Sc");
  assert.deepEqual(s.replaces.items, ["IE", "GS"]);
});

test("loja: peça da comp na loja preenche a vaga do original (titular a comprar); sem ouro, não entra; loja não lida, nada inventado", () => {
  const goal = [{ id: "Tee", name: "Tee", cost: 2 }];
  const buy = run({
    goal,
    field: [],
    reserve: [],
    shop: [{ slot: 3, id: "Tee", name: "Tee", cost: 2, buy: true }],
  });
  const s = slotOf(buy, "Tee");
  assert.equal(s.kind, "titular");
  assert.equal(s.playing.source, "loja");
  assert.deepEqual(s.playing.buy, { cost: 2, slot: 3 });
  assert.deepEqual(
    buy.buys.map((b) => [b.slot, b.purpose]),
    [[3, "vaga"]],
  );
  const broke = run({
    goal,
    field: [],
    reserve: [],
    shop: [{ slot: 3, id: "Tee", name: "Tee", cost: 2, buy: false }],
  });
  assert.equal(slotOf(broke, "Tee").playing, null);
  assert.deepEqual(slotOf(broke, "Tee").original.shop, {
    slot: 3,
    cost: 2,
    buy: false,
  });
  assert.equal(broke.buys.length, 0);
  const unknown = run({ goal, field: [], reserve: [], shop: null });
  assert.equal(unknown.shopKnown, false);
  assert.equal(unknown.buys.length, 0);
  assert.equal(slotOf(unknown, "Tee").original.shop, null);
});

test("compre os dois: o titular na loja que não vence o temporário vai para a reserva; S segue em campo", () => {
  const res = run({
    goal: [{ id: "Tee", name: "Tee", cost: 2 }],
    field: [u("Sa", 2)],
    reserve: [],
    shop: [{ slot: 1, id: "Tee", name: "Tee", cost: 2, buy: true }],
  });
  const s = slotOf(res, "Tee");
  assert.equal(s.playing.id, "Sa");
  assert.equal(s.kind, "temporario");
  assert.deepEqual(
    res.buys.map((b) => [b.id, b.purpose]),
    [["Tee", "reserva"]],
  );
  assert.match(res.note, /Compre os dois/);
});

test("reserva cheia: vende o substituto mais fraco da reserva, nunca cópia do titular; reserva desconhecida não sugere venda", () => {
  const goal = [
    { id: "Tee", name: "Tee", cost: 2 },
    { id: "Ti", name: "Ti", cost: 1 },
  ];
  const shop = [{ slot: 2, id: "Tee", name: "Tee", cost: 2, buy: true }];
  const full = run({
    goal,
    level: 1,
    field: [u("Sc", 2)],
    reserve: [
      ...Array.from({ length: 7 }, () => u("Ti", 1)),
      u("Sd", 1),
      u("Sa", 1),
    ],
    benchKnown: true,
    shop,
  });
  const b = full.buys.find((x) => x.id === "Tee");
  assert.equal(b.purpose, "reserva");
  assert.equal(b.sell.id, "Sd"); // custo 1, a mais fraca fora da comp
  // Só cópias do titular na reserva cheia: nada para vender, a compra não é sugerida.
  const onlyGoal = run({
    goal,
    level: 1,
    field: [u("Sc", 2)],
    reserve: Array.from({ length: 9 }, () => u("Ti", 1)),
    benchKnown: true,
    shop,
  });
  assert.equal(onlyGoal.buys.length, 0);
  assert.equal(onlyGoal.bench.free, 0);
  const blind = run({
    goal,
    level: 1,
    field: [u("Sc", 2)],
    reserve: [],
    benchKnown: null,
    shop,
  });
  assert.equal(blind.buys[0].sell, null);
  assert.equal(blind.bench.known, false);
});

test("temporário da loja: só para vaga vazia e só se a vida que segura paga os juros na faixa de vida", () => {
  const base = {
    goal: [{ id: "Tee", name: "Tee", cost: 2 }],
    field: [],
    reserve: [],
    level: 1,
    shop: [{ slot: 4, id: "Sb", name: "Sb", cost: 2, buy: true }],
  };
  // 45 g → 43 g não muda o juro: custo 0, compra.
  const free = run({ ...base, gold: 45 });
  const s = slotOf(free, "Tee");
  assert.equal(s.kind, "temporario");
  assert.equal(s.playing.id, "Sb");
  assert.equal(s.playing.source, "loja");
  assert.deepEqual(s.playing.buy, { cost: 2, slot: 4 });
  assert.equal(free.buys[0].purpose, "temporario");
  // 50 g → 48 g perde 1 g de juros por 5 rodadas (5 g) contra 2 × 0,44 × 5 = 4,4 de vida: não compra (saudável).
  const healthy = run({ ...base, gold: 50 });
  assert.equal(slotOf(healthy, "Tee").playing, null);
  assert.equal(healthy.buys.length, 0);
  // Vida em perigo: urgência 0,25 e 3 rodadas, a compra paga.
  const danger = run({ ...base, gold: 50, band: "danger" });
  assert.equal(slotOf(danger, "Tee").playing.id, "Sb");
  assert.deepEqual(
    interimBuyWorth({ gain: 2, cost: 2, gold: 50, level: 1, band: "healthy" }),
    { worth: false, gainHp: 4.4, costGold: 5, rounds: 5 },
  );
});

/* ---------- Pelo campo de agora (stage.mjs): a loja como possibilidade de compra ---------- */

const fixtureCatalog = {
  champions: [
    ["Aphelios", 4],
    ["Amumu", 4],
    ["Xayah", 4],
    ["Diana", 3],
    ["Rakan", 3],
    ["Vi", 2],
    ["Sentinel", 2],
    ["Varus", 1],
    ["Poppy", 1],
    ["Nami", 3],
  ].map(([name, cost]) => ({ apiName: `TFT_${name}`, name, cost, traits: [] })),
  items: [],
};
const fieldWithout = (out) =>
  [
    ["Aphelios", 4, 1, 3],
    ["Amumu", 4, 2, 2],
    ["Diana", 3, 2, 0],
    ["Rakan", 3, 1, 0],
    ["Vi", 2, 2, 1],
    ["Sentinel", 2, 1, 0],
    ["Varus", 1, 2, 0],
  ].filter(([n]) => n !== out);

test("Formação: a peça da comp na loja vira a vaga dela 'a comprar'; ouro insuficiente limita a compra", () => {
  const stageOf = (gold) => {
    const s = makeState({ gold, level: 8, hp: 80, stage: "4-2" });
    s.options.shop = ["TFT_Xayah", "TFT_Poppy"];
    return stagePlan(s.plan, s.analysis, fixtureCatalog, s.options);
  };
  const rich = stageOf(54),
    xayah = rich.slots.find((x) => x.unit?.id === "TFT_Xayah");
  assert.equal(xayah.kind, "titular");
  assert.equal(xayah.playing.source, "loja");
  assert.equal(xayah.playing.buy.slot, 1);
  const card = rich.shop.find((c) => c.id === "TFT_Xayah");
  assert.equal(card.action, "comprar");
  assert.match(card.reason, /entra na vaga de Xayah/);
  assert.equal(rich.buyNow.find((b) => b.id === "TFT_Xayah").slot, "vaga");
  // 3 g não paga a carta de custo 4: ela não entra no tabuleiro de agora.
  const poor = stageOf(3),
    x2 = poor.slots.find((x) => x.unit?.id === "TFT_Xayah");
  assert.equal(x2.playing, null);
  assert.equal(x2.original.shop.buy, false);
  assert.equal(poor.shop.find((c) => c.id === "TFT_Xayah").action, "sem ouro");
});

test("Formação sem loja lida: nenhuma vaga 'na loja' é inventada", () => {
  const s = makeState({ gold: 54, level: 8, units: fieldWithout("Rakan") });
  s.options.shop = [];
  const st = stagePlan(s.plan, s.analysis, fixtureCatalog, s.options);
  assert.equal(st.shopRead, false);
  assert.equal(st.interim.shopKnown, false);
  assert.ok(st.slots.every((x) => x.playing?.source !== "loja"));
  assert.ok(st.slots.every((x) => x.original?.shop == null));
});

test("Formação: a compra da peça da comp troca o temporário só se o supera em 1★ pela margem; senão vai para a reserva", () => {
  // Xayah (custo 4) e Varus fora de campo, nível 7 cheio: a peça fora da comp segura a vaga de Xayah (custo maior primeiro).
  const stageWith = (sub) => {
    const s = makeState({
      gold: 54,
      level: 7,
      hp: 80,
      units: [...fieldWithout("Varus").slice(0, 6), sub],
    });
    return stagePlan(s.plan, s.analysis, fixtureCatalog, s.options);
  };
  // Poppy 2★ (1 × 2 = 2) contra Xayah 1★ (4): Xayah supera; comprar Xayah troca Poppy.
  const weak = stageWith(["Poppy", 1, 2, 0]);
  assert.equal(
    weak.slots.find((x) => x.unit?.id === "TFT_Xayah").playing.id,
    "TFT_Poppy",
  );
  const b1 = weak.buyNow.find((b) => b.id === "TFT_Xayah");
  assert.equal(b1.slot, "troca");
  assert.equal(b1.replaces, "Poppy");
  assert.equal(b1.holder.id, "TFT_Poppy");
  // Nami 2★ (3 × 2 = 6) contra Xayah 1★ (4): −2, além da margem; comprar Xayah vai para a reserva (compre os dois).
  const strong = stageWith(["Nami", 3, 2, 0]),
    xayah = strong.slots.find((x) => x.unit?.id === "TFT_Xayah");
  assert.equal(xayah.kind, "temporario");
  assert.equal(xayah.playing.id, "TFT_Nami");
  assert.match(xayah.until.text, /volta quando Xayah chegar a 2★/);
  const b2 = strong.buyNow.find((b) => b.id === "TFT_Xayah");
  assert.equal(b2.slot, "banco");
  assert.equal(b2.replaces, null);
  // A troca proposta diz o mesmo (uma só decisão).
  assert.ok(
    strong.board.some((x) => x.id === "TFT_Nami" && x.status === "temporario"),
  );
});
