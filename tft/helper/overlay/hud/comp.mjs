/**
 * Painel da comp do overlay (atalhos "Ver comp", "Comp anterior" e "Próxima comp", lista única em `hotkeys.mjs`): mostra
 * sobre o jogo a comp do plano ou uma das sugeridas, com as peças (retrato e estrela), onde cada uma está (em campo, na
 * reserva, falta), quem joga no lugar de quem (substituta temporária ou troca da comp), a peça do plano que está na sua
 * loja, o carry, as builds de "Builds e 3★" (motor único `core/items/builds.mjs`, injetado) e as sinergias.
 *
 * Não decide nada: tudo vem da análise que o overlay já recebe em `/api/overlay` (o `rec` e o estado) e do modelo da
 * interface (`v2/js/model.js`); a regra de "peça sua" é a de `v2/js/roster.js` (injetada). Alternar entre as comps é só
 * apresentação: nada é fixado nem enviado ao servidor. Funções puras, sem imports (dependências por injeção), para
 * rodar no navegador e nos testes.
 *
 * Substituições: quando a análise trouxer o modelo único por vaga (`slots`, de `core/board/interim.mjs`, no formato
 * `{ slot, original:{id,name,stars,have}, playing:{id,name,stars,source,buy?:{cost,slot}}|null, kind, why, until }`),
 * ele é usado como está. Enquanto não existir, o painel usa o que já há: as trocas aceitas (`goal.swaps`/`autoSwaps`),
 * as trocas propostas do plano (`transitions`: quem segura a vaga até a peça da comp chegar à estrela) e a lista de
 * compra cruzada com a loja (`steps` "buy" do modelo, com o slot).
 */

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" && v ? v : null);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Tipos de vaga do modelo único: a peça da comp joga, uma substituta temporária joga, ou a comp trocou a peça. */
export const SLOT_KINDS = Object.freeze([
  "titular",
  "temporario",
  "troca-da-comp",
]);

/** Ações dos atalhos do painel (o main manda uma destas; o preload só deixa passar estas). */
export const COMP_ACTIONS = Object.freeze(["toggle", "show", "prev", "next"]);

/** Rótulo e marca de onde está a peça (estado nunca só por cor). */
export const WHERE = Object.freeze({
  field: { text: "em campo", mark: "check" },
  reserve: { text: "na reserva", mark: "bank" },
  absent: { text: "falta", mark: "plus" },
  unknown: { text: "fora de campo (reserva não lida)", mark: "clock" },
});

/** Onde o modelo único por vaga pode aparecer na análise (o primeiro que existir vale). */
const SLOT_PATHS = [
  (plan) => plan?.slots,
  (plan) => plan?.stage?.slots,
  (plan) => plan?.interim?.slots,
  (plan) => plan?.stage?.interim?.slots,
  (_plan, rec) => rec?.slots,
  (_plan, rec) => rec?.interim?.slots,
];

const unitRef = (u) =>
  isObj(u) && str(u.id)
    ? {
        id: u.id,
        name: str(u.name) ?? u.id,
        stars: num(u.stars),
      }
    : null;

/** "quando Aphelios chegar a 2★" a partir do `until` do modelo (texto ou `{ id, name, stars }`). */
function untilText(until, original) {
  if (str(until)) return until;
  // Formato de core/board/interim.mjs: `{ kind, stars, text }`, com a frase pronta ("volta quando ...").
  if (isObj(until) && str(until.text)) return until.text;
  if (isObj(until)) {
    const who = str(until.name) ?? original?.name ?? "";
    const stars = num(until.stars);
    if (who && stars) return `quando ${who} chegar a ${stars}★`;
    if (who) return `quando ${who} chegar`;
  }
  return null;
}

/**
 * Modelo único por vaga, se a análise o trouxer (formato no topo do arquivo), normalizado; null se não houver. Entradas
 * sem `original.id` ou com `kind` desconhecido ficam de fora; `playing` só vale com id.
 */
