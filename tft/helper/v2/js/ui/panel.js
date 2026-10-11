import { el, reconcile, setVars, esc } from "../dom.js";
import { clamp, monotonePath, round } from "../math.js";
import { glyph, pct, pips, portrait } from "./glyphs.js";
import { nameChip, richText } from "./rich-text.js";

/* ---------- Escrita só quando mudou ---------- */

/** HTML já escrito em cada nó: o painel é relido a cada leitura e só reescreve o que de fato mudou. */
const drawn = new WeakMap();
const put = (node, html) => {
  if (drawn.get(node) === html) return;
  drawn.set(node, html);
  node.innerHTML = html;
};
const setText = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};

/* ---------- Roll: chance acumulada de fechar o upgrade por ouro gasto ---------- */

const CW = 280,
  CH = 104,
  CM = { l: 30, r: 12, t: 12, b: 24 };
const cx = (g, maxG) => CM.l + (g / (maxG || 1)) * (CW - CM.l - CM.r);
const cy = (v) => CM.t + (1 - v) * (CH - CM.t - CM.b);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** Números principais da curva em texto: ouro para 50% e 80% de chance e o ponto do gasto recomendado. */
function curveFacts(curve) {
  const out = [];
  if (finite(curve.q50)) out.push(`50% em ${curve.q50}g`);
  if (finite(curve.q80)) out.push(`80% em ${curve.q80}g`);
  if (curve.planned != null && curve.plannedValue != null)
    out.push(
      `${Math.round(curve.plannedValue * 100)}% gastando ${curve.planned}g`,
    );
  return out;
}

/**
 * Curva da cadeia de Markov (lojas + cópias pagas, pool encolhendo). A área até o gasto recomendado
 * fica acesa: é a chance que esta rolagem compra. Marcas: 80% de chance e, se a curva de ganho mandou
 * parar antes, o teto permitido pelo piso. Cores só por classe CSS (tokens), nunca literal.
 */
function curveSVG(curve, roll) {
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
  const facts = curveFacts(curve),
    what = curve.team
      ? "pelo menos uma peça do time evoluir"
      : `${esc(curve.name)} ${curve.stars}★`,
    label = `Chance acumulada de ${what} por ouro gasto${facts.length ? `. ${facts.join(", ")}` : ""}`;
  return `<svg viewBox="0 0 ${CW} ${CH}" class="curve" role="img" aria-label="${label}">
    <defs><linearGradient id="curve-fill" x1="0" x2="0" y1="0" y2="1"><stop class="st-a" offset="0"/><stop class="st-b" offset="1"/></linearGradient>
    <linearGradient id="curve-lit-fill" x1="0" x2="0" y1="0" y2="1"><stop class="st-c" offset="0"/><stop class="st-d" offset="1"/></linearGradient></defs>
    ${[0, 0.5, 1].map((v) => `<line class="g" x1="${CM.l}" x2="${CW - CM.r}" y1="${round(cy(v))}" y2="${round(cy(v))}"/><text class="ax" x="${CM.l - 6}" y="${round(cy(v) + 3)}" text-anchor="end">${v * 100}%</text>`).join("")}
    ${ticks.join("")}
    <path class="area" d="${area}"/>${lit}<path class="line" d="${line}"/>${marks.join("")}</svg>`;
}

/** Legenda visível da curva (o SVG leva a mesma informação no rótulo): de que peça é e os números principais. */
function curveCaption(curve) {
  const facts = curveFacts(curve);
  return `<p class="curve-cap" aria-hidden="true"><b>${curve.team ? "Evoluir alguma peça do time" : `${richText(curve.name)} ${curve.stars}★`}</b>${facts.length ? `<span class="facts">${esc(facts.join(" · "))}</span>` : ""}</p>`;
}

/* ---------- Montagem ---------- */

const section = (cls, ...kids) =>
  el("section", { class: `blk ${cls}` }, ...kids);
