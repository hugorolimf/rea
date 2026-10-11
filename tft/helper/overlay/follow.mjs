// Filtro do acompanhamento da janela do jogo (puro: sem Electron, sem node:*; relógios injetáveis para testar).
//
// O rastreador (game-tracker.mjs) entrega o retângulo da área cliente do TFT a cada leitura em que ele muda. Arrastar a borda
// da janela, trocar entre janela e janela sem borda ou minimizar/restaurar geram rajadas de mudanças e ausências
// passageiras. Este filtro decide o que vale reposicionar a janela do overlay:
//  - mudança de até `tolerance` px em x, y, largura e altura (comparada com o último retângulo APLICADO, então o erro nunca
//    passa da tolerância) é ignorada: nada de piscar por 1 ou 2 px;
//  - mudança maior chama `onRect` na hora (acompanha ao vivo) e agenda `onSettle` para `settleMs` depois da última, quando a
//    página/ janela pode fazer o ajuste exato (inclusive o segundo `setBounds` do DPI misto);
//  - a ausência do jogo (`null`: minimizado, fechado, recriado na troca de modo de tela) só vira "perdido" depois de
//    `graceMs`; se ele voltar antes, nada acontece. Passado o prazo, `onLost` roda uma vez e a volta chama `onRect` com
//    `recovered: true`.
// Não toca em janela, arquivo nem entrada: só decide quando avisar.

/** Mudança de posição/tamanho (px) abaixo da qual o overlay não se reposiciona. */
export const RECT_TOLERANCE_PX = 2;
/** Quanto tempo a ausência do jogo é tolerada antes de ser dada como perda, em ms. */
export const LOST_GRACE_MS = 1500;
/** Quietude depois da última mudança para o ajuste exato, em ms. */
export const SETTLE_MS = 400;

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const validRect = (r) =>
  !!r &&
  [r.x, r.y, r.width, r.height].every(isNum) &&
  r.width > 0 &&
  r.height > 0;

/** Os dois retângulos diferem de no máximo `tol` px em cada um dos quatro campos? (inválido: false) */
export function nearlySameRect(a, b, tol = RECT_TOLERANCE_PX) {
  if (!validRect(a) || !validRect(b)) return false;
  const t = isNum(tol) && tol >= 0 ? tol : 0;
  return (
    Math.abs(a.x - b.x) <= t &&
    Math.abs(a.y - b.y) <= t &&
    Math.abs(a.width - b.width) <= t &&
    Math.abs(a.height - b.height) <= t
  );
}

/**
 * Acompanhante da janela do jogo. `push(rect | null)` recebe cada leitura do rastreador.
 * `onRect(rect, { first, recovered, resized })`: retângulo novo a aplicar (`first`: não havia jogo; `recovered`: voltou depois
 * de dado como perdido; `resized`: a largura ou a altura mudou além da tolerância). `onLost()`: sumiu além do prazo.
 * `onSettle(rect)`: ficou quieto. Devolve `{ push, reset, current, lost }`.
 */
export function createGameFollower({
  onRect = () => {},
  onLost = () => {},
  onSettle = () => {},
  tolerance = RECT_TOLERANCE_PX,
  graceMs = LOST_GRACE_MS,
  settleMs = SETTLE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let current = null;
  let lost = false;
  let lossTimer = null;
  let settleTimer = null;

  const cancelLoss = () => {
    if (lossTimer !== null) clearTimer(lossTimer);
    lossTimer = null;
  };
  const cancelSettle = () => {
    if (settleTimer !== null) clearTimer(settleTimer);
    settleTimer = null;
  };
  const scheduleSettle = () => {
    cancelSettle();
    settleTimer = setTimer(() => {
      settleTimer = null;
      if (current) onSettle(current);
    }, settleMs);
  };

  return {
    push(rect) {
      if (validRect(rect)) {
        cancelLoss();
        if (current && nearlySameRect(current, rect, tolerance)) return;
        const previous = current;
        const recovered = lost;
        current = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
        lost = false;
        onRect(current, {
          first: previous === null,
          recovered,
          resized:
            !previous ||
            Math.abs(previous.width - rect.width) > tolerance ||
            Math.abs(previous.height - rect.height) > tolerance,
        });
        scheduleSettle();
        return;
      }
      // Ausência: só conta se havia jogo e depois do prazo.
      if (current === null || lossTimer !== null) return;
      lossTimer = setTimer(() => {
        lossTimer = null;
        current = null;
        lost = true;
        cancelSettle();
        onLost();
      }, graceMs);
    },
    /** Esquece tudo e cancela os prazos, sem chamar nenhum aviso. */
    reset() {
      cancelLoss();
      cancelSettle();
      current = null;
      lost = false;
    },
    /** Último retângulo aplicado (ou null). */
    current: () => (current ? { ...current } : null),
    /** O jogo foi dado como perdido e ainda não voltou. */
    lost: () => lost,
  };
}
