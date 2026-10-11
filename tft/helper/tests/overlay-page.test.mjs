// Rodar com: node --test tft/helper/tests/overlay-page.test.mjs
// Página do overlay integrado (overlay/hud): saúde das fontes (health.mjs), marcas ancoradas (markers.mjs), modo e
// gestos dos elementos (widgets.mjs), ajuda (help.mjs), calibração (calibrate.mjs) e as fronteiras da página: só os
// métodos do host do contrato, todo id usado existe no HTML, nenhum módulo envia entrada ao jogo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { read, root, stripNonCode } from "./architecture/scan.mjs";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { healthOf, worstOk } from "../overlay/hud/health.mjs";
import {
  LABEL,
  avoidOverlap,
  drawHintList,
  drawMarkers,
  groupKey,
  hintLine,
  labelSize,
  placeMarkers,
  sealOf,
  showsWhy,
} from "../overlay/hud/markers.mjs";
import {
  PANEL_MODE,
  gestureResult,
  normalizeMode,
  pointInRects,
  stageScale,
} from "../overlay/hud/widgets.mjs";
import { HOTKEY_LABELS, helpAction, helpHtml } from "../overlay/hud/help.mjs";
import {
  STEPS,
  calibrateAction,
  calibrationHtml,
  calibrationShapes,
  controlsHtml,
} from "../overlay/hud/calibrate.mjs";
import { anchorRects, DEFAULT_CALIBRATION } from "../overlay/hud/geometry.mjs";
import { ELEMENT_IDS, resetLayout } from "../overlay/hud/layout.mjs";
import {
  HINT_CATEGORIES,
  VERBOSITY_LEVELS,
  parseHintSettings,
} from "../overlay/hud/hints.mjs";

// A interface lê matchMedia e CSS no import; o Node não os tem.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const glyphs = await import("../v2/js/ui/glyphs.js");
const rich = await import("../v2/js/ui/rich-text.js");
const { esc } = await import("../v2/js/dom.js");
const { createDraw } = await import("../overlay/hud/draw.mjs");

const catalog = realCatalog();
glyphs.setCatalog(catalog);
const ui = {
  esc,
  glyph: glyphs.glyph,
  portrait: glyphs.portrait,
  unitPortrait: glyphs.unitPortrait,
  itemPortrait: glyphs.itemPortrait,
  richText: rich.richText,
};
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

const STAGE = { width: 1920, height: 1080 };
const rects = anchorRects(STAGE, DEFAULT_CALIBRATION);
const detailed = parseHintSettings({ verbosity: "detailed" });
// A verbosidade normal (o padrão do jogador agora é a mínima, com a etiqueta compacta testada à parte).
const normal = parseHintSettings({ verbosity: "normal" });

/** Dica no formato de `hints.mjs`. */
function hint(over = {}) {
  const anchors = over.anchors ?? [{ kind: "shop", slot: 2 }];
  return {
    id: "buy:DA_X",
    category: "buy",
    priority: 90,
    tone: "go",
    anchor: anchors[0] ?? { kind: "none" },
    anchors,
    text: "Compre X",
    why: null,
    action: "comprar 1",
    icon: null,
    parts: null,
    pulse: true,
    probable: false,
    stale: false,
    ...over,
  };
}
const boxOf = (l) => ({ x: l.x, y: l.y, width: l.width, height: l.height });
const overlaps = (a, b) =>
  a.x < b.x + b.width - 0.5 &&
  a.x + a.width > b.x + 0.5 &&
  a.y < b.y + b.height - 0.5 &&
  a.y + a.height > b.y + 0.5;
/** Texto visível de um HTML: sem marcas, sem os nomes que só leitor de tela lê (`.sr`, `.rt-name`). */
const visibleText = (html) =>
  html
    .replace(/<b class="sr">.*?<\/b>/g, " ")
    .replace(/<span class="rt-name">.*?<\/span>/g, " ")
    .replace(/<[^>]*>/g, " ");

/* ---------- Saúde das fontes ---------- */

const GEP_ON = {
  state: "ativo",
  short: "GEP ativo · 3s",
  label: "GEP ativo · último evento há 3s",
};

test("saúde: servidor sem resposta, conectando, dado velho e respondendo", () => {
  const ready = { status: "ready", notices: [], sources: null, bar: null };
  assert.equal(healthOf(ready)[0].id, "server");
  assert.equal(healthOf(ready)[0].ok, true);
  assert.equal(healthOf(ready, { offline: true })[0].ok, false);
  assert.match(healthOf(ready, { offline: true })[0].text, /sem resposta/);
  assert.equal(healthOf({ status: "loading", notices: [] })[0].ok, null);
  const old = {
    status: "ready",
    notices: [
      { kind: "analysis-old", text: "análise de há 130 s", title: "t" },
    ],
  };
  assert.equal(healthOf(old)[0].ok, null);
  assert.match(healthOf(old)[0].text, /130 s/);
  assert.equal(healthOf(null)[0].ok, null, "sem modelo de tela nunca lança");
});