export function slotModelOf(plan, rec) {
  for (const at of SLOT_PATHS) {
    const list = at(plan, rec);
    if (!Array.isArray(list)) continue;
    const out = [];
    for (const s of list) {
      if (!isObj(s) || !SLOT_KINDS.includes(s.kind)) continue;
      const original = unitRef(s.original);
      if (!original) continue;
      const p = isObj(s.playing) && str(s.playing.id) ? s.playing : null;
      const buy =
        p && isObj(p.buy)
          ? { cost: num(p.buy.cost), slot: num(p.buy.slot) }
          : null;
      out.push({
        slot: num(s.slot),
        // A peça do plano dona da vaga (na troca da comp, a que entrou); sem ela, a original.
        unit: unitRef(s.unit) ?? original,
        // Onde está a original: "campo" | "reserva" | "falta" (ou true/false em versões antigas).
        original: { ...original, have: s.original.have ?? null },
        playing: p
          ? {
              ...unitRef(p),
              source: str(p.source),
              buy,
            }
          : null,
        kind: s.kind,
        why: str(s.why),
        until: untilText(s.until, original),
      });
    }
    return out;
  }
  return null;
}

/** Texto da dica da substituição: o formato pedido ("Varus 2★ no lugar de Aphelios (temporário: volta quando...)"). */
export function subText({ kind, playing, original, until, why }) {
  const s = `${playing.name}${playing.stars > 1 ? ` ${playing.stars}★` : ""}`;
  if (kind === "troca-da-comp")
    return `troca da comp: ${s} no lugar de ${original.name}`;
  const tail = until
    ? until.startsWith("volta")
      ? `temporário: ${until}`
      : `temporário: volta ${until}`
    : "temporário: sem volta prevista";
  // O motivo do servidor (quando não há volta prevista) vem depois, como frase à parte.
  return `${s} no lugar de ${original.name} (${tail})${!until && why ? `. ${why}` : ""}`;
}

/** Texto da dica de compra: "na sua loja (slot 3): compre para a vaga de Aphelios". */
export const buyText = (slot, forName) =>
  `na sua loja${slot != null ? ` (slot ${slot})` : ""}: compre para a vaga de ${forName}`;

/**
 * Substituições pelo que a análise já tem (sem o modelo único): `Map(idDaPeçaDaComp -> sub)`.
 * - trocas aceitas (`swaps`: `[{ out, in }]`): a peça `in` está na comp no lugar de `out` ("troca da comp");
 * - trocas propostas (`plan.transitions`): `exit` segura em campo a vaga de `enter` até ele chegar a `requiredStars`
 *   ("temporário"); sem estrela que alcance, fica "temporário" com o motivo do servidor.
 */
function fallbackSubs(plan, swaps, nameOf, starsInField) {
  const subs = new Map();
  for (const s of Array.isArray(swaps) ? swaps : []) {
    const out = str(s?.out) ?? str(s?.out?.id),
      into = str(s?.in) ?? str(s?.in?.id);
    if (!out || !into) continue;
    subs.set(into, {
      kind: "troca-da-comp",
      playing: { id: into, name: nameOf(into), stars: starsInField(into) },
      original: { id: out, name: nameOf(out), stars: null },
      until: null,
      why: null,
    });
  }
  for (const t of Array.isArray(plan?.transitions) ? plan.transitions : []) {
    const enter = unitRef(t?.enter),
      exit = unitRef(t?.exit);
    if (!enter || !exit || subs.has(enter.id)) continue;
    const need = num(t.requiredStars);
    subs.set(enter.id, {
      kind: "temporario",
      playing: {
        id: exit.id,
        name: exit.name,
        stars: num(t.exitStars) ?? starsInField(exit.id),
      },
      original: { id: enter.id, name: enter.name, stars: num(t.enterStars) },
      until: need ? `quando ${enter.name} chegar a ${need}★` : null,
      why: need ? null : str(t.reason),
    });
  }
  return subs;
}

