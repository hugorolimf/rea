// Sequência de vitórias/derrotas inferida pelo HP entre rodadas: o arquivo do jogo não grava resultados.
// Cada leitura (estágio da tela + HP do arquivo) guarda o menor HP visto em cada rodada; uma rodada contra
// jogador foi derrota se o HP da rodada seguinte caiu. Uma rodada sem leitura interrompe a contagem.
import { POLICY, isPvp } from "./economy.mjs";
import { HP } from "./core/economy/tables.mjs";

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
  // Quedas de vida com o horário, independentes do estágio (o estágio pode não ser lido da tela).
  const hpLog = [];
  return {
    observe({ gameId, stage, hp, now = Date.now() }) {
      if (gameId == null || !Number.isFinite(hp)) return;
      if (gameId !== game) {
        game = gameId;
        seen.clear();
        hpLog.length = 0;
      }
      if (hp > 0 && hp <= HP.max && (!hpLog.length || hpLog.at(-1).hp !== hp))
        hpLog.push({ at: now, hp });
      const round = typeof stage === "string" ? parse(stage) : stage;
      if (!round) return;
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
    /**
     * Tendência da vida: queda média das últimas perdas (`samples` quedas) e quantas perdas houve na janela recente (~4 rodadas); os
     * tamanhos são `POLICY.trend.drops` e `POLICY.trend.windowMs`. Não depende do estágio lido da tela.
     */
    trend(now = Date.now()) {
      const drops = [];
      for (let i = 1; i < hpLog.length; i++)
        if (hpLog[i].hp < hpLog[i - 1].hp)
          drops.push({ at: hpLog[i].at, loss: hpLog[i - 1].hp - hpLog[i].hp });
      const last = drops.slice(-POLICY.trend.drops),
        W = POLICY.trend.windowMs,
        lastAt = drops.at(-1)?.at ?? null;
      return {
        avgLoss: last.length
          ? last.reduce((n, d) => n + d.loss, 0) / last.length
          : 0,
        // Quedas que entraram na média: com menos de `POLICY.trend.drops`, pressureOf não projeta (não é tendência).
        samples: last.length,
        // Perdas na janela que termina na ÚLTIMA queda (não no relógio): sem uma queda nova a contagem não cai sozinha
        // a cada leitura (a faixa não oscila com a vida parada); uma janela inteira sem queda (rodadas ganhas) zera.
        recentLosses:
          lastAt !== null && now - lastAt <= W
            ? drops.filter((d) => lastAt - d.at <= W).length
            : 0,
      };
    },
  };
}
