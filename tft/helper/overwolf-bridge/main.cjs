"use strict";
// Processo principal da ponte (ow-electron). Uma janela de desktop visivel (status e avisos), o pacote GEP, o gravador
// SQLite e um servidor de status em 127.0.0.1. Nao injeta no jogo, nao le memoria, nao usa rede externa.
const path = require("node:path");
const os = require("node:os");
const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const { GepService } = require("./src/gep-service.cjs");
const { createRecorder } = require("./src/recorder.cjs");
const { createStatusServer } = require("./src/status-server.cjs");
const { createForwarder } = require("./src/forward.cjs");

const PRODUCT = "TFT Helper Bridge";
const STATUS_PORT = Number(process.env.BRIDGE_PORT) || 18795;
/** Mesmo caminho que o gep-reader.mjs do helper procura primeiro (`ownGepDb`). */
const DB_FILE =
  process.env.TFT_BRIDGE_DB ||
  path.join(
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    PRODUCT,
    "tft-events.db",
  );

const status = {
  product: PRODUCT,
  version: app.getVersion(),
  underOwElectron: false,
  gepPackage: "aguardando",
  gepDetail: null,
  game: "nenhum",
  featuresSet: false,
  featuresError: null,
  db: DB_FILE,
  statusPort: STATUS_PORT,
  dev: !app.isPackaged,
  devCredentials: Boolean(process.env.OW_DEV_KEY || process.env.OW_CLI_API_KEY),
  startedAt: Date.now(),
};

let recorder = null;
let win = null;
let tray = null;

const snapshot = () => ({
  ...status,
  recorder: recorder ? recorder.counters() : null,
  gameOpen: recorder ? recorder.hasGame() : false,
});

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 640,
    title: PRODUCT,
    backgroundColor: "#11161c",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "ui", "index.html"));
  win.on("closed", () => {
    win = null;
  });
}

async function boot() {
  status.underOwElectron = Boolean(app.overwolf);
  try {
    recorder = createRecorder({
      file: DB_FILE,
      forward: createForwarder(process.env.BRIDGE_FORWARD_URL),
    });
  } catch (error) {
    status.gepDetail = `gravador indisponivel: ${error.message}`;
  }
  try {
    await createStatusServer(snapshot, { port: STATUS_PORT }).listen();
  } catch (error) {
    status.gepDetail =
      status.gepDetail ?? `porta ${STATUS_PORT} ocupada: ${error.message}`;
  }

  const gep = new GepService(app.overwolf, {
    log: (m) => console.log(`[gep] ${m}`),
  });
  gep.on("unavailable", (m) => {
    status.gepPackage = "indisponivel";
    status.gepDetail = m;
  });
  gep.on("package-failed", () => {
    status.gepPackage = "falhou ao carregar";
    status.gepDetail =
      "Sem credenciais de desenvolvimento (OW_DEV_KEY) ou app nao assinado: o Overwolf nao libera o GEP.";
  });
  gep.on("ready", () => {
    status.gepPackage = "pronto";
    status.gepDetail = null;
  });
  gep.on("game-detected", (_id, name, info) => {
    status.game = `detectado: ${name}`;
    recorder?.gameDetected(info);
  });
  gep.on("features-set", () => {
    status.featuresSet = true;
    status.featuresError = null;
  });
  gep.on("features-failed", (_id, m) => {
    status.featuresError = m;
  });
  gep.on("game-exit", () => {
    status.game = "nenhum";
    status.featuresSet = false;
    recorder?.gameExit();
  });
  gep.on("elevated-required", () => {
    status.gepDetail =
      "O jogo roda como administrador: abra esta ponte como administrador tambem.";
  });
  gep.on("message", (kind, info) => recorder?.handle(kind, info));
  gep.start();

  // Se o pacote nao carregar em 20 s, a janela explica o motivo provavel em vez de ficar muda.
  setTimeout(() => {
    if (status.gepPackage === "aguardando") {
      status.gepDetail = status.devCredentials
        ? "O pacote gep ainda nao carregou. Veja o log do ow-electron."
        : "O pacote gep nao carregou: defina OW_DEV_KEY (modo de desenvolvimento) ou publique o app assinado.";
    }
  }, 20_000).unref?.();
}

app.whenReady().then(async () => {
  ipcMain.handle("bridge:status", () => snapshot());
  createWindow();
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "ui", "icon.png"),
  );
  if (!icon.isEmpty()) {
    tray = new Tray(icon);
    tray.setToolTip(PRODUCT);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir", click: () => (win ? win.show() : createWindow()) },
        { label: "Sair", click: () => app.quit() },
      ]),
    );
  }
  await boot();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => recorder?.close());