test("saúde: GEP ativo, em reserva e sem informação (com o chip da barra como alternativa)", () => {
  const on = healthOf({
    status: "ready",
    notices: [],
    sources: { gep: GEP_ON },
  })[1];
  assert.deepEqual([on.id, on.ok, on.text], ["gep", true, "GEP ativo · 3s"]);
  const off = healthOf({
    status: "ready",
    notices: [],
    sources: {
      gep: { state: "obsoleto", short: "GEP parado", label: "GEP obsoleto" },
    },
  })[1];
  assert.equal(off.ok, false);
  assert.equal(
    healthOf({ status: "ready", notices: [], sources: null })[1].ok,
    null,
  );
  const viaBar = healthOf({
    status: "ready",
    notices: [],
    sources: null,
    bar: { gep: GEP_ON },
  })[1];
  assert.equal(viaBar.ok, true);
});

test("saúde: leitor de tela com erro, em uso, em reserva e sem informação", () => {
  const of = (sources) =>
    healthOf({ status: "ready", notices: [], sources })[2];
  assert.equal(of({ reader: "janela do jogo oculta" }).ok, false);
  assert.match(
    of({ reader: "janela do jogo oculta" }).text,
    /janela do jogo oculta/,
  );
  assert.equal(
    of({ reader: null, shopSource: "screen", goldSource: "gep" }).text,
    "Leitura de tela em uso",
  );
  const standby = of({
    reader: null,
    shopSource: "gep",
    goldSource: "gep",
    levelSource: "gep",
  });
  assert.equal(standby.ok, true);
  assert.match(standby.text, /reserva/);
  assert.equal(of({ reader: null }).ok, null);
  assert.equal(of(null).ok, null);
});

test("saúde: janela do TFT não acompanhada, ausente, em tela cheia exclusiva e detectada", () => {
  const view = { status: "ready", notices: [] };
  const of = (game) => healthOf(view, { game })[3];
  assert.equal(of(null).ok, null);
  assert.equal(of({ found: false }).ok, false);
  const fs = of({
    found: true,
    width: 1920,
    height: 1080,
    fullscreen: { warn: true, kind: "exclusive", text: "Tela cheia exclusiva" },
  });
  assert.equal(fs.ok, false);
  assert.match(fs.text, /Tela cheia exclusiva/);
  const ok = of({ found: true, width: 1920, height: 1080, fullscreen: null });
  assert.equal(ok.ok, true);
  assert.match(ok.text, /1920x1080/);
  const all = healthOf(view, { game: { found: true, width: 1, height: 1 } });
  assert.deepEqual(
    all.map((h) => h.id),
    ["server", "gep", "screen", "game"],
  );
  assert.equal(worstOk([{ ok: true }, { ok: null }]), null);
  assert.equal(worstOk([{ ok: true }, { ok: false }, { ok: null }]), false);
  assert.equal(worstOk([{ ok: true }]), true);
});

/* ---------- Marcas ancoradas ---------- */

test("marcas: o porquê só aparece detalhado ou em 'aprender' ligada", () => {
  const withWhy = hint({ why: "porque sim" });
  assert.equal(showsWhy(withWhy, normal), false);
  assert.equal(showsWhy(withWhy, detailed), true);
  assert.equal(showsWhy(hint({ why: null }), detailed), false);
  const learn = hint({ category: "learn", why: "explicação" });
  assert.equal(showsWhy(learn, normal), false, "aprender desligada não mostra");
  assert.equal(
    showsWhy(learn, parseHintSettings({ categories: { learn: true } })),
    true,
  );
});

