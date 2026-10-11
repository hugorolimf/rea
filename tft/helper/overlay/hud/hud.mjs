/**
 * Entrada do HUD do overlay (página carregada pelo Electron em `/overlay/index.html`). Consulta `/api/overlay` (cache
 * de leitura: nunca pede análise nem estado ao servidor), monta o modelo de tela (`view.mjs`) com o modelo da interface
 * web, deriva as dicas (`hints.mjs`) e as desenha de dois jeitos:
 * - modo integrado (padrão no Electron): a janela cobre a área cliente do jogo; contornos e etiquetas ficam ancorados
 *   nos elementos do TFT (`markers.mjs` + `geometry.mjs`) e os cartões viram elementos que o usuário posiciona e
 *   redimensiona (`widgets.mjs` + `layout.mjs`), com painel de ajuda (`help.mjs`) e calibração (`calibrate.mjs`);
 * - modo painel (fase 1, e aba comum do navegador): a coluna de cartões `.ov`.
 * A página só MOSTRA: nada aqui envia entrada ao jogo. As funções de apresentação vêm de `/v2/js/*` (mesma origem).
 */
import { loadCatalog } from "/v2/js/api.js";
import { esc } from "/v2/js/dom.js";
import { buildStates } from "/v2/js/item-source.js";
import { buildModel } from "/v2/js/model.js";
import { PART_STATE, nextItemRecipe } from "/v2/js/next-item.js";
import { planView } from "/v2/js/plan.js";
import {
  getCatalog,
  glyph,
  itemPortrait,
  portrait,
  setCatalog,
  stars,
  unitPortrait,
} from "/v2/js/ui/glyphs.js";
import { nameChip, richText, segments } from "/v2/js/ui/rich-text.js";
import { wispsView } from "/v2/js/wisps.js";
import { calibrationHtml, mountCalibrate } from "./calibrate.mjs";
import { createDraw } from "./draw.mjs";
import { anchorRects } from "./geometry.mjs";
import { healthOf } from "./health.mjs";
import { mountHelp } from "./help.mjs";
import { buildHints } from "./hints.mjs";
import { ELEMENT_IDS } from "./layout.mjs";
import {
  drawHintList,
  drawMarkers,
  placeMarkers,
  textWidth,
} from "./markers.mjs";
import {
  OFFLINE_AFTER,
  REQUEST_TIMEOUT_MS,
  retryDelay,
  startPolling,
} from "./poll.mjs";
import { mountToolbar } from "./toolbar.mjs";
import { overlayView } from "./view.mjs";
import {
  PANEL_MODE,
  applyLayout,
  buildElements,
  mountHitTest,
  mountWidgets,
  normalizeMode,
  stageScale,
} from "./widgets.mjs";

const $ = (id) => document.getElementById(id);
const html = document.documentElement;
const host = window.overlayHost ?? null;
const ov = $("ov");
const stageEl = $("stage");

const draw = createDraw({
  esc,
  glyph,
  portrait,
  unitPortrait,
  itemPortrait,
  nameChip,
  richText,
  stars,
});
const ui = { esc, glyph, portrait, unitPortrait, itemPortrait, richText };
const deps = {
  buildModel,
  planView,
  nextItemRecipe,
  partState: PART_STATE,
  buildStates,
  wispsView,
  // Lidos a cada desenho: o catálogo só existe depois de `setCatalog`.
  get catalogItems() {
    return getCatalog().items;
  },
  get catalog() {
    return getCatalog();
  },
};

/** Largura estimada de um texto da etiqueta: cada nome trocado por imagem conta como um retrato. */
const measure = (text) =>
  segments(String(text ?? ""), getCatalog()).reduce(
    (w, s) => w + (s.ref ? 24 : textWidth(s.text)),
    0,
  );

// Imagem que não carrega: remove-a e deixa as iniciais (o retrato guarda data-i). Dentro de um texto rico (`.rt`), o
// marcador vira o nome em texto, para a frase nunca perder o nome.
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

/** Troca o conteúdo só quando o HTML mudou (o DOM estável evita piscar e reiniciar animações a cada consulta). */
function put(node, markup) {
  const next = markup || "";
  if (node.dataset.sig !== next) {
    node.dataset.sig = next;
    node.innerHTML = next;
  }
  node.hidden = !next;
}

/* ---------- Estado da página ---------- */

let mode = PANEL_MODE,
  modeReady = !host,
  catalogReady = false,
  latest = { feed: null, receivedAt: 0, failures: 0 },
  current = {
    view: null,
    hints: { hints: [], total: 0, hidden: 0 },
    error: null,
  };
/** Prévias locais (arrasto, calibração) enquanto o host ainda não devolveu o valor salvo. */
const preview = { layout: null, calibration: null };

