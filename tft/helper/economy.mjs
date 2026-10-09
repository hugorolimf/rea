// Economia do TFT: renda, juros, XP, pressão de vida e a matemática de rolar (chance exata de fechar
// um upgrade e ganho esperado por ouro). Funções puras, sem I/O, usadas por strategy.mjs, stage.mjs,
// tactics.mjs, playbook.mjs e pelo mock da interface no navegador.
// Regras do jogo vêm de rules.mjs; POLICY reúne as regras de bolso desta ferramenta.
import { GAME, ODDS, POOL } from "./rules.mjs";

/** Regras de bolso desta ferramenta (não do jogo). Todos os limiares de economia ficam aqui. */
export const POLICY = {
  // Nível esperado ao fim de cada estágio-rodada numa curva padrão: [estágio, rodada, nível].
  curve: [
    [2, 1, 4],
    [2, 5, 5],
    [3, 2, 6],
    [4, 1, 7],
    [4, 5, 8],
    [5, 5, 9],
  ],
  // Faixas de vida. Perigo: HP ≤ danger, ou ≤ dangerLate a partir do estágio lateStage, ou ≤ weak com board fraca.
  hp: {
    critical: 20,
    danger: 30,
    dangerLate: 45,
    weak: 50,
    hurt: 60,
    fastReroll: 50,
  },
  lateStage: 4,
  // Ouro que fica guardado depois de gastar, por faixa; no reroll lento o piso é 50 e no rápido, fastReroll.
  floor: { healthy: 50, hurt: 30, danger: 10, critical: 0, fastReroll: 20 },
  // Peso do ouro futuro frente à força agora: 1 = cada ouro precisa render a média do plano; 0 = gaste tudo.
  urgency: { healthy: 1, hurt: 0.6, danger: 0.25, critical: 0 },
  // Rodadas de juros em jogo quando o gasto derruba o patamar.
  horizon: { healthy: 3, hurt: 2, danger: 1, critical: 0 },
  // 3★ disputado: desista com tantas cópias com rivais ou acima desta fração da pool.
  contested: { copies: 6, share: 0.35 },
  // Força de uma unidade = custo × fator da estrela (+ itens); a mesma régua do lobby.
  star: [0, 1, 1.8, 3.2],
  itemMight: 0.6,
  // Valor de um upgrade no ganho esperado: carry pesa mais, cada item equipado soma 25%; unidade nova vale metade.
  carryWeight: 2,
  itemWeight: 0.25,
  newUnitWeight: 0.5,
  // Simulação de rolagem: corridas, semente fixa (resultado determinístico) e teto de ouro simulado.
  simulation: { runs: 500, seed: 0x7f4a7c15, maxGold: 120 },
  // Fração do ganho máximo que ainda conta como "tão bom quanto" ao escolher quanto rolar.
  spendTolerance: 0.04,
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const MAX_INTEREST_GOLD = GAME.interestStep * GAME.interestMax;

/* ---------- Ouro ---------- */

/** Juros pagos na próxima rodada para `gold` guardado. */
export const interestOf = (gold) =>
  gold == null
    ? null
    : Math.min(
        GAME.interestMax,
        Math.floor(Math.max(0, gold) / GAME.interestStep),
      );
/** Próximo patamar de juros (null no máximo ou sem ouro lido). */
export const nextTier = (gold) =>
  gold == null || gold >= MAX_INTEREST_GOLD
    ? null
    : (Math.floor(gold / GAME.interestStep) + 1) * GAME.interestStep;
/** Patamar de juros atual (múltiplo de 10 abaixo do ouro, até 50). */
export const tierFloor = (gold) =>
  Math.min(
    MAX_INTEREST_GOLD,
    Math.floor(Math.max(0, gold) / GAME.interestStep) * GAME.interestStep,
  );

/** Ouro extra por rodada de uma sequência de `length` vitórias ou derrotas. */
export function streakGold(length) {
  for (const [min, gold] of GAME.streakGold) if (length >= min) return gold;
  return 0;
}

/** Renda da próxima rodada guardando `gold`: base + juros + sequência (vitória não é prevista). */
export function incomeOf(gold, streak = null) {
  const interest = interestOf(gold) ?? 0,
    bonus = streakGold(streak?.length ?? 0);
  return {
    base: GAME.baseIncome,
    interest,
    streak: bonus,
    total: GAME.baseIncome + interest + bonus,
  };
}

/** Valor de venda: 1★ devolve o custo; 2★/3★ devolvem as cópias menos 1 (custo 1 devolve tudo). */
export const sellValue = (cost, stars) =>
  stars <= 1
    ? cost
    : cost === 1
      ? 3 ** (stars - 1)
      : 3 ** (stars - 1) * cost - 1;

/* ---------- Rodadas ---------- */

const roundsIn = (stage) =>
  stage === 1 ? GAME.stageOneRounds : GAME.stageRounds;
/** Rodada seguinte a `{stage, round}`. */
export const nextRound = ({ stage, round }) =>
  round >= roundsIn(stage)
    ? { stage: stage + 1, round: 1 }
    : { stage, round: round + 1 };
/** Rodada contra jogador (as únicas que contam para sequência). */
export const isPvp = ({ stage, round }) =>
  stage >= 2 && round !== GAME.carouselRound && round !== GAME.pveRound;
export const roundLabel = (r) => `${r.stage}-${r.round}`;
const roundIndex = ({ stage, round }) =>
  stage <= 1
    ? round
    : GAME.stageOneRounds + (stage - 2) * GAME.stageRounds + round;

/**
 * Ouro no início das próximas `rounds` rodadas se você gastar `spend` agora e só economizar depois.
 * Cada rodada paga base + juros sobre o ouro guardado + sequência atual (mantida); vitórias não entram.
 */
export function projectGold(
  gold,
  { spend = 0, stage = null, streak = null, rounds = 4 } = {},
) {
  if (gold == null) return [];
  let g = Math.max(0, gold - spend),
    at = stage;
  const out = [];
  for (let i = 0; i < rounds; i++) {
    const income = incomeOf(g, streak);
    g += income.total;
    at = at ? nextRound(at) : null;
    out.push({
      label: at ? roundLabel(at) : `+${i + 1}`,
      gold: g,
      interest: interestOf(g),
      income: income.total,
    });
  }
  return out;
}

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

/**
 * Faixa de vida usada por todas as decisões de gasto: crítica, perigo, ferido ou saudável,
 * com o piso de ouro, a urgência e o horizonte de juros de cada faixa.
 */
export function pressureOf({ hp, stage = null, weak = false }) {
  const H = POLICY.hp;
  const critical = hp <= H.critical,
    danger =
      critical ||
      hp <= H.danger ||
      (hp <= H.dangerLate && (stage?.stage ?? 0) >= POLICY.lateStage) ||
      (weak && hp <= H.weak);
  const band = critical
    ? "critical"
    : danger
      ? "danger"
      : hp <= H.hurt
        ? "hurt"
        : "healthy";
  return {
    band,
    danger,
    critical,
    floor: POLICY.floor[band],
    urgency: POLICY.urgency[band],
    horizon: POLICY.horizon[band],
  };
}

/** 3★ disputado demais: muitas cópias com rivais ou fração alta da pool. */
export const isContested = (p) =>
  (p?.enemy ?? 0) >= POLICY.contested.copies ||
  (p?.enemy ?? 0) / (p?.total ?? POOL[p?.cost] ?? 1) > POLICY.contested.share;

/* ---------- Probabilidade de loja ---------- */

/** Cópias livres somadas por custo: o denominador da chance de cada campeão na loja. */
export function freeByCost(pool) {
  const free = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const p of pool ?? [])
    free[p.cost] = (free[p.cost] ?? 0) + Math.max(0, p.remainingUpper ?? 0);
  return free;
}

