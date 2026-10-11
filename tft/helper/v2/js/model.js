import { clamp, cumulativeCurve, shopsFor } from "./math.js";
import {
  championItemsView,
  formationBuilds,
} from "../../core/items/scenarios.mjs";
import { copyBuys } from "../../core/pool/buy-copies.mjs";
import { starCopies } from "../../core/pool/copies.mjs";
import { SHOP } from "../../core/pool/tables.mjs";
import { crossShop, refineShopHits, shopView } from "./shop-match.js";
import { compOwnership, ownership, rosterOf } from "./roster.js";

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

// Ouro por loja (rolar) e os juros: regra do jogo em core (SHOP.cost, core/economy/gold.mjs); o cliente não tem cópia (M5b).

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
    // Colocação esperada (a medida única do motor: o score é ela numa régua) e o top 4 da mesma conta.
    expected: num(ranked?.expected) ?? num(own?.expected),
    top4: num(ranked?.top4) ?? num(own?.top4),
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
  "gravacao-desligada": "gravação de partidas desligada no TFTAcademy",
};
/** Instrução quando o TFTAcademy não grava os eventos (configuração `record_games` desligada). */
const GEP_RECORD_HINT =
  'Ligue "gravar partidas" nas configurações do TFTAcademy para o helper receber os eventos do jogo.';
/** Campos do jogador que só o GEP entrega, com o nome mostrado ao usuário (na ordem do aviso). */
const PLAYER_FIELDS = [
  ["gold", "ouro"],
  ["level", "nível"],
  ["xp", "XP"],
  ["shop", "loja"],
  ["items", "itens"],
  ["augments", "aprimoramentos"],
];
/** Dica quando falta algum campo do jogador e a fonte GEP não está ativa (sem a instrução de gravação). */
const GEP_OPEN_HINT =
  "Abra o Overwolf com o TFTAcademy (gravação de partidas ligada) para o helper receber esses dados.";
/**
 * Texto curto do estado da fonte GEP (`gepStatus` do servidor); null se o servidor não informa. `noSource` (opcional) é o
 * `seen.noSource` do servidor (motivo de cada campo do jogador sem valor): com o GEP fora, o chip e a dica dizem quais
 * campos estão sem fonte (`missing`), em vez de só "GEP off". Nada é lido de outro lugar: sem GEP, ficam desconhecidos.
 */
export function gepNote(g, noSource = null) {
  if (!g || typeof g.state !== "string") return null;
  const age = num(g.lastEventAgeMs),
    why = GEP_REASONS[g.reason] ?? g.reason ?? "",
    // Gravação desligada: o TFTAcademy não grava (e apaga a partida no fim); vale a instrução mesmo fora de partida.
    hint =
      g.recordGames === false && g.state !== "ativo" ? GEP_RECORD_HINT : null;
  const base =
    g.state === "ativo"
      ? `GEP ativo${age !== null ? ` · último evento há ${Math.round(age / 1000)}s` : ""}`
      : g.state === "obsoleto"
        ? `GEP obsoleto: ${why}${age !== null ? ` (${Math.round(age / 1000)}s)` : ""}`
        : g.state === "esquema-desconhecido"
          ? `GEP: esquema do banco desconhecido${g.detail ? ` (${g.detail})` : ""}`
          : `GEP ausente${why ? `: ${why}` : ""}`;
  // Sem GEP, os campos do jogador ficam sem fonte: quais estão sem valor agora (só quando o servidor informa os motivos).
  const missing =
      noSource && typeof noSource === "object" && g.state !== "ativo"
        ? PLAYER_FIELDS.filter(([key]) => noSource[key] != null).map(
            ([, name]) => name,
          )
        : null,
    missingNote = missing?.length ? `. Sem fonte: ${missing.join(", ")}` : "";
  const label = hint
    ? `${base}${missingNote}. ${hint}`
    : missing?.length
      ? `${base}${missingNote}. ${GEP_OPEN_HINT}`
      : base;
  // Texto curto do chip visível no HUD: ativo mostra a idade do último evento; os demais dizem que a fonte caiu.
  const short =
    g.state === "ativo"
      ? `GEP ativo${age !== null ? ` · ${Math.round(age / 1000)}s` : ""}`
      : g.reason === "gravacao-desligada"
        ? "GEP off · ligar gravação"
        : g.state === "obsoleto"
          ? "GEP parado"
          : g.state === "esquema-desconhecido"
            ? "GEP ?"
            : "GEP off";
  // O sufixo " · sem fonte" vale quando falta algum campo; a instrução de gravação (mais urgente) fica sozinha.
  const chip = missing?.length && !hint ? `${short} · sem fonte` : short;
  return {
    state: g.state,
    label,
    short: chip,
    ...(hint ? { hint } : {}),
    ...(missing ? { missing } : {}),
  };
}

