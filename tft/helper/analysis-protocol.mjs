// Contrato entre o servidor e a thread de análise (M10a da migração, ver ARQUITETURA.md): tipos de mensagem, a
// resposta tática imediata marcada (`stale`, `ageMs`, `baseAge`) e o aviso de SSE. ESM puro, sem `node:*`, sem relógio
// próprio (quem chama passa `now`): carregável no servidor, na thread de análise e nos testes.

/** Mensagens do servidor para a thread de análise. */
export const TO_WORKER = Object.freeze({
  context: "context", // partes estáticas (catálogo, meta, estatísticas...): enviadas só quando mudam
  run: "run", // um pedido: { id, ctxRev, payload }
  cancel: "cancel", // descarte cooperativo: { id }
  shutdown: "shutdown",
});

/** Mensagens da thread de análise para o servidor. */
export const FROM_WORKER = Object.freeze({
  ready: "ready", // o pipeline terminou de iniciar
  result: "result", // { id, ctxRev, bytes: ArrayBuffer transferido, workerMs, stages }
  error: "error", // { id (null = falha ao iniciar), error: { name, message, stack } }
  cancelled: "cancelled", // { id }: o pedido foi cancelado; o resultado foi descartado dentro da thread
});

/** Defasagem máxima aceita para a resposta imediata: a base pode estar no máximo 1 leitura atrás (decisão 4). */
export const DEFAULT_MAX_BASE_AGE = 1;

/** Erro serializável (nada de objetos Error pelo canal de mensagens). */
export function errorInfo(error) {
  if (error && typeof error === "object")
    return {
      name: String(error.name ?? "Error"),
      message: String(error.message ?? error),
      stack: typeof error.stack === "string" ? error.stack : null,
    };
  return { name: "Error", message: String(error), stack: null };
}

/**
 * Quão atrás do pedido atual a base está.
 *
 * `reading` é o número da leitura de estado que gerou o pedido (cresce quando a chave de entrada muda, ver
 * `submit({ key })` em analysis-worker.mjs): `baseAge = leitura do pedido - leitura da base`, nunca negativo.
 * `base` é `{ rev, reading, completedAt }` (o resultado guardado) ou `null` (ainda não há base).
 * `acceptable` diz se a defasagem cabe no limite (`maxBaseAge`, padrão 1 leitura).
 */
export function freshness({
  readingNow,
  base,
  now,
  maxBaseAge = DEFAULT_MAX_BASE_AGE,
}) {
  if (!base)
    return {
      rev: null,
      reading: null,
      stale: true,
      baseAge: null,
      ageMs: null,
      maxBaseAge,
      acceptable: false,
    };
  const baseAge = Math.max(0, readingNow - base.reading);
  return {
    rev: base.rev,
    reading: base.reading,
    stale: baseAge > 0,
    baseAge,
    ageMs: Math.max(0, Math.round(now - base.completedAt)),
    maxBaseAge,
    acceptable: baseAge <= maxBaseAge,
  };
}

/** O que vai no campo `base` da resposta (sem o veredito interno `acceptable`). */
export function baseField(info) {
  const { rev, reading, stale, baseAge, ageMs, maxBaseAge } = info;
  return { rev, reading, stale, baseAge, ageMs, maxBaseAge };
}

const encoder = new TextEncoder();
const isSpace = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

/**
 * Acrescenta campos de primeiro nível ao objeto JSON já serializado, sem reparsear (a resposta tem ~1 MB). Se a chave
 * já existir no objeto, a nova vale (JSON.parse usa a última). Lança `TypeError` se os bytes não forem um objeto JSON.
 * Serve ao `base` da resposta imediata e ao que o servidor só sabe depois (ex.: `planProgress`, que depende do estado
 * em disco do plano em andamento).
 */
export function appendFields(bytes, fields) {
  let end = bytes.length - 1;
  while (end >= 0 && isSpace(bytes[end])) end--;
  if (end < 1 || bytes[end] !== 0x7d)
    throw new TypeError("A resposta serializada não é um objeto JSON.");
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return bytes;
  let before = end - 1;
  while (before >= 0 && isSpace(bytes[before])) before--;
  const empty = bytes[before] === 0x7b;
  const tail = encoder.encode(
    (empty ? "" : ",") +
      entries
        .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
        .join(",") +
      "}",
  );
  const out = new Uint8Array(end + tail.length);
  out.set(bytes.subarray(0, end), 0);
  out.set(tail, end);
  return out;
}

/** Acrescenta o campo `base` (ver `baseField`) ao JSON serializado. */
export const markBase = (bytes, info) =>
  appendFields(bytes, { base: baseField(info) });

/**
 * Aviso de SSE quando uma análise nova termina (o cliente que recebeu uma resposta `stale` busca a atualização).
 * Pequeno de propósito: não carrega a análise.
 */
export function analysisEvent(result) {
  return {
    type: "analysis",
    rev: result.rev,
    reading: result.reading,
    key: result.key ?? null,
  };
}

/** Resumo p50/p95/máx de uma lista de tempos (ms). */
export function summarize(values) {
  if (!values.length) return { n: 0, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    n: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  };
}
