/**
 * Painel de ajuda ("?"): atalhos, categorias de dica, verbosidade, opacidade e escala, visibilidade dos elementos,
 * calibrar, modo (integrado ou painel), seguir o jogo e a saúde das fontes. `helpHtml` e `helpAction` são puras (HTML e
 * a chamada do host que cada botão faz); `mountHelp` só liga os cliques ao `window.overlayHost`. O painel muda ajustes
 * do próprio overlay: nada aqui envia entrada ao jogo.
 */
import { HINT_CATEGORIES, VERBOSITY_LEVELS } from "./hints.mjs";
import { HOTKEY_ACTIONS, parseShortcuts } from "./hotkeys.mjs";
import {
  ELEMENT_IDS,
  ELEMENT_LABELS,
  resetLayout,
  setHidden,
} from "./layout.mjs";

/** Passo dos botões de escala e de opacidade (iguais aos da barra de ferramentas). */
export const SCALE_STEP = 0.1;
export const OPACITY_STEP = 0.05;

export const CATEGORY_LABELS = Object.freeze({
  buy: "Comprar (loja)",
  items: "Itens",
  gold: "Ouro e nível",
  wisp: "Wisps",
  learn: "Aprender (explicações)",
});

export const VERBOSITY_LABELS = Object.freeze({
  minimal: "Mínima",
  normal: "Normal",
  detailed: "Detalhada",
});

/**
 * Atalhos mostrados na ajuda, na ordem de uso: `[id, rótulo]` derivado da lista única (`hotkeys.mjs`). A tecla e o
 * resultado do registro vêm de `mode.shortcuts`, a lista que o main registrou (a mesma da legenda).
 */
export const HOTKEY_LABELS = Object.freeze(
  HOTKEY_ACTIONS.map((a) => Object.freeze([a.id, a.label])),
);

const percent = (v) =>
  typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "?";

/**
 * Chamada do host para um botão da ajuda: `{ name, args }` ou null (botão desconhecido ou dado inválido).
 * `data`: o `dataset` do botão (`act`, `cat`, `v`, `id`, `m`, `d`); `mode`: o modo atual (normalizado).
 */
export function helpAction(data, mode) {
  const hints = mode.hints;
  switch (data?.act) {
    case "close":
      return { name: "setHelp", args: [false] };
    case "cat":
      if (!HINT_CATEGORIES.includes(data.cat)) return null;
      return {
        name: "saveHints",
        args: [
          {
            ...hints,
            categories: {
              ...hints.categories,
              [data.cat]: !hints.categories[data.cat],
            },
          },
        ],
      };
    case "verb":
      if (!VERBOSITY_LEVELS.includes(data.v)) return null;
      return { name: "saveHints", args: [{ ...hints, verbosity: data.v }] };
    case "scale":
    case "opacity": {
      const d = Number(data.d);
      if (!Number.isFinite(d)) return null;
      return {
        name: data.act === "scale" ? "adjustScale" : "adjustOpacity",
        args: [d],
      };
    }
    case "el":
      if (!ELEMENT_IDS.includes(data.id) || !mode.layout[data.id]) return null;
      return {
        name: "saveLayout",
        args: [setHidden(mode.layout, data.id, !mode.layout[data.id].hidden)],
      };
    case "reset":
      return { name: "saveLayout", args: [resetLayout()] };
    case "calibrate":
      return { name: "setCalibrating", args: [!mode.calibrating] };
    case "mode":
      if (data.m !== "integrated" && data.m !== "panel") return null;
      return { name: "setMode", args: [data.m] };
    case "follow":
      return { name: "setFollow", args: [!mode.follow] };
    case "refresh":
      return { name: "refreshGame", args: [] };
    default:
      return null;
  }
}

/**
 * Seção "Tamanho do jogo": o tamanho detectado, a escala efetiva e o que a adaptação automática fez (recolheu ou moveu).
 * `fit`: `fitSummary(...)` (ou nada, e a seção some). A adaptação só vale fora do modo interativo, e a nota diz isso.
 */
export function fitHtml(fit, esc) {
  if (!fit?.lines?.length) return "";
  const lines = fit.lines
    .map((l) => {
      const tone = /^(?:Recolhido|Janela pequena)/.test(l)
        ? ' data-tone="warn"'
        : "";
      return `<li${tone}>${esc(l)}</li>`;
    })
    .join("");
  return `<h4>Tamanho do jogo</h4><ul class="hp-fit">${lines}</ul><p class="hp-note">O overlay se adapta sozinho: reposiciona e recolhe o que não cabe, sem mexer no layout salvo. No modo interativo você vê e edita o layout salvo.</p>`;
}

/**
 * HTML do painel. `mode`: modo normalizado; `health`: `healthOf(...)`; `ui`: `{ esc, glyph }`; `fit`: `fitSummary(...)`
 * (opcional). Fora do modo integrado, os controles de elementos, calibração e seguir o jogo ficam desabilitados.
 */
