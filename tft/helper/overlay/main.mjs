// Processo principal do overlay do TFT helper.
// Janela transparente comum, sempre no topo, que mostra o HUD servido pelo próprio servidor do helper.
// Dois modos: "integrated" (a janela cobre a área cliente da janela do TFT, posição lida somente-leitura por um
// PowerShell persistente) e "panel" (painel pequeno da fase 1).
// Sem injeção, sem hook, sem leitura de memória, sem captura de tela e sem automatizar entrada.
// Nunca rouba o foco do jogo (focusable:false) e nunca encerra por causa do servidor.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
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
  defaultBounds,
  fitBounds,
  loadConfig,
  mouseIgnore,
  nextUi,
  resolvePort,
  saveConfig,
} from "./config.mjs";
import {
  gameUserSettingsPath,
  describeFullscreen,
  readFullscreenMode,
} from "./display-mode.mjs";
import { findGameRect } from "./game-window.mjs";
import { createGameTracker } from "./game-tracker.mjs";
import { parseCalibration } from "./hud/geometry.mjs";
import { parseHintSettings } from "./hud/hints.mjs";
import { parseLayout } from "./hud/layout.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(here, "overlay.config.json");
const LOG_FILE = path.join(here, "overlay.log");
const OFFLINE_FILE = path.join(here, "offline.html");
const PRELOAD_FILE = path.join(here, "preload.cjs");

const PROBE_INTERVAL_MS = 3000;
const PROBE_TIMEOUT_MS = 2500;
const GESTURE_INTERVAL_MS = 16;
const GESTURE_MAX_MS = 30000;
const SAVE_DEBOUNCE_MS = 500;
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
/** Área cliente do jogo em pixels físicos (do rastreador) ou null. */
let gameRect = null;
let stage = NO_STAGE;
/** FullscreenMode do ini: undefined = ainda não lido, null = desconhecido, 0..2. */
let iniMode;

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

const currentMode = () => buildMode({ ui, cfg, game: gameState() });

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
  });
  if (ignore === appliedIgnore) return;
  appliedIgnore = ignore;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
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
 * tamanho sai errado; o segundo, já no monitor de destino, acerta.
 */
function setBoundsExact(target) {
  if (!alive() || sameBounds(win.getBounds(), target)) return;
  win.setBounds(target);
  if (!sameBounds(win.getBounds(), target)) win.setBounds(target);
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

/** Posiciona a janela integrada sobre o jogo (ou o monitor) e avisa a página se o palco mudou. */
function applyPlacement() {
  if (!alive()) return;
  if (cfg.mode !== "integrated") {
    if (setStage(NO_STAGE)) broadcastMode();
    return;
  }
  const target = stageTarget();
  setBoundsExact(target.bounds);
  const changed = setStage({
    found: target.found,
    width: target.found ? target.bounds.width : null,
    height: target.found ? target.bounds.height : null,
    covers: target.covers,
  });
  if (changed) broadcastMode();
}

/** Alteração do rastreador (só quando o retângulo muda). */
function onGameChange(rect) {
  const appeared = rect !== null && gameRect === null;
  gameRect = rect;
  if (appeared) void refreshFullscreen();
  applyPlacement();
}

/** O rastreador só roda no integrado, seguindo o jogo ou com display "game" (que precisa saber onde ele está). */
function syncTracker() {
  if (!tracker) return;
  if (cfg.mode === "integrated" && (cfg.follow || cfg.display === "game")) {
    tracker.start();
  } else {
    tracker.stop();
    gameRect = null;
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
  if (wasInteractive !== ui.interactive) {
    stopGesture();
    if (!ui.interactive) scheduleSave();
  }
  if (!ui.interactive) pageCapture = false;
  applyIgnore();
  broadcastMode();
}

function showOverlay() {
  if (!alive()) return;
  win.showInactive();
  win.setAlwaysOnTop(true, "screen-saver");
  cfg.visible = true;
  scheduleSave();
}

function hideOverlay() {
  if (!alive()) return;
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

async function serverOnline() {
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
    return res.ok;
  } catch {
    return false;
  }
}

/** Carrega o HUD ou o aviso offline, só quando o estado muda (ou na primeira vez). */
async function syncTarget(online) {
  if (!alive() || online === lastOnline) return;
  const previous = lastOnline;
  lastOnline = online;
  log(
    online
      ? "servidor online: carregando o HUD"
      : "servidor offline: exibindo aviso",
  );
  if (online && previous === false) lastLoadError = "";
  try {
    if (online) await win.loadURL(hudUrl());
    else await win.loadFile(OFFLINE_FILE, { query: { port: String(port) } });
  } catch (err) {
    // Navegação substituída ou falha de rede: tenta de novo no próximo ciclo.
    lastOnline = null;
    const text = errText(err);
    if (text !== lastLoadError) log(`falha ao carregar: ${text}`);
    lastLoadError = text;
  }
}

async function probeOnce() {
  await syncTarget(await serverOnline());
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
  self.setAlwaysOnTop(true, "screen-saver");
  appliedIgnore = null;
  applyIgnore();
  wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  applyAppearance();
  applyPlacement();

  const reapply = () => {
    applyAppearance();
    broadcastMode();
  };
  wc.on("dom-ready", reapply);
  wc.on("did-finish-load", reapply);
  wc.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      log(`did-fail-load ${code} ${description} ${url}`);
      lastOnline = null;
    }
  });
  wc.on("render-process-gone", (_e, details) => {
    log(`render-process-gone: ${details.reason}`);
    lastOnline = null;
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
  };
  const parts = [];
  for (const [name, run] of Object.entries(actions)) {
    const accelerator = cfg.hotkeys[name];
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, run);
    } catch (err) {
      log(`erro ao registrar ${name} (${accelerator}): ${errText(err)}`);
    }
    parts.push(`${name}=${accelerator}${ok ? "" : " (FALHOU)"}`);
    if (!ok) {
      log(
        `atalho ${name} (${accelerator}) não registrado: já em uso ou inválido`,
      );
      console.warn(
        `[overlay] ATENÇÃO: atalho ${name} (${accelerator}) não foi registrado (em uso por outro programa?).`,
      );
    }
  }
  console.log(`[overlay] atalhos: ${parts.join("  ")}`);
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
  cfg = await loadConfig(CONFIG_FILE);
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
  tracker = createGameTracker({
    parentPid: process.pid,
    onChange: onGameChange,
    log,
  });
  syncTracker();
  void refreshFullscreen();
  await createWindow();

  const refit = () => {
    if (cfg.mode === "integrated") applyPlacement();
    else settleBounds();
  };
  screen.on("display-added", refit);
  screen.on("display-removed", refit);
  screen.on("display-metrics-changed", refit);
}

if (!app.requestSingleInstanceLock()) {
  console.log("[overlay] já há uma instância em execução; encerrando esta.");
  app.quit();
} else {
  app.on("second-instance", () => {
    log("segunda instância ignorada");
    if (alive() && cfg.visible) win.showInactive();
  });
  // Fechar janelas não encerra o processo: só o atalho/HUD de sair.
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    quitting = true;
    clearTimeout(probeTimer);
    tracker?.stop();
    globalShortcut.unregisterAll();
  });
  start().catch((err) => {
    log(`falha na inicialização: ${err?.stack ?? errText(err)}`);
    console.error(`[overlay] falha na inicialização: ${errText(err)}`);
  });
}
