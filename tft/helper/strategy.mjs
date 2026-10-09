// Ação de agora: comprar, economizar, subir de nível ou rolar a loja, com quanto gastar e por quê.
// Entradas: estágio, nível, XP e ouro (lidos da tela), HP e pool (arquivo do jogo), a loja lida e o estilo
// da comp alvo vindo da meta ("lvl N" = reroll naquele nível, "Fast 8", "Fast 9", "Standard").
// São as regras usuais de economia do TFT aplicadas ao estado lido; não simulam combate nem streak.
import { ODDS } from "./engine.mjs";
const XP_COST = 4,
  XP_GAIN = 4;
// P(pelo menos k acertos em n slots de loja com chance p por slot).
function atLeast(k, n, p) {
  if (k <= 0) return 1;
  if (p <= 0 || n < k) return 0;
  let miss = 0,
    term = (1 - p) ** n;
  for (let i = 0; i < k; i++) {
    miss += term;
    term *= (((n - i) / (i + 1)) * p) / (1 - p);
  }
  return Math.max(0, 1 - miss);
}
// Nível esperado ao fim de cada estágio-rodada numa curva padrão; usado só para dizer se você está atrasado.
const CURVE = [
  [2, 1, 4],
  [2, 5, 5],
  [3, 2, 6],
  [4, 1, 7],
  [4, 5, 8],
  [5, 5, 9],
];
const curveLevel = (stage) => {
  let level = 3;
  for (const [s, r, l] of CURVE)
    if (stage.stage > s || (stage.stage === s && stage.round >= r)) level = l;
  return level;
};
function decide(plan, analysis, options) {
  const gold = options.gold,
    level = options.level,
    hp = analysis.self.health,
    stage = options.stage ?? null,
    meta = plan.meta ?? null;
  const xp = /^(\d+)\/(\d+)$/.exec(options.xp ?? "");
  const xpNeed = xp ? Math.max(0, Number(xp[2]) - Number(xp[1])) : null,
    levelCost = xpNeed === null ? null : Math.ceil(xpNeed / XP_GAIN) * XP_COST;
  const pool = new Map(analysis.pool.map((p) => [p.name, p])),
    board = plan.board;
  const carry = board.find((u) => u.name === plan.carry) ?? board[0];
  const rerollLevel =
    meta?.rerollLevel ??
    (carry?.cost <= 1
      ? 5
      : carry?.cost === 2
        ? 6
        : carry?.cost === 3
          ? 7
          : null);
  const finalLevel =
    meta?.levelling === "Fast 9"
      ? 9
      : Math.min(10, Math.max(board.length, rerollLevel ?? 8, 8));
  const steps = [],
    reasons = [];
  let ev = null,
    lobbyInfo = null;
  const out = (action, headline, extra = {}) => ({
    action,
    headline,
    steps,
    reasons,
    ev,
    lobby: lobbyInfo,
    style: meta?.levelling || null,
    rerollLevel,
    finalLevel,
    levelCost,
    interestAt:
      gold === null ? null : Math.min(50, (Math.floor(gold / 10) + 1) * 10),
    ...extra,
  });
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
  // Progresso dos alvos de 3★ (9 cópias) e do carry 2★ (3 cópias).
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
      done: need === 0,
    };
  });
  const open3 = progress.filter((p) => !p.done),
    blocked = open3.filter((p) => !p.possible || p.enemy >= 6);
  const carryPool = pool.get(carry?.name),
    carryOwn = carryPool?.own ?? 0;
  // Força da board (custo x estrelas + itens), a mesma régua para você e para cada rival vivo.
  const STAR = [0, 1, 1.8, 3.2],
    might = (units) =>
      units.reduce(
        (n, u) =>
          n +
          (u.cost ?? u.price ?? 1) *
            STAR[Math.max(0, Math.min(3, u.stars ?? u.starLevel ?? 1))] +
          ((u.items ?? u.itemNames)?.length ?? 0) * 0.6,
        0,
      );
  const mine = might(
      analysis.self.units.map((u) => ({
        cost: u.price,
        stars: u.starLevel,
        items: u.itemNames,
      })),
    ),
    rivals = (analysis.opponents ?? [])
      .map((o) => might(o.units))
      .sort((a, b) => b - a);
  const rank = rivals.filter((v) => v > mine).length + 1,
    lobby = rivals.length + 1,
    weak = lobby >= 4 && rank > Math.ceil(lobby * 0.6);
  if (lobby > 1)
    reasons.push(
      `Força da sua board: ${rank}º de ${lobby} no lobby (${Math.round(mine)} contra mediana ${Math.round(rivals[Math.floor(rivals.length / 2)])})${weak ? ": abaixo da maioria, priorize upgrades" : ""}.`,
    );
  // Rivais: nível (unidades em campo) e quantas 2★+ cada um tem, contra os seus.
  const foes = analysis.opponents ?? [],
    avg = (list) =>
      list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  const foeLevel = avg(foes.map((o) => o.units.length)),
    foeStars = avg(
      foes.map((o) => o.units.filter((u) => (u.stars ?? 1) >= 2).length),
    ),
    myStars = analysis.self.units.filter((u) => u.starLevel >= 2).length;
  const levelGap = foes.length ? foeLevel - level : 0;
  lobbyInfo = {
    rank,
    size: lobby,
    mine: Math.round(mine),
    median: Math.round(rivals[Math.floor(rivals.length / 2)] ?? 0),
    foeLevel: Math.round(foeLevel * 10) / 10,
    foeStars: Math.round(foeStars * 10) / 10,
    myStars,
    weak,
  };
  if (foes.length)
    reasons.push(
      `Rivais: nível médio ${lobbyInfo.foeLevel} (você ${level}) e ${lobbyInfo.foeStars} unidades 2★+ em média (você ${myStars}).`,
    );
  // Ganho esperado de força (custo x estrelas) de cada uso do ouro, com as chances reais da pool no seu nível.
  const rollGain = (g) => {
    const slots = Math.floor(g / 2) * 5;
    let gain = 0;
    for (const u of analysis.self.units) {
      const p = pool.get(u.name);
      if (!p) continue;
      const cost = u.price ?? 1,
        s = u.starLevel;
      if (s >= 3) continue;
      const need = s === 1 ? Math.max(1, 3 - p.own) : Math.max(1, 9 - p.own);
      if (need > 3 || p.remainingUpper < need) continue;
      gain +=
        atLeast(need, slots, p.chancePerSlot ?? 0) *
        cost *
        (STAR[s + 1] - STAR[s]);
    }
    for (const b of plan.stage?.buyNow ?? []) {
      const p = pool.get(b.name);
      if (p) gain += atLeast(1, slots, p.chancePerSlot ?? 0) * b.cost * 0.5;
    }
    return gain;
  };
  const nextOdds = ODDS[Math.min(11, level + 1)],
    levelGain = nextOdds.reduce((n, o, i) => n + (o / 100) * (i + 1), 0); // uma vaga a mais com uma unidade 1★ típica do nível seguinte
  const rollBudget = gold === null ? 0 : Math.max(0, gold - 10);
  ev = {
    roll: {
      gold: rollBudget,
      gain: Math.round(rollGain(rollBudget) * 10) / 10,
      perGold: rollBudget ? rollGain(rollBudget) / rollBudget : 0,
    },
    level: {
      cost: levelCost,
      gain: Math.round(levelGain * 10) / 10,
      perGold: levelCost ? levelGain / levelCost : 0,
    },
  };
  if (rollBudget >= 2)
    reasons.push(
      `Ganho esperado de força: rolar ${rollBudget}g ≈ +${ev.roll.gain}${levelCost ? `; subir de nível (${levelCost}g) ≈ +${ev.level.gain}` : ""}.`,
    );
  const danger =
    hp <= 30 || (hp <= 45 && (stage?.stage ?? 0) >= 4) || (weak && hp <= 50);
  const floor = danger ? (hp <= 20 ? 0 : 10) : hp <= 60 ? 30 : 50; // ouro que fica guardado depois de gastar
  const spare = Math.max(0, gold - floor),
    behind = (stage ? level < curveLevel(stage) : false) || levelGap >= 1;
  if (stage)
    reasons.push(
      `Estágio ${stage.stage}-${stage.round}: a curva padrão está no nível ${curveLevel(stage)}; você está no ${level}.`,
    );
  reasons.push(
    `HP ${hp}, ${gold}g${levelCost === null ? "" : `, faltam ${xpNeed} XP (${levelCost}g) para o nível ${level + 1}`}.`,
  );
  // 1) Vida em risco: gastar para estabilizar agora vale mais que juros.
  if (danger) {
    if (levelCost !== null && behind && gold - levelCost >= 10) {
      steps.push(
        `Suba para o nível ${level + 1} (${levelCost}g): você está abaixo da curva e precisa de mais uma unidade em campo.`,
      );
    }
    const roll = Math.max(
      0,
      gold -
        floor -
        (behind && levelCost !== null && gold - levelCost >= 10
          ? levelCost
          : 0),
    );
    steps.push(
      roll >= 2
        ? `Role cerca de ${roll}g (${Math.floor(roll / 2)} lojas) buscando 2★ na frontline e no carry; pare em ${floor}g.`
        : "Sem ouro para rolar: equipe os itens e posicione para perder por pouco.",
    );
    reasons.push(
      `Vida em risco: guardar ouro para juros não compensa perder mais ${hp <= 20 ? "uma luta" : "lutas"}.`,
    );
    return out("ROLAR", `Estabilize agora: role até ${floor}g`, {
      spend: roll,
      keep: floor,
    });
  }
  // 2) Comp de reroll: economizar até 50, rolar só o excedente no nível certo até fechar os 3★.
  if (rerollLevel && open3.length && level <= rerollLevel + 1) {
    if (level < rerollLevel) {
      if (levelCost !== null && (behind || gold - levelCost >= 50)) {
        steps.push(
          `Suba para o nível ${level + 1} (${levelCost}g): o reroll desta comp é no nível ${rerollLevel}.`,
        );
        return out("SUBIR NÍVEL", `Suba para o nível ${level + 1}`, {
          spend: levelCost,
          keep: gold - levelCost,
        });
      }
      steps.push(
        `Economize: junte até 50g antes de chegar no nível ${rerollLevel}, onde começa o reroll.`,
      );
      return out(
        "ECONOMIZAR",
        `Economize até ${Math.min(50, (Math.floor(gold / 10) + 1) * 10)}g`,
        { keep: gold },
      );
    }
    for (const p of open3)
      reasons.push(
        `${p.name}: ${p.own}/9 cópias para 3★, ${p.left} livres na pool${p.enemy ? `, ${p.enemy} com rivais` : ""}.`,
      );
    if (blocked.length === open3.length) {
      steps.push(
        `Pare o reroll: ${blocked.map((p) => p.name).join(", ")} não fecha(m) 3★ com a pool atual. Fique em 2★ e suba de nível.`,
      );
      if (levelCost !== null && gold - levelCost >= 30)
        steps.push(`Suba para o nível ${level + 1} (${levelCost}g).`);
      return out(
        "SUBIR NÍVEL",
        "3★ disputado: desista do reroll e suba de nível",
        {
          spend: levelCost,
          keep: levelCost === null ? gold : gold - levelCost,
        },
      );
    }
    if (gold > 50) {
      const roll = gold - 50;
      steps.push(
        `Role ${roll}g (${Math.floor(roll / 2)} lojas) no nível ${level} buscando ${open3
          .filter((p) => p.possible)
          .map((p) => p.name)
          .join(", ")}; pare em 50g para manter os juros.`,
      );
      return out("ROLAR", `Reroll lento: role ${roll}g e volte a 50g`, {
        spend: roll,
        keep: 50,
      });
    }
    steps.push(
      `Economize até 50g; depois role só o que passar disso buscando ${open3.map((p) => p.name).join(", ")}.`,
    );
    return out("ECONOMIZAR", "Economize até 50g para o reroll lento", {
      keep: gold,
    });
  }
  // 3) Comp de nível (Fast 8, Fast 9, Standard): subir no tempo certo e rolar no nível do carry.
  const rollLevel = Math.min(
    finalLevel,
    carry?.cost >= 5 ? 9 : carry?.cost >= 4 ? 8 : 7,
  );
  if (level < rollLevel) {
    if (
      levelCost !== null &&
      (behind
        ? gold - levelCost >= Math.min(floor, 30)
        : gold - levelCost >= floor)
    ) {
      steps.push(
        `Suba para o nível ${level + 1} (${levelCost}g)${behind ? ": você está abaixo da curva" : ": a economia continua acima de " + floor + "g"}.`,
      );
      return out("SUBIR NÍVEL", `Suba para o nível ${level + 1}`, {
        spend: levelCost,
        keep: gold - levelCost,
      });
    }
    if (weak && spare >= 6 && ev.roll.perGold > ev.level.perGold) {
      steps.push(
        `Você é o ${rank}º de ${lobby} em força: role ${spare}g (${Math.floor(spare / 2)} lojas) para fechar os 2★ que já tem pares; pare em ${floor}g.`,
      );
      reasons.push(
        "Rolar agora rende mais força por ouro do que subir de nível.",
      );
      return out(
        "ROLAR",
        `Role ${spare}g por upgrades: board abaixo do lobby`,
        { spend: spare, keep: floor },
      );
    }
    steps.push(
      `Economize: o carry ${carry?.name ?? ""} (custo ${carry?.cost ?? "?"}) só aparece bem a partir do nível ${rollLevel}. Não role agora.`,
    );
    return out(
      "ECONOMIZAR",
      `Economize até ${Math.min(50, (Math.floor(gold / 10) + 1) * 10)}g e suba no tempo certo`,
      { keep: gold },
    );
  }
  if (carryOwn < 3) {
    reasons.push(
      `${carry.name}: ${carryOwn}/3 cópias para 2★, ${carryPool?.remainingUpper ?? 0} livres na pool${carryPool?.enemy ? `, ${carryPool.enemy} com rivais` : ""}.`,
    );
    if (spare >= 2) {
      steps.push(
        `Role ${spare}g (${Math.floor(spare / 2)} lojas) no nível ${level} buscando ${carry.name} 2★ e a frontline 2★; pare em ${floor}g.`,
      );
      return out("ROLAR", `Role ${spare}g por ${carry.name} 2★`, {
        spend: spare,
        keep: floor,
      });
    }
    steps.push(
      `Ouro no piso (${floor}g): economize mais uma rodada e role depois.`,
    );
    return out("ECONOMIZAR", "Economize para a próxima rolagem", {
      keep: gold,
    });
  }
  if (level < finalLevel) {
    if (levelCost !== null && gold - levelCost >= Math.min(floor, 30)) {
      steps.push(
        `Núcleo pronto: suba para o nível ${level + 1} (${levelCost}g) para encaixar mais uma unidade forte.`,
      );
      return out("SUBIR NÍVEL", `Suba para o nível ${level + 1}`, {
        spend: levelCost,
        keep: gold - levelCost,
      });
    }
    steps.push(`Núcleo pronto: economize para o nível ${level + 1}.`);
    return out("ECONOMIZAR", `Economize para o nível ${level + 1}`, {
      keep: gold,
    });
  }
  if (spare >= 2) {
    steps.push(
      `Nível final: role ${spare}g melhorando estrelas e buscando unidades de custo alto; pare em ${floor}g.`,
    );
    return out("ROLAR", `Role ${spare}g para fechar upgrades`, {
      spend: spare,
      keep: floor,
    });
  }
  steps.push("Mantenha a economia e ajuste posicionamento e itens.");
  return out("ECONOMIZAR", "Economize e ajuste o campo", { keep: gold });
}

