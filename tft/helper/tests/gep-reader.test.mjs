// Rodar com: node --test tft/helper/tests/gep-reader.test.mjs
// Eventos reais do GEP gravados pelo TFTAcademy (partida de 2026-09-11, Set 18), sem dados pessoais
// (tests/fixtures/gep-events.json): o banco de teste é um SQLite de verdade com o esquema do TFTAcademy.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  augmentResolver,
  chosenAugmentIds,
  emptyGepState,
  applyGepEvent,
  evaluateGep,
  gepBenchUnits,
  gepOpenMode,
  gepReader,
  matchIdDigits,
  mergeGep,
  parseAugmentOffer,
  parseAugmentPicked,
  parseAugmentPickedList,
  parseBench,
  parseGold,
  parseItemBench,
  parseLocalIdentity,
  parseRecordGames,
  parseShop,
  parseXp,
  shopWisps,
  wispCatalog,
  wispLookup,
} from "../gep-reader.mjs";
import { analysisInputs } from "../core/state/inputs.mjs";
import { buildGameState } from "../core/state/game-state.mjs";
import { mergeSources } from "../game-log.mjs";
import { analyze } from "../engine.mjs";
import { recommendInventory } from "../item-holdings.mjs";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/gep-events.json", import.meta.url),
    "utf8",
  ),
);
const catalog = JSON.parse(
  fs.readFileSync(new URL("../catalog.json", import.meta.url), "utf8"),
);
const champions = new Set(catalog.champions.map((c) => c.apiName)),
  items = new Set(catalog.items.map((i) => i.apiName));
const BASE = 1_800_000_000; // segundos; dt do fixture soma a isto
const LAST_DT = Math.max(...fixture.rows.map((r) => r.dt));
const at = (dt) => (BASE + dt) * 1000;

// Esquema do TFTAcademy (colunas que o leitor usa e as demais, como estão no banco real).
const SCHEMA = `
  CREATE TABLE games (id text PRIMARY KEY NOT NULL, started_at integer NOT NULL, ended_at integer, game_version text,
    set_number real, player_puuid text, final_placement integer, queue_type integer, created_at integer NOT NULL, match_id text);
  CREATE TABLE events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, game_id text NOT NULL, timestamp integer NOT NULL,
    event_type text NOT NULL, player_id text, round text, stage_type text, key text, data text, created_at integer NOT NULL,
    feature text, category text, FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE);
  CREATE INDEX events_game_timestamp_idx ON events (game_id, timestamp);`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gep-test-"));
let counter = 0;
const newFile = () => path.join(tmp, `db-${++counter}.db`);

