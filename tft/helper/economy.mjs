// Economia do TFT: renda, juros, XP, pressão de vida e a matemática de rolar (chance exata de fechar
// um upgrade e ganho esperado por ouro). Funções puras, sem I/O, usadas por strategy.mjs, stage.mjs,
// tactics.mjs e pelo mock da interface no navegador.
// Regras do jogo vêm de rules.mjs; POLICY reúne as regras de bolso desta ferramenta.
import { GAME, POOL } from "./rules.mjs";
import { POLICY } from "./core/economy/policy.mjs";
import { interestOf } from "./core/economy/gold.mjs";
import { starCopies } from "./core/pool/copies.mjs";
import { levelOdds } from "./core/pool/shop.mjs";
import { closeCurve as closeCurveAt } from "./core/pool/curve.mjs";
// A política (POLICY: todos os limiares de ouro e vida), os juros, a renda, a projeção, o calendário de rodadas e a faixa de
// vida moram em core/economy (M5b); a chance por slot, as cópias livres e a curva de fechar estrela, em core/pool (M4).
// economy.mjs reexporta o que o mock, os motores e os testes consomem por este caminho (o MESMO objeto POLICY).
export { POLICY } from "./core/economy/policy.mjs";
export {
  incomeOf,
  interestOf,
  interestTiers,
  maxInterestGold,
  nextTier,
  projectGold,
  shopsAhead,
  streakGold,
  tierFloor,
} from "./core/economy/gold.mjs";
export { isPvp, nextRound, roundLabel } from "./core/economy/rounds.mjs";
export { pressureOf } from "./core/economy/pressure.mjs";
export { freeByCost, freeOf } from "./core/pool/copies.mjs";
export { slotChance } from "./core/pool/shop.mjs";
export { binomialPmf } from "./core/pool/curve.mjs";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/* ---------- Ouro ---------- */
// Juros, renda e projeção: core/economy/gold.mjs (reexportados acima).

/** Valor de venda: 1★ devolve o custo; 2★/3★ devolvem as cópias menos 1 (custo 1 devolve tudo). */
export const sellValue = (cost, stars) =>
  stars <= 1
    ? cost
    : cost === 1
      ? starCopies(stars)
      : starCopies(stars) * cost - 1;

/* ---------- Rodadas ---------- */
// nextRound, isPvp, roundLabel e projectGold: core/economy (reexportados acima).

/** Nível da curva padrão no estágio-rodada lido. */
export function curveLevel(stage) {
  if (!stage) return null;
  let level = 3;
  for (const [s, r, l] of POLICY.curve)
    if (stage.stage > s || (stage.stage === s && stage.round >= r)) level = l;
  return level;
}

/* ---------- Nível ---------- */

/**
 * XP lido "atual/total": quanto falta, quantas compras de 4 XP e o ouro. `passive` indica que o XP passivo
 * da próxima rodada completa o nível de graça; `max` indica nível máximo (sem barra de XP).
 */
export function levelCostOf(xp) {
  const m = /^(\d+)\/(\d+)$/.exec(xp ?? "");
  if (!m) return null;
  const have = Number(m[1]),
    total = Number(m[2]);
  if (!total)
    return {
      have,
      total,
      need: 0,
      buys: 0,
      cost: null,
      passive: false,
      max: true,
    };
  const need = Math.max(0, total - have),
    buys = Math.ceil(need / GAME.xpPerBuy);
  return {
    have,
    total,
    need,
    buys,
    cost: buys * GAME.xpCost,
    passive: need > 0 && need <= GAME.passiveXp,
    max: false,
  };
}

/** Nível de reroll da comp: o da meta ou, sem ele, o do custo do carry (1→5, 2→6, 3→7). */
export const rerollLevelOf = (meta, carryCost) =>
  meta?.rerollLevel ?? { 1: 5, 2: 6, 3: 7 }[carryCost] ?? null;
/** Nível final da comp: Fast 9 vai a 9; os demais, ao maior entre o tamanho da comp, o reroll e 8. */
export const finalLevelOf = (meta, boardSize, rerollLevel) =>
  meta?.levelling === "Fast 9"
    ? 9
    : Math.min(10, Math.max(boardSize, rerollLevel ?? 8, 8));
/** Nível em que se rola pelo carry: o de reroll, ou o do custo (4→8, 5→9), sem passar do nível final. */
export const rollLevelOf = ({
  carryCost,
  finalLevel = 10,
  rerollLevel = null,
}) =>
  rerollLevel ??
  Math.min(finalLevel, { 1: 5, 2: 6, 3: 7, 4: 8, 5: 9 }[carryCost] ?? 8);

