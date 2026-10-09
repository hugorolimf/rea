// Sequência de vitórias/derrotas inferida pelo HP entre rodadas: o arquivo do jogo não grava resultados.
// Cada leitura (estágio da tela + HP do arquivo) guarda o menor HP visto em cada rodada; uma rodada contra
// jogador foi derrota se o HP da rodada seguinte caiu. Uma rodada sem leitura interrompe a contagem.
import { isPvp } from "./economy.mjs";

const parse = (text) => {
  const m = /^(\d)-(\d)$/.exec(text ?? "");
  return m ? { stage: Number(m[1]), round: Number(m[2]) } : null;
};
// Posição absoluta da rodada (estágio 1 tem 4 rodadas; os demais, 7).
const index = ({ stage, round }) =>
  stage <= 1 ? round : 4 + (stage - 2) * 7 + round;

/** Acompanha a partida atual. `observe` recebe cada leitura; `current` devolve a sequência ou null. */
export function streakTracker() {
  let game = null;
  const seen = new Map(); // índice da rodada → { round, low }
  return {
    observe({ gameId, stage, hp }) {
      const round = typeof stage === "string" ? parse(stage) : stage;
      if (gameId == null || !round || !Number.isFinite(hp)) return;
      if (gameId !== game) {
        game = gameId;
        seen.clear();
      }
      const at = index(round),
        known = seen.get(at);
      if (known) known.low = Math.min(known.low, hp);
      else seen.set(at, { round, low: hp });
    },
    current() {
      const order = [...seen.keys()].sort((a, b) => a - b);
      let kind = null,
        length = 0;
      for (let j = order.length - 2; j >= 0; j--) {
        if (order[j + 1] !== order[j] + 1) break;
        const r = seen.get(order[j]);
        if (!isPvp(r.round)) continue;
        const result = seen.get(order[j + 1]).low < r.low ? "loss" : "win";
        if (kind && result !== kind) break;
        kind = result;
        length++;
      }
      return kind ? { kind, length, inferred: true } : null;
    },
  };
}
