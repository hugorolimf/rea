// Rodar com: node --test tft/helper/v2/js/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  disputeLevel,
  filterComps,
  goalStore,
  matchKeyOf,
  mergeComps,
  sortComps,
  styleOf,
} from "./comps.js";

// Comps reais da cópia local (formato do arquivo; o servidor acrescenta title/carry/rerollLevel).
const raw = JSON.parse(
  readFileSync(new URL("../../meta-comps.json", import.meta.url), "utf8"),
).comps.map((c) => ({
  ...c,
  title: c.key.join(" · "),
  rerollLevel: Number(/^lvl (\d+)$/.exec(c.levelling)?.[1]) || null,
}));

test("estilo de nível: reroll pelo nível, Fast 8/9 pelo texto publicado", () => {
  assert.deepEqual(styleOf({ rerollLevel: 6, levelling: "lvl 6" }), {
    key: "reroll",
    label: "Reroll nível 6",
  });
  assert.equal(styleOf({ levelling: "Fast 9" }).key, "fast9");
  assert.equal(styleOf({ levelling: "Standard" }).key, "standard");
  assert.equal(styleOf({ levelling: "" }).key, "other");
  // Estilo desconhecido continua visível com o texto publicado, sem quebrar a tela.
  assert.equal(styleOf({ levelling: "Hyper 10" }).label, "Hyper 10");
});

test("encaixe: comps sem avaliação ficam por último; empate pela colocação média", () => {
  const [a, b, c] = raw;
  const merged = mergeComps(
    [a, b, c],
    [
      { id: c.id, rank: 1 },
      { id: a.id, rank: 2 },
    ],
  );
  assert.deepEqual(
    sortComps(merged, "fit").map((x) => x.id),
    [c.id, a.id, b.id],
  );
  const byAvg = sortComps(mergeComps(raw), "avg");
  for (let i = 1; i < byAvg.length; i++)
    assert.ok(byAvg[i - 1].avg <= byAvg[i].avg);
  const byTop4 = sortComps(mergeComps(raw), "top4");
  assert.ok(byTop4[0].top4 >= byTop4.at(-1).top4);
});

test("filtros: texto sem acento casa campeão e sinergia; estilo e tier combinam", () => {
  const champions = new Map([
      ["DA_18_Rengar", { name: "Rengar", traits: ["Caçador"] }],
    ]),
    list = mergeComps(raw);
  const byChamp = filterComps(list, { query: "rengar" }, champions);
  assert.ok(byChamp.length > 0);
  assert.ok(byChamp.every((c) => c.units.includes("DA_18_Rengar")));
  assert.deepEqual(
    filterComps(list, { query: "cacador" }, champions).map((c) => c.id),
    byChamp.map((c) => c.id),
  );
  const fast9 = filterComps(list, { style: "fast9", tiers: [] }, champions);
  assert.ok(fast9.length && fast9.every((c) => c.levelling === "Fast 9"));
  const tierA = filterComps(list, { tiers: ["A"] }, new Map());
  assert.ok(tierA.every((c) => c.tier === "A"));
});

test("disputa: faixas da soma do motor", () => {
  assert.deepEqual([null, 0, 1.9, 2, 4.9, 5].map(disputeLevel), [
    null,
    "baixa",
    "baixa",
    "média",
    "média",
    "alta",
  ]);
});

test("comp fixada: escolhida fora de partida vale para a próxima; escolhida numa partida some quando ela acaba", () => {
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    },
    goals = goalStore(storage);
  const lobby = matchKeyOf({ match: { status: "none", id: null } }),
    live = matchKeyOf({ match: { status: "live", id: 42 } }),
    ended = matchKeyOf({ match: { status: "ended", id: 42 } });
  assert.equal(lobby, "lobby");
  assert.equal(live, "42");
  assert.equal(ended, "lobby");
  goals.set(lobby, "426000", [{ out: "a", in: "b" }]);
  assert.deepEqual(goals.get(lobby), {
    id: "426000",
    swaps: [{ out: "a", in: "b" }],
  });
  // A partida começa: a escolha do lobby (com as substituições) passa a pertencer a ela.
  assert.deepEqual(goals.get(live)?.swaps, [{ out: "a", in: "b" }]);
  assert.equal(goals.get(live)?.id, "426000");
  // A partida termina: a escolha não passa para a próxima.
  assert.equal(goals.get(ended), null);
  assert.equal(goals.get("43"), null);
  storage.setItem("tft-compass-goal", "{quebrado");
  assert.equal(goals.get(lobby), null);
});
