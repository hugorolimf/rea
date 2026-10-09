// Ação de agora: comprar, economizar, subir de nível ou rolar a loja, com quanto gastar e por quê.
// Entradas: estágio, nível, XP e ouro (lidos da tela), HP e pool (arquivo do jogo), a loja lida, a sequência
// inferida pelo servidor e o estilo da comp alvo vindo da meta ("lvl N" = reroll naquele nível, "Fast 8", ...).
// Aqui fica a árvore de decisão; a matemática (chance de fechar, ganho por ouro, juros, renda) está em economy.mjs.
// Não simula combate.
import { GAME, ODDS } from "./rules.mjs";
import {
  POLICY,
  bestSpend,
  closeCurve,
  curveLevel,
  curveSummary,
  finalLevelOf,
  freeByCost,
  incomeOf,
  interestOf,
  isContested,
  levelCostOf,
  lobbyStrength,
  nextTier,
  pressureOf,
  projectGold,
  rerollLevelOf,
  rollLevelOf,
  rollValue,
  sellValue,
  streakGold,
} from "./economy.mjs";

const STAR = POLICY.star;
const round1 = (v) => Math.round(v * 10) / 10;
const pct = (p) => `${Math.round(p * 100)}%`;
const shopsIn = (gold) => Math.floor(gold / GAME.shopCost);
const CURVE_MAX = POLICY.simulation.maxGold;

/**
 * Alvos da simulação de rolagem: upgrades das suas unidades (campo e banco, sem contar duplicatas) e as
 * peças novas da comp. O valor de cada degrau é custo × ganho de estrela, com peso extra para o carry e
 * para unidades com itens.
 */
function rollTargets(plan, analysis, pool) {
  const stars3 = new Set(plan.meta?.stars3 ?? []),
    mine = new Map();
  const note = (id, name, cost, stars, items) => {
    const t = mine.get(name) ?? { id, name, cost, stars: 0, items: 0 };
    t.stars = Math.max(t.stars, stars);
    t.items += items;
    mine.set(name, t);
  };
  for (const u of analysis.self.units ?? [])
    note(
      u.championName,
      u.name,
      u.price ?? 1,
      u.starLevel ?? 1,
      u.itemNames?.length ?? 0,
    );
  for (const u of analysis.self.reserve ?? [])
    note(
      u.championName ?? u.id,
      u.name,
      u.cost ?? 1,
      u.stars ?? u.starLevel ?? 1,
      0,
    );
  const targets = [];
  for (const t of mine.values()) {
    const p = pool.get(t.name);
    if (!p || t.stars >= 3) continue;
    const w =
        (t.name === plan.carry ? POLICY.carryWeight : 1) *
        (1 + POLICY.itemWeight * t.items),
      own = p.own ?? 0,
      steps = [];
    if (own < 3)
      steps.push({ copies: 3 - own, value: w * t.cost * (STAR[2] - STAR[1]) });
    if (own < 9 && (stars3.has(t.id) || 9 - own <= 3))
      steps.push({ copies: 9 - own, value: w * t.cost * (STAR[3] - STAR[2]) });
    const free = p.remainingUpper ?? 0,
      possible = steps.filter((s) => s.copies <= free);
    if (possible.length)
      targets.push({ name: t.name, cost: t.cost, free, steps: possible });
  }
  for (const b of plan.stage?.buyNow ?? []) {
    const p = pool.get(b.name);
    if (mine.has(b.name) || !p?.remainingUpper) continue;
    const w = b.name === plan.carry ? POLICY.carryWeight : 1,
      steps = [
        { copies: 1, value: w * b.cost * STAR[1] * POLICY.newUnitWeight },
      ];
    if (b.name === plan.carry && p.remainingUpper >= 3)
      steps.push({ copies: 3, value: w * b.cost * (STAR[2] - STAR[1]) });
    targets.push({ name: b.name, cost: b.cost, free: p.remainingUpper, steps });
  }
  return targets;
}

