/**
 * Barra de ferramentas do modo PAINEL interativo. Só existe quando a página roda dentro do Electron
 * (`window.overlayHost`); num navegador comum nada é montado. Fora do modo interativo a barra fica oculta por CSS e a
 * janela é click-through. No modo integrado a barra não aparece: os mesmos ajustes ficam no painel de ajuda ("?").
 */
import { HINT_CATEGORIES, VERBOSITY_LEVELS } from "./hints.mjs";
import {
  CATEGORY_LABELS,
  OPACITY_STEP,
  SCALE_STEP,
  VERBOSITY_LABELS,
} from "./help.mjs";
import { normalizeMode } from "./widgets.mjs";

/** Rótulos curtos das categorias de dica para a barra estreita. */
const CATEGORY_SHORT = {
  buy: "Compra",
  items: "Itens",
  gold: "Ouro",
  wisp: "Wisp",
  learn: "Aprender",
};

/** Executa uma chamada do host sem deixar uma rejeição solta (o host pode devolver promessa ou nada). */
const run = (fn) => {
  Promise.resolve()
    .then(fn)
    .catch(() => {});
};

const percent = (v) =>
  typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "?";

/**
 * Monta a barra em `toolbar` e a alça de redimensionar em `grip`. `host`: `window.overlayHost`. O modo vem de
 * `getMode()` e de `onMode(cb)`; `html[data-interactive="1"]` liga a barra, a borda tracejada e os ponteiros.
 */
export function mountToolbar(toolbar, grip, host) {
  const html = document.documentElement;
  const node = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.append(...kids);
    return n;
  };
  const button = (label, title, onClick, cls = "") => {
    const b = node(
      "button",
      { type: "button", class: `tb-btn ${cls}`, title },
      label,
    );
    b.addEventListener("click", () => run(onClick));
    return b;
  };

  /** Alça com captura do ponteiro: `start` no pressionar e `end` uma única vez ao soltar, cancelar ou perder a captura. */
  const grab = (handle, start, end) => {
    let active = false;
    const finish = () => {
      if (!active) return;
      active = false;
      run(end);
    };
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || active) return;
      active = true;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // Sem captura o arrasto ainda começa; soltar fora da janela cai em pointercancel.
      }
      e.preventDefault();
      run(start);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      handle.addEventListener(type, finish);
    return finish;
  };

  const scaleOut = node("output", { class: "tb-val", title: "Escala atual" }),
    opacityOut = node("output", { class: "tb-val", title: "Opacidade atual" }),
    keys = node("p", { class: "tb-keys" }),
    drag = node(
      "div",
      { class: "tb-drag", title: "Segure e arraste para mover o overlay" },
      "⠿ Arrastar",
    );
  const stopDrag = grab(
    drag,
    () => host.dragStart(),
    () => host.dragEnd(),
  );
  const stopResize = grab(
    grip,
    () => host.resizeStart(),
    () => host.resizeEnd(),
  );

  // Dicas (modo painel): categorias ligam e desligam; a verbosidade gira entre mínima, normal e detalhada.
  let current = normalizeMode(null);
  const saveHints = (next) => {
    if (typeof host.saveHints === "function") host.saveHints(next);
  };
  const catButtons = HINT_CATEGORIES.map((c) => {
    const b = button(
      CATEGORY_SHORT[c] ?? c,
      `Dicas: ${CATEGORY_LABELS[c] ?? c}`,
      () =>
        saveHints({
          ...current.hints,
          categories: {
            ...current.hints.categories,
            [c]: !current.hints.categories[c],
          },
        }),
      "tb-tog",
    );
    b.dataset.cat = c;
    return b;
  });
  const verbButton = button(
    "",
    "Quantidade de dicas (mínima, normal, detalhada)",
    () => {
      const at = VERBOSITY_LEVELS.indexOf(current.hints.verbosity);
      saveHints({
        ...current.hints,
        verbosity: VERBOSITY_LEVELS[(at + 1) % VERBOSITY_LEVELS.length],
      });
    },
  );
  const modeButton = button(
    "Integrado",
    "Cobrir a janela do jogo com marcas ancoradas",
    () => {
      if (typeof host.setMode === "function") host.setMode("integrated");
    },
  );

  toolbar.replaceChildren(
    drag,
    node(
      "div",
      { class: "tb-row" },
      node("span", { class: "tb-lbl" }, "Dicas"),
      ...catButtons,
      verbButton,
    ),
    node(
      "div",
      { class: "tb-row" },
      node("span", { class: "tb-lbl" }, "Escala"),
      button("−", "Diminuir a escala", () => host.adjustScale(-SCALE_STEP)),
      scaleOut,
      button("+", "Aumentar a escala", () => host.adjustScale(SCALE_STEP)),
      node("span", { class: "tb-lbl" }, "Opacidade"),
      button("−", "Diminuir a opacidade", () =>
        host.adjustOpacity(-OPACITY_STEP),
      ),
      opacityOut,
      button("+", "Aumentar a opacidade", () =>
        host.adjustOpacity(OPACITY_STEP),
      ),
    ),
    node(
      "div",
      { class: "tb-row" },
      button("Concluir", "Voltar ao modo click-through", () =>
        host.exitInteractive(),
      ),
      modeButton,
      button("Ocultar", "Esconder o overlay", () => host.hide()),
      button("Sair", "Encerrar o overlay", () => host.quit(), "tb-quit"),
    ),
    keys,
  );

  const apply = (mode) => {
    if (!mode || typeof mode !== "object") return;
    if (mode.interactive === true) html.dataset.interactive = "1";
    else {
      delete html.dataset.interactive;
      // Saiu do modo com uma alça apertada: solta-a para o host não ficar arrastando.
      stopDrag();
      stopResize();
    }
    current = normalizeMode(mode);
    for (const b of catButtons)
      b.setAttribute(
        "aria-pressed",
        current.hints.categories[b.dataset.cat] ? "true" : "false",
      );
    verbButton.textContent = `Dicas: ${VERBOSITY_LABELS[current.hints.verbosity] ?? current.hints.verbosity}`;
    modeButton.hidden = typeof host.setMode !== "function";
    scaleOut.textContent = percent(mode.scale);
    opacityOut.textContent = percent(mode.opacity);
    const h = mode.hotkeys ?? {};
    keys.textContent = [
      h.interactive && `${h.interactive}: modo interativo`,
      h.toggle && `${h.toggle}: mostrar/ocultar`,
      h.anchor && `${h.anchor}: âncora`,
      h.quit && `${h.quit}: sair`,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  Promise.resolve()
    .then(() => host.getMode())
    .then(apply)
    .catch(() => {});
  try {
    host.onMode(apply);
  } catch {
    // Sem o canal de modo a barra só reflete o estado inicial.
  }
}
