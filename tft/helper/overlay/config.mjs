// Configuração do overlay: puro (sem Electron), para ser testável com `node --test`.
// Persistência em overlay/overlay.config.json; todo valor inválido volta ao padrão sem derrubar o overlay.
import { promises as fsp } from "node:fs";
import path from "node:path";
import { parseCalibration } from "./hud/geometry.mjs";
import { parseHintSettings } from "./hud/hints.mjs";
import { parseLayout } from "./hud/layout.mjs";

/** Porta padrão do servidor do helper. */
export const DEFAULT_PORT = 3218;
/** Intervalo permitido para a escala (zoom do HUD). */
export const SCALE_RANGE = Object.freeze({ min: 0.6, max: 2 });
/** Intervalo permitido para a opacidade da janela. */
export const OPACITY_RANGE = Object.freeze({ min: 0.2, max: 1 });
/** Tamanho mínimo da janela, em DIP. */
export const MIN_SIZE = Object.freeze({ width: 240, height: 160 });
/** Tamanho inicial da janela, em DIP. */
export const DEFAULT_SIZE = Object.freeze({ width: 420, height: 640 });
/**
 * Atalhos globais padrão. Teclas de função, de propósito: Ctrl+Alt equivale ao AltGr de teclados como o ABNT2 e um
 * atalho global com ele engoliria caracteres digitados (ex.: Ctrl+Alt+Q é "/").
 */
export const DEFAULT_HOTKEYS = Object.freeze({
  toggle: "Control+Shift+F9",
  interactive: "Control+Shift+F10",
  quit: "Control+Shift+F12",
  anchor: "Control+Shift+F11",
  help: "Control+Shift+F8",
  calibrate: "Control+Shift+F7",
});
/** Modos de exibição: "integrated" cobre a janela do jogo; "panel" é o painel pequeno da fase 1. */
export const MODES = Object.freeze(["integrated", "panel"]);

const HOTKEY_NAMES = Object.keys(DEFAULT_HOTKEYS);
const MAX_COORD = 100000;
const MAX_SIZE = 20000;

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Configuração padrão. `port` e `bounds` nulos significam "derivar": env/3218 e canto do monitor escolhido.
 * `bounds` é só o retângulo do modo painel; no modo integrado a posição vem da janela do jogo.
 */
export function defaultConfig() {
  return {
    port: null,
    display: "primary",
    bounds: null,
    scale: 1,
    opacity: 0.92,
    visible: true,
    hotkeys: { ...DEFAULT_HOTKEYS },
    mode: "integrated",
    follow: true,
    layout: parseLayout(undefined),
    calibration: parseCalibration(undefined),
    hints: parseHintSettings(undefined),
  };
}

/** "integrated" ou "panel"; qualquer outra coisa vira "integrated". */
export function parseMode(v) {
  return v === "panel" ? "panel" : "integrated";
}

/** Booleano estrito; qualquer outra coisa vira o padrão. */
export function parseFlag(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}

/** Porta TCP válida (inteiro 1..65535, número ou texto de dígitos) ou null. */
export function parsePort(v) {
  const n = typeof v === "string" && /^\d{1,5}$/.test(v.trim()) ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/** Porta efetiva: config.port, depois TFT_HELPER_PORT, depois 3218. */
export function resolvePort(cfg, env = {}) {
  return cfg?.port ?? parsePort(env.TFT_HELPER_PORT) ?? DEFAULT_PORT;
}

/** "primary" | "cursor" | "game" | id numérico de monitor; qualquer outra coisa vira "primary". */
export function parseDisplay(v) {
  if (v === "primary" || v === "cursor" || v === "game") return v;
  if (typeof v === "string" && /^\d{1,15}$/.test(v.trim())) return Number(v);
  return Number.isInteger(v) && v >= 0 ? v : "primary";
}

/** Retângulo {x,y,width,height} em inteiros (largura/altura limitadas ao mínimo e máximo) ou null. */
export function parseBounds(v) {
  if (!isObject(v)) return null;
  const { x, y, width, height } = v;
  if (![x, y, width, height].every(finite)) return null;
  if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: clamp(Math.round(width), MIN_SIZE.width, MAX_SIZE),
    height: clamp(Math.round(height), MIN_SIZE.height, MAX_SIZE),
  };
}

