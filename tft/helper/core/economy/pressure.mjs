// Pressão de vida (M5b): a faixa que todas as decisões de gasto usam. ESM puro, sem I/O nem tempo implícito.
import { POLICY } from "./policy.mjs";

/**
 * Faixa de vida usada por todas as decisões de gasto: crítica, perigo, ferido ou saudável,
 * com o piso de ouro, a urgência e o horizonte de juros de cada faixa.
 */
export function pressureOf({ hp, stage = null, weak = false, trend = null }) {
  const H = POLICY.hp,
    T = POLICY.trend;
  // Tendência: no ritmo das últimas perdas, chegar a `floorHp` de vida em `rounds` rodadas é perigo; `losses`+ perdas
  // recentes com `lossesHp` de vida ou menos também (o tabuleiro não segura o lobby — estabilizar antes da vida acabar).
  const projected = trend?.avgLoss ? hp - T.rounds * trend.avgLoss : Infinity,
    bleeding =
      projected <= T.floorHp ||
      ((trend?.recentLosses ?? 0) >= T.losses && hp <= T.lossesHp);
  const critical = hp <= H.critical,
    danger =
      critical ||
      bleeding ||
      hp <= H.danger ||
      (hp <= H.dangerLate && (stage?.stage ?? 0) >= POLICY.lateStage) ||
      (weak && hp <= H.weak);
  const band = critical
    ? "critical"
    : danger
      ? "danger"
      : hp <= H.hurt
        ? "hurt"
        : "healthy";
  return {
    band,
    danger,
    critical,
    floor: POLICY.floor[band],
    urgency: POLICY.urgency[band],
    horizon: POLICY.horizon[band],
  };
}