/** Cria um banco no esquema real. `rows` do fixture até `upToDt`; a partida começa em BASE. */
function makeDb(
  file,
  {
    game = fixture.game,
    upToDt = LAST_DT,
    extraRows = [],
    matchId = game.matchId,
    ended = null,
  } = {},
) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO games (id, started_at, ended_at, set_number, queue_type, created_at, match_id) VALUES (?,?,?,?,?,?,?)",
  ).run(game.id, BASE, ended, game.set, game.queue, BASE, matchId);
  insertRows(
    db,
    game.id,
    fixture.rows.filter((r) => r.dt <= upToDt),
  );
  for (const r of extraRows) insertRows(db, game.id, [r]);
  db.close();
}
function insertRows(db, gameId, rows) {
  const ins = db.prepare(
    "INSERT INTO events (game_id, timestamp, event_type, round, key, data, created_at, feature, category) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  for (const r of rows)
    ins.run(
      gameId,
      BASE + r.dt,
      r.event_type,
      r.round ?? "0-0",
      r.key,
      r.data,
      BASE + r.dt,
      r.feature,
      r.feature,
    );
}
const append = (file, gameId, rows) => {
  const db = new DatabaseSync(file);
  insertRows(db, gameId, rows);
  db.close();
};
const reader = (file, clock, extra = {}) =>
  gepReader({
    file,
    now: () => clock.t,
    champions,
    items,
    minIntervalMs: 0,
    ...extra,
  });
const ctx = {
  gameId: "1000000001",
  inMatch: true,
  set: 18,
  local: fixture.local,
};
const sha = (file) =>
  crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");

test("parsing: ouro como texto, {} e inválidos", () => {
  assert.deepEqual(parseGold("2"), { value: 2 });
  assert.deepEqual(parseGold('"15"'), { value: 15 });
  assert.deepEqual(parseGold("{}"), { empty: true });
  assert.equal(parseGold('"abc"'), null);
  assert.equal(parseGold("-3"), null);
  assert.equal(parseGold("1500"), null);
  assert.equal(parseGold(null), null);
});

test("parsing: XP em JSON dentro de JSON e nível máximo sem barra", () => {
  assert.deepEqual(parseXp('{"level":2,"current_xp":0,"xp_max":2}'), {
    level: 2,
    xp: "0/2",
  });
  assert.deepEqual(
    parseXp(JSON.stringify('{"level":7,"current_xp":12,"xp_max":56}')),
    { level: 7, xp: "12/56" },
  );
  assert.deepEqual(parseXp('{"level":10,"current_xp":0,"xp_max":0}'), {
    level: 10,
    xp: null,
  });
  assert.equal(parseXp('{"level":0,"current_xp":0,"xp_max":2}'), null);
  assert.equal(parseXp('{"level":3,"current_xp":9,"xp_max":6}').xp, null); // atual > total: inverossímil
  assert.equal(parseXp("[]"), null);
});

test("parsing: loja marca vendida como vazia e nome fora do catálogo como desconhecido", () => {
  const shop = parseShop(
    '{"slot_1":{"name":"Sold"},"slot_2":{"name":"DA_18_Rakan"},"slot_3":{"name":"DA_99_Nada"}}',
    (id) => champions.has(id),
  );
  assert.equal(shop.length, 5);
  assert.equal(shop[0], null);
  assert.equal(shop[1].id, "DA_18_Rakan");
  assert.equal(shop[2].id, null);
  assert.equal(shop[2].text, "DA_99_Nada");
  assert.equal(shop[3], null);
  assert.equal(parseShop("não é json"), null);
});

test("parsing: reserva vazia é vazia, nome fora do catálogo é contado e não entra", () => {
  assert.deepEqual(
    parseBench("{}", (id) => champions.has(id)),
    { units: [], unknown: [] },
  );
  const b = parseBench(
    '{"cell_3":{"name":"DA_18_Rakan","level":"2","item_1":"DA_Item_Inexistente","item_2":"","item_3":""},"cell_1":{"name":"DA_18_Zzz","level":"1"}}',
    (id) => champions.has(id),
    (id) => items.has(id),
  );
  assert.deepEqual(b.unknown, ["DA_18_Zzz"]);
  assert.equal(b.units.length, 1);
  assert.equal(b.units[0].stars, 2);
  assert.deepEqual(b.units[0].items, []);
});

test("parsing: banco de itens só da linha do jogador local, em qualquer ordem", () => {
  const row = (summoner, tag_line, bench_items) => ({
    summoner,
    tag_line,
    bench_items,
  });
  const data = (rows) => JSON.stringify(rows);
  const me = { name: "Eu", tag: "XY1" };
  const a = parseItemBench(
    data([
      row("Outro", "T1", [{ name: "DA_Component_ChainVest", count: 1 }]),
      row("Eu", "xy1", [
        { name: "DA_Consumable_ItemRemover", count: 2 },
        { name: "DA_Component_GiantsBelt", count: 1 },
        { name: "DA_Item_Nada", count: 3 },
      ]),
    ]),
    me,
    (id) => items.has(id),
  );
  assert.deepEqual(a.bank, [
    "DA_Consumable_ItemRemover",
    "DA_Consumable_ItemRemover",
    "DA_Component_GiantsBelt",
  ]);
  assert.deepEqual(a.items, ["DA_Component_GiantsBelt"]);
  assert.equal(a.removers, 2);
  assert.equal(a.unknown, 3);
  const b = parseItemBench(
    data([
      row("Eu", "XY1", []),
      row("Outro", "T1", [{ name: "DA_Component_ChainVest", count: 1 }]),
    ]),
    me,
  );
  assert.deepEqual(b, {
    found: true,
    bank: [],
    items: [],
    removers: 0,
    unknown: 0,
  });
  // Sem identidade, sem a linha ou com a linha duplicada: desconhecido, nunca "banco vazio".
  assert.equal(parseItemBench(data([row("Eu", "XY1", [])]), null).found, false);
  assert.equal(parseItemBench(data([row("Outro", "T1", [])]), me).found, false);
  assert.equal(
    parseItemBench(data([row("Eu", "XY1", []), row("eu", "xy1", [])]), me)
      .found,
    false,
  );
});

test("parsing: identidade local exige exatamente um localplayer", () => {
  const roster = (a, b) =>
    JSON.stringify({
      A: { localplayer: a, tag_line: "t1" },
      B: { localplayer: b, tag_line: "t2" },
    });
  assert.deepEqual(parseLocalIdentity(roster(true, false)), {
    name: "A",
    tag: "t1",
  });
  assert.equal(parseLocalIdentity(roster(false, false)), null);
  assert.equal(parseLocalIdentity(roster(true, true)), null);
});

test("matchIdDigits extrai o id da partida do match_id", () => {
  assert.equal(matchIdDigits("BR1_3282025760"), "3282025760");
  assert.equal(matchIdDigits("LA2_123456"), "123456");
  assert.equal(matchIdDigits(null), null);
  assert.equal(matchIdDigits("sem-formato"), null);
});

test("partida gravada: ouro, nível, XP, estágio, loja, reserva e banco de itens do jogador local", () => {
  const file = newFile();
  makeDb(file);
  const clock = { t: at(LAST_DT + 5) };
  const s = reader(file, clock).status(ctx);
  assert.equal(s.state, "ativo");
  assert.equal(s.available, true);
  assert.equal(s.source, "gep");
  assert.equal(s.confidence, "observed");
  assert.equal(s.gameId, "1000000001");
  assert.equal(s.binding, "match_id");
  assert.equal(s.identity, "confirmada");
  const f = s.fields;
  // 2 de ouro → comprou Rakan (1) → comprou Pebbles (1) → {} = 0.
  assert.equal(f.gold.value, 0);
  assert.equal(f.gold.inferredZero, true);
  assert.equal(f.level.value, 2);
  assert.equal(f.xp.value, "0/2");
  assert.equal(f.stage.value, "1-3");
  assert.deepEqual(
    f.shop.value.map((c) => c?.id ?? null),
    [null, null, "DA_18_Kobuko", "DA_18_RekSai", "DA_18_Akali_AD"],
  );
  assert.equal(f.shop.visible, true);
  assert.deepEqual(
    f.bench.value.map((u) => [u.id, u.stars]),
    [
      ["DA_18_Varus", 1],
      ["DA_18_Rakan", 1],
      ["DA_18_Rakan", 1],
      ["DA_18_Sentry", 1],
    ],
  );
  assert.deepEqual(f.items.bank, [
    "DA_Consumable_ItemRemover",
    "DA_Consumable_ItemRemover",
  ]);
  assert.deepEqual(f.items.value, []);
  assert.equal(f.items.removers, 2);
  // Idade medida contra o relógio injetado (resolução de 1 s do banco).
  assert.equal(s.lastEventAgeMs, 5000);
  assert.ok(f.gold.ageMs >= 5000 && f.gold.ageMs <= 5000 + LAST_DT * 1000);
  // Nada de rivais nem de nomes: o resultado público não traz as linhas dos outros jogadores.
  const dump = JSON.stringify(s);
  assert.doesNotMatch(dump, /Rival[A-G]|opponent|battle_stats/i);
  // Sem eventos de aprimoramentos na partida gravada: nada de oferta nem de escolhidos, e nenhum Wisp na loja.
  assert.equal(f.augmentOffer, null);
  assert.equal(f.augmentPicked, null);
  assert.deepEqual(s.coverage, {
    augmentOffer: null,
    augmentPicked: null,
    augmentUnknown: 0,
    augmentUnresolved: [],
    wisps: 0,
  });
  assert.equal(s.recordGames, null, "banco do fixture sem tabela settings");
  assert.doesNotMatch(dump, /Local|LOC/);
});

test("incremental: acompanha as linhas novas desde a última leitura, sem reler a partida", () => {
  const file = newFile();
  makeDb(file, { upToDt: 47 });
  const clock = { t: at(47) };
  const r = reader(file, clock);
  let s = r.status(ctx);
  assert.equal(s.state, "ativo");
  assert.equal(s.fields.gold, null); // `{}` antes de qualquer rodada de jogo é reset, não zero
  assert.equal(s.fields.shop, null);
  assert.equal(s.fields.stage.value, "1-2");
  // Chega o início do 1-2 (loja, ouro 2) e depois a compra.
  const rows = (from, to) =>
    fixture.rows.filter((x) => x.dt >= from && x.dt <= to);
  append(file, fixture.game.id, rows(48, 48));
  clock.t = at(48);
  s = r.status(ctx);
  assert.equal(s.fields.gold.value, 2);
  assert.equal(s.fields.stage.value, "1-3");
  assert.equal(s.fields.shop.value[1].id, "DA_18_Rakan");
  append(file, fixture.game.id, rows(49, 56));
  clock.t = at(56);
  s = r.status(ctx);
  assert.equal(s.fields.gold.value, 1);
  assert.equal(s.fields.shop.value[1], null); // Sold
  assert.equal(s.fields.bench.value.length, 3);
  assert.equal(s.rows > 0, true);
});

test("intervalo mínimo: duas chamadas seguidas leem o banco uma vez", () => {
  const file = newFile();
  makeDb(file, { upToDt: 47 });
  const clock = { t: at(47) };
  const r = gepReader({
    file,
    now: () => clock.t,
    champions,
    items,
    minIntervalMs: 1000,
  });
  assert.equal(r.status(ctx).fields.gold, null);
  append(
    file,
    fixture.game.id,
    fixture.rows.filter((x) => x.dt === 48),
  );
  clock.t += 400;
  assert.equal(r.status(ctx).fields.gold, null, "ainda dentro do intervalo");
  clock.t += 700;
  assert.equal(r.status(ctx).fields.gold.value, 2);
});

test("frescor: sem eventos há mais que o limite a fonte fica obsoleta e não entrega valores", () => {
  const file = newFile();
  makeDb(file);
  const clock = { t: at(LAST_DT + 60) };
  const r = reader(file, clock);
  assert.equal(r.status(ctx).state, "ativo", "exatamente no limite ainda vale");
  clock.t = at(LAST_DT + 61);
  const s = r.status(ctx);
  assert.equal(s.state, "obsoleto");
  assert.equal(s.reason, "sem-eventos-recentes");
  assert.equal(s.available, false);
  assert.equal(s.fields, null);
  assert.equal(s.lastEventAgeMs, 61000);
  // Limite configurável.
  const strict = reader(file, { t: at(LAST_DT + 20) }, { staleMs: 10_000 });
  assert.equal(strict.status(ctx).state, "obsoleto");
});

test("frescor: qualquer evento da partida (até os ignorados) prova que o GEP está vivo", () => {
  const file = newFile();
  makeDb(file);
  append(file, fixture.game.id, [
    {
      dt: LAST_DT + 50,
      event_type: "match_info",
      round: "1-3",
      feature: "match_info",
      key: "battle_stats",
      data: "[]",
    },
  ]);
  const s = reader(file, { t: at(LAST_DT + 100) }).status(ctx);
  assert.equal(s.state, "ativo");
  assert.equal(s.lastEventAgeMs, 50_000);
});

test("partida errada ou fora de partida: ausente com o motivo", () => {
  const file = newFile();
  makeDb(file);
  const r = reader(file, { t: at(LAST_DT + 2) });
  assert.deepEqual(
    [
      r.status({ ...ctx, gameId: "999" }).reason,
      r.status({ ...ctx, inMatch: false }).reason,
      r.status({ ...ctx, set: 17 }).reason,
    ],
    ["outra-partida", "fora-de-partida", "set-diferente"],
  );
  assert.equal(r.status({ ...ctx, gameId: "999" }).state, "ausente");
  // Fase desconhecida (LCU fora do ar) não bloqueia.
  assert.equal(r.status({ ...ctx, inMatch: null }).state, "ativo");
  // match_id ainda não gravado: vale a partida mais recente (ligação por recência).
  const noId = newFile();
  makeDb(noId, { matchId: null });
  const s = reader(noId, { t: at(LAST_DT + 2) }).status(ctx);
  assert.equal(s.state, "ativo");
  assert.equal(s.binding, "recencia");
  // Partida marcada como encerrada pelo TFTAcademy.
  const done = newFile();
  makeDb(done, { ended: BASE + 70 });
  assert.equal(
    reader(done, { t: at(LAST_DT + 2) }).status(ctx).reason,
    "partida-encerrada",
  );
});

test("identidade local divergente: o banco de itens fica desconhecido e o resto segue", () => {
  const file = newFile();
  makeDb(file);
  const s = reader(file, { t: at(LAST_DT + 2) }).status({
    ...ctx,
    local: { name: "OutraConta", tag: "XYZ" },
  });
  assert.equal(s.state, "ativo");
  assert.equal(s.identity, "divergente");
  assert.equal(s.fields.items, null);
  assert.equal(s.fields.gold.value, 0);
});

test("sem roster ainda: o item_bench espera a identidade e é resolvido quando ela chega", () => {
  const state = emptyGepState();
  const rows = fixture.rows.filter(
    (r) => r.key === "item_bench" || r.key === "player_status",
  );
  const firstBench = rows.find((r) => r.key === "item_bench"),
    roster = rows.find((r) => r.key === "player_status");
  applyGepEvent(state, {
    id: 1,
    ts: 1,
    feature: firstBench.feature,
    key: firstBench.key,
    data: firstBench.data,
  });
  assert.equal(state.items, null);
  assert.ok(state.pendingItemBench);
  applyGepEvent(state, {
    id: 2,
    ts: 2,
    feature: roster.feature,
    key: roster.key,
    data: roster.data,
  });
  assert.deepEqual(state.items.value, []);
  assert.equal(state.pendingItemBench, null);
});

test("rivais não são lidos (e aprimoramentos só nos pares feature.key certos): linhas dessas chaves não mudam nada", () => {
  const file = newFile();
  makeDb(file, { upToDt: 47 });
  const poison = (key, feature, data, dt) => ({
    dt,
    event_type: feature,
    round: "1-3",
    feature,
    key,
    data,
  });
  append(file, fixture.game.id, [
    poison(
      "opponent_board_pieces",
      "board",
      '{"cell_1":{"name":"DA_18_Varus","level":"3","item_1":"","item_2":"","item_3":""}}',
      48,
    ),
    poison(
      "board_pieces",
      "board",
      '{"cell_1":{"name":"DA_18_Rakan","level":"2"}}',
      48,
    ),
    poison(
      "augments",
      "me",
      '{"augment_1":{"name":"DA_Augment_Qualquer"}}',
      48,
    ),
    poison("round_outcome", "match_info", '{"Rival":{"outcome":"defeat"}}', 48),
    poison("battle_stats", "match_info", "[]", 48),
  ]);
  const s = reader(file, { t: at(49) }).status(ctx);
  assert.equal(s.state, "ativo");
  // A reserva continua a do jogador (id 47: Varus e Rakan, 1 estrela), não a "Varus 3 estrelas" do rival nem a do tabuleiro.
  assert.deepEqual(
    s.fields.bench.value.map((u) => [u.id, u.stars]),
    [
      ["DA_18_Varus", 1],
      ["DA_18_Rakan", 1],
    ],
  );
  assert.equal(s.fields.gold, null);
  assert.equal(s.lastEventAgeMs, 1000); // mas contam como sinal de vida
});

test("nova partida no banco: recomeça do zero, sem ouro/loja da anterior", () => {
  const file = newFile();
  makeDb(file);
  const clock = { t: at(LAST_DT + 2) };
  const r = reader(file, clock);
  assert.equal(r.status(ctx).fields.gold.value, 0);
  const db = new DatabaseSync(file);
  db.prepare(
    "INSERT INTO games (id, started_at, set_number, queue_type, created_at, match_id) VALUES (?,?,?,?,?,?)",
  ).run("game-fixture-2", BASE + 600, 18, 1100, BASE + 600, "BR1_1000000002");
  insertRows(db, "game-fixture-2", [
    {
      dt: 601,
      event_type: "match_info",
      round: "1-1",
      feature: "match_info",
      key: "round_type",
      data: '{"stage":"1-1","name":"PVE","type":"Encounter"}',
    },
  ]);
  db.close();
  clock.t = at(603);
  const s = r.status({ ...ctx, gameId: "1000000002" });
  assert.equal(s.state, "ativo");
  assert.equal(s.fields.stage.value, "1-1");
  assert.equal(s.fields.gold, null);
  assert.equal(s.fields.shop, null);
  assert.equal(s.fields.items, null);
  assert.equal(r.status(ctx).reason, "outra-partida");
});

test("banco ausente, sem partida, esquema diferente e arquivo que não é SQLite: ausente/esquema, sem lançar", () => {
  const clock = { t: at(10) };
  const missing = reader(path.join(tmp, "nao-existe.db"), clock).status(ctx);
  assert.deepEqual(
    [missing.state, missing.reason, missing.available],
    ["ausente", "banco-ausente", false],
  );

  const empty = newFile();
  const e = new DatabaseSync(empty);
  e.exec(SCHEMA);
  e.close();
  assert.equal(reader(empty, clock).status(ctx).reason, "sem-partida");

  const odd = newFile();
  const o = new DatabaseSync(odd);
  o.exec(
    "CREATE TABLE games (id text, started_at integer); CREATE TABLE events (id integer, game_id text, ts integer, payload text);",
  );
  o.close();
  const schema = reader(odd, clock).status(ctx);
  assert.equal(schema.state, "esquema-desconhecido");
  assert.equal(schema.reason, "colunas-ausentes");
  assert.match(schema.detail, /events: .*timestamp.*key.*data/);

  const noTable = newFile();
  const n = new DatabaseSync(noTable);
  n.exec("CREATE TABLE outra (a integer)");
  n.close();
  assert.equal(reader(noTable, clock).status(ctx).reason, "tabela-ausente");

  const junk = newFile();
  fs.writeFileSync(junk, "isto não é um banco SQLite ".repeat(200));
  const bad = reader(junk, clock).status(ctx);
  assert.equal(bad.state, "esquema-desconhecido");
  assert.equal(bad.available, false);
});

test("somente leitura: o banco não muda e nenhum arquivo novo é criado na pasta quando ninguém o tem aberto", () => {
  const file = newFile();
  makeDb(file);
  assert.equal(fs.existsSync(`${file}-wal`), false, "fechou limpo: sem -wal");
  assert.equal(
    gepOpenMode(file),
    "imutavel",
    "ninguém com o banco aberto: immutable=1",
  );
  const before = sha(file),
    mtime = fs.statSync(file).mtimeMs,
    files = fs.readdirSync(tmp).sort();
  const r = reader(file, { t: at(LAST_DT + 1) });
  assert.equal(r.status(ctx).state, "ativo");
  assert.equal(r.status(ctx).state, "ativo");
  assert.equal(sha(file), before);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  assert.deepEqual(fs.readdirSync(tmp).sort(), files);
});

test("leitura ao vivo: enxerga linhas ainda no WAL de outro processo que mantém o banco aberto", () => {
  const file = newFile();
  makeDb(file, { upToDt: 47 });
  const writer = new DatabaseSync(file); // o "TFTAcademy" com o banco aberto
  writer.exec("PRAGMA journal_mode=WAL");
  insertRows(
    writer,
    fixture.game.id,
    fixture.rows.filter((x) => x.dt >= 48 && x.dt <= 48),
  );
  assert.ok(
    fs.existsSync(`${file}-wal`) && fs.statSync(`${file}-wal`).size > 0,
    "linhas só no WAL",
  );
  assert.equal(
    gepOpenMode(file),
    "compartilhado",
    "com -wal ao lado a leitura é normal (enxerga o WAL), nunca immutable=1",
  );
  try {
    const s = reader(file, { t: at(49) }).status(ctx);
    assert.equal(s.fields.gold.value, 2);
  } finally {
    writer.close();
  }
});

// --- precedência e fallback no estado do servidor ------------------------------------------------------------------

function activeGep(over = {}) {
  const file = newFile();
  makeDb(file);
  return {
    gep: reader(file, { t: at(LAST_DT + 3) }).status(ctx),
    file,
    ...over,
  };
}
const screenSeen = () =>
  mergeSources(
    {
      running: true,
      error: null,
      window: true,
      stage: "2-1",
      gold: 7,
      level: 5,
      xp: "4/20",
      stale: { gold: false, level: false, xp: false, stage: false },
      items: ["DA_Component_BFSword"],
      bank: ["DA_Component_BFSword"],
      unknownItems: 1,
      shop: [{ text: "Algo", id: "DA_18_Elise" }, null, null, null, null],
      removers: 0,
    },
    { available: true, stage: "1-3", phase: "Planning", phaseKind: "planning" },
  );

test("precedência: GEP fresco vence a tela em ouro, nível, XP, banco de itens e loja; cada campo com origem e idade", () => {
  const { gep } = activeGep();
  const seen = mergeGep(screenSeen(), gep);
  assert.equal(seen.gold, 0);
  assert.equal(seen.level, 2);
  assert.equal(seen.xp, "0/2");
  assert.deepEqual(seen.items, []);
  assert.deepEqual(seen.bank, [
    "DA_Consumable_ItemRemover",
    "DA_Consumable_ItemRemover",
  ]);
  assert.equal(seen.removers, 2);
  assert.equal(seen.unknownItems, 0);
  assert.deepEqual(
    seen.shop.map((c) => c?.id ?? null),
    [null, null, "DA_18_Kobuko", "DA_18_RekSai", "DA_18_Akali_AD"],
  );
  assert.deepEqual(
    {
      gold: seen.sources.gold,
      level: seen.sources.level,
      xp: seen.sources.xp,
      items: seen.sources.items,
      shop: seen.sources.shop,
      bench: seen.sources.bench,
    },
    {
      gold: "gep",
      level: "gep",
      xp: "gep",
      items: "gep",
      shop: "gep",
      bench: "gep",
    },
  );
  assert.equal(seen.sourcesDetail.gold.source, "gep");
  assert.equal(seen.sourcesDetail.gold.confidence, "observed");
  assert.equal(seen.sourcesDetail.gold.inferred, true);
  assert.equal(typeof seen.sourcesDetail.level.ageMs, "number");
  assert.equal(seen.levelInfo.source, "gep");
  assert.equal(seen.stale.gold, false);
  assert.equal(seen.gepStatus.state, "ativo");
  assert.equal(
    "fields" in seen.gepStatus,
    false,
    "o resumo em /api/state não repete os valores",
  );
});

test("precedência: o estágio do arquivo do jogo continua valendo; o GEP só preenche quando falta", () => {
  const { gep } = activeGep();
  const withLog = mergeGep(screenSeen(), gep);
  assert.equal(withLog.stage, "1-3");
  assert.equal(withLog.sources.stage, "game-log");
  const noLog = mergeGep(
    mergeSources({ stage: null, gold: null, stale: {} }, { available: false }),
    gep,
  );
  assert.equal(noLog.stage, "1-3");
  assert.equal(noLog.sources.stage, "gep");
});

test("fallback: GEP obsoleto, ausente ou com esquema novo deixa a tela como está, sem erro", () => {
  const base = screenSeen();
  const { file } = activeGep();
  const stale = reader(file, { t: at(LAST_DT + 600) }).status(ctx);
  const merged = mergeGep(base, stale);
  assert.equal(merged.gold, 7);
  assert.equal(merged.level, 5);
  assert.equal(merged.sources.gold, "screen");
  assert.equal(merged.sources.level, "screen");
  assert.equal(merged.gepStatus.state, "obsoleto");
  assert.equal(merged.gepBench, undefined);
  const absent = mergeGep(
    base,
    reader(path.join(tmp, "x.db"), { t: 0 }).status(ctx),
  );
  assert.deepEqual(
    [absent.gold, absent.gepStatus.state, absent.gepStatus.reason],
    [7, "ausente", "banco-ausente"],
  );
  assert.equal(mergeGep(base, null).gepStatus.reason, "desligada");
  assert.equal(mergeGep(base, undefined).gold, 7);
});

test("fallback por campo: sem a identidade confirmada o banco de itens fica com a tela; loja escondida não troca a da tela", () => {
  const { file } = activeGep();
  const gep = reader(file, { t: at(LAST_DT + 3) }).status({
    ...ctx,
    local: { name: "Outra", tag: "Z" },
  });
  const seen = mergeGep(screenSeen(), gep);
  assert.equal(seen.gold, 0, "ouro vem do GEP");
  assert.deepEqual(
    seen.items,
    ["DA_Component_BFSword"],
    "itens ficam com a tela",
  );
  assert.equal(seen.sources.items, "screen");
  // Loja escondida segundo o GEP.
  const hidden = structuredClone(activeGep().gep);
  hidden.fields.shop.visible = false;
  const s2 = mergeGep(screenSeen(), hidden);
  assert.equal(s2.shop[0].id, "DA_18_Elise");
  assert.equal(s2.sources.shop, "screen");
});

test("reserva do GEP no formato do motor: só com GEP ativo, só do jogador, estrelas desconhecidas ficam de fora", () => {
  const { gep } = activeGep();
  const seen = mergeGep(screenSeen(), gep);
  const units = gepBenchUnits(seen, "47445859");
  assert.deepEqual(
    units.map((u) => [u.championName, u.starLevel, u.playerId, u.source]),
    [
      ["DA_18_Varus", 1, "47445859", "gep"],
      ["DA_18_Rakan", 1, "47445859", "gep"],
      ["DA_18_Rakan", 1, "47445859", "gep"],
      ["DA_18_Sentry", 1, "47445859", "gep"],
    ],
  );
  assert.deepEqual(units[0].itemNames, []);
  assert.deepEqual(gepBenchUnits(mergeGep(screenSeen(), null), "47445859"), []);
  assert.deepEqual(
    gepBenchUnits(
      { gepBench: [{ id: "DA_18_Rakan", stars: null, items: [] }] },
      "1",
    ),
    [],
  );
  // Sem GEP a reserva fica sem fonte (a entrada manual foi removida; nunca o que a interface mandar).
  assert.equal(mergeGep(screenSeen(), null).sources.bench, null);
});

test("evaluateGep: relógio adiantado em relação ao banco não gera idade negativa", () => {
  const file = newFile();
  makeDb(file);
  const s = reader(file, { t: at(LAST_DT - 30) }).status(ctx);
  assert.equal(s.lastEventAgeMs, 0);
  assert.equal(evaluateGep(null).reason, "ainda-nao-lido");
});

test("motor: a reserva do GEP chega ao motor com origem gep; sem GEP a reserva é vazia (nunca manual)", () => {
  const HERO = 47445859,
    snapshot = {
      gameId: 1,
      statsBlock: {
        setCoreName: "TFTSet18",
        players: [
          {
            playerId: HERO,
            health: 60,
            ffaStanding: 3,
            boardPieces: [
              {
                championName: "DA_18_Leona",
                starLevel: 1,
                itemNames: [],
                price: 1,
              },
            ],
          },
          { playerId: 101, health: 50, ffaStanding: 4, boardPieces: [] },
        ],
      },
    };
  const run = (bench) =>
    analyze(snapshot, catalog, {
      level: 3,
      targetLevel: 5,
      gold: 2,
      bench,
      inventory: [],
      playerId: String(HERO),
      metaComps: [],
      previewIds: [],
      baseAvg: 4.47,
      conditional: new Map(),
      evidence: new Map(),
    });
  const { gep } = activeGep();
  const seen = mergeGep(screenSeen(), gep);
  const withGep = run(gepBenchUnits(seen, String(HERO)));
  assert.deepEqual(
    withGep.self.reserve.map((u) => [u.id, u.stars, u.source]).sort(),
    [
      ["DA_18_Rakan", 1, "gep"],
      ["DA_18_Rakan", 1, "gep"],
      ["DA_18_Sentry", 1, "gep"],
      ["DA_18_Varus", 1, "gep"],
    ],
  );
  assert.deepEqual(
    run(gepBenchUnits(mergeGep(screenSeen(), null), String(HERO))).self.reserve,
    [],
  );
  // E o banco de itens do GEP (vazio de componentes) vale como leitura: o enviado pelo cliente não o sobrescreve.
  assert.deepEqual(
    recommendInventory(["DA_Component_BFSword"], seen, (id) => items.has(id)),
    [],
  );
  assert.deepEqual(
    recommendInventory(
      ["DA_Component_BFSword"],
      mergeGep(screenSeen(), null),
      (id) => items.has(id),
    ),
    ["DA_Component_BFSword"],
  );
});

// --- gravação desligada (configuração record_games do TFTAcademy) --------------------------------------------------

/** Cria/atualiza linhas na tabela `settings` do banco de teste (esquema do TFTAcademy). */
function withSettings(file, rows) {
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY NOT NULL, value text, updated_at integer)",
  );
  const put = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?,?,?)",
  );
  for (const [k, v] of Object.entries(rows)) put.run(k, v, BASE);
  db.close();
}

