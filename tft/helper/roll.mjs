// Rolar para o time inteiro: de todos os campeões do tabuleiro, do banco e da comp recomendada, quais dá para
// evoluir (3 cópias → 2★, 9 → 3★) rolando agora, com que chance, quanto ouro gastar e quando parar.
// Entradas: a pool vista (tabuleiros seus e dos rivais, mais o banco dos rivais estimado), as chances da loja do
// nível (ODDS) e o ouro. Cada peça tem a conta exata de fechar a próxima estrela (economy.closeCurve, pool
// encolhendo); uma simulação do time inteiro (economy.rollSim) divide ouro e pool entre todas as peças e entrega
// o ganho esperado de força e a chance de "pelo menos uma evolui" para qualquer orçamento.
// A regra de "vale rolar agora" é uma só (rollRule): strategy.mjs a aplica à decisão e o painel a mostra.
import { GAME } from "./rules.mjs";
import { buildHolders } from "./core/items/builds.mjs";
import {
  POLICY,
  closeCurve,
  curveSummary,
  finalLevelOf,
  goldFor,
  isContested,
  rerollLevelOf,
  rollLevelOf,
} from "./economy.mjs";
import { simulate } from "./roll-sim.mjs";
import {
  freeByCost,
  freeOf,
  starCopies,
  starsForCopies,
} from "./core/pool/copies.mjs";
import { oddsAt, shopChance, slotChance } from "./core/pool/shop.mjs";
import { LEVELS } from "./core/pool/tables.mjs";

const STAR = POLICY.star,
  R = POLICY.roll,
  CURVE_MAX = POLICY.simulation.maxGold;
// Cópias de 1★ que fecham a 2★ (3) e a 3★ (9): a regra de cópias por estrela é de core/pool.
const TWO_STAR = starCopies(2),
  THREE_STAR = starCopies(3);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const pct = (p) => `${Math.round(p * 100)}%`;
const starOf = starsForCopies;
/** "Kayle 2★" para a estrela a fechar; "Azir (falta)" para a peça que ainda não é sua. */
const goalText = (p) =>
  p.own ? `${p.name} ${p.goalStars}★` : `${p.name} (falta)`;
