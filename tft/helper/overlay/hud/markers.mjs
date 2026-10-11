/**
 * Marcas ancoradas nos elementos do jogo: contornos sobre o espaço da loja, o banco de itens, o ouro e o nível, e as
 * etiquetas "dica" ao lado deles. `placeMarkers` é pura (sem DOM): decide o contorno de cada âncora e a posição das
 * etiquetas, agrupando as dicas que miram o mesmo alvo e empilhando as etiquetas sem sobrepô-las. `drawMarkers` e
 * `hintLine`/`drawHintList` só montam HTML; nomes de campeão e de item sempre saem como imagem (`richText`, retratos)
 * e todo texto do servidor é escapado. Nada aqui decide jogo: o texto, o tom e a âncora vêm prontos de `hints.mjs`.
 */
import { ANCHOR_SIDE, placeLabel, resolveAnchor } from "./geometry.mjs";

/** Medidas da etiqueta em px da escala base (antes de `--k`). A largura é estimada: o texto real é cortado com reticências. */
export const LABEL = Object.freeze({
  padX: 8,
  padY: 5,
  line: 28,
  whyLine: 34,
  icon: 26,
  gap: 6,
  part: 24,
  minW: 120,
  maxW: 340,
  whyW: 240,
  charW: 6.6,
  pointerGap: 6,
  stackGap: 4,
});

/** Dicas passivas que viram selo no alvo (marca de juros no ouro, selo do nível) em vez de contorno de ação. */
const SEALS = { "gold:interest": "interest", "level:seal": "level" };

/** Ícone de categoria quando a dica não traz imagem própria. */
const CATEGORY_GLYPH = {
  alert: "warn",
  buy: "plus",
  items: "items",
  gold: "coin",
  wisp: "wisp",
  learn: "eye",
};

const PART_MARK = {
  bank: "bank",
  equipped: "check",
  missing: "plus",
  unknown: "clock",
};

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const px = (v) => `${Math.round((finite(v) ?? 0) * 10) / 10}px`;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Selo de uma dica passiva ("interest" | "level") ou null. */
export const sealOf = (hint) => SEALS[hint?.id] ?? null;

/** Chave do alvo: dicas com a mesma chave dividem contorno e etiqueta. */
export const groupKey = (anchor) =>
  `${anchor?.kind ?? "none"}:${anchor?.slot ?? ""}`;

/**
 * O "porquê" aparece na etiqueta e na lista só na verbosidade detalhada ou quando a dica é da categoria "aprender" e
 * ela está ligada. `settings`: `parseHintSettings`.
 */
export function showsWhy(hint, settings) {
  if (!hint?.why) return false;
  if (settings?.verbosity === "detailed") return true;
  return hint.category === "learn" && settings?.categories?.learn === true;
}

/** Largura estimada de um texto em px da escala base. */
export const textWidth = (text) => String(text ?? "").length * LABEL.charW;

/** Verbosidade mínima: a etiqueta mostra a forma curta (ícone + número/retratos), sem ação nem porquê. */
export const isCompact = (settings) => settings?.verbosity === "minimal";

/** Texto visível da dica: a forma curta na verbosidade mínima (quando existe); senão a frase. */
export const shownText = (hint, settings) =>
  isCompact(settings) && hint?.short ? hint.short : hint?.text;

/** Frase completa para a dica do mouse (modo interativo): texto, ação e porquê. */
export const fullText = (hint) =>
  [hint?.text, hint?.action, hint?.why].filter(Boolean).join(" · ");

/**
 * Tamanho da etiqueta de um grupo de dicas, em px do palco (já com `k`). `measure(texto)` mede um trecho (a página passa
 * uma que conta cada nome trocado por imagem como um retrato); `cap` é a largura máxima na escala base.
 */
export function labelSize(
  hints,
  k = 1,
  settings = null,
  measure = textWidth,
  cap = LABEL.maxW,
) {
  let width = 0,
    height = LABEL.padY * 2,
    why = false;
  const compact = isCompact(settings);
  for (const h of hints) {
    let w = LABEL.icon + LABEL.gap + measure(shownText(h, settings));
    if (h.probable) w += 14;
    if (h.action && !compact) w += 22 + measure(h.action);
    if (h.parts?.length) w += 8 + h.parts.length * LABEL.part;
    width = Math.max(width, w);
    height += LABEL.line;
    if (showsWhy(h, settings)) {
      height += LABEL.whyLine;
      why = true;
    }
  }
  const maxW = Math.max(cap, why ? LABEL.whyW : 0);
  const base = clamp(width + LABEL.padX * 2, LABEL.minW, maxW);
  return { width: base * k, height: height * k };
}

