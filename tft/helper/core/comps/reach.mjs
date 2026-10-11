// Alcance de uma comp: a chance de MONTÁ-LA A TEMPO a partir do que você tem hoje, e o ouro que isso custa.
// Uma comp forte no papel com peças que ninguém tem no estágio 4 não é a melhor comp para você: o motor de comps
// (engine.mjs) usa esta conta no score (parte `reach`, comp-score.mjs) e na colocação esperada medida (chance de montar
// o que foi medido). ESM puro, sem I/O: a matemática de loja e de pool é a de core/pool, o ouro é o de core/economy e o
// calendário é o de core/state; aqui só se juntam as peças.
//
// O modelo (uma comp, várias peças que faltam):
//   1. Horizonte H (rodadas): da rodada de agora até o PONTO DE PODER da comp (a rodada da curva padrão em que o lobby
//      chega ao nível em que ela é jogada: `POLICY.curve`), pelo menos `minRounds`; cortado pelas derrotas que a vida
//      aguenta acima de `hpFloor` com o dano típico do estágio (`lossDamage`). Sem estágio lido: `unknownRounds`.
//   2. Ouro: o de agora mais a renda de H rodadas guardando (projectGold), menos a reserva. O motor recebe o ouro como
//      lojas ao alcance (economy.shopsAhead); `goldForShops` recupera o ouro dessa conta (a menos de 1 g).
//   3. Para cada nível L entre o de agora e o alvo: o ouro de XP para chegar a L (XP que falta menos o passivo de H
//      rodadas; sem o XP atual lido, conta do zero), o ouro para comprar as cópias que faltam (Σ cópias × custo) e o
//      resto vira rolagens. Lojas S = H (a loja grátis de cada rodada) + rolagens.
//   4. Chance de cada peça: ao menos `need` cópias em 5·S vagas, com a chance por vaga de core/pool/shop (odds do nível ×
//      cópias livres ÷ livres do custo), dividida por (1 + rivalShare × rivais que também têm a peça). Uma cópia que está
//      na loja agora conta como já vista. Teto observado abaixo do que falta: chance 0.
//   5. Chance da comp: produto das peças (as flex pesam `flexWeight` no expoente, como no motor). Vale o melhor nível.
//      Custo esperado: XP + compras + as rolagens até 50% de chance (null se não chega a 50% nem com `maxShops`).
//   Aproximações declaradas: as peças são tratadas como independentes (a mesma loja serve a todas); a pool não encolhe a
//   cada cópia comprada (a curva exata de uma peça só é core/pool/curve.mjs); as lojas grátis antes de subir de nível
//   contam com as odds do nível escolhido.
import { SHOP } from "../pool/tables.mjs";
import { starCopies, starsForCopies } from "../pool/copies.mjs";
import { chanceAtLeast, slotChance, slotsIn } from "../pool/shop.mjs";
import { POLICY } from "../economy/policy.mjs";
import { projectGold, shopsAhead } from "../economy/gold.mjs";
import { nextRound, roundLabel } from "../economy/rounds.mjs";
import { XP } from "../state/level.mjs";