test("marcas: uma entrada por âncora com retângulo; sem âncora geométrica fica de fora", () => {
  const hints = [
    hint({
      id: "buy:two",
      anchors: [
        { kind: "shop", slot: 1 },
        { kind: "shop", slot: 4 },
      ],
    }),
    hint({
      id: "alert:hp",
      category: "alert",
      anchors: [],
      anchor: { kind: "none" },
      text: "Vida em perigo",
    }),
    hint({
      id: "gold:roll",
      category: "gold",
      anchors: [{ kind: "gold" }],
      text: "Role até 30g",
    }),
    hint({
      id: "move",
      category: "items",
      anchors: [{ kind: "bank" }],
      text: "Passe um item",
    }),
  ];
  const placed = placeMarkers(hints, rects, STAGE, { settings: normal });
  assert.deepEqual(
    placed.map((p) => p.hintId),
    ["buy:two", "buy:two", "gold:roll", "move"],
    "a dica sem âncora não gera marca",
  );
  assert.deepEqual(placed[0].rect, rects.shopCards[0]);
  assert.deepEqual(placed[1].rect, rects.shopCards[3]);
  assert.equal(placed[2].group, groupKey({ kind: "gold" }));
  for (const p of placed) {
    assert.ok(
      p.label.x >= -0.5 && p.label.y >= -0.5,
      `${p.hintId}: etiqueta fora do palco (canto)`,
    );
    assert.ok(
      p.label.x + p.label.width <= STAGE.width + 0.5,
      `${p.hintId}: etiqueta passa da largura`,
    );
    assert.ok(
      p.label.y + p.label.height <= STAGE.height + 0.5,
      `${p.hintId}: etiqueta passa da altura`,
    );
    assert.ok(["top", "bottom", "left", "right"].includes(p.label.side));
  }
});

test("marcas: dicas do mesmo alvo dividem a etiqueta; etiquetas de alvos diferentes não se sobrepõem", () => {
  const a = hint({ id: "buy:a", text: "Compre A" }),
    b = hint({
      id: "wisp:b",
      category: "wisp",
      priority: 80,
      text: "Wisp B: comprar",
    });
  const same = placeMarkers([a, b], rects, STAGE, { settings: normal });
  assert.equal(same.length, 2);
  assert.equal(same[0].group, same[1].group);
  assert.equal(same[0].label, same[1].label, "mesma etiqueta");
  assert.deepEqual(
    same.map((p) => [p.lead, p.count]),
    [
      [true, 2],
      [false, 2],
    ],
  );
  const single = placeMarkers([a], rects, STAGE, { settings: normal });
  assert.ok(
    same[0].label.height > single[0].label.height,
    "a etiqueta cresce com as dicas",
  );

  // Vizinhas na loja com texto longo e acima do banco: nada se cobre.
  const long = "Compre um campeão com um nome bem comprido para a etiqueta";
  const many = [1, 2, 3, 4, 5].map((slot) =>
    hint({
      id: `buy:${slot}`,
      anchors: [{ kind: "shop", slot }],
      anchor: { kind: "shop", slot },
      text: long,
    }),
  );
  const labels = [
    ...new Set(
      placeMarkers(many, rects, STAGE, { settings: normal }).map(
        (p) => p.label,
      ),
    ),
  ];
  assert.equal(labels.length, 5);
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      assert.ok(
        !overlaps(boxOf(labels[i]), boxOf(labels[j])),
        `etiquetas ${i} e ${j} se sobrepõem`,
      );
});

test("marcas: avoidOverlap empilha para fora do alvo e volta ao outro lado na borda do palco", () => {
  const taken = [{ x: 100, y: 100, width: 200, height: 30 }],
    size = { width: 200, height: 30 },
    stage = { width: 1000, height: 600 };
  assert.equal(
    avoidOverlap({ x: 100, y: 100, side: "top" }, size, taken, stage, 0).y,
    70,
  );
  assert.equal(
    avoidOverlap({ x: 100, y: 100, side: "bottom" }, size, taken, stage, 0).y,
    130,
  );
  const top = [{ x: 0, y: 0, width: 200, height: 30 }];
  assert.equal(
    avoidOverlap({ x: 0, y: 0, side: "top" }, size, top, stage, 0).y,
    30,
    "não sai pelo topo",
  );
  const free = avoidOverlap(
    { x: 500, y: 200, side: "top" },
    size,
    taken,
    stage,
    0,
  );
  assert.equal(free.y, 200, "sem colisão, fica");
});

test("marcas: o tamanho da etiqueta cresce com o porquê, a ação e os componentes", () => {
  const base = hint({ text: "Compre X", action: null });
  const small = labelSize([base], 1, normal);
  const withAction = labelSize(
    [hint({ text: "Compre X", action: "comprar 1 agora" })],
    1,
    normal,
  );
  assert.ok(withAction.width > small.width);
  const why = hint({ text: "Compre X", action: null, why: "motivo" });
  assert.ok(
    labelSize([why], 1, detailed).height > labelSize([why], 1, normal).height,
  );
  const doubled = labelSize([base], 2, normal);
  assert.equal(doubled.width, small.width * 2);
  assert.equal(doubled.height, small.height * 2);
  assert.ok(small.width >= LABEL.minW);
  const capped = labelSize([hint({ text: "x".repeat(500) })], 1, normal);
  assert.ok(capped.width <= LABEL.maxW);
});

