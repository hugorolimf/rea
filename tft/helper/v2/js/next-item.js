import { baseItemId } from "../../core/catalog/items.mjs";
import { takeOne } from "../../core/items/stock.mjs";

/**
 * Receita do "Próximo item" de uma peça (Ao vivo, trilha de itens): o item principal e as duas peças da receita, cada
 * uma com a situação (no banco, já equipada na peça ou faltando). Função pura sobre o que o servidor mandou em
 * `nextItem` e o catálogo; não decide nada de jogo.
 *
 * - `item.missing` (nomes) ou `item.missingIds` (ids): o que a análise já descontou do banco e do que está equipado.
 *   O servidor decide o que falta; aqui só se apresenta.
 * - `item.usesHeld`: componente que a peça já leva equipado e que completa o item.
 * - `item.components`: receita enviada pelo servidor; sem ela, vale a `composition` do catálogo.
 * - Radiante: mostra o item base e a receita do base (o radiante em si não tem receita).
 * - Sem receita (artefato, emblema fixo, item especial): sem componentes.
 */

const ids = (list) =>
  (list ?? []).map((c) => (typeof c === "string" ? c : c?.id)).filter(Boolean);

/**
 * `catalogItems`: Map id → {name, composition}. `bank`: ids dos itens no banco (opcional; só entra quando o
 * servidor não informou o que falta). Devolve `{ item, base, parts, radiant, complete }`.
 */
export function nextItemRecipe(
  item,
  catalogItems = new Map(),
  { bank = null } = {},
) {
  if (!item?.id) return null;
  const name = (id) =>
    catalogItems.get(id)?.name ?? String(id).replace(/^DA_(Component_)?/, "");
  const baseId = baseItemId(item.id),
    radiant = baseId !== item.id,
    recipeOf = radiant ? baseId : item.id;
  const sent = ids(item.components),
    recipe =
      sent.length && !radiant
        ? sent
        : ids(catalogItems.get(recipeOf)?.composition);
  const main = { id: item.id, name: item.name ?? name(item.id) },
    base = radiant ? { id: baseId, name: name(baseId) } : null;
  if (recipe.length < 2 && !radiant)
    return {
      item: main,
      base: null,
      parts: [],
      radiant: false,
      complete: false,
    };

  // O que falta, por id; sem ids, por nome (cada nome casa uma vez: duas peças iguais podem faltar uma só).
  const missingIds = [...(item.missingIds ?? [])];
  const missingNames = [...(item.missing ?? [])];
  // O servidor não avalia a receita do item base de um radiante (o radiante não tem receita): ali só vale o banco.
  const informed =
    !radiant && (item.missingIds != null || item.missing != null);
  const held = item.usesHeld ?? null;
  let heldUsed = false;
  const stock = bank ? [...bank] : null;
  const parts = recipe.map((id) => {
    const label = name(id);
    if (informed) {
      // Cada faltante vale uma peça da receita: por id e, sem id, por nome (core/items/stock.mjs gasta uma vez).
      if (
        takeOne(missingIds, id) !== null ||
        takeOne(missingNames, label) !== null
      )
        return { id, name: label, state: "missing" };
      if (held === id && !heldUsed) {
        heldUsed = true;
        return { id, name: label, state: "equipped" };
      }
      return { id, name: label, state: "bank" };
    }
    // Servidor antigo ou sem informação: o banco lido da tela decide; sem banco, o estado é desconhecido.
    if (!stock) return { id, name: label, state: "unknown" };
    if (takeOne(stock, id) === null)
      return { id, name: label, state: "missing" };
    return { id, name: label, state: "bank" };
  });
  return {
    item: main,
    base,
    parts,
    radiant,
    complete: parts.length > 0 && parts.every((p) => p.state !== "missing"),
  };
}

/** Texto curto de cada situação (tooltip e rótulo de acessibilidade). */
export const PART_STATE = {
  bank: "no banco",
  equipped: "já equipado na peça",
  missing: "falta",
  unknown: "sem leitura do banco",
};
