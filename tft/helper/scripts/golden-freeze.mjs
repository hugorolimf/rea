// Congela as entradas do golden do pipeline a partir de `../data` (gitignored, só local).
//
//   node scripts/golden-freeze.mjs
//
// Grava, em tests/golden/fixtures (commitável):
//   meta/*.json        cópias de meta usadas pelo golden (as da raiz são regravadas pelo servidor a cada atualização);
//   snapshots/*.json   tabuleiros reais de partidas capturadas num instante, ANONIMIZADOS: rivais viram "Rival N" com id
//                      9000000+N, o Hero mantém o id do projeto e a partida ganha um id sintético; mais o banco oculto
//                      dos rivais estimado pelo rastreador nesse instante (arredondado a 0,5 como o servidor faz);
//   evidence.json      só as respostas do explorer que o pipeline consultou (do cache em disco); nada pessoal.
// Depois de congelar, gere os esperados com `UPDATE_GOLDEN=1 node --test tests/golden.test.mjs` e REVISE o diff.
// Não rode isto no meio de uma migração: troca a base de comparação.
import fs from "node:fs";
import path from "node:path";
import {
  HERO_ID,
  SET,
  fixturesDir,
  loadContext,
  loadSnapshots,
  root,
  runScenario,
} from "../tests/golden/harness.mjs";
import { scenarios } from "../tests/golden/scenarios.mjs";
import { hiddenHoldings } from "../pool-tracker.mjs";

const data = path.join(root, "../data");
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v) + "\n");
};

// Instantes de partidas reais (minutos desde a primeira captura da partida) e o id sintético que cada uma recebe.
const SOURCES = [
  { name: "opening-3u", gameId: 3291708419, minute: 2 },
  { name: "early-5u", gameId: 3291708419, minute: 8 },
  { name: "mid-7u", gameId: 3291708419, minute: 17 },
  { name: "late-hp19", gameId: 3291708419, minute: 28 },
  { name: "items-8u", gameId: 3291734382, minute: 20 },
  { name: "danger-hp27", gameId: 3291734382, minute: 27 },
  { name: "reroll-3star", gameId: 3291615151, minute: 28 },
];

// 1. Cópias de meta.
fs.mkdirSync(path.join(fixturesDir, "meta"), { recursive: true });
for (const f of [
  "meta-comps.json",
  "meta-builds.json",
  "meta-stats.json",
  "augment-stats.json",
])
  fs.copyFileSync(path.join(root, f), path.join(fixturesDir, "meta", f));
console.log("meta: 4 arquivos copiados");

// 2. Snapshots anonimizados.
const rows = fs
  .readFileSync(path.join(data, "scouting-captures.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const piece = (u) => ({
  championName: u.championName,
  starLevel: u.starLevel,
  itemNames: u.itemNames ?? [],
  price: u.price,
});

const anonymize = (players) => {
  const ids = new Map();
  let n = 0;
  return players.map((p) => {
    const hero = String(p.id) === HERO_ID;
    if (!hero && !ids.has(String(p.id))) ids.set(String(p.id), 9000000 + ++n);
    return {
      playerId: hero ? HERO_ID : String(ids.get(String(p.id))),
      riotIdGameName: hero
        ? "Hero"
        : `Rival ${ids.get(String(p.id)) - 9000000}`,
      health: p.health,
      ffaStanding: null,
      boardPieces: (p.units ?? []).map(piece),
    };
  });
};

SOURCES.forEach(({ name, gameId, minute }, i) => {
  const all = rows.filter((r) => r.gameId === gameId);
  if (!all.length)
    throw Error(`Partida ${gameId} ausente em scouting-captures`);
  const cut = Date.parse(all[0].sourceAt) + minute * 60_000,
    upto = all.filter((r) => Date.parse(r.sourceAt) <= cut),
    last = new Map();
  for (const r of upto) last.set(String(r.id), r);
  // Hero primeiro, depois os rivais na ordem da primeira captura (ids sintéticos estáveis).
  const ordered = [...last.values()].sort(
    (a, b) => (String(b.id) === HERO_ID) - (String(a.id) === HERO_ID),
  );
  const alive = new Set(
    ordered.filter((r) => (r.health ?? 1) > 0).map((r) => String(r.id)),
  );
  const hidden = Object.fromEntries(
    [
      ...hiddenHoldings(
        upto.filter((r) => alive.has(String(r.id))),
        { now: cut + 15_000, skip: new Set([HERO_ID]) },
      ),
    ]
      .map(([id, n]) => [id, Math.round(n * 2) / 2])
      .filter(([, n]) => n > 0),
  );
  writeJson(path.join(fixturesDir, "snapshots", `${name}.json`), {
    note: `captura real anonimizada, ${minute} min desde o início da partida`,
    snapshot: {
      gameId: 9100001 + i,
      queueType: "RANKED_TFT",
      statsBlock: {
        setCoreName: SET,
        gameLengthSeconds: null,
        players: anonymize(ordered),
      },
    },
    hidden,
  });
  console.log(
    `snapshot ${name}: ${ordered.length} jogadores, hero ${ordered.find((r) => String(r.id) === HERO_ID)?.units.length} peças, bancos ocultos ${Object.keys(hidden).length}`,
  );
});

