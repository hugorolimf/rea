// Laço do servidor que conduz a análise SOZINHO durante uma partida (M10b, ARQUITETURA.md): antes, a recomendação só se
// renovava com a interface web aberta e visível (era ela quem chamava POST /api/recommend, e o navegador pausa abas
// ocultas), e o leitor de tela só rodava enquanto alguma tela lia /api/state. Aqui o servidor:
//   1. enquanto há partida em andamento, lê o MESMO estado que GET /api/state devolve (`readState`) a cada tick barato;
//   2. calcula a chave de análise que o cliente usa (core/state/analysis-key.mjs) com as decisões do usuário que o
//      servidor lembra (comp fixada, trocas, aprimoramentos: `decisions(gameId)`, guardadas em plan-state);
//   3. só quando a chave muda (e respeitando o intervalo mínimo; a chave já traz a janela de 120 s) roda o pipeline da
//      recomendação (`refresh`), que grava no cache de análises e no feed do overlay. Um POST posterior com a mesma chave
//      responde do cache (`results`); chave igual não reanalisa;
//   4. mantém o leitor de tela ligado durante a partida (as demais fontes, GEP e arquivos do jogo, são lidas a cada
//      `readState`) e o desliga quando a partida termina.
// Sem partida o tick é só `probe()` (fase do cliente em cache): nenhuma leitura de estado e nenhuma análise. Este módulo
// não importa o servidor nem o motor: tudo entra por parâmetro (os testes usam relógio e pipeline falsos).
import { analysisKey, decisionPayload } from "../core/state/analysis-key.mjs";

/** Decisões que valem enquanto o usuário ainda não mandou nenhuma POST (nenhuma comp fixada, nenhum aprimoramento). */
export const DEFAULT_DECISIONS = Object.freeze({
  goalCompId: "",
  goalSwaps: [],
  compSwaps: {},
  augments: [],
  augmentsKnown: false,
});

/**
 * Resultados recentes da análise por chave de análise (a de core/state/analysis-key.mjs), compartilhados pelo POST da
 * interface e pelo laço. Guarda também o que está em cálculo: quem pedir a mesma chave junto espera o mesmo resultado em
 * vez de repetir o trabalho. Pequeno de propósito (a chave traz a janela de 2 min, então só as últimas importam).
 */
export function createRecentResults({ max = 6 } = {}) {
  let entries = [];
  const find = (key) => entries.find((e) => e.key === key);
  return {
    /** Há resultado ou cálculo em andamento para esta chave? */
    has: (key) => !!find(key),
    /** Resultado pronto desta chave, ou null. */
    peek: (key) => find(key)?.parts ?? null,
    /**
     * Devolve `{ parts, via }`: `via` = "cache" (já pronto), "junto" (esperou o cálculo de outro pedido) ou "novo"
     * (calculou aqui com `compute()`). Se quem calculava falhou, calcula aqui. Falha de `compute` propaga.
     */
    async run(key, compute) {
      const hit = find(key);
      if (hit?.parts) return { parts: hit.parts, via: "cache" };
      if (hit?.pending) {
        try {
          return { parts: await hit.pending, via: "junto" };
        } catch {
          // quem calculava falhou: este pedido calcula por conta própria
        }
      }
      const entry = { key, parts: null, pending: null };
      entry.pending = compute();
      entries.push(entry);
      if (entries.length > max) entries.shift();
      try {
        entry.parts = await entry.pending;
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
 * - `readState()` -> corpo de GET /api/state (com `screen`, `signature`, `match`, `players`...); pode lançar (arquivo do jogo ausente).
 * - `decisions(gameId)` -> últimas decisões do usuário nesta partida, ou null (valem `DEFAULT_DECISIONS`).
 * - `refresh(decisions, state)` -> `{ status }`: roda o pipeline (grava nos caches e no feed do overlay); 200 = análise feita.
 * - `results`: `createRecentResults()` compartilhado com o POST (`has(chave)` evita repetir).
 * - `sources.sync(ativo)`: liga/desliga o leitor de tela (GEP e arquivos do jogo são lidos a cada `readState`).
 * - `now`, `timers`: relógio e agendador; `report(nome, ms)`: tempo para o TEMPO; `log(nível, texto)`.
 * `intervalMs` = tick; `minGapMs` = mínimo entre análises (dobra a cada falha seguida, até `maxBackoffMs`).
 */
export function createAutoRefresh({
  probe,
  readState,
  decisions = () => null,
  refresh,
  results,
  sources = { sync() {} },
  now = Date.now,
  timers = { setTimeout, clearTimeout },
  intervalMs = 3000,
  minGapMs = 3000,
  maxBackoffMs = 30_000,
  startDelayMs = 1000,
  report = () => {},
  log = () => {},
}) {
  let active = false,
    gameId = null,
    lastRunAt = -Infinity,
    failures = 0,
    rejectedKey = null,
    running = false,
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
    sources.sync(false);
    log("INFO", "laço automático: partida terminou; leitor de tela parado");
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
    sources.sync(true);
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
    const gap = failures
      ? Math.min(maxBackoffMs, minGapMs * 2 ** failures)
      : minGapMs;
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
    report("AUTO analise", now() - t0);
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
    if (running) return { action: "busy" };
    running = true;
    counters.ticks++;
    const t0 = now();
    let outcome;
    try {
      outcome = await step();
    } catch (e) {
      if (e?.code !== "ENOENT") complain(`laço automático: ${e?.message ?? e}`);
      outcome = { action: "error", error: e?.message ?? String(e) };
    } finally {
      running = false;
    }
    // O custo do tick barato (estado lido, chave igual): a análise tem a própria linha.
    if (outcome.action !== "idle" && outcome.action !== "run")
      report("AUTO tick", now() - t0);
    return outcome;
  }
  const schedule = (ms) => {
    timer = timers.setTimeout(async () => {
      await tick();
      if (!stopped) schedule(intervalMs);
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
    /** Desliga o laço e o leitor de tela (se havia partida). */
    stop() {
      stopped = true;
      timers.clearTimeout(timer);
      timer = null;
      if (active) {
        active = false;
        sources.sync(false);
      }
    },
    /** Estado do laço (diagnóstico e testes). */
    status: () => ({
      running: !stopped,
      active,
      gameId,
      failures,
      lastRunAt,
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
