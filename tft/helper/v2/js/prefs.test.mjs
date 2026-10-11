// Rodar com: node --test tft/helper/v2/js/prefs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  PREFS_KEY,
  createPrefs,
  effectiveTheme,
  nextTheme,
  normalizePrefs,
  readPrefs,
  safeStorage,
} from "./prefs.js";

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
};

test("padrões quando não há nada guardado ou o JSON está corrompido", () => {
  const defaults = {
    theme: "auto",
    motion: "auto",
    stickyHud: true,
    installDismissed: false,
  };
  assert.deepEqual(readPrefs(memoryStorage()), defaults);
  assert.deepEqual(
    readPrefs(memoryStorage({ [PREFS_KEY]: "{não é json" })),
    defaults,
  );
  assert.deepEqual(normalizePrefs([1, 2]), defaults);
});

test("valores inválidos voltam ao padrão e chaves desconhecidas somem", () => {
  const out = normalizePrefs({
    theme: "roxo",
    motion: "reduce",
    stickyHud: "sim",
    extra: 1,
  });
  assert.deepEqual(out, {
    theme: "auto",
    motion: "reduce",
    stickyHud: true,
    installDismissed: false,
  });
});

test("set valida, grava e avisa só quando o valor muda", () => {
  const storage = memoryStorage(),
    prefs = createPrefs(storage),
    seen = [];
  prefs.subscribe((key, value) => seen.push([key, value]));
  assert.equal(prefs.set("theme", "dark"), true);
  assert.equal(prefs.set("theme", "dark"), false, "mesmo valor: nada a avisar");
  assert.equal(prefs.set("theme", "azul"), false, "valor inválido");
  assert.equal(prefs.set("inexistente", 1), false, "chave inválida");
  assert.deepEqual(seen, [["theme", "dark"]]);
  assert.equal(JSON.parse(storage.data.get(PREFS_KEY)).theme, "dark");
  assert.equal(
    createPrefs(storage).get("theme"),
    "dark",
    "sobrevive a uma nova instância",
  );
});

test("cancelar a assinatura para as notificações", () => {
  const prefs = createPrefs(memoryStorage());
  let calls = 0;
  const off = prefs.subscribe(() => calls++);
  prefs.set("stickyHud", false);
  off();
  prefs.set("stickyHud", true);
  assert.equal(calls, 1);
});

test("gravação que falha (cota/modo privado) não derruba: o valor vale na página", () => {
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error("cota");
    },
  };
  const prefs = createPrefs(broken);
  assert.equal(prefs.set("motion", "reduce"), true);
  assert.equal(prefs.get("motion"), "reduce");
});

test("safeStorage: localStorage bloqueado vira memória e nunca lança", () => {
  const blocked = safeStorage(() => {
    throw new Error("SecurityError");
  });
  assert.equal(blocked.persistent, false);
  assert.equal(blocked.getItem("x"), null);
  blocked.setItem("x", 1);
  assert.equal(blocked.getItem("x"), "1");
  blocked.removeItem("x");
  assert.equal(blocked.getItem("x"), null);
});

test("safeStorage: armazenamento que lança só na gravação mantém a cópia em memória", () => {
  const flaky = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
    removeItem() {},
  };
  const s = safeStorage(() => flaky);
  assert.equal(s.persistent, true);
  s.setItem("k", "v");
  assert.equal(s.getItem("k"), "v");
});

test("safeStorage usa o armazenamento real quando funciona", () => {
  const real = memoryStorage();
  const s = safeStorage(() => real);
  s.setItem("a", "1");
  assert.equal(real.data.get("a"), "1");
  assert.equal(s.getItem("a"), "1");
});

test("ciclo e resolução do tema", () => {
  assert.deepEqual(["auto", "light", "dark"].map(nextTheme), [
    "light",
    "dark",
    "auto",
  ]);
  assert.equal(nextTheme("?"), "auto");
  assert.equal(effectiveTheme("auto", true), "dark");
  assert.equal(effectiveTheme("auto", false), "light");
  assert.equal(effectiveTheme("light", true), "light");
  assert.equal(effectiveTheme("dark", false), "dark");
});
