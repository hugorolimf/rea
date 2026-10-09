// Rodar com: node --test tft/helper/engine-flex.test.mjs
// Substituições de peças da comp: catálogo e comps reais, tabuleiros sintéticos.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyze } from "./engine.mjs";
import { loadComps } from "./meta-comps.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)),
  catalog = JSON.parse(readFileSync(path.join(root, "catalog.json"), "utf8")),
  { comps } = await loadComps(root, "TFTSet18", catalog),
  byName = new Map(catalog.champions.map((c) => [c.name, c])),
  HERO = 47445859;

const piece = (name, starLevel = 1, itemNames = []) => {
  const c = byName.get(name);
  assert.ok(c, `campeão ${name} no catálogo`);
  return { championName: c.apiName, starLevel, itemNames, price: c.cost };
};
const snapshot = (hero, rivals) => ({
  gameId: 1,
  statsBlock: {
    setCoreName: "TFTSet18",
    players: [
      { playerId: HERO, health: 60, ffaStanding: 3, boardPieces: hero },
      ...rivals.map((boardPieces, i) => ({
        playerId: 100 + i,
        health: 50,
        ffaStanding: 4 + i,
        riotIdGameName: `Rival ${i + 1}`,
        boardPieces,
      })),
    ],
  },
});
const run = (snap, comp) =>
  analyze(snap, catalog, {
    level: 8,
    targetLevel: 8,
    gold: 30,
    bench: [],
    inventory: [],
    playerId: String(HERO),
    metaComps: comps,
    previewIds: comp.units,
    goalCarryId: comp.carry,
  });

// Comp de Rengar (reroll 7): Lillia, Rengar, Cassiopeia, Rammus, Fiddlesticks, Shen, Ornn.
const rengar = comps.find((c) => c.carry === "DA_18_Rengar");

test("peça disputada pelos rivais recebe substituto que não está disputado e não derruba sinergias", () => {
  assert.ok(rengar, "comp de Rengar na cópia local");
  // 7 de 18 cópias de Rammus com dois rivais: disputado (> 35% da pool).
  const snap = snapshot(
    [piece("Shen", 2), piece("Vi", 2), piece("Sentinel", 2)],
    [
      [piece("Rammus", 2), piece("Rammus", 1)],
      [piece("Rammus", 1), piece("Rammus", 1)],
    ],
  );
  const flex = run(snap, rengar).previewFlex,
    rammus = flex.find((f) => f.name === "Rammus");
  assert.ok(rammus, "Rammus aparece nas substituições");
  assert.equal(rammus.contested, true);
  assert.equal(rammus.enemyCopies, 6);
  assert.deepEqual(rammus.rivals.sort(), ["Rival 1", "Rival 2"]);
  const pick = rammus.options.find((o) => o.id === rammus.suggest);
  assert.ok(pick, "há sugestão para a peça disputada");
  assert.equal(pick.contested, false);
  assert.ok(pick.traitDelta >= -1);
  assert.ok(!rengar.units.includes(pick.id), "substituto vem de fora da comp");
});

test("carry nunca é substituído, e cada substituto serve a uma peça só", () => {
  const snap = snapshot(
    [piece("Vi", 2), piece("Sentinel", 2), piece("Diana", 2)],
    [],
  );
  const flex = run(snap, rengar).previewFlex;
  assert.ok(!flex.some((f) => f.id === rengar.carry));
  const picks = flex.map((f) => f.suggest).filter(Boolean);
  assert.equal(new Set(picks).size, picks.length);
  // Sem disputa, só sugere trocar por algo que já é seu e mantém as sinergias.
  for (const f of flex.filter(
    (f) => f.suggest && !f.contested && !f.unreachable,
  )) {
    const o = f.options.find((x) => x.id === f.suggest);
    assert.equal(o.owned, true);
    assert.deepEqual(o.lost, []);
  }
});

test("peça que já é sua e não está sob pressão não recebe sugestão de troca", () => {
  const snap = snapshot(
    [piece("Shen", 2), piece("Ornn", 2), piece("Vi", 2), piece("Sentinel", 2)],
    [],
  );
  const flex = run(snap, rengar).previewFlex;
  for (const name of ["Shen", "Ornn"]) {
    const f = flex.find((x) => x.name === name);
    assert.ok(!f?.suggest, `${name} já é sua: sem sugestão`);
  }
});