/**
 * `review` (opcional): `{ gameId, at, placement }` quando a tela revê o Ao vivo congelado de uma partida encerrada
 * (`state` e `rec` são os corpos guardados no último momento em que ela estava em andamento). Revisão é só leitura do que
 * foi guardado: nada vale como "agora" (sem loja, compra, rolagem nem ação urgente) e `status.review` diz o que se revê.
 */
export function buildModel({ state, rec }, { review = null } = {}) {
  // Comp fixada na tela de seleção (preview) tem prioridade sobre a primeira sugestão.
  const plan = rec?.preview ?? rec?.recommendations?.[0] ?? null,
    seen = state?.seen ?? {},
    hp = num(rec?.self?.health),
    // Partida acompanhada pelo servidor. Em andamento, vida ≤ 0 não encerra: o primeiro tabuleiro de cada
    // partida traz -1 em todos. Sem partida acompanhada, a vida do Hero decide.
    match = state?.match ?? null,
    // Partida de treino (sem rivais): não tem vida a perder nem colocação; o servidor a detecta (core/state/practice.mjs).
    practice = match?.practice === true || state?.practice?.active === true,
    waiting = !review && match?.status === "live" && match.boardReady === false,
    ended =
      !review &&
      (match?.status === "ended" ||
        (match?.status !== "live" && !practice && hp !== null && hp <= 0)),
    live =
      !review &&
      !waiting &&
      !ended &&
      rec?.metadata?.actionable === true &&
      (practice || (hp ?? 0) > 0);
  const hero = {
    // Treino: a vida do arquivo (-99 ou 1) não é vida; fica desconhecida em vez de uma barra enganosa.
    hp: practice ? null : hp,
    // Nível: observado pelo jogo ("lido", hoje pelo GEP), piso derivado do XP passivo ("derivado": o real é este ou maior) ou,
    // só se nada disso existir, o número de peças em campo ("estimado", nunca uma leitura). O servidor já entrega o lido/derivado.
    level:
      num(seen.level) ?? num(state?.estimatedLevel) ?? num(rec?.currentLevel),
    levelSource:
      num(seen.level) === null
        ? "estimado"
        : seen.sources?.level === "derived"
          ? "derivado"
          : "lido",
    // Nível que a análise usou (pode estar uma leitura atrás do mostrado até a próxima análise).
    levelUsed: num(rec?.currentLevel),
    xp: parseXp(seen.xp),
    gold: num(seen.gold),
    // Origem GEP (banco do TFTAcademy, observada): a interface só avisa de leve no tooltip.
    levelFrom: seen.sources?.level === "gep" ? "gep" : null,
    goldFrom: seen.sources?.gold === "gep" ? "gep" : null,
    stage: parseStage(seen.stage),
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
    awaitingFinal:
      match?.status === "ended" && match.placement == null && !practice,
    // Partida de treino: chip "modo treino" na interface e no overlay; nunca "Partida encerrada" com o jogo rodando.
    practice,
    // Revisão do Ao vivo congelado de uma partida encerrada (ver o comentário de `buildModel`).
    review,
    // Comp fixada pela tela de seleção e aceita pelo servidor (o plano exibido é ela).
    pinned: rec?.goal?.found === true && !!rec?.preview,
    // Substituições aceitas pelo servidor sobre a comp fixada.
    swaps: rec?.goal?.found ? (rec.goal.swaps ?? []) : (rec?.autoSwaps ?? []),
    lastMatch: match?.last ?? null,
    ageSeconds: num(rec?.metadata?.ageSeconds),
    sameGame: rec?.metadata?.sameGame ?? null,
    gameId: rec?.metadata?.gameId ?? null,
    // Estado da fonte GEP (ativo, obsoleto, ausente, esquema-desconhecido) para o tooltip do indicador ao vivo.
    // Na revisão a fonte é a de quando a partida acabou, não a de agora: sem chip nem aviso dela.
    gep: review ? null : gepNote(state?.gepStatus, seen.noSource ?? null),
  };
  if (!plan) return { hero, status, plan: null };

  const goalIds = new Set(plan.board.map((u) => u.id)),
    byId = new Map(plan.board.map((u) => [u.id, u])),
    carryUnit = plan.board.find((u) => u.name === plan.carry) ?? null,
    current = rec.currentPlan?.board ?? [],
    owned = new Set(current.map((u) => u.id)),
    transitions = plan.transitions ?? [],
    // Suas peças em campo (rec.self.units) e na reserva (GEP, state.screen.gepBench): regra única de roster.js, a mesma
    // dos cartões da aba Comps e do modal. Sem GEP a reserva é desconhecida (não vazia).
    roster = rosterOf({ units: rec.self?.units, screen });

  const cells = (plan.positions ?? []).map((p) => {
    const u = byId.get(p.championId),
      own = ownership(roster, p.championId);
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
      // A leitura de agora (roster) decide; sem ela (fora de campo e reserva não lida), vale a análise. O `owned` do
      // servidor inclui a reserva, então `inReserve` é olhado antes dele.
      status:
        own.state === "field" || own.state === "both"
          ? "owned"
          : own.state === "reserve"
            ? "reserve"
            : own.state === "absent"
              ? "incoming"
              : u?.inReserve
                ? "reserve"
                : u?.owned
                  ? "owned"
                  : "incoming",
      // Onde está a peça e quantas cópias (dica e rótulo da Formação: "2 cópias: 1 em campo, 1 na reserva").
      own: own.mine ? own.label : "",
    };
  });

  const dock = transitions.map((t) => {
    const need = t.requiredStars ? starCopies(t.requiredStars) : 0;
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
  // Build recomendada de cada peça (clique na Formação): o motor único de itens (core/items/scenarios.mjs) dá a build
  // (a da aba Comps quando a comp a publica; senão a reserva, marcada), os equipados, onde está cada item seu (campo e
  // reserva: "falta" só o que não existe em lugar nenhum) e de quem sai o item que "Passar itens" traz.
  const builds = formationBuilds({
    itemPlans: plan.itemPlans,
    units: rec.self?.units,
    reserve: rec.self?.reserve,
    goalIds,
    itemMoves: plan.itemMoves,
  });
  for (const c of cells) c.build = builds.get(c.id) ?? null;

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
    builds: "items",
    carousel: "items",
  };
  const add = (id, title, tone, rows, note = null) =>
    rows.length &&
    steps.push({
      id,
      title,
      tone,
      group: GROUP[id],
      rows,
      ...(note ? { note } : {}),
    });
  // Loja de agora (só ao vivo): cruza a lista Comprar e o painel Roll com a mesma função (shop-match.js).
  const shopNow = live
    ? shopView(seen, { gepStatus: state?.gepStatus })
    : shopView(null);
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
  // Cópias que o plano quer de cada peça: o servidor lista uma linha por peça que falta (1 cópia); `want`/`copies`, se vierem, valem.
  const missing = (stage?.buyNow ?? []).map((u) => ({
    key: `buy:${u.id}`,
    kind: "buy",
    unit: u,
    how: u.replaces ? "replace" : u.slot === "banco" ? "bank" : "slot",
    replaces: u.replaces,
    chance: u.chancePerShop ?? 0,
    broke: u.affordable === false,
    want: u.want ?? u.copies ?? 1,
    priority: u.isCarry ? 3 : 2,
    // Onde você já tem a peça agora (roster.js): a análise pode ser de antes da compra que a pôs na reserva.
    own: ownership(roster, u.id),
  }));
  // Peça do plano que você já tem (campo ou reserva): cada cópia aproxima a próxima estrela, então vale comprar quando
  // a loja a mostra (core/pool/buy-copies.mjs). Fora da loja a linha não aparece: não há o que buscar, e a lista
  // não vira um inventário das peças que você já tem.
  const copies = copyBuys({
    board: plan.board,
    pool: rec.pool,
    carry: plan.carry,
    gold: hero.gold,
    skip: new Set(missing.map((r) => r.unit.id)),
  }).map((c) => ({
    key: `buy:${c.id}`,
    kind: "buy",
    unit: { id: c.id, name: c.name, cost: c.cost, stars: c.stars },
    how: "copy",
    replaces: null,
    chance: c.chancePerShop,
    broke: c.broke,
    want: Math.min(c.need, SHOP.slots),
    priority: c.priority,
    reason: c.text,
    copy: { next: c.next, need: c.need, closes: c.closes, text: c.text },
    own: ownership(roster, c.id),
  }));
  const crossed = crossShop(
    // Ordem estável: a cópia que fecha estrela vem antes, depois o carry, e o resto segue a ordem do servidor.
    [...missing, ...copies].sort((a, b) => b.priority - a.priority),
    shopNow,
  );
  const buying = {
    ...crossed,
    rows: crossed.rows.filter((r) => r.how !== "copy" || r.shop),
  };
  add("buy", "Comprar", "amber", buying.rows, buying.status);
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
        // Banco de itens lido (GEP): a interface só o usa para mostrar os componentes quando o servidor não disse o que falta.
        bank: Array.isArray(seen.items) ? seen.items : null,
      })),
  );
  // Todos os itens recomendados de cada campeão em campo (até 3), com a situação de cada um segundo o banco lido
  // (core/items/champion-items.mjs): o "Próximo item" acima é só o destaque. Só entra quem ainda tem item pendente; o
  // carry primeiro. Sem banco lido não há o que dizer de "pronto"/"falta": a lista não aparece em vez de afirmar errado.
  const bankNow = Array.isArray(seen.items) ? seen.items : null;
  add(
    "builds",
    "Itens dos campeões",
    "blue",
    (bankNow ? cells : [])
      // Em campo e com slot livre: peça com os 3 slots cheios guarda os itens (a build ideal é só referência para ela).
      .filter(
        (c) =>
          c.build?.slotsFree > 0 &&
          c.status === "owned" &&
          !byId.get(c.id)?.inReserve,
      )
      .map((c) => ({ c, view: championItemsView(c, bankNow) }))
      .filter(({ view }) => view.items.some((i) => i.kind !== "on"))
      .sort((a, b) => Number(b.c.carry) - Number(a.c.carry))
      .map(({ c, view }) => ({
        key: `builds:${c.id}`,
        kind: "builds",
        unit: { id: c.id, name: c.name, cost: c.cost, stars: c.stars },
        carry: c.carry,
        items: view.items,
        // De onde veio a build: a publicada na comp (variação e partidas, como na aba Comps) ou a reserva.
        origin: view.origin,
        reserve: view.reserve,
        delta: view.delta,
        n: view.n,
        note: view.note,
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
  // Carrossel aberto (o servidor o detectou: fase do jogo, GEP ou calendário): as peças lidas do carrossel em ordem de
  // valor, ou, sem leitura, a lista de prioridade de agora (state.carousel, app/carousel-view.mjs). Fora dele, o que o
  // plano já sugeria pegar (plan.carousel), como sempre.
  const car = state?.carousel?.active === true ? state.carousel : null,
    carPicks = Array.isArray(car?.picks)
      ? car.picks.filter((c) => c?.itemId)
      : [],
    carNow = carPicks.length ? car : null;
  add(
    "carousel",
    carNow ? "Carrossel agora" : "Carrossel",
    carNow ? "go" : "gold",
    carNow
      ? carPicks.map((c) => ({
          key: `car:${c.slot ?? "p"}:${c.itemId}`,
          kind: "carousel",
          item: { id: c.itemId, name: c.itemName ?? undefined },
          rank: num(c.rank),
          // A peça lida do carrossel (campeão que vem com o item); só existe quando o carrossel foi lido.
          slotChampion: c.championId
            ? { id: c.championId, name: c.championName ?? null }
            : null,
          champion: c.forChampion ?? "",
          championId: c.forChampionId ?? null,
          target: c.target?.id
            ? { id: c.target.id, name: c.target.name }
            : null,
          completes: c.completesNow === true,
          reason: c.reason ?? "",
        }))
      : (plan.carousel ?? []).map((c) => ({
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
    carNow
      ? {
          state: car.from === "reading" ? "now" : "priority",
          text:
            car.from === "reading" ? "lido do jogo" : "prioridade: não lido",
          title:
            car.from === "reading"
              ? "Peças do carrossel lidas do jogo (GEP), em ordem de valor para o plano."
              : (car.note ?? "O carrossel não foi lido."),
        }
      : null,
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
        // Os espaços e a confiança vêm da loja que a interface lê agora (shop-match.js), a mesma da lista Comprar.
        shop: refineShopHits(ro.shop, shopNow),
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

  // "N/M" do anel do HUD: peças da comp em campo e, à parte, as que estão só na reserva (roster.js). O
  // `stage.goalProgress.onBoard` do servidor soma campo e reserva da análise; aqui fica separado e com a reserva de agora.
  const progress = compOwnership(roster, [...goalIds]);
  return {
    hero,
    status,
    // Para quem desenha fora do modelo (seção Plano): a mesma leitura de campo e reserva.
    roster,
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
      // "N/M" em campo (o overlay também lê este par). A reserva fica em `reserve`: "+K na reserva" e o texto da dica.
      progress: { have: progress.field, total: progress.size },
      reserve: {
        count: progress.reserve,
        known: progress.benchKnown,
        text: progress.text,
      },
      // Peças da comp que valem trocar (ou que estão sob pressão sem substituto bom), com a sugestão escolhida.
      subs: (plan.flex ?? [])
        .filter((f) => f.suggest || f.contested || f.unreachable)
        .map((f) => {
          // `where`: onde está a alternativa que já é sua ("em campo", "na reserva"...), pela leitura de agora (roster.js).
          const options = (f.options ?? []).map((o) => {
            const own = ownership(roster, o.id);
            return { ...o, where: own.mine ? own.label : "" };
          });
          return {
            ...f,
            options,
            pick: options.find((o) => o.id === f.suggest) ?? null,
          };
        }),
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
      g: n * SHOP.cost,
      v,
    }));
    const gold = (n) => (Number.isFinite(n) ? n * SHOP.cost : null);
    q50 = gold(shopsFor(k, p, 0.5));
    q80 = gold(shopsFor(k, p, 0.8));
  }
  const maxG = points.at(-1).g,
    step = points[1]?.g ?? SHOP.cost;
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
