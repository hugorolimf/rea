// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// Gabaritos de glifo do leitor de tela (screen-glyphs.json) e a montagem deles (scripts/lib/glyph-train.mjs): o arquivo tem os
// conjuntos e caracteres que o leitor precisa, e o treino recusa glifo desconhecido, descarta rótulo errado e alinha o texto
// esperado aos glifos do quadro.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GRID,
  buildLibrary,
  classify,
  clean,
  evaluate,
  samplesOf,
  toDocument,
} from "../scripts/lib/glyph-train.mjs";

const N = GRID[0] * GRID[1],
  doc = JSON.parse(
    fs.readFileSync(
      fileURLToPath(new URL("../screen-glyphs.json", import.meta.url)),
      "utf8",
    ),
  );

/** Vetor sintético de glifo: uma coluna acesa no lugar `at` (0..11) mais um ruído pequeno e determinístico. */
const vec = (at, noise = 0) => {
  const v = new Float64Array(N);
  for (let r = 0; r < GRID[1]; r++) v[r * GRID[0] + at] = 1;
  if (noise)
    for (let i = 0; i < N; i++)
      v[i] = Math.min(1, Math.max(0, v[i] + noise * Math.sin(i * 12.9898)));
  return v;
};
const b64 = (v) =>
  Buffer.from(Uint8Array.from(v, (x) => Math.round(x * 255))).toString(
    "base64",
  );

test("screen-glyphs.json: grade 12x16, cada gabarito com 192 bytes, e os caracteres que o leitor lê", () => {
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.grid, GRID);
  for (const [set, chars] of Object.entries(doc.sets))
    for (const [ch, list] of Object.entries(chars)) {
      assert.equal(ch.length, 1, `${set}: caractere "${ch}"`);
      assert.ok(
        list.length >= 1 && list.length <= 5,
        `${set}:${ch} com ${list.length} gabaritos`,
      );
      for (const t of list)
        assert.equal(Buffer.from(t, "base64").length, N, `${set}:${ch}`);
    }
  const has = (set, chars) =>
    chars.split("").filter((c) => !doc.sets[set]?.[c]);
  assert.deepEqual(has("gold", "0123456789"), [], "ouro: todos os dígitos");
  // XP: o 7 e o 9 não aparecem nas partidas gravadas (o XP sobe de 2 em 2 e de 4 em 4, e o total do nível é par): sem gabarito, o
  // leitor devolve '?' nesses dígitos em vez de adivinhar (limite documentado em FONTES-DE-DADOS.md).
  assert.deepEqual(has("xp", "01234568/"), [], "XP: dígitos vistos e a barra");
  assert.deepEqual(has("stage", "1234567"), [], "estágio e rodada: 1 a 7");
  assert.deepEqual(
    has("level", "2345678"),
    [],
    "nível: ao menos os vistos nas partidas gravadas (2 a 8)",
  );
  assert.ok(
    Object.keys(doc.sets.badge ?? {}).length >= 2,
    "selo de quantidade do removedor",
  );
});

test("classificação: o caractere mais próximo vale; glifo longe de todos ou empatado vira '?'", () => {
  const lib = buildLibrary([
    ...[0.001, 0.002, 0.003].map((n) => ({
      set: "gold",
      ch: "1",
      v: vec(2, n),
    })),
    ...[0.001, 0.002, 0.003].map((n) => ({
      set: "gold",
      ch: "7",
      v: vec(9, n),
    })),
  ]);
  assert.equal(classify(lib, "gold", vec(2, 0.002)).ch, "1");
  assert.equal(classify(lib, "gold", vec(9, 0.002)).ch, "7");
  // Uma coluna no meio (5): longe dos dois (o leitor devolve '?' em vez de arriscar um dígito).
  assert.equal(classify(lib, "gold", vec(5)).ch, "?");
  // Conjunto sem gabaritos: nada é lido.
  assert.equal(classify(lib, "xp", vec(2)).ch, "?");
  const out = evaluate(lib, [
    { set: "gold", ch: "1", v: vec(2) },
    { set: "gold", ch: "7", v: vec(5) },
    { set: "gold", ch: "1", v: vec(9) },
  ]);
  assert.deepEqual(
    {
      n: out.gold.n,
      hit: out.gold.hit,
      miss: out.gold.miss,
      wrong: out.gold.wrong,
    },
    { n: 3, hit: 1, miss: 1, wrong: 1 },
  );
});

test("amostras: o texto esperado alinha com os glifos do limiar que bate a contagem; hífen e proporção absurda ficam de fora", () => {
  const part = (ch, v, w = 5, h = 9) => ({ ch, w, h, v: v ? b64(v) : null });
  const read = {
    glyphs: {
      // No limiar 100 o 0 saiu partido em dois pedaços (3 glifos para "10"); no 80 saiu inteiro.
      xp: {
        s100: [part("?", vec(1), 1), part("?", vec(3)), part("?", vec(3))],
        s80: [part("?", vec(1), 1), part("?", vec(3))],
      },
      stage: {
        s100: [part("?", vec(4)), part("-", null, 4, 2), part("?", vec(6))],
      },
      gold: { s100: [part("?", vec(2), 20, 9), part("?", vec(3))] },
    },
  };
  const samples = samplesOf(read, { xp: "10", stage: "3-5", gold: 49 });
  assert.deepEqual(
    samples.map((s) => `${s.set}:${s.ch}`),
    ["xp:1", "xp:0", "stage:3", "stage:5"],
    "o ouro tem um glifo largo demais para ser dígito: sem amostras",
  );
  // Sem verdade ou sem glifos do campo: nenhuma amostra.
  assert.deepEqual(samplesOf({ glyphs: {} }, { gold: 12 }), []);
  assert.deepEqual(samplesOf(read, {}), []);
});

test("limpeza: com 2+ partidas, o rótulo que contradiz o gabarito das outras sai (GEP e tela divergem às vezes)", () => {
  const good = (ch, at) =>
    [0.001, 0.002, 0.003, 0.004].map((n) => ({
      set: "stage",
      ch,
      v: vec(at, n),
    }));
  const byGame = {
    a: [...good("2", 3), ...good("3", 8)],
    // Na partida b o GEP estava uma rodada atrás: glifos que são "3" vieram rotulados "2".
    b: [...good("2", 3), ...good("3", 8).map((s) => ({ ...s, ch: "2" }))],
  };
  const { samples, dropped } = clean(byGame);
  assert.equal(dropped, 4);
  assert.equal(samples.length, 12);
  // Uma partida só: nada a comparar, tudo fica.
  assert.equal(clean({ a: byGame.a }).dropped, 0);
});

test("documento: toDocument serializa a biblioteca como o leitor carrega (base64 de bytes 0..255)", () => {
  const lib = buildLibrary([{ set: "level", ch: "5", v: vec(4) }]);
  const out = toDocument(lib, { games: ["x"] });
  assert.deepEqual(out.grid, GRID);
  assert.equal(Buffer.from(out.sets.level["5"][0], "base64").length, N);
  assert.deepEqual(out.meta, { games: ["x"] });
});
