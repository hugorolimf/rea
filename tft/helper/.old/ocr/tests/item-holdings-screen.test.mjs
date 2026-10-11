// ARQUIVO HISTÓRICO (fora da suíte: os globs de teste não entram em .old/). Caso (f) de tests/item-holdings.test.mjs:
// o banco de itens lido pelo leitor de tela (processo falso no lugar do screen-reader.ps1) chegava ao motor. Copiado como
// estava em 2026-10-11, antes da remoção; dependia de screen-reader.mjs (nesta pasta) e de `mergeSources`, que não existe
// mais. No sistema atual o mesmo caminho é coberto com o banco do GEP (tests/item-holdings.test.mjs). Ver .old/ocr/README.md.
// (`run`, `base`, `row`, `carryKinds`, IE, BT, GS e `catalog` eram auxiliares de tests/item-holdings.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { recommendInventory } from "../../../item-holdings.mjs";
import { mergeSources } from "../../../game-log.mjs";
import { screenReader } from "../screen-reader.mjs";

test("(f) o banco lido da tela chega ao motor; consumíveis ficam de fora e o cliente só vale sem leitura", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "holdings-")),
    helper = path.join(dir, "helper");
  await mkdir(helper);
  await mkdir(path.join(dir, "data"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const procs = [];
  const reader = screenReader(helper, [], [], [], {
    settleMs: 20,
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
  for (let i = 0; i < 200 && !procs.length; i++)
    await new Promise((r) => setTimeout(r, 5));
  procs[0].stdout.write(
    JSON.stringify({
      window: true,
      items: [IE, "DA_Consumable_ItemRemover", BT],
      unknownItems: 0,
      removers: 1,
    }) + "\n",
  );
  for (let i = 0; i < 200 && !reader.status().items; i++)
    await new Promise((r) => setTimeout(r, 5));
  // Mesma cadeia do servidor: leitura de tela → fontes mescladas (seenState) → inventário da análise → motor.
  const seen = mergeSources(reader.status(), null),
    known = new Set(catalog.items.map((i) => i.apiName));
  assert.deepEqual(seen.items, [IE, BT]);
  assert.ok(
    seen.bank.includes("DA_Consumable_ItemRemover"),
    "o banco inteiro segue informativo",
  );
  const inventory = recommendInventory([], seen, (x) => known.has(x));
  assert.deepEqual(inventory, [IE, BT], "consumível fora de items");
  const a = run(base(), inventory);
  assert.deepEqual(carryKinds(a)[0], "bank");
  assert.ok(
    row(a).score > row(run(base(), [])).score,
    "o item lido da tela entra no score",
  );
  // Cliente com leitura antiga: a tela de agora manda. Sem leitura (null), vale o enviado. Ids desconhecidos saem.
  assert.deepEqual(
    recommendInventory([GS], seen, (x) => known.has(x)),
    [IE, BT],
  );
  assert.deepEqual(
    recommendInventory([GS], { items: null }, (x) => known.has(x)),
    [GS],
  );
  assert.deepEqual(
    recommendInventory([GS], {}, (x) => known.has(x)),
    [GS],
  );
  assert.deepEqual(
    recommendInventory([], { items: [IE, "DA_Nao_Existe"] }, (x) =>
      known.has(x),
    ),
    [IE],
  );
  assert.deepEqual(
    recommendInventory([GS], { items: [] }, (x) => known.has(x)),
    [],
    "banco lido e vazio vale vazio",
  );
});