/** Escala numérica limitada a SCALE_RANGE (não numérico: 1). */
export function parseScale(v) {
  return finite(v) ? round2(clamp(v, SCALE_RANGE.min, SCALE_RANGE.max)) : 1;
}

/** Opacidade numérica limitada a OPACITY_RANGE (não numérica: 0.92). */
export function parseOpacity(v) {
  return finite(v)
    ? round2(clamp(v, OPACITY_RANGE.min, OPACITY_RANGE.max))
    : 0.92;
}

const MODIFIERS = new Map([
  ["control", "control"],
  ["ctrl", "control"],
  ["alt", "alt"],
  ["option", "alt"],
  ["altgr", "altgr"],
  ["shift", "shift"],
  ["super", "super"],
  ["meta", "super"],
  ["command", "command"],
  ["cmd", "command"],
  ["commandorcontrol", "commandorcontrol"],
  ["cmdorctrl", "commandorcontrol"],
]);

/**
 * Forma canônica de um acelerador ("ctrl+alt+o" e "Alt+Control+O" coincidem) ou null se for inválido.
 * Exige ao menos um modificador, para o atalho global nunca capturar uma tecla solta do jogo.
 */
export function normalizeAccelerator(v) {
  if (typeof v !== "string" || v.length > 64) return null;
  const parts = v.split("+");
  if (parts.length < 2) return null;
  const key = parts[parts.length - 1];
  if (!/^(?:[A-Za-z0-9]+|[^\sA-Za-z0-9+])$/.test(key)) return null;
  if (MODIFIERS.has(key.toLowerCase())) return null;
  const mods = new Set();
  for (const part of parts.slice(0, -1)) {
    const mod = MODIFIERS.get(part.toLowerCase());
    if (!mod) return null;
    mods.add(mod);
  }
  return [...mods].sort().concat(key.toLowerCase()).join("+");
}

/** Atalhos válidos e sem repetição; o inválido ou repetido volta ao padrão daquela ação. */
export function parseHotkeys(v) {
  const raw = isObject(v) ? v : {};
  const out = {};
  const used = new Set();
  for (const name of HOTKEY_NAMES) {
    let accel = raw[name];
    let canon = normalizeAccelerator(accel);
    if (!canon || used.has(canon)) {
      accel = DEFAULT_HOTKEYS[name];
      canon = normalizeAccelerator(accel);
    }
    out[name] = accel;
    used.add(canon);
  }
  return out;
}

/** Valida e normaliza campo a campo; nunca lança. */
export function parseConfig(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  const src = isObject(obj) ? obj : {};
  return {
    port: parsePort(src.port),
    display: parseDisplay(src.display),
    bounds: parseBounds(src.bounds),
    scale: parseScale(src.scale),
    opacity: parseOpacity(src.opacity),
    visible: typeof src.visible === "boolean" ? src.visible : true,
    hotkeys: parseHotkeys(src.hotkeys),
    mode: parseMode(src.mode),
    follow: parseFlag(src.follow, true),
    layout: parseLayout(src.layout),
    calibration: parseCalibration(src.calibration),
    hints: parseHintSettings(src.hints),
  };
}

/**
 * Configuração a gravar. Só o modo painel tem `bounds` próprios: no integrado a janela está sobre o jogo e o retângulo
 * guardado do painel não pode ser sobrescrito. `liveBounds` é o retângulo atual da janela (ou null).
 */
export function configSnapshot(cfg, liveBounds) {
  const next = { ...cfg, hotkeys: { ...cfg.hotkeys } };
  if (cfg.mode === "panel" && liveBounds) next.bounds = liveBounds;
  return next;
}

/** Estado de interação em repouso: tudo desligado (janela click-through). */
export const IDLE_UI = Object.freeze({
  interactive: false,
  help: false,
  calibrating: false,
});

/**
 * Transições do estado de interação. `interactive` é o mestre; ajuda e calibração o implicam e são exclusivas entre si.
 * Ações: toggleInteractive, exitInteractive, setHelp (value), setCalibrating (value), toggleHelp, toggleCalibrating.
 * Sair do interativo desliga ajuda e calibração. Ação desconhecida não muda nada.
 */
