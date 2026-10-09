const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let champs = new Map(),
  items = new Map(),
  data = null,
  index = 0,
  selected = null,
  customIds = [],
  side = "right",
  manual = {},
  refresh = () => {},
  game = null,
  goalCarryId = "",
  goalLocked = false,
  goalBaseIds = [],
  goalPlan = null,
  inspectionSource = "goal",
  boardView = "goal",
  moving = false,
  copyFeedback = 0;
const markupCache = new Map();
// Aviso de troca de comp: o código copiado antes deixa de valer quando a comp ativa muda.
let lastCode = "",
  lastTitle = "",
  lastCodeGame = null;
const PAGE_TITLE = typeof document !== "undefined" ? document.title : "";
function watchComp(p) {
  const code = p?.teamCode?.code;
  if (!code) return;
  const title = p.title ?? "sua meta";
  if (lastCodeGame !== game) {
    lastCodeGame = game;
    lastCode = code;
    lastTitle = title;
    $("compchanged").hidden = true;
    return;
  }
  if (code === lastCode) return;
  $("compchangedtext").textContent =
    "A comp mudou: " +
    lastTitle +
    " → " +
    title +
    ". O código que você copiou antes não vale mais.";
  $("compchanged").hidden = false;
  document.title = "● Comp mudou · " + PAGE_TITLE;
  lastCode = code;
  lastTitle = title;
}
function clearCompNotice() {
  $("compchanged").hidden = true;
  document.title = PAGE_TITLE;
}
export function icon(id, label, kind = "champion") {
  const entry = (kind === "item" ? items : champs).get(id);
  return `<span class="asset ${entry?.icon ? "has-img" : ""}">${entry?.icon ? `<img src="${esc(entry.icon)}" alt="${esc(label ?? entry.name)}" loading="lazy">` : ""}<span class="glyph">${esc((label ?? entry?.name ?? "?").slice(0, 2))}</span></span>`;
}
export function itemTag(id) {
  const i = items.get(id);
  return `<span class="item-tag" title="${esc(i?.name ?? id)}">${icon(id, i?.name, "item")}<span>${esc(i?.name ?? id.replace(/^DA_/, ""))}</span></span>`;
}
export function champTag(u) {
  const id = u.id ?? u.championName;
  return `<span class="pill ${u.owned ? "owned" : ""}">${icon(id, u.name)}${u.owned ? "✓ " : ""}${esc(u.name)} ${u.stars ? u.stars + "★" : u.cost ? u.cost + "g" : ""}</span>`;
}
// Atualizações periódicas regravavam innerHTML idêntico, recriando nós (perdia hover, foco e menus abertos).
// O setter abaixo ignora HTML igual e faz um fade curto quando o conteúdo muda de fato.
export function smooth(ids) {
  const base = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML"),
    calm = matchMedia("(prefers-reduced-motion: reduce)");
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    let last = null;
    Object.defineProperty(el, "innerHTML", {
      configurable: true,
      get() {
        return base.get.call(el);
      },
      set(v) {
        v = String(v);
        if (v === last) return;
        const first = last === null;
        last = v;
        base.set.call(el, v);
        if (!first && !calm.matches && el.tagName !== "SELECT")
          el.animate([{ opacity: 0.4 }, { opacity: 1 }], {
            duration: 220,
            easing: "ease-out",
          });
      },
    });
  }
}
const synergyChips = (list) =>
  (list ?? [])
    .map(
      (t) =>
        '<span class="trait-chip ' +
        (t.active ? "" : "off") +
        '"><strong>' +
        t.count +
        "</strong>" +
        esc(t.name) +
        (t.next
          ? "<small>" +
            (t.next - t.count === 1 ? "falta 1" : "próx. " + t.next) +
            "</small>"
          : "") +
        "</span>",
    )
    .join("");
