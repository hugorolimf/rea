/**
 * Bloco "Entra e sai" do overlay: a lista curta das trocas de agora, num elemento próprio (posicionável como os outros),
 * nunca desenhada sobre o tabuleiro ou a reserva do jogo. Em ordem: quem entra da reserva (e quem ele tira do campo),
 * quem sai para a reserva, o que vender, o substituto a comprar na loja para uma vaga e os temporários que seguram a
 * vaga do titular (⇄, com a volta na dica).
 *
 * Não decide nada: lê o modelo por vaga da análise (`stage.slots` de core/board/interim.mjs: quem joga em cada vaga, de
 * onde vem, quem sai, a volta do titular; e `stage.interim.buys[].sell`, a venda que abre vaga na reserva) ou, sem ele,
 * as trocas do plano (`transitions`: prontas = entra/sai; não prontas = o temporário segura a vaga). Também dá as
 * compras de substituto que a loja marca (`tempBuys`). Funções puras, sem imports; o desenho usa os retratos da interface
 * injetados em `ui`.
 */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v ? v : null);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ref = (u) =>
  isObj(u) && str(u.id)
    ? { id: u.id, name: str(u.name) ?? u.id, stars: num(u.stars) }
    : null;

/** Quantas linhas o bloco mostra; o resto vira "+N" com a lista na dica do mouse. */
export const SWAPS_SHOWN = 5;

/** Ordem das linhas: entra, sai, vende, compra de substituto, temporário. */
const ORDER = Object.freeze({ enter: 0, leave: 1, sell: 2, buy: 3, temp: 4 });

/** Frase da volta do titular (`until` do modelo: texto ou `{ text }`), ou null. */
const untilText = (u) => (str(u) ? u : isObj(u) && str(u.text) ? u.text : null);

const starText = (u) => (u?.stars > 1 ? ` ${u.stars}★` : "");

/**
 * Linhas do bloco a partir do plano exibido (`rec.preview` ou `rec.recommendations[0]`): `[{ kind, in, out, for, cost,
 * slot, until, text }]` (`in`/`out`/`for`: `{ id, name, stars }`). `text` é a frase inteira, para a dica do mouse e
 * para o leitor de tela. Nunca lança.
 */
export function swapRows(plan) {
  try {
    if (!isObj(plan)) return [];
    const rows = [];
    const slots = Array.isArray(plan.stage?.slots) ? plan.stage.slots : null;
    if (slots) {
      for (const s of slots) {
        const p = ref(s?.playing),
          orig = ref(s?.original) ?? ref(s?.unit),
          rep = ref(s?.replaces);
        const source = s?.playing?.source;
        if (p && source === "reserva") {
          rows.push({
            kind: "enter",
            in: p,
            out: rep,
            for: null,
            text: rep
              ? `${rep.name}${starText(rep)} sai e ${p.name} entra (da reserva)`
              : `${p.name} entra (da reserva)${orig && orig.id !== p.id ? ` na vaga de ${orig.name}` : ""}`,
          });
          if (rep)
            rows.push({
              kind: "leave",
              in: null,
              out: rep,
              for: null,
              text: `${rep.name} sai para a reserva (entra ${p.name})`,
            });
          continue;
        }
        if (p && source === "loja" && s.kind === "temporario" && orig) {
          const until = untilText(s.until);
          rows.push({
            kind: "buy",
            in: p,
            out: null,
            for: orig,
            cost: num(s.playing?.buy?.cost),
            slot: num(s.playing?.buy?.slot),
            until,
            text: `compre ${p.name} da loja para a vaga de ${orig.name}${until ? ` (${until})` : ""}`,
          });
          continue;
        }
        if (p && s.kind === "temporario" && orig && p.id !== orig.id) {
          const until = untilText(s.until);
          rows.push({
            kind: "temp",
            in: p,
            out: null,
            for: orig,
            until,
            text: `${p.name}${starText(p)} segura a vaga de ${orig.name}${until ? `: ${until}` : ""}${str(s.why) ? ` · ${s.why}` : ""}`,
          });
        }
      }
      for (const b of Array.isArray(plan.stage?.interim?.buys)
        ? plan.stage.interim.buys
        : []) {
        const sell = ref(b?.sell);
        if (!sell) continue;
        rows.push({
          kind: "sell",
          in: null,
          out: sell,
          for: null,
          text: `venda ${sell.name} para abrir vaga na reserva (${b.name ?? ""} vai para a reserva)`,
        });
      }
    } else
      for (const t of Array.isArray(plan.transitions) ? plan.transitions : []) {
        const enter = ref(t?.enter),
          exit = ref(t?.exit);
        if (!enter) continue;
        if (t.ready === true) {
          const from = t.source === "reserve" ? "da reserva" : "da loja";
          rows.push({
            kind: "enter",
            in: enter,
            out: exit,
            for: null,
            text: exit
              ? `${exit.name} sai e ${enter.name} entra (${from})`
              : `${enter.name} entra (${from})`,
          });
          if (exit)
            rows.push({
              kind: "leave",
              in: null,
              out: exit,
              for: null,
              text: `${exit.name} sai para a reserva (entra ${enter.name})`,
            });
        } else if (exit) {
          const need = num(t.requiredStars);
          const until = need
            ? `volta quando ${enter.name} chegar a ${need}★`
            : null;
          rows.push({
            kind: "temp",
            in: { ...exit, stars: num(t.exitStars) ?? exit.stars },
            out: null,
            for: enter,
            until,
            text: `${exit.name} segura a vaga de ${enter.name}${until ? `: ${until}` : ""}${str(t.reason) ? ` · ${t.reason}` : ""}`,
          });
        }
      }
    return rows
      .map((r, n) => ({ r, n }))
      .sort((a, b) => ORDER[a.r.kind] - ORDER[b.r.kind] || a.n - b.n)
      .map(({ r }) => r);
  } catch {
    return [];
  }
}