/** Política deste helper (não medida): todos os números do modelo de alcance, num lugar só. */
export const REACH = {
  // Mesmo depois do ponto de poder, a comp ainda tem esta rodada e a próxima para ficar de pé.
  minRounds: 2,
  // Teto do horizonte (de 2-2 ao 4-5 são 16 rodadas: no começo, quase toda comp é alcançável e a força decide) e o
  // padrão sem estágio lido (o mesmo das lojas ao alcance).
  maxRounds: 16,
  unknownRounds: 4,
  // Rodada suposta quando só o estágio é conhecido (o motor só lê o número do estágio: a rodada não refaz a análise).
  assumedRound: 2,
  // Vida: o horizonte não passa de (vida − hpFloor) ÷ (taxa de derrota × dano por derrota) rodadas (no mínimo 1: a rodada
  // de agora). A taxa é a MEDIDA (derrotas recentes ÷ `trendRounds`, a janela de streak.mjs, entre `minLossRate` e 1) ou,
  // sem medida, `lossRate` (política: perder metade das rodadas enquanto monta). O dano é o medido (média das últimas
  // quedas, com amostra suficiente: POLICY.trend.drops) ou o típico do estágio (`lossDamage`). Antes supunha perder TODAS
  // as rodadas: no 3-2 com vida 60, 7,1 rodadas em vez das 10 até o 4-5.
  // É CONTÍNUO (rodadas fracionárias, a chance interpolada entre as rodadas inteiras vizinhas): sem degrau num limiar.
  lossDamage: { 2: 4, 3: 7, 4: 11, 5: 14, 6: 17, 7: 20 },
  hpFloor: 10,
  lossRate: 0.5,
  minLossRate: 0.25,
  trendRounds: 4,
  // Sequência de derrotas proposital (POLICY.lossStreak: até o estágio `lastStage`, vida acima de `hp` e ouro de pelo menos
  // `gold`): sem corte pela vida. A isenção entra numa faixa de `lossStreakBand` de vida e de ouro abaixo dos limiares
  // (interpolada), para não criar degrau.
  lossStreakBand: 10,
  // Ouro que sobra no fim da montagem (o mesmo colchão das lojas ao alcance).
  reserve: POLICY.shopsAhead.reserve,
  // Cada rival que também tem a peça leva esta fração das cópias que aparecerem para ele.
  rivalShare: 0.5,
  // Carry de custo até este: a comp precisa dele 2★ (custo 5 joga 1★). Peças de 3★ da comp reroll: 3★.
  carryTwoStarMaxCost: 4,
  // Peças fora do núcleo (carry e principais) pesam isto no expoente: a comp tem alternativas para elas.
  flexWeight: 0.5,
  // Lojas a mais que a busca do custo esperado tenta além do horizonte.
  maxShops: 200,
};

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Nível em que a comp é jogada: o de reroll, o "Fast N" do estilo ou o tamanho do tabuleiro. */
export function powerLevelOf({
  rerollLevel = null,
  levelling = null,
  size = 8,
} = {}) {
  if (Number.isInteger(rerollLevel) && rerollLevel > 0) return rerollLevel;
  const fast = /(\d+)/.exec(levelling ?? "");
  return fast ? Number(fast[1]) : size;
}

/** Rodada da curva padrão (`POLICY.curve`) em que o lobby chega ao nível; acima da curva, o último ponto. */
export function powerRound(level) {
  const hit =
    POLICY.curve.find(([, , lv]) => lv >= level) ?? POLICY.curve.at(-1);
  return { stage: hit[0], round: hit[1] };
}

/** Rodadas de `from` até `to` (0 se `to` já passou). */
export function roundsBetween(from, to) {
  let at = { stage: from.stage, round: from.round },
    n = 0;
  while (
    (at.stage < to.stage || (at.stage === to.stage && at.round < to.round)) &&
    n < 100
  ) {
    at = nextRound(at);
    n++;
  }
  return n;
}

/**
 * Horizonte de montagem: `{ rounds, deadline, label, byHp }`. `stage`: `{ stage, round }` lido (ou null);
 * `powerLevel`: nível em que a comp é jogada; `hp`: vida (null = sem corte pela vida).
 */