function championWithIcon() {
  for (const c of catalog.champions.values()) {
    if (!c.icon) continue;
    const text = `Compre ${c.name}`;
    if (rich.segments(text, catalog).some((s) => s.ref?.kind === "champion"))
      return {
        id: [...catalog.champions].find(([, v]) => v === c)[0],
        name: c.name,
      };
  }
  throw new Error("o catálogo de teste não tem campeão com ícone resolvível");
}

test("marcas: contorno pulsante, tracejado se provável, esmaecido se velho; nome vira imagem", () => {
  const champ = championWithIcon();
  const buy = hint({
    id: `buy:${champ.id}`,
    text: `Compre ${champ.name}`,
    icon: { kind: "champion", id: champ.id, name: champ.name },
    probable: true,
  });
  const html = drawMarkers(
    placeMarkers([buy], rects, STAGE, { settings: normal }),
    { ...ui, settings: normal, k: 1 },
  );
  assert.match(html, /class="mk"[^>]*data-kind="shop"[^>]*data-slot="2"/);
  assert.match(html, /data-pulse="1"/);
  assert.match(html, /data-probable="1"/);
  assert.match(html, /class="hl-q"/, "leitura provável leva o '?'");
  assert.match(html, /<img /);
  assert.ok(
    !visibleText(html).includes(champ.name),
    "o nome do campeão aparece só como imagem",
  );
  assert.match(html, /comprar 1/);

  const stale = hint({ stale: true, pulse: false });
  const old = drawMarkers(
    placeMarkers([stale], rects, STAGE, { settings: normal }),
    { ...ui, settings: normal, k: 1 },
  );
  assert.match(old, /data-stale="1"/);
  assert.match(old, /data-pulse="0"/);
});

test("marcas: selos passivos (juros e nível) viram selo no alvo, sem pulso", () => {
  assert.equal(sealOf({ id: "gold:interest" }), "interest");
  assert.equal(sealOf({ id: "level:seal" }), "level");
  assert.equal(sealOf({ id: "gold:roll" }), null);
  const interest = hint({
    id: "gold:interest",
    category: "gold",
    priority: 30,
    tone: "info",
    anchors: [{ kind: "gold" }],
    text: "Juros: +3g por rodada",
    action: null,
    pulse: false,
  });
  const html = drawMarkers(
    placeMarkers([interest], rects, STAGE, { settings: normal }),
    { ...ui, settings: normal, k: 1 },
  );
  assert.match(html, /class="mk-badge" data-seal="interest"/);
  assert.match(html, /data-quiet="1"/);
});

test("marcas: todo texto do servidor é escapado (frase, ação, porquê, ids)", () => {
  const evil = '<img src=x onerror="boom()"> & mais';
  const h = hint({
    id: '"><script>x</script>',
    text: evil,
    action: evil,
    why: evil,
  });
  const html = drawMarkers(
    placeMarkers([h], rects, STAGE, { settings: detailed }),
    { ...ui, settings: detailed, k: 1 },
  );
  const list = drawHintList(
    { hints: [h], total: 1, hidden: 2 },
    { ...ui, settings: detailed, k: 1 },
  );
  for (const out of [html, list]) {
    assert.ok(!out.includes("<img src=x"), "marca HTML solta");
    assert.ok(!out.includes("<script>"), "script solto");
    assert.match(out, /&lt;img src=x/);
    assert.match(out, /&amp; mais/);
  }
  assert.match(list, /\+2/, "dicas ocultas pela verbosidade");
});

test("marcas: porquê só na linha quando a verbosidade manda; lista vazia não desenha nada", () => {
  const h = hint({ why: "o motivo do servidor" });
  assert.ok(
    !hintLine(h, { ...ui, settings: normal }).includes("o motivo do servidor"),
  );
  assert.match(hintLine(h, { ...ui, settings: detailed }), /class="hl-why"/);
  assert.equal(
    drawHintList(
      { hints: [], total: 0, hidden: 0 },
      { ...ui, settings: normal },
    ),
    "",
  );
  assert.equal(drawHintList(null, { ...ui, settings: normal }), "");
  assert.deepEqual(placeMarkers([], rects, STAGE), []);
  assert.deepEqual(
    placeMarkers([hint()], null, STAGE),
    [],
    "sem retângulos (jogo não encontrado)",
  );
});

