// Rodar com: node --test tft/helper/tests/overlay-comp.test.mjs
// Painel da comp do overlay (overlay/hud/comp.mjs) e os atalhos dele (hotkeys.mjs, main.mjs, preload.cjs): a comp do plano
// e as sugeridas da mesma análise, onde está cada peça, quem joga no lugar de quem (modelo por vaga ou, sem ele, as trocas),
// a peça do plano na loja, as builds de "Builds e 3★" e as sinergias. Nada aqui abre o Electron, o jogo ou o servidor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { read, stripNonCode } from "./architecture/scan.mjs";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { buildModel } from "../v2/js/model.js";
import { planView } from "../v2/js/plan.js";
import { PART_STATE, nextItemRecipe } from "../v2/js/next-item.js";
import { buildStates } from "../v2/js/item-source.js";
import { compOwnership, ownership } from "../v2/js/roster.js";
import { compBuildRows } from "../core/items/builds.mjs";
import { overlayView } from "../overlay/hud/view.mjs";
import {
  COMP_ACTIONS,
  SLOT_KINDS,
  buyText,
  compPanelHtml,
  compPanelStep,
  compsOf,
  resolveIndex,
  slotModelOf,
  subText,
} from "../overlay/hud/comp.mjs";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  shortcutList,
} from "../overlay/hud/hotkeys.mjs";
import { keysHtml, teamCodeState } from "../overlay/hud/keys.mjs";
import { DEFAULT_LAYOUT, ELEMENT_IDS } from "../overlay/hud/layout.mjs";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const catalog = realCatalog();
const deps = {
  buildModel,
  planView,
  nextItemRecipe,
  partState: PART_STATE,
  buildStates,
  catalogItems: catalog.items,
  catalog,
  compsOf,
  ownership,
  compOwnership,
  compBuildRows,
};
const BASE = JSON.parse(
  fs.readFileSync(new URL("../live-mock-base.json", import.meta.url), "utf8"),
);

/** Partida ao vivo no formato real (a mesma base do overlay-hud.test). */
function liveInput(mutate = () => {}) {
  const state = structuredClone(BASE.state),
    rec = structuredClone(BASE.rec);
  state.seen = {
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: ["DA_Component_ChainVest"],
  };
  Object.assign(state, {
    actionable: true,
    sameGame: true,
    phase: "InProgress",
    ageSeconds: 3,
  });
  rec.metadata.actionable = true;
  rec.self.health = 58;
  mutate({ state, rec });
  return { state, rec };
}
const viewOf = ({ state, rec }, d = deps) =>
  overlayView(
    {
      unchanged: false,
      rev: "1",
      state: { at: 0, ageMs: 500, body: state },
      recommendation: { at: 0, ageMs: 800, body: rec },
    },
    { catalogReady: true, now: 10_000, receivedAt: 10_000, deps: d },
  );

/** Retratos e itens simples: o nome só no title (o teste confere que nenhum nome aparece fora de atributos). */
const ui = {
  esc,
  glyph: (n) => `<svg data-g="${n}"></svg>`,
  portrait: (id, name, o = {}) =>
    `<span class="pt" data-id="${esc(id)}" data-size="${o.size ?? 0}" title="${esc(name)}"></span>`,
  itemPortrait: (i) =>
    `<span class="pt pt-item" data-id="${esc(i.id)}" title="${esc(i.name)}"></span>`,
  richText: (t) => `<span class="rt">${esc(t)}</span>`,
  stars: (n) => "★".repeat(n),
  traitIcon: () => null,
};
const visible = (html) =>
  html
    .replace(/<b class="sr">[\s\S]*?<\/b>/g, " ")
    .replace(/<span class="rt">[\s\S]*?<\/span>/g, " ")
    .replace(/<[^>]*>/g, " ");

/* ---------- Atalhos ---------- */

