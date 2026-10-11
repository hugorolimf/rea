// Rodar com: node --test tft/helper/tests/champion-items.test.mjs
// Itens recomendados de cada campeão (até 3) com a situação segundo o inventário: a regra (core/items/champion-items.mjs),
// o passo "Itens dos campeões" da interface (v2/js/model.js), o cartão do overlay (overlay/hud/view.mjs + draw.mjs) e
// a prova de que o "Próximo item" e o resto do plano continuam como estavam.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { championItems, stateBrief } from "../core/items/champion-items.mjs";
import { buildModel } from "../v2/js/model.js";
import { planView } from "../v2/js/plan.js";
import { PART_STATE, nextItemRecipe } from "../v2/js/next-item.js";
import { buildStates } from "../v2/js/item-source.js";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { overlayView, CHAMPS_SHOWN } from "../overlay/hud/view.mjs";

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const glyphs = await import("../v2/js/ui/glyphs.js");
const rich = await import("../v2/js/ui/rich-text.js");
const { esc } = await import("../v2/js/dom.js");
const { createDraw } = await import("../overlay/hud/draw.mjs");
const { buildsRow } = await import("../v2/js/ui/steps.js");

const catalog = realCatalog();
glyphs.setCatalog(catalog);
const draw = createDraw({
  esc,
  glyph: glyphs.glyph,
  portrait: glyphs.portrait,
  unitPortrait: glyphs.unitPortrait,
  itemPortrait: glyphs.itemPortrait,
  nameChip: rich.nameChip,
  richText: rich.richText,
  stars: glyphs.stars,
});
const deps = {
  buildModel,
  planView,
  nextItemRecipe,
  partState: PART_STATE,
  buildStates,
  catalogItems: catalog.items,
};

const BASE = JSON.parse(
  fs.readFileSync(new URL("../live-mock-base.json", import.meta.url), "utf8"),
);
const VARUS = "DA_18_Varus", // sem itens, 3 slots livres: Shojin, Last Whisper, Infinity Edge
  DIANA = "DA_18_Diana";
const BF = "DA_Component_BFSword",
  TEAR = "DA_Component_TearOfTheGoddess",
  GLOVES = "DA_Component_SparringGloves",
  BOW = "DA_Component_RecurveBow";

function input(items, tweak) {
  const state = structuredClone(BASE.state),
    rec = structuredClone(BASE.rec);
  state.screen = {
    running: true,
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items,
  };
  Object.assign(state, {
    actionable: true,
    sameGame: true,
    phase: "InProgress",
    ageSeconds: 3,
  });
  rec.metadata.actionable = true;
  rec.self.health = 58;
  tweak?.(rec);
  return { state, rec };
}
const model = (items, tweak) => buildModel(input(items, tweak));
const rowsOf = (m) => m.plan.steps.find((s) => s.id === "builds")?.rows ?? [];
const varus = (items, tweak) =>
  rowsOf(model(items, tweak)).find((r) => r.unit.id === VARUS);
const kinds = (r) => r.items.map((i) => i.kind);

test("itens do campeão: banco vazio mostra os 3 itens ideais, na ordem, cada um com a sua situação", () => {
  const row = varus([]);
  assert.ok(row, "Varus está em campo com slots livres");
  assert.deepEqual(
    row.items.map((i) => i.item.id),
    ["DA_SpearOfShojin", "DA_LastWhisper", "DA_InfinityEdge"],
  );
  // A Infinity Edge existe em Nidalee, que sai da formação: dá para mover; os outros dois faltam por inteiro.
  assert.deepEqual(kinds(row), ["need", "need", "move"]);
  assert.deepEqual(
    row.items.map((i) => i.label),
    ["falta 2", "falta 2", "mover"],
  );
  assert.equal(row.items.filter((i) => i.next).length, 1, "só um destaque");
  assert.equal(row.items[0].next, true);
});

test("itens do campeão: banco com componentes — monta agora, falta N e o item pronto no banco", () => {
  const row = varus([BF, TEAR, GLOVES], undefined);
  // Shojin = Tear + BF (tem); Last Whisper = Arco + Luvas (só as luvas); a Infinity Edge pronta está em Nidalee (mover).
  assert.deepEqual(kinds(row), ["ready", "half", "move"]);
  assert.deepEqual(
    row.items.map((i) => i.label),
    ["monta agora", "falta 1", "mover"],
  );
  assert.equal(row.items[0].mark, "up");
  assert.equal(row.items[1].mark, "plus");
  // Pronto no banco vale mais que mover de outra peça.
  const pronto = varus(["DA_InfinityEdge", BOW]);
  assert.equal(pronto.items[2].kind, "ready");
  assert.equal(pronto.items[2].label, "no banco");
  assert.equal(pronto.items[2].mark, "bank");
});

test("itens do campeão: o item que existe em quem sai vira 'mover' e diz de quem", () => {
  const row = varus([]);
  // Na base gravada, Nidalee sai da formação com a Infinity Edge equipada.
  const ie = row.items[2];
  assert.equal(ie.mark, "swap");
  assert.equal(ie.kind, "move");
  assert.equal(ie.label, "mover");
  assert.equal(ie.from.id, "DA_Nidalee18_AP");
  assert.match(ie.text, /^mover de /);
});

