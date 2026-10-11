// Rodar com: node --test tft/helper/tests/overlay-hints.test.mjs
// Dicas ancoradas do overlay (overlay/hud/hints.mjs) e os campos novos do modelo de tela (view.mjs: buy, wisps, economy,
// level, sources). Duas camadas: o modelo real (live-mock-base.json, no formato de /api/state e /api/recommend, com a loja
// cruzada por shop-match.js) e visões montadas à mão para isolar cada regra de categoria, prioridade e verbosidade.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { importsOf, read, stripNonCode } from "./architecture/scan.mjs";
import { buildModel } from "../v2/js/model.js";
import { planView } from "../v2/js/plan.js";
import { PART_STATE, nextItemRecipe } from "../v2/js/next-item.js";
import { buildStates } from "../v2/js/item-source.js";
import { wispsView } from "../v2/js/wisps.js";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { STALE_AFTER_MS, overlayView } from "../overlay/hud/view.mjs";
import {
  DEFAULT_HINT_SETTINGS,
  HINT_CATEGORIES,
  VERBOSITY_LEVELS,
  buildHints as buildHintsWith,
  filterHints,
  parseHintSettings,
} from "../overlay/hud/hints.mjs";

// Os geradores são testados na verbosidade normal (a do padrão antigo); o padrão do jogador agora é a mínima
// (overlay compacto) e tem teste próprio abaixo. Quem passa ajustes explícitos continua passando.
const NORMAL = Object.freeze({ verbosity: "normal" });
const buildHints = (view, settings = NORMAL) => buildHintsWith(view, settings);

const catalog = realCatalog();
const deps = {
  buildModel,
  planView,
  nextItemRecipe,
  partState: PART_STATE,
  buildStates,
  catalogItems: catalog.items,
};

const fromFile = (f) =>
  JSON.parse(fs.readFileSync(new URL(f, import.meta.url), "utf8"));
const BASE = fromFile("../live-mock-base.json");
const icons = fromFile("../assets-manifest.json");
// Catálogo de Wisps como /api/catalog entrega (wisps.json com a imagem do manifesto).
const wispCatalog = {
  wisps: fromFile("../wisps.json").wisps.map((w) => ({
    ...w,
    image: icons[w.iconKey] ?? null,
  })),
};
const SUN = "DA_SunfireCape";

