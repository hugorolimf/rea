import { esc } from "../dom.js";
import { compItems } from "../comp-items.js";
import {
  SORTS,
  STYLES,
  disputeLevel,
  filterComps,
  itemUpgrade,
  mergeComps,
  scoreOf,
  sortComps,
} from "../comps.js";
import {
  getCatalog,
  glyph,
  itemName,
  itemPortrait,
  portrait,
} from "./glyphs.js";
import { nameChip, richText } from "./rich-text.js";

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
        sort: SORTS.some((s) => s.key === p.sort) ? p.sort : "score",
      };
  } catch {}
  return { query: "", style: "", sort: "score" };
}
function savePrefs({ style, sort }) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ style, sort }));
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
    .map((id) =>
      nameChip("champion", id, champions.get(id)?.name ?? id, { size: 24 }),
    )
    .join(" ");
  return `${rows ? `<ul class="comp-builds">${rows}</ul><p class="comp-build-note">A fonte publica só a melhor build de cada campeão; a variação vem inflada e o motor a usa com desconto.</p>` : '<p class="muted">Sem builds publicadas para esta comp.</p>'}${stars3 ? `<p class="comp-3star"><b>3★:</b> ${stars3}</p>` : ""}`;
}

const BANK_TEXT = {
  on: () => "equipado",
  ready: () => "pronto no banco",
  radiant: () => "radiante no banco",
  craft: () => "monta agora",
  half: (r) => `falta ${r.missing.map((id) => itemName(id)).join(" + ")}`,
  missing: (r) => (r.recipe.length ? "falta montar" : "não está no banco"),
};
const bankItem = (r, { unit, champions, trait = null }) => {
  const parts =
      r.recipe.length && ["craft", "half", "missing"].includes(r.state)
        ? `<span class="cb-recipe">${r.recipe.map((id) => `<span class="${r.state === "missing" || r.missing.includes(id) ? "miss" : "got"}">${itemPortrait({ id }, { size: 18 })}</span>`).join("")}</span>`
        : "",
    text = r.state === "unread" ? "" : BANK_TEXT[r.state](r);
  return `<li${trait ? ` class="cb-emblem" data-trait="${esc(trait)}"` : ""} data-state="${r.state}" title="${esc(`${itemName(r.want ?? r.id)}${text ? " · " + text : ""}`)}">${unit ? portrait(unit, champions.get(unit)?.name ?? unit, { size: 20 }) : ""}${itemPortrait({ id: r.want ?? r.id }, { size: 30 })}${parts}${text ? `<small>${richText(text, { size: 16 })}</small>` : ""}${trait ? `<em>${esc(trait)}</em>` : ""}</li>`;
};

/**
 * Itens do banco que combinam com o carry da comp (ver comp-items.js): a build publicada do carry com o que está pronto,
 * equipado, monta agora ou falta; emblemas que dão ao carry uma sinergia da comp; peças com algo do banco; e o que ficou de fora.
 * `r` é o resultado de `compItems`; sem leitura do banco, mostra só a build do carry.
 */
export function compItemsBlock(r, champions = getCatalog().champions) {
  const [carry, ...others] = r.units;
  if (!carry) return "";
  const rows = (u) =>
      u.rows.map((row) =>
        bankItem(r.read ? row : { ...row, state: "unread" }, {
          unit: null,
          champions,
        }),
      ),
    emblems = r.emblems.map((e) =>
      bankItem(e, { unit: null, champions, trait: e.trait }),
    ),
    more = others.filter(
      (u) => r.read && u.rows.some((x) => x.state !== "missing"),
    ),
    unused = r.unused.length
      ? `<span class="cb-unused" title="${esc(r.unused.map((u) => `${itemName(u.id)}: ${u.reason}`).join("\n"))}">${r.unused.length} do banco sem uso nesta comp</span>`
      : "",
    left = r.excluded.length
      ? `<span class="cb-unused" title="${esc(r.excluded.map(itemName).join(", "))}">${r.excluded.length} consumível${r.excluded.length === 1 ? "" : "is"} fora da lista (não é para montar)</span>`
      : "";
  return `<div class="comp-bank" data-read="${r.read}">
    <p class="cb-head">${glyph("items")}<span>${r.read ? "Seus itens no carry" : "Itens ideais do carry (banco não lido)"}</span>${portrait(carry.unit, champions.get(carry.unit)?.name ?? carry.unit, { size: 22 })}</p>
    <ul class="cb-list" aria-label="Itens do carry">${rows(carry).join("")}${emblems.join("")}</ul>
    ${more.map((u) => `<ul class="cb-list cb-other" aria-label="Itens de ${esc(champions.get(u.unit)?.name ?? u.unit)}">${u.rows.map((row) => bankItem(row, { unit: u.unit, champions })).join("")}</ul>`).join("")}
    ${unused || left ? `<p class="cb-foot">${unused}${left}</p>` : ""}
  </div>`;
}

