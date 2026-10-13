// Score de uma comp para o jogador agora (0 a 100): a VITÓRIA ESPERADA (W, engine.mjs: chance de terminar em 1º) numa
// régua, nada além dela. W é a medida das comps: o motor ordena as sugeridas por ela e decide a troca do plano em
// andamento por ela; a tela a mostra ("14,2% de vitória · 4,3º esperado"). O score é uma transformação monótona de W
// (core/comps/win.mjs `scoreFromWin`: 2% = 0, 12,5% = 50, 25% ≈ 78, sem teto), então a lista nunca mostra um score maior atrás de um menor por
// causa de pesos independentes. Sem W (quem chama sem ela), vale a régua antiga da colocação esperada E. Puro e sem I/O.
//
// W (e a colocação esperada E, que segue como informação) já leva tudo o que decide: a força medida (ou publicada) da comp com os seus itens, a chance de montá-la a tempo
// (alcance, core/comps/reach.mjs: o que você tem, a pool, os rivais, o ouro, o nível, a vida), o tabuleiro em que você
// fica se não montar, os aprimoramentos escolhidos e o plano de itens. As PARTES abaixo (itens, o que você tem, força,
// alcance, loja e disputa) são só informação para a tela: não entram no score.
//
// As faixas são política deste helper (não medidas): ficam aqui, num lugar só.

/** Régua do score: a colocação esperada que vale 100 e a que vale 0 (linear entre elas; menor é melhor). */
export const SCORE_SCALE = { best: 2, worst: 6 };
/** Colocação média que vale 0 e a que vale 1 na parte informativa de força (menor é melhor; 1 a 8). */
export const PLACEMENT_RANGE = { worst: 4.9, best: 2.9 };
/** Ganho em colocações (item-edge.mjs) que vale a parte "itens" cheia. */
export const ITEM_GAIN_FULL = 0.3;
/**
 * Escala do total do plano de itens (item-plan.mjs: soma do valor medido de cada item seu no campeão onde rende mais,
 * com o custo de mover/montar), em colocações: a parte de itens do plano é 1 − e^(−total / ITEM_PLAN_SCALE), então cada
 * item a mais soma, com retorno decrescente (1,5 colocações = 63%). Política deste helper, não medida.
 */
export const ITEM_PLAN_SCALE = 1.5;
/** Parte do item que vem do plano de itens (o resto é o ganho da build publicada da comp). */
export const ITEM_PLAN_SHARE = 0.6;
/** Cada ponto de disputa (escala do motor: 5 ou mais é "alta") vale isto no fator informativo, até MAX_CONTEST. */
export const CONTEST_PER_POINT = 0.07;
export const MAX_CONTEST = 0.45;

import { scoreFromWin } from "./core/comps/win.mjs";

const clamp = (v, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** Score (0 a 100) de uma colocação esperada: monótono (E menor, score maior); 0 sem E. */
export const scoreFromExpected = (expected) =>
  expected == null || !Number.isFinite(expected)
    ? 0
    : round(
        100 *
          clamp(
            (SCORE_SCALE.worst - expected) /
              (SCORE_SCALE.worst - SCORE_SCALE.best),
          ),
      );

/**
 * `win`: a vitória esperada W (fração; engine.mjs) — com ela, o score é W na régua; `expected`: a colocação esperada E
 * (engine.mjs: com o alcance, a reserva, os aprimoramentos e os itens), que vale para o score só sem W; `top4`: % de
 * top 4 da mesma conta (null sem dado). Partes informativas: `itemGain`/`carryItems`/`carryWanted`/`itemPlan` (itens),
 * `reach` (0..1: parte esperada da comp no prazo, compReach().share), `chance` (montá-la inteira no prazo,
 * compReach().chance; padrão = `reach`), `held` (0..1: o que você já tem, engine.mjs heldOf), `shopHits` (peças que
 * faltam e estão na loja) e `dispute` (disputa do motor).
 * Devolve `{ score, win, expected, top4, chance, parts, contest }`; `score` = scoreFromWin(win) (sem W,
 * scoreFromExpected(expected)); `win` em %.
 */
export function compScore({
  win = null,
  expected = null,
  top4 = null,
  itemGain = 0,
  carryItems = 0,
  carryWanted = 0,
  itemPlan = null,
  reach = 1,
  chance = reach,
  held = 0,
  shopHits = 0,
  dispute = 0,
}) {
  const placement =
      expected == null
        ? 0
        : clamp(
            (PLACEMENT_RANGE.worst - expected) /
              (PLACEMENT_RANGE.worst - PLACEMENT_RANGE.best),
          ),
    carryShare = carryWanted > 0 ? clamp(carryItems / carryWanted) : 0,
    // Com o plano de itens (banco lido), os itens que você tem somam pelo valor medido em cada campeão — sem "o carry";
    // sem ele, a conta de antes (ganho da build + itens do carry que a build pede).
    items =
      itemPlan == null
        ? clamp(0.6 * clamp(itemGain / ITEM_GAIN_FULL) + 0.4 * carryShare)
        : clamp(
            ITEM_PLAN_SHARE *
              (1 - Math.exp(-Math.max(0, itemPlan) / ITEM_PLAN_SCALE)) +
              (1 - ITEM_PLAN_SHARE) * clamp(itemGain / ITEM_GAIN_FULL),
          ),
    contest = 1 - clamp(dispute * CONTEST_PER_POINT, 0, MAX_CONTEST);
  const hasWin = win != null && Number.isFinite(win);
  return {
    score: hasWin ? scoreFromWin(win) : scoreFromExpected(expected),
    win: hasWin ? round(win * 100, 1) : null,
    expected: expected == null ? null : round(expected, 2),
    top4: top4 == null ? null : round(top4, 1),
    chance: round(clamp(chance), 3),
    parts: {
      items: round(items, 3),
      held: round(clamp(held), 3),
      placement: round(placement, 3),
      reach: round(clamp(reach), 3),
      shop: round(clamp(shopHits / 2), 3),
    },
    contest: round(contest, 3),
  };
}
