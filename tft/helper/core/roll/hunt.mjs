// Caça por ouro: com o ouro que dá para gastar agora, quais campeões valem a rolagem, com que chance de fechar a próxima
// estrela (ou de achar a peça que falta), quanto rolar e onde parar. O 3★ é tratado à parte (`threeStar`): ele se fecha
// em várias rodadas (reroll lento), então a conta de uma rodada só não basta.
//
// Regra única (planos/a-fazer/rolagem-por-ouro.md, seções 2 a 4): `roll.mjs`/`strategy.mjs` chamam estas funções e a
// interface e o overlay só desenham o resultado. ESM puro, sem I/O: carrega igual no servidor e no navegador.
//
// Orçamentos de cada alvo:
//   - `spend` (B): ouro depois da loja − piso da faixa de vida/reroll (no crítico, mais a venda do banco fora do plano);
//   - `total` (T): todo o ouro depois da loja (o preço de quebrar os juros);
//   - `levelUp` (B↑): B − XP até o nível seguinte, com as odds do nível seguinte.
// A chance de cada alvo é a conta exata de core/pool/curve.mjs (pool encolhendo, preço das cópias), focando nele.
import { POLICY } from "../economy/policy.mjs";
import { incomeOf } from "../economy/gold.mjs";
import { LEVELS, POOL, SHOP } from "../pool/tables.mjs";
import { starCopies, starsForCopies } from "../pool/copies.mjs";
import { oddsAt } from "../pool/shop.mjs";
import { closeCurve, goldFor } from "../pool/curve.mjs";
import { REACH } from "../comps/reach.mjs";

const R = POLICY.roll;

/**
 * Política desta regra (não medida, salvo onde marcado). Os limiares de ouro e de vida continuam em POLICY; aqui só
 * chances, contagens de cópias e o valor medido de cada estrela.
 */
export const HUNT = {
  // Teto de ouro das curvas (o mesmo da simulação de rolagem).
  maxGold: POLICY.simulation.maxGold,
  // Chance a partir da qual cada loja a mais rende pouco: o gasto do alvo para aí.
  enough: 0.8,
  // 3★: abrir o reroll com pelo menos `early` cópias até o estágio `lastEarlyStage` (o par do 2★ já na mão) ou `late`
  // depois; um rival com `rivalHold` cópias (2★ ou o par guardado) disputa a peça; abrir com `slowChance` de fechar até o
  // prazo (abaixo dos 50% de uma rodada: o reroll lento só gasta o que passa do piso de juros, então não perde juros),
  // desistir abaixo de `giveUp` (só no nível de rolagem: abaixo dele, segurar as cópias quase não custa). Política, a
  // calibrar com as lojas reais (plano, R8).
  openCopies: { early: 3, late: 5, lastEarlyStage: 3 },
  rivalHold: 3,
  slowChance: 0.4,
  giveUp: 0.25,
  // "Guarde até Zg" só quando Z chega com a renda de até `saveRounds` rodadas; acima disso o alvo fica "longe".
  saveRounds: 2,
  // 3★ oportunista (fora da comp de reroll): peça sua de custo até `opportunistMaxCost` com `opportunistCopies` cópias.
  opportunistCopies: 6,
  opportunistMaxCost: 3,
  // Rodadas até o prazo quando o chamador não diz (o mesmo padrão do alcance sem estágio lido).
  rounds: REACH.unknownRounds,
  // Colocação ganha por estrela, mediana por custo 1..5 (MetaTFT Set 18, snapshot 18.4b, tabuleiros finais, 2026-10-11).
  // Medido, com viés declarado: quem fecha 3★ já estava ganhando. `shrinkGames`: partidas a partir das quais a célula do
  // campeão pesa tanto quanto a mediana do custo.
  starGain: {
    2: [0.55, 0.63, 0.95, 1.63, 1.9],
    3: [0.54, 1.0, 1.34, 2.63, 1.79],
  },
  shrinkGames: 500,
};

const THREE = starCopies(3);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Percentual curto: "<1%" para chance positiva pequena e "~100%" perto de 1. */
export const pctText = (p) =>
  p == null
    ? "–"
    : p >= 0.995
      ? "~100%"
      : p > 0 && p < 0.01
        ? "<1%"
        : `${Math.round(p * 100)}%`;

