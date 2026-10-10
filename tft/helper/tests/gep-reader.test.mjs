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
  emptyGepState,
  applyGepEvent,
  evaluateGep,
  gepBenchUnits,
  gepReader,
  matchIdDigits,
  mergeGep,
  parseBench,
  parseGold,
  parseItemBench,
  parseLocalIdentity,
  parseShop,
  parseXp,
} from "../gep-reader.mjs";
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
  assert.doesNotMatch(dump, /Rival[A-G]|opponent|battle_stats|augment/i);
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

test("rivais e aprimoramentos não são lidos: linhas dessas chaves não mudam nada", () => {
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
  // Sem GEP a reserva volta a ser manual (nunca o que a interface mandar).
  assert.equal(mergeGep(screenSeen(), null).sources.bench, "manual");
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

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