/** Linhas "Comprar" do modelo cruzadas com a loja (só as que estão na loja agora): `Map(id -> { slot, cost })`. */
function shopHits(model, plan) {
  const hits = new Map();
  const buy = (model?.plan?.steps ?? []).find((s) => s.id === "buy");
  for (const r of buy?.rows ?? []) {
    const id = r?.unit?.id;
    if (!str(id) || !r.shop) continue;
    hits.set(id, {
      slot: num(r.shop.slots?.[0]),
      cost: num(r.unit.cost) ?? null,
    });
  }
  // Comps sugeridas (sem o cruzamento da interface): a marca "na loja" do servidor, sem o slot.
  if (!hits.size)
    for (const b of plan?.stage?.buyNow ?? [])
      if (b?.inShop === true && str(b.id))
        hits.set(b.id, { slot: num(b.slot), cost: num(b.cost) });
  return hits;
}

/** Sinergias ativas da comp (as que o servidor marcou ativas; sem a marca, as de 2 ou mais), a maior contagem primeiro. */
function traitsOf(plan) {
  const list = (Array.isArray(plan?.traits) ? plan.traits : [])
    .filter((t) => str(t?.name) && num(t.count))
    .map((t) => ({
      name: t.name,
      count: t.count,
      active: t.active === true,
      next: num(t.next),
    }));
  const flagged = list.some((t) => t.active);
  return list
    .filter((t) => (flagged ? t.active : t.count >= 2))
    .sort((a, b) => b.count - a.count);
}

/**
 * Uma comp do painel a partir do plano bruto da análise (`plan`: `rec.preview` ou `rec.recommendations[i]`). `ctx`:
 * `{ rec, model, roster, deps, isPlan, swaps, slotModel }`. Devolve o modelo de desenho (ver `compsOf`).
 */
