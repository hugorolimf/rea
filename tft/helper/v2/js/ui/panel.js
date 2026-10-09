import { el, reconcile, setVars, esc } from "../dom.js";
import { clamp, monotonePath, round } from "../math.js";
import { glyph, pct, pips, portrait } from "./glyphs.js";

/* ---------- Roll: chance acumulada de fechar o upgrade por ouro gasto ---------- */

const CW = 280,
  CH = 104,
  CM = { l: 30, r: 12, t: 12, b: 24 };
const cx = (g, maxG) => CM.l + (g / (maxG || 1)) * (CW - CM.l - CM.r);
const cy = (v) => CM.t + (1 - v) * (CH - CM.t - CM.b);

/**
 * Curva da cadeia de Markov (lojas + cópias pagas, pool encolhendo). A área até o gasto recomendado
 * fica acesa: é a chance que esta rolagem compra. Marcas: 80% de chance e, se a curva de ganho mandou
 * parar antes, o teto permitido pelo piso.
 */
function curveSVG(curve, roll) {
  if (!curve) return "";
  const maxG = curve.maxG,
    pts = curve.points.map(({ g, v }) => ({ x: cx(g, maxG), y: cy(v) })),
    line = monotonePath(pts),
    base = round(cy(0)),
    area = `${line}L${round(pts.at(-1).x)} ${base}L${round(pts[0].x)} ${base}Z`;
  const step = maxG > 80 ? 20 : maxG > 40 ? 10 : maxG > 20 ? 5 : 4;
  const ticks = [];
  for (let g = 0; g <= maxG; g += step)
    ticks.push(
      `<text class="ax" x="${round(cx(g, maxG))}" y="${CH - 7}" text-anchor="middle">${g}g</text>`,
    );
  const valueAt = (g) =>
    curve.points[
      Math.min(
        curve.points.length - 1,
        Math.round(g / (curve.points[1]?.g || 2)),
      )
    ]?.v ?? 0;
  const marks = [];
  let lit = "";
  if (curve.planned != null && curve.plannedValue != null) {
    const x = round(cx(curve.planned, maxG)),
      y = round(cy(curve.plannedValue));
    lit = `<clipPath id="curve-lit"><rect x="0" y="0" width="${x}" height="${CH}"/></clipPath><path class="lit" d="${area}" clip-path="url(#curve-lit)"/>`;
    marks.push(
      `<line class="plan" x1="${x}" x2="${x}" y1="${y}" y2="${base}"/><circle class="pl" cx="${x}" cy="${y}" r="4.5"/><text class="pll" x="${round(clamp(x, CM.l + 14, CW - 26))}" y="${round(y - 9)}" text-anchor="middle">${Math.round(curve.plannedValue * 100)}%</text>`,
    );
  }
  if (roll?.stop != null && roll.max != null && roll.max <= maxG) {
    const x = round(cx(roll.max, maxG));
    marks.push(
      `<line class="cap" x1="${x}" x2="${x}" y1="${CM.t}" y2="${base}"/><text class="capl" x="${x + 3}" y="${CM.t + 7}">piso</text>`,
    );
  }
  if (curve.q80 != null && curve.q80 <= maxG && curve.q80 !== curve.planned) {
    const x = round(cx(curve.q80, maxG)),
      y = round(cy(valueAt(curve.q80)));
    marks.push(
      `<circle class="q" cx="${x}" cy="${y}" r="3.4"/><text class="ql" x="${round(Math.min(x + 6, CW - 46))}" y="${round(y + 15)}">80% · ${curve.q80}g</text>`,
    );
  }
  return `<svg viewBox="0 0 ${CW} ${CH}" class="curve" role="img" aria-label="Chance acumulada de ${esc(curve.name)} ${curve.stars}★ por ouro gasto">
    <defs><linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--amber)" stop-opacity=".32"/><stop offset="1" stop-color="var(--amber)" stop-opacity="0"/></linearGradient>
    <linearGradient id="curve-lit-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--go)" stop-opacity=".45"/><stop offset="1" stop-color="var(--go)" stop-opacity=".04"/></linearGradient></defs>
    ${[0, 0.5, 1].map((v) => `<line class="g" x1="${CM.l}" x2="${CW - CM.r}" y1="${round(cy(v))}" y2="${round(cy(v))}"/><text class="ax" x="${CM.l - 6}" y="${round(cy(v) + 3)}" text-anchor="end">${v * 100}%</text>`).join("")}
    ${ticks.join("")}
    <path class="area" d="${area}"/>${lit}<path class="line" d="${line}"/>${marks.join("")}</svg>`;
}