test("marcas: componentes da receita saem como ícones com a situação de cada um", () => {
  const next = hint({
    id: "next:x",
    category: "items",
    anchors: [{ kind: "bank" }],
    text: "Monte o item em alguém",
    parts: [
      { id: "DA_Component_ChainVest", name: "Chain Vest", state: "bank" },
      { id: "DA_Component_GiantsBelt", name: "Giant's Belt", state: "missing" },
    ],
  });
  const html = hintLine(next, { ...ui, settings: normal });
  assert.match(html, /data-state="bank"/);
  assert.match(html, /data-state="missing"/);
  assert.ok(!visibleText(html).includes("Chain Vest"));
});

test("dock: botão '?' só com host, um ponto por fonte, texto escapado e aviso de tela cheia", () => {
  const mode = integratedMode();
  const health = healthOf(
    { status: "ready", notices: [] },
    { game: mode.game },
  );
  const withHost = draw.dock({ health, mode, hasHost: true });
  assert.match(withHost, /class="dock-help" data-hit data-act="help"/);
  assert.equal((withHost.match(/class="dot"/g) ?? []).length, 4);
  assert.match(withHost, />interativo</);
  assert.match(
    draw.dock({
      health,
      mode: { ...mode, interactive: false, hints: normal },
      hasHost: true,
    }),
    />integrado</,
  );
  // Compacto (verbosidade mínima, o padrão): o estado normal "integrado" não ocupa a tela; só os pontos e o "?".
  assert.ok(
    !draw
      .dock({ health, mode: { ...mode, interactive: false }, hasHost: true })
      .includes(">integrado<"),
  );
  assert.ok(
    !draw.dock({ health, mode, hasHost: false }).includes("dock-help"),
    "aba comum não tem '?'",
  );
  const evil = [
    { id: "server", ok: false, text: "<b>x</b>", title: '"><script>' },
  ];
  const html = draw.dock({ health: evil, mode, hasHost: true });
  assert.ok(!html.includes("<b>x</b>") && !html.includes("<script>"));
  assert.match(
    draw.dock({ health, mode: { ...mode, calibrating: true }, hasHost: true }),
    />calibrando</,
  );

  assert.equal(draw.banner(mode), "");
  const warned = integratedMode({
    game: {
      found: true,
      width: 1,
      height: 1,
      fullscreen: { warn: true, kind: "exclusive", text: "Use <janela>" },
    },
  });
  assert.match(draw.banner(warned), /class="fs-warn"/);
  assert.match(draw.banner(warned), /Use &lt;janela&gt;/);
});

/* ---------- Modo, escala e gestos ---------- */

test("modo: sem host ou sem layout cai no painel; ajuda e calibração exigem o modo interativo", () => {
  assert.equal(PANEL_MODE.mode, "panel");
  assert.equal(normalizeMode(undefined).mode, "panel");
  assert.equal(normalizeMode("lixo").mode, "panel");
  assert.equal(
    normalizeMode({ mode: "integrated" }).mode,
    "panel",
    "host v1 não manda layout",
  );
  const m = normalizeMode({
    mode: "integrated",
    layout: {},
    interactive: false,
    help: true,
    calibrating: true,
    scale: 1.2,
    hotkeys: { help: "Control+Shift+F8", quit: 5 },
    game: {
      found: true,
      width: 1920,
      height: 1080,
      fullscreen: { warn: true, kind: "exclusive", text: "x" },
    },
  });
  assert.equal(m.mode, "integrated");
  assert.equal(m.help, false);
  assert.equal(m.calibrating, false);
  assert.equal(m.scale, 1.2);
  assert.deepEqual(
    Object.keys(m.layout).sort(),
    [...ELEMENT_IDS].sort(),
    "layout completo",
  );
  assert.equal(m.hotkeys.help, "Control+Shift+F8");
  assert.equal(m.hotkeys.quit, "", "tecla inválida vira vazio");
  assert.deepEqual(m.game.fullscreen, {
    warn: true,
    kind: "exclusive",
    text: "x",
  });
  const on = normalizeMode({
    mode: "integrated",
    layout: {},
    interactive: true,
    help: true,
    calibrating: true,
  });
  assert.deepEqual([on.help, on.calibrating], [true, true]);
  const panelCal = normalizeMode({
    mode: "panel",
    interactive: true,
    calibrating: true,
  });
  assert.equal(panelCal.calibrating, false, "calibrar só no integrado");
  assert.equal(
    normalizeMode({ mode: "panel", game: { found: true } }).game.found,
    false,
    "painel não segue o jogo",
  );
});

