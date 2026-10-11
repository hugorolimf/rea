// Rodar com: node --test tft/helper/tests/overlay-geometry.test.mjs
// Geometria e layout do overlay integrado (overlay/hud/geometry.mjs, layout.mjs): os números do HUD batem com o leitor de
// tela (guarda contra divergência), o retângulo 16:9 do HUD em várias janelas, os retângulos das âncoras com e sem
// calibração, a resolução de âncoras, a posição das etiquetas e o layout dos elementos.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root } from "./architecture/scan.mjs";
import {
  ANCHOR_SIDE,
  BANK_PAD,
  CALIBRATION_LIMITS,
  DEFAULT_CALIBRATION,
  HUD_REGIONS,
  LEVEL_XP_PAD,
  SHOP_CARD,
  anchorRects,
  applyCalibration,
  hudRect,
  nudgeCalibration,
  parseCalibration,
  placeLabel,
  resolveAnchor,
} from "../overlay/hud/geometry.mjs";
import {
  DEFAULT_LAYOUT,
  EDGE_MARGIN,
  ELEMENT_IDS,
  ELEMENT_LABELS,
  W_RANGE,
  clampElement,
  moveElement,
  parseLayout,
  resetLayout,
  resizeElement,
  setHidden,
} from "../overlay/hud/layout.mjs";

