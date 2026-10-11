// Geometria do HUD do jogo para o overlay integrado (puro: sem DOM, sem node:*; roda no navegador e no Node).
//
// Fonte única dos números: os MESMOS do leitor de tela (screen-reader.ps1: $GOLD $LEVEL $XP $STAGE $SLOT $SHOP e a função
// Hud-Rect). Um teste (tests/overlay-geometry.test.mjs) lê o .ps1 e confere que cada número aqui bate; se o leitor for
// recalibrado, o teste falha até este arquivo acompanhar. O .ps1 não é editado.
//
// As regiões são FRAÇÕES do retângulo 16:9 do HUD (não da área cliente), medidas numa captura 2044x1149 (HUD padrão).
// Convenção: as larguras e posições x são frações da LARGURA do HUD; y e h, da ALTURA (como o `Grab` do leitor).
//
// O que NÃO vem do leitor (o leitor só lê o texto, não precisa da forma inteira) está marcado [ESTIMADO] e é corrigido na
// prática pelo modo calibrar da página (deslocamento e escala da grade inteira, sem captura de tela).

/** Regiões lidas pelo leitor (valores idênticos a screen-reader.ps1). */
export const HUD_REGIONS = Object.freeze({
  gold: Object.freeze({ x: 0.5316, y: 0.8191, w: 0.0235, h: 0.0261 }),
  /** Só o número depois de "Nv.". */
  level: Object.freeze({ x: 0.2009, y: 0.8174, w: 0.0196, h: 0.0244 }),
  xp: Object.freeze({ x: 0.242, y: 0.8174, w: 0.0284, h: 0.0244 }),
  /** "3-1" no topo (usa o HUD ancorado em cima). */
  stage: Object.freeze({ x: 0.3982, y: 0.007, w: 0.0201, h: 0.0226 }),
  /** Banco de itens: coluna de 10 espaços; o espaço i fica em y + pitch * i (fração da ALTURA). */
  bankSlot: Object.freeze({
    x: 0.00709,
    y: 0.24374,
    w: 0.02055,
    h: 0.0383,
    pitch: 0.04875,
    count: 10,
  }),
  /** Faixa do NOME de cada carta da loja; a carta i fica em x + pitch * i (fração da LARGURA). */
  shopName: Object.freeze({
    x: 0.2896,
    y: 0.9661,
    w: 0.0783,
    h: 0.0244,
    pitch: 0.105,
    count: 5,
  }),
});

/**
 * [ESTIMADO] Cartão inteiro da loja, derivado da faixa do nome (o leitor só lê a faixa). `padX` = folga de cada lado em
 * fração da LARGURA do HUD; `above`/`below` = quanto o cartão se estende acima/abaixo da faixa, em fração da ALTURA. Valores
 * olhados no HUD padrão 1920x1080 (cartão ~190 x ~176 px, dentro do passo de 0.105); o desvio é corrigido no modo calibrar.
 */
export const SHOP_CARD = Object.freeze({
  padX: 0.0105,
  above: 0.135,
  below: 0.004,
});

/**
 * [ESTIMADO] Folga da coluna do banco em volta dos 10 espaços: `x` em fração da LARGURA (a coluna começa colada na borda
 * esquerda, então é pequena), `y` em fração da ALTURA, em cima e embaixo.
 */
export const BANK_PAD = Object.freeze({ x: 0.003, y: 0.006 });

/**
 * [ESTIMADO] Folga da união Nível + XP: `left` cobre o texto "Nv." à esquerda do número, `right` o fim do "x/y" do XP
 * (frações da LARGURA); `y` é a folga vertical (fração da ALTURA).
 */
