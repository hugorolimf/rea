/**
 * Reexport fino: a regra de sinergias e emblemas mora em `core/catalog/traits.mjs` (M3 da migração). O caminho relativo
 * resolve igual no Node e no navegador (o servidor serve `/core/*` ao lado de `/v2/*`).
 */
export {
  countTraits,
  countUnitTraits,
  emblemTraitMap,
  firstBreakpoint,
  traitStatus,
  traitsWithEmblems,
  unmappedEmblems,
} from "../../core/catalog/traits.mjs";
