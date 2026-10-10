import {
  analysisKey,
  loadCatalog,
  loadComps,
  loadHistory,
  loadItems,
  loadRecommendation,
  loadState,
  recommendPayload,
  subscribe,
} from "./api.js";
import { flip, publishMotion, reducedMotion } from "./dom.js";
import { goalStore, matchKeyOf, swapStore } from "./comps.js";
import { buildModel } from "./model.js";
import { bankReading } from "./items.js";
import { equippedBy } from "./comp-items.js";
import { setCatalog } from "./ui/glyphs.js";
import { mountBoard } from "./ui/board.js";
import { mountComps } from "./ui/comps.js";
import { mountHistory } from "./ui/history.js";
import { mountItems } from "./ui/items.js";
import { mountEnded } from "./ui/ended.js";
import { mountInventory } from "./ui/inventory.js";
import { mountChampItems } from "./ui/champ-items.js";
import { mountContest } from "./ui/contest.js";
import { mountHud } from "./ui/hud.js";
import { mountPanel } from "./ui/panel.js";
import { mountSteps } from "./ui/steps.js";
import { mountSubs } from "./ui/subs.js";
import { mountAugs } from "./ui/augs.js";
import { mountPlan } from "./ui/plan.js";
import { planView } from "./plan.js";
import { augStore } from "./augs.js";

const $ = (id) => document.getElementById(id);
const app = $("app"),
  notice = $("notice");

publishMotion();
reducedMotion.addEventListener("change", () => publishMotion());
// Imagem que não carrega: remove-a e deixa as iniciais (o retrato guarda data-i). Dentro de um texto rico
// (`.rt`), o marcador vira o nome em texto, para a frase nunca perder o nome.
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement && e.target.closest(".pt")) {
      e.target.closest(".rt")?.classList.add("is-text");
      e.target.remove();
    }
  },
  true,
);

const hud = mountHud($("hud")),
  board = mountBoard($("board"), $("traits"), {
    onSelect(id) {
      selectedCell = id;
      drawChampItems();
    },
  }),
  steps = mountSteps($("steps")),
  itemSteps = mountSteps($("steps-items")),
  panel = mountPanel($("panel")),
  // Plano em andamento: o que já foi conquistado e o que falta, guardado pelo servidor entre as rodadas.
  planSec = mountPlan($("plan-sec")),
  historyView = mountHistory($("history")),
  itemsView = mountItems($("items")),
  endedView = mountEnded($("ended")),
  inventory = mountInventory($("inventory")),
  champItems = mountChampItems($("champ-items"), {
    onClose() {
      selectedCell = null;
      board.clear();
      drawChampItems();
    },
  }),
  // Aprimoramentos marcados por partida: entram na análise (sinergias favorecidas) e na ordem das ofertas.
  augs = mountAugs($("augs-sec"), {
    onChoose(id) {
      if (replayOf()) return; // partida revista: só leitura
      const name = last?.rec?.augmentAdvice?.choices?.find(
        (c) => c.id === id,
      )?.name;
      augPicks.add(
        matchKeyOf(latestState),
        id,
        latestState?.screen?.stage ?? null,
        name,
      );
      lastKey = "";
      void refresh();
    },
    onRemove(id) {
      if (replayOf()) return;
      augPicks.remove(matchKeyOf(latestState), id);
      lastKey = "";
      void refresh();
    },
  }),
  subs = mountSubs($("subs-sec"), $("subs"), {
    // Trocar uma peça: na comp fixada entra nas trocas dela; no automático vale para a comp sugerida sem fixá-la.
    onUse(out, into) {
      if (replayOf()) return; // não grava trocas da partida revista na partida ao vivo
      const key = matchKeyOf(latestState),
        goal = goals.get(key),
        id = goal?.id ?? last?.rec?.recommendations?.[0]?.meta?.id;
      if (!id) return;
      // Trocar uma peça que já entrou por substituição refaz a troca a partir da peça original da comp.
      const current = goal ? goal.swaps : autoSwaps.get(key, id),
        prior = current.find((s) => s.in === out),
        origin = prior?.out ?? out,
        swaps = current.filter((s) => s !== prior && s.out !== origin),
        next = into === origin ? swaps : [...swaps, { out: origin, in: into }];
      if (goal) goals.set(key, id, next);
      else autoSwaps.set(key, id, next);
      lastKey = "";
      void refresh();
    },
    onUndo(out) {
      if (replayOf()) return;
      const key = matchKeyOf(latestState),
        goal = goals.get(key),
        id = goal?.id ?? last?.rec?.recommendations?.[0]?.meta?.id;
      if (!id) return;
      if (goal)
        goals.set(
          key,
          id,
          goal.swaps.filter((s) => s.out !== out),
        );
      else
        autoSwaps.set(
          key,
          id,
          autoSwaps.get(key, id).filter((s) => s.out !== out),
        );
      lastKey = "";
      void refresh();
    },
  }),
  contest = mountContest($("contest")),
  compsView = mountComps($("comps"), {
    onPick(id) {
      goals.set(matchKeyOf(latestState), id);
      lastKey = "";
      location.hash = ""; // a escolha vale para o Ao vivo: volta para ele
      void refresh();
    },
    onRelease() {
      goals.clear();
      lastKey = "";
      drawComps();
      void refresh();
    },
  });