test("parsing: record_games como texto, JSON ou 0/1; ilegível é desconhecido", () => {
  assert.equal(parseRecordGames("false"), false);
  assert.equal(parseRecordGames("true"), true);
  assert.equal(parseRecordGames('"false"'), false);
  assert.equal(parseRecordGames(" TRUE "), true);
  assert.equal(parseRecordGames("0"), false);
  assert.equal(parseRecordGames(1), true);
  assert.equal(parseRecordGames("talvez"), null);
  assert.equal(parseRecordGames(null), null);
  assert.equal(parseRecordGames(undefined), null);
});

test("abertura somente leitura: com -wal ou -shm lê normal (vê o WAL); só sem eles usa immutable=1", () => {
  const f = "/pasta/tft-events.db";
  assert.equal(
    gepOpenMode(f, () => false),
    "imutavel",
  );
  assert.equal(
    gepOpenMode(f, (p) => p === `${f}-wal`),
    "compartilhado",
  );
  assert.equal(
    gepOpenMode(f, (p) => p === `${f}-shm`),
    "compartilhado",
  );
  assert.equal(
    gepOpenMode(f, () => true),
    "compartilhado",
  );
});

test("gravação desligada: sem partida o motivo é gravacao-desligada e só record_games é lido de settings", () => {
  const file = newFile();
  const e = new DatabaseSync(file);
  e.exec(SCHEMA);
  e.close();
  withSettings(file, {
    record_games: "false",
    outra_chave: "segredo-que-nao-pode-aparecer",
  });
  const s = reader(file, { t: at(10) }).status(ctx);
  assert.deepEqual(
    [s.state, s.reason, s.was, s.recordGames, s.available],
    ["ausente", "gravacao-desligada", "sem-partida", false, false],
  );
  assert.doesNotMatch(JSON.stringify(s), /segredo/);
  // Garantia estática: a única consulta a `settings` é a de uma chave, parametrizada.
  const src = fs.readFileSync(
    new URL("../gep-reader.mjs", import.meta.url),
    "utf8",
  );
  assert.equal((src.match(/FROM settings/g) ?? []).length, 1);
  assert.match(src, /SELECT value FROM settings WHERE key = \?/);
});