/** Dicas para fechar o próximo patamar de sinergia: unidade a comprar ou emblema a montar. */
export function synergyTipsHTML(tips) {
  return (tips ?? [])
    .map(
      (t) =>
        '<div class="synergy-tip' +
        (t.emblem?.craftable ? " ready" : "") +
        '"><strong>' +
        esc(t.trait) +
        " " +
        t.count +
        " → " +
        t.next +
        "</strong><span>" +
        (t.activeNow ? "sobe de patamar" : "ativa a sinergia") +
        " com mais 1</span>" +
        (t.units.length
          ? "<p>Unidade: " + t.units.map((u) => champTag(u)).join("") + "</p>"
          : "") +
        (t.emblem
          ? "<p>Emblema: " +
            itemTag(t.emblem.id) +
            (t.emblem.holder ? " em <b>" + esc(t.emblem.holder) + "</b>" : "") +
            " · " +
            (t.emblem.craftable
              ? '<span class="good">montável agora</span>'
              : "falta " +
                t.emblem.missing.map((c) => esc(c.name)).join(" + ")) +
            "</p>"
          : "") +
        "</div>",
    )
    .join("");
}
export { synergyChips };
export function getPlannerOptions() {
  return { previewIds: customIds, side, goalCarryId };
}
function active() {
  if (customIds.length) {
    const ids = JSON.stringify(customIds);
    if (
      data?.preview &&
      JSON.stringify(data.preview.board.map((u) => u.id)) === ids
    )
      return data.preview;
    if (goalPlan && JSON.stringify(goalPlan.board.map((u) => u.id)) === ids)
      return goalPlan;
  }
  return data?.recommendations[
    Math.min(index, (data?.recommendations.length ?? 1) - 1)
  ];
}
export function itemPlansHTML(plans) {
  return (plans ?? [])
    .slice(0, 3)
    .map(
      (p) =>
        `<div class="build-mini"><strong>${icon(p.championId, p.name)} ${esc(p.name)}</strong><div>${p.ideal.map((i) => itemTag(i.id)).join("")}</div><small>${p.slotsFree} slots livres · clique no mapa para ver receitas</small></div>`,
    )
    .join("");
}
function drawInspector() {
  const target = active();
  const plan = inspectionSource === "current" ? data?.currentPlan : target;
  if (!plan) return;
  const unit = plan.board.find((u) => u.id === selected) ?? plan.board[0];
  if (!unit) return;
  selected = unit.id;
  const build = plan.itemPlans.find((p) => p.championId === selected);
  const c = champs.get(selected);
  const alternatives = [...champs.values()]
    .filter((c) => !plan.board.some((u) => u.id === c.id))
    .map((c) => ({
      ...c,
      fit:
        c.traits.filter((t) => unit.traits.includes(t)).length * 3 -
        Math.abs(c.cost - unit.cost),
    }))
    .sort((a, b) => b.fit - a.fit);
  const inspectorScroll = $("inspector").scrollTop,
    swapChoice = $("swapchamp")?.value ?? "";
  $("inspector").innerHTML =
    `<div class="inspector-head">${icon(unit.id, unit.name)}<div><h3>${esc(unit.name)}</h3><span class="muted">Atual: ${unit.currentStars ? unit.currentStars + "★" : "não possui"} · Meta: ${unit.targetStars}★ · ${unit.cost}g · ${esc(unit.traits.join(" · "))}</span></div></div><p class="muted">Fonte da build: ${esc(build?.source ?? "indisponível")}. Ajuste fino contra ${esc(data.matchup.name)}, inferido do snapshot.</p><h4>Equipado agora</h4><div>${(unit.items ?? []).map(itemTag).join("") || '<span class="muted">Sem itens observados nesta unidade</span>'}</div><h4>Sinergias deste campeão</h4><div class="trait-ribbon">${synergyChips(build?.synergies) || '<span class="muted">Sem sinergia contada neste plano.</span>'}</div>${build?.synergyItem ? `<div class="recipe synergy"><div>${itemTag(build.synergyItem.id)}</div><p>Montável agora: dá ${esc(build.synergyItem.trait)} a este campeão e fecha o patamar ${build.synergyItem.to}.</p></div>` : ""}<h4>Build sugerida para este campeão</h4>${build?.ideal.map((i) => `<div class="recipe"><div>${itemTag(i.id)}</div><p>${esc(i.reason)}</p><p class="good">${esc(i.inventoryNote)}${i.missing?.length ? " · Falta: " + i.missing.map((c) => esc(c.name)).join(", ") : ""}</p><div class="components">${i.components.map((c) => itemTag(c.id)).join("<span> + </span>")}</div></div>`).join("") ?? ""}<p class="muted">${esc(build?.note)}</p><details class="inspector-more"><summary>Mais: slots livres e troca no plano</summary><h4>Priorizar nos slots livres</h4>${build?.additions.map((i) => itemTag(i.id)).join("") || '<p class="muted">Não há slot livre para equipar outro item.</p>'}<h4>Trocar no plano</h4><select id="swapchamp" aria-label="Campeão que entra"><option value="">Escolha uma alternativa…</option>${alternatives.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${c.cost}g${c.fit > 0 ? " · afinidade com traits" : ""}</option>`).join("")}</select><button id="doswap">Simular troca ↗</button><p class="muted">A troca altera o plano, sem vender ou mover unidades no jogo.</p></details>`;
  if (inspectionSource === "current") {
    const transition = target?.transitions.find((t) => t.exit?.id === unit.id);
    $("swapchamp").hidden = true;
    $("doswap").hidden = true;
    $("inspector").insertAdjacentHTML(
      "beforeend",
      '<div class="notice">' +
        (transition
          ? "Na meta escolhida: " +
            esc(unit.name) +
            " → " +
            esc(transition.enter.name) +
            ". Prepare a substituta antes de retirar este campeão."
          : target?.board.some((u) => u.id === unit.id)
            ? "Este campeão faz parte da comp escolhida. Preserve e busque os upgrades."
            : "Este campeão é temporário enquanto você monta a meta.") +
        "</div>",
    );
  }
  $("inspector").scrollTop = inspectorScroll;
  if ([...$("swapchamp").options].some((o) => o.value === swapChoice))
    $("swapchamp").value = swapChoice;
  $("doswap").onclick = () => {
    const id = $("swapchamp").value;
    if (!id) return;
    customIds = plan.board.map((u) => (u.id === selected ? id : u.id));
    if (manual[selected]) {
      manual[id] = manual[selected];
      delete manual[selected];
    }
    selected = id;
    if (goalLocked) {
      if (goalCarryId === unit.id) goalCarryId = id;
      saveGoal();
    }
    refresh();
  };
}
function positioned(p) {
  const used = new Set();
  const result = [];
  for (const u of [...p.positions].sort(
    (a, b) => Number(!!manual[b.championId]) - Number(!!manual[a.championId]),
  )) {
    let cell = { row: u.row, col: u.col, ...manual[u.championId] };
    if (used.has(cell.row + ":" + cell.col)) {
      outer: for (let row = 0; row < 4; row++)
        for (let col = 0; col < 7; col++)
          if (!used.has(row + ":" + col)) {
            cell = { row, col };
            break outer;
          }
    }
    used.add(cell.row + ":" + cell.col);
    result.push({ ...u, ...cell });
  }
  return result;
}
function drawGrid() {
  const plan = active();
  if (!plan) return;
  setMarkup("hexgrid", gridHTML(plan, "goal", positioned(plan)));
  $("positionnote").textContent = plan.positionNote;
  drawArenaHeader();
}
export function renderPlanner(d) {
  data = d;
  if (game !== d.metadata.gameId) {
    game = d.metadata.gameId;
    customIds = [];
    manual = {};
    index = 0;
    selected = null;
    goalLocked = false;
    goalCarryId = "";
    goalPlan = null;
    goalBaseIds = [];
    try {
      const saved = JSON.parse(
        localStorage.getItem("tft-helper-goal") ?? "null",
      );
      if (
        saved?.game === game &&
        Array.isArray(saved.ids) &&
        saved.ids.every((id) => champs.has(id))
      ) {
        customIds = saved.ids;
        goalBaseIds = saved.baseIds ?? [...saved.ids];
        goalCarryId = saved.carry ?? "";
        goalLocked = true;
        refresh();
      }
    } catch {}
  }
  // O servidor ampliou a meta fixada (seu nível passou do tamanho dela): acompanhar, senão a meta se perde.
  if (
    goalLocked &&
    Array.isArray(d.goalIds) &&
    d.goalIds.every((id) => champs.has(id)) &&
    JSON.stringify(d.goalIds) !== JSON.stringify(customIds)
  ) {
    customIds = [...d.goalIds];
    saveGoal();
    $("codestatus").textContent =
      "Meta ampliada para o seu nível: " +
      d.previewGrow.map((g) => g.name).join(", ") +
      ".";
  }
  const fixed = goalLocked ? active() : null;
  setMarkup(
    "planselect",
    (fixed
      ? `<option value="goal">Sua meta · ${esc(fixed.carry)} · ${fixed.board.length} campeões</option>`
      : "") +
      d.recommendations
        .map(
          (r, i) =>
            `<option value="${i}">${i + 1}. Nível ${r.board.length} · ${esc(r.title)}</option>`,
        )
        .join(""),
  );
  $("planselect").value = goalLocked ? "goal" : String(index);
  $("matchup").textContent =
    `Contra ${d.matchup.name} · físico estimado ${Math.round(d.matchup.physicalShare * 100)}% · ${d.matchup.healingUnits} unidades com sustain`;
  const p = active();
  watchComp(p);
  $("prioritize").disabled = !p;
  $("releasegoal").disabled = !goalLocked && !customIds.length;
  if (!p) return;
  renderPlaybook(p);
  $("prioritize").textContent = goalLocked
    ? "Comp priorizada ✓"
    : "Priorizar esta comp";
  if (
    !(inspectionSource === "current" ? d.currentPlan?.board : p.board)?.some(
      (u) => u.id === selected,
    )
  )
    selected = (
      inspectionSource === "current" ? d.currentPlan?.board : p.board
    )?.[0]?.id;
  $("transitions").innerHTML =
    p.transitions
      .map(
        (t) =>
          `<div class="transition"><div>${t.exit ? champTag({ ...t.exit, owned: true }) : '<span class="pill">Slot livre</span>'}<span class="arrow">→</span>${champTag(t.enter)}${t.source === "reserve" ? '<span class="source-badge">Da reserva</span>' : ""}</div><p>${esc(t.reason)}</p>${t.exit?.items.length ? '<small class="bad">Possui itens: preserve a unidade até resolver a transferência.</small>' : ""}</div>`,
      )
      .join("") ||
    '<p class="muted">O plano preserva todas as unidades atuais. Priorize seus upgrades.</p>';
  const sg = p.strategy;
  $("actionnow").hidden = !sg;
  if (sg) {
    $("actionnow").className =
      "actionnow act-" + sg.action.toLowerCase().replace(/[^a-z]/g, "");
    $("actionnow").innerHTML =
      '<div class="action-head"><span class="action-tag">' +
      esc(sg.action) +
      "</span><strong>" +
      esc(sg.headline) +
      '</strong><span class="muted">' +
      (p.meta ? "Tier " + p.meta.tier + " · " : "") +
      esc(p.title) +
      (sg.style ? " · " + esc(sg.style) : "") +
      "</span></div>";
  }
  $("synergytips").innerHTML = synergyTipsHTML(p.synergyTips);
  const st = p.stage,
    pct = (v) => (v * 100).toFixed(v < 0.1 ? 1 : 0) + "%",
    unit = (u, cls, sub) =>
      '<span class="stage-unit ' +
      cls +
      '">' +
      icon(u.id, u.name) +
      "<span>" +
      esc(u.name) +
      "<small>" +
      sub +
      "</small></span></span>";
  const sx = p.strategy,
    panel = (title, q) =>
      '<div class="core-card"><span>' +
      title +
      "</span><strong>" +
      esc(q.value) +
      '</strong><b class="' +
      (/AGORA|ROLAR \d/.test(q.verdict) ? "go" : "") +
      '">' +
      esc(q.verdict) +
      "</b><small>" +
      esc(q.text) +
      "</small>" +
      (q.targets?.length
        ? '<div class="core-targets">' +
          q.targets
            .map(
              (t) =>
                "<span>" +
                icon(t.id, t.name) +
                esc(t.name) +
                " " +
                t.goalStars +
                "★: " +
                t.own +
                "/" +
                t.goal +
                " · " +
                pct(t.chancePerShop) +
                "/loja" +
                (t.chanceInRoll != null
                  ? " · " + pct(t.chanceInRoll) + " nesta rolagem"
                  : "") +
                (t.enemy ? " · " + t.enemy + " com rivais" : "") +
                "</span>",
            )
            .join("") +
          "</div>"
        : "") +
      "</div>";
  const core = sx
    ? '<div class="core-action act-' +
      sx.action.toLowerCase().replace(/[^a-z]/g, "") +
      '"><div class="action-head"><span class="action-tag">' +
      esc(sx.action) +
      "</span><strong>" +
      esc(sx.headline) +
      '</strong><span class="muted">' +
      (p.meta ? "Tier " + p.meta.tier + " · " : "") +
      esc(p.title) +
      (sx.style ? " · " + esc(sx.style) : "") +
      "</span></div>" +
      (sx.steps.length
        ? "<ol>" +
          sx.steps.map((t) => "<li>" + esc(t) + "</li>").join("") +
          "</ol>"
        : "") +
      (sx.panels
        ? '<div class="core-grid">' +
          panel("Nível", sx.panels.leveling) +
          panel("Roll", { ...sx.panels.rolling, targets: [] }) +
          (sx.panels.rolling.targets?.length
            ? '<div class="core-card carry-progress"><span>Upgrades prioritários</span><div class="core-targets">' +
              sx.panels.rolling.targets
                .map(
                  (t) =>
                    "<span>" +
                    icon(t.id, t.name) +
                    "<span>" +
                    esc(t.name) +
                    " " +
                    t.goalStars +
                    "★<small>" +
                    t.own +
                    "/" +
                    t.goal +
                    " cópias · " +
                    pct(t.chancePerShop) +
                    "/loja" +
                    (t.enemy ? " · " + t.enemy + " com rivais" : "") +
                    "</small></span></span>",
                )
                .join("") +
              "</div></div>"
            : "") +
          panel("Economia", sx.panels.economy) +
          "</div>"
        : "") +
      "<details><summary>Por que esta decisão</summary><ul>" +
      sx.reasons.map((t) => "<li>" + esc(t) + "</li>").join("") +
      "</ul></details></div>"
    : "";
  $("strategy-comp").textContent =
    (goalLocked ? "Meta escolhida · " : "Sugestão atual · ") +
    (p.title ?? p.carry ?? "Composição");
  $("strategy-content").innerHTML =
    core || '<p class="empty-state">Estratégia indisponível nesta leitura.</p>';
  $("stageplan").innerHTML = st
    ? '<div class="stage-head"><strong>Seu campo agora · nível ' +
      st.level +
      '</strong><span class="muted">' +
      st.goalProgress.onBoard +
      " de " +
      st.goalProgress.goal +
      " peças da meta em campo</span></div>" +
      '<div class="stage-row">' +
      (st.board
        .map((u) =>
          unit(
            u,
            u.status + " owned",
            (u.stars ? u.stars + "★ · " : "") +
              (u.status === "meta"
                ? "manter · é da meta"
                : "segurar · temporário"),
          ),
        )
        .join("") ||
        '<span class="muted">Nenhuma unidade em campo nesta leitura.</span>') +
      "</div>" +
      (() => {
        const equip = st.board.filter((u) => u.equipNow?.length),
          next = st.board.filter(
            (u) => !u.equipNow?.length && u.slotsFree > 0 && u.nextItem,
          ),
          moves = p.itemMoves ?? [];
        return (
          (equip.length
            ? '<div class="stage-row"><span class="swap-title">Itens · monte e equipe agora</span>' +
              equip
                .map(
                  (u) =>
                    '<span class="swap swap-go">' +
                    u.equipNow.map((i) => itemTag(i.id)).join("") +
                    '<span class="arrow">→</span>' +
                    champTag(u) +
                    "<small>montável com o seu banco</small></span>",
                )
                .join("") +
              "</div>"
            : "") +
          ((st.bankItems ?? []).length
            ? '<div class="stage-row"><span class="swap-title">Itens do banco · coloque em</span>' +
              st.bankItems
                .map(
                  (b) =>
                    '<span class="swap ' +
                    (b.to ? "swap-go" : "swap-hold") +
                    '">' +
                    itemTag(b.id) +
                    '<span class="arrow">→</span>' +
                    (b.to
                      ? champTag({ id: b.to.id, name: b.to.name, owned: true })
                      : '<span class="pill">guardar</span>') +
                    "<small>" +
                    esc(b.reason) +
                    "</small></span>",
                )
                .join("") +
              "</div>"
            : "") +
          (moves.length
            ? '<div class="stage-row"><span class="swap-title">Itens · troque de quem para quem' +
              (p.removers === 0 ? " · sem removedor no banco" : "") +
              "</span>" +
              moves
                .map(
                  (m) =>
                    '<span class="swap ' +
                    (m.now ? "swap-go" : "swap-hold") +
                    '">' +
                    champTag({
                      id: m.from.id,
                      name: m.from.name,
                      stars: m.from.stars,
                      owned: true,
                    }) +
                    '<span class="arrow">→</span>' +
                    m.moves
                      .map(
                        (x) =>
                          itemTag(x.item.id) +
                          " em <b>" +
                          esc(x.to.name) +
                          "</b>",
                      )
                      .join(" · ") +
                    "<small>" +
                    (m.now
                      ? "agora"
                      : "depois · só quando " +
                        esc(m.from.name) +
                        " for trocado") +
                    " · " +
                    esc(m.method) +
                    "</small></span>",
                )
                .join("") +
              "</div>"
            : "") +
          (next.length
            ? '<div class="stage-row later"><span class="swap-title">Itens · próximo de cada um</span>' +
              next
                .map(
                  (u) =>
                    '<span class="stage-unit">' +
                    icon(u.nextItem.id, u.nextItem.name, "item") +
                    "<span>" +
                    esc(u.name) +
                    "<small>" +
                    esc(u.nextItem.name) +
                    (u.nextItem.missing.length
                      ? " · falta " + esc(u.nextItem.missing.join(" + "))
                      : "") +
                    "</small></span></span>",
                )
                .join("") +
              "</div>"
            : "")
        );
      })() +
      (st.shop.length
        ? '<div class="stage-row shop"><span class="swap-title">Na loja agora</span>' +
          st.shop
            .map((u) =>
              unit(
                u,
                "shop-" +
                  (u.action === "comprar"
                    ? "buy"
                    : u.action === "ignorar"
                      ? "skip"
                      : "wait"),
                (u.action === "comprar"
                  ? "COMPRAR"
                  : u.action === "sem ouro"
                    ? "falta ouro"
                    : u.action === "segurar"
                      ? "segurar ouro"
                      : "ignorar") +
                  " · " +
                  u.cost +
                  "g · " +
                  esc(u.reason),
              ),
            )
            .join("") +
          "</div>"
        : "") +
      (() => {
        const sw = p.transitions ?? [],
          row = (title, list, cls, sub) =>
            list.length
              ? '<div class="stage-row"><span class="swap-title">' +
                title +
                "</span>" +
                list
                  .map(
                    (t) =>
                      '<span class="swap ' +
                      cls +
                      '">' +
                      (t.exit
                        ? champTag({
                            ...t.exit,
                            owned: true,
                            stars: t.exitStars,
                          })
                        : '<span class="pill">Vaga livre</span>') +
                      '<span class="arrow">→</span>' +
                      champTag(t.enter) +
                      "<small>" +
                      sub(t) +
                      "</small></span>",
                  )
                  .join("") +
                "</div>"
              : "";
        return (
          row(
            "Trocar agora",
            sw.filter((t) => t.exit && t.ready),
            "swap-go",
            (t) =>
              "sai " +
              esc(t.exit.name) +
              " " +
              t.exitStars +
              "★, entra " +
              esc(t.enter.name) +
              " " +
              t.enterStars +
              "★" +
              (t.exit.items.length
                ? " · passe " + t.exit.items.length + " item(ns)"
                : ""),
          ) +
          row(
            "Segurar · ainda não trocar",
            sw.filter((t) => t.exit && !t.ready),
            "swap-hold",
            (t) =>
              t.requiredStars
                ? "mantenha " +
                  esc(t.exit.name) +
                  " " +
                  t.exitStars +
                  "★ até " +
                  esc(t.enter.name) +
                  " " +
                  t.requiredStars +
                  "★ (" +
                  t.enterCopies +
                  "/" +
                  3 ** (t.requiredStars - 1) +
                  " cópias)"
                : "mantenha " +
                  esc(t.exit.name) +
                  ": " +
                  esc(t.enter.name) +
                  " não compensa",
          ) +
          row(
            "Entra em vaga livre",
            sw.filter((t) => !t.exit),
            "swap-free",
            (t) =>
              t.source === "reserve"
                ? "já está na sua reserva"
                : "ao subir de nível",
          )
        );
      })() +
      ((p.carousel ?? []).length
        ? '<div class="stage-row"><span class="swap-title">No carrossel pegue</span>' +
          p.carousel
            .map(
              (c) =>
                '<span class="stage-unit' +
                (c.uses[0]?.completesNow ? " shop-buy" : "") +
                '">' +
                icon(c.id, c.name, "item") +
                "<span>" +
                c.rank +
                "º " +
                esc(c.name) +
                "<small>" +
                esc(c.uses[0]?.champion ?? "") +
                ": " +
                esc(c.uses[0]?.reason ?? "") +
                "</small></span></span>",
            )
            .join("") +
          "</div>"
        : "") +
      (st.buyNow.length
        ? '<div class="stage-row"><span class="swap-title">Compre se aparecer</span>' +
          st.buyNow
            .map((u) =>
              unit(
                u,
                "meta" + (u.affordable === false ? " cant" : ""),
                u.cost +
                  "g · " +
                  pct(u.chancePerShop) +
                  " por loja" +
                  (u.enemyCopies ? " · " + u.enemyCopies + " com rivais" : "") +
                  " · " +
                  (u.replaces
                    ? "entra por " + esc(u.replaces)
                    : u.slot === "banco"
                      ? "guardar no banco"
                      : "vaga livre") +
                  (u.affordable === false ? " · sem ouro" : ""),
              ),
            )
            .join("") +
          "</div>"
        : "") +
      (st.bridges.length
        ? '<div class="stage-row"><span class="swap-title">Pontes</span>' +
          st.bridges
            .map((u) =>
              unit(
                u,
                "ponte" + (u.affordable === false ? " cant" : ""),
                u.cost +
                  "g · " +
                  pct(u.chancePerShop) +
                  " por loja · ativa " +
                  esc(u.sharedTraits.join(", ")),
              ),
            )
            .join("") +
          "</div>"
        : "") +
      (st.later.length
        ? '<div class="stage-row later"><span class="swap-title">Depois</span>' +
          st.later
            .map((u) =>
              unit(u, "later", u.cost + "g · a partir do nível " + u.fromLevel),
            )
            .join("") +
          "</div>"
        : "") +
      (st.hold.length
        ? '<div class="stage-row later"><span class="swap-title">Guardar no banco</span>' +
          st.hold.map((u) => unit(u, "", "da meta · sem vaga agora")).join("") +
          "</div>"
        : "") +
      '<small class="muted">Loja no nível ' +
      st.level +
      ": " +
      st.odds
        .filter((o) => o.value > 0)
        .map((o) => "custo " + o.cost + " " + o.value + "%")
        .join(" · ") +
      ". " +
      esc(st.note) +
      "</small>"
    : "";
  $("swapstrip").innerHTML = p.transitions.length
    ? '<span class="swap-title">Trocas</span>' +
      p.transitions
        .map(
          (t) =>
            '<span class="swap">' +
            (t.exit
              ? champTag({ ...t.exit, owned: true })
              : '<span class="pill">Slot livre</span>') +
            '<span class="arrow">→</span>' +
            champTag(t.enter) +
            (t.exit
              ? '<small class="' +
                (t.ready ? "good" : "bad") +
                '">' +
                (t.ready
                  ? "trocar agora"
                  : t.requiredStars
                    ? "segure até " +
                      t.requiredStars +
                      "★ (" +
                      t.enterCopies +
                      "/" +
                      3 ** (t.requiredStars - 1) +
                      ")"
                    : "não trocar") +
                (t.exit.items.length
                  ? " · " + t.exit.items.length + " item(ns)"
                  : "") +
                "</small>"
              : "") +
            "</span>",
        )
        .join("")
    : '<span class="muted">Sem trocas: a comp alvo mantém todas as suas unidades.</span>';
  drawCurrentGrid();
  drawGrid();
  drawInspector();
  drawCarousel(p);
}
export function initPlanner(catalog, onRefresh) {
  champs = new Map(catalog.champions.map((c) => [c.id, c]));
  items = new Map(catalog.items.map((i) => [i.id, i]));
  refresh = onRefresh;
  document.addEventListener(
    "error",
    (e) => {
      if (e.target instanceof HTMLImageElement && e.target.closest(".asset")) {
        e.target.closest(".asset").classList.remove("has-img");
        e.target.remove();
      }
    },
    true,
  );
  $("planselect").onchange = () => {
    if ($("planselect").value === "goal") return;
    index = Number($("planselect").value);
    prioritize(data?.recommendations[index]);
  };
  $("prioritize").onclick = () => prioritize(active());
  $("copycode").onclick = () => copyCode(active());
  $("releasegoal").onclick = releaseGoal;
  $("copynew").onclick = () => {
    void copyCode(active());
    clearCompNotice();
  };
  $("compchangedclose").onclick = clearCompNotice;
  $("mirror").onclick = () => {
    side = side === "right" ? "left" : "right";
    manual = {};
    refresh();
  };
  $("resetplan").onclick = () => {
    customIds = goalLocked ? [...goalBaseIds] : [];
    manual = {};
    if (goalLocked) saveGoal();
    refresh();
  };
  $("showcurrent").onclick = () => setBoardView("current");
  $("showgoal").onclick = () => setBoardView("goal");
  $("currentroster").onclick = (e) => {
    const cell = e.target.closest("[data-id]");
    if (cell) {
      setBoardView("current");
      selectUnit(cell.dataset.id, "current");
    }
  };
  $("movechamp").onclick = () => {
    moving = !moving;
    if (!active()?.board.some((u) => u.id === selected))
      selected = active()?.board[0]?.id;
    inspectionSource = "goal";
    $("movestatus").textContent = moving
      ? "Escolha a casa de destino para " +
        (champs.get(selected)?.name ?? "o campeão") +
        ". Esc cancela."
      : "Movimento cancelado.";
    drawGrid();
  };
  $("currenthexgrid").onclick = (e) => {
    const cell = e.target.closest("[data-id]");
    if (cell) selectUnit(cell.dataset.id, "current");
  };
  $("hexgrid").onclick = (e) => {
    const cell = e.target.closest("[data-row]");
    if (!cell) return;
    if (moving) {
      moveTo(Number(cell.dataset.row), Number(cell.dataset.col));
      return;
    }
    if (cell.dataset.id) selectUnit(cell.dataset.id, "goal");
  };
  for (const id of ["hexgrid", "currenthexgrid"])
    $(id).onkeydown = (e) => {
      if (e.key === "Escape") {
        moving = false;
        drawGrid();
        return;
      }
      const delta = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      }[e.key];
      if (!delta) return;
      const cell = e.target.closest("[data-row]");
      if (!cell) return;
      e.preventDefault();
      const row = Math.max(0, Math.min(3, Number(cell.dataset.row) + delta[0])),
        col = Math.max(0, Math.min(6, Number(cell.dataset.col) + delta[1]));
      $(id)
        .querySelector(
          '[data-row="' + row + '"][data-col="' + col + '"]:not(:disabled)',
        )
        ?.focus();
    };
  $("hexgrid").ondragstart = (e) => {
    const cell = e.target.closest("[data-id]");
    if (cell) {
      inspectionSource = "goal";
      selected = cell.dataset.id;
      e.dataTransfer.setData("text/plain", cell.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    }
  };
  $("hexgrid").ondragover = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  $("hexgrid").ondrop = (e) => {
    e.preventDefault();
    const cell = e.target.closest("[data-row]");
    if (cell)
      moveTo(
        Number(cell.dataset.row),
        Number(cell.dataset.col),
        e.dataTransfer.getData("text/plain"),
      );
  };
}

function saveGoal() {
  try {
    localStorage.setItem(
      "tft-helper-goal",
      JSON.stringify({
        game,
        ids: customIds,
        baseIds: goalBaseIds,
        carry: goalCarryId,
      }),
    );
  } catch {
    $("codestatus").textContent =
      "Meta fixada nesta sessão; o navegador bloqueou salvar a preferência.";
  }
}
function prioritize(p) {
  if (!p) {
    $("codestatus").textContent = "Aguarde o carregamento de uma comp.";
    return;
  }
  goalPlan = p;
  customIds = p.board.map((u) => u.id);
  goalBaseIds = [...customIds];
  goalCarryId = p.board.find((u) => u.name === p.carry)?.id ?? "";
  goalLocked = true;
  manual = {};
  saveGoal();
  renderPlanner(data);
  void copyCode(p);
  void refresh();
}
function releaseGoal() {
  customIds = [];
  goalBaseIds = [];
  goalPlan = null;
  goalLocked = false;
  goalCarryId = "";
  manual = {};
  index = 0;
  try {
    localStorage.removeItem("tft-helper-goal");
  } catch {}
  if (data) renderPlanner(data);
  $("codestatus").textContent =
    "Meta liberada. Sugestões automáticas retomadas.";
  void refresh();
}
async function copyCode(p) {
  const code = p?.teamCode?.code;
  const status = $("codestatus"),
    button = $("copycode");
  if (!code) {
    status.textContent =
      p?.teamCode?.error ?? "Aguarde a comp carregar para gerar o código.";
    return;
  }
  const field = $("teamcode");
  field.value = code;
  let copied = false;
  // API assíncrona primeiro: execCommand pode devolver true sem gravar quando a seleção fica fora da tela.
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {}
  }
  if (!copied) {
    const previous = document.activeElement;
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, code.length);
    try {
      copied = document.execCommand("copy");
    } catch {}
    if (copied) previous?.focus({ preventScroll: true });
  }
  clearTimeout(copyFeedback);
  if (copied) {
    status.textContent = "Código TFT copiado ✓ " + code;
    $("copyhint").textContent = "Pronto para colar no planejador do TFT.";
    button.textContent = "Copiado ✓";
    button.classList.add("copied");
    copyFeedback = setTimeout(() => {
      button.textContent = "Copiar código TFT";
      button.classList.remove("copied");
    }, 2000);
  } else {
    status.textContent =
      "Navegador bloqueou a cópia automática. Pressione Ctrl+C no código selecionado.";
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, code.length);
    $("copyhint").textContent = "Código selecionado: Ctrl+C para copiar.";
  }
}

function renderPlaybook(p) {
  const b = p.playbook;
  $("goalstatus").textContent =
    (goalLocked ? "META FIXADA · " : "SUGESTÃO · ") +
    p.board.length +
    " campeões para nível " +
    p.board.length +
    (goalLocked
      ? " · a leitura da partida atualiza como chegar nessa comp"
      : " · selecione uma comp para priorizar");
  $("teamcode").value = p.teamCode?.code ?? "";
  $("copycode").disabled = !p.teamCode?.code;
  if (!b) return;
  $("playbook").innerHTML =
    '<div class="eyebrow">' +
    esc(b.style) +
    " · Carry " +
    esc(b.carry) +
    "</div><h3>" +
    esc(b.headline) +
    "</h3><ul>" +
    b.actions.map((a) => "<li>" + esc(a) + "</li>").join("") +
    "</ul><small>" +
    esc(b.note) +
    "</small>";
  $("odds").innerHTML =
    "<p>Nível atual " +
    b.currentLevel +
    (b.levelEstimated ? " (estimado)" : " (manual)") +
    " · alvo " +
    b.targetLevel +
    " · roll de referência " +
    b.rollLevel +
    '</p><div class="odds-costs">' +
    b.odds
      .map(
        (v, i) =>
          "<span>Custo " + (i + 1) + " <strong>" + v + "%</strong></span>",
      )
      .join("") +
    "</div><small>Odds de referência. Banco e lojas ocultos tornam a chance por campeão uma aproximação.</small>";
}

function drawCurrentGrid() {
  const plan = data?.currentPlan;
  setMarkup(
    "currenthexgrid",
    plan
      ? gridHTML(plan, "current", plan.positions)
      : '<p class="empty-state">Nenhum campeão conhecido nesta leitura.</p>',
  );
  $("currenttraits").innerHTML = (plan?.traits ?? [])
    .filter((t) => t.active)
    .map(
      (t) =>
        '<span class="trait-chip"><strong>' +
        t.count +
        "</strong>" +
        esc(t.name) +
        "</span>",
    )
    .join("");
  const target = active();
  setMarkup(
    "reserveroster",
    (data?.self.reserve ?? [])
      .map(
        (u) =>
          '<span class="reserve-unit">' +
          icon(u.id, u.name) +
          "<span>" +
          esc(u.name) +
          "<small>" +
          u.stars +
          "★ × " +
          u.quantity +
          " · manual</small></span></span>",
      )
      .join("") ||
      '<p class="muted">Sem unidades de reserva informadas. Não significa que o banco esteja vazio.</p>',
  );
  $("goaltraits").innerHTML = (target?.traits ?? [])
    .filter((t) => t.active)
    .map(
      (t) =>
        '<span class="trait-chip"><strong>' +
        t.count +
        "</strong>" +
        esc(t.name) +
        "</span>",
    )
    .join("");
  const kept = (plan?.board ?? []).filter((u) =>
    target?.board.some((t) => t.id === u.id),
  ).length;
  $("rosterprogress").textContent =
    kept + " / " + (target?.board.length ?? 0) + " campeões da meta em campo";
  setMarkup(
    "currentroster",
    (plan?.board ?? [])
      .map(
        (u) =>
          '<button data-id="' +
          esc(u.id) +
          '" class="roster-unit ' +
          (target?.board.some((t) => t.id === u.id) ? "kept" : "leaving") +
          '" title="Ver ' +
          esc(u.name) +
          '">' +
          icon(u.id, u.name) +
          "<span>" +
          esc(u.name) +
          "<small>" +
          u.currentStars +
          "★ · " +
          (target?.board.some((t) => t.id === u.id) ? "manter" : "temporário") +
          "</small></span></button>",
      )
      .join(""),
  );
  drawArenaHeader();
}
function setMarkup(id, html) {
  const el = $(id);
  if (markupCache.get(id) === html) return;
  markupCache.set(id, html);
  const focused = document.activeElement?.closest("[data-row][data-col]");
  const cell =
    focused && el.contains(focused)
      ? { row: focused.dataset.row, col: focused.dataset.col }
      : null;
  el.innerHTML = html;
  if (cell)
    el.querySelector(
      '[data-row="' + cell.row + '"][data-col="' + cell.col + '"]',
    )?.focus({ preventScroll: true });
}
function gridHTML(plan, source, positions) {
  const target = active();
  return Array.from(
    { length: 4 },
    (_, row) =>
      '<div class="hexrow ' +
      (row % 2 ? "offset" : "") +
      '">' +
      Array.from({ length: 7 }, (_, col) => {
        const position = positions.find((u) => u.row === row && u.col === col),
          unit = plan.board.find((u) => u.id === position?.championId),
          build = plan.itemPlans.find((b) => b.championId === unit?.id);
        const status = unit
          ? source === "current"
            ? target?.board.some((t) => t.id === unit.id)
              ? "owned"
              : "outgoing"
            : unit.owned
              ? "owned"
              : "incoming"
          : "";
        const swapIn =
            status === "incoming"
              ? target?.transitions.find((t) => t.enter.id === unit.id)
              : null,
          swapOut =
            status === "outgoing"
              ? target?.transitions.find((t) => t.exit?.id === unit.id)
              : null;
        const label =
          status === "owned"
            ? "Manter"
            : status === "outgoing"
              ? swapOut
                ? (swapOut.ready ? "Sai → " : "Fica até ") +
                  swapOut.enter.name +
                  (swapOut.ready || !swapOut.requiredStars
                    ? ""
                    : " " + swapOut.requiredStars + "★")
                : "Sai · sem substituta"
              : swapIn?.exit
                ? (swapIn.ready
                    ? unit.inReserve
                      ? "Da reserva por "
                      : "Entra por "
                    : swapIn.requiredStars
                      ? "Com " + swapIn.requiredStars + "★, por "
                      : "Não trocar ") + swapIn.exit.name
                : unit?.inReserve
                  ? "Da reserva"
                  : "Comprar · slot livre";
        const itemIds =
          source === "current"
            ? (unit?.items ?? [])
            : (build?.additions ?? []).map((i) => i.id);
        return (
          '<button type="button" class="hex ' +
          (unit ? "occupied " : "") +
          status +
          " " +
          (inspectionSource === source && unit?.id === selected
            ? "selected "
            : "") +
          (moving && source === "goal" ? "move-target" : "") +
          '" data-row="' +
          row +
          '" data-col="' +
          col +
          '" ' +
          (unit
            ? 'data-id="' +
              esc(unit.id) +
              '" ' +
              (source === "goal" ? 'draggable="true" ' : "") +
              'title="' +
              esc(unit.name) +
              " · " +
              label +
              " · " +
              (source === "current"
                ? unit.currentStars + " estrelas atuais"
                : unit.targetStars + " estrelas alvo") +
              '" '
            : "") +
          'aria-label="' +
          esc(
            unit
              ? unit.name + ", " + label + ", "
              : moving
                ? "Mover para "
                : "Casa vazia, ",
          ) +
          "fileira " +
          (row + 1) +
          ", coluna " +
          (col + 1) +
          '" ' +
          (!unit && !(moving && source === "goal") ? "disabled" : "") +
          ">" +
          (unit
            ? '<span class="tile-top"><span class="tile-stars">' +
              "★".repeat(
                source === "current" ? unit.currentStars : unit.targetStars,
              ) +
              '</span><span class="tile-cost">' +
              unit.cost +
              "g</span></span>" +
              icon(unit.id, unit.name) +
              '<span class="hex-name">' +
              esc(unit.name) +
              '</span><span class="hex-build" title="' +
              (source === "current" ? "Equipados" : "Recomendados") +
              '">' +
              itemIds
                .slice(0, 3)
                .map((id) => icon(id, null, "item"))
                .join("") +
              '</span><span class="tile-state">' +
              label +
              "</span>"
            : '<span class="coord">' +
              (row + 1) +
              "·" +
              (col + 1) +
              "</span>") +
          "</button>"
        );
      }).join("") +
      "</div>",
  ).join("");
}
function drawArenaHeader() {
  const plan = boardView === "current" ? data?.currentPlan : active();
  $("currentpanel").hidden = boardView !== "current";
  $("goalpanel").hidden = boardView !== "goal";
  for (const [id, view] of [
    ["showcurrent", "current"],
    ["showgoal", "goal"],
  ]) {
    $(id).classList.toggle("active", boardView === view);
    $(id).setAttribute("aria-pressed", String(boardView === view));
  }
  $("arenatitle").textContent =
    boardView === "current" ? "Seu campo atual" : "Sua comp alvo";
  $("arenasubtitle").textContent =
    boardView === "current"
      ? "Equipamento observado · posicionamento sugerido"
      : "Estrelas alvo e itens recomendados · prepare cada substituição";
  $("arenacount").textContent = (plan?.board.length ?? 0) + " campeões";
  $("movechamp").disabled = boardView !== "goal";
  $("movechamp").textContent = moving ? "Cancelar movimento" : "Mover campeão";
  $("movechamp").setAttribute("aria-pressed", String(moving));
}
function selectUnit(id, source) {
  inspectionSource = source;
  selected = id;
  drawGrid();
  drawCurrentGrid();
  drawInspector();
}
function setBoardView(view) {
  boardView = view;
  moving = false;
  const plan = view === "current" ? data?.currentPlan : active();
  if (!plan?.board.some((u) => u.id === selected))
    selected = plan?.board[0]?.id;
  inspectionSource = view;
  drawGrid();
  drawCurrentGrid();
  drawInspector();
}
function moveTo(row, col, id = selected) {
  const plan = active();
  if (!plan?.board.some((u) => u.id === id)) return;
  const positions = positioned(plan),
    from = positions.find((u) => u.championId === id),
    other = positions.find((u) => u.row === row && u.col === col);
  if (!from) return;
  if (other && other.championId !== id)
    manual[other.championId] = { row: from.row, col: from.col };
  manual[id] = { row, col };
  moving = false;
  inspectionSource = "goal";
  selected = id;
  $("movestatus").textContent =
    (champs.get(id)?.name ?? id) +
    " movido no plano para fileira " +
    (row + 1) +
    ", coluna " +
    (col + 1) +
    ".";
  drawGrid();
  drawCurrentGrid();
  drawInspector();
}

function drawCarousel(plan) {
  setMarkup(
    "carouselitems",
    (plan.carousel ?? [])
      .map(
        (c) =>
          '<article class="carousel-pick"><div class="eyebrow">PRIORIDADE ' +
          c.rank +
          "</div><h4>" +
          itemTag(c.id) +
          ' <small class="muted">' +
          (c.owned ? "você já tem " + c.owned : "você não tem nenhum") +
          "</small></h4>" +
          c.uses
            .map(
              (u) =>
                "<p><strong>" +
                esc(u.champion) +
                "</strong> → " +
                itemTag(u.itemId) +
                '<br><span class="' +
                (u.completesNow ? "good" : "muted") +
                '">' +
                esc(
                  u.reason ??
                    (u.completesNow
                      ? "Fecha a receita agora."
                      : "Começa a receita."),
                ) +
                "</span></p>",
            )
            .join("") +
          "</article>",
      )
      .join("") ||
      '<p class="muted">Nenhum componente prioritário para os slots livres deste plano.</p>',
  );
}