export function nextUi(ui, action, value) {
  const cur = {
    interactive: ui?.interactive === true,
    help: ui?.help === true,
    calibrating: ui?.calibrating === true,
  };
  switch (action) {
    case "toggleInteractive":
      return cur.interactive
        ? { ...IDLE_UI }
        : { interactive: true, help: false, calibrating: false };
    case "exitInteractive":
      return { ...IDLE_UI };
    case "setHelp":
      return value === true
        ? { interactive: true, help: true, calibrating: false }
        : { ...cur, help: false };
    case "setCalibrating":
      return value === true
        ? { interactive: true, help: false, calibrating: true }
        : { ...cur, calibrating: false };
    case "toggleHelp":
      return cur.help
        ? { ...IDLE_UI }
        : { interactive: true, help: true, calibrating: false };
    case "toggleCalibrating":
      return cur.calibrating
        ? { ...IDLE_UI }
        : { interactive: true, help: false, calibrating: true };
    default:
      return cur;
  }
}

/**
 * Decide se a janela ignora o mouse (click-through). Fora do modo interativo sempre ignora. No painel interativo captura
 * tudo. No integrado interativo a janela continua ignorando, a menos que a página peça captura (ponteiro sobre um
 * elemento interativo): assim o resto da tela continua clicável no jogo.
 */
export function mouseIgnore({ interactive, mode, pageCapture }) {
  if (interactive !== true) return true;
  if (mode === "panel") return false;
  return pageCapture !== true;
}

/** Objeto `Mode` completo enviado à página (`window.overlayHost`). `game` = { found, width, height, fullscreen }. */
export function buildMode({ ui, cfg, game }) {
  return {
    interactive: ui.interactive === true,
    help: ui.help === true,
    calibrating: ui.calibrating === true,
    mode: cfg.mode,
    follow: cfg.follow,
    scale: cfg.scale,
    opacity: cfg.opacity,
    hotkeys: { ...cfg.hotkeys },
    layout: cfg.layout,
    calibration: cfg.calibration,
    hints: cfg.hints,
    game: {
      found: game?.found === true,
      width: finite(game?.width) ? game.width : null,
      height: finite(game?.height) ? game.height : null,
      fullscreen: game?.fullscreen ?? null,
    },
  };
}

const overlapArea = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

const validRect = (r) =>
  isObject(r) &&
  [r.x, r.y, r.width, r.height].every(finite) &&
  r.width > 0 &&
  r.height > 0;

/** Posição padrão: canto superior direito da área, com margem; o tamanho nunca excede a área. */
export function defaultBounds(area, size = DEFAULT_SIZE, margin = 16) {
  const width = Math.min(Math.round(size.width), area.width);
  const height = Math.min(Math.round(size.height), area.height);
  const m = Math.min(
    margin,
    Math.max(0, area.width - width),
    Math.max(0, area.height - height),
  );
  return { x: area.x + area.width - width - m, y: area.y + m, width, height };
}

/**
 * Recoloca `bounds` dentro do monitor com maior interseção (ou do preferido, se não cruza nenhum).
 * Um retângulo que já cabe inteiro é devolvido sem mudança.
 */
export function fitBounds(bounds, areas, preferredIndex = 0) {
  const list = (areas ?? []).filter(validRect);
  if (!list.length) return { ...bounds };
  let index = -1;
  let best = 0;
  list.forEach((a, i) => {
    const o = overlapArea(bounds, a);
    if (o > best) {
      best = o;
      index = i;
    }
  });
  if (index < 0) index = clamp(preferredIndex, 0, list.length - 1);
  const area = list[index];
  const width = Math.min(Math.max(bounds.width, MIN_SIZE.width), area.width);
  const height = Math.min(
    Math.max(bounds.height, MIN_SIZE.height),
    area.height,
  );
  return {
    x: clamp(bounds.x, area.x, area.x + area.width - width),
    y: clamp(bounds.y, area.y, area.y + area.height - height),
    width,
    height,
  };
}

/** Lê e valida o arquivo; ausente, ilegível ou corrompido devolve o padrão. */
export async function loadConfig(file) {
  try {
    return parseConfig(await fsp.readFile(file, "utf8"));
  } catch {
    return defaultConfig();
  }
}

let tmpCounter = 0;

/** Grava de forma atômica (arquivo temporário na mesma pasta + rename). */
export async function saveConfig(file, cfg) {
  const body = `${JSON.stringify(parseConfig(cfg), null, 2)}\n`;
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    await fsp.writeFile(tmp, body, "utf8");
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
