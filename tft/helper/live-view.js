const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pct = (v) =>
  typeof v === "number"
    ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`
    : "não estimada";
/** Render observed field and actionable recommendations without mutating game state. */
export function createLiveHTML(plan, { icon, itemTag }) {
  const st = plan?.stage;
  if (!st)
    return '<div class="live-empty"><strong>Aguardando seu campo</strong><p>As peças e próximas ações aparecem quando a leitura da partida chegar.</p></div>';
  const champ = (u, source = "current") => {
    const inspectable =
      source === "current" ||
      (plan.board ?? []).some((unit) => unit.id === u.id);
    const tag = inspectable ? "button" : "div";
    const action = inspectable
      ? ` data-live-inspect="${esc(u.id)}" data-live-source="${source}" aria-label="Inspecionar ${esc(u.name)} no ${source === "current" ? "campo atual" : "plano alvo"}"`
      : "";
    return `<${tag} class="live-champion"${action}>${icon(u.id, u.name)}<span><strong>${esc(u.name)}</strong><small>${u.stars ? `${esc(u.stars)}★ · ` : ""}${u.status === "meta" ? "faz parte da meta" : source === "goal" ? "alvo recomendado" : "peça em campo"}</small></span></${tag}>`;
  };
  const card = (html, action = false) =>
    `<article class="live-card${action ? " live-card-action" : ""}">${html}</article>`;
  const empty = (text) => `<p class="live-empty-note">${esc(text)}</p>`;
  const section = (id, title, hint, html, count) =>
    `<section class="live-section" data-live-section="${id}"><header><div><h3>${title}${count === undefined ? "" : `<span class="live-count">${count}</span>`}</h3><p>${hint}</p></div><button class="live-collapse" data-live-collapse="${id}" aria-expanded="true" aria-label="Recolher ${title}">−</button></header><div class="live-section-body"><div class="live-grid">${html}</div></div></section>`;
  const board = st.board ?? [],
    transitions = plan.transitions ?? [],
    shop = st.shop ?? [];
  return (
    `<div class="live-guidance"><div class="live-overview"><span class="live-eyebrow">ACOMPANHAMENTO</span><h2>Seu campo, próximo passo.</h2><p>Nível ${esc(st.level ?? "não lido")} · ${esc(st.goalProgress?.onBoard ?? 0)} de ${esc(st.goalProgress?.goal ?? "—")} peças da meta em campo.</p><div class="live-filters" role="group" aria-label="Filtrar acompanhamento"><button data-live-filter="all" aria-pressed="true">Visão completa</button><button data-live-filter="actions" aria-pressed="false">Próximas ações</button></div></div>` +
    section(
      "field",
      "Seu campo agora",
      "Peças observadas. Clique para abrir os detalhes no planejador.",
      board.map((u) => card(champ(u))).join("") ||
        empty("Nenhuma peça em campo foi lida ainda."),
      board.length,
    ) +
    section(
      "equip",
      "Itens para equipar",
      "Recomendação com o inventário informado ou observado.",
      board
        .filter((u) => u.equipNow?.length)
        .map((u) =>
          card(
            champ(u) +
              `<div class="live-item-list">${u.equipNow.map((i) => itemTag(i.id)).join("")}</div>`,
            true,
          ),
        )
        .join("") +
        (st.bankItems ?? [])
          .map((i) =>
            card(
              itemTag(i.id) +
                `<p>${i.to ? `Para ${esc(i.to.name)}` : "Guardar por enquanto"}</p><small>${esc(i.reason)}</small>`,
            ),
          )
          .join("") || empty("Nenhum item pronto recomendado nesta leitura."),
    ) +
    section(
      "moves",
      "Transferir itens",
      "Confira o método antes de tirar um item do portador.",
      (plan.itemMoves ?? [])
        .flatMap((m) =>
          (m.moves ?? []).map((move) =>
            card(
              `<div class="live-transfer"><span>${icon(m.from.id, m.from.name)}${esc(m.from.name)} ${esc(m.from.stars)}★</span><span aria-hidden="true">→</span><span>${itemTag(move.item.id)} em <strong>${esc(move.to.name)}</strong></span></div><p>${m.now ? "Pode fazer agora" : "Planeje a transferência"} · ${esc(m.method)}</p>`,
            ),
          ),
        )
        .join("") || empty("Nenhuma transferência sugerida."),
    ) +
    section(
      "build",
      "Próximos itens",
      "Builds sugeridas; componentes faltantes não são itens disponíveis.",
      board
        .filter((u) => !u.equipNow?.length && u.slotsFree > 0 && u.nextItem)
        .map((u) =>
          card(
            champ(u) +
              itemTag(u.nextItem.id) +
              `<p>Falta: ${esc(u.nextItem.missing?.join(" + ") || "nenhum componente informado")}</p>`,
          ),
        )
        .join("") || empty("Nenhuma próxima build calculada."),
    ) +
    section(
      "transitions",
      "Monte sua meta",
      "Entradas, saídas e upgrades que precisam esperar.",
      transitions
        .map((t) =>
          card(
            `<span class="live-badge">${!t.exit ? "Vaga livre" : t.ready ? "Troca pronta" : "Segurar"}</span><div class="live-transfer">${t.exit ? champ({ ...t.exit, stars: t.exitStars }) : "<span>Ao abrir espaço</span>"}<span aria-hidden="true">→</span>${champ({ ...t.enter, stars: t.enterStars }, "goal")}</div><p>${esc(t.reason || (t.exit && !t.ready ? `Mantenha ${t.exit.name} até ${t.enter.name} estar pronto.` : !t.exit ? (t.source === "reserve" ? "Já está na reserva: use quando houver espaço." : "Ao subir de nível e abrir uma vaga.") : "A substituição melhora o plano atual."))}</p><small>${t.source === "reserve" ? "Peça na reserva" : "Peça a buscar"}${t.requiredStars ? ` · alvo ${esc(t.requiredStars)}★ (${esc(t.enterCopies ?? 0)}/${3 ** (t.requiredStars - 1)} cópias)` : ""}</small>`,
            t.ready,
          ),
        )
        .join("") || empty("Nenhuma troca sugerida no momento."),
    ) +
    section(
      "shop",
      "Loja observada",
      "Somente peças lidas da loja. Nenhuma compra é executada pelo helper.",
      shop
        .map((u) =>
          card(
            champ(u, "goal") +
              `<span class="live-badge">${esc(u.action)}</span><p>${esc(u.cost)}g · ${esc(u.reason)}</p>`,
            u.action === "comprar",
          ),
        )
        .join("") ||
        empty(
          "Loja não disponível. Os alvos abaixo não confirmam uma peça à venda.",
        ),
      shop.length,
    ) +
    section(
      "buy",
      "Compre se aparecer",
      "Alvos sugeridos; chances são estimativas por loja.",
      (st.buyNow ?? [])
        .map((u) =>
          card(
            champ(u, "goal") +
              `<p>${esc(u.cost)}g · chance ${pct(u.chancePerShop)}</p><small>${esc(u.enemyCopies ?? 0)} cópias observadas nos adversários · ${u.replaces ? `entra por ${esc(u.replaces)}` : u.slot === "banco" ? "guardar no banco" : "vaga livre"}${u.affordable === false ? " · ouro insuficiente" : ""}</small>`,
          ),
        )
        .join("") || empty("Nenhum alvo de compra nesta leitura."),
    ) +
    section(
      "carousel",
      "Prioridade no carrossel",
      "Componentes para avançar as builds.",
      (plan.carousel ?? [])
        .map((i) =>
          card(
            `<span class="live-badge">${esc(i.rank)}ª prioridade</span>${itemTag(i.id)}${(
              i.uses ?? []
            )
              .slice(0, 2)
              .map(
                (u) =>
                  `<p><strong>${esc(u.champion)}</strong> · ${esc(u.reason)}</p>`,
              )
              .join("")}`,
          ),
        )
        .join("") ||
        empty("Informe os componentes para receber prioridades de carrossel."),
    ) +
    section(
      "bridges",
      "Peças de transição",
      "Alternativas para ativar sinergias enquanto sua meta chega.",
      (st.bridges ?? [])
        .map((u) =>
          card(
            champ(u, "goal") +
              `<p>${esc(u.cost)}g · chance ${pct(u.chancePerShop)}</p><small>Ativa ${esc(u.sharedTraits?.join(", "))}${u.affordable === false ? " · ouro insuficiente" : ""}</small>`,
          ),
        )
        .join("") || empty("Nenhuma ponte indicada para esta composição."),
    ) +
    section(
      "later",
      "Planeje os próximos níveis",
      "Peças para depois e campeões da meta sem espaço agora.",
      (st.later ?? [])
        .map((u) =>
          card(
            champ(u, "goal") +
              `<p>${esc(u.cost)}g · buscar a partir do nível ${esc(u.fromLevel)}</p>`,
          ),
        )
        .join("") +
        (st.hold ?? [])
          .map((u) =>
            card(
              champ(u, "goal") +
                "<p>Guardar no banco · da meta, mas sem vaga agora.</p>",
            ),
          )
          .join("") || empty("Nenhuma peça precisa esperar um próximo nível."),
    ) +
    `<details class="live-evidence"><summary>Chances de loja e limites da leitura</summary><p>Loja no nível ${esc(st.level)}: ${
      (st.odds ?? [])
        .filter((o) => o.value > 0)
        .map((o) => `custo ${esc(o.cost)}: ${esc(o.value)}%`)
        .join(" · ") || "probabilidades indisponíveis"
    }.</p><p>${esc(st.note)}</p></details></div>`
  );
}
const states = new WeakMap();
/** Install delegated controls once and preserve local presentation state. */
export function initializeLiveView(element) {
  if (states.has(element)) return;
  const state = {
    collapsed: new Set(),
    filter: "all",
    html: null,
    evidenceOpen: false,
  };
  states.set(element, state);
  const apply = () => {
    element.querySelectorAll("[data-live-section]").forEach((section) => {
      const id = section.dataset.liveSection,
        closed = state.collapsed.has(id);
      section.hidden = state.filter === "actions" && id === "field";
      section.querySelector(".live-section-body").hidden = closed;
      const button = section.querySelector("[data-live-collapse]");
      button.setAttribute("aria-expanded", String(!closed));
      button.setAttribute(
        "aria-label",
        `${closed ? "Expandir" : "Recolher"} ${section.querySelector("h3").textContent}`,
      );
      button.textContent = closed ? "+" : "−";
    });
    const evidence = element.querySelector(".live-evidence");
    if (evidence) evidence.open = state.evidenceOpen;
    element
      .querySelectorAll("[data-live-filter]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.liveFilter === state.filter),
        ),
      );
  };
  element.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !element.contains(button)) return;
    if (button.dataset.liveInspect)
      element.dispatchEvent(
        new CustomEvent("compass:inspect", {
          bubbles: true,
          detail: {
            championId: button.dataset.liveInspect,
            source: button.dataset.liveSource,
          },
        }),
      );
    if (button.dataset.liveCollapse) {
      const id = button.dataset.liveCollapse;
      state.collapsed.has(id)
        ? state.collapsed.delete(id)
        : state.collapsed.add(id);
      apply();
    }
    if (button.dataset.liveFilter) {
      state.filter = button.dataset.liveFilter;
      apply();
    }
  });
  element.addEventListener(
    "toggle",
    (event) => {
      if (event.target.matches?.(".live-evidence"))
        state.evidenceOpen = event.target.open;
    },
    true,
  );
  element.addEventListener("compass:live-render", apply);
}
/** Replace changed content only; retain keyboard focus and disclosure state. */
export function updateLiveView(element, plan, helpers) {
  if (!element) return;
  initializeLiveView(element);
  const state = states.get(element),
    html = createLiveHTML(plan, helpers);
  if (state.html === html) return;
  const focus = element.contains(document.activeElement)
    ? {
        id: document.activeElement.dataset.liveInspect,
        source: document.activeElement.dataset.liveSource,
        collapse: document.activeElement.dataset.liveCollapse,
        filter: document.activeElement.dataset.liveFilter,
        evidence: document.activeElement.matches(".live-evidence summary"),
      }
    : null;
  state.html = html;
  element.innerHTML = html;
  element.dispatchEvent(new Event("compass:live-render"));
  if (focus)
    Array.from(element.querySelectorAll("button"))
      .find((b) =>
        focus.id
          ? b.dataset.liveInspect === focus.id &&
            b.dataset.liveSource === focus.source
          : focus.collapse
            ? b.dataset.liveCollapse === focus.collapse
            : b.dataset.liveFilter === focus.filter,
      )
      ?.focus({ preventScroll: true });
}
