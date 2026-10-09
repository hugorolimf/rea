import { esc } from "../dom.js";
import {
  SORTS,
  STYLES,
  TIERS,
  disputeLevel,
  filterComps,
  itemUpgrade,
  mergeComps,
  sortComps,
} from "../comps.js";
import {
  getCatalog,
  glyph,
  itemName,
  itemPortrait,
  portrait,
} from "./glyphs.js";

const PREFS = "tft-compass-comps-filters";
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : "—");
const thousands = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")} mil` : String(n);

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "null");
    if (p && typeof p === "object")
      return {
        query: "",
        style: STYLES.some((s) => s.key === p.style) ? p.style : "",
        tiers: Array.isArray(p.tiers)
          ? p.tiers.filter((t) => TIERS.includes(t))
          : [],
        sort: SORTS.some((s) => s.key === p.sort) ? p.sort : "fit",
      };
  } catch {}
  return { query: "", style: "", tiers: [], sort: "fit" };
}
function savePrefs({ style, tiers, sort }) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ style, tiers, sort }));
  } catch {}
}

function units(c) {
  const { champions } = getCatalog(),
    owned = new Set(c.ownedIds ?? []);
  return [...c.units]
    .sort(
      (a, b) =>
        (champions.get(b)?.cost ?? 0) - (champions.get(a)?.cost ?? 0) ||
        (b === c.carry) - (a === c.carry),
    )
    .map((id) => {
      const ch = champions.get(id),
        carry = id === c.carry,
        mine = owned.has(id);
      return `<li class="${mine ? "is-mine" : ""}${carry ? " is-carry" : ""}" style="--ring-c:var(--cost-${ch?.cost ?? 1})">${portrait(id, ch?.name ?? id, { size: 38, badge: carry ? `<i class="badge-carry" title="Carry">${glyph("crown")}</i>` : mine ? `<i class="badge-mine" title="Já em campo">${glyph("check")}</i>` : "" })}<span>${esc(ch?.name ?? id)}</span></li>`;
    })
    .join("");
}

const num = (v, d = 2) => v.toFixed(d).replace(".", ",");
const signed = (v) => `${v > 0 ? "+" : "−"}${num(Math.abs(v))}`;
// Itens que o motor encontrou com você (prontos ou montáveis) para as builds desta comp.
const heldItems = (c) =>
  new Set((c.fit?.itemGains ?? []).flatMap((g) => [...g.ready, ...g.craft]));

function details(c) {
  const held = heldItems(c),
    { champions } = getCatalog(),
    builds = Object.entries(c.builds ?? {})
      .filter(([id]) => c.units.includes(id))
      .sort(([a], [b]) => (b === c.carry) - (a === c.carry));
  const rows = builds
    .map(([id, items]) => {
      const ch = champions.get(id),
        st = c.buildStats?.[id];
      return `<li>${portrait(id, ch?.name ?? id, { size: 28 })}<b>${esc(ch?.name ?? id)}</b><span class="comp-items">${items.map((i) => `<span class="comp-item${held.has(i) ? " is-held" : ""}" title="${esc(itemName(i))}${held.has(i) ? " · você tem ou monta" : ""}">${itemPortrait({ id: i }, { size: 26 })}</span>`).join("")}</span>${st && Number.isFinite(st.delta) ? `<small class="comp-build-stat" title="Variação publicada da colocação com esta build, contra outras builds de 3 itens neste campeão na comp">${signed(st.delta)} · ${thousands(st.n)} partidas</small>` : ""}</li>`;
    })
    .join("");
  const stars3 = (c.stars3 ?? [])
    .map((id) => esc(champions.get(id)?.name ?? id))
    .join(", ");
  return `${rows ? `<ul class="comp-builds">${rows}</ul><p class="comp-build-note">A fonte publica só a melhor build de cada campeão; a variação vem inflada e o motor a usa com desconto.</p>` : '<p class="muted">Sem builds publicadas para esta comp.</p>'}${stars3 ? `<p class="comp-3star"><b>3★:</b> ${stars3}</p>` : ""}`;
}

