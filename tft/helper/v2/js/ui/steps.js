import { el, reconcile, esc } from "../dom.js";
import {
  champName,
  getCatalog,
  glyph,
  itemPortrait,
  pct,
  pips,
  portrait,
  stars,
} from "./glyphs.js";
import { PART_STATE, nextItemRecipe } from "../next-item.js";

const ICON = {
  swap: "swap",
  equip: "check",
  buy: "coin",
  slot: "plus",
  hold: "pause",
  moves: "swap",
  next: "up",
  builds: "bank",
  shop: "coin",
  carousel: "flag",
};

/** Seta de fluxo: `go` pulsa, `hold` é tracejada. */
const flow = (tone = "") =>
  `<svg class="flow ${tone}" viewBox="0 0 30 10" aria-hidden="true"><path class="l" d="M1 5h22"/><path class="h" d="M21 1.5 27 5l-6 3.5"/></svg>`;
// O campeão é a imagem; o nome fica só para leitores de tela (`.sr`) e no tooltip.
const mini = (id, name, n = 0, ring = "") =>
  `<span class="mini" title="${esc(name)}">${portrait(id, name, { size: 26, ring, hidden: true })}<b class="sr">${esc(name)}</b>${n ? `<i class="st">${stars(n)}</i>` : ""}</span>`;
const costBadge = (c) =>
  `<em class="cost" style="--c:var(--cost-${Math.min(5, Math.max(1, c ?? 1))})">${esc(c)}</em>`;
const tile = (
  u,
  { badge = "", foot = "", tone = "", title = u.name, attrs = "" } = {},
) =>
  `<span class="tile ${tone}"${attrs} title="${esc(title)}">${portrait(u.id, u.name, { size: 46, badge: `${costBadge(u.cost)}${badge}` })}<b class="sr">${esc(u.name)}</b>${foot}</span>`;

const SHOP_GLYPH = {
  comprar: ["is-buy", "check"],
  segurar: ["is-hold", "pause"],
  "sem ouro": ["is-broke", "no"],
  ignorar: ["is-skip", "x"],
};

const PART_MARK = {
  bank: "bank",
  equipped: "check",
  missing: "plus",
  unknown: "clock",
};
const op = (t) => `<span class="op" aria-hidden="true">${t}</span>`;

/**
 * "Próximo item" de uma peça: quem recebe, o item principal e a receita dele, cada componente com a situação
 * (no banco, já equipado na peça ou faltando). Radiante mostra o item base e a receita do base; item sem receita
 * (artefato, emblema fixo) não tem componentes.
 */
export function nextRow(r) {
  const rec = nextItemRecipe(r.item, getCatalog().items, {
      bank: r.bank ?? null,
    }),
    parts = rec?.parts ?? [],
    miss = parts.filter((p) => p.state === "missing").length;
  const dashed = rec
    ? !rec.complete && parts.length > 0
    : (r.item.missing ?? []).length > 0;
  const main = itemPortrait(r.item, {
    size: 30,
    ring: dashed ? "is-dashed" : "",
  });
  if (!parts.length)
    return `${mini(r.unit.id, r.unit.name, r.unit.stars)}${main}`;
  const base = rec.base
      ? `${itemPortrait(rec.base, { size: 26 })}${op("=")}`
      : "",
    recipe = parts
      .map((p) => {
        const label = `${p.name}: ${PART_STATE[p.state]}`;
        return `<span class="nx-part" data-state="${p.state}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${itemPortrait({ id: p.id, name: p.name }, { size: 26, hidden: true })}<i class="nx-mark">${glyph(PART_MARK[p.state] ?? "clock")}</i></span>`;
      })
      .join(op("+"));
  const note = rec.complete ? "monta" : miss ? `falta ${miss}` : "";
  return `${mini(r.unit.id, r.unit.name, r.unit.stars)}<span class="nx-item" data-complete="${rec.complete ? 1 : 0}">${main}</span>${op("=")}${base}<span class="nx-recipe" role="group" aria-label="Receita de ${esc(rec.item.name)}">${recipe}</span>${note ? `<small class="nx-note" data-tone="${rec.complete ? "go" : "amber"}">${note}</small>` : ""}`;
}

/** Tom de `.nx-part` (rich.css) de cada situação de um item recomendado: feito, ao alcance ou faltando. */
const BUILD_PART = { done: "equipped", go: "bank", wait: "missing" };

/**
 * "Itens dos campeões": o campeão e TODOS os itens recomendados dele (até 3), na ordem da build, cada um com a situação
 * segundo o seu banco (equipado / no banco / monta agora / mover / falta N). O destaque (`next`) é o próximo a resolver.
 * Ícone + marca + palavra curta: o estado nunca depende só da cor; o nome do item fica no rótulo de leitor de tela.
 */
