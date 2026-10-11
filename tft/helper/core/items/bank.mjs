/**
 * O banco entre as builds de uma comp (aba Comps): quem leva cada item do banco quando só o banco e o que a própria peça
 * já usa contam (M6 da migração). É o caso do banco da regra de `holdings.mjs`: cada item e cada componente é gasto uma
 * vez (`stock.mjs`), o radiante vale o item base, e a ordem é a das peças recebidas (o carry primeiro).
 *
 * A distribuição acontece em duas passadas porque quem chama gasta outros itens do banco no meio (emblemas):
 *  1. `spendBankOnBuilds`: equipado, item pronto (o exato primeiro, depois o radiante) e montagem completa;
 *  2. `spendBankHalves`: o que sobrou do banco vira metade de receita nas linhas que ainda faltam.
 *
 * Estados de uma linha: `on` (já equipado na peça), `ready` (o próprio item no banco), `radiant` (o radiante do item no
 * banco), `craft` (os dois componentes no banco), `half` (um componente; diz o que falta) e `missing` (nada).
 */
import { recipeOf } from "../catalog/items.mjs";
import { baseItem } from "./holdings.mjs";
import { takeAll, takeHalf, takeItem, takeOne } from "./stock.mjs";

/** A linha tem receita de 2 componentes? (`row.recipe` = componentes do item; vazio para artefato e emblema pronto.) */
const craftable = (row) => recipeOf({ composition: row.recipe }) !== null;

/**
 * Passada 1. `units`: [{ owned: ids equipados na peça, rows: [{ want, recipe, state, spent, have, missing }] }], na ordem
 * de prioridade. `stock`: ids do banco, SEM consumíveis. Muta `units[].owned`, as linhas e `stock`.
 */
export function spendBankOnBuilds(units, stock) {
  for (const u of units)
    for (const row of u.rows) {
      if (takeOne(u.owned, (id) => baseItem(id) === row.want) !== null) {
        row.state = "on";
        continue;
      }
      const exact = takeItem(stock, row.want);
      if (exact !== null) {
        Object.assign(row, {
          state: exact === row.want ? "ready" : "radiant",
          spent: [exact],
        });
        continue;
      }
      if (craftable(row)) {
        const parts = takeAll(stock, row.recipe);
        if (parts)
          Object.assign(row, { state: "craft", spent: parts, have: parts });
      }
    }
}

/**
 * Passada 2: metade de uma receita (um componente no banco; diz o que falta) nas linhas que ainda estão `missing`.
 * Muta as linhas e `stock`.
 */
export function spendBankHalves(units, stock) {
  for (const u of units)
    for (const row of u.rows)
      if (row.state === "missing" && craftable(row)) {
        const half = takeHalf(stock, row.recipe);
        if (half)
          Object.assign(row, {
            state: "half",
            spent: [...half.have],
            have: half.have,
            missing: half.missing,
          });
      }
}
