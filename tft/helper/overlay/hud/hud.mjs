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
  traitIcon,
  unitPortrait,
} from "/v2/js/ui/glyphs.js";
import { nameChip, richText, segments } from "/v2/js/ui/rich-text.js";
import { wispsView } from "/v2/js/wisps.js";
import { augOfferView } from "/v2/js/augs.js";
import { compOwnership, ownership } from "/v2/js/roster.js";
import { compBuildRows } from "/core/items/builds.mjs";
import { POLICY } from "/core/economy/policy.mjs";
import { interestOf } from "/core/economy/gold.mjs";
import { starCopies } from "/core/pool/copies.mjs";
import {
  badgesHelpHtml,
  buildBadges,
  drawBadges,
  placeBadges,
} from "./badges.mjs";
import { calibrationHtml, mountCalibrate } from "./calibrate.mjs";
import { swapRows, swapsHtml, tempBuys } from "./swaps.mjs";
import {
  compPanelHtml,
  compPanelStep,
  compsOf,
  resolveIndex,
} from "./comp.mjs";
import { createDraw } from "./draw.mjs";
import { fitSummary, keepOutRects, stageFrame } from "./fit.mjs";
import { anchorRects, placeLabel, resolveAnchor } from "./geometry.mjs";
import { healthOf } from "./health.mjs";
import { mountHelp } from "./help.mjs";
import { buildHints } from "./hints.mjs";
import {
  COPIED_TEXT,
  COPY_ERROR_MS,
  COPY_FLASH_MS,
  editBannerHtml,
  keysHtml,
  teamCodeState,
} from "./keys.mjs";
import { keyParts } from "./hotkeys.mjs";
import { ELEMENT_IDS, isFolded, setFolded } from "./layout.mjs";
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
  // Aprimoramentos: a mesma regra da seção do Ao vivo (oferta do GEP + ordem da análise).
  augOfferView,
  // Painel da comp: a lista (comp.mjs), onde está cada peça (roster.js) e as builds de "Builds e 3★" (motor único).
  compsOf,
  ownership,
  compOwnership,
  compBuildRows,
  // Bloco "Entra e sai" e as compras de substituto na loja (swaps.mjs).
  swapRows,
  tempBuys,
  // Cópias por estrela (regra do jogo): "4/9" dos alvos da rolagem.
  starCopies,
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
/**
 * Adaptação ao tamanho do jogo do último desenho (`fitSummary`) e os elementos recolhidos por falta de espaço. É estado
 * EFETIVO, só de apresentação: nunca vai para o host nem para o layout salvo.
 */
let fit = null,
  collapsedNow = [];