/** 3★ disputado demais: muitas cópias com rivais (em campo ou estimadas no banco) ou fração alta da pool. */
export const isContested = (p) => {
  const held = (p?.enemy ?? 0) + (p?.hidden ?? 0);
  return (
    held >= POLICY.contested.copies ||
    held / (p?.total ?? POOL[p?.cost] ?? 1) > POLICY.contested.share
  );
};

/**
 * Orçamentos da rolagem. `gold`: ouro depois das compras da loja; `floor`: piso da faixa (ou do reroll); `sellable`: ouro
 * da venda do banco fora do plano (só conta no `critical`); `levelCost`: ouro de XP até o nível seguinte (null sem XP lido).
 */
export function huntBudget({
  gold,
  floor = 0,
  level,
  levelCost = null,
  sellable = 0,
  critical = false,
}) {
  const sale = critical ? Math.max(0, sellable) : 0,
    have = Math.max(0, gold ?? 0),
    spend = Math.max(0, have + sale - Math.max(0, floor));
  return {
    gold: have,
    floor: Math.max(0, floor),
    spend,
    total: have + sale,
    sale,
    levelUp:
      levelCost > 0 && level < LEVELS.max
        ? {
            level: level + 1,
            cost: levelCost,
            spend: Math.max(0, spend - levelCost),
          }
        : null,
  };
}

/**
 * Curva exata de fechar o alvo (`own` → `goal` cópias) por ouro gasto, no nível. `rivals` (≥ 1) divide a chance por vaga
 * pelos rivais que também compram a peça: o denominador cresce por esse fator, as cópias livres não (a pool da peça não
 * acaba antes por isso).
 */
const curveAt = (x, level, rivals = 1) =>
  closeCurve({
    level,
    cost: x.cost,
    own: x.own,
    goal: x.goal,
    free: x.free,
    denom: x.denom * rivals,
    maxGold: HUNT.maxGold,
  });

/** Chance na curva com `gold` de orçamento (0 abaixo de uma loja). */
const chanceAt = (curve, gold) =>
  gold >= SHOP.cost ? curve[clamp(Math.floor(gold), 0, curve.length - 1)] : 0;

/**
 * Ouro gasto em média até fechar ou bater o teto `budget`: E[min(G, B)] = Σ_{g<B} P(G > g), com G o ouro que fecha.
 */
export function expectedSpend(curve, budget) {
  const top = clamp(Math.floor(budget), 0, curve.length - 1);
  let sum = 0;
  for (let g = 0; g < top; g++) sum += 1 - curve[g];
  return sum;
}

/**
 * Colocação ganha ao passar de `from`★ a `to`★ (`from` 0 = peça nova). Com a estatística da MetaTFT (`stats.unit`,
 * `"id|estrela"` → [colocação média, partidas]) a célula do campeão é encolhida para a mediana do custo; sem ela, a
 * mediana. Peça nova vale `POLICY.newUnitWeight` do 1★→2★ do custo (régua provisória até a força na vaga de interim).
 */
export function starValue({ stats = null, id = null, cost, from, to }) {
  const c = clamp(cost ?? 1, 1, 5) - 1;
  if (from <= 0) return POLICY.newUnitWeight * HUNT.starGain[2][c];
  let gain = 0;
  for (let s = from + 1; s <= to; s++) {
    const median = HUNT.starGain[s]?.[c] ?? 0,
      a = stats?.unit?.[`${id}|${s - 1}`],
      b = stats?.unit?.[`${id}|${s}`];
    if (Array.isArray(a) && Array.isArray(b) && b[1] > 0) {
      const w = b[1] / (b[1] + HUNT.shrinkGames);
      gain += w * (a[0] - b[0]) + (1 - w) * median;
    } else gain += median;
  }
  return Math.max(0, gain);
}

/**
 * "Ana 3, ~1 no banco de Bia": quem segura cópias da peça (campo e banco estimado). Rival com `copies` null (só o nome
 * conhecido) aparece só pelo nome.
 */
export function holdersText(holders = []) {
  return holders
    .filter((h) => h.copies == null || h.copies + (h.hidden ?? 0) >= 0.5)
    .map((h) =>
      h.copies == null
        ? h.name
        : h.copies > 0
          ? `${h.name} ${h.copies}${h.hidden >= 0.5 ? ` (+~${Math.round(h.hidden)} no banco)` : ""}`
          : `~${Math.round(h.hidden)} no banco de ${h.name}`,
    )
    .join(", ");
}