export function buildsRow(r) {
  const cells = r.items
    .map((i) => {
      const label = `${i.item.name}: ${i.text || i.label}`,
        from = i.from?.id
          ? `<span class="bi-from" aria-hidden="true">${portrait(i.from.id, i.from.name, { size: 14, hidden: true })}</span>`
          : "";
      return `<span class="bi" data-kind="${esc(i.kind)}" data-next="${i.next ? 1 : 0}" role="img" aria-label="${esc(label)}" title="${esc(label)}"><span class="nx-part" data-state="${BUILD_PART[i.tone] ?? "missing"}">${itemPortrait(i.item, { size: 26, hidden: true })}<i class="nx-mark">${glyph(i.mark)}</i></span><small class="bi-lbl" data-tone="${esc(i.tone)}">${from}${esc(i.label)}</small></span>`;
    })
    .join("");
  // A origem da build (comp com variação e partidas, ou reserva) vem pronta do motor único de itens (`note`).
  return `${mini(r.unit.id, r.unit.name, r.unit.stars)}<span class="bi-list" role="group" aria-label="Itens recomendados de ${esc(r.unit.name)}"${r.note ? ` title="${esc(r.note)}"` : ""}>${cells}</span>${r.reserve ? `<small class="bi-src" title="${esc(r.note ?? "")}">reserva</small>` : ""}`;
}

/**
 * Peça da lista Comprar. Se ela está na loja agora (`r.shop`, de shop-match.js): contorno de ação, selo "NA LOJA" sobre
 * a borda do retrato (sobreposto: não ocupa espaço, a linha não muda de altura) e, no lugar da chance, o que fazer
 * ("comprar 1 · #3"). Só provável (loja lida da tela): selo "NA LOJA?" tracejado e a dica diz isso.
 */
function buyTile(r) {
  const s = r.shop,
    copy = r.how === "copy" ? r.copy : null,
    where = copy
      ? esc(copy.text)
      : r.how === "replace"
        ? "entra por " + esc(r.replaces)
        : r.how === "bank"
          ? "guardar no banco"
          : "vaga livre",
    flag = s
      ? `<b class="shop-flag" data-conf="${s.probable ? "provavel" : "confiavel"}" aria-hidden="true">${esc(s.badge)}</b>`
      : "",
    // Cópia sua na reserva agora (roster.js, `r.own` do modelo): selo azul do banco com o número de cópias lá.
    own = r.own?.state === "reserve" || r.own?.state === "both" ? r.own : null,
    ownTag = own
      ? `<small class="own-tag" title="${esc(own.text)}">${glyph("bank")}<span aria-hidden="true">${esc(own.reserve.pieces)}</span><span class="sr">${esc(own.text)}</span></small>`
      : "",
    // Peça nova x cópia de peça que você já tem: a cópia diz a estrela que fecha ("→2★"); a nova não leva marca.
    kindNote = `${copy ? copy.text : "peça nova"}${own ? `; ${own.text}` : ""}`,
    tag = copy
      ? `<small class="copy-tag" title="${esc(copy.text)}"><span aria-hidden="true">→${esc(copy.next)}★</span><span class="sr">${esc(copy.text)}</span></small>`
      : "";
  return tile(r.unit, {
    tone: [r.broke ? "is-broke" : "", s ? "is-shop" : ""]
      .filter(Boolean)
      .join(" "),
    // Na loja: a dica traz o aviso (e a diferença confiável x provável); a chance por loja continua nela.
    title: s
      ? `${r.unit.name} (${kindNote})
${s.title}
Chance por loja: ${pct(r.chance)}`
      : `${r.unit.name} (${kindNote})`,
    attrs:
      (s ? ` data-shop="${s.probable ? "provavel" : "confiavel"}"` : "") +
      (copy ? ` data-copy="${copy.closes ? "fecha" : "sobe"}"` : ""),
    // O ícone do canto diz como a peça entra; o texto equivalente fica para leitor de tela (e na dica).
    badge: `<em class="act" title="${where}">${glyph(copy ? "up" : r.how === "replace" ? "swap" : r.how === "bank" ? "bank" : "plus")}<span class="sr">${where}</span></em>${flag}`,
    foot: `<span class="meter" style="--p:${Math.min(1, r.chance / 0.2)}"><i></i></span><small${s ? ` class="shop-do" data-conf="${s.probable ? "provavel" : "confiavel"}"` : ""}>${s ? `<span class="sr">na loja: </span>${esc(s.mark)}` : pct(r.chance)}</small>${tag}${ownTag}`,
  });
}

