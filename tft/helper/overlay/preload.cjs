"use strict";
// Ponte mínima e fixa entre o HUD e o processo principal (contrato `window.overlayHost`, versão 4).
// Cada versão só ACRESCENTA métodos à anterior (a 3: copiar comp e regiões quentes; a 4: atalhos do painel da comp); todos os nomes antigos continuam. O main revalida tudo com os parsers:
// as checagens daqui só evitam enviar lixo. A ponte nunca envia entrada ao jogo; só pede ajustes da própria janela.
// `require` é obrigatório: o preload do Electron roda em CommonJS (e em sandbox não aceita `import`).
// oxlint-disable-next-line typescript/no-var-requires
const { contextBridge, ipcRenderer } = require("electron");

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isBool = (v) => typeof v === "boolean";
const MODES = new Set(["integrated", "panel"]);
const COMP_ACTIONS = new Set(["toggle", "show", "prev", "next"]);
const send = (channel, ...args) => {
  ipcRenderer.send(channel, ...args);
};

contextBridge.exposeInMainWorld(
  "overlayHost",
  Object.freeze({
    version: 4,
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
    // --- v3 ---
    /**
     * Copia o código de equipe pelo processo principal (a janela não é focável, então `navigator.clipboard` não serve).
     * Devolve `{ ok, reason? }`; o main revalida o formato antes de gravar na área de transferência.
     */
    copyTeamCode: (code) =>
      typeof code === "string" && code.length <= 64
        ? ipcRenderer.invoke("overlay:copyTeamCode", code)
        : Promise.resolve({ ok: false, reason: "código inválido" }),
    /** Ponteiro sobre uma região quente (`[data-hot]`): o main confere o cursor e só então tira o click-through. */
    setHot: (on) => {
      if (isBool(on)) send("overlay:setHot", on);
    },
    /** Onde estão as regiões quentes (`[{x,y,width,height}]` em px CSS); o main limita a quantidade e o tamanho. */
    setHotRects: (rects) => {
      if (Array.isArray(rects) && rects.length <= 8)
        send(
          "overlay:setHotRects",
          rects.filter(isObj).map((r) => ({
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          })),
        );
    },
    /** Atalho global "Copiar comp": o main pede e a página copia pelo mesmo caminho do botão. */
    onCopyRequest(cb) {
      if (typeof cb !== "function") return () => {};
      const handler = () => {
        try {
          cb();
        } catch {
          // Erro do HUD não deve derrubar a ponte.
        }
      };
      ipcRenderer.on("overlay:copyRequest", handler);
      return () => {
        ipcRenderer.removeListener("overlay:copyRequest", handler);
      };
    },
    // --- v4 ---
    /**
     * Atalhos do painel da comp: o main avisa a ação ("toggle", "show", "prev" ou "next") e a página mostra, esconde ou
     * troca a comp do painel com os dados que já tem. Nada vai ao servidor nem ao jogo.
     */
    onCompPanel(cb) {
      if (typeof cb !== "function") return () => {};
      const handler = (_event, action) => {
        if (!COMP_ACTIONS.has(action)) return;
        try {
          cb(action);
        } catch {
          // Erro do HUD não deve derrubar a ponte.
        }
      };
      ipcRenderer.on("overlay:compPanel", handler);
      return () => {
        ipcRenderer.removeListener("overlay:compPanel", handler);
      };
    },
  }),
);
