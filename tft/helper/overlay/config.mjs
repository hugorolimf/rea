// Configuração do overlay: puro (sem Electron), para ser testável com `node --test`.
// Persistência em overlay/overlay.config.json; todo valor inválido volta ao padrão sem derrubar o overlay.
import { promises as fsp } from "node:fs";
import path from "node:path";
import { parseCalibration } from "./hud/geometry.mjs";
import { parseHintSettings } from "./hud/hints.mjs";
import { DEFAULT_HOTKEYS, shortcutList } from "./hud/hotkeys.mjs";
import { parseLayout } from "./hud/layout.mjs";

/** Atalhos globais padrão (a lista única mora em hud/hotkeys.mjs, que a página também usa). */
export { DEFAULT_HOTKEYS };

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
    devReload: false,
    defaultsVersion: DEFAULTS_VERSION,
  };
}

/**
 * Versão dos PADRÕES com que a configuração foi gravada (a origem dos valores). Um arquivo sem o campo é da versão 1 (antes
 * de existir). Quando um padrão muda, a versão sobe e `DEFAULT_CHANGES` diz qual era o valor antigo: na migração, o que
 * está gravado igual ao padrão antigo (o usuário nunca mexeu) passa ao novo; o que o usuário mudou nunca é tocado.
 */
export const DEFAULTS_VERSION = 2;

/**
 * O que mudou nos padrões ao sair de cada versão. `hints`: campo -> { old, now }; `layout`: elemento -> { old, now }
 * (elemento inteiro, comparado campo a campo).
 * - v1 -> v2: overlay compacto, verbosidade das dicas "normal" -> "minimal". O layout dos elementos existentes não mudou
 *   (a legenda `keys` é nova e já entra com o padrão).
 */
const DEFAULT_CHANGES = Object.freeze([
  Object.freeze({
    from: 1,
    hints: { verbosity: { old: "normal", now: "minimal" } },
    layout: {},
  }),
]);

const sameFields = (a, b) =>
  isObject(a) &&
  isObject(b) &&
  Object.keys(b).every((k) => a[k] === b[k]) &&
  Object.keys(a).every((k) => k in b);

/**
 * Migra o objeto CRU do arquivo (antes de `parseConfig`) para a versão atual dos padrões. Idempotente: na versão atual
 * não muda nada. Devolve `{ raw, migrated, changes }` (`raw` novo quando migrou; `changes` = textos do que mudou).
 * Nunca lança.
 */
export function migrateConfig(
  raw,
  changesTable = DEFAULT_CHANGES,
  version = DEFAULTS_VERSION,
) {
  if (!isObject(raw)) return { raw, migrated: false, changes: [] };
  const from =
    Number.isInteger(raw.defaultsVersion) && raw.defaultsVersion >= 1
      ? raw.defaultsVersion
      : 1;
  if (from >= version) return { raw, migrated: false, changes: [] };
  const next = JSON.parse(JSON.stringify(raw));
  const changes = [];
  for (const step of changesTable) {
    if (step.from < from || step.from >= version) continue;
    for (const [k, { old, now }] of Object.entries(step.hints ?? {}))
      if (isObject(next.hints) && next.hints[k] === old) {
        next.hints[k] = now;
        changes.push(`hints.${k}: ${old} -> ${now}`);
      }
    for (const [id, { old, now }] of Object.entries(step.layout ?? {}))
      if (isObject(next.layout) && sameFields(next.layout[id], old)) {
        next.layout[id] = { ...now };
        changes.push(`layout.${id}: padrão antigo -> padrão novo`);
      }
  }
  next.defaultsVersion = version;
  return { raw: next, migrated: true, changes };
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
    // Reinício automático do Electron quando muda o código do processo principal (desenvolvimento): opt-in.
    devReload: parseFlag(src.devReload, false),
    // Ausente = já na versão atual (arquivo novo); arquivos antigos passam por `migrateConfig` antes daqui.
    defaultsVersion:
      Number.isInteger(src.defaultsVersion) && src.defaultsVersion >= 1
        ? src.defaultsVersion
        : DEFAULTS_VERSION,
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
 * Decide se a janela ignora o mouse (click-through). Fora do modo interativo ignora, exceto com `hotCapture` (o cursor
 * REAL está sobre uma região quente, como o botão "Copiar comp", conferido pelo processo principal). No modo interativo
 * (modo de edição, também com a ajuda ou a calibração) a janela captura o mouse INTEIRA, no painel e no integrado: com o
 * jogo em primeiro plano o movimento encaminhado (`forward`) não chega à página, então depender dele mandava o clique
 * para o jogo. Nesse modo o jogo não recebe cliques (é o esperado); Ctrl+Shift+F10 ou Esc voltam ao jogo.
 * `mode` e `pageCapture` ficam no contrato por compatibilidade; não mudam mais a decisão.
 */
export function mouseIgnore({ interactive, hotCapture }) {
  if (interactive === true) return false;
  return hotCapture !== true;
}

/** No máximo tantas regiões quentes por página, cada uma com no máximo este tamanho (px CSS). */
export const HOT_LIMITS = Object.freeze({ count: 4, width: 640, height: 200 });

/**
 * Regiões quentes declaradas pela página (`[{x,y,width,height}]` em px CSS da janela): só as válidas, no máximo
 * `HOT_LIMITS.count`, cada uma limitada ao tamanho máximo. Lixo vira []. Nunca lança.
 */
export function parseHotRects(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (out.length >= HOT_LIMITS.count) break;
    if (!isObject(r)) continue;
    const { x, y, width, height } = r;
    if (![x, y, width, height].every(finite) || width <= 0 || height <= 0)
      continue;
    if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) continue;
    out.push({
      x,
      y,
      width: Math.min(width, HOT_LIMITS.width),
      height: Math.min(height, HOT_LIMITS.height),
    });
  }
  return out;
}