/** Quem mais segura a peça (cópias em campo + banco estimado), ou null. */
const topHolder = (holders = []) =>
  [...holders]
    .map((h) => ({ ...h, held: (h.copies ?? 0) + (h.hidden ?? 0) }))
    .filter((h) => h.held > 0)
    .sort((a, b) => b.held - a.held)[0] ?? null;

/** Um décimo, só para exibir (a conta usa o valor fracionário inteiro). */
const tenth = (v) => Math.round(v * 10) / 10;

/** "Ana segura 4 cópias (3 em campo + ~1 no banco)". */
function heldText(top) {
  const n = Math.round(top.held),
    hidden = Math.round(top.hidden ?? 0);
  return `${top.name} segura ${n} ${n === 1 ? "cópia" : "cópias"}${hidden >= 1 ? ` (${top.copies ?? 0} em campo + ~${hidden} no banco)` : ""}`;
}

/** Por que o alvo não fecha rolando (ou null). */
function blockOf(x, level) {
  const need = x.goal - x.own;
  if (oddsAt(level, x.cost) <= 0) return "nivel";
  if ((x.upper ?? Infinity) < need) return "sem-copias";
  if (x.free < need) return "bancos";
  if (x.goal >= THREE && isContested(x)) return "disputada";
  return null;
}

const WHY = {
  nivel: (x, level) => `a loja do nível ${level} não tem custo ${x.cost}`,
  "sem-copias": (x) =>
    `faltam ${x.goal - x.own} cópias e só ${x.upper} estão fora dos tabuleiros`,
  bancos: (x) =>
    `faltam ${x.goal - x.own}; só ~${tenth(x.free)} livres (o resto deve estar no banco dos rivais)`,
  disputada: (x) => {
    const top = topHolder(x.holders);
    return top
      ? `disputada: ${heldText(top)}`
      : `disputada: ${Math.round((x.enemy ?? 0) + (x.hidden ?? 0))} cópias com rivais`;
  },
};

/** Rótulo curto da meta do alvo: "2★", "3★ 4/9", "nova". */
const goalTag = (x) =>
  x.own <= 0
    ? "nova"
    : x.goal >= THREE
      ? `3★ ${x.own}/${THREE}`
      : `${starsForCopies(x.goal)}★`;

/**
 * Um alvo da rolagem. `x`: `{ id, name, cost, own, goal, free, upper, denom, enemy, hidden, holders, value, kind,
 * carry, inPlan }` (`goal` em cópias: 1 = achar a peça, 3 = 2★, 9 = 3★; `denom` = livres do custo; `value` = colocação
 * ganha, já com o peso de prioridade). `ctx`: `{ level, budget (huntBudget), danger }`.
 * Devolve null se o alvo já está fechado.
 */
