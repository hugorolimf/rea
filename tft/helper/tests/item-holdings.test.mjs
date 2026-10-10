// Rodar com: node --test tft/helper/tests/item-holdings.test.mjs
// Itens do jogador comp a comp: onde está cada item que a build da comp pede e quanto isso vale no ranking e no score.
// Comps sintéticas sobre o catálogo real; o "banco" chega pelo leitor de tela (processo falso), como no servidor.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../engine.mjs";
import { itemEdge } from "../item-edge.mjs";
import {
  HOLD_VALUE,
  recommendInventory,
  resolveHoldings,
} from "../item-holdings.mjs";
import { mergeSources } from "../game-log.mjs";
import { screenReader } from "../screen-reader.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  catalog = JSON.parse(readFileSync(path.join(root, "catalog.json"), "utf8")),
  byName = new Map(catalog.champions.map((c) => [c.name, c])),
  HERO = 47445859;

const IE = "DA_InfinityEdge",
  GS = "DA_GiantSlayer",
  LW = "DA_LastWhisper",
  BT = "DA_Bloodthirster",
  DB = "DA_Deathblade",
  BF = "DA_Component_BFSword",
  GLOVES = "DA_Component_SparringGloves",
  BOW = "DA_Component_RecurveBow",
  LUNAR = "DA_18_EmblemLunar";
const id = (name) => byName.get(name).apiName;
const piece = (name, itemNames = [], starLevel = 2) => ({
  championName: id(name),
  starLevel,
  itemNames,
  price: byName.get(name).cost,
});
const snapshot = (hero) => ({
  gameId: 1,
  statsBlock: {
    setCoreName: "TFTSet18",
    players: [
      { playerId: HERO, health: 60, ffaStanding: 3, boardPieces: hero },
      {
        playerId: 101,
        health: 50,
        ffaStanding: 4,
        riotIdGameName: "Rival",
        boardPieces: [],
      },
    ],
  },
});

// Duas comps com as mesmas sete peças e carry Aphelios; só a build do carry muda (X pede IE/GS/LW, Z pede Deathblade).
const UNITS = [
  "Aphelios",
  "Varus",
  "Vi",
  "Amumu",
  "Sentinel",
  "Diana",
  "Xayah",
].map(id);
const build = (items) => ({ items, avg: 4.0, delta: -0.4, n: 6000 });
const comp = (cid, carryItems, extra = {}) => {
  const buildStats = {
    [id("Aphelios")]: build(carryItems),
    [id("Varus")]: build([BT]),
    ...extra,
  };
  return {
    id: cid,
    units: UNITS,
    key: [id("Aphelios")],
    carry: id("Aphelios"),
    levelling: "",
    stars: [],
    stars3: [],
    rerollLevel: null,
    title: cid,
    builds: Object.fromEntries(
      Object.entries(buildStats).map(([u, b]) => [u, b.items]),
    ),
    buildStats,
    games: 9000,
    avg: 4.4,
    top4: 52,
    win: 12,
    tier: "A",
  };
};
const X = comp("x", [IE, GS, LW]),
  Z = comp("z", [DB, "DA_Spear", "DA_HextechGunblade"]);

const run = (hero, inventory = [], metaComps = [X, Z]) =>
  analyze(snapshot(hero), catalog, {
    level: 7,
    targetLevel: 7,
    gold: 30,
    bench: [],
    inventory,
    playerId: String(HERO),
    metaComps,
    previewIds: [],
    baseAvg: 4.47,
    conditional: new Map(),
    evidence: new Map(),
  });
const row = (a, cid = "x") => a.compRanking.find((r) => r.id === cid);
const carryKinds = (a, cid = "x") =>
  row(a, cid).itemHoldings.carry.map((e) => e.kind);
// Peças da comp X no campo, sem itens; os cenários acrescentam itens e a peça que sai (Lillia não está em X nem em Z).
const base = () => [
  piece("Aphelios"),
  piece("Varus"),
  piece("Vi"),
  piece("Amumu"),
  piece("Sentinel"),
];

