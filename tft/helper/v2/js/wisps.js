import {
  createWispBook,
  decideWisp,
  wispLabel,
  wispsInState,
} from "../../core/catalog/wisps.mjs";

/**
 * Wisps (fogos-fátuos) da loja para o painel: função pura (sem DOM) que lê os Wisps do GEP no estado do servidor
 * (`wisps`; sem eles, nenhum), resolvidos pelo catálogo `catalog.wisps` de /api/catalog, e devolve, por Wisp, o que o
 * painel desenha: marca (imagem), nome, tipo e a recomendação de compra de `core/catalog/wisps.mjs`.
 * O Wisp nunca é campeão: as cartas dele têm `id` nulo na loja, então o motor e a rolagem nem o veem.
 */

const books = new WeakMap();
/** Índice do catálogo de Wisps (guardado por lista: o catálogo só muda quando a interface recarrega). */
export function wispBook(catalog) {
  const list = catalog?.wisps;
  if (!Array.isArray(list) || !list.length) return null;
  if (!books.has(list)) books.set(list, createWispBook(list));
  return books.get(list);
}

const VERDICT_TEXT = {
  comprar: "comprar",
  avaliar: "avaliar",
  pular: "pular",
  incerto: "incerto",
};
const TYPE_TEXT = {
  comum: "comum",
  condicional: "condicional",
  combate: "de combate",
  custo0: "custo 0",
};
const CATEGORY_TEXT = {
  campeao: "campeão",
  combate: "combate",
  loja: "loja",
  "ouro-xp": "ouro/XP",
  item: "item",
  arriscada: "arriscada",
  outra: "outra",
};

/** Faixa de vida que a análise do servidor usou (economia do plano), ou null. */
const serverPressureBand = (rec) =>
  (rec?.preview ?? rec?.recommendations?.[0])?.strategy?.panels?.economy
    ?.pressure ?? null;

/**
 * Tooltip do Wisp: nome, tipo/categoria (a categoria é dedução da descrição), efeito, condição, preço e a recomendação
 * com o que ficou incerto.
 */
export function wispTitle(wisp, verdict) {
  const lines = [
    `${wispLabel(wisp)}${wisp.melhorado ? " (melhorado)" : ""}`,
    wisp.desconhecido
      ? "Fora do catálogo de Wisps"
      : `${TYPE_TEXT[wisp.tipo] ?? "?"}${wisp.categoria ? ` · ${CATEGORY_TEXT[wisp.categoria] ?? wisp.categoria} (deduzida da descrição)` : " · categoria não classificada"}`,
  ];
  if (wisp.desc) lines.push(wisp.desc);
  if (wisp.condicional)
    lines.push(`Condição (${wisp.condicaoTipo}): ${wisp.condicao}`);
  if (wisp.custo?.ouro != null)
    lines.push(
      `Preço: ${wisp.custo.ouro}g${wisp.custo.janela ? ` (${wisp.custo.janela})` : ""}`,
    );
  else if (wisp.custoNota) lines.push(`Preço: ${wisp.custoNota} (ambíguo)`);
  else lines.push("Preço: o tooltip do jogo manda");
  if (verdict) {
    lines.push(`${VERDICT_TEXT[verdict.veredito]}: ${verdict.motivo}`);
    if (verdict.incertezas.length)
      lines.push(`Incerto: ${verdict.incertezas.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Wisps da loja agora, prontos para desenhar: `[{ slot, id, name, image, tipo, categoria, desconhecido, veredito,
 * vereditoTexto, motivo, incertezas, title }]`. Contexto: `hero` ({hp, gold, stage} do modelo), `rec` (análise, só para a
 * faixa de vida), `roll` (painel Roll do modelo: `go` = o plano manda rolar agora, lido como rolldown comprometido; sem
 * painel, desconhecido) e `boardFit` (opcional). Sem catálogo ou sem Wisp na loja devolve `[]`.
 */
export function wispsView(
  screen,
  { catalog, hero, rec = null, roll, boardFit = null } = {},
) {
  const book = wispBook(catalog);
  if (!screen || !book) return [];
  const ctx = {
    hp: hero?.hp ?? null,
    gold: hero?.gold ?? null,
    stage: hero?.stage ?? null,
    pressure: serverPressureBand(rec),
    rolldown: roll == null ? null : roll.go === true,
    boardFit,
  };
  return wispsInState(screen, book).map(({ slot, wisp }) => {
    const verdict = decideWisp(wisp, ctx);
    return {
      slot,
      id: wisp.id,
      name: wispLabel(wisp),
      image: wisp.image ?? null,
      tipo: wisp.tipo ?? null,
      categoria: wisp.categoria ?? null,
      desconhecido: wisp.desconhecido === true,
      veredito: verdict.veredito,
      vereditoTexto: VERDICT_TEXT[verdict.veredito],
      motivo: verdict.motivo,
      incertezas: verdict.incertezas,
      title: wispTitle(wisp, verdict),
    };
  });
}