function compOf(plan, ctx) {
  const { rec, roster, deps, isPlan } = ctx;
  const board = Array.isArray(plan?.board) ? plan.board : [];
  const byId = new Map(board.map((u) => [u.id, u]));
  const nameOf = (id) =>
    byId.get(id)?.name ??
    deps?.catalog?.champions?.get?.(id)?.name ??
    String(id ?? "");
  const costOf = (id) =>
    num(byId.get(id)?.cost) ?? num(deps?.catalog?.champions?.get?.(id)?.cost);
  const own = (id) =>
    typeof deps?.ownership === "function" ? deps.ownership(roster, id) : null;
  const starsInField = (id) => num(own(id)?.field?.stars) || null;
  const carry = board.find((u) => u.name === plan.carry) ?? null;
  const targets = new Map(
    (plan.positions ?? []).map((p) => [p.championId, num(p.targetStars)]),
  );
  const shop = isPlan ? shopHits(ctx.model, plan) : shopHits(null, plan);
  const model = isPlan ? ctx.slotModel : null;
  const subs = model
    ? null
    : fallbackSubs(plan, isPlan ? ctx.swaps : [], nameOf, starsInField);

  // Vagas do modelo único, pela peça da comp (original).
  const bySlot = new Map((model ?? []).map((s) => [s.unit.id, s]));
  const units = board
    .map((u) => {
      const o = own(u.id);
      const state = o?.state ?? "unknown";
      const where = state === "both" ? "field" : state;
      const slot = bySlot.get(u.id) ?? null;
      let sub = null,
        buy = null;
      if (slot) {
        // Substituição: quem joga não é a original da vaga (temporário) ou a comp trocou a peça (a original saiu).
        if (
          slot.kind !== "titular" &&
          slot.playing &&
          slot.playing.id !== slot.original.id
        )
          sub = {
            kind: slot.kind,
            playing: { ...slot.playing, cost: costOf(slot.playing.id) },
            original: { ...slot.original, cost: costOf(slot.original.id) },
            until: slot.until,
            why: slot.why,
          };
        if (slot.playing?.source === "loja")
          buy = {
            cost: slot.playing.buy?.cost ?? costOf(slot.playing.id),
            slot: slot.playing.buy?.slot ?? null,
            id: slot.playing.id,
          };
      } else {
        const s = subs?.get(u.id) ?? null;
        if (s)
          sub = {
            ...s,
            playing: { ...s.playing, cost: costOf(s.playing.id) },
            original: { ...s.original, cost: costOf(s.original.id) },
          };
        const hit = shop.get(u.id);
        if (hit)
          buy = { cost: hit.cost ?? costOf(u.id), slot: hit.slot, id: u.id };
      }
      // Na troca da comp, a peça da lista JÁ é a substituta; a vaga é da original.
      const slotName =
        sub?.kind === "troca-da-comp" ? sub.original.name : u.name;
      const label = WHERE[where] ?? WHERE.unknown;
      // A marca da casa é de quem a ocupa: a substituta temporária está em campo (ou na reserva, se o modelo disser).
      const shown =
        sub?.kind === "temporario"
          ? sub.playing.source === "reserva"
            ? "reserve"
            : sub.playing.source === "loja"
              ? where
              : "field"
          : where;
      const tips = [
        `${u.name}: ${o?.text || label.text}`,
        targets.get(u.id) ? `alvo ${targets.get(u.id)}★` : null,
        sub ? subText(sub) : null,
        buy ? buyText(buy.slot, slotName) : null,
      ].filter(Boolean);
      return {
        id: u.id,
        name: u.name,
        cost: num(u.cost) ?? costOf(u.id) ?? 1,
        carry: carry?.id === u.id,
        stars: num(o?.stars) ?? 0,
        target: targets.get(u.id) ?? null,
        where,
        whereText: label.text,
        // Onde está quem ocupa a casa (a marca desenhada): a própria peça ou a substituta temporária.
        shown,
        sub,
        buy,
        items: Array.isArray(u.items) ? u.items.filter(str) : [],
        title: tips.join(" · "),
      };
    })
    .sort(
      (a, b) =>
        Number(b.carry) - Number(a.carry) ||
        b.cost - a.cost ||
        a.name.localeCompare(b.name),
    );

  // Builds de "Builds e 3★": a mesma função da aba Comps, sobre a comp de meta que a análise trouxe com o plano.
  const meta = isObj(plan.meta) ? plan.meta : null;
  let builds = [];
  if (meta && typeof deps?.compBuildRows === "function")
    try {
      const rows = deps.compBuildRows({
        units: board.map((u) => u.id),
        carry: carry?.id ?? null,
        builds: meta.builds ?? {},
        buildStats: meta.buildStats ?? {},
      });
      builds = (Array.isArray(rows) ? rows : []).map((r) => {
        const unit = units.find((u) => u.id === r.championId);
        const held = new Set(unit?.items ?? []);
        return {
          id: r.championId,
          name: nameOf(r.championId),
          cost: costOf(r.championId) ?? 1,
          carry: unit?.carry === true,
          items: (r.items ?? []).map((i) => ({
            id: i,
            name: deps?.catalog?.items?.get?.(i)?.name ?? String(i),
            on: held.has(i),
          })),
          delta: num(r.delta),
          n: num(r.n),
        };
      });
    } catch {
      builds = [];
    }
  const stars3 = (Array.isArray(meta?.stars3) ? meta.stars3 : [])
    .filter(str)
    .map((id) => ({ id, name: nameOf(id) }));

  const ranked = (Array.isArray(rec?.compRanking) ? rec.compRanking : []).find(
    (r) => meta?.id != null && r?.id === meta.id,
  );
  const owned =
    typeof deps?.compOwnership === "function"
      ? deps.compOwnership(
          roster,
          board.map((u) => u.id),
        )
      : null;
  // Peças em campo que não são da comp e não seguram vaga de ninguém (temporárias soltas do `stage`).
  const holding = new Set(
    units.filter((u) => u.sub).map((u) => u.sub.playing.id),
  );
  const loose = isPlan
    ? (plan.stage?.board ?? [])
        .filter(
          (u) =>
            u?.status === "temporario" &&
            str(u.id) &&
            !byId.has(u.id) &&
            !holding.has(u.id),
        )
        .map((u) => ({
          id: u.id,
          name: str(u.name) ?? nameOf(u.id),
          cost: num(u.cost) ?? costOf(u.id) ?? 1,
          stars: num(u.stars) ?? 0,
        }))
    : [];
  return {
    key: meta?.id != null ? `meta:${meta.id}` : `title:${plan.title ?? ""}`,
    title: str(plan.title) ?? "comp",
    carry: carry ? { id: carry.id, name: carry.name } : null,
    score: num(ranked?.score) ?? num(plan.compScore?.score),
    // Vitória esperada em % (a medida que ordena as comps; o score é ela numa régua), como na interface.
    win: num(ranked?.win) ?? num(plan.compScore?.win),
    best: ranked?.best === true,
    owned: owned
      ? {
          field: owned.field,
          reserve: owned.reserve,
          size: owned.size,
          known: owned.benchKnown,
          text: owned.text,
        }
      : null,
    units,
    loose,
    builds,
    stars3,
    traits: traitsOf(plan),
    // De onde veio a informação de substituição: o modelo único por vaga ou o que já existia (trocas e compra).
    subsFrom: model ? "slots" : "fallback",
  };
}

