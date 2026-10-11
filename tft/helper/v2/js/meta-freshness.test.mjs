// Rodar com: node --test "tft/helper/v2/js/meta-freshness.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { metaAge, metaNote } from "./meta-freshness.js";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3_600_000;

test("idade legível", () => {
  assert.deepEqual([0, 61_000, 5 * H, 49 * H].map(metaAge), [
    "menos de 1 min",
    "1 min",
    "5 h",
    "2 d",
  ]);
  assert.equal(metaAge(NaN), "idade desconhecida");
});

test("em dia e vindo da rede não tem nota; offline, desatualizada e repositório têm", () => {
  const fresh = { mode: "em-dia", origin: "local", recovered: false };
  assert.equal(metaNote(fresh, ago(H), NOW), null);
  assert.equal(metaNote(null, ago(H), NOW), null);
  assert.deepEqual(metaNote({ ...fresh, mode: "offline" }, ago(5 * H), NOW), {
    text: "offline · dados de 5 h",
    tone: "amber",
  });
  assert.deepEqual(
    metaNote(
      { ...fresh, mode: "desatualizado", origin: "repositorio" },
      ago(3 * 24 * H),
      NOW,
    ),
    {
      text: "desatualizada · dados de 3 d · snapshot do repositório",
      tone: "amber",
    },
  );
  assert.deepEqual(metaNote({ ...fresh, origin: "repositorio" }, ago(H), NOW), {
    text: "snapshot do repositório",
    tone: null,
  });
  assert.equal(
    metaNote({ ...fresh, recovered: true }, ago(H), NOW).text,
    "recuperada de uma cópia anterior",
  );
  assert.equal(
    metaNote({ ...fresh, origin: "ausente" }, null, NOW).tone,
    "danger",
  );
});
