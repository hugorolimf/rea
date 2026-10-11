// Rodar com: node --test tft/helper/v2/js/design-rules.test.mjs
// Catraca do design system (ver v2/DESIGN.md): cor só por token, tudo em camadas, diálogos com a base `.dlg`.
// É uma checagem de código dos arquivos de estilo e de tela, não de pixels.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const v2 = fileURLToPath(new URL("../", import.meta.url));
const cssDir = path.join(v2, "css");
const css = fs
  .readdirSync(cssDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => [
    f,
    fs
      .readFileSync(path.join(cssDir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, ""),
  ]);

test("há folhas de estilo para olhar (o teste não passa no vazio)", () => {
  assert.ok(css.length >= 15);
  assert.ok(
    css.some(([f]) => f === "tokens.css") &&
      css.some(([f]) => f === "components.css"),
  );
});

/** Cor literal: oklch/hex/rgb/hsl ou as palavras black/white (menos `white-space`). Só tokens.css pode. */
const LITERAL =
  /oklch\(|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bblack\b|\bwhite\b(?!-space)/;
/** Exceções: [arquivo, trecho da linha, motivo]. Só encolhem. */
const ALLOWED = [
  [
    "items.css",
    "--attr: light-dark(oklch(",
    "o matiz do atributo (--h) é dado do produto; a luminosidade muda por tema",
  ],
  [
    "components.css",
    "color-mix(in oklab, var(--go-fill), white",
    "clarear o fundo sólido no hover (o --go-fill é igual nos dois temas)",
  ],
];

test("nenhuma cor literal fora de tokens.css (cor por token, para os dois temas)", () => {
  const found = [];
  for (const [file, text] of css) {
    if (file === "tokens.css") continue;
    text.split("\n").forEach((line, i) => {
      if (!LITERAL.test(line)) return;
      if (ALLOWED.some(([f, snippet]) => f === file && line.includes(snippet)))
        return;
      found.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    found,
    [],
    "use `var(--token)`; fundo sólido = `--x-fill` + `--on-fill` (ver DESIGN.md §4).",
  );
});

test("toda exceção listada ainda existe (a lista só encolhe)", () => {
  for (const [file, snippet] of ALLOWED)
    assert.ok(
      css.find(([f]) => f === file)?.[1].includes(snippet),
      `${file}: exceção velha "${snippet}"`,
    );
});

test("tema claro e escuro: os tokens de texto e fundo têm par light-dark()", () => {
  const tokens = css.find(([f]) => f === "tokens.css")[1];
  for (const name of [
    "--bg",
    "--surface",
    "--text",
    "--muted",
    "--go",
    "--amber",
    "--danger",
    "--line",
    "--cost-3",
  ])
    assert.match(tokens, new RegExp(`${name}:\\s*light-dark\\(`), name);
  // Fundos sólidos são iguais nos dois temas (sem light-dark) e levam --on-fill por cima.
  assert.match(tokens, /--go-fill:\s*oklch/);
  assert.match(tokens, /--on-fill:/);
});

test("todo CSS vive em @layer (a ordem das camadas é declarada em tokens.css)", () => {
  const order = css.find(([f]) => f === "tokens.css")[1];
  assert.match(
    order,
    /@layer reset, tokens, base, layout, components, motion;/,
  );
  for (const [file, text] of css) {
    // Fora de blocos @layer só são aceitos @property e a declaração de ordem.
    let depth = 0,
      top = "";
    for (const ch of text) {
      if (ch === "{") depth++;
      if (depth === 0) top += ch;
      if (ch === "}") depth--;
    }
    const orphan = top
      .replace(/@layer\s+[\w\s,-]+;/g, "")
      .replace(/@property\s+--[\w-]+\s*/g, "")
      .replace(/@layer\s+\w+\s*/g, "")
      .trim();
    assert.equal(
      orphan,
      "",
      `${file}: regras fora de @layer: ${orphan.slice(0, 80)}`,
    );
  }
});

test("!important só onde é contrato (hidden, .sr, movimento reduzido e o padding que o mock injeta)", () => {
  // shell.css: `body { padding-bottom: 0 !important }` vence o estilo sem camada que o live-mock.js injeta no <head>.
  const allowed = new Set(["base.css", "rich.css", "shell.css"]);
  for (const [file, text] of css) {
    const n = (text.match(/!important/g) ?? []).length;
    if (n)
      assert.ok(
        allowed.has(file),
        `${file}: ${n} uso(s) de !important fora de base.css/rich.css/shell.css`,
      );
  }
});

test("todo <dialog> do app usa a base .dlg", () => {
  const html = fs.readFileSync(path.join(v2, "index.html"), "utf8");
  for (const m of html.matchAll(/<dialog\b[^>]*>/g))
    assert.match(m[0], /class="[^"]*\bdlg\b/, m[0]);
  const uiDir = path.join(v2, "js/ui");
  for (const f of fs.readdirSync(uiDir).filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(uiDir, f), "utf8");
    if (/createElement\("dialog"\)/.test(src))
      assert.match(src, /\bdlg\b/, `ui/${f}: diálogo sem a base .dlg`);
  }
});

test("movimento: animação nova respeita prefers-reduced-motion (a regra global zera as demais)", () => {
  const base = css.find(([f]) => f === "base.css")[1];
  assert.match(base, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(base, /:root\[data-motion="reduce"\]/);
});
