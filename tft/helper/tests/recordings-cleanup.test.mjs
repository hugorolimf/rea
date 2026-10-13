// Limpeza das gravações do TFTAcademy (app/recordings-cleanup.mjs): ficam as 2 mais recentes pela data de início no nome;
// arquivo com outro nome nunca é apagado.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recordingsCleanup,
  recordingsToDelete,
} from "../app/recordings-cleanup.mjs";

const rec = (id, stamp, mtimeMs = 0, ext = "mp4") => ({
  name: `${id}-${stamp}.${ext}`,
  mtimeMs,
  size: 100,
});
const A = "0cb8f502-d8eb-492e-b005-22cee3beace0",
  B = "1d25a8ff-7d5b-4984-a02e-863b1c4e2fad",
  C = "d1afb2b1-e286-4e84-9562-350fa213a34b";

test("ficam as 2 gravações de início mais recente; arquivos irmãos da mesma partida saem juntos", () => {
  const files = [
    rec(A, "2026-10-11-23-06-41"),
    rec(A, "2026-10-11-23-06-41", 0, "json"),
    rec(C, "2026-10-12-00-22-24"),
    rec(B, "2026-10-11-23-47-04"),
    { name: "notas.txt", mtimeMs: 0, size: 1 },
  ];
  assert.deepEqual(
    recordingsToDelete(files, 2).map((f) => f.name),
    [`${A}-2026-10-11-23-06-41.mp4`, `${A}-2026-10-11-23-06-41.json`],
  );
  assert.deepEqual(recordingsToDelete(files.slice(2), 2), []);
});

test("varredura apaga as antigas na pasta e deixa o que não é gravação", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-cleanup-"));
  try {
    for (const f of [
      rec(A, "2026-10-11-23-06-41"),
      rec(B, "2026-10-11-23-47-04"),
      rec(C, "2026-10-12-00-22-24"),
      { name: "outro.mp4" },
    ])
      fs.writeFileSync(path.join(dir, f.name), "x");
    const logs = [];
    const out = await recordingsCleanup({
      dir,
      log: (level, text) => logs.push([level, text]),
    }).sweep();
    assert.equal(out.removed, 1);
    assert.deepEqual(fs.readdirSync(dir).sort(), [
      `${B}-2026-10-11-23-47-04.mp4`,
      `${C}-2026-10-12-00-22-24.mp4`,
      "outro.mp4",
    ]);
    assert.equal(logs[0][0], "INFO");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sem a pasta, a varredura não faz nada", async () => {
  const out = await recordingsCleanup({
    dir: path.join(os.tmpdir(), "nao-existe-rec-cleanup"),
  }).sweep();
  assert.equal(out, null);
});
