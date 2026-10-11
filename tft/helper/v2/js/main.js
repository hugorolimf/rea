import {
  analysisKey,
  decisionsOf,
  loadCatalog,
  loadComps,
  loadHistory,
  loadItems,
  loadRecommendation,
  loadState,
  recommendPayload,
  subscribe,
} from "./api.js";
import { connectionView, retryDelay } from "./connection.js";
import { createLiveLoop } from "./live-loop.js";
import { flip, publishMotion, reducedMotion } from "./dom.js";
import { focusView } from "./focus.js";
import { goalStore, matchKeyOf, swapStore } from "./comps.js";
import { buildModel } from "./model.js";
import { rosterOf } from "./roster.js";
import { createPrefs, safeStorage } from "./prefs.js";
import { canRegister, registerServiceWorker } from "./pwa.js";
import { documentTitle, hashFor, parseHash } from "./router.js";
import { wispsView } from "./wisps.js";
import { bankReading } from "./items.js";
import { metaNote } from "./meta-freshness.js";
import { equippedBy } from "./comp-items.js";
import { getCatalog, setCatalog } from "./ui/glyphs.js";
import { mountBoard } from "./ui/board.js";
import { mountComps } from "./ui/comps.js";
import { mountCompModal } from "./ui/comp-modal.js";
import { mountHistory } from "./ui/history.js";
import { mountItems } from "./ui/items.js";
import { mountEnded } from "./ui/ended.js";
import { mountInventory } from "./ui/inventory.js";
import { mountChampItems } from "./ui/champ-items.js";
import { mountContest } from "./ui/contest.js";
import { mountFocusBar } from "./ui/focus-bar.js";
import { mountHud } from "./ui/hud.js";
import { mountPanel } from "./ui/panel.js";
import { mountShell } from "./ui/shell.js";
import { mountSteps } from "./ui/steps.js";
import { mountSubs } from "./ui/subs.js";
import { mountAugs } from "./ui/augs.js";
import { mountPlan } from "./ui/plan.js";
import { mountTooltips } from "./ui/tooltip.js";
import { planView } from "./plan.js";
import { augLabel, augStore } from "./augs.js";

const $ = (id) => document.getElementById(id);
const app = $("app"),
  notice = $("notice");

// Armazenamento que nunca lança (localStorage bloqueado vira memória) e as preferências do app (tema, movimento...).
const storage = safeStorage(),
  prefs = createPrefs(storage);

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

/* ---------- Casca: navegação, tema, conexão, atalhos, dicas ---------- */
const shell = mountShell({
  prefs,
  persistent: storage.persistent,
  goTo: (view) => (location.hash = hashFor(view)),
  onMeta: (trigger) => void openGoalModal(trigger),
});
mountTooltips();
const focusBar = mountFocusBar($("focus"));

