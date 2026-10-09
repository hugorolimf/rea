import {
  synergyChips,
  synergyTipsHTML,
  smooth,
  initPlanner,
  renderPlanner,
  getPlannerOptions,
  icon,
  itemTag,
  champTag,
  itemPlansHTML,
  inspectPlannerChampion,
} from "/planner.js";
const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmtItem = (id) =>
  id.replace(/^DA_(Component_)?/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
const colors = {
  1: "#8995a6",
  2: "#68cba4",
  3: "#73a7ed",
  4: "#ba8cfa",
  5: "#f1c67d",
};
let inventory = [],
  bench = [],
  lastGame = null,
  data = null,
  busy = false,
  pendingUpdate = false,
  catalog = [],
  suggestionRevision = 0,
  lastRecHTML = "";
let lastAnalysisKey = "",
  activeScreen = "live";
const fetchJSON = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(result.error ?? "Não foi possível atualizar a leitura.");
  return result;
};
smooth([
  "strategy-content",
  "actionnow",
  "decision",
  "stageplan",
  "synergytips",
  "swapstrip",
  "benchlist",
  "benchplayer",
  "board",
  "counters",
  "currentbuilds",
  "freeitems",
  "itemadvice",
  "player",
  "poolrows",
  "rivals",
  "summary",
  "viewboard",
  "viewplayer",
  "warnings",
  "currenttraits",
  "goaltraits",
  "inspector",
  "odds",
  "playbook",
  "transitions",
  "carouselitems",
  "currentroster",
  "reserveroster",
]);
let augmentDismissed = "",
  chosenAugments = [];
let goldManual = false,
  inventoryManual = false;