/** Estado e análise ao vivo no formato real (mesma base de overlay-hud.test.mjs). */
function liveInput() {
  const state = structuredClone(BASE.state),
    rec = structuredClone(BASE.rec);
  state.screen = {
    running: true,
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
  const plan = rec.recommendations[0],
    stage = plan.stage.board;
  stage.find((u) => u.id === "DA_18_Diana").nextItem = {
    id: SUN,
    name: "Sunfire Cape",
    missing: ["Giant's Belt"],
  };
  stage.find((u) => u.id === "DA_Sentinel18").equipNow = [
    { id: "DA_BrambleVest", name: "Bramble Vest" },
  ];
  Object.assign(plan.strategy.panels.rolling, {
    go: true,
    spend: 30,
    shops: 6,
    keep: 24,
    call: {
      kind: "go",
      title: "Vale rolar",
      go: true,
      reason: "Chance boa de evoluir Aphelios.",
      budget: 30,
    },
  });
  rec.planProgress = {
    plan: {
      id: "m1",
      title: "Rapidfire · Aphelios",
      since: { stage: "2-3", level: 4 },
      pinned: false,
    },
    challenger: null,
    summary: { done: 3, total: 8, pct: 38 },
    next: [
      {
        kind: "unit",
        id: "DA_18_Aphelios",
        text: "Aphelios: 1→2★ (2/3 cópias)",
      },
    ],
    units: [
      {
        id: "DA_18_Aphelios",
        name: "Aphelios",
        cost: 4,
        carry: true,
        stars: 1,
        targetStars: 2,
        copies: 2,
        need: 3,
        status: "partial",
        where: "campo",
        lost: false,
        boughtUpTo: null,
      },
    ],
    items: [],
    augments: [],
    level: { status: "done", now: 8, target: 8 },
    gold: { status: "done", now: 54, interestAt: 60, floor: null },
    changes: [],
  };
  return { state, rec };
}

const planOf = (input) => input.rec.recommendations[0];
const card = (id, text) => ({ id, text });
/** Loja do jogo: Mama Beak (troca por Vi) no 1, Xayah (banco) no 2, Aphelios (vaga) em duas cópias nos espaços 4 e 5. */
const SHOP = [
  card("DA_CrimsonRaptor18", "Mama Beak"),
  card("DA_18_Xayah", "Xayah"),
  null,
  card("DA_18_Aphelios", "Aphelios"),
  card("DA_18_Aphelios", "Aphelios"),
];
/** Põe uma loja lida no estado: GEP ativo (confiável) ou leitura de tela (só provável). */
function withShop(input, cards = SHOP, source = "gep") {
  input.state.screen.shop = cards;
  input.state.screen.sources = { ...input.state.screen.sources, shop: source };
  if (source === "gep")
    input.state.gepStatus = { state: "ativo", lastEventAgeMs: 1000 };
  return input;
}

const feedOf = ({ state = null, rec = null }, ages = {}) => ({
  unchanged: false,
  rev: "1",
  state: state && { at: 0, ageMs: ages.state ?? 500, body: state },
  recommendation: rec && { at: 0, ageMs: ages.rec ?? 800, body: rec },
});
const viewOf = (feed, extra = {}) =>
  overlayView(feed, {
    catalogReady: true,
    now: 10_000,
    receivedAt: 10_000,
    deps,
    ...extra,
  });
const DETAILED = { verbosity: "detailed" };
const ids = (r) => r.hints.map((h) => h.id);
const byId = (r) => Object.fromEntries(r.hints.map((h) => [h.id, h]));

/* ---------- Modelo de tela: os campos novos ---------- */

test("view: buy traz as linhas Comprar já cruzadas com a loja de agora (espaços, confiança, troca)", () => {
  const v = viewOf(feedOf(withShop(liveInput())));
  assert.equal(v.status, "ready");
  // Quem está na loja sobe para o topo, na ordem do servidor; o resto vem depois.
  assert.deepEqual(
    v.buy.rows.map((r) => r.key),
    [
      "buy:DA_18_Aphelios",
      "buy:DA_CrimsonRaptor18",
      "buy:DA_18_Xayah",
      "buy:DA_Brambleback18",
      "buy:DA_18_Rakan",
    ],
  );
  const [aph, beak, xayah, bramble] = v.buy.rows;
  assert.deepEqual(aph.unit, { id: "DA_18_Aphelios", name: "Aphelios" });
  assert.equal(aph.how, "slot");
  assert.equal(aph.replaces, null);
  assert.equal(aph.broke, false);
  assert.equal(aph.want, 1);
  assert.equal(
    aph.reason,
    null,
    "o servidor não manda motivo nas linhas de compra",
  );
  assert.deepEqual(aph.shop.slots, [4, 5]);
  assert.equal(aph.shop.buy, 1);
  assert.equal(aph.shop.buyText, "comprar 1");
  assert.equal(aph.shop.probable, false);
  // O servidor manda `replaces` como nome; o modelo o entrega como { id, name }.
  assert.equal(beak.how, "replace");
  assert.deepEqual(beak.replaces, { id: null, name: "Vi" });
  assert.deepEqual(beak.shop.slots, [1]);
  assert.equal(xayah.how, "bank");
  assert.equal(bramble.shop, null, "fora da loja: sem cruzamento");
  assert.equal(v.buy.status.state, "hit");
  assert.equal(v.buy.status.text, "3 na loja agora");
  assert.match(v.buy.status.title, /confiável/);
});

test("view: economy e level vêm dos painéis do servidor; campos ausentes viram null", () => {
  const input = liveInput();
  planOf(input).strategy.panels.economy.pressure = "danger";
  Object.assign(planOf(input).strategy.panels.leveling, {
    go: true,
    cost: 20,
  });
  const v = viewOf(feedOf(input));
  assert.equal(v.economy.interest, 3);
  assert.equal(v.economy.next, 40);
  assert.equal(v.economy.keep, null);
  assert.equal(v.economy.after, null, "o mock não traz `after`");
  assert.equal(v.economy.pressure, "danger");
  assert.match(v.economy.text, /^Juros atuais/);
  assert.equal(v.level.level, 8);
  assert.equal(v.level.go, true);
  assert.equal(v.level.cost, 20);
  assert.equal(v.level.passive, false);
  assert.equal(v.level.finalLevel, 9);
  assert.equal(v.level.verdict, "não subir agora");
  assert.match(v.level.text, /^XP não lido/);
  delete planOf(input).strategy.panels.economy;
  delete planOf(input).strategy.panels.leveling;
  const bare = viewOf(feedOf(input));
  assert.equal(bare.economy, null);
  assert.equal(bare.level, null);
});

test("view: roll ganha o nível em que o servidor manda rolar (veredito 'esperar')", () => {
  const input = liveInput();
  Object.assign(planOf(input).strategy.panels.rolling, {
    go: false,
    spend: 0,
    call: {
      kind: "wait",
      title: "Espere o nível 9 para rolar",
      go: false,
      reason: "No nível 8 a loja quase não mostra o que a comp precisa.",
      budget: 0,
      at: { level: 9 },
    },
  });
  const v = viewOf(feedOf(input));
  assert.equal(v.roll.kind, "wait");
  assert.equal(v.roll.at, 9);
  assert.equal(v.roll.spend, null);
});

test("view: sources resume de onde vem cada leitura (GEP, leitor, loja, ouro, nível)", () => {
  const input = withShop(liveInput());
  input.state.screen.sources.gold = "gep";
  input.state.screen.sources.level = "screen";
  const v = viewOf(feedOf(input));
  assert.deepEqual(v.sources.gep, v.bar.gep);
  assert.equal(v.sources.gep.state, "ativo");
  assert.equal(v.sources.reader, null);
  assert.equal(v.sources.shopSource, "gep");
  assert.equal(v.sources.goldSource, "gep");
  assert.equal(v.sources.levelSource, "screen");
  input.state.screen.error = "leitor parou";
  assert.equal(viewOf(feedOf(input)).sources.reader, "leitor parou");
  // Sem plano (só o estado) a origem das leituras continua disponível; sem nada no cache não há o que resumir.
  const idle = viewOf(feedOf({ state: input.state }));
  assert.equal(idle.status, "idle");
  assert.equal(idle.sources.shopSource, "gep");
  assert.equal(viewOf(null).sources, null);
  assert.equal(viewOf(feedOf({})).sources, null);
});

test("view: wisps usam deps.wispsView/deps.catalog só ao vivo e toleram a ausência ou a falha deles", () => {
  const calls = [],
    list = [{ slot: 3, id: "W1", name: "Punguista", veredito: "comprar" }];
  const stub = (screen, opts) => (calls.push({ screen, opts }), list);
  const input = withShop(liveInput());
  const withWisps = { ...deps, wispsView: stub, catalog: wispCatalog };
  const v = viewOf(feedOf(input), { deps: withWisps });
  assert.deepEqual(v.wisps, list);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].screen, input.state.screen);
  assert.equal(calls[0].opts.catalog, wispCatalog);
  assert.equal(calls[0].opts.hero.gold, 54);
  assert.equal(
    calls[0].opts.roll.go,
    true,
    "o painel Roll do modelo: rolldown em andamento",
  );
  // Estado velho: nada vale como ao vivo, a função nem é chamada.
  const old = viewOf(feedOf(input, { state: STALE_AFTER_MS + 5_000 }), {
    deps: withWisps,
  });
  assert.deepEqual(old.wisps, []);
  assert.equal(calls.length, 1);
  // Sem a função injetada (versão antiga da página) ou com ela quebrada: lista vazia, a tela continua.
  assert.deepEqual(viewOf(feedOf(input)).wisps, []);
  const broken = viewOf(feedOf(input), {
    deps: {
      ...deps,
      wispsView() {
        throw new Error("dado estranho");
      },
    },
  });
  assert.deepEqual(broken.wisps, []);
  assert.equal(broken.status, "ready");
});

/* ---------- Dicas sobre o modelo real ---------- */