// Partida gravada em live-mock-base.json (já anonimizada: Hero/Rival N).
{
  const base = readJson(path.join(root, "live-mock-base.json")),
    players = base.state.players,
    byId = new Map(base.rec.opponents.map((o) => [String(o.id), o]));
  let rival = 0;
  const out = players.map((p) => {
    if (String(p.id) === HERO_ID)
      return {
        playerId: HERO_ID,
        riotIdGameName: "Hero",
        health: p.health,
        ffaStanding: null,
        boardPieces: base.rec.self.units.map(piece),
      };
    const o = byId.get(String(p.id));
    rival++;
    return {
      playerId: String(9000000 + rival),
      riotIdGameName: `Rival ${rival}`,
      health: p.health,
      ffaStanding: null,
      boardPieces: (o?.units ?? []).map((u) => ({
        championName: u.id,
        starLevel: u.stars,
        itemNames: u.items ?? [],
        price: u.cost,
      })),
    };
  });
  writeJson(path.join(fixturesDir, "snapshots", "mock-base.json"), {
    note: "reconstruído de live-mock-base.json (já anonimizado)",
    snapshot: {
      gameId: base.state.gameId,
      queueType: base.state.queue,
      statsBlock: { setCoreName: SET, gameLengthSeconds: null, players: out },
    },
    hidden: {},
  });
  console.log("snapshot mock-base:", out.length, "jogadores");
}

// 3. Evidência: cache inteiro do disco, registrando só o que o pipeline pergunta.
const cache = readJson(path.join(data, "evidence-cache.json"));
const total = new Map(),
  parts = new Map();
for (const [k, v] of Object.entries(cache)) {
  const i = k.indexOf("?"),
    endpoint = k.slice(0, i),
    f = k.slice(i + 1);
  if (endpoint === "total") total.set(f, v.value);
  else if (endpoint === "units_unique" || endpoint === "traits") {
    const o = parts.get(f) ?? {};
    o[endpoint === "units_unique" ? "units" : "traits"] = v.value;
    parts.set(f, o);
  }
}
const conditional = new Map([...parts].filter(([, o]) => o.units && o.traits));
const touched = { total: new Set(), conditional: new Set() };
class Spy extends Map {
  constructor(entries, kind) {
    super(entries);
    this.kind = kind;
  }
  get(k) {
    if (super.has(k) && super.get(k) != null) touched[this.kind].add(k);
    return super.get(k);
  }
  has(k) {
    if (super.has(k) && super.get(k) != null) touched[this.kind].add(k);
    return super.has(k);
  }
}
const ctx = await loadContext({
  evidence: new Spy(total, "total"),
  conditional: new Spy(conditional, "conditional"),
});
ctx.cloneMap = (m) => new Spy(m, m.kind);
const snapshots = loadSnapshots();
for (const sc of scenarios) runScenario(ctx, sc, snapshots);
const pick = (map, keys) =>
  Object.fromEntries(
    [...keys].sort().map((k) => [k, Map.prototype.get.call(map, k)]),
  );
writeJson(path.join(fixturesDir, "evidence.json"), {
  note: "subconjunto do cache do explorer (MetaTFT) consultado pelos cenários do golden",
  total: pick(total, touched.total),
  conditional: pick(conditional, touched.conditional),
});
console.log(
  `evidência: ${touched.total.size} totais e ${touched.conditional.size} condicionais (de ${total.size} e ${conditional.size})`,
);
