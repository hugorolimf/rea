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

/** Níveis possíveis para o XP mostrado ("4/10" → [4]; "5/2" e "0/2" → [1, 2]); vazio se o total não existe no jogo. */
export function levelsForXp(xp) {
  const total = Number(/^(\d+)\/(\d+)$/.exec(xp ?? "")?.[2]);
  if (!total) return [];
  return Object.entries(XP.xpToNext)
    .filter(([, n]) => n === total)
    .map(([lv]) => Number(lv));
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
 * Nível de uma partida: o observado (GEP, já validado por `levelConsistent` na precedência) ou, sem ele, o piso derivado
 * do XP passivo. Devolve o estado já com `level`, `levelInfo` e `sources.level`. Puro: `memory` = `{ game, anchor }` (a
 * partida e o último nível observado `{ level, xp, stage }`); devolve a memória nova. `seen` é o estado mesclado
 * (arquivos do jogo + GEP, com o estágio do arquivo do jogo). Precedência (FONTES-DE-DADOS.md, "Nível"): nível observado
 * > piso derivado (a partir do último observado nesta partida, ou do nível 1 em 1-1) > (fora daqui) estimativa pelo
 * tabuleiro. O piso é "o real é este ou maior" (`levelInfo.minimum`); sem estágio nem observação, nível desconhecido.
 */
export function reduceLevel(memory, seen, gameId = null) {
  let anchor = gameId !== memory.game ? null : memory.anchor;
  const stage = /^\d-\d$/.test(seen.stage ?? "") ? seen.stage : null,
    read = Number.isInteger(seen.level) ? seen.level : null,
    // Piso global: o que o XP passivo garante a quem nunca comprou XP. Só vale a partir do estágio 2.
    globalFloor = stage && Number(stage[0]) >= 2 ? levelFloor(stage) : null;
  let level = null,
    source = null;
  if (read !== null) {
    level = read;
    source = seen.sources?.level ?? null;
    anchor = {
      level,
      xp: levelsForXp(seen.xp).includes(read) ? seen.xp : null,
      stage,
    };
  } else {
    // Sem nível observado agora: o maior piso conhecido (o nível só sobe; quem compra XP sobe mais rápido).
    const floors = [];
    if (anchor && stage) floors.push(levelFloor(stage, anchor));
    if (globalFloor !== null) floors.push(globalFloor);
    if (floors.length) {
      level = Math.max(...floors);
      source = "derived";
    }
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
      sources: { ...sources, xp: xp === null ? null : (sources.xp ?? null) },
      levelInfo: { source, minimum: source === "derived", read },
    },
  };
}
