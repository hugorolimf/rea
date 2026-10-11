// Adaptação do overlay integrado ao tamanho da janela do jogo (puro: sem DOM, sem node:*; roda no navegador e no Node).
//
// Três decisões, todas só de APRESENTAÇÃO (nada aqui grava o layout salvo pelo usuário nem fala com o jogo):
//  1. Referência: o retângulo 16:9 do HUD (`hudRect`), não o palco inteiro. O HUD do TFT é 16:9 e escala sem esticar; é nele
//     que a coluna de cartões "cabe". Numa janela 16:9 o HUD é o palco; numa mais larga/alta sobram barras livres.
//  2. Escala (`--k`): a do HUD 16:9 (= o menor dos eixos: altura/1080 ou largura/1920) vezes a escala do usuário, com piso
//     de legibilidade (K_RANGE.min) e teto. Janela estreita deixa de estourar o texto; a escolha do usuário continua valendo.
//  3. Colisões: os elementos entram por PRIORIDADE (layout.mjs: ELEMENT_PRIORITY). Cada um fica onde o usuário o pôs; se
//     colidir com outro mais importante, procura a vaga mais próxima (mesma coluna, depois as barras livres), sem cobrir as
//     regiões vitais do HUD (loja, banco, nível/ouro, estágio); se não couber, é RECOLHIDO (e a página diz qual). Como a conta
//     é refeita a cada desenho a partir do layout salvo, o recolhido volta sozinho quando o espaço volta (com uma folga
//     de histerese para não piscar).
import { hudRect } from "./geometry.mjs";
import {
  EDGE_MARGIN,
  ELEMENT_IDS,
  ELEMENT_PRIORITY,
  ELEMENT_LABELS,
  PROTECTED_IDS,
  W_RANGE,
} from "./layout.mjs";

/** Altura de referência do HUD do jogo: `--k` = (altura do HUD 16:9 / 1080) x escala do usuário. */
export const BASE_HEIGHT = 1080;

/** Limites de legibilidade de `--k` (o piso é o menor valor que a escala do usuário já aceitava a 1080p). */
export const K_RANGE = Object.freeze({ min: 0.6, max: 3 });

/**
 * Largura lógica mínima (px da escala base, antes de `--k`) de cada elemento quando a adaptação está ligada: com o piso de
 * `--k` a fração salva pode ficar estreita demais para o conteúdo. Não altera o valor salvo.
 */
export const MIN_LOGICAL_WIDTH = Object.freeze({ dock: 270, default: 300 });

/** Histerese (px da escala base) exigida de folga para um elemento recolhido voltar. */
export const RESTORE_SLACK = 24;

const FALLBACK_HEIGHT = 48;

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const pos = (n) => (isNum(n) && n > 0 ? n : 0);
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10000) / 10000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const ZERO = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

const ASPECTS = [
  ["16:9", 16 / 9],
  ["16:10", 16 / 10],
  ["21:9", 21 / 9],
  ["32:9", 32 / 9],
  ["4:3", 4 / 3],
  ["5:4", 5 / 4],
  ["3:2", 3 / 2],
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["9:16", 9 / 16],
];

/** Proporção em texto ("16:9", "21:9", "4:3"...) ou, sem correspondência até 3%, "1,43:1"; null se o tamanho for inválido. */
export function aspectLabel(width, height) {
  const w = pos(width),
    h = pos(height);
  if (!w || !h) return null;
  const ratio = w / h;
  let best = null;
  for (const [name, value] of ASPECTS) {
    const off = Math.abs(ratio / value - 1);
    if (!best || off < best.off) best = { name, off };
  }
  return best && best.off <= 0.03
    ? best.name
    : `${ratio.toFixed(2).replace(".", ",")}:1`;
}

/**
 * Quadro do palco: o HUD 16:9 (ancorado embaixo, como o leitor), a classe da janela e as faixas livres.
 * `kind`: "16:9" (HUD = palco), "wide" (barras nas laterais), "tall" (faixa livre em cima) ou "unknown" (tamanho inválido).
 * @param {{width:number,height:number}} stage
 */