export const LEVEL_XP_PAD = Object.freeze({
  left: 0.025,
  right: 0.005,
  y: 0.006,
});

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Arredondamento do .NET ([Math]::Round): metade vai para o par (o do JS vai para cima). */
function roundHalfEven(n) {
  const f = Math.floor(n);
  const d = n - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * Retângulo 16:9 do HUD dentro da área cliente (porte exato de `Hud-Rect` do leitor). O HUD do jogo é 16:9 e escalado sem
 * esticar: numa janela mais larga ocupa a altura toda, centralizado; numa mais alta ocupa a largura toda e fica colado
 * embaixo (`anchor` "bottom") ou em cima ("top", usado pelo estágio). Janela a até 1% de 16:9 conta como 16:9.
 * @param {{x:number,y:number,width:number,height:number}} client área cliente
 * @param {"top"|"bottom"} [anchor]
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function hudRect(client, anchor = "bottom") {
  const c = client ?? {};
  if (![c.x, c.y, c.width, c.height].every(isNum))
    return { x: 0, y: 0, width: 0, height: 0 };
  const { x, y, width: w, height: h } = c;
  if (Math.abs(w * 9 - h * 16) <= h * 16 * 0.01)
    return { x, y, width: w, height: h };
  if (w * 9 > h * 16) {
    const hw = roundHalfEven((h * 16) / 9);
    return { x: x + Math.floor((w - hw) / 2), y, width: hw, height: h };
  }
  const hh = roundHalfEven((w * 9) / 16);
  return { x, y: y + (anchor === "top" ? 0 : h - hh), width: w, height: hh };
}

/** Calibração neutra. dx/dy: frações da largura/altura do HUD; scale: multiplica em torno do centro do HUD. */
export const DEFAULT_CALIBRATION = Object.freeze({ dx: 0, dy: 0, scale: 1 });

/** Limites da calibração. */
export const CALIBRATION_LIMITS = Object.freeze({
  dx: Object.freeze({ min: -0.25, max: 0.25 }),
  dy: Object.freeze({ min: -0.25, max: 0.25 }),
  scale: Object.freeze({ min: 0.6, max: 1.6 }),
});

function limitCalibration(dx, dy, scale) {
  const L = CALIBRATION_LIMITS;
  return {
    dx: r4(clampNum(dx, L.dx.min, L.dx.max)),
    dy: r4(clampNum(dy, L.dy.min, L.dy.max)),
    scale: r4(clampNum(scale, L.scale.min, L.scale.max)),
  };
}

/**
 * Calibração a partir de um valor qualquer (config em disco, mensagem da página): campo ausente ou inválido vira o padrão;
 * valores fora do limite são limitados. Nunca lança; devolve um objeto novo.
 * @returns {{dx:number,dy:number,scale:number}}
 */
export function parseCalibration(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const D = DEFAULT_CALIBRATION;
  return limitCalibration(
    isNum(o.dx) ? o.dx : D.dx,
    isNum(o.dy) ? o.dy : D.dy,
    isNum(o.scale) ? o.scale : D.scale,
  );
}

/**
 * Soma um ajuste (dx/dy em fração do HUD, dscale em unidades de escala) à calibração, limita e arredonda a 4 casas.
 * @returns {{dx:number,dy:number,scale:number}}
 */
export function nudgeCalibration(cal, { dx = 0, dy = 0, dscale = 0 } = {}) {
  const c = parseCalibration(cal);
  return limitCalibration(
    c.dx + (isNum(dx) ? dx : 0),
    c.dy + (isNum(dy) ? dy : 0),
    c.scale + (isNum(dscale) ? dscale : 0),
  );
}

/**
 * Aplica a calibração a um retângulo: escala em torno do centro do HUD de referência e desloca por fração do HUD.
 *   x' = cx + (x - cx) * scale + dx * hud.width ; y' = cy + (y - cy) * scale + dy * hud.height ; largura e altura * scale.
 */
export function applyCalibration(rect, cal, hud) {
  const c = parseCalibration(cal);
  const cx = hud.x + hud.width / 2;
  const cy = hud.y + hud.height / 2;
  return {
    x: cx + (rect.x - cx) * c.scale + c.dx * hud.width,
    y: cy + (rect.y - cy) * c.scale + c.dy * hud.height,
    width: rect.width * c.scale,
    height: rect.height * c.scale,
  };
}

/** Região em fração do retângulo de referência -> px (como o `Grab` do leitor). `x`, `y`, `w`, `h` sobrescrevem a região. */
function inRect(
  ref,
  region,
  { x = region.x, y = region.y, w = region.w, h = region.h } = {},
) {
  return {
    x: ref.x + ref.width * x,
    y: ref.y + ref.height * y,
    width: ref.width * w,
    height: ref.height * h,
  };
}

const rounded = (r) => ({
  x: r2(r.x),
  y: r2(r.y),
  width: r2(r.width),
  height: r2(r.height),
});

/**
 * Retângulos (px da área cliente, origem 0,0) de tudo que o HUD do jogo tem de ancorável, já calibrados.
 *
 * Referências (como no leitor): ouro, nível, XP e loja usam o HUD ancorado embaixo; o estágio, o ancorado em cima; o banco
 * usa a coluna da borda ESQUERDA da janela (largura = a do HUD 16:9, altura/âncora do HUD de baixo), como o leitor
 * a localiza: numa janela ultrawide a coluna não vai para o centro com o HUD. `hud` e `hudTop` voltam SEM calibração
 * (são a referência do cálculo e o quadro 16:9 que o modo calibrar desenha). A calibração de cada região escala em torno
 * do centro da própria referência.
 *
 * [ESTIMADO] `shopCards` (SHOP_CARD), `bank` (BANK_PAD) e `levelXp` (LEVEL_XP_PAD) não existem no leitor; são derivados.
 * @param {{width:number,height:number}} stage área cliente do jogo (origem 0,0)
 * @param {{dx:number,dy:number,scale:number}} [calibration]
 */
export function anchorRects(stage, calibration = DEFAULT_CALIBRATION) {
  const cal = parseCalibration(calibration);
  const width = isNum(stage?.width) ? Math.max(0, stage.width) : 0;
  const height = isNum(stage?.height) ? Math.max(0, stage.height) : 0;
  const client = { x: 0, y: 0, width, height };
  const hud = hudRect(client, "bottom");
  const hudTop = hudRect(client, "top");
  const R = HUD_REGIONS;
  const cooked = (raw, ref) => rounded(applyCalibration(raw, cal, ref));

  // Coluna do banco: ancorada na borda esquerda, com a largura do HUD 16:9 (rect do leitor: x do quadro, y/altura do HUD).
  const bankFrame = {
    x: client.x,
    y: hud.y,
    width: roundHalfEven((hud.height * 16) / 9),
    height: hud.height,
  };
  const S = R.bankSlot;
  const bankSlots = Array.from({ length: S.count }, (_, i) =>
    cooked(inRect(bankFrame, S, { y: S.y + S.pitch * i }), bankFrame),
  );
  const bank = cooked(
    inRect(bankFrame, S, {
      x: S.x - BANK_PAD.x,
      y: S.y - BANK_PAD.y,
      w: S.w + 2 * BANK_PAD.x,
      h: S.pitch * (S.count - 1) + S.h + 2 * BANK_PAD.y,
    }),
    bankFrame,
  );

  const N = R.shopName;
  const shopNames = Array.from({ length: N.count }, (_, i) =>
    cooked(inRect(hud, N, { x: N.x + N.pitch * i }), hud),
  );
  const shopCards = Array.from({ length: N.count }, (_, i) =>
    cooked(
      inRect(hud, N, {
        x: N.x + N.pitch * i - SHOP_CARD.padX,
        y: N.y - SHOP_CARD.above,
        w: N.w + 2 * SHOP_CARD.padX,
        h: SHOP_CARD.above + N.h + SHOP_CARD.below,
      }),
      hud,
    ),
  );

  const lv = R.level;
  const xp = R.xp;
  const left = lv.x - LEVEL_XP_PAD.left;
  const right = xp.x + xp.w + LEVEL_XP_PAD.right;
  const top = Math.min(lv.y, xp.y) - LEVEL_XP_PAD.y;
  const bottom = Math.max(lv.y + lv.h, xp.y + xp.h) + LEVEL_XP_PAD.y;

  return {
    hud: rounded(hud),
    hudTop: rounded(hudTop),
    gold: cooked(inRect(hud, R.gold), hud),
    level: cooked(inRect(hud, lv), hud),
    xp: cooked(inRect(hud, xp), hud),
    levelXp: cooked(
      inRect(hud, lv, { x: left, y: top, w: right - left, h: bottom - top }),
      hud,
    ),
    stage: cooked(inRect(hudTop, R.stage), hudTop),
    shopCards,
    shopNames,
    bankSlots,
    bank,
  };
}

/**
 * Retângulo de um âncora de dica ({kind, slot?}) ou null (sem alvo geométrico). Loja: slot 1..5 -> cartão; banco: sem slot a
 * coluna inteira, com slot 1..10 o espaço; "level" -> união Nível+XP; "gold", "xp", "stage"; "none"/desconhecido -> null.
 */
export function resolveAnchor(anchor, rects) {
  if (!anchor || typeof anchor !== "object" || !rects) return null;
  const slot = anchor.slot;
  const pick = (list) =>
    Number.isInteger(slot) && slot >= 1 && slot <= (list?.length ?? 0)
      ? list[slot - 1]
      : null;
  switch (anchor.kind) {
    case "shop":
      return pick(rects.shopCards);
    case "bank":
      return slot == null ? (rects.bank ?? null) : pick(rects.bankSlots);
    case "gold":
      return rects.gold ?? null;
    case "level":
      return rects.levelXp ?? null;
    case "xp":
      return rects.xp ?? null;
    case "stage":
      return rects.stage ?? null;
    default:
      return null;
  }
}

/** Lado preferido da etiqueta por tipo de âncora. */
export const ANCHOR_SIDE = Object.freeze({
  shop: "top",
  bank: "right",
  gold: "top",
  level: "top",
  xp: "top",
  stage: "bottom",
});

const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };
const PERPENDICULAR = {
  top: ["right", "left"],
  bottom: ["right", "left"],
  left: ["bottom", "top"],
  right: ["bottom", "top"],
};

