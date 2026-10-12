// Processo principal do overlay do TFT helper.
// Janela transparente comum, sempre no topo, que mostra o HUD servido pelo próprio servidor do helper.
// Dois modos: "integrated" (a janela cobre a área cliente da janela do TFT, posição lida somente-leitura por um
// PowerShell persistente) e "panel" (painel pequeno da fase 1).
// Sem injeção, sem hook, sem leitura de memória, sem captura de tela e sem automatizar entrada.
// Nunca rouba o foco do jogo (focusable:false) e nunca encerra por causa do servidor.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  screen,
  session,
} from "electron";
import {
  IDLE_UI,
  MIN_SIZE,
  OPACITY_RANGE,
  SCALE_RANGE,
  buildMode,
  configSnapshot,
  cursorInHotRects,
  defaultBounds,
  fitBounds,
  isTeamCode,
  loadAndMigrateConfig,
  loadConfig,
  mouseIgnore,
  nextUi,
  parseConfig,
  parseHotRects,
  resolvePort,
  saveConfig,
} from "./config.mjs";
import {
  classifyChange,
  createApplyGate,
  createChangeBatcher,
  localImportGraph,
  pathKey,
  watchTrees,
} from "./dev-reload.mjs";
import {
  gameUserSettingsPath,
  describeFullscreen,
  readFullscreenMode,
} from "./display-mode.mjs";
import {
  RECT_TOLERANCE_PX,
  createGameFollower,
  nearlySameRect,
} from "./follow.mjs";
import { findGameRect } from "./game-window.mjs";
import { createGameTracker } from "./game-tracker.mjs";
import { parseCalibration } from "./hud/geometry.mjs";
import { parseHintSettings } from "./hud/hints.mjs";
import { HOTKEY_ACTIONS } from "./hud/hotkeys.mjs";
import { PROBE_TIMEOUT_MS, probeResult, probeStep } from "./probe.mjs";
import { parseLayout } from "./hud/layout.mjs";

const MAIN_FILE = fileURLToPath(import.meta.url);
const here = path.dirname(MAIN_FILE);
const HELPER_DIR = path.dirname(here);
const CONFIG_FILE = path.join(here, "overlay.config.json");
const LOG_FILE = path.join(here, "overlay.log");
const OFFLINE_FILE = path.join(here, "offline.html");
const PRELOAD_FILE = path.join(here, "preload.cjs");
const DEV_CHECK_FILE = path.join(here, "dev-check.mjs");
/** Pastas que a página do HUD carrega do servidor (static-files.mjs as lê do disco a cada pedido). */
const PAGE_ROOTS = [
  path.join(here, "hud"),
  path.join(HELPER_DIR, "v2"),
  path.join(HELPER_DIR, "core"),
];
/** Enquanto a página diz que o ponteiro está numa região quente, o main reconfere o cursor neste intervalo. */
const HOT_POLL_MS = 100;
/** Teto da verificação do código novo antes de reiniciar o Electron. */
const CHECK_TIMEOUT_MS = 60000;
/**
 * Reinício automático do Electron quando muda o código do processo principal: DESLIGADO por padrão (só registra no log
 * que é preciso reiniciar o overlay); `devReload: true` no overlay.config.json ou TFT_OVERLAY_RELAUNCH=1 o ligam. A
 * recarga da página do HUD continua automática fora de partida.
 */
const autoRelaunch = () =>
  process.env.TFT_OVERLAY_RELAUNCH === "1" || cfg?.devReload === true;

const PROBE_INTERVAL_MS = 3000;
// PROBE_TIMEOUT_MS e a regra de "fora do ar" vêm de probe.mjs.
const GESTURE_INTERVAL_MS = 16;
const GESTURE_MAX_MS = 30000;
const SAVE_DEBOUNCE_MS = 500;
/** Troca de monitor/DPI dispara várias notificações seguidas; reage uma vez depois delas. */
const REFIT_DEBOUNCE_MS = 150;
const LOG_MAX_BYTES = 200 * 1024;

// --- log pequeno em arquivo (truncado acima de ~200 KB) ---

let logBytes = 0;
try {
  logBytes = fs.statSync(LOG_FILE).size;
} catch {
  // Sem log anterior.
}

/** Acrescenta uma linha ao overlay.log; falha de escrita nunca propaga. */
function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    if (logBytes + line.length > LOG_MAX_BYTES) {
      fs.writeFileSync(LOG_FILE, "");
      logBytes = 0;
    }
    fs.appendFileSync(LOG_FILE, line);
    logBytes += line.length;
  } catch {
    // Log é opcional.
  }
}

const errText = (err) => (err instanceof Error ? err.message : String(err));

process.on("uncaughtException", (err) =>
  log(`uncaughtException: ${err?.stack ?? errText(err)}`),
);
process.on("unhandledRejection", (reason) =>
  log(`unhandledRejection: ${errText(reason)}`),
);

// --- estado ---

/** Palco inexistente: modo painel, ou integrado sem a janela do jogo. */
const NO_STAGE = Object.freeze({
  found: false,
  width: null,
  height: null,
  covers: false,
});

let cfg;
let port;
let win = null;
/** Estado de interação: interativo (mestre), ajuda e calibração. */
let ui = { ...IDLE_UI };
/** A página pediu captura do mouse (ponteiro sobre elemento interativo); só vale no modo interativo. */
let pageCapture = false;
let appliedIgnore = null;
let quitting = false;
let lastOnline = null;
let probeTimer = null;
let saveTimer = null;
let savePromise = Promise.resolve();
let gesture = null;
let gestureTimer = null;
let lastLoadError = "";
let tracker = null;
/** Filtra as leituras do rastreador: ignora tremida de 1-2 px, aplica ao vivo e dá o ajuste exato quando assenta. */
let follower = null;
/** O overlay foi escondido porque o jogo sumiu (minimizado/fechado); volta sozinho quando o jogo voltar. */
let lostHidden = false;
let refitTimer = null;
/** Área cliente do jogo em pixels físicos (do rastreador) ou null. */
let gameRect = null;
let stage = NO_STAGE;
/** FullscreenMode do ini: undefined = ainda não lido, null = desconhecido, 0..2. */
let iniMode;
/** Resultado do registro de cada atalho global (id -> true/false); vai à página na lista `shortcuts`. */
const hotkeyStatus = {};
/** Regiões quentes ("Copiar comp"): a página pede, o main confere o cursor e só então tira o click-through. */
let hotWanted = false;
let hotRects = [];
let hotCapture = false;
let hotTimer = null;
/** Texto do overlay.config.json que este processo leu ou gravou: distingue a própria gravação de uma edição externa. */
let lastConfigText = null;
let reloadWatch = null;
let relaunching = false;

