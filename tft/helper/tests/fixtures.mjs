// Estado sintético de partida para testar economia e estratégia sem o arquivo do jogo.
// Monta plan/analysis/options no mesmo formato que server.mjs entrega a strategy() e stagePlan().
import { POOL, ODDS } from "../engine.mjs";

// Quantos campeões distintos existem por custo (aproximação de um set real) para a pool ter densidade realista.
const DISTINCT = { 1: 13, 2: 13, 3: 13, 4: 12, 5: 8 };

const COMPS = {
  fast8: {
    title: "Fast 8 Aphelios",
    carry: "Aphelios",
    meta: { levelling: "Fast 8", rerollLevel: null, stars3: [] },
    board: [
      ["Aphelios", 4],
      ["Amumu", 4],
      ["Xayah", 4],
      ["Diana", 3],
      ["Rakan", 3],
      ["Vi", 2],
      ["Sentinel", 2],
      ["Varus", 1],
    ],
  },
  reroll: {
    title: "Reroll Kayle",
    carry: "Kayle",
    meta: { levelling: "lvl 6", rerollLevel: 6, stars3: ["Kayle", "Garen"] },
    board: [
      ["Kayle", 2],
      ["Garen", 2],
      ["Nami", 2],
      ["Lulu", 3],
      ["Sona", 3],
      ["Taric", 1],
    ],
  },
};

/**
 * `units`: [nome, custo, estrelas, itens] em campo; `reserve`: [nome, custo, estrelas] no banco;
 * `extra`: cópias suas fora de campo por nome; `enemy`: cópias com rivais por nome.
 */
export function makeState({
  gold = 54,
  level = 8,
  xp = "23/68",
  hp = 58,
  stage = "4-2",
  comp = "fast8",
  units,
  reserve = [],
  extra = {},
  enemy = {},
  shop = [],
  buyNow = [],
  rivals = { count: 7, cost: 3, stars: 2, size: 8 },
} = {}) {
  const c = COMPS[comp];
  units ??=
    comp === "fast8"
      ? [
          ["Aphelios", 4, 1, 3],
          ["Amumu", 4, 2, 2],
          ["Diana", 3, 2, 0],
          ["Rakan", 3, 1, 0],
          ["Vi", 2, 2, 1],
          ["Sentinel", 2, 1, 0],
          ["Varus", 1, 2, 0],
        ]
      : [
          ["Kayle", 2, 2, 3],
          ["Garen", 2, 1, 1],
          ["Nami", 2, 1, 0],
          ["Lulu", 3, 1, 0],
          ["Taric", 1, 2, 0],
        ];
  const copies = new Map();
  const addCopies = (name, cost, n) => {
    const prev = copies.get(name) ?? { cost, n: 0 };
    copies.set(name, { cost, n: prev.n + n });
  };
  for (const [name, cost, stars] of units)
    addCopies(name, cost, 3 ** (stars - 1));
  for (const [name, cost, stars] of reserve)
    addCopies(name, cost, 3 ** (stars - 1));
  for (const [name, n] of Object.entries(extra)) {
    const cost = c.board.find(([b]) => b === name)?.[1] ?? 1;
    addCopies(name, cost, n);
  }
  const named = new Map(c.board.map(([name, cost]) => [name, cost]));
  for (const [name, { cost }] of copies) named.set(name, cost);
  for (const name of Object.keys(enemy))
    if (!named.has(name)) named.set(name, 1);
  const pool = [];
  const perCost = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const [name, cost] of named) perCost[cost]++;
  for (const [name, cost] of named) {
    const own = copies.get(name)?.n ?? 0,
      foe = enemy[name] ?? 0;
    pool.push({
      name,
      cost,
      total: POOL[cost],
      own,
      enemy: foe,
      remainingUpper: Math.max(0, POOL[cost] - own - foe),
      rivals: foe ? ["Rival"] : [],
    });
  }
  for (const cost of [1, 2, 3, 4, 5])
    for (let i = perCost[cost]; i < DISTINCT[cost]; i++)
      pool.push({
        name: `Filler${cost}-${i}`,
        cost,
        total: POOL[cost],
        own: 0,
        enemy: i % 3,
        remainingUpper: POOL[cost] - (i % 3),
        rivals: [],
      });
  // Mesma conta de engine.mjs: chance por slot = odds do custo × cópias livres do campeão ÷ livres do custo.
  const denom = {};
  for (const p of pool) denom[p.cost] = (denom[p.cost] ?? 0) + p.remainingUpper;
  for (const p of pool) {
    p.chancePerSlot = denom[p.cost]
      ? ((ODDS[level][p.cost - 1] / 100) * p.remainingUpper) / denom[p.cost]
      : 0;
    p.chancePerShop = 1 - (1 - p.chancePerSlot) ** 5;
  }
  const id = (name) => `TFT_${name}`;
  const plan = {
    title: c.title,
    carry: c.carry,
    meta: { ...c.meta, stars3: c.meta.stars3.map(id) },
    board: c.board.map(([name, cost]) => ({ id: id(name), name, cost })),
    stage: { shop, buyNow },
  };
  const opponents = Array.from({ length: rivals.count }, (_, i) => ({
    name: `Rival ${i + 1}`,
    units: Array.from({ length: rivals.size }, () => ({
      cost: rivals.cost,
      stars: rivals.stars,
      items: [],
    })),
  }));
  const analysis = {
    self: {
      health: hp,
      reserve: reserve.map(([name, cost, stars]) => ({
        championName: id(name),
        id: id(name),
        name,
        cost,
        stars,
        starLevel: stars,
      })),
      units: units.map(([name, cost, stars, items]) => ({
        championName: id(name),
        name,
        price: cost,
        starLevel: stars,
        itemNames: Array.from({ length: items }, (_, i) => `Item${i}`),
      })),
    },
    pool,
    opponents,
  };
  const st = /^(\d)-(\d)$/.exec(stage ?? "");
  const options = {
    gold,
    level,
    xp,
    stage: st ? { stage: Number(st[1]), round: Number(st[2]) } : null,
  };
  return { plan, analysis, options };
}