function card(c, { goalId, open, items }) {
  const pinned = c.id === goalId,
    f = c.fit,
    dispute = disputeLevel(f?.dispute),
    up = itemUpgrade(c),
    sc = scoreOf(c);
  const { champions } = getCatalog();
  // Itens do banco que combinam com o carry: sempre que a comp tem build publicada do carry, com ou sem leitura.
  const bank = compItemsBlock(compItems(c, items), champions);
  // Com seus itens: nova média esperada e de onde vem (campeão e itens da build que você tem ou monta).
  const edge = up
    ? `<p class="comp-edge">${glyph("items")}<span>Com seus itens: média <b>${num(up.avg)}</b> (${signed(-up.gain)})</span><small>${f.itemGains
        .map(
          (g) =>
            `${nameChip("champion", g.unit, champions.get(g.unit)?.name ?? g.unit, { size: 18 })}: ${[
              ...g.ready.map((i) =>
                nameChip("item", i, itemName(i), { size: 18 }),
              ),
              ...g.craft.map(
                (i) =>
                  `${nameChip("item", i, itemName(i), { size: 18 })} (montar)`,
              ),
            ].join(" ")}`,
        )
        .join(" · ")}</small></p>`
    : "";
  const fit = f
    ? [
        sc?.chance != null
          ? `<span class="chance" title="Chance de achar as peças principais que faltam com o seu nível${sc.level ? " " + sc.level : ""} e as lojas ao alcance${sc.chancePlan != null ? "; no nível alvo: " + sc.chancePlan + "%" : ""}">chance de montar <b>${sc.chance}%</b></span>`
          : "",
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
      ${sc ? `<span class="score" data-band="${sc.band}" title="Score 0-100 para a sua partida: itens que você tem, o que já tem em campo (com a chance de subir de estrela), força da comp, chance de montar no seu nível${sc.level ? " " + sc.level : ""}, loja e disputa. Disputa alta reduz o score.">${sc.score}</span>` : '<span class="score" data-band="none" title="O score aparece com uma leitura do tabuleiro">—</span>'}
      <h3>${richText(c.title, { size: 22 })}</h3>
      <span class="chip">${esc(c.style.label)}</span>
      ${c.match ? `<span class="chip" title="Sinergia ativa nesta comp">${esc(c.match.name)} ×${c.match.count}</span>` : ""}
      ${sc?.best ? '<span class="chip chip-best" title="Maior score para você agora">Melhor comp</span>' : f?.suggested ? '<span class="chip chip-go" title="Entre as 3 sugeridas para esta partida">Sugerida</span>' : ""}
      ${pinned ? `<span class="chip chip-amber">${glyph("flag")} Seguindo</span>` : ""}
    </header>
    <ul class="comp-units">${units(c)}</ul>
    <p class="comp-stats"><span>média <b>${c.avg.toFixed(2)}</b></span><span>top 4 <b>${pct(c.top4)}</b></span><span>1º <b>${pct(c.win)}</b></span><span>${thousands(c.games)} partidas</span></p>
    <p class="comp-fit">${fit}</p>
    ${bank}
    ${edge}
    <div class="comp-actions">
      ${pinned ? '<button type="button" class="btn" data-release>Liberar</button>' : `<button type="button" class="btn btn-go" data-pick="${esc(c.id)}">Seguir esta comp</button>`}
      <details class="comp-more" data-more="${esc(c.id)}"${open ? " open" : ""}><summary>Builds e 3★</summary>${details(c)}</details>
    </div>
  </li>`;
}

/**
 * Tela de seleção de comp. `onPick(id)` fixa uma comp; `onRelease()` volta às sugestões automáticas.
 * `update({comps, ranking, autoTitle, ownedIds, bank, equipped, goalId, source})` redesenha só quando algo visível mudou;
 * `bank` é o banco de itens lido da tela (null sem leitura) e `equipped`, {campeão: itens} do seu tabuleiro.
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
    const { champions, traits, items } = getCatalog(),
      itemsCtx = {
        bank: data.bank ?? null,
        equipped: data.equipped ?? {},
        items: items ?? new Map(),
        champions,
        breakpoints: traits,
      },
      all = mergeComps(data.comps, data.ranking).map((c) => ({
        ...c,
        ownedIds: data.ownedIds,
      })),
      list = sortComps(filterComps(all, prefs, champions, traits), prefs.sort),
      goal = all.find((c) => c.id === data.goalId) ?? null,
      // Título do plano que o Ao vivo mostra (vem de main.js), não deduzido do ranking.
      auto = data.autoTitle ?? null;
    const key = JSON.stringify([
      list.map((c) => [c.id, c.fit]),
      data.goalId,
      auto,
      data.swapCount,
      data.ownedIds,
      data.bank,
      data.equipped,
      data.source,
      data.lobby,
    ]);
    if (key === drawn) return;
    drawn = key;
    $("comps-source").innerHTML = data.source
      ? `<span class="chip" title="Estatísticas de partidas publicadas">${esc(data.source)}</span>`
      : "";
    $("comps-goal").innerHTML = goal
      ? `${glyph("flag")}<p>Seguindo <b>${richText(goal.title)}</b>${data.swapCount ? ` com ${data.swapCount} substituição(ões)` : ""}. O Ao vivo, as trocas e a economia usam esta comp ${data.lobby ? "até você liberar ou a próxima partida começar (a escolha do lobby não passa para a partida)" : "até você liberar ou a partida acabar"}.</p><button type="button" class="btn" data-release>Liberar</button>`
      : `${glyph("roll")}<p>Automático: o Ao vivo segue a melhor sugestão da leitura${auto ? ` (agora <b>${richText(auto)}</b>)` : ""}, que pode mudar a cada leitura. Fixe uma comp para manter a direção.</p>`;
    $("comps-goal").dataset.pinned = goal ? "1" : "0";
    $("comps-count").textContent =
      `${list.length} de ${all.length} comps${data.ranking.length ? "" : " · encaixe aparece com uma leitura do tabuleiro"}`;
    $("comps-grid").innerHTML = list.length
      ? list
          .map((c) =>
            card(c, {
              goalId: data.goalId,
              open: openIds.has(c.id),
              items: itemsCtx,
            }),
          )
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
