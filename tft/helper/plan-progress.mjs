// Checklist de progresso do plano em andamento: o que da comp mostrada já foi conquistado e o que falta.
//
// Função pura (sem E/S): recebe o plano mostrado, o estado lido da partida e as marcas da partida (maior estrela vista,
// itens montados, aprimoramentos) e devolve a lista de itens do plano, as marcas novas e os eventos desde a leitura
// anterior. Quem guarda as marcas entre rodadas e no disco é `plan-state.mjs`.
//
// Princípios:
// - O progresso é DERIVADO do estado de agora (peças em campo e reserva, itens equipados, aprimoramentos, nível): um passo
//   cumprido não volta como recomendação, e um passo parcial mostra quanto falta (cópias, componentes).
// - As marcas são a memória da partida: servem para dizer "isto já foi conquistado" (e perdido depois), nunca para
//   fabricar um progresso que o estado de agora não mostra.
// - Os itens-alvo de cada peça são congelados na primeira vez que aparecem e só mudam quando concluídos ou impossíveis;
//   sem isso a build "ideal" do motor reordena a cada leitura e a lista pisca.
import { copies } from "./unit-ledger.mjs";
import { baseItemId } from "./core/catalog/items.mjs";
import { progressStatus } from "./core/items/holdings.mjs";
import { movesInto } from "./core/items/moves.mjs";

/** Rodadas de aprimoramento do Set 18 (estágio-rodada) e quantas há. */
export const AUGMENT_ROUNDS = ["2-1", "3-2", "4-2"];
/** Itens por peça e quantas peças acompanham itens no checklist. */
const ITEM_SLOTS = 3,
  ITEM_UNITS = 4,
  NEXT_MAX = 4;

