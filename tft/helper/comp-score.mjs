// Score de uma comp para o jogador agora (0 a 100), no lugar das faixas S/A/B/C da colocação média publicada.
// Ordem de prioridade (peso): itens que você tem; o que você já tem em campo (campeão 1★/2★/3★ pelo custo, mais a
// chance de subir de estrela com o seu nível); força medida da comp; chance de montar as peças principais no SEU nível
// com a pool de agora; e a loja de agora. A disputa dos rivais desconta o total. Puro e sem I/O.
//
// Os pesos e as faixas são política deste helper (não medidos): ficam aqui, num lugar só, para poderem ser ajustados.
// A colocação esperada, quando existe, é a medida (engine.mjs, evidência da MetaTFT).

/** Peso de cada parte no score, somando 1. Itens primeiro: o que você tem em mãos decide entre comps parecidas. */
export const WEIGHTS = {
  items: 0.3,
  held: 0.25,
  placement: 0.2,
  chance: 0.15,
  shop: 0.1,
};
/** Colocação média que vale 0 e a que vale 100 na parte de força (menor é melhor; 1 a 8). */
export const PLACEMENT_RANGE = { worst: 4.9, best: 3.9 };
/** Ganho em colocações (item-edge.mjs) que vale a parte "itens" cheia. */
export const ITEM_GAIN_FULL = 0.3;
/**
 * Escala do total do plano de itens (item-plan.mjs: soma do valor medido de cada item seu no campeão onde rende mais,
 * com o custo de mover/montar), em colocações: a parte de itens do plano é 1 − e^(−total / ITEM_PLAN_SCALE), então cada
 * item a mais soma, com retorno decrescente (1,5 colocações = 63%). Política deste helper, não medida.
 */
export const ITEM_PLAN_SCALE = 1.5;
/** Parte do item do score que vem do plano de itens (o resto é o ganho da build publicada da comp). */
export const ITEM_PLAN_SHARE = 0.6;
/** Cada ponto de disputa (escala do motor: 5 ou mais é "alta") desconta isto do total, até MAX_CONTEST. */
export const CONTEST_PER_POINT = 0.07;
export const MAX_CONTEST = 0.45;

const clamp = (v, lo = 0, hi = 1) =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * `expected`: colocação esperada (medida, com seus itens e a chance de montar) ou, sem ela, a média ajustada aos itens;
 * `itemGain`: ganho em colocações dos itens que você tem nas builds da comp; `carryItems`/`carryWanted`: itens do carry
 * que você tem e quantos a build pede; `itemPlan`: total do plano de itens (null sem o banco lido); `chanceNow`: chance de achar as peças principais que faltam com o seu nível;
 * `chancePlan`: o mesmo no nível alvo; `held` (0..1): valor do que você já tem da comp, ponderado pelo custo, pela
 * estrela atual e pela chance de subir de estrela (engine.mjs, heldOf); `shopHits`: peças que faltam e estão na loja
 * agora; `dispute`: disputa do motor (soma por peça das cópias com rivais ÷ pool × 12).
 * Devolve `{ score, chance, chancePlan, parts, contest }`; `parts` em 0..1 antes dos pesos, `contest` é o fator
 * aplicado ao total (1 = sem desconto).
 */
export function compScore({
  expected = null,
  itemGain = 0,
  carryItems = 0,
  carryWanted = 0,
  itemPlan = null,
  chanceNow = 1,
  chancePlan = null,
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
    // A chance pesa pelo nível de agora e, em parte, pelo nível alvo (o plano de subir): sem o alvo, só o de agora.
    chance = clamp(
      chancePlan == null ? chanceNow : 0.6 * chanceNow + 0.4 * chancePlan,
    ),
    heldPart = clamp(held),
    shop = clamp(shopHits / 2),
    contest = 1 - clamp(dispute * CONTEST_PER_POINT, 0, MAX_CONTEST),
    sum =
      WEIGHTS.items * items +
      WEIGHTS.placement * placement +
      WEIGHTS.chance * chance +
      WEIGHTS.held * heldPart +
      WEIGHTS.shop * shop;
  return {
    score: round(100 * sum * contest),
    chance: round(chanceNow, 3),
    chancePlan: chancePlan == null ? null : round(chancePlan, 3),
    parts: {
      items: round(items, 3),
      held: round(heldPart, 3),
      placement: round(placement, 3),
      chance: round(chance, 3),
      shop: round(shop, 3),
    },
    contest: round(contest, 3),
  };
}
