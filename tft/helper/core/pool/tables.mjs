// Tabelas do jogo que definem a pool e a loja (Set 18 / patch 18.3; as odds não foram confirmadas no 18.4).
// Sem imports nem I/O: carrega igual no servidor e no navegador. `rules.mjs` reexporta daqui.

/** Cópias de cada campeão na pool compartilhada, por custo. */
export const POOL = { 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 };

/** Chance (%) de cada slot da loja sair com custo 1..5, por nível. */
export const ODDS = {
  1: [100, 0, 0, 0, 0],
  2: [100, 0, 0, 0, 0],
  3: [75, 25, 0, 0, 0],
  4: [55, 30, 15, 0, 0],
  5: [45, 33, 20, 2, 0],
  6: [30, 40, 25, 5, 0],
  7: [19, 30, 40, 10, 1],
  8: [15, 20, 32, 30, 3],
  9: [10, 17, 25, 33, 15],
  10: [5, 10, 20, 40, 25],
  11: [1, 2, 12, 50, 35],
};

/** A loja: quantos slots mostra e quanto custa rolar. */
export const SHOP = { slots: 5, cost: 2 };

/** Maior e menor nível com linha em `ODDS`. */
export const LEVELS = { min: 1, max: 11 };

/**
 * Chance mínima (% por slot) a partir da qual um custo é tratado como "comprável no nível" (uma loja ou duas já o
 * mostram). Abaixo disso o custo conta como fora do alcance da loja daquele nível.
 */
export const BUYABLE_ODDS = 10;

/** Cópias de 1★ que fazem 1 estrela a mais (3 cópias viram 2★; 3 de 2★ viram 3★). */
export const COPIES_PER_STAR = 3;
