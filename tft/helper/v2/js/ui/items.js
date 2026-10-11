import { esc, isReducedMotion } from "../dom.js";
import { metaNote } from "../meta-freshness.js";
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
import { richText } from "./rich-text.js";

const PREFS = "tft-compass-items";
const TABS = [
  {
    key: "tier",
    label: "Tier",
    note: "Colocação média de cada item em partidas publicadas. O tier (S a D) vale dentro de cada categoria, com a média ajustada pelo tamanho da amostra; quanto menor a média, melhor.",
  },
  {
    key: "recipes",
    label: "Receitas",
    note: "Cada célula é o item montado com os dois componentes; o selo é o tier entre os itens completos.",
  },
  { key: "attrs", label: "Atributos", note: "" },
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
  const fresh = {
    tab: "tier",
    kind: "completed",
    attrs: [],
    query: "",
    sort: null,
    selected: null,
  };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "null");
    if (p && typeof p === "object")
      return {
        ...fresh,
        tab: TABS.some((t) => t.key === p.tab) ? p.tab : "tier",
        kind: typeof p.kind === "string" ? p.kind : "completed",
      };
  } catch {}
  return fresh;
}
function savePrefs({ tab, kind }) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ tab, kind }));
  } catch {}
}

/** Ícone quadrado do item (retrato `.pt-item`); sem imagem, as iniciais. */
const icon = (i, size = 44) =>
  `<span class="pt pt-item" style="--s:${size}px" data-i="${esc((i?.name ?? "?").slice(0, 2))}">${i?.icon ? `<img src="${esc(i.icon)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">` : ""}</span>`;
/** Pontos coloridos dos atributos do item (um por atributo); o texto dos atributos está no detalhe. */
const dots = (i) =>
  `<span class="it-dots" aria-hidden="true">${statList(i)
    .map((s) => `<i style="${attrStyle(s)}"></i>`)
    .join("")}</span>`;
/** Selo do tier: a letra vale por si e o leitor de tela ouve "Tier S". */
const tierBadge = (t, cls = "") =>
  t
    ? `<span class="tier tier-${t} ${cls}"><span class="sr">Tier </span>${t}</span>`
    : "";
/** Estado vazio/erro padrão (`.state`): o que houve e o que fazer. */
const stateHtml = ({ tone = "", name, title, text, action = "" }) =>
  `<section class="state"${tone ? ` data-tone="${tone}" role="alert"` : ""}>${glyph(name)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</section>`;
