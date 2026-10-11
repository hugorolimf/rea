// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// Carrossel na interface: o cartão do overlay (modelo de tela e HTML) e a trilha "Carrossel" do Ao vivo, a partir do bloco
// `carousel` que o servidor põe em /api/state. Parte da captura real de `live-mock-base.json` e das peças que o GEP gravou.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { carouselView } from "../app/carousel-view.mjs";
import { parseCarouselPieces } from "../gep-reader.mjs";
import { buildModel } from "../v2/js/model.js";
import { planView } from "../v2/js/plan.js";
import { PART_STATE, nextItemRecipe } from "../v2/js/next-item.js";
import { buildStates } from "../v2/js/item-source.js";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { CAROUSEL_SHOWN, overlayView } from "../overlay/hud/view.mjs";
import {
  DEFAULT_LAYOUT,
  ELEMENT_IDS,
  ELEMENT_LABELS,
  ELEMENT_PRIORITY,
  parseLayout,
} from "../overlay/hud/layout.mjs";

// A interface lê matchMedia e CSS no import; o Node não os tem.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const glyphs = await import("../v2/js/ui/glyphs.js");
const rich = await import("../v2/js/ui/rich-text.js");
const { esc } = await import("../v2/js/dom.js");
const { createDraw } = await import("../overlay/hud/draw.mjs");

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
  catalog,
};

const BASE = JSON.parse(
  fs.readFileSync(new URL("../live-mock-base.json", import.meta.url), "utf8"),
);
const GAME = "3291205051";

/** As 9 peças de um carrossel 2-4 como o GEP as grava (componentes). */
const PIECES = JSON.stringify({
  slot_1: {
    name: "DA_18_MasterYi_AD",
    item_1: "DA_Component_RecurveBow",
    item_2: "",
  },
  slot_2: {
    name: "DA_18_Varus",
    item_1: "DA_Component_NegatronCloak",
    item_2: "",
  },
  slot_3: { name: "DA_Gromp18_AP", item_1: "DA_Component_Spatula", item_2: "" },
  slot_4: {
    name: "DA_18_Veigar",
    item_1: "DA_Component_NeedlesslyLargeRod",
    item_2: "",
  },
  slot_5: {
    name: "DA_18_Aphelios",
    item_1: "DA_Component_BFSword",
    item_2: "",
  },
  slot_6: {
    name: "DA_18_Alistar",
    item_1: "DA_Component_ChainVest",
    item_2: "",
  },
  slot_7: {
    name: "DA_18_Elise",
    item_1: "DA_Component_SparringGloves",
    item_2: "",
  },
  slot_8: {
    name: "DA_18_Yorick",
    item_1: "DA_Component_ChainVest",
    item_2: "",
  },
  slot_9: {
    name: "DA_18_Rammus",
    item_1: "DA_Component_FryingPan",
    item_2: "",
  },
});
const slots = parseCarouselPieces(PIECES).slots;

/** Estado ao vivo (formato real) com o bloco do carrossel como o servidor o monta, e a análise. */
function input({ offer = true, phaseKind = "draft", ageSeconds = 3 } = {}) {
  const state = structuredClone(BASE.state),
    rec = structuredClone(BASE.rec);
  state.seen = {
    stage: "2-4",
    gold: 30,
    level: 5,
    xp: "2/10",
    items: ["DA_Component_ChainVest"],
  };
  Object.assign(state, {
    actionable: true,
    sameGame: true,
    phase: "InProgress",
    ageSeconds,
  });
  rec.metadata.actionable = true;
  rec.metadata.gameId = GAME;
  rec.self.health = 80;
  state.gameId = GAME;
  state.carousel = carouselView(
    {
      stage: "2-4",
      phaseKind,
      items: state.seen.items,
      ...(offer && { carouselOffer: { stage: "2-4", slots, ageMs: 1200 } }),
    },
    { rec, gameId: GAME },
  );
  return { state, rec };
}
const feedOf = ({ state = null, rec = null }, ages = {}) => ({
  unchanged: false,
  rev: "1",
  state: state && { at: 0, ageMs: ages.state ?? 500, body: state },
  recommendation: rec && { at: 0, ageMs: ages.rec ?? 800, body: rec },
});
const viewOf = (feed) =>
  overlayView(feed, {
    catalogReady: true,
    now: 10_000,
    receivedAt: 10_000,
    deps,
  });

