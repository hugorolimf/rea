// Nível do jogador exposto à análise e à interface: a leitura do HUD (screen-reader.mjs) validada contra o que o
// jogo permite naquele estágio-rodada, com um piso derivado quando a leitura falta ou está velha.
// Precedência (ver FONTES-DE-DADOS.md, "Nível"): leitura fresca e plausível > piso derivado do XP passivo >
// estimativa pelo tabuleiro (feita fora daqui, sempre marcada "estimado"). Nunca se inventa nível a partir do tabuleiro.
import { levelFloor, levelsForXp } from "./rules.mjs";

/**
 * Cria o rastreador de nível de uma partida. `apply(seen, gameId)` recebe o estado já mesclado (leitor de tela +
 * arquivo do jogo, com `stage` do arquivo do jogo) e o devolve com:
 *  - `level`: nível lido, ou o piso derivado, ou null;
 *  - `sources.level`: "screen" (lido do HUD, mesmo que velho), "derived" (piso: o nível real é este ou maior) ou null;
 *  - `levelInfo`: `{ source, minimum, stale, rejected, conflict, ambiguous, read }`, com a leitura crua em `read` e o
 *    motivo em `rejected` quando uma leitura inverossímil foi descartada.
 * Uma leitura só é descartada se não for corroborada pelo total do XP lido junto: abaixo do que o XP passivo já
 * garante no estágio-rodada, ou abaixo do último nível confirmado (o nível nunca cai).
 */
export function levelTracker() {
  let game = null,
    anchor = null; // último nível confirmado: { level, xp, stage }
  return {
    reset() {
      game = null;
      anchor = null;
    },
    apply(seen, gameId = null) {
      if (gameId !== game) {
        game = gameId;
        anchor = null;
      }
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
      };
    },
  };
}