test("(a) item equipado em peça que sai da comp conta como disponível: mover, não faltar", () => {
  const none = run(base()),
    moved = run([...base(), piece("Lillia", [IE])]);
  assert.deepEqual(carryKinds(none), ["absent", "absent", "absent"]);
  assert.deepEqual(carryKinds(moved), ["move", "absent", "absent"]);
  assert.equal(row(moved).carryItems, HOLD_VALUE.move);
  // Entra no score (itens) e no ranking: a comp que pede o IE passa à frente da que não o pede.
  assert.ok(
    row(moved).score > row(none).score,
    `${row(moved).score} vs ${row(none).score}`,
  );
  assert.ok(row(moved).scoreParts.items > row(none).scoreParts.items);
  assert.ok(row(moved).itemGain > 0 && row(none).itemGain === 0);
  assert.ok(
    row(moved).rank < row(moved, "z").rank,
    "a comp que usa o item que você tem fica à frente",
  );
  assert.ok(row(moved).total > row(moved, "z").total);
});

test("(a) degraus: já na peça > banco > mover de quem sai > mover de quem fica sem usar > montar > ausente", () => {
  const carry = (hero, bank = []) => row(run(hero, bank)).carryItems;
  const on = carry([piece("Aphelios", [IE]), ...base().slice(1)]),
    bank = carry(base(), [IE]),
    leaving = carry([...base(), piece("Lillia", [IE])]),
    staying = carry([
      piece("Aphelios"),
      piece("Varus", [IE]),
      ...base().slice(2),
    ]),
    craft = carry(base(), [BF, GLOVES]),
    none = carry(base());
  assert.deepEqual(
    [on, bank, leaving, staying, craft, none],
    [1, 0.98, 0.95, 0.9, 0.9, 0],
  );
  const scores = [
    [piece("Aphelios", [IE]), ...base().slice(1)],
    base(),
    [...base(), piece("Lillia", [IE])],
    [piece("Aphelios"), piece("Varus", [IE]), ...base().slice(2)],
  ].map((hero, i) => row(run(hero, i === 1 ? [IE] : [])).score);
  for (let i = 1; i < scores.length; i++)
    assert.ok(scores[i - 1] >= scores[i], `degrau ${i}: ${scores}`);
});

test("(b) item numa peça que fica e que a própria build pede não é livre para outra peça", () => {
  // Varus fica e a build dele nesta comp pede o Bloodthirster. O carry (Aphelios) também pede BT: não pode tirá-lo.
  const taken = comp("t", [BT, GS, LW]),
    held = run(
      [piece("Aphelios"), piece("Varus", [BT]), ...base().slice(2)],
      [],
      [taken, Z],
    );
  assert.equal(row(held, "t").itemHoldings.carry[0].kind, "taken");
  assert.equal(row(held, "t").itemHoldings.carry[0].from, "Varus");
  assert.equal(row(held, "t").carryItems, 0);
  assert.equal(
    row(held, "t").itemHoldings.counts.on,
    1,
    "para o Varus o item está no lugar",
  );
  // O mesmo item na peça que fica, mas que NÃO o pede (aqui a build do Varus é outra): é mover, com custo pequeno.
  const free = comp("f", [BT, GS, LW], { [id("Varus")]: build([DB]) }),
    spare = run(
      [piece("Aphelios"), piece("Varus", [BT]), ...base().slice(2)],
      [],
      [free, Z],
    );
  assert.equal(row(spare, "f").itemHoldings.carry[0].kind, "moveStay");
  assert.equal(row(spare, "f").carryItems, HOLD_VALUE.moveStay);
  // E no carry, no lugar: vale inteiro.
  const home = run(
    [piece("Aphelios", [BT]), piece("Varus", [BT]), ...base().slice(2)],
    [],
    [taken, Z],
  );
  assert.equal(row(home, "t").itemHoldings.carry[0].kind, "on");
});

test("(c) cópias duplicadas: cada cópia atende uma peça, e uma só não atende duas", () => {
  // O carry e o Varus pedem BT; o jogador tem duas cópias, ambas em peça que sai.
  const both = comp("b", [BT, GS, LW]),
    two = run(
      [
        ...base().slice(0, 1),
        piece("Vi"),
        piece("Amumu"),
        piece("Lillia", [BT]),
        piece("Nidalee", [BT]),
      ],
      [],
      [both, Z],
    ),
    one = run(
      [
        ...base().slice(0, 1),
        piece("Vi"),
        piece("Amumu"),
        piece("Lillia", [BT]),
      ],
      [],
      [both, Z],
    );
  assert.equal(row(two, "b").itemHoldings.counts.move, 2);
  assert.equal(row(one, "b").itemHoldings.counts.move, 1);
  assert.equal(
    row(one, "b").itemHoldings.counts.absent,
    3,
    "a segunda cópia pedida (Varus) e as outras duas do carry",
  );
  // Duas cópias no banco também.
  const bank = run(base(), [BT, BT], [both, Z]);
  assert.equal(row(bank, "b").itemHoldings.counts.bank, 2);
});