// Comp fixada e aprimoramentos, por partida; sem localStorage (bloqueado), valem só com a página aberta.
const memory = new Map(),
  storage = (() => {
    try {
      return localStorage;
    } catch {
      return {
        getItem: (k) => memory.get(k) ?? null,
        setItem: (k, v) => memory.set(k, v),
        removeItem: (k) => memory.delete(k),
      };
    }
  })(),
  goals = goalStore(storage),
  autoSwaps = swapStore(storage),
  augPicks = augStore(storage);

function showNotice(kind, text) {
  notice.hidden = !text;
  notice.dataset.kind = kind ?? "";
  notice.textContent = text ?? "";
}

const emblemsOf = (rec) =>
  (rec?.preview ?? rec?.recommendations?.[0])?.emblems ?? [];
const placeText = (p) => (p >= 1 ? `${p}º lugar` : "colocação não observada");

function render(model) {
  const { status } = model;
  // Partida encerrada: o resultado substitui as ações da partida que acabou até a próxima começar.
  app.dataset.state = status.replay
    ? "ready"
    : status.waiting
      ? "waiting"
      : status.ended
        ? "ended"
        : model.plan
          ? "ready"
          : "empty";
  const lastMatch = status.lastMatch;
  $("waiting-last").textContent =
    status.waiting && lastMatch
      ? `Partida anterior: ${placeText(lastMatch.placement)}.`
      : "";
  endedView.update({ status, rec: last?.rec });
  flip($("stage"), () => {
    hud.update(model);
    board.update(model.plan);
    const all = model.plan?.steps ?? [];
    steps.update(all.filter((s) => s.group === "now"));
    itemSteps.update(all.filter((s) => s.group === "items"));
    inventory.update(
      status.waiting ? null : last?.rec?.ownedItemAdvice,
      emblemsOf(last?.rec),
      // O banco vem direto da leitura da tela; a análise só acrescenta montar agora/falta um.
      status.waiting || status.replay ? null : bankReading(latestState?.screen),
    );
    lastModel = model;
    drawChampItems();
    panel.update(model.plan?.panel ?? null);
    planSec.update(
      status.waiting || status.replay || status.ended
        ? null
        : planView(last?.rec?.planProgress, status.live),
    );
    // Partida revista: só leitura; nada lê nem grava os dados da partida ao vivo.
    const replay = !!status.replay,
      chosen = status.waiting ? [] : (last?.rec?.chosenAugments ?? []);
    subs.update(
      replay ? { ...model.plan, compId: null } : model.plan,
      replay ? [] : status.swaps,
    );
    augs.update({
      advice: status.waiting ? null : last?.rec?.augmentAdvice,
      chosen,
      records: replay
        ? chosen.map((a) => ({ id: a.id, stage: null, name: a.name }))
        : augPicks.get(matchKeyOf(latestState)),
      stage: replay ? null : (latestState?.screen?.stage ?? null),
      live: replay ? false : status.live,
      readonly: replay,
    });
    const code = model.plan?.teamCode ?? null,
      copy = $("copy-code");
    copy.hidden = !code && !model.plan?.teamCodeError;
    copy.disabled = !code;
    copy.dataset.code = code ?? "";
    copy.title =
      !code && model.plan?.teamCodeError
        ? model.plan.teamCodeError
        : "Copiar o código da equipe para importar no planejador do jogo";
    const c = model.plan?.counts;
    $("counts").innerHTML = c
      ? `${c.ready ? `<span class="chip chip-go" title="trocas para fazer agora">⇄ ${c.ready}</span>` : ""}${c.hold ? `<span class="chip chip-amber" title="trocas para segurar (inclui 'não troque')">⏸ ${c.hold}</span>` : ""}`
      : "";
  });
  contest.update(
    status.waiting || (status.ended && !status.replay)
      ? null
      : last?.rec?.contest,
    {
      canSwitch: status.live,
    },
  );
  if (status.replay) {
    // Partida passada: mesma tela do Ao vivo com os tabuleiros finais; o link volta para a partida de agora.
    notice.hidden = false;
    notice.dataset.kind = "replay";
    notice.innerHTML = `Revendo partida · ${placeText(status.replay.placement)} · tabuleiros finais <a href="#">Voltar ao vivo</a>`;
  } else if (Date.now() - goalLostAt < 10000)
    showNotice(
      "warn",
      "A comp fixada saiu da lista de meta atualizada; voltando às sugestões automáticas.",
    );
  else if (status.waiting) showNotice("", "");
  else if (status.ended)
    showNotice(
      "result",
      status.placement
        ? `Partida encerrada · ${placeText(status.placement)}${status.placement <= 4 ? " · top 4" : ""}. Registrada no histórico.`
        : status.awaitingFinal
          ? "Partida encerrada para o Hero. Aguardando o tabuleiro final para registrar a colocação."
          : "Partida encerrada para o Hero.",
    );
  else if (status.sameGame === false)
    showNotice("warn", "Snapshot de outro jogo: não use como decisão ao vivo.");
  else if (!status.live)
    showNotice(
      "info",
      `Planejamento · leitura de há ${status.ageSeconds ?? "?"}s`,
    );
  else if (status.reader)
    showNotice("info", `Leitor de tela: ${status.reader}`);
  else showNotice("", "");
  liveTitle = `${model.plan?.panel?.action ? model.plan.panel.action + " · " : ""}TFT Compass`;
  setTitle();
}

