// ARQUIVO HISTÓRICO (fora da suíte: os globs de teste não entram em .old/). Casos de tests/level.test.mjs que só
// existiam para a leitura de tela: conciliação do número lido pelo OCR com o total do XP (`reconcileLevel`, agora em
// .old/ocr/core/state/reconcile-level.mjs), o descarte de leituras de nível inverossímeis ou velhas do HUD no
// rastreador antigo (`reduceLevel` com a origem "screen", que não existe mais) e a geometria `Hud-Rect` do
// screen-reader.ps1. Copiados como estavam em 2026-10-11, antes da remoção. Ver .old/ocr/README.md.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reconcileLevel } from "../core/state/reconcile-level.mjs";
import { levelTracker } from "../../../level.mjs";

test("número lido e total de XP que se conferem valem; sem XP, vale o número", () => {
  assert.deepEqual(reconcileLevel({ ocr: 6, xp: "24/36" }), {
    level: 6,
    source: "ocr+xp",
    conflict: false,
    ambiguous: false,
  });
  assert.equal(reconcileLevel({ ocr: 6, xp: null }).source, "ocr");
  assert.equal(
    reconcileLevel({ ocr: 6, xp: "3/7" }).source,
    "ocr",
    "total ilegível não contradiz",
  );
});

test("sem o número, o total do XP diz o nível; o empate 8/9 usa a pista e a queda do XP", () => {
  assert.equal(reconcileLevel({ xp: "24/36" }).level, 6);
  assert.equal(reconcileLevel({ xp: "60/68", held: 8 }).level, 8);
  assert.equal(
    reconcileLevel({ xp: "4/68", prevXp: "60/68", held: 8 }).level,
    9,
    "XP caiu com o mesmo total: subiu",
  );
  const tie = reconcileLevel({ xp: "10/68", held: 9 });
  assert.equal(tie.level, 9);
  assert.equal(tie.ambiguous, true);
  assert.equal(reconcileLevel({ xp: "0/2", held: 1 }).level, 1);
  assert.equal(reconcileLevel({ xp: "0/2", held: 2 }).level, 2);
});

test("dígito errado do OCR: XP de outro nível e nível retido dizem qual leitura é plausível", () => {
  // Retido 6; OCR leu 1 (nunca cai) mas o XP é do nível 6: vale o XP.
  const low = reconcileLevel({ ocr: 1, xp: "24/36", held: 6 });
  assert.equal(low.level, 6);
  assert.equal(low.source, "xp");
  assert.equal(low.conflict, true);
  // OCR leu 7 e o XP ainda é do 6: pode ser a subida acontecendo; vale o número lido, marcado em conflito.
  const up = reconcileLevel({ ocr: 7, xp: "24/36", held: 6 });
  assert.equal(up.level, 7);
  assert.equal(up.conflict, true);
  // Nada plausível: mantém o retido.
  assert.deepEqual(reconcileLevel({ ocr: 1, xp: "5/10", held: 8 }), {
    level: 8,
    source: "held",
    conflict: true,
    ambiguous: false,
  });
  // Retido velho (HUD coberto por muito tempo) não serve de régua: vale o número lido.
  assert.equal(
    reconcileLevel({ ocr: 7, xp: "24/36", held: 2, trusted: false }).level,
    7,
  );
});

const seen = (over = {}) => ({
  level: null,
  xp: null,
  stage: "4-5",
  stale: { level: false, xp: false },
  sources: { level: "screen", xp: "screen" },
  ...over,
});

test("caso real: nível 2 retido e velho no 4-5 (HUD lido fora do lugar) vira piso derivado, não 2", () => {
  const out = levelTracker().apply(
    seen({ level: 2, stale: { level: true } }),
    "g1",
  );
  assert.equal(out.level, 5);
  assert.equal(out.sources.level, "derived");
  assert.equal(out.levelInfo.minimum, true);
  assert.equal(out.levelInfo.read, 2);
  assert.equal(out.stale.level, false, "o derivado não é valor velho");
});

test("leitura fresca inverossímil é descartada, salvo se o XP a corrobora", () => {
  const t = levelTracker();
  const bad = t.apply(seen({ level: 2, xp: null }), "g1");
  assert.equal(bad.level, 5);
  assert.match(bad.levelInfo.rejected.reason, /mínimo 5/);
  // Mesmo valor corroborado pelo total do XP: a regra do jogo (XP passivo) pode estar errada, vale a leitura.
  const ok = levelTracker().apply(seen({ level: 2, xp: "1/2" }), "g1");
  assert.equal(ok.level, 2);
  assert.equal(ok.sources.level, "screen");
  assert.equal(ok.levelInfo.rejected, null);
});

test("o nível confirmado não cai; leitura abaixo dele sem corroboração é descartada", () => {
  const t = levelTracker();
  assert.equal(
    t.apply(seen({ level: 8, xp: "20/68", stage: "5-2" }), "g1").level,
    8,
  );
  const drop = t.apply(seen({ level: 6, xp: null, stage: "5-3" }), "g1");
  assert.equal(drop.level, 8);
  assert.equal(drop.sources.level, "derived");
  assert.match(drop.levelInfo.rejected.reason, /último nível confirmado \(8\)/);
});

test("leitura velha mas acima do piso continua valendo, marcada velha", () => {
  const out = levelTracker().apply(
    seen({ level: 7, stale: { level: true } }),
    "g1",
  );
  assert.equal(out.level, 7);
  assert.equal(out.sources.level, "screen");
  assert.equal(out.stale.level, true);
  assert.equal(out.levelInfo.minimum, false);
});

test("XP de outro nível não acompanha um nível derivado", () => {
  const out = levelTracker().apply(
    seen({ level: 2, xp: "1/2", stale: { level: true } }),
    "g1",
  );
  // 2 corrobora "1/2", mas está velha: piso 5, e o XP do nível 2 sai.
  assert.equal(out.level, 5);
  assert.equal(out.xp, null);
  assert.equal(out.sources.xp, null);
});

// Geometria do HUD no leitor de tela: roda a função Hud-Rect do próprio script (só no Windows com powershell.exe).
test(
  "HUD 16:9 dentro de janela mais larga fica centralizado (nível e XP dependiam disso)",
  { skip: process.platform !== "win32" },
  () => {
    const file = fileURLToPath(
        new URL("../screen-reader.ps1", import.meta.url),
      ),
      source = readFileSync(file, "utf8"),
      fn = /function Hud-Rect[\s\S]*?\n}\n/.exec(source)?.[0];
    assert.ok(fn, "função Hud-Rect existe");
    const run = (client, anchor) =>
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `${fn}\n(Hud-Rect @(${client}) '${anchor}') -join ','`,
        ],
        { encoding: "utf8" },
      ).trim();
    assert.equal(
      run("0,29,2560,1351", "bottom"),
      "79,29,2402,1351",
      "janela maximizada com barra de título",
    );
    assert.equal(
      run("0,0,2044,1149", "bottom"),
      "0,0,2044,1149",
      "16:9 não muda",
    );
    assert.equal(
      run("10,5,1600,1200", "bottom"),
      "10,305,1600,900",
      "mais alta: colado embaixo",
    );
    assert.equal(
      run("10,5,1600,1200", "top"),
      "10,5,1600,900",
      "mais alta: topo para o estágio",
    );
  },
);