const sizeOf = () => ({ width: window.innerWidth, height: window.innerHeight });
const integrated = () => mode.mode === "integrated";
const layoutNow = () => preview.layout ?? mode.layout;
const calibrationNow = () => preview.calibration ?? mode.calibration;

/** Guarda uma prévia; some quando o host devolver o mesmo valor ou, no máximo, em 1,6 s. */
function setPreview(kind, value) {
  preview[kind] = value;
  setTimeout(() => {
    if (preview[kind] === value) {
      preview[kind] = null;
      paintStage();
    }
  }, 1600);
}

/* ---------- Seções e invólucros ---------- */

/** Seções do HUD de cada elemento posicionável. O dock e a lista de dicas só existem no modo integrado ou no painel. */
const SECTIONS = {
  dock: ["dock"],
  bar: ["bar", "message"],
  hints: ["hints"],
  roll: ["roll"],
  items: ["items"],
  builds: ["builds"],
  plan: ["plan"],
};
/** Ordem dos cartões no modo painel. */
const PANEL_ORDER = [
  "bar",
  "message",
  "hints",
  "roll",
  "items",
  "builds",
  "plan",
];

const elements = buildElements(stageEl);
// O dock não faz parte da coluna do modo painel: mora sempre no invólucro (escondido com o palco).
elements.dock.body.append($("dock"));
let placedIn = "panel";

/** Move as seções entre a coluna `.ov` (painel) e os invólucros (integrado) sem recriar o DOM. */
function placeSections() {
  const target = integrated() ? "integrated" : "panel";
  if (placedIn === target) return;
  placedIn = target;
  if (target === "integrated") {
    for (const id of ELEMENT_IDS)
      for (const sec of SECTIONS[id]) elements[id].body.append($(sec));
  } else for (const sec of PANEL_ORDER) ov.append($(sec));
}

/* ---------- Desenho ---------- */

function healthNow() {
  return healthOf(current.view, {
    offline: latest.failures >= OFFLINE_AFTER,
    game: integrated() ? mode.game : null,
  });
}

/** Cartões, lista de dicas e dock: o que depende dos dados e do modo, não da geometria. */
function paintData() {
  const view = current.view;
  html.dataset.dim = view?.dim ? "1" : "0";
  if (view) {
    ov.dataset.status = view.status;
    ov.dataset.dim = view.dim ? "1" : "0";
    put($("bar"), draw.bar(view));
    put($("message"), draw.message(view));
    put($("roll"), draw.roll(view));
    put($("items"), draw.items(view));
    put($("builds"), draw.builds(view));
    put($("plan"), draw.plan(view));
  }
  if (current.error)
    put(
      $("message"),
      `<p class="msg" title="${esc(current.error?.message)}">não foi possível montar a tela</p>`,
    );
  const k = stageScale(sizeOf(), mode.scale);
  put(
    $("hints"),
    drawHintList(current.hints, { ...ui, settings: mode.hints, k }),
  );
  put($("dock"), draw.dock({ health: healthNow(), mode, hasHost: !!host }));
}

let helpPanel = null,
  calibrator = null;

