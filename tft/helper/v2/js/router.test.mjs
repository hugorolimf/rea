// Rodar com: node --test tft/helper/v2/js/router.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  VIEWS,
  documentTitle,
  hashFor,
  parseHash,
  viewForKey,
  viewInfo,
} from "./router.js";

test("hashes canônicos e antigos levam à tela certa", () => {
  const cases = {
    "": "live",
    "#": "live",
    "#ao-vivo": "live",
    "#comps": "comps",
    "#itens": "items",
    "#historico": "history",
    "#HISTORICO": "history",
    "#histórico": "history",
    "#%68istorico": "history",
  };
  for (const [hash, view] of Object.entries(cases))
    assert.deepEqual(parseHash(hash), { view, replay: null }, hash);
});

test("hash desconhecido, vazio ou malformado cai no Ao vivo (nunca numa página vazia)", () => {
  for (const hash of [
    "#nada",
    "#comps/extra",
    "#%",
    "#partida/",
    "#partida/abc",
    undefined,
    null,
  ])
    assert.deepEqual(
      parseHash(hash),
      { view: "live", replay: null },
      String(hash),
    );
});

test("#partida/<id> é o Ao vivo revendo a partida", () => {
  assert.deepEqual(parseHash("#partida/12345"), {
    view: "live",
    replay: "12345",
  });
  assert.deepEqual(parseHash("#partida/12345/extra"), {
    view: "live",
    replay: null,
  });
});

test("hashFor é o inverso de parseHash para as telas", () => {
  for (const v of VIEWS) {
    assert.equal(parseHash(hashFor(v.id)).view, v.id);
    assert.equal(hashFor(v.id), v.hash);
  }
  assert.equal(hashFor("inexistente"), "#ao-vivo");
});

test("atalhos 1 a 4 e títulos", () => {
  assert.deepEqual(["1", "2", "3", "4", "5", "a"].map(viewForKey), [
    "live",
    "comps",
    "items",
    "history",
    null,
    null,
  ]);
  assert.equal(new Set(VIEWS.map((v) => v.key)).size, VIEWS.length);
  assert.equal(viewInfo("comps").title, "Escolher comp");
  assert.equal(viewInfo("???").id, "live");
  assert.equal(documentTitle("history"), "Histórico · TFT Compass");
  assert.equal(
    documentTitle("live", "Subir · TFT Compass"),
    "Subir · TFT Compass",
  );
});