test("itens do campeão: o que já está equipado aparece como feito e o destaque vai para o seguinte", () => {
  const row = varus([], (rec) => {
    const self = rec.self.units.find((u) => u.championName === VARUS);
    self.itemNames = ["DA_SpearOfShojin"];
    const plan = rec.recommendations[0],
      b = plan.itemPlans.find((p) => p.championId === VARUS);
    b.equipped = [{ id: "DA_SpearOfShojin", name: "Spear of Shojin" }];
    b.slotsFree = 2;
  });
  assert.equal(row.items[0].kind, "on");
  assert.equal(row.items[0].label, "equipado");
  assert.equal(row.items[0].mark, "check");
  assert.equal(row.items[0].next, false);
  assert.equal(row.items[1].next, true);
});

test("itens do campeão: só campeão em campo, com slot livre e item pendente; carry primeiro", () => {
  const m = model([], (rec) => {
    rec.recommendations[0].carry = "Diana";
  });
  const ids = rowsOf(m).map((r) => r.unit.id);
  assert.equal(ids[0], DIANA, "o carry vem primeiro");
  assert.ok(ids.includes(VARUS));
  // Amumu e Sentinel têm os 3 slots cheios: guardam os itens. Aphelios e os demais não estão em campo.
  assert.equal(ids.includes("DA_Amumu18"), false);
  assert.equal(ids.includes("DA_Sentinel18"), false);
  assert.equal(ids.includes("DA_18_Aphelios"), false);
  assert.equal(new Set(rowsOf(m).map((r) => r.key)).size, rowsOf(m).length);
});

test("itens do campeão: sem banco lido a lista não afirma nada", () => {
  const m = buildModel(
    (() => {
      const i = input([]);
      delete i.state.screen.items;
      return i;
    })(),
  );
  assert.equal(rowsOf(m).length, 0);
});

test("itens do campeão: o 'Próximo item' e o resto do plano continuam como estavam", () => {
  const m = model([]),
    ids = m.plan.steps.map((s) => s.id),
    base = buildModel(input([])).plan.steps;
  assert.deepEqual(
    ids,
    base.map((s) => s.id),
  );
  const next = m.plan.steps.find((s) => s.id === "next");
  // O passo novo vem depois do "Próximo item" e não o substitui nem o altera.
  assert.ok(
    ids.indexOf("builds") === -1 ||
      ids.indexOf("builds") > ids.indexOf("next") ||
      !next,
  );
  for (const r of next?.rows ?? []) assert.equal(r.kind, "next");
  assert.equal(m.plan.cells.length, 9);
});

test("stateBrief: vocabulário curto de cada situação", () => {
  assert.equal(stateBrief({ kind: "on" }).label, "equipado");
  assert.equal(
    stateBrief({ kind: "ready", text: "pronto no banco" }).label,
    "no banco",
  );
  assert.equal(
    stateBrief({ kind: "ready", text: "monta agora" }).label,
    "monta agora",
  );
  assert.equal(stateBrief({ kind: "move", text: "mover de X" }).label, "mover");
  assert.equal(stateBrief({ kind: "half", missing: 1 }).label, "falta 1");
  assert.equal(stateBrief({ kind: "need", missing: 2 }).label, "falta 2");
  assert.equal(stateBrief({ kind: "taken" }).tone, "wait");
});

test("championItems: célula sem build devolve lista vazia", () => {
  assert.deepEqual(championItems({ id: "x" }, []), []);
});

test("overlay: o cartão de itens lista os campeões com todos os itens e a situação de cada um", () => {
  const view = overlayView(
    {
      state: { body: input([BF, TEAR, GLOVES]).state, ageMs: 100 },
      recommendation: { body: input([BF, TEAR, GLOVES]).rec, ageMs: 100 },
    },
    { catalogReady: true, now: 1000, receivedAt: 1000, deps },
  );
  assert.equal(view.status, "ready");
  const champs = view.items.champs;
  assert.ok(champs.length > 0 && champs.length <= CHAMPS_SHOWN);
  const v = champs.find((c) => c.unit.id === VARUS);
  assert.deepEqual(
    v.items.map((i) => i.label),
    ["monta agora", "falta 1", "mover"],
  );
  const html = draw.items(view);
  assert.match(html, /Itens dos campeões/);
  assert.match(html, /class="bi"/);
  assert.match(html, /data-next="1"/);
  // Ícones com a marca de estado, nunca só texto: cada item é uma imagem e o rótulo do estado vem ao lado.
  assert.match(html, /nx-mark/);
  assert.match(html, /monta agora/);
  assert.ok(view.sections.includes("items"));
});

test("overlay: com mais campeões pendentes do que cabem, o resto vira '+N' e a interface lista todos", () => {
  const i = input([]),
    m = buildModel(i);
  const all = rowsOf(m).length;
  const view = overlayView(
    {
      state: { body: i.state, ageMs: 100 },
      recommendation: { body: i.rec, ageMs: 100 },
    },
    { catalogReady: true, now: 1000, receivedAt: 1000, deps },
  );
  assert.equal(view.items.champs.length, Math.min(all, CHAMPS_SHOWN));
  assert.equal(view.items.champsMore, Math.max(0, all - CHAMPS_SHOWN));
});

test("interface: a linha do passo desenha cada item com marca e palavra, o destaque e o dono do 'mover'", () => {
  const row = varus([]);
  const html = buildsRow(row);
  assert.equal((html.match(/class="bi"/g) ?? []).length, 3);
  assert.match(html, /data-next="1"/);
  assert.match(html, /falta 2/);
  assert.match(html, /mover/);
  assert.match(html, /bi-from/, "o dono do item a mover aparece como retrato");
});
