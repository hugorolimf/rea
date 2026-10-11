// Nível do jogador exposto à análise e à interface: a leitura do HUD (screen-reader.mjs) validada contra o que o
// jogo permite naquele estágio-rodada, com um piso derivado quando a leitura falta ou está velha.
// Precedência (ver FONTES-DE-DADOS.md, "Nível"): leitura fresca e plausível > piso derivado do XP passivo >
// estimativa pelo tabuleiro (feita fora daqui, sempre marcada "estimado"). Nunca se inventa nível a partir do tabuleiro.
// A regra mora em core/state/level.mjs (`reduceLevel`, pura); aqui fica só a memória por partida.
import { reduceLevel } from "./core/state/level.mjs";

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
  const fresh = () => ({ game: null, anchor: null });
  let memory = fresh();
  return {
    reset() {
      memory = fresh();
    },
    apply(seen, gameId = null) {
      const out = reduceLevel(memory, seen, gameId);
      memory = out.memory;
      return out.seen;
    },
  };
}
