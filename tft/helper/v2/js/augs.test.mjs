// Rodar com: node --test tft/helper/v2/js/
import test from "node:test";
import assert from "node:assert/strict";
import { augPath, augStore, nextSlot, slotOfStage } from "./augs.js";

test("estágio vira posição na trilha 2-1 / 3-2 / 4-2", () => {
  assert.deepEqual(
    ["2-1", "3-2", "4-2", "4-5", "1-3", "5-1", null].map(slotOfStage),
    [0, 1, 2, 2, null, null, null],
  );
});

test("trilha: escolha com estágio vai para a sua posição; sem estágio ocupa a primeira livre", () => {
  const slots = augPath(
    [
      { id: "b", stage: "3-2" },
      { id: "a", stage: null },
      { id: "c", stage: "3-5" }, // 3-x já ocupado: vai para a próxima livre
    ],
    new Map([["b", { id: "b", name: "B" }]]),
  );
  assert.deepEqual(
    slots.map((s) => s.record?.id ?? null),
    ["a", "b", "c"],
  );
  assert.equal(slots[1].aug.name, "B");
  assert.equal(nextSlot(slots, "4-2"), null);
  const partial = augPath([{ id: "a", stage: "2-1" }]);
  assert.equal(nextSlot(partial, "3-2"), 1);
  assert.equal(nextSlot(partial, null), 1);
});

test("escolhas valem só na partida em que foram marcadas", () => {
  const data = new Map(),
    store = augStore({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    });
  store.add("lobby", "x", "2-1");
  assert.deepEqual(store.get("lobby"), []);
  store.add("42", "x", "2-1", "Xis");
  store.add("42", "y", "3-2");
  store.add("42", "x", "2-1", "Xis"); // marcar de novo não duplica
  assert.deepEqual(
    store.get("42").map((p) => p.id),
    ["y", "x"],
  );
  assert.deepEqual(store.get("43"), []);
  store.remove("42", "y");
  assert.deepEqual(
    store.get("42").map((p) => p.name),
    ["Xis"],
  );
});