const hudUrl = () => `http://127.0.0.1:${port}/overlay/index.html`;

/** Só a origem do servidor do helper e o offline.html local podem ser carregados ou emitir IPC. */
function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "http:") {
      return u.hostname === "127.0.0.1" && (u.port || "80") === String(port);
    }
    if (u.protocol === "file:") {
      const norm = (p) =>
        process.platform === "win32"
          ? path.normalize(p).toLowerCase()
          : path.normalize(p);
      return norm(fileURLToPath(u)) === norm(OFFLINE_FILE);
    }
  } catch {
    // URL inválida: bloqueada.
  }
  return false;
}

const alive = () => win !== null && !win.isDestroyed();
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// --- modo enviado à página ---

function gameState() {
  let fullscreen = null;
  if (iniMode !== undefined && (cfg.mode === "panel" || stage.found)) {
    const d = describeFullscreen(iniMode, { rectCoversMonitor: stage.covers });
    fullscreen = { warn: d.warn, kind: d.kind, text: d.text };
  }
  return {
    found: stage.found,
    width: stage.width,
    height: stage.height,
    fullscreen,
  };
}

const currentMode = () =>
  buildMode({ ui, cfg, game: gameState(), hotkeyStatus });

function broadcastMode() {
  if (!alive()) return;
  try {
    win.webContents.send("overlay:mode", currentMode());
  } catch (err) {
    log(`falha ao enviar modo: ${errText(err)}`);
  }
}

/** No integrado a escala é CSS da página (zoom 1); no painel é o zoom do webContents. */
function applyAppearance() {
  if (!alive()) return;
  win.setOpacity(cfg.opacity);
  win.webContents.setZoomFactor(cfg.mode === "panel" ? cfg.scale : 1);
}

/** Click-through por padrão; ver `mouseIgnore` para o que muda no modo interativo. */
function applyIgnore() {
  if (!alive()) return;
  const ignore = mouseIgnore({
    interactive: ui.interactive,
    mode: cfg.mode,
    pageCapture,
    hotCapture,
  });
  if (ignore === appliedIgnore) return;
  const first = appliedIgnore === null;
  appliedIgnore = ignore;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
  // Diagnóstico sem screenshot: cada mudança de captura vai ao log com o motivo.
  if (!first || !ignore)
    log(
      ignore
        ? "captura: liberada (mouse vai para o jogo)"
        : ui.interactive
          ? "captura: janela inteira (modo de edição)"
          : "captura: botão do overlay sob o cursor (Copiar comp/Atalhos)",
    );
}

/**
 * Reaplica o click-through do zero. Depois de carregar ou recarregar a página o encaminhamento do movimento do mouse
 * (`forward`) pode deixar de chegar à página nova; sem movimento ela nunca pede captura e os cliques vão para o jogo.
 */
function rearmIgnore() {
  if (!alive()) return;
  appliedIgnore = null;
  applyIgnore();
}

// --- regiões quentes: só o botão "Copiar comp" (e o de recolher a legenda) recebe clique fora do modo interativo ---

/** O cursor real está sobre uma região quente declarada pela página? */
function cursorOnHot() {
  if (!alive() || !hotRects.length) return false;
  try {
    return cursorInHotRects(
      screen.getCursorScreenPoint(),
      win.getContentBounds(),
      win.webContents.getZoomFactor(),
      hotRects,
    );
  } catch {
    return false;
  }
}

/**
 * Reavalia a captura das regiões quentes pelo cursor REAL (`screen.getCursorScreenPoint`), não pelo movimento
 * encaminhado à página (que não chega com o jogo em primeiro plano). O vigia de HOT_POLL_MS só roda com o overlay
 * visível, fora do modo de edição e com alguma região quente declarada; o cursor sair devolve o click-through.
 */
function syncHot() {
  const watching =
    hotRects.length > 0 && !ui.interactive && alive() && win.isVisible();
  const next = watching && cursorOnHot();
  if (next !== hotCapture) {
    hotCapture = next;
    applyIgnore();
  }
  if (watching) {
    if (!hotTimer) hotTimer = setInterval(syncHot, HOT_POLL_MS);
  } else if (hotTimer) {
    clearInterval(hotTimer);
    hotTimer = null;
  }
}

/** Página nova (ou recarregada): esquece as regiões e a captura da anterior. */
function resetHot() {
  hotWanted = false;
  hotRects = [];
  pageCapture = false;
  syncHot();
  applyIgnore();
}

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const round2 = (v) => Math.round(v * 100) / 100;

// --- persistência ---

function snapshotConfig() {
  return configSnapshot(cfg, alive() ? win.getBounds() : null);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushSave();
  }, SAVE_DEBOUNCE_MS);
}

/** Grava a configuração atual; gravações são serializadas para nunca se atropelarem. */
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const snap = snapshotConfig();
  cfg = { ...cfg, bounds: snap.bounds };
  savePromise = savePromise
    .then(() => saveConfig(CONFIG_FILE, snap))
    .then((body) => {
      // O observador de arquivos vai ver esta gravação: ela não é uma edição externa.
      if (typeof body === "string") lastConfigText = body;
    })
    .catch((err) => log(`falha ao salvar configuração: ${errText(err)}`));
  return savePromise;
}

// --- monitor ---

const describeDisplay = (d) =>
  `monitor ${d.id} ${d.bounds.width}x${d.bounds.height} em ${d.bounds.x},${d.bounds.y}${d.label ? ` (${d.label})` : ""}`;

/** Monitor para as seleções que não dependem da janela do jogo. "game" cai no primário. */
function selectDisplaySync(selection) {
  if (selection === "cursor")
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (typeof selection === "number") {
    const found = screen.getAllDisplays().find((d) => d.id === selection);
    if (found) return found;
  }
  return screen.getPrimaryDisplay();
}

/** Escolhe o monitor; "game" (ou preferGame) consulta a posição da janela do TFT e cai no primário se falhar. */
async function pickDisplay(selection, preferGame = false) {
  if (preferGame || selection === "game") {
    const rect = await findGameRect();
    if (rect && typeof screen.screenToDipRect === "function") {
      try {
        return {
          display: screen.getDisplayMatching(
            screen.screenToDipRect(null, rect),
          ),
          source: "janela do jogo",
        };
      } catch (err) {
        log(`falha ao converter a janela do jogo: ${errText(err)}`);
      }
    }
    if (selection === "game")
      return {
        display: screen.getPrimaryDisplay(),
        source: "primário (jogo não encontrado)",
      };
  }
  if (selection === "cursor") {
    return {
      display: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
      source: "cursor",
    };
  }
  if (typeof selection === "number") {
    const found = screen.getAllDisplays().find((d) => d.id === selection);
    if (found) return { display: found, source: "id configurado" };
  }
  return { display: screen.getPrimaryDisplay(), source: "primário" };
}

