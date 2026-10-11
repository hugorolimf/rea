// Tabelas do jogo que definem o ouro, a vida e o calendário de rodadas (Set 18). Sem imports nem I/O: carrega igual no
// servidor e no navegador. Quem precisa da renda chama `gold.mjs` (incomeOf, interestOf...) em vez de ler `INCOME`; o resto
// do calendário (rodadas por estágio, carrossel) mora em `core/state/level.mjs` (XP).

/**
 * Renda por rodada: ouro base, juros (1 g a cada `interestStep` guardados, no máximo `interestMax`) e ouro por
 * sequência de vitórias ou derrotas ([tamanho mínimo, ouro por rodada], do maior para o menor).
 */
export const INCOME = {
  base: 5,
  interestStep: 10,
  interestMax: 5,
  streakGold: [
    [6, 3],
    [5, 2],
    [2, 1],
  ],
};

/** Vida: máximo do jogo (leituras acima disso não são vida). */
export const HP = { max: 100 };

/** Rodada contra monstros (PVE) de cada estágio; o carrossel é `XP.carouselRound` (core/state/level.mjs). */
export const ROUND = { pve: 7 };
