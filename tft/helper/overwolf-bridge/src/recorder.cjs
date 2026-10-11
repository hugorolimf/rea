"use strict";
// Grava os eventos ja filtrados num SQLite proprio, no MESMO esquema que o gep-reader.mjs do helper le (tabelas `events`,
// `games` e `settings`). O helper nao muda para ler esta fonte: ela so aparece como outro arquivo, com precedencia sobre o
// banco do TFTAcademy. `timestamp`/`created_at`/`started_at` sao segundos (epoca Unix), como no banco original.
const fs = require("node:fs");
const path = require("node:path");
const { sanitize } = require("./sanitize.cjs");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  game_version TEXT,
  set_number REAL,
  player_puuid TEXT,
  final_placement INTEGER,
  queue_type INTEGER,
  created_at INTEGER NOT NULL,
  match_id TEXT
);
CREATE INDEX IF NOT EXISTS games_started_at_idx ON games (started_at);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  player_id TEXT,
  round TEXT,
  stage_type TEXT,
  key TEXT,
  data TEXT,
  created_at INTEGER NOT NULL,
  feature TEXT,
  category TEXT
);
CREATE INDEX IF NOT EXISTS events_game_timestamp_idx ON events (game_id, timestamp);
CREATE INDEX IF NOT EXISTS events_round_idx ON events (game_id, round);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/** Eventos que abrem uma partida nova mesmo depois de uma encerrada. */
const START_KEYS = new Set(["match_start"]);
const isStart = (rec) =>
  START_KEYS.has(rec.key) ||
  (rec.key === "match_state" && rec.value?.in_progress === true) ||
  (rec.key === "round_type" &&
    /^1-[1-2]$/.test(String(rec.value?.stage ?? "")));
const isEnd = (rec) =>
  rec.key === "match_end" ||
  (rec.key === "match_state" && rec.value?.in_progress === false);

/** `-GameId=123 -PlatformID=BR1` da linha de comando do processo do jogo -> "BR1_123" (o formato que o helper compara). */
function matchIdFromCommandLine(commandLine) {
  if (typeof commandLine !== "string") return null;
  const id = /-GameId=(\d+)/i.exec(commandLine)?.[1];
  const platform = /-PlatformID=([A-Za-z0-9]+)/i.exec(commandLine)?.[1];
  return id && platform ? `${platform.toUpperCase()}_${id}` : null;
}

function loadSqlite() {
  try {
    return require("node:sqlite");
  } catch {
    return null;
  }
}

/**
 * Cria o gravador. `file` = caminho do SQLite proprio. `forward(record)` (opcional) recebe cada registro ja filtrado.
 * Nunca lanca por evento ruim: devolve o motivo em `handle`.
 */
function createRecorder({
  file,
  now = () => Date.now(),
  sqlite = loadSqlite(),
  forward = null,
  randomId = () => require("node:crypto").randomUUID(),
}) {
  if (!sqlite?.DatabaseSync)
    throw new Error("node:sqlite indisponivel neste runtime");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  const sec = () => Math.floor(now() / 1000);
  // A ponte sempre grava: o gep-reader usa `record_games` so para explicar a falta de eventos.
  db.prepare("DELETE FROM settings WHERE key = 'record_games'").run();
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('record_games', 'true', ?)",
  ).run(sec());
  const insertGame = db.prepare(
    "INSERT INTO games (id, started_at, created_at, match_id) VALUES (?, ?, ?, ?)",
  );
  const endGameStmt = db.prepare(
    "UPDATE games SET ended_at = ? WHERE id = ? AND ended_at IS NULL",
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (game_id, timestamp, event_type, round, key, data, created_at, feature, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let detected = null; // { matchId } do `game-detected`
  let current = null; // { id }
  let closed = false; // partida encerrada e nenhum evento de inicio visto ainda
  let identity = null;
  let pendingItemBench = null; // ultimo item_bench cru que chegou antes da identidade (so em memoria)
  let round = "0-0";
  const counters = {
    persisted: 0,
    dropped: 0,
    droppedByReason: {},
    games: 0,
    lastEventAt: null,
  };

  const drop = (reason) => {
    counters.dropped++;
    counters.droppedByReason[reason] =
      (counters.droppedByReason[reason] ?? 0) + 1;
    return { stored: false, reason };
  };

  function openGame() {
    const id = randomId();
    insertGame.run(id, sec(), sec(), detected?.matchId ?? null);
    current = { id };
    closed = false;
    counters.games++;
    round = "0-0";
  }

  function closeGame() {
    if (current) endGameStmt.run(sec(), current.id);
    current = null;
    closed = true;
    identity = null;
    pendingItemBench = null;
  }

  function persist(rec) {
    if (isEnd(rec) && !current) return drop("fim-sem-partida");
    if (!current) {
      if (closed && !isStart(rec)) return drop("partida-encerrada");
      openGame();
    } else if (closed) {
      closed = false;
    }
    if (rec.key === "round_type" && typeof rec.value?.stage === "string")
      round = rec.value.stage;
    insertEvent.run(
      current.id,
      sec(),
      rec.category ?? rec.feature ?? "info_update",
      round,
      rec.key,
      JSON.stringify(rec.value ?? null),
      sec(),
      rec.feature,
      rec.category,
    );
    counters.persisted++;
    counters.lastEventAt = now();
    if (forward) {
      try {
        forward({ gameId: current.id, round, ...rec });
      } catch {
        /* o encaminhamento nunca derruba a gravacao */
      }
    }
    if (isEnd(rec)) closeGame();
    return { stored: true };
  }

  return {
    /** `game-detected`: guarda so o id da partida (pela linha de comando do processo) para ligar ao LCU/arquivos do jogo. */
    gameDetected(gameInfo) {
      detected = { matchId: matchIdFromCommandLine(gameInfo?.commandLine) };
      closed = false;
    },
    /** `game-exit`: encerra a partida em curso. */
    gameExit() {
      closeGame();
      closed = false;
      detected = null;
    },
    /** Uma mensagem do GEP. Devolve `{stored, reason?}`. */
    handle(kind, info) {
      const s = sanitize(kind, info, identity);
      if (s.drop) return drop(s.drop);
      if (s.pending) {
        pendingItemBench = s.raw;
        return { stored: false, reason: "aguardando-identidade" };
      }
      let result = persist(s.record);
      if (s.identity) {
        const changed =
          !identity ||
          identity.name !== s.identity.name ||
          identity.tag !== s.identity.tag;
        identity = s.identity;
        if (changed && pendingItemBench) {
          const raw = pendingItemBench;
          pendingItemBench = null;
          const again = sanitize("info", raw, identity);
          if (again.record) persist(again.record);
        }
      }
      return result;
    },
    counters: () => ({
      ...counters,
      droppedByReason: { ...counters.droppedByReason },
    }),
    hasGame: () => current !== null,
    close() {
      try {
        db.close();
      } catch {
        /* ja fechado */
      }
    },
  };
}

module.exports = { createRecorder, matchIdFromCommandLine, SCHEMA };
