// Campo de agora: o que manter em campo no nível atual e o que comprar a caminho da comp alvo.
// A meta pode ter campeões que a loja quase não oferece no seu nível; eles ficam para depois.
// Entram no cálculo: nível (odds de loja), pool (cópias livres e disputa), ouro (o que cabe comprar),
// o que você já tem em campo e, quando lida da tela, a loja atual (que carta comprar agora).
// Heurística; não simula combate.
import { isBuyable, levelOdds, unlockLevel } from "./core/pool/shop.mjs";
import { BUYABLE_ODDS } from "./core/pool/tables.mjs";
import { starCopies } from "./core/pool/copies.mjs";
import { shopCopies } from "./core/pool/buy-copies.mjs";
import {
  lobbyStrength,
  pressureOf,
  stageForPressure,
  tierFloor,
} from "./economy.mjs";
import { compBuild, wantedItems } from "./core/items/builds.mjs";
import { bankItemTargets } from "./core/items/scenarios.mjs";
import {
  baseItemId,
  isComponent,
  isConsumable,
  itemRole,
} from "./core/catalog/items.mjs";
import { isAvatar } from "./core/catalog/champions.mjs";
import { movedInto } from "./core/items/moves.mjs";
import { traitBook } from "./core/catalog/traits.mjs";
import {
  analysisInput,
  interimContext,
  interimSlots,
} from "./core/board/interim.mjs";

