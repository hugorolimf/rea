// Rodar com: node --test tft/helper/v2/js/
// "Substituições" (no detalhe da casa da Formação): cada peça e cada alternativa aparece como retrato com o anel do custo
// (padrão `unit()` compartilhado com o resto da interface), e o nome da peça na frase de pressão vira chip de imagem.
import test from "node:test";
import assert from "node:assert/strict";
import { tinyCatalog } from "./catalog-fixture.mjs";

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const { setCatalog } = await import("./ui/glyphs.js");
const { appliedRowHtml, subRowHtml } = await import("./ui/subs.js");

test("substituições: retratos com anel do custo, alternativas como botões com retrato e pressão com chip", () => {
  setCatalog(tinyCatalog());
  const x = (id, name, cost) => ({
    id,
    name,
    cost,
    owned: false,
    enemyCopies: 0,
    total: 9,
    lost: [],
    gained: [],
    stars: 0,
  });
  const f = {
    id: "C_Vi",
    name: "Vi",
    cost: 3,
    contested: true,
    enemyCopies: 5,
    total: 9,
    rivals: ["Ana"],
    unreachable: false,
    remaining: 4,
    options: [x("C_Teemo", "Teemo", 1), x("C_Blade", "Blade", 2)],
    suggest: "C_Teemo",
    pick: x("C_Teemo", "Teemo", 1),
  };
  const list = { innerHTML: subRowHtml(f, true) };
  assert.match(
    list.innerHTML,
    /<span class="sub-pt" style="--ring-c:var\(--cost-3\)"><span class="pt/,
    "peça da comp com o anel do custo",
  );
  assert.match(
    list.innerHTML,
    /<span class="sub-pt" style="--ring-c:var\(--cost-1\)">/,
    "sugerida",
  );
  assert.match(
    list.innerHTML,
    /<button type="button" class="sub-alt" data-out="C_Vi" data-use="C_Blade"[^>]*>.*?class="sub-pt" style="--ring-c:var\(--cost-2\)"/,
  );
  assert.match(
    list.innerHTML,
    /class="sub-why"[^>]*><span class="rt" data-kind="champion"/,
    "a frase de pressão cita a peça como imagem",
  );
  assert.match(
    list.innerHTML,
    /5\/9 cópias com rivais \(Ana\)/,
    "rival é jogador: segue texto",
  );
});

test("substituições fora de uma comp de meta: botões desligados e o motivo em texto; troca aplicada com Desfazer", () => {
  setCatalog(tinyCatalog());
  const o = {
      id: "C_Teemo",
      name: "Teemo",
      cost: 1,
      owned: true,
      where: "em campo",
      stars: 2,
      enemyCopies: 0,
      total: 9,
      lost: [],
      gained: [],
    },
    html = subRowHtml(
      {
        id: "C_Vi",
        name: "Vi",
        cost: 3,
        contested: false,
        unreachable: false,
        enemyCopies: 0,
        total: 9,
        rivals: [],
        options: [o],
        pick: o,
      },
      false,
    );
  assert.match(html, /data-use="C_Teemo"[^>]*disabled/);
  assert.match(html, /Trocas só podem ser aplicadas em comps de meta/);
  assert.match(html, /já é sua ★★ \(em campo\)/);
  const applied = appliedRowHtml({ out: "C_Vi", in: "C_Teemo" });
  assert.match(applied, /data-undo="C_Vi"/);
  assert.match(applied, /substituição aplicada/);
});