/* ---------- Ouro: agora → depois da ação → próximas rodadas ---------- */

const GW = 280,
  GH = 100,
  GM = { l: 16, r: 28, t: 12, b: 18 };

/**
 * Fluxo do ouro sobre as faixas de juros (+1 a +5, e "máx" acima de 50g). A seta âmbar é o gasto
 * desta ação; a linha dourada é o ouro no início das próximas rodadas só economizando. O ponto que
 * alcança 50g brilha. As faixas já garantidas depois da ação ficam com o rótulo aceso.
 */
function goldSVG(e) {
  const start = e.after ?? e.gold,
    pts = [{ label: "agora", gold: start }, ...e.projection],
    n = pts.length,
    iw = GW - GM.l - GM.r,
    ih = GH - GM.t - GM.b;
  const X = (i) => GM.l + (n > 1 ? (i / (n - 1)) * iw : 0),
    Y = (g) => GM.t + (1 - clamp(g / e.top)) * ih;
  const bands = [];
  for (let k = 0; k < 5; k++) {
    const y1 = round(Y((k + 1) * 10)),
      y2 = round(Y(k * 10));
    bands.push(
      `<rect class="band${k % 2 ? " alt" : ""}" x="${GM.l}" y="${y1}" width="${iw}" height="${round(y2 - y1)}"/>`,
    );
  }
  const y50 = round(Y(50));
  bands.push(
    `<rect class="band max" x="${GM.l}" y="${GM.t}" width="${iw}" height="${round(y50 - GM.t)}"/><line class="cap50" x1="${GM.l}" x2="${GW - GM.r}" y1="${y50}" y2="${y50}"/><text class="bl${start >= 50 ? " on" : ""}" x="${GW - GM.r + 5}" y="${y50 + 3}">50g</text>`,
  );
  const xy = pts.map((p, i) => ({ x: X(i), y: Y(p.gold) })),
    line = monotonePath(xy),
    base = round(Y(0)),
    area = `${line}L${round(xy.at(-1).x)} ${base}L${round(xy[0].x)} ${base}Z`;
  const marks = [];
  if (e.spend > 0) {
    const x = round(X(0)),
      y0 = round(Y(e.gold)),
      y1 = round(Y(start));
    marks.push(
      `<line class="drop" x1="${x}" x2="${x}" y1="${y0}" y2="${y1 - 5}"/><path class="drop-head" d="M${x - 4} ${y1 - 7}L${x} ${y1 - 1}L${x + 4} ${y1 - 7}Z"/><circle class="was" cx="${x}" cy="${y0}" r="3.5"/>`,
    );
  }
  marks.push(
    `<circle class="start" cx="${round(xy[0].x)}" cy="${round(xy[0].y)}" r="4"/>`,
  );
  pts.forEach((p, i) => {
    if (i === 0) return;
    const { x, y } = xy[i];
    marks.push(
      `<circle class="pt${p.reach ? " reach" : ""}${p.capped ? " capped" : ""}" cx="${round(x)}" cy="${round(y)}" r="${p.reach ? 4.6 : 3.2}"/><text class="vl${p.reach ? " reach" : ""}" x="${round(x)}" y="${round(y - 8)}" text-anchor="middle">${p.gold}</text>`,
    );
  });
  const labels = pts.map(
    (p, i) =>
      `<text class="xl${i === 0 ? " now" : ""}" x="${round(X(i))}" y="${GH - 5}" text-anchor="middle">${esc(p.label)}</text>`,
  );
  return `<svg viewBox="0 0 ${GW} ${GH}" class="gold-chart" role="img" aria-label="Ouro agora e no início das próximas rodadas">
    <defs><linearGradient id="gold-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--gold)" stop-opacity=".34"/><stop offset="1" stop-color="var(--gold)" stop-opacity="0"/></linearGradient></defs>
    ${bands.join("")}<path class="area" d="${area}"/><path class="line" d="${line}"/>${marks.join("")}${labels.join("")}</svg>`;
}

