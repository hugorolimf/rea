// Rodar com: node --test tft/helper/v2/js/tooltip.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { hoist, placeTip } from "./ui/tooltip.js";

const view = { width: 1000, height: 700 };
const box = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

test("a dica fica abaixo do alvo, centralizada", () => {
  const at = placeTip(box(400, 100, 40, 40), { width: 120, height: 30 }, view);
  assert.deepEqual(at, { left: 360, top: 148, above: false });
});

test("nas bordas ela é empurrada para dentro da janela", () => {
  assert.equal(
    placeTip(box(2, 100, 20, 20), { width: 200, height: 30 }, view).left,
    8,
  );
  assert.equal(
    placeTip(box(990, 100, 20, 20), { width: 200, height: 30 }, view).left,
    1000 - 200 - 8,
  );
});

test("sem espaço embaixo, sobe para cima do alvo", () => {
  const at = placeTip(box(400, 660, 40, 30), { width: 120, height: 40 }, view);
  assert.equal(at.above, true);
  assert.equal(at.top, 660 - 8 - 40);
});

test("sem espaço em nenhum lado, fica dentro da janela mesmo assim", () => {
  const at = placeTip(
    box(400, 10, 40, 680),
    { width: 120, height: 200 },
    { width: 1000, height: 300 },
  );
  assert.ok(at.top >= 8 && at.top + 200 <= 300 - 8 + 8);
});

/** Nó falso com a parte da API de DOM que `hoist` usa. */
function fakeNode({ title = null, text = "", attrs = {} } = {}) {
  const a = new Map(Object.entries(attrs));
  if (title != null) a.set("title", title);
  return {
    textContent: text,
    dataset: {},
    hasAttribute: (k) => a.has(k),
    getAttribute: (k) => a.get(k) ?? null,
    setAttribute: (k, v) => a.set(k, String(v)),
    removeAttribute: (k) => a.delete(k),
    attrs: a,
  };
}

test("hoist troca title por data-tip e mantém o nome acessível de elementos sem texto", () => {
  const n = fakeNode({ title: "Aphelios 2★\nNa loja" });
  assert.equal(hoist(n), "Aphelios 2★\nNa loja");
  assert.equal(
    n.attrs.has("title"),
    false,
    "o title nativo some (sem dica duplicada)",
  );
  assert.equal(
    n.attrs.get("aria-label"),
    "Aphelios 2★",
    "nome acessível = primeira linha",
  );
});

test("hoist não sobrescreve aria-label nem rotula elemento que já tem texto", () => {
  const withLabel = fakeNode({
    title: "dica",
    attrs: { "aria-label": "Nome" },
  });
  hoist(withLabel);
  assert.equal(withLabel.attrs.get("aria-label"), "Nome");
  const withText = fakeNode({ title: "mais detalhe", text: "Roll" });
  hoist(withText);
  assert.equal(withText.attrs.has("aria-label"), false);
  const hidden = fakeNode({
    title: "decorativo",
    attrs: { "aria-hidden": "true" },
  });
  hoist(hidden);
  assert.equal(hidden.attrs.has("aria-label"), false);
});

test("hoist repetido devolve o mesmo texto e title vazio não vira dica", () => {
  const n = fakeNode({ title: "uma dica" });
  hoist(n);
  assert.equal(hoist(n), "uma dica");
  n.attrs.set("title", "nova dica"); // a tela reescreveu o title numa leitura
  assert.equal(hoist(n), "nova dica");
  const empty = fakeNode({ title: "   " });
  assert.equal(hoist(empty), "");
});