/* ---------- Pressão ---------- */

const mightOf = (units) =>
  (units ?? []).reduce(
    (n, u) =>
      n +
      (u.cost ?? u.price ?? 1) *
        POLICY.star[clamp(u.stars ?? u.starLevel ?? 1, 0, 3)] +
      ((u.items ?? u.itemNames)?.length ?? 0) * POLICY.itemMight,
    0,
  );

/** Força da sua board contra cada rival vivo (custo × estrelas + itens), posição no lobby e médias. */
export function lobbyStrength(analysis) {
  const self = analysis.self?.units ?? [],
    foes = analysis.opponents ?? [];
  const mine = mightOf(self),
    rivals = foes.map((o) => mightOf(o.units)).sort((a, b) => b - a);
  const rank = rivals.filter((v) => v > mine).length + 1,
    size = rivals.length + 1;
  const avg = (list) =>
    list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  return {
    mine,
    rivals,
    rank,
    size,
    weak: size >= 4 && rank > Math.ceil(size * 0.6),
    median: rivals[Math.floor(rivals.length / 2)] ?? 0,
    foeLevel: avg(foes.map((o) => o.units.length)),
    foeStars: avg(
      foes.map((o) => o.units.filter((u) => (u.stars ?? 1) >= 2).length),
    ),
    myStars: self.filter((u) => u.starLevel >= 2).length,
  };
}

/** 3★ disputado demais: muitas cópias com rivais (em campo ou estimadas no banco) ou fração alta da pool. */
export const isContested = (p) => {
  const held = (p?.enemy ?? 0) + (p?.hidden ?? 0);
  return (
    held >= POLICY.contested.copies ||
    held / (p?.total ?? POOL[p?.cost] ?? 1) > POLICY.contested.share
  );
};

/* ---------- Probabilidade de loja ---------- */

/**
 * Chance exata de juntar `goal` cópias gastando no máximo g de ouro, para g = 0..maxGold (padrão da política): a
 * conta é de `core/pool/curve.mjs`; aqui entra só o teto de ouro simulado, que é política da ferramenta.
 */
export const closeCurve = (args) =>
  closeCurveAt({ ...args, maxGold: args.maxGold ?? POLICY.simulation.maxGold });

/** Menor ouro com chance ≥ q na curva (null se não chegar). */
export function goldFor(curve, q) {
  for (let g = 0; g < curve.length; g++) if (curve[g] >= q - 1e-12) return g;
  return null;
}

/**
 * Resumo da curva exata para a interface: chance a cada loja (2g) até um pouco depois de 95%
 * (ou do gasto planejado), mais o ouro para 50%, 80% e 95%.
 */
export function curveSummary(curve, level, planned = null) {
  const q95 = goldFor(curve, 0.95),
    last = curve.length - 1;
  let top = Math.max(16, (q95 ?? last) + 6, planned ?? 0);
  top = Math.min(
    last - (last % GAME.shopCost),
    Math.ceil(top / GAME.shopCost) * GAME.shopCost,
  );
  const p = [];
  for (let g = 0; g <= top; g += GAME.shopCost)
    p.push(Math.round(curve[g] * 1e4) / 1e4);
  return {
    level,
    step: GAME.shopCost,
    p,
    q50: goldFor(curve, 0.5),
    q80: goldFor(curve, 0.8),
    q95,
  };
}

/** Gerador pseudoaleatório mulberry32: rápido e determinístico para a mesma semente. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rolagem simulada do time inteiro, para cada orçamento g = 0..maxGold, com todos os alvos disputando o mesmo
 * ouro e a mesma pool. `targets`: [{ cost, free, evolve?, steps: [{ copies, value }] }], em que `copies` é
 * quantas cópias comprar até o degrau render `value` e `evolve` (padrão: sim) diz se o primeiro degrau é uma
 * evolução de estrela (conta para "pelo menos uma evolui"; comprar uma peça nova não conta).
 * Monte Carlo com números aleatórios comuns: cada corrida rola até maxGold, compra o que aparecer (pagando
 * cada cópia) e registra o valor acumulado e o ouro gasto quando o primeiro alvo fecha o primeiro degrau; o
 * resultado com orçamento g é o estado no último ponto ≤ g. Assim as curvas são monótonas e orçamentos
 * vizinhos comparam as mesmas lojas. Uma passada só entrega:
 *  - `gain`: ganho esperado de força do time (soma dos degraus fechados, em pontos de força);
 *  - `any`: chance de pelo menos um dos alvos que evoluem fechar o primeiro degrau com g.
 * A política é comprar tudo o que aparecer do time (não foca numa peça só): é um piso para a chance de evoluir
 * alguma peça; focar numa peça só é a conta exata de `closeCurve`.
 */
