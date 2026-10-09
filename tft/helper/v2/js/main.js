import {
  analysisKey,
  loadCatalog,
  loadRecommendation,
  loadState,
  recommendPayload,
  subscribe,
} from "./api.js";
import { flip, publishMotion, reducedMotion } from "./dom.js";
import { buildModel } from "./model.js";
import { setCatalog } from "./ui/glyphs.js";
import { mountBoard } from "./ui/board.js";
import { mountHud } from "./ui/hud.js";
import { mountPanel } from "./ui/panel.js";
import { mountSteps } from "./ui/steps.js";

const $ = (id) => document.getElementById(id);
const app = $("app"),
  notice = $("notice");

publishMotion();
reducedMotion.addEventListener("change", () => publishMotion());
// Imagem que não carrega: remove-a e deixa as iniciais (o retrato guarda data-i).
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement && e.target.closest(".pt"))
      e.target.remove();
  },
  true,
);

const hud = mountHud($("hud")),
  board = mountBoard($("board"), $("traits")),
  steps = mountSteps($("steps")),
  itemSteps = mountSteps($("steps-items")),
  panel = mountPanel($("panel"));

function showNotice(kind, text) {
  notice.hidden = !text;
  notice.dataset.kind = kind ?? "";
  notice.textContent = text ?? "";
}

function render(model) {
  app.dataset.state = model.plan ? "ready" : "empty";
  flip($("stage"), () => {
    hud.update(model);
    board.update(model.plan);
    const all = model.plan?.steps ?? [];
    steps.update(all.filter((s) => s.group === "now"));
    itemSteps.update(all.filter((s) => s.group === "items"));
    panel.update(model.plan?.panel ?? null);
    const c = model.plan?.counts;
    $("counts").innerHTML = c
      ? `${c.ready ? `<span class="chip chip-go" title="trocas para fazer agora">⇄ ${c.ready}</span>` : ""}${c.hold ? `<span class="chip chip-amber" title="trocas para segurar">⏸ ${c.hold}</span>` : ""}`
      : "";
  });
  const { status } = model;
  if (status.sameGame === false)
    showNotice("warn", "Snapshot de outro jogo: não use como decisão ao vivo.");
  else if (!status.live)
    showNotice(
      "info",
      status.ended
        ? "Partida encerrada para o Hero."
        : `Planejamento · leitura de há ${status.ageSeconds ?? "?"}s`,
    );
  else if (status.reader)
    showNotice("info", `Leitor de tela: ${status.reader}`);
  else showNotice("", "");
  document.title = `${model.plan?.panel?.action ? model.plan.panel.action + " · " : ""}TFT Compass v2`;
}

/* ---------- Ciclo de atualização ---------- */
let busy = false,
  pending = false,
  lastKey = "",
  last = null;

async function refresh() {
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  document.body.classList.add("is-loading");
  try {
    const state = await loadState();
    if (!state.players?.some((p) => p.id === state.localPlayerId))
      throw new Error(
        "Hero não está neste snapshot; identidade local não foi trocada.",
      );
    const payload = recommendPayload(state),
      key = analysisKey(state, payload);
    let rec = last?.rec;
    if (key !== lastKey || !rec) {
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
await refresh();
setInterval(() => !document.hidden && refresh(), 5000);
document.addEventListener(
  "visibilitychange",
  () => !document.hidden && refresh(),
);
let tick = 0;
subscribe(() => {
  clearTimeout(tick);
  tick = setTimeout(() => !document.hidden && refresh(), 200);
});