export function stageFrame(stage) {
  const width = pos(stage?.width),
    height = pos(stage?.height);
  if (!width || !height)
    return {
      width: 0,
      height: 0,
      hud: { ...ZERO },
      kind: "unknown",
      aspect: null,
      bars: { left: 0, right: 0, top: 0 },
    };
  const hud = hudRect({ x: 0, y: 0, width, height }, "bottom");
  const kind =
    hud.width === width && hud.height === height
      ? "16:9"
      : width * 9 > height * 16
        ? "wide"
        : "tall";
  return {
    width,
    height,
    hud,
    kind,
    aspect: aspectLabel(width, height),
    bars: {
      left: hud.x,
      right: Math.max(0, width - hud.x - hud.width),
      top: hud.y,
    },
  };
}

/**
 * Escala efetiva do conteúdo. `base` = altura do HUD 16:9 / 1080 (já é o menor dos eixos); `raw` = base x escala do usuário;
 * `k` = raw limitado a K_RANGE. `limit`: "min" | "max" | null (o limite de legibilidade agiu); `axis`: eixo que manda
 * ("height" ou "width"; null com tamanho inválido).
 * @returns {{k:number,base:number,user:number,raw:number,limit:"min"|"max"|null,axis:"height"|"width"|null,frame:ReturnType<typeof stageFrame>}}
 */
export function scaleInfo(stage, userScale = 1) {
  const frame = stageFrame(stage);
  const user = pos(userScale) || 1;
  const base = frame.hud.height > 0 ? frame.hud.height / BASE_HEIGHT : 1;
  const raw = base * user;
  const k = clamp(raw, K_RANGE.min, K_RANGE.max);
  return {
    k: r4(k),
    base: r4(base),
    user,
    raw: r4(raw),
    limit: raw < K_RANGE.min ? "min" : raw > K_RANGE.max ? "max" : null,
    axis:
      frame.kind === "unknown"
        ? null
        : frame.width / 1920 < frame.height / BASE_HEIGHT
          ? "width"
          : "height",
    frame,
  };
}

/** Fator `--k` (atalho de `scaleInfo`). */
export const scaleFactor = (stage, userScale = 1) =>
  scaleInfo(stage, userScale).k;

/** Margem até a borda do palco, em px (a fração do layout aplicada à largura do HUD). */
const marginPx = (frame) =>
  Math.max(2, Math.round(EDGE_MARGIN * (frame.hud.width || frame.width)));

/**
 * Retângulo (px do palco) que o layout SALVO pede para um elemento: fração do HUD, limitada ao HUD pela margem. Com
 * `auto`, a largura respeita o mínimo lógico (`MIN_LOGICAL_WIDTH`) para o conteúdo não estourar quando `--k` foi elevado.
 */
export function wantedRect(id, cfg, frame, k, heightPx = 0, auto = true) {
  const { hud } = frame;
  if (!hud.width || !hud.height || !cfg) return null;
  const m = marginPx(frame);
  const minW = auto
    ? (MIN_LOGICAL_WIDTH[id] ?? MIN_LOGICAL_WIDTH.default) * k
    : 0;
  const saved = clamp(
    isNum(cfg.w) ? cfg.w : W_RANGE.min,
    W_RANGE.min,
    W_RANGE.max,
  );
  const width = Math.round(
    Math.min(
      Math.max(saved * hud.width, minW),
      Math.max(1, frame.width - 2 * m),
    ),
  );
  const height = Math.round(pos(heightPx) || FALLBACK_HEIGHT * k);
  const fx = clamp(
    isNum(cfg.x) ? cfg.x : EDGE_MARGIN,
    EDGE_MARGIN,
    Math.max(EDGE_MARGIN, 1 - EDGE_MARGIN - width / hud.width),
  );
  const fy = clamp(
    isNum(cfg.y) ? cfg.y : EDGE_MARGIN,
    EDGE_MARGIN,
    Math.max(EDGE_MARGIN, 1 - EDGE_MARGIN - height / hud.height),
  );
  // Última rede: nunca fora do palco (só difere do cálculo acima quando o elemento é maior que o HUD).
  return {
    x: Math.round(
      clamp(hud.x + fx * hud.width, m, Math.max(m, frame.width - m - width)),
    ),
    y: Math.round(
      clamp(hud.y + fy * hud.height, m, Math.max(m, frame.height - m - height)),
    ),
    width,
    height,
  };
}

const overlaps = (a, b, gap = 0) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;

const validRect = (r) =>
  !!r &&
  [r.x, r.y, r.width, r.height].every(isNum) &&
  r.width > 0 &&
  r.height > 0;

