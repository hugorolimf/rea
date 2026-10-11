// ARQUIVO HISTÓRICO (fora da suíte: os globs de teste não entram em .old/). Casos de tests/gep-reader.test.mjs que só
// existiam para a leitura de tela como reserva do GEP: com o GEP obsoleto/ausente, ou sem a identidade local, ou com a
// loja escondida, o valor lido da tela continuava valendo. Copiados como estavam em 2026-10-11, antes da remoção; usam
// `mergeSources` (game-log.mjs), que não existe mais (hoje é `gameFilesState`, sem a tela). Ver .old/ocr/README.md.
// No sistema atual esses casos ficam desconhecidos explícitos (tests/gep-reader.test.mjs e tests/no-screen.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mergeGep } from "../../../gep-reader.mjs";
import { mergeSources } from "../../../game-log.mjs";
// (`activeGep`, `reader`, `at`, `LAST_DT`, `ctx` e `tmp` eram auxiliares de tests/gep-reader.test.mjs.)

const screenSeen = () =>
  mergeSources(
    {
      running: true,
      error: null,
      window: true,
      stage: "2-1",
      gold: 7,
      level: 5,
      xp: "4/20",
      stale: { gold: false, level: false, xp: false, stage: false },
      items: ["DA_Component_BFSword"],
      bank: ["DA_Component_BFSword"],
      unknownItems: 1,
      shop: [{ text: "Algo", id: "DA_18_Elise" }, null, null, null, null],
      removers: 0,
    },
    { available: true, stage: "1-3", phase: "Planning", phaseKind: "planning" },
  );

test("fallback: GEP obsoleto, ausente ou com esquema novo deixa a tela como está, sem erro", () => {
  const base = screenSeen();
  const { file } = activeGep();
  const stale = reader(file, { t: at(LAST_DT + 600) }).status(ctx);
  const merged = mergeGep(base, stale);
  assert.equal(merged.gold, 7);
  assert.equal(merged.level, 5);
  assert.equal(merged.sources.gold, "screen");
  assert.equal(merged.sources.level, "screen");
  assert.equal(merged.gepStatus.state, "obsoleto");
  assert.equal(merged.gepBench, undefined);
  const absent = mergeGep(
    base,
    reader(path.join(tmp, "x.db"), { t: 0 }).status(ctx),
  );
  assert.deepEqual(
    [absent.gold, absent.gepStatus.state, absent.gepStatus.reason],
    [7, "ausente", "banco-ausente"],
  );
  assert.equal(mergeGep(base, null).gepStatus.reason, "desligada");
  assert.equal(mergeGep(base, undefined).gold, 7);
});

test("fallback por campo: sem a identidade confirmada o banco de itens fica com a tela; loja escondida não troca a da tela", () => {
  const { file } = activeGep();
  const gep = reader(file, { t: at(LAST_DT + 3) }).status({
    ...ctx,
    local: { name: "Outra", tag: "Z" },
  });
  const seen = mergeGep(screenSeen(), gep);
  assert.equal(seen.gold, 0, "ouro vem do GEP");
  assert.deepEqual(
    seen.items,
    ["DA_Component_BFSword"],
    "itens ficam com a tela",
  );
  assert.equal(seen.sources.items, "screen");
  // Loja escondida segundo o GEP.
  const hidden = structuredClone(activeGep().gep);
  hidden.fields.shop.visible = false;
  const s2 = mergeGep(screenSeen(), hidden);
  assert.equal(s2.shop[0].id, "DA_18_Elise");
  assert.equal(s2.sources.shop, "screen");
});