test("escala: --k vem da altura do palco e da escala do usuário", () => {
  assert.equal(stageScale({ width: 1920, height: 1080 }, 1), 1);
  assert.equal(stageScale({ width: 1280, height: 540 }, 2), 1);
  assert.equal(stageScale({ width: 1920, height: 1080 }, 1.5), 1.5);
  assert.equal(stageScale(null, undefined), 1);
  assert.ok(
    stageScale({ width: 10, height: 10 }, 0.1) >= 0.2,
    "piso para o conteúdo nunca sumir",
  );
});

test("acerto do ponteiro: dentro, fora e folga", () => {
  const rect = { left: 10, top: 10, right: 20, bottom: 20 };
  assert.equal(pointInRects(15, 15, [rect]), true);
  assert.equal(pointInRects(25, 15, [rect]), false);
  assert.equal(pointInRects(21, 15, [rect], 2), true);
  assert.equal(pointInRects(15, 15, []), false);
});

test("gestos: mover e redimensionar um elemento ficam dentro do palco", () => {
  const el = { x: 0.1, y: 0.1, w: 0.2, hidden: false };
  const moved = gestureResult("move", el, 100, 50, STAGE, 200);
  assert.ok(moved.x > el.x && moved.y > el.y);
  assert.equal(moved.w, el.w);
  const resized = gestureResult("resize", el, 100, 0, STAGE, 200);
  assert.ok(resized.w > el.w);
  assert.equal(resized.x, el.x);
  const far = gestureResult("move", el, -100000, -100000, STAGE, 200);
  assert.ok(far.x >= 0 && far.y >= 0, "não sai pela esquerda nem pelo topo");
  const out = gestureResult("move", el, 100000, 100000, STAGE, 200);
  assert.ok(
    out.x + out.w <= 1 && out.y <= 1,
    "não sai pela direita nem por baixo",
  );
  assert.deepEqual(
    el,
    { x: 0.1, y: 0.1, w: 0.2, hidden: false },
    "o elemento do início não é alterado",
  );
});

/* ---------- Ajuda ---------- */

const integratedMode = (over = {}) =>
  normalizeMode({
    mode: "integrated",
    layout: {},
    interactive: true,
    help: true,
    hotkeys: {
      toggle: "F9",
      interactive: "F10",
      anchor: "F11",
      quit: "F12",
      help: "Control+Shift+F8",
      calibrate: "Control+Shift+F7",
      copyComp: "Control+Shift+F6",
    },
    game: { found: true, width: 1920, height: 1080 },
    ...over,
  });

test("ajuda: cada botão faz a chamada do host do contrato", () => {
  const mode = integratedMode();
  const A = (data) => helpAction(data, mode);
  assert.deepEqual(A({ act: "close" }), { name: "setHelp", args: [false] });
  const cat = A({ act: "cat", cat: "learn" });
  assert.equal(cat.name, "saveHints");
  assert.equal(cat.args[0].categories.learn, !mode.hints.categories.learn);
  assert.equal(
    cat.args[0].categories.buy,
    mode.hints.categories.buy,
    "as outras não mudam",
  );
  assert.equal(
    A({ act: "cat", cat: "alert" }),
    null,
    "o alerta nunca é desligável",
  );
  for (const v of VERBOSITY_LEVELS)
    assert.equal(A({ act: "verb", v }).args[0].verbosity, v);
  assert.equal(A({ act: "verb", v: "x" }), null);
  assert.deepEqual(A({ act: "scale", d: "-0.1" }), {
    name: "adjustScale",
    args: [-0.1],
  });
  assert.deepEqual(A({ act: "opacity", d: "0.05" }), {
    name: "adjustOpacity",
    args: [0.05],
  });
  assert.equal(A({ act: "scale", d: "abc" }), null);
  const hide = A({ act: "el", id: "plan" });
  assert.equal(hide.name, "saveLayout");
  assert.equal(hide.args[0].plan.hidden, !mode.layout.plan.hidden);
  assert.equal(A({ act: "el", id: "nada" }), null);
  assert.deepEqual(A({ act: "reset" }), {
    name: "saveLayout",
    args: [resetLayout()],
  });
  assert.deepEqual(A({ act: "calibrate" }), {
    name: "setCalibrating",
    args: [true],
  });
  assert.deepEqual(A({ act: "mode", m: "panel" }), {
    name: "setMode",
    args: ["panel"],
  });
  assert.equal(A({ act: "mode", m: "tela" }), null);
  assert.deepEqual(A({ act: "follow" }), {
    name: "setFollow",
    args: [!mode.follow],
  });
  assert.deepEqual(A({ act: "refresh" }), { name: "refreshGame", args: [] });
  assert.equal(A({ act: "desconhecido" }), null);
  assert.equal(A(undefined), null);
});

