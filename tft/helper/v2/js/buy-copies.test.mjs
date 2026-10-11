// Rodar com: node --test tft/helper/v2/js/buy-copies.test.mjs
// Compra na loja de peça do plano que o jogador JÁ TEM (campo ou reserva): a regra (core/pool/buy-copies.mjs) e o que a
// interface e o overlay recebem dela (v2/js/model.js -> lista "Comprar"; overlay/hud/view.mjs -> buy e itens).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyBuys, nextStar } from "../../core/pool/buy-copies.mjs";
import { buildModel } from "./model.js";
import { focusView } from "./focus.js";

const { state, rec } = JSON.parse(
  readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
);
// Peças do plano gravado: Varus 2★ (3 cópias), Amumu 2★ (3), Sentinel 2★ (5 cópias), Diana 2★ (3); Xayah não é sua.
const VARUS = "DA_18_Varus",
  AMUMU = "DA_Amumu18",
  SENTINEL = "DA_Sentinel18",
  XAYAH = "DA_18_Xayah";

const card = (id) => ({ text: id, id });
const live = ({ shop, gold = 54, tweak } = {}) => {
  const s = structuredClone(state),
    r = structuredClone(rec);
  s.screen = {
    stage: "4-2",
    gold,
    level: 8,
    xp: "23/68",
    items: [],
    shop,
    sources: { shop: "gep" },
  };
  r.metadata.actionable = true;
  r.self.health = 58;
  tweak?.(r);
  return buildModel({ state: s, rec: r });
};
const buyRows = (m) => m.plan.steps.find((s) => s.id === "buy")?.rows ?? [];
const pool = (r, name) => r.pool.find((p) => p.name === name);
const plan = (r) => r.recommendations[0];

test("nextStar: o marco de estrela seguinte e se UMA cópia o fecha", () => {
  assert.deepEqual(nextStar(1), { next: 2, need: 2, closes: false });
  assert.deepEqual(nextStar(2), { next: 2, need: 1, closes: true });
  assert.deepEqual(nextStar(3), { next: 3, need: 6, closes: false });
  assert.deepEqual(nextStar(8), { next: 3, need: 1, closes: true });
  assert.equal(nextStar(9), null, "3★ não ganha nada com mais cópias");
});

test("copyBuys: peça sua (1★, 2★, reserva) entra; 3★, peça que não é sua e cópias esgotadas não", () => {
  const board = [
    { id: "a", name: "A", cost: 3, owned: true, stars: 1 },
    { id: "b", name: "B", cost: 3, owned: true, stars: 2 },
    { id: "c", name: "C", cost: 3, owned: true, stars: 3 },
    { id: "d", name: "D", cost: 3, owned: false, stars: 1 },
    { id: "e", name: "E", cost: 4, owned: true, stars: 2 },
  ];
  const rows = copyBuys({
    board,
    pool: [
      { name: "A", own: 2, chancePerShop: 0.1, remainingUpper: 10 },
      { name: "B", own: 3, chancePerShop: 0.1, remainingUpper: 10 },
      { name: "C", own: 9, chancePerShop: 0.1, remainingUpper: 10 },
      { name: "E", own: 3, chancePerShop: 0.1, remainingUpper: 4 },
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.id, r.next, r.closes]),
    [
      ["a", 2, true],
      ["b", 3, false],
    ],
    "A fecha o 2★ e vem primeiro; C é 3★, D não é sua e E não tem as 6 cópias que faltam para o 3★",
  );
  assert.match(rows[0].text, /fecha o 2★/);
  assert.match(rows[1].text, /sobe para 3★ \(faltam 6\)/);
});

test("copyBuys: sem a pool vale o piso das estrelas; ouro curto marca sem ouro; carry vem antes das comuns", () => {
  const board = [
    { id: "x", name: "X", cost: 2, owned: true, stars: 2 },
    { id: "y", name: "Y", cost: 5, owned: true, stars: 1 },
  ];
  const rows = copyBuys({ board, pool: [], carry: "Y", gold: 3 });
  assert.deepEqual(
    rows.map((r) => r.id),
    ["y", "x"],
  );
  assert.equal(rows[0].broke, true);
  assert.equal(rows[1].broke, false);
  assert.equal(rows[1].own, 3, "2★ sem pool = 3 cópias de piso");
  assert.deepEqual(
    copyBuys({ board, skip: new Set(["y"]) }).map((r) => r.id),
    ["x"],
    "a peça que a lista de compra já traz não se repete",
  );
});

