// Rodar com: node --test tft/helper/tests/overlay-fit.test.mjs
// Adaptação do overlay integrado ao tamanho da janela do jogo: quadro/escala (overlay/hud/fit.mjs), colisões e
// recolhimento por prioridade, resumo no dock e na ajuda, acompanhamento da janela com tolerância e prazo de perda
// (overlay/follow.mjs) e a cadência adaptativa do rastreador. Tudo puro: sem Electron, sem DOM real, sem jogo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, stripNonCode, read } from "./architecture/scan.mjs";
import {
  K_RANGE,
  MIN_LOGICAL_WIDTH,
  aspectLabel,
  arrangeElements,
  fitSummary,
  keepOutRects,
  scaleInfo,
  stageFrame,
  wantedRect,
} from "../overlay/hud/fit.mjs";
import { anchorRects } from "../overlay/hud/geometry.mjs";
import {
  DEFAULT_LAYOUT,
  ELEMENT_IDS,
  ELEMENT_PRIORITY,
  PROTECTED_IDS,
  parseLayout,
} from "../overlay/hud/layout.mjs";
import { placeMarkers } from "../overlay/hud/markers.mjs";
import { applyLayout, stageScale } from "../overlay/hud/widgets.mjs";
import { fitHtml, helpHtml } from "../overlay/hud/help.mjs";
import { createDraw } from "../overlay/hud/draw.mjs";
import {
  RECT_TOLERANCE_PX,
  createGameFollower,
  nearlySameRect,
} from "../overlay/follow.mjs";
import {
  TRACK_FAST_MS,
  TRACK_SETTLE_MS,
  trackerScript,
} from "../overlay/game-tracker.mjs";

