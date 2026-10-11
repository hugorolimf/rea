// Rodar com: node --test tft/helper/v2/js/comps-layout.test.mjs
// Checagem estática do CSS da aba Comps (não mede pixels): o cartão da comp tem de conter o próprio conteúdo.
// Regressão: o cartão é um `display: grid` sem colunas declaradas; a coluna implícita `auto` cresce até o min-content
// do maior filho (as grades auto-fill de 280 px do plano de itens davam ~570 px) e o `content-visibility: auto` do
// cartão recortava o excesso na borda direita (retratos, textos e o botão "Seguir esta comp" cortados).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const css = fs
  .readFileSync(
    fileURLToPath(new URL("../css/comps.css", import.meta.url)),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Lê o CSS aninhado e devolve [seletor completo, declarações próprias] de cada regra (`&` resolvido; @-regras só descem). */
function flatten(text, parents = [""]) {
  const out = [];
  let i = 0,
    head = "",
    own = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{") {
      let depth = 1,
        j = i + 1;
      while (j < text.length && depth) {
        depth += text[j] === "{" ? 1 : text[j] === "}" ? -1 : 0;
        j++;
      }
      const inner = text.slice(i + 1, j - 1),
        sel = head.trim();
      if (sel.startsWith("@")) out.push(...flatten(inner, parents));
      else {
        const own_ = sel
          .split(",")
          .map((s) => s.trim())
          .flatMap((s) =>
            parents.map((p) =>
              s.includes("&") ? s.replaceAll("&", p) : p ? `${p} ${s}` : s,
            ),
          );
        const decls = [];
        const nested = flatten(inner, own_);
        // As declarações próprias são o que sobra do corpo sem os blocos aninhados.
        let d = 0,
          buf = "";
        for (const c of inner) {
          if (c === "{") d++;
          else if (c === "}") d--;
          else if (d === 0) buf += c;
        }
        // `buf` ainda traz o seletor dos blocos aninhados: fica só o que termina em `;`.
        for (const piece of buf.split(";").slice(0, -1)) {
          const k = piece.lastIndexOf("}");
          decls.push(k >= 0 ? piece.slice(k + 1) : piece);
        }
        for (const s of own_) out.push([s, decls.join(";")]);
        out.push(...nested);
      }
      head = "";
      i = j;
      continue;
    }
    head += ch;
    own += ch;
    if (ch === ";") head = "";
    i++;
  }
  return out;
}
const rules = flatten(css);

/** Declarações da(s) regra(s) cujo seletor é exatamente `selector`. */
function rule(selector) {
  return rules
    .filter(([s]) => s.replace(/\s+/g, " ") === selector)
    .map(([, d]) => d)
    .join(";\n");
}

const ONE_COL = /grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)/;

test("o cartão e os blocos em grade dentro dele têm coluna única encolhível (minmax(0, 1fr))", () => {
  for (const sel of [
    ".comp",
    ".comp-bank",
    ".comp-actions",
    ".cp-champ",
    ".cp-wish-champ",
  ])
    assert.match(rule(sel), ONE_COL, `${sel} sem coluna minmax(0, 1fr)`);
});

test("os filhos diretos do cartão podem encolher abaixo do conteúdo (min-inline-size: 0)", () => {
  assert.match(rule(".comp > *"), /min-inline-size:\s*0/);
  assert.match(rule(".comp-bank > *"), /min-inline-size:\s*0/);
});

test("texto longo do cartão quebra linha em vez de vazar", () => {
  assert.match(rule(".comp"), /overflow-wrap:\s*(anywhere|break-word)/);
});

test("as grades auto-fill do plano de itens e a do cartão nunca passam da largura do contêiner", () => {
  for (const sel of [".comps-grid", ".cp-champs"]) {
    assert.match(
      rule(sel),
      /repeat\(auto-fill,\s*minmax\(min\(100%,\s*\d+px\),\s*1fr\)\)/,
      sel,
    );
  }
  assert.match(rule(".cp-champs"), /min-inline-size:\s*0/);
  assert.match(rule(".comps-grid"), /min-inline-size:\s*0/);
});

test("linhas flex do cartão quebram e o botão de ação ocupa a largura do cartão", () => {
  for (const sel of [
    ".comp-units",
    ".comp-stats",
    ".cb-list",
    ".cp-who",
    ".comp-traits",
  ])
    assert.match(rule(sel), /flex-wrap:\s*wrap/, `${sel} sem flex-wrap`);
  assert.match(rule(".comp-actions > .btn"), /inline-size:\s*100%/);
  assert.match(rule(".comp-actions > .btn"), /min-inline-size:\s*0/);
});

test("o resumo de 'Builds e 3★' e da lista de desejos não estoura o cartão", () => {
  const s = rule(".cp-wish summary");
  assert.match(s, /max-inline-size:\s*100%/);
  assert.doesNotMatch(s, /white-space:\s*nowrap/);
});