/**
 * Posição da etiqueta junto ao alvo, dentro do palco. Tenta o lado pedido; se não couber, o oposto, depois os
 * perpendiculares; se nada couber, mantém o lado pedido e só limita ao palco. O eixo transversal é centralizado no alvo e
 * limitado ao palco.
 * @param {{x:number,y:number,width:number,height:number}} target
 * @param {{width:number,height:number}} size tamanho da etiqueta
 * @param {{width:number,height:number}} stage
 * @param {"top"|"bottom"|"left"|"right"} [side]
 * @param {number} [gap] distância entre o alvo e a etiqueta
 * @returns {{x:number,y:number,side:"top"|"bottom"|"left"|"right"}}
 */
export function placeLabel(target, size, stage, side = "top", gap = 6) {
  const t = {
    x: isNum(target?.x) ? target.x : 0,
    y: isNum(target?.y) ? target.y : 0,
    width: isNum(target?.width) ? target.width : 0,
    height: isNum(target?.height) ? target.height : 0,
  };
  const sw = isNum(size?.width) ? Math.max(0, size.width) : 0;
  const sh = isNum(size?.height) ? Math.max(0, size.height) : 0;
  const W = isNum(stage?.width) ? Math.max(0, stage.width) : 0;
  const H = isNum(stage?.height) ? Math.max(0, stage.height) : 0;
  const g = isNum(gap) ? gap : 6;
  const preferred = side in OPPOSITE ? side : "top";

  const raw = (s) => {
    if (s === "top") return { x: t.x + t.width / 2 - sw / 2, y: t.y - g - sh };
    if (s === "bottom")
      return { x: t.x + t.width / 2 - sw / 2, y: t.y + t.height + g };
    if (s === "left")
      return { x: t.x - g - sw, y: t.y + t.height / 2 - sh / 2 };
    return { x: t.x + t.width + g, y: t.y + t.height / 2 - sh / 2 };
  };
  const fits = (s, p) =>
    s === "top"
      ? p.y >= 0
      : s === "bottom"
        ? p.y + sh <= H
        : s === "left"
          ? p.x >= 0
          : p.x + sw <= W;
  const order = [preferred, OPPOSITE[preferred], ...PERPENDICULAR[preferred]];
  const used = order.find((s) => fits(s, raw(s))) ?? preferred;
  const p = raw(used);
  return {
    x: r2(clampNum(p.x, 0, Math.max(0, W - sw))),
    y: r2(clampNum(p.y, 0, Math.max(0, H - sh))),
    side: used,
  };
}
