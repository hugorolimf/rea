import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
export function captureBoards(file, history) {
  const subscribers = new Set();
  let current = null,
    stamp = null,
    hash = null,
    busy = false,
    queued = false,
    previous = new Map(),
    records = new Map(),
    sequence = 0,
    lastError = null;
  async function scan() {
    if (busy) {
      queued = true;
      return;
    }
    busy = true;
    try {
      const stat = await fs.stat(file);
      if (stamp === stat.mtimeMs) return;
      const raw = await fs.readFile(file, "utf8");
      const d = JSON.parse(raw);
      if (!Array.isArray(d.statsBlock?.players))
        throw Error("Snapshot sem jogadores");
      const digest = crypto.createHash("sha256").update(raw).digest("hex");
      stamp = stat.mtimeMs;
      if (digest === hash) return;
      hash = digest;
      const changed = [];
      if (current?.gameId !== d.gameId) {
        previous = new Map();
        records = new Map();
      }
      for (const p of d.statsBlock.players) {
        const id = String(p.playerId);
        const units = (p.boardPieces ?? []).map((u) => ({
          championName: u.championName,
          starLevel: u.starLevel,
          itemNames: u.itemNames,
          price: u.price,
        }));
        const signature = JSON.stringify(
          [...units].sort((a, b) =>
            a.championName.localeCompare(b.championName),
          ),
        );
        const old = records.get(id);
        const boardChanged = previous.get(id) !== signature;
        const row = {
          id,
          name: p.riotIdGameName ?? p.summonerName,
          health: p.health,
          units,
          sourceAt: stat.mtime.toISOString(),
          lastBoardChangeAt: boardChanged
            ? stat.mtime.toISOString()
            : old?.lastBoardChangeAt,
          receivedAt: new Date().toISOString(),
        };
        records.set(id, row);
        if (boardChanged) {
          changed.push(id);
          previous.set(id, signature);
          await fs.appendFile(
            history,
            JSON.stringify({ gameId: d.gameId, ...row }) + "\n",
          );
        }
      }
      current = {
        type: "boards",
        sequence: ++sequence,
        gameId: d.gameId,
        sourceAt: stat.mtime.toISOString(),
        receivedAt: new Date().toISOString(),
        changedIds: changed,
        players: [...records.values()],
        viewedPlayerId: null,
      };
      lastError = null;
      for (const res of subscribers) {
        if (res.destroyed) {
          subscribers.delete(res);
          continue;
        }
        res.write("data: " + JSON.stringify(current) + "\n\n");
      }
    } catch (e) {
      lastError = e.message;
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        void scan();
      }
    }
  }
  const watcher = watch(path.dirname(file), (event, name) => {
    if (!name || String(name) === path.basename(file)) void scan();
  });
  watcher.on("error", (e) => {
    lastError = e.message;
  });
  const timer = setInterval(() => void scan(), 500);
  void scan();
  return {
    subscribe(req, res) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 1000\n\n");
      subscribers.add(res);
      if (current) res.write("data: " + JSON.stringify(current) + "\n\n");
      const beat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
      req.on("close", () => {
        clearInterval(beat);
        subscribers.delete(res);
      });
    },
    status() {
      return {
        sequence,
        sourceAt: current?.sourceAt ?? null,
        lastError,
        intervalMs: 500,
        viewedPlayerKnown: false,
      };
    },
    close() {
      watcher.close();
      clearInterval(timer);
      for (const res of subscribers) res.end();
    },
  };
}