const rank = (label) => {
  const m = /^(\d)-(\d)$/.exec(label ?? "");
  return m ? Number(m[1]) * 10 + Number(m[2]) : null;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Componentes/itens como objetos do motor ({id,name}) ou, já congelados, como nomes.
const names = (components = []) =>
  components.map((c) => (typeof c === "string" ? c : (c?.name ?? c?.id)));

/** Ordem estável das peças do plano: a guardada primeiro (sem trocar de lugar), as novas no fim por custo e id. */
export function stableOrder(previous = [], board = [], carryId = null) {
  const ids = new Set(board.map((u) => u.id)),
    kept = previous.filter((id) => ids.has(id)),
    fresh = board
      .filter((u) => !kept.includes(u.id))
      .sort(
        (a, b) =>
          Number(b.id === carryId) - Number(a.id === carryId) ||
          b.cost - a.cost ||
          (a.id < b.id ? -1 : 1),
      )
      .map((u) => u.id);
  return [...kept, ...fresh];
}

/** Cópias de 1★ e maior estrela de cada campeão entre as peças em campo e a reserva informada. */
function holdings(analysis) {
  const out = new Map(),
    add = (id, star, quantity, where) => {
      if (!id) return;
      const row = out.get(id) ?? { copies: 0, stars: 0, board: 0, reserve: 0 };
      row.copies += copies(star) * quantity;
      row.stars = Math.max(row.stars, star);
      row[where] += quantity;
      out.set(id, row);
    };
  for (const u of analysis.self?.units ?? [])
    add(u.championName, u.starLevel ?? 1, 1, "board");
  for (const u of analysis.self?.reserve ?? [])
    add(
      u.championName ?? u.id,
      u.starLevel ?? u.stars ?? 1,
      u.quantity ?? 1,
      "reserve",
    );
  return out;
}

/** Congela os itens-alvo de cada peça: os já escolhidos ficam, os concluídos contam, as vagas livres são preenchidas. */
function freezeItems(previous, plans, order) {
  const byUnit = new Map(plans.map((p) => [p.championId, p])),
    out = {};
  let tracked = 0;
  for (const id of order) {
    if (tracked >= ITEM_UNITS) continue;
    const p = byUnit.get(id);
    // Sem plano de itens nesta leitura: os alvos já escolhidos ficam (não somem por uma leitura incompleta).
    if (!p) {
      if (previous[id]?.length) {
        out[id] = previous[id];
        tracked++;
      }
      continue;
    }
    const equipped = (p.equipped ?? []).map((i) => i.id),
      ideal = p.ideal ?? [],
      idealIds = new Set(ideal.map((i) => i.id)),
      // Itens equipados que não são da build ideal ocupam vaga sem contar como alvo.
      foreign = equipped.filter(
        (x) =>
          !idealIds.has(x) && !(previous[id] ?? []).some((t) => t.id === x),
      ).length,
      cap = Math.max(0, ITEM_SLOTS - foreign),
      list = [];
    const take = (item) => {
      if (list.length < cap && !list.some((t) => t.id === item.id))
        list.push({
          id: item.id,
          name: item.name,
          components: names(item.components),
        });
    };
    for (const t of previous[id] ?? []) take(t);
    for (const i of ideal) take(i);
    if (list.length) {
      out[id] = list;
      tracked++;
    }
  }
  return out;
}

/**
 * Constrói o checklist do plano mostrado.
 * - `shown`: recomendação mostrada (já com tactics/stage/strategy: `board[].targetStars`, `itemPlans`, `strategy.panels`);
 * - `analysis`: análise (peças em campo e reserva em `self`);
 * - `state`: { level, targetLevel, gold, stage ("2-3" ou null), chosen: [{id,name}], ledger };
 * - `memory`: { order, units, items, augments, level, itemTargets, seeded } guardado entre rodadas.
 * Devolve `{ checklist, memory, events }`; `memory` é uma cópia nova.
 */
export function buildChecklist({ shown, analysis, state, memory = {} }) {
  const board = shown.board ?? [],
    carry = board.find((u) => u.name === shown.carry) ?? null,
    have = holdings(analysis),
    order = stableOrder(memory.order, board, carry?.id ?? null),
    byId = new Map(board.map((u) => [u.id, u])),
    bought = new Map(
      (state.ledger?.reconciliation?.champions ?? []).map((c) => [c.id, c]),
    );
  const next = {
    ...memory,
    order,
    units: { ...memory.units },
    items: { ...memory.items },
  };
  const events = [];
  const seeded = memory.seeded === true;

  /* ----- Peças ----- */
  const units = order.map((id) => {
    const u = byId.get(id),
      h = have.get(id) ?? { copies: 0, stars: 0, board: 0, reserve: 0 },
      target = Math.max(1, u.targetStars ?? 1),
      need = copies(target),
      best = Math.max(next.units[id] ?? 0, h.stars);
    if (h.stars > (next.units[id] ?? 0)) {
      if (seeded)
        events.push({
          type: "unit",
          id,
          text: !(next.units[id] ?? 0)
            ? `${u.name} entrou no time`
            : `${u.name} subiu para ${h.stars}★`,
        });
      next.units[id] = h.stars;
    }
    const done = h.stars >= target,
      status = done ? "done" : h.copies > 0 ? "partial" : "missing",
      surplus = bought.get(id)?.surplus ?? 0;
    return {
      id,
      name: u.name,
      cost: u.cost,
      carry: id === carry?.id,
      stars: h.stars,
      targetStars: target,
      copies: Math.min(h.copies, need),
      need,
      status,
      where: h.board ? "campo" : h.reserve ? "reserva" : null,
      // Já chegou a esta estrela e perdeu (venda ou fusão para outro lugar): o plano ainda precisa dela.
      lost: best > h.stars && h.stars < target,
      // Compras do TFT.log sem peça em campo: TETO da reserva (o log não grava venda), nunca a reserva.
      boughtUpTo: status === "missing" && surplus > 0 ? surplus : null,
    };
  });

  /* ----- Itens ----- */
  const itemPlans = shown.itemPlans ?? [],
    // Itens só de peças que já são suas: build de peça que ainda não existe é a lista ideal do motor, não progresso.
    targets = freezeItems(
      memory.itemTargets ?? {},
      itemPlans,
      order.filter((id) => (have.get(id)?.stars ?? 0) > 0),
    ),
    plansById = new Map(itemPlans.map((p) => [p.championId, p]));
  next.itemTargets = targets;
  const items = [];
  for (const id of order) {
    const wanted = targets[id];
    if (!wanted) continue;
    const plan = plansById.get(id),
      equipped = new Set((plan?.equipped ?? []).map((i) => i.id)),
      ideal = new Map((plan?.ideal ?? []).map((i) => [i.id, i]));
    for (const t of wanted) {
      const live = ideal.get(t.id),
        key = `${id}|${t.id}`,
        built = equipped.has(t.id);
      // Item que já existe em outra peça (a que sai, por exemplo) e o plano passa para esta: não falta, só se move.
      const moved = built
        ? null
        : movesInto(shown.itemMoves, id).find(
            (x) => x.itemId === baseItemId(t.id),
          );
      // Situação do item (vocabulário do checklist) pela regra única da posse de itens; sem o plano de itens desta
      // peça na leitura, o que já foi visto montado segue montado.
      const status =
        progressStatus({
          built,
          moved: !!moved,
          craftable: !!live?.craftable,
          missing: live?.missing,
          parts: live?.components?.length ?? 0,
        }) ?? (!plan && next.items[key] ? "built" : "missing");
      if (built && !next.items[key]) {
        if (seeded)
          events.push({
            type: "item",
            id: t.id,
            text: `${t.name} montado em ${byId.get(id)?.name ?? id}`,
          });
        next.items[key] = 1;
      }
      items.push({
        key,
        unitId: id,
        unit: byId.get(id)?.name ?? id,
        itemId: t.id,
        name: t.name,
        components: t.components,
        // Componentes que ainda faltam (nomes), quando o motor sabe; vazio se pronto/montado.
        missing:
          built || status === "ready" || status === "move"
            ? []
            : names(live?.missing),
        // Peça de onde o item sai quando status é "move".
        from: moved?.from?.name ?? null,
        status,
      });
    }
  }

  /* ----- Aprimoramentos ----- */
  const chosen = state.chosen ?? [],
    now = rank(state.stage);
  for (const a of chosen)
    if (!(memory.augments ?? []).includes(a.id) && seeded)
      events.push({
        type: "augment",
        id: a.id,
        text: `Aprimoramento escolhido: ${a.name}`,
      });
  next.augments = [
    ...new Set([...(memory.augments ?? []), ...chosen.map((a) => a.id)]),
  ];
  const augments = AUGMENT_ROUNDS.map((round, i) => {
    const pick = chosen[i] ?? null;
    return {
      round,
      id: pick?.id ?? null,
      name: pick?.name ?? null,
      status: pick
        ? "done"
        : now !== null && now >= rank(round)
          ? "now"
          : "later",
    };
  });

  /* ----- Nível e ouro ----- */
  const lv = shown.strategy?.panels?.leveling,
    eco = shown.strategy?.panels?.economy,
    targetLevel = state.targetLevel ?? lv?.finalLevel ?? null,
    level = {
      now: state.level ?? null,
      target: targetLevel,
      rollAt: shown.strategy?.rollAt ?? null,
      xp: lv?.xp ? { have: lv.xp.have, total: lv.xp.total } : null,
      status:
        state.level != null && targetLevel != null && state.level >= targetLevel
          ? "done"
          : "pending",
    };
  if (state.level != null && state.level > (memory.level ?? 0)) {
    if (seeded && memory.level)
      events.push({ type: "level", text: `Nível ${state.level}` });
    next.level = state.level;
  }
  const interestAt = shown.strategy?.interestAt ?? eco?.next ?? null,
    gold = {
      now: state.gold ?? null,
      // Patamar de juros mais próximo e o piso que a decisão respeita; null quando o ouro não foi lido.
      interestAt,
      keep: shown.strategy?.keep ?? eco?.keep ?? null,
      floor: shown.strategy?.floor ?? eco?.floor ?? null,
      status:
        state.gold == null
          ? "unknown"
          : interestAt == null
            ? "done"
            : "pending",
    };

  /* ----- Resumo e próximo passo ----- */
  const dueAugments = augments.filter((a) => a.status !== "later"),
    total =
      units.length +
      items.length +
      dueAugments.length +
      (level.target != null ? 1 : 0),
    done =
      units.filter((u) => u.status === "done").length +
      items.filter((i) => i.status === "built").length +
      dueAugments.filter((a) => a.status === "done").length +
      (level.status === "done" ? 1 : 0);
  const queue = [];
  for (const u of units)
    if (u.status !== "done")
      queue.push({
        kind: "unit",
        id: u.id,
        priority: u.carry ? 0 : 3,
        text:
          u.status === "missing"
            ? `${u.name}: ${u.targetStars}★ (${plural(u.need, "cópia", "cópias")})`
            : `${u.name}: ${u.stars}→${u.targetStars}★ (${u.copies}/${u.need} cópias)`,
      });
  for (const i of items)
    if (i.status !== "built")
      queue.push({
        kind: "item",
        id: i.key,
        priority:
          i.status === "ready" || i.status === "move"
            ? 1
            : byId.get(i.unitId)?.name === shown.carry
              ? 2
              : 4,
        text:
          i.status === "ready"
            ? `Montar ${i.name} em ${i.unit}`
            : i.status === "move"
              ? `Passar ${i.name} de ${i.from} para ${i.unit}`
              : `${i.name} em ${i.unit}${i.missing.length ? `: falta ${i.missing.join(" + ")}` : ""}`,
      });
  for (const a of augments)
    if (a.status === "now")
      queue.push({
        kind: "augment",
        id: a.round,
        priority: 1,
        text: `Escolher o aprimoramento de ${a.round}`,
      });
  if (level.status === "pending" && level.now != null)
    queue.push({
      kind: "level",
      id: "level",
      priority: 5,
      text: `Nível ${level.now} → ${level.target}`,
    });
  // Estável: a ordem do plano desempata dentro da prioridade (sort do JS é estável).
  const nextSteps = queue
    .sort((a, b) => a.priority - b.priority)
    .slice(0, NEXT_MAX);

  next.seeded = true;
  return {
    checklist: {
      units,
      items,
      augments,
      level,
      gold,
      summary: {
        done,
        total,
        pct: total ? Math.round((done / total) * 100) : 0,
      },
      next: nextSteps.map(({ kind, id, text }) => ({ kind, id, text })),
    },
    memory: next,
    events,
  };
}
