// Camada de estado do servidor: chama as fontes (arquivos do jogo e GEP) e monta O estado da partida, com um só valor por
// campo. É a única que guarda memória entre leituras (último nível observado, fonte ativa de cada campo, contadores de
// divergência); as regras moram em core/state/. O servidor lê ouro, nível, XP, estágio, loja e itens daqui e o cliente
// só manda decisões do usuário (ver core/state/inputs.mjs). Não há leitura de tela: o que o GEP não informa fica
// desconhecido, com o motivo em `noSource`.
import { gameFilesState } from "../game-log.mjs";
import { holdPickedAugments, mergeGep, noSourceOf } from "../gep-reader.mjs";
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
 * Cria o montador de estado. Fontes: `gameFiles.status(gameId)` e `gep.status(ctx)`. `now` é o relógio (injetável em
 * teste); `onDivergence(evento)` recebe cada divergência GEP x arquivo do jogo (o servidor grava no log); `readings` é o
 * número de leituras seguidas da histerese.
 */
export function createStateHub({
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
     * Estado visto agora para a partida `gameId`: arquivos do jogo (estágio e fase) e, por cima, o GEP nos campos em que
     * ele vale (fresco e consistente, com histerese no estágio); depois o nível (observado ou piso derivado). O formato
     * é o de sempre (`gold`, `level`, `sources`, `noSource`...); `gameState(seen)` dá a mesma coisa normalizada.
     * `gepCtx` null = sem GEP nesta chamada.
     */
    seen(gameId, gepCtx = null) {
      const base = gameFilesState(gameFiles.status(gameId)),
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
      const merged = mergeGep(
          base,
          gepNow,
          (name) => name === "bench" || step.picks[name] === "gep",
        ),
        // Nível: o do GEP (já validado na precedência) ou o piso derivado do último observado; o motivo de um campo
        // sem valor é recalculado depois dele (o piso é um valor, marcado "derived").
        leveled = levels.apply(merged, gameId),
        // Aprimoramentos escolhidos são cumulativos na partida: um silêncio do GEP não os apaga (só a partida nova).
        held = holdPickedAugments(
          picked,
          { ...leveled, noSource: noSourceOf(leveled, gepNow) },
          gameId,
        );
      picked = held.memory;
      return held.seen;
    },
    /** `GameState` do estado visto (campos com valor, fonte, confiança e idade), resumido para o /api/state. */
    gameState: (seen, gameId = null) =>
      summarizeState(buildGameState(seen, { now: now(), gameId })),
    /** Contadores de divergência GEP x arquivo do jogo. */
    divergence: () => ({ ...divergence }),
  };
}
