// Rodar com: node --test tft/helper/v2/js/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as comps from "./comps.js";
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

test("filtros: texto sem acento casa campeão e sinergia ativa; estilo combina", () => {
  const champions = new Map([
      ["DA_18_Rengar", { name: "Rengar", traits: ["Caçador"] }],
    ]),
    list = mergeComps(raw);
  const byChamp = filterComps(list, { query: "rengar" }, champions);
  assert.ok(byChamp.length > 0);
  assert.ok(byChamp.every((c) => c.units.includes("DA_18_Rengar")));
  assert.deepEqual(
    // Sinergia de patamar 1 (um campeão a ativa): casa pelo nome sem acento.
    filterComps(
      list,
      { query: "cacador" },
      champions,
      new Map([["Caçador", [1]]]),
    ).map((c) => c.id),
    byChamp.map((c) => c.id),
  );
  const fast9 = filterComps(list, { style: "fast9" }, champions);
  assert.ok(fast9.length && fast9.every((c) => c.levelling === "Fast 9"));
});

test("busca por sinergia traz as comps que de fato a têm ativa, não o texto do título nem um campeão solto", () => {
  const champs = new Map([
      ["A", { name: "Alfa", traits: ["Carrasco", "Rival"] }],
      ["B", { name: "Beta", traits: ["Carrasco"] }],
      ["C", { name: "Gama", traits: ["Carrasco"] }],
      ["D", { name: "Delta", traits: ["Rival"] }],
      ["E", { name: "Carrasco Jr", traits: [] }],
    ]),
    patamares = new Map([
      ["Carrasco", [2, 4]],
      ["Rival", [2]],
    ]),
    list = mergeComps([
      {
        id: "ativa",
        title: "Outra coisa",
        units: ["A", "B", "D"],
        avg: 4.4,
        top4: 50,
        levelling: "Fast 8",
      },
      {
        id: "solta",
        title: "Carrasco no título",
        units: ["A", "D"],
        avg: 4.4,
        top4: 50,
        levelling: "Fast 8",
      },
      {
        id: "tres",
        title: "X",
        units: ["A", "B", "C"],
        avg: 4.4,
        top4: 50,
        levelling: "Fast 8",
      },
      {
        id: "nome",
        title: "Y",
        units: ["E", "D"],
        avg: 4.4,
        top4: 50,
        levelling: "Fast 8",
      },
    ]);
  const hit = filterComps(list, { query: "carrasco" }, champs, patamares);
  assert.deepEqual(
    hit.map((c) => c.id),
    ["ativa", "tres", "nome"],
  );
  assert.deepEqual(hit.find((c) => c.id === "ativa").match, {
    name: "Carrasco",
    count: 2,
  });
  assert.deepEqual(hit.find((c) => c.id === "tres").match, {
    name: "Carrasco",
    count: 3,
  });
  // "solta" tem um só campeão com Carrasco (patamar 2): não ativa e o título não conta.
  assert.ok(!hit.some((c) => c.id === "solta"));
  // Campeão com o texto no nome continua achável pelo nome (sem match de sinergia).
  assert.equal(hit.find((c) => c.id === "nome").match, null);
  // Sem os patamares do catálogo, 2 campeões ativam.
  assert.ok(
    filterComps(list, { query: "rival" }, champs).some((c) => c.id === "solta"),
  );
});

test("score: ordem por score, sem encaixe por último; faixa e melhor comp", () => {
  const { scoreOf } = comps;
  const merged = mergeComps(
    [raw[0], raw[1], raw[2]],
    [
      {
        id: raw[0].id,
        rank: 2,
        score: 41.2,
        chance: 0.5,
        level: 6,
        best: false,
      },
      {
        id: raw[1].id,
        rank: 1,
        score: 72.9,
        chance: 0.31,
        chancePlan: 0.6,
        level: 6,
        best: true,
      },
    ],
  );
  assert.deepEqual(
    sortComps(merged).map((c) => c.id),
    [raw[1].id, raw[0].id, raw[2].id],
  );
  assert.deepEqual(scoreOf(merged[1]), {
    score: 73,
    chance: 31,
    chancePlan: 60,
    level: 6,
    best: true,
    band: "high",
  });
  assert.equal(scoreOf(merged[0]).band, "mid");
  assert.equal(scoreOf(merged[2]), null);
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

test("comp fixada: vale só onde foi escolhida; a partida seguinte começa no automático", () => {
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
  // A partida começa: a escolha do lobby não passa para ela.
  assert.equal(goals.get(live), null);
  // Escolhida durante a partida, vale nela e some quando ela termina.
  goals.set(live, "426000");
  assert.equal(goals.get(live)?.id, "426000");
  assert.equal(goals.get(ended), null);
  assert.equal(goals.get("43"), null);
  storage.setItem("tft-compass-goal", "{quebrado");
  assert.equal(goals.get(lobby), null);
});

test("com seus itens: só anuncia ganho relevante", () => {
  const { itemUpgrade } = comps;
  assert.equal(
    itemUpgrade({ fit: { itemGain: 0.02, adjustedAvg: 4.38 } }),
    null,
  );
  assert.equal(itemUpgrade({ fit: null }), null);
  assert.deepEqual(
    itemUpgrade({ fit: { itemGain: 0.12, adjustedAvg: 4.38 } }),
    { avg: 4.38, gain: 0.12 },
  );
});
