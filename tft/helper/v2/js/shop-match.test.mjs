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
const gepSeen = (shop, extra = {}) => ({
  shop,
  sources: { shop: "gep" },
  ...extra,
});
// Fonte GEP fora do estado "ativo" (parou de mandar eventos): a mesma loja vale só como provável.
const PARADO = { gepStatus: { state: "obsoleto" } };

test("shopView: GEP fresco é confiável; GEP parado é provável; sem a loja do GEP não sabe", () => {
  const shop = [card("A"), null, card("B"), null, null];
  const gep = shopView(gepSeen(shop), { gepStatus: { state: "ativo" } });
  assert.equal(gep.known, true);
  assert.equal(gep.source, "gep");
  assert.equal(gep.confidence, "confiavel");
  assert.deepEqual(gep.slots, [
    { slot: 1, id: "A" },
    { slot: 3, id: "B" },
  ]);
  // GEP que deixou de estar ativo não vale como confiável.
  const parado = shopView(gepSeen(shop), PARADO);
  assert.equal(parado.known, true);
  assert.equal(parado.source, "gep");
  assert.equal(parado.confidence, "provavel");
  assert.equal(shopView(undefined).known, false);
  assert.equal(shopView({ shop: null }).known, false);
  assert.equal(shopView({ shop: [], sources: {} }).known, false);
  // Só o GEP entrega a loja: cartas sem `sources.shop === "gep"` (sem origem ou outra origem) não viram loja conhecida.
  assert.equal(shopView({ shop }).known, false);
  assert.equal(shopView({ shop, sources: { shop: null } }).known, false);
  assert.equal(shopView({ shop, sources: { shop: "screen" } }).known, false);
});

test("shopView: Wisps (id nulo) ficam de fora; cartas sem campeão são contadas como não reconhecidas", () => {
  const view = shopView(
    gepSeen([
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
  // `seen.wisps` com o espaço também tira a carta, mesmo que ela traga um id.
  const viaList = shopView(
    gepSeen([card("A"), card("B")], { wisps: [{ slot: 2, id: "W" }] }),
  );
  assert.deepEqual(
    viaList.slots.map((s) => s.id),
    ["A"],
  );
});

test("shopView: loja sem fonte (escondida, GEP off) não prova loja vazia; GEP com tudo vendido é loja vazia conhecida", () => {
  assert.equal(
    shopView({ shop: null, sources: {}, noSource: { shop: "loja-escondida" } })
      .known,
    false,
  );
  assert.equal(
    shopView({ shop: null, sources: {}, noSource: { shop: "banco-ausente" } })
      .known,
    false,
  );
  const vendida = shopView(gepSeen([null, null, null, null, null]));
  assert.equal(vendida.known, true);
  assert.deepEqual(vendida.slots, []);
});

test("matchWanted: cópias na loja, espaços e quantidade a comprar", () => {
  const view = shopView(gepSeen([card("A"), card("B"), card("A"), null, null]));
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
      shopView(gepSeen([null, null, card("A"), null, null])),
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
      shopView(gepSeen([card("A"), card("A"), null, null, null]), PARADO),
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
      shopView(gepSeen([card("A"), null, null, null, null])),
    ),
  );
  assert.equal(parcial.buyText, "1 de 2");
  assert.equal(parcial.enough, false);

  assert.equal(
    describeMatch(
      matchWanted({ id: "A", want: 1 }, shopView(gepSeen([card("A")]))),
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
    shopView(gepSeen([card("C"), null, card("B"), null, null])),
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
    shopView(gepSeen([card("Z"), null, null, null, null])),
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
    gepSeen([card("Z"), { text: "Borrão", id: null }, null, null, null]),
    PARADO,
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
    shopView(gepSeen([null, null, card("A"), null, null]), PARADO),
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].slots, [3]);
  assert.equal(out[0].probable, true);
  assert.match(out[0].confidenceTitle, /Provável/);
  assert.equal(
    refineShopHits(
      server,
      shopView(gepSeen([card("B"), null, null, null, null])),
    )[0].probable,
    false,
  );
  assert.deepEqual(refineShopHits(server, shopView(null)), server);
});

/* ----- Integração com o modelo (lista Comprar do /api/recommend gravado) ----- */
const { state, rec } = JSON.parse(
  readFileSync(new URL("../../live-mock-base.json", import.meta.url), "utf8"),
);
function live(seenExtra, buyNow) {
  const s = structuredClone(state),
    r = structuredClone(rec);
  s.seen = {
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: [],
    ...seenExtra,
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
        sources: { shop: "gep", level: "gep" },
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

test("modelo: loja do GEP parado é só provável; sem a loja do GEP não há nota nem selo; nada na loja avisa de leve", () => {
  const parado = live(
    { shop: [card("A"), null, null, null, null], sources: { shop: "gep" } },
    [buy("A")],
  );
  parado.state.gepStatus = {
    state: "obsoleto",
    reason: "sem-eventos-recentes",
  };
  assert.equal(buyStep(buildModel(parado)).rows[0].shop.badge, "NA LOJA?");

  // GEP off: sem loja (null, com o motivo) não há selo nem nota de "nada na loja".
  const off = live(
    {
      shop: null,
      sources: {},
      noSource: { shop: "banco-ausente" },
    },
    [buy("A")],
  );
  off.state.gepStatus = { state: "ausente", reason: "banco-ausente" };
  const offModel = buildModel(off);
  assert.equal(buyStep(offModel).rows[0].shop, null);
  assert.equal(buyStep(offModel).note, undefined);

  // Cartas sem a origem GEP não valem como loja.
  const semGep = buildModel(
    live(
      { shop: [card("A"), null, null, null, null], sources: { shop: null } },
      [buy("A")],
    ),
  );
  assert.equal(buyStep(semGep).rows[0].shop, null);
  assert.equal(buyStep(semGep).note, undefined);

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