/** Posição do modo painel: `bounds` salvo (recolocado num monitor atual) ou canto do monitor escolhido. */
async function initialPlacement() {
  const { display, source } = await pickDisplay(cfg.display);
  const displays = screen.getAllDisplays();
  const preferred = Math.max(
    0,
    displays.findIndex((d) => d.id === display.id),
  );
  const bounds = cfg.bounds
    ? fitBounds(
        cfg.bounds,
        displays.map((d) => d.bounds),
        preferred,
      )
    : defaultBounds(display.workArea);
  return { bounds, display, source };
}

/** Posição do painel sem consultar o jogo (troca de modo em tempo de execução): `bounds` salvo ou canto do monitor. */
function panelPlacementSync() {
  const display = selectDisplaySync(cfg.display);
  const displays = screen.getAllDisplays();
  const preferred = Math.max(
    0,
    displays.findIndex((d) => d.id === display.id),
  );
  return cfg.bounds
    ? fitBounds(
        cfg.bounds,
        displays.map((d) => d.bounds),
        preferred,
      )
    : defaultBounds(display.workArea);
}

const sameBounds = (a, b) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * setBounds com repetição: com DPI misto o primeiro setBounds usa a escala do monitor onde a janela estava e o
 * tamanho sai errado; o segundo, já no monitor de destino, acerta. `tol` > 0 (acompanhamento ao vivo): diferença de até
 * `tol` px conta como igual e não mexe na janela (evita piscar); o ajuste exato (tol 0) vem quando a janela assenta.
 */
function setBoundsExact(target, tol = 0) {
  if (!alive()) return;
  const close = (a) =>
    tol > 0 ? nearlySameRect(a, target, tol) : sameBounds(a, target);
  if (close(win.getBounds())) return;
  win.setBounds(target);
  if (!close(win.getBounds())) win.setBounds(target);
}

/** Recoloca a janela do PAINEL dentro de algum monitor atual (após arrastar, trocar monitor ou resolução). */
function settleBounds() {
  if (!alive() || cfg.mode !== "panel") return;
  const displays = screen.getAllDisplays();
  const current = win.getBounds();
  const next = fitBounds(
    current,
    displays.map((d) => d.bounds),
    0,
  );
  if (!sameBounds(current, next)) win.setBounds(next);
}

async function anchorWindow() {
  if (!alive() || cfg.mode !== "panel") return;
  const { display, source } = await pickDisplay(cfg.display, true);
  if (!alive()) return;
  const size = win.getBounds();
  win.setBounds(
    defaultBounds(display.workArea, { width: size.width, height: size.height }),
  );
  log(`ancorado em ${describeDisplay(display)} [${source}]`);
  scheduleSave();
}

// --- palco do modo integrado ---

/** Área cliente do jogo em DIP (a conversão usa o monitor mais próximo do próprio retângulo) ou null. */
function gameDipRect() {
  if (!gameRect || typeof screen.screenToDipRect !== "function") return null;
  try {
    return screen.screenToDipRect(null, gameRect);
  } catch (err) {
    log(`falha ao converter a janela do jogo: ${errText(err)}`);
    return null;
  }
}

const coversDisplay = (rect, display) => {
  const b = display.bounds;
  return (
    rect.x <= b.x &&
    rect.y <= b.y &&
    rect.x + rect.width >= b.x + b.width &&
    rect.y + rect.height >= b.y + b.height
  );
};

/**
 * Retângulo (DIP) que a janela deve ocupar no modo integrado.
 * Seguindo o jogo: a área cliente dele; sem jogo: o monitor configurado ("game" cai no primário), âncoras escondidas.
 * Sem seguir: o monitor configurado inteiro, supondo que o jogo o preencha (found = true), exceto com display "game".
 */
function stageTarget() {
  const dip = gameDipRect();
  if (cfg.follow) {
    if (dip) {
      return {
        bounds: dip,
        found: true,
        covers: coversDisplay(dip, screen.getDisplayMatching(dip)),
      };
    }
    return {
      bounds: selectDisplaySync(cfg.display).bounds,
      found: false,
      covers: false,
    };
  }
  if (cfg.display === "game") {
    const display = dip
      ? screen.getDisplayMatching(dip)
      : screen.getPrimaryDisplay();
    return {
      bounds: display.bounds,
      found: dip !== null,
      covers: dip ? coversDisplay(dip, display) : false,
    };
  }
  const display = selectDisplaySync(cfg.display);
  return { bounds: display.bounds, found: true, covers: true };
}

/** Troca o palco e diz se mudou algo que a página precisa saber. */
function setStage(next) {
  const changed =
    next.found !== stage.found ||
    next.width !== stage.width ||
    next.height !== stage.height ||
    next.covers !== stage.covers;
  stage = next;
  return changed;
}

/**
 * Posiciona a janela integrada sobre o jogo (ou o monitor) e avisa a página se o palco mudou. `live`: acompanhamento
 * durante uma mudança (arrastar a borda do jogo): diferença de até `RECT_TOLERANCE_PX` não reposiciona nem avisa; sem
 * `live` o ajuste é exato.
 */
function applyPlacement({ live = false } = {}) {
  if (!alive()) return;
  if (cfg.mode !== "integrated") {
    if (setStage(NO_STAGE)) broadcastMode();
    return;
  }
  const tol = live ? RECT_TOLERANCE_PX : 0;
  const target = stageTarget();
  setBoundsExact(target.bounds, tol);
  let width = target.found ? target.bounds.width : null;
  let height = target.found ? target.bounds.height : null;
  // Tamanho que oscila 1-2 px não vale um redesenho da página; o ajuste exato vem quando a janela assenta.
  if (
    tol > 0 &&
    stage.found &&
    target.found &&
    Math.abs(width - stage.width) <= tol &&
    Math.abs(height - stage.height) <= tol
  ) {
    width = stage.width;
    height = stage.height;
  }
  const changed = setStage({
    found: target.found,
    width,
    height,
    covers: target.covers,
  });
  if (changed) broadcastMode();
}

/** Escondeu o overlay porque o jogo sumiu (minimizado, fechado ou recriado); não mexe em `cfg.visible`. */
function hideForLoss() {
  if (!alive() || cfg.mode !== "integrated" || !cfg.follow || !win.isVisible())
    return;
  stopGesture();
  applyUi(nextUi(ui, "exitInteractive"));
  win.hide();
  lostHidden = true;
  log("jogo sumiu (minimizado ou fechado): overlay escondido até ele voltar");
}

