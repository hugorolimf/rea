// Rodar com: node --test tft/helper/v2/js/shop-match.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  crossShop,
  describeMatch,
  matchWanted,
  refineShopHits,
  shopStatus,
  shopView,
} from "./shop-match.js";
import { buildModel } from "./model.js";

const card = (id, extra = {}) => ({ text: id, id, ...extra });
const gepScreen = (shop, extra = {}) => ({
  shop,
  sources: { shop: "gep" },
  ...extra,
});
const tela = (shop, extra = {}) => ({
  shop,
  sources: { shop: "screen" },
  ...extra,
});

test("shopView: GEP fresco é confiável; leitura de tela é provável; sem leitura não sabe", () => {
  const shop = [card("A"), null, card("B"), null, null];
  const gep = shopView(gepScreen(shop), { gepStatus: { state: "ativo" } });
  assert.equal(gep.known, true);
  assert.equal(gep.source, "gep");
  assert.equal(gep.confidence, "confiavel");
  assert.deepEqual(gep.slots, [
    { slot: 1, id: "A" },
    { slot: 3, id: "B" },
  ]);
  assert.equal(shopView(tela(shop)).confidence, "provavel");
  // GEP que deixou de estar ativo não vale como confiável.
  assert.equal(
    shopView(gepScreen(shop), { gepStatus: { state: "obsoleto" } }).confidence,
    "provavel",
  );
  assert.equal(shopView(undefined).known, false);
  assert.equal(shopView({ shop: null }).known, false);
  assert.equal(shopView({ shop: [], sources: {} }).known, false);
});

test("shopView: Wisps (id nulo) ficam de fora; cartas sem campeão são contadas como não reconhecidas", () => {
  const view = shopView(
    gepScreen([
      card("A"),
      { text: "DA_AbandonShip18", id: null, wisp: true, source: "gep" },
      { text: "Lixo", id: null },
      null,
      card("A"),
    ]),
  );
  assert.deepEqual(
    view.slots.map((s) => [s.slot, s.id]),
    [
      [1, "A"],
      [5, "A"],
    ],
  );
  assert.equal(view.unreadable, 1);
  // `screen.wisps` com o espaço também tira a carta, mesmo que ela traga um id.
  const viaList = shopView(
    tela([card("A"), card("B")], { wisps: [{ slot: 2, id: "W" }] }),
  );
  assert.deepEqual(
    viaList.slots.map((s) => s.id),
    ["A"],
  );
});

test("shopView: leitura de tela sem nenhuma carta não prova loja vazia; GEP com tudo vendido é loja vazia conhecida", () => {
  assert.equal(shopView(tela([null, null, null, null, null])).known, false);
  const vendida = shopView(gepScreen([null, null, null, null, null]));
  assert.equal(vendida.known, true);
  assert.deepEqual(vendida.slots, []);
});

test("matchWanted: cópias na loja, espaços e quantidade a comprar", () => {
  const view = shopView(
    gepScreen([card("A"), card("B"), card("A"), null, null]),
  );
  const a1 = matchWanted({ id: "A", name: "Ahri", want: 1 }, view);
  assert.deepEqual(a1.slots, [1, 3]);
  assert.equal(a1.copies, 2);
  assert.equal(a1.enough, true);
  assert.equal(a1.buy, 1);
  const a3 = matchWanted({ id: "A", want: 3 }, view);
  assert.equal(a3.enough, false);
  assert.equal(a3.buy, 2);
  assert.equal(matchWanted({ id: "Z" }, view), null);
  assert.equal(matchWanted({ id: "A" }, shopView(null)), null);
  // quantidade inválida cai para 1
  assert.equal(matchWanted({ id: "B", want: 0 }, view).want, 1);
});

test("describeMatch: selo, texto de compra e a diferença confiável x provável", () => {
  const ok = describeMatch(
    matchWanted(
      { id: "A", name: "Ahri", want: 1 },
      shopView(gepScreen([null, null, card("A"), null, null])),
    ),
  );
  assert.equal(ok.badge, "NA LOJA");
  assert.equal(ok.buyText, "comprar 1");
  assert.equal(ok.slotText, "slot 3");
  assert.equal(ok.mark, "comprar 1 · #3");
  assert.match(ok.title, /GEP/);
  assert.equal(ok.probable, false);

  const prov = describeMatch(
    matchWanted(
      { id: "A", name: "Ahri", want: 1 },
      shopView(tela([card("A"), card("A"), null, null, null])),
    ),
  );
  assert.equal(prov.badge, "NA LOJA?");
  assert.equal(prov.copies, 2);
  assert.equal(prov.slotText, "slots 1, 2");
  assert.equal(prov.mark, "comprar 1 · ×2");
  assert.match(prov.title, /Provável/);
  assert.match(prov.title, /2 cópias/);

  const parcial = describeMatch(
    matchWanted(
      { id: "A", name: "Ahri", want: 2 },
      shopView(gepScreen([card("A"), null, null, null, null])),
    ),
  );
  assert.equal(parcial.buyText, "1 de 2");
  assert.equal(parcial.enough, false);

  assert.equal(
    describeMatch(
      matchWanted({ id: "A", want: 1 }, shopView(gepScreen([card("A")]))),
      { broke: true },
    ).buyText,
    "sem ouro",
  );
});

