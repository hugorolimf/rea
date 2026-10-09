// Regras do jogo (Set 18) usadas pela análise e pela economia: valores do jogo, não heurísticas desta ferramenta.
// Sem imports nem I/O para poder ser carregado também pelo navegador (mock da interface).

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

/** Economia do jogo: preços, renda e XP. */
export const GAME = {
  shopCost: 2,
  shopSlots: 5,
  xpCost: 4,
  xpPerBuy: 4,
  passiveXp: 2,
  baseIncome: 5,
  winGold: 1,
  interestStep: 10,
  interestMax: 5,
  // Ouro por sequência de vitórias ou derrotas: [tamanho mínimo, ouro por rodada], do maior para o menor.
  streakGold: [
    [6, 3],
    [5, 2],
    [2, 1],
  ],
  // Estágio 1 tem 4 rodadas; os demais têm 7, com carrossel na 4ª e monstros na 7ª.
  stageOneRounds: 4,
  stageRounds: 7,
  carouselRound: 4,
  pveRound: 7,
};