/** O jogo voltou (ou o acompanhamento acabou): reexibe o que `hideForLoss` escondeu, se o usuário o quer visível. */
function revealAfterLoss() {
  if (!lostHidden) return;
  lostHidden = false;
  if (!alive() || !cfg.visible) return;
  win.showInactive();
  win.setAlwaysOnTop(true, "screen-saver");
  log("jogo de volta: overlay reexibido");
}

/** Retângulo novo do jogo, já filtrado (mudança maior que a tolerância): acompanha ao vivo. */
function onGameRect(rect, info) {
  const appeared = gameRect === null;
  gameRect = rect;
  if (appeared) void refreshFullscreen();
  if (info.first || info.recovered)
    log(`jogo em ${rect.x},${rect.y} ${rect.width}x${rect.height}`);
  // Primeiro a janela vai para cima do jogo; só então reaparece (sem um quadro cobrindo o monitor inteiro).
  applyPlacement({ live: true });
  revealAfterLoss();
}

/** O jogo ficou quieto: ajuste exato (DPI misto) e releitura do modo de tela, que pode ter mudado. */
function onGameSettle(rect) {
  applyPlacement();
  log(`jogo assentou em ${rect.x},${rect.y} ${rect.width}x${rect.height}`);
  void refreshFullscreen();
}

/** O jogo sumiu além do prazo de tolerância. */
function onGameLost() {
  gameRect = null;
  hideForLoss();
  applyPlacement();
  // A partida acabou (ou o jogo sumiu): a recarga adiada, se houver, sai agora, uma vez.
  applyGate?.retry();
}

/** O rastreador só roda no integrado, seguindo o jogo ou com display "game" (que precisa saber onde ele está). */
function syncTracker() {
  if (!tracker) return;
  if (cfg.mode === "integrated" && (cfg.follow || cfg.display === "game")) {
    tracker.start();
  } else {
    tracker.stop();
    follower?.reset();
    gameRect = null;
    revealAfterLoss();
  }
}

/** Relê o modo de tela do ini local do jogo (somente leitura) e avisa a página se mudou. */
async function refreshFullscreen() {
  const file = gameUserSettingsPath(process.env);
  const mode = file ? await readFullscreenMode(file) : null;
  if (mode === iniMode) return;
  iniMode = mode;
  log(`FullscreenMode do jogo: ${mode === null ? "desconhecido" : mode}`);
  broadcastMode();
}

// --- arrastar e redimensionar (só no painel interativo) ---

function stopGesture() {
  if (gestureTimer) clearInterval(gestureTimer);
  const had = gesture !== null;
  gestureTimer = null;
  gesture = null;
  if (had) {
    settleBounds();
    scheduleSave();
    applyGate?.retry();
  }
}

