// Rodar com: node --test "tft/helper/tests/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contestAlert } from "../contest.mjs";
import { replaySnapshot } from "../replay.mjs";

const plan = {
  carry: "Aphelios",
  board: ["Aphelios", "Xayah", "Rakan", "Vi", "Diana", "Amumu"].map((n) => ({
    id: n,
    name: n,
  })),
};
const comps = [
  {
    id: "aph",
    title: "Aphelios",
    carry: "Aphelios",
    units: plan.board.map((u) => u.id),
  },
  {
    id: "kay",
    title: "Kayle",
    carry: "Kayle",
    units: ["Kayle", "Garen", "Nami", "Lulu", "Vi"],
  },
  {
    id: "jinx",
    title: "Jinx",
    carry: "Jinx",
    units: ["Jinx", "Xayah", "Rakan", "Sona", "Taric"],
  },
];
const ranking = [
  { id: "aph", total: 100, owned: 4, size: 6 },
  { id: "jinx", total: 95, owned: 2, size: 5 },
  { id: "kay", total: 88, owned: 1, size: 5 },
];
const rival = (name, units) => ({
  name,
  units: units.map(([id, stars = 1]) => ({ id, stars })),
});

test("rival com o seu carry e 3 peças: disputa alta e troca para a comp sem as peças disputadas", () => {
  const c = contestAlert({
    plan,
    opponents: [
      rival("Bob", [["Aphelios", 2], ["Xayah"], ["Rakan"]]),
      rival("Ana", [["Garen"]]),
    ],
    ranking,
    comps,
    stage: { stage: 3, round: 2 },
  });
  assert.equal(c.level, "high");
  assert.equal(c.rivals[0].name, "Bob");
  assert.equal(c.rivals[0].carry, true);
  assert.equal(c.rivals[0].copies, 5);
  // Jinx divide Xayah e Rakan com o rival: fica de fora; Kayle não divide nada.
  assert.equal(c.alternative.id, "kay");
});

test("com evidência, a alternativa sai só das comps medidas e o corte usa a melhor medida", () => {
  const opponents = [rival("Bob", [["Aphelios", 2], ["Xayah"], ["Rakan"]])];
  const extra = [
    ...comps,
    {
      id: "ash",
      title: "Ashe",
      carry: "Ashe",
      units: ["Ashe", "Sett", "Zoe", "Ezreal"],
    },
  ];
  // Comp sem evidência com total heurístico alto antes das medidas: não vira "melhor" nem alternativa.
  const mixed = [
    { id: "ash", total: 140, owned: 3, size: 4, evidence: null },
    { id: "aph", total: 30, owned: 4, size: 6, evidence: { expected: 3.5 } },
    { id: "kay", total: 22, owned: 1, size: 5, evidence: { expected: 3.9 } },
  ];
  const c = contestAlert({
    plan,
    opponents,
    ranking: mixed,
    comps: extra,
    stage: { stage: 3, round: 2 },
  });
  assert.equal(c.alternative.id, "kay");
  // Offline (sem nenhuma evidência) vale o total heurístico: Ashe entra e tem mais peças.
  const offline = mixed.map((r) => ({ ...r, evidence: null }));
  const o = contestAlert({
    plan,
    opponents,
    ranking: offline,
    comps: extra,
    stage: { stage: 3, round: 2 },
  });
  assert.equal(o.alternative.id, "ash");
});

test("sem disputa relevante não há alerta; no estágio 4+ alerta sem sugerir troca", () => {
  assert.equal(
    contestAlert({ plan, opponents: [rival("Ana", [["Vi"]])], ranking, comps }),
    null,
  );
  const late = contestAlert({
    plan,
    opponents: [rival("Bob", [["Aphelios"], ["Xayah"], ["Rakan"], ["Diana"]])],
    ranking,
    comps,
    stage: { stage: 4, round: 1 },
  });
  assert.equal(late.level, "high");
  assert.equal(late.late, true);
  assert.equal(late.alternative, null);
});

test("disputa conta as peças que você já tem em campo, mesmo fora da comp sugerida", () => {
  const c = contestAlert({
    plan,
    mine: ["Ornn", "Alistar", "LeBlanc", "Hecarim"],
    opponents: [
      rival("Kush", [["Ornn", 3], ["Alistar", 3], ["LeBlanc", 3], ["Hecarim"]]),
    ],
    ranking,
    comps,
  });
  assert.equal(c.level, "high");
  assert.equal(c.rivals[0].shared.length, 4);
  assert.equal(c.rivals[0].copies, 28);
});

test("rever partida: último tabuleiro de cada jogador, colocação do histórico no Hero", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replay-")),
    file = path.join(dir, "captures.jsonl");
  const row = (id, health, units, at) =>
    JSON.stringify({
      gameId: 42,
      id,
      name: `P${id}`,
      health,
      units,
      sourceAt: at,
    });
  fs.writeFileSync(
    file,
    [
      row(
        "1",
        60,
        [{ championName: "A", starLevel: 1, itemNames: [], price: 1 }],
        "2026-01-01T00:00:01Z",
      ),
      row(
        "1",
        0,
        [{ championName: "A", starLevel: 2, itemNames: ["IE"], price: 1 }],
        "2026-01-01T00:10:00Z",
      ),
      "{truncada",
      row("2", 30, [], "2026-01-01T00:09:00Z"),
      JSON.stringify({ gameId: 7, id: "1", health: 100, units: [] }),
    ].join("\n"),
  );
  const r = await replaySnapshot(file, "42", {
    heroId: "1",
    set: "TFTSet18",
    record: { placement: 6, queue: "RANKED_TFT", durationSeconds: 1800 },
  });
  assert.equal(r.endedAt, "2026-01-01T00:10:00Z");
  assert.equal(r.snapshot.statsBlock.players.length, 2);
  const hero = r.snapshot.statsBlock.players.find((p) => p.playerId === "1");
  assert.equal(hero.health, 0);
  assert.equal(hero.ffaStanding, 6);
  assert.deepEqual(hero.boardPieces[0], {
    championName: "A",
    starLevel: 2,
    itemNames: ["IE"],
    price: 1,
  });
  assert.equal(await replaySnapshot(file, "999", {}), null);
  fs.rmSync(dir, { recursive: true });
});
