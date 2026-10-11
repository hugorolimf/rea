import { starCopies } from "../../core/pool/copies.mjs";

/**
 * Onde estão as suas peças: em campo, na reserva ou em lugar nenhum. Regra única de "peça sua" para toda tela que marca
 * isso (cartões da aba Comps, modal de sugestões, anel "N/M" do HUD, Formação, Plano e lista Comprar).
 *
 * Fontes (as duas já chegam ao cliente; nada aqui pede ao servidor):
 * - campo: `rec.self.units` (tabuleiro do arquivo do jogo, `{ championName, starLevel }`);
 * - reserva: `state.seen.gepBench` (GEP, `{ id, stars }`), válida só com `seen.sources.bench === "gep"`. Sem GEP
 *   fresco a reserva é DESCONHECIDA, não vazia: uma peça fora de campo fica "reserva desconhecida", nunca "ausente".
 *
 * `rosterOf` devolve dados simples (serializáveis, entram nas chaves de redesenho); `ownership(roster, id)` diz onde está
 * cada campeão, com as cópias (em equivalentes de 1★) dos dois lugares somadas para o progresso de estrela.
 */
const starOf = (s) => {
  const n = Math.floor(Number(s));
  return n >= 1 && n <= 4 ? n : 1; // estrela não lida conta como 1★ (a peça existe)
};

/**
 * `units`: `rec.self.units` (campo); `seen`: `state.seen` (reserva do GEP). Devolve
 * `{ benchKnown, field: {id: [estrelas...]}, reserve: {id: [estrelas...]} }`.
 */
export function rosterOf({ units = [], seen = null } = {}) {
  const field = {},
    reserve = {};
  for (const u of Array.isArray(units) ? units : []) {
    const id = u?.championName;
    if (typeof id === "string" && id)
      (field[id] ??= []).push(starOf(u.starLevel));
  }
  const benchKnown =
    seen?.sources?.bench === "gep" && Array.isArray(seen?.gepBench);
  if (benchKnown)
    for (const u of seen.gepBench) {
      const id = u?.id;
      if (typeof id === "string" && id)
        (reserve[id] ??= []).push(starOf(u.stars));
    }
  return { benchKnown, field, reserve };
}

const copiesOf = (stars) => stars.reduce((n, s) => n + starCopies(s), 0);
const plural = (n) => (n === 1 ? "1 cópia" : `${n} cópias`);

/**
 * Onde está o campeão `id`:
 * - `state`: "field" (só em campo), "reserve" (só na reserva), "both", "absent" (reserva lida e ele não está em lugar
 *   nenhum) ou "unknown" (fora de campo e reserva não lida; também sem `roster`);
 * - `field`/`reserve`: `{ pieces, stars }` de cada lugar; `copies`: cópias de 1★ somadas dos dois lugares;
 * - `next`: `{ stars, have, need }` da próxima estrela (null em 3★ ou sem peça);
 * - `label`: "em campo", "na reserva", "2 cópias: 1 em campo, 1 na reserva", "reserva desconhecida" ou "" (ausente);
 * - `text`: o rótulo com a estrela e o progresso ("na reserva · 2★"; "2 cópias: ... · 2/3 para 2★"), para dicas.
 */
export function ownership(roster, id) {
  const f = roster?.field?.[id] ?? [],
    r = roster?.reserve?.[id] ?? [],
    benchKnown = roster?.benchKnown === true,
    copies = copiesOf(f) + copiesOf(r),
    stars = Math.max(0, ...f, ...r),
    state =
      f.length && r.length
        ? "both"
        : f.length
          ? "field"
          : r.length
            ? "reserve"
            : roster && benchKnown
              ? "absent"
              : "unknown";
  const label =
    state === "both"
      ? `${plural(f.length + r.length)}: ${f.length} em campo, ${r.length} na reserva`
      : state === "field"
        ? f.length > 1
          ? `${plural(f.length)} em campo`
          : "em campo"
        : state === "reserve"
          ? r.length > 1
            ? `${plural(r.length)} na reserva`
            : "na reserva"
          : state === "unknown" && roster
            ? "reserva desconhecida"
            : "";
  const nextStars = stars >= 1 && stars < 3 ? stars + 1 : null,
    next = nextStars
      ? { stars: nextStars, have: copies, need: starCopies(nextStars) }
      : null,
    text = [
      label,
      stars > 1 ? `${stars}★` : "",
      next && f.length + r.length > 1
        ? `${next.have}/${next.need} para ${next.stars}★`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  return {
    id,
    state,
    benchKnown,
    mine: state === "field" || state === "reserve" || state === "both",
    field: { pieces: f.length, stars: Math.max(0, ...f) },
    reserve: { pieces: r.length, stars: Math.max(0, ...r) },
    pieces: f.length + r.length,
    copies,
    stars,
    next,
    label,
    text,
  };
}

/**
 * Peças de uma comp (`ids`) que você tem: `field` = em campo (com ou sem cópia na reserva), `reserve` = só na reserva,
 * `size` = peças distintas da comp. `text`: "4/9 em campo · +1 na reserva" ("· reserva não lida" sem GEP).
 */
export function compOwnership(roster, ids = []) {
  const list = [...new Set((ids ?? []).filter(Boolean))];
  let field = 0,
    reserve = 0;
  for (const id of list) {
    const s = ownership(roster, id).state;
    if (s === "field" || s === "both") field++;
    else if (s === "reserve") reserve++;
  }
  const benchKnown = roster?.benchKnown === true;
  return {
    field,
    reserve,
    size: list.length,
    benchKnown,
    text: `${field}/${list.length} em campo${reserve ? ` · +${reserve} na reserva` : ""}${roster && !benchKnown ? " · reserva não lida" : ""}`,
  };
}