export function reachHorizon({
  stage = null,
  powerLevel = 8,
  hp = null,
  trend = null,
  gold = null,
} = {}) {
  const R = REACH;
  let rounds = R.unknownRounds,
    deadline = null;
  if (Number.isInteger(stage?.stage) && !Number.isInteger(stage?.round))
    stage = { stage: stage.stage, round: R.assumedRound };
  if (Number.isInteger(stage?.stage)) {
    const due = powerRound(powerLevel),
      left = roundsBetween(stage, due);
    deadline = left >= R.minRounds ? due : null;
    rounds = Math.max(R.minRounds, left);
  }
  rounds = Math.min(R.maxRounds, rounds);
  let byHp = false;
  if (Number.isFinite(hp)) {
    const T = POLICY.trend,
      L = POLICY.lossStreak,
      at = Math.min(7, Math.max(2, stage?.stage ?? 4)),
      measuredDmg =
        Number.isFinite(trend?.avgLoss) &&
        trend.avgLoss > 0 &&
        (trend.samples ?? T.drops) >= T.drops,
      dmg = measuredDmg ? trend.avgLoss : R.lossDamage[at],
      rate = Number.isFinite(trend?.recentLosses)
        ? Math.min(
            1,
            Math.max(R.minLossRate, trend.recentLosses / R.trendRounds),
          )
        : R.lossRate,
      lives = Math.max(1, (hp - R.hpFloor) / (rate * dmg)),
      // Isenção da sequência proposital, interpolada na faixa abaixo dos limiares (1 = isenta).
      band = (v, edge) =>
        clamp01((v - (edge - R.lossStreakBand)) / R.lossStreakBand),
      free =
        (stage?.stage ?? Infinity) <= L.lastStage
          ? band(hp, L.hp) * band(gold ?? POLICY.shopsAhead.assumedGold, L.gold)
          : 0,
      cap = lives + (rounds - lives) * free;
    if (cap < rounds) {
      rounds = cap;
      byHp = true;
      deadline = null;
    }
  }
  if (!deadline && stage?.stage) {
    let at = stage;
    for (let i = 0; i < Math.round(rounds); i++) at = nextRound(at);
    deadline = at;
  }
  return {
    rounds,
    deadline,
    label: deadline ? roundLabel(deadline) : `+${Math.round(rounds)} rodadas`,
    byHp,
  };
}