test("dicas: a compra fica ancorada nos espaços certos da loja (só as cópias que o plano manda comprar)", () => {
  const r = buildHints(viewOf(feedOf(withShop(liveInput()))));
  const h = byId(r);
  // Aphelios aparece em duas cópias (4 e 5), mas o plano quer 1: a âncora é só o primeiro espaço.
  const aph = h["buy:DA_18_Aphelios"];
  assert.equal(aph.category, "buy");
  assert.equal(aph.priority, 90);
  assert.equal(aph.tone, "go");
  assert.equal(aph.text, "Compre Aphelios");
  assert.deepEqual(aph.anchors, [{ kind: "shop", slot: 4 }]);
  assert.deepEqual(aph.anchor, { kind: "shop", slot: 4 });
  assert.equal(aph.action, "comprar 1");
  assert.match(aph.why, /^Aphelios está na loja agora/);
  assert.deepEqual(aph.icon, {
    kind: "champion",
    id: "DA_18_Aphelios",
    name: "Aphelios",
  });
  assert.equal(aph.pulse, true);
  assert.equal(aph.probable, false);
  assert.equal(aph.stale, false);
  assert.deepEqual(h["buy:DA_CrimsonRaptor18"].anchors, [
    { kind: "shop", slot: 1 },
  ]);
  assert.deepEqual(h["buy:DA_18_Xayah"].anchors, [{ kind: "shop", slot: 2 }]);
  assert.ok(!("buy:DA_Brambleback18" in h), "fora da loja: sem dica de compra");
  // Verbosidade normal: as três compras, o veredito de rolagem e o equipar, no máximo 5, por prioridade e id.
  assert.deepEqual(ids(r), [
    "buy:DA_18_Aphelios",
    "buy:DA_18_Xayah",
    "buy:DA_CrimsonRaptor18",
    "gold:roll",
    "equip:DA_Sentinel18",
  ]);
  // 11 de jogo (3 compras, rolagem, equipar, 2 passes, juros, 2 próximos itens e o selo do nível) + 2 textos de
  // "aprender" (categoria desligada); só conta como oculta a que o filtro de verbosidade cortou.
  assert.equal(r.total, 13);
  assert.equal(r.hidden, 6);
});

test("dicas: loja só provável (leitura de tela) sai tracejada; sem ouro vira âmbar, sem pulso", () => {
  const screenShop = buildHints(
    viewOf(feedOf(withShop(liveInput(), SHOP, "screen"))),
  );
  for (const h of screenShop.hints.filter((x) => x.category === "buy"))
    assert.equal(h.probable, true, h.id);
  const input = withShop(liveInput());
  planOf(input).stage.buyNow.find((u) => u.id === "DA_18_Aphelios").affordable =
    false;
  const broke = byId(buildHints(viewOf(feedOf(input))))["buy:DA_18_Aphelios"];
  assert.equal(broke.tone, "amber");
  assert.equal(broke.action, "sem ouro");
  assert.equal(broke.pulse, false);
  assert.deepEqual(broke.anchors, [{ kind: "shop", slot: 4 }]);
  assert.equal(broke.priority, 90);
});

test("dicas: itens do plano ficam ancorados no banco (equipar, passar, montar) e o veredito no ouro", () => {
  const r = buildHints(viewOf(feedOf(liveInput())), DETAILED);
  assert.deepEqual(ids(r), [
    "gold:roll",
    "equip:DA_Sentinel18",
    "move:DA_InfinityEdge>DA_18_Varus",
    "move:DA_SunfireCape>DA_18_Diana",
    "gold:interest",
    "next:DA_18_Diana",
    "next:DA_18_Varus",
    "level:seal",
  ]);
  assert.equal(r.hidden, 0);
  const h = byId(r);
  const roll = h["gold:roll"];
  assert.equal(roll.text, "Role até 30g");
  assert.equal(roll.action, "pare em 24g");
  assert.equal(roll.tone, "go");
  assert.deepEqual(roll.anchors, [{ kind: "gold" }]);
  assert.match(roll.why, /^Chance boa de evoluir Aphelios\./);
  const equip = h["equip:DA_Sentinel18"];
  assert.equal(equip.text, "Equipe Bramble Vest em Sentinel");
  assert.equal(equip.priority, 60);
  assert.deepEqual(equip.anchors, [{ kind: "bank" }]);
  assert.deepEqual(equip.icon, {
    kind: "item",
    id: "DA_BrambleVest",
    name: "Bramble Vest",
  });
  const move = h["move:DA_InfinityEdge>DA_18_Varus"];
  assert.equal(move.text, "Passe Infinity Edge de Nidalee para Varus");
  assert.equal(move.priority, 35, "ainda não dá para fazer agora");
  assert.equal(move.pulse, false);
  assert.equal(move.action, null);
  const next = h["next:DA_18_Diana"];
  assert.equal(next.text, "Monte Sunfire Cape em Diana");
  assert.equal(next.priority, 30, "a receita não fecha: falta um componente");
  assert.equal(next.action, "falta 1");
  assert.deepEqual(
    next.parts.map((p) => [p.name, p.state]),
    [
      ["Chain Vest", "bank"],
      ["Giant's Belt", "missing"],
    ],
  );
  assert.deepEqual(Object.keys(next.parts[0]).sort(), ["id", "name", "state"]);
  const interest = h["gold:interest"];
  assert.equal(interest.text, "Juros: +3g por rodada");
  assert.equal(interest.action, "próximo patamar em 40g");
  assert.equal(interest.pulse, false);
  // Verbosidade normal: as de prioridade menor que 40 saem.
  assert.deepEqual(ids(buildHints(viewOf(feedOf(liveInput())))), [
    "gold:roll",
    "equip:DA_Sentinel18",
    "gold:interest",
  ]);
});

test("dicas: veredito de esperar o nível, subir de nível e perigo de vida no modelo real", () => {
  const wait = liveInput();
  Object.assign(planOf(wait).strategy.panels.rolling, {
    go: false,
    spend: 0,
    call: {
      kind: "wait",
      title: "Espere o nível 9 para rolar",
      go: false,
      reason: "No nível 8 a loja quase não mostra o que a comp precisa.",
      budget: 0,
      at: { level: 9 },
    },
  });
  const w = byId(buildHints(viewOf(feedOf(wait)), DETAILED))["gold:wait"];
  assert.equal(w.text, "Vale esperar o nível 9");
  assert.deepEqual(w.anchors, [{ kind: "level" }]);
  assert.match(w.why, /^No nível 8/);

  const up = liveInput();
  Object.assign(planOf(up).strategy.panels.leveling, { go: true, cost: 20 });
  const u = byId(buildHints(viewOf(feedOf(up))))["level:up"];
  assert.equal(u.text, "Suba de nível");
  assert.equal(u.action, "20g");
  assert.equal(u.priority, 75);
  assert.equal(u.pulse, true);
  assert.deepEqual(u.anchors, [{ kind: "level" }]);

  const danger = liveInput();
  planOf(danger).strategy.panels.economy.pressure = "danger";
  Object.assign(planOf(danger).strategy.panels.rolling.call, {
    kind: "danger",
    title: "Role para estabilizar",
    reason: "Vida baixa: role para segurar o tabuleiro.",
  });
  const r = buildHints(viewOf(feedOf(danger)));
  const alert = r.hints[0];
  assert.equal(alert.id, "alert:hp");
  assert.equal(alert.category, "alert");
  assert.equal(alert.priority, 100);
  assert.equal(alert.tone, "danger");
  assert.equal(alert.text, "Vida em perigo (58 de vida)");
  assert.equal(alert.action, "Role para estabilizar");
  assert.equal(alert.why, "Vida baixa: role para segurar o tabuleiro.");
  assert.deepEqual(alert.anchors, [{ kind: "gold" }]);
  assert.equal(byId(r)["gold:roll"].tone, "danger");
});

