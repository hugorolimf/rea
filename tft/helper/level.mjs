// Nível do jogador exposto à análise e à interface: o observado pelo GEP (validado contra o que o jogo permite naquele
// estágio-rodada) ou, sem ele, um piso derivado do XP passivo a partir do último nível observado.
// Precedência (ver FONTES-DE-DADOS.md, "Nível"): nível observado > piso derivado do XP passivo > estimativa pelo
// tabuleiro (feita fora daqui, sempre marcada "estimado"). Nunca se inventa nível a partir do tabuleiro.
// A regra mora em core/state/level.mjs (`reduceLevel`, pura); aqui fica só a memória por partida.
import { reduceLevel } from "./core/state/level.mjs";

/**
 * Cria o rastreador de nível de uma partida. `apply(seen, gameId)` recebe o estado já mesclado (arquivos do jogo + GEP,
 * com `stage` do arquivo do jogo) e o devolve com:
 *  - `level`: o nível observado, ou o piso derivado, ou null;
 *  - `sources.level`: a origem do observado ("gep"), "derived" (piso: o nível real é este ou maior) ou null;
 *  - `levelInfo`: `{ source, minimum, read }`, com o nível observado agora em `read` (null sem observação).
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
