"use strict";
// Liga o pacote `gep` do ow-electron (app.overwolf.packages.gep) ao gravador. Fluxo conforme a documentacao publica do
// Overwolf (pacote carregado -> game-detected -> e.enable() -> setRequiredFeatures -> eventos) e confirmado, em termos de
// nomes de API, na analise estatica do TFTAcademy (ver FONTES-DE-DADOS.md, "GEP proprio"). Nao foi exercitado ao vivo.
const EventEmitter = require("node:events");
const {
  GAME_IDS,
  FEATURES,
  isTftGameId,
  toConfiguredGameId,
} = require("./features.cjs");

const RETRY_MS = 3000;
const MAX_TRIES = 5;

class GepService extends EventEmitter {
  /** `overwolf` = `app.overwolf` do ow-electron (ou um dublê nos testes). */
  constructor(overwolf, { log = () => {}, setTimer = setTimeout } = {}) {
    super();
    this.overwolf = overwolf;
    this.log = log;
    this.setTimer = setTimer;
    this.gep = null;
    this.activeGame = 0;
  }

  start() {
    const packages = this.overwolf?.packages;
    if (!packages) {
      this.emit(
        "unavailable",
        "app.overwolf ausente: execute com ow-electron, nao com electron comum",
      );
      return;
    }
    packages.on("ready", (_e, name, version) => {
      if (name !== "gep") return;
      this.log(`pacote gep pronto (${version})`);
      this.attach();
    });
    packages.on("failed-to-initialize", (_e, name, ...rest) => {
      if (name === "gep") this.emit("package-failed", rest);
    });
    // O pacote pode ja estar pronto quando este servico nasce.
    if (packages.gep) this.attach();
  }

  attach() {
    this.gep = this.overwolf.packages.gep;
    this.gep.removeAllListeners();
    this.gep.on("game-detected", (e, gameId, name, gameInfo) => {
      if (!isTftGameId(gameId)) {
        this.log(`jogo ignorado: ${gameId} ${name}`);
        return;
      }
      this.activeGame = gameId;
      e.enable(); // sem isto o GEP nao entrega eventos do jogo
      this.emit("game-detected", gameId, name, gameInfo);
      this.setFeatures(toConfiguredGameId(gameId), 1);
    });
    this.gep.on("new-info-update", (_e, gameId, info) => {
      if (isTftGameId(gameId)) this.emit("message", "info", info);
    });
    this.gep.on("new-game-event", (_e, gameId, info) => {
      if (isTftGameId(gameId)) this.emit("message", "event", info);
    });
    this.gep.on("game-exit", (_e, gameId) => {
      if (!isTftGameId(gameId)) return;
      this.activeGame = 0;
      this.emit("game-exit", gameId);
    });
    this.gep.on("elevated-privileges-required", (_e, gameId) =>
      this.emit("elevated-required", gameId),
    );
    this.gep.on("error", (_e, gameId, error) => {
      this.log(`erro do gep (${gameId}): ${error}`);
      this.emit("gep-error", gameId, String(error));
    });
    this.emit("ready");
  }

  async setFeatures(gameId, attempt) {
    try {
      await this.gep.setRequiredFeatures(gameId, [...FEATURES]);
      this.emit("features-set", gameId, [...FEATURES]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(
        `setRequiredFeatures falhou (${attempt}/${MAX_TRIES}): ${message}`,
      );
      if (/not supported/i.test(message) || attempt >= MAX_TRIES) {
        this.emit("features-failed", gameId, message);
        return;
      }
      this.setTimer(() => void this.setFeatures(gameId, attempt + 1), RETRY_MS);
    }
  }
}

module.exports = { GepService, GAME_IDS };
