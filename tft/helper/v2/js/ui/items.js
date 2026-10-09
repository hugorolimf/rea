import { esc } from "../dom.js";
import {
  ATTRS,
  TIER_KINDS,
  attrMatrix,
  filterItems,
  kindCounts,
  placeScale,
  recipeGrid,
  statList,
  tierRows,
} from "../items.js";
import { getCatalog, glyph, portrait } from "./glyphs.js";

const PREFS = "tft-compass-items";
const TABS = [
  { key: "tier", label: "Tier" },
  { key: "recipes", label: "Receitas" },
  { key: "attrs", label: "Atributos" },
];
const num = (v, d = 2) => String(Number(v).toFixed(d)).replace(".", ",");
const thousands = (n) =>
  n >= 1e6
    ? `${num(n / 1e6, 2)} mi`
    : n >= 1000
      ? `${Math.round(n / 1000)} mil`
      : String(n);
const attrStyle = (a) => `--h:${a.hue}`;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "null");
    if (p && typeof p === "object")
      return {
        tab: TABS.some((t) => t.key === p.tab) ? p.tab : "tier",
        kind: typeof p.kind === "string" ? p.kind : "completed",
        attrs: [],
        query: "",
        sort: null,
        selected: null,
      };
  } catch {}
  return {
    tab: "tier",
    kind: "completed",
    attrs: [],
    query: "",
    sort: null,
    selected: null,
  };
}
function savePrefs({ tab, kind }) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ tab, kind }));
  } catch {}
}

/** Ícone quadrado do item; sem imagem, as iniciais. */
const icon = (i, size = 44) =>
  `<span class="it-icon" style="--s:${size}px" data-i="${esc((i?.name ?? "?").slice(0, 2))}">${i?.icon ? `<img src="${esc(i.icon)}" alt="" loading="lazy" decoding="async">` : ""}</span>`;
/** Pontos coloridos dos atributos do item (um por atributo). */
const dots = (i) =>
  `<span class="it-dots" aria-hidden="true">${statList(i)
    .map((s) => `<i style="${attrStyle(s)}"></i>`)
    .join("")}</span>`;
const tierBadge = (t, cls = "") =>
  t ? `<span class="tier tier-${t} ${cls}" title="Tier ${t}">${t}</span>` : "";

/**
 * Tela de itens: Tier (faixas S–D por categoria), Receitas (grade componente × componente) e Atributos
 * (matriz item × atributo). Filtros de texto e atributo destacam os itens que casam; o detalhe à direita
 * mostra desempenho, atributos, receita, descrição e quem mais usa o item.
 */
