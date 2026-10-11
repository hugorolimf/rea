// Quem decide ONDE a análise pesada roda (M10b, ARQUITETURA.md): na thread de análise (padrão, o servidor continua
// respondendo HTTP/SSE enquanto ela calcula) ou, se a thread não estiver disponível, no processo principal, com o mesmo
// código (app/analysis-pipeline.mjs) e portanto o mesmo resultado.
//
// Política de falha (a análise nunca deixa de sair por causa da thread):
//   - erro DO PIPELINE na thread (entrada inválida, adversário não encontrado...): o mesmo erro, com a mesma mensagem,
//     sobe ao chamador. Rodar de novo no processo principal daria o mesmo erro;
//   - thread caída, que não iniciou, no limite de recriações ou fechada: a análise roda no processo principal e o
//     fato vai para o log (no máximo uma vez por minuto). Depois de `retryWorkerMs` a thread é religada;
//   - estouro do prazo (`timeout` da thread): a thread é recriada e o pedido falha com mensagem clara; NÃO se repete no
//     processo principal (uma análise que passou do prazo na thread bloquearia o servidor inteiro por mais tempo ainda).
//
// As cópias de meta que o servidor renova (`meta`, `metaComps`, `boardStats`, `augmentStats`) vão à thread só quando mudam
// (por identidade); os pedidos levam apenas a entrada da leitura.

import { createAnalysisWorker, workerSpawner } from "../analysis-worker.mjs";

/**
 * A thread de análise de produção: roda app/analysis-thread.mjs (carrega o catálogo e é a dona do cache de evidência) com fila
 * sem descarte (cada pedido recebe o resultado da própria entrada: decisões do usuário diferentes nunca se trocam). Os
 * eventos de queda, prazo e recriação vão ao log.
 */
export function threadWorker({
  root,
  evidenceFile,
  budgetMs,
  heroId,
  timeoutMs = 60_000,
  log = () => {},
}) {
  return createAnalysisWorker({
    spawn: workerSpawner({
      pipeline: new URL("./analysis-thread.mjs", import.meta.url),
      init: { root, evidenceFile, budgetMs, heroId },
    }),
    supersede: false,
    timeoutMs,
    startTimeoutMs: 45_000,
    onEvent: (e) => {
      if (["crash", "timeout", "restart", "failed"].includes(e.type)) {
        const { type, at: _at, ...rest } = e;
        log("AVISO", `thread de análise: ${type} ${JSON.stringify(rest)}`);
      }
    },
  });
}

const PARTS = ["meta", "metaComps", "boardStats", "augmentStats"];

/**
 * @param {object} config
 * @param {() => object} config.context      as cópias de meta de agora: `{ meta, metaComps, boardStats, augmentStats }`
 * @param {() => object} config.makePipeline cria o pipeline pesado do processo principal (só no primeiro uso)
 * @param {object|null} [config.worker]      `createAnalysisWorker(...)` com `supersede: false`, ou null (sem thread)
 * @param {(level: string, text: string) => void} [config.log]
 * @param {() => number} [config.now]
 * @param {number} [config.retryWorkerMs]    quanto esperar antes de religar a thread que chegou ao limite de recriações
 */
