// Para o servidor nunca parar (M10b): laços de acompanhamento que não morrem, batimento de cada fonte para GET /api/health
// e a resposta de uma requisição que falhou por dentro. Nada aqui conhece o jogo nem o servidor HTTP: o relógio, o log e as
// fontes entram por parâmetro.

/**
 * Cria o supervisor interno. `log(nível, texto)` registra; `now` é o relógio em ms.
 *  - `beat(nome, erro?)`: marca o fim de um ciclo da fonte (com ou sem erro);
 *  - `every(nome, ms, fn, { stuckMs })`: laço periódico que NUNCA morre. O erro de uma rodada (síncrono ou de promessa) vai
 *    para o log e a rodada seguinte roda no horário; uma rodada que ainda não terminou não é repetida por cima, e se passar
 *    de `stuckMs` sem terminar é abandonada (uma leitura que nunca responde não pode parar o acompanhamento);
 *  - `health()`: idade do último ciclo de cada fonte, para o /api/health.
 */
export function createSupervision({ log = () => {}, now = Date.now } = {}) {
  const pulses = new Map();
  const beat = (name, error = null) => {
    const before = pulses.get(name);
    pulses.set(name, {
      at: now(),
      ok: !error,
      error: error ? String(error?.message ?? error) : (before?.error ?? null),
      errorAt: error ? now() : (before?.errorAt ?? null),
    });
  };
  function every(name, ms, fn, { stuckMs = 120_000 } = {}) {
    let startedAt = 0;
    const timer = setInterval(async () => {
      if (startedAt && now() - startedAt < stuckMs) return;
      if (startedAt)
        log(
          "AVISO",
          `${name}: rodada anterior sem terminar há ${Math.round(stuckMs / 1000)} s; abandonada`,
        );
      const mine = (startedAt = now());
      try {
        await fn();
        beat(name);
      } catch (e) {
        beat(name, e);
        log("AVISO", `${name}: ${e?.stack ?? e?.message ?? e}`);
      } finally {
        if (startedAt === mine) startedAt = 0;
      }
    }, ms);
    timer.unref?.();
    return timer;
  }
  return {
    beat,
    every,
    health() {
      const at = now();
      return Object.fromEntries(
        [...pulses].map(([name, p]) => [
          name,
          {
            ageMs: Math.max(0, at - p.at),
            ok: p.ok,
            error: p.error,
            errorAgeMs: p.errorAt == null ? null : Math.max(0, at - p.errorAt),
          },
        ]),
      );
    },
  };
}

/**
 * Responde 500 a uma requisição que falhou por dentro (ou fecha a conexão, se a resposta já começou). Nunca lança: uma
 * escrita numa conexão que caiu não derruba o processo.
 */
export function failRequest(req, res, error, log = () => {}) {
  log("ERRO", `${req.method} ${req.url}: ${error?.stack ?? error}`);
  try {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Erro interno do servidor." }));
    } else res.destroy();
  } catch {}
}

/**
 * Atraso do event loop agora, em ms: um temporizador de 1 s que mede o quanto cada disparo atrasou. Devolve a função que lê o
 * último valor.
 */
export function loopLagProbe({ now = Date.now } = {}) {
  let last = now(),
    lag = 0;
  setInterval(() => {
    lag = Math.max(0, now() - last - 1000);
    last = now();
  }, 1000).unref();
  return () => lag;
}