test("gravação desligada: partida velha vira gravacao-desligada; partida já em gravação segue ativa; ligada mantém obsoleto", () => {
  const off = newFile();
  makeDb(off);
  withSettings(off, { record_games: "false" });
  const old = reader(off, { t: at(LAST_DT + 600) }).status(ctx);
  assert.deepEqual(
    [old.state, old.reason, old.was, old.recordGames, old.fields],
    ["ausente", "gravacao-desligada", "sem-eventos-recentes", false, null],
  );
  // O mesmo banco com a partida ainda fresca (gravação ligada quando ela começou): ativo, mas a configuração é informada.
  const live = reader(off, { t: at(LAST_DT + 3) }).status(ctx);
  assert.equal(live.state, "ativo");
  assert.equal(live.recordGames, false);
  // Outra partida no jogo: com a gravação desligada o banco não pode ter a de agora.
  assert.equal(
    reader(off, { t: at(LAST_DT + 3) }).status({ ...ctx, gameId: "999" })
      .reason,
    "gravacao-desligada",
  );
  // Fora de partida o motivo próprio fica (a configuração continua em recordGames).
  const outside = reader(off, { t: at(LAST_DT + 3) }).status({
    ...ctx,
    inMatch: false,
  });
  assert.deepEqual(
    [outside.reason, outside.recordGames],
    ["fora-de-partida", false],
  );
  // Ligada: o motivo é o de sempre.
  const on = newFile();
  makeDb(on);
  withSettings(on, { record_games: "true" });
  const stale = reader(on, { t: at(LAST_DT + 600) }).status(ctx);
  assert.deepEqual(
    [stale.state, stale.reason, stale.recordGames],
    ["obsoleto", "sem-eventos-recentes", true],
  );
  // Sem a tabela settings ou com valor ilegível: desconhecida, nada muda.
  const none = newFile();
  makeDb(none);
  const n = reader(none, { t: at(LAST_DT + 600) }).status(ctx);
  assert.deepEqual([n.reason, n.recordGames], ["sem-eventos-recentes", null]);
  const junk = newFile();
  makeDb(junk);
  withSettings(junk, { record_games: "talvez" });
  const j = reader(junk, { t: at(LAST_DT + 600) }).status(ctx);
  assert.deepEqual([j.reason, j.recordGames], ["sem-eventos-recentes", null]);
});

