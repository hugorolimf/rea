// Ação de agora: comprar, economizar, subir de nível ou rolar a loja, com quanto gastar e por quê.
// Entradas: estágio, nível, XP e ouro (estado do servidor: GEP e arquivos do jogo), HP e pool (arquivo do jogo), a loja
// do GEP, a sequência inferida pelo servidor e o estilo da comp alvo vindo da meta ("lvl N" = reroll naquele nível, "Fast 8",
// ...).
// Aqui fica a árvore de decisão (nível, reroll, economia); a matemática (chance de fechar, ganho por ouro, juros,
// renda) está em economy.mjs e a regra de "vale rolar para o time inteiro" em roll.mjs. Não simula combate.
import { GAME } from "./rules.mjs";
import { starCopies } from "./core/pool/copies.mjs";
import { levelOdds } from "./core/pool/shop.mjs";
import {
  POLICY,
  bestSpend,
  curveLevel,
  finalLevelOf,
  incomeOf,
  interestOf,
  isContested,
  levelCostOf,
  lobbyStrength,
  maxInterestGold,
  nextTier,
  pressureOf,
  projectGold,
  stageForPressure,
  rerollLevelOf,
  rollLevelOf,
  sellValue,
  streakGold,
} from "./economy.mjs";
import { rollCurve, rollRows, rollRule, teamOf } from "./roll.mjs";
import { huntBudget, huntPlan, rollFor } from "./core/roll/hunt.mjs";
import { buildTurn } from "./core/turn/turn.mjs";

const round1 = (v) => Math.round(v * 10) / 10;
const shopsIn = (gold) => Math.floor(gold / GAME.shopCost);
// Tipo de cada passo/razão da decisão ("roll" manda rolar, "save" manda guardar; sem tipo = neutro). Chave
// Symbol: acompanha a decisão entre decide() e settle() sem ir para o JSON da API.
const KIND = Symbol("kind");

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