function tickGesture() {
  if (
    !gesture ||
    !alive() ||
    !ui.interactive ||
    cfg.mode !== "panel" ||
    Date.now() - gesture.startedAt > GESTURE_MAX_MS
  ) {
    stopGesture();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - gesture.cursor.x;
  const dy = cursor.y - gesture.cursor.y;
  const start = gesture.bounds;
  let next;
  if (gesture.kind === "drag") {
    // Largura e altura reenviadas a cada passo: evita deriva de tamanho entre monitores com DPI diferente.
    next = {
      x: start.x + dx,
      y: start.y + dy,
      width: start.width,
      height: start.height,
    };
  } else {
    const wa = screen.getDisplayMatching(start).bounds;
    const maxW = Math.max(MIN_SIZE.width, wa.x + wa.width - start.x);
    const maxH = Math.max(MIN_SIZE.height, wa.y + wa.height - start.y);
    next = {
      x: start.x,
      y: start.y,
      width: clamp(start.width + dx, MIN_SIZE.width, maxW),
      height: clamp(start.height + dy, MIN_SIZE.height, maxH),
    };
  }
  next = {
    x: Math.round(next.x),
    y: Math.round(next.y),
    width: Math.round(next.width),
    height: Math.round(next.height),
  };
  if (!sameBounds(next, win.getBounds())) win.setBounds(next);
}

function startGesture(kind) {
  if (!alive() || !ui.interactive || cfg.mode !== "panel") return;
  stopGesture();
  gesture = {
    kind,
    cursor: screen.getCursorScreenPoint(),
    bounds: win.getBounds(),
    startedAt: Date.now(),
  };
  gestureTimer = setInterval(tickGesture, GESTURE_INTERVAL_MS);
}

// --- visibilidade e estados de interação ---

/** Aplica um novo estado de interação (interativo, ajuda, calibração); sair do interativo limpa os três. */
function applyUi(next) {
  if (!alive()) return;
  if (
    next.interactive === ui.interactive &&
    next.help === ui.help &&
    next.calibrating === ui.calibrating
  )
    return;
  const wasInteractive = ui.interactive;
  ui = next;
  log(
    `modo: interativo=${ui.interactive ? "ligado" : "desligado"} ajuda=${ui.help ? "sim" : "não"} calibração=${ui.calibrating ? "sim" : "não"}`,
  );
  if (wasInteractive !== ui.interactive) {
    stopGesture();
    if (!ui.interactive) scheduleSave();
    syncEscape();
  }
  if (!ui.interactive) pageCapture = false;
  // No modo interativo a página manda por [data-hit]; fora dele voltam a valer as regiões quentes.
  syncHot();
  applyIgnore();
  broadcastMode();
  // Saiu do interativo/ajuda/calibração: a recarga adiada (se houver) sai agora, uma vez.
  applyGate?.retry();
}

function showOverlay() {
  if (!alive()) return;
  lostHidden = false;
  win.showInactive();
  win.setAlwaysOnTop(true, "screen-saver");
  cfg.visible = true;
  scheduleSave();
}

function hideOverlay() {
  if (!alive()) return;
  lostHidden = false;
  stopGesture();
  applyUi(nextUi(ui, "exitInteractive"));
  win.hide();
  cfg.visible = false;
  scheduleSave();
}

function toggleOverlay() {
  if (!alive()) return;
  if (win.isVisible()) hideOverlay();
  else showOverlay();
}

/** Atalhos de ajuda e calibração mostram o overlay se estiver escondido. */
function toggleUi(action) {
  if (!alive()) return;
  if (!win.isVisible()) showOverlay();
  applyUi(nextUi(ui, action));
}

async function quitOverlay() {
  if (quitting) return;
  quitting = true;
  log("encerrando pelo atalho/HUD");
  stopGesture();
  clearTimeout(probeTimer);
  tracker?.stop();
  await flushSave();
  app.quit();
}

/** Troca entre integrado e painel, preservando `bounds` do painel. */
function changeMode(next) {
  if (next === cfg.mode) return;
  stopGesture();
  if (cfg.mode === "panel" && alive()) cfg.bounds = win.getBounds();
  cfg.mode = next;
  pageCapture = false;
  syncTracker();
  applyAppearance();
  applyIgnore();
  if (next === "integrated") {
    applyPlacement();
  } else {
    setStage(NO_STAGE);
    if (alive()) setBoundsExact(panelPlacementSync());
  }
  broadcastMode();
  scheduleSave();
}

function changeFollow(on) {
  if (on === cfg.follow) return;
  cfg.follow = on;
  syncTracker();
  applyPlacement();
  broadcastMode();
  scheduleSave();
}

/** Força nova detecção do jogo (integrado) ou reancora o painel (painel). */
function anchorAction() {
  if (cfg.mode === "integrated") {
    if (tracker?.refresh()) log("nova detecção da janela do jogo pedida");
    applyPlacement();
  } else {
    anchorWindow().catch((err) => log(`falha ao ancorar: ${errText(err)}`));
  }
}

// --- servidor do helper ---

/** Sonda: "ok" | "refused" (porta fechada) | "timeout" (lento ou conexão perdida) | "bad" (resposta não-200). */
async function probeServer() {
  try {
    // A própria página do HUD (arquivo pequeno): prova que o servidor responde e já conhece o prefixo /overlay/
    // (servidor iniciado antes desta versão devolve 404 e precisa ser reiniciado).
    const res = await fetch(hudUrl(), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    try {
      await res.body?.cancel();
    } catch {
      // Corpo já consumido ou fechado.
    }
    return probeResult(null, res);
  } catch (err) {
    return probeResult(err);
  }
}

/** Estado da sonda (probe.mjs): falhas seguidas e se o servidor está considerado fora do ar. */
let probe = { fails: 0, down: false };

/** Carrega o HUD ou o aviso offline. `lastOnline`: true = HUD carregado; false = offline.html; null = nada/carregando. */
async function loadTarget(online) {
  if (!alive()) return;
  lastOnline = online ? null : false;
  log(
    online
      ? "servidor online: carregando o HUD"
      : "servidor fora do ar e HUD não carregado: exibindo aviso",
  );
  if (online) lastLoadError = "";
  resetHot();
  try {
    if (online) {
      await win.loadURL(hudUrl());
      lastOnline = true;
    } else await win.loadFile(OFFLINE_FILE, { query: { port: String(port) } });
  } catch (err) {
    // Navegação substituída ou falha de rede: tenta de novo no próximo ciclo.
    lastOnline = null;
    const text = errText(err);
    if (text !== lastLoadError) log(`falha ao carregar: ${text}`);
    lastLoadError = text;
  }
}

/**
 * Uma sonda. Com o HUD carregado a página nunca é trocada (ele guarda os últimos dados e mostra o próprio selo de
 * "servidor sem resposta"); só as mudanças de estado vão ao log.
 */
async function probeOnce() {
  const result = await probeServer();
  const next = probeStep(
    {
      ...probe,
      hudLoaded: lastOnline === true,
      showingOffline: lastOnline === false,
    },
    result,
  );
  if (next.down !== probe.down)
    log(
      next.down
        ? `servidor sem resposta (${result === "refused" ? "porta fechada" : `${next.fails} sondas sem resposta em ${PROBE_TIMEOUT_MS / 1000} s`})${lastOnline === true ? "; o HUD fica com os últimos dados" : ""}`
        : "servidor respondeu de novo",
    );
  probe = { fails: next.fails, down: next.down };
  // As sondas são sequenciais (a próxima só é agendada quando esta termina): não há duas cargas ao mesmo tempo.
  if (next.action === "load-hud") await loadTarget(true);
  else if (next.action === "show-offline") await loadTarget(false);
}

function scheduleProbe() {
  clearTimeout(probeTimer);
  if (quitting) return;
  probeTimer = setTimeout(() => {
    probeOnce()
      .catch((err) => log(`falha na sonda: ${errText(err)}`))
      .finally(() => {
        if (alive() && win.isVisible()) {
          try {
            win.moveTop();
          } catch {
            // Reafirmar a ordem é só uma cortesia.
          }
        }
        scheduleProbe();
      });
  }, PROBE_INTERVAL_MS);
}

// --- janela ---

async function createWindow() {
  let bounds;
  let display;
  let source;
  if (cfg.mode === "integrated") {
    bounds = stageTarget().bounds;
    display = screen.getDisplayMatching(bounds);
    source = gameRect ? "janela do jogo" : "monitor (sem jogo)";
  } else {
    ({ bounds, display, source } = await initialPlacement());
  }
  win = new BrowserWindow({
    ...bounds,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: PRELOAD_FILE,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      devTools: false,
    },
  });
  const self = win;
  const wc = self.webContents;
  ui = { ...IDLE_UI };
  pageCapture = false;
  lastOnline = null;
  lostHidden = false;
  self.setAlwaysOnTop(true, "screen-saver");
  appliedIgnore = null;
  applyIgnore();
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  applyAppearance();
  applyPlacement();

  const reapply = () => {
    applyAppearance();
    // Página nova: arma de novo o click-through com encaminhamento do mouse (ver rearmIgnore).
    rearmIgnore();
    broadcastMode();
  };
  wc.on("dom-ready", reapply);
  wc.on("did-finish-load", () => {
    reapply();
    try {
      const url = wc.getURL();
      if (url.startsWith(hudUrl())) {
        lastOnline = true;
        log(`HUD carregado: ${url}`);
      }
    } catch {
      // Só log.
    }
  });
  wc.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      log(`did-fail-load ${code} ${description} ${url}`);
      lastOnline = null;
    }
  });
  wc.on("render-process-gone", (_e, details) => {
    log(`render-process-gone: ${details.reason}`);
    lastOnline = null;
    resetHot();
  });
  self.on("closed", () => {
    stopGesture();
    if (win === self) win = null;
    if (!quitting) {
      log("janela fechada fora do atalho; recriando");
      setTimeout(() => {
        createWindow().catch((err) =>
          log(`falha ao recriar a janela: ${errText(err)}`),
        );
      }, 1000);
    }
  });

  console.log(`[overlay] ${hudUrl()}`);
  console.log(
    `[overlay] modo ${cfg.mode}; monitor: ${describeDisplay(display)} [${source}]`,
  );
  log(
    `janela criada (${cfg.mode}) em ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}; ${describeDisplay(display)} [${source}]`,
  );

  await probeOnce();
  if (cfg.visible && alive()) showOverlay();
  scheduleProbe();
}