export function huntTarget(x, { level, budget, danger = false }) {
  const need = x.goal - x.own;
  if (need <= 0) return null;
  const block = blockOf(x, level),
    tag = goalTag(x),
    base = {
      id: x.id,
      name: x.name,
      cost: x.cost,
      kind: x.kind ?? (x.own > 0 ? "estrela" : "nova"),
      carry: !!x.carry,
      inPlan: x.inPlan !== false,
      own: x.own,
      goal: x.goal,
      need,
      stars: starsForCopies(x.own),
      goalStars: starsForCopies(x.goal),
      tag,
      free: x.free,
      upper: x.upper ?? null,
      enemy: x.enemy ?? 0,
      hidden: x.hidden ?? 0,
      holders: x.holders ?? [],
      value: x.value ?? 0,
    };
  if (block)
    return {
      ...base,
      verdict: block === "disputada" ? "disputada" : "inviavel",
      why: block,
      chance: { spend: 0, total: 0, levelUp: null },
      spend: 0,
      perGold: 0,
      saveTo: null,
      text: `${x.name} ${tag}: ${WHY[block](x, level)}`,
    };
  const curve = curveAt(x, level),
    up = budget.levelUp,
    upCurve = up && oddsAt(up.level, x.cost) > 0 ? curveAt(x, up.level) : null,
    chance = {
      spend: chanceAt(curve, budget.spend),
      total: chanceAt(curve, budget.total),
      levelUp: upCurve ? chanceAt(upCurve, up.spend) : null,
    };
  const cut = goldFor(curve, HUNT.enough),
    spend =
      budget.spend >= SHOP.cost
        ? Math.min(budget.spend, cut ?? budget.spend)
        : 0,
    paid = expectedSpend(curve, spend),
    perGold =
      spend && paid > 0 ? (chanceAt(curve, spend) * base.value) / paid : 0,
    bar = danger ? R.dangerChance : R.chance,
    pass = goldFor(curve, bar),
    saveTo = pass == null ? null : budget.floor + pass,
    // Ouro que chega guardando `saveRounds` rodadas (renda com os juros de agora, sem sequência).
    reach = budget.total + HUNT.saveRounds * incomeOf(budget.total).total;
  const verdict =
    chance.levelUp != null && chance.levelUp >= chance.spend + R.waitMargin
      ? "suba"
      : chance.spend >= bar
        ? "role"
        : saveTo != null && saveTo <= reach
          ? "guarde"
          : "longe";
  const lead = `${x.name} ${tag}`,
    text =
      verdict === "role"
        ? `${lead} · ${pctText(chanceAt(curve, spend))} com ${spend}g`
        : verdict === "suba"
          ? `${lead} · ${pctText(chance.spend)} → ${pctText(chance.levelUp)} subindo para o nível ${up.level} antes (${up.cost}g de XP)`
          : verdict === "guarde"
            ? `${lead} · ${pctText(chance.spend)} com ${budget.spend}g; passa de ${pctText(bar)} guardando até ${saveTo}g${chance.total >= bar ? ` (com tudo, ${budget.total}g: ${pctText(chance.total)})` : ""}`
            : saveTo != null
              ? `${lead} · ${pctText(chance.spend)} com ${budget.spend}g; ${pctText(bar)} só com ~${pass}g acima do piso`
              : `${lead} · ${pctText(chance.total)} até com tudo (${budget.total}g)`;
  return {
    ...base,
    verdict,
    why: null,
    chance,
    spend,
    perGold,
    saveTo,
    text,
  };
}

/**
 * 3★ em várias rodadas (reroll lento ou oportunista). `x` como em `huntTarget`, com `goal` = 9. `ctx`:
 *  - `level`: nível de agora; `rollLevel`: nível em que a comp rola (reroll), ou null (oportunista: o de agora);
 *  - `gold`/`floor`: ouro depois da loja e piso (50 no lento, 20 no rápido);
 *  - `rounds`: rodadas até o prazo (alcance: ponto de poder ou o que a vida aguenta); `deadline`: rótulo ("4-1");
 *  - `stage`: estágio lido (só o número entra: cópias mínimas para abrir);
 *  - `reroll`: comp de reroll (true) ou 3★ oportunista (false).
 * Rodadas somadas num orçamento só: o ouro de agora acima do piso + a renda guardando no piso nas rodadas seguintes + uma
 * loja grátis por rodada. A chance por vaga é dividida pelos rivais que seguram a peça (`REACH.rivalShare` cada), como
 * no alcance. Aproximação declarada: sem vendas que devolvem cópias e sem o XP da subida até `rollLevel`.
 * Devolve `{ own, of, need, free, holders, top, now, slow, rounds, gold, verdict, why, text }`, com o veredito "role",
 * "segure" ou "desista".
 */
