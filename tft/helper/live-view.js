const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pct = (v) =>
  typeof v === "number" ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%` : "—";
const COST = {
  1: "#8995a6",
  2: "#68cba4",
  3: "#73a7ed",
  4: "#ba8cfa",
  5: "#f1c67d",
};
/** Flow arrow: `go` animates toward the target, `hold` is dashed and static. */
const arrow = (tone = "") =>
  `<svg class="flow ${tone}" viewBox="0 0 30 10" aria-hidden="true"><path class="l" d="M1 5h22"/><path class="h" d="M21 1.5 27 5l-6 3.5"/></svg>`;
/** Progress dots: filled count out of a total. */
const pips = (have, total, tone = "") =>
  `<span class="pips ${tone}" role="img" aria-label="${have} de ${total}">${Array.from({ length: total }, (_, i) => `<i${i < have ? ' class="on"' : ""}></i>`).join("")}</span>`;
/** The reference screen: icons, arrows and dots straight on the page; long explanations live in tooltips. */
export function createLiveHTML(plan, { icon }, context = {}) {
  const st = plan?.stage;
  if (!st)
    return '<p class="reference-empty">Aguardando a leitura do seu campo.</p>';
  const observed = context.currentPlan?.board ?? [],
    goal = new Set((plan.board ?? []).map((u) => u.id)),
    own = new Set(observed.map((u) => u.id));
  const canAct = context.metadata?.actionable === true && context.health > 0;
  const copies = new Map(),
    fieldKey = (id) => {
      const n = copies.get(id) ?? 0;
      copies.set(id, n + 1);
      return `field:${id}:${n}`;
    };
  const flip = (key) => (key ? ` data-flip="${esc(key)}"` : "");
  /** Champion as a vertical tile (`tile`) or an inline pill. `key` lets the card glide between reads. */
  const champion = (u, source = "current", o = {}) => {
    const {
      key = "",
      tile = false,
      badges = "",
      foot = "",
      title = "",
      tone = "",
      noStars = false,
    } = o;
    const clickable = (source === "current" ? own : goal).has(u.id),
      tag = clickable ? "button" : "span",
      ring =
        source === "current" ? (goal.has(u.id) ? "is-meta" : "is-temp") : "";
    const stars = noStars ? 0 : (u.stars ?? u.currentStars ?? 1),
      starText = stars ? "★".repeat(Math.min(stars, 4)) : "";
    const label = `${u.name}${stars ? ` ${stars}★` : ""}`;
    const attrs = `class="unit ${tile ? "unit-tile" : "unit-mini"} reference-champion ${ring} ${tone}"${flip(key)} title="${esc(title || label)}"${clickable ? ` type="button" data-live-inspect="${esc(u.id)}" data-live-source="${source}" aria-label="Ver ${esc(u.name)} no planejador"` : ""}`;
    return tile
      ? `<${tag} ${attrs}><span class="u-art">${icon(u.id, "")}${starText ? `<i class="u-stars">${starText}</i>` : ""}${badges}</span><span class="u-name">${esc(u.name)}</span>${foot}</${tag}>`
      : `<${tag} ${attrs}><span class="u-art">${icon(u.id, "")}</span><span class="u-name">${esc(u.name)}</span>${starText ? `<i class="u-stars">${starText}</i>` : ""}</${tag}>`;
  };
  const item = (i, { dashed = false, badge = "" } = {}) =>
    `<span class="it${dashed ? " is-dashed" : ""}" title="${esc(i.name ?? i.id)}">${icon(i.id, i.name, "item")}${badge}</span>`;
  const chip = (html, tone = "", key = "") =>
    `<div class="flow-chip ${tone}"${flip(key)}>${html}</div>`;
  const row = (id, label, list, count = list.length) =>
    list.length
      ? `<div class="reference-row" data-live-section="${id}"><h4 data-flip="h:${id}">${label}<b class="n">${count}</b></h4><div class="reference-content">${list.join("")}</div></div>`
      : "";
  const ok = (title, glyph = "✓") =>
    `<i class="ok" title="${esc(title)}">${glyph}</i>`;
  const wait = (title) => `<i class="wait" title="${esc(title)}">◷</i>`;
  const board = st.board ?? [],
    transitions = plan.transitions ?? [],
    side = (u) => (own.has(u.id) ? "current" : "goal");

  const equip = board
    .filter((u) => u.equipNow?.length)
    .map((u) =>
      chip(
        `${u.equipNow.map((i) => item(i)).join("")}${arrow("go")}${champion(u, side(u))}${own.has(u.id) ? ok("montável com seu banco") : wait("prepare a entrada em campo")}`,
        "is-ready",
        `equip:${u.id}`,
      ),
    );
  const bank = (st.bankItems ?? []).map((i, n) =>
    chip(
      `${item(i)}${arrow()}${i.to ? champion(i.to, side(i.to), { title: i.reason }) : `<span class="stash" title="${esc(i.reason)}">⤓</span>`}`,
      "",
      `bank:${i.id}:${n}`,
    ),
  );
  const moves = (plan.itemMoves ?? []).map((m) => {
    const now = m.now && canAct;
    return chip(
      `${champion(m.from)}${arrow(now ? "go" : "")}${(m.moves ?? []).map((x) => `<span class="mv">${item(x.item)}${arrow()}${champion(x.to, "goal")}</span>`).join("")}${now ? '<i class="ready-dot" title="agora"></i>' : wait("planejar")}`,
      now ? "is-ready" : "",
      `move:${m.from.id}`,
    );
  });
  const next = board
    .filter((u) => !u.equipNow?.length && u.slotsFree > 0 && u.nextItem)
    .map((u) => {
      const miss = u.nextItem.missing ?? [];
      return chip(
        `${champion(u, side(u))}${item(u.nextItem, { dashed: miss.length > 0, badge: miss.length ? `<i class="it-badge" title="falta ${esc(miss.join(" + "))}">−${miss.length}</i>` : "" })}`,
        "",
        `next:${u.id}`,
      );
    });
  /** Troca dentro do elenco: quem sai → seta animada → quem entra. Verde = agora, âmbar = segure. */
  const swapGroup = (t, outgoing, key) => {
    const need = t.requiredStars ? 3 ** (t.requiredStars - 1) : 0,
      have = Math.min(t.enterCopies ?? 0, need),
      kept = t.exit.items?.length ?? 0,
      tip = t.ready
        ? "Troca recomendada agora" + (kept ? ": preserve os itens antes" : "")
        : need
          ? `Segure até ${t.enter.name} ${t.requiredStars}★ (${t.enterCopies ?? 0} de ${need} cópias)`
          : "Não troque";
    const out = champion(outgoing, "current", {
      key,
      tile: true,
      tone: "unit-out",
      badges: kept
        ? `<em class="b-act warn" title="preserve os itens antes de trocar">⚠${kept}</em>`
        : "",
    });
    const into = champion({ ...t.enter, stars: t.enterStars }, "goal", {
      tile: true,
      noStars: !t.enterStars,
      tone: "unit-in",
      badges:
        !t.ready && !need
          ? '<em class="b-act no" title="não troque">✕</em>'
          : "",
      foot:
        t.ready || !need
          ? ""
          : `${pips(have, need, "amber")}<small>${have}/${need}</small>`,
    });
    return `<div class="swap-group ${t.ready ? "is-ready" : "is-hold"}" title="${esc(tip)}" data-flip="swap:${esc(t.enter.id)}:${esc(t.exit.id)}">${out}<span class="swap-link">${arrow(t.ready ? "go" : "hold")}<em>${t.ready ? "trocar" : "segure"}</em></span>${into}</div>`;
  };
  /** Vaga livre no elenco: espaço vazio → quem entra nela. */
  const slotGroup = (t) =>
    `<div class="swap-group is-free" title="${t.source === "reserve" ? "Já está na reserva" : "Entra ao subir de nível"}" data-flip="swap:${esc(t.enter.id)}:livre"><span class="unit unit-tile"><span class="u-art slot-art">＋</span><span class="u-name">vaga</span></span><span class="swap-link">${arrow("go")}</span>${champion({ ...t.enter, stars: t.enterStars }, "goal", { tile: true, noStars: !t.enterStars, tone: "unit-in", badges: t.source === "reserve" ? '<em class="b-act" title="já está na reserva">↻</em>' : "" })}</div>`;
  const carousel = (plan.carousel ?? []).map((c) => {
    const use = c.uses?.[0];
    return chip(
      `<b class="rank">${esc(c.rank)}</b>${item(c)}${use?.champion ? `<span class="why" title="${esc(use.reason ?? "")}">${esc(use.champion)}</span>` : ""}`,
      "",
      `car:${c.id}`,
    );
  });
  const costBadge = (u) =>
    `<em class="b-cost" style="--c:${COST[u.cost] ?? COST[1]}">${esc(u.cost)}</em>`;
  const buys = (st.buyNow ?? []).map((u) => {
    const glyph = u.replaces ? "⇄" : u.slot === "banco" ? "⤓" : "＋",
      why = `${u.cost}g · ${pct(u.chancePerShop)} por loja · ${u.replaces ? "entra por " + u.replaces : u.slot === "banco" ? "guardar no banco" : "vaga livre"}${u.affordable === false ? " · sem ouro" : ""}`;
    return champion(u, "goal", {
      key: `buy:${u.id}`,
      tile: true,
      noStars: true,
      tone: `unit-buy${u.affordable === false ? " is-broke" : ""}`,
      title: `${u.name} · ${why}`,
      badges: `${costBadge(u)}<em class="b-act" title="${esc(why)}">${glyph}</em>`,
      foot: `<span class="chance" style="--p:${Math.min(1, (u.chancePerShop ?? 0) / 0.2)}"><i></i></span><small>${pct(u.chancePerShop)}</small>`,
    });
  });
  const SHOP = {
    comprar: ["is-buy", "✓"],
    segurar: ["is-hold", "⏸"],
    "sem ouro": ["is-broke", "⊘"],
    ignorar: ["is-skip", "·"],
  };
  const shop = (st.shop ?? []).map((u) => {
    const [tone, glyph] = SHOP[u.action] ?? ["", "?"];
    return champion(u, "goal", {
      key: `shop:${u.slot ?? ""}:${u.id}`,
      tile: true,
      noStars: true,
      tone: `unit-shop ${tone}`,
      title: `${u.name} · ${u.action} · ${u.cost}g · ${u.reason}`,
      badges: `${costBadge(u)}<em class="b-act" title="${esc(u.action)}">${glyph}</em>`,
    });
  });
  const onBoard = observed.filter((u) => goal.has(u.id)).length,
    goalTotal = st.goalProgress?.goal ?? goal.size;
  const exits = new Map(),
    joined = new Set();
  for (const t of transitions)
    if (t.exit && !exits.has(t.exit.id)) exits.set(t.exit.id, t);
  const field = observed
    .map((u) => {
      const key = fieldKey(u.id),
        t = exits.get(u.id);
      if (t && !joined.has(u.id)) {
        joined.add(u.id);
        return swapGroup(t, u, key);
      }
      return champion(u, "current", { key, tile: true });
    })
    .concat(transitions.filter((t) => !t.exit).map(slotGroup));
  const ready = transitions.filter((t) => t.exit && t.ready).length,
    holding = transitions.filter((t) => t.exit && !t.ready).length;
  const items = [
    row("equip", "Equipar", [...equip, ...bank]),
    row("moves", "Passar itens", moves),
    row("build", "Próximo item", next),
    row("carousel", "Carrossel", carousel),
  ].join("");
  const trades = row(
    "shop",
    "Loja",
    shop.length ? [`<div class="tiles">${shop.join("")}</div>`] : [],
    shop.length,
  );
  return `<div class="reference-field"><div class="ref-head"><h2>Rastreio</h2><span class="lv" title="Nível">Nv ${esc(st.level)}</span><span class="goal" title="${onBoard} de ${esc(goalTotal)} peças da meta em campo">${pips(onBoard, goalTotal)}<b>${onBoard}/${esc(goalTotal)}</b></span>${ready ? `<span class="sum is-go" title="${ready} troca(s) para fazer agora">⇄ ${ready}</span>` : ""}${holding ? `<span class="sum is-hold" title="${holding} troca(s) para segurar">⏸ ${holding}</span>` : ""}</div><div class="reference-roster" data-live-section="field">${field.join("") || '<span class="reference-empty">Nenhum campeão lido.</span>'}</div>${row("buy", "Comprar", buys.length ? [`<div class="tiles">${buys.join("")}</div>`] : [], buys.length)}${items || trades ? `<div class="ref-cols">${items ? `<div class="ref-col">${items}</div>` : ""}${trades ? `<div class="ref-col">${trades}</div>` : ""}</div>` : ""}</div>`;
}
const states = new WeakMap();
/** Champion links keep the reference compact and open the existing inspector. */
export function initializeLiveView(element) {
  if (states.has(element)) return;
  states.set(element, { html: null });
  element.addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-inspect]");
    if (button && element.contains(button))
      element.dispatchEvent(
        new CustomEvent("compass:inspect", {
          bubbles: true,
          detail: {
            championId: button.dataset.liveInspect,
            source: button.dataset.liveSource,
          },
        }),
      );
  });
}
const MOVE_MS = 340;
/** Viewport rectangles of every keyed card, including any transform still in flight. */
function measure(element) {
  const rects = new Map();
  for (const el of element.querySelectorAll("[data-flip]"))
    if (!rects.has(el.dataset.flip))
      rects.set(el.dataset.flip, el.getBoundingClientRect());
  return rects;
}
/** Slide each card from where it was to where it is now; cards that did not exist stay still. */
function glide(element, before) {
  const seen = new Set();
  for (const el of element.querySelectorAll("[data-flip]")) {
    const key = el.dataset.flip,
      from = before.get(key);
    if (!from || seen.has(key)) continue;
    seen.add(key);
    const to = el.getBoundingClientRect(),
      dx = from.left - to.left,
      dy = from.top - to.top;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: MOVE_MS, easing: "cubic-bezier(0.22, 0.8, 0.24, 1)" },
    );
  }
}
/** Avoid rewriting identical markup, retain focus on the same champion row and glide cards to their new places. */
export function updateLiveView(element, plan, helpers, context) {
  if (!element) return;
  initializeLiveView(element);
  const state = states.get(element),
    html = createLiveHTML(plan, helpers, context);
  if (state.html === html) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches,
    before = state.html !== null && !calm ? measure(element) : null;
  const focused = document.activeElement,
    section = focused.closest?.("[data-live-section]");
  const saved =
    element.contains(focused) && focused.dataset.liveInspect
      ? {
          id: focused.dataset.liveInspect,
          source: focused.dataset.liveSource,
          section: section?.dataset.liveSection,
        }
      : null;
  state.html = html;
  element.innerHTML = html;
  if (before) glide(element, before);
  if (saved) {
    const scope = [...element.querySelectorAll("[data-live-section]")].find(
      (e) => e.dataset.liveSection === saved.section,
    );
    [...(scope?.querySelectorAll("[data-live-inspect]") ?? [])]
      .find(
        (b) =>
          b.dataset.liveInspect === saved.id &&
          b.dataset.liveSource === saved.source,
      )
      ?.focus({ preventScroll: true });
  }
}
