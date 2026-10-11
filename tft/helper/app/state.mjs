// Camada de estado do servidor: chama as fontes (tela, arquivos do jogo, GEP) e monta O estado da partida, com um só
// valor por campo. É a única que guarda memória entre leituras (nível confirmado, fonte ativa de cada campo, contadores
// de divergência); as regras moram em core/state/. O servidor lê ouro, nível, XP, estágio, loja e itens daqui e o
// cliente só manda decisões do usuário (ver core/state/inputs.mjs).
import { mergeSources } from "../game-log.mjs";
import { mergeGep } from "../gep-reader.mjs";
import { levelTracker } from "../level.mjs";
import { buildGameState, summarizeState } from "../core/state/game-state.mjs";
import {
  HYSTERESIS_READINGS,
  initialPrecedence,
  reduceSources,
} from "../core/state/precedence.mjs";

/**
 * Cria o montador de estado. Fontes: `screen.status()`, `gameFiles.status(gameId)`, `gep.status(ctx)`. `now` é o
 * relógio (injetável em teste); `onDivergence(evento)` recebe cada divergência GEP x tela (o servidor grava no log);
 * `readings` é o número de leituras seguidas da histerese.
 */
export function createStateHub({
  screen,
  gameFiles,
  gep,
  levels = levelTracker(),
  now = Date.now,
  onDivergence = () => {},
  readings = HYSTERESIS_READINGS,
}) {
  let memory = initialPrecedence(),
    divergence = { total: 0, byField: {}, last: null, current: [], readings };
  return {
    /**
     * Estado visto agora para a partida `gameId`: leitura de tela + arquivos do jogo, nível validado, e por cima o GEP
     * nos campos em que ele vale (fresco e consistente, com histerese). O formato é o de sempre (`gold`, `level`,
     * `sources`...); `gameState(seen)` dá a mesma coisa normalizada. `gepCtx` null = sem GEP nesta chamada.
     */
    seen(gameId, gepCtx = null) {
      const base = levels.apply(
          mergeSources(screen.status(), gameFiles.status(gameId)),
          gameId,
        ),
        gepNow = gepCtx ? gep.status(gepCtx) : null,
        step = reduceSources(memory, {
          gameId,
          seen: base,
          gep: gepNow,
          readings,
        });
      memory = step.memory;
      divergence = step.divergence;
      for (const event of step.events) onDivergence(event);
      return mergeGep(
        base,
        gepNow,
        (name) => name === "bench" || step.picks[name] === "gep",
      );
    },
    /** `GameState` do estado visto (campos com valor, fonte, confiança e idade), resumido para o /api/state. */
    gameState: (seen, gameId = null) =>
      summarizeState(buildGameState(seen, { now: now(), gameId })),
    /** Contadores de divergência GEP x tela. */
    divergence: () => ({ ...divergence }),
  };
}
