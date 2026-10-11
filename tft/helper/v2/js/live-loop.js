/**
 * Laço de leitura do Ao vivo: separa BUSCAR de DESENHAR.
 *
 * - Buscar (GET /api/state e, quando a chave muda, a análise) acontece sempre, com a aba visível, oculta ou a janela
 *   minimizada: o dado do servidor continua chegando e o modelo da página continua em dia.
 * - Desenhar (o DOM pesado do Ao vivo) só acontece com a aba visível. Oculta, a busca guarda o último desenho pendente
 *   (`paint`) e `show()` o aplica na hora em que a aba volta, sem esperar um novo ciclo.
 *
 * Gatilhos de busca:
 * - `kick()`: evento do servidor (SSE). É o caminho principal: rede não é segurada pelo navegador em segundo plano.
 *   Um pequeno atraso (`debounceMs`) junta rajadas de eventos numa busca só.
 * - temporizador de reserva: `delay()` depois do FIM da última busca (de qualquer origem), com o recuo de falhas que o
 *   chamador calcula. Reagendar a partir da resposta de rede (e não de dentro do próprio temporizador) evita a cadeia
 *   de temporizadores que o Chrome/Edge espaça para ~1 por minuto depois de 5 min de aba oculta.
 * - `request()`: pedido explícito (ação do usuário, troca de tela, rede voltou).
 *
 * Sem pedidos duplicados: com uma busca em andamento, um pedido explícito ou um evento marca UMA busca de seguimento
 * (`pending`), porque algo mudou depois de a busca atual começar; o temporizador e a volta da aba (`soft`) não marcam
 * nada, porque a resposta que está chegando já serve. Toda busca empurra o temporizador para `delay()` depois dela.
 *
 * Puro em relação ao DOM: visibilidade, relógio e temporizadores são injetados (testável em Node).
 */

/**
 * @param {object} o
 * @param {() => Promise<void>} o.pull busca e atualiza o modelo; para desenhar, chama `loop.paint(fn)`
 * @param {() => boolean} o.hidden a página está oculta (`document.hidden`)
 * @param {() => number} o.delay intervalo até a busca de reserva (ms), já com o recuo de falhas
 * @param {() => void} [o.onSettled] depois de cada busca, já com o próximo horário agendado (`loop.nextAt`)
 * @param {(fn: () => void, ms: number) => unknown} [o.setTimer]
 * @param {(id: unknown) => void} [o.clearTimer]
 * @param {() => number} [o.now]
 * @param {number} [o.debounceMs] espera que junta uma rajada de eventos do servidor
 * @param {number} [o.followMs] espera antes da busca de seguimento
 * @param {(error: unknown) => void} [o.onError] erro que escapou de `pull` (o laço continua)
 */
export function createLiveLoop({
  pull,
  hidden,
  delay,
  onSettled = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
  debounceMs = 200,
  followMs = 80,
  onError = (error) => console.error(error),
}) {
  let running = false, // marcado antes de `pull` começar (um pedido feito de dentro dela não abre outra busca)
    busy = null, // promessa da busca em andamento
    pending = false,
    deferred = null, // último desenho adiado com a aba oculta
    pollTimer = null,
    kickTimer = null,
    nextAt = null,
    lastPullAt = null;

  function schedule() {
    if (pollTimer !== null) clearTimer(pollTimer);
    const ms = Math.max(0, delay());
    nextAt = now() + ms;
    pollTimer = setTimer(() => {
      pollTimer = null;
      void request({ soft: true });
    }, ms);
  }

  async function run() {
    lastPullAt = now();
    try {
      await pull();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      busy = null;
      schedule();
      onSettled();
      if (pending) {
        pending = false;
        setTimer(() => void request(), followMs);
      }
    }
  }

  /**
   * Busca agora. Com uma busca em andamento devolve a mesma promessa; `soft: false` (padrão) ainda marca uma busca de
   * seguimento, `soft: true` não.
   */
  function request({ soft = false } = {}) {
    if (running) {
      if (!soft) pending = true;
      return busy ?? Promise.resolve();
    }
    running = true;
    busy = run();
    return busy;
  }

  /** Evento do servidor: busca logo depois de juntar a rajada, com a aba visível ou oculta. */
  function kick() {
    if (kickTimer !== null) clearTimer(kickTimer);
    kickTimer = setTimer(() => {
      kickTimer = null;
      void request();
    }, debounceMs);
  }

  /** Desenha agora com a aba visível; oculta, guarda só o desenho mais recente para `show()`. */
  function paint(fn) {
    if (hidden()) {
      deferred = fn;
      return false;
    }
    deferred = null;
    fn();
    return true;
  }

  /** A aba voltou: aplica o desenho adiado (se houver). Devolve se desenhou. */
  function show() {
    if (hidden() || !deferred) return false;
    const fn = deferred;
    deferred = null;
    fn();
    return true;
  }

  /** Começa o temporizador de reserva sem buscar (a primeira busca já agenda o seguinte sozinha). */
  function start() {
    if (pollTimer === null && !running) schedule();
  }

  function stop() {
    if (pollTimer !== null) clearTimer(pollTimer);
    if (kickTimer !== null) clearTimer(kickTimer);
    pollTimer = kickTimer = null;
    nextAt = null;
  }

  return {
    request,
    kick,
    paint,
    show,
    start,
    stop,
    /** Há desenho esperando a aba voltar. */
    get stale() {
      return deferred !== null;
    },
    get busy() {
      return running;
    },
    /** Horário (ms) da próxima busca de reserva. */
    get nextAt() {
      return nextAt;
    },
    /** Quando começou a última busca (ms). */
    get lastPullAt() {
      return lastPullAt;
    },
  };
}
