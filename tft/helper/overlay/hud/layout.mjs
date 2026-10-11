// Layout dos elementos posicionáveis e redimensionáveis do overlay integrado (puro: sem DOM, sem node:*).
//
// Coordenadas = frações do palco (a janela do overlay, que cobre a área cliente do jogo): `x`,`y` = canto superior esquerdo,
// `w` = largura; a altura é do conteúdo (a página a mede e a passa em `heightPx`). `hidden` oculta o elemento.
// Os padrões ficam numa coluna à direita (x ~ 0.735, w ~ 0.19) que não cobre o HUD do jogo: a loja e o ouro embaixo (x de
// ~0.29 a ~0.79, y > 0.80), o banco de itens à esquerda (x < 0.05) e o estágio no topo-centro. Os elementos de dica ficam
// sobre os alvos do jogo (loja, banco, ouro, nível), não aqui; `builds` e `plan` começam ocultos para não poluir.

/** Ids dos elementos, na ordem de exibição. */
export const ELEMENT_IDS = Object.freeze([
  "dock",
  "bar",
  "hints",
  "roll",
  "items",
  "builds",
  "plan",
]);

/** Rótulo em pt-BR de cada elemento (painel de ajuda). */
export const ELEMENT_LABELS = Object.freeze({
  dock: "Controles e saúde das fontes",
  bar: "Barra de estado (ouro, nível, fase)",
  hints: "Dicas sem alvo no jogo",
  roll: "Vale rolar?",
  items: "Itens: próximo e movimentos",
  builds: "Itens da formação",
  plan: "Plano da composição",
});

const freezeEl = (el) => Object.freeze({ ...el });

/** Layout padrão (congelado). Use `resetLayout()` para uma cópia editável. */
export const DEFAULT_LAYOUT = Object.freeze({
  dock: freezeEl({ x: 0.8, y: 0.015, w: 0.125, hidden: false }),
  bar: freezeEl({ x: 0.735, y: 0.06, w: 0.19, hidden: false }),
  hints: freezeEl({ x: 0.735, y: 0.15, w: 0.19, hidden: false }),
  roll: freezeEl({ x: 0.735, y: 0.33, w: 0.19, hidden: false }),
  items: freezeEl({ x: 0.735, y: 0.5, w: 0.19, hidden: false }),
  builds: freezeEl({ x: 0.735, y: 0.6, w: 0.19, hidden: true }),
  plan: freezeEl({ x: 0.735, y: 0.3, w: 0.19, hidden: true }),
});

/** Largura permitida (fração do palco). */
export const W_RANGE = Object.freeze({ min: 0.08, max: 0.5 });

/** Margem mínima até a borda do palco (fração), como o TFTAcademy. */
export const EDGE_MARGIN = 0.0075;

/** Altura mínima visível assumida quando o layout é lido sem medir o conteúdo (fração do palco). */
const MIN_VISIBLE_HEIGHT = 0.05;

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const r4 = (n) => Math.round(n * 10000) / 10000;
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Limita x, y e w de um elemento (frações) à largura permitida e à margem; `hFrac` = altura do conteúdo (fração do palco). */
function clampFraction(el, hFrac) {
  const w = clampNum(el.w, W_RANGE.min, W_RANGE.max);
  const maxX = Math.max(EDGE_MARGIN, 1 - EDGE_MARGIN - w);
  const maxY = Math.max(EDGE_MARGIN, 1 - EDGE_MARGIN - hFrac);
  return {
    x: r4(clampNum(el.x, EDGE_MARGIN, maxX)),
    y: r4(clampNum(el.y, EDGE_MARGIN, maxY)),
    w: r4(w),
    hidden: el.hidden === true,
  };
}

/**
 * Layout completo a partir de um valor qualquer (config em disco, mensagem da página): todos os ids sempre presentes;
 * campo ausente ou inválido vira o padrão do elemento; valores limitados à margem. Nunca lança; devolve objetos novos.
 */
export function parseLayout(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const id of ELEMENT_IDS) {
    const d = DEFAULT_LAYOUT[id];
    const e =
      src[id] && typeof src[id] === "object" && !Array.isArray(src[id])
        ? src[id]
        : {};
    out[id] = clampFraction(
      {
        x: isNum(e.x) ? e.x : d.x,
        y: isNum(e.y) ? e.y : d.y,
        w: isNum(e.w) ? e.w : d.w,
        hidden: typeof e.hidden === "boolean" ? e.hidden : d.hidden,
      },
      MIN_VISIBLE_HEIGHT,
    );
  }
  return out;
}

const heightFraction = (heightPx, stage) =>
  isNum(heightPx) && heightPx > 0 && isNum(stage?.height) && stage.height > 0
    ? heightPx / stage.height
    : 0;

const asElement = (el) => ({
  x: isNum(el?.x) ? el.x : EDGE_MARGIN,
  y: isNum(el?.y) ? el.y : EDGE_MARGIN,
  w: isNum(el?.w) ? el.w : W_RANGE.min,
  hidden: el?.hidden === true,
});

/**
 * Mantém o elemento dentro do palco com a margem. `heightPx` = altura medida do conteúdo (0 = desconhecida).
 * @param {{x:number,y:number,w:number,hidden?:boolean}} el
 * @param {{width:number,height:number}} stage
 * @returns {{x:number,y:number,w:number,hidden:boolean}} elemento novo
 */
export function clampElement(el, stage, heightPx = 0) {
  return clampFraction(asElement(el), heightFraction(heightPx, stage));
}

/** Move o elemento por um deslocamento em px do palco e o mantém dentro da margem. */
export function moveElement(el, dxPx, dyPx, stage, heightPx = 0) {
  const e = asElement(el);
  const sw = isNum(stage?.width) && stage.width > 0 ? stage.width : 0;
  const sh = isNum(stage?.height) && stage.height > 0 ? stage.height : 0;
  const dx = isNum(dxPx) && sw ? dxPx / sw : 0;
  const dy = isNum(dyPx) && sh ? dyPx / sh : 0;
  return clampElement({ ...e, x: e.x + dx, y: e.y + dy }, stage, heightPx);
}

/** Altera a largura pela alça direita (o canto esquerdo fica parado): limita à faixa e à borda direita do palco. */
export function resizeElement(el, dxPx, stage) {
  const e = asElement(el);
  const sw = isNum(stage?.width) && stage.width > 0 ? stage.width : 0;
  const dw = isNum(dxPx) && sw ? dxPx / sw : 0;
  const room = Math.max(W_RANGE.min, 1 - EDGE_MARGIN - e.x);
  const w = Math.min(clampNum(e.w + dw, W_RANGE.min, W_RANGE.max), room);
  return clampElement({ ...e, w }, stage, 0);
}

/** Layout novo com a visibilidade de `id` alterada (id desconhecido: só devolve o layout normalizado). */
export function setHidden(layout, id, hidden) {
  const next = parseLayout(layout);
  if (ELEMENT_IDS.includes(id))
    next[id] = { ...next[id], hidden: hidden === true };
  return next;
}

/** Cópia editável do layout padrão. */
export function resetLayout() {
  const out = {};
  for (const id of ELEMENT_IDS) out[id] = { ...DEFAULT_LAYOUT[id] };
  return out;
}
