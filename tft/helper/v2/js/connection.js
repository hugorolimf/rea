/**
 * Estado da conexão com o servidor do helper e idade do dado. Puro: o main.js alimenta com os resultados das leituras
 * (`/api/state`, `/api/recommend`) e do SSE; ui/shell.js desenha o resultado na barra do app.
 *
 * O servidor conduz a análise sozinho (M10b), então "fechar a janela" não para nada: o que esta camada mostra é só se
 * ESTA janela está falando com o servidor e quão velho é o último dado que ele entregou.
 */

/** Intervalo normal de leitura (ms) e teto do recuo quando o servidor não responde. */
export const POLL_MS = 5000;
export const POLL_MAX_MS = 30000;
/** Falhas seguidas até chamar de "sem servidor" (antes disso é "reconectando"). */
export const OFFLINE_AFTER = 3;
/** Idade do dado (s) a partir da qual, em partida, a barra avisa. */
export const STALE_AFTER_S = 120;

/** Próximo intervalo de leitura dado o número de falhas seguidas: 5, 5, 10, 20, 30, 30... s. */
export function retryDelay(failures, base = POLL_MS, max = POLL_MAX_MS) {
  const n = Math.max(0, Math.floor(failures));
  if (n <= 1) return base;
  return Math.min(max, base * 2 ** (n - 1));
}

/** "agora", "há 12 s", "há 3 min", "há 2 h" (null → "idade desconhecida"). */
export function formatAge(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0)
    return "idade desconhecida";
  const s = Math.round(seconds);
  if (s < 2) return "agora";
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return `há ${Math.floor(s / 3600)} h`;
}

/**
 * Idade do dado agora: a idade que o servidor informou na última resposta mais o tempo que passou desde então.
 * `null` quando o servidor não informou.
 */
export function dataAge({ ageSeconds, okAt, now }) {
  if (ageSeconds == null || !Number.isFinite(ageSeconds)) return null;
  const extra = okAt != null ? Math.max(0, (now - okAt) / 1000) : 0;
  return ageSeconds + extra;
}

/**
 * Resumo da conexão para a barra do app.
 * @param {object} i
 * @param {number} i.now relógio (ms)
 * @param {number | null} i.okAt quando a última leitura deu certo (ms)
 * @param {number} i.failures leituras seguidas que falharam
 * @param {string | null} [i.error] mensagem da última falha
 * @param {boolean} [i.networkOnline] `navigator.onLine`
 * @param {"open" | "closed" | "unknown"} [i.sse] estado do fluxo de avisos
 * @param {number | null} [i.ageSeconds] idade do dado na última resposta
 * @param {boolean} [i.live] partida em andamento (só aí a idade velha é um aviso)
 * @param {number | null} [i.retryInMs] tempo até a próxima tentativa
 * @returns {{ state: "connecting" | "online" | "stale" | "reconnecting" | "offline", tone: "ok" | "warn" | "bad" | "idle", label: string, detail: string, title: string, pulse: boolean }}
 */
export function connectionView({
  now,
  okAt = null,
  failures = 0,
  error = null,
  networkOnline = true,
  sse = "unknown",
  ageSeconds = null,
  live = false,
  retryInMs = null,
}) {
  if (!networkOnline)
    return {
      state: "offline",
      tone: "bad",
      label: "Sem rede",
      detail: "o navegador está sem conexão",
      title: "O navegador está offline. A tela mostra a última leitura.",
      pulse: false,
    };
  if (failures > 0) {
    const down = failures >= OFFLINE_AFTER || okAt == null;
    const retry =
      retryInMs != null
        ? `nova tentativa em ${Math.ceil(retryInMs / 1000)} s`
        : "tentando de novo";
    return {
      state: down ? "offline" : "reconnecting",
      tone: down ? "bad" : "warn",
      label: down ? "Servidor indisponível" : "Reconectando",
      detail: retry,
      title: `${error ?? "Sem resposta do servidor."} (${retry}). A análise do servidor continua se ele estiver rodando.`,
      pulse: !down,
    };
  }
  if (okAt == null)
    return {
      state: "connecting",
      tone: "idle",
      label: "Conectando",
      detail: "",
      title: "Aguardando a primeira resposta do servidor.",
      pulse: true,
    };
  const age = dataAge({ ageSeconds, okAt, now }),
    old = live && age != null && age > STALE_AFTER_S,
    ageText = formatAge(age),
    noPush = sse === "closed";
  const detail = age == null ? "" : `dado ${ageText}`;
  return {
    state: old ? "stale" : "online",
    tone: old ? "warn" : "ok",
    label: old ? "Dado antigo" : "Conectado",
    detail,
    title: [
      old
        ? `A última leitura do jogo é ${ageText}: o jogo parou de gravar o tabuleiro ou a fonte caiu.`
        : "Conectado ao servidor do helper.",
      age != null ? `Idade do dado: ${ageText}.` : "",
      noPush
        ? "Avisos instantâneos fora do ar: a tela atualiza a cada poucos segundos."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    pulse: false,
  };
}