/* ---------- Montagem ---------- */

const section = (cls, ...kids) =>
  el("section", { class: `blk ${cls}` }, ...kids);
const head = (label, icon) => {
  const verdict = el("b", { class: "verdict" }),
    title = el("span", { class: "blk-title" });
  title.innerHTML = `${glyph(icon)}${esc(label)}`;
  return { node: el("header", {}, title, verdict), verdict, title };
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const setVerdict = (v, text, tone, title = "") => {
  v.textContent = text;
  v.dataset.tone = tone;
  v.hidden = !text;
  v.title = title;
};

export function mountPanel(root) {
  /* Decisão */
  const tag = el("span", { class: "action-tag" }),
    headline = el("strong", { class: "headline" }),
    metaRow = el("div", { class: "meta-row" }),
    decision = section("decision", tag, headline, metaRow);
  /* Nível: nós e elos; o elo do nível atual é a barra de XP */
  const lvHead = head("Nível", "up"),
    track = el("div", { class: "lv-track" }),
    level = section("level", lvHead.node, track);
  /* Roll */
  const rollHead = head("Roll", "roll"),
    spend = el("div", { class: "spend" }),
    curveBox = el("div", { class: "curve-box" }),
    targets = el("div", { class: "targets" }),
    roll = section("roll", rollHead.node, spend, curveBox, targets);
  /* Ouro */
  const ecoHead = head("Ouro", "coin"),
    sum = el("div", { class: "eco-sum" }),
    chart = el("div", { class: "gold-box" }),
    chips = el("div", { class: "eco-chips" }),
    eco = section("eco", ecoHead.node, sum, chart, chips);
  /* Loja */
  const oddsHead = head("Loja", "eye");
  oddsHead.verdict.hidden = true; // a loja não tem veredito
  const oddsBar = el("div", { class: "odds-bar" }),
    odds = section("odds", oddsHead.node, oddsBar);
  /* Por quê */
  const whyBody = el("div", { class: "why-body" }),
    why = el(
      "details",
      { class: "why" },
      el("summary", {}, "Por que esta decisão"),
      whyBody,
    );
  root.replaceChildren(decision, level, roll, eco, odds, why);

  const lvNode = () =>
    el("span", { class: "lv-node" }, el("b"), el("i"), el("em"));
  const lvLink = () => el("span", { class: "lv-link" }, el("b"), el("small"));
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
        const xp = lv.xp,
          ratio = xp ? (xp.max ? 1 : clamp(xp.have / (xp.total || 1))) : 0,
          items = [];
        lv.nodes.forEach((n, i) => {
          if (i) {
            const prev = lv.nodes[i - 1].n;
            items.push({
              key: `l${prev}`,
              link: true,
              state:
                prev < lv.level
                  ? "past"
                  : prev === lv.level
                    ? "current"
                    : "future",
              fill: prev < lv.level ? 1 : prev === lv.level ? ratio : 0,
              text:
                prev === lv.level && xp && !xp.max
                  ? `${xp.have}/${xp.total}`
                  : "",
            });
          }
          items.push({ key: `n${n.n}`, ...n });
        });
        reconcile(track, items, {
          key: (it) => it.key,
          create: (it) => (it.link ? lvLink() : lvNode()),
          update: (node, it) => {
            if (it.link) {
              node.dataset.state = it.state;
              setVars(node, { "--p": it.fill });
              node.querySelector("small").textContent = it.text;
              node.title = it.text ? `XP ${it.text}` : "";
              return;
            }
            node.dataset.state = it.state;
            node.dataset.next = it.next ? "1" : "0";
            node.dataset.roll = it.roll ? "1" : "0";
            node.dataset.final = it.final ? "1" : "0";
            node.querySelector("b").textContent = it.n;
            node.querySelector("i").innerHTML = it.roll
              ? glyph("roll")
              : it.final
                ? glyph("flag")
                : "";
            // Custo pendurado no próximo nível: ouro para completar o XP, ou "grátis" pelo XP passivo.
            const upcoming = it.n === lv.level + 1;
            const cost =
              upcoming && lv.cost != null
                ? lv.passive
                  ? "grátis"
                  : `${lv.cost}g`
                : "";
            const em = node.querySelector("em");
            em.textContent = cost;
            em.dataset.passive = lv.passive ? "1" : "0";
            node.title = [
              it.state === "now" ? "nível atual" : "",
              it.roll ? "nível de rolagem" : "",
              it.final ? "nível final da comp" : "",
              cost
                ? lv.passive
                  ? "o XP passivo da próxima rodada completa este nível"
                  : `faltam ${cost} de XP`
                : "",
            ]
              .filter(Boolean)
              .join(" · ");
          },
        });
        track.dataset.unknown = xp ? "0" : "1";
        setVerdict(
          lvHead.verdict,
          lv.go ? "subir" : lv.passive ? "XP grátis" : xp ? "" : "XP ?",
          lv.go ? "go" : "wait",
          lv.passive
            ? "Não compre XP: o XP passivo da próxima rodada completa o nível."
            : xp
              ? ""
              : "XP não lido da tela",
        );
      }

      /* Roll */
      const r = p.roll;
      roll.hidden = !r;
      if (r) {
        setVerdict(
          rollHead.verdict,
          r.go ? "rolar" : r.level < r.at ? `no nível ${r.at}` : "espere",
          r.go ? "go" : "wait",
        );
        spend.hidden = !r.go;
        spend.innerHTML = r.go
          ? `<b>${r.spend}g</b><span>até ${r.shops} lojas</span>${r.stop != null ? `<span class="knee" title="O piso deixaria rolar até ${r.max}g, mas depois de ${r.spend}g cada loja rende menos que a média do plano.">de ${r.max}g</span>` : ""}${r.keep != null ? `<span class="floor" title="pare quando chegar a ${r.keep}g">${glyph("flag")}${r.keep}g</span>` : ""}`
          : "";
        curveBox.innerHTML = curveSVG(r.curve, r);
        curveBox.hidden = !r.curve;
        curveBox.title = r.curve
          ? `${r.curve.name} ${r.curve.stars}★: chance de juntar ${plural(r.curve.k, "cópia", "cópias")} por ouro gasto, contando lojas e o preço das cópias${r.curve.exact ? " (a pool encolhe a cada compra)" : ""}${r.curve.level ? ` · nível ${r.curve.level}` : ""}${r.curve.q50 != null ? ` · ${r.curve.q50}g para 50%` : ""}`
          : "";
        reconcile(targets, r.targets, {
          key: (t) => t.id,
          create: tgNode,
          update: (node, t) => {
            node.dataset.done = t.done ? "1" : "0";
            node.title = `${t.name} ${t.goalStars}★ · ${t.own}/${t.goal} cópias · ${pct(t.chancePerShop)} por loja${t.chanceInRoll != null ? ` · ${pct(t.chanceInRoll)} de fechar com ${r.spend}g` : ""}${t.enemy ? ` · ${t.enemy} com rivais` : ""}`;
            node.innerHTML = `${portrait(t.id, t.name, { size: 26, ring: t.done ? "is-done" : "is-pending" })}<span class="name">${esc(t.name)}<small>${t.goalStars}★</small></span>${pips(Math.min(t.own, t.need), t.need, t.done ? "" : "amber")}<span class="chance" title="chance por loja">${pct(t.chancePerShop)}</span>${t.chanceInRoll != null && !t.done ? `<span class="in-roll" title="chance de fechar com ${r.spend}g">→ ${pct(t.chanceInRoll)}</span>` : ""}${t.enemy ? `<span class="rivals" title="${t.enemy} cópia(s) com rivais">${glyph("swords")}${t.enemy}</span>` : ""}`;
          },
        });
      }

      /* Ouro */
      const e = p.economy;
      eco.hidden = !e;
      if (e) {
        const known = e.gold != null;
        eco.dataset.unknown = known ? "0" : "1";
        setVerdict(
          ecoHead.verdict,
          e.saving
            ? "poupar"
            : e.keep != null && e.spend
              ? `piso ${e.keep}g`
              : "",
          e.saving ? "go" : "wait",
        );
        const inc = e.income,
          total = e.incomeParts.reduce((s, x) => s + x.value, 0) || 1;
        sum.innerHTML = !known
          ? `<b class="now">–</b><small class="unread" title="Ouro, juros, renda e projeção aparecem quando a leitura da tela estiver ativa durante a partida.">ouro não lido da tela</small>`
          : `<div class="eco-now"><b class="now">${e.gold}<small>g</small></b>${e.spend ? `<span class="arrow" aria-hidden="true">→</span><b class="after" title="depois desta ação${e.shopSpend ? `, incluindo ${e.shopSpend}g da loja` : ""}">${e.after}<small>g</small></b>` : ""}</div>${inc ? `<div class="eco-inc" title="${esc(`Renda da próxima rodada: ${e.incomeParts.map((x) => `${x.value} ${x.label}`).join(" + ")}`)}"><span class="inc-total"><b>+${inc.total}</b><small>/rodada</small></span><span class="inc-bar">${e.incomeParts.map((x) => `<i data-kind="${x.kind}" style="--w:${x.value / total}"></i>`).join("")}</span></div>` : ""}`;
        chart.hidden = !known || !e.projection.length;
        chart.innerHTML = chart.hidden ? "" : goldSVG(e);
        const chipList = [];
        if (e.streak)
          chipList.push(
            `<span class="chip streak" data-kind="${esc(e.streak.kind)}" title="sequência inferida pela vida entre rodadas: +${e.streak.gold}g por rodada">${glyph("up")}${plural(e.streak.length, e.streak.kind === "win" ? "vitória" : "derrota", e.streak.kind === "win" ? "vitórias" : "derrotas")}</span>`,
          );
        if (e.sellable)
          chipList.push(
            `<span class="chip" title="venda do banco fora da comp: ${esc(e.sellable.units.map((u) => `${u.name} ${u.stars}★ (${u.value}g)`).join(", "))}">${glyph("coin")}banco +${e.sellable.gold}g</span>`,
          );
        if (e.shopSpend)
          chipList.push(
            `<span class="chip" title="cartas da loja que o plano manda comprar">${glyph("bank")}loja −${e.shopSpend}g</span>`,
          );
        chips.innerHTML = chipList.join("");
        chips.hidden = !chipList.length;
      }

      /* Loja: odds do nível em uma barra só, com o custo do carry aceso */
      const o = p.odds ?? [];
      odds.hidden = !o.length;
      oddsHead.title.innerHTML = `${glyph("eye")}Loja${p.level?.level ? ` · nível ${p.level.level}` : ""}`;
      reconcile(
        oddsBar,
        o.map((v, i) => ({ cost: i + 1, v })),
        {
          key: (s) => s.cost,
          create: () => el("div", { class: "odds-seg" }, el("span")),
          update: (node, s) => {
            setVars(node, {
              "--w": Math.max(s.v, 0.0001),
              "--c": `var(--cost-${s.cost})`,
            });
            node.dataset.carry = s.cost === p.carryCost ? "1" : "0";
            node.dataset.zero = s.v === 0 ? "1" : "0";
            node.dataset.small = s.v > 0 && s.v < 9 ? "1" : "0"; // sem rótulo: cor cheia para não parecer vazio
            node.firstChild.textContent = s.v >= 9 ? `${s.v}%` : "";
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
