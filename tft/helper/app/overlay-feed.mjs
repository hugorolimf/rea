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
    recSeq = 0,
    // Último quadro ao vivo (estado e recomendação gravados com a partida em andamento): o que o fim da partida congela
    // (app/live-snapshot.mjs). `inLive` diz se o último estado gravado era de partida em andamento; recomendação gravada
    // depois do fim não entra no quadro.
    liveState = null,
    liveRec = null,
    inLive = false;
  const isLive = (body) =>
    body?.match?.status === "live" && body.match.boardReady !== false;
  const liveRecord = (entry) => {
    if (inLive) liveRec = entry;
  };
  // `entry.raw`: o corpo já serializado (bytes JSON). A recomendação chega assim da thread de análise: guardar o texto evita
  // reparsear ~1 MB só para serializá-lo de novo a cada leitura do overlay.
  const bodyOf = (entry) => {
    if (entry.body !== undefined || !entry.raw) return entry.body;
    entry.parsed ??= JSON.parse(Buffer.from(entry.raw).toString("utf8"));
    return entry.parsed;
  };
  const age = (entry, at) =>
    entry && {
      at: entry.at,
      ageMs: Math.max(0, at - entry.at),
      body: bodyOf(entry),
    };
  return {
    /** Registra o corpo EXATO da última resposta 200 de GET /api/state e o devolve. */
    recordState(body) {
      state = { at: now(), body };
      stateSeq += 1;
      inLive = isLive(body);
      if (inLive) {
        // Partida diferente da do quadro guardado: a recomendação antiga não vale para ela.
        if (liveState && liveState.body.match?.id !== body.match?.id)
          liveRec = null;
        liveState = state;
      }
      return body;
    },
    /**
     * O último quadro gravado com a partida em andamento (`{ state: {at, body}, recommendation: {at, body} | null }`) ou
     * null. Não muda quando a partida encerra: é o que o servidor congela no fim.
     */
    liveFrame() {
      return liveState
        ? {
            state: liveState,
            recommendation: liveRec
              ? { at: liveRec.at, body: bodyOf(liveRec) ?? null }
              : null,
          }
        : null;
    },
    /** Registra o corpo EXATO da última resposta 200 de POST /api/recommend ao vivo (não de partida revista) e o devolve. */
    recordRecommendation(body) {
      recommendation = { at: now(), body };
      recSeq += 1;
      liveRecord(recommendation);
      return body;
    },
    /**
     * O corpo da última recomendação ao vivo guardada (ou null): o servidor o lê para derivar, sem nova análise. Guardada como
     * bytes (`recordRecommendationJson`), é aberta uma vez e lembrada; quem só serve o overlay nunca paga por isso.
     */
    recommendationBody() {
      return recommendation ? (bodyOf(recommendation) ?? null) : null;
    },
    /**
     * Registra o corpo da última resposta 200 de POST /api/recommend ao vivo JÁ SERIALIZADO (`Uint8Array` com o JSON). Vale o
     * mesmo que `recordRecommendation`; `snapshot()` o devolve parseado e `snapshotJson()` o usa como está.
     */
    recordRecommendationJson(raw) {
      recommendation = { at: now(), raw };
      recSeq += 1;
      liveRecord(recommendation);
      return raw;
    },
    /**
     * O mesmo conteúdo de `snapshot()` já serializado (`Buffer` com o JSON, na mesma ordem de chaves): a recomendação
     * guardada como bytes entra sem passar por `JSON.stringify`. É o que GET /api/overlay envia.
     */
    snapshotJson({ since } = {}) {
      const at = now(),
        rev = `${stateSeq}.${recSeq}`;
      if (since != null && String(since) === rev)
        return Buffer.from(
          JSON.stringify({ version: 1, now: at, rev, unchanged: true }),
        );
      const parts = [
        Buffer.from(
          `{"version":1,"now":${at},"rev":${JSON.stringify(rev)},"state":${JSON.stringify(age(state, at))},"recommendation":`,
        ),
      ];
      if (recommendation?.raw) {
        parts.push(
          Buffer.from(
            `{"at":${recommendation.at},"ageMs":${Math.max(0, at - recommendation.at)},"body":`,
          ),
          Buffer.from(recommendation.raw),
          Buffer.from("}"),
        );
      } else parts.push(Buffer.from(JSON.stringify(age(recommendation, at))));
      parts.push(Buffer.from("}"));
      return Buffer.concat(parts);
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
