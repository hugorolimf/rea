import { POOL, ODDS } from "./rules.mjs";
import { isContested } from "./economy.mjs";
import { shopsAhead } from "./core/economy/gold.mjs";
import {
  anyUnit,
  exactUnit,
  filterKey,
  starUnit,
  traitAt,
  unitUpTo,
} from "./evidence.mjs";
import { TIER_PLACE } from "./augment-stats.mjs";
import { itemEdge, tierOf } from "./item-edge.mjs";
import {
  buildHolders,
  compBuild,
  compBuildMap,
  compSpendOrder,
} from "./core/items/builds.mjs";
import { HOLD_VALUE, holdValue, resolveHoldings } from "./item-holdings.mjs";
import {
  itemStock as stockOf,
  movableItems,
  ownedItems as ownedOf,
  readyRecipes as readyRecipesOf,
} from "./core/items/owned.mjs";
import { takeOne } from "./core/items/stock.mjs";
import { buildItemPlan, planPoints } from "./item-plan.mjs";
import { isPlanItem, itemValueTable } from "./item-value.mjs";
import { compScore } from "./comp-score.mjs";
import {
  REACH,
  compReach,
  goldForShops,
  powerLevelOf,
  reachHorizon,
} from "./core/comps/reach.mjs";
import { traitBook } from "./core/catalog/traits.mjs";
import {
  componentFamily,
  holderRole,
  isComponent,
  isEmblemItem,
  isEmblemTool,
  itemRole,
  recipeMap,
  recipeOf,
} from "./core/catalog/items.mjs";
import { championRole, isAvatar, poolName } from "./core/catalog/champions.mjs";
import {
  freeByCost,
  freeCopies,
  starCopies,
  upperCopies,
} from "./core/pool/copies.mjs";
import {
  chanceAtLeast,
  isBuyable,
  levelOdds,
  shopChance,
  slotChance,
  slotsIn,
} from "./core/pool/shop.mjs";
export { POOL, ODDS };
const STICKY_BONUS = 10;
// Com evidência medida (evidence.mjs), o total é a colocação esperada convertida em pontos: 0,1 de colocação
// vale 2 pontos. A continuidade da sugestão anterior equivale a 0,15 de colocação (evita trocar por ruído).
const PLACEMENT_POINTS = 20;
// Com a colocação esperada medida (evidência), o plano de itens (item-plan.mjs) soma esta parte dos seus pontos
// (planPoints): a pergunta medida já leva os 2 melhores itens do banco, então só uma parte entra.
const EVIDENCE_ITEM_SHARE = 0.3;
// Confiança: colocação final tem desvio de ~2,29 (uniforme de 1 a 8), então a média de n partidas erra
// ~2,29/√n. Trocar de plano exige diferença maior que essa incerteza (95%, unilateral) MAIS o custo de trocar.
const PLACEMENT_SD = 2.29;
const Z95 = 1.645;
// Custo de trocar (política explícita, em colocações): cresce com o estágio e é proporcional às peças que
// mudam. Tarde na partida, trocar joga fora peças, itens e ouro investidos e não há tempo de reconstruir.
const SWITCH_COST = { 1: 0.1, 2: 0.1, 3: 0.25, 4: 0.5, 5: 0.8 };
// Troca de plano (política, não medida): a vantagem em colocação esperada tem de passar do custo de trocar mais esta
// histerese fixa (evita o vaivém por diferenças de centésimos). Cada item equipado numa peça que sai custa `itemMove`
// colocações; `goldPerPlacement` de ouro a mais para montar o desafiante custam 1 colocação.
const HYSTERESIS = 0.1;
const SWITCH = { itemMove: 0.03, goldPerPlacement: 200 };
// Tabuleiro que descarta a sinergia de um aprimoramento escolhido: soma isto à colocação esperada (política, não medida;
// o tier D da régua dos aprimoramentos, TIER_PLACE).
const AUGMENT_DROP = 0.3;
// Colocação de quem NÃO monta a comp, quando o seu tabuleiro atual não tem medida (política, não medida): a média geral
// (~4,47) supunha que falhar devolve um jogador médio, o que tornava p quase irrelevante; quem fica sem comp no meio da
// partida termina pior que a média.
const NOT_BUILT = 5;
// Uma combinação só vale como evidência com amostra suficiente; abaixo disso usa-se a pergunta mais curta.
const MIN_GAMES = 300;
// Memória por identidade dos objetos de entrada (cópias de estatísticas e catálogo): some quando eles são trocados.
const memos = new WeakMap();
function memoFor(objects) {
  let node = memos;
  for (const o of objects) {
    const k = o && typeof o === "object" ? o : NO_OBJECT;
    let next = node.get(k);
    if (!next) node.set(k, (next = new WeakMap()));
    node = next;
  }
  let map = node.get(MEMO_LEAF);
  if (!map) node.set(MEMO_LEAF, (map = new Map()));
  return map;
}
const NO_OBJECT = {},
  MEMO_LEAF = {};