test("compra: peça do plano que você já tem (2★ em campo) aparece na loja e vira linha Comprar", () => {
  const m = live({ shop: [card(VARUS), null, null, null, null] });
  const row = buyRows(m).find((r) => r.unit.id === VARUS);
  assert.ok(row, "Varus é seu (2★) e está na loja: a compra vale");
  assert.equal(row.how, "copy");
  assert.equal(row.copy.next, 3);
  assert.equal(row.copy.closes, false);
  assert.equal(row.shop.badge, "NA LOJA");
  assert.equal(row.shop.slotText, "slot 1");
  assert.match(row.copy.text, /cópia · sobe para 3★/);
  assert.equal(row.key, `buy:${VARUS}`);
  // A cópia lidera a lista (está na loja) e a nota do cabeçalho conta as peças na loja.
  assert.equal(buyRows(m)[0].unit.id, VARUS);
  assert.equal(m.plan.steps.find((s) => s.id === "buy").note.state, "hit");
  const focus = focusView(m);
  assert.equal(
    focus.items[0].id,
    "shop",
    '"Comprar na loja" aparece no foco agora',
  );
});

test("compra: a cópia que fecha estrela vem antes do carry e das peças novas", () => {
  const m = live({
    shop: [card(XAYAH), card(VARUS), card(SENTINEL), null, null],
    tweak: (r) => {
      pool(r, "Varus").own = 2; // mais uma cópia fecha o 2★ (a peça está como 1★)
      plan(r).board.find((u) => u.id === VARUS).stars = 1;
    },
  });
  const ids = buyRows(m).map((r) => [r.unit.id, r.how]);
  assert.deepEqual(ids[0], [VARUS, "copy"], "fecha 2★ primeiro");
  assert.equal(buyRows(m)[0].copy.closes, true);
  assert.ok(ids.some(([id, how]) => id === XAYAH && how !== "copy"));
  assert.ok(ids.some(([id, how]) => id === SENTINEL && how === "copy"));
  const keys = buyRows(m).map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, "uma linha por peça");
});

test("compra: peça na reserva conta como sua", () => {
  const m = live({
    shop: [card(AMUMU), null, null, null, null],
    tweak: (r) => {
      const u = plan(r).board.find((x) => x.id === AMUMU);
      u.inReserve = true;
    },
  });
  assert.ok(buyRows(m).some((r) => r.unit.id === AMUMU && r.how === "copy"));
});

test("compra: peça 3★ ou sem cópias úteis na pool não entra", () => {
  const tres = live({
    shop: [card(VARUS), null, null, null, null],
    tweak: (r) => {
      pool(r, "Varus").own = 9;
    },
  });
  assert.equal(
    buyRows(tres).some((r) => r.unit.id === VARUS),
    false,
  );
  const esgotada = live({
    shop: [card(SENTINEL), null, null, null, null],
    tweak: (r) => {
      Object.assign(pool(r, "Sentinel"), { remainingUpper: 2 }); // faltam 4 para o 3★ e só há 2 na pool
    },
  });
  assert.equal(
    buyRows(esgotada).some((r) => r.unit.id === SENTINEL),
    false,
  );
});

test("compra: sem ouro mantém a linha, marcada, e o aviso diz 'sem ouro'", () => {
  const m = live({ shop: [card(AMUMU), null, null, null, null], gold: 1 });
  const row = buyRows(m).find((r) => r.unit.id === AMUMU);
  assert.ok(row);
  assert.equal(row.broke, true);
  assert.equal(row.shop.buyText, "sem ouro");
});

test("compra: cópia fora do plano, peça que não está na loja e loja ilegível não geram linha de cópia", () => {
  const fora = live({ shop: [card("DA_Nunca"), null, null, null, null] });
  assert.equal(
    buyRows(fora).some((r) => r.how === "copy"),
    false,
  );
  const semLoja = live({ shop: [null, null, null, null, null] });
  assert.equal(
    buyRows(semLoja).some((r) => r.how === "copy"),
    false,
    "peça sua que não está na loja não polui a lista",
  );
  const ilegivel = live({ shop: undefined });
  assert.equal(
    buyRows(ilegivel).some((r) => r.how === "copy"),
    false,
  );
  assert.equal(
    ilegivel.plan.steps.find((s) => s.id === "buy").note,
    undefined,
    "loja não lida: nenhum aviso, nem de 'na loja' nem de 'fora da loja'",
  );
});

test("compra: a regra das peças que faltam não muda (caracterização)", () => {
  const m = live({ shop: [card(XAYAH), null, null, null, null] });
  const novas = buyRows(m).filter((r) => r.how !== "copy");
  assert.deepEqual(
    novas.map((r) => r.unit.id).sort(),
    plan(rec)
      .stage.buyNow.map((u) => u.id)
      .sort(),
  );
  assert.equal(
    novas.every((r) => !r.copy),
    true,
  );
  assert.equal(novas.find((r) => r.unit.id === XAYAH).shop.badge, "NA LOJA");
});