test("dicas: Wisp real da loja ganha veredito e motivo do catálogo, ancorado no espaço dele", () => {
  const input = liveInput();
  input.state.screen.shop = [
    null,
    null,
    { id: null, text: "Punguista", wisp: true },
    null,
    null,
  ];
  input.state.screen.sources = { shop: "gep" };
  input.state.screen.wisps = [
    { slot: 3, id: "DA_Cutpurse18", name: "Punguista", known: true },
  ];
  input.state.gepStatus = { state: "ativo", lastEventAgeMs: 500 };
  const v = viewOf(feedOf(input), {
    deps: { ...deps, wispsView, catalog: wispCatalog },
  });
  assert.equal(v.wisps.length, 1);
  assert.equal(v.wisps[0].slot, 3);
  assert.equal(v.wisps[0].id, "DA_Cutpurse18");
  const h = buildHints(v, DETAILED).hints.find((x) => x.category === "wisp");
  assert.ok(h, "o Wisp vira dica");
  assert.match(h.text, /^Wisp Punguista: (comprar|avaliar|pular|incerto)$/);
  assert.deepEqual(h.anchors, [{ kind: "shop", slot: 3 }]);
  assert.equal(h.why, v.wisps[0].motivo.trim());
  assert.deepEqual(h.icon, {
    kind: "wisp",
    id: "DA_Cutpurse18",
    name: "Punguista",
  });
  assert.ok(
    !v.buy.rows.some((r) => r.shop),
    "Wisp nunca é campeão: nenhuma compra cruzada",
  );
});

/* ---------- Dicas sobre visões montadas à mão ---------- */

const BAR = {
  live: { kind: "live", text: "ao vivo" },
  hp: 58,
  gold: { value: 54, stale: false, interest: 0 },
  level: { text: "8", source: "tela", uncertain: false },
  xp: { text: "23/68", cost: null },
};
/** Visão pronta e ao vivo, sem nada para dizer; cada teste acrescenta só o campo que exercita. */
const viewWith = (over = {}) => ({
  status: "ready",
  dim: false,
  bar: BAR,
  roll: null,
  items: null,
  buy: null,
  wisps: [],
  economy: null,
  level: null,
  ...over,
});
const buyRow = (i, shop = {}, over = {}) => ({
  key: `buy:U${i}`,
  unit: { id: `U${i}`, name: `Unit ${i}` },
  how: "slot",
  replaces: null,
  broke: false,
  want: 1,
  reason: null,
  shop: {
    slots: [(i % 5) + 1],
    buy: 1,
    buyText: "comprar 1",
    probable: false,
    broke: false,
    title: `Unit ${i} está na loja agora.\nO plano quer 1.`,
    ...shop,
  },
  ...over,
});
const buyView = (n = 10, over = {}) =>
  viewWith({
    buy: { rows: Array.from({ length: n }, (_, i) => buyRow(i)), status: null },
    ...over,
  });
const rollOf = (over = {}) => ({
  tone: "go",
  pill: "rolar",
  kind: "go",
  title: "Vale rolar",
  reason: "Chance boa.",
  budget: 30,
  at: 8,
  spend: { gold: 30, shops: 6, keep: 24 },
  interest: null,
  ...over,
});

test("dicas: estado não pronto, partida não ao vivo ou entrada inválida não geram dica", () => {
  const empty = { hints: [], total: 0, hidden: 0 };
  for (const status of ["loading", "no-state", "waiting", "ended", "idle"])
    assert.deepEqual(buildHints(buyView(3, { status })), empty, status);
  for (const kind of ["snapshot", "waiting", "ended"])
    assert.deepEqual(
      buildHints(buyView(3, { bar: { ...BAR, live: { kind, text: kind } } })),
      empty,
      kind,
    );
  assert.deepEqual(buildHints(buyView(3, { bar: null })), empty);
  assert.deepEqual(buildHints(null), empty);
  assert.deepEqual(buildHints(undefined), empty);
  assert.deepEqual(buildHints("texto"), empty);
});

test("dicas: dado velho (dim) marca stale e tira o pulso de tudo", () => {
  const fresh = buildHints(buyView(2)).hints,
    old = buildHints(buyView(2, { dim: true })).hints;
  assert.ok(fresh.every((h) => h.pulse && !h.stale));
  assert.equal(old.length, 2);
  assert.ok(old.every((h) => !h.pulse && h.stale));
});

test("dicas: o contrato de uma dica (campos, âncora única = primeira, 'none' sem âncora)", () => {
  const [h] = buildHints(buyView(1)).hints;
  assert.deepEqual(Object.keys(h).sort(), [
    "action",
    "anchor",
    "anchors",
    "category",
    "icon",
    "id",
    "minVerbosity",
    "parts",
    "priority",
    "probable",
    "pulse",
    "short",
    "stale",
    "text",
    "tone",
    "why",
  ]);
  assert.equal(h.id, "buy:U0");
  assert.equal(
    h.why,
    "Unit 0 está na loja agora.",
    "primeira linha do título do cruzamento",
  );
  assert.equal(h.parts, null);
  assert.equal(h.minVerbosity, null);
  const noSlot = buildHints(
    viewWith({
      buy: { rows: [buyRow(0, { slots: [], buy: undefined })], status: null },
    }),
  ).hints[0];
  assert.deepEqual(noSlot.anchors, []);
  assert.deepEqual(noSlot.anchor, { kind: "none" });
});

test("dicas: compra com 'buy' ausente ancora todos os espaços; com 'buy' limita aos primeiros", () => {
  const rows = [
    buyRow(0, { slots: [2, 4, 5], buy: undefined }),
    buyRow(1, { slots: [1, 3], buy: 2 }),
    buyRow(2, { slots: [1, 3, 5], buy: 1 }),
  ];
  const h = byId(buildHints(viewWith({ buy: { rows, status: null } })));
  assert.deepEqual(
    h["buy:U0"].anchors.map((a) => a.slot),
    [2, 4, 5],
  );
  assert.deepEqual(
    h["buy:U1"].anchors.map((a) => a.slot),
    [1, 3],
  );
  assert.deepEqual(
    h["buy:U2"].anchors.map((a) => a.slot),
    [1],
  );
  assert.ok(h["buy:U0"].anchors.every((a) => a.kind === "shop"));
});

test("dicas: o motivo da compra é o do servidor quando existe; linha sem cruzamento não vira dica", () => {
  const rows = [
    buyRow(0, {}, { reason: "Carry do plano." }),
    buyRow(1, {}, { shop: null }),
    buyRow(2, { probable: true, title: "Provável: confira." }),
  ];
  const h = byId(buildHints(viewWith({ buy: { rows, status: null } })));
  assert.equal(h["buy:U0"].why, "Carry do plano.");
  assert.ok(!("buy:U1" in h));
  assert.equal(h["buy:U2"].probable, true);
  assert.equal(h["buy:U2"].why, "Provável: confira.");
});

