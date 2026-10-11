import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { gameRows } from "./replay.mjs";

// Assinatura do tabuleiro independente da ordem das peças (a mesma para o arquivo do jogo e o histórico gravado).
const signatureOf = (units) =>
  JSON.stringify(
    units
      .map((u) => ({
        championName: u.championName,
        starLevel: u.starLevel,
        itemNames: u.itemNames,
        price: u.price,
      }))
      .sort((a, b) =>
        String(a.championName).localeCompare(String(b.championName)),
      ),
  );

export function captureBoards(file, history) {
  const subscribers = new Set();
  let current = null,
    stamp = null,
    hash = null,
    sent = null, // digest do último evento enviado (pode estar à frente de `hash` se a gravação falhou)
    busy = false,
    queued = false,
    previous = new Map(),
    fallen = new Set(), // ids cuja eliminação (vida ≤ 0) já foi gravada
    records = new Map(),
    sequence = 0,
    lastError = null;
  function send(event) {
    const line = "data: " + JSON.stringify(event) + "\n\n";
    for (const res of subscribers) {
      if (res.destroyed) {
        subscribers.delete(res);
        continue;
      }
      try {
        res.write(line);
      } catch {
        subscribers.delete(res); // conexão SSE quebrada: sai da lista, o servidor segue
      }
    }
  }
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
      if (digest === hash) {
        stamp = stat.mtimeMs;
        return;
      }
      const changed = [],
        lines = [],
        nextSigs = new Map(),
        nextFallen = [],
        since = new Map();
      if (current?.gameId !== d.gameId) {
        records = new Map();
        // Reinício no meio da partida: parte do último tabuleiro já gravado de cada jogador, para não regravá-lo.
        previous = new Map();
        fallen = new Set();
        for (const r of await gameRows(history, d.gameId)) {
          previous.set(String(r.id), signatureOf(r.units ?? []));
          since.set(String(r.id), r.lastBoardChangeAt);
          if ((r.health ?? 1) <= 0) fallen.add(String(r.id));
        }
      }
      for (const p of d.statsBlock.players) {
        const id = String(p.playerId);
        const units = (p.boardPieces ?? []).map((u) => ({
          championName: u.championName,
          starLevel: u.starLevel,
          itemNames: u.itemNames,
          price: u.price,
        }));
        const signature = signatureOf(units);
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
            : (old?.lastBoardChangeAt ?? since.get(id)),
          receivedAt: new Date().toISOString(),
        };
        records.set(id, row);
        // A eliminação também vira linha (mesmo tabuleiro): replay e pool-tracker leem a vida da última.
        const died = (p.health ?? 1) <= 0 && !fallen.has(id);
        if (boardChanged) {
          changed.push(id);
          nextSigs.set(id, signature);
        }
        if (died) nextFallen.push(id);
        if (boardChanged || died)
          lines.push(JSON.stringify({ gameId: d.gameId, ...row }) + "\n");
      }
      // A tela recebe o evento antes da gravação: uma falha no disco não a deixa sem os tabuleiros.
      // Nas novas tentativas de gravar o mesmo arquivo, o evento não é reenviado.
      if (digest !== sent) {
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
        sent = digest;
        send(current);
      }
      if (lines.length) {
        await fs.mkdir(path.dirname(history), { recursive: true });
        await fs.appendFile(history, lines.join(""));
      }
      // Só confirma depois de gravar: se falhar, o próximo tick relê o mesmo arquivo e regrava as linhas.
      for (const [id, signature] of nextSigs) previous.set(id, signature);
      for (const id of nextFallen) fallen.add(id);
      stamp = stat.mtimeMs;
      hash = digest;
      lastError = null;
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
      const beat = setInterval(() => {
        try {
          res.write(": heartbeat\n\n");
        } catch {
          res.destroy();
        }
      }, 15000);
      const gone = () => {
        clearInterval(beat);
        subscribers.delete(res);
      };
      req.on("close", gone);
      res.on("error", gone);
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
    /** Envia um evento próprio (com `type`) aos mesmos assinantes do SSE dos tabuleiros. */
    broadcast(event) {
      send(event);
    },
    close() {
      watcher.close();
      clearInterval(timer);
      for (const res of subscribers) res.end();
    },
  };
}