/**
 * Afasta uma etiqueta das já colocadas empilhando no sentido que se afasta do alvo (para cima se a etiqueta está acima;
 * para baixo nos demais lados), e tenta o sentido oposto se sair do palco. Sem vaga, mantém a posição original.
 */
export function avoidOverlap(pos, size, taken, stage, pad = 0) {
  const hits = (y) =>
    taken.some(
      (t) =>
        pos.x < t.x + t.width + pad &&
        pos.x + size.width + pad > t.x &&
        y < t.y + t.height + pad &&
        y + size.height + pad > t.y,
    );
  const free = (y) => y >= 0 && y + size.height <= stage.height && !hits(y);
  const dir = pos.side === "top" ? -1 : 1,
    step = size.height + pad;
  for (let n = 0; n < 8; n++)
    for (const d of [dir, -dir]) {
      const y = pos.y + d * n * step;
      if (free(y)) return { ...pos, y };
    }
  return pos;
}

/**
 * Marcas das dicas. `hints`: lista de `buildHints`; `rects`: `anchorRects(stage, calibração)`; `stage`: `{width,height}`
 * da janela. `opts`: `{ k, settings, measure, avoid }` (`k` = `--k`, ver `fit.mjs`; `avoid` = retângulos em px do palco que as
 * etiquetas evitam cobrir, opcional).
 *
 * Devolve uma entrada por (dica, âncora com retângulo): `{ hintId, hint, rect, anchor, group, label, lead, count }`.
 * `label` é compartilhada pelas dicas do mesmo alvo (`{ x, y, side, width, height, pointer }`, px do palco; `pointer` =
 * deslocamento da ponta ao longo da borda da etiqueta); `lead` marca a primeira do grupo. Dicas sem âncora geométrica
 * (kind "none" ou fora do mapa) não geram marca: só aparecem na lista de dicas.
 */
export function placeMarkers(hints, rects, stage, opts = {}) {
  if (!rects || !stage || !(stage.width > 0) || !(stage.height > 0)) return [];
  const k =
    finite(opts.k) !== null && opts.k > 0
      ? opts.k
      : Math.max(0.25, stage.height / 1080);
  const groups = new Map();
  for (const hint of Array.isArray(hints) ? hints : []) {
    const anchors = hint?.anchors?.length ? hint.anchors : [hint?.anchor];
    for (const anchor of anchors) {
      if (!anchor || anchor.kind === "none") continue;
      const rect = resolveAnchor(anchor, rects);
      if (!rect) continue;
      const key = groupKey(anchor);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, anchor, rect, hints: [] }));
      if (!g.hints.includes(hint)) g.hints.push(hint);
    }
  }
  // `opts.avoid`: retângulos que as etiquetas não devem cobrir (os elementos do overlay já posicionados).
  const taken = (Array.isArray(opts.avoid) ? opts.avoid : [])
    .filter(
      (r) =>
        r &&
        [r.x, r.y, r.width, r.height].every((n) => finite(n) !== null) &&
        r.width > 0 &&
        r.height > 0,
    )
    .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  for (const g of groups.values()) {
    // Etiqueta de loja não passa da largura do cartão (as vizinhas não se cobrem); o resto usa o teto padrão.
    const cap =
      g.anchor.kind === "shop" ? Math.max(150, g.rect.width / k) : LABEL.maxW;
    const size = labelSize(
        g.hints,
        k,
        opts.settings,
        opts.measure ?? textWidth,
        cap,
      ),
      side = ANCHOR_SIDE?.[g.anchor.kind] ?? "top",
      first = placeLabel(g.rect, size, stage, side, LABEL.pointerGap * k),
      pos = avoidOverlap(first, size, taken, stage, LABEL.stackGap * k);
    taken.push({ x: pos.x, y: pos.y, width: size.width, height: size.height });
    const vertical = pos.side === "top" || pos.side === "bottom",
      center = vertical
        ? g.rect.x + g.rect.width / 2 - pos.x
        : g.rect.y + g.rect.height / 2 - pos.y,
      span = vertical ? size.width : size.height;
    g.label = {
      x: pos.x,
      y: pos.y,
      side: pos.side,
      width: size.width,
      height: size.height,
      pointer: clamp(center, 12 * k, span - 12 * k),
    };
  }
  const out = [];
  for (const g of groups.values())
    g.hints.forEach((hint, i) =>
      out.push({
        hintId: hint.id,
        hint,
        rect: g.rect,
        anchor: g.anchor,
        group: g.key,
        label: g.label,
        lead: i === 0,
        count: g.hints.length,
      }),
    );
  return out;
}

