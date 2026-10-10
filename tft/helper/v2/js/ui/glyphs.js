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
let catalog = {
  champions: new Map(),
  items: new Map(),
  traits: new Map(),
  traitIcons: new Map(),
};
export const setCatalog = (c) => (catalog = c);
export const getCatalog = () => catalog;
export const champIcon = (id) => catalog.champions.get(id)?.icon ?? null;
export const itemIcon = (id) => catalog.items.get(id)?.icon ?? null;
export const traitIcon = (name) => catalog.traitIcons?.get(name) ?? null;
export const itemName = (id) =>
  catalog.items.get(id)?.name ?? String(id ?? "").replace(/^DA_/, "");

const initials = (name) => String(name ?? "?").slice(0, 2);
/** Retrato redondo/arredondado; se a imagem falhar, mostra as iniciais. */
export const portrait = (
  id,
  name,
  { kind = "champion", size = 30, ring = "", badge = "", hidden = false } = {},
) => {
  const src = kind === "item" ? itemIcon(id) : champIcon(id),
    label = esc(name);
  // O nome fica acessível sem texto visível: `role="img"` + rótulo (com selo, o `title` basta para não ocultar o selo).
  // `hidden`: o chamador já escreve o nome ao lado (texto rico), então o retrato some para leitores de tela.
  const a11y = hidden
    ? ' aria-hidden="true"'
    : badge
      ? ""
      : ` role="img" aria-label="${label}"`;
  return `<span class="pt ${kind === "item" ? "pt-item" : ""} ${ring}" style="--s:${size}px" data-i="${esc(initials(name))}" title="${label}"${a11y}>${src ? `<img src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">` : ""}${badge}</span>`;
};
/** Nome do campeão pelo catálogo (o id cru só quando o catálogo ainda não carregou). */
export const champName = (id) =>
  catalog.champions.get(id)?.name ?? String(id ?? "");
/** Retrato de campeão com o anel na cor do custo (padrão de "Substituições"); o custo vem do catálogo se não informado. */
export const unitPortrait = (id, name, cost = null, size = 32) =>
  `<span class="sub-pt" style="--ring-c:var(--cost-${Math.min(5, Math.max(1, cost ?? catalog.champions.get(id)?.cost ?? 1))})">${portrait(id, name ?? champName(id), { size })}</span>`;
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
