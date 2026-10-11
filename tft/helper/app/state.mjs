// Camada de estado do servidor: chama as fontes (tela, arquivos do jogo, GEP) e monta O estado da partida, com um só
// valor por campo. É a única que guarda memória entre leituras (nível confirmado, fonte ativa de cada campo, contadores
// de divergência); as regras moram em core/state/. O servidor lê ouro, nível, XP, estágio, loja e itens daqui e o
// cliente só manda decisões do usuário (ver core/state/inputs.mjs).
import { mergeSources } from "../game-log.mjs";
import { holdPickedAugments, mergeGep } from "../gep-reader.mjs";
import { levelTracker } from "../level.mjs";
import { buildGameState, summarizeState } from "../core/state/game-state.mjs";
import {
  HYSTERESIS_READINGS,
  initialPrecedence,
  reduceSources,
} from "../core/state/precedence.mjs";

/**
 * Partida em andamento para a fonte GEP (`gep.status(ctx)`): id, fase do cliente, set e o jogador local do tabuleiro.
 * `heroId` é o jogador local; devolve `(metadata, snapshot) => ctx`.
 */
export const gepContextFor = (heroId) => (metadata, snapshot) => {
  const hero = snapshot?.statsBlock?.players?.find(
    (p) => String(p.playerId) === heroId,
  );
  return {
    gameId: metadata.gameId,
    inMatch:
      metadata.phase === "InProgress" || metadata.phase === "Reconnect"
        ? true
        : typeof metadata.phase === "string"
          ? false
          : null,
    set: Number(/\d+/.exec(metadata.set ?? "")?.[0]) || null,
    // Partida de treino: o `ended_at` do banco do TFTAcademy não a encerra enquanto o cliente a mostra em andamento.
    practice: metadata.practice?.active === true,
    local: hero
      ? {
          name: hero.riotIdGameName ?? hero.summonerName,
          tag: hero.riotIdTagLine,
        }
      : null,
  };
};

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
    divergence = { total: 0, byField: {}, last: null, current: [], readings },
    picked = null; // últimos aprimoramentos escolhidos vistos no GEP, por partida (holdPickedAugments)
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
      // Aprimoramentos escolhidos são cumulativos na partida: um silêncio do GEP não os apaga (só a partida nova).
      const held = holdPickedAugments(
        picked,
        mergeGep(
          base,
          gepNow,
          (name) => name === "bench" || step.picks[name] === "gep",
        ),
        gameId,
      );
      picked = held.memory;
      return held.seen;
    },
    /** `GameState` do estado visto (campos com valor, fonte, confiança e idade), resumido para o /api/state. */
    gameState: (seen, gameId = null) =>
      summarizeState(buildGameState(seen, { now: now(), gameId })),
    /** Contadores de divergência GEP x tela. */
    divergence: () => ({ ...divergence }),
  };
}