test("crossShop: as peças na loja sobem, a ordem relativa é mantida e o resto não muda", () => {
  const unit = (id) => ({ id, name: id });
  const rows = ["A", "B", "C", "D"].map((id) => ({
    key: `buy:${id}`,
    unit: unit(id),
  }));
  const out = crossShop(
    rows,
    shopView(gepScreen([card("C"), null, card("B"), null, null])),
  );
  assert.deepEqual(
    out.rows.map((r) => r.unit.id),
    ["B", "C", "A", "D"],
  );
  assert.equal(out.hits, 2);
  assert.deepEqual(
    out.rows.map((r) => r.shop !== null),
    [true, true, false, false],
  );
  assert.equal(out.status.state, "hit");
  assert.equal(out.status.text, "2 na loja agora");
  // As chaves das linhas não mudam (a interface anima a troca de posição sem recriar a linha).
  assert.deepEqual(
    out.rows.map((r) => r.key).sort(),
    rows.map((r) => r.key).sort(),
  );
});

test("crossShop: nada na loja deixa a lista como está e avisa de leve; loja não lida não avisa nada", () => {
  const rows = ["A", "B"].map((id) => ({ unit: { id, name: id } }));
  const none = crossShop(
    rows,
    shopView(gepScreen([card("Z"), null, null, null, null])),
  );
  assert.deepEqual(
    none.rows.map((r) => r.unit.id),
    ["A", "B"],
  );
  assert.equal(none.hits, 0);
  assert.equal(none.status.state, "none");
  assert.equal(none.status.text, "nenhuma peça do plano na loja agora");
  assert.ok(none.rows.every((r) => r.shop === null));

  const unknown = crossShop(rows, shopView(null));
  assert.equal(unknown.status, null, "sem leitura da loja não há aviso falso");
  assert.deepEqual(
    unknown.rows.map((r) => r.unit.id),
    ["A", "B"],
  );
  assert.ok(unknown.rows.every((r) => r.shop === null));
});

test("shopStatus: espaço não reconhecido não vira afirmação de 'nenhuma peça'; provável marca o '?'", () => {
  const view = shopView(
    tela([card("Z"), { text: "Borrão", id: null }, null, null, null]),
  );
  const s = shopStatus(view, 0);
  assert.equal(s.text, "nenhuma peça do plano reconhecida na loja agora");
  assert.match(s.title, /não foram reconhecidos/);
  assert.equal(shopStatus(view, 1).text, "1 na loja agora?");
  assert.equal(shopStatus(shopView(null), 0), null);
});

test("refineShopHits: espaços e confiança vêm da loja lida; peça que saiu da loja sai; sem leitura passa como está", () => {
  const server = [
    { id: "A", name: "Ahri", slots: [9], buy: 1, gold: 3, action: "comprar" },
    { id: "B", name: "Bard", slots: [2], buy: 1, gold: 4, action: "comprar" },
  ];
  const out = refineShopHits(
    server,
    shopView(tela([null, null, card("A"), null, null])),
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].slots, [3]);
  assert.equal(out[0].probable, true);
  assert.match(out[0].confidenceTitle, /Provável/);
  assert.equal(
    refineShopHits(
      server,
      shopView(gepScreen([card("B"), null, null, null, null])),
    )[0].probable,
    false,
  );
  assert.deepEqual(refineShopHits(server, shopView(null)), server);
});

/* ----- Integração com o modelo (lista Comprar do /api/recommend gravado) ----- */
const { state, rec } = JSON.parse(
  readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
);
function live(screenExtra, buyNow) {
  const s = structuredClone(state),
    r = structuredClone(rec);
  s.screen = {
    running: true,
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: [],
    ...screenExtra,
  };
  r.metadata.actionable = true;
  r.self.health = 58;
  const plan = r.recommendations[0];
  plan.stage = { ...plan.stage, board: [], buyNow };
  return { state: s, rec: r };
}
const buy = (id, over = {}) => ({
  id,
  name: id,
  cost: 3,
  chancePerShop: 0.1,
  slot: "vaga",
  affordable: true,
  ...over,
});
const buyStep = (m) => m.plan.steps.find((s) => s.id === "buy");

test("modelo: peça do Comprar na loja do GEP sobe, ganha selo e mantém a chave da linha", () => {
  const m = buildModel(
    live(
      {
        shop: [card("X"), null, card("B"), null, null],
        sources: { shop: "gep", level: "screen" },
      },
      [buy("A"), buy("B"), buy("X")],
    ),
  );
  const step = buyStep(m);
  assert.deepEqual(
    step.rows.map((r) => r.unit.id),
    ["B", "X", "A"],
  );
  assert.equal(step.rows[0].shop.badge, "NA LOJA");
  assert.equal(step.rows[0].shop.slotText, "slot 3");
  assert.equal(step.rows[2].shop, null);
  assert.deepEqual(
    step.rows.map((r) => r.key),
    ["buy:B", "buy:X", "buy:A"],
  );
  assert.equal(step.note.state, "hit");
});

test("modelo: loja da tela é só provável; sem loja lida não há nota nem selo; nada na loja avisa de leve", () => {
  const prov = buildModel(
    live(
      {
        shop: [card("A"), null, null, null, null],
        sources: { shop: "screen" },
      },
      [buy("A")],
    ),
  );
  assert.equal(buyStep(prov).rows[0].shop.badge, "NA LOJA?");

  const sem = buildModel(live({}, [buy("A")]));
  assert.equal(buyStep(sem).rows[0].shop, null);
  assert.equal(buyStep(sem).note, undefined);

  const vazia = buildModel(
    live(
      { shop: [card("Z"), null, null, null, null], sources: { shop: "gep" } },
      [buy("A")],
    ),
  );
  assert.equal(buyStep(vazia).note.state, "none");
  assert.equal(buyStep(vazia).rows[0].shop, null);
});

test("modelo: fora de partida (não ao vivo) nunca marca a loja", () => {
  const input = live(
    { shop: [card("A"), null, null, null, null], sources: { shop: "gep" } },
    [buy("A")],
  );
  input.rec.self.health = 0;
  const m = buildModel(input);
  assert.equal(m.status.live, false);
  assert.equal(buyStep(m).rows[0].shop, null);
});