const hud = mountHud($("hud"), { onOpenGoal: openGoalModal }),
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
  // Aprimoramentos: oferta e escolhidos vêm do jogo (GEP, lido pelo servidor). Desmarcar só corrige uma leitura errada.
  augs = mountAugs($("augs-sec"), {
    onRemove(id) {
      if (replayOf()) return;
      seedManualPicks(); // corrigir uma escolha do GEP mantém as demais
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
    // A escolha vale para o Ao vivo: volta para ele.
    onPick: (id) => pickComp(id, { leave: true }),
    onRelease: releaseComp,
  }),
  // Modal da célula "Meta" do HUD: vê a comp sugerida (e as outras sugestões) e a escolhe pelo mesmo caminho da aba Comps.
  compModal = mountCompModal({ onPick: pickComp, onRelease: releaseComp });
// Comp fixada e aprimoramentos, por partida (em `storage`: sem localStorage valem só com a página aberta).
const goals = goalStore(storage),
  autoSwaps = swapStore(storage),
  augPicks = augStore(storage);

// Aprimoramentos escolhidos: o servidor lê os do GEP (chosenAugments com source "gep"); o registro manual da partida,
// se existe (mesmo vazio), prevalece e é o único que o servidor recebe como decisão do usuário.
function gepPicks() {
  const analysed = (last?.rec?.chosenAugments ?? []).filter(
      (a) => a.source === "gep",
    ),
    names = new Map(analysed.map((a) => [a.id, a.name])),
    // Os do estado lido agora (GEP) aparecem já, sem esperar a análise; o nome vem dela ou do id do GEP.
    read = latestState?.seen?.pickedAugments ?? [];
  return read.length
    ? read.map((p) => ({
        id: p.id,
        stage: p.stage ?? null,
        name: names.get(p.id) ?? augLabel(p.id),
      }))
    : analysed.map((a) => ({
        id: a.id,
        stage: a.stage ?? null,
        name: a.name ?? null,
      }));
}
function augRecords() {
  const key = matchKeyOf(latestState);
  return augPicks.has(key) ? augPicks.get(key) : gepPicks();
}
/** Antes de editar à mão, copia as escolhas do GEP para o registro manual: a edição vale sobre elas. */
function seedManualPicks() {
  const key = matchKeyOf(latestState);
  if (augPicks.has(key)) return;
  for (const p of gepPicks()) augPicks.add(key, p.id, p.stage, p.name);
}

function showNotice(kind, text) {
  notice.hidden = !text;
  notice.dataset.kind = kind ?? "";
  notice.textContent = text ?? "";
}

const emblemsOf = (rec) =>
  (rec?.preview ?? rec?.recommendations?.[0])?.emblems ?? [];
const placeText = (p) => (p >= 1 ? `${p}º lugar` : "colocação não observada");

/* ---------- Conexão com o servidor e idade do dado ---------- */
// `okAt`: última leitura de /api/state que deu certo; `failures`: leituras seguidas sem resposta (recuo do laço);
// `sse`: estado do fluxo de avisos; `ageSeconds`: idade do dado que o servidor informou nessa leitura.
const net = {
  okAt: null,
  failures: 0,
  error: null,
  sse: "unknown",
  ageSeconds: null,
  live: false,
  nextAt: null,
  // A aba acabou de voltar de segundo plano e a leitura de agora ainda não chegou (a barra mostra de quando é a tela).
  resumed: false,
};
function drawConnection() {
  shell.setConnection(
    connectionView({
      now: Date.now(),
      okAt: net.okAt,
      failures: net.failures,
      error: net.error,
      networkOnline: navigator.onLine,
      sse: net.sse,
      ageSeconds: net.ageSeconds,
      live: net.live,
      retryInMs: net.nextAt ? Math.max(0, net.nextAt - Date.now()) : null,
      resumed: net.resumed,
    }),
  );
}
// Só o relógio da barra (idade do dado); a leitura em si não depende deste intervalo.
setInterval(() => !document.hidden && drawConnection(), 2000);
addEventListener("online", () => {
  drawConnection();
  void refresh();
});
addEventListener("offline", drawConnection);

/* ---------- Foco agora: aviso educado para leitor de tela quando a decisão urgente muda ---------- */
let focusSig = null,
  endedText = null; // último resultado de partida anunciado
function announceFocus(view) {
  const urgent = (view?.items ?? []).filter(
    (i) => ["shop", "level", "roll"].includes(i.id) && i.tone !== "wait",
  );
  const sig = urgent.map((i) => `${i.id}:${i.label}:${i.detail}`).join("|");
  if (sig === focusSig) return;
  const first = focusSig === null;
  focusSig = sig;
  if (!first && urgent.length)
    shell.announce(
      `Agora: ${urgent.map((i) => `${i.label}, ${i.detail}`).join(". ")}`,
    );
}

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
  net.live = !!status.live;
  const lastMatch = status.lastMatch;
  $("waiting-last").textContent =
    status.waiting && lastMatch
      ? `Partida anterior: ${placeText(lastMatch.placement)}.`
      : "";
  endedView.update({ status, rec: last?.rec });
  const focus = status.replay ? null : focusView(model);
  focusBar.update(focus);
  announceFocus(focus);
  flip($("stage"), () => {
    hud.update(model);
    board.update(model.plan);
    const all = model.plan?.steps ?? [];
    steps.update(all.filter((s) => s.group === "now"));
    itemSteps.update(all.filter((s) => s.group === "items"));
    inventory.update(
      status.waiting ? null : last?.rec?.ownedItemAdvice,
      emblemsOf(last?.rec),
      // O banco vem direto do estado (GEP); a análise só acrescenta montar agora/falta um.
      status.waiting || status.replay ? null : bankReading(latestState?.seen),
    );
    lastModel = model;
    if (status.replay) compModal.close();
    else drawCompModal();
    drawChampItems();
    // Wisps (fogos-fátuos) da loja: só ao vivo; o painel os marca e recomenda, o motor nunca os lê como campeões.
    panel.update(
      model.plan?.panel ?? null,
      status.replay || status.ended || status.waiting
        ? []
        : wispsView(latestState?.seen, {
            catalog: getCatalog(),
            hero: model.hero,
            rec: last?.rec,
            roll: model.plan?.panel?.roll,
          }),
    );
    planSec.update(
      status.waiting || status.replay || status.ended
        ? null
        : planView(last?.rec?.planProgress, status.live, model.roster ?? null),
    );
    // Partida revista: só leitura; nada lê nem grava os dados da partida ao vivo.
    const replay = !!status.replay,
      chosen = status.waiting ? [] : (last?.rec?.chosenAugments ?? []);
    subs.update(
      replay ? { ...model.plan, compId: null } : model.plan,
      replay ? [] : status.swaps,
    );
    augs.update({
      // Oferta aberta e fonte dos aprimoramentos: do estado lido agora (GEP), não da análise.
      seen: replay || status.waiting ? null : (latestState?.seen ?? null),
      advice: status.waiting ? null : last?.rec?.augmentAdvice,
      chosen,
      records: replay
        ? chosen.map((a) => ({ id: a.id, stage: null, name: a.name }))
        : augRecords(),
      stage: replay ? null : (latestState?.seen?.stage ?? null),
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
    notice.innerHTML = `Revendo partida · ${placeText(status.replay.placement)} · tabuleiros finais <a href="${hashFor("live")}">Voltar ao vivo</a>`;
  } else if (Date.now() - goalLostAt < 10000)
    showNotice(
      "warn",
      "A comp fixada saiu da lista de meta atualizada; voltando às sugestões automáticas.",
    );
  else if (status.waiting) showNotice("", "");
  else if (status.ended) {
    const text = status.placement
      ? `Partida encerrada · ${placeText(status.placement)}${status.placement <= 4 ? " · top 4" : ""}. Registrada no histórico.`
      : status.awaitingFinal
        ? "Partida encerrada para o Hero. Aguardando o tabuleiro final para registrar a colocação."
        : "Partida encerrada para o Hero.";
    showNotice("result", text);
    // O cartão de resultado esconde a faixa de aviso: o leitor de tela ouve o resultado uma vez por mudança.
    if (text !== endedText) {
      endedText = text;
      shell.announce(text);
    }
  } else if (status.sameGame === false)
    showNotice("warn", "Snapshot de outro jogo: não use como decisão ao vivo.");
  else if (!status.live)
    showNotice(
      "info",
      `Planejamento · leitura de há ${status.ageSeconds ?? "?"}s`,
    );
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
    shell.announce("Código da equipe copiado");
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
  champItems.update(cell, replayOf() ? [] : (latestState?.seen?.items ?? []));
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selectedCell) {
    selectedCell = null;
    board.clear();
    drawChampItems();
  }
});

/* ---------- Telas: Ao vivo, Comps, Itens e Histórico (roteamento por hash, router.js) ---------- */
let liveTitle = "TFT Compass",
  goalLostAt = 0,
  historyStale = true,
  compsData = null,
  compsAt = 0;
// Cada tela é uma seção do palco; só a ativa aparece.
const VIEW_NODES = {
  live: "view-live",
  comps: "comps",
  items: "items",
  history: "history",
};
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
const view = () => parseHash(location.hash).view;
const replayOf = () => parseHash(location.hash).replay;
const setTitle = () => (document.title = documentTitle(view(), liveTitle));
// Dados dos cartões de comp (aba Comps e modal do HUD): as comps de meta, o encaixe da partida, o banco de itens lido e a
// comp fixada. `compsData` precisa estar carregado.
function compCardsData() {
  const rec = last?.rec;
  return {
    comps: compsData.comps,
    ranking: rec?.compRanking ?? [],
    // Suas peças em campo e na reserva (GEP), pela regra única de roster.js; partida revista: só o campo dela.
    roster: rosterOf({
      units: rec?.self?.units,
      seen: replayOf() ? null : latestState?.seen,
    }),
    // Banco de itens lido (a análise do servidor não é necessária) e o que cada peça sua já leva equipado.
    bank: replayOf() ? null : (bankReading(latestState?.seen)?.items ?? null),
    equipped: replayOf() ? {} : equippedBy(rec?.self?.units),
    goalId: goals.get(matchKeyOf(latestState))?.id ?? null,
    swapCount: goals.get(matchKeyOf(latestState))?.swaps.length ?? 0,
    lobby: matchKeyOf(latestState) === "lobby",
  };
}
function drawComps() {
  // Sem estado ainda, a chave seria "lobby" e apagaria a comp fixada da partida: espera o refresh().
  if (view() !== "comps" || !compsData || !latestState) return;
  const rec = last?.rec;
  compsView.update({
    ...compCardsData(),
    source: [
      compsData.source?.trim(),
      compsData.fetchedAt &&
        `atualizada ${new Date(compsData.fetchedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
      metaNote(compsData.freshness, compsData.fetchedAt)?.text,
    ]
      .filter(Boolean)
      .join(" · "),
    // Plano que o Ao vivo mostra (mesma escolha de model.js); pode ser um tabuleiro de vantagem fora da lista.
    autoTitle: (rec?.preview ?? rec?.recommendations?.[0])?.title ?? null,
  });
}
// A lista de meta muda no máximo a cada poucas horas no servidor: relê ao abrir a tela, no máximo a cada 10 min.
async function ensureComps() {
  if (!compsData || Date.now() - compsAt > 10 * 60 * 1000) {
    compsData = await loadComps();
    compsAt = Date.now();
  }
}
async function showComps() {
  try {
    await ensureComps();
  } catch (e) {
    compsView.error(e.message);
    return;
  }
  drawComps();
}

/* ---------- Modal da comp sugerida (célula "Meta" do HUD) ---------- */
// Escolher uma comp é sempre o mesmo ato: fixa o id na partida e refaz a análise (aba Comps e modal do HUD).
function pickComp(id, { leave = false } = {}) {
  if (replayOf()) return; // partida revista: a escolha valeria para a partida de agora
  goals.set(matchKeyOf(latestState), id);
  lastKey = "";
  if (leave) location.hash = hashFor("live"); // a escolha vale para o Ao vivo: volta para ele
  drawCompModal(); // o estado "escolhida" aparece já, sem esperar a análise
  void refresh();
}
function releaseComp() {
  goals.clear();
  lastKey = "";
  drawComps();
  drawCompModal();
  void refresh();
}
// A comp que o Ao vivo mostra (`planId`) e a fixada (`goalId`) orientam onde o modal abre e o que ele marca.
function compModalData() {
  return { ...compCardsData(), planId: lastModel?.plan?.compId ?? null };
}
// Só redesenha com o modal aberto (fechado, nada é calculado).
function drawCompModal() {
  if (compModal.isOpen && compsData && latestState)
    compModal.update(compModalData());
}
async function openGoalModal(trigger) {
  if (replayOf()) return;
  try {
    await ensureComps();
  } catch {
    location.hash = hashFor("comps"); // sem a lista de meta o modal não tem o que mostrar: a aba Comps mostra o erro
    return;
  }
  if (!latestState) return;
  compModal.update(compModalData());
  compModal.open(trigger);
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
  shell.setView(v);
  for (const [id, node] of Object.entries(VIEW_NODES))
    $(node).hidden = id !== v;
  setTitle();
  if (v === "history" && historyStale) void showHistory();
  if (v === "comps") void showComps();
  if (v === "items") void showItems();
}
addEventListener("hashchange", route);
// "Tentar de novo" dos estados de erro das telas (Comps, Itens, Histórico): cada tela pede a releitura pelo evento.
document.addEventListener("tft:retry", (e) => {
  const v = e.detail?.view;
  if (v === "comps") {
    compsAt = 0;
    void showComps();
  }
  if (v === "items") {
    itemsAt = 0;
    void showItems();
  }
  if (v === "history") {
    historyStale = true;
    void showHistory();
  }
});
// Entrar ou sair de uma partida revista troca o que o Ao vivo mostra: recarrega na hora.
addEventListener("hashchange", () => {
  if (view() !== "live") return;
  lastKey = "";
  void refresh();
});

/* ---------- Ciclo de atualização ---------- */
// Buscar e desenhar são separados (live-loop.js): a busca roda sempre, também com a aba oculta ou a janela minimizada,
// e o desenho pesado espera a aba voltar. Os eventos do servidor (SSE) são o gatilho principal; o temporizador de
// 5 s (com recuo em falha) é a reserva e é empurrado por qualquer busca, então SSE e temporizador não se somam.
const loop = createLiveLoop({
  pull,
  hidden: () => document.hidden,
  delay: () => retryDelay(net.failures),
  onSettled() {
    net.nextAt = loop.nextAt;
    net.resumed = false;
    drawConnection();
  },
});
/** Pede uma leitura agora (ação do usuário, troca de tela, evento); junta-se à que estiver em andamento. */
function refresh() {
  return loop.request();
}
let lastKey = "",
  last = null,
  latestState = null,
  catalogReady = false,
  matchId; // partida exibida; quando muda, nada da anterior é reaproveitado

// O catálogo (ícones, nomes, sinergias) é carregado uma vez; se o servidor estava parado na abertura, tenta de novo a cada leitura.
async function ensureCatalog() {
  if (catalogReady) return;
  setCatalog(await loadCatalog());
  catalogReady = true;
  lastKey = ""; // refaz o desenho com os retratos
}

// Uma leitura: GET /api/state e, se a chave de análise mudou, a análise. Atualiza o modelo sempre; o desenho vai por
// `loop.paint` (na hora com a aba visível; adiado até ela voltar com a aba oculta).
async function pull() {
  document.body.classList.add("is-loading");
  try {
    await ensureCatalog();
    const state = await loadState(),
      id = state.match?.id ?? state.gameId ?? null;
    latestState = state;
    net.okAt = Date.now();
    net.failures = 0;
    net.error = null;
    net.ageSeconds = Number.isFinite(state.ageSeconds)
      ? state.ageSeconds
      : null;
    // Rever partida passada (#partida/<id>): análise do estado final reconstruído pelo servidor.
    const replay = replayOf();
    if (replay) {
      let rec = last?.replay === replay ? last.rec : null;
      if (!rec)
        rec = await loadRecommendation({
          ...recommendPayload(
            { ...state, seen: {} },
            null,
            [],
            {},
            { replay: true },
          ),
          replayGameId: replay,
        });
      lastKey = "";
      last = { state: { ...rec.metadata, seen: {} }, rec, replay };
      const shown = last;
      loop.paint(() => {
        const model = buildModel(shown);
        model.status.replay = {
          gameId: replay,
          placement: rec.metadata.match?.placement ?? null,
        };
        render(model);
      });
      return;
    }
    if (last?.replay) last = null;
    if (id !== matchId) {
      matchId = id;
      last = null;
      lastKey = "";
      historyStale = true;
      focusSig = null;
      endedText = null;
      if (view() === "history") void showHistory();
    }
    // Partida nova sem tabuleiro próprio ainda: o arquivo é da anterior e não serve para decidir nada.
    if (state.match?.status === "live" && state.match.boardReady === false) {
      loop.paint(() => {
        render(
          buildModel({ state: { ...state, estimatedLevel: null }, rec: null }),
        );
        drawComps();
      });
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
      // A chave usa só as decisões (a mesma regra e o mesmo formato que o servidor usa para renovar a análise sozinho,
      // core/state/analysis-key.mjs).
      key = analysisKey(
        state,
        decisionsOf(
          state,
          goal,
          augPicks.get(matchKeyOf(state)),
          autoSwaps.all(matchKeyOf(state)),
          augPicks.has(matchKeyOf(state)),
        ),
      );
    let rec = last?.rec;
    if (key !== lastKey || !rec) {
      // A análise pode levar segundos: o banco de itens lido já aparece, sem esperá-la (só com a aba visível: oculta,
      // o desenho completo logo abaixo é que fica guardado para a volta).
      if (!document.hidden)
        inventory.update(
          rec?.ownedItemAdvice,
          emblemsOf(rec),
          bankReading(state.seen),
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
    if (notice.dataset.kind === "error") showNotice("", "");
    if (goal && rec.goal?.found === false) {
      // A lista de meta foi atualizada e a comp fixada saiu dela: volta às sugestões e avisa.
      goals.clear();
      goalLostAt = Date.now();
      lastKey = "";
      void refresh(); // com esta leitura em andamento, vira uma leitura de seguimento
    }
    const shown = last;
    loop.paint(() => {
      render(buildModel(shown));
      drawComps();
    });
  } catch (e) {
    if (e.analyzing) {
      // O servidor respondeu à sondagem de saúde: está no ar, só a análise passou do prazo. Não conta como falha de conexão.
      net.okAt ??= Date.now();
      net.failures = 0;
      net.error = null;
    } else if (e.network) {
      // Sem resposta do servidor: a tela guarda a última leitura e o recuo espaça as tentativas.
      net.failures += 1;
      net.error = e.message;
    } else {
      // O servidor respondeu (erro de análise, 4xx/5xx): está no ar, só esta leitura falhou.
      net.okAt ??= Date.now();
    }
    if (!last) {
      // Sem nenhuma leitura ainda: o bloco de erro da tela conta o que houve (a faixa de aviso repetiria o mesmo texto).
      app.dataset.state = "error";
      showNotice("", "");
      $("state-error-title").textContent = e.analyzing
        ? "Analisando a partida"
        : e.network
          ? "Sem resposta do servidor"
          : "Sem leitura do jogo";
      $("state-error-text").textContent = e.network
        ? `${e.message} Se o servidor está rodando, a análise continua nele; a tela volta sozinha quando ele responder.`
        : e.message;
    } else showNotice(e.analyzing ? "info" : "error", e.message);
  } finally {
    // A barra de conexão é redesenhada por `onSettled`, já com o horário da próxima tentativa.
    document.body.classList.remove("is-loading");
  }
}
$("btn-retry").addEventListener("click", () => {
  lastKey = "";
  void refresh();
});

// Laço de leitura (reserva do SSE): 5 s depois da última leitura com o servidor respondendo; com falhas, recua
// (5, 10, 20, 30 s) e volta ao normal no primeiro sucesso. Segue com a aba oculta; quem o agenda é `loop`.

// A aba voltou (visível de novo, descongelada ou restaurada do cache de navegação): desenha já o último dado que chegou
// em segundo plano e busca o atual. Se a última leitura é de alguns segundos atrás, a barra de conexão diz de quando é.
function resume() {
  if (document.hidden) return;
  net.resumed = true;
  loop.show();
  drawConnection();
  // `soft`: se uma leitura já está a caminho, a resposta dela serve (sem leitura repetida).
  void loop.request({ soft: true });
}

try {
  await ensureCatalog();
} catch (e) {
  showNotice("error", e.message);
  if (e.network) net.failures = 1;
}
route(); // depois do catálogo: o histórico usa retratos e sinergias
await refresh(); // ao terminar, agenda a leitura de reserva
document.addEventListener("visibilitychange", resume);
// Page Lifecycle: a aba congelada (economia de energia/memória do navegador) volta a rodar.
document.addEventListener("resume", resume);
addEventListener("pageshow", (e) => e.persisted && resume());
subscribe(
  (event) => {
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
    // Todo evento do servidor pede uma leitura, com a aba visível ou oculta (caminho principal; o laço é reserva).
    loop.kick();
  },
  (status) => {
    net.sse = status;
    drawConnection();
  },
);

// App instalável e offline: casca em cache; versão nova só entra quando o usuário aceita (nunca recarrega no meio da partida).
void registerServiceWorker({
  onUpdate(apply) {
    shell.toast("Nova versão do app disponível.", {
      ms: 0,
      action: { label: "Atualizar", run: apply },
    });
    shell.announce("Nova versão do app disponível");
  },
}).then((registration) =>
  shell.setAppInfo(
    registration
      ? "Modo offline ativo: a casca do app fica guardada neste navegador; as leituras do jogo precisam do servidor."
      : canRegister()
        ? "Modo offline indisponível: o registro do service worker falhou."
        : "Modo offline e instalação só funcionam em localhost ou https (ou fora do mock).",
  ),
);
