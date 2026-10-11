// Campo de agora: o que manter em campo no nível atual e o que comprar a caminho da comp alvo.
// A meta pode ter campeões que a loja quase não oferece no seu nível; eles ficam para depois.
// Entram no cálculo: nível (odds de loja), pool (cópias livres e disputa), ouro (o que cabe comprar),
// o que você já tem em campo e, quando lida da tela, a loja atual (que carta comprar agora).
// Heurística; não simula combate.
import { isBuyable, levelOdds, unlockLevel } from "./core/pool/shop.mjs";
import { BUYABLE_ODDS } from "./core/pool/tables.mjs";
import { lobbyStrength, pressureOf, tierFloor } from "./economy.mjs";
import { wishlist } from "./tactics.mjs";
import {
  baseItemId,
  isComponent,
  isConsumable,
  itemRole,
} from "./core/catalog/items.mjs";
import { isAvatar } from "./core/catalog/champions.mjs";
import { movedInto } from "./core/items/moves.mjs";
/** Devolve o campo sugerido para `options.level`, as compras com chance por loja e o que da meta fica para depois. */
export function stagePlan(plan, analysis, catalog, options) {
  const level = Math.max(1, Math.min(11, options.level)),
    odds = levelOdds(level),
    gold = options.gold;
  const byId = new Map(catalog.champions.map((c) => [c.apiName, c])),
    pool = new Map(analysis.pool.map((p) => [p.name, p]));
  const field = new Map(analysis.self.units.map((u) => [u.championName, u])),
    reserve = new Set((analysis.self.reserve ?? []).map((u) => u.championName));
  const have = (id) => field.has(id) || reserve.has(id),
    buyable = (cost) => isBuyable(level, cost);
  const goalIds = new Set(plan.board.map((u) => u.id)),
    goalTraits = new Set(
      (plan.traits ?? []).filter((t) => t.active).map((t) => t.name),
    );
  const entry = (id, status) => {
    const c = byId.get(id),
      u = field.get(id);
    return {
      id,
      name: c?.name ?? id,
      cost: c?.cost ?? u?.price ?? 0,
      status,
      owned: have(id),
      stars: u?.starLevel ?? (reserve.has(id) ? 1 : 0),
      items: u?.itemNames?.length ?? 0,
    };
  };
  const strength = (u) =>
    u.starLevel * (byId.get(u.championName)?.cost ?? u.price ?? 1) +
    (u.itemNames?.length ?? 0) * 2;
  // 1) Em campo agora: o que já é seu. Peças da meta primeiro, depois as temporárias mais fortes.
  const ownedGoal = plan.board
    .filter((u) => have(u.id))
    .sort(
      (a, b) =>
        Number(b.name === plan.carry) - Number(a.name === plan.carry) ||
        b.cost - a.cost,
    );
  const temps = [...field.values()]
    .filter((u) => !goalIds.has(u.championName))
    .sort((a, b) => strength(b) - strength(a));
  const board = ownedGoal.slice(0, level).map((u) => entry(u.id, "meta")),
    hold = ownedGoal.slice(level).map((u) => entry(u.id, "meta"));
  for (const u of temps) {
    if (board.length >= level) break;
    board.push(entry(u.championName, "temporario"));
  }
  // 2) Compras: peças da meta que a loja deste nível oferece, com a chance real por loja dada a pool visível.
  const wanted = plan.board
    .filter((u) => !have(u.id) && buyable(u.cost))
    .map((u) => {
      const p = pool.get(u.name),
        chance = p?.chancePerShop ?? 0;
      return {
        id: u.id,
        name: u.name,
        cost: u.cost,
        chancePerShop: chance,
        shopsToFind: chance > 0 ? Math.ceil(1 / chance) : null,
        remaining: p?.remainingUpper ?? null,
        enemyCopies: p?.enemy ?? 0,
        affordable: gold === null ? null : gold >= u.cost,
        isCarry: u.name === plan.carry,
      };
    })
    .sort(
      (a, b) =>
        Number(b.isCarry) - Number(a.isCarry) ||
        b.chancePerShop - a.chancePerShop,
    );
  // Cada compra entra numa vaga livre ou no lugar da temporária mais fraca ainda em campo.
  const replaceable = board.filter((u) => u.status === "temporario").reverse();
  let free = level - board.length;
  const buyNow = wanted.map((w) => {
    let replaces = null;
    const hadFree = free > 0;
    if (hadFree) free--;
    else replaces = replaceable.shift()?.name ?? null;
    return {
      ...w,
      replaces,
      slot: replaces ? "troca" : hadFree ? "vaga" : "banco",
    };
  });
  // 3) Sobrou vaga sem peça da meta para ela: pontes compráveis que ativam sinergias da meta.
  let open = level - board.length - wanted.length;
  const bridges = [];
  if (open > 0) {
    const taken = new Set([...board.map((u) => u.id), ...goalIds]);
    const candidates = catalog.champions
      .filter(
        (c) =>
          !isAvatar(c) &&
          !taken.has(c.apiName) &&
          buyable(c.cost) &&
          (pool.get(c.name)?.remainingUpper ?? 0) > 0,
      )
      .map((c) => {
        const p = pool.get(c.name),
          shared = c.traits.filter((t) => goalTraits.has(t)).length;
        return {
          c,
          p,
          shared,
          score:
            shared * 4 +
            (p?.chancePerShop ?? 0) * 10 -
            (p ? (p.enemy / p.total) * 6 : 0) +
            c.cost * 0.4,
        };
      })
      .filter((b) => b.shared > 0)
      .sort((a, b) => b.score - a.score);
    for (const b of candidates) {
      if (open-- <= 0) break;
      bridges.push({
        id: b.c.apiName,
        name: b.c.name,
        cost: b.c.cost,
        chancePerShop: b.p?.chancePerShop ?? 0,
        sharedTraits: b.c.traits.filter((t) => goalTraits.has(t)),
        affordable: gold === null ? null : gold >= b.c.cost,
      });
    }
  }
  // Loja lida da tela: cada carta vira uma ação. Peça da meta > cópia de algo que você já tem (upgrade) > ponte.
  // Prioridade: carta que fecha upgrade > carry > peça da meta > cópia de unidade sua > ponte. Cartas secundárias
  // (cópia fora da meta, ponte) não são compradas se derrubarem o patamar de juros atual, salvo com a vida em risco.
  // Com a vida em risco (mesma faixa de strategy.mjs) cartas secundárias podem derrubar o patamar de juros.
  const bridgeIds = new Set(bridges.map((b) => b.id)),
    pressure = pressureOf({
      hp: analysis.self.health,
      stage: options.stage ?? null,
      weak: lobbyStrength(analysis).weak,
    }),
    interestTier = gold === null ? 0 : tierFloor(gold);
  const cards = (options.shop ?? [])
    .map((id, slot) => {
      if (!id) return null;
      const c = byId.get(id);
      if (!c) return null;
      const p = pool.get(c.name),
        own = p?.own ?? 0,
        inGoal = goalIds.has(id);
      const completes =
        own === 8
          ? "fecha 3★"
          : own % 3 === 2 && own < 8
            ? "fecha um 2★"
            : null;
      const role = inGoal
        ? c.name === plan.carry
          ? "carry da meta"
          : "peça da meta"
        : have(id)
          ? "cópia de unidade sua"
          : bridgeIds.has(id)
            ? "ponte para as sinergias da meta"
            : null;
      const priority = !role
        ? -1
        : (completes ? 4 : 0) +
          (c.name === plan.carry ? 3 : inGoal ? 2 : have(id) ? 1 : 0);
      return {
        slot: slot + 1,
        id,
        name: c.name,
        cost: c.cost,
        own,
        completes,
        role,
        priority,
        core: inGoal || !!completes,
        enemyCopies: p?.enemy ?? 0,
      };
    })
    .filter(Boolean);
  let budget = gold;
  for (const card of [...cards].sort((a, b) => b.priority - a.priority)) {
    if (card.priority < 0) {
      card.action = "ignorar";
      card.reason = "fora do plano atual";
      continue;
    }
    card.reason = [
      card.role,
      card.completes,
      card.own && !card.completes ? card.own + " cópia(s) suas" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (budget === null) {
      card.action = "comprar";
      continue;
    }
    if (budget < card.cost) {
      card.action = "sem ouro";
      continue;
    }
    if (!card.core && !pressure.danger && budget - card.cost < interestTier) {
      card.action = "segurar";
      card.reason += " · compraria abaixo de " + interestTier + "g de juros";
      continue;
    }
    card.action = "comprar";
    budget -= card.cost;
  }
  const shop = cards;
  for (const b of buyNow) b.inShop = shop.some((s) => s.id === b.id);
  // Item de cada unidade em campo: o que já dá para montar com o banco, ou o próximo da build.
  const advice = analysis.ownedItemAdvice;
  // Item que já existe em outra peça (a que sai, por exemplo) e a comp passa para esta ("Passar itens"):
  // não falta, não se monta de novo e já ocupa o slot de quem o recebe.
  const movedIn = movedInto(plan.itemMoves);
  for (const u of board) {
    const ready = (advice?.ready ?? [])
      .filter((r) => r.championId === u.id)
      .map((r) => ({
        id: r.item.id,
        name: r.item.name,
        usesHeld: r.item.usesHeld ?? null,
      }));
    const build = (advice?.builds ?? []).find((b) => b.championId === u.id);
    const next = (build?.additions ?? [])
      .filter((i) => !ready.some((r) => r.id === i.id))
      .filter((i) => !movedIn.get(u.id)?.has(baseItemId(i.id)))
      .slice(0, 1)
      .map((i) => ({
        id: i.id,
        name: i.name,
        missing: (i.missing ?? []).map((m) => m.name),
        // Receita e situação de cada peça para a interface desenhar os componentes (só apresentação).
        components: i.components ?? [],
        missingIds: (i.missing ?? []).map((m) => m.id),
        usesHeld: i.usesHeld ?? null,
      }));
    const stays = u.status === "meta";
    u.equipNow = stays ? ready : [];
    u.nextItem = stays ? (next[0] ?? null) : null;
    u.slotsFree = Math.max(
      0,
      (build?.slotsFree ?? 0) - (movedIn.get(u.id)?.size ?? 0),
    );
  }
  // Item pronto no banco: vai para a unidade em campo que mais o usa. Ordem: está na build de meta dela
  // (melhor posição primeiro), depois papel compatível; peça da meta antes de temporária; precisa de slot livre.
  const itemNames = new Map(catalog.items.map((i) => [i.apiName, i.name])),
    kind = itemRole;
  // Mesma lista de desejo de build() e Passar itens (tactics.mjs); completar componente equipado não gasta slot.
  const wishOf = (id) => wishlist(id, plan.meta?.builds, options.metaBuilds),
    room = new Map(
      board.map((u) => [
        u.id,
        u.slotsFree - u.equipNow.filter((e) => !e.usesHeld).length,
      ]),
    );
  const bankItems = [];
  for (const id of (options.inventory ?? []).filter(
    (id) => !isComponent(id) && !isConsumable(id),
  )) {
    if (
      board.some((u) =>
        u.equipNow.some((e) => e.id === id && !e.used && (e.used = true)),
      )
    )
      continue;
    const options2 = board
      .filter((u) => (room.get(u.id) ?? 0) > 0)
      .map((u) => {
        const rank = wishOf(u.id).indexOf(id),
          role = (advice?.builds ?? []).find(
            (b) => b.championId === u.id,
          )?.role,
          fits = kind(id) === "flex" || kind(id) === role;
        return {
          u,
          rank,
          fits,
          score:
            (rank >= 0 ? 20 - rank * 2 : fits ? 6 : -1) +
            (u.status === "meta" ? 4 : 0) +
            (u.name === plan.carry ? 3 : 0),
        };
      })
      .filter((o) => o.score >= 0)
      .sort((a, b) => b.score - a.score);
    const pick = options2[0];
    if (pick) room.set(pick.u.id, room.get(pick.u.id) - 1);
    bankItems.push({
      id,
      name: itemNames.get(id) ?? id,
      to: pick ? { id: pick.u.id, name: pick.u.name } : null,
      reason: !pick
        ? "nenhuma unidade em campo com slot livre usa bem este item; guarde"
        : pick.rank >= 0
          ? pick.rank + 1 + "º item de " + pick.u.name + " na meta"
          : "papel compatível com " +
            pick.u.name +
            (pick.u.status === "meta"
              ? ""
              : " (temporário; passe adiante depois)"),
    });
  }
  const later = plan.board
    .filter((u) => !have(u.id) && !buyable(u.cost))
    .map((u) => ({
      id: u.id,
      name: u.name,
      cost: u.cost,
      fromLevel: unlockLevel(u.cost),
    }))
    .sort((a, b) => a.fromLevel - b.fromLevel);
  const notes = [];
  if (later.length)
    notes.push(
      `${later.length} peça(s) da meta ficam para depois: no nível ${level} a loja oferece menos de ${BUYABLE_ODDS}% por slot para esse custo.`,
    );
  if (gold !== null && buyNow.length) {
    const cost = buyNow.reduce((n, b) => n + b.cost, 0);
    notes.push(
      `Comprar todas as peças listadas custa ${cost}g; você tem ${gold}g.`,
    );
  }
  if (gold === null)
    notes.push("Ouro não lido: as compras aparecem sem checagem de custo.");
  return {
    level,
    board,
    bankItems,
    shop,
    shopRead: Array.isArray(options.shop) && options.shop.length > 0,
    buyNow,
    bridges,
    hold,
    later,
    goalProgress: {
      onBoard: board.filter((u) => u.status === "meta").length,
      goal: plan.board.length,
    },
    odds: odds.map((value, i) => ({ cost: i + 1, value })),
    note: notes.join(" "),
  };
}