export function threeStar(
  x,
  {
    level,
    rollLevel = null,
    gold,
    floor = 0,
    rounds = HUNT.rounds,
    deadline = null,
    stage = null,
    reroll = true,
  },
) {
  const need = THREE - x.own,
    top = topHolder(x.holders),
    at = Math.max(level, rollLevel ?? level),
    H = Math.max(1, Math.round(rounds)),
    spare = Math.max(0, (gold ?? 0) - floor),
    slowGold =
      spare + (H - 1) * incomeOf(Math.max(floor, 0)).total + H * SHOP.cost,
    // Rival com cópias não contadas (`copies` null: só o nome, enquanto a análise não as separa por rival) conta como quem
    // segura a peça.
    holding = (x.holders ?? []).filter(
      (h) => (h.copies ?? 1) + (h.hidden ?? 0) >= 1,
    ).length,
    rivalsSlow = 1 + REACH.rivalShare * holding,
    open =
      (stage?.stage ?? stage ?? 0) <= HUNT.openCopies.lastEarlyStage
        ? HUNT.openCopies.early
        : HUNT.openCopies.late,
    until = deadline
      ? `até ${deadline}`
      : `em ${H} ${H === 1 ? "rodada" : "rodadas"}`;
  const out = {
    id: x.id,
    name: x.name,
    cost: x.cost,
    own: x.own,
    of: THREE,
    need,
    free: x.free,
    holders: x.holders ?? [],
    top,
    rounds: H,
    gold: Math.round(slowGold),
    now: 0,
    slow: 0,
    level: at,
    verdict: "desista",
    why: null,
    text: "",
  };
  const head = `${x.name} 3★ ${x.own}/${THREE}`,
    who = holdersText(x.holders);
  if (need <= 0) return { ...out, verdict: "pronto", text: `${head}: pronto` };
  const block = blockOf({ ...x, goal: THREE }, at);
  if (block || (top && top.held >= HUNT.rivalHold)) {
    out.why = block ?? "rival";
    out.text = `${head}: desista do 3★, ${block ? WHY[block]({ ...x, goal: THREE }, at) : heldText(top)}`;
    return out;
  }
  const xs = { ...x, goal: THREE };
  out.now = level >= at ? chanceAt(curveAt(xs, level), spare) : 0;
  out.slow = chanceAt(curveAt(xs, at, rivalsSlow), slowGold);
  const facts = `${tenth(x.free)} livres${who ? ` · ${who}` : ""}`;
  if (out.slow < HUNT.giveUp && level >= at) {
    out.why = "prazo";
    out.text = `${head} (${facts}): desista do 3★, só ${pctText(out.slow)} ${until} rolando o que passa de ${floor}g; fique no 2★`;
    return out;
  }
  if (x.own < open || (!reroll && x.own < HUNT.opportunistCopies)) {
    out.verdict = "segure";
    out.why = "copias";
    out.text = `${head} (${facts}): segure as cópias e compre as que aparecerem; ${pctText(out.slow)} ${until}`;
    return out;
  }
  if (level < at) {
    out.verdict = "segure";
    out.why = "nivel";
    out.text = `${head} (${facts}): segure as cópias e role no nível ${at}; ${pctText(out.slow)} ${until} rolando o que passa de ${floor}g`;
    return out;
  }
  if (out.slow < HUNT.slowChance && out.now < R.chance) {
    out.verdict = "segure";
    out.why = "chance";
    out.text = `${head} (${facts}): só ${pctText(out.slow)} ${until} rolando o que passa de ${floor}g; segure as cópias e compre as que aparecerem`;
    return out;
  }
  out.verdict = "role";
  out.text =
    spare >= SHOP.cost
      ? `${head} (${facts}): role o que passa de ${floor}g, ${spare}g agora (${pctText(out.now)}); ${pctText(out.slow)} ${until}`
      : `${head} (${facts}): ${pctText(out.slow)} ${until} rolando o que passa de ${floor}g a cada rodada`;
  return out;
}

const RANK = { role: 0, suba: 1, junto: 2, segure: 3, guarde: 4, longe: 5 };

/**
 * A caça inteira: alvos em ordem, veredito do time e o que ficou de fora. Entradas:
 *  - `pieces[]`: alvos como em `huntTarget` (com `value`, `kind`, `carry`, `inPlan` e `star3`: a peça é estrela-alvo 3★
 *    da comp de reroll); peça a caminho do 3★ sem `star3` só entra como 3★ oportunista;
 *  - `level`, `budget` (huntBudget), `danger`;
 *  - `three`: contexto de `threeStar` (sem `gold`/`floor`/`level`, que vêm do orçamento) para os alvos de 3★, ou null.
 * Devolve `{ budget, verdict: { kind, spend, keep, saveTo, level, text }, targets, dropped, headline }`.
 */
