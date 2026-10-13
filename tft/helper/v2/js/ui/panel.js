import { el, reconcile, esc } from "../dom.js";
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

/* ---------- Montagem ---------- */

const section = (cls, ...kids) =>
  el("section", { class: `blk ${cls}` }, ...kids);
const head = (label, icon) => {
  const verdict = el("b", { class: "verdict" }),
    title = el("h2", { class: "blk-title" });
  title.innerHTML = `${glyph(icon)}${esc(label)}`;
  return { node: el("header", {}, title, verdict), verdict, title };
};
const setVerdict = (v, text, tone, title = "") => {
  setText(v, text);
  if (v.dataset.tone !== tone) v.dataset.tone = tone;
  v.hidden = !text;
  if (v.title !== title) v.title = title;
};

/** Peça do time na loja agora (o que comprar e a confiança da leitura), dentro da linha dela. */
const shopHtml = (s) =>
  `<span class="in-shop" data-go="${s.buy ? 1 : 0}"${s.probable ? ' data-conf="provavel"' : ""} title="na loja agora, slot ${s.slots.join(", ")}${s.closes ? ` · ${esc(s.closes)}` : ""} · ${s.buy ? `compre ${s.buy} (${s.gold}g)` : esc(s.action ?? "não compre")}${s.confidenceTitle ? `\n${esc(s.confidenceTitle)}` : ""}">${glyph("eye")}${s.buy ? `×${s.buy} · ${s.gold}g` : esc(s.action ?? "–")}${s.probable ? '<i class="conf" aria-hidden="true">?</i><span class="sr"> (leitura provável)</span>' : ""}<span class="sr"> na loja agora</span></span>`;

/**
 * Achar rolando: chance de ver pelo menos uma cópia nas lojas do orçamento; ponto verde com 50% ou mais; ↑ = subir de
 * nível leva a chance ao verde, ↓ = tira. Só informa (o servidor não manda rolar por ele).
 */
const seekHtml = (f) =>
  `<span class="seek" data-go="${f.go ? 1 : 0}" title="Achar rolando: ${esc(f.title)}"><i class="dot" aria-hidden="true"></i><span class="sr">achar rolando: </span>${Math.round(f.now * 100)}%${f.levelUp ? '<b class="lv" data-dir="up" title="Subir de nível leva a chance a 50% ou mais">↑<span class="sr"> subir de nível leva a chance a 50% ou mais</span></b>' : f.levelDown ? '<b class="lv" data-dir="down" title="Subir de nível reduz a chance abaixo de 50%">↓<span class="sr"> subir de nível reduz a chance abaixo de 50%</span></b>' : ""}</span>`;

/**
 * Linha de uma peça do time: retrato, nome, estrelas e, embaixo, as chances (por loja, com o orçamento, rivais, na loja
 * agora e achar rolando). `hit`: a peça na loja de agora (`roll.shop`); `seek`: o "achar rolando" dela (`roll.finds`).
 */
const targetHtml = (t, r, hit, seek) => {
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
  const inShop = hit
    ? shopHtml(hit)
    : t.shop
      ? `<span class="in-shop" title="na loja agora">${glyph("eye")}${t.shop.buy ? `×${t.shop.buy}` : ""}<span class="sr"> na loja agora</span></span>`
      : "";
  return `${lead}${progress}<span class="tg-stats">${chances}${rivals}${inShop}${seek ? seekHtml(seek) : ""}</span>`;
};

/** Peça só com o "achar rolando" (fora das linhas de evolução): retrato, nome e a chance de vê-la rolando. */
const seekOnlyHtml = (f) =>
  `${portrait(f.id, f.name, { size: 28, hidden: true })}<span class="name">${esc(f.name)}<small>${f.mine ? "sua" : "da comp"}</small></span><span class="tg-stats">${seekHtml(f)}</span>`;

/**
 * Widget de Roll da Formação: veredito e motivo, orçamento, nota de juros e, numa lista só, cada peça do time com a
 * evolução, a chance por loja, a chance de fechar com o orçamento, as cópias com rivais, a peça na loja agora e a chance
 * de achar rolando; depois os wisps da loja e "Por que esta decisão".
 */
export function mountPanel(root) {
  /* Roll: veredito e motivo, orçamento e a lista por peça */
  const rollHead = head("Roll", "roll"),
    call = el("div", { class: "call" }),
    spend = el("div", { class: "spend" }),
    note = el("div", { class: "roll-note" }),
    targets = el("div", { class: "targets" }),
    roll = section("roll", rollHead.node, call, spend, note, targets);
  /* Wisps (fogos-fátuos) da loja: marca com imagem, nome no tooltip e a recomendação de compra (v2/js/wisps.js). */
  const wispBox = el("div", { class: "wisp-hits" }),
    shop = section("shop", wispBox);
  /* Por quê: o <details> persiste entre as leituras, então ficar aberto é do navegador; só o corpo é reescrito. */
  const whyBody = el("div"),
    why = el(
      "details",
      { class: "why-box" },
      el("summary", {}, "Por que esta decisão"),
      whyBody,
    );
  root.replaceChildren(roll, shop, why);

  const tgNode = () => el("div", { class: "tg" });

  return {
    update(p, wisps = []) {
      const r = p?.roll ?? null;
      roll.hidden = !r;
      shop.hidden = !wisps.length;
      why.hidden = !p || (!p.steps.length && !p.reasons.length);
      root.hidden = roll.hidden && shop.hidden && why.hidden;
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
      }
      // Uma lista só: as linhas de evolução com a loja e o "achar rolando" de cada peça; as peças que só têm o "achar
      // rolando" (fora das linhas) vêm depois, na ordem dele.
      const hits = new Map((r?.shop ?? []).map((h) => [h.id, h])),
        seeks = new Map((r?.finds ?? []).map((f) => [f.id, f])),
        listed = new Set((r?.targets ?? []).map((t) => t.id)),
        rows = [
          ...(r?.targets ?? []).map((t) => ({ t })),
          ...(r?.finds ?? [])
            .filter((f) => !listed.has(f.id))
            .map((f) => ({ f })),
        ];
      targets.hidden = !rows.length;
      reconcile(targets, rows, {
        key: (x) => (x.t ? x.t.id : `find:${x.f.id}`),
        create: tgNode,
        update: (node, x) => {
          if (x.f) {
            node.dataset.status = "find";
            node.dataset.shop = "";
            node.title = x.f.title;
            put(node, seekOnlyHtml(x.f));
            return;
          }
          const t = x.t,
            hit = hits.get(t.id) ?? null;
          node.dataset.status = t.status;
          node.dataset.shop =
            hit?.buy || t.shop?.buy ? "buy" : hit || t.shop ? "seen" : "";
          node.title = t.title;
          put(node, targetHtml(t, r, hit, seeks.get(t.id) ?? null));
        },
      });

      /* Wisps na loja: o Wisp não é campeão (não entra na rolagem); aqui só a marca e o que fazer com ele. */
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
        p
          ? `${p.steps.length ? `<ol>${p.steps.map((t) => `<li>${richText(t)}</li>`).join("")}</ol>` : ""}${p.reasons.length ? `<ul>${p.reasons.map((t) => `<li>${richText(t)}</li>`).join("")}</ul>` : ""}`
          : "",
      );
    },
  };
}
