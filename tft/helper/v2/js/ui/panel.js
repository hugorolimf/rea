import { el, reconcile, setVars, esc } from "../dom.js";
import { clamp, monotonePath, round } from "../math.js";
import { glyph, pct, pips, portrait } from "./glyphs.js";
import { nameChip, richText } from "./rich-text.js";

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
  return `<svg viewBox="0 0 ${CW} ${CH}" class="curve" role="img" aria-label="${curve.team ? "Chance acumulada de pelo menos uma peça do time evoluir" : `Chance acumulada de ${esc(curve.name)} ${curve.stars}★`} por ouro gasto">
    <defs><linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--amber)" stop-opacity=".32"/><stop offset="1" stop-color="var(--amber)" stop-opacity="0"/></linearGradient>
    <linearGradient id="curve-lit-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--go)" stop-opacity=".45"/><stop offset="1" stop-color="var(--go)" stop-opacity=".04"/></linearGradient></defs>
    ${[0, 0.5, 1].map((v) => `<line class="g" x1="${CM.l}" x2="${CW - CM.r}" y1="${round(cy(v))}" y2="${round(cy(v))}"/><text class="ax" x="${CM.l - 6}" y="${round(cy(v) + 3)}" text-anchor="end">${v * 100}%</text>`).join("")}
    ${ticks.join("")}
    <path class="area" d="${area}"/>${lit}<path class="line" d="${line}"/>${marks.join("")}</svg>`;
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
  /* Nível: nós e elos; o elo do nível atual é a barra de XP */
  const lvHead = head("Nível", "up"),
    track = el("div", { class: "lv-track" }),
    level = section("level", lvHead.node, track);
  /* Roll: veredito e motivo, orçamento, lista por peça do time e a curva de "alguma peça evolui" */
  const rollHead = head("Roll", "roll"),
    call = el("div", { class: "call" }),
    spend = el("div", { class: "spend" }),
    note = el("div", { class: "roll-note" }),
    shopHits = el("div", { class: "shop-hits" }),
    finds = el("div", { class: "finds" }),
    curveBox = el("div", { class: "curve-box" }),
    targets = el("div", { class: "targets" }),
    more = el("div", { class: "more" }),
    roll = section(
      "roll",
      rollHead.node,
      call,
      spend,
      note,
      shopHits,
      finds,
      targets,
      more,
      curveBox,
    );
  /* Loja */
  const oddsHead = head("Loja", "eye");
  oddsHead.verdict.hidden = true; // a loja não tem veredito
  const oddsBar = el("div", { class: "odds-bar" }),
    // Wisps (fogos-fátuos) da loja: marca com imagem, nome no tooltip e a recomendação de compra (v2/js/wisps.js).
    wispBox = el("div", { class: "wisp-hits" }),
    odds = section("odds", oddsHead.node, oddsBar, wispBox);
  /* Por quê */
  const whyBody = el("div", { class: "why-body" }),
    why = el(
      "details",
      { class: "why" },
      el("summary", {}, "Por que esta decisão"),
      whyBody,
    );
  root.replaceChildren(level, roll, odds, why);

  const lvNode = () =>
    el("span", { class: "lv-node" }, el("b"), el("i"), el("em"));
  const lvLink = () => el("span", { class: "lv-link" }, el("b"), el("small"));
  const tgNode = () => el("div", { class: "tg" });

  return {
    update(p, wisps = []) {
      root.dataset.empty = p ? "0" : "1";
      if (!p) return;
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
        const c = r.call;
        setVerdict(rollHead.verdict, r.pill.text, r.pill.tone, c?.reason ?? "");
        // Veredito e motivo: a regra única do servidor, em uma linha.
        call.hidden = !c;
        call.dataset.kind = c?.kind ?? "";
        call.innerHTML = c
          ? `<b>${richText(c.title)}</b><span title="${esc(c.reason)}">${richText(c.reason)}</span>`
          : "";
        spend.hidden = !r.go;
        spend.innerHTML = r.go
          ? `<b>${r.spend}g</b><span>até ${r.shops} lojas</span>${r.stop != null ? `<span class="knee" title="O piso deixaria rolar até ${r.max}g, mas depois de ${r.spend}g cada loja rende menos que a média do plano.">de ${r.max}g</span>` : ""}${r.keep != null ? `<span class="floor" title="pare quando chegar a ${r.keep}g">${glyph("flag")}pare em ${r.keep}g</span>` : ""}`
          : "";
        // Juros só entram quando mudam a decisão.
        note.hidden = !r.interest;
        note.innerHTML = r.interest
          ? `${glyph("coin")}<span>Rolar derruba os juros de +${r.interest.from} para +${r.interest.to} por rodada.</span>`
          : "";
        // Peças do time na loja agora e o que comprar delas.
        shopHits.hidden = !r.shop.length;
        shopHits.innerHTML = r.shop.length
          ? `<span class="lbl">Na loja</span>${r.shop
              .map(
                (s) =>
                  `<span class="hit" data-action="${esc(s.action ?? "")}"${s.confidence ? ` data-conf="${s.probable ? "provavel" : "confiavel"}"` : ""} title="${esc(s.name)} no slot ${s.slots.join(", ")}${s.closes ? ` · ${esc(s.closes)}` : ""} · ${s.buy ? `compre ${s.buy} (${s.gold}g)` : esc(s.action ?? "não compre")}${s.confidenceTitle ? `\n${esc(s.confidenceTitle)}` : ""}">${nameChip("champion", s.id, s.name, { size: 18 })}${s.buy ? ` ×${s.buy} · ${s.gold}g` : ` · ${esc(s.action ?? "–")}`}${s.probable ? '<i class="conf" aria-hidden="true">?</i>' : ""}</span>`,
              )
              .join("")}`
          : "";
        // Indicador verde: dá para achar a peça rolando (só informação). ↑ = subir de nível leva a chance ao verde; ↓ = tira.
        finds.hidden = !r.finds.length;
        finds.innerHTML = r.finds.length
          ? `<span class="lbl" title="Chance de ver pelo menos uma cópia rolando. Verde: 50% ou mais. Considera a pool, as cópias nos tabuleiros rivais e a estimativa dos bancos deles (não é leitura).">Achar rolando</span>${r.finds
              .map(
                (f) =>
                  `<span class="find" data-go="${f.go ? 1 : 0}" data-mine="${f.mine ? 1 : 0}" title="${esc(f.title)}">${portrait(f.id, f.name, { size: 18 })}<i class="dot"></i>${Math.round(f.now * 100)}%${f.levelUp ? '<b class="lv" data-dir="up" title="Subir de nível leva a chance a 50% ou mais">↑</b>' : f.levelDown ? '<b class="lv" data-dir="down" title="Subir de nível reduz a chance abaixo de 50%">↓</b>' : ""}</span>`,
              )
              .join("")}`
          : "";
        curveBox.innerHTML = curveSVG(r.curve, r);
        curveBox.hidden = !r.curve;
        curveBox.title = r.curve
          ? r.curve.team
            ? `Chance de pelo menos uma peça do time evoluir por ouro gasto${r.curve.level ? ` · nível ${r.curve.level}` : ""}${r.curve.q50 != null ? ` · ${r.curve.q50}g para 50%` : ""}`
            : `${r.curve.name} ${r.curve.stars}★: chance de juntar ${plural(r.curve.k, "cópia", "cópias")} por ouro gasto, contando lojas e o preço das cópias${r.curve.exact ? " (a pool encolhe a cada compra)" : ""}${r.curve.level ? ` · nível ${r.curve.level}` : ""}${r.curve.q50 != null ? ` · ${r.curve.q50}g para 50%` : ""}`
          : "";
        reconcile(targets, r.targets, {
          key: (t) => t.id,
          create: tgNode,
          update: (node, t) => {
            const blocked = t.status === "inviavel";
            node.dataset.status = t.status;
            node.dataset.shop = t.shop?.buy ? "buy" : t.shop ? "seen" : "";
            node.title = t.title;
            node.innerHTML = `${portrait(t.id, t.name, { size: 26, ring: blocked ? "" : "is-pending" })}<span class="name">${t.core ? `<i class="core" title="core: pesa mais na decisão">${glyph("crown")}</i>` : ""}${esc(t.name)}<small>${esc(t.tag)}</small></span>${t.pips ? pips(Math.min(t.own, t.goal), t.goal, "amber") : `<span class="frac">${t.own}/${t.goal}</span>`}${
              blocked
                ? `<span class="bad">inviável${t.substitute ? ` · ${nameChip("champion", t.substitute.id, t.substitute.name, { size: 18 })}` : ""}</span>`
                : `<span class="chance" title="chance por loja">${pct(t.chancePerShop)}</span>${t.chance != null ? `<span class="in-roll" title="chance de fechar com ${r.call?.budget}g">→ ${pct(t.chance)}</span>` : ""}`
            }${t.enemy || t.hidden >= 1 ? `<span class="rivals">${glyph("swords")}${t.enemy}${t.hidden >= 1 ? `<small>+${Math.round(t.hidden)}</small>` : ""}</span>` : ""}${t.shop ? `<span class="in-shop" title="na loja agora">${glyph("eye")}${t.shop.buy ? `×${t.shop.buy}` : ""}</span>` : ""}`;
          },
        });
        more.hidden = !r.more;
        more.textContent = r.more
          ? `+${r.more} ${r.more === 1 ? "peça" : "peças"} do time fora desta lista`
          : "";
      }

      /* Loja: odds do nível em uma barra só, com o custo do carry aceso */
      const o = p.odds ?? [];
      odds.hidden = !o.length && !wisps.length;
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

      /* Wisps na loja: o Wisp não é campeão (não entra na rolagem); aqui só a marca e o que fazer com ele. */
      wispBox.hidden = !wisps.length;
      wispBox.innerHTML = wisps
        .map(
          (w) =>
            `<div class="wisp" data-verdict="${esc(w.veredito)}" data-tipo="${esc(w.tipo ?? "")}" title="${esc(w.title)}"><span class="wisp-mark" role="img" aria-label="Wisp ${esc(w.name)}">${w.image ? `<img src="${esc(w.image)}" alt="" width="20" height="20" loading="lazy" decoding="async">` : ""}</span><b class="v">${esc(w.vereditoTexto)}</b><span class="why">${esc(w.motivo)}</span></div>`,
        )
        .join("");

      /* Por quê */
      whyBody.innerHTML = `${p.steps.length ? `<ol>${p.steps.map((t) => `<li>${richText(t)}</li>`).join("")}</ol>` : ""}${p.reasons.length ? `<ul>${p.reasons.map((t) => `<li>${richText(t)}</li>`).join("")}</ul>` : ""}`;
      why.hidden = !p.steps.length && !p.reasons.length;
    },
  };
}
