// Recomendação de itens AO VIVO no corpo de GET /api/state: a mesma regra da análise (core/items/item-priority.mjs e as
// bigornas de carousel.mjs `anvilPicks`), recalculada a cada estado lido com o banco, o tabuleiro e a reserva de AGORA do
// GEP, sobre a comp e a lista de itens de cada campeão do último plano (`rec`). É barata (milissegundos): o "Próximo item"
// e as bigornas não esperam a análise das comps, que no late game leva segundos. ESM puro.
import { anvilPicks } from "../carousel.mjs";
import {
  anvilKind,
  isComponent,
  isConsumable,
} from "../core/catalog/items.mjs";
import { itemPriority, ITEM_SLOTS } from "../core/items/item-priority.mjs";
import { coveredKeys } from "../core/items/moves.mjs";

/** O plano exibido da análise: a comp fixada, senão a primeira sugestão (a mesma escolha da interface). */
const planOf = (rec) => rec?.preview ?? rec?.recommendations?.[0] ?? null;

/** A análise é desta partida? (sem os dois ids não há como saber: vale) */
const sameGame = (rec, gameId) =>
  gameId == null ||
  rec?.metadata?.gameId == null ||
  String(rec.metadata.gameId) === String(gameId);

const completed = (items) =>
  (items ?? []).filter((id) => id && !isComponent(id) && !isConsumable(id))
    .length;

/**
 * `seen`: o estado visto (`items`, `gepBoard`, `gepBench`, `gepAnvils`); `rec`: o último corpo de /api/recommend (ou uma
 * função que o entrega); `gameId`: a partida. Devolve `{ at, inventory, ready, near, anvils }` (o formato de
 * `ownedItemAdvice`, tactics.mjs) ou null sem banco lido, sem plano ou de outra partida.
 */
export function itemsNow(seen, { rec = null, gameId = null } = {}) {
  if (!Array.isArray(seen?.items)) return null;
  const analysis = typeof rec === "function" ? rec() : rec;
  if (!analysis || !sameGame(analysis, gameId)) return null;
  const plan = planOf(analysis),
    plans = (plan?.itemPlans ?? []).filter((p) => (p.options ?? []).length);
  if (!plans.length) return null;
  // Peças suas ao vivo (campo e reserva do GEP): os itens equipados e a estrela de agora; sem leitura, os da análise.
  const live = new Map();
  for (const u of [...(seen.gepBench ?? []), ...(seen.gepBoard ?? [])])
    if (u?.id)
      live.set(u.id, { ...u, onField: (seen.gepBoard ?? []).includes(u) });
  const bank = [
    ...seen.items.filter((id) => !isConsumable(id) || anvilKind(id)),
    ...(seen.gepAnvils ?? []),
  ];
  const current = plans.map((p) => {
    const u = live.get(p.championId),
      equipped = u
        ? [...(u.items ?? [])]
        : (p.equipped ?? []).map((e) => e?.id ?? e);
    return {
      ...p,
      stars: u?.stars ?? p.stars ?? 0,
      inField: !!u?.onField,
      equipped: equipped.map((id) => ({ id })),
      slotsFree: Math.max(0, ITEM_SLOTS - completed(equipped)),
    };
  });
  // Peças suas fora do plano que carregam componentes (o temporário, por exemplo): fecham receitas dos campeões do plano.
  const planIds = new Set(current.map((p) => p.championId)),
    holders = [...live.values()]
      .filter((u) => !planIds.has(u.id) && (u.items ?? []).length)
      .map((u) => ({ id: u.id, name: u.text ?? u.id, equipped: u.items }));
  const covered = coveredKeys(plan.itemMoves ?? []),
    byId = new Map(current.map((p) => [p.championId, p.options])),
    out = itemPriority({
      members: current.map((p) => ({
        id: p.championId,
        name: p.name,
        stars: p.stars,
        inField: p.inField,
        equipped: p.equipped.map((e) => e.id),
        slotsFree: p.slotsFree,
      })),
      optionsOf: (id) => byId.get(id) ?? [],
      bank,
      covered,
      holders,
    });
  return {
    at: Date.now(),
    inventory: bank,
    ready: out.ready,
    near: out.near.slice(0, 6),
    anvils: anvilPicks(current, { inventory: bank, covered, holders }),
  };
}

/**
 * Para o servidor: `overlay` é o feed (`recommendationBody()` dá a última análise ao vivo). Devolve
 * `(seen, gameId) => bloco`, guardado enquanto a análise, o banco, as bigornas e as peças não mudam.
 */
export function itemsNowFeed({ overlay }) {
  let last = { rec: null, key: null, value: null };
  return (seen, gameId) => {
    const rec = overlay.recommendationBody(),
      key = JSON.stringify([
        gameId,
        seen?.items ?? null,
        seen?.gepAnvils ?? null,
        (seen?.gepBoard ?? []).map((u) => [u.id, u.stars, u.items]),
        (seen?.gepBench ?? []).map((u) => [u.id, u.stars, u.items]),
      ]);
    if (rec !== last.rec || key !== last.key)
      last = { rec, key, value: itemsNow(seen, { rec, gameId }) };
    return last.value;
  };
}