/* ---------- Overlay: modelo de tela ---------- */

test("overlay: no carrossel lido, o cartão traz as peças em ordem de valor, com os nomes do catálogo e o selo 'lido'", () => {
  const v = viewOf(feedOf(input()));
  assert.equal(v.status, "ready");
  assert.equal(v.sections[0], "carousel", "o carrossel é o primeiro cartão");
  const c = v.carousel;
  assert.equal(c.from, "reading");
  assert.equal(c.stage, "2-4");
  assert.equal(c.source, "game-log");
  assert.equal(c.total, 9);
  assert.equal(c.picks.length, CAROUSEL_SHOWN, "cabem 5 no cartão");
  assert.equal(c.more, 9 - CAROUSEL_SHOWN);
  assert.deepEqual(
    c.picks.map((p) => p.rank),
    [1, 2, 3, 4, 5],
  );
  for (const p of c.picks) {
    assert.ok(
      p.champion?.id && p.champion.name,
      "campeão com nome do catálogo",
    );
    assert.ok(p.item.id && p.item.name, "item com nome do catálogo");
    assert.ok(p.reason.length > 0);
  }
  const scores = c.picks.map((p) => p.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  );
});

test("overlay: sem leitura do carrossel o cartão diz 'prioridade' e traz componentes sem campeão", () => {
  const v = viewOf(feedOf(input({ offer: false })));
  const c = v.carousel;
  assert.equal(c.from, "priority");
  assert.match(c.note, /não foi lido/);
  assert.ok(c.picks.length >= 1);
  for (const p of c.picks) {
    assert.equal(p.champion, null);
    assert.ok(p.item.id.startsWith("DA_Component_"));
  }
  // O alvo (item que o componente fecha ou começa) e para quem, para a linha mostrar a imagem do plano.
  assert.ok(c.picks.some((p) => p.target?.id && p.forChampion?.id));
});

test("overlay: fora do carrossel, com a leitura velha ou sem partida ativa, não há cartão", () => {
  assert.equal(viewOf(feedOf(input({ phaseKind: "planning" }))).carousel, null);
  assert.equal(
    viewOf(feedOf(input(), { state: 130_000 })).carousel,
    null,
    "leitura do estado velha",
  );
  const { state, rec } = input();
  delete state.carousel;
  assert.equal(
    viewOf(feedOf({ state, rec })).carousel,
    null,
    "servidor antigo, sem o bloco",
  );
  const ended = input();
  ended.state.match = { status: "ended", id: GAME, placement: 3 };
  assert.equal(viewOf(feedOf(ended)).carousel, null);
  const waiting = input();
  waiting.state.match = { status: "live", id: GAME, boardReady: false };
  assert.equal(viewOf(feedOf(waiting)).carousel, null);
});

test("overlay: o carrossel aparece mesmo sem análise (estado vazio): só a nota, sem peças inventadas", () => {
  const { state } = input({ offer: false });
  state.carousel = carouselView(
    { stage: "2-4", phaseKind: "draft" },
    { rec: null, gameId: GAME },
  );
  const v = viewOf(feedOf({ state }));
  assert.equal(v.carousel.picks.length, 0);
  assert.match(v.carousel.note, /Sem análise/);
  assert.equal(v.carousel.from, null);
  assert.equal(draw.carousel(v).includes("<ul"), false);
  assert.match(draw.carousel(v), /Sem análise/);
});

test("overlay: bloco malformado do servidor não derruba a tela", () => {
  const { state, rec } = input();
  state.carousel = {
    active: true,
    picks: [null, { itemId: 5 }, "x"],
    from: "outra",
  };
  const v = viewOf(feedOf({ state, rec }));
  assert.equal(v.carousel.from, null);
  assert.equal(v.carousel.picks.length, 3);
  assert.doesNotThrow(() => draw.carousel(v));
  state.carousel = { active: true };
  assert.equal(viewOf(feedOf({ state, rec })).carousel.picks.length, 0);
});

/* ---------- Overlay: HTML ---------- */

