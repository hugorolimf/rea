// Rodar com: node --test tft/helper/v2/js/
// "Substituições": cada peça e cada alternativa aparece como retrato com o anel do custo (padrão `unit()` compartilhado com
// o resto da interface), e o nome da peça na frase de pressão vira chip de imagem.
import test from "node:test";
import assert from "node:assert/strict";
import { tinyCatalog } from "./catalog-fixture.mjs";

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const { setCatalog } = await import("./ui/glyphs.js");
const { mountSubs } = await import("./ui/subs.js");

test("substituições: retratos com anel do custo, alternativas como botões com retrato e pressão com chip", () => {
  setCatalog(tinyCatalog());
  const root = { addEventListener() {}, hidden: true },
    list = { innerHTML: "" };
  const view = mountSubs(root, list, { onUse() {}, onUndo() {} });
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
  view.update({
    compId: "meta1",
    subs: [
      {
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
      },
    ],
  });
  assert.equal(root.hidden, false);
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