test("ajuda: atalhos, categorias, verbosidade, elementos, saúde e aviso de tela cheia", () => {
  const mode = integratedMode({
    game: {
      found: true,
      width: 1920,
      height: 1080,
      fullscreen: {
        warn: true,
        kind: "exclusive",
        text: "Use janela sem borda",
      },
    },
  });
  const health = healthOf(
    { status: "ready", notices: [] },
    { game: mode.game },
  );
  const html = helpHtml(mode, health, ui);
  for (const [id] of HOTKEY_LABELS)
    assert.ok(html.includes(`<kbd>${esc(mode.hotkeys[id])}</kbd>`), id);
  for (const c of HINT_CATEGORIES)
    assert.match(html, new RegExp(`data-cat="${c}"`));
  for (const v of VERBOSITY_LEVELS)
    assert.match(html, new RegExp(`data-v="${v}"`));
  for (const id of ELEMENT_IDS)
    assert.match(html, new RegExp(`data-id="${id}"`));
  assert.match(html, /data-act="calibrate"/);
  assert.match(html, /Use janela sem borda/);
  assert.match(html, /class="dot"/);
  assert.match(html, /janela ou janela sem borda/, "limitação do modo");
  assert.ok(!/ disabled/.test(html), "integrado: nada desabilitado");
  const panel = helpHtml(
    normalizeMode({ mode: "panel", interactive: true, help: true }),
    health,
    ui,
  );
  assert.match(panel, /data-act="calibrate" disabled/);
  assert.match(panel, /data-act="reset" disabled/);
  const evil = helpHtml(
    integratedMode({ hotkeys: { help: "<b>x</b>" } }),
    health,
    ui,
  );
  assert.ok(!evil.includes("<kbd><b>x</b>"), "atalho escapado");
});

/* ---------- Calibração ---------- */

test("calibração: contornos de todas as âncoras e controles", () => {
  const shapes = calibrationShapes(rects);
  const count = (kind) => shapes.filter((s) => s.kind === kind).length;
  assert.equal(count("shop"), 5);
  assert.equal(count("bank"), 10);
  assert.equal(count("name"), 5);
  for (const kind of ["hud", "gold", "level", "xp", "stage"])
    assert.equal(count(kind), 1, kind);
  assert.deepEqual(calibrationShapes(null), []);
  const html = calibrationHtml(rects, ui);
  assert.equal((html.match(/class="cal"/g) ?? []).length, shapes.length);
  assert.match(html, /Loja 1/);
  const controls = controlsHtml(DEFAULT_CALIBRATION, 1, ui);
  for (const act of ["nudge", "cscale", "creset", "cstep", "cdone"])
    assert.match(controls, new RegExp(`data-act="${act}"`));
});

test("calibração: setas movem em px do HUD, escala, passo, restaurar e concluir", () => {
  const state = {
    calibration: { ...DEFAULT_CALIBRATION },
    rects,
    stage: STAGE,
    step: 1,
  };
  const right = calibrateAction({ act: "nudge", dx: "1", dy: "0" }, state);
  assert.ok(right.calibration.dx > 0 && right.calibration.dy === 0);
  const right5 = calibrateAction(
    { act: "nudge", dx: "1", dy: "0" },
    { ...state, step: 5 },
  );
  assert.ok(
    right5.calibration.dx > right.calibration.dx,
    "5 px move mais que 1 px",
  );
  const up = calibrateAction({ act: "nudge", dx: "0", dy: "-1" }, state);
  assert.ok(up.calibration.dy < 0);
  const grow = calibrateAction({ act: "cscale", d: "1" }, state);
  assert.ok(grow.calibration.scale > 1);
  const shrink = calibrateAction({ act: "cscale", d: "-1" }, state);
  assert.ok(shrink.calibration.scale < 1);
  assert.deepEqual(calibrateAction({ act: "cstep" }, state), {
    step: STEPS[1],
  });
  assert.deepEqual(calibrateAction({ act: "cstep" }, { ...state, step: 5 }), {
    step: STEPS[0],
  });
  assert.deepEqual(
    calibrateAction(
      { act: "creset" },
      { ...state, calibration: right.calibration },
    ),
    {
      calibration: DEFAULT_CALIBRATION,
    },
  );
  assert.deepEqual(calibrateAction({ act: "cdone" }, state), { done: true });
  assert.equal(
    calibrateAction({ act: "nudge", dx: "x", dy: "0" }, state),
    null,
  );
  assert.equal(calibrateAction({ act: "?" }, state), null);
});

/* ---------- Fronteiras da página ---------- */

