// Rodar com: node --test tft/helper/v2/js/roster.test.mjs
// "Peça sua" em campo e na reserva (roster.js): a regra única que os cartões da aba Comps, o modal de sugestões, o anel
// "N/M" do HUD, a Formação, o Plano e a lista Comprar usam. Regressão: a aba Comps e o modal marcavam só o que estava em
// campo (`ownedIds` = rec.self.units), e uma peça na reserva (GEP) aparecia como se você não a tivesse.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compOwnership, ownership, rosterOf } from "./roster.js";
import { buildModel } from "./model.js";
import { planView } from "./plan.js";
import { realCatalog } from "./catalog-fixture.mjs";
// dom.js lê matchMedia ao carregar: um stub mínimo basta para importar a tela.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const { setCatalog } = await import("./ui/glyphs.js");
const { compCard, compsContext, ownCount } = await import("./ui/comps.js");

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const unit = (championName, starLevel = 1) => ({ championName, starLevel });
const bench = (id, stars = 1) => ({ id, stars, items: [], source: "gep" });
const gep = (list) => ({ sources: { bench: "gep" }, gepBench: list });

test("peça só na reserva aparece como 'na reserva', não como ausente", () => {
  const r = rosterOf({
    units: [unit("A")],
    seen: gep([bench("B")]),
  });
  const b = ownership(r, "B");
  assert.equal(b.state, "reserve");
  assert.equal(b.label, "na reserva");
  assert.equal(b.mine, true);
  assert.equal(ownership(r, "A").label, "em campo");
  // Reserva lida e a peça em lugar nenhum: aí sim é ausente.
  assert.equal(ownership(r, "C").state, "absent");
  assert.equal(ownership(r, "C").label, "");
});

test("cópias em campo e na reserva somam para a próxima estrela", () => {
  const r = rosterOf({
    units: [unit("V", 1)],
    seen: gep([bench("V", 1)]),
  });
  const v = ownership(r, "V");
  assert.equal(v.state, "both");
  assert.equal(v.label, "2 cópias: 1 em campo, 1 na reserva");
  assert.equal(v.copies, 2);
  assert.deepEqual(v.next, { stars: 2, have: 2, need: 3 });
  assert.match(v.text, /2\/3 para 2★/);
  // 2★ em campo (3 cópias) + 1★ na reserva = 4 cópias de 1★, rumo ao 3★ (9).
  const w = ownership(
    rosterOf({ units: [unit("V", 2)], seen: gep([bench("V", 1)]) }),
    "V",
  );
  assert.equal(w.copies, 4);
  assert.deepEqual(w.next, { stars: 3, have: 4, need: 9 });
  // Duas cópias só na reserva.
  const two = ownership(
    rosterOf({ units: [], seen: gep([bench("K"), bench("K")]) }),
    "K",
  );
  assert.equal(two.label, "2 cópias na reserva");
  assert.equal(two.copies, 2);
});

test("sem GEP a reserva é desconhecida, não vazia: fora de campo fica 'reserva desconhecida'", () => {
  for (const seen of [
    null,
    {},
    // Fonte da reserva que não é o GEP (leitura de tela, nula): a lista não vale.
    { sources: { bench: "seen" }, gepBench: [bench("B")] },
    { sources: { bench: null } },
  ]) {
    const r = rosterOf({ units: [unit("A")], seen });
    assert.equal(r.benchKnown, false);
    assert.equal(ownership(r, "B").state, "unknown");
    assert.equal(ownership(r, "B").label, "reserva desconhecida");
    assert.equal(ownership(r, "B").mine, false);
    // O campo continua conhecido.
    assert.equal(ownership(r, "A").state, "field");
  }
  const c = compOwnership(rosterOf({ units: [unit("A")] }), ["A", "B", "C"]);
  assert.deepEqual(
    [c.field, c.reserve, c.size, c.benchKnown],
    [1, 0, 3, false],
  );
  assert.equal(c.text, "1/3 em campo · reserva não lida");
});

test("contagem da comp: N/M em campo e +K só na reserva (a peça com cópia nos dois lugares conta em campo)", () => {
  const r = rosterOf({
    units: [unit("A"), unit("B")],
    seen: gep([bench("B"), bench("C"), bench("Z")]),
  });
  const c = compOwnership(r, ["A", "B", "C", "D"]);
  assert.deepEqual([c.field, c.reserve, c.size], [2, 1, 4]);
  assert.equal(c.text, "2/4 em campo · +1 na reserva");
  assert.match(ownCount(c), /<b>2\/4<\/b> em campo/);
  assert.match(ownCount(c), /\+1<\/b> na reserva/);
});