/** O que uma carta da loja faz no tabuleiro de agora (`buys` de core/board/interim.mjs), em uma frase. */
function fillText(fill) {
  if (!fill) return null;
  if (fill.purpose === "vaga")
    return `entra na vaga de ${fill.for?.name ?? fill.name}`;
  if (fill.purpose === "troca")
    return `entra no lugar de ${fill.replaces?.name ?? "um temporário"}`;
  if (fill.purpose === "reserva")
    return `guarde na reserva: o temporário segue em campo (compre os dois)${fill.sell ? ` · venda ${fill.sell.name} para abrir vaga na reserva` : ""}`;
  if (fill.purpose === "temporario")
    return `temporário para a vaga vazia: +${String(fill.gainHp).replace(".", ",")} de vida contra ${fill.costGold}g de juros`;
  return null;
}
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
  // Faixa de vida (a MESMA de strategy.mjs: mesmas entradas, com a tendência e o estágio estimado): pesa a margem do
  // substituto temporário, a compra de temporário na loja e o orçamento da loja abaixo.
  const lobby = lobbyStrength(analysis),
    pressure = pressureOf({
      hp: analysis.self.health,
      stage: stageForPressure(options.stage ?? null, lobby.foeLevel),
      weak: lobby.weak,
      trend: options.trend ?? null,
      gold,
      board:
        lobby.size > 1 ? { mine: lobby.mine, typical: lobby.median } : null,
      won: options.streak?.kind === "win",
    }),
    interestTier = gold === null ? 0 : tierFloor(gold);
  // 1) Quem joga agora em cada vaga do plano: a regra única do substituto temporário (core/board/interim.mjs), a mesma das
  // trocas de tactics.mjs, com a loja lida como possibilidade de compra. Troca aceita da comp (fixada: goal.swaps;
  // sugerida: autoSwaps) aparece como "troca da comp".
  const ictx = interimContext(catalog, traitBook(catalog)),
    shopRead = Array.isArray(options.shop) && options.shop.length > 0,
    iinput = {
      goal: plan.board,
      carry: plan.carry,
      swaps:
        plan === analysis.preview
          ? (analysis.goal?.swaps ?? [])
          : plan === analysis.recommendations?.[0]
            ? (analysis.autoSwaps ?? [])
            : [],
      ...analysisInput(analysis, ictx),
      benchKnown: options.benchKnown === true,
      level,
      gold,
      band: pressure.band,
      positions: plan.positions ?? [],
    };
  // Cartas da loja de agora; `buy(slot)` diz se o orçamento deixa comprar. Loja não lida: null (nada é inventado).
  const shopCards = (buy) =>
    shopRead
      ? options.shop
          .map((id, i) => {
            const c = id ? byId.get(id) : null;
            return c
              ? { slot: i + 1, id, name: c.name, cost: c.cost, buy: buy(i + 1) }
              : null;
          })
          .filter(Boolean)
      : null;
  // 1ª passada: toda carta é comprável (a vaga que cada uma ocuparia); o orçamento da loja decide quais de fato.
  const draft = interimSlots({ ...iinput, shop: shopCards(() => true) }, ictx),
    intent = new Map(draft.buys.map((b) => [b.slot, b]));
  const boardOf = (res) => {
    const playing = res.slots.filter(
      (s) => s.playing && s.playing.source !== "loja",
    );
    const metas = playing
      .filter((s) => s.kind !== "temporario")
      .sort(
        (a, b) =>
          Number(b.playing.name === plan.carry) -
            Number(a.playing.name === plan.carry) ||
          b.playing.cost - a.playing.cost,
      )
      .map((s) => entry(s.playing.id, "meta"));
    return [
      ...metas,
      ...playing
        .filter((s) => s.kind === "temporario")
        .map((s) => entry(s.playing.id, "temporario")),
    ];
  };
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
  // 3) Sobrou vaga sem peça da meta para ela: pontes compráveis que ativam sinergias da meta.
  const board0 = boardOf(draft);
  let open = level - board0.length - wanted.length;
  const bridges = [];
  if (open > 0) {
    const taken = new Set([...board0.map((u) => u.id), ...goalIds]);
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
  // Com a vida em risco (a MESMA faixa de strategy.mjs: mesmas entradas, com a tendência e o estágio estimado) a ponte,
  // que ocupa uma vaga vazia agora, pode derrubar o patamar de juros; a cópia fora do plano que não fecha estrela não
  // estabiliza agora e fica: o ouro vai para cópias e upgrades do plano.
  // Cada carta também diz a vaga que ocuparia (core/board/interim.mjs): "entra na vaga de X", "no lugar de S", "compre os
  // dois" (o titular vai para a reserva) ou "temporário mais forte agora" (peça fora da comp para uma vaga vazia, só quando
  // a vida que ela segura paga os juros na faixa de vida de agora: já pesada lá, então o corte de juros abaixo não vale).
  const bridgeIds = new Set(bridges.map((b) => b.id));
  // Cópias de 1★ suas por campeão lidas agora (campo + reserva, inclusive a do GEP): piso para a cópia da pool.
  const ownCopies = new Map();
  for (const u of [...analysis.self.units, ...(analysis.self.reserve ?? [])])
    ownCopies.set(
      u.championName,
      (ownCopies.get(u.championName) ?? 0) +
        starCopies(u.starLevel ?? u.stars ?? 1),
    );
  const cards = (options.shop ?? [])
    .map((id, slot) => {
      if (!id) return null;
      const c = byId.get(id);
      if (!c) return null;
      // Cópias suas: as da pool (campo + reserva do GEP), com piso nas estrelas lidas em campo e na reserva.
      const p = pool.get(c.name),
        own = Math.max(p?.own ?? 0, ownCopies.get(id) ?? 0),
        inGoal = goalIds.has(id),
        fill = intent.get(slot + 1) ?? null;
      const role = inGoal
        ? c.name === plan.carry
          ? "carry da meta"
          : "peça da meta"
        : have(id)
          ? "cópia de unidade sua"
          : fill?.purpose === "temporario"
            ? "temporário mais forte agora"
            : bridgeIds.has(id)
              ? "ponte para as sinergias da meta"
              : null;
      return {
        slot: slot + 1,
        id,
        name: c.name,
        cost: c.cost,
        own,
        completes: null,
        closesWith: null,
        copyNote: null,
        role,
        priority: -1,
        core: inGoal,
        fill,
        enemyCopies: p?.enemy ?? 0,
        base: !role
          ? -1
          : c.name === plan.carry
            ? 3
            : inGoal
              ? 2
              : have(id)
                ? 1
                : 0,
      };
    })
    .filter(Boolean);
  // Cartas iguais na mesma loja, em ordem de slot: cada uma desconta as cópias que as anteriores já trazem (a 1ª fecha
  // o 2★; a 2ª é cópia a mais rumo ao 3★ ou extra). A carta que fecha leva junto as anteriores de que precisa
  // (`closesWith`): elas também valem como "fecha estrela" na prioridade, nos juros e na vida em perigo.
  const sameCards = new Map();
  for (const card of cards)
    sameCards.set(card.id, [...(sameCards.get(card.id) ?? []), card]);
  for (const group of sameCards.values()) {
    const steps = shopCopies(group[0].own, group.length);
    for (const [i, card] of group.entries()) {
      const step = steps[i];
      card.completes = step.completes;
      card.closesWith = step.closer === null ? null : group[step.closer].slot;
      card.copyNote = step.text;
      const closing = !!card.completes || card.closesWith !== null;
      card.priority = card.base < 0 ? -1 : (closing ? 4 : 0) + card.base;
      card.core = card.core || closing;
      delete card.base;
    }
  }
  let budget = gold;
  for (const card of [...cards].sort((a, b) => b.priority - a.priority)) {
    if (card.priority < 0) {
      card.action = "ignorar";
      card.reason = "fora do plano atual";
      continue;
    }
    const withSlots = cards
      .filter((s) => s.closesWith === card.slot)
      .map((s) => s.slot);
    card.reason = [
      card.role,
      fillText(card.fill),
      card.completes &&
        card.completes +
          (withSlots.length
            ? ` (com a carta do slot ${withSlots.join(", ")})`
            : ""),
      card.closesWith !== null
        ? `junto com a carta do slot ${card.closesWith}, ${cards.find((s) => s.slot === card.closesWith).completes}`
        : null,
      card.copyNote,
      card.own && !card.completes && card.closesWith === null && !card.copyNote
        ? card.own + " cópia(s) suas"
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (pressure.danger && !card.core && card.role === "cópia de unidade sua") {
      card.action = "segurar";
      card.reason +=
        " · vida em perigo: não fecha estrela agora; o ouro vai para cópias e upgrades do plano";
      continue;
    }
    if (budget === null) {
      card.action = "comprar";
      continue;
    }
    if (budget < card.cost) {
      card.action = "sem ouro";
      continue;
    }
    // Peça da meta que não entra agora e não cabe na reserva lida (cheia, sem substituto para vender): espere.
    if (
      card.core &&
      !card.completes &&
      card.closesWith === null &&
      !have(card.id) &&
      !card.fill &&
      draft.bench.known &&
      draft.bench.free === 0
    ) {
      card.action = "segurar";
      card.reason += " · reserva cheia: venda uma peça antes";
      continue;
    }
    if (
      !card.core &&
      // Só rolando para estabilizar (perigo ainda não estabilizado) a carta secundária pode quebrar os juros.
      !pressure.spend &&
      card.fill?.purpose !== "temporario" &&
      budget - card.cost < interestTier
    ) {
      card.action = "segurar";
      card.reason += " · compraria abaixo de " + interestTier + "g de juros";
      continue;
    }
    card.action = "comprar";
    budget -= card.cost;
  }
  // 2ª passada: só as cartas que o orçamento comprou entram no tabuleiro de agora (vaga, troca ou reserva).
  const final = interimSlots(
      {
        ...iinput,
        shop: shopCards(
          (slot) => cards.find((c) => c.slot === slot)?.action === "comprar",
        ),
      },
      ictx,
    ),
    slotOf = new Map(
      final.slots.filter((s) => s.unit).map((s) => [s.unit.id, s]),
    );
  for (const card of cards) {
    const fill = final.buys.find((b) => b.slot === card.slot) ?? null;
    card.fill = fill;
  }
  const board = boardOf(final),
    playingIds = new Set(board.map((u) => u.id)),
    hold = plan.board
      .filter((u) => have(u.id) && !playingIds.has(u.id))
      .map((u) => entry(u.id, "meta"));
  // Cada compra da meta: entra no lugar do temporário só se o supera em 1★ pela margem (senão vai para a reserva:
  // compre os dois), ou numa vaga livre.
  const buyNow = wanted.map((w) => {
    const s = slotOf.get(w.id),
      bought = s?.playing?.id === w.id && s.playing.source === "loja",
      replaces = bought
        ? (s.replaces?.name ?? null)
        : s?.ifBought?.place === "troca"
          ? (s.ifBought.replaces?.name ?? null)
          : null,
      place = bought
        ? replaces
          ? "troca"
          : "vaga"
        : (s?.ifBought?.place ?? "banco");
    return {
      ...w,
      replaces,
      slot: place,
      // Quem segura a vaga agora (temporário) e quando o titular volta.
      holder:
        s?.kind === "temporario" && s.playing
          ? { id: s.playing.id, name: s.playing.name, stars: s.playing.stars }
          : null,
      until: s?.until ?? null,
    };
  });
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
  // Item pronto no banco: vai só para peça da comp (a build dela pede; o temporário segura o do titular; papel compatível) ou
  // fica guardado. A regra é core/items/scenarios.mjs (bankItemTargets).
  const itemNames = new Map(catalog.items.map((i) => [i.apiName, i.name])),
    kind = itemRole;
  // Mesma lista de itens de build(), Passar itens e dica de emblema (core/items/builds.mjs: a build publicada da comp; sem
  // ela, a reserva); completar componente equipado não gasta slot.
  const wishOf = (id) =>
      wantedItems(id, { comp: plan.meta, metaBuilds: options.metaBuilds }),
    room = new Map(
      board.map((u) => [
        u.id,
        u.slotsFree - u.equipNow.filter((e) => !e.usesHeld).length,
      ]),
    );
  // Só peças da comp recebem item (core/items/scenarios.mjs: bankItemTargets); o temporário só SEGURA o item da build do
  // titular da vaga dele.
  const roleById = new Map(
      (advice?.builds ?? []).map((b) => [b.championId, b.role]),
    ),
    boardIds = new Set(board.map((u) => u.id));
  const bankItems = bankItemTargets({
    items: (options.inventory ?? [])
      .filter((id) => !isComponent(id) && !isConsumable(id))
      .filter(
        (id) =>
          !board.some((u) =>
            u.equipNow.some((e) => e.id === id && !e.used && (e.used = true)),
          ),
      ),
    members: plan.board.map((u) => ({
      id: u.id,
      name: u.name,
      onField: boardIds.has(u.id),
      room: room.get(u.id) ?? 0,
      role: roleById.get(u.id) ?? u.role ?? null,
    })),
    holders: final.slots
      .filter((s) => s.kind === "temporario" && s.playing && s.unit)
      .map((s) => ({
        id: s.playing.id,
        name: s.playing.name,
        // O temporário não tem build própria: a vaga dele são os slots ainda vazios (3 menos os itens que leva).
        room: Math.max(
          0,
          3 - (board.find((u) => u.id === s.playing.id)?.items ?? 3),
        ),
        for: { id: s.unit.id, name: s.unit.name },
      })),
    wish: wishOf,
    fromComp: (id) => !!compBuild(plan.meta, id),
    roleOf: kind,
    carry: plan.carry,
    nameOf: (id) => itemNames.get(id) ?? id,
  });
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
  if (final.note) notes.push(final.note);
  return {
    level,
    board,
    bankItems,
    shop,
    shopRead,
    buyNow,
    bridges,
    hold,
    later,
    goalProgress: {
      onBoard: board.filter((u) => u.status === "meta").length,
      goal: plan.board.length,
    },
    // Modelo por vaga (core/board/interim.mjs): original × quem joga agora (titular, temporário, troca da comp, compra da
    // loja), o motivo e a volta. A Formação e o overlay desenham daqui.
    slots: final.slots,
    interim: {
      margin: final.margin,
      shopKnown: final.shopKnown,
      bench: final.bench,
      buys: final.buys,
      note: final.note,
    },
    odds: odds.map((value, i) => ({ cost: i + 1, value })),
    note: notes.join(" "),
  };
}
