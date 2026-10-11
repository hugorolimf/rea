// Atalhos globais do overlay: a lista ÚNICA (ordem, tecla padrão e rótulos) que o processo principal registra
// (`overlay/main.mjs`) e que o HUD mostra na legenda (`keys.mjs`) e na ajuda (`help.mjs`). O main manda à página o
// resultado do registro (`shortcutList`: tecla configurada + se registrou ou falhou); a página só o apresenta.
// Puro: sem DOM e sem node:*, para rodar no processo principal e na página.

/**
 * Atalhos globais padrão. Teclas de função, de propósito: Ctrl+Alt equivale ao AltGr de teclados como o ABNT2 e um
 * atalho global com ele engoliria caracteres digitados (ex.: Ctrl+Alt+Q é "/"). A ordem das chaves decide quem fica
 * com a tecla quando a configuração repete uma (o primeiro); ações novas entram no fim.
 */
export const DEFAULT_HOTKEYS = Object.freeze({
  toggle: "Control+Shift+F9",
  interactive: "Control+Shift+F10",
  quit: "Control+Shift+F12",
  anchor: "Control+Shift+F11",
  help: "Control+Shift+F8",
  calibrate: "Control+Shift+F7",
  copyComp: "Control+Shift+F6",
});

/** Ids das ações com atalho, na ordem de `DEFAULT_HOTKEYS`. */
export const HOTKEY_IDS = Object.freeze(Object.keys(DEFAULT_HOTKEYS));

/**
 * Ações com atalho, na ordem em que a legenda e a ajuda as mostram (a de uso). `label`: texto da ajuda; `short`: texto
 * curto da legenda sobre o jogo.
 */
export const HOTKEY_ACTIONS = Object.freeze(
  [
    {
      id: "toggle",
      label: "Mostrar ou ocultar o overlay",
      short: "Mostrar/ocultar",
      icon: "◐",
    },
    {
      id: "interactive",
      label:
        "Modo de edição: mover e redimensionar os blocos (Esc volta ao jogo)",
      short: "Editar",
      icon: "✥",
    },
    {
      id: "copyComp",
      label: "Copiar o código da comp (cole no Planejador do jogo)",
      short: "Copiar comp",
      icon: "⧉",
    },
    { id: "help", label: "Abrir ou fechar a ajuda", short: "Ajuda", icon: "?" },
    {
      id: "calibrate",
      label: "Calibrar as marcas sobre o jogo",
      short: "Calibrar",
      icon: "⌖",
    },
    {
      id: "anchor",
      label: "Procurar a janela do jogo de novo",
      short: "Procurar o jogo",
      icon: "⌕",
    },
    { id: "quit", label: "Sair do overlay", short: "Sair", icon: "✕" },
  ].map((a) => Object.freeze(a)),
);

const okOf = (v) => (v === true ? true : v === false ? false : null);
const text = (v) => (typeof v === "string" ? v : "");

/**
 * Lista de atalhos como o processo principal a registrou: `[{ id, accelerator, label, short, ok }]` na ordem de
 * `HOTKEY_ACTIONS`. `hotkeys`: `cfg.hotkeys`; `status[id]`: true (registrado), false (falhou: tecla em uso por outro
 * programa ou inválida) ou ausente (ainda não tentado: ok null).
 */
export function shortcutList(hotkeys, status = {}) {
  return HOTKEY_ACTIONS.map((a) => ({
    id: a.id,
    accelerator: text(hotkeys?.[a.id]),
    label: a.label,
    short: a.short,
    icon: a.icon,
    ok: okOf(status?.[a.id]),
  }));
}

/**
 * Lista recebida do host em forma segura (a página não confia no formato). Com a lista do main (`raw` = `mode.shortcuts`),
 * vale a tecla e o resultado do registro dela; sem lista (host antigo), deriva de `hotkeys` com `ok` null. Os rótulos
 * vêm sempre deste módulo. Nunca lança.
 */
export function parseShortcuts(raw, hotkeys) {
  const byId = new Map();
  if (Array.isArray(raw))
    for (const e of raw)
      if (
        e &&
        typeof e === "object" &&
        typeof e.id === "string" &&
        !byId.has(e.id)
      )
        byId.set(e.id, e);
  const fromHost = byId.size > 0;
  return HOTKEY_ACTIONS.map((a) => {
    const e = byId.get(a.id);
    return {
      id: a.id,
      accelerator: fromHost ? text(e?.accelerator) : text(hotkeys?.[a.id]),
      label: a.label,
      short: a.short,
      icon: a.icon,
      ok: fromHost ? okOf(e?.ok) : null,
    };
  });
}

const KEY_NAMES = new Map([
  ["control", "Ctrl"],
  ["ctrl", "Ctrl"],
  ["commandorcontrol", "Ctrl"],
  ["cmdorctrl", "Ctrl"],
  ["shift", "Shift"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["altgr", "AltGr"],
  ["super", "Win"],
  ["meta", "Win"],
  ["command", "Cmd"],
  ["cmd", "Cmd"],
]);

/** Partes de um acelerador para exibir: `{ mods: ["Ctrl","Shift"], key: "F9" }` (vazio: mods [] e key ""). */
export function keyParts(accelerator) {
  const parts = text(accelerator)
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { mods: [], key: "" };
  const key = parts[parts.length - 1];
  return {
    mods: parts.slice(0, -1).map((m) => KEY_NAMES.get(m.toLowerCase()) ?? m),
    key: key.length === 1 ? key.toUpperCase() : key,
  };
}

/** Acelerador como texto curto para pessoas ("Control+Shift+F9" -> "Ctrl+Shift+F9"); vazio vira "". */
export function keyText(accelerator) {
  const { mods, key } = keyParts(accelerator);
  return [...mods, key].filter(Boolean).join("+");
}

/**
 * Modificadores comuns a todos os atalhos com tecla (ex.: "Ctrl+Shift"), para a legenda escrever uma vez só e mostrar
 * em cada linha só a tecla final. "" quando não há um conjunto comum (cada linha mostra o atalho inteiro).
 */
export function commonModifiers(list) {
  let common = null;
  for (const s of list ?? []) {
    const { mods, key } = keyParts(s?.accelerator);
    if (!key) continue;
    const sig = mods.join("+");
    if (common === null) common = sig;
    else if (common !== sig) return "";
  }
  return common ?? "";
}