export function rollSim({
  level,
  targets,
  denom,
  maxGold,
  runs = POLICY.simulation.runs,
  seed = POLICY.simulation.seed,
}) {
  const gain = new Float64Array(maxGold + 1),
    any = new Float64Array(maxGold + 1);
  const live = targets.filter((t) => t.steps.length && t.free > 0);
  if (!live.length || maxGold < GAME.shopCost) return { gain, any };
  const rand = mulberry32(seed),
    odds = levelOdds(level),
    n = live.length,
    chance = live.map((t) => (odds[t.cost - 1] ?? 0) / 100);
  const last = live.map((t) => t.steps.at(-1).copies),
    goal = live.map((t) => t.steps[0].copies),
    evolves = live.map((t) => t.evolve !== false);
  for (let run = 0; run < runs; run++) {
    const left = live.map((t) => t.free),
      bought = new Array(n).fill(0),
      pool = { ...denom };
    let spent = 0,
      value = 0,
      cursor = 0,
      firstAt = -1;
    const mark = () => {
      for (; cursor < spent && cursor <= maxGold; cursor++)
        gain[cursor] += value;
    };
    while (spent + GAME.shopCost <= maxGold) {
      spent += GAME.shopCost;
      for (let s = 0; s < GAME.shopSlots; s++) {
        let r = rand();
        for (let i = 0; i < n; i++) {
          const t = live[i],
            // A pool livre é fracionária: `left` pode terminar a corrida abaixo de zero (ex.: 0,4 e uma compra a mais).
            p =
              pool[t.cost] > 0 && left[i] > 0
                ? (chance[i] * left[i]) / pool[t.cost]
                : 0;
          if (r >= p) {
            r -= p;
            continue;
          }
          if (bought[i] < last[i] && spent + t.cost <= maxGold) {
            // Orçamentos abaixo do novo gasto não pagam esta cópia: ficam com o valor anterior.
            spent += t.cost;
            mark();
            bought[i]++;
            left[i]--;
            pool[t.cost]--;
            if (bought[i] === goal[i] && evolves[i] && firstAt < 0)
              firstAt = spent;
            for (const step of t.steps)
              if (step.copies === bought[i]) value += step.value;
          }
          break;
        }
      }
    }
    spent = maxGold + 1;
    mark();
    if (firstAt >= 0) any[firstAt]++;
  }
  let count = 0;
  for (let g = 0; g <= maxGold; g++) {
    count += any[g];
    any[g] = count / runs;
    gain[g] /= runs;
  }
  return { gain, any };
}

/**
 * Quanto rolar dentro de [0, max]: maximiza ganho(B) − preço × custo(B), com custo(B) = B + horizonte ×
 * juros perdidos ao cair de patamar, e preço = urgência × ganho médio por ouro de gastar o máximo.
 * Na prática: role enquanto a próxima loja render pelo menos a média do plano (descontada pela urgência).
 * Empates dentro de `spendTolerance` do melhor valor ficam com o maior gasto.
 */
export function bestSpend(gain, { gold, max, urgency, horizon }) {
  max = Math.max(0, Math.min(max, gain.length - 1));
  if (max < GAME.shopCost)
    return { spend: 0, gain: 0, price: 0, max, gainMax: gain[max] ?? 0 };
  const lost = (B) =>
    B + horizon * ((interestOf(gold) ?? 0) - (interestOf(gold - B) ?? 0));
  const price = (urgency * gain[max]) / (lost(max) || 1);
  let bestU = -Infinity;
  const utility = [];
  for (let B = 0; B <= max; B++) {
    utility[B] = gain[B] - price * lost(B);
    bestU = Math.max(bestU, utility[B]);
  }
  const tol = POLICY.spendTolerance * gain[max];
  let spend = 0;
  for (let B = max; B >= 0; B--)
    if (utility[B] >= bestU - tol) {
      spend = B;
      break;
    }
  // Sem nada a ganhar não há o que rolar.
  if (gain[spend] <= 0) spend = 0;
  return { spend, gain: gain[spend], price, max, gainMax: gain[max] };
}