test("(d) radiante vale o item base, em quem sai e em quem fica", () => {
  const leaving = run([
    ...base(),
    piece("Lillia", ["DA_InfinityEdge_Radiant"]),
  ]);
  assert.equal(carryKinds(leaving)[0], "move");
  assert.equal(row(leaving).carryItems, HOLD_VALUE.move);
  const home = run([
    piece("Aphelios", ["DA_InfinityEdgeRadiant"]),
    ...base().slice(1),
  ]);
  assert.equal(carryKinds(home)[0], "on");
  assert.equal(row(home).carryItems, 1);
});

test("componentes: do banco montam, os soltos em quem sai se juntam, metade da receita vale 0,35", () => {
  assert.deepEqual(carryKinds(run(base(), [BF, GLOVES])), [
    "craft",
    "absent",
    "absent",
  ]);
  assert.deepEqual(
    carryKinds(run([...base(), piece("Lillia", [BF, GLOVES])])),
    ["craftMove", "absent", "absent"],
  );
  // Só o BF: metade da receita do IE e do Matador (nenhum gasta o componente, como antes).
  const half = run(base(), [BF]);
  assert.deepEqual(carryKinds(half), ["half", "half", "absent"]);
  assert.equal(row(half).carryItems, 2 * HOLD_VALUE.half);
  // Um componente só serve a um item: BF + Luvas montam o IE e o BF não volta para o Matador de Gigantes.
  const shared = carryKinds(run(base(), [BF, GLOVES, BOW]));
  assert.equal(shared[0], "craft");
  assert.notEqual(shared[1], "craft", "o BF já foi gasto no IE");
});

test("(e) emblema: em peça que sai vira emblema ao alcance; em peça que fica já conta pelas sinergias", () => {
  const without = run(base()),
    leaving = run([...base(), piece("Lillia", [LUNAR])]),
    staying = run([piece("Aphelios", [LUNAR]), ...base().slice(1)]),
    bank = run(base(), [LUNAR]);
  assert.deepEqual(row(without).emblem, []);
  const pick = row(leaving).emblem.find((e) => e.id === LUNAR);
  assert.ok(pick, "emblema de peça que sai é oferecido a uma peça da comp");
  assert.equal(pick.fromLeaving, true);
  assert.ok(row(leaving).total > row(without).total);
  // Igual ao emblema do banco, com o custo de mover.
  const bankPick = row(bank).emblem.find((e) => e.id === LUNAR);
  assert.ok(bankPick && !bankPick.fromLeaving);
  assert.ok(
    row(bank).total - row(without).total >
      row(leaving).total - row(without).total,
  );
  // Na peça que fica não é "pick": o emblema já está nela.
  assert.deepEqual(row(staying).emblem, []);
});

test("item-edge: itens localizados na comp mudam o ganho só pelo custo de mover/montar", () => {
  const c = {
    avg: 4.5,
    units: ["K"],
    buildStats: { K: build(["A", "B", "C"]) },
  };
  const entries = (kinds) =>
    new Map([
      [
        "K",
        kinds.map((k, i) => ({
          id: "ABC"[i],
          kind: k,
          value: HOLD_VALUE[k],
          available: HOLD_VALUE[k] >= 0.85,
        })),
      ],
    ]);
  const home = itemEdge(c, {}, new Map(), () => 1, entries(["on", "on", "on"])),
    moved = itemEdge(
      c,
      {},
      new Map(),
      () => 1,
      entries(["move", "move", "move"]),
    ),
    absent = itemEdge(
      c,
      {},
      new Map(),
      () => 1,
      entries(["absent", "absent", "absent"]),
    ),
    half = itemEdge(
      c,
      {},
      new Map(),
      () => 1,
      entries(["half", "half", "half"]),
    );
  assert.ok(home.gain > moved.gain && moved.gain > 0);
  assert.ok(moved.gain > home.gain * 0.8, "mover custa pouco");
  assert.equal(absent.gain, 0);
  assert.equal(
    half.gain,
    0,
    "metade de receita não conta como item no ganho (como antes)",
  );
  // Sem `resolved`, o comportamento antigo (estoque global) segue igual.
  assert.equal(itemEdge(c, { completed: ["A", "B", "C"] }).gain, home.gain);
});

