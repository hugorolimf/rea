// Nível, XP e rodada: a tabela do jogo e as regras que o estado usa para saber em que nível o jogador está.
// ESM puro (sem imports de fora de core/, sem tempo implícito). `rules.mjs` reexporta estas funções e monta `GAME` com
// a tabela daqui; `level.mjs` (raiz) é só a memória por partida em volta de `reduceLevel`.
import { parseStage } from "./clock.mjs";

/** Tabela de XP e de rodadas do Set 18. `GAME` (rules.mjs) usa os mesmos objetos: mudar aqui muda em todos os lugares. */
export const XP = {
  passiveXp: 2,
  // XP para passar ao próximo nível: o XP mostrado no jogo é "atual/total", e o total diz o nível.
  xpToNext: { 1: 2, 2: 2, 3: 6, 4: 10, 5: 20, 6: 36, 7: 56, 8: 68, 9: 68 },
  // Estágio 1 tem 4 rodadas; os demais têm 7, com carrossel na 4ª e monstros na 7ª.
  stageOneRounds: 4,
  stageRounds: 7,
  carouselRound: 4,
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
    XP.xpToNext[hint + 1] === total
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
  return Object.entries(XP.xpToNext)
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
  const at = parseStage(stage);
  if (!at) return null;
  const { stage: s, round: r } = at;
  return s <= 1 ? r : XP.stageOneRounds + (s - 2) * XP.stageRounds + r;
}

/**
 * XP passivo mínimo ganho entre duas rodadas (depois de `from`, até `to` inclusive): XP.passiveXp por rodada. Cota
 * inferior deliberada: ignora o estágio 1 e o carrossel, onde a regra não foi verificada. Compras de XP só somam.
 */
export function passiveXpBetween(from, to) {
  const a = roundNumber(from),
    b = roundNumber(to);
  if (a == null || b == null || b <= a) return 0;
  let rounds = 0;
  for (let n = a + 1; n <= b; n++) {
    if (n <= XP.stageOneRounds) continue;
    const r = ((n - XP.stageOneRounds - 1) % XP.stageRounds) + 1;
    if (r !== XP.carouselRound) rounds++;
  }
  return rounds * XP.passiveXp;
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
    const need = XP.xpToNext[level];
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

/**
 * Um nível dito pela fonte observada (GEP) é consistente quando: é um inteiro de 1 a 11; não cai abaixo do maior nível
 * já aceito nesta partida (`held`: o nível nunca cai); não fica abaixo do piso que o XP passivo garante no estágio; e o
 * total do XP lido junto (se vier) é de um nível que o inclui. Inconsistente = a fonte não vale para este campo agora.
 */
export function levelConsistent({
  level,
  xp = null,
  stage = null,
  held = null,
}) {
  if (!Number.isInteger(level) || level < 1 || level > 11) return false;
  if (held != null && level < held) return false;
  if (/^\d-\d$/.test(stage ?? "") && Number(stage[0]) >= 2)
    if (level < levelFloor(stage)) return false;
  const possible = levelsForXp(xp);
  return !possible.length || possible.includes(level);
}

/**
 * Valida a leitura de nível de uma partida e devolve o estado já com `level`, `levelInfo` e `sources.level`. Puro:
 * `memory` = `{ game, anchor }` (a partida e o último nível confirmado `{ level, xp, stage }`); devolve a memória nova.
 * `seen` é o estado mesclado (tela + arquivo do jogo, com `stage` do arquivo do jogo). Precedência (FONTES-DE-DADOS.md,
 * "Nível"): leitura fresca e plausível > piso derivado do XP passivo > (fora daqui) estimativa pelo tabuleiro. Uma
 * leitura só é descartada se não for corroborada pelo total do XP lido junto: abaixo do que o XP passivo garante no
 * estágio-rodada, ou abaixo do último nível confirmado.
 */
export function reduceLevel(memory, seen, gameId = null) {
  let anchor = gameId !== memory.game ? null : memory.anchor;
  const stage = /^\d-\d$/.test(seen.stage ?? "") ? seen.stage : null,
    read = Number.isInteger(seen.level) ? seen.level : null,
    stale = seen.stale?.level === true,
    corroborated = read !== null && levelsForXp(seen.xp).includes(read),
    // Piso global: o que o XP passivo garante a quem nunca comprou XP. Só vale a partir do estágio 2.
    globalFloor = stage && Number(stage[0]) >= 2 ? levelFloor(stage) : null;
  let level = null,
    source = null,
    rejected = null;
  if (read !== null && !stale) {
    if (!corroborated && globalFloor !== null && read < globalFloor)
      rejected = {
        read,
        reason: `abaixo do mínimo ${globalFloor} garantido em ${stage}`,
      };
    else if (!corroborated && anchor && read < anchor.level)
      rejected = {
        read,
        reason: `abaixo do último nível confirmado (${anchor.level})`,
      };
    else {
      level = read;
      source = "screen";
      anchor = { level, xp: corroborated ? seen.xp : null, stage };
    }
  }
  if (level === null) {
    // Sem leitura aproveitável: o maior piso conhecido. A leitura velha também é piso (o nível só sobe).
    const floors = [];
    if (anchor && stage)
      floors.push({ level: levelFloor(stage, anchor), source: "derived" });
    if (globalFloor !== null)
      floors.push({ level: globalFloor, source: "derived" });
    if (read !== null && stale && !rejected)
      floors.push({ level: read, source: "screen" });
    const best = floors.sort((a, b) => b.level - a.level)[0];
    if (best) ({ level, source } = best);
  }
  const sources = { ...seen.sources, level: source },
    // XP de outro nível não pode desenhar a barra do nível mostrado.
    xp =
      seen.xp && level !== null && !levelsForXp(seen.xp).includes(level)
        ? null
        : (seen.xp ?? null);
  return {
    memory: { game: gameId, anchor },
    seen: {
      ...seen,
      level,
      xp,
      stale: { ...seen.stale, level: source === "screen" ? stale : false },
      sources: { ...sources, xp: xp === null ? null : sources.xp },
      levelInfo: {
        source,
        minimum: source === "derived",
        stale: source === "screen" && stale,
        rejected,
        conflict: seen.levelConflict === true,
        ambiguous: seen.levelAmbiguous === true,
        read,
      },
    },
  };
}
