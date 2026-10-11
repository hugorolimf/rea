// Análise fora do event loop (M10a da migração, ver ARQUITETURA.md, seção "M10a"). Este módulo vive no servidor e
// conversa com uma thread (`worker_threads`) que roda o pipeline pesado. Nada aqui conhece o motor: o pipeline é um
// módulo injetado (contrato em analysis-worker-entry.mjs) e a thread é criada por uma função `spawn` (padrão:
// `workerSpawner`), então os testes usam um pipeline falso e até uma thread falsa.
//
// Regras:
//  - Um pedido ativo por vez; no máximo UM esperando. Chegou outro enquanto um roda e outro espera: o que esperava é
//    substituído (`superseded`) e só o mais recente roda depois (coalescência).
//  - O pedido em execução nunca é interrompido por um mais novo (análise síncrona não se interrompe); só por
//    `timeout`, `cancel({ kill })` ou queda da thread. A thread é recriada, com o contexto reenviado.
//  - O resultado é JSON já serializado (ArrayBuffer transferido). `latest` só avança (nunca volta para uma revisão
//    menor); resultado de thread antiga, de pedido cancelado ou depois de timeout é descartado.
//  - Resposta imediata: um pedido pode ser respondido com a última base se ela está no máximo `maxBaseAge` (1)
//    leituras atrás, marcada (`stale`, `ageMs`, `baseAge`) e com o mesmo contexto estático. A atualização sai por SSE.
//  - Nada lança por falha de análise: cada pedido termina num `outcome` com `status`.
import path from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_MAX_BASE_AGE,
  errorInfo,
  FROM_WORKER as FROM,
  freshness,
  markBase,
  summarize,
  TO_WORKER as TO,
} from "./analysis-protocol.mjs";

const ENTRY = new URL("./analysis-worker-entry.mjs", import.meta.url);
const RING = 64; // quantos tempos recentes as métricas guardam
const round = (ms) => Math.round(ms * 10) / 10;
const remember = (list, value) => {
  list.push(value);
  if (list.length > RING) list.shift();
};

/**
 * Cria a função `spawn` padrão: uma thread real rodando analysis-worker-entry.mjs com o pipeline indicado
 * (caminho ou URL de um módulo ESM) e `init` (dados clonáveis e pequenos entregues a `pipeline.init`).
 */
export function workerSpawner({
  pipeline,
  init = null,
  entry = ENTRY,
  resourceLimits,
  unref = false,
}) {
  const spec =
    pipeline instanceof URL
      ? pipeline.href
      : /^file:/i.test(pipeline)
        ? pipeline
        : pathToFileURL(path.resolve(pipeline)).href;
  return () => {
    const thread = new Worker(entry, {
      workerData: { analysisWorker: true, pipeline: spec, init },
      resourceLimits,
    });
    if (unref) thread.unref();
    return thread;
  };
}

/**
 * @param {object} config
 * @param {() => WorkerLike} config.spawn  cria a thread: `postMessage(msg, transfer?)`, `on("message"|"error"|"exit")`, `terminate()`
 * @param {number} [config.timeoutMs]      limite de execução de um pedido (a thread é recriada ao estourar)
 * @param {number} [config.startTimeoutMs] limite para a thread avisar `ready`
 * @param {number} [config.maxBaseAge]     defasagem máxima (em leituras) da resposta imediata; padrão 1
 * @param {number} [config.maxRestarts]    recriações permitidas dentro de `restartWindowMs`; acima disso: `failed`
 * @param {number} [config.restartDelayMs] espera antes de recriar (dobra a cada recriação seguida, máx. 5 s)
 * @param {() => number} [config.now]      relógio em ms (monotônico); injetável nos testes
 * @param {(event: object) => void} [config.onEvent]  gancho de log/diagnóstico (nunca pode lançar para dentro daqui)
 * @param {(result: object) => void} [config.onLatest]  chamado a cada base nova (revisão maior que a anterior), na ordem
 */