const hudDir = path.join(root, "overlay", "hud");
const hudFiles = fs.readdirSync(hudDir).filter((f) => f.endsWith(".mjs"));
const HOST_METHODS = [
  "getMode",
  "onMode",
  "adjustScale",
  "adjustOpacity",
  "dragStart",
  "dragEnd",
  "resizeStart",
  "resizeEnd",
  "exitInteractive",
  "hide",
  "quit",
  "setIgnore",
  "saveLayout",
  "saveCalibration",
  "saveHints",
  "setHelp",
  "setCalibrating",
  "setMode",
  "setFollow",
  "refreshGame",
  // v3: "Copiar comp" e regiões quentes.
  "copyTeamCode",
  "setHot",
  "setHotRects",
  "onCopyRequest",
];

test("página: só chama métodos do host do contrato e o preload os expõe todos", () => {
  const used = new Set();
  for (const f of hudFiles) {
    const code = stripNonCode(read(`overlay/hud/${f}`), { keepStrings: true });
    for (const m of code.matchAll(/\bhost\??\.(\w+)/g)) used.add(m[1]);
    for (const m of code.matchAll(/\bcall\(\s*["'](\w+)["']/g)) used.add(m[1]);
    for (const m of code.matchAll(/typeof host\??\.(\w+)/g)) used.add(m[1]);
  }
  used.delete("version");
  assert.ok(used.size >= 8, "a página usa o host");
  for (const name of used)
    assert.ok(HOST_METHODS.includes(name), `método fora do contrato: ${name}`);
  const preload = read("overlay/preload.cjs");
  for (const name of HOST_METHODS)
    assert.ok(preload.includes(name), `preload.cjs não expõe ${name}`);
});

test("página: todo id que hud.mjs usa existe no HTML e todo elemento tem seções", () => {
  const html = fs.readFileSync(path.join(hudDir, "index.html"), "utf8");
  const code = read("overlay/hud/hud.mjs");
  const ids = new Set([...code.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]));
  assert.ok(ids.size >= 10);
  for (const id of ids)
    assert.ok(html.includes(`id="${id}"`), `index.html não tem #${id}`);
  const sections = /const SECTIONS = \{([\s\S]*?)\};/.exec(code)?.[1] ?? "";
  for (const id of ELEMENT_IDS)
    assert.match(
      sections,
      new RegExp(`\\b${id}:\\s*\\[`),
      `SECTIONS sem ${id}`,
    );
  for (const sec of [...sections.matchAll(/"(\w+)"/g)].map((m) => m[1]))
    assert.ok(html.includes(`id="${sec}"`), `seção sem HTML: ${sec}`);
});

test("página: nenhum módulo do HUD envia entrada ao jogo nem usa pacotes do Node", () => {
  for (const f of hudFiles) {
    const code = stripNonCode(read(`overlay/hud/${f}`), { keepStrings: true });
    assert.ok(
      !/sendInputEvent|SendInput|keybd_event|mouse_event|robotjs|dispatchEvent\s*\(\s*new\s+(?:Mouse|Keyboard|Pointer)Event/.test(
        code,
      ),
      `${f}: simula entrada`,
    );
    assert.ok(!/node:|require\(|process\./.test(code), `${f}: usa Node`);
  }
});

test("página: módulos puros novos não têm DOM no import e health.mjs não importa nada", () => {
  assert.deepEqual(
    [...read("overlay/hud/health.mjs").matchAll(/^import .*$/gm)],
    [],
    "health.mjs é puro",
  );
  for (const f of [
    "markers.mjs",
    "calibrate.mjs",
    "help.mjs",
    "widgets.mjs",
    "health.mjs",
  ]) {
    const code = stripNonCode(read(`overlay/hud/${f}`));
    // Fora de funções o módulo não toca em document/window (o Node não os tem); aqui só se checa o topo do arquivo.
    const top = code
      .split("\n")
      .filter((l) => /^(?:const|let|var|export const)\b/.test(l));
    for (const l of top)
      assert.ok(
        !/\b(?:document|window|localStorage)\b/.test(l),
        `${f}: ${l.trim()}`,
      );
  }
});

test("estilo: pulso com animação desligável, só [data-hit] recebe ponteiro e a escala vem de --k", () => {
  const css = read("overlay/hud/hud.css");
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@keyframes mk-pulse/);
  assert.match(css, /\[data-hit\]\s*\{\s*pointer-events:\s*auto/);
  assert.match(css, /transform:\s*scale\(var\(--k\)\)/);
  assert.match(css, /html\s*\{[^}]*pointer-events:\s*none/);
});
