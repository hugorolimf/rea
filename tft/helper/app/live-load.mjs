// Carga do servidor ao vivo (correção pontual de planos/feitos/lentidao-ao-vivo.md; a versão completa é o M10b).
// Quatro ferramentas pequenas, sem regra de jogo: ceder o event loop, ordenar as análises, limitar a espera de rede
// da evidência e medir o atraso do loop. O servidor (transporte) só as liga.
import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Cede a vez ao event loop (macrotarefa, não microtarefa): `/api/state`, SSE e timers entram entre duas etapas
 * síncronas de uma análise em vez de esperar a soma delas.
 */
export const yieldToLoop = () =>
  new Promise((resolve) => setImmediate(resolve));

/**
 * Fila FIFO de uma vaga só. Ceder o loop no meio do `POST /api/recommend` deixaria outro `POST` ultrapassar o primeiro
 * antes de `planState.track`/`streaks`; a vaga mantém a ordem de hoje (a em que as análises terminam a base).
 * `acquire()` resolve com `release()` (idempotente). `maxHoldMs` solta a vaga sozinha se alguém esquecer de liberar.
 */
export function turnLock({ maxHoldMs = 60_000 } = {}) {
  let tail = Promise.resolve();
  return async function acquire() {
    let release;
    const mine = new Promise((resolve) => (release = resolve)),
      before = tail;
    tail = before.then(() => mine);
    await before;
    const timer = setTimeout(release, maxHoldMs);
    timer.unref?.();
    return () => {
      clearTimeout(timer);
      release();
    };
  };
}

/** Contadores de uma base analisada: tempo em `analyze` (CPU), em espera de rede e quantas perguntas foram feitas. */
export function evidenceStats() {
  const s = {
    analyze: 0,
    net: 0,
    passes: 0,
    asks: 0,
    capped: 0,
    text: () =>
      `analise=${s.analyze.toFixed(0)} rede=${s.net.toFixed(0)} passes=${s.passes} perguntas=${s.asks} teto=${s.capped}`,
  };
  return s;
}

/**
 * Análise com evidência do explorer: roda `analyzeNow()`, pergunta o que falta (`ask(fresh)` busca em paralelo e
 * grava nos mapas do servidor) e refaz, no máximo `maxPasses` vezes. Mesma sequência de antes, com um teto de tempo:
 * passado `budgetMs` desde a primeira pergunta, a análise segue com o que já chegou. As perguntas abertas continuam
 * em andamento (o cliente do explorer as compartilha) e entram no cache para a leitura seguinte; como ainda há
 * perguntas, o chamador não guarda esta base. Com tudo já em cache o laço nem começa e nada muda.
 * `commit(fresh)` roda de forma síncrona logo após a última análise (ponto para guardar a base no cache).
 */
export async function settleEvidence({
  analyzeNow,
  ask,
  budgetMs,
  maxPasses = 3,
  stats = evidenceStats(),
  commit = null,
}) {
  const timed = () => {
    const t0 = performance.now(),
      out = analyzeNow();
    stats.analyze += performance.now() - t0;
    return out;
  };
  const pending = (f) =>
    f.conditionalRequests.length + f.evidenceRequests.length;
  let fresh = timed(),
    deadline = null;
  for (let pass = 0; pass < maxPasses && pending(fresh); pass++) {
    const t0 = performance.now();
    deadline ??= t0 + budgetMs;
    const left = deadline - t0;
    stats.asks += pending(fresh);
    if (left <= 0) {
      // Orçamento gasto nas rodadas anteriores: dispara as perguntas (ficam no cache para a próxima) sem esperar.
      ask(fresh).catch(() => {});
      stats.capped = 1;
      break;
    }
    stats.passes++;
    let timer;
    const finished = await Promise.race([
      ask(fresh).then(() => true),
      new Promise((resolve) => {
        // setTimeout estoura em 2^31-1 ms (viraria 1 ms): orçamento "sem teto" fica no máximo permitido.
        timer = setTimeout(() => resolve(false), Math.min(left, 2 ** 31 - 1));
      }),
    ]);
    clearTimeout(timer);
    stats.net += performance.now() - t0;
    fresh = timed();
    if (!finished) {
      stats.capped = 1;
      break;
    }
  }
  // Sem nenhum await depois da última análise: quem guarda a base com a versão da evidência (chave) vê o mesmo
  // estado que a análise viu.
  commit?.(fresh);
  return fresh;
}

/**
 * Atraso do event loop (`monitorEventLoopDelay`), CPU e memória do processo. `sample()` resume o que aconteceu desde a
 * chamada anterior em uma linha para o `server.log` (nível TEMPO). O histograma mede o intervalo entre ticks do timer,
 * então se desconta a própria resolução: 0 = loop livre.
 */
export function loadProbe({ resolutionMs = 20 } = {}) {
  const histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  histogram.enable();
  let since = performance.now(),
    cpu = process.cpuUsage();
  const lag = (ns) => Math.max(0, ns / 1e6 - resolutionMs).toFixed(0);
  return {
    sample() {
      const now = performance.now(),
        used = process.cpuUsage(cpu),
        mem = process.memoryUsage(),
        wall = now - since,
        text = histogram.count
          ? `loop-lag p50=${lag(histogram.percentile(50))} p99=${lag(histogram.percentile(99))} max=${lag(histogram.max)} (ms); cpu=${Math.round(((used.user + used.system) / 1000 / Math.max(wall, 1)) * 100)}%; heap=${(mem.heapUsed / 1048576).toFixed(0)}MB rss=${(mem.rss / 1048576).toFixed(0)}MB`
          : "loop-lag sem amostra";
      histogram.reset();
      since = now;
      cpu = process.cpuUsage();
      return text;
    },
  };
}
