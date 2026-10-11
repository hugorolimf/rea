/**
 * Cruzamento "peças que o plano quer" x "loja de agora": função pura (sem DOM) compartilhada pela lista Comprar
 * (steps.js, via model.js) e pelo painel Roll ("Na loja"). Quem desenha só lê o resultado; as regras ficam aqui.
 *
 * Fonte da loja (`seen.sources.shop`, preenchida pelo servidor): só o GEP a entrega.
 *   - "gep" : evento do jogo (`store.shop_pieces`) do TFTAcademy, observado e fresco -> confiança "confiavel"; com a
 *     fonte GEP fora do estado "ativo" (`gepStatus`), a mesma loja vale só como "provavel";
 *   - sem fonte (`sources.shop` diferente de "gep", `seen.shop` ausente, loja escondida) -> `known: false`: nenhum
 *     aviso, nem de "na loja" nem de "fora da loja".
 * Wisps (fogos-fátuos) chegam com `id: null` (e `wisp: true`) e nunca são campeões: ficam de fora do cruzamento.
 */

/** Espaços da loja. */
export const SHOP_SLOTS = 5;

const CONFIDENCE_TEXT = {
  confiavel:
    "Loja lida do GEP (evento do jogo, observada): confiável, pode comprar.",
  provavel:
    "Provável: loja do GEP com a fonte parada, pode estar atrasada; confira no jogo antes de comprar.",
};

const wantOf = (n) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 1;
};

/**
 * Loja de agora a partir de `state.seen`: `{ known, source, confidence, slots: [{ slot, id }], unreadable }`.
 * `slot` vai de 1 a 5; `unreadable` conta cartas com texto mas sem campeão reconhecido (não Wisp). `gepStatus`
 * (`state.gepStatus`) rebaixa um GEP que não está "ativo" para "provável". Sem a loja do GEP, `known: false`.
 */
export function shopView(seen, { gepStatus = null } = {}) {
  const none = {
    known: false,
    source: null,
    confidence: null,
    slots: [],
    unreadable: 0,
  };
  const raw = seen?.shop;
  // Só o GEP entrega a loja: sem ela (outra origem ou nenhuma), a loja é desconhecida, nunca vazia.
  if (!Array.isArray(raw) || seen.sources?.shop !== "gep") return none;
  const wispSlots = new Set(
    (Array.isArray(seen.wisps) ? seen.wisps : [])
      .map((w) => w?.slot)
      .filter(Number.isInteger),
  );
  const slots = [];
  let unreadable = 0;
  raw.slice(0, SHOP_SLOTS).forEach((card, i) => {
    if (!card || typeof card !== "object") return;
    if (card.wisp || wispSlots.has(i + 1)) return;
    if (card.id) slots.push({ slot: i + 1, id: card.id });
    else if (card.text) unreadable++;
  });
  // No GEP, tudo "Sold" (nenhuma carta) é loja vazia conhecida.
  const gepFresh = gepStatus?.state == null || gepStatus.state === "ativo";
  return {
    known: true,
    source: "gep",
    confidence: gepFresh ? "confiavel" : "provavel",
    slots,
    unreadable,
  };
}

/** Espaços (1 a 5) em que o campeão `id` está na loja. */
export const slotsOf = (view, id) =>
  (view?.slots ?? []).filter((s) => s.id === id).map((s) => s.slot);

/**
 * Uma peça desejada na loja: `wanted = { id, name?, want? }` (`want` = cópias que o plano quer, 1 se omitido).
 * Devolve `null` se a loja é desconhecida ou a peça não está nela; senão `{ id, name, slots, copies, want, enough, buy,
 * confidence }` com `enough` = a loja tem tantas cópias quanto o plano quer e `buy` = quantas comprar agora.
 */
export function matchWanted(wanted, view) {
  if (!view?.known || !wanted?.id) return null;
  const slots = slotsOf(view, wanted.id);
  if (!slots.length) return null;
  const want = wantOf(wanted.want),
    copies = slots.length;
  return {
    id: wanted.id,
    name: wanted.name ?? "",
    slots,
    copies,
    want,
    enough: want <= copies,
    buy: Math.min(want, copies),
    confidence: view.confidence,
  };
}

/**
 * Textos de um cruzamento para a interface: `badge` (selo; com "?" quando só provável), `buyText` ("comprar 1",
 * "1 de 2" ou "sem ouro"), `slotText` ("slot 3" / "slots 1, 4"), `mark` (resumo curto "comprar 1 · #3") e `title`.
 */
