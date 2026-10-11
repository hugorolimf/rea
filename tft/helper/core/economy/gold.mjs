// Ouro: juros, renda, projeção e as lojas ao alcance (M5b). ESM puro, sem I/O nem tempo implícito: carrega igual no
// servidor e no navegador. Os números vêm de `tables.mjs` (regra do jogo) e de `policy.mjs` (política da ferramenta); os
// objetos são lidos a cada chamada, então perturbá-los em teste muda o resultado.
import { SHOP } from "../pool/tables.mjs";
import { INCOME } from "./tables.mjs";
import { POLICY } from "./policy.mjs";
import { nextRound, roundLabel } from "./rounds.mjs";

/** Ouro guardado a partir do qual os juros não crescem mais (patamar máximo: 50 g). */
export const maxInterestGold = () => INCOME.interestStep * INCOME.interestMax;

/** Quantos patamares de juros existem (o medidor de ouro da interface tem este número + 1 marcas). */
export const interestTiers = () => INCOME.interestMax;

/** Juros pagos na próxima rodada para `gold` guardado. */
export const interestOf = (gold) =>
  gold == null
    ? null
    : Math.min(
        INCOME.interestMax,
        Math.floor(Math.max(0, gold) / INCOME.interestStep),
      );

/** Próximo patamar de juros (null no máximo ou sem ouro lido). */
export const nextTier = (gold) =>
  gold == null || gold >= maxInterestGold()
    ? null
    : (Math.floor(gold / INCOME.interestStep) + 1) * INCOME.interestStep;

/** Patamar de juros atual (múltiplo de 10 abaixo do ouro, até 50). */
export const tierFloor = (gold) =>
  Math.min(
    maxInterestGold(),
    Math.floor(Math.max(0, gold) / INCOME.interestStep) * INCOME.interestStep,
  );

/** Ouro extra por rodada de uma sequência de `length` vitórias ou derrotas. */
export function streakGold(length) {
  for (const [min, gold] of INCOME.streakGold) if (length >= min) return gold;
  return 0;
}

/** Renda da próxima rodada guardando `gold`: base + juros + sequência (vitória não é prevista). */
export function incomeOf(gold, streak = null) {
  const interest = interestOf(gold) ?? 0,
    bonus = streakGold(streak?.length ?? 0);
  return {
    base: INCOME.base,
    interest,
    streak: bonus,
    total: INCOME.base + interest + bonus,
  };
}

/**
 * Ouro no início das próximas `rounds` rodadas se você gastar `spend` agora e só economizar depois.
 * Cada rodada paga base + juros sobre o ouro guardado + sequência atual (mantida); vitórias não entram.
 */
export function projectGold(
  gold,
  { spend = 0, stage = null, streak = null, rounds = 4 } = {},
) {
  if (gold == null) return [];
  let g = Math.max(0, gold - spend),
    at = stage;
  const out = [];
  for (let i = 0; i < rounds; i++) {
    const income = incomeOf(g, streak);
    g += income.total;
    at = at ? nextRound(at) : null;
    out.push({
      label: at ? roundLabel(at) : `+${i + 1}`,
      gold: g,
      interest: interestOf(g),
      income: income.total,
    });
  }
  return out;
}

/**
 * Lojas ao alcance do motor de comps: `base` lojas mais as que o ouro de agora e a renda das próximas `rounds` rodadas
 * (base + juros sobre o ouro de agora, sem sequência) pagam guardando `reserve` g. Ouro não lido (null/undefined) conta
 * como `assumedGold` (D14): é uma suposição da política, não uma leitura.
 */
export function shopsAhead(gold) {
  const S = POLICY.shopsAhead,
    have = gold ?? S.assumedGold,
    income = incomeOf(have).total;
  const spendable = Math.max(0, have + S.rounds * income - S.reserve);
  return S.base + Math.floor(spendable / SHOP.cost);
}
