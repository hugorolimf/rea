/**
 * Dicas flutuantes no lugar do `title` nativo: mesmo estilo nos dois temas, texto com quebras de linha, acessíveis por
 * teclado (foco), com atraso curto, descartáveis com Esc e "pairáveis" (WCAG 1.4.13), e também no toque (pressionar e
 * segurar). O texto continua vindo do atributo `title` que as telas já escrevem: na primeira vez que um elemento é
 * tocado pelo ponteiro ou pelo foco, `title` vira `data-tip` (o nome acessível passa para `aria-label` quando o
 * elemento não tem texto próprio), então leitores de tela continuam lendo o mesmo texto.
 *
 * Usa a API Popover (camada superior): a dica aparece acima de `<dialog>` modal também. Sem suporte, não faz nada e o
 * `title` nativo continua valendo.
 */

const SHOW_MS = 380; // ponteiro: atraso para não piscar ao atravessar a tela
const FOCUS_MS = 120;
const HIDE_MS = 160; // tolerância para o ponteiro ir até a dica
const TOUCH_HOLD_MS = 480;
const TOUCH_SHOW_MS = 3500;

/** Troca `title` por `data-tip` mantendo o nome acessível. Devolve o texto da dica (ou "" se não há). */
export function hoist(node) {
  const title = node.getAttribute("title");
  if (title != null) {
    const text = title.trim();
    node.removeAttribute("title");
    if (!text) return node.dataset.tip ?? "";
    node.dataset.tip = text;
    if (
      !node.hasAttribute("aria-label") &&
      !node.hasAttribute("aria-labelledby") &&
      !node.hasAttribute("aria-hidden") &&
      !node.textContent.trim()
    )
      node.setAttribute("aria-label", text.split("\n")[0]);
  }
  return node.dataset.tip ?? "";
}

/**
 * Posição da dica: abaixo do alvo, centralizada, dentro da janela; sobe para cima do alvo se não couber embaixo.
 * Pura (só números), para testar.
 */
export function placeTip(target, tip, view, gap = 8, margin = 8) {
  let left = target.left + target.width / 2 - tip.width / 2;
  left = Math.max(margin, Math.min(left, view.width - tip.width - margin));
  let top = target.bottom + gap,
    above = false;
  if (
    top + tip.height > view.height - margin &&
    target.top - gap - tip.height >= margin
  ) {
    top = target.top - gap - tip.height;
    above = true;
  }
  top = Math.max(margin, Math.min(top, view.height - tip.height - margin));
  return { left: Math.round(left), top: Math.round(top), above };
}

export function mountTooltips(doc = document) {
  const tip = doc.createElement("div");
  if (typeof tip.showPopover !== "function") return { destroy() {} };
  tip.className = "tip";
  tip.id = "tip";
  tip.setAttribute("popover", "manual");
  tip.setAttribute("role", "tooltip");
  doc.body.append(tip);

  let current = null,
    showTimer = 0,
    hideTimer = 0,
    autoHide = 0,
    overTip = false;

  const reach = (node) =>
    node instanceof Element && !node.closest(".tip")
      ? node.closest("[title], [data-tip]")
      : null;

  function show(node) {
    const text = hoist(node);
    if (!text) return;
    current = node;
    tip.textContent = text;
    if (node.textContent.trim()) node.setAttribute("aria-describedby", "tip");
    if (!tip.matches(":popover-open")) tip.showPopover();
    const box = node.getBoundingClientRect(),
      size = tip.getBoundingClientRect(),
      at = placeTip(
        box,
        { width: size.width, height: size.height },
        { width: innerWidth, height: innerHeight },
      );
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
  }
  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    clearTimeout(autoHide);
    overTip = false;
    if (current?.getAttribute("aria-describedby") === "tip")
      current.removeAttribute("aria-describedby");
    current = null;
    if (tip.matches(":popover-open")) tip.hidePopover();
  }
  const later = (node, ms) => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => node.isConnected && show(node), ms);
  };
  const soon = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => !overTip && hide(), HIDE_MS);
  };

  doc.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const node = reach(e.target);
    if (!node) return;
    if (node === current) return clearTimeout(hideTimer);
    hoist(node); // já esconde o `title` nativo antes de o atraso vencer
    later(node, current ? 0 : SHOW_MS);
  });
  doc.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    if (reach(e.target)) soon();
  });
  tip.addEventListener("pointerenter", () => {
    overTip = true;
    clearTimeout(hideTimer);
  });
  tip.addEventListener("pointerleave", () => {
    overTip = false;
    soon();
  });
  doc.addEventListener("focusin", (e) => {
    const node = reach(e.target);
    if (node && e.target.matches?.(":focus-visible")) later(node, FOCUS_MS);
  });
  doc.addEventListener("focusout", () => soon());
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && current) hide();
  });
  doc.addEventListener("scroll", hide, { capture: true, passive: true });
  addEventListener("blur", hide);

  // Toque: segurar mostra a dica por alguns segundos (o toque curto continua sendo o clique normal).
  let hold = 0;
  doc.addEventListener("pointerdown", (e) => {
    clearTimeout(hold);
    if (e.pointerType !== "touch") return hide();
    if (!reach(e.target) && !e.target.closest?.(".tip")) hide();
    const node = reach(e.target);
    if (!node) return;
    hold = setTimeout(() => {
      show(node);
      clearTimeout(autoHide);
      autoHide = setTimeout(hide, TOUCH_SHOW_MS);
    }, TOUCH_HOLD_MS);
  });
  for (const type of ["pointerup", "pointercancel", "pointermove"])
    doc.addEventListener(
      type,
      (e) => e.pointerType === "touch" && clearTimeout(hold),
      { passive: true },
    );

  return {
    destroy() {
      hide();
      tip.remove();
    },
  };
}