test("dicas: Wisps por veredito (prioridade, tom, pulso); 'pular' só no modo detalhado", () => {
  const wisp = (slot, veredito, extra = {}) => ({
    slot,
    id: `W${slot}`,
    name: `Fogo${slot}`,
    veredito,
    vereditoTexto: veredito,
    motivo: `Motivo ${veredito}.`,
    ...extra,
  });
  const view = viewWith({
    wisps: [
      wisp(1, "comprar"),
      wisp(2, "avaliar"),
      wisp(3, "pular"),
      wisp(4, "incerto"),
      wisp(5, "algo-novo"),
    ],
  });
  const normal = byId(buildHints(view));
  assert.deepEqual(Object.keys(normal).sort(), [
    "wisp:1:W1",
    "wisp:2:W2",
    "wisp:4:W4",
    "wisp:5:W5",
  ]);
  const buy = normal["wisp:1:W1"];
  assert.equal(buy.text, "Wisp Fogo1: comprar");
  assert.equal(buy.priority, 80);
  assert.equal(buy.tone, "go");
  assert.equal(buy.pulse, true);
  assert.equal(buy.why, "Motivo comprar.");
  assert.deepEqual(buy.anchors, [{ kind: "shop", slot: 1 }]);
  assert.deepEqual(buy.icon, { kind: "wisp", id: "W1", name: "Fogo1" });
  assert.equal(normal["wisp:2:W2"].priority, 60);
  assert.equal(normal["wisp:2:W2"].tone, "amber");
  assert.equal(normal["wisp:4:W4"].priority, 40);
  assert.equal(
    normal["wisp:5:W5"].priority,
    40,
    "veredito desconhecido conta como incerto",
  );
  assert.equal(normal["wisp:5:W5"].tone, "info");
  const detailed = byId(buildHints(view, DETAILED));
  assert.equal(detailed["wisp:3:W3"].priority, 40);
  assert.equal(detailed["wisp:3:W3"].tone, "info");
  assert.equal(detailed["wisp:3:W3"].pulse, false);
  // Sem espaço conhecido a dica existe, só sem âncora geométrica.
  const loose = buildHints(
    viewWith({ wisps: [wisp(0, "comprar", { slot: null })] }),
  ).hints[0];
  assert.deepEqual(loose.anchor, { kind: "none" });
});

test("dicas: rolagem (rolar com juros, esperar o nível, não rolar) e juros passivos", () => {
  const go = buildHints(
    viewWith({
      roll: rollOf({ interest: { from: 3, to: 2 } }),
      economy: { next: 40, pressure: "healthy", text: null },
      bar: { ...BAR, gold: { ...BAR.gold, interest: 3 } },
    }),
  );
  const h = byId(go);
  assert.deepEqual(ids(go), ["gold:roll", "gold:interest"]);
  assert.equal(h["gold:roll"].text, "Role até 30g");
  assert.equal(h["gold:roll"].action, "pare em 24g");
  assert.equal(h["gold:roll"].priority, 70);
  assert.equal(h["gold:roll"].pulse, true);
  assert.deepEqual(h["gold:roll"].anchors, [{ kind: "gold" }]);
  assert.equal(
    h["gold:roll"].why,
    "Chance boa. Rolar derruba os juros de +3 para +2 por rodada.",
  );
  assert.equal(h["gold:interest"].priority, 30);
  assert.equal(h["gold:interest"].action, "próximo patamar em 40g");
  assert.equal(h["gold:interest"].pulse, false);
  // Minimal: só o que vale 70 ou mais; os juros passivos pedem verbosidade normal.
  assert.deepEqual(
    ids(
      buildHints(
        viewWith({
          roll: rollOf(),
          bar: { ...BAR, gold: { ...BAR.gold, interest: 3 } },
        }),
        { verbosity: "minimal" },
      ),
    ),
    ["gold:roll"],
  );
  // Sem juros (0 ou ausente) não há cartão de juros.
  assert.deepEqual(ids(buildHints(viewWith({ roll: rollOf() }))), [
    "gold:roll",
  ]);

  const wait = buildHints(
    viewWith({
      roll: rollOf({ kind: "wait", spend: null, at: 9, reason: "Espere." }),
    }),
  );
  assert.equal(wait.hints[0].id, "gold:wait");
  assert.equal(wait.hints[0].text, "Vale esperar o nível 9");
  assert.equal(wait.hints[0].why, "Espere.");
  assert.deepEqual(wait.hints[0].anchors, [{ kind: "level" }]);
  assert.equal(wait.hints[0].pulse, false);

  for (const kind of ["hold", "blocked", "none"]) {
    const hold = buildHints(
      viewWith({ roll: rollOf({ kind, spend: null, reason: "Guarde." }) }),
    );
    assert.equal(hold.hints[0].id, "gold:hold", kind);
    assert.equal(hold.hints[0].text, "Não role");
    assert.equal(hold.hints[0].priority, 40);
    assert.equal(hold.hints[0].why, "Guarde.");
  }
  // O piso do minimal (70) deixa o "não role" de fora; os vereditos sem ação (unknown, ended) não geram dica.
  assert.deepEqual(
    buildHints(viewWith({ roll: rollOf({ kind: "hold", spend: null }) }), {
      verbosity: "minimal",
    }).hints,
    [],
  );
  for (const kind of ["unknown", "ended", "go"])
    assert.deepEqual(
      buildHints(
        viewWith({ roll: rollOf({ kind, spend: null }) }),
        DETAILED,
      ).hints.filter(
        (x) => x.id.startsWith("gold:") && x.id !== "gold:interest",
      ),
      [],
      kind,
    );
});

test("dicas: subir de nível e o selo do nível (só no detalhado)", () => {
  const view = viewWith({
    level: {
      level: 8,
      go: true,
      cost: 20,
      passive: false,
      finalLevel: 9,
      verdict: "SUBIR AGORA · 20g",
      text: "Faltam 10 XP.",
    },
  });
  const normal = byId(buildHints(view));
  assert.deepEqual(Object.keys(normal), ["level:up"]);
  assert.equal(normal["level:up"].priority, 75);
  assert.equal(normal["level:up"].action, "20g");
  assert.equal(normal["level:up"].why, "Faltam 10 XP.");
  assert.deepEqual(normal["level:up"].anchors, [{ kind: "level" }]);
  assert.deepEqual(ids(buildHints(view, { verbosity: "minimal" })), [
    "level:up",
  ]);
  const detailed = byId(buildHints(view, DETAILED));
  assert.equal(detailed["level:seal"].text, "Nível 8 · XP 23/68");
  assert.equal(detailed["level:seal"].priority, 20);
  assert.equal(detailed["level:seal"].pulse, false);
  assert.deepEqual(detailed["level:seal"].anchors, [{ kind: "level" }]);
  // Nível sem XP lido e custo ausente: só o nível, sem ação.
  const bare = byId(
    buildHints(
      viewWith({
        bar: { ...BAR, xp: null },
        level: { level: 8, go: true, cost: null, text: null },
      }),
      DETAILED,
    ),
  );
  assert.equal(bare["level:seal"].text, "Nível 8");
  assert.equal(bare["level:up"].action, null);
});

