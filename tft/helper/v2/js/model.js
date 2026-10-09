import { clamp, cumulativeCurve, shopsFor } from "./math.js";
// Mesmas contas de renda do servidor (módulo puro, servido em /economy.mjs).
import { incomeOf, interestOf, projectGold } from "../../economy.mjs";

/**
 * Modelo de visão: função pura que converte o estado lido (/api/state) e a análise
 * (/api/recommend) nos números e listas que a interface desenha. Não decide nada de
 * jogo; apenas reorganiza e deriva valores de apresentação.
 */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const parseXp = (xp) => {
  const m = /^(\d+)\/(\d+)$/.exec(xp ?? "");
  return m ? { have: Number(m[1]), total: Number(m[2]) } : null;
};
const parseStage = (s) => {
  const m = /^(\d)-(\d)$/.exec(s ?? "");
  return m ? { stage: Number(m[1]), round: Number(m[2]) } : null;
};
export const GOLD_PER_SHOP = 2;
export const INTEREST_STEP = 10;
export const INTEREST_CAP = 50;

export function buildModel({ state, rec }) {
  // Comp fixada na tela de seleção (preview) tem prioridade sobre a primeira sugestão.
  const plan = rec?.preview ?? rec?.recommendations?.[0] ?? null,
    screen = state?.screen ?? {},
    hp = num(rec?.self?.health),
    // Partida acompanhada pelo servidor. Em andamento, vida ≤ 0 não encerra: o primeiro tabuleiro de cada
    // partida traz -1 em todos. Sem partida acompanhada, a vida do Hero decide.
    match = state?.match ?? null,
    waiting = match?.status === "live" && match.boardReady === false,
    ended =
      match?.status === "ended" ||
      (match?.status !== "live" && hp !== null && hp <= 0),
    live =
      !waiting && !ended && rec?.metadata?.actionable === true && (hp ?? 0) > 0;
  const hero = {
    hp,
    level:
      num(screen.level) ?? num(state?.estimatedLevel) ?? num(rec?.currentLevel),
    levelSource: screen.level != null ? "tela" : "estimado",
    xp: parseXp(screen.xp),
    gold: num(screen.gold),
    stage: parseStage(screen.stage),
    phase: rec?.metadata?.phase ?? null,
  };
  const status = {
    live,
    ended,
    waiting,
    // Servidor aberto depois da partida: a colocação vem do registro dela no histórico.
    placement:
      num(match?.placement) ??
      (match?.last &&
      String(match.last.gameId) === String(rec?.metadata?.gameId)
        ? num(match.last.placement)
        : null),
    awaitingFinal: match?.status === "ended" && match.placement == null,
    // Comp fixada pela tela de seleção e aceita pelo servidor (o plano exibido é ela).
    pinned: rec?.goal?.found === true && !!rec?.preview,
    // Substituições aceitas pelo servidor sobre a comp fixada.
    swaps: rec?.goal?.found ? (rec.goal.swaps ?? []) : [],
    lastMatch: match?.last ?? null,
    ageSeconds: num(rec?.metadata?.ageSeconds),
    sameGame: rec?.metadata?.sameGame ?? null,
    gameId: rec?.metadata?.gameId ?? null,
    reader: screen.running
      ? screen.window === false
        ? "janela do jogo oculta"
        : (screen.error ?? null)
      : null,
  };
  if (!plan) return { hero, status, plan: null };

  const goalIds = new Set(plan.board.map((u) => u.id)),
    byId = new Map(plan.board.map((u) => [u.id, u])),
    carryUnit = plan.board.find((u) => u.name === plan.carry) ?? null,
    current = rec.currentPlan?.board ?? [],
    owned = new Set(current.map((u) => u.id)),
    transitions = plan.transitions ?? [];

  const cells = (plan.positions ?? []).map((p) => {
    const u = byId.get(p.championId);
    return {
      id: p.championId,
      name: p.name,
      row: p.row,
      col: p.col,
      cost: u?.cost ?? 1,
      stars: u?.currentStars ?? 0,
      targetStars: p.targetStars ?? 0,
      items: u?.items?.length ?? 0,
      carry: p.championId === carryUnit?.id,
      role: p.role,
      reason: p.reason,
      status: u?.owned ? "owned" : u?.inReserve ? "reserve" : "incoming",
    };
  });

  const dock = transitions.map((t) => {
    const need = t.requiredStars ? 3 ** (t.requiredStars - 1) : 0;
    return {
      key: `${t.exit?.id ?? "vaga"}>${t.enter.id}`,
      exit: t.exit ?? null,
      exitStars: t.exitStars ?? 0,
      enter: t.enter,
      enterStars: t.enterStars ?? 0,
      kind: !t.exit ? "slot" : t.ready ? "ready" : need ? "hold" : "blocked",
      held: t.exit?.items?.length ?? 0,
      have: Math.min(t.enterCopies ?? 0, need),
      need,
      fromReserve: t.source === "reserve",
      reason: t.reason ?? "",
    };
  });

  for (const c of cells) c.swap = dock.find((d) => d.enter.id === c.id) ?? null;

  const stage = plan.stage ?? null,
    stageBoard = stage?.board ?? [];
  const canAct = live;
  const steps = [];
  // group: "now" = decisões de campo/loja (coluna da direita); "items" = itens (sob a formação).
  const GROUP = {
    swap: "now",
    buy: "now",
    slot: "now",
    hold: "now",
    shop: "now",
    equip: "items",
    moves: "items",
    next: "items",
    carousel: "items",
  };
  const add = (id, title, tone, rows) =>
    rows.length && steps.push({ id, title, tone, group: GROUP[id], rows });
  add(
    "swap",
    "Trocar",
    "go",
    dock.filter((d) => d.kind === "ready").map((d) => ({ ...d, kind: "swap" })),
  );
  add("equip", "Equipar", "go", [
    ...stageBoard
      .filter((u) => u.equipNow?.length)
      .map((u) => ({
        key: `equip:${u.id}`,
        kind: "equip",
        unit: u,
        items: u.equipNow,
        inField: owned.has(u.id),
      })),
    ...(stage?.bankItems ?? []).map((i, n) => ({
      key: `bank:${i.id}:${n}`,
      kind: "bank",
      item: i,
      to: i.to,
      reason: i.reason,
      inField: i.to ? owned.has(i.to.id) : false,
    })),
  ]);
  add(
    "buy",
    "Comprar",
    "amber",
    (stage?.buyNow ?? []).map((u) => ({
      key: `buy:${u.id}`,
      kind: "buy",
      unit: u,
      how: u.replaces ? "replace" : u.slot === "banco" ? "bank" : "slot",
      replaces: u.replaces,
      chance: u.chancePerShop ?? 0,
      broke: u.affordable === false,
    })),
  );
  add(
    "slot",
    "Vaga livre",
    "blue",
    dock.filter((d) => d.kind === "slot").map((d) => ({ ...d, kind: "slot" })),
  );
  add(
    "hold",
    "Segure",
    "amber",
    dock
      .filter((d) => d.kind === "hold" || d.kind === "blocked")
      .map((d) => ({ ...d, kind: "hold" })),
  );
  add(
    "moves",
    "Passar itens",
    "violet",
    (plan.itemMoves ?? []).map((m) => ({
      key: `move:${m.from.id}`,
      kind: "moves",
      from: m.from,
      moves: m.moves ?? [],
      now: m.now && canAct,
      method: m.method,
    })),
  );
  add(
    "next",
    "Próximo item",
    "blue",
    stageBoard
      .filter((u) => !u.equipNow?.length && u.slotsFree > 0 && u.nextItem)
      .map((u) => ({
        key: `next:${u.id}`,
        kind: "next",
        unit: u,
        item: u.nextItem,
      })),
  );
  add(
    "shop",
    "Loja",
    "amber",
    (stage?.shop ?? []).map((u) => ({
      key: `shop:${u.slot}:${u.id}`,
      kind: "shop",
      unit: u,
      action: u.action,
      reason: u.reason,
    })),
  );
  add(
    "carousel",
    "Carrossel",
    "gold",
    (plan.carousel ?? []).map((c) => ({
      key: `car:${c.id}`,
      kind: "carousel",
      item: c,
      rank: c.rank,
      champion: c.uses?.[0]?.champion ?? "",
      reason: c.uses?.[0]?.reason ?? "",
    })),
  );

  /* ----- Painel de decisão ----- */
  const sx = plan.strategy,
    P = sx?.panels ?? {};
  let panel = null;
  if (sx) {
    const lv = P.leveling,
      ro = P.rolling,
      eco = P.economy;
    const from = Math.min(5, lv?.level ?? hero.level ?? 5),
      to = Math.max(10, lv?.finalLevel ?? 10, (lv?.level ?? 0) + 1);
    const nodes = [];
    for (let n = from; n <= to; n++)
      nodes.push({
        n,
        state: n < lv?.level ? "past" : n === lv?.level ? "now" : "future",
        roll: n === ro?.at,
        final: n === lv?.finalLevel,
        next: live && lv?.go && n === lv.level + 1,
      });
    const targets = (ro?.targets ?? []).map((t) => ({
      ...t,
      need: t.goal ?? 3,
      k: Math.max(0, (t.goal ?? 3) - (t.own ?? 0)),
    }));
    panel = {
      action: live ? sx.action : null,
      tone: live ? sx.action.toLowerCase().replace(/[^a-z]/g, "") : "planning",
      headline: sx.headline,
      style: sx.style,
      tier: plan.meta?.tier ?? null,
      comp: plan.title,
      carry: plan.carry,
      steps: sx.steps ?? [],
      reasons: sx.reasons ?? [],
      level: lv && {
        ...lv,
        nodes,
        go: live && lv.go,
        passive: live && !!lv.passive,
      },
      roll: ro && {
        go: live && ro.go,
        spend: ro.spend,
        shops: ro.shops,
        keep: ro.keep,
        at: ro.at,
        level: ro.level,
        // Teto permitido pelo piso e ponto onde a curva de ganho manda parar (quando antes do teto).
        max: live && ro.go ? (ro.max ?? null) : null,
        stop: live && ro.go ? (ro.stop ?? null) : null,
        targets,
        curve: buildCurve(
          targets.find((t) => !t.done && (t.curve || t.chancePerShop > 0)),
          live && ro.go ? ro.spend : null,
        ),
      },
      economy: eco && buildEconomy(eco, live, sx.action, hero.stage),
      odds: rec.odds ?? [],
      carryCost: carryUnit?.cost ?? null,
    };
  }

  const progress = stage?.goalProgress ?? { onBoard: 0, goal: goalIds.size };
  return {
    hero,
    status,
    plan: {
      title: plan.title,
      compId: plan.meta?.id ?? null,
      carry: plan.carry,
      carryId: carryUnit?.id ?? null,
      tier: plan.meta?.tier ?? null,
      level: stage?.level ?? hero.level,
      cells,
      dock,
      traits: (plan.traits ?? []).map((t) => ({
        name: t.name,
        count: t.count,
        next: t.next ?? null,
        active: !!t.active,
      })),
      progress: { have: progress.onBoard, total: progress.goal },
      // Peças da comp que valem trocar (ou que estão sob pressão sem substituto bom), com a sugestão escolhida.
      subs: (plan.flex ?? [])
        .filter((f) => f.suggest || f.contested || f.unreachable)
        .map((f) => ({
          ...f,
          pick: f.options.find((o) => o.id === f.suggest) ?? null,
        })),
      steps,
      counts: {
        ready: dock.filter((d) => d.kind === "ready").length,
        hold: dock.filter((d) => d.kind === "hold").length,
      },
      panel,
    },
  };
}