/**
 * Comps do painel, na ordem dos atalhos: a do plano primeiro (`rec.preview`, a fixada, ou `rec.recommendations[0]`) e
 * depois as sugeridas da mesma análise que não são ela. Cada uma: `{ key, label, plan, title, carry, score, best, owned,
 * units, loose, builds, stars3, traits, subsFrom }`; `units[]`: `{ id, name, cost, carry, stars, target, where,
 * whereText, sub, buy, items, title }` (`where`: "field" | "reserve" | "absent" | "unknown"; `sub`: `{ kind, playing,
 * original, until, why }` ou null; `buy`: `{ cost, slot, id }` ou null). `input`: `{ model, rec, deps }` (`deps`:
 * `ownership`, `compOwnership`, `compBuildRows`, `catalog`). Sem análise devolve []. Nunca lança.
 */
export function compsOf({ model, rec, deps } = {}) {
  try {
    if (!isObj(rec)) return [];
    const recs = Array.isArray(rec.recommendations) ? rec.recommendations : [];
    const plan = rec.preview ?? recs[0] ?? null;
    if (!isObj(plan)) return [];
    const roster = model?.roster ?? null;
    const swaps = model?.status?.swaps ?? [];
    const slotModel = slotModelOf(plan, rec);
    const keyOf = (p) =>
      p?.meta?.id != null ? `meta:${p.meta.id}` : `title:${p?.title ?? ""}`;
    const planKey = keyOf(plan);
    const out = [
      {
        ...compOf(plan, {
          rec,
          model,
          roster,
          deps,
          isPlan: true,
          swaps,
          slotModel,
        }),
        plan: true,
        label: model?.status?.pinned ? "Plano (fixada)" : "Plano",
      },
    ];
    const seen = new Set([planKey]);
    let n = 0;
    for (const p of recs) {
      if (!isObj(p) || seen.has(keyOf(p))) continue;
      seen.add(keyOf(p));
      n += 1;
      out.push({
        ...compOf(p, { rec, model, roster, deps, isPlan: false }),
        plan: false,
        label: `Sugerida ${n}`,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Próximo estado do painel para uma ação do atalho. `state`: `{ open, index, key }`; `comps`: lista de `compsOf`.
 * "toggle" abre/fecha; "show" abre; "prev"/"next" abrem (se fechado, sem andar) e andam em círculo. A comp exibida é
 * lembrada pela chave, para continuar a mesma quando a lista muda entre análises.
 */
export function compPanelStep(state, action, comps = []) {
  const len = Array.isArray(comps) ? comps.length : 0;
  const cur = resolveIndex(state, comps);
  const at = (i) => ({
    open: true,
    index: i,
    key: comps[i]?.key ?? null,
  });
  if (action === "toggle")
    return state?.open
      ? { open: false, index: cur, key: state.key ?? null }
      : at(cur);
  if (action === "show") return at(cur);
  if (action === "prev" || action === "next") {
    if (!state?.open || len === 0) return at(cur);
    const step = action === "next" ? 1 : -1;
    return at((cur + step + len) % len);
  }
  return { open: !!state?.open, index: cur, key: state?.key ?? null };
}

/** Índice da comp exibida: a mesma chave se ainda existe; senão o índice limitado à lista (0 sem lista). */
export function resolveIndex(state, comps = []) {
  const len = Array.isArray(comps) ? comps.length : 0;
  if (!len) return 0;
  if (state?.key) {
    const i = comps.findIndex((c) => c.key === state.key);
    if (i >= 0) return i;
  }
  const i = Number.isInteger(state?.index) ? state.index : 0;
  return Math.max(0, Math.min(len - 1, i));
}

const signed = (v) =>
  `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2).replace(".", ",")}`;

/**
 * HTML do painel. `panel`: `{ open, comp, index, total, keys, status }` (`keys`: `{ toggle, prev, next }` com a tecla
 * final de cada atalho, da lista registrada; `status`: o de `overlayView`, para o aviso quando não há comp). `ui`: `{ esc,
 * glyph, portrait, itemPortrait, richText, stars, traitIcon }`. Fechado devolve "" (o elemento some). Nomes de campeão e
 * de item nunca aparecem só em texto: retratos com o nome no `title` e para o leitor de tela.
 */
export function compPanelHtml(panel, ui) {
  if (!panel?.open) return "";
  const { esc, glyph, portrait, itemPortrait, richText, stars } = ui;
  const keys = panel.keys ?? {};
  const nav = [
    keys.prev ? `<kbd>${esc(keys.prev)}</kbd>◂` : "",
    keys.next ? `▸<kbd>${esc(keys.next)}</kbd>` : "",
    keys.toggle ? `<kbd>${esc(keys.toggle)}</kbd> fecha` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const c = panel.comp;
  if (!c) {
    const why =
      panel.status === "ended"
        ? "partida encerrada: sem comp"
        : panel.status === "waiting"
          ? "nova partida: aguardando o primeiro tabuleiro"
          : "sem comp: aguardando análise";
    return `<header class="cp-head"><span class="eyebrow">Comp</span></header><p class="detail">${esc(why)}</p>${nav ? `<p class="cp-nav">${nav}</p>` : ""}`;
  }
  const ring = (cost) =>
    `--ring-c:var(--cost-${Math.min(5, Math.max(1, cost ?? 1))})`;
  const unit = (u) => {
    const main = u.sub ? u.sub.playing : u;
    const mark = WHERE[u.shown ?? u.where]?.mark ?? "clock";
    const orig = u.sub
      ? `<span class="cp-orig" style="${ring(u.sub.original.cost)}">${portrait(u.sub.original.id, u.sub.original.name, { size: 16, hidden: true })}</span><i class="cp-swap" aria-hidden="true">⇄</i>`
      : "";
    const buy = u.buy
      ? `<b class="cp-buy" aria-hidden="true">${glyph("coin")}${u.buy.cost != null ? esc(u.buy.cost) : ""}</b>`
      : "";
    const shownStars = u.sub ? (u.sub.playing.stars ?? 0) : u.stars;
    return `<li class="cp-u" data-where="${esc(u.shown ?? u.where)}" data-carry="${u.carry ? 1 : 0}"${u.sub ? ` data-sub="${esc(u.sub.kind)}"` : ""}${u.buy ? ' data-shop="1"' : ""} title="${esc(u.title)}"><span class="cp-pt" style="${ring(main.cost ?? u.cost)}">${portrait(main.id, main.name, { size: 34, hidden: true })}</span>${orig}${buy}${u.carry ? '<i class="cp-crown" aria-hidden="true">♛</i>' : ""}<i class="cp-st" aria-hidden="true">${shownStars ? stars(shownStars) : ""}</i><i class="cp-mark" aria-hidden="true">${glyph(mark)}</i><b class="sr">${esc(u.title)}</b></li>`;
  };
  const owned = c.owned
    ? `<span title="${esc(c.owned.text)}"><b>${esc(c.owned.field)}/${esc(c.owned.size)}</b> em campo${c.owned.reserve ? ` · +${esc(c.owned.reserve)} na reserva` : ""}${c.owned.known ? "" : " · reserva não lida"}</span>`
    : "";
  const facts = [
    c.score != null
      ? `<span>${c.win != null ? `<b>${esc(String(Math.round(c.win * 10) / 10).replace(".", ","))}%</b> de vitória · ` : ""}score <b>${esc(Math.round(c.score))}</b>${c.best ? " · melhor comp" : ""}</span>`
      : "",
    owned,
  ]
    .filter(Boolean)
    .join(" · ");
  const subsCount = c.units.filter((u) => u.sub).length,
    shopCount = c.units.filter((u) => u.buy).length;
  const legend = [
    `${glyph("check")} em campo`,
    `${glyph("bank")} reserva`,
    `${glyph("plus")} falta`,
    subsCount ? "⇄ no lugar de" : "",
    shopCount ? `${glyph("coin")} na loja` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const loose = c.loose.length
    ? `<p class="detail cp-loose" title="Peças em campo fora da comp, sem vaga da comp para segurar">fora da comp em campo: ${c.loose.map((u) => `<span class="cp-lp" style="${ring(u.cost)}" title="${esc(u.name)}">${portrait(u.id, u.name, { size: 20, hidden: true })}<b class="sr">${esc(u.name)}</b></span>`).join("")}</p>`
    : "";
  const builds = c.builds.length
    ? `<h3 class="eyebrow">Builds e 3★</h3><ul class="cp-builds" aria-label="Builds publicadas da comp">${c.builds
        .map(
          (b) =>
            `<li data-carry="${b.carry ? 1 : 0}" title="${esc(`${b.name}${b.delta != null ? ` · ${signed(b.delta)} na colocação` : ""}${b.n != null ? ` · ${b.n} partidas` : ""}`)}"><span class="cp-bp" style="${ring(b.cost)}">${portrait(b.id, b.name, { size: 24, hidden: true })}</span><b class="sr">${esc(b.name)}</b><span class="cp-bi">${b.items.map((i) => `<span class="cp-item" data-on="${i.on ? 1 : 0}" title="${esc(i.name)}${i.on ? " · equipado" : ""}">${itemPortrait({ id: i.id, name: i.name }, { size: 22 })}</span>`).join("")}</span></li>`,
        )
        .join("")}</ul>`
    : "";
  const stars3 = c.stars3.length
    ? `<p class="cp-3star"><b>3★</b>${c.stars3.map((u) => `<span title="${esc(u.name)}">${portrait(u.id, u.name, { size: 20, hidden: true })}<b class="sr">${esc(u.name)}</b></span>`).join("")}</p>`
    : "";
  const icon = (name) => {
    const src = typeof ui.traitIcon === "function" ? ui.traitIcon(name) : null;
    return src
      ? `<em class="trait-icon" style="--icon:url('${esc(src)}')" aria-hidden="true"></em>`
      : "";
  };
  const traits = c.traits.length
    ? `<h3 class="eyebrow">Sinergias</h3><ul class="cp-traits" aria-label="Sinergias ativas">${c.traits.map((t) => `<li class="chip">${icon(t.name)}${esc(t.name)} <b>${esc(t.count)}</b></li>`).join("")}</ul>`
    : "";
  return `<header class="cp-head"><span class="eyebrow">${esc(c.label)}</span><b class="title">${richText(c.title, { size: 18 })}</b>${panel.total > 1 ? `<span class="chip" title="Comp exibida: o plano e as sugeridas (alternar não fixa nada)">${esc(panel.index + 1)}/${esc(panel.total)}</span>` : ""}</header>${facts ? `<p class="detail cp-facts">${facts}</p>` : ""}<ul class="cp-units" aria-label="Peças da comp">${c.units.map(unit).join("")}</ul><p class="cp-legend" aria-hidden="true">${legend}</p>${loose}${builds}${stars3}${traits}${nav ? `<p class="cp-nav">${nav}</p>` : ""}`;
}
