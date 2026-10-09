import { clamp, cumulativeCurve, shopsFor } from "./math.js";

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
  const plan = rec?.recommendations?.[0] ?? null,
    screen = state?.screen ?? {},
    hp = num(rec?.self?.health),
    live = rec?.metadata?.actionable === true && (hp ?? 0) > 0;
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
    ended: hp !== null && hp <= 0,
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
      level: lv && { ...lv, nodes, go: live && lv.go },
      roll: ro && {
        go: live && ro.go,
        spend: ro.spend,
        shops: ro.shops,
        keep: ro.keep,
        at: ro.at,
        level: ro.level,
        targets,
        curve: buildCurve(
          targets.find((t) => !t.done && t.chancePerShop > 0),
          live && ro.go ? ro.shops : null,
        ),
      },
      economy: eco && {
        gold: eco.gold,
        interest: eco.interest,
        next: eco.next,
        keep: eco.keep,
        saving: live && sx.action === "ECONOMIZAR",
      },
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
      steps,
      counts: {
        ready: dock.filter((d) => d.kind === "ready").length,
        hold: dock.filter((d) => d.kind === "hold").length,
      },
      panel,
    },
  };
}

/** Curva acumulada P(≥k cópias) por número de lojas, com quantis e marcador do plano. */
export function buildCurve(target, plannedShops) {
  if (!target) return null;
  const k = Math.max(1, target.need - target.own),
    p = clamp(target.chancePerShop);
  const n95 = shopsFor(k, p, 0.95),
    maxN = Math.round(clamp(Number.isFinite(n95) ? n95 + 2 : 40, 8, 40));
  const points = cumulativeCurve(k, p, maxN);
  const planned = plannedShops != null ? Math.min(maxN, plannedShops) : null;
  return {
    name: target.name,
    stars: target.goalStars,
    k,
    p,
    maxN,
    points,
    q50: shopsFor(k, p, 0.5),
    q80: shopsFor(k, p, 0.8),
    planned,
    plannedValue: planned != null ? (points[planned]?.v ?? null) : null,
  };
}