// Copiar o código da equipe: confirma no próprio botão por 1,5 s.
$("copy-code").addEventListener("click", async (e) => {
  const b = e.currentTarget,
    label = b.querySelector("span");
  try {
    await navigator.clipboard.writeText(b.dataset.code);
    label.textContent = "Copiado";
  } catch {
    label.textContent = "Não copiou";
  }
  b.dataset.done = "1";
  setTimeout(() => {
    label.textContent = "Copiar código";
    delete b.dataset.done;
  }, 1500);
});

// Itens do campeão clicado na Formação.
let selectedCell = null,
  lastModel = null;
function drawChampItems() {
  const cell =
    lastModel?.plan?.cells?.find((c) => c.id === selectedCell) ?? null;
  // Partida revista: o banco de agora não vale para ela.
  champItems.update(cell, replayOf() ? [] : (latestState?.screen?.items ?? []));
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selectedCell) {
    selectedCell = null;
    board.clear();
    drawChampItems();
  }
});

/* ---------- Visões: Ao vivo, Comps e Histórico ---------- */
let liveTitle = "TFT Compass",
  goalLostAt = 0,
  historyStale = true,
  compsData = null,
  compsAt = 0;
const VIEWS = { "#historico": "history", "#comps": "comps", "#itens": "items" },
  TITLES = { history: "Histórico", comps: "Escolher comp", items: "Itens" };
