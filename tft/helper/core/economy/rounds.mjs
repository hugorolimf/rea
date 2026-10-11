// Calendário de rodadas que a economia usa para projetar o ouro: a rodada seguinte, o rótulo "S-R" e se a rodada é contra
// jogador (as únicas que contam para sequência). ESM puro. A tabela de rodadas é de `core/state/level.mjs` (XP).
import { XP } from "../state/level.mjs";
import { ROUND } from "./tables.mjs";

const roundsIn = (stage) => (stage === 1 ? XP.stageOneRounds : XP.stageRounds);

/** Rodada seguinte a `{stage, round}`. */
export const nextRound = ({ stage, round }) =>
  round >= roundsIn(stage)
    ? { stage: stage + 1, round: 1 }
    : { stage, round: round + 1 };

/** Rodada contra jogador (as únicas que contam para sequência). */
export const isPvp = ({ stage, round }) =>
  stage >= 2 && round !== XP.carouselRound && round !== ROUND.pve;

export const roundLabel = (r) => `${r.stage}-${r.round}`;