let saved = {};
try {
  saved =
    JSON.parse(localStorage.getItem("tft-helper-settings") ?? "null") ?? {};
} catch {}
for (let n = 1; n <= 11; n++) $("level").add(new Option(`Nível ${n}`, n));
$("level").value = saved.level ?? 7;
$("gold").value = "";
$("autolevel").checked = true;
$("targetlevel").value = "auto";
function optionRows(players) {
  return players
    .map(
      (p) =>
        `<option value="${esc(p.id)}">${esc(p.name)} · ${p.health} HP</option>`,
    )
    .join("");
}
function unit(u) {
  return `<div class="unit" style="--cost:${colors[u.price ?? u.cost] ?? colors[1]}"><div class="unit-portrait">${icon(u.id ?? u.championName, u.name)}</div><div class="stars">${"★".repeat(Math.min(4, u.starLevel ?? u.stars ?? 1))}</div><div class="name">${esc(u.name)}</div><div class="traits">${esc((u.traits ?? []).join(" · "))}</div><div class="items">${(u.itemNames ?? u.items ?? []).map(itemTag).join("") || "Sem itens"}</div></div>`;
}
function renderPool() {
  const q = $("search").value.toLowerCase();
  $("poolrows").innerHTML = (data?.pool ?? [])
    .filter((p) => p.name.toLowerCase().includes(q))
    .map(
      (p) =>
        `<tr><td><strong>${esc(p.name)}</strong></td><td style="color:${colors[p.cost]}">${p.cost}g</td><td>${p.own}</td><td class="${p.enemy / p.total > 0.25 ? "bad" : ""}">${p.enemy}</td><td>≤ ${p.remainingUpper} / ${p.total}</td><td>${(p.chancePerSlot * 100).toFixed(2)}%</td><td>${(p.chancePerShop * 100).toFixed(1)}%</td><td>${esc(p.rivals.join(", ")) || "Não observado"}</td></tr>`,
    )
    .join("");
}
function renderBench() {
  $("benchlist").innerHTML = bench
    .map((u, i) => {
      const p = data?.metadata.players.find((p) => p.id === u.playerId);
      const c = catalog.find((c) => c.id === u.championName);
      return `<div class="manual-row">${esc(p?.name ?? u.playerId)} · ${esc(c?.name)} ${u.starLevel}★ × ${u.quantity} <button data-remove="${i}">Remover</button></div>`;
    })
    .join("");
}
function render() {
  const d = data,
    m = d.metadata;
  $("connection").textContent = m.actionable
    ? "Partida ao vivo"
    : "Última leitura · fora do modo ao vivo";
  document.body.classList.toggle("snapshot-only", !m.actionable);
  $("sideconnection").textContent = m.actionable
    ? "Partida ao vivo"
    : "Última leitura";
  $("connection").className = "status " + (m.actionable ? "live" : "");
  $("freshness").className = "notice " + (m.actionable ? "live" : "");
  $("freshness").textContent = m.actionable
    ? `Partida ${m.gameId} · leitura do tabuleiro há ${m.ageSeconds}s. Reserva adversária não capturada; a loja depende da leitura da tela.`
    : `Análise de snapshot: fase ${m.phase ?? "não confirmada"}, idade ${m.ageSeconds}s${m.sameGame === false ? " e ID diferente da sessão atual" : ""}. Não use esta leitura como decisão ao vivo.`;
  $("time").textContent =
    `Fonte: ${new Date(m.modifiedAt).toLocaleTimeString("pt-BR")}`;
  $("summary").innerHTML = [
    ["Seu HP", d.self.health, "Saúde lida no snapshot"],
    ["Unidades", d.self.units.length, "No tabuleiro observado"],
    ["Rivais vivos", d.opponents.length, "Bancos não incluídos"],
    [
      "Foco",
      d.preview?.carry ?? d.recommendations[0]?.carry ?? "Aguardando",
      "Carry da direção ativa",
    ],
  ]
    .map(
      ([label, value, note]) =>
        `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="label">${note}</div></div>`,
    )
    .join("");
  $("board").innerHTML = d.self.units.map(unit).join("");
  $("viewtitle").textContent = d.viewedBoard
    ? "Tabuleiro observado · " + d.viewedBoard.name
    : "Consultar tabuleiro adversário";
  $("viewboard").innerHTML = d.viewedBoard
    ? d.viewedBoard.units.map(unit).join("")
    : '<p class="muted">Escolha um adversário acima. Seu tabuleiro permanece vinculado ao Hero.</p>';
  const recHTML = d.recommendations
    .map(
      (r) =>
        `<article class="path"><div class="rank"><span>${r.rank === 1 ? "PRIMEIRO CAMINHO" : "ALTERNATIVA " + r.rank}</span><span class="score">${r.score}</span></div><h3>${r.meta ? `<span class="tier tier-${r.meta.tier}">${r.meta.tier}</span> ` : ""}${esc(r.title)} <small class="muted">${r.board.length} campeões${r.meta ? ` · média ${r.meta.avg} · top 4 ${r.meta.top4}% · ${esc(r.meta.levelling || "")}` : ""}</small></h3><button data-pick="${r.rank - 1}">Escolher comp e copiar código</button><p>Carry sugerido: <strong class="good">${esc(r.carry)}</strong></p><div>${r.board.map(champTag).join("")}</div><ul>${r.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul><h4>Comprar se aparecer</h4>${r.targets.map((t) => `<div class="target"><span>${esc(t.name)} <span class="muted">${t.cost}g</span></span><span class="${t.enemyCopies ? "bad" : "good"}">${t.enemyCopies ? "Rivais: " + t.enemyCopies : "Sem disputa visível"}</span></div>`).join("") || "<p>Priorize evoluir as unidades que já tem.</p>"}<h4>Builds de itens</h4>${itemPlansHTML(r.itemPlans)}<h4>Transição</h4><p>Manter: ${esc(r.keep.join(", ")) || "Nenhuma unidade do núcleo atual."}</p>${r.benchInstead.length ? `<p>Reservar, sem vender ainda: ${esc(r.benchInstead.join(", "))}.</p>` : ""}<div class="plan"><strong>Roll orientativo: nível ${r.roll.level}</strong><br>${r.roll.budget === null ? "Informe ouro para estimar um orçamento de reroll." : `Orçamento conservador: ${r.roll.budget} rolls (${r.roll.budget * 2}g), antes do custo de comprar unidades.`}<br>${r.roll.neededForTwoStar ? `Faltam ${r.roll.neededForTwoStar} cópias nominais para o carry 2★; teto disponível: ${r.roll.availableUpper}.` : "Carry já reúne cópias nominais para 2★; priorize o próximo upgrade."}<br><span class="muted">Se seu nível ainda não é o nível de roll, estabilize e prepare o avanço. Não gaste só para seguir a comp.</span></div></article>`,
    )
    .join("");
  if (recHTML !== lastRecHTML) {
    lastRecHTML = recHTML;
    $("recommendations").innerHTML = recHTML;
  }
  $("counters").innerHTML = d.counters
    .map(
      (c) =>
        `<div class="counter"><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p></div>`,
    )
    .join("");
  if (activeScreen === "pool") renderPool();
  $("rivals").innerHTML = d.opponents
    .map(
      (p) =>
        `<button type="button" class="rival" data-view="${esc(p.id)}"><div class="rival-title"><span>${esc(p.name)}</span><span class="good">${p.health} HP</span></div>${p.units.map(champTag).join("")}<p>Pressão estimada: ${p.pressure} · banco desconhecido</p></button>`,
    )
    .join("");
  $("warnings").innerHTML =
    m.warnings.map((w) => `<p>• ${esc(w)}</p>`).join("") +
    (d.unknown.length
      ? `<p class="bad">Campeões sem correspondência no catálogo: ${esc(d.unknown.join(", "))}</p>`
      : "");
  $("ownaugments").textContent = d.self.augments?.length
    ? "Registro do jogo: " +
      d.self.augments
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" · ")
    : "O registro atual não informou os aprimoramentos do Hero.";
  renderBench();
  if (activeScreen === "owneditems") renderOwnedItems(d.ownedItemAdvice);
  renderPlanner(d);
  const ag = d.augmentAdvice,
    pop = $("augmentpop");
  pop.hidden = !ag || ag.key === augmentDismissed;
  if (ag && !pop.hidden)
    pop.innerHTML = `<div class="augment-box"><div class="augment-head"><strong>Escolha de aprimoramento</strong><span class="muted">para ${esc(ag.comp)}</span><button id="augmentclose" class="ghost" data-key="${esc(ag.key)}">Fechar</button></div><div class="augment-cards">${ag.choices.map((c, i) => `<article class="augment-card ${c.id === ag.pick ? "pick" : ""}"><span class="augment-rank">${c.id === ag.pick ? "RECOMENDADO" : i + 1 + "ª opção"}</span><h3>${esc(c.name)}</h3><p class="muted">${esc(c.desc)}</p><ul>${c.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul><button data-chose="${esc(c.id)}" data-key="${esc(ag.key)}">Escolhi este</button>${c.reroll ? '<p class="augment-reroll">↻ Troque este card se ainda não trocou</p>' : ""}</article>`).join("")}</div><small class="muted">${esc(ag.note)}</small></div>`;
  const v = d.decision;
  $("decision").hidden = !v;
  if (v) {
    $("decision").className = "decision " + v.verdict;
    $("decision").innerHTML =
      `<div class="decision-head"><span class="decision-tag">${esc(v.label)}</span><strong>${esc(v.title)} · carry ${esc(v.carry)}</strong><span class="muted">mantém ${v.kept}/${v.current} · troca ${v.leaving}</span><button data-pick="${v.rank}">Usar esta rota</button></div><ul>${v.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul><small>${esc(v.note)}</small>`;
  }
}
async function update() {
  if (busy) {
    pendingUpdate = true;
    return;
  }
  busy = true;
  $("refresh").disabled = true;
  document.body.classList.add("is-loading");
  try {
    const m = await fetchJSON("/api/state");
    if (lastGame !== null && lastGame !== m.gameId) {
      chosenAugments = [];
      bench = [];
      inventory = [];
      goldManual = false;
      inventoryManual = false;
      $("gold").value = "";
      $("player").value = "";
      $("viewplayer").value = "";
    }
    lastGame = m.gameId;
    if ($("autolevel").checked && m.estimatedLevel)
      $("level").value = m.estimatedLevel;
    const sc = m.screen;
    if (!goldManual) $("gold").value = sc?.gold ?? "";
    $("goldsource").textContent = goldManual
      ? "informado por você"
      : sc?.gold != null
        ? "lido da tela" + (sc.xp ? " · XP " + sc.xp : "")
        : sc?.running
          ? sc.window === false
            ? "janela do jogo não visível"
            : (sc.error ?? "lendo a tela…")
          : "informado por você · leitura liga na partida";
    if ($("autolevel").checked && sc?.level != null) {
      $("level").value = sc.level;
      $("levelsource").dataset.screen = "1";
    } else delete $("levelsource").dataset.screen;
    if (
      Array.isArray(sc?.items) &&
      !inventoryManual &&
      JSON.stringify(sc.items) !== JSON.stringify(inventory)
    )
      inventory = [...sc.items];
    $("itemsource").textContent = inventoryManual
      ? "Itens livres informados por você. Limpe a lista para voltar à leitura da tela."
      : Array.isArray(sc?.items)
        ? "Itens livres lidos do banco na tela" +
          (sc.unknownItems
            ? " · " +
              sc.unknownItems +
              " não reconhecido(s): acrescente manualmente"
            : "") +
          "."
        : "Itens livres: informe manualmente; a leitura da tela liga durante a partida.";
    $("levelsource").textContent = !$("autolevel").checked
      ? "Nível informado manualmente"
      : m.screen?.level != null
        ? "Lido da tela do jogo"
        : "Estimado: unidades em campo; vagas extras/vazias alteram essa relação";
    $("levelview").textContent = $("level").value || "–";
    $("levelnote").textContent =
      sc?.level != null
        ? "lido da tela" + (sc.xp ? " · XP " + sc.xp : "")
        : "estimado pelo tabuleiro";
    $("goldview").textContent =
      $("gold").value !== "" ? $("gold").value + "g" : "–";
    $("goldnote").textContent = goldManual
      ? "informado por você"
      : sc?.gold != null
        ? "lido da tela"
        : sc?.running
          ? sc.window === false
            ? "janela do jogo não visível"
            : (sc.error ?? "lendo a tela…")
          : "leitura liga durante a partida";
    const local = m.players.find((p) => p.id === "47445859");
    if (!local)
      throw Error(
        "Hero não está neste snapshot; identidade local não foi trocada.",
      );
    $("player").innerHTML = optionRows([local]);
    $("player").value = local.id;
    const view = $("viewplayer").value;
    $("viewplayer").innerHTML =
      '<option value="">Escolha um adversário…</option>' +
      optionRows(m.players.filter((p) => p.id !== local.id));
    if (m.players.some((p) => p.id === view && p.id !== local.id))
      $("viewplayer").value = view;
    const previousBenchPlayer = $("benchplayer").value;
    $("benchplayer").innerHTML = optionRows(m.players);
    if (m.players.some((p) => p.id === previousBenchPlayer))
      $("benchplayer").value = previousBenchPlayer;
    const revision = suggestionRevision;
    const payload = {
      augments: chosenAugments,
      playerId: "47445859",
      viewedPlayerId: $("viewplayer").value,
      level: Number($("level").value),
      gold: $("gold").value === "" ? null : Number($("gold").value),
      bench,
      inventory,
      levelEstimated: $("autolevel").checked && sc?.level == null,
      targetLevel:
        $("targetlevel").value === "auto"
          ? "auto"
          : Number($("targetlevel").value),
      ...getPlannerOptions(),
    };
    const analysisKey = JSON.stringify({
      payload,
      source: m.modifiedAt,
      phase: m.phase,
      actionable: m.actionable,
      sameGame: m.sameGame,
      screen: {
        xp: sc?.xp,
        stage: sc?.stage,
        shop: sc?.shop,
        augments: sc?.augments,
        removers: sc?.removers,
      },
      refreshWindow: Math.floor(Date.now() / 30000),
    });
    if (
      data &&
      analysisKey === lastAnalysisKey &&
      !document.body.classList.contains("is-manual")
    ) {
      data.metadata = m;
      render();
      $("error").hidden = true;
      return;
    }
    const result = await fetchJSON("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (
      revision !== suggestionRevision ||
      String($("targetlevel").value) !== String(payload.targetLevel)
    ) {
      pendingUpdate = true;
      return;
    }
    data = result;
    lastAnalysisKey = analysisKey;
    render();
    $("targetview").textContent = "Nível " + result.targetLevel;
    $("targetnote").textContent =
      (result.targetLevelReasons ?? []).join(" ") +
      (result.chosenAugments?.length
        ? " Aprimoramentos: " +
          result.chosenAugments.map((a) => a.name).join(", ") +
          "."
        : "");
    document.body.classList.remove("is-booting");
    $("targetlevel").options[0].text = result.targetLevelAuto
      ? "Automático · nível " + result.targetLevel
      : "Automático";
    $("targetsource").textContent = result.targetLevelAuto
      ? result.targetLevelReasons.join(" ")
      : "escolhido por você; volte para Automático quando quiser";
    $("error").hidden = true;
    try {
      localStorage.setItem(
        "tft-helper-settings",
        JSON.stringify({
          playerId: payload.playerId,
          level: payload.level,
          gold: $("gold").value,
          autoLevel: $("autolevel").checked,
          targetLevel: $("targetlevel").value,
          targetAuto: $("targetlevel").value === "auto",
        }),
      );
    } catch {}
  } catch (e) {
    $("error").hidden = false;
    $("error").textContent = e.message;
    $("connection").textContent = "○ Leitura indisponível";
    $("connection").className = "status";
    $("freshness").className = "notice";
    $("freshness").textContent =
      "Atualização falhou. O conteúdo abaixo, se houver, é da última leitura bem-sucedida.";
    document.body.classList.remove("is-booting");
    document.body.classList.add("snapshot-only");
  } finally {
    busy = false;
    $("refresh").disabled = false;
    document.body.classList.remove("is-loading", "is-manual");
    if (pendingUpdate) {
      pendingUpdate = false;
      setTimeout(update, 80);
    }
  }
}
$("gold").addEventListener("input", () => {
  goldManual = $("gold").value !== "";
});
$("calibrate").onclick = async () => {
  const b = $("calibrate");
  b.disabled = true;
  b.textContent = "Capturando…";
  try {
    const r = await fetch("/api/screen-capture", { method: "POST" });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    b.textContent = "Captura salva ✓";
    $("goldsource").textContent =
      "captura " + d.width + "×" + d.height + " salva em tft/data";
  } catch (e) {
    b.textContent = "Falhou: " + e.message;
  } finally {
    b.disabled = false;
    setTimeout(() => {
      b.textContent = "Capturar tela p/ calibrar";
    }, 4000);
  }
};
$("augmentpop").onclick = (e) => {
  const pick = e.target.closest("[data-chose]");
  if (pick) {
    if (!chosenAugments.includes(pick.dataset.chose))
      chosenAugments.push(pick.dataset.chose);
    augmentDismissed = pick.dataset.key;
    $("augmentpop").hidden = true;
    void update();
    return;
  }
  const b = e.target.closest("#augmentclose");
  if (b) {
    augmentDismissed = b.dataset.key;
    $("augmentpop").hidden = true;
  }
};
$("refresh").onclick = () => {
  document.body.classList.add("is-manual");
  void update();
};
for (const id of ["viewplayer", "gold", "autolevel"]) $(id).onchange = update;
$("level").onchange = () => {
  $("autolevel").checked = false;
  update();
};
$("search").oninput = renderPool;
$("addbench").onclick = () => {
  const q = Number($("benchqty").value);
  if (!Number.isInteger(q) || q < 1 || q > 9) return;
  bench.push({
    playerId: $("benchplayer").value,
    championName: $("benchchamp").value,
    starLevel: Number($("benchstars").value),
    quantity: q,
  });
  update();
};
$("benchlist").onclick = (e) => {
  const i = e.target.dataset.remove;
  if (i !== undefined) {
    bench.splice(Number(i), 1);
    update();
  }
};
const menuButton = $("togglemenu");
try {
  document.body.classList.toggle(
    "sidebar-collapsed",
    localStorage.getItem("tft-helper-menu") !== "expanded",
  );
} catch {}
function syncMenu() {
  const compact = document.body.classList.contains("sidebar-collapsed");
  menuButton.setAttribute("aria-expanded", String(!compact));
  menuButton.setAttribute(
    "aria-label",
    compact ? "Expandir menu lateral" : "Recolher menu lateral",
  );
}
menuButton.onclick = () => {
  document.body.classList.toggle("sidebar-collapsed");
  syncMenu();
  try {
    localStorage.setItem(
      "tft-helper-menu",
      document.body.classList.contains("sidebar-collapsed")
        ? "collapsed"
        : "expanded",
    );
  } catch {}
};
syncMenu();
const navLinks = [...document.querySelectorAll("#sidebar .nav")];
const strategyPanel = $("strategy-sidebar"),
  strategyToggle = $("strategy-toggle"),
  strategyBackdrop = $("strategy-backdrop"),
  compactStrategy = matchMedia("(max-width: 1180px)");
