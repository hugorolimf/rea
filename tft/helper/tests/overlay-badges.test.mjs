// Rodar com: node --test tft/helper/tests/overlay-badges.test.mjs
// Selos sobre o próprio HUD do jogo (overlay/hud/badges.mjs): o veredito de rolagem no botão "Atualizar" (com os alvos,
// por quem rolar), o de nível no "Comprar XP", o ouro a guardar ao lado do ouro e "achou" na carta da loja; os botões
// [ESTIMADO] de geometry.mjs; o bloco "Entra e sai" (swaps.mjs, no overlay, nunca sobre o tabuleiro ou a reserva do jogo),
// a compra de substituto marcada na loja e o "Montar agora" do bloco de itens; e a tela padrão sem a faixa de estado, as
// dicas e o cartão de rolagem.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { read, stripNonCode } from "./architecture/scan.mjs";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { buildModel } from "../v2/js/model.js";
import { planView } from "../v2/js/plan.js";
import { PART_STATE, nextItemRecipe } from "../v2/js/next-item.js";
import { buildStates } from "../v2/js/item-source.js";
import { starCopies } from "../core/pool/copies.mjs";
import { POLICY } from "../core/economy/policy.mjs";
import { interestOf } from "../core/economy/gold.mjs";
import { overlayView } from "../overlay/hud/view.mjs";
import { buildHints } from "../overlay/hud/hints.mjs";
import {
  BADGE_ANCHORS,
  badgesHelpHtml,
  buildBadges,
  curveStageFor,
  drawBadges,
  foundBadges,
  goldBadge,
  levelBadge,
  placeBadges,
  rollBadge,
} from "../overlay/hud/badges.mjs";
import {
  SWAPS_SHOWN,
  swapRows,
  swapsHtml,
  tempBuys,
} from "../overlay/hud/swaps.mjs";
import {
  SHOP_BUTTONS,
  anchorRects,
  placeLabel,
  resolveAnchor,
} from "../overlay/hud/geometry.mjs";
import { calibrationShapes } from "../overlay/hud/calibrate.mjs";
import {
  DEFAULT_LAYOUT,
  ELEMENT_IDS,
  setHidden,
} from "../overlay/hud/layout.mjs";
import { createDraw } from "../overlay/hud/draw.mjs";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const ui = {
  esc,
  glyph: (n) => `<svg data-g="${n}"></svg>`,
  portrait: (id, name, o = {}) =>
    `<span class="pt" data-id="${esc(id)}" data-size="${o.size ?? 0}" title="${esc(name)}"></span>`,
  richText: (t) => `<span class="rt">${esc(t)}</span>`,
};
const catalog = realCatalog();
const deps = {
  buildModel,
  planView,
  nextItemRecipe,
  partState: PART_STATE,
  buildStates,
  catalogItems: catalog.items,
  starCopies,
  swapRows,
  tempBuys,
};
const BASE = JSON.parse(
  fs.readFileSync(new URL("../live-mock-base.json", import.meta.url), "utf8"),
);
function liveInput(mutate = () => {}) {
  const state = structuredClone(BASE.state),
    rec = structuredClone(BASE.rec);
  state.seen = { stage: "4-2", gold: 54, level: 8, xp: "23/68", items: [] };
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
const viewOf = ({ state, rec }) =>
  overlayView(
    {
      unchanged: false,
      rev: "1",
      state: { at: 0, ageMs: 500, body: state },
      recommendation: { at: 0, ageMs: 800, body: rec },
    },
    { catalogReady: true, now: 10_000, receivedAt: 10_000, deps },
  );
const STAGE = { width: 1920, height: 1080 };

/* ---------- Geometria [ESTIMADO] ---------- */

test("geometria: botões Comprar XP (em cima) e Atualizar (embaixo) à esquerda da 1ª carta, na faixa y 0,86-0,97", () => {
  const r = anchorRects(STAGE);
  assert.ok(r.xpButton.y + r.xpButton.height <= r.rerollButton.y + 0.5);
  assert.ok(r.rerollButton.x + r.rerollButton.width <= r.shopCards[0].x);
  for (const b of [r.xpButton, r.rerollButton]) {
    assert.ok(b.y >= 0.86 * 1080 - 1 && b.y + b.height <= 0.97 * 1080 + 1);
  }
  assert.deepEqual(resolveAnchor({ kind: "xpButton" }, r), r.xpButton);
  assert.deepEqual(resolveAnchor({ kind: "reroll" }, r), r.rerollButton);
  // A calibração global move os botões com o resto.
  const moved = anchorRects(STAGE, { dx: 0.01, dy: 0, scale: 1 });
  assert.equal(
    Math.round(moved.xpButton.x - r.xpButton.x),
    Math.round(0.01 * 1920),
  );
  assert.equal(SHOP_BUTTONS.xp.x, SHOP_BUTTONS.reroll.x);
  // A grade da calibração desenha os dois botões; nada de reserva nem de tabuleiro (as trocas ficam num bloco do overlay).
  const shapes = calibrationShapes(r);
  assert.equal(shapes.filter((x) => x.kind === "button").length, 2);
  assert.ok(!("benchSlots" in r) && !("boardCells" in r));
});

/* ---------- Selos ---------- */

test("selo de rolagem: texto e cor de cada veredito no botão Atualizar", () => {
  const go = {
    kind: "go",
    spend: { gold: 30, shops: 15, keep: 24 },
    title: "Vale rolar",
    reason: "Chance boa.",
  };
  assert.deepEqual(
    [rollBadge(go).text, rollBadge(go).tone],
    ["↻ role 15 vezes", "go"],
  );
  assert.match(
    rollBadge(go).why,
    /Vale rolar · Chance boa\. · role 15 vezes \(30g\) · pare em 24g/,
  );
  assert.equal(rollBadge({ kind: "hold" }).text, "↻ não role");
  assert.equal(rollBadge({ kind: "wait", at: 8 }).text, "↻ espere o nível 8");
  assert.equal(rollBadge({ kind: "danger", budget: 12 }).tone, "danger");
  assert.equal(
    rollBadge({ kind: "danger", budget: 12 }).text,
    "↻ role 6 vezes",
  );
  assert.equal(rollBadge({ kind: "blocked" }).text, "↻ sem peça viável");
  // Sem lista de alvos, a peça buscada e a chance dela embaixo ("3★ Kayle 38%").
  const main = rollBadge({
    ...go,
    main: { id: "K", name: "Kayle", stars: 3 },
    mainChance: 0.38,
  });
  assert.equal(main.sub, "3★ Kayle 38%");
  assert.equal(rollBadge(null), null);
});

test("selo de rolagem: por quem rolar (call.targets, formato do tft-rolagem): retratos com a estrela, orçamento e a dica de cada alvo", () => {
  const targets = [
    {
      id: "DA_Kayle",
      name: "Kayle",
      goal: 3,
      have: 4,
      chance: 0.38,
      rivals: 2,
      why: "carry",
    },
    {
      id: "DA_18_Azir",
      name: "Azir",
      goal: 2,
      have: 2,
      chance: 0.71,
      rivals: 0,
    },
  ];
  const v = viewOf(
    liveInput(({ rec }) => {
      const ro = rec.recommendations[0].strategy.panels.rolling;
      Object.assign(ro, {
        go: true,
        spend: 30,
        shops: 15,
        keep: 24,
        call: {
          kind: "go",
          title: "Vale rolar",
          go: true,
          reason: "Chance boa.",
          budget: 30,
          targets,
        },
      });
    }),
  );
  assert.deepEqual(
    v.roll.targets.map((t) => [t.id, t.goal, t.have, t.need]),
    [
      ["DA_Kayle", 3, 4, 9],
      ["DA_18_Azir", 2, 2, 3],
    ],
  );
  const b = rollBadge(v.roll);
  assert.equal(b.text, "↻ Kayle 3★ Azir 2★ role 15 vezes");
  assert.match(b.why, /Kayle 3★, 38% com 30g, 4\/9 cópias, 2 rivais, carry/);
  assert.match(b.why, /Azir 2★, 71% com 30g, 2\/3 cópias, 0 rivais/);
  const html = drawBadges(
    [{ ...b, x: 10, y: 20, side: "left", anchor: { kind: "reroll" } }],
    ui,
  );
  assert.match(
    html,
    /<span class="badge-t" data-first="1"[^>]*><span class="pt" data-id="DA_Kayle" data-size="22"/,
  );
  assert.match(
    html,
    /<span class="badge-t" data-first="0"[^>]*><span class="pt" data-id="DA_18_Azir" data-size="18"/,
  );
  assert.match(html, /<i class="badge-st">3★<\/i>/);
  assert.match(html, / role 15 vezes<\/b>/);
  // Carta de um alvo na loja: "achou: Kayle" ancorado no cartão da loja.
  const found = foundBadges({
    kind: "go",
    found: [{ id: "DA_Kayle", name: "Kayle", slots: [2] }],
  });
  assert.deepEqual(
    found.map((f) => [f.text, f.anchor]),
    [["achou: Kayle", { kind: "shop", slot: 2 }]],
  );
  assert.deepEqual(
    foundBadges({ kind: "hold", found: [{ id: "a", slots: [1] }] }),
    [],
    "só quando rola",
  );
});

test("selo de rolagem: sem call.targets usa a lista de rolagem que já existe (rolling.targets de roll.mjs)", () => {
  const v = viewOf(
    liveInput(({ rec }) => {
      const ro = rec.recommendations[0].strategy.panels.rolling;
      Object.assign(ro, {
        go: true,
        spend: 20,
        shops: 10,
        call: {
          kind: "go",
          title: "Vale rolar",
          go: true,
          reason: "x",
          budget: 20,
        },
        targets: [
          {
            id: "DA_18_Diana",
            name: "Diana",
            goalStars: 3,
            own: 5,
            goal: 9,
            chance: 0.2,
            enemy: 1,
            status: "ok",
            whyText: "evolui o tanque",
          },
          {
            id: "DA_X",
            name: "X",
            goalStars: 2,
            own: 0,
            goal: 3,
            chance: 0,
            enemy: 0,
            status: "inviavel",
          },
        ],
        shop: [{ id: "DA_18_Diana", name: "Diana", slots: [4] }],
      });
    }),
  );
  assert.deepEqual(
    v.roll.targets.map((t) => [t.id, t.goal, t.have, t.need, t.rivals]),
    [["DA_18_Diana", 3, 5, 9, 1]],
  );
  assert.deepEqual(v.roll.found, [
    { id: "DA_18_Diana", name: "Diana", slots: [4] },
  ]);
  assert.equal(rollBadge(v.roll).text, "↻ Diana 3★ role 10 vezes");
});

test("selo de nível: 'suba agora' com o custo, ou 'espere 4-1' pela curva padrão", () => {
  assert.deepEqual(curveStageFor(6, POLICY.curve), {
    stage: 4,
    round: 1,
    text: "4-1",
  });
  assert.equal(curveStageFor(9, POLICY.curve), null);
  assert.deepEqual(
    [
      levelBadge({ level: 7, go: true, cost: 4 }).text,
      levelBadge({ level: 7, go: true, cost: 4 }).tone,
    ],
    ["↑ suba agora · 4g", "go"],
  );
  const wait = levelBadge(
    { level: 6, go: false, cost: 8, finalLevel: 9, text: "Faltam 8 XP." },
    { stage: { stage: 3, round: 5 }, curve: POLICY.curve },
  );
  assert.equal(wait.text, "↑ espere 4-1 · 8g");
  assert.match(wait.why, /Na curva padrão o nível 7 vem em 4-1/);
  assert.equal(
    levelBadge({ level: 9, finalLevel: 9, go: false }).text,
    "↑ não suba",
  );
  assert.equal(levelBadge(null), null);
});

test("selo do ouro: o piso a guardar, verde no piso ou acima e âmbar abaixo; o motivo na dica", () => {
  const ok = goldBadge(
    { keep: 50, pressure: "healthy" },
    { gold: 54, interestOf },
  );
  assert.deepEqual([ok.text, ok.tone], ["⚑ 50g", "go"]);
  assert.match(ok.why, /^juros: 50g dá \+5/);
  const low = goldBadge(
    { floor: 10, keep: null, pressure: "danger" },
    { gold: 8, interestOf },
  );
  assert.deepEqual([low.text, low.tone], ["⚑ 10g", "amber"]);
  assert.match(low.why, /^vida em perigo: gaste até 10g/);
  assert.equal(
    goldBadge({ keep: null, floor: null }),
    null,
    "sem piso, sem selo",
  );
});

test("selos: só ao vivo, ancorados nos botões e no ouro, posicionados dentro do palco e escapados", () => {
  const v = viewOf(
    liveInput(({ rec }) => {
      const p = rec.recommendations[0].strategy.panels;
      Object.assign(p.rolling, {
        go: true,
        spend: 30,
        shops: 15,
        keep: 24,
        call: {
          kind: "go",
          title: "<b>x</b>",
          go: true,
          reason: "y",
          budget: 30,
        },
      });
      Object.assign(p.economy, { keep: 50 });
    }),
  );
  const badges = buildBadges(v, { curve: POLICY.curve, interestOf });
  assert.deepEqual(
    badges.map((b) => [b.id, b.anchor.kind]),
    [
      ["roll", BADGE_ANCHORS.roll.kind],
      ["level", "xpButton"],
      ["gold", "gold"],
    ],
  );
  const rects = anchorRects(STAGE);
  const placed = placeBadges(badges, rects, STAGE, {
    k: 1,
    resolveAnchor,
    placeLabel,
  });
  assert.equal(placed.length, 3);
  for (const p of placed) {
    assert.ok(
      p.x >= 0 && p.y >= 0 && p.x + p.width <= 1920 && p.y + p.height <= 1080,
      p.id,
    );
  }
  const roll = placed.find((p) => p.id === "roll");
  assert.ok(
    roll.x + roll.width <= rects.rerollButton.x + 0.5,
    "à esquerda do botão Atualizar",
  );
  const html = drawBadges(placed, ui);
  assert.ok(!html.includes("<b>x</b>"), "escapado");
  assert.match(html, /data-id="roll" data-tone="go"/);
  assert.match(badgesHelpHtml(badges, esc), /Botão Atualizar: ↻ role 15 vezes/);
  // Fora de partida ao vivo: nenhum selo.
  assert.deepEqual(buildBadges({ ...v, status: "idle" }), []);
  assert.deepEqual(
    buildBadges({ ...v, bar: { ...v.bar, live: { kind: "snapshot" } } }),
    [],
  );
});

/* ---------- Tela padrão ---------- */

test("tela padrão: faixa de estado, dicas e cartão de rolagem ocultos e religáveis; os avisos vão para o dock", () => {
  for (const id of ["bar", "hints", "roll"]) {
    assert.equal(DEFAULT_LAYOUT[id].hidden, true, id);
    assert.equal(
      setHidden(DEFAULT_LAYOUT, id, false)[id].hidden,
      false,
      `${id} religável`,
    );
  }
  for (const id of ["items", "carousel", "keys", "comp", "dock"])
    assert.equal(DEFAULT_LAYOUT[id].hidden, false, id);
  const draw = createDraw({
    ...ui,
    unitPortrait: () => "",
    itemPortrait: () => "",
    nameChip: () => "",
    stars: () => "",
  });
  const offline = viewOf(liveInput());
  const notices = [
    { kind: "offline", text: "sem resposta do servidor há 12 s", title: "t" },
  ];
  const dock = draw.dock({
    health: [],
    mode: { mode: "integrated", hints: { verbosity: "normal" } },
    hasHost: true,
    notices,
  });
  assert.match(
    dock,
    /class="chips dock-notes"><span class="chip note" data-kind="offline"[^>]*>.*sem resposta do servidor há 12 s/,
  );
  assert.ok(
    !draw
      .dock({ health: [], mode: { mode: "integrated" }, hasHost: true })
      .includes("dock-notes"),
  );
  assert.ok(offline.status === "ready");
});

/* ---------- rollFor (o campo do tft-rolagem) ---------- */

test("selo de rolagem: rollFor (rec.strategy.panels.rolling.rollFor) dá os alvos, o resumo e a carta na loja", () => {
  const rollFor = {
    go: true,
    spend: 25,
    keep: 50,
    text: "Role 25g (até 12 lojas), pare em 50g",
    targets: [
      {
        id: "DA_18_Aphelios",
        name: "Aphelios",
        cost: 4,
        goal: "2★",
        have: "2/3",
        chance: 0.68,
        slow: null,
        rivals: { copies: 1, hidden: 0, names: ["Rival"] },
        why: "carry da comp",
        text: "Aphelios 2★ · 68% com 25g",
        carry: true,
        inShop: true,
        slots: [3],
      },
      {
        id: "DA_18_Rakan",
        name: "Rakan",
        goal: "falta",
        have: "0/1",
        chance: 0.4,
        rivals: { copies: 0 },
        text: "Rakan · 40% com 25g",
        inShop: false,
        slots: [],
      },
    ],
  };
  const v = viewOf(
    liveInput(({ rec }) => {
      const ro = rec.recommendations[0].strategy.panels.rolling;
      Object.assign(ro, {
        go: true,
        spend: 25,
        shops: 12,
        keep: 50,
        call: {
          kind: "go",
          title: "Vale rolar",
          go: true,
          reason: "x",
          budget: 25,
        },
        rollFor,
      });
    }),
  );
  assert.deepEqual(
    v.roll.targets.map((t) => [t.id, t.goalText, t.haveText, t.rivals]),
    [
      ["DA_18_Aphelios", "2★", "2/3", 1],
      ["DA_18_Rakan", "falta", "0/1", 0],
    ],
  );
  assert.equal(v.roll.forText, "Role 25g (até 12 lojas), pare em 50g");
  assert.deepEqual(v.roll.found, [
    { id: "DA_18_Aphelios", name: "Aphelios", slots: [3] },
  ]);
  const b = rollBadge(v.roll);
  assert.equal(b.text, "↻ Aphelios 2★ Rakan novo role 12 vezes");
  assert.match(b.why, /Role 25g \(até 12 lojas\), pare em 50g/);
  assert.match(
    b.why,
    /Aphelios 2★ · 68% com 25g, 2\/3 cópias, 1 rival, carry da comp/,
  );
  assert.deepEqual(
    foundBadges(v.roll).map((f) => [f.text, f.anchor.slot]),
    [["achou: Aphelios", 3]],
  );
  // Sem decisão de rolar (go: false, targets: []): nada de alvos no selo.
  const hold = viewOf(
    liveInput(({ rec }) => {
      const ro = rec.recommendations[0].strategy.panels.rolling;
      Object.assign(ro, {
        call: { kind: "hold", title: "Não vale rolar agora", reason: "y" },
        rollFor: { go: false, targets: [] },
      });
    }),
  );
  assert.deepEqual(hold.roll.targets, []);
  assert.equal(rollBadge(hold.roll).text, "↻ não role");
});

/* ---------- Entra e sai (bloco do overlay) ---------- */

/** Modelo por vaga (core/board/interim.mjs) com entrada da reserva, substituto da loja, temporário e venda. */
function slotPlan() {
  return {
    stage: {
      slots: [
        {
          slot: 0,
          unit: { id: "DA_18_Aphelios", name: "Aphelios" },
          original: {
            id: "DA_18_Aphelios",
            name: "Aphelios",
            stars: 2,
            have: "reserva",
          },
          playing: {
            id: "DA_18_Aphelios",
            name: "Aphelios",
            stars: 2,
            source: "reserva",
          },
          kind: "titular",
          why: "Aphelios 2★ supera Kog'Maw",
          until: null,
          replaces: { id: "DA_KogMaw18_AD", name: "Kog'Maw", stars: 2 },
        },
        {
          slot: 1,
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
          why: "vaga vazia",
          until: {
            kind: "compra",
            text: "volta quando Brambleback chegar a 2★",
          },
        },
        {
          slot: 2,
          unit: { id: "DA_Sentinel18", name: "Sentinel" },
          original: {
            id: "DA_Sentinel18",
            name: "Sentinel",
            stars: 1,
            have: "reserva",
          },
          playing: { id: "DA_Vi18", name: "Vi", stars: 2, source: "campo" },
          kind: "temporario",
          why: "Vi 2★ supera Sentinel 1★",
          until: {
            kind: "estrela",
            text: "volta quando Sentinel chegar a 2★ (faltam 2 cópias)",
          },
        },
        {
          slot: 3,
          unit: { id: "DA_Amumu18", name: "Amumu" },
          original: {
            id: "DA_Amumu18",
            name: "Amumu",
            stars: 2,
            have: "campo",
          },
          playing: {
            id: "DA_Amumu18",
            name: "Amumu",
            stars: 2,
            source: "campo",
          },
          kind: "titular",
          why: "em campo",
          until: null,
        },
      ],
      interim: {
        buys: [
          {
            slot: 2,
            id: "DA_18_Xayah",
            name: "Xayah",
            purpose: "reserva",
            sell: { id: "DA_18_Teemo", name: "Teemo" },
          },
        ],
      },
    },
  };
}

test("entra e sai: o bloco lista as trocas certas do modelo por vaga, em ordem, com retratos e a frase na dica", () => {
  const rows = swapRows(slotPlan());
  assert.deepEqual(
    rows.map((r) => [
      r.kind,
      r.in?.id ?? null,
      r.out?.id ?? null,
      r.for?.id ?? null,
    ]),
    [
      ["enter", "DA_18_Aphelios", "DA_KogMaw18_AD", null],
      ["leave", null, "DA_KogMaw18_AD", null],
      ["sell", null, "DA_18_Teemo", null],
      ["buy", "DA_18_Rakan", null, "DA_Brambleback18"],
      ["temp", "DA_Vi18", null, "DA_Sentinel18"],
    ],
  );
  assert.equal(rows[0].text, "Kog'Maw 2★ sai e Aphelios entra (da reserva)");
  assert.match(
    rows[4].text,
    /Vi 2★ segura a vaga de Sentinel: volta quando Sentinel chegar a 2★/,
  );
  const html = swapsHtml(rows, ui);
  assert.match(html, /<span class="eyebrow">Entra e sai<\/span>/);
  assert.match(
    html,
    /data-kind="enter"[^>]*>[\s\S]*?data-id="DA_KogMaw18_AD"[\s\S]*?→[\s\S]*?data-id="DA_18_Aphelios"[\s\S]*?entra \(da reserva\)/,
  );
  assert.match(html, /data-kind="leave"[\s\S]*?↓ sai para a reserva/);
  assert.match(html, /data-kind="sell"[\s\S]*?\$ vender/);
  assert.match(
    html,
    /data-kind="buy"[\s\S]*?<svg data-g="coin"><\/svg>1[\s\S]*?da loja[\s\S]*?vaga de/,
  );
  assert.match(html, /data-kind="temp"[\s\S]*?⇄/);
  // Nenhum nome de campeão fora de atributos e do texto de leitor de tela.
  const text = html
    .replace(/<b class="sr">[\s\S]*?<\/b>/g, " ")
    .replace(/<[^>]*>/g, " ");
  for (const name of [
    "Aphelios",
    "Kog'Maw",
    "Teemo",
    "Rakan",
    "Vi ",
    "Sentinel",
  ])
    assert.ok(
      !text.includes(name.replace("'", "&#39;")) && !text.includes(name),
      name,
    );
  assert.equal(swapsHtml([], ui), "", "sem troca, o bloco some");
  assert.ok(SWAPS_SHOWN >= 3);
});

test("entra e sai: sem o modelo por vaga, as trocas do plano (prontas = entra/sai; não prontas = temporário)", () => {
  const rows = swapRows({
    transitions: [
      {
        enter: { id: "A", name: "Aphelios" },
        exit: { id: "N", name: "Nidalee" },
        source: "reserve",
        ready: true,
      },
      {
        enter: { id: "R", name: "Rakan" },
        exit: { id: "V", name: "Vi" },
        source: "shop",
        ready: false,
        requiredStars: 2,
        exitStars: 2,
      },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["enter", "leave", "temp"],
  );
  assert.equal(rows[2].until, "volta quando Rakan chegar a 2★");
  assert.deepEqual(swapRows(null), []);
});

test("entra e sai: é um bloco do overlay (elemento próprio), nada desenhado sobre o tabuleiro ou a reserva do jogo", () => {
  assert.ok(ELEMENT_IDS.includes("swaps"));
  assert.equal(DEFAULT_LAYOUT.swaps.hidden, false);
  // Na coluna da direita, longe da loja (embaixo, x de ~0,28 a ~0,79) e do centro (aprimoramentos e carrossel).
  assert.ok(DEFAULT_LAYOUT.swaps.x >= 0.73 && DEFAULT_LAYOUT.swaps.y < 0.78);
  const hud = read("overlay/hud/hud.mjs");
  assert.ok(
    !/fieldmarks|benchSlot|boardCell/.test(hud),
    "sem marcas sobre o tabuleiro ou a reserva",
  );
  assert.ok(
    !fs.existsSync(new URL("../overlay/hud/fieldmarks.mjs", import.meta.url)),
  );
  const geometry = stripNonCode(read("overlay/hud/geometry.mjs"), {
    keepStrings: true,
  });
  assert.ok(!/benchSlots|boardCells/.test(geometry));
  // Ao vivo, o modelo de tela traz as trocas (e só ao vivo).
  const v = viewOf(
    liveInput(({ rec }) => {
      rec.recommendations[0].stage = {
        ...rec.recommendations[0].stage,
        ...slotPlan().stage,
      };
    }),
  );
  assert.equal(v.swaps.length, 5);
  assert.deepEqual(v.tempBuys, [
    {
      id: "DA_18_Rakan",
      name: "Rakan",
      cost: 1,
      slot: 4,
      forName: "Brambleback",
      until: "volta quando Brambleback chegar a 2★",
    },
  ]);
});

test("loja: o substituto temporário que o modelo manda comprar ganha ⇄ 'Compre (temporário)' em outra cor; a peça da comp vale primeiro", () => {
  const view = {
    status: "ready",
    bar: { live: { kind: "live" } },
    buy: { rows: [] },
    tempBuys: tempBuys(slotPlan().stage ? slotPlan() : null),
  };
  const r = buildHints(view, { verbosity: "normal" });
  const h = r.hints.find((x) => x.id.startsWith("buy-temp:"));
  assert.ok(h, "dica de compra do substituto");
  assert.equal(h.tone, "swap");
  assert.deepEqual(h.anchors, [{ kind: "shop", slot: 4 }]);
  assert.equal(h.text, "⇄ Compre Rakan (temporário)");
  assert.equal(h.action, "1g · no lugar de Brambleback");
  assert.equal(h.why, "no lugar de Brambleback até Brambleback chegar a 2★");
  // A mesma carta também é peça da comp: vale a da comp (uma marca só no espaço).
  const both = buildHints(
    {
      ...view,
      buy: {
        rows: [
          {
            key: "b",
            unit: { id: "DA_X", name: "X" },
            shop: { slots: [4], buy: 1, buyText: "comprar 1", title: "" },
          },
        ],
      },
    },
    { verbosity: "normal" },
  );
  assert.equal(
    both.hints.filter((x) => x.anchors.some((a) => a.slot === 4)).length,
    1,
  );
  assert.ok(both.hints.some((x) => x.id === "buy:DA_X"));
});

/* ---------- Montar agora (bloco de itens) ---------- */

test("montar agora: item = componentes → campeão, pronto → campeão, segure no temporário → para o titular e o que falta", () => {
  const v = viewOf(
    liveInput(({ state, rec }) => {
      state.seen.items = [
        "DA_Component_NeedlesslyLargeRod",
        "DA_Component_NegatronCloak",
      ];
      rec.recommendations[0].stage.bankItems = [
        {
          id: "DA_ArchangelsStaff",
          name: "Archangel's Staff",
          to: { id: "DA_18_Diana", name: "Diana" },
          for: null,
          reason: "1º item",
        },
        {
          id: "DA_Deathblade",
          name: "Deathblade",
          to: { id: "DA_KogMaw18_AD", name: "Kog'Maw" },
          for: { id: "DA_18_Aphelios", name: "Aphelios" },
          reason: "segure",
        },
      ];
    }),
  );
  const build = [
    ...v.items.build.map((b) => [
      b.kind,
      b.item.id,
      b.unit.id,
      b.for?.id ?? null,
    ]),
    ...v.items.buildRest,
  ];
  // O carry (Aphelios) primeiro: o item que o temporário segura para ele.
  assert.deepEqual(build[0], [
    "hold",
    "DA_Deathblade",
    "DA_KogMaw18_AD",
    "DA_18_Aphelios",
  ]);
  assert.deepEqual(build[1], ["craft", "DA_IonicSpark", "DA_18_Diana", null]);
  assert.deepEqual(build[2], [
    "ready",
    "DA_ArchangelsStaff",
    "DA_18_Diana",
    null,
  ]);
  assert.equal(v.items.build.length, 3, "até 3 linhas visíveis");
  assert.ok(
    v.items.buildRest.some((t) =>
      /^falta .* para Jeweled Gauntlet de Diana$/.test(t),
    ),
    "o resto na dica",
  );
  const craft = v.items.build[1];
  assert.deepEqual(
    craft.parts.map((p) => p.state),
    ["bank", "bank"],
  );
  // Desenho: imagens e a palavra da ação; a frase na dica do mouse.
  const draw = createDraw({
    ...ui,
    unitPortrait: () => "",
    itemPortrait: (i) =>
      `<span class="pt pt-item" data-id="${esc(i.id)}" title="${esc(i.name)}"></span>`,
    nameChip: () => "",
    stars: () => "",
  });
  const html = draw.items(v);
  assert.match(html, /<h3 class="eyebrow">Montar agora<\/h3>/);
  assert.match(
    html,
    /data-kind="craft"[^>]*title="monte Ionic Spark[\s\S]*?=[\s\S]*?\+[\s\S]*?→/,
  );
  assert.match(html, /data-kind="ready"[\s\S]*?pronto:/);
  assert.match(html, /data-kind="hold"[\s\S]*?segure[\s\S]*?em[\s\S]*?para/);
  assert.match(html, /\+\d+ na dica/);
});

test("selo de XP lê a decisão da rodada (turn): sem curva própria, sem contradizer a decisão", () => {
  const base = {
    level: 8,
    go: false,
    cost: 48,
    passive: false,
    finalLevel: 10,
    verdict: "não subir agora",
    text: "",
  };
  const gold = levelBadge(
    {
      ...base,
      turn: { done: false, next: { when: "com 48g", why: "subir custa 48g" } },
    },
    {
      stage: { stage: 4, round: 2 },
      curve: [
        [4, 2, 8],
        [4, 5, 9],
      ],
    },
  );
  assert.equal(gold.text, "↑ espere com 48g");
  assert.match(gold.why, /subir custa 48g/);
  const done = levelBadge({
    ...base,
    level: 10,
    turn: { done: true, next: null },
  });
  assert.equal(done.text, "↑ não suba");
  assert.equal(
    levelBadge({ ...base, go: true, turn: { done: false, next: null } }).text,
    "↑ suba agora · 48g",
  );
});
