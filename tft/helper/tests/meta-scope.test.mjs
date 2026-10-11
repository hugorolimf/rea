// Rodar com: node --test "tft/helper/tests/meta-scope.test.mjs"
// O recorte da MetaTFT (meta-scope.mjs) é um só para comps, estatísticas de tabuleiro e evidência, e dado de outro set
// é recusado: o cache de evidência perguntado sem o recorte, o que cita peça fora do catálogo, o cache inteiro com 0
// partidas e a resposta condicional de outro set. Rede trocada por respostas no formato do explorer; disco real.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { explorer, exactUnit, filterKey, screenCache } from "../evidence.mjs";
import {
  evidenceIds,
  METATFT_SCOPE,
  patchLabel,
  SCOPE_TAG,
  setIdsOf,
  statsSetProblem,
} from "../meta-scope.mjs";

const helper = path.resolve(import.meta.dirname, "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(helper, "catalog.json"), "utf8"),
);
const ids = setIdsOf(catalog);
const [ornn, lillia] = ["DA_18_Ornn", "DA_18_Lillia"];

test("fonte única: o recorte e a leitura do patch só existem em meta-scope.mjs", () => {
  const sources = [
    ...fs.readdirSync(helper).map((f) => path.join(helper, f)),
    ...["app", "scripts", "core"].flatMap((d) =>
      fs
        .readdirSync(path.join(helper, d), { recursive: true })
        .map((f) => path.join(helper, d, f)),
    ),
  ].filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
  const holders = (re) =>
    sources
      .filter((f) => re.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(helper, f));
  assert.deepEqual(holders(/queue=1100|patch=current/), ["meta-scope.mjs"]);
  assert.deepEqual(holders(/b_patch_version/), ["meta-scope.mjs"]);
  assert.equal(patchLabel({ patch: "18.4", b_patch_version: "b" }), "18.4b");
  assert.equal(patchLabel(undefined), null);
});

test("estatísticas: tabela de outro set é 'fora do set'; o snapshot embarcado é do catálogo atual", () => {
  const otherSet = {
    unit: { "TFT17_Vex|2": [4.1, 900], tft17_bard: [4.3, 10] },
    trait: { "TFT17_Mage|1": [4.4, 2000] },
  };
  assert.match(
    statsSetProblem(otherSet, ids),
    new RegExp(
      `^fora do set: 0 de ${ids.champions.size} campeões e 0 de ${ids.traits.size} sinergias`,
    ),
  );
  const embedded = JSON.parse(
    fs.readFileSync(path.join(helper, "meta-stats.json"), "utf8"),
  );
  assert.equal(
    statsSetProblem(embedded, ids),
    null,
    "meta-stats.json do repositório é de outro set",
  );
  assert.ok(
    embedded.base[1] > 100_000,
    `base com ${embedded.base[1]} tabuleiros: recorte faltando?`,
  );
});

/** Troca `fetch`: `answer(url)` devolve as linhas; guarda as URLs pedidas. */
function withRows(answer) {
  const real = globalThis.fetch,
    urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => answer(String(url)) };
  };
  return { urls, restore: () => (globalThis.fetch = real) };
}
const tmpFile = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-scope-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "evidence-cache.json");
};
const quietly = (fn) => {
  const warn = console.warn,
    said = [];
  console.warn = (m) => said.push(String(m));
  try {
    return [fn(), said];
  } finally {
    console.warn = warn;
  }
};

test("evidência: toda pergunta vai com o recorte e a resposta guardada leva a etiqueta dele", async (t) => {
  const file = tmpFile(t);
  const net = withRows(() => [
    { avg_placement: 4.45, total_games: 679991, top4_percentage: 51 },
  ]);
  try {
    const ex = explorer(file, { ids });
    const filter = exactUnit(ornn, 2, 1);
    assert.deepEqual(await ex.total([filter]), {
      avg: 4.45,
      games: 679991,
      top4: 51,
    });
    assert.equal(
      net.urls[0],
      `https://api-hc.metatft.com/tft-explorer-api/total?${METATFT_SCOPE}&${filter}`,
    );
    await ex.flush();
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved[`total?${filterKey([filter])}`].scope, SCOPE_TAG);
    // Um novo processo reaproveita a resposta (mesmo recorte, peça do catálogo, com partidas).
    const again = explorer(file, { ids });
    assert.deepEqual(again.health(), {
      kept: 1,
      rejected: { expired: 0, scope: 0, outOfSet: 0, empty: 0 },
    });
    await again.total([filter]);
    assert.equal(net.urls.length, 1);
  } finally {
    net.restore();
  }
});

