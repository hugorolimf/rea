import { POOL, ODDS } from "./rules.mjs";
import { rollLevelOf, isContested } from "./economy.mjs";
import { itemEdge, tierOf } from "./item-edge.mjs";
export { POOL, ODDS };
const STICKY_BONUS = 10;
export function analyze(snapshot, catalog, options) {
  const level = options.level;
  const boardLevel = options.targetLevel ?? level;
  const byId = new Map(catalog.champions.map((c) => [c.apiName, c]));
  const key = (c) => (c.traits.includes("Avatar") ? "Lux" : c.name);
  const candidates = catalog.champions.filter(
    (c) => !c.traits.includes("Avatar"),
  );
  const allPools = new Map();
  for (const c of catalog.champions) allPools.set(key(c), c.cost);
  const self = snapshot.statsBlock.players.find(
    (p) => String(p.playerId) === String(options.playerId),
  );
  if (!self) throw Error("Selecione o seu jogador.");
  const alive = snapshot.statsBlock.players.filter(
    (p) => p === self || p.health > 0,
  );
  const visible = new Map(),
    enemy = new Map(),
    own = new Map(),
    rivals = new Map();
  const unknown = new Set();
  function count(pieces, mine, label, isBoard = true) {
    for (const u of pieces ?? []) {
      const c = byId.get(u.championName);
      if (!c) {
        unknown.add(u.championName);
        continue;
      }
      const n = 3 ** (u.starLevel - 1) * (u.quantity ?? 1),
        k = key(c);
      visible.set(k, (visible.get(k) ?? 0) + n);
      if (mine) {
        const prev = own.get(k);
        own.set(k, {
          champion: c,
          copies: (prev?.copies ?? 0) + n,
          stars: Math.max(prev?.stars ?? 0, u.starLevel),
          items: [...(prev?.items ?? []), ...(u.itemNames ?? [])],
          onBoard: isBoard || prev?.onBoard,
        });
      } else {
        enemy.set(k, (enemy.get(k) ?? 0) + n);
        const names = rivals.get(k) ?? new Set();
        names.add(label);
        rivals.set(k, names);
      }
    }
  }
  for (const p of alive)
    count(p.boardPieces, p === self, p.riotIdGameName ?? p.summonerName);
  for (const u of options.bench ?? []) {
    const p = alive.find((p) => String(p.playerId) === String(u.playerId));
    if (p) count([u], p === self, p.riotIdGameName ?? p.summonerName, false);
  }
  const free = (k) =>
    Math.max(0, POOL[allPools.get(k)] - (visible.get(k) ?? 0));
  const pool = [...allPools].map(([name, cost]) => ({
    name,
    cost,
    total: POOL[cost],
    own: own.get(name)?.copies ?? 0,
    enemy: enemy.get(name) ?? 0,
    remainingUpper: free(name),
    rivals: [...(rivals.get(name) ?? [])],
  }));
  const denomByCost = {};
  for (const p of pool)
    denomByCost[p.cost] = (denomByCost[p.cost] ?? 0) + p.remainingUpper;
  function probability(c, atLevel = level) {
    const denom = denomByCost[c.cost] ?? 0;
    return denom
      ? ((ODDS[atLevel][c.cost - 1] / 100) * free(key(c))) / denom
      : 0;
  }
  for (const entry of pool) {
    const c = catalog.champions.find((c) => key(c) === entry.name);
    entry.chancePerSlot = c ? probability(c) : 0;
    entry.chancePerShop = 1 - (1 - entry.chancePerSlot) ** 5;
  }
  const roleCache = new Map();
  function role(c) {
    let r = roleCache.get(c);
    if (!r) {
      r = computeRole(c);
      roleCache.set(c, r);
    }
    return r;
  }
  function computeRole(c) {
    const known = options.metaRoles?.get(c.apiName);
    if (known) return known;
    const desc = (c.ability?.desc ?? "").toLowerCase();
    if (c.stats.range <= 2 && /shield|health|heal|durability|resist/.test(desc))
      return "tank";
    return /physical damage/.test(desc) && !/magic damage/.test(desc)
      ? "ad"
      : "ap";
  }
  function itemRole(id) {
    if (
      /Steadfast|SpiritVisage|Warmog|Gargoyle|Dragon|Bramble|Redemption|Sunfire|AdaptiveHelm/.test(
        id,
      )
    )
      return "tank";
    if (/InfinityEdge|Deathblade|LastWhisper|Runaans|GiantSlayer/.test(id))
      return "ad";
    if (/Rabadon|Archangel|Jeweled|VoidStaff|Nashor|Shojin|BlueBuff/.test(id))
      return "ap";
    return "flex";
  }
  const equippedItems = [...own.values()].flatMap((u) => u.items);
  const ownedItems = [...equippedItems, ...(options.inventory ?? [])];
  // Estoque para medir builds: itens completos (equipados ou no banco) e componentes livres no banco.
  const isComponent = (id) => id.startsWith("DA_Component_");
  const itemStock = {
      completed: ownedItems.filter((id) => !isComponent(id)),
      components: (options.inventory ?? []).filter(isComponent),
    },
    recipes = new Map(
      catalog.items
        .filter((i) => i.composition?.length === 2)
        .map((i) => [i.apiName, i.composition]),
    );
  const itemProfile = { ad: 0, ap: 0, tank: 0, flex: 0 };
  for (const i of ownedItems) {
    if (/Component_/.test(i)) {
      if (/BFSword/.test(i)) itemProfile.ad += 1.2;
      else if (/NeedlesslyLargeRod|TearOfTheGoddess/.test(i))
        itemProfile.ap += 1.2;
      else if (/RecurveBow/.test(i)) {
        itemProfile.ad += 0.8;
        itemProfile.ap += 0.4;
      } else if (/GiantsBelt|ChainVest|NegatronCloak/.test(i))
        itemProfile.tank += 1;
      else itemProfile.flex += 0.5;
    } else itemProfile[itemRole(i)]++;
  }
  const freeItems = options.inventory ?? [],
    itemCatalog = new Map(catalog.items.map((i) => [i.apiName, i]));
  const readyRecipes = catalog.items
    .filter(
      (i) =>
        i.apiName.startsWith("DA_") &&
        i.composition?.length === 2 &&
        !/Emblem|Radiant/.test(i.apiName),
    )
    .filter((i) => {
      const stock = [...freeItems];
      for (const id of i.composition) {
        const at = stock.indexOf(id);
        if (at < 0) return false;
        stock.splice(at, 1);
      }
      return true;
    });
  const freeProfile = { ad: 0, ap: 0, tank: 0, flex: 0 };
  for (const id of freeItems)
    if (!/Component_/.test(id)) freeProfile[itemRole(id)]++;
  // Recipes represent alternatives, not simultaneously spendable items.
  for (const r of ["ad", "ap", "tank"])
    if (readyRecipes.some((i) => itemRole(i.apiName) === r))
      freeProfile[r] += 1.5;
  const patchBias = {
    Camille: 0.3,
    Varus: 0.5,
    Alistar: 0.8,
    Gromp: 0.8,
    Murkwolf: 0.4,
    Warwick: 0.5,
    "Mama Beak": 0.5,
    Xayah: 0.4,
    Rakan: 0.4,
    Kayle: 0.3,
    Shen: 0.3,
    Veigar: -0.4,
  }; // Small qualitative priors from Riot 18.4 + October 7 B-patch, not win rates.
  const rivalItems = alive
    .filter((p) => p !== self)
    .flatMap((p) => p.boardPieces)
    .flatMap((u) => u.itemNames ?? []);
  const armorCount = rivalItems.filter((i) =>
      /Bramble|Gargoyle|Steadfast/.test(i),
    ).length,
    mrCount = rivalItems.filter((i) => /Dragon|Gargoyle/.test(i)).length;
  // Cada item seu precisa de um portador de papel compatível com slot livre na comp alvo; componente livre vale meio item.
  const holderRole = (id) =>
    /Component_/.test(id)
      ? /BFSword|RecurveBow/.test(id)
        ? "ad"
        : /NeedlesslyLargeRod|TearOfTheGoddess/.test(id)
          ? "ap"
          : /GiantsBelt|ChainVest|NegatronCloak/.test(id)
            ? "tank"
            : "flex"
      : itemRole(id);
  function itemFit(board) {
    const names = new Set(board.map(key)),
      demand = { ad: 0, ap: 0, tank: 0, flex: 0 },
      cap = { ad: 0, ap: 0, tank: 0 };
    for (const c of board)
      cap[role(c)] += Math.max(0, 3 - (own.get(key(c))?.items.length ?? 0));
    for (const [k, u] of own)
      if (!names.has(k)) for (const id of u.items) demand[holderRole(id)]++;
    for (const id of freeItems)
      demand[holderRole(id)] += /Component_/.test(id) ? 0.5 : 1;
    let placed = 0,
      spare = 0;
    for (const r of ["ad", "ap", "tank"]) {
      const n = Math.min(demand[r], cap[r]);
      placed += n;
      spare += cap[r] - n;
    }
    placed += Math.min(demand.flex, spare);
    const total = demand.ad + demand.ap + demand.tank + demand.flex;
    return { placed, orphans: total - placed };
  }
  const traitMap = new Map(catalog.traits.map((t) => [t.name, t]));
  const thresholdCache = new Map();
  const thresholdsOf = (name) => {
    let t = thresholdCache.get(name);
    if (!t) {
      t = (traitMap.get(name)?.effects ?? [])
        .map((e) => e.minUnits)
        .filter((n) => n <= 12);
      thresholdCache.set(name, t);
    }
    return t;
  };
  function traits(board) {
    const counts = {};
    for (const c of board)
      for (const t of c.traits) counts[t] = (counts[t] ?? 0) + 1;
    return Object.entries(counts).map(([name, count]) => {
      const thresholds = thresholdsOf(name);
      const reached = thresholds.filter((n) => n <= count);
      return {
        name,
        count,
        active: reached.length > 0,
        solo: thresholds[0] === 1,
        tier: reached.length,
        next: thresholds.find((n) => n > count) ?? null,
      };
    });
  }
  // Parcelas que dependem só do campeão são calculadas uma vez; a busca chama score() dezenas de milhares de vezes.
  const termCache = new Map();
  function unitTerms(c) {
    let s = termCache.get(c);
    if (s) return s;
    const u = own.get(key(c)),
      r = role(c),
      onhit = /attacks|per attack|soldier|attack speed/i.test(
        c.ability?.desc ?? "",
      );
    const matching = (u?.items ?? []).filter(
      (id) => itemRole(id) === r || itemRole(id) === "flex",
    ).length;
    s = {
      preservation: u
        ? 0.6 + Math.log2(u.copies + 1) * 0.35 + u.items.length * 0.3
        : 0,
      strength: Math.pow(c.cost, 1.25) * 2,
      dispute: ((enemy.get(key(c)) ?? 0) / POOL[c.cost]) * 8,
      access: Math.log(1 + probability(c, boardLevel) * 100) * 0.7,
      items:
        matching * 1.1 +
        (onhit && (u?.items ?? []).some((id) => /Guinsoo|Nashor/.test(id))
          ? 1
          : 0),
      matchup: (r === "ap" ? armorCount : r === "ad" ? mrCount : 0) * 0.35,
      patch: patchBias[c.name] ?? 0,
    };
    termCache.set(c, s);
    return s;
  }
  function score(board, focus) {
    let preservation = 0,
      strength = 0,
      dispute = 0,
      items = 0,
      access = 0,
      matchup = 0,
      patch = 0;
    for (const c of board) {
      const s = unitTerms(c);
      preservation += s.preservation;
      strength += s.strength;
      dispute += s.dispute;
      access += s.access;
      items += s.items;
      matchup += s.matchup;
      patch += s.patch;
    }
    const damageRoles = new Set(
      board.filter((c) => role(c) !== "tank").map(role),
    );
    for (const r of damageRoles)
      items +=
        Math.min(3, itemProfile[r]) * 2 + Math.min(3, freeProfile[r]) * 2;
    const tankCount = board.filter((c) => role(c) === "tank").length;
    if (tankCount)
      items +=
        Math.min(tankCount * 2, itemProfile.tank) * 1.5 +
        Math.min(2, freeProfile.tank);
    const fit = itemFit(board);
    items += fit.placed * 1.5 - fit.orphans * 4;
    const ts = traits(board);
    const synergy = ts.reduce(
      (n, t) =>
        n +
        (t.active && !t.solo ? 4 + t.tier * 3 : 0) +
        (t.next ? (t.count / t.next) * 0.8 : 0) +
        (t.name === focus ? t.count * 1.2 : 0),
      0,
    );
    const tanks = board.filter((c) => role(c) === "tank").length,
      ranged = board.filter((c) => c.stats.range >= 3).length;
    const balance =
      -Math.max(0, Math.min(3, Math.floor(boardLevel / 3)) - tanks) * 6 -
      (ranged === 0 ? 9 : 0);
    return {
      total:
        preservation +
        strength +
        synergy +
        items +
        access +
        balance +
        matchup +
        patch -
        dispute,
      orphanItems: fit.orphans,
      matchup,
      patch,
      preservation,
      strength,
      synergy,
      items,
      access,
      balance,
      dispute,
    };
  }
  const available = candidates.filter(
    (c) =>
      own.has(key(c)) ||
      (free(key(c)) > 0 &&
        ODDS[boardLevel][c.cost - 1] >= 10 &&
        (c.cost < 5 || boardLevel >= 9)),
  );
  if (!options.metaComps?.length && available.length < boardLevel)
    throw Error(
      `Não há ${boardLevel} campeões distintos acessíveis para montar a meta neste snapshot.`,
    );
  // Com comps de meta disponíveis, elas são as candidatas: a força vem da colocação média real, e o estado da
  // partida (o que você já tem, itens, disputa na pool, acesso na loja, lobby) decide qual delas encaixa melhor.
  // Quanto dos itens que a comp pede você já tem: item pronto ou montável com seus componentes vale 1,
  // metade de receita vale 0,35. O carry pesa muito mais que o resto; cada item seu só é contado uma vez.
  function buildFit(m, carry) {
    const stock = [...ownedItems];
    const take = (id) => {
      const at = stock.indexOf(id);
      if (at >= 0) {
        stock.splice(at, 1);
        return 1;
      }
      const recipe = itemCatalog.get(id)?.composition ?? [];
      if (recipe.length !== 2) return 0;
      const rest = [...stock];
      let got = 0;
      for (const part of recipe) {
        const k = rest.indexOf(part);
        if (k >= 0) {
          rest.splice(k, 1);
          got++;
        }
      }
      if (got === 2) {
        stock.splice(0, stock.length, ...rest);
        return 1;
      }
      return got ? 0.35 : 0;
    };
    const wanted = m.builds?.[carry.apiName] ?? [];
    let carryHits = 0,
      otherHits = 0;
    for (const id of wanted) carryHits += take(id);
    for (const [unit, ids] of Object.entries(m.builds ?? {}))
      if (unit !== carry.apiName) for (const id of ids) otherHits += take(id);
    // Itens de dano físico não servem a carry mágico e vice-versa; a diferença entre os dois perfis vira penalidade.
    const r = role(carry),
      lean =
        itemProfile.ad + freeProfile.ad - (itemProfile.ap + freeProfile.ap),
      mismatch =
        r === "ap" && lean >= 2 ? lean : r === "ad" && lean <= -2 ? -lean : 0;
    return {
      carryHits,
      carryWanted: wanted.length,
      otherHits,
      mismatch,
      points: carryHits * 6 + otherHits * 1.2 - Math.min(18, mismatch * 4),
    };
  }
  // Crescer a comp: quando seu nível passa do tamanho dela, cada vaga extra recebe a unidade que mais soma —
  // novo patamar de sinergia primeiro, depois custo, unidade que já é sua e pouca disputa. Só entra o que a
  // loja do seu nível oferece (>=10% por slot) ou o que você já tem.
  function extend(base, size) {
    const out = [...base],
      added = [];
    while (out.length < size) {
      const before = traits(out);
      const pick = candidates
        .filter(
          (c) =>
            !out.includes(c) &&
            (own.has(key(c)) ||
              (free(key(c)) > 0 && ODDS[level][c.cost - 1] >= 10)),
        )
        .map((c) => {
          const gained = traits([...out, c])
              .filter(
                (t) =>
                  !t.solo &&
                  t.tier > (before.find((b) => b.name === t.name)?.tier ?? 0),
              )
              .map((t) => t.name),
            u = own.get(key(c));
          return {
            c,
            gained,
            value:
              gained.length * 8 +
              c.cost * 1.5 +
              (u ? 4 + u.stars : 0) -
              ((enemy.get(key(c)) ?? 0) / POOL[c.cost]) * 6,
          };
        })
        .sort((a, b) => b.value - a.value)[0];
      if (!pick) break;
      out.push(pick.c);
      added.push({
        id: pick.c.apiName,
        name: pick.c.name,
        cost: pick.c.cost,
        slot: out.length,
        gained: pick.gained,
        owned: own.has(key(pick.c)),
      });
    }
    return { board: out, added };
  }
  const growTo = Math.min(10, Math.max(level, boardLevel));
  const selected = [];
  // Todas as comps de meta com o encaixe nesta partida, para a tela de seleção (as 3 sugeridas são um recorte).
  let compRanking = [];
  if (options.metaComps?.length) {
    const ranked = options.metaComps
      .map((m) => {
        const core = m.units
          .map((id) => byId.get(id))
          .filter((c) => c && !c.traits.includes("Avatar"));
        if (core.length < 5) return null;
        const grown =
            core.length < growTo
              ? extend(core, growTo)
              : { board: core, added: [] },
          board = grown.board;
        const component = score(board, null);
        component.fit =
          component.preservation +
          component.items +
          component.access +
          component.matchup -
          component.dispute;
        const carry =
          board.find((c) => c.apiName === m.carry) ??
          board
            .filter((c) => c.stats.range >= 3)
            .sort((a, b) => b.cost - a.cost)[0] ??
          board[0];
        // Força de meta pela colocação média ajustada aos seus itens: a build publicada de cada campeão que
        // você já tem (ou monta com o banco) puxa a média da comp para baixo (ver item-edge.mjs).
        const edge = itemEdge(m, itemStock, recipes, (unit) => {
          const c = byId.get(unit);
          return !c ? 0 : c === carry ? 1 : role(c) === "tank" ? 0 : 0.5;
        });
        component.edge = edge;
        component.meta = (5 - edge.adjustedAvg) * 25;
        component.total = component.fit + component.meta;
        const build = buildFit(m, carry);
        component.build = build.points;
        component.buildFit = build;
        component.total += build.points;
        // Inércia: a comp já sugerida nesta partida só perde o topo para outra claramente melhor.
        // Aprimoramento escolhido ligado a uma sinergia favorece as comps que usam essa sinergia.
        const boosted = (options.augmentTraits ?? []).reduce(
          (n, t) => n + board.filter((c) => c.traits.includes(t)).length,
          0,
        );
        if (boosted) {
          component.augments = boosted * 4;
          component.total += boosted * 4;
        }
        if (m.id === options.stickyCompId) {
          component.sticky = STICKY_BONUS;
          component.total += STICKY_BONUS;
        }
        component.grown = grown.added;
        return { board, component, carry, focus: null, meta: m };
      })
      .filter(Boolean)
      .sort((a, b) => b.component.total - a.component.total);
    for (const r of ranked) {
      if (
        selected.some(
          (s) =>
            r.board.filter((c) => s.board.includes(c)).length / r.board.length >
            0.85,
        )
      )
        continue;
      selected.push(r);
      if (selected.length === 3) break;
    }
    const round = (n) => Math.round(n * 10) / 10;
    compRanking = ranked.map((r, index) => ({
      id: r.meta.id,
      rank: index + 1,
      suggested: selected.includes(r),
      total: round(r.component.total),
      fit: round(r.component.fit),
      owned: r.board.filter((c) => own.has(key(c))).length,
      size: r.board.length,
      dispute: round(r.component.dispute),
      carryItems: r.component.buildFit.carryHits,
      carryWanted: r.component.buildFit.carryWanted,
      adjustedAvg: r.component.edge.adjustedAvg,
      itemTier: tierOf(r.component.edge.adjustedAvg),
      itemGain: r.component.edge.gain,
      itemGains: r.component.edge.gains,
    }));
  }
  const focuses = selected.length
    ? []
    : [...new Set(candidates.flatMap((c) => c.traits))];
  const results = [];
  for (const focus of focuses) {
    let board = [];
    while (board.length < Math.min(boardLevel, available.length)) {
      const next = available
        .filter((c) => !board.includes(c))
        .map((c) => ({ c, score: score([...board, c], focus).total }))
        .sort((a, b) => b.score - a.score)[0];
      board.push(next.c);
    }
    // Local swaps improve the greedy board without discarding its trait direction.
    for (let pass = 0; pass < 2; pass++) {
      let best = score(board, focus).total,
        replacement = null;
      for (let i = 0; i < board.length; i++)
        for (const c of available) {
          if (board.includes(c)) continue;
          const trial = [...board];
          trial[i] = c;
          const s = score(trial, focus).total;
          if (s > best + 0.1) {
            best = s;
            replacement = trial;
          }
        }
      if (replacement) board = replacement;
      else break;
    }
    const component = score(board, null);
    const carry =
      board
        .filter((c) => c.stats.range >= 3)
        .sort((a, b) => {
          const value = (c) =>
            Math.pow(c.cost, 1.25) * 3 +
            (itemProfile[role(c)] ?? 0) * 2 +
            (freeProfile[role(c)] ?? 0) * 2 +
            (own.get(key(c))?.items.length ?? 0) * 0.3;
          return value(b) - value(a);
        })[0] ?? board[0];
    results.push({ board, component, carry, focus });
  }
  results.sort((a, b) => b.component.total - a.component.total);
  for (const r of results) {
    if (
      selected.some(
        (s) =>
          r.board.filter((c) => s.board.includes(c)).length / r.board.length >
          0.85,
      )
    )
      continue;
    selected.push(r);
    if (selected.length === 3) break;
  }
  const reserve = (options.bench ?? [])
    .filter((u) => String(u.playerId) === String(self.playerId))
    .map((u) => ({
      ...u,
      id: u.championName,
      name: byId.get(u.championName)?.name ?? u.championName,
      stars: u.starLevel,
      cost: byId.get(u.championName)?.cost ?? 0,
      source: "manual",
      traits: byId.get(u.championName)?.traits ?? [],
    }));
  // Substituições: a comp de meta é um ponto de partida. Para cada peça (menos o carry), campeões de custo
  // próximo e mesmo papel (tanque ou dano) que mantêm as sinergias, ordenados pelo que a partida favorece:
  // peça que já é sua, pouca disputa na pool, chance na loja. A peça é marcada quando está disputada pelos
  // rivais, esgotada ou fora do alcance da loja no nível alvo — aí a melhor alternativa vira sugestão.
  const poolByKey = new Map(pool.map((p) => [p.name, p]));
  const traitTiers = (board) =>
    traits(board).filter((t) => t.active && !t.solo);
  const shopOk = (c) => ODDS[boardLevel][c.cost - 1] >= 10;
  const reachable = (c) => own.has(key(c)) || (free(key(c)) > 0 && shopOk(c));
  const access = (c) => Math.log(1 + probability(c, boardLevel) * 100);
  function flexOf(board, carry) {
    const base = traitTiers(board),
      baseSum = base.reduce((n, t) => n + t.tier, 0),
      out = [];
    for (const u of board) {
      if (u === carry) continue;
      const rest = board.filter((c) => c !== u),
        tank = role(u) === "tank",
        mineU = own.get(key(u)),
        p = poolByKey.get(key(u)),
        contested = !mineU && isContested(p),
        unreachable = !reachable(u);
      const options = candidates
        .filter(
          (c) =>
            !board.includes(c) &&
            Math.abs(c.cost - u.cost) <= 1 &&
            (role(c) === "tank") === tank &&
            reachable(c),
        )
        .map((c) => {
          const next = traitTiers([...rest, c]),
            delta = next.reduce((n, t) => n + t.tier, 0) - baseSum,
            mine = own.get(key(c)),
            q = poolByKey.get(key(c));
          const lost = base
            .filter(
              (t) => (next.find((n) => n.name === t.name)?.tier ?? 0) < t.tier,
            )
            .map((t) => t.name);
          const gained = next
            .filter(
              (t) => t.tier > (base.find((b) => b.name === t.name)?.tier ?? 0),
            )
            .map((t) => t.name);
          const score =
            delta * 6 +
            (mine ? 5 + mine.stars * 2 : 0) -
            (mineU ? 6 + mineU.stars * 2 : 0) +
            ((p?.enemy ?? 0) / POOL[u.cost] - (q?.enemy ?? 0) / POOL[c.cost]) *
              12 +
            (access(c) - access(u)) * 1.5 +
            (c.cost - u.cost) * 1.5 +
            (role(c) === role(u) ? 2 : 0);
          return {
            id: c.apiName,
            name: c.name,
            cost: c.cost,
            owned: !!mine,
            stars: mine?.stars ?? 0,
            enemyCopies: q?.enemy ?? 0,
            total: POOL[c.cost],
            contested: !mine && isContested(q),
            traitDelta: delta,
            lost,
            gained,
            score: Math.round(score * 10) / 10,
          };
        })
        // Perder mais de um patamar de sinergia já é outra comp, não uma substituição.
        .filter((o) => o.traitDelta >= -1 && !o.contested)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (!options.length) continue;
      out.push({
        id: u.apiName,
        name: u.name,
        cost: u.cost,
        owned: !!mineU,
        stars: mineU?.stars ?? 0,
        enemyCopies: p?.enemy ?? 0,
        total: POOL[u.cost],
        remaining: free(key(u)),
        rivals: [...(rivals.get(key(u)) ?? [])],
        contested,
        unreachable,
        suggest: null,
        options,
      });
    }
    // Sugerir trocar: a peça está sob pressão (disputada, esgotada, fora da loja) e há alternativa sem perder
    // mais de um patamar, ou a alternativa já é sua e não perde nenhuma sinergia enquanto a peça da meta
    // ainda não é sua.
    // Cada substituto serve a uma peça só; as trocas mais vantajosas escolhem primeiro.
    const eligible = (f, o) =>
      o.score > 0 &&
      (((f.contested || f.unreachable) && o.traitDelta >= -1) ||
        (!f.owned && o.owned && !o.lost.length));
    const used = new Set();
    for (const f of [...out].sort(
      (a, b) => b.options[0].score - a.options[0].score,
    )) {
      const pick = f.options.find((o) => eligible(f, o) && !used.has(o.id));
      if (pick) {
        f.suggest = pick.id;
        used.add(pick.id);
      }
    }
    return out.sort(
      (a, b) =>
        (b.suggest ? 1 : 0) - (a.suggest ? 1 : 0) ||
        (b.contested ? 1 : 0) - (a.contested ? 1 : 0) ||
        b.cost - a.cost,
    );
  }
  const recommendations = selected.map((r, index) => {
    const ts = traits(r.board)
      .filter((t) => t.active)
      .sort((a, b) => b.count - a.count);
    const targets = r.board
      .filter((c) => !own.has(key(c)))
      .map((c) => ({
        id: c.apiName,
        name: c.name,
        cost: c.cost,
        chancePerShop: 1 - (1 - probability(c)) ** 5,
        enemyCopies: enemy.get(key(c)) ?? 0,
        remainingUpper: free(key(c)),
      }));
    const carryOwn = own.get(key(r.carry))?.copies ?? 0,
      needed = Math.max(0, 3 - carryOwn),
      p = probability(r.carry);
    const rollLevel = rollLevelOf({ carryCost: r.carry.cost });
    const rollBudget =
      options.gold === null
        ? null
        : Math.floor(
            Math.max(0, options.gold - (self.health <= 35 ? 20 : 50)) / 2,
          );
    const keep = r.board.filter((c) => own.has(key(c))).map((c) => c.name);
    return {
      rank: index + 1,
      meta: r.meta
        ? {
            id: r.meta.id,
            tier: r.meta.tier,
            avg: r.meta.avg,
            top4: r.meta.top4,
            win: r.meta.win,
            games: r.meta.games,
            levelling: r.meta.levelling,
            rerollLevel: r.meta.rerollLevel,
            stars3: r.meta.stars3,
            builds: r.meta.builds,
          }
        : null,
      title:
        r.meta?.title ||
        ts
          .slice(0, 2)
          .map((t) => `${t.count} ${t.name}`)
          .join(" · ") ||
        "Flex",
      score: Math.round(r.component.total * 10) / 10,
      components: r.component,
      traits: ts,
      carry: r.carry.name,
      carryRole: role(r.carry),
      flex: flexOf(r.board, r.carry),
      board: r.board.map((c) => ({
        id: c.apiName,
        name: c.name,
        cost: c.cost,
        traits: c.traits,
        role: role(c),
        owned: own.has(key(c)),
        inReserve: !own.get(key(c))?.onBoard && own.has(key(c)),
        stars: own.get(key(c))?.stars ?? 1,
        items: own.get(key(c))?.items ?? [],
      })),
      targets,
      keep,
      benchInstead: (self.boardPieces ?? [])
        .filter((u) => !r.board.some((c) => c.apiName === u.championName))
        .map((u) => byId.get(u.championName)?.name ?? u.championName),
      roll: {
        level: rollLevel,
        budget: rollBudget,
        neededForTwoStar: needed,
        availableUpper: free(key(r.carry)),
        chanceOneCopy:
          rollBudget === null ? null : 1 - (1 - p) ** (rollBudget * 5),
      },
      grown: r.component.grown ?? [],
      reasons: [
        ...(r.component.grown?.length
          ? [
              `Comp ampliada para o seu nível ${level}: ${r.component.grown.map((g) => g.slot + "ª vaga " + g.name + (g.gained.length ? " (sobe " + g.gained.join(", ") + ")" : "")).join("; ")}.`,
            ]
          : []),
        ...(r.component.augments
          ? [
              `Seu aprimoramento reforça ${options.augmentTraits.join(", ")}: ${r.component.augments / 4} unidade(s) desta comp aproveitam.`,
            ]
          : []),
        ...(r.meta
          ? [
              `Meta tier ${r.meta.tier}: colocação média ${r.meta.avg}, top 4 em ${r.meta.top4}% e vitória em ${r.meta.win}% de ${r.meta.games} partidas · estilo ${r.meta.levelling || "não informado"}.`,
            ]
          : []),
        ...(r.component.buildFit && ownedItems.length
          ? [
              `Itens: você tem ou monta ${Math.round(r.component.buildFit.carryHits * 10) / 10} de ${r.component.buildFit.carryWanted} itens da build de ${r.carry.name}${r.component.buildFit.mismatch ? `. Atenção: seus itens são de dano ${role(r.carry) === "ap" ? "físico" : "mágico"} e o carry desta comp é ${role(r.carry) === "ap" ? "mágico" : "físico"}` : ""}.`,
            ]
          : []),
        r.component.orphanItems > 0
          ? `Atenção: ${Math.round(r.component.orphanItems * 10) / 10} dos seus itens ficam sem portador compatível com slot livre nesta comp.`
          : "Todos os seus itens conhecidos têm portador compatível com slot livre nesta comp.",
        `Compatibilidade dos itens conhecidos: ${Math.round(r.component.items * 10) / 10} pontos; ${freeItems.length} itens/componentes livres informados.`,
        `Meta de nível ${boardLevel}: ${r.board.length} campeões; ${keep.length} já disponíveis para a transição.`,
        `${ts.length} sinergias ativas pelos breakpoints do catálogo.`,
        `${targets.filter((t) => t.enemyCopies === 0).length}/${targets.length} alvos sem cópias observadas nos tabuleiros rivais.`,
      ],
    };
  });
  const opponents = alive
    .filter((p) => p !== self)
    .map((p) => {
      const units = p.boardPieces.map((u) => ({
        id: u.championName,
        name: byId.get(u.championName)?.name ?? u.championName,
        stars: u.starLevel,
        items: u.itemNames,
        cost: byId.get(u.championName)?.cost ?? u.price,
        role: byId.has(u.championName)
          ? role(byId.get(u.championName))
          : "unknown",
      }));
      return {
        id: p.playerId,
        name: p.riotIdGameName ?? p.summonerName,
        health: p.health,
        units,
        pressure: units.reduce(
          (n, u) => n + u.stars * u.cost + u.items.length * 2,
          0,
        ),
      };
    })
    .sort((a, b) => b.pressure - a.pressure);
  const healing = alive
    .filter((p) => p !== self)
    .flatMap((p) => p.boardPieces)
    .filter((u) =>
      /Bloodthirster|HandOfJustice|SpiritVisage|HextechGunblade|Redemption/.test(
        (u.itemNames ?? []).join(" "),
      ),
    ).length;
  const counters = [
    {
      title: "Observe quem está mais forte",
      text: opponents[0]
        ? `${opponents[0].name} tem a maior pressão estimada por custo, estrelas e itens. Essa medida não simula o combate.`
        : "Sem adversário vivo no snapshot.",
    },
    {
      title: "Frontline antes do dano",
      text: "Busque tanques 2★ e sinergias defensivas antes de perseguir um carry caro sem proteção.",
    },
    {
      title: healing ? "Considere feridas" : "Mantenha flexibilidade",
      text: healing
        ? `${healing} unidades rivais têm itens de sustain observados. Considere anti-cura se já houver um portador adequado; não transfira itens sem removedor.`
        : "Uma comp menos disputada não vence automaticamente uma comp mais forte. Preserve unidades evoluídas enquanto faz a transição.",
    },
  ];
  // Meta fixada menor que o seu nível: as vagas extras seguem a mesma regra.
  const goalCore = (options.previewIds ?? [])
      .map((id) => byId.get(id))
      .filter(Boolean),
    previewGrow =
      goalCore.length >= 5 && goalCore.length < growTo
        ? extend(goalCore, growTo).added
        : [];
  // Substituições da comp fixada, com o mesmo carry que a tática usa para ela.
  const goalBoard = [
      ...goalCore,
      ...previewGrow.map((g) => byId.get(g.id)).filter(Boolean),
    ],
    goalCarry =
      byId.get(options.goalCarryId) ??
      goalBoard.find((c) => c.stats.range >= 3) ??
      goalBoard[0];
  return {
    previewGrow,
    previewFlex: goalBoard.length >= 5 ? flexOf(goalBoard, goalCarry) : [],
    compRanking,
    self: {
      id: self.playerId,
      name: self.riotIdGameName ?? self.summonerName,
      health: self.health,
      augments: Array.isArray(self.augments) ? self.augments : [],
      reserve,
      units: self.boardPieces.map((u) => ({
        ...u,
        name: byId.get(u.championName)?.name ?? u.championName,
        traits: byId.get(u.championName)?.traits ?? [],
      })),
    },
    recommendations,
    pool: pool.sort((a, b) => b.enemy / b.total - a.enemy / a.total),
    opponents,
    counters,
    itemProfile,
    itemContext: {
      equippedCount: equippedItems.length,
      freeCount: freeItems.length,
      readyRecipes: readyRecipes.map((i) => ({ id: i.apiName, name: i.name })),
      note: "Equipados permanecem no portador; receitas livres são alternativas e podem compartilhar componentes. Inventário oculto não é inferido.",
    },
    unknown: [...unknown],
    odds: ODDS[level],
    rules: {
      pool: POOL,
      source: "https://tftsense.gg/study-hall/tft-champion-pool-and-odds/",
      reference:
        "Set 18 / patch 18.3; parâmetros ajustáveis, não confirmados no executável 18.4.",
    },
  };
}