/* ---------- HTML ---------- */

/** Ícone da linha: retrato da peça só se o texto ainda não cita o nome (a frase já traz a imagem); senão o glifo. */
function iconHtml(hint, ui) {
  const { esc, glyph } = ui,
    ic = hint.icon,
    mentioned =
      !!ic?.name &&
      String(shownText(hint, ui.settings) ?? "")
        .toLowerCase()
        .includes(String(ic.name).toLowerCase());
  let inner;
  if (ic?.kind === "champion" && ic.id && !mentioned && ui.unitPortrait)
    inner = ui.unitPortrait(ic.id, ic.name, null, 24);
  else if (ic?.kind === "item" && ic.id && !mentioned && ui.itemPortrait)
    inner = ui.itemPortrait({ id: ic.id, name: ic.name }, { size: 24 });
  else
    inner = glyph(
      (ic?.kind === "glyph" && ic.id) ||
        CATEGORY_GLYPH[hint.category] ||
        "flag",
    );
  return `<span class="hl-ic" data-tone="${esc(hint.tone)}" data-kind="${esc(ic?.kind ?? "category")}">${inner}</span>`;
}

/** Componentes de uma receita ("Monte X com A + B"): ícones com a situação de cada um. */
function partsHtml(hint, ui) {
  if (!hint.parts?.length || !ui.itemPortrait) return "";
  const { esc, glyph } = ui;
  return `<span class="hl-parts nx-recipe" role="group">${hint.parts
    .map(
      (p) =>
        `<span class="nx-part" data-state="${esc(p.state)}" role="img" aria-label="${esc(p.name)}: ${esc(p.state)}" title="${esc(p.name)}: ${esc(p.state)}">${ui.itemPortrait({ id: p.id, name: p.name }, { size: 20, hidden: true })}<i class="nx-mark">${glyph(PART_MARK[p.state] ?? "clock")}</i></span>`,
    )
    .join("")}</span>`;
}

/**
 * Uma dica em HTML: ícone, frase (nomes viram imagens), "?" se a leitura é só provável, componentes, ação e, conforme
 * a verbosidade, o porquê. `ui`: `{ esc, richText, glyph, unitPortrait, itemPortrait, settings }`.
 */
export function hintLine(hint, ui) {
  const { esc, richText } = ui,
    compact = isCompact(ui.settings);
  // Na mínima a frase inteira (com ação e porquê) fica na dica do mouse, visível no modo interativo.
  const title = compact ? ` title="${esc(fullText(hint))}"` : "";
  return `<div class="hl" data-id="${esc(hint.id)}" data-tone="${esc(hint.tone)}" data-category="${esc(hint.category)}" data-stale="${hint.stale ? 1 : 0}" data-probable="${hint.probable ? 1 : 0}"${compact ? ' data-compact="1"' : ""}${title}><div class="hl-main">${iconHtml(hint, ui)}<span class="hl-tx">${richText(shownText(hint, ui.settings), { size: 18 })}</span>${hint.probable ? '<i class="hl-q" title="Leitura provável da loja: confira na tela do jogo">?</i>' : ""}${partsHtml(hint, ui)}${hint.action && !compact ? `<b class="hl-act">${esc(hint.action)}</b>` : ""}</div>${!compact && showsWhy(hint, ui.settings) ? `<p class="hl-why">${richText(hint.why, { size: 16 })}</p>` : ""}</div>`;
}

