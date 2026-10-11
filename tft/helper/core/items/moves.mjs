/**
 * "Passar itens": como ler os passes que o plano propõe (`itemMoves` de `tactics.mjs`) (M6 da migração). Cada passe é
 * `{ from: { id, name }, leaving, moves: [{ item: { id }, to: { id, name } }] }`. Quem precisa saber "este item já chega
 * a esta peça de outra" (o plano da loja, o checklist, o carrossel, a Formação, o conselho de montar) lê daqui, em vez
 * de reescrever o laço. O item é sempre comparado pelo item base (radiante = item base).
 */
import { baseItemId } from "../catalog/items.mjs";

/** Passes que terminam em `unitId`: [{ itemId (base), fromId, from }] (`from` = a peça de onde o item sai). */
export function movesInto(itemMoves, unitId) {
  return (itemMoves ?? []).flatMap((m) =>
    (m.moves ?? [])
      .filter((x) => x.to?.id === unitId)
      .map((x) => ({
        itemId: baseItemId(x.item?.id),
        fromId: m.from?.id,
        from: m.from ?? null,
      })),
  );
}

/** Por peça que recebe, os ids base dos itens que já chegam a ela de outra peça: Map(unitId -> Set(itemId)). */
export function movedInto(itemMoves) {
  const out = new Map();
  for (const m of itemMoves ?? [])
    for (const x of m.moves ?? []) {
      if (!out.has(x.to.id)) out.set(x.to.id, new Set());
      out.get(x.to.id).add(baseItemId(x.item.id));
    }
  return out;
}

/** "peça:item" de cada item que já chega a uma peça de outra (para não pedir de novo o que só se passa). */
export function coveredKeys(itemMoves) {
  return new Set(
    [...movedInto(itemMoves)].flatMap(([unitId, ids]) =>
      [...ids].map((id) => `${unitId}:${id}`),
    ),
  );
}