/**
 * O cursor (DIP da tela) está sobre alguma região quente? `bounds`: área de conteúdo da janela (DIP); `zoom`: zoom do
 * webContents (px CSS x zoom = DIP); `pad`: folga em px CSS. É a conferência do processo principal: a página só pede.
 */
export function cursorInHotRects(cursor, bounds, zoom, rects, pad = 2) {
  if (!isObject(cursor) || !isObject(bounds) || !Array.isArray(rects))
    return false;
  if (![cursor.x, cursor.y, bounds.x, bounds.y].every(finite)) return false;
  const z = finite(zoom) && zoom > 0 ? zoom : 1;
  const x = (cursor.x - bounds.x) / z,
    y = (cursor.y - bounds.y) / z;
  return rects.some(
    (r) =>
      x >= r.x - pad &&
      x <= r.x + r.width + pad &&
      y >= r.y - pad &&
      y <= r.y + r.height + pad,
  );
}

/**
 * Código de equipe do Planejador do jogo como `team-code.mjs` o monta: "02" + 10 ids de 3 dígitos hexa + sufixo do set
 * ("TFTSet18"). O processo principal só grava na área de transferência o que passa por aqui.
 */
export function isTeamCode(v) {
  return (
    typeof v === "string" && /^02[0-9a-f]{30}TFTSet[0-9A-Za-z_]{1,8}$/.test(v)
  );
}

/**
 * Objeto `Mode` completo enviado à página (`window.overlayHost`). `game` = { found, width, height, fullscreen };
 * `hotkeyStatus[id]` = resultado do registro de cada atalho (true/false), que vai na lista `shortcuts`.
 */
export function buildMode({ ui, cfg, game, hotkeyStatus = {} }) {
  return {
    interactive: ui.interactive === true,
    help: ui.help === true,
    calibrating: ui.calibrating === true,
    mode: cfg.mode,
    follow: cfg.follow,
    scale: cfg.scale,
    opacity: cfg.opacity,
    hotkeys: { ...cfg.hotkeys },
    shortcuts: shortcutList(cfg.hotkeys, hotkeyStatus),
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

/** Sufixo do backup: AAAAMMDD-HHMMSS (hora local). */
export function backupStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/**
 * Lê o arquivo e, se ele é de uma versão antiga dos padrões, migra (`migrateConfig`): faz o backup
 * `overlay.config.json.bak-AAAAMMDD-HHMMSS` ao lado e grava o migrado. Devolve `{ cfg, text, migration }`: `text` é o
 * que ficou no disco (para o main distinguir a própria gravação), `migration` = `{ backup, changes }` ou null.
 * Arquivo ausente ou corrompido: padrão, sem migrar nem gravar.
 */
export async function loadAndMigrateConfig(file, now = new Date()) {
  let text;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch {
    return { cfg: defaultConfig(), text: null, migration: null };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { cfg: parseConfig(text), text, migration: null };
  }
  const m = migrateConfig(raw);
  if (!m.migrated) return { cfg: parseConfig(raw), text, migration: null };
  const backup = `${file}.bak-${backupStamp(now)}`;
  await fsp.copyFile(file, backup);
  const cfg = parseConfig(m.raw);
  const written = await saveConfig(file, cfg);
  return { cfg, text: written, migration: { backup, changes: m.changes } };
}

let tmpCounter = 0;

/**
 * Grava de forma atômica (arquivo temporário na mesma pasta + rename) e devolve o texto gravado (o main o guarda para
 * distinguir a própria gravação de uma edição externa do arquivo).
 */
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
  return body;
}