test("gravação desligada: religar a configuração é percebido na leitura seguinte; esquema desconhecido não é mascarado", () => {
  const file = newFile();
  const e = new DatabaseSync(file);
  e.exec(SCHEMA);
  e.close();
  withSettings(file, { record_games: "false" });
  const clock = { t: at(10) };
  const r = reader(file, clock);
  assert.equal(r.status(ctx).reason, "gravacao-desligada");
  withSettings(file, { record_games: "true" });
  clock.t += 6000; // passa o recuo de leitura com falha
  const again = r.status(ctx);
  assert.deepEqual([again.reason, again.recordGames], ["sem-partida", true]);
  // Esquema desconhecido continua sendo esquema desconhecido, com ou sem a configuração.
  const odd = newFile();
  const o = new DatabaseSync(odd);
  o.exec(
    "CREATE TABLE games (id text, started_at integer); CREATE TABLE events (id integer, game_id text);",
  );
  o.close();
  withSettings(odd, { record_games: "false" });
  assert.equal(
    reader(odd, { t: at(10) }).status(ctx).state,
    "esquema-desconhecido",
  );
});

// --- Wisps (fogos-fátuos) na loja ----------------------------------------------------------------------------------

test("Wisp na loja: separado dos campeões, com nome do catálogo; nome fora do catálogo e sem 'Wisp' segue desconhecido", () => {
  const wisps = wispCatalog(catalog.items, [
    { id: "DA_AbandonShip18", name: "Abandonar Navio", nameEn: "Abandon Ship" },
  ]);
  assert.ok(wisps.has("DA_AbandonShip18") && wisps.has("DA_BeggarsWisp18"));
  assert.ok(wisps.size > 100, "todos os itens com a etiqueta de Wisp");
  assert.ok(!wisps.has("DA_Component_BFSword"), "item comum não é Wisp");
  const shop = parseShop(
    JSON.stringify({
      slot_1: { name: "DA_18_Rakan" },
      slot_2: { name: "DA_AbandonShip18" },
      slot_3: { name: "Sold" },
      slot_4: { name: "DA_NovoWisp_Futuro" },
      slot_5: { name: "DA_99_Nada" },
    }),
    (id) => champions.has(id),
    wispLookup(wisps),
  );
  assert.equal(shop[0].id, "DA_18_Rakan");
  assert.equal(shop[0].wisp, undefined);
  assert.deepEqual(
    [
      shop[1].id,
      shop[1].wisp,
      shop[1].wispId,
      shop[1].wispName,
      shop[1].wispKnown,
    ],
    [null, true, "DA_AbandonShip18", "Abandonar Navio", true],
  );
  assert.equal(shop[2], null, "Sold continua vazio");
  assert.deepEqual(
    [shop[3].id, shop[3].wisp, shop[3].wispKnown],
    [null, true, false],
    "tem 'Wisp' no id mas não está no catálogo: Wisp não confirmado",
  );
  assert.deepEqual([shop[4].id, shop[4].wisp], [null, undefined]);
  assert.deepEqual(shopWisps(shop), [
    { slot: 2, id: "DA_AbandonShip18", name: "Abandonar Navio", known: true },
    { slot: 4, id: "DA_NovoWisp_Futuro", name: null, known: false },
  ]);
  // Sem catálogo de Wisps só o id com "Wisp" é reconhecido; um campeão do catálogo nunca vira Wisp.
  const bare = parseShop(
    '{"slot_1":{"name":"DA_AbandonShip18"},"slot_2":{"name":"DA_BeggarsWisp18"},"slot_3":{"name":"DA_18_Rakan"}}',
    (id) => champions.has(id),
    wispLookup(null),
  );
  assert.deepEqual(
    bare.map((c) => [c?.id ?? null, c?.wisp === true]),
    [
      [null, false],
      [null, true],
      ["DA_18_Rakan", false],
      [null, false],
      [null, false],
    ],
  );
});

