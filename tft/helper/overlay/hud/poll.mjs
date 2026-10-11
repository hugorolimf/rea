/**
 * Consulta periódica de `GET /api/overlay`: um pedido por vez, `since=<rev>` para só receber o que mudou e recuo
 * até 5 s quando o servidor não responde. Sem DOM; o relógio, o agendador e a rede são injetados.
 */

/** Intervalo normal entre consultas. */
export const POLL_MS = 1000;
/** Maior espera entre tentativas depois de falhas seguidas. */
export const MAX_BACKOFF_MS = 5000;
/** Tempo máximo de cada pedido. */
export const REQUEST_TIMEOUT_MS = 3000;
/** Falhas seguidas a partir das quais a página avisa "sem resposta do servidor". */
export const OFFLINE_AFTER = 2;

/** Espera antes da próxima consulta: normal sem falhas; com falhas, dobra a cada uma até o teto. */
export const retryDelay = (failures) =>
  failures <= 0
    ? POLL_MS
    : Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(failures, 3));

const isSlot = (v) =>
  v === null ||
  (typeof v === "object" &&
    v !== null &&
    typeof v.body === "object" &&
    v.body !== null);

/**
 * Valida a resposta de `/api/overlay` na fronteira. Devolve `{ unchanged, rev, state, recommendation }` ou lança com o
 * motivo (versão desconhecida, corpo que não é objeto, cache em formato inesperado).
 */
export function parseFeed(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("resposta do overlay não é um objeto");
  if (raw.version !== 1)
    throw new Error(
      `versão ${String(raw.version)} da rota do overlay não é suportada`,
    );
  const rev = typeof raw.rev === "string" ? raw.rev : null;
  if (raw.unchanged === true) return { unchanged: true, rev };
  if (!isSlot(raw.state ?? null) || !isSlot(raw.recommendation ?? null))
    throw new Error("cache do overlay em formato inesperado");
  return {
    unchanged: false,
    rev,
    state: raw.state ?? null,
    recommendation: raw.recommendation ?? null,
  };
}

/**
 * Inicia a consulta. `fetchFeed(since)` devolve o JSON bruto (ou lança); `onUpdate({ feed, receivedAt, failures, error })`
 * roda a cada resposta ou falha: `feed` é a última resposta completa (null se nenhuma chegou), `receivedAt` quando
 * ela chegou (uma resposta `unchanged` não renova: a idade do cache continua contando), `failures` as falhas seguidas
 * e `error` a última falha (null depois de um sucesso).
 * Devolve `{ stop() }`.
 */
export function startPolling({
  fetchFeed,
  onUpdate,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let rev = null,
    feed = null,
    receivedAt = 0,
    failures = 0,
    error = null,
    timer = null,
    stopped = false;
  async function tick() {
    timer = null;
    try {
      const next = parseFeed(await fetchFeed(rev));
      failures = 0;
      error = null;
      if (!next.unchanged) {
        feed = next;
        rev = next.rev;
        receivedAt = now();
      } else if (!feed) rev = null; // `unchanged` sem resposta guardada: pede tudo de novo
    } catch (e) {
      failures += 1;
      error = e;
      // O servidor pode ter reiniciado (os contadores de `rev` recomeçam): depois de uma falha o pedido traz tudo.
      rev = null;
    }
    if (stopped) return;
    onUpdate({ feed, receivedAt, failures, error });
    timer = schedule(tick, retryDelay(failures));
  }
  timer = schedule(tick, 0);
  return {
    stop() {
      stopped = true;
      if (timer !== null) cancel(timer);
    },
  };
}