// --- atalhos globais ---

/**
 * Esc sai do modo de edição. A janela não é focável (o foco fica sempre no jogo), então Esc é um atalho global
 * registrado SÓ enquanto o modo de edição está ligado; ao sair ele é liberado e volta a ser do jogo.
 */
let escapeOn = false;
function syncEscape() {
  const want = ui.interactive && !quitting;
  if (want === escapeOn) return;
  try {
    if (want) {
      escapeOn = globalShortcut.register("Escape", () =>
        applyUi(nextUi(ui, "exitInteractive")),
      );
      if (!escapeOn)
        log(
          "Esc não registrado (em uso); use Ctrl+Shift+F10 para sair do modo de edição",
        );
    } else {
      globalShortcut.unregister("Escape");
      escapeOn = false;
    }
  } catch (err) {
    log(`falha com o atalho Esc: ${errText(err)}`);
    escapeOn = false;
  }
}

/** Atalho "Copiar comp": a página copia o código que ela já mostra, pelo mesmo caminho do botão. */
function requestCopy() {
  if (!alive() || lastOnline !== true) {
    log("copiar comp: o HUD não está carregado");
    return;
  }
  try {
    win.webContents.send("overlay:copyRequest");
  } catch (err) {
    log(`falha ao pedir a cópia: ${errText(err)}`);
  }
}

/**
 * Atalhos do painel da comp ("toggle", "prev", "next"): a página mostra, esconde e troca a comp do painel com os dados
 * que já recebe. Mostrar o painel também mostra o overlay, se estiver oculto. Nada aqui fixa comp nem fala com o servidor.
 */
function requestComp(action) {
  if (!alive() || lastOnline !== true) {
    log(`painel da comp (${action}): o HUD não está carregado`);
    return;
  }
  try {
    // Com o overlay oculto, o atalho de mostrar/esconder abre o painel (não o fecha sem que ninguém o tenha visto).
    const wasHidden = !win.isVisible();
    if (wasHidden) showOverlay();
    win.webContents.send(
      "overlay:compPanel",
      wasHidden && action === "toggle" ? "show" : action,
    );
  } catch (err) {
    log(`falha ao pedir o painel da comp: ${errText(err)}`);
  }
}

/**
 * Registra os atalhos na ordem da lista única (`hud/hotkeys.mjs`) e guarda o resultado de cada um em `hotkeyStatus`,
 * que vai à página: a legenda e a ajuda mostram exatamente o que foi registrado e marcam o que falhou.
 */
function registerHotkeys() {
  const actions = {
    toggle: toggleOverlay,
    interactive: () => applyUi(nextUi(ui, "toggleInteractive")),
    quit: () => {
      void quitOverlay();
    },
    anchor: anchorAction,
    help: () => toggleUi("toggleHelp"),
    calibrate: () => toggleUi("toggleCalibrating"),
    copyComp: requestCopy,
    compPanel: () => requestComp("toggle"),
    compPrev: () => requestComp("prev"),
    compNext: () => requestComp("next"),
  };
  const parts = [];
  for (const { id: name } of HOTKEY_ACTIONS) {
    const run = actions[name];
    const accelerator = cfg.hotkeys[name];
    let ok = false;
    try {
      if (run && accelerator) ok = globalShortcut.register(accelerator, run);
    } catch (err) {
      log(`erro ao registrar ${name} (${accelerator}): ${errText(err)}`);
    }
    hotkeyStatus[name] = ok;
    parts.push(`${name}=${accelerator}${ok ? "" : " (FALHOU)"}`);
    if (!ok && !accelerator) {
      log(
        `atalho ${name} sem tecla: a tecla padrão dele já está com outra ação (troque em overlay.config.json)`,
      );
    } else if (!ok) {
      log(
        `atalho ${name} (${accelerator}) não registrado: já em uso ou inválido`,
      );
      console.warn(
        `[overlay] ATENÇÃO: atalho ${name} (${accelerator}) não foi registrado (em uso por outro programa?).`,
      );
    }
  }
  console.log(`[overlay] atalhos: ${parts.join("  ")}`);
  log(`atalhos registrados: ${parts.join("  ")}`);
}

// --- IPC (somente do webContents da janela do overlay, quadro principal, origem permitida) ---

function fromOverlay(event) {
  if (!alive() || event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame.parent) return false;
  return isAllowedUrl(frame.url);
}

function onOverlay(channel, fn) {
  ipcMain.on(channel, (event, ...args) => {
    if (!fromOverlay(event)) return;
    try {
      fn(...args);
    } catch (err) {
      log(`falha em ${channel}: ${errText(err)}`);
    }
  });
}

function setupIpc() {
  ipcMain.handle("overlay:getMode", (event) => {
    if (!fromOverlay(event)) throw new Error("origem não permitida");
    return currentMode();
  });
  // --- v1 ---
  onOverlay("overlay:adjustScale", (delta) => {
    if (typeof delta !== "number" || !Number.isFinite(delta)) return;
    cfg.scale = round2(
      clamp(cfg.scale + clamp(delta, -1, 1), SCALE_RANGE.min, SCALE_RANGE.max),
    );
    applyAppearance();
    broadcastMode();
    scheduleSave();
  });
  onOverlay("overlay:adjustOpacity", (delta) => {
    if (typeof delta !== "number" || !Number.isFinite(delta)) return;
    cfg.opacity = round2(
      clamp(
        cfg.opacity + clamp(delta, -1, 1),
        OPACITY_RANGE.min,
        OPACITY_RANGE.max,
      ),
    );
    applyAppearance();
    broadcastMode();
    scheduleSave();
  });
  onOverlay("overlay:dragStart", () => startGesture("drag"));
  onOverlay("overlay:dragEnd", stopGesture);
  onOverlay("overlay:resizeStart", () => startGesture("resize"));
  onOverlay("overlay:resizeEnd", stopGesture);
  onOverlay("overlay:exitInteractive", () =>
    applyUi(nextUi(ui, "exitInteractive")),
  );
  onOverlay("overlay:hide", hideOverlay);
  onOverlay("overlay:quit", () => {
    void quitOverlay();
  });
  // --- v2: tudo vindo da página é revalidado aqui ---
  onOverlay("overlay:setIgnore", (ignore) => {
    if (typeof ignore !== "boolean") return;
    // Captura do mouse só vale com o modo interativo ligado; ignorar (true) é sempre permitido.
    pageCapture = !ignore && ui.interactive;
    applyIgnore();
  });
  onOverlay("overlay:saveLayout", (raw) => {
    if (!isObj(raw)) return;
    cfg.layout = parseLayout(raw);
    broadcastMode();
    scheduleSave();
  });
  onOverlay("overlay:saveCalibration", (raw) => {
    if (!isObj(raw)) return;
    cfg.calibration = parseCalibration(raw);
    broadcastMode();
    scheduleSave();
  });
  onOverlay("overlay:saveHints", (raw) => {
    if (!isObj(raw)) return;
    cfg.hints = parseHintSettings(raw);
    broadcastMode();
    scheduleSave();
  });
  onOverlay("overlay:setHelp", (on) => {
    if (typeof on === "boolean") applyUi(nextUi(ui, "setHelp", on));
  });
  onOverlay("overlay:setCalibrating", (on) => {
    if (typeof on === "boolean") applyUi(nextUi(ui, "setCalibrating", on));
  });
  onOverlay("overlay:setMode", (next) => {
    if (next === "integrated" || next === "panel") changeMode(next);
  });
  onOverlay("overlay:setFollow", (on) => {
    if (typeof on === "boolean") changeFollow(on);
  });
  onOverlay("overlay:refreshGame", anchorAction);
  // --- v3: "Copiar comp" e regiões quentes ---
  ipcMain.handle("overlay:copyTeamCode", (event, code) => {
    if (!fromOverlay(event)) throw new Error("origem não permitida");
    // Só um código de equipe bem formado vai para a área de transferência (a janela não é focável: é o main quem copia).
    if (!isTeamCode(code)) {
      log("copiar comp: código recusado (formato inesperado)");
      return { ok: false, reason: "código inválido" };
    }
    try {
      clipboard.writeText(code);
      log(`código da comp copiado (${code.length} caracteres)`);
      return { ok: true };
    } catch (err) {
      log(`falha ao copiar o código da comp: ${errText(err)}`);
      return { ok: false, reason: "falha ao gravar na área de transferência" };
    }
  });
  onOverlay("overlay:setHot", (on) => {
    if (typeof on !== "boolean") return;
    hotWanted = on;
    syncHot();
  });
  onOverlay("overlay:setHotRects", (raw) => {
    hotRects = parseHotRects(raw);
    syncHot();
  });
}

