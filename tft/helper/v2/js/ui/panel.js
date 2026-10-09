import { el, svg, reconcile, setVars, esc } from "../dom.js";
import { clamp, monotonePath, round } from "../math.js";
import { GOLD_PER_SHOP } from "../model.js";
import { glyph, pct, pips, portrait } from "./glyphs.js";

const W = 280,
  Hh = 124,
  M = { l: 30, r: 12, t: 12, b: 26 };
const sx = (n, maxN) => M.l + (n / maxN) * (W - M.l - M.r);
const sy = (v) => M.t + (1 - v) * (Hh - M.t - M.b);

/** Curva de chance acumulada de fechar o upgrade em função do ouro gasto em lojas. */
function curveSVG(curve) {
  if (!curve) return "";
  const pts = curve.points.map(({ n, v }) => ({
      x: sx(n, curve.maxN),
      y: sy(v),
    })),
    line = monotonePath(pts),
    area = `${line}L${round(pts.at(-1).x)} ${round(sy(0))}L${round(pts[0].x)} ${round(sy(0))}Z`;
  const step = curve.maxN > 24 ? 10 : curve.maxN > 12 ? 5 : 2;
  const xTicks = [];
  for (let n = 0; n <= curve.maxN; n += step)
    xTicks.push(
      `<line class="gx" x1="${round(sx(n, curve.maxN))}" x2="${round(sx(n, curve.maxN))}" y1="${sy(0)}" y2="${sy(0) + 3}"/><text class="ax" x="${round(sx(n, curve.maxN))}" y="${Hh - 6}" text-anchor="middle">${n * GOLD_PER_SHOP}g</text>`,
    );
  const marks = [];
  if (Number.isFinite(curve.q80) && curve.q80 <= curve.maxN) {
    const x = sx(curve.q80, curve.maxN),
      y = sy(curve.points[curve.q80].v);
    marks.push(
      `<circle class="q" cx="${round(x)}" cy="${round(y)}" r="3.4"/><text class="ql" x="${round(Math.min(x + 6, W - 34))}" y="${round(y + 14)}">80% · ${curve.q80 * GOLD_PER_SHOP}g</text>`,
    );
  }
  if (curve.planned != null && curve.plannedValue != null) {
    const x = sx(curve.planned, curve.maxN),
      y = sy(curve.plannedValue);
    marks.push(
      `<line class="plan" x1="${round(x)}" x2="${round(x)}" y1="${round(y)}" y2="${sy(0)}"/><circle class="pl" cx="${round(x)}" cy="${round(y)}" r="4"/><text class="pll" x="${round(Math.min(x, W - 30))}" y="${round(y - 8)}" text-anchor="middle">${Math.round(curve.plannedValue * 100)}%</text>`,
    );
  }
  return `<svg viewBox="0 0 ${W} ${Hh}" class="curve" role="img" aria-label="Chance acumulada de ${esc(curve.name)} ${curve.stars}★ por ouro gasto">
    <defs><linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--amber)" stop-opacity=".38"/><stop offset="1" stop-color="var(--amber)" stop-opacity="0"/></linearGradient></defs>
    ${[0, 0.5, 1].map((v) => `<line class="g" x1="${M.l}" x2="${W - M.r}" y1="${round(sy(v))}" y2="${round(sy(v))}"/><text class="ax" x="${M.l - 5}" y="${round(sy(v) + 3)}" text-anchor="end">${v * 100}%</text>`).join("")}
    ${xTicks.join("")}
    <path class="area" d="${area}"/><path class="line" d="${line}"/>${marks.join("")}</svg>`;
}

const section = (cls, ...kids) =>
  el("section", { class: `blk ${cls}` }, ...kids);
const head = (label) => {
  const verdict = el("b", { class: "verdict" });
  return { node: el("header", {}, el("span", {}, label), verdict), verdict };
};

