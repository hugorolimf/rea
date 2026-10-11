/**
 * Grafo de fatos derivados com memoização (M8a). Ponto de entrada único: quem precisa de cache por chave usa isto, não
 * um `Map` próprio com `JSON.stringify` como chave (a catraca `manual-memo-key` de tests/architecture.test.mjs cobra).
 */
export { createGraph, defineFact, DEFAULT_KEEP } from "./graph.mjs";
export { GraphError } from "./errors.mjs";
export { canonical, digestString, stableKey } from "./stable-key.mjs";