/**
 * Substitutos temporários que o modelo manda comprar na loja (`kind: "temporario"`, `playing.source: "loja"`, com
 * `buy.slot`): `[{ id, name, cost, slot, forName, until }]`. É o que a loja do jogo marca com ⇄ "Compre (temporário)".
 */
export function tempBuys(plan) {
  return swapRows(plan)
    .filter((r) => r.kind === "buy" && r.slot != null)
    .map((r) => ({
      id: r.in.id,
      name: r.in.name,
      cost: r.cost,
      slot: r.slot,
      forName: r.for.name,
      until: r.until,
    }));
}

/**
 * HTML do bloco. `rows`: `swapRows(...)`; `ui`: `{ esc, glyph, portrait }`. Cada linha: retratos (o nome no `title` e
 * para o leitor de tela) e a ação curta; a frase inteira vai na dica do mouse. Até `SWAPS_SHOWN` linhas e "+N". Sem
 * trocas, vazio (o elemento some).
 */
export function swapsHtml(rows, ui) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "";
  const { esc, glyph, portrait } = ui;
  const pt = (u, size = 24) =>
    `<span class="sw-pt" title="${esc(`${u.name}${starText(u)}`)}">${portrait(u.id, u.name, { size, hidden: true })}${u.stars > 1 ? `<i class="st">${"★".repeat(Math.min(3, u.stars))}</i>` : ""}</span>`;
  const op = (t) => `<span class="op" aria-hidden="true">${t}</span>`;
  const line = (r) => {
    const body =
      r.kind === "enter"
        ? `${r.out ? `${pt(r.out)}${op("→")}` : ""}${pt(r.in)}<span class="sw-tx">entra (da reserva)</span>`
        : r.kind === "leave"
          ? `${pt(r.out)}<span class="sw-tx">↓ sai para a reserva</span>`
          : r.kind === "sell"
            ? `<span class="sw-tx">$ vender</span>${pt(r.out)}`
            : r.kind === "buy"
              ? `<span class="sw-buy">${glyph("coin")}${r.cost != null ? esc(r.cost) : ""}</span>${pt(r.in)}<span class="sw-tx">da loja</span>${op("→")}<span class="sw-tx">vaga de</span>${pt(r.for, 20)}`
              : `${pt(r.in)}<i class="sw-swap" aria-hidden="true">⇄</i>${pt(r.for, 20)}<span class="sw-tx">segura a vaga</span>`;
    return `<li class="line sw-row" data-kind="${esc(r.kind)}" title="${esc(r.text)}">${body}<b class="sr">${esc(r.text)}</b></li>`;
  };
  const shown = list.slice(0, SWAPS_SHOWN),
    rest = list.slice(SWAPS_SHOWN);
  return `<header><span class="eyebrow">Entra e sai</span></header><ul class="lines sw-list" aria-label="Trocas de agora">${shown.map(line).join("")}</ul>${rest.length ? `<p class="detail" title="${esc(rest.map((r) => r.text).join("\n"))}">+${esc(rest.length)} ${rest.length === 1 ? "troca" : "trocas"}</p>` : ""}`;
}
