import { clamp, cumulativeCurve, shopsFor } from "./math.js";
import { baseItem, ownersOf } from "./item-source.js";

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
const pctText = (v) => `${(v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0)}%`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Etiqueta da evolução de uma peça do time: "1→2★", ou "nova" para a peça da comp que ainda não é sua. */
export const starTag = (t) =>
  t.kind === "nova" ? "nova" : `${t.stars}→${t.goalStars}★`;

/** Tooltip de uma linha da lista de rolagem: cópias, pool, chances, motivo de inviável e substituto. */
export function targetTitle(t, budget = null) {
  const parts = [
    `${t.name} ${t.goalStars}★ · ${t.own}/${t.goal} cópias (${t.goal - t.own > 0 ? `faltam ${t.goal - t.own}` : "completa"})`,
    `${t.left}${t.upper > t.left ? `–${t.upper}` : ""} livres na pool`,
  ];
  if (t.status !== "inviavel") {
    parts.push(`${pctText(t.chancePerShop)} por loja`);
    if (t.chance != null && budget)
      parts.push(`${pctText(t.chance)} de fechar com ${budget}g`);
    if (t.gold50 != null) parts.push(`~${t.gold50}g para 50%`);
  }
  if (t.status === "longe") parts.push("3★ distante: fora da conta do time");
  if (t.enemy)
    parts.push(`${plural(t.enemy, "cópia", "cópias")} em campo de rivais`);
  if (t.hidden >= 1)
    parts.push(`~${Math.round(t.hidden)} provavelmente no banco de rivais`);
  if (t.whyText) parts.push(`inviável: ${t.whyText}`);
  if (t.substitute) parts.push(`troque por ${t.substitute.name}`);
  if (t.shop)
    parts.push(
      t.shop.buy
        ? `na loja (slot ${t.shop.slots.join(", ")}): compre ${t.shop.buy}${t.shop.closes ? ` · ${t.shop.closes}` : ""}`
        : `na loja (slot ${t.shop.slots.join(", ")}): ${t.shop.action ?? "não compre"}`,
    );
  return parts.join(" · ");
}

/**
 * Linhas que cabem no painel (que não rola): as melhores peças e, no fim, até duas inviáveis (marcadas, com o
 * substituto) para o jogador ver o que não vale perseguir. A ordem do servidor é mantida.
 */
export function pickRows(rows, max = 6) {
  const bad = rows.filter((r) => r.status === "inviavel"),
    good = rows.filter((r) => r.status !== "inviavel"),
    nGood = Math.min(good.length, max - Math.min(bad.length, 2)),
    nBad = Math.min(bad.length, max - nGood);
  return [...good.slice(0, nGood), ...bad.slice(0, nBad)];
}

/**
 * Indicador verde "dá para achar rolando" por peça (as suas e as da comp escolhida): chance de ver pelo menos uma cópia
 * nas lojas do orçamento (ou 5 lojas), agora e no nível seguinte. Só informa: o servidor não manda comprar nem rolar
 * por ele. Verde = chance de 50% ou mais; "sobe" = subir de nível leva a esse patamar; "desce" = subir de nível tira a
 * peça dele (custos baixos). Inviáveis (sem cópias, nível sem o custo) ficam de fora.
 */
export function findStrip(rows) {
  return rows
    .filter((t) => t.find && t.status !== "inviavel")
    .map((t) => ({
      id: t.id,
      name: t.name,
      cost: t.cost,
      mine: (t.own ?? 0) > 0,
      go: t.find.go,
      levelUp: t.find.levelUp,
      levelDown: t.find.levelDown,
      now: t.find.now,
      next: t.find.next,
      shops: t.find.shops,
      title: `${t.name}: ${Math.round(t.find.now * 100)}% de ver pelo menos uma cópia em ${t.find.shops} lojas${t.find.next != null ? ` · ${Math.round(t.find.next * 100)}% no nível seguinte` : ""}${t.enemy ? ` · ${t.enemy} cópia(s) em campo de rivais` : ""}${t.hidden >= 1 ? ` · ~${Math.round(t.hidden)} provavelmente no banco dos rivais (estimativa, não leitura)` : ""}${t.inBench ? " · no seu banco" : ""}`,
    }))
    .sort(
      (a, b) =>
        Number(b.go) - Number(a.go) ||
        Number(b.mine) - Number(a.mine) ||
        b.now - a.now,
    );
}

/** Selo do cabeçalho do Roll: o veredito único do servidor em poucas palavras e o tom. */
export function rollPill(ro, live) {
  const c = ro?.call;
  if (!c || !live) return { text: "", tone: "wait" };
  const map = {
    go: ["rolar", "go"],
    danger: ["estabilizar", "danger"],
    wait: [`no nível ${c.at?.level ?? ro.at}`, "wait"],
    hold: ["não rolar", "wait"],
    blocked: ["sem peça viável", "wait"],
    none: ["nada a evoluir", "wait"],
    unknown: ["ouro ?", "wait"],
  };
  const [text, tone] = map[c.kind] ?? ["", "wait"];
  return { text, tone };
}