test("atalhos da comp: na lista única, teclas livres (Ctrl+Shift+F3/F4/F5), registrados pelo main e entregues à página", () => {
  assert.equal(DEFAULT_HOTKEYS.compPanel, "Control+Shift+F5");
  assert.equal(DEFAULT_HOTKEYS.compPrev, "Control+Shift+F3");
  assert.equal(DEFAULT_HOTKEYS.compNext, "Control+Shift+F4");
  const keys = Object.values(DEFAULT_HOTKEYS);
  assert.equal(new Set(keys).size, keys.length, "nenhuma tecla repetida");
  for (const id of ["compPanel", "compPrev", "compNext"]) {
    const a = HOTKEY_ACTIONS.find((x) => x.id === id);
    assert.ok(a && a.label.length > 10 && a.icon.length <= 2, id);
  }
  // O main liga cada atalho a uma ação do painel; a ponte só deixa passar as ações conhecidas.
  const main = stripNonCode(read("overlay/main.mjs"), { keepStrings: true });
  assert.match(main, /compPanel: \(\) => requestComp\("toggle"\)/);
  assert.match(main, /compPrev: \(\) => requestComp\("prev"\)/);
  assert.match(main, /compNext: \(\) => requestComp\("next"\)/);
  assert.match(main, /webContents\.send\(\s*"overlay:compPanel"/);
  const preload = read("overlay/preload.cjs");
  assert.match(preload, /onCompPanel\(cb\)/);
  assert.match(
    preload,
    /const COMP_ACTIONS = new Set\(\["toggle", "show", "prev", "next"\]\)/,
  );
  assert.deepEqual([...COMP_ACTIONS], ["toggle", "show", "prev", "next"]);
  const hud = stripNonCode(read("overlay/hud/hud.mjs"), { keepStrings: true });
  assert.match(hud, /host\.onCompPanel\?\.\(onCompAction\)/);
  // A legenda lista os três com rótulo (verbosidade normal).
  const html = keysHtml({
    shortcuts: shortcutList(DEFAULT_HOTKEYS, {}),
    copy: teamCodeState(null),
    esc,
  });
  for (const label of ["Ver comp", "Comp anterior", "Próxima comp"])
    assert.ok(html.includes(`>${label}</span>`), label);
});

test("painel da comp: elemento posicionável que começa vazio; não é região quente (não captura o mouse fora da edição)", () => {
  assert.ok(ELEMENT_IDS.includes("comp"));
  assert.equal(DEFAULT_LAYOUT.comp.hidden, false);
  const code = read("overlay/hud/comp.mjs");
  assert.ok(!/data-hot|data-hit/.test(code), "nada clicável no painel");
  assert.equal(compPanelHtml({ open: false }, ui), "", "fechado: vazio, some");
});

/* ---------- Modelo ---------- */

test("comps: a do plano primeiro e as sugeridas da mesma análise, com peças, onde estão, builds e sinergias", () => {
  const v = viewOf(liveInput());
  assert.equal(v.status, "ready");
  const comps = v.comps;
  assert.equal(comps.length, 3);
  assert.deepEqual(
    comps.map((c) => c.label),
    ["Plano", "Sugerida 1", "Sugerida 2"],
  );
  assert.equal(comps[0].title, BASE.rec.recommendations[0].title);
  const plan = comps[0];
  // O carry primeiro, com a coroa; a seguir por custo.
  assert.equal(plan.units[0].name, BASE.rec.recommendations[0].carry);
  assert.equal(plan.units[0].carry, true);
  // Onde está cada peça (roster.js): Amumu em campo, 2★.
  const amumu = plan.units.find((u) => u.id === "DA_Amumu18");
  assert.equal(amumu.where, "field");
  assert.equal(amumu.stars, 2);
  // Builds de "Builds e 3★" (o motor único): as da comp de meta, carry primeiro.
  assert.ok(plan.builds.length >= 3);
  assert.equal(plan.builds[0].id, "DA_18_Aphelios");
  assert.deepEqual(
    plan.builds[0].items.map((i) => i.id),
    BASE.rec.recommendations[0].meta.builds.DA_18_Aphelios,
  );
  // Sinergias ativas, a maior contagem primeiro.
  assert.ok(plan.traits.length >= 2);
  assert.ok(plan.traits[0].count >= plan.traits[1].count);
  // Sem o modelo por vaga: as trocas propostas do plano (transitions) viram substituição temporária.
  assert.equal(plan.subsFrom, "fallback");
  const aph = plan.units.find((u) => u.id === "DA_18_Aphelios");
  assert.equal(aph.sub.kind, "temporario");
  assert.equal(aph.sub.playing.name, "Nidalee");
  assert.equal(
    subText(aph.sub),
    "Nidalee 2★ no lugar de Aphelios (temporário: volta quando Aphelios chegar a 2★)",
  );
  assert.equal(aph.shown, "field", "a casa mostra quem a ocupa (em campo)");
  // Sem estrela que alcance: "sem volta prevista" e o motivo do servidor à parte.
  const rakan = plan.units.find((u) => u.id === "DA_18_Rakan");
  assert.match(
    subText(rakan.sub),
    /^Vi 2★ no lugar de Rakan \(temporário: sem volta prevista\)\. Não troque/,
  );
  // Sem `compsOf` injetado, nenhuma comp (a página sempre injeta).
  assert.deepEqual(
    viewOf(liveInput(), { ...deps, compsOf: undefined }).comps,
    [],
  );
});

test("comps: troca aceita (autoSwaps) vira 'troca da comp' e a peça do plano na loja ganha o selo de compra", () => {
  const v = viewOf(
    liveInput(({ rec }) => {
      // A comp trocou Xayah por Varus (Varus está no tabuleiro do plano no lugar dela).
      const plan = rec.recommendations[0];
      const xayah = plan.board.find((u) => u.id === "DA_18_Xayah");
      if (xayah) Object.assign(xayah, { id: "DA_18_Varus2", name: "Varus" });
      rec.autoSwaps = [{ out: "DA_18_Xayah", in: "DA_18_Varus2" }];
    }),
  );
  const swapped = v.comps[0].units.find((u) => u.id === "DA_18_Varus2");
  assert.ok(swapped, "peça trocada no plano");
  assert.equal(swapped.sub.kind, "troca-da-comp");
  assert.match(subText(swapped.sub), /^troca da comp: Varus no lugar de /);
  // Loja: o modelo cruza "Comprar" com a loja (steps "buy" com `shop`); a casa ganha moeda + custo e a dica.
  const model = {
    roster: null,
    status: { swaps: [] },
    plan: {
      steps: [
        {
          id: "buy",
          rows: [
            {
              unit: { id: "DA_18_Aphelios", name: "Aphelios", cost: 4 },
              shop: { slots: [3] },
            },
          ],
        },
      ],
    },
  };
  const comps = compsOf({ model, rec: liveInput().rec, deps });
  const aph = comps[0].units.find((u) => u.id === "DA_18_Aphelios");
  assert.deepEqual(aph.buy, { cost: 4, slot: 3, id: "DA_18_Aphelios" });
  assert.match(
    aph.title,
    /na sua loja \(slot 3\): compre para a vaga de Aphelios/,
  );
  assert.equal(buyText(null, "X"), "na sua loja: compre para a vaga de X");
});

/** Modelo por vaga no formato pedido ao tft-substitutos (exemplo), dentro de `stage.slots`. */
const SLOT_EXAMPLE = [
  {
    slot: 0,
    unit: { id: "DA_18_Aphelios", name: "Aphelios" },
    original: {
      id: "DA_18_Aphelios",
      name: "Aphelios",
      stars: 1,
      have: "reserva",
    },
    playing: { id: "DA_18_Varus", name: "Varus", stars: 2, source: "campo" },
    kind: "temporario",
    why: "Varus 2★ supera Aphelios 1★",
    until: {
      kind: "estrela",
      stars: 2,
      text: "volta quando Aphelios chegar a 2★ (faltam 2 cópias)",
    },
  },
  {
    slot: 1,
    unit: { id: "DA_Amumu18", name: "Amumu" },
    original: { id: "DA_Amumu18", name: "Amumu", stars: 2, have: "campo" },
    playing: { id: "DA_Amumu18", name: "Amumu", stars: 2, source: "campo" },
    kind: "titular",
    why: "em campo",
    until: null,
  },
  {
    slot: 2,
    unit: { id: "DA_Brambleback18", name: "Brambleback" },
    original: {
      id: "DA_Brambleback18",
      name: "Brambleback",
      stars: 0,
      have: "falta",
    },
    playing: {
      id: "DA_18_Rakan",
      name: "Rakan",
      stars: 1,
      source: "loja",
      buy: { cost: 1, slot: 4 },
    },
    kind: "temporario",
    why: "vaga vazia: Rakan da loja segura",
    until: null,
  },
  // Lixo não derruba: tipo desconhecido e vaga sem original ficam de fora.
  { slot: 3, original: { id: "X" }, kind: "outro" },
  { slot: 4, original: null, playing: { id: "Y" }, kind: "temporario" },
];

test("modelo por vaga: lido de stage.slots quando existe (original × quem joga, ⇄, loja com slot e custo)", () => {
  const model = slotModelOf({ stage: { slots: SLOT_EXAMPLE } }, {});
  assert.equal(model.length, 3);
  assert.ok(model.every((s) => SLOT_KINDS.includes(s.kind)));
  assert.equal(
    slotModelOf({}, {}),
    null,
    "sem o modelo: null (vale o que já existe)",
  );
  const v = viewOf(
    liveInput(({ rec }) => {
      rec.recommendations[0].stage.slots = SLOT_EXAMPLE;
    }),
  );
  const plan = v.comps[0];
  assert.equal(plan.subsFrom, "slots");
  const aph = plan.units.find((u) => u.id === "DA_18_Aphelios");
  assert.equal(aph.sub.kind, "temporario");
  assert.equal(aph.sub.playing.id, "DA_18_Varus");
  assert.equal(
    subText(aph.sub),
    "Varus 2★ no lugar de Aphelios (temporário: volta quando Aphelios chegar a 2★ (faltam 2 cópias))",
  );
  const amumu = plan.units.find((u) => u.id === "DA_Amumu18");
  assert.equal(amumu.sub, null, "titular: a original em jogo fica como sempre");
  const bramble = plan.units.find((u) => u.id === "DA_Brambleback18");
  assert.equal(bramble.sub.playing.source, "loja");
  assert.deepEqual(bramble.buy, { cost: 1, slot: 4, id: "DA_18_Rakan" });
  assert.match(
    bramble.title,
    /na sua loja \(slot 4\): compre para a vaga de Brambleback/,
  );
  // Desenho: retrato de quem joga em destaque, a original pequena no canto (cor do custo) e o selo ⇄; selo de compra.
  const html = compPanelHtml(
    {
      open: true,
      comp: plan,
      index: 0,
      total: 3,
      keys: { toggle: "F5", prev: "F3", next: "F4" },
    },
    ui,
  );
  const li = html.match(
    /<li class="cp-u"[^>]*data-sub="temporario"[^>]*>[\s\S]*?<\/li>/,
  )[0];
  assert.match(
    li,
    /<span class="cp-pt"[^>]*><span class="pt" data-id="DA_18_Varus" data-size="34"/,
  );
  assert.match(
    li,
    /<span class="cp-orig" style="--ring-c:var\(--cost-4\)"><span class="pt" data-id="DA_18_Aphelios" data-size="16"/,
  );
  assert.match(li, /<i class="cp-swap" aria-hidden="true">⇄<\/i>/);
  assert.match(
    html,
    /data-shop="1"[^>]*>[\s\S]*?<b class="cp-buy" aria-hidden="true"><svg data-g="coin"><\/svg>1<\/b>/,
  );
  assert.match(html, /⇄ no lugar de/);
  assert.match(html, /<kbd>F3<\/kbd>◂/);
});

test("painel: imagens no lugar de nomes, carry, estrelas, builds e sinergias; estados sem comp", () => {
  const v = viewOf(liveInput());
  const html = compPanelHtml(
    { open: true, comp: v.comps[0], index: 0, total: v.comps.length, keys: {} },
    ui,
  );
  assert.match(html, /<span class="eyebrow">Plano<\/span>/);
  assert.match(html, /1\/3/);
  assert.match(html, /<h3 class="eyebrow">Builds e 3★<\/h3>/);
  assert.match(html, /<h3 class="eyebrow">Sinergias<\/h3>/);
  assert.match(html, /cp-crown/);
  assert.match(html, /data-where="field"/);
  // Nenhum nome de campeão ou de item fora de atributos e do texto de leitor de tela.
  const text = visible(html);
  for (const u of v.comps[0].units)
    assert.ok(!text.includes(u.name), `${u.name} em texto`);
  for (const b of v.comps[0].builds)
    for (const i of b.items) assert.ok(!text.includes(i.name), i.name);
  // Texto do servidor escapado.
  const evil = { ...v.comps[0], label: "<b>x</b>", units: [] };
  assert.ok(
    !compPanelHtml({ open: true, comp: evil }, ui).includes("<b>x</b>"),
  );
  // Sem comp: o motivo.
  assert.match(
    compPanelHtml({ open: true, comp: null, status: "ready" }, ui),
    /sem comp: aguardando análise/,
  );
  assert.match(
    compPanelHtml({ open: true, comp: null, status: "ended" }, ui),
    /partida encerrada/,
  );
});

test("alternar: toggle/show/prev/next em círculo, sem fixar nada; a comp exibida segue pela chave", () => {
  const comps = [{ key: "a" }, { key: "b" }, { key: "c" }];
  let s = { open: false, index: 0, key: null };
  s = compPanelStep(s, "next", comps);
  assert.deepEqual(
    s,
    { open: true, index: 0, key: "a" },
    "fechado: next só abre",
  );
  s = compPanelStep(s, "next", comps);
  assert.deepEqual([s.index, s.key], [1, "b"]);
  s = compPanelStep(s, "prev", comps);
  s = compPanelStep(s, "prev", comps);
  assert.deepEqual([s.index, s.key], [2, "c"], "volta em círculo");
  s = compPanelStep(s, "toggle", comps);
  assert.equal(s.open, false);
  s = compPanelStep(s, "show", comps);
  assert.deepEqual(s, { open: true, index: 2, key: "c" });
  // A lista mudou de ordem na próxima análise: continua a mesma comp.
  assert.equal(resolveIndex(s, [{ key: "c" }, { key: "a" }]), 0);
  // A comp sumiu: índice limitado à lista.
  assert.equal(resolveIndex({ index: 5, key: "z" }, comps), 2);
  assert.equal(resolveIndex(s, []), 0);
  // Nada vai ao servidor: o módulo não faz pedidos.
  const code = stripNonCode(read("overlay/hud/comp.mjs"), {
    keepStrings: true,
  });
  assert.ok(!/fetch\(|\/api\//.test(code));
});
