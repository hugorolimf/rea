// Livro-razão de unidades. Fixtures: linhas reais de compra/estrela do TFT.log (partidas 3291596434 e 3291600904, Set 18,
// 2026-10-10) e o tabuleiro final do jogador (match-history) + retratos do TFTEoGStats.json (ledger-truth.json).
// A partida 3291600904 teve queda de vídeo e reconexão: duas execuções do jogo, ids de entidade recomeçam.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gameLog, parseLogLine } from "../game-log.mjs";
import {
  BENCH_CAPACITY,
  LEDGER_VALIDATION,
  applyUnitEvent,
  buildLedger,
  copies,
  emptyLedger,
  ledgerStatus,
  reconcileLedger,
} from "../unit-ledger.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const text = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const truth = JSON.parse(text("ledger-truth.json"));
const unitEvents = (name) =>
  text(name)
    .split(/\r?\n/)
    .map(parseLogLine)
    .filter((e) => e && (e.type === "purchase" || e.type === "starUp"));
const row = (rec, id) => rec.champions.find((c) => c.id === id);

test("cópias: fusão é neutra (3 cópias de 1★ = 1 de 2★; 3 de 2★ = 1 de 3★)", () => {
  assert.deepEqual([1, 2, 3, 4].map(copies), [1, 3, 9, 27]);
  assert.equal(copies(undefined), 1);
});

test("entidade repetida (voz bloqueada que acompanha a tocada) não conta duas vezes", () => {
  const ledger = emptyLedger();
  const buy = { type: "purchase", id: "DA_Vi18", actor: "2147434691" };
  applyUnitEvent(ledger, buy);
  applyUnitEvent(ledger, { ...buy, blocked: true });
  applyUnitEvent(ledger, {
    type: "purchase",
    id: "DA_18_Diana",
    actor: "2147434627",
    blocked: true,
  });
  assert.equal(ledger.purchases, 2);
  // O mesmo número de entidade em outra execução do jogo é outra peça.
  applyUnitEvent(ledger, buy, 1);
  assert.equal(ledger.purchases, 3);
});

test("subida de estrela de entidade sem compra registrada vira cópia 'sem compra' (carrossel, prêmio, antes da leitura)", () => {
  const ledger = emptyLedger();
  applyUnitEvent(ledger, {
    type: "starUp",
    id: "DA_18_Teemo",
    actor: "9",
    star: 2,
  });
  assert.deepEqual(
    [ledger.unseenActors, ledger.unseen.get("DA_18_Teemo"), ledger.fusions],
    [1, 1, 1],
  );
  // A mesma entidade subindo para 3★ já é conhecida: não cria nova origem.
  applyUnitEvent(ledger, {
    type: "starUp",
    id: "DA_18_Teemo",
    actor: "9",
    star: 3,
  });
  assert.equal(ledger.unseen.get("DA_18_Teemo"), 1);
  // Entidade desconhecida direto em 3★: era uma peça de 2★ (3 cópias).
  applyUnitEvent(ledger, {
    type: "starUp",
    id: "DA_18_Zyra",
    actor: "10",
    star: 3,
  });
  assert.equal(ledger.unseen.get("DA_18_Zyra"), 3);
});