test("dicas: itens ancorados no banco (passar agora ou depois, equipar, montar)", () => {
  const items = {
    moves: [
      {
        key: "move:U4",
        from: { id: "U4", name: "Nidalee", stars: 2 },
        now: true,
        method: "removedor",
        moves: [
          {
            item: { id: "I5", name: "Sunfire" },
            to: { id: "U5", name: "Ahri" },
          },
        ],
      },
      {
        key: "move:U6",
        from: { id: "U6", name: "Vi", stars: 2 },
        now: false,
        method: "",
        moves: [
          {
            item: { id: "I6", name: "Warmog" },
            to: { id: "U5", name: "Ahri" },
          },
        ],
      },
    ],
    equip: [
      {
        key: "equip:U2",
        kind: "equip",
        unit: { id: "U2", name: "Sentinel", stars: 1 },
        items: [
          { id: "I2", name: "Bramble Vest" },
          { id: "I3", name: "Warmog" },
        ],
        inField: true,
      },
      {
        key: "equip:U7",
        kind: "equip",
        unit: { id: "U7", name: "Reserva", stars: 1 },
        items: [{ id: "I2", name: "Bramble Vest" }],
        inField: false,
      },
      {
        key: "bank:I4:0",
        kind: "bank",
        item: { id: "I4", name: "Rabadon" },
        to: { id: "U3", name: "Ahri" },
        reason: "Cabe na build.",
        inField: true,
      },
      {
        key: "bank:I8:1",
        kind: "bank",
        item: { id: "I8", name: "Guardbreaker" },
        to: null,
        reason: "",
        inField: false,
      },
    ],
    next: [
      {
        key: "next:U1",
        unit: { id: "U1", name: "Diana", stars: 2 },
        item: { id: "I1", name: "Sunfire Cape" },
        base: null,
        complete: true,
        incomplete: false,
        note: "monta",
        parts: [
          {
            id: "P1",
            name: "Chain Vest",
            state: "bank",
            stateText: "no banco",
          },
          {
            id: "P2",
            name: "Giant's Belt",
            state: "bank",
            stateText: "no banco",
          },
        ],
      },
      {
        key: "next:U8",
        unit: { id: "U8", name: "Leona", stars: 1 },
        item: { id: "I9", name: "Redemption" },
        base: null,
        complete: false,
        incomplete: true,
        note: "falta 1",
        parts: [
          { id: "P3", name: "Tear", state: "missing", stateText: "falta" },
        ],
      },
    ],
  };
  const view = viewWith({ items });
  const normal = buildHints(view);
  assert.deepEqual(ids(normal), [
    "move:I5>U5",
    "equip:U2",
    "equip:U3:I4",
    "next:U1",
  ]);
  const h = byId(normal);
  assert.equal(h["move:I5>U5"].text, "Passe Sunfire de Nidalee para Ahri");
  assert.equal(h["move:I5>U5"].priority, 65);
  assert.equal(h["move:I5>U5"].tone, "go");
  assert.equal(h["move:I5>U5"].action, "passar agora");
  assert.equal(h["move:I5>U5"].pulse, true);
  assert.equal(h["move:I5>U5"].why, "removedor");
  assert.deepEqual(h["move:I5>U5"].anchors, [{ kind: "bank" }]);
  assert.deepEqual(h["move:I5>U5"].icon, {
    kind: "item",
    id: "I5",
    name: "Sunfire",
  });
  assert.equal(h["equip:U2"].text, "Equipe Bramble Vest, Warmog em Sentinel");
  assert.equal(h["equip:U2"].priority, 60);
  assert.equal(h["equip:U3:I4"].text, "Equipe Rabadon em Ahri");
  assert.equal(h["equip:U3:I4"].why, "Cabe na build.");
  assert.equal(h["next:U1"].text, "Monte Sunfire Cape em Diana");
  assert.equal(h["next:U1"].priority, 55);
  assert.equal(h["next:U1"].action, "monta");
  assert.equal(h["next:U1"].pulse, true);
  assert.deepEqual(h["next:U1"].parts, [
    { id: "P1", name: "Chain Vest", state: "bank" },
    { id: "P2", name: "Giant's Belt", state: "bank" },
  ]);
  // Fora do modo detalhado ficam de fora: passar depois (35) e montar com componente faltando (30).
  const detailed = byId(buildHints(view, DETAILED));
  assert.equal(detailed["move:I6>U5"].priority, 35);
  assert.equal(detailed["move:I6>U5"].pulse, false);
  assert.equal(detailed["next:U8"].priority, 30);
  assert.equal(detailed["next:U8"].pulse, false);
  assert.ok(
    !("equip:U7" in detailed),
    "peça fora de campo: não dá para equipar agora",
  );
  assert.ok(
    !normal.hints.some((x) => x.id === "equip:U8" || x.id.includes("I8")),
  );
});