test("Wisp na loja pelo leitor e pela mescla: wisps separados, shop só com campeões, a análise lê id nulo", () => {
  const wisps = wispCatalog(catalog.items, [
    { id: "DA_AbandonShip18", name: "Abandonar Navio", nameEn: "Abandon Ship" },
  ]);
  const file = newFile();
  makeDb(file, {
    extraRows: [
      {
        dt: LAST_DT + 1,
        event_type: "store",
        round: "1-3",
        feature: "store",
        key: "shop_pieces",
        data: JSON.stringify({
          slot_1: { name: "DA_18_Rakan" },
          slot_2: { name: "DA_AbandonShip18" },
          slot_3: { name: "Sold" },
          slot_4: { name: "DA_BeggarsWisp18" },
          slot_5: { name: "DA_18_Sentry" },
        }),
      },
    ],
  });
  const gep = reader(file, { t: at(LAST_DT + 2) }, { wisps }).status(ctx);
  assert.deepEqual(
    gep.fields.shop.value.map((c) => c?.id ?? null),
    ["DA_18_Rakan", null, null, null, "DA_18_Sentry"],
  );
  assert.deepEqual(
    gep.fields.shop.wisps.map((w) => [w.slot, w.id, w.name, w.known]),
    [
      [2, "DA_AbandonShip18", "Abandonar Navio", true],
      [4, "DA_BeggarsWisp18", "Beggar's Wisp", true],
    ],
  );
  assert.equal(gep.coverage.wisps, 2);
  const seen = mergeGep(screenSeen(), gep);
  assert.deepEqual(seen.wisps, gep.fields.shop.wisps);
  assert.equal(seen.sources.wisps, "gep");
  assert.equal(seen.sourcesDetail.wisps.confidence, "observed");
  assert.equal(seen.shop[1].wisp, true);
  // O estado normalizado traz os Wisps como campo próprio.
  const state = buildGameState(seen, { now: 1_000_000, gameId: "g" });
  assert.equal(state.me.wisps.source, "gep");
  assert.equal(state.me.wisps.value.length, 2);
  // A análise só recebe campeões: o Wisp vira id nulo (o motor e a rolagem descartam id nulo).
  assert.deepEqual(analysisInputs(seen, { live: false }).shop, [
    "DA_18_Rakan",
    null,
    null,
    null,
    "DA_18_Sentry",
  ]);
  // Mesmo uma carta de Wisp com id preenchido por engano não passa para a análise.
  assert.deepEqual(
    analysisInputs(
      { shop: [{ id: "DA_X", wisp: true }, { id: "DA_18_Rakan" }] },
      { live: false },
    ).shop,
    [null, "DA_18_Rakan"],
  );
  // Loja escondida ou escolhida a da tela pela precedência: os Wisps do GEP não entram.
  const hidden = structuredClone(gep);
  hidden.fields.shop.visible = false;
  assert.equal(mergeGep(screenSeen(), hidden).wisps, undefined);
  const denied = mergeGep(screenSeen(), gep, (name) => name !== "shop");
  assert.equal(denied.wisps, undefined);
  assert.equal(denied.sources.wisps, undefined);
  // Sem GEP, nada de Wisps (a tela não os distingue).
  assert.equal(mergeGep(screenSeen(), null).wisps, undefined);
});

// --- aprimoramentos (oferta e escolhidos) --------------------------------------------------------------------------

const AUGS = new Set(["DA_18_BigGrabBag", "DA_Min_Max", "DA_Kingslayer"]);
const augRow = (dt, feature, key, data, round = "2-1") => ({
  dt,
  event_type: feature,
  round,
  feature,
  key,
  data,
});
const augData = (...names) =>
  JSON.stringify(
    Object.fromEntries(names.map((n, i) => [`augment_${i + 1}`, { name: n }])),
  );

test("parsing: resolução de aprimoramentos pelo catálogo (exato, caminho/extensão, caixa) e ambíguo é desconhecido", () => {
  const resolve = augmentResolver(AUGS);
  assert.equal(resolve("DA_Min_Max"), "DA_Min_Max");
  assert.equal(resolve("da_min_max"), "DA_Min_Max");
  assert.equal(resolve("Game/Augments/DA_Min_Max.DA_Min_Max"), "DA_Min_Max");
  assert.equal(resolve("DA_Inexistente"), null);
  assert.equal(resolve(""), null);
  assert.equal(
    augmentResolver(["DA_A", "da_a"])("Da_A"),
    null,
    "duas caixas possíveis: não adivinha",
  );
  assert.equal(
    augmentResolver(["DA_A", "da_a"])("DA_A"),
    "DA_A",
    "o exato sempre vale",
  );
  assert.equal(
    augmentResolver(null)("qualquer"),
    "qualquer",
    "sem catálogo aceita tudo",
  );
});

test("parsing: oferta de aprimoramentos na ordem dos espaços; vazia é tela fechada; fora do catálogo é contado", () => {
  const resolve = augmentResolver(AUGS);
  const swapped = JSON.stringify({
    augment_3: { name: "DA_Kingslayer" },
    augment_1: { name: "DA_18_BigGrabBag" },
    augment_2: { name: "da_min_max" },
  });
  const offer = parseAugmentOffer(swapped, resolve);
  assert.deepEqual(offer.ids, [
    "DA_18_BigGrabBag",
    "DA_Min_Max",
    "DA_Kingslayer",
  ]);
  assert.equal(offer.unknown, 0);
  const partial = parseAugmentOffer(
    augData("DA_Kingslayer", "DA_Nada", "DA_Min_Max"),
    resolve,
  );
  assert.deepEqual(partial.ids, ["DA_Kingslayer", "DA_Min_Max"]);
  assert.equal(partial.unknown, 1);
  assert.deepEqual(partial.cards[1], { text: "DA_Nada", id: null });
  assert.deepEqual(parseAugmentOffer("{}", resolve), {
    cards: [],
    ids: [],
    unknown: 0,
  });
  assert.deepEqual(parseAugmentOffer(augData(""), resolve).cards, []);
  assert.equal(parseAugmentOffer("[]", resolve), null);
  assert.equal(parseAugmentOffer("não é json", resolve), null);
  // Itens de campeão do anel de aprimoramentos não são aprimoramentos.
  assert.deepEqual(
    parseAugmentOffer(augData("TFT_ChampionItem_Foo", "DA_Min_Max"), resolve)
      .ids,
    ["DA_Min_Max"],
  );
});

