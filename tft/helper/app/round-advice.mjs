// Conselho de nível, rolagem e economia da RODADA DE AGORA sobre o último plano analisado, sem esperar a análise pesada.
//
// Por quê (medido em 2026-10-12, partidas 3292171991 e 3292194088: GEP do TFTAcademy, `__sentry-event` lido a cada 0,3 s e
// as linhas TEMPO do server.log): na rodada nova o ouro (renda + juros), o XP passivo e o estágio chegam em até 1 s (o GEP
// grava `gold`, `xp` e `round_type` no mesmo segundo e o arquivo do jogo vira para "<rodada> Planning" junto), e o laço
// automático pede a análise no tick seguinte (≤ 3 s). Mas a análise pesada refaz a base (o ouro muda as lojas ao alcance e
// o nível-alvo) e, nos estágios 4 e 5, levou de 10 a 46 s, às vezes esperando a vez atrás de uma análise do estado da
// rodada anterior. O planejamento dura ~34 s: o "suba" chegava junto com o combate (4-1: +29 s; 4-3: +46 s, depois do
// combate; 5-3: +33 s). E a análise velha que terminava depois sobrescrevia o feed com o ouro e o estágio da rodada de antes.
//
// A decisão de nível/rolagem/economia (strategy.mjs) não precisa da base nova: lê ouro, XP, nível, estágio, vida, rivais e
// o plano. Aqui ela é refeita na hora sobre os planos do último corpo publicado, e o corpo vai ao feed do overlay marcado
// `provisional`. Quando a análise completa chega, vale ela; se ela foi feita com uma economia que já mudou (análise
// atrasada), o feed recebe o corpo dela com a economia de agora refeita do mesmo jeito. Nada aqui lê disco ou relógio
// implícito; quem grava é o feed recebido (app/overlay-feed.mjs).
import { strategy } from "../strategy.mjs";
import { stageText } from "../core/state/clock.mjs";

/** A economia que decide o conselho: partida, estágio-rodada, ouro, nível (e se é estimado) e XP. */
export function economyKey(gameId, options) {
  return JSON.stringify([
    gameId ?? null,
    stageText(options?.stage),
    options?.gold ?? null,
    options?.level ?? null,
    options?.levelEstimated === true,
    options?.xp ?? null,
  ]);
}

/**
 * O corpo `body` (resposta de uma análise ao vivo, como o feed guarda) com a estratégia de cada plano (`preview` e
 * `recommendations[]`) refeita para a economia de `options` (`gold`, `level`, `levelEstimated`, `levelSource`, `xp`,
 * `stage`, `streak`, `trend`). `sameRound` = a rodada é a mesma do corpo: a loja classificada nele ainda vale; numa rodada
 * nova a loja é outra, então as compras dela saem do campo (a análise completa classifica a loja nova). `augmentTraits` =
 * sinergias dos aprimoramentos escolhidos (o mesmo `traits.grants` do grafo). Devolve um corpo novo (o original não muda)
 * ou null se o corpo não tem planos. Um plano cuja estratégia falhe fica como estava.
 */
