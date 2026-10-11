/**
 * Estoque de itens: a regra única de "gastar uma cópia" (M6 da migração, ver ARQUITETURA.md).
 *
 * Antes, cada módulo que precisava de um item do banco (ou de uma peça solta) escrevia o próprio `indexOf` + `splice` em
 * cima de uma lista. Aqui mora o gesto: gastar UMA cópia de um item (a exata primeiro; o radiante vale o item base),
 * gastar uma receita inteira ou nada, e medir o que falta sem tocar no estoque. ESM puro, sem `node:*`, relógio ou
 * aleatório: carrega igual no servidor e no navegador. Só importa de `core/`.
 *
 * As funções `take*` MUTAM a lista recebida (é assim que um estoque é "gasto"); as demais não mexem no que recebem.
 */
import { baseItemId } from "../catalog/items.mjs";

/**
 * Tira da lista a primeira ocorrência que casa e a devolve (`null` se não há). `match`: id exato (texto) ou predicado.
 * A lista pode ter ids ou objetos (ex.: `{ id, leaving }`), desde que `match` seja um predicado.
 */
export function takeOne(list, match) {
  const test = typeof match === "function" ? match : (x) => x === match;
  const at = list.findIndex(test);
  return at < 0 ? null : list.splice(at, 1)[0];
}

/**
 * Gasta uma cópia do item: a exata primeiro e, sem ela, o radiante do mesmo item base (radiante = item base).
 * Devolve o id gasto (com `Radiant`, se era o radiante) ou `null`.
 */
export function takeItem(list, id) {
  return (
    takeOne(list, id) ?? takeOne(list, (x) => baseItemId(x) === baseItemId(id))
  );
}

/**
 * Gasta todos os `ids` (componentes de uma receita, por exemplo) ou nenhum: só muta a lista se todos existem.
 * Devolve os ids gastos, na ordem pedida, ou `null` se falta algum.
 */
export function takeAll(list, ids) {
  const probe = [...list],
    taken = [];
  for (const id of ids) {
    const got = takeOne(probe, id);
    if (got === null) return null;
    taken.push(got);
  }
  list.splice(0, list.length, ...probe);
  return taken;
}

/**
 * Gasta `ids` de uma cópia do estoque, sem mexer no original. Devolve `{ missing, left }`: os ids que não havia (cada
 * repetição pede uma cópia) e o que sobra do estoque depois de gastar o que havia.
 */
export function spend(list, ids) {
  const left = [...list],
    missing = [];
  for (const id of ids) if (takeOne(left, id) === null) missing.push(id);
  return { missing, left };
}

/** O estoque cobre todos os `ids` (cada repetição pede uma cópia)? Não muta. */
export const hasAll = (list, ids) => spend(list, ids).missing.length === 0;

/**
 * Metade de uma receita: o primeiro componente dela que o estoque tem. Gasta esse componente e devolve
 * `{ have, missing }` (o que se tem e o que falta); `null` se o estoque não tem nenhum dos componentes.
 */
export function takeHalf(list, recipe) {
  const part = recipe.find((p) => list.includes(p));
  if (part === undefined) return null;
  takeOne(list, part);
  const missing = [...recipe];
  missing.splice(missing.indexOf(part), 1);
  return { have: [part], missing };
}

/**
 * Monta `required` (ids que a peça precisa) com o banco e, numa receita de 2 componentes, com UMA peça solta que a
 * própria peça já leva equipada (`held`). Não muta `stock` nem `held`.
 * Devolve `{ missing, usesHeld }`: o que falta do banco e a peça solta usada (`null` se nenhuma).
 */
export function fillRecipe(required, { stock = [], held = [] } = {}) {
  const bank = [...stock],
    loose = [...held],
    missing = [];
  let usesHeld = null;
  for (const id of required) {
    if (required.length === 2 && !usesHeld && takeOne(loose, id) !== null) {
      usesHeld = id;
      continue;
    }
    if (takeOne(bank, id) === null) missing.push(id);
  }
  return { missing, usesHeld };
}