/** Unidades do banco fora da comp alvo: o ouro que a venda libera num all-in. */
function sellableOf(plan, analysis) {
  const goal = new Set(plan.board.map((u) => u.id));
  const units = (analysis.self.reserve ?? [])
    .filter((u) => !goal.has(u.championName ?? u.id))
    .map((u) => {
      const stars = u.stars ?? u.starLevel ?? 1;
      return {
        id: u.championName ?? u.id,
        name: u.name,
        stars,
        value: sellValue(u.cost ?? 0, stars),
      };
    })
    .filter((u) => u.value > 0)
    .sort((a, b) => b.value - a.value);
  return { gold: units.reduce((n, u) => n + u.value, 0), units };
}

function decide(plan, analysis, options) {
  const gold = options.gold,
    level = options.level,
    hp = analysis.self.health,
    stage = options.stage ?? null,
    meta = plan.meta ?? null,
    streak = options.streak ?? null;
  const xp = levelCostOf(options.xp),
    xpNeed = xp?.need ?? null,
    levelCost = xp?.cost ?? null;
  const pool = new Map(analysis.pool.map((p) => [p.name, p])),
    denom = freeByCost(analysis.pool),
    board = plan.board;
  const carry = board.find((u) => u.name === plan.carry) ?? board[0];
  const rerollLevel = rerollLevelOf(meta, carry?.cost);
  const finalLevel = finalLevelOf(meta, board.length, rerollLevel);
  const rollAt = rollLevelOf({
    carryCost: carry?.cost,
    finalLevel,
    rerollLevel,
  });
  const sellable = sellableOf(plan, analysis);
  const steps = [],
    reasons = [];
  let ev = null,
    lobbyInfo = null,
    pressure = null,
    cash = gold,
    shopSpend = 0;
  const out = (action, headline, extra = {}) => {
    if (ev?.roll.gold >= GAME.shopCost)
      reasons.push(
        `Ganho esperado de força: rolar ${ev.roll.gold}g ≈ +${ev.roll.gain}${levelCost ? `; subir de nível (${levelCost}g) ≈ +${ev.level.gain}` : ""}.`,
      );
    return {
      action,
      headline,
      steps,
      reasons,
      ev,
      lobby: lobbyInfo,
      pressure: pressure?.band ?? null,
      style: meta?.levelling || null,
      rerollLevel,
      finalLevel,
      rollAt,
      levelCost,
      xpNeed,
      passiveLevel: xp?.passive ?? false,
      shopSpend,
      cash,
      sellable,
      interestAt: gold === null ? null : (nextTier(gold) ?? 50),
      ...extra,
    };
  };
  if (hp <= 0) return out("ENCERRADA", "Partida encerrada para o Hero");
  // Cartas da loja que o plano manda comprar vêm antes de qualquer outra decisão.
  const shopBuys = (plan.stage?.shop ?? []).filter(
    (s) => s.action === "comprar",
  );
  if (shopBuys.length)
    steps.push(
      "Compre na loja: " +
        shopBuys.map((s) => `${s.name} (${s.cost}g, ${s.reason})`).join("; ") +
        ".",
    );
  if (gold === null) {
    reasons.push(
      "Ouro não lido da tela: sem ele não dá para calcular rolagem nem juros.",
    );
    return out(
      shopBuys.length ? "COMPRAR" : "AGUARDAR",
      "Compre o que o plano pede; ouro ainda não foi lido",
    );
  }
  // O ouro das compras da loja sai antes de qualquer rolagem ou XP.
  shopSpend = shopBuys.reduce((n, s) => n + s.cost, 0);
  cash = Math.max(0, gold - shopSpend);
  // Progresso dos alvos de 3★ (9 cópias).
  const stars3 = (meta?.stars3 ?? [])
    .map((id) => board.find((u) => u.id === id))
    .filter(Boolean);
  const progress = stars3.map((u) => {
    const p = pool.get(u.name),
      own = p?.own ?? 0,
      need = Math.max(0, 9 - own),
      left = p?.remainingUpper ?? 0;
    return {
      name: u.name,
      own,
      need,
      left,
      enemy: p?.enemy ?? 0,
      possible: left >= need,
      contested: isContested(p),
      done: need === 0,
    };
  });
  const open3 = progress.filter((p) => !p.done),
    blocked = open3.filter((p) => !p.possible || p.contested);
  const carryPool = pool.get(carry?.name),
    carryOwn = carryPool?.own ?? 0;
  // Força da board contra o lobby e faixa de vida: uma régua só para todas as decisões.
  const lob = lobbyStrength(analysis);
  lobbyInfo = {
    rank: lob.rank,
    size: lob.size,
    mine: Math.round(lob.mine),
    median: Math.round(lob.median),
    foeLevel: round1(lob.foeLevel),
    foeStars: round1(lob.foeStars),
    myStars: lob.myStars,
    weak: lob.weak,
  };
  if (lob.size > 1)
    reasons.push(
      `Força da sua board: ${lob.rank}º de ${lob.size} no lobby (${Math.round(lob.mine)} contra mediana ${Math.round(lob.median)})${lob.weak ? ": abaixo da maioria, priorize upgrades" : ""}.`,
    );
  if (analysis.opponents?.length)
    reasons.push(
      `Rivais: nível médio ${lobbyInfo.foeLevel} (você ${level}) e ${lobbyInfo.foeStars} unidades 2★+ em média (você ${lob.myStars}).`,
    );
  pressure = pressureOf({ hp, stage, weak: lob.weak });
  const levelGap = analysis.opponents?.length ? lob.foeLevel - level : 0;
  // Ganho esperado de cada uso do ouro: rolar (simulado com a pool real) contra subir de nível.
  const gain = rollValue({
    level,
    targets: rollTargets(plan, analysis, pool),
    denom,
    maxGold: Math.min(
      CURVE_MAX,
      cash + (pressure.critical ? sellable.gold : 0),
    ),
  });
  const nextOdds = ODDS[Math.min(11, level + 1)],
    levelGain = nextOdds.reduce((n, o, i) => n + (o / 100) * (i + 1), 0); // uma vaga a mais com uma unidade 1★ típica do nível seguinte
  const floor = pressure.floor,
    spare = Math.max(0, cash - floor),
    behind = (stage ? level < curveLevel(stage) : false) || levelGap >= 1;
  const budget = (max) =>
    bestSpend(gain, {
      gold: cash,
      max,
      urgency: pressure.urgency,
      horizon: pressure.horizon,
    });
  const commit = (choice) => {
    ev.roll = {
      gold: choice.spend,
      gain: round1(choice.gain),
      perGold: choice.spend ? choice.gain / choice.spend : 0,
      max: choice.max,
      gainMax: round1(choice.gainMax),
    };
    if (choice.spend >= GAME.shopCost && choice.spend < choice.max)
      reasons.push(
        `Pare em ${choice.spend}g: depois disso cada loja rende menos que a média do plano (${choice.max}g renderiam +${round1(choice.gainMax)} de força; ${choice.spend}g já rendem +${round1(choice.gain)}).`,
      );
    return choice.spend;
  };
  const first = budget(spare);
  ev = {
    roll: {
      gold: first.spend,
      gain: round1(first.gain),
      perGold: first.spend ? first.gain / first.spend : 0,
      max: first.max,
      gainMax: round1(first.gainMax),
    },
    level: {
      cost: levelCost,
      gain: round1(levelGain),
      perGold: levelCost ? levelGain / levelCost : 0,
    },
  };
  if (stage)
    reasons.push(
      `Estágio ${stage.stage}-${stage.round}: a curva padrão está no nível ${curveLevel(stage)}; você está no ${level}.`,
    );
  reasons.push(
    `HP ${hp}, ${gold}g${shopSpend ? ` (${cash}g depois da loja)` : ""}${levelCost ? `, faltam ${xpNeed} XP (${levelCost}g) para o nível ${level + 1}` : ""}.`,
  );
  if (streak?.length >= 2)
    reasons.push(
      `Sequência de ${streak.length} ${streak.kind === "win" ? "vitórias" : "derrotas"} (inferida pelo HP): +${streakGold(streak.length)}g por rodada.`,
    );
  // XP comprado quando a próxima rodada já completaria o nível de graça é ouro perdido.
  const passiveWait = () => {
    steps.push(
      `Não compre XP: faltam ${xpNeed} XP e o XP passivo da próxima rodada completa o nível ${level + 1} de graça.`,
    );
    return out("ECONOMIZAR", `Suba de graça na próxima rodada`, { keep: cash });
  };
  const canLevel = levelCost !== null && levelCost > 0;
  // 1) Vida em risco: gastar para estabilizar agora vale mais que juros.
  if (pressure.danger) {
    const lvlUp = canLevel && behind && cash - levelCost >= 10;
    if (lvlUp)
      steps.push(
        `Suba para o nível ${level + 1} (${levelCost}g): você está abaixo da curva e precisa de mais uma unidade em campo.`,
      );
    const sold = pressure.critical ? sellable.gold : 0,
      before = cash - (lvlUp ? levelCost : 0),
      spend = commit(budget(Math.max(0, before + sold - floor)));
    reasons.push(
      `Vida em risco: guardar ouro para juros não compensa perder mais ${hp <= POLICY.hp.critical ? "uma luta" : "lutas"}.`,
    );
    if (spend < GAME.shopCost) {
      steps.push(
        before - floor >= GAME.shopCost
          ? "A loja quase não tem upgrade para você agora: equipe os itens e posicione para perder por pouco."
          : "Sem ouro para rolar: equipe os itens e posicione para perder por pouco.",
      );
      return lvlUp
        ? out("SUBIR NÍVEL", `Estabilize: suba para o nível ${level + 1}`, {
            spend: levelCost,
            keep: before,
          })
        : out("ECONOMIZAR", "Estabilize com itens e posição", { keep: before });
    }
    // All-in: vende do banco só o necessário para cobrir o que passa do ouro em mãos.
    const fromSale = Math.max(0, spend - Math.max(0, before - floor));
    let got = 0;
    if (fromSale) {
      const sell = [];
      for (const u of sellable.units) {
        if (got >= fromSale) break;
        sell.push(`${u.name} ${u.stars}★`);
        got += u.value;
      }
      steps.push(
        `Venda ${sell.join(", ")} do banco (+${got}g) antes de rolar.`,
      );
    }
    const keep = Math.max(0, before + got - spend);
    steps.push(
      `Role cerca de ${spend}g (até ${shopsIn(spend)} lojas) buscando 2★ na frontline e no carry; pare em ${keep}g.`,
    );
    return out("ROLAR", `Estabilize agora: role até ${keep}g`, { spend, keep });
  }
  // 2) Comp de reroll: economizar, rolar o excedente no nível certo até fechar os 3★.
  if (rerollLevel && open3.length && level <= rerollLevel + 1) {
    if (level < rerollLevel) {
      if (canLevel && (behind || cash - levelCost >= 50)) {
        if (xp.passive) return passiveWait();
        steps.push(
          `Suba para o nível ${level + 1} (${levelCost}g): o reroll desta comp é no nível ${rerollLevel}.`,
        );
        return out("SUBIR NÍVEL", `Suba para o nível ${level + 1}`, {
          spend: levelCost,
          keep: cash - levelCost,
        });
      }
      steps.push(
        `Economize: junte até 50g antes de chegar no nível ${rerollLevel}, onde começa o reroll.`,
      );
      return out("ECONOMIZAR", `Economize até ${nextTier(cash) ?? 50}g`, {
        keep: cash,
      });
    }
    for (const p of open3)
      reasons.push(
        `${p.name}: ${p.own}/9 cópias para 3★, ${p.left} livres na pool${p.enemy ? `, ${p.enemy} com rivais` : ""}.`,
      );
    if (blocked.length === open3.length) {
      steps.push(
        `Pare o reroll: ${blocked.map((p) => p.name).join(", ")} não fecha(m) 3★ com a pool atual. Fique em 2★ e suba de nível.`,
      );
      const up = canLevel && cash - levelCost >= 30 && !xp.passive;
      if (up) steps.push(`Suba para o nível ${level + 1} (${levelCost}g).`);
      else if (canLevel && xp.passive)
        steps.push(
          `O XP passivo da próxima rodada completa o nível ${level + 1}.`,
        );
      return out(
        "SUBIR NÍVEL",
        "3★ disputado: desista do reroll e suba de nível",
        {
          spend: up ? levelCost : 0,
          keep: up ? cash - levelCost : cash,
        },
      );
    }
    // Reroll rápido com a vida caindo; lento (acima de 50g) com a vida confortável.
    const fast = hp <= POLICY.hp.fastReroll,
      rerollFloor = fast ? POLICY.floor.fastReroll : POLICY.floor.healthy;
    if (cash - rerollFloor >= GAME.shopCost) {
      const spend = commit(budget(cash - rerollFloor));
      if (spend >= GAME.shopCost) {
        const keep = cash - spend;
        steps.push(
          `Role ${spend}g (até ${shopsIn(spend)} lojas) no nível ${level} buscando ${open3
            .filter((p) => p.possible)
            .map((p) => p.name)
            .join(
              ", ",
            )}; pare em ${keep}g${fast ? "" : " para manter os juros"}.`,
        );
        return out(
          "ROLAR",
          fast
            ? `Reroll rápido: role ${spend}g e pare em ${keep}g`
            : `Reroll lento: role ${spend}g e volte a ${keep}g`,
          { spend, keep },
        );
      }
    }
    steps.push(
      `Economize até ${rerollFloor}g; depois role só o que passar disso buscando ${open3.map((p) => p.name).join(", ")}.`,
    );
    return out(
      "ECONOMIZAR",
      `Economize até ${rerollFloor}g para o reroll ${fast ? "rápido" : "lento"}`,
      { keep: cash },
    );
  }
  // 3) Comp de nível (Fast 8, Fast 9, Standard): subir no tempo certo e rolar no nível do carry.
  if (level < rollAt) {
    if (
      canLevel &&
      (behind
        ? cash - levelCost >= Math.min(floor, 30)
        : cash - levelCost >= floor)
    ) {
      if (xp.passive) return passiveWait();
      steps.push(
        `Suba para o nível ${level + 1} (${levelCost}g)${behind ? ": você está abaixo da curva" : ": a economia continua acima de " + floor + "g"}.`,
      );
      return out("SUBIR NÍVEL", `Suba para o nível ${level + 1}`, {
        spend: levelCost,
        keep: cash - levelCost,
      });
    }
    if (lob.weak && spare >= 6 && first.spend >= GAME.shopCost) {
      const rate = first.gain / first.spend;
      if (rate > ev.level.perGold) {
        const spend = commit(first),
          keep = cash - spend;
        steps.push(
          `Você é o ${lob.rank}º de ${lob.size} em força: role ${spend}g (até ${shopsIn(spend)} lojas) para fechar os 2★ que já têm pares; pare em ${keep}g.`,
        );
        reasons.push(
          "Rolar agora rende mais força por ouro do que subir de nível.",
        );
        return out(
          "ROLAR",
          `Role ${spend}g por upgrades: board abaixo do lobby`,
          {
            spend,
            keep,
          },
        );
      }
    }
    steps.push(
      `Economize: o carry ${carry?.name ?? ""} (custo ${carry?.cost ?? "?"}) só aparece bem a partir do nível ${rollAt}. Não role agora.`,
    );
    return out(
      "ECONOMIZAR",
      `Economize até ${nextTier(cash) ?? 50}g e suba no tempo certo`,
      { keep: cash },
    );
  }
  if (carryOwn < 3) {
    reasons.push(
      `${carry.name}: ${carryOwn}/3 cópias para 2★, ${carryPool?.remainingUpper ?? 0} livres na pool${carryPool?.enemy ? `, ${carryPool.enemy} com rivais` : ""}.`,
    );
    const spend = spare >= GAME.shopCost ? commit(first) : 0;
    if (spend >= GAME.shopCost) {
      const keep = cash - spend;
      steps.push(
        `Role ${spend}g (até ${shopsIn(spend)} lojas) no nível ${level} buscando ${carry.name} 2★ e a frontline 2★; pare em ${keep}g.`,
      );
      return out("ROLAR", `Role ${spend}g por ${carry.name} 2★`, {
        spend,
        keep,
      });
    }
    steps.push(
      spare >= GAME.shopCost
        ? `Rolar agora quase não melhora a board: economize e role na próxima rodada.`
        : `Ouro no piso (${floor}g): economize mais uma rodada e role depois.`,
    );
    return out("ECONOMIZAR", "Economize para a próxima rolagem", {
      keep: cash,
    });
  }
  if (level < finalLevel) {
    if (canLevel && cash - levelCost >= Math.min(floor, 30)) {
      if (xp.passive) return passiveWait();
      steps.push(
        `Núcleo pronto: suba para o nível ${level + 1} (${levelCost}g) para encaixar mais uma unidade forte.`,
      );
      return out("SUBIR NÍVEL", `Suba para o nível ${level + 1}`, {
        spend: levelCost,
        keep: cash - levelCost,
      });
    }
    steps.push(`Núcleo pronto: economize para o nível ${level + 1}.`);
    return out("ECONOMIZAR", `Economize para o nível ${level + 1}`, {
      keep: cash,
    });
  }
  const spend = spare >= GAME.shopCost ? commit(first) : 0;
  if (spend >= GAME.shopCost) {
    const keep = cash - spend;
    steps.push(
      `Nível final: role ${spend}g melhorando estrelas e buscando unidades de custo alto; pare em ${keep}g.`,
    );
    return out("ROLAR", `Role ${spend}g para fechar upgrades`, { spend, keep });
  }
  steps.push("Mantenha a economia e ajuste posicionamento e itens.");
  return out("ECONOMIZAR", "Economize e ajuste o campo", { keep: cash });
}