/** Selos dos botões do jogo do último desenho (badges.mjs), para o painel "?" explicar cada um. */
let badgesNow = [];

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
  // A mensagem dos estados sem plano ("aguardando análise", "Partida encerrada") mora com o dock, que nunca some: a faixa
  // de estado agora começa oculta.
  dock: ["dock", "message"],
  bar: ["bar"],
  hints: ["hints"],
  roll: ["roll"],
  items: ["items"],
  builds: ["builds"],
  plan: ["plan"],
  // Carrossel e aprimoramentos dividem o elemento: os dois são "escolha agora" e nunca acontecem na mesma rodada.
  carousel: ["carousel", "augments"],
  keys: ["keys"],
  comp: ["comp"],
  swaps: ["swaps"],
};
/** Ordem dos cartões no modo painel. */
const PANEL_ORDER = [
  "bar",
  "message",
  "comp",
  "carousel",
  "augments",
  "hints",
  "roll",
  "swaps",
  "items",
  "builds",
  "plan",
  "keys",
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

/* ---------- Atalhos e "Copiar comp" (keys.mjs) ---------- */

/** Retorno do botão de copiar (`{ text, tone }`) enquanto vale; null fora disso. */
let copyFlash = null,
  copyFlashTimer = 0;

/** A legenda fica aberta por este tempo na primeira exibição; depois o padrão é recolhida (`layout.keys.seen`). */
const FIRST_SHOW_MS = 20000;
let seenTimer = 0;

/** Legenda de atalhos e botão de copiar; só com o host do Electron (numa aba comum não há atalhos nem cópia). */
function paintKeys() {
  const el = layoutNow().keys;
  put(
    $("keys"),
    host
      ? keysHtml({
          shortcuts: mode.shortcuts,
          folded: isFolded(el),
          copy: teamCodeState(current.view),
          flash: copyFlash,
          esc,
          // Verbosidade normal (padrão): rótulo ao lado de cada tecla; mínima: só tecla e ícone.
          compact: mode.hints.verbosity === "minimal",
        })
      : "",
  );
  // Primeira exibição: depois de um tempo aberta, recolhe e marca como vista (a escolha do jogador vale dali em diante).
  if (host && gotMode && el && el.seen === false && !el.hidden && !seenTimer)
    seenTimer = setTimeout(() => {
      const now = layoutNow();
      if (now.keys?.seen === false)
        Promise.resolve()
          .then(() => host.saveLayout?.(setFolded(now, "keys", true)))
          .catch(() => {});
    }, FIRST_SHOW_MS);
}

function flashCopy(text, tone, ms) {
  clearTimeout(copyFlashTimer);
  copyFlash = { text, tone };
  paintKeys();
  copyFlashTimer = setTimeout(() => {
    copyFlash = null;
    paintKeys();
  }, ms);
}

/** Copia o código da comp exibida pelo processo principal; o botão e o atalho global passam os dois por aqui. */
async function copyComp() {
  const tc = teamCodeState(current.view);
  if (!tc.code) return flashCopy(tc.reason, "warn", COPY_ERROR_MS);
  try {
    const r = await host?.copyTeamCode?.(tc.code);
    if (r?.ok) flashCopy(COPIED_TEXT, "ok", COPY_FLASH_MS);
    else flashCopy("Não foi possível copiar", "bad", COPY_ERROR_MS);
  } catch {
    flashCopy("Não foi possível copiar", "bad", COPY_ERROR_MS);
  }
}

/**
 * Avisos discretos (servidor sem resposta, leitura velha) no dock quando a faixa de estado está oculta no modo integrado
 * (o padrão): o selo de servidor sem resposta continua na tela.
 */
const dockNotices = () =>
  integrated() && layoutNow().bar?.hidden ? (current.view?.notices ?? []) : [];

/* ---------- Painel da comp (comp.mjs) ---------- */

/**
 * Painel da comp: aberto ou não e qual comp (pela chave, para seguir a mesma entre análises). Só apresentação. Aberto por
 * padrão (pedido do usuário, 2026-10-12): a comp fica na tela desde o início; o atalho fecha e abre.
 */
let compState = { open: true, index: 0, key: null };
const compUi = { ...ui, stars, traitIcon };

/** Tecla final de um atalho da lista registrada (a legenda escreve os modificadores uma vez; aqui só a tecla). */
const keyOf = (id) => {
  const s = (mode.shortcuts ?? []).find((x) => x.id === id);
  return s?.accelerator && s.ok !== false ? keyParts(s.accelerator).key : "";
};

function paintComp() {
  const comps = current.view?.comps ?? [];
  const index = resolveIndex(compState, comps);
  put(
    $("comp"),
    compPanelHtml(
      {
        open: compState.open,
        comp: comps[index] ?? null,
        index,
        total: comps.length,
        status: current.view?.status ?? "loading",
        keys: {
          toggle: keyOf("compPanel"),
          prev: keyOf("compPrev"),
          next: keyOf("compNext"),
        },
      },
      compUi,
    ),
  );
}

/** Atalho do painel: abre, fecha ou troca a comp; o elemento muda de tamanho, então o palco é redesenhado. */
function onCompAction(action) {
  compState = compPanelStep(compState, action, current.view?.comps ?? []);
  redrawAll();
}

/** Cartões, lista de dicas e dock: o que depende dos dados e do modo, não da geometria. */
function paintData() {
  const view = current.view;
  html.dataset.dim = view?.dim ? "1" : "0";
  // Verbosidade normal (padrão): os cartões com cabeçalho, rótulos e motivo curto. Mínima (opção do "?"): leitura de
  // relance, ícones e números; as frases vão para a dica do mouse.
  const compact = mode.hints.verbosity === "minimal",
    o = { compact };
  if (view) {
    ov.dataset.status = view.status;
    ov.dataset.dim = view.dim ? "1" : "0";
    put($("bar"), draw.bar(view, o));
    put($("message"), draw.message(view, o));
    put($("carousel"), draw.carousel(view, o));
    put($("augments"), draw.augments(view, o));
    put($("roll"), draw.roll(view, o));
    put($("swaps"), swapsHtml(view.swaps, ui));
    put($("items"), draw.items(view, o));
    // Blocos que repetem o que já está na tela (formação inteira, plano completo): fora do painel compacto; no
    // integrado eles já começam ocultos no layout e o jogador os liga no "?".
    const extra = !compact || integrated();
    put($("builds"), extra ? draw.builds(view) : "");
    put($("plan"), extra ? draw.plan(view) : "");
  }
  if (current.error)
    put(
      $("message"),
      `<p class="msg" title="${esc(current.error?.message)}">não foi possível montar a tela</p>`,
    );
  const k = stageScale(sizeOf(), mode.scale);
  put(
    $("hints"),
    drawHintList(current.hints, {
      ...ui,
      settings: mode.hints,
      k,
      // Compacto com as marcas sobre o jogo: a lista não repete as dicas que já estão no alvo.
      onlyUnanchored: compact && integrated() && mode.game.found,
    }),
  );
  put(
    $("dock"),
    draw.dock({
      health: healthNow(),
      mode,
      hasHost: !!host,
      fit,
      notices: dockNotices(),
    }),
  );
  paintKeys();
  paintComp();
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
  // A geometria do HUD existe sempre que o palco tem tamanho (serve às regiões vitais que os elementos não cobrem ao serem
  // reposicionados); só as MARCAS ancoradas dependem de o jogo ter sido detectado.
  const valid = size.width > 0 && size.height > 0;
  const geometry = valid ? anchorRects(size, calibrationNow()) : null;
  const { arrangement } = applyLayout(elements, layoutNow(), size, {
    interactive: mode.interactive,
    k,
    keepOut: geometry ? keepOutRects(geometry) : [],
    sticky: collapsedNow,
  });
  collapsedNow = arrangement.collapsed;
  fit = fitSummary(size, {
    dpr: window.devicePixelRatio,
    userScale: mode.scale,
    arrangement,
  });
  put(
    $("dock"),
    draw.dock({
      health: healthNow(),
      mode,
      hasHost: !!host,
      fit,
      notices: dockNotices(),
    }),
  );

  // Sem o jogo detectado não há âncoras: só os elementos aparecem.
  const found = mode.game.found && valid;
  const rects = found ? geometry : null;
  // Selos nos botões do jogo (Atualizar, Comprar XP) e ao lado do ouro (badges.mjs): a decisão de rolar, de subir e o
  // ouro a guardar ficam onde o jogador clica, no lugar do cartão "Vale rolar?" e da faixa de estado.
  badgesNow = buildBadges(current.view, { curve: POLICY.curve, interestOf });
  const placedBadges =
    rects && !mode.calibrating
      ? placeBadges(badgesNow, rects, size, {
          k,
          measure,
          resolveAnchor,
          placeLabel,
        })
      : [];
  put($("badges"), drawBadges(placedBadges, ui));
  // Com os selos sobre os botões, as dicas de ouro/nível (rolar, esperar, subir, juros) não se repetem nas marcas.
  const hintsShown = placedBadges.length
    ? current.hints.hints.filter((h) => h.category !== "gold")
    : current.hints.hints;
  const placed =
    rects && !mode.calibrating
      ? placeMarkers(hintsShown, rects, size, {
          k,
          settings: mode.hints,
          measure,
          avoid: [...Object.values(arrangement.rects), ...placedBadges],
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
  put($("editbanner"), editBannerHtml(mode, esc));
  helpPanel?.render(mode, healthNow(), ui, fit, badgesHelpHtml(badgesNow, esc));
}

/**
 * Painéis com conteúdo sobrando (`.items`, `.builds`, `.plan` mais altos que a altura máxima) viram regiões quentes
 * (`data-hot`): com o cursor real sobre eles a janela recebe a roda do mouse e o painel rola; fora deles o click-through
 * volta (main.mjs `syncHot`). Painel que cabe inteiro não captura nada.
 */
function markScrollable() {
  for (const n of document.querySelectorAll(
    '.items, .builds, .plan, .el[data-fixed="1"] .el-body',
  )) {
    const overflow = n.scrollHeight > n.clientHeight + 2;
    if (overflow) n.setAttribute("data-hot", "scroll");
    else if (n.getAttribute("data-hot") === "scroll")
      n.removeAttribute("data-hot");
  }
}

function redrawAll() {
  if (!modeReady) return;
  html.dataset.mode = mode.mode;
  placeSections();
  paintData();
  paintStage();
  markScrollable();
  // O botão "Copiar comp" e o de recolher a legenda podem ter mudado de lugar: o host precisa saber onde estão.
  hit?.reportHot();
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
      // O layout é fração do HUD 16:9 (não do palco): os gestos convertem px em fração por essas medidas.
      stage: stageFrame(sizeOf()).hud,
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
  // "Copiar comp" e recolher a legenda: clicáveis mesmo fora do modo interativo (regiões quentes, ver mountHitTest).
  $("keys").addEventListener("click", (e) => {
    const btn =
      e.target instanceof Element ? e.target.closest("[data-act]") : null;
    if (!btn || btn.disabled) return;
    if (btn.dataset.act === "copy-comp") void copyComp();
    else if (btn.dataset.act === "fold-keys") {
      const next = setFolded(layoutNow(), "keys", !isFolded(layoutNow().keys));
      setPreview("layout", next);
      call("saveLayout", next);
      paintKeys();
    }
  });
  // Atalho global de copiar: o main pede e a página copia pelo mesmo caminho do botão (uma fonte só para o código).
  try {
    host.onCopyRequest?.(() => void copyComp());
  } catch (e) {
    console.error(e);
  }
  // Atalhos do painel da comp (mostrar/esconder, anterior, próxima): só mudam o que a página mostra.
  try {
    host.onCompPanel?.(onCompAction);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Reposiciona quando o conteúdo ou a janela mudam de tamanho. Os avisos de redimensionamento (a janela do jogo sendo
 * arrastada pela borda gera uma rajada deles, mais os do ResizeObserver) são agrupados num único desenho curto; o
 * último da rajada sempre acontece, então o resultado final é exato.
 */
const STAGE_COALESCE_MS = 24;
let stageTimer = 0;
const queueStage = () => {
  if (stageTimer) return;
  stageTimer = setTimeout(() => {
    stageTimer = 0;
    paintStage();
    markScrollable();
    hit?.reportHot();
  }, STAGE_COALESCE_MS);
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
