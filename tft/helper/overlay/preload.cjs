"use strict";
// Ponte mínima e fixa entre o HUD e o processo principal (contrato `window.overlayHost`, versão 2).
// A versão 2 só ACRESCENTA métodos à 1; todos os nomes antigos continuam. O main revalida tudo com os parsers:
// as checagens daqui só evitam enviar lixo. A ponte nunca envia entrada ao jogo; só pede ajustes da própria janela.
// `require` é obrigatório: o preload do Electron roda em CommonJS (e em sandbox não aceita `import`).
// oxlint-disable-next-line typescript/no-var-requires
const { contextBridge, ipcRenderer } = require("electron");

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isBool = (v) => typeof v === "boolean";
const MODES = new Set(["integrated", "panel"]);
const send = (channel, ...args) => {
  ipcRenderer.send(channel, ...args);
};

contextBridge.exposeInMainWorld(
  "overlayHost",
  Object.freeze({
    version: 2,
    getMode: () => ipcRenderer.invoke("overlay:getMode"),
    onMode(cb) {
      if (typeof cb !== "function") return () => {};
      const handler = (_event, mode) => {
        try {
          cb(mode);
        } catch {
          // Erro do HUD não deve derrubar a ponte.
        }
      };
      ipcRenderer.on("overlay:mode", handler);
      return () => {
        ipcRenderer.removeListener("overlay:mode", handler);
      };
    },
    // --- v1 ---
    adjustScale: (delta) => {
      if (isNum(delta)) send("overlay:adjustScale", delta);
    },
    adjustOpacity: (delta) => {
      if (isNum(delta)) send("overlay:adjustOpacity", delta);
    },
    dragStart: () => send("overlay:dragStart"),
    dragEnd: () => send("overlay:dragEnd"),
    resizeStart: () => send("overlay:resizeStart"),
    resizeEnd: () => send("overlay:resizeEnd"),
    exitInteractive: () => send("overlay:exitInteractive"),
    hide: () => send("overlay:hide"),
    quit: () => send("overlay:quit"),
    // --- v2 ---
    /** true = a janela ignora o mouse (click-through); false = captura (só vale com o modo interativo ligado). */
    setIgnore: (ignore) => {
      if (isBool(ignore)) send("overlay:setIgnore", ignore);
    },
    saveLayout: (layout) => {
      if (isObj(layout)) send("overlay:saveLayout", layout);
    },
    saveCalibration: (calibration) => {
      if (isObj(calibration)) send("overlay:saveCalibration", calibration);
    },
    saveHints: (settings) => {
      if (isObj(settings)) send("overlay:saveHints", settings);
    },
    setHelp: (on) => {
      if (isBool(on)) send("overlay:setHelp", on);
    },
    setCalibrating: (on) => {
      if (isBool(on)) send("overlay:setCalibrating", on);
    },
    setMode: (mode) => {
      if (MODES.has(mode)) send("overlay:setMode", mode);
    },
    setFollow: (on) => {
      if (isBool(on)) send("overlay:setFollow", on);
    },
    refreshGame: () => send("overlay:refreshGame"),
  }),
);
