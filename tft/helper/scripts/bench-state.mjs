// Custo do caminho de GET /api/state, offline: recompõe a rota com os MESMOS módulos do servidor (somente leitura)
// e mede cada parte. Não abre porta, não fala com o servidor da 3218, não inicia o leitor de tela (sem `sync`, sem
// PowerShell) e não grava nada (nem `matches.observe`, que escreve em data/). Lê os arquivos do jogo e o banco do GEP
// como o servidor faz.
//
//   node scripts/bench-state.mjs [--iterations 20] [--interval 450] [--json]
//
// `--interval` fica acima de `minIntervalMs` do leitor do jogo (400 ms) para cada iteração ler de fato; a 1ª iteração
// é a fria (o `TFT.log` inteiro é lido do início, como após reiniciar o servidor).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gameLog, mergeSources } from "../game-log.mjs";
import { gepReader, mergeGep } from "../gep-reader.mjs";
import { levelTracker } from "../level.mjs";
import { screenReader } from "../screen-reader.mjs";
import { streakTracker } from "../streak.mjs";
import { snapshotSignature } from "../analysis-keys.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  value = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? Number(args[i + 1]) : fallback;
  };
const iterations = value("iterations", 20),
  interval = value("interval", 450),
  asJson = args.includes("--json");

const HERO_ID = "47445859";
const boardPath = path.join(
  os.homedir(),
  "AppData/Local/TFT/Saved/Logs/TFTEoGStats.json",
);
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "catalog.json"), "utf8"),
);
const icons = JSON.parse(
  fs.readFileSync(path.join(root, "assets-manifest.json"), "utf8"),
);

// Mesmas composições de server.mjs (sem iniciar nada).
const screen = screenReader(
  root,
  [],
  catalog.champions.map((c) => ({ id: c.apiName, names: [c.name] })),
  [],
  {
    launch: () => {
      throw Error("bench-state não inicia o leitor de tela");
    },
  },
);
const gameFiles = gameLog(),
  levels = levelTracker(),
  streaks = streakTracker(),
  gep = gepReader({
    champions: new Set(catalog.champions.map((c) => c.apiName)),
    items: new Set(catalog.items.map((i) => i.apiName)),
  });
void icons;

/** Partida em andamento para a fonte GEP (mesma forma de `gepContext` em server.mjs). */
const gepContextFor = (metadata, hero) => ({
  gameId: metadata.gameId,
  inMatch: true,
  set: 18,
  local: hero
    ? {
        name: hero.riotIdGameName ?? hero.summonerName,
        tag: hero.riotIdTagLine,
      }
    : null,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];

for (let i = 0; i < iterations; i++) {
  const t = {},
    mark = (label, fn) => {
      const t0 = performance.now();
      const r = fn();
      t[label] = (t[label] ?? 0) + performance.now() - t0;
      return r;
    };
  const t0 = performance.now();
  // current(): fs.stat + readFile + JSON.parse + structuredClone (sem o cache por mtime: o pior caso de uma regravação).
  const stat = mark("board.stat", () => fs.statSync(boardPath));
  const raw = mark("board.read", () => fs.readFileSync(boardPath, "utf8"));
  const parsed = mark("board.parse", () => JSON.parse(raw));
  const snapshot = mark("board.clone", () => structuredClone(parsed));
  const signature = mark("board.signature", () => snapshotSignature(snapshot));
  const gameId = snapshot.gameId;
  const hero = snapshot.statsBlock.players.find(
    (p) => String(p.playerId) === HERO_ID,
  );
  // seenState(): tela + arquivos do jogo + nível + GEP.
  const screenNow = mark("screen.status", () => screen.status());
  const files = mark("gameFiles.status", () => gameFiles.status(gameId));
  const merged = mark("mergeSources", () => mergeSources(screenNow, files));
  const leveled = mark("levels.apply", () => levels.apply(merged, gameId));
  const gepNow = mark("gep.status", () =>
    gep.status(gepContextFor({ gameId, phase: "InProgress" }, hero)),
  );
  const { gepStatus, ...seen } = mark("mergeGep", () =>
    mergeGep(leveled, gepNow),
  );
  mark("streaks", () => {
    streaks.observe({ gameId, stage: seen.stage, hp: hero?.health });
    return streaks.current();
  });
  const ledger = mark("gameFiles.ledger", () =>
    gameFiles.ledger(gameId, hero?.boardPieces ?? []),
  );
  const payload = {
    gameId,
    players: snapshot.statsBlock.players.map((p) => ({
      id: String(p.playerId),
      health: p.health,
    })),
    screen: seen,
    gepStatus,
    gameFiles: files,
    unitLedger: ledger,
  };
  const bytes = mark("json", () => JSON.stringify(payload).length);
  void stat;
  void signature;
  rows.push({ total: performance.now() - t0, bytes, ...t });
  if (i < iterations - 1) await sleep(interval);
}

const q = (xs, p) =>
  [...xs].sort((a, b) => a - b)[
    Math.min(xs.length - 1, Math.floor(xs.length * p))
  ];
const warm = rows.slice(1),
  labels = Object.keys(rows[0]).filter((k) => k !== "bytes");
const summary = Object.fromEntries(
  labels.map((k) => [
    k,
    {
      cold: rows[0][k],
      p50: q(
        warm.map((r) => r[k] ?? 0),
        0.5,
      ),
      p95: q(
        warm.map((r) => r[k] ?? 0),
        0.95,
      ),
      max: Math.max(...warm.map((r) => r[k] ?? 0)),
    },
  ]),
);
const info = {
  boardBytes: fs.statSync(boardPath).size,
  tftLogBytes: (() => {
    try {
      return fs.statSync(path.join(path.dirname(boardPath), "TFT.log")).size;
    } catch {
      return null;
    }
  })(),
  payloadBytes: rows.at(-1).bytes,
  iterations,
  intervalMs: interval,
};
if (asJson) console.log(JSON.stringify({ info, summary }, null, 1));
else {
  console.log(info);
  console.log(
    "etapa".padEnd(20),
    "fria".padStart(9),
    "p50".padStart(9),
    "p95".padStart(9),
    "máx".padStart(9),
  );
  for (const [k, v] of Object.entries(summary))
    console.log(
      k.padEnd(20),
      v.cold.toFixed(2).padStart(9),
      v.p50.toFixed(2).padStart(9),
      v.p95.toFixed(2).padStart(9),
      v.max.toFixed(2).padStart(9),
    );
}