export function mountPanel(root) {
  /* Decisão */
  const tag = el("span", { class: "action-tag" }),
    headline = el("strong", { class: "headline" }),
    metaRow = el("div", { class: "meta-row" }),
    decision = section("decision", tag, headline, metaRow);
  /* Nível */
  const lvHead = head("Nível"),
    track = el("div", { class: "lv-track" }),
    xpBar = el("div", { class: "bar" }, el("i")),
    xpText = el("small"),
    xpCost = el("b", { class: "chip chip-amber" }),
    level = section(
      "level",
      lvHead.node,
      track,
      el("div", { class: "xp" }, xpBar, xpText, xpCost),
    );
  /* Roll */
  const rollHead = head("Roll"),
    spend = el("div", { class: "spend" }),
    curveBox = el("div", { class: "curve-box" }),
    targets = el("div", { class: "targets" }),
    roll = section("roll", rollHead.node, spend, curveBox, targets);
  /* Odds */
  const oddsBar = el("div", { class: "odds-bar" }),
    odds = section(
      "odds",
      el("header", {}, el("span", {}, "Loja neste nível")),
      oddsBar,
    );
  /* Por quê */
  const whyBody = el("div", { class: "why-body" }),
    why = el(
      "details",
      { class: "why" },
      el("summary", {}, "Por que esta decisão"),
      whyBody,
    );
  root.replaceChildren(decision, level, roll, odds, why);

  const lvNode = () => el("span", { class: "lv-node" }, el("b"), el("i"));
  const tgNode = () => el("div", { class: "tg" });

  return {
    update(p) {
      root.dataset.empty = p ? "0" : "1";
      if (!p) return;
      root.dataset.tone = p.tone;
      tag.textContent = p.action ?? "";
      tag.hidden = !p.action;
      headline.textContent = p.action ? p.headline : "";
      headline.hidden = !p.action;
      metaRow.innerHTML = `${p.tier ? `<b class="tier tier-${esc(p.tier)}" title="Tier da comp">${esc(p.tier)}</b>` : ""}${p.style ? `<em class="chip">${esc(p.style)}</em>` : ""}<span class="carry" title="${esc(p.comp)}">${glyph("crown")}${esc(p.carry)}</span>`;
      /* Nível */
      const lv = p.level;
      level.hidden = !lv;
      if (lv) {
        reconcile(track, lv.nodes, {
          key: (n) => n.n,
          create: lvNode,
          update: (node, n) => {
            node.dataset.state = n.state;
            node.dataset.next = n.next ? "1" : "0";
            node.dataset.roll = n.roll ? "1" : "0";
            node.dataset.final = n.final ? "1" : "0";
            node.querySelector("b").textContent = n.n;
            node.querySelector("i").innerHTML = n.roll
              ? glyph("roll")
              : n.final
                ? glyph("flag")
                : "";
            node.title = [
              n.state === "now" ? "nível atual" : "",
              n.roll ? "nível de rolagem" : "",
              n.final ? "nível final da comp" : "",
            ]
              .filter(Boolean)
              .join(" · ");
          },
        });
        lvHead.verdict.textContent = lv.go ? "subir" : "";
        lvHead.verdict.dataset.tone = lv.go ? "go" : "";
        lvHead.verdict.hidden = !lv.go;
        const xp = lv.xp;
        setVars(xpBar, { "--p": xp ? clamp(xp.have / (xp.total || 1)) : 0 });
        xpText.textContent = xp ? `${xp.have}/${xp.total}` : "XP ?";
        xpCost.textContent = lv.cost != null ? `${lv.cost}g` : "";
        xpCost.hidden = lv.cost == null;
        level.dataset.unknown = xp ? "0" : "1";
      }
      /* Roll */
      const r = p.roll;
      roll.hidden = !r;
      if (r) {
        rollHead.verdict.textContent = r.go
          ? "rolar"
          : r.level < r.at
            ? `Nv ${r.at}`
            : "espere";
        rollHead.verdict.dataset.tone = r.go ? "go" : "wait";
        spend.hidden = !r.go;
        spend.innerHTML = r.go
          ? `<b>${r.spend}g</b><span>${r.shops} lojas</span>${r.keep != null ? `<span class="floor" title="pare quando chegar a ${r.keep}g">${glyph("flag")}${r.keep}g</span>` : ""}`
          : "";
        curveBox.innerHTML = curveSVG(r.curve);
        curveBox.hidden = !r.curve;
        curveBox.title = r.curve
          ? `${r.curve.name} ${r.curve.stars}★: faltam ${r.curve.k} cópia(s) · ${pct(r.curve.p)} por loja · ${r.curve.q50 * GOLD_PER_SHOP}g para 50%`
          : "";
        reconcile(targets, r.targets, {
          key: (t) => t.id,
          create: tgNode,
          update: (node, t) => {
            node.dataset.done = t.done ? "1" : "0";
            node.title = `${t.name} ${t.goalStars}★ · ${t.own}/${t.goal} cópias · ${pct(t.chancePerShop)} por loja${t.enemy ? ` · ${t.enemy} com rivais` : ""}`;
            node.innerHTML = `${portrait(t.id, t.name, { size: 28, ring: t.done ? "is-done" : "is-pending" })}<span class="name">${esc(t.name)}</span>${pips(Math.min(t.own, t.need), t.need, t.done ? "" : "amber")}<span class="chance">${pct(t.chancePerShop)}</span>${t.enemy ? `<span class="rivals" title="${t.enemy} cópia(s) com rivais">${glyph("swords")}${t.enemy}</span>` : ""}`;
          },
        });
      }
      /* Odds */
      const o = p.odds ?? [];
      odds.hidden = !o.length;
      reconcile(
        oddsBar,
        o.map((v, i) => ({ cost: i + 1, v })),
        {
          key: (s) => s.cost,
          create: () => el("div", { class: "seg" }, el("span")),
          update: (node, s) => {
            setVars(node, {
              "--w": Math.max(s.v, 0.0001),
              "--c": `var(--cost-${s.cost})`,
            });
            node.dataset.carry = s.cost === p.carryCost ? "1" : "0";
            node.dataset.zero = s.v === 0 ? "1" : "0";
            node.firstChild.textContent = s.v >= 7 ? `${s.v}%` : "";
            node.title = `Custo ${s.cost}: ${s.v}% por slot${s.cost === p.carryCost ? " · custo do carry" : ""}`;
          },
        },
      );
      /* Por quê */
      whyBody.innerHTML = `${p.steps.length ? `<ol>${p.steps.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}${p.reasons.length ? `<ul>${p.reasons.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}`;
      why.hidden = !p.steps.length && !p.reasons.length;
    },
  };
}