test("dicas: alerta de perigo (crítico e perigo), âncora só com o veredito de estabilizar, nunca cortado", () => {
  const danger = buildHints(
    viewWith({
      economy: { pressure: "danger", text: null },
      roll: rollOf({
        kind: "danger",
        tone: "danger",
        title: "Role para estabilizar",
        reason: "Vida baixa.",
      }),
    }),
  ).hints[0];
  assert.equal(danger.id, "alert:hp");
  assert.equal(danger.text, "Vida em perigo (58 de vida)");
  assert.equal(danger.action, "Role para estabilizar");
  assert.equal(danger.why, "Vida baixa.");
  assert.deepEqual(danger.anchors, [{ kind: "gold" }]);
  const critical = buildHints(
    viewWith({ economy: { pressure: "critical" }, bar: { ...BAR, hp: null } }),
  ).hints[0];
  assert.equal(critical.text, "Vida crítica");
  assert.deepEqual(
    critical.anchors,
    [],
    "sem veredito de estabilizar: sem âncora",
  );
  assert.deepEqual(critical.anchor, { kind: "none" });
  assert.equal(critical.action, null);
  for (const pressure of ["healthy", "hurt", null, undefined])
    assert.deepEqual(
      buildHints(viewWith({ economy: { pressure } })).hints,
      [],
      String(pressure),
    );

  // Nunca cortado: nem pelo teto da verbosidade nem por categorias desligadas.
  const crowded = buyView(10, { economy: { pressure: "critical" } });
  const minimal = buildHints(crowded, { verbosity: "minimal" });
  assert.deepEqual(
    ids(minimal),
    ["alert:hp", "buy:U0", "buy:U1"],
    "o alerta conta no teto de 3",
  );
  const allOff = buildHints(crowded, {
    verbosity: "minimal",
    categories: {
      buy: false,
      items: false,
      gold: false,
      wisp: false,
      learn: false,
    },
  });
  assert.deepEqual(ids(allOff), ["alert:hp"]);
  assert.equal(allOff.hidden, 0, "categoria desligada não conta como oculta");
  // Tentar desligar "alert" nos ajustes não tem efeito.
  assert.deepEqual(
    ids(buildHints(crowded, { categories: { alert: false, buy: false } })),
    ["alert:hp"],
  );
});

test("dicas: filtros por categoria; 'aprender' vem desligada e, ligada, ignora o piso de prioridade", () => {
  const view = viewWith({
    buy: { rows: [buyRow(0)], status: null },
    roll: rollOf({ text: "Este é o nível de rolagem da comp." }),
    items: {
      moves: [],
      equip: [
        {
          key: "e",
          kind: "equip",
          unit: { id: "U2", name: "Sentinel" },
          items: [{ id: "I2", name: "Bramble Vest" }],
          inField: true,
        },
      ],
      next: [],
    },
    wisps: [
      {
        slot: 2,
        id: "W2",
        name: "Fogo",
        veredito: "comprar",
        vereditoTexto: "comprar",
        motivo: "Bom.",
      },
    ],
    economy: {
      pressure: "healthy",
      text: "Juros atuais: +3g por rodada.",
      next: 40,
    },
    level: { level: 8, go: false, cost: null, text: "Faltam 10 XP." },
    bar: { ...BAR, level: null },
  });
  const cats = (settings) =>
    [
      ...new Set(buildHints(view, settings).hints.map((h) => h.category)),
    ].sort();
  assert.deepEqual(
    cats(),
    ["buy", "gold", "items", "wisp"],
    "padrão: 'aprender' desligada",
  );
  for (const off of ["buy", "items", "gold", "wisp"]) {
    const got = cats({ verbosity: "normal", categories: { [off]: false } });
    assert.ok(!got.includes(off), off);
    assert.equal(got.length, 3, `desligar ${off} não desliga as outras`);
  }
  const learn = buildHints(view, {
    verbosity: "minimal",
    categories: { learn: true },
  });
  assert.deepEqual(
    learn.hints.filter((h) => h.category === "learn").map((h) => h.id),
    [],
    "minimal: o teto de 3 já foi tomado pelas dicas de prioridade alta",
  );
  const onlyLearn = buildHints(view, {
    verbosity: "minimal",
    categories: {
      buy: false,
      items: false,
      gold: false,
      wisp: false,
      learn: true,
    },
  });
  assert.deepEqual(ids(onlyLearn), [
    "learn:economy",
    "learn:level",
    "learn:roll",
  ]);
  const l = byId(onlyLearn);
  assert.equal(l["learn:economy"].text, "Juros atuais: +3g por rodada.");
  assert.equal(l["learn:economy"].why, null);
  assert.equal(l["learn:economy"].priority, 20);
  assert.deepEqual(l["learn:economy"].anchors, [{ kind: "gold" }]);
  assert.deepEqual(l["learn:level"].anchors, [{ kind: "level" }]);
  assert.deepEqual(l["learn:roll"].anchors, [{ kind: "gold" }]);
  assert.equal(onlyLearn.hidden, 0);
});

test("dicas: verbosidade fixa o piso e o teto (minimal 3, normal 5, detailed 8); total e hidden", () => {
  const view = buyView(10, {
    economy: { pressure: "healthy", text: "Texto." },
  });
  const run = (verbosity) => buildHints(view, { verbosity });
  const min = run("minimal"),
    norm = run("normal"),
    det = run("detailed");
  assert.deepEqual(ids(min), ["buy:U0", "buy:U1", "buy:U2"]);
  assert.equal(norm.hints.length, 5);
  assert.equal(det.hints.length, 8);
  assert.deepEqual(
    ids(det),
    Array.from({ length: 8 }, (_, i) => `buy:U${i}`),
  );
  // A visão tem nível na barra, então há também o selo passivo `level:seal` (categoria gold, só no modo detalhado): ele
  // entra no total e no que a verbosidade deixa de fora (o teto de 8 do detalhado é todo de compras, de prioridade maior).
  for (const r of [min, norm, det])
    assert.equal(
      r.total,
      12,
      "10 compras + 1 texto de 'aprender' + o selo de nível",
    );
  assert.deepEqual([min.hidden, norm.hidden, det.hidden], [8, 6, 3]);
  assert.equal(
    det.hints.some((h) => h.id === "level:seal"),
    false,
  );
  // Sem ajustes, ajustes inválidos ou verbosidade desconhecida: o padrão (mínima, overlay compacto).
  for (const bad of [undefined, null, 7, "detailed", { verbosity: "ultra" }])
    assert.equal(
      buildHintsWith(view, bad).hints.length,
      min.hints.length,
      JSON.stringify(bad),
    );
  // Piso de prioridade: com poucas dicas, minimal só deixa passar o que vale 70 ou mais e normal, 40 ou mais.
  const mixed = viewWith({
    roll: rollOf({ kind: "hold", spend: null }),
    level: { level: 8, go: true, cost: 20, text: null },
    bar: { ...BAR, gold: { ...BAR.gold, interest: 3 } },
  });
  assert.deepEqual(ids(buildHints(mixed, { verbosity: "minimal" })), [
    "level:up",
  ]);
  assert.deepEqual(ids(buildHints(mixed, { verbosity: "normal" })), [
    "level:up",
    "gold:hold",
    "gold:interest",
  ]);
  assert.deepEqual(ids(buildHints(mixed, DETAILED)), [
    "level:up",
    "gold:hold",
    "gold:interest",
    "level:seal",
  ]);
});

