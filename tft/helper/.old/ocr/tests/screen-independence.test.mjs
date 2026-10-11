// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// O helper sem o TFTAcademy/GEP: o leitor de tela (com um processo falso no lugar do PowerShell) alimenta o montador de estado
// sozinho, cada campo diz que veio da tela, e o chip da interface avisa que a tela assumiu. Cobre também a troca GEP -> tela.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { screenReader } from "../screen-reader.mjs";
import { createStateHub } from "../app/state.mjs";
import { buildModel } from "../v2/js/model.js";

const SETTLE = 10,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  LEONA = "DA_18_Leona";

async function until(check) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await wait(5);
  }
  assert.fail("condição não atingida");
}

/** Leitor real ligado a um processo falso; devolve `send(linha)` com o que o screen-reader.ps1 emitiria. */
async function rig(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "indep-")),
    root = path.join(dir, "helper");
  await mkdir(root);
  await mkdir(path.join(dir, "data"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const procs = [],
    reader = screenReader(root, [], [{ id: LEONA, names: ["Leona"] }], [], {
      settleMs: SETTLE,
      launch() {
        const proc = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(),
          stderr: new PassThrough(),
          kill() {},
        });
        procs.push(proc);
        return proc;
      },
    });
  t.after(() => reader.stop());
  reader.sync(true);
  await until(() => procs.length);
  return {
    reader,
    send: (event) =>
      procs[0].stdout.write(`${JSON.stringify({ window: true, ...event })}\n`),
  };
}

const HUD = {
  gold: 52,
  level: 5,
  xp: "10/20",
  stage: "3-2",
  shop: ["Leona", "", "", "", ""],
  items: ["DA_Component_ChainVest", "DA_Component_TearOfTheGoddess"],
  unknownItems: 0,
  removers: 0,
};

const gep = (gold) => ({
  available: true,
  state: "ativo",
  fields: {
    gold: { value: gold, ageMs: 40 },
    level: { value: 5, ageMs: 40 },
    xp: { value: "10/20", ageMs: 40 },
    stage: null,
    shop: null,
    items: null,
    bench: null,
  },
});

test("sem GEP: ouro, nível, XP, estágio, loja e banco vêm da tela, cada um com a fonte 'screen'", async (t) => {
  const { reader, send } = await rig(t);
  send(HUD);
  await until(() => reader.status().items);
  const hub = createStateHub({
    screen: reader,
    gameFiles: { status: () => ({ available: false, stage: null }) },
    gep: {
      status: () => ({
        available: false,
        state: "ausente",
        reason: "banco-ausente",
      }),
    },
  });
  const seen = hub.seen("g1", {});
  assert.equal(seen.gold, 52);
  assert.equal(seen.level, 5);
  assert.equal(seen.xp, "10/20");
  assert.equal(seen.stage, "3-2");
  assert.deepEqual(seen.shop, [
    { text: "Leona", id: LEONA },
    null,
    null,
    null,
    null,
  ]);
  assert.deepEqual(seen.items, [
    "DA_Component_ChainVest",
    "DA_Component_TearOfTheGoddess",
  ]);
  for (const field of ["gold", "level", "xp", "stage", "shop", "items"])
    assert.equal(seen.sources[field], "screen", field);
  // A reserva só existe no GEP: sem ele, desconhecida (nunca uma lista vazia inventada).
  assert.equal(seen.sources.bench, null);
  const state = hub.gameState(seen, "g1");
  assert.equal(state.me.gold.source, "screen");
  assert.equal(state.me.gold.confidence, "read");
  assert.equal(state.me.bench.value, null);
  // O chip da interface diz que a tela assumiu e o que ela lê.
  const { status } = buildModel({
    state: { screen: seen, gepStatus: seen.gepStatus },
    rec: null,
  });
  assert.equal(status.gep.short, "GEP off · tela");
  assert.match(status.gep.label, /Lendo da tela: ouro, nível, XP, loja, itens/);
});

test("GEP ativo vence a tela; quando o GEP some a tela assume na hora e o chip muda", async (t) => {
  const { reader, send } = await rig(t);
  send({ ...HUD, gold: 50 });
  await until(() => reader.status().gold === 50);
  let current = gep(55);
  const hub = createStateHub({
    screen: reader,
    gameFiles: { status: () => ({ available: false, stage: null }) },
    gep: { status: () => current },
    readings: 1,
  });
  const withGep = hub.seen("g1", {});
  assert.equal(withGep.gold, 55);
  assert.equal(withGep.sources.gold, "gep");
  const chipOn = buildModel({
    state: { screen: withGep, gepStatus: withGep.gepStatus },
    rec: null,
  }).status.gep;
  assert.match(chipOn.short, /^GEP ativo/);
  current = {
    available: false,
    state: "obsoleto",
    reason: "sem-eventos-recentes",
  };
  const without = hub.seen("g1", {});
  assert.equal(without.gold, 50, "a tela assume na mesma leitura");
  assert.equal(without.sources.gold, "screen");
  const chipOff = buildModel({
    state: { screen: without, gepStatus: without.gepStatus },
    rec: null,
  }).status.gep;
  assert.equal(chipOff.short, "GEP parado · tela");
});