export function createAnalysisWorker(config) {
  const {
    spawn,
    timeoutMs = 20_000,
    startTimeoutMs = 15_000,
    maxBaseAge: defaultMaxBaseAge = DEFAULT_MAX_BASE_AGE,
    maxRestarts = 5,
    restartWindowMs = 60_000,
    restartDelayMs = 250,
    now = () => performance.now(),
    onEvent = () => {},
    onLatest = () => {},
  } = config ?? {};
  if (typeof spawn !== "function")
    throw new TypeError("createAnalysisWorker: `spawn` é obrigatório.");

  let phase = "idle"; // idle | starting | ready | restarting | failed | closed
  let thread = null;
  let genCounter = 0;
  let liveGen = -1; // geração da thread atual; mensagens de outra geração são descartadas
  let startTimer = null;
  let restartTimer = null;
  const restartTimes = [];

  let ctxRev = 0;
  const contextParts = {}; // reenviado inteiro quando a thread é recriada

  let seq = 0; // revisão: id do pedido
  let reading = 0; // leitura: cresce quando a chave de entrada muda
  let lastKey = null;
  let running = null; // { ticket, gen, timer }
  let waiting = null;
  let latest = null; // { rev, reading, key, bytes, completedAt, ctxRev, workerMs, stages }
  const open = new Set(); // pedidos cuja resposta imediata (`usable`) ainda não saiu
  const counters = {
    submitted: 0,
    completed: 0,
    superseded: 0,
    cancelled: 0,
    timeouts: 0,
    crashes: 0,
    errors: 0,
    restarts: 0,
    cached: 0,
    joined: 0,
    discardedLate: 0,
    unavailable: 0,
  };
  const rings = { queueMs: [], runMs: [], workerMs: [], totalMs: [] };

  const emit = (type, data = {}) => {
    try {
      onEvent({ type, at: now(), ...data });
    } catch {}
  };

  /* ---------- pedidos ---------- */

  function makeTicket(payload, key, maxAge) {
    const ticket = {
      id: ++seq,
      reading,
      key,
      payload,
      maxBaseAge: maxAge,
      submittedAt: now(),
      dispatchedAt: null,
      status: "queued", // queued | running | <status final>
      settled: false,
      usableSettled: false,
    };
    ticket.done = new Promise((resolve) => (ticket.resolveDone = resolve));
    ticket.usable = new Promise((resolve) => (ticket.resolveUsable = resolve));
    return ticket;
  }

  const outcome = (ticket, status, extra = {}) => ({
    status,
    id: ticket.id,
    reading: ticket.reading,
    key: ticket.key,
    ...extra,
  });

  function settleUsable(ticket, out) {
    if (ticket.usableSettled) return;
    ticket.usableSettled = true;
    open.delete(ticket);
    ticket.resolveUsable(out);
  }

  /** Termina o pedido (uma vez só): `done` com o desfecho; `usable` também, se ainda estava aberto. */
  function settle(ticket, out) {
    if (ticket.settled) return;
    ticket.settled = true;
    ticket.status = out.status;
    ticket.payload = null;
    ticket.resolveDone(out);
    settleUsable(ticket, out);
  }

  /** Se a última base serve de resposta imediata a este pedido (defasagem e contexto), libera o `usable`. */
  function offerLatest(ticket) {
    if (ticket.usableSettled || !latest || latest.ctxRev !== ctxRev) return;
    const info = freshness({
      readingNow: ticket.reading,
      base: latest,
      now: now(),
      maxBaseAge: ticket.maxBaseAge,
    });
    if (!info.acceptable) return;
    settleUsable(
      ticket,
      outcome(ticket, "ok", {
        result: latest,
        stale: info.stale,
        source: info.stale ? "previous" : "own",
        base: info,
      }),
    );
  }

  /**
   * Entrega um pedido. `payload` tem de ser pequeno e clonável (o estado pesado vai por `setContext`).
   * `key`: chave da análise (core/state/analysis-key.mjs); a mesma chave seguida não conta como nova leitura e
   * reaproveita o resultado guardado ou o pedido em execução. Sem chave, cada pedido é uma leitura nova.
   * Devolve o pedido: `{ id, reading, key, done, usable }` (promessas de `outcome`; nunca rejeitam).
   */
  function submit(
    payload,
    { key = null, maxBaseAge = defaultMaxBaseAge } = {},
  ) {
    counters.submitted++;
    if (phase === "closed" || phase === "failed") {
      const dead = makeTicket(null, key, maxBaseAge);
      counters.unavailable++;
      settle(
        dead,
        outcome(dead, phase === "closed" ? "closed" : "unavailable", {
          reason: phase,
        }),
      );
      return dead;
    }
    const sameKey = key !== null && key === lastKey;
    if (!sameKey) reading++;
    lastKey = key;
    const ticket = makeTicket(payload, key, maxBaseAge);
    // Mesma entrada do último resultado: nada a rodar.
    if (
      sameKey &&
      latest &&
      latest.reading === ticket.reading &&
      latest.key === key &&
      latest.ctxRev === ctxRev
    ) {
      counters.cached++;
      settle(
        ticket,
        outcome(ticket, "ok", {
          result: latest,
          stale: false,
          source: "own",
          cached: true,
          base: freshness({
            readingNow: ticket.reading,
            base: latest,
            now: now(),
            maxBaseAge,
          }),
        }),
      );
      return ticket;
    }
    // Mesma entrada do pedido em execução: espera o mesmo resultado.
    if (
      sameKey &&
      running &&
      !running.ticket.settled &&
      running.ticket.reading === ticket.reading
    ) {
      counters.joined++;
      ticket.status = "joined";
      open.add(ticket);
      offerLatest(ticket);
      running.ticket.done.then((out) =>
        settle(ticket, { ...out, id: ticket.id, joined: true }),
      );
      return ticket;
    }
    open.add(ticket);
    offerLatest(ticket);
    if (waiting) {
      const old = waiting;
      counters.superseded++;
      settle(old, outcome(old, "superseded", { successor: ticket }));
      emit("superseded", { id: old.id, by: ticket.id });
    }
    waiting = ticket;
    ensureWorker();
    pump();
    return ticket;
  }

  function pump() {
    if (phase === "ready" && !running && waiting) dispatch(waiting);
  }

  function dispatch(ticket) {
    waiting = null;
    const gen = liveGen;
    ticket.status = "running";
    ticket.dispatchedAt = now();
    const payload = ticket.payload;
    ticket.payload = null;
    running = {
      ticket,
      gen,
      timer: setTimeout(() => onTimeout(gen, ticket), timeoutMs),
    };
    try {
      thread.postMessage({ type: TO.run, id: ticket.id, ctxRev, payload });
    } catch (error) {
      // Payload que não se clona: o pedido falha, a thread continua boa.
      clearTimeout(running.timer);
      running = null;
      counters.errors++;
      settle(ticket, outcome(ticket, "error", { error: errorInfo(error) }));
      pump();
    }
  }

  /* ---------- mensagens da thread ---------- */

  function onMessage(gen, msg) {
    if (gen !== liveGen) {
      counters.discardedLate++;
      return;
    }
    switch (msg?.type) {
      case FROM.ready:
        if (phase !== "starting") return;
        phase = "ready";
        clearTimeout(startTimer);
        emit("ready");
        pump();
        break;
      case FROM.result:
        return onResult(msg);
      case FROM.error:
        return msg.id === null || msg.id === undefined
          ? down(gen, "init", msg.error)
          : onTaskError(msg);
      case FROM.cancelled:
        if (running?.ticket.id === msg.id) {
          clearTimeout(running.timer);
          running = null;
          pump();
        }
        break;
    }
  }

  function onResult(msg) {
    if (!running || running.ticket.id !== msg.id) {
      counters.discardedLate++;
      return;
    }
    const { ticket, timer } = running;
    clearTimeout(timer);
    running = null;
    if (ticket.settled) {
      // Cancelado enquanto rodava: o resultado é descartado.
      counters.discardedLate++;
      return pump();
    }
    const completedAt = now();
    const result = {
      rev: ticket.id,
      reading: ticket.reading,
      key: ticket.key,
      bytes: new Uint8Array(msg.bytes),
      completedAt,
      ctxRev: msg.ctxRev,
      workerMs: msg.workerMs ?? null,
      stages: msg.stages ?? [],
      sideband: msg.sideband ?? null,
    };
    // `latest` só avança: uma revisão menor nunca volta a ser a base.
    const advanced = !latest || result.rev > latest.rev;
    if (advanced) latest = result;
    const metrics = {
      queueMs: round(ticket.dispatchedAt - ticket.submittedAt),
      runMs: round(completedAt - ticket.dispatchedAt),
      workerMs: result.workerMs,
      totalMs: round(completedAt - ticket.submittedAt),
      stages: result.stages,
    };
    remember(rings.queueMs, metrics.queueMs);
    remember(rings.runMs, metrics.runMs);
    if (metrics.workerMs !== null) remember(rings.workerMs, metrics.workerMs);
    remember(rings.totalMs, metrics.totalMs);
    counters.completed++;
    settle(
      ticket,
      outcome(ticket, "ok", {
        result,
        stale: false,
        source: "own",
        // Chegou outra leitura enquanto este rodava: vale para quem pediu, mas já não é a mais nova.
        obsolete: reading > ticket.reading,
        ctxStale: result.ctxRev !== ctxRev,
        base: freshness({
          readingNow: ticket.reading,
          base: result,
          now: completedAt,
          maxBaseAge: ticket.maxBaseAge,
        }),
        metrics,
      }),
    );
    for (const other of [...open]) offerLatest(other);
    // Base nova: o servidor avisa as telas por SSE (`analysisEvent`), inclusive de pedidos que ninguém mais espera.
    if (advanced) {
      try {
        onLatest(result);
      } catch {}
    }
    emit("result", { id: ticket.id, ...metrics, bytes: result.bytes.length });
    pump();
  }

  function onTaskError(msg) {
    if (!running || running.ticket.id !== msg.id) {
      counters.discardedLate++;
      return;
    }
    const { ticket, timer } = running;
    clearTimeout(timer);
    running = null;
    counters.errors++;
    settle(ticket, outcome(ticket, "error", { error: msg.error }));
    emit("error", { id: ticket.id, error: msg.error });
    pump();
  }

  /* ---------- falhas: timeout, queda, recriação ---------- */

  function onTimeout(gen, ticket) {
    if (!running || running.ticket !== ticket || gen !== liveGen) return;
    counters.timeouts++;
    running = null;
    settle(
      ticket,
      outcome(ticket, "timeout", {
        timeoutMs,
        runMs: round(now() - ticket.dispatchedAt),
      }),
    );
    emit("timeout", { id: ticket.id, timeoutMs });
    recycle("timeout");
  }

  function down(gen, reason, error) {
    if (gen !== liveGen) return; // já tratada (error e exit chegam os dois)
    counters.crashes++;
    if (running) {
      const { ticket, timer } = running;
      clearTimeout(timer);
      running = null;
      settle(
        ticket,
        outcome(ticket, "crashed", { reason, error: errorInfo(error) }),
      );
    }
    emit("crash", { reason, error: error ? errorInfo(error) : null });
    recycle(reason);
  }

  /** Encerra a thread atual (se houver) e agenda a próxima; resultados dela que chegarem depois são descartados. */
  function recycle(reason) {
    const old = thread;
    thread = null;
    liveGen = -1;
    clearTimeout(startTimer);
    if (old) {
      try {
        Promise.resolve(old.terminate()).catch(() => {});
      } catch {}
    }
    scheduleRestart(reason);
  }

  function scheduleRestart(reason) {
    if (phase === "closed") return;
    const t = now();
    restartTimes.push(t);
    while (restartTimes.length && t - restartTimes[0] > restartWindowMs)
      restartTimes.shift();
    if (restartTimes.length > maxRestarts) return fail(reason);
    phase = "restarting";
    counters.restarts++;
    const delay = Math.min(
      5000,
      restartDelayMs * 2 ** (restartTimes.length - 1),
    );
    emit("restart", { reason, delayMs: delay, attempt: restartTimes.length });
    restartTimer = setTimeout(() => {
      restartTimer = null;
      spawnThread();
    }, delay);
  }

  function fail(reason) {
    phase = "failed";
    emit("failed", { reason, restarts: restartTimes.length });
    if (waiting) {
      const stuck = waiting;
      waiting = null;
      counters.unavailable++;
      settle(stuck, outcome(stuck, "unavailable", { reason: "restart-limit" }));
    }
  }

  function spawnThread() {
    if (phase === "closed" || thread) return;
    phase = "starting";
    const gen = ++genCounter;
    liveGen = gen;
    let fresh;
    try {
      fresh = spawn();
    } catch (error) {
      liveGen = -1;
      counters.crashes++;
      emit("crash", { reason: "spawn", error: errorInfo(error) });
      return scheduleRestart("spawn");
    }
    thread = fresh;
    fresh.on("message", (msg) => onMessage(gen, msg));
    fresh.on("error", (error) => down(gen, "error", error));
    fresh.on("exit", (code) =>
      down(gen, "exit", {
        message: `A thread de análise saiu (código ${code}).`,
      }),
    );
    startTimer = setTimeout(
      () =>
        down(gen, "start-timeout", {
          message: `A thread de análise não ficou pronta em ${startTimeoutMs} ms.`,
        }),
      startTimeoutMs,
    );
    try {
      fresh.postMessage({ type: TO.context, rev: ctxRev, parts: contextParts });
    } catch (error) {
      down(gen, "context", error);
    }
    emit("spawn", { gen });
  }

  function ensureWorker() {
    if (phase === "idle" && !thread && !restartTimer) spawnThread();
  }

  /* ---------- API ---------- */

  /**
   * Partes estáticas que o pipeline usa (catálogo, meta, estatísticas, evidência...). Enviadas à thread uma vez por
   * mudança e reenviadas inteiras se ela for recriada; os pedidos só levam o `ctxRev`. Mudou o contexto: a base
   * guardada deixa de servir de resposta imediata. Devolve a nova revisão do contexto.
   */
  function setContext(parts) {
    ctxRev++;
    Object.assign(contextParts, parts);
    if (thread && liveGen >= 0) {
      try {
        thread.postMessage({ type: TO.context, rev: ctxRev, parts });
      } catch (error) {
        down(liveGen, "context", error);
      }
    }
    return ctxRev;
  }

  /**
   * Cancela um pedido (objeto ou id). Esperando: sai da fila. Rodando: o resultado é descartado e o pedido termina
   * `cancelled` na hora; a thread só fica livre quando acabar (ou na hora, com `{ kill: true }`, que a recria).
   */
  function cancel(target, { kill = false } = {}) {
    const ticket =
      typeof target === "object"
        ? target
        : waiting?.id === target
          ? waiting
          : running?.ticket.id === target
            ? running.ticket
            : null;
    if (!ticket || ticket.settled) return false;
    counters.cancelled++;
    if (waiting === ticket) waiting = null;
    const isRunning = running?.ticket === ticket;
    settle(ticket, outcome(ticket, "cancelled"));
    if (isRunning) {
      if (kill) {
        clearTimeout(running.timer);
        running = null;
        recycle("cancel");
      } else {
        try {
          thread?.postMessage({ type: TO.cancel, id: ticket.id });
        } catch {}
      }
    }
    return true;
  }

  /**
   * Espera o desfecho de um pedido, seguindo os que o substituíram.
   * `allowStale` (padrão): responde assim que houver a própria análise OU uma base aceitável (≤ `maxBaseAge` leituras
   * atrás, mesmo contexto). `graceMs`: antes de aceitar a base antiga, espera até esse tempo pela própria análise.
   * `allowStale: false`: só a própria análise.
   */
  async function resolve(ticket, { allowStale = true, graceMs = 0 } = {}) {
    let current = ticket;
    for (;;) {
      let out;
      if (!allowStale) out = await current.done;
      else if (graceMs > 0) {
        let handle;
        const pause = new Promise((r) => (handle = setTimeout(r, graceMs)));
        const quick = await Promise.race([
          current.done,
          pause.then(() => null),
        ]);
        clearTimeout(handle);
        out = quick ?? (await current.usable);
      } else out = await current.usable;
      if (out.status !== "superseded") return out;
      current = out.successor;
    }
  }

  /** Bytes para responder com o campo `base` (`stale`, `ageMs`, `baseAge`...) calculado agora, mais o campo. */
  function responseBytes(out) {
    if (out?.status !== "ok")
      throw new TypeError("Só um desfecho `ok` tem resposta.");
    const base = freshness({
      readingNow: out.reading,
      base: out.result,
      now: now(),
      maxBaseAge: out.base?.maxBaseAge ?? defaultMaxBaseAge,
    });
    return { bytes: markBase(out.result.bytes, base), base };
  }

  function stats() {
    return {
      phase,
      reading,
      ctxRev,
      running: running?.ticket.id ?? null,
      waiting: waiting?.id ?? null,
      latest: latest
        ? {
            rev: latest.rev,
            reading: latest.reading,
            ageMs: Math.max(0, round(now() - latest.completedAt)),
            bytes: latest.bytes.length,
            ctxRev: latest.ctxRev,
          }
        : null,
      counters: { ...counters },
      queueMs: summarize(rings.queueMs),
      runMs: summarize(rings.runMs),
      workerMs: summarize(rings.workerMs),
      totalMs: summarize(rings.totalMs),
    };
  }

  /** Cria a thread antes do primeiro pedido (aquece o pipeline). */
  function start() {
    ensureWorker();
  }

  /** Sai do estado `failed` (limite de recriações) e tenta de novo. */
  function reset() {
    if (phase !== "failed") return false;
    restartTimes.length = 0;
    phase = "idle";
    ensureWorker();
    return true;
  }

  async function close() {
    if (phase === "closed") return;
    phase = "closed";
    clearTimeout(startTimer);
    clearTimeout(restartTimer);
    restartTimer = null;
    for (const ticket of [waiting, running?.ticket]) {
      if (ticket) settle(ticket, outcome(ticket, "closed"));
    }
    if (running) clearTimeout(running.timer);
    waiting = null;
    running = null;
    const old = thread;
    thread = null;
    liveGen = -1;
    if (old) {
      try {
        old.postMessage({ type: TO.shutdown });
      } catch {}
      try {
        await Promise.resolve(old.terminate());
      } catch {}
    }
  }

  return {
    submit,
    resolve,
    cancel,
    setContext,
    responseBytes,
    latest: () => latest,
    stats,
    start,
    reset,
    close,
  };
}
