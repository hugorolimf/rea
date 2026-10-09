import { springEasing } from "./math.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Aplica atributos: `class`, `style` (objeto de custom properties), `on*` e `dataset`. */
function apply(node, attrs) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === "style" && typeof value === "object")
      for (const [prop, v] of Object.entries(value))
        node.style.setProperty(prop, String(v));
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
}
const append = (node, kids) => {
  for (const kid of kids.flat(Infinity))
    if (kid != null && kid !== false)
      node.append(
        kid instanceof Node ? kid : document.createTextNode(String(kid)),
      );
  return node;
};
/** Cria um elemento HTML. */
export const el = (tag, attrs, ...kids) => {
  const node = document.createElement(tag);
  apply(node, attrs);
  return append(node, kids);
};
/** Cria um elemento SVG. */
export const svg = (tag, attrs, ...kids) => {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, attrs);
  return append(node, kids);
};
/** Escreve várias custom properties de uma vez. */
export const setVars = (node, vars) => {
  for (const [k, v] of Object.entries(vars))
    node.style.setProperty(k, String(v));
};
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

/**
 * Reconciliação por chave: reaproveita nós, cria os novos, remove os ausentes e
 * mantém a ordem. Nós estáveis permitem que transições CSS animem entre leituras.
 */
export function reconcile(parent, items, { key, create, update }) {
  const existing = new Map();
  for (const child of parent.children)
    if (child.dataset.k != null) existing.set(child.dataset.k, child);
  const seen = new Set();
  items.forEach((item, index) => {
    const k = String(key(item, index));
    let node = existing.get(k);
    if (!node) {
      node = create(item, index);
      node.dataset.k = k;
    }
    seen.add(k);
    update?.(node, item, index);
    if (parent.children[index] !== node)
      parent.insertBefore(node, parent.children[index] ?? null);
  });
  for (const [k, node] of existing) if (!seen.has(k)) node.remove();
}

/* ---------- Movimento ---------- */

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const supportsLinear = CSS.supports(
  "animation-timing-function",
  "linear(0, 1)",
);
/** Mola "viva" (leve overshoot) para posição e uma crítica (sem overshoot) para valores. */
export const motion = {
  spring: springEasing({ stiffness: 240, damping: 20 }),
  settle: springEasing({ stiffness: 120, damping: 2 * Math.sqrt(120) }),
};
/** Publica as molas como custom properties para o CSS usar em transições. */
export function publishMotion(root = document.documentElement) {
  const ease = (m) =>
    supportsLinear ? m.easing : "cubic-bezier(.22,.8,.24,1)";
  setVars(root, {
    "--spring-ease": ease(motion.spring),
    "--spring-ms": `${reducedMotion.matches ? 0 : motion.spring.duration}ms`,
    "--settle-ease": ease(motion.settle),
    "--settle-ms": `${reducedMotion.matches ? 0 : motion.settle.duration}ms`,
  });
}

/**
 * FLIP com mola: mede os elementos marcados com data-flip, executa a mutação e anima
 * cada um do lugar antigo ao novo. Elementos novos não animam por aqui (usam @starting-style).
 */
export function flip(root, mutate) {
  const before = new Map();
  for (const n of root.querySelectorAll("[data-flip]"))
    before.set(n.dataset.flip, n.getBoundingClientRect());
  mutate();
  if (reducedMotion.matches || !before.size) return;
  const ease = supportsLinear
    ? motion.spring.easing
    : "cubic-bezier(.22,.8,.24,1)";
  for (const n of root.querySelectorAll("[data-flip]")) {
    const from = before.get(n.dataset.flip);
    if (!from) continue;
    const to = n.getBoundingClientRect(),
      dx = from.left - to.left,
      dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    n.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      {
        duration: motion.spring.duration,
        easing: ease,
      },
    );
  }
}
