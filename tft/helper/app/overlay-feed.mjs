// Feed do overlay (janela transparente do HUD): guarda, só em memória, os últimos corpos que a interface web já recebeu
// de GET /api/state e de POST /api/recommend ao vivo, para o overlay lê-los por GET /api/overlay sem calcular nada, sem
// disparar nova análise e sem tocar o plano persistente. Não importa o servidor nem lê o disco; o relógio é injetável.

/**
 * Cria o feed. `now` é o relógio em ms (injetável em teste). Os corpos são guardados por referência e devolvidos como
 * estão: quem os grava não os altera depois (são as respostas já enviadas).
 */
export function createOverlayFeed({ now = Date.now } = {}) {
  let state = null,
    recommendation = null,
    stateSeq = 0,
    recSeq = 0;
  const age = (entry, at) =>
    entry && {
      at: entry.at,
      ageMs: Math.max(0, at - entry.at),
      body: entry.body,
    };
  return {
    /** Registra o corpo EXATO da última resposta 200 de GET /api/state e o devolve. */
    recordState(body) {
      state = { at: now(), body };
      stateSeq += 1;
      return body;
    },
    /** Registra o corpo EXATO da última resposta 200 de POST /api/recommend ao vivo (não de partida revista) e o devolve. */
    recordRecommendation(body) {
      recommendation = { at: now(), body };
      recSeq += 1;
      return body;
    },
    /**
     * Resposta de GET /api/overlay. `rev` (`${estado}.${recomendação}`, contadores crescentes) muda sempre que um dos
     * dois corpos muda; com `since` igual a `rev` a resposta é curta (`unchanged: true`, sem state nem recommendation).
     */
    snapshot({ since } = {}) {
      const at = now(),
        rev = `${stateSeq}.${recSeq}`;
      if (since != null && String(since) === rev)
        return { version: 1, now: at, rev, unchanged: true };
      return {
        version: 1,
        now: at,
        rev,
        state: age(state, at),
        recommendation: age(recommendation, at),
      };
    },
  };
}