/** Ouro aproximado que deu `shops` lojas ao alcance (o inverso de core/economy shopsAhead; a menos de 1 g). */
export function goldForShops(shops) {
  if (!Number.isFinite(shops)) return POLICY.shopsAhead.assumedGold;
  let lo = 0,
    hi = 999;
  if (shopsAhead(lo) >= shops) return 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (shopsAhead(mid) >= shops) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Ouro para gastar em H rodadas: o de agora mais a renda guardando (core/economy projectGold), menos a reserva. */
export function reachBudget(gold, rounds) {
  const end = projectGold(gold, { rounds: Math.max(0, rounds - 1) }).at(
    -1,
  )?.gold;
  return Math.max(0, (end ?? gold ?? 0) - REACH.reserve);
}

/** Ouro de XP para ir de `from` a `to` em H rodadas (o passivo de cada rodada desconta; XP atual não lido = 0). */
export function levelGold(from, to, rounds) {
  let xp = 0;
  for (let l = from; l < to; l++) xp += XP.xpToNext[l] ?? 0;
  if (!xp) return 0;
  const passive = XP.passiveXp * Math.max(0, rounds - 1);
  return Math.max(0, xp - passive);
}

/**
 * Cópias que faltam de uma peça para a estrela-alvo: `goal` estrelas (1★, 2★, 3★) menos as cópias que você tem.
 */
export const copiesNeeded = (goal, own = 0) =>
  Math.max(0, starCopies(goal) - Math.max(0, own));

/** Chance de UMA peça juntar `need` cópias (as cartas dela na loja agora já contam) em `shops` lojas no nível. */
export function pieceChance(x, need, { level, shops, denom }) {
  const left = Math.max(0, need - Math.min(need, x.seen ?? 0));
  if (left <= 0) return 1;
  if ((x.upper ?? Infinity) < need) return 0;
  const q =
    slotChance(level, x.cost, x.free, denom[x.cost] ?? 0) /
    (1 + REACH.rivalShare * Math.max(0, x.rivals ?? 0));
  return chanceAtLeast(slotsIn(shops), q, left);
}

/**
 * Chance de juntar as cópias de todas as peças em `shops` lojas no nível `level` (produto, flex com expoente `weight`).
 * `pieces[]`: `{ need, cost, free, upper, rivals, seen, weight }`; `denom`: livres por custo (core/pool freeByCost).
 */
export function piecesChance(pieces, at) {
  let p = 1;
  for (const x of pieces) {
    if (x.need <= 0) continue;
    p *= pieceChance(x, x.need, at) ** (x.weight ?? 1);
    if (p <= 0) return 0;
  }
  return clamp01(p);
}

/**
 * Parte esperada da comp no prazo, de 0 a 1, ponderada por custo × peso: cada peça vale a chance de tê-la (a sua vale
 * 1) e, se a estrela-alvo passa de 1★, metade disso mais metade da chance de fechar a estrela. É a régua graduada do
 * score: com várias comps longe de montadas, ainda separa a que você está mais perto de ter.
 */
export function piecesShare(pieces, at) {
  let got = 0,
    all = 0;
  for (const x of pieces) {
    const w = x.cost * (x.weight ?? 1),
      have = (x.own ?? 0) > 0 ? 1 : pieceChance(x, 1, at),
      v =
        (x.goal ?? 1) > 1 && x.need > 0
          ? (have + pieceChance(x, x.need, at)) / 2
          : x.need > 0
            ? have
            : 1;
    got += w * v;
    all += w;
  }
  return all ? clamp01(got / all) : 1;
}

/**
 * Alcance de uma comp. Entradas:
 *  - `pieces[]`: as peças da comp `{ id, name, cost, own, goal, free, upper, rivals, seen, weight }` (`own` = cópias de
 *    1★ que você tem, `goal` = estrela-alvo, `seen` = cartas dela na loja agora);
 *  - `denom`: livres por custo; `level`/`maxLevel`: nível de agora e o mais alto a considerar;
 *  - `horizon` (reachHorizon) e `gold` (ouro de agora; null = suposição de core/economy).
 * Devolve `{ chance, share, level, rounds, deadline, budget, gold, levelGold, buyGold, shops, have, size, missing, text }`:
 * `chance` é a de montar tudo no melhor nível; `share` a parte esperada da comp no prazo (piecesShare); `gold` o custo esperado (até 50%), ou null.
 */
export function compReach({
  pieces = [],
  denom = {},
  level,
  maxLevel = level,
  horizon,
  gold = null,
  benchKnown = null,
}) {
  // Horizonte fracionário (vida): a conta nas rodadas inteiras vizinhas, interpolada (chance, parte esperada e ouro).
  if (!Number.isInteger(horizon.rounds)) {
    const lo = Math.floor(horizon.rounds),
      w = horizon.rounds - lo,
      args = { pieces, denom, level, maxLevel, gold, benchKnown },
      a = compReach({ ...args, horizon: { ...horizon, rounds: lo } }),
      b = compReach({ ...args, horizon: { ...horizon, rounds: lo + 1 } }),
      mix = (x, y) => (x == null || y == null ? (x ?? y) : x + (y - x) * w);
    const out = {
      ...(w < 0.5 ? a : b),
      chance: Math.round(mix(a.chance, b.chance) * 1000) / 1000,
      share: Math.round(mix(a.share, b.share) * 1000) / 1000,
      gold:
        a.gold == null || b.gold == null
          ? null
          : Math.round(mix(a.gold, b.gold)),
      rounds: Math.round(horizon.rounds * 10) / 10,
    };
    out.text = reachText({ ...out, rounds: Math.round(horizon.rounds) });
    return out;
  }
  const rounds = horizon.rounds,
    budget = reachBudget(gold ?? POLICY.shopsAhead.assumedGold, rounds),
    want = pieces.map((x) => ({
      ...x,
      need: copiesNeeded(x.goal ?? 1, x.own),
    })),
    buyGold = want.reduce((n, x) => n + x.need * x.cost, 0);
  let best = null;
  const top = Math.max(level, Math.min(10, maxLevel));
  for (let lv = level; lv <= top; lv++) {
    const xpGold = levelGold(level, lv, rounds),
      left = budget - xpGold - buyGold;
    // Sem ouro para comprar todas as cópias, a comp inteira não fecha; a parte esperada conta só as lojas grátis.
    const shops = rounds + Math.floor(Math.max(0, left) / SHOP.cost),
      at = { level: lv, shops, denom },
      chance =
        left < 0 && want.some((x) => x.need > 0) ? 0 : piecesChance(want, at),
      share = piecesShare(want, at);
    if (
      !best ||
      chance > best.chance + 1e-9 ||
      (chance >= best.chance - 1e-9 && share > best.share + 1e-9)
    )
      best = { level: lv, chance, share, shops, xpGold };
  }
  // Custo esperado: lojas até 50% de chance no melhor nível (busca binária; a chance só cresce com as lojas).
  let cost = null;
  if (want.every((x) => x.need <= 0)) cost = 0;
  else {
    const at = (s) =>
      piecesChance(want, { level: best.level, shops: s, denom });
    let lo = rounds,
      hi = rounds + REACH.maxShops;
    if (at(hi) >= 0.5) {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (at(mid) >= 0.5) hi = mid;
        else lo = mid;
      }
      const shops = at(rounds) >= 0.5 ? rounds : hi;
      cost = best.xpGold + buyGold + SHOP.cost * Math.max(0, shops - rounds);
    }
  }
  const missing = want
    .filter((x) => x.need > 0)
    .map((x) => ({
      id: x.id,
      name: x.name,
      cost: x.cost,
      need: x.need,
      owned: (x.own ?? 0) > 0,
    }));
  const out = {
    chance: Math.round(best.chance * 1000) / 1000,
    share: Math.round(best.share * 1000) / 1000,
    level: best.level,
    rounds,
    deadline: horizon.label,
    byHp: horizon.byHp,
    budget,
    gold: cost,
    levelGold: best.xpGold,
    buyGold,
    shops: best.shops,
    have: pieces.filter((x) => (x.own ?? 0) > 0).length,
    // De onde vêm as peças que você tem: em campo ou só na reserva (`onBoard`). `benchKnown`: a reserva foi lida (true),
    // não foi (false: "não sei", nunca "vazia") ou o chamador não disse (null).
    onBoard: pieces.filter((x) => (x.own ?? 0) > 0 && x.onBoard !== false)
      .length,
    onBench: pieces.filter((x) => (x.own ?? 0) > 0 && x.onBoard === false)
      .length,
    benchKnown,
    // Peças suas que já estão na estrela-alvo acima de 1★ (o carry 2★, a 3★ da reroll): a linha as cita.
    ready: pieces
      .filter((x) => (x.goal ?? 1) > 1 && copiesNeeded(x.goal, x.own) === 0)
      .map((x) => `${x.name} ${starsForCopies(x.own)}★`),
    size: pieces.length,
    missing,
  };
  out.text = reachText(out);
  return out;
}

