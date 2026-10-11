// Pipeline falso para os testes da thread de análise REAL (tests/analysis-worker.test.mjs). Contrato:
// analysis-worker-entry.mjs. Nada do motor: só ecoa, trava, sai ou lança conforme o `op` do pedido.
export function init(data) {
  return { tag: data?.tag ?? null, runs: 0 };
}

export async function run({ payload, context, ctxRev, state, lap, sideband }) {
  state.runs++;
  switch (payload.op) {
    case "echo":
      lap("eco");
      sideband({ n: payload.n });
      return {
        n: payload.n,
        runs: state.runs,
        tag: state.tag,
        mark: context.mark ?? null,
        ctxRev,
        filler: "x".repeat(payload.size ?? 0),
      };
    case "raw":
      return `{"raw":${JSON.stringify(payload.n)}}`;
    case "spin":
      // Laço síncrono sem fim: só o timeout (terminate) para a thread.
      while (Date.now() > 0) {
        /* ocupado */
      }
      return null;
    case "exit":
      process.exit(3);
      return null;
    case "throw":
      throw new Error("falha-de-teste");
    default:
      throw new Error(`op desconhecido: ${payload.op}`);
  }
}