/** Devolve a ação de agora e os quadros de economia, nível e roll para a comp `plan` no estado atual. */
export function strategy(plan, analysis, options) {
  const d = decide(plan, analysis, options),
    gold = options.gold,
    level = options.level,
    stage = options.stage ?? null,
    streak = options.streak ?? null;
  const pool = new Map(analysis.pool.map((p) => [p.name, p])),
    denom = freeByCost(analysis.pool),
    carry = plan.board.find((u) => u.name === plan.carry) ?? plan.board[0];
  const xp = levelCostOf(options.xp);
  // Ouro depois da ação recomendada (loja + rolagem ou XP) e o que ele rende nas próximas rodadas.
  const after = gold === null ? null : (d.keep ?? d.cash ?? gold);
  const projection = projectGold(after, { stage, streak, rounds: 4 });
  const economy = {
    gold,
    cash: d.cash,
    shopSpend: d.shopSpend ?? 0,
    interest: interestOf(gold),
    next: nextTier(gold),
    keep: d.keep ?? null,
    after,
    afterInterest: interestOf(after),
    income: after === null ? null : incomeOf(after, streak),
    projection,
    reach50:
      after === null || after >= 50
        ? null
        : (projection.find((r) => r.gold >= 50)?.label ?? null),
    streak: streak ? { ...streak, gold: streakGold(streak.length) } : null,
    sellable: d.sellable,
    pressure: d.pressure,
    value: gold === null ? "–" : gold + "g",
    verdict:
      d.action === "ECONOMIZAR"
        ? "ECONOMIZAR AGORA"
        : d.keep != null
          ? "piso desta decisão: " + d.keep + "g"
          : "",
    text:
      gold === null
        ? "Ouro não lido da tela."
        : `Juros atuais: +${interestOf(gold)}g por rodada.` +
          (nextTier(gold)
            ? ` Próximo patamar em ${nextTier(gold)}g (faltam ${nextTier(gold) - gold}g).`
            : " Juros no máximo (50g).") +
          (after !== null
            ? ` Depois desta ação: ${after}g, renda de ${incomeOf(after, streak).total}g na próxima rodada.`
            : ""),
  };
  const curve = curveLevel(stage);
  const leveling = {
    level,
    xp: xp ? { have: xp.have, total: xp.total, max: xp.max } : null,
    cost: d.levelCost ?? null,
    passive: d.passiveLevel,
    go: d.action === "SUBIR NÍVEL" && (d.spend ?? 0) > 0,
    curve,
    finalLevel: d.finalLevel,
    value: "Nível " + level,
    verdict:
      d.action === "SUBIR NÍVEL" && (d.spend ?? 0) > 0
        ? "SUBIR AGORA" + (d.levelCost != null ? " · " + d.levelCost + "g" : "")
        : "não subir agora",
    text:
      (xp?.max
        ? "Nível máximo."
        : d.levelCost == null
          ? "XP não lido da tela."
          : `Faltam ${d.xpNeed} XP (${d.levelCost}g) para o nível ${level + 1}.` +
            (d.passiveLevel
              ? " O XP passivo da próxima rodada completa de graça."
              : "")) +
      (curve
        ? ` Curva padrão no estágio ${stage.stage}-${stage.round}: nível ${curve}.`
        : "") +
      ` Nível final desta comp: ${d.finalLevel}.`,
  };
  // Alvos da rolagem: os 3★ da comp de reroll, ou o carry 2★ nas comps de nível. Rolando agora, a curva é a
  // do nível atual (o gasto recomendado cai sobre ela); esperando, é a do nível em que se vai rolar.
  const stars3 = (plan.meta?.stars3 ?? [])
      .map((id) => plan.board.find((u) => u.id === id))
      .filter(Boolean),
    rolling = d.action === "ROLAR" && d.spend >= GAME.shopCost,
    shops = rolling ? shopsIn(d.spend) : 0,
    curveAt = rolling ? level : Math.max(level, d.rollAt ?? level);
  const targets = (
    d.rerollLevel && stars3.length
      ? stars3.map((u) => ({ u, goal: 9 }))
      : carry
        ? [{ u: carry, goal: 3 }]
        : []
  ).map(({ u, goal }) => {
    const p = pool.get(u.name),
      own = p?.own ?? 0,
      left = p?.remainingUpper ?? 0,
      args = { cost: u.cost, own, goal, free: left, denom: denom[u.cost] ?? 0 };
    const atRoll = closeCurve({ ...args, level: curveAt });
    return {
      id: u.id,
      name: u.name,
      cost: u.cost,
      goalStars: goal === 9 ? 3 : 2,
      own,
      goal,
      left,
      enemy: p?.enemy ?? 0,
      chancePerSlot: p?.chancePerSlot ?? 0,
      chancePerShop: p?.chancePerShop ?? 0,
      // Chance de fechar com o gasto recomendado agora (lojas + cópias, pool encolhendo).
      chanceInRoll: rolling ? atRoll[Math.min(d.spend, CURVE_MAX)] : null,
      curve:
        own >= goal
          ? null
          : curveSummary(atRoll, curveAt, rolling ? d.spend : null),
      done: own >= goal,
    };
  });
  const rollingPanel = {
    level,
    at: d.rollAt,
    go: rolling,
    spend: rolling ? d.spend : 0,
    shops,
    keep: d.keep ?? null,
    // Até onde valia gastar (piso) e onde a curva de ganho manda parar.
    max: d.ev?.roll.max ?? null,
    stop: rolling && d.ev?.roll.max > d.spend ? d.spend : null,
    ev: d.ev,
    value: "Nível de roll " + d.rollAt,
    verdict: rolling
      ? `ROLAR ${d.spend}g · até ${shops} lojas · parar em ${d.keep}g`
      : "não rolar agora",
    text:
      level < d.rollAt
        ? `Você está no nível ${level}: rolar agora quase não mostra o que a comp precisa.`
        : level === d.rollAt
          ? "Este é o nível de rolagem da comp."
          : "Você já passou do nível de rolagem; role só para fechar upgrades.",
    targets,
  };
  return { ...d, panels: { economy, leveling, rolling: rollingPanel } };
}