const close = (actual, expected, tol = 0.02, msg = "") =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg} esperado ~${expected}, veio ${actual}`,
  );
const closeRect = (actual, expected, tol = 0.02, msg = "") => {
  for (const k of ["x", "y", "width", "height"])
    close(actual[k], expected[k], tol, `${msg}.${k}`);
};
const inside = (r, outer, msg = "") => {
  assert.ok(r.x >= outer.x - 0.01, `${msg}: x ${r.x} < ${outer.x}`);
  assert.ok(r.y >= outer.y - 0.01, `${msg}: y ${r.y} < ${outer.y}`);
  assert.ok(
    r.x + r.width <= outer.x + outer.width + 0.01,
    `${msg}: passa da direita`,
  );
  assert.ok(
    r.y + r.height <= outer.y + outer.height + 0.01,
    `${msg}: passa de baixo`,
  );
};

/* ---------- (a) guarda contra divergência com o leitor de tela ---------- */

const ps1 = fs.readFileSync(path.join(root, "screen-reader.ps1"), "utf8");

/** Tabela `$NOME = @{ X = 0.1; Y = ... }` do leitor, com as chaves em minúsculas (tolerante a espaços e a comentários). */
function psTable(name) {
  const m = new RegExp(`^\\$${name}\\s*=\\s*@\\{([^}]*)\\}`, "m").exec(ps1);
  assert.ok(m, `$${name} não encontrada em screen-reader.ps1`);
  const table = {};
  for (const part of m[1].split(";")) {
    if (!part.trim()) continue;
    const kv = /^\s*(\w+)\s*=\s*(-?[0-9]*\.?[0-9]+)\s*$/.exec(part);
    assert.ok(kv, `$${name}: trecho ilegível "${part}"`);
    table[kv[1].toLowerCase()] = Number(kv[2]);
  }
  return table;
}

test("geometria: HUD_REGIONS bate com os números do leitor (screen-reader.ps1)", () => {
  const pairs = [
    ["GOLD", HUD_REGIONS.gold],
    ["LEVEL", HUD_REGIONS.level],
    ["XP", HUD_REGIONS.xp],
    ["STAGE", HUD_REGIONS.stage],
    ["SLOT", HUD_REGIONS.bankSlot],
    ["SHOP", HUD_REGIONS.shopName],
  ];
  for (const [name, region] of pairs) {
    const table = psTable(name);
    assert.deepEqual(
      Object.keys(table).sort(),
      Object.keys(region).sort(),
      `$${name}: o leitor e HUD_REGIONS têm chaves diferentes`,
    );
    for (const [key, value] of Object.entries(table))
      assert.equal(
        region[key],
        value,
        `$${name}.${key}: leitor ${value}, geometry.mjs ${region[key]}`,
      );
  }
  assert.equal(HUD_REGIONS.bankSlot.count, 10);
  assert.equal(HUD_REGIONS.shopName.count, 5);
});

test("geometria: as tabelas são congeladas e a tolerância de 16:9 do leitor continua 1%", () => {
  assert.ok(Object.isFrozen(HUD_REGIONS));
  for (const r of Object.values(HUD_REGIONS)) assert.ok(Object.isFrozen(r));
  assert.ok(
    Object.isFrozen(SHOP_CARD) &&
      Object.isFrozen(BANK_PAD) &&
      Object.isFrozen(LEVEL_XP_PAD),
  );
  // Hud-Rect do leitor: a diferença |w*9 - h*16| tolerada é 1% de h*16.
  assert.match(
    ps1,
    /\[Math\]::Abs\(\$w \* 9 - \$h \* 16\) -le \$h \* 16 \* 0\.01/,
  );
});

/* ---------- (b) hudRect ---------- */

test("hudRect: janela 16:9 (exata e dentro de 1%) devolve a própria área cliente", () => {
  assert.deepEqual(hudRect({ x: 0, y: 0, width: 1920, height: 1080 }), {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(hudRect({ x: 5, y: 7, width: 2044, height: 1149 }, "top"), {
    x: 5,
    y: 7,
    width: 2044,
    height: 1149,
  });
  // 1938x1080: diferença 162 <= 172,8 (1% de 17280) -> ainda é 16:9.
  assert.deepEqual(hudRect({ x: 0, y: 0, width: 1938, height: 1080 }), {
    x: 0,
    y: 0,
    width: 1938,
    height: 1080,
  });
});

test("hudRect: janela mais larga (ultrawide) ocupa a altura toda, centralizada", () => {
  assert.deepEqual(hudRect({ x: 0, y: 0, width: 2560, height: 1081 }), {
    x: 319,
    y: 0,
    width: 1922,
    height: 1081,
  });
  assert.deepEqual(hudRect({ x: 0, y: 0, width: 3440, height: 1440 }), {
    x: 440,
    y: 0,
    width: 2560,
    height: 1440,
  });
  assert.deepEqual(hudRect({ x: 0, y: 0, width: 2560, height: 1351 }), {
    x: 79,
    y: 0,
    width: 2402,
    height: 1351,
  });
  // A âncora não importa quando a janela é mais larga.
  assert.deepEqual(
    hudRect({ x: 0, y: 0, width: 3440, height: 1440 }, "top"),
    hudRect({ x: 0, y: 0, width: 3440, height: 1440 }, "bottom"),
  );
  // Origem da área cliente é somada.
  assert.deepEqual(hudRect({ x: 100, y: 50, width: 3440, height: 1440 }), {
    x: 540,
    y: 50,
    width: 2560,
    height: 1440,
  });
});

test("hudRect: janela mais alta que 16:9 ocupa a largura toda; âncora top ou bottom", () => {
  const client = { x: 0, y: 0, width: 1600, height: 1000 };
  assert.deepEqual(hudRect(client, "bottom"), {
    x: 0,
    y: 100,
    width: 1600,
    height: 900,
  });
  assert.deepEqual(hudRect(client, "top"), {
    x: 0,
    y: 0,
    width: 1600,
    height: 900,
  });
  assert.deepEqual(
    hudRect(client),
    { x: 0, y: 100, width: 1600, height: 900 },
    "padrão é bottom",
  );
  assert.deepEqual(
    hudRect({ x: 10, y: 20, width: 1600, height: 1000 }, "bottom"),
    {
      x: 10,
      y: 120,
      width: 1600,
      height: 900,
    },
  );
});

test("hudRect: tolerância de 1% (1938 é 16:9; 1940 não) e arredondamento do .NET (metade vai ao par)", () => {
  // 1940x1080: diferença 180 > 172,8 -> HUD de 1920 centralizado.
  assert.deepEqual(hudRect({ x: 0, y: 0, width: 1940, height: 1080 }), {
    x: 10,
    y: 0,
    width: 1920,
    height: 1080,
  });
  // 8x10: altura do HUD = 4,5 -> [Math]::Round do leitor dá 4 (par), não 5.
  assert.deepEqual(hudRect({ x: 0, y: 0, width: 8, height: 10 }, "bottom"), {
    x: 0,
    y: 6,
    width: 8,
    height: 4,
  });
});

test("hudRect: entrada inválida não lança", () => {
  const zero = { x: 0, y: 0, width: 0, height: 0 };
  assert.deepEqual(hudRect(undefined), zero);
  assert.deepEqual(hudRect(null), zero);
  assert.deepEqual(hudRect({ x: "a", y: 0, width: 10, height: 10 }), zero);
  assert.deepEqual(hudRect({ x: 0, y: 0, width: NaN, height: 10 }), zero);
});

/* ---------- (c) anchorRects e calibração ---------- */

test("anchorRects 1920x1080: regiões do leitor, loja com 5 cartões e banco com 10 espaços", () => {
  const r = anchorRects({ width: 1920, height: 1080 });
  assert.deepEqual(r.hud, { x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(r.hudTop, r.hud);
  closeRect(
    r.gold,
    { x: 1020.67, y: 884.63, width: 45.12, height: 28.19 },
    0.02,
    "ouro",
  );
  closeRect(
    r.level,
    { x: 385.73, y: 882.79, width: 37.63, height: 26.35 },
    0.02,
    "nível",
  );
  closeRect(
    r.xp,
    { x: 464.64, y: 882.79, width: 54.53, height: 26.35 },
    0.02,
    "xp",
  );
  closeRect(
    r.stage,
    { x: 764.54, y: 7.56, width: 38.59, height: 24.41 },
    0.02,
    "estágio",
  );

  assert.equal(r.shopNames.length, 5);
  assert.equal(r.shopCards.length, 5);
  r.shopCards.forEach((card, i) => {
    inside(card, r.hud, `cartão ${i + 1}`);
    inside(r.shopNames[i], card, `nome ${i + 1}`);
    if (i > 0) {
      close(card.x - r.shopCards[i - 1].x, 0.105 * 1920, 0.02, "passo da loja");
      assert.ok(
        card.x >= r.shopCards[i - 1].x + r.shopCards[i - 1].width,
        "cartões não se sobrepõem",
      );
      assert.equal(card.y, r.shopCards[0].y);
    }
  });
  close(r.shopNames[0].x, 0.2896 * 1920, 0.02);
  close(r.shopNames[0].y, 0.9661 * 1080, 0.02);

  assert.equal(r.bankSlots.length, 10);
  r.bankSlots.forEach((slot, i) => {
    inside(slot, r.bank, `espaço ${i + 1}`);
    assert.equal(slot.x, r.bankSlots[0].x, "mesma coluna");
    assert.equal(slot.width, r.bankSlots[0].width);
    if (i > 0)
      close(
        slot.y - r.bankSlots[i - 1].y,
        0.04875 * 1080,
        0.02,
        "passo do banco",
      );
  });
  closeRect(
    r.bankSlots[0],
    { x: 13.61, y: 263.24, width: 39.46, height: 41.36 },
    0.02,
    "1º espaço",
  );
  inside(r.bank, r.hud, "coluna do banco");

  // A união Nível+XP cobre os dois com folga.
  inside(r.level, r.levelXp, "nível em levelXp");
  inside(r.xp, r.levelXp, "xp em levelXp");
  assert.ok(
    r.levelXp.width > r.xp.x + r.xp.width - r.level.x,
    "folga horizontal",
  );
  assert.ok(r.levelXp.height > r.level.height, "folga vertical");
  inside(r.levelXp, r.hud, "levelXp no HUD");
});

test("anchorRects 2560x1351: o HUD fica centralizado, a coluna do banco na borda esquerda", () => {
  const r = anchorRects({ width: 2560, height: 1351 });
  assert.deepEqual(r.hud, { x: 79, y: 0, width: 2402, height: 1351 });
  close(r.gold.x, 79 + 2402 * 0.5316, 0.02);
  close(r.gold.y, 1351 * 0.8191, 0.02);
  assert.equal(r.shopCards.length, 5);
  for (const [i, card] of r.shopCards.entries())
    inside(card, r.hud, `cartão ${i + 1}`);
  assert.equal(r.bankSlots.length, 10);
  // O leitor acha a coluna na borda esquerda da janela (79 px à esquerda do que o HUD centralizado diria).
  close(r.bankSlots[0].x, 2402 * 0.00709, 0.02, "x do 1º espaço");
  assert.ok(
    r.bankSlots[0].x < r.hud.x,
    "banco fora do retângulo 16:9 centralizado",
  );
  close(r.bankSlots[9].y - r.bankSlots[0].y, 9 * 0.04875 * 1351, 0.05);
  for (const [i, slot] of r.bankSlots.entries())
    inside(slot, r.bank, `espaço ${i + 1}`);
});

test("anchorRects 3440x1440: ouro dentro do HUD centralizado; janela mais alta: estágio no HUD de cima", () => {
  const wide = anchorRects({ width: 3440, height: 1440 });
  assert.deepEqual(wide.hud, { x: 440, y: 0, width: 2560, height: 1440 });
  close(wide.gold.x, 440 + 2560 * 0.5316, 0.02);
  close(wide.stage.x, 440 + 2560 * 0.3982, 0.02);
  const tall = anchorRects({ width: 1600, height: 1000 });
  assert.deepEqual(tall.hud, { x: 0, y: 100, width: 1600, height: 900 });
  assert.deepEqual(tall.hudTop, { x: 0, y: 0, width: 1600, height: 900 });
  close(tall.stage.y, 0.007 * 900, 0.02, "estágio colado no topo");
  close(tall.gold.y, 100 + 0.8191 * 900, 0.02, "ouro no HUD de baixo");
  close(tall.shopNames[0].y, 100 + 0.9661 * 900, 0.02, "loja no HUD de baixo");
});

test("anchorRects: palco inválido ou calibração inválida não lança", () => {
  for (const stage of [
    undefined,
    null,
    {},
    { width: "a", height: NaN },
    { width: -5, height: -5 },
  ]) {
    const r = anchorRects(stage);
    assert.equal(r.shopCards.length, 5);
    assert.equal(r.bankSlots.length, 10);
    assert.deepEqual(r.hud, { x: 0, y: 0, width: 0, height: 0 });
  }
  const base = anchorRects({ width: 1920, height: 1080 });
  assert.deepEqual(anchorRects({ width: 1920, height: 1080 }, "lixo"), base);
  assert.deepEqual(anchorRects({ width: 1920, height: 1080 }, null), base);
  assert.deepEqual(
    anchorRects({ width: 1920, height: 1080 }, DEFAULT_CALIBRATION),
    base,
  );
});

test("calibração: identidade, deslocamento e escala em torno do centro do HUD", () => {
  const stage = { width: 1920, height: 1080 };
  const base = anchorRects(stage);
  // Deslocamento: dx/dy são frações da largura/altura do HUD.
  const shifted = anchorRects(stage, { dx: 0.01, dy: -0.02, scale: 1 });
  const sx = 0.01 * 1920;
  const sy = -0.02 * 1080;
  const same = (a, b, msg) => {
    close(a.x - b.x, sx, 0.02, `${msg}.x`);
    close(a.y - b.y, sy, 0.02, `${msg}.y`);
    close(a.width, b.width, 0.02, `${msg}.largura`);
    close(a.height, b.height, 0.02, `${msg}.altura`);
  };
  same(shifted.gold, base.gold, "ouro");
  same(shifted.stage, base.stage, "estágio");
  same(shifted.levelXp, base.levelXp, "levelXp");
  shifted.shopCards.forEach((c, i) =>
    same(c, base.shopCards[i], `cartão ${i + 1}`),
  );
  shifted.bankSlots.forEach((c, i) =>
    same(c, base.bankSlots[i], `espaço ${i + 1}`),
  );
  same(shifted.bank, base.bank, "banco");
  // O quadro de referência não se move com a calibração.
  assert.deepEqual(shifted.hud, base.hud);
  assert.deepEqual(shifted.hudTop, base.hudTop);

  // Escala 1,5 em torno do centro (960, 540).
  const scaled = anchorRects(stage, { dx: 0, dy: 0, scale: 1.5 });
  close(scaled.gold.x, 960 + (base.gold.x - 960) * 1.5, 0.03);
  close(scaled.gold.y, 540 + (base.gold.y - 540) * 1.5, 0.03);
  close(scaled.gold.width, base.gold.width * 1.5, 0.03);
  close(scaled.gold.height, base.gold.height * 1.5, 0.03);
  close(scaled.shopCards[2].width, base.shopCards[2].width * 1.5, 0.03);
});

test("applyCalibration: um retângulo no centro do HUD não sai do centro ao mudar a escala", () => {
  const hud = { x: 100, y: 50, width: 1600, height: 900 };
  const center = { x: 900 - 10, y: 500 - 10, width: 20, height: 20 };
  const out = applyCalibration(center, { dx: 0, dy: 0, scale: 1.5 }, hud);
  close(out.x + out.width / 2, 900, 1e-9);
  close(out.y + out.height / 2, 500, 1e-9);
  assert.equal(out.width, 30);
  const moved = applyCalibration(center, { dx: 0.1, dy: -0.1, scale: 1 }, hud);
  close(moved.x - center.x, 160, 1e-9);
  close(moved.y - center.y, -90, 1e-9);
  assert.deepEqual(applyCalibration(center, DEFAULT_CALIBRATION, hud), center);
});

test("parseCalibration: lixo vira o padrão, parcial completa, limites aplicados, nunca lança", () => {
  for (const junk of [
    undefined,
    null,
    "x",
    7,
    [],
    true,
    {},
    { dx: "a", dy: NaN, scale: Infinity },
    { dx: null },
  ])
    assert.deepEqual(
      parseCalibration(junk),
      { dx: 0, dy: 0, scale: 1 },
      JSON.stringify(junk),
    );
  assert.deepEqual(parseCalibration({ dx: 0.1 }), { dx: 0.1, dy: 0, scale: 1 });
  assert.deepEqual(parseCalibration({ dx: 5, dy: -5, scale: 9 }), {
    dx: 0.25,
    dy: -0.25,
    scale: 1.6,
  });
  assert.deepEqual(parseCalibration({ scale: 0.1 }), {
    dx: 0,
    dy: 0,
    scale: 0.6,
  });
  assert.deepEqual(CALIBRATION_LIMITS.dx, { min: -0.25, max: 0.25 });
  assert.deepEqual(CALIBRATION_LIMITS.scale, { min: 0.6, max: 1.6 });
  const a = parseCalibration({ dx: 0.05 });
  const b = parseCalibration({ dx: 0.05 });
  assert.notEqual(a, b, "objeto novo a cada chamada");
  assert.deepEqual(DEFAULT_CALIBRATION, { dx: 0, dy: 0, scale: 1 });
  assert.ok(Object.isFrozen(DEFAULT_CALIBRATION));
});

test("nudgeCalibration: soma, limita, arredonda a 4 casas e não altera a entrada", () => {
  assert.deepEqual(nudgeCalibration(DEFAULT_CALIBRATION, { dx: 0.0123456 }), {
    dx: 0.0123,
    dy: 0,
    scale: 1,
  });
  assert.deepEqual(
    nudgeCalibration({ dx: 0.1, dy: 0, scale: 1 }, { dx: 0.2 }),
    { dx: 0.25, dy: 0, scale: 1 },
  );
  assert.deepEqual(
    nudgeCalibration({ dx: -0.2, dy: 0, scale: 1 }, { dx: -0.2, dy: -1 }),
    {
      dx: -0.25,
      dy: -0.25,
      scale: 1,
    },
  );
  let cal = DEFAULT_CALIBRATION;
  for (let i = 0; i < 3; i += 1) cal = nudgeCalibration(cal, { dscale: 0.1 });
  assert.equal(cal.scale, 1.3, "sem sobra de ponto flutuante");
  for (let i = 0; i < 30; i += 1) cal = nudgeCalibration(cal, { dscale: 0.1 });
  assert.equal(cal.scale, 1.6);
  for (let i = 0; i < 30; i += 1) cal = nudgeCalibration(cal, { dscale: -0.1 });
  assert.equal(cal.scale, 0.6);
  const input = { dx: 0.1, dy: 0.1, scale: 1.1 };
  const out = nudgeCalibration(input, { dx: 0.01 });
  assert.deepEqual(input, { dx: 0.1, dy: 0.1, scale: 1.1 });
  assert.notEqual(out, input);
  assert.deepEqual(nudgeCalibration("lixo", undefined), {
    dx: 0,
    dy: 0,
    scale: 1,
  });
  assert.deepEqual(
    nudgeCalibration(DEFAULT_CALIBRATION, { dx: "a", dy: NaN, dscale: null }),
    DEFAULT_CALIBRATION,
  );
});

/* ---------- (d) resolveAnchor ---------- */

test("resolveAnchor: cada tipo de âncora aponta para o retângulo certo", () => {
  const r = anchorRects({ width: 1920, height: 1080 });
  assert.equal(resolveAnchor({ kind: "shop", slot: 1 }, r), r.shopCards[0]);
  assert.equal(resolveAnchor({ kind: "shop", slot: 5 }, r), r.shopCards[4]);
  for (const slot of [0, 6, -1, 2.5, "2", null, undefined, NaN])
    assert.equal(
      resolveAnchor({ kind: "shop", slot }, r),
      null,
      `loja slot ${String(slot)}`,
    );
  assert.equal(resolveAnchor({ kind: "bank" }, r), r.bank);
  assert.equal(resolveAnchor({ kind: "bank", slot: 1 }, r), r.bankSlots[0]);
  assert.equal(resolveAnchor({ kind: "bank", slot: 10 }, r), r.bankSlots[9]);
  assert.equal(resolveAnchor({ kind: "bank", slot: 11 }, r), null);
  assert.equal(resolveAnchor({ kind: "bank", slot: 0 }, r), null);
  assert.equal(resolveAnchor({ kind: "gold" }, r), r.gold);
  assert.equal(resolveAnchor({ kind: "level" }, r), r.levelXp);
  assert.equal(resolveAnchor({ kind: "xp" }, r), r.xp);
  assert.equal(resolveAnchor({ kind: "stage" }, r), r.stage);
  assert.equal(resolveAnchor({ kind: "none" }, r), null);
  assert.equal(resolveAnchor({ kind: "estranho" }, r), null);
  assert.equal(resolveAnchor({}, r), null);
  assert.equal(resolveAnchor(null, r), null);
  assert.equal(resolveAnchor(undefined, r), null);
  assert.equal(resolveAnchor("gold", r), null);
  assert.equal(resolveAnchor({ kind: "gold" }, null), null);
  assert.equal(resolveAnchor({ kind: "shop", slot: 1 }, {}), null);
});

/* ---------- (e) placeLabel ---------- */

test("ANCHOR_SIDE: lado preferido de cada tipo", () => {
  assert.deepEqual(
    { ...ANCHOR_SIDE },
    {
      shop: "top",
      bank: "right",
      gold: "top",
      level: "top",
      xp: "top",
      stage: "bottom",
    },
  );
  assert.ok(Object.isFrozen(ANCHOR_SIDE));
});

test("placeLabel: fica no lado pedido quando cabe, centralizada no alvo e dentro do palco", () => {
  const stage = { width: 1920, height: 1080 };
  const r = anchorRects(stage);
  const card = r.shopCards[2];
  const label = placeLabel(card, { width: 200, height: 60 }, stage, "top", 6);
  assert.equal(label.side, "top");
  close(label.y, card.y - 6 - 60, 0.01);
  close(label.x + 100, card.x + card.width / 2, 0.01);
  const bank = placeLabel(
    r.bank,
    { width: 240, height: 90 },
    stage,
    ANCHOR_SIDE.bank,
  );
  assert.equal(bank.side, "right");
  close(bank.x, r.bank.x + r.bank.width + 6, 0.01);
});

test("placeLabel: inverte o lado quando não cabe e limita o eixo transversal ao palco", () => {
  const stage = { width: 1920, height: 1080 };
  const r = anchorRects(stage);
  // Estágio no topo: a etiqueta em cima não cabe -> embaixo.
  const top = placeLabel(r.stage, { width: 220, height: 50 }, stage, "top");
  assert.equal(top.side, "bottom");
  close(top.y, r.stage.y + r.stage.height + 6, 0.01);
  assert.equal(
    placeLabel(r.stage, { width: 220, height: 50 }, stage, ANCHOR_SIDE.stage)
      .side,
    "bottom",
  );
  // Alvo na borda direita com lado direito: vai para a esquerda.
  const edge = { x: 1890, y: 500, width: 20, height: 40 };
  const right = placeLabel(edge, { width: 200, height: 60 }, stage, "right");
  assert.equal(right.side, "left");
  close(right.x, 1890 - 6 - 200, 0.01);
  // Alvo na borda esquerda, lado topo: o x centralizado seria negativo -> limitado a 0.
  const corner = placeLabel(
    { x: 0, y: 500, width: 20, height: 40 },
    { width: 200, height: 60 },
    stage,
    "top",
  );
  assert.equal(corner.side, "top");
  assert.equal(corner.x, 0);
  // Alvo na borda de baixo, lado baixo: sobe.
  const bottom = placeLabel(
    { x: 900, y: 1070, width: 40, height: 10 },
    { width: 100, height: 40 },
    stage,
    "bottom",
  );
  assert.equal(bottom.side, "top");
});

test("placeLabel: nunca sai do palco, nem quando nenhum lado cabe; entrada inválida não lança", () => {
  const stage = { width: 1920, height: 1080 };
  const size = { width: 300, height: 100 };
  const targets = [];
  for (const x of [0, 400, 960, 1700, 1900])
    for (const y of [0, 300, 700, 1000, 1070])
      targets.push({ x, y, width: 20, height: 10 });
  targets.push({ x: 0, y: 0, width: 1920, height: 1080 });
  for (const target of targets)
    for (const side of ["top", "bottom", "left", "right"]) {
      const p = placeLabel(target, size, stage, side);
      assert.ok(
        p.x >= 0 && p.x + size.width <= stage.width,
        `x fora (${JSON.stringify(target)} ${side})`,
      );
      assert.ok(
        p.y >= 0 && p.y + size.height <= stage.height,
        `y fora (${JSON.stringify(target)} ${side})`,
      );
      assert.ok(["top", "bottom", "left", "right"].includes(p.side));
    }
  // Nada cabe: mantém o lado pedido, limitado ao palco.
  const all = placeLabel(
    { x: 0, y: 0, width: 1920, height: 1080 },
    size,
    stage,
    "top",
  );
  assert.equal(all.side, "top");
  assert.equal(all.y, 0);
  close(all.x, 810, 0.01);
  // Lado desconhecido vira "top"; entradas inválidas não lançam.
  assert.equal(
    placeLabel(
      { x: 900, y: 500, width: 20, height: 20 },
      size,
      stage,
      "diagonal",
    ).side,
    "top",
  );
  assert.doesNotThrow(() => placeLabel(undefined, undefined, undefined));
  assert.doesNotThrow(() =>
    placeLabel(null, { width: "a" }, { height: NaN }, "left", "x"),
  );
});

/* ---------- (f) layout ---------- */

test("layout: padrão completo, congelado, rotulado, com builds e plan ocultos", () => {
  assert.deepEqual(ELEMENT_IDS, [
    "dock",
    "bar",
    "hints",
    "roll",
    "items",
    "builds",
    "plan",
  ]);
  assert.deepEqual(Object.keys(DEFAULT_LAYOUT), [...ELEMENT_IDS]);
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT));
  for (const id of ELEMENT_IDS) {
    const el = DEFAULT_LAYOUT[id];
    assert.ok(Object.isFrozen(el), id);
    assert.equal(typeof ELEMENT_LABELS[id], "string");
    assert.ok(ELEMENT_LABELS[id].length > 3, id);
    assert.equal(typeof el.hidden, "boolean");
    assert.ok(el.w >= W_RANGE.min && el.w <= W_RANGE.max, `${id}: largura`);
    assert.ok(
      el.x >= EDGE_MARGIN && el.x + el.w <= 1 - EDGE_MARGIN,
      `${id}: horizontal`,
    );
    assert.ok(el.y >= EDGE_MARGIN && el.y < 1 - EDGE_MARGIN, `${id}: vertical`);
  }
  assert.equal(DEFAULT_LAYOUT.builds.hidden, true);
  assert.equal(DEFAULT_LAYOUT.plan.hidden, true);
  for (const id of ["dock", "bar", "hints", "roll", "items"])
    assert.equal(DEFAULT_LAYOUT[id].hidden, false, id);
  assert.deepEqual({ ...W_RANGE }, { min: 0.08, max: 0.5 });
  assert.equal(EDGE_MARGIN, 0.0075);
});

test("layout: os padrões não cobrem o HUD do jogo (loja, banco, estágio) e formam uma coluna à direita", () => {
  const rects = anchorRects({ width: 1920, height: 1080 });
  const hudLeft = rects.bank.x + rects.bank.width;
  for (const id of ELEMENT_IDS) {
    const el = DEFAULT_LAYOUT[id];
    // Longe do banco à esquerda e do estágio no topo-centro (x de ~0,35 a ~0,45).
    assert.ok(el.x > hudLeft / 1920 + 0.1, `${id}: perto do banco`);
    assert.ok(el.x > 0.45, `${id}: sobre o estágio`);
    // A loja ocupa x de ~0,28 a ~0,79 de y ~0,83 para baixo; os elementos começam bem acima.
    assert.ok(el.y < 0.78, `${id}: começa na faixa da loja`);
  }
  for (const id of ["bar", "hints", "roll", "items", "builds", "plan"]) {
    assert.equal(DEFAULT_LAYOUT[id].x, 0.735, id);
    assert.equal(DEFAULT_LAYOUT[id].w, 0.19, id);
  }
  // O dock fica no canto superior direito.
  assert.ok(
    DEFAULT_LAYOUT.dock.y < 0.05 &&
      DEFAULT_LAYOUT.dock.x + DEFAULT_LAYOUT.dock.w > 0.9,
  );
  // A coluna visível desce em ordem.
  const order = ["bar", "hints", "roll", "items"].map(
    (id) => DEFAULT_LAYOUT[id].y,
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

test("parseLayout: lixo inteiro vira o padrão; objetos novos e idempotente; nunca lança", () => {
  for (const junk of [undefined, null, "x", 42, true, [], [1, 2], () => 1])
    assert.deepEqual(parseLayout(junk), resetLayout(), String(junk));
  assert.deepEqual(parseLayout({}), resetLayout());
  const a = parseLayout(undefined);
  assert.notEqual(a.bar, DEFAULT_LAYOUT.bar);
  assert.ok(!Object.isFrozen(a.bar));
  assert.notEqual(parseLayout(undefined), parseLayout(undefined));
  const odd = { bar: { x: 0.1, y: 0.2, w: 0.3, hidden: true }, roll: { x: 5 } };
  assert.deepEqual(parseLayout(parseLayout(odd)), parseLayout(odd));
});

test("parseLayout: valores parciais ou inválidos voltam ao padrão do elemento", () => {
  const l = parseLayout({
    bar: { x: 0.1 },
    roll: { x: "a", y: NaN, w: Infinity, hidden: "sim" },
    hints: 5,
    items: null,
    plan: { hidden: false },
    builds: { hidden: false, y: 0.4 },
    dock: [1, 2, 3],
    desconhecido: { x: 0.5, y: 0.5, w: 0.2, hidden: false },
  });
  assert.deepEqual(l.bar, {
    x: 0.1,
    y: DEFAULT_LAYOUT.bar.y,
    w: DEFAULT_LAYOUT.bar.w,
    hidden: false,
  });
  assert.deepEqual(l.roll, { ...DEFAULT_LAYOUT.roll });
  assert.deepEqual(l.hints, { ...DEFAULT_LAYOUT.hints });
  assert.deepEqual(l.items, { ...DEFAULT_LAYOUT.items });
  assert.deepEqual(l.dock, { ...DEFAULT_LAYOUT.dock });
  assert.equal(l.plan.hidden, false);
  assert.equal(l.plan.y, DEFAULT_LAYOUT.plan.y);
  assert.deepEqual(l.builds, { x: 0.735, y: 0.4, w: 0.19, hidden: false });
  assert.deepEqual(
    Object.keys(l),
    [...ELEMENT_IDS],
    "só os ids conhecidos, todos presentes",
  );
  assert.equal(parseLayout({ bar: { hidden: true } }).bar.hidden, true);
});

test("parseLayout: limita à margem e à faixa de largura", () => {
  const l = parseLayout({
    bar: { x: -1, y: -1, w: 9 },
    hints: { x: 9, y: 9, w: 0.01 },
    plan: { x: 5, y: 0.2, w: 0.19 },
  });
  assert.equal(l.bar.w, 0.5);
  assert.equal(l.bar.x, EDGE_MARGIN);
  assert.equal(l.bar.y, EDGE_MARGIN);
  assert.equal(l.hints.w, 0.08);
  assert.equal(l.hints.x, 0.9125);
  assert.ok(
    l.hints.y <= 1 - EDGE_MARGIN - 0.04 && l.hints.y > 0.8,
    "ainda aparece na tela",
  );
  assert.equal(l.plan.x, 0.8025);
});

test("clampElement: mantém dentro da margem considerando a altura medida; preserva hidden", () => {
  const stage = { width: 1000, height: 500 };
  assert.deepEqual(
    clampElement({ x: 0.9, y: 0.9, w: 0.2, hidden: true }, stage, 100),
    {
      x: 0.7925,
      y: 0.7925,
      w: 0.2,
      hidden: true,
    },
  );
  assert.deepEqual(clampElement({ x: -3, y: -3, w: 0.2 }, stage), {
    x: EDGE_MARGIN,
    y: EDGE_MARGIN,
    w: 0.2,
    hidden: false,
  });
  assert.equal(
    clampElement({ x: 0.1, y: 5, w: 0.2 }, stage, 0).y,
    0.9925,
    "altura desconhecida: só a margem",
  );
  assert.equal(clampElement({ x: 0.1, y: 0.1, w: 9 }, stage).w, 0.5);
  assert.equal(clampElement({ x: 0.1, y: 0.1, w: 0 }, stage).w, 0.08);
  // Conteúdo mais alto que o palco: fica na margem de cima.
  assert.equal(
    clampElement({ x: 0.1, y: 0.6, w: 0.2 }, stage, 900).y,
    EDGE_MARGIN,
  );
  const input = { x: 2, y: 2, w: 0.2, hidden: false };
  clampElement(input, stage, 10);
  assert.deepEqual(
    input,
    { x: 2, y: 2, w: 0.2, hidden: false },
    "não altera a entrada",
  );
  assert.doesNotThrow(() => clampElement(null, null));
});

test("moveElement: desloca em px do palco e para na margem", () => {
  const stage = { width: 1000, height: 500 };
  const el = { x: 0.5, y: 0.5, w: 0.2, hidden: false };
  assert.deepEqual(moveElement(el, 100, -50, stage), {
    x: 0.6,
    y: 0.4,
    w: 0.2,
    hidden: false,
  });
  assert.equal(moveElement(el, 100000, 0, stage).x, 0.7925);
  assert.equal(moveElement(el, -100000, 0, stage).x, EDGE_MARGIN);
  assert.equal(
    moveElement(el, 0, 100000, stage, 50).y,
    0.8925,
    "altura 50px = 0,1 do palco",
  );
  assert.equal(moveElement(el, 0, -100000, stage).y, EDGE_MARGIN);
  assert.deepEqual(
    el,
    { x: 0.5, y: 0.5, w: 0.2, hidden: false },
    "não altera a entrada",
  );
  const frozen = moveElement(DEFAULT_LAYOUT.bar, 10, 10, stage);
  assert.ok(!Object.isFrozen(frozen));
  // Palco de tamanho zero ou deslocamento inválido: não vira NaN.
  const flat = moveElement(el, 10, 10, { width: 0, height: 0 });
  assert.ok(Number.isFinite(flat.x) && Number.isFinite(flat.y));
  assert.deepEqual(moveElement(el, NaN, "a", stage), { ...el });
});

test("resizeElement: muda só a largura, com a faixa e a borda direita", () => {
  const stage = { width: 1000, height: 500 };
  const el = { x: 0.5, y: 0.1, w: 0.2, hidden: false };
  assert.deepEqual(resizeElement(el, 100, stage), {
    x: 0.5,
    y: 0.1,
    w: 0.3,
    hidden: false,
  });
  assert.equal(
    resizeElement(el, 100000, stage).w,
    0.4925,
    "limitada pela borda direita",
  );
  assert.equal(resizeElement(el, -100000, stage).w, 0.08);
  assert.equal(resizeElement(el, -100000, stage).x, 0.5);
  const left = resizeElement({ x: 0.1, y: 0.1, w: 0.2 }, 100000, stage);
  assert.equal(left.w, 0.5, "limitada pela faixa de largura");
  const edge = resizeElement({ x: 0.9, y: 0.1, w: 0.1 }, 100, stage);
  assert.equal(edge.w, 0.0925);
  assert.equal(edge.x, 0.9);
  assert.deepEqual(
    el,
    { x: 0.5, y: 0.1, w: 0.2, hidden: false },
    "não altera a entrada",
  );
  assert.ok(Number.isFinite(resizeElement(el, 10, { width: 0, height: 0 }).w));
});

test("setHidden: devolve layout novo; ocultar e mostrar; id desconhecido não quebra", () => {
  const base = resetLayout();
  const shown = setHidden(base, "builds", false);
  assert.equal(shown.builds.hidden, false);
  assert.equal(base.builds.hidden, true, "o layout de entrada não muda");
  assert.notEqual(shown, base);
  const hidden = setHidden(shown, "bar", true);
  assert.equal(hidden.bar.hidden, true);
  assert.equal(hidden.builds.hidden, false);
  assert.equal(hidden.roll.hidden, false);
  assert.deepEqual(setHidden(base, "nao-existe", true), base);
  assert.deepEqual(setHidden(undefined, "plan", false).plan, {
    ...DEFAULT_LAYOUT.plan,
    hidden: false,
  });
  assert.deepEqual(Object.keys(setHidden(base, "bar", true)), [...ELEMENT_IDS]);
});

test("resetLayout: cópia editável do padrão, sem compartilhar objetos", () => {
  const a = resetLayout();
  assert.deepEqual(a, DEFAULT_LAYOUT);
  assert.ok(!Object.isFrozen(a) && !Object.isFrozen(a.bar));
  a.bar.x = 0.2;
  a.plan.hidden = false;
  assert.equal(DEFAULT_LAYOUT.bar.x, 0.735);
  assert.equal(DEFAULT_LAYOUT.plan.hidden, true);
  const b = resetLayout();
  assert.notEqual(a, b);
  assert.notEqual(a.bar, b.bar);
  assert.equal(b.bar.x, 0.735);
});