export function mountItems(root) {
  const prefs = loadPrefs();
  root.innerHTML = `
    <div class="section-head"><h2 id="itemtier-title">Itens</h2><span class="chips" data-ref="source"></span></div>
    <div class="items-bar">
      <div class="seg" role="tablist" aria-label="Visão" data-ref="tabs">${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.key}">${t.label}</button>`).join("")}</div>
      <input type="search" data-ref="q" placeholder="Item, componente ou sinergia" aria-label="Buscar item" autocomplete="off">
    </div>
    <div class="items-filters">
      <div class="seg" role="group" aria-label="Categoria" data-ref="kinds"></div>
      <div class="attr-chips" role="group" aria-label="Atributos" data-ref="attrs">${ATTRS.map((a) => `<button type="button" data-attr="${a.key}" style="${attrStyle(a)}" aria-pressed="false" title="${esc(a.label)}"><i></i>${esc(a.short)}</button>`).join("")}</div>
    </div>
    <div class="items-body">
      <div class="items-main" data-ref="main" aria-live="polite"></div>
      <aside class="item-detail" data-ref="detail" aria-label="Detalhe do item"></aside>
    </div>`;
  const ref = (k) => root.querySelector(`[data-ref="${k}"]`);
  let data = null;

  const changed = () => {
    savePrefs(prefs);
    draw();
  };
  ref("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    prefs.tab = b.dataset.tab;
    changed();
  });
  ref("kinds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    prefs.kind = b.dataset.kind;
    prefs.selected = null;
    changed();
  });
  ref("attrs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-attr]");
    if (!b) return;
    const k = b.dataset.attr;
    prefs.attrs = prefs.attrs.includes(k)
      ? prefs.attrs.filter((x) => x !== k)
      : [...prefs.attrs, k];
    draw();
  });
  let typing = 0;
  ref("q").addEventListener("input", (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      prefs.query = e.target.value;
      draw();
    }, 100);
  });
  root.addEventListener("click", (e) => {
    const sort = e.target.closest("[data-sort]");
    if (sort) {
      prefs.sort = prefs.sort === sort.dataset.sort ? null : sort.dataset.sort;
      return draw();
    }
    const pick = e.target.closest("[data-item]");
    if (pick) {
      prefs.selected = pick.dataset.item;
      draw();
    }
  });

  /* ---------- Visões ---------- */

  function tierView(list, hit) {
    return `<ol class="tier-board">${tierRows(list)
      .map(
        (row) => `<li class="tier-row" data-tier="${row.tier ?? "none"}">
          <span class="tier-label">${row.tier ?? "—"}</span>
          <div class="tier-items">${row.items.length ? row.items.map((i) => tile(i, hit)).join("") : '<span class="tier-empty">nenhum</span>'}</div>
        </li>`,
      )
      .join("")}</ol>`;
  }
  const tile = (i, hit) =>
    `<button type="button" class="it-tile" data-item="${esc(i.id)}"${i.id === prefs.selected ? ' aria-current="true"' : ""}${hit.has(i.id) ? "" : " data-dim"} title="${esc(i.name)}${i.perf ? ` · média ${num(i.perf.post)}` : ""}">${icon(i)}<b>${i.perf ? num(i.perf.post) : "—"}</b>${dots(i)}</button>`;

  function recipeView(all, hit) {
    const g = recipeGrid(all),
      head = (c) =>
        `<th scope="col"><button type="button" class="rc-comp" data-item="${esc(c.id)}" title="${esc(c.name)}">${icon(c, 30)}</button></th>`;
    return `<div class="recipe-wrap"><table class="recipe">
      <thead><tr><th></th>${g.components.map(head).join("")}</tr></thead>
      <tbody>${g.cells
        .map(
          (row, r) =>
            `<tr><th scope="row"><button type="button" class="rc-comp" data-item="${esc(g.components[r].id)}" title="${esc(g.components[r].name)}">${icon(g.components[r], 30)}</button></th>${row
              .map((i, c) =>
                i
                  ? `<td${r === c ? ' class="diag"' : ""}><button type="button" class="rc-cell" data-item="${esc(i.id)}" data-tier="${i.perf?.tier ?? ""}"${i.id === prefs.selected ? ' aria-current="true"' : ""}${hit.has(i.id) ? "" : " data-dim"} title="${esc(i.name)}${i.perf ? ` · tier ${i.perf.tier} · média ${num(i.perf.post)}` : ""}">${icon(i, 34)}${i.perf ? `<em>${i.perf.tier}</em>` : ""}</button></td>`
                  : `<td class="empty"></td>`,
              )
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></div>
      <p class="items-note">Cada célula é o item montado com os dois componentes; a cor é o tier entre os completos.</p>`;
  }

  function attrView(list) {
    const m = attrMatrix(list, prefs.sort);
    if (!m.columns.length)
      return '<p class="items-empty">Estes itens não dão atributos de status.</p>';
    return `<div class="attr-wrap"><table class="attr-table">
      <thead><tr><th scope="col">Item</th>${m.columns
        .map(
          (c) =>
            `<th scope="col"><button type="button" data-sort="${c.key}" style="${attrStyle(c)}" aria-pressed="${prefs.sort === c.key}" title="Ordenar por ${esc(c.label)}"><i></i>${esc(c.col)}</button></th>`,
        )
        .join("")}</tr></thead>
      <tbody>${m.rows
        .map(
          (i) =>
            `<tr data-item="${esc(i.id)}"${i.id === prefs.selected ? ' aria-current="true"' : ""}><th scope="row">${icon(i, 26)}<span>${esc(i.name)}</span>${tierBadge(i.perf?.tier)}</th>${m.columns
              .map((c) => {
                const v = i.stats?.[c.key];
                return typeof v === "number"
                  ? `<td style="${attrStyle(c)};--w:${Math.max(0.08, v / c.max)}"><span class="bar"></span><b>${num(v, v % 1 ? 1 : 0)}${c.unit}</b></td>`
                  : "<td></td>";
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`;
  }

  /* ---------- Detalhe ---------- */

  function detail(i, all) {
    if (!i) return '<p class="items-empty">Escolha um item.</p>';
    const kindLabel = data.kinds.find((k) => k.key === i.kind)?.label ?? "",
      byId = new Map(all.map((x) => [x.id, x])),
      p = i.perf,
      { champions } = getCatalog();
    const perf = p
      ? `<section class="dt-perf">
          <div class="dt-avg"><b>${num(p.post)}</b><span>colocação média</span></div>
          <div class="dt-scale" style="--x:${placeScale(p.post)};--m:${placeScale(p.mean)}" role="img" aria-label="Média ${num(p.post)} contra ${num(p.mean)} da categoria">
            <i class="mean"></i><i class="mark"></i>
            <span>3º</span><span>4º</span><span>5º</span><span>6º</span>
          </div>
          <p class="dt-delta" data-good="${p.delta <= 0 ? "1" : "0"}">${p.delta <= 0 ? "▲" : "▼"} ${num(Math.abs(p.delta))} ${p.delta <= 0 ? "melhor" : "pior"} que a média dos ${esc(kindLabel.toLowerCase())} (${num(p.mean)}) · ${p.rank}º de ${p.of}</p>
          ${p.tier ? "" : `<p class="dt-sample">Sem tier: ${i.kind === "component" ? "componente" : "item"} parado no fim da partida costuma ser sobra, então a média não mede o quanto ele é bom.</p>`}
          <p class="dt-sample">${thousands(p.n)} usos${p.pick != null ? ` · em ${p.pick < 0.01 ? num(p.pick * 100, 1) : Math.round(p.pick * 100)}% das partidas` : ""}${p.shrink > 0.02 ? ` · amostra pequena: ${num(p.avg)} ajustada para ${num(p.post)}` : ""}</p>
        </section>`
      : '<p class="dt-sample">Sem estatística de partidas para este item.</p>';
    const stats = statList(i);
    const recipe =
      i.from?.length === 2
        ? `<section class="dt-recipe"><h4>Receita</h4><p>${i.from.map((c) => `<button type="button" data-item="${esc(c)}" title="${esc(byId.get(c)?.name ?? c)}">${icon(byId.get(c) ?? { name: c }, 32)}</button>`).join('<span class="op">+</span>')}<span class="op">=</span>${icon(i, 32)}</p></section>`
        : "";
    const builds =
      i.kind === "component"
        ? all
            .filter((x) => x.kind === "completed" && x.from?.includes(i.id))
            .sort((a, b) => (a.perf?.post ?? 9) - (b.perf?.post ?? 9))
        : [];
    const makes = builds.length
      ? `<section class="dt-makes"><h4>Monta</h4><p>${builds.map((x) => `<button type="button" data-item="${esc(x.id)}" title="${esc(x.name)}${x.perf ? ` · tier ${x.perf.tier}` : ""}">${icon(x, 32)}${tierBadge(x.perf?.tier, "mini")}</button>`).join("")}</p></section>`
      : "";
    const users = p?.units?.length
      ? `<section class="dt-users"><h4>Quem mais usa</h4><p>${p.units
          .map((u) => {
            const ch = champions.get(u);
            return `<span title="${esc(ch?.name ?? u)}">${portrait(u, ch?.name ?? u, { size: 30 })}<small>${esc(ch?.name ?? "")}</small></span>`;
          })
          .join("")}</p></section>`
      : "";
    return `<header class="dt-head">${icon(i, 56)}<div><h3>${esc(i.name)}</h3><p>${esc(i.nameEn ?? "")}${kindLabel ? ` · ${esc(kindLabel)}` : ""}</p></div>${tierBadge(p?.tier, "big")}</header>
      ${perf}
      ${stats.length ? `<section class="dt-stats"><h4>Atributos</h4><ul>${stats.map((s) => `<li style="${attrStyle(s)}"><i></i><b>${s.text}</b><span>${esc(s.label)}</span></li>`).join("")}</ul></section>` : ""}
      ${recipe}${makes}
      ${
        i.desc
          ? `<section class="dt-desc"><h4>Efeito</h4>${i.desc
              .split("\n")
              .map((l) => `<p>${esc(l)}</p>`)
              .join("")}</section>`
          : ""
      }
      ${users}`;
  }

  /* ---------- Desenho ---------- */

  function draw() {
    if (!data) return;
    const all = data.items,
      names = new Map(all.map((i) => [i.id, i.name]));
    for (const b of ref("tabs").children)
      (b.setAttribute("aria-selected", String(b.dataset.tab === prefs.tab)),
        b.setAttribute("aria-pressed", String(b.dataset.tab === prefs.tab)));
    // Categorias por visão: o tier só existe para as categorias com tier; receitas usam a grade fixa.
    const kinds = kindCounts(all, data.kinds).filter((k) =>
      prefs.tab === "tier" ? TIER_KINDS.includes(k.key) : k.key !== "other",
    );
    if (!kinds.some((k) => k.key === prefs.kind))
      prefs.kind = kinds[0]?.key ?? "completed";
    ref("kinds").hidden = prefs.tab === "recipes";
    ref("kinds").innerHTML = kinds
      .map(
        (k) =>
          `<button type="button" data-kind="${k.key}" aria-pressed="${k.key === prefs.kind}">${esc(k.label)} <small>${k.count}</small></button>`,
      )
      .join("");
    for (const b of ref("attrs").children)
      b.setAttribute(
        "aria-pressed",
        String(prefs.attrs.includes(b.dataset.attr)),
      );
    const scope =
        prefs.tab === "recipes"
          ? all
          : all.filter((i) => i.kind === prefs.kind),
      hit = new Set(
        filterItems(
          scope,
          { attrs: prefs.attrs, query: prefs.query },
          names,
        ).map((i) => i.id),
      );
    root.dataset.filtering =
      prefs.attrs.length || prefs.query.trim() ? "1" : "0";
    ref("main").dataset.tab = prefs.tab;
    ref("main").innerHTML =
      prefs.tab === "tier"
        ? tierView(scope, hit)
        : prefs.tab === "recipes"
          ? recipeView(all, hit)
          : attrView(scope.filter((i) => hit.has(i.id)));
    // Selecionado: o escolhido, se ainda existir; senão o melhor visível.
    const visible =
      prefs.tab === "attrs" ? scope.filter((i) => hit.has(i.id)) : scope;
    let selected = all.find((i) => i.id === prefs.selected);
    if (!selected) {
      selected =
        [...visible]
          .filter((i) => i.perf)
          .sort((a, b) => a.perf.post - b.perf.post)[0] ??
        visible[0] ??
        null;
      prefs.selected = selected?.id ?? null;
      for (const el of ref("main").querySelectorAll(
        `[data-item="${CSS.escape(prefs.selected ?? "")}"]`,
      ))
        el.setAttribute("aria-current", "true");
    }
    ref("detail").innerHTML = detail(selected, all);
  }

  return {
    update(next) {
      data = next;
      const date = next.fetchedAt
        ? new Date(next.fetchedAt).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : null;
      ref("source").innerHTML =
        `<span class="chip" title="Colocação média por item em partidas publicadas; tier por categoria com média ajustada pela amostra">${esc([next.source, next.games ? `${thousands(next.games)} partidas` : null, date && `atualizada ${date}`].filter(Boolean).join(" · "))}</span>`;
      draw();
    },
    error(message) {
      ref("main").innerHTML = `<p class="items-empty">${esc(message)}</p>`;
    },
  };
}