export function helpHtml(mode, health, ui, fit = null) {
  const { esc, glyph } = ui,
    integrated = mode.mode === "integrated",
    off = integrated ? "" : " disabled",
    toggle = (on, attrs, label, extra = "") =>
      `<button type="button" class="hp-tog" aria-pressed="${on ? "true" : "false"}" ${attrs}${extra}>${esc(label)}</button>`;
  // A mesma lista da legenda: a do registro feito pelo main (modo antigo sem ela: deriva de `mode.hotkeys`).
  const shortcuts = Array.isArray(mode.shortcuts)
    ? mode.shortcuts
    : parseShortcuts(null, mode.hotkeys);
  const keys = shortcuts
    .map(
      (s) =>
        `<li${s.ok === false ? ' data-ok="0" title="Não registrado: a tecla já está em uso por outro programa (ou é inválida)."' : ""}><kbd>${esc(s.accelerator || "sem atalho")}</kbd><span>${esc(s.label)}${s.ok === false ? " <b>(falhou: tecla em uso)</b>" : ""}</span></li>`,
    )
    .join("");
  const cats = HINT_CATEGORIES.map((c) =>
    toggle(
      mode.hints.categories[c],
      `data-act="cat" data-cat="${c}"`,
      CATEGORY_LABELS[c] ?? c,
    ),
  ).join("");
  const verbs = VERBOSITY_LEVELS.map((v) =>
    toggle(
      mode.hints.verbosity === v,
      `data-act="verb" data-v="${v}"`,
      VERBOSITY_LABELS[v] ?? v,
    ),
  ).join("");
  const els = ELEMENT_IDS.map((id) =>
    toggle(
      !mode.layout[id]?.hidden,
      `data-act="el" data-id="${id}"`,
      ELEMENT_LABELS[id] ?? id,
      off,
    ),
  ).join("");
  const dots = health
    .map(
      (h) =>
        `<li title="${esc(h.title)}"><i class="dot" data-ok="${h.ok === true ? "1" : h.ok === false ? "0" : "?"}"></i><span>${esc(h.text)}</span></li>`,
    )
    .join("");
  const warn = mode.game.fullscreen?.warn
    ? `<p class="hp-warn" role="alert">${glyph("warn")} ${esc(mode.game.fullscreen.text || "Tela cheia exclusiva: use janela ou janela sem borda.")}</p>`
    : "";
  const step = (act, d, label) =>
    `<button type="button" class="hp-btn" data-act="${act}" data-d="${d}" title="${esc(label)}">${d < 0 ? "−" : "+"}</button>`;
  return `<header class="hp-head"><b>Ajuda do overlay</b><button type="button" class="hp-btn" data-act="close" title="Fechar a ajuda">Fechar</button></header>${warn}<div class="hp-cols"><section><h4>Atalhos</h4><ul class="hp-keys">${keys}</ul><h4>Aparência</h4><div class="hp-row"><span>Escala</span>${step("scale", -SCALE_STEP, "Diminuir a escala")}<output>${esc(percent(mode.scale))}</output>${step("scale", SCALE_STEP, "Aumentar a escala")}</div><div class="hp-row"><span>Opacidade</span>${step("opacity", -OPACITY_STEP, "Diminuir a opacidade")}<output>${esc(percent(mode.opacity))}</output>${step("opacity", OPACITY_STEP, "Aumentar a opacidade")}</div><h4>Fontes de dados</h4><ul class="hp-health">${dots}</ul>${integrated ? fitHtml(fit, esc) : ""}</section><section><h4>Dicas na tela</h4><div class="hp-tags">${cats}</div><p class="hp-note">Alertas de vida aparecem sempre.</p><h4>Quantidade de dicas</h4><div class="hp-tags">${verbs}</div><h4>Elementos</h4><div class="hp-tags">${els}</div><div class="hp-row"><button type="button" class="hp-btn" data-act="reset"${off}>Resetar posições</button></div><h4>Modo</h4><div class="hp-tags">${toggle(integrated, 'data-act="mode" data-m="integrated"', "Integrado ao jogo")}${toggle(!integrated, 'data-act="mode" data-m="panel"', "Painel")}${toggle(mode.follow, 'data-act="follow"', "Seguir o jogo", off)}</div><div class="hp-row"><button type="button" class="hp-btn" data-act="calibrate"${off} aria-pressed="${mode.calibrating ? "true" : "false"}">${mode.calibrating ? "Concluir a calibração" : "Calibrar"}</button><button type="button" class="hp-btn" data-act="refresh"${off}>Procurar o jogo</button></div></section></div><p class="hp-note">O overlay só aparece sobre o jogo em janela ou janela sem borda. Ele apenas mostra: não clica, não digita e não lê o jogo.</p>`;
}

/**
 * Liga o painel ao host. `node`: contêiner do painel (recebe `data-hit`); `getMode()`: modo atual. Devolve
 * `{ render(mode, health, ui, fit) }`, que redesenha só quando o HTML muda e mostra ou esconde conforme `mode.help`.
 */
export function mountHelp(node, host, getMode) {
  node.dataset.hit = "";
  node.addEventListener("click", (e) => {
    const button =
      e.target instanceof Element ? e.target.closest("[data-act]") : null;
    if (!button || button.disabled) return;
    const action = helpAction({ ...button.dataset }, getMode());
    if (!action) return;
    Promise.resolve()
      .then(() => host?.[action.name]?.(...action.args))
      .catch(() => {});
  });
  return {
    render(mode, health, ui, fit = null) {
      node.hidden = !mode.help;
      if (!mode.help) return;
      const html = helpHtml(mode, health, ui, fit);
      if (node.dataset.sig !== html) {
        node.dataset.sig = html;
        node.innerHTML = html;
      }
    },
  };
}