export function huntPlan({
  pieces = [],
  level,
  budget,
  danger = false,
  three = null,
}) {
  const targets = [],
    dropped = [];
  for (const x of pieces) {
    // 3★ só é alvo quando é o do reroll (`star3`: carry/estrela-alvo da comp de reroll) ou oportunista (custo baixo com
    // muitas cópias); o resto dos 2★ não lista "desista do 3★" (ninguém ia buscá-lo).
    const opportunist =
        x.cost <= HUNT.opportunistMaxCost && x.own >= HUNT.opportunistCopies,
      wanted3 = (three?.reroll !== false && x.star3) || opportunist;
    if (x.goal >= THREE && x.own > 0 && !wanted3) continue;
    const t = huntTarget(x, { level, budget, danger });
    if (!t) continue;
    if (x.goal >= THREE && x.own > 0 && three && t.verdict !== "inviavel") {
      t.three = threeStar(x, {
        ...three,
        reroll: three.reroll !== false && !!x.star3,
        level,
        gold: budget.gold + budget.sale,
        floor: budget.floor,
      });
      // Fechar o 3★ NESTA rodada (≥ 50% com o orçamento) vale mesmo com rival; o resto segue a conta de várias rodadas.
      if (t.verdict === "role") t.text = `${t.text} · ${t.three.text}`;
      else if (t.three.verdict === "desista") {
        t.verdict = "disputada";
        t.why = t.three.why;
        t.text = t.three.text;
      } else {
        t.verdict = t.three.verdict === "role" ? "role" : "segure";
        if (t.verdict === "role")
          t.spend = budget.spend >= SHOP.cost ? budget.spend : 0;
        t.text = t.three.text;
      }
    }
    // Peça nova não dispara a rolagem: vem junto ("compre se aparecer") quando outra peça manda rolar.
    if (t.own <= 0 && t.verdict === "role") {
      t.verdict = "junto";
      t.text = `${t.name} nova · compre se aparecer (${pctText(t.chance.spend)} de achar com ${t.spend}g)`;
    }
    if (t.verdict === "inviavel" || t.verdict === "disputada")
      dropped.push({
        id: t.id,
        name: t.name,
        why: t.why ?? t.three?.why,
        text: t.text,
      });
    else targets.push(t);
  }
  targets.sort(
    (a, b) =>
      RANK[a.verdict] - RANK[b.verdict] ||
      b.perGold - a.perGold ||
      b.chance.spend - a.chance.spend ||
      Number(b.carry) - Number(a.carry) ||
      (a.name < b.name ? -1 : 1),
  );
  // Só quem evolui (cópia de peça sua, 2★/3★) dispara a rolagem; a peça nova vem junto, se aparecer.
  const rolling = targets.filter((t) => t.verdict === "role"),
    along = targets.filter((t) => t.verdict === "junto"),
    climb = targets.find((t) => t.verdict === "suba"),
    saving = targets
      .filter((t) => t.verdict === "guarde" && t.saveTo != null)
      .sort((a, b) => a.saveTo - b.saveTo)[0],
    // Sem ouro acima do piso, o 3★ de várias rodadas ("role o que passar do piso") vira "segure" nesta rodada.
    holding =
      targets.find((t) => t.verdict === "segure") ??
      (budget.spend < SHOP.cost ? rolling.find((t) => t.three) : undefined);
  let verdict;
  if (rolling.length && budget.spend >= SHOP.cost) {
    const spend = Math.max(...rolling.map((t) => t.spend)),
      keep = budget.total - spend;
    verdict = {
      kind: "role",
      spend,
      keep,
      saveTo: null,
      level: null,
      text: `Role ${spend}g, pare em ${keep}g (ou antes, se fechar).`,
    };
  } else if (climb)
    verdict = {
      kind: "suba",
      spend: 0,
      keep: budget.total,
      saveTo: null,
      level: budget.levelUp.level,
      text: `Não role: suba para o nível ${budget.levelUp.level} antes (${climb.name} ${climb.tag}: ${pctText(climb.chance.spend)} → ${pctText(climb.chance.levelUp)}).`,
    };
  else if (saving)
    verdict = {
      kind: "guarde",
      spend: 0,
      keep: budget.total,
      saveTo: saving.saveTo,
      level: null,
      text: `Não role: guarde até ${saving.saveTo}g (${saving.name} ${saving.tag} passa de ${pctText(danger ? R.dangerChance : R.chance)}).`,
    };
  else if (holding)
    verdict = {
      kind: "segure",
      spend: 0,
      keep: budget.total,
      saveTo: null,
      level: holding.three?.level ?? null,
      text: `Não role agora: ${holding.text}.`,
    };
  else
    verdict = {
      kind: "nada",
      spend: 0,
      keep: budget.total,
      saveTo: null,
      level: null,
      text: targets.some((t) => t.verdict === "longe")
        ? `Não role: ninguém fecha com o ouro de agora nem guardando ${HUNT.saveRounds} rodadas (${targets.find((t) => t.verdict === "longe").text}).`
        : dropped.length
          ? `Não role: nada a fechar (${dropped
              .slice(0, 3)
              .map((d) => d.name)
              .join(", ")} fora).`
          : "Não role: nada a fechar.",
    };
  const short = (t) =>
    t.three && t.verdict === "role"
      ? `${t.name} (3★ ${t.own}/${THREE} · ${pctText(t.three.now)} agora · ${pctText(t.three.slow)} em ${t.three.rounds} ${t.three.rounds === 1 ? "rodada" : "rodadas"})`
      : `${t.name} (${t.tag} · ${pctText(t.chance.spend)} com ${t.spend}g)`;
  return {
    budget,
    verdict,
    targets,
    dropped,
    headline:
      verdict.kind === "role"
        ? `Role por: ${rolling.slice(0, 3).map(short).join(" · ")}${along.length ? `; se aparecer: ${along.map((t) => t.name).join(", ")}` : ""}`
        : verdict.text,
  };
}