export function analyze(snapshot, catalog, options) {
  const level = options.level;
  const boardLevel = options.targetLevel ?? level;
  const byId = new Map(catalog.champions.map((c) => [c.apiName, c]));
  const key = poolName;
  const candidates = catalog.champions.filter((c) => !isAvatar(c));
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
      const n = starCopies(u.starLevel) * (u.quantity ?? 1),
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
  // Cópias que saíram do tabuleiro dos rivais e provavelmente estão no banco deles (estimativa do servidor a
  // partir do histórico de tabuleiros): fora da pool provável e sinal de interesse do rival na peça.
  const held = new Map();
  for (const [id, n] of Object.entries(options.hidden ?? {})) {
    const c = byId.get(id);
    if (c && Number.isFinite(n) && n > 0)
      held.set(key(c), (held.get(key(c)) ?? 0) + n);
  }
  // Teto observado e cópias livres (fracionárias: o banco estimado dos rivais entra com a fração): core/pool.
  const upper = (k) => upperCopies(allPools.get(k), visible.get(k) ?? 0);
  const free = (k) =>
    freeCopies(allPools.get(k), visible.get(k) ?? 0, held.get(k) ?? 0);
  // Disputa: cópias vistas nos tabuleiros rivais mais as estimadas nos bancos deles.
  const contestOf = (k) => (enemy.get(k) ?? 0) + (held.get(k) ?? 0);
  const pool = [...allPools].map(([name, cost]) => ({
    name,
    cost,
    total: POOL[cost],
    own: own.get(name)?.copies ?? 0,
    enemy: enemy.get(name) ?? 0,
    hidden: Math.round((held.get(name) ?? 0) * 10) / 10,
    remainingUpper: upper(name),
    // `free` é a pool livre exata (a que as chances usam, aqui e na rolagem); `remainingLikely` é o mesmo valor
    // arredondado a 0,1 só para exibir.
    free: free(name),
    remainingLikely: Math.round(free(name) * 10) / 10,
    rivals: [...(rivals.get(name) ?? [])],
  }));
  const denomByCost = freeByCost(pool);
  function probability(c, atLevel = level) {
    return slotChance(atLevel, c.cost, free(key(c)), denomByCost[c.cost] ?? 0);
  }
  for (const entry of pool) {
    const c = catalog.champions.find((c) => key(c) === entry.name);
    entry.chancePerSlot = c ? probability(c) : 0;
    entry.chancePerShop = shopChance(entry.chancePerSlot);
  }
  const roleCache = new Map();
  function role(c) {
    let r = roleCache.get(c);
    if (!r) {
      r = championRole(c, options.metaRoles);
      roleCache.set(c, r);
    }
    return r;
  }
  const equippedItems = [...own.values()].flatMap((u) => u.items);
  const ownedItems = ownedOf(equippedItems, options.inventory ?? []);
  // Estoque para medir builds: itens completos e componentes, equipados ou no banco (componente equipado
  // ainda vira metade de um item da build). Partição e receitas: core/items/owned.mjs e core/catalog/items.mjs.
  const itemStock = stockOf(ownedItems),
    recipes = recipeMap(catalog.items);
  const itemProfile = { ad: 0, ap: 0, tank: 0, flex: 0 };
  for (const i of ownedItems) {
    if (isComponent(i)) {
      const family = componentFamily(i);
      if (family === "ad") itemProfile.ad += 1.2;
      else if (family === "ap") itemProfile.ap += 1.2;
      else if (family === "bow") {
        itemProfile.ad += 0.8;
        itemProfile.ap += 0.4;
      } else if (family === "tank") itemProfile.tank += 1;
      else itemProfile.flex += 0.5;
    } else itemProfile[itemRole(i)]++;
  }
  const freeItems = options.inventory ?? [],
    itemCatalog = new Map(catalog.items.map((i) => [i.apiName, i]));
  const readyRecipes = readyRecipesOf(catalog.items, freeItems);
  const freeProfile = { ad: 0, ap: 0, tank: 0, flex: 0 };
  for (const id of freeItems) if (!isComponent(id)) freeProfile[itemRole(id)]++;
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
  // Cada item seu precisa de um portador de papel compatível com slot livre na comp alvo (holderRole, de core/catalog/items.mjs);
  // componente livre vale meio item.
  function itemFit(board) {
    const names = new Set(board.map(key)),
      demand = { ad: 0, ap: 0, tank: 0, flex: 0 },
      cap = { ad: 0, ap: 0, tank: 0 };
    for (const c of board)
      cap[role(c)] += Math.max(0, 3 - (own.get(key(c))?.items.length ?? 0));
    for (const [k, u] of own)
      if (!names.has(k)) for (const id of u.items) demand[holderRole(id)]++;
    for (const id of freeItems)
      demand[holderRole(id)] += isComponent(id) ? 0.5 : 1;
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
  const traitMap = new Map(catalog.traits.map((t) => [t.name, t])),
    traitByApi = new Map(catalog.traits.map((t) => [t.apiName, t.name]));
  // Traços, emblemas, patamares e traço solo: regra única em core/catalog/traits.mjs (patamares acima de 12 peças não
  // contam no tabuleiro). Um emblema equipado numa peça sua dá a sinergia do nome a ela enquanto estiver na comp.
  // Sinergia solo: um aprimoramento escolhido pode liberá-la (Aminimigos → Rival).
  const book = traitBook(catalog, {
    maxUnits: 12,
    exempt: options.augmentTraits ?? [],
  });
  const thresholdsOf = book.thresholds;
  const emblemRecipes = book.recipes;
  // A peça do tabuleiro com os itens que a gente tem nela, no formato que o livro de sinergias conta.
  const traitUnit = (c) => ({
    traits: c.traits,
    items: own.get(key(c))?.items,
  });
  function traitsOf(c) {
    return book.of(c.traits, own.get(key(c))?.items).traits;
  }
  // Sinergias de uma peça com os itens dela: `traits` já inclui os emblemas e `emblemTraits` lista só os vindos deles.
  const traitsFor = (c, items) => {
    const r = book.of(c.traits, items);
    return { traits: r.traits, emblemTraits: r.added };
  };
  const unitTraits = (u) => {
    const c = byId.get(u.championName);
    return c ? traitsFor(c, u.itemNames) : { traits: [], emblemTraits: [] };
  };
  const legal = (board) => book.legal(board.map(traitUnit));
  function traits(board) {
    return book.summary(board.map(traitUnit));
  }
  // Emblemas: Espátula/Frigideira + componente (ou emblema pronto no banco) dão a sinergia do nome a uma peça.
  // Para cada comp, o melhor emblema ao alcance: fechar o próximo patamar de uma sinergia vale muito; reforçar
  // uma sinergia ativa vale pouco. Sem o outro componente no banco, o emblema conta 60% (falta pegá-lo).
  const bankFree = options.inventory ?? [];
  // Itens que dá para pôr numa peça de uma comp: o banco e o que está equipado em peça que SAI dela (o Avatar fica).
  // Cada item leva de onde vem: o de peça que sai custa mover (HOLD_VALUE.move). Emblema equipado numa peça que
  // fica já entra pelas sinergias dela (traitsOf).
  const movableCache = new WeakMap();
  function movable(board) {
    let m = movableCache.get(board);
    if (!m) {
      const here = new Set(board.map(key)),
        leaving = [...own]
          .filter(([k, u]) => !here.has(k) && !isAvatar(u.champion))
          .flatMap(([, u]) => u.items);
      m = { all: movableItems(bankFree, leaving) };
      m.ids = m.all.map((x) => x.id);
      movableCache.set(board, m);
    }
    return m;
  }
  function emblemEdge(board) {
    const pool = movable(board).all,
      emblemTools = pool.filter((x) => isEmblemTool(x.id)).map((x) => x.id),
      readyEmblems = pool.filter((x) => isEmblemItem(x.id)).map((x) => x.id);
    if (!emblemTools.length && !readyEmblems.length) return null;
    const ts = new Map(traits(board).map((t) => [t.name, t]));
    // Quem recebe: peça da comp sem a sinergia, de preferência sua e com menos itens (o carry quer 3 itens).
    const holderOf = (trait, taken = new Set()) =>
      board
        .filter((c) => !traitsOf(c).includes(trait) && !taken.has(c))
        .map((c) => ({ c, u: own.get(key(c)) }))
        .sort(
          (a, b) =>
            !!b.u - !!a.u ||
            (a.u?.items.length ?? 0) - (b.u?.items.length ?? 0) ||
            a.c.cost - b.c.cost,
        )[0]?.c ?? null;
    const gain = (trait) => {
      if (!holderOf(trait)) return 0;
      const t = ts.get(trait);
      if (!t) return 0.5;
      if (t.next && t.count + 1 >= t.next) return 10 + 4 * (t.tier + 1);
      return t.active ? 3 : (2 * (t.count + 1)) / (t.next ?? t.count + 1);
    };
    const picks = [],
      stock = [...pool];
    // Gasta uma unidade do item (banco primeiro, depois peça que sai) e devolve de onde veio; null se não há.
    const use = (id) => takeOne(stock, (x) => x.id === id);
    const moved = (...src) =>
      src.some((x) => x?.leaving) ? HOLD_VALUE.move : 1;
    for (const id of readyEmblems) {
      const r = emblemRecipes.find((e) => e.id === id),
        src = r && use(id);
      if (src)
        picks.push({
          ...r,
          ready: true,
          points: gain(r.trait) * moved(src),
          leaving: src.leaving,
        });
    }
    for (const tool of emblemTools) {
      const toolSrc = use(tool);
      if (!toolSrc) continue;
      const best = emblemRecipes
        .filter((e) => e.parts.includes(tool))
        .map((e) => {
          const other = e.parts[0] === tool ? e.parts[1] : e.parts[0],
            at = stock.find((x) => x.id === other),
            have = !!at;
          return {
            ...e,
            other,
            ready: have,
            leaving: !!(toolSrc.leaving || at?.leaving),
            points: gain(e.trait) * (have ? 1 : 0.6) * moved(toolSrc, at),
          };
        })
        .sort((a, b) => b.points - a.points)[0];
      if (best) {
        if (best.ready) use(best.other);
        picks.push(best);
      }
    }
    picks.sort((a, b) => b.points - a.points);
    const taken = new Set();
    return {
      points: picks.reduce((n, p) => n + p.points, 0),
      picks: picks
        .filter((p) => p.points > 0)
        .map((p) => {
          const h = holderOf(p.trait, taken) ?? holderOf(p.trait);
          if (h) taken.add(h);
          return {
            id: p.id,
            name: p.name,
            trait: p.trait,
            ready: p.ready,
            other: p.other ?? null,
            holder: h ? { id: h.apiName, name: h.name } : null,
            fromLeaving: !!p.leaving,
          };
        }),
    };
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
      // Investimento já feito na peça: custo × cópias (estrelas) e itens equipados. Pesa mais conforme o nível
      // sobe: no começo trocar de comp é barato; tarde, abandonar 2★ com itens custa a partida.
      preservation: u
        ? (1.5 + Math.log2(u.copies + 1) * c.cost * 0.6 + u.items.length * 2) *
          (0.6 + level * 0.08)
        : 0,
      strength: Math.pow(c.cost, 1.25) * 2,
      dispute: (contestOf(key(c)) / POOL[c.cost]) * 12,
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
      (upper(key(c)) > 0 &&
        isBuyable(boardLevel, c.cost) &&
        (c.cost < 5 || boardLevel >= 9)),
  );
  if (!options.metaComps?.length && available.length < boardLevel)
    throw Error(
      `Não há ${boardLevel} campeões distintos acessíveis para montar a meta neste snapshot.`,
    );
  // Com comps de meta disponíveis, elas são as candidatas: a força vem da colocação média real, e o estado da
  // partida (o que você já tem, itens, disputa na pool, acesso na loja, lobby) decide qual delas encaixa melhor.
  // Itens que você já tem, comp a comp (item-holdings.mjs, a regra da Formação): para cada item que a build pede,
  // onde ele está (já na peça certa, no banco, equipado em peça que sai da comp, em peça que fica, montável com
  // componentes) e o valor que o custo de mover/montar deixa (HOLD_VALUE). Cada item seu é gasto uma vez: primeiro
  // o que a peça já usa, depois o carry, depois as demais (as de dano antes dos tanques). Item que só está numa peça
  // que fica e que a própria build dela pede não sobra para outra peça.
  const compositionOf = (id) => itemCatalog.get(id)?.composition ?? [];
  // Plano de itens da comp (item-plan.mjs): valor medido de cada item seu em cada campeão da comp, atribuído para somar
  // o máximo (3 por campeão), e a lista de desejos do meta. Sem o banco lido, só a lista de desejos.
  const valueTable = itemValueTable({
      stats: options.stats,
      itemStats: options.itemStats,
      metaBuilds: options.metaBuilds,
      baseAvg: options.baseAvg ?? 4.466,
    }),
    planRecipes = recipeMap(catalog.items, (i) => isPlanItem(i.apiName)),
    planCache = new WeakMap();
  // O plano não depende da evidência: as rodadas de análise do servidor (até 4 por pedido) repetem as mesmas entradas, então
  // o resultado fica guardado por entrada (jogo, banco e cópias das estatísticas de meta, por identidade).
  const planMemo = memoFor([
    options.stats,
    options.itemStats,
    options.metaBuilds,
    catalog,
  ]);
  // `comp`: a comp de meta do tabuleiro (null = sem comp); a lista de desejos segue a build publicada dela (motor único
  // de itens), como a aba Comps. Não muda o total do plano (só as atribuições somam).
  function planFor(board, comp = null) {
    let plan = planCache.get(board);
    if (!plan) {
      const published = compBuildMap(comp);
      const here = new Set(board.map(key)),
        input = {
          units: board.map((c) => {
            const u = own.get(key(c));
            return {
              id: c.apiName,
              name: c.name,
              owned: !!u,
              equipped: u?.items ?? [],
            };
          }),
          leaving: [...own]
            .filter(([k, u]) => !here.has(k) && !isAvatar(u.champion))
            .map(([, u]) => ({ name: u.champion.name, items: u.items })),
          bank: options.inventory ?? [],
          bankRead: options.bankRead !== false,
        },
        memoKey = JSON.stringify([
          input.units.map((u) => [u.id, [...u.equipped].sort()]),
          input.leaving,
          [...input.bank].sort(),
          input.bankRead,
          options.baseAvg ?? null,
          published,
        ]);
      plan = planMemo.get(memoKey);
      if (!plan) {
        plan = buildItemPlan({
          ...input,
          recipes: planRecipes,
          valueOf: valueTable.valueOf,
          rankedOf: valueTable.rankedOf,
          wantsOf: valueTable.wantsOf,
          nameOf: (id) => itemCatalog.get(id)?.name ?? id,
          buildOf: (id) => published[id] ?? null,
        });
        if (planMemo.size >= 600) planMemo.clear();
        planMemo.set(memoKey, plan);
      }
      planCache.set(board, plan);
    }
    return plan;
  }
  // Builds da comp candidata e a ordem em que disputam seus itens: motor único de itens (core/items/builds.mjs), as
  // mesmas builds publicadas que a aba Comps mostra.
  function holdingsFor(m, carry, board) {
    const names = new Map(board.map((c) => [key(c), c.apiName])),
      goalIds = new Set(names.values()),
      priority = (u) => {
        const c = byId.get(u);
        return !c ? 0 : role(c) === "tank" ? 0 : 0.5;
      };
    return resolveHoldings({
      builds: compBuildMap(m),
      order: compSpendOrder(m, carry.apiName, priority),
      units: [...own].map(([k, u]) => ({
        unitId: names.get(k) ?? u.champion.apiName,
        name: u.champion.name,
        stars: u.stars,
        items: u.items,
        keeps: isAvatar(u.champion),
      })),
      goalIds,
      bank: options.inventory ?? [],
      compositionOf,
      carryId: carry.apiName,
    });
  }
  // Quanto dos itens que a comp pede você já tem: o valor de cada item (1 posicionado; um pouco menos por equipar do
  // banco, mover ou montar; 0,35 de metade de receita). O carry pesa muito mais que o resto.
  function buildFit(m, carry, holdings, plan = null) {
    const wanted = compBuild(m, carry.apiName)?.items ?? [],
      carryHits = holdValue(holdings.entries.get(carry.apiName)),
      otherHits = [...holdings.entries]
        .filter(([unit]) => unit !== carry.apiName)
        .reduce((n, [, list]) => n + holdValue(list), 0);
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
      // Com o banco lido, o total acumulado do plano de itens (valor medido de cada item que você tem, nos campeões
      // onde rendem mais) vale no lugar da conta por carry; sem o banco, a conta por builds de antes.
      points: plan?.active
        ? planPoints(plan.total)
        : carryHits * 6 + otherHits * 1.2 - Math.min(18, mismatch * 4),
      // Onde estão os itens da build (contagem por situação) e, do carry, item a item (para a tela e o relatório).
      holdings: {
        counts: holdings.counts,
        carry: (holdings.entries.get(carry.apiName) ?? []).map((e) => ({
          id: e.id,
          kind: e.kind,
          value: e.value,
          from: e.from,
        })),
      },
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
            legal([...out, c]) &&
            (own.has(key(c)) ||
              (upper(key(c)) > 0 && isBuyable(level, c.cost))),
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
              (contestOf(key(c)) / POOL[c.cost]) * 6,
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
  let compRanking = [],
    ranked = [];
  if (options.metaComps?.length) {
    ranked = options.metaComps
      .map((m) => {
        const core = m.units
          .map((id) => byId.get(id))
          .filter((c) => c && !isAvatar(c));
        if (core.length < 5 || !legal(core)) return null;
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
        // Os itens vêm localizados nesta comp (onde estão e quanto custa mover/montar): ver holdingsFor.
        const holdings = holdingsFor(m, carry, board);
        const edge = itemEdge(
          m,
          itemStock,
          recipes,
          (unit) => {
            const c = byId.get(unit);
            return !c ? 0 : c === carry ? 1 : role(c) === "tank" ? 0 : 0.5;
          },
          holdings.entries,
        );
        component.edge = edge;
        // Força geral da comp (colocação média publicada): pesa, mas não decide sozinha; o encaixe na partida
        // (o que você tem, itens, disputa, acesso na loja) é que escolhe entre comps parecidas.
        component.meta = (5 - edge.adjustedAvg) * 15;
        component.total = component.fit + component.meta;
        const plan = planFor(board, m);
        component.itemPlan = plan;
        const build = buildFit(m, carry, holdings, plan);
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
        const emblem = emblemEdge(board);
        if (emblem?.points) {
          component.emblem = emblem;
          component.total += emblem.points;
        }
        return { board, component, carry, focus: null, meta: m };
      })
      .filter(Boolean)
      .sort((a, b) => b.component.total - a.component.total);
  }
  // Tabuleiros de vantagem e avaliação por evidência medida (evidence.mjs). Sem dados do explorer (offline), as
  // comps de meta seguem ranqueadas pela conta acima e não há tabuleiro de vantagem.
  //
  // Trunfos (options.assets): as suas peças com estrela e itens de melhor colocação medida. Para cada uma, a
  // MetaTFT diz quais peças e sinergias rendem mais junto com ela (options.conditional); o tabuleiro é montado
  // com as que mais melhoram a colocação esperada, pesadas pela chance de você conseguir cada peça.
  const baseAvg = options.baseAvg ?? 4.466;
  // Lojas ao alcance: o ouro de agora mais a renda das próximas rodadas (base + juros), guardando uma reserva; a conta e a
  // suposição para ouro não lido (D14) são de core/economy (shopsAhead, POLICY.shopsAhead). O grafo de fatos entrega o
  // número já pronto em `options.shopsAhead` (fato `economy.shopsAhead`, app/recommend-facts.mjs): a base declara a
  // loja e as lojas ao alcance, não o ouro. Quem chama o motor direto (testes) continua passando `options.gold`.
  const shops = options.shopsAhead ?? shopsAhead(options.gold);
  const evidence = options.evidence ?? null,
    requests = new Map(),
    conditionalRequests = new Set();
  // Chance de ter a peça: sua já é certa; senão, ao menos uma cópia nas lojas que o ouro paga (as perguntas de
  // evidência pedem a peça presente, em qualquer estrela).
  const stats = options.stats ?? null;
  // Chance de ver ao menos k cópias nas lojas ao alcance: core/pool (chanceAtLeast).
  const atLeast = (p, k) => chanceAtLeast(slotsIn(shops), p, k);
  // Estrela em que a peça mais aparece nos tabuleiros medidos (Rengar: 3★; a maioria: 2★).
  const typicalStar = (c) => {
    const n = [1, 2, 3].map(
      (st) => stats?.unit?.[`${c.apiName}|${st}`]?.[1] ?? 0,
    );
    return n.some(Boolean) ? n.indexOf(Math.max(...n)) + 1 : null;
  };
  // Maior estrela que você realisticamente alcança com a peça: a maior com 50%+ de chance de juntar as cópias que
  // faltam (seu ouro das próximas rodadas, a pool provável e as chances de loja do seu nível). Uma peça nova de
  // reroll no nível 9 fica em 1★ — e é com 1★ que ela entra na pergunta, não com o 3★ de quem fez o reroll cedo.
  const reachStar = (c) => {
    const have = own.get(key(c))?.copies ?? 0;
    for (const st of [3, 2]) {
      const need = starCopies(st) - have;
      if (need <= 0) return st;
      if (
        upper(key(c)) >= need &&
        atLeast(probability(c, boardLevel), need) >= 0.5
      )
        return st;
    }
    return 1;
  };
  const presence = (c) => {
    if (own.has(key(c))) return anyUnit(c.apiName); // sua: o caminho dela é o seu plano
    const st = reachStar(c);
    return st >= 3 ? anyUnit(c.apiName) : unitUpTo(c.apiName, st);
  };
  const pFind = (c) =>
    own.has(key(c))
      ? 1
      : upper(key(c)) > 0
        ? shopChance(probability(c, boardLevel), shops)
        : 0;
  const shrinkTo = (stat, prior, k = MIN_GAMES) =>
    stat ? (stat[0] * stat[1] + prior * k) / (stat[1] + k) : prior;
  // Trunfos: as suas peças pelo que elas podem ser nesta partida, não pelo que valem isoladas agora. Cada uma vale
  // pela colocação medida na estrela em que ela é jogada (Rengar 2★ vira o Rengar 3★ que o reroll busca),
  // ponderada pela chance de chegar lá com o ouro das próximas rodadas e a pool de agora. As peças ligadas a um
  // aprimoramento escolhido vêm primeiro: o aprimoramento é o plano que a partida te deu.
  const augTraits = new Set(options.augmentTraits ?? []);
  const assets = candidates
    .filter((c) => own.has(key(c)))
    .map((c) => {
      const u = own.get(key(c)),
        items = Math.min(3, u.items.length),
        now =
          stats?.unit?.[`${c.apiName}|${u.stars}|${items}`] ??
          stats?.unit?.[`${c.apiName}|${u.stars}`],
        avgNow = now?.[0] ?? baseAvg;
      // Estrela-alvo: a que dá a melhor colocação esperada (média medida nela × chance de chegar lá com o ouro das
      // próximas rodadas; se não chegar, fica como está). Até a estrela em que a peça costuma ser jogada, sempre;
      // acima dela (Ahri 3★: 9 cópias de custo 4), só com chance real — 15% ou mais nas próximas rodadas.
      const usual = typicalStar(c) ?? u.stars;
      const option = (st) => {
        const m = st === u.stars ? now : stats?.unit?.[`${c.apiName}|${st}`];
        if (!m) return null;
        const need = starCopies(st) - u.copies,
          p =
            st === u.stars || need <= 0
              ? 1
              : upper(key(c)) < need
                ? 0
                : atLeast(probability(c, boardLevel), need);
        return { st, m, p, value: p * m[0] + (1 - p) * avgNow };
      };
      const best = [u.stars, u.stars + 1, u.stars + 2]
        .filter((st) => st <= 3)
        .map(option)
        .filter((o) => o && (o.st <= Math.max(usual, u.stars) || o.p >= 0.15))
        .sort((x, y) => x.value - y.value)[0];
      if (!best) return null;
      const target = best.st,
        later = best.m,
        pReach = best.p,
        value = best.value;
      return {
        id: c.apiName,
        champion: c,
        stars: target,
        starsNow: u.stars,
        items,
        avg: later[0],
        avgNow,
        games: later[1],
        pReach,
        value,
        augment: traitsOf(c).some((t) => augTraits.has(t)),
        // Os dados são de tabuleiros FINAIS. Peça pronta (na estrela-alvo, com 2+ itens) é medida exatamente como
        // está. Peça que ainda vai crescer (subir estrela, ganhar itens) é medida "presente, em qualquer estrela",
        // como as outras peças: a medição inclui quem chegou lá e quem não chegou, na proporção real. Medir o estado
        // de agora (ex.: 2★ com 1 item) compararia com quem terminou a partida assim — quem caiu cedo.
        exact: target === u.stars && items >= 2,
        filter:
          target === u.stars && items >= 2
            ? exactUnit(c.apiName, u.stars, items)
            : anyUnit(c.apiName),
      };
    })
    .filter((a) => a && a.games >= MIN_GAMES && (a.pReach > 0 || a.exact))
    .sort((x, y) => y.augment - x.augment || x.value - y.value)
    .slice(0, 2);
  for (const a of assets)
    if (!options.conditional?.has(a.filter)) conditionalRequests.add(a.filter);
  const advantage = [];
  for (const asset of assets) {
    const cond = options.conditional?.get(asset.filter);
    if (!cond) continue;
    // Referência na mesma escala da tabela condicional (a linha do próprio trunfo na pergunta dele); asset.avg é
    // da estrela-alvo e, com o filtro "presente", deslocaria todo ganho.
    const ref =
      cond.units[asset.id]?.[0] ??
      (asset.exact ? asset.avg : (stats?.unit?.[asset.id]?.[0] ?? asset.avg));
    const gainOf = (c) =>
      pFind(c) * (ref - shrinkTo(cond.units[c.apiName], ref));
    const pool = available.filter(
      (c) =>
        c !== asset.champion && (cond.units[c.apiName]?.[1] ?? 0) >= MIN_GAMES,
    );
    // Variantes: só pelas peças, ou puxando uma das duas sinergias que mais rendem com o trunfo (patamar 2+).
    const traitPicks = Object.entries(cond.traits)
      .map(([k, st]) => {
        const [api, tier] = k.split("|");
        return {
          api,
          tier: Number(tier),
          avg: shrinkTo(st, ref),
          games: st[1],
        };
      })
      .filter(
        (t) => t.tier >= 2 && t.games >= MIN_GAMES && traitByApi.has(t.api),
      )
      .sort((x, y) => x.avg - y.avg)
      .slice(0, 2);
    for (const variant of [null, ...traitPicks]) {
      // Peças suas ligadas ao aprimoramento entram junto (Aminimigos: Rengar e Kha'Zix no mesmo tabuleiro).
      const linked = asset.augment
          ? candidates.filter(
              (c) =>
                c !== asset.champion &&
                own.has(key(c)) &&
                traitsOf(c).some((t) => augTraits.has(t)),
            )
          : [],
        board = [asset.champion, ...linked],
        need = variant
          ? (thresholdsOf(traitByApi.get(variant.api))[variant.tier - 1] ?? 0)
          : 0,
        name = variant ? traitByApi.get(variant.api) : null,
        order = pool
          .map((c) => ({
            c,
            gain: gainOf(c),
            hasTrait: !!name && traitsOf(c).includes(name),
          }))
          .sort((x, y) => y.gain - x.gain);
      const count = () =>
        board.filter((c) => name && traitsOf(c).includes(name)).length;
      for (const r of order) {
        if (board.length >= growTo) break;
        if (board.includes(r.c)) continue; // peça ligada ao aprimoramento já está no tabuleiro
        if (name && count() < need && !r.hasTrait) continue;
        if (!legal([...board, r.c])) continue;
        board.push(r.c);
      }
      for (const r of order) {
        if (board.length >= growTo) break;
        if (!board.includes(r.c) && legal([...board, r.c])) board.push(r.c);
      }
      if (variant && count() < need) continue;
      const component = score(board, null);
      component.fit =
        component.preservation +
        component.items +
        component.access +
        component.matchup -
        component.dispute;
      component.total = component.fit;
      advantage.push({
        board,
        component,
        carry: asset.champion,
        focus: name,
        freeId: `free:${asset.id}${variant ? `:${variant.api}` : ""}`,
        asset,
        core: [
          ...(variant ? [traitAt(variant.api, variant.tier)] : []),
          ...order
            .filter((r) => board.includes(r.c))
            .slice(0, 3)
            .map((r) => r.c),
        ],
      });
    }
  }
  // O seu tabuleiro de agora também concorre: é o que fica se a troca não der certo.
  const onBoard = candidates.filter((c) => own.get(key(c))?.onBoard);
  const ownAvg = (c) => {
    const u = own.get(key(c));
    return (
      stats?.unit?.[
        `${c.apiName}|${u.stars}|${Math.min(3, u.items.length)}`
      ]?.[0] ?? baseAvg
    );
  };
  const current = onBoard.length
    ? (() => {
        // Peças principais do seu tabuleiro: trunfos (e as do aprimoramento) primeiro, depois quem carrega mais
        // itens e o custo; as de enchimento do começo de jogo ficam por último.
        const isAsset = (c) => assets.some((x) => x.champion === c),
          order = [...onBoard].sort(
            (x, y) =>
              isAsset(y) - isAsset(x) ||
              own.get(key(y)).items.length - own.get(key(x)).items.length ||
              y.cost - x.cost ||
              ownAvg(x) - ownAvg(y),
          ),
          component = score(order, null);
        component.fit =
          component.preservation +
          component.items +
          component.access +
          component.matchup -
          component.dispute;
        component.total = component.fit;
        return {
          board: order,
          component,
          carry: order[0],
          focus: null,
          freeId: "free:current",
          current: true,
          core: order.slice(0, 4),
        };
      })()
    : null;
  if (current) advantage.push(current);
  // O plano sugerido antes (options.sticky: id e peças) concorre sempre, mesmo que não seja mais gerado — é o
  // que você está montando. Só sai se perder com folga (ver a troca mais abaixo).
  const sticky = options.sticky ?? null;
  // "free:current" não vira cópia congelada: o tabuleiro atual já é regerado acima com esse freeId.
  if (sticky?.id && sticky.id !== "free:current" && sticky.units?.length) {
    // Comp de meta tem peças fixas; tabuleiro de vantagem seria regerado a cada leitura com peças diferentes.
    // O plano em andamento mantém as peças que já tinha e só cresce quando o nível sobe (nunca troca peça).
    const isMeta = ranked.some((r) => r.meta?.id === sticky.id);
    const kept0 = sticky.units
      .map((id) => byId.get(id))
      .filter((c) => c && candidates.includes(c));
    const board = kept0.length < growTo ? extend(kept0, growTo).board : kept0;
    if (!isMeta && kept0.length >= 3 && legal(board)) {
      for (let i = advantage.length - 1; i >= 0; i--)
        if (advantage[i].freeId === sticky.id && !advantage[i].current)
          advantage.splice(i, 1);
      const component = score(board, null);
      component.fit =
        component.preservation +
        component.items +
        component.access +
        component.matchup -
        component.dispute;
      component.total = component.fit;
      const carry = byId.get(sticky.carry) ?? board[0];
      advantage.push({
        board,
        component,
        carry: board.includes(carry) ? carry : board[0],
        focus: null,
        freeId: sticky.id,
        kept: true,
        title: sticky.title ?? null,
        // A mesma pergunta com que o plano foi medido quando foi escolhido (sinergia mirada + peças principais):
        // medir o mesmo tabuleiro com outra pergunta o fazia perder para a própria versão "nova".
        core: sticky.core?.length
          ? sticky.core
              .map((x) => (x.startsWith("trait=") ? x : byId.get(x)))
              .filter(Boolean)
          : [carry, ...board.filter((c) => c !== carry)].slice(0, 4),
        // O trunfo da pergunta guardada, como foi perguntado — mesmo que hoje ele não esteja entre os 2 trunfos.
        asset: (() => {
          const c =
              sticky.asset && sticky.assetFilter
                ? byId.get(sticky.asset)
                : null,
            u = c && own.get(key(c));
          if (!u) return null;
          const items = Math.min(3, u.items.length),
            live = assets.find((a) => a.champion === c);
          let filter = sticky.assetFilter;
          // Filtro exato de outro estado (ex.: 2★ 2 itens e a peça já está 3★ 3 itens): mede como os candidatos novos medem.
          if (
            !filter.includes(",") &&
            filter !== exactUnit(c.apiName, u.stars, items)
          )
            filter = live?.filter ?? anyUnit(c.apiName);
          const exact = !filter.includes(",");
          return {
            id: c.apiName,
            champion: c,
            filter,
            exact,
            stars: exact ? u.stars : (live?.stars ?? u.stars),
            starsNow: u.stars,
            items,
            avg:
              (exact
                ? stats?.unit?.[`${c.apiName}|${u.stars}|${items}`]?.[0]
                : null) ??
              stats?.unit?.[c.apiName]?.[0] ??
              baseAvg,
            pReach: 1,
          };
        })(),
      });
    }
  }
  // Pergunta de evidência de cada candidato: o trunfo que está nele (exato) + as peças principais presentes.
  // Prefixos da mais curta à mais longa; vale a mais longa com amostra suficiente. Sem filtro de nível: filtrar
  // pelo nível final pune comps de nível 9 (no 8 só ficam as que morreram antes) e não filtrar favorece peças
  // caras (quem as tem já sobreviveu); o custo de chegar lá entra pela chance de montar (lojas do seu nível).
  const coreOf = (r) => {
    if (r.core) return r.core;
    const holders = buildHolders(r.meta);
    return [
      r.carry,
      ...r.board.filter((c) => holders.includes(c.apiName) && c !== r.carry),
    ]
      .concat(
        r.board
          .filter((c) => c !== r.carry && !holders.includes(c.apiName))
          .sort((x, y) => y.cost - x.cost),
      )
      .slice(0, 3);
  };
  const assetIn = (r) =>
    r.asset ?? assets.find((x) => r.board.includes(x.champion)) ?? null;
  // Itens que você já tem e vão para o tabuleiro final: prontos no banco ou equipados em peça que sai da comp
  // (movem-se para o tabuleiro), e emblemas dados por aprimoramento. Entram na pergunta ("tabuleiros com estas peças
  // e com este item"), então cada tabuleiro é medido com os seus itens. Os dois de melhor colocação medida
  // (meta-builds) primeiro, para a amostra não acabar.
  const itemCat = new Map(catalog.items.map((i) => [i.apiName, i])),
    itemAvg = (id) => options.itemStats?.[id]?.avg ?? baseAvg,
    myItemsFor = (board) =>
      [
        ...new Set([
          ...movable(board).ids.filter((id) => !!recipeOf(itemCat.get(id))),
          ...(options.augmentEmblems ?? []),
        ]),
      ]
        .sort((x, y) => itemAvg(x) - itemAvg(y))
        .slice(0, 2);
  // Espátula/Frigideira: o emblema que dá para montar com o banco (ou com peças que saem da comp) e que mais melhora
  // este tabuleiro, pelo efeito medido do patamar de sinergia que ele fecha (meta-stats: sinergia × patamar).
  function emblemFor(board) {
    const have = movable(board).ids,
      tools = have.filter(isEmblemTool);
    if (!tools.length || !stats) return null;
    const ts = new Map(traits(board).map((t) => [t.name, t]));
    let best = null;
    for (const e of emblemRecipes) {
      const tool = tools.find((t) => e.parts.includes(t));
      if (!tool) continue;
      const other = e.parts[0] === tool ? e.parts[1] : e.parts[0];
      if (
        !have.includes(other) ||
        (other === tool && have.filter((x) => x === tool).length < 2)
      )
        continue;
      const def = traitMap.get(e.trait);
      if (!def || !board.some((c) => !traitsOf(c).includes(e.trait))) continue;
      const t = ts.get(e.trait),
        th = thresholdsOf(e.trait),
        tier = t?.tier ?? 0,
        next = th.filter((n) => n <= (t?.count ?? 0) + 1).length;
      if (next <= tier) continue;
      const at = (k) =>
          k ? (stats.trait?.[`${def.apiName}|${k}`]?.[0] ?? baseAvg) : baseAvg,
        gain = at(tier) - at(next);
      if (gain > 0 && (!best || gain > best.gain))
        best = { id: e.id, name: e.name, trait: e.trait, gain };
    }
    return best;
  }
  function questions(r) {
    const asset = assetIn(r),
      start = asset ? [asset.filter] : [],
      core = coreOf(r).filter((c) => c !== asset?.champion),
      emblem = emblemFor(r.board),
      mine = myItemsFor(r.board),
      extras = [
        ...mine,
        ...(emblem && !mine.includes(emblem.id) ? [emblem.id] : []),
      ].map((id) => `item=${id}`),
      // Aprimoramento escolhido que mexe numa sinergia (Aminimigos → Rival com as duas peças): a pergunta exige a
      // sinergia no patamar deste tabuleiro, então a medição é de tabuleiros com o mesmo efeito do aprimoramento.
      augmented = traits(r.board)
        .filter(
          (t) =>
            (options.augmentTraits ?? []).includes(t.name) &&
            t.tier > 0 &&
            traitMap.get(t.name),
        )
        .map((t) => traitAt(traitMap.get(t.name).apiName, t.tier)),
      // Uma sinergia só tem um patamar por tabuleiro: a do aprimoramento (patamar do tabuleiro) substitui a mesma
      // sinergia vinda das peças principais (repetida ou em outro patamar, que voltaria com 0 partidas).
      traitApi = (f) =>
        typeof f === "string" ? /^trait=(.+)_\d+$/.exec(f)?.[1] : undefined,
      augApis = new Set(augmented.map(traitApi)),
      dropped = new Set(core.map(traitApi).filter((a) => a && augApis.has(a))),
      coreQ = core.filter((c) => !dropped.has(traitApi(c))),
      merged = augmented.filter((f) => dropped.has(traitApi(f))),
      steps = [
        ...augmented,
        ...coreQ.map((c) => (typeof c === "string" ? c : presence(c))),
        ...extras,
      ],
      out = [];
    for (let k = asset ? 0 : 1; k <= steps.length; k++)
      out.push([...start, ...steps.slice(0, k)]);
    return {
      asset,
      core: coreQ,
      emblem,
      extras,
      augmented,
      merged,
      sets: out.filter((f) => f.length),
    };
  }
  // "trait=DA_18_Rival_3" → "Rival 3".
  const traitLabel = (f) => {
    const m = /^trait=(.+)_(\d+)$/.exec(f);
    return m ? `${traitByApi.get(m[1]) ?? m[1]} ${m[2]}` : f;
  };
  // Comp de meta mais parecida com um tabuleiro (para o tier dos aprimoramentos); null abaixo de 50% das peças.
  const nearestCluster = (board) => {
    let best = null,
      share = 0.5;
    for (const m of options.metaComps ?? []) {
      const n =
        m.units.filter((id) => board.some((c) => c.apiName === id)).length /
        m.units.length;
      if (n >= share) {
        share = n;
        best = m.id;
      }
    }
    return best;
  };
  const augmentTraitIds = (id) => options.augmentTraitsById?.[id] ?? [];
  function measure(r) {
    const { asset, core, emblem, extras, augmented, merged, sets } =
      questions(r);
    let best = null,
      depth = 0,
      starved = false;
    sets.forEach((f, i) => {
      const k = filterKey(f);
      if (!evidence?.has(k)) {
        if (!starved) requests.set(k, f);
        return;
      }
      const e = evidence.get(k);
      // Filtros com "e": prefixo mais longo só tem menos partidas. null (falha de rede) não conta como amostra pequena.
      if (e && e.games < MIN_GAMES) starved = true;
      if (e?.avg != null && e.games >= MIN_GAMES) {
        best = e;
        depth = i;
      }
    });
    if (!best) return null;
    // Passos usados na pergunta escolhida: sinergias do aprimoramento, depois peças, depois itens.
    const reach = depth + (asset ? 0 : 1),
      augUsed = augmented.slice(0, reach),
      coreSteps = core.slice(0, Math.max(0, reach - augmented.length)),
      used = coreSteps.filter((c) => typeof c !== "string"),
      itemsUsed = extras.slice(
        0,
        Math.max(0, reach - augmented.length - core.length),
      );
    // Chance de montar o que foi medido: ter as peças da pergunta (o trunfo já é seu) e, para cada patamar de
    // sinergia na pergunta, as peças do tabuleiro que o fecham — medir só quem fechou o patamar sem descontar a
    // chance de fechá-lo dava vantagem de graça às perguntas com sinergia.
    // Inclui a sinergia da variante que se fundiu à do aprimoramento (questions: merged), se entrou na pergunta.
    const traitUnits = [
      ...coreSteps,
      ...augUsed.filter((f) => merged.includes(f)),
    ]
      .filter((x) => typeof x === "string" && x.startsWith("trait="))
      .flatMap((f) => {
        const m = /^trait=(.+)_(\d+)$/.exec(f),
          name = m && traitByApi.get(m[1]);
        if (!name) return [];
        const need = thresholdsOf(name)[Number(m[2]) - 1] ?? 0;
        return r.board
          .filter((c) => traitsOf(c).includes(name))
          .sort((x, y) => pFind(y) - pFind(x))
          .slice(0, need);
      });
    // Chance de montar o que foi medido: o alcance conjunto dessas peças (core/comps/reach.mjs: uma cópia de cada, no
    // prazo da comp, com o ouro, o nível e a vida de agora), não a de cada peça com todo o ouro como se fosse a única.
    const p = reachOf(r, [...new Set([...used, ...traitUnits])]).chance,
      fallback = r.current ? best.avg : (currentMeasured ?? NOT_BUILT);
    const augAdj = augAdjOf(r, augUsed);
    const expected =
      p * best.avg + (1 - p) * fallback + augAdj.reduce((n, x) => n + x.adj, 0);
    // Incerteza da colocação esperada: erro da média medida, pesado pela chance de montar.
    const se = Math.max(p, 0.2) * (PLACEMENT_SD / Math.sqrt(best.games));
    return {
      expected: Math.round(expected * 100) / 100,
      measured: best.avg,
      games: best.games,
      top4: best.top4,
      chance: Math.round(p * 100) / 100,
      se: Math.round(se * 1000) / 1000,
      basis: [
        ...(asset
          ? [
              asset.exact
                ? `${asset.champion.name} ${asset.stars}★ ${asset.items} itens`
                : `${asset.champion.name} (hoje ${asset.starsNow}★, alvo ${asset.stars}★)`,
            ]
          : []),
        ...augUsed.map((f) => `${traitLabel(f)} (aprimoramento)`),
        ...coreSteps.filter((c) => typeof c === "string").map(traitLabel),
        ...used.map((c) => c.name),
        ...itemsUsed.map((f) => itemCat.get(f.slice(5))?.name ?? f.slice(5)),
      ],
      emblem: emblem
        ? { id: emblem.id, name: emblem.name, trait: emblem.trait }
        : null,
      augments: augAdj,
    };
  }
  // Aprimoramentos escolhidos que a pergunta não mediu (os que não viram sinergia; sem evidência, todos): o tier deles
  // nesta comp, na régua da MetaTFT (S −0,30 … D +0,30). Tabuleiro sem comp de meta usa a comp de meta mais parecida (50%+).
  function augAdjOf(r, augUsed = []) {
    const cluster = r.meta?.id ?? nearestCluster(r.board);
    return (options.augments ?? [])
      .filter(
        (id) =>
          !augUsed.length ||
          !augmentTraitIds(id).some((t) =>
            augUsed.some((f) => f.includes(`=${t}_`)),
          ),
      )
      .map((id) => ({
        id,
        tier: options.augmentStats?.compTiers?.[cluster]?.[id] ?? null,
      }))
      .filter((x) => x.tier && TIER_PLACE[x.tier] != null)
      .map((x) => ({
        ...x,
        name: options.augmentNames?.[x.id] ?? x.id,
        adj: TIER_PLACE[x.tier],
      }));
  }
  // Alcance de cada comp (core/comps/reach.mjs): a chance de montá-la a tempo com o que você tem, a pool livre, os rivais,
  // o ouro (recuperado das lojas ao alcance, a única forma em que o motor o recebe), o nível e a vida. Prazo: o ponto de
  // poder da comp (nível de reroll, "Fast N" ou o tamanho do tabuleiro); estrela-alvo: as 3★ da comp reroll, o carry 2★
  // (custo até REACH.carryTwoStarMaxCost) e 1★ no resto. `pieces` (opcional) restringe às peças medidas, 1 cópia cada
  // (a pergunta de evidência mede a presença); com `goals`, essas peças mantêm a estrela-alvo da comp (sem evidência, é
  // assim que a estrela das suas cópias entra numa pergunta parcial).
  const reachGold = goldForShops(shops),
    reachHorizons = new Map(),
    reached = new Map(),
    shopCards = (c) =>
      (options.shop ?? []).filter((id) => id === c.apiName).length;
  function reachOf(r, pieces = null, { goals = false } = {}) {
    if (!pieces && reached.has(r)) return reached.get(r);
    const power = powerLevelOf({
      rerollLevel: r.meta?.rerollLevel ?? null,
      levelling: r.meta?.levelling ?? null,
      size: r.board.length,
    });
    let horizon = reachHorizons.get(power);
    if (!horizon)
      reachHorizons.set(
        power,
        (horizon = reachHorizon({
          stage: options.stage ?? null,
          powerLevel: power,
          hp: Number.isFinite(self.health) ? self.health : null,
          trend: options.trend ?? null,
          gold: reachGold,
        })),
      );
    const core = new Set([
        r.carry,
        ...coreOf(r).filter((c) => typeof c !== "string"),
      ]),
      threes = r.meta?.rerollLevel ? (r.meta.stars3 ?? []) : [],
      goalOf = (c) =>
        pieces && !goals
          ? 1
          : threes.includes(c.apiName)
            ? 3
            : c === r.carry && c.cost <= REACH.carryTwoStarMaxCost
              ? 2
              : 1;
    const out = compReach({
      pieces: (pieces ?? r.board).map((c) => ({
        id: c.apiName,
        name: c.name,
        cost: c.cost,
        own: own.get(key(c))?.copies ?? 0,
        // Peça só na reserva (GEP): já é sua (não se compra de novo) e soma cópias para a estrela.
        onBoard: !!own.get(key(c))?.onBoard,
        goal: goalOf(c),
        free: free(key(c)),
        upper: upper(key(c)),
        rivals: rivals.get(key(c))?.size ?? 0,
        seen: shopCards(c),
        weight: pieces || core.has(c) ? 1 : REACH.flexWeight,
      })),
      denom: denomByCost,
      level,
      maxLevel: Math.max(boardLevel, power),
      horizon,
      gold: reachGold,
      benchKnown: options.benchKnown ?? null,
    });
    if (!pieces) reached.set(r, out);
    return out;
  }
  const currentEv = current ? measure(current) : null,
    currentMeasured = currentEv?.measured ?? null,
    currentTop4 = currentEv?.top4 ?? null;
  for (const r of [...ranked, ...advantage]) {
    r.component.itemPlan ??= planFor(r.board, r.meta ?? null);
    const ev = measure(r);
    if (!ev) continue;
    r.component.evidence = ev;
    r.component.total = (baseAvg - ev.expected) * PLACEMENT_POINTS;
    // Itens que você tem, comp a comp (plano de itens): soma parte do total acumulado ao valor medido.
    if (r.component.itemPlan.active)
      r.component.total +=
        EVIDENCE_ITEM_SHARE * planPoints(r.component.itemPlan.total);
  }
  // COLOCAÇÃO ESPERADA (E): a medida única das comps. Ordena as sugeridas, decide a troca do plano em andamento e é o que
  // a tela mostra (o score 0–100 é só E numa régua: comp-score.mjs, scoreFromExpected). Mesma conta com e sem evidência:
  //   E = p · (média + aprimoramentos − itens do plano + descarte do aprimoramento) + (1 − p) · reserva
  // - p: chance de ter a comp no prazo, pelo alcance (reachOf: o que você tem em campo e na reserva, as estrelas, prazo,
  //   ouro, nível, vida, pool e rivais): com evidência, a menor entre a presença das peças medidas e a parte esperada da
  //   comp; sem ela, a parte esperada. O risco de não montar está em p e na reserva;
  // - média: a medida (evidence.mjs) ou, sem ela, a média publicada ajustada aos seus itens (item-edge.mjs);
  // - reserva: o seu tabuleiro atual medido (ou NOT_BUILT, política): é onde você fica se não montar;
  // - aprimoramentos: o tier de cada aprimoramento escolhido nesta comp (augAdjOf); itens do plano: a mesma parte do plano
  //   de itens que a pontuação medida somava (EVIDENCE_ITEM_SHARE × planPoints, convertida em colocações);
  // - descarte: tabuleiro que joga fora a sinergia de um aprimoramento escolhido soma AUGMENT_DROP (política). Antes
  //   isso e a "aposta" (p < 50%) eram degraus da ordem; agora entram em E, sem salto em p = 0,49 contra 0,50.
  const usesAugment = (r) =>
    !augTraits.size ||
    traits(r.board).some((t) => augTraits.has(t.name) && t.tier > 0);
  const round2 = (x) => Math.round(x * 100) / 100;
  function expectedOf(r) {
    const c = r.component,
      ev = c.evidence ?? null;
    if (c.expected) return c.expected;
    const fallback = currentMeasured ?? NOT_BUILT;
    let p, avg, top4, aug;
    if (ev) {
      // A média medida é de tabuleiros que TINHAM a comp; a pergunta mede poucas peças (a presença delas é ev.chance), mas
      // as de fora dela também precisam chegar. p = a menor entre a chance das peças medidas e a parte esperada da comp
      // no prazo (reachOf().share, com as estrelas e a reserva). O seu tabuleiro atual é seu: p = 1.
      p = r.current ? 1 : Math.min(ev.chance, reachOf(r).share);
      avg = ev.measured;
      top4 = ev.top4 ?? null;
      aug = (ev.augments ?? []).reduce((n, x) => n + x.adj, 0);
    } else {
      // Sem a pergunta medida, p é a PARTE ESPERADA da comp no prazo (reachOf().share: cada peça pela chance de tê-la,
      // a estrela-alvo pela chance de fechá-la, contando campo e reserva). A chance de montar tudo (`chance`) quase
      // sempre é ~0 no meio da partida e deixaria todas as comps iguais à reserva; a parte esperada é graduada.
      p = reachOf(r).share;
      avg = c.edge?.adjustedAvg ?? r.meta?.avg ?? baseAvg;
      top4 = r.meta?.top4 ?? null;
      aug = augAdjOf(r).reduce((n, x) => n + x.adj, 0);
    }
    // O que é desta comp (aprimoramentos nela, itens do plano nos campeões dela, descarte da sinergia) só vale se ela
    // for montada: entra junto da média, pesado por p. Sem montar, você fica na reserva.
    const items = c.itemPlan?.active
        ? (EVIDENCE_ITEM_SHARE * planPoints(c.itemPlan.total)) /
          PLACEMENT_POINTS
        : 0,
      drop = usesAugment(r) ? 0 : AUGMENT_DROP,
      built = avg + aug - items + drop;
    return (c.expected = {
      value: round2(p * built + (1 - p) * fallback),
      top4:
        top4 == null
          ? null
          : Math.round((p * top4 + (1 - p) * (currentTop4 ?? 50)) * 10) / 10,
      p: round2(p),
      avg,
      built: round2(built),
      fallback: round2(r.current ? avg : fallback),
      items: round2(items),
      augments: round2(aug),
      dropAugment: drop,
      measured: !!ev,
    });
  }

  // Score de cada comp (comp-score.mjs): E na régua de 0 a 100, com as partes (itens, o que você tem, força, alcance,
  // loja, disputa) só como informação.
  const shopIds = new Set((options.shop ?? []).filter(Boolean));
  // O que você já tem da comp, de 0 a 1, ponderado pelo custo (um custo 4 pesa mais que um custo 1): 1★ vale 0,35, 2★ 0,65
  // e 3★ 1 (fatores de POLÍTICA, não medidos); a peça que ainda pode subir de estrela (cópias que faltam × pool × lojas do
  // seu nível) soma até a metade do que falta até o 1. Peça que você não tem vale 0. Só INFORMA (parte `held` da tela):
  // a estrela das suas peças entra em E pela medida (trunfos: colocação medida na estrela atual e na alcançável) e pelo
  // alcance até a estrela-alvo (cópias que faltam, contando campo e reserva).
  const heldOf = (r) => {
    let got = 0,
      all = 0;
    for (const c of r.board) {
      all += c.cost;
      const u = own.get(key(c));
      if (!u) continue;
      const base = u.stars >= 3 ? 1 : u.stars === 2 ? 0.65 : 0.35,
        need = starCopies(u.stars + 1) - u.copies,
        up =
          u.stars >= 3 || need <= 0
            ? u.stars >= 3
              ? 0
              : 1
            : upper(key(c)) >= need
              ? atLeast(probability(c, level), need)
              : 0;
      got += c.cost * Math.min(1, base + (1 - base) * 0.5 * up);
    }
    return all ? got / all : 0;
  };
  for (const r of [...ranked, ...advantage]) {
    const c = r.component,
      e = expectedOf(r);
    // Uma medida só na tela: a evidência passa a mostrar E (a conta da pergunta medida fica em `questionExpected`). Antes a
    // lista "medidos" mostrava a colocação da pergunta (4,09 contra 3,92) e a ordem seguia E (3,82 contra 3,82).
    if (c.evidence) {
      c.evidence.questionExpected = c.evidence.expected;
      c.evidence.expected = e.value;
    }
    c.compScore = compScore({
      expected: e.value,
      top4: e.top4,
      itemGain: c.edge?.gain ?? 0,
      carryItems: c.buildFit?.carryHits ?? 0,
      carryWanted: c.buildFit?.carryWanted ?? 0,
      itemPlan: c.itemPlan?.active ? c.itemPlan.total : null,
      reach: (c.reach = reachOf(r)).share,
      chance: c.reach.chance,
      held: heldOf(r),
      shopHits: r.board.filter(
        (x) => !own.has(key(x)) && shopIds.has(x.apiName),
      ).length,
      dispute: c.dispute ?? 0,
    });
  }
  // Ordem: E (menor é melhor). Empate: a mais garantida (p maior: o seu tabuleiro atual ganha de uma comp que vale o
  // mesmo só porque não vai ser montada); depois a pontuação antiga (`total`).
  const expectedValue = (r) => r.component.expected?.value ?? baseAvg,
    byExpected = (a, b) =>
      expectedValue(a) - expectedValue(b) ||
      (b.component.expected?.p ?? 0) - (a.component.expected?.p ?? 0) ||
      b.component.total - a.component.total;
  // Com evidência, só concorre quem foi medido; sem ela (offline), as comps de meta.
  const measured = (r) => !!r.component.evidence;
  const anyMeasured = [...ranked, ...advantage].some(measured);
  const overlaps = (r, s) =>
    r.board.filter((c) => s.board.includes(c)).length / r.board.length > 0.85;
  // Informação (não ordena mais): tabuleiro com menos de 50% de chance de montar é "aposta"; o que descarta a sinergia
  // de um aprimoramento escolhido é marcado.
  for (const r of advantage.concat(ranked))
    if (r.component.evidence) {
      r.component.evidence.bet = (r.component.evidence.chance ?? 1) < 0.5;
      r.component.evidence.dropsAugment = !usesAugment(r);
    }
  const contenders = (
    anyMeasured ? [...ranked, ...advantage].filter(measured) : ranked
  ).sort(byExpected);
  // Troca de plano (regra aprovada): o melhor agora substitui o plano em andamento quando
  //   E_mantido − E_desafiante > custo de trocar + HYSTERESIS
  // A incerteza das médias já entra pelo encolhimento delas (shrinkTo, MIN_GAMES): não há mais o termo Z95·se aqui (o `se`
  // segue só como informação). O custo é o que se perde de fato (switchCost). A confirmação (plan-state.mjs) pede que o
  // desafiante lidere de novo depois de um FATO NOVO: `options.holdPlan` é `true` (segura), `false` (sem plano) ou
  // `{ release: id }` (segura, menos para o desafiante que já liderava antes do fato novo).
  const stage =
    options.stage?.stage ??
    (level >= 8 ? 5 : level >= 7 ? 4 : level >= 6 ? 3 : 2);
  // Custo de trocar, em colocações (política, não medida): a tabela por estágio (SWITCH_COST: abandonar tudo o que você
  // tem do plano) vezes a parte do que você tem nele (custo × cópias) que o desafiante não reaproveita, mais cada item
  // equipado nessas peças, que precisa mover (SWITCH.itemMove), e o ouro a mais que o desafiante pede para montar
  // (alcance: custo esperado até 50%), a SWITCH.goldPerPlacement de ouro por colocação. O tempo até o ponto de poder já
  // está no p de E.
  function switchCost(kept, top) {
    const value = (c) => c.cost * (own.get(key(c))?.copies ?? 0),
      mine = kept.board.filter((c) => own.has(key(c))),
      lost = mine.filter((c) => !top.board.includes(c)),
      total = mine.reduce((n, c) => n + value(c), 0),
      lostShare = total ? lost.reduce((n, c) => n + value(c), 0) / total : 0,
      items = lost.reduce(
        (n, c) => n + (own.get(key(c))?.items.length ?? 0),
        0,
      ),
      goldTop = top.component.reach?.gold ?? top.component.reach?.budget ?? 0,
      goldKept = kept.component.reach?.gold ?? 0,
      gold = Math.max(0, goldTop - goldKept),
      pieces =
        (SWITCH_COST[Math.min(5, Math.max(1, stage))] ?? 0.8) * lostShare;
    return {
      value: pieces + items * SWITCH.itemMove + gold / SWITCH.goldPerPlacement,
      pieces: round2(pieces),
      items,
      gold,
      lostShare: round2(lostShare),
      lost: lost.map((c) => c.name),
    };
  }
  let switchNote = null;
  // A comp que a medida escolhe agora (antes da histerese): é ela a "melhor comp" do ranking, mesmo se o plano em
  // andamento for mantido à frente por não ter passado da margem de troca.
  const leader = contenders[0] ?? null;
  const keptAt = sticky?.id
    ? contenders.findIndex((r) => (r.meta?.id ?? r.freeId) === sticky.id)
    : -1;
  if (keptAt > 0) {
    const top = contenders[0],
      kept = contenders[keptAt],
      topId = top.meta?.id ?? top.freeId ?? null,
      gain = expectedValue(kept) - expectedValue(top),
      cost = switchCost(kept, top),
      wins = gain > cost.value + HYSTERESIS,
      hold =
        options.holdPlan === true ||
        (options.holdPlan?.release != null &&
          options.holdPlan.release !== topId),
      keep = !wins || hold;
    switchNote = {
      kept: keep,
      // Venceu a margem, mas espera o fato novo (plan-state.mjs).
      held: wins && keep,
      fromId: kept.meta?.id ?? kept.freeId ?? null,
      toId: topId,
      from: kept.meta?.title ?? kept.title ?? kept.carry.name,
      to: top.meta?.title ?? top.title ?? top.carry.name,
      // Em colocações: E do mantido e do desafiante, a vantagem, o custo de trocar e a histerese.
      expectedFrom: expectedValue(kept),
      expectedTo: expectedValue(top),
      gain: round2(gain),
      cost: round2(cost.value),
      hysteresis: HYSTERESIS,
      costParts: cost,
      stage,
      unit: "placement",
    };
    if (keep) contenders.unshift(...contenders.splice(keptAt, 1));
  }
  // Confiança da escolha: quão claramente o 1º supera o 2º (diferença ÷ incerteza combinada).
  if (
    contenders.length > 1 &&
    contenders[0].component.evidence &&
    contenders[1].component.evidence
  ) {
    const a = contenders[0].component.evidence,
      b = contenders[1].component.evidence,
      z =
        (b.expected - a.expected) /
        Math.max(0.01, Math.hypot(a.se ?? 0, b.se ?? 0));
    a.confidence = {
      z: Math.round(z * 100) / 100,
      level: z >= Z95 ? "alta" : z >= 0.5 ? "média" : "baixa",
      over:
        contenders[1].meta?.title ??
        contenders[1].title ??
        contenders[1].carry.name,
      margin: Math.round((b.expected - a.expected) * 100) / 100,
      // Mesma incerteza (95%) usada no nível e na troca de plano, para a tela não refazer a conta.
      noise: Math.round(Z95 * Math.hypot(a.se ?? 0, b.se ?? 0) * 100) / 100,
    };
    if (switchNote) a.switch = switchNote;
  } else if (switchNote && contenders[0].component.evidence)
    contenders[0].component.evidence.switch = switchNote;
  // A nota da troca também fica no plano mostrado sem evidência (offline): o rastreador do plano a lê dali.
  if (switchNote) contenders[0].component.switch = switchNote;
  const contendersAll = contenders;
  for (const r of contenders) {
    if (
      selected.some(
        (s) => overlaps(r, s) || (r.freeId && r.freeId === s.freeId),
      )
    )
      continue;
    selected.push(r);
    if (selected.length === 3) break;
  }
  if (ranked.length) {
    const round = (n) => Math.round(n * 10) / 10;
    // Posição = ordem final de escolha (contenders, já com aprimoramento/aposta/troca de plano); as não medidas
    // vêm depois, pelo total. Sem isso, com evidência o rank seguia a conta heurística anterior.
    const order = new Map(contendersAll.map((r, i) => [r, i]));
    compRanking = [...ranked]
      .sort(
        (a, b) =>
          (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) ||
          byExpected(a, b),
      )
      .map((r, index) => ({
        id: r.meta.id,
        rank: index + 1,
        suggested: selected.includes(r),
        total: round(r.component.total),
        // Colocação esperada E (a medida única), top 4 da mesma conta e o score (E na régua 0-100, comp-score.mjs);
        // "best" = a melhor comp para você agora pela medida (antes da histerese da troca de plano).
        expected: r.component.expected?.value ?? null,
        top4: r.component.expected?.top4 ?? null,
        // A conta de E: p, a colocação montada (média + aprimoramentos − itens + descarte) e a reserva.
        expectedParts: r.component.expected ?? null,
        score: r.component.compScore.score,
        best: ranked.includes(leader) ? r === leader : index === 0,
        // Plano em andamento mantido à frente de uma comp de score maior (a nota da troca diz por quê).
        kept: !!switchNote?.kept && r === contendersAll[0] && r !== leader,
        chance: r.component.compScore.chance,
        scoreParts: r.component.compScore.parts,
        contestFactor: r.component.compScore.contest,
        // Nível em que o alcance foi medido (o melhor entre o de agora e o alvo) e a conta em uma linha.
        level: r.component.reach?.level ?? level,
        reach: r.component.reach ?? null,
        fit: round(r.component.fit),
        owned: r.board.filter((c) => own.has(key(c))).length,
        size: r.board.length,
        dispute: round(r.component.dispute),
        carryItems: r.component.buildFit.carryHits,
        carryWanted: r.component.buildFit.carryWanted,
        // Onde estão os itens da build desta comp (no lugar, banco, mover de quem sai, montar, falta): item-holdings.mjs.
        itemHoldings: r.component.buildFit.holdings,
        // Plano de itens: atribuições (campeão, item, valor, situação), total acumulado, campeões por impacto e a lista
        // de desejos do meta; sem o banco lido, só a lista de desejos (item-plan.mjs).
        itemPlan: r.component.itemPlan,
        adjustedAvg: r.component.edge.adjustedAvg,
        itemTier: tierOf(r.component.edge.adjustedAvg),
        itemGain: r.component.edge.gain,
        itemGains: r.component.edge.gains,
        emblem: r.component.emblem?.picks ?? [],
        // Colocação esperada medida (trunfo + peças principais) e a chance de montar; null sem evidência.
        evidence: r.component.evidence ?? null,
      }));
  }
  const reserve = (options.bench ?? [])
    .filter((u) => String(u.playerId) === String(self.playerId))
    .map((u) => ({
      ...u,
      id: u.championName,
      name: byId.get(u.championName)?.name ?? u.championName,
      stars: u.starLevel,
      cost: byId.get(u.championName)?.cost ?? 0,
      source: u.source ?? "manual",
      ...unitTraits(u),
    }));
  // Substituições: a comp de meta é um ponto de partida. Para cada peça (menos o carry), campeões de custo
  // próximo e mesmo papel (tanque ou dano) que mantêm as sinergias, ordenados pelo que a partida favorece:
  // peça que já é sua, pouca disputa na pool, chance na loja. A peça é marcada quando está disputada pelos
  // rivais, esgotada ou fora do alcance da loja no nível alvo — aí a melhor alternativa vira sugestão.
  const poolByKey = new Map(pool.map((p) => [p.name, p]));
  const traitTiers = (board) =>
    traits(board).filter((t) => t.active && !t.solo);
  const shopOk = (c) => isBuyable(boardLevel, c.cost);
  const reachable = (c) => own.has(key(c)) || (upper(key(c)) > 0 && shopOk(c));
  const access = (c) => Math.log(1 + probability(c, boardLevel) * 100);
  // Contexto das trocas: quanto cada peça rende junto com o seu trunfo principal (MetaTFT), encolhido para a
  // média do trunfo quando a amostra é pequena. É o "a Lillia segura a frente dos seus cores" medido.
  const mainAsset = assets[0] ?? null,
    mainCond = mainAsset
      ? (options.conditional?.get(mainAsset.filter) ?? null)
      : null,
    // Mesma escala da tabela condicional (ver ref nos tabuleiros de vantagem).
    mainRef = mainCond
      ? (mainCond.units[mainAsset.id]?.[0] ??
        (mainAsset.exact
          ? mainAsset.avg
          : (stats?.unit?.[mainAsset.id]?.[0] ?? mainAsset.avg)))
      : null;
  const withAsset = (c) =>
    mainCond && c !== mainAsset.champion
      ? shrinkTo(mainCond.units[c.apiName], mainRef)
      : null;
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
            (contestOf(key(u)) / POOL[u.cost] -
              contestOf(key(c)) / POOL[c.cost]) *
              12 +
            (access(c) - access(u)) * 1.5 +
            (c.cost - u.cost) * 1.5 +
            (role(c) === role(u) ? 2 : 0) +
            // Medido junto com o seu trunfo: cada 0,1 de colocação melhor vale 2 pontos.
            (withAsset(u) != null && withAsset(c) != null
              ? (withAsset(u) - withAsset(c)) * PLACEMENT_POINTS
              : 0);
          return {
            id: c.apiName,
            name: c.name,
            cost: c.cost,
            // Colocação média de tabuleiros com o seu trunfo e esta peça (null sem a tabela do trunfo).
            withAsset:
              withAsset(c) != null
                ? Math.round(withAsset(c) * 100) / 100
                : null,
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
        remaining: upper(key(u)),
        remainingLikely: Math.round(free(key(u)) * 10) / 10,
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
        chancePerShop: shopChance(probability(c)),
        enemyCopies: enemy.get(key(c)) ?? 0,
        hiddenCopies: Math.round((held.get(key(c)) ?? 0) * 10) / 10,
        remainingUpper: upper(key(c)),
      }));
    const keep = r.board.filter((c) => own.has(key(c))).map((c) => c.name);
    return {
      rank: index + 1,
      // Emblemas ao alcance que mais rendem nesta comp (Espátula/Frigideira no banco).
      emblems: r.component?.emblem?.picks ?? [],
      evidence: r.component?.evidence ?? null,
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
            // Variação e partidas de cada build publicada: o plano e a Formação mostram o mesmo que a aba Comps.
            buildStats: r.meta.buildStats ?? {},
          }
        : null,
      // Tabuleiro de vantagem (sem comp de meta): id estável pelo carry, para a continuidade entre leituras.
      freeId: r.freeId ?? null,
      // Pergunta de evidência deste plano (sinergias e peças principais; trunfo), para medi-lo igual depois.
      evidenceCore: (r.core ?? []).map((x) =>
        typeof x === "string" ? x : x.apiName,
      ),
      evidenceAsset: (r.asset ?? assetIn(r))?.id ?? null,
      evidenceAssetFilter: (r.asset ?? assetIn(r))?.filter ?? null,
      title:
        r.meta?.title ||
        (r.current ? "Seu tabuleiro atual" : "") ||
        (r.kept && r.title ? r.title : "") ||
        (r.freeId
          ? [
              `${r.carry.name} ${own.get(key(r.carry))?.stars ?? 1}★`,
              ...ts
                .filter((t) => !t.solo)
                .slice(0, 2)
                .map((t) => `${t.count} ${t.name}`),
            ].join(" · ")
          : "") ||
        ts
          .slice(0, 2)
          .map((t) => `${t.count} ${t.name}`)
          .join(" · ") ||
        "Flex",
      score: Math.round(r.component.total * 10) / 10,
      compScore: r.component.compScore ?? null,
      // Alcance (core/comps/reach.mjs) e a nota de troca de plano (score do desafiante, margem e custo), se houver.
      reach: r.component.reach ?? null,
      switch: r.component.switch ?? null,
      components: r.component,
      traits: ts,
      carry: r.carry.name,
      carryRole: role(r.carry),
      flex: flexOf(r.board, r.carry),
      board: r.board.map((c) => ({
        id: c.apiName,
        name: c.name,
        cost: c.cost,
        ...traitsFor(c, own.get(key(c))?.items),
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
      grown: r.component.grown ?? [],
      reasons: [
        ...(r.component.reach ? [`Alcance: ${r.component.reach.text}.`] : []),
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
              `Ponto de partida: comp de meta com colocação média ${r.meta.avg}, top 4 em ${r.meta.top4}% e vitória em ${r.meta.win}% de ${r.meta.games} partidas · estilo ${r.meta.levelling || "não informado"}.`,
            ]
          : []),
        ...(r.freeId
          ? [
              `Montado em volta de ${r.carry.name} ${own.get(key(r.carry))?.stars ?? 1}★ (${own.get(key(r.carry))?.items.length ?? 0} itens): a força dele vem antes de qualquer comp; o resto do tabuleiro é a frente e as sinergias que a pool de agora permite.`,
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
    // Perguntas de evidência ainda sem resposta (o servidor busca e refaz a análise); vazio quando completa.
    evidenceRequests: [...requests.values()],
    conditionalRequests: [...conditionalRequests],
    // Todos os tabuleiros medidos, do melhor para o pior (comps de meta, de vantagem e o seu atual).
    measured: contendersAll
      .filter((r, i) => i < 12 || !r.meta)
      .map((r) => ({
        title:
          r.meta?.title ??
          (r.current
            ? "Seu tabuleiro atual"
            : r.kept && r.title
              ? r.title
              : `${r.carry.name} · ${r.focus ?? "peças"}`),
        kind: r.meta ? "meta" : r.current ? "atual" : "vantagem",
        units: r.board.map((c) => c.name),
        ...r.component.evidence,
      })),
    assets: assets.map((a) => ({
      id: a.id,
      name: a.champion.name,
      stars: a.stars,
      starsNow: a.starsNow,
      items: a.items,
      avg: a.avg,
      games: a.games,
      chance: Math.round(a.pReach * 100) / 100,
      augment: a.augment,
    })),
    self: {
      id: self.playerId,
      name: self.riotIdGameName ?? self.summonerName,
      health: self.health,
      augments: Array.isArray(self.augments) ? self.augments : [],
      reserve,
      units: self.boardPieces.map((u) => ({
        ...u,
        name: byId.get(u.championName)?.name ?? u.championName,
        ...unitTraits(u),
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
    odds: levelOdds(level),
    rules: {
      pool: POOL,
      source: "https://tftsense.gg/study-hall/tft-champion-pool-and-odds/",
      reference:
        "Set 18 / patch 18.3; parâmetros ajustáveis, não confirmados no executável 18.4.",
    },
  };
}