/** Posição dos elementos, marcas ancoradas, calibração, ajuda e aviso de tela cheia (modo integrado). */
function paintStage() {
  const on = integrated() && modeReady;
  stageEl.hidden = !on;
  if (!on) return;
  const size = sizeOf(),
    k = stageScale(size, mode.scale);
  html.style.setProperty("--k", String(k));
  applyLayout(elements, layoutNow(), size, { interactive: mode.interactive });

  // Sem o jogo detectado não há âncoras: só os elementos aparecem.
  const found = mode.game.found && size.width > 0 && size.height > 0;
  const rects = found ? anchorRects(size, calibrationNow()) : null;
  const placed =
    rects && !mode.calibrating
      ? placeMarkers(current.hints.hints, rects, size, {
          k,
          settings: mode.hints,
          measure,
        })
      : [];
  put($("markers"), drawMarkers(placed, { ...ui, settings: mode.hints, k }));

  const calibrating = !!rects && mode.calibrating;
  put($("calib"), calibrating ? calibrationHtml(rects, ui) : "");
  const surface = $("cal-surface");
  surface.hidden = !calibrating;
  $("cal-panel").hidden = !calibrating;
  if (calibrating) {
    const r = rects.hud;
    Object.assign(surface.style, {
      left: `${r.x}px`,
      top: `${r.y}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    calibrator?.render(calibrationNow(), ui);
  }

  put($("fsbanner"), draw.banner(mode));
  helpPanel?.render(mode, healthNow(), ui);
}

function redrawAll() {
  if (!modeReady) return;
  html.dataset.mode = mode.mode;
  placeSections();
  paintData();
  paintStage();
}

/** Recalcula o modelo de tela e as dicas a partir do último dado recebido. */
function recompute() {
  try {
    const view = overlayView(latest.feed, {
      catalogReady,
      now: Date.now(),
      receivedAt: latest.receivedAt,
      offline: latest.failures >= OFFLINE_AFTER,
      deps,
    });
    let hints = { hints: [], total: 0, hidden: 0 };
    try {
      hints = buildHints(view, mode.hints);
    } catch (e) {
      // Dicas são um complemento: se falharem, os cartões continuam.
      console.error(e);
    }
    current = { view, hints, error: null };
  } catch (e) {
    // Dado inesperado do servidor: o resto da tela fica como estava e o aviso diz o que falhou.
    console.error(e);
    current = { ...current, error: e };
  }
}

function redraw() {
  recompute();
  redrawAll();
}

/* ---------- Dados ---------- */

async function fetchFeed(since) {
  const response = await fetch(
    since ? `/api/overlay?since=${encodeURIComponent(since)}` : "/api/overlay",
    { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`o servidor respondeu ${response.status}`);
  return response.json();
}

/** O catálogo (retratos, nomes e receitas) é carregado uma vez; se falhar, tenta de novo com recuo. */
async function loadCatalogOnce() {
  for (let failures = 1; ; failures++) {
    try {
      setCatalog(await loadCatalog());
      catalogReady = true;
      redraw();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(failures)));
    }
  }
}

/* ---------- Modo, ajuda, calibração e elementos ---------- */

let widgets = null,
  hit = null,
  gotMode = false;

/** Aplica o modo recebido do host (ou o padrão). A prévia local sai quando o host devolve o mesmo valor. */
function applyMode(raw) {
  if (raw) gotMode = true;
  const next = normalizeMode(raw),
    was = mode;
  mode = next;
  modeReady = true;
  for (const kind of ["layout", "calibration"])
    if (
      preview[kind] &&
      JSON.stringify(preview[kind]) === JSON.stringify(next[kind])
    )
      preview[kind] = null;
  html.dataset.mode = mode.mode;
  const flag = (name, on) => {
    if (on) html.dataset[name] = "1";
    else delete html.dataset[name];
  };
  flag("interactive", mode.interactive);
  flag("help", mode.help);
  flag("calibrating", mode.calibrating);
  if (was.interactive && !mode.interactive) widgets?.release();
  hit?.sync();
  redraw();
}

if (host) {
  const call = (name, ...args) => {
    Promise.resolve()
      .then(() => host[name]?.(...args))
      .catch(() => {});
  };
  helpPanel = mountHelp($("help"), host, () => mode);
  calibrator = mountCalibrate({
    surface: $("cal-surface"),
    panel: $("cal-panel"),
    host,
    ui,
    getState: () => ({
      calibration: calibrationNow(),
      rects: anchorRects(sizeOf(), calibrationNow()),
      stage: sizeOf(),
    }),
    preview: (cal) => {
      setPreview("calibration", cal);
      paintStage();
    },
  });
  widgets = mountWidgets({
    stage: stageEl,
    host,
    map: elements,
    getState: () => ({
      interactive: mode.interactive && integrated(),
      layout: layoutNow(),
      stage: sizeOf(),
    }),
    preview: (layout) => {
      setPreview("layout", layout);
      paintStage();
    },
  });
  hit = mountHitTest({
    host,
    isActive: () => integrated() && mode.interactive,
    isBusy: () => !!(widgets?.busy() || calibrator?.busy()),
  });
  // Botão "?" do dock: abre e fecha a ajuda (só recebe clique no modo interativo).
  $("dock").addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest('[data-act="help"]'))
      call("setHelp", !mode.help);
  });
  // Barra de ferramentas do modo painel.
  try {
    mountToolbar($("toolbar"), $("grip"), host);
  } catch (e) {
    console.error(e);
  }
}

/** Reposiciona quando o conteúdo ou a janela mudam de tamanho. */
let stageTimer = 0;
const queueStage = () => {
  if (stageTimer) return;
  stageTimer = setTimeout(() => {
    stageTimer = 0;
    paintStage();
  }, 0);
};
window.addEventListener("resize", queueStage);
if (typeof ResizeObserver === "function") {
  const observer = new ResizeObserver(queueStage);
  for (const id of ELEMENT_IDS) observer.observe(elements[id].inner);
}

/* ---------- Partida ---------- */

startPolling({
  fetchFeed,
  onUpdate(update) {
    latest = update;
    redraw();
  },
});
void loadCatalogOnce();
redraw();

if (host) {
  // O modo vem do host: sem resposta em 1,5 s a página segue no modo painel (e atualiza se o modo chegar depois).
  try {
    host.onMode?.(applyMode);
  } catch (e) {
    console.error(e);
  }
  Promise.race([
    Promise.resolve().then(() => host.getMode()),
    new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
  ])
    .then((raw) => {
      // Um modo que chegou por `onMode` antes é mais novo que esta resposta.
      if (raw || !gotMode) applyMode(raw);
    })
    .catch(() => {
      if (!gotMode) applyMode(null);
    });
}