const pct = (p) =>
  p >= 0.995 ? "~100%" : p > 0 && p < 0.01 ? "<1%" : `~${Math.round(p * 100)}%`;

/**
 * Uma linha: "você tem 4/8; faltam 2 peças de custo 3 e 1 de custo 4 (+2 cópias de Ahri para o 2★); ~35% de achar até o
 * 4-5 no nível 8".
 */
export function reachText(r) {
  const fresh = r.missing.filter((m) => !m.owned),
    byCost = new Map();
  for (const m of fresh) byCost.set(m.cost, (byCost.get(m.cost) ?? 0) + 1);
  const parts = [...byCost]
      .sort((a, b) => a[0] - b[0])
      .map(
        ([cost, n]) => `${n} ${n === 1 ? "peça" : "peças"} de custo ${cost}`,
      ),
    lacks = parts.length
      ? `${fresh.length === 1 ? "falta" : "faltam"} ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}` : parts[0]}`
      : "nenhuma peça nova falta",
    copies = r.missing
      .filter((m) => m.owned)
      .map(
        (m) => `+${m.need} ${m.need === 1 ? "cópia" : "cópias"} de ${m.name}`,
      );
  const where =
      r.benchKnown === false
        ? " em campo (reserva não lida)"
        : r.onBench
          ? ` (${r.onBoard} em campo, ${r.onBench} na reserva)`
          : "",
    have = `você tem ${r.have}/${r.size}${where}${r.ready?.length ? ` (${r.ready.join(", ")} já ${r.ready.length === 1 ? "pronto" : "prontos"})` : ""}`;
  if (!r.missing.length) return `${have}: a comp já está montada`;
  const until = r.byHp
    ? `em ${r.rounds} ${r.rounds === 1 ? "rodada" : "rodadas"} (o que a vida aguenta)`
    : `até o ${r.deadline}`;
  return `${have}; ${lacks}${copies.length ? ` (${copies.join(", ")})` : ""}; ${pct(r.chance)} de achar ${until} no nível ${r.level}`;
}
