// Sonda do servidor do helper pelo processo principal do overlay (puro: sem Electron, testável com node --test).
//
// O servidor fica lento em partida (loop-lag de segundos), e uma sonda que expira NÃO quer dizer que ele caiu. Regras:
// - conexão recusada (ECONNREFUSED: a porta está fechada) = fora do ar de verdade, na hora;
// - tempo esgotado ou resposta ruim = falha transitória; só depois de OFFLINE_AFTER_FAILS seguidas conta como fora do ar;
// - com o HUD já carregado, a página NUNCA é trocada: ela mantém os últimos dados e mostra o próprio selo "servidor sem
//   resposta há N s" (poll.mjs/view.mjs); offline.html só aparece quando o HUD ainda não carregou;
// - a primeira resposta boa volta ao normal sem recarregar a página que já está carregada.

/** Limite de uma sonda: maior que os picos de loop-lag medidos em partida (até ~3,7 s). */
export const PROBE_TIMEOUT_MS = 6000;
/** Falhas transitórias seguidas (uma por ciclo de ~3-5 s) para considerar o servidor fora do ar. */
export const OFFLINE_AFTER_FAILS = 3;

/**
 * Resultado de uma sonda a partir do erro do `fetch` (undici): "refused" para porta fechada, "timeout" para o resto
 * (tempo esgotado, conexão derrubada, resposta incompleta). Resposta HTTP não-200 é "bad".
 */
export function probeResult(err, response) {
  if (!err) return response?.ok ? "ok" : "bad";
  const code = err?.cause?.code ?? err?.code;
  if (code === "ECONNREFUSED") return "refused";
  return "timeout";
}

/**
 * Próximo estado da sonda. `state`: `{ fails, down, hudLoaded }`; `result`: "ok" | "refused" | "timeout" | "bad".
 * Devolve `{ fails, down, action }`, com `action`:
 * - "load-hud": carregar o HUD (o servidor respondeu e o HUD não está carregado);
 * - "show-offline": mostrar offline.html (fora do ar e o HUD nunca carregou ou caiu);
 * - "none": nada a fazer na janela (inclusive fora do ar com o HUD carregado: ele mesmo mostra o selo).
 */
export function probeStep(state, result) {
  const hudLoaded = state?.hudLoaded === true;
  if (result === "ok")
    return { fails: 0, down: false, action: hudLoaded ? "none" : "load-hud" };
  const fails = (Number.isInteger(state?.fails) ? state.fails : 0) + 1;
  const down = result === "refused" || fails >= OFFLINE_AFTER_FAILS;
  return {
    fails,
    down,
    action:
      down && !hudLoaded && state?.showingOffline !== true
        ? "show-offline"
        : "none",
  };
}
