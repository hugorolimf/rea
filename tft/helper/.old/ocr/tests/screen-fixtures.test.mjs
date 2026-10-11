// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// Precisão do leitor de tela sobre recortes REAIS de partidas gravadas pelo TFTAcademy (tests/fixtures/screen/), com a verdade
// do GEP no instante de cada quadro. Roda o screen-reader.ps1 inteiro (-TestManifest: sem captura de tela e sem janela), só no
// Windows. Os recortes são só as regiões do HUD que o leitor usa (nada do desktop); como o vídeo é 720p/H.264 e os gabaritos de
// glifo foram montados nas mesmas partidas, os números valem como guarda de regressão do leitor (geometria, limiares, grade
// dos espaços), não como precisão em tela nativa: ver FONTES-DE-DADOS.md, "Leitor de tela próprio".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOf, rates, scoreFrame, summarize } from "../screen-accuracy.mjs";
import {
  frameEntry,
  loadCatalog,
  runReader,
} from "../scripts/lib/screen-corpus.mjs";

const dir = fileURLToPath(new URL("./fixtures/screen/", import.meta.url)),
  index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")),
  win = process.platform === "win32";

test("recortes: cada quadro tem o arquivo, a verdade e a origem, e a cobertura inclui os casos difíceis", () => {
  assert.ok(index.frames.length >= 20);
  for (const f of index.frames) {
    assert.ok(fs.existsSync(path.join(dir, f.file)), f.file);
    assert.ok(f.source.game && Number.isFinite(f.source.at), f.id);
    assert.ok(f.truth.stage || f.truth.absent, `${f.id}: sem verdade`);
    assert.equal(f.truth.bench, undefined, "a reserva não é lida da tela");
  }
  const has = (pred) => index.frames.some(pred);
  assert.ok(
    has((f) => f.truth.absent),
    "um quadro com a barra de baixo escondida (o certo é não ler)",
  );
  assert.ok(
    has((f) => f.truth.stage?.startsWith("1-")),
    "estágio 1 (rótulo em outro lugar do cabeçalho)",
  );
  assert.ok(
    has((f) => f.truth.stage?.[0] > "1"),
    "estágio 2 em diante",
  );
  assert.ok(
    has((f) => f.truth.removers > 0),
    "removedores empilhados (selo de quantidade)",
  );
  assert.ok(
    has((f) => (f.truth.items ?? []).includes("DA_Component_TearOfTheGoddess")),
    "Lágrima da Deusa: o item que a tela perdia",
  );
  assert.ok(
    has((f) => new Set(f.truth.items).size < (f.truth.items ?? []).length),
    "item repetido no banco",
  );
  assert.ok(
    has((f) => (f.truth.items ?? []).some((id) => /Emblem/.test(id))),
    "emblema",
  );
  assert.ok(
    has((f) => String(f.truth.gold).length === 1),
    "ouro de um dígito",
  );
  assert.ok(
    has((f) => String(f.truth.gold).length === 2),
    "ouro de dois dígitos",
  );
});

test(
  "leitor de tela sobre os recortes reais: ouro, nível, XP, estágio, loja e banco de itens acima dos pisos e sem falsos",
  { skip: !win },
  async () => {
    const catalog = loadCatalog(),
      lines = await runReader(
        index.frames.map((f) => frameEntry(f.id, path.join(dir, f.file))),
        { candidates: catalog.candidates },
      ),
      byId = new Map(lines.map((l) => [l.id, l])),
      scores = index.frames.map((f) =>
        scoreFrame(readOf(byId.get(f.id), catalog.champion), f.truth),
      ),
      sum = summarize(scores),
      rate = (name) => rates(sum[name]);
    const report = JSON.stringify(sum);
    // Falsos: ler outra coisa que o GEP não viu (ou ler algo quando a barra está escondida) fica em zero nos campos numéricos;
    // a loja e o banco aceitam um falso por limite de ruído do OCR e de ícone parecido.
    for (const name of ["gold", "level", "xp", "stage"])
      assert.equal(sum[name].wrong, 0, `${name}: ${report}`);
    assert.ok(sum.shop.wrong <= 1 && sum.items.wrong <= 1, report);
    // Pisos (recall) com folga sobre o medido: gold 100%, nível e XP 96%, estágio 100%, loja 97%, itens 88%, removedores 92%.
    assert.ok(rate("gold").recall >= 0.95, `ouro ${report}`);
    assert.ok(rate("level").recall >= 0.9, `nível ${report}`);
    assert.ok(rate("xp").recall >= 0.9, `XP ${report}`);
    assert.ok(rate("stage").recall >= 0.95, `estágio ${report}`);
    assert.ok(rate("shop").recall >= 0.88, `loja ${report}`);
    assert.ok(rate("items").recall >= 0.82, `itens ${report}`);
    assert.ok(
      sum.items.exact / sum.items.frames >= 0.7,
      `quadros de itens exatos ${report}`,
    );
    assert.ok(rate("removers").recall >= 0.85, `removedores ${report}`);
  },
);
