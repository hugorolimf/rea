/**
 * Ponte fina: os itens do banco que combinam com uma comp (aba Comps) e a leitura do plano de itens moram no motor único
 * de itens, `core/items/comp-bank.mjs` (sobre a build publicada de `core/items/builds.mjs`). O caminho relativo resolve
 * igual no Node e no navegador.
 */
export {
  emblemBases,
  compItems,
  touched,
  spentCount,
  equippedBy,
  planView,
} from "../../core/items/comp-bank.mjs";
// Id do item base de um radiante: regra em core/catalog/items.mjs (reexportada para quem importava daqui).
export { baseItemId } from "../../core/catalog/items.mjs";