/**
 * Fluxo do ouro: agora → depois da ação → próximas rodadas, com a renda decomposta e a sequência.
 * Ao vivo usa o "depois" e a projeção do servidor; fora do ao vivo não há ação, então projeta a partir
 * do ouro atual com as mesmas contas (economy.mjs). `top` é o teto do gráfico, em degraus de 10g.
 */
export function buildEconomy(eco, live, action, stage = null) {
  const gold = eco.gold,
    after = live ? (eco.after ?? gold) : gold,
    streak = eco.streak ?? null;
  const source = live
    ? (eco.projection ?? [])
    : projectGold(gold, { stage, streak, rounds: 4 });
  const reach =
    after == null || after >= INTEREST_CAP
      ? null
      : (source.find((r) => r.gold >= INTEREST_CAP)?.label ?? null);
  const projection = source.map((r) => ({
    label: r.label,
    gold: r.gold,
    income: r.income,
    capped: r.gold >= INTEREST_CAP,
    reach: r.label === reach,
  }));
  const income =
    after == null
      ? null
      : live
        ? (eco.income ?? incomeOf(after, streak))
        : incomeOf(after, streak);
  const peak = Math.max(
    INTEREST_CAP + INTEREST_STEP,
    gold ?? 0,
    ...projection.map((r) => r.gold),
  );
  return {
    gold,
    after,
    spend: gold != null && after != null ? Math.max(0, gold - after) : 0,
    shopSpend: live ? (eco.shopSpend ?? 0) : 0,
    interest: eco.interest,
    afterInterest: interestOf(after),
    next: eco.next,
    keep: eco.keep,
    income,
    // Partes da renda da próxima rodada, na ordem em que aparecem na barra.
    incomeParts: income
      ? [
          { kind: "base", label: "base", value: income.base },
          { kind: "interest", label: "juros", value: income.interest },
          {
            kind: streak?.kind === "win" ? "win" : "loss",
            label: "sequência",
            value: income.streak,
          },
        ].filter((p) => p.value > 0)
      : [],
    projection,
    reach50: reach,
    top: Math.ceil(peak / INTEREST_STEP) * INTEREST_STEP,
    streak: streak?.length >= 2 ? streak : null,
    sellable: eco.sellable?.gold ? eco.sellable : null,
    saving: live && action === "ECONOMIZAR",
  };
}