let strategyReturnFocus = null;
function closeStrategy(restoreFocus = true) {
  const wasOpen = document.body.classList.contains("strategy-open");
  document.body.classList.remove("strategy-open");
  strategyToggle.setAttribute("aria-expanded", "false");
  strategyBackdrop.hidden = true;
  strategyPanel.removeAttribute("aria-modal");
  strategyPanel.removeAttribute("role");
  if (wasOpen && restoreFocus)
    strategyReturnFocus?.focus({ preventScroll: true });
}
function openStrategy() {
  if (!compactStrategy.matches) return;
  strategyReturnFocus = document.activeElement;
  document.body.classList.add("strategy-open");
  strategyToggle.setAttribute("aria-expanded", "true");
  strategyBackdrop.hidden = false;
  strategyPanel.setAttribute("role", "dialog");
  strategyPanel.setAttribute("aria-modal", "true");
  $("strategy-close").focus();
}
strategyToggle.addEventListener("click", openStrategy);
$("strategy-close").addEventListener("click", () => closeStrategy());
strategyBackdrop.addEventListener("click", () => closeStrategy());
compactStrategy.addEventListener("change", () => closeStrategy(false));
document.addEventListener("keydown", (event) => {
  if (!document.body.classList.contains("strategy-open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeStrategy();
  }
  if (event.key !== "Tab") return;
  const focusable = [
    ...strategyPanel.querySelectorAll(
      "button, a[href], input, select, summary, [tabindex='0']",
    ),
  ].filter((element) => element.getClientRects().length && !element.disabled);
  const first = focusable[0],
    last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});
document.addEventListener("compass:inspect", (event) => {
  location.hash = "planner";
  showScreen("planner");
  if (inspectPlannerChampion(event.detail.championId, event.detail.source)) {
    $("inspector").tabIndex = -1;
    $("inspector").focus({ preventScroll: true });
    $("inspector").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
});
function highlightNav(id) {
  for (const link of navLinks) {
    const active = link.hash === "#" + id;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
// Telas: cada item do menu mostra um grupo de seções centralizado, em vez de uma única página longa.
const SCREEN_OF = {
  live: "live",
  planner: "planner",
  paths: "paths",
  gameplan: "paths",
  owneditems: "owneditems",
  augmentpanel: "owneditems",
  ownboard: "scouting",
  scouting: "scouting",
  opponents: "opponents",
  manualbench: "scouting",
  pool: "pool",
};
for (const el of document.querySelector("main").children) {
  if (
    el.matches(
      "header,.controls,.summary,#error,#freshness,#decision,#actionnow,#compchanged",
    )
  )
    continue;
  el.dataset.screen = SCREEN_OF[el.id] ?? "pool";
}
function showScreen(screen, target) {
  activeScreen = screen;
  for (const el of document.querySelectorAll("main>[data-screen]"))
    el.classList.toggle("on", el.dataset.screen === screen);
  highlightNav(screen);
  document.body.dataset.screen = screen;
  closeStrategy(false);
  if (data) {
    if (screen === "pool") renderPool();
    if (screen === "owneditems") renderOwnedItems(data.ownedItemAdvice);
  }
  if (target && target.id !== screen) {
    if (target.tagName === "DETAILS") target.open = true;
    target.scrollIntoView({ block: "start" });
  } else scrollTo({ top: 0 });
}
function route() {
  const id = location.hash.slice(1),
    target = id ? document.getElementById(id) : null,
    owner = target?.closest("main>[data-screen]");
  showScreen(owner?.dataset.screen ?? "live", owner ? target : null);
  const heading = (owner ?? $("live"))?.querySelector("h2");
  if (heading && document.activeElement?.closest("#sidebar")) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
addEventListener("hashchange", route);
route();
try {
  const r = await fetch("/api/catalog");
  const d = await r.json();
  catalog = d.champions;
  initPlanner(d, update);
  $("freeitem").innerHTML = d.items
    .filter(
      (i) =>
        i.id.startsWith("DA_Component_") ||
        (i.id.startsWith("DA_") &&
          i.composition.length === 2 &&
          !/Radiant|Emblem/.test(i.id)),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`)
    .join("");
  $("benchchamp").innerHTML = catalog
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (c) =>
        `<option value="${esc(c.id)}">${esc(c.name)} · ${c.cost}g</option>`,
    )
    .join("");
  await update();
  connectCapture();
  setInterval(() => {
    if (!document.hidden) void update();
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void update();
  });
} catch (e) {
  $("error").hidden = false;
  $("error").textContent = e.message;
}

function connectCapture() {
  const stream = new EventSource("/api/events");
  stream.onmessage = (e) => {
    try {
      const snapshot = JSON.parse(e.data);
      if (!$("autoscoute").checked) return;
      $("capturestatus").textContent =
        "Captura automática · fonte " +
        new Date(snapshot.sourceAt).toLocaleTimeString("pt-BR") +
        " · " +
        snapshot.players.length +
        " jogadores · espera somente o jogo publicar novos dados";
      // A single recommendation response feeds every panel; SSE only invalidates it.
      if (!document.hidden) void update();
    } catch (err) {
      $("capturestatus").textContent = "Captura: " + err.message;
    }
  };
  stream.onerror = () => {
    $("capturestatus").textContent =
      "Reconectando captura; leitura periódica continua ativa.";
  };
  $("rivals").addEventListener("click", (e) => {
    const card = e.target.closest("[data-view]");
    if (card) {
      $("viewplayer").value = card.dataset.view;
      void update();
    }
  });
}

for (const id of ["recommendations", "decision"])
  $(id).addEventListener("click", (e) => {
    const button = e.target.closest("[data-pick]");
    if (button) {
      $("planselect").value = button.dataset.pick;
      $("planselect").dispatchEvent(new Event("change"));
      location.hash = "planner";
      showScreen("planner");
    }
  });

function renderOwnedItems(a) {
  if (!a) return;
  $("freeitems").innerHTML =
    a.inventory
      .map(
        (i, n) =>
          '<button data-free-remove="' +
          n +
          '">' +
          itemTag(i.id) +
          " ×</button>",
      )
      .join("") || '<p class="muted">Itens livres ainda não informados.</p>';
  $("itemadvice").innerHTML =
    (a.synergyTips?.length
      ? '<div class="counter"><h3>Sinergias a um passo</h3><div class="synergy-tips">' +
        synergyTipsHTML(a.synergyTips) +
        "</div></div>"
      : "") +
    '<div class="counter"><h3>Montar ou equipar agora</h3>' +
    a.ready
      .map(
        (c) =>
          "<p>" +
          champTag({ id: c.championId, name: c.champion, stars: c.stars }) +
          " ← " +
          itemTag(c.item.id) +
          "<br>" +
          esc(c.item.reason) +
          "</p>",
      )
      .join("") +
    (a.ready.length
      ? ""
      : "<p>Sem combinação confirmada com os itens livres informados.</p>") +
    '</div><div class="counter"><h3>Falta um componente</h3>' +
    a.near
      .map(
        (c) =>
          "<p>" +
          esc(c.champion) +
          " · " +
          itemTag(c.item.id) +
          "<br>Buscar: " +
          c.missing.map(itemTag).join("") +
          "</p>",
      )
      .join("") +
    '</div><div class="counter"><h3>Preservar investimento</h3><p>' +
    esc(a.source) +
    "</p><p>Não usa o mesmo componente em duas sugestões de montagem imediata. Confira seus itens antes de equipar.</p></div>";
  $("currentbuilds").innerHTML = a.builds
    .map(
      (b) =>
        '<article class="path"><h3>' +
        icon(b.championId, b.name) +
        " " +
        esc(b.name) +
        " " +
        b.stars +
        "★</h3><p>Equipado: " +
        (b.equipped.map((i) => itemTag(i.id)).join("") || "Sem itens") +
        "</p><p>" +
        b.slotsFree +
        " slots livres · fonte: " +
        esc(b.source ?? "") +
        '</p><div class="trait-ribbon">' +
        synergyChips(b.synergies) +
        "</div>" +
        (b.synergyItem
          ? '<p class="good">Emblema montável: ' +
            itemTag(b.synergyItem.id) +
            " fecha " +
            esc(b.synergyItem.trait) +
            " " +
            b.synergyItem.to +
            ".</p>"
          : "") +
        "<h4>Próximos itens recomendados</h4>" +
        b.additions
          .map(
            (i) =>
              '<div class="recipe">' +
              itemTag(i.id) +
              "<p>" +
              esc(i.reason) +
              '</p><p class="good">' +
              esc(i.inventoryNote) +
              (i.missing?.length
                ? " · Falta: " + i.missing.map((c) => esc(c.name)).join(", ")
                : "") +
              "</p>" +
              i.components.map((c) => itemTag(c.id)).join(" + ") +
              "</div>",
          )
          .join("") +
        "<small>" +
        esc(b.note) +
        "</small></article>",
    )
    .join("");
}
$("addfreeitem").onclick = () => {
  if (inventory.length < 60 && $("freeitem").value) {
    inventoryManual = true;
    inventory.push($("freeitem").value);
    void update();
  }
};
$("clearfreeitems").onclick = () => {
  inventoryManual = false;
  inventory = [];
  void update();
};
$("freeitems").onclick = (e) => {
  const button = e.target.closest("[data-free-remove]");
  if (button) {
    inventoryManual = true;
    inventory.splice(Number(button.dataset.freeRemove), 1);
    void update();
  }
};

function seekNewComps() {
  suggestionRevision++;
  void update();
}
$("targetlevel").onchange = seekNewComps;