test("evidência: o cache contaminado (sem recorte, 0 partidas) não é usado e as perguntas são refeitas", async (t) => {
  const file = tmpFile(t),
    now = Date.now();
  // Como o data/evidence-cache.json de 2026-10-11: perguntas do Set 18 feitas sem o recorte, todas com 0 partidas.
  const zero = { avg: null, games: 0, top4: null };
  const asked = [
    ornn,
    lillia,
    "DA_18_Rammus",
    "DA_18_Shen",
    "DA_18_Leona",
    "DA_18_Soraka",
  ].map((id) => `total?${exactUnit(id, 2, 0)}`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      Object.fromEntries(asked.map((k) => [k, { at: now, value: zero }])),
    ),
  );
  const [ex, said] = quietly(() => explorer(file, { ids }));
  assert.deepEqual(ex.health(), {
    kept: 0,
    rejected: { expired: 0, scope: 6, outOfSet: 0, empty: 0 },
  });
  assert.match(said.join("\n"), /6 sem o recorte de set\/patch atual/);
  const net = withRows(() => [
    { avg_placement: 4.4, total_games: 5000, top4_percentage: 52 },
  ]);
  try {
    assert.equal((await ex.total([exactUnit(ornn, 2, 0)])).games, 5000);
    assert.equal(net.urls.length, 1, "a pergunta foi refeita na rede");
  } finally {
    net.restore();
  }

  // Com a etiqueta certa, mas o cache inteiro com 0 partidas: também não serve.
  const tagged = (value) => ({ at: now, scope: SCOPE_TAG, value });
  fs.writeFileSync(
    file,
    JSON.stringify(Object.fromEntries(asked.map((k) => [k, tagged(zero)]))),
  );
  const [empty] = quietly(() => explorer(file, { ids }));
  assert.deepEqual(empty.health().rejected, {
    expired: 0,
    scope: 0,
    outOfSet: 0,
    empty: 6,
  });
  // Basta uma resposta com partidas para o cache valer (0 partidas numa combinação rara é legítimo).
  const mixed = Object.fromEntries(asked.map((k) => [k, tagged(zero)]));
  mixed[asked[0]] = tagged({ avg: 4.2, games: 300, top4: 55 });
  assert.equal(screenCache(mixed, { ids }).kept.length, 6);
});

test("evidência: pergunta com peça ou sinergia fora do catálogo é 'fora do set'", () => {
  const now = Date.now();
  const tagged = (value) => ({ at: now, scope: SCOPE_TAG, value });
  const ok = { avg: 4.2, games: 300, top4: 55 };
  const saved = {
    [`total?${exactUnit(ornn, 2, 1)}&trait=DA_18_Elderwood_2`]: tagged(ok),
    [`total?${exactUnit("TFT17_Vex", 2, 1)}`]: tagged(ok),
    [`total?${exactUnit(ornn, 1, 0)}&trait=TFT17_Mage_1`]: tagged(ok),
    "total?unit=A": { at: now - 7 * 3_600_000, scope: SCOPE_TAG, value: ok },
  };
  const { kept, rejected } = screenCache(saved, { ids, now });
  assert.deepEqual(
    kept.map(([k]) => k),
    [`total?${exactUnit(ornn, 2, 1)}&trait=DA_18_Elderwood_2`],
  );
  assert.deepEqual(rejected, { expired: 1, scope: 0, outOfSet: 2, empty: 0 });
  assert.deepEqual(
    evidenceIds(
      `units_unique?unit=!${ornn}&${exactUnit(lillia, 3, 2)}&level=8`,
    ),
    {
      units: [ornn, lillia],
      traits: [],
    },
  );
  // Sem catálogo não há como medir pertença: só valem o recorte e o cache vazio.
  assert.equal(screenCache(saved, { now }).kept.length, 3);
});

test("evidência: resposta condicional de outro set é recusada e não entra no cache", async (t) => {
  const file = tmpFile(t);
  let otherSet = true;
  const net = withRows((url) =>
    url.includes("/units_unique?")
      ? (otherSet
          ? ["TFT17_Vex", "TFT17_Bard", ornn]
          : [lillia, "DA_18_Shen"]
        ).map((u) => ({
          units_unique: `${u}-1`,
          avg_placement: 4.1,
          total_games: 900,
        }))
      : [{ traits: "DA_18_Elderwood_2", avg_placement: 4.0, total_games: 800 }],
  );
  try {
    const ex = explorer(file, { ids });
    const filter = exactUnit(ornn, 2, 2);
    await assert.rejects(
      ex.conditional(filter),
      /units_unique: resposta fora do set \(2 de 3, ex\.: TFT17_Vex\)/,
    );
    otherSet = false;
    const got = await ex.conditional(filter);
    assert.deepEqual(Object.keys(got.units), [lillia, "DA_18_Shen"]);
    assert.deepEqual(got.traits, { "DA_18_Elderwood|2": [4.0, 800] });
    // units_unique foi perguntado duas vezes (a recusa não ficou no cache); traits, uma.
    assert.equal(
      net.urls.filter((u) => u.includes("/units_unique?")).length,
      2,
    );
    assert.ok(net.urls.every((u) => u.includes(`?${METATFT_SCOPE}&`)));
  } finally {
    net.restore();
  }
});
