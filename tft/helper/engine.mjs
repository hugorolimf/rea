import { POOL, ODDS } from "./rules.mjs";
import { isContested } from "./economy.mjs";
import { shopsAhead } from "./core/economy/gold.mjs";
import { POLICY } from "./core/economy/policy.mjs";
import {
  anyUnit,
  exactUnit,
  filterKey,
  starUnit,
  traitAt,
  unitItem,
  unitUpTo,
} from "./evidence.mjs";
import { TIER_PLACE } from "./augment-stats.mjs";
import { itemEdge, tierOf } from "./item-edge.mjs";
import {
  buildHolders,
  compBuild,
  compBuildMap,
  compItemOptions,
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
import { levelFitSwaps } from "./core/comps/level-fit.mjs";
import { digestString } from "./core/graph/stable-key.mjs";
import {
  REACH,
  compReach,
  goldForShops,
  powerLevelOf,
  reachHorizon,
} from "./core/comps/reach.mjs";
import { traitBook } from "./core/catalog/traits.mjs";
import {
  winFit,
  winOf,
  winOfAvg,
  winOfPlacementDelta,
  winSe,
} from "./core/comps/win.mjs";
import {
  baseItemId,
  componentFamily,
  holderRole,
  isComponent,
  isConsumable,
  isEmblemItem,
  isEmblemTool,
  itemRole,
  recipeMap,
  recipeOf,
} from "./core/catalog/items.mjs";
import {
  championRole,
  isAvatar,
  poolName,
  slotsUsed,
  unitSlots,
} from "./core/catalog/champions.mjs";
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
// Comps crescidas até o nível (`extend`), guardadas entre análises pela chave das entradas (ver `extendCtx`).
const EXTEND_MEMO = new Map(),
  EXTEND_MEMO_MAX = 4000;

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
  // Os itens das suas peças não mudam dentro de uma análise: a peça no formato de contagem é guardada por campeão.
  const traitUnitMemo = new WeakMap();
  const traitUnit = (c) => {
    let u = traitUnitMemo.get(c);
    if (!u)
      traitUnitMemo.set(
        c,
        (u = { traits: c.traits, items: own.get(key(c))?.items }),
      );
    return u;
  };
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
  // Sinergias e legalidade de um tabuleiro: as mesmas contas se repetem milhares de vezes por análise (crescer comps,
  // trocas, emblemas); guardadas pelo conjunto de peças (a ordem não muda a contagem). Leitura apenas: não mutar.
  const boardKey = (board) =>
      board
        .map((c) => c.apiName)
        .sort()
        .join(","),
    traitsMemo = new Map(),
    legalMemo = new Map();
  const legal = (board) => {
    const k = boardKey(board);
    let v = legalMemo.get(k);
    if (v === undefined)
      legalMemo.set(k, (v = book.legal(board.map(traitUnit))));
    return v;
  };
  function traits(board) {
    const k = boardKey(board);
    let v = traitsMemo.get(k);
    if (!v) traitsMemo.set(k, (v = book.summary(board.map(traitUnit))));
    return v;
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
          comp?.id ?? null,
        ]);
      plan = planMemo.get(memoKey);
      if (!plan) {
        plan = buildItemPlan({
          ...input,
          recipes: planRecipes,
          // A mesma régua da recomendação de itens (core/items/item-priority.mjs): o ganho do item no campeão NESTA comp
          // (MetaTFT `comp_builds`); sem esse dado, o valor medido geral (item-value.mjs).
          valueOf: (u, id) => {
            const o = compItemOptions(comp, u).find(
              (x) => x.id === baseItemId(id),
            );
            return o
              ? {
                  value: o.gain,
                  confidence: Number.isFinite(o.n) ? o.n / (o.n + 400) : null,
                  samples: o.n ?? null,
                  source: "comp",
                }
              : valueTable.valueOf(u, id);
          },
          rankedOf: valueTable.rankedOf,
          wantsOf: valueTable.wantsOf,
          nameOf: (id) => itemCatalog.get(id)?.name ?? id,
          // Itens bons do campeão nesta comp (core/items/item-priority.mjs); sem eles, a build publicada.
          buildOf: (id) => {
            const best = compItemOptions(comp, id).map((o) => o.id);
            return best.length ? best : (published[id] ?? null);
          },
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
  //
  // Conta incremental (mesmo resultado de recontar o tabuleiro com cada candidato): o tabuleiro é contado uma vez por
  // vaga e cada candidato só soma as sinergias dele; o patamar novo e a regra da sinergia solo só podem mudar nelas.
  // O resultado é guardado entre análises pela chave de tudo o que a conta lê (`extendCtx`): as passadas de evidência
  // e as leituras em que nível, peças suas, pool e rivais não mudaram reaproveitam.
  function extend(base, size) {
    const memoKey = `${extendCtx()}|${size}|${base.map((c) => c.apiName).join(",")}`,
      hit = EXTEND_MEMO.get(memoKey);
    if (hit)
      return {
        board: hit.board.map((id) => byId.get(id)),
        added: hit.added.map((a) => ({ ...a, gained: [...a.gained] })),
      };
    const out = [...base],
      added = [];
    // Vagas, não peças: o Elder Dragon ocupa 2 (core/catalog/champions.mjs).
    for (let used = slotsUsed(out); used < size; used = slotsUsed(out)) {
      const inBoard = new Set(out),
        units = out.map(traitUnit),
        { counts } = book.tally(units),
        beforeTier = new Map(traits(out).map((t) => [t.name, t.tier])),
        order = new Map([...counts.keys()].map((n, i) => [n, i])),
        present = new Map();
      for (const u of units)
        for (const n of new Set(book.of(u.traits, u.items).traits))
          present.set(n, (present.get(n) ?? 0) + 1);
      // Sinergias que o candidato liga (patamar novo, sem as solo), na ordem da contagem do tabuleiro com ele; null se
      // ele repete uma sinergia solo do tabuleiro (tabuleiro ilegal).
      const gainedOf = (c) => {
        const u = traitUnit(c),
          list = book.of(u.traits, u.items).traits;
        for (const n of new Set(list))
          if (book.solo.has(n) && (present.get(n) ?? 0) >= 1) return null;
        const inc = new Map();
        for (const n of list) inc.set(n, (inc.get(n) ?? 0) + 1);
        const gained = [];
        for (const [n, k] of inc) {
          const total = (counts.get(n) ?? 0) + k;
          if (book.solo.has(n) && total >= 2) continue;
          const st = book.status(n, total);
          if (!st.solo && st.tier > (beforeTier.get(n) ?? 0)) gained.push(n);
        }
        return gained.sort(
          (a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity),
        );
      };
      let pick = null;
      for (const c of candidates) {
        if (
          inBoard.has(c) ||
          used + unitSlots(c) > size ||
          !(own.has(key(c)) || (upper(key(c)) > 0 && isBuyable(level, c.cost)))
        )
          continue;
        const gained = gainedOf(c);
        if (!gained) continue;
        const u = own.get(key(c)),
          value =
            gained.length * 8 +
            c.cost * 1.5 +
            (u ? 4 + u.stars : 0) -
            (contestOf(key(c)) / POOL[c.cost]) * 6;
        // Primeiro de maior valor (o `sort` estável de antes ficava com o primeiro em caso de empate).
        if (!pick || value > pick.value) pick = { c, gained, value };
      }
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
    if (EXTEND_MEMO.size >= EXTEND_MEMO_MAX) EXTEND_MEMO.clear();
    EXTEND_MEMO.set(memoKey, {
      board: out.map((c) => c.apiName),
      added: added.map((a) => ({ ...a, gained: [...a.gained] })),
    });
    return { board: out, added };
  }
  // Chave de tudo o que `extend` lê além da comp: nível, aprimoramentos (sinergia solo liberada), suas peças (estrela e
  // itens: emblemas), cópias vistas e disputa de cada campeão. Calculada uma vez por análise.
  let extendKey = null;
  function extendCtx() {
    if (extendKey === null)
      extendKey = digestString(
        JSON.stringify([
          level,
          [...(options.augmentTraits ?? [])].sort(),
          [...own]
            .map(([k, u]) => [k, u.stars, [...u.items].sort()])
            .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
          candidates.map((c) => [upper(key(c)), contestOf(key(c))]),
          catalog.champions.length,
        ]),
      );
    return extendKey;
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
            slotsUsed(core) < growTo
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
  // Reta medida vitória × colocação das comps de meta (core/comps/win.mjs): converte em vitória só o que ainda chega em
  // colocações (custo de trocar, tier de aprimoramento, ganho publicado de build); a vitória das comps é a medida.
  const fit = winFit(options.metaComps);
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
  // Estrela de cada peça sua por campeão (a regra do nível não troca a sua peça 2★/3★).
  const ownedStars = new Map(
    [...own.values()].map((u) => [u.champion.apiName, u.stars]),
  );
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
      // Vagas, não peças: o Elder Dragon ocupa 2.
      const fits = (c) => slotsUsed(board) + unitSlots(c) <= growTo;
      for (const r of order) {
        if (slotsUsed(board) >= growTo) break;
        if (board.includes(r.c)) continue; // peça ligada ao aprimoramento já está no tabuleiro
        if (!fits(r.c)) continue;
        if (name && count() < need && !r.hasTrait) continue;
        if (!legal([...board, r.c])) continue;
        board.push(r.c);
      }
      for (const r of order) {
        if (slotsUsed(board) >= growTo) break;
        if (!board.includes(r.c) && fits(r.c) && legal([...board, r.c]))
          board.push(r.c);
      }
      if (variant && count() < need) continue;
      // Peça barata para o nível (core/comps/level-fit.mjs, regra reserva): dá lugar à alternativa comprável mais cara,
      // da mesma sinergia e de média geral melhor; a sinergia mirada não cai de patamar e as suas peças 2★/3★ ficam.
      for (const sw of levelFitSwaps(
        {
          units: board.map((c) => c.apiName),
          carry: asset.champion.apiName,
          key: variant ? [variant.api] : [],
          options: null,
        },
        {
          level,
          owned: ownedStars,
          byId,
          book,
          traitName: traitByApi,
          unitStats: options.stats?.unit ?? null,
        },
      )) {
        const at = board.findIndex((c) => c.apiName === sw.out),
          c = byId.get(sw.in);
        if (at >= 0 && c && !board.includes(c)) {
          const next = board.map((x, i) => (i === at ? c : x));
          if (legal(next)) board.splice(0, board.length, ...next);
        }
      }
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
  // Seus itens no campeão certo desta comp (plano de itens, item-plan.mjs): até ITEMS_ASKED atribuições, da de maior valor
  // medido para a menor, como "este campeão com este item" (unit_item). Cada filtro a mais mede tabuleiros mais parecidos
  // com o seu; a pergunta mais longa com amostra (MIN_GAMES) é a que vale, então os itens entram até onde a MetaTFT tem
  // partidas. Radiante pergunta pelo item base (a MetaTFT junta os dois).
  const ITEMS_ASKED = 3;
  function itemFiltersOf(r) {
    r.component.itemPlan ??= planFor(r.board, r.meta ?? null);
    const plan = r.component.itemPlan,
      here = new Set(r.board.map((c) => c.apiName)),
      seen = new Set();
    if (!plan?.active) return null;
    const out = [];
    for (const a of plan.assignments ?? []) {
      if (out.length >= ITEMS_ASKED) break;
      const id = baseItemId(a.item.id),
        k = `${a.champion.id}|${id}`;
      if (!(a.value > 0) || !here.has(a.champion.id) || seen.has(k)) continue;
      seen.add(k);
      out.push({
        filter: unitItem(a.champion.id, id),
        champion: a.champion,
        item: { id, name: a.item.name },
        value: a.value,
      });
    }
    return out;
  }
  function questions(r) {
    const asset = assetIn(r),
      start = asset ? [asset.filter] : [],
      core = coreOf(r).filter((c) => c !== asset?.champion),
      emblem = emblemFor(r.board),
      placed = itemFiltersOf(r),
      // Com o plano de itens, os itens do banco entram pelo campeão (placed); os emblemas que um aprimoramento deu
      // continuam como "no tabuleiro" (não estão no banco lido).
      mine = placed
        ? [...new Set(options.augmentEmblems ?? [])].slice(0, 2)
        : myItemsFor(r.board),
      extras = [
        ...(placed ?? []).map((x) => x.filter),
        ...[
          ...mine,
          ...(emblem && !mine.includes(emblem.id) ? [emblem.id] : []),
        ].map((id) => `item=${id}`),
      ],
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
      placed: placed ?? [],
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
  // Resposta medida de um conjunto de filtros: a guardada (com amostra) ou null, pedindo a que falta. A resposta antiga, sem
  // a vitória, é descartada pelo cache de evidência ao carregar (evidence.mjs screenCache) e volta a ser perguntada.
  const answerOf = (f) => {
    const k = filterKey(f);
    if (!evidence?.has(k)) {
      requests.set(k, f);
      return null;
    }
    const e = evidence.get(k);
    return e && e.games >= MIN_GAMES && e.avg != null ? e : null;
  };
  // Peça-chave da estrela (a mesma regra da estrela-alvo do alcance, reachOf): a 3★ principal da comp de reroll ou o carry
  // 2★ (custo até REACH.carryTwoStarMaxCost). A vitória medida muda muito com a estrela dela (Cassiopeia com 3 itens:
  // 7,6% em 2★ e 19,2% em 3★), então a pergunta da comp é refeita com ela em cada estrela.
  function starPieceOf(r) {
    const threes = r.meta?.rerollLevel ? (r.meta.stars3 ?? []) : [];
    if (threes.length) {
      const c = byId.get(
        threes.includes(r.carry?.apiName) ? r.carry.apiName : threes[0],
      );
      return c && r.board.includes(c) ? { c, goal: 3 } : null;
    }
    return r.carry &&
      r.board.includes(r.carry) &&
      r.carry.cost <= REACH.carryTwoStarMaxCost
      ? { c: r.carry, goal: 2 }
      : null;
  }
  // Vitória da comp montada, por estrela da peça-chave: a pergunta escolhida (`f`) com a peça na estrela-alvo e na de baixo,
  // pesadas pela chance de você chegar à estrela-alvo (reachOf com a estrela da comp: as cópias que faltam, as livres depois
  // do que os rivais seguram, o ouro das próximas rodadas, as odds do seu nível e o prazo pela vida). Sem as duas respostas
  // com amostra, null (vale a pergunta sem a estrela).
  function starSplit(r, f) {
    const piece = starPieceOf(r);
    if (!piece) return null;
    const { c, goal } = piece,
      mine = own.get(key(c)),
      at = f.findIndex(
        (x) =>
          typeof x === "string" &&
          x.startsWith("unit_tier_numitems_unique=") &&
          x.includes(`${c.apiName}-1_`),
      ),
      ask = (st) => {
        const g = [...f];
        if (at < 0) g.push(starUnit(c.apiName, st));
        else g[at] = starUnit(c.apiName, st);
        return answerOf(g);
      };
    // Peça sua já na estrela-alvo: a comp é medida com ela nessa estrela (chance 1).
    const pGoal =
      mine && mine.stars >= goal
        ? 1
        : (reachOf(r, [c], { goals: true }).chance ?? 0);
    const high = ask(goal),
      low = pGoal >= 1 ? null : ask(goal - 1);
    if (winOf(high) == null) return null;
    if (pGoal < 1 && winOf(low) == null) return null;
    const wHigh = winOf(high),
      wLow = pGoal < 1 ? winOf(low) : wHigh;
    return {
      id: c.apiName,
      name: c.name,
      goal,
      p: Math.round(pGoal * 1000) / 1000,
      high: { stars: goal, win: high.win, avg: high.avg, games: high.games },
      low:
        pGoal < 1
          ? { stars: goal - 1, win: low.win, avg: low.avg, games: low.games }
          : null,
      win: pGoal * wHigh + (1 - pGoal) * wLow,
      avg: pGoal * high.avg + (1 - pGoal) * (low?.avg ?? high.avg),
      games: Math.min(high.games, low?.games ?? high.games),
    };
  }
  function measure(r) {
    const { asset, core, emblem, extras, placed, augmented, merged, sets } =
      questions(r);
    let best = null,
      bestSet = null,
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
        bestSet = f;
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
    // Vitória da comp montada: a pergunta escolhida dividida pela estrela da peça-chave (starSplit); sem essa divisão
    // medida, a vitória da própria pergunta.
    const star = starSplit(r, bestSet),
      win = star ? star.win : winOf(best),
      winGames = star ? star.games : best.games;
    const itemLabel = (f) => {
      const x = placed.find((y) => y.filter === f);
      return x
        ? `${x.item.name} em ${x.champion.name}`
        : (itemCat.get(f.slice(5))?.name ?? f.slice(5));
    };
    return {
      expected: Math.round(expected * 100) / 100,
      measured: best.avg,
      games: best.games,
      top4: best.top4,
      // Vitória medida (fração) da comp montada, com a estrela da peça-chave e os seus itens nos campeões certos.
      win,
      winQuestion: winOf(best),
      winSe:
        win == null
          ? null
          : Math.round(Math.max(p, 0.2) * winSe(win, winGames) * 10000) / 10000,
      star,
      // Filtros de item que entraram na pergunta escolhida (os seus itens já medidos nesta comp).
      itemsMeasured: itemsUsed,
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
        ...itemsUsed.map(itemLabel),
        ...(star
          ? [
              `${star.name} ${star.goal}★ com ${Math.round(star.p * 100)}% de chance`,
            ]
          : []),
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
      // Reroll: a principal (carry na lista de 3★, senão a primeira) é 3★; as outras, 3★ mistas (REACH.secondaryThree).
      threes = r.meta?.rerollLevel ? (r.meta.stars3 ?? []) : [],
      mainThree = threes.includes(r.carry?.apiName)
        ? r.carry.apiName
        : (threes[0] ?? null),
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
        soft:
          goalOf(c) === 3 && c.apiName !== mainThree
            ? REACH.secondaryThree
            : null,
        free: free(key(c)),
        upper: upper(key(c)),
        rivals: rivals.get(key(c))?.size ?? 0,
        seen: shopCards(c),
        weight:
          pieces || core.has(c)
            ? 1
            : isBuyable(power, c.cost)
              ? REACH.flexWeight
              : REACH.lateWeight,
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
    currentTop4 = currentEv?.top4 ?? null,
    // Vitória do seu tabuleiro atual (a reserva de W): a medida ou, se a resposta veio sem ela, a da colocação medida pela
    // reta (assim, sem vitória em nenhuma resposta, W ordena exatamente como E).
    currentWin =
      currentEv?.win ??
      (currentMeasured != null ? winOfAvg(currentMeasured, fit) : null);
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
  // COLOCAÇÃO ESPERADA (E): informação da tela ("N,Nº esperado"). A medida que ordena as comps, decide a troca do plano e
  // vira o score é a VITÓRIA ESPERADA (W, winExpectedOf, abaixo), que tem a mesma forma. Mesma conta com e sem evidência:
  //   E = p · (média + aprimoramentos − itens fora da pergunta + descarte do aprimoramento) + (1 − p) · reserva
  // - p: chance de ter a comp no prazo, pelo alcance (reachOf: o que você tem em campo e na reserva, as estrelas, prazo,
  //   ouro, nível, vida, pool e rivais): com evidência, a menor entre a presença das peças medidas e a parte esperada da
  //   comp; sem ela, a parte esperada. O risco de não montar está em p e na reserva;
  // - média: a medida (evidence.mjs: a pergunta leva os seus itens NOS CAMPEÕES do plano de itens, unit_item) ou, sem ela,
  //   a média publicada ajustada aos seus itens (item-edge.mjs);
  // - reserva: o seu tabuleiro atual medido (ou NOT_BUILT, política): é onde você fica se não montar;
  // - aprimoramentos: o tier de cada aprimoramento escolhido nesta comp (augAdjOf); itens fora da pergunta: o valor medido
  //   dos seus itens que a pergunta não levou (residualItemsOf), pela curva do plano de itens, inteiro (sem a fatia de 30%);
  // - descarte: tabuleiro que joga fora a sinergia de um aprimoramento escolhido soma AUGMENT_DROP (política). Antes
  //   isso e a "aposta" (p < 50%) eram degraus da ordem; agora entram em E, sem salto em p = 0,49 contra 0,50.
  const usesAugment = (r) =>
    !augTraits.size ||
    traits(r.board).some((t) => augTraits.has(t.name) && t.tier > 0);
  const round2 = (x) => Math.round(x * 100) / 100;
  // Estágio desta leitura (o lido; sem ele, estimado pelo nível, como na troca de plano).
  const stageNow =
    options.stage?.stage ??
    (level >= 8 ? 5 : level >= 7 ? 4 : level >= 6 ? 3 : 2);
  // Parte do que você tem (campo e reserva; o Avatar fica) que um tabuleiro não usa, na régua de força do lobby
  // (POLICY.star: custo × fator da estrela; 2 cópias de 1★ valem uma 1★, um 3★ vale 3,2 vezes).
  function lostShareOf(board) {
    let all = 0,
      out = 0;
    for (const [, u] of own) {
      if (isAvatar(u.champion)) continue;
      const v = u.champion.cost * (POLICY.star[Math.min(3, u.stars)] ?? 1);
      all += v;
      if (!board.includes(u.champion)) out += v;
    }
    return all ? out / all : 0;
  }
  // Disputa que importa: a MÉDIA, nas peças que ainda faltam (core/comps/reach.mjs `missing`), da parte da pool com rivais
  // × 12 (a escala do motor: 5 ou mais é "alta", ~42% das cópias da peça típica que falta com rivais). Antes era a SOMA em
  // todas as peças da comp, inclusive as que você já tem: no fim de jogo os rivais têm 2★ e 3★ de quase tudo e toda comp
  // aparecia com "disputa alta". Sem peça faltando, 0.
  const disputeOf = (r) => {
    const missing = new Set(
        (r.component.reach?.missing ?? []).map((m) => m.id),
      ),
      need = r.board.filter((c) => missing.has(c.apiName));
    return need.length
      ? need.reduce((n, c) => n + (contestOf(key(c)) / POOL[c.cost]) * 12, 0) /
          need.length
      : 0;
  };
  // A linha do porquê de cada comp: o que você tem dela (estrelas que decidem), a colocação esperada e, se ela não está
  // garantida, a chance de montar e onde você fica sem ela.
  const pctOf = (w) =>
    `${String(Math.round(w * 1000) / 10).replace(".", ",")}%`;
  const whyOf = (r, e, w) => {
    const mine = r.board.filter((c) => own.has(key(c))),
      twos = mine.filter((c) => own.get(key(c)).stars === 2).length,
      threes = mine
        .filter((c) => own.get(key(c)).stars >= 3)
        .map((c) => `${c.name} 3★`),
      stars = [
        twos ? `${twos} ${twos === 1 ? "peça" : "peças"} 2★` : null,
        threes.length ? threes.join(", ") : null,
      ].filter(Boolean),
      pos = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
    return `você tem ${r.component.reach?.have ?? mine.length}/${r.board.length}${stars.length ? ` com ${stars.join(" e ")}` : ""}: ${pctOf(w.value)} de vitória · ${pos(e.value)}º esperado${w.star ? ` · ${w.star.name} ${w.star.goal}★ com ${Math.round(w.star.p * 100)}% de chance (${pctOf(w.star.high)} de vitória em ${w.star.goal}★${w.star.low != null ? `, ${pctOf(w.star.low)} em ${w.star.goal - 1}★` : ""})` : ""}${r.current || e.p >= 0.995 ? "" : e.p < 0.05 ? " (sem prazo para montá-la: vale o que você já tem dela)" : ` (${Math.round(e.p * 100)}% de ter a comp; sem ela, ${pctOf(w.fallback)} de vitória)`}`;
  };
  // Valor medido (MetaTFT, campeão × item: item-value.mjs) dos seus itens que o plano de itens põe nesta comp e que a
  // pergunta medida NÃO levou (os da pergunta já estão na vitória e na colocação medidas), em colocações. Entra em E e W
  // pela curva de retorno decrescente do plano (planPoints): itens se sobrepõem e o valor isolado tem viés de "partida rica".
  function residualItemsOf(r) {
    const c = r.component,
      plan = c.itemPlan?.active ? c.itemPlan : null;
    if (!plan) return 0;
    const asked = new Set(c.evidence?.itemsMeasured ?? []),
      here = new Set(r.board.map((x) => x.apiName));
    return (plan.assignments ?? [])
      .filter(
        (a) =>
          a.value > 0 &&
          here.has(a.champion.id) &&
          !asked.has(unitItem(a.champion.id, baseItemId(a.item.id))),
      )
      .reduce((n, a) => n + a.value, 0);
  }
  // Ganho medido das trocas por nível (core/comps/level-fit.mjs) da comp, em colocações: a força publicada e a pergunta
  // medida são dos tabuleiros originais; a comp ajustada ao nível rende isto a mais (com teto, POLICY.levelFit.maxGain).
  const levelGainOf = (r) =>
    Math.min(
      POLICY.levelFit.maxGain,
      (r.meta?.appliedSwaps ?? [])
        .filter((x) => x.by === "nivel" && Number.isFinite(x.gain))
        .reduce((n, x) => n + x.gain, 0),
    );
  function expectedOf(r) {
    const c = r.component,
      ev = c.evidence ?? null;
    if (c.expected) return c.expected;
    // Reserva DESTA comp: o seu tabuleiro (medido) menos o que você desmonta indo para ela sem montá-la — a parte do que
    // você tem (custo × cópias, campo e reserva) que ela não usa, na régua do custo de trocar do estágio (SWITCH_COST).
    // No fim de jogo, com prazo curto, p ≈ 0 em quase toda comp: sem este termo todas colapsavam na mesma reserva (mesmo
    // E, mesmo score); com ele, a comp que usa o que você já tem fica à frente da que joga tudo fora.
    const lost = r.current ? 0 : lostShareOf(r.board),
      fallback =
        (currentMeasured ?? NOT_BUILT) +
        (SWITCH_COST[Math.min(5, Math.max(1, stageNow))] ?? 0.8) * lost;
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
    const items = planPoints(residualItemsOf(r)) / PLACEMENT_POINTS,
      drop = usesAugment(r) ? 0 : AUGMENT_DROP,
      levelGain = levelGainOf(r),
      built = avg + aug - items + drop - levelGain;
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
      lost: round2(lost),
      items: round2(items),
      augments: round2(aug),
      dropAugment: drop,
      levelGain: round2(levelGain),
      measured: !!ev,
    });
  }

  // VITÓRIA ESPERADA (W): a medida que ordena as comps (aba Comps e recomendado), decide a troca do plano e vira o score.
  // Mesma forma de E, com a vitória (1º lugar) medida no lugar da colocação:
  //   W = p · (vitória montada + itens fora da pergunta + aprimoramentos − descarte) + (1 − p) · vitória da reserva
  // - p: a mesma de E (o alcance: as suas peças, a pool livre depois dos rivais, o ouro, o nível, o prazo pela vida);
  // - vitória montada: a medida (measure: a pergunta da comp com a peça-chave em cada estrela, pesada pela chance de
  //   chegar à estrela, e os seus itens nos campeões certos) ou, sem ela, a vitória publicada da comp corrigida pelo
  //   ganho publicado das builds que você tem (item-edge, em colocações);
  // - itens fora da pergunta: o valor medido (MetaTFT, campeão × item) dos seus itens que o plano põe nesta comp e que a
  //   pergunta não mediu, com o retorno decrescente do plano de itens (planPoints) — sem a fatia de 30% de antes;
  // - aprimoramentos (tier na comp) e o descarte da sinergia de um aprimoramento: os mesmos de E;
  // - reserva: a vitória medida do seu tabuleiro atual (ou a da colocação NOT_BUILT), menos o que você desmonta indo
  //   para a comp sem montá-la (o mesmo `lost` de E).
  // O que chega em colocações vira vitória pela reta medida nas comps de meta (core/comps/win.mjs, `fit`).
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  function winExpectedOf(r) {
    const c = r.component;
    if (c.win) return c.win;
    const ev = c.evidence ?? null,
      e = expectedOf(r),
      residual = residualItemsOf(r),
      publishedAvg = r.meta?.avg ?? baseAvg,
      measuredWin = ev?.win ?? null,
      base =
        measuredWin ??
        (ev
          ? winOfAvg(ev.measured, fit)
          : (winOf(r.meta) ?? winOfAvg(publishedAvg, fit)) +
            winOfPlacementDelta(
              (c.edge?.adjustedAvg ?? publishedAvg) - publishedAvg,
              fit,
            )),
      items = winOfPlacementDelta(
        -planPoints(residual) / PLACEMENT_POINTS,
        fit,
      ),
      augments = winOfPlacementDelta(e.augments, fit),
      drop = winOfPlacementDelta(e.dropAugment, fit),
      levelFit = winOfPlacementDelta(-e.levelGain, fit),
      built = clamp01(base + items + augments + drop + levelFit),
      fallback = r.current
        ? built
        : clamp01(
            (currentWin ?? winOfAvg(NOT_BUILT, fit)) +
              winOfPlacementDelta(
                (SWITCH_COST[Math.min(5, Math.max(1, stageNow))] ?? 0.8) *
                  e.lost,
                fit,
              ),
          ),
      r4 = (x) => Math.round(x * 10000) / 10000;
    return (c.win = {
      value: r4(e.p * built + (1 - e.p) * fallback),
      p: e.p,
      built: r4(built),
      base: r4(base),
      fallback: r4(fallback),
      items: r4(items),
      residualItems: Math.round(residual * 1000) / 1000,
      augments: r4(augments),
      drop: r4(drop),
      levelFit: r4(levelFit),
      measured: measuredWin != null,
      star: ev?.star
        ? {
            id: ev.star.id,
            name: ev.star.name,
            goal: ev.star.goal,
            p: ev.star.p,
            high: (ev.star.high?.win ?? 0) / 100,
            low: ev.star.low ? ev.star.low.win / 100 : null,
          }
        : null,
      se: ev?.winSe ?? null,
    });
  }

  // Score de cada comp (comp-score.mjs): W na régua de 0 a 100, com as partes (itens, o que você tem, força, alcance,
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
      e = expectedOf(r),
      w = winExpectedOf(r);
    // Uma medida só na tela: a evidência passa a mostrar E (a conta da pergunta medida fica em `questionExpected`). Antes a
    // lista "medidos" mostrava a colocação da pergunta (4,09 contra 3,92) e a ordem seguia E (3,82 contra 3,82).
    if (c.evidence) {
      c.evidence.questionExpected = c.evidence.expected;
      c.evidence.expected = e.value;
      c.evidence.winExpected = w.value;
    }
    c.compScore = compScore({
      win: w.value,
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
      dispute: (c.disputeNeeded = disputeOf(r)),
    });
  }
  // Ordem: W (maior é melhor). Empate: E (menor é melhor), a mais garantida (p maior: o seu tabuleiro atual ganha de uma
  // comp que vale o mesmo só porque não vai ser montada); depois a pontuação antiga (`total`).
  const expectedValue = (r) => r.component.expected?.value ?? baseAvg,
    winValue = (r) => r.component.win?.value ?? winOfAvg(expectedValue(r), fit),
    byExpected = (a, b) =>
      winValue(b) - winValue(a) ||
      expectedValue(a) - expectedValue(b) ||
      (b.component.expected?.p ?? 0) - (a.component.expected?.p ?? 0) ||
      // Mesmo E e mesma chance (fim de jogo, p ≈ 0): a parte esperada da comp no prazo e, depois, a força dela montada.
      (b.component.reach?.share ?? 0) - (a.component.reach?.share ?? 0) ||
      (a.component.expected?.built ?? 9) - (b.component.expected?.built ?? 9) ||
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
  // Troca de plano: o melhor agora substitui o plano em andamento quando
  //   W_desafiante − W_mantido > custo de trocar + HYSTERESIS
  // com o custo e a histerese (em colocações, política) convertidos em vitória pela reta medida (core/comps/win.mjs).
  // A incerteza das médias já entra pelo encolhimento delas (shrinkTo, MIN_GAMES): não há mais o termo Z95·se aqui (o `se`
  // segue só como informação). O custo é o que se perde de fato (switchCost). A confirmação (plan-state.mjs) pede que o
  // desafiante lidere de novo depois de um FATO NOVO: `options.holdPlan` é `true` (segura), `false` (sem plano) ou
  // `{ release: id }` (segura, menos para o desafiante que já liderava antes do fato novo).
  // O mesmo estágio desta leitura (`stageNow`, acima: o lido ou, sem ele, o estimado pelo nível).
  const stage = stageNow;
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
      gain = winValue(top) - winValue(kept),
      cost = switchCost(kept, top),
      costWin = -winOfPlacementDelta(cost.value, fit),
      hysteresisWin = -winOfPlacementDelta(HYSTERESIS, fit),
      wins = gain > costWin + hysteresisWin,
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
      // Em vitória (fração): W do mantido e do desafiante, a vantagem, o custo de trocar e a histerese; E fica junto.
      winFrom: winValue(kept),
      winTo: winValue(top),
      expectedFrom: expectedValue(kept),
      expectedTo: expectedValue(top),
      gain: Math.round(gain * 10000) / 10000,
      cost: Math.round(costWin * 10000) / 10000,
      hysteresis: Math.round(hysteresisWin * 10000) / 10000,
      costParts: cost,
      stage,
      unit: "win",
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
      byWin = a.winSe != null && b.winSe != null,
      z = byWin
        ? (winValue(contenders[0]) - winValue(contenders[1])) /
          Math.max(0.0001, Math.hypot(a.winSe, b.winSe))
        : (b.expected - a.expected) /
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
      // A medida do z: a vitória (diferença e incerteza de 95% em fração) quando as duas a têm; senão, a colocação.
      unit: byWin ? "win" : "placement",
      winMargin: byWin
        ? Math.round(
            (winValue(contenders[0]) - winValue(contenders[1])) * 10000,
          ) / 10000
        : null,
      winNoise: byWin
        ? Math.round(Z95 * Math.hypot(a.winSe, b.winSe) * 10000) / 10000
        : null,
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
        // Vitória esperada W (a medida: ordena e vira o score), em %, e a conta dela.
        win:
          r.component.win?.value != null
            ? Math.round(r.component.win.value * 1000) / 10
            : null,
        winParts: r.component.win ?? null,
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
        // Disputa só das peças que faltam (disputeOf); `why`: a linha do critério para o cartão da comp.
        dispute: round(r.component.disputeNeeded ?? r.component.dispute),
        why:
          r.component.expected && r.component.win
            ? whyOf(r, r.component.expected, r.component.win)
            : null,
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
            // Ganho de cada item em cada campeão da comp (core/items/item-priority.mjs).
            itemPicks: r.meta.itemPicks ?? null,
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
  // BLOQUEAR O RIVAL: para cada rival vivo, as peças dele perto da próxima estrela que de fato mudam o jogo (a colocação
  // média publicada dos tabuleiros com ela nessa estrela é boa e bem melhor que na de agora: Xayah 3★ 4,35 não entra,
  // Fiddlesticks 3★ 3,07 entra). Para cada uma, a chance de ele juntar as cópias que faltam nas próximas lojas dele (nível
  // estimado pelas vagas em campo, pool livre de agora) e a chance depois da sua compra (as cópias da sua loja saem da
  // pool). Valor = (colocação que ele ganha × peso dos itens na peça × vida dele) × queda da chance. Política: POLICY.deny.
  function denialsOf() {
    const D = POLICY.deny,
      unitStats = options.stats?.unit ?? null,
      shopIds = options.shop ?? [],
      out = [];
    if (!unitStats) return out;
    for (const p of alive) {
      if (p === self || !(p.health > 0)) continue;
      const name = p.riotIdGameName ?? p.summonerName ?? "rival",
        pieces = new Map();
      let slots = 0;
      for (const u of p.boardPieces ?? []) {
        const c = byId.get(u.championName);
        if (!c || isAvatar(c)) continue;
        slots += unitSlots(c);
        const e = pieces.get(c.apiName) ?? { c, copies: 0, stars: 0, items: 0 };
        e.copies += starCopies(u.starLevel) * (u.quantity ?? 1);
        e.stars = Math.max(e.stars, u.starLevel ?? 1);
        e.items = Math.max(
          e.items,
          (u.itemNames ?? []).filter(
            (id) => !isComponent(id) && !isConsumable(id),
          ).length,
        );
        pieces.set(c.apiName, e);
      }
      const level = Math.min(10, Math.max(3, slots));
      for (const { c, copies, stars, items } of pieces.values()) {
        if (stars >= 3) continue;
        const to = stars + 1,
          need = starCopies(to) - copies,
          now = unitStats[`${c.apiName}|${stars}`],
          next = unitStats[`${c.apiName}|${to}`];
        if (need <= 0 || !Array.isArray(now) || !Array.isArray(next)) continue;
        const lift = now[0] - next[0];
        if (next[1] < D.minGames || next[0] > D.maxAvg || lift < D.minLift)
          continue;
        const k = key(c),
          freeNow = free(k),
          denom = denomByCost[c.cost] ?? 0;
        if (freeNow < need) continue; // já não fecha: não há o que bloquear
        const inShop = shopIds.filter((id) => id === c.apiName).length,
          take = Math.max(1, inShop),
          chance = (f, d) =>
            chanceAtLeast(
              slotsIn(D.shops),
              slotChance(level, c.cost, Math.max(0, f), Math.max(0, d)),
              need,
            ),
          before = chance(freeNow, denom),
          after = chance(freeNow - take, denom - take);
        const threat =
            lift *
            (items >= 2 ? 1 : items === 1 ? 0.75 : 0.5) *
            (0.5 + Math.min(100, p.health) / 200),
          value = threat * (before - after);
        if (before < D.minChance || value < D.minValue) continue;
        out.push({
          id: c.apiName,
          name: c.name,
          cost: c.cost,
          rival: { id: String(p.playerId), name, health: p.health },
          stars,
          toStars: to,
          need,
          free: Math.round(freeNow * 10) / 10,
          items,
          avgNow: now[0],
          avgNext: next[0],
          chance: Math.round(before * 1000) / 1000,
          chanceAfter: Math.round(after * 1000) / 1000,
          inShop,
          take,
          mine: own.has(k),
          value: Math.round(value * 1000) / 1000,
          reason:
            `${name} está a ${need} ${need === 1 ? "cópia" : "cópias"} de ${c.name} ${to}★ ` +
            `(tabuleiros com ela em ${to}★: ${now[0].toFixed(2).replace(".", ",")} → ${next[0].toFixed(2).replace(".", ",")} de colocação): ` +
            `comprar ${take === 1 ? "uma cópia" : `${take} cópias`} baixa a chance dele de ${Math.round(before * 100)}% para ${Math.round(after * 100)}% nas próximas ${D.shops} lojas.`,
        });
      }
    }
    return out.sort((a, b) => b.value - a.value).slice(0, D.limit);
  }
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
    // Bloquear o rival: as peças fortes que um rival está perto de fechar e quanto comprar uma cópia tira dele.
    denials: denialsOf(),
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
