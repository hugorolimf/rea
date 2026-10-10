// Rodar com: node --test tft/helper/tests/*.test.mjs
// Leitor de tela com um processo falso no lugar do PowerShell: as linhas JSON que o script emitiria entram
// pelo stdout e o que a interface recebe sai de status().
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { screenReader } from "../screen-reader.mjs";

const SETTLE = 20;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await wait(5);
  }
  assert.fail("condição não atingida");
}

/** Liga o leitor a um processo falso; devolve `send(evento)` para emitir uma linha do script. */
async function start(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reader-")),
    root = path.join(dir, "helper");
  await mkdir(root);
  await mkdir(path.join(dir, "data"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const procs = [];
  const reader = screenReader(root, [], [], [], {
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
      procs[0].stdout.write(JSON.stringify({ window: true, ...event }) + "\n"),
  };
}

const COMPONENT = "DA_Component_BFSword",
  GLOVES = "DA_Component_SparringGloves",
  REMOVER = "DA_Consumable_ItemRemover",
  DUPLICATOR = "DA_Consumable_ChampionDuplicator",
  BOOSTER = "DA_AttackBooster18";

test("itens repetidos continuam repetidos e consumíveis aparecem no banco sem entrar na análise", async (t) => {
  const { reader, send } = await start(t);
  send({
    items: [
      COMPONENT,
      COMPONENT,
      GLOVES,
      REMOVER,
      DUPLICATOR,
      BOOSTER,
      COMPONENT,
    ],
    unknownItems: 0,
    removers: 1,
  });
  await until(() => reader.status().bank);
  const status = reader.status();
  assert.deepEqual(status.bank, [
    COMPONENT,
    COMPONENT,
    GLOVES,
    REMOVER,
    DUPLICATOR,
    BOOSTER,
    COMPONENT,
  ]);
  assert.deepEqual(status.items, [COMPONENT, COMPONENT, GLOVES, COMPONENT]);
  assert.equal(status.removers, 1);
});

test("espaços não reconhecidos não apagam os reconhecidos, mesmo passando de OBSCURED_SLOTS", async (t) => {
  const { reader, send } = await start(t);
  send({ items: [COMPONENT, GLOVES], unknownItems: 7, removers: 0 });
  // Cobertura passageira: o prazo é maior que o do banco normal.
  await wait(SETTLE * 1.5);
  assert.equal(reader.status().items, null);
  await until(() => reader.status().items);
  const status = reader.status();
  assert.deepEqual(status.items, [COMPONENT, GLOVES]);
  assert.equal(status.unknownItems, 7);
});

test("leitura que muda e volta antes do prazo não troca o banco", async (t) => {
  const { reader, send } = await start(t);
  send({ items: [COMPONENT], unknownItems: 0, removers: 0 });
  await until(() => reader.status().items);
  send({ items: [], unknownItems: 9, removers: 0 });
  await wait(SETTLE / 4);
  send({ items: [COMPONENT], unknownItems: 0, removers: 0 });
  await wait(SETTLE * 3);
  const status = reader.status();
  assert.deepEqual(status.bank, [COMPONENT]);
  assert.equal(status.unknownItems, 0);
});

test("bankDebug e bankGeometry chegam ao status por espaço (números do script em texto), sem esperar o debounce", async (t) => {
  const { reader, send } = await start(t);
  send({
    items: [COMPONENT],
    unknownItems: 1,
    removers: 0,
    bankDebug: [
      {
        slot: 0,
        value: COMPONENT,
        best: COMPONENT,
        d1: "0.323",
        d2: "0.836",
        mean: 44,
        spread: 22,
        kept: false,
      },
      {
        slot: 1,
        value: "?",
        best: "DA_Artifact_Manazane",
        d1: "0.704",
        d2: "0.756",
        mean: 27,
        spread: 9,
        kept: false,
      },
      {
        slot: 2,
        value: "",
        best: null,
        d1: null,
        d2: null,
        mean: 11,
        spread: 0,
        kept: false,
      },
      { nada: true },
    ],
    bankGeo: {
      mode: "frame",
      x: 95,
      ncc: "0.915",
      contrast: "0.627",
      client: "0,0,2560,1351",
    },
  });
  await until(() => reader.status().bankDebug);
  const status = reader.status();
  // O diagnóstico é a leitura de agora: aparece antes de o banco passar pelo debounce.
  assert.equal(status.bank, null);
  assert.deepEqual(status.bankDebug[1], {
    slot: 1,
    value: "?",
    best: "DA_Artifact_Manazane",
    d1: 0.704,
    d2: 0.756,
    mean: 27,
    spread: 9,
    kept: false,
  });
  assert.equal(status.bankDebug.length, 3);
  assert.deepEqual(status.bankGeometry, {
    mode: "frame",
    x: 95,
    ncc: 0.915,
    contrast: 0.627,
    client: "0,0,2560,1351",
  });
  // Janela fechada ou leitor parado: sem diagnóstico velho.
  reader.sync(false);
  assert.equal(reader.status().bankDebug, null);
  assert.equal(reader.status().bankGeometry, null);
});

test("janela do jogo fechada não mostra banco", async (t) => {
  const { reader, send } = await start(t);
  send({ items: [COMPONENT], unknownItems: 0, removers: 0 });
  await until(() => reader.status().items);
  send({ window: false });
  await until(() => reader.status().window === false);
  assert.equal(reader.status().items, null);
  assert.equal(reader.status().bank, null);
});

test("nível: o número lido vale e o total do XP o confirma; sem o número, o XP diz o nível", async (t) => {
  const { reader, send } = await start(t);
  send({ level: 6, xp: "24/36" });
  await until(() => reader.status().level === 6);
  assert.equal(reader.status().levelSource, "ocr+xp");
  // O número some (animação): o total do XP mantém o nível e a origem passa a "xp".
  send({ level: null, xp: "30/36" });
  await until(() => reader.status().levelSource === "xp");
  assert.equal(reader.status().level, 6);
  // Subiu: o total novo (56) é do nível 7.
  send({ level: null, xp: "2/56" });
  await until(() => reader.status().level === 7);
});

test("nível: empate de total 68 (8 ou 9) usa o último nível e a queda do XP", async (t) => {
  const { reader, send } = await start(t);
  send({ level: 8, xp: "60/68" });
  await until(() => reader.status().level === 8);
  send({ level: null, xp: "62/68" });
  await until(() => reader.status().xp === "62/68");
  assert.equal(reader.status().level, 8);
  send({ level: null, xp: "4/68" });
  await until(() => reader.status().level === 9);
  assert.equal(reader.status().levelAmbiguous, true);
});

test("nível: dígito errado do OCR que contradiz o XP e o nível anterior não derruba o nível", async (t) => {
  const { reader, send } = await start(t);
  send({ level: 6, xp: "24/36" });
  await until(() => reader.status().level === 6);
  send({ level: 1, xp: "25/36" });
  await until(() => reader.status().xp === "25/36");
  const status = reader.status();
  assert.equal(status.level, 6);
  assert.equal(status.levelSource, "xp");
  assert.equal(status.levelConflict, true);
});

test("nível: leitura do número sem XP vale (XP coberto), e partida nova zera tudo", async (t) => {
  const { reader, send } = await start(t);
  send({ level: 7, xp: null });
  await until(() => reader.status().level === 7);
  assert.equal(reader.status().levelSource, "ocr");
  reader.sync(false);
  assert.equal(reader.status().level, null);
  assert.equal(reader.status().levelSource, null);
});