// Tier de itens: muda só quando a cópia de meta é renovada no servidor; relê ao abrir, no máximo a cada 10 min.
let itemsAt = 0;
async function showItems() {
  if (Date.now() - itemsAt < 10 * 60 * 1000) return;
  try {
    itemsView.update(await loadItems());
    itemsAt = Date.now();
  } catch (e) {
    itemsView.error(e.message);
  }
}
const view = () => VIEWS[location.hash] ?? "live";
const setTitle = () =>
  (document.title = TITLES[view()]
    ? `${TITLES[view()]} · TFT Compass`
    : liveTitle);
function drawComps() {
  // Sem estado ainda, a chave seria "lobby" e apagaria a comp fixada da partida: espera o refresh().
  if (view() !== "comps" || !compsData || !latestState) return;
  const rec = last?.rec;
  compsView.update({
    comps: compsData.comps,
    source: [
      compsData.source?.trim(),
      compsData.fetchedAt &&
        `atualizada ${new Date(compsData.fetchedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
    ]
      .filter(Boolean)
      .join(" · "),
    ranking: rec?.compRanking ?? [],
    // Plano que o Ao vivo mostra (mesma escolha de model.js); pode ser um tabuleiro de vantagem fora da lista.
    autoTitle: (rec?.preview ?? rec?.recommendations?.[0])?.title ?? null,
    ownedIds: (rec?.self?.units ?? []).map((u) => u.championName),
    // Banco lido da tela (a análise do servidor não é necessária) e o que cada peça sua já leva equipado.
    bank: replayOf() ? null : (bankReading(latestState?.screen)?.items ?? null),
    equipped: replayOf() ? {} : equippedBy(rec?.self?.units),
    goalId: goals.get(matchKeyOf(latestState))?.id ?? null,
    swapCount: goals.get(matchKeyOf(latestState))?.swaps.length ?? 0,
    lobby: matchKeyOf(latestState) === "lobby",
  });
}
// A lista de meta muda no máximo a cada poucas horas no servidor: relê ao abrir a tela, no máximo a cada 10 min.
async function showComps() {
  if (!compsData || Date.now() - compsAt > 10 * 60 * 1000)
    try {
      compsData = await loadComps();
      compsAt = Date.now();
    } catch (e) {
      compsView.error(e.message);
      return;
    }
  drawComps();
}
async function showHistory() {
  try {
    historyView.update(await loadHistory());
    historyStale = false;
  } catch (e) {
    historyView.error(e.message);
  }
}
function route() {
  const v = view();
  app.dataset.view = v;
  $("history").hidden = v !== "history";
  $("comps").hidden = v !== "comps";
  $("items").hidden = v !== "items";
  for (const a of document.querySelectorAll(".rail .nav"))
    if (a.dataset.view === v) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  setTitle();
  if (v === "history" && historyStale) void showHistory();
  if (v === "comps") void showComps();
  if (v === "items") void showItems();
}
addEventListener("hashchange", route);
const replayOf = () => /^#partida\/(\d+)$/.exec(location.hash)?.[1] ?? null;
// Entrar ou sair de uma partida revista troca o que o Ao vivo mostra: recarrega na hora.
addEventListener("hashchange", () => {
  if (view() !== "live") return;
  lastKey = "";
  void refresh();
});

/* ---------- Ciclo de atualização ---------- */
let busy = false,
  pending = false,
  lastKey = "",
  last = null,
  latestState = null,
  matchId; // partida exibida; quando muda, nada da anterior é reaproveitado

async function refresh() {
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  document.body.classList.add("is-loading");
  try {
    const state = await loadState(),
      id = state.match?.id ?? state.gameId ?? null;
    latestState = state;
    // Rever partida passada (#partida/<id>): análise do estado final reconstruído pelo servidor.
    const replay = replayOf();
    if (replay) {
      let rec = last?.replay === replay ? last.rec : null;
      if (!rec)
        rec = await loadRecommendation({
          ...recommendPayload({ ...state, screen: {} }, null, []),
          replayGameId: replay,
        });
      lastKey = "";
      last = { state: { ...rec.metadata, screen: {} }, rec, replay };
      const model = buildModel(last);
      model.status.replay = {
        gameId: replay,
        placement: rec.metadata.match?.placement ?? null,
      };
      render(model);
      return;
    }
    if (last?.replay) last = null;
    if (id !== matchId) {
      matchId = id;
      last = null;
      lastKey = "";
      historyStale = true;
      if (view() === "history") void showHistory();
    }
    // Partida nova sem tabuleiro próprio ainda: o arquivo é da anterior e não serve para decidir nada.
    if (state.match?.status === "live" && state.match.boardReady === false) {
      render(
        buildModel({ state: { ...state, estimatedLevel: null }, rec: null }),
      );
      drawComps();
      return;
    }
    if (!state.players?.some((p) => p.id === state.localPlayerId))
      throw new Error(
        "Hero não está neste snapshot; identidade local não foi trocada.",
      );
    const goal = goals.get(matchKeyOf(state)),
      payload = {
        ...recommendPayload(
          state,
          goal,
          augPicks.get(matchKeyOf(state)),
          autoSwaps.all(matchKeyOf(state)),
        ),
        // Registro desta partida na tela: lista vazia apaga o que o servidor guardou (remoção explícita).
        augmentsKnown: augPicks.has(matchKeyOf(state)),
      },
      key = analysisKey(state, payload);
    let rec = last?.rec;
    if (key !== lastKey || !rec) {
      // A análise pode levar segundos: o banco lido da tela já aparece, sem esperá-la.
      inventory.update(
        rec?.ownedItemAdvice,
        emblemsOf(rec),
        bankReading(state.screen),
      );
      rec = await loadRecommendation(payload);
      lastKey = key;
    } else {
      const { ageSeconds, actionable, phase, sameGame } = state;
      rec = {
        ...rec,
        metadata: { ...rec.metadata, ageSeconds, actionable, phase, sameGame },
      };
    }
    last = { state, rec };
    render(buildModel(last));
    if (notice.dataset.kind === "error") showNotice("", "");
    if (goal && rec.goal?.found === false) {
      // A lista de meta foi atualizada e a comp fixada saiu dela: volta às sugestões e avisa.
      goals.clear();
      goalLostAt = Date.now();
      lastKey = "";
      pending = true;
    }
    drawComps();
  } catch (e) {
    showNotice("error", e.message);
    if (!last) app.dataset.state = "error";
  } finally {
    busy = false;
    document.body.classList.remove("is-loading");
    if (pending) {
      pending = false;
      setTimeout(refresh, 80);
    }
  }
}

try {
  setCatalog(await loadCatalog());
} catch (e) {
  showNotice("error", e.message);
}
route(); // depois do catálogo: o histórico usa retratos e sinergias
await refresh();
setInterval(() => !document.hidden && refresh(), 5000);
document.addEventListener(
  "visibilitychange",
  () => !document.hidden && refresh(),
);
let tick = 0;
subscribe((event) => {
  if (event?.type === "meta") {
    // Nova cópia das comps de meta no servidor: relê a lista e pede uma análise nova.
    compsAt = 0;
    itemsAt = 0;
    lastKey = "";
    if (view() === "comps") void showComps();
    if (view() === "items") void showItems();
  }
  if (event?.type === "match") {
    historyStale = true;
    if (view() === "history") void showHistory();
  }
  clearTimeout(tick);
  tick = setTimeout(() => !document.hidden && refresh(), 200);
});
