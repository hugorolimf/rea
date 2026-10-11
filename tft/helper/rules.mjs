// Regras do jogo (Set 18) usadas pela análise e pela economia: valores do jogo, não heurísticas desta ferramenta.
// Só importa de core/ (ESM puro) para poder ser carregado também pelo navegador (mock da interface).
import { SHOP } from "./core/pool/tables.mjs";
import { XP } from "./core/state/level.mjs";
import { ROUND } from "./core/economy/tables.mjs";

// A pool e as odds da loja moram em core/pool/tables.mjs (M4); aqui só são reexportadas.
export { POOL, ODDS } from "./core/pool/tables.mjs";

/** Economia do jogo: preços, renda e XP. */
export const GAME = {
  shopCost: SHOP.cost,
  shopSlots: SHOP.slots,
  xpCost: 4,
  xpPerBuy: 4,
  passiveXp: XP.passiveXp,
  // A renda (ouro base, juros e ouro por sequência) NÃO fica em GAME (M5b): a tabela é de core/economy/tables.mjs e quem
  // precisa dela chama core/economy/gold.mjs (incomeOf, interestOf, streakGold, maxInterestGold).
  winGold: 1,
  // XP para passar ao próximo nível (Set 18): a tabela mora em core/state/level.mjs (mesmo objeto).
  xpToNext: XP.xpToNext,
  // Estágio 1 tem 4 rodadas; os demais têm 7, com carrossel na 4ª e monstros na 7ª (core/state/level.mjs).
  stageOneRounds: XP.stageOneRounds,
  stageRounds: XP.stageRounds,
  carouselRound: XP.carouselRound,
  pveRound: ROUND.pve,
};

// Nível, XP e rodada moram em core/state/level.mjs (M7); aqui só são reexportados para quem importa de rules.mjs.
export {
  levelFloor,
  levelFromXp,
  levelsForXp,
  passiveXpBetween,
  reconcileLevel,
  roundNumber,
} from "./core/state/level.mjs";