test("cartão da aba Comps (o mesmo do modal) marca a peça na reserva com selo e texto próprios", () => {
  const catalog = realCatalog();
  setCatalog(catalog);
  const raw = JSON.parse(src("../../meta-comps.json")).comps.map((c) => ({
    ...c,
    title: c.key.join(" · "),
  }));
  const comp = raw.find((c) => c.units?.length >= 4);
  const [a, b, d] = comp.units;
  const roster = rosterOf({
    units: [unit(a)],
    seen: gep([bench(b), bench(d)]),
  });
  // Campo + reserva da mesma peça: `d` também em campo.
  roster.field[d] = [1];
  const ctx = compsContext({ comps: [comp], ranking: [], roster });
  const c = ctx.all.find((x) => x.id === comp.id);
  assert.equal(c.roster, roster, "o cartão recebe o roster dos dados da tela");
  const html = compCard(c, { goalId: null, open: false, items: ctx.items });
  const li = (id) => {
    const name = catalog.champions.get(id).name;
    return html
      .split("<li ")
      .find((s) => s.includes(`>${name}</span>`) && s.includes("data-own"));
  };
  assert.match(li(a), /data-own="field"/);
  assert.match(li(a), /is-mine/);
  assert.match(li(a), /badge-mine/);
  assert.match(li(a), /\(em campo\)/);
  assert.match(li(b), /data-own="reserve"/);
  assert.match(li(b), /is-bench/);
  assert.match(li(b), /badge-bench/);
  assert.doesNotMatch(li(b), /is-mine/);
  assert.match(li(b), /\(na reserva\)/);
  assert.match(li(d), /data-own="both"/);
  assert.match(li(d), /2 cópias: 1 em campo, 1 na reserva/);
  // Sem GEP: nenhuma peça fora de campo vira "sua"; o texto diz que a reserva não foi lida.
  const blind = compsContext({
    comps: [comp],
    ranking: [],
    roster: rosterOf({ units: [unit(a)] }),
  }).all[0];
  const html2 = compCard(blind, {
    goalId: null,
    open: false,
    items: ctx.items,
  });
  assert.doesNotMatch(html2, /is-bench/);
  assert.match(html2, /reserva desconhecida/);
});

test("modal, aba Comps e main.js usam a mesma regra (roster), não mais só as peças em campo", () => {
  const modal = src("./ui/comp-modal.js"),
    cards = src("./ui/comps.js"),
    main = src("./main.js");
  for (const [name, text] of [
    ["comp-modal.js", modal],
    ["comps.js", cards],
    ["main.js", main],
  ])
    assert.doesNotMatch(text, /ownedIds/, `${name} ainda usa ownedIds`);
  // O modal desenha o mesmo cartão (compCard via compsContext) e a aba diz a contagem pela mesma função.
  assert.match(modal, /compOwnership\(data\.roster/);
  assert.match(modal, /compsContext\(data\)/);
  assert.match(main, /roster: rosterOf\(/);
});

test("Ao vivo: anel N/M em campo + reserva à parte, Formação 'na reserva' e Comprar com a cópia da reserva", () => {
  const { state, rec } = JSON.parse(src("../../live-mock-base.json"));
  // Aphelios (da comp, fora de campo) e uma cópia de Varus (em campo) na reserva do GEP.
  const live = {
    state: {
      ...state,
      seen: {
        ...state.seen,
        ...gep([bench("DA_18_Aphelios"), bench("DA_18_Varus")]),
      },
    },
    rec,
  };
  const m = buildModel(live);
  // O par N/M continua só do campo (o overlay o lê como "peças em campo"); a reserva vem à parte.
  assert.deepEqual(m.plan.progress, { have: 4, total: 9 });
  assert.deepEqual(m.plan.reserve, {
    count: 1,
    known: true,
    // Loja não lida neste estado: nenhuma peça "na loja" é inventada.
    shop: 0,
    text: "4/9 em campo · +1 na reserva",
  });
  const cell = (id) => m.plan.cells.find((c) => c.id === id);
  assert.equal(cell("DA_18_Aphelios").status, "reserve");
  assert.equal(cell("DA_18_Aphelios").own, "na reserva");
  assert.equal(cell("DA_18_Varus").status, "owned");
  assert.equal(cell("DA_18_Varus").own, "2 cópias: 1 em campo, 1 na reserva");
  const buy = m.plan.steps
    .find((s) => s.id === "buy")
    ?.rows.find((r) => r.unit.id === "DA_18_Aphelios");
  // A análise (de antes da compra) ainda manda comprar; a linha sabe que a peça já está na reserva.
  assert.equal(buy.own.state, "reserve");
  assert.equal(buy.own.label, "na reserva");
  // Sem GEP: o anel não inventa reserva e diz que ela não foi lida; a Formação cai no estado da análise.
  const blind = buildModel({ state, rec });
  assert.equal(blind.plan.progress.have, 4);
  assert.equal(blind.plan.reserve.count, 0);
  assert.equal(blind.plan.reserve.known, false);
  assert.match(blind.plan.reserve.text, /reserva não lida/);
  assert.equal(
    blind.plan.cells.find((c) => c.id === "DA_18_Aphelios").status,
    "incoming",
  );
});

test("Formação: peça que a análise marca owned + inReserve aparece 'na reserva' (o owned do servidor inclui a reserva)", () => {
  const { state, rec } = JSON.parse(src("../../live-mock-base.json"));
  const r2 = structuredClone(rec),
    ap = r2.recommendations[0].board.find((u) => u.id === "DA_18_Aphelios");
  ap.owned = true;
  ap.inReserve = true;
  const m = buildModel({ state, rec: r2 });
  assert.equal(
    m.plan.cells.find((c) => c.id === "DA_18_Aphelios").status,
    "reserve",
  );
});

test("Plano: a peça comprada que está na reserva diz 'na reserva' em vez de 'pode estar na reserva'", () => {
  const progress = {
    plan: { title: "X" },
    units: [
      {
        id: "B",
        name: "B",
        status: "missing",
        stars: 0,
        targetStars: 2,
        boughtUpTo: 1,
        copies: 0,
        need: 3,
      },
      {
        id: "V",
        name: "V",
        status: "partial",
        stars: 1,
        targetStars: 2,
        copies: 2,
        need: 3,
      },
    ],
  };
  const roster = rosterOf({
    units: [unit("V")],
    seen: gep([bench("B"), bench("V")]),
  });
  const v = planView(progress, true, roster);
  assert.equal(v.units[0].line, "0→2★ · na reserva");
  assert.equal(v.units[0].own, "reserve");
  assert.match(v.units[1].line, /1 em campo, 1 na reserva/);
  // Sem roster, o texto antigo continua.
  assert.match(planView(progress).units[0].line, /pode estar na reserva/);
});
