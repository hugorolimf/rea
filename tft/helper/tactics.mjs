import { isContested } from "./economy.mjs";
import { POLICY } from "./core/economy/policy.mjs";
import { anvilPicks, carouselPicks } from "./carousel.mjs";
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
import { itemOptionsOf, itemPriority } from "./core/items/item-priority.mjs";
import { planTargetIds } from "./core/items/scenarios.mjs";
import { spend, takeOne } from "./core/items/stock.mjs";
import { championRole, isAvatar } from "./core/catalog/champions.mjs";
import { traitBook } from "./core/catalog/traits.mjs";
import { starCopies } from "./core/pool/copies.mjs";
import {
  analysisInput,
  interimContext,
  interimSlots,
  slotTransitions,
} from "./core/board/interim.mjs";
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
  // Régua e entradas do substituto temporário (core/board/interim.mjs): as mesmas que a Formação usa.
  const interimCtx = interimContext(catalog, book),
    interimInput = analysisInput(analysis, interimCtx);
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
  // Peças suas fora da comp (campo e reserva) que carregam componentes: fecham receitas dos campeões da comp montadas nelas
  // (core/items/item-priority.mjs `holders`).
  const holdersOutside = (ids) =>
    [...(analysis.self.units ?? []), ...(analysis.self.reserve ?? [])]
      .filter((u) => !ids.has(u.championName) && (u.itemNames ?? []).length)
      .map((u) => ({
        id: u.championName,
        name: byId.get(u.championName)?.name ?? u.championName,
        equipped: u.itemNames ?? [],
      }));
  const build = (c, equipped, coverage, comp = null) =>
      championBuild(c, { equipped, coverage, comp, ctx: buildCtx }),
    item = buildCtx.item;
  // Itens bons de cada campeão na comp, maior ganho primeiro (core/items/item-priority.mjs): a régua de prioridade de
  // "Próximo item", item pronto do banco, "Passar itens" e carrossel.
  const optionsCtx = {
    recipeOf: (id) => items.get(id)?.composition ?? [],
    nameOf: (id) => items.get(id)?.name ?? id,
    // Emblema da sinergia que o campeão já tem não serve a ele.
    blocked: (unitId, itemId) => {
      const t = book.emblems.get(itemId);
      return !!t && (byId.get(unitId)?.traits ?? []).includes(t);
    },
    fallback: (unitId) =>
      wantedItems(unitId, { metaBuilds: options.metaBuilds }),
  };
  const optionsFor = (comp, id) => itemOptionsOf(comp, id, optionsCtx);
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
    // Quem entra e quem segura a vaga: a regra única de core/board/interim.mjs. A tática não lê nível, loja, ouro nem vida
    // (sem nível, as vagas são as peças em campo); a análise final (composeAnalysis) troca estas trocas pelas das vagas da
    // Formação (stage.mjs), calculadas com tudo isso: as duas nunca se contradizem.
    const interim = interimSlots(
      {
        goal: planned,
        carry,
        ...interimInput,
        level: Number.isFinite(options.level) ? options.level : null,
      },
      interimCtx,
    );
    const transitions = slotTransitions(interim.slots);
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
    // Sem preferência pelo carry: quem mais ganha com o melhor item dele na comp primeiro; depois quem tem build na comp,
    // depois tanques.
    const topGain = (u) => optionsFor(comp, u.id)[0]?.gain ?? 0;
    const itemOrder = [...planned].sort(
      (a, b) =>
        topGain(b) - topGain(a) ||
        !!compBuild(comp, b.id) - !!compBuild(comp, a.id) ||
        (b.role === "tank") - (a.role === "tank"),
    );
    const itemPlans = itemOrder.map((u) => ({
      ...build(byId.get(u.id), u.items ?? [], coverage, comp),
      // Itens bons do campeão na comp, maior ganho primeiro (carrossel e prioridade de itens).
      options: optionsFor(comp, u.id),
    }));
    const gainOf = (unitId, itemId) =>
      itemPlans
        .find((b) => b.championId === unitId)
        ?.options.find((o) => o.id === baseItemId(itemId))?.gain ?? 0;
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
          // Quem mais ganha com o emblema na comp leva (o carry não tem preferência nem fica de fora).
          const holders = itemPlans.filter(
            (b) =>
              b.slotsFree > 0 &&
              !traitsOfUnit(
                b.championId,
                planned.find((u) => u.id === b.championId)?.items,
              ).includes(t.name),
          );
          const holder =
            [...holders]
              .filter((b) => gainOf(b.championId, e.id) > 0)
              .sort(
                (a, b) =>
                  gainOf(b.championId, e.id) - gainOf(a.championId, e.id),
              )[0] ??
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
                b.equipped.length === 0,
            )
            // Quem mais ganha com a luva na comp (sem regra de carry).
            .sort(
              (a, b) =>
                gainOf(b.championId, gloves) - gainOf(a.championId, gloves) ||
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
        // Vantagem no campeão: o item de uma peça que fica e o usa só passa para quem ganha mais com ele (por mais que a
        // margem, porque mover gasta removedor); o de peça que sai, ou que não serve a quem o carrega, vai para quem
        // ganha mais.
        const keep = !leaving && own.includes(id),
          here = keep ? gainOf(source.championName, id) : 0;
        const target = itemPlans
          .filter(
            (b) =>
              b.championId !== source.championName &&
              (slotsLeft.get(b.championId) ?? 0) > 0 &&
              wish(b.championId).includes(id) &&
              !b.equipped.some((e) => clean(e.id) === id) &&
              (!keep ||
                gainOf(b.championId, id) > here + POLICY.itemMove.margin),
          )
          // Quem tem mais vantagem com o item recebe.
          .sort(
            (a, b) =>
              gainOf(b.championId, id) - gainOf(a.championId, id) ||
              wish(a.championId).indexOf(id) - wish(b.championId).indexOf(id),
          )[0];
        if (!target) continue;
        slotsLeft.set(target.championId, slotsLeft.get(target.championId) - 1);
        moves.push({
          item: item(id),
          to: { id: target.championId, name: target.name },
          rank: wish(target.championId).indexOf(id) + 1,
          toCarry: target.name === carry,
          // Ganho do item em quem recebe e em quem o carrega (o porquê da troca).
          gain: gainOf(target.championId, id),
          gainFrom: here,
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
          // Primeiro o passe que mais rende: a soma do ganho de cada item em quem o recebe (sem peso extra para o carry).
          priority: moves.reduce(
            (n, m) => n + 1 + 10 * gainOf(m.to.id, m.item.id),
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
    // Carrossel: o componente que fecha um item agora, depois o que começa um item bom; o peso é o ganho do item no
    // campeão nesta comp (`options`). Regra em carousel.mjs.
    const carousel = carouselPicks(itemPlans, {
      carry,
      inventory: options.inventory ?? [],
      covered: coveredByMoves(itemMoves),
      holders: holdersOutside(new Set(planned.map((u) => u.id))),
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
  // Só peças da comp do plano recebem build, "próximo item" e item montado (core/items/scenarios.mjs: planTargetIds);
  // peça fora da comp, em campo ou na reserva, só cede itens ("Passar itens").
  const targetPieces = planTargetIds(target);
  const currentBuilds = analysis.self.units
    .filter((u) => byId.has(u.championName) && targetPieces.has(u.championName))
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
  // O que fazer com os seus itens (core/items/item-priority.mjs): para cada campeão da comp alvo (os titulares; o
  // temporário não), qualquer item bom dele NA COMP que dá para montar ou já está pronto, do maior ganho ao menor, cada
  // componente gasto uma vez e no máximo 3 itens por campeão (slotsFree).
  const inventory = options.inventory ?? [],
    // Item já montado em outro campeão que a comp vai passar para este: não sugerir montar de novo.
    covered = coveredByMoves(target?.itemMoves ?? []),
    equippedOf = new Map(
      analysis.self.units.map((u) => [u.championName, u.itemNames ?? []]),
    ),
    members = adviceBuilds
      .filter((b) => targetIds.has(b.championId))
      .map((b) => ({
        id: b.championId,
        name: b.name,
        stars: b.stars,
        inField: ownedIds.has(b.championId),
        equipped: equippedOf.get(b.championId) ?? [],
        slotsFree: Math.max(
          0,
          (b.slotsFree ?? 3) -
            [...covered].filter((k) => k.startsWith(`${b.championId}:`)).length,
        ),
      })),
    holders = holdersOutside(targetIds),
    priority = itemPriority({
      members,
      optionsOf: (id) => optionsFor(targetComp, id),
      bank: inventory,
      covered,
      holders,
    }),
    { ready, remaining } = priority;
  analysis.ownedItemAdvice = {
    // Dicas de sinergia (e o emblema de cada uma) da comp do plano: o emblema vai para uma peça dela, não do tabuleiro.
    synergyTips: target?.synergyTips ?? analysis.currentPlan?.synergyTips ?? [],
    builds: currentBuilds,
    ready,
    near: priority.near.slice(0, 6),
    // Bigornas do banco como um carrossel de montagem: a ordem de escolha pela mesma régua (carousel.mjs `anvilPicks`).
    anvils: anvilPicks(target?.itemPlans ?? [], {
      inventory,
      covered,
      holders,
    }),
    inventory: inventory.map(item),
    remaining: remaining.map(item),
    source:
      "Itens equipados: snapshot. Itens livres: entrada manual; não foram capturados automaticamente.",
  };
  analysis.matchup = threat;
  return analysis;
}