test("partida real 3291596434: o adquirido fecha com o tabuleiro final onde não houve venda, e acusa o resto", () => {
  const ledger = buildLedger([{ events: unitEvents("game-3291596434.log") }]);
  assert.deepEqual(
    [ledger.purchases, ledger.fusions, ledger.unseenActors],
    [43, 13, 3],
  );
  const rec = reconcileLedger(ledger, truth["3291596434"].finalBoard);
  // 9 Rengar comprados = Rengar 3★ em campo; 3 Rammus/3 Yunara = 2★ em campo.
  for (const [id, acquired, board] of [
    ["DA_18_Rengar", 9, 9],
    ["DA_18_Rammus", 3, 3],
    ["DA_18_Yunara", 3, 3],
  ]) {
    assert.deepEqual(
      [
        row(rec, id).acquired,
        row(rec, id).board,
        row(rec, id).surplus,
        row(rec, id).deficit,
      ],
      [acquired, board, 0, 0],
      id,
    );
  }
  // Uma cópia a mais de Leona: reserva ou vendida, o log não distingue.
  assert.deepEqual(
    [
      row(rec, "DA_18_Leona").acquired,
      row(rec, "DA_18_Leona").board,
      row(rec, "DA_18_Leona").surplus,
    ],
    [4, 3, 1],
  );
  // Ezreal 2★ em campo (3 cópias) com duas compras: a terceira veio de fora do log.
  assert.equal(row(rec, "DA_18_Ezreal").deficit, 1);
  assert.equal(rec.boardExplained, false);
  // Peças compradas que nem estão em campo (Teemo, Azir, Caitlyn...): só podem estar na reserva ou ter sido vendidas.
  assert.deepEqual(
    [row(rec, "DA_18_Teemo").acquired, row(rec, "DA_18_Teemo").board],
    [2, 0],
  );
  assert.deepEqual(
    [rec.acquiredTotal, rec.boardTotal, rec.surplusTotal, rec.deficitTotal],
    [46, 31, 16, 1],
  );
});

test("a sobra passa da capacidade da reserva: houve venda, e a reserva não é reconstruível", () => {
  const ledger = buildLedger([{ events: unitEvents("game-3291596434.log") }]);
  const status = ledgerStatus(ledger, truth["3291596434"].finalBoard);
  assert.equal(status.reconciliation.surplusTotal > BENCH_CAPACITY, true);
  assert.equal(status.reconciliation.soldAtLeast, 7);
  assert.deepEqual(
    [
      status.bench.reconstructable,
      status.bench.reliability,
      status.bench.upperBound,
    ],
    [false, "estimated", 16],
  );
  assert.equal(status.purchases.reliability, "observed");
  assert.equal(status.reconciliation.reliability, "derived");
  assert.equal(status.validation, LEDGER_VALIDATION);
  assert.equal(LEDGER_VALIDATION.benchReconstructable, false);
});

test("partida real com queda e reconexão (duas execuções): ids recomeçam e o adquirido soma as duas", () => {
  const runs = [
    { events: unitEvents("game-3291600904-run1.log") },
    { events: unitEvents("game-3291600904-run2.log") },
  ];
  const rec = reconcileLedger(
    buildLedger(runs),
    truth["3291600904"].finalBoard,
  );
  assert.deepEqual(
    [rec.acquiredTotal, rec.boardTotal, rec.surplusTotal, rec.deficitTotal],
    [34, 17, 17, 0],
  );
  assert.equal(
    rec.boardExplained,
    true,
    "todo o tabuleiro final tem compra correspondente",
  );
  assert.deepEqual(
    [row(rec, "DA_18_Hecarim").acquired, row(rec, "DA_18_Ezreal").acquired],
    [1, 1],
  );
  assert.deepEqual(
    [row(rec, "DA_18_Alistar").acquired, row(rec, "DA_18_Alistar").board],
    [5, 3],
  );
  // Sem somar a execução anterior, o tabuleiro final deixa de ser explicado: é o que acontece se o servidor só viu a segunda.
  const onlySecond = reconcileLedger(
    buildLedger(runs.slice(1)),
    truth["3291600904"].finalBoard,
  );
  assert.equal(onlySecond.boardExplained, false);
});

