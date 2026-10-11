// O carrossel no corpo de GET /api/state: se estamos nele (core/state/carousel.mjs), o que ele oferece (leitura do GEP) e o
// que pegar. Sem leitura da oferta, a lista é de PRIORIDADE ("se aparecer"), nunca apresentada como leitura. Roda a cada
// estado lido (a interface e o laço automático), então só calcula algo enquanto o carrossel está aberto e é barato: as
// contas usam as builds da última análise (`rec`) e o banco de agora, sem pedir análise nenhuma. ESM puro.
import { carouselPicks, rankCarouselOffer } from "../carousel.mjs";
import { currentOffer, detectCarousel } from "../core/state/carousel.mjs";
import { coveredKeys } from "../core/items/moves.mjs";

/** O plano exibido da análise: a comp fixada, senão a primeira sugestão (a mesma escolha da interface). */
const planOf = (rec) => rec?.preview ?? rec?.recommendations?.[0] ?? null;

/** A análise é desta partida? (sem os dois ids não há como saber: vale) */
const sameGame = (rec, gameId) =>
  gameId == null ||
  rec?.metadata?.gameId == null ||
  String(rec.metadata.gameId) === String(gameId);

/**
 * Bloco `carousel` do estado. `seen` = o estado visto (`seen` do /api/state): `stage`, `phaseKind`, `gepRound`,
 * `carouselOffer`, `items`. `rec` = último corpo de /api/recommend (ou null, ou uma função que o entrega), `gameId` = partida atual. Opções:
 * `emblemTrait(itemId)` e `nameOf(id)` (catálogo do servidor).
 *
 * Devolve `{ active, stage, round, source, confidence, signals, conflict, from, picks, offer, plan, note }`:
 *  - `active` | `source` | `confidence` | `signals` | `conflict`: a detecção (`detectCarousel`);
 *  - `from`: `"reading"` (peças lidas do carrossel, em ordem de valor), `"priority"` (lista "se aparecer") ou null;
 *  - `picks`: [{rank, slot, championId, championName, itemId, itemName, kind, score, reason, completesNow, forChampion,
 *    forChampionId, target}] (`target` = {id, name} do item que o componente fecha ou começa);
 *    na lista de prioridade `slot`/`championId` são null e vem `owned`; sem plano, a leitura sai sem nota (`score` null);
 *  - `offer`: `{stage, count, unknown, ageMs}` da leitura usada, ou null;
 *  - `plan`: `{carry}` do plano que serviu de base, ou null; `note`: por que não há recomendação (ou null).
 * Fora do carrossel (ou sem saber) `picks` é vazio: nada é calculado.
 */
export function carouselView(
  seen,
  {
    rec = null,
    gameId = null,
    emblemTrait = () => null,
    nameOf = () => null,
  } = {},
) {
  const found = detectCarousel({
      stage: seen?.stage ?? null,
      phaseKind: seen?.phaseKind ?? null,
      gepRound: seen?.gepRound ?? null,
    }),
    base = {
      ...found,
      from: null,
      picks: [],
      offer: null,
      plan: null,
      note: null,
    };
  if (found.active !== true) return base;
  // `rec` pode ser a análise ou uma função que a entrega: só se abre (pode ser ~1 MB em bytes) com o carrossel aberto.
  const analysis = typeof rec === "function" ? rec() : rec;
  const offer = currentOffer(seen?.carouselOffer, {
      stage: seen?.stage ?? null,
      gepRound: seen?.gepRound ?? null,
    }),
    plan = sameGame(analysis, gameId) ? planOf(analysis) : null,
    inventory = Array.isArray(seen?.items) ? seen.items : [];
  const offerInfo = offer && {
    stage: offer.stage ?? null,
    count: offer.slots.length,
    unknown: offer.unknown ?? 0,
    ageMs: offer.ageMs ?? null,
  };
  if (!plan?.itemPlans?.length) {
    // Sem builds para valorar: a leitura (se houver) sai na ordem do carrossel, sem nota, e a lista de prioridade não existe.
    if (offer)
      return {
        ...base,
        from: "reading",
        offer: offerInfo,
        picks: offer.slots.map((s, i) => ({
          rank: null,
          slot: s.slot ?? i + 1,
          championId: s.id ?? null,
          championName: nameOf(s.id),
          itemId: s.item ?? null,
          itemName: nameOf(s.item),
          kind: "unknown",
          score: null,
          reason: "",
          completesNow: false,
          forChampion: null,
          forChampionId: null,
          target: null,
        })),
        note: "Sem análise do plano para ordenar as peças.",
      };
    return { ...base, note: "Sem análise do plano para recomendar." };
  }
  const opts = {
    carry: plan.carry ?? null,
    inventory,
    covered: coveredKeys(plan.itemMoves ?? []),
  };
  const planInfo = { carry: plan.carry ?? null };
  if (offer)
    return {
      ...base,
      from: "reading",
      offer: offerInfo,
      plan: planInfo,
      picks: rankCarouselOffer(plan.itemPlans, offer.slots, {
        ...opts,
        traits: plan.traits ?? [],
        emblemTrait,
        nameOf,
      }),
    };
  return {
    ...base,
    from: "priority",
    plan: planInfo,
    picks: carouselPicks(plan.itemPlans, { ...opts, limit: 5 }).map((p) => ({
      rank: p.rank,
      slot: null,
      championId: null,
      championName: null,
      itemId: p.id,
      itemName: nameOf(p.id) ?? p.name ?? null,
      kind: "component",
      score: p.score,
      reason: p.uses[0]?.reason ?? "",
      completesNow: p.uses[0]?.completesNow === true,
      forChampion: p.uses[0]?.champion ?? null,
      forChampionId: p.uses[0]?.championId ?? null,
      target: p.uses[0] ? { id: p.uses[0].itemId, name: p.uses[0].item } : null,
      owned: p.owned,
    })),
    note: "O carrossel não foi lido: lista de prioridade do que pegar se aparecer.",
  };
}

/**
 * O bloco do carrossel para o servidor: `overlay` é o feed (`recommendationBody()` dá a última análise ao vivo) e `emblems`
 * o Map item de emblema -> sinergia (`traitBook().emblems`). Devolve `(seen, gameId) => bloco`. Os nomes ficam por conta da
 * interface (ela resolve pelo catálogo a partir dos ids).
 */
export const carouselFeed =
  ({ overlay, emblems = new Map() }) =>
  (seen, gameId) =>
    carouselView(seen, {
      rec: () => overlay.recommendationBody(),
      gameId,
      emblemTrait: (id) => emblems.get(id) ?? null,
    });
