// Cópias de campeão: quanto uma estrela representa, quantas sobram na pool e como ler isso de uma entrada da pool.
// Regra única de pool livre: FRACIONÁRIA (o banco estimado dos rivais entra com a fração, sem arredondar); quem
// precisa de inteiro (ex.: "ainda é possível?") usa o teto observado (`upper`), nunca um arredondamento da livre.
import { COPIES_PER_STAR, POOL } from "./tables.mjs";

/** Cópias de 1★ que uma peça de `stars` estrelas representa (1★ = 1, 2★ = 3, 3★ = 9). */
export const starCopies = (stars) =>
  COPIES_PER_STAR ** (Math.max(1, Math.floor(Number(stars)) || 1) - 1);

/** Estrela que `copies` cópias de 1★ fazem (0 sem cópia; 1 a 2 = 1★, 3 a 8 = 2★, 9+ = 3★). */
export const starsForCopies = (copies) =>
  copies >= starCopies(3)
    ? 3
    : copies >= starCopies(2)
      ? 2
      : copies >= 1
        ? 1
        : 0;

/** Teto de cópias na pool: o tamanho da pool do custo menos as cópias vistas nos tabuleiros. */
export const upperCopies = (cost, seen = 0) =>
  Math.max(0, (POOL[cost] ?? 0) - seen);

/** Cópias provavelmente livres, fracionárias: o teto menos as estimadas nos bancos rivais (`hidden`). */
export const freeCopies = (cost, seen = 0, hidden = 0) =>
  Math.max(0, upperCopies(cost, seen) - hidden);

/**
 * Cópias livres de uma entrada da pool (`analysis.pool[]`): `free` (exato, escrito pelo motor), ou, para entradas
 * montadas à mão, `remainingLikely` e por fim o teto `remainingUpper`. Nunca arredonda.
 */
export const freeOf = (p) =>
  Math.max(0, p?.free ?? p?.remainingLikely ?? p?.remainingUpper ?? 0);

/** Cópias livres somadas por custo: o denominador da chance de cada campeão na loja. */
export function freeByCost(pool) {
  const free = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const p of pool ?? []) free[p.cost] = (free[p.cost] ?? 0) + freeOf(p);
  return free;
}
