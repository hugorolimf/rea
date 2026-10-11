// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// Reconhecimento do banco de itens do leitor de tela (screen-reader.ps1) sobre uma coluna REAL do banco, recortada da
// calibração (2044x1149, jogo escurecido pela escolha de aprimoramento): roda a própria classificação do script
// (Classify-Slot e os tipos C#), só no Windows com powershell.exe. Sem OCR e sem captura: só pixels de um arquivo.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { benchCandidates } from "../bench-candidates.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)),
  script = path.join(root, "screen-reader.ps1"),
  column = path.join(root, "tests/fixtures/item-bank-column-dimmed.png"),
  harness = path.join(root, "tests/fixtures/classify-bank.ps1");

/** Classifica a coluna com o código do próprio script, em cada brilho de `dims`: [{dim, slots, same, cross, sameIcon}]. */
function classify(candidates, dims) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bank-")),
    candFile = path.join(dir, "cands.json"),
    out = path.join(dir, "out.json");
  try {
    writeFileSync(candFile, JSON.stringify(candidates));
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        harness,
        "-Script",
        script,
        "-ColumnFile",
        column,
        "-Candidates",
        candFile,
        "-Out",
        out,
        "-Dims",
        dims.join(","),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const catalog = JSON.parse(
    readFileSync(path.join(root, "catalog.json"), "utf8"),
  ),
  manifest = JSON.parse(
    readFileSync(path.join(root, "assets-manifest.json"), "utf8"),
  ),
  candidates = benchCandidates(catalog, manifest, root),
  win = process.platform === "win32",
  runs = win ? classify(candidates, [1, 0.7, 1.4]) : [];
const at = (dim) => runs.find((r) => r.dim === dim);

test(
  "banco real escurecido: removedor empilhado e Cinturão do Gigante reconhecidos, vazios são vazios, o resto é '?'",
  { skip: !win },
  () => {
    const slots = at(1).slots;
    assert.equal(slots[0].value, "DA_Consumable_ItemRemover", slots[0].debug);
    assert.equal(slots[2].value, "DA_Component_GiantsBelt", slots[2].debug);
    // Ícone fora do catálogo: continua não reconhecido (não vira outro item).
    assert.equal(slots[1].value, "?", slots[1].debug);
    // Espaço vazio sobre cenário que clareia para baixo (média 15 > 14 na antiga regra) não é item desconhecido.
    for (let i = 3; i < 10; i++)
      assert.equal(slots[i].value, "", `slot ${i}: ${slots[i].debug}`);
  },
);

test(
  "o mesmo banco com brilho diferente (menos ou mais claro) dá o mesmo resultado",
  { skip: !win },
  () => {
    const base = at(1).slots.map((s) => s.value);
    for (const dim of [0.7, 1.4])
      assert.deepEqual(
        at(dim).slots.map((s) => s.value),
        base,
        `brilho x${dim}`,
      );
  },
);

test(
  "o mesmo ícone com outro brilho continua o mesmo (memória do espaço); itens diferentes não",
  { skip: !win },
  () => {
    for (const dim of [0.7, 1.4]) {
      const { same, cross, sameIcon } = at(dim);
      assert.ok(
        same.every((d) => d <= sameIcon),
        `mesmo ícone, brilho x${dim}: ${same.map((d) => d.toFixed(2))} (limite ${sameIcon})`,
      );
      assert.ok(
        cross.every((d) => d > sameIcon),
        `ícones diferentes: ${cross.map((d) => d.toFixed(2))} (limite ${sameIcon})`,
      );
    }
  },
);

test("candidatos do banco: todo item do catálogo com ícone próprio tem candidato (ou um gêmeo de ícone idêntico); mecânicas sem ícone ficam de fora", () => {
  const files = new Set(candidates.map((c) => c.file)),
    byId = new Map(catalog.items.map((i) => [i.apiName, i]));
  for (const c of candidates)
    assert.ok(
      !/mechanicicon/.test(byId.get(c.id).icon ?? ""),
      `${c.id} usa o ícone genérico de mecânica`,
    );
  const missing = catalog.items.filter(
    (i) =>
      !i.isAugment &&
      manifest[i.apiName] &&
      !/mechanicicon/.test(i.icon ?? "") &&
      !files.has(path.join(root, manifest[i.apiName])),
  );
  assert.deepEqual(
    missing.map((i) => i.apiName),
    [],
  );
  // Cada ícone aparece uma vez: ícones idênticos zerariam a folga entre o 1º e o 2º candidato.
  assert.equal(files.size, candidates.length);
  // Os que ocupam o banco no começo da partida: componentes básicos, consumíveis e artefatos.
  for (const id of [
    "DA_Component_BFSword",
    "DA_Component_GiantsBelt",
    "DA_Consumable_ItemRemover",
    "DA_Reforger",
    "DA_Component_Spatula",
    "DA_Artifact_MogulsMail",
  ])
    assert.ok(
      candidates.some((c) => c.id === id),
      `${id} sem candidato`,
    );
});

const strip = path.join(root, "tests/fixtures/item-bank-strip-dimmed.png"),
  makeCanvas = path.join(root, "tests/fixtures/make-canvas.ps1");

/** Região de 42 px da faixa real a partir de `cropX` (14 = a coluna do banco; mais à direita = lista de sinergias ao lado). */
function classifyStrip(cropX) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bank-")),
    candFile = path.join(dir, "cands.json"),
    out = path.join(dir, "out.json");
  try {
    writeFileSync(candFile, JSON.stringify(candidates));
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        harness,
        "-Script",
        script,
        "-ColumnFile",
        strip,
        "-Candidates",
        candFile,
        "-Out",
        out,
        "-Dims",
        "1",
        "-CropX",
        String(cropX),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(readFileSync(out, "utf8"))[0].slots;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Roda o screen-reader.ps1 inteiro (-TestImage, sem OCR de tela e sem captura) sobre uma janela montada com a faixa real:
 * devolve a primeira linha JSON do leitor ({items, unknownItems, bankDebug, bankGeo, ...}), ou null sem idioma de OCR.
 */
function readWindow({ width, height, stripX, dim = 1 }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bank-")),
    candFile = path.join(dir, "cands.json"),
    image = path.join(dir, "screen.png");
  try {
    writeFileSync(candFile, JSON.stringify(candidates));
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        makeCanvas,
        "-Strip",
        strip,
        "-Out",
        image,
        "-Width",
        String(width),
        "-Height",
        String(height),
        "-StripX",
        String(stripX),
        "-Dim",
        String(dim),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        script,
        "-Candidates",
        candFile,
        "-TestImage",
        image,
        "-TestClient",
        `0,0,${width},${height}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const line = JSON.parse(out.split(/\r?\n/)[0]);
    return line.error ? null : line;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test(
  "falso positivo observado: a lista de sinergias ao lado da coluna não vira item (artefato, vestimenta de espinhos)",
  { skip: !win },
  () => {
    // Região deslocada 40 a 65 px (calibração) para a direita da coluna = onde o HUD centralizado mirava na janela larga.
    // Com os limiares antigos (0,75 / folga 0,08 / deslocamento de ±3 px) saíam BrambleVestRadiant, Hullcrusher e TitanicHydra.
    for (const cropX of [54, 69, 79]) {
      const slots = classifyStrip(cropX);
      for (const s of slots)
        assert.ok(
          s.value === "" || s.value === "?",
          `x=${cropX}: ${s.value} (${s.debug})`,
        );
    }
  },
);

test(
  "a coluna é achada pela moldura: janela 16:9, janela larga com a coluna à esquerda e com o HUD centralizado",
  { skip: !win },
  (t) => {
    const layouts = [
      { name: "16:9", width: 2044, height: 1149, stripX: 0, x: 14 },
      {
        name: "larga, coluna na borda esquerda",
        width: 2560,
        height: 1351,
        stripX: 0,
        x: 16,
      },
      {
        name: "larga, HUD centralizado (margem 79 px)",
        width: 2560,
        height: 1351,
        stripX: 79,
        x: 95,
      },
      {
        name: "larga e escurecida",
        width: 2560,
        height: 1351,
        stripX: 79,
        x: 95,
        dim: 0.7,
      },
    ];
    for (const l of layouts) {
      const read = readWindow(l);
      if (!read) return t.skip("sem idioma de OCR instalado no Windows");
      assert.equal(
        read.bankGeo.mode,
        "frame",
        `${l.name}: ${JSON.stringify(read.bankGeo)}`,
      );
      assert.ok(
        Math.abs(read.bankGeo.x - l.x) <= 2,
        `${l.name}: coluna em x=${read.bankGeo.x}, esperado ${l.x}`,
      );
      // O 2º espaço é um Duplicador de Campeão (consumível): o ícone dos três tamanhos é o mesmo, vale o candidato do catálogo.
      assert.deepEqual(
        read.items,
        [
          "DA_Consumable_ItemRemover",
          "DA_Consumable_LesserChampionDuplicator",
          "DA_Component_GiantsBelt",
        ],
        `${l.name}: ${JSON.stringify(read.bankDebug)}`,
      );
      assert.equal(read.unknownItems, 0, l.name);
      // Diagnóstico ao vivo: por espaço, o melhor candidato, a distância do 1º e a do melhor de outra família.
      assert.equal(read.bankDebug.length, 10);
      const recognized = read.bankDebug.find((s) => s.value !== "");
      assert.ok(
        recognized.best &&
          Number(recognized.d1) > 0 &&
          Number(recognized.d2) >= Number(recognized.d1),
        JSON.stringify(recognized),
      );
      assert.ok(
        read.bankDebug.every(
          (s) => typeof s.mean === "number" && typeof s.spread === "number",
        ),
      );
    }
  },
);

test(
  "sem moldura de coluna na tela (região de sinergias no lugar do banco) nada é reconhecido e a geometria sai 'assumida'",
  { skip: !win },
  (t) => {
    const read = readWindow({ width: 2044, height: 1149, stripX: -60 });
    if (!read) return t.skip("sem idioma de OCR instalado no Windows");
    assert.equal(read.bankGeo.mode, "assumed", JSON.stringify(read.bankGeo));
    assert.deepEqual(read.items, [], JSON.stringify(read.bankDebug));
  },
);

test(
  "a radiante é da família do item base nas duas grafias do id (DA_XRadiant e DA_X_Radiant)",
  { skip: !win },
  () => {
    const family = new Map(at(1).families.map((f) => [f.id, f.family])),
      pairs = candidates
        .map((c) => c.id)
        .filter(
          (id) =>
            /_?Radiant/.test(id) && family.has(id.replace(/_?Radiant/, "")),
        );
    assert.ok(
      pairs.some((id) => id.endsWith("_Radiant")),
      "há radiante com sublinhado (DA_KrakensFury_Radiant) para testar",
    );
    assert.ok(
      pairs.some((id) => /[a-z]Radiant$/.test(id)),
      "há radiante sem sublinhado (DA_BrambleVestRadiant) para testar",
    );
    for (const id of pairs)
      assert.equal(family.get(id), family.get(id.replace(/_?Radiant/, "")), id);
    // Itens diferentes continuam em famílias diferentes.
    assert.notEqual(family.get("DA_BrambleVest"), family.get("DA_KrakensFury"));
  },
);

test(
  "item e a variação radiante não se atrapalham; sem o candidato certo nada é reconhecido",
  { skip: !win },
  () => {
    const only = candidates.filter((c) => /HandOfJustice/.test(c.id));
    assert.ok(only.length >= 1, "item base presente");
    const slots = classify(only, [1])[0].slots;
    assert.ok(
      slots.slice(0, 3).every((s) => s.value === "?"),
      slots.map((s) => s.debug).join(" | "),
    );
  },
);