function card(c, { goalId, open }) {
  const pinned = c.id === goalId,
    f = c.fit,
    dispute = disputeLevel(f?.dispute),
    up = itemUpgrade(c);
  const { champions } = getCatalog();
  // Com seus itens: nova média esperada e de onde vem (campeão e itens da build que você tem ou monta).
  const edge = up
    ? `<p class="comp-edge">${glyph("items")}<span>Com seus itens: média <b>${num(up.avg)}</b> (${signed(-up.gain)})${up.tierUp ? ` · tier <span class="tier tier-${esc(up.to)}">${esc(up.to)}</span>` : ""}</span><small>${f.itemGains
        .map(
          (g) =>
            `${esc(champions.get(g.unit)?.name ?? g.unit)}: ${[
              ...g.ready.map((i) => esc(itemName(i))),
              ...g.craft.map((i) => `${esc(itemName(i))} (montar)`),
            ].join(", ")}`,
        )
        .join(" · ")}</small></p>`
    : "";
  const fit = f
    ? [
        `<span><b>${f.owned}/${f.size}</b> já em campo</span>`,
        f.carryWanted
          ? `<span>itens do carry <b>${Math.floor(f.carryItems)}/${f.carryWanted}</b></span>`
          : "",
        dispute
          ? `<span class="dispute" data-level="${dispute}">disputa ${dispute}</span>`
          : "",
      ]
        .filter(Boolean)
        .join("")
    : '<span class="muted">Encaixe indisponível nesta leitura</span>';
  return `<li class="comp" data-id="${esc(c.id)}"${pinned ? ' data-pinned=""' : ""}>
    <header class="comp-head">
      <span class="tier tier-${esc(c.tier)}" title="Tier ${esc(c.tier)} (faixa deste helper sobre a colocação média)">${esc(c.tier)}</span>${up?.tierUp ? `<span class="tier-up" title="Tier com os seus itens">→ <span class="tier tier-${esc(up.to)}">${esc(up.to)}</span></span>` : ""}
      <h3>${esc(c.title)}</h3>
      <span class="chip">${esc(c.style.label)}</span>
      ${f?.suggested ? '<span class="chip chip-go" title="Entre as 3 sugeridas para esta partida">Sugerida</span>' : ""}
      ${pinned ? `<span class="chip chip-amber">${glyph("flag")} Seguindo</span>` : ""}
    </header>
    <ul class="comp-units">${units(c)}</ul>
    <p class="comp-stats"><span>média <b>${c.avg.toFixed(2)}</b></span><span>top 4 <b>${pct(c.top4)}</b></span><span>1º <b>${pct(c.win)}</b></span><span>${thousands(c.games)} partidas</span></p>
    <p class="comp-fit">${fit}</p>
    ${edge}
    <div class="comp-actions">
      ${pinned ? '<button type="button" class="btn" data-release>Liberar</button>' : `<button type="button" class="btn btn-go" data-pick="${esc(c.id)}">Seguir esta comp</button>`}
      <details class="comp-more" data-more="${esc(c.id)}"${open ? " open" : ""}><summary>Builds e 3★</summary>${details(c)}</details>
    </div>
  </li>`;
}

/**
 * Tela de seleção de comp. `onPick(id)` fixa uma comp; `onRelease()` volta às sugestões automáticas.
 * `update({comps, ranking, ownedIds, goalId, source})` redesenha só quando algo visível mudou.
 */
