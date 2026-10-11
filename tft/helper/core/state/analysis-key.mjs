// A chave de análise: o que decide se a recomendação precisa ser recalculada. Regra ÚNICA, usada pelo cliente
// (v2/js/api.js, que só passa o relógio) e pelo servidor (app/auto-refresh.mjs e app/recommend.mjs), para os dois
// concordarem sobre "o jogo mudou o bastante para uma análise nova" (ARQUITETURA.md, M10b). Puro: sem relógio próprio
// (`now` é entrada), sem E/S, e carregável no navegador e no servidor.

/** Janela de renovação: só o decaimento do banco estimado dos rivais muda com o tempo; 2 min bastam. */
export const REFRESH_WINDOW_MS = 120000;

/**
 * Decisões do usuário no corpo do POST /api/recommend (o resto vem do estado que o servidor lê). `stored` traz o que o
 * usuário decidiu: `augments` (ids marcados), `goalCompId`/`goalSwaps` (comp fixada e trocas), `compSwaps` (trocas no
 * automático) e `augmentsKnown` (a interface tem registro de aprimoramentos desta partida). Sem `stored`, valem os padrões
 * (nenhuma decisão). A ordem das chaves é a da chave de análise antiga: não reordene.
 */
export function decisionPayload(state, stored = {}) {
  const decisions = {
    augments: stored.augments ?? [],
    playerId: state?.localPlayerId,
    viewedPlayerId: "",
    targetLevel: "auto",
    previewIds: [],
    side: "right",
    goalCarryId: "",
    goalCompId: stored.goalCompId ?? "",
    goalSwaps: stored.goalSwaps ?? [],
    compSwaps: stored.compSwaps ?? {},
  };
  if (stored.augmentsKnown !== undefined)
    decisions.augmentsKnown = stored.augmentsKnown;
  return decisions;
}

/**
 * Chave que muda só quando uma nova análise é necessária. `state` é o corpo de GET /api/state (o estado visto em
 * `state.seen`), `payload` as decisões (`decisionPayload`) e `now` o relógio em ms (a janela de renovação). Mesma regra de
 * cache da v1. O rótulo "screen" DENTRO da chave é só o nome antigo deste bloco no formato congelado da chave (o estado
 * se chamava `screen` antes de a leitura de tela sair, em 2026-10-11); mantê-lo deixa a chave idêntica para os mesmos
 * valores (tests/analysis-key.test.mjs e tests/no-screen.test.mjs conferem). Não é leitura de tela.
 */
export const analysisKey = (state, payload, now) => {
  const seen = state.seen;
  return JSON.stringify({
    payload,
    // Conteúdo do snapshot (o servidor devolve `signature`); o horário do arquivo muda a cada regravação, mesmo sem
    // nada de novo no jogo. Servidor antigo sem assinatura: cai para o horário.
    source: state.signature ?? state.modifiedAt,
    phase: state.phase,
    actionable: state.actionable,
    sameGame: state.sameGame,
    match: state.match?.id,
    screen: {
      xp: seen?.xp,
      stage: seen?.stage,
      shop: seen?.shop,
      augments: seen?.augments,
      // Escolhidos lidos do GEP: o servidor os usa como aprimoramentos da partida (o registro manual prevalece).
      pickedAugments: seen?.pickedAugments,
      // Removedores mudam o método de passar itens (o servidor os lê do GEP).
      removers: seen?.removers,
      // O que o servidor lê do próprio estado (antes ia no payload): ouro, nível (e se é piso derivado), banco de itens
      // e reserva do GEP. Sem eles aqui, mudar só o ouro não pediria análise nova.
      gold: seen?.gold,
      level: seen?.level,
      levelSource: seen?.sources?.level,
      items: seen?.items,
      bench: seen?.gepBench,
    },
    estimatedLevel: seen?.level == null ? state.estimatedLevel : null,
    // Só o decaimento do banco estimado dos rivais muda com o tempo (em meios, ver app/recommend.mjs): 2 min bastam.
    // Antes, 30 s refaziam a análise inteira mesmo com o jogo parado.
    window: Math.floor(now / REFRESH_WINDOW_MS),
  });
};
