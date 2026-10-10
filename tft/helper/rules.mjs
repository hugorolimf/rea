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
  // XP para passar ao próximo nível (Set 18): o XP mostrado no jogo é "atual/total", e o total diz o nível.
  xpToNext: { 1: 2, 2: 2, 3: 6, 4: 10, 5: 20, 6: 36, 7: 56, 8: 68, 9: 68 },
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

/**
 * Nível a partir do XP mostrado ("4/10" → 4): o total do XP é o que falta para o próximo nível. Totais repetidos
 * (2: nível 1 ou 2; 68: nível 8 ou 9) são resolvidos pelo nível conhecido mais próximo (`hint`); sem pista, o maior.
 * `prevXp` (a leitura anterior) detecta a subida dentro do empate: no mesmo nível o XP atual nunca cai, então o
 * mesmo total com XP menor e o total do nível seguinte igual significa que subiu ("60/68" → "4/68" com pista 8 → 9).
 */
export function levelFromXp(xp, hint = null, prevXp = null) {
  const cur = /^(\d+)\/(\d+)$/.exec(xp ?? "");
  const levels = levelsForXp(xp);
  if (!levels.length) return null;
  const total = Number(cur[2]);
  const prev = /^(\d+)\/(\d+)$/.exec(prevXp ?? "");
  if (
    hint != null &&
    prev &&
    prev[2] === cur[2] &&
    Number(cur[1]) < Number(prev[1]) &&
    GAME.xpToNext[hint + 1] === total
  )
    hint += 1;
  if (levels.length === 1 || hint == null) return levels.at(-1);
  return levels.reduce((best, lv) =>
    Math.abs(lv - hint) < Math.abs(best - hint) ? lv : best,
  );
}

/** Níveis possíveis para o XP mostrado ("4/10" → [4]; "5/2" e "0/2" → [1, 2]); vazio se o total não existe no jogo. */
export function levelsForXp(xp) {
  const total = Number(/^(\d+)\/(\d+)$/.exec(xp ?? "")?.[2]);
  if (!total) return [];
  return Object.entries(GAME.xpToNext)
    .filter(([, n]) => n === total)
    .map(([lv]) => Number(lv));
}

/**
 * Junta as duas leituras do HUD num nível: `ocr` (o número do nível) e `xp` ("atual/total", cujo total diz o nível).
 * Devolve `{ level, source, conflict, ambiguous }` com `source` em "ocr+xp" (as duas concordam), "ocr", "xp" (nível
 * inferido do total, sem leitura do número), "held" (conflito sem saída: mantém `held`) ou null.
 * Em conflito (o total de XP não existe para o nível lido) vale a leitura plausível: o nível só sobe, de 1 em 1 em
 * condições normais, então com `held` confiável ("trusted") só vale `held` até `held + 2`. Se as duas forem plausíveis,
 * vence o número lido (o OCR dele exige três cópias iguais; o do XP é uma leitura só). `ambiguous` marca o total
 * repetido (2, 68) resolvido apenas pela pista.
 */
export function reconcileLevel({
  ocr = null,
  xp = null,
  prevXp = null,
  held = null,
  trusted = true,
} = {}) {
  const candidates = levelsForXp(xp),
    inferred = candidates.length ? levelFromXp(xp, held, prevXp) : null,
    ambiguous = candidates.length > 1;
  if (ocr == null)
    return {
      level: inferred,
      source: inferred == null ? null : "xp",
      conflict: false,
      ambiguous,
    };
  if (!candidates.length)
    return { level: ocr, source: "ocr", conflict: false, ambiguous: false };
  if (candidates.includes(ocr))
    return { level: ocr, source: "ocr+xp", conflict: false, ambiguous };
  const plausible = (lv) =>
    !trusted || held == null || (lv >= held && lv <= held + 2);
  if (plausible(ocr))
    return { level: ocr, source: "ocr", conflict: true, ambiguous: false };
  if (inferred != null && plausible(inferred))
    return { level: inferred, source: "xp", conflict: true, ambiguous };
  return { level: held, source: "held", conflict: true, ambiguous: false };
}

/** "3-5" → número da rodada contando desde 1-1 (1-1 = 1); null se não for estágio-rodada. */
export function roundNumber(stage) {
  const m = /^(\d)-(\d)$/.exec(stage ?? "");
  if (!m) return null;
  const s = Number(m[1]),
    r = Number(m[2]);
  return s <= 1 ? r : GAME.stageOneRounds + (s - 2) * GAME.stageRounds + r;
}

/**
 * XP passivo mínimo ganho entre duas rodadas (depois de `from`, até `to` inclusive): GAME.passiveXp por rodada. Cota
 * inferior deliberada: ignora o estágio 1 e o carrossel, onde a regra não foi verificada. Compras de XP só somam.
 */
export function passiveXpBetween(from, to) {
  const a = roundNumber(from),
    b = roundNumber(to);
  if (a == null || b == null || b <= a) return 0;
  let rounds = 0;
  for (let n = a + 1; n <= b; n++) {
    if (n <= GAME.stageOneRounds) continue;
    const r = ((n - GAME.stageOneRounds - 1) % GAME.stageRounds) + 1;
    if (r !== GAME.carouselRound) rounds++;
  }
  return rounds * GAME.passiveXp;
}

/**
 * Menor nível possível em `stage` partindo de um nível conhecido (`from`: {level, xp "atual/total" ou null, stage}) e
 * contando só o XP passivo. Sem partida de referência, parte do nível 1 em 1-1. É derivado, nunca uma leitura: o
 * nível real é este ou maior (quem compra XP sobe mais rápido).
 */
export function levelFloor(stage, from = { level: 1, xp: null, stage: "1-1" }) {
  let level = from.level,
    cur = Number(/^(\d+)\//.exec(from.xp ?? "")?.[1] ?? 0),
    gain = passiveXpBetween(from.stage, stage);
  while (gain > 0) {
    const need = GAME.xpToNext[level];
    if (!need) break;
    const left = need - cur;
    if (gain >= left) {
      gain -= left;
      level += 1;
      cur = 0;
    } else {
      cur += gain;
      gain = 0;
    }
  }
  return level;
}
