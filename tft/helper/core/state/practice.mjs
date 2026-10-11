// Partida de treino/teste (sem rivais): quando a partida é só do jogador, o "fim" não pode ser deduzido de vida nem de
// colocação. Regra única: aqui se decide se o tabuleiro lido é de uma partida assim e como a vida do Hero entra na análise.
//
// Evidência (arquivos reais do usuário, ver FONTES-DE-DADOS.md): o modo "Caminhos da Origem" grava
// `queueType: "PVE_PUZZLE_TFT"`, `queueId: 1220`, UM só jogador em `statsBlock.players`, `health: -99` (ou 1 nas
// capturas antigas) e `ffaStanding: 1` desde o primeiro arquivo, com a partida ainda rodando. Numa partida normal a
// lista tem os 8 jogadores e a vida/colocação só viram definitivas quando alguém cai.

import { HP } from "../economy/tables.mjs";

/** Filas de treino/PVE conhecidas pelo id da fila do cliente (1220 = Caminhos da Origem). */
export const PRACTICE_QUEUE_IDS = new Set([1220]);

/**
 * Vida que a análise recebe do Hero numa partida de treino: não existe vida a perder (o arquivo traz -99 ou 1), então a
 * análise a vê cheia e não mostra pressão, "vida em risco" nem "partida encerrada" por um número que não é vida. O valor
 * lido continua em `practice.rawHealth` do estado.
 */
export const PRACTICE_HEALTH = HP.max;

/**
 * O tabuleiro lido é de uma partida de treino? Devolve o sinal que decidiu (ou `null`):
 * - `"forcado"`: o usuário ligou `TFT_PRACTICE=1` (`forced`), para o caso de a detecção falhar;
 * - `"fila"`: fila PVE (`queueType` começa com `PVE`) ou id de fila de treino conhecido;
 * - `"jogador-unico"`: o arquivo lista um só jogador (sem rivais).
 * `snapshot` é o corpo de TFTEoGStats.json; sem ele (nada lido) não há sinal.
 */
export function practiceSignal(snapshot, { forced = false } = {}) {
  if (forced) return "forcado";
  if (!snapshot) return null;
  const queueType = String(snapshot.queueType ?? "");
  if (
    /^PVE/i.test(queueType) ||
    PRACTICE_QUEUE_IDS.has(Number(snapshot.queueId))
  )
    return "fila";
  const players = snapshot.statsBlock?.players;
  if (Array.isArray(players) && players.length === 1) return "jogador-unico";
  return null;
}

/**
 * Descrição do modo para o corpo de /api/state: `{ active, signal, rawHealth }`. `rawHealth` é a vida que o arquivo
 * trouxe para o Hero (preservada); `heroId` identifica o Hero entre os jogadores.
 */
export function practiceOf(snapshot, heroId, options = {}) {
  const signal = practiceSignal(snapshot, options),
    hero = snapshot?.statsBlock?.players?.find(
      (p) => String(p.playerId) === String(heroId),
    );
  return {
    active: signal !== null,
    signal,
    rawHealth: signal !== null ? (hero?.health ?? null) : null,
  };
}

/**
 * Cópia do tabuleiro com a vida do Hero normalizada para a análise (`PRACTICE_HEALTH`). Fora do treino devolve o próprio
 * tabuleiro; não muta o que recebe.
 */
export function withPracticeHealth(snapshot, heroId, options = {}) {
  if (practiceSignal(snapshot, options) === null) return snapshot;
  return {
    ...snapshot,
    statsBlock: {
      ...snapshot.statsBlock,
      players: snapshot.statsBlock.players.map((p) =>
        String(p.playerId) === String(heroId)
          ? { ...p, health: PRACTICE_HEALTH }
          : p,
      ),
    },
  };
}
