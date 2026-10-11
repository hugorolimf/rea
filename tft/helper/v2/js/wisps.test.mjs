// Rodar com: node --test tft/helper/v2/js/
// Wisps (fogos-fátuos) da loja no painel: o modelo (sem DOM) lê os Wisps do GEP (state.wisps), usa o catálogo real
// de /api/catalog (aqui, wisps.json com a imagem do manifesto) e devolve marca, nome e recomendação por Wisp.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wispBook, wispTitle, wispsView } from "./wisps.js";

const read = (f) =>
  JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
const icons = read("../../assets-manifest.json"),
  catalog = {
    wisps: read("../../wisps.json").wisps.map((w) => ({
      ...w,
      image: icons[w.iconKey] ?? null,
    })),
  };

const hero = { hp: 90, gold: 35, stage: { stage: 4, round: 2 } };
const gepWisp = {
  slot: 5,
  id: "DA_Cutpurse18",
  name: "Punguista",
  known: true,
};

test("Wisp do GEP: marca com a imagem do manifesto, nome e recomendação com motivo", () => {
  const [w, ...rest] = wispsView(
    { wisps: [gepWisp] },
    { catalog, hero, roll: { go: false } },
  );
  assert.equal(rest.length, 0);
  assert.equal(w.slot, 5);
  assert.equal(w.id, "DA_Cutpurse18");
  assert.equal(w.name, "Punguista");
  assert.match(w.image, /^\/assets\/[0-9a-f]+\.png$/);
  assert.equal(w.veredito, "comprar");
  assert.ok(w.motivo.length > 10);
  // Tooltip: nome, tipo/categoria (deduzida), efeito, preço e a recomendação.
  assert.match(w.title, /^Punguista/);
  assert.match(w.title, /deduzida da descrição/);
  assert.match(w.title, /Preço: 2g/);
  assert.match(w.title, /comprar:/);
});

test("rolldown em andamento (o plano manda rolar) vira pular; sem painel de Roll é desconhecido", () => {
  const go = wispsView(
    { wisps: [gepWisp] },
    { catalog, hero, roll: { go: true } },
  );
  assert.equal(go[0].veredito, "pular");
  const none = wispsView({ wisps: [gepWisp] }, { catalog, hero });
  assert.ok(none[0].incertezas.some((t) => /rolldown/.test(t)));
});

test("sem os Wisps do GEP, a loja não é relida pelo catálogo: nenhum Wisp (nada de palpite)", () => {
  const seen = {
    shop: [
      { text: "DA_18_Xayah", id: "DA_18_Xayah" },
      null,
      { text: "Punguista", id: null },
    ],
  };
  const out = wispsView(seen, { catalog, hero, roll: { go: false } });
  assert.deepEqual(out, []);
});

test("a faixa de vida da análise vale sobre a vida lida", () => {
  const rec = {
    recommendations: [
      { strategy: { panels: { economy: { pressure: "critical" } } } },
    ],
  };
  const seen = { wisps: [{ slot: 5, id: "DA_18_Tremors", known: true }] };
  const late = { ...hero, stage: { stage: 5, round: 2 } };
  const calm = wispsView(seen, { catalog, hero: late, roll: { go: false } });
  assert.equal(calm[0].veredito, "avaliar");
  const risky = wispsView(seen, {
    catalog,
    hero: late,
    rec,
    roll: { go: false },
  });
  assert.equal(risky[0].veredito, "comprar");
});

test("Wisp que o catálogo não conhece fica marcado e incerto; sem catálogo ou sem Wisp não há marca", () => {
  const [w] = wispsView(
    { wisps: [{ slot: 4, id: "DA_Novo18", name: "Novo", known: false }] },
    { catalog, hero, roll: { go: false } },
  );
  assert.equal(w.desconhecido, true);
  assert.equal(w.veredito, "incerto");
  assert.match(w.title, /Fora do catálogo de Wisps/);
  assert.deepEqual(wispsView({ wisps: [gepWisp] }, { hero }), []);
  assert.deepEqual(wispsView({ wisps: [] }, { catalog, hero }), []);
  assert.deepEqual(wispsView(null, { catalog, hero }), []);
  assert.equal(wispBook({ wisps: [] }), null);
  assert.ok(wispBook(catalog));
  assert.match(
    wispTitle({ id: "DA_X", name: "X", desconhecido: true }, null),
    /^X/,
  );
});
