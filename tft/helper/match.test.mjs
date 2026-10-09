// Rodar com: node --test tft/helper/match.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchTracker, finalPlacement } from "./match.mjs";

const HERO = "47445859";
const tmp = () =>
  path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "tft-match-")),
    "history.jsonl",
  );
const until = async (check) => {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((r) => setTimeout(r, 10));
  return check();
};
const lines = (file) =>
  fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse)
    : [];
/** Snapshot no formato de TFTEoGStats.json: hero = [vida, colocação]; rivais = lista de [vida, colocação]. */
const snap = (gameId, hero, rivals = [[50, 1]], seconds = 900) => ({
  gameId,
  queueType: "RANKED_TFT",
  statsBlock: {
    setCoreName: "TFTSet18",
    gameLengthSeconds: seconds,
    players: [
      {
        playerId: Number(HERO),
        health: hero[0],
        ffaStanding: hero[1],
        boardPieces: [
          { championName: "DA_Vi18", starLevel: 2, itemNames: ["DA_Sunfire"] },
        ],
      },
      ...rivals.map(([health, ffaStanding], i) => ({
        playerId: 100 + i,
        health,
        ffaStanding,
        boardPieces: [],
      })),
    ],
  },
});
const stat = { mtime: new Date("2026-10-09T05:00:00Z") };
const client = (gameId, phase = "InProgress") => ({ gameId, phase });

test("colocação final: eliminado, vencedor e primeiro arquivo da partida", () => {
  assert.equal(finalPlacement(snap(1, [-4, 6]), HERO), 6);
  assert.equal(finalPlacement(snap(1, [20, 1], [[-3, 2]]), HERO), 1);
  assert.equal(finalPlacement(snap(1, [40, 3]), HERO), null);
  // O primeiro arquivo de cada partida traz vida e colocação -1 em todos: não é eliminação.
  assert.equal(finalPlacement(snap(1, [-1, -1], [[-1, -1]]), HERO), null);
});

test("partida nova pelo cliente: espera o tabuleiro, encerra na eliminação e registra uma vez", async () => {
  const file = tmp(),
    events = [],
    t = matchTracker(file, HERO, { onChange: (e) => events.push(e.kind) });
  // Cliente já na partida 2; o arquivo ainda é da partida 1 (anterior).
  let s = t.observe(snap(1, [30, 4]), stat, client(2));
  assert.equal(s.id, 2);
  assert.equal(s.status, "live");
  assert.equal(s.boardReady, false);
  assert.deepEqual(events, ["start"]);
  s = t.observe(snap(2, [-1, -1], [[-1, -1]]), stat, client(2));
  assert.equal(s.boardReady, true);
  assert.equal(s.status, "live");
  t.observe(snap(2, [40, 3]), stat, client(2));
  s = t.observe(snap(2, [-5, 6], [[30, 1]], 1500), stat, client(2));
  assert.equal(s.status, "ended");
  assert.equal(s.placement, 6);
  // Leituras repetidas do mesmo estado não duplicam nada.
  t.observe(snap(2, [-5, 6], [[30, 1]], 1500), stat, client(2));
  t.observe(snap(2, [-5, 6], [[30, 1]], 1500), stat, client(2, "EndOfGame"));
  assert.deepEqual(events, ["start", "end", "saved"]);
  assert.ok(await until(() => lines(file).length === 1));
  const [r] = lines(file);
  assert.equal(r.gameId, 2);
  assert.equal(r.placement, 6);
  assert.equal(r.queue, "RANKED_TFT");
  assert.equal(r.durationSeconds, 1500);
  assert.deepEqual(r.units, [
    { id: "DA_Vi18", stars: 2, items: ["DA_Sunfire"] },
  ]);
});

test("vitória: Hero único vivo fica em 1º", () => {
  const t = matchTracker(tmp(), HERO);
  t.observe(snap(3, [60, 2]), stat, client(3));
  const s = t.observe(snap(3, [12, 1], [[-8, 2]]), stat, client(3));
  assert.equal(s.status, "ended");
  assert.equal(s.placement, 1);
});

test("cliente sai da partida antes do tabuleiro final: encerra e registra quando a colocação chega", async () => {
  const file = tmp(),
    t = matchTracker(file, HERO);
  t.observe(snap(4, [40, 3]), stat, client(4));
  let s = t.observe(snap(4, [40, 3]), stat, client(4, "WaitingForStats"));
  assert.equal(s.status, "ended");
  assert.equal(s.placement, null);
  assert.equal(t.history().length, 0);
  s = t.observe(snap(4, [-2, 4]), stat, client(4, "EndOfGame"));
  assert.equal(s.placement, 4);
  assert.equal(t.history()[0].placement, 4);
  assert.ok(await until(() => lines(file).length === 1));
});

test("abrir o servidor depois da partida: registra o tabuleiro final uma única vez", async () => {
  const file = tmp();
  let s = matchTracker(file, HERO).observe(
    snap(5, [-3, 7]),
    stat,
    client(0, "Lobby"),
  );
  assert.equal(s.status, "ended");
  assert.equal(s.placement, 7);
  assert.ok(await until(() => lines(file).length === 1));
  // Reiniciar com o mesmo arquivo não abre nem grava de novo; a última partida continua visível.
  const again = matchTracker(file, HERO);
  s = again.observe(snap(5, [-3, 7]), stat, client(0, "Lobby"));
  assert.equal(s.status, "none");
  assert.equal(s.last.gameId, 5);
  assert.equal(again.history().length, 1);
});

test("tabuleiro antigo sem colocação final, com o cliente fora de partida, não abre nada", () => {
  const s = matchTracker(tmp(), HERO).observe(
    snap(6, [40, 3]),
    stat,
    client(0, "Lobby"),
  );
  assert.equal(s.status, "none");
});

test("sem cliente (LCU indisponível): o tabuleiro sozinho inicia e encerra", () => {
  const t = matchTracker(tmp(), HERO);
  let s = t.observe(snap(7, [-1, -1], [[-1, -1]]), stat, null);
  assert.equal(s.status, "live");
  s = t.observe(snap(7, [-9, 5]), stat, null);
  assert.equal(s.placement, 5);
  // A partida seguinte reinicia o estado.
  s = t.observe(snap(8, [-1, -1], [[-1, -1]]), stat, null);
  assert.equal(s.id, 8);
  assert.equal(s.status, "live");
  assert.equal(s.placement, null);
});

test("partidas sem o Hero (tutorial/desafio) não entram no histórico", () => {
  const t = matchTracker(tmp(), HERO),
    other = snap(9, [-1, 1]);
  other.statsBlock.players.shift();
  t.observe(other, stat, client(9));
  t.observe(other, stat, client(0, "Lobby"));
  assert.equal(t.history().length, 0);
});
