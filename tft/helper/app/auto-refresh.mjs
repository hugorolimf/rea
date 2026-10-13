// Laço do servidor que conduz a análise SOZINHO durante uma partida (M10b, ARQUITETURA.md): antes, a recomendação só se
// renovava com a interface web aberta e visível (era ela quem chamava POST /api/recommend, e o navegador pausa abas
// ocultas). Aqui o servidor:
//   1. enquanto há partida em andamento, lê o MESMO estado que GET /api/state devolve (`readState`) a cada tick barato;
//   2. calcula a chave de análise que o cliente usa (core/state/analysis-key.mjs) com as decisões do usuário que o
//      servidor lembra (comp fixada, trocas, aprimoramentos: `decisions(gameId)`, guardadas em plan-state);
//   3. só quando a chave muda (e respeitando o intervalo mínimo; a chave já traz a janela de 120 s) roda o pipeline da
//      recomendação (`refresh`), que grava no cache de análises e no feed do overlay. Um POST posterior com a mesma chave
//      responde do cache (`results`); chave igual não reanalisa. As fontes (GEP e arquivos do jogo) são lidas a cada
//      `readState`; nada é ligado ou desligado com a partida.
// Sem partida o tick é só `probe()` (fase do cliente em cache): nenhuma leitura de estado e nenhuma análise. Este módulo
// não importa o servidor nem o motor: tudo entra por parâmetro (os testes usam relógio e pipeline falsos).
import {
  REFRESH_WINDOW_MS,
  analysisKey,
  decisionPayload,
} from "../core/state/analysis-key.mjs";

/** Decisões que valem enquanto o usuário ainda não mandou nenhuma POST (nenhuma comp fixada, nenhum aprimoramento). */
export const DEFAULT_DECISIONS = Object.freeze({
  goalCompId: "",
  goalSwaps: [],
  compSwaps: {},
  augments: [],
  augmentsKnown: false,
});

/**
 * Resultados recentes da análise, compartilhados pelo POST da interface e pelo laço. Cada resultado vale para UMA OU MAIS
 * chaves: a chave de análise da tela (core/state/analysis-key.mjs) e o conteúdo da entrada da análise pesada
 * (app/recommend.mjs); quem pedir qualquer uma delas recebe o mesmo resultado. Guarda também o que está em cálculo: quem
 * pedir a mesma chave junto espera o mesmo resultado em vez de repetir o trabalho. Pequeno de propósito e com prazo
 * (`ttlMs`, a janela de 2 min da chave de análise): um resultado velho ou de estado que já mudou é descartado.
 */
export function createRecentResults({
  max = 6,
  ttlMs = REFRESH_WINDOW_MS,
  now = Date.now,
} = {}) {
  let entries = [];
  const listOf = (keys) => (Array.isArray(keys) ? keys : [keys]);
  const fresh = (e) => e.pending || now() - e.at < ttlMs;
  const find = (keys) => {
    const wanted = listOf(keys);
    return entries.find((e) => fresh(e) && wanted.some((k) => e.keys.has(k)));
  };
  return {
    /** Há resultado ou cálculo em andamento para esta chave? */
    has: (key) => !!find(key),
    /** Resultado pronto desta chave, ou null. */
    peek: (key) => find(key)?.parts ?? null,
    /**
     * `keys`: uma chave ou uma lista (qualquer uma acerta). Devolve `{ parts, via }`: `via` = "cache" (já pronto),
     * "junto" (esperou o cálculo de outro pedido) ou "novo" (calculou aqui com `compute()`). Um acerto por uma chave
     * registra as outras no mesmo resultado. Se quem calculava falhou, calcula aqui. Falha de `compute` propaga.
     */
    async run(keys, compute) {
      const hit = find(keys);
      if (hit) for (const k of listOf(keys)) hit.keys.add(k);
      if (hit?.parts) return { parts: hit.parts, via: "cache" };
      if (hit?.pending) {
        try {
          return { parts: await hit.pending, via: "junto" };
        } catch {
          // quem calculava falhou: este pedido calcula por conta própria
        }
      }
      const entry = {
        keys: new Set(listOf(keys)),
        parts: null,
        pending: null,
        at: 0,
      };
      entry.pending = compute();
      entries.push(entry);
      if (entries.length > max) entries.shift();
      try {
        entry.parts = await entry.pending;
        entry.at = now();
        return { parts: entry.parts, via: "novo" };
      } catch (e) {
        entries = entries.filter((x) => x !== entry);
        throw e;
      } finally {
        entry.pending = null;
      }
    },
    /** Esquece tudo (cópias de meta ou partida mudaram): a próxima chave recalcula. */
    clear() {
      entries = [];
    },
    get size() {
      return entries.length;
    },
  };
}

