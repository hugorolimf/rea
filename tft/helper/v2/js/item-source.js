/**
 * Onde está cada item que a Formação pede. A regra mora em `core/items/holdings.mjs` (M6 da migração): a mesma que o
 * motor de comps, o plano de itens e a aba Comps usam. Este arquivo só a reexporta para quem importava daqui.
 */
export {
  baseItem,
  buildStates,
  locateItem,
  ownersOf,
} from "../../core/items/holdings.mjs";