test("parsing: aprimoramento escolhido = último nome não vazio (objeto de espaços, {name}, texto)", () => {
  const resolve = augmentResolver(AUGS);
  assert.deepEqual(
    parseAugmentPicked(augData("DA_Kingslayer", "DA_Min_Max"), resolve),
    {
      text: "DA_Min_Max",
      id: "DA_Min_Max",
    },
  );
  assert.deepEqual(
    parseAugmentPicked('{"name":"DA_Kingslayer","tier":"S"}', resolve),
    {
      text: "DA_Kingslayer",
      id: "DA_Kingslayer",
    },
  );
  assert.equal(
    parseAugmentPicked('"DA_Kingslayer"', resolve).id,
    "DA_Kingslayer",
  );
  assert.equal(
    parseAugmentPicked("DA_Kingslayer", resolve).id,
    "DA_Kingslayer",
  );
  assert.deepEqual(parseAugmentPicked('"DA_Fora"', resolve), {
    text: "DA_Fora",
    id: null,
  });
  assert.equal(parseAugmentPicked("{}", resolve), null);
  assert.equal(parseAugmentPicked("null", resolve), null);
  assert.equal(parseAugmentPicked(null, resolve), null);
});

test("aprimoramentos escolhidos: formato real é cumulativo (slot_1..4); ler no meio da partida não perde os anteriores", () => {
  const resolve = augmentResolver(AUGS);
  // Formato observado (partida de 2026-10-11): `augments.picked_augment` reenvia a lista inteira, espaços vazios com "".
  const real = (...names) =>
    JSON.stringify(
      Object.fromEntries(
        [1, 2, 3, 4].map((i) => [`slot_${i}`, { name: names[i - 1] ?? "" }]),
      ),
    );
  assert.deepEqual(
    parseAugmentPickedList(real("DA_Kingslayer", "DA_Min_Max"), resolve).map(
      (x) => x.id,
    ),
    ["DA_Kingslayer", "DA_Min_Max"],
  );
  assert.deepEqual(parseAugmentPickedList("{}", resolve), []);
  assert.deepEqual(parseAugmentPickedList('"DA_Fora"', resolve), [
    { text: "DA_Fora", id: null },
  ]);
  const state = emptyGepState();
  const feed = (ts, data) =>
    applyGepEvent(
      state,
      { id: ts, ts, feature: "augments", key: "picked_augment", data },
      { resolveAugment: resolve },
    );
  feed(1, real("DA_Kingslayer"));
  feed(2, real("DA_Kingslayer", "DA_Min_Max"));
  feed(3, real("DA_Kingslayer", "DA_Min_Max"));
  assert.deepEqual(
    state.augmentPicked.value.map((x) => x.id),
    ["DA_Kingslayer", "DA_Min_Max"],
  );
  // Começando tarde (já com dois na lista): os dois entram, na ordem.
  const late = emptyGepState();
  applyGepEvent(
    late,
    {
      id: 9,
      ts: 9,
      feature: "augments",
      key: "picked_augment",
      data: real("DA_Kingslayer", "DA_Min_Max"),
    },
    { resolveAugment: resolve },
  );
  assert.deepEqual(
    late.augmentPicked.value.map((x) => x.id),
    ["DA_Kingslayer", "DA_Min_Max"],
  );
});

function augGep(extraRows, extra = { augments: AUGS }, dt = LAST_DT + 12) {
  const file = newFile();
  makeDb(file, { extraRows });
  return reader(file, { t: at(dt) }, extra).status(ctx);
}
const FULL_AUG_ROWS = [
  augRow(
    LAST_DT + 1,
    "match_info",
    "round_type",
    '{"stage":"2-1","name":"Augment","type":"Augment_1"}',
  ),
  augRow(
    LAST_DT + 2,
    "augments",
    "me",
    augData("DA_18_BigGrabBag", "da_min_max", "DA_Kingslayer"),
  ),
  augRow(LAST_DT + 9, "match_info", "picked_augment", augData("DA_Min_Max")),
  augRow(LAST_DT + 9, "match_info", "picked_augment", augData("DA_Min_Max")),
];

test("aprimoramentos pelo leitor: oferta e escolhido do jogador mapeados ao catálogo, com estágio, idade e sem repetir", () => {
  const s = augGep(FULL_AUG_ROWS);
  assert.equal(s.state, "ativo");
  const f = s.fields;
  assert.deepEqual(f.augmentOffer.value, [
    "DA_18_BigGrabBag",
    "DA_Min_Max",
    "DA_Kingslayer",
  ]);
  assert.equal(f.augmentOffer.count, 3);
  assert.equal(f.augmentOffer.unknown, 0);
  assert.equal(f.augmentOffer.ageMs, 10_000);
  assert.deepEqual(f.augmentPicked.value, [{ id: "DA_Min_Max", stage: "2-1" }]);
  assert.equal(f.augmentPicked.ageMs, 3000);
  assert.deepEqual(s.coverage, {
    augmentOffer: 3,
    augmentPicked: 1,
    augmentUnknown: 0,
    augmentUnresolved: [],
    wisps: 0,
  });
  // Dois escolhidos em momentos diferentes: em ordem, cada um com o estágio da hora.
  const two = augGep([
    ...FULL_AUG_ROWS,
    augRow(
      LAST_DT + 10,
      "match_info",
      "round_type",
      '{"stage":"3-2","name":"Augment","type":"Augment_2"}',
    ),
    augRow(
      LAST_DT + 11,
      "match_info",
      "picked_augment",
      augData("DA_Kingslayer"),
      "3-2",
    ),
  ]);
  assert.deepEqual(two.fields.augmentPicked.value, [
    { id: "DA_Min_Max", stage: "2-1" },
    { id: "DA_Kingslayer", stage: "3-2" },
  ]);
});

test("aprimoramentos: só os pares feature.key do jogador (outra feature com a mesma chave não entra)", () => {
  const s = augGep([
    augRow(
      LAST_DT + 1,
      "live_client_data",
      "me",
      augData("DA_Kingslayer", "DA_Min_Max"),
    ),
    augRow(LAST_DT + 2, "board", "picked_augment", augData("DA_Kingslayer")),
    augRow(LAST_DT + 3, "opponent", "augments", augData("DA_Kingslayer")),
    augRow(LAST_DT + 4, "roster", "me", augData("DA_Kingslayer")),
  ]);
  assert.equal(s.state, "ativo");
  assert.equal(s.fields.augmentOffer, null);
  assert.equal(s.fields.augmentPicked, null);
  assert.equal(s.lastEventAgeMs, 8000, "mas contam como sinal de vida");
  // `me.picked_augment` é aceito (o TFTAcademy não filtra a feature do escolhido).
  const viaMe = augGep([
    augRow(LAST_DT + 1, "me", "picked_augment", '"DA_Kingslayer"', null),
  ]);
  // Sem a coluna `round` no evento, vale o estágio do último `round_type`.
  assert.deepEqual(viaMe.fields.augmentPicked.value, [
    { id: "DA_Kingslayer", stage: "1-3" },
  ]);
});

test("aprimoramentos: sem a coluna feature só as chaves inequívocas (a chave me sozinha é ignorada)", () => {
  const file = newFile();
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE games (id text PRIMARY KEY, started_at integer NOT NULL); CREATE TABLE events (id integer PRIMARY KEY AUTOINCREMENT, game_id text NOT NULL, timestamp integer NOT NULL, key text, data text);",
  );
  db.prepare("INSERT INTO games (id, started_at) VALUES (?,?)").run("g", BASE);
  const put = db.prepare(
    "INSERT INTO events (game_id, timestamp, key, data) VALUES (?,?,?,?)",
  );
  put.run("g", BASE + 1, "gold", "5");
  put.run("g", BASE + 2, "me", augData("DA_Kingslayer", "DA_Min_Max"));
  put.run("g", BASE + 3, "picked_augment", '"DA_Kingslayer"');
  db.close();
  const s = reader(file, { t: (BASE + 4) * 1000 }, { augments: AUGS }).status({
    inMatch: true,
  });
  assert.equal(s.state, "ativo");
  assert.equal(s.fields.gold.value, 5);
  assert.equal(s.fields.augmentOffer, null);
  assert.deepEqual(s.fields.augmentPicked.value, [
    { id: "DA_Kingslayer", stage: null },
  ]);
});

