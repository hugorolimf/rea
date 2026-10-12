// Pressão de vida (M5b): a faixa que todas as decisões de gasto usam. ESM puro, sem I/O nem tempo implícito.
// A faixa muda só o que a vida muda de fato: o piso de ouro, a urgência (força agora contra ouro futuro) e o horizonte de
// juros. Ela não escolhe comp nem tamanho de plano: o prazo de montagem pela vida é contínuo (core/comps/reach.mjs).
import { POLICY } from "./policy.mjs";

/**
 * Estágio usado pela faixa: o lido ou, sem leitura, o estimado pelo nível médio dos rivais (`foeLevel`, unidades em
 * campo). A estimativa é a mesma em strategy.mjs e stage.mjs, para as duas decisões verem a mesma faixa.
 */
export function stageForPressure(stage, foeLevel = null) {
  if (stage) return stage;
  if (!Number.isFinite(foeLevel)) return null;
  return foeLevel >= 8
    ? { stage: 5, round: 1 }
    : foeLevel >= 7
      ? { stage: 4, round: 1 }
      : foeLevel >= 5.5
        ? { stage: 3, round: 1 }
        : null;
}

/**
 * Faixa de vida usada por todas as decisões de gasto: crítica, perigo, ferido ou saudável,
 * com o piso de ouro, a urgência e o horizonte de juros de cada faixa, e o gatilho que a disparou (`why`).
 * - `trend`: `{ avgLoss, recentLosses, samples }` de streak.mjs (`samples` ausente conta como suficiente);
 * - `gold`: ouro lido (null = não lido), usado só para reconhecer a sequência de derrotas proposital;
 * - `board`: `{ mine, typical }` na régua de força do lobby (seu tabuleiro de agora e a mediana dos rivais vivos);
 * - `won`: a última luta contra jogador foi vitória (streak.mjs). Com um dos dois, o perigo pode estar ESTABILIZADO.
 * Estabilizado (`stabilized`): a faixa continua de perigo (o aviso continua), mas `spend` é falso e o piso, a urgência e o
 * horizonte são os da economia normal (`POLICY.stable.band`): não manda gastar tudo com o tabuleiro já competitivo.
 */
export function pressureOf({
  hp,
  stage = null,
  weak = false,
  trend = null,
  gold = null,
  board = null,
  won = false,
}) {
  const H = POLICY.hp,
    T = POLICY.trend,
    L = POLICY.lossStreak,
    at = stage?.stage ?? 0;
  // Sequência de derrotas proposital (estágio cedo, vida alta, economia guardada): tendência e tabuleiro fraco não contam.
  const planned =
    at >= 1 &&
    at <= L.lastStage &&
    hp > L.hp &&
    Number.isFinite(gold) &&
    gold >= L.gold;
  // Tendência: no ritmo das últimas perdas (com `drops` quedas medidas), chegar a `floorHp` de vida em `rounds` rodadas é
  // perigo; `losses`+ perdas recentes com `lossesHp` de vida ou menos também (o tabuleiro não segura o lobby).
  const samples = trend?.samples ?? T.drops,
    projected =
      trend?.avgLoss && samples >= T.drops
        ? hp - T.rounds * trend.avgLoss
        : Infinity,
    losing = (trend?.recentLosses ?? 0) >= T.losses && hp <= T.lossesHp;
  const why =
    hp <= H.critical
      ? `vida ${hp} ≤ ${H.critical}`
      : hp <= H.danger
        ? `vida ${hp} ≤ ${H.danger}`
        : hp <= H.dangerLate && at >= POLICY.lateStage
          ? `vida ${hp} ≤ ${H.dangerLate} a partir do estágio ${POLICY.lateStage}`
          : planned
            ? null
            : projected <= T.floorHp
              ? `perdendo ~${Math.round(trend.avgLoss)} por derrota: ${Math.max(0, Math.round(projected))} de vida em ${T.rounds} rodadas`
              : losing
                ? `${trend.recentLosses} derrotas recentes com vida ${hp}`
                : weak && hp <= H.weak
                  ? `tabuleiro abaixo da maioria com vida ${hp}`
                  : null;
  const critical = hp <= H.critical,
    danger = why !== null;
  const band = critical
    ? "critical"
    : danger
      ? "danger"
      : hp <= H.hurt
        ? "hurt"
        : "healthy";
  // Estabilizado: a vida diz quanto vale vencer a próxima luta, não obriga a gastar tudo com o tabuleiro já competitivo.
  const S = POLICY.stable,
    share = S.share[band] ?? null,
    level =
      share !== null &&
      Number.isFinite(board?.mine) &&
      Number.isFinite(board?.typical) &&
      board.typical > 0
        ? board.mine / board.typical
        : null,
    stabilized = danger && (won === true || (level !== null && level >= share)),
    economy = stabilized ? S.band : band;
  return {
    band,
    danger,
    critical,
    why,
    stabilized,
    // Por que estabilizou (vitória ou força), para o aviso; null fora disso.
    stableWhy: !stabilized
      ? null
      : won === true
        ? "venceu a última luta"
        : `tabuleiro ${Math.round(board.mine)} contra ${Math.round(board.typical)} da mediana dos rivais`,
    // Rolar para estabilizar (gastar até o piso de perigo): só no perigo ainda não estabilizado.
    spend: danger && !stabilized,
    // Sequência de derrotas reconhecida como proposital (a tendência foi ignorada de propósito).
    lossStreak: planned,
    floor: POLICY.floor[economy],
    urgency: POLICY.urgency[economy],
    horizon: POLICY.horizon[economy],
  };
}