/** Caixa que envolve os retângulos válidos da lista (ou null). */
function union(list) {
  const rs = (list ?? []).filter(validRect);
  if (!rs.length) return null;
  const x = Math.min(...rs.map((r) => r.x)),
    y = Math.min(...rs.map((r) => r.y)),
    right = Math.max(...rs.map((r) => r.x + r.width)),
    bottom = Math.max(...rs.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Regiões vitais do HUD que as vagas ALTERNATIVAS não podem cobrir (o que o usuário escolheu à mão não passa por aqui):
 * banco de itens, a faixa inteira da loja, nível/XP/ouro e o estágio. `rects`: `anchorRects(...)`.
 */
export function keepOutRects(rects) {
  const out = [
    rects?.bank,
    union(rects?.shopCards),
    union([rects?.levelXp, rects?.gold, rects?.xp]),
    rects?.stage,
  ];
  return out.filter(validRect);
}

/** Ordem de prioridade (mais importante primeiro); ids sem prioridade vão para o fim. */
const byPriority = (a, b) =>
  (ELEMENT_PRIORITY[a] ?? 99) - (ELEMENT_PRIORITY[b] ?? 99) ||
  ELEMENT_IDS.indexOf(a) - ELEMENT_IDS.indexOf(b);

/**
 * Posiciona os elementos exibidos no palco.
 *
 * `layout`: layout salvo (frações do HUD); `heights`: altura medida (px do palco) de cada id em `ids`; `k`: `--k`;
 * `keepOut`: regiões vitais (`keepOutRects`); `sticky`: ids recolhidos no desenho anterior (histerese); `auto`: desligado
 * (modo interativo) devolve o layout salvo sem mexer, para editar o que se vê.
 *
 * Devolve `{ frame, auto, rects, collapsed, moved }`: `rects[id]` = `{x,y,width,height}` em px do palco (só dos exibidos);
 * `collapsed` = ids recolhidos por falta de espaço (nesta ordem: do mais importante ao menos); `moved` = ids que saíram do
 * lugar salvo. Pura e determinística; nunca lança.
 */
export function arrangeElements({
  stage,
  layout,
  heights = {},
  ids = ELEMENT_IDS,
  k = 1,
  keepOut = [],
  sticky = [],
  auto = true,
} = {}) {
  const frame = stageFrame(stage);
  const result = { frame, auto, rects: {}, collapsed: [], moved: [] };
  if (!frame.width) return result;
  const kk = pos(k) || 1,
    m = marginPx(frame),
    gap = Math.max(2, Math.round(8 * kk)),
    slack = Math.round(RESTORE_SLACK * kk),
    stuck = new Set(sticky),
    zones = (keepOut ?? []).filter(validRect),
    wanted = {};
  const list = [...new Set(ids)].filter((id) => layout?.[id]);
  for (const id of list)
    wanted[id] = wantedRect(id, layout[id], frame, kk, heights[id], auto);

  if (!auto) {
    for (const id of list) if (wanted[id]) result.rects[id] = wanted[id];
    return result;
  }

  const placed = [];
  const accept = (id, rect) => {
    const w = wanted[id];
    placed.push({ id, ...rect });
    result.rects[id] = rect;
    if (Math.abs(rect.x - w.x) > 1 || Math.abs(rect.y - w.y) > 1)
      result.moved.push(id);
  };
  const inStage = (r) =>
    r.x >= m &&
    r.y >= m &&
    r.x + r.width <= frame.width - m &&
    r.y + r.height <= frame.height - m;
  /** Vaga válida: dentro do palco e livre de outros elementos (com `extra` de folga) e das regiões vitais. */
  const free = (r, extra = 0) =>
    inStage(r) &&
    !placed.some((p) => overlaps(p, r, gap + extra)) &&
    !zones.some((z) => overlaps(z, r, 0));
  /** Vaga mais próxima do lugar pedido: mesma coluna primeiro, depois as barras livres (direita, esquerda). */
  const findSpot = (want, extra) => {
    const xs = [want.x];
    if (frame.bars.right >= want.width + 2 * m)
      xs.push(frame.width - m - want.width);
    if (frame.bars.left >= want.width + 2 * m) xs.push(m);
    for (const x of [...new Set(xs)]) {
      const ys = [m, want.y];
      for (const p of placed)
        ys.push(p.y + p.height + gap + extra, p.y - gap - extra - want.height);
      let best = null;
      for (const y of ys) {
        if (!free({ x, y, width: want.width, height: want.height }, extra))
          continue;
        const dist = Math.abs(y - want.y);
        if (!best || dist < best.dist) best = { y, dist };
      }
      if (best) return { x, y: best.y, width: want.width, height: want.height };
    }
    return null;
  };

  for (const id of [...list].sort(byPriority)) {
    const want = wanted[id];
    if (!want) continue;
    // Quem estava recolhido só volta com folga (histerese): evita piscar quando a altura do conteúdo oscila.
    const extra = stuck.has(id) ? slack : 0;
    // Sem conflito com ninguém mais importante, fica onde o usuário pôs (inclusive sobre o HUD, se foi escolha dele).
    if (inStage(want) && !placed.some((p) => overlaps(p, want, extra))) {
      accept(id, want);
      continue;
    }
    const spot = findSpot(want, extra);
    if (spot) {
      accept(id, spot);
      continue;
    }
    if (PROTECTED_IDS.includes(id)) {
      // Nunca some: sem vaga, fica no lugar salvo (pode sobrepor) em vez de ser recolhido.
      accept(id, want);
      continue;
    }
    result.collapsed.push(id);
  }
  return result;
}

const fmt = (n) => r2(n).toFixed(2).replace(".", ",");

/**
 * Resumo de adaptação para o dock e a ajuda. `dpr` = `window.devicePixelRatio` (tamanho físico = DIP x dpr);
 * `arrangement` = retorno de `arrangeElements`.
 */
export function fitSummary(
  stage,
  { dpr = 1, userScale = 1, arrangement = null } = {},
) {
  const info = scaleInfo(stage, userScale);
  const f = info.frame;
  const ratio = pos(dpr) || 1;
  const physical = {
    width: Math.round(f.width * ratio),
    height: Math.round(f.height * ratio),
  };
  const collapsed = [...(arrangement?.collapsed ?? [])];
  const moved = [...(arrangement?.moved ?? [])];
  const valid = f.kind !== "unknown";
  const size = valid ? `${physical.width}×${physical.height}` : "";
  const parts = {
    short: valid ? `${size} · ${fmt(info.k)}×` : "",
    size,
    aspect: f.aspect,
    kind: f.kind,
    hud: valid ? { width: f.hud.width, height: f.hud.height } : null,
    physical: valid ? physical : null,
    dip: valid ? { width: f.width, height: f.height } : null,
    dpr: ratio,
    k: info.k,
    base: info.base,
    user: info.user,
    limit: info.limit,
    axis: info.axis,
    auto: arrangement ? arrangement.auto !== false : true,
    collapsed,
    moved,
  };
  return { ...parts, ...fitText(parts) };
}

/** Textos (pt-BR) do resumo: `title` para o tooltip do dock, `lines` para a ajuda e `collapsedLabels`. */
export function fitText(s) {
  if (!s?.dip) return { title: "", lines: [], collapsedLabels: [] };
  const ratio =
    s.dpr && s.dpr !== 1 ? ` · tela a ${Math.round(s.dpr * 100)}%` : "";
  const axis =
    s.axis === "width"
      ? "a largura manda (janela mais estreita que 16:9)"
      : "a altura manda";
  const lines = [
    `Janela do jogo: ${s.physical.width}×${s.physical.height} px (${s.aspect ?? "?"})${ratio}`,
    s.kind === "16:9"
      ? "O HUD ocupa a janela inteira."
      : s.kind === "wide"
        ? `HUD 16:9 de ${s.hud.width}×${s.hud.height} px centralizado; sobram faixas laterais.`
        : `HUD 16:9 de ${s.hud.width}×${s.hud.height} px colado embaixo; sobra uma faixa em cima.`,
    `Escala efetiva: ${fmt(s.k)}× (${axis}; sua escala ${Math.round(s.user * 100)}%)`,
  ];
  if (s.limit === "min")
    lines.push("Janela pequena: a escala parou no mínimo de legibilidade.");
  if (s.limit === "max") lines.push("Janela grande: a escala parou no máximo.");
  const collapsedLabels = s.collapsed.map((id) => ELEMENT_LABELS[id] ?? id);
  if (collapsedLabels.length)
    lines.push(`Recolhido por falta de espaço: ${collapsedLabels.join(", ")}.`);
  if (s.moved?.length)
    lines.push(
      `Reposicionado automaticamente: ${s.moved.map((id) => ELEMENT_LABELS[id] ?? id).join(", ")}.`,
    );
  const title = lines.join("\n");
  return { title, lines, collapsedLabels };
}
