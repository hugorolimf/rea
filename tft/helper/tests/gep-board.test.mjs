// Rodar com: node --test tft/helper/tests/gep-board.test.mjs
// Tabuleiro do PRÓPRIO jogador pelo GEP (`board.board_pieces`): casa de cada peça (linha/coluna), estrelas e itens.
// Payloads reais higienizados em tests/fixtures/gep-board.json (só ids de campeões e itens; sem nomes de jogadores).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  BOARD_COLS,
  BOARD_ROWS,
  boardCell,
  gepReader,
  mergeGep,
  parseBoard,
} from "../gep-reader.mjs";
import { gameFilesState } from "../game-log.mjs";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/gep-board.json", import.meta.url),
    "utf8",
  ),
);
const catalog = JSON.parse(
  fs.readFileSync(new URL("../catalog.json", import.meta.url), "utf8"),
);
const champions = new Set(catalog.champions.map((c) => c.apiName)),
  items = new Set(catalog.items.map((i) => i.apiName)),
  isChampion = (id) => champions.has(id),
  isItem = (id) => items.has(id);

const BASE = 1_800_000_000; // segundos
const GAME = { id: "game-board-1", matchId: "BR1_1000000009" };
const ctx = { gameId: "1000000009", inMatch: true, set: 18 };
const SCHEMA = `
  CREATE TABLE games (id text PRIMARY KEY NOT NULL, started_at integer NOT NULL, ended_at integer, game_version text,
    set_number real, player_puuid text, final_placement integer, queue_type integer, created_at integer NOT NULL, match_id text);
  CREATE TABLE events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, game_id text NOT NULL, timestamp integer NOT NULL,
    event_type text NOT NULL, player_id text, round text, stage_type text, key text, data text, created_at integer NOT NULL,
    feature text, category text, FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE);`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gep-board-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let counter = 0;