const head = (label, icon) => {
  const verdict = el("b", { class: "verdict" }),
    title = el("h2", { class: "blk-title" });
  title.innerHTML = `${glyph(icon)}${esc(label)}`;
  return { node: el("header", {}, title, verdict), verdict, title };
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const setVerdict = (v, text, tone, title = "") => {
  setText(v, text);
  if (v.dataset.tone !== tone) v.dataset.tone = tone;
  v.hidden = !text;
  if (v.title !== title) v.title = title;
};

/** Uma peça que a loja mostra agora e que o time quer: o que comprar e a confiança da leitura. */
const hitHtml = (s) =>
  `<span class="hit chip"${s.action === "comprar" ? ' data-tone="go"' : ""}${s.confidence ? ` data-conf="${s.probable ? "provavel" : "confiavel"}"` : ""} title="${esc(s.name)} no slot ${s.slots.join(", ")}${s.closes ? ` · ${esc(s.closes)}` : ""} · ${s.buy ? `compre ${s.buy} (${s.gold}g)` : esc(s.action ?? "não compre")}${s.confidenceTitle ? `\n${esc(s.confidenceTitle)}` : ""}">${nameChip("champion", s.id, s.name, { size: 20 })}${s.buy ? ` ×${s.buy} · ${s.gold}g` : ` · ${esc(s.action ?? "–")}`}${s.probable ? '<i class="conf" aria-hidden="true">?</i><span class="sr"> (leitura provável)</span>' : ""}</span>`;

/** Chance de ver pelo menos uma cópia rolando; ↑ = subir de nível leva a chance ao verde, ↓ = tira. */
const findHtml = (f) =>
  `<span class="find chip"${f.go ? ' data-tone="go"' : ""} data-go="${f.go ? 1 : 0}" data-mine="${f.mine ? 1 : 0}" title="${esc(f.title)}">${portrait(f.id, f.name, { size: 20 })}<i class="dot"></i>${Math.round(f.now * 100)}%${f.levelUp ? '<b class="lv" data-dir="up" title="Subir de nível leva a chance a 50% ou mais">↑<span class="sr"> subir de nível leva a chance a 50% ou mais</span></b>' : f.levelDown ? '<b class="lv" data-dir="down" title="Subir de nível reduz a chance abaixo de 50%">↓<span class="sr"> subir de nível reduz a chance abaixo de 50%</span></b>' : ""}</span>`;

/** Linha de uma peça do time: retrato, nome, estrelas e, embaixo, as chances (por loja, com o orçamento, rivais, loja). */
const targetHtml = (t, r) => {
  const blocked = t.status === "inviavel",
    budget = r.call?.budget,
    core = t.core
      ? `<i class="core" title="core: pesa mais na decisão">${glyph("crown")}<span class="sr">core </span></i>`
      : "";
  const lead = `${portrait(t.id, t.name, { size: 28, hidden: true, ring: blocked ? "" : "is-pending" })}<span class="name">${core}${esc(t.name)}<small>${esc(t.tag)}</small></span>`;
  const progress = t.pips
    ? pips(Math.min(t.own, t.goal), t.goal, "amber")
    : `<span class="frac">${t.own}/${t.goal}</span>`;
  const chances = blocked
    ? `<span class="bad">inviável${t.substitute ? ` · ${nameChip("champion", t.substitute.id, t.substitute.name, { size: 18 })}` : ""}</span>`
    : `<span class="chance" title="chance por loja">${pct(t.chancePerShop)}<small> por loja</small></span>${t.chance != null ? `<span class="in-roll" title="chance de fechar com ${budget ?? "?"}g">→ ${pct(t.chance)}${budget != null ? `<small> com ${budget}g</small>` : ""}</span>` : ""}`;
  const rivals =
    t.enemy || t.hidden >= 1
      ? `<span class="rivals" title="cópias nos tabuleiros rivais${t.hidden >= 1 ? " (+ estimativa dos bancos deles)" : ""}">${glyph("swords")}${t.enemy}${t.hidden >= 1 ? `<small>+${Math.round(t.hidden)}</small>` : ""}<span class="sr"> cópias com rivais</span></span>`
      : "";
  const inShop = t.shop
    ? `<span class="in-shop" title="na loja agora">${glyph("eye")}${t.shop.buy ? `×${t.shop.buy}` : ""}<span class="sr"> na loja agora</span></span>`
    : "";
  return `${lead}${progress}<span class="tg-stats">${chances}${rivals}${inShop}</span>`;
};

/** Descrição curta de um nó do nível para o leitor de tela (a trilha inteira é uma imagem com este rótulo). */
function levelLabel(lv, xp) {
  const roll = lv.nodes.find((n) => n.roll),
    last = lv.nodes.find((n) => n.final);
  return [
    `Nível ${lv.level}`,
    xp
      ? xp.max
        ? "XP no máximo"
        : `XP ${xp.have} de ${xp.total}`
      : "XP não lido",
    lv.cost != null
      ? lv.passive
        ? `o nível ${lv.level + 1} sai de graça pelo XP passivo`
        : `faltam ${lv.cost}g de XP para o nível ${lv.level + 1}`
      : "",
    roll ? `nível de rolagem ${roll.n}` : "",
    last ? `nível final da comp ${last.n}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function mountPanel(root) {
  /* Nível: nós e elos; o elo do nível atual é a barra de XP */
  const lvHead = head("Nível", "up"),
    track = el("div", { class: "lv-track", role: "img" }),
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
  const oddsBar = el("div", { class: "odds-bar", "aria-hidden": "true" }),
    oddsKey = el("ul", {
      class: "odds-key",
      "aria-label": "Chance por slot, por custo de campeão",
    }),
    // Wisps (fogos-fátuos) da loja: marca com imagem, nome no tooltip e a recomendação de compra (v2/js/wisps.js).
    wispBox = el("div", { class: "wisp-hits" }),
    odds = section("odds", oddsHead.node, oddsBar, oddsKey, wispBox);
  /* Por quê: o <details> persiste entre as leituras, então ficar aberto é do navegador; só o corpo é reescrito. */
  const whyBody = el("div"),
    why = el(
      "details",
      { class: "why-box" },
      el("summary", {}, "Por que esta decisão"),
      whyBody,
    );
  root.replaceChildren(level, roll, odds, why);

  const lvNode = () =>
    el("span", { class: "lv-node" }, el("b"), el("i"), el("em"));
  const lvLink = () => el("span", { class: "lv-link" }, el("b"), el("small"));
  const tgNode = () => el("div", { class: "tg" });
  const oddsKeyNode = () =>
    el("li", {}, el("i"), el("b"), el("span"), el("small"));
  let levelText = "";

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
              setText(node.querySelector("small"), it.text);
              node.title = it.text ? `XP ${it.text}` : "";
              return;
            }
            node.dataset.state = it.state;
            node.dataset.next = it.next ? "1" : "0";
            node.dataset.roll = it.roll ? "1" : "0";
            node.dataset.final = it.final ? "1" : "0";
            setText(node.querySelector("b"), String(it.n));
            put(
              node.querySelector("i"),
              it.roll ? glyph("roll") : it.final ? glyph("flag") : "",
            );
            // Custo pendurado no próximo nível: ouro para completar o XP, ou "grátis" pelo XP passivo.
            const upcoming = it.n === lv.level + 1;
            const cost =
              upcoming && lv.cost != null
                ? lv.passive
                  ? "grátis"
                  : `${lv.cost}g`
                : "";
            const em = node.querySelector("em");
            setText(em, cost);
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
        const text = levelLabel(lv, xp);
        if (text !== levelText) {
          levelText = text;
          track.setAttribute("aria-label", text);
        }
        setVerdict(
          lvHead.verdict,
          lv.go ? "subir" : lv.passive ? "XP grátis" : xp ? "" : "XP ?",
          lv.go ? "go" : "wait",
          lv.passive
            ? "Não compre XP: o XP passivo da próxima rodada completa o nível."
            : xp
              ? ""
              : "XP sem fonte agora",
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
        put(
          call,
          c
            ? `<b>${richText(c.title)}</b><span title="${esc(c.reason)}">${richText(c.reason)}</span>`
            : "",
        );
        spend.hidden = !r.go;
        put(
          spend,
          r.go
            ? `<b>${r.spend}g</b><span>até ${r.shops} lojas</span>${r.stop != null ? `<span class="knee" title="O piso deixaria rolar até ${r.max}g, mas depois de ${r.spend}g cada loja rende menos que a média do plano.">limite do piso ${r.max}g</span>` : ""}${r.keep != null ? `<span class="floor" title="pare quando chegar a ${r.keep}g">${glyph("flag")}pare em ${r.keep}g</span>` : ""}`
            : "",
        );
        // Juros só entram quando mudam a decisão.
        note.hidden = !r.interest;
        put(
          note,
          r.interest
            ? `${glyph("coin")}<span>Rolar derruba os juros de +${r.interest.from} para +${r.interest.to} por rodada.</span>`
            : "",
        );
        // Peças do time na loja agora e o que comprar delas.
        shopHits.hidden = !r.shop.length;
        put(
          shopHits,
          r.shop.length
            ? `<span class="lbl">Na loja</span>${r.shop.map(hitHtml).join("")}`
            : "",
        );
        // Indicador verde: dá para achar a peça rolando (só informação).
        finds.hidden = !r.finds.length;
        put(
          finds,
          r.finds.length
            ? `<span class="lbl" title="Chance de ver pelo menos uma cópia rolando. Verde: 50% ou mais. Considera a pool, as cópias nos tabuleiros rivais e a estimativa dos bancos deles (não é leitura).">Achar rolando<small> · chance de ver uma cópia</small></span>${r.finds.map(findHtml).join("")}`
            : "",
        );
        put(
          curveBox,
          r.curve ? `${curveCaption(r.curve)}${curveSVG(r.curve, r)}` : "",
        );
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
            node.dataset.status = t.status;
            node.dataset.shop = t.shop?.buy ? "buy" : t.shop ? "seen" : "";
            node.title = t.title;
            put(node, targetHtml(t, r));
          },
        });
        more.hidden = !r.more;
        setText(
          more,
          r.more
            ? `+${r.more} ${r.more === 1 ? "peça" : "peças"} do time fora desta lista`
            : "",
        );
      }

      /* Loja: odds do nível em uma barra só, com o custo do carry aceso, e a legenda com os números */
      const o = p.odds ?? [];
      odds.hidden = !o.length && !wisps.length;
      put(
        oddsHead.title,
        `${glyph("eye")}Loja${p.level?.level ? ` · nível ${p.level.level}` : ""}`,
      );
      const slots = o.map((v, i) => ({ cost: i + 1, v }));
      reconcile(oddsBar, slots, {
        key: (s) => s.cost,
        create: () => el("div", { class: "odds-seg" }, el("span")),
        update: (node, s) => {
          setVars(node, {
            "--w": Math.max(s.v, 0.0001),
            "--c": `var(--cost-${s.cost})`,
          });
          node.dataset.carry = s.cost === p.carryCost ? "1" : "0";
          node.dataset.zero = s.v === 0 ? "1" : "0";
          node.dataset.small = s.v > 0 && s.v < 9 ? "1" : "0";
          setText(node.firstChild, s.v >= 9 ? `${s.v}%` : "");
          node.title = `Custo ${s.cost}: ${s.v}% por slot${s.cost === p.carryCost ? " · custo do carry" : ""}`;
        },
      });
      oddsKey.hidden = !o.length;
      reconcile(oddsKey, slots, {
        key: (s) => s.cost,
        create: oddsKeyNode,
        update: (node, s) => {
          const carry = s.cost === p.carryCost;
          setVars(node, { "--c": `var(--cost-${s.cost})` });
          node.dataset.carry = carry ? "1" : "0";
          node.dataset.zero = s.v === 0 ? "1" : "0";
          setText(node.children[1], `${s.cost}g`);
          setText(node.children[2], `${s.v}%`);
          setText(node.children[3], carry ? "carry" : "");
          node.title = `Custo ${s.cost}: ${s.v}% por slot${carry ? " · custo do carry" : ""}`;
        },
      });

      /* Wisps na loja: o Wisp não é campeão (não entra na rolagem); aqui só a marca e o que fazer com ele. */
      wispBox.hidden = !wisps.length;
      put(
        wispBox,
        wisps
          .map(
            (w) =>
              `<div class="wisp" data-verdict="${esc(w.veredito)}" data-tipo="${esc(w.tipo ?? "")}" title="${esc(w.title)}"><span class="wisp-mark" role="img" aria-label="Wisp ${esc(w.name)}">${w.image ? `<img src="${esc(w.image)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : ""}</span><b class="wisp-v">${esc(w.vereditoTexto)}</b><span class="wisp-why">${esc(w.motivo)}</span></div>`,
          )
          .join(""),
      );

      /* Por quê */
      put(
        whyBody,
        `${p.steps.length ? `<ol>${p.steps.map((t) => `<li>${richText(t)}</li>`).join("")}</ol>` : ""}${p.reasons.length ? `<ul>${p.reasons.map((t) => `<li>${richText(t)}</li>`).join("")}</ul>` : ""}`,
      );
      why.hidden = !p.steps.length && !p.reasons.length;
    },
  };
}