/** Devolve a ação de agora e os quadros de economia, nível e roll para a comp `plan` no estado atual. */
export function strategy(plan, analysis, options) {
  const d = decide(plan, analysis, options),
    gold = options.gold,
    level = options.level,
    stage = options.stage ?? null;
  const pool = new Map(analysis.pool.map((p) => [p.name, p])),
    carry = plan.board.find((u) => u.name === plan.carry) ?? plan.board[0];
  const rollAt =
    d.rerollLevel ??
    Math.min(d.finalLevel, carry?.cost >= 5 ? 9 : carry?.cost >= 4 ? 8 : 7);
  const xp = /^(\d+)\/(\d+)$/.exec(options.xp ?? ""),
    xpNeed = xp ? Math.max(0, Number(xp[2]) - Number(xp[1])) : null;
  const interest = gold === null ? null : Math.min(5, Math.floor(gold / 10)),
    next =
      gold === null || gold >= 50 ? null : (Math.floor(gold / 10) + 1) * 10;
  const economy = {
    gold,
    interest,
    next,
    keep: d.keep ?? null,
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
        : "Juros atuais: +" +
          interest +
          "g por rodada." +
          (next
            ? " Próximo patamar em " +
              next +
              "g (faltam " +
              (next - gold) +
              "g)."
            : " Juros no máximo (50g)."),
  };
  const curve = stage
    ? [
        [2, 1, 4],
        [2, 5, 5],
        [3, 2, 6],
        [4, 1, 7],
        [4, 5, 8],
        [5, 5, 9],
      ].reduce(
        (l, [s, r, v]) =>
          stage.stage > s || (stage.stage === s && stage.round >= r) ? v : l,
        3,
      )
    : null;
  const leveling = {
    level,
    xp: xp ? { have: Number(xp[1]), total: Number(xp[2]) } : null,
    cost: d.levelCost ?? null,
    go: d.action === "SUBIR NÍVEL",
    curve,
    finalLevel: d.finalLevel,
    value: "Nível " + level,
    verdict:
      d.action === "SUBIR NÍVEL"
        ? "SUBIR AGORA" + (d.levelCost != null ? " · " + d.levelCost + "g" : "")
        : "não subir agora",
    text:
      (d.levelCost == null
        ? "XP não lido da tela."
        : "Faltam " +
          xpNeed +
          " XP (" +
          d.levelCost +
          "g) para o nível " +
          (level + 1) +
          ".") +
      (curve
        ? " Curva padrão no estágio " +
          stage.stage +
          "-" +
          stage.round +
          ": nível " +
          curve +
          "."
        : "") +
      " Nível final desta comp: " +
      d.finalLevel +
      ".",
  };
  // Alvos da rolagem: os 3★ da comp de reroll, ou o carry 2★ nas comps de nível.
  const stars3 = (plan.meta?.stars3 ?? [])
      .map((id) => plan.board.find((u) => u.id === id))
      .filter(Boolean),
    shops = d.action === "ROLAR" && d.spend ? Math.floor(d.spend / 2) : 0;
  const targets = (
    d.rerollLevel && stars3.length
      ? stars3.map((u) => ({ u, goal: 9 }))
      : carry
        ? [{ u: carry, goal: 3 }]
        : []
  ).map(({ u, goal }) => {
    const p = pool.get(u.name),
      own = p?.own ?? 0,
      chance = p?.chancePerShop ?? 0;
    return {
      id: u.id,
      name: u.name,
      cost: u.cost,
      goalStars: goal === 9 ? 3 : 2,
      own,
      goal,
      left: p?.remainingUpper ?? 0,
      enemy: p?.enemy ?? 0,
      chancePerShop: chance,
      chanceInRoll: shops ? 1 - (1 - chance) ** shops : null,
      done: own >= goal,
    };
  });
  const rolling = {
    level,
    at: rollAt,
    go: d.action === "ROLAR",
    spend: d.action === "ROLAR" ? (d.spend ?? 0) : 0,
    shops,
    keep: d.keep ?? null,
    value: "Nível de roll " + rollAt,
    verdict:
      d.action === "ROLAR"
        ? "ROLAR " +
          d.spend +
          "g · " +
          shops +
          " lojas · parar em " +
          d.keep +
          "g"
        : "não rolar agora",
    text:
      level < rollAt
        ? "Você está no nível " +
          level +
          ": rolar agora quase não mostra o que a comp precisa."
        : level === rollAt
          ? "Este é o nível de rolagem da comp."
          : "Você já passou do nível de rolagem; role só para fechar upgrades.",
    targets,
  };
  return { ...d, panels: { economy, leveling, rolling } };
}