/** Chance de um slot da loja mostrar o campeão: odds do custo × cópias livres dele ÷ livres do custo. */
export const slotChance = (level, cost, copies, denom) =>
  denom > 0 && copies > 0
    ? ((ODDS[clamp(level, 1, 11)][cost - 1] ?? 0) / 100) * (copies / denom)
    : 0;

/** PMF da Binomial(n, p) por recorrência, sem fatoriais. */
export function binomialPmf(n, p) {
  const out = new Array(n + 1).fill(0);
  if (p <= 0) return ((out[0] = 1), out);
  if (p >= 1) return ((out[n] = 1), out);
  out[0] = (1 - p) ** n;
  for (let i = 0; i < n; i++)
    out[i + 1] = out[i] * ((n - i) / (i + 1)) * (p / (1 - p));
  return out;
}

/**
 * Chance exata de juntar `goal` cópias gastando no máximo g de ouro, para g = 0..maxGold.
 * Cadeia de Markov em (cópias compradas × ouro): cada loja custa 2g e mostra Binomial(5, p_k) cópias,
 * com p_k = odds × (livres − k) ÷ (livres do custo − k) — a pool encolhe a cada compra; cada cópia
 * comprada custa `cost`. Compra tudo o que aparecer e couber no ouro.
 */
export function closeCurve({
  level,
  cost,
  own,
  goal,
  free,
  denom,
  maxGold = POLICY.simulation.maxGold,
}) {
  const need = goal - own,
    curve = new Float64Array(maxGold + 1);
  if (need <= 0) return curve.fill(1);
  if (free < need || !cost) return curve;
  // f[k][g]: chance de fechar já tendo comprado k cópias e com g de ouro.
  const f = Array.from(
    { length: need + 1 },
    () => new Float64Array(maxGold + 1),
  );
  f[need].fill(1);
  const pmf = Array.from({ length: need }, (_, k) =>
    binomialPmf(GAME.shopSlots, slotChance(level, cost, free - k, denom - k)),
  );
  for (let g = GAME.shopCost; g <= maxGold; g++) {
    const left = g - GAME.shopCost,
      afford = Math.floor(left / cost);
    for (let k = need - 1; k >= 0; k--) {
      let v = 0;
      for (let x = 0; x <= GAME.shopSlots; x++) {
        const b = Math.min(x, need - k, afford);
        v += pmf[k][x] * f[k + b][left - b * cost];
      }
      f[k][g] = v;
    }
  }
  return f[0];
}

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
 * Ganho esperado de força por ouro gasto rolando, para g = 0..maxGold, com vários alvos disputando o mesmo
 * ouro e a mesma pool. `targets`: [{ cost, free, steps: [{ copies, value }] }], em que `copies` é quantas
 * cópias comprar até o degrau render `value`.
 * Monte Carlo com números aleatórios comuns: cada corrida rola até maxGold, compra o que aparecer (pagando
 * cada cópia) e registra o valor acumulado pelo ouro já gasto; o ganho com orçamento g é o valor no último
 * ponto ≤ g. Assim a curva é monótona e orçamentos vizinhos comparam as mesmas lojas.
 */
export function rollValue({
  level,
  targets,
  denom,
  maxGold,
  runs = POLICY.simulation.runs,
  seed = POLICY.simulation.seed,
}) {
  const gain = new Float64Array(maxGold + 1);
  const live = targets.filter((t) => t.steps.length && t.free > 0);
  if (!live.length || maxGold < GAME.shopCost) return gain;
  const rand = mulberry32(seed),
    odds = ODDS[clamp(level, 1, 11)],
    n = live.length;
  const last = live.map((t) => t.steps.at(-1).copies);
  for (let run = 0; run < runs; run++) {
    const left = live.map((t) => t.free),
      bought = new Array(n).fill(0),
      pool = { ...denom };
    let spent = 0,
      value = 0,
      cursor = 0;
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
            p =
              pool[t.cost] > 0
                ? ((odds[t.cost - 1] / 100) * left[i]) / pool[t.cost]
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
            for (const step of t.steps)
              if (step.copies === bought[i]) value += step.value;
          }
          break;
        }
      }
    }
    spent = maxGold + 1;
    mark();
  }
  for (let g = 0; g <= maxGold; g++) gain[g] /= runs;
  return gain;
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