/** HTML de cada linha por tipo; textos longos ficam em `title`. */
const BUILD = {
  // Trocar: quem sai, seta, quem entra. Itens a preservar viram aviso em texto (não só um número no ícone).
  swap: (r) =>
    `${mini(r.exit.id, r.exit.name, r.exitStars)}${flow("go")}${mini(r.enter.id, r.enter.name, r.enterStars)}${r.held ? `<em class="warn" title="preserve ${r.held} item(ns) antes de trocar">${glyph("warn")}preserve ${r.held} ${r.held === 1 ? "item" : "itens"}</em>` : `<i class="ok">${glyph("check")}<span class="sr">pode trocar</span></i>`}`,
  equip: (r) =>
    `${r.items.map((i) => itemPortrait(i)).join("")}${flow("go")}${mini(r.unit.id, r.unit.name, r.unit.stars)}<i class="${r.inField ? "ok" : "wait"}" title="${r.inField ? "montável com seu banco" : "prepare a entrada em campo"}">${glyph(r.inField ? "check" : "clock")}<span class="sr">${r.inField ? "montável com seu banco" : "prepare a entrada em campo"}</span></i>`,
  bank: (r) =>
    `${itemPortrait(r.item)}${flow()}${r.to ? mini(r.to.id, r.to.name) : `<span class="stash" title="${esc(r.reason)}">${glyph("bank")}<span class="sr">guardar no banco</span></span>`}`,
  buy: (r) => buyTile(r),
  slot: (r) =>
    `<span class="slot-empty" title="${r.fromReserve ? "já está na reserva" : "entra ao subir de nível"}">${glyph("plus")}<span class="sr">${r.fromReserve ? "vaga livre; a peça já está na reserva" : "vaga livre; a peça entra ao subir de nível"}</span></span>${flow("go")}${mini(r.enter.id, r.enter.name, r.enterStars)}${r.fromReserve ? `<i class="ok" title="já está na reserva">${glyph("roll")}<span class="sr">já está na reserva</span></i>` : ""}`,
  hold: (r) =>
    `${mini(r.exit.id, r.exit.name, r.exitStars)}${flow("hold")}${mini(r.enter.id, r.enter.name, r.enterStars)}${r.need ? `${pips(r.have, r.need, "amber")}<small class="frac">${r.have}/${r.need}</small>` : `<i class="no" title="não troque">${glyph("x")}não troque</i>`}`,
  // Passar itens: "agora" e "planejar" são rótulos visíveis (o ponto e o relógio sozinhos dependem de dica).
  moves: (r) =>
    `${mini(r.from.id, r.from.name, r.from.stars)}${flow(r.now ? "go" : "")}${r.moves.map((m) => `<span class="mv">${itemPortrait(m.item, { size: 24 })}${flow()}${mini(m.to.id, m.to.name)}</span>`).join("")}${r.now ? '<i class="now-tag" title="agora"><span class="now-dot" aria-hidden="true"></span>agora</i>' : `<i class="wait" title="planejar">${glyph("clock")}planejar</i>`}`,
  next: (r) => nextRow(r),
  builds: (r) => buildsRow(r),
  shop: (r) => {
    const [tone, g] = SHOP_GLYPH[r.action] ?? ["", "x"];
    return tile(r.unit, {
      tone,
      badge: `<em class="act ${tone}" title="${esc(r.action)}">${glyph(g)}</em>`,
    });
  },
  // Componente → item que ele fecha (destaque) ou começa → quem vai usar.
  carousel: (r) =>
    `<span class="car" title="${esc(r.reason)}">${r.rank != null ? `<b class="rank">${esc(r.rank)}</b>` : ""}${r.slotChampion ? portrait(r.slotChampion.id, r.slotChampion.name ?? champName(r.slotChampion.id), { size: 30 }) : ""}${itemPortrait(r.item)}${r.target ? `${flow(r.completes ? "go" : "hold")}<span class="car-target${r.completes ? " is-close" : ""}">${itemPortrait(r.target, { size: 30 })}</span>${r.championId ? portrait(r.championId, r.champion, { size: 24 }) : ""}` : ""}</span>`,
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
      el(
        "h3",
        {},
        el("span", { class: "label" }),
        el("b", { class: "count" }),
        el("small", { class: "note" }),
      ),
      el("div", { class: "rows" }),
    ),
  );

/**
 * Grupo com ação imediata: trocar/equipar (tom "go"), peça do plano na loja agora (nota "hit" do cruzamento com a loja) ou
 * item para passar agora. Ganha cor cheia e título maior (field.css); os demais recuam.
 */
const isUrgent = (step) =>
  step.tone === "go" ||
  step.note?.state === "hit" ||
  step.rows.some((r) => r.kind === "moves" && r.now);

/** Escreve só se mudou: a trilha é relida a cada leitura do servidor. */
const setText = (n, text) => {
  if (n.textContent !== text) n.textContent = text;
};

function updateStep(node, step) {
  node.dataset.tone = step.tone;
  const urgent = isUrgent(step) ? "1" : "0";
  if (node.dataset.urgent !== urgent) node.dataset.urgent = urgent;
  const icon = node.querySelector(".step-node"),
    iconName = ICON[step.id] ?? "check";
  if (icon.dataset.icon !== iconName) {
    icon.dataset.icon = iconName;
    icon.innerHTML = glyph(iconName);
  }
  setText(node.querySelector(".label"), step.title);
  setText(node.querySelector(".count"), String(step.rows.length));
  // Nota discreta do cabeçalho (ex.: "nenhuma peça do plano na loja agora"); só existe quando a fonte leu a loja.
  const note = node.querySelector(".note");
  note.hidden = !step.note;
  setText(note, step.note?.text ?? "");
  const title = step.note?.title ?? "";
  if (note.title !== title) note.title = title;
  note.dataset.state = step.note?.state ?? "";
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