const skeleton = (n, cls) =>
  `<div class="items-skel ${cls}" aria-hidden="true">${'<div class="skeleton-line"></div>'.repeat(n)}</div>`;

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
      <div class="tabs" role="tablist" aria-label="Visão dos itens" data-ref="tabs">${TABS.map((t) => `<button type="button" role="tab" id="items-tab-${t.key}" aria-controls="items-panel" data-tab="${t.key}">${t.label}</button>`).join("")}</div>
      <input type="search" data-ref="q" placeholder="Item, componente ou sinergia" aria-label="Buscar item" autocomplete="off">
    </div>
    <div class="items-filters">
      <div class="seg" role="group" aria-label="Categoria" data-ref="kinds"></div>
      <div class="attr-chips" role="group" aria-label="Filtrar por atributo" data-ref="attrs">${ATTRS.map((a) => `<button type="button" class="chip attr-chip" data-attr="${a.key}" style="${attrStyle(a)}" aria-pressed="false" title="${esc(a.label)}"><i></i>${esc(a.short)}</button>`).join("")}</div>
      <button type="button" class="btn btn-sm btn-quiet" data-clear hidden>${glyph("x")}Limpar filtros</button>
    </div>
    <p class="items-note" data-ref="note"></p>
    <p class="sr" role="status" data-ref="count"></p>
    <div class="items-body">
      <div class="items-main" id="items-panel" role="tabpanel" data-ref="main" aria-busy="true">${skeleton(4, "items-skel-main")}</div>
      <aside class="card item-detail" data-ref="detail" aria-label="Detalhe do item" tabindex="-1">${skeleton(3, "items-skel-detail")}</aside>
    </div>`;
  const ref = (k) => root.querySelector(`[data-ref="${k}"]`);
  let data = null;

  /** Assinatura do HTML: só reescreve o nó (e perde o foco) quando o conteúdo mudou. */
  const sigs = new WeakMap();
  const setHtml = (el, html) => {
    if (sigs.get(el) === html) return;
    sigs.set(el, html);
    el.innerHTML = html;
  };
  /** Reescreve áreas mantendo o foco no mesmo botão (clicar numa categoria ou item não pode jogar o foco fora). */
  function keepFocus(fn) {
    const a = document.activeElement,
      box = a && root.contains(a) ? a.closest("[data-ref]") : null,
      key = box
        ? ["item", "kind", "sort"].find((k) => a.dataset[k] != null)
        : null;
    fn();
    if (!box || !key) return;
    const area = ref(box.dataset.ref),
      target = area?.querySelector(
        `[data-${key}="${CSS.escape(a.dataset[key])}"]`,
      );
    (target ?? (box.dataset.ref === "detail" ? area : null))?.focus({
      preventScroll: true,
    });
  }

  const changed = () => {
    savePrefs(prefs);
    draw();
  };
  const select = (id) => {
    prefs.selected = id;
    draw();
    // Tela estreita: o detalhe fica abaixo da lista; leva a vista até ele quando saiu do alcance.
    const d = ref("detail");
    if (d.getBoundingClientRect().top > innerHeight * 0.85)
      d.scrollIntoView({
        block: "start",
        behavior: isReducedMotion() ? "auto" : "smooth",
      });
  };

  ref("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    prefs.tab = b.dataset.tab;
    changed();
  });
  // Abas: setas, Home e End trocam e levam o foco; só a aba ativa entra na ordem de Tab.
  ref("tabs").addEventListener("keydown", (e) => {
    const at = TABS.findIndex((t) => t.key === prefs.tab),
      to =
        e.key === "ArrowRight"
          ? (at + 1) % TABS.length
          : e.key === "ArrowLeft"
            ? (at + TABS.length - 1) % TABS.length
            : e.key === "Home"
              ? 0
              : e.key === "End"
                ? TABS.length - 1
                : -1;
    if (to < 0) return;
    e.preventDefault();
    prefs.tab = TABS[to].key;
    changed();
    ref("tabs").children[to].focus();
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
    if (e.target.closest("[data-retry]"))
      return document.dispatchEvent(
        new CustomEvent("tft:retry", { detail: { view: "items" } }),
      );
    if (e.target.closest("[data-clear]")) {
      prefs.attrs = [];
      prefs.query = "";
      ref("q").value = "";
      return draw();
    }
    if (e.target.closest("[data-top]"))
      return root
        .querySelector(".items-bar")
        .scrollIntoView({ block: "start" });
    const sort = e.target.closest("[data-sort]");
    if (sort) {
      prefs.sort = prefs.sort === sort.dataset.sort ? null : sort.dataset.sort;
      return draw();
    }
    const pick = e.target.closest("[data-item], [data-pick]");
    if (pick) select(pick.dataset.item ?? pick.dataset.pick);
  });

  /* ---------- Visões ---------- */

  function tierView(list, hit) {
    return `<ol class="tier-board">${tierRows(list)
      .map(
        (row) => `<li class="tier-row" data-tier="${row.tier ?? "none"}">
          <span class="tier-label" aria-hidden="true">${row.tier ?? "—"}</span>
          <div class="tier-items" role="group" aria-label="${row.tier ? `Tier ${row.tier}` : "Sem tier"}: ${row.items.length} ${row.items.length === 1 ? "item" : "itens"}">${row.items.length ? row.items.map((i) => tile(i, hit)).join("") : '<span class="tier-empty">nenhum</span>'}</div>
        </li>`,
      )
      .join("")}</ol>`;
  }
  const tile = (i, hit) =>
    `<button type="button" class="it-tile" data-item="${esc(i.id)}"${i.id === prefs.selected ? ' aria-current="true"' : ""}${hit.has(i.id) ? "" : " data-dim"} aria-label="${esc(i.name)}${i.perf ? `, média ${num(i.perf.post)}` : ""}" title="${esc(i.name)}${i.perf ? ` · média ${num(i.perf.post)}` : ""}">${icon(i)}<b>${i.perf ? num(i.perf.post) : "—"}</b>${dots(i)}</button>`;

  function recipeView(all, hit) {
    const g = recipeGrid(all),
      head = (c) =>
        `<th scope="col"><button type="button" class="rc-comp" data-item="${esc(c.id)}" aria-label="${esc(c.name)}" title="${esc(c.name)}">${icon(c, 30)}</button></th>`;
    return `<div class="tbl-wrap recipe-wrap"><table class="recipe">
      <caption class="sr">Receitas de itens completos: cada linha e cada coluna é um componente.</caption>
      <thead><tr><th scope="col"><span class="sr">Componente</span></th>${g.components.map(head).join("")}</tr></thead>
      <tbody>${g.cells
        .map(
          (row, r) =>
            `<tr><th scope="row"><button type="button" class="rc-comp" data-item="${esc(g.components[r].id)}" aria-label="${esc(g.components[r].name)}" title="${esc(g.components[r].name)}">${icon(g.components[r], 30)}</button></th>${row
              .map((i, c) =>
                i
                  ? `<td${r === c ? ' class="diag"' : ""}><button type="button" class="rc-cell" data-item="${esc(i.id)}" data-tier="${i.perf?.tier ?? ""}"${i.id === prefs.selected ? ' aria-current="true"' : ""}${hit.has(i.id) ? "" : " data-dim"} aria-label="${esc(i.name)}${i.perf ? `, tier ${i.perf.tier}, média ${num(i.perf.post)}` : ""}" title="${esc(i.name)}${i.perf ? ` · tier ${i.perf.tier} · média ${num(i.perf.post)}` : ""}">${icon(i, 34)}${i.perf ? `<em aria-hidden="true">${i.perf.tier}</em>` : ""}</button></td>`
                  : `<td></td>`,
              )
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`;
  }

  function attrView(rows) {
    const m = attrMatrix(rows, prefs.sort);
    if (!m.columns.length)
      return stateHtml({
        name: "inbox",
        title: "Sem atributos de status",
        text: "Os itens desta categoria não dão atributos de status.",
        action: "<p>Escolha outra categoria acima para ver a matriz.</p>",
      });
    return `<div class="tbl-wrap"><table class="tbl attr-table">
      <caption>Atributos de status por item. A barra é proporcional ao maior valor da coluna; use o cabeçalho para ordenar.</caption>
      <thead><tr><th scope="col">Item</th>${m.columns
        .map(
          (c) =>
            `<th scope="col" data-num${prefs.sort === c.key ? ' aria-sort="descending"' : ""}><button type="button" data-sort="${c.key}" style="${attrStyle(c)}" aria-pressed="${prefs.sort === c.key}" title="Ordenar por ${esc(c.label)}"><i></i>${esc(c.col)}</button></th>`,
        )
        .join("")}</tr></thead>
      <tbody>${m.rows
        .map(
          (i) =>
            `<tr data-pick="${esc(i.id)}"${i.id === prefs.selected ? ' data-selected="1"' : ""}><th scope="row"><button type="button" class="row-pick" data-item="${esc(i.id)}"${i.id === prefs.selected ? ' aria-current="true"' : ""}>${icon(i, 26)}<span>${esc(i.name)}</span>${tierBadge(i.perf?.tier)}</button></th>${m.columns
              .map((c) => {
                const v = i.stats?.[c.key];
                return typeof v === "number"
                  ? `<td data-num style="${attrStyle(c)};--w:${Math.max(0.08, v / c.max)}"><span class="bar" aria-hidden="true"></span><b>${num(v, v % 1 ? 1 : 0)}${c.unit}</b></td>`
                  : "<td></td>";
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></div>`;
  }

  /* ---------- Detalhe ---------- */

  function detail(i, all) {
    if (!i)
      return stateHtml({
        name: "items",
        title: "Escolha um item",
        text: "Selecione um item na lista para ver desempenho, atributos, receita e efeito.",
      });
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
        ? `<section class="dt-recipe"><h4>Receita</h4><p>${i.from.map((c) => `<button type="button" data-item="${esc(c)}" aria-label="${esc(byId.get(c)?.name ?? c)}" title="${esc(byId.get(c)?.name ?? c)}">${icon(byId.get(c) ?? { name: c }, 32)}</button>`).join('<span class="op" aria-hidden="true">+</span>')}<span class="op" aria-hidden="true">=</span>${icon(i, 32)}</p></section>`
        : "";
    const builds =
      i.kind === "component"
        ? all
            .filter((x) => x.kind === "completed" && x.from?.includes(i.id))
            .sort((a, b) => (a.perf?.post ?? 9) - (b.perf?.post ?? 9))
        : [];
    const makes = builds.length
      ? `<section class="dt-makes"><h4>Monta</h4><p>${builds.map((x) => `<button type="button" data-item="${esc(x.id)}" aria-label="${esc(x.name)}" title="${esc(x.name)}${x.perf ? ` · tier ${x.perf.tier}` : ""}">${icon(x, 32)}${tierBadge(x.perf?.tier, "mini")}</button>`).join("")}</p></section>`
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
      <button type="button" class="btn btn-sm btn-quiet dt-back" data-top>${glyph("up")}Voltar à lista</button>
      ${perf}
      ${stats.length ? `<section class="dt-stats"><h4>Atributos</h4><ul>${stats.map((s) => `<li style="${attrStyle(s)}"><i></i><b>${s.text}</b><span>${esc(s.label)}</span></li>`).join("")}</ul></section>` : ""}
      ${recipe}${makes}
      ${
        i.desc
          ? `<section class="dt-desc"><h4>Efeito</h4>${i.desc
              .split("\n")
              .map((l) => `<p>${richText(l)}</p>`)
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
    const tab = TABS.find((t) => t.key === prefs.tab) ?? TABS[0];
    for (const b of ref("tabs").children) {
      const on = b.dataset.tab === prefs.tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    ref("main").setAttribute("aria-labelledby", `items-tab-${tab.key}`);
    ref("main").removeAttribute("aria-busy");
    ref("note").textContent = tab.note;
    // Categorias por visão: o tier só existe para as categorias com tier; receitas usam a grade fixa.
    const kinds = kindCounts(all, data.kinds).filter((k) =>
      prefs.tab === "tier" ? TIER_KINDS.includes(k.key) : k.key !== "other",
    );
    if (!kinds.some((k) => k.key === prefs.kind))
      prefs.kind = kinds[0]?.key ?? "completed";
    ref("kinds").hidden = prefs.tab === "recipes";
    for (const b of ref("attrs").children)
      b.setAttribute(
        "aria-pressed",
        String(prefs.attrs.includes(b.dataset.attr)),
      );
    const filtering = prefs.attrs.length > 0 || prefs.query.trim() !== "";
    root.querySelector("[data-clear]").hidden = !filtering;
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
    }
    const body = !all.length
      ? stateHtml({
          name: "inbox",
          title: "Nenhum item no catálogo",
          text: "O servidor respondeu sem itens.",
          action:
            '<p>Atualize o catálogo do helper e tente de novo.</p><button type="button" class="btn btn-go" data-retry>' +
            glyph("roll") +
            "Tentar de novo</button>",
        })
      : filtering && hit.size === 0
        ? stateHtml({
            name: "inbox",
            title: "Nenhum item corresponde",
            text: "Nenhum item desta visão tem o texto e os atributos escolhidos ao mesmo tempo.",
            action:
              '<p>Tire um atributo ou apague parte da busca.</p><button type="button" class="btn btn-go" data-clear>Limpar filtros</button>',
          })
        : prefs.tab === "tier"
          ? tierView(scope, hit)
          : prefs.tab === "recipes"
            ? recipeView(all, hit)
            : attrView(scope.filter((i) => hit.has(i.id)));
    ref("count").textContent = filtering
      ? `${hit.size} ${hit.size === 1 ? "item corresponde" : "itens correspondem"} aos filtros`
      : "";
    keepFocus(() => {
      setHtml(
        ref("kinds"),
        kinds
          .map(
            (k) =>
              `<button type="button" data-kind="${k.key}" aria-pressed="${k.key === prefs.kind}">${esc(k.label)} <small>${k.count}</small></button>`,
          )
          .join(""),
      );
      setHtml(ref("main"), body);
      setHtml(ref("detail"), detail(selected, all));
    });
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
      const note = metaNote(next.freshness, next.fetchedAt);
      setHtml(
        ref("source"),
        [
          next.source &&
            `<span class="chip">${esc(next.source)}${next.games ? ` · ${esc(thousands(next.games))} partidas` : ""}</span>`,
          date && `<span class="chip">atualizada ${esc(date)}</span>`,
          note &&
            `<span class="chip"${note.tone ? ` data-tone="${note.tone}"` : ""}>${esc(note.text)}</span>`,
        ]
          .filter(Boolean)
          .join(""),
      );
      draw();
    },
    error(message) {
      ref("main").removeAttribute("aria-busy");
      setHtml(
        ref("main"),
        stateHtml({
          tone: "danger",
          name: "warn",
          title: "Não foi possível carregar os itens",
          text: message || "O servidor não respondeu.",
          action: `<p>Confira se o servidor do helper está rodando e tente de novo.</p><button type="button" class="btn btn-go" data-retry>${glyph("roll")}Tentar de novo</button>`,
        }),
      );
      setHtml(ref("detail"), "");
    },
  };
}
