// ARQUIVO HISTÓRICO (fora da suíte: os globs de teste não entram em .old/). Casos de v2/js/shop-match.test.mjs que só
// existiam para a loja lida da tela (OCR, `sources.shop === "screen"`): loja da tela valia como "provável" e, sem
// nenhuma carta lida, não provava loja vazia. Copiados como estavam em 2026-10-11, antes da remoção; hoje falhariam
// (só o GEP entrega a loja: sem `sources.shop === "gep"`, `known: false`). Ver .old/ocr/README.md.
// No sistema atual: v2/js/shop-match.test.mjs ("sem a loja do GEP não sabe", "GEP parado é provável").
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describeMatch,
  matchWanted,
  refineShopHits,
  shopStatus,
  shopView,
} from "../../../v2/js/shop-match.js";
import { buildModel } from "../../../v2/js/model.js";

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

const { state, rec } = JSON.parse(
  readFileSync(
    new URL("../../../live-mock-base.json", import.meta.url),
    "utf8",
  ),
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