/**
 * Curva acumulada de fechar o upgrade em função do ouro gasto: P(≥k cópias) com lojas e cópias pagas.
 * Usa a curva exata do servidor (Markov com a pool encolhendo); sem ela, cai para a binomial por loja,
 * que não desconta o preço das cópias. `points` é [{ g: ouro, v: chance }].
 */
export function buildCurve(target, plannedGold) {
  if (!target) return null;
  const k = Math.max(1, target.need - target.own),
    server = target.curve?.p?.length ? target.curve : null,
    p = clamp(target.chancePerShop ?? 0);
  let points, q50, q80;
  if (server) {
    points = server.p.map((v, i) => ({ g: i * server.step, v }));
    q50 = server.q50;
    q80 = server.q80;
  } else {
    const n95 = shopsFor(k, p, 0.95),
      maxN = Math.round(clamp(Number.isFinite(n95) ? n95 + 2 : 40, 8, 40));
    points = cumulativeCurve(k, p, maxN).map(({ n, v }) => ({
      g: n * GOLD_PER_SHOP,
      v,
    }));
    const gold = (n) => (Number.isFinite(n) ? n * GOLD_PER_SHOP : null);
    q50 = gold(shopsFor(k, p, 0.5));
    q80 = gold(shopsFor(k, p, 0.8));
  }
  const maxG = points.at(-1).g,
    step = points[1]?.g ?? GOLD_PER_SHOP;
  const planned = plannedGold != null ? Math.min(maxG, plannedGold) : null;
  return {
    name: target.name,
    stars: target.goalStars,
    k,
    p,
    level: server?.level ?? null,
    exact: !!server,
    maxG,
    points,
    q50,
    q80,
    planned,
    plannedValue:
      planned == null
        ? null
        : (target.chanceInRoll ??
          points[Math.floor(planned / step)]?.v ??
          null),
  };
}