test("aprimoramentos na mescla: só o GEP (a oferta lida da tela por OCR é descartada) e os escolhidos vêm com ele, mesmo contra a precedência dos demais campos", () => {
  const gep = augGep(FULL_AUG_ROWS);
  const base = { ...screenSeen(), augments: ["DA_Kingslayer", "DA_Fora"] };
  const seen = mergeGep(base, gep);
  // A oferta do FULL_AUG_ROWS foi seguida da escolha (`picked_augment`), mas o `augments.me` vazio não veio: segue aberta.
  assert.deepEqual(seen.augments, [
    "DA_18_BigGrabBag",
    "DA_Min_Max",
    "DA_Kingslayer",
  ]);
  assert.equal(seen.sources.augments, "gep");
  assert.equal(seen.sourcesDetail.augments.confidence, "observed");
  assert.equal(seen.sourcesDetail.augments.ageMs, 10_000);
  assert.deepEqual(seen.augmentOffer, {
    open: true,
    stage: "2-1",
    cards: [
      {
        slot: 1,
        id: "DA_18_BigGrabBag",
        text: "DA_18_BigGrabBag",
        rerolled: false,
      },
      { slot: 2, id: "DA_Min_Max", text: "da_min_max", rerolled: false },
      { slot: 3, id: "DA_Kingslayer", text: "DA_Kingslayer", rerolled: false },
    ],
    unresolved: [],
    ageMs: 10_000,
  });
  assert.deepEqual(seen.augmentSource, {
    state: "ativo",
    source: "gep",
    reason: null,
    held: false,
    picked: 1,
    unresolved: [],
  });
  assert.deepEqual(seen.pickedAugments, [{ id: "DA_Min_Max", stage: "2-1" }]);
  assert.equal(seen.sources.pickedAugments, "gep");
  const state = buildGameState(seen, { now: 1_000_000, gameId: "g" });
  assert.equal(state.me.pickedAugments.source, "gep");
  assert.equal(state.me.augmentOffer.source, "gep");
  // A precedência com histerese (tela escolhida para ouro) não esconde o que só o GEP observa.
  const screenWins = mergeGep(base, gep, () => false);
  assert.equal(screenWins.gold, 7);
  assert.equal(screenWins.sources.gold, "screen");
  assert.deepEqual(screenWins.pickedAugments, [
    { id: "DA_Min_Max", stage: "2-1" },
  ]);
  assert.equal(screenWins.augments.length, 3);
  // GEP obsoleto ou ausente: SEM FONTE de aprimoramentos (a oferta da tela não volta), sem erro e sem escolhidos.
  const stale = mergeGep(
    base,
    augGep(FULL_AUG_ROWS, { augments: AUGS }, LAST_DT + 900),
  );
  assert.equal(stale.augments, null);
  assert.equal(stale.augmentOffer, null);
  assert.equal(stale.sources.augments, undefined);
  assert.equal(stale.pickedAugments, undefined);
  assert.equal(stale.gepStatus.state, "obsoleto");
  assert.deepEqual(stale.augmentSource, {
    state: "sem-fonte",
    source: null,
    reason: "sem-eventos-recentes",
    held: false,
    picked: 0,
    unresolved: [],
  });
  const none = mergeGep(base, null);
  assert.equal(none.augments, null);
  assert.equal(none.augmentSource.state, "sem-fonte");
  assert.equal(none.augmentSource.reason, "desligada");
  assert.equal(buildGameState(none).me.augmentOffer.value, null);
});

test("aprimoramentos: carta fora do catálogo fica de fora e NOMEADA; oferta vazia fecha a escolha; sem eventos é aguardando", () => {
  const base = { ...screenSeen(), augments: ["DA_Kingslayer", "DA_Min_Max"] };
  const partial = augGep(
    [
      augRow(
        LAST_DT + 1,
        "augments",
        "me",
        augData("DA_18_BigGrabBag", "DA_Min_Max", "DA_Inexistente"),
      ),
      augRow(LAST_DT + 2, "match_info", "picked_augment", '"DA_Inexistente"'),
    ],
    { augments: AUGS },
    LAST_DT + 3,
  );
  assert.equal(partial.fields.augmentOffer.unknown, 1);
  assert.deepEqual(partial.fields.augmentOffer.value, [
    "DA_18_BigGrabBag",
    "DA_Min_Max",
  ]);
  assert.deepEqual(partial.fields.augmentOffer.unresolved, ["DA_Inexistente"]);
  assert.deepEqual(partial.fields.augmentPicked.value, []);
  assert.equal(partial.fields.augmentPicked.unknown, 1);
  assert.deepEqual(partial.fields.augmentPicked.unresolved, ["DA_Inexistente"]);
  assert.equal(partial.coverage.augmentUnknown, 2);
  assert.deepEqual(partial.coverage.augmentUnresolved, ["DA_Inexistente"]);
  const seen = mergeGep(base, partial);
  assert.deepEqual(
    seen.augments,
    ["DA_18_BigGrabBag", "DA_Min_Max"],
    "as cartas do catálogo valem; a desconhecida fica nomeada",
  );
  assert.equal(seen.sources.augments, "gep");
  assert.deepEqual(seen.augmentOffer.cards[2], {
    slot: 3,
    id: null,
    text: "DA_Inexistente",
    rerolled: false,
  });
  assert.deepEqual(seen.augmentOffer.unresolved, ["DA_Inexistente"]);
  assert.deepEqual(seen.augmentSource.unresolved, ["DA_Inexistente"]);
  assert.equal(seen.pickedAugments, undefined);
  assert.equal(seen.sources.pickedAugments, undefined);
  // Oferta vazia (escolha feita/fechada): nenhuma oferta, mesmo que a tela ainda mostre uma antiga.
  const closed = augGep(
    [augRow(LAST_DT + 1, "augments", "me", "{}")],
    { augments: AUGS },
    LAST_DT + 3,
  );
  assert.deepEqual(closed.fields.augmentOffer.value, []);
  const closedSeen = mergeGep(base, closed);
  assert.deepEqual(closedSeen.augments, []);
  assert.equal(closedSeen.augmentOffer.open, false);
  // GEP ativo sem nenhum evento de aprimoramento ainda (antes do 2-1): aguardando, oferta desconhecida.
  const before = mergeGep(base, augGep([]));
  assert.equal(before.augments, null);
  assert.equal(before.augmentSource.state, "aguardando");
});

test("aprimoramentos escolhidos na análise: o registro manual prevalece (mesmo vazio); sem ele valem os do GEP", () => {
  const gepPicked = [
    { id: "DA_Min_Max", stage: "2-1" },
    { id: "DA_Fora", stage: "2-1" },
    { id: "DA_Kingslayer", stage: "3-2" },
  ];
  const valid = (id) => AUGS.has(id);
  assert.deepEqual(chosenAugmentIds({ gepPicked, valid }), {
    ids: ["DA_Min_Max", "DA_Kingslayer"],
    source: "gep",
    stages: new Map([
      ["DA_Min_Max", "2-1"],
      ["DA_Kingslayer", "3-2"],
    ]),
  });
  // O usuário marcou (ou corrigiu) à mão: o GEP não altera nada.
  assert.deepEqual(
    chosenAugmentIds({
      manual: ["DA_18_BigGrabBag"],
      known: true,
      gepPicked,
      valid,
    }),
    { ids: ["DA_18_BigGrabBag"], source: "manual", stages: new Map() },
  );
  // Remoção explícita (registro existe e está vazio): vale o vazio.
  assert.deepEqual(
    chosenAugmentIds({ manual: [], known: true, gepPicked, valid }),
    {
      ids: [],
      source: "manual",
      stages: new Map(),
    },
  );
  // Nada do GEP e nada manual: sem origem.
  assert.deepEqual(
    chosenAugmentIds({ manual: [], known: false, gepPicked: [], valid }),
    {
      ids: [],
      source: null,
      stages: new Map(),
    },
  );
  assert.equal(chosenAugmentIds({ gepPicked: undefined }).source, null);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