/** Banco no esquema do TFTAcademy com as linhas `rows` (`{dt, round, feature, key, data}`). */
function makeDb(rows) {
  const file = path.join(tmp, `db-${++counter}.db`),
    db = new DatabaseSync(file);
  db.exec(SCHEMA);
  db.prepare(
    "INSERT INTO games (id, started_at, set_number, queue_type, created_at, match_id) VALUES (?,?,?,?,?,?)",
  ).run(GAME.id, BASE, 18, 1100, BASE, GAME.matchId);
  const ins = db.prepare(
    "INSERT INTO events (game_id, timestamp, event_type, round, key, data, created_at, feature, category) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  for (const r of rows)
    ins.run(
      GAME.id,
      BASE + r.dt,
      r.feature,
      r.round ?? "0-0",
      r.key,
      r.data,
      BASE + r.dt,
      r.feature,
      r.feature,
    );
  db.close();
  return file;
}
const status = (file, dt) =>
  gepReader({
    file,
    now: () => (BASE + dt) * 1000,
    champions,
    items,
    minIntervalMs: 0,
  }).status(ctx);
const seenAt = (file, dt) =>
  mergeGep(gameFilesState({ available: false }), status(file, dt));
const cells = (board) =>
  board.map((u) => [u.cell, u.id, u.stars, u.row, u.col]);

test("casa do GEP → linha/coluna: cell_1..7 é a linha de trás (row 3), cell_22..28 a da frente (row 0); col 0..6", () => {
  assert.equal(BOARD_ROWS * BOARD_COLS, 28);
  assert.deepEqual(boardCell(1), { row: 3, col: 0 });
  assert.deepEqual(boardCell(7), { row: 3, col: 6 });
  assert.deepEqual(boardCell(8), { row: 2, col: 0 });
  assert.deepEqual(boardCell(15), { row: 1, col: 0 });
  assert.deepEqual(boardCell(22), { row: 0, col: 0 });
  assert.deepEqual(boardCell(26), { row: 0, col: 4 });
  assert.deepEqual(boardCell("28"), { row: 0, col: 6 });
  // As 28 casas são distintas e cobrem a grade inteira.
  const all = new Set(
    Array.from({ length: 28 }, (_, i) => {
      const c = boardCell(i + 1);
      return `${c.row}:${c.col}`;
    }),
  );
  assert.equal(all.size, 28);
  for (const bad of [0, 29, -1, "x", null, 1.5])
    assert.equal(boardCell(bad), null);
});

test("parseBoard: payload real de 5-3 com itens; nome e item fora do catálogo ficam nomeados, nunca somem", () => {
  const late = parseBoard(fixture.late.data, isChampion, isItem);
  assert.equal(late.unknown, 0);
  assert.ok(late.units.length >= 8);
  const kayle = late.units.find((u) => u.cell === 1);
  assert.deepEqual(
    {
      id: kayle.id,
      stars: kayle.stars,
      items: kayle.items,
      row: kayle.row,
      col: kayle.col,
      source: kayle.source,
    },
    {
      id: "DA_18_Kayle",
      stars: 2,
      items: ["DA_JeweledGauntlet", "DA_RedBuff"],
      row: 3,
      col: 0,
      source: "gep",
    },
  );
  for (const u of late.units) {
    assert.ok(champions.has(u.id), u.text);
    assert.deepEqual(u.unknownItems, []);
    assert.deepEqual(boardCell(u.cell), { row: u.row, col: u.col });
  }
  const odd = parseBoard(
    '{"cell_3":{"name":"DA_18_Zzz","level":"2","item_1":"DA_Item_Inexistente","item_2":"","item_3":""},"cell_30":{"name":"DA_18_Rakan","level":"9"},"slot_1":{"name":"DA_18_Rakan"}}',
    isChampion,
    isItem,
  );
  assert.equal(odd.unknown, 1);
  assert.deepEqual(odd.units, [
    {
      id: null,
      text: "DA_18_Zzz",
      stars: 2,
      items: [],
      unknownItems: ["DA_Item_Inexistente"],
      cell: 3,
      row: 3,
      col: 2,
      source: "gep",
    },
    {
      id: "DA_18_Rakan",
      text: "DA_18_Rakan",
      stars: null,
      items: [],
      unknownItems: [],
      cell: 30,
      row: null,
      col: null,
      source: "gep",
    },
  ]);
  assert.deepEqual(parseBoard("{}"), { units: [], unknown: 0 });
  for (const bad of ["", "[]", "nada", null])
    assert.equal(parseBoard(bad), null);
});

test("leitor: gepBoard com a casa de cada peça; peça que sai do tabuleiro para a reserva some do tabuleiro", () => {
  const [before, bench, after] = fixture.move;
  // Só o tabuleiro de antes: Sejuani na linha da frente (cell_26 → row 0, col 4).
  const first = seenAt(makeDb([before]), before.dt + 1);
  assert.equal(first.gepStatus.state, "ativo");
  assert.equal(first.sources.board, "gep");
  assert.equal(first.sourcesDetail.board.source, "gep");
  assert.equal(first.sourcesDetail.board.confidence, "observed");
  assert.equal(typeof first.sourcesDetail.board.ageMs, "number");
  assert.equal(first.noSource.board, undefined);
  assert.deepEqual(cells(first.gepBoard), [
    [1, "DA_18_Caitlyn", 3, 3, 0],
    [22, "DA_Vi18", 1, 0, 0],
    [23, "DA_Amumu18", 1, 0, 1],
    [25, "DA_18_Rakan", 1, 0, 3],
    [26, "DA_18_Sejuani", 1, 0, 4],
    [27, "DA_Scuttlecrab18", 2, 0, 5],
  ]);
  assert.deepEqual(first.gepBoard[0].items, [
    "DA_KrakensFury",
    "DA_LastWhisper",
    "DA_Deathblade",
  ]);
  // Depois do movimento (reserva e tabuleiro no mesmo segundo): Sejuani na reserva, a casa 26 livre.
  const moved = seenAt(makeDb([before, bench, after]), after.dt + 1);
  assert.deepEqual(
    moved.gepBoard.map((u) => u.cell),
    [1, 22, 23, 25, 27],
  );
  assert.equal(
    moved.gepBoard.some((u) => u.id === "DA_18_Sejuani"),
    false,
  );
  assert.equal(
    moved.gepBench.filter((u) => u.id === "DA_18_Sejuani").length,
    2,
  );
  assert.equal(moved.sources.bench, "gep");
  assert.equal(moved.sources.board, "gep");
});

test("ausência: sem GEP fresco ou sem evento de tabuleiro, o tabuleiro é desconhecido com motivo, nunca vazio", () => {
  const [before] = fixture.move;
  const file = makeDb([before]);
  // Obsoleto (sem eventos há mais de 60 s).
  const stale = seenAt(file, before.dt + 600);
  assert.equal(stale.gepStatus.state, "obsoleto");
  assert.equal(stale.gepBoard, null);
  assert.equal(stale.sources.board, null);
  assert.equal(stale.noSource.board, "sem-eventos-recentes");
  // Banco ausente.
  const absent = seenAt(path.join(tmp, "nao-existe.db"), 0);
  assert.equal(absent.gepBoard, null);
  assert.equal(absent.sources.board, null);
  assert.equal(absent.noSource.board, "banco-ausente");
  // GEP desligado no servidor.
  const off = mergeGep(gameFilesState({ available: false }), null);
  assert.equal(off.gepBoard, null);
  assert.equal(off.noSource.board, "desligada");
  // GEP ativo, mas nenhum evento de tabuleiro ainda (só a reserva).
  const waiting = seenAt(makeDb([fixture.move[1]]), fixture.move[1].dt + 1);
  assert.equal(waiting.gepStatus.state, "ativo");
  assert.equal(waiting.gepBoard, null);
  assert.equal(waiting.sources.board, null);
  assert.equal(waiting.noSource.board, "aguardando-gep");
  // Tabuleiro vazio observado (`{}`, começo da partida) é um valor: [] e sem motivo.
  const empty = seenAt(
    makeDb([
      {
        dt: 0,
        round: "1-2",
        feature: "board",
        key: "board_pieces",
        data: "{}",
      },
    ]),
    1,
  );
  assert.deepEqual(empty.gepBoard, []);
  assert.equal(empty.sources.board, "gep");
  assert.equal(empty.noSource.board, undefined);
});

test("rivais nunca: `opponent_board_pieces` (e chaves de outros) não mudam o tabuleiro lido", () => {
  const [before] = fixture.move;
  const rival = (dt, feature, key, data) => ({
    dt,
    round: "4-1",
    feature,
    key,
    data,
  });
  const file = makeDb([
    before,
    rival(
      before.dt + 1,
      "board",
      "opponent_board_pieces",
      '{"cell_1":{"name":"DA_18_Varus","level":"3","item_1":"","item_2":"","item_3":""}}',
    ),
    rival(
      before.dt + 1,
      "match_info",
      "board_spectate",
      '{"cell_2":{"name":"DA_18_Varus","level":"3"}}',
    ),
    rival(before.dt + 1, "match_stats", "board_players", "[]"),
  ]);
  const seen = seenAt(file, before.dt + 2);
  assert.equal(
    seen.gepBoard.some((u) => u.id === "DA_18_Varus"),
    false,
  );
  assert.deepEqual(
    seen.gepBoard,
    seenAt(makeDb([before]), before.dt + 2).gepBoard,
  );
});

test("arquitetura: a lista de chaves lidas (KEYS) tem o tabuleiro próprio e nenhuma chave de rival", () => {
  const src = fs.readFileSync(
    new URL("../gep-reader.mjs", import.meta.url),
    "utf8",
  );
  const block = /const KEYS = new Map\(\[([\s\S]*?)\]\);/.exec(src)?.[1];
  assert.ok(block, "bloco KEYS encontrado");
  const pairs = [...block.matchAll(/\["([\w.]+)",\s*"\w+"\]/g)].map(
    (m) => m[1],
  );
  assert.ok(pairs.includes("board.board_pieces"));
  for (const k of pairs)
    assert.doesNotMatch(
      k,
      /opponent|battle_stats|round_outcome|match_stats|board_spectate|board_players|player_rank|health/,
      k,
    );
  const fallback = /const FALLBACK_KEYS = \{([\s\S]*?)\};/.exec(src)?.[1];
  assert.ok(fallback);
  assert.doesNotMatch(fallback, /opponent|board_spectate|board_players/);
});