export function createAnalysisRunner({
  context,
  makePipeline,
  worker = null,
  log = () => {},
  now = Date.now,
  retryWorkerMs = 60_000,
}) {
  let inline = null;
  let sent = {}; // o que a thread já recebeu (identidade)
  let failedAt = null;
  const complained = new Map();
  const counters = {
    thread: 0,
    inline: 0,
    fallbacks: 0,
    errors: 0,
    timeouts: 0,
  };
  const complain = (text) => {
    if (now() - (complained.get(text) ?? -Infinity) < 60_000) return;
    complained.set(text, now());
    log("AVISO", text);
  };

  /** Envia à thread as cópias de meta que mudaram desde o último pedido. */
  function syncContext() {
    const current = context(),
      changed = {};
    for (const name of PARTS)
      if (current[name] !== sent[name]) changed[name] = current[name];
    if (Object.keys(changed).length) {
      worker.setContext(changed);
      sent = { ...sent, ...changed };
    }
  }

  function threadUsable() {
    if (!worker) return false;
    const { phase } = worker.stats();
    if (phase === "closed") return false;
    if (phase !== "failed") {
      failedAt = null;
      return true;
    }
    failedAt ??= now();
    if (now() - failedAt < retryWorkerMs) return false;
    failedAt = null;
    return worker.reset();
  }

  /** O erro de uma análise na thread, com a mensagem de sempre (a pilha da thread vai em `workerStack`). */
  function errorOf(info) {
    const error = new Error(info?.message ?? "Falha na análise.");
    if (info?.name && info.name !== "Error") error.name = info.name;
    if (info?.stack) error.workerStack = info.stack;
    return error;
  }

  async function runInline(payload, stages) {
    inline ??= makePipeline();
    counters.inline++;
    const out = await inline.compute(payload, context(), { lap: stages.lap });
    return { ...out, via: "inline" };
  }

  /**
   * Roda a análise pesada de `payload` (ver app/analysis-pipeline.mjs). Devolve `{ parts | bytes, track, notes, evidence,
   * via }`: `parts` (objeto, processo principal) ou `bytes` (JSON já serializado pela thread, sem `metadata`).
   * `stages`: o cronômetro de etapas (`lap`, `put`) do chamador.
   */
  async function run(payload, stages) {
    if (!threadUsable()) return runInline(payload, stages);
    let ticket;
    try {
      syncContext();
      ticket = worker.submit(payload);
    } catch (error) {
      counters.fallbacks++;
      complain(
        `thread de análise indisponível (${error.message}); a análise roda no processo principal`,
      );
      return runInline(payload, stages);
    }
    const out = await worker.resolve(ticket, { allowStale: false });
    switch (out.status) {
      case "ok": {
        counters.thread++;
        const side = out.result.sideband ?? {};
        stages.put("espera", out.metrics?.queueMs ?? 0);
        for (const [name, ms] of out.result.stages ?? []) stages.put(name, ms);
        stages.restart();
        return {
          bytes: out.result.bytes,
          track: side.track ?? null,
          notes: side.notes ?? "",
          evidence: side.evidence ?? "",
          via: "thread",
        };
      }
      case "error":
        // Payload que não se clona é defeito de montagem, não da entrada: segue no processo principal.
        if (out.error?.name === "DataCloneError") {
          counters.fallbacks++;
          complain(
            `entrada da análise não clonável (${out.error.message}); roda no processo principal`,
          );
          return runInline(payload, stages);
        }
        counters.errors++;
        throw errorOf(out.error);
      case "timeout":
        counters.timeouts++;
        throw new Error(
          `A análise passou de ${Math.round((out.timeoutMs ?? 0) / 1000)} s e foi interrompida; a próxima leitura tenta de novo.`,
        );
      default:
        counters.fallbacks++;
        complain(
          `thread de análise ${out.status}${out.reason ? ` (${out.reason})` : ""}; a análise roda no processo principal`,
        );
        return runInline(payload, stages);
    }
  }

  return {
    run,
    /** Cria a thread antes do primeiro pedido (aquece o pipeline). */
    start() {
      worker?.start();
    },
    /** Esquece o que a thread já recebeu: a próxima análise reenvia as cópias de meta. */
    resync() {
      sent = {};
    },
    /** Onde a análise roda agora e os contadores (para `/api/health`). */
    status() {
      const w = worker?.stats() ?? null;
      return {
        mode: threadUsable() ? "thread" : "inline",
        worker: w && {
          phase: w.phase,
          running: w.running,
          queued: w.queued,
          counters: w.counters,
          runMs: w.runMs,
          queueMs: w.queueMs,
        },
        ...counters,
      };
    },
    async close() {
      inline?.close?.();
      await worker?.close();
    },
  };
}
