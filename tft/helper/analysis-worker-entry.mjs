// Lado da thread de análise (M10a, ver ARQUITETURA.md): recebe pedidos do servidor, roda o pipeline injetado e devolve
// o resultado JÁ SERIALIZADO como ArrayBuffer transferido (sem clone de objeto grande). O pipeline é um módulo:
//
//   export async function init(initData) -> state              (opcional; carrega catálogo, abre arquivos...)
//   export async function run({ id, payload, context, ctxRev, state, signal, lap }) -> string | object
//
// `context` é o objeto das partes estáticas enviadas por `setContext` (só chega quando muda); `payload` é pequeno;
// `signal.aborted` vira true se o servidor cancelou (cooperativo: o pipeline é síncrono em boa parte e não é
// interrompido no meio); `lap("nome")` marca uma etapa para as métricas; `sideband(valor)` entrega um dado pequeno
// e clonável ao lado do resultado (o servidor o lê sem reparsear a resposta). Devolver string = já é JSON.
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import {
  errorInfo,
  FROM_WORKER as OUT,
  TO_WORKER as IN,
} from "./analysis-protocol.mjs";

const encoder = new TextEncoder();
const round = (ms) => Math.round(ms * 10) / 10;

/** Buffer exato dos bytes (um `Uint8Array` pode ser uma fatia de um buffer maior, que não se transfere inteiro). */
function exactBuffer(bytes) {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Liga o pipeline a uma porta de mensagens. Separado do arranque da thread para o teste rodar o mesmo protocolo
 * no processo, com uma porta falsa (`on("message")`, `postMessage(msg, transfer)`).
 */
export function serveAnalysis({
  port,
  pipeline,
  init = null,
  now = () => performance.now(),
}) {
  const context = {};
  let ctxRev = 0;
  const cancelled = new Set();
  let chain = Promise.resolve(); // um pedido por vez, na ordem em que chegaram
  let state = null;
  const started = (async () => {
    state = (await pipeline.init?.(init)) ?? null;
  })();
  started.then(
    () => port.postMessage({ type: OUT.ready }),
    (error) =>
      port.postMessage({
        type: OUT.error,
        id: null,
        error: errorInfo(error),
      }),
  );

  async function handleRun(msg) {
    const { id } = msg;
    try {
      await started;
    } catch {
      return; // a falha de início já foi avisada; o servidor reinicia a thread
    }
    if (cancelled.delete(id))
      return void port.postMessage({ type: OUT.cancelled, id });
    const t0 = now();
    const stages = [];
    let last = t0;
    const lap = (name) => {
      const t = now();
      stages.push([name, round(t - last)]);
      last = t;
    };
    // Dado pequeno que o servidor precisa ler sem reparsear a resposta (entrada de `planState.track`, por exemplo).
    let sidebandValue = null;
    const sideband = (value) => {
      sidebandValue = value;
    };
    const signal = {
      get aborted() {
        return cancelled.has(id);
      },
    };
    try {
      const out = await pipeline.run({
        id,
        payload: msg.payload,
        context,
        ctxRev: msg.ctxRev ?? ctxRev,
        state,
        signal,
        lap,
        sideband,
      });
      const tSerialize = now();
      const text = typeof out === "string" ? out : JSON.stringify(out);
      const buffer = exactBuffer(encoder.encode(text));
      const t1 = now();
      stages.push(["serializar", round(t1 - tSerialize)]);
      // Cancelado enquanto rodava: o resultado é descartado aqui (os bytes nem saem da thread).
      if (cancelled.delete(id))
        return void port.postMessage({ type: OUT.cancelled, id });
      port.postMessage(
        {
          type: OUT.result,
          id,
          ctxRev: msg.ctxRev ?? ctxRev,
          bytes: buffer,
          sideband: sidebandValue,
          workerMs: round(t1 - t0),
          stages,
        },
        [buffer],
      );
    } catch (error) {
      if (cancelled.delete(id))
        return void port.postMessage({ type: OUT.cancelled, id });
      port.postMessage({ type: OUT.error, id, error: errorInfo(error) });
    }
  }

  port.on("message", (msg) => {
    switch (msg?.type) {
      case IN.context:
        Object.assign(context, msg.parts);
        ctxRev = msg.rev;
        break;
      case IN.run:
        chain = chain.then(() => handleRun(msg));
        break;
      case IN.cancel:
        cancelled.add(msg.id);
        break;
      case IN.shutdown:
        port.close?.();
        break;
    }
  });
}

// Arranque dentro de uma thread criada por `workerSpawner` (analysis-worker.mjs). Importar este módulo em outro lugar
// (testes, servidor) não faz nada.
if (parentPort && workerData?.analysisWorker === true) {
  const spec = String(workerData.pipeline);
  // "file:///..." passa direto; caminho do disco (inclusive "C:\...") vira URL.
  const pipeline = await import(
    /^[a-z][a-z0-9+.-]+:/i.test(spec) ? spec : pathToFileURL(spec).href
  );
  serveAnalysis({ port: parentPort, pipeline, init: workerData.init ?? null });
}