test("dicas: ordem estável por prioridade e id, ids sem repetição e entrada nunca alterada", () => {
  const view = buyView(6, {
    wisps: [
      {
        slot: 1,
        id: "W1",
        name: "Fogo",
        veredito: "avaliar",
        vereditoTexto: "avaliar",
        motivo: "Talvez.",
      },
    ],
    roll: rollOf(),
  });
  const snapshot = JSON.stringify(view);
  const a = buildHints(view, DETAILED),
    b = buildHints(view, DETAILED);
  assert.deepEqual(a, b, "mesma entrada, mesma saída (ids estáveis)");
  assert.equal(JSON.stringify(view), snapshot, "a visão não é alterada");
  const expected = [...a.hints].sort(
    (x, y) => y.priority - x.priority || (x.id < y.id ? -1 : 1),
  );
  assert.deepEqual(
    ids(a),
    expected.map((h) => h.id),
  );
  assert.equal(new Set(ids(a)).size, a.hints.length);
  // filterHints ordena e filtra qualquer lista, na ordem que vier.
  const shuffled = [...a.hints].reverse();
  assert.deepEqual(ids({ hints: filterHints(shuffled, DETAILED) }), ids(a));
  assert.deepEqual(filterHints(undefined), []);
  assert.deepEqual(filterHints([null, 3, "x"], DETAILED), []);
  // Duas linhas do mesmo campeão viram uma só dica (id repetido: vale a primeira).
  const dup = buildHints(
    viewWith({
      buy: { rows: [buyRow(0), buyRow(0, { slots: [5] })], status: null },
    }),
  );
  // O selo de nível (`level:seal`) também é gerado, mas só aparece no modo detalhado: a compra é a única dica à mostra.
  assert.equal(dup.total, 2);
  assert.deepEqual(ids(dup), ["buy:U0"]);
  assert.equal(dup.hints.filter((h) => h.id === "buy:U0").length, 1);
  assert.deepEqual(dup.hints[0].anchors, [{ kind: "shop", slot: 1 }]);
});

test("dicas: dado estranho do servidor nunca derruba a geração (o gerador problemático só se cala)", () => {
  const weird = viewWith({
    buy: { rows: [null], status: null },
    wisps: [null],
    items: { moves: [{ moves: [null] }], equip: [], next: [] },
  });
  assert.doesNotThrow(() => buildHints(weird, DETAILED));
  const ok = buildHints({
    ...weird,
    buy: buyView(1).buy,
    wisps: [],
    items: null,
  });
  assert.deepEqual(ids(ok), ["buy:U0"]);
});

/* ---------- Ajustes ---------- */

test("parseHintSettings: padrão completo, lixo vira padrão, sempre um objeto novo", () => {
  assert.deepEqual(DEFAULT_HINT_SETTINGS, {
    categories: {
      buy: true,
      items: true,
      gold: true,
      wisp: true,
      learn: false,
    },
    // Overlay compacto: o padrão é a verbosidade mínima; o jogador aumenta no "?".
    verbosity: "minimal",
  });
  assert.deepEqual(HINT_CATEGORIES, ["buy", "items", "gold", "wisp", "learn"]);
  assert.deepEqual(VERBOSITY_LEVELS, ["minimal", "normal", "detailed"]);
  assert.ok(
    Object.isFrozen(DEFAULT_HINT_SETTINGS) &&
      Object.isFrozen(DEFAULT_HINT_SETTINGS.categories),
  );
  for (const junk of [
    undefined,
    null,
    42,
    "texto",
    true,
    [],
    () => 1,
    { categories: 5 },
    { categories: [], verbosity: [] },
  ]) {
    const parsed = parseHintSettings(junk);
    assert.deepEqual(parsed, DEFAULT_HINT_SETTINGS, String(junk));
    assert.notEqual(parsed, DEFAULT_HINT_SETTINGS);
    assert.notEqual(parsed.categories, DEFAULT_HINT_SETTINGS.categories);
  }
  const mutated = parseHintSettings(null);
  mutated.categories.buy = false;
  assert.equal(
    parseHintSettings(null).categories.buy,
    true,
    "mexer no resultado não contamina o padrão",
  );
});

test("parseHintSettings: aproveita o que é válido, descarta o resto e não deixa desligar 'alert'", () => {
  const parsed = parseHintSettings({
    categories: {
      buy: false,
      items: "sim",
      gold: 0,
      wisp: null,
      learn: true,
      alert: false,
      extra: true,
    },
    verbosity: "detailed",
    outro: 1,
  });
  assert.deepEqual(parsed, {
    categories: {
      buy: false,
      items: true,
      gold: true,
      wisp: true,
      learn: true,
    },
    verbosity: "detailed",
  });
  assert.deepEqual(Object.keys(parsed.categories), HINT_CATEGORIES);
  assert.equal(parseHintSettings({ verbosity: "ultra" }).verbosity, "minimal");
  assert.equal(
    parseHintSettings({ verbosity: "minimal" }).verbosity,
    "minimal",
  );
  // Idempotente: um resultado válido reentra igual.
  assert.deepEqual(parseHintSettings(parsed), parsed);
});

/* ---------- Fronteira do módulo ---------- */

test("hints.mjs: puro (sem imports, sem node:*, sem DOM, sem relógio) e sem regras de jogo", () => {
  assert.deepEqual(importsOf("overlay/hud/hints.mjs"), []);
  const code = stripNonCode(read("overlay/hud/hints.mjs"));
  assert.ok(
    !/\b(?:document|window|globalThis|localStorage|fetch|process)\b/.test(code),
  );
  assert.ok(!/\bDate\.now\b|\bnew Date\b|\bMath\.random\b/.test(code));
  assert.deepEqual(importsOf("overlay/hud/view.mjs"), []);
});

test("dicas: peça do plano que você já tem (2★) na loja também gera 'Compre', com o que a cópia fecha", () => {
  const input = withShop(liveInput(), [
    null,
    null,
    card("DA_18_Varus", "Varus"),
    null,
    card("DA_Sentinel18", "Sentinel"),
  ]);
  const v = viewOf(feedOf(input)),
    copy = v.buy.rows.find((r) => r.unit.id === "DA_18_Varus");
  assert.equal(copy.how, "copy");
  assert.match(copy.copy.text, /cópia · sobe para 3★/);
  const h = byId(buildHints(v));
  assert.equal(h["buy:DA_18_Varus"].category, "buy");
  assert.deepEqual(h["buy:DA_18_Varus"].anchors, [{ kind: "shop", slot: 3 }]);
  assert.match(h["buy:DA_18_Varus"].text, /Compre .*\(cópia · sobe para 3★/);
  assert.equal(h["buy:DA_18_Varus"].pulse, true);
  assert.deepEqual(h["buy:DA_Sentinel18"].anchors, [{ kind: "shop", slot: 5 }]);
  // Peça nova segue sem rótulo de cópia.
  const nova = byId(buildHints(viewOf(feedOf(withShop(liveInput())))));
  assert.equal(nova["buy:DA_18_Aphelios"].text.includes("cópia"), false);
});