function decide(plan, analysis, options, team, sim) {
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
    reasons = [],
    kinds = new Map();
  // Registra o texto com o seu tipo, para a oportunidade filtrar por tipo e não pelo prefixo.
  const mark = (list, kind, text) => {
    list.push(text);
    kinds.set(text, kind);
  };
  let ev = null,
    lobbyInfo = null,
    pressure = null,
    cash = gold,
    shopSpend = 0;
  const out = (action, headline, extra = {}) => {
    if (ev?.roll.gold >= GAME.shopCost)
      mark(
        reasons,
        "roll",
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
      // O gatilho da faixa de perigo (vida, estágio ou tendência), para o aviso dizer por quê.
      pressureWhy: pressure?.why ?? null,
      // Perigo estabilizado (tabuleiro na força típica do lobby ou vitória na última luta): o perigo vira só aviso.
      stabilized: pressure?.stabilized ?? false,
      stableWhy: pressure?.stableWhy ?? null,
      floor: pressure?.floor ?? null,
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
      interestAt: gold === null ? null : (nextTier(gold) ?? maxInterestGold()),
      [KIND]: kinds,
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
  // Nível só estimado pelo tabuleiro não é leitura: as odds da loja e o nível de rolagem dependem dele.
  const levelUnread = options.levelEstimated === true;
  if (gold === null || levelUnread) {
    reasons.push(
      gold === null
        ? "Ouro sem fonte agora: sem ele não dá para calcular rolagem nem juros."
        : "Nível sem fonte agora (só estimado pelo tabuleiro): sem ele não dá para calcular odds, rolagem nem XP.",
    );
    return out(
      shopBuys.length ? "COMPRAR" : "AGUARDAR",
      gold === null
        ? "Compre o que o plano pede; ouro ainda não foi lido"
        : "Compre o que o plano pede; nível ainda não foi lido",
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
      need = Math.max(0, starCopies(3) - own),
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
  // Estágio sem fonte: estimado pelo nível médio dos rivais (a vida em perigo tarde depende dele). A mesma faixa
  // que stage.mjs usa na loja (mesmas entradas).
  const stageSeen = stageForPressure(stage, lob.foeLevel);
  pressure = pressureOf({
    hp,
    stage: stageSeen,
    weak: lob.weak,
    trend: options.trend ?? null,
    gold,
    // Tabuleiro de agora (com as compras e as estrelas fechadas nesta rodada) contra a mediana dos rivais vivos, e a
    // última luta: com um deles, o perigo está estabilizado e a ordem de rolar para.
    board: lob.size > 1 ? { mine: lob.mine, typical: lob.median } : null,
    won: streak?.kind === "win",
  });
  if (pressure.stabilized)
    reasons.push(
      `Vida ${hp} em perigo (${pressure.why}), mas estabilizado (${pressure.stableWhy}): pare de rolar para estabilizar; o ouro volta para juros e nível.`,
    );
  if (pressure.lossStreak && streak?.kind === "loss" && streak.length >= 2)
    reasons.push(
      `Sequência de derrotas com vida ${hp} e ${gold}g guardados no estágio ${stageSeen.stage}: é economia, não perigo.`,
    );
  const levelGap = analysis.opponents?.length ? lob.foeLevel - level : 0;
  // Ganho esperado de cada uso do ouro: rolar pelo time inteiro (simulado com a pool real) contra subir de nível.
  const gain = sim?.gain ?? new Float64Array(1);
  const nextOdds = levelOdds(level + 1),
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
      mark(
        reasons,
        "roll",
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
  // 1) Vida em risco e tabuleiro ainda não estabilizado: gastar para estabilizar agora vale mais que juros.
  if (pressure.spend) {
    const lvlUp = canLevel && behind && cash - levelCost >= POLICY.floor.danger;
    if (lvlUp)
      steps.push(
        `Suba para o nível ${level + 1} (${levelCost}g): você está abaixo da curva e precisa de mais uma unidade em campo.`,
      );
    const sold = pressure.critical ? sellable.gold : 0,
      before = cash - (lvlUp ? levelCost : 0),
      spend = commit(budget(Math.max(0, before + sold - floor)));
    reasons.push(
      `Vida em risco (${pressure.why}): guardar ouro para juros não compensa perder mais ${hp <= POLICY.hp.critical ? "uma luta" : "lutas"}; estabilize com cópias e upgrades do plano.`,
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
        : out(
            "ECONOMIZAR",
            // Com ouro para rolar mas sem upgrade que pague (retorno decrescente): pare e guarde, não "role" de novo.
            before - floor >= GAME.shopCost
              ? `Pare de rolar: guarde ${before}g`
              : "Estabilize com itens e posição",
            { keep: before },
          );
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
      mark(
        steps,
        "roll",
        `Venda ${sell.join(", ")} do banco (+${got}g) antes de rolar.`,
      );
    }
    const keep = Math.max(0, before + got - spend);
    mark(
      steps,
      "roll",
      `Role cerca de ${spend}g (até ${shopsIn(spend)} lojas) buscando ${team.lookFor({ plan: true }) || "2★ no time"}; pare em ${keep}g.`,
    );
    // XP e venda junto da rolagem: os quadros de nível e do ouro mostram os três gastos.
    return out("ROLAR", `Estabilize agora: role até ${keep}g`, {
      spend,
      keep,
      levelUp: lvlUp ? levelCost : 0,
      sold: got,
    });
  }
  // 2) Comp de reroll: economizar, rolar o excedente no nível certo até fechar os 3★.
  if (rerollLevel && open3.length && level <= rerollLevel + 1) {
    if (level < rerollLevel) {
      if (canLevel && (behind || cash - levelCost >= POLICY.floor.healthy)) {
        if (xp.passive) return passiveWait();
        steps.push(
          `Suba para o nível ${level + 1} (${levelCost}g): o reroll desta comp é no nível ${rerollLevel}.`,
        );
        return out("SUBIR NÍVEL", `Suba para o nível ${level + 1}`, {
          spend: levelCost,
          keep: cash - levelCost,
        });
      }
      mark(
        steps,
        "save",
        `Economize: junte até ${POLICY.floor.healthy}g antes de chegar no nível ${rerollLevel}, onde começa o reroll.`,
      );
      return out(
        "ECONOMIZAR",
        `Economize até ${nextTier(cash) ?? maxInterestGold()}g`,
        {
          keep: cash,
        },
      );
    }
    for (const p of open3)
      reasons.push(
        `${p.name}: ${p.own}/9 cópias para 3★, ${p.left} fora dos tabuleiros${p.enemy ? `, ${p.enemy} com rivais` : ""}.`,
      );
    if (blocked.length === open3.length) {
      steps.push(
        `Pare o reroll: ${blocked.map((p) => p.name).join(", ")} não fecha(m) 3★ com a pool atual. Fique em 2★ e suba de nível.`,
      );
      const up =
        canLevel && cash - levelCost >= POLICY.floor.hurt && !xp.passive;
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
        mark(
          steps,
          "roll",
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
          // O piso do reroll (não o da faixa de vida) é o que a oportunidade e o veredito do core usam.
          { spend, keep, floor: rerollFloor },
        );
      }
    }
    mark(
      steps,
      "save",
      `Economize até ${rerollFloor}g; depois role só o que passar disso buscando ${open3.map((p) => p.name).join(", ")}.`,
    );
    return out(
      "ECONOMIZAR",
      `Economize até ${rerollFloor}g para o reroll ${fast ? "rápido" : "lento"}`,
      { keep: cash, floor: rerollFloor },
    );
  }
  // 3) Comp de nível (Fast 8, Fast 9, Standard): subir no tempo certo e rolar no nível do carry.
  if (level < rollAt) {
    if (
      canLevel &&
      (behind
        ? cash - levelCost >= Math.min(floor, POLICY.floor.hurt)
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
    if (
      lob.weak &&
      spare >= POLICY.weakLobbySpare &&
      first.spend >= GAME.shopCost
    ) {
      const rate = first.gain / first.spend;
      if (rate > ev.level.perGold) {
        const spend = commit(first),
          keep = cash - spend;
        mark(
          steps,
          "roll",
          `Você é o ${lob.rank}º de ${lob.size} em força: role ${spend}g (até ${shopsIn(spend)} lojas) para fechar os 2★ que já têm pares; pare em ${keep}g.`,
        );
        mark(
          reasons,
          "roll",
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
    mark(
      steps,
      "save",
      `Economize: o carry ${carry?.name ?? ""} (custo ${carry?.cost ?? "?"}) só aparece bem a partir do nível ${rollAt}. Não role agora.`,
    );
    return out(
      "ECONOMIZAR",
      `Economize até ${nextTier(cash) ?? maxInterestGold()}g e suba no tempo certo`,
      { keep: cash },
    );
  }
  if (carryOwn < 3) {
    reasons.push(
      `${carry.name}: ${carryOwn}/3 cópias para 2★, ${carryPool?.remainingUpper ?? 0} fora dos tabuleiros${carryPool?.enemy ? `, ${carryPool.enemy} com rivais` : ""}.`,
    );
    const spend = spare >= GAME.shopCost ? commit(first) : 0;
    if (spend >= GAME.shopCost) {
      const keep = cash - spend;
      mark(
        steps,
        "roll",
        `Role ${spend}g (até ${shopsIn(spend)} lojas) no nível ${level} buscando ${team.lookFor() || `${carry.name} 2★`}; pare em ${keep}g.`,
      );
      return out(
        "ROLAR",
        `Role ${spend}g por ${team.lookFor() || `${carry.name} 2★`}`,
        {
          spend,
          keep,
        },
      );
    }
    mark(
      steps,
      "save",
      spare >= GAME.shopCost
        ? `Rolar agora quase não melhora a board: economize e role na próxima rodada.`
        : `Ouro no piso (${floor}g): economize mais uma rodada e role depois.`,
    );
    return out("ECONOMIZAR", "Economize para a próxima rolagem", {
      keep: cash,
    });
  }
  if (level < finalLevel) {
    if (canLevel && cash - levelCost >= Math.min(floor, POLICY.floor.hurt)) {
      if (xp.passive) return passiveWait();
      steps.push(
        `Núcleo pronto: suba para o nível ${level + 1} (${levelCost}g) para encaixar mais uma unidade forte.`,
      );
      return out("SUBIR NÍVEL", `Suba para o nível ${level + 1}`, {
        spend: levelCost,
        keep: cash - levelCost,
      });
    }
    mark(steps, "save", `Núcleo pronto: economize para o nível ${level + 1}.`);
    return out("ECONOMIZAR", `Economize para o nível ${level + 1}`, {
      keep: cash,
    });
  }
  const spend = spare >= GAME.shopCost ? commit(first) : 0;
  if (spend >= GAME.shopCost) {
    const keep = cash - spend;
    mark(
      steps,
      "roll",
      `Nível final: role ${spend}g melhorando estrelas e buscando unidades de custo alto; pare em ${keep}g.`,
    );
    return out("ROLAR", `Role ${spend}g para fechar upgrades`, { spend, keep });
  }
  mark(steps, "save", "Mantenha a economia e ajuste posicionamento e itens.");
  return out("ECONOMIZAR", "Economize e ajuste o campo", { keep: cash });
}

// Título curto do veredito de rolagem, por tipo.
const TITLE = {
  go: "Vale rolar",
  danger: "Role para estabilizar",
  wait: "Espere para rolar",
  hold: "Não vale rolar agora",
  blocked: "Sem peça viável",
  none: "Nada a evoluir",
  unknown: "Ouro ou nível não lido",
  ended: "Partida encerrada",
};

/** Veredito de rolagem sem objetos internos (vai para o JSON da API). `changed`: o que a regra mudou na decisão. */
const publicCall = (v, changed = null) => ({
  kind: v.kind,
  title:
    v.kind === "wait"
      ? `Espere o nível ${v.at.level} para rolar`
      : TITLE[v.kind],
  go: v.go,
  reason: v.reason,
  budget: v.budget ?? null,
  any: v.any ?? null,
  gain: v.gain ?? null,
  main: v.main
    ? { id: v.main.id, name: v.main.name, stars: v.main.goalStars }
    : null,
  mainChance: v.mainChance ?? null,
  need: v.need ?? null,
  at: v.at ?? null,
  changed,
});

/**
 * Aplica a regra única de rolagem (roll.mjs) à decisão da árvore de economia: rolar sem chance boa de evoluir o
 * time vira guardar; guardar com chance boa (e ganho) vira rolar o menor ouro que passa na regra. Devolve a
 * decisão com o veredito (`call`) explicado.
 */
function settle(d, analysis, options, team, sim) {
  const gold = options.gold;
  if (
    gold == null ||
    options.levelEstimated === true ||
    !(analysis.self.health > 0)
  )
    return d;
  const cash = d.cash ?? gold,
    floor = d.floor ?? 0,
    danger =
      (d.pressure === "danger" || d.pressure === "critical") && !d.stabilized,
    v = rollRule(team, sim, {
      level: options.level,
      cash,
      floor,
      planned: d.action === "ROLAR" ? (d.spend ?? 0) : 0,
      danger,
      rollAt: d.rollAt,
      // Ouro sem outro uso: no nível final (ou no máximo), o que passa do teto de juros não rende nem compra nível.
      idle:
        options.level >= (d.finalLevel ?? 10)
          ? Math.max(0, cash - Math.max(floor, maxInterestGold()))
          : 0,
    }),
    kinds = d[KIND] ?? new Map(),
    // Tira os passos/razões do tipo que a regra contradiz.
    drop = (list, kind) => list.filter((t) => kinds.get(t) !== kind);
  // Vida em perigo e a rolagem não paga (chance de upgrade do plano ou ganho abaixo do mínimo): não "guarde" — suba
  // de nível se a árvore já subia (abaixo da curva), senão estabilize com itens e posição. Sem venda do banco.
  if (d.action === "ROLAR" && !v.go && danger) {
    const up = d.levelUp ?? 0;
    return {
      ...d,
      action: up ? "SUBIR NÍVEL" : "ECONOMIZAR",
      // Retorno decrescente: recalculado com o tabuleiro de agora (depois de rolar), sem alvo do plano que pague a
      // rolagem o veredito é parar e guardar (ou subir), não "role" de novo.
      headline: up
        ? `Pare de rolar: suba para o nível ${options.level + 1}`
        : `Pare de rolar: guarde ${cash}g`,
      steps: [
        `Não role: ${v.reason}`,
        ...drop(d.steps, "roll"),
        "Equipe os itens e posicione para perder por pouco.",
      ],
      reasons: drop(d.reasons, "roll"),
      spend: up,
      sold: 0,
      levelUp: 0,
      keep: cash - up,
      call: publicCall(v, "hold"),
    };
  }
  if (d.action === "ROLAR" && !v.go)
    return {
      ...d,
      action: "ECONOMIZAR",
      headline:
        v.kind === "wait"
          ? `Espere o nível ${v.at.level} para rolar`
          : "Rolar não compensa agora: guarde",
      steps: [`Não role: ${v.reason}`, ...drop(d.steps, "roll")],
      reasons: drop(d.reasons, "roll"),
      spend: 0,
      sold: 0,
      keep: cash - (d.levelUp ?? 0),
      call: publicCall(v, "hold"),
    };
  if (d.action === "ECONOMIZAR" && v.go) {
    const spend = v.spend;
    return {
      ...d,
      action: "ROLAR",
      headline: `Vale rolar: ${spend}g por ${team.lookFor()}`,
      steps: [
        `Role até ${spend}g (até ${shopsIn(spend)} lojas) buscando ${team.lookFor()}: ${v.reason} Pare em ${cash - spend}g ou assim que fechar.`,
        ...drop(d.steps, "save"),
      ],
      reasons: drop(d.reasons, "save"),
      spend,
      keep: cash - spend,
      call: publicCall(v, "roll"),
    };
  }
  // A regra aprovou menos que a árvore pedia (o ouro parado acima dos juros): rola só esse excedente e guarda o resto.
  if (d.action === "ROLAR" && v.go && v.spend < (d.spend ?? 0)) {
    const spend = v.spend;
    return {
      ...d,
      headline: `Role ${spend}g (o ouro parado acima dos juros); guarde ${cash - spend}g`,
      steps: [
        `Role ${spend}g (até ${shopsIn(spend)} lojas) buscando ${team.lookFor() || "upgrades do time"}: ${v.reason} Pare em ${cash - spend}g.`,
        ...drop(d.steps, "roll"),
      ],
      spend,
      keep: cash - spend,
      call: publicCall(v, "roll"),
    };
  }
  return { ...d, call: publicCall(v) };
}

/**
 * Aviso de vida em perigo, em uma linha e coerente com a decisão: rolar por upgrades do plano, subir de nível ou
 * estabilizar com itens e posição. `null` fora da faixa de perigo. `targets`: as peças do plano que a rolagem busca.
 */
function hpAlert(d, hp, team, level) {
  if (d.pressure !== "danger" && d.pressure !== "critical") return null;
  const keep = d.keep ?? d.cash ?? null,
    guard = keep != null ? `guarde ${keep}g` : "guarde o ouro",
    leveled =
      (d.levelUp ?? 0) > 0 ||
      (d.action === "SUBIR NÍVEL" && (d.spend ?? 0) > 0);
  // Estabilizado: o aviso continua, mas diz para parar de rolar (o ouro volta para juros e nível).
  if (d.stabilized) {
    const what =
      d.action === "ROLAR" && (d.spend ?? 0) >= GAME.shopCost
        ? `role só ${d.spend}g pelo upgrade provável e ${guard}`
        : leveled
          ? `suba para o nível ${level + 1} e ${guard}`
          : `pare de rolar, ${guard}`;
    return {
      band: d.pressure,
      hp,
      why: [d.pressureWhy, d.stableWhy].filter(Boolean).join("; ") || null,
      text: `Vida ${hp} · tabuleiro estabilizado: ${what}`,
      stabilized: true,
      targets: null,
    };
  }
  // Perigo, mas a rolagem não paga mais (recalculada com o tabuleiro de agora, com ouro acima do piso): pare e guarde
  // (ou suba), sem repetir "role".
  const rollingNow = d.action === "ROLAR" && (d.spend ?? 0) >= GAME.shopCost,
    room = (keep ?? 0) - (d.floor ?? 0) >= GAME.shopCost;
  if (!rollingNow && (room || d.call?.changed === "hold"))
    return {
      band: d.pressure,
      hp,
      why: d.pressureWhy ?? null,
      text: `Vida ${hp} · sem upgrade do plano que pague: ${leveled || d.action === "SUBIR NÍVEL" ? `suba para o nível ${level + 1}` : `pare de rolar, ${guard}`}`,
      stabilized: false,
      targets: null,
    };
  const head = `Vida ${hp}`,
    rolling = d.action === "ROLAR" && (d.spend ?? 0) >= GAME.shopCost,
    levelUp =
      (d.levelUp ?? 0) > 0 ||
      (d.action === "SUBIR NÍVEL" && (d.spend ?? 0) > 0),
    targets = team.lookFor({ plan: true, only: true }),
    roll = targets
      ? "role por upgrades do plano até estabilizar"
      : "role por 2★ do time até estabilizar";
  const text = rolling
    ? `${head}: ${levelUp ? `suba para o nível ${level + 1} e ` : ""}${roll}`
    : levelUp
      ? `${head}: suba para o nível ${level + 1} para estabilizar`
      : `${head}: estabilize com itens e posição`;
  return {
    band: d.pressure,
    hp,
    why: d.pressureWhy ?? null,
    text,
    stabilized: false,
    targets: rolling ? targets || null : null,
  };
}

/**
 * Caça por ouro (core/roll/hunt.mjs) com as peças do time e o orçamento DA DECISÃO: rolando, o gasto recomendado (B =
 * gasto, parando no ouro que sobra); guardando, o ouro acima do piso (o que aconteceria se rolasse). Devolve
 * `{ hunt, rollFor }` ou null sem ouro/nível lido ou fora da partida. Os rivais de cada peça vêm só pelo nome (as cópias
 * por rival ainda não chegam da análise: plano, R5).
 */
function huntOf(plan, team, d, analysis, options) {
  if (
    options.gold == null ||
    options.levelEstimated === true ||
    !(analysis.self.health > 0)
  )
    return null;
  const level = options.level,
    rolling = d.action === "ROLAR" && (d.spend ?? 0) >= GAME.shopCost,
    danger =
      (d.pressure === "danger" || d.pressure === "critical") && !d.stabilized,
    rivals = new Map(analysis.pool.map((p) => [p.name, p.rivals ?? []])),
    stars3 = new Set(plan.meta?.stars3 ?? []);
  const budget = rolling
    ? huntBudget({ gold: (d.keep ?? 0) + d.spend, floor: d.keep ?? 0, level })
    : huntBudget({
        gold: d.cash ?? options.gold,
        floor: d.floor ?? 0,
        level,
        levelCost: d.levelCost,
        critical: d.pressure === "critical",
        sellable: d.sellable?.gold ?? 0,
      });
  const pieces = team.pieces.map((p) => ({
    id: p.id,
    name: p.name,
    cost: p.cost,
    own: p.own,
    goal: p.goal,
    free: p.free,
    upper: p.upper,
    denom: team.denom[p.cost] ?? 0,
    enemy: p.enemy,
    hidden: p.hidden,
    holders: (rivals.get(p.name) ?? []).map((name) => ({ name, copies: null })),
    value: p.value,
    carry: p.carry,
    inPlan: p.inPlan,
    // Estrela-alvo 3★ da comp de reroll: as `stars3` da meta e o carry (plano, R4: passa a ler a regra do alcance).
    star3: d.rerollLevel != null && (stars3.has(p.id) || p.carry),
  }));
  const hunt = huntPlan({
    pieces,
    level,
    budget,
    danger,
    three: {
      rollLevel: d.rerollLevel ?? d.rollAt ?? null,
      stage: options.stage ?? null,
      reroll: d.rerollLevel != null,
    },
  });
  const shop = new Map(
    team.pieces
      .filter((p) => p.shop)
      .map((p) => [p.id, { slots: p.shop.slots, buy: p.shop.buy }]),
  );
  return { hunt, rollFor: rollFor(hunt, { go: rolling, shop }) };
}

/** A caça sem os objetos internos (vai para o JSON da API): veredito, linha "Role por", alvos e os de fora. */
const huntView = (h) => ({
  verdict: h.verdict,
  headline: h.headline,
  budget: {
    spend: h.budget.spend,
    total: h.budget.total,
    floor: h.budget.floor,
    levelUp: h.budget.levelUp,
  },
  targets: h.targets.map((t) => ({
    id: t.id,
    name: t.name,
    cost: t.cost,
    tag: t.tag,
    verdict: t.verdict,
    chance: t.chance,
    spend: t.spend,
    saveTo: t.saveTo,
    carry: t.carry,
    text: t.text,
    three: t.three
      ? {
          verdict: t.three.verdict,
          own: t.three.own,
          of: t.three.of,
          now: t.three.now,
          slow: t.three.slow,
          rounds: t.three.rounds,
          level: t.three.level,
          text: t.three.text,
        }
      : null,
  })),
  dropped: h.dropped,
});

/**
 * Rolar sem alvo não é recomendação: se a decisão manda rolar e nenhuma peça do time tem chance de fechar com o gasto,
 * vira guardar (os passos de rolar saem e o veredito diz por quê).
 */
function withoutTarget(d, cash) {
  const kinds = d[KIND] ?? new Map(),
    drop = (list) => list.filter((t) => kinds.get(t) !== "roll"),
    reason = `nenhuma peça do time tem chance de fechar com ${d.spend}g.`;
  return {
    ...d,
    action: "ECONOMIZAR",
    headline: "Sem alvo para rolar: guarde",
    steps: [`Não role: ${reason}`, ...drop(d.steps)],
    reasons: drop(d.reasons),
    spend: 0,
    sold: 0,
    keep: cash - (d.levelUp ?? 0),
    call: {
      ...d.call,
      kind: "hold",
      title: TITLE.hold,
      go: false,
      reason: `Sem alvo: ${reason}`,
      changed: "hold",
    },
  };
}

/** Devolve a ação de agora e os quadros de economia, nível e roll para a comp `plan` no estado atual. */
export function strategy(plan, analysis, options) {
  // O time e a simulação de rolagem não dependem do ouro: uma vez por chamada, e reaproveitada entre chamadas.
  const team = teamOf(plan, analysis, options),
    sim = analysis.self.health > 0 ? team.simulate() : null;
  let d = settle(
    decide(plan, analysis, options, team, sim),
    analysis,
    options,
    team,
    sim,
  );
  let hunted = huntOf(plan, team, d, analysis, options);
  if (hunted && d.action === "ROLAR" && !hunted.rollFor.go) {
    d = withoutTarget(d, d.cash ?? options.gold);
    hunted = huntOf(plan, team, d, analysis, options);
  }
  const gold = options.gold,
    level = options.level,
    stage = options.stage ?? null,
    streak = options.streak ?? null;
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
      after === null || after >= maxInterestGold()
        ? null
        : (projection.find((r) => r.gold >= maxInterestGold())?.label ?? null),
    streak: streak ? { ...streak, gold: streakGold(streak.length) } : null,
    sellable: d.sellable,
    // Ouro da venda do banco que entra nesta ação (all-in crítico) e o piso que a decisão respeita.
    sold: d.sold ?? 0,
    floor: d.floor ?? null,
    pressure: d.pressure,
    // Aviso de vida: só na faixa de perigo, uma linha que diz o que fazer pela decisão tomada (sem contradizer o plano).
    alert: hpAlert(d, analysis.self.health, team, level),
    value: gold === null ? "–" : gold + "g",
    verdict:
      d.action === "ECONOMIZAR"
        ? "ECONOMIZAR AGORA"
        : d.keep != null
          ? "piso desta decisão: " + d.keep + "g"
          : "",
    text:
      gold === null
        ? "Ouro sem fonte agora."
        : `Juros atuais: +${interestOf(gold)}g por rodada.` +
          (nextTier(gold)
            ? ` Próximo patamar em ${nextTier(gold)}g (faltam ${nextTier(gold) - gold}g).`
            : ` Juros no máximo (${maxInterestGold()}g).`) +
          (after !== null
            ? ` Depois desta ação: ${after}g, renda de ${incomeOf(after, streak).total}g na próxima rodada.`
            : ""),
  };
  const curve = curveLevel(stage);
  // Sobe agora: ação de nível com XP comprado, ou XP junto da rolagem no perigo.
  const lvGo =
    (d.action === "SUBIR NÍVEL" && (d.spend ?? 0) > 0) || (d.levelUp ?? 0) > 0;
  const leveling = {
    level,
    xp: xp ? { have: xp.have, total: xp.total, max: xp.max } : null,
    cost: d.levelCost ?? null,
    passive: d.passiveLevel,
    go: lvGo,
    curve,
    finalLevel: d.finalLevel,
    value: "Nível " + level,
    verdict: lvGo
      ? "SUBIR AGORA" + (d.levelCost != null ? " · " + d.levelCost + "g" : "")
      : "não subir agora",
    text:
      (xp?.max
        ? "Nível máximo."
        : d.levelCost == null
          ? "XP sem fonte agora."
          : `Faltam ${d.xpNeed} XP (${d.levelCost}g) para o nível ${level + 1}.` +
            (d.passiveLevel
              ? " O XP passivo da próxima rodada completa de graça."
              : "")) +
      (curve
        ? ` Curva padrão no estágio ${stage.stage}-${stage.round}: nível ${curve}.`
        : "") +
      ` Nível final desta comp: ${d.finalLevel}.`,
  };

  // Rolagem do time inteiro. O veredito é o de settle(); a lista tem uma linha por peça (campo, banco e comp),
  // com a chance de fechar a próxima estrela dividindo ouro e pool com as demais, e a curva de "pelo menos uma
  // peça evolui" por ouro gasto (a do nível atual: o gasto recomendado cai sobre ela).
  const rolling = d.action === "ROLAR" && d.spend >= GAME.shopCost,
    // Rolagem vinda da regra (era "guardar"): o gasto é o menor que passa nela, não o joelho da curva de ganho.
    byChance = rolling && d.call?.changed === "roll",
    shops = rolling ? shopsIn(d.spend) : 0;
  const call =
    d.call ??
    publicCall({
      kind:
        gold === null || options.levelEstimated === true ? "unknown" : "ended",
      go: false,
      reason:
        gold === null
          ? "Ouro sem fonte agora: sem ele não dá para calcular o orçamento da rolagem."
          : options.levelEstimated === true
            ? "Nível sem fonte agora (só estimado pelo tabuleiro): sem ele não dá para calcular as odds da loja nem a rolagem."
            : "",
    });
  const rows = rollRows(team, { budget: call.budget ?? 0 }),
    shopHits = rows
      .filter((r) => r.shop)
      .map((r) => ({
        id: r.id,
        name: r.name,
        cost: r.cost,
        slots: r.shop.slots,
        buy: r.shop.buy,
        gold: r.shop.gold,
        action: r.shop.action,
        closes: r.shop.closes,
      }));
  const lostInterest = rolling ? interestOf(d.cash) - interestOf(d.keep) : 0;
  const rollingPanel = {
    call,
    level,
    at: d.rollAt,
    go: rolling,
    spend: rolling ? d.spend : 0,
    shops,
    keep: d.keep ?? null,
    // Até onde valia gastar (piso) e onde a curva de ganho manda parar.
    max: byChance ? d.spend : (d.ev?.roll.max ?? null),
    stop: !byChance && rolling && d.ev?.roll.max > d.spend ? d.spend : null,
    // Juros só entram quando mudam a decisão: rolar derruba o patamar de juros.
    interest:
      lostInterest > 0
        ? { from: interestOf(d.cash), to: interestOf(d.keep) }
        : null,
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
    // Peças do time que estão na loja agora e o que comprar delas.
    shop: shopHits,
    curve: sim ? rollCurve(team, sim, rolling ? d.spend : null) : null,
    total: rows.length,
    targets: rows.slice(0, POLICY.roll.rows),
    // Por quem rolar (core/roll/hunt.mjs): com a decisão de rolar, os alvos em ordem com a chance no gasto recomendado;
    // sem rolar, `go` false e nenhum alvo. A interface e o overlay leem este campo, não recalculam.
    rollFor: hunted?.rollFor ?? null,
    // A caça inteira (alvos, veredito por ouro, 3★ em várias rodadas e o que ficou de fora), para o painel.
    hunt: hunted ? huntView(hunted.hunt) : null,
  };
  // Decisão da rodada (core/turn): comprar, subir, rolar e guardar numa conta só, em ordem; as telas leem só isto.
  const turn = buildTurn({
    gold,
    level,
    stage,
    d,
    buys: (plan.stage?.shop ?? []).filter((s) => s.action === "comprar"),
    rollFor: hunted?.rollFor ?? null,
    target: options.targetLevel ?? null,
    comp: {
      id: plan.meta?.id ?? plan.freeId ?? null,
      title: plan.title ?? null,
    },
  });
  const { call: _call, ...strategyCore } = d;
  return {
    ...strategyCore,
    turn,
    panels: { economy, leveling, rolling: rollingPanel },
  };
}
