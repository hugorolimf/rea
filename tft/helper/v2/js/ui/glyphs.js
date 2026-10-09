import { svg, esc } from "../dom.js";

/** Ícone do sprite definido em index.html (`<symbol id="i-nome">`). */
export const glyph = (name, cls = "") =>
  `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const glyphNode = (name, cls = "") =>
  svg(
    "svg",
    { class: `i ${cls}`, "aria-hidden": "true" },
    svg("use", { href: `#i-${name}` }),
  );

/** Referência a champions/itens do catálogo para montar retratos. */
let catalog = { champions: new Map(), items: new Map() };
export const setCatalog = (c) => (catalog = c);
export const champIcon = (id) => catalog.champions.get(id)?.icon ?? null;
export const itemIcon = (id) => catalog.items.get(id)?.icon ?? null;
export const itemName = (id) =>
  catalog.items.get(id)?.name ?? String(id ?? "").replace(/^DA_/, "");

const initials = (name) => String(name ?? "?").slice(0, 2);
/** Retrato redondo/arredondado; se a imagem falhar, mostra as iniciais. */
export const portrait = (
  id,
  name,
  { kind = "champion", size = 30, ring = "", badge = "" } = {},
) => {
  const src = kind === "item" ? itemIcon(id) : champIcon(id);
  return `<span class="pt ${kind === "item" ? "pt-item" : ""} ${ring}" style="--s:${size}px" data-i="${esc(initials(name))}" title="${esc(name)}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : ""}${badge}</span>`;
};
export const itemPortrait = (item, opts = {}) =>
  portrait(item.id, item.name ?? itemName(item.id), {
    ...opts,
    kind: "item",
    size: opts.size ?? 28,
  });
export const pips = (have, total, tone = "") =>
  `<span class="pips ${tone}" role="img" aria-label="${have} de ${total}">${Array.from({ length: total }, (_, i) => `<i${i < have ? ' class="on"' : ""}></i>`).join("")}</span>`;
export const pct = (v) =>
  typeof v === "number" ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%` : "—";
export const stars = (n) => (n > 0 ? "★".repeat(Math.min(n, 4)) : "");
