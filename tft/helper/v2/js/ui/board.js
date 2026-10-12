import { el, svg, setVars, reconcile } from "../dom.js";
import { boardSize, hexCenter, hexPoints } from "../math.js";
import { champIcon, traitIcon } from "./glyphs.js";
import { cellLook } from "../board-look.js";

const SIZE = 36,
  COLS = 7,
  ROWS = 4,
  GAP = 4.5,
  R = SIZE - GAP,
  BADGE = 11,
  PAD = 12;
const { width: W, height: H } = boardSize(COLS, ROWS, SIZE);
const COST_VAR = (c) => `var(--cost-${Math.min(5, Math.max(1, c))})`;

/**
 * Formação alvo em hexágonos. Só mostra estado: peça em campo (sólida), a comprar (tracejada) e,
 * no canto da casa que recebe a peça, um selo com quem sai. Na vaga com substituto (`cell.sub`, board-look.js) o
 * retrato é de quem joga, com o original pequeno no canto e o selo ⇄; a peça da loja ganha o selo de compra.
 * Detalhes ficam em tooltip e na trilha "Agora".
 */
export function mountBoard(root, traitsRoot, { onSelect = () => {} } = {}) {
  let selected = null;
  const defs = svg(
    "defs",
    {},
    svg(
      "clipPath",
      { id: "clip-hex" },
      svg("polygon", { points: hexPoints(0, 0, R - 1) }),
    ),
    svg("clipPath", { id: "clip-badge" }, svg("circle", { r: BADGE })),
  );
  const grid = svg("g", { class: "grid" }),
    cellsLayer = svg("g", { class: "cells" }),
    empty = svg(
      "text",
      { class: "axis empty", x: W / 2, y: H / 2, "text-anchor": "middle" },
      "Aguardando a formação da comp alvo",
    );
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      const c = hexCenter(col, row, SIZE);
      grid.append(
        svg("polygon", { class: "slot", points: hexPoints(c.x, c.y, R) }),
      );
    }
  root.setAttribute("viewBox", `${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2}`);
  // As casas são botões focáveis: o contêiner é um grupo (um `role="img"` tornaria os filhos decorativos).
  root.setAttribute("role", "group");
  root.replaceChildren(defs, grid, cellsLayer, empty);
  /** Marca a casa escolhida: o contorno (CSS) e `aria-pressed` (leitor de tela) andam juntos. */
  const mark = (n, on) => {
    n.dataset.selected = on ? "1" : "0";
    n.setAttribute("aria-pressed", on ? "true" : "false");
  };
  const pick = (target) => {
    const g = target.closest?.(".cell");
    if (!g) return;
    selected = selected === g.dataset.k ? null : g.dataset.k;
    for (const n of cellsLayer.children) mark(n, n.dataset.k === selected);
    onSelect(selected);
  };
  cellsLayer.addEventListener("click", (e) => pick(e.target));
  cellsLayer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(e.target);
    }
  });

  const cellNode = () => {
    const shape = hexPoints(0, 0, R);
    const swap = svg(
      "g",
      { class: "cell-swap" },
      svg("circle", { class: "swap-bg", r: BADGE + 1.5 }),
      svg("image", {
        class: "swap-img",
        x: -BADGE,
        y: -BADGE,
        width: BADGE * 2,
        height: BADGE * 2,
        "clip-path": "url(#clip-badge)",
        preserveAspectRatio: "xMidYMid slice",
      }),
      svg("circle", { class: "swap-ring", r: BADGE + 1.5 }),
      svg(
        "svg",
        {
          class: "swap-plus",
          viewBox: "0 0 24 24",
          width: 14,
          height: 14,
          x: -7,
          y: -7,
        },
        svg("use", { href: "#i-plus" }),
      ),
    );
    swap.setAttribute("transform", `translate(${-R * 0.58} ${R * 0.58})`);
    const crown = svg(
      "g",
      { class: "cell-crown" },
      svg("circle", { r: 8 }),
      svg(
        "svg",
        { viewBox: "0 0 24 24", width: 11, height: 11, x: -5.5, y: -5.5 },
        svg("use", { href: "#i-crown" }),
      ),
    );
    crown.setAttribute("transform", `translate(${R * 0.5} ${-R * 0.58})`);
    const cost = svg(
      "g",
      { class: "cell-cost" },
      svg("circle", { r: 7.5 }),
      svg("text", { "text-anchor": "middle", y: 3.4 }),
    );
    cost.setAttribute("transform", `translate(${-R * 0.5} ${-R * 0.58})`);
    // Original da vaga, pequeno e esmaecido no canto de baixo (no lugar do selo de quem sai), com o selo ⇄.
    const orig = svg(
      "g",
      { class: "cell-orig" },
      svg("circle", { class: "orig-bg", r: BADGE + 1.5 }),
      svg("image", {
        class: "orig-img",
        x: -BADGE,
        y: -BADGE,
        width: BADGE * 2,
        height: BADGE * 2,
        "clip-path": "url(#clip-badge)",
        preserveAspectRatio: "xMidYMid slice",
      }),
      svg("circle", { class: "orig-ring", r: BADGE + 1.5 }),
    );
    orig.setAttribute("transform", `translate(${-R * 0.58} ${R * 0.58})`);
    const subMark = svg(
      "g",
      { class: "cell-sub" },
      svg("circle", { r: 6.5 }),
      svg(
        "svg",
        { viewBox: "0 0 24 24", width: 10, height: 10, x: -5, y: -5 },
        svg("use", { href: "#i-swap" }),
      ),
    );
    subMark.setAttribute(
      "transform",
      `translate(${-R * 0.58 + BADGE} ${R * 0.58 - BADGE})`,
    );
    // Selo de compra: moeda e preço, no canto de baixo à direita.
    const buy = svg(
      "g",
      { class: "cell-buy" },
      svg("rect", { x: -12, y: -7, width: 24, height: 14, rx: 7 }),
      svg(
        "svg",
        { viewBox: "0 0 24 24", width: 10, height: 10, x: -10, y: -5 },
        svg("use", { href: "#i-coin" }),
      ),
      svg("text", { "text-anchor": "middle", x: 4.5, y: 3.4 }),
    );
    buy.setAttribute("transform", `translate(${R * 0.58} ${R * 0.58})`);
    return svg(
      "g",
      { class: "cell", tabindex: 0, role: "button" },
      svg("polygon", { class: "cell-bg", points: shape }),
      svg("image", {
        class: "cell-img",
        x: -R,
        y: -R,
        width: R * 2,
        height: R * 2,
        "clip-path": "url(#clip-hex)",
        preserveAspectRatio: "xMidYMid slice",
      }),
      svg("polygon", { class: "cell-shade", points: shape }),
      svg("polygon", { class: "cell-ring", points: shape }),
      svg("text", {
        class: "cell-stars",
        y: R * 0.62,
        "text-anchor": "middle",
      }),
      crown,
      cost,
      swap,
      orig,
      subMark,
      buy,
      svg("text", {
        class: "swap-frac",
        x: -R * 0.58 + BADGE + 4,
        y: R * 0.58 + 3.5,
      }),
      svg("title"),
    );
  };
  const updateCell = (g, c) => {
    const p = hexCenter(c.col, c.row, SIZE);
    setVars(g, { "--x": p.x.toFixed(2), "--y": p.y.toFixed(2) });
    g.dataset.status = c.status;
    mark(g, c.id === selected);
    g.dataset.carry = c.carry ? "1" : "0";
    const look = cellLook(c);
    const src = champIcon(look.image);
    if (src) g.querySelector(".cell-img").setAttribute("href", src);
    g.querySelector(".cell-stars").textContent = "★".repeat(look.stars);
    const cost = g.querySelector(".cell-cost");
    cost.querySelector("circle").style.fill = COST_VAR(look.cost);
    cost.querySelector("text").textContent = look.cost;
    // Vaga com outra peça jogando: o original pequeno no canto, com o anel na cor do custo dele.
    if (look.sub) g.dataset.sub = look.sub;
    else delete g.dataset.sub;
    if (look.original) {
      const img = g.querySelector(".orig-img"),
        osrc = champIcon(look.original.id);
      if (osrc) img.setAttribute("href", osrc);
      else img.removeAttribute("href");
      // Variável, não estilo inline: o CSS de `forced-colors` ainda troca a cor.
      setVars(g.querySelector(".cell-orig"), {
        "--orig-c": COST_VAR(look.original.cost),
      });
    }
    if (look.buy) {
      g.dataset.buy = "1";
      g.querySelector(".cell-buy text").textContent = look.buy.cost;
    } else delete g.dataset.buy;
    const s = c.swap;
    if (s) g.dataset.swap = s.kind;
    else delete g.dataset.swap;
    if (s) {
      const img = g.querySelector(".swap-img");
      if (s.exit) img.setAttribute("href", champIcon(s.exit.id) ?? "");
      else img.removeAttribute("href");
      g.querySelector(".swap-img").style.display = s.exit ? "" : "none";
      g.querySelector(".swap-plus").style.display = s.exit ? "none" : "";
      g.querySelector(".swap-frac").textContent =
        s.kind === "hold" && s.need ? `${s.have}/${s.need}` : "";
    }
    // A casa é a imagem do campeão; o texto (board-look.js: vaga, posse de agora, troca, motivo) vai na dica do SVG e
    // no rótulo do botão (leitor de tela e teclado).
    const label = look.label;
    const tip = g.querySelector("title");
    if (tip.textContent !== label) {
      tip.textContent = label;
      g.setAttribute("aria-label", label);
    }
  };

  /* Sinergias: contagem e progresso até o próximo patamar. */
  // Ícone da sinergia como máscara: a silhueta do jogo é tingida pela cor do estado (ativa ou não).
  const traitNode = () =>
    el(
      "li",
      { class: "trait" },
      el("em", { class: "trait-icon", "aria-hidden": "true" }),
      el("b"),
      el("span"),
      el("i"),
    );
  const updateTrait = (li, t) => {
    li.dataset.active = t.active ? "1" : "0";
    const icon = traitIcon(t.name),
      mark = li.querySelector(".trait-icon");
    mark.hidden = !icon;
    if (icon) mark.style.setProperty("--icon", `url("${icon}")`);
    li.querySelector("b").textContent = t.count;
    li.querySelector("span").textContent = t.name;
    setVars(li.querySelector("i"), {
      "--p": t.next ? Math.min(1, t.count / t.next) : 1,
    });
    const via = t.emblem ? ` (${t.emblem} por emblema equipado)` : "";
    li.dataset.emblem = t.emblem ? "1" : "0";
    li.title = t.next
      ? `${t.name}: ${t.count} de ${t.next} para o próximo patamar${via}`
      : `${t.name}: ${t.count}${via}`;
  };

  return {
    /** Desmarca a peça selecionada (ex.: ao fechar o detalhe). */
    clear() {
      selected = null;
      for (const n of cellsLayer.children) mark(n, false);
    },
    update(plan) {
      const cells = plan?.cells ?? [];
      if (selected && !cells.some((c) => c.id === selected)) {
        selected = null;
        onSelect(null);
      }
      empty.style.display = cells.length ? "none" : "";
      reconcile(cellsLayer, cells, {
        key: (c) => c.id,
        create: cellNode,
        update: updateCell,
      });
      reconcile(
        traitsRoot,
        (plan?.traits ?? []).filter((t) => t.count > 0),
        { key: (t) => t.name, create: traitNode, update: updateTrait },
      );
    },
  };
}