export const GOLD_PER_SHOP = 2;
export const INTEREST_STEP = 10;
export const INTEREST_CAP = 50;

/** Score do plano exibido: o do ranking de comps (traz "melhor comp" e o nível usado) ou, sem ele, o do próprio plano. */
function scoreOfPlan(plan, rec, level) {
  const ranked = plan.meta?.id
      ? (rec?.compRanking ?? []).find((r) => r.id === plan.meta.id)
      : null,
    own = plan.compScore ?? null,
    score = num(ranked?.score) ?? num(own?.score);
  if (score === null) return null;
  return {
    value: Math.round(score),
    chance: num(ranked?.chance) ?? num(own?.chance),
    chancePlan: num(ranked?.chancePlan) ?? num(own?.chancePlan),
    best: ranked?.best === true,
    level: num(ranked?.level) ?? level,
  };
}

const GEP_REASONS = {
  "banco-ausente": "banco do TFTAcademy não encontrado",
  "sem-partida": "o TFTAcademy ainda não gravou partida",
  "fora-de-partida": "fora de partida",
  "outra-partida": "banco é de outra partida",
  "partida-encerrada": "partida encerrada no TFTAcademy",
  "set-diferente": "set diferente do catálogo",
  "sem-eventos-recentes": "sem eventos recentes (Overwolf/TFTAcademy parados?)",
  "banco-travado": "banco travado",
};
/** Texto curto do estado da fonte GEP (`gepStatus` do servidor); null se o servidor não informa. */
export function gepNote(g) {
  if (!g || typeof g.state !== "string") return null;
  const age = num(g.lastEventAgeMs),
    why = GEP_REASONS[g.reason] ?? g.reason ?? "";
  const label =
    g.state === "ativo"
      ? `GEP ativo${age !== null ? ` · último evento há ${Math.round(age / 1000)}s` : ""}`
      : g.state === "obsoleto"
        ? `GEP obsoleto: ${why}${age !== null ? ` (${Math.round(age / 1000)}s)` : ""}; usando a leitura de tela`
        : g.state === "esquema-desconhecido"
          ? `GEP: esquema do banco desconhecido${g.detail ? ` (${g.detail})` : ""}; usando a leitura de tela`
          : `GEP ausente${why ? `: ${why}` : ""}; usando a leitura de tela`;
  // Texto curto do chip visível no HUD: ativo mostra a idade do último evento; os demais dizem que caiu para a tela.
  const short =
    g.state === "ativo"
      ? `GEP ativo${age !== null ? ` · ${Math.round(age / 1000)}s` : ""}`
      : g.state === "obsoleto"
        ? "GEP parado"
        : g.state === "esquema-desconhecido"
          ? "GEP ?"
          : "GEP off";
  return { state: g.state, label, short };
}

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
    // Nível: lido do HUD ("tela"), piso derivado do XP passivo ("derivado": o real é este ou maior) ou, só se nada disso
    // existir, o número de peças em campo ("estimado", nunca uma leitura). O servidor já entrega o lido/derivado em screen.level.
    level:
      num(screen.level) ?? num(state?.estimatedLevel) ?? num(rec?.currentLevel),
    levelSource:
      num(screen.level) === null
        ? "estimado"
        : screen.sources?.level === "derived"
          ? "derivado"
          : "tela",
    // Leitura velha (HUD coberto há mais de 15 s) ou número e XP em conflito: vale, mas a interface avisa.
    levelStale:
      screen.stale?.level === true || screen.levelInfo?.conflict === true,
    // Nível que a análise usou (pode estar uma leitura atrás do mostrado até a próxima análise).
    levelUsed: num(rec?.currentLevel),
    xp: parseXp(screen.xp),
    gold: num(screen.gold),
    // Origem GEP (banco do TFTAcademy, observada): a interface só avisa de leve no tooltip.
    levelFrom: screen.sources?.level === "gep" ? "gep" : null,
    goldFrom: screen.sources?.gold === "gep" ? "gep" : null,
    // Ouro mantido da última leitura (HUD coberto há mais de 15 s): a interface o mostra esmaecido.
    goldStale: screen.stale?.gold === true,
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
    swaps: rec?.goal?.found ? (rec.goal.swaps ?? []) : (rec?.autoSwaps ?? []),
    lastMatch: match?.last ?? null,
    ageSeconds: num(rec?.metadata?.ageSeconds),
    sameGame: rec?.metadata?.sameGame ?? null,
    gameId: rec?.metadata?.gameId ?? null,
    // Estado da fonte GEP (ativo, obsoleto, ausente, esquema-desconhecido) para o tooltip do indicador ao vivo.
    gep: gepNote(state?.gepStatus),
    // Erro aparece mesmo com o leitor parado (spawn falhou ou processo morreu).
    reader:
      screen.error ??
      (screen.running && screen.window === false
        ? "janela do jogo oculta"
        : null),
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
  // Build recomendada de cada peça (clique na Formação): equipados e os itens ideais com receita.
  const builds = new Map((plan.itemPlans ?? []).map((b) => [b.championId, b]));
  // Itens que o jogador já tem em qualquer peça (campo e reserva): "falta" só o que não existe em lugar nenhum.
  const owners = ownersOf(
    [
      ...(rec.self?.units ?? []).map((u) => ({ ...u, zone: "board" })),
      ...(rec.self?.reserve ?? []).map((u) => ({ ...u, zone: "reserve" })),
    ],
    goalIds,
    (id) => (builds.get(id)?.ideal ?? []).slice(0, 3).map((i) => i.id),
  );
  for (const c of cells) {
    const b = builds.get(c.id);
    c.build = b
      ? {
          equipped: b.equipped ?? [],
          ideal: b.ideal ?? [],
          slotsFree: b.slotsFree ?? 0,
          owners,
          // "Passar itens" do servidor que terminam nesta peça: de quem sai o item escolhido.
          moves: (plan.itemMoves ?? []).flatMap((m) =>
            (m.moves ?? [])
              .filter((x) => x.to?.id === c.id)
              .map((x) => ({ itemId: baseItem(x.item.id), fromId: m.from.id })),
          ),
        }
      : null;
  }

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
        // Banco lido da tela: a interface só o usa para mostrar os componentes quando o servidor não disse o que falta.
        bank: Array.isArray(screen.items) ? screen.items : null,
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
      championId: c.uses?.[0]?.championId ?? null,
      target: c.uses?.[0]?.itemId
        ? { id: c.uses[0].itemId, name: c.uses[0].item }
        : null,
      completes: c.uses?.[0]?.completesNow === true,
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
    // Uma linha por peça do time (campo, banco e comp): a próxima estrela, as cópias e a chance de fechar.
    const budget = ro?.call?.budget ?? null;
    const targets = (ro?.targets ?? []).map((t) => ({
      ...t,
      k: Math.max(0, (t.goal ?? 3) - (t.own ?? 0)),
      tag: starTag(t),
      title: targetTitle(t, budget),
      // Pips só até 3 cópias; para o 3★ (9) a fração cabe melhor.
      pips: (t.goal ?? 3) <= 3,
    }));
    const shown = pickRows(targets);
    panel = {
      // Só o título da aba usa a ação; o painel não a desenha mais.
      action: live ? sx.action : null,
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
        // Veredito único do servidor (vale rolar? por quê?) e o que ele diz do orçamento.
        call: ro.call ?? null,
        pill: rollPill(ro, live),
        // Rolar derruba o patamar de juros: a única nota de ouro que entra no painel.
        interest: live && ro.go ? (ro.interest ?? null) : null,
        // Peças do time na loja agora (o servidor já descontou o que manda comprar).
        shop: ro.shop ?? [],
        targets: shown,
        // Indicador "dá para achar rolando" de TODAS as peças (as suas e as da comp), só informativo.
        finds: findStrip(targets),
        // Peças do time que ficaram fora da lista (o painel não rola) e quantas são inviáveis.
        more: Math.max(0, (ro.total ?? targets.length) - shown.length),
        blocked: targets.filter((t) => t.status === "inviavel").length,
        curve: ro.curve
          ? buildCurve(
              {
                name: ro.curve.name,
                goalStars: ro.curve.stars,
                team: ro.curve.team,
                need: 1,
                own: 0,
                curve: ro.curve.summary,
                chanceInRoll: ro.curve.at,
              },
              live && ro.go ? ro.spend : null,
            )
          : null,
      },
      // Piso e juros que o medidor de ouro do HUD desenha.
      economy: eco && {
        keep: eco.keep ?? null,
        interest: eco.interest ?? null,
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
      // Código do planejador do jogo (importar equipe); null quando algum campeão não tem ID de importação.
      teamCode: plan.teamCode?.code ?? null,
      teamCodeError: plan.teamCode?.error ?? null,
      compId: plan.meta?.id ?? null,
      carry: plan.carry,
      carryId: carryUnit?.id ?? null,
      // Score 0-100 e chance de montar no seu nível (motor, comp-score.mjs); no lugar do tier S/A/B/C. `best` = maior score.
      score: scoreOfPlan(plan, rec, hero.level),
      level: stage?.level ?? hero.level,
      cells,
      dock,
      traits: (plan.traits ?? []).map((t) => ({
        name: t.name,
        count: t.count,
        emblem: t.emblem ?? 0,
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
        // Mesmo filtro da etapa "Segure": inclui as trocas bloqueadas.
        hold: dock.filter((d) => d.kind === "hold" || d.kind === "blocked")
          .length,
      },
      panel,
    },
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
    // Curva do time ("pelo menos uma peça evolui"), não de uma peça só.
    team: !!target.team,
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
