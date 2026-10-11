import { el, reconcile } from "../dom.js";
import { glyphNode } from "./glyphs.js";

/**
 * Faixa "Foco agora" sob o HUD: o que fazer na rodada, em ordem de urgência (ver ../focus.js). DOM estável por item
 * (`key` = id), então entradas e saídas animam e nada é recriado a cada leitura.
 */
export function mountFocusBar(root) {
  const label = el("span", { class: "eyebrow focus-label" }, "Foco"),
    idle = el(
      "span",
      { class: "focus-idle" },
      "Nada urgente: mantenha a economia.",
    );
  root.append(label);
  const list = el("div", { class: "focus-list", role: "list" });
  root.append(list, idle);

  const itemNode = () => {
    const icon = el("span", { class: "focus-icon", "aria-hidden": "true" }),
      strong = el("strong"),
      small = el("small");
    return el(
      "div",
      { class: "focus-item", role: "listitem" },
      icon,
      el("span", {}, strong, small),
    );
  };

  return {
    /** `view`: resultado de `focusView` (ou null fora de uma partida ao vivo: a faixa some). */
    update(view) {
      root.hidden = !view;
      if (!view) return;
      idle.hidden = !view.idle;
      reconcile(list, view.items, {
        key: (it) => it.id,
        create: itemNode,
        update(node, it) {
          if (node.dataset.tone !== it.tone) node.dataset.tone = it.tone;
          const icon = node.querySelector(".focus-icon");
          if (icon.dataset.g !== it.icon) {
            icon.dataset.g = it.icon;
            icon.replaceChildren(glyphNode(it.icon));
          }
          const [strong, small] = node.querySelectorAll("strong, small");
          if (strong.textContent !== it.label) strong.textContent = it.label;
          if (small.textContent !== it.detail) small.textContent = it.detail;
        },
      });
    },
  };
}
