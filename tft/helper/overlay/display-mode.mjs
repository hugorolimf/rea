// Modo de tela do TFT (tela cheia exclusiva, janela sem borda ou janela), lido do GameUserSettings.ini local do jogo.
// Somente leitura de um arquivo de configuração do usuário: não toca no processo do jogo.
// Enum do Unreal: 0 = tela cheia exclusiva, 1 = janela sem borda (windowed fullscreen), 2 = janela.
import { promises as fsp } from "node:fs";
import path from "node:path";

const MAX_INI_CHARS = 2 * 1024 * 1024;

/**
 * Valor de `FullscreenMode=` (0, 1 ou 2) ou null. Só a chave exata no começo da linha: `LastConfirmedFullscreenMode=`
 * e `PreferredFullscreenMode=` não contam (guardam o modo anterior e a preferência, não o modo em uso).
 */
export function parseFullscreenMode(iniText) {
  if (typeof iniText !== "string" || iniText.length > MAX_INI_CHARS)
    return null;
  const m = /^[ \t]*FullscreenMode[ \t]*=[ \t]*(-?\d+)[ \t]*\r?$/m.exec(
    iniText,
  );
  if (!m) return null;
  const n = Number(m[1]);
  return n === 0 || n === 1 || n === 2 ? n : null;
}

/**
 * Descreve o modo para a página. `kind`: "exclusive" | "borderless" | "windowed" | "unknown".
 * Só a tela cheia exclusiva tem `warn`: nela o Windows não mostra janelas de outros programas sobre o jogo.
 * `rectCoversMonitor` (opcional): a janela do jogo cobre o monitor inteiro.
 */
export function describeFullscreen(mode, { rectCoversMonitor = false } = {}) {
  if (mode === 0) {
    return {
      mode,
      warn: true,
      kind: "exclusive",
      text: "O TFT está em tela cheia exclusiva e o overlay não aparece sobre ele. Mude para Janela ou Janela sem borda nas opções de vídeo do jogo.",
    };
  }
  if (mode === 1) {
    return {
      mode,
      warn: false,
      kind: "borderless",
      text: "TFT em janela sem borda: o overlay aparece sobre o jogo.",
    };
  }
  if (mode === 2) {
    return {
      mode,
      warn: false,
      kind: "windowed",
      text: rectCoversMonitor
        ? "TFT em janela cobrindo o monitor: o overlay aparece sobre o jogo."
        : "TFT em janela: o overlay aparece sobre o jogo.",
    };
  }
  return {
    mode: null,
    warn: false,
    kind: "unknown",
    text: "Não foi possível ler o modo de tela do TFT. O overlay só aparece com o jogo em Janela ou Janela sem borda.",
  };
}

/** Caminho do GameUserSettings.ini do TFT em %LOCALAPPDATA%, ou null se a variável não existir. */
export function gameUserSettingsPath(env = process.env) {
  const base = env?.LOCALAPPDATA;
  if (typeof base !== "string" || !base) return null;
  return path.join(
    base,
    "TFT",
    "Saved",
    "Config",
    "WindowsClient",
    "GameUserSettings.ini",
  );
}

/** Lê o ini (somente leitura) e devolve o modo de tela, ou null se ausente, ilegível ou sem a chave. */
export async function readFullscreenMode(file) {
  if (typeof file !== "string" || !file) return null;
  try {
    return parseFullscreenMode(await fsp.readFile(file, "utf8"));
  } catch {
    return null;
  }
}
