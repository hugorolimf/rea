// Rodar com: node --test tft/helper/tests/live-snapshot.test.mjs
// Ao vivo congelado de uma partida (app/live-snapshot.mjs): grava o corpo de /api/state com o estado visto em `seen` e lê
// os arquivos da versão 1, em que o mesmo estado estava na chave antiga `screen` (de quando havia leitura de tela).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { SCHEMA, createLiveSnapshots } from "../app/live-snapshot.mjs";

const seen = { gold: 12, level: 6, stage: "3-2", sources: { gold: "gep" } };
const frame = (id) => ({
  state: {
    at: Date.UTC(2026, 9, 11),
    body: { gameId: id, match: { id }, seen },
  },
  recommendation: { body: { metadata: { gameId: id } } },
});

test("congela o estado visto em `seen` e lê o arquivo de volta no mesmo formato", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snap-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snaps = createLiveSnapshots({ dir });
  assert.equal(snaps.freeze("101", frame("101")).v, SCHEMA);
  const file = path.join(dir, "101.json.gz");
  for (let i = 0; i < 200 && !fs.existsSync(file); i++)
    await new Promise((r) => setTimeout(r, 5));
  const fromDisk = createLiveSnapshots({ dir }).read("101");
  assert.equal(fromDisk.v, SCHEMA);
  assert.deepEqual(fromDisk.state.seen, seen);
  assert.equal("screen" in fromDisk.state, false);
});

test("arquivo da versão 1 (estado em `screen`) é lido com o estado em `seen`; versão desconhecida não é lida", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-snap-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (id, data) =>
    fs.writeFileSync(
      path.join(dir, `${id}.json.gz`),
      zlib.gzipSync(JSON.stringify(data)),
    );
  write("201", {
    v: 1,
    gameId: "201",
    at: "2026-10-10T20:00:00.000Z",
    state: { gameId: "201", screen: seen },
    recommendation: { metadata: { gameId: "201" } },
  });
  write("202", {
    v: 99,
    gameId: "202",
    at: "2026-10-10T20:00:00.000Z",
    state: { gameId: "202", seen },
    recommendation: {},
  });
  const snaps = createLiveSnapshots({ dir }),
    old = snaps.read("201");
  assert.equal(old.v, SCHEMA);
  assert.deepEqual(old.state.seen, seen);
  assert.equal("screen" in old.state, false);
  assert.deepEqual(old.recommendation, { metadata: { gameId: "201" } });
  assert.equal(snaps.read("202"), null);
  assert.equal(snaps.read("203"), null);
});