test("validação em retratos reais do tabuleiro: o adquirido nunca fica abaixo do tabuleiro em peças compradas depois do início", () => {
  // Retratos de 3291596434 a partir do minuto 5: tudo o que está em campo foi comprado (ou veio de uma subida citada).
  const events = unitEvents("game-3291596434.log");
  let covered = 0,
    total = 0;
  for (const snap of truth["3291596434"].snapshots) {
    const at = Date.parse(snap.at) + 1000;
    const upTo = buildLedger([
      { events: events.filter((e) => Date.parse(e.at) <= at) },
    ]);
    const rec = reconcileLedger(upTo, snap.board);
    total++;
    if (rec.boardExplained) covered++;
    // Em nenhum retrato a sobra é a reserva: ela pode ser maior que a capacidade (vendas) mas nunca negativa.
    assert.ok(rec.surplusTotal >= 0);
  }
  // Nem todo retrato é explicado: peças de carrossel/prêmio não têm compra. Fica registrado, não escondido.
  assert.ok(covered < total, "o livro-razão não explica todo o tabuleiro");
  assert.ok(covered > 0);
});

function tmpTft() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tft-ledger-"));
  fs.mkdirSync(path.join(dir, ".sentry-native", "abc.run"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "Saved", "Logs"), { recursive: true });
  return {
    dir,
    eventFile: path.join(dir, ".sentry-native", "abc.run", "__sentry-event"),
    logFile: path.join(dir, "Saved", "Logs", "TFT.log"),
  };
}
// MessagePack mínimo do __sentry-event com game.id (fixstr/str8 como o jogo grava).
const sentry = (gameId) => {
  const str = (s) =>
    Buffer.concat([Buffer.from([0xa0 | s.length]), Buffer.from(s)]);
  return Buffer.concat([
    str("game.id"),
    Buffer.from([0xa0 | gameId.length]),
    Buffer.from(gameId),
  ]);
};

test("leitor: o livro-razão liga as execuções à partida pelo arquivo de contexto e soma a reconexão", () => {
  const t = tmpTft();
  try {
    const run1 = text("game-3291600904-run1.log"),
      run2 = text("game-3291600904-run2.log");
    fs.writeFileSync(t.eventFile, sentry("3291600904"));
    fs.writeFileSync(t.logFile, run1);
    const g = gameLog({ dir: t.dir, minIntervalMs: 0 });
    const board = truth["3291600904"].finalBoard;
    // Antes da primeira leitura nada foi lido.
    assert.equal(g.ledger("3291600904", board).available, false);
    g.status("3291600904");
    let ledger = g.ledger("3291600904", board);
    assert.equal(ledger.available, true);
    assert.equal(ledger.runs, 1);
    assert.equal(ledger.purchases.count, 17, "execução 1: 17 compras");
    // Queda e reconexão: o jogo recomeça com BeginGame no mesmo arquivo de contexto (mesma partida).
    fs.appendFileSync(t.logFile, run2);
    g.status("3291600904");
    ledger = g.ledger("3291600904", board);
    assert.equal(ledger.runs, 2);
    assert.deepEqual(
      [
        ledger.reconciliation.acquiredTotal,
        ledger.reconciliation.surplusTotal,
        ledger.reconciliation.boardExplained,
      ],
      [34, 17, true],
    );
    assert.equal(ledger.bench.reconstructable, false);
    // Outra partida: o livro-razão dela está vazio (nunca mistura partidas).
    assert.equal(g.ledger("111", board).available, false);
    // O tabuleiro vem do TFTEoGStats.json, não do log: sem ele a sobra é tudo o que foi adquirido.
    assert.equal(g.ledger("3291600904", []).reconciliation.surplusTotal, 34);
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test("leitor: execução cujo início é anterior ao arquivo de contexto (outra partida) não é ligada", () => {
  const t = tmpTft();
  try {
    fs.writeFileSync(t.logFile, text("game-3291600904-run1.log"));
    fs.writeFileSync(t.eventFile, sentry("3291600904"));
    // Contexto regravado antes do BeginGame do log (relógio do arquivo no passado): pertence à partida anterior.
    const past = new Date("2026-10-10T10:00:00Z");
    fs.utimesSync(t.eventFile, past, past);
    const g = gameLog({ dir: t.dir, minIntervalMs: 0 });
    g.status("3291600904");
    assert.equal(g.ledger("3291600904", []).available, false);
  } finally {
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});
