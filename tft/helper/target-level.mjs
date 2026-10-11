// Heurística de nível-alvo: usa apenas nível, HP, ouro e tabuleiros visíveis.
// Não conhece estágio, experiência acumulada, streak nem augments de economia.
// Os limiares de vida e de ouro são da política (core/economy): POLICY.hp.low/hurt/comfortable e o teto de juros.
import { POLICY } from "./core/economy/policy.mjs";
import { maxInterestGold } from "./core/economy/gold.mjs";
const pressure = (p) =>
  (p.boardPieces ?? []).reduce(
    (n, u) =>
      n + (u.starLevel ?? 1) * (u.price ?? 1) + (u.itemNames?.length ?? 0) * 2,
    0,
  );
export function suggestTargetLevel(snapshot, playerId, level, gold) {
  const players = snapshot.statsBlock.players,
    self = players.find((p) => String(p.playerId) === String(playerId));
  if (!self)
    return {
      level: Math.max(1, Math.min(10, level + 1)),
      reasons: [
        "Jogador local ausente no snapshot; alvo padrão de um nível acima.",
      ],
    };
  const rivals = players.filter((p) => p !== self && p.health > 0),
    hp = self.health,
    reasons = [];
  const sorted = rivals.map(pressure).sort((a, b) => a - b),
    median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    mine = pressure(self);
  const behind = median > 0 && mine < median * 0.75,
    ahead = median > 0 && mine > median * 1.15;
  let target = level + 1;
  if (hp <= 0) {
    reasons.push(
      "Hero eliminado neste snapshot: alvo apenas para planejamento.",
    );
  } else if (hp <= POLICY.hp.low) {
    if (gold !== null && gold >= maxInterestGold()) {
      reasons.push(
        `HP ${hp} baixo, mas ${gold}g permitem subir um nível para estabilizar.`,
      );
    } else {
      target = level;
      reasons.push(
        `HP ${hp} baixo: estabilizar no nível atual antes de subir.`,
      );
    }
  } else if (behind && hp < POLICY.hp.hurt) {
    reasons.push(
      `Tabuleiro abaixo da mediana do lobby (${mine} vs ${median}) com HP ${hp}: subir um nível por vez.`,
    );
  } else if (
    gold !== null &&
    gold >= maxInterestGold() &&
    hp >= POLICY.hp.hurt
  ) {
    target = level + 2;
    reasons.push(
      `HP ${hp} e ${gold}g: economia sustenta mirar dois níveis acima.`,
    );
  } else if (ahead && hp >= POLICY.hp.comfortable) {
    target = level + 2;
    reasons.push(
      `Tabuleiro acima da mediana do lobby (${mine} vs ${median}) com HP ${hp}: dá para mirar mais alto.`,
    );
  } else
    reasons.push(
      `HP ${hp}${gold === null ? ", ouro não informado" : `, ${gold}g`}: próximo nível como meta.`,
    );
  if (rivals.length <= 3 && hp > POLICY.hp.low && target < level + 2) {
    target++;
    reasons.push(
      `Apenas ${rivals.length} rivais vivos: fim de jogo favorece tabuleiro maior.`,
    );
  }
  const clamped = Math.max(Math.max(level, 5), Math.min(10, target));
  if (clamped !== target)
    reasons.push(`Ajustado para o intervalo permitido (${clamped}).`);
  return { level: clamped, reasons };
}