export function describeMatch(m, { broke = false } = {}) {
  const probable = m.confidence !== "confiavel",
    slotText =
      m.copies === 1 ? `slot ${m.slots[0]}` : `slots ${m.slots.join(", ")}`,
    copiesText = m.copies === 1 ? "1 cópia" : `${m.copies} cópias`,
    buyText = broke
      ? "sem ouro"
      : m.enough
        ? `comprar ${m.buy}`
        : `${m.copies} de ${m.want}`;
  const lines = [
    `${m.name || "Peça do plano"} está na loja agora: ${copiesText} (${slotText}).`,
    broke
      ? "Ouro insuficiente agora."
      : m.enough
        ? `O plano quer ${m.want}: compre ${m.buy}.`
        : `O plano quer ${m.want} cópias e a loja tem ${m.copies}: compre ${m.copies} e continue procurando.`,
    CONFIDENCE_TEXT[m.confidence] ?? CONFIDENCE_TEXT.provavel,
  ];
  return {
    id: m.id,
    slots: m.slots,
    copies: m.copies,
    want: m.want,
    enough: m.enough,
    buy: m.buy,
    broke,
    confidence: m.confidence,
    probable,
    badge: probable ? "NA LOJA?" : "NA LOJA",
    buyText,
    slotText,
    mark: `${buyText} · ${m.copies === 1 ? `#${m.slots[0]}` : `×${m.copies}`}`,
    title: lines.join("\n"),
  };
}

/**
 * Nota do cabeçalho da lista: `null` quando a loja não foi lida (sem aviso nenhum); "N na loja agora" quando há peças
 * do plano nela; "nenhuma peça do plano na loja agora" quando não há (com "reconhecida" se algum espaço não foi
 * identificado, para não afirmar o que a leitura não sabe).
 */
export function shopStatus(view, hits) {
  if (!view?.known) return null;
  const probable = view.confidence !== "confiavel",
    how = CONFIDENCE_TEXT[view.confidence] ?? CONFIDENCE_TEXT.provavel;
  if (hits > 0)
    return {
      state: "hit",
      text: `${hits} na loja agora${probable ? "?" : ""}`,
      title: how,
    };
  const unsure = view.unreadable > 0;
  return {
    state: "none",
    text: unsure
      ? "nenhuma peça do plano reconhecida na loja agora"
      : "nenhuma peça do plano na loja agora",
    title: unsure
      ? `${view.unreadable} espaço(s) da loja não foram reconhecidos. ${how}`
      : how,
  };
}

/**
 * Cruza as linhas de uma lista de compra com a loja. `pick(row)` devolve `{ id, name, want }` (padrão: `row.unit` e
 * `row.want`; `row.broke` marca falta de ouro). Cada linha ganha `shop` (`describeMatch` ou `null`); as que estão na loja
 * sobem para o topo, mantendo a ordem relativa dentro de cada grupo (ordenação estável, sem trocar a ordem do servidor).
 * Devolve `{ rows, hits, status }`.
 */
export function crossShop(
  rows,
  view,
  pick = (r) => ({ id: r.unit?.id, name: r.unit?.name, want: r.want }),
) {
  const tagged = (rows ?? []).map((r) => {
    const m = matchWanted(pick(r), view);
    return {
      ...r,
      shop: m ? describeMatch(m, { broke: r.broke === true }) : null,
    };
  });
  const inShop = tagged.filter((r) => r.shop);
  return {
    rows: [...inShop, ...tagged.filter((r) => !r.shop)],
    hits: inShop.length,
    status: shopStatus(view, inShop.length),
  };
}

/**
 * Painel Roll "Na loja": acerta as peças que o servidor listou (`{ id, name, slots, buy, gold, action, closes }`) com a
 * loja que a interface lê agora. Com a loja conhecida, os espaços vêm dela, a peça que não está mais nela sai da lista e
 * cada uma ganha `confidence`, `probable` e `confidenceTitle`; sem leitura da loja a lista do servidor passa como está.
 */
export function refineShopHits(hits, view) {
  const list = hits ?? [];
  if (!view?.known) return list;
  return list.flatMap((h) => {
    const slots = slotsOf(view, h.id);
    if (!slots.length) return [];
    return [
      {
        ...h,
        slots,
        confidence: view.confidence,
        probable: view.confidence !== "confiavel",
        confidenceTitle:
          CONFIDENCE_TEXT[view.confidence] ?? CONFIDENCE_TEXT.provavel,
      },
    ];
  });
}