/**
 * Cria o laço. Dependências (todas injetáveis):
 * - `probe()` -> `{ inMatch, gameId }`: há partida em andamento? Barata (fase do cliente em cache); é o único custo sem partida.
 * - `readState()` -> corpo de GET /api/state (com o estado visto, `signature`, `match`, `players`...); pode lançar (arquivo do
 *   jogo ausente). O GEP e os arquivos do jogo são lidos a cada `readState`.
 * - `decisions(gameId)` -> últimas decisões do usuário nesta partida, ou null (valem `DEFAULT_DECISIONS`).
 * - `refresh(decisions, state)` -> `{ status }`: roda o pipeline (grava nos caches e no feed do overlay); 200 = análise feita.
 * - `results`: `createRecentResults()` compartilhado com o POST (`has(chave)` evita repetir).
 * - `now`, `timers`: relógio e agendador; `report(nome, ms)`: tempo para o TEMPO; `log(nível, texto)`.
 * `intervalMs` = tick; `minGapMs` = mínimo entre análises (dobra a cada falha seguida, até `maxBackoffMs`).
 * `maxTickMs`: um tick que passa disso (uma fonte que nunca responde) é abandonado e o laço segue no próximo; o laço nunca
 * fica preso esperando uma leitura.
 */
export function createAutoRefresh({
  probe,
  readState,
  decisions = () => null,
  refresh,
  results,
  now = Date.now,
  timers = { setTimeout, clearTimeout },
  intervalMs = 3000,
  minGapMs = 3000,
  maxBackoffMs = 30_000,
  maxTickMs = 180_000,
  startDelayMs = 1000,
  report = () => {},
  log = () => {},
}) {
  let active = false,
    gameId = null,
    lastRunAt = -Infinity,
    // Duração da última análise: com a máquina sem folga (jogo pesado), análises de 10–40 s seguidas disputam a CPU com o
    // jogo; o próximo início espera 1,5× a duração da anterior (até 60 s). Os itens ao vivo (app/items-now.mjs) não
    // dependem disso.
    lastTookMs = 0,
    failures = 0,
    rejectedKey = null,
    running = false,
    runningSince = 0,
    lastTickAt = null,
    lastError = null,
    stopped = true,
    timer = null,
    counters = { ticks: 0, runs: 0, same: 0, waits: 0, rejected: 0, errors: 0 };
  const complained = new Map();
  /** Registra um problema no máximo uma vez por minuto por texto (o laço roda a cada poucos segundos). */
  function complain(text) {
    const at = now();
    if (at - (complained.get(text) ?? -Infinity) < 60_000) return;
    complained.set(text, at);
    log("AVISO", text);
  }
  function end() {
    active = false;
    gameId = null;
    rejectedKey = null;
    lastRunAt = -Infinity;
    failures = 0;
    log("INFO", "laço automático: partida terminou");
  }
  async function step() {
    const p = await probe();
    if (!p?.inMatch) {
      if (active) end();
      return { action: "idle" };
    }
    if (!active) {
      active = true;
      log(
        "INFO",
        `laço automático: partida ${p.gameId ?? "?"} em andamento; o servidor conduz a análise sem a interface`,
      );
    }
    const state = await readState();
    if (!state) return { action: "wait", reason: "sem-estado" };
    if (state.gameId !== gameId) {
      gameId = state.gameId;
      rejectedKey = null;
      lastRunAt = -Infinity;
      failures = 0;
    }
    // Mesmas guardas que a interface: partida nova sem tabuleiro próprio e identidade local ausente não analisam.
    if (state.match?.status === "live" && state.match.boardReady === false)
      return { action: "wait", reason: "tabuleiro" };
    if (!state.players?.some((pl) => pl.id === state.localPlayerId))
      return { action: "wait", reason: "jogador" };
    const decided = { ...DEFAULT_DECISIONS, ...decisions(state.gameId) },
      key = analysisKey(state, decisionPayload(state, decided), now());
    if (key === rejectedKey || results.has(key)) {
      counters.same++;
      return { action: "same", key };
    }
    const gap = Math.max(
      failures ? Math.min(maxBackoffMs, minGapMs * 2 ** failures) : minGapMs,
      Math.min(60_000, lastTookMs * 1.5),
    );
    if (now() - lastRunAt < gap) {
      counters.waits++;
      return { action: "wait", reason: "intervalo", key };
    }
    lastRunAt = now();
    const t0 = now();
    let done;
    try {
      done = await refresh(decided, state);
    } catch (e) {
      failures++;
      counters.errors++;
      throw e;
    }
    lastTookMs = now() - t0;
    report("AUTO analise", lastTookMs);
    failures = 0;
    if (done?.status === 200) {
      counters.runs++;
      return { action: "run", key };
    }
    // Recusada (outro set, por exemplo): não repete a mesma chave.
    rejectedKey = key;
    counters.rejected++;
    return { action: "rejected", key, status: done?.status ?? null };
  }
  /** Um passo do laço (os testes o chamam direto). Nunca lança: o erro vira aviso no log e o próximo tick tenta de novo. */
  async function tick() {
    if (running) {
      // Um tick preso (fonte que nunca responde) não pode parar o laço: passado o limite, é abandonado.
      if (now() - runningSince < maxTickMs) return { action: "busy" };
      complain(
        `laço automático: o tick anterior passou de ${Math.round(maxTickMs / 1000)} s sem terminar; abandonado, o laço segue`,
      );
      counters.errors++;
    }
    running = true;
    const mine = (runningSince = now());
    counters.ticks++;
    const t0 = now();
    let outcome;
    try {
      outcome = await step();
    } catch (e) {
      if (e?.code !== "ENOENT") complain(`laço automático: ${e?.message ?? e}`);
      lastError = { at: now(), message: e?.message ?? String(e) };
      outcome = { action: "error", error: e?.message ?? String(e) };
    } finally {
      // Só quem ainda é o tick vigente libera a vaga (um tick abandonado que termina tarde não solta o seguinte).
      if (runningSince === mine) running = false;
      lastTickAt = now();
    }
    // O custo do tick barato (estado lido, chave igual): a análise tem a própria linha.
    if (outcome.action !== "idle" && outcome.action !== "run")
      report("AUTO tick", now() - t0);
    return outcome;
  }
  const schedule = (ms) => {
    timer = timers.setTimeout(async () => {
      try {
        await tick();
      } catch (e) {
        // `tick` não lança; isto só protege o agendamento (um erro aqui matava o laço para sempre).
        complain(`laço automático: ${e?.message ?? e}`);
      } finally {
        if (!stopped) schedule(intervalMs);
      }
    }, ms);
    timer?.unref?.();
  };
  return {
    tick,
    /** Liga o laço (idempotente). O primeiro tick espera `startDelayMs` para o servidor terminar de subir. */
    start() {
      if (!stopped) return;
      stopped = false;
      schedule(startDelayMs);
    },
    /** Desliga o laço. */
    stop() {
      stopped = true;
      timers.clearTimeout(timer);
      timer = null;
      active = false;
    },
    /** Estado do laço (diagnóstico e testes). */
    status: () => ({
      running: !stopped,
      active,
      gameId,
      failures,
      lastRunAt,
      lastTickAt,
      lastError,
      ...counters,
    }),
    /** Contadores desde a última chamada, em uma linha para o resumo por minuto do TEMPO. */
    takeStats() {
      const c = counters;
      counters = {
        ticks: 0,
        runs: 0,
        same: 0,
        waits: 0,
        rejected: 0,
        errors: 0,
      };
      return `auto: ${active ? "em partida" : "sem partida"} ticks=${c.ticks} analises=${c.runs} iguais=${c.same} esperas=${c.waits} recusadas=${c.rejected} erros=${c.errors}`;
    },
  };
}