/** Agrupa as entradas de `placeMarkers` por alvo, na ordem em que aparecem. */
function byGroup(placed) {
  const groups = new Map();
  for (const m of Array.isArray(placed) ? placed : []) {
    let g = groups.get(m.group);
    if (!g)
      groups.set(
        m.group,
        (g = {
          key: m.group,
          rect: m.rect,
          anchor: m.anchor,
          label: m.label,
          entries: [],
        }),
      );
    g.entries.push(m);
  }
  return [...groups.values()];
}

/** Contorno do alvo: pulsante se alguma dica pede, tracejado se todas são leitura provável, esmaecido se todas velhas. */
function outlineHtml(g, ui) {
  const { esc, glyph } = ui,
    hints = g.entries.map((e) => e.hint),
    top = hints[0],
    seals = hints.map(sealOf),
    quiet = seals.every(Boolean),
    seal = seals.find(Boolean);
  const r = g.rect;
  return `<div class="mk" data-kind="${esc(g.anchor.kind)}"${g.anchor.slot != null ? ` data-slot="${esc(g.anchor.slot)}"` : ""} data-tone="${esc(top.tone)}" data-pulse="${hints.some((h) => h.pulse) ? 1 : 0}" data-probable="${hints.every((h) => h.probable) ? 1 : 0}" data-stale="${hints.every((h) => h.stale) ? 1 : 0}" data-quiet="${quiet ? 1 : 0}" style="left:${px(r.x)};top:${px(r.y)};width:${px(r.width)};height:${px(r.height)}">${seal ? `<i class="mk-badge" data-seal="${esc(seal)}">${glyph(seal === "interest" ? "coin" : "up")}</i>` : ""}</div>`;
}

/** Etiqueta "dica" do alvo, na escala `--k` do palco, com a ponta voltada para o contorno. */
function labelHtml(g, ui) {
  const { esc } = ui,
    k = finite(ui.k) !== null && ui.k > 0 ? ui.k : 1,
    l = g.label,
    hints = g.entries.map((e) => e.hint),
    stale = hints.every((h) => h.stale);
  return `<div class="mk-label" data-side="${esc(l.side)}" data-tone="${esc(hints[0].tone)}" data-stale="${stale ? 1 : 0}" data-group="${esc(g.key)}" style="left:${px(l.x)};top:${px(l.y)};width:${px(l.width / k)};height:${px(l.height / k)};--pt:${px(l.pointer / k)}">${hints.map((h) => hintLine(h, ui)).join("")}</div>`;
}

/**
 * HTML de todas as marcas (contorno + etiqueta por alvo). `ui`: `{ esc, richText, glyph, unitPortrait, itemPortrait,
 * settings, k }`. Coordenadas em px do palco; a etiqueta é escalada por CSS (`transform: scale(var(--k))`).
 */
export function drawMarkers(placed, ui) {
  return byGroup(placed)
    .map((g) => outlineHtml(g, ui) + labelHtml(g, ui))
    .join("");
}

/**
 * Lista de dicas do elemento "hints": todas as dicas priorizadas, as ancoradas e as que só aparecem aqui.
 * `result`: `{ hints, total, hidden }` de `buildHints`.
 */
export function drawHintList(result, ui) {
  const anchored = (h) => !!h.anchor?.kind && h.anchor.kind !== "none";
  // Compacto com as marcas sobre o jogo: a lista só traz o que NÃO tem marca (o resto já está no alvo; não repete).
  const hints = (result?.hints ?? []).filter(
    (h) => !(ui.onlyUnanchored && anchored(h)),
  );
  if (!hints.length) return "";
  const { esc } = ui,
    hidden = finite(result.hidden) ?? 0,
    more =
      hidden > 0
        ? `<small class="chip" title="${esc(hidden)} dica(s) fora do filtro de verbosidade; aumente a verbosidade na ajuda para vê-las">+${esc(hidden)}</small>`
        : "";
  const head = isCompact(ui.settings)
    ? more
      ? `<header>${more}</header>`
      : ""
    : `<header><span class="eyebrow">Dicas</span>${more}</header>`;
  return `${head}<ul class="hl-list">${hints
    .map(
      (h) =>
        `<li data-anchored="${h.anchor?.kind && h.anchor.kind !== "none" ? 1 : 0}">${hintLine(h, ui)}</li>`,
    )
    .join("")}</ul>`;
}
