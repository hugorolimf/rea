import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const logs = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "TFT",
  "Saved",
  "Logs",
);
const boardFile = path.join(logs, "TFTEoGStats.json");
const logFile = path.join(logs, "TFT.log");
const output = path.join(root, "data");
fs.mkdirSync(output, { recursive: true });
const history = path.join(output, "events.jsonl");
const stateFile = path.join(output, "state.json");
const ids = new Set();
if (fs.existsSync(history)) {
  for (const line of fs
    .readFileSync(history, "utf8")
    .split("\n")
    .filter(Boolean)) {
    try {
      ids.add(JSON.parse(line).id);
    } catch {
      /* Preserve existing incomplete history. */
    }
  }
}
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
function record(event) {
  const id = digest(JSON.stringify(event));
  if (ids.has(id)) return;
  fs.appendFileSync(
    history,
    JSON.stringify({ id, observedAt: new Date().toISOString(), ...event }) +
      "\n",
  );
  ids.add(id);
}
let previousBoardHash = null;
if (fs.existsSync(stateFile)) {
  try {
    previousBoardHash =
      JSON.parse(fs.readFileSync(stateFile, "utf8")).board?.source?.sha256 ??
      null;
  } catch {}
}
let previousLogHash = null;
function poll() {
  const state = {
    readAt: new Date().toISOString(),
    board: null,
    shop: {
      status: "unknown",
      slots: null,
      reason:
        "No complete shop-slot source is established. Purchase audio references do not identify all offers.",
    },
    limitations: [
      "Positions and bench are absent.",
      "Snapshot cadence and current-session correspondence are not automatically verified.",
    ],
    errors: [],
  };
  try {
    const raw = fs.readFileSync(boardFile, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.statsBlock?.players))
      throw new Error("Missing statsBlock.players array");
    const hash = digest(raw);
    state.board = {
      source: {
        path: boardFile,
        modifiedAt: fs.statSync(boardFile).mtime.toISOString(),
        sha256: hash,
      },
      gameId: data.gameId,
      queueId: data.queueId,
      queueType: data.queueType,
      gameLengthSeconds: data.statsBlock.gameLengthSeconds,
      players: data.statsBlock.players.map((p, index) => ({
        index,
        playerId: p.playerId,
        name: p.riotIdGameName ?? p.summonerName ?? null,
        health: p.health,
        reportedPlacement: p.ffaStanding,
        pieces: p.boardPieces,
        positions: null,
        bench: null,
      })),
    };
    if (hash !== previousBoardHash) {
      record({ kind: "board_snapshot", ...state.board });
      previousBoardHash = hash;
      console.log(`Board snapshot: ${state.board.source.modifiedAt}`);
    }
  } catch (error) {
    state.errors.push({ source: boardFile, message: error.message });
  }
  try {
    const text = fs.readFileSync(logFile, "utf8");
    const hash = digest(text);
    if (hash !== previousLogHash) {
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const event = line.match(
          /Audio\.Event\.VO\.Unit\.(Purchase|StarUp\.[A-Za-z0-9.]+)/,
        );
        const actor = line.match(/Actor\[(TFTCharacter_\d+)\s*\{([^}]+)\}\]/);
        if (!event || !actor) continue;
        record({
          kind: "unit_audio_event",
          source: { path: logFile, line: index + 1 },
          producerTimestamp: line.match(/^\[([^\]]+)\]/)?.[1] ?? null,
          event: event[1],
          actorId: actor[1],
          championId: actor[2],
          audioBlocked: line.includes("was blocked"),
          rawLine: line,
          meaning:
            "Audio-subsystem reference; not a complete shop offer or independently confirmed transaction.",
        });
      }
      previousLogHash = hash;
    }
  } catch (error) {
    state.errors.push({ source: logFile, message: error.message });
  }
  fs.writeFileSync(stateFile + ".tmp", JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(stateFile + ".tmp", stateFile);
}
poll();
if (!process.argv.includes("--once")) {
  console.log(
    "Following TFT files every 2 seconds. Stop with Ctrl+C. Shop slots remain unknown.",
  );
  setInterval(poll, 2000);
}
