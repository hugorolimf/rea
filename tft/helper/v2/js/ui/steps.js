import { el, reconcile, esc } from "../dom.js";
import { glyph, itemPortrait, pct, pips, portrait, stars } from "./glyphs.js";

const ICON = {
  swap: "swap",
  equip: "check",
  buy: "coin",
  slot: "plus",
  hold: "pause",
  moves: "swap",
  next: "up",
  shop: "coin",
  carousel: "flag",
};

/** Seta de fluxo: `go` pulsa, `hold` é tracejada. */
const flow = (tone = "") =>
  `<svg class="flow ${tone}" viewBox="0 0 30 10" aria-hidden="true"><path class="l" d="M1 5h22"/><path class="h" d="M21 1.5 27 5l-6 3.5"/></svg>`;
const mini = (id, name, n = 0, ring = "") =>
  `<span class="mini">${portrait(id, name, { size: 26, ring })}<b>${esc(name)}</b>${n ? `<i class="st">${stars(n)}</i>` : ""}</span>`;
const costBadge = (c) =>
  `<em class="cost" style="--c:var(--cost-${Math.min(5, Math.max(1, c ?? 1))})">${esc(c)}</em>`;
const tile = (u, { badge = "", foot = "", tone = "" } = {}) =>
  `<span class="tile ${tone}">${portrait(u.id, u.name, { size: 46, badge: `${costBadge(u.cost)}${badge}` })}<b>${esc(u.name)}</b>${foot}</span>`;

const SHOP_GLYPH = {
  comprar: ["is-buy", "check"],
  segurar: ["is-hold", "pause"],
  "sem ouro": ["is-broke", "no"],
  ignorar: ["is-skip", "x"],
};

/** HTML de cada linha por tipo; textos longos ficam em `title`. */
const BUILD = {
  swap: (r) =>
    `${mini(r.exit.id, r.exit.name, r.exitStars)}${flow("go")}${mini(r.enter.id, r.enter.name, r.enterStars)}${r.held ? `<em class="warn" title="preserve ${r.held} item(ns) antes de trocar">${glyph("warn")}${r.held}</em>` : `<i class="ok">${glyph("check")}</i>`}`,
  equip: (r) =>
    `${r.items.map((i) => itemPortrait(i)).join("")}${flow("go")}${mini(r.unit.id, r.unit.name, r.unit.stars)}<i class="${r.inField ? "ok" : "wait"}" title="${r.inField ? "montável com seu banco" : "prepare a entrada em campo"}">${glyph(r.inField ? "check" : "clock")}</i>`,
  bank: (r) =>
    `${itemPortrait(r.item)}${flow()}${r.to ? mini(r.to.id, r.to.name) : `<span class="stash" title="${esc(r.reason)}">${glyph("bank")}</span>`}`,
  buy: (r) =>
    tile(r.unit, {
      tone: r.broke ? "is-broke" : "",
      badge: `<em class="act" title="${r.how === "replace" ? "entra por " + esc(r.replaces) : r.how === "bank" ? "guardar no banco" : "vaga livre"}">${glyph(r.how === "replace" ? "swap" : r.how === "bank" ? "bank" : "plus")}</em>`,
      foot: `<span class="meter" style="--p:${Math.min(1, r.chance / 0.2)}"><i></i></span><small>${pct(r.chance)}</small>`,
    }),
  slot: (r) =>
    `<span class="slot-empty" title="${r.fromReserve ? "já está na reserva" : "entra ao subir de nível"}">${glyph("plus")}</span>${flow("go")}${mini(r.enter.id, r.enter.name, r.enterStars)}${r.fromReserve ? `<i class="ok" title="já está na reserva">${glyph("roll")}</i>` : ""}`,
  hold: (r) =>
    `${mini(r.exit.id, r.exit.name, r.exitStars)}${flow("hold")}${mini(r.enter.id, r.enter.name, r.enterStars)}${r.need ? `${pips(r.have, r.need, "amber")}<small class="frac">${r.have}/${r.need}</small>` : `<i class="no" title="não troque">${glyph("x")}</i>`}`,
  moves: (r) =>
    `${mini(r.from.id, r.from.name, r.from.stars)}${flow(r.now ? "go" : "")}${r.moves.map((m) => `<span class="mv">${itemPortrait(m.item, { size: 24 })}${flow()}${mini(m.to.id, m.to.name)}</span>`).join("")}${r.now ? '<i class="now-dot" title="agora"></i>' : `<i class="wait" title="planejar">${glyph("clock")}</i>`}`,
  next: (r) => {
    const miss = r.item.missing ?? [];
    return `${mini(r.unit.id, r.unit.name, r.unit.stars)}${itemPortrait(r.item, { ring: miss.length ? "is-dashed" : "", badge: miss.length ? `<em class="miss" title="falta ${esc(miss.join(" + "))}">−${miss.length}</em>` : "" })}`;
  },
  shop: (r) => {
    const [tone, g] = SHOP_GLYPH[r.action] ?? ["", "x"];
    return tile(r.unit, {
      tone,
      badge: `<em class="act ${tone}" title="${esc(r.action)}">${glyph(g)}</em>`,
    });
  },
  carousel: (r) =>
    `<b class="rank">${esc(r.rank)}</b>${itemPortrait(r.item)}${r.champion ? `<span class="why" title="${esc(r.reason)}">${esc(r.champion)}</span>` : ""}`,
};
const CLASS = { buy: "row-tile", shop: "row-tile" };

const stepNode = (step) =>
  el(
    "li",
    { class: "step", dataset: { flip: `step:${step.id}` } },
    el("span", { class: "step-node" }),
    el(
      "div",
      { class: "step-body" },
      el("h3", {}, el("span", { class: "label" }), el("b", { class: "count" })),
      el("div", { class: "rows" }),
    ),
  );

function updateStep(node, step) {
  node.dataset.tone = step.tone;
  node.querySelector(".step-node").innerHTML = glyph(ICON[step.id] ?? "check");
  node.querySelector(".label").textContent = step.title;
  node.querySelector(".count").textContent = step.rows.length;
  reconcile(node.querySelector(".rows"), step.rows, {
    key: (r, i) => r.key ?? `${step.id}:${i}`,
    create: (r) =>
      el("div", {
        class: `row ${CLASS[r.kind] ?? ""}`,
        dataset: { flip: `row:${r.key}` },
      }),
    update: (n, r) => {
      const html = BUILD[r.kind]?.(r) ?? "";
      if (n.dataset.sig !== html) {
        n.dataset.sig = html;
        n.innerHTML = html;
      }
    },
  });
}

/** Trilha "o que fazer agora": cada etapa é um nó numa linha vertical; só as etapas com conteúdo aparecem. */
export function mountSteps(root) {
  return {
    update(steps = []) {
      reconcile(root, steps, {
        key: (s) => s.id,
        create: stepNode,
        update: updateStep,
      });
      root.dataset.empty = steps.length ? "0" : "1";
    },
  };
}