const listNames = (xs) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`;

// A simulação só depende do nível, dos alvos e da pool, não do ouro: quando só o ouro muda, reaproveita. É um fato do
// grafo (roll-sim.mjs, `roll.sim`, 24 no histórico), não mais um cache com chave montada à mão.

/** Por que a peça não fecha a próxima estrela rolando (texto curto para a lista). */
const WHY = {
  nivel: (p) => `a loja do nível ${p.level} não oferece custo ${p.cost}`,
  "sem-copias": (p) =>
    `faltam ${p.need} cópias e só ${p.upper} estão fora dos tabuleiros`,
  bancos: (p) =>
    `faltam ${p.need}; só ~${round1(p.free)} livres (o resto deve estar no banco dos rivais)`,
  disputada: (p) =>
    `3★ disputado: ${p.enemy + Math.round(p.hidden)} cópias com rivais`,
};

/**
 * Peças do time e o que falta a cada uma. Alvo = todo campeão seu (campo e banco) e da comp recomendada que ainda
 * pode subir de estrela (ou, da comp, ser comprado). A próxima estrela é o 3º de cópias (2★) e depois o 9º (3★).
 * Compras da loja lida (ação "comprar") já contam como suas, saindo da pool antes da rolagem. O valor de cada
 * degrau é custo × ganho de estrela, com peso extra para o carry e para unidades com itens.
 */
export function teamOf(plan, analysis, options) {
  const level = options.level,
    pool = new Map(analysis.pool.map((p) => [p.name, p])),
    denom = { ...freeByCost(analysis.pool) },
    stars3 = new Set(plan.meta?.stars3 ?? []),
    planIds = new Set(plan.board.map((u) => u.id)),
    buyNow = new Set((plan.stage?.buyNow ?? []).map((b) => b.name)),
    flex = new Map((plan.flex ?? []).map((f) => [f.id, f])),
    // Cores além do carry: trunfos medidos, peças ligadas ao aprimoramento escolhido e quem leva itens na build de meta.
    augTraits = new Set(options.augmentTraits ?? []),
    cores = new Set([
      ...(analysis.assets ?? []).map((a) => a.id),
      ...plan.board
        .filter((b) => (b.traits ?? []).some((t) => augTraits.has(t)))
        .map((b) => b.id),
      ...buildHolders(plan.meta),
    ]),
    // Nível em que a comp rola pelo carry (a mesma conta de strategy.mjs). A partir dele, a peça-chave da comp que ainda
    // falta (o carry ou um core) também é motivo de rolar ("buscar"), não só carona de outra rolagem; antes dele, buscar
    // a peça cara do final gastaria o ouro da subida.
    carryUnit = plan.board.find((u) => u.name === plan.carry) ?? plan.board[0],
    rerollLevel = rerollLevelOf(plan.meta, carryUnit?.cost),
    rollAt = rollLevelOf({
      carryCost: carryUnit?.cost,
      finalLevel: finalLevelOf(plan.meta, plan.board.length, rerollLevel),
      rerollLevel,
    }),
    seeking = level >= rollAt,
    isKey = (u) => u.name === plan.carry || cores.has(u.id);
  // Loja lida (as cartas que stage.mjs classificou): em que slots cada campeão aparece e quantas cópias o plano
  // manda comprar agora; as compradas saem da pool antes da rolagem.
  const shop = new Map();
  for (const c of plan.stage?.shop ?? []) {
    const s = shop.get(c.id) ?? {
      slots: [],
      buy: 0,
      gold: 0,
      closes: null,
      action: null,
    };
    s.slots.push(c.slot);
    s.action = c.action;
    s.closes = c.completes ?? s.closes;
    if (c.action === "comprar") {
      s.buy++;
      s.gold += c.cost;
      denom[c.cost] = Math.max(0, (denom[c.cost] ?? 0) - 1);
    }
    shop.set(c.id, s);
  }
  // Todo campeão seu (campo e banco) e as peças da comp que ainda dá para comprar neste nível.
  const mine = new Map();
  const touch = (name, id, cost) => {
    const t = mine.get(name) ?? {
      id,
      name,
      cost,
      items: 0,
      onBoard: false,
      inBench: false,
    };
    mine.set(name, t);
    return t;
  };
  for (const u of analysis.self.units ?? []) {
    const t = touch(u.name, u.championName, u.price ?? 1);
    t.onBoard = true;
    t.items += u.itemNames?.length ?? 0;
  }
  for (const u of analysis.self.reserve ?? [])
    touch(u.name, u.championName ?? u.id, u.cost ?? 1).inBench = true;
  for (const u of plan.board)
    if (
      !mine.has(u.name) &&
      ((pool.get(u.name)?.own ?? 0) > 0 ||
        buyNow.has(u.name) ||
        (seeking && isKey(u) && oddsAt(level, u.cost) > 0))
    )
      touch(u.name, u.id, u.cost);

  const pieces = [];
  for (const t of mine.values()) {
    const p = pool.get(t.name);
    if (!p) continue;
    const cost = p.cost ?? t.cost,
      bought = shop.get(t.id)?.buy ?? 0,
      own = (p.own ?? 0) + bought;
    if (own >= THREE_STAR) continue;
    const inPlan = planIds.has(t.id),
      carry = t.name === plan.carry;
    if (!own && !inPlan) continue;
    const core = carry || cores.has(t.id) || t.items >= 2,
      free = Math.max(0, freeOf(p) - bought),
      upper = Math.max(0, (p.remainingUpper ?? 0) - bought),
      w =
        (carry ? POLICY.carryWeight : core ? R.coreWeight : 1) *
        (1 + POLICY.itemWeight * t.items) *
        (inPlan ? 1 : R.offPlanWeight),
      star = (to) => w * cost * (STAR[to] - STAR[to - 1]);
    // Peça-chave que falta no nível de rolagem: rolar para buscá-la vale por si (ela destrava a comp), com o valor cheio.
    const seek = !own && inPlan && core && seeking;
    // Degraus: cópias a comprar até render o valor. Peça nova só vale uma cópia (e, no carry, o 2★ depois); a peça
    // comum que falta vale metade (vem junto de outra rolagem).
    let steps = [],
      far = false;
    if (!own) {
      steps = [
        {
          copies: 1,
          value: w * cost * STAR[1] * (seek ? 1 : POLICY.newUnitWeight),
        },
      ];
      if (carry && upper >= TWO_STAR)
        steps.push({ copies: TWO_STAR, value: star(2) });
    } else if (own < TWO_STAR) {
      steps = [{ copies: TWO_STAR - own, value: star(2) }];
      if (stars3.has(t.id))
        steps.push({ copies: THREE_STAR - own, value: star(3) });
    } else if (stars3.has(t.id) || carry || THREE_STAR - own <= TWO_STAR)
      steps = [{ copies: THREE_STAR - own, value: star(3) }];
    else far = true; // 3★ distante: aparece na lista, mas não entra na simulação
    const goal = !own ? 1 : own < TWO_STAR ? TWO_STAR : THREE_STAR,
      need = goal - own;
    const piece = {
      id: t.id,
      name: t.name,
      cost,
      level,
      stars: starOf(own),
      goalStars: starOf(goal),
      own,
      goal,
      need,
      items: t.items,
      carry,
      core,
      seek,
      inPlan,
      onBoard: t.onBoard,
      inBench: t.inBench,
      free,
      upper,
      enemy: p.enemy ?? 0,
      hidden: p.hidden ?? 0,
      contested: isContested(p),
      chancePerSlot: slotChance(level, cost, free, denom[cost] ?? 0),
      // O mesmo no nível seguinte (a subida muda as odds do custo e, por isso, a chance de achar a peça).
      chancePerSlotNext:
        level < LEVELS.max
          ? slotChance(level + 1, cost, free, denom[cost] ?? 0)
          : null,
      value: steps[0]?.value ?? star(starOf(goal)),
      shop: shop.get(t.id) ?? null,
    };
    piece.chancePerShop = shopChance(piece.chancePerSlot);
    piece.chancePerShopNext =
      piece.chancePerSlotNext == null
        ? null
        : shopChance(piece.chancePerSlotNext);
    piece.why =
      oddsAt(level, cost) <= 0
        ? "nivel"
        : upper < need
          ? "sem-copias"
          : free < need
            ? "bancos"
            : goal === THREE_STAR && piece.contested
              ? "disputada"
              : null;
    piece.status = piece.why ? "inviavel" : far ? "longe" : "ok";
    piece.curve = closeCurve({
      level,
      cost,
      own,
      goal,
      free,
      denom: denom[cost] ?? 0,
    });
    piece.gold50 = goldFor(piece.curve, R.chance);
    // Quanto a peça rende por cópia procurada: ordena os nomes citados antes de simular.
    piece.prior = (piece.value * piece.chancePerShop) / need;
    if (piece.why) {
      const f = flex.get(t.id),
        pick = f?.options?.find((o) => o.id === f.suggest) ?? f?.options?.[0];
      piece.substitute = pick
        ? { id: pick.id, name: pick.name, cost: pick.cost, owned: !!pick.owned }
        : null;
    }
    if (piece.status === "ok")
      piece.sim = {
        cost,
        free,
        // Dispara a rolagem: cópia de peça sua (2★/3★) ou a peça-chave que falta no nível de rolagem.
        evolve: (own > 0 || seek) && piece.value >= R.minValue,
        steps: steps
          .filter((s) => s.copies <= upper)
          .map((s) => ({ copies: s.copies, value: round2(s.value) })),
      };
    pieces.push(piece);
  }
  const live = pieces.filter((p) => p.sim),
    // A simulação conjunta custa por alvo: só entram os que mais rendem por cópia (o resto fica com a conta exata).
    targets = [...live]
      .sort((a, b) => b.prior - a.prior || (a.name < b.name ? -1 : 1))
      .slice(0, R.simTargets)
      .map((p) => p.sim);
  return {
    level,
    denom,
    pieces,
    live,
    /**
     * Simulação do time (uma por nível/alvos/pool; reaproveitada quando só o ouro muda). `gain`/`any` são da
     * compra de tudo o que aparecer (dos `simTargets` alvos que mais rendem por cópia); `mix` é o melhor entre isso e focar numa peça só (conta exata dela), que é o
     * que a regra de rolar usa: quem foca fecha pelo menos o que a peça sozinha fecha.
     */
    simulate: () => {
      if (!live.length) return null;
      const raw = simulate(level, denom, targets),
        mix = {
          gain: Float64Array.from(raw.gain),
          any: Float64Array.from(raw.any),
        };
      for (const p of live)
        for (let g = 0; g < mix.gain.length; g++) {
          mix.gain[g] = Math.max(mix.gain[g], p.curve[g] * p.value);
          if (p.sim.evolve) mix.any[g] = Math.max(mix.any[g], p.curve[g]);
        }
      return { ...raw, mix };
    },
    /**
     * Nomes das peças que mais rendem por cópia, para os textos de passos ("buscando X 2★ e Y 2★"). `plan`: peças do
     * plano primeiro (estabilizar a vida busca cópias e upgrades do que fica no tabuleiro final; fora do plano só
     * completa a lista); `only`: só as do plano (vazio se nenhuma evolui).
     */
    lookFor: ({ plan = false, only = false } = {}) =>
      listNames(
        live
          .filter((p) => p.sim.evolve && (!only || p.inPlan))
          .sort(
            (a, b) =>
              (plan ? Number(b.inPlan) - Number(a.inPlan) : 0) ||
              b.prior - a.prior,
          )
          .slice(0, 3)
          .map(goalText),
      ),
  };
}

/**
 * Regra única de "vale rolar agora?". Com o time simulado e o orçamento possível (ouro acima do piso), rolar vale
 * quando há pelo menos 50% de chance de evoluir alguma peça do time que valha a evolução — não só o core: uma
 * peça barata que fecha 2★ por pouco ouro conta tanto quanto o core que só fecha com 100g. A chance é a melhor
 * entre comprar tudo o que aparecer do time e focar numa peça só. O ganho esperado de força (soma do time,
 * com o core pesando mais) diz quanto rolar (economy.bestSpend) e vai no motivo, mas não decide sozinho.
 * Com a vida em perigo, rolar para estabilizar dispensa os 50%, mas exige uma chance mínima de fechar um upgrade do
 * plano (R.dangerChance) e um ganho esperado que pague o ouro (R.dangerGainPerGold por ouro); abaixo disso não rola
 * e o motivo diz qual das duas faltou (strategy.mjs troca por subir de nível ou estabilizar com itens). Sem peça viável ou
 * sem ouro acima do piso, não rola; com a peça principal bem mais provável no nível de rolagem da comp, espera.
 * Devolve o veredito (`kind`, `go`), o ouro a gastar, a peça principal, o motivo em uma linha e o ouro (`need`)
 * em que a regra passaria.
 *  - `planned`: ouro que a árvore de economia já mandou rolar (0 quando mandou guardar);
 *  - `cash`/`floor`: ouro depois da loja e piso da faixa de vida; `danger`: faixa de perigo.
 */
export function rollRule(
  team,
  sim,
  { level, cash, floor, planned = 0, danger = false, rollAt = null, idle = 0 },
) {
  const evolving = team.live.filter((p) => p.sim.evolve),
    spare = Math.max(0, cash - floor);
  if (!evolving.length) {
    // Nada a evoluir rolando: ou o que falta é inviável (sem cópias livres), ou está longe (3★ a 4+ cópias).
    const blocked = team.pieces.filter((p) => p.status === "inviavel"),
      far = team.pieces.some((p) => p.status === "longe"),
      names = listNames(
        blocked
          .slice(0, 3)
          .map((p) =>
            p.substitute
              ? `${p.name} (troque por ${p.substitute.name})`
              : p.name,
          ),
      );
    return {
      kind: blocked.length && !far ? "blocked" : "none",
      go: false,
      spend: 0,
      budget: 0,
      any: null,
      gain: null,
      main: null,
      mainChance: null,
      need: null,
      at: null,
      reason:
        blocked.length && !far
          ? `Nenhuma peça do time fecha estrela rolando: ${names}.`
          : `Nenhuma peça perto de evoluir: o que falta é 3★ distante ou peça nova${blocked.length ? `; inviável: ${names}` : ""}.`,
    };
  }
  const { gain, any } = sim.mix,
    worth = (B) => B >= GAME.shopCost && any[B] >= R.chance;
  // Menor orçamento que passa na regra, mesmo acima do que cabe agora (quanto juntar para valer rolar).
  let need = null;
  for (let B = GAME.shopCost; B <= CURVE_MAX && need == null; B++)
    if (worth(B)) need = B;
  // Peça principal: a que mais rende (chance × valor) com o orçamento; sem orçamento, a que rende mais por cópia.
  const mainAt = (B) =>
    evolving
      .map((p) => ({ p, v: B >= GAME.shopCost ? p.curve[B] * p.value : 0 }))
      .sort((a, b) => b.v - a.v || b.p.prior - a.p.prior)[0].p;
  const verdict = (kind, go, spend, budget, extra = {}) => {
    const main = mainAt(budget),
      mainChance = budget >= GAME.shopCost ? main.curve[budget] : null;
    return {
      kind,
      go,
      spend: go ? spend : 0,
      budget,
      any: budget >= GAME.shopCost ? any[budget] : null,
      gain: budget >= GAME.shopCost ? round1(gain[budget]) : null,
      main,
      mainChance,
      need,
      at: null,
      reason: "",
      ...extra,
    };
  };
  const goText = (v) =>
    `${pct(v.any)} de evoluir alguma peça com ${v.spend}g; ${goalText(v.main)} ${pct(v.mainChance)}.`;
  // Vida em perigo: chance de fechar um upgrade do PLANO (a rolagem de estabilizar busca as peças do plano). Se todas
  // as peças que evoluem são do plano, é a chance do time; se há peças fora dele, a da melhor peça do plano sozinha
  // (limite inferior: focar nela fecha pelo menos isso). Sem peça do plano evoluindo, vale a chance de 2★ do time.
  const planEvolving = evolving.filter((p) => p.inPlan),
    planChance = (B) =>
      !planEvolving.length || planEvolving.length === evolving.length
        ? any[B]
        : Math.max(...planEvolving.map((p) => p.curve[B])),
    what = planEvolving.length ? "upgrade do plano" : "2★ do time",
    dangerWorth = (B) =>
      B >= GAME.shopCost &&
      planChance(B) >= R.dangerChance &&
      gain[B] >= R.dangerGainPerGold * B;
  // 1) A árvore de economia já mandou rolar: confirma (em perigo, chance mínima de upgrade do plano e ganho que pague
  // o ouro; abaixo disso, não rola e diz por quê).
  if (planned >= GAME.shopCost) {
    const B = Math.min(planned, CURVE_MAX);
    if (danger) {
      const chance = planChance(B);
      if (dangerWorth(B)) {
        const v = verdict("danger", true, planned, B);
        v.reason = `Vida em risco: ${pct(chance)} de fechar ${what} com ${planned}g (+${v.gain} de força esperada).`;
        return v;
      }
      const v = verdict("hold", false, 0, B),
        minGain = round1(R.dangerGainPerGold * B);
      let passes = null;
      for (let b = B + 1; b <= CURVE_MAX && passes == null; b++)
        if (dangerWorth(b)) passes = b;
      v.reason = `Vida em risco, mas ${
        chance < R.dangerChance
          ? `só ${pct(chance)} de fechar ${what} com ${planned}g (mínimo ${pct(R.dangerChance)})`
          : `${planned}g renderiam só +${v.gain} de força esperada (mínimo +${minGain})`
      }${passes != null ? `; passaria com ~${passes}g` : ""}.`;
      return v;
    }
    if (worth(B)) {
      const v = verdict("go", true, planned, B);
      v.reason = goText(v);
      return v;
    }
    // Ouro parado (`idle`: acima do teto de juros, já no nível final): não rende juros nem compra nível, então o
    // excedente vai para a rolagem com a mesma régua mínima do perigo (chance de upgrade e ganho que pague o ouro),
    // sem exigir os 50% de uma rodada só. O resto continua guardado.
    const I = Math.min(planned, idle, CURVE_MAX);
    if (I >= GAME.shopCost && dangerWorth(I)) {
      const v = verdict("go", true, I, I);
      v.reason = `Ouro parado acima dos juros no nível final: ${pct(planChance(I))} de fechar ${what} com ${I}g (+${v.gain} de força esperada).`;
      return v;
    }
    return lowChance(verdict("hold", false, 0, B));
  }
  // 2) A árvore mandou guardar: rola se o ouro acima do piso já passa na regra (o menor gasto que passa).
  for (let B = GAME.shopCost; B <= Math.min(spare, CURVE_MAX); B++)
    if (worth(B)) {
      const v = verdict(
        "go",
        true,
        Math.min(spare, B + (B % 2)),
        Math.min(spare, B + (B % 2)),
        { converted: true },
      );
      v.reason = goText(v);
      return v;
    }
  // Menos que uma loja mais a cópia mais barata do time: nem dá para fechar nada com o que passa do piso.
  if (spare < GAME.shopCost + Math.min(...evolving.map((p) => p.cost))) {
    const v = verdict("hold", false, 0, 0);
    v.reason = `Ouro no piso (${floor}g): rolar derrubaria os juros.`;
    return v;
  }
  return lowChance(verdict("hold", false, 0, Math.min(spare, CURVE_MAX)));

  // Não vale: espera o nível de rolagem se a peça principal fica bem mais provável lá; senão, chance baixa.
  function lowChance(v) {
    const main = v.main,
      later =
        rollAt && level < rollAt
          ? closeCurve({
              level: rollAt,
              cost: main.cost,
              own: main.own,
              goal: main.goal,
              free: main.free,
              denom: team.denom[main.cost] ?? 0,
            })[Math.min(v.budget, CURVE_MAX)]
          : null;
    if (later != null && later >= (v.mainChance ?? 0) + R.waitMargin) {
      v.kind = "wait";
      v.at = { level: rollAt, chance: later };
      v.reason = `${goalText(main)} sobe de ${pct(v.mainChance ?? 0)} para ${pct(later)} no nível ${rollAt} (com ${v.budget}g).`;
    } else
      v.reason = `Só ${pct(v.any ?? 0)} de evoluir alguma peça com ${v.budget}g${
        need != null
          ? `; passa de 50% com ~${need}g`
          : "; difícil mesmo com muito ouro"
      }.`;
    return v;
  }
}

/** Lojas contadas no indicador "achar rolando" quando não há orçamento de rolagem (10g). */
export const FIND_DEFAULT_SHOPS = 5;
/**
 * Indicador "dá para achar rolando" de uma peça (só informação, não manda fazer nada): chance de ver pelo menos uma
 * cópia em `shops` lojas, agora e no nível seguinte. `go` (verde) quando a chance agora chega a R.chance (50%) e a peça
 * é viável; `levelUp` quando subir de nível leva a chance a esse patamar (ou a aumenta de forma relevante).
 * A pool considera as cópias em tabuleiros rivais (observado) e as estimadas nos bancos deles. Não há banco do
 * jogador (a entrada manual foi removida) nem leitura do banco de ninguém.
 */
export function findIndicator(p, shops) {
  const n = Math.max(1, shops),
    seeOne = (perShop) => (perShop == null ? null : 1 - (1 - perShop) ** n),
    now = p.status === "inviavel" ? 0 : seeOne(p.chancePerShop),
    next = seeOne(p.chancePerShopNext);
  return {
    shops: n,
    now: round2(now),
    next: next == null ? null : round2(next),
    go: p.status !== "inviavel" && now >= R.chance,
    levelUp:
      next != null &&
      p.status !== "inviavel" &&
      next >= R.chance &&
      now < R.chance,
    levelDown:
      next != null &&
      p.status !== "inviavel" &&
      now >= R.chance &&
      next < R.chance,
  };
}

/** Linha por peça do time: evoluções por ganho esperado, peças novas, 3★ distantes e, no fim, as inviáveis. */
export function rollRows(team, { budget }) {
  const at = budget >= GAME.shopCost ? Math.min(budget, CURVE_MAX) : null,
    findShops =
      at == null ? FIND_DEFAULT_SHOPS : Math.floor(at / GAME.shopCost);
  const rows = team.pieces.map((p) => {
    const chance = at == null ? null : p.curve[at];
    return {
      id: p.id,
      name: p.name,
      cost: p.cost,
      stars: p.stars,
      goalStars: p.goalStars,
      kind: p.own ? "upgrade" : "nova",
      own: p.own,
      goal: p.goal,
      need: p.need,
      items: p.items,
      carry: p.carry,
      core: p.core,
      inPlan: p.inPlan,
      onBoard: p.onBoard,
      inBench: p.inBench,
      // Livres: provável (descontado o banco estimado dos rivais; fracionário, arredondado a 0,1 só para exibir)
      // e teto observado.
      left: round1(p.free),
      upper: p.upper,
      enemy: p.enemy,
      hidden: p.hidden,
      contested: p.contested,
      chancePerSlot: p.chancePerSlot,
      chancePerShop: p.chancePerShop,
      find: findIndicator(p, findShops),
      // Chance de fechar a próxima estrela com o orçamento, dividindo ouro e pool com o resto do time.
      chance,
      gold50: p.gold50,
      gain: chance == null ? null : round2(chance * p.value),
      value: round2(p.value),
      status: p.status,
      why: p.why,
      whyText: p.why ? WHY[p.why](p) : null,
      substitute: p.substitute ?? null,
      shop: p.shop
        ? {
            slots: p.shop.slots,
            buy: p.shop.buy,
            gold: p.shop.gold,
            action: p.shop.action,
            closes: p.shop.closes,
          }
        : null,
    };
  });
  // Evoluções primeiro (o que o roll busca), depois peças novas da comp, 3★ distantes e inviáveis.
  const rank = (r) =>
    r.status === "ok"
      ? r.kind === "upgrade"
        ? 0
        : 1
      : r.status === "longe"
        ? 2
        : 3;
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.gain ?? 0) - (a.gain ?? 0) ||
      Number(b.carry) - Number(a.carry) ||
      Number(b.inPlan) - Number(a.inPlan) ||
      b.value - a.value ||
      b.chancePerShop - a.chancePerShop,
  );
  return rows;
}

/**
 * Curva para o painel: "pelo menos uma peça evolui" por ouro gasto (ou a da peça única, quando só há uma).
 * `planned` é o gasto recomendado, que a interface acende.
 */
export function rollCurve(team, sim, planned) {
  const evolving = team.live.filter((p) => p.sim.evolve);
  if (!evolving.length) return null;
  const single = evolving.length === 1 ? evolving[0] : null,
    curve = single ? single.curve : sim.mix.any;
  return {
    team: !single,
    name: single ? single.name : "Time",
    stars: single ? single.goalStars : null,
    summary: curveSummary(curve, team.level, planned),
    at: planned != null ? curve[Math.min(planned, CURVE_MAX)] : null,
  };
}