export function refreshAdvice(
  body,
  options,
  { augmentTraits = [], sameRound = false, at = null } = {},
) {
  if (!body || !Array.isArray(body.recommendations)) return null;
  const opts = {
    level: options.level,
    gold: options.gold ?? null,
    stage: options.stage ?? null,
    streak: options.streak ?? null,
    trend: options.trend ?? null,
    xp: options.xp ?? null,
    levelEstimated: options.levelEstimated === true,
    augmentTraits,
    // O nível-alvo da última análise (o mesmo que escolheu o tamanho da comp).
    targetLevel: typeof body.targetLevel === "number" ? body.targetLevel : null,
  };
  const note = sameRound
    ? "Conselho refeito com o ouro, o XP e o nível de agora sobre o plano da última análise; a análise completa está a caminho."
    : `Rodada nova${opts.stage ? ` (${stageText(opts.stage)})` : ""}: conselho refeito com o ouro, o XP e o nível de agora sobre o plano da última análise; a loja nova e a análise completa estão a caminho.`;
  const redo = (plan) => {
    if (!plan?.strategy || !Array.isArray(plan.board) || !plan.stage)
      return plan;
    const field = sameRound
      ? plan.stage
      : { ...plan.stage, shop: [], buyNow: [] };
    try {
      const s = strategy({ ...plan, stage: field }, body, opts);
      return {
        ...plan,
        stage: field,
        strategy: { ...s, reasons: [note, ...(s.reasons ?? [])] },
      };
    } catch {
      return plan;
    }
  };
  return {
    ...body,
    ...(body.preview ? { preview: redo(body.preview) } : {}),
    recommendations: body.recommendations.map(redo),
    currentLevel: opts.level,
    levelEstimated: opts.levelEstimated,
    ...(options.levelSource ? { levelSource: options.levelSource } : {}),
    provisional: {
      at,
      stage: stageText(opts.stage),
      gold: opts.gold,
      level: opts.level,
      xp: opts.xp,
      newRound: !sameRound,
      reason: note,
    },
  };
}

/**
 * Liga o conselho rápido ao feed do overlay (`overlay`: createOverlayFeed). `now` = relógio (ms). Uso pelo pipeline
 * (app/recommend.mjs), só ao vivo:
 *  - `observe(gameId, options, augmentTraits)` assim que o estado de agora vira `options` (antes da análise pesada):
 *    se a economia mudou desde o corpo que o feed mostra (da mesma partida), grava nele o corpo com o conselho refeito.
 *    Devolve a chave da economia (para `publish`);
 *  - `publish(gameId, key, stage, { bytes | body })` quando a análise feita com a economia `key` termina: grava o corpo
 *    dela; se a economia já mudou (`observe` mais novo), grava o corpo dela com o conselho refeito para a economia de
 *    agora (a análise atrasada não traz de volta o ouro e o estágio da rodada anterior).
 */
export function createRoundAdvice({ overlay, now = Date.now }) {
  let latest = null, // { gameId, key, options, augmentTraits }: a economia mais nova lida
    shown = null; // { gameId, key, stage }: a economia do corpo que o feed mostra
  const roundOf = (options) => stageText(options?.stage);
  const refreshed = (body, sameRound) =>
    refreshAdvice(body, latest.options, {
      augmentTraits: latest.augmentTraits,
      sameRound,
      at: now(),
    });
  return {
    observe(gameId, options, augmentTraits = []) {
      const key = economyKey(gameId, options);
      latest = { gameId, key, options, augmentTraits };
      if (!shown || shown.gameId !== gameId || shown.key === key) return key;
      const body = overlay.recommendationBody();
      if (!body || body.metadata?.gameId !== gameId) return key;
      const round = roundOf(options),
        fresh = refreshed(body, round !== null && round === shown.stage);
      if (fresh) {
        overlay.recordRecommendation(fresh);
        shown = { gameId, key, stage: round };
      }
      return key;
    },
    publish(gameId, key, stage, { bytes = null, body = null } = {}) {
      const stale =
        latest &&
        latest.gameId === gameId &&
        key !== null &&
        latest.key !== key;
      if (stale) {
        const parsed = body ?? JSON.parse(Buffer.from(bytes).toString("utf8"));
        const round = roundOf(latest.options),
          fresh = refreshed(parsed, round !== null && round === stage);
        if (fresh) {
          overlay.recordRecommendation(fresh);
          shown = { gameId, key: latest.key, stage: round };
          return;
        }
      }
      if (bytes) overlay.recordRecommendationJson(bytes);
      else overlay.recordRecommendation(body);
      shown = { gameId, key, stage };
    },
    /** Estado (diagnóstico e testes). */
    status: () => ({ latest: latest?.key ?? null, shown: shown?.key ?? null }),
  };
}
