// Heurística de nível-alvo: usa apenas nível, HP, ouro e tabuleiros visíveis.
// Não conhece experiência acumulada, streak nem augments de economia.
// Os limiares de vida e de ouro são da política (core/economy): POLICY.hp.low/hurt/comfortable, o teto de juros e
// POLICY.targetLevel. O ouro e a vida que decidem o alvo são os DA RODADA (steadyTargetInputs, abaixo): o ouro passando
// de 49 para 50 e voltando durante a loja não alterna o alvo (e, com ele, o tamanho do tabuleiro planejado).
import { POLICY } from "./core/economy/policy.mjs";
import { maxInterestGold } from "./core/economy/gold.mjs";
const pressure = (p) =>
  (p.boardPieces ?? []).reduce(
    (n, u) =>
      n + (u.starLevel ?? 1) * (u.price ?? 1) + (u.itemNames?.length ?? 0) * 2,
    0,
  );
const finite = (x) => (Number.isFinite(x) ? x : null);

/**
 * Ouro e vida que decidem o nível-alvo, estáveis dentro da rodada. `prev` é a `memo` da chamada anterior (ou null).
 *  - Estágio-rodada lido: o MAIOR ouro e a MENOR vida lidos nesta rodada da partida. Na loja o ouro só sobe vendendo
 *    (ou com a renda chegando), então o alvo muda no máximo uma vez na rodada e nunca volta; gastar (rolar, comprar XP)
 *    não derruba o alvo no meio da rolagem. Na rodada seguinte vale o ouro de então: uma mudança real muda o alvo.
 *  - Sem estágio lido: histerese. Quem já estava no teto de juros continua nele até o ouro cair
 *    `POLICY.targetLevel.goldBand` g abaixo do teto.
 *  - Leitura ausente (null) não apaga o valor da rodada.
 * Devolve `{ gold, hp, memo }`; `gold`/`hp` null = não lidos (o alvo usa então a vida do snapshot).
 */
export function steadyTargetInputs(
  prev,
  { gameId = null, stage = null, gold = null, hp = null } = {},
) {
  const round =
    Number.isInteger(stage?.stage) && Number.isInteger(stage?.round)
      ? `${stage.stage}-${stage.round}`
      : null;
  const same = prev != null && prev.gameId === gameId && prev.round === round,
    g = finite(gold),
    h = finite(hp);
  let steadyGold = g,
    steadyHp = h;
  if (same && round !== null) {
    steadyGold =
      g === null || prev.gold === null
        ? (g ?? prev.gold)
        : Math.max(g, prev.gold);
    steadyHp =
      h === null || prev.hp === null ? (h ?? prev.hp) : Math.min(h, prev.hp);
  } else if (same) {
    const cap = maxInterestGold(),
      held = prev.gold;
    steadyGold =
      g === null
        ? held
        : g < cap &&
            held !== null &&
            held >= cap &&
            g >= cap - POLICY.targetLevel.goldBand
          ? held
          : g;
  }
  return {
    gold: steadyGold,
    hp: steadyHp,
    memo: { gameId, round, gold: steadyGold, hp: steadyHp },
  };
}

/** Memória por partida de `steadyTargetInputs` (o pipeline guarda uma por servidor; a partida nova recomeça). */
export function targetLevelTracker() {
  let memo = null;
  return {
    observe(reading) {
      const out = steadyTargetInputs(memo, reading);
      memo = out.memo;
      return { gold: out.gold, hp: out.hp };
    },
  };
}

/**
 * Nível-alvo sugerido. `gold` é o ouro que decide o alvo (o da rodada, de `steadyTargetInputs`, ou o lido); `hp`
 * (opcional) troca a vida do snapshot pela vida da rodada.
 */
export function suggestTargetLevel(
  snapshot,
  playerId,
  level,
  gold,
  { hp: steadyHp = null } = {},
) {
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
    hp = finite(steadyHp) ?? self.health,
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
    // A vida baixa não encolhe o plano: o nível-alvo é o tamanho do tabuleiro que o motor monta, e baixá-lo pela vida
    // (ou pelo ouro passar de um lado para o outro do teto de juros) trocava a comp inteira. A vida entra no prazo de
    // montagem (core/comps/reach.mjs) e no gasto (strategy.mjs: rolar e subir para estabilizar).
    reasons.push(
      `HP ${hp} baixo: o plano continua mirando o nível ${level + 1}; estabilize agora com upgrades do plano.`,
    );
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
  if (rivals.length <= 3 && hp > 0 && target < level + 2) {
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