export function mountComps(root, { onPick, onRelease }) {
  const $ = (id) => root.querySelector(`#${id}`),
    prefs = loadPrefs(),
    openIds = new Set();
  let data = null,
    drawn = "";

  $("comps-style").innerHTML = STYLES.map(
    (s) =>
      `<button type="button" data-style="${s.key}" aria-pressed="${s.key === prefs.style}">${s.label}</button>`,
  ).join("");
  $("comps-tier").innerHTML = TIERS.map(
    (t) =>
      `<button type="button" data-tier="${t}" aria-pressed="${prefs.tiers.includes(t)}"><span class="tier tier-${t}">${t}</span></button>`,
  ).join("");
  $("comps-sort").innerHTML = SORTS.map(
    (s) =>
      `<option value="${s.key}"${s.key === prefs.sort ? " selected" : ""}>${s.label}</option>`,
  ).join("");

  const changed = () => {
    savePrefs(prefs);
    drawn = "";
    draw();
  };
  let typing = 0;
  $("comps-q").addEventListener("input", (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      prefs.query = e.target.value;
      changed();
    }, 120);
  });
  $("comps-style").addEventListener("click", (e) => {
    const b = e.target.closest("[data-style]");
    if (!b) return;
    prefs.style = b.dataset.style;
    for (const x of $("comps-style").children)
      x.setAttribute("aria-pressed", String(x === b));
    changed();
  });
  $("comps-tier").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tier]");
    if (!b) return;
    const t = b.dataset.tier,
      on = !prefs.tiers.includes(t);
    prefs.tiers = on ? [...prefs.tiers, t] : prefs.tiers.filter((x) => x !== t);
    b.setAttribute("aria-pressed", String(on));
    changed();
  });
  $("comps-sort").addEventListener("change", (e) => {
    prefs.sort = e.target.value;
    changed();
  });
  root.addEventListener(
    "toggle",
    (e) => {
      const id = e.target.dataset?.more;
      if (id) e.target.open ? openIds.add(id) : openIds.delete(id);
    },
    true,
  );
  root.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) onPick(pick.dataset.pick);
    if (e.target.closest("[data-release]")) onRelease();
  });

  function draw() {
    if (!data) return;
    const { champions } = getCatalog(),
      all = mergeComps(data.comps, data.ranking).map((c) => ({
        ...c,
        ownedIds: data.ownedIds,
      })),
      list = sortComps(filterComps(all, prefs, champions), prefs.sort),
      goal = all.find((c) => c.id === data.goalId) ?? null,
      auto = sortComps(all.filter((c) => c.fit?.suggested))[0] ?? null;
    const key = JSON.stringify([
      list.map((c) => [c.id, c.fit]),
      data.goalId,
      data.swapCount,
      data.ownedIds,
      data.source,
    ]);
    if (key === drawn) return;
    drawn = key;
    $("comps-source").innerHTML = data.source
      ? `<span class="chip" title="Estatísticas de partidas publicadas">${esc(data.source)}</span>`
      : "";
    $("comps-goal").innerHTML = goal
      ? `${glyph("flag")}<p>Seguindo <b>${esc(goal.title)}</b>${data.swapCount ? ` com ${data.swapCount} substituição(ões)` : ""}. O Ao vivo, as trocas e a economia usam esta comp até você liberar ou a partida acabar.</p><button type="button" class="btn" data-release>Liberar</button>`
      : `${glyph("roll")}<p>Automático: o Ao vivo segue a melhor sugestão da leitura${auto ? ` (agora <b>${esc(auto.title)}</b>)` : ""}, que pode mudar a cada leitura. Fixe uma comp para manter a direção.</p>`;
    $("comps-goal").dataset.pinned = goal ? "1" : "0";
    $("comps-count").textContent =
      `${list.length} de ${all.length} comps${data.ranking.length ? "" : " · encaixe aparece com uma leitura do tabuleiro"}`;
    $("comps-grid").innerHTML = list.length
      ? list
          .map((c) => card(c, { goalId: data.goalId, open: openIds.has(c.id) }))
          .join("")
      : '<li class="comps-empty">Nenhuma comp com esses filtros.</li>';
  }

  return {
    update(next) {
      data = next;
      draw();
    },
    error(message) {
      $("comps-grid").innerHTML =
        `<li class="comps-empty">${esc(message)}</li>`;
    },
  };
}