// --- recarregamento automático (dev-reload.mjs) ---

const rel = (f) => path.relative(HELPER_DIR, f).replace(/\\/g, "/");

/** Recarrega só a página do HUD (o main guarda layout, modo e estado de interação e os reenvia ao carregar). */
function reloadHud(files) {
  if (!alive() || quitting) return;
  const what = files.map(rel).join(", ");
  if (lastOnline !== true) {
    log(`arquivos do HUD mudaram (${what}); o HUD não está carregado agora`);
    return;
  }
  log(`recarregando o HUD: ${what}`);
  resetHot();
  try {
    // Ignorando o cache: o servidor já lê do disco a cada pedido, mas nada de cópia velha no Chromium.
    win.webContents.reloadIgnoringCache();
  } catch (err) {
    log(`falha ao recarregar o HUD: ${errText(err)}`);
  }
}

/** Confere num processo filho (Electron como Node) que o código novo do processo principal carrega; devolve os problemas. */
function checkNewCode(mainFiles) {
  const others = mainFiles.filter((f) => pathKey(f) !== pathKey(MAIN_FILE));
  return new Promise((resolve) => {
    let err = "";
    let child;
    try {
      child = spawn(process.execPath, [DEV_CHECK_FILE, MAIN_FILE, ...others], {
        cwd: here,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (e) {
      resolve([`não foi possível conferir o código novo: ${errText(e)}`]);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Já saiu.
      }
    }, CHECK_TIMEOUT_MS);
    child.stderr?.on("data", (d) => {
      if (err.length < 4000) err += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve([errText(e)]);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve(
        code === 0
          ? []
          : [
              err.trim() ||
                (code === null
                  ? `a verificação não terminou em ${CHECK_TIMEOUT_MS / 1000} s (sinal ${signal ?? "?"}); nada foi reiniciado`
                  : `a verificação saiu com ${code}`),
            ],
      );
    });
  });
}

/**
 * Reinicia só o Electron (o servidor do helper não é tocado) para valer o código novo do processo principal, do preload
 * ou uma configuração editada por fora. Código que não carrega NÃO reinicia: o overlay atual segue até a próxima mudança.
 * `keepConfigFile`: a configuração foi editada por fora; nada é gravado por cima dela antes de reiniciar.
 */
async function relaunchOverlay(
  reason,
  mainFiles,
  { keepConfigFile = false } = {},
) {
  if (quitting || relaunching) return;
  relaunching = true;
  const problems = await checkNewCode(mainFiles);
  if (problems.length) {
    relaunching = false;
    log(
      `NÃO reiniciei o overlay (${reason}): o código novo não carrega; sigo com o atual até a próxima mudança. ${problems.join(" | ").slice(0, 1500)}`,
    );
    return;
  }
  if (quitting) return;
  log(
    `reiniciando o overlay (só o Electron; o servidor não é tocado): ${reason}`,
  );
  quitting = true;
  stopGesture();
  clearTimeout(probeTimer);
  reloadWatch?.close();
  tracker?.stop();
  if (keepConfigFile) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await savePromise.catch(() => {});
  } else await flushSave();
  app.relaunch({ args: [here] });
  app.quit();
}

/** Lote de mudanças já agrupado: recarrega a página, reinicia o Electron ou ignora a própria gravação da configuração. */
async function onFilesChanged(batch, mainFiles) {
  if (quitting || relaunching) return;
  const configKey = pathKey(CONFIG_FILE);
  const mainKeys = new Set(mainFiles.map((f) => pathKey(f)));
  const code = batch.files.filter((f) => pathKey(f) !== configKey);
  const mainChanged = code.filter((f) => mainKeys.has(pathKey(f)));
  const pageChanged = code.filter((f) => !mainKeys.has(pathKey(f)));
  let externalConfig = false;
  if (batch.config) {
    let text = null;
    try {
      text = await fs.promises.readFile(CONFIG_FILE, "utf8");
    } catch {
      // Arquivo apagado: o overlay segue com o que tem em memória.
    }
    externalConfig =
      text !== null &&
      text !== lastConfigText &&
      JSON.stringify(parseConfig(text)) !==
        JSON.stringify(parseConfig(lastConfigText ?? ""));
    if (text !== null && !externalConfig) lastConfigText = text;
  }
  if (mainChanged.length || externalConfig)
    applyGate?.request({
      kind: "relaunch",
      config: externalConfig,
      files: [
        ...mainChanged,
        ...pageChanged,
        ...(externalConfig ? [CONFIG_FILE] : []),
      ],
    });
  else if (pageChanged.length)
    applyGate?.request({ kind: "reload", config: false, files: pageChanged });
}

