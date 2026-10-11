import { isContested } from "./economy.mjs";
import { carouselPicks } from "./carousel.mjs";
import {
  addCoverage,
  baseItemId,
  isEmblemItem,
  isThiefsGloves,
} from "./core/catalog/items.mjs";
import {
  buildContext,
  championBuild,
  compBuild,
  wantedItems,
} from "./core/items/builds.mjs";
import { coveredKeys } from "./core/items/moves.mjs";
import { spend, takeOne } from "./core/items/stock.mjs";
import { championRole, isAvatar } from "./core/catalog/champions.mjs";
import { traitBook } from "./core/catalog/traits.mjs";
import { starCopies, starsForCopies } from "./core/pool/copies.mjs";
/** "campeão:item" de cada item já montado que a comp passa de um campeão para outro (regra: core/items/moves.mjs). */
const coveredByMoves = coveredKeys;
export function tactics(analysis, catalog, options = {}) {
  const byId = new Map(catalog.champions.map((c) => [c.apiName, c]));
  const items = new Map(catalog.items.map((i) => [i.apiName, i]));
  const clean = baseItemId;
  // Cópias repetidas em campo: vale a de mais estrelas (e mais itens), como na reserva.
  const current = new Map();
  for (const u of analysis.self.units) {
    const prev = current.get(u.championName);
    if (
      !prev ||
      u.starLevel > prev.starLevel ||
      (u.starLevel === prev.starLevel &&
        (u.itemNames?.length ?? 0) > (prev.itemNames?.length ?? 0))
    )
      current.set(u.championName, u);
  }
  const reserve = new Map();
  for (const u of analysis.self.reserve ?? []) {
    if (
      !reserve.has(u.championName) ||
      u.starLevel > reserve.get(u.championName).starLevel
    )
      reserve.set(u.championName, u);
  }
  const role = (c) => championRole(c, options.metaRoles);
  const chosen = analysis.opponents.find(
    (p) => String(p.id) === options.viewedPlayerId,
  );
  const enemies = chosen ? [chosen] : analysis.opponents;
  const units = enemies.flatMap((p) => p.units);
  let physical = 0,
    magical = 0,
    heals = 0,
    crit = 0,
    armor = 0,
    resists = 0;
  for (const u of units) {
    const c = byId.get(u.id);
    const weight = u.stars * Math.max(1, u.items.length + 1);
    if (u.role === "ad") physical += weight;
    else if (u.role === "ap") magical += weight;
    if (
      u.items.some((i) =>
        /Bloodthirster|HandOfJustice|SpiritVisage|HextechGunblade|Redemption/.test(
          i,
        ),
      ) ||
      /heal|restore.*health/i.test(c?.ability?.desc ?? "")
    )
      heals++;
    if (u.items.some((i) => /InfinityEdge/.test(i))) crit++;
    if (
      (c?.stats.armor ?? 0) >= 50 ||
      u.items.some((i) => /Bramble|Gargoyle|Steadfast/.test(i))
    )
      armor++;
    if (
      u.items.some((i) => /Dragon|SpiritVisage|Gargoyle|AdaptiveHelm/.test(i))
    )
      resists++;
  }
  const threat = {
    name: chosen ? chosen.name : "Lobby inteiro",
    physicalShare: physical + magical ? physical / (physical + magical) : 0.5,
    healingUnits: heals,
    critUnits: crit,
    armoredUnits: armor,
    resistantUnits: resists,
    method:
      "Inferido por habilidade, estrelas e itens observados; não por dano medido.",
  };
  // Emblemas montáveis (espátula/frigideira + componente) concedem a sinergia do nome a quem equipa.
  // Sinergias de uma peça do plano: as do campeão mais as de emblemas equipados nela (regra única em
  // core/catalog/traits.mjs, a mesma do motor, do servidor e da interface).
  const book = traitBook(catalog);
  const traitsOfUnit = (id, equipped) =>
    book.of(byId.get(id)?.traits ?? [], equipped).traits;
  const emblemByTrait = new Map(book.recipes.map((e) => [e.trait, e]));
  // Build de cada campeão: o motor único de itens (core/items/builds.mjs). Com build publicada na comp, é a da aba
  // Comps (mesmos itens, cópias, emblemas e ordem); sem ela, a reserva declarada (build geral + medição, ajustada pelo lobby).
  const buildCtx = buildContext({
    items,
    role,
    stats: options.stats,
    metaBuilds: options.metaBuilds,
    metaLabel: options.metaLabel,
    inventory: options.inventory ?? [],
    lobby: {
      armor,
      resists,
      heals,
      crit,
      physicalShare: threat.physicalShare,
      strong: units.some((u) => u.stars >= 2 && u.cost >= 3),
    },
    emblemTrait: (id) => book.emblems.get(id) ?? null,
  });
  const build = (c, equipped, coverage, comp = null) =>
      championBuild(c, { equipped, coverage, comp, ctx: buildCtx }),
    item = buildCtx.item;
  // `comp`: a comp do plano ({ builds, buildStats }: a da recomendação ou a fixada); null = tabuleiro sem comp.
  function plan(board, carry, comp = null) {
    // Itens que cada peça pede (a build publicada da comp; sem ela, a reserva): Passar itens, emblema e loja usam a mesma.
    const wish = (id) =>
      wantedItems(id, { comp, metaBuilds: options.metaBuilds });
    const planned = board.map((u) => {
      const c = byId.get(u.id);
      const pool = analysis.pool.find((p) => p.name === u.name),
        reroll =
          u.name === carry &&
          u.cost <= 2 &&
          (pool?.remainingUpper ?? 0) >=
            Math.max(0, starCopies(3) - (pool?.own ?? 0)) &&
          !isContested(pool);
      const targetStars = Math.max(u.owned ? u.stars : 1, reroll ? 3 : 2);
      return {
        ...u,
        currentStars: u.owned ? u.stars : 0,
        targetStars,
        range: c?.stats.range ?? 1,
        role: c ? role(c) : u.role,
      };
    });
    const occupied = new Set(),
      positions = [];
    const columns =
      options.side === "left" ? [1, 0, 2, 3, 4, 5, 6] : [5, 6, 4, 3, 2, 1, 0];
    function place(u, row, cols) {
      let cell;
      for (const r of [
        row,
        ...(row === 3 ? [2, 1, 0] : [0, 1, 2, 3].filter((r) => r !== row)),
      ]) {
        for (const col of cols) {
          if (!occupied.has(r + ":" + col)) {
            cell = { row: r, col };
            break;
          }
        }
        if (cell) break;
      }
      occupied.add(cell.row + ":" + cell.col);
      positions.push({
        ...cell,
        championId: u.id,
        name: u.name,
        stars: u.stars,
        currentStars: u.currentStars,
        targetStars: u.targetStars,
        role: u.role,
        reason:
          u.role === "tank"
            ? "Absorver o primeiro contato e proteger a equipe."
            : u.range >= 3
              ? "Manter alcance e proteção atrás da frontline."
              : "Entrar na luta sem receber sozinho todo o foco.",
      });
    }
    const ranged = planned
      .filter((u) => u.range >= 3)
      .sort((a, b) => (b.name === carry) - (a.name === carry));
    const frontline = planned
      .filter((u) => u.range < 3)
      .sort(
        (a, b) =>
          (b.role === "tank") - (a.role === "tank") ||
          (b.stars ?? 1) - (a.stars ?? 1),
      );
    for (const u of frontline)
      place(u, u.role === "tank" ? 0 : 1, [3, 2, 4, 1, 5, 0, 6]);
    for (const u of ranged) place(u, 3, columns);
    const incoming = planned.filter((u) => !current.has(u.id));
    const outgoing = analysis.self.units.filter(
      (u) => !planned.some((p) => p.id === u.championName),
    );
    const available = [...outgoing];
    const transitions = incoming.map((u) => {
      let i = available.findIndex((o) => {
        const c = byId.get(o.championName);
        return c && role(c) === u.role;
      });
      if (i < 0) i = available.length ? 0 : -1;
      const out = i >= 0 ? available.splice(i, 1)[0] : null;
      return {
        enter: { id: u.id, name: u.name },
        exit: out
          ? { id: out.championName, name: out.name, items: out.itemNames }
          : null,
        source: reserve.has(u.id) ? "reserve" : "shop",
        reason: reserve.has(u.id)
          ? "Já está na reserva informada. Prepare para entrar no campo, respeitando seu nível e os itens da unidade que sai."
          : out
            ? "Troca proposta para chegar à comp; compre e prepare a substituta antes de reservar a atual."
            : "Adicionar quando houver slot livre no seu nível.",
      };
    });
    // Força de uma unidade em campo: custo ponderado pelas estrelas, mais itens. Uma 2★ vale bem mais que a mesma 1★.
    const STAR = [0, 1, 1.8, 3.2],
      power = (cost, stars, items) =>
        cost * STAR[Math.max(0, Math.min(3, stars))] + items * 0.6;
    for (const t of transitions) {
      if (!t.exit) continue;
      const out = analysis.self.units.find((u) => u.championName === t.exit.id),
        outCost = byId.get(t.exit.id)?.cost ?? out?.price ?? 1,
        outStars = out?.starLevel ?? 1,
        outPower = power(outCost, outStars, out?.itemNames?.length ?? 0);
      const enterCost = byId.get(t.enter.id)?.cost ?? 1,
        copies = analysis.pool.find((p) => p.name === t.enter.name)?.own ?? 0,
        haveStars = starsForCopies(copies);
      // Os itens de quem sai passam para quem entra, então a comparação é só de corpo: custo e estrelas.
      const body = power(outCost, outStars, 0);
      let required = 1;
      while (required <= 3 && power(enterCost, required, 0) < body * 0.9)
        required++;
      Object.assign(t, {
        exitStars: outStars,
        exitPower: Math.round(outPower * 10) / 10,
        enterCopies: copies,
        enterStars: haveStars,
        requiredStars: required > 3 ? null : required,
        ready: required <= 3 && haveStars >= required,
      });
      if (t.ready)
        t.reason = `Pode trocar: ${t.enter.name} ${haveStars}★ já vale ${t.exit.name} ${outStars}★. Passe os itens na troca.`;
      else if (required > 3)
        t.reason = `Não troque: ${t.enter.name} (custo ${enterCost}) não alcança ${t.exit.name} ${outStars}★ (custo ${outCost}) nem em 3★. Mantenha ${t.exit.name}.`;
      else
        t.reason = `Segure ${t.exit.name} ${outStars}★ em campo. Só troque quando ${t.enter.name} estiver ${required}★ (você tem ${copies} de ${starCopies(required)} cópias).`;
    }
    const { counts, byEmblem } = book.tally(
      planned.map((u) => ({
        traits: byId.get(u.id)?.traits ?? [],
        items: u.items,
      })),
    );
    const traits = [...counts].map(([name, count]) => {
      const { active, next } = book.status(name, count);
      return {
        name,
        count,
        // Peças que contam para a sinergia só por um emblema equipado.
        emblem: byEmblem.get(name) ?? 0,
        active,
        next,
      };
    });
    const coverage = new Set();
    for (const u of planned) addCoverage(coverage, u.items);
    // Carry primeiro; depois quem tem build na comp (fica com os efeitos dela), depois tanques.
    const itemOrder = [...planned].sort(
      (a, b) =>
        (b.name === carry) - (a.name === carry) ||
        !!compBuild(comp, b.id) - !!compBuild(comp, a.id) ||
        (b.role === "tank") - (a.role === "tank"),
    );
    const itemPlans = itemOrder.map((u) =>
      build(byId.get(u.id), u.items ?? [], coverage, comp),
    );
    const traitOf = new Map(traits.map((t) => [t.name, t])),
      stockAll = options.inventory ?? [];
    for (const b of itemPlans)
      b.synergies = traitsOfUnit(
        b.championId,
        planned.find((u) => u.id === b.championId)?.items,
      )
        .map((n) => traitOf.get(n))
        .filter(Boolean)
        .map((t) => ({
          name: t.name,
          count: t.count,
          active: t.active,
          next: t.next,
        }));
    // Sinergia a uma unidade do próximo patamar: quem comprar, ou qual emblema montar e em quem.
    const synergyTips = traits
      .filter((t) => t.next && t.next - t.count === 1)
      .map((t) => {
        const units = catalog.champions
          .filter(
            (c) =>
              c.traits.includes(t.name) &&
              !isAvatar(c) &&
              !planned.some((p) => p.id === c.apiName),
          )
          .sort((a, b) => a.cost - b.cost)
          .slice(0, 3)
          .map((c) => ({ id: c.apiName, name: c.name, cost: c.cost }));
        const e = emblemByTrait.get(t.name);
        let emblem = null;
        if (e) {
          const holders = itemPlans.filter(
            (b) =>
              b.slotsFree > 0 &&
              b.name !== carry &&
              !traitsOfUnit(
                b.championId,
                planned.find((u) => u.id === b.championId)?.items,
              ).includes(t.name),
          );
          const holder =
            holders.find((b) => wish(b.championId).includes(e.id)) ??
            holders.find((b) => b.role === "tank") ??
            holders[0] ??
            null;
          const { missing } = spend(stockAll, e.parts);
          emblem = {
            ...item(e.id),
            holder: holder?.name ?? null,
            holderId: holder?.championId ?? null,
            craftable: stockAll.includes(e.id) || missing.length === 0,
            missing: missing.map(item),
          };
          if (holder && emblem.craftable)
            holder.synergyItem = { ...emblem, trait: t.name, to: t.next };
        }
        return {
          trait: t.name,
          count: t.count,
          next: t.next,
          activeNow: t.active,
          units,
          emblem,
        };
      })
      .sort(
        (a, b) =>
          Number(!!b.emblem?.craftable) - Number(!!a.emblem?.craftable) ||
          Number(b.activeNow) - Number(a.activeNow) ||
          b.count - a.count,
      )
      .slice(0, 5);
    // Mudanças de item: item em unidade que sai da comp, ou que não está na build de quem o carrega, vai para
    // quem o usa melhor entre as unidades que já estão em campo. Um removedor tira todos os itens de uma unidade.
    const slotsLeft = new Map(
      itemPlans
        .filter((b) => current.has(b.championId))
        .map((b) => [b.championId, b.slotsFree]),
    );
    const itemMoves = [];
    for (const source of analysis.self.units) {
      const held = (source.itemNames ?? [])
        .map(clean)
        .filter((id) => !isEmblemItem(id) && !isThiefsGloves(id));
      const gloves = (source.itemNames ?? []).find(isThiefsGloves);
      if (gloves) {
        // a luva vai inteira, e só para quem está sem nenhum item
        if (!planned.some((p) => p.id === source.championName)) {
          const target = itemPlans
            .filter(
              (b) =>
                b.championId !== source.championName &&
                current.has(b.championId) &&
                b.equipped.length === 0 &&
                b.name !== carry,
            )
            .sort(
              (a, b) =>
                Number(wish(b.championId).includes(gloves)) -
                Number(wish(a.championId).includes(gloves)),
            )[0];
          if (target) {
            slotsLeft.set(target.championId, 0);
            itemMoves.push({
              from: {
                id: source.championName,
                name: source.name,
                stars: source.starLevel,
              },
              leaving: true,
              moves: [
                {
                  item: item(gloves),
                  to: { id: target.championId, name: target.name },
                  rank: wish(target.championId).indexOf(gloves) + 1,
                  toCarry: false,
                },
              ],
              priority: 3,
            });
          }
        }
        continue;
      }
      if (!held.length) continue;
      const leaving = !planned.some((p) => p.id === source.championName),
        own = wish(source.championName),
        moves = [];
      for (const id of held) {
        if (!leaving && own.includes(id)) continue;
        const target = itemPlans
          .filter(
            (b) =>
              b.championId !== source.championName &&
              (slotsLeft.get(b.championId) ?? 0) > 0 &&
              wish(b.championId).includes(id) &&
              !b.equipped.some((e) => clean(e.id) === id),
          )
          .sort(
            (a, b) =>
              Number(b.name === carry) - Number(a.name === carry) ||
              wish(a.championId).indexOf(id) - wish(b.championId).indexOf(id),
          )[0];
        if (!target) continue;
        slotsLeft.set(target.championId, slotsLeft.get(target.championId) - 1);
        moves.push({
          item: item(id),
          to: { id: target.championId, name: target.name },
          rank: wish(target.championId).indexOf(id) + 1,
          toCarry: target.name === carry,
        });
      }
      if (moves.length)
        itemMoves.push({
          from: {
            id: source.championName,
            name: source.name,
            stars: source.starLevel,
          },
          leaving,
          moves,
          priority: moves.reduce(
            (n, m) => n + (m.toCarry ? 5 : 2) + (4 - Math.min(4, m.rank)),
            0,
          ),
        });
    }
    itemMoves.sort((a, b) => b.priority - a.priority);
    const removers = Number.isInteger(options.removers)
      ? options.removers
      : null;
    itemMoves.forEach((move, index) => {
      move.method = options.hasRemover
        ? "removedor"
        : removers === null
          ? "removedor (banco não lido)"
          : index < removers
            ? "removedor"
            : move.leaving
              ? "vender a unidade quando a substituta entrar"
              : "sem removedor disponível";
      // Unidade que fica só troca agora com removedor; a que sai, quando a substituta já pode entrar.
      move.now =
        move.method !== "sem removedor disponível" &&
        (!move.leaving ||
          transitions.find((t) => t.exit?.id === move.from.id)?.ready === true);
    });
    // Carrossel: o componente que fecha um item agora, depois o que começa o próximo item de quem mais
    // importa (carry, tanque, demais), com o banco distribuído entre as builds. Regra em carousel.mjs.
    const carousel = carouselPicks(itemPlans, {
      carry,
      inventory: options.inventory ?? [],
      covered: coveredByMoves(itemMoves),
    });
    return {
      carry: carry ?? planned[0]?.name,
      carousel,
      positions,
      transitions,
      traits,
      synergyTips,
      itemMoves,
      removers,
      itemPlans,
      board: planned,
      positionNote:
        "Proposta heurística; posições reais dos adversários, alcance de todas as habilidades e regras especiais de adjacency não foram capturados. Espelhe para proteger o carry após observar a arena.",
    };
  }
  for (const r of analysis.recommendations)
    Object.assign(r, plan(r.board, r.carry, r.meta ?? null));
  if (options.previewIds?.length) {
    const board = options.previewIds.map((id) => {
      const c = byId.get(id),
        u = current.get(id) ?? reserve.get(id);
      return {
        id,
        name: c.name,
        cost: c.cost,
        traits: c.traits,
        owned: !!u,
        inReserve: !current.has(id) && reserve.has(id),
        stars: u?.starLevel ?? 1,
        items: u?.itemNames ?? [],
      };
    });
    // Comp de meta fixada: usa as builds dela, como nas sugestões.
    analysis.preview = plan(
      board,
      board.find((u) => u.id === options.goalCarryId)?.name ??
        board.find((u) => byId.get(u.id).stats.range >= 3)?.name,
      options.goalComp ?? null,
    );
  }
  const observedBoard = analysis.self.units
    .filter((u) => byId.has(u.championName))
    .map((u) => {
      const c = byId.get(u.championName);
      return {
        id: u.championName,
        name: c.name,
        cost: c.cost,
        traits: c.traits,
        owned: true,
        stars: u.starLevel,
        items: u.itemNames ?? [],
      };
    });
  const goalCarry =
    analysis.preview?.carry ?? analysis.recommendations[0]?.carry;
  const currentCarry =
    observedBoard.find((u) => u.name === goalCarry) ??
    [...observedBoard].sort(
      (a, b) =>
        b.items.length - a.items.length || b.stars * b.cost - a.stars * a.cost,
    )[0];
  analysis.currentPlan = observedBoard.length
    ? plan(observedBoard, currentCarry?.name)
    : null;
  // Free items are caller-confirmed; equipped items remain attached to their observed owner.
  const coverage = new Set();
  for (const u of analysis.self.units) addCoverage(coverage, u.itemNames);
  // Próximo item / Montar agora seguem a build da comp alvo (a mesma dos planos); quem não está nela usa a reserva.
  // O preview ainda não tem `meta` (o servidor põe depois): as builds vêm da comp fixada.
  const target = analysis.preview ?? analysis.recommendations[0] ?? null,
    targetComp = analysis.preview
      ? (options.goalComp ?? null)
      : (target?.meta ?? null);
  const currentBuilds = analysis.self.units
    .filter((u) => byId.has(u.championName))
    .map((u) => ({
      ...build(
        byId.get(u.championName),
        u.itemNames ?? [],
        coverage,
        targetComp,
      ),
      stars: u.starLevel,
    }));
  for (const b of currentBuilds) {
    const planned = analysis.currentPlan?.itemPlans.find(
      (p) => p.championId === b.championId,
    );
    b.synergies = planned?.synergies ?? [];
    b.synergyItem = planned?.synergyItem ?? null;
  }
  // O que montar com o banco vale para a comp alvo inteira: as peças em campo e também as que ainda
  // vão entrar (o item fica guardado para elas). Cada campeão recebe no máximo 3 itens (slotsFree).
  const targetIds = new Set((target?.board ?? []).map((u) => u.id)),
    ownedIds = new Set(currentBuilds.map((b) => b.championId)),
    adviceBuilds = [
      ...currentBuilds,
      ...(target?.itemPlans ?? [])
        .filter((p) => !ownedIds.has(p.championId))
        .map((p) => ({ ...p, stars: 0 })),
    ];
  const inventory = options.inventory ?? [],
    remaining = [...inventory],
    choices = [],
    // Item já montado em outro campeão que a comp vai passar para este: não sugerir montar de novo.
    covered = coveredByMoves(target?.itemMoves ?? []);
  for (const b of adviceBuilds)
    for (const candidate of b.additions) {
      if (covered.has(`${b.championId}:${candidate.id}`)) continue;
      const parts = candidate.components.map((i) => i.id);
      if (candidate.usesHeld) takeOne(parts, candidate.usesHeld);
      const required = inventory.includes(candidate.id)
        ? [candidate.id]
        : parts;
      const { missing } = spend(inventory, required);
      const inField = ownedIds.has(b.championId),
        inGoal = targetIds.has(b.championId);
      choices.push({
        championId: b.championId,
        champion: b.name,
        stars: b.stars,
        inField,
        inGoal,
        item: candidate,
        required,
        missing,
        ready: required.length > 0 && !missing.length,
        // Carry da comp primeiro; peça em campo da comp antes da que ainda vai entrar; temporária por último.
        rank:
          candidate.score +
          (required.length - missing.length) * 20 +
          (required.length && !missing.length ? 60 : 0) +
          (b.name === target?.carry ? 25 : 0) +
          (inGoal ? (inField ? 10 : 4) : -15),
      });
    }
  choices.sort((a, b) => b.rank - a.rank);
  const slots = new Map(adviceBuilds.map((b) => [b.championId, b.slotsFree]));
  for (const key of covered) {
    const id = key.split(":")[0];
    if (slots.has(id)) slots.set(id, Math.max(0, slots.get(id) - 1));
  }
  const ready = [];
  for (const c of choices) {
    // Completar um componente já equipado não ocupa slot novo.
    const needsSlot = !c.item.usesHeld;
    if (!c.ready || (needsSlot && !slots.get(c.championId))) continue;
    // Cada cópia do banco serve a um item só: o que já foi dado a um item anterior não sobra para este.
    const spent = spend(remaining, c.required);
    if (spent.missing.length) continue;
    remaining.splice(0, remaining.length, ...spent.left);
    if (needsSlot) slots.set(c.championId, slots.get(c.championId) - 1);
    ready.push(c);
  }
  analysis.ownedItemAdvice = {
    synergyTips: analysis.currentPlan?.synergyTips ?? [],
    builds: currentBuilds,
    ready,
    near: choices
      .filter(
        (c) => !c.ready && c.missing.length === 1 && c.required.length > 1,
      )
      .slice(0, 6),
    inventory: inventory.map(item),
    remaining: remaining.map(item),
    source:
      "Itens equipados: snapshot. Itens livres: entrada manual; não foram capturados automaticamente.",
  };
  analysis.matchup = threat;
  return analysis;
}