// Mesmo escape de v2/js/dom.js (que não carrega no Node: lê matchMedia no import).
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const close = (actual, expected, tol = 0.01, msg = "") =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg} esperado ~${expected}, veio ${actual}`,
  );
const overlap = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/** Invariantes de qualquer arranjo: dentro do palco e sem sobreposição entre os exibidos. */
function checkArrangement(stage, result, { overlapsOk = [] } = {}) {
  const ids = Object.keys(result.rects);
  for (const id of ids) {
    const r = result.rects[id];
    if (overlapsOk.includes(id)) continue;
    assert.ok(r.x >= 0 && r.y >= 0, `${id}: saiu pela esquerda/topo`);
    assert.ok(r.x + r.width <= stage.width, `${id}: passou da direita`);
    assert.ok(r.y + r.height <= stage.height, `${id}: passou de baixo`);
  }
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      if (!overlapsOk.includes(ids[i]) && !overlapsOk.includes(ids[j]))
        assert.ok(
          !overlap(result.rects[ids[i]], result.rects[ids[j]]),
          `${ids[i]} cobre ${ids[j]}`,
        );
}

const SHOWN = ["dock", "bar", "hints", "roll", "items"];
const layout = parseLayout(undefined);

/* ---------- quadro e escala ---------- */

test("stageFrame: HUD 16:9 em janela 16:9, ultrawide, 4:3 e retrato", () => {
  const f = stageFrame({ width: 1920, height: 1080 });
  assert.equal(f.kind, "16:9");
  assert.deepEqual(f.hud, { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(f.bars, { left: 0, right: 0, top: 0 });

  const wide = stageFrame({ width: 3440, height: 1440 });
  assert.equal(wide.kind, "wide");
  assert.deepEqual(wide.hud, { x: 440, y: 0, width: 2560, height: 1440 });
  assert.deepEqual(wide.bars, { left: 440, right: 440, top: 0 });
  assert.equal(wide.aspect, "21:9");

  const four = stageFrame({ width: 1280, height: 960 });
  assert.equal(four.kind, "tall");
  assert.deepEqual(four.hud, { x: 0, y: 240, width: 1280, height: 720 });
  assert.equal(four.bars.top, 240);
  assert.equal(four.aspect, "4:3");

  const portrait = stageFrame({ width: 700, height: 1000 });
  assert.equal(portrait.kind, "tall");
  assert.equal(portrait.hud.width, 700);
  assert.equal(portrait.hud.y + portrait.hud.height, 1000, "colado embaixo");

  for (const bad of [
    null,
    undefined,
    {},
    { width: 0, height: 10 },
    { width: NaN, height: 5 },
  ])
    assert.equal(stageFrame(bad).kind, "unknown");
});

test("aspectLabel: nomes conhecidos dentro de 3% e razão decimal fora disso", () => {
  assert.equal(aspectLabel(1920, 1080), "16:9");
  assert.equal(aspectLabel(1366, 768), "16:9");
  assert.equal(aspectLabel(1280, 800), "16:10");
  assert.equal(aspectLabel(2560, 1080), "21:9");
  assert.equal(aspectLabel(5120, 1440), "32:9");
  assert.equal(aspectLabel(1024, 768), "4:3");
  assert.equal(aspectLabel(1080, 1920), "9:16");
  assert.match(aspectLabel(1000, 1450), /^\d,\d\d:1$/);
  assert.equal(aspectLabel(0, 10), null);
  assert.equal(aspectLabel("a", 10), null);
});

test("escala: o menor dos eixos do HUD 16:9, com piso e teto de legibilidade, sem perder a escolha do usuário", () => {
  const k = (w, h, user = 1) => scaleInfo({ width: w, height: h }, user);
  // 16:9: a altura manda (comportamento antigo preservado).
  assert.equal(k(1920, 1080).k, 1);
  assert.equal(k(1920, 1080, 1.5).k, 1.5);
  close(k(2560, 1440).k, 4 / 3);
  close(k(1280, 720).k, 2 / 3);
  assert.equal(k(1920, 1080).axis, "height");
  // Ultrawide: a altura continua mandando (o HUD ocupa a altura toda).
  close(k(3440, 1440).k, 4 / 3);
  assert.equal(k(3440, 1440).axis, "height");
  // Janela estreita (4:3 e retrato): a LARGURA manda; só pela altura o texto estouraria.
  close(k(1280, 960).k, 2 / 3);
  assert.ok(k(1280, 960).k < 960 / 1080, "mais estreito que pela altura");
  assert.equal(k(1280, 960).axis, "width");
  assert.equal(k(1600, 1200).axis, "width");
  close(k(1600, 1200).k, 1600 / 1920);
  // Piso: janela minúscula não leva o texto abaixo do mínimo legível.
  const small = k(960, 540);
  assert.equal(small.k, K_RANGE.min);
  assert.equal(small.limit, "min");
  close(small.raw, 0.5);
  const portrait = k(700, 1000);
  assert.equal(portrait.k, K_RANGE.min);
  assert.equal(portrait.axis, "width");
  // A escolha do usuário continua multiplicando por cima.
  assert.equal(k(960, 540, 2).k, 1);
  assert.equal(k(960, 540, 2).limit, null);
  close(k(1920, 1080, 0.6).k, 0.6);
  // Teto: 8K não passa do máximo.
  const huge = k(7680, 4320);
  assert.equal(huge.k, K_RANGE.max);
  assert.equal(huge.limit, "max");
  // Entrada inválida: escala 1.
  assert.equal(scaleInfo(null, undefined).k, 1);
  assert.equal(scaleInfo({ width: 1920, height: 1080 }, "x").user, 1);
  assert.equal(scaleInfo({ width: 1920, height: 1080 }, -3).user, 1);
});

test("stageScale (contrato antigo) continua valendo e agora considera a largura", () => {
  assert.equal(stageScale({ width: 1920, height: 1080 }, 1), 1);
  assert.equal(stageScale({ width: 1280, height: 540 }, 2), 1);
  assert.equal(stageScale({ width: 1920, height: 1080 }, 1.5), 1.5);
  assert.equal(stageScale(null, undefined), 1);
  assert.ok(stageScale({ width: 10, height: 10 }, 0.1) >= 0.2);
  assert.equal(
    stageScale({ width: 1280, height: 960 }, 1),
    scaleInfo({ width: 1280, height: 960 }, 1).k,
  );
});

/* ---------- retângulo desejado (layout salvo) ---------- */

test("wantedRect: janela 16:9 reproduz as frações antigas do palco", () => {
  const frame = stageFrame({ width: 1920, height: 1080 });
  const r = wantedRect("bar", DEFAULT_LAYOUT.bar, frame, 1, 100);
  assert.equal(r.x, Math.round(0.735 * 1920));
  assert.equal(r.y, Math.round(0.06 * 1080));
  assert.equal(r.width, Math.round(0.19 * 1920));
  assert.equal(r.height, 100);
});

test("wantedRect: no ultrawide a coluna fica DENTRO do HUD, não nas barras", () => {
  const stage = { width: 3440, height: 1440 };
  const frame = stageFrame(stage);
  for (const id of ELEMENT_IDS) {
    const r = wantedRect(id, DEFAULT_LAYOUT[id], frame, scaleInfo(stage).k, 80);
    assert.ok(r.x >= frame.hud.x, `${id}: invadiu a barra esquerda`);
    assert.ok(
      r.x + r.width <= frame.hud.x + frame.hud.width,
      `${id}: invadiu a barra direita`,
    );
  }
  const bar = wantedRect("bar", DEFAULT_LAYOUT.bar, frame, 4 / 3, 80);
  assert.equal(bar.x, 440 + Math.round(0.735 * 2560));
});

test("wantedRect: largura mínima lógica só com a adaptação ligada; nunca passa do palco; layout inválido vira null", () => {
  const stage = { width: 960, height: 540 };
  const frame = stageFrame(stage);
  const k = scaleInfo(stage).k; // 0,6 (piso)
  const narrow = { x: 0.5, y: 0.2, w: 0.08, hidden: false };
  const auto = wantedRect("hints", narrow, frame, k, 50, true);
  const manual = wantedRect("hints", narrow, frame, k, 50, false);
  assert.equal(manual.width, Math.round(0.08 * 960));
  assert.equal(auto.width, Math.round(MIN_LOGICAL_WIDTH.default * k));
  assert.ok(auto.x + auto.width <= 960, "dentro do palco");
  const tiny = wantedRect(
    "bar",
    DEFAULT_LAYOUT.bar,
    stageFrame({ width: 200, height: 300 }),
    0.6,
    50,
  );
  assert.ok(tiny.width <= 200);
  assert.equal(wantedRect("bar", null, frame, 1, 10), null);
  assert.equal(
    wantedRect("bar", DEFAULT_LAYOUT.bar, stageFrame(null), 1, 10),
    null,
  );
  assert.equal(MIN_LOGICAL_WIDTH.dock < MIN_LOGICAL_WIDTH.default, true);
});

/* ---------- arranjo, colisões e prioridade ---------- */

const H = {
  dock: 34,
  bar: 90,
  hints: 150,
  roll: 150,
  items: 140,
  plan: 180,
  builds: 160,
};
const scaled = (f) =>
  Object.fromEntries(Object.entries(H).map(([k, v]) => [k, Math.round(v * f)]));

test("arrangeElements 1920x1080: o layout padrão cabe sem mexer em nada (nada se move, nada some)", () => {
  const stage = { width: 1920, height: 1080 };
  const res = arrangeElements({
    stage,
    layout,
    heights: H,
    ids: SHOWN,
    k: 1,
    keepOut: keepOutRects(anchorRects(stage)),
  });
  assert.deepEqual(res.collapsed, []);
  assert.deepEqual(res.moved, []);
  for (const id of SHOWN) {
    const want = wantedRect(id, layout[id], res.frame, 1, H[id]);
    assert.deepEqual(res.rects[id], want, id);
  }
  checkArrangement(stage, res);
});

test("arrangeElements: o mesmo layout em 16:9, ultrawide 21:9 e 32:9 mantém as MESMAS frações do HUD", () => {
  for (const [w, h] of [
    [1920, 1080],
    [2560, 1440],
    [3440, 1440],
    [5120, 1440],
  ]) {
    const stage = { width: w, height: h };
    const k = scaleInfo(stage).k;
    const res = arrangeElements({
      stage,
      layout,
      heights: scaled(k),
      ids: SHOWN,
      k,
      keepOut: keepOutRects(anchorRects(stage)),
    });
    assert.deepEqual(res.collapsed, [], `${w}x${h}`);
    assert.deepEqual(res.moved, [], `${w}x${h}`);
    const { hud } = res.frame;
    for (const id of SHOWN) {
      const r = res.rects[id];
      close(
        (r.x - hud.x) / hud.width,
        layout[id].x,
        0.002,
        `${w}x${h} ${id} x`,
      );
      assert.ok(
        r.x >= hud.x && r.x + r.width <= hud.x + hud.width,
        `${w}x${h} ${id} fora do HUD`,
      );
    }
    checkArrangement(stage, res);
  }
});

test("arrangeElements 4:3 e retrato: a coluna segue o HUD colado embaixo e a faixa de cima fica livre", () => {
  const stage = { width: 1280, height: 960 };
  const k = scaleInfo(stage).k;
  const res = arrangeElements({
    stage,
    layout,
    heights: scaled(k),
    ids: SHOWN,
    k,
    keepOut: keepOutRects(anchorRects(stage)),
  });
  assert.deepEqual(res.collapsed, []);
  assert.deepEqual(res.moved, []);
  for (const id of SHOWN)
    assert.ok(res.rects[id].y >= 240, `${id}: acima do HUD`);
  checkArrangement(stage, res);
});

test("arrangeElements: elemento mais importante fica no lugar; o menos importante é empurrado sem cobri-lo", () => {
  const stage = { width: 1920, height: 1080 };
  // As dicas (prioridade menor) são altas e colidiriam com a rolagem: elas se mexem, a rolagem não.
  const heights = { ...H, hints: 420 };
  const res = arrangeElements({
    stage,
    layout,
    heights,
    ids: SHOWN,
    k: 1,
    keepOut: keepOutRects(anchorRects(stage)),
  });
  const roll = res.rects.roll;
  assert.deepEqual(
    roll,
    wantedRect("roll", layout.roll, res.frame, 1, heights.roll),
  );
  assert.ok(ELEMENT_PRIORITY.roll < ELEMENT_PRIORITY.hints);
  assert.ok(
    res.collapsed.includes("hints") || res.moved.includes("hints"),
    "as dicas foram reposicionadas ou recolhidas",
  );
  assert.ok(!res.moved.includes("roll"));
  checkArrangement(stage, res);
});

test("arrangeElements 960x540: sem espaço, recolhe o de menor prioridade e nunca o dock", () => {
  const stage = { width: 960, height: 540 };
  const k = scaleInfo(stage).k;
  assert.equal(k, K_RANGE.min);
  const heights = { dock: 26, bar: 70, hints: 120, roll: 110, items: 140 };
  const keepOut = keepOutRects(anchorRects(stage));
  const res = arrangeElements({
    stage,
    layout,
    heights,
    ids: SHOWN,
    k,
    keepOut,
  });
  assert.deepEqual(res.collapsed, ["hints"]);
  for (const id of ["dock", "bar", "roll", "items"])
    assert.ok(res.rects[id], `${id} deveria aparecer`);
  assert.ok(!res.rects.hints);
  checkArrangement(stage, res);
  // As reposicionadas não cobrem as regiões vitais do HUD.
  for (const id of res.moved)
    for (const z of keepOut)
      assert.ok(!overlap(res.rects[id], z), `${id} cobre o HUD`);
});

test("arrangeElements: a ordem de recolhimento segue a prioridade (construções e plano primeiro)", () => {
  const stage = { width: 960, height: 540 };
  const k = scaleInfo(stage).k;
  const all = { ...layout };
  for (const id of ["plan", "builds"])
    all[id] = { ...layout[id], hidden: false };
  const heights = {
    dock: 26,
    bar: 60,
    roll: 90,
    items: 90,
    hints: 90,
    plan: 140,
    builds: 140,
    keys: 60,
    carousel: 60,
  };
  const res = arrangeElements({
    stage,
    layout: all,
    heights,
    ids: ELEMENT_IDS,
    k,
    keepOut: keepOutRects(anchorRects(stage)),
  });
  assert.ok(
    res.collapsed.length >= 2,
    `esperava recolher vários: ${res.collapsed}`,
  );
  for (const lost of res.collapsed)
    for (const kept of Object.keys(res.rects)) {
      // Quem ficou nunca é menos importante que quem foi recolhido, a menos que tenha cabido onde o outro não coube.
      if (ELEMENT_PRIORITY[kept] > ELEMENT_PRIORITY[lost]) {
        assert.ok(
          heights[kept] <= heights[lost],
          `${kept} ficou e ${lost}, mais importante, foi recolhido, sem ser menor`,
        );
      }
    }
  assert.ok(!res.collapsed.includes("dock"));
  assert.ok(
    res.collapsed.includes("builds"),
    "a de menor prioridade vai primeiro",
  );
  checkArrangement(stage, res);
});

test("arrangeElements: o recolhido volta sozinho quando o espaço volta (função pura do palco)", () => {
  const small = { width: 960, height: 540 };
  const big = { width: 1920, height: 1080 };
  const heights = { dock: 26, bar: 70, hints: 120, roll: 110, items: 140 };
  const run = (stage, h) => {
    const k = scaleInfo(stage).k;
    return arrangeElements({
      stage,
      layout,
      heights: h,
      ids: SHOWN,
      k,
      keepOut: keepOutRects(anchorRects(stage)),
    });
  };
  const a = run(small, heights);
  assert.deepEqual(a.collapsed, ["hints"]);
  const b = run(big, { dock: 34, bar: 90, hints: 150, roll: 150, items: 140 });
  assert.deepEqual(b.collapsed, []);
  // Voltou ao tamanho pequeno: o resultado é o mesmo de antes (determinístico, sem estado escondido).
  assert.deepEqual(run(small, heights), a);
});

test("arrangeElements: histerese: quem estava recolhido só volta com folga em volta", () => {
  const stage = { width: 1920, height: 1080 };
  const lay = parseLayout({
    roll: { x: 0.735, y: 0.1, w: 0.19, hidden: false },
    items: { x: 0.735, y: 0.1 + 308 / 1080, w: 0.19, hidden: false },
  });
  const base = {
    stage,
    layout: lay,
    heights: { roll: 300, items: 100 },
    ids: ["roll", "items"],
    k: 1,
  };
  // roll vai de 108 a 408; items quer y = 416 (folga de 8 px).
  const plain = arrangeElements(base);
  assert.deepEqual(plain.moved, []);
  const sticky = arrangeElements({ ...base, sticky: ["items"] });
  assert.ok(
    sticky.moved.includes("items"),
    "com histerese precisa de mais folga",
  );
  assert.ok(sticky.rects.items.y >= plain.rects.items.y + 8);
  checkArrangement(stage, sticky);
});

test("arrangeElements: usa a barra livre do ultrawide antes de recolher", () => {
  const stage = { width: 5120, height: 1440 };
  const k = scaleInfo(stage).k;
  const heights = { dock: 40, bar: 140, roll: 300, items: 400, hints: 400 };
  const res = arrangeElements({
    stage,
    layout,
    heights,
    ids: SHOWN,
    k,
    keepOut: keepOutRects(anchorRects(stage)),
  });
  assert.deepEqual(res.collapsed, []);
  const { hud } = res.frame;
  assert.ok(res.moved.includes("hints"));
  assert.ok(res.rects.hints.x >= hud.x + hud.width, "foi para a barra direita");
  assert.ok(res.rects.hints.x + res.rects.hints.width <= stage.width);
  checkArrangement(stage, res);
});

test("arrangeElements: em janela mais alta usa a faixa livre de cima antes de recolher", () => {
  const stage = { width: 700, height: 1000 };
  const k = scaleInfo(stage).k;
  const heights = { dock: 20, bar: 80, roll: 100, items: 120, hints: 100 };
  const keepOut = keepOutRects(anchorRects(stage));
  const res = arrangeElements({
    stage,
    layout,
    heights,
    ids: SHOWN,
    k,
    keepOut,
  });
  assert.deepEqual(res.collapsed, []);
  assert.ok(
    Object.values(res.rects).some((r) => r.y < res.frame.hud.y),
    "alguém subiu para a faixa livre",
  );
  checkArrangement(stage, res);
  for (const id of res.moved)
    for (const z of keepOut)
      assert.ok(!overlap(res.rects[id], z), `${id} cobre o HUD`);
});

test("arrangeElements: o dock é protegido (fica mesmo sem vaga) e uma janela minúscula não quebra nada", () => {
  assert.deepEqual([...PROTECTED_IDS], ["dock"]);
  const stage = { width: 300, height: 220 };
  const res = arrangeElements({
    stage,
    layout,
    heights: { dock: 400, bar: 400, roll: 400, items: 400, hints: 400 },
    ids: SHOWN,
    k: 0.6,
  });
  assert.ok(res.rects.dock, "dock sempre aparece");
  assert.deepEqual(res.collapsed.sort(), ["bar", "hints", "items", "roll"]);
  assert.doesNotThrow(() =>
    arrangeElements({ stage: null, layout, ids: SHOWN }),
  );
  assert.deepEqual(
    arrangeElements({ stage: null, layout, ids: SHOWN }).rects,
    {},
  );
  assert.doesNotThrow(() => arrangeElements());
});

test("arrangeElements: no modo manual (interativo) devolve o layout salvo, sem mover nem recolher, e não altera a entrada", () => {
  const stage = { width: 960, height: 540 };
  const frozen = structuredClone(layout);
  const heights = { dock: 26, bar: 400, hints: 400, roll: 400, items: 400 };
  const res = arrangeElements({
    stage,
    layout,
    heights,
    ids: SHOWN,
    k: 0.6,
    auto: false,
  });
  assert.equal(res.auto, false);
  assert.deepEqual(res.collapsed, []);
  assert.deepEqual(res.moved, []);
  for (const id of SHOWN) assert.ok(res.rects[id]);
  assert.deepEqual(layout, frozen, "o layout salvo não foi tocado");
  // Mesmo no automático o layout salvo fica intacto.
  arrangeElements({ stage, layout, heights, ids: SHOWN, k: 0.6 });
  assert.deepEqual(layout, frozen);
});

test("keepOutRects: banco, faixa da loja, nível/ouro e estágio", () => {
  const r = anchorRects({ width: 1920, height: 1080 });
  const zones = keepOutRects(r);
  assert.equal(zones.length, 4);
  const shop = zones.find((z) => z.width > 800);
  assert.ok(shop, "faixa da loja");
  assert.equal(shop.x, r.shopCards[0].x);
  assert.equal(shop.x + shop.width, r.shopCards[4].x + r.shopCards[4].width);
  assert.deepEqual(keepOutRects(null), []);
  assert.deepEqual(keepOutRects({}), []);
});

/* ---------- applyLayout com um DOM falso ---------- */

function fakeMap(heights, { filled = true } = {}) {
  const map = {};
  for (const id of ELEMENT_IDS)
    map[id] = {
      wrap: { hidden: false, dataset: {}, style: {} },
      inner: { getBoundingClientRect: () => ({ height: heights[id] ?? 50 }) },
      body: { children: filled ? [{ hidden: false }] : [] },
    };
  return map;
}

test("applyLayout: posiciona em px do HUD e devolve alturas e arranjo; recolhido some e é marcado", () => {
  const stage = { width: 960, height: 540 };
  const map = fakeMap({ dock: 26, bar: 70, hints: 120, roll: 110, items: 140 });
  const { heights, arrangement } = applyLayout(map, layout, stage, {
    k: scaleInfo(stage).k,
    keepOut: keepOutRects(anchorRects(stage)),
  });
  assert.deepEqual(arrangement.collapsed, ["hints"]);
  assert.equal(map.hints.wrap.hidden, true);
  assert.equal(map.hints.wrap.dataset.collapsed, "1");
  assert.equal(map.items.wrap.hidden, false);
  assert.match(map.items.wrap.style.left, /^\d+px$/);
  assert.match(map.items.wrap.style.width, /^\d+px$/);
  assert.equal(map.items.wrap.style.height, "140px");
  assert.equal(heights.items, 140);
  // Ocultos pelo usuário (builds/plan) não entram.
  assert.equal(map.plan.wrap.hidden, true);
  assert.equal(map.plan.wrap.dataset.collapsed, undefined);
  assert.ok(!("plan" in heights));
});

test("applyLayout: no modo interativo mostra o layout salvo (sem recolher) e os vazios aparecem", () => {
  const stage = { width: 960, height: 540 };
  const map = fakeMap(
    { dock: 26, bar: 70, hints: 120, roll: 110, items: 140 },
    { filled: false },
  );
  const { arrangement } = applyLayout(map, layout, stage, {
    interactive: true,
    k: 0.6,
  });
  assert.equal(arrangement.auto, false);
  assert.deepEqual(arrangement.collapsed, []);
  for (const id of SHOWN) {
    assert.equal(map[id].wrap.hidden, false, id);
    assert.equal(map[id].wrap.dataset.empty, "1");
  }
  // Fora do interativo, vazio fica oculto.
  const again = fakeMap({}, { filled: false });
  applyLayout(again, layout, stage, { k: 0.6 });
  for (const id of ELEMENT_IDS) assert.equal(again[id].wrap.hidden, true, id);
});

test("applyLayout: o recolhido volta quando o palco cresce e a marca de recolhimento sai", () => {
  const heights = { dock: 26, bar: 70, hints: 120, roll: 110, items: 140 };
  const map = fakeMap(heights);
  const small = { width: 960, height: 540 };
  let r = applyLayout(map, layout, small, {
    k: 0.6,
    keepOut: keepOutRects(anchorRects(small)),
  });
  assert.deepEqual(r.arrangement.collapsed, ["hints"]);
  const big = { width: 1920, height: 1080 };
  r = applyLayout(map, layout, big, {
    k: 1,
    keepOut: keepOutRects(anchorRects(big)),
    sticky: r.arrangement.collapsed,
  });
  assert.deepEqual(r.arrangement.collapsed, []);
  assert.equal(map.hints.wrap.hidden, false);
  assert.equal(map.hints.wrap.dataset.collapsed, undefined);
});

/* ---------- resumo, dock e ajuda ---------- */

test("fitSummary: tamanho físico, proporção, escala e o que foi recolhido", () => {
  const arrangement = {
    auto: true,
    collapsed: ["plan", "builds"],
    moved: ["hints"],
  };
  const s = fitSummary(
    { width: 1280, height: 720 },
    { dpr: 1.5, userScale: 1, arrangement },
  );
  assert.deepEqual(s.physical, { width: 1920, height: 1080 });
  assert.deepEqual(s.dip, { width: 1280, height: 720 });
  assert.equal(s.aspect, "16:9");
  assert.equal(s.kind, "16:9");
  assert.match(s.short, /^1920×1080 · 0,67×$/);
  assert.deepEqual(s.collapsed, ["plan", "builds"]);
  assert.equal(s.collapsedLabels.length, 2);
  const text = s.lines.join("\n");
  assert.match(text, /1920×1080 px \(16:9\)/);
  assert.match(text, /tela a 150%/);
  assert.match(text, /Escala efetiva: 0,67×/);
  assert.match(
    text,
    /Recolhido por falta de espaço: .*Plano da composição.*Itens da formação/,
  );
  assert.match(text, /Reposicionado automaticamente/);
  assert.equal(s.title, text);
});

test("fitSummary: janela pequena avisa o mínimo; ultrawide fala das faixas; inválido não lança", () => {
  const small = fitSummary({ width: 960, height: 540 }, {});
  assert.equal(small.limit, "min");
  assert.match(small.lines.join("\n"), /mínimo de legibilidade/);
  const wide = fitSummary({ width: 3440, height: 1440 }, {});
  assert.match(wide.lines.join("\n"), /faixas laterais/);
  assert.equal(wide.aspect, "21:9");
  const tall = fitSummary({ width: 1280, height: 960 }, {});
  assert.match(tall.lines.join("\n"), /faixa em cima/);
  assert.match(tall.lines.join("\n"), /a largura manda/);
  const none = fitSummary(null);
  assert.equal(none.short, "");
  assert.deepEqual(none.lines, []);
  assert.doesNotThrow(() =>
    fitSummary(undefined, { dpr: "x", userScale: NaN }),
  );
});

const stubUi = {
  esc,
  glyph: (n) => `<i class="g-${n}"></i>`,
  portrait: () => "",
  unitPortrait: () => "",
  itemPortrait: () => "",
  nameChip: () => "",
  richText: (t) => String(t ?? ""),
  stars: () => "",
};
const draw = createDraw(stubUi);
const MODE = {
  help: false,
  calibrating: false,
  interactive: false,
  mode: "integrated",
};

test("dock: mostra tamanho e escala, aviso de limite e o que foi recolhido; sem fit fica como antes", () => {
  const plain = draw.dock({ health: [], mode: MODE, hasHost: true });
  assert.ok(!plain.includes("dock-fit") && !plain.includes("dock-fold"));
  const fit = fitSummary(
    { width: 960, height: 540 },
    { arrangement: { auto: true, collapsed: ["plan"], moved: [] } },
  );
  const html = draw.dock({ health: [], mode: MODE, hasHost: true, fit });
  assert.match(html, /class="chip dock-fit" data-limit="min"/);
  assert.match(html, /960×540 · 0,60×/);
  assert.match(html, /dock-fold/);
  assert.match(html, /1 recolhido</);
  assert.match(html, /Plano da composição/);
  const two = draw.dock({
    health: [],
    mode: MODE,
    hasHost: true,
    fit: { ...fit, collapsed: ["plan", "builds"], collapsedLabels: ["a", "b"] },
  });
  assert.match(two, /2 recolhidos</);
  // Texto vindo do resumo é escapado.
  const evil = draw.dock({
    health: [],
    mode: MODE,
    hasHost: true,
    fit: {
      ...fit,
      short: "<b>x</b>",
      title: '"><script>',
      collapsed: [],
      limit: null,
    },
  });
  assert.ok(!evil.includes("<b>x</b>") && !evil.includes("<script>"));
});

test("ajuda: seção 'Tamanho do jogo' só com fit e no modo integrado; texto escapado", () => {
  const health = [];
  const mode = {
    mode: "integrated",
    help: true,
    interactive: true,
    calibrating: false,
    follow: true,
    scale: 1,
    opacity: 1,
    hotkeys: {},
    layout,
    hints: {
      categories: {
        buy: true,
        items: true,
        gold: true,
        wisp: true,
        learn: false,
      },
      verbosity: "normal",
    },
    game: { found: true, width: 960, height: 540, fullscreen: null },
  };
  const ui = { esc, glyph: stubUi.glyph };
  assert.ok(!helpHtml(mode, health, ui).includes("Tamanho do jogo"));
  const fit = fitSummary(
    { width: 960, height: 540 },
    { arrangement: { auto: true, collapsed: ["hints"], moved: [] } },
  );
  const html = helpHtml(mode, health, ui, fit);
  assert.match(html, /<h4>Tamanho do jogo<\/h4>/);
  assert.match(html, /960×540 px \(16:9\)/);
  assert.match(
    html,
    /data-tone="warn">Recolhido por falta de espaço: Dicas sem alvo no jogo/,
  );
  assert.match(html, /sem mexer no layout salvo/);
  assert.ok(
    !helpHtml({ ...mode, mode: "panel" }, health, ui, fit).includes(
      "Tamanho do jogo",
    ),
  );
  assert.equal(fitHtml(null, esc), "");
  assert.equal(fitHtml({ lines: [] }, esc), "");
  assert.ok(!fitHtml({ lines: ["<img src=x>"] }, esc).includes("<img"));
});

/* ---------- etiquetas evitam os elementos ---------- */

test("placeMarkers: `avoid` afasta a etiqueta dos elementos do overlay; sem ele, nada muda", () => {
  const stage = { width: 1920, height: 1080 };
  const rects = anchorRects(stage);
  const hint = {
    id: "buy:1",
    text: "Compre",
    tone: "go",
    category: "buy",
    anchor: { kind: "shop", slot: 1 },
    anchors: [{ kind: "shop", slot: 1 }],
  };
  const base = placeMarkers([hint], rects, stage, { k: 1 });
  assert.equal(base.length, 1);
  const without = placeMarkers([hint], rects, stage, { k: 1, avoid: [] });
  assert.deepEqual(without[0].label, base[0].label);
  const l = base[0].label;
  const blocker = {
    x: l.x - 5,
    y: l.y - 5,
    width: l.width + 10,
    height: l.height + 10,
  };
  const moved = placeMarkers([hint], rects, stage, { k: 1, avoid: [blocker] });
  const m = moved[0].label;
  assert.ok(
    !overlap({ x: m.x, y: m.y, width: m.width, height: m.height }, blocker),
    "a etiqueta saiu de cima do elemento",
  );
  // Lixo em `avoid` é ignorado.
  const junk = placeMarkers([hint], rects, stage, {
    k: 1,
    avoid: [null, {}, { x: 1 }, "x"],
  });
  assert.deepEqual(junk[0].label, base[0].label);
});

/* ---------- acompanhamento da janela do jogo ---------- */

function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    setTimer(fn, ms) {
      const id = { fn, at: t + ms };
      timers.push(id);
      return id;
    },
    clearTimer(id) {
      const i = timers.indexOf(id);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms) {
      t += ms;
      for (;;) {
        const due = timers
          .filter((x) => x.at <= t)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
    },
    pending: () => timers.length,
  };
}

const R = (x, y, width, height) => ({ x, y, width, height });

test("nearlySameRect: tolerância por campo e entradas inválidas", () => {
  assert.equal(RECT_TOLERANCE_PX, 2);
  assert.equal(nearlySameRect(R(0, 0, 1920, 1080), R(2, -2, 1918, 1082)), true);
  assert.equal(nearlySameRect(R(0, 0, 1920, 1080), R(3, 0, 1920, 1080)), false);
  assert.equal(nearlySameRect(R(0, 0, 1920, 1080), R(0, 0, 1920, 1083)), false);
  assert.equal(
    nearlySameRect(R(0, 0, 1920, 1080), R(0, 0, 1920, 1080), 0),
    true,
  );
  assert.equal(nearlySameRect(null, R(0, 0, 1, 1)), false);
  assert.equal(nearlySameRect(R(0, 0, 0, 0), R(0, 0, 0, 0)), false);
});

function newFollower(extra = {}) {
  const clock = fakeClock();
  const events = [];
  const f = createGameFollower({
    onRect: (rect, info) => events.push(["rect", rect, info]),
    onLost: () => events.push(["lost"]),
    onSettle: (rect) => events.push(["settle", rect]),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...extra,
  });
  return { f, clock, events };
}

test("follower: o primeiro retângulo aplica na hora e assenta depois; tremida de 1-2 px é ignorada", () => {
  const { f, clock, events } = newFollower();
  f.push(R(100, 50, 1920, 1080));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0][2], {
    first: true,
    recovered: false,
    resized: true,
  });
  f.push(R(101, 51, 1921, 1079)); // ≤ 2 px: nada
  f.push(R(100, 52, 1920, 1080));
  assert.equal(events.length, 1);
  assert.deepEqual(f.current(), R(100, 50, 1920, 1080));
  clock.advance(399);
  assert.equal(events.length, 1);
  clock.advance(1);
  assert.deepEqual(events.at(-1), ["settle", R(100, 50, 1920, 1080)]);
});

test("follower: arrastar a borda aplica cada passo ao vivo e só assenta uma vez, depois da última mudança", () => {
  const { f, clock, events } = newFollower();
  f.push(R(0, 0, 1920, 1080));
  for (let w = 1900; w >= 1500; w -= 100) {
    clock.advance(120);
    f.push(R(0, 0, w, 1080));
  }
  const rects = events.filter((e) => e[0] === "rect");
  assert.equal(rects.length, 6, "o inicial e cinco passos do arrasto");
  assert.equal(rects.at(-1)[2].resized, true);
  assert.equal(
    events.filter((e) => e[0] === "settle").length,
    0,
    "ainda mudando",
  );
  clock.advance(400);
  const settles = events.filter((e) => e[0] === "settle");
  assert.equal(settles.length, 1);
  assert.deepEqual(settles[0][1], R(0, 0, 1500, 1080));
});

test("follower: só mover (sem mudar o tamanho) não marca `resized`", () => {
  const { f, events } = newFollower();
  f.push(R(0, 0, 1920, 1080));
  f.push(R(200, 100, 1920, 1080));
  assert.equal(events[1][2].resized, false);
});

test("follower: minimizar e restaurar: a perda só vale depois do prazo; a volta antes dele não faz nada", () => {
  const { f, clock, events } = newFollower();
  f.push(R(0, 0, 1920, 1080));
  clock.advance(500); // assenta
  events.length = 0;
  // Piscada curta (troca janela/borderless): sumiu e voltou dentro do prazo.
  f.push(null);
  clock.advance(1000);
  f.push(R(0, 0, 1920, 1080));
  clock.advance(5000);
  assert.deepEqual(events, [], "nada aconteceu");
  assert.equal(f.lost(), false);
  // Minimizado de verdade.
  f.push(null);
  f.push(null); // repetido não reinicia o prazo
  clock.advance(1499);
  assert.equal(events.length, 0);
  clock.advance(1);
  assert.deepEqual(events, [["lost"]]);
  assert.equal(f.lost(), true);
  assert.equal(f.current(), null);
  // Restaurado.
  f.push(R(0, 0, 1920, 1080));
  assert.deepEqual(events[1][2], {
    first: true,
    recovered: true,
    resized: true,
  });
  assert.equal(f.lost(), false);
});

test("follower: alternar janela e janela sem borda é uma mudança de tamanho como outra qualquer", () => {
  const { f, clock, events } = newFollower();
  f.push(R(100, 100, 1600, 900));
  f.push(null);
  clock.advance(200);
  f.push(R(0, 0, 1920, 1080));
  const rects = events.filter((e) => e[0] === "rect");
  assert.equal(rects.length, 2);
  assert.equal(rects[1][2].recovered, false);
  assert.equal(rects[1][2].resized, true);
});

test("follower: sem jogo nunca visto, a ausência não gera perda; reset limpa tudo e cancela os prazos", () => {
  const { f, clock, events } = newFollower();
  f.push(null);
  clock.advance(10000);
  assert.deepEqual(events, []);
  f.push(R(0, 0, 800, 600));
  f.push(null);
  assert.ok(clock.pending() >= 1);
  f.reset();
  assert.equal(clock.pending(), 0);
  assert.equal(f.current(), null);
  clock.advance(10000);
  assert.equal(events.filter((e) => e[0] === "lost").length, 0);
  // Retângulo inválido conta como ausência, não como jogo.
  f.push(R(0, 0, 0, 0));
  assert.equal(f.current(), null);
});

test("follower: DPI misto ou monitor trocado chegam como mudança normal de retângulo", () => {
  const { f, events } = newFollower();
  f.push(R(0, 0, 1920, 1080)); // monitor 1 (100%)
  f.push(R(1920, 0, 2560, 1440)); // monitor 2 (outro tamanho/escala)
  assert.equal(events.filter((e) => e[0] === "rect").length, 2);
  assert.equal(events[1][2].resized, true);
});

/* ---------- rastreador: cadência adaptativa ---------- */

test("trackerScript: cadência rápida enquanto o retângulo muda, lenta em repouso, sem aspas duplas nem entrada", () => {
  const script = trackerScript({ parentPid: 1, intervalMs: 750 });
  assert.ok(!script.includes('"'));
  assert.ok(script.includes(`Start-Sleep -Milliseconds ${TRACK_FAST_MS}`));
  assert.ok(script.includes("Start-Sleep -Milliseconds 750"));
  assert.ok(script.includes(`AddMilliseconds(${TRACK_SETTLE_MS})`));
  assert.ok(script.includes("$line -ne $last"));
  // A decisão é do próprio script: não lê entrada padrão nem usa o Electron.
  assert.ok(!/Read-Host|\[Console\]::In|ReadLine/.test(script));
  // Parâmetros sanitizados: o rápido tem piso e nunca passa do lento; o prazo tem faixa.
  const odd = trackerScript({ intervalMs: 300, fastMs: 9999, settleMs: 1 });
  assert.ok(
    odd.includes("Start-Sleep -Milliseconds 300 }") ||
      odd.includes("-Milliseconds 300"),
  );
  assert.ok(odd.includes("AddMilliseconds(500)"));
  const floor = trackerScript({ fastMs: 1 });
  assert.ok(floor.includes("Start-Sleep -Milliseconds 50"));
  const junk = trackerScript({ fastMs: "7; calc", settleMs: "x" });
  assert.ok(!junk.includes("calc"));
  assert.ok(junk.includes(`Start-Sleep -Milliseconds ${TRACK_FAST_MS}`));
});

/* ---------- fronteiras do módulo ---------- */

test("fit.mjs e follow.mjs são puros: sem DOM, sem node:*, sem entrada ao jogo", () => {
  for (const file of ["overlay/hud/fit.mjs", "overlay/follow.mjs"]) {
    const code = stripNonCode(read(file), { keepStrings: true });
    assert.ok(
      !/node:|require\(|process\.|\bdocument\b|\bwindow\b|localStorage/.test(
        code,
      ),
      file,
    );
    assert.ok(
      !/sendInputEvent|SendInput|keybd_event|mouse_event|robotjs/.test(code),
      `${file}: simula entrada`,
    );
  }
  const hudFit = fs.readFileSync(
    path.join(root, "overlay", "hud", "fit.mjs"),
    "utf8",
  );
  assert.ok(
    hudFit.includes("hudRect"),
    "usa o hudRect de geometry.mjs como referência",
  );
});

test("contrato do preload (overlayHost v3, só acréscimos à v2): a adaptação não pede nada ao host", () => {
  const preload = read("overlay/preload.cjs");
  assert.match(preload, /version: 3/);
  for (const f of ["fit.mjs"]) {
    const code = stripNonCode(read(`overlay/hud/${f}`), { keepStrings: true });
    assert.ok(!/\bhost\b/.test(code), `${f} não fala com o host`);
  }
});