test("overlay: o HTML mostra campeões e itens como imagens (nunca o nome sozinho) e o selo certo", () => {
  const read = draw.carousel(viewOf(feedOf(input())));
  assert.match(read, /class="eyebrow">Carrossel</);
  assert.match(read, /data-tone="go"[^>]*>lido do jogo</);
  assert.equal(
    (read.match(/class="line car-row"/g) ?? []).length,
    CAROUSEL_SHOWN,
  );
  assert.equal(
    (read.match(/class="pt pt-item/g) ?? []).length >= CAROUSEL_SHOWN,
    true,
    "ícone de item em cada linha",
  );
  assert.ok(
    (read.match(/class="mini"/g) ?? []).length >= CAROUSEL_SHOWN,
    "retrato do campeão da peça",
  );
  assert.match(read, /\+4 peças/);
  assert.match(read, /data-first="1"/);
  // Nenhum nome fora de atributo ou de texto de leitor de tela: tirando tags e atributos, só sobra o rótulo e o contador.
  const visible = read
    .replace(/<b class="sr">[^<]*<\/b>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/→/g, "")
    .replace(/\s+/g, " ")
    .trim();
  assert.match(visible, /^Carrossel lido do jogo( \d)+ \+4 peças$/);

  const prio = draw.carousel(viewOf(feedOf(input({ offer: false }))));
  assert.match(prio, /data-tone="amber"[^>]*>prioridade</);
  assert.match(prio, /car-target/, "o item que o componente fecha ou começa");
  assert.equal(draw.carousel({ carousel: null }), "");
});

test("overlay: o HTML escapa o motivo vindo do servidor", () => {
  const { state, rec } = input();
  state.carousel.picks[0].reason = '"><img src=x onerror=alert(1)>';
  const html = draw.carousel(viewOf(feedOf({ state, rec })));
  assert.equal(html.includes("<img src=x"), false);
  assert.match(html, /&quot;&gt;&lt;img/);
});

/* ---------- Overlay: elemento posicionável ---------- */

test("overlay: o carrossel é um elemento do layout, com rótulo, prioridade logo abaixo da barra e padrão visível", () => {
  assert.ok(ELEMENT_IDS.includes("carousel"));
  assert.equal(typeof ELEMENT_LABELS.carousel, "string");
  assert.ok(ELEMENT_PRIORITY.carousel > ELEMENT_PRIORITY.bar);
  assert.ok(ELEMENT_PRIORITY.carousel < ELEMENT_PRIORITY.roll);
  assert.equal(DEFAULT_LAYOUT.carousel.hidden, false);
  // Layout salvo antes do carrossel (sem a chave) continua válido e ganha o padrão.
  const old = parseLayout({ bar: { x: 0.5, y: 0.1, w: 0.2 } });
  assert.deepEqual(old.carousel, { ...DEFAULT_LAYOUT.carousel });
  assert.equal(old.bar.x, 0.5);
});

/* ---------- Interface web: trilha Carrossel ---------- */

test("web: carrossel aberto vira a trilha 'Carrossel agora' (urgente) com as peças lidas; fora dele fica a sugestão do plano", () => {
  const live = input();
  const model = buildModel({ state: live.state, rec: live.rec });
  const step = model.plan.steps.find((s) => s.id === "carousel");
  assert.equal(step.title, "Carrossel agora");
  assert.equal(step.tone, "go");
  assert.equal(step.note.state, "now");
  assert.equal(step.rows.length, 9);
  const first = step.rows[0];
  assert.ok(first.slotChampion?.id, "a peça lida traz o campeão a pegar");
  assert.ok(first.item.id.startsWith("DA_"));
  assert.equal(first.rank, 1);
  // Sem leitura: lista de prioridade, dita como tal.
  const prio = input({ offer: false });
  const pm = buildModel({ state: prio.state, rec: prio.rec });
  const ps = pm.plan.steps.find((s) => s.id === "carousel");
  assert.equal(ps.note.state, "priority");
  assert.match(ps.note.text, /não lido/);
  assert.equal(ps.rows[0].slotChampion, null);
  // Fora do carrossel: o que o plano sugere pegar, como antes (sem selo e sem urgência).
  const out = input({ phaseKind: "planning" });
  const om = buildModel({ state: out.state, rec: out.rec });
  const os = om.plan.steps.find((s) => s.id === "carousel");
  assert.equal(os.title, "Carrossel");
  assert.equal(os.tone, "gold");
  assert.equal(os.note, undefined);
  assert.equal(
    os.rows.length,
    (out.rec.recommendations[0].carousel ?? []).length,
  );
});