/**
 * O usuário está mexendo no overlay (modo interativo, ajuda, calibração ou arraste do painel): nenhuma recarga nem
 * reinício agora, porque derrubaria o arraste. O pedido espera e sai uma vez só ao sair desses modos.
 */
const userBusy = () =>
  gameRect !== null
    ? "partida em andamento"
    : ui.interactive || ui.help || ui.calibrating || gesture !== null
      ? "modo de edição/ajuda/calibração ou arraste"
      : false;

/** Portão das recargas (dev-reload.mjs `createApplyGate`); criado em `startAutoReload`. */
let applyGate = null;

/**
 * Observa o HUD, a interface web e o núcleo (o que a página carrega) e o código do próprio processo principal. Desligado
 * com TFT_OVERLAY_WATCH=0.
 */
function startAutoReload() {
  if (process.env.TFT_OVERLAY_WATCH === "0") {
    log("recarregamento automático desligado (TFT_OVERLAY_WATCH=0)");
    return;
  }
  const mainFiles = [
    ...localImportGraph(MAIN_FILE, (f) => fs.readFileSync(f, "utf8")),
    PRELOAD_FILE,
  ];
  applyGate = createApplyGate({
    isBlocked: userBusy,
    onDefer: (batch, why) =>
      log(
        `recarga adiada: ${why} (${batch.files.length} arquivo${batch.files.length === 1 ? "" : "s"}: ${batch.files.map(rel).join(", ")}); sai uma vez quando acabar`,
      ),
    run: (batch) => {
      if (batch.kind !== "relaunch") return reloadHud(batch.files);
      const what = batch.files.map(rel).join(", ");
      if (autoRelaunch())
        void relaunchOverlay(what, mainFiles, { keepConfigFile: batch.config });
      else {
        // Sem reinício automático: o que é da página ainda recarrega; o código do main espera o próximo início.
        log(
          `código do processo principal mudou (${what}): vale no próximo início do overlay (reinício automático desligado; TFT_OVERLAY_RELAUNCH=1 liga)`,
        );
        // Módulos do HUD que o main também importa (layout, dicas, geometria) valem já na página.
        const page = batch.files.filter((f) =>
          PAGE_ROOTS.some((r) => pathKey(f).startsWith(pathKey(r) + path.sep)),
        );
        if (page.length) reloadHud(page);
      }
    },
  });
  const batcher = createChangeBatcher({
    onFlush: (batch) => {
      onFilesChanged(batch, mainFiles).catch((err) =>
        log(`falha no recarregamento automático: ${errText(err)}`),
      );
    },
  });
  reloadWatch = watchTrees({
    roots: [
      { dir: here, recursive: false },
      ...PAGE_ROOTS.map((dir) => ({ dir, recursive: true })),
    ],
    onEvent: (file) => {
      const kind = classifyChange(file, {
        mainFiles,
        configFile: CONFIG_FILE,
        pageRoots: PAGE_ROOTS,
      });
      if (kind) batcher.push(kind, file);
    },
    log,
  });
  log(
    `recarregamento automático ligado: mudanças em ${PAGE_ROOTS.map(rel).join(", ")} recarregam o HUD (3 s de silêncio, no máximo 1 a cada 10 s, nunca em partida nem com o modo de edição, a ajuda ou a calibração abertos); ${mainFiles.length} arquivos do processo principal (${mainFiles.map(rel).join(", ")}) e a configuração ${autoRelaunch() ? "reiniciam só o Electron" : "valem no próximo início (reinício automático desligado)"}`,
  );
}

// --- segurança de navegação ---

app.on("web-contents-created", (_event, contents) => {
  const guard = (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      log(`navegação bloqueada: ${url}`);
    }
  };
  contents.on("will-navigate", (event) => guard(event, event.url));
  contents.on("will-redirect", (event) => guard(event, event.url));
  contents.on("will-frame-navigate", (event) => guard(event, event.url));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    log(`janela nova bloqueada: ${url}`);
    return { action: "deny" };
  });
});

// --- inicialização ---

async function start() {
  try {
    const loaded = await loadAndMigrateConfig(CONFIG_FILE);
    cfg = loaded.cfg;
    lastConfigText = loaded.text;
    if (loaded.migration)
      log(
        `configuração migrada para os padrões v${cfg.defaultsVersion} (backup: ${path.basename(loaded.migration.backup)}): ${loaded.migration.changes.join("; ") || "só a versão (nada estava no padrão antigo)"}`,
      );
  } catch (err) {
    log(
      `falha ao migrar a configuração (segue com o arquivo como está): ${errText(err)}`,
    );
    cfg = await loadConfig(CONFIG_FILE);
    lastConfigText = await fs.promises
      .readFile(CONFIG_FILE, "utf8")
      .catch(() => null);
  }
  port = resolvePort(cfg, process.env);
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  setupIpc();
  console.log(
    "[overlay] iniciando (janela transparente, sem foco, sem captura nem injeção)",
  );
  registerHotkeys();
  follower = createGameFollower({
    onRect: onGameRect,
    onLost: onGameLost,
    onSettle: onGameSettle,
  });
  tracker = createGameTracker({
    parentPid: process.pid,
    onChange: (rect) => follower.push(rect),
    log,
  });
  syncTracker();
  void refreshFullscreen();
  await createWindow();

  // Troca de monitor, de resolução ou de escala (DPI) manda várias notificações em seguida: reage uma vez, no fim,
  // com o ajuste exato (o segundo setBounds do DPI misto).
  const refit = () => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      refitTimer = null;
      if (cfg.mode === "integrated") applyPlacement();
      else settleBounds();
    }, REFIT_DEBOUNCE_MS);
  };
  screen.on("display-added", refit);
  screen.on("display-removed", refit);
  screen.on("display-metrics-changed", refit);
  startAutoReload();
}

if (!app.requestSingleInstanceLock()) {
  console.log("[overlay] já há uma instância em execução; encerrando esta.");
  app.quit();
} else {
  app.on("second-instance", () => {
    log("segunda instância ignorada");
    if (alive() && cfg.visible && !lostHidden) win.showInactive();
  });
  // Fechar janelas não encerra o processo: só o atalho/HUD de sair.
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    quitting = true;
    clearTimeout(probeTimer);
    clearTimeout(refitTimer);
    if (hotTimer) clearInterval(hotTimer);
    reloadWatch?.close();
    follower?.reset();
    tracker?.stop();
    globalShortcut.unregisterAll();
  });
  start().catch((err) => {
    log(`falha na inicialização: ${err?.stack ?? errText(err)}`);
    console.error(`[overlay] falha na inicialização: ${errText(err)}`);
  });
}