test("resolveHoldings: o posicionado é gasto antes e o resto vai ao carry, depois às demais peças", () => {
  const goalIds = new Set(["C", "D"]),
    r = resolveHoldings({
      builds: { C: ["X", "Y"], D: ["X"] },
      order: ["C", "D"],
      units: [
        { unitId: "C", name: "C", stars: 2, items: [] },
        { unitId: "D", name: "D", stars: 2, items: ["X"] },
        { unitId: "Q", name: "Q", stars: 1, items: ["Y"] },
      ],
      goalIds,
      carryId: "C",
    });
  // D já usa o X: o carry C não o leva (taken), mas recebe o Y de Q, que sai.
  assert.deepEqual(
    r.entries.get("C").map((e) => e.kind),
    ["taken", "move"],
  );
  assert.deepEqual(
    r.entries.get("D").map((e) => e.kind),
    ["on"],
  );
  assert.equal(r.carry.move, 1);
  assert.equal(r.counts.taken, 1);
});

test("(f) o banco lido da tela chega ao motor; consumíveis ficam de fora e o cliente só vale sem leitura", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "holdings-")),
    helper = path.join(dir, "helper");
  await mkdir(helper);
  await mkdir(path.join(dir, "data"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const procs = [];
  const reader = screenReader(helper, [], [], [], {
    settleMs: 20,
    launch() {
      const proc = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill() {},
      });
      procs.push(proc);
      return proc;
    },
  });
  t.after(() => reader.stop());
  reader.sync(true);
  for (let i = 0; i < 200 && !procs.length; i++)
    await new Promise((r) => setTimeout(r, 5));
  procs[0].stdout.write(
    JSON.stringify({
      window: true,
      items: [IE, "DA_Consumable_ItemRemover", BT],
      unknownItems: 0,
      removers: 1,
    }) + "\n",
  );
  for (let i = 0; i < 200 && !reader.status().items; i++)
    await new Promise((r) => setTimeout(r, 5));
  // Mesma cadeia do servidor: leitura de tela → fontes mescladas (seenState) → inventário da análise → motor.
  const seen = mergeSources(reader.status(), null),
    known = new Set(catalog.items.map((i) => i.apiName));
  assert.deepEqual(seen.items, [IE, BT]);
  assert.ok(
    seen.bank.includes("DA_Consumable_ItemRemover"),
    "o banco inteiro segue informativo",
  );
  const inventory = recommendInventory([], seen, (x) => known.has(x));
  assert.deepEqual(inventory, [IE, BT], "consumível fora de items");
  const a = run(base(), inventory);
  assert.deepEqual(carryKinds(a)[0], "bank");
  assert.ok(
    row(a).score > row(run(base(), [])).score,
    "o item lido da tela entra no score",
  );
  // Cliente com leitura antiga: a tela de agora manda. Sem leitura (null), vale o enviado. Ids desconhecidos saem.
  assert.deepEqual(
    recommendInventory([GS], seen, (x) => known.has(x)),
    [IE, BT],
  );
  assert.deepEqual(
    recommendInventory([GS], { items: null }, (x) => known.has(x)),
    [GS],
  );
  assert.deepEqual(
    recommendInventory([GS], {}, (x) => known.has(x)),
    [GS],
  );
  assert.deepEqual(
    recommendInventory([], { items: [IE, "DA_Nao_Existe"] }, (x) =>
      known.has(x),
    ),
    [IE],
  );
  assert.deepEqual(
    recommendInventory([GS], { items: [] }, (x) => known.has(x)),
    [],
    "banco lido e vazio vale vazio",
  );
});

test("(g) sem itens o ranking e o score não mudam: sem item, nada se move", () => {
  const a = run(base()),
    b = run([...base(), piece("Lillia")]);
  for (const r of a.compRanking) {
    const o = row(b, r.id);
    assert.equal(r.itemGain, 0);
    assert.equal(r.carryItems, 0);
    const c = r.itemHoldings.counts;
    assert.equal(
      c.on + c.bank + c.move + c.moveStay + c.craft + c.craftMove + c.half,
      0,
    );
    assert.equal(o.carryItems, 0);
  }
});
