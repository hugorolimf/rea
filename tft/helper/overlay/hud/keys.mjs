/**
 * Elemento "Atalhos e Copiar comp" do HUD: o botão "Copiar comp" (código de equipe do Planejador do jogo) e a legenda
 * dos atalhos globais, que pode ser recolhida (`layout.keys.folded`, salvo pelo host).
 *
 * A legenda vem de `mode.shortcuts`, a lista que o processo principal montou ao REGISTRAR os atalhos (`hotkeys.mjs`):
 * nenhuma tecla é escrita aqui, e um atalho que falhou (tecla em uso por outro programa) aparece marcado.
 * O código copiado é `plan.teamCode` do modelo da interface web (`v2/js/model.js`), que o overlay já recebe em
 * `/api/overlay`; a cópia é feita pelo processo principal (`overlayHost.copyTeamCode`), porque a janela não é focável.
 * Funções puras (HTML a partir de dados); nada aqui envia entrada ao jogo.
 */
import { commonModifiers, keyParts, keyText } from "./hotkeys.mjs";

/** Título do botão com código (o mesmo da interface web). */
export const COPY_TITLE =
  "Copiar o código da equipe para importar no planejador do jogo";
/** Retorno depois de copiar. */
export const COPIED_TEXT = "Copiado: cole no Planejador";
/** Quanto tempo o retorno fica na tela (ms). */
export const COPY_FLASH_MS = 1500;
/** Retorno de falha e de "sem código" (ms). */
export const COPY_ERROR_MS = 2000;

const FAIL_TITLE =
  "Atalho não registrado: a tecla já está em uso por outro programa (ou é inválida). Feche o outro programa ou troque a tecla em overlay/overlay.config.json.";

/** Motivo de não haver código, pelo estado da tela (`view.status`). */
const REASON_BY_STATUS = Object.freeze({
  loading: "Conectando ao helper.",
  "no-state": "Aguardando a leitura da partida.",
  waiting: "Nova partida: aguardando o primeiro tabuleiro.",
  ended: "Partida encerrada: sem comp para copiar.",
  idle: "Sem comp sugerida agora.",
});

/**
 * Situação do botão para o modelo de tela (`overlayView`): `{ code, reason, title }`. Com código, `reason` é null e o
 * título diz qual comp; sem código, `code` é null e `reason` explica (erro do servidor ao montar o código ou o estado da
 * partida). Nunca lança.
 */
export function teamCodeState(view) {
  const plan = view?.plan ?? null;
  const code =
    typeof plan?.teamCode === "string" && plan.teamCode ? plan.teamCode : null;
  if (code)
    return {
      code,
      reason: null,
      title: plan.title ? `${COPY_TITLE}: ${plan.title}` : COPY_TITLE,
    };
  const reason = plan
    ? typeof plan.teamCodeError === "string" && plan.teamCodeError
      ? plan.teamCodeError
      : "A comp sugerida não tem código de equipe."
    : (REASON_BY_STATUS[view?.status] ?? "Sem comp sugerida agora.");
  return { code: null, reason, title: reason };
}

/**
 * Aviso do modo de edição (modo interativo integrado): nele a janela captura o mouse inteira e o jogo não recebe
 * cliques. A tecla vem de `mode.shortcuts` (a lista do registro). Vazio fora do modo.
 */
export function editBannerHtml(mode, esc) {
  if (!mode?.interactive || mode.mode !== "integrated") return "";
  const key = (mode.shortcuts ?? []).find((s) => s.id === "interactive");
  const exit = key?.accelerator ? `${keyText(key.accelerator)} ou Esc` : "Esc";
  return `<p class="edit-warn"><b>Modo de edição</b><span>arraste os blocos · cliques não vão para o jogo · ${esc(exit)} para voltar ao jogo</span></p>`;
}

const tone = (t) => (t === "ok" || t === "bad" || t === "warn" ? t : "warn");

/**
 * HTML do elemento, compacto: só teclas e ícones ("F9 ◐ · F10 ✥ · F6 ⧉"); o significado de cada um vai na dica do
 * mouse e no "?". `shortcuts`: `mode.shortcuts` normalizado (`parseShortcuts`); `folded`: legenda recolhida (sobram os
 * dois botões); `copy`: `teamCodeState(view)`; `flash`: retorno atual (`{ text, tone }`) ou null; `esc`: escape de HTML.
 * O botão de copiar e o de recolher são as únicas partes clicáveis fora do modo de edição (`data-hot`, conferidas pelo
 * cursor real no processo principal). Sem código o botão fica apagado (`aria-disabled`) e o clique ou o atalho mostram o
 * motivo por 2 s.
 */
export function keysHtml({
  shortcuts = [],
  folded = false,
  copy,
  flash = null,
  esc,
}) {
  const list = shortcuts.filter((s) => s && typeof s.id === "string");
  const failed = list.filter((s) => s.ok === false);
  const copyKey = list.find((s) => s.id === "copyComp");
  const copyHint = copyKey?.accelerator
    ? ` (${keyText(copyKey.accelerator)})`
    : "";
  const can = !!copy?.code;
  const copyBtn = `<button type="button" class="keys-copy" data-hot data-hit data-act="copy-comp" aria-disabled="${can ? "false" : "true"}" title="${esc(can ? `${copy.title}${copyHint}` : `Sem código para copiar: ${copy?.reason ?? ""}`)}">⧉ Copiar</button>`;
  const failNote = failed.length
    ? `<b class="keys-failn" title="${esc(FAIL_TITLE)}">${failed.length}✖</b>`
    : "";
  const fold = `<button type="button" class="keys-fold" data-hot data-hit data-act="fold-keys" aria-expanded="${folded ? "false" : "true"}" title="${folded ? "Mostrar os atalhos" : "Recolher os atalhos"}">⌨${folded ? "▸" : "▾"}${failNote}</button>`;
  const note = flash?.text
    ? `<p class="keys-flash" role="status" aria-live="polite" data-tone="${tone(flash.tone)}">${esc(flash.text)}</p>`
    : `<p class="keys-flash" role="status" aria-live="polite" hidden></p>`;
  const head = `<div class="keys-head">${copyBtn}${fold}</div>${note}`;
  if (folded) return head;
  const mods = commonModifiers(list);
  const rows = list
    .map((s) => {
      const { key } = keyParts(s.accelerator);
      const shown = !s.accelerator ? "—" : mods ? key : keyText(s.accelerator);
      const state = s.ok === false ? "0" : s.ok === true ? "1" : "?";
      const title =
        s.ok === false
          ? `${s.label}: ${keyText(s.accelerator)}. ${FAIL_TITLE}`
          : `${s.label}${s.accelerator ? `: ${keyText(s.accelerator)}` : " (sem atalho)"}`;
      return `<li data-ok="${state}" data-id="${esc(s.id)}" title="${esc(title)}"><kbd>${esc(shown)}</kbd><i aria-label="${esc(s.short)}">${esc(s.icon ?? "")}</i>${s.ok === false ? '<b class="keys-fail">✖</b>' : ""}</li>`;
    })
    .join("");
  const pre = mods
    ? `<li class="keys-pre" title="${esc(`Todos os atalhos usam ${mods} + a tecla`)}"><kbd>${esc(mods)}</kbd>+</li>`
    : "";
  return `${head}<ul class="keys-list">${pre}${rows}</ul>`;
}