/** Motivo curto de buscar o alvo (o porquê longo fica em `text`). */
const whyShort = (t) =>
  t.own <= 0
    ? "peça do plano que falta"
    : t.goal >= THREE
      ? t.carry
        ? "3★ do carry"
        : "3★"
      : t.carry
        ? "2★ do carry"
        : "fecha o 2★";

/**
 * Por quem rolar, no formato que a interface e o overlay desenham. `hunt`: saída de `huntPlan` montada com o orçamento
 * DA DECISÃO (o gasto recomendado); `go`: a decisão é rolar. Alvos em ordem: os que evoluem (2★/3★) por ganho por ouro e
 * depois as peças que faltam (vêm junto). Sem alvo com chance, `go` vira false: rolar sem saber por quem não é
 * recomendação. `shop`: cartas da loja de agora por id (`{ slots, buy }`), para destacar "achou: X".
 * Cada alvo: `{ id, name, cost, goal: "2★"|"3★"|"falta", have: "4/9", chance, slow, rivals: { copies, hidden, names },
 * why, text, carry, inShop, slots }`.
 */
export function rollFor(hunt, { go = false, limit = 3, shop = null } = {}) {
  const spend = hunt.budget.spend,
    keep = hunt.budget.total - spend,
    chanceOf = (t) =>
      t.three && t.verdict === "role" && t.chance.spend <= 0
        ? t.three.now
        : t.chance.spend,
    ranked = hunt.targets
      .filter(
        (t) =>
          t.verdict !== "longe" &&
          (chanceOf(t) > 0 ||
            (t.three?.verdict === "role" && t.three.slow > 0)),
      )
      .sort(
        (a, b) =>
          Number(a.own <= 0) - Number(b.own <= 0) ||
          Number(b.verdict === "role") - Number(a.verdict === "role") ||
          chanceOf(b) * b.value - chanceOf(a) * a.value ||
          Number(b.carry) - Number(a.carry),
      );
  const targets = ranked.slice(0, limit).map((t) => {
    const card = shop?.get?.(t.id) ?? null;
    return {
      id: t.id,
      name: t.name,
      cost: t.cost,
      goal: t.own <= 0 ? "falta" : `${t.goalStars}★`,
      have: `${t.own}/${t.goal}`,
      chance: chanceOf(t),
      slow:
        t.three?.verdict === "role"
          ? { chance: t.three.slow, rounds: t.three.rounds }
          : null,
      rivals: {
        copies: t.enemy ?? 0,
        hidden: t.hidden ?? 0,
        names: (t.holders ?? []).map((h) => h.name),
      },
      why: whyShort(t),
      // Sempre com o ouro: "Kayle 3★ 4/9 · 5% com 12g · 52% em 5 rodadas", "Azir 2★ · 52% com 30g", "Diana (falta) · …".
      text: `${t.name} ${t.own <= 0 ? "(falta)" : t.goal >= THREE ? `3★ ${t.own}/${THREE}` : `${t.goalStars}★`} · ${pctText(chanceOf(t))} com ${spend}g${t.three?.verdict === "role" ? ` · ${pctText(t.three.slow)} em ${t.three.rounds} ${t.three.rounds === 1 ? "rodada" : "rodadas"}` : ""}`,
      detail: t.text,
      carry: t.carry,
      inShop: !!card,
      slots: card?.slots ?? [],
    };
  });
  const ok = go && spend >= SHOP.cost && targets.length > 0;
  return {
    go: ok,
    spend: ok ? spend : 0,
    keep: ok ? keep : hunt.budget.total,
    text: ok
      ? `Role ${spend}g (até ${Math.floor(spend / SHOP.cost)} lojas), pare em ${keep}g`
      : "",
    targets: ok ? targets : [],
  };
}
