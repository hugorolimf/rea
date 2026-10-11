// A loja: odds por nível, "comprável no nível" e a chance de um campeão aparecer por slot, por loja e em N lojas.
// Uma só implementação da chance: o motor (pool[].chancePerShop, score das comps), a rolagem (economy/roll) e as
// cartas (stage) a leem daqui, com a pool livre fracionária (copies.mjs).
import { BUYABLE_ODDS, LEVELS, ODDS, SHOP } from "./tables.mjs";

const clampLevel = (level) => Math.min(LEVELS.max, Math.max(LEVELS.min, level));

/** Linha de odds (%) por custo 1..5 do nível (nível fora de 1..11 usa o extremo mais próximo). */
export const levelOdds = (level) => ODDS[clampLevel(level)];

/** Chance (%) de um slot da loja do nível sair com o custo. */
export const oddsAt = (level, cost) => levelOdds(level)[cost - 1] ?? 0;

/** O custo é comprável no nível (pelo menos `BUYABLE_ODDS` % por slot)? */
export const isBuyable = (level, cost) => oddsAt(level, cost) >= BUYABLE_ODDS;

/** Menor nível em que o custo é comprável (11 se nenhum). */
export function unlockLevel(cost) {
  for (let level = LEVELS.min; level <= LEVELS.max; level++)
    if (isBuyable(level, cost)) return level;
  return LEVELS.max;
}

/**
 * Chance de um slot da loja mostrar o campeão: odds do custo × cópias livres dele ÷ livres do custo (`denom`).
 * `copies` e `denom` são fracionários (pool livre fracionária).
 */
export const slotChance = (level, cost, copies, denom) =>
  denom > 0 && copies > 0 ? (oddsAt(level, cost) / 100) * (copies / denom) : 0;

/** Chance de ver o campeão em `shops` lojas (padrão 1) dado o `perSlot` de cada slot. */
export const shopChance = (perSlot, shops = 1) =>
  1 - (1 - perSlot) ** (SHOP.slots * shops);

/** Chance de ver ao menos `k` cópias em `n` vagas de loja com chance `p` por vaga (cauda da binomial). */
export function chanceAtLeast(n, p, k) {
  if (k <= 0) return 1;
  if (p <= 0) return 0;
  let term = (1 - p) ** n,
    below = 0;
  for (let i = 0; i < k; i++) {
    below += term;
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.max(0, 1 - below);
}

/** Vagas de loja em `shops` lojas. */
export const slotsIn = (shops) => SHOP.slots * shops;
